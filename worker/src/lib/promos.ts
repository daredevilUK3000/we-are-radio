import { hashSeed } from "./radioBrain";
import { MINUTE, PARIS_TZ, wallClock } from "./scheduler/time";

/**
 * House promos (handoff_house_promos.md, migrations/0026): short promos for
 * the books Kizzi publishes and his platforms. They don't air from the
 * jingle pool; this is their own rotation.
 *
 * Which promo airs where is decided per Paris day as a pure function of the
 * promos, the station setting and the live autopilot channels (dayPlan), so
 * every channel's rebuild gets the same answer and the daily cap holds across
 * channels without reading anyone's log or writing anything per play. The
 * Scheduler's planner (scheduler/plan.ts) then places each channel's share
 * between two songs.
 */

/** Pacing (changeable here). Bump PROMO_RULES with any change so every log is rebuilt. */
export const PROMO_MIN_GAP_MS = 20 * MINUTE;
/** No promo in the last stretch of a window: the fit at its end may drop a song next to it. */
export const PROMO_WINDOW_END_MARGIN_MS = 15 * MINUTE;
export const PROMO_RULES = "promos-v2-gap20-margin15-open30-resume";
export const PROMOS_PER_HOUR_MAX = 3;
export const SHORT_LINK_BASE = "https://weareradio.app/go/";

export interface PromoRow {
  audio_asset_id: string;
  on_air_title: string | null;
  link_url: string | null;
  link_label: string;
  slug: string | null;
  cover_url: string | null;
  active: number;
  runs_from: string | null;
  runs_to: string | null;
  max_per_day: number;
  channel_ids: string | null;
  pill: string;
}

/** A promo that can air: set up, switched on, with audio. */
export interface AirablePromo extends PromoRow {
  on_air_title: string;
  link_url: string;
  slug: string;
  audio_url: string;
  duration_seconds: number;
  channels: string[] | null; // null = every live channel
}

export interface PromoConfig {
  perHour: number;
  promos: AirablePromo[];
  /** Live autopilot channels, sorted: the channels a day's plays are shared between. */
  channelIds: string[];
}

