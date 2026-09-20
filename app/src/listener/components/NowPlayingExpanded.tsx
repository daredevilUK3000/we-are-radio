import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { mediaUrl } from "../../api/client";
import { FavouriteButton } from "./FavouriteButton";
import { formatClock } from "../lib/audioUtils";

// The Vibe Shift choices, as atmospheres rather than pages. Today they map to
// the four live channels; new moods (Happy, Energy, Talk...) slot in here as
// their channels launch.
export const VIBES: { slug: string; label: string; emoji: string }[] = [
  { slug: "we-are-love", label: "Love", emoji: "❤️" },
  { slug: "we-are-after-dark", label: "After Dark", emoji: "🌙" },
  { slug: "we-are-50s", label: "50s", emoji: "🕺" },
  { slug: "kizzi-radio", label: "Kizzi Radio", emoji: "🎙" },
];

const HAS_CHANNEL_VIDEO = new Set(["kizzi-radio", "we-are-50s", "we-are-love", "we-are-after-dark"]);
const BAR_COUNT = 56;

// A tiny deterministic hash, so each song gets its own waveform "shape".
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The red waveform from the hero, brought into the player: it runs while the
 * station plays and settles when it's paused. Shaped per song. (It is
 * animation, not a live analysis of the audio - tapping the audio signal
 * risks silencing playback on some phones, which isn't worth it for a graphic.)
 */
function Waveform({ playing, seed }: { playing: boolean; seed: string }) {
  const bars = useMemo(() => {
    let state = hash(seed) || 1;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    return Array.from({ length: BAR_COUNT }, (_, i) => {
      // A gentle envelope (taller in the middle) with per-bar variation.
      const envelope = 0.45 + 0.55 * Math.sin((Math.PI * (i + 0.5)) / BAR_COUNT);
      return {
        height: Math.round((0.35 + next() * 0.65) * envelope * 100),
        duration: 0.9 + next() * 1.1,
        delay: -next() * 2,
      };
    });
  }, [seed]);

  return (
    <div className={`np-wave${playing ? "" : " is-still"}`} aria-hidden="true">
      {bars.map((bar, i) => (
        <span
          key={i}
          style={{ height: `${bar.height}%`, animationDuration: `${bar.duration}s`, animationDelay: `${bar.delay}s` }}
        />
      ))}
    </div>
  );
}

function QueueRow({ label, item }: { label: string; item: any }) {
  return (
    <li className="np-queue-row">
      <span className="np-queue-label">{label}</span>
      <span className="np-queue-title">{item.label ?? "We Are Radio"}</span>
      {item.album_title && <span className="np-queue-sub">{item.album_title}</span>}
    </li>
  );
}

