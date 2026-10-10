import { Hono } from "hono";
import type { Channel, Env } from "../lib/types";
import { newId } from "../lib/id";
import { hashSeed, seededShuffle } from "../lib/radioBrain";
import { channelTags } from "../lib/station";
import {
  describeRule,
  LINK_KINDS,
  loadLists,
  loadRunningOrder,
  parseRule,
  SlotResolver,
  writeListStatements,
  writeRunningOrderStatements,
  type ListSlot,
  type SnapshotList,
  type SnapshotRunningOrder,
} from "../lib/scheduler/content";
import { bestCombo } from "../lib/scheduler/fit";
import { blockLengthMin, blockRunsOn, loadWorkingBlocks, occurrenceOn, occurrencesBetween, type GridBlock } from "../lib/scheduler/grid";
import { blockLengthMs, estimateSlots, hms, occurrenceSource, resolverForBlock, startTimes, sumMs } from "../lib/scheduler/handCheck";
import { channelDraft, type ChannelDraft } from "../lib/scheduler/planPublish";
import { isHandPlanned, Planner } from "../lib/scheduler/plan";
import { latestPlan, snapshotContent, snapshotWorkingCopy } from "../lib/scheduler/plans";
import { addDaysTo, MINUTE, parisDate, shortDay } from "../lib/scheduler/time";
import { itemsBetween } from "../lib/scheduler/timeline";
import { contentKey, TOLERANCE_MS, type Playable } from "../lib/scheduler/types";
import { validatePlan } from "../lib/scheduler/validate";

/**
 * Hand-planned content in the working copy (handoff §3, §4.1, §6, §7):
 * playlists and templates, running orders (a manual block's hour, a
 * template block's episode), Create next episode, Auto-fill, and the hour
 * zoom. Like every working-copy edit, nothing here reaches the air until the
 * channel is published; each write returns the affected channels' drafts.
 */
export const contentRoutes = new Hono<{ Bindings: Env }>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const channelById = (db: D1Database, id: string) => db.prepare("SELECT * FROM channels WHERE id = ?").bind(id).first<Channel>();

async function draftsFor(env: Env, channels: Channel[]): Promise<Record<string, ChannelDraft>> {
  const out: Record<string, ChannelDraft> = {};
  const nowMs = Date.now();
  for (const ch of channels) out[ch.slug] = await channelDraft(env, ch, nowMs);
  return out;
}

/** The channels whose working blocks use a list. */
async function listUsers(db: D1Database, listId: string) {
  const { results } = await db
    .prepare(
      `SELECT b.id AS block_id, b.name AS block_name, b.channel_id, c.slug AS channel_slug, c.name AS channel_name
       FROM sched_blocks b JOIN channels c ON c.id = b.channel_id WHERE b.list_id = ? AND b.active = 1 ORDER BY c.name, b.name`
    )
    .bind(listId)
    .all<{ block_id: string; block_name: string; channel_id: string; channel_slug: string; channel_name: string }>();
  return results;
}

async function workingBlock(db: D1Database, id: string): Promise<GridBlock | null> {
  const row = await db.prepare("SELECT channel_id FROM sched_blocks WHERE id = ?").bind(id).first<{ channel_id: string }>();
  if (!row) return null;
  return (await loadWorkingBlocks(db, row.channel_id, true)).find((b) => b.id === id) ?? null;
}

// ------------------------------------------------------------------ slots in, checked

