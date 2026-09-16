const API_BASE = "/api";
const STUDIO_BASE = "/studio/api";

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
  nowPlaying: (channel = "kizzi-radio") =>
    request<any>(`${API_BASE}/now-playing?channel=${encodeURIComponent(channel)}`),
  search: (q: string) => request<{ tracks: any[]; albums: any[]; programmes: any[] }>(
    `${API_BASE}/search?q=${encodeURIComponent(q)}`
  ),
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
  createAlbum: (data: Record<string, unknown>) =>
    request<{ id: string }>(`${STUDIO_BASE}/albums`, { method: "POST", body: JSON.stringify(data) }),

  channels: () => request<{ channels: any[] }>(`${STUDIO_BASE}/channels?all=1`),
  setChannelStatus: (id: string, status: "building" | "live") =>
    request<{ ok: true }>(`${STUDIO_BASE}/channels/${id}/status`, {
      method: "POST",
      body: JSON.stringify({ status }),
    }),
  channelLaunchChecklist: (id: string) =>
    request<{ checklist: Record<string, unknown> }>(`${STUDIO_BASE}/channels/${id}/launch-checklist`),

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

  audioAssets: () => request<{ audio_assets: any[] }>(`${STUDIO_BASE}/audio-assets`),
  createAudioAsset: (data: Record<string, unknown>) =>
    request<{ id: string }>(`${STUDIO_BASE}/audio-assets`, { method: "POST", body: JSON.stringify(data) }),

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
};

export async function uploadFileToR2(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}
