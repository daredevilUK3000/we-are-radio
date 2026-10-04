import { Link } from "react-router-dom";
import { GoodFooterLink } from "./good/GoodSection";
import { MakersFooter } from "./MakersSection";

/** The footer on every listener page (ListenerLayout). The Studio has none. */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <img src="/weareradio-logo.webp" alt="We Are Radio" width={63} height={28} loading="lazy" />
          <span>Music · Talk · Real people</span>
        </div>
        <nav aria-label="Footer">
          <GoodFooterLink />
          <Link to="/on-air">Send a shout out</Link>
          <Link to="/contact">Contact</Link>
          <Link to="/top3/rules">Top 3 rules</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/legal">Legal notice</Link>
        </nav>
      </div>
      <MakersFooter />
    </footer>
  );
}
