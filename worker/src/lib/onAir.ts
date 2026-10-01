import type { Channel, Env } from "./types";
import { hmacHex, tokenHash } from "./hash";
import { nowIso } from "./id";
import { KIND_WORD, onAirTemplates, sendEmail } from "./email";
import { runAction, type ItemRef } from "./scheduler/actions";
import { liveMax, logChange } from "./scheduler/store";
import { clearTimelineCache, itemsBetween } from "./scheduler/timeline";
import { DAY, HOUR, MINUTE, PARIS_TZ } from "./scheduler/time";

/**
 * "Say it on air" (handoff_say_it_on_air.md): listener voice notes.
 *
 * The rule that must never break: nothing a listener records reaches air, or
 * any public URL, without Kizzi having listened to all of it and approved it.
 * The raw upload lives under onair/pending/ (which /media refuses); only the
 * audio he prepares and approves in the Studio becomes an ordinary
 * audio_assets row, and only an approval puts it on the Scheduler.
 *
 * Getting it on air is done here, through the Scheduler's insert_next live
 * control (actor 'system'). A regeneration rebuilds the log from the next
 * boundary and drops overrides that haven't started, so the minute job
 * (onAirMinute) checks every placed note against sched_aired and the live
 * timeline, and re-places any that were lost.
 */

export const SITE = "https://weareradio.app";
export const MAX_SECONDS = 45;
export const MIN_SECONDS = 3;
/** The server allows a second of slack over the 45 s the recorder stops at. */
export const SERVER_MAX_SECONDS = 46;
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
/** Pacing (changeable here): voice notes per channel per hour. */
export const NOTES_PER_HOUR = 4;
/** Failed placements before the inbox and Schedule health flag a note. */
const PLACE_FAIL_LIMIT = 3;
/** A dedicated song is left out if it aired on the channel this recently. */
const SONG_REPEAT_MS = 2 * HOUR;

export type OnAirKind = "shoutout" | "dedication" | "reaction" | "question";
export type OnAirStatus = "pending" | "approved" | "scheduled" | "placed" | "aired" | "rejected" | "expired" | "withdrawn";

export interface OnAirRow {
  id: string;
  public_id: string | null;
  kind: OnAirKind;
  first_name: string;
  place: string;
  for_name: string;
  requested_track_id: string | null;
  reacting_to_json: string | null;
  note: string;
  channel_id: string | null;
  email: string;
  email_hash: string;
  ip_hash: string;
  listener_tz: string | null;
  consent_share: number;
  raw_key: string | null;
  raw_seconds: number;
  audio_asset_id: string | null;
  with_intro: number;
  status: OnAirStatus;
  air_channel_id: string | null;
  air_after_ms: number | null;
  air_when: "next" | "at" | null;
  play_song_after: number;
  placed_version: number | null;
  placed_airing_id: string | null;
  expected_at_ms: number | null;
  place_attempts: number;
  scheduled_emailed: number;
  flag: string | null;
  song_note: string | null;
  aired_at_ms: number | null;
  manage_token_hash: string;
  reject_reason: string | null;
  listened_full: number;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
}

// ------------------------------------------------------------------ WAV

export type WavInfo = { ok: true; seconds: number; sampleRate: number; dataBytes: number } | { ok: false; reason: string };

/**
 * Checks a WAV from its header, never trusting the client: RIFF/WAVE, a PCM
 * "fmt " chunk (format 1), mono, 16-bit, 8-48 kHz, and the length from the
 * data chunk's size.
 */
