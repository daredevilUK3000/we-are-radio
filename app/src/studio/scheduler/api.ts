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

// ------------------------------------------------------------------ Release 2: the plan (worker/src/routes/schedulerPlan.ts)

export type BlockColour = "blue" | "purple" | "gold" | "green" | "red" | "grey";

export interface PlanBlock {
  id: string;
  channel_id: string;
  name: string;
  description: string;
  colour: BlockColour;
  recurrence: "once" | "weekly" | "monthly";
  days_mask: number | null;
  once_date: string | null;
  monthly_rule: string | null;
  date_from: string | null;
  date_to: string | null;
  start_min: number;
  end_min: number;
  layer: number;
  start_mode: "hard" | "flexible";
  end_mode: "hard" | "flexible";
  priority: "high" | "normal";
  mode: "auto" | "manual";
  fill_kind: "programme" | "autopilot" | "playlist" | "template" | "manual";
  programme_id: string | null;
  tags_any: string[];
  public: number;
  active: number;
  exceptions: string[];
  updated_at_ms: number;
}

export interface PlanSegment {
  block_id: string;
  date: string;
  start_ms: number;
  end_ms: number;
  origin_ms: number;
  cut: boolean;
  resumed: boolean;
}

export type FixKind = "move" | "shorten" | "replace" | "exception" | "edit";

export interface PlanIssue {
  level: "red" | "amber";
  code: string;
  text: string;
  block_id?: string;
  other_block_id?: string;
  date?: string;
  start_ms?: number;
  end_ms?: number;
  fixes: FixKind[];
}

export interface ChannelDraft {
  slug: string;
  name: string;
  live_plan: number | null;
  live_version: number | null;
  changes: { text: string; block_id?: string }[];
  issues: PlanIssue[];
  first_change_ms: number | null;
  can_publish: boolean;
  why_not: string | null;
}

export interface BoardLane {
  slug: string;
  name: string;
  description: string | null;
  status: string;
  enabled: boolean;
  programming_mode: string;
  accent: string;
  live_plan: number | null;
  live_version: number | null;
  blocks: PlanBlock[];
  segments: PlanSegment[];
  raw: { block_id: string; date: string; start_ms: number; end_ms: number }[];
  conflicts: { block_id: string; other_block_id: string; date: string; start_ms: number; end_ms: number }[];
  draft: ChannelDraft;
}

export interface Board {
  now_ms: number;
  from: number;
  to: number;
  view: "draft" | "live";
  channels: BoardLane[];
  programmes: { id: string; title: string; channel_id: string; duration_seconds: number | null; items: number }[];
  tags: string[];
}

export type PublishOutcome =
  | { ok: true; plan: number; version: number | null; goes_live_ms: number | null; message: string }
  | { ok: false; status: number; error: string; message: string; issues?: PlanIssue[]; live_plan?: number | null };

type Drafts = { ok: true; drafts: Record<string, ChannelDraft> };

export const planApi = {
  board: (from: number, to: number, view: "draft" | "live", channel?: string) =>
    call<Board>(`/plan/board?from=${from}&to=${to}&view=${view}${channel ? `&channel=${channel}` : ""}`),
  drafts: () => call<{ now_ms: number; drafts: Record<string, ChannelDraft> }>("/plan/draft"),
  create: (body: Record<string, unknown>) => call<Drafts & { block: PlanBlock }>("/plan/blocks", json(body)),
  update: (id: string, body: Record<string, unknown>) => call<Drafts & { block: PlanBlock }>(`/plan/blocks/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  remove: (id: string, scope?: "occurrence", date?: string) => call<Drafts>(`/plan/blocks/${id}${scope ? `?scope=${scope}&date=${date}` : ""}`, { method: "DELETE" }),
  duplicate: (id: string) => call<Drafts & { block: PlanBlock }>(`/plan/blocks/${id}/duplicate`, json({})),
  exception: (id: string, date: string, skip = true) => call<Drafts>(`/plan/blocks/${id}/exception`, json({ date, skip })),
  copyDay: (channel: string, from: string, to: string[]) => call<Drafts>("/plan/copy-day", json({ channel, from, to })),
  preview: (channel: string, date: string) => call<any>(`/plan/preview?channel=${channel}&date=${date}`),
  publish: (channels: string[], expected: Record<string, number | null>) =>
    call<{ results: Record<string, PublishOutcome>; drafts: Record<string, ChannelDraft> }>("/plan/publish", json({ channels, expected })),
  discard: (channel: string) => call<Drafts & { discarded: number; message: string }>("/plan/discard", json({ channel })),
  rollback: (channel: string, number: number, expected: number | null) =>
    call<Drafts & { result: PublishOutcome }>("/plan/rollback", json({ channel, number, expected })),
  plans: (channel: string) => call<{ channel: { slug: string; name: string }; plans: any[]; draft_changes: number }>(`/plan/plans?channel=${channel}`),
  plan: (channel: string, number: number) => call<{ plan: any; blocks: PlanBlock[]; compared_to_live: { text: string }[] }>(`/plan/plans/${number}?channel=${channel}`),
  pool: (tags: string[], channel: string) => call<{ tracks: number; seconds: number }>(`/plan/pool?tags=${encodeURIComponent(tags.join(","))}&channel=${channel}`),
};
