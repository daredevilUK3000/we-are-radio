import { useSyncExternalStore } from "react";
import { mediaUrl } from "../api/client";

/**
 * Each live channel's look and name, from its row (migrations/0029) rather
 * than lists per slug in the app, so a channel made in the Studio looks
 * finished the moment it goes live. Whoever fetches /api/channels passes the
 * list here (ActiveChannelProvider on the site, TvDataProvider on the TV);
 * the last list is kept in localStorage so a returning visitor's first paint
 * already has the right colours.
 */
export interface ChannelInfo {
  slug: string;
  name: string;
  emoji: string | null;
  description: string | null;
  accent: string | null;
  card_image: string | null;
  card_video: string | null;
  short_label: string | null;
  /** Most of its songs have a city: its card says "Now in: <city>" while one plays. */
  shows_places?: boolean;
}

const CACHE_KEY = "we-are-radio:channel-info";

function readCache(): Map<string, ChannelInfo> {
  try {
    const list = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "[]") as ChannelInfo[];
    return new Map(list.map((c) => [c.slug, c]));
  } catch {
    return new Map();
  }
}

let known = readCache();
let version = 0;
const subscribers = new Set<() => void>();

export function rememberChannels(list: ChannelInfo[]) {
  const slim = list.map(({ slug, name, emoji, description, accent, card_image, card_video, short_label, shows_places }) => ({
    slug,
    name,
    emoji,
    description,
    accent,
    card_image,
    card_video,
    short_label,
    shows_places,
  }));
  const next = JSON.stringify(slim);
  try {
    if (localStorage.getItem(CACHE_KEY) !== next) localStorage.setItem(CACHE_KEY, next);
  } catch {
    // best-effort, as the other localStorage uses: the list still applies this visit
  }
  known = new Map(slim.map((c) => [c.slug, c]));
  version++;
  subscribers.forEach((f) => f());
}

export const channelInfo = (slug: string | null | undefined): ChannelInfo | undefined => (slug ? known.get(slug) : undefined);

/** Re-renders the caller when a fresh channel list arrives. */
export function useChannelInfo() {
  useSyncExternalStore(
    (f) => {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
    () => version
  );
}

/** A card file's address: "/channels/..." is one of the app's own files, anything else an R2 key. */
export const channelMediaUrl = (v: string | null | undefined): string | null => (!v ? null : v.startsWith("/") ? v : mediaUrl(v));

export const channelStill = (slug: string | null | undefined) => channelMediaUrl(channelInfo(slug)?.card_image);
export const channelVideo = (slug: string | null | undefined) => channelMediaUrl(channelInfo(slug)?.card_video);
