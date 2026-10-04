import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { mediaUrl } from "../../api/client";
import { useExclusiveAudio, formatClock, livePosition, nextOnEnded, stillFinishing, startPosition } from "../lib/audioUtils";
import { cancelOverlay, unlockAudio, useOverlayJingles } from "../../shared/duckEngine";
import { isBroken, useStallRecovery } from "../lib/useStallRecovery";
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
import { useStationLog } from "../lib/useStationLog";
import { usePauseForRecording } from "../components/onair/recording";
import { OnAirSheet, SayItOnAirButton } from "../components/onair/OnAirSheet";
import { ListenerVoicePill, voiceLines } from "../components/onair/voice";
import { GOOD_ON_AIR_SUB, GoodOnAirPill, GoodOnAirTitle, isGood } from "../components/good/GoodOnAir";
import { fadeIn, useRewind } from "../lib/useRewind";
import { BackToLivePill, StartOverButton } from "../components/PlayerRewind";
import { JustPlayed, ThatWasChip, useJustPlayed } from "../components/JustPlayed";

const HAS_CHANNEL_VIDEO = new Set(["kizzi-radio", "we-are-50s", "we-are-love", "we-are-after-dark", "we-are-instrumental"]);

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
        {isGood(item) && <GoodOnAirPill small />}
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const { cast, castingHere } = useRadioCast({ audioRef, channelSlug, currentItemId, setData, setPlaying });

  // Start over: kept in step with NowPlayingBar (see useRewind and the comments there).
  const rw = useRewind({ audioRef, channelSlug, channelId: data?.channel?.id ?? null, loadedItem, playing, castingHere });
  const lastOnAir = useRef<any>(null);
  if (data?.on_air) lastOnAir.current = data;
  const shown = useMemo(
    () =>
      rw.rewound
        ? { ...(data?.on_air ? data : lastOnAir.current), on_air: true, now_playing: rw.rewound.item, on_air_now: data?.on_air ? data.now_playing : null }
        : data,
    [data, rw.rewound]
  );
  const rejoinFade = useRef(false);
  const liveNowItem = rw.rewound ? (shown?.on_air_now ?? null) : (data?.now_playing ?? null);
  const justPlayed = useJustPlayed(channelSlug, liveNowItem?.id);

  // Play (the button, or the keyboard / lock-screen controls) always joins the
  // station where it is now. The song was loaded at its position when the
  // page last heard from the server; without this, pressing Play minutes
  // later started from that stale point and stayed minutes behind.
  const dataRef = useRef<any>(null);
  dataRef.current = data;
  function playLive() {
    const audio = audioRef.current;
    if (!audio) return;
    // The press is the user gesture that lets the audio engine start.
    void unlockAudio(audio);
    // While replaying (Start over), Play resumes the replay; only "Back to live" returns to the station.
    if (rw.rewoundRef.current) {
      audio.play().catch(() => {});
      setPlaying(true);
      return;
    }
    // A broken element (the connection to the file dropped): Play reopens it at the live point.
    if (isBroken(audio)) {
      setPlaying(true);
      reloadLive();
      return;
    }
    const d = dataRef.current;
    if (d?.now_playing && currentItemId.current === d.now_playing.id) {
      const pos = livePosition(d);
      if (pos === null) {
        // That song has ended since: load and play whatever's on now.
        currentItemId.current = null;
        setPlaying(true);
        void refresh();
        return;
      }
      if (Math.abs(audio.currentTime - pos) > 2) audio.currentTime = pos;
    }
    audio.play().catch(() => {});
    setPlaying(true);
  }

  // Starting a podcast/album elsewhere pauses this stream (and its button).
  useChannelLog(audioRef, shown, playing);
  useExclusiveAudio("listen", audioRef, !!(data && data.on_air), () => setPlaying(false));
  // Keyed to the item actually in the <audio> element (it trails now_playing
  // while a song is let finish).
  useOverlayJingles(audioRef, rw.rewound ? { ...loadedItem, overlays: undefined } : loadedItem, !!(shown && shown.on_air));
  useMediaSession(audioRef, radioSessionInfo(shown), {
    live: true,
    onPrevious: rw.canStartOver ? () => rw.startOver() : null,
    onPlay: () => playLive(),
    onPause: () => {
      audioRef.current?.pause();
      setPlaying(false);
    },
  });

  // "Say it on air": quiet while the listener records or plays their take back.
  usePauseForRecording({
    isPlaying: () => playingRef.current && !castingHere,
    pause: () => {
      audioRef.current?.pause();
      setPlaying(false);
    },
    resume: () => playLive(),
  });

  useEffect(() => {
    rw.clear();
    setData(null);
    currentItemId.current = null;
    heldBack.current = false;
    setPlaying(false);
  }, [channelSlug]);
  // Polled every 15 s, plus the log's version every 10 s while playing, a 2-hour buffer and scheduled fades.
  // A song ended: start the next one right now, inside the "ended" event,
  // from what this player already knows (nextOnEnded) - a locked phone
  // suspends the page in any silent gap, so it can't wait for the server.
  // The refresh after it confirms (or corrects) the choice.
  const justFinished = useRef<string | null>(null);
  const assumed = useRef<string | null>(null);
  function playNextNow() {
    const audio = audioRef.current;
    const next = nextOnEnded(dataRef.current, currentItemId.current);
    justFinished.current = currentItemId.current;
    if (!audio || !next) return;
    currentItemId.current = next.item.id;
    assumed.current = next.item.id;
    heldBack.current = false;
    setLoadedItem(next.item);
    audio.src = mediaUrl(next.item.audio_url);
    audio.currentTime = next.from;
    if (playingRef.current) audio.play().catch(() => {});
  }

  const { refresh } = useStationLog({
    channelSlug,
    pollMs: 15_000,
    playing,
    audioRef,
    loadedItem,
    setData,
    setUnreachable,
    earlyEndFade: !rw.rewound,
  });

  // Stuck audio (lib/useStallRecovery.ts): reopen what's on air at the live
  // point - what switching channel and back used to be the only cure for.
  function reloadLive() {
    const audio = audioRef.current;
    if (!audio) return;
    cancelOverlay(audio);
    audio.volume = 1;
    currentItemId.current = null;
    heldBack.current = false;
    justFinished.current = null;
    assumed.current = null;
    void refresh();
  }
  useStallRecovery(audioRef, {
    active: playing && !castingHere && !rw.rewound,
    recover: reloadLive,
    channelId: data?.channel?.id ?? null,
    label: loadedItem?.label ?? null,
  });


  // Rejoining after a replay: the same rule as after letting a song finish.
  function backToLive() {
    const audio = audioRef.current;
    const was = rw.rewoundRef.current;
    rw.clear();
    if (!audio) return;
    const d = dataRef.current;
    if (was && d?.now_playing?.id === was.airingId) {
      const pos = livePosition(d);
      if (pos !== null) {
        audio.currentTime = pos;
        fadeIn(audio, 1000);
        audio.play().catch(() => {});
        setPlaying(true);
        return;
      }
    }
    currentItemId.current = null;
    heldBack.current = true;
    rejoinFade.current = true;
    setPlaying(true);
    void refresh();
  }

  // Only touch the <audio> element when the on-air item actually changes -
  // a poll landing mid-song shouldn't restart playback - nor while the last
  // song is still finishing (see stillFinishing; its "ended" brings this back
  // round).
  useEffect(() => {
    const item = data?.now_playing;
    const audio = audioRef.current;
    if (!item || !audio) return;
    if (rw.rewoundRef.current) return;
    if (currentItemId.current === item.id) {
      assumed.current = null;
      // Loaded elsewhere (useRadioCast, when a cast ends).
      setLoadedItem((l: any) => (l?.id === item.id ? l : item));
      return;
    }
    // The song that has just finished, still on air by the server's clock: don't load it again.
    if (item.id === justFinished.current) return;
    // The station has something else on than the item playNextNow assumed: switch straight to it.
    const wrongGuess = assumed.current !== null && assumed.current === currentItemId.current;
    assumed.current = null;
    if (!wrongGuess && stillFinishing(audio, currentItemId.current !== null)) {
      heldBack.current = true;
      return;
    }
    const followsOn = currentItemId.current !== null;
    currentItemId.current = item.id;
    const waited = heldBack.current;
    heldBack.current = false;

    if (!item.audio_url) return;
    setLoadedItem(item);
    const position = data.position_seconds ?? 0;
    audio.src = mediaUrl(item.audio_url);
    const from = startPosition(item, position, waited, followsOn);
    audio.currentTime = from;
    if (rejoinFade.current && from > 0) fadeIn(audio, 1000);
    rejoinFade.current = false;
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
      playLive();
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

  if (!shown) return <p>Tuning in...</p>;
  if (!shown.on_air) return <p>{shown.channel?.name ?? "This channel"} isn't broadcasting anything published yet.</p>;

  const accent = channelAccent(channelSlug);
  // While this channel is on the Chromecast, the buttons show and drive the device.
  const shownPlaying = castingHere ? !cast.paused : playing;
  const now = shown.now_playing;
  const isSong = now?.item_type === "song";
  const voice = now?.voice ? voiceLines(now.voice) : null;
  const artUrl: string | null = now?.artwork_url ? mediaUrl(now.artwork_url) : null;
  const category = shown.channel?.description || shown.programme?.title || null;
  const queue: any[] = shown.coming_up ?? (shown.up_next ? [shown.up_next] : []);

  return (
    <div className={`lp-page${shownPlaying ? " is-playing" : ""}`}>
      <div className="lp-glow" aria-hidden="true">
        <div className="lp-glow-warm" />
        <div className="lp-glow-accent" style={{ background: `radial-gradient(circle, ${accent}1f 0%, transparent 70%)` }} />
      </div>

      <div className="lp-top">
        <span className="on-air-badge lp-eyebrow">
          <span className="on-air-dot" /> On Air &middot; {shown.channel.name}
          {castingHere && <> &middot; Casting{cast.deviceName ? ` to ${cast.deviceName}` : ""}</>}
        </span>
        <div className="lp-top-actions">
          <CastButtons audioRef={audioRef} channelSlug={channelSlug} ready className="lp-icon-btn" />
          <ShareButton
            path={`/channel/${channelSlug}`}
            title={`${shown.channel.name} - We Are Radio`}
            text={now?.label ? `Listening to ${now.label} on ${shown.channel.name}` : `Live on ${shown.channel.name}`}
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
          <h1 className="lp-channel-name">{shown.channel.name}</h1>

          <div className="lp-nowplaying-row">
            <span className="lp-nowplaying-label" style={{ color: accent }}>
              {voice ? <ListenerVoicePill /> : isGood(now) ? <GoodOnAirPill /> : isSong ? "Now Playing" : "On Air Now"}
            </span>
            <span className="lp-eq" aria-hidden="true">
              <span style={{ background: accent }} />
              <span style={{ background: accent }} />
              <span style={{ background: accent }} />
            </span>
          </div>
          <div className="lp-track-title">{voice ? voice.title : isGood(now) ? <GoodOnAirTitle item={now} /> : (now?.label ?? "We Are Radio")}</div>
          {voice?.sub && <div className="lv-sub lp-voice-sub">{voice.sub}</div>}
          {!voice && isGood(now) && <div className="afg-onair-sub lp-voice-sub">{GOOD_ON_AIR_SUB}</div>}

          <FlagshipPlayer
            audioRef={audioRef}
            accent={accent}
            seed={`${now?.id ?? ""}${now?.label ?? ""}`}
            playing={shownPlaying}
            onTogglePlay={togglePlay}
          />
          {(rw.canStartOver || rw.rewound) && (
            <div className="so-row lp-rewind-row">
              {rw.canStartOver && <StartOverButton onClick={rw.startOver} />}
              {rw.rewound && <BackToLivePill behindSeconds={rw.behindSeconds} onClick={backToLive} />}
            </div>
          )}
          <div className="lp-onair-row">
            <SayItOnAirButton onClick={() => setSheetOpen(true)} />
          </div>
        </div>
      </div>

      <StudioConsole accent={accent} seed={channelSlug} />

      {queue.length > 0 && (
        <div className="lp-queue">
          {rw.rewound && liveNowItem && <div className="lp-queue-label np-onair-now">On air now: {liveNowItem.label}</div>}
          <div className="lp-queue-label">Up Next on {shown.channel.name}</div>
          <div className="lp-queue-row">
            {queue.slice(0, 4).map((item, i) => (
              <QueueCard key={item.id ?? i} item={item} accent={accent} next={i === 0} />
            ))}
          </div>
        </div>
      )}

      <div className="lp-just-played">
        <ThatWasChip items={justPlayed} endedAt={liveNowItem?.starts_at ?? null} />
        <JustPlayed items={justPlayed} />
      </div>

      <p className="lp-offline-link">
        <Link to={`/offline?channel=${channelSlug}`}>Going somewhere without signal? Download {shown.channel.name} for offline listening</Link>
      </p>

      <audio
        ref={audioRef}
        onEnded={() => {
          if (rw.rewoundRef.current) return backToLive();
          playNextNow();
          void refresh();
        }}
      />
      {sheetOpen && (
        <OnAirSheet
          channelSlug={channelSlug}
          nowPlaying={now ? { label: now.label ?? null, track_id: now.track_id ?? null, item_type: now.item_type ?? null } : null}
          onClose={() => setSheetOpen(false)}
        />
      )}
    </div>
  );
}
