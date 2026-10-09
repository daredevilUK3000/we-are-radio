import { useEffect, useState } from "react";
import { contestApi, publicApi, type ContestEntry, type ContestState, type GoodAd } from "../api/client";

/**
 * What Home's rows show beyond the channels (9 Oct 2026): the Advertising For
 * Good ads, the Radio That Knows You moods, the featured album, the Top 3
 * contest and its songs, and the latest podcast episodes. The same public
 * APIs the site's landing page uses, fetched once per visit and shared by
 * every screen. A row whose request fails (or that has nothing) is left out.
 */

export interface TvNeed {
  key: string;
  label: string;
  emoji: string;
  blurb: string;
}

export interface TvContent {
  good: GoodAd[];
  needs: TvNeed[];
  album: { album: any; tracks: any[] } | null;
  contest: ContestState | null;
  entries: ContestEntry[];
  podcasts: any[];
}

const EMPTY: TvContent = { good: [], needs: [], album: null, contest: null, entries: [], podcasts: [] };

// The same four moods as the site's Radio That Knows You card, so the row shows at once.
const NEEDS: TvNeed[] = [
  { key: "energy", label: "I need energy", emoji: "⚡", blurb: "Lift me up and get me moving" },
  { key: "love", label: "I want to fall in love", emoji: "❤️", blurb: "Something warm and romantic" },
  { key: "switch-off", label: "I want to switch off", emoji: "🌙", blurb: "Slow down and let it all go" },
  { key: "fun", label: "I want to have fun", emoji: "🎉", blurb: "Good times, good music" },
];

let loaded: Promise<TvContent> | null = null;

function load(): Promise<TvContent> {
  loaded ??= (async () => {
    const soft = <T,>(p: Promise<T>, fallback: T) => p.catch(() => fallback);
    const [good, needs, album, contest, entries, podcasts] = await Promise.all([
      soft(publicApi.good().then((r) => r.ads), [] as GoodAd[]),
      soft(publicApi.needs().then((r) => (r.needs.length ? r.needs : NEEDS)), NEEDS),
      soft(publicApi.featuredAlbum().then((r) => (r.album && r.tracks.length ? r : null)), null),
      soft(contestApi.state(), null),
      soft(contestApi.entries({ limit: 12 }).then((r) => r.entries), [] as ContestEntry[]),
      soft(publicApi.podcasts(12).then((r) => r.podcasts), [] as any[]),
    ]);
    return { good, needs, album, contest, entries, podcasts };
  })();
  return loaded;
}

export function useTvContent(): TvContent {
  const [content, setContent] = useState<TvContent>(EMPTY);
  useEffect(() => {
    let live = true;
    load().then((c) => live && setContent(c));
    return () => {
      live = false;
    };
  }, []);
  return content;
}
