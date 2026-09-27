import { Hono, type Context } from "hono";
import type { Channel, Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";
import { requireSameOrigin } from "../lib/origin";
import { runAction, type ActionRequest } from "../lib/scheduler/actions";
import { buildFromPlan, latestVersion, nextBoundary, HORIZON_MS, type SchedChannelRow } from "../lib/scheduler/generate";
import { DAY_KEYS, loadGridBlocks, occurrenceOn, type GridBlock } from "../lib/scheduler/grid";
import { overlapWith, parseBlockInput, validateBlock } from "../lib/scheduler/gridEdit";
import { channelHealth, gridStatus, LIVE_CONTROL_KINDS, type HealthCheck } from "../lib/scheduler/health";
import { fallbackLoop } from "../lib/scheduler/read";
import { liveMax, logChange, type VersionRow } from "../lib/scheduler/store";
import { addDaysTo, DAY, HOUR, MINUTE, parisDate, parisDayTime, weekdayIndex } from "../lib/scheduler/time";
import { clearTimelineCache, itemsBetween, type TimelineItem } from "../lib/scheduler/timeline";
import { autopilotTracks, channelTags, enrichItems } from "../lib/station";
import type { RotationItem } from "../lib/radioBrain";

/**
 * The Studio's Scheduler API (/studio/api/scheduler, behind the Studio
 * session). Every change goes through the versioned path (store.ts) inside
 * the request, and POSTs must come from our own pages.
 */
export const schedulerRoutes = new Hono<{ Bindings: Env }>();
schedulerRoutes.use("*", requireSameOrigin);

type Ctx = Context<{ Bindings: Env }>;

async function channelBySlug(db: D1Database, slug: string) {
  return db.prepare("SELECT * FROM channels WHERE slug = ?").bind(slug).first<Channel>();
}
async function schedRow(db: D1Database, channelId: string) {
  await db.prepare("INSERT OR IGNORE INTO sched_channels (channel_id, enabled) VALUES (?, 0)").bind(channelId).run();
  return (await db.prepare("SELECT * FROM sched_channels WHERE channel_id = ?").bind(channelId).first<SchedChannelRow>())!;
}

const SHADOW_NEEDED_MS = 24 * HOUR;

/** Can this channel be put on air? (24 h of shadow checks, none mismatched in the last 24 h, and a log.) */
function eligibility(sc: SchedChannelRow, hasLog: boolean, nowMs: number): { ok: boolean; reason: string } {
  if (!hasLog) return { ok: false, reason: "There's no log for this channel yet." };
  if (!sc.shadow_since_ms || !sc.shadow_checks) return { ok: false, reason: "Shadow checks haven't started yet." };
  const since = nowMs - sc.shadow_since_ms;
  if (since < SHADOW_NEEDED_MS) {
    const left = Math.ceil((SHADOW_NEEDED_MS - since) / HOUR);
    return { ok: false, reason: `Needs 24 hours of shadow checks: about ${left} h to go.` };
  }
  if (sc.shadow_last_mismatch_ms && nowMs - sc.shadow_last_mismatch_ms < SHADOW_NEEDED_MS) {
    return { ok: false, reason: `There was a mismatch at ${parisDayTime(sc.shadow_last_mismatch_ms)}; it needs 24 hours without one.` };
  }
  return { ok: true, reason: "24 hours of shadow checks with no mismatches." };
}

async function cachedHealth(env: Env, channel: Channel, sc: SchedChannelRow, nowMs: number, fresh = false): Promise<HealthCheck[]> {
  if (!fresh) {
    const hit = (await env.CONFIG.get(`sched:health:${channel.id}`, "json")) as { at: number; checks: HealthCheck[] } | null;
    if (hit && nowMs - hit.at < 10 * MINUTE) return hit.checks;
  }
  const checks = await channelHealth(env, channel, sc, nowMs);
  await env.CONFIG.put(`sched:health:${channel.id}`, JSON.stringify({ at: nowMs, checks }), { expirationTtl: 3600 });
  return checks;
}
const worst = (checks: HealthCheck[]) =>
  checks.some((c) => c.level === "red") ? "red" : checks.some((c) => c.level === "amber") ? "amber" : checks.every((c) => c.level === "grey") ? "grey" : "green";

// ------------------------------------------------------------------ items as JSON

interface Lookups {
  blocks: Map<string, GridBlock>;
  programmes: Map<string, string>;
  assetTypes: Map<string, string>;
}

async function lookupsFor(db: D1Database, channelId: string, items: TimelineItem[]): Promise<Lookups> {
  const blocks = new Map((await loadGridBlocks(db, channelId, true)).map((b) => [b.id, b]));
  const progIds = [...new Set(items.filter((i) => i.source === "programme" && i.sourceRef).map((i) => i.sourceRef!))];
  const programmes = new Map<string, string>();
  for (let i = 0; i < progIds.length; i += 90) {
    const chunk = progIds.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT id, title FROM programmes WHERE id IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).all<{ id: string; title: string }>();
    for (const r of results) programmes.set(r.id, r.title);
  }
  const assetIds = [...new Set(items.map((i) => i.assetId).filter((x): x is string => !!x))];
  const assetTypes = new Map<string, string>();
  for (let i = 0; i < assetIds.length; i += 90) {
    const chunk = assetIds.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT id, type FROM audio_assets WHERE id IN (${chunk.map(() => "?").join(",")})`).bind(...chunk).all<{ id: string; type: string }>();
    for (const r of results) assetTypes.set(r.id, r.type);
  }
  return { blocks, programmes, assetTypes };
}

function chipFor(i: TimelineItem, L: Lookups): string {
  if (i.source === "capsule") return "CAPSULE";
  if (i.trackId) return "SONG";
  const t = i.assetId ? L.assetTypes.get(i.assetId) : undefined;
  if (t === "promo") return "PROMO";
  if (t === "link") return "LINK";
  if (t === "feature" || t === "interview") return "FEATURE";
  return "JINGLE";
}

function sourceLine(i: TimelineItem, channel: Channel, L: Lookups): string {
  if (i.source === "override") return "Added by you";
  if (i.source === "capsule") return "Time capsule";
  if (i.source === "fallback") return "Emergency playlist";
  const block = i.blockId ? L.blocks.get(i.blockId) : undefined;
  if (block) return `${block.name} block`;
  if (i.source === "programme") return `Programme · ${L.programmes.get(i.sourceRef ?? "") ?? "a programme"}`;
  return `Autopilot · ${channel.name}`;
}

function itemJson(i: TimelineItem & { artist?: string | null; album_title?: string | null }, channel: Channel, L: Lookups) {
  const end = Math.min(i.endsAt, i.cutAt ?? Infinity);
  const block = i.blockId ? L.blocks.get(i.blockId) : undefined;
  return {
    airing_id: i.airingId,
    starts_at_ms: i.startsAt,
    ends_at_ms: end,
    offset_ms: i.offset,
    file_ms: i.fileMs,
    trimmed_ms: Math.max(0, i.fileMs - i.offset - (i.endsAt - i.startsAt)),
    item_type: i.itemType,
    chip: chipFor(i, L),
    label: i.label,
    artist: i.artist ?? null,
    album: i.album_title ?? null,
    artwork_url: i.artworkUrl,
    track_id: i.trackId,
    audio_asset_id: i.assetId,
    source: i.source,
    source_line: sourceLine(i, channel, L),
    reasons: i.reasons,
    block: block ? { id: block.id, name: block.name, colour: block.colour } : null,
    version: i.versionNumber,
  };
}

async function enrichTimeline(db: D1Database, items: TimelineItem[]) {
  const enriched = await enrichItems(
    db,
    items.map((i): RotationItem => ({ id: i.airingId!, item_type: i.itemType, label: i.label, track_id: i.trackId, audio_asset_id: i.assetId, duration_seconds: 0, audio_url: null, artwork_url: i.artworkUrl }))
  );
  return items.map((i, k) => ({ ...i, artist: enriched[k].artist ?? null, album_title: enriched[k].album_title ?? null, artworkUrl: enriched[k].artwork_url ?? i.artworkUrl }));
}

// ------------------------------------------------------------------ overview

schedulerRoutes.get("/overview", async (c) => {
  const now = Date.now();
  const { results: channels } = await c.env.DB.prepare("SELECT * FROM channels ORDER BY status = 'live' DESC, name").all<Channel>();
  const out = [];
  for (const ch of channels) {
    const sc = await schedRow(c.env.DB, ch.id);
    const latest = await latestVersion(c.env.DB, ch.id);
    const checks = await cachedHealth(c.env, ch, sc, now);
    const items = latest ? await itemsBetween(c.env.DB, ch.id, now, now + 1) : [];
    const on = items.find((i) => i.startsAt <= now && now < Math.min(i.endsAt, i.cutAt ?? Infinity));
    const g = await gridStatus(c.env.DB, ch.id, now);
    const L = await lookupsFor(c.env.DB, ch.id, on ? [on] : []);
    const state = sc.enabled ? (sc.on_fallback_since_ms ? "fallback" : "scheduler") : "shadow";
    out.push({
      id: ch.id,
      slug: ch.slug,
      name: ch.name,
      emoji: ch.emoji,
      status: ch.status,
      mode: ch.programming_mode,
      enabled: !!sc.enabled,
      state: ch.status !== "live" && !latest ? "not_live" : state,
      live_version: latest?.number ?? 0,
      horizon_ms: latest?.horizon_ms ?? null,
      shadow: {
        checks: sc.shadow_checks,
        mismatches: sc.shadow_mismatches,
        since_ms: sc.shadow_since_ms,
        eligibility: eligibility(sc, !!latest, now),
      },
      on_air: on ? itemJson(on, ch, L) : null,
      grid: {
        has_grid: g.hasGrid,
        now: g.now ? { name: g.now.block.name, description: g.now.block.description, start_ms: g.now.startMs, end_ms: g.now.endMs, colour: g.now.block.colour } : null,
        next: g.next ? { name: g.next.block.name, start_ms: g.next.startMs } : null,
        mismatch: sc.enabled && !g.matches ? { expected: g.now?.block.name ?? "Channel default" } : null,
      },
      health: worst(checks),
      health_counts: { red: checks.filter((x) => x.level === "red").length, amber: checks.filter((x) => x.level === "amber").length },
    });
  }
  return c.json({ now_ms: now, channels: out });
});

schedulerRoutes.get("/health", async (c) => {
  const now = Date.now();
  const fresh = c.req.query("fresh") === "1";
  const { results: channels } = await c.env.DB.prepare("SELECT * FROM channels ORDER BY name").all<Channel>();
  const checks: HealthCheck[] = [];
  for (const ch of channels) checks.push(...(await cachedHealth(c.env, ch, await schedRow(c.env.DB, ch.id), now, fresh)));
  const order = { red: 0, amber: 1, green: 2, grey: 3 };
  checks.sort((a, b) => order[a.level] - order[b.level]);
  return c.json({ now_ms: now, checks });
});

// ------------------------------------------------------------------ one channel

schedulerRoutes.get("/channels/:slug/timeline", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const now = Date.now();
  const minutes = Math.min(24 * 60, Math.max(10, Number(c.req.query("minutes")) || 120));
  const sc = await schedRow(c.env.DB, ch.id);
  const latest = await latestVersion(c.env.DB, ch.id);
  const raw = latest ? await itemsBetween(c.env.DB, ch.id, now - 5 * MINUTE, now + minutes * MINUTE) : [];
  const items = await enrichTimeline(c.env.DB, raw);
  const L = await lookupsFor(c.env.DB, ch.id, items);
  const idx = items.findIndex((i) => i.startsAt <= now && now < Math.min(i.endsAt, i.cutAt ?? Infinity));
  const on = idx >= 0 ? items[idx] : null;
  const next = idx >= 0 ? items.slice(idx + 1) : items.filter((i) => i.startsAt > now);

  const { results: recent } = await c.env.DB.prepare(
    "SELECT * FROM sched_aired WHERE channel_id = ? AND starts_at_ms < ? ORDER BY starts_at_ms DESC LIMIT 6"
  )
    .bind(ch.id, on ? on.startsAt : now)
    .all<Record<string, unknown>>();

  const g = await gridStatus(c.env.DB, ch.id, now);
  // A live control's recovery in progress: its anchor is still ahead.
  const governing = on ? await c.env.DB.prepare("SELECT * FROM sched_versions WHERE id = ?").bind(on.versionId).first<VersionRow>() : null;
  const recovery =
    governing && LIVE_CONTROL_KINDS.includes(governing.kind) && governing.anchor_ms && governing.anchor_ms > now
      ? { anchor_ms: governing.anchor_ms, kind: governing.kind }
      : null;

  return c.json({
    now_ms: now,
    channel: ch,
    enabled: !!sc.enabled,
    fallback: !!sc.on_fallback_since_ms,
    live_version: latest?.number ?? 0,
    horizon_ms: latest?.horizon_ms ?? null,
    on_air: on ? itemJson(on, ch, L) : null,
    up_next: next.map((i) => itemJson(i, ch, L)),
    recent: recent.slice(0, 5),
    grid: {
      now: g.now ? { id: g.now.block.id, name: g.now.block.name, description: g.now.block.description, start_ms: g.now.startMs, end_ms: g.now.endMs, colour: g.now.block.colour } : null,
      next: g.next ? { name: g.next.block.name, start_ms: g.next.startMs } : null,
      mismatch: sc.enabled && !g.matches ? { expected: g.now?.block.name ?? "Channel default" } : null,
    },
    recovery,
  });
});

schedulerRoutes.post("/channels/:slug/actions", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const sc = await schedRow(c.env.DB, ch.id);
  if (!sc.enabled) return c.json({ error: "not_enabled", message: "Live controls work once the Scheduler is on air for this channel." }, 409);
  const body = await c.req.json<ActionRequest>().catch(() => null);
  if (!body?.action) return c.json({ error: "bad_request", message: "Missing action." }, 400);
  const result = await runAction(c.env, ch, { ...body, expected_version: Number(body.expected_version) });
  if (!result.ok) return c.json({ error: result.error, message: result.message, live_version: await liveMax(c.env.DB, ch.id) }, result.status);
  return c.json({ ok: true, version: result.version.number, previous: result.version.number - 1, message: result.message });
});

schedulerRoutes.post("/channels/:slug/versions/:number/rollback", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const sc = await schedRow(c.env.DB, ch.id);
  if (!sc.enabled) return c.json({ error: "not_enabled", message: "Rollback works once the Scheduler is on air for this channel." }, 409);
  const body = await c.req.json<{ expected_version?: number }>().catch(() => ({}) as { expected_version?: number });
  const result = await runAction(c.env, ch, { action: "rollback", expected_version: Number(body.expected_version), number: Number(c.req.param("number")) });
  if (!result.ok) return c.json({ error: result.error, message: result.message, live_version: await liveMax(c.env.DB, ch.id) }, result.status);
  return c.json({ ok: true, version: result.version.number, previous: result.version.number - 1, message: result.message });
});

// Record a link: the Studio records in the browser (WAV, up to 120 s) and posts it here.
schedulerRoutes.post("/channels/:slug/record-link", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const sc = await schedRow(c.env.DB, ch.id);
  if (!sc.enabled) return c.json({ error: "not_enabled", message: "Live controls work once the Scheduler is on air for this channel." }, 409);
  const form = await c.req.parseBody().catch(() => null);
  const file = form?.audio;
  const seconds = Math.round(Number(form?.duration_seconds));
  if (!(file instanceof File) || file.size === 0) return c.json({ error: "bad_request", message: "No recording received." }, 400);
  if (!(seconds >= 1 && seconds <= 125)) return c.json({ error: "bad_request", message: "Recordings can be up to 2 minutes." }, 400);
  if (file.size > 25 * 1024 * 1024) return c.json({ error: "too_large", message: "That recording is too big." }, 413);

  const id = newId("aa");
  const key = `audio/live-link-${id}.wav`;
  await c.env.MEDIA.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: "audio/wav" } });
  const title = `Live link · ${parisDayTime(Date.now())}`;
  // link_kind stays NULL: Radio That Knows You only uses links that have a kind, so live links never leak into it.
  await c.env.DB.prepare(
    `INSERT INTO audio_assets (id, type, title, audio_url, duration_seconds, description, status, link_kind, created_at)
     VALUES (?, 'link', ?, ?, ?, ?, 'published', NULL, ?)`
  )
    .bind(id, title, key, seconds, `Recorded live in Master Control for ${ch.name}`, nowIso())
    .run();
  const result = await runAction(c.env, ch, {
    action: "record_link",
    expected_version: Number(form?.expected_version),
    item: { audio_asset_id: id },
  });
  if (!result.ok) return c.json({ error: result.error, message: result.message, asset_id: id, live_version: await liveMax(c.env.DB, ch.id) }, result.status);
  return c.json({ ok: true, version: result.version.number, previous: result.version.number - 1, message: result.message, asset_id: id });
});

schedulerRoutes.get("/channels/:slug/versions", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const before = Number(c.req.query("before")) || Number.MAX_SAFE_INTEGER;
  const { results } = await c.env.DB.prepare(
    `SELECT id, number, kind, actor, summary, item_count, effective_from_ms, horizon_ms, published_at_ms, rollback_of_version_id, based_on_version_id
     FROM sched_versions WHERE channel_id = ? AND status = 'published' AND number < ? ORDER BY number DESC LIMIT 30`
  )
    .bind(ch.id, before)
    .all<Record<string, unknown>>();
  const { results: failed } = await c.env.DB.prepare(
    `SELECT id, kind, actor, summary, error, created_at_ms FROM sched_versions
     WHERE channel_id = ? AND status = 'failed' ORDER BY created_at_ms DESC LIMIT 5`
  )
    .bind(ch.id)
    .all<Record<string, unknown>>();
  return c.json({ versions: results, failed, live_version: await liveMax(c.env.DB, ch.id) });
});

// What rolling back to vN would change: its first items from the end of what's on air, next to the live ones.
schedulerRoutes.get("/channels/:slug/versions/:number/preview", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const now = Date.now();
  const v = await c.env.DB.prepare("SELECT * FROM sched_versions WHERE channel_id = ? AND status = 'published' AND number = ?")
    .bind(ch.id, Number(c.req.param("number")))
    .first<VersionRow>();
  if (!v) return c.json({ error: "not_found" }, 404);
  const live = await itemsBetween(c.env.DB, ch.id, now, now + HOUR);
  const { results } = await c.env.DB.prepare("SELECT label, starts_at_ms FROM sched_log_items WHERE version_id = ? AND starts_at_ms >= ? ORDER BY starts_at_ms LIMIT 8")
    .bind(v.id, now)
    .all<{ label: string; starts_at_ms: number }>();
  return c.json({
    version: v.number,
    covers_now: v.horizon_ms > now,
    live: live.slice(0, 8).map((i) => ({ label: i.label, starts_at_ms: i.startsAt })),
    rolled_back: results,
  });
});

schedulerRoutes.get("/channels/:slug/fallback", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT f.position, f.track_id, f.audio_asset_id,
            COALESCE(t.title, a.title) AS title, COALESCE(t.duration_seconds, a.duration_seconds) AS duration_seconds,
            COALESCE(t.status, a.status) AS status, t.artist, a.type AS asset_type
     FROM sched_fallback_items f LEFT JOIN tracks t ON t.id = f.track_id LEFT JOIN audio_assets a ON a.id = f.audio_asset_id
     WHERE f.channel_id = ? ORDER BY f.position`
  )
    .bind(ch.id)
    .all<Record<string, unknown>>();
  const loop = await fallbackLoop(c.env.DB, ch.id);
  return c.json({ items: results, playable_seconds: loop?.total ?? 0, valid: !!loop && loop.total >= 3600 && loop.items.length === results.length });
});