export function parseWav(buf: ArrayBuffer): WavInfo {
  const v = new DataView(buf);
  const text = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (buf.byteLength < 44 || text(0) !== "RIFF" || text(8) !== "WAVE") return { ok: false, reason: "not a WAV file" };
  let o = 12;
  let fmt: { format: number; channels: number; rate: number; byteRate: number; bits: number } | null = null;
  while (o + 8 <= buf.byteLength) {
    const id = text(o);
    const size = v.getUint32(o + 4, true);
    if (id === "fmt ") {
      if (size < 16 || o + 24 > buf.byteLength) return { ok: false, reason: "bad fmt chunk" };
      fmt = {
        format: v.getUint16(o + 8, true),
        channels: v.getUint16(o + 10, true),
        rate: v.getUint32(o + 12, true),
        byteRate: v.getUint32(o + 16, true),
        bits: v.getUint16(o + 22, true),
      };
    } else if (id === "data") {
      if (!fmt) return { ok: false, reason: "data before fmt" };
      if (fmt.format !== 1) return { ok: false, reason: "not PCM" };
      if (fmt.channels !== 1) return { ok: false, reason: "not mono" };
      if (fmt.bits !== 16) return { ok: false, reason: "not 16-bit" };
      if (fmt.rate < 8000 || fmt.rate > 48000) return { ok: false, reason: "sample rate out of range" };
      if (fmt.byteRate !== fmt.rate * 2) return { ok: false, reason: "inconsistent byte rate" };
      const dataBytes = Math.min(size, buf.byteLength - o - 8);
      return { ok: true, seconds: dataBytes / fmt.byteRate, sampleRate: fmt.rate, dataBytes };
    }
    o += 8 + size + (size % 2);
  }
  return { ok: false, reason: "no data chunk" };
}

// ------------------------------------------------------------- helpers

/**
 * The manage link's token. Derived from the message ID under HASH_PEPPER, so
 * every email (received, scheduled, aired) can carry the same link without
 * the token itself ever being stored: only its hash is, like the contest's.
 */
export const manageToken = (env: Env, id: string) => hmacHex(env.HASH_PEPPER, `oam-manage:${id}`);
export const manageTokenHash = async (env: Env, id: string) => tokenHash(env, await manageToken(env, id));
export const manageUrl = async (env: Env, id: string) => `${SITE}/on-air/manage?id=${encodeURIComponent(id)}&t=${await manageToken(env, id)}`;
export const listenBackUrl = async (env: Env, id: string) => `${SITE}/on-air/m/${encodeURIComponent(id)}?t=${await manageToken(env, id)}`;
export const shareUrl = (publicId: string) => `${SITE}/on-air/${publicId}`;

/** "Sarah in Leeds · voice note": what Master Control, sched_aired and the players show. */
export const assetTitle = (m: Pick<OnAirRow, "first_name" | "place">) => `${m.first_name}${m.place ? ` in ${m.place}` : ""} · voice note`;
export const assetDescription = (m: Pick<OnAirRow, "kind" | "for_name">) =>
  m.kind === "dedication" && m.for_name ? `Dedication for ${m.for_name}` : (KIND_WORD[m.kind] ?? m.kind).replace(/^./, (c) => c.toUpperCase());

/** A 10-character public slug for the share page. */
export function newPublicId(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export function validTimeZone(tz: string | null | undefined): string | null {
  if (!tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

const parts = (ms: number, tz: string) => {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "long",
  }).formatToParts(new Date(ms));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, hhmm: `${g("hour")}:${g("minute")}`, weekday: g("weekday"), day: Number(g("day")) };
};

/**
 * When something airs, in the listener's own zone and in Paris time when the
 * two differ: "today at around 20:14 your time (21:14 in France)".
 */
export function whenText(ms: number, listenerTz: string | null, nowMs: number, around = true): string {
  const tz = validTimeZone(listenerTz) ?? PARIS_TZ;
  const mine = parts(ms, tz);
  const paris = parts(ms, PARIS_TZ);
  const today = parts(nowMs, tz).date;
  const tomorrow = parts(nowMs + DAY, tz).date;
  const day = mine.date === today ? "today" : mine.date === tomorrow ? "tomorrow" : `on ${mine.weekday} ${mine.day}`;
  const at = around ? "at around" : "at";
  return mine.hhmm === paris.hhmm && mine.date === paris.date
    ? `${day} ${at} ${paris.hhmm}`
    : `${day} ${at} ${mine.hhmm} your time (${paris.hhmm} in France)`;
}

async function channelById(db: D1Database, id: string | null) {
  return id ? db.prepare("SELECT * FROM channels WHERE id = ?").bind(id).first<Channel>() : null;
}

