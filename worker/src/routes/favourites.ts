import { Hono } from "hono";
import type { Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";

export const favouriteRoutes = new Hono<{ Bindings: Env }>();

const ITEM_TABLES: Record<string, string> = {
  track: "tracks",
  album: "albums",
  programme: "programmes",
};

async function fetchByIds(db: D1Database, table: string, ids: string[]) {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  const { results } = await db.prepare(`SELECT * FROM ${table} WHERE id IN (${placeholders})`).bind(...ids).all();
  return results;
}

favouriteRoutes.get("/", async (c) => {
  const { results: favourites } = await c.env.DB.prepare(
    "SELECT * FROM favourites ORDER BY created_at DESC"
  ).all<{ id: string; item_type: string; item_id: string; created_at: string }>();

  const idsByType: Record<string, string[]> = { track: [], album: [], programme: [] };
  for (const f of favourites) idsByType[f.item_type]?.push(f.item_id);

  const [tracks, albums, programmes] = await Promise.all([
    fetchByIds(c.env.DB, "tracks", idsByType.track),
    fetchByIds(c.env.DB, "albums", idsByType.album),
    fetchByIds(c.env.DB, "programmes", idsByType.programme),
  ]);
  const byId = (rows: Record<string, unknown>[]) =>
    Object.fromEntries(rows.map((r) => [r.id as string, r]));
  const itemsByType: Record<string, Record<string, unknown>> = {
    track: byId(tracks),
    album: byId(albums),
    programme: byId(programmes),
  };

  const enriched = favourites
    .map((f) => ({ ...f, item: itemsByType[f.item_type]?.[f.item_id] ?? null }))
    .filter((f) => f.item !== null); // the favourited item itself may since have been deleted

  return c.json({ favourites: enriched });
});

favouriteRoutes.post("/", async (c) => {
  const body = await c.req.json<{ item_type?: string; item_id?: string }>();
  if (!body.item_type || !body.item_id || !ITEM_TABLES[body.item_type]) {
    return c.json({ error: "item_type (track/album/programme) and item_id are required" }, 400);
  }
  const id = newId("fav");
  await c.env.DB.prepare(
    `INSERT INTO favourites (id, item_type, item_id, created_at) VALUES (?,?,?,?)
     ON CONFLICT(item_type, item_id) DO NOTHING`
  )
    .bind(id, body.item_type, body.item_id, nowIso())
    .run();
  return c.json({ ok: true }, 201);
});

favouriteRoutes.delete("/:itemType/:itemId", async (c) => {
  await c.env.DB.prepare("DELETE FROM favourites WHERE item_type = ? AND item_id = ?")
    .bind(c.req.param("itemType"), c.req.param("itemId"))
    .run();
  return c.json({ ok: true });
});
