import { Hono } from "hono";
import type { Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";

export const historyRoutes = new Hono<{ Bindings: Env }>();

const ITEM_TABLES: Record<string, string> = {
  track: "tracks",
  programme: "programmes",
};

async function fetchByIds(db: D1Database, table: string, ids: string[]) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db.prepare(`SELECT * FROM ${table} WHERE id IN (${placeholders})`).bind(...ids).all();
  return results;
}

// Distinct recently-played items (most recent play per item), not a raw
// play-by-play log - that's what "recently played" means to a listener.
historyRoutes.get("/", async (c) => {
  const { results: recent } = await c.env.DB.prepare(
    `SELECT item_type, item_id, MAX(played_at) as played_at
     FROM listening_history
     GROUP BY item_type, item_id
     ORDER BY played_at DESC
     LIMIT 50`
  ).all<{ item_type: string; item_id: string; played_at: string }>();

  const idsByType: Record<string, string[]> = { track: [], programme: [] };
  for (const r of recent) idsByType[r.item_type]?.push(r.item_id);

  const [tracks, programmes] = await Promise.all([
    fetchByIds(c.env.DB, "tracks", idsByType.track),
    fetchByIds(c.env.DB, "programmes", idsByType.programme),
  ]);
  const byId = (rows: Record<string, unknown>[]) =>
    Object.fromEntries(rows.map((r) => [r.id as string, r]));
  const itemsByType: Record<string, Record<string, unknown>> = {
    track: byId(tracks),
    programme: byId(programmes),
  };

  const enriched = recent
    .map((r) => ({ ...r, item: itemsByType[r.item_type]?.[r.item_id] ?? null }))
    .filter((r) => r.item !== null);

  return c.json({ history: enriched });
});

historyRoutes.post("/", async (c) => {
  const body = await c.req.json<{ item_type?: string; item_id?: string }>();
  if (!body.item_type || !body.item_id || !ITEM_TABLES[body.item_type]) {
    return c.json({ error: "item_type (track/programme) and item_id are required" }, 400);
  }
  const id = newId("hist");
  await c.env.DB.prepare("INSERT INTO listening_history (id, item_type, item_id, played_at) VALUES (?,?,?,?)")
    .bind(id, body.item_type, body.item_id, nowIso())
    .run();
  return c.json({ ok: true }, 201);
});
