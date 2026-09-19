import { Hono } from "hono";
import { XMLParser } from "fast-xml-parser";
import type { Env } from "../lib/types";
import { newId, nowIso } from "../lib/id";

export const podcastImportRoutes = new Hono<{ Bindings: Env }>();

interface FeedEpisode {
  guid: string;
  title: string;
  description: string | null;
  audio_url: string;
  duration_seconds: number;
  artwork_url: string | null;
  published_at: string | null;
  episode_number: number | null;
}

// RSS text nodes with attributes (e.g. <guid isPermaLink="false">abc</guid>)
// parse to { "@_isPermaLink": "false", "#text": "abc" } rather than a plain
// string - this normalises either shape to just the text.
function textOf(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
    return String((value as Record<string, unknown>)["#text"]);
  }
  return null;
}

// <itunes:duration> is either plain seconds ("1234") or "HH:MM:SS"/"MM:SS".
function parseDuration(raw: string | null): number {
  if (!raw) return 0;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const parts = trimmed.split(":").map((p) => parseInt(p, 10));
  if (parts.some((p) => Number.isNaN(p))) return 0;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}

function parseEpisodeNumber(raw: string | null): number | null {
  if (!raw) return null;
  const n = parseInt(raw.trim(), 10);
  return Number.isNaN(n) ? null : n;
}

function parsePublishedAt(raw: string | undefined): string | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function fetchAndParseFeed(feedUrl: string): Promise<{ showTitle: string | null; episodes: FeedEpisode[] }> {
  const res = await fetch(feedUrl, { headers: { "User-Agent": "WeAreRadio-PodcastImporter/1.0" } });
  if (!res.ok) throw new Error(`Feed fetch failed: HTTP ${res.status}`);
  const xml = await res.text();

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const doc = parser.parse(xml);
  const channel = doc?.rss?.channel;
  if (!channel) throw new Error("Not a recognisable RSS feed (no <rss><channel>)");

  const showTitle = textOf(channel.title);
  const channelArtwork = textOf(channel["itunes:image"]?.["@_href"]) ?? channel.image?.url ?? null;
  const rawItems = channel.item ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  const episodes: FeedEpisode[] = items.map((item: Record<string, unknown>) => {
    const guid =
      textOf(item.guid) ??
      textOf(item.link) ??
      textOf(item.title) ??
      newId("guid"); // last-resort fallback so an unusual feed can't crash the import
    const enclosure = item.enclosure as Record<string, unknown> | undefined;
    const audioUrl = textOf(enclosure?.["@_url"]) ?? "";
    const itunesImage = item["itunes:image"] as Record<string, unknown> | undefined;

    return {
      guid,
      title: textOf(item.title) ?? "Untitled episode",
      description: textOf(item.description) ?? textOf(item["itunes:summary"]),
      audio_url: audioUrl,
      duration_seconds: parseDuration(textOf(item["itunes:duration"])),
      artwork_url: textOf(itunesImage?.["@_href"]) ?? channelArtwork,
      published_at: parsePublishedAt(textOf(item.pubDate) ?? undefined),
      // Only what the feed actually says - never a guessed number, since
      // this ends up on a public "EP ##" badge.
      episode_number: parseEpisodeNumber(textOf(item["itunes:episode"])),
    };
  });

  return {
    showTitle,
    episodes: episodes
      .filter((e) => e.audio_url) // an episode with no playable file isn't importable
      .sort((a, b) => (b.published_at ?? "").localeCompare(a.published_at ?? "")),
  };
}

/**
 * Podcast Importer, step 1 (and also "Check for new episodes"): fetch and
 * parse the feed, and flag which episodes are already imported (matched on
 * guid) so the review screen can show that state without a second call.
 */
podcastImportRoutes.post("/fetch", async (c) => {
  const { feed_url } = await c.req.json<{ feed_url?: string }>();
  if (!feed_url) return c.json({ error: "feed_url is required" }, 400);

  let episodes: FeedEpisode[];
  let showTitle: string | null;
  try {
    ({ showTitle, episodes } = await fetchAndParseFeed(feed_url));
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "Could not read that feed" }, 502);
  }

  if (episodes.length === 0) {
    return c.json({ show_title: showTitle, episodes: [] });
  }

  const placeholders = episodes.map(() => "?").join(",");
  const { results: existing } = await c.env.DB.prepare(
    `SELECT external_guid FROM audio_assets WHERE external_guid IN (${placeholders})`
  )
    .bind(...episodes.map((e) => e.guid))
    .all<{ external_guid: string }>();
  const alreadyImported = new Set(existing.map((r) => r.external_guid));

  return c.json({
    show_title: showTitle,
    episodes: episodes.map((e) => ({ ...e, already_imported: alreadyImported.has(e.guid) })),
  });
});

/**
 * Podcast Importer, step 2: create a draft programme per selected episode,
 * referencing the Spotify-hosted audio directly (storage='external')
 * rather than copying it into R2. Nothing publishes automatically - each
 * imported episode is a draft programme Kizzi reviews and publishes
 * through the normal Studio flow, same as anything else.
 */
podcastImportRoutes.post("/import", async (c) => {
  const { channel_id, episodes, show_name } = await c.req.json<{
    channel_id?: string;
    episodes?: FeedEpisode[];
    show_name?: string;
  }>();
  if (!channel_id || !episodes || episodes.length === 0) {
    return c.json({ error: "channel_id and at least one episode are required" }, 400);
  }

  // Defensive re-check against double-import (e.g. a double click), even
  // though the review screen shouldn't offer already-imported episodes.
  const placeholders = episodes.map(() => "?").join(",");
  const { results: existing } = await c.env.DB.prepare(
    `SELECT external_guid FROM audio_assets WHERE external_guid IN (${placeholders})`
  )
    .bind(...episodes.map((e) => e.guid))
    .all<{ external_guid: string }>();
  const alreadyImported = new Set(existing.map((r) => r.external_guid));
  const toImport = episodes.filter((e) => !alreadyImported.has(e.guid));

  const ts = nowIso();
  const statements = toImport.flatMap((episode) => {
    const audioAssetId = newId("aa");
    const programmeId = newId("prog");
    const itemId = newId("pi");

    return [
      c.env.DB.prepare(
        `INSERT INTO audio_assets (id, type, title, audio_url, duration_seconds, description, status, storage, external_guid, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        audioAssetId,
        "interview",
        episode.title,
        episode.audio_url,
        episode.duration_seconds,
        episode.description,
        "ready",
        "external",
        episode.guid,
        ts
      ),
      c.env.DB.prepare(
        `INSERT INTO programmes (id, channel_id, title, description, artwork_url, episode_number, show_name, status, duration_seconds, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        programmeId,
        channel_id,
        episode.title,
        episode.description,
        episode.artwork_url,
        episode.episode_number ?? null,
        show_name?.trim() || null,
        "draft",
        episode.duration_seconds,
        ts,
        ts
      ),
      c.env.DB.prepare(
        `INSERT INTO programme_items (id, programme_id, position, item_type, audio_asset_id)
         VALUES (?,?,?,?,?)`
      ).bind(itemId, programmeId, 0, "interview", audioAssetId),
    ];
  });

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.json({ imported: toImport.length, skipped: episodes.length - toImport.length });
});