schedulerRoutes.put("/channels/:slug/fallback", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<{ items?: { track_id?: string | null; audio_asset_id?: string | null }[] }>().catch(() => null);
  const items = (body?.items ?? []).slice(0, 200).filter((i) => i.track_id || i.audio_asset_id);
  const stmts = [
    c.env.DB.prepare("DELETE FROM sched_fallback_items WHERE channel_id = ?").bind(ch.id),
    ...items.map((i, n) =>
      c.env.DB.prepare("INSERT INTO sched_fallback_items (channel_id, position, track_id, audio_asset_id) VALUES (?,?,?,?)").bind(ch.id, n + 1, i.track_id ?? null, i.track_id ? null : i.audio_asset_id ?? null)
    ),
  ];
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  await logChange(c.env.DB, { channelId: ch.id, actor: "studio", action: "fallback_set", reason: `Emergency playlist updated by you (${items.length} items)` });
  await c.env.CONFIG.delete(`sched:health:${ch.id}`);
  const loop = await fallbackLoop(c.env.DB, ch.id);
  return c.json({ ok: true, playable_seconds: loop?.total ?? 0, valid: !!loop && loop.total >= 3600 && loop.items.length === items.length });
});

schedulerRoutes.post("/channels/:slug/enable", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<{ enabled?: boolean }>().catch(() => ({}) as { enabled?: boolean });
  const sc = await schedRow(c.env.DB, ch.id);
  const now = Date.now();
  if (body.enabled) {
    const latest = await latestVersion(c.env.DB, ch.id);
    const e = eligibility(sc, !!latest, now);
    if (!e.ok) return c.json({ error: "not_ready", message: e.reason }, 409);
    await c.env.DB.prepare("UPDATE sched_channels SET enabled = 1, enabled_at = ?, on_fallback_since_ms = NULL WHERE channel_id = ?").bind(nowIso(), ch.id).run();
    await logChange(c.env.DB, { channelId: ch.id, actor: "studio", action: "enable", reason: "Scheduler put on air by you" });
  } else {
    await c.env.DB.prepare("UPDATE sched_channels SET enabled = 0, on_fallback_since_ms = NULL WHERE channel_id = ?").bind(ch.id).run();
    await logChange(c.env.DB, { channelId: ch.id, actor: "studio", action: "disable", reason: "Scheduler taken off air by you: back to the old playback" });
  }
  clearTimelineCache(ch.id);
  await c.env.CONFIG.delete(`sched:health:${ch.id}`);
  return c.json({ ok: true, enabled: !!body.enabled });
});

