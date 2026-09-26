import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError, publicApi, mediaUrl } from "../../api/client";
import { useExclusiveAudio, formatClock, stillFinishing, CATCH_UP_SECONDS } from "../lib/audioUtils";
import { unlockAudio, useOverlayJingles } from "../../shared/duckEngine";
import { useChannelLog } from "../../shared/analytics";
import { ShareButton } from "../components/ShareButton";
import { FlagshipPlayer } from "../components/FlagshipPlayer";
import { StudioConsole } from "../components/StudioConsole";
import { channelAccent } from "../lib/channelAccent";
import { radioSessionInfo, useMediaSession } from "../../shared/mediaSession";
import { toggleCastPlayback } from "../../shared/cast";
import { useRadioCast } from "../lib/useRadioCast";
import { CastButtons } from "../components/CastButtons";
import { playDownloads, useOfflineBlocks, useOnline } from "../../shared/offline";

const HAS_CHANNEL_VIDEO = new Set(["kizzi-radio", "we-are-50s", "we-are-love", "we-are-after-dark"]);

function QueueCard({ item, accent, next }: { item: any; accent: string; next: boolean }) {
  return (
    <div className={`lp-queue-card${next ? " is-next" : ""}`} style={next ? { background: `${accent}14`, borderColor: `${accent}4d` } : undefined}>
      {item.artwork_url ? (
        <img className="lp-queue-art" src={mediaUrl(item.artwork_url)} alt="" />
      ) : (
        <div className="lp-queue-art" style={{ background: `linear-gradient(135deg, ${accent}55, ${accent}11 70%)` }} />
      )}
      <div className="lp-queue-info">
        {next && (
          <div className="lp-queue-next" style={{ color: accent }}>
            Next
          </div>
        )}
        <div className="lp-queue-title">{item.label ?? "We Are Radio"}</div>
        {!next && item.duration_seconds ? <div className="lp-queue-dur">{formatClock(item.duration_seconds)}</div> : null}
      </div>
    </div>
  );
}

