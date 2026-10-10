import type { AudioAsset, Track } from "../types";
import { hashSeed } from "../radioBrain";
import { autopilotTracks } from "../station";
import type { GridBlock } from "./grid";
import { addDaysTo, parisDate } from "./time";
import { contentKey, type Playable } from "./types";

/**
 * Hand-planned content (handoff_scheduler_release2.md §3): playlists and
 * templates (station-wide lists of slots) and running orders (one block
 * occurrence's own items: a manual hour, or a template show's episode).
 *
 * A slot is one of:
 * - fixed: a song or audio item Patrick chose;
 * - rule: a simple filter (§3.4), resolved to one item when the log is built;
 * - episode: a placeholder in a template ("Interview"), filled per episode.
 *
 * In the log, hand-planned items keep source = 'programme', with
 * source_ref list:<id>, ro:<id> or rule:<list or ro id>:<position>.
 */

export type SlotKind = "fixed" | "rule" | "episode";

export interface ListSlot {
  position: number;
  slot_kind: SlotKind;
  track_id: string | null;
  audio_asset_id: string | null;
  rule_json: string | null;
  label: string | null;
  /** Templates only: a fixed offset from the block start (an internal hard start); null flows on. */
  at_ms: number | null;
  /** Running orders only: added by the Auto-fill button (Trim auto-filled removes these). */
  auto_filled?: number;
}

export interface SnapshotList {
  id: string;
  kind: "playlist" | "template";
  name: string;
  description: string;
  length_ms: number | null;
  archived: number;
  updated_at_ms: number;
  slots: ListSlot[];
}

export interface SnapshotRunningOrder {
  id: string;
  block_id: string;
  /** The occurrence's Paris start date. */
  date: string;
  from_list_id: string | null;
  note: string;
  updated_at_ms: number;
  items: ListSlot[];
}

/** What a published plan carries besides its blocks. */
export interface PlanContent {
  lists: Record<string, SnapshotList>;
  running_orders: SnapshotRunningOrder[];
}

export const EMPTY_CONTENT: PlanContent = { lists: {}, running_orders: [] };

export interface SlotRule {
  item_type: "song" | "station_id" | "link" | "promo";
  tags_any?: string[];
  album_id?: string;
  link_kind?: string;
}

export const LINK_KINDS = ["intro", "transition", "fun_fact", "observation", "outro"] as const;

export function parseRule(json: string | null | undefined): SlotRule | null {
  if (!json) return null;
  try {
    const r = JSON.parse(json) as Partial<SlotRule>;
    const item_type = (["song", "station_id", "link", "promo"] as const).find((t) => t === r.item_type);
    if (!item_type) return null;
    return {
      item_type,
      tags_any: Array.isArray(r.tags_any) ? r.tags_any.map(String).filter(Boolean).slice(0, 20) : [],
      album_id: typeof r.album_id === "string" && r.album_id ? r.album_id : undefined,
      link_kind: typeof r.link_kind === "string" && (LINK_KINDS as readonly string[]).includes(r.link_kind) ? r.link_kind : undefined,
    };
  } catch {
    return null;
  }
}

/** "a song tagged upbeat, soul", "a station ID", "an intro link" */
export function describeRule(rule: SlotRule | null, albumTitle?: string | null): string {
  if (!rule) return "an item";
  if (rule.item_type === "song") {
    const bits = [rule.tags_any?.length ? `tagged ${rule.tags_any.join(", ")}` : "", rule.album_id ? `from ${albumTitle ? `the album ${albumTitle}` : "one album"}` : ""].filter(Boolean);
    return `a song${bits.length ? ` ${bits.join(" ")}` : " from the block's pool"}`;
  }
  if (rule.item_type === "station_id") return "a station ID";
  if (rule.item_type === "promo") return "a promo";
  return rule.link_kind ? `${/^[aeiou]/.test(rule.link_kind) ? "an" : "a"} ${rule.link_kind.replace("_", " ")} link` : "a voice link";
}

// ------------------------------------------------------------------ loading the working copy

interface SlotRow extends ListSlot {
  list_id?: string;
  running_order_id?: string;
}

