import type { Channel } from "../types";
import { LIVE_CONTROL_KINDS } from "./health";
import { rowToItem, type LogItemRow, type VersionRow } from "./store";
import { addDaysTo, parisHHMM, parisWallClockToUtcMs, shortDay } from "./time";
import type { PlanItem } from "./types";

/**
 * Scheduled versus aired (handoff_scheduler_release2.md §9), one channel and
 * one Paris day at a time.
 *
 * "Planned" is what the published plan said before any live control: the
 * log rebuilt from the day's versions, ignoring live-control versions
 * (Play now, Skip, Insert next, Hold...). "Aired" is sched_aired. Rows pair
 * up by airing ID (an airing keeps its ID when it moves), then by time.
 */

/** "Not recorded": the aired recorder has no rows around that time (the station's own log of what played was down), so nothing can be said. */
export type RowStatus = "As planned" | "Replaced" | "Skipped" | "Inserted" | "Dropped" | "Trimmed" | "Moved" | "Late" | "Not recorded";

export interface ReportRow {
  status: RowStatus;
  planned: { at_ms: number; end_ms: number; label: string | null; type: string } | null;
  aired: { at_ms: number; end_ms: number | null; label: string | null; type: string; source: string } | null;
  drift_ms: number | null;
  airing_id: string | null;
  who: string | null;
  why: string | null;
}

interface AiredRow {
  airing_id: string;
  version_id: string;
  starts_at_ms: number;
  scheduled_end_ms: number;
  actual_end_ms: number | null;
  ended_how: string | null;
  item_type: string;
  track_id: string | null;
  audio_asset_id: string | null;
  label: string | null;
  source: string;
}

const LIVE = new Set(LIVE_CONTROL_KINDS);
const LATE_MS = 60_000;

/** The planned log for [from, to): each non-live-control version only where it governs. */
async function plannedItems(db: D1Database, channelId: string, from: number, to: number): Promise<PlanItem[]> {
  const { results } = await db
    .prepare("SELECT * FROM sched_versions WHERE channel_id = ? AND status = 'published' AND effective_from_ms < ? ORDER BY number")
    .bind(channelId, to)
    .all<VersionRow & { action: string | null }>();
  const planned = results.filter((v) => !LIVE.has(v.kind) && v.action !== "hold");
  // The governing planned version at each instant: the highest number whose effective time has come.
  const first = [...planned].reverse().find((v) => v.effective_from_ms <= from);
  const segs: { v: VersionRow; from: number; to: number }[] = [];
  let current = first ?? null;
  let start = from;
  for (const v of planned.filter((v) => v.effective_from_ms > from).sort((a, b) => a.effective_from_ms - b.effective_from_ms || a.number - b.number)) {
    if (current && v.number < current.number) continue;
    if (current && v.effective_from_ms > start) segs.push({ v: current, from: start, to: v.effective_from_ms });
    current = v;
    start = Math.max(start, v.effective_from_ms);
  }
  if (current) segs.push({ v: current, from: start, to });
  const out: PlanItem[] = [];
  for (const s of segs) {
    const { results: rows } = await db
      .prepare("SELECT * FROM sched_log_items WHERE version_id = ? AND starts_at_ms < ? AND ends_at_ms > ? ORDER BY starts_at_ms")
      .bind(s.v.id, s.to, s.from)
      .all<LogItemRow>();
    for (const r of rows) {
      const i = rowToItem(r);
      // An item a later version takes over part-way is the same airing: count it once.
      if (i.startsAt < s.from && out.length && out[out.length - 1].airingId === i.airingId) continue;
      // Live changes carried through a rebuild aren't part of the plan.
      if (i.source === "override") continue;
      if (i.startsAt < from) continue;
      out.push(i);
    }
  }
  return out;
}

