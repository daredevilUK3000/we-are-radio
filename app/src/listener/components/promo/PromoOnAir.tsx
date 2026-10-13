import { useOnline } from "../../../shared/offline";
import "./promo.css";

/**
 * House promos on air (handoff_house_promos.md): the books Kizzi publishes
 * and his platforms. When the item airing is one, now-playing carries
 * `promo` (from the Worker's enrichItems) and the players show the pill, the
 * title and a button to the promo's short link, which counts the click and
 * redirects (weareradio.app/go/<slug>). Amber, never the AFG green: promos
 * are not Advertising For Good. Same idea as GoodOnAir.tsx.
 */

/** now_playing.promo */
export interface PromoOnAirInfo {
  title: string;
  /** The label (migrations/0027): "We Are Radio recommends", or "Advertisement" for an ad. */
  pill?: string;
  link_url: string;
  link_label: string;
  short_url: string;
  cover_url: string | null;
}

export const PROMO_PILL_TEXT = "We Are Radio recommends";
export const pillText = (promo: { pill?: string } | null | undefined) => promo?.pill || PROMO_PILL_TEXT;

export const promoOf = (item: any): PromoOnAirInfo | null => (item?.promo?.short_url ? (item.promo as PromoOnAirInfo) : null);

export function PromoPill({ promo, small = false }: { promo: { pill?: string } | null | undefined; small?: boolean }) {
  return <span className={small ? "promo-pill promo-pill-small" : "promo-pill"}>{pillText(promo)}</span>;
}

/** Where the click came from, for the counts in Studio (the short link's ?s=). */
export type PromoClickSource = "player" | "jp" | "tv";

export const promoHref = (promo: PromoOnAirInfo, source: PromoClickSource) => `${promo.short_url}?s=${source}`;

/**
 * The promo's button: a real link that opens in a new tab, so the stream
 * keeps playing. Shown only online (a downloaded block still plays the promo).
 * `compact`: the now-playing bar, where it shrinks to an arrow on the
 * narrowest phones rather than push the play controls off screen.
 */
export function PromoButton({ promo, source, compact = false, className = "" }: { promo: PromoOnAirInfo; source: PromoClickSource; compact?: boolean; className?: string }) {
  const online = useOnline();
  if (!online) return null;
  return (
    <a
      className={`promo-btn${compact ? " promo-btn-compact" : ""} ${className}`}
      href={promoHref(promo, source)}
      target="_blank"
      rel="noopener"
      aria-label={`${promo.link_label}: ${promo.title} (opens in a new tab)`}
    >
      <span className="promo-btn-label">{promo.link_label}</span>
      <span className="promo-btn-arrow" aria-hidden="true">
        →
      </span>
    </a>
  );
}
