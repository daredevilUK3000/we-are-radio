import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { publicApi, type BookAiring, type PublicBook } from "../../api/client";
import { BookCard } from "../components/book/BookSection";
import { monthName } from "../components/book/bookPreview";
import "../components/book/book.css";

/**
 * /books and /books/<slug> (Book of the Month, handoff §6.3): the current
 * book at the top, then every past month's book, newest first. Arriving on a
 * book's own link scrolls to it, but never plays it without a tap.
 */

const prefersReducedMotion = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function Books() {
  const { slug } = useParams();
  const [books, setBooks] = useState<PublicBook[] | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [nextAiring, setNextAiring] = useState<BookAiring | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    publicApi
      .books()
      .then((r) => {
        setBooks(r.books);
        setCurrentId(r.current_id);
        setNextAiring(r.next_airing);
      })
      .catch(() => setFailed(true));
  }, []);

  const target = slug && books ? books.find((b) => b.slug === slug) : undefined;
  useEffect(() => {
    const prev = document.title;
    document.title = target ? `${target.title} · Book of the Month · We Are Radio` : "Book of the Month · We Are Radio";
    return () => {
      document.title = prev;
    };
  }, [target]);

  // Once, when the books arrive: bring the shared book into view.
  const scrolled = useRef<string | null>(null);
  useEffect(() => {
    if (!target || scrolled.current === target.slug) return;
    scrolled.current = target.slug;
    document.getElementById(`book-${target.slug}`)?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "center" });
  }, [target]);

  const current = books?.find((b) => b.id === currentId) ?? null;
  const past = books?.filter((b) => b.id !== currentId) ?? [];

  return (
    <div className="books-page">
      <h1>Book of the Month</h1>
      <p className="books-intro">
        Each month one of Kizzi Nkwocha's books is the Book of the Month, with a five-minute radio feature that airs on We Are Radio all month. Listen
        to it here any time.
      </p>
      {failed && <p className="books-intro">The books couldn't be loaded. Check your connection and try again.</p>}
      {books && books.length === 0 && <p className="books-intro">The first Book of the Month is on its way.</p>}
      {current && (
        <BookCard
          book={current}
          source="books"
          eyebrow={`Book of the Month · ${monthName(current.month)}`}
          nextAiring={nextAiring}
          highlighted={target?.id === current.id}
        />
      )}
      {past.length > 0 && (
        <>
          <h2 className="books-past-heading">{current ? "Earlier Books of the Month" : "Books of the Month"}</h2>
          <ul className="books-list">
            {past.map((b) => (
              <li key={b.id}>
                <BookCard book={b} source="books" eyebrow={monthName(b.month, true)} headingLevel={3} highlighted={target?.id === b.id} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