export function NowPlayingExpanded({
  data,
  audioRef,
  playing,
  switching,
  onTogglePlay,
  onClose,
  channelSlug,
  band,
  isOverridden,
  onVibe,
}: {
  data: any;
  audioRef: RefObject<HTMLAudioElement>;
  playing: boolean;
  switching: boolean;
  onTogglePlay: () => void;
  onClose: () => void;
  channelSlug: string;
  band: string;
  isOverridden: boolean;
  onVibe: (slug: string | null) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [elapsed, setElapsed] = useState<number>(data?.position_seconds ?? 0);
  const [notice, setNotice] = useState<string | null>(null);

  const now = data.now_playing;
  const comingUp: any[] = data.coming_up ?? (data.up_next ? [data.up_next] : []);
  const isSong = now?.item_type === "song";
  const artUrl: string | null = now?.artwork_url ? mediaUrl(now.artwork_url) : null;
  const station = data.channel?.name ?? "We Are Radio";
  const programmeTitle: string | null = data.programme?.id ? data.programme.title : null;
  const meta = [now?.artist, now?.album_title, programmeTitle].filter(Boolean).join("  ·  ");
  const duration: number = now?.duration_seconds ?? 0;

  // Focus, Escape to close, and no scrolling of the page behind.
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previousFocus?.focus?.();
    };
  }, [onClose]);

  // Elapsed time for the current item: from the audio itself while it plays.
  useEffect(() => {
    const audio = audioRef.current;
    setElapsed(audio && audio.currentTime > 0 ? audio.currentTime : (data?.position_seconds ?? 0));
    if (!audio) return;
    const onTime = () => setElapsed(audio.currentTime);
    audio.addEventListener("timeupdate", onTime);
    return () => audio.removeEventListener("timeupdate", onTime);
  }, [audioRef, now?.id, data?.position_seconds]);

  const share = async () => {
    const url = `${window.location.origin}/listen?channel=${channelSlug}`;
    const text = `Listening to ${station} on We Are Radio${isSong ? ` - ${now.label}` : ""}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "We Are Radio", text, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setNotice("Link copied");
    } catch {
      // cancelling the share sheet lands here too - nothing to report
    }
    window.setTimeout(() => setNotice(null), 2500);
  };

  const progress = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;

  return (
    <div className="np-overlay" role="dialog" aria-modal="true" aria-label="Now playing">
      {/* Backdrop: the artwork, heavily blurred and darkened - or the channel's own film when there is none. */}
      <div className="np-backdrop" aria-hidden="true">
        {artUrl ? (
          <div key={artUrl} className="np-backdrop-art" style={{ backgroundImage: `url("${artUrl}")` }} />
        ) : HAS_CHANNEL_VIDEO.has(channelSlug) ? (
          <div className="np-backdrop-art" style={{ backgroundImage: `url("/channels/channel-${channelSlug}.jpg")` }} />
        ) : null}
        <div className="np-backdrop-shade" />
      </div>

      <div className="np-inner">
        <header className="np-top">
          <button ref={closeRef} className="np-close" onClick={onClose} aria-label="Close Now Playing">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <span className="np-live">
            <span className="np-live-dot" /> {switching ? "Switching" : "Live"}
          </span>
          <span className="np-top-spacer" />
        </header>

        <div className="np-main">
          <div className="np-art-col">
            <div className="np-art">
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
                <div className="np-art-fallback" />
              )}
            </div>
          </div>

          <div className="np-info-col">
            <div className="np-block">
              <div className="np-eyebrow">Station</div>
              <h2 className="np-station">
                {data.channel?.emoji ? <span aria-hidden="true">{data.channel.emoji} </span> : null}
                {station}
              </h2>
            </div>

            <div className="np-block np-block-current">
              <div className="np-eyebrow">{isSong ? "Now playing" : "On air now"}</div>
              <h1 className="np-title" key={now?.id}>
                {now?.label ?? "We Are Radio"}
              </h1>
              {meta && <div className="np-meta">{meta}</div>}
            </div>

            <Waveform playing={playing} seed={`${now?.id ?? ""}${now?.label ?? ""}`} />

            <div className="np-progress" aria-hidden={duration <= 0}>
              <span>{formatClock(elapsed)}</span>
              <div className="np-progress-track">
                <div className="np-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <span>{duration > 0 ? formatClock(duration) : ""}</span>
            </div>

            <div className="np-controls">
              <button className="np-play" onClick={onTogglePlay} aria-label={playing ? "Pause" : "Play"}>
                {playing ? (
                  <span className="pl-pause-icon">
                    <span />
                    <span />
                  </span>
                ) : (
                  <span className="play-triangle" />
                )}
              </button>
              <div className="np-controls-note">{playing ? "You're tuned in" : "Press play to tune in"}</div>
            </div>

            <div className="np-secondary">
              {isSong && now.track_id && (
                <FavouriteButton itemType="track" itemId={now.track_id} label="Favourite" className="np-chip" />
              )}
              <button className="np-chip" onClick={share}>
                ↗ Share
              </button>
              {now?.album_id && (
                <Link className="np-chip" to={`/albums/${now.album_id}`}>
                  View album
                </Link>
              )}
              {data.programme?.id && (
                <Link className="np-chip" to={`/programmes/${data.programme.id}`}>
                  View programme
                </Link>
              )}
              {notice && <span className="np-notice">{notice}</span>}
            </div>
          </div>
        </div>

        <div className="np-lower">
          {comingUp.length > 0 && (
            <section className="np-queue" aria-label="On the station">
              <div className="np-eyebrow">On the station</div>
              <ol className="np-queue-list">
                {now && <QueueRow label="Now" item={now} />}
                {comingUp[0] && <QueueRow label="Next" item={comingUp[0]} />}
                {comingUp[1] && <QueueRow label="After that" item={comingUp[1]} />}
              </ol>
            </section>
          )}

          <section className="np-vibe" aria-label="Vibe Shift">
            <div className="np-eyebrow">Vibe Shift - change the atmosphere</div>
            <div className="np-vibe-row">
              <button className={`np-vibe-chip${!isOverridden ? " selected" : ""}`} onClick={() => onVibe(null)}>
                <span aria-hidden="true">✨</span> Auto <small>{band}</small>
              </button>
              {VIBES.map((v) => (
                <button
                  key={v.slug}
                  className={`np-vibe-chip${isOverridden && channelSlug === v.slug ? " selected" : ""}`}
                  onClick={() => onVibe(v.slug)}
                >
                  <span aria-hidden="true">{v.emoji}</span> {v.label}
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
