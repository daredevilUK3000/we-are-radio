import { Link } from "react-router-dom";
import { mediaUrl, type BookAiring, type PublicBook } from "../../../api/client";
import { useOnline } from "../../../shared/offline";
import { clock, monthName, toggleBook, useBookPreview, useCurrentBook, whenOnAir } from "./bookPreview";
import "./book.css";

/**
 * Book of the Month on the landing page (after Advertising For Good) and on
 * /books (handoff 14 Oct 2026, §6). Gold, to match its blocks on the
 * Timeline: not the AFG green, the promo amber or the Top 3 gold. Renders
 * nothing until this month's book has its airings published.
 */

function PlayPauseIcon({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" />
    </svg>
  );
}

/** Listen now: the segment on demand. Hidden offline, and when the segment's audio is off. */
function ListenButton({ book, source }: { book: PublicBook; source: "page" | "books" }) {
  const online = useOnline();
  const preview = useBookPreview();
  if (!online || !book.audio_url) return null;
  const mine = preview.id === book.id;
  const playing = mine && preview.playing;
  const length = (mine && preview.duration) || book.duration_seconds || 0;
  const started = mine && (playing || preview.current > 0);
  const pct = started && length ? Math.min(1, preview.current / length) : 0;
  return (
    <button type="button" className="botm-listen" aria-label={`${playing ? "Pause" : "Listen now"}: ${book.title}`} onClick={() => toggleBook(book, source)}>
      <PlayPauseIcon playing={playing} />
      <span>{playing ? "Pause" : started ? "Carry on listening" : "Listen now"}</span>
      {length > 0 && <span className="botm-listen-time">{started ? `${clock(preview.current)} / ${clock(length)}` : clock(length)}</span>}
      <span className="botm-listen-progress" aria-hidden="true" style={{ width: `${pct * 100}%` }} />
    </button>
  );
}

/** One book: cover, title, author, blurb, Listen now and Get the book. */
export function BookCard({
  book,
  source,
  eyebrow,
  nextAiring,
  headingLevel = 2,
  footer,
  highlighted = false,
}: {
  book: PublicBook;
  source: "page" | "books";
  eyebrow: string;
  nextAiring?: BookAiring | null;
  headingLevel?: 2 | 3;
  footer?: React.ReactNode;
  highlighted?: boolean;
}) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const headingId = `botm-${book.slug}-title`;
  return (
    <article className={highlighted ? "botm-card is-highlighted" : "botm-card"} id={`book-${book.slug}`} aria-labelledby={headingId}>
      {book.cover_url ? (
        <img className="botm-cover" src={mediaUrl(book.cover_url)} alt={`${book.title} by ${book.author}, book cover`} loading="lazy" />
      ) : (
        <div className="botm-cover botm-cover-blank" aria-hidden="true" />
      )}
      <div className="botm-copy">
        <span className="botm-eyebrow">{eyebrow}</span>
        <Heading id={headingId} className="botm-title">
          {book.title}
        </Heading>
        <div className="botm-author">by {book.author}</div>
        {book.blurb && <p className="botm-blurb">{book.blurb}</p>}
        <div className="botm-actions">
          <ListenButton book={book} source={source} />
          {book.buy_url && (
            <a className="botm-buy" href={`${book.buy_url}?s=${source === "page" ? "pg" : "bk"}`} target="_blank" rel="noopener" aria-label={`${book.buy_label}: ${book.title} (opens in a new tab)`}>
              {book.buy_label} <span aria-hidden="true">→</span>
            </a>
          )}
        </div>
        {nextAiring && (
          <p className="botm-next">
            Next on air {whenOnAir(nextAiring.starts_at)} on {nextAiring.channel_name}
          </p>
        )}
        {footer}
      </div>
    </article>
  );
}

/** The landing page card: after Advertising For Good, before Radio That Knows You. */
export function BookSection() {
  const data = useCurrentBook();
  if (!data) return null;
  const { book, more } = data;
  return (
    <section className="home-section" id="book-of-the-month" aria-label="Book of the Month">
      <BookCard
        book={book}
        source="page"
        eyebrow={`Book of the Month · ${monthName(book.month)}`}
        nextAiring={book.next_airing}
        footer={
          more ? (
            <Link to="/books" className="botm-more">
              More Books of the Month →
            </Link>
          ) : null
        }
      />
    </section>
  );
}

/** The footer link, once there's a book to see. */
export function BookFooterLink() {
  const data = useCurrentBook();
  if (!data) return null;
  return <Link to="/books">Book of the Month</Link>;
}
