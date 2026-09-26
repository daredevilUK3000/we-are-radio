import { Link } from "react-router-dom";
import { useOnline } from "../../../shared/offline";
import { useContestStateShared } from "./common";
import { copyFor, type PhaseCopy } from "./phaseCopy";
import { IconArrow, IconTrophy } from "./enter/icons";
import "./top3-feature.css";

/**
 * The homepage hero's gold Top 3 link (handoff: Top 3 on the homepage,
 * section 5): a pill beside "On Air" on wider screens, a full-width button
 * under Listen Now on phones. Both render nothing offline or while the
 * contest state is unknown. They can't be dismissed.
 */

function useHeroCopy(): PhaseCopy | null {
  const online = useOnline();
  const { state } = useContestStateShared();
  return online && state ? copyFor(state) : null;
}

export function Top3HeroPill() {
  const copy = useHeroCopy();
  if (!copy) return null;
  return (
    <Link to="/top3" className="t3f-hero-pill">
      <IconTrophy size={14} />
      <span>
        TOP 3 CREATOR SONGS OF 2026<span className="t3f-hero-pill-suffix"> · {copy.pillSuffix}</span>
      </span>
      <span className="t3f-hero-pill-go">
        <IconArrow size={12} />
      </span>
    </Link>
  );
}

/** Phones only (the stylesheet hides it from 640 px up). */
export function Top3HeroButton() {
  const online = useOnline();
  const { state, error } = useContestStateShared();
  // Hold its place while the state loads, so Explore channels and everything under the hero don't jump.
  if (online && !state && !error) return <span className="t3f-hero-btn is-pending" aria-hidden="true" />;
  const copy = online && state ? copyFor(state) : null;
  if (!copy) return null;
  return (
    <Link to="/top3" className="t3f-hero-btn">
      <IconTrophy size={16} />
      TOP 3 CREATOR SONGS · {copy.pillSuffix}
    </Link>
  );
}
