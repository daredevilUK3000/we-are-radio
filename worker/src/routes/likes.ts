import { Hono } from "hono";
import type { Env } from "../lib/types";
import { nowIso } from "../lib/id";
import { requireSameOrigin } from "../lib/origin";
import { canLikeContestSongs, contestPhase } from "../lib/contest";
import { ipHash, likerHash, randomToken } from "../lib/hash";

/**
 * Likes: any listener can like a song, with no account. Only the Studio ever
 * sees which songs are liked and how often - no public response here carries
 * a count, only whether THIS listener liked something.
 *
 * A listener is an anonymous random id in the wr_liker cookie, set only when
 * they first tap Like (so it's a functional cookie they asked for, not
 * something every page view gets). Only its HMAC is stored.
 *
 * Likes are a signal for Patrick, not a competition metric, and have no
 * effect on voting; on contest songs they're paused while voting runs so a
 * heart can't be mistaken for a vote (lib/contest.ts canLikeContestSongs).
 */

const COOKIE = "wr_liker";
const ITEM_TYPES = ["track", "contest_entry"] as const;
type ItemType = (typeof ITEM_TYPES)[number];
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BOT_PATTERN = /bot|crawl|spider|headless|lighthouse|preview|monitor/i;

// Same in-memory burst brake as routes/analytics.ts: per instance, never
// written anywhere, so a busy like button doesn't spend a KV write per tap.
const PER_MINUTE = 60;
const hits = new Map<string, { n: number; resetAt: number }>();
function tooMany(key: string): boolean {
  const now = Date.now();
  if (hits.size > 5000) hits.clear();
  const h = hits.get(key);
  if (!h || h.resetAt < now) {
    hits.set(key, { n: 1, resetAt: now + 60_000 });
    return false;
  }
  h.n += 1;
  return h.n > PER_MINUTE;
}

const readLiker = (cookieHeader: string | undefined) => {
  const m = cookieHeader?.match(/(?:^|;\s*)wr_liker=([A-Za-z0-9_-]{16,64})/);
  return m ? m[1] : null;
};

const isItemType = (t: unknown): t is ItemType => (ITEM_TYPES as readonly unknown[]).includes(t);

// ----------------------------------------------------------------- public

export const likePublicRoutes = new Hono<{ Bindings: Env }>();
likePublicRoutes.use("*", requireSameOrigin);

/** Whether an item may be liked right now: it must be public, and contest songs only outside voting. */
async function checkLikeable(env: Env, itemType: ItemType, itemId: string): Promise<"ok" | "not_found" | "likes_paused"> {
  if (itemType === "track") {
    const t = await env.DB.prepare("SELECT 1 FROM tracks WHERE id = ? AND status = 'published'").bind(itemId).first();
    return t ? "ok" : "not_found";
  }
  const n = Number(itemId);
  if (!Number.isInteger(n) || n <= 0) return "not_found";
  const e = await env.DB.prepare("SELECT 1 FROM contest_entries WHERE id = ? AND status = 'approved'").bind(n).first();
  if (!e) return "not_found";
  return canLikeContestSongs(await contestPhase(env)) ? "ok" : "likes_paused";
}

likePublicRoutes.post("/", async (c) => {
  if (BOT_PATTERN.test(c.req.header("user-agent") ?? "bot")) return c.json({ error: "not_allowed" }, 403);
  if (tooMany(await ipHash(c.env, c.req.header("cf-connecting-ip") ?? "unknown"))) return c.json({ error: "slow_down" }, 429);

  const body = await c.req.json<{ itemType?: string; itemId?: string | number }>().catch(() => ({}) as Record<string, never>);
  const itemId = String(body.itemId ?? "");
  if (!isItemType(body.itemType) || !ID_PATTERN.test(itemId)) return c.json({ error: "bad_request" }, 400);

  const likeable = await checkLikeable(c.env, body.itemType, itemId);
  if (likeable === "not_found") return c.json({ error: "not_found" }, 404);
  if (likeable === "likes_paused") return c.json({ error: "likes_paused", message: "Likes are paused while voting is open." }, 409);

  let liker = readLiker(c.req.header("Cookie"));
  if (!liker) {
    liker = randomToken(16); // 128 bits
    c.header("Set-Cookie", `${COOKIE}=${liker}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 365}`);
  }
  await c.env.DB.prepare(
    `INSERT INTO likes (item_type, item_id, liker_hash, created_at) VALUES (?,?,?,?)
     ON CONFLICT(item_type, item_id, liker_hash) DO NOTHING`
  )
    .bind(body.itemType, itemId, await likerHash(c.env, liker), nowIso())
    .run();
  return c.json({ liked: true });
});

