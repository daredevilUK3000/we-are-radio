import type { AudioAsset, Channel, Programme } from "../types";
import type { RotationItem } from "../radioBrain";
import { buildRotation } from "../radioBrain";
import { loadCapsulesFor, withCapsules } from "../capsules";
import {
  autopilotTracks,
  channelTags,
  loadPinnedJingles,
  loadStationLoop,
  programmeItems,
  stationIdAssets,
  type LoopResult,
  type StationLoop,
} from "../station";
import { fitToWindow } from "./fit";
import { blockReason, blockTags, occurrenceOn, occurrencesBetween, type GridBlock, type Occurrence } from "./grid";
import { describeRule, EMPTY_CONTENT, parseRule, SlotResolver, trackPlayable, type ListSlot, type PlanContent } from "./content";
import { addDaysTo, DAY, HOUR, mmss, parisHHMM, shortDay, stationDate, stationDayStartMs } from "./time";
import { allowedIn, bandDistance, daypartReason, daypartsApply, daypartsBetween, daypartSeconds, MIN_DAYPART_SONGS, songBands, type TimeBand } from "./dayparts";
import { contentKey, REPEAT_WINDOW_MS, type ItemSource, type PlanItem, type Playable } from "./types";

/**
 * The plan: what a channel should air, as a pure function of time and its
 * inputs (programme, catalogue, capsules, grid). Versions are slices of it.
 *
 * - Time outside grid blocks is the CHANNEL DEFAULT: the pre-Scheduler loop,
 *   placed with exactly the old arithmetic (loop k starts at anchor + k*loop),
 *   so with an empty grid the log is what /now-playing always computed. The
 *   loop can change only at London midnight (the capsule calendar); when it
 *   does, the old item stops at midnight and the new loop joins mid-item,
 *   just as the old code did.
 * - A default stretch that follows a block starts with a whole item at the
 *   block's end (the loop is re-anchored there) rather than mid-song.
 * - A block starts on the dot. Whatever runs up to it is fitted to end there
 *   (fitToWindow), and the block's own content is fitted to end at its end.
 * - Hand-planned blocks (playlist, template, manual: handoff §3) play their
 *   slots in order from the block start; a slot with an `at` time is an
 *   internal hard start, and what runs before it is fitted to end there.
 *   Short is topped up from the block's pool (manual: the channel
 *   default's), never silence. Fixed items are never dropped.
 */

const HAND_KINDS = new Set(["playlist", "template", "manual"]);
export const isHandPlanned = (b: Pick<GridBlock, "fill_kind">) => HAND_KINDS.has(b.fill_kind);

interface HandEntry {
  slot: ListSlot;
  /** list:<id> or ro:<id> */
  ref: string;
  /** The list or running order id (rule picks are rule:<owner>:<position>). */
  owner: string;
  why: string;
}

export class PlanError extends Error {}

export interface BlockContent {
  items: RotationItem[];
  pool: Playable[];
  source: ItemSource;
  sourceRef: string;
  programme?: Programme;
}

const CAPSULE_ID = /^capsule-(.+)-\d+$/;

export class Planner {
  private loops = new Map<string, Promise<LoopResult>>();
  private loopsByCapsules = new Map<string, Promise<LoopResult>>();
  private blockContent = new Map<string, Promise<BlockContent>>();
  private tagsText: string;
  /** The content that ends right at the start of this build (the airing on now): never start with it again. */
  private avoidFirst: string | null = null;

  constructor(
    readonly db: D1Database,
    readonly kv: KVNamespace,
    readonly channel: Channel,
    readonly blocks: GridBlock[],
    readonly nowMs: number = Date.now(),
    /** The plan's playlists, templates and running orders (hand-planned blocks). */
    readonly content: PlanContent = EMPTY_CONTENT
  ) {
    const tags = channelTags(channel);
    this.tagsText = tags.length ? ` (tagged ${tags.join(", ")})` : "";
  }

  /** The channel default's loop on a London (capsule) date. Dates with the same capsules share one loop. */
  loopFor(date: string): Promise<LoopResult> {
    let p = this.loops.get(date);
    if (!p) {
      p = (async () => {
        const capsules = await loadCapsulesFor(this.db, date);
        const key = capsules.map((c) => c.id).join(",");
        let shared = this.loopsByCapsules.get(key);
        if (!shared) {
          shared = loadStationLoop(this.db, this.kv, this.channel, { capsuleDate: date, nowMs: this.nowMs });
          this.loopsByCapsules.set(key, shared);
        }
        return shared;
      })();
      this.loops.set(date, p);
    }
    return p;
  }

