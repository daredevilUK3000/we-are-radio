import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ContestState } from "../../../../api/client";
import { IconArrow, IconGlobe, IconPause, IconPlay, PlayingBars } from "./icons";
import { LoopVideo, useIsDesktop } from "./media";
import { useCountdown } from "./useCountdown";
import type { useStationBridge } from "./useStationBridge";

/**
 * The cinematic top of the Top 3 entry page: full-bleed studio footage, a
 * wall of three floating clips, broadcast rings, a giant outlined "3" and an
 * equaliser floor - the homepage hero's language, turned up. Built to be
 * reused on /top3 later, so it only needs the contest state and the
 * station bridge.
 */

type Station = ReturnType<typeof useStationBridge>;

const EQ_BARS = 64;

function EqFloor() {
  return (
    <div className="t3p-eq" aria-hidden="true">
      {Array.from({ length: EQ_BARS }, (_, i) => (
        <span key={i} />
      ))}
    </div>
  );
}

function CountdownBoxes({ label, target }: { label: string; target: string }) {
  const left = useCountdown(target);
  if (!left) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const boxes: [string, string, string][] = [
    [String(left.days), "Days", "Days"],
    [pad(left.hours), "Hours", "Hours"],
    [pad(left.minutes), "Minutes", "Mins"],
    [pad(left.seconds), "Seconds", "Secs"],
  ];
  return (
    <div className="t3p-countdown">
      <span className="t3p-countdown-label">{label}</span>
      {/* Screen readers get one sentence instead of a number ticking every second. */}
      <span className="t3p-sr">
        {label.toLowerCase()} {left.days} days and {left.hours} hours
      </span>
      <div className="t3p-countdown-boxes" aria-hidden="true">
        {boxes.map(([value, long, short], i) => (
          <div key={long} className={`t3p-count-box${i === 3 ? " is-seconds" : ""}`}>
            <strong>{value}</strong>
            <span className="t3p-long">{long}</span>
            <span className="t3p-short">{short}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ListenButton({ station, className = "" }: { station: Station; className?: string }) {
  if (!station.onAir) return null;
  return (
    <button
      type="button"
      className={`t3p-btn t3p-btn-ghost t3p-listen${station.playing ? " is-playing" : ""} ${className}`}
      aria-pressed={station.playing}
      onClick={station.toggle}
    >
      <span className="t3p-listen-icon">{station.playing ? <IconPause size={16} /> : <IconPlay size={16} />}</span>
      {station.playing ? (
        <>
          On air <PlayingBars />
        </>
      ) : (
        "Listen now"
      )}
    </button>
  );
}

/**
 * The giant outlined "3" is drawn in Oswald. Until that font has arrived it
 * stays hidden: swapping fonts would move its glyph, which browsers count as
 * a layout shift (and it's only decoration, so nobody misses it for a moment).
 */
const GIANT_FONT = '700 100px "Oswald"';

function useFontsReady() {
  // Asks for the exact face: document.fonts.ready alone can report "loaded"
  // before the browser has even started fetching Oswald.
  const [ready, setReady] = useState(() => typeof document === "undefined" || !document.fonts || document.fonts.check(GIANT_FONT));
  useEffect(() => {
    if (ready) return;
    let alive = true;
    const show = () => alive && setReady(true);
    document.fonts.load(GIANT_FONT).then(show, show);
    const fallback = window.setTimeout(show, 4000); // never keep it hidden if the font can't load
    return () => {
      alive = false;
      window.clearTimeout(fallback);
    };
  }, [ready]);
  return ready;
}

export function Top3Hero({
  state,
  station,
  onEnter,
}: {
  state: ContestState;
  station: Station;
  /** Scrolls to the form and focuses it. */
  onEnter: () => void;
}) {
  const desktop = useIsDesktop();
  const fontsReady = useFontsReady();
  const accepting = state.phase === "entries_open" || state.studioPreview;
  const upcoming = state.phase === "before_entries" && !state.studioPreview;

  return (
    <section className="t3p-hero" aria-labelledby="t3p-title">
      <div className="t3p-hero-bg" aria-hidden="true">
        {/* Only one hero clip is ever requested: the wide one on desktop, the portrait one on phones and tablets. */}
        {desktop ? (
          <LoopVideo className="t3p-hero-video" src="/top3/top3-hero.mp4" poster="/top3/top3-hero.jpg" preload="auto" />
        ) : (
          <LoopVideo
            className="t3p-hero-video t3p-hero-video-mobile"
            src="/top3/top3-hero-mobile.mp4"
            poster="/top3/top3-hero-mobile.jpg"
            preload="auto"
          />
        )}
        <div className="t3p-hero-scrim" />
        <div className="t3p-hero-fade" />
        <div className="t3p-rings">
          <span />
          <span />
          <span />
        </div>
        <div className={`t3p-giant-3${fontsReady ? " is-ready" : ""}`}>3</div>
      </div>

      {desktop && (
        <div className="t3p-wall" aria-hidden="true">
          <figure className="t3p-tile t3p-tile-a">
            <LoopVideo src="/top3/top3-tile-singer.mp4" poster="/top3/top3-tile-singer.jpg" />
            <span className="t3p-live">
              <i /> Live
            </span>
            <figcaption>
              <strong>Played on air</strong>
              <span>Approved songs can join the weekly Creator Spotlight.</span>
            </figcaption>
          </figure>
          <figure className="t3p-tile t3p-tile-b">
            <LoopVideo src="/top3/top3-tile-guitar.mp4" poster="/top3/top3-tile-guitar.jpg" />
            <figcaption>
              <strong>Voted by listeners</strong>
              <span>From 1 April 2027</span>
            </figcaption>
          </figure>
          <figure className="t3p-tile t3p-tile-c">
            <LoopVideo src="/top3/top3-tile-stage.mp4" poster="/top3/top3-tile-stage.jpg" />
            <figcaption>
              <strong>Crowned live on air</strong>
              <span>The Top 3 revealed, September 2027</span>
            </figcaption>
          </figure>
        </div>
      )}

      <div className="t3p-hero-content">
        <div className="t3p-pills">
          {accepting && (
            <span className="t3p-pill t3p-pill-red">
              <i className="t3p-blink" /> Now accepting entries<span className="t3p-mobile-only"> · Worldwide</span>
            </span>
          )}
          {upcoming && (
            <span className="t3p-pill t3p-pill-red">
              <i className="t3p-blink" /> Entries open 1 October 2026
            </span>
          )}
          {!accepting && !upcoming && <span className="t3p-pill t3p-pill-red">Entries are closed</span>}
          <span className="t3p-pill t3p-pill-gold t3p-desktop-only">
            <IconGlobe /> Open worldwide
          </span>
        </div>

        <p className="t3p-presents">We Are Radio presents</p>
        <h1 id="t3p-title" className="t3p-h1">
          <span className="t3p-h1-top">
            Top <span className="t3p-red">3</span>
          </span>
          <span className="t3p-h1-sub">
            Creator Songs <span className="t3p-sheen">of 2026</span>
          </span>
        </h1>

        <p className="t3p-lede">
          The international search for the three best songs made by Independent Creators this year. Free to enter.
          <span className="t3p-desktop-only"> Played on We Are Radio. Voted for by listeners around the world.</span>
        </p>

        <div className="t3p-actions">
          {accepting && (
            <button type="button" className="t3p-btn t3p-btn-red" onClick={onEnter}>
              Enter your song <IconArrow />
            </button>
          )}
          {upcoming && (
            <Link to="/top3/rules" className="t3p-btn t3p-btn-red">
              Read the rules <IconArrow />
            </Link>
          )}
          {!accepting && !upcoming && (
            <Link to="/top3" className="t3p-btn t3p-btn-red">
              Browse the songs <IconArrow />
            </Link>
          )}
          <ListenButton station={station} />
        </div>

        {accepting && <CountdownBoxes label="Entries close in" target={state.dates.entriesClose} />}
        {upcoming && <CountdownBoxes label="Entries open in" target={state.dates.entriesOpen} />}
      </div>

      {station.onAir && station.playing && (
        <div className="t3p-onair-card">
          {station.artworkUrl ? <img src={station.artworkUrl} alt="" /> : <div className="t3p-onair-art" />}
          <div className="t3p-onair-text">
            <span className="t3p-onair-eyebrow">
              <i className="t3p-blink" /> On air · {station.channelName ?? "We Are Radio"}
            </span>
            <strong>{station.title ?? "We Are Radio"}</strong>
            <span>Keep listening while you enter</span>
          </div>
          <PlayingBars className="t3p-onair-bars" />
        </div>
      )}

      <EqFloor />
    </section>
  );
}
