import { useEffect, useRef, type RefObject } from "react";

/**
 * Listening analytics for the listener app (handoff: Analytics). Aggregate
 * only: nothing sent from here identifies a person. Plays carry no id at all;
 * the visit funnel carries a random id that lives in one browser tab's
 * sessionStorage (gone when the tab closes) purely so a visit is counted once.
 *
 * Every call is fire-and-forget: if logging fails for any reason the listener
 * never notices, and it can never stop a song from playing.
 */

const BASE = `${import.meta.env.VITE_API_ORIGIN ?? ""}/api/analytics`;

// ------------------------------------------------------------------ opt out

// Kizzi's own testing shouldn't count as listeners. The Studio's Analytics page
// switches this on for a device; it is just a flag in that browser.
const OPT_OUT_KEY = "wa_no_track";

export function isOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setOptedOut(value: boolean) {
  try {
    if (value) localStorage.setItem(OPT_OUT_KEY, "1");
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    // storage blocked: nothing to remember it with
  }
}

function post(path: string, body: unknown) {
  if (isOptedOut()) return;
  try {
    // keepalive lets the request finish even as the page is closing.
    void fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
      credentials: "omit",
    }).catch(() => {});
  } catch {
    // never let logging break the page
  }
}

// -------------------------------------------------------------- visit funnel

const memoryFlags = new Set<string>();
let memorySession: string | null = null;

function randomId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sessionId(): string {
  try {
    let id = sessionStorage.getItem("wa_sid");
    if (!id) {
      id = randomId();
      sessionStorage.setItem("wa_sid", id);
    }
    return id;
  } catch {
    return (memorySession ??= randomId());
  }
}

// True the first time it is asked in this tab session, false after.
function firstTime(step: string): boolean {
  const key = `wa_${step}`;
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch {
    if (memoryFlags.has(key)) return false;
    memoryFlags.add(key);
    return true;
  }
}

// Where a visit came from: a ?ref=share link (see shared/share.ts) first,
// then ?utm_source=youtube on the link if there is one, otherwise the site
// that referred them, otherwise direct.
function visitSource(): string {
  try {
    const params = new URLSearchParams(location.search);
    if (params.get("ref") === "share") return "shared link";
    const utm = params.get("utm_source");
    if (utm) return utm;
    if (document.referrer) {
      const host = new URL(document.referrer).hostname.replace(/^www\./, "");
      if (host && host !== location.hostname.replace(/^www\./, "")) return host;
    }
  } catch {
    // an unreadable referrer just counts as direct
  }
  return "direct";
}

/** The app was opened (counted once per browser tab session). */
export function trackVisit() {
  if (firstTime("visit")) post("/site", { type: "visit", session_id: sessionId(), source: visitSource() });
}

/** The Listen Now button was pressed. */
export function trackListenNow() {
  if (firstTime("listen_now")) post("/site", { type: "listen_now", session_id: sessionId() });
}

function trackFirstPlay() {
  if (firstTime("first_play")) post("/site", { type: "first_play", session_id: sessionId() });
}

// ---------------------------------------------------------- listening events

export type PlaySource = "channel" | "album" | "programme" | "my-mood" | "radio-for-you";

export interface PlayInfo {
  contentType: "track" | "programme" | "channel";
  /** The track / programme / channel id. Omitted for a Radio That Knows You programme (built on the spot). */
  contentId?: string | null;
  channelId?: string | null;
  /** Radio That Knows You only: energy | love | switch-off | fun. */
  mood?: string | null;
  source: PlaySource;
  /** A wildcard (surprise) song in a Radio That Knows You programme. */
  wildcard?: boolean;
}

type EventType = "play_started" | "play_completed" | "play_skipped";

let buffer: Record<string, unknown>[] = [];
let timer: number | undefined;

// Events wait a moment so a skip and the next song's start travel together.
function flush() {
  timer = undefined;
  while (buffer.length > 0) post("/listening", { events: buffer.splice(0, 20) });
}

