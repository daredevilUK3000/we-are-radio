import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { publicApi } from "../../api/client";
import { HeroBackdrop } from "../components/HeroBackdrop";
import { EyebrowPill } from "../components/BrandMark";
import { useActiveChannel } from "../context/ActiveChannelContext";
import { CHANNEL_LABELS } from "../lib/channelLabels";
import { FeaturedAlbumSection, PodcastShowcase, TimeCapsuleBanner, WaysToListen } from "../components/HomeSections";

// The network was designed from day one with six channels total (see
// migrations/0001_init.sql) - only `live` ones are ever named to listeners,
// but the "+N more coming soon" tile needs a total to count down from
// without the public API exposing anything about the unlaunched ones.
const TOTAL_CHANNELS = 6;

const CHANNEL_THEME: Record<string, string> = {
  "kizzi-radio": "theme-kizzi-radio",
  "we-are-50s": "theme-we-are-50s",
};

// Looping clips that stand in for the old emoji on the channel cards
// (public/channels/channel-<slug>.mp4, with a still frame alongside). A
// channel without one falls back to its emoji, so a newly launched channel
// still gets a card.
const CHANNEL_VIDEOS = new Set(["kizzi-radio", "we-are-50s", "we-are-love", "we-are-after-dark"]);

// Visitors who've asked their system for reduced motion get the still frame.
const prefersReducedMotion =
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function themeFor(slug: string) {
  return CHANNEL_THEME[slug] ?? "theme-default";
}

export function Home() {
  const { channelSlug } = useActiveChannel();
  const [nowPlaying, setNowPlaying] = useState<any>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [featured, setFeatured] = useState<{ album: any; tracks: any[] } | null>(null);
  const [podcasts, setPodcasts] = useState<{ shows: any[]; recent: any[] } | null>(null);

  useEffect(() => {
    publicApi.nowPlaying(channelSlug).then(setNowPlaying).catch(() => {});
    publicApi.channels().then((r) => setChannels(r.channels)).catch(() => {});
  }, [channelSlug]);

  // Independent of the active channel, so fetched once rather than on every
  // time-of-day / Vibe Shift change.
  useEffect(() => {
    publicApi.featuredAlbum().then(setFeatured).catch(() => {});
    publicApi.podcastShowcase().then(setPodcasts).catch(() => {});
  }, []);

  const channelLabel = CHANNEL_LABELS[channelSlug] ?? "We Are Radio";
  const subhead = nowPlaying?.on_air
    ? `${nowPlaying.channel?.name} · ${nowPlaying.programme?.title}`
    : "Kizzi's personal radio network";

  const remaining = Math.max(0, TOTAL_CHANNELS - channels.length);

  return (
    <div>
      <section className="hero">
        <video
          className="hero-video"
          src="/hero-video.mp4"
          poster="/hero-video-poster.jpg"
          autoPlay
          muted
          loop
          playsInline
        />
        <div className="hero-scrim" aria-hidden="true" />
        <HeroBackdrop />
        <EyebrowPill label={`On Air · ${channelLabel}`} className="hero-eyebrow" />
        <h1 className="hero-logo">
          <img src="/weareradio-logo-hero.webp" alt="We Are Radio" />
        </h1>
        <p className="hero-subhead">{subhead}</p>
        <div className="hero-actions">
          <Link to={`/listen?channel=${channelSlug}`} className="pill-btn pill-btn-solid">
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
              <div className={`channel-card-art ${themeFor(c.slug)}${CHANNEL_VIDEOS.has(c.slug) ? " has-video" : ""}`}>
                {CHANNEL_VIDEOS.has(c.slug) &&
                  (prefersReducedMotion ? (
                    <img className="channel-card-video" data-slug={c.slug} src={`/channels/channel-${c.slug}.jpg`} alt="" />
                  ) : (
                    <video
                      className="channel-card-video"
                      data-slug={c.slug}
                      src={`/channels/channel-${c.slug}.mp4`}
                      poster={`/channels/channel-${c.slug}.jpg`}
                      autoPlay
                      muted
                      loop
                      playsInline
                      aria-hidden="true"
                    />
                  ))}
                <span className="live-pill">LIVE</span>
                {!CHANNEL_VIDEOS.has(c.slug) && (c.emoji ?? "📻")}
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

      {featured?.album && <FeaturedAlbumSection album={featured.album} tracks={featured.tracks} />}
      {podcasts && podcasts.recent.length > 0 && <PodcastShowcase shows={podcasts.shows} recent={podcasts.recent} />}
      <WaysToListen channels={channels} />
      <TimeCapsuleBanner />
    </div>
  );
}