const normSlot = (r: SlotRow): ListSlot => ({
  position: r.position,
  slot_kind: r.slot_kind,
  track_id: r.track_id ?? null,
  audio_asset_id: r.audio_asset_id ?? null,
  rule_json: r.rule_json ?? null,
  label: r.label ?? null,
  at_ms: r.at_ms ?? null,
  ...(r.auto_filled !== undefined ? { auto_filled: r.auto_filled ? 1 : 0 } : {}),
});

/** Lists by id, with their slots in order. */
export async function loadLists(db: D1Database, ids?: string[]): Promise<Record<string, SnapshotList>> {
  if (ids && ids.length === 0) return {};
  const where = ids ? `WHERE id IN (${ids.map(() => "?").join(",")})` : "";
  const { results: lists } = await db
    .prepare(`SELECT * FROM sched_lists ${where} ORDER BY name`)
    .bind(...(ids ?? []))
    .all<Omit<SnapshotList, "slots">>();
  if (lists.length === 0) return {};
  const { results: slots } = await db
    .prepare(`SELECT * FROM sched_list_slots WHERE list_id IN (${lists.map(() => "?").join(",")}) ORDER BY list_id, position`)
    .bind(...lists.map((l) => l.id))
    .all<SlotRow>();
  const out: Record<string, SnapshotList> = {};
  for (const l of lists) out[l.id] = { ...l, description: l.description ?? "", slots: [] };
  for (const s of slots) out[s.list_id!]?.slots.push(normSlot(s));
  return out;
}

/** A channel's running orders from `fromDate` on (the working copy). */
export async function loadRunningOrders(db: D1Database, channelId: string, fromDate: string): Promise<SnapshotRunningOrder[]> {
  const { results: ros } = await db
    .prepare(
      `SELECT r.* FROM sched_running_orders r JOIN sched_blocks b ON b.id = r.block_id
       WHERE b.channel_id = ? AND r.date >= ? ORDER BY r.date, r.block_id`
    )
    .bind(channelId, fromDate)
    .all<Omit<SnapshotRunningOrder, "items">>();
  if (ros.length === 0) return [];
  const { results: items } = await db
    .prepare(
      `SELECT i.* FROM sched_running_order_items i JOIN sched_running_orders r ON r.id = i.running_order_id
       JOIN sched_blocks b ON b.id = r.block_id WHERE b.channel_id = ? AND r.date >= ? ORDER BY i.running_order_id, i.position`
    )
    .bind(channelId, fromDate)
    .all<SlotRow>();
  const byId = new Map(ros.map((r) => [r.id, { ...r, note: r.note ?? "", items: [] as ListSlot[] }]));
  for (const i of items) byId.get(i.running_order_id!)?.items.push(normSlot(i));
  return [...byId.values()];
}

/** One running order (any date). */
export async function loadRunningOrder(db: D1Database, blockId: string, date: string): Promise<SnapshotRunningOrder | null> {
  const ro = await db.prepare("SELECT * FROM sched_running_orders WHERE block_id = ? AND date = ?").bind(blockId, date).first<Omit<SnapshotRunningOrder, "items">>();
  if (!ro) return null;
  const { results } = await db.prepare("SELECT * FROM sched_running_order_items WHERE running_order_id = ? ORDER BY position").bind(ro.id).all<SlotRow>();
  return { ...ro, note: ro.note ?? "", items: results.map(normSlot) };
}

/** The content a channel's working blocks use: the lists they're filled from, and running orders from yesterday on (§1.5). */
export async function workingContent(db: D1Database, channelId: string, blocks: GridBlock[], nowMs: number): Promise<PlanContent> {
  const listIds = [...new Set(blocks.filter((b) => b.active && b.list_id).map((b) => b.list_id as string))];
  const blockIds = new Set(blocks.filter((b) => b.active).map((b) => b.id));
  const ros = (await loadRunningOrders(db, channelId, addDaysTo(parisDate(nowMs), -1))).filter((r) => blockIds.has(r.block_id));
  return { lists: await loadLists(db, listIds), running_orders: ros };
}

