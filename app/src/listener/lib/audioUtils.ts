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

/**
 * Where the station is now in the item a now-playing answer described,
 * counting the time since it arrived (useStationLog stamps received_at_ms).
 * Null when that item is already over, or the answer has no stamp.
 */
export function livePosition(data: any): number | null {
  const item = data?.now_playing;
  if (!item || !data.received_at_ms) return null;
  const pos = (data.position_seconds ?? 0) + (Date.now() - data.received_at_ms) / 1000;
  return pos < (Number(item.duration_seconds) || Infinity) - 1 ? pos : null;
}

// The station runs on the server's clock, but a listener's playback starts a
// few seconds behind it (buffering, a stall, a pause), so when the clock moves
// on to the next item the last seconds of their song are often still playing.
// Rather than cut it off, the radio players let it finish: its "ended" event
// then loads whatever is on air. Only while it's really sounding - a paused or
// stalled element switches straight away, as before.
export function stillFinishing(audio: HTMLAudioElement, hadItem: boolean): boolean {
  return hadItem && !!audio.src && !audio.paused && !audio.ended && audio.readyState > 2;
}

// After letting a song finish, the next one starts from the top if the station
// is only this far into it (no clipped intros); further behind than that, the
// player rejoins the live point so listeners don't drift ever later.
export const CATCH_UP_SECONDS = 15;

/**
 * Where to start the item that has just come on air.
 * - After letting the last song finish (waited): from the top if the station
 *   is at most CATCH_UP_SECONDS in, else at the live point.
 * - A spoken item (a listener's voice note, a link, a station ID) following
 *   one this player was already playing: from the top too. The player only
 *   hears about the change a second or so after it happens (the refresh, then
 *   the network; the server's position is in whole seconds), which on a
 *   six-second shout-out was its first word. Songs keep joining live.
 * - Otherwise (tuning in, switching channel): the live point.
 */
export function startPosition(item: any, position: number, waited: boolean, followsOn: boolean): number {
  if (position > CATCH_UP_SECONDS) return position;
  if (waited) return 0;
  if (followsOn && item?.item_type && item.item_type !== "song") return 0;
  return position;
}

/**
 * When a song ends, what to play next, worked out from what the player already
 * knows - so the next song starts inside the "ended" event itself.
 *
 * Waiting for the server first (the old way) broke on phones: with the screen
 * locked, the page only keeps running while audio plays, so in the gap between
 * the song ending and the answer arriving the phone suspended it and the radio
 * went silent until the listener came back and pressed play (3 Oct 2026).
 *
 * - Held back (the station moved on while this song finished): now_playing is
 *   already the next item.
 * - Otherwise the song ended on time: up_next, at how far the station is into
 *   it (from when this answer arrived, not the phone's clock).
 * Null when it can't tell; the caller then asks the server as before.
 */
export function nextOnEnded(data: any, currentId: string | null, nowMs = Date.now()): { item: any; from: number } | null {
  if (!data?.on_air || !data.received_at_ms) return null;
  const now = data.now_playing;
  if (now && now.id !== currentId) {
    const pos = livePosition(data);
    if (pos === null || !now.audio_url) return null;
    return { item: now, from: startPosition(now, pos, true, true) };
  }
  const next = data.up_next;
  if (!now || !next || next.id === currentId || !next.audio_url) return null;
  const intoNext = (data.position_seconds ?? 0) + (nowMs - data.received_at_ms) / 1000 - (Number(now.duration_seconds) || 0);
  const pos = Math.max(0, intoNext);
  if (Number(next.duration_seconds) && pos >= Number(next.duration_seconds) - 1) return null;
  return { item: next, from: startPosition(next, pos, true, true) };
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