export async function schedulerEnabled(db: D1Database, channelId: string): Promise<boolean> {
  const r = await db.prepare("SELECT enabled FROM sched_channels WHERE channel_id = ?").bind(channelId).first<{ enabled: number }>();
  return r?.enabled === 1;
}

const setRow = (db: D1Database, id: string, fields: Record<string, unknown>) => {
  const keys = Object.keys(fields);
  return db
    .prepare(`UPDATE onair_messages SET ${keys.map((k) => `${k} = ?`).join(", ")}, updated_at = ? WHERE id = ?`)
    .bind(...keys.map((k) => fields[k]), nowIso(), id)
    .run();
};

export async function loadMessage(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM onair_messages WHERE id = ?").bind(id).first<OnAirRow>();
}

// --------------------------------------------------------------- pacing

/**
 * Why a channel can't take another voice note right now, or null if it can:
 * - one is already placed and hasn't finished airing (two due together go
 *   out a song apart, never back to back);
 * - NOTES_PER_HOUR have aired or been placed in the last hour.
 */
export async function channelBusy(db: D1Database, channelId: string, nowMs: number, exceptId?: string): Promise<string | null> {
  const r = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'placed' THEN 1 ELSE 0 END) AS placed,
         SUM(CASE WHEN COALESCE(aired_at_ms, expected_at_ms) > ? THEN 1 ELSE 0 END) AS hour
       FROM onair_messages WHERE air_channel_id = ? AND status IN ('placed','aired') AND id != ?`
    )
    .bind(nowMs - HOUR, channelId, exceptId ?? "")
    .first<{ placed: number | null; hour: number | null }>();
  if ((r?.placed ?? 0) > 0) return "Another voice note is about to air on this channel, so this one goes out a song later.";
  if ((r?.hour ?? 0) >= NOTES_PER_HOUR) return `${NOTES_PER_HOUR} voice notes have aired on this channel in the last hour, so this one waits a little.`;
  return null;
}

// -------------------------------------------------------------- placing

export type PlaceResult = { ok: true; message: string; expectedAt: number } | { ok: false; waiting?: boolean; message: string };

/**
 * Puts a 'scheduled' message on air after the item playing now, through
 * insert_next on the live version (retried once if the schedule changed
 * underneath). The dedicated song follows it when asked for, unless it aired
 * on the channel in the last two hours.
 */
export async function placeVoiceNote(env: Env, m: OnAirRow, nowMs = Date.now(), opts: { replaced?: boolean } = {}): Promise<PlaceResult> {
  const db = env.DB;
  const fail = async (message: string): Promise<PlaceResult> => {
    const attempts = m.place_attempts + 1;
    await setRow(db, m.id, {
      place_attempts: attempts,
      flag: attempts >= PLACE_FAIL_LIMIT ? `Couldn't place this: ${message}` : m.flag,
    });
    return { ok: false, message };
  };

  if (m.status !== "scheduled") return { ok: false, message: "This message isn't waiting to be placed." };
  const channel = await channelById(db, m.air_channel_id);
  if (!channel) return fail("its channel no longer exists.");
  if (!(await schedulerEnabled(db, channel.id))) return fail(`the Scheduler isn't on air for ${channel.name}.`);
  if (!m.audio_asset_id) return fail("it has no prepared audio.");
  if (m.air_when === "at" && m.air_after_ms && nowMs < m.air_after_ms) return { ok: false, waiting: true, message: "Not due yet." };
  const busy = await channelBusy(db, channel.id, nowMs, m.id);
  if (busy) return { ok: false, waiting: true, message: busy };

  const items: ItemRef[] = [{ audio_asset_id: m.audio_asset_id }];
  let songNote: string | null = null;
  if (m.play_song_after && m.requested_track_id) {
    const song = await db
      .prepare(
        `SELECT t.status,
           (SELECT MAX(starts_at_ms) FROM sched_aired a WHERE a.channel_id = ? AND a.track_id = t.id) AS last_aired
         FROM tracks t WHERE t.id = ?`
      )
      .bind(channel.id, m.requested_track_id)
      .first<{ status: string; last_aired: number | null }>();
    if (song?.status !== "published") songNote = "Their song isn't published any more, so it was left out.";
    else if (song.last_aired && song.last_aired > nowMs - SONG_REPEAT_MS) songNote = "Their song played recently, so it was left out.";
    else items.push({ track_id: m.requested_track_id });
  }

  const who = `${m.first_name}${m.place ? ` in ${m.place}` : ""}`;
  let result: Awaited<ReturnType<typeof runAction>> | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const live = await liveMax(db, channel.id);
    result = await runAction(
      env,
      channel,
      {
        action: "insert_next",
        expected_version: live,
        items,
        actor: "system",
        reason: opts.replaced
          ? `Listener voice note from ${m.first_name}, re-placed after the schedule was rebuilt`
          : `Listener voice note from ${m.first_name} (approved by you)`,
        summary: `Voice note: ${who}`,
      },
      nowMs
    );
    if (result.ok || result.error !== "schedule_changed") break;
  }
  if (!result || !result.ok) return fail(result?.message ?? "the schedule couldn't be changed.");

  const placed = await db
    .prepare(
      `SELECT airing_id, starts_at_ms FROM sched_log_items
       WHERE version_id = ? AND audio_asset_id = ? AND source = 'override' ORDER BY starts_at_ms LIMIT 1`
    )
    .bind(result.version.id, m.audio_asset_id)
    .first<{ airing_id: string; starts_at_ms: number }>();
  if (!placed) return fail("it didn't appear in the new log.");

  await setRow(db, m.id, {
    status: "placed",
    placed_version: result.version.number,
    placed_airing_id: placed.airing_id,
    expected_at_ms: placed.starts_at_ms,
    place_attempts: 0,
    flag: null,
    song_note: songNote,
  });

  if (!m.scheduled_emailed) {
    const when = m.air_when === "next" || placed.starts_at_ms - nowMs < 10 * MINUTE
      ? "in the next few minutes"
      : whenText(placed.starts_at_ms, m.listener_tz, nowMs);
    const sent = await sendEmail(env, {
      ...onAirTemplates.scheduled(m.email, {
        firstName: m.first_name,
        kindWord: KIND_WORD[m.kind] ?? "message",
        channel: channel.name,
        when,
        listenUrl: `${SITE}/channel/${channel.slug}`,
        manageUrl: await manageUrl(env, m.id),
      }),
      from: env.CONTACT_FROM || "We Are Radio <info@weareradio.app>",
      replyTo: "info@weareradio.app",
    });
    // Marked even if the provider failed: a second try on a re-placement would arrive late and confuse.
    await setRow(db, m.id, { scheduled_emailed: 1 });
    if (!sent) console.error("on-air scheduled email not sent", m.id);
  }
  return { ok: true, message: songNote ? `Placed. ${songNote}` : "Placed.", expectedAt: placed.starts_at_ms };
}

