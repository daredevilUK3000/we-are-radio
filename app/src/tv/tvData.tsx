import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * TV data shared across screens (handoff_tv_firetv.md §A3): the live
 * channels, one /api/now-playing/all poll every 20 s (Home's only polling),
 * the clock, and the week's guide.
 */

const API = `${import.meta.env.VITE_API_ORIGIN ?? ""}/api`;

export interface TvChannel {
  id: string;
  slug: string;
  name: string;
  description: string | null;
}

export interface ChannelNow {
  slug: string;
  on_air: boolean;
  title: string | null;
  artist: string | null;
  artwork_url: string | null;
  item_type: string | null;
  position_seconds: number | null;
  duration_seconds: number | null;
  voice: { first_name: string; place: string; kind: string; for_name: string } | null;
  /** An Advertising For Good ad on air (slug null when it's hidden from the site). */
  good?: { slug: string | null } | null;
  block: { name: string; description: string; starts_at: number; ends_at: number } | null;
  next_block: { name: string; starts_at: number; ends_at?: number } | null;
  /** When this answer arrived (ms), so progress can advance locally between polls. */
  received_ms: number;
}

export interface GuideSlot {
  block_id: string | null;
  name: string;
  description: string;
  starts_at: number;
  ends_at: number;
  recurring: string | null;
  kind: "show" | "music" | "default";
}
export interface GuideChannel {
  slug: string;
  name: string;
  accent: string;
  slots: GuideSlot[];
}

interface TvData {
  channels: TvChannel[] | null;
  now: Record<string, ChannelNow>;
}

const Ctx = createContext<TvData>({ channels: null, now: {} });
export const useTvData = () => useContext(Ctx);

export function TvDataProvider({ children }: { children: ReactNode }) {
  const [channels, setChannels] = useState<TvChannel[] | null>(null);
  const [now, setNow] = useState<Record<string, ChannelNow>>({});

  useEffect(() => {
    let live = true;
    const loadChannels = () =>
      fetch(`${API}/channels`, { credentials: "include" })
        .then((r) => r.json())
        .then((r) => live && setChannels(r.channels))
        .catch(() => {});
    void loadChannels();
    const id = window.setInterval(loadChannels, 10 * 60_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let live = true;
    const poll = () =>
      fetch(`${API}/now-playing/all`, { credentials: "include" })
        .then((r) => r.json())
        .then((r) => {
          if (!live) return;
          const at = Date.now();
          setNow(Object.fromEntries((r.channels as ChannelNow[]).map((c) => [c.slug, { ...c, received_ms: at }])));
        })
        .catch(() => {});
    void poll();
    const id = window.setInterval(poll, 20_000);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, []);

  return <Ctx.Provider value={{ channels, now }}>{children}</Ctx.Provider>;
}

/** Ticks every `everyMs`; the TV's own local time. */
export function useNow(everyMs = 1000): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setT(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return t;
}

/** A channel's position now, advanced locally from the last poll. */
export function progressOf(c: ChannelNow | undefined, nowMs: number): { elapsed: number; total: number } | null {
  if (!c?.on_air || c.position_seconds == null || !c.duration_seconds) return null;
  const elapsed = Math.min(c.duration_seconds, c.position_seconds + (nowMs - c.received_ms) / 1000);
  return { elapsed, total: c.duration_seconds };
}

export function useGuide(days = 7): GuideChannel[] | null {
  const [guide, setGuide] = useState<GuideChannel[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${API}/guide?days=${days}`, { credentials: "include" })
      .then((r) => r.json())
      .then((r) => live && setGuide(r.channels))
      .catch(() => live && setGuide([]));
    return () => {
      live = false;
    };
  }, [days]);
  return guide;
}

export const stillFor = (slug: string) => `/channels/channel-${slug}.jpg`;
export const loopFor = (slug: string) => `/channels/channel-${slug}.mp4`;

const two = (n: number) => String(n).padStart(2, "0");
export const clockText = (ms: number) => {
  const d = new Date(ms);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
};
export const dateText = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
export const mmss = (s: number) => `${Math.floor(s / 60)}:${two(Math.floor(s % 60))}`;
