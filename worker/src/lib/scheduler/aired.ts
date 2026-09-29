import type { Channel, Env } from "../types";
import { loadStation } from "../station";
import { locateInLoop } from "../radioBrain";
import { itemAt, itemsBetween } from "./timeline";
import { HOUR, DAY } from "./time";

/**
 * What the station actually broadcast (sched_aired), and the shadow check.
 *
 * The aired recorder runs every minute and straight after each live control:
 * every item of the governing timeline that has started since the last one
 * recorded gets a row (INSERT OR IGNORE on the airing ID), and an item a
 * later one has replaced gets its end. Offline listening is never recorded:
 * this is the broadcast, not any one listener.
 */
export async function recordAired(db: D1Database, channelId: string, nowMs: number): Promise<void> {
  const last = await db
    .prepare("SELECT MAX(starts_at_ms) AS s FROM sched_aired WHERE channel_id = ?")
    .bind(channelId)
    .first<{ s: number | null }>();
  const from = Math.max(last?.s ?? 0, nowMs - 3 * HOUR);
  const items = (await itemsBetween(db, channelId, from, nowMs + 1)).filter((i) => i.startsAt <= nowMs && i.startsAt >= from);
  const stmts = items.map((i) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO sched_aired (channel_id, airing_id, version_id, starts_at_ms, scheduled_end_ms, item_type, track_id, audio_asset_id, label, source)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(channelId, i.airingId, i.versionId, i.startsAt, Math.min(i.endsAt, i.cutAt ?? Infinity), i.itemType, i.trackId, i.assetId, i.label, i.source)
  );
  // Anything whose scheduled end has passed, and wasn't ended by a live control, completed.
  stmts.push(
    db
      .prepare(
        `UPDATE sched_aired SET actual_end_ms = scheduled_end_ms, ended_how = 'completed'
         WHERE channel_id = ? AND actual_end_ms IS NULL AND scheduled_end_ms <= ?`
      )
      .bind(channelId, nowMs)
  );
  for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
}

/** A live control ended the airing on air early. */
export async function endAiring(db: D1Database, channelId: string, airingId: string, atMs: number, how: "skipped" | "interrupted") {
  await db
    .prepare(
      `UPDATE sched_aired SET actual_end_ms = ?, ended_how = ?, scheduled_end_ms = MIN(scheduled_end_ms, ?)
       WHERE channel_id = ? AND airing_id = ?`
    )
    .bind(atMs, how, atMs, channelId, airingId)
    .run();
}

/**
 * Shadow mode: once a minute per channel, does the log agree with what
 * /now-playing (still the old code for this channel) says is on air - same
 * content, within 2 s? Counted per 24-hour window; going on air needs a full
 * 24 hours since the last mismatch.
 */
export async function shadowCheck(env: Env, channel: Channel, nowMs: number): Promise<boolean | null> {
  // Paused just after a library change (see tickChannel): not a check.
  const grace = await env.DB.prepare("SELECT shadow_grace_until_ms AS until FROM sched_channels WHERE channel_id = ?")
    .bind(channel.id)
    .first<{ until: number | null }>();
  if (grace?.until && nowMs < grace.until) return null;

  const old = await loadStation(env.DB, env.CONFIG, channel, nowMs);
  const mine = await itemAt(env.DB, channel.id, nowMs);
  if (!old.items && !mine) return null; // nothing on air either way: not a check

  let match = false;
  if (old.items && mine) {
    const { currentIndex, position_seconds } = locateInLoop(old.items, old.elapsed);
    const it = old.items[currentIndex];
    const oldKey = it.track_id ? `t:${it.track_id}` : `a:${it.audio_asset_id}`;
    const myKey = mine.item.trackId ? `t:${mine.item.trackId}` : `a:${mine.item.assetId}`;
    const myPos = (mine.item.offset + nowMs - mine.item.startsAt) / 1000;
    match = oldKey === myKey && Math.abs(myPos - position_seconds) <= 2;
  }

  await env.DB.prepare(
    `UPDATE sched_channels SET
       shadow_window_start_ms = CASE WHEN shadow_window_start_ms IS NULL OR shadow_window_start_ms < ?1 THEN ?2 ELSE shadow_window_start_ms END,
       shadow_checks = CASE WHEN shadow_window_start_ms IS NULL OR shadow_window_start_ms < ?1 THEN 1 ELSE shadow_checks + 1 END,
       shadow_mismatches = CASE WHEN shadow_window_start_ms IS NULL OR shadow_window_start_ms < ?1 THEN ?3 ELSE shadow_mismatches + ?3 END,
       shadow_last_mismatch_ms = CASE WHEN ?3 = 1 THEN ?2 ELSE shadow_last_mismatch_ms END,
       shadow_since_ms = COALESCE(shadow_since_ms, ?2)
     WHERE channel_id = ?4`
  )
    .bind(nowMs - DAY, nowMs, match ? 0 : 1, channel.id)
    .run();
  return match;
}
