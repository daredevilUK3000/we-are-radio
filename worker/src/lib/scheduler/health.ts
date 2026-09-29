import type { Channel, Env, Programme } from "../types";
import { sendEmail } from "../email";
import { autopilotTracks, channelTags } from "../station";
import { blockLengthMin, blockTags, loadGridBlocks, occurrencesBetween, occurrenceLabel, type GridBlock } from "./grid";
import { furthestHorizon, type SchedChannelRow } from "./generate";
import { fallbackLoop } from "./read";
import { itemAt, itemsBetween } from "./timeline";
import { DAY, HOUR, MINUTE, parisDayTime, parisHHMM, wallClock, PARIS_TZ } from "./time";
import { REPEAT_WINDOW_MS } from "./types";

/**
 * Schedule health (the checks in Master Control's right rail) and the alert
 * emails for anything red. Levels: red = act now, amber = look soon,
 * green = fine, grey = not applicable (e.g. a channel with nothing to play).
 */

export type Level = "red" | "amber" | "green" | "grey";
export interface HealthCheck {
  id: string; // stable per channel and issue, e.g. "log_ahead"
  channelId: string;
  channelSlug: string;
  channelName: string;
  level: Level;
  title: string;
  detail: string;
  action?: "review" | "fallback" | "history" | "grid" | "shadow";
}

export const LIVE_CONTROL_KINDS = ["play_now", "skip", "insert_next", "replace", "insert_jingle", "record_link", "rollback"];

/** What the grid says should be on now, and whether the channel is playing it. */
export async function gridStatus(db: D1Database, channelId: string, nowMs: number, blocks?: GridBlock[]) {
  const all = blocks ?? (await loadGridBlocks(db, channelId));
  const occs = occurrencesBetween(all, nowMs - DAY, nowMs + 2 * DAY);
  const now = occs.find((o) => o.startMs <= nowMs && nowMs < o.endMs) ?? null;
  const next = occs.find((o) => o.startMs > nowMs) ?? null;
  const on = await itemAt(db, channelId, nowMs);
  const playingBlock = on?.item.blockId ?? null;
  // A live control's recovery (up to its anchor) isn't "off the grid".
  const overriding =
    on?.item.source === "override" || (on && LIVE_CONTROL_KINDS.includes(on.version.kind) && nowMs - on.version.effective_from_ms < 70 * MINUTE);
  // An airing that began before the latest grid edit is just finishing; the edit takes over after it.
  const lastEdit = await db
    .prepare(
      `SELECT MAX(t) AS t FROM (
         SELECT MAX(updated_at_ms) AS t FROM sched_grid_blocks WHERE channel_id = ?1
         UNION ALL SELECT MAX(at_ms) FROM sched_changes WHERE channel_id = ?1 AND action = 'grid')`
    )
    .bind(channelId)
    .first<{ t: number | null }>();
  const finishing = !!on && on.item.startsAt < (lastEdit?.t ?? 0);
  const matches = (now?.block.id ?? null) === playingBlock || !!overriding || !on || finishing;
  return { now, next, on, playingBlock, matches, hasGrid: all.some((b) => b.active) };
}

