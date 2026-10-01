import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FocusContext, getCurrentFocusKey, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { mediaUrl } from "../../api/client";
import { useLikes } from "../../listener/components/LikeButton";
import { voiceLines } from "../../listener/components/onair/voice";
import { behindLabel } from "../../listener/lib/useRewind";
import { trackTv } from "../../shared/analytics";
import { ChannelStill, EqBars, HintBar, Icon, OnAirPill, RoundControl, TvButton, TvClock } from "../components";
import { useTvPlayer } from "../TvPlayer";
import { clockText, mmss, stillFor, useTvData } from "../tvData";
import { useTvUi } from "../tvUi";

/** Screen 2: Now Playing (handoff_tv_firetv.md §A5). */

function titleSize(title: string): number {
  if (title.length > 36) return 64;
  if (title.length > 22) return 80;
  return 104;
}

function LivePill({ behind, onPress, onArrow }: { behind: number; onPress: () => void; onArrow: (dir: string) => boolean }) {
  const { ref, focused } = useFocusable({ focusKey: "tv-live-pill", onEnterPress: onPress, onArrowPress: (dir) => onArrow(dir) });
  return (
    <button ref={ref} type="button" tabIndex={-1} className={`tv-live-pill${focused ? " is-focused" : ""}`} onClick={onPress}>
      <span className="tv-onair-dot" /> Back to live · {behindLabel(behind)} behind
    </button>
  );
}