/** Slots from the editor: each one checked for shape; positions are renumbered in order. */
function parseSlots(raw: unknown, kind: "playlist" | "template" | "running_order"): { ok: true; slots: ListSlot[] } | { ok: false; message: string } {
  if (!Array.isArray(raw)) return { ok: false, message: "No items." };
  if (raw.length > 300) return { ok: false, message: "That's more than 300 items." };
  const slots: ListSlot[] = [];
  for (const [i, r] of raw.entries()) {
    const o = (r ?? {}) as Record<string, unknown>;
    const slot_kind = o.slot_kind === "rule" || o.slot_kind === "episode" ? o.slot_kind : "fixed";
    if (slot_kind === "episode" && kind === "playlist") return { ok: false, message: "Playlists don't have episode slots." };
    const label = typeof o.label === "string" ? o.label.replace(/\s+/g, " ").trim().slice(0, 60) || null : null;
    const atRaw = o.at_ms === null || o.at_ms === undefined || o.at_ms === "" ? null : Number(o.at_ms);
    if (atRaw !== null && (!Number.isFinite(atRaw) || atRaw < 0 || atRaw > 24 * 60 * MINUTE)) return { ok: false, message: `Item ${i + 1}: that time isn't inside the show.` };
    const at_ms = kind === "playlist" || atRaw === null ? null : Math.round(atRaw / 1000) * 1000;
    let track_id: string | null = null;
    let audio_asset_id: string | null = null;
    let rule_json: string | null = null;
    if (slot_kind === "fixed") {
      track_id = typeof o.track_id === "string" && o.track_id ? o.track_id : null;
      audio_asset_id = track_id ? null : typeof o.audio_asset_id === "string" && o.audio_asset_id ? o.audio_asset_id : null;
      if (!track_id && !audio_asset_id) return { ok: false, message: `Item ${i + 1}: choose a song or audio item.` };
    } else if (slot_kind === "rule") {
      const rule = parseRule(typeof o.rule_json === "string" ? o.rule_json : JSON.stringify(o.rule ?? null));
      if (!rule) return { ok: false, message: `Item ${i + 1}: choose what the rule picks.` };
      rule_json = JSON.stringify(rule);
    } else if (!label) return { ok: false, message: `Item ${i + 1}: give the episode slot a label, like "Interview".` };
    slots.push({ position: i + 1, slot_kind, track_id, audio_asset_id, rule_json, label, at_ms, ...(kind === "running_order" ? { auto_filled: o.auto_filled ? 1 : 0 } : {}) });
  }
  // Anchors in order: a later item can't be pinned earlier than one before it.
  let last = -1;
  for (const s of slots) {
    if (s.at_ms === null) continue;
    if (s.at_ms < last) return { ok: false, message: `Item ${s.position}: its time is earlier than the pinned item before it.` };
    last = s.at_ms;
  }
  return { ok: true, slots };
}

/** Slots with what they are, for the editors. */
async function describeSlots(resolver: SlotResolver, slots: ListSlot[]) {
  const est = await estimateSlots(resolver, slots);
  const starts = startTimes(est);
  return est.map((e, i) => ({ ...e, rule: slots[i].rule_json ? parseRule(slots[i].rule_json) : null, starts_ms: starts[i] }));
}

// ------------------------------------------------------------------ playlists and templates (§7)

/** GET /plan/lists?kind=playlist|template&archived=1 */
contentRoutes.get("/lists", async (c) => {
  const kind = c.req.query("kind") === "template" ? "template" : c.req.query("kind") === "playlist" ? "playlist" : null;
  const lists = Object.values(await loadLists(c.env.DB)).filter((l) => (!kind || l.kind === kind) && (c.req.query("archived") === "1" || !l.archived));
  const resolver = new SlotResolver(c.env.DB, []);
  const out = [];
  for (const l of lists) {
    const est = await estimateSlots(resolver, l.slots);
    out.push({
      id: l.id, kind: l.kind, name: l.name, description: l.description, length_ms: l.length_ms, archived: l.archived, updated_at_ms: l.updated_at_ms,
      slot_count: l.slots.length,
      total_ms: sumMs(est),
      // Rule slots are counted at the average length of what they could pick.
      about: est.some((e) => e.slot_kind === "rule"),
      episode_slots: est.filter((e) => e.empty).length,
      used_by: await listUsers(c.env.DB, l.id),
    });
  }
  return c.json({ lists: out });
});

/** GET /plan/lists/:id */
contentRoutes.get("/lists/:id", async (c) => {
  const l = (await loadLists(c.env.DB, [c.req.param("id")]))[c.req.param("id")];
  if (!l) return c.json({ error: "not_found", message: "That list no longer exists." }, 404);
  const slots = await describeSlots(new SlotResolver(c.env.DB, []), l.slots);
  return c.json({ list: { ...l, slots }, used_by: await listUsers(c.env.DB, l.id), link_kinds: LINK_KINDS });
});

/** POST /plan/lists {kind, name, description?, length_ms?} */
contentRoutes.post("/lists", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const kind = body.kind === "template" ? "template" : "playlist";
  const name = String(body.name ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) return c.json({ error: "invalid", field: "name", message: `Give the ${kind} a name.` }, 400);
  const now = Date.now();
  const l: SnapshotList = {
    id: newId("lst"), kind, name, description: String(body.description ?? "").trim().slice(0, 200),
    length_ms: kind === "template" && Number(body.length_ms) > 0 ? Math.round(Number(body.length_ms)) : null, archived: 0, updated_at_ms: now, slots: [],
  };
  await c.env.DB.batch(writeListStatements(c.env.DB, l));
  return c.json({ ok: true, list: l });
});

