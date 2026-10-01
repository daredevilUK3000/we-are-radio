import { Hono, type Context } from "hono";
import type { Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";
import { requireSameOrigin } from "../lib/origin";
import { streamR2Object } from "../lib/stream";
import { onAirTemplates, sendEmail } from "../lib/email";
import { clearTimelineCache } from "../lib/scheduler/timeline";
import { DAY } from "../lib/scheduler/time";
import {
  assetDescription, assetTitle, channelBusy, deleteAudio, loadMessage, parseWav, placeVoiceNote, removeFromSchedule, schedulerEnabled,
  type OnAirRow,
} from "../lib/onAir";

/**
 * "Say it on air", the Studio side (handoff §4.2): the Listener voices inbox.
 * Inside the studio sub-app, behind requireStudioAuth.
 *
 * The approval gate: /prepare refuses until the Studio has reported that
 * Kizzi played the raw message to the end (/listened), and /approve and
 * /hold refuse until there's prepared audio. Nothing in this file can put a
 * message on air that skipped either step.
 */
export const onAirStudioRoutes = new Hono<{ Bindings: Env }>();
onAirStudioRoutes.use("*", requireSameOrigin);

type Ctx = Context<{ Bindings: Env }>;
const fail = (c: Ctx, status: 400 | 404 | 409 | 413 | 503, error: string, message: string) => c.json({ error, message }, status);

const TABS: Record<string, string[]> = {
  pending: ["pending"],
  scheduled: ["approved", "scheduled", "placed"],
  aired: ["aired"],
  rejected: ["rejected", "expired", "withdrawn"],
};

onAirStudioRoutes.get("/summary", async (c) => {
  const r = await c.env.DB.prepare(
    `SELECT COUNT(*) AS pending, MIN(created_at) AS oldest,
       (SELECT COUNT(*) FROM onair_messages WHERE flag IS NOT NULL AND status IN ('approved','scheduled','placed')) AS flagged
     FROM onair_messages WHERE status = 'pending'`
  ).first<{ pending: number; oldest: string | null; flagged: number }>();
  return c.json({ pending: r?.pending ?? 0, oldest: r?.oldest ?? null, flagged: r?.flagged ?? 0 });
});

onAirStudioRoutes.get("/messages", async (c) => {
  const tab = TABS[c.req.query("status") ?? "pending"] ?? TABS.pending;
  const order = tab.includes("pending") ? "m.created_at ASC" : "COALESCE(m.aired_at_ms, m.air_after_ms, 0) DESC, m.updated_at DESC";
  const { results } = await c.env.DB.prepare(
    `SELECT m.*, t.title AS requested_track_title, t.artist AS requested_track_artist,
       ch.name AS channel_name, ch.slug AS channel_slug, ach.name AS air_channel_name, ach.slug AS air_channel_slug,
       a.audio_url AS prepared_url, a.duration_seconds AS prepared_seconds, a.status AS prepared_status,
       (SELECT COUNT(*) FROM onair_messages o WHERE o.email_hash = m.email_hash) AS sender_total,
       (SELECT COUNT(*) FROM onair_messages o WHERE o.email_hash = m.email_hash AND o.status = 'aired') AS sender_aired,
       (SELECT COUNT(*) FROM onair_messages o WHERE o.email_hash = m.email_hash AND o.status = 'rejected') AS sender_rejected,
       (SELECT COUNT(*) FROM onair_messages o WHERE o.email_hash = m.email_hash AND o.created_at <= m.created_at) AS sender_nth,
       (SELECT 1 FROM onair_blocks b WHERE b.hash IN (m.email_hash, m.ip_hash) LIMIT 1) AS blocked
     FROM onair_messages m
     LEFT JOIN tracks t ON t.id = m.requested_track_id
     LEFT JOIN channels ch ON ch.id = m.channel_id
     LEFT JOIN channels ach ON ach.id = m.air_channel_id
     LEFT JOIN audio_assets a ON a.id = m.audio_asset_id
     WHERE m.status IN (${tab.map(() => "?").join(",")})
     ORDER BY ${order} LIMIT 200`
  )
    .bind(...tab)
    .all<Record<string, unknown>>();
  // The manage token's hash and the IP hash stay on the server.
  const messages = results.map(({ manage_token_hash: _t, ip_hash: _i, raw_key, ...m }) => ({
    ...m,
    has_raw: !!raw_key,
    reacting_to: m.reacting_to_json ? JSON.parse(String(m.reacting_to_json)) : null,
  }));
  const counts = await c.env.DB.prepare("SELECT status, COUNT(*) AS n FROM onair_messages GROUP BY status").all<{ status: string; n: number }>();
  const byTab = Object.fromEntries(
    Object.entries(TABS).map(([k, statuses]) => [k, counts.results.filter((r) => statuses.includes(r.status)).reduce((s, r) => s + r.n, 0)])
  );
  const { results: channels } = await c.env.DB.prepare(
    `SELECT ch.id, ch.slug, ch.name, ch.status, COALESCE(sc.enabled, 0) AS scheduler
     FROM channels ch LEFT JOIN sched_channels sc ON sc.channel_id = ch.id ORDER BY ch.name`
  ).all();
  return c.json({ messages, counts: byTab, channels });
});

const load = async (c: Ctx) => loadMessage(c.env.DB, c.req.param("id") ?? "");

// The raw upload, to the Studio only (the public /media route refuses onair/).
onAirStudioRoutes.get("/messages/:id/raw", async (c) => {
  const m = await load(c);
  if (!m?.raw_key) return c.notFound();
  const res = await streamR2Object(c.env.MEDIA, m.raw_key, c.req.header("Range"), "private, no-store");
  return res ?? c.notFound();
});

onAirStudioRoutes.post("/messages/:id/listened", async (c) => {
  const m = await load(c);
  if (!m) return fail(c, 404, "not_found", "That message doesn't exist any more.");
  await c.env.DB.prepare("UPDATE onair_messages SET listened_full = 1, updated_at = ? WHERE id = ?").bind(nowIso(), m.id).run();
  return c.json({ ok: true });
});

onAirStudioRoutes.post("/messages/:id/prepare", async (c) => {
  const m = await load(c);
  if (!m) return fail(c, 404, "not_found", "That message doesn't exist any more.");
  if (!m.listened_full) return fail(c, 409, "not_listened", "Listen to the end first.");
  if (!["pending", "approved", "scheduled"].includes(m.status)) {
    return fail(c, 409, "locked", m.status === "placed" ? "It's already placed on air. Unschedule it first to prepare it again." : "This message can't be changed now.");
  }
  const form = await c.req.parseBody().catch(() => null);
  const file = form?.audio;
  if (!(file instanceof File) || file.size === 0) return fail(c, 400, "bad_request", "No audio received.");
  if (file.size > 12 * 1024 * 1024) return fail(c, 413, "too_large", "That file is too big.");
  const bytes = await file.arrayBuffer();
  const wav = parseWav(bytes);
  if (!wav.ok) return fail(c, 400, "bad_audio", `That isn't a usable WAV (${wav.reason}).`);
  if (wav.seconds < 1 || wav.seconds > 125) return fail(c, 400, "bad_audio", "Prepared voice notes can be up to 2 minutes, intro included.");

  // A new asset (and R2 key) each time: /media serves audio as immutable, so a
  // re-prepared clip under the old key could be heard stale. The old one is archived.
  const assetId = newId("aa");
  const key = `audio/onair-${assetId}.wav`;
  await c.env.MEDIA.put(key, bytes, { httpMetadata: { contentType: "audio/wav" } });
  // The Studio pads the clip to whole seconds, so the length the log uses is the file's own.
  const seconds = Math.max(1, Math.floor(wav.seconds + 0.001));
  await c.env.DB.prepare(
    `INSERT INTO audio_assets (id, type, title, audio_url, duration_seconds, description, status, link_kind, created_at)
     VALUES (?, 'link', ?, ?, ?, ?, 'published', NULL, ?)`
  )
    .bind(assetId, assetTitle(m), key, seconds, assetDescription(m), nowIso())
    .run();
  if (m.audio_asset_id) await deleteAudio(c.env, m, { asset: true });
  await c.env.DB.prepare("UPDATE onair_messages SET audio_asset_id = ?, with_intro = ?, updated_at = ? WHERE id = ?")
    .bind(assetId, String(form?.with_intro) === "1" ? 1 : 0, nowIso(), m.id)
    .run();
  return c.json({ ok: true, asset_id: assetId, audio_url: key, seconds });
});

interface ApproveBody {
  channel_id?: string;
  when?: "next" | "at";
  air_after_ms?: number;
  play_song_after?: boolean;
}

async function readyToApprove(c: Ctx, m: OnAirRow | null) {
  if (!m) return fail(c, 404, "not_found", "That message doesn't exist any more.");
  if (!m.listened_full) return fail(c, 409, "not_listened", "Listen to the end first.");
  if (!m.audio_asset_id) return fail(c, 409, "not_prepared", "Prepare the audio first.");
  if (!["pending", "approved", "scheduled"].includes(m.status)) return fail(c, 409, "locked", "This message can't be scheduled now.");
  return null;
}

onAirStudioRoutes.post("/messages/:id/approve", async (c) => {
  const m = await load(c);
  const bad = await readyToApprove(c, m);
  if (bad) return bad;
  const body = await c.req.json<ApproveBody>().catch(() => ({}) as ApproveBody);
  const channel = await c.env.DB.prepare("SELECT id, name FROM channels WHERE id = ?").bind(body.channel_id ?? m!.channel_id ?? "").first<{ id: string; name: string }>();
  if (!channel) return fail(c, 400, "bad_channel", "Choose a channel.");
  const now = Date.now();
  let after = now;
  if (body.when === "at") {
    after = Number(body.air_after_ms);
    if (!Number.isFinite(after) || after < now - 60_000 || after > now + 7 * DAY) return fail(c, 400, "bad_time", "Pick a time in the next 7 days.");
  } else if (body.when !== "next") return fail(c, 400, "bad_when", "Choose when it goes out.");
  if (body.when === "next" && !(await schedulerEnabled(c.env.DB, channel.id))) {
    return fail(c, 409, "not_enabled", `The Scheduler isn't on air for ${channel.name} yet. You can hold this or pick another channel.`);
  }

  await c.env.DB.prepare(
    `UPDATE onair_messages SET status = 'scheduled', air_channel_id = ?, air_after_ms = ?, air_when = ?, play_song_after = ?,
       flag = NULL, place_attempts = 0, reviewed_at = COALESCE(reviewed_at, ?), updated_at = ? WHERE id = ?`
  )
    .bind(channel.id, after, body.when, body.play_song_after && m!.requested_track_id ? 1 : 0, nowIso(), nowIso(), m!.id)
    .run();

  if (body.when === "at") return c.json({ ok: true, status: "scheduled", message: "Scheduled. It goes out at the first break after that time." });
  const fresh = (await loadMessage(c.env.DB, m!.id))!;
  const busy = await channelBusy(c.env.DB, channel.id, now, m!.id);
  if (busy) return c.json({ ok: true, status: "scheduled", message: busy });
  const placed = await placeVoiceNote(c.env, fresh, now);
  if (placed.ok) clearTimelineCache(channel.id);
  return c.json({
    ok: true,
    status: placed.ok ? "placed" : "scheduled",
    expected_at_ms: placed.ok ? placed.expectedAt : null,
    message: placed.ok ? placed.message : `Not placed yet: ${placed.message} The Scheduler will keep trying every minute.`,
  });
});

onAirStudioRoutes.post("/messages/:id/hold", async (c) => {
  const m = await load(c);
  const bad = await readyToApprove(c, m);
  if (bad) return bad;
  const body = await c.req.json<ApproveBody>().catch(() => ({}) as ApproveBody);
  await c.env.DB.prepare(
    `UPDATE onair_messages SET status = 'approved', air_channel_id = COALESCE(?, air_channel_id, channel_id), play_song_after = ?,
       reviewed_at = COALESCE(reviewed_at, ?), updated_at = ? WHERE id = ?`
  )
    .bind(body.channel_id ?? null, body.play_song_after && m!.requested_track_id ? 1 : 0, nowIso(), nowIso(), m!.id)
    .run();
  return c.json({ ok: true });
});

onAirStudioRoutes.post("/messages/:id/unschedule", async (c) => {
  const m = await load(c);
  if (!m) return fail(c, 404, "not_found", "That message doesn't exist any more.");
  if (!["scheduled", "placed"].includes(m.status)) return c.json({ ok: true });
  const off = await removeFromSchedule(c.env, m, Date.now(), `Voice note taken off the schedule by you (${assetTitle(m)})`);
  if (!off.ok) return fail(c, 409, off.onAir ? "on_air" : "try_again", off.onAir ? "It's on air right now." : off.message);
  await c.env.DB.prepare(
    "UPDATE onair_messages SET status = 'approved', placed_airing_id = NULL, expected_at_ms = NULL, flag = NULL, updated_at = ? WHERE id = ?"
  )
    .bind(nowIso(), m.id)
    .run();
  if (m.air_channel_id) clearTimelineCache(m.air_channel_id);
  return c.json({ ok: true });
});

onAirStudioRoutes.post("/messages/:id/reject", async (c) => {
  const m = await load(c);
  if (!m) return fail(c, 404, "not_found", "That message doesn't exist any more.");
  if (!["pending", "approved", "scheduled"].includes(m.status)) return fail(c, 409, "locked", "Unschedule it first.");
  const body = await c.req.json<{ reason?: string; notify?: boolean }>().catch(() => ({}) as { reason?: string; notify?: boolean });
  const reason = (body.reason ?? "").trim().slice(0, 300) || null;
  await c.env.DB.prepare("UPDATE onair_messages SET status = 'rejected', reject_reason = ?, reviewed_at = ?, updated_at = ? WHERE id = ?")
    .bind(reason, nowIso(), nowIso(), m.id)
    .run();
  if (body.notify !== false) {
    c.executionCtx.waitUntil(
      sendEmail(c.env, {
        ...onAirTemplates.notThisTime(m.email, { firstName: m.first_name, reason }),
        from: c.env.CONTACT_FROM || "We Are Radio <info@weareradio.app>",
        replyTo: "info@weareradio.app",
      })
    );
  }
  return c.json({ ok: true });
});

onAirStudioRoutes.post("/messages/:id/block", async (c) => {
  const m = await load(c);
  if (!m) return fail(c, 404, "not_found", "That message doesn't exist any more.");
  if (m.status === "aired") return fail(c, 409, "locked", "It has already aired.");
  const off = await removeFromSchedule(c.env, m, Date.now(), `Voice note removed: sender blocked (${assetTitle(m)})`);
  if (!off.ok) return fail(c, 409, off.onAir ? "on_air" : "try_again", off.onAir ? "It's on air right now." : off.message);
  const ts = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE onair_messages SET status = 'rejected', reject_reason = 'blocked', reviewed_at = ?, updated_at = ? WHERE id = ?").bind(ts, ts, m.id),
    c.env.DB.prepare("INSERT OR IGNORE INTO onair_blocks (hash, kind, message_id, created_at) VALUES (?, 'email', ?, ?)").bind(m.email_hash, m.id, ts),
    c.env.DB.prepare("INSERT OR IGNORE INTO onair_blocks (hash, kind, message_id, created_at) VALUES (?, 'ip', ?, ?)").bind(m.ip_hash, m.id, ts),
  ]);
  if (m.air_channel_id) clearTimelineCache(m.air_channel_id);
  return c.json({ ok: true });
});

