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

export class ApiError extends Error {
  status: number;
  /** The contest/likes APIs also send a short code, a message meant for people, and the form field it concerns. */
  code?: string;
  friendly?: string;
  field?: string;
  constructor(status: number, message: string, extra?: { code?: string; friendly?: string; field?: string }) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
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
    throw new ApiError(res.status, body.error ?? res.statusText, { code: body.error, friendly: body.message, field: body.field });
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
  track: (id: string) => request<{ track: any; tags: any[] }>(`${API_BASE}/tracks/${id}`),
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
  /** The channel's running order from now on, each item with its on-air start (unix seconds). */
  schedule: (channel: string, minutes = 60) =>
    request<{ on_air: boolean; position_seconds?: number; channel: any; items: any[] }>(
      `${API_BASE}/schedule?channel=${encodeURIComponent(channel)}&minutes=${minutes}`
    ),
  search: (q: string) => request<{ tracks: any[]; albums: any[]; programmes: any[] }>(
    `${API_BASE}/search?q=${encodeURIComponent(q)}`
  ),
  requestTimeCapsule: (data: Record<string, unknown>) =>
    request<{ ok: true; scheduled_date?: string }>(`${API_BASE}/time-capsules`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  needs: () => request<{ needs: { key: string; label: string; emoji: string; blurb: string }[] }>(`${API_BASE}/needs`),
  radioForYou: (need: string, songs: number, band?: string) =>
    request<{ programme: any | null; items: any[]; message?: string }>(`${API_BASE}/radio-for-you`, {
      method: "POST",
      body: JSON.stringify({ need, songs, band }),
    }),
  buildSession: (mood: string, durationMinutes: number) =>
    request<{ session: { mood: string; duration_minutes: number; total_duration_seconds: number; items: any[] } | null; message?: string }>(
      `${API_BASE}/sessions`,
      { method: "POST", body: JSON.stringify({ mood, duration_minutes: durationMinutes }) }
    ),
  sweeper: (band?: string) =>
    request<{ asset: any | null }>(`${API_BASE}/sweeper${band ? `?band=${encodeURIComponent(band)}` : ""}`),
};

// ---- Top 3 Creator Songs of 2026 (see worker/src/routes/contest.ts) ----

export type ContestPhase = "before_entries" | "entries_open" | "voting" | "results_pending" | "complete";

export interface ContestState {
  phase: ContestPhase;
  dates: { entriesOpen: string; entriesClose: string; votingOpen: string; votingClose: string; eligibleFrom: string; eligibleTo: string };
  limits: { maxEntriesPerEntrant: number; maxAudioBytes: number; maxPhotoBytes: number; maxDurationSeconds: number };
  likesOpen: boolean;
  studioPreview: boolean;
  approvedCount: number;
  countryCount: number;
  byCountry: { code: string; n: number }[];
}

export interface ContestEntry {
  id: number;
  title: string;
  creator_name: string;
  country_code: string;
  /** R2 keys, like tracks.audio_url - pass through mediaUrl(). */
  photo_url: string | null;
  audio_url: string;
  duration_seconds: number | null;
  bio?: string | null;
  links?: string[];
  approved_at?: string | null;
}

export const contestApi = {
  state: () => request<ContestState>(`${API_BASE}/contest/state`),
  entries: (opts: { country?: string; cursor?: string | null; limit?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.country) qs.set("country", opts.country);
    if (opts.cursor) qs.set("cursor", opts.cursor);
    if (opts.limit) qs.set("limit", String(opts.limit));
    return request<{ entries: ContestEntry[]; nextCursor: string | null }>(`${API_BASE}/contest/entries?${qs}`);
  },
  entry: (id: string | number) => request<{ entry: ContestEntry }>(`${API_BASE}/contest/entries/${id}`),
  confirm: (token: string) =>
    request<{ ok: true; alreadyConfirmed?: boolean; title?: string }>(`${API_BASE}/contest/entries/confirm`, {
      method: "POST",
      body: JSON.stringify({ token }),
    }),
  notify: (data: { email: string; entryId?: number; wantsNews: boolean; turnstileToken: string; website: string }) =>
    request<{ ok: true; message: string }>(`${API_BASE}/contest/notify`, { method: "POST", body: JSON.stringify(data) }),
  notifyConfirm: (token: string) =>
    request<{ ok: true }>(`${API_BASE}/contest/notify/confirm`, { method: "POST", body: JSON.stringify({ token }) }),
  unsubscribe: (id: string, sig: string) =>
    request<{ ok: true }>(`${API_BASE}/contest/notify/unsubscribe`, { method: "POST", body: JSON.stringify({ id, sig }) }),

  /**
   * The entry itself: multipart, so the song and photo go up with the form
   * (and without request()'s JSON Content-Type). XMLHttpRequest rather than
   * fetch, because only XHR reports upload progress - a 20 MB MP3 on a phone
   * connection needs a progress bar.
   */
  submitEntry: (form: FormData, onProgress: (fraction: number) => void) =>
    new Promise<{ ok: true }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE}/contest/entries`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let body: any = {};
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = {};
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else
          reject(
            new ApiError(xhr.status, body.error ?? `HTTP ${xhr.status}`, {
              code: body.error,
              friendly: body.message ?? "Something went wrong sending your entry. Please try again.",
              field: body.field,
            })
          );
      };
      xhr.onerror = () =>
        reject(new ApiError(0, "network", { friendly: "Your connection dropped while uploading. Please try again." }));
      xhr.send(form);
    }),
};

// ---- Likes (see worker/src/routes/likes.ts) - never any counts on this side ----

export type LikeItemType = "track" | "contest_entry";

export const likesApi = {
  like: (itemType: LikeItemType, itemId: string) =>
    request<{ liked: true }>(`${API_BASE}/likes`, { method: "POST", body: JSON.stringify({ itemType, itemId }) }),
  unlike: (itemType: LikeItemType, itemId: string) =>
    request<{ liked: false }>(`${API_BASE}/likes/${itemType}/${encodeURIComponent(itemId)}`, { method: "DELETE" }),
  mine: (itemType: LikeItemType, ids: string[]) =>
    request<{ liked: string[] }>(`${API_BASE}/likes/mine?itemType=${itemType}&ids=${ids.map(encodeURIComponent).join(",")}`),
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
  tracksByStatus: (status: string) =>
    request<{ tracks: any[] }>(`${STUDIO_BASE}/tracks?status=${encodeURIComponent(status)}`),
  deleteTrack: (id: string) => request<{ ok: true }>(`${STUDIO_BASE}/tracks/${id}`, { method: "DELETE" }),

  // Listening + visit analytics (days: 1, 7, 30, 90, 365, or 0 for all time).
  analytics: (days: number, group?: string) =>
    request<any>(`${STUDIO_BASE}/analytics?days=${days}${group ? `&group=${group}` : ""}`),

  // Bulk Import (see worker/src/routes/bulkImport.ts)
  bulkLookup: (fileKeys: string[]) =>
    request<{ rows: any[] }>(`${STUDIO_BASE}/bulk-import/rows/lookup`, {
      method: "POST",
      body: JSON.stringify({ file_keys: fileKeys }),
    }),
  bulkSave: (rows: Record<string, unknown>[]) =>
    request<{ saved: number }>(`${STUDIO_BASE}/bulk-import/rows/save`, {
      method: "POST",
      body: JSON.stringify({ rows }),
    }),
  bulkPresign: (files: { filename: string; content_type: string }[]) =>
    request<{ uploads: { key: string; content_type: string; upload_url: string }[] }>(
      `${STUDIO_BASE}/bulk-import/presign`,
      { method: "POST", body: JSON.stringify({ files }) }
    ),
  bulkComplete: (data: Record<string, unknown>) =>
    request<{ track_id: string; already_imported?: boolean }>(`${STUDIO_BASE}/bulk-import/complete`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  bulkDuplicates: (hashes: string[]) =>
    request<{ matches: { hash: string; track_id: string; title: string; status: string }[] }>(
      `${STUDIO_BASE}/bulk-import/duplicates`,
      { method: "POST", body: JSON.stringify({ hashes }) }
    ),
  bulkBackfill: () =>
    request<{ hashed: number; remaining: number }>(`${STUDIO_BASE}/bulk-import/backfill-hashes`, {
      method: "POST",
      body: JSON.stringify({ limit: 5 }),
    }),
  bulkSummary: () =>
    request<{ typed_not_uploaded: number; uploaded: number; drafts: number; unfingerprinted: number }>(
      `${STUDIO_BASE}/bulk-import/summary`
    ),
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
  timeCapsules: () => request<{ capsules: any[]; today: string }>(`${STUDIO_BASE}/time-capsules`),
  createTimeCapsule: (data: Record<string, unknown>) =>
    request<{ id: string }>(`${STUDIO_BASE}/time-capsules`, { method: "POST", body: JSON.stringify(data) }),
  updateTimeCapsule: (id: string, data: Record<string, unknown>) =>
    request<{ ok: true }>(`${STUDIO_BASE}/time-capsules/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteTimeCapsule: (id: string) => request<{ ok: true }>(`${STUDIO_BASE}/time-capsules/${id}`, { method: "DELETE" }),

