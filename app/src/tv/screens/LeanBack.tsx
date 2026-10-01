import { useEffect, useState } from "react";
import { EqBars } from "../components";
import { useTvPlayer } from "../TvPlayer";
import { clockText, dateText, stillFor, useNow, useTvData } from "../tvData";

/**
 * Screen 4: Lean back (handoff_tv_firetv.md §A7). Ambient, for listening from
 * the sofa. Burn-in protection: the text drifts slowly (CSS, transform only)
 * and the logo moves to another corner every 10 minutes.
 */
const CORNERS = ["br", "bl", "tr", "tl"] as const;

export function LeanBack() {
  const player = useTvPlayer();
  const { now: all } = useTvData();
  const nowMs = useNow(1000);
  const [corner, setCorner] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setCorner((c) => (c + 1) % CORNERS.length), 10 * 60_000);
    return () => window.clearInterval(id);
  }, []);

  const data = player.data;
  const item = data?.now_playing;
  const voice = item?.voice;
  const title = voice ? `${voice.first_name}${voice.place ? ` in ${voice.place}` : ""}` : (item?.label ?? data?.channel?.name ?? "We Are Radio");
  const block = all[player.slug]?.block?.name;
  const sub = [voice ? "Listener voice" : item?.artist, data?.channel?.name, block].filter(Boolean).join(" · ");
  // The text group sits at the bottom left, so the logo avoids that corner.
  const logoCorner = CORNERS[corner] === "bl" ? "tr" : CORNERS[corner];

  return (
    <div className="tv-lean" role="dialog" aria-label="Lean back">
      <img className="tv-lean-bg" src={stillFor(player.slug)} alt="" />
      <div className="tv-scrim-bottom" />
      <div className="tv-lean-hint">Press any button</div>
      <div className="tv-lean-text">
        <div className="tv-lean-clock">{clockText(nowMs)}</div>
        <div className="tv-lean-date">{dateText(nowMs)}</div>
        <div className="tv-lean-song">
          <EqBars still={!player.playing} /> {title}
        </div>
        {sub && <div className="tv-lean-sub">{sub}</div>}
      </div>
      <img className={`tv-lean-logo is-${logoCorner}`} src="/weareradio-logo-hero.webp" alt="" />
    </div>
  );
}
