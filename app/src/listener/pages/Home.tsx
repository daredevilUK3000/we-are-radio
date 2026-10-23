import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { publicApi } from "../../api/client";
import { HeroBackdrop } from "../components/HeroBackdrop";
import { InstallCard } from "../components/InstallCard";
import { ChannelRow } from "./Offline";
import { offlineSupported, useOfflineBlocks, useOnline } from "../../shared/offline";
import { EyebrowPill } from "../components/BrandMark";
import { useActiveChannel } from "../context/ActiveChannelContext";
import { channelLabel as labelFor } from "../lib/channelLabels";
import { channelAccent } from "../lib/channelAccent";
import { channelMediaUrl, rememberChannels, useChannelInfo } from "../../shared/channelInfo";
import { trackListenNow } from "../../shared/analytics";
import { Top3HeroButton, Top3HeroPill } from "../components/contest/Top3HeroPill";
import { Top3FeatureBand } from "../components/contest/Top3FeatureBand";
import { GoodHeroLine, GoodSection } from "../components/good/GoodSection";
import { MakersSection } from "../components/MakersSection";
import { BookSection } from "../components/book/BookSection";
import {
  FeaturedAlbumSection,
  PodcastShowcase,
  RadioThatKnowsYou,
  TimeCapsuleBanner,
  WaysToListen,
} from "../components/HomeSections";

// Only `live` channels are ever named to listeners; the "+N more coming soon"
// tile is a count of the ones being built, from the API (migrations/0029),
// which never says anything else about them.

// Looping clips that stand in for the old emoji on the channel cards (the
// channel's card_video, with its card_image as the still). A channel with
// neither falls back to its emoji on its own colour, so a newly launched
// channel still gets a card.

// Visitors who've asked their system for reduced motion get the still frame.
const prefersReducedMotion =
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// A card without a clip or still: its emoji on a glow of its own colour (grey when it has none).
const cardTint = (slug: string) => {
  const accent = channelAccent(slug);
  return { background: `radial-gradient(circle at 30% 20%, ${accent}66, #131316 75%)` };
};

