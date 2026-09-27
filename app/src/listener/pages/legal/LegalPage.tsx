import { useEffect } from "react";
import "./legal.css";

/** The shared layout for /legal and /privacy: one readable column of text. */
export function LegalPage({ eyebrow, title, docTitle, children }: { eyebrow?: string; title: string; docTitle: string; children: React.ReactNode }) {
  useEffect(() => {
    const prev = document.title;
    document.title = docTitle;
    return () => {
      document.title = prev;
    };
  }, [docTitle]);

  return (
    <article className="lgp">
      {eyebrow && <p className="lgp-eyebrow">{eyebrow}</p>}
      <h1 className="lgp-h1">{title}</h1>
      {children}
    </article>
  );
}
