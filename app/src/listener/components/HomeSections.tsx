import { Link, useNavigate } from "react-router-dom";
import { mediaUrl } from "../../api/client";
import { FavouriteButton } from "./FavouriteButton";
import { useActiveChannel } from "../context/ActiveChannelContext";
import { CHANNEL_LABELS } from "../lib/channelLabels";

// The sections below the channel grid on the landing page
// (handoff_landing_page_lower_half.md). The hero above them is deliberately
// untouched.

function formatDuration(seconds: number | null | undefined) {
  if (!seconds) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------- Featured album

export function FeaturedAlbumSection({ album, tracks }: { album: any; tracks: any[] }) {
  const preview = tracks.slice(0, 3);

  return (
    <section className="home-section">
      <div className="channels-heading-row">
        <h2>Featured Album</h2>
        <Link to="/albums" className="channels-see-all">
          Browse all albums &rarr;
        </Link>
      </div>

      <div className="fa-card">
        <div className="fa-art-wrap">
          <div className="fa-ring" aria-hidden="true" />
          <div className="fa-art">
            {album.artwork_url ? (
              <img src={mediaUrl(album.artwork_url)} alt={album.title} />
            ) : (
              <div className="fa-art-placeholder" />
            )}
            <div className="fa-shine" aria-hidden="true" />
          </div>
        </div>

        <div className="fa-body">
          <span className="fa-eyebrow">Featured album</span>
          <h3 className="fa-title">{album.title}</h3>
          {album.description && <p className="fa-desc">{album.description}</p>}

          <div className="fa-actions">
            <Link to={`/albums/${album.id}?autoplay=1`} className="pill-btn pill-btn-solid">
              <span className="play-triangle" />
              Play Album
            </Link>
            {/* The handoff asks for "Add to Playlist", but there's no playlist
                feature yet - Favourites is the closest thing that really
                exists, so this saves the album there rather than being a
                button that does nothing. */}
            <FavouriteButton
              itemType="album"
              itemId={album.id}
              label="Add to Favourites"
              className="pill-btn pill-btn-ghost"
            />
          </div>

          {preview.length > 0 && (
            <ol className="fa-tracks">
              {preview.map((t, i) => (
                <li key={t.id}>
                  <span className="fa-track-num">{i + 1}</span>
                  <span className="fa-track-title">{t.title}</span>
                  <span className="fa-track-dur">{formatDuration(t.duration_seconds)}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Podcasts

// One colour family per show, so the spotlight cards and the episode cards
// below read as the same identity. Amber is Friday Game Changers and blue is
// Let's Talk (the two secondary tints the page reserves for feature
// differentiation); any other show gets the next spare family.
type Family = { tint: string; soft: string; gradients: string[] };

const FAMILIES: Family[] = [
  {
    tint: "#f0a12a",
    soft: "rgba(240, 161, 42, 0.14)",
    gradients: [
      "linear-gradient(135deg, #7a5a12, #e1a82f 60%, #2a1f08)",
      "linear-gradient(135deg, #8a4a0c, #f0a12a 60%, #2a1806)",
      "linear-gradient(135deg, #8a2a12, #f0662a 60%, #2a0f08)",
    ],
  },
  {
    tint: "#3b8bf0",
    soft: "rgba(59, 139, 240, 0.14)",
    gradients: [
      "linear-gradient(135deg, #123a6b, #2f7de1 60%, #08142a)",
      "linear-gradient(135deg, #0f3f7a, #4aa3f5 60%, #071a30)",
      "linear-gradient(135deg, #1a2f6b, #5b7cf0 60%, #0a1230)",
    ],
  },
  {
    tint: "#e11d2e",
    soft: "rgba(225, 29, 46, 0.14)",
    gradients: [
      "linear-gradient(135deg, #7a1d24, #e11d2e 60%, #2a0a0c)",
      "linear-gradient(135deg, #6b1638, #d6336c 60%, #22081a)",
      "linear-gradient(135deg, #8a1c1c, #f0453a 60%, #2a0a0a)",
    ],
  },
  {
    tint: "#20b2aa",
    soft: "rgba(32, 178, 170, 0.14)",
    gradients: [
      "linear-gradient(135deg, #0f4c4a, #20b2aa 60%, #062322)",
      "linear-gradient(135deg, #0f4a37, #2fc28f 60%, #06231a)",
      "linear-gradient(135deg, #12474f, #2fb0c8 60%, #062026)",
    ],
  },
  {
    tint: "#8b5cf6",
    soft: "rgba(139, 92, 246, 0.14)",
    gradients: [
      "linear-gradient(135deg, #3b1f6b, #8b5cf6 60%, #140a2a)",
      "linear-gradient(135deg, #4a1f6b, #b45cf6 60%, #1a0a2a)",
      "linear-gradient(135deg, #2f2a6b, #6b6cf6 60%, #100e2a)",
    ],
  },
];

function familyIndexFor(showName: string): number | null {
  const n = showName.toLowerCase();
  if (/friday|game ?changer/.test(n)) return 0;
  if (/talk/.test(n)) return 1;
  return null;
}

// Stable across renders and new episodes: known shows by name, the rest in
// alphabetical order.
function familiesByShow(names: string[]): Map<string, Family> {
  const map = new Map<string, Family>();
  const others: string[] = [];
  for (const name of Array.from(new Set(names))) {
    const known = familyIndexFor(name);
    if (known !== null) map.set(name, FAMILIES[known]);
    else others.push(name);
  }
  others.sort().forEach((name, i) => map.set(name, FAMILIES[2 + (i % (FAMILIES.length - 2))]));
  return map;
}

function episodeLine(p: any) {
  return [
    p.episode_number != null ? `EP ${String(p.episode_number).padStart(2, "0")}` : null,
    p.duration_seconds ? `${Math.round(p.duration_seconds / 60)} min` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

const NEW_EPISODE_DAYS = 14;

function EqBars({ count, seed }: { count: number; seed: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, b) => (
        <span
          key={b}
          style={{
            animationDuration: `${0.9 + ((b + seed) % 5) * 0.2}s`,
            animationDelay: `${((b * 3 + seed) % 7) * 0.1}s`,
          }}
        />
      ))}
    </>
  );
}

export function PodcastShowcase({ shows, recent }: { shows: any[]; recent: any[] }) {
  const families = familiesByShow([...shows, ...recent].map((p) => p.show_name ?? ""));
  const familyOf = (p: any) => families.get(p.show_name ?? "") ?? FAMILIES[2];

  const spotlight = [...shows].sort((a, b) => FAMILIES.indexOf(familyOf(a)) - FAMILIES.indexOf(familyOf(b)));

  // The spotlight already features each show's latest episode, so the row
  // below is the "more" - the next most recent, still both shows merged.
  const spotlightIds = new Set(spotlight.map((p) => p.id));
  const more = recent.filter((p) => !spotlightIds.has(p.id)).slice(0, 4);

  const seenPerShow = new Map<string, number>();

  return (
    <section className="home-section">
      <div className="channels-heading-row">
        <h2>Podcasts</h2>
        <Link to="/podcasts" className="channels-see-all">
          All episodes &rarr;
        </Link>
      </div>

      {spotlight.length > 0 && (
        <div className="ps-row" style={spotlight.length === 1 ? { gridTemplateColumns: "1fr" } : undefined}>
          {spotlight.map((p, i) => {
            const f = familyOf(p);
            const isNew =
              Date.now() - new Date(p.publish_date ?? p.created_at).getTime() < NEW_EPISODE_DAYS * 86400000;
            return (
              <Link key={p.id} to={`/programmes/${p.id}?autoplay=1`} className="ps-card" style={tint(f.tint, f.soft)}>
                <span className="ps-pill">
                  <span className="wl-live-dot" />
                  {isNew ? "New Episode" : "On Air"}
                </span>
                <div className="ps-body">
                  <div className="ps-text">
                    <span className="ps-show">{p.show_name}</span>
                    <h3 className="ps-latest">
                      <span>Latest:</span> {p.title}
                    </h3>
                    <div className="ps-meta">
                      <span className="ps-eq" aria-hidden="true">
                        <EqBars count={5} seed={i} />
                      </span>
                      {episodeLine(p)}
                    </div>
                  </div>
                  <span className="ps-play" aria-label={`Play ${p.title}`}>
                    <span className="play-triangle" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {more.length > 0 && (
        <>
          <h3 className="home-subheading">More Recent Episodes</h3>
          <div className="pc-row">
            {more.map((p, i) => {
              const f = familyOf(p);
              const show = p.show_name ?? "";
              const nth = seenPerShow.get(show) ?? 0;
              seenPerShow.set(show, nth + 1);
              return (
                <Link key={p.id} to={`/programmes/${p.id}?autoplay=1`} className="pc-card">
                  <div className="pc-thumb" style={{ background: f.gradients[nth % f.gradients.length] }}>
                    {p.episode_number != null && (
                      <span className="pc-ep">EP {String(p.episode_number).padStart(2, "0")}</span>
                    )}
                    <span className="pc-play">
                      <span className="play-triangle" />
                    </span>
                    <div className="pc-wave" aria-hidden="true">
                      <EqBars count={30} seed={i} />
                    </div>
                  </div>
                  <div className="pc-title">{p.title}</div>
                  <div className="pc-meta">
                    {[p.show_name, p.duration_seconds ? `${Math.round(p.duration_seconds / 60)} min` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- Radio That Knows You

function tint(hex: string, soft: string) {
  return { ["--tint" as string]: hex, ["--tint-soft" as string]: soft } as React.CSSProperties;
}

// The same four needs the /my-mood page offers (worker/src/lib/needs.ts), fixed
// here so the buttons are on screen instantly rather than after a fetch.
// Tapping one hands its key to /my-mood, which runs the "Building your radio..."
// beat and plays the programme.
const KYU_NEEDS: { key: string; label: string; icon: React.ReactNode }[] = [
  {
    key: "energy",
    label: "I need energy",
    icon: <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />,
  },
  {
    key: "love",
    label: "I want to fall in love",
    icon: <path d="M12 20s-7.5-4.6-10-9.2C.5 7.4 2.2 4 5.8 4c2 0 3.6 1.1 4.2 2.7C10.6 5.1 12.2 4 14.2 4c3.6 0 5.3 3.4 3.8 6.8C15.5 15.4 12 20 12 20z" />,
  },
  {
    key: "switch-off",
    label: "I want to switch off",
    icon: <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />,
  },
  {
    key: "fun",
    label: "I want to have fun",
    icon: <path d="M12 3l2.2 5.3L20 10l-4.4 3.6L17 19l-5-3.2L7 19l1.4-5.4L4 10l5.8-1.7z" />,
  },
];

/** The flagship: pick a need on the homepage and the programme is built on /my-mood. */
export function RadioThatKnowsYou() {
  const navigate = useNavigate();

  return (
    <section className="home-section">
      <div className="kyu">
        <div className="kyu-shine" aria-hidden="true" />

        <div className="kyu-head">
          <span className="kyu-eyebrow">
            <span className="kyu-dot" />
            Radio That Knows You
          </span>
          <h2 className="kyu-tagline">Tell us what you need. We'll create the radio.</h2>
          <p className="kyu-context">
            Not a playlist. A produced radio programme, built for this moment, with your voice bridging every track.
          </p>
        </div>

        <div className="kyu-stage">
          <div className="kyu-wave" aria-hidden="true">
            <EqBars count={64} seed={3} />
          </div>
          <div className="kyu-needs">
            {KYU_NEEDS.map((n) => (
              <button
                key={n.key}
                type="button"
                className="kyu-need"
                onClick={() => navigate("/my-mood", { state: { need: n.key } })}
              >
                <span className="kyu-need-icon">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {n.icon}
                  </svg>
                </span>
                <span className="kyu-need-label">{n.label}</span>
              </button>
            ))}
          </div>
        </div>

        <Link to="/my-mood" className="kyu-classic">
          Prefer to choose an exact mood and length? &rarr;
        </Link>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Two other ways to listen

const RadioIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <rect x="3" y="9" width="18" height="11" rx="2.5" />
    <line x1="7" y1="9" x2="17" y2="4" />
    <circle cx="16.5" cy="14.5" r="2.4" />
    <line x1="6.5" y1="13" x2="11" y2="13" />
    <line x1="6.5" y1="16.5" x2="11" y2="16.5" />
  </svg>
);

const DialIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="12" x2="16" y2="7.5" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" />
    <line x1="12" y1="4.5" x2="12" y2="6" />
    <line x1="19.5" y1="12" x2="18" y2="12" />
    <line x1="4.5" y1="12" x2="6" y2="12" />
  </svg>
);

export function WaysToListen({ channels }: { channels: any[] }) {
  const { channelSlug, band } = useActiveChannel();
  // Real state, not decoration: how many live channels are actually running
  // in autopilot right now (the public channel list carries programming_mode).
  const autopilotCount = channels.filter((c) => c.programming_mode === "autopilot").length;

  return (
    <section className="home-section">
      <div className="channels-heading-row">
        <h2>Two Other Ways to Listen</h2>
      </div>

      <div className="wl-grid">
        <Link to="/my-radio" className="wl-card" style={tint("#f0a12a", "rgba(240, 161, 42, 0.14)")}>
          <span className="wl-icon">
            <RadioIcon />
          </span>
          <span className="wl-new">NEW</span>
          <h3 className="wl-title">My Radio</h3>
          <p className="wl-desc">Your station, always on - channels run themselves on autopilot, and your favourites and history live here.</p>
          <div className="wl-detail">
            {autopilotCount > 0 ? (
              <>
                <span className="wl-live-dot" />
                Autopilot engaged &middot; {autopilotCount} channel{autopilotCount === 1 ? "" : "s"}
              </>
            ) : (
              <>Sign in to keep your favourites</>
            )}
          </div>
        </Link>

        <button
          type="button"
          className="wl-card"
          style={tint("#3b8bf0", "rgba(59, 139, 240, 0.14)")}
          onClick={() => window.dispatchEvent(new Event("open-vibe-shift"))}
        >
          <span className="wl-icon">
            <DialIcon />
          </span>
          <span className="wl-new">NEW</span>
          <h3 className="wl-title">Vibe Shift</h3>
          <p className="wl-desc">The player tunes itself to the time of day - one tap to change the mood without missing a beat.</p>
          <div className="wl-detail">
            <span className="wl-live-dot" />
            Now: {CHANNEL_LABELS[channelSlug] ?? channelSlug} &middot; {band}
          </div>
        </button>
      </div>
    </section>
  );
}

const CapsuleIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="16" rx="2.5" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="3" x2="8" y2="7" />
    <line x1="16" y1="3" x2="16" y2="7" />
    <path d="M12 18.2s-3-1.9-3-4a1.7 1.7 0 0 1 3-1 1.7 1.7 0 0 1 3 1c0 2.1-3 4-3 4z" />
  </svg>
);

/** Invites listeners to ask for a message from Kizzi on a date that matters. */
export function TimeCapsuleBanner() {
  return (
    <section className="home-section">
      <Link to="/time-capsule" className="tcb" style={tint("#c084fc", "rgba(192, 132, 252, 0.14)")}>
        <span className="wl-icon">
          <CapsuleIcon />
        </span>
        <span className="tcb-body">
          <span className="tcb-eyebrow">Time Capsule</span>
          <span className="tcb-title">A message on the radio, on the day that matters</span>
          <span className="tcb-desc">
            A birthday, a get-well, an anniversary. Tell us who it's for and when, and Kizzi records a short message that goes
            out on We Are Radio on that date.
          </span>
        </span>
        <span className="tcb-cta">Request a time capsule &rarr;</span>
      </Link>
    </section>
  );
}
