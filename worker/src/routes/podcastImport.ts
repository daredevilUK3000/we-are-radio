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

// D1 allows at most 100 bound parameters per query, and a long-running show's
// feed can have more episodes than that - so look guids up in chunks.
async function findImportedGuids(db: D1Database, guids: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let i = 0; i < guids.length; i += 90) {
    const chunk = guids.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT external_guid FROM audio_assets WHERE external_guid IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<{ external_guid: string }>();
    for (const r of results) found.add(r.external_guid);
  }
  return found;
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

  const alreadyImported = await findImportedGuids(c.env.DB, episodes.map((e) => e.guid));

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
  const alreadyImported = await findImportedGuids(c.env.DB, episodes.map((e) => e.guid));
  const toImport = episodes.filter((e) => !alreadyImported.has(e.guid));

  const ts = nowIso();
  // One entry per episode (its three inserts together), so the work can be
  // committed in modest batches - an all-at-once batch for a 100+ episode
  // feed is too big - without ever splitting an episode across batches.
  const perEpisode = toImport.map((episode) => {
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
        `INSERT INTO programmes (id, channel_id, title, description, artwork_url, episode_number, show_name, status, publish_date, duration_seconds, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        programmeId,
        channel_id,
        episode.title,
        episode.description,
        episode.artwork_url,
        episode.episode_number ?? null,
        show_name?.trim() || null,
        "draft",
        // The feed's own release date, so episodes sort by when they came
        // out (not by when they were imported or published). Harmless on a
        // draft - nothing reads publish_date until status is 'published'.
        episode.published_at ?? null,
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

  for (let i = 0; i < perEpisode.length; i += 25) {
    await c.env.DB.batch(perEpisode.slice(i, i + 25).flat());
  }

  return c.json({ imported: toImport.length, skipped: episodes.length - toImport.length });
});

// ---------------------------------------------------------------- Managing imported episodes
//
// The Studio "Podcasts" page: list every imported episode, publish/unpublish
// them in bulk, and delete them. "Podcast episode" here means a programme
// whose audio is an external (feed-hosted) asset - every route below refuses
// ids that aren't, so these can never touch a normal radio programme.

const ID_CHUNK = 90; // D1 allows at most 100 bound parameters per query

async function podcastEpisodeIds(db: D1Database, ids: string[]): Promise<string[]> {
  const found: string[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const { results } = await db
      .prepare(
        `SELECT DISTINCT p.id FROM programmes p
         JOIN programme_items pi ON pi.programme_id = p.id
         JOIN audio_assets aa ON aa.id = pi.audio_asset_id
         WHERE aa.storage = 'external' AND p.id IN (${chunk.map(() => "?").join(",")})`
      )
      .bind(...chunk)
      .all<{ id: string }>();
    found.push(...results.map((r) => r.id));
  }
  return found;
}

podcastImportRoutes.get("/episodes", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT p.id, p.title, p.show_name, p.episode_number, p.status, p.publish_date,
            p.duration_seconds, p.channel_id, ch.name AS channel_name
     FROM programmes p
     JOIN programme_items pi ON pi.programme_id = p.id
     JOIN audio_assets aa ON aa.id = pi.audio_asset_id
     LEFT JOIN channels ch ON ch.id = p.channel_id
     WHERE aa.storage = 'external'
     ORDER BY p.publish_date DESC, p.created_at DESC`
  ).all();
  return c.json({ episodes: results });
});

podcastImportRoutes.post("/episodes/status", async (c) => {
  const { ids, status } = await c.req.json<{ ids?: string[]; status?: string }>();
  if (!ids || ids.length === 0 || (status !== "published" && status !== "draft")) {
    return c.json({ error: "ids and a status of 'published' or 'draft' are required" }, 400);
  }
  const valid = await podcastEpisodeIds(c.env.DB, ids);
  const ts = nowIso();
  // publish_date keeps the episode's original release date; only an episode
  // that somehow has none is stamped with today.
  const statements: D1PreparedStatement[] = [];
  for (let i = 0; i < valid.length; i += ID_CHUNK) {
    const chunk = valid.slice(i, i + ID_CHUNK);
    statements.push(
      c.env.DB.prepare(
        `UPDATE programmes SET status = ?, publish_date = COALESCE(publish_date, ?), updated_at = ?
         WHERE id IN (${chunk.map(() => "?").join(",")})`
      ).bind(status, ts, ts, ...chunk)
    );
  }
  if (statements.length > 0) await c.env.DB.batch(statements);
  return c.json({ updated: valid.length });
});

podcastImportRoutes.post("/episodes/delete", async (c) => {
  const { ids } = await c.req.json<{ ids?: string[] }>();
  if (!ids || ids.length === 0) return c.json({ error: "ids are required" }, 400);
  const valid = await podcastEpisodeIds(c.env.DB, ids);
  if (valid.length === 0) return c.json({ deleted: 0 });

  // Capture the audio assets first - they're unreachable once the items go.
  const assetIds = new Set<string>();
  for (let i = 0; i < valid.length; i += ID_CHUNK) {
    const chunk = valid.slice(i, i + ID_CHUNK);
    const { results } = await c.env.DB.prepare(
      `SELECT audio_asset_id FROM programme_items
       WHERE audio_asset_id IS NOT NULL AND programme_id IN (${chunk.map(() => "?").join(",")})`
    )
      .bind(...chunk)
      .all<{ audio_asset_id: string }>();
    results.forEach((r) => assetIds.add(r.audio_asset_id));
  }

  for (let i = 0; i < valid.length; i += ID_CHUNK) {
    const chunk = valid.slice(i, i + ID_CHUNK);
    const marks = chunk.map(() => "?").join(",");
    await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM programme_items WHERE programme_id IN (${marks})`).bind(...chunk),
      c.env.DB.prepare(`DELETE FROM favourites WHERE item_type = 'programme' AND item_id IN (${marks})`).bind(...chunk),
      c.env.DB.prepare(`DELETE FROM listening_history WHERE item_type = 'programme' AND item_id IN (${marks})`).bind(...chunk),
      c.env.DB.prepare(`DELETE FROM programmes WHERE id IN (${marks})`).bind(...chunk),
    ]);
  }

  // Remove the feed audio records too (only external ones no other programme
  // still uses), so deleting an episode lets the importer bring it back later.
  const assets = Array.from(assetIds);
  for (let i = 0; i < assets.length; i += ID_CHUNK) {
    const chunk = assets.slice(i, i + ID_CHUNK);
    await c.env.DB.prepare(
      `DELETE FROM audio_assets
       WHERE storage = 'external'
         AND id IN (${chunk.map(() => "?").join(",")})
         AND NOT EXISTS (SELECT 1 FROM programme_items pi WHERE pi.audio_asset_id = audio_assets.id)`
    )
      .bind(...chunk)
      .run();
  }

  return c.json({ deleted: valid.length });
});
