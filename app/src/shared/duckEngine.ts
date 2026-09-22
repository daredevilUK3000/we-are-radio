import { useEffect, useRef, type RefObject } from "react";
import { mediaUrl } from "../api/client";

/**
 * Plays a jingle *over* the song that is already playing, turning the music
 * down while the voice speaks and bringing it back up afterwards - the
 * classic radio "sweeper". Entirely in the listener's browser: no server
 * mixing, no AI, nothing extra to store.
 *
 * How it works: two ordinary <audio> elements play at once - the music, and
 * a second one for the jingle - and the music element's volume is ramped
 * down and back up in small steps (~30 ms), so it glides rather than jumps
 * and there's no click.
 *
 * Why not route both through a Web Audio gain-node graph? Because it costs
 * more than it gives here: an element routed into Web Audio goes silent if
 * its audio comes from another origin (the podcasts do), and on iPhones it
 * stops playing when the screen locks - a radio app's listeners lock their
 * phones. Two elements overlap fine; the only thing plain elements can't do
 * is change volume on iPhone/iPad (Apple ignores it), so there the jingle is
 * skipped rather than played on top of music at full volume.
 *
 * The station's rules (lib/radioBrain.ts on the server) decide WHEN a jingle
 * comes in and how it should sound; this file only carries that out.
 */

export interface Overlay {
  asset_id: string;
  label?: string;
  audio_url: string;
  duration_seconds: number;
  start_offset_seconds: number;
  duck_level: number;
  duck_fade_ms: number;
}

// A 1-sample silent clip, used to "prime" the jingle element inside a click
// (some browsers only let an element play later if it was started by one).
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

const jingleElements = new WeakMap<HTMLAudioElement, HTMLAudioElement>();
const cancelers = new WeakMap<HTMLAudioElement, () => void>();
const volumeRamps = new WeakMap<HTMLAudioElement, number>();

let volumeSupport: boolean | null = null;
/** iPhones and iPads ignore an <audio> element's volume; everything else obeys it. */
function canDuck(): boolean {
  if (volumeSupport === null) {
    try {
      const probe = new Audio();
      probe.volume = 0.5;
      volumeSupport = probe.volume === 0.5;
    } catch {
      volumeSupport = false;
    }
  }
  return volumeSupport;
}

/**
 * Prepare a music element to have jingles played over it. Call this from a
 * click/tap handler (the play press): browsers only let audio start from a
 * user gesture, and that press is what unlocks everything the player does
 * afterwards, including every jingle. Safe to call repeatedly; never throws.
 */
export async function unlockAudio(music: HTMLAudioElement | null): Promise<void> {
  if (!music || jingleElements.has(music) || !canDuck()) return;
  const jingle = new Audio();
  jingleElements.set(music, jingle);
  try {
    jingle.src = SILENT_WAV;
    await jingle.play();
    jingle.pause();
  } catch {
    // The element still works on browsers that don't need priming.
  }
}

function rampVolume(audio: HTMLAudioElement, to: number, ms: number) {
  window.clearInterval(volumeRamps.get(audio));
  const from = audio.volume;
  const start = performance.now();
  const id = window.setInterval(() => {
    const t = Math.min(1, (performance.now() - start) / Math.max(ms, 1));
    audio.volume = Math.min(1, Math.max(0, from + (to - from) * t));
    if (t >= 1) window.clearInterval(id);
  }, 30);
  volumeRamps.set(audio, id);
}

/** Stop any jingle currently ducking this music element and restore its volume. */
export function cancelOverlay(music: HTMLAudioElement | null) {
  if (music) cancelers.get(music)?.();
}

/**
 * Duck the music, play the jingle over it, bring the music back. Resolves
 * when the music is back up. One jingle at a time per music element.
 */
export function playOverlay(music: HTMLAudioElement, overlay: Overlay): Promise<void> {
  if (!canDuck() || cancelers.has(music)) return Promise.resolve();

  return new Promise((resolve) => {
    const jingle = jingleElements.get(music) ?? new Audio();
    jingleElements.set(music, jingle);
    // duck_level is set in the Studio as "music plays at N% while the jingle
    // talks" - a fraction of whatever the listener has it set to, not a fixed
    // floor. Capturing it here (rather than assuming full volume) is what
    // makes a volume control - like the shared track page's - duck correctly
    // instead of ducking to, or restoring at, the wrong level.
    const restoreVolume = music.volume;

    let done = false;
    const onMusicPause = () => jingle.pause();
    const onMusicPlay = () => jingle.play().catch(() => {});
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(safety);
      jingle.removeEventListener("ended", finish);
      jingle.removeEventListener("error", finish);
      music.removeEventListener("pause", onMusicPause);
      music.removeEventListener("play", onMusicPlay);
      cancelers.delete(music);
      jingle.pause();
      rampVolume(music, restoreVolume, overlay.duck_fade_ms);
      resolve();
    };
    // If the jingle never ends (a load error that doesn't fire, say), the
    // music must still come back up.
    const safety = window.setTimeout(finish, (overlay.duration_seconds + 3) * 1000);

    cancelers.set(music, finish);
    jingle.addEventListener("ended", finish);
    jingle.addEventListener("error", finish);
    // Pausing the music pauses the voice with it.
    music.addEventListener("pause", onMusicPause);
    music.addEventListener("play", onMusicPlay);

    jingle.src = mediaUrl(overlay.audio_url);
    jingle.currentTime = 0;
    rampVolume(music, restoreVolume * overlay.duck_level, overlay.duck_fade_ms);
    jingle.play().catch(finish);
  });
}

/**
 * Fires an item's jingle overlays at the right moment while it plays: when
 * the song passes an overlay's start offset, that jingle is ducked in over it.
 * `item` is the currently playing running-order item (with its `overlays`).
 * A listener who joins after the offset just misses it, as on real radio.
 */
export function useOverlayJingles(
  audioRef: RefObject<HTMLAudioElement>,
  item: { id: string; overlays?: Overlay[] } | null | undefined,
  ready: boolean = true
) {
  const itemRef = useRef(item);
  itemRef.current = item;
  const fired = useRef(new Set<string>());
  const lastItemId = useRef<string | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !ready) return;

    const onTimeUpdate = () => {
      const current = itemRef.current;
      if (!current) return;
      // A new item starting means its overlays are fresh again.
      if (lastItemId.current !== current.id) {
        lastItemId.current = current.id;
        fired.current.clear();
        cancelOverlay(audio);
      }
      if (!current.overlays?.length) return;
      for (const overlay of current.overlays) {
        const key = `${current.id}:${overlay.asset_id}`;
        if (fired.current.has(key)) continue;
        const t = audio.currentTime;
        if (t >= overlay.start_offset_seconds && t < overlay.start_offset_seconds + 6) {
          fired.current.add(key);
          void playOverlay(audio, overlay);
        }
      }
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      cancelOverlay(audio);
    };
  }, [audioRef, ready]);
}
