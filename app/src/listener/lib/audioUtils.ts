import { useEffect, type RefObject } from "react";

/**
 * Podcast feeds describe episodes in HTML ("<p>...</p>"). Turn that into
 * plain text for display - paragraphs and line breaks kept, tags dropped,
 * entities decoded. Parsed into an inert document, so nothing in the feed can
 * run or render.
 */
export function plainText(html: string | null | undefined): string {
  if (!html) return "";
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n");
  const text = new DOMParser().parseFromString(withBreaks, "text/html").body.textContent ?? "";
  return text.replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** 75 -> "1:15", 3725 -> "1:02:05". */
export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

// Several places on the site have their own <audio> element (the fixed
// mini-player, a podcast or programme page, an album page). Without this,
// starting one would leave the others playing underneath it. Whenever one
// starts, it announces itself and every other player pauses.
const CLAIM_EVENT = "wr-audio-claim";

export function useExclusiveAudio(
  id: string,
  audioRef: RefObject<HTMLAudioElement>,
  ready: boolean = true,
  onYield?: () => void
) {
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !ready) return;

    const claim = () => window.dispatchEvent(new CustomEvent(CLAIM_EVENT, { detail: id }));
    const yieldTo = (e: Event) => {
      if ((e as CustomEvent).detail === id || audio.paused) return;
      audio.pause();
      onYield?.();
    };

    audio.addEventListener("play", claim);
    window.addEventListener(CLAIM_EVENT, yieldTo);
    return () => {
      audio.removeEventListener("play", claim);
      window.removeEventListener(CLAIM_EVENT, yieldTo);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, ready]);
}