export function Home() {
  const { channelSlug } = useActiveChannel();
  const [nowPlaying, setNowPlaying] = useState<any>(null);
  const [channels, setChannels] = useState<any[]>([]);
  const [comingSoon, setComingSoon] = useState(0);
  // "Now in: <city>" on the cards of channels whose songs are mostly about places.
  const [placeBySlug, setPlaceBySlug] = useState<Record<string, string>>({});
  useChannelInfo();
  const [featured, setFeatured] = useState<{ album: any; tracks: any[] } | null>(null);
  const [podcasts, setPodcasts] = useState<{ shows: any[]; recent: any[] } | null>(null);

  useEffect(() => {
    publicApi.nowPlaying(channelSlug).then(setNowPlaying).catch(() => {});
    publicApi
      .channels()
      .then((r) => {
        rememberChannels(r.channels);
        setChannels(r.channels);
        setComingSoon(r.coming_soon ?? 0);
      })
      .catch(() => {});
  }, [channelSlug]);

  // Independent of the active channel, so fetched once rather than on every
  // time-of-day / Vibe Shift change.
  useEffect(() => {
    publicApi.featuredAlbum().then(setFeatured).catch(() => {});
    publicApi.podcastShowcase().then(setPodcasts).catch(() => {});
  }, []);

  // Only while one of those cards is showing: the item on air on each channel, once a minute.
  const wantsPlaces = channels.some((c) => c.shows_places);
  useEffect(() => {
    if (!wantsPlaces) return;
    const load = () =>
      publicApi
        .nowPlayingAll()
        .then((r) =>
          setPlaceBySlug(Object.fromEntries(r.channels.filter((c) => c.item_type === "song" && c.place?.city).map((c) => [c.slug, c.place!.city])))
        )
        .catch(() => {});
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [wantsPlaces]);

  const channelLabel = labelFor(channelSlug) ?? "We Are Radio";
  const subhead = nowPlaying?.on_air
    ? `${nowPlaying.channel?.name} · ${nowPlaying.programme?.title}`
    : "Kizzi's personal radio network";

  const remaining = comingSoon;
  const liveChannel = channels.find((c) => c.slug === channelSlug);

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
        <div className="t3f-hero-row">
          <EyebrowPill label={`On Air · ${channelLabel}`} className="hero-eyebrow" />
          <Top3HeroPill />
        </div>
        <h1 className="hero-logo">
          <img src="/weareradio-logo-hero.webp" alt="We Are Radio" />
        </h1>
        <p className="hero-subhead">{subhead}</p>
        <div className="hero-actions">
          <Link to={`/listen?channel=${channelSlug}`} className="pill-btn pill-btn-solid" onClick={trackListenNow}>
            <span className="play-triangle" />
            Listen Now
          </Link>
          {/* Phones only: the gold Top 3 button, and Explore Channels as a text link under it. */}
          <Top3HeroButton />
          <a href="#channels" className="pill-btn pill-btn-ghost">
            Explore Channels
          </a>
          <a href="#channels" className="t3f-hero-explore">
            Explore channels ↓
          </a>
        </div>
        {/* Advertising For Good: one line under the buttons, down to its card. */}
        <GoodHeroLine />
      </section>

      <Top3FeatureBand />

      {/* Offline listening, straight under the hero so nobody has to go looking for it. */}
      {offlineSupported && liveChannel && (
        <section className="offline-promo" aria-labelledby="offline-promo-title">
          <div className="offline-promo-head">
            <span className="offline-promo-icon" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 4v11" />
                <path d="M7 11l5 5 5-5" />
                <path d="M5 20h14" />
              </svg>
            </span>
            <div>
              <h2 id="offline-promo-title">Listen offline</h2>
              <p>No signal? Download the next stretch of {liveChannel.name} and it keeps playing - on a plane, on the Underground, anywhere.</p>
            </div>
          </div>
          <OfflinePromoRow slug={liveChannel.slug} name={liveChannel.name} />
        </section>
      )}

      <InstallCard dismissible />

      <section className="channels-section" id="channels">
        <div className="channels-heading-row">
          <h2>Explore Channels</h2>
          <Link to="/albums" className="channels-see-all">
            See all channels &rarr;
          </Link>
        </div>
        <div className="channel-grid">
          {channels.map((c) => {
            const video = channelMediaUrl(c.card_video);
            const still = channelMediaUrl(c.card_image);
            const place = c.shows_places ? placeBySlug[c.slug] : undefined;
            return (
              <Link key={c.id} to={`/listen?channel=${c.slug}`} className="channel-card">
                <div className={`channel-card-art theme-default${video || still ? " has-video" : ""}`} style={video || still ? undefined : cardTint(c.slug)}>
                  {video && !prefersReducedMotion ? (
                    <video
                      className="channel-card-video"
                      data-slug={c.slug}
                      src={video}
                      poster={still ?? undefined}
                      autoPlay
                      muted
                      loop
                      playsInline
                      aria-hidden="true"
                    />
                  ) : (
                    still && <img className="channel-card-video" data-slug={c.slug} src={still} alt="" />
                  )}
                  <span className="live-pill">LIVE</span>
                  {!video && !still && (c.emoji ?? "📻")}
                </div>
                <div className="channel-card-body">
                  <div className="channel-name">{c.name}</div>
                  <div className="channel-desc">{place ? `Now in: ${place}` : c.description}</div>
                </div>
              </Link>
            );
          })}
          {remaining > 0 && (
            <div className="channels-more-tile">+{remaining} &mdash; More channels coming soon</div>
          )}
          {channels.length === 0 && remaining === 0 && (
            <div style={{ color: "var(--text-dim)" }}>No channels are live yet.</div>
          )}
        </div>
      </section>

      <GoodSection />

      <BookSection />

      <RadioThatKnowsYou />

      {featured?.album && <FeaturedAlbumSection album={featured.album} tracks={featured.tracks} />}
      {podcasts && podcasts.recent.length > 0 && <PodcastShowcase shows={podcasts.shows} recent={podcasts.recent} />}
      <WaysToListen channels={channels} />
      <TimeCapsuleBanner />
      <MakersSection />
    </div>
  );
}

// The Offline page's own download panel, for the Home page's "Listen offline" card.
function OfflinePromoRow({ slug, name }: { slug: string; name: string }) {
  const blocks = useOfflineBlocks();
  const online = useOnline();
  return (
    <ChannelRow
      slug={slug}
      name={name}
      block={blocks?.find((b) => b.channelSlug === slug)}
      online={online}
      highlight={false}
      withdrawn={false}
    />
  );
}
