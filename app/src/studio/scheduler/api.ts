import { ApiError } from "../../api/client";

/** The Studio's Scheduler API (worker/src/routes/scheduler.ts). */

const BASE = `${import.meta.env.VITE_API_ORIGIN ?? ""}/studio/api/scheduler`;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: "include",
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText, { code: body.error, friendly: body.message, field: body.field });
  return body as T;
}

export interface SchedItem {
  airing_id: string;
  starts_at_ms: number;
  ends_at_ms: number;
  offset_ms: number;
  file_ms: number;
  trimmed_ms: number;
  item_type: string;
  chip: "SONG" | "JINGLE" | "LINK" | "PROMO" | "CAPSULE" | "FEATURE";
  label: string | null;
  artist: string | null;
  album: string | null;
  artwork_url: string | null;
  track_id: string | null;
  audio_asset_id: string | null;
  source: string;
  source_line: string;
  reasons: string[];
  block: { id: string; name: string; colour: string } | null;
  version: number;
}

export interface GridNow {
  now: { id?: string; name: string; description: string; start_ms: number; end_ms: number; colour: string } | null;
  next: { name: string; start_ms: number } | null;
  mismatch: { expected: string } | null;
  has_grid?: boolean;
}

export interface OverviewChannel {
  id: string;
  slug: string;
  name: string;
  emoji: string | null;
  status: string;
  mode: string;
  enabled: boolean;
  state: "scheduler" | "shadow" | "fallback" | "not_live";
  live_version: number;
  horizon_ms: number | null;
  shadow: { checks: number; mismatches: number; since_ms: number | null; paused_until_ms: number | null; eligibility: { ok: boolean; reason: string } };
  on_air: SchedItem | null;
  grid: GridNow;
  health: "red" | "amber" | "green" | "grey";
  health_counts: { red: number; amber: number };
}

export interface Timeline {
  now_ms: number;
  channel: { id: string; slug: string; name: string; emoji: string | null };
  enabled: boolean;
  fallback: boolean;
  live_version: number;
  horizon_ms: number | null;
  on_air: SchedItem | null;
  up_next: SchedItem[];
  recent: { airing_id: string; label: string; starts_at_ms: number; actual_end_ms: number | null; ended_how: string | null; item_type: string }[];
  grid: GridNow;
  recovery: { anchor_ms: number; kind: string } | null;
}

export interface HealthCheck {
  id: string;
  channelId: string;
  channelSlug: string;
  channelName: string;
  level: "red" | "amber" | "green" | "grey";
  title: string;
  detail: string;
  action?: "review" | "fallback" | "history" | "grid" | "shadow";
}

export interface LibraryResult {
  id: string;
  kind: string;
  title: string;
  artist?: string | null;
  album?: string | null;
  duration_seconds: number;
  last_aired_ms: number | null;
  track_id?: string;
  audio_asset_id?: string;
}

export interface GridBlock {
  id: string;
  name: string;
  description: string;
  days_mask: number;
  start_min: number;
  end_min: number;
  fill_kind: "programme" | "autopilot";
  programme_id: string | null;
  tags_any: string[];
  colour: "blue" | "purple" | "gold" | "green";
  active: number | boolean;
  updated_at_ms: number;
}

export interface GridPayload {
  channel: { id: string; slug: string; name: string };
  blocks: GridBlock[];
  week: { key: string; date: string; occurrences: { block_id: string; start_ms: number; end_ms: number }[] }[];
  programmes: { id: string; title: string; duration_seconds: number | null; items: number }[];
  tags: string[];
  channel_tags: string[];
  now_ms: number;
  enabled: boolean;
  live_version: number;
}

export type ActionBody = {
  action: "play_now" | "skip" | "insert_next" | "replace" | "insert_jingle" | "back_on_schedule";
  expected_version: number;
  item?: { track_id?: string; audio_asset_id?: string };
  airing_id?: string;
};