/**
 * Takes a placed note off the schedule (unschedule, the listener's "Take it
 * back", a block), with the Scheduler's remove action. Refused once it has
 * started: it's on air.
 */
export async function removeFromSchedule(env: Env, m: OnAirRow, nowMs: number, reason: string): Promise<{ ok: true } | { ok: false; onAir?: boolean; message: string }> {
  if (m.status !== "placed" || !m.placed_airing_id || !m.air_channel_id) return { ok: true };
  const channel = await channelById(env.DB, m.air_channel_id);
  if (!channel) return { ok: true };
  const upcoming = (await itemsBetween(env.DB, channel.id, nowMs - 10 * MINUTE, nowMs + 3 * HOUR)).find((i) => i.airingId === m.placed_airing_id);
  if (!upcoming) return { ok: true }; // the log already lost it
  if (upcoming.startsAt <= nowMs) return { ok: false, onAir: true, message: "It's on air right now." };
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runAction(env, channel, {
      action: "remove",
      expected_version: await liveMax(env.DB, channel.id),
      airing_id: m.placed_airing_id,
      actor: "system",
      reason,
    }, nowMs);
    if (result.ok) return { ok: true };
    if (result.error === "not_found") return { ok: true };
    if (result.error !== "schedule_changed") return { ok: false, message: result.message };
  }
  return { ok: false, message: "The schedule kept changing. Please try again." };
}

