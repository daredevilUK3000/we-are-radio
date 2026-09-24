import { useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { useContestState } from "../../components/contest/common";
import { Top3Hero } from "../../components/contest/enter/Top3Hero";
import { CountryMarquee } from "../../components/contest/enter/CountryMarquee";
import { RoadToTop3 } from "../../components/contest/enter/RoadToTop3";
import { PrizePackage } from "../../components/contest/enter/PrizePackage";
import { EntryWizard } from "../../components/contest/enter/EntryWizard";
import { useStationBridge } from "../../components/contest/enter/useStationBridge";
import "./top3-enter.css";

/**
 * /top3/enter - the Top 3 entry page (handoff: Top 3 entry page redesign).
 * A cinematic hero, the countries, the road to the Top 3, the prize, then
 * the entry wizard. All the entry logic lives in EntryWizard; this page just
 * lays the sections out. Everything is scoped under .t3p (top3-enter.css).
 */

// Makes the hero poster for this screen size the first image the browser fetches.
function usePreloadHeroPoster() {
  useEffect(() => {
    const desktop = window.matchMedia?.("(min-width: 1024px)").matches;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = desktop ? "/top3/top3-hero.jpg" : "/top3/top3-hero-mobile.jpg";
    document.head.appendChild(link);
    return () => link.remove();
  }, []);
}

export function ContestEnter() {
  const { state, error } = useContestState();
  const station = useStationBridge();
  usePreloadHeroPoster();

  // "Enter your song": scroll to the form and put the cursor in the current step.
  const goToForm = useCallback(() => {
    const section = document.getElementById("enter");
    if (!section) return;
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    const target = section.querySelector<HTMLElement>(
      ".t3p-step:not([hidden]) input:not([type=hidden]):not([tabindex='-1']), .t3p-step:not([hidden]) select, .t3p-step:not([hidden]) textarea"
    );
    window.setTimeout(() => target?.focus({ preventScroll: true }), 450);
  }, []);

  if (error) {
    return (
      <div className="t3p t3p-loading">
        <p>Couldn't load the competition right now. Please try again in a minute.</p>
      </div>
    );
  }
  if (!state) return <div className="t3p t3p-loading" aria-busy="true" />;

  return (
    <div className="t3p">
      {state.phase === "before_entries" && state.studioPreview && (
        <p className="t3p-preview-bar">
          Studio preview: entries aren't open to the public yet. Remember to withdraw test entries in the Studio before 1 October.
        </p>
      )}

      <Top3Hero state={state} station={station} onEnter={goToForm} />
      <CountryMarquee />
      <RoadToTop3 current={1} />
      <PrizePackage />

      <section id="enter" className="t3p-enter" aria-labelledby="t3p-enter-title">
        <div className="t3p-section-head">
          <div>
            <span className="t3p-eyebrow t3p-eyebrow-red">Your entry</span>
            <h2 id="t3p-enter-title" className="t3p-h2">
              Enter your song
            </h2>
          </div>
          <ul className="t3p-facts">
            <li>Free to enter</li>
            <li>One 2026 song per creator</li>
            <li>About 5 minutes</li>
          </ul>
        </div>
        <EntryWizard state={state} station={station} />
      </section>

      <footer className="t3p-footer">
        <img src="/weareradio-logo.webp" alt="We Are Radio" width={68} height={30} />
        <span>Top 3 Creator Songs of 2026</span>
        <nav aria-label="Competition links">
          <Link to="/top3/rules">Official rules</Link>
          <Link to="/top3/rules#privacy">Privacy</Link>
          <a href="mailto:info@weareradio.app">info@weareradio.app</a>
        </nav>
      </footer>
    </div>
  );
}
