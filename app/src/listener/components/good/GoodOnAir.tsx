import { Link } from "react-router-dom";
import { HeartIcon } from "./GoodSection";
import "./good.css";

/**
 * Advertising For Good on air (handoff_advertising_for_good.md, Phase 2):
 * when the item airing is an AFG ad, now-playing carries `good` (from the
 * Worker's enrichItems), and the players show it in the AFG green instead of
 * as a plain title. Same idea as the "Listener voice" pill (onair/voice.tsx).
 */

/** now_playing.good: slug is null when the ad is hidden from the site (labelled, but no link). */
export interface GoodOnAirInfo {
  slug: string | null;
}

export const isGood = (item: any): boolean => !!item?.good;

export function GoodOnAirPill({ small = false }: { small?: boolean }) {
  return (
    <span className={small ? "afg-pill afg-pill-small" : "afg-pill"}>
      <HeartIcon size={small ? 9 : 11} />
      Advertising For Good
    </span>
  );
}

/** The ad's title: a link to it on /good when it's on the site. */
export function GoodOnAirTitle({ item, onNavigate }: { item: any; onNavigate?: () => void }) {
  const title = item?.label ?? "Advertising For Good";
  const slug: string | null | undefined = item?.good?.slug;
  if (!slug) return <>{title}</>;
  return (
    <Link to={`/good/${slug}`} className="afg-onair-link" onClick={onNavigate}>
      {title}
    </Link>
  );
}

export const GOOD_ON_AIR_SUB = "A short message that asks you to be kind, not to buy";