/** Deletes a message's audio from R2: the raw upload and/or the prepared asset (archived, so nothing can schedule it again). */
export async function deleteAudio(env: Env, m: Pick<OnAirRow, "id" | "raw_key" | "audio_asset_id">, what: { raw?: boolean; asset?: boolean }) {
  if (what.raw && m.raw_key) {
    await env.MEDIA.delete(m.raw_key).catch(() => {});
    await setRow(env.DB, m.id, { raw_key: null });
  }
  if (what.asset && m.audio_asset_id) {
    const a = await env.DB.prepare("SELECT audio_url FROM audio_assets WHERE id = ?").bind(m.audio_asset_id).first<{ audio_url: string }>();
    if (a?.audio_url && !/^https?:/i.test(a.audio_url)) await env.MEDIA.delete(a.audio_url).catch(() => {});
    await env.DB.prepare("UPDATE audio_assets SET status = 'archived' WHERE id = ?").bind(m.audio_asset_id).run();
  }
}

// ------------------------------------------------------------ the minute

/**
 * The Scheduler's minute calls this after the aired recorder. Each part is
 * independent; at most one note is placed per channel per run.
 */
export async function onAirMinute(env: Env, nowMs = Date.now()): Promise<string> {
  const report: string[] = [];
  report.push(await verifyPlaced(env, nowMs));
  report.push(await placeDue(env, nowMs));
  return report.filter(Boolean).join("; ") || "ok";
}

/** Placed notes: aired, lost to a rebuild (re-place), or skipped / cut short (back to approved, flagged). */
export async function verifyPlaced(env: Env, nowMs: number): Promise<string> {
  const db = env.DB;
  const { results } = await db.prepare("SELECT * FROM onair_messages WHERE status = 'placed'").all<OnAirRow>();
  const out: string[] = [];
  for (const m of results) {
    if (!m.air_channel_id || !m.placed_airing_id) continue;
    const aired = await db
      .prepare("SELECT starts_at_ms, actual_end_ms, ended_how FROM sched_aired WHERE channel_id = ? AND airing_id = ?")
      .bind(m.air_channel_id, m.placed_airing_id)
      .first<{ starts_at_ms: number; actual_end_ms: number | null; ended_how: string | null }>();
    if (aired) {
      if (!aired.ended_how) continue; // on air now
      const asset = m.audio_asset_id
        ? await db.prepare("SELECT duration_seconds FROM audio_assets WHERE id = ?").bind(m.audio_asset_id).first<{ duration_seconds: number }>()
        : null;
      const lengthMs = (asset?.duration_seconds ?? 0) * 1000;
      const heardMs = (aired.actual_end_ms ?? aired.starts_at_ms) - aired.starts_at_ms;
      const counts = aired.ended_how === "completed" || (aired.ended_how === "interrupted" && lengthMs > 0 && heardMs >= 0.8 * lengthMs);
      if (counts) {
        await markAired(env, m, aired.starts_at_ms, nowMs);
        out.push(`aired ${m.id}`);
      } else {
        await setRow(db, m.id, {
          status: "approved",
          placed_airing_id: null,
          expected_at_ms: null,
          flag: aired.ended_how === "skipped"
            ? "Skipped in Master Control. It won't be re-placed automatically."
            : "It was cut short on air. It won't be re-placed automatically.",
        });
        out.push(`stopped ${m.id}`);
      }
      continue;
    }
    // Not recorded as aired: still coming up in the live log, or lost to a rebuild.
    const timeline = await itemsBetween(db, m.air_channel_id, nowMs - 10 * MINUTE, nowMs + 3 * HOUR);
    if (timeline.some((i) => i.airingId === m.placed_airing_id)) continue;
    await setRow(db, m.id, { status: "scheduled", air_after_ms: nowMs, placed_airing_id: null, expected_at_ms: null });
    await logChange(db, {
      channelId: m.air_channel_id,
      actor: "system",
      action: "insert_next",
      airingId: m.placed_airing_id,
      reason: `Voice note re-placed after the schedule was rebuilt (${assetTitle(m)})`,
    });
    out.push(`lost ${m.id}`);
  }
  return out.join(",");
}

