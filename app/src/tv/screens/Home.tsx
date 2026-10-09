import { useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { FocusContext, setFocus, useFocusable } from "@noriginmedia/norigin-spatial-navigation";
import { mediaUrl } from "../../api/client";
import { channelAccent } from "../../listener/lib/channelAccent";
import { trackTv } from "../../shared/analytics";
import { ChannelStill, EqBars, Icon, OnAirPill, TvButton, TvClock } from "../components";
import { useTvPlayer, lastTvChannel } from "../TvPlayer";
import { clockText, loopFor, mmss, progressOf, stillFor, useNow, useTvData, type ChannelNow, type TvChannel } from "../tvData";
import { useTvUi } from "../tvUi";
import { useOnDemand, type OnDemandItem, type OnDemandQueue } from "../TvOnDemand";
import { useTvContent } from "../tvContent";
import { publicApi } from "../../api/client";
import { copyFor } from "../../listener/components/contest/phaseCopy";
import { currentTimeBand } from "../../listener/lib/timeOfDay";
import { countryFlag } from "../../shared/countries";

/** Screen 1: Home (handoff_tv_firetv.md §A4). */

const VIDEO_REST_MS = 600;
// Rows below the channels (9 Oct 2026): each is ROW_STEP below the last; moving down one slides it up into view.
const ROWS_TOP = 712;
const ROW_STEP = 266;
const FIRST_SCROLL = 300;
// A card and the gap after it. Five fit across; a row slides along once focus passes the fourth.
const CARD_STEP = 350;
const VISIBLE_BEFORE_SHIFT = 3;
const dur = (s?: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}` : "");

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

/** A card for one thing to play or open: a picture (or a coloured tile) with a title and a line under it. */
function MediaCard({
  focusKey,
  title,
  sub,
  image,
  tone,
  badge,
  big,
  onFocus,
  onPress,
}: {
  focusKey: string;
  title: string;
  sub?: string | null;
  image?: string | null;
  tone?: string;
  badge?: ReactNode;
  big?: ReactNode;
  onFocus: () => void;
  onPress: () => void;
}) {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onPress, onFocus: () => onFocus() });
  // A picture that won't load becomes the card's plain coloured tile.
  const [broken, setBroken] = useState(false);
  if (broken) image = null;
  return (
    <button
      ref={ref}
      type="button"
      tabIndex={-1}
      className={`tv-card tv-media${image ? "" : ` tv-tile is-${tone ?? "plain"}`}${focused ? " is-focused" : ""}`}
      onClick={onPress}
    >
      {image && <img className="tv-card-img" src={image} alt="" onError={() => setBroken(true)} />}
      {image && <span className="tv-card-scrim" />}
      {big && <span className="tv-media-big">{big}</span>}
      {badge && <span className="tv-media-badge">{badge}</span>}
      <span className="tv-card-text">
        <span className="tv-card-name">{title}</span>
        {sub ? <span className="tv-card-line">{sub}</span> : null}
      </span>
    </button>
  );
}

function Row({ focusKey, preferred, children, onFocusRow, shift = 0 }: { focusKey: string; preferred?: string; children: React.ReactNode; onFocusRow?: (on: boolean) => void; shift?: number }) {
  const { ref, focusKey: key, hasFocusedChild } = useFocusable({
    focusKey,
    saveLastFocusedChild: true,
    trackChildren: true,
    preferredChildFocusKey: preferred,
  });
  useEffect(() => onFocusRow?.(hasFocusedChild), [hasFocusedChild, onFocusRow]);
  return (
    <FocusContext.Provider value={key}>
      <div ref={ref} className="tv-row-items" style={shift ? { transform: `translateX(-${shift * CARD_STEP}px)` } : undefined}>
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
  // Which row has focus (0 = the channels, and the hero), and how far each row has slid along.
  const [row, setRow] = useState(0);
  const [cols, setCols] = useState<Record<string, number>>({});
  const moreFocused = row > 0;
  const setMoreFocused = (on: boolean) => {
    if (!on) setRow(0);
  };
  const od = useOnDemand();
  const content = useTvContent();
  const [busy, setBusy] = useState<string | null>(null);
  const focusAt = (rowIndex: number, rowKey: string, col: number) => {
    setRow(rowIndex);
    setCols((c) => (c[rowKey] === Math.max(0, col - VISIBLE_BEFORE_SHIFT) ? c : { ...c, [rowKey]: Math.max(0, col - VISIBLE_BEFORE_SHIFT) }));
  };
  const playNow = (q: OnDemandQueue, startIndex = 0) => {
    od.start(q, startIndex);
    navigate("/tv/play");
  };
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

  // ------------------------------------------------------------ the rows under the channels
  interface CardDef {
    key: string;
    title: string;
    sub?: string | null;
    image?: string | null;
    tone?: string;
    badge?: ReactNode;
    big?: ReactNode;
    onPress: () => void;
  }
  const extraRows: { key: string; title: string; cards: CardDef[] }[] = [];

  // Advertising For Good: OK plays the ad, then the radio carries on.
  if (content.good.length) {
    extraRows.push({
      key: "good",
      title: "Advertising For Good",
      cards: content.good.map((ad) => ({
        key: ad.id,
        title: ad.title,
        sub: dur(ad.duration_seconds),
        tone: "good",
        big: Icon.heart(true),
        onPress: () => playNow({ eyebrow: "Advertising For Good", kind: "good", items: [{ id: ad.id, title: ad.title, audio_url: ad.audio_url, duration_seconds: ad.duration_seconds, goodId: ad.id }] }),
      })),
    });
  }

  // Radio That Knows You: a mix built for the mood, as on the site.
  const playMood = async (need: { key: string; label: string }) => {
    setBusy("Building your radio…");
    try {
      const r = await publicApi.radioForYou(need.key, 12, currentTimeBand());
      const items: OnDemandItem[] = (r.items ?? [])
        .filter((i: any) => i.audio_url && i.duration_seconds > 0)
        .map((i: any, idx: number) => ({
          id: `${i.id}-${idx}`,
          title: i.label ?? (i.item_type === "link" ? "A word from Kizzi" : "We Are Radio"),
          subtitle: i.item_type === "link" ? "A word from Kizzi" : i.item_type === "song" ? null : "We Are Radio",
          audio_url: i.audio_url,
          duration_seconds: i.duration_seconds,
          artwork_url: i.artwork_url ?? null,
          analytics:
            i.item_type === "song" && i.track_id
              ? { contentType: "track" as const, contentId: i.track_id, mood: need.key, source: "radio-for-you" as const, wildcard: !!i.wildcard }
              : null,
        }));
      setBusy(null);
      if (items.length) playNow({ eyebrow: `Radio That Knows You · ${r.programme?.title ?? need.label}`, kind: "mood", items });
      else setBusy(r.message ?? "Nothing for that mood yet");
    } catch {
      setBusy("Couldn't build that just now");
    }
    window.setTimeout(() => setBusy(null), 2500);
  };
  if (content.needs.length) {
    extraRows.push({
      key: "mood",
      title: "Radio That Knows You",
      cards: content.needs.map((need) => ({
        key: need.key,
        title: need.label,
        sub: need.blurb,
        tone: `mood-${need.key}`,
        big: <span className="tv-media-emoji">{need.emoji}</span>,
        onPress: () => void playMood(need),
      })),
    });
  }

  // The featured album: play it from the top, or from any track.
  if (content.album) {
    const { album, tracks } = content.album;
    const items: OnDemandItem[] = tracks
      .filter((t: any) => t.audio_url)
      .map((t: any) => ({
        id: t.id,
        title: t.title,
        subtitle: t.artist ?? album.title,
        audio_url: t.audio_url,
        duration_seconds: t.duration_seconds,
        artwork_url: t.artwork_url ?? album.artwork_url ?? null,
        analytics: { contentType: "track" as const, contentId: t.id, source: "album" as const },
      }));
    const queue = { eyebrow: `From the album · ${album.title}`, kind: "album" as const, items };
    const cover = album.artwork_url ? mediaUrl(album.artwork_url) : null;
    if (items.length) {
      extraRows.push({
        key: "album",
        title: `The featured album · ${album.title}`,
        cards: [
          { key: "all", title: "Play the album", sub: `${items.length} songs`, image: cover, tone: "album", badge: Icon.play, onPress: () => playNow(queue, 0) },
          ...items.map((it, k) => ({
            key: it.id,
            title: it.title,
            sub: `${k + 1} · ${dur(it.duration_seconds)}`,
            image: it.artwork_url ? mediaUrl(it.artwork_url) : cover,
            tone: "album",
            onPress: () => playNow(queue, k),
          })),
        ],
      });
    }
  }

  // Top 3: what's happening (with a QR code to take part), then the songs in the running.
  if (content.contest) {
    const copy = copyFor(content.contest);
    const songs: OnDemandItem[] = content.entries
      .filter((e) => e.audio_url)
      .map((e) => ({
        id: `top3-${e.id}`,
        title: e.title,
        subtitle: `${e.creator_name} · ${countryFlag(e.country_code)}`,
        audio_url: e.audio_url,
        duration_seconds: e.duration_seconds,
        artwork_url: e.photo_url ?? null,
      }));
    const queue = { eyebrow: "Top 3 Creator Songs of 2026", kind: "top3" as const, items: songs };
    extraRows.push({
      key: "top3",
      title: "Top 3 Creator Songs of 2026",
      cards: [
        { key: "info", title: "Top 3 Creator Songs", sub: copy.eyebrow.charAt(0) + copy.eyebrow.slice(1).toLowerCase(), tone: "top3", onPress: () => navigate("/tv/top3") },
        ...songs.map((it, k) => ({
          key: it.id,
          title: it.title,
          sub: it.subtitle,
          image: it.artwork_url ? mediaUrl(it.artwork_url) : null,
          tone: "top3",
          onPress: () => playNow(queue, k),
        })),
      ],
    });
  }

  // Podcasts: the latest episodes.
  const playEpisode = async (p: any) => {
    setBusy("Loading the episode…");
    try {
      const r = await publicApi.programme(p.id);
      const items: OnDemandItem[] = (r.items ?? [])
        .map((i: any, idx: number) => ({
          id: `${p.id}-${idx}`,
          title: p.title,
          subtitle: p.show_name ?? "Podcast",
          audio_url: i.track_audio_url ?? i.audio_asset_audio_url,
          duration_seconds: i.track_duration_seconds ?? i.audio_asset_duration_seconds ?? p.duration_seconds,
          artwork_url: p.artwork_url ?? null,
          analytics: idx === 0 ? { contentType: "programme" as const, contentId: p.id, source: "programme" as const } : null,
        }))
        .filter((i: OnDemandItem) => !!i.audio_url);
      setBusy(null);
      if (items.length) playNow({ eyebrow: p.show_name ? `Podcast · ${p.show_name}` : "Podcast", kind: "podcast", items });
      else setBusy("That episode isn't available");
    } catch {
      setBusy("Couldn't load that just now");
    }
    window.setTimeout(() => setBusy(null), 2500);
  };
  if (content.podcasts.length) {
    extraRows.push({
      key: "podcasts",
      title: "Podcasts",
      cards: content.podcasts.slice(0, 12).map((p) => ({
        key: p.id,
        title: p.title,
        sub: [p.show_name, dur(p.duration_seconds)].filter(Boolean).join(" · "),
        image: p.artwork_url ? mediaUrl(p.artwork_url) : null,
        tone: "podcast",
        onPress: () => void playEpisode(p),
      })),
    });
  }

  // More from We Are Radio (as before, plus the Time Capsule).
  extraRows.push({
    key: "more",
    title: "More from We Are Radio",
    cards: [
      { key: "schedule", title: "What's on", sub: "The week on every channel", tone: "schedule", onPress: () => navigate("/tv/schedule") },
      { key: "shout", title: "Send a shout out", sub: "Record yours on your phone", tone: "shout", onPress: () => navigate("/tv/shout-out") },
      { key: "capsule", title: "Time Capsule", sub: "A message on the day that matters", tone: "capsule", onPress: () => navigate("/tv/time-capsule") },
      { key: "lean", title: "Lean back", sub: "Just the music, and the time", tone: "lean", onPress: () => ui.enterLeanBack() },
    ],
  });

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

        {/* Scrolled down the rows: a fade behind the logo and clock, so cards never run under them. */}
        <div className="tv-top-fade" aria-hidden="true" />
        <header className="tv-top">
          <img className="tv-logo" src="/weareradio-logo-hero.webp" alt="We Are Radio" />
          <TvClock />
        </header>

        <div className="tv-home-content" style={row > 0 ? { transform: `translateY(-${FIRST_SCROLL + (row - 1) * ROW_STEP}px)` } : undefined}>
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
                  {n?.good ? <span className="tv-good-pill">Advertising For Good</span> : "Now playing"} <EqBars />
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

          {extraRows.map((r, k) => (
            <section key={r.key} className="tv-row tv-more" aria-label={r.title} style={{ top: ROWS_TOP + (k + 1) * ROW_STEP }}>
              <h2 className="tv-row-title">{r.title}</h2>
              <Row focusKey={`tv-row-${r.key}`} shift={cols[r.key] ?? 0}>
                {r.cards.map(({ key, ...card }, c) => (
                  <MediaCard key={key} focusKey={`tv-${r.key}-${key}`} {...card} onFocus={() => focusAt(k + 1, r.key, c)} />
                ))}
              </Row>
            </section>
          ))}
        </div>
        {busy && (
          <div className="tv-toast" role="status">
            {busy}
          </div>
        )}
      </div>
    </FocusContext.Provider>
  );
}
