import { Hono } from "hono";
import type { Env } from "../lib/types";
import { NEED_KEYS } from "../lib/needs";

/**
 * Analytics (handoff: Analytics). Two routers:
 *
 *   analyticsPublicRoutes  - what the listener app calls to log what happens.
 *                            Unauthenticated by nature, so it validates every
 *                            field against a fixed list, checks the content
 *                            exists, caps batch size and rate-limits.
 *   analyticsStudioRoutes  - what the Studio Analytics section reads back.
 *
 * Aggregate only: nothing here identifies a listener (see migrations/0014).
 * No AI, no per-listener cost - a table of rows and some counting queries.
 */

const EVENT_TYPES = ["play_started", "play_completed", "play_skipped"];
const CONTENT_TYPES = ["track", "programme", "channel"];
const SOURCES = ["channel", "album", "programme", "my-mood", "radio-for-you"];
const SITE_EVENT_TYPES = ["visit", "listen_now", "first_play"];
const MAX_BATCH = 20;

// Track and programme ids are prefix_hex but the seeded channels are ch_kizzi_radio,
// so this only screens out junk; whether the row really exists is checked below.
const ID_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;
const SESSION_PATTERN = /^[A-Za-z0-9_-]{8,40}$/;
const BOT_PATTERN = /bot|crawl|spider|headless|lighthouse|preview|monitor/i;

const CONTENT_TABLE: Record<string, string> = { track: "tracks", programme: "programmes", channel: "channels" };

// A best-effort brake per address, held only in memory (never written anywhere):
// enough to stop one client flooding the table, without spending a KV write per
// event. Each Worker instance keeps its own count, so it is a limit on bursts,
// not a hard quota.
const RATE_LIMIT_PER_MINUTE = 150;
const hits = new Map<string, { n: number; resetAt: number }>();
function tooMany(key: string, cost: number): boolean {
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const h = hits.get(key);
  if (!h || h.resetAt < now) {
    hits.set(key, { n: cost, resetAt: now + 60_000 });
    return false;
  }
  h.n += cost;
  return h.n > RATE_LIMIT_PER_MINUTE;
}

const isBot = (ua: string | undefined) => !ua || BOT_PATTERN.test(ua);
const cleanSource = (s: unknown): string | null => {
  const v = String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._ -]/g, "")
    .trim()
    .slice(0, 60);
  return v || null;
};

// ---------------------------------------------------------------- public: log

export const analyticsPublicRoutes = new Hono<{ Bindings: Env }>();

interface ListeningEventInput {
  type?: string;
  content_type?: string;
  content_id?: string | null;
  channel_id?: string | null;
  mood?: string | null;
  source?: string;
  wildcard?: boolean;
  listened_seconds?: number | null;
}