export function Listen() {
  // /channel/:slug is the shareable form; /listen?channel= is the one used
  // throughout the rest of the app (nav links, Vibe Shift, ...) - both land here.
  const { slug: pathSlug } = useParams();
  const [searchParams] = useSearchParams();
  const channelSlug = pathSlug ?? searchParams.get("channel") ?? "kizzi-radio";
  const [data, setData] = useState<any>(null);
  const [playing, setPlaying] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const online = useOnline();
  const blocks = useOfflineBlocks();
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentItemId = useRef<string | null>(null);
  // The station moved on while the previous song was still finishing.
  const heldBack = useRef(false);
  const [loadedItem, setLoadedItem] = useState<any>(null);

  const { cast, castingHere } = useRadioCast({ audioRef, channelSlug, currentItemId, setData, setPlaying });

  // Starting a podcast/album elsewhere pauses this stream (and its button).
  useChannelLog(audioRef, data, playing);
  useExclusiveAudio("listen", audioRef, !!(data && data.on_air), () => setPlaying(false));
  // Keyed to the item actually in the <audio> element (it trails now_playing
  // while a song is let finish).
  useOverlayJingles(audioRef, loadedItem, !!(data && data.on_air));
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

  useEffect(() => {
    setData(null);
    currentItemId.current = null;
    heldBack.current = false;
    setPlaying(false);
    const poll = () =>
      publicApi
        .nowPlaying(channelSlug)
        .then((d) => {
          setData(d);
          setUnreachable(false);
        })
        .catch((err) => setUnreachable(!(err instanceof ApiError)));
    poll();
    const id = setInterval(poll, 15_000);
    return () => clearInterval(id);
  }, [channelSlug]);

  // Only touch the <audio> element when the on-air item actually changes -
  // a poll landing mid-song shouldn't restart playback - nor while the last
  // song is still finishing (see stillFinishing; its "ended" brings this back
  // round).
  useEffect(() => {
    const item = data?.now_playing;
    const audio = audioRef.current;
    if (!item || !audio) return;
    if (currentItemId.current === item.id) {
      // Loaded elsewhere (useRadioCast, when a cast ends).
      setLoadedItem((l: any) => (l?.id === item.id ? l : item));
      return;
    }
    if (stillFinishing(audio, currentItemId.current !== null)) {
      heldBack.current = true;
      return;
    }
    currentItemId.current = item.id;
    const waited = heldBack.current;
    heldBack.current = false;

    if (!item.audio_url) return;
    setLoadedItem(item);
    const position = data.position_seconds ?? 0;
    audio.src = mediaUrl(item.audio_url);
    audio.currentTime = waited && position <= CATCH_UP_SECONDS ? 0 : position;
    if (playing) audio.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const togglePlay = () => {
    if (castingHere) {
      toggleCastPlayback();
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      void unlockAudio(audio);
      audio.play().catch(() => {});
      setPlaying(true);
    }
  };

  // No connection: live radio can't play, so point at the downloads instead
  // of sitting on "Tuning in..." (or a play button that can't work).
  if (!online || (unreachable && !data)) {
    return (
      <div className="lp-offline">
        <h1>You're offline</h1>
        {blocks?.length ? (
          <>
            <p>Live radio needs a connection, but your downloads play without one.</p>
            <button type="button" className="btn primary lp-offline-play" onClick={() => playDownloads(blocks.some((b) => b.channelSlug === channelSlug) ? channelSlug : null)}>
              ▶ Play downloads
            </button>
          </>
        ) : (
          <>
            <p>Live radio needs a connection. Next time you're connected, download some radio and it will play anywhere.</p>
            <Link to="/offline" className="btn">
              Offline listening
            </Link>
          </>
        )}
      </div>
    );
  }

  if (!data) return <p>Tuning in...</p>;
  if (!data.on_air) return <p>{data.channel?.name ?? "This channel"} isn't broadcasting anything published yet.</p>;

  const accent = channelAccent(channelSlug);
  // While this channel is on the Chromecast, the buttons show and drive the device.
  const shownPlaying = castingHere ? !cast.paused : playing;
  const now = data.now_playing;
  const isSong = now?.item_type === "song";
  const artUrl: string | null = now?.artwork_url ? mediaUrl(now.artwork_url) : null;
  const category = data.channel?.description || data.programme?.title || null;
  const queue: any[] = data.coming_up ?? (data.up_next ? [data.up_next] : []);

  return (
    <div className={`lp-page${shownPlaying ? " is-playing" : ""}`}>
      <div className="lp-glow" aria-hidden="true">
        <div className="lp-glow-warm" />
        <div className="lp-glow-accent" style={{ background: `radial-gradient(circle, ${accent}1f 0%, transparent 70%)` }} />
      </div>

      <div className="lp-top">
        <span className="on-air-badge lp-eyebrow">
          <span className="on-air-dot" /> On Air &middot; {data.channel.name}
          {castingHere && <> &middot; Casting{cast.deviceName ? ` to ${cast.deviceName}` : ""}</>}
        </span>
        <div className="lp-top-actions">
          <CastButtons audioRef={audioRef} channelSlug={channelSlug} ready className="lp-icon-btn" />
          <ShareButton
            path={`/channel/${channelSlug}`}
            title={`${data.channel.name} - We Are Radio`}
            text={now?.label ? `Listening to ${now.label} on ${data.channel.name}` : `Live on ${data.channel.name}`}
            className="lp-icon-btn"
            iconOnly
          />
        </div>
      </div>

      <div className="lp-hero">
        <div className="lp-art-col">
          <div className="lp-rings" aria-hidden="true">
            <span style={{ animationDelay: "0s" }} />
            <span style={{ animationDelay: "1.5s" }} />
            <span style={{ animationDelay: "3s" }} />
          </div>
          <div className="lp-art">
            {artUrl ? (
              <img key={artUrl} src={artUrl} alt="" />
            ) : HAS_CHANNEL_VIDEO.has(channelSlug) ? (
              <video
                src={`/channels/channel-${channelSlug}.mp4`}
                poster={`/channels/channel-${channelSlug}.jpg`}
                autoPlay
                muted
                loop
                playsInline
                aria-hidden="true"
              />
            ) : (
              <div className="lp-art-placeholder" />
            )}
            <svg className="lp-art-spin" width="90%" height="90%" viewBox="0 0 410 410" aria-hidden="true">
              <circle cx="205" cy="205" r="150" fill="none" stroke="#FFFFFF" strokeWidth="1" strokeDasharray="2 11" />
              <circle cx="205" cy="205" r="112" fill="none" stroke="#FFFFFF" strokeWidth="1" strokeDasharray="2 9" />
            </svg>
            <div className="lp-art-shine" aria-hidden="true" />
            <button className="lp-art-play" style={{ background: accent, boxShadow: `0 12px 36px ${accent}8c` }} onClick={togglePlay} aria-label={shownPlaying ? "Pause" : "Play"}>
              {shownPlaying ? (
                <span className="pl-pause-icon">
                  <span />
                  <span />
                </span>
              ) : (
                <span className="play-triangle" />
              )}
            </button>
          </div>
        </div>

        <div className="lp-info">
          {category && <div className="lp-category" style={{ color: `${accent}` }}>{category}</div>}
          <h1 className="lp-channel-name">{data.channel.name}</h1>

          <div className="lp-nowplaying-row">
            <span className="lp-nowplaying-label" style={{ color: accent }}>
              {isSong ? "Now Playing" : "On Air Now"}
            </span>
            <span className="lp-eq" aria-hidden="true">
              <span style={{ background: accent }} />
              <span style={{ background: accent }} />
              <span style={{ background: accent }} />
            </span>
          </div>
          <div className="lp-track-title">{now?.label ?? "We Are Radio"}</div>

          <FlagshipPlayer
            audioRef={audioRef}
            accent={accent}
            seed={`${now?.id ?? ""}${now?.label ?? ""}`}
            playing={shownPlaying}
            onTogglePlay={togglePlay}
          />
        </div>
      </div>

      <StudioConsole accent={accent} seed={channelSlug} />

      {queue.length > 0 && (
        <div className="lp-queue">
          <div className="lp-queue-label">Up Next on {data.channel.name}</div>
          <div className="lp-queue-row">
            {queue.slice(0, 4).map((item, i) => (
              <QueueCard key={item.id ?? i} item={item} accent={accent} next={i === 0} />
            ))}
          </div>
        </div>
      )}

      <p className="lp-offline-link">
        <Link to={`/offline?channel=${channelSlug}`}>Going somewhere without signal? Download {data.channel.name} for offline listening</Link>
      </p>

      <audio ref={audioRef} onEnded={() => publicApi.nowPlaying(channelSlug).then(setData).catch(() => {})} />
    </div>
  );
}
