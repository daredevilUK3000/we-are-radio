import { Hono } from "hono";
import type { Channel, Env } from "../lib/types";
import { locateInLoop } from "../lib/radioBrain";
import { loadStationLoop } from "../lib/station";
import { Planner } from "../lib/scheduler/plan";
import { loadGridBlocks } from "../lib/scheduler/grid";
import { stationDate } from "../lib/scheduler/time";
import { itemAt } from "../lib/scheduler/timeline";
import { registerDevTools } from "./schedulerDevTools";

/**
 * Local test hooks for the Scheduler. Mounted only when SCHED_DEV = "1",
 * which is set on the command line for `wrangler dev` and never in
 * wrangler.toml, so production never has these routes.
 */
export const schedulerDevRoutes = new Hono<{ Bindings: Env }>();

schedulerDevRoutes.use("*", async (c, next) => {
  if (c.env.SCHED_DEV !== "1") return c.json({ error: "not_found" }, 404);
  await next();
});

/** Old arithmetic: what /now-playing returned at t (content and position in seconds). */
async function oldAt(env: Env, channel: Channel, t: number) {
  const loop = await loadStationLoop(env.DB, env.CONFIG, channel, { capsuleDate: stationDate(t), nowMs: t });
  if (!loop.items) return null;
  const elapsed = Math.floor(((t - loop.anchorMs) / 1000) % (loop.loopMs / 1000));
  const { currentIndex, position_seconds } = locateInLoop(loop.items, elapsed);
  const it = loop.items[currentIndex];
  return { key: it.track_id ? `t:${it.track_id}` : `a:${it.audio_asset_id}`, pos: position_seconds, label: it.label };
}

// GET /dayparts?channel=<slug>&from=<ms>&hours=48 - the plan with each song's time-of-day tags,
// and every song that starts in a time of day it isn't tagged for (should be none).
schedulerDevRoutes.get("/dayparts", async (c) => {
  const channel = await c.env.DB.prepare("SELECT * FROM channels WHERE slug = ?").bind(c.req.query("channel")).first<Channel>();
  if (!channel) return c.json({ error: "no such channel" }, 404);
  const from = Number(c.req.query("from")) || Date.now();
  const hours = Math.min(96, Number(c.req.query("hours")) || 48);
  const { songBands, TIME_BANDS } = await import("../lib/scheduler/dayparts");
  const { wallClock } = await import("../lib/scheduler/time");
  const bands = await songBands(c.env.DB);
  const bandAt = (ms: number) => {
    const h = Math.floor(wallClock(ms, "Europe/Paris").minutes / 60);
    return h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "afternoon" : h >= 17 && h < 22 ? "evening" : "night";
  };
  const planner = new Planner(c.env.DB, c.env.CONFIG, channel, await loadGridBlocks(c.env.DB, channel.id), from);
  const { items } = await planner.build(from, from + hours * 3_600_000);
  const rows = items.map((i) => {
    const tags = i.trackId ? [...(bands.get(i.trackId) ?? [])] : [];
    const band = bandAt(i.startsAt);
    return { at: wallClock(i.startsAt, "Europe/Paris"), type: i.itemType, label: i.label, tags, band, ok: tags.length === 0 || tags.includes(band as never), blockId: i.blockId };
  });
  const songs = rows.filter((r) => r.type === "song");
  const perBand = Object.fromEntries(TIME_BANDS.map((b) => [b, new Set(songs.filter((r) => r.band === b).map((r) => r.label)).size]));
  return c.json({ items: rows.length, songs: songs.length, wrong_time: songs.filter((r) => !r.ok), distinct_songs_per_band: perBand, sample: rows.slice(0, 400) });
});

// GET /equivalence?now=<ms>&samples=500[&stored=1]
// stored=1 reads itemAt() from the published log instead of the in-memory plan.
schedulerDevRoutes.get("/equivalence", async (c) => {
  const now = Number(c.req.query("now")) || Date.now();
  const samples = Math.min(2000, Number(c.req.query("samples")) || 500);
  const stored = c.req.query("stored") === "1";
  const { results: channels } = await c.env.DB.prepare("SELECT * FROM channels ORDER BY slug").all<Channel>();

  // Seeded sample times so a rerun checks the same instants.
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const times = Array.from({ length: samples }, () => now + Math.floor(rand() * 48 * 3600 * 1000)).sort((a, b) => a - b);

  const report: Record<string, unknown> = {};
  for (const ch of channels) {
    const started = Date.now();
    let plan: Awaited<ReturnType<Planner["build"]>> | null = null;
    let planError: string | null = null;
    if (!stored) {
      try {
        plan = await new Planner(c.env.DB, c.env.CONFIG, ch, await loadGridBlocks(c.env.DB, ch.id), now).build(now, now + 48 * 3600 * 1000);
      } catch (err) {
        planError = err instanceof Error ? err.message : String(err);
      }
    }
    let checked = 0;
    let mismatches = 0;
    let bothOffAir = 0;
    const examples: unknown[] = [];
    for (const t of times) {
      const old = await oldAt(c.env, ch, t);
      let mine: { key: string; pos: number; label: string | null } | null = null;
      if (stored) {
        const hit = await itemAt(c.env.DB, ch.id, t);
        if (hit) mine = { key: hit.item.trackId ? `t:${hit.item.trackId}` : `a:${hit.item.assetId}`, pos: (hit.item.offset + t - hit.item.startsAt) / 1000, label: hit.item.label };
      } else if (plan) {
        const it = plan.items.find((i) => i.startsAt <= t && t < i.endsAt);
        if (it) mine = { key: it.trackId ? `t:${it.trackId}` : `a:${it.assetId}`, pos: (it.offset + t - it.startsAt) / 1000, label: it.label };
      }
      if (!old && !mine) {
        bothOffAir++;
        continue;
      }
      checked++;
      const ok = !!old && !!mine && old.key === mine.key && Math.abs(old.pos - mine.pos) <= 1;
      if (!ok) {
        mismatches++;
        if (examples.length < 5) examples.push({ t: new Date(t).toISOString(), old, mine });
      }
    }
    report[ch.slug] = {
      mode: ch.programming_mode,
      status: ch.status,
      planItems: plan?.items.length ?? null,
      planError,
      checked,
      bothOffAir,
      mismatches,
      examples,
      ms: Date.now() - started,
    };
  }
  return c.json({ now: new Date(now).toISOString(), samples, stored, channels: report });
});

// POST /tick?now=<ms>[&forceThrow=1] - run the Scheduler's minute at a chosen time.
schedulerDevRoutes.post("/tick", async (c) => {
  const now = Number(c.req.query("now")) || Date.now();
  const { runMinute } = await import("../lib/scheduler/cron");
  const report = await runMinute(c.env, now, { forceThrow: c.req.query("forceThrow") === "1" });
  return c.json({ now: new Date(now).toISOString(), report });
});

registerDevTools(schedulerDevRoutes);
