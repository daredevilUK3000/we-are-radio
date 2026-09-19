import { Link } from "react-router-dom";
import { mediaUrl } from "../../api/client";
import { FavouriteButton } from "./FavouriteButton";
import { useActiveChannel } from "../context/ActiveChannelContext";
import { CHANNEL_LABELS } from "../lib/channelLabels";

// The three sections below the channel grid on the landing page
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

// Nine gradients in three hue families. Each distinct show claims a family
// (in alphabetical order, so it's stable as new episodes arrive) and its
// episodes cycle through that family's three shades - so the row isn't
// monotone, but a show still reads as "the blue one" at a glance.
const GRADIENTS = [
  "linear-gradient(135deg, #7a1d24, #e11d2e 60%, #2a0a0c)",
  "linear-gradient(135deg, #8a2a12, #f0662a 60%, #2a0f08)",
  "linear-gradient(135deg, #6b1638, #d6336c 60%, #22081a)",
  "linear-gradient(135deg, #123a6b, #2f7de1 60%, #08142a)",
  "linear-gradient(135deg, #0f4c4a, #20b2aa 60%, #062322)",
  "linear-gradient(135deg, #3b1f6b, #8b5cf6 60%, #140a2a)",
  "linear-gradient(135deg, #7a5a12, #e1a82f 60%, #2a1f08)",
  "linear-gradient(135deg, #3f5a12, #8fc02f 60%, #141f08)",
  "linear-gradient(135deg, #5a3a12, #c98a3a 60%, #22160a)",
];

function gradientsFor(podcasts: any[]): string[] {
  const shows = Array.from(new Set(podcasts.map((p) => p.show_name ?? ""))).sort();
  const seenPerShow = new Map<string, number>();
  return podcasts.map((p) => {
    const show = p.show_name ?? "";
    const nth = seenPerShow.get(show) ?? 0;
    seenPerShow.set(show, nth + 1);
    return GRADIENTS[(shows.indexOf(show) * 3 + (nth % 3)) % GRADIENTS.length];
  });
}

export function PodcastShowcase({ podcasts }: { podcasts: any[] }) {
  const gradients = gradientsFor(podcasts);

  return (
    <section className="home-section">
      <div className="channels-heading-row">
        <h2>Podcasts</h2>
        <Link to="/podcasts" className="channels-see-all">
          All episodes &rarr;
        </Link>
      </div>

      <div className="pc-row">
        {podcasts.map((p, i) => (
          <Link key={p.id} to={`/programmes/${p.id}`} className="pc-card">
            <div className="pc-thumb" style={{ background: gradients[i] }}>
              {p.episode_number != null && <span className="pc-ep">EP {String(p.episode_number).padStart(2, "0")}</span>}
              <span className="pc-play">
                <span className="play-triangle" />
              </span>
              <div className="pc-wave" aria-hidden="true">
                {Array.from({ length: 30 }, (_, b) => (
                  <span
                    key={b}
                    style={{
                      animationDuration: `${0.9 + ((b + i) % 5) * 0.2}s`,
                      animationDelay: `${((b * 3 + i) % 7) * 0.1}s`,
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="pc-title">{p.title}</div>
            <div className="pc-meta">
              {[p.show_name, p.duration_seconds ? `${Math.round(p.duration_seconds / 60)} min` : null]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- Three ways to listen

function tint(hex: string, soft: string) {
  return { ["--tint" as string]: hex, ["--tint-soft" as string]: soft } as React.CSSProperties;
}

const MoodIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M8 14.5c1 1.6 2.4 2.5 4 2.5s3-.9 4-2.5" />
    <circle cx="9" cy="10" r="0.6" fill="currentColor" />
    <circle cx="15" cy="10" r="0.6" fill="currentColor" />
  </svg>
);

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
        <h2>Three Ways to Listen</h2>
      </div>

      <div className="wl-grid">
        <Link to="/my-mood" className="wl-card" style={tint("#e11d2e", "rgba(225, 29, 46, 0.14)")}>
          <span className="wl-icon">
            <MoodIcon />
          </span>
          <span className="wl-new">NEW</span>
          <h3 className="wl-title">My Mood</h3>
          <p className="wl-desc">Pick a mood and how long you've got - a produced running order, instantly. No account needed.</p>
          <div className="wl-detail">
            <span className="wl-chip">romantic</span>
            <span className="wl-chip">relaxing</span>
            <span className="wl-chip">upbeat</span>
          </div>
        </Link>

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