likePublicRoutes.delete("/:itemType/:itemId", async (c) => {
  if (tooMany(await ipHash(c.env, c.req.header("cf-connecting-ip") ?? "unknown"))) return c.json({ error: "slow_down" }, 429);
  const itemType = c.req.param("itemType");
  const itemId = c.req.param("itemId");
  if (!isItemType(itemType) || !ID_PATTERN.test(itemId)) return c.json({ error: "bad_request" }, 400);
  // Unliking a contest song is paused along with liking, so the hidden state can't shift during voting.
  if (itemType === "contest_entry" && !canLikeContestSongs(await contestPhase(c.env))) {
    return c.json({ error: "likes_paused", message: "Likes are paused while voting is open." }, 409);
  }
  const liker = readLiker(c.req.header("Cookie"));
  if (liker) {
    await c.env.DB.prepare("DELETE FROM likes WHERE item_type = ? AND item_id = ? AND liker_hash = ?")
      .bind(itemType, itemId, await likerHash(c.env, liker))
      .run();
  }
  return c.json({ liked: false });
});

likePublicRoutes.get("/mine", async (c) => {
  const itemType = c.req.query("itemType");
  if (!isItemType(itemType)) return c.json({ error: "bad_request" }, 400);
  const ids = (c.req.query("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => ID_PATTERN.test(s))
    .slice(0, 100);
  const liker = readLiker(c.req.header("Cookie"));
  if (!liker || ids.length === 0) return c.json({ liked: [] });
  const { results } = await c.env.DB.prepare(
    `SELECT item_id FROM likes WHERE item_type = ? AND liker_hash = ? AND item_id IN (${ids.map(() => "?").join(",")})`
  )
    .bind(itemType, await likerHash(c.env, liker), ...ids)
    .all<{ item_id: string }>();
  // Per-listener state, so never shared through a cache.
  c.header("cache-control", "private, no-store");
  return c.json({ liked: results.map((r) => r.item_id) });
});

// ----------------------------------------------------------------- studio

export const likeStudioRoutes = new Hono<{ Bindings: Env }>();

likeStudioRoutes.get("/", async (c) => {
  const itemType = c.req.query("itemType") ?? "all";
  const sort = c.req.query("sort") === "week" ? "likes7d" : "likes";
  const limit = Math.min(500, Math.max(1, Number(c.req.query("limit") ?? 200) || 200));
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  let where = "";
  const params: unknown[] = [weekAgo];
  if (itemType === "track" || itemType === "contest_entry") {
    where = "WHERE l.item_type = ?";
    params.push(itemType);
  }
  params.push(limit);

  const { results } = await c.env.DB.prepare(
    `SELECT l.item_type AS itemType, l.item_id AS itemId,
            COALESCE(t.title, e.title) AS title,
            COALESCE(t.artist, e.creator_name) AS artist,
            COUNT(*) AS likes,
            SUM(CASE WHEN l.created_at >= ? THEN 1 ELSE 0 END) AS likes7d,
            MAX(l.created_at) AS lastLikedAt
     FROM likes l
     LEFT JOIN tracks t ON l.item_type = 'track' AND t.id = l.item_id
     LEFT JOIN contest_entries e ON l.item_type = 'contest_entry' AND e.id = CAST(l.item_id AS INTEGER)
     ${where}
     GROUP BY l.item_type, l.item_id
     ORDER BY ${sort} DESC, likes DESC, lastLikedAt DESC
     LIMIT ?`
  )
    .bind(...params)
    .all();
  return c.json({ items: results });
});