/**
 * PUT /plan/lists/:id {name, description, length_ms, archived, slots, expected_updated_at_ms}
 * A working-copy change for every channel with a block using it.
 */
contentRoutes.put("/lists/:id", async (c) => {
  const id = c.req.param("id");
  const existing = (await loadLists(c.env.DB, [id]))[id];
  if (!existing) return c.json({ error: "not_found", message: "That list no longer exists." }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  if (body.expected_updated_at_ms !== undefined && Number(body.expected_updated_at_ms) !== existing.updated_at_ms) {
    return c.json({ error: "changed", message: "This list changed in another tab. Here's the latest." }, 409);
  }
  const name = body.name === undefined ? existing.name : String(body.name).replace(/\s+/g, " ").trim().slice(0, 60);
  if (!name) return c.json({ error: "invalid", field: "name", message: "Give it a name." }, 400);
  let slots = existing.slots;
  if (body.slots !== undefined) {
    const parsed = parseSlots(body.slots, existing.kind);
    if (!parsed.ok) return c.json({ error: "invalid", field: "slots", message: parsed.message }, 400);
    slots = parsed.slots;
  }
  const lengthIn = body.length_ms === undefined ? existing.length_ms : Number(body.length_ms) > 0 ? Math.round(Number(body.length_ms)) : null;
  const l: SnapshotList = {
    ...existing,
    name,
    description: body.description === undefined ? existing.description : String(body.description).trim().slice(0, 200),
    length_ms: existing.kind === "template" ? lengthIn : null,
    archived: body.archived === undefined ? existing.archived : body.archived ? 1 : 0,
    updated_at_ms: Math.max(Date.now(), existing.updated_at_ms + 1),
    slots,
  };
  await c.env.DB.batch(writeListStatements(c.env.DB, l));
  const users = await listUsers(c.env.DB, id);
  const channels = (await Promise.all([...new Set(users.map((u) => u.channel_id))].map((cid) => channelById(c.env.DB, cid)))).filter((x): x is Channel => !!x);
  return c.json({ ok: true, list: { ...l, slots: await describeSlots(new SlotResolver(c.env.DB, []), l.slots) }, used_by: users, drafts: await draftsFor(c.env, channels) });
});

/** POST /plan/lists/:id/duplicate */
contentRoutes.post("/lists/:id/duplicate", async (c) => {
  const id = c.req.param("id");
  const existing = (await loadLists(c.env.DB, [id]))[id];
  if (!existing) return c.json({ error: "not_found", message: "That list no longer exists." }, 404);
  const copy: SnapshotList = { ...existing, id: newId("lst"), name: `${existing.name} (copy)`.slice(0, 60), archived: 0, updated_at_ms: Date.now() };
  await c.env.DB.batch(writeListStatements(c.env.DB, copy));
  return c.json({ ok: true, list: copy });
});

// ------------------------------------------------------------------ running orders (§3.3, §3.5, §6.2)

/** Everything the running-order editor needs for one occurrence. */
async function runningOrderPayload(env: Env, b: GridBlock, date: string) {
  const ch = (await channelById(env.DB, b.channel_id))!;
  const nowMs = Date.now();
  const working = await snapshotWorkingCopy(env.DB, ch.id, nowMs);
  const ro = await loadRunningOrder(env.DB, b.id, date);
  // An occurrence in the past isn't in the snapshot's running orders: read it directly.
  const content = { lists: { ...working.lists, ...(b.list_id ? await loadLists(env.DB, [b.list_id]) : {}) }, running_orders: ro ? [ro] : [] };
  const src = occurrenceSource(b, date, content);
  const resolver = resolverForBlock(env.DB, b, channelTags(ch));
  const slots = await describeSlots(resolver, src.slots);
  const occ = occurrenceOn(b, date);
  const lengthMs = blockLengthMs(b);
  // "Let it run over" is offered only when what follows starts flexibly (§6.3).
  const following = occ ? occurrencesBetween(working.blocks.filter((x) => x.active), occ.endMs - 1, occ.endMs + 1).find((o) => o.startMs === occ.endMs) : undefined;
  // Measured as the editor shows it: each item after the one before, or at its pinned time.
  const estMs = slots.reduce((end, s) => Math.max(end, s.starts_ms + (s.empty ? 0 : (s.ms ?? 0))), 0);
  const issues = (await validatePlan(env.DB, ch, working.blocks, nowMs, snapshotContent(working))).filter((i) => i.block_id === b.id && (!i.date || i.date === date));
  return {
    channel: { slug: ch.slug, name: ch.name },
    block: { id: b.id, name: b.name, fill_kind: b.fill_kind, mode: b.mode, start_min: b.start_min, end_min: b.end_min, end_mode: b.end_mode, list_id: b.list_id, colour: b.colour },
    date,
    date_label: shortDay(date),
    runs_that_day: blockRunsOn(b, date),
    start_ms: occ?.startMs ?? null,
    end_ms: occ?.endMs ?? null,
    length_ms: lengthMs,
    source: src.ro ? "running_order" : src.list ? src.list.kind : "none",
    editable: b.fill_kind === "manual" || (b.fill_kind === "template" && !!src.ro),
    list: src.list ? { id: src.list.id, name: src.list.name, kind: src.list.kind } : null,
    running_order: ro ? { id: ro.id, note: ro.note, from_list_id: ro.from_list_id, updated_at_ms: ro.updated_at_ms } : null,
    items: slots,
    fixed_ms: sumMs(slots, true),
    est_ms: estMs,
    unfilled_ms: Math.max(0, lengthMs - estMs),
    over_ms: Math.max(0, estMs - lengthMs),
    about: slots.some((s) => s.slot_kind === "rule"),
    next_flexible: following?.block.start_mode === "flexible",
    issues,
    drafts: await draftsFor(env, [ch]),
  };
}

const okDate = (d: string) => DATE_RE.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`));

/** GET /plan/running-orders/:blockId/:date */
contentRoutes.get("/running-orders/:blockId/:date", async (c) => {
  const b = await workingBlock(c.env.DB, c.req.param("blockId"));
  const date = c.req.param("date");
  if (!b || !okDate(date)) return c.json({ error: "not_found", message: "That block no longer exists." }, 404);
  return c.json(await runningOrderPayload(c.env, b, date));
});

/** PUT /plan/running-orders/:blockId/:date {items, note?, expected_updated_at_ms?} - replaces the whole list at once. */
contentRoutes.put("/running-orders/:blockId/:date", async (c) => {
  const b = await workingBlock(c.env.DB, c.req.param("blockId"));
  const date = c.req.param("date");
  if (!b || !okDate(date)) return c.json({ error: "not_found", message: "That block no longer exists." }, 404);
  if (b.fill_kind !== "manual" && b.fill_kind !== "template") return c.json({ error: "invalid", message: "Only manual and template blocks have running orders." }, 400);
  if (!blockRunsOn(b, date)) return c.json({ error: "invalid", message: `${b.name} doesn't run on ${shortDay(date)}.` }, 400);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const existing = await loadRunningOrder(c.env.DB, b.id, date);
  // Optimistic: the editor sends the updated_at it loaded (null when there wasn't one yet).
  if (body.expected_updated_at_ms !== undefined && (existing?.updated_at_ms ?? null) !== (body.expected_updated_at_ms === null ? null : Number(body.expected_updated_at_ms))) {
    return c.json({ error: "changed", message: "This running order changed in another tab. Here's the latest.", ...(await runningOrderPayload(c.env, b, date)) }, 409);
  }
  const parsed = parseSlots(body.items, "running_order");
  if (!parsed.ok) return c.json({ error: "invalid", field: "items", message: parsed.message }, 400);
  const ro: SnapshotRunningOrder = {
    id: existing?.id ?? newId("ro"),
    block_id: b.id,
    date,
    from_list_id: existing?.from_list_id ?? null,
    note: body.note === undefined ? (existing?.note ?? "") : String(body.note).slice(0, 500),
    updated_at_ms: Math.max(Date.now(), (existing?.updated_at_ms ?? 0) + 1),
    items: parsed.slots,
  };
  await c.env.DB.batch(writeRunningOrderStatements(c.env.DB, ro));
  return c.json({ ok: true, ...(await runningOrderPayload(c.env, b, date)) });
});