  private playable(ri: RotationItem, source: ItemSource, sourceRef: string, reasons: string[], occ?: Occurrence): Playable | null {
    if (!ri.audio_url || !(ri.duration_seconds > 0)) return null;
    const capsule = CAPSULE_ID.exec(ri.id);
    return {
      itemType: ri.item_type,
      trackId: ri.track_id,
      assetId: ri.audio_asset_id,
      label: ri.label,
      audioUrl: ri.audio_url,
      artworkUrl: ri.artwork_url,
      fileMs: ri.duration_seconds * 1000,
      overlays: ri.overlays,
      // A time-of-day day-part isn't a block: its songs are plain channel music to everything else.
      blockId: occ && !occ.daypart ? occ.block.id : null,
      blockDate: occ && !occ.daypart ? occ.date : null,
      source: capsule ? "capsule" : source,
      sourceRef: capsule ? capsule[1] : sourceRef,
      reasons: capsule ? [`Time capsule: ${ri.label ?? "a message"}`] : reasons,
    };
  }

  private defaultReason(loop: StationLoop, index: number): string[] {
    if (loop.source === "programme") {
      return [`From the programme ${loop.programme.title}, item ${index + 1} of ${loop.items.length}`];
    }
    return [`Autopilot rotation for ${this.channel.name}${this.tagsText}`];
  }

  /** The channel default's songs, plus station IDs, for filling gaps. */
  async defaultPool(date: string): Promise<Playable[]> {
    const loop = await this.loopFor(date);
    if (!loop.items) return [];
    const songs = loop.items
      .map((ri, i) => (ri.item_type === "song" ? this.playable(ri, loop.source, loop.sourceRef, this.defaultReason(loop, i)) : null))
      .filter((p): p is Playable => !!p);
    return [...songs, ...(await this.stationFillers(loop.source, loop.sourceRef))];
  }

  private fillers: Promise<AudioAsset[]> | null = null;
  /** Sequenced station IDs and jingles: short, and made for the moment before the hour. */
  async stationFillers(source: ItemSource, sourceRef: string, occ?: Occurrence): Promise<Playable[]> {
    this.fillers ??= stationIdAssets(this.db);
    const assets = (await this.fillers).filter((a) => a.play_mode !== "duck_over_music" && a.audio_url && a.duration_seconds > 0);
    return assets.map((a) => ({
      itemType: "station_id",
      trackId: null,
      assetId: a.id,
      label: a.title,
      audioUrl: a.audio_url,
      artworkUrl: null,
      fileMs: a.duration_seconds * 1000,
      blockId: occ?.block.id ?? null,
      blockDate: occ?.date ?? null,
      source,
      sourceRef,
      reasons: ["Station ID"],
    }));
  }

  /** What a block occurrence plays: a programme from item 1, or its own seeded rotation. */
  contentFor(occ: Occurrence): Promise<BlockContent> {
    const key = `${occ.block.id}:${occ.date}:${occ.block.updated_at_ms}`;
    let p = this.blockContent.get(key);
    if (!p) {
      p = this.loadBlockContent(occ);
      this.blockContent.set(key, p);
    }
    return p;
  }

  private async loadBlockContent(occ: Occurrence): Promise<BlockContent> {
    const b = occ.block;
    const capsules = await loadCapsulesFor(this.db, stationDate(occ.startMs));
    const pins = await loadPinnedJingles(this.db);
    const reasons = [occ.daypart ? daypartReason(occ) : blockReason(occ)];

    if (occ.daypart) return this.loadDaypartContent(occ, capsules, pins, reasons);
    if (isHandPlanned(b)) {
      // Laid out by handLayout; this is only the pool live controls recover from.
      return { items: [], pool: await this.handPool(occ), source: "programme", sourceRef: b.list_id ? `list:${b.list_id}` : `block:${b.id}` };
    }

    if (b.fill_kind === "programme") {
      const programme = b.programme_id
        ? await this.db.prepare("SELECT * FROM programmes WHERE id = ?").bind(b.programme_id).first<Programme>()
        : null;
      if (!programme || programme.status !== "published") {
        throw new PlanError(`The ${b.name} block's programme isn't published`);
      }
      const items = withCapsules(await programmeItems(this.db, programme.id, pins), capsules);
      const playable = items.filter((i) => i.audio_url && i.duration_seconds > 0);
      if (playable.length === 0) throw new PlanError(`The ${b.name} block's programme is empty`);
      const pool = items
        .map((ri, i) => (ri.item_type === "song" ? this.playable(ri, "programme", programme.id, [...reasons, `From the programme ${programme.title}, item ${i + 1} of ${items.length}`], occ) : null))
        .filter((x): x is Playable => !!x);
      return { items, pool: [...pool, ...(await this.stationFillers("programme", programme.id, occ))], source: "programme", sourceRef: programme.id, programme };
    }

    const tags = blockTags(b);
    const tracks = await autopilotTracks(this.db, tags.length ? tags : channelTags(this.channel));
    if (tracks.length === 0) throw new PlanError(`No published songs match the ${b.name} block's tags`);
    const rotation = withCapsules(buildRotation(`${b.id}:${occ.date}`, tracks, await stationIdAssets(this.db), pins), capsules);
    const ref = `rotation:${b.id}:${occ.date}`;
    const pool = rotation
      .map((ri) => (ri.item_type === "song" ? this.playable(ri, "autopilot", ref, reasons, occ) : null))
      .filter((x): x is Playable => !!x);
    return { items: rotation, pool: [...pool, ...(await this.stationFillers("autopilot", ref, occ))], source: "autopilot", sourceRef: ref };
  }

