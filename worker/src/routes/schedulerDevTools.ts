import type { Hono } from "hono";
import type { Channel, Env } from "../lib/types";
import { runAction, type ActionRequest } from "../lib/scheduler/actions";
import { latestVersion } from "../lib/scheduler/generate";
import { loadGridBlocks, occurrencesBetween } from "../lib/scheduler/grid";
import { channelHealth } from "../lib/scheduler/health";
import { Planner } from "../lib/scheduler/plan";
import { nowPlayingFromLog, schedState } from "../lib/scheduler/read";
import { liveMax, publishVersion } from "../lib/scheduler/store";
import { clearTimelineCache, itemsBetween } from "../lib/scheduler/timeline";

/** Test controls for a local database (see schedulerDev.ts: SCHED_DEV only). */
export function registerDevTools(r: Hono<{ Bindings: Env }>) {
  const chan = (env: Env, slug: string | undefined) => env.DB.prepare("SELECT * FROM channels WHERE slug = ?").bind(slug ?? "").first<Channel>();

  // Wipe every Scheduler table.
  r.post("/reset", async (c) => {
    for (const t of ["sched_log_items", "sched_versions", "sched_aired", "sched_changes", "sched_fallback_items", "sched_block_exceptions", "sched_blocks", "sched_plans", "sched_runs"]) {
      await c.env.DB.prepare(`DELETE FROM ${t}`).run();
    }
    await c.env.DB.prepare(
      `UPDATE sched_channels SET enabled = 0, enabled_at = NULL, last_run_at_ms = NULL, last_run_ok = NULL, consecutive_failures = 0,
         inputs_fingerprint = NULL, on_fallback_since_ms = NULL, shadow_mismatches = 0, shadow_checks = 0, shadow_window_start_ms = NULL,
         shadow_last_mismatch_ms = NULL, shadow_since_ms = NULL`
    ).run();
    const { results } = await c.env.DB.prepare("SELECT id FROM channels").all<{ id: string }>();
    for (const k of ["sched:health", "sched:retention", ...results.flatMap((ch) => [`sched:red:${ch.id}`, `sched:health:${ch.id}`])]) await c.env.CONFIG.delete(k);
    clearTimelineCache();
    return c.json({ ok: true });
  });

  // Skip the 24 h shadow rule.
  r.post("/enable", async (c) => {
    const ch = await chan(c.env, c.req.query("channel"));
    if (!ch) return c.json({ error: "no channel" }, 404);
    await c.env.DB.prepare("UPDATE sched_channels SET enabled = ?, on_fallback_since_ms = NULL WHERE channel_id = ?").bind(c.req.query("on") === "0" ? 0 : 1, ch.id).run();
    clearTimelineCache();
    return c.json({ ok: true });
  });

  // A live control at a frozen time.
  r.post("/action", async (c) => {
    const ch = await chan(c.env, c.req.query("channel"));
    if (!ch) return c.json({ error: "no channel" }, 404);
    const body = await c.req.json<ActionRequest>();
    const res = await runAction(c.env, ch, body, Number(c.req.query("now")) || Date.now());
    return c.json(res, res.ok ? 200 : res.status);
  });

  // Build a broken version (a gap, or an item without audio) and try to publish it.
  r.post("/corrupt", async (c) => {
    const ch = await chan(c.env, c.req.query("channel"));
    if (!ch) return c.json({ error: "no channel" }, 404);
    const now = Number(c.req.query("now")) || Date.now();
    const plan = await new Planner(c.env.DB, c.env.CONFIG, ch, await loadGridBlocks(c.env.DB, ch.id), now).build(now, now + 6 * 3600_000);
    const items = plan.items.map((i) => ({ ...i }));
    if (c.req.query("how") === "audio") items[5] = { ...items[5], audioUrl: "" };
    else items.splice(5, 1);
    const res = await publishVersion(c.env.DB, {
      channelId: ch.id, kind: "generate", actor: "system", summary: "Corrupt test build", effectiveFrom: items[0].startsAt,
      items, basedOn: await latestVersion(c.env.DB, ch.id), baseItems: [], expectedMax: await liveMax(c.env.DB, ch.id), nowMs: now,
    });
    return c.json(res);
  });

  // The log "runs out" from now on.
  r.post("/exhaust", async (c) => {
    const ch = await chan(c.env, c.req.query("channel"));
    if (!ch) return c.json({ error: "no channel" }, 404);
    const now = Number(c.req.query("now")) || Date.now();
    await c.env.DB.prepare("DELETE FROM sched_log_items WHERE ends_at_ms > ? AND version_id IN (SELECT id FROM sched_versions WHERE channel_id = ?)").bind(now - 60_000, ch.id).run();
    await c.env.DB.prepare("UPDATE sched_versions SET horizon_ms = ? WHERE channel_id = ? AND horizon_ms > ?").bind(now - 60_000, ch.id, now - 60_000).run();
    clearTimelineCache();
    return c.json({ ok: true });
  });

  r.post("/clear-fallback", async (c) => {
    const ch = await chan(c.env, c.req.query("channel"));
    if (!ch) return c.json({ error: "no channel" }, 404);
    await c.env.DB.prepare("DELETE FROM sched_fallback_items WHERE channel_id = ?").bind(ch.id).run();
    return c.json({ ok: true });
  });

  // The listener response at a frozen time.
  r.get("/now-playing", async (c) => {
    const ch = await chan(c.env, c.req.query("channel"));
    if (!ch) return c.json({ error: "no channel" }, 404);
    const now = Number(c.req.query("now")) || Date.now();
    clearTimelineCache();
    const st = await schedState(c.env.DB, ch.id);
    const body = st ? await nowPlayingFromLog(c.env, ch, st, now, (p) => c.executionCtx.waitUntil(p)) : null;
    return c.json(body ?? { old_path: true });
  });

  r.get("/health", async (c) => {
    const ch = await chan(c.env, c.req.query("channel"));
    if (!ch) return c.json({ error: "no channel" }, 404);
    const now = Number(c.req.query("now")) || Date.now();
    const sc = await c.env.DB.prepare("SELECT * FROM sched_channels WHERE channel_id = ?").bind(ch.id).first();
    return c.json({ checks: await channelHealth(c.env, ch, sc as never, now) });
  });

  // Replace a channel's blocks directly and publish them as its next plan (the Studio API validates and versions; this doesn't).
  r.post("/grid", async (c) => {
    const ch = await chan(c.env, c.req.query("channel"));
    if (!ch) return c.json({ error: "no channel" }, 404);
    const blocks = await c.req.json<Record<string, unknown>[]>();
    await c.env.DB.prepare("DELETE FROM sched_blocks WHERE channel_id = ?").bind(ch.id).run();
    const now = Date.now();
    for (const b of blocks) {
      await c.env.DB.prepare(
        `INSERT INTO sched_blocks (id, channel_id, name, description, recurrence, days_mask, once_date, monthly_rule, date_from, date_to,
           start_min, end_min, layer, start_mode, end_mode, priority, fill_kind, programme_id, tags_any_json, colour, public, active, created_at_ms, updated_at_ms)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`
      ).bind(b.id, ch.id, b.name, b.description ?? "Test", b.recurrence ?? "weekly", b.recurrence && b.recurrence !== "weekly" ? null : (b.days_mask ?? 127),
        b.once_date ?? null, b.monthly_rule ?? null, b.date_from ?? null, b.date_to ?? null,
        b.start_min, b.end_min, b.layer ?? 1, b.start_mode ?? "hard", b.end_mode ?? "hard", b.priority ?? "normal", b.fill_kind ?? "autopilot",
        b.programme_id ?? null, b.tags_any_json ?? null, b.colour ?? "blue", b.public ?? 1, now, Number(b.updated_at_ms) || now).run();
      for (const d of (b.exceptions as string[] | undefined) ?? []) {
        await c.env.DB.prepare("INSERT OR IGNORE INTO sched_block_exceptions (block_id, date) VALUES (?, ?)").bind(b.id, d).run();
      }
    }
    const { insertPlan, snapshotWorkingCopy, latestPlanRow } = await import("../lib/scheduler/plans");
    const prev = await latestPlanRow(c.env.DB, ch.id);
    const plan = await insertPlan(c.env.DB, { channelId: ch.id, snapshot: await snapshotWorkingCopy(c.env.DB, ch.id), summary: "Test grid", actor: "studio", effectiveFromMs: now, versionId: null, basedOn: prev?.number ?? null });
    return c.json({ ok: true, count: blocks.length, plan: plan.number });
  });

  // The governing timeline between two instants.
  r.get("/timeline", async (c) => {
    const ch = await chan(c.env, c.req.query("channel"));
    if (!ch) return c.json({ error: "no channel" }, 404);
    const items = await itemsBetween(c.env.DB, ch.id, Number(c.req.query("from")), Number(c.req.query("to")));
    return c.json({ items });
  });

  // Plan N days in memory and check hard starts, silence, fades and repeats.
  r.get("/grid-check", async (c) => {
    const ch = await chan(c.env, c.req.query("channel"));
    if (!ch) return c.json({ error: "no channel" }, 404);
    const now = Number(c.req.query("now")) || Date.now();
    const days = Math.min(8, Number(c.req.query("days")) || 7);
    const blocks = await loadGridBlocks(c.env.DB, ch.id);
    const plan = await new Planner(c.env.DB, c.env.CONFIG, ch, blocks, now).build(now, now + days * 86400_000);
    const items = plan.items;
    let gaps = 0;
    let maxFade = 0;
    let longFades = 0;
    for (let i = 1; i < items.length; i++) if (items[i].startsAt !== items[i - 1].endsAt) gaps++;
    const fadeDetails: unknown[] = [];
    for (const i of items) {
      const fade = i.fileMs - i.offset - (i.endsAt - i.startsAt);
      if (fade > 0) {
        maxFade = Math.max(maxFade, fade);
        if (fade > 20_000) {
          longFades++;
          if (fadeDetails.length < 8) fadeDetails.push({ label: i.label, type: i.itemType, source: i.source, block: i.blockId, end: new Date(i.endsAt).toISOString(), fadeS: fade / 1000, reasons: i.reasons.slice(-1) });
        }
      }
    }
    const end = items[items.length - 1].endsAt;
    const occs = occurrencesBetween(blocks, now, plan.toMs).filter((o) => o.startMs > now && o.startMs < end);
    const hard = occs.map((o) => {
      const first = items.find((i) => i.startsAt === o.startMs);
      const before = items.find((i) => i.endsAt === o.startMs);
      return { block: o.block.name, date: o.date, start: new Date(o.startMs).toISOString(), end: new Date(o.endMs).toISOString(), startsOnTime: !!first && first.blockId === o.block.id, previousEndsOnTime: !!before };
    });
    // Songs repeating within 2 h where the later one is in an autopilot block (programme blocks loop by design).
    const repeats: unknown[] = [];
    const last = new Map<string, (typeof items)[number]>();
    for (const i of items) {
      if (i.itemType !== "song" || !i.trackId) continue;
      const prev = last.get(i.trackId);
      if (prev && i.startsAt - prev.startsAt < 2 * 3600_000 && i.blockId && i.source === "autopilot") {
        repeats.push({ label: i.label, at: new Date(i.startsAt).toISOString(), block: i.blockId, why: i.reasons.slice(-1), prevAt: new Date(prev.startsAt).toISOString(), prevBlock: prev.blockId, prevWhy: prev.reasons.slice(-1) });
      }
      last.set(i.trackId, i);
    }
    const byOcc: Record<string, string[]> = {};
    for (const i of items) if (i.blockId) (byOcc[`${i.blockId}:${i.blockDate}`] ??= []).push(i.trackId ?? i.assetId ?? "");
    return c.json({
      items: items.length,
      gaps,
      maxFadeMs: maxFade,
      longFades,
      fadeDetails,
      occurrences: hard.length,
      hardStartFailures: hard.filter((h) => !h.startsOnTime || !h.previousEndsOnTime),
      hardStarts: hard.slice(0, 40),
      repeatCount: repeats.length,
      repeats: repeats.slice(0, 10),
      firstSongs: Object.fromEntries(Object.entries(byOcc).map(([k, v]) => [k, v.slice(0, 3)])),
    });
  });
}
