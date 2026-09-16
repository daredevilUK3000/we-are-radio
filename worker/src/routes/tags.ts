import { Hono } from "hono";
import type { Env } from "../lib/types";

export const tagRoutes = new Hono<{ Bindings: Env }>();

tagRoutes.get("/", async (c) => {
  const { results } = await c.env.DB.prepare("SELECT * FROM tags ORDER BY name ASC").all();
  return c.json({ tags: results });
});
