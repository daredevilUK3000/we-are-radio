import { useState } from "react";
import { Link } from "react-router-dom";
import { REPLY_DAYS } from "./topics";

const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "Can I request a song?",
    a: "Yes. Choose the Requests line and tell us the song and who it's for. We can't promise every request, but we read them all, and dedications with a story behind them have the best chance.",
  },
  {
    q: "How quickly will I hear back?",
    a: `Every message is read in the studio. If you've asked a question, we aim to reply by email within ${REPLY_DAYS} working days.`,
  },
  {
    q: "I've entered the Top 3. Where do I ask about my entry?",
    a: (
      <>
        Choose the Top 3 line and include your song number if you have one. Most questions about eligibility, dates and voting are answered in
        the <Link to="/top3/rules">official rules</Link>.
      </>
    ),
  },
  {
    q: "Will you read my message on air?",
    a: "Only if you tick the box, and only ever with your first name. Leave it unticked and your message stays between you and the studio.",
  },
];

export function ContactFaq() {
  // The first answer starts open, except on a phone where every one starts closed.
  const [open, setOpen] = useState<Set<number>>(() =>
    typeof window !== "undefined" && window.matchMedia?.("(max-width: 767px)").matches ? new Set() : new Set([0])
  );
  const toggle = (i: number) =>
    setOpen((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section className="c3p-faq" aria-labelledby="c3p-faq-h">
      <div className="c3p-faq-intro">
        <p className="c3p-eyebrow">Quick answers</p>
        <h2 id="c3p-faq-h" className="c3p-h2 c3p-h2-faq">
          Before you pick up the line
        </h2>
      </div>
      <div className="c3p-faq-list">
        {FAQ.map((item, i) => {
          const isOpen = open.has(i);
          return (
            <div key={item.q} className={`c3p-faq-item${isOpen ? " is-open" : ""}`}>
              <h3 className="c3p-faq-q">
                <button type="button" aria-expanded={isOpen} aria-controls={`c3p-faq-a-${i}`} id={`c3p-faq-q-${i}`} onClick={() => toggle(i)}>
                  <span>{item.q}</span>
                  <span className="c3p-faq-toggle" aria-hidden="true" />
                </button>
              </h3>
              <div id={`c3p-faq-a-${i}`} className="c3p-faq-a" role="region" aria-labelledby={`c3p-faq-q-${i}`}>
                <div className="c3p-faq-a-inner">
                  <p>{item.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
