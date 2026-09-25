import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { publicApi, mediaUrl } from "../../api/client";
import { useActiveChannel } from "../context/ActiveChannelContext";
import { useExclusiveAudio } from "../lib/audioUtils";
import { unlockAudio, useOverlayJingles } from "../../shared/duckEngine";
import { NowPlayingExpanded } from "./NowPlayingExpanded";
import { useChannelLog } from "../../shared/analytics";
import { ShareButton } from "./ShareButton";
import { radioSessionInfo, useMediaSession } from "../../shared/mediaSession";

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
  const { channelSlug, band, isOverridden, liveSlugs, setOverride, clearOverride } = useActiveChannel();
  const [data, setData] = useState<any>(null);
  const [playing, setPlaying] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [showVibeShift, setShowVibeShift] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();
  const closeExpanded = useCallback(() => setExpanded(false), []);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentItemId = useRef<string | null>(null);
  const prevChannelSlug = useRef(channelSlug);
  const playingRef = useRef(playing);
  playingRef.current = playing;
  // Set each render (below) to this bar's own play/pause handlers; the
  // "war:player" bridge calls through it so other buttons take the same path.
  const commandRef = useRef<((action: "toggle" | "play" | "pause") => void) | null>(null);

  // Following a link out of the expanded player closes it.
  useEffect(() => {
    setExpanded(false);
  }, [location.pathname]);

  // Tune-ins and song plays on this channel, for the Studio's Analytics.
  useChannelLog(audioRef, data, playing);

  // If a podcast/album page starts playing, this player steps aside (and its
  // button must show "play" again rather than a stale "pause").
  useExclusiveAudio("mini-player", audioRef, !!(data && data.on_air), () => setPlaying(false));

  // Jingles that play over a song (music ducked underneath) rather than
  // between songs; the rotation says when, this carries it out.
  useOverlayJingles(audioRef, data?.now_playing, !!(data && data.on_air));

  // Lock screen / notification: the song on air, play and pause. These act on
  // the element itself rather than toggling, so "play" still works after the
  // phone paused the audio on its own (a call, headphones unplugged).
  useMediaSession(audioRef, radioSessionInfo(data), {
    live: true,
    onPlay: () => {
      const audio = audioRef.current;
      if (!audio) return;
      void unlockAudio(audio);
      audio.play().catch(() => {});
      setPlaying(true);
    },
    onPause: () => {
      audioRef.current?.pause();
      setPlaying(false);
    },
  });

  // The landing page's "Vibe Shift" card opens this same control rather
  // than duplicating it.
  useEffect(() => {
    const open = () => setShowVibeShift(true);
    window.addEventListener("open-vibe-shift", open);
    return () => window.removeEventListener("open-vibe-shift", open);
  }, []);

  // Station bridge (see contest/enter/useStationBridge.ts): other parts of the
  // page - the Top 3 entry page's "Listen now" - drive this one <audio>
  // element with "war:player" commands, and hear its state back through
  // "war:player-state", so every play button on screen always agrees.
  // dispatchEvent is synchronous, so play() still runs inside the visitor's
  // click, which iOS requires before it will start audio.
  useEffect(() => {
    const onCommand = (e: Event) => {
      const action = (e as CustomEvent).detail?.action;
      if (action === "toggle" || action === "play" || action === "pause") commandRef.current?.(action);
    };
    window.addEventListener("war:player", onCommand);
    return () => window.removeEventListener("war:player", onCommand);
  }, []);

  useEffect(() => {
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("war:player-state", {
          detail: {
            onAir: !!(data && data.on_air),
            playing,
            title: data?.now_playing?.label ?? null,
            channelName: data?.channel?.name ?? null,
            artworkUrl: data?.now_playing?.artwork_url ? mediaUrl(data.now_playing.artwork_url) : null,
          },
        })
      );
    announce();
    window.addEventListener("war:player-state-request", announce);
    return () => window.removeEventListener("war:player-state-request", announce);
  }, [data, playing]);

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

  // Refresh right as the current item is due to finish, so titles, artwork and
  // the queue change with the broadcast rather than up to 30 s afterwards.
  useEffect(() => {
    const item = data?.now_playing;
    if (!item?.duration_seconds) return;
    const remaining = item.duration_seconds - (data.position_seconds ?? 0);
    const id = setTimeout(() => {
      publicApi
        .nowPlaying(channelSlug)
        .then(setData)
        .catch(() => {});
    }, Math.max(1500, remaining * 1000 + 500));
    return () => clearTimeout(id);
  }, [data, channelSlug]);

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

  commandRef.current = null; // replaced below while there's a station on air to play
  if (!data || !data.on_air) return null;

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      // The play press is the user gesture that lets the audio engine start.
      void unlockAudio(audio);
      audio.play().catch(() => {});
      setPlaying(true);
    }
  };

  commandRef.current = (action) => {
    if (action === "toggle" || (action === "play") !== playing) togglePlay();
  };

  const station = data.channel?.name ?? "We Are Radio";
  const upNextLabel = data.up_next?.label;

  return (
    <>
      <div className="now-playing-bar">
        <button className="mp-open" onClick={() => setExpanded(true)} aria-label="Open Now Playing">
          {data.now_playing?.artwork_url ? (
            <img className="mp-art" src={mediaUrl(data.now_playing.artwork_url)} alt="" />
          ) : (
            <div className="mp-art" />
          )}
          <span className="mp-text">
            <span className="mp-onair">
              <span className="mp-onair-dot" /> {switching ? "Switching..." : "On Air"}
              <span className="mp-station">{station}</span>
            </span>
            <span className="mp-title">{data.now_playing?.label ?? "We Are Radio"}</span>
            <span className="mp-programme">{upNextLabel ? `Next: ${upNextLabel}` : data.programme?.title}</span>
          </span>
          <svg className="mp-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 15l6-6 6 6" />
          </svg>
        </button>

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
              {VIBE_SHIFT_CHANNELS.filter((c) => liveSlugs === null || liveSlugs.includes(c.slug)).map((c) => (
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

        <ShareButton
          path={`/channel/${channelSlug}`}
          title={`${station} - We Are Radio`}
          text={data.now_playing?.label ? `Listening to ${data.now_playing.label} on ${station}` : `Live on ${station}`}
          className="btn"
          iconOnly
        />
        <button className="mp-play-btn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <audio
          ref={audioRef}
          onEnded={() => publicApi.nowPlaying(channelSlug).then(setData).catch(() => {})}
        />
      </div>

      {/* A sibling of the bar, not a child: the bar's blur would otherwise pin it to the bar's box. */}
      {expanded && (
        <NowPlayingExpanded
          data={data}
          audioRef={audioRef}
          playing={playing}
          switching={switching}
          onTogglePlay={togglePlay}
          onClose={closeExpanded}
          channelSlug={channelSlug}
          band={band}
          isOverridden={isOverridden}
          onVibe={(slug) => (slug ? setOverride(slug) : clearOverride())}
        />
      )}
    </>
  );
}
