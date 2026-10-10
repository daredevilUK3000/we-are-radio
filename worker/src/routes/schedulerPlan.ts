import { Hono } from "hono";
import type { Channel, Env } from "../lib/types";
import { channelAccent } from "../lib/guide";
import { latestVersion } from "../lib/scheduler/generate";
import { loadWorkingBlocks, occurrencesBetween, rawOccurrences, type GridBlock } from "../lib/scheduler/grid";
import { latestPlan, planByNumber } from "../lib/scheduler/plans";
import { newBlockId, parsePlanBlock, writeBlockStatements } from "../lib/scheduler/planEdit";
import { channelDraft, discardDraft, draftChanges, publishSnapshot, rollbackPlan, type ChannelDraft, type PublishOutcome } from "../lib/scheduler/planPublish";
import { Planner } from "../lib/scheduler/plan";
import { addDaysTo, DAY, HOUR, parisDate, parisWallClockToUtcMs } from "../lib/scheduler/time";
import { itemsBetween } from "../lib/scheduler/timeline";
import { validatePlan } from "../lib/scheduler/validate";
import { autopilotTracks, channelTags } from "../lib/station";

/**
 * Release 2's working copy, draft, publish, discard and rollback
 * (handoff §4), under /studio/api/scheduler/plan. Edits only ever touch the
 * working copy (sched_blocks): nothing reaches the air until a channel is
 * published.
 */
export const planRoutes = new Hono<{ Bindings: Env }>();

const channelBySlug = (db: D1Database, slug: string | undefined | null) =>
  slug ? db.prepare("SELECT * FROM channels WHERE slug = ?").bind(slug).first<Channel>() : Promise.resolve(null);
const channelById = (db: D1Database, id: string) => db.prepare("SELECT * FROM channels WHERE id = ?").bind(id).first<Channel>();

const blockJson = (b: GridBlock) => ({ ...b, tags_any: b.tags_any_json ? (JSON.parse(b.tags_any_json) as string[]) : [], exceptions: b.exceptions ?? [] });

async function allChannels(db: D1Database) {
  // The station's usual order (as the listener app lists them), then hidden channels.
  return (await db.prepare("SELECT * FROM channels ORDER BY CASE status WHEN 'live' THEN 0 ELSE 1 END, created_at ASC").all<Channel>()).results;
}

async function draftsFor(env: Env, channels: Channel[], nowMs: number): Promise<Record<string, ChannelDraft>> {
  const out: Record<string, ChannelDraft> = {};
  for (const ch of channels) out[ch.slug] = await channelDraft(env, ch, nowMs);
  return out;
}

// ------------------------------------------------------------------ the board (Timeline data)

/**
 * GET /plan/board?from=&to=&view=draft|live[&channel=slug]
 * Every channel's blocks and effective segments in the range (draft = the
 * working copy, live = the published plan), with each channel's draft
 * summary and issues.
 */
