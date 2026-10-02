import { Link, NavLink } from "react-router-dom";
import type { GoodAd } from "../../../api/client";
import { clock, toggleGood, useGoodAds, useGoodPreview } from "./goodPreview";
import "./good.css";

/**
 * Advertising For Good on the landing page, the nav and the footer
 * (handoff_advertising_for_good.md §5). Every piece renders nothing until
 * there's at least one published ad, and nothing offline.
 */

export function HeartIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20s-7.5-4.6-10-9.2C.5 7.4 2.2 4 5.8 4c2 0 3.6 1.1 4.2 2.7C10.6 5.1 12.2 4 14.2 4c3.6 0 5.3 3.4 3.8 6.8C15.5 15.4 12 20 12 20z" />
    </svg>
  );
}

function PlayPauseIcon({ playing, size }: { playing: boolean; size: number }) {
  return playing ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}

/** A real <button> for one ad: "Play: Be kind" / "Pause: Be kind". */
export function GoodPlayButton({ ad, big = false }: { ad: GoodAd; big?: boolean }) {
  const preview = useGoodPreview();
  const playing = preview.id === ad.id && preview.playing;
  return (
    <button
      type="button"
      className={big ? "afg-play afg-play-big" : "afg-play"}
      aria-label={`${playing ? "Pause" : "Play"}: ${ad.title}`}
      onClick={() => toggleGood(ad)}
    >
      <PlayPauseIcon playing={playing} size={big ? 26 : 18} />
    </button>
  );
}

/** How far through this ad is (0 to 1), when it's the one loaded in the preview. */
export function useGoodProgress(ad: GoodAd): { active: boolean; pct: number; current: number } {
  const preview = useGoodPreview();
  const active = preview.id === ad.id && (preview.playing || preview.current > 0);
  const length = preview.duration || ad.duration_seconds || 1;
  return { active, pct: active ? Math.min(1, preview.current / length) : 0, current: active ? preview.current : 0 };
}

const secondsLabel = (s: number) => `${Math.round(s)} seconds`;

// A fixed, made-up waveform (the same every time), filled as the ad plays.
const BARS = Array.from({ length: 44 }, (_, i) => {
  const v = Math.abs(Math.sin(i * 0.9) * 0.6 + Math.sin(i * 2.3) * 0.3 + Math.sin(i * 0.31) * 0.25);
  return Math.round(22 + Math.min(1, v) * 78);
});

function Waveform({ pct }: { pct: number }) {
  const filled = Math.round(pct * BARS.length);
  return (
    <div className="afg-wave" aria-hidden="true">
      {BARS.map((h, i) => (
        <span key={i} className={i < filled ? "afg-wave-bar is-done" : "afg-wave-bar"} style={{ height: `${h}%` }} />
      ))}
    </div>
  );
}

function FeaturedPlayer({ ad }: { ad: GoodAd }) {
  const { active, pct, current } = useGoodProgress(ad);
  return (
    <div className="afg-featured">
      <div className="afg-featured-top">
        <span className="afg-label">Hear one</span>
        <span className="afg-time">{active ? `${clock(current)} / ${clock(ad.duration_seconds)}` : clock(ad.duration_seconds)}</span>
      </div>
      <div className="afg-featured-main">
        <GoodPlayButton ad={ad} big />
        <div className="afg-featured-text">
          <div className="afg-featured-title">{ad.title}</div>
          <div className="afg-featured-sub">Advertising For Good · {secondsLabel(ad.duration_seconds)}</div>
        </div>
      </div>
      <Waveform pct={pct} />
    </div>
  );
}

function AdRow({ ad }: { ad: GoodAd }) {
  const { pct } = useGoodProgress(ad);
  return (
    <li className="afg-row">
      <GoodPlayButton ad={ad} />
      <span className="afg-row-title">{ad.title}</span>
      <span className="afg-row-time">{clock(ad.duration_seconds)}</span>
      <span className="afg-row-progress" aria-hidden="true" style={{ width: `${pct * 100}%` }} />
    </li>
  );
}

/** The featured ad, then the next four in display order. */
export function splitAds(ads: GoodAd[]): { featured: GoodAd; rest: GoodAd[] } | null {
  if (ads.length === 0) return null;
  const featured = ads.find((a) => a.featured) ?? ads[0];
  return { featured, rest: ads.filter((a) => a.id !== featured.id) };
}

/** One line under the hero's buttons, linking down to the card. */
export function GoodHeroLine() {
  const data = useGoodAds();
  if (!data || data.ads.length === 0) return null;
  return (
    <a href="#good" className="afg-hero-line">
      <span className="afg-dot" aria-hidden="true" />
      <span>
        Home of <b>Advertising For Good</b>: ads that ask you to be kind, not to buy
      </span>
    </a>
  );
}

/** The landing page card: after Explore Channels, before Radio That Knows You. */
export function GoodSection() {
  const data = useGoodAds();
  const split = data ? splitAds(data.ads) : null;
  if (!data || !split) return null;
  const count = data.ads.length;
  return (
    <section className="home-section" id="good" aria-labelledby="afg-heading">
      <div className="afg-card">
        <div className="afg-cols">
          <div className="afg-copy">
            <span className="afg-eyebrow">
              <HeartIcon />
              Advertising For Good
            </span>
            <h2 id="afg-heading" className="afg-heading">
              Ads that ask you to be kind, <span className="afg-green">not to buy.</span>
            </h2>
            <p className="afg-body">
              Between the songs on We Are Radio you'll hear something a little different. Short messages that ask nothing of your
              wallet: check on a neighbour, look out for someone who's struggling, start the day expecting something good.
            </p>
            <p className="afg-body">Nothing to buy. Just a nudge towards being kind.</p>
            <Link to="/good" className="afg-more">
              More about Advertising For Good →
            </Link>
          </div>

          <div className="afg-players">
            <FeaturedPlayer ad={split.featured} />
            <ul className="afg-list">
              {split.rest.slice(0, 4).map((ad) => (
                <AdRow key={ad.id} ad={ad} />
              ))}
              <li className="afg-list-all">
                <Link to="/good">
                  <span>{count === 1 ? "Hear it and share it" : `Hear all ${count} and share one`}</span>
                  <span aria-hidden="true">→</span>
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <ul className="afg-points">
          <li>Nothing to buy</li>
          <li>20 to 40 seconds each</li>
          <li>On every We Are Radio channel</li>
          <li>Every one has its own link to pass on</li>
        </ul>
      </div>
    </section>
  );
}

/** "For Good" in the top nav, next to the Top 3 pill. */
export function GoodNavPill() {
  const data = useGoodAds();
  if (!data || data.ads.length === 0) return null;
  return (
    <NavLink to="/good" className="afg-nav-pill">
      <HeartIcon size={12} />
      For Good
    </NavLink>
  );
}

/** First in the footer nav. */
export function GoodFooterLink() {
  const data = useGoodAds();
  if (!data || data.ads.length === 0) return null;
  return (
    <Link to="/good" className="afg-footer-link">
      Advertising For Good
    </Link>
  );
}
