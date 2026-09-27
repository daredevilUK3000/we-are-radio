import type { Channel, Env } from "../types";
import { recordAired, shadowCheck } from "./aired";
import { catalogueDigest, channelFingerprint, gridDigests, tickChannel, type SchedChannelRow } from "./generate";
import { channelHealth, gridStatus, sendAlerts } from "./health";
import { DAY, HOUR } from "./time";
import { clearTimelineCache } from "./timeline";

/**
 * The Scheduler's minute (a Cron Trigger, "* * * * *"). Each step is wrapped
 * so one failing can't stop the others:
 * 1. the aired recorder (channels on air through the Scheduler);
 * 2. per channel: regenerate on changed inputs, extend when short, and the
 *    shadow comparison for channels still in shadow;
 * 3. health and alerts, at most every 5 minutes ("playing what the grid
 *    says" every minute for channels on air);
 * 4. retention, at most hourly.
 */
export async function runMinute(env: Env, nowMs = Date.now(), test: { forceThrow?: boolean } = {}) {
  const report: Record<string, unknown> = {};
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      report[name] = (await fn()) ?? "ok";
    } catch (err) {
      console.error(`scheduler ${name} failed`, err);
      report[name] = `error: ${err instanceof Error ? err.message : String(err)}`;
    }
  };

  const { results: channels } = await env.DB.prepare("SELECT * FROM channels ORDER BY slug").all<Channel>();
  await env.DB.prepare("INSERT OR IGNORE INTO sched_channels (channel_id, enabled) SELECT id, 0 FROM channels").run();
  const scRows = new Map(
    (await env.DB.prepare("SELECT * FROM sched_channels").all<SchedChannelRow>()).results.map((r) => [r.channel_id, r])
  );

  // 1. Aired.
  for (const ch of channels) {
    if (scRows.get(ch.id)?.enabled) await step(`aired:${ch.slug}`, () => recordAired(env.DB, ch.id, nowMs));
  }

  // 2. Generation and shadow.
  let catalogue = "";
  let grids = new Map<string, string>();
  await step("digest", async () => {
    catalogue = await catalogueDigest(env.DB);
    grids = await gridDigests(env.DB);
  });
  for (const ch of channels) {
    const sc = scRows.get(ch.id)!;
    await step(`generate:${ch.slug}`, async () => {
      const outcome = await tickChannel(env, ch, sc, channelFingerprint(ch, catalogue, grids.get(ch.id) ?? ""), nowMs, test);
      if (outcome.status === "published") clearTimelineCache(ch.id);
      return outcome.status === "published" ? `v${outcome.version.number} (${outcome.version.kind})` : outcome.status === "failed" ? `failed: ${outcome.error}` : outcome.status;
    });
    if (!sc.enabled) await step(`shadow:${ch.slug}`, async () => shadowCheck(env, ch, nowMs));
  }

  // 3. Health: the grid check every minute for channels on air, the rest every 5 minutes.
  const full = await due(env, "sched:health", 5 * 60_000, nowMs);
  for (const ch of channels) {
    const sc = (await env.DB.prepare("SELECT * FROM sched_channels WHERE channel_id = ?").bind(ch.id).first<SchedChannelRow>())!;
    if (full) {
      await step(`health:${ch.slug}`, async () => {
        const checks = await channelHealth(env, ch, sc, nowMs);
        await env.CONFIG.put(`sched:health:${ch.id}`, JSON.stringify({ at: nowMs, checks }), { expirationTtl: 3600 });
        await sendAlerts(env, ch, checks, nowMs);
        return checks.filter((c) => c.level === "red" || c.level === "amber").map((c) => `${c.level}:${c.id}`).join(",") || "green";
      });
    } else if (sc.enabled) {
      await step(`grid:${ch.slug}`, async () => {
        const g = await gridStatus(env.DB, ch.id, nowMs);
        if (g.matches) return "ok";
        const checks = await channelHealth(env, ch, sc, nowMs);
        await env.CONFIG.put(`sched:health:${ch.id}`, JSON.stringify({ at: nowMs, checks }), { expirationTtl: 3600 });
        await sendAlerts(env, ch, checks, nowMs);
        return "grid mismatch";
      });
    }
  }

  // 4. Retention.
  if (await due(env, "sched:retention", HOUR, nowMs)) await step("retention", () => retention(env.DB, nowMs));
  return report;
}

/** True at most once per `everyMs` (a KV timestamp; approximate, which is fine for housekeeping). */
async function due(env: Env, key: string, everyMs: number, nowMs: number): Promise<boolean> {
  const last = Number((await env.CONFIG.get(key)) ?? 0);
  if (nowMs - last < everyMs) return false;
  await env.CONFIG.put(key, String(nowMs));
  return true;
}

/**
 * - published versions superseded more than 14 days ago go, with their items
 *   (a version is superseded once a later one's effective_from has passed and
 *   its own horizon is behind us);
 * - building/failed versions after an hour;
 * - runs after 30 days; changes after 24 months; aired history never.
 */
export async function retention(db: D1Database, nowMs: number) {
  const cutoff = nowMs - 14 * DAY;
  const { results: old } = await db
    .prepare(
      `SELECT id FROM sched_versions WHERE
         (status = 'published' AND horizon_ms < ?1
            AND EXISTS (SELECT 1 FROM sched_versions v2 WHERE v2.channel_id = sched_versions.channel_id AND v2.status = 'published' AND v2.number > sched_versions.number))
         OR (status IN ('building','failed') AND created_at_ms < ?2)
       LIMIT 200`
    )
    .bind(cutoff, nowMs - HOUR)
    .all<{ id: string }>();
  for (const v of old) {
    await db.batch([
      db.prepare("DELETE FROM sched_log_items WHERE version_id = ?").bind(v.id),
      db.prepare("DELETE FROM sched_versions WHERE id = ?").bind(v.id),
    ]);
  }
  await db.batch([
    db.prepare("DELETE FROM sched_runs WHERE started_at_ms < ?").bind(nowMs - 30 * DAY),
    db.prepare("DELETE FROM sched_changes WHERE at_ms < ?").bind(nowMs - 730 * DAY),
  ]);
  return `${old.length} old versions removed`;
}
