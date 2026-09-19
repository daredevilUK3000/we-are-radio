import { useEffect, useRef, useState } from "react";
import { publicApi, mediaUrl } from "../../api/client";
import { useActiveChannel } from "../context/ActiveChannelContext";
import { useExclusiveAudio } from "../lib/audioUtils";

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

// Plays one clip to completion (or until it errors, or maxMs passes as a
// safety net) before resolving - used to play a sweeper jingle fully
// before handing the same <audio> element back to live content.
function playClip(audio: HTMLAudioElement, url: string, maxMs = 20_000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      audio.removeEventListener("ended", finish);
      audio.removeEventListener("error", finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, maxMs);
    audio.addEventListener("ended", finish);
    audio.addEventListener("error", finish);
    audio.src = url;
    audio.play().catch(finish);
  });
}

const VIBE_SHIFT_CHANNELS: { slug: string; label: string }[] = [
  { slug: "kizzi-radio", label: "Kizzi Radio" },
  { slug: "we-are-love", label: "We Are Love" },
  { slug: "we-are-50s", label: "We Are 50s" },
  { slug: "we-are-after-dark", label: "We Are After Dark" },
];

export function NowPlayingBar() {
  const { channelSlug, band, isOverridden, setOverride, clearOverride } = useActiveChannel();
  const [data, setData] = useState<any>(null);
  const [playing, setPlaying] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [showVibeShift, setShowVibeShift] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentItemId = useRef<string | null>(null);
  const prevChannelSlug = useRef(channelSlug);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  // If a podcast/album page starts playing, this player steps aside (and its
  // button must show "play" again rather than a stale "pause").
  useExclusiveAudio("mini-player", audioRef, !!(data && data.on_air), () => setPlaying(false));

  // The landing page's "Vibe Shift" card opens this same control rather
  // than duplicating it.
  useEffect(() => {
    const open = () => setShowVibeShift(true);
    window.addEventListener("open-vibe-shift", open);
    return () => window.removeEventListener("open-vibe-shift", open);
  }, []);

  // Poll now-playing for whichever channel is currently active (time-of-day
  // default, or a Vibe Shift override).
  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      publicApi
        .nowPlaying(channelSlug)
        .then((d) => !cancelled && setData(d))
        .catch(() => !cancelled && setData(null));
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [channelSlug]);

  // Phase 3: when the active channel changes - a time-band boundary
  // passing, or a Vibe Shift pick - sweep between them with a jingle if
  // something's actually playing. If playback is paused, there's no
  // "broadcast" to interrupt, so just retarget silently for next time Play
  // is pressed.
  useEffect(() => {
    if (prevChannelSlug.current === channelSlug) return;
    prevChannelSlug.current = channelSlug;
    currentItemId.current = null;
    const audio = audioRef.current;
    if (!audio || !playingRef.current) return;

    let cancelled = false;
    setSwitching(true);
    publicApi
      .sweeper(band)
      .then(({ asset }) => {
        if (cancelled || !audio || !asset?.audio_url) return;
        return playClip(audio, mediaUrl(asset.audio_url));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setSwitching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelSlug]);

  // Only touch the <audio> element when the on-air item actually changes -
  // a poll landing mid-song shouldn't restart playback - and never while a
  // sweeper transition is mid-play.
  useEffect(() => {
    const item = data?.now_playing;
    const audio = audioRef.current;
    if (!item || !audio || switching) return;
    if (currentItemId.current === item.id) return;
    currentItemId.current = item.id;

    if (!item.audio_url) return;
    audio.src = mediaUrl(item.audio_url);
    audio.currentTime = data.position_seconds ?? 0;
    if (playing) audio.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, switching]);

  if (!data || !data.on_air) return null;

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().catch(() => {});
      setPlaying(true);
    }
  };

  return (
    <div className="now-playing-bar">
      {data.now_playing?.artwork_url ? (
        <img className="mp-art" src={mediaUrl(data.now_playing.artwork_url)} alt="" />
      ) : (
        <div className="mp-art" />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="mp-onair">
          <span className="mp-onair-dot" /> {switching ? "Switching..." : "On Air"}
        </span>
        <div className="mp-title">{data.now_playing?.label ?? "We Are Radio"}</div>
        <div className="mp-programme">
          {data.up_next ? `Up next: ${data.up_next.label}` : data.programme?.title}
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <button className="btn" onClick={() => setShowVibeShift((s) => !s)}>
          Vibe Shift
        </button>
        {showVibeShift && (
          <div className="vibe-shift-popover">
            <button
              className={`chip${!isOverridden ? " selected" : ""}`}
              onClick={() => {
                clearOverride();
                setShowVibeShift(false);
              }}
            >
              Auto &middot; {band}
            </button>
            {VIBE_SHIFT_CHANNELS.map((c) => (
              <button
                key={c.slug}
                className={`chip${isOverridden && channelSlug === c.slug ? " selected" : ""}`}
                onClick={() => {
                  setOverride(c.slug);
                  setShowVibeShift(false);
                }}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <button className="mp-play-btn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <audio
        ref={audioRef}
        onEnded={() => publicApi.nowPlaying(channelSlug).then(setData).catch(() => {})}
      />
    </div>
  );
}
