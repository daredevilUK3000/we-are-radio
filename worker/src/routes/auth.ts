import { Hono } from "hono";
import type { Env } from "../lib/types";
import { createSessionCookie, clearSessionCookie } from "../lib/auth";

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
  if (!body.password || body.password !== c.env.STUDIO_PASSWORD) {
    return c.json({ error: "invalid password" }, 401);
  }
  const cookie = await createSessionCookie(c.env.SESSION_SECRET);
  c.header("Set-Cookie", cookie);
  return c.json({ ok: true });
});

authRoutes.post("/logout", async (c) => {
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ ok: true });
});
