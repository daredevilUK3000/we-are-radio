import { useEffect, useState, useSyncExternalStore } from "react";
import { mediaUrl, publicApi, type BookAiring, type PublicBook } from "../../../api/client";
import { trackBookPreview } from "../../../shared/analytics";
import { useOnline } from "../../../shared/offline";

/**
 * Book of the Month on demand (the landing card and /books), exactly as the
 * Advertising For Good previews (good/goodPreview.ts): one element for the
 * whole site, which pauses the station through the station bridge and
 * presses play on it again afterwards if it was playing. It announces itself
 * on "wr-audio-claim", so an AFG preview or a song page player pauses when
 * it starts, and it steps aside when one of them starts.
 *
 * Nothing here logs a station play: a listen is only its own event.
 */

// lib/audioUtils.ts CLAIM_EVENT.
const CLAIM_EVENT = "wr-audio-claim";
const CLAIM_ID = "botm-preview";

export interface BookPreviewState {
  id: string | null;
  playing: boolean;
  current: number;
  duration: number;
}

let state: BookPreviewState = { id: null, playing: false, current: 0, duration: 0 };
const subscribers = new Set<() => void>();
let audio: HTMLAudioElement | null = null;
let stationPlaying = false;
// The station was playing when this listen started, so it gets play pressed again afterwards.
let resumeStation = false;

function set(patch: Partial<BookPreviewState>) {
  state = { ...state, ...patch };
  subscribers.forEach((fn) => fn());
}

function resumeIfWeStoppedIt() {
  if (!resumeStation) return;
  resumeStation = false;
  window.dispatchEvent(new CustomEvent("war:player", { detail: { action: "play" } }));
}

if (typeof window !== "undefined") {
  window.addEventListener("war:player-state", (e) => {
    stationPlaying = !!(e as CustomEvent).detail?.playing;
  });
  window.dispatchEvent(new Event("war:player-state-request"));
  // Something else started (the station, an AFG preview, a song page): this steps aside and leaves the station alone.
  window.addEventListener(CLAIM_EVENT, (e) => {
    if ((e as CustomEvent).detail === CLAIM_ID || !audio || audio.paused) return;
    resumeStation = false;
    audio.pause();
  });
}

function element(): HTMLAudioElement {
  if (audio) return audio;
  const a = new Audio();
  a.preload = "none";
  a.addEventListener("timeupdate", () => set({ current: a.currentTime || 0 }));
  a.addEventListener("loadedmetadata", () => {
    if (Number.isFinite(a.duration) && a.duration > 0) set({ duration: a.duration });
  });
  a.addEventListener("play", () => set({ playing: true }));
  a.addEventListener("pause", () => set({ playing: false }));
  a.addEventListener("ended", () => {
    set({ playing: false, current: 0 });
    resumeIfWeStoppedIt();
  });
  audio = a;
  return a;
}

/** Play or pause a book's segment. Must be called straight from a click (iOS only starts audio inside one). */
export function toggleBook(book: PublicBook, source: "page" | "books") {
  if (!book.audio_url) return;
  const a = element();
  if (state.id === book.id && !a.paused) {
    a.pause();
    resumeIfWeStoppedIt();
    return;
  }
  if (state.id !== book.id) {
    a.src = mediaUrl(book.audio_url);
    set({ id: book.id, current: 0, duration: book.duration_seconds ?? 0, playing: false });
  }
  if (stationPlaying && !resumeStation) {
    resumeStation = true;
    window.dispatchEvent(new CustomEvent("war:player", { detail: { action: "pause" } }));
  }
  window.dispatchEvent(new CustomEvent(CLAIM_EVENT, { detail: CLAIM_ID }));
  const fromTop = (a.currentTime || 0) < 1;
  a.play().then(
    () => {
      if (fromTop) trackBookPreview(book.id, source);
    },
    () => {
      set({ playing: false });
      resumeIfWeStoppedIt();
    }
  );
}

export function useBookPreview(): BookPreviewState {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => state
  );
}

// ---------------------------------------------------------------- the current book

export interface CurrentBook {
  book: PublicBook & { next_airing: BookAiring | null };
  more: boolean;
}

let loaded: CurrentBook | null | undefined;
let loading: Promise<CurrentBook | null> | null = null;

function load(): Promise<CurrentBook | null> {
  if (!loading) {
    loading = publicApi
      .currentBook()
      .then((r) => (loaded = r.book ? { book: r.book, more: r.more } : null))
      .catch(() => {
        loading = null; // try again next time something asks
        return null;
      });
  }
  return loading;
}

/** This month's book (once its airings are published), or null: none, loading, or the request failed. */
export function useCurrentBook(): CurrentBook | null {
  const online = useOnline();
  const [data, setData] = useState<CurrentBook | null>(loaded ?? null);
  useEffect(() => {
    let live = true;
    load().then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [online]);
  return data;
}

// ---------------------------------------------------------------- words

/** "0:20" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "October" for 2026-10 (with the year: "October 2026"). */
export function monthName(month: string, withYear = false): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-GB", { month: "long", ...(withYear ? { year: "numeric" } : {}), timeZone: "UTC" });
}

/** "today at 19:05", "tomorrow at 08:05", "on Saturday at 14:05", in the listener's own time. */
export function whenOnAir(startsAt: number, now = Date.now()): string {
  const at = new Date(startsAt * 1000);
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(at) - day(new Date(now))) / 86_400_000);
  if (days <= 0) return `today at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  return `on ${at.toLocaleDateString("en-GB", { weekday: "long" })} at ${time}`;
}