export function NowPlaying() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const player = useTvPlayer();
  const ui = useTvUi();
  const { channels, now: allNow } = useTvData();
  const { ref, focusKey } = useFocusable({ focusKey: "tv-nowplaying", trackChildren: true });
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  // Opening Now Playing for another channel switches the audio to it, live.
  useEffect(() => {
    if (slug && slug !== player.slug) player.tune(slug, { play: player.playing });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    const t = window.setTimeout(() => setFocus("tv-play"), 50);
    return () => window.clearTimeout(t);
  }, []);

  const data = player.data;
  const now = data?.now_playing ?? null;
  const channelName = data?.channel?.name ?? channels?.find((c) => c.slug === slug)?.name ?? "";
  const isSong = now?.item_type === "song";
  const likes = useLikes("track", isSong && now?.track_id ? [now.track_id] : []);
  const liked = !!(now?.track_id && likes.isLiked(now.track_id));
  const voice = now?.voice ? voiceLines(now.voice) : null;
  const meta = allNow[slug];

  // Progress from the element itself (a replay shows its own position).
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const audio = player.audioRef.current;
    if (!audio) return;
    const on = () => setElapsed(audio.currentTime);
    on();
    audio.addEventListener("timeupdate", on);
    return () => audio.removeEventListener("timeupdate", on);
  }, [player.audioRef, now?.id]);
  const total = Number((player.rewound ? now?.file_duration_seconds : null) ?? now?.duration_seconds ?? 0);

  const changeChannel = (step: number) => {
    const list = channels ?? [];
    if (list.length < 2) return;
    const i = Math.max(0, list.findIndex((c) => c.slug === slug));
    const next = list[(i + step + list.length) % list.length];
    trackTv("tv_channel_change", null);
    player.tune(next.slug, { play: true });
    navigate(`/tv/listen/${next.slug}`, { replace: true });
    setToast(next.name);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2000);
  };

  // Up/Down change channel; with the Back to live pill showing, Up first reaches it.
  const onControlArrow = (dir: string) => {
    if (dir === "up" && player.rewound) {
      setFocus("tv-live-pill");
      return false;
    }
    if (dir === "up" || dir === "down") {
      changeChannel(dir === "up" ? -1 : 1);
      return false;
    }
    return true;
  };
  const onPillArrow = (dir: string) => {
    if (dir === "down") {
      setFocus("tv-play");
      return false;
    }
    if (dir === "up") {
      changeChannel(-1);
      return false;
    }
    return false;
  };

  // If Start over (or the Back to live pill) disappears while focused, focus returns to Play.
  useEffect(() => {
    const key = getCurrentFocusKey();
    if ((!player.canStartOver && key === "tv-startover") || (!player.rewound && key === "tv-live-pill")) setFocus("tv-play");
  }, [player.canStartOver, player.rewound]);

  const comingUp: any[] = (data?.coming_up ?? []).slice(0, meta?.next_block ? 3 : 4);
  const title = voice ? voice.title : (now?.label ?? channelName);

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="tv-screen tv-np">
        <div className="tv-bg">
          {/* Blurred once, never animated: a changing blur is too slow on Fire TV. */}
          <img className="tv-bg-media tv-np-blur" src={stillFor(slug)} alt="" />
          <div className="tv-np-glow" />
          <div className="tv-scrim-bottom" />
        </div>

        <header className="tv-top">
          <TvButton focusKey="tv-np-back" onPress={() => navigate("/tv")}>
            ‹ Channels
          </TvButton>
          <div className="tv-np-station">
            <OnAirPill />
            <span>{channelName}</span>
          </div>
          <TvClock />
        </header>

        <div className="tv-np-main">
          <div className="tv-np-artwork">
            {now?.artwork_url ? <img src={mediaUrl(now.artwork_url)} alt="" /> : <ChannelStill slug={slug} />}
            {!now?.artwork_url && <img className="tv-np-artwork-logo" src="/weareradio-logo-hero.webp" alt="" />}
          </div>
          <div className="tv-np-details">
            <div className="tv-np-eyebrow">
              {voice ? <span className="tv-voice-pill">Listener voice</span> : "Now playing"} <EqBars still={!player.playing} />
            </div>
            <h1 className="tv-np-title" style={{ fontSize: titleSize(title) }}>
              {title}
            </h1>
            <div className="tv-np-artist">{voice ? voice.sub : (now?.artist ?? "")}</div>
            {meta?.block && (
              <div className="tv-block-row">
                <span className="tv-block-chip">{meta.block.name}</span>
                <span>
                  {meta.block.description ? `${meta.block.description} · ` : ""}until {clockText(meta.block.ends_at * 1000)}
                </span>
              </div>
            )}
            {total > 0 && (
              <div className="tv-np-progress big">
                <span>{mmss(elapsed)}</span>
                <span className="tv-bar">
                  <i style={{ width: `${Math.min(100, (elapsed / total) * 100)}%` }} />
                  <b style={{ left: `${Math.min(100, (elapsed / total) * 100)}%` }} />
                </span>
                <span>{mmss(total)}</span>
              </div>
            )}
            {player.rewound && <LivePill behind={player.behindSeconds} onPress={player.backToLive} onArrow={onPillArrow} />}
            <div className="tv-controls">
              {player.canStartOver && (
                <RoundControl focusKey="tv-startover" label="Start over" icon={Icon.restart} onPress={player.startOver} onArrowPress={onControlArrow} />
              )}
              <RoundControl
                focusKey="tv-play"
                size={132}
                label={player.playing ? "Pause" : "Play"}
                icon={player.playing ? Icon.pause : Icon.play}
                onPress={player.toggle}
                onArrowPress={onControlArrow}
              />
              {isSong && now?.track_id && (
                <RoundControl
                  focusKey="tv-like"
                  label={liked ? "Liked" : "Like"}
                  icon={Icon.heart(liked)}
                  active={liked}
                  onPress={() => likes.toggle(now.track_id)}
                  onArrowPress={onControlArrow}
                />
              )}
              <RoundControl focusKey="tv-lean" label="Lean back" icon={Icon.moon} onPress={() => ui.enterLeanBack()} onArrowPress={onControlArrow} />
            </div>
          </div>
        </div>

        <section className="tv-up" aria-label="Coming up">
          <h2 className="tv-row-title">Coming up</h2>
          <div className="tv-up-row">
            {comingUp.map((i, k) => (
              <div key={i.id ?? k} className="tv-up-card">
                <div className="tv-up-when">
                  {i.starts_at ? `${clockText(i.starts_at * 1000)} · ` : ""}
                  {i.item_type === "song" ? "Song" : i.voice ? "Listener voice" : "On air"}
                </div>
                <div className="tv-up-title">{i.voice ? `${i.voice.first_name}${i.voice.place ? ` in ${i.voice.place}` : ""}` : i.label}</div>
                <div className="tv-up-sub">{i.artist ?? ""}</div>
              </div>
            ))}
            {meta?.next_block && (
              <div className="tv-up-card is-show">
                <div className="tv-up-when">Coming up at {clockText(meta.next_block.starts_at * 1000)}</div>
                <div className="tv-up-title">{meta.next_block.name}</div>
                <div className="tv-up-sub">
                  Next show · {clockText(meta.next_block.starts_at * 1000)}
                  {meta.next_block.ends_at ? `–${clockText(meta.next_block.ends_at * 1000)}` : ""}
                </div>
              </div>
            )}
          </div>
        </section>

        <HintBar
          items={[
            ["▲ ▼", "Change channel"],
            ["OK", player.playing ? "Pause" : "Play"],
            ["◀◀", "Start over"],
            ["BACK", "Channels"],
          ]}
        />

        {toast && (
          <div className="tv-toast" role="status">
            {toast}
          </div>
        )}
        {/* Off the network: the buffer keeps the station playing; say so quietly. */}
        {(player.unreachable || data?.from_buffer) && (
          <div className="tv-toast is-warn" role="status">
            Reconnecting…
          </div>
        )}
      </div>
    </FocusContext.Provider>
  );
}
