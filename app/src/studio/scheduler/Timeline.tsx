import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { contentApi, friendly, planApi, type Board, type BoardLane, type ChannelDraft, type LibraryResult, type PlanBlock, type PlanIssue, type PlanSegment, type PublishOutcome, type RunningOrderView } from "./api";
import { LIBRARY_MIME, LibrarySearch } from "./LibraryPicker";
import { RunningOrderDialog } from "./RunningOrder";
import { hm, longDate, Modal, SchedulerNav, Toast, useNow, type ToastState } from "./common";
import { bodyFor, DAY_LONG, DAY_SHORT, draftFromBlock, lengthMin, mm, newDraft, PlanEditor, type EditorDraft } from "./PlanEditor";
import "./scheduler.css";
import "./timeline.css";
import "./content.css";

/**
 * Studio -> Scheduler -> Timeline (/studio/scheduler/timeline), Release 2:
 * every channel's day (or one channel's week) as bars. Draft shows the
 * working copy, Live the published plan. Edits, drags and fixes change only
 * the draft; Publish puts a channel's draft on air, whole and checked, and
 * every publish can be rolled back from the version history.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK_HOUR_PX = 44;
const SNAP = 5;

// ------------------------------------------------------------------ Paris time helpers

const partsFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function paris(ms: number) {
  const p = Object.fromEntries(partsFmt.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}
const offsetAt = (ms: number) => {
  const p = paris(ms);
  return Date.UTC(Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)) - 1, Number(p.date.slice(8, 10))) + p.minutes * 60_000 - Math.floor(ms / 60_000) * 60_000;
};
/** UTC ms of a Paris date and minute. */
export function parisMs(date: string, minutes: number) {
  const guess = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) + minutes * 60_000;
  let ms = guess - offsetAt(guess);
  const again = guess - offsetAt(ms);
  if (again !== ms) ms = again;
  return ms;
}
export const addDays = (date: string, n: number) => new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + n)).toISOString().slice(0, 10);
const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
const shortDate = (date: string) => `${DAY_SHORT[weekday(date)]} ${Number(date.slice(8, 10))} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(date.slice(5, 7)) - 1]}`;
const snap = (m: number) => Math.round(m / SNAP) * SNAP;
/** "today 19:00", "tomorrow 06:00", "Fri 16 Oct 19:00" (Paris). */
function when(ms: number, nowMs = Date.now()): string {
  const d = paris(ms).date;
  const t = hm(ms);
  if (d === paris(nowMs).date) return `today ${t}`;
  if (d === addDays(paris(nowMs).date, 1)) return `tomorrow ${t}`;
  return `${shortDate(d)} ${t}`;
}