  private bands: Promise<Map<string, Set<TimeBand>>> | null = null;

  /**
   * A time-of-day day-part: the channel's songs allowed then (untagged, or
   * tagged with that time of day), shuffled afresh each day. Fewer than
   * MIN_DAYPART_SONGS allowed (a themed channel), and it tops up with the
   * channel's other songs, nearest time of day first, so it never loops a
   * handful of songs for hours. The day's time capsules go in the afternoon only,
   * spread through the hours it actually plays, so each airs once.
   */
  private async loadDaypartContent(occ: Occurrence, capsules: Awaited<ReturnType<typeof loadCapsulesFor>>, pins: Awaited<ReturnType<typeof loadPinnedJingles>>, reasons: string[]): Promise<BlockContent> {
    const band = occ.daypart as TimeBand;
    this.bands ??= songBands(this.db);
    const bands = await this.bands;
    const all = await autopilotTracks(this.db, channelTags(this.channel));
    if (all.length === 0) throw new PlanError(`No published songs match ${this.channel.name}'s tags`);
    const allowed = all.filter((t) => allowedIn(bands.get(t.id), band));
    let tracks = allowed;
    if (allowed.length < MIN_DAYPART_SONGS) {
      // all is in id order, so the top-up is the same every time for the same catalogue.
      const others = all
        .filter((t) => !allowedIn(bands.get(t.id), band))
        .sort((a, b) => bandDistance(bands.get(a.id), band) - bandDistance(bands.get(b.id), band));
      tracks = [...allowed, ...others.slice(0, MIN_DAYPART_SONGS - allowed.length)];
    }
    let rotation = buildRotation(`${this.channel.id}:${occ.block.id}:${occ.date}`, tracks, await stationIdAssets(this.db), pins);
    if (capsules.length && band === "afternoon") {
      const length = daypartSeconds(occ);
      let acc = 0;
      let cut = rotation.findIndex((ri) => (acc += ri.duration_seconds) >= length);
      if (cut < 0) cut = rotation.length - 1;
      rotation = [...withCapsules(rotation.slice(0, cut + 1), capsules), ...rotation.slice(cut + 1)];
    }
    const ref = `rotation:${occ.block.id}:${occ.date}`;
    const pool = rotation
      .map((ri) => (ri.item_type === "song" ? this.playable(ri, "autopilot", ref, reasons, occ) : null))
      .filter((x): x is Playable => !!x);
    return { items: rotation, pool: [...pool, ...(await this.stationFillers("autopilot", ref))], source: "autopilot", sourceRef: ref };
  }

  // ------------------------------------------------------------ the plan