schedulerRoutes.get("/channels/:slug/airing/:airingId/history", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const airing = c.req.param("airingId");
  const first = await c.env.DB.prepare(
    `SELECT li.label, li.starts_at_ms, li.ends_at_ms, li.item_type, li.source, li.reason_json, v.number, v.kind, v.published_at_ms, v.summary
     FROM sched_log_items li JOIN sched_versions v ON v.id = li.version_id
     WHERE li.airing_id = ? AND v.channel_id = ? AND v.status = 'published' ORDER BY v.number ASC LIMIT 1`
  )
    .bind(airing, ch.id)
    .first<Record<string, unknown>>();
  const aired = await c.env.DB.prepare("SELECT * FROM sched_aired WHERE channel_id = ? AND airing_id = ?").bind(ch.id, airing).first<Record<string, unknown>>();
  const { results: changes } = await c.env.DB.prepare(
    `SELECT sc.at_ms, sc.actor, sc.action, sc.reason, sc.before_json, sc.after_json, v.number AS version
     FROM sched_changes sc LEFT JOIN sched_versions v ON v.id = sc.version_id
     WHERE sc.airing_id = ? ORDER BY sc.at_ms`
  )
    .bind(airing)
    .all<Record<string, unknown>>();
  return c.json({ airing_id: airing, scheduled: first, aired, changes });
});

