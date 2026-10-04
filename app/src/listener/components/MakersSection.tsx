import { trackOutbound } from "../../shared/analytics";
import "./makers.css";

/**
 * "From the makers of We Are Radio" (handoff_from_the_makers.md): three other
 * products by the same maker, on the landing page and in the footer. Each is
 * free to use with an optional paid upgrade, so the lines say "free quiz" /
 * "free to start", never "100% free". Not part of Advertising For Good, and
 * deliberately styled like "Two Other Ways to Listen" rather than AFG.
 *
 * Every link opens in a new tab, so the station keeps playing here. Nothing
 * is fetched from the other sites, so it renders offline too.
 */

export type MakerKey = "human-radio" | "personality-blueprint" | "purpose-dna";

const MicIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <line x1="12" y1="18" x2="12" y2="21" />
    <line x1="8.5" y1="21" x2="15.5" y2="21" />
  </svg>
);

const FingerprintIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M6.5 7.5a7 7 0 0 1 11.6 2.4" />
    <path d="M4.5 12.5a7.5 7.5 0 0 1 .7-3" />
    <path d="M8 19.5c-1.2-1.6-2-3.6-2-5.9a6 6 0 0 1 9.5-4.9" />
    <path d="M18.6 13.5c0 2.2-.4 4.2-1.2 6" />
    <path d="M12 12.5v1.3c0 2.4-.7 4.6-1.9 6.4" />
    <path d="M9 13.5a3 3 0 0 1 6 .3c0 2.4-.5 4.5-1.5 6.3" />
  </svg>
);

const CompassIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <polygon points="15.5 8.5 13.4 13.4 8.5 15.5 10.6 10.6 15.5 8.5" />
  </svg>
);

/** The three products: change a title, line or address here and both the cards and the footer follow. */
export const MAKERS: {
  key: MakerKey;
  title: string;
  line: string;
  url: string;
  icon: () => JSX.Element;
  tint: string;
  soft: string;
}[] = [
  {
    key: "human-radio",
    title: "The Human Radio",
    line: "Your turn at the mic. Broadcast for free.",
    url: "https://humanradio.app/",
    icon: MicIcon,
    // The amber, blue and purple already used by "Two Other Ways to Listen" and the Time Capsule banner.
    tint: "#f0a12a",
    soft: "rgba(240, 161, 42, 0.14)",
  },
  {
    key: "personality-blueprint",
    title: "Your Personality Blueprint",
    line: "Find out what makes you tick. Free quiz.",
    // Kizzi, 4 Oct 2026: the dreamhosters address for now; a custom domain may replace it.
    url: "https://yourpersonalityblueprint.dreamhosters.com/",
    icon: FingerprintIcon,
    tint: "#3b8bf0",
    soft: "rgba(59, 139, 240, 0.14)",
  },
  {
    key: "purpose-dna",
    title: "Your Purpose DNA",
    line: "Work out what you're here to do. Free to start.",
    url: "https://www.yourpurposedna.com/",
    icon: CompassIcon,
    tint: "#c084fc",
    soft: "rgba(192, 132, 252, 0.14)",
  },
];

// Fire TV devices (model codes start "AFT"): the Fire TV app never shows this
// page, but the TV's own web browser could, and there these links lead nowhere useful.
const onFireTv = typeof navigator !== "undefined" && /\bAFT[A-Z0-9]/.test(navigator.userAgent);

const tintStyle = (m: (typeof MAKERS)[number]) =>
  ({ ["--tint" as string]: m.tint, ["--tint-soft" as string]: m.soft }) as React.CSSProperties;

export function MakersSection() {
  if (onFireTv) return null;
  return (
    <section className="home-section" aria-labelledby="makers-heading">
      <div className="channels-heading-row">
        <h2 id="makers-heading">From the makers of We Are Radio</h2>
      </div>
      <div className="mk-grid">
        {MAKERS.map((m) => {
          const Icon = m.icon;
          return (
            <a
              key={m.key}
              href={m.url}
              target="_blank"
              rel="noopener"
              className="wl-card mk-card"
              style={tintStyle(m)}
              aria-label={`${m.title}: ${m.line} (opens in a new tab)`}
              onClick={() => trackOutbound(m.key, "card")}
            >
              <span className="wl-icon">
                <Icon />
              </span>
              <h3 className="wl-title">{m.title}</h3>
              <p className="wl-desc">{m.line}</p>
              <span className="mk-visit" aria-hidden="true">
                Visit →
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

/** Under the footer's own links: the same three, as plain text. */
export function MakersFooter() {
  if (onFireTv) return null;
  return (
    <div className="mk-footer">
      <span className="mk-footer-label" id="mk-footer-label">
        From the makers
      </span>
      <nav aria-labelledby="mk-footer-label">
        {MAKERS.map((m) => (
          <a
            key={m.key}
            href={m.url}
            target="_blank"
            rel="noopener"
            aria-label={`${m.title} (opens in a new tab)`}
            onClick={() => trackOutbound(m.key, "footer")}
          >
            {m.title}
          </a>
        ))}
      </nav>
    </div>
  );
}
