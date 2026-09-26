import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { contestApi, mediaUrl, type ContestEntry } from "../../../api/client";
import { useOnline } from "../../../shared/offline";
import { CountryLabel, useContestStateShared } from "./common";
import { copyFor, type PhaseCopy } from "./phaseCopy";
import { WinnersPodium } from "./WinnersPodium";
import { IconArrow, IconPlay } from "./enter/icons";
import { LoopVideo } from "./enter/media";
import { useCountdown } from "./enter/useCountdown";
import { Laurel } from "./enter/PrizePackage";
import "./top3-feature.css";

/**
 * The full-width Top 3 band under the homepage hero (handoff: Top 3 on the
 * homepage, section 6). Its words, buttons, countdown and bottom row all
 * follow the contest phase (phaseCopy.ts). Renders nothing offline or while
 * the contest state is unknown - no skeleton, no error.
 */

// "In the running" only appears once there are enough songs to fill the row.
const RUNNING_MIN = 5;

export function Top3FeatureBand() {
  const online = useOnline();
  const { state } = useContestStateShared();
  if (!online || !state) return null;
  const copy = copyFor(state);

  return (
    <section className="t3f" aria-labelledby="t3f-title">
      <div className="t3f-hairline" aria-hidden="true" />
      <div className="t3f-glow-red" aria-hidden="true" />
      <div className="t3f-glow-gold" aria-hidden="true" />
      <div className="t3f-big3" aria-hidden="true">
        3
      </div>

      <div className="t3f-inner">
        <div className="t3f-main">
          <div className="t3f-media">
            <div className="t3f-frame">
              <LoopVideo src="/top3/top3-tile-stage.mp4" poster="/top3/top3-tile-stage.jpg" preload="none" lazy className="t3f-video" />
              <div className="t3f-frame-shade" aria-hidden="true" />
              <div className="t3f-frame-caption">
                <span className="t3f-official">AN OFFICIAL WE ARE RADIO COMPETITION</span>
                <span className="t3f-frame-line">Independent Creators · Every country</span>
              </div>
            </div>
            <span className="t3f-tag">
              <i className="t3f-blink" aria-hidden="true" />
              {copy.bandTag}
            </span>
            <div className="t3f-badge" aria-hidden="true">
              <Laurel prefix="t3f" rings={false} />
              <span className="t3f-badge-3 t3f-sheen">3</span>
              <span className="t3f-badge-year">2026</span>
            </div>
          </div>

          <div className="t3f-copy">
            <p className="t3f-eyebrow">
              <i className="t3f-blink" aria-hidden="true" />
              {copy.eyebrow}
            </p>
            <h2 id="t3f-title" className="t3f-h2">
              <span className="t3f-h2-line">
                TOP <span className="t3f-red">3</span> CREATOR
              </span>{" "}
              <span className="t3f-h2-line">
                SONGS <span className="t3f-sheen">OF 2026</span>
              </span>
            </h2>
            <p className="t3f-lede">{copy.lede}</p>
            {copy.countdown && <BandCountdown label={copy.countdown.label} target={copy.countdown.target} />}
            <div className="t3f-actions">
              <Link to={copy.primary.to} className="t3f-btn-primary">
                {copy.primary.label}
                <IconArrow size={16} />
              </Link>
              <Link to={copy.secondary.to} className="t3f-btn-secondary">
                {copy.secondary.label}
              </Link>
            </div>
          </div>
        </div>

        {copy.bottom === "stages" && <FourStages copy={copy} />}
        {copy.bottom === "running" && state.approvedCount >= RUNNING_MIN && <InTheRunning />}
        {/* TODO(Phase E): pass the winners from the results API once it exists. */}
        {copy.bottom === "podium" && <WinnersPodium />}
      </div>
    </section>
  );
}

// Its own component so the once-a-second tick only re-renders the countdown.
function BandCountdown({ label, target }: { label: string; target: string }) {
  const left = useCountdown(target);
  if (!left || left.done) return null;
  const units: [number, string][] = [
    [left.days, "DAYS"],
    [left.hours, "HOURS"],
    [left.minutes, "MINS"],
    [left.seconds, "SECS"],
  ];
  return (
    <div className="t3f-countdown" role="timer" aria-label={`${label.toLowerCase()} ${left.days} days, ${left.hours} hours`}>
      <span className="t3f-countdown-label">{label}</span>
      <div className="t3f-countdown-boxes" aria-hidden="true">
        {units.map(([n, unit]) => (
          <span key={unit} className={`t3f-cd-box${unit === "SECS" ? " is-secs" : ""}`}>
            <b>{String(n).padStart(2, "0")}</b>
            <small>{unit}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function FourStages({ copy }: { copy: PhaseCopy }) {
  const names = ["ENTER YOUR SONG", "GET HEARD ON AIR", "THE WORLD VOTES", "TOP 3 CROWNED"];
  return (
    <ol className="t3f-stages">
      {copy.stages.map((when, i) => (
        <li key={i} className={`t3f-stage t3f-stage-${i + 1}`}>
          <span className="t3f-stage-when">{when}</span>
          <span className={`t3f-stage-name${i === 3 ? " t3f-sheen" : ""}`}>{names[i]}</span>
        </li>
      ))}
    </ol>
  );
}

// The API hands out the day's shuffle, not the newest songs - hence "in the running".
function InTheRunning() {
  const [entries, setEntries] = useState<ContestEntry[] | null>(null);
  useEffect(() => {
    let live = true;
    contestApi
      .entries({ limit: RUNNING_MIN })
      .then((r) => live && setEntries(r.entries.slice(0, RUNNING_MIN)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!entries || entries.length === 0) return null;

  return (
    <div className="t3f-running">
      <div className="t3f-running-head">
        <span className="t3f-running-label">IN THE RUNNING</span>
        <Link to="/top3" className="t3f-running-all">
          See all songs
        </Link>
      </div>
      <ul className="t3f-running-grid">
        {entries.map((e) => (
          <li key={e.id}>
            <Link to={`/top3/${e.id}`} className="t3f-song" aria-label={`${e.title} by ${e.creator_name}, Song #${e.id}`}>
              <span className="t3f-song-art">
                <img src={e.photo_url ? mediaUrl(e.photo_url) : "/top3/top3-card-studio.jpg"} alt="" loading="lazy" />
                <span className="t3f-song-num">SONG #{e.id}</span>
                <span className="t3f-song-play" aria-hidden="true">
                  <IconPlay size={14} />
                </span>
              </span>
              <span className="t3f-song-body">
                <span className="t3f-song-title">{e.title}</span>
                <span className="t3f-song-by">
                  {e.creator_name} · <CountryLabel code={e.country_code} />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