planRoutes.get("/board", async (c) => {
  const nowMs = Date.now();
  const from = Number(c.req.query("from")) || parisWallClockToUtcMs(parisDate(nowMs), 0);
  const to = Math.min(Number(c.req.query("to")) || from + DAY, from + 8 * DAY);
  const view = c.req.query("view") === "live" ? "live" : "draft";
  const only = c.req.query("channel");
  const channels = (await allChannels(c.env.DB)).filter((ch) => !only || ch.slug === only);
  const sc = new Map(
    (await c.env.DB.prepare("SELECT channel_id, enabled FROM sched_channels").all<{ channel_id: string; enabled: number }>()).results.map((r) => [r.channel_id, r.enabled])
  );
  const lanes = [];
  for (const ch of channels) {
    const plan = await latestPlan(c.env.DB, ch.id);
    const blocks = view === "live" ? (plan?.snapshot.blocks ?? []) : await loadWorkingBlocks(c.env.DB, ch.id, true);
    const segments = occurrencesBetween(blocks.filter((b) => b.active), from, to).map((o) => ({
      block_id: o.block.id,
      date: o.date,
      start_ms: o.startMs,
      end_ms: o.endMs,
      origin_ms: o.originMs ?? o.startMs,
      cut: !!o.cut,
      resumed: (o.originMs ?? o.startMs) < o.startMs,
    }));
    // Same-layer overlaps in the range, drawn in place on the Timeline.
    const raw = rawOccurrences(blocks.filter((b) => b.active), from, to);
    const conflicts: { block_id: string; other_block_id: string; date: string; start_ms: number; end_ms: number }[] = [];
    for (let i = 0; i < raw.length; i++)
      for (let j = i + 1; j < raw.length && raw[j].startMs < raw[i].endMs; j++)
        if (raw[i].block.id !== raw[j].block.id && (raw[i].block.layer ?? 1) === (raw[j].block.layer ?? 1))
          conflicts.push({ block_id: raw[i].block.id, other_block_id: raw[j].block.id, date: raw[i].date, start_ms: raw[j].startMs, end_ms: Math.min(raw[i].endMs, raw[j].endMs) });
    const draft = await channelDraft(c.env, ch, nowMs);
    const latest = await latestVersion(c.env.DB, ch.id);
    lanes.push({
      slug: ch.slug,
      name: ch.name,
      description: ch.description,
      status: ch.status,
      enabled: !!sc.get(ch.id),
      programming_mode: ch.programming_mode,
      accent: channelAccent(ch.slug),
      live_plan: plan?.row.number ?? null,
      live_version: latest?.number ?? null,
      blocks: blocks.map(blockJson),
      segments,
      raw: raw.map((o) => ({ block_id: o.block.id, date: o.date, start_ms: o.startMs, end_ms: o.endMs })),
      conflicts,
      draft,
    });
  }
  const programmes = (
    await c.env.DB.prepare(
      `SELECT p.id, p.title, p.channel_id, p.duration_seconds, (SELECT COUNT(*) FROM programme_items pi WHERE pi.programme_id = p.id) AS items
       FROM programmes p WHERE p.status = 'published' ORDER BY p.updated_at DESC LIMIT 300`
    ).all<Record<string, unknown>>()
  ).results;
  const tags = (await c.env.DB.prepare("SELECT name FROM tags ORDER BY name").all<{ name: string }>()).results.map((t) => t.name);
  return c.json({ now_ms: nowMs, from, to, view, channels: lanes, programmes, tags });
});

/** GET /plan/draft - every channel's draft summary. */
planRoutes.get("/draft", async (c) => {
  const channels = await allChannels(c.env.DB);
  return c.json({ now_ms: Date.now(), drafts: await draftsFor(c.env, channels, Date.now()) });
});

// ------------------------------------------------------------------ block edits (working copy only)

async function save(db: D1Database, b: GridBlock) {
  await db.batch(writeBlockStatements(db, b));
}

async function respond(env: Env, channels: Channel[], extra: Record<string, unknown> = {}) {
  const nowMs = Date.now();
  return { ok: true, ...extra, drafts: await draftsFor(env, channels, nowMs) };
}

/** POST /plan/blocks {channel, ...block} */
planRoutes.post("/blocks", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const ch = await channelBySlug(c.env.DB, String(body.channel ?? ""));
  if (!ch) return c.json({ error: "not_found", message: "Choose a channel." }, 404);
  const parsed = parsePlanBlock(body);
  if (!parsed.ok) return c.json({ error: "invalid", field: parsed.field, message: parsed.message }, 400);
  const now = Date.now();
  const block: GridBlock = { ...parsed.value, id: newBlockId(), channel_id: ch.id, created_at_ms: now, updated_at_ms: now };
  await save(c.env.DB, block);
  return c.json(await respond(c.env, [ch], { block: blockJson(block) }));
});

async function workingBlock(db: D1Database, id: string) {
  const row = await db.prepare("SELECT channel_id FROM sched_blocks WHERE id = ?").bind(id).first<{ channel_id: string }>();
  if (!row) return null;
  return (await loadWorkingBlocks(db, row.channel_id, true)).find((b) => b.id === id) ?? null;
}

/**
 * PUT /plan/blocks/:id {scope: 'all' | 'occurrence', date, channel?, ...block}
 * "occurrence" is "just this one": the recurring block skips that date and a
 * one-off on top (layer 3) takes the edited values.
 */