async function markAired(env: Env, m: OnAirRow, startedAt: number, nowMs: number) {
  const db = env.DB;
  // A public share page exists only when the listener said yes to sharing.
  const publicId = m.consent_share ? m.public_id ?? newPublicId() : null;
  const changed = await db
    .prepare("UPDATE onair_messages SET status = 'aired', aired_at_ms = ?, public_id = ?, flag = NULL, updated_at = ? WHERE id = ? AND status = 'placed'")
    .bind(startedAt, publicId, nowIso(), m.id)
    .run();
  if (changed.meta.changes !== 1) return; // someone else got here first: the email goes once
  const channel = await channelById(db, m.air_channel_id);
  await sendEmail(env, {
    ...onAirTemplates.aired(m.email, {
      firstName: m.first_name,
      channel: channel?.name ?? "We Are Radio",
      when: whenText(startedAt, m.listener_tz, nowMs, false),
      listenBackUrl: await listenBackUrl(env, m.id),
      shareUrl: publicId ? shareUrl(publicId) : null,
      manageUrl: await manageUrl(env, m.id),
    }),
    from: env.CONTACT_FROM || "We Are Radio <info@weareradio.app>",
    replyTo: "info@weareradio.app",
  });
}

/** Scheduled notes that are due, oldest first, at most one per channel per run. */
async function placeDue(env: Env, nowMs: number): Promise<string> {
  const { results } = await env.DB
    .prepare("SELECT * FROM onair_messages WHERE status = 'scheduled' AND COALESCE(air_after_ms, 0) <= ? ORDER BY air_after_ms, created_at")
    .bind(nowMs)
    .all<OnAirRow>();
  const done = new Set<string>();
  const out: string[] = [];
  for (const m of results) {
    if (!m.air_channel_id || done.has(m.air_channel_id)) continue;
    done.add(m.air_channel_id);
    // A note that was placed before and lost has already had its email.
    const r = await placeVoiceNote(env, m, nowMs, { replaced: m.scheduled_emailed === 1 });
    if (r.ok) {
      clearTimelineCache(m.air_channel_id);
      out.push(`placed ${m.id}`);
    } else if (!r.waiting) out.push(`failed ${m.id}: ${r.message}`);
  }
  return out.join(",");
}

// ------------------------------------------------------- housekeeping

/**
 * Retention (§7), at most hourly from the minute job:
 * - pending for 30 days: expired, raw deleted, no email;
 * - rejected: raw after 7 days; rows (rejected / expired) after 12 months;
 * - withdrawn: audio straight away (a catch-up here), row anonymised;
 * - aired: raw 7 days after airing; the prepared clip and share page after 12 months.
 */