/** "Every Friday", "Weekdays", "1st Saturday of the month", "Once: Fri 2 Oct", plus a season. */
export function repeatsText(b: PlanBlock): string {
  const rec = b.recurrence ?? "weekly";
  let base: string;
  if (rec === "once") base = `Once: ${b.once_date ? shortDate(b.once_date) : "?"}`;
  else if (rec === "monthly") {
    let r: { day?: number; nth?: number; weekday?: number } = {};
    try {
      r = JSON.parse(b.monthly_rule ?? "{}");
    } catch {
      /* empty */
    }
    const ord = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
    base = typeof r.day === "number" ? `Every month on the ${ord(r.day)}` : `${r.nth === -1 ? "Last" : ["", "First", "Second", "Third", "Fourth"][r.nth ?? 1]} ${DAY_LONG[r.weekday ?? 0]} of the month`;
  } else {
    const days = [0, 1, 2, 3, 4, 5, 6].filter((d) => (b.days_mask ?? 0) & (1 << d));
    base =
      days.length === 7 ? "Every day" : days.length === 5 && days.every((d) => d < 5) ? "Weekdays" : days.length === 2 && days[0] === 5 && days[1] === 6 ? "Weekends" : days.length === 1 ? `Every ${DAY_LONG[days[0]]}` : days.map((d) => DAY_SHORT[d]).join(", ");
  }
  if (rec !== "once" && (b.date_from || b.date_to)) base += ` · ${b.date_from ? shortDate(b.date_from) : "…"} to ${b.date_to ? shortDate(b.date_to) : "…"}`;
  if (b.exceptions?.length) base += ` · skips ${b.exceptions.length === 1 ? shortDate(b.exceptions[0]) : `${b.exceptions.length} dates`}`;
  return base;
}
const clockText = (ms: number) => {
  const s = Math.round(Math.abs(ms) / 1000);
  return s >= 3600 ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const badgeFor = (b: PlanBlock) => ((b.recurrence ?? "weekly") === "once" ? "ONE-OFF" : b.date_from || b.date_to ? "SEASON" : null);
const isRepeating = (b: PlanBlock) => (b.recurrence ?? "weekly") !== "once";
const layerName = (n: number) => (n === 3 ? "3 · One-off (on top)" : n === 2 ? "2 · Seasonal" : "1 · Regular week");

interface Selection {
  slug: string;
  blockId: string;
  date: string;
  start_ms: number;
}

type ModalState =
  | { kind: "editor"; draft: EditorDraft }
  | { kind: "scope"; slug: string; block: PlanBlock; date: string; changes: Record<string, unknown>; verb: string }
  | { kind: "delete"; block: PlanBlock; date: string }
  | { kind: "publish" }
  | { kind: "preview"; slug: string; date: string }
  | { kind: "history"; slug: string }
  | { kind: "discard"; slug: string }
  | { kind: "resolve"; slug: string; issue: { block_id: string; other_block_id: string; date: string; start_ms?: number; end_ms?: number } }
  | { kind: "copy"; slug: string; from: number }
  | { kind: "ro"; slug: string; blockId: string; date: string }
  | { kind: "fill"; slug: string; block: PlanBlock; date: string; item: LibraryResult };

// ------------------------------------------------------------------ the page

export function Timeline() {
  const now = useNow(30_000);
  const [params, setParams] = useSearchParams();
  const today = paris(now).date;
  const view: "day" | "week" = params.get("view") === "week" ? "week" : "day";
  const mode: "draft" | "live" = params.get("mode") === "live" ? "live" : "draft";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get("date") ?? "") ? params.get("date")! : today;
  const [slug, setSlug] = useState<string | null>(params.get("channel"));
  const [board, setBoard] = useState<Board | null>(null);
  const [drafts, setDrafts] = useState<Record<string, ChannelDraft>>({});
  const [selection, setSelection] = useState<Selection | null>(null);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [libOpen, setLibOpen] = useState(false);
  // The whole day fits the screen by default; the zoom is remembered once changed.
  const fitPx = () => Math.max(25, Math.floor((Math.min(window.innerWidth, 1600) - 130 - 160 - (selection ? 360 : 0)) / 24));
  const [pxPerHour, setPxPerHour] = useState(() => {
    try {
      return Number(localStorage.getItem("sch-tl-zoom")) || fitPx();
    } catch {
      return fitPx();
    }
  });
  const narrow = useNarrow();

  const set = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) if (v === null) p.delete(k);
    else p.set(k, v);
    setParams(p, { replace: true });
  };

  const monday = addDays(date, -weekday(date));
  const range = view === "day" ? { from: parisMs(date, 0), to: parisMs(addDays(date, 1), 0) } : { from: parisMs(monday, 0), to: parisMs(addDays(monday, 7), 0) };

  const load = useCallback(() => {
    planApi
      .board(range.from, range.to, mode, view === "week" ? (slug ?? undefined) : undefined)
      .then((b) => {
        setBoard(b);
        setError(null);
        setDrafts((d) => ({ ...d, ...Object.fromEntries(b.channels.map((c) => [c.slug, c.draft])) }));
        if (view === "week" && !slug && b.channels[0]) setSlug(b.channels[0].slug);
      })
      .catch((e) => setError(friendly(e)));
    if (view === "week") planApi.drafts().then((r) => setDrafts(r.drafts)).catch(() => {});
  }, [range.from, range.to, mode, view, slug]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (view === "week" && slug && params.get("channel") !== slug) set({ channel: slug });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, view]);
  useEffect(() => {
    try {
      localStorage.setItem("sch-tl-zoom", String(pxPerHour));
    } catch {
      /* fine */
    }
  }, [pxPerHour]);

  /** After any working-copy edit: new drafts and a fresh board. */
  const edited = (message: string, res?: { drafts?: Record<string, ChannelDraft> }) => {
    if (res?.drafts) setDrafts((d) => ({ ...d, ...res.drafts }));
    setToast({ message, tone: "info" });
    load();
  };
  const fail = (e: unknown) => setToast({ message: friendly(e), tone: "error" });

  const editable = mode === "draft" && !narrow;
  const lanes = board?.channels ?? [];
  const blockOf = (s: string, id: string) => lanes.find((l) => l.slug === s)?.blocks.find((b) => b.id === id) ?? null;

  /** A drag, nudge or resize of one airing: asks "just this one / every" for a repeating block. */
  const changeAiring = (s: string, block: PlanBlock, segDate: string, changes: Record<string, unknown>, verb: string) => {
    if (isRepeating(block)) setModal({ kind: "scope", slug: s, block, date: segDate, changes, verb });
    else void applyChange(block, "all", segDate, changes, verb);
  };
  const applyChange = async (block: PlanBlock, scope: "all" | "occurrence", segDate: string, changes: Record<string, unknown>, verb: string) => {
    const lane = lanes.find((l) => l.blocks.some((b) => b.id === block.id));
    try {
      const res = await planApi.update(block.id, { ...bodyFor(draftFromBlock(block, lane?.slug ?? "")), ...changes, scope, date: segDate });
      edited(`${verb}${scope === "occurrence" ? ` for ${shortDate(segDate)} only` : ""}. In the draft: publish to put it on air.`, res);
      if (res.block) setSelection((sel) => (sel ? { ...sel, blockId: res.block.id, slug: String(changes.channel ?? sel.slug) } : sel));
    } catch (e) {
      fail(e);
    }
  };

  /**
   * Something dragged from the library drawer (§5.5): a playlist, template or
   * programme onto a block sets its fill (after a confirm); onto empty lane
   * time it creates a one-hour block there. Songs and audio go into a
   * block's running order.
   */
  const dropLibrary = async (s: string, item: LibraryResult, target: { block?: PlanBlock; date: string; minute: number }) => {
    const isList = item.kind === "playlist" || item.kind === "template";
    const isProg = item.kind === "programme";
    if (target.block) {
      if (isList || isProg) setModal({ kind: "fill", slug: s, block: target.block, date: target.date, item });
      else if (target.block.fill_kind === "manual" || target.block.fill_kind === "template") setModal({ kind: "ro", slug: s, blockId: target.block.id, date: target.date });
      else setToast({ message: `${target.block.name} fills itself by its ${target.block.fill_kind === "programme" ? "programme" : "rules"}. Make it manual to place songs by hand.`, tone: "info" });
      return;
    }
    if (!isList && !isProg) {
      setToast({ message: "Drop a song onto a manual block, or open a block's running order to add it.", tone: "info" });
      return;
    }
    const start = Math.min(1380, Math.floor(target.minute / 15) * 15);
    try {
      const res = await planApi.create({
        channel: s,
        name: item.title.slice(0, 60),
        description: isProg ? `The programme ${item.title}` : `From the ${item.kind} ${item.title}`.slice(0, 140),
        colour: item.kind === "template" || isProg ? "purple" : "blue",
        recurrence: "once",
        once_date: target.date,
        start_min: start,
        end_min: start + 60,
        fill_kind: isProg ? "programme" : item.kind,
        programme_id: isProg ? item.programme_id : null,
        list_id: isList ? item.list_id : null,
        tags_any: [],
      });
      edited(`Added ${item.title} as a one-off at ${mm(start)} (in the draft). Edit it to make it repeat.`, res);
      setSelection({ slug: s, blockId: res.block.id, date: target.date, start_ms: 0 });
    } catch (e) {
      fail(e);
    }
  };

  const selLane = selection ? lanes.find((l) => l.slug === selection.slug) ?? null : null;
  const selBlock = selection && selLane ? selLane.blocks.find((b) => b.id === selection.blockId) ?? null : null;

  const draftList = Object.values(drafts);
  const changed = draftList.filter((d) => d.changes.length);
  const conflicts = changed.reduce((n, d) => n + d.issues.filter((i) => i.code === "conflict").length, 0);
  const reds = changed.reduce((n, d) => n + d.issues.filter((i) => i.level === "red").length, 0);
  const liveLane = view === "week" ? lanes[0] : null;
  const firstChange = changed.map((d) => d.first_change_ms).filter((x): x is number => !!x).sort((a, b) => a - b)[0];

  return (
    <div className="sch sch-tl">
      <SchedulerNav />
      <header className="sch-tl-top">
        <h1 className="sch-h2">Timeline</h1>
        <div className="sch-tl-date">
          <button type="button" className="sch-icon-btn" aria-label={view === "day" ? "Previous day" : "Previous week"} onClick={() => set({ date: addDays(date, view === "day" ? -1 : -7) })}>
            ‹
          </button>
          <span className="sch-tl-date-label">{view === "day" ? longDate(parisMs(date, 12 * 60)) : `Week of ${longDate(parisMs(monday, 12 * 60))}`}</span>
          <button type="button" className="sch-icon-btn" aria-label={view === "day" ? "Next day" : "Next week"} onClick={() => set({ date: addDays(date, view === "day" ? 1 : 7) })}>
            ›
          </button>
          <button type="button" className="sch-btn sch-btn-sm" onClick={() => set({ date: null })} disabled={date === today}>
            Today
          </button>
        </div>
        <div className="sch-seg" role="radiogroup" aria-label="View">
          <button type="button" role="radio" aria-checked={view === "day"} className={view === "day" ? "is-on" : ""} onClick={() => set({ view: null })}>
            Day
          </button>
          <button type="button" role="radio" aria-checked={view === "week"} className={view === "week" ? "is-on" : ""} onClick={() => set({ view: "week" })}>
            Week
          </button>
        </div>
        <div className="sch-seg is-mode" role="radiogroup" aria-label="Draft or live">
          <button type="button" role="radio" aria-checked={mode === "draft"} className={mode === "draft" ? "is-on" : ""} onClick={() => set({ mode: null })}>
            Draft
          </button>
          <button type="button" role="radio" aria-checked={mode === "live"} className={mode === "live" ? "is-on is-live" : ""} onClick={() => set({ mode: "live" })}>
            Live
          </button>
        </div>
        {view === "week" && (
          <select className="sch-input sch-tl-channel" value={slug ?? ""} onChange={(e) => setSlug(e.target.value)} aria-label="Channel">
            {draftList.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
                {d.changes.length ? ` · ${d.changes.length} draft change${d.changes.length === 1 ? "" : "s"}` : ""}
              </option>
            ))}
          </select>
        )}
        <span className="sch-spacer" />
        {editable && view === "day" && (
          <button type="button" className="sch-btn" aria-pressed={libOpen} onClick={() => setLibOpen((x) => !x)}>
            {libOpen ? "Hide library" : "Library"}
          </button>
        )}
        {editable && (
          <button
            type="button"
            className="sch-btn sch-btn-red"
            onClick={() => setModal({ kind: "editor", draft: newDraft(view === "week" ? (slug ?? lanes[0]?.slug ?? "") : (selection?.slug ?? lanes[0]?.slug ?? ""), date, 18 * 60, 19 * 60, weekday(date)) })}
          >
            + Add block
          </button>
        )}
        <button type="button" className="sch-tl-live" onClick={() => setModal({ kind: "history", slug: view === "week" ? (slug ?? "") : (selection?.slug ?? lanes[0]?.slug ?? "") })}>
          <i aria-hidden="true" /> LIVE
          {liveLane ? ` · Plan ${liveLane.live_plan ?? "–"} · v${liveLane.live_version ?? "–"}` : ""} · History
        </button>
      </header>

      {error && (
        <p className="sch-error" role="alert">
          {error}
        </p>
      )}

      {mode === "draft" && (
        <div className={`sch-tl-banner${changed.length ? " has-changes" : ""}${reds ? " has-red" : ""}`} role="status">
          {changed.length ? (
            <>
              <span>
                <strong>Draft:</strong> {changed.reduce((n, d) => n + d.changes.length, 0)} change{changed.reduce((n, d) => n + d.changes.length, 0) === 1 ? "" : "s"} on {changed.map((d) => d.name).join(", ")}, not yet live
                {firstChange ? ` (the first takes effect ${when(firstChange)})` : ""}.
                {conflicts ? ` ${conflicts} conflict${conflicts === 1 ? "" : "s"} to resolve before publishing.` : reds ? ` ${reds} problem${reds === 1 ? "" : "s"} to fix before publishing.` : ""}
              </span>
              <span className="sch-spacer" />
              <button type="button" className="sch-btn sch-btn-sm" onClick={() => setModal({ kind: "preview", slug: changed[0].slug, date: firstChange ? paris(firstChange).date : date })}>
                Preview
              </button>
              <button type="button" className="sch-btn sch-btn-sm" onClick={() => setModal({ kind: "discard", slug: view === "week" && slug ? slug : changed[0].slug })}>
                Discard
              </button>
              <button type="button" className="sch-btn sch-btn-sm sch-btn-red" onClick={() => setModal({ kind: "publish" })}>
                Publish
              </button>
            </>
          ) : (
            <span className="sch-dim">Draft: no changes. Edit freely: nothing reaches the air until you publish.</span>
          )}
        </div>
      )}
      {mode === "live" && <div className="sch-tl-banner is-live">Live: the published plan. Switch to Draft to make changes.</div>}

      <div className={`sch-tl-layout${selection ? " has-panel" : ""}${libOpen && editable && view === "day" ? " has-lib" : ""}`}>
        {libOpen && editable && view === "day" && (
          <aside className="sch-card sch-tl-lib" aria-label="Library">
            <p className="sch-eyebrow">Library</p>
            <LibrarySearch
              actionLabel="Info"
              types={[
                { key: "playlists", label: "Playlists" },
                { key: "templates", label: "Templates" },
                { key: "programmes", label: "Programmes" },
                { key: "songs", label: "Songs" },
                { key: "features", label: "Audio" },
              ]}
              onPick={(item) =>
                setToast({
                  message: item.kind === "playlist" || item.kind === "template" || item.kind === "programme" ? `Drag ${item.title} onto a block to fill it with it, or onto empty time to add it as a one-hour block.` : `Drag ${item.title} onto a manual block to add it to that airing's running order.`,
                  tone: "info",
                })
              }
            />
          </aside>
        )}
        <div className="sch-tl-main">
          {!board ? (
            <p className="sch-dim">Loading…</p>
          ) : narrow ? (
            <ListView board={board} now={now} onSelect={setSelection} selection={selection} />
          ) : view === "day" ? (
            <DayView
              board={board}
              now={now}
              date={date}
              pxPerHour={pxPerHour}
              setPxPerHour={setPxPerHour}
              fitPx={fitPx}
              editable={editable}
              selection={selection}
              onSelect={setSelection}
              onCreate={(s, start, end) => setModal({ kind: "editor", draft: newDraft(s, date, start, end, weekday(date)) })}
              onChange={changeAiring}
              onResolve={(s, c) => setModal({ kind: "resolve", slug: s, issue: c })}
              onDropLibrary={(s, item, target) => void dropLibrary(s, item, target)}
            />
          ) : (
            <WeekView
              board={board}
              now={now}
              monday={monday}
              editable={editable}
              selection={selection}
              onSelect={setSelection}
              onCreate={(d, start, end) => slug && setModal({ kind: "editor", draft: newDraft(slug, d, start, end, weekday(d)) })}
              onCopy={(from) => slug && setModal({ kind: "copy", slug, from })}
              onResolve={(c) => slug && setModal({ kind: "resolve", slug, issue: c })}
            />
          )}
          <Legend />
        </div>
        {selection && selLane && selBlock && (
          <BlockPanel
            lane={selLane}
            block={selBlock}
            selection={selection}
            board={board!}
            editable={editable}
            onClose={() => setSelection(null)}
            onEdit={() =>
              setModal({
                kind: "editor",
                draft: { ...draftFromBlock(selBlock, selLane.slug), scope: isRepeating(selBlock) ? { date: selection.date, label: shortDate(selection.date) } : undefined },
              })
            }
            onDuplicate={async () => {
              try {
                const r = await planApi.duplicate(selBlock.id);
                edited(`Duplicated ${selBlock.name} in the draft`, r);
                setSelection({ ...selection, blockId: r.block.id });
              } catch (e) {
                fail(e);
              }
            }}
            onDelete={() => setModal({ kind: "delete", block: selBlock, date: selection.date })}
            onResolve={(c) => setModal({ kind: "resolve", slug: selLane.slug, issue: c })}
            onFix={(blockId, edit) => {
              const b = blockOf(selLane.slug, blockId);
              if (b) setModal({ kind: "editor", draft: draftFromBlock(b, selLane.slug) });
              void edit;
            }}
            onOpenRunningOrder={(d) => setModal({ kind: "ro", slug: selLane.slug, blockId: selBlock.id, date: d })}
            onNextEpisode={async () => {
              try {
                const r = await contentApi.nextEpisode(selBlock.id);
                edited(`Created the ${selBlock.name} episode for ${r.date_label} (in the draft). Fill its empty slots.`, r);
                setModal({ kind: "ro", slug: selLane.slug, blockId: selBlock.id, date: r.date });
              } catch (e) {
                fail(e);
              }
            }}
          />
        )}
      </div>

      {modal?.kind === "editor" && board && (
        <PlanEditor
          board={board}
          draft={modal.draft}
          onClose={() => setModal(null)}
          onSaved={(message, block) => {
            setModal(null);
            edited(`${message}. Publish to put it on air.`);
            if (block) setSelection({ slug: modal.draft.channel, blockId: block.id, date: modal.draft.scope?.date ?? date, start_ms: 0 });
          }}
        />
      )}
      {modal?.kind === "scope" && (
        <Modal
          title={`${modal.verb}: just this ${DAY_LONG[weekday(modal.date)]}, or every time?`}
          onClose={() => {
            setModal(null);
            load();
          }}
          footer={
            <>
              <button type="button" className="sch-btn" onClick={() => (setModal(null), load())}>
                Cancel
              </button>
              <button type="button" className="sch-btn" onClick={() => (setModal(null), void applyChange(modal.block, "occurrence", modal.date, modal.changes, modal.verb))}>
                Just {shortDate(modal.date)}
              </button>
              <button type="button" className="sch-btn sch-btn-red" onClick={() => (setModal(null), void applyChange(modal.block, "all", modal.date, modal.changes, modal.verb))}>
                {repeatsText(modal.block).split(" · ")[0]}
              </button>
            </>
          }
        >
          <p>
            <strong>{modal.block.name}</strong> repeats ({repeatsText(modal.block)}). "Just {shortDate(modal.date)}" leaves the others as they are: the regular block skips that date and a one-off airs on top.
          </p>
        </Modal>
      )}
      {modal?.kind === "delete" && (
        <DeleteAsk
          block={modal.block}
          date={modal.date}
          onClose={() => setModal(null)}
          onDone={(msg, res) => {
            setModal(null);
            setSelection(null);
            edited(msg, res);
          }}
          onError={fail}
        />
      )}
      {modal?.kind === "discard" && (
        <DiscardAsk
          drafts={changed}
          initial={modal.slug}
          onClose={() => setModal(null)}
          onDone={(msg, res) => {
            setModal(null);
            setSelection(null);
            edited(msg, res);
          }}
          onError={fail}
        />
      )}
      {modal?.kind === "publish" && (
        <PublishDialog
          drafts={changed}
          onClose={() => setModal(null)}
          onDone={(res) => {
            setDrafts((d) => ({ ...d, ...res.drafts }));
            load();
          }}
        />
      )}
      {modal?.kind === "preview" && <PreviewDialog drafts={changed} initial={modal.slug} date={modal.date} onClose={() => setModal(null)} />}
      {modal?.kind === "history" && modal.slug && (
        <PlanHistory
          slug={modal.slug}
          channels={draftList}
          onClose={() => setModal(null)}
          onRolledBack={(msg, res) => {
            setModal(null);
            edited(msg, res);
          }}
          onError={fail}
        />
      )}
      {modal?.kind === "resolve" && board && (
        <ResolveDialog
          lane={lanes.find((l) => l.slug === modal.slug)!}
          issue={modal.issue}
          onClose={() => setModal(null)}
          onEdit={(b) => setModal({ kind: "editor", draft: draftFromBlock(b, modal.slug) })}
          onDone={(msg, res) => {
            setModal(null);
            edited(msg, res);
          }}
          onError={fail}
        />
      )}
      {modal?.kind === "copy" && (
        <CopyDayDialog
          slug={modal.slug}
          from={modal.from}
          onClose={() => setModal(null)}
          onDone={(msg, res) => {
            setModal(null);
            edited(msg, res);
          }}
          onError={fail}
        />
      )}
      {modal?.kind === "ro" && board && blockOf(modal.slug, modal.blockId) && (
        <RunningOrderDialog
          board={board}
          block={blockOf(modal.slug, modal.blockId)!}
          channel={modal.slug}
          date={modal.date}
          mode={mode}
          editable={editable}
          onClose={() => {
            setModal(null);
            load();
          }}
          onChanged={(message, d) => {
            if (d) setDrafts((x) => ({ ...x, ...d }));
            setToast({ message, tone: "info" });
          }}
        />
      )}
      {modal?.kind === "fill" && (
        <Modal
          title={`Fill ${modal.block.name} with ${modal.item.title}?`}
          onClose={() => setModal(null)}
          footer={
            <>
              <button type="button" className="sch-btn" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="sch-btn sch-btn-red"
                onClick={() => {
                  const m = modal;
                  setModal(null);
                  const kind = m.item.kind === "programme" ? "programme" : m.item.kind;
                  changeAiring(m.slug, m.block, m.date, { fill_kind: kind, programme_id: m.item.programme_id ?? null, list_id: m.item.list_id ?? null }, `${m.block.name} is now filled by the ${kind} ${m.item.title}`);
                }}
              >
                Fill it
              </button>
            </>
          }
        >
          <p>
            <strong>{modal.block.name}</strong> is filled by {modal.block.fill_kind === "programme" ? "a programme" : modal.block.fill_kind === "autopilot" ? "songs by tag" : `a ${modal.block.fill_kind === "manual" ? "hand-built running order" : modal.block.fill_kind}`} now. It will play the {modal.item.kind} <strong>{modal.item.title}</strong> instead (in the draft).
          </p>
        </Modal>
      )}
      <Toast toast={toast} onUndo={() => {}} onClose={() => setToast(null)} />
    </div>
  );
}