  /**
   * The plan from `fromMs` to at least `toMs`: contiguous items, the first
   * covering `fromMs` (it may begin part-way into its file, see above), the
   * last ending at or after the returned `toMs`. `toMs` moves out to a block
   * boundary when it would otherwise land in the last hour before one, so a
   * version never ends in the middle of a fit.
   */
  async build(fromMs: number, toMs: number, opts: { avoidFirst?: string | null } = {}): Promise<{ items: PlanItem[]; toMs: number }> {
    this.avoidFirst = opts.avoidFirst ?? null;
    const occs = occurrencesBetween(this.blocks, fromMs - 8 * DAY, toMs + 2 * DAY);
    // Autopilot channels: the time no block covers is split into time-of-day day-parts (dayparts.ts).
    const parts = daypartsApply(this.channel) ? daypartsBetween(this.channel, fromMs - 8 * DAY, toMs + 2 * DAY) : [];
    // The day-part covering t, ending where it ends or where the next block starts. It keeps its own
    // start, so after a block it carries on as it was laid out (like a block resuming).
    const daypartAt = (t: number): Occurrence | null => {
      const dp = parts.find((o) => o.startMs <= t && t < o.endMs);
      if (!dp) return null;
      const nextBlock = occs.find((o) => o.startMs > t && o.startMs < dp.endMs);
      return nextBlock ? { ...dp, endMs: nextBlock.startMs } : dp;
    };
    const windowEndAfter = (t: number) => {
      const inBlock = occs.find((o) => o.startMs <= t && t < o.endMs) ?? daypartAt(t);
      if (inBlock) return inBlock.endMs;
      return occs.find((o) => o.startMs > t)?.startMs ?? Infinity;
    };
    const boundary = windowEndAfter(toMs);
    if (boundary !== Infinity && boundary - toMs <= HOUR) toMs = boundary;

    const out: PlanItem[] = [];
    let t = fromMs;
    let afterFlex = false;
    for (let guard = 0; t < toMs && guard < 200; guard++) {
      const occ = occs.find((o) => o.startMs <= t && t < o.endMs) ?? daypartAt(t);
      const next = occ ? occ.endMs : occs.find((o) => o.startMs > t)?.startMs ?? Infinity;
      // A flexible boundary (§2.3): this block ends flexibly AND the next one starts flexibly, right where it ends.
      const following = occ && !occ.cut && !occ.daypart ? occs.find((o) => o.startMs === occ.endMs) : undefined;
      const flexEnd = !!(occ && following && occ.block.end_mode === "flexible" && following.block.start_mode === "flexible");
      // Starting late after a flexible hand-over: a hand-planned block's content starts from its first item.
      const layoutFrom = afterFlex && occ && t > occ.startMs && (occ.originMs ?? occ.startMs) === occ.startMs ? t : undefined;
      afterFlex = flexEnd;
      const items = occ
        ? isHandPlanned(occ.block) && !occ.daypart
          ? await this.handWindow(occ, t, out, flexEnd, layoutFrom)
          : await this.blockWindow(occ, t, toMs, out, flexEnd)
        : await this.defaultWindow(t, next, toMs, occs, out);
      if (items.length === 0) {
        throw new PlanError(`Nothing to play from ${parisHHMM(t)}`);
      }
      out.push(...items);
      t = items[items.length - 1].endsAt;
    }
    return { items: out, toMs };
  }

  private recentMap(items: PlanItem[]): Map<string, number> {
    const m = new Map<string, number>();
    for (const i of items) m.set(contentKey(i), i.startsAt);
    return m;
  }

  /** A block's items from `t` (its start, or later when resuming) up to its end - or past `limit` if that comes first. */
  private async blockWindow(occ: Occurrence, t: number, limit: number, before: PlanItem[], flexEnd = false): Promise<PlanItem[]> {
    const content = await this.contentFor(occ);
    const reasons = [occ.daypart ? daypartReason(occ) : blockReason(occ)];
    const seq = content.items
      .map((ri, i) =>
        this.playable(
          ri,
          content.source,
          content.sourceRef,
          content.programme ? [...reasons, `From the programme ${content.programme.title}, item ${i + 1} of ${content.items.length}`] : reasons,
          occ
        )
      )
      .filter((p): p is Playable => !!p);
    if (seq.length === 0) throw new PlanError(`The ${occ.block.name} block has nothing playable`);

    // Laid out from the block's start, deterministically, so resuming part-way lands where the published log is.
    // After a higher layer cut into it, that's still the occurrence's own start (originMs, §2.2).
    const origin = occ.originMs ?? occ.startMs;
    const recent = this.recentMap(before.filter((i) => i.startsAt >= origin - REPEAT_WINDOW_MS));
    const emitEnd = Math.min(occ.endMs, limit);
    const all: PlanItem[] = [];
    let cursor = origin;
    let skipped = 0;
    for (let k = 0; cursor < emitEnd && k < 20_000; k++) {
      const p = seq[k % seq.length];
      const key = contentKey(p);
      const last = recent.get(key);
      // No song twice within two hours, unless the pool is too small to avoid it.
      if (content.source === "autopilot" && p.itemType === "song" && last !== undefined && cursor - last < REPEAT_WINDOW_MS && skipped < seq.length) {
        skipped++;
        continue;
      }
      skipped = 0;
      const item: PlanItem = { ...p, startsAt: cursor, endsAt: cursor + p.fileMs, offset: 0 };
      all.push(item);
      recent.set(key, cursor);
      cursor = item.endsAt;
    }

    // Resuming at t: the item covering t starts whole at t.
    let from = all.findIndex((i) => i.endsAt > t);
    if (from < 0) from = all.length;
    let items = all.slice(from);
    if (items.length && items[0].startsAt !== t) items = relayFrom(items, t);
    items = this.notTheSameAgain(items, t);

    if (occ.endMs > limit) return items; // the fit happens in a later version (limit is never within an hour of the end)
    // Flexible into flexible: the last item that starts before the boundary plays to its natural end, and the next block starts after it.
    if (flexEnd) return items;
    const endLabel = parisHHMM(occ.endMs);
    return fitToWindow(items, t, occ.endMs, content.pool, this.recentMap([...before, ...all.slice(0, from)]), {
      dropped: `Dropped so the ${occ.block.name} block ends on time at ${endLabel}`,
      added: (gap) => `Added to fill ${mmss(gap)} at the end of the ${occ.block.name} block`,
      trimmed: (ms) => `Faded ${mmss(ms)} early so ${endLabel} starts on time`,
    }).items;
  }

