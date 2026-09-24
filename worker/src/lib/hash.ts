import type { Env } from "./types";

/**
 * Keyed hashes for the Top 3 contest (and Likes). Anything used to count or
 * match people - an email, an IP address, the anonymous liker cookie - is
 * stored as an HMAC under HASH_PEPPER, never as the raw value, so a copy of
 * the database alone can't be turned back into addresses. Each kind of value
 * other than emails gets its own prefix, so an IP, a liker id or a token can
 * never hash to the same value as an email.
 *
 * HASH_PEPPER must never change during the competition: every stored hash
 * would stop matching, and people could enter or like twice.
 */

async function hmacBytes(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/** Hex HMAC-SHA256. (lib/auth.ts has the base64url one used for session cookies; that one is left alone.) */
export async function hmacHex(secret: string, message: string): Promise<string> {
  return Array.from(await hmacBytes(secret, message), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One inbox = one person. The same rules will apply to voters in Phase B:
 * trim and lower-case, drop any +tag, and for Gmail drop the dots (Gmail
 * ignores them) and treat googlemail.com as gmail.com.
 */
export function normaliseEmail(raw: string): string {
  const email = raw.trim().toLowerCase();
  const at = email.lastIndexOf("@");
  if (at < 1) return email;
  let local = email.slice(0, at);
  let domain = email.slice(at + 1);
  local = local.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") {
    local = local.replace(/\./g, "");
    domain = "gmail.com";
  }
  return `${local}@${domain}`;
}

// No prefix on the email hash: the voting spec defines it as exactly
// HMAC(HASH_PEPPER, normalised email), and Phase B voters must match it.
export const emailHash = (env: Env, email: string) => hmacHex(env.HASH_PEPPER, normaliseEmail(email));
export const ipHash = (env: Env, ip: string) => hmacHex(env.HASH_PEPPER, `ip:${ip}`);
export const likerHash = (env: Env, id: string) => hmacHex(env.HASH_PEPPER, `liker:${id}`);
export const tokenHash = (env: Env, token: string) => hmacHex(env.HASH_PEPPER, `tok:${token}`);
export const unsubscribeSig = (env: Env, id: string) => hmacHex(env.HASH_PEPPER, `unsub:${id}`);

/** 32 random bytes, base64url - for emailed confirm links. Only its hash is stored. */
export function randomToken(bytes = 32): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** Compares two strings without leaking, through timing, how much of them matched. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
