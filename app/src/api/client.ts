// In local dev this stays empty and Vite's proxy (vite.config.ts) forwards
// /api and /studio/api to the worker on :8787. In production there is no
// proxy - the app and the worker are on different domains - so the build
// needs VITE_API_ORIGIN pointing at the deployed worker.
const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "";
const API_BASE = `${API_ORIGIN}/api`;
const STUDIO_BASE = `${API_ORIGIN}/studio/api`;

// tracks.audio_url / audio_assets.audio_url normally store the R2 object
// key (e.g. "audio/upl_xxx-song.mp3"), not a playable URL - this turns one
// into the other via the Worker's /media/* streaming route. A podcast-
// imported audio_asset (storage='external') stores a full Spotify-hosted
// URL instead - already playable as-is, so it's returned unchanged rather
// than treated as an R2 key. Every existing call site gets this for free
// without needing to know or care where a given asset's bytes live.
export function mediaUrl(key: string): string {
  if (/^https?:\/\//i.test(key)) return key;
  return `${API_ORIGIN}/media/${key}`;
}

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ---- Public / listener API ----

export const publicApi = {
  channels: () => request<{ channels: any[] }>(`${API_BASE}/channels`),
  channel: (slug: string) => request<{ channel: any }>(`${API_BASE}/channels/${slug}`),
  albums: () => request<{ albums: any[] }>(`${API_BASE}/albums`),
  album: (id: string) => request<{ album: any; tracks: any[] }>(`${API_BASE}/albums/${id}`),
  tracks: (q?: string) => request<{ tracks: any[] }>(`${API_BASE}/tracks${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  programmes: (params?: { channel_id?: string; is_flagship?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.channel_id) qs.set("channel_id", params.channel_id);
    if (params?.is_flagship) qs.set("is_flagship", "1");
    const query = qs.toString();
    return request<{ programmes: any[] }>(`${API_BASE}/programmes${query ? `?${query}` : ""}`);
  },
  programme: (id: string) => request<{ programme: any; items: any[] }>(`${API_BASE}/programmes/${id}`),
  podcastShowcase: () =>
    request<{ shows: any[]; recent: any[] }>(`${API_BASE}/podcasts/showcase`),
  podcasts: (limit?: number) =>
    request<{ podcasts: any[] }>(`${API_BASE}/podcasts${limit ? `?limit=${limit}` : ""}`),
  featuredAlbum: () => request<{ album: any | null; tracks: any[] }>(`${API_BASE}/featured-album`),
  nowPlaying: (channel = "kizzi-radio") =>
    request<any>(`${API_BASE}/now-playing?channel=${encodeURIComponent(channel)}`),
  search: (q: string) => request<{ tracks: any[]; albums: any[]; programmes: any[] }>(
    `${API_BASE}/search?q=${encodeURIComponent(q)}`
  ),
  buildSession: (mood: string, durationMinutes: number) =>
    request<{ session: { mood: string; duration_minutes: number; total_duration_seconds: number; items: any[] } | null; message?: string }>(
      `${API_BASE}/sessions`,
      { method: "POST", body: JSON.stringify({ mood, duration_minutes: durationMinutes }) }
    ),
  sweeper: (band?: string) =>
    request<{ asset: any | null }>(`${API_BASE}/sweeper${band ? `?band=${encodeURIComponent(band)}` : ""}`),
};

// ---- Listener account (favourites / listening history) ----

export type FavouriteItemType = "track" | "album" | "programme";
export type HistoryItemType = "track" | "programme";

export const listenerApi = {
  session: () => request<{ authenticated: boolean }>(`${API_BASE}/auth/session`),
  login: (password: string) =>
    request<{ ok: true }>(`${API_BASE}/auth/login`, { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => request<{ ok: true }>(`${API_BASE}/auth/logout`, { method: "POST" }),

  favourites: () =>
    request<{ favourites: { item_type: FavouriteItemType; item_id: string; created_at: string; item: any }[] }>(
      `${API_BASE}/favourites`
    ),
  addFavourite: (itemType: FavouriteItemType, itemId: string) =>
    request<{ ok: true }>(`${API_BASE}/favourites`, {
      method: "POST",
      body: JSON.stringify({ item_type: itemType, item_id: itemId }),
    }),
  removeFavourite: (itemType: FavouriteItemType, itemId: string) =>
    request<{ ok: true }>(`${API_BASE}/favourites/${itemType}/${itemId}`, { method: "DELETE" }),

  history: () =>
    request<{ history: { item_type: HistoryItemType; item_id: string; played_at: string; item: any }[] }>(
      `${API_BASE}/history`
    ),
  recordPlay: (itemType: HistoryItemType, itemId: string) =>
    request<{ ok: true }>(`${API_BASE}/history`, {
      method: "POST",
      body: JSON.stringify({ item_type: itemType, item_id: itemId }),
    }),
};

// ---- Studio (authenticated) API ----

export const studioApi = {
  login: (password: string) =>
    request<{ ok: true }>(`${STUDIO_BASE}/auth/login`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  logout: () => request<{ ok: true }>(`${STUDIO_BASE}/auth/logout`, { method: "POST" }),

  tracks: () => request<{ tracks: any[] }>(`${STUDIO_BASE}/tracks`),
  createTrack: (data: Record<string, unknown>) =>
    request<{ id: string }>(`${STUDIO_BASE}/tracks`, { method: "POST", body: JSON.stringify(data) }),
  updateTrack: (id: string, data: Record<string, unknown>) =>
    request<{ ok: true }>(`${STUDIO_BASE}/tracks/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  setTrackTags: (id: string, tags: string[]) =>
    request<{ ok: true }>(`${STUDIO_BASE}/tracks/${id}/tags`, { method: "PUT", body: JSON.stringify({ tags }) }),

  albums: () => request<{ albums: any[] }>(`${STUDIO_BASE}/albums`),
  album: (id: string) => request<{ album: any; tracks: any[] }>(`${STUDIO_BASE}/albums/${id}`),
  createAlbum: (data: Record<string, unknown>) =>
    request<{ id: string }>(`${STUDIO_BASE}/albums`, { method: "POST", body: JSON.stringify(data) }),
  updateAlbum: (id: string, data: Record<string, unknown>) =>
    request<{ ok: true }>(`${STUDIO_BASE}/albums/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  setAlbumFeatured: (id: string, featured: boolean) =>
    request<{ ok: true }>(`${STUDIO_BASE}/albums/${id}/feature`, {
      method: "POST",
      body: JSON.stringify({ featured }),
    }),

  channels: () => request<{ channels: any[] }>(`${STUDIO_BASE}/channels?all=1`),
  setChannelStatus: (id: string, status: "building" | "live") =>
    request<{ ok: true }>(`${STUDIO_BASE}/channels/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  channelLaunchChecklist: (id: string) =>
    request<{ checklist: Record<string, unknown> }>(`${STUDIO_BASE}/channels/${id}/launch-checklist`),
  setChannelProgrammingMode: (id: string, programming_mode: "manual" | "autopilot") =>
    request<{ ok: true }>(`${STUDIO_BASE}/channels/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ programming_mode }),
    }),

  programmes: () => request<{ programmes: any[] }>(`${STUDIO_BASE}/programmes`),
  programme: (id: string) => request<{ programme: any; items: any[] }>(`${STUDIO_BASE}/programmes/${id}`),
  createProgramme: (data: Record<string, unknown>) =>
    request<{ id: string }>(`${STUDIO_BASE}/programmes`, { method: "POST", body: JSON.stringify(data) }),
  updateProgramme: (id: string, data: Record<string, unknown>) =>
    request<{ ok: true }>(`${STUDIO_BASE}/programmes/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  saveRunningOrder: (id: string, items: Record<string, unknown>[]) =>
    request<{ ok: true; duration_seconds: number }>(`${STUDIO_BASE}/programmes/${id}/items`, {
      method: "PUT",
      body: JSON.stringify({ items }),
    }),

  audioAssets: (opts?: { storage?: "r2" | "external" }) =>
    request<{ audio_assets: any[] }>(`${STUDIO_BASE}/audio-assets${opts?.storage ? `?storage=${opts.storage}` : ""}`),
  createAudioAsset: (data: Record<string, unknown>) =>
    request<{ id: string }>(`${STUDIO_BASE}/audio-assets`, { method: "POST", body: JSON.stringify(data) }),
  audioAssetPins: (id: string) =>
    request<{ pins: { track_id: string; title: string; start_offset_seconds: number }[] }>(
      `${STUDIO_BASE}/audio-assets/${id}/pins`
    ),
  setAudioAssetPins: (id: string, pins: { track_id: string; start_offset_seconds: number }[]) =>
    request<{ ok: true }>(`${STUDIO_BASE}/audio-assets/${id}/pins`, {
      method: "PUT",
      body: JSON.stringify({ pins }),
    }),
  updateAudioAsset: (id: string, data: Record<string, unknown>) =>
    request<{ ok: true }>(`${STUDIO_BASE}/audio-assets/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  setAudioAssetTags: (id: string, tags: string[]) =>
    request<{ ok: true }>(`${STUDIO_BASE}/audio-assets/${id}/tags`, { method: "PUT", body: JSON.stringify({ tags }) }),

  tags: () => request<{ tags: any[] }>(`${STUDIO_BASE}/tags`),

  presignUpload: (filename: string, content_type: string, folder: "audio" | "artwork" | "masters") =>
    request<{ upload_url: string; key: string }>(`${STUDIO_BASE}/upload/presign`, {
      method: "POST",
      body: JSON.stringify({ filename, content_type, folder }),
    }),

  proposeProgramme: (brief: string, channel_id?: string) =>
    request<{ proposal: { title: string; description: string; items: any[] } }>(
      `${STUDIO_BASE}/ai/propose-programme`,
      { method: "POST", body: JSON.stringify({ brief, channel_id }) }
    ),

  fetchPodcastFeed: (feedUrl: string) =>
    request<{ show_title: string | null; episodes: any[] }>(`${STUDIO_BASE}/podcast-import/fetch`, {
      method: "POST",
      body: JSON.stringify({ feed_url: feedUrl }),
    }),
  podcastEpisodes: () => request<{ episodes: any[] }>(`${STUDIO_BASE}/podcast-import/episodes`),
  setPodcastEpisodesStatus: (ids: string[], status: "published" | "draft") =>
    request<{ updated: number }>(`${STUDIO_BASE}/podcast-import/episodes/status`, {
      method: "POST",
      body: JSON.stringify({ ids, status }),
    }),
  deletePodcastEpisodes: (ids: string[]) =>
    request<{ deleted: number }>(`${STUDIO_BASE}/podcast-import/episodes/delete`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    }),
  importPodcastEpisodes: (channelId: string, episodes: any[], showName: string) =>
    request<{ imported: number; skipped: number }>(`${STUDIO_BASE}/podcast-import/import`, {
      method: "POST",
      body: JSON.stringify({ channel_id: channelId, episodes, show_name: showName }),
    }),
};

export async function uploadFileToR2(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}