  // ------------------------------------------------------------ hand-planned blocks (§3)

  private resolvers = new Map<string, SlotResolver>();
  resolverFor(b: GridBlock): SlotResolver {
    let r = this.resolvers.get(b.id);
    if (!r) {
      const tags = blockTags(b);
      r = new SlotResolver(this.db, tags.length ? tags : channelTags(this.channel));
      this.resolvers.set(b.id, r);
    }
    return r;
  }

  private handPools = new Map<string, Promise<Playable[]>>();
  /**
   * What tops up a hand-planned block: a playlist or template block's own
   * pool (its tags, else the channel's songs), or for a manual block the
   * safety net, the channel default's pool.
   */
  handPool(occ: Occurrence): Promise<Playable[]> {
    const key = `${occ.block.id}:${occ.date}`;
    let p = this.handPools.get(key);
    if (!p) {
      p = (async () => {
        const b = occ.block;
        if (b.fill_kind === "manual") {
          const pool = await this.defaultPool(stationDate(occ.startMs));
          return pool.map((x) => ({ ...x, blockId: b.id, blockDate: occ.date, reasons: [blockReason(occ), "Safety net: the channel's own music fills what the running order leaves"] }));
        }
        const tags = blockTags(b);
        const ref = `pool:${b.id}:${occ.date}`;
        const songs = (await autopilotTracks(this.db, tags.length ? tags : channelTags(this.channel)))
          .map(trackPlayable)
          .filter((x): x is Playable => !!x)
          .map((x) => ({ ...x, source: "autopilot" as const, sourceRef: ref, blockId: b.id, blockDate: occ.date, reasons: [blockReason(occ), `From the ${b.name} block's pool`] }));
        return [...songs, ...(await this.stationFillers("autopilot", ref, occ))];
      })();
      this.handPools.set(key, p);
    }
    return p;
  }

  /** The slots an occurrence plays, in order: its running order, else its template or playlist (§3.1-3.3). */
  handEntries(occ: Occurrence): HandEntry[] {
    const b = occ.block;
    const ro = this.content.running_orders.find((r) => r.block_id === b.id && r.date === occ.date);
    const day = shortDay(occ.date);
    if ((b.fill_kind === "template" || b.fill_kind === "manual") && ro) {
      const what = b.fill_kind === "template" ? `the ${b.name} episode for ${day}` : `the running order for ${day}`;
      return ro.items.map((slot) => ({ slot, ref: `ro:${ro.id}`, owner: ro.id, why: `From ${what}, item ${slot.position}${slot.label ? ` (${slot.label})` : ""}` }));
    }
    if (b.fill_kind === "manual" || !b.list_id) return [];
    const list = this.content.lists[b.list_id];
    if (!list) return [];
    const word = list.kind === "template" ? "template" : "playlist";
    return list.slots
      // A template's episode slots are left out until an episode fills them (§3.2).
      .filter((slot) => slot.slot_kind !== "episode")
      .map((slot) => ({ slot, ref: `list:${list.id}`, owner: list.id, why: `From the ${word} ${list.name}, item ${slot.position}${slot.label ? ` (${slot.label})` : ""}` }));
  }