schedulerRoutes.get("/channels/:slug/changes", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT sc.at_ms, sc.actor, sc.action, sc.reason, sc.airing_id, v.number AS version
     FROM sched_changes sc LEFT JOIN sched_versions v ON v.id = sc.version_id
     WHERE sc.channel_id = ? ORDER BY sc.at_ms DESC LIMIT 50`
  )
    .bind(ch.id)
    .all<Record<string, unknown>>();
  return c.json({ changes: results });
});

// ------------------------------------------------------------------ library picker

schedulerRoutes.get("/library", async (c) => {
  const q = `%${(c.req.query("q") ?? "").trim().slice(0, 60)}%`;
  const type = c.req.query("type") ?? "songs";
  const slug = c.req.query("channel");
  const ch = slug ? await channelBySlug(c.env.DB, slug) : null;
  const lastAired = (col: string) =>
    ch ? `(SELECT MAX(starts_at_ms) FROM sched_aired sa WHERE sa.channel_id = '${ch.id.replace(/'/g, "''")}' AND sa.${col} = x.id)` : "NULL";

  if (type === "songs") {
    const { results } = await c.env.DB.prepare(
      `SELECT x.id, x.title, x.artist, x.duration_seconds, al.title AS album, ${lastAired("track_id")} AS last_aired_ms
       FROM tracks x LEFT JOIN albums al ON al.id = x.album_id
       WHERE x.status = 'published' AND (x.title LIKE ?1 OR COALESCE(x.artist, '') LIKE ?1 OR COALESCE(al.title, '') LIKE ?1)
       ORDER BY x.title LIMIT 40`
    )
      .bind(q)
      .all<Record<string, unknown>>();
    return c.json({ results: results.map((r) => ({ ...r, kind: "song", track_id: r.id })) });
  }
  const types: Record<string, string[]> = { ids: ["station_id", "jingle"], promos: ["promo"], links: ["link"], capsules: ["feature"] };
  const wanted = types[type] ?? types.ids;
  const capsuleOnly = type === "capsules" ? "AND EXISTS (SELECT 1 FROM time_capsules tc WHERE tc.audio_asset_id = x.id)" : "";
  const { results } = await c.env.DB.prepare(
    `SELECT x.id, x.title, x.type, x.duration_seconds, ${lastAired("audio_asset_id")} AS last_aired_ms
     FROM audio_assets x
     WHERE x.status = 'published' AND x.type IN (${wanted.map(() => "?").join(",")}) AND x.title LIKE ? ${capsuleOnly}
     ORDER BY x.created_at DESC LIMIT 40`
  )
    .bind(...wanted, q)
    .all<Record<string, unknown>>();
  return c.json({ results: results.map((r) => ({ ...r, kind: r.type, audio_asset_id: r.id })) });
});

