import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { mediaUrl } from "../../api/client";
import { EqBars, HintBar, Icon, RoundControl, TvButton, TvClock } from "../components";
import { useOnDemand } from "../TvOnDemand";
import { mmss } from "../tvData";
import { goBack } from "../tvUi";

/**
 * Playing something on demand (TvOnDemand.tsx): the ad, mix, album track,
 * Top 3 song or podcast episode picked on Home, with Previous / Play / Next
 * and "Back to the radio". Back (or the last item ending) gives the TV back
 * to the radio.
 */

function titleSize(title: string): number {
  if (title.length > 48) return 56;
  if (title.length > 30) return 72;
  if (title.length > 18) return 88;
  return 104;
}

const skip = (
  <svg viewBox="0 0 24 24" width="40%" height="40%" fill="currentColor">
    <path d="M5 5l9 7-9 7z" />
    <rect x="16" y="5" width="3" height="14" rx="1" />
  </svg>
);
const skipBack = (
  <svg viewBox="0 0 24 24" width="40%" height="40%" fill="currentColor">
    <path d="M19 5l-9 7 9 7z" />
    <rect x="5" y="5" width="3" height="14" rx="1" />
  </svg>
);

export function OnDemand() {
  const navigate = useNavigate();
  const od = useOnDemand();
  const { ref, focusKey } = useFocusable({ focusKey: "tv-ondemand", trackChildren: true });
  const [pos, setPos] = useState({ at: 0, total: 0 });

  // Nothing (left) to play: back to wherever the listener came from.
  useEffect(() => {
    if (!od.queue) goBack(navigate);
  }, [od.queue, navigate]);

  useEffect(() => {
    const t = window.setTimeout(() => setFocus("tv-od-play"), 50);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const audio = od.audioRef.current;
    if (!audio) return;
    const tick = () => setPos({ at: audio.currentTime || 0, total: Number.isFinite(audio.duration) ? audio.duration : od.item?.duration_seconds ?? 0 });
    tick();
    audio.addEventListener("timeupdate", tick);
    audio.addEventListener("loadedmetadata", tick);
    return () => {
      audio.removeEventListener("timeupdate", tick);
      audio.removeEventListener("loadedmetadata", tick);
    };
  }, [od.audioRef, od.item?.id]);

  const q = od.queue;
  const it = od.item;
  if (!q || !it) return <div className="tv-screen tv-np" />;

  const good = q.kind === "good";
  const upNext = q.items.slice(od.index + 1, od.index + 5);
  const art = it.artwork_url ? mediaUrl(it.artwork_url) : null;

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={`tv-screen tv-np tv-od is-${q.kind}`}>
        <div className="tv-bg">
          {art ? <img className="tv-bg-media tv-np-blur" src={art} alt="" /> : <div className="tv-bg-media tv-od-wash" />}
          <div className="tv-np-glow" />
          <div className="tv-scrim-bottom" />
        </div>

        <header className="tv-top">
          <TvButton focusKey="tv-od-back" onPress={od.stop}>
            ‹ Back to the radio
          </TvButton>
          <div className="tv-np-station">
            <span>{q.eyebrow}</span>
          </div>
          <TvClock />
        </header>

        <div className="tv-np-main">
          <div className={`tv-np-artwork${good ? " is-good" : ""}`}>
            {art ? <img src={art} alt="" /> : good ? <span className="tv-od-heart">{Icon.heart(true)}</span> : <img className="tv-np-artwork-logo" src="/weareradio-logo-hero.webp" alt="" />}
          </div>
          <div className="tv-np-details">
            <div className="tv-np-eyebrow">
              {good ? <span className="tv-good-pill">Advertising For Good</span> : q.items.length > 1 ? `${od.index + 1} of ${q.items.length}` : "Playing now"}{" "}
              <EqBars still={!od.playing} />
            </div>
            <h1 className="tv-np-title" style={{ fontSize: titleSize(it.title) }}>
              {it.title}
            </h1>
            <div className={`tv-np-artist${good ? " is-good" : ""}`}>{good ? "A short message that asks you to be kind, not to buy" : (it.subtitle ?? "")}</div>
            {pos.total > 0 && (
              <div className="tv-np-progress big">
                <span>{mmss(pos.at)}</span>
                <span className="tv-bar">
                  <i style={{ width: `${Math.min(100, (pos.at / pos.total) * 100)}%` }} />
                  <b style={{ left: `${Math.min(100, (pos.at / pos.total) * 100)}%` }} />
                </span>
                <span>{mmss(pos.total)}</span>
              </div>
            )}
            <div className="tv-controls">
              {q.items.length > 1 && <RoundControl focusKey="tv-od-prev" label="Previous" icon={skipBack} onPress={od.previous} />}
              <RoundControl focusKey="tv-od-play" size={132} label={od.playing ? "Pause" : "Play"} icon={od.playing ? Icon.pause : Icon.play} onPress={od.toggle} />
              {q.items.length > 1 && <RoundControl focusKey="tv-od-next" label="Next" icon={skip} onPress={od.next} />}
            </div>
          </div>
        </div>

        {upNext.length > 0 && (
          <section className="tv-up" aria-label="Up next">
            <h2 className="tv-row-title">Up next</h2>
            <div className="tv-up-row">
              {upNext.map((n, k) => (
                <div key={n.id + k} className="tv-up-card">
                  <div className="tv-up-when">{k === 0 ? "Next" : `${od.index + k + 2} of ${q.items.length}`}</div>
                  <div className="tv-up-title">{n.title}</div>
                  <div className="tv-up-sub">{n.subtitle ?? (n.duration_seconds ? mmss(n.duration_seconds) : "")}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        <HintBar
          items={[
            ["OK", od.playing ? "Pause" : "Play"],
            ...(q.items.length > 1 ? ([["▶▶", "Next"]] as [string, string][]) : []),
            ["BACK", "Back to the radio"],
          ]}
        />
      </div>
    </FocusContext.Provider>
  );
}
