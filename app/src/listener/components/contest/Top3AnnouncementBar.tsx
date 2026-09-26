import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useOnline } from "../../../shared/offline";
import { useContestStateShared } from "./common";
import { copyFor } from "./phaseCopy";
import { IconArrow, IconClose, IconTrophy } from "./enter/icons";
import "./top3-feature.css";

/**
 * The red strip above the menu on every listener page (handoff: Top 3 on the
 * homepage, section 3). Hidden on the /top3 pages themselves, offline, while
 * the contest state is unknown, and once dismissed - but a dismissal only
 * lasts for the phase it was made in, so it comes back when voting opens etc.
 */

const DISMISS_KEY = "war:top3-bar-dismissed";

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISS_KEY);
  } catch {
    return null;
  }
}

export function Top3AnnouncementBar() {
  const { pathname } = useLocation();
  const online = useOnline();
  const { state, error } = useContestStateShared();
  const [dismissed, setDismissed] = useState(readDismissed);

  if (pathname.startsWith("/top3") || !online) return null;

  if (!state) {
    // Hold the bar's space while the state loads, so the page doesn't jump
    // down when it arrives - unless the visitor has dismissed it before (then
    // it most likely stays hidden) or the request failed.
    if (error || dismissed) return null;
    return <div className="t3bar t3bar-pending" aria-hidden="true" />;
  }

  const copy = copyFor(state);
  if (dismissed === copy.phase) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, copy.phase);
    } catch {
      // storage blocked: hidden for this visit only
    }
    setDismissed(copy.phase);
  };

  return (
    <div role="region" aria-label="Top 3 Creator Songs of 2026" className="t3bar">
      <div className="t3bar-inner">
        <IconTrophy size={18} className="t3bar-trophy" />
        <span className="t3bar-text">{copy.bar.text}</span>
        <Link to={copy.bar.to} className="t3bar-btn">
          {copy.bar.button}
          <IconArrow size={14} />
        </Link>
        <span className="t3bar-phone">
          Top 3 Creator Songs of 2026:{" "}
          <Link to={copy.bar.to}>
            <strong>{copy.bar.phoneLink}</strong>
          </Link>
        </span>
      </div>
      <button type="button" className="t3bar-close" aria-label="Dismiss" onClick={dismiss}>
        <IconClose size={16} />
      </button>
    </div>
  );
}