export async function dayReport(db: D1Database, channel: Channel, date: string) {
  const from = parisWallClockToUtcMs(date, 0);
  const to = parisWallClockToUtcMs(addDaysTo(date, 1), 0);
  const planned = await plannedItems(db, channel.id, from, to);
  const { results: aired } = await db
    .prepare("SELECT * FROM sched_aired WHERE channel_id = ? AND starts_at_ms >= ? AND starts_at_ms < ? ORDER BY starts_at_ms")
    .bind(channel.id, from, to)
    .all<AiredRow>();
  const { results: changes } = await db
    .prepare("SELECT airing_id, actor, action, reason FROM sched_changes WHERE channel_id = ? AND at_ms >= ? AND at_ms < ? AND airing_id IS NOT NULL ORDER BY at_ms")
    .bind(channel.id, from - 2 * 24 * 3600_000, to)
    .all<{ airing_id: string; actor: string; action: string; reason: string | null }>();
  const changeFor = new Map<string, { actor: string; action: string; reason: string | null }>();
  for (const c of changes) changeFor.set(c.airing_id, c);

  const airedById = new Map(aired.map((a) => [a.airing_id, a]));
  // Versions published by Hold: an airing they governed that runs late was moved on purpose.
  const { results: holds } = await db
    .prepare("SELECT id FROM sched_versions WHERE channel_id = ? AND action = 'hold' AND effective_from_ms < ? AND horizon_ms > ?")
    .bind(channel.id, to, from)
    .all<{ id: string }>();
  const holdVersions = new Set(holds.map((h) => h.id));
  const RECORDED_NEAR_MS = 30 * 60_000;
  const recordedNear = (t: number) => aired.some((a) => Math.abs(a.starts_at_ms - t) <= RECORDED_NEAR_MS);
  const usedAired = new Set<string>();
  const rows: ReportRow[] = [];
  const who = (actor: string | undefined) => (actor === "studio" ? "You" : actor === "system" ? "The station" : actor === "generator" ? "The Scheduler" : null);
  const pRow = (p: PlanItem) => ({ at_ms: p.startsAt, end_ms: p.endsAt, label: p.label, type: p.itemType });
  const aRow = (a: AiredRow) => ({ at_ms: a.starts_at_ms, end_ms: a.actual_end_ms ?? a.scheduled_end_ms, label: a.label, type: a.item_type, source: a.source });

  for (const p of planned) {
    const a = p.airingId ? airedById.get(p.airingId) : undefined;
    if (a) {
      usedAired.add(a.airing_id);
      const ch = changeFor.get(a.airing_id);
      const drift = a.starts_at_ms - p.startsAt;
      const airedLen = (a.actual_end_ms ?? a.scheduled_end_ms) - a.starts_at_ms;
      let status: RowStatus = "As planned";
      if (a.ended_how === "skipped") status = "Skipped";
      else if (Math.abs(drift) > LATE_MS) status = ch?.action === "hold" || holdVersions.has(a.version_id) || drift < 0 ? "Moved" : "Late";
      else if (airedLen < p.endsAt - p.startsAt - 5000) status = "Trimmed";
      rows.push({ status, planned: pRow(p), aired: aRow(a), drift_ms: drift, airing_id: a.airing_id, who: status === "As planned" ? null : who(ch?.actor), why: status === "As planned" ? null : (ch?.reason ?? null) });
      continue;
    }
    // Not aired as itself: replaced by something else at the same moment, or dropped.
    const sameTime = aired.find((x) => !usedAired.has(x.airing_id) && !planned.some((q) => q.airingId === x.airing_id) && Math.abs(x.starts_at_ms - p.startsAt) <= 5000);
    const ch = p.airingId ? changeFor.get(p.airingId) : undefined;
    if (sameTime) {
      usedAired.add(sameTime.airing_id);
      const c2 = changeFor.get(sameTime.airing_id) ?? ch;
      rows.push({ status: "Replaced", planned: pRow(p), aired: aRow(sameTime), drift_ms: sameTime.starts_at_ms - p.startsAt, airing_id: sameTime.airing_id, who: who(c2?.actor), why: c2?.reason ?? null });
    } else if (p.startsAt < Date.now() && !recordedNear(p.startsAt)) {
      rows.push({ status: "Not recorded", planned: pRow(p), aired: null, drift_ms: null, airing_id: p.airingId ?? null, who: null, why: "The station wasn't recording what aired at this time" });
    } else if (p.startsAt < Date.now()) {
      rows.push({ status: "Dropped", planned: pRow(p), aired: null, drift_ms: null, airing_id: p.airingId ?? null, who: who(ch?.actor), why: ch?.reason ?? null });
    }
  }
  for (const a of aired) {
    if (usedAired.has(a.airing_id)) continue;
    const ch = changeFor.get(a.airing_id);
    rows.push({ status: "Inserted", planned: null, aired: aRow(a), drift_ms: null, airing_id: a.airing_id, who: who(ch?.actor), why: ch?.reason ?? (a.source === "fallback" ? "Emergency playlist" : null) });
  }
  rows.sort((x, y) => (x.planned?.at_ms ?? x.aired!.at_ms) - (y.planned?.at_ms ?? y.aired!.at_ms));

  const { results: liveVersions } = await db
    .prepare("SELECT kind, action FROM sched_versions WHERE channel_id = ? AND status = 'published' AND published_at_ms >= ? AND published_at_ms < ?")
    .bind(channel.id, from, to)
    .all<{ kind: string; action: string | null }>();
  const comparable = rows.filter((r) => r.planned && r.status !== "Not recorded");
  const asPlanned = comparable.filter((r) => r.status === "As planned").length;
  const drifts = rows.map((r) => Math.abs(r.drift_ms ?? 0));
  const songs = aired.filter((a) => a.item_type === "song");
  const fallbackMs = aired.filter((a) => a.source === "fallback").reduce((s, a) => s + ((a.actual_end_ms ?? a.scheduled_end_ms) - a.starts_at_ms), 0);
  return {
    channel: { slug: channel.slug, name: channel.name },
    date,
    date_label: shortDay(date),
    complete: to <= Date.now(),
    totals: {
      planned: comparable.length,
      not_recorded: rows.filter((r) => r.status === "Not recorded").length,
      as_planned: asPlanned,
      as_planned_pct: comparable.length ? Math.round((asPlanned / comparable.length) * 1000) / 10 : null,
      live_changes: liveVersions.filter((v) => LIVE.has(v.kind)).length,
      largest_drift_ms: drifts.length ? Math.max(...drifts) : 0,
      fallback_ms: fallbackMs,
      songs_aired: songs.length,
      unique_songs: new Set(songs.map((s) => s.track_id)).size,
    },
    rows,
  };
}

/** The rows as CSV: UTF-8 with a byte-order mark and CRLF, so Excel and Numbers keep accents. */
export function reportCsv(r: Awaited<ReturnType<typeof dayReport>>): string {
  const q = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const t = (ms: number | null | undefined) => (ms ? parisHHMM(ms) + ":" + String(Math.floor((ms / 1000) % 60)).padStart(2, "0") : "");
  const lines = [
    ["Date", "Channel", "Status", "Planned time", "Planned item", "Aired time", "Aired item", "Aired type", "Drift (s)", "Who", "Why", "Airing ID"].join(","),
    ...r.rows.map((row) =>
      [
        r.date, r.channel.name, row.status, t(row.planned?.at_ms), row.planned?.label, t(row.aired?.at_ms), row.aired?.label, row.aired?.type,
        row.drift_ms === null ? "" : Math.round(row.drift_ms / 1000), row.who, row.why, row.airing_id,
      ].map(q).join(",")
    ),
  ];
  return "﻿" + lines.join("\r\n") + "\r\n";
}
