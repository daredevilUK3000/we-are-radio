import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { friendly, schedApi, type GridBlock, type GridPayload, type OverviewChannel } from "./api";
import { dayHm, hm, Modal, SchedulerNav, Toast, useNow, type ToastState } from "./common";
import "./scheduler.css";

/**
 * Studio -> Scheduler -> Weekly grid (/studio/scheduler/grid): each channel's
 * named blocks on set days and times, so "it's 16:00 on Wednesday - what
 * should be on?" has an answer. Every save regenerates the log through the
 * versioned path, from the end of the song on air, or is rejected whole.
 */

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const HOUR_PX = 44;
const COLOURS: GridBlock["colour"][] = ["blue", "purple", "gold", "green"];

const mm = (min: number) => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const pastMidnight = (b: { start_min: number; end_min: number }) => b.end_min <= b.start_min;
const lengthMin = (b: { start_min: number; end_min: number }) => (pastMidnight(b) ? 1440 - b.start_min + b.end_min : b.end_min - b.start_min);

/** Paris weekday (0 = Monday) and minutes since midnight, now. */
function parisNow(ms: number) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: DAY_SHORT.indexOf(get("weekday")), minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

interface Draft {
  id?: string;
  name: string;
  description: string;
  days_mask: number;
  start_min: number;
  end_min: number;
  fill_kind: "programme" | "autopilot";
  programme_id: string | null;
  tags_any: string[];
  colour: GridBlock["colour"];
  active: boolean;
}

