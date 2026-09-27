import { useCallback, useEffect, useRef, type RefObject } from "react";
import { ApiError, publicApi } from "../../api/client";
import { syncCastQueue } from "../../shared/cast";

/**
 * The radio players' link to the station's log (NowPlayingBar and Listen
 * share it). On top of the regular now-playing poll:
 *
 * - While playing, it asks every 10 s which version of the Scheduler's log is
 *   live, and refetches straight away when it changes - so a Skip or a Play
 *   now reaches listeners within seconds. (Channels still on the old playback
 *   report version 0 and never change.)
 * - It keeps the next two hours of the running order in memory, refreshed
 *   every 30 minutes and on every version change. If now-playing can't be
 *   reached, it works out what's on from that buffer by the clock and keeps
 *   playing, retrying quietly (5 s, 10 s, 20 s ... up to a minute) - no error
 *   while the buffer still covers now.
 * - When an airing is scheduled to end before its file does (the Scheduler
 *   trimming the last song before a fixed start), it fades out over 1.5 s at
 *   that point and moves on.
 */

const VERSION_POLL_MS = 10_000;
const BUFFER_MINUTES = 120;
const BUFFER_REFRESH_MS = 30 * 60_000;
const FADE_MS = 1500;

interface Buffer {
  channel: any;
  programme: any;
  items: any[];
}

/** The running order's item on air at `nowSec`, as a now-playing response. */
function fromBuffer(buf: Buffer | null, last: any, nowSec: number) {
  if (!buf) return null;
  const idx = buf.items.findIndex((i) => i.starts_at <= nowSec && nowSec < i.starts_at + i.duration_seconds);
  if (idx < 0) return null;
  const cur = buf.items[idx];
  const rest = buf.items.slice(idx + 1);
  return {
    ...(last ?? {}),
    channel: buf.channel ?? last?.channel,
    programme: last?.programme ?? buf.programme,
    on_air: true,
    position_seconds: Math.floor(nowSec - cur.starts_at),
    now_playing: cur,
    up_next: rest[0] ?? null,
    coming_up: rest.filter((i) => i.item_type !== "station_id").slice(0, 4),
    from_buffer: true,
  };
}

export function useStationLog({
  channelSlug,
  pollMs,
  playing,
  audioRef,
  loadedItem,
  setData,
  setUnreachable,
}: {
  channelSlug: string;
  pollMs: number;
  playing: boolean;
  audioRef: RefObject<HTMLAudioElement>;
  /** The item actually in the <audio> element. */
  loadedItem: any;
  setData: (d: any) => void;
  setUnreachable: (u: boolean) => void;
}) {
  const buffer = useRef<Buffer | null>(null);
  const last = useRef<any>(null);
  const version = useRef<number | null>(null);
  const failures = useRef(0);
  const retry = useRef(0);
  const slugRef = useRef(channelSlug);
  slugRef.current = channelSlug;

  const refreshBuffer = useCallback(async () => {
    const slug = slugRef.current;
    try {
      const s: any = await publicApi.schedule(slug, BUFFER_MINUTES);
      if (slug !== slugRef.current) return;
      buffer.current = s.on_air ? { channel: s.channel, programme: s.programme, items: s.items ?? [] } : null;
    } catch {
      // keep the old buffer: it's what carries us through an outage
    }
  }, []);

  const refresh = useCallback(async () => {
    const slug = slugRef.current;
    window.clearTimeout(retry.current);
    try {
      const d = await publicApi.nowPlaying(slug);
      if (slug !== slugRef.current) return;
      failures.current = 0;
      last.current = d;
      setData(d);
      setUnreachable(false);
    } catch (err) {
      if (slug !== slugRef.current) return;
      if (err instanceof ApiError) {
        // A real answer (the channel was switched off): as before.
        setData(null);
        setUnreachable(false);
        return;
      }
      const synthetic = fromBuffer(buffer.current, last.current, Date.now() / 1000);
      if (synthetic) {
        setData(synthetic);
        setUnreachable(false);
      } else {
        setData(null);
        setUnreachable(true);
      }
      failures.current++;
      const wait = Math.min(60_000, 5_000 * 2 ** (failures.current - 1));
      retry.current = window.setTimeout(() => void refresh(), wait);
    }
  }, [setData, setUnreachable]);

  // Now-playing poll and the buffer, per channel.
  useEffect(() => {
    buffer.current = null;
    last.current = null;
    version.current = null;
    failures.current = 0;
    void refresh();
    void refreshBuffer();
    const poll = window.setInterval(() => void refresh(), pollMs);
    const buf = window.setInterval(() => void refreshBuffer(), BUFFER_REFRESH_MS);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(buf);
      window.clearTimeout(retry.current);
    };
  }, [channelSlug, pollMs, refresh, refreshBuffer]);

  // Change propagation: the log's version, every 10 s while playing.
  useEffect(() => {
    if (!playing) return;
    let cancelled = false;
    const check = async () => {
      try {
        const { version: v } = await publicApi.nowPlayingVersion(slugRef.current);
        if (cancelled) return;
        if (version.current !== null && v !== version.current && v > 0) {
          void refresh();
          void refreshBuffer();
          void syncCastQueue(slugRef.current);
        }
        version.current = v;
      } catch {
        // unreachable: the now-playing retry handles it
      }
    };
    void check();
    const id = window.setInterval(check, VERSION_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [playing, channelSlug, refresh, refreshBuffer]);

  // A scheduled early end: fade out over 1.5 s, finishing exactly at the scheduled end, then move on.
  useEffect(() => {
    const audio = audioRef.current;
    const endAt = Number(loadedItem?.duration_seconds);
    const fileLength = Number(loadedItem?.file_duration_seconds);
    if (!audio || !loadedItem || !(fileLength > endAt + 0.5)) return;
    let fading = false;
    let startVolume = 1;
    const onTime = () => {
      const t = audio.currentTime;
      if (!fading && t >= endAt - FADE_MS / 1000) {
        fading = true;
        startVolume = audio.volume;
      }
      if (fading && t < endAt) {
        const left = Math.max(0, endAt - t) / (FADE_MS / 1000);
        audio.volume = Math.max(0, Math.min(1, startVolume * left));
      }
      if (t >= endAt) {
        audio.removeEventListener("timeupdate", onTime);
        audio.pause();
        audio.volume = startVolume;
        // Paused, the player no longer lets it "finish": the next item loads.
        void refresh();
      }
    };
    audio.addEventListener("timeupdate", onTime);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      if (fading) audio.volume = startVolume;
    };
  }, [audioRef, loadedItem, refresh]);

  return { refresh };
}
