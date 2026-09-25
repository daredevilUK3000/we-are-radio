import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { objectUrlFor, type OfflineBlock } from "../../shared/offline";
import { useMediaSession } from "../../shared/mediaSession";
import { useExclusiveAudio } from "../lib/audioUtils";

const POSITION_KEY = "we-are-radio:offline-position";

function PlayIcon() {
  return <span className="play-triangle" />;
}

function PauseIcon() {
  return (
    <span className="mp-pause-icon">
      <span />
      <span />
    </span>
  );
}

function loadPosition(block: OfflineBlock): { index: number; time: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(POSITION_KEY) ?? "null");
    if (saved?.channelSlug === block.channelSlug && saved.downloadedAt === block.downloadedAt && saved.index < block.items.length) {
      return { index: saved.index, time: saved.time ?? 0 };
    }
  } catch {
    // start from the top
  }
  return { index: 0, time: 0 };
}

/**
 * The mini-player while listening offline: plays a downloaded block in order
 * from the phone's storage, looping at the end (it's radio - it shouldn't
 * just stop). Files are played as blob: URLs straight out of Cache Storage,
 * which works the same on every browser (no reliance on the service worker
 * answering the audio element's range requests). Remembers where it was, so
 * pausing, closing the app and coming back carries on from the same spot.
 */