  /**
   * A hand-planned occurrence laid out whole from its start (or from
   * `layoutFrom` after a flexible hand-over), fitted to each internal anchor
   * and to the block's own end. Deterministic, so resuming part-way lands
   * where the published log is.
   */
  async handLayout(occ: Occurrence, before: PlanItem[], layoutFrom?: number): Promise<{ items: PlanItem[]; anchors: number[]; fullEnd: number; pool: Playable[] }> {
    const b = occ.block;
    const origin = occ.originMs ?? occ.startMs;
    const fullEnd = occurrenceOn(b, occ.date)?.endMs ?? occ.endMs;
    const start = Math.max(origin, layoutFrom ?? origin);
    const pool = await this.handPool(occ);
    const resolver = this.resolverFor(b);
    const base = blockReason(occ);
    const recent = this.recentMap(before.filter((i) => i.startsAt >= start - REPEAT_WINDOW_MS));
    const picked = new Set<string>();

    // Split at internal anchors (template and manual blocks): each stretch runs until the next anchored slot's time.
    const anchored = b.fill_kind !== "playlist";
    const segs: { at: number | null; entries: HandEntry[] }[] = [{ at: null, entries: [] }];
    for (const e of this.handEntries(occ)) {
      if (anchored && e.slot.at_ms !== null && e.slot.at_ms !== undefined) segs.push({ at: origin + e.slot.at_ms, entries: [e] });
      else segs[segs.length - 1].entries.push(e);
    }
    const anchors = segs.filter((s) => s.at !== null).map((s) => s.at as number);

    const resolve = async (e: HandEntry, cursor: number, round: number): Promise<PlanItem | null> => {
      const s = e.slot;
      let p: Playable | null = null;
      let reasons = [base, e.why];
      let ref = e.ref;
      if (s.slot_kind === "fixed") p = await resolver.fixed(s);
      else if (s.slot_kind === "rule") {
        const rule = parseRule(s.rule_json);
        if (rule) {
          p = await resolver.pick(rule, `${b.id}:${occ.date}:${s.position}${round ? `:${round}` : ""}`, cursor, recent, picked, REPEAT_WINDOW_MS);
          reasons = [...reasons, `Rule slot: ${describeRule(rule)}`];
          ref = `rule:${e.owner}:${s.position}`;
        }
      }
      // An empty episode slot, missing audio, or a rule nothing matches: skipped (validation reports it beforehand).
      if (!p) return null;
      const item: PlanItem = {
        ...p, source: "programme", sourceRef: ref, blockId: b.id, blockDate: occ.date, reasons,
        fixed: s.slot_kind === "fixed" && !s.auto_filled, startsAt: cursor, endsAt: cursor + p.fileMs, offset: 0,
      };
      picked.add(contentKey(item));
      recent.set(contentKey(item), cursor);
      return item;
    };

    const out: PlanItem[] = [];
    let cursor = start;
    for (let k = 0; k < segs.length; k++) {
      const seg = segs[k];
      const segStart = Math.max(cursor, seg.at ?? cursor);
      const segEnd = k + 1 < segs.length ? (segs[k + 1].at as number) : fullEnd;
      const isEnd = k === segs.length - 1;
      let items: PlanItem[] = [];
      let c = segStart;
      for (let round = 0; round < 50; round++) {
        let added = 0;
        for (const e of seg.entries) {
          const it = await resolve(e, c, round);
          if (!it) continue;
          items.push(it);
          c = it.endsAt;
          added++;
        }
        // A playlist that loops (when_short = 'loop') goes round again until the block is full.
        if (!(b.fill_kind === "playlist" && b.when_short === "loop" && isEnd) || added === 0 || c >= segEnd) break;
      }
      if (segEnd <= segStart) {
        // The content before this anchor already ran past it: play on from here (validation reports it).
        out.push(...items);
        cursor = c;
        continue;
      }
      const at = parisHHMM(segEnd);
      items = fitToWindow(items, segStart, segEnd, pool, this.recentMap([...before, ...out]), {
        dropped: isEnd ? `Dropped so the ${b.name} block ends on time at ${at}` : `Dropped so the ${b.name} item at ${at} starts on time`,
        added: (gap) => (isEnd ? `Added to fill ${mmss(gap)} at the end of the ${b.name} block` : `Added to fill ${mmss(gap)} before the ${b.name} item at ${at}`),
        trimmed: (ms) => `Faded ${mmss(ms)} early so ${at} starts on time`,
      }).items;
      out.push(...items);
      cursor = items.length ? items[items.length - 1].endsAt : segEnd;
    }
    return { items: out, anchors, fullEnd, pool };
  }