/** DELETE /plan/running-orders/:blockId/:date - back to the template (or, for a manual block, the safety net). */
contentRoutes.delete("/running-orders/:blockId/:date", async (c) => {
  const b = await workingBlock(c.env.DB, c.req.param("blockId"));
  const date = c.req.param("date");
  if (!b || !okDate(date)) return c.json({ error: "not_found", message: "That block no longer exists." }, 404);
  await c.env.DB.prepare("DELETE FROM sched_running_orders WHERE block_id = ? AND date = ?").bind(b.id, date).run();
  return c.json({ ok: true, ...(await runningOrderPayload(c.env, b, date)) });
});

/** Copy a template into a new running order for one occurrence (§3.5). */
async function episodeFromTemplate(db: D1Database, b: GridBlock, date: string, listId: string | null): Promise<SnapshotRunningOrder | { error: string }> {
  const id = listId ?? b.list_id;
  const list = id ? (await loadLists(db, [id]))[id] : undefined;
  if (!list) return { error: "Choose a template for this block first." };
  if (await loadRunningOrder(db, b.id, date)) return { error: `${b.name} already has a running order for ${shortDay(date)}.` };
  const ro: SnapshotRunningOrder = {
    id: newId("ro"), block_id: b.id, date, from_list_id: list.id, note: "", updated_at_ms: Date.now(),
    items: list.slots.map((s, i) => ({ ...s, position: i + 1, auto_filled: 0 })),
  };
  await db.batch(writeRunningOrderStatements(db, ro));
  return ro;
}