export function OfflineBar({
  block,
  online,
  autoStart,
  onBackToLive,
}: {
  block: OfflineBlock;
  online: boolean;
  /** Start playing as soon as the first song is loaded ("Play downloads" was pressed). */
  autoStart: boolean;
  onBackToLive: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const start = useRef(loadPosition(block));
  const [index, setIndex] = useState(start.current.index);
  const [playing, setPlaying] = useState(autoStart);
  const [art, setArt] = useState<string | null>(null);
  const [cleared, setCleared] = useState(false);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  const missedInARow = useRef(0);
  // Something went wrong playing a download - shown in the bar, in words.
  const [problem, setProblem] = useState<string | null>(null);
  // The current song's file is loaded into the player (a press before then
  // is remembered and acted on as soon as it is).
  const srcReady = useRef(false);

  // Downloads normally play from a blob: copy of the stored file. If a phone
  // won't play that, the same stored file is played through the service
  // worker instead (its /media/... address, answered from storage). Only if
  // both fail does the listener see a message.
  const switchToStoredAddress = (): boolean => {
    const audio = audioRef.current;
    const current = blockRef.current.items[indexRef.current];
    if (!audio || !current || !audio.src.startsWith("blob:")) return false;
    const at = audio.currentTime;
    audio.src = current.audio;
    if (at) audio.currentTime = at;
    if (playingRef.current) audio.play().catch(onPlayRefused);
    return true;
  };

  // Only a real refusal (the browser blocking playback) means "not playing".
  // Loading the next song cancels the previous song's pending play() with an
  // AbortError - that one must be ignored, or the button shows "play" while
  // the next song is playing.
  const onPlayRefused = (err: unknown) => {
    const name = (err as DOMException)?.name;
    if (name === "AbortError") return;
    if (name === "NotSupportedError" && switchToStoredAddress()) return;
    setPlaying(false);
    if (name === "NotAllowedError") setProblem("Tap play again to start.");
    else if (name) setProblem(`This download wouldn't play (${name}).`);
  };

  useExclusiveAudio("offline", audioRef, true, () => setPlaying(false));

  const item = block.items[index];
  const indexRef = useRef(index);
  indexRef.current = index;
  // The block is re-read whenever downloads change; only a different
  // download (or item) should reload the audio, not a fresh copy of the list.
  const blockRef = useRef(block);
  blockRef.current = block;

  // Load the current item's file (and artwork) from storage.
  useEffect(() => {
    const item = blockRef.current.items[index];
    const count = blockRef.current.items.length;
    if (!item) {
      // A fresh download of this channel replaced the old one: start it from the top.
      setIndex(0);
      return;
    }
    let cancelled = false;
    let audioUrl: string | null = null;
    let artUrl: string | null = null;
    srcReady.current = false;
    (async () => {
      audioUrl = await objectUrlFor(item.audio);
      if (cancelled) return;
      if (!audioUrl) {
        // The phone cleared this file. Skip it; if everything's gone, say so.
        missedInARow.current += 1;
        if (missedInARow.current >= count) setCleared(true);
        else setIndex((i) => (i + 1) % count);
        return;
      }
      missedInARow.current = 0;
      const audio = audioRef.current!;
      audio.src = audioUrl;
      srcReady.current = true;
      setProblem(null);
      if (start.current.time) {
        audio.currentTime = start.current.time;
        start.current.time = 0;
      }
      if (playingRef.current) audio.play().catch(onPlayRefused);
      artUrl = item.artwork ? await objectUrlFor(item.artwork) : null;
      if (!cancelled) setArt(artUrl);
    })();
    return () => {
      cancelled = true;
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      if (artUrl) URL.revokeObjectURL(artUrl);
    };
  }, [index, block.channelSlug, block.downloadedAt]);

  // Remember the spot every few seconds and on pause.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    let last = 0;
    const save = () => {
      try {
        localStorage.setItem(
          POSITION_KEY,
          JSON.stringify({ channelSlug: block.channelSlug, downloadedAt: block.downloadedAt, index, time: audio.currentTime })
        );
      } catch {
        // best-effort
      }
    };
    const onTime = () => {
      if (Date.now() - last > 5000) {
        last = Date.now();
        save();
      }
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("pause", save);
    return () => {
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("pause", save);
    };
  }, [block, index]);

  const play = () => {
    const audio = audioRef.current;
    if (!audio) return;
    setProblem(null);
    setPlaying(true);
    // Not loaded yet: it starts as soon as it is (see the loading effect).
    if (srcReady.current) audio.play().catch(onPlayRefused);
  };
  const pause = () => {
    audioRef.current?.pause();
    setPlaying(false);
  };

  // "Play downloads" (Offline page, Listen page, Home card) while this bar
  // is already showing: start playing right here, inside that tap - phones
  // only let audio start from a tap, so this can't wait for a re-render.
  const playRef = useRef(play);
  playRef.current = play;
  useEffect(() => {
    const onPlayDownloads = (e: Event) => {
      const slug = (e as CustomEvent).detail?.channelSlug;
      if (!slug || slug === block.channelSlug) playRef.current();
    };
    window.addEventListener("war:offline-play", onPlayDownloads);
    return () => window.removeEventListener("war:offline-play", onPlayDownloads);
  }, [block.channelSlug]);

  const isSong = item?.item_type === "song";
  const station = block.channelName;
  useMediaSession(
    audioRef,
    item && !cleared
      ? {
          title: item.label ?? station,
          artist: isSong ? item.artist || "Kizzi" : station,
          album: (isSong && item.album_title) || station,
          artworkUrl: art ?? new URL("/icons/icon-512.png", window.location.href).href,
        }
      : null,
    { live: true, onPlay: play, onPause: pause }
  );

  return (
    <div className="now-playing-bar offline-bar">
      <Link to="/offline" className="mp-open" aria-label="Offline listening">
        {art ? <img className="mp-art" src={art} alt="" /> : <img className="mp-art" src="/icons/icon-192.png" alt="" />}
        <span className="mp-text">
          <span className="mp-onair offline-badge">
            <span className="offline-dot" /> {online ? "Downloads" : "Offline"}
            <span className="mp-station">{station}</span>
          </span>
          <span className="mp-title">{cleared ? "Downloads were cleared" : (item?.label ?? station)}</span>
          <span className="mp-programme">
            {cleared
              ? "Your phone removed them. Download again when you're online."
              : (problem ?? `Downloaded ${index + 1} of ${block.items.length}`)}
          </span>
        </span>
      </Link>
      {online && (
        <button type="button" className="btn" onClick={onBackToLive}>
          Back to live
        </button>
      )}
      <button
        className="mp-play-btn"
        onClick={playing ? pause : play}
        disabled={cleared}
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <audio
        ref={audioRef}
        onError={() => {
          const audio = audioRef.current;
          if (!audio?.src || !srcReady.current) return;
          if (switchToStoredAddress()) return;
          setPlaying(false);
          setProblem(`This download wouldn't play (error ${audio.error?.code ?? "?"}).`);
        }}
        onEnded={() => {
          start.current.time = 0;
          if (block.items.length === 1) {
            const audio = audioRef.current!;
            audio.currentTime = 0;
            audio.play().catch(onPlayRefused);
          } else {
            setIndex((i) => (i + 1) % block.items.length);
          }
        }}
      />
    </div>
  );
}
