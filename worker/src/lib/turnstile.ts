import type { Env } from "./types";

/**
 * Cloudflare Turnstile check for the contest's public forms (entry, notify).
 * The browser widget hands us a single-use token; siteverify tells us whether
 * a real person earned it, on which of our pages, for which action.
 *
 * Fails closed: if siteverify can't be reached we refuse the request with a
 * "try again" rather than letting an unchecked submission through.
 */

const ALLOWED_HOSTNAMES = ["weareradio.app", "kizzi-radio-api.kizzi.workers.dev", "localhost"];

export type TurnstileResult = { ok: true } | { ok: false; status: 403 | 503; error: string; message: string };

export async function verifyTurnstile(
  env: Env,
  token: string | undefined | null,
  expectedAction: string,
  request: Request
): Promise<TurnstileResult> {
  const failed: TurnstileResult = {
    ok: false,
    status: 403,
    error: "turnstile_failed",
    message: "We couldn't check you're a real person. Please try the check again.",
  };
  if (!token || token.length > 4096) return failed;

  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET ?? "");
  form.append("response", token);
  const ip = request.headers.get("cf-connecting-ip");
  if (ip) form.append("remoteip", ip);
  form.append("idempotency_key", crypto.randomUUID());

  let outcome: { success?: boolean; action?: string; hostname?: string; "error-codes"?: string[] };
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
    if (!res.ok) throw new Error(`siteverify ${res.status}`);
    outcome = await res.json();
  } catch (err) {
    console.error("turnstile siteverify unreachable", err);
    return { ok: false, status: 503, error: "try_again", message: "Something went wrong on our side. Please try again in a minute." };
  }

  if (outcome.success !== true) return failed;
  // Cloudflare's always-pass test secret reports action/hostname as placeholders
  // ("test" / "example.com"), so those two checks are skipped only for it.
  const isTestSecret = env.TURNSTILE_SECRET === "1x0000000000000000000000000000000AA";
  if (!isTestSecret) {
    if (outcome.action !== expectedAction) return failed;
    if (!outcome.hostname || !ALLOWED_HOSTNAMES.includes(outcome.hostname)) return failed;
  }
  return { ok: true };
}
