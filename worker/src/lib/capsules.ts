import type { RotationItem } from "./radioBrain";

/**
 * Time Capsules: scheduled messages that air on a specific date.
 *
 * On its date, a capsule is dropped into each live channel's playback the same
 * way a station ID is: as an ordinary audio item, no new playback mechanism.
 * Capsules are spread through the loop so several due on one day never land
 * back to back.
 */

// The station's own calendar. A capsule airs on its date in the station's
// time, wherever the listener happens to be.
export const STATION_TZ = "Europe/London";

/** Today's date (YYYY-MM-DD) in station time. */
export function stationToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: STATION_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const CAPSULE_STATUSES = ["requested", "recorded", "scheduled", "aired", "cancelled"] as const;
export type CapsuleStatus = (typeof CAPSULE_STATUSES)[number];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface CapsuleFields {
  requester_name: string;
  recipient_name: string;
  occasion_label: string;
  message_note: string;
  notify_email: string | null;
  scheduled_date: string;
}

/**
 * Validate and tidy a capsule request. Limits are generous for real people and
 * tight enough that the form can't be used to stuff the database.
 */
export function parseCapsuleFields(
  body: Record<string, unknown>,
  opts: { earliest?: string; latest?: string } = {}
): { ok: true; value: CapsuleFields } | { ok: false; error: string } {
  const text = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const requester = text(body.requester_name, 80);
  const recipient = text(body.recipient_name, 80);
  const occasion = text(body.occasion_label, 120);
  const note = String(body.message_note ?? "").replace(/\r/g, "").trim().slice(0, 600);
  const email = text(body.notify_email, 254);
  const date = body.scheduled_date;

  if (!requester) return { ok: false, error: "Please tell us your name." };
  if (!recipient) return { ok: false, error: "Please tell us who the message is for." };
  if (!occasion) return { ok: false, error: "Please tell us the occasion." };
  if (!note) return { ok: false, error: "Please tell us what you'd like said." };
  if (email && !EMAIL.test(email)) return { ok: false, error: "That email address doesn't look right." };
  if (!isRealDate(date)) return { ok: false, error: "Please choose a date." };
  if (opts.earliest && date < opts.earliest) return { ok: false, error: "Please choose a date in the future." };
  if (opts.latest && date > opts.latest) return { ok: false, error: "That date is too far ahead - please choose one within two years." };

  return {
    ok: true,
    value: {
      requester_name: requester,
      recipient_name: recipient,
      occasion_label: occasion,
      message_note: note,
      notify_email: email || null,
      scheduled_date: date,
    },
  };
}

export interface CapsuleClip {
  id: string;
  label: string;
  audio_asset_id: string;
  audio_url: string;
  duration_seconds: number;
}

/**
 * The capsules due on the air today. Also retires past ones: a scheduled
 * capsule whose day has gone by is marked aired (a station that loops all day
 * has no single "moment it went out", so the end of its date is when it's done).
 */
export async function loadTodaysCapsules(db: D1Database): Promise<CapsuleClip[]> {
  const today = stationToday();

  const { results: past } = await db
    .prepare("SELECT id FROM time_capsules WHERE status = 'scheduled' AND scheduled_date < ?")
    .bind(today)
    .all<{ id: string }>();
  if (past.length > 0) {
    const ts = new Date().toISOString();
    await db.batch(
      past.map((r) =>
        db
          .prepare("UPDATE time_capsules SET status = 'aired', aired_at = ?, updated_at = ? WHERE id = ?")
          .bind(ts, ts, r.id)
      )
    );
  }

  const { results } = await db
    .prepare(
      `SELECT tc.id, tc.occasion_label, aa.id AS audio_asset_id, aa.audio_url, aa.duration_seconds
       FROM time_capsules tc
       JOIN audio_assets aa ON aa.id = tc.audio_asset_id
       WHERE tc.status = 'scheduled' AND tc.scheduled_date = ? AND aa.status = 'published'
       ORDER BY tc.created_at ASC`
    )
    .bind(today)
    .all<{ id: string; occasion_label: string; audio_asset_id: string; audio_url: string; duration_seconds: number }>();

  return results.map((r) => ({
    id: r.id,
    label: `Time Capsule · ${r.occasion_label}`,
    audio_asset_id: r.audio_asset_id,
    audio_url: r.audio_url,
    duration_seconds: r.duration_seconds,
  }));
}

/**
 * Drop today's capsules into a loop of items. They are spread evenly through
 * the loop (a third and two thirds through, for two of them, and so on), each
 * placed after a song ends, so they never crowd together or cut a song short.
 * With none due the items come back untouched.
 */
export function withCapsules(items: RotationItem[], capsules: CapsuleClip[]): RotationItem[] {
  if (capsules.length === 0 || items.length === 0) return items;

  const total = items.reduce((sum, i) => sum + i.duration_seconds, 0);
  const ends: number[] = [];
  let cursor = 0;
  for (const item of items) {
    cursor += item.duration_seconds;
    ends.push(cursor);
  }

  // For each capsule, the first song that ends at or after its target moment.
  const after = new Map<number, CapsuleClip[]>();
  const taken = new Set<number>();
  capsules.forEach((capsule, k) => {
    const target = (total * (k + 1)) / (capsules.length + 1);
    let index = ends.findIndex((end, i) => end >= target && items[i].item_type === "song" && !taken.has(i));
    if (index < 0) index = ends.findIndex((end, i) => end >= target && !taken.has(i));
    if (index < 0) index = ends.findIndex((_, i) => !taken.has(i));
    if (index < 0) return;
    taken.add(index);
    after.set(index, [...(after.get(index) ?? []), capsule]);
  });

  const out: RotationItem[] = [];
  items.forEach((item, i) => {
    out.push(item);
    for (const c of after.get(i) ?? []) {
      out.push({
        id: `capsule-${c.id}-${i}`,
        item_type: "feature",
        label: c.label,
        track_id: null,
        audio_asset_id: c.audio_asset_id,
        duration_seconds: c.duration_seconds,
        audio_url: c.audio_url,
        artwork_url: null,
      });
    }
  });
  return out;
}