// Unblock: by the message that caused the block (the Studio never sees the hashes themselves).
onAirStudioRoutes.delete("/blocks/:messageId", async (c) => {
  await c.env.DB.prepare("DELETE FROM onair_blocks WHERE message_id = ?").bind(c.req.param("messageId")).run();
  return c.json({ ok: true });
});

onAirStudioRoutes.get("/blocks", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT b.message_id, MIN(b.created_at) AS created_at, m.first_name, m.place
     FROM onair_blocks b LEFT JOIN onair_messages m ON m.id = b.message_id GROUP BY b.message_id ORDER BY created_at DESC`
  ).all();
  return c.json({ blocks: results });
});

// Master Control's Voices drawer (P1): approved, not yet scheduled, for one channel.
onAirStudioRoutes.get("/voices", async (c) => {
  const channelId = c.req.query("channel_id") ?? "";
  const { results } = await c.env.DB.prepare(
    `SELECT m.id, m.kind, m.first_name, m.place, m.for_name, m.flag, m.play_song_after, a.duration_seconds AS seconds,
       t.title AS requested_track_title
     FROM onair_messages m LEFT JOIN audio_assets a ON a.id = m.audio_asset_id LEFT JOIN tracks t ON t.id = m.requested_track_id
     WHERE m.status = 'approved' AND COALESCE(m.air_channel_id, m.channel_id) = ? ORDER BY m.reviewed_at, m.created_at`
  )
    .bind(channelId)
    .all();
  return c.json({ voices: results });
});