  /** A hand-planned block's items from `t` to its end (across a flexible hand-over, to its last item's natural end). */
  private async handWindow(occ: Occurrence, t: number, before: PlanItem[], flexEnd: boolean, layoutFrom?: number): Promise<PlanItem[]> {
    const { items: full, anchors, fullEnd, pool } = await this.handLayout(occ, before, layoutFrom);
    const recent = this.recentMap(before);
    const from = full.findIndex((i) => i.endsAt > t);
    let items = from < 0 ? [] : full.slice(from);
    if (items.length && items[0].startsAt !== t) {
      // Resuming after a higher layer's special: the item covering t starts whole at t, refitted up to the next anchor.
      const nextB = Math.min(anchors.find((a) => a > t) ?? Infinity, occ.endMs);
      const at = parisHHMM(nextB);
      const head = relayFrom(items.filter((i) => i.startsAt < nextB).map((i, k) => (k === 0 ? { ...i, offset: 0 } : i)), t);
      const fitted = fitToWindow(head, t, nextB, pool, recent, {
        dropped: `Dropped so ${at} starts on time`,
        added: (gap) => `Added to fill ${mmss(gap)} in the ${occ.block.name} block`,
        trimmed: (ms) => `Faded ${mmss(ms)} early so ${at} starts on time`,
      }).items;
      items = [...fitted, ...items.filter((i) => i.startsAt >= nextB)];
    }
    if (occ.endMs < fullEnd) {
      // Cut short by a higher layer: always a hard boundary.
      const at = parisHHMM(occ.endMs);
      items = fitToWindow(items.filter((i) => i.startsAt < occ.endMs), t, occ.endMs, pool, recent, {
        dropped: `Dropped so the special at ${at} starts on time`,
        added: (gap) => `Added to fill ${mmss(gap)} before the special at ${at}`,
        trimmed: (ms) => `Faded ${mmss(ms)} early so the special at ${at} starts on time`,
      }).items;
    } else if (flexEnd && items.length) {
      // Flexible into flexible: the last item plays to its natural end (§2.3).
      const last = items[items.length - 1];
      const natural = last.startsAt + last.fileMs - last.offset;
      if (last.endsAt < natural) items[items.length - 1] = { ...last, endsAt: natural, reasons: last.reasons.filter((r) => !r.startsWith("Faded")) };
    }
    return items;
  }

  /** The channel default from `t` until `windowEnd` (the next block start, or open-ended), or past `limit`. */
  private async defaultWindow(t: number, windowEnd: number, limit: number, occs: Occurrence[], before: PlanItem[]): Promise<PlanItem[]> {
    // A stretch after a block is re-anchored at the block's end; otherwise it's the exact old loop.
    const prev = [...occs].reverse().find((o) => o.endMs <= t);
    const emitEnd = Math.min(windowEnd, limit);
    const items: PlanItem[] = [];

    // The loop changes only at London midnights; walk them.
    let cursor = t;
    let date = stationDate(t);
    let anchor: { ms: number; loop: StationLoop } | null = null;
    if (prev) {
      // Re-anchor at the block end, carrying through any loop change since then.
      anchor = await this.shiftedAnchor(prev.endMs, t);
    }
    for (let guard = 0; cursor < emitEnd && guard < 40; guard++) {
      const loop = await this.loopFor(date);
      if (!loop.items) break;
      // Run on to the first London midnight where the loop actually changes.
      let changeDate: string | null = null;
      let nextLoop: LoopResult | null = null;
      for (let d = addDaysTo(date, 1), g = 0; stationDayStartMs(d) < emitEnd && g < 10; d = addDaysTo(d, 1), g++) {
        const l = await this.loopFor(d);
        if (l.fingerprint !== loop.fingerprint) {
          changeDate = d;
          nextLoop = l;
          break;
        }
      }
      const changesAtMidnight = changeDate !== null;
      const dayEnd = changeDate ? stationDayStartMs(changeDate) : Infinity;
      const segEnd = changesAtMidnight ? Math.min(dayEnd, emitEnd) : emitEnd;

      const anchorMs = anchor && anchor.loop.fingerprint === loop.fingerprint ? anchor.ms : loop.anchorMs;
      const run = this.materialise(loop, anchorMs, cursor, segEnd);
      if (run.length === 0) break;
      if (changesAtMidnight && run[run.length - 1].endsAt > segEnd && segEnd < emitEnd) {
        // As before the Scheduler: the new day's loop takes over at midnight.
        run[run.length - 1].endsAt = segEnd;
      }
      items.push(...run);
      cursor = run[run.length - 1].endsAt;
      if (changesAtMidnight && segEnd === dayEnd) {
        date = changeDate as string;
        if (!nextLoop?.items) break;
        // After a block, the new day's loop starts with a whole item at midnight.
        if (anchor) anchor = { ms: this.anchorForWholeItemAt(nextLoop, dayEnd), loop: nextLoop };
      } else if (cursor >= segEnd) {
        break;
      }
    }

    // In "after a block" mode, the item covering t starts whole at t (it does whenever the log was built from this same plan).
    if (anchor && items.length && items[0].offset > 0) {
      const relaid = relayFrom(items.map((i, k) => (k === 0 ? { ...i, offset: 0, endsAt: 0, startsAt: 0 } : i)), t);
      items.splice(0, items.length, ...relaid.filter((i) => i.startsAt < emitEnd));
    }
    if (items.length && items[0].offset === 0) {
      const fixed = this.notTheSameAgain(items, t);
      items.splice(0, items.length, ...fixed.filter((i) => i.startsAt < emitEnd || i === fixed[fixed.length - 1]));
    }

    if (windowEnd === Infinity || windowEnd > limit || items.length === 0) return items;
    const nextOcc = occs.find((o) => o.startMs === windowEnd);
    const name = nextOcc?.block.name ?? "the next block";
    const at = parisHHMM(windowEnd);
    return fitToWindow(items, t, windowEnd, await this.defaultPool(stationDate(t)), this.recentMap(before), {
      dropped: `Dropped so the ${name} block starts on time at ${at}`,
      added: (gap) => `Added to fill ${mmss(gap)} before the ${name} block at ${at}`,
      trimmed: (ms) => `Faded ${mmss(ms)} early so the ${name} block starts on time at ${at}`,
    }).items;
  }