export async function onAirRetention(env: Env, nowMs: number): Promise<string> {
  const db = env.DB;
  const iso = (ms: number) => new Date(ms).toISOString();
  let n = 0;
  const each = async (sql: string, binds: unknown[], fn: (m: OnAirRow) => Promise<void>) => {
    const { results } = await db.prepare(`${sql} LIMIT 100`).bind(...binds).all<OnAirRow>();
    for (const m of results) {
      await fn(m);
      n++;
    }
  };

  await each("SELECT * FROM onair_messages WHERE status = 'pending' AND created_at < ?", [iso(nowMs - 30 * DAY)], async (m) => {
    await deleteAudio(env, m, { raw: true });
    await setRow(db, m.id, { status: "expired" });
  });
  await each("SELECT * FROM onair_messages WHERE status = 'rejected' AND raw_key IS NOT NULL AND COALESCE(reviewed_at, created_at) < ?", [iso(nowMs - 7 * DAY)], (m) =>
    deleteAudio(env, m, { raw: true, asset: true })
  );
  await each(
    "SELECT * FROM onair_messages WHERE status = 'withdrawn' AND (raw_key IS NOT NULL OR (audio_asset_id IS NOT NULL AND audio_asset_id IN (SELECT id FROM audio_assets WHERE status != 'archived')))",
    [],
    (m) => deleteAudio(env, m, { raw: true, asset: true })
  );
  await each("SELECT * FROM onair_messages WHERE status = 'aired' AND raw_key IS NOT NULL AND aired_at_ms < ?", [nowMs - 7 * DAY], (m) =>
    deleteAudio(env, m, { raw: true })
  );
  await each(
    "SELECT * FROM onair_messages WHERE status = 'aired' AND aired_at_ms < ? AND (public_id IS NOT NULL OR audio_asset_id IN (SELECT id FROM audio_assets WHERE status != 'archived'))",
    [nowMs - 365 * DAY],
    async (m) => {
      await deleteAudio(env, m, { asset: true });
      await setRow(db, m.id, { public_id: null });
    }
  );
  const old = await db
    .prepare("DELETE FROM onair_messages WHERE status IN ('rejected','expired') AND created_at < ?")
    .bind(iso(nowMs - 365 * DAY))
    .run();
  return `${n} retention actions, ${old.meta.changes} old rows deleted`;
}

/** Withdrawn: everything that identifies the listener goes; the hashes stay for rate limits. */
export async function anonymise(db: D1Database, id: string) {
  await setRow(db, id, { first_name: "", place: "", for_name: "", note: "", email: "", reacting_to_json: null, public_id: null });
}

/**
 * Hourly (P1): "3 new voices waiting" to CONTACT_TO, only if new pending
 * messages arrived since the last alert. First names, kinds and lengths only.
 */
export async function onAirAlert(env: Env, nowMs: number): Promise<string> {
  const key = "onair:alert:last";
  const last = Number((await env.CONFIG.get(key)) ?? 0);
  if (nowMs - last < HOUR) return "not due";
  const since = new Date(last || nowMs - DAY).toISOString();
  const { results } = await env.DB
    .prepare("SELECT first_name, place, kind, raw_seconds FROM onair_messages WHERE status = 'pending' AND created_at > ? ORDER BY created_at")
    .bind(since)
    .all<{ first_name: string; place: string; kind: string; raw_seconds: number }>();
  await env.CONFIG.put(key, String(nowMs));
  if (results.length === 0) return "nothing new";
  const rows: [string, string][] = results.slice(0, 20).map((r) => [
    `${r.first_name}${r.place ? ` in ${r.place}` : ""}`,
    `${(KIND_WORD[r.kind] ?? r.kind).replace(/^./, (c) => c.toUpperCase())} · ${Math.round(r.raw_seconds)} s`,
  ]);
  await sendEmail(env, {
    ...onAirTemplates.voicesWaiting(env.CONTACT_TO || "info@weareradio.app", { rows, count: results.length }),
    from: env.CONTACT_FROM || "We Are Radio <info@weareradio.app>",
    replyTo: null,
  });
  return `alerted ${results.length}`;
}

// -------------------------------------------------- the players' badge

const voiceCache = new Map<string, { at: number; v: VoiceInfo | null }>();
export interface VoiceInfo {
  first_name: string;
  place: string;
  kind: OnAirKind;
  for_name: string;
}

/**
 * For the "Listener voice" badge (P1): the public details of the voice note an
 * asset carries. Only these four fields: never the email, note or IDs.
 * Cached per Worker instance for a minute.
 */
export async function voiceFor(db: D1Database, assetId: string | null | undefined): Promise<VoiceInfo | null> {
  if (!assetId) return null;
  const hit = voiceCache.get(assetId);
  if (hit && Date.now() - hit.at < 60_000) return hit.v;
  const v = await db
    .prepare(
      `SELECT first_name, place, kind, for_name FROM onair_messages
       WHERE audio_asset_id = ? AND status IN ('aired','placed','scheduled') LIMIT 1`
    )
    .bind(assetId)
    .first<VoiceInfo>()
    .catch(() => null);
  voiceCache.set(assetId, { at: Date.now(), v: v ?? null });
  return v ?? null;
}
