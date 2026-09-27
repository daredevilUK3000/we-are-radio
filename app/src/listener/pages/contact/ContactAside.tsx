import { Link } from "react-router-dom";
import { useCopyEmail } from "./useCopy";
import { CONTACT_EMAIL, REPLY_DAYS } from "./topics";
import { IconArrow, IconCopy, IconMic, IconTrophy } from "./icons";

export function ContactAside() {
  const { copied, copyOrMail } = useCopyEmail(CONTACT_EMAIL);

  return (
    <aside className="c3p-aside" aria-label="Other ways to reach us">
      <div className="c3p-card c3p-aside-email">
        <p className="c3p-eyebrow c3p-eyebrow-dim">Prefer email?</p>
        <p className="c3p-aside-address">{CONTACT_EMAIL}</p>
        <button type="button" className="c3p-btn c3p-btn-ghost c3p-btn-sm" onClick={() => void copyOrMail()}>
          <IconCopy />
          {copied ? "Copied" : "Copy address"}
        </button>
        <span className="c3p-sr" role="status">
          {copied ? "Email address copied" : ""}
        </span>
      </div>

      <div className="c3p-card c3p-next">
        <p className="c3p-eyebrow c3p-eyebrow-dim">What happens next</p>
        <ol>
          <li>
            <span className="c3p-next-num">1</span>
            <span>Your message lands on the studio desk straight away, and you get a confirmation by email.</span>
          </li>
          <li>
            <span className="c3p-next-num">2</span>
            <span>
              We read every one. Questions get a reply within <strong>{REPLY_DAYS} working days</strong>.
            </span>
          </li>
          <li>
            <span className="c3p-next-num is-gold">3</span>
            <span>Ticked "read it on air"? Keep listening. You might hear your name.</span>
          </li>
        </ol>
      </div>

      <Link to="/top3/rules" className="c3p-card c3p-link-card is-gold">
        <span className="c3p-link-tile">
          <IconTrophy size={22} />
        </span>
        <span className="c3p-link-body">
          <span className="c3p-link-title">About the Top 3 competition?</span>
          <span className="c3p-link-text">Most answers are in the official rules</span>
        </span>
        <IconArrow className="c3p-link-arrow" />
      </Link>

      <Link to="/podcasts" className="c3p-card c3p-link-card">
        <span className="c3p-link-tile">
          <IconMic size={22} />
        </span>
        <span className="c3p-link-body">
          <span className="c3p-link-title">Kizzi's Friday Game Changers</span>
          <span className="c3p-link-text">The podcast, every Friday</span>
        </span>
        <IconArrow className="c3p-link-arrow" />
      </Link>
    </aside>
  );
}
