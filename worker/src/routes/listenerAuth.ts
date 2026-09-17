import { Hono } from "hono";
import type { Env } from "../lib/types";
import { createSessionCookie, clearSessionCookie, isValidSession } from "../lib/auth";

export const listenerAuthRoutes = new Hono<{ Bindings: Env }>();

// Single listener account (Kizzi, across her own devices) - see the
// favourites/history deferral note in migrations/0002_favourites_and_history.sql.

listenerAuthRoutes.post("/login", async (c) => {
  const body = await c.req.json<{ password?: string }>().catch(() => ({} as { password?: string }));
  if (!body.password || body.password !== c.env.LISTENER_PASSWORD) {
    return c.json({ error: "invalid password" }, 401);
  }
  const cookie = await createSessionCookie(c.env.SESSION_SECRET, "listener");
  c.header("Set-Cookie", cookie);
  return c.json({ ok: true });
});

listenerAuthRoutes.post("/logout", async (c) => {
  c.header("Set-Cookie", clearSessionCookie("listener"));
  return c.json({ ok: true });
});

// Lets the frontend silently check sign-in state without tripping a 401 on
// every page load for the (normal, expected) anonymous case.
listenerAuthRoutes.get("/session", async (c) => {
  const authenticated = await isValidSession(c.req.header("Cookie"), c.env.SESSION_SECRET, "listener");
  return c.json({ authenticated });
});
