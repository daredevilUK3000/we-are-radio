import type { Context, Next } from "hono";
import type { Env } from "./types";

type SessionKind = "studio" | "listener";

const SESSION_COOKIE_NAMES: Record<SessionKind, string> = {
  studio: "kizzi_studio_session",
  listener: "kizzi_listener_session",
};

// Listener sessions live longer - it's Kizzi's own devices, signed in once
// and left alone, not a shared/public login worth re-checking weekly.
const SESSION_TTL_SECONDS: Record<SessionKind, number> = {
  studio: 60 * 60 * 24 * 7, // 7 days
  listener: 60 * 60 * 24 * 30, // 30 days
};

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function createSessionCookie(secret: string, kind: SessionKind = "studio"): Promise<string> {
  const ttl = SESSION_TTL_SECONDS[kind];
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const payload = `${kind}.${expires}`;
  const sig = await hmac(secret, payload);
  const token = `${payload}.${sig}`;
  // Same-origin now that the app and API are served from one Worker, so
  // Lax is enough and is the safer default.
  return `${SESSION_COOKIE_NAMES[kind]}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${ttl}`;
}

export function clearSessionCookie(kind: SessionKind = "studio"): string {
  return `${SESSION_COOKIE_NAMES[kind]}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function isValidSession(
  cookieHeader: string | undefined,
  secret: string,
  kind: SessionKind
): Promise<boolean> {
  if (!cookieHeader) return false;
  const cookieName = SESSION_COOKIE_NAMES[kind];
  const match = cookieHeader.match(new RegExp(`${cookieName}=([^;]+)`));
  if (!match) return false;
  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [tokenKind, expires, sig] = parts;
  if (tokenKind !== kind) return false;
  const payload = `${tokenKind}.${expires}`;
  const expected = await hmac(secret, payload);
  if (expected !== sig) return false;
  if (Number(expires) < Math.floor(Date.now() / 1000)) return false;
  return true;
}

export async function requireStudioAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const ok = await isValidSession(c.req.header("Cookie"), c.env.SESSION_SECRET, "studio");
  if (!ok) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
}

export async function requireListenerAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const ok = await isValidSession(c.req.header("Cookie"), c.env.SESSION_SECRET, "listener");
  if (!ok) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
}