  /**
   * A rebuild starts where the song on air ends. If the new plan would open
   * with that very song (a grid edit can re-anchor the loop), skip it rather
   * than play it twice in a row. Only the first window of a build is checked.
   */
  private notTheSameAgain(items: PlanItem[], t: number): PlanItem[] {
    const avoid = this.avoidFirst;
    this.avoidFirst = null;
    if (!avoid || items.length < 2 || contentKey(items[0]) !== avoid) return items;
    return relayFrom(items.slice(1).map((i, k) => (k === 0 ? { ...i, offset: 0 } : i)), t);
  }

  /** Loop items covering [from, until): the first may begin part-way through its file. */
  private materialise(loop: StationLoop, anchorMs: number, from: number, until: number): PlanItem[] {
    const out: PlanItem[] = [];
    const n = loop.items.length;
    const starts: number[] = [];
    let acc = 0;
    for (const it of loop.items) {
      starts.push(acc);
      acc += it.duration_seconds * 1000;
    }
    let k = Math.floor((from - anchorMs) / loop.loopMs);
    let loopStart = anchorMs + k * loop.loopMs;
    // The item covering `from`.
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const s = loopStart + starts[i];
      const e = s + loop.items[i].duration_seconds * 1000;
      if (from < e && loop.items[i].duration_seconds > 0) {
        idx = i;
        break;
      }
      idx = i + 1;
    }
    if (idx >= n) {
      idx = 0;
      k++;
      loopStart = anchorMs + k * loop.loopMs;
    }
    for (let guard = 0; guard < 20_000; guard++) {
      const ri = loop.items[idx];
      const s = loopStart + starts[idx];
      if (s >= until) break;
      const p = this.playable(ri, loop.source, loop.sourceRef, this.defaultReason(loop, idx));
      if (!p && ri.duration_seconds > 0) throw new PlanError(`"${ri.label ?? "An item"}" has no audio`);
      if (p) {
        const offset = Math.max(0, from - s);
        out.push({ ...p, startsAt: s + offset, endsAt: s + p.fileMs, offset });
      }
      idx++;
      if (idx >= n) {
        idx = 0;
        k++;
        loopStart = anchorMs + k * loop.loopMs;
      }
    }
    return out;
  }

  /** An anchor that makes the loop item covering `at` start exactly at `at`. */
  private anchorForWholeItemAt(loop: StationLoop, at: number): number {
    const [first] = this.materialise(loop, loop.anchorMs, at, at + 1);
    return first ? loop.anchorMs + first.offset : loop.anchorMs;
  }

  /** The re-anchored loop in force at `t` for a default stretch that began at a block's end. */
  private async shiftedAnchor(blockEnd: number, t: number): Promise<{ ms: number; loop: StationLoop } | null> {
    let date = stationDate(blockEnd);
    let loop = await this.loopFor(date);
    if (!loop.items) return null;
    let anchor = { ms: this.anchorForWholeItemAt(loop, blockEnd), loop };
    for (let guard = 0; guard < 10; guard++) {
      const nextDate = addDaysTo(date, 1);
      const midnight = stationDayStartMs(nextDate);
      if (midnight > t) break;
      const next = await this.loopFor(nextDate);
      if (!next.items) return null;
      if (next.fingerprint !== loop.fingerprint) anchor = { ms: this.anchorForWholeItemAt(next, midnight), loop: next };
      loop = next;
      date = nextDate;
    }
    return anchor;
  }
}

/** Items laid back to back from `start`, each whole (offset 0) unless it had been trimmed. */
function relayFrom(items: PlanItem[], start: number): PlanItem[] {
  let cursor = start;
  return items.map((i, k) => {
    const len = k === 0 ? i.fileMs : i.endsAt - i.startsAt;
    const o = { ...i, offset: k === 0 ? 0 : i.offset, startsAt: cursor, endsAt: cursor + len };
    cursor += len;
    return o;
  });
}
