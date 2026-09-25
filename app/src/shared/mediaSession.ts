import { useEffect, useRef, type RefObject } from "react";
import { mediaUrl } from "../api/client";

/**
 * Lock-screen and notification controls (the browser's Media Session API):
 * the track, artist and artwork a phone shows while the site plays in the
 * background, and the play/pause buttons there.
 *
 * The site has several <audio> elements (the mini-player, the Listen page,
 * album and track pages...). Whichever one started playing most recently owns
 * the lock screen. A player that registers with useMediaSession gets its own
 * details shown; any other element that starts playing clears them, so the
 * lock screen never shows the radio's song over an album track.
 */

export interface MediaSessionInfo {
  title: string;
  artist: string;
  album: string;
  /** Full image URL; the lock screen scales it to whatever size it needs. */
  artworkUrl: string;
}

export interface MediaSessionOptions {
  /** Live radio: no seeking (the broadcast decides where you are). */
  live: boolean;
  /** Skipping allowed on this player (no radio channel allows it today). */
  onNext?: () => void;
  onPlay: () => void;
  onPause: () => void;
}

interface Entry {
  info: MediaSessionInfo | null;
  options: MediaSessionOptions;
  /** What was last shown, so the lock screen is only rewritten when it changes. */
  key: string;
}

const supported = typeof navigator !== "undefined" && "mediaSession" in navigator;
const entries = new Map<HTMLAudioElement, Entry>();
let owner: HTMLAudioElement | null = null;

// Station artwork: every size the handoff asks for points at the one image;
// the phone downscales it (artwork is stored once, at full size, in R2).
const ARTWORK_SIZES = ["96x96", "192x192", "256x256", "512x512"];

function imageType(url: string): string | undefined {
  const ext = /\.(\w+)(?:[?#]|$)/.exec(url)?.[1]?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return undefined;
}

function setHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch {
    // Older browsers throw for actions they don't know (e.g. "stop"); skip it.
  }
}

function applyMetadata(entry: Entry) {
  const info = entry.info;
  if (!info) {
    navigator.mediaSession.metadata = null;
    return;
  }
  const type = imageType(info.artworkUrl);
  navigator.mediaSession.metadata = new MediaMetadata({
    title: info.title,
    artist: info.artist,
    album: info.album,
    artwork: ARTWORK_SIZES.map((sizes) => ({ src: info.artworkUrl, sizes, ...(type ? { type } : {}) })),
  });
}

function applyHandlers(audio: HTMLAudioElement, entry: Entry) {
  // Handlers read the entry at call time, so they always reach the player's
  // latest callbacks without being re-registered on every render.
  const current = () => entries.get(audio)?.options;
  setHandler("play", () => current()?.onPlay());
  setHandler("pause", () => current()?.onPause());
  // Stop from the notification: pause (a radio has nothing to rewind to).
  setHandler("stop", () => {
    current()?.onPause();
    navigator.mediaSession.playbackState = "paused";
  });
  setHandler("nexttrack", entry.options.onNext ? () => current()?.onNext?.() : null);
  setHandler("previoustrack", null);
  // Live radio offers no seeking at all: no scrubber, no +/-10s buttons that
  // would move the listener off the broadcast.
  const audioEl = audio;
  const seek = (details: MediaSessionActionDetails) => {
    if (details.seekTime !== undefined) audioEl.currentTime = details.seekTime;
  };
  setHandler("seekto", entry.options.live ? null : seek);
  setHandler("seekbackward", null);
  setHandler("seekforward", null);
}

function clearSession() {
  owner = null;
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = "none";
  for (const action of ["play", "pause", "stop", "nexttrack", "previoustrack", "seekto", "seekbackward", "seekforward"] as MediaSessionAction[]) {
    setHandler(action, null);
  }
}

// Media events don't bubble, but they can be caught on the way down, so one
// listener sees every <audio> on the page start or pause.
if (supported && typeof document !== "undefined") {
  document.addEventListener(
    "play",
    (e) => {
      const el = e.target;
      if (!(el instanceof HTMLAudioElement)) return;
      const entry = entries.get(el);
      if (!entry) {
        clearSession();
        return;
      }
      owner = el;
      applyMetadata(entry);
      applyHandlers(el, entry);
      navigator.mediaSession.playbackState = "playing";
    },
    true
  );
  document.addEventListener(
    "pause",
    (e) => {
      if (e.target === owner) navigator.mediaSession.playbackState = "paused";
    },
    true
  );
}

/**
 * Show this player on the lock screen whenever it's the one playing, and keep
 * the details current as the track changes (including with the screen
 * locked - the update rides on the same "ended"/poll that loads the next song).
 */
export function useMediaSession(
  audioRef: RefObject<HTMLAudioElement>,
  info: MediaSessionInfo | null,
  options: MediaSessionOptions
) {
  const registered = useRef<HTMLAudioElement | null>(null);
  const key = [info?.title, info?.artist, info?.album, info?.artworkUrl, options.live, !!options.onNext].join("|");

  // Runs after every render: the <audio> element may only appear once the
  // station is on air, and the callbacks change each render.
  useEffect(() => {
    if (!supported) return;
    const el = audioRef.current;
    if (registered.current && registered.current !== el) unregister(registered.current);
    registered.current = el;
    if (!el) return;

    const existing = entries.get(el);
    const changed = !existing || existing.key !== key;
    const entry: Entry = existing ?? { info, options, key };
    entry.info = info;
    entry.options = options;
    entry.key = key;
    entries.set(el, entry);
    if (changed && owner === el) {
      applyMetadata(entry);
      applyHandlers(el, entry);
    }
  });

  useEffect(
    () => () => {
      if (registered.current) unregister(registered.current);
    },
    []
  );
}

function unregister(el: HTMLAudioElement) {
  entries.delete(el);
  if (owner === el) clearSession();
}

const STATION_ARTWORK = "/icons/icon-512.png";

/**
 * Lock-screen details for a radio channel, from the /api/now-playing payload.
 * Songs show their credited artist (Kizzi when none is set) and album; a
 * jingle or talk item shows the station instead. Items without artwork of
 * their own fall back to the square station logo.
 */
export function radioSessionInfo(data: any): MediaSessionInfo | null {
  if (!data?.on_air) return null;
  const now = data.now_playing;
  const station: string = data.channel?.name ?? "We Are Radio";
  const isSong = now?.item_type === "song";
  const art = now?.artwork_url ? mediaUrl(now.artwork_url) : STATION_ARTWORK;
  return {
    title: now?.label ?? station,
    artist: isSong ? now?.artist || "Kizzi" : station,
    album: (isSong && now?.album_title) || station,
    artworkUrl: new URL(art, window.location.href).href,
  };
}
