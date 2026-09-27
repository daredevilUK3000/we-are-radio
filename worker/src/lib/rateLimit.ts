import type { Env } from "./types";

/**
 * Throttling for the public forms (Top 3 entries and reminders, the contact
 * page). Counters live in KV, one key per window (the Time Capsule pattern in
 * public.ts). Approximate by nature - KV is eventually consistent - which is
 * fine for throttling: hard rules (entries per person) are enforced in D1.
 *
 * Callers check with overLimit() first, then bump() only once the request
 * has actually been accepted, passing back the counts overLimit() read.
 */
export interface Limit {
  key: string;
  max: number;
  ttl: number;
}

export const hourWindow = () => new Date().toISOString().slice(0, 13);
export const dayWindow = () => new Date().toISOString().slice(0, 10);

export async function overLimit(env: Env, limits: Limit[]): Promise<{ over: boolean; counts: number[] }> {
  const counts = await Promise.all(limits.map(async (l) => Number((await env.CONFIG.get(l.key)) ?? 0)));
  return { over: counts.some((n, i) => n >= limits[i].max), counts };
}

export async function bump(env: Env, limits: Limit[], counts: number[]) {
  await Promise.all(limits.map((l, i) => env.CONFIG.put(l.key, String(counts[i] + 1), { expirationTtl: l.ttl })));
}
