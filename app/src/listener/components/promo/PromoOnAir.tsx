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
  /** A Book of the Month (now_playing.book, migrations/0028): shown as a promo is, in its own gold, with its author. */
  kind?: "book";
  author?: string;
}

export const PROMO_PILL_TEXT = "We Are Radio recommends";
export const BOOK_PILL_TEXT = "Book of the Month";
export const pillText = (promo: { pill?: string } | null | undefined) => promo?.pill || PROMO_PILL_TEXT;

/** now_playing.book in a promo's shape. A book with no shop link still gets its label, just no button. */
export const bookAsPromo = (book: any): PromoOnAirInfo | null =>
  book?.title
    ? {
        kind: "book",
        title: book.title,
        author: book.author,
        pill: BOOK_PILL_TEXT,
        link_url: book.buy_url ?? "",
        link_label: book.buy_label || "Get the book",
        short_url: book.buy_url ?? "",
        cover_url: book.cover_url ?? null,
      }
    : null;

export const promoOf = (item: any): PromoOnAirInfo | null => (item?.promo?.short_url ? (item.promo as PromoOnAirInfo) : bookAsPromo(item?.book));

const bookClass = (promo: { kind?: string } | null | undefined) => (promo?.kind === "book" ? " is-book" : "");

export function PromoPill({ promo, small = false }: { promo: { pill?: string; kind?: string } | null | undefined; small?: boolean }) {
  return <span className={`${small ? "promo-pill promo-pill-small" : "promo-pill"}${bookClass(promo)}`}>{pillText(promo)}</span>;
}

/** A book's author, under its title in the expanded player and on Listen. */
export function PromoByline({ promo }: { promo: PromoOnAirInfo }) {
  return promo.author ? <span className="promo-byline">by {promo.author}</span> : null;
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
  if (!online || !promo.short_url) return null;
  return (
    <a
      className={`promo-btn${compact ? " promo-btn-compact" : ""}${bookClass(promo)} ${className}`}
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
