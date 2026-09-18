import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { publicApi } from "../../api/client";
import { HeroBackdrop } from "../components/HeroBackdrop";
import { EyebrowPill } from "../components/BrandMark";

// The network was designed from day one with six channels total (see
// migrations/0001_init.sql) - only `live` ones are ever named to listeners,
// but the "+N more coming soon" tile needs a total to count down from
// without the public API exposing anything about the unlaunched ones.
const TOTAL_CHANNELS = 6;

const CHANNEL_THEME: Record<string, string> = {
  "kizzi-radio": "theme-kizzi-radio",
  "we-are-50s": "theme-we-are-50s",
};

function themeFor(slug: string) {
  return CHANNEL_THEME[slug] ?? "theme-default";
}

export function Home() {
  const [nowPlaying, setNowPlaying] = useState<any>(null);
  const [channels, setChannels] = useState<any[]>([]);

  useEffect(() => {
    publicApi.nowPlaying().then(setNowPlaying).catch(() => {});
    publicApi.channels().then((r) => setChannels(r.channels)).catch(() => {});
  }, []);

  const subhead = nowPlaying?.on_air
    ? `${nowPlaying.channel?.name} · ${nowPlaying.programme?.title}`
    : "Kizzi's personal radio network";

  const remaining = Math.max(0, TOTAL_CHANNELS - channels.length);

  return (
    <div>
      <section className="hero">
        <HeroBackdrop />
        <EyebrowPill label="On Air · Kizzi Radio" className="hero-eyebrow" />
        <h1 className="hero-logo">
          <img src="/weareradio-logo-hero.webp" alt="We Are Radio" />
        </h1>
        <p className="hero-subhead">{subhead}</p>
        <div className="hero-actions">
          <Link to="/listen" className="pill-btn pill-btn-solid">
            <span className="play-triangle" />
            Listen Now
          </Link>
          <a href="#channels" className="pill-btn pill-btn-ghost">
            Explore Channels
          </a>
        </div>
      </section>

      <section className="channels-section" id="channels">
        <div className="channels-heading-row">
          <h2>Explore Channels</h2>
          <Link to="/albums" className="channels-see-all">
            See all channels &rarr;
          </Link>
        </div>
        <div className="channel-grid">
          {channels.map((c) => (
            <Link key={c.id} to={`/listen?channel=${c.slug}`} className="channel-card">
              <div className={`channel-card-art ${themeFor(c.slug)}`}>
                <span className="live-pill">LIVE</span>
                {c.emoji ?? "📻"}
              </div>
              <div className="channel-card-body">
                <div className="channel-name">{c.name}</div>
                <div className="channel-desc">{c.description}</div>
              </div>
            </Link>
          ))}
          {remaining > 0 && (
            <div className="channels-more-tile">+{remaining} &mdash; More channels coming soon</div>
          )}
          {channels.length === 0 && remaining === 0 && (
            <div style={{ color: "var(--text-dim)" }}>No channels are live yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}