planRoutes.put("/blocks/:id", async (c) => {
  const existing = await workingBlock(c.env.DB, c.req.param("id"));
  if (!existing) return c.json({ error: "not_found", message: "That block no longer exists." }, 404);
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const from = (await channelById(c.env.DB, existing.channel_id))!;
  const target = body.channel ? await channelBySlug(c.env.DB, String(body.channel)) : from;
  if (!target) return c.json({ error: "not_found", message: "That channel doesn't exist." }, 404);
  const now = Date.now();
  const scope = body.scope === "occurrence" ? "occurrence" : "all";

  if (scope === "occurrence" && (existing.recurrence ?? "weekly") !== "once") {
    const date = String(body.date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "invalid", field: "date", message: "Which date?" }, 400);
    const parsed = parsePlanBlock({ ...existing, ...body, tags_any: body.tags_any ?? JSON.parse(existing.tags_any_json ?? "[]"), recurrence: "once", once_date: body.once_date ?? date, layer: 3, exceptions: [] });
    if (!parsed.ok) return c.json({ error: "invalid", field: parsed.field, message: parsed.message }, 400);
    const oneOff: GridBlock = { ...parsed.value, id: newBlockId(), channel_id: target.id, created_at_ms: now, updated_at_ms: now };
    const skipped: GridBlock = { ...existing, exceptions: [...new Set([...(existing.exceptions ?? []), date])].sort(), updated_at_ms: now };
    await c.env.DB.batch([...writeBlockStatements(c.env.DB, skipped), ...writeBlockStatements(c.env.DB, oneOff)]);
    return c.json(await respond(c.env, target.id === from.id ? [from] : [from, target], { block: blockJson(oneOff) }));
  }

  const parsed = parsePlanBlock({ ...existing, exceptions: existing.exceptions, ...body, tags_any: body.tags_any ?? JSON.parse(existing.tags_any_json ?? "[]") });
  if (!parsed.ok) return c.json({ error: "invalid", field: parsed.field, message: parsed.message }, 400);
  const block: GridBlock = { ...parsed.value, id: existing.id, channel_id: target.id, created_at_ms: existing.created_at_ms, updated_at_ms: now };
  await save(c.env.DB, block);
  return c.json(await respond(c.env, target.id === from.id ? [from] : [from, target], { block: blockJson(block) }));
});

/** DELETE /plan/blocks/:id?scope=occurrence&date= - "just this one" adds an exception. */
planRoutes.delete("/blocks/:id", async (c) => {
  const existing = await workingBlock(c.env.DB, c.req.param("id"));
  if (!existing) return c.json({ error: "not_found", message: "That block no longer exists." }, 404);
  const ch = (await channelById(c.env.DB, existing.channel_id))!;
  const date = c.req.query("date") ?? "";
  if (c.req.query("scope") === "occurrence" && (existing.recurrence ?? "weekly") !== "once") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "invalid", message: "Which date?" }, 400);
    await save(c.env.DB, { ...existing, exceptions: [...new Set([...(existing.exceptions ?? []), date])].sort(), updated_at_ms: Date.now() });
  } else {
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM sched_block_exceptions WHERE block_id = ?").bind(existing.id),
      c.env.DB.prepare("DELETE FROM sched_blocks WHERE id = ?").bind(existing.id),
    ]);
  }
  return c.json(await respond(c.env, [ch]));
});

/** POST /plan/blocks/:id/duplicate */
planRoutes.post("/blocks/:id/duplicate", async (c) => {
  const existing = await workingBlock(c.env.DB, c.req.param("id"));
  if (!existing) return c.json({ error: "not_found", message: "That block no longer exists." }, 404);
  const ch = (await channelById(c.env.DB, existing.channel_id))!;
  const now = Date.now();
  const copy: GridBlock = { ...existing, id: newBlockId(), name: `${existing.name} (copy)`.slice(0, 60), created_at_ms: now, updated_at_ms: now };
  await save(c.env.DB, copy);
  return c.json(await respond(c.env, [ch], { block: blockJson(copy) }));
});

/** POST /plan/blocks/:id/exception {date, skip: true|false} - skip (or restore) one date of a repeating block. */
planRoutes.post("/blocks/:id/exception", async (c) => {
  const existing = await workingBlock(c.env.DB, c.req.param("id"));
  if (!existing) return c.json({ error: "not_found", message: "That block no longer exists." }, 404);
  const body = await c.req.json<{ date?: string; skip?: boolean }>().catch(() => ({}) as { date?: string; skip?: boolean });
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) return c.json({ error: "invalid", message: "Which date?" }, 400);
  const set = new Set(existing.exceptions ?? []);
  if (body.skip === false) set.delete(body.date);
  else set.add(body.date);
  await save(c.env.DB, { ...existing, exceptions: [...set].sort(), updated_at_ms: Date.now() });
  return c.json(await respond(c.env, [(await channelById(c.env.DB, existing.channel_id))!]));
});

