import { useEffect, useState, useSyncExternalStore } from "react";
import { mediaUrl, publicApi, type GoodAd } from "../../../api/client";
import { trackGoodPreview } from "../../../shared/analytics";
import { useOnline } from "../../../shared/offline";

/**
 * Advertising For Good previews (handoff_advertising_for_good.md §5.5).
 *
 * One preview element for the whole site, so starting an ad anywhere (the
 * landing card, /good) stops whichever ad was playing. It never takes over
 * the station's <audio> (NowPlayingBar owns that): it pauses the station
 * through the station bridge (contest/enter/useStationBridge.ts) and, if the
 * station was playing, presses play on it again when the preview ends or is
 * paused. Like the song pages' players, it also announces itself on the
 * "wr-audio-claim" event (lib/audioUtils.ts useExclusiveAudio) so any other
 * page player pauses, and steps aside when one of them starts.
 *
 * Nothing here logs a station play: previews only count as their own event.
 */

// lib/audioUtils.ts CLAIM_EVENT.
const CLAIM_EVENT = "wr-audio-claim";
const CLAIM_ID = "afg-preview";

export interface PreviewState {
  id: string | null;
  playing: boolean;
  current: number;
  duration: number;
}

let state: PreviewState = { id: null, playing: false, current: 0, duration: 0 };
const subscribers = new Set<() => void>();
let audio: HTMLAudioElement | null = null;
let stationPlaying = false;
// The station was playing when this preview started, so it gets play pressed again afterwards.
let resumeStation = false;

function set(patch: Partial<PreviewState>) {
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
  // Something else started (the station, a song page): this preview steps aside
  // and leaves the station alone, since the listener chose what plays next.
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

/** Play or pause an ad. Must be called straight from a click (iOS only starts audio inside one). */
export function toggleGood(ad: GoodAd) {
  const a = element();
  if (state.id === ad.id && !a.paused) {
    a.pause();
    resumeIfWeStoppedIt();
    return;
  }
  if (state.id !== ad.id) {
    a.src = mediaUrl(ad.audio_url);
    set({ id: ad.id, current: 0, duration: ad.duration_seconds, playing: false });
  }
  if (stationPlaying && !resumeStation) {
    resumeStation = true;
    window.dispatchEvent(new CustomEvent("war:player", { detail: { action: "pause" } }));
  }
  window.dispatchEvent(new CustomEvent(CLAIM_EVENT, { detail: CLAIM_ID }));
  const fromTop = (a.currentTime || 0) < 1;
  a.play().then(
    () => {
      if (fromTop) trackGoodPreview(ad.id);
    },
    () => {
      set({ playing: false });
      resumeIfWeStoppedIt();
    }
  );
}

export function useGoodPreview(): PreviewState {
  return useSyncExternalStore(
    (fn) => {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    () => state
  );
}

// ---------------------------------------------------------------- the ads

export interface GoodData {
  ads: GoodAd[];
  causeEnabled: boolean;
}

// Fetched once per page load and shared by everything that shows AFG (the
// hero line, the card, the nav pill, the footer link, /good).
let loaded: GoodData | null = null;
let loading: Promise<GoodData | null> | null = null;

function load(): Promise<GoodData | null> {
  if (!loading) {
    loading = publicApi
      .good()
      .then((r) => (loaded = { ads: r.ads, causeEnabled: r.cause_enabled }))
      .catch(() => {
        loading = null; // try again next time something asks
        return null;
      });
  }
  return loading;
}

/** The published ads, or null while loading, offline, or if the request failed. */
export function useGoodAds(): GoodData | null {
  const online = useOnline();
  const [data, setData] = useState<GoodData | null>(loaded);
  useEffect(() => {
    if (!online) return;
    let live = true;
    load().then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [online]);
  return online ? data : null;
}

/** "0:20" */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