function log(type: EventType, info: PlayInfo, listenedSeconds?: number) {
  if (isOptedOut()) return;
  buffer.push({
    type,
    content_type: info.contentType,
    content_id: info.contentId ?? null,
    channel_id: info.channelId ?? null,
    mood: info.mood ?? null,
    source: info.source,
    wildcard: info.wildcard ? true : undefined,
    listened_seconds: listenedSeconds,
  });
  if (type === "play_started") trackFirstPlay();
  if (timer === undefined && typeof window !== "undefined") timer = window.setTimeout(flush, 400);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/**
 * One thing being played at a time. start() when it begins, complete() when it
 * ends by itself, abandon() when the listener moves on or leaves.
 *
 * A song left within its last couple of seconds counts as finished; anything
 * earlier counts as skipped, along with how far in they got. Starting something
 * new while another is open ends the old one automatically, so "next track"
 * buttons and tapping a different song are skips without any extra code.
 */
export class PlaySlot {
  private info: PlayInfo | null = null;
  private audio: HTMLAudioElement | null = null;
  private position = 0;
  private length = 0;
  private readonly sample = () => {
    if (!this.audio) return;
    this.position = this.audio.currentTime || 0;
    this.length = Number.isFinite(this.audio.duration) ? this.audio.duration : 0;
  };

  get isOpen() {
    return this.info !== null;
  }

  start(info: PlayInfo, audio: HTMLAudioElement | null = null) {
    this.abandon();
    this.info = info;
    this.audio = audio;
    this.position = 0;
    this.length = 0;
    audio?.addEventListener("timeupdate", this.sample);
    log("play_started", info);
  }

  /** It played to the end by itself. */
  complete() {
    if (!this.info) return;
    this.sample();
    this.close("play_completed", this.length || this.position);
  }

  /** The listener moved on or left: finished if they were right at the end, otherwise skipped. */
  abandon() {
    if (!this.info) return;
    this.sample();
    const atTheEnd = this.length > 0 && this.position >= this.length - 2;
    this.close(atTheEnd ? "play_completed" : "play_skipped", atTheEnd ? this.length : this.position);
  }

  /** Forget the play without logging an ending (a pause is not a skip). */
  discard() {
    this.audio?.removeEventListener("timeupdate", this.sample);
    this.info = null;
    this.audio = null;
  }

  private close(type: EventType, seconds: number) {
    const info = this.info!;
    // Only a play with its own audio has a meaningful "how far in" (a whole programme doesn't).
    const measured = this.audio !== null;
    this.discard();
    log(type, info, measured ? Math.round(seconds) : undefined);
  }
}

/** A PlaySlot for a component: whatever is open when it unmounts, or the tab closes, is abandoned. */
export function usePlaySlot(): PlaySlot {
  const ref = useRef<PlaySlot>();
  if (!ref.current) ref.current = new PlaySlot();
  useEffect(() => {
    const slot = ref.current!;
    const leaving = () => {
      slot.abandon();
      flush();
    };
    window.addEventListener("pagehide", leaving);
    return () => {
      window.removeEventListener("pagehide", leaving);
      slot.abandon();
    };
  }, []);
  return ref.current;
}

/**
 * A station is live radio: the server decides what is on air and the listener
 * can only play, pause or change channel. So:
 *  - pressing play on a channel is a "tune in" (a channel play_started);
 *  - each song heard from (nearly) the top is a track play, finished when it
 *    runs to the end and skipped if the listener changes channel or leaves first;
 *  - joining a song part-way through, or pausing, never counts as a skip.
 */
export function useChannelLog(audioRef: RefObject<HTMLAudioElement>, data: any, playing: boolean) {
  const slot = usePlaySlot();
  const channelId: string | null = data?.channel?.id ?? null;
  const item = data?.now_playing ?? null;
  const itemId: string | null = item?.id ?? null;
  const trackId: string | null = item?.item_type === "song" ? (item.track_id ?? null) : null;
  const position: number = data?.position_seconds ?? 0;

  const latest = useRef({ playing, channelId, trackId, position });
  latest.current = { playing, channelId, trackId, position };

  const open = (heardFrom: number) => {
    const { playing: on, channelId: ch, trackId: track } = latest.current;
    if (!on || !ch || !track || slot.isOpen || heardFrom > 30) return;
    slot.start({ contentType: "track", contentId: track, channelId: ch, source: "channel" }, audioRef.current);
  };

  // Someone tuned in.
  useEffect(() => {
    if (playing && channelId) log("play_started", { contentType: "channel", contentId: channelId, channelId, source: "channel" });
  }, [playing, channelId]);

  // The audio changed (a new song went on air, or the channel changed).
  useEffect(() => {
    slot.abandon();
    open(latest.current.position);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, channelId]);

  // Play or pause pressed.
  useEffect(() => {
    if (!playing) slot.discard();
    else open(audioRef.current?.currentTime ?? 999);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
}