/** POST /plan/running-orders/:blockId/:date/from-template {list_id?} - Create episode for this date (or a manual hour from a template). */
contentRoutes.post("/running-orders/:blockId/:date/from-template", async (c) => {
  const b = await workingBlock(c.env.DB, c.req.param("blockId"));
  const date = c.req.param("date");
  if (!b || !okDate(date)) return c.json({ error: "not_found", message: "That block no longer exists." }, 404);
  if (!blockRunsOn(b, date)) return c.json({ error: "invalid", message: `${b.name} doesn't run on ${shortDay(date)}.` }, 400);
  const body = await c.req.json<{ list_id?: string }>().catch(() => ({}) as { list_id?: string });
  if (b.fill_kind === "manual" && !body.list_id) {
    // A manual hour with no template: an empty running order to build by hand.
    if (await loadRunningOrder(c.env.DB, b.id, date)) return c.json({ error: "exists", message: `${b.name} already has a running order for ${shortDay(date)}.` }, 409);
    await c.env.DB.batch(writeRunningOrderStatements(c.env.DB, { id: newId("ro"), block_id: b.id, date, from_list_id: null, note: "", updated_at_ms: Date.now(), items: [] }));
  } else {
    const out = await episodeFromTemplate(c.env.DB, b, date, body.list_id ?? null);
    if ("error" in out) return c.json({ error: "invalid", message: out.error }, 400);
  }
  return c.json({ ok: true, ...(await runningOrderPayload(c.env, b, date)) });
});

/** POST /plan/blocks/:id/next-episode - the next occurrence from today without a running order gets one from the template. */
contentRoutes.post("/blocks/:id/next-episode", async (c) => {
  const b = await workingBlock(c.env.DB, c.req.param("id"));
  if (!b) return c.json({ error: "not_found", message: "That block no longer exists." }, 404);
  if (b.fill_kind !== "template") return c.json({ error: "invalid", message: "Create next episode is for template blocks." }, 400);
  const nowMs = Date.now();
  let date = parisDate(nowMs);
  for (let i = 0; i < 400; i++, date = addDaysTo(date, 1)) {
    const occ = occurrenceOn(b, date);
    if (!occ || occ.endMs <= nowMs) continue;
    if (await loadRunningOrder(c.env.DB, b.id, date)) continue;
    const out = await episodeFromTemplate(c.env.DB, b, date, null);
    if ("error" in out) return c.json({ error: "invalid", message: out.error }, 400);
    return c.json({ ok: true, ...(await runningOrderPayload(c.env, b, date)) });
  }
  return c.json({ error: "none", message: `Every upcoming ${b.name} already has an episode.` }, 409);
});

/**
 * POST /plan/running-orders/:blockId/:date/auto-fill
 * Fills the gap with songs from the block's pool (manual: the channel's), as
 * auto-filled items, to within 20 s without cutting a song (§4.1, §6.3).
 */
