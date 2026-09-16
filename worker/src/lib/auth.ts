import type { Context, Next } from "hono";
import type { Env } from "./types";

const SESSION_COOKIE = "kizzi_studio_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

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

export async function createSessionCookie(secret: string): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `studio.${expires}`;
  const sig = await hmac(secret, payload);
  const token = `${payload}.${sig}`;
  // Same-origin now that the app and API are served from one Worker, so
  // Lax is enough and is the safer default.
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

async function isValidSession(cookieHeader: string | undefined, secret: string): Promise<boolean> {
  if (!cookieHeader) return false;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) return false;
  const token = match[1];
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [kind, expires, sig] = parts;
  const payload = `${kind}.${expires}`;
  const expected = await hmac(secret, payload);
  if (expected !== sig) return false;
  if (Number(expires) < Math.floor(Date.now() / 1000)) return false;
  return true;
}

export async function requireStudioAuth(c: Context<{ Bindings: Env }>, next: Next) {
  const ok = await isValidSession(c.req.header("Cookie"), c.env.SESSION_SECRET);
  if (!ok) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
}