analyticsPublicRoutes.post("/listening", async (c) => {
  const body = await c.req.json<{ events?: ListeningEventInput[] }>().catch(() => ({}) as { events?: ListeningEventInput[] });
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
  if (events.length === 0) return c.json({ logged: 0 });
  // Crawlers and link-preview bots are quietly ignored (a 200, so they don't retry).
  if (isBot(c.req.header("user-agent"))) return c.json({ logged: 0 });
  if (tooMany(c.req.header("cf-connecting-ip") ?? "unknown", events.length)) return c.json({ error: "slow down" }, 429);

  const ts = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const e of events) {
    if (!EVENT_TYPES.includes(String(e.type)) || !CONTENT_TYPES.includes(String(e.content_type))) continue;
    if (!SOURCES.includes(String(e.source))) continue;
    const contentId = e.content_id ? String(e.content_id) : null;
    const channelId = e.channel_id ? String(e.channel_id) : null;
    if (contentId && !ID_PATTERN.test(contentId)) continue;
    if (channelId && !ID_PATTERN.test(channelId)) continue;
    // Only a Radio That Knows You programme is built on the spot, so only it may have no row.
    if (!contentId && !(e.content_type === "programme" && e.source === "radio-for-you")) continue;
    const mood = e.mood && NEED_KEYS.includes(String(e.mood)) ? String(e.mood) : null;
    const listened = Number.isFinite(Number(e.listened_seconds)) ? Math.max(0, Math.min(Math.round(Number(e.listened_seconds)), 86_400)) : null;

    // The content and channel must exist - a made-up id can't put rows in the table.
    const table = CONTENT_TABLE[String(e.content_type)];
    const checks: string[] = [];
    const checkParams: string[] = [];
    if (contentId) {
      checks.push(`EXISTS (SELECT 1 FROM ${table} WHERE id = ?)`);
      checkParams.push(contentId);
    }
    if (channelId) {
      checks.push("EXISTS (SELECT 1 FROM channels WHERE id = ?)");
      checkParams.push(channelId);
    }
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO listening_events
           (event_type, content_type, content_id, channel_id, mood, source, is_wildcard, listened_seconds, timestamp)
         SELECT ?,?,?,?,?,?,?,?,?
         WHERE ${checks.length > 0 ? checks.join(" AND ") : "1"}`
      ).bind(
        e.type,
        e.content_type,
        contentId,
        channelId,
        mood,
        e.source,
        e.wildcard ? 1 : null,
        listened,
        ts,
        ...checkParams
      )
    );
  }
  if (statements.length === 0) return c.json({ logged: 0 });
  const results = await c.env.DB.batch(statements);
  return c.json({ logged: results.reduce((sum, r) => sum + (r.meta?.changes ?? 0), 0) });
});

analyticsPublicRoutes.post("/site", async (c) => {
  const body = await c.req
    .json<{ type?: string; session_id?: string; source?: string }>()
    .catch(() => ({}) as { type?: string; session_id?: string; source?: string });
  if (!SITE_EVENT_TYPES.includes(String(body.type)) || !SESSION_PATTERN.test(String(body.session_id))) {
    return c.json({ logged: 0 });
  }
  if (isBot(c.req.header("user-agent"))) return c.json({ logged: 0 });
  if (tooMany(c.req.header("cf-connecting-ip") ?? "unknown", 1)) return c.json({ error: "slow down" }, 429);

  // A visit is counted once per browser session even if the page is reloaded and
  // the browser re-sends it.
  if (body.type === "visit") {
    const already = await c.env.DB.prepare(
      "SELECT 1 FROM site_events WHERE session_id = ? AND event_type = 'visit' LIMIT 1"
    )
      .bind(body.session_id)
      .first();
    if (already) return c.json({ logged: 0 });
  }
  await c.env.DB.prepare("INSERT INTO site_events (event_type, session_id, source, timestamp) VALUES (?,?,?,?)")
    .bind(body.type, body.session_id, cleanSource(body.source), new Date().toISOString())
    .run();
  return c.json({ logged: 1 });
});

// ---------------------------------------------------------------- studio: read

export const analyticsStudioRoutes = new Hono<{ Bindings: Env }>();

const PERIOD_DAYS = [1, 7, 30, 90, 365, 0]; // 0 = all time
const GROUPS = ["day", "week", "month"] as const;
type Group = (typeof GROUPS)[number];

// Timestamps are ISO strings, so the date part is just a substring - no date
// parsing to go wrong. A week is labelled by its Monday.
const BUCKET: Record<Group, string> = {
  day: "substr(timestamp, 1, 10)",
  week: "date(substr(timestamp, 1, 10), '-6 days', 'weekday 1')",
  month: "substr(timestamp, 1, 7)",
};

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const mondayOf = (day: string) => {
  const d = new Date(day + "T00:00:00Z");
  const back = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  return isoDay(d);
};

// Every bucket between two days, so a quiet day shows as a zero rather than a gap.
function bucketsBetween(from: string, to: string, group: Group): string[] {
  const out: string[] = [];
  if (group === "month") {
    let [y, m] = from.slice(0, 7).split("-").map(Number);
    const [ty, tm] = to.slice(0, 7).split("-").map(Number);
    while (y < ty || (y === ty && m <= tm)) {
      out.push(`${y}-${String(m).padStart(2, "0")}`);
      if (++m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  }
  const step = group === "week" ? 7 : 1;
  const cursor = new Date((group === "week" ? mondayOf(from) : from) + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (cursor <= end && out.length < 800) {
    out.push(isoDay(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + step);
  }
  return out;
}

const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

analyticsStudioRoutes.get("/", async (c) => {
  const daysParam = Number(c.req.query("days") ?? 30);
  const days = PERIOD_DAYS.includes(daysParam) ? daysParam : 30;
  const groupParam = c.req.query("group");
  const group: Group = GROUPS.includes(groupParam as Group) ? (groupParam as Group) : days > 90 || days === 0 ? "month" : days > 14 ? "week" : "day";
  const since = days > 0 ? new Date(Date.now() - days * 86_400_000).toISOString() : "0000";
  const db = c.env.DB;
  const bucket = BUCKET[group];

  // The same-length period just before this one, so every headline number can say
  // "up/down versus last time" - that comparison is the point of running this before the launch.
  const previousSince = days > 0 ? new Date(Date.now() - 2 * days * 86_400_000).toISOString() : null;
  const previousTotals = async () => {
    if (!previousSince) return null;
    const [listening, visits] = await Promise.all([
      db
        .prepare(
          `SELECT
             SUM(event_type = 'play_started' AND content_type = 'track') AS songs_started,
             SUM(event_type = 'play_completed' AND content_type = 'track') AS songs_completed,
             SUM(event_type = 'play_skipped' AND content_type = 'track') AS songs_skipped,
             SUM(event_type = 'play_started' AND content_type = 'programme') AS programmes_started,
             SUM(event_type = 'play_started' AND content_type = 'channel') AS tune_ins
           FROM listening_events WHERE timestamp >= ? AND timestamp < ?`
        )
        .bind(previousSince, since)
        .first<Record<string, number>>(),
      db
        .prepare(
          "SELECT COUNT(DISTINCT session_id) AS n FROM site_events WHERE event_type = 'visit' AND timestamp >= ? AND timestamp < ?"
        )
        .bind(previousSince, since)
        .first<{ n: number }>(),
    ]);
    const done = (listening?.songs_completed ?? 0) + (listening?.songs_skipped ?? 0);
    return {
      songs_started: listening?.songs_started ?? 0,
      programmes_started: listening?.programmes_started ?? 0,
      tune_ins: listening?.tune_ins ?? 0,
      visits: visits?.n ?? 0,
      song_completion_rate: rate(listening?.songs_completed ?? 0, done),
      song_skip_rate: rate(listening?.songs_skipped ?? 0, done),
    };
  };

  const [series, visitSeries, totalsRow, topTracks, topProgrammes, channels, moods, rfySongs, skipped, funnel, sources, span, recent, previous] =
    await Promise.all([
      db
        .prepare(
          `SELECT ${bucket} AS bucket,
             SUM(event_type = 'play_started' AND content_type = 'track') AS songs,
             SUM(event_type = 'play_started' AND content_type = 'programme') AS programmes,
             SUM(event_type = 'play_started' AND content_type = 'channel') AS tune_ins
           FROM listening_events WHERE timestamp >= ? GROUP BY bucket`
        )
        .bind(since)
        .all<{ bucket: string; songs: number; programmes: number; tune_ins: number }>(),
      db
        .prepare(
          `SELECT ${bucket} AS bucket, COUNT(DISTINCT session_id) AS visits
           FROM site_events WHERE event_type = 'visit' AND timestamp >= ? GROUP BY bucket`
        )
        .bind(since)
        .all<{ bucket: string; visits: number }>(),
      db
        .prepare(
          `SELECT
             SUM(event_type = 'play_started' AND content_type = 'track') AS songs_started,
             SUM(event_type = 'play_completed' AND content_type = 'track') AS songs_completed,
             SUM(event_type = 'play_skipped' AND content_type = 'track') AS songs_skipped,
             SUM(event_type = 'play_started' AND content_type = 'programme') AS programmes_started,
             SUM(event_type = 'play_completed' AND content_type = 'programme') AS programmes_completed,
             SUM(event_type = 'play_skipped' AND content_type = 'programme') AS programmes_abandoned,
             SUM(event_type = 'play_started' AND content_type = 'channel') AS tune_ins,
             COUNT(*) AS events
           FROM listening_events WHERE timestamp >= ?`
        )
        .bind(since)
        .first<Record<string, number>>(),
      db
        .prepare(
          `SELECT e.content_id AS id, t.title, t.artist, a.title AS album,
             SUM(e.event_type = 'play_started') AS plays,
             SUM(e.event_type = 'play_completed') AS completed,
             SUM(e.event_type = 'play_skipped') AS skipped,
             AVG(CASE WHEN e.event_type = 'play_skipped' THEN e.listened_seconds END) AS avg_seconds_when_skipped
           FROM listening_events e
           LEFT JOIN tracks t ON t.id = e.content_id
           LEFT JOIN albums a ON a.id = t.album_id
           WHERE e.content_type = 'track' AND e.timestamp >= ?
           GROUP BY e.content_id ORDER BY plays DESC, completed DESC LIMIT 50`
        )
        .bind(since)
        .all(),
      db
        .prepare(
          `SELECT e.content_id AS id, p.title, p.show_name,
             SUM(e.event_type = 'play_started') AS plays,
             SUM(e.event_type = 'play_completed') AS completed,
             SUM(e.event_type = 'play_skipped') AS abandoned
           FROM listening_events e LEFT JOIN programmes p ON p.id = e.content_id
           WHERE e.content_type = 'programme' AND e.content_id IS NOT NULL AND e.timestamp >= ?
           GROUP BY e.content_id ORDER BY plays DESC LIMIT 50`
        )
        .bind(since)
        .all(),
      db
        .prepare(
          `SELECT e.channel_id AS id, ch.name,
             SUM(e.content_type = 'channel' AND e.event_type = 'play_started') AS tune_ins,
             SUM(e.content_type = 'track' AND e.event_type = 'play_started') AS song_plays,
             SUM(e.content_type = 'track' AND e.event_type = 'play_completed') AS songs_completed,
             SUM(e.content_type = 'track' AND e.event_type = 'play_skipped') AS songs_skipped
           FROM listening_events e LEFT JOIN channels ch ON ch.id = e.channel_id
           WHERE e.channel_id IS NOT NULL AND e.timestamp >= ?
           GROUP BY e.channel_id ORDER BY tune_ins DESC, song_plays DESC`
        )
        .bind(since)
        .all(),
      db
        .prepare(
          `SELECT mood,
             SUM(content_type = 'programme' AND event_type = 'play_started') AS programmes_started,
             SUM(content_type = 'programme' AND event_type = 'play_completed') AS programmes_finished,
             SUM(content_type = 'programme' AND event_type = 'play_skipped') AS programmes_abandoned,
             SUM(content_type = 'track' AND event_type = 'play_started') AS songs_started,
             SUM(content_type = 'track' AND event_type = 'play_completed') AS songs_completed,
             SUM(content_type = 'track' AND event_type = 'play_skipped') AS songs_skipped,
             SUM(content_type = 'track' AND is_wildcard = 1 AND event_type = 'play_completed') AS wild_completed,
             SUM(content_type = 'track' AND is_wildcard = 1 AND event_type = 'play_skipped') AS wild_skipped,
             SUM(content_type = 'track' AND COALESCE(is_wildcard, 0) = 0 AND event_type = 'play_completed') AS main_completed,
             SUM(content_type = 'track' AND COALESCE(is_wildcard, 0) = 0 AND event_type = 'play_skipped') AS main_skipped,
             AVG(CASE WHEN content_type = 'track' AND event_type = 'play_skipped' THEN listened_seconds END) AS avg_seconds_when_skipped
           FROM listening_events
           WHERE source = 'radio-for-you' AND mood IS NOT NULL AND timestamp >= ?
           GROUP BY mood`
        )
        .bind(since)
        .all<Record<string, number | string | null>>(),
      // The songs that lose people inside Radio That Knows You, mood by mood.
      db
        .prepare(
          `SELECT e.content_id AS id, t.title, t.artist, e.mood,
             MAX(COALESCE(e.is_wildcard, 0)) AS is_wildcard,
             SUM(e.event_type = 'play_started') AS plays,
             SUM(e.event_type = 'play_completed') AS completed,
             SUM(e.event_type = 'play_skipped') AS skipped
           FROM listening_events e LEFT JOIN tracks t ON t.id = e.content_id
           WHERE e.source = 'radio-for-you' AND e.content_type = 'track' AND e.mood IS NOT NULL AND e.timestamp >= ?
           GROUP BY e.content_id, e.mood
           HAVING (completed + skipped) >= 3
           ORDER BY (skipped * 1.0 / (completed + skipped)) DESC, skipped DESC LIMIT 30`
        )
        .bind(since)
        .all(),
      // Regular playback (everything except Radio That Knows You, which has its own view).
      db
        .prepare(
          `SELECT e.content_id AS id, t.title, t.artist, a.title AS album,
             SUM(e.event_type = 'play_started') AS plays,
             SUM(e.event_type = 'play_completed') AS completed,
             SUM(e.event_type = 'play_skipped') AS skipped,
             AVG(CASE WHEN e.event_type = 'play_skipped' THEN e.listened_seconds END) AS avg_seconds_when_skipped
           FROM listening_events e
           LEFT JOIN tracks t ON t.id = e.content_id
           LEFT JOIN albums a ON a.id = t.album_id
           WHERE e.content_type = 'track' AND e.source <> 'radio-for-you' AND e.timestamp >= ?
           GROUP BY e.content_id
           HAVING (completed + skipped) >= 3
           ORDER BY (skipped * 1.0 / (completed + skipped)) DESC, skipped DESC LIMIT 50`
        )
        .bind(since)
        .all(),
      db
        .prepare(
          "SELECT event_type, COUNT(DISTINCT session_id) AS n FROM site_events WHERE timestamp >= ? GROUP BY event_type"
        )
        .bind(since)
        .all<{ event_type: string; n: number }>(),
      db
        .prepare(
          `SELECT COALESCE(v.source, 'direct') AS source,
             COUNT(DISTINCT v.session_id) AS visits,
             COUNT(DISTINCT n.session_id) AS pressed_listen_now,
             COUNT(DISTINCT p.session_id) AS played
           FROM site_events v
           LEFT JOIN site_events n ON n.session_id = v.session_id AND n.event_type = 'listen_now'
           LEFT JOIN site_events p ON p.session_id = v.session_id AND p.event_type = 'first_play'
           WHERE v.event_type = 'visit' AND v.timestamp >= ?
           GROUP BY COALESCE(v.source, 'direct') ORDER BY visits DESC LIMIT 40`
        )
        .bind(since)
        .all(),
      db
        .prepare(
          `SELECT (SELECT MIN(timestamp) FROM listening_events) AS first_listening,
                  (SELECT MIN(timestamp) FROM site_events) AS first_site`
        )
        .first<{ first_listening: string | null; first_site: string | null }>(),
      db
        .prepare(
          `SELECT (SELECT MAX(timestamp) FROM listening_events) AS last_listening,
                  (SELECT MAX(timestamp) FROM site_events) AS last_site,
                  (SELECT COUNT(*) FROM listening_events) AS total_listening,
                  (SELECT COUNT(*) FROM site_events) AS total_site`
        )
        .first<{ last_listening: string | null; last_site: string | null; total_listening: number; total_site: number }>(),
      previousTotals(),
    ]);

  // Fill the timeline so quiet days show as zeros.
  const byBucket = new Map<string, { bucket: string; songs: number; programmes: number; tune_ins: number; visits: number }>();
  const earliest = [span?.first_listening, span?.first_site].filter(Boolean).sort()[0]?.slice(0, 10);
  const startDay = days > 0 ? since.slice(0, 10) : (earliest ?? isoDay(new Date()));
  for (const b of bucketsBetween(startDay, isoDay(new Date()), group)) {
    byBucket.set(b, { bucket: b, songs: 0, programmes: 0, tune_ins: 0, visits: 0 });
  }
  for (const r of series.results) {
    const row = byBucket.get(r.bucket);
    if (row) Object.assign(row, { songs: r.songs, programmes: r.programmes, tune_ins: r.tune_ins });
  }
  for (const r of visitSeries.results) {
    const row = byBucket.get(r.bucket);
    if (row) row.visits = r.visits;
  }

  const t = totalsRow ?? {};
  const closedSongs = (t.songs_completed ?? 0) + (t.songs_skipped ?? 0);
  const closedProgrammes = (t.programmes_completed ?? 0) + (t.programmes_abandoned ?? 0);
  const funnelCounts = Object.fromEntries(funnel.results.map((r) => [r.event_type, r.n]));

  // Rates count only plays that have ended one way or the other, so a song that
  // is still playing (or a tab that was closed) can't drag a percentage down.
  const withRates = <T extends Record<string, unknown>>(rows: T[], done: string, other: string) =>
    rows.map((r) => ({ ...r, finished_rate: rate(Number(r[done] ?? 0), Number(r[done] ?? 0) + Number(r[other] ?? 0)) }));

  const moodRows = moods.results.map((m) => {
    const n = (k: string) => Number(m[k] ?? 0);
    return {
      mood: m.mood,
      programmes_started: n("programmes_started"),
      programmes_finished: n("programmes_finished"),
      programmes_abandoned: n("programmes_abandoned"),
      programme_finish_rate: rate(n("programmes_finished"), n("programmes_finished") + n("programmes_abandoned")),
      songs_started: n("songs_started"),
      songs_completed: n("songs_completed"),
      songs_skipped: n("songs_skipped"),
      song_completion_rate: rate(n("songs_completed"), n("songs_completed") + n("songs_skipped")),
      main_completion_rate: rate(n("main_completed"), n("main_completed") + n("main_skipped")),
      main_songs: n("main_completed") + n("main_skipped"),
      wildcard_completion_rate: rate(n("wild_completed"), n("wild_completed") + n("wild_skipped")),
      wildcard_songs: n("wild_completed") + n("wild_skipped"),
      avg_seconds_when_skipped: m.avg_seconds_when_skipped == null ? null : Math.round(Number(m.avg_seconds_when_skipped)),
    };
  });

  return c.json({
    period: { days, since: days > 0 ? since : null, group },
    status: {
      last_listening_event: recent?.last_listening ?? null,
      last_site_event: recent?.last_site ?? null,
      total_listening_events: recent?.total_listening ?? 0,
      total_site_events: recent?.total_site ?? 0,
      collecting_since: earliest ?? null,
    },
    totals: {
      songs_started: t.songs_started ?? 0,
      songs_completed: t.songs_completed ?? 0,
      songs_skipped: t.songs_skipped ?? 0,
      song_completion_rate: rate(t.songs_completed ?? 0, closedSongs),
      song_skip_rate: rate(t.songs_skipped ?? 0, closedSongs),
      programmes_started: t.programmes_started ?? 0,
      programmes_completed: t.programmes_completed ?? 0,
      programmes_abandoned: t.programmes_abandoned ?? 0,
      programme_completion_rate: rate(t.programmes_completed ?? 0, closedProgrammes),
      tune_ins: t.tune_ins ?? 0,
      visits: funnelCounts.visit ?? 0,
      pressed_listen_now: funnelCounts.listen_now ?? 0,
      played_something: funnelCounts.first_play ?? 0,
    },
    previous,
    series: Array.from(byBucket.values()),
    top_tracks: withRates(topTracks.results as Record<string, unknown>[], "completed", "skipped"),
    top_programmes: withRates(topProgrammes.results as Record<string, unknown>[], "completed", "abandoned"),
    channels: withRates(channels.results as Record<string, unknown>[], "songs_completed", "songs_skipped"),
    radio_for_you: {
      moods: moodRows,
      songs_that_lose_people: withRates(rfySongs.results as Record<string, unknown>[], "completed", "skipped"),
    },
    most_skipped: withRates(skipped.results as Record<string, unknown>[], "completed", "skipped").map((r) => ({
      ...r,
      skip_rate: rate(Number((r as Record<string, unknown>).skipped ?? 0), Number((r as Record<string, unknown>).completed ?? 0) + Number((r as Record<string, unknown>).skipped ?? 0)),
    })),
    funnel: {
      visits: funnelCounts.visit ?? 0,
      pressed_listen_now: funnelCounts.listen_now ?? 0,
      played_something: funnelCounts.first_play ?? 0,
      sources: sources.results,
    },
  });
});
