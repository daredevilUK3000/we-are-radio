import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { mediaUrl } from "../../api/client";
import { channelAccent } from "../../listener/lib/channelAccent";
import { trackTv } from "../../shared/analytics";
import { ChannelStill, EqBars, Icon, OnAirPill, TvButton, TvClock } from "../components";
import { useTvPlayer, lastTvChannel } from "../TvPlayer";
import { clockText, loopFor, mmss, progressOf, stillFor, useNow, useTvData, type ChannelNow, type TvChannel } from "../tvData";
import { useTvUi } from "../tvUi";

/** Screen 1: Home (handoff_tv_firetv.md §A4). */

const VIDEO_REST_MS = 600;

function ChannelCard({ ch, now, onFocus, onPress }: { ch: TvChannel; now: ChannelNow | undefined; onFocus: () => void; onPress: () => void }) {
  const { ref, focused } = useFocusable({ focusKey: `ch-${ch.slug}`, onEnterPress: onPress, onFocus: () => onFocus() });
  const line = [now?.title, now?.artist].filter(Boolean).join(" · ");
  return (
    <button ref={ref} type="button" tabIndex={-1} className={`tv-card${focused ? " is-focused" : ""}`} onClick={onPress}>
      <ChannelStill slug={ch.slug} className="tv-card-img" />
      <span className="tv-card-scrim" />
      {focused && (
        <span className="tv-live-chip">
          <EqBars /> Live
        </span>
      )}
      <span className="tv-card-text">
        <span className="tv-card-accent" style={{ background: channelAccent(ch.slug) }} />
        <span className="tv-card-name">{ch.name}</span>
        <span className="tv-card-line">{line || " "}</span>
      </span>
    </button>
  );
}

function MoreTile({ focusKey, title, sub, onPress, tone, onFocus }: { focusKey: string; title: string; sub: string; onPress: () => void; tone: string; onFocus: () => void }) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onPress, onFocus: () => onFocus() });
  return (
    <button ref={ref} type="button" tabIndex={-1} className={`tv-card tv-tile is-${tone}${focused ? " is-focused" : ""}`} onClick={onPress}>
      <span className="tv-tile-title">{title}</span>
      <span className="tv-tile-sub">{sub}</span>
    </button>
  );
}

function Row({ focusKey, preferred, children, onFocusRow }: { focusKey: string; preferred?: string; children: React.ReactNode; onFocusRow?: (on: boolean) => void }) {
  const { ref, focusKey: key, hasFocusedChild } = useFocusable({
    focusKey,
    saveLastFocusedChild: true,
    trackChildren: true,
    preferredChildFocusKey: preferred,
  });
  useEffect(() => onFocusRow?.(hasFocusedChild), [hasFocusedChild, onFocusRow]);
  return (
    <FocusContext.Provider value={key}>
      <div ref={ref} className="tv-row-items">
        {children}
      </div>
    </FocusContext.Provider>
  );
}