export function WeeklyGrid() {
  const now = useNow(30_000);
  const [channels, setChannels] = useState<OverviewChannel[] | null>(null);
  const [slug, setSlug] = useState<string | null>(() => new URLSearchParams(window.location.search).get("channel"));
  const [grid, setGrid] = useState<GridPayload | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [copyAsk, setCopyAsk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    schedApi
      .overview()
      .then((r) => {
        setChannels(r.channels);
        setSlug((s) => s ?? r.channels.find((c) => c.enabled)?.slug ?? r.channels.find((c) => c.status === "live")?.slug ?? r.channels[0]?.slug ?? null);
      })
      .catch((e) => setError(friendly(e)));
  }, []);
  const load = useCallback(() => {
    if (!slug) return;
    schedApi.grid(slug).then(setGrid).catch((e) => setError(friendly(e)));
    const url = new URL(window.location.href);
    url.searchParams.set("channel", slug);
    window.history.replaceState(window.history.state, "", url);
  }, [slug]);
  useEffect(() => {
    setGrid(null);
    load();
  }, [load]);

  const locked = grid ? !grid.enabled : true;
  const saved = (res: GridPayload & { version: number; live_from_ms: number }, verb: string, blockId?: string) => {
    setGrid(res);
    const occ = blockId ? res.week.flatMap((d) => d.occurrences).filter((o) => o.block_id === blockId && o.end_ms > Date.now()).sort((a, b) => a.start_ms - b.start_ms)[0] : null;
    const from = occ ? Math.max(occ.start_ms, res.live_from_ms) : res.live_from_ms;
    const sameDay = new Date(from).toDateString() === new Date().toDateString();
    setToast({ message: `${verb}. Live from ${sameDay ? `${hm(from)} today` : dayHm(from)}, as v${res.version}.` });
  };

  const openNew = (day: number, start: number, end?: number) => {
    if (locked || !grid) return;
    setDraft({
      name: "",
      description: "",
      days_mask: 1 << day,
      start_min: start,
      end_min: end ?? Math.min(1440, start + 60),
      fill_kind: "autopilot",
      programme_id: null,
      tags_any: grid.channel_tags,
      colour: "blue",
      active: true,
    });
  };

  const channel = channels?.find((c) => c.slug === slug) ?? null;

  return (
    <div className="sch">
      <SchedulerNav />
      <header className="sch-head">
        <div>
          <h1 className="sch-h1">Weekly grid</h1>
          <p className="sch-dim">What each channel should play, by day and time (Paris). Time outside the blocks is the channel default.</p>
        </div>
        {grid && !locked && (
          <button type="button" className="sch-btn sch-btn-red" onClick={() => openNew(parisNow(now).day, 600, 720)}>
            Add a block
          </button>
        )}
      </header>
      {error && (
        <p className="sch-error" role="alert">
          {error}
        </p>
      )}

      <div className="sch-strip is-compact" role="tablist" aria-label="Channels">
        {channels?.map((c) => (
          <button key={c.slug} role="tab" aria-selected={c.slug === slug} className={`sch-card-ch${c.slug === slug ? " is-on" : ""}`} onClick={() => setSlug(c.slug)}>
            <span className="sch-card-top">
              <span className={`sch-dot is-${c.health}`} aria-hidden="true" />
              <span className="sch-card-name">{c.name}</span>
            </span>
            <span className="sch-card-grid">{c.enabled ? (c.grid.now ? `${c.grid.now.name} · until ${hm(c.grid.now.end_ms)}` : "Channel default") : "Locked: in shadow"}</span>
          </button>
        ))}
      </div>

      {grid && locked && (
        <div className="sch-locked" role="note">
          <strong>The grid unlocks once the Scheduler is on air for {grid.channel.name}.</strong>
          <p>
            First the Scheduler proves it plays exactly what listeners hear today (shadow mode), then it goes on air, then you build the grid. That keeps the comparison honest.{" "}
            <Link to={`/studio/scheduler?channel=${grid.channel.slug}`}>Open Master Control</Link>
          </p>
        </div>
      )}

      {grid && (
        <div className="sch-grid-layout">
          <WeekView grid={grid} now={now} locked={locked} onAdd={openNew} onEdit={(b) => !locked && setDraft({ ...b, active: !!b.active })} />
          <aside className="sch-card sch-glance" aria-labelledby="sch-glance-h">
            <h2 id="sch-glance-h" className="sch-eyebrow">
              This week at a glance
            </h2>
            <ul className="sch-plain">
              {DAYS.map((d, i) => {
                const list = grid.blocks.filter((b) => b.active && b.days_mask & (1 << i)).sort((a, b) => a.start_min - b.start_min);
                return (
                  <li key={d}>
                    <strong>{DAY_SHORT[i]}</strong> {list.length ? list.map((b) => `${mm(b.start_min)} ${b.name}`).join(" · ") : <span className="sch-dim">Channel default all day</span>}
                  </li>
                );
              })}
            </ul>
            {!locked && (
              <button type="button" className="sch-btn sch-btn-block" onClick={() => setCopyAsk(true)}>
                Copy Monday to all weekdays
              </button>
            )}
          </aside>
        </div>
      )}

      {draft && grid && slug && (
        <BlockEditor
          slug={slug}
          grid={grid}
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={(res, verb, id) => {
            setDraft(null);
            saved(res, verb, id);
          }}
        />
      )}
      {copyAsk && slug && (
        <Modal
          title="Copy Monday to Tuesday–Friday?"
          onClose={() => setCopyAsk(false)}
          footer={
            <>
              <button type="button" className="sch-btn" onClick={() => setCopyAsk(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="sch-btn sch-btn-red"
                onClick={async () => {
                  try {
                    const res = await schedApi.copyDay(slug, "mon", ["tue", "wed", "thu", "fri"]);
                    setCopyAsk(false);
                    saved(res, "Copied Monday to the weekdays");
                  } catch (err) {
                    setCopyAsk(false);
                    setToast({ message: friendly(err), tone: "error" });
                  }
                }}
              >
                Copy
              </button>
            </>
          }
        >
          <p>Tuesday to Friday will have exactly Monday's blocks. Blocks those days have now are replaced.</p>
        </Modal>
      )}
      <Toast toast={toast} onUndo={() => {}} onClose={() => setToast(null)} />
      {channel && !channel.enabled && <p className="sch-dim sch-foot-note">Tip: you can still look at a locked channel's grid; editing waits for it to go on air.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ the week

function WeekView({ grid, now, locked, onAdd, onEdit }: { grid: GridPayload; now: number; locked: boolean; onAdd: (day: number, start: number, end?: number) => void; onEdit: (b: GridBlock) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const drag = useRef<{ day: number; from: number } | null>(null);
  const [ghost, setGhost] = useState<{ day: number; a: number; b: number } | null>(null);
  const p = parisNow(now);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = Math.max(0, (p.minutes / 60 - 2) * HOUR_PX);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid.channel.id]);

  // Each block's pieces per day column (a block past midnight continues at the top of the next day).
  const pieces = useMemo(() => {
    const out: { block: GridBlock; day: number; top: number; bottom: number; continuing: boolean }[] = [];
    for (const b of grid.blocks) {
      for (let d = 0; d < 7; d++) {
        if (!(b.days_mask & (1 << d))) continue;
        if (pastMidnight(b)) {
          out.push({ block: b, day: d, top: b.start_min, bottom: 1440, continuing: false });
          if (b.end_min > 0) out.push({ block: b, day: (d + 1) % 7, top: 0, bottom: b.end_min, continuing: true });
        } else out.push({ block: b, day: d, top: b.start_min, bottom: b.end_min, continuing: false });
      }
    }
    return out;
  }, [grid.blocks]);

  const minutesAt = (e: React.PointerEvent, el: HTMLElement) => {
    const rect = el.getBoundingClientRect();
    const m = ((e.clientY - rect.top) / (HOUR_PX * 24)) * 1440;
    return Math.max(0, Math.min(1440, Math.round(m / 15) * 15));
  };

  return (
    <div className="sch-week" role="region" aria-label={`${grid.channel.name} weekly grid`}>
      <div className="sch-week-head">
        <span />
        {DAYS.map((d, i) => (
          <span key={d} className={i === p.day ? "is-today" : undefined}>
            {DAY_SHORT[i]}
          </span>
        ))}
      </div>
      <div className="sch-week-scroll" ref={scroller}>
        <div className="sch-week-body" style={{ height: HOUR_PX * 24 }}>
          <div className="sch-hours" aria-hidden="true">
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} style={{ top: h * HOUR_PX }}>
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
          {DAYS.map((d, day) => (
            <div
              key={d}
              className={`sch-day${day === p.day ? " is-today" : ""}${locked ? " is-locked" : ""}`}
              style={{ backgroundSize: `100% ${HOUR_PX / 2}px` }}
              onPointerDown={(e) => {
                if (locked || (e.target as HTMLElement).closest(".sch-block")) return;
                const m = minutesAt(e, e.currentTarget);
                drag.current = { day, from: Math.floor(m / 30) * 30 };
                setGhost({ day, a: drag.current.from, b: drag.current.from + 30 });
                e.currentTarget.setPointerCapture(e.pointerId);
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
                onAdd(day, a, b - a >= 30 ? b : Math.min(1440, a + 60));
              }}
            >
              <span className="sch-day-default" aria-hidden="true">
                Channel default
              </span>
              {pieces
                .filter((x) => x.day === day)
                .map((x) => (
                  <button
                    key={`${x.block.id}-${x.continuing}`}
                    type="button"
                    className={`sch-block is-${x.block.colour}${x.block.active ? "" : " is-inactive"}${x.continuing ? " is-continuing" : ""}`}
                    style={{ top: (x.top / 60) * HOUR_PX, height: Math.max(18, ((x.bottom - x.top) / 60) * HOUR_PX - 2) }}
                    onClick={() => onEdit(x.block)}
                    aria-label={`${x.block.name}, ${DAYS[x.continuing ? (day + 6) % 7 : day]} ${mm(x.block.start_min)} to ${mm(x.block.end_min)}${x.continuing ? ", continuing past midnight" : ""}. ${x.block.description}`}
                    disabled={locked}
                  >
                    <strong>{x.continuing ? `↳ ${x.block.name}` : x.block.name}</strong>
                    <span>
                      {mm(x.block.start_min)}–{mm(x.block.end_min)}
                      {!x.block.active && " · off"}
                    </span>
                    <span className="sch-block-desc">{x.block.description}</span>
                  </button>
                ))}
              {ghost?.day === day && <span className="sch-ghost" style={{ top: (ghost.a / 60) * HOUR_PX, height: ((ghost.b - ghost.a) / 60) * HOUR_PX }} />}
              {day === p.day && <span className="sch-nowline" style={{ top: (p.minutes / 60) * HOUR_PX }} aria-label={`Now, ${mm(p.minutes)}`} />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the editor

function BlockEditor({
  slug,
  grid,
  draft,
  onClose,
  onSaved,
}: {
  slug: string;
  grid: GridPayload;
  draft: Draft;
  onClose: () => void;
  onSaved: (res: GridPayload & { version: number; live_from_ms: number }, verb: string, blockId?: string) => void;
}) {
  const [d, setD] = useState<Draft>(draft);
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pool, setPool] = useState<{ tracks: number; seconds: number } | null>(null);
  const [askDelete, setAskDelete] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setD((x) => ({ ...x, [k]: v }));
    setWarning(null);
  };

  useEffect(() => {
    if (d.fill_kind !== "autopilot") return;
    const id = window.setTimeout(() => schedApi.pool(d.tags_any, slug).then(setPool).catch(() => setPool(null)), 250);
    return () => window.clearTimeout(id);
  }, [d.tags_any, d.fill_kind, slug]);

  const times = Array.from({ length: 96 }, (_, i) => i * 15);
  const save = async (force = false, asCopy = false) => {
    setBusy(true);
    setError(null);
    const body = { ...d, force };
    try {
      const res = d.id && !asCopy ? await schedApi.updateBlock(slug, d.id, body) : await schedApi.createBlock(slug, { ...body, name: asCopy ? `${d.name} (copy)` : d.name });
      const saved = res.blocks.find((b) => b.name === (asCopy ? `${d.name} (copy)` : d.name));
      onSaved(res, asCopy ? "Duplicated" : "Saved", saved?.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === "warning") setWarning(err.friendly ?? "Songs may repeat within two hours.");
      else setError({ field: err instanceof ApiError ? err.field : undefined, message: friendly(err) });
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!d.id) return;
    setBusy(true);
    try {
      onSaved(await schedApi.deleteBlock(slug, d.id), "Deleted");
    } catch (err) {
      setError({ message: friendly(err) });
      setBusy(false);
    }
  };

  const hours = pool ? pool.seconds / 3600 : 0;
  const len = lengthMin(d);

  if (askDelete) {
    return (
      <Modal
        title={`Delete ${d.name}?`}
        onClose={() => setAskDelete(false)}
        footer={
          <>
            <button type="button" className="sch-btn" onClick={() => setAskDelete(false)}>
              Cancel
            </button>
            <button type="button" className="sch-btn sch-btn-red" disabled={busy} onClick={() => void remove()}>
              Delete
            </button>
          </>
        }
      >
        <p>Its time goes back to the channel default. If it's on air, the song playing finishes first.</p>
      </Modal>
    );
  }

  const fieldError = (f: string) => (error?.field === f ? <p className="sch-error" role="alert">{error.message}</p> : null);

  return (
    <Modal
      title={d.id ? `Edit ${draft.name}` : "New block"}
      onClose={onClose}
      wide
      footer={
        <>
          {d.id && (
            <>
              <button type="button" className="sch-btn" onClick={() => setAskDelete(true)} disabled={busy}>
                Delete
              </button>
              <button type="button" className="sch-btn" onClick={() => void save(false, true)} disabled={busy}>
                Duplicate
              </button>
            </>
          )}
          <span className="sch-spacer" />
          <button type="button" className="sch-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="sch-btn sch-btn-red" onClick={() => void save(!!warning)} disabled={busy}>
            {warning ? "Save anyway" : "Save"}
          </button>
        </>
      }
    >
      <div className="sch-form">
        <label className="sch-field">
          <span className="sch-label">Name</span>
          <input className="sch-input" value={d.name} maxLength={60} onChange={(e) => set("name", e.target.value)} placeholder="Afternoon Mix" autoFocus aria-invalid={error?.field === "name" || undefined} />
          {fieldError("name")}
        </label>
        <label className="sch-field">
          <span className="sch-label">Description: the sound of this block, in one line</span>
          <input className="sch-input" value={d.description} maxLength={140} onChange={(e) => set("description", e.target.value)} placeholder="Upbeat soul and gospel" aria-invalid={error?.field === "description" || undefined} />
          {fieldError("description")}
        </label>

        <fieldset className="sch-field">
          <legend className="sch-label">Days</legend>
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
          </div>
          {fieldError("days_mask")}
        </fieldset>

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
                  {t === 1440 ? "24:00" : mm(t)}
                </option>
              ))}
            </select>
            {fieldError("end_min")}
          </label>
          <p className="sch-dim sch-len">
            {Math.floor(len / 60)} h {len % 60 ? `${len % 60} min` : ""}
            {pastMidnight(d) ? " · runs past midnight" : ""}
          </p>
        </div>

        <fieldset className="sch-field">
          <legend className="sch-label">Fill with</legend>
          <div className="sch-radios">
            <label>
              <input type="radio" name="fill" checked={d.fill_kind === "autopilot"} onChange={() => set("fill_kind", "autopilot")} /> An autopilot rotation
            </label>
            <label>
              <input type="radio" name="fill" checked={d.fill_kind === "programme"} onChange={() => set("fill_kind", "programme")} /> A programme
            </label>
          </div>
          {d.fill_kind === "programme" ? (
            <label className="sch-field">
              <span className="sch-label">Programme (published)</span>
              <select className="sch-input" value={d.programme_id ?? ""} onChange={(e) => set("programme_id", e.target.value || null)} aria-invalid={error?.field === "programme_id" || undefined}>
                <option value="">Choose…</option>
                {grid.programmes.map((p) => (
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
              <span className="sch-label" id="sch-tags-l">
                Tags (songs with any of these)
              </span>
              <div className="sch-chips" role="group" aria-labelledby="sch-tags-l">
                {grid.tags.map((t) => (
                  <button key={t} type="button" className={`sch-chip${d.tags_any.includes(t) ? " is-on" : ""}`} aria-pressed={d.tags_any.includes(t)} onClick={() => set("tags_any", d.tags_any.includes(t) ? d.tags_any.filter((x) => x !== t) : [...d.tags_any, t])}>
                    {t}
                  </button>
                ))}
              </div>
              <span className="sch-dim">
                {pool ? `${pool.tracks} tracks · about ${hours >= 1 ? `${Math.round(hours)} hours` : `${Math.round(hours * 60)} minutes`} without repeats` : "Counting…"}
                {!d.tags_any.length && " (no tags: the channel's own)"}
              </span>
              {fieldError("tags_any")}
            </div>
          )}
        </fieldset>

        <div className="sch-form-row">
          <fieldset className="sch-field">
            <legend className="sch-label">Colour</legend>
            <div className="sch-chips">
              {COLOURS.map((c) => (
                <button key={c} type="button" className={`sch-swatch is-${c}${d.colour === c ? " is-on" : ""}`} aria-pressed={d.colour === c} aria-label={c} onClick={() => set("colour", c)} />
              ))}
            </div>
          </fieldset>
          <label className="sch-check">
            <input type="checkbox" checked={d.active} onChange={(e) => set("active", e.target.checked)} /> Active
          </label>
        </div>

        {error && !error.field && (
          <p className="sch-error" role="alert">
            {error.message}
          </p>
        )}
        {warning && (
          <p className="sch-warn" role="alert">
            {warning} You can save anyway.
          </p>
        )}
      </div>
    </Modal>
  );
}