/** Keep a drag's pointer events coming to this element (harmless if the browser refuses). */
function capture(el: Element | null, pointerId: number) {
  try {
    el?.setPointerCapture(pointerId);
  } catch {
    /* fine */
  }
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 900);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 900);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return narrow;
}

function Legend() {
  return (
    <ul className="sch-tl-legend" aria-label="Legend">
      <li>
        <i className="is-blue" /> Music
      </li>
      <li>
        <i className="is-purple" /> Show
      </li>
      <li>
        <i className="is-default" /> Channel default / safety net
      </li>
      <li>
        <i className="is-conflict" /> Conflict
      </li>
      <li>📌 Hard start</li>
      <li>↻ Repeats</li>
    </ul>
  );
}

// ------------------------------------------------------------------ day view: every channel

interface DragState {
  kind: "move" | "start" | "end";
  slug: string;
  laneIndex: number;
  block: PlanBlock;
  seg: PlanSegment;
  x0: number;
  y0: number;
  dMin: number;
  dLane: number;
  moved: boolean;
}

function DayView({
  board,
  now,
  date,
  pxPerHour,
  setPxPerHour,
  fitPx,
  editable,
  selection,
  onSelect,
  onCreate,
  onChange,
  onResolve,
  onDropLibrary,
}: {
  board: Board;
  now: number;
  date: string;
  pxPerHour: number;
  setPxPerHour: (n: number) => void;
  fitPx: () => number;
  editable: boolean;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  onCreate: (slug: string, start: number, end: number) => void;
  onChange: (slug: string, block: PlanBlock, date: string, changes: Record<string, unknown>, verb: string) => void;
  onResolve: (slug: string, c: { block_id: string; other_block_id: string; date: string; start_ms: number; end_ms: number }) => void;
  onDropLibrary: (slug: string, item: LibraryResult, target: { block?: PlanBlock; date: string; minute: number }) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [dropLane, setDropLane] = useState<string | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghost, setGhost] = useState<{ slug: string; a: number; b: number } | null>(null);
  const [nudge, setNudge] = useState<{ key: string; dStart: number; dEnd: number } | null>(null);
  const create = useRef<{ slug: string; from: number } | null>(null);
  const from = board.from;
  const width = 24 * pxPerHour;
  const x = (ms: number) => ((ms - from) / HOUR) * pxPerHour;
  const minAt = (clientX: number) => {
    const el = scroller.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1440, snap(((clientX - rect.left + el.scrollLeft - 160) / pxPerHour) * 60)));
  };
  const isToday = paris(now).date === date;

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const target = isToday ? x(now) - el.clientWidth / 3 : x(from + 6 * HOUR);
    el.scrollLeft = Math.max(0, target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  // Ctrl/⌘ + scroll zooms.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setPxPerHour(Math.max(25, Math.min(600, Math.round(pxPerHour * (e.deltaY < 0 ? 1.15 : 1 / 1.15)))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [pxPerHour, setPxPerHour]);

  const lanes = board.channels;
  const endDrag = () => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (!d.moved) {
      onSelect({ slug: d.slug, blockId: d.block.id, date: d.seg.date, start_ms: d.seg.start_ms });
      return;
    }
    const target = lanes[d.laneIndex + d.dLane];
    const changes: Record<string, unknown> = {};
    let verb = "";
    if (d.kind === "move") {
      changes.start_min = (d.block.start_min + d.dMin + 1440) % 1440;
      changes.end_min = ((d.block.end_min + d.dMin + 1440) % 1440) || 1440;
      verb = `Moved ${d.block.name} to ${mm(changes.start_min as number)}`;
      if (target && target.slug !== d.slug) {
        changes.channel = target.slug;
        verb = `Moved ${d.block.name} to ${target.name} at ${mm(changes.start_min as number)}`;
      }
    } else if (d.kind === "start") {
      changes.start_min = (d.block.start_min + d.dMin + 1440) % 1440;
      verb = `${d.block.name} now starts at ${mm(changes.start_min as number)}`;
    } else {
      changes.end_min = ((d.block.end_min + d.dMin + 1440) % 1440) || 1440;
      verb = `${d.block.name} now ends at ${mm(changes.end_min as number)}`;
    }
    if (changes.start_min === d.block.start_min && changes.end_min === d.block.end_min && !changes.channel) return;
    onChange(d.slug, d.block, d.seg.date, changes, verb);
  };

  return (
    <div className="sch-tl-day">
      <div className="sch-tl-zoom">
        <label>
          <span className="sch-dim">Zoom</span>
          <input type="range" min={25} max={600} step={5} value={pxPerHour} onChange={(e) => setPxPerHour(Number(e.target.value))} aria-label="Zoom" />
        </label>
        <button
          type="button"
          className="sch-btn sch-btn-sm"
          onClick={() => {
            const el = scroller.current;
            setPxPerHour(el ? Math.max(25, Math.floor((el.clientWidth - 162) / 24)) : fitPx());
          }}
        >
          Whole day
        </button>
        <button type="button" className="sch-btn sch-btn-sm" onClick={() => setPxPerHour(600)}>
          One hour
        </button>
        <span className="sch-dim">Ctrl/⌘ + scroll to zoom{editable ? " · drag a bar to move it, its edges to resize, empty time to add a block" : ""}</span>
      </div>
      <div
        className="sch-tl-scroll"
        ref={scroller}
        onPointerMove={(e) => {
          if (drag) {
            const dMin = snap(((e.clientX - drag.x0) / pxPerHour) * 60);
            const dLane = drag.kind === "move" ? Math.round((e.clientY - drag.y0) / 64) : 0;
            const clampedLane = Math.max(-drag.laneIndex, Math.min(lanes.length - 1 - drag.laneIndex, dLane));
            setDrag({ ...drag, dMin, dLane: clampedLane, moved: drag.moved || Math.abs(e.clientX - drag.x0) > 4 || Math.abs(e.clientY - drag.y0) > 8 });
          } else if (create.current) {
            const m = minAt(e.clientX);
            setGhost({ slug: create.current.slug, a: Math.min(create.current.from, m), b: Math.max(create.current.from + SNAP, m) });
          }
        }}
        onPointerUp={() => {
          if (drag) endDrag();
          else if (create.current && ghost) {
            const g = ghost;
            create.current = null;
            setGhost(null);
            onCreate(g.slug, g.a, g.b - g.a >= 15 ? g.b : Math.min(1440, g.a + 60));
          }
        }}
      >
        <div className="sch-tl-canvas" style={{ width: width + 160 }}>
          <div className="sch-tl-axis" style={{ width }}>
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ left: h * pxPerHour }}>
                {String(h).padStart(2, "0")}
                {pxPerHour >= 120 ? ":00" : ""}
              </span>
            ))}
            {pxPerHour >= 240 &&
              Array.from({ length: 24 * 4 }, (_, q) => q % 4 !== 0 && (
                <span key={`q${q}`} className="is-minor" style={{ left: (q / 4) * pxPerHour }}>
                  {String(Math.floor(q / 4)).padStart(2, "0")}:{String((q % 4) * 15).padStart(2, "0")}
                </span>
              ))}
          </div>
          {lanes.map((lane, laneIndex) => {
            const segs = lane.segments;
            // Channel-default spans: time no block covers.
            const defaults: [number, number][] = [];
            let cursor = board.from;
            for (const s of segs) {
              if (s.start_ms > cursor) defaults.push([cursor, Math.min(s.start_ms, board.to)]);
              cursor = Math.max(cursor, s.end_ms);
            }
            if (cursor < board.to) defaults.push([cursor, board.to]);
            return (
              <div key={lane.slug} className="sch-tl-lane">
                <div className="sch-tl-lane-head">
                  <i style={{ background: lane.accent }} aria-hidden="true" />
                  <span>
                    <strong>{lane.name}</strong>
                    <small>
                      {lane.status !== "live" ? "Not live" : lane.enabled ? `Default: ${lane.programming_mode === "programme" ? "programme" : "auto"}` : "Shadow mode"}
                      {lane.draft.changes.length ? ` · ${lane.draft.changes.length} draft` : ""}
                    </small>
                  </span>
                </div>
                <div
                  className={`sch-tl-track${editable ? " is-editable" : ""}${dropLane === lane.slug ? " is-drop" : ""}`}
                  style={{ width, backgroundSize: `${pxPerHour}px 100%` }}
                  onDragOver={(e) => {
                    if (!editable || !e.dataTransfer.types.includes(LIBRARY_MIME)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    if (dropLane !== lane.slug) setDropLane(lane.slug);
                  }}
                  onDragLeave={() => setDropLane(null)}
                  onDrop={(e) => {
                    setDropLane(null);
                    const raw = e.dataTransfer.getData(LIBRARY_MIME);
                    if (!editable || !raw) return;
                    e.preventDefault();
                    const bar = (e.target as HTMLElement).closest<HTMLElement>(".sch-tl-bar");
                    const block = bar?.dataset.block ? lane.blocks.find((b) => b.id === bar.dataset.block) : undefined;
                    onDropLibrary(lane.slug, JSON.parse(raw) as LibraryResult, { block, date: bar?.dataset.date ?? date, minute: minAt(e.clientX) });
                  }}
                  onPointerDown={(e) => {
                    if (!editable || (e.target as HTMLElement).closest(".sch-tl-bar, .sch-tl-conflict")) return;
                    const m = minAt(e.clientX);
                    create.current = { slug: lane.slug, from: Math.floor(m / 15) * 15 };
                    setGhost({ slug: lane.slug, a: create.current.from, b: create.current.from + 60 });
                    capture(e.currentTarget.closest(".sch-tl-scroll"), e.pointerId);
                  }}
                >
                  {isToday && <span className="sch-tl-past" style={{ width: Math.max(0, x(now)) }} aria-hidden="true" />}
                  {defaults.map(([a, b]) => (
                    <span key={`d${a}`} className="sch-tl-default" style={{ left: x(a), width: Math.max(0, x(b) - x(a)) }} aria-hidden="true">
                      {x(b) - x(a) > 70 && lane.name}
                    </span>
                  ))}
                  {segs.map((s) => {
                    const block = lane.blocks.find((b) => b.id === s.block_id);
                    if (!block) return null;
                    const key = `${s.block_id}@${s.start_ms}`;
                    const dragging = drag && drag.seg === s;
                    const n = nudge?.key === key ? nudge : null;
                    let a = s.start_ms;
                    let b = s.end_ms;
                    if (dragging) {
                      if (drag.kind !== "end") a += drag.dMin * 60_000;
                      if (drag.kind !== "start") b += drag.dMin * 60_000;
                    }
                    if (n) {
                      a += n.dStart * 60_000;
                      b += n.dEnd * 60_000;
                    }
                    const w = Math.max(6, x(b) - x(a) - 2);
                    const selected = selection?.blockId === block.id && selection.date === s.date;
                    const badge = badgeFor(block);
                    return (
                      <button
                        key={key}
                        type="button"
                        className={`sch-tl-bar is-${block.colour}${selected ? " is-selected" : ""}${dragging ? " is-dragging" : ""}${s.cut ? " is-cut" : ""}${s.resumed ? " is-resumed" : ""}${block.active ? "" : " is-inactive"}`}
                        style={{ left: x(a), width: w, transform: dragging && drag.dLane ? `translateY(${drag.dLane * 64}px)` : undefined }}
                        aria-label={`${block.name}, ${hm(s.start_ms)} to ${hm(s.end_ms)} on ${lane.name}. ${repeatsText(block)}. ${block.description}${editable ? ". Arrow keys move it by 5 minutes, Shift+arrows change its end, Enter saves." : ""}`}
                        aria-pressed={selected}
                        data-block={block.id}
                        data-date={s.date}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          const edge = e.clientX - rect.left < 7 ? "start" : rect.right - e.clientX < 7 ? "end" : "move";
                          if (!editable || s.resumed) {
                            onSelect({ slug: lane.slug, blockId: block.id, date: s.date, start_ms: s.start_ms });
                            return;
                          }
                          setDrag({ kind: edge, slug: lane.slug, laneIndex, block, seg: s, x0: e.clientX, y0: e.clientY, dMin: 0, dLane: 0, moved: false });
                          capture(e.currentTarget.closest(".sch-tl-scroll"), e.pointerId);
                        }}
                        onKeyDown={(e) => {
                          if (!editable) return;
                          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                            e.preventDefault();
                            const step = e.key === "ArrowLeft" ? -SNAP : SNAP;
                            const cur = n ?? { key, dStart: 0, dEnd: 0 };
                            setNudge(e.shiftKey ? { ...cur, dEnd: cur.dEnd + step } : { ...cur, dStart: cur.dStart + step, dEnd: cur.dEnd + step });
                          } else if (e.key === "Enter" && n) {
                            e.preventDefault();
                            setNudge(null);
                            const changes = { start_min: (block.start_min + n.dStart + 1440) % 1440, end_min: ((block.end_min + n.dEnd + 1440) % 1440) || 1440 };
                            onChange(lane.slug, block, s.date, changes, n.dStart === n.dEnd ? `Moved ${block.name} to ${mm(changes.start_min)}` : `${block.name}: ${mm(changes.start_min)}–${mm(changes.end_min)}`);
                          } else if (e.key === "Escape" && n) setNudge(null);
                        }}
                        onBlur={() => n && setNudge(null)}
                      >
                        {block.start_mode !== "flexible" && !s.resumed && (
                          <span className={`sch-tl-pin${block.priority === "high" ? " is-high" : ""}`} aria-hidden="true">
                            📌
                          </span>
                        )}
                        <strong>
                          {s.resumed ? "↳ " : ""}
                          {block.name}
                        </strong>
                        {w > 110 && (
                          <span className="sch-tl-bar-meta">
                            {dragging || n ? `${hm(a)}–${hm(b)}` : `${hm(s.start_ms)}–${hm(s.end_ms)}`}
                            {w > 170 && ` · ${block.mode === "manual" ? "MANUAL" : "AUTO"}`}
                            {isRepeating(block) && " ↻"}
                          </span>
                        )}
                        {badge && w > 80 && <span className="sch-tl-badge">{badge}</span>}
                        {editable && !s.resumed && (
                          <>
                            <span className="sch-tl-grip is-start" aria-hidden="true" />
                            <span className="sch-tl-grip is-end" aria-hidden="true" />
                          </>
                        )}
                      </button>
                    );
                  })}
                  {lane.conflicts.map((c) => {
                    const other = lane.blocks.find((b) => b.id === c.other_block_id);
                    const first = lane.blocks.find((b) => b.id === c.block_id);
                    return (
                      <button
                        key={`${c.block_id}${c.other_block_id}${c.start_ms}`}
                        type="button"
                        className="sch-tl-conflict"
                        style={{ left: x(c.start_ms), width: Math.max(14, x(c.end_ms) - x(c.start_ms)) }}
                        onClick={() => onResolve(lane.slug, c)}
                        title={`Conflict: ${first?.name} and ${other?.name} overlap. Click to resolve.`}
                      >
                        ⚠ Conflict: {other?.name}
                      </button>
                    );
                  })}
                  {ghost?.slug === lane.slug && (
                    <span className="sch-tl-ghost" style={{ left: (ghost.a / 60) * pxPerHour, width: ((ghost.b - ghost.a) / 60) * pxPerHour }}>
                      {mm(ghost.a)}–{mm(ghost.b)}
                    </span>
                  )}
                  {isToday && <span className="sch-tl-now" style={{ left: x(now) }} aria-hidden="true" />}
                </div>
              </div>
            );
          })}
          {isToday && (
            <span className="sch-tl-now-tag" style={{ left: 160 + x(now) }}>
              NOW {hm(now)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ week view: one channel

function WeekView({
  board,
  now,
  monday,
  editable,
  selection,
  onSelect,
  onCreate,
  onCopy,
  onResolve,
}: {
  board: Board;
  now: number;
  monday: string;
  editable: boolean;
  selection: Selection | null;
  onSelect: (s: Selection) => void;
  onCreate: (date: string, start: number, end: number) => void;
  onCopy: (fromDay: number) => void;
  onResolve: (c: { block_id: string; other_block_id: string; date: string; start_ms: number; end_ms: number }) => void;
}) {
  const lane = board.channels[0];
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ day: number; from: number } | null>(null);
  const [ghost, setGhost] = useState<{ day: number; a: number; b: number } | null>(null);
  const p = paris(now);
  const days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const todayIdx = days.indexOf(p.date);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, (p.minutes / 60 - 2) * WEEK_HOUR_PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane?.slug]);

  // Segments cut into day columns at Paris midnight.
  const pieces = useMemo(() => {
    if (!lane) return [];
    const out: { seg: PlanSegment; block: PlanBlock; day: number; top: number; bottom: number; continuing: boolean }[] = [];
    for (const s of lane.segments) {
      const block = lane.blocks.find((b) => b.id === s.block_id);
      if (!block) continue;
      for (let d = 0; d < 7; d++) {
        const a = parisMs(days[d], 0);
        const b = parisMs(addDays(days[d], 1), 0);
        if (s.end_ms <= a || s.start_ms >= b) continue;
        const top = ((Math.max(s.start_ms, a) - a) / HOUR) * 60;
        const bottom = ((Math.min(s.end_ms, b) - a) / HOUR) * 60;
        out.push({ seg: s, block, day: d, top, bottom, continuing: s.start_ms < a });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lane, monday]);

  if (!lane) return <p className="sch-dim">Choose a channel.</p>;
  const minutesAt = (e: React.PointerEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(1440, Math.round((((e.clientY - rect.top) / (WEEK_HOUR_PX * 24)) * 1440) / 15) * 15));
  };

  return (
    <div className="sch-week sch-tl-week" role="region" aria-label={`${lane.name}, the week`}>
      <div className="sch-week-head">
        <span />
        {days.map((d, i) => (
          <span key={d} className={i === todayIdx ? "is-today" : undefined}>
            {DAY_SHORT[i]} {Number(d.slice(8, 10))}
            {editable && (
              <button type="button" className="sch-tl-copy" onClick={() => onCopy(i)} aria-label={`Copy ${DAY_LONG[i]} to other days`} title={`Copy ${DAY_LONG[i]} to…`}>
                ⧉
              </button>
            )}
          </span>
        ))}
      </div>
      <div className="sch-week-scroll" ref={scroller}>
        <div className="sch-week-body" style={{ height: WEEK_HOUR_PX * 24 }}>
          <div className="sch-hours" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * WEEK_HOUR_PX }}>
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {days.map((d, day) => (
            <div
              key={d}
              className={`sch-day${day === todayIdx ? " is-today" : ""}${editable ? "" : " is-locked"}`}
              style={{ backgroundSize: `100% ${WEEK_HOUR_PX / 2}px` }}
              onPointerDown={(e) => {
                if (!editable || (e.target as HTMLElement).closest(".sch-block")) return;
                const m = minutesAt(e, e.currentTarget);
                drag.current = { day, from: Math.floor(m / 30) * 30 };
                setGhost({ day, a: drag.current.from, b: drag.current.from + 30 });
                capture(e.currentTarget, e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!drag.current || drag.current.day !== day) return;
                const m = minutesAt(e, e.currentTarget);
                setGhost({ day, a: Math.min(drag.current.from, m), b: Math.max(drag.current.from + 15, m) });
              }}
              onPointerUp={() => {
                if (!drag.current || !ghost) return;
                const { a, b } = ghost;
                drag.current = null;
                setGhost(null);
                onCreate(d, a, b - a >= 30 ? b : Math.min(1440, a + 60));
              }}
            >
              <span className="sch-day-default" aria-hidden="true">
                {lane.name}
              </span>
              {todayIdx === day && <span className="sch-tl-week-past" style={{ height: (p.minutes / 60) * WEEK_HOUR_PX }} aria-hidden="true" />}
              {pieces
                .filter((x) => x.day === day)
                .map((x) => {
                  const selected = selection?.blockId === x.block.id && selection.date === x.seg.date;
                  const badge = badgeFor(x.block);
                  return (
                    <button
                      key={`${x.seg.block_id}@${x.seg.start_ms}-${day}`}
                      type="button"
                      className={`sch-block is-${x.block.colour}${x.block.active ? "" : " is-inactive"}${x.continuing ? " is-continuing" : ""}${selected ? " is-selected" : ""}${x.seg.cut ? " is-cut" : ""}${badge ? " is-special" : ""}`}
                      style={{ top: (x.top / 60) * WEEK_HOUR_PX, height: Math.max(18, ((x.bottom - x.top) / 60) * WEEK_HOUR_PX - 2) }}
                      onClick={() => onSelect({ slug: lane.slug, blockId: x.block.id, date: x.seg.date, start_ms: x.seg.start_ms })}
                      aria-label={`${x.block.name}, ${shortDate(x.seg.date)} ${hm(x.seg.start_ms)} to ${hm(x.seg.end_ms)}. ${repeatsText(x.block)}.`}
                      aria-pressed={selected}
                    >
                      <strong>
                        {x.block.start_mode !== "flexible" && !x.continuing && !x.seg.resumed ? "📌 " : ""}
                        {x.continuing || x.seg.resumed ? `↳ ${x.block.name}` : x.block.name}
                      </strong>
                      <span>
                        {hm(x.seg.start_ms)}–{hm(x.seg.end_ms)}
                        {isRepeating(x.block) ? " ↻" : ""}
                        {badge ? ` · ${badge}` : ""}
                      </span>
                      <span className="sch-block-desc">{x.block.description}</span>
                    </button>
                  );
                })}
              {lane.conflicts
                .filter((c) => paris(c.start_ms).date === d)
                .map((c) => {
                  const a = parisMs(d, 0);
                  const other = lane.blocks.find((b) => b.id === c.other_block_id);
                  return (
                    <button
                      key={`c${c.block_id}${c.other_block_id}${c.start_ms}`}
                      type="button"
                      className="sch-tl-conflict is-vertical"
                      style={{ top: ((c.start_ms - a) / HOUR) * WEEK_HOUR_PX, height: Math.max(16, ((c.end_ms - c.start_ms) / HOUR) * WEEK_HOUR_PX) }}
                      onClick={() => onResolve(c)}
                      title={`Conflict with ${other?.name}: click to resolve`}
                    >
                      ⚠ {other?.name}
                    </button>
                  );
                })}
              {ghost?.day === day && <span className="sch-ghost" style={{ top: (ghost.a / 60) * WEEK_HOUR_PX, height: ((ghost.b - ghost.a) / 60) * WEEK_HOUR_PX }} />}
              {day === todayIdx && <span className="sch-nowline" style={{ top: (p.minutes / 60) * WEEK_HOUR_PX }} aria-label={`Now, ${mm(p.minutes)}`} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ narrow screens: a read-only list

function ListView({ board, now, onSelect, selection }: { board: Board; now: number; onSelect: (s: Selection) => void; selection: Selection | null }) {
  return (
    <div className="sch-tl-list">
      <p className="sch-dim">Editing needs a wider screen. Here's what's planned.</p>
      {board.channels.map((lane) => (
        <section key={lane.slug} className="sch-card">
          <h2 className="sch-h3">{lane.name}</h2>
          {lane.segments.length === 0 ? (
            <p className="sch-dim">Channel default all day.</p>
          ) : (
            <ul className="sch-plain">
              {lane.segments.map((s) => {
                const b = lane.blocks.find((x) => x.id === s.block_id);
                if (!b) return null;
                return (
                  <li key={`${s.block_id}${s.start_ms}`}>
                    <button
                      type="button"
                      className={`sch-tl-list-row${selection?.blockId === b.id && selection.date === s.date ? " is-on" : ""}${s.end_ms < now ? " is-past" : ""}`}
                      onClick={() => onSelect({ slug: lane.slug, blockId: b.id, date: s.date, start_ms: s.start_ms })}
                    >
                      <span>
                        {hm(s.start_ms)}–{hm(s.end_ms)}
                      </span>
                      <strong>{b.name}</strong>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ the block panel

function BlockPanel({
  lane,
  block,
  selection,
  board,
  editable,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
  onResolve,
  onFix,
  onOpenRunningOrder,
  onNextEpisode,
}: {
  lane: BoardLane;
  block: PlanBlock;
  selection: Selection;
  board: Board;
  editable: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onResolve: (c: { block_id: string; other_block_id: string; date: string }) => void;
  onFix: (blockId: string, edit: true) => void;
  onOpenRunningOrder: (date: string) => void;
  onNextEpisode: () => void;
}) {
  const seg = lane.segments.find((s) => s.block_id === block.id && s.date === selection.date);
  const hand = block.fill_kind === "playlist" || block.fill_kind === "template" || block.fill_kind === "manual";
  const [ro, setRo] = useState<RunningOrderView | null>(null);
  useEffect(() => {
    setRo(null);
    if (!hand) return;
    let gone = false;
    contentApi
      .runningOrder(block.id, selection.date)
      .then((r) => !gone && setRo(r))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [block.id, block.updated_at_ms, selection.date, hand, lane.draft]);
  const list = block.list_id ? board.lists?.find((l) => l.id === block.list_id) : undefined;
  const lenMin = lengthMin(block);
  const programme = block.fill_kind === "programme" ? board.programmes.find((p) => p.id === block.programme_id) : null;
  const issues = lane.draft.issues.filter((i) => (i.block_id === block.id || i.other_block_id === block.id) && (!i.date || i.code === "conflict" || i.date === selection.date));
  const fill =
    block.fill_kind === "programme"
      ? `Programme · ${programme?.title ?? "(not published)"}`
      : block.fill_kind === "playlist"
        ? `Playlist · ${list?.name ?? "(none chosen)"}${block.when_short === "loop" ? " (loops)" : ""}`
        : block.fill_kind === "template"
          ? `Template · ${list?.name ?? "(none chosen)"}${ro ? (ro.running_order ? " · episode ready" : " · no episode yet") : ""}`
          : block.fill_kind === "manual"
            ? `Manual running order${ro ? (ro.running_order ? ` · ${ro.items.length} item${ro.items.length === 1 ? "" : "s"}` : " · none yet") : ""}`
            : `Auto-fill · ${block.tags_any.length ? `tags: ${block.tags_any.join(", ")}` : `${lane.name}'s own songs`}`;
  let duration: { tone: "green" | "amber" | "red"; text: string; pct: number };
  if (programme?.duration_seconds) {
    const progMin = programme.duration_seconds / 60;
    duration =
      progMin < lenMin - 0.5
        ? { tone: "green", pct: 100, text: `The programme (${Math.round(progMin)} min) loops to fill the ${lenMin} minutes.` }
        : progMin > lenMin + 0.5
          ? { tone: "amber", pct: 100, text: `The programme runs ${Math.round(progMin - lenMin)} min longer than the block: its end is faded to keep the next start on time.` }
          : { tone: "green", pct: 100, text: "Fits exactly." };
  } else if (hand && ro) {
    const over = ro.est_ms - ro.length_ms;
    const filler = block.fill_kind === "manual" ? "the safety net fills it" : "the block's songs fill it";
    duration =
      over > 20_000
        ? { tone: "red", pct: 100, text: `${clockText(over)} over: ${ro.over_ms && ro.about ? "rule-picked songs are dropped to fit" : "the end is faded to keep the next start on time"}.` }
        : over < -20_000
          ? { tone: "amber", pct: Math.max(4, (ro.est_ms / ro.length_ms) * 100), text: `${clockText(-over)} unfilled: ${filler}.` }
          : { tone: "green", pct: 100, text: "Fits exactly." };
  } else if (hand) duration = { tone: "green", pct: 0, text: "Measuring…" };
  else duration = { tone: "green", pct: 100, text: "Fits exactly. The generator fills this block by its rules." };

  return (
    <aside className="sch-card sch-tl-panel" aria-labelledby="sch-tl-panel-h">
      <header>
        <p className="sch-eyebrow">Selected block · {lane.name}</p>
        <button type="button" className="sch-icon-btn" onClick={onClose} aria-label="Close the panel">
          ×
        </button>
      </header>
      <h2 id="sch-tl-panel-h" className="sch-h3">
        {block.name}
      </h2>
      <p className="sch-dim">{block.description}</p>
      <dl className="sch-tl-rows">
        <dt>Time</dt>
        <dd>
          {seg ? `${shortDate(seg.date)} ${hm(seg.start_ms)}–${hm(seg.end_ms)}` : `${mm(block.start_min)}–${mm(block.end_min)}`}
          {seg?.resumed && <span className="sch-dim"> (resumes after a one-off, laid out from {hm(seg.origin_ms)})</span>}
          {seg?.cut && <span className="sch-dim"> (a one-off cuts in at {hm(seg.end_ms)})</span>}
        </dd>
        <dt>Repeats</dt>
        <dd>{repeatsText(block)}</dd>
        <dt>Layer</dt>
        <dd>{layerName(block.layer ?? 1)}</dd>
        <dt>Mode</dt>
        <dd>{block.mode === "manual" ? "Manual" : "Auto"}</dd>
        <dt>Filled from</dt>
        <dd>{fill}</dd>
        <dt>Start</dt>
        <dd>{block.start_mode === "flexible" ? "Flexible" : `📌 Hard${block.priority === "high" ? " (High priority)" : ""}`}</dd>
        <dt>End</dt>
        <dd>{block.end_mode === "flexible" ? "Flexible: the last song plays out" : "Hard"}</dd>
        <dt>Priority</dt>
        <dd>{block.priority === "high" ? "High" : "Normal"}</dd>
        <dt>Schedule page</dt>
        <dd>{block.public !== 0 ? "Shown to listeners" : "Hidden (shows as the channel default)"}</dd>
      </dl>
      <div className={`sch-tl-dur is-${duration.tone}`}>
        <span>
          <i style={{ width: `${duration.pct}%` }} />
        </span>
        <p>{duration.text}</p>
      </div>
      {issues.length > 0 && (
        <ul className="sch-tl-issues">
          {issues.map((i, n) => (
            <li key={n} className={`is-${i.level}`}>
              <span>{i.text}</span>
              {i.code === "conflict" && i.block_id && i.other_block_id && editable && (
                <button type="button" className="sch-btn sch-btn-sm" onClick={() => onResolve({ block_id: i.block_id!, other_block_id: i.other_block_id!, date: i.date ?? selection.date })}>
                  Resolve
                </button>
              )}
              {i.fixes.includes("edit") && i.block_id && editable && (
                <button type="button" className="sch-btn sch-btn-sm" onClick={() => onFix(i.block_id!, true)}>
                  Edit block
                </button>
              )}
              {(i.fixes.includes("open_ro") || i.fixes.includes("create_ro") || i.fixes.includes("auto_fill") || i.fixes.includes("trim")) && (
                <button type="button" className="sch-btn sch-btn-sm" onClick={() => onOpenRunningOrder(i.date ?? selection.date)}>
                  {i.fixes.includes("create_ro") ? (block.fill_kind === "template" ? "Create episode" : "Build it") : "Open running order"}
                </button>
              )}
              {i.fixes.includes("edit_list") && (
                <a className="sch-btn sch-btn-sm" href={`/studio/scheduler/lists?open=${block.list_id ?? ""}`}>
                  Edit {list?.kind ?? "list"}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {hand && (
        <div className="sch-tl-panel-actions">
          <button type="button" className={`sch-btn${editable ? "" : " sch-btn-red"}`} onClick={() => onOpenRunningOrder(selection.date)}>
            {block.fill_kind === "playlist" ? "Open playlist items" : block.fill_kind === "template" && ro && !ro.running_order ? "Open (no episode yet)" : "Open running order"}
          </button>
          {block.fill_kind === "template" && editable && (
            <button type="button" className="sch-btn" onClick={onNextEpisode}>
              Create next episode
            </button>
          )}
        </div>
      )}
      {editable ? (
        <div className="sch-tl-panel-actions">
          <button type="button" className="sch-btn sch-btn-red" onClick={onEdit}>
            Edit
          </button>
          <button type="button" className="sch-btn" onClick={onDuplicate}>
            Duplicate
          </button>
          <button type="button" className="sch-btn" onClick={onDelete}>
            Delete
          </button>
        </div>
      ) : (
        <p className="sch-dim">Switch to Draft to change it.</p>
      )}
    </aside>
  );
}

// ------------------------------------------------------------------ dialogs

function DeleteAsk({ block, date, onClose, onDone, onError }: { block: PlanBlock; date: string; onClose: () => void; onDone: (m: string, r: any) => void; onError: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const go = async (scope?: "occurrence") => {
    setBusy(true);
    try {
      const r = await planApi.remove(block.id, scope, date);
      onDone(scope ? `${block.name} skips ${shortDate(date)} (in the draft)` : `Deleted ${block.name} from the draft`, r);
    } catch (e) {
      onError(e);
      setBusy(false);
    }
  };
  return (
    <Modal
      title={`Delete ${block.name}?`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sch-btn" onClick={onClose}>
            Cancel
          </button>
          {isRepeating(block) && (
            <button type="button" className="sch-btn" disabled={busy} onClick={() => void go("occurrence")}>
              Just {shortDate(date)}
            </button>
          )}
          <button type="button" className="sch-btn sch-btn-red" disabled={busy} onClick={() => void go()}>
            {isRepeating(block) ? "Every time" : "Delete"}
          </button>
        </>
      }
    >
      <p>Its time goes back to the channel default. This is a draft change: nothing changes on air until you publish.</p>
    </Modal>
  );
}

function DiscardAsk({ drafts, initial, onClose, onDone, onError }: { drafts: ChannelDraft[]; initial: string; onClose: () => void; onDone: (m: string, r: any) => void; onError: (e: unknown) => void }) {
  const [slug, setSlug] = useState(drafts.some((d) => d.slug === initial) ? initial : drafts[0]?.slug);
  const d = drafts.find((x) => x.slug === slug);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Discard draft changes?"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sch-btn" onClick={onClose}>
            Keep them
          </button>
          <button
            type="button"
            className="sch-btn sch-btn-red"
            disabled={busy || !d}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await planApi.discard(slug!);
                onDone(r.message, r);
              } catch (e) {
                onError(e);
                setBusy(false);
              }
            }}
          >
            Discard {d?.changes.length ?? 0} change{d?.changes.length === 1 ? "" : "s"}
          </button>
        </>
      }
    >
      {drafts.length > 1 && (
        <label className="sch-field">
          <span className="sch-label">Channel</span>
          <select className="sch-input" value={slug} onChange={(e) => setSlug(e.target.value)}>
            {drafts.map((x) => (
              <option key={x.slug} value={x.slug}>
                {x.name} ({x.changes.length})
              </option>
            ))}
          </select>
        </label>
      )}
      <p>{d?.name}'s draft goes back to the live plan (Plan {d?.live_plan}). These changes are lost:</p>
      <ul className="sch-plain sch-tl-changes">{d?.changes.map((c, i) => <li key={i}>{c.text}</li>)}</ul>
    </Modal>
  );
}

function PublishDialog({ drafts, onClose, onDone }: { drafts: ChannelDraft[]; onClose: () => void; onDone: (r: { results: Record<string, PublishOutcome>; drafts: Record<string, ChannelDraft> }) => void }) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(drafts.filter((d) => d.can_publish).map((d) => d.slug)));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, PublishOutcome> | null>(null);
  const publish = async () => {
    setBusy(true);
    try {
      const chosen = drafts.filter((d) => ticked.has(d.slug));
      const r = await planApi.publish(
        chosen.map((d) => d.slug),
        Object.fromEntries(chosen.map((d) => [d.slug, d.live_plan]))
      );
      setResults(r.results);
      onDone(r);
    } catch (e) {
      setResults({ _: { ok: false, status: 0, error: "failed", message: friendly(e) } });
    }
    setBusy(false);
  };
  if (results) {
    return (
      <Modal title="Publish results" onClose={onClose} footer={<button type="button" className="sch-btn sch-btn-red" onClick={onClose}>Done</button>}>
        <ul className="sch-tl-results">
          {Object.entries(results).map(([slug, r]) => (
            <li key={slug} className={r.ok ? "is-ok" : "is-bad"}>
              <strong>{drafts.find((d) => d.slug === slug)?.name ?? "Publish"}</strong>
              <span>{r.message}</span>
            </li>
          ))}
        </ul>
      </Modal>
    );
  }
  return (
    <Modal
      title="Publish the draft"
      wide
      onClose={onClose}
      footer={
        <>
          <span className="sch-dim">Each channel is published on its own, checked, and can be rolled back.</span>
          <span className="sch-spacer" />
          <button type="button" className="sch-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="sch-btn sch-btn-red" disabled={busy || ticked.size === 0} onClick={() => void publish()}>
            {busy ? "Publishing…" : `Publish ${ticked.size} channel${ticked.size === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      {drafts.length === 0 && <p>There are no draft changes.</p>}
      <ul className="sch-tl-pub">
        {drafts.map((d) => (
          <li key={d.slug} className={d.can_publish ? "" : "is-blocked"}>
            <label className="sch-check">
              <input
                type="checkbox"
                disabled={!d.can_publish}
                checked={ticked.has(d.slug)}
                onChange={(e) =>
                  setTicked((t) => {
                    const n = new Set(t);
                    if (e.target.checked) n.add(d.slug);
                    else n.delete(d.slug);
                    return n;
                  })
                }
              />
              <strong>{d.name}</strong>
              <span className="sch-dim">
                Plan {d.live_plan} → {(d.live_plan ?? 0) + 1}
                {d.first_change_ms ? ` · goes live ${when(d.first_change_ms)}` : " · nothing on air changes"}
              </span>
            </label>
            <ul className="sch-plain sch-tl-changes">
              {d.changes.map((c, i) => (
                <li key={i}>{c.text}</li>
              ))}
            </ul>
            {d.issues.length > 0 && (
              <ul className="sch-tl-issues">
                {d.issues.map((i, n) => (
                  <li key={n} className={`is-${i.level}`}>
                    {i.text}
                  </li>
                ))}
              </ul>
            )}
            {d.why_not && <p className="sch-error">Can't publish: {d.why_not}.</p>}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function PreviewDialog({ drafts, initial, date: initialDate, onClose }: { drafts: ChannelDraft[]; initial: string; date: string; onClose: () => void }) {
  const [slug, setSlug] = useState(initial);
  const [date, setDate] = useState(initialDate);
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    planApi.preview(slug, date).then(setData).catch((e) => setErr(friendly(e)));
  }, [slug, date]);
  const liveKeys = new Set<string>((data?.live ?? []).map((i: any) => `${i.key}@${i.starts_at_ms}`));
  const draftKeys = new Set<string>((data?.draft ?? []).map((i: any) => `${i.key}@${i.starts_at_ms}`));
  const row = (i: any, other: Set<string>) => (
    <li key={`${i.key}${i.starts_at_ms}`} className={other.has(`${i.key}@${i.starts_at_ms}`) ? "" : "is-changed"}>
      <time>{hm(i.starts_at_ms)}</time> <span>{i.label ?? i.type}</span>
      {i.block && <small>{i.block}</small>}
    </li>
  );
  return (
    <Modal title="Preview: live against draft" wide onClose={onClose} footer={<button type="button" className="sch-btn" onClick={onClose}>Close</button>}>
      <div className="sch-form-row">
        <label className="sch-field">
          <span className="sch-label">Channel</span>
          <select className="sch-input" value={slug} onChange={(e) => setSlug(e.target.value)}>
            {drafts.map((d) => (
              <option key={d.slug} value={d.slug}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="sch-field">
          <span className="sch-label">Day</span>
          <input type="date" className="sch-input" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      {err && <p className="sch-error">{err}</p>}
      {!data ? (
        <p className="sch-dim">Building the preview…</p>
      ) : data.past ? (
        <p className="sch-dim">That day is over.</p>
      ) : (
        <>
          {data.issues?.length > 0 && (
            <ul className="sch-tl-issues">
              {data.issues.map((i: PlanIssue, n: number) => (
                <li key={n} className={`is-${i.level}`}>
                  {i.text}
                </li>
              ))}
            </ul>
          )}
          <div className="sch-tl-compare">
            <section>
              <h3 className="sch-eyebrow">Live now</h3>
              {data.live.length ? <ol>{data.live.map((i: any) => row(i, draftKeys))}</ol> : <p className="sch-dim">The live log doesn't reach this day yet (it runs 48 hours ahead).</p>}
            </section>
            <section>
              <h3 className="sch-eyebrow">With the draft</h3>
              <ol>{data.draft.map((i: any) => row(i, liveKeys))}</ol>
            </section>
          </div>
          <p className="sch-dim">Highlighted rows differ. The draft's songs are a fresh pick, so a few may differ even where the plan doesn't.</p>
        </>
      )}
    </Modal>
  );
}

function PlanHistory({ slug: initial, channels, onClose, onRolledBack, onError }: { slug: string; channels: ChannelDraft[]; onClose: () => void; onRolledBack: (m: string, r: any) => void; onError: (e: unknown) => void }) {
  const [slug, setSlug] = useState(initial);
  const [data, setData] = useState<{ plans: any[]; draft_changes: number } | null>(null);
  const [open, setOpen] = useState<{ number: number; detail: any | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setData(null);
    planApi.plans(slug).then(setData).catch(onError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);
  const live = data?.plans[0]?.number ?? null;
  const roll = async (number: number) => {
    setBusy(true);
    try {
      const r = await planApi.rollback(slug, number, live);
      if (r.result.ok) onRolledBack(r.result.message, r);
      else onError(new Error(r.result.message));
    } catch (e) {
      onError(e);
    }
    setBusy(false);
  };
  return (
    <Modal title="Version history: plans" wide onClose={onClose} footer={<button type="button" className="sch-btn" onClick={onClose}>Close</button>}>
      <label className="sch-field">
        <span className="sch-label">Channel</span>
        <select className="sch-input" value={slug} onChange={(e) => setSlug(e.target.value)}>
          {channels.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <p className="sch-dim">
        Every publish is a numbered plan. Rolling back publishes a copy of an older plan as a new number, from the end of the song on air. Live controls (skip, insert, Back on schedule) are undone from Master Control's log history.
      </p>
      {!data ? (
        <p className="sch-dim">Loading…</p>
      ) : (
        <ol className="sch-tl-plans">
          {data.plans.map((p) => (
            <li key={p.number} className={p.number === live ? "is-live" : ""}>
              <div className="sch-tl-plan-head">
                <strong>Plan {p.number}</strong>
                {p.number === live && <span className="sch-tag is-green">LIVE</span>}
                <span className="sch-dim">
                  {when(p.created_at_ms)} · {p.actor === "system" ? "System" : "You"}
                  {p.version ? ` · log v${p.version}` : ""}
                  {p.rollback_of ? ` · rollback of Plan ${p.rollback_of}` : ""}
                  {p.effective_from_ms ? ` · live from ${when(p.effective_from_ms)}` : ""}
                </span>
              </div>
              <p>{p.summary}</p>
              {p.number !== live && (
                <div className="sch-tl-plan-actions">
                  <button
                    type="button"
                    className="sch-btn sch-btn-sm"
                    onClick={() => {
                      setOpen({ number: p.number, detail: null });
                      planApi.plan(slug, p.number).then((d) => setOpen({ number: p.number, detail: d })).catch(onError);
                    }}
                  >
                    Preview
                  </button>
                  <button type="button" className="sch-btn sch-btn-sm" onClick={() => {
                      if (open && open.number === p.number) return;
                      setOpen({ number: p.number, detail: null });
                      planApi.plan(slug, p.number).then((d) => setOpen({ number: p.number, detail: d })).catch(onError);
                    }}>
                    Roll back to this plan
                  </button>
                </div>
              )}
              {open && open.number === p.number && (
                <div className="sch-tl-plan-open">
                  {open.detail ? (
                    <>
                      <p className="sch-label">Rolling back to Plan {p.number} would:</p>
                      <ul className="sch-plain sch-tl-changes">
                        {open.detail.compared_to_live.length ? open.detail.compared_to_live.map((c: { text: string }, i: number) => <li key={i}>{c.text}</li>) : <li>Change nothing (same blocks as live)</li>}
                      </ul>
                    </>
                  ) : (
                    <p className="sch-dim">Comparing…</p>
                  )}
                  {data.draft_changes > 0 && (
                    <p className="sch-warn">
                      Rolling back discards your {data.draft_changes} draft change{data.draft_changes === 1 ? "" : "s"} to {channels.find((c) => c.slug === slug)?.name}.
                    </p>
                  )}
                  <button type="button" className="sch-btn sch-btn-red sch-btn-sm" disabled={busy} onClick={() => void roll(p.number)}>
                    Roll back to Plan {p.number}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}

function ResolveDialog({
  lane,
  issue,
  onClose,
  onEdit,
  onDone,
  onError,
}: {
  lane: BoardLane;
  issue: { block_id: string; other_block_id: string; date: string; start_ms?: number; end_ms?: number };
  onClose: () => void;
  onEdit: (b: PlanBlock) => void;
  onDone: (m: string, r: any) => void;
  onError: (e: unknown) => void;
}) {
  const a = lane.blocks.find((b) => b.id === issue.block_id);
  const b = lane.blocks.find((x) => x.id === issue.other_block_id);
  const [chosen, setChosen] = useState<"a" | "b">("b");
  const [busy, setBusy] = useState(false);
  if (!a || !b) return null;
  const pick = chosen === "a" ? a : b;
  const other = chosen === "a" ? b : a;
  const run = async (fn: () => Promise<any>, msg: string) => {
    setBusy(true);
    try {
      onDone(msg, await fn());
    } catch (e) {
      onError(e);
      setBusy(false);
    }
  };
  const base = (blk: PlanBlock) => bodyFor(draftFromBlock(blk, lane.slug));
  // Shorten: end where the other starts, or start where it ends - whichever keeps more of it.
  const shorten = () => {
    const keepBefore = other.start_min > pick.start_min ? other.start_min - pick.start_min : 0;
    const keepAfter = pick.end_min > other.end_min ? pick.end_min - other.end_min : 0;
    const changes = keepBefore >= keepAfter ? { end_min: other.start_min } : { start_min: other.end_min };
    return run(() => planApi.update(pick.id, { ...base(pick), ...changes, scope: "all" }), `Shortened ${pick.name}`);
  };
  const bothRepeat = isRepeating(a) && isRepeating(b);
  return (
    <Modal title="Resolve a conflict" onClose={onClose} footer={<button type="button" className="sch-btn" onClick={onClose}>Close</button>}>
      <p>
        <strong>{a.name}</strong> ({mm(a.start_min)}–{mm(a.end_min)}) and <strong>{b.name}</strong> ({mm(b.start_min)}–{mm(b.end_min)}) overlap on {shortDate(issue.date)}
        {bothRepeat ? " (and every time they both air)" : ""}. Publishing waits until they don't.
      </p>
      <fieldset className="sch-field">
        <legend className="sch-label">Change which one?</legend>
        <div className="sch-seg" role="radiogroup">
          <button type="button" role="radio" aria-checked={chosen === "a"} className={chosen === "a" ? "is-on" : ""} onClick={() => setChosen("a")}>
            {a.name}
          </button>
          <button type="button" role="radio" aria-checked={chosen === "b"} className={chosen === "b" ? "is-on" : ""} onClick={() => setChosen("b")}>
            {b.name}
          </button>
        </div>
      </fieldset>
      <ul className="sch-tl-fixes">
        <li>
          <button type="button" className="sch-btn" disabled={busy} onClick={() => onEdit({ ...pick, start_min: other.end_min % 1440, end_min: (other.end_min + lengthMin(pick)) % 1440 || 1440 })}>
            Move {pick.name}
          </button>
          <span className="sch-dim">Opens the editor, suggesting {mm(other.end_min)}, right after {other.name}.</span>
        </li>
        <li>
          <button type="button" className="sch-btn" disabled={busy} onClick={() => void shorten()}>
            Shorten {pick.name}
          </button>
          <span className="sch-dim">Trims it to stop where {other.name} starts (or start where it ends).</span>
        </li>
        <li>
          <button type="button" className="sch-btn" disabled={busy} onClick={() => void run(() => planApi.update(pick.id, { ...base(pick), active: false, scope: "all" }), `Turned off ${pick.name}`)}>
            Replace: turn {pick.name} off
          </button>
          {isRepeating(pick) && (
            <button type="button" className="sch-btn" disabled={busy} onClick={() => void run(() => planApi.exception(pick.id, issue.date), `${pick.name} skips ${shortDate(issue.date)}`)}>
              Just on {shortDate(issue.date)}
            </button>
          )}
          <span className="sch-dim">{other.name} plays in its place.</span>
        </li>
        {bothRepeat && (
          <li>
            <button type="button" className="sch-btn" disabled={busy} onClick={() => void run(() => planApi.exception(pick.id, issue.date), `${pick.name} skips ${shortDate(issue.date)}; ${other.name} wins that day`)}>
              Make {shortDate(issue.date)} an exception
            </button>
            <span className="sch-dim">{pick.name} skips that date, so {other.name} wins it. Other weeks stay as they are.</span>
          </li>
        )}
      </ul>
    </Modal>
  );
}

function CopyDayDialog({ slug, from, onClose, onDone, onError }: { slug: string; from: number; onClose: () => void; onDone: (m: string, r: any) => void; onError: (e: unknown) => void }) {
  const KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const [to, setTo] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={`Copy ${DAY_LONG[from]} to…`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sch-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sch-btn sch-btn-red"
            disabled={busy || to.size === 0}
            onClick={async () => {
              setBusy(true);
              try {
                onDone(
                  `Copied ${DAY_LONG[from]} to ${[...to].map((i) => DAY_SHORT[i]).join(", ")} (in the draft)`,
                  await planApi.copyDay(slug, KEYS[from], [...to].map((i) => KEYS[i]))
                );
              } catch (e) {
                onError(e);
                setBusy(false);
              }
            }}
          >
            Copy
          </button>
        </>
      }
    >
      <div className="sch-chips">
        {DAY_SHORT.map((d, i) =>
          i === from ? null : (
            <button
              key={d}
              type="button"
              className={`sch-chip${to.has(i) ? " is-on" : ""}`}
              aria-pressed={to.has(i)}
              onClick={() =>
                setTo((t) => {
                  const n = new Set(t);
                  if (n.has(i)) n.delete(i);
                  else n.add(i);
                  return n;
                })
              }
            >
              {d}
            </button>
          )
        )}
        <span className="sch-chip-sep" />
        <button type="button" className="sch-chip" onClick={() => setTo(new Set([0, 1, 2, 3, 4].filter((i) => i !== from)))}>
          Weekdays
        </button>
      </div>
      <p>The chosen days get exactly {DAY_LONG[from]}'s weekly blocks; what they have now is replaced. One-offs and monthly blocks stay put.</p>
    </Modal>
  );
}