export function Home() {
  const navigate = useNavigate();
  const player = useTvPlayer();
  const ui = useTvUi();
  const { channels, now } = useTvData();
  const nowMs = useNow(1000);
  const [heroSlug, setHeroSlug] = useState<string | null>(() => lastTvChannel());
  const [videoSlug, setVideoSlug] = useState<string | null>(null);
  const [moreFocused, setMoreFocused] = useState(false);
  const { ref, focusKey } = useFocusable({ focusKey: "tv-home", trackChildren: true });

  // The channel shown: the focused card's (or the last used, or the first).
  const live = channels ?? [];
  const hero = live.find((c) => c.slug === heroSlug) ?? live.find((c) => c.slug === player.slug) ?? live[0] ?? null;

  // Launch focus: Listen, with the last channel waiting in the row.
  useEffect(() => {
    if (!channels) return;
    const t = window.setTimeout(() => setFocus("tv-listen"), 50);
    return () => window.clearTimeout(t);
  }, [channels]);

  // The hero's video loop follows focus only after it rests (no flicker while scrolling).
  useEffect(() => {
    if (!hero) return;
    const t = window.setTimeout(() => setVideoSlug(hero.slug), VIDEO_REST_MS);
    return () => window.clearTimeout(t);
  }, [hero?.slug]);

  const listen = (slug: string) => {
    if (slug !== player.slug) trackTv("tv_channel_change", null);
    player.tune(slug, { play: true });
    navigate(`/tv/listen/${slug}`);
  };

  if (!hero) {
    return (
      <div className="tv-screen tv-home">
        <div className="tv-loading">
          <img src="/weareradio-logo-hero.webp" alt="We Are Radio" />
        </div>
      </div>
    );
  }

  const n = now[hero.slug];
  const prog = progressOf(n, nowMs);
  const blockLine = n?.block ? `${n.block.name} · ${clockText(n.block.starts_at * 1000)}–${clockText(n.block.ends_at * 1000)}` : hero.description ?? "";

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={`tv-screen tv-home${moreFocused ? " is-more" : ""}`}>
        <div className="tv-bg">
          <img key={`still-${hero.slug}`} className="tv-bg-media tv-fade" src={stillFor(hero.slug)} alt="" />
          {videoSlug === hero.slug && !ui.stillsOnly && (
            <video
              key={`video-${hero.slug}`}
              className="tv-bg-media tv-fade"
              src={loopFor(hero.slug)}
              poster={stillFor(hero.slug)}
              muted
              autoPlay
              loop
              playsInline
              onLoadedData={ui.videoLoaded}
            />
          )}
          <div className="tv-scrim-left" />
          <div className="tv-scrim-bottom" />
        </div>

        <header className="tv-top">
          <img className="tv-logo" src="/weareradio-logo-hero.webp" alt="We Are Radio" />
          <TvClock />
        </header>

        <div className="tv-home-content">
          <section className="tv-hero">
            <div className="tv-hero-eyebrow">
              <OnAirPill />
              <span className="tv-hero-block">{blockLine}</span>
            </div>
            {/* One line always: long names ("We Are Instrumental") step down from 128 px so the buttons keep their place. */}
            <h1 className="tv-hero-name" style={{ fontSize: hero.name.length > 16 ? 92 : hero.name.length > 12 ? 110 : 128 }}>
              {hero.name}
            </h1>
            {hero.description && <p className="tv-hero-desc">{hero.description}</p>}
            <div className="tv-np-card">
              <div className="tv-np-art">
                {n?.artwork_url ? <img src={mediaUrl(n.artwork_url)} alt="" /> : <ChannelStill slug={hero.slug} />}
              </div>
              <div className="tv-np-text">
                <div className="tv-np-eyebrow">
                  Now playing <EqBars />
                </div>
                <div className="tv-np-title">{n?.voice ? `${n.voice.first_name}${n.voice.place ? ` in ${n.voice.place}` : ""}` : (n?.title ?? hero.name)}</div>
                <div className="tv-np-artist">{n?.voice ? "Listener voice" : (n?.artist ?? " ")}</div>
                {prog && (
                  <div className="tv-np-progress">
                    <span>{mmss(prog.elapsed)}</span>
                    <span className="tv-bar">
                      <i style={{ width: `${(prog.elapsed / prog.total) * 100}%` }} />
                    </span>
                    <span>{mmss(prog.total)}</span>
                  </div>
                )}
              </div>
            </div>
            {n?.next_block && (
              <div className="tv-coming">
                {Icon.clock} Coming up at {clockText(n.next_block.starts_at * 1000)} · {n.next_block.name}
              </div>
            )}
            <div className="tv-hero-buttons">
              <TvButton focusKey="tv-listen" primary onPress={() => listen(hero.slug)} onFocus={() => setMoreFocused(false)}>
                {Icon.play} Listen
              </TvButton>
              <TvButton focusKey="tv-schedule-btn" onPress={() => navigate("/tv/schedule")} onFocus={() => setMoreFocused(false)}>
                Schedule
              </TvButton>
            </div>
          </section>

          <section className="tv-row tv-channels" aria-label="Channels">
            <h2 className="tv-row-title">Channels</h2>
            <Row focusKey="tv-channels" preferred={`ch-${lastTvChannel() ?? hero.slug}`}>
              {live.map((ch) => (
                <ChannelCard
                  key={ch.slug}
                  ch={ch}
                  now={now[ch.slug]}
                  onFocus={() => {
                    setHeroSlug(ch.slug);
                    setMoreFocused(false);
                  }}
                  onPress={() => listen(ch.slug)}
                />
              ))}
            </Row>
          </section>

          <section className="tv-row tv-more" aria-label="More from We Are Radio">
            <h2 className="tv-row-title">More from We Are Radio</h2>
            <Row focusKey="tv-more-row">
              <MoreTile focusKey="tile-schedule" tone="schedule" title="What's on" sub="The week on every channel" onPress={() => navigate("/tv/schedule")} onFocus={() => setMoreFocused(true)} />
              <MoreTile focusKey="tile-shout" tone="shout" title="Send a shout out" sub="Record yours on your phone" onPress={() => navigate("/tv/shout-out")} onFocus={() => setMoreFocused(true)} />
              <MoreTile focusKey="tile-lean" tone="lean" title="Lean back" sub="Just the music, and the time" onPress={() => ui.enterLeanBack()} onFocus={() => setMoreFocused(true)} />
            </Row>
          </section>
        </div>
      </div>
    </FocusContext.Provider>
  );
}