// The station IDs, jingles and promos aired most on a channel in the last 30 days (the Insert jingle chips).
schedulerRoutes.get("/channels/:slug/top-jingles", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id AS audio_asset_id, a.title, a.type, a.duration_seconds, COUNT(sa.id) AS plays
     FROM audio_assets a LEFT JOIN sched_aired sa ON sa.audio_asset_id = a.id AND sa.channel_id = ? AND sa.starts_at_ms > ?
     WHERE a.status = 'published' AND a.type IN ('station_id','jingle','promo')
     GROUP BY a.id ORDER BY plays DESC, a.created_at DESC LIMIT 4`
  )
    .bind(ch.id, Date.now() - 30 * DAY)
    .all<Record<string, unknown>>();
  return c.json({ results });
});

// ------------------------------------------------------------------ the weekly grid

async function gridPayload(env: Env, ch: Channel, nowMs: number) {
  const blocks = await loadGridBlocks(env.DB, ch.id, true);
  // This week, Monday to Sunday (Paris), each day's occurrences.
  const today = parisDate(nowMs);
  const monday = addDaysTo(today, -weekdayIndex(today));
  const days = DAY_KEYS.map((key, i) => {
    const date = addDaysTo(monday, i);
    return {
      key,
      date,
      occurrences: blocks
        .filter((b) => b.active)
        .map((b) => occurrenceOn(b, date))
        .filter((o): o is NonNullable<typeof o> => !!o)
        .map((o) => ({ block_id: o.block.id, start_ms: o.startMs, end_ms: o.endMs })),
    };
  });
  const programmes = (
    await env.DB.prepare(
      `SELECT p.id, p.title, p.duration_seconds, (SELECT COUNT(*) FROM programme_items pi WHERE pi.programme_id = p.id) AS items
       FROM programmes p WHERE p.status = 'published' ORDER BY p.channel_id = ? DESC, p.updated_at DESC LIMIT 200`
    )
      .bind(ch.id)
      .all<Record<string, unknown>>()
  ).results;
  const tags = (await env.DB.prepare("SELECT name FROM tags ORDER BY name").all<{ name: string }>()).results.map((t) => t.name);
  return {
    channel: ch,
    blocks: blocks.map((b) => ({ ...b, tags_any: b.tags_any_json ? JSON.parse(b.tags_any_json) : [] })),
    week: days,
    programmes,
    tags,
    channel_tags: channelTags(ch),
    now_ms: nowMs,
  };
}

schedulerRoutes.get("/channels/:slug/grid", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const sc = await schedRow(c.env.DB, ch.id);
  return c.json({ ...(await gridPayload(c.env, ch, Date.now())), enabled: !!sc.enabled, live_version: await liveMax(c.env.DB, ch.id) });
});

schedulerRoutes.get("/channels/:slug/grid/now", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const g = await gridStatus(c.env.DB, ch.id, Date.now());
  return c.json({
    now: g.now ? { name: g.now.block.name, description: g.now.block.description, start_ms: g.now.startMs, end_ms: g.now.endMs } : null,
    next: g.next ? { name: g.next.block.name, start_ms: g.next.startMs } : null,
    matches: g.matches,
  });
});

// How many tracks match some tags, and roughly how long before a repeat.
schedulerRoutes.get("/pool", async (c) => {
  const tags = (c.req.query("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const slug = c.req.query("channel");
  const ch = slug ? await channelBySlug(c.env.DB, slug) : null;
  const tracks = await autopilotTracks(c.env.DB, tags.length ? tags : ch ? channelTags(ch) : []);
  const seconds = tracks.reduce((s, t) => s + t.duration_seconds, 0);
  return c.json({ tracks: tracks.length, seconds });
});

/**
 * Apply a grid change: write it, then regenerate from the end of the airing
 * on now (never mid-song). If the new log can't be built, the change is
 * undone and nothing live changes.
 */
async function applyGridChange(c: Ctx, ch: Channel, write: () => Promise<void>, undo: () => Promise<void>, summary: string) {
  const sc = await schedRow(c.env.DB, ch.id);
  if (!sc.enabled) return c.json({ error: "locked", message: "The weekly grid unlocks once the Scheduler is on air for this channel." }, 409);
  const now = Date.now();
  await write();
  const from = await nextBoundary(c.env.DB, ch.id, now);
  const latest = await latestVersion(c.env.DB, ch.id);
  const out = await buildFromPlan(c.env, ch, {
    kind: "grid", actor: "studio", from, to: Math.max(latest?.horizon_ms ?? 0, now + HORIZON_MS), nowMs: now,
    summary: () => summary,
  });
  if (out.status !== "published") {
    await undo();
    return c.json({ error: "build_failed", message: `Not saved: ${out.status === "failed" ? out.error : "nothing to schedule"}. Nothing live changed.` }, 400);
  }
  clearTimelineCache(ch.id);
  await c.env.CONFIG.delete(`sched:health:${ch.id}`);
  await logChange(c.env.DB, { channelId: ch.id, versionId: out.version.id, actor: "studio", action: "grid", reason: summary });
  return c.json({ ok: true, version: out.version.number, live_from_ms: from, ...(await gridPayload(c.env, ch, now)) });
}

const blockRow = (id: string, channelId: string, v: ReturnType<typeof parseBlockInput> & { ok: true }, created: number, now: number) => ({
  id, channel_id: channelId, name: v.value.name, description: v.value.description, days_mask: v.value.days_mask, start_min: v.value.start_min,
  end_min: v.value.end_min, fill_kind: v.value.fill_kind, programme_id: v.value.programme_id, tags_any_json: JSON.stringify(v.value.tags_any),
  colour: v.value.colour, active: v.value.active ? 1 : 0, created_at_ms: created, updated_at_ms: now,
});

async function upsertBlock(db: D1Database, b: GridBlock) {
  await db
    .prepare(
      `INSERT INTO sched_grid_blocks (id, channel_id, name, description, days_mask, start_min, end_min, fill_kind, programme_id, tags_any_json, colour, active, created_at_ms, updated_at_ms)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, days_mask = excluded.days_mask,
         start_min = excluded.start_min, end_min = excluded.end_min, fill_kind = excluded.fill_kind, programme_id = excluded.programme_id,
         tags_any_json = excluded.tags_any_json, colour = excluded.colour, active = excluded.active, updated_at_ms = excluded.updated_at_ms`
    )
    .bind(b.id, b.channel_id, b.name, b.description, b.days_mask, b.start_min, b.end_min, b.fill_kind, b.programme_id, b.tags_any_json, b.colour, b.active, b.created_at_ms, b.updated_at_ms)
    .run();
}

schedulerRoutes.post("/channels/:slug/grid", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const parsed = parseBlockInput(body);
  if (!parsed.ok) return c.json({ error: "invalid", field: parsed.field, message: parsed.message }, 400);
  const others = await loadGridBlocks(c.env.DB, ch.id, true);
  const check = await validateBlock(c.env.DB, ch, parsed.value, others);
  if (check.errors.length) return c.json({ error: "invalid", field: check.errors[0].field, message: check.errors[0].message }, 400);
  if (check.warnings.length && body.force !== true) return c.json({ error: "warning", message: check.warnings[0], needs_force: true }, 409);
  const now = Date.now();
  const row = blockRow(newId("blk"), ch.id, parsed, now, now) as GridBlock;
  return applyGridChange(c, ch, () => upsertBlock(c.env.DB, row), () => c.env.DB.prepare("DELETE FROM sched_grid_blocks WHERE id = ?").bind(row.id).run().then(() => {}), `Grid: added ${row.name}`);
});

schedulerRoutes.put("/channels/:slug/grid/:blockId", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const existing = await c.env.DB.prepare("SELECT * FROM sched_grid_blocks WHERE id = ? AND channel_id = ?").bind(c.req.param("blockId"), ch.id).first<GridBlock>();
  if (!existing) return c.json({ error: "not_found", message: "That block no longer exists." }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const parsed = parseBlockInput(body);
  if (!parsed.ok) return c.json({ error: "invalid", field: parsed.field, message: parsed.message }, 400);
  const others = (await loadGridBlocks(c.env.DB, ch.id, true)).filter((b) => b.id !== existing.id);
  const check = await validateBlock(c.env.DB, ch, parsed.value, others);
  if (check.errors.length) return c.json({ error: "invalid", field: check.errors[0].field, message: check.errors[0].message }, 400);
  if (check.warnings.length && body.force !== true) return c.json({ error: "warning", message: check.warnings[0], needs_force: true }, 409);
  const row = blockRow(existing.id, ch.id, parsed, existing.created_at_ms, Date.now()) as GridBlock;
  return applyGridChange(c, ch, () => upsertBlock(c.env.DB, row), () => upsertBlock(c.env.DB, existing), `Grid: changed ${row.name}`);
});

schedulerRoutes.delete("/channels/:slug/grid/:blockId", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const existing = await c.env.DB.prepare("SELECT * FROM sched_grid_blocks WHERE id = ? AND channel_id = ?").bind(c.req.param("blockId"), ch.id).first<GridBlock>();
  if (!existing) return c.json({ error: "not_found", message: "That block no longer exists." }, 404);
  return applyGridChange(
    c,
    ch,
    () => c.env.DB.prepare("DELETE FROM sched_grid_blocks WHERE id = ?").bind(existing.id).run().then(() => {}),
    () => upsertBlock(c.env.DB, existing),
    `Grid: removed ${existing.name}`
  );
});

// Copy one day's blocks to other days (replacing what those days had).
schedulerRoutes.post("/channels/:slug/grid/copy-day", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.param("slug"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const body = await c.req.json<{ from?: string; to?: string[] }>().catch(() => ({}) as { from?: string; to?: string[] });
  const fromIdx = DAY_KEYS.indexOf(body.from as (typeof DAY_KEYS)[number]);
  const toIdx = (body.to ?? []).map((d) => DAY_KEYS.indexOf(d as (typeof DAY_KEYS)[number])).filter((i) => i >= 0 && i !== fromIdx);
  if (fromIdx < 0 || toIdx.length === 0) return c.json({ error: "invalid", message: "Choose a day to copy and the days to copy it to." }, 400);
  const targetMask = toIdx.reduce((m, i) => m | (1 << i), 0);
  const before = await loadGridBlocks(c.env.DB, ch.id, true);
  const after = before
    .map((b) => {
      let mask = b.days_mask & ~targetMask; // clear the target days
      if (b.days_mask & (1 << fromIdx)) mask |= targetMask; // then the source day's blocks run on them
      return { ...b, days_mask: mask, updated_at_ms: Date.now() };
    });
  // No overlaps allowed after the copy.
  for (const b of after.filter((x) => x.active && x.days_mask)) {
    const clash = overlapWith(b, after.filter((x) => x.id !== b.id && x.days_mask));
    if (clash) return c.json({ error: "invalid", message: `${b.name} would overlap ${clash.name}.` }, 400);
  }
  const names = toIdx.map((i) => DAY_KEYS[i]).join(", ");
  return applyGridChange(
    c,
    ch,
    async () => {
      for (const b of after) {
        if (b.days_mask) await upsertBlock(c.env.DB, b);
        else await c.env.DB.prepare("DELETE FROM sched_grid_blocks WHERE id = ?").bind(b.id).run();
      }
    },
    async () => {
      for (const b of before) await upsertBlock(c.env.DB, b);
    },
    `Grid: copied ${DAY_KEYS[fromIdx]} to ${names}`
  );
});