contentRoutes.post("/running-orders/:blockId/:date/auto-fill", async (c) => {
  const b = await workingBlock(c.env.DB, c.req.param("blockId"));
  const date = c.req.param("date");
  if (!b || !okDate(date)) return c.json({ error: "not_found", message: "That block no longer exists." }, 404);
  const ro = await loadRunningOrder(c.env.DB, b.id, date);
  if (!ro) return c.json({ error: "invalid", message: "Create the running order first." }, 400);
  const ch = (await channelById(c.env.DB, b.channel_id))!;
  const resolver = resolverForBlock(c.env.DB, b, channelTags(ch));
  const est = await estimateSlots(resolver, ro.items);
  // Rule slots count at their average; the gap is measured from the last pinned time if that's later.
  const ends = startTimes(est).map((s, i) => s + (est[i].empty ? 0 : (est[i].ms ?? 0)));
  const used = ends.length ? Math.max(...ends) : 0;
  const gap = blockLengthMs(b) - used;
  if (gap < TOLERANCE_MS) return c.json({ error: "full", message: "There's no gap to fill." }, 400);

  const already = new Set(ro.items.map((s) => (s.track_id ? `t:${s.track_id}` : `a:${s.audio_asset_id}`)));
  const songs = (await resolver.candidates({ item_type: "song", tags_any: [] })).filter((p) => !already.has(contentKey(p)));
  const chosen = fillWithin(seededShuffle(songs, hashSeed(`${b.id}:${date}:autofill:${ro.updated_at_ms}`)), gap);
  if (chosen.length === 0) return c.json({ error: "empty", message: "No songs in the block's pool fit the gap." }, 400);
  const items: ListSlot[] = [
    ...ro.items,
    ...chosen.map((p, i) => ({ position: ro.items.length + i + 1, slot_kind: "fixed" as const, track_id: p.trackId, audio_asset_id: null, rule_json: null, label: null, at_ms: null, auto_filled: 1 })),
  ];
  await c.env.DB.batch(writeRunningOrderStatements(c.env.DB, { ...ro, items, updated_at_ms: Math.max(Date.now(), ro.updated_at_ms + 1) }));
  const total = chosen.reduce((s, p) => s + p.fileMs, 0);
  return c.json({ ok: true, message: `Added ${chosen.length} song${chosen.length === 1 ? "" : "s"} (${hms(total)}); ${hms(gap - total)} left.`, ...(await runningOrderPayload(c.env, b, date)) });
});

/**
 * Songs adding up to at most `gap` and within 20 s of it where possible:
 * longest-first until the last few minutes, then the best 1-3 song finish
 * (bestCombo) landing in [gap - 20 s, gap]. Never longer than the gap.
 */
export function fillWithin(cands: Playable[], gap: number): Playable[] {
  const out: Playable[] = [];
  const used = new Set<string>();
  let left = gap;
  for (const p of cands) {
    if (left <= 12 * MINUTE) break;
    if (p.fileMs <= left - 4 * MINUTE) {
      out.push(p);
      used.add(contentKey(p));
      left -= p.fileMs;
    }
  }
  for (let back = 0; back < 4; back++) {
    const rest = cands.filter((p) => !used.has(contentKey(p)) && p.fileMs <= left);
    const combo = bestCombo(rest, Math.max(0, left - TOLERANCE_MS));
    if (combo && combo.items.reduce((s, p) => s + p.fileMs, 0) <= left) return [...out, ...combo.items];
    // Free a little room and try again.
    const last = out.pop();
    if (!last) break;
    used.delete(contentKey(last));
    left += last.fileMs;
  }
  // Nothing lands within 20 s: as close as possible without going over.
  const sorted = cands.filter((p) => !used.has(contentKey(p))).sort((a, b) => b.fileMs - a.fileMs);
  for (const p of sorted) {
    if (p.fileMs <= left) {
      out.push(p);
      used.add(contentKey(p));
      left -= p.fileMs;
    }
  }
  return out;
}

// ------------------------------------------------------------------ the hour zoom (§6.1)

/**
 * GET /plan/occurrence?block=&date=&view=draft|live
 * One occurrence's items, laid out as they'd air (draft: from the working
 * copy; live: the published log where it exists, else the published plan).
 */
