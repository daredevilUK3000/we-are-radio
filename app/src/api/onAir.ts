import { ApiError } from "./client";

/**
 * "Say it on air" (worker/src/routes/onAir.ts and onAirStudio.ts). Kept out
 * of client.ts, which is long enough already.
 */

const API_ORIGIN = import.meta.env.VITE_API_ORIGIN ?? "";
const PUBLIC = `${API_ORIGIN}/api/on-air`;
const STUDIO = `${API_ORIGIN}/studio/api/on-air`;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: "include",
    headers: init?.body instanceof FormData ? init.headers : { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? res.statusText, { code: body.error, friendly: body.message, field: body.field });
  return body as T;
}

export type OnAirKind = "shoutout" | "dedication" | "reaction" | "question";

export interface ManageView {
  status: "pending" | "approved" | "scheduled" | "placed" | "aired" | "withdrawn" | "closed";
  first_name: string;
  kind: OnAirKind;
  for_name: string;
  channel: { name: string; slug: string } | null;
  expected_at: number | null;
  aired_at: number | null;
  can_withdraw: boolean;
  can_remove_clip: boolean;
  audio_url: string | null;
  share_url: string | null;
}

export interface PublicClip {
  first_name: string;
  place: string;
  kind: OnAirKind;
  for_name: string;
  aired_at_ms: number;
  audio_url: string;
  channel_name: string | null;
  channel_slug: string | null;
}

export const onAirApi = {
  /** Multipart, through XMLHttpRequest for upload progress (2 MB on a phone connection). */
  send: (form: FormData, onProgress: (fraction: number) => void) =>
    new Promise<{ ok: true; id?: string; sent_today?: number; daily_limit?: number }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", PUBLIC);
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
              friendly: body.message ?? "Something went wrong sending your message. Please try again.",
              field: body.field,
            })
          );
      };
      xhr.onerror = () => reject(new ApiError(0, "network", { friendly: "Your connection dropped while sending. Please try again." }));
      xhr.send(form);
    }),
  manage: (id: string, token: string, action: "status" | "withdraw" | "remove_clip" = "status") =>
    call<{ ok: true; view: ManageView }>(`${PUBLIC}/manage`, { method: "POST", body: JSON.stringify({ id, token, action }) }),
  clip: (publicId: string) => call<{ clip: PublicClip }>(`${PUBLIC}/clip/${encodeURIComponent(publicId)}`),
};

export interface StudioVoice {
  id: string;
  kind: OnAirKind;
  first_name: string;
  place: string;
  for_name: string;
  requested_track_id: string | null;
  requested_track_title: string | null;
  requested_track_artist: string | null;
  reacting_to: { channel: string | null; label: string | null; track_id: string | null; at: number } | null;
  note: string;
  channel_id: string | null;
  channel_name: string | null;
  channel_slug: string | null;
  air_channel_id: string | null;
  air_channel_name: string | null;
  email: string;
  listener_tz: string | null;
  consent_share: number;
  has_raw: boolean;
  raw_seconds: number;
  audio_asset_id: string | null;
  prepared_url: string | null;
  prepared_seconds: number | null;
  with_intro: number;
  status: string;
  air_after_ms: number | null;
  air_when: "next" | "at" | null;
  play_song_after: number;
  expected_at_ms: number | null;
  aired_at_ms: number | null;
  flag: string | null;
  song_note: string | null;
  reject_reason: string | null;
  listened_full: number;
  created_at: string;
  sender_total: number;
  sender_aired: number;
  sender_rejected: number;
  sender_nth: number;
  blocked: number | null;
}

export interface StudioChannel {
  id: string;
  slug: string;
  name: string;
  status: string;
  scheduler: number;
}

export const onAirStudioApi = {
  summary: () => call<{ pending: number; oldest: string | null; flagged: number }>(`${STUDIO}/summary`),
  messages: (status: "pending" | "scheduled" | "aired" | "rejected") =>
    call<{ messages: StudioVoice[]; counts: Record<string, number>; channels: StudioChannel[] }>(`${STUDIO}/messages?status=${status}`),
  rawUrl: (id: string) => `${STUDIO}/messages/${encodeURIComponent(id)}/raw`,
  listened: (id: string) => call<{ ok: true }>(`${STUDIO}/messages/${id}/listened`, { method: "POST", body: "{}" }),
  prepare: (id: string, wav: Blob, withIntro: boolean) => {
    const form = new FormData();
    form.append("audio", wav, "prepared.wav");
    form.append("with_intro", withIntro ? "1" : "0");
    return call<{ ok: true; asset_id: string; audio_url: string; seconds: number }>(`${STUDIO}/messages/${id}/prepare`, { method: "POST", body: form });
  },
  approve: (id: string, body: { channel_id: string; when: "next" | "at"; air_after_ms?: number; play_song_after?: boolean }) =>
    call<{ ok: true; status: string; message: string; expected_at_ms?: number | null }>(`${STUDIO}/messages/${id}/approve`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  hold: (id: string, body: { channel_id?: string; play_song_after?: boolean }) =>
    call<{ ok: true }>(`${STUDIO}/messages/${id}/hold`, { method: "POST", body: JSON.stringify(body) }),
  unschedule: (id: string) => call<{ ok: true }>(`${STUDIO}/messages/${id}/unschedule`, { method: "POST", body: "{}" }),
  reject: (id: string, body: { reason?: string; notify: boolean }) =>
    call<{ ok: true }>(`${STUDIO}/messages/${id}/reject`, { method: "POST", body: JSON.stringify(body) }),
  block: (id: string) => call<{ ok: true }>(`${STUDIO}/messages/${id}/block`, { method: "POST", body: "{}" }),
  blocks: () => call<{ blocks: { message_id: string; created_at: string; first_name: string | null; place: string | null }[] }>(`${STUDIO}/blocks`),
  unblock: (messageId: string) => call<{ ok: true }>(`${STUDIO}/blocks/${encodeURIComponent(messageId)}`, { method: "DELETE" }),
  voices: (channelId: string) => call<{ voices: any[] }>(`${STUDIO}/voices?channel_id=${encodeURIComponent(channelId)}`),
};