/** Statements writing a list's slots (replacing them). */
export function writeSlotsStatements(db: D1Database, listId: string, slots: ListSlot[]): D1PreparedStatement[] {
  return [
    db.prepare("DELETE FROM sched_list_slots WHERE list_id = ?").bind(listId),
    ...slots.map((s, i) =>
      db
        .prepare("INSERT INTO sched_list_slots (list_id, position, slot_kind, track_id, audio_asset_id, rule_json, label, at_ms) VALUES (?,?,?,?,?,?,?,?)")
        .bind(listId, i + 1, s.slot_kind, s.track_id, s.audio_asset_id, s.rule_json, s.label, s.at_ms)
    ),
  ];
}

/** Statements writing a whole running order (insert or replace, with its items). */
export function writeRunningOrderStatements(db: D1Database, ro: SnapshotRunningOrder): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO sched_running_orders (id, block_id, date, from_list_id, note, updated_at_ms) VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET from_list_id = excluded.from_list_id, note = excluded.note, updated_at_ms = excluded.updated_at_ms`
      )
      .bind(ro.id, ro.block_id, ro.date, ro.from_list_id, ro.note, ro.updated_at_ms),
    db.prepare("DELETE FROM sched_running_order_items WHERE running_order_id = ?").bind(ro.id),
    ...ro.items.map((s, i) =>
      db
        .prepare(
          "INSERT INTO sched_running_order_items (running_order_id, position, slot_kind, track_id, audio_asset_id, rule_json, label, at_ms, auto_filled) VALUES (?,?,?,?,?,?,?,?,?)"
        )
        .bind(ro.id, i + 1, s.slot_kind, s.track_id, s.audio_asset_id, s.rule_json, s.label, s.at_ms, s.auto_filled ? 1 : 0)
    ),
  ];
}

/** Statements writing a whole list (insert or replace, with its slots). */
export function writeListStatements(db: D1Database, l: SnapshotList): D1PreparedStatement[] {
  return [
    db
      .prepare(
        `INSERT INTO sched_lists (id, kind, name, description, length_ms, archived, created_at_ms, updated_at_ms) VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, length_ms = excluded.length_ms,
           archived = excluded.archived, updated_at_ms = excluded.updated_at_ms`
      )
      .bind(l.id, l.kind, l.name, l.description, l.length_ms, l.archived, l.updated_at_ms, l.updated_at_ms),
    ...writeSlotsStatements(db, l.id, l.slots),
  ];
}

// ------------------------------------------------------------------ comparing

const slotSig = (s: ListSlot) => [s.slot_kind, s.track_id, s.audio_asset_id, s.rule_json, s.label, s.at_ms, s.auto_filled ? 1 : 0].join("|");
export const slotsDiffer = (a: ListSlot[], b: ListSlot[]) => a.length !== b.length || a.some((s, i) => slotSig(s) !== slotSig(b[i]));
export const listsDiffer = (a: SnapshotList, b: SnapshotList) =>
  a.name !== b.name || (a.description ?? "") !== (b.description ?? "") || (a.length_ms ?? null) !== (b.length_ms ?? null) || slotsDiffer(a.slots, b.slots);
export const roDiffer = (a: SnapshotRunningOrder, b: SnapshotRunningOrder) => (a.note ?? "") !== (b.note ?? "") || slotsDiffer(a.items, b.items);

// ------------------------------------------------------------------ resolving slots to audio

/** Songs and audio items by id (published, with audio), as things to put on air. */
export class SlotResolver {
  private tracks = new Map<string, Promise<Track | null>>();
  private assets = new Map<string, Promise<AudioAsset | null>>();
  private ruleCands = new Map<string, Promise<Playable[]>>();

  constructor(
    readonly db: D1Database,
    /** The tags a song rule with no tags uses: the block's, else the channel's. */
    readonly poolTags: string[]
  ) {}

  track(id: string): Promise<Track | null> {
    let p = this.tracks.get(id);
    if (!p) {
      p = this.db.prepare("SELECT * FROM tracks WHERE id = ? AND status = 'published'").bind(id).first<Track>();
      this.tracks.set(id, p);
    }
    return p;
  }

  asset(id: string): Promise<AudioAsset | null> {
    let p = this.assets.get(id);
    if (!p) {
      // Audio items may be 'ready' as well as published: imported podcast episodes are (as in programmes).
      p = this.db.prepare("SELECT * FROM audio_assets WHERE id = ? AND status IN ('published','ready')").bind(id).first<AudioAsset>();
      this.assets.set(id, p);
    }
    return p;
  }

  /** A fixed slot as something playable, or null when its audio is missing or unpublished. */
  async fixed(slot: Pick<ListSlot, "track_id" | "audio_asset_id" | "label">): Promise<Playable | null> {
    if (slot.track_id) {
      const t = await this.track(slot.track_id);
      return t ? trackPlayable(t) : null;
    }
    if (slot.audio_asset_id) {
      const a = await this.asset(slot.audio_asset_id);
      return a ? assetPlayable(a) : null;
    }
    return null;
  }

  /** Everything a rule could pick, in a stable order. */
  candidates(rule: SlotRule): Promise<Playable[]> {
    const key = JSON.stringify(rule);
    let p = this.ruleCands.get(key);
    if (!p) {
      p = (async () => {
        if (rule.item_type === "song") {
          let tracks = await autopilotTracks(this.db, rule.tags_any?.length ? rule.tags_any : this.poolTags);
          if (rule.album_id) tracks = tracks.filter((t) => t.album_id === rule.album_id);
          return tracks.map(trackPlayable).filter((x): x is Playable => !!x);
        }
        const types = rule.item_type === "station_id" ? ["station_id", "jingle"] : rule.item_type === "promo" ? ["promo"] : ["link"];
        const { results } = await this.db
          .prepare(
            `SELECT * FROM audio_assets WHERE status IN ('published','ready') AND type IN (${types.map(() => "?").join(",")})
             ${rule.item_type === "link" && rule.link_kind ? "AND link_kind = ?" : ""} ORDER BY id`
          )
          .bind(...types, ...(rule.item_type === "link" && rule.link_kind ? [rule.link_kind] : []))
          .all<AudioAsset>();
        return results.filter((a) => a.play_mode !== "duck_over_music").map(assetPlayable).filter((x): x is Playable => !!x);
      })();
      this.ruleCands.set(key, p);
    }
    return p;
  }

  /**
   * One pick for a rule slot (§3.4): deterministic from the seed, skipping
   * anything aired in the 2 hours before `at` (`recent`) and, for songs,
   * anything already picked in this occurrence. Null when nothing matches.
   */
  async pick(rule: SlotRule, seed: string, at: number, recent: Map<string, number>, picked: Set<string>, windowMs: number): Promise<Playable | null> {
    const all = await this.candidates(rule);
    if (all.length === 0) return null;
    const fresh = all.filter((p) => {
      if (rule.item_type === "song" && picked.has(contentKey(p))) return false;
      const last = recent.get(contentKey(p));
      return last === undefined || last < at - windowMs;
    });
    // A pool too small to avoid every repeat: anything not already in this occurrence, rather than nothing.
    const from = fresh.length ? fresh : all.filter((p) => !picked.has(contentKey(p)));
    if (from.length === 0) return null;
    return from[hashSeed(seed) % from.length];
  }
}

export function trackPlayable(t: Track): Playable | null {
  if (!t.audio_url || !(t.duration_seconds > 0)) return null;
  return {
    itemType: "song", trackId: t.id, assetId: null, label: t.title, audioUrl: t.audio_url, artworkUrl: t.artwork_url,
    fileMs: t.duration_seconds * 1000, blockId: null, blockDate: null, source: "programme", sourceRef: null, reasons: [],
  };
}

export function assetPlayable(a: AudioAsset): Playable | null {
  if (!a.audio_url || !(a.duration_seconds > 0)) return null;
  return {
    itemType: a.type === "jingle" || a.type === "promo" ? "station_id" : a.type,
    trackId: null, assetId: a.id, label: a.title, audioUrl: a.audio_url, artworkUrl: null,
    fileMs: a.duration_seconds * 1000, blockId: null, blockDate: null, source: "programme", sourceRef: null, reasons: [],
  };
}
