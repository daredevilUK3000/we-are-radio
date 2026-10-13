import { Hono } from "hono";
import type { Env } from "../lib/types";
import { nowIso } from "../lib/id";
import { parseChannelIds, PROMO_PILLS, PROMOS_PER_HOUR_MAX, promosPerHour, SHORT_LINK_BASE, type PromoRow } from "../lib/promos";
import { DAY, parisDate, parisWallClockToUtcMs } from "../lib/scheduler/time";

/**
 * House promos (handoff_house_promos.md, migrations/0026).
 * - promoGoRoutes: weareradio.app/go/<slug>, the short link every button, the
 *   TV's QR code and Kizzi on air point at. Counts one click, then redirects.
 * - promoStudioRoutes: the Audio page's Promos tab.
 */

// ---------------------------------------------------------------- /go/<slug>

export const promoGoRoutes = new Hono<{ Bindings: Env }>();

/** ?s= on the short link: where the click came from. Anything else (typed, said on air) is "direct". */
const CLICK_SOURCES: Record<string, string> = { player: "player", jp: "just_played", tv: "tv" };
const BOT_PATTERN = /bot|crawl|spider|headless|lighthouse|preview|monitor|facebookexternalhit|slurp/i;

// A best-effort brake per address, held only in memory (as routes/analytics.ts): bursts, not a quota.
const hits = new Map<string, { n: number; resetAt: number }>();
function tooMany(key: string): boolean {
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const h = hits.get(key);
  if (!h || h.resetAt < now) {
    hits.set(key, { n: 1, resetAt: now + 60_000 });
    return false;
  }
  return ++h.n > 30;
}