export interface ActionResult {
  ok: true;
  version: number;
  previous: number;
  message: string;
}

const json = (body: unknown) => ({ method: "POST", body: JSON.stringify(body) });

export const schedApi = {
  overview: () => call<{ now_ms: number; channels: OverviewChannel[] }>("/overview"),
  health: (fresh = false) => call<{ now_ms: number; checks: HealthCheck[] }>(`/health${fresh ? "?fresh=1" : ""}`),
  timeline: (slug: string, minutes = 120) => call<Timeline>(`/channels/${slug}/timeline?minutes=${minutes}`),
  action: (slug: string, body: ActionBody) => call<ActionResult>(`/channels/${slug}/actions`, json(body)),
  rollback: (slug: string, number: number, expected: number) =>
    call<ActionResult>(`/channels/${slug}/versions/${number}/rollback`, json({ expected_version: expected })),
  recordLink: (slug: string, wav: Blob, seconds: number, expected: number) => {
    const form = new FormData();
    form.append("audio", new File([wav], "live-link.wav", { type: "audio/wav" }));
    form.append("duration_seconds", String(Math.max(1, Math.round(seconds))));
    form.append("expected_version", String(expected));
    return call<ActionResult>(`/channels/${slug}/record-link`, { method: "POST", body: form });
  },
  versions: (slug: string, before?: number) =>
    call<{ versions: any[]; failed: any[]; live_version: number }>(`/channels/${slug}/versions${before ? `?before=${before}` : ""}`),
  versionPreview: (slug: string, number: number) => call<any>(`/channels/${slug}/versions/${number}/preview`),
  airingHistory: (slug: string, airingId: string) => call<any>(`/channels/${slug}/airing/${airingId}/history`),
  changes: (slug: string) => call<{ changes: any[] }>(`/channels/${slug}/changes`),
  fallback: (slug: string) => call<{ items: any[]; playable_seconds: number; valid: boolean }>(`/channels/${slug}/fallback`),
  saveFallback: (slug: string, items: { track_id?: string | null; audio_asset_id?: string | null }[]) =>
    call<{ ok: true; playable_seconds: number; valid: boolean }>(`/channels/${slug}/fallback`, { method: "PUT", body: JSON.stringify({ items }) }),
  enable: (slug: string, enabled: boolean) => call<{ ok: true }>(`/channels/${slug}/enable`, json({ enabled })),
  library: (q: string, type: string, channel?: string) =>
    call<{ results: LibraryResult[] }>(`/library?q=${encodeURIComponent(q)}&type=${type}${channel ? `&channel=${channel}` : ""}`),
  topJingles: (slug: string) => call<{ results: { audio_asset_id: string; title: string; type: string; duration_seconds: number; plays: number }[] }>(`/channels/${slug}/top-jingles`),
  grid: (slug: string) => call<GridPayload>(`/channels/${slug}/grid`),
  pool: (tags: string[], channel: string) => call<{ tracks: number; seconds: number }>(`/pool?tags=${encodeURIComponent(tags.join(","))}&channel=${channel}`),
  createBlock: (slug: string, body: Record<string, unknown>) => call<GridPayload & { ok: true; version: number; live_from_ms: number }>(`/channels/${slug}/grid`, json(body)),
  updateBlock: (slug: string, id: string, body: Record<string, unknown>) =>
    call<GridPayload & { ok: true; version: number; live_from_ms: number }>(`/channels/${slug}/grid/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  deleteBlock: (slug: string, id: string) => call<GridPayload & { ok: true; version: number; live_from_ms: number }>(`/channels/${slug}/grid/${id}`, { method: "DELETE" }),
  copyDay: (slug: string, from: string, to: string[]) => call<GridPayload & { ok: true; version: number; live_from_ms: number }>(`/channels/${slug}/grid/copy-day`, json({ from, to })),
};

export const friendly = (err: unknown, fallback = "Something went wrong. Please try again.") =>
  (err instanceof ApiError && err.friendly) || fallback;