/** POST /plan/copy-day {channel, from: 'mon', to: ['tue', ...]} - weekly blocks on one day also run on others (replacing what those days had). */
planRoutes.post("/copy-day", async (c) => {
  const body = await c.req.json<{ channel?: string; from?: string; to?: string[] }>().catch(() => ({}) as { channel?: string; from?: string; to?: string[] });
  const ch = await channelBySlug(c.env.DB, body.channel);
  if (!ch) return c.json({ error: "not_found" }, 404);
  const KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const fromIdx = KEYS.indexOf(String(body.from));
  const toIdx = (body.to ?? []).map((d) => KEYS.indexOf(d)).filter((i) => i >= 0 && i !== fromIdx);
  if (fromIdx < 0 || toIdx.length === 0) return c.json({ error: "invalid", message: "Choose a day to copy and the days to copy it to." }, 400);
  const targetMask = toIdx.reduce((m, i) => m | (1 << i), 0);
  const now = Date.now();
  const stmts: D1PreparedStatement[] = [];
  for (const b of (await loadWorkingBlocks(c.env.DB, ch.id, true)).filter((b) => (b.recurrence ?? "weekly") === "weekly")) {
    let mask = (b.days_mask ?? 0) & ~targetMask;
    if ((b.days_mask ?? 0) & (1 << fromIdx)) mask |= targetMask;
    if (mask === b.days_mask) continue;
    if (mask) stmts.push(...writeBlockStatements(c.env.DB, { ...b, days_mask: mask, updated_at_ms: now }));
    else stmts.push(c.env.DB.prepare("DELETE FROM sched_block_exceptions WHERE block_id = ?").bind(b.id), c.env.DB.prepare("DELETE FROM sched_blocks WHERE id = ?").bind(b.id));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json(await respond(c.env, [ch]));
});

// ------------------------------------------------------------------ preview, publish, discard, rollback

/**
 * GET /plan/preview?channel=&date= - one Paris day as the draft would play
 * it, beside the live log (never writes).
 */
planRoutes.get("/preview", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.query("channel"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  const nowMs = Date.now();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(c.req.query("date") ?? "") ? c.req.query("date")! : parisDate(nowMs);
  const dayStart = parisWallClockToUtcMs(date, 0);
  const dayEnd = parisWallClockToUtcMs(addDaysTo(date, 1), 0);
  const from = Math.max(dayStart, nowMs);
  if (from >= dayEnd) return c.json({ date, past: true, live: [], draft: [] });
  const working = await loadWorkingBlocks(c.env.DB, ch.id);
  const plan = await latestPlan(c.env.DB, ch.id);
  const names = new Map([...(plan?.snapshot.blocks ?? []), ...working].map((b) => [b.id, b.name]));
  const short = (i: { startsAt: number; endsAt: number; label: string | null; itemType: string; blockId: string | null; trackId: string | null; assetId: string | null }) => ({
    starts_at_ms: i.startsAt,
    ends_at_ms: i.endsAt,
    label: i.label,
    type: i.itemType,
    block: i.blockId ? (names.get(i.blockId) ?? null) : null,
    key: i.trackId ? `t:${i.trackId}` : `a:${i.assetId}`,
  });
  const draftItems = (await new Planner(c.env.DB, c.env.CONFIG, ch, working, nowMs).build(from, dayEnd)).items.map(short);
  const liveItems = (await itemsBetween(c.env.DB, ch.id, from, Math.min(dayEnd, nowMs + 48 * HOUR))).map(short);
  const issues = (await validatePlan(c.env.DB, ch, working, nowMs)).filter((i) => !i.date || i.date === date);
  return c.json({ date, from, live: liveItems, draft: draftItems, issues, live_known_to: Math.min(dayEnd, (await latestVersion(c.env.DB, ch.id))?.horizon_ms ?? from) });
});

/** POST /plan/publish {channels: [slug] | 'all-with-changes', expected: {slug: planNumber}} - each channel independently. */
planRoutes.post("/publish", async (c) => {
  const body = await c.req.json<{ channels?: string[] | string; expected?: Record<string, number | null> }>().catch(() => ({}) as { channels?: string[] | string; expected?: Record<string, number | null> });
  const all = await allChannels(c.env.DB);
  const nowMs = Date.now();
  let targets: Channel[];
  if (body.channels === "all-with-changes") {
    targets = [];
    for (const ch of all) if ((await channelDraft(c.env, ch, nowMs)).changes.length) targets.push(ch);
  } else targets = all.filter((ch) => Array.isArray(body.channels) && body.channels.includes(ch.slug));
  const results: Record<string, PublishOutcome> = {};
  for (const ch of targets) {
    const expected = body.expected && ch.slug in body.expected ? body.expected[ch.slug] : ((await latestPlan(c.env.DB, ch.id))?.row.number ?? null);
    results[ch.slug] = await publishSnapshot(c.env, ch, { expected: expected ?? null, nowMs, forceInvalid: c.env.SCHED_DEV === "1" ? (c.req.query("forceInvalid") ?? undefined) : undefined });
  }
  return c.json({ results, drafts: await draftsFor(c.env, all, Date.now()) });
});

/** POST /plan/discard {channel} */
planRoutes.post("/discard", async (c) => {
  const body = await c.req.json<{ channel?: string }>().catch(() => ({}) as { channel?: string });
  const ch = await channelBySlug(c.env.DB, body.channel);
  if (!ch) return c.json({ error: "not_found" }, 404);
  const { discarded } = await discardDraft(c.env.DB, ch);
  return c.json(await respond(c.env, [ch], { discarded, message: discarded ? `Discarded ${discarded} draft change${discarded === 1 ? "" : "s"} to ${ch.name}.` : "There was nothing to discard." }));
});

/** POST /plan/rollback {channel, number, expected} */
planRoutes.post("/rollback", async (c) => {
  const body = await c.req.json<{ channel?: string; number?: number; expected?: number | null }>().catch(() => ({}) as { channel?: string; number?: number; expected?: number | null });
  const ch = await channelBySlug(c.env.DB, body.channel);
  if (!ch || !Number.isInteger(body.number)) return c.json({ error: "not_found" }, 404);
  const out = await rollbackPlan(c.env, ch, body.number!, body.expected ?? null);
  return c.json({ result: out, ...(await respond(c.env, [ch])) });
});

/** GET /plan/plans?channel= - the published plans, newest first. */
planRoutes.get("/plans", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.query("channel"));
  if (!ch) return c.json({ error: "not_found" }, 404);
  await latestPlan(c.env.DB, ch.id); // seeds plan #1 if needed
  const { results } = await c.env.DB.prepare(
    `SELECT p.number, p.summary, p.actor, p.based_on_number, p.rollback_of, p.effective_from_ms, p.created_at_ms, v.number AS version
     FROM sched_plans p LEFT JOIN sched_versions v ON v.id = p.version_id
     WHERE p.channel_id = ? ORDER BY p.number DESC LIMIT 100`
  )
    .bind(ch.id)
    .all<Record<string, unknown>>();
  const working = await loadWorkingBlocks(c.env.DB, ch.id, true);
  const plan = await latestPlan(c.env.DB, ch.id);
  return c.json({ channel: { slug: ch.slug, name: ch.name }, plans: results, draft_changes: draftChanges(plan?.snapshot.blocks ?? [], working).length });
});

/** GET /plan/plans/:number?channel= - one plan's blocks (for its preview). */
planRoutes.get("/plans/:number", async (c) => {
  const ch = await channelBySlug(c.env.DB, c.req.query("channel"));
  const p = ch ? await planByNumber(c.env.DB, ch.id, Number(c.req.param("number"))) : null;
  if (!ch || !p) return c.json({ error: "not_found" }, 404);
  const live = await latestPlan(c.env.DB, ch.id);
  return c.json({ plan: p.row, blocks: p.snapshot.blocks.map(blockJson), compared_to_live: draftChanges(live?.snapshot.blocks ?? [], p.snapshot.blocks) });
});

/** GET /plan/pool?channel=&tags= - how big an autopilot pool is (for the editor). */
planRoutes.get("/pool", async (c) => {
  const tags = (c.req.query("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  const ch = await channelBySlug(c.env.DB, c.req.query("channel"));
  const tracks = await autopilotTracks(c.env.DB, tags.length ? tags : ch ? channelTags(ch) : []);
  return c.json({ tracks: tracks.length, seconds: tracks.reduce((s, t) => s + t.duration_seconds, 0) });
});