promoGoRoutes.get("/:slug", async (c) => {
  const slug = c.req.param("slug").toLowerCase();
  const row = await c.env.DB.prepare(
    `SELECT p.audio_asset_id, p.link_url FROM promos p JOIN audio_assets a ON a.id = p.audio_asset_id
     WHERE p.slug = ? AND p.active = 1 AND a.type = 'promo' AND p.link_url IS NOT NULL`
  )
    .bind(slug)
    .first<{ audio_asset_id: string; link_url: string }>();
  const noStore = { "Cache-Control": "no-store" };
  // Unknown or switched off: the home page, never an error.
  if (!row || !/^https:\/\//i.test(row.link_url)) return c.redirect("/", 302);

  const ua = c.req.header("user-agent");
  if (ua && !BOT_PATTERN.test(ua) && !tooMany(c.req.header("cf-connecting-ip") ?? "unknown")) {
    const source = CLICK_SOURCES[c.req.query("s") ?? ""] ?? "direct";
    c.executionCtx.waitUntil(
      c.env.DB.prepare("INSERT INTO promo_clicks (audio_asset_id, source, timestamp) VALUES (?,?,?)")
        .bind(row.audio_asset_id, source, nowIso())
        .run()
        .catch(() => {})
    );
  }
  return new Response(null, { status: 302, headers: { Location: row.link_url, ...noStore } });
});

// ---------------------------------------------------------------- Studio

export const promoStudioRoutes = new Hono<{ Bindings: Env }>();

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Every promo with its settings (defaults where it has none yet), plays and clicks, and the station setting.
promoStudioRoutes.get("/", async (c) => {
  const now = Date.now();
  const todayStart = parisWallClockToUtcMs(parisDate(now), 0);
  const weekAgoMs = now - 7 * DAY;
  const weekAgo = new Date(weekAgoMs).toISOString();
  const monthAgo = new Date(now - 30 * DAY).toISOString();
  const { results } = await c.env.DB.prepare(
    `SELECT a.id, a.title, a.audio_url, a.duration_seconds, a.status, a.created_at,
            p.on_air_title, p.link_url, COALESCE(p.link_label, 'Find out more') AS link_label, p.slug, p.cover_url,
            COALESCE(p.active, 0) AS active, p.runs_from, p.runs_to, COALESCE(p.max_per_day, 4) AS max_per_day, p.channel_ids, COALESCE(p.pill, 'recommends') AS pill,
            (SELECT COUNT(*) FROM sched_aired s WHERE s.audio_asset_id = a.id AND s.starts_at_ms >= ?1 AND s.starts_at_ms <= ?3) AS plays_today,
            (SELECT COUNT(*) FROM sched_aired s WHERE s.audio_asset_id = a.id AND s.starts_at_ms >= ?2 AND s.starts_at_ms <= ?3) AS plays_7d,
            (SELECT COUNT(*) FROM promo_clicks k WHERE k.audio_asset_id = a.id AND k.timestamp >= ?4) AS clicks_7d,
            (SELECT COUNT(*) FROM promo_clicks k WHERE k.audio_asset_id = a.id AND k.timestamp >= ?5) AS clicks_30d
     FROM audio_assets a LEFT JOIN promos p ON p.audio_asset_id = a.id
     WHERE a.type = 'promo' ORDER BY a.created_at DESC`
  )
    .bind(todayStart, weekAgoMs, now, weekAgo, monthAgo)
    .all<Record<string, unknown> & { channel_ids: string | null; slug: string | null }>();
  const { results: channels } = await c.env.DB.prepare("SELECT id, name, slug FROM channels WHERE status = 'live' ORDER BY created_at ASC").all();
  return c.json({
    promos_per_hour: await promosPerHour(c.env.DB),
    promos_per_hour_max: PROMOS_PER_HOUR_MAX,
    channels,
    promos: results.map((r) => ({
      ...r,
      channel_ids: parseChannelIds(r.channel_ids),
      short_url: r.slug ? `${SHORT_LINK_BASE}${r.slug}` : null,
    })),
  });
});

promoStudioRoutes.put("/settings", async (c) => {
  const body = await c.req.json<{ promos_per_hour?: number }>().catch(() => ({}) as { promos_per_hour?: number });
  const n = Number(body.promos_per_hour);
  if (!Number.isInteger(n) || n < 0 || n > PROMOS_PER_HOUR_MAX) return c.json({ error: `Choose 0 to ${PROMOS_PER_HOUR_MAX} promos an hour.` }, 400);
  await c.env.DB.prepare(
    `INSERT INTO station_settings (key, value, updated_at) VALUES ('promos_per_hour', ?1, ?2)
     ON CONFLICT(key) DO UPDATE SET value = ?1, updated_at = ?2`
  )
    .bind(String(n), nowIso())
    .run();
  return c.json({ ok: true, promos_per_hour: n });
});

interface PromoBody {
  on_air_title?: string;
  link_url?: string;
  link_label?: string;
  slug?: string;
  cover_url?: string | null;
  active?: boolean;
  runs_from?: string | null;
  runs_to?: string | null;
  max_per_day?: number;
  channel_ids?: string[] | null;
  pill?: string;
}

// Save a promo's settings (all of them, as the edit form sends).
promoStudioRoutes.put("/:id", async (c) => {
  const id = c.req.param("id");
  const asset = await c.env.DB.prepare("SELECT id FROM audio_assets WHERE id = ? AND type = 'promo'").bind(id).first();
  if (!asset) return c.json({ error: "not found" }, 404);
  const b = await c.req.json<PromoBody>().catch(() => ({}) as PromoBody);

  const title = String(b.on_air_title ?? "").trim();
  if (!title || title.length > 80) return c.json({ error: "An on-air title is needed, up to 80 characters." }, 400);
  const link = String(b.link_url ?? "").trim();
  let linkOk = false;
  try {
    linkOk = /^https:\/\//i.test(link) && !!new URL(link).hostname && link.length <= 500;
  } catch {
    linkOk = false;
  }
  if (!linkOk) return c.json({ error: "The link must be a full https:// address." }, 400);
  const label = String(b.link_label ?? "").trim() || "Find out more";
  if (label.length > 30) return c.json({ error: "Keep the button label to 30 characters." }, 400);
  const slug = String(b.slug ?? "").trim().toLowerCase();
  if (!SLUG.test(slug)) return c.json({ error: "The short link needs lower-case letters, numbers and hyphens, e.g. wedding." }, 400);
  const taken = await c.env.DB.prepare("SELECT 1 FROM promos WHERE slug = ? AND audio_asset_id != ?").bind(slug, id).first();
  if (taken) return c.json({ error: `weareradio.app/go/${slug} is already used by another promo.` }, 409);
  const from = b.runs_from ? String(b.runs_from) : null;
  const to = b.runs_to ? String(b.runs_to) : null;
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return c.json({ error: "Dates must be YYYY-MM-DD." }, 400);
  if (from && to && from > to) return c.json({ error: "The run ends before it starts." }, 400);
  const max = Number(b.max_per_day ?? 4);
  if (!Number.isInteger(max) || max < 1 || max > 48) return c.json({ error: "Plays per day must be 1 to 48." }, 400);
  let channels: string[] | null = null;
  if (Array.isArray(b.channel_ids)) {
    const { results } = await c.env.DB.prepare("SELECT id FROM channels").all<{ id: string }>();
    const known = new Set(results.map((r) => r.id));
    channels = [...new Set(b.channel_ids.filter((x) => typeof x === "string" && known.has(x)))].sort();
    if (channels.length === 0) return c.json({ error: "Choose at least one channel, or all of them." }, 400);
  }
  const pill = b.pill ?? "recommends";
  if (!(pill in PROMO_PILLS)) return c.json({ error: "The label must be recommends or advert." }, 400);
  const cover = b.cover_url ? String(b.cover_url).slice(0, 300) : null;

  await c.env.DB.prepare(
    `INSERT INTO promos (audio_asset_id, on_air_title, link_url, link_label, slug, cover_url, active, runs_from, runs_to, max_per_day, channel_ids, updated_at, pill)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
     ON CONFLICT(audio_asset_id) DO UPDATE SET on_air_title = ?2, link_url = ?3, link_label = ?4, slug = ?5, cover_url = ?6,
       active = ?7, runs_from = ?8, runs_to = ?9, max_per_day = ?10, channel_ids = ?11, updated_at = ?12, pill = ?13`
  )
    .bind(id, title, link, label, slug, cover, b.active ? 1 : 0, from, to, max, channels ? JSON.stringify(channels) : null, nowIso(), pill)
    .run();
  return c.json({ ok: true });
});

// The on/off switch on its own (the list's toggle). Switching on needs the promo set up first.
promoStudioRoutes.put("/:id/active", async (c) => {
  const id = c.req.param("id");
  const b = await c.req.json<{ active?: boolean }>().catch(() => ({}) as { active?: boolean });
  const row = await c.env.DB.prepare(
    "SELECT p.* FROM promos p JOIN audio_assets a ON a.id = p.audio_asset_id WHERE p.audio_asset_id = ? AND a.type = 'promo'"
  )
    .bind(id)
    .first<PromoRow>();
  if (b.active && (!row || !row.on_air_title || !row.link_url || !row.slug)) {
    return c.json({ error: "Set the title, link and short link first (Edit)." }, 400);
  }
  if (!row) return c.json({ ok: true });
  await c.env.DB.prepare("UPDATE promos SET active = ?, updated_at = ? WHERE audio_asset_id = ?").bind(b.active ? 1 : 0, nowIso(), id).run();
  return c.json({ ok: true });
});