export async function channelHealth(env: Env, channel: Channel, sc: SchedChannelRow, nowMs: number): Promise<HealthCheck[]> {
  const out: HealthCheck[] = [];
  const add = (id: string, level: Level, title: string, detail: string, action?: HealthCheck["action"]) =>
    out.push({ id, channelId: channel.id, channelSlug: channel.slug, channelName: channel.name, level, title, detail, action });

  const horizon = await furthestHorizon(env.DB, channel.id);
  const lastRun = await env.DB.prepare("SELECT ok, error FROM sched_runs WHERE channel_id = ? ORDER BY started_at_ms DESC LIMIT 1")
    .bind(channel.id)
    .first<{ ok: number | null; error: string | null }>();
  const nothing = !horizon && lastRun?.error?.startsWith("Nothing to play");

  if (nothing) {
    add("nothing", "grey", "Nothing to schedule", "This channel has no programme or matching songs yet, so there's no log to build.");
    return out;
  }

  // Validated log ahead.
  const ahead = horizon ? horizon - nowMs : 0;
  if (ahead < 24 * HOUR) add("log_ahead", "red", "Log running out", horizon ? `Only ${Math.max(0, Math.floor(ahead / HOUR))} h of validated log left (to ${parisDayTime(horizon)}).` : "No validated log yet.", "review");
  else if (ahead < 46 * HOUR) add("log_ahead", "amber", "Log shorter than usual", `${Math.floor(ahead / HOUR)} h of validated log ahead (to ${parisDayTime(horizon!)}).`, "review");
  else add("log_ahead", "green", "Log ahead", `Validated to ${parisDayTime(horizon!)}.`);

  // Generation.
  if (sc.consecutive_failures >= 2) add("generation", "red", "Generation failing", `${sc.consecutive_failures} runs in a row failed: ${lastRun?.error ?? "unknown error"}. Playing the last valid log${horizon ? ` until ${parisDayTime(horizon)}` : ""}.`, "review");
  else if (sc.consecutive_failures === 1) add("generation", "amber", "A generation run failed", lastRun?.error ?? "Unknown error. It will retry within the minute.", "review");
  else add("generation", "green", "Generation", "Last run OK.");

  // On the emergency fallback.
  if (sc.enabled && sc.on_fallback_since_ms) {
    add("on_fallback", "red", "On the emergency playlist", `Since ${parisDayTime(sc.on_fallback_since_ms)}: the log didn't cover now.`, "review");
  }

  // Fallback playlist.
  const fbRows = await env.DB.prepare("SELECT COUNT(*) AS n FROM sched_fallback_items WHERE channel_id = ?").bind(channel.id).first<{ n: number }>();
  const fb = await fallbackLoop(env.DB, channel.id);
  if (!fbRows?.n) add("fallback", "red", "No emergency playlist", "If the log ever runs out, there's nothing to fall back on.", "fallback");
  else if (!fb || fb.total < 3600 || fb.items.length < fbRows.n) {
    add("fallback", "amber", "Emergency playlist needs attention", !fb ? "None of its items can play." : fb.items.length < fbRows.n ? "Some of its items are no longer published." : `It's only ${Math.round(fb.total / 60)} minutes long (60 needed).`, "fallback");
  } else add("fallback", "green", "Emergency playlist", `${Math.round(fb.total / 60)} minutes, ready.`);

  // Upcoming items referencing content that's gone.
  const upcoming = await itemsBetween(env.DB, channel.id, nowMs, nowMs + 48 * HOUR);
  const trackIds = [...new Set(upcoming.map((i) => i.trackId).filter((x): x is string => !!x))];
  const assetIds = [...new Set(upcoming.map((i) => i.assetId).filter((x): x is string => !!x))];
  let missing = 0;
  for (const [table, ids] of [["tracks", trackIds], ["audio_assets", assetIds]] as const) {
    for (let i = 0; i < ids.length; i += 90) {
      const chunk = ids.slice(i, i + 90);
      const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE status IN (${table === "tracks" ? "'published'" : "'published','ready'"}) AND id IN (${chunk.map(() => "?").join(",")})`)
        .bind(...chunk)
        .first<{ n: number }>();
      missing += chunk.length - (r?.n ?? 0);
    }
  }
  if (missing) add("content", "red", "Scheduled content unpublished", `${missing} item(s) in the next 48 h are no longer published or were deleted. The next rebuild replaces them.`, "review");
  else add("content", "green", "Scheduled content", "Everything in the next 48 h is published.");

  // Shadow comparison.
  if (!sc.enabled) {
    const checks = sc.shadow_checks;
    const mism = sc.shadow_mismatches;
    const paused = sc.shadow_grace_until_ms && nowMs < sc.shadow_grace_until_ms ? ` Paused for a library change until ${parisHHMM(sc.shadow_grace_until_ms)}.` : "";
    if (checks && mism / checks > 0.05) add("shadow", "red", "Shadow comparison failing", `${mism} of ${checks} checks didn't match what listeners hear.${paused}`, "shadow");
    else if (mism) add("shadow", "amber", "Shadow mismatches", `${mism} of ${checks} checks didn't match in the last 24 h.${paused}`, "shadow");
    else add("shadow", "green", "Shadow comparison", (checks ? `Matches ${checks.toLocaleString("en-GB")} of ${checks.toLocaleString("en-GB")} checks.` : "No checks yet.") + paused);
  }

  // The grid.
  const blocks = await loadGridBlocks(env.DB, channel.id);
  if (sc.enabled) {
    const g = await gridStatus(env.DB, channel.id, nowMs, blocks);
    if (!g.matches) {
      add("grid_now", "red", `Grid says ${g.now?.block.name ?? "Channel default"}, not playing`, `Now on air: ${g.on?.item.label ?? "nothing"}${g.playingBlock ? "" : " (channel default)"}.`, "review");
    } else if (g.hasGrid) add("grid_now", "green", "Playing what the grid says", g.now ? `${g.now.block.name} is on.` : "Channel default is on.");
  }
  out.push(...(await gridFillChecks(env.DB, channel, blocks, nowMs)));
  return out;
}

/** Can every block in the next 7 days be filled? And which ones does a clock change touch? */
export async function gridFillChecks(db: D1Database, channel: Channel, blocks: GridBlock[], nowMs: number): Promise<HealthCheck[]> {
  const out: HealthCheck[] = [];
  const base = { channelId: channel.id, channelSlug: channel.slug, channelName: channel.name };
  const active = blocks.filter((b) => b.active);
  if (active.length === 0) return out;
  const reds: string[] = [];
  const ambers: string[] = [];
  for (const b of active) {
    const problem = await blockFillProblem(db, channel, b);
    if (problem?.level === "red") reds.push(`${b.name}: ${problem.text}`);
    else if (problem?.level === "amber") ambers.push(`${b.name}: ${problem.text}`);
  }
  if (reds.length) out.push({ ...base, id: "grid_fill", level: "red", title: "Grid blocks can't be filled", detail: reds.join(" · "), action: "grid" });
  else if (ambers.length) out.push({ ...base, id: "grid_fill", level: "amber", title: "Grid blocks may repeat songs", detail: ambers.join(" · "), action: "grid" });
  else out.push({ ...base, id: "grid_fill", level: "green", title: "Grid blocks", detail: "Every block in the next 7 days can be filled." });

  // Clock changes in the next 7 days.
  const changes = clockChangesBetween(nowMs, nowMs + 7 * DAY);
  for (const ch of changes) {
    const occs = occurrencesBetween(active, ch.at - 3 * HOUR, ch.at + 3 * HOUR).filter((o) => o.startMs <= ch.at + HOUR && o.endMs >= ch.at - HOUR);
    for (const o of occs) {
      out.push({
        ...base,
        id: `clock_${o.block.id}_${o.date}`,
        level: ch.spring ? "amber" : "green",
        title: ch.spring ? "Summer time starts during a block" : "Clocks go back during a block",
        detail: ch.spring
          ? `${o.block.name} (${occurrenceLabel(o)}) loses an hour; a block wholly inside 02:00–03:00 is skipped that night.`
          : `${o.block.name} (${occurrenceLabel(o)}): the repeated hour means it runs an hour longer in real time.`,
        action: "grid",
      });
    }
  }
  return out;
}

export async function blockFillProblem(db: D1Database, channel: Channel, b: Pick<GridBlock, "fill_kind" | "programme_id" | "tags_any_json" | "start_min" | "end_min">): Promise<{ level: "red" | "amber"; text: string } | null> {
  if (b.fill_kind === "programme") {
    const p = b.programme_id ? await db.prepare("SELECT * FROM programmes WHERE id = ?").bind(b.programme_id).first<Programme>() : null;
    if (!p || p.status !== "published") return { level: "red", text: "its programme isn't published" };
    const n = await db.prepare("SELECT COUNT(*) AS n FROM programme_items WHERE programme_id = ?").bind(p.id).first<{ n: number }>();
    if (!n?.n) return { level: "red", text: "its programme is empty" };
    return null;
  }
  const tags = blockTags(b as GridBlock);
  const tracks = await autopilotTracks(db, tags.length ? tags : channelTags(channel));
  if (tracks.length === 0) return { level: "red", text: "no published songs match its tags" };
  const noAudio = tracks.filter((t) => !t.audio_url).length;
  if (noAudio === tracks.length) return { level: "red", text: "none of its songs have audio" };
  const poolMs = tracks.reduce((s, t) => s + t.duration_seconds * 1000, 0);
  const needMs = Math.min(blockLengthMin(b) * MINUTE, REPEAT_WINDOW_MS);
  if (poolMs < needMs) return { level: "amber", text: `only ${Math.round(poolMs / MINUTE)} min of matching songs, so some repeat within 2 h` };
  return null;
}

/** Paris clock changes between two instants (the offset changes across the hour). */
export function clockChangesBetween(fromMs: number, toMs: number): { at: number; spring: boolean }[] {
  const out: { at: number; spring: boolean }[] = [];
  const off = (ms: number) => {
    const w = wallClock(ms, PARIS_TZ);
    return Date.parse(`${w.date}T00:00:00Z`) + w.minutes * MINUTE - Math.floor(ms / MINUTE) * MINUTE;
  };
  for (let t = fromMs; t < toMs; t += HOUR) {
    const a = off(t);
    const b = off(t + HOUR);
    if (a !== b) out.push({ at: t + HOUR, spring: b > a });
  }
  return out;
}

// ------------------------------------------------------------------ alerts

const ALERT_REPEAT_S = 6 * 60 * 60;

/**
 * An email to CONTACT_TO for each new red issue (at most one per channel and
 * issue every 6 hours), and a "Resolved" email when it clears.
 */
export async function sendAlerts(env: Env, channel: Channel, checks: HealthCheck[], nowMs: number) {
  const openKey = `sched:red:${channel.id}`;
  const open: Record<string, string> = ((await env.CONFIG.get(openKey, "json")) as Record<string, string>) ?? {};
  const reds = checks.filter((c) => c.level === "red");
  const to = env.CONTACT_TO || "info@weareradio.app";
  const from = env.CONTACT_FROM || "We Are Radio <info@weareradio.app>";
  const link = "https://weareradio.app/studio/scheduler";
  const nextOpen: Record<string, string> = {};

  for (const c of reds) {
    nextOpen[c.id] = c.title;
    const onceKey = `sched:alert:${channel.id}:${c.id}`;
    if (await env.CONFIG.get(onceKey)) continue;
    await env.CONFIG.put(onceKey, String(nowMs), { expirationTtl: ALERT_REPEAT_S });
    const doing = c.id === "generation" || c.id === "log_ahead" ? "The station keeps playing the last valid schedule." : c.id === "on_fallback" ? "Listeners are hearing the channel's emergency playlist." : "The station keeps playing.";
    await sendEmail(env, {
      to,
      from,
      replyTo: null,
      subject: `[We Are Radio] ${channel.name}: ${c.title}`,
      text: `${c.detail}\n\n${doing}\n\nOpen Master Control: ${link}\n`,
      html: `<p>${esc(c.detail)}</p><p>${esc(doing)}</p><p><a href="${link}">Open Master Control</a></p>`,
    });
  }
  for (const [id, title] of Object.entries(open)) {
    if (nextOpen[id]) continue;
    await env.CONFIG.delete(`sched:alert:${channel.id}:${id}`);
    await sendEmail(env, {
      to,
      from,
      replyTo: null,
      subject: `[We Are Radio] ${channel.name}: Resolved: ${title}`,
      text: `This has cleared: ${title}.\n\nMaster Control: ${link}\n`,
      html: `<p>This has cleared: ${esc(title)}.</p><p><a href="${link}">Master Control</a></p>`,
    });
  }
  if (Object.keys(nextOpen).length) await env.CONFIG.put(openKey, JSON.stringify(nextOpen));
  else if (Object.keys(open).length) await env.CONFIG.delete(openKey);
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

