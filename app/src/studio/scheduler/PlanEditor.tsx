import { useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { friendly, planApi, type Board, type BlockColour, type PlanBlock } from "./api";
import { Modal } from "./common";

/**
 * The Timeline's block editor (Release 2): when it airs (one-off, weekly,
 * monthly, a season, skipped dates), how it behaves (hard or flexible start
 * and end, priority), what fills it, and whether listeners see it on the
 * public schedule. Saves go to the draft only.
 */

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const COLOURS: { c: BlockColour; label: string }[] = [
  { c: "blue", label: "Music (blue)" },
  { c: "purple", label: "Show (purple)" },
  { c: "gold", label: "Gold" },
  { c: "green", label: "Green" },
  { c: "red", label: "Red" },
  { c: "grey", label: "Grey" },
];
export const mm = (min: number) => (min === 1440 ? "24:00" : `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`);
export const lengthMin = (b: { start_min: number; end_min: number }) => (b.end_min <= b.start_min ? 1440 - b.start_min + b.end_min : b.end_min - b.start_min);

export interface EditorDraft {
  id?: string;
  channel: string;
  name: string;
  description: string;
  colour: BlockColour;
  recurrence: "once" | "weekly" | "monthly";
  days_mask: number;
  once_date: string;
  monthly: { kind: "day"; day: number } | { kind: "nth"; nth: number; weekday: number };
  season: boolean;
  date_from: string;
  date_to: string;
  start_min: number;
  end_min: number;
  start_mode: "hard" | "flexible";
  end_mode: "hard" | "flexible";
  priority: "high" | "normal";
  fill_kind: PlanBlock["fill_kind"];
  programme_id: string | null;
  list_id: string | null;
  when_short: "fill" | "loop";
  tags_any: string[];
  public: boolean;
  active: boolean;
  exceptions: string[];
  /** Editing one airing of a repeating block: "just this one" or "every". */
  scope?: { date: string; label: string };
}

export function draftFromBlock(b: PlanBlock, channel: string): EditorDraft {
  let monthly: EditorDraft["monthly"] = { kind: "day", day: 1 };
  try {
    const r = JSON.parse(b.monthly_rule ?? "null");
    if (r && typeof r.day === "number") monthly = { kind: "day", day: r.day };
    else if (r && typeof r.nth === "number") monthly = { kind: "nth", nth: r.nth, weekday: r.weekday };
  } catch {
    /* default */
  }
  return {
    id: b.id,
    channel,
    name: b.name,
    description: b.description,
    colour: b.colour,
    recurrence: b.recurrence ?? "weekly",
    days_mask: b.days_mask ?? 0,
    once_date: b.once_date ?? "",
    monthly,
    season: !!(b.date_from || b.date_to),
    date_from: b.date_from ?? "",
    date_to: b.date_to ?? "",
    start_min: b.start_min,
    end_min: b.end_min,
    start_mode: b.start_mode ?? "hard",
    end_mode: b.end_mode ?? "hard",
    priority: b.priority ?? "normal",
    fill_kind: b.fill_kind ?? "autopilot",
    programme_id: b.programme_id,
    list_id: b.list_id ?? null,
    when_short: b.when_short ?? "fill",
    tags_any: b.tags_any ?? [],
    public: b.public !== 0,
    active: !!b.active,
    exceptions: b.exceptions ?? [],
  };
}

export function newDraft(channel: string, date: string, start: number, end: number, weekday: number): EditorDraft {
  return {
    channel,
    name: "",
    description: "",
    colour: "blue",
    recurrence: "weekly",
    days_mask: 1 << weekday,
    once_date: date,
    monthly: { kind: "day", day: Number(date.slice(8, 10)) || 1 },
    season: false,
    date_from: "",
    date_to: "",
    start_min: start,
    end_min: end,
    start_mode: "hard",
    end_mode: "hard",
    priority: "normal",
    fill_kind: "autopilot",
    programme_id: null,
    list_id: null,
    when_short: "fill",
    tags_any: [],
    public: true,
    active: true,
    exceptions: [],
  };
}

export function bodyFor(d: EditorDraft): Record<string, unknown> {
  return {
    channel: d.channel,
    name: d.name,
    description: d.description,
    colour: d.colour,
    recurrence: d.recurrence,
    days_mask: d.recurrence === "weekly" ? d.days_mask : null,
    once_date: d.recurrence === "once" ? d.once_date : null,
    monthly_rule: d.recurrence === "monthly" ? (d.monthly.kind === "day" ? { day: d.monthly.day } : { nth: d.monthly.nth, weekday: d.monthly.weekday }) : null,
    date_from: d.recurrence !== "once" && d.season ? d.date_from || null : null,
    date_to: d.recurrence !== "once" && d.season ? d.date_to || null : null,
    start_min: d.start_min,
    end_min: d.end_min,
    start_mode: d.start_mode,
    end_mode: d.end_mode,
    priority: d.priority,
    fill_kind: d.fill_kind,
    programme_id: d.fill_kind === "programme" ? d.programme_id : null,
    list_id: d.fill_kind === "playlist" || d.fill_kind === "template" ? d.list_id : null,
    when_short: d.when_short,
    tags_any: d.tags_any,
    public: d.public,
    active: d.active,
    exceptions: d.recurrence === "once" ? [] : d.exceptions,
  };
}

const FILLS: [EditorDraft["fill_kind"], string][] = [
  ["autopilot", "Songs by tag (autopilot)"],
  ["programme", "A programme"],
  ["playlist", "A playlist"],
  ["template", "A template (a show with a set shape)"],
  ["manual", "Built by hand (manual)"],
];

const NTH = [
  { v: 1, l: "First" },
  { v: 2, l: "Second" },
  { v: 3, l: "Third" },
  { v: 4, l: "Fourth" },
  { v: -1, l: "Last" },
];
const shortDate = (d: string) =>
  new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

export function PlanEditor({
  board,
  draft,
  onClose,
  onSaved,
}: {
  board: Board;
  draft: EditorDraft;
  onClose: () => void;
  onSaved: (message: string, block?: PlanBlock) => void;
}) {
  const [d, setD] = useState<EditorDraft>(draft);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pool, setPool] = useState<{ tracks: number; seconds: number } | null>(null);
  const [scope, setScope] = useState<"all" | "occurrence">(draft.scope ? "occurrence" : "all");
  const [newException, setNewException] = useState("");
  const set = <K extends keyof EditorDraft>(k: K, v: EditorDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (d.fill_kind === "programme" || d.fill_kind === "manual") return;
    const id = window.setTimeout(() => planApi.pool(d.tags_any, d.channel).then(setPool).catch(() => setPool(null)), 250);
    return () => window.clearTimeout(id);
  }, [d.tags_any, d.fill_kind, d.channel]);

  const times = Array.from({ length: 288 }, (_, i) => i * 5);
  const lane = board.channels.find((c) => c.slug === d.channel);
  const programmes = board.programmes;
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = bodyFor(d);
      const res = d.id
        ? await planApi.update(d.id, { ...body, ...(d.scope && scope === "occurrence" ? { scope: "occurrence", date: d.scope.date } : { scope: "all" }) })
        : await planApi.create(body);
      onSaved(d.id ? (d.scope && scope === "occurrence" ? `Changed ${d.name} for ${d.scope.label} only (in the draft)` : `Saved ${d.name} to the draft`) : `Added ${d.name} to the draft`, res.block);
    } catch (err) {
      setError({ field: err instanceof ApiError ? err.field : undefined, message: friendly(err) });
      setBusy(false);
    }
  };
  const fieldError = (f: string) => (error?.field === f ? <p className="sch-error" role="alert">{error.message}</p> : null);
  const len = lengthMin(d);
  const hours = pool ? pool.seconds / 3600 : 0;
  const editingOne = !!d.scope && scope === "occurrence";

  return (
    <Modal
      title={d.id ? `Edit ${draft.name}` : "New block"}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="sch-dim sch-tl-foot-note">Saved to the draft. Nothing changes on air until you publish.</span>
          <span className="sch-spacer" />
          <button type="button" className="sch-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="sch-btn sch-btn-red" onClick={() => void save()} disabled={busy}>
            Save to draft
          </button>
        </>
      }
    >
      <div className="sch-form">
        {d.scope && (
          <fieldset className="sch-field sch-tl-scope">
            <legend className="sch-label">Change</legend>
            <div className="sch-seg" role="radiogroup">
              <button type="button" role="radio" aria-checked={scope === "occurrence"} className={scope === "occurrence" ? "is-on" : ""} onClick={() => setScope("occurrence")}>
                Just {d.scope.label}
              </button>
              <button type="button" role="radio" aria-checked={scope === "all"} className={scope === "all" ? "is-on" : ""} onClick={() => setScope("all")}>
                Every time it airs
              </button>
            </div>
            {editingOne && <span className="sch-dim">The regular block skips {d.scope.label}, and a one-off with these settings airs on top that day.</span>}
          </fieldset>
        )}

        <div className="sch-form-row">
          <label className="sch-field">
            <span className="sch-label">Name</span>
            <input className="sch-input" value={d.name} maxLength={60} onChange={(e) => set("name", e.target.value)} placeholder="Friday Game Changers" autoFocus aria-invalid={error?.field === "name" || undefined} />
            {fieldError("name")}
          </label>
          {!d.id && (
            <label className="sch-field">
              <span className="sch-label">Channel</span>
              <select className="sch-input" value={d.channel} onChange={(e) => set("channel", e.target.value)}>
                {board.channels.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                    {c.status !== "live" ? " (not live)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        <label className="sch-field">
          <span className="sch-label">Description: the sound of this block in one line (listeners see it on the schedule)</span>
          <input className="sch-input" value={d.description} maxLength={140} onChange={(e) => set("description", e.target.value)} placeholder="Interviews with the people changing the game" aria-invalid={error?.field === "description" || undefined} />
          {fieldError("description")}
        </label>

        {!editingOne && (
          <fieldset className="sch-field">
            <legend className="sch-label">Repeats</legend>
            <div className="sch-seg" role="radiogroup" aria-label="Repeats">
              {(
                [
                  ["once", "Once"],
                  ["weekly", "Weekly"],
                  ["monthly", "Monthly"],
                ] as const
              ).map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={d.recurrence === v} className={d.recurrence === v ? "is-on" : ""} onClick={() => set("recurrence", v)}>
                  {l}
                </button>
              ))}
            </div>
            {d.recurrence === "once" && (
              <label className="sch-field sch-tl-inline">
                <span className="sch-label">Date</span>
                <input type="date" className="sch-input" value={d.once_date} onChange={(e) => set("once_date", e.target.value)} aria-invalid={error?.field === "once_date" || undefined} />
                {fieldError("once_date")}
              </label>
            )}
            {d.recurrence === "weekly" && (
              <div className="sch-chips">
                {DAY_SHORT.map((day, i) => (
                  <button key={day} type="button" className={`sch-chip${d.days_mask & (1 << i) ? " is-on" : ""}`} aria-pressed={!!(d.days_mask & (1 << i))} onClick={() => set("days_mask", d.days_mask ^ (1 << i))}>
                    {day}
                  </button>
                ))}
                <span className="sch-chip-sep" />
                <button type="button" className="sch-chip" onClick={() => set("days_mask", 0b0011111)}>
                  Weekdays
                </button>
                <button type="button" className="sch-chip" onClick={() => set("days_mask", 0b1100000)}>
                  Weekends
                </button>
                <button type="button" className="sch-chip" onClick={() => set("days_mask", 0b1111111)}>
                  Every day
                </button>
                {fieldError("days_mask")}
              </div>
            )}
            {d.recurrence === "monthly" && (
              <div className="sch-form-row">
                <label className="sch-field">
                  <span className="sch-label">On</span>
                  <select
                    className="sch-input"
                    value={d.monthly.kind === "day" ? `day:${d.monthly.day}` : `nth:${d.monthly.nth}`}
                    onChange={(e) => {
                      const [k, v] = e.target.value.split(":");
                      set("monthly", k === "day" ? { kind: "day", day: Number(v) } : { kind: "nth", nth: Number(v), weekday: d.monthly.kind === "nth" ? d.monthly.weekday : 5 });
                    }}
                  >
                    <optgroup label="A day of the month">
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={`day:${n}`}>
                          The {n}
                          {n === 1 || n === 21 || n === 31 ? "st" : n === 2 || n === 22 ? "nd" : n === 3 || n === 23 ? "rd" : "th"}
                          {n > 28 ? " (or the last day)" : ""}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="A weekday of the month">
                      {NTH.map((x) => (
                        <option key={x.v} value={`nth:${x.v}`}>
                          {x.l}…
                        </option>
                      ))}
                    </optgroup>
                  </select>
                </label>
                {d.monthly.kind === "nth" && (
                  <label className="sch-field">
                    <span className="sch-label">Weekday</span>
                    <select className="sch-input" value={d.monthly.weekday} onChange={(e) => set("monthly", { kind: "nth", nth: (d.monthly as { nth: number }).nth, weekday: Number(e.target.value) })}>
                      {DAY_LONG.map((day, i) => (
                        <option key={day} value={i}>
                          {day}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {fieldError("monthly_rule")}
              </div>
            )}
            {d.recurrence !== "once" && (
              <>
                <label className="sch-check">
                  <input type="checkbox" checked={d.season} onChange={(e) => set("season", e.target.checked)} /> Only in a season (for example 1–24 December)
                </label>
                {d.season && (
                  <div className="sch-form-row">
                    <label className="sch-field">
                      <span className="sch-label">From</span>
                      <input type="date" className="sch-input" value={d.date_from} onChange={(e) => set("date_from", e.target.value)} />
                      {fieldError("date_from")}
                    </label>
                    <label className="sch-field">
                      <span className="sch-label">Until (inclusive)</span>
                      <input type="date" className="sch-input" value={d.date_to} onChange={(e) => set("date_to", e.target.value)} />
                      {fieldError("date_to")}
                    </label>
                  </div>
                )}
                <div className="sch-field">
                  <span className="sch-label">Skipped dates</span>
                  <div className="sch-chips">
                    {d.exceptions.map((x) => (
                      <button key={x} type="button" className="sch-chip is-on" onClick={() => set("exceptions", d.exceptions.filter((y) => y !== x))} aria-label={`Air on ${shortDate(x)} again`}>
                        {shortDate(x)} ×
                      </button>
                    ))}
                    <input type="date" className="sch-input sch-tl-date-sm" value={newException} onChange={(e) => setNewException(e.target.value)} aria-label="Skip a date" />
                    <button
                      type="button"
                      className="sch-btn sch-btn-sm"
                      disabled={!newException}
                      onClick={() => {
                        set("exceptions", [...new Set([...d.exceptions, newException])].sort());
                        setNewException("");
                      }}
                    >
                      Skip this date
                    </button>
                  </div>
                </div>
              </>
            )}
          </fieldset>
        )}

        <div className="sch-form-row">
          <label className="sch-field">
            <span className="sch-label">Start</span>
            <select className="sch-input" value={d.start_min} onChange={(e) => set("start_min", Number(e.target.value))}>
              {times.map((t) => (
                <option key={t} value={t}>
                  {mm(t)}
                </option>
              ))}
            </select>
            {fieldError("start_min")}
          </label>
          <label className="sch-field">
            <span className="sch-label">End</span>
            <select className="sch-input" value={d.end_min} onChange={(e) => set("end_min", Number(e.target.value))}>
              {[...times.slice(1), 1440].map((t) => (
                <option key={t} value={t}>
                  {mm(t)}
                </option>
              ))}
            </select>
            {fieldError("end_min")}
          </label>
          <p className="sch-dim sch-len">
            {Math.floor(len / 60)} h {len % 60 ? `${len % 60} min` : ""}
            {d.end_min <= d.start_min ? " · runs past midnight" : ""}
          </p>
        </div>

        <div className="sch-form-row">
          <fieldset className="sch-field">
            <legend className="sch-label">Start</legend>
            <div className="sch-seg" role="radiogroup" aria-label="Start">
              <button type="button" role="radio" aria-checked={d.start_mode === "hard"} className={d.start_mode === "hard" ? "is-on" : ""} onClick={() => set("start_mode", "hard")}>
                📌 Hard: on the dot
              </button>
              <button type="button" role="radio" aria-checked={d.start_mode === "flexible"} className={d.start_mode === "flexible" ? "is-on" : ""} onClick={() => set("start_mode", "flexible")}>
                Flexible
              </button>
            </div>
          </fieldset>
          <fieldset className="sch-field">
            <legend className="sch-label">End</legend>
            <div className="sch-seg" role="radiogroup" aria-label="End">
              <button type="button" role="radio" aria-checked={d.end_mode === "hard"} className={d.end_mode === "hard" ? "is-on" : ""} onClick={() => set("end_mode", "hard")}>
                Hard
              </button>
              <button type="button" role="radio" aria-checked={d.end_mode === "flexible"} className={d.end_mode === "flexible" ? "is-on" : ""} onClick={() => set("end_mode", "flexible")}>
                Flexible: last song plays out
              </button>
            </div>
          </fieldset>
          <fieldset className="sch-field">
            <legend className="sch-label">Priority</legend>
            <div className="sch-seg" role="radiogroup" aria-label="Priority">
              <button type="button" role="radio" aria-checked={d.priority === "normal"} className={d.priority === "normal" ? "is-on" : ""} onClick={() => set("priority", "normal")}>
                Normal
              </button>
              <button type="button" role="radio" aria-checked={d.priority === "high"} className={d.priority === "high" ? "is-on" : ""} onClick={() => set("priority", "high")}>
                High
              </button>
            </div>
          </fieldset>
        </div>
        <p className="sch-dim sch-tl-help">
          A flexible end into a flexible start lets the last song finish naturally; the next block starts a few minutes later. A hard start is always on time. High priority: a later Hold can never move this start.
        </p>

        <fieldset className="sch-field">
          <legend className="sch-label">Fill with</legend>
          <div className="sch-radios">
            {FILLS.map(([k, label]) => (
              <label key={k}>
                <input type="radio" name="fill" checked={d.fill_kind === k} onChange={() => setD((x) => ({ ...x, fill_kind: k, list_id: k === x.fill_kind ? x.list_id : null, colour: !x.id && (k === "template" || k === "manual") ? "purple" : x.colour }))} /> {label}
              </label>
            ))}
          </div>
          {(d.fill_kind === "playlist" || d.fill_kind === "template") && (
            <label className="sch-field">
              <span className="sch-label">{d.fill_kind === "template" ? "Template" : "Playlist"}</span>
              <select className="sch-input" value={d.list_id ?? ""} onChange={(e) => set("list_id", e.target.value || null)} aria-invalid={error?.field === "list_id" || undefined}>
                <option value="">Choose…</option>
                {(board.lists ?? [])
                  .filter((l) => l.kind === d.fill_kind && (!l.archived || l.id === draft.list_id))
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} ({l.slots} item{l.slots === 1 ? "" : "s"}){l.archived ? " · archived" : ""}
                    </option>
                  ))}
              </select>
              <span className="sch-dim">
                {d.fill_kind === "template"
                  ? "Each airing plays its own episode (Create next episode), or the template as it stands. Items with a time start exactly then."
                  : "Plays in order from the block's start."}{" "}
                <a href="/studio/scheduler/lists">Playlists & templates</a>
              </span>
              {fieldError("list_id")}
            </label>
          )}
          {d.fill_kind === "playlist" && (
            <div className="sch-seg" role="radiogroup" aria-label="If the playlist is shorter than the block">
              <button type="button" role="radio" aria-checked={d.when_short === "fill"} className={d.when_short === "fill" ? "is-on" : ""} onClick={() => set("when_short", "fill")}>
                Shorter than the block: fill the rest with songs
              </button>
              <button type="button" role="radio" aria-checked={d.when_short === "loop"} className={d.when_short === "loop" ? "is-on" : ""} onClick={() => set("when_short", "loop")}>
                Loop the playlist
              </button>
            </div>
          )}
          {d.fill_kind === "manual" ? (
            <p className="sch-dim">
              You build each airing item by item (Open running order on the Timeline). Anything left empty is filled by the channel's own music, never silence.
            </p>
          ) : d.fill_kind === "programme" ? (
            <label className="sch-field">
              <span className="sch-label">Programme (published)</span>
              <select className="sch-input" value={d.programme_id ?? ""} onChange={(e) => set("programme_id", e.target.value || null)} aria-invalid={error?.field === "programme_id" || undefined}>
                <option value="">Choose…</option>
                {programmes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} ({p.items} items{p.duration_seconds ? `, ${Math.round(p.duration_seconds / 60)} min` : ""})
                  </option>
                ))}
              </select>
              <span className="sch-dim">Plays from item 1 at the block's start, and loops if the block is longer.</span>
              {fieldError("programme_id")}
            </label>
          ) : (
            <div className="sch-field">
              {d.fill_kind !== "autopilot" && <span className="sch-label">Songs that top it up (by tag)</span>}
              <div className="sch-chips sch-tl-tags" role="group" aria-label="Tags">
                {board.tags.map((t) => (
                  <button key={t} type="button" className={`sch-chip${d.tags_any.includes(t) ? " is-on" : ""}`} aria-pressed={d.tags_any.includes(t)} onClick={() => set("tags_any", d.tags_any.includes(t) ? d.tags_any.filter((x) => x !== t) : [...d.tags_any, t])}>
                    {t}
                  </button>
                ))}
              </div>
              <span className="sch-dim">
                {pool ? `${pool.tracks} songs · about ${hours >= 1 ? `${Math.round(hours)} hours` : `${Math.round(hours * 60)} minutes`} without repeats` : "Counting…"}
                {!d.tags_any.length && ` (no tags: ${lane?.name ?? "the channel"}'s own songs)`}
              </span>
              {fieldError("tags_any")}
            </div>
          )}
        </fieldset>

        <div className="sch-form-row">
          <fieldset className="sch-field">
            <legend className="sch-label">Colour</legend>
            <div className="sch-chips">
              {COLOURS.map(({ c, label }) => (
                <button key={c} type="button" className={`sch-swatch is-${c}${d.colour === c ? " is-on" : ""}`} aria-pressed={d.colour === c} aria-label={label} title={label} onClick={() => set("colour", c)} />
              ))}
            </div>
          </fieldset>
          <label className="sch-check">
            <input type="checkbox" checked={d.public} onChange={(e) => set("public", e.target.checked)} /> Show on the public schedule
          </label>
          <label className="sch-check">
            <input type="checkbox" checked={d.active} onChange={(e) => set("active", e.target.checked)} /> Active
          </label>
        </div>

        {error && !error.field && (
          <p className="sch-error" role="alert">
            {error.message}
          </p>
        )}
      </div>
    </Modal>
  );
}
