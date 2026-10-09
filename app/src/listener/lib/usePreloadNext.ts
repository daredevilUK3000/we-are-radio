import { useEffect, useRef, type RefObject } from "react";
import { mediaUrl } from "../../api/client";

/**
 * Preloads what the radio player is about to play (9 Oct 2026).
 *
 * A phone with its screen off only keeps a web page running while sound is
 * coming out of it. Each song (and each jingle over a song) is its own file,
 * so every change used to start with a download - a moment of silence in
 * which the phone could freeze the page, and the next song then never
 * started until the listener woke the phone.
 *
 * So the files are fetched ahead of time into the browser's own cache (the
 * /media responses are cacheable for a year), and when the player switches to
 * one it comes straight from the phone instead of the network:
 * - the jingles over the song now loaded, as soon as it loads (they start a
 *   few seconds in);
 * - the next item, and the jingles over it, from PRELOAD_BEFORE_END_S before
 *   the current one ends.
 *
 * One song at a time, at low priority, and never on a "save data" connection.
 * A file is fetched at most once per page.
 */

const PRELOAD_BEFORE_END_S = 75;

const fetched = new Set<string>();

function saveData(): boolean {
  return !!(navigator as any).connection?.saveData;
}

async function warm(url: string | null | undefined): Promise<void> {
  if (!url || fetched.has(url) || saveData() || !navigator.onLine) return;
  fetched.add(url);
  try {
    const res = await fetch(mediaUrl(url), { priority: "low" } as RequestInit);
    // Read it to the end (and let it go): that is what puts the whole file in the cache.
    const reader = res.ok ? res.body?.getReader() : undefined;
    if (!reader) return;
    for (;;) {
      const { done } = await reader.read();
      if (done) break;
    }
  } catch {
    fetched.delete(url); // try again next time it comes round
  }
}

const overlayUrls = (item: any): string[] => (Array.isArray(item?.overlays) ? item.overlays.map((o: any) => o?.audio_url).filter(Boolean) : []);

export function usePreloadNext(audioRef: RefObject<HTMLAudioElement>, loadedItem: any, data: any) {
  const latest = useRef({ loadedItem, data });
  latest.current = { loadedItem, data };

  // The jingles over the song that has just loaded: small, needed within seconds.
  useEffect(() => {
    for (const u of overlayUrls(loadedItem)) void warm(u);
  }, [loadedItem?.id]);

  // The next item, once the current one is nearly over.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let warmedFor: string | null = null; // per item: each one warms its successor once
    const onTime = () => {
      const { loadedItem: item, data: d } = latest.current;
      const end = Number(item?.duration_seconds);
      if (!item || !(end > 0) || warmedFor === item.id) return;
      if (audio.currentTime < end - PRELOAD_BEFORE_END_S) return;
      // While a song finishes after the station has moved on, now_playing is already the next item.
      const next = d?.now_playing && d.now_playing.id !== item.id ? d.now_playing : d?.up_next;
      if (!next || next.id === item.id) return;
      warmedFor = item.id;
      void (async () => {
        await warm(next.audio_url);
        for (const u of overlayUrls(next)) await warm(u);
      })();
    };
    audio.addEventListener("timeupdate", onTime);
    return () => audio.removeEventListener("timeupdate", onTime);
    // Re-attached per item: the player's <audio> element may only exist once something has loaded.
  }, [audioRef, loadedItem?.id]);
}