export function parseChannelIds(json: string | null): string[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

export async function promosPerHour(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT value FROM station_settings WHERE key = 'promos_per_hour'").first<{ value: string }>();
  const n = Number(r?.value ?? 1);
  return Number.isFinite(n) ? Math.max(0, Math.min(PROMOS_PER_HOUR_MAX, Math.floor(n))) : 1;
}

export async function loadPromoConfig(db: D1Database): Promise<PromoConfig> {
  const perHour = await promosPerHour(db);
  const { results } = await db
    .prepare(
      `SELECT p.*, a.audio_url, a.duration_seconds FROM promos p
       JOIN audio_assets a ON a.id = p.audio_asset_id
       WHERE p.active = 1 AND a.type = 'promo' AND a.status = 'published'
         AND p.on_air_title IS NOT NULL AND p.link_url IS NOT NULL AND p.slug IS NOT NULL
       ORDER BY p.audio_asset_id`
    )
    .all<PromoRow & { audio_url: string | null; duration_seconds: number | null }>();
  const promos = results
    .filter((r) => r.audio_url && (r.duration_seconds ?? 0) > 0)
    .map((r) => ({ ...r, channels: parseChannelIds(r.channel_ids) }) as AirablePromo);
  const { results: chans } = await db
    .prepare("SELECT id FROM channels WHERE status = 'live' AND programming_mode = 'autopilot' ORDER BY id")
    .all<{ id: string }>();
  return { perHour, promos, channelIds: chans.map((c) => c.id) };
}

/** Is this promo allowed on this channel on this Paris date (ignoring the daily cap)? */
export function promoAllowed(p: AirablePromo, channelId: string, date: string): boolean {
  if (p.runs_from && date < p.runs_from) return false;
  if (p.runs_to && date > p.runs_to) return false;
  return p.channels ? p.channels.includes(channelId) : true;
}

/**
 * The hours of a day in the order their promo slots are handed out, so a
 * promo with a cap of 4 is spread across the listening day rather than all
 * going out after midnight.
 */
const HOUR_ORDER = [8, 12, 17, 20, 10, 14, 18, 21, 7, 9, 11, 13, 15, 16, 19, 22, 23, 6, 0, 1, 2, 3, 4, 5];

export interface DayPlan {
  /** `${channelId}:${hour}:${k}` -> the promo for the k-th slot of that clock hour on that channel. */
  slots: Map<string, AirablePromo>;
  /** Plays handed out per promo that day. */
  counts: Map<string, number>;
}

const dayPlans = new Map<string, DayPlan>();

/**
 * A Paris day's promo slots: hour by hour (HOUR_ORDER), channel by channel
 * (rotated each hour so no channel always goes first), each slot goes to the
 * eligible promo with the fewest plays so far that day, never past its cap.
 */
export function dayPlan(cfg: PromoConfig, date: string): DayPlan {
  const cacheKey = `${date}|${cfg.perHour}|${cfg.channelIds.join(",")}|${cfg.promos.map((p) => `${p.audio_asset_id}:${p.max_per_day}:${p.runs_from}:${p.runs_to}:${p.channel_ids}`).join(",")}`;
  const hit = dayPlans.get(cacheKey);
  if (hit) return hit;
  const slots = new Map<string, AirablePromo>();
  const counts = new Map<string, number>();
  const tie = new Map(cfg.promos.map((p) => [p.audio_asset_id, hashSeed(`${date}:${p.audio_asset_id}`)]));
  const n = cfg.channelIds.length;
  if (cfg.perHour > 0 && n > 0 && cfg.promos.length > 0) {
    // Round 0: a promo airs in an hour on one channel only, so its plays spread through the day.
    // Round 1: whatever cap is left fills the remaining slots.
    const hoursOf = new Map<string, Set<number>>();
    for (let round = 0; round < 2; round++) {
      HOUR_ORDER.forEach((hour, hi) => {
        for (let ci = 0; ci < n; ci++) {
          const channelId = cfg.channelIds[(ci + hi) % n];
          for (let k = 0; k < cfg.perHour; k++) {
            const key = `${channelId}:${hour}:${k}`;
            if (slots.has(key)) continue;
            const cands = cfg.promos.filter(
              (p) =>
                promoAllowed(p, channelId, date) &&
                (counts.get(p.audio_asset_id) ?? 0) < p.max_per_day &&
                (round > 0 || !hoursOf.get(p.audio_asset_id)?.has(hour))
            );
            if (cands.length === 0) continue;
            // Not the same promo twice in one hour on one channel, when there's another.
            const inHour = new Set(Array.from({ length: cfg.perHour }, (_, j) => slots.get(`${channelId}:${hour}:${j}`)?.audio_asset_id));
            const fresh = cands.filter((p) => !inHour.has(p.audio_asset_id));
            const from = fresh.length ? fresh : cands;
            from.sort(
              (a, b) =>
                (counts.get(a.audio_asset_id) ?? 0) - (counts.get(b.audio_asset_id) ?? 0) ||
                (tie.get(a.audio_asset_id) ?? 0) - (tie.get(b.audio_asset_id) ?? 0)
            );
            const pick = from[0];
            slots.set(key, pick);
            counts.set(pick.audio_asset_id, (counts.get(pick.audio_asset_id) ?? 0) + 1);
            if (!hoursOf.has(pick.audio_asset_id)) hoursOf.set(pick.audio_asset_id, new Set());
            hoursOf.get(pick.audio_asset_id)!.add(hour);
          }
        }
      });
    }
  }
  const plan = { slots, counts };
  if (dayPlans.size > 50) dayPlans.clear();
  dayPlans.set(cacheKey, plan);
  return plan;
}

/** The promos a channel's clock hour was given, in slot order. */
export function hourSlots(cfg: PromoConfig, plan: DayPlan, channelId: string, hour: number): AirablePromo[] {
  const out: AirablePromo[] = [];
  for (let k = 0; k < cfg.perHour; k++) {
    const p = plan.slots.get(`${channelId}:${hour}:${k}`);
    if (p) out.push(p);
  }
  return out;
}

export interface ClockHour {
  date: string; // Paris date
  hour: number; // 0-23
  startMs: number;
  endMs: number;
}

/** The Paris clock hour an instant falls in. */
export function clockHour(ms: number): ClockHour {
  const w = wallClock(ms, PARIS_TZ);
  const startMs = ms - ((w.minutes % 60) * MINUTE + w.seconds * 1000 + (((ms % 1000) + 1000) % 1000));
  return { date: w.date, hour: Math.floor(w.minutes / 60), startMs, endMs: startMs + 60 * MINUTE };
}

/**
 * When the k-th promo of a clock hour on a channel may go out: from a few
 * minutes into the hour (varying by channel and hour, so the channels don't
 * all break together), spaced evenly through the hour, always leaving about
 * half an hour to find a gap between two songs (most songs open with a
 * jingle or an AFG ad over the intro, and a promo never goes before those).
 */
export function slotOpensAt(cfg: PromoConfig, channelId: string, h: ClockHour, k: number): number {
  const span = 60 / Math.max(1, cfg.perHour);
  const spread = Math.max(1, Math.floor(span) - 30);
  const offset = 3 + ((hashSeed(`${channelId}:${h.date}:${h.hour}`) >>> 0) % spread);
  return h.startMs + (offset + k * span) * MINUTE;
}

/**
 * The label a promo carries on the players, the TV and the lock screen
 * (migrations/0027): Kizzi's books are recommendations, an ad for one of his
 * own businesses says it's an ad.
 */
export const PROMO_PILLS: Record<string, string> = {
  recommends: "We Are Radio recommends",
  advert: "Advertisement",
};

/** What the players are told about a promo on air (now-playing's `promo`). */
export interface PromoInfo {
  title: string;
  /** The label's text, e.g. "Advertisement". */
  pill: string;
  link_url: string;
  link_label: string;
  short_url: string;
  cover_url: string | null;
}

export const promoInfo = (p: Pick<PromoRow, "on_air_title" | "link_url" | "link_label" | "slug" | "cover_url" | "pill">, fallbackTitle: string | null): PromoInfo | null =>
  p.link_url && p.slug
    ? {
        title: p.on_air_title || fallbackTitle || "",
        pill: PROMO_PILLS[p.pill] ?? PROMO_PILLS.recommends,
        link_url: p.link_url,
        link_label: p.link_label || "Find out more",
        short_url: `${SHORT_LINK_BASE}${p.slug}`,
        cover_url: p.cover_url,
      }
    : null;

/** Promo details for the audio assets among these ids (any promo, active or not: it may already be on air). */
export async function promoInfoFor(db: D1Database, assetIds: string[]): Promise<Map<string, PromoInfo>> {
  const out = new Map<string, PromoInfo>();
  if (assetIds.length === 0) return out;
  const { results } = await db
    .prepare(
      `SELECT p.*, a.title FROM promos p JOIN audio_assets a ON a.id = p.audio_asset_id
       WHERE a.type = 'promo' AND p.audio_asset_id IN (${assetIds.map(() => "?").join(",")})`
    )
    .bind(...assetIds)
    .all<PromoRow & { title: string }>();
  for (const r of results) {
    const info = promoInfo(r, r.title);
    if (info) out.set(r.audio_asset_id, info);
  }
  return out;
}

/** For the Scheduler's inputs digest: anything that changes which promo airs where. Empty when nothing could air. */
export async function promoDigest(db: D1Database): Promise<string> {
  const r = await db
    .prepare(
      `SELECT
         (SELECT COALESCE(group_concat(p.audio_asset_id || ':' || COALESCE(p.slug,'') || ':' || COALESCE(p.on_air_title,'') || ':' || COALESCE(p.link_url,'')
            || ':' || COALESCE(p.runs_from,'') || ':' || COALESCE(p.runs_to,'') || ':' || p.max_per_day || ':' || COALESCE(p.channel_ids,'')
            || ':' || a.status || ':' || a.duration_seconds), '')
            FROM promos p JOIN audio_assets a ON a.id = p.audio_asset_id WHERE p.active = 1 AND a.type = 'promo') AS promos,
         (SELECT value FROM station_settings WHERE key = 'promos_per_hour') AS per_hour,
         (SELECT group_concat(id) FROM channels WHERE status = 'live' AND programming_mode = 'autopilot') AS channels`
    )
    .first<{ promos: string; per_hour: string | null; channels: string | null }>();
  if (!r?.promos) return "";
  return `${PROMO_RULES}|${r.per_hour}|${r.channels}|${r.promos}`;
}