contentRoutes.get("/occurrence", async (c) => {
  const blockId = c.req.query("block") ?? "";
  const date = c.req.query("date") ?? "";
  const view = c.req.query("view") === "live" ? "live" : "draft";
  if (!okDate(date)) return c.json({ error: "invalid" }, 400);
  const nowMs = Date.now();
  const row = await c.env.DB.prepare("SELECT channel_id FROM sched_blocks WHERE id = ?").bind(blockId).first<{ channel_id: string }>();
  const plan = row ? null : await c.env.DB.prepare("SELECT channel_id FROM sched_plans WHERE plan_json LIKE ? ORDER BY number DESC LIMIT 1").bind(`%"id":"${blockId.replace(/[%_"]/g, "")}"%`).first<{ channel_id: string }>();
  const channelId = row?.channel_id ?? plan?.channel_id;
  const ch = channelId ? await channelById(c.env.DB, channelId) : null;
  if (!ch) return c.json({ error: "not_found", message: "That block no longer exists." }, 404);
  const snap = view === "live" ? (await latestPlan(c.env.DB, ch.id))?.snapshot : await snapshotWorkingCopy(c.env.DB, ch.id, nowMs);
  const b = snap?.blocks.find((x) => x.id === blockId);
  if (!snap || !b) return c.json({ error: "not_found", message: view === "live" ? "That block isn't in the published plan." : "That block isn't in the draft." }, 404);
  const occ = occurrenceOn(b, date);
  if (!occ) return c.json({ error: "not_found", message: `${b.name} doesn't run on ${shortDay(date)}.` }, 404);
  const shorten = (i: { startsAt: number; endsAt: number; label: string | null; itemType: string; source: string; sourceRef: string | null; fixed?: boolean; reasons: string[]; blockId: string | null; fileMs: number; offset: number }) => ({
    starts_at_ms: i.startsAt,
    ends_at_ms: i.endsAt,
    label: i.label,
    type: i.itemType,
    fixed: !!i.fixed,
    // Topped up by the pool or the safety net, not planned by hand.
    filler: isHandPlanned(b) && (i.source !== "programme" || (i.sourceRef ?? "").startsWith("pool:")),
    trimmed_ms: Math.max(0, i.fileMs - i.offset - (i.endsAt - i.startsAt)),
    reason: i.reasons[i.reasons.length - 1] ?? null,
    in_block: i.blockId === b.id,
  });
  let items;
  let from: "log" | "plan" = "plan";
  const logged = view === "live" && occ.endMs > nowMs - 2 * 24 * 60 * MINUTE ? await itemsBetween(c.env.DB, ch.id, occ.startMs, occ.endMs) : [];
  if (logged.length && logged[0].startsAt <= occ.startMs && logged[logged.length - 1].endsAt >= occ.endMs) {
    items = logged.filter((i) => i.startsAt < occ.endMs && i.endsAt > occ.startMs).map(shorten);
    from = "log";
  } else {
    const planner = new Planner(c.env.DB, c.env.CONFIG, ch, snap.blocks.filter((x) => x.active), nowMs, snapshotContent(snap));
    const built = await planner.build(occ.startMs, occ.endMs);
    items = built.items.filter((i) => i.startsAt < occ.endMs).map(shorten);
  }
  const fillerMs = items.filter((i) => i.filler && i.in_block).reduce((s, i) => s + (i.ends_at_ms - i.starts_at_ms), 0);
  return c.json({
    channel: { slug: ch.slug, name: ch.name },
    block: { id: b.id, name: b.name, fill_kind: b.fill_kind, list_id: b.list_id, mode: b.mode },
    date,
    start_ms: occ.startMs,
    end_ms: occ.endMs,
    length_min: blockLengthMin(b),
    from,
    items,
    filler_ms: fillerMs,
    editable: view === "draft" && (b.fill_kind === "manual" || b.fill_kind === "template"),
    hint: isHandPlanned(b)
      ? null
      : `This block is filled by its ${b.fill_kind === "programme" ? "programme" : "rules"}. Make it manual to edit item by item.`,
    rules: b.fill_kind === "programme" ? null : describeRule({ item_type: "song", tags_any: JSON.parse(b.tags_any_json ?? "[]") }),
  });
});

/** GET /plan/lists/:id/drafts - the channels a list change touches, with their drafts (for the editor's banner). */
contentRoutes.get("/lists/:id/drafts", async (c) => {
  const users = await listUsers(c.env.DB, c.req.param("id"));
  const channels = (await Promise.all([...new Set(users.map((u) => u.channel_id))].map((cid) => channelById(c.env.DB, cid)))).filter((x): x is Channel => !!x);
  return c.json({ used_by: users, drafts: await draftsFor(c.env, channels) });
});