  programmeTitles: () => request<{ titles: any[] }>(`${STUDIO_BASE}/programme-titles`),
  createProgrammeTitle: (data: { need: string; title: string; time_band: string | null }) =>
    request<{ id: string }>(`${STUDIO_BASE}/programme-titles`, { method: "POST", body: JSON.stringify(data) }),
  updateProgrammeTitle: (id: string, data: Record<string, unknown>) =>
    request<{ ok: true }>(`${STUDIO_BASE}/programme-titles/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteProgrammeTitle: (id: string) =>
    request<{ ok: true }>(`${STUDIO_BASE}/programme-titles/${id}`, { method: "DELETE" }),

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
  // Top 3 contest review (see worker/src/routes/contestStudio.ts)
  contestEntries: (status: string, q?: string) =>
    request<{ entries: any[]; counts: Record<string, number> }>(
      `${STUDIO_BASE}/contest/entries?status=${encodeURIComponent(status)}${q ? `&q=${encodeURIComponent(q)}` : ""}`
    ),
  contestEntry: (id: number) => request<{ entry: any; others: any[]; history: any[] }>(`${STUDIO_BASE}/contest/entries/${id}`),
  contestEntryAudioUrl: (id: number) => `${STUDIO_BASE}/contest/entries/${id}/audio`,
  contestEntryPhotoUrl: (id: number) => `${STUDIO_BASE}/contest/entries/${id}/photo`,
  updateContestEntry: (id: number, data: Record<string, unknown>) =>
    request<{ ok: true }>(`${STUDIO_BASE}/contest/entries/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  reviewContestEntry: (id: number, decision: "approve" | "reject", reason?: string) =>
    request<{ ok: true }>(`${STUDIO_BASE}/contest/entries/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, reason }),
    }),
  removeContestEntry: (id: number, action: "disqualify" | "withdraw", reason: string) =>
    request<{ ok: true; inPublishedProgrammes: { id: string; title: string }[] }>(
      `${STUDIO_BASE}/contest/entries/${id}/${action}`,
      { method: "POST", body: JSON.stringify({ reason }) }
    ),
  addContestEntryToLibrary: (id: number) =>
    request<{ ok: true; trackId: string; alreadyAdded?: boolean }>(`${STUDIO_BASE}/contest/entries/${id}/add-to-library`, {
      method: "POST",
    }),
  contestStats: () => request<any>(`${STUDIO_BASE}/contest/stats`),
  contestExportUrl: () => `${STUDIO_BASE}/contest/export.csv`,
  likes: (itemType: "all" | "track" | "contest_entry", sort: "total" | "week") =>
    request<{ items: any[] }>(`${STUDIO_BASE}/likes?itemType=${itemType}&sort=${sort}`),

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
