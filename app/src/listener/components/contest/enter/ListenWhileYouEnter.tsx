import { Link } from "react-router-dom";
import { IconDoc, IconPause, IconPlay, IconShield, IconClock, PlayingBars } from "./icons";
import type { useStationBridge } from "./useStationBridge";

type Station = ReturnType<typeof useStationBridge>;

/** The station, in the aside: the same toggle as the hero's Listen now. Hidden when nothing is on air. */
export function ListenWhileYouEnter({ station }: { station: Station }) {
  if (!station.onAir) return null;
  return (
    <div className={`t3p-listen-card${station.playing ? " is-playing" : ""}`}>
      {station.artworkUrl ? <img src={station.artworkUrl} alt="" /> : <div className="t3p-onair-art" />}
      <div className="t3p-listen-text">
        <span className="t3p-aside-label">Listen while you enter</span>
        <strong>We Are Radio, live</strong>
        <span className="t3p-listen-now">
          {station.title ?? "On air now"}
          {station.channelName ? ` · ${station.channelName}` : ""}
        </span>
      </div>
      <button
        type="button"
        className="t3p-round-play"
        aria-pressed={station.playing}
        aria-label={station.playing ? "Pause We Are Radio" : "Play We Are Radio"}
        onClick={station.toggle}
      >
        {station.playing ? (
          <>
            <IconPause size={16} />
            <PlayingBars className="t3p-round-bars" />
          </>
        ) : (
          <IconPlay size={18} />
        )}
      </button>
    </div>
  );
}

export function TrustList() {
  return (
    <ul className="t3p-trust">
      <li>
        <IconClock className="t3p-gold-icon" />
        Every entry reviewed within 14 days
      </li>
      <li>
        <IconShield className="t3p-gold-icon" />
        You keep full ownership of your song
      </li>
      <li>
        <IconDoc className="t3p-gold-icon" />
        <Link to="/top3/rules">Read the official rules</Link>
      </li>
    </ul>
  );
}
