import { useState } from "react";
import type { LibraryResult, SlotInput, SlotRule, SlotView } from "./api";
import { clock } from "./common";
import { LIBRARY_MIME, LibraryPicker } from "./LibraryPicker";

/**
 * The slot list shared by the running-order editor and the playlists &
 * templates editor (Release 2, §6.2 and §7): computed start times, an
 * optional fixed time ("at") per item, the slot kind, reordering by drag or
 * the arrow buttons, remove, and adding a library item, a rule slot or (for
 * templates and episodes) an episode slot. Library items can be dragged in.
 */

export interface Row {
  key: string;
  slot_kind: "fixed" | "rule" | "episode";
  track_id: string | null;
  audio_asset_id: string | null;
  rule: SlotRule | null;
  /** The slot's own label ("Opening jingle", "Interview"). */
  label: string | null;
  at_ms: number | null;
  auto_filled: boolean;
  /** For display: the item's title, its length (null when unknown) and what it is. */
  title: string;
  ms: number | null;
  item_type: string | null;
  missing?: boolean;
  no_match?: boolean;
}

let seq = 0;
const nextKey = () => `r${++seq}`;

export function rowsFromViews(views: SlotView[]): Row[] {
  return views.map((v) => ({
    key: nextKey(),
    slot_kind: v.slot_kind,
    track_id: v.track_id,
    audio_asset_id: v.audio_asset_id,
    rule: v.rule,
    label: v.slot_label,
    at_ms: v.at_ms,
    auto_filled: v.auto_filled,
    title: v.label,
    ms: v.ms,
    item_type: v.item_type,
    missing: v.missing,
    no_match: v.no_match,
  }));
}

export function rowsToInputs(rows: Row[]): SlotInput[] {
  return rows.map((r) => ({
    slot_kind: r.slot_kind,
    track_id: r.slot_kind === "fixed" ? r.track_id : null,
    audio_asset_id: r.slot_kind === "fixed" ? r.audio_asset_id : null,
    rule: r.slot_kind === "rule" ? r.rule : null,
    label: r.label,
    at_ms: r.at_ms,
    auto_filled: r.auto_filled ? 1 : 0,
  }));
}

export function rowFromLibrary(item: LibraryResult): Row {
  return {
    key: nextKey(),
    slot_kind: "fixed",
    track_id: item.track_id ?? null,
    audio_asset_id: item.track_id ? null : (item.audio_asset_id ?? null),
    rule: null,
    label: null,
    at_ms: null,
    auto_filled: false,
    title: item.title,
    ms: item.duration_seconds ? item.duration_seconds * 1000 : null,
    item_type: item.kind === "song" ? "song" : item.kind,
  };
}

/** Start of each row and where the whole runs to (an item with an "at" time starts then, or after the one before if that's later). */
export function timings(rows: Row[]): { starts: number[]; end: number } {
  const starts: number[] = [];
  let t = 0;
  for (const r of rows) {
    if (r.at_ms !== null && r.at_ms > t) t = r.at_ms;
    starts.push(t);
    t += r.slot_kind === "episode" ? 0 : (r.ms ?? 0);
  }
  return { starts, end: t };
}

export const ruleText = (r: SlotRule | null) => {
  if (!r) return "Rule";
  if (r.item_type === "song") return `A song${r.tags_any?.length ? ` tagged ${r.tags_any.join(", ")}` : " from the pool"}`;
  if (r.item_type === "station_id") return "A station ID";
  if (r.item_type === "promo") return "A promo";
  return r.link_kind ? `A link (${r.link_kind.replace("_", " ")})` : "A voice link";
};

const TYPE_ICON: Record<string, string> = { song: "♪", station_id: "◆", link: "🎙", feature: "★", interview: "🎤", promo: "📣" };
const typeIcon = (r: Row) => (r.slot_kind === "episode" ? "▢" : r.slot_kind === "rule" ? "⚙" : TYPE_ICON[r.item_type ?? ""] ?? "•");

/** "05:00" or "1:05:00" from ms (inside a block). */
export const offset = (ms: number) => {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};
/** "5:00", "05:00" or "1:05:00" to ms; null when it isn't a time. */
export const parseOffset = (s: string): number | null => {
  const parts = s.trim().split(":").map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  return null;
};

export function SlotEditor({
  rows,
  onChange,
  editable,
  allowAt,
  allowEpisode,
  tags,
  linkKinds = ["intro", "transition", "fun_fact", "observation", "outro"],
  channelSlug,
  /** Absolute time of the block's start, to show clock times instead of offsets. */
  startMs,
  clockLabel,
  highlightEmpty = false,
}: {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  editable: boolean;
  allowAt: boolean;
  allowEpisode: boolean;
  tags: string[];
  linkKinds?: string[];
  channelSlug?: string;
  startMs?: number | null;
  clockLabel?: (ms: number) => string;
  highlightEmpty?: boolean;
}) {
  const [picker, setPicker] = useState<{ fill?: number } | null>(null);
  const [ruleForm, setRuleForm] = useState<{ index: number | null; rule: SlotRule; label: string } | null>(null);
  const [episodeLabel, setEpisodeLabel] = useState<string | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const [atEdit, setAtEdit] = useState<{ index: number; text: string } | null>(null);
  const { starts } = timings(rows);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= rows.length || from === to) return;
    const next = [...rows];
    const [r] = next.splice(from, 1);
    next.splice(to, 0, r);
    onChange(next);
  };
  const replace = (i: number, r: Row) => onChange(rows.map((x, k) => (k === i ? r : x)));
  const insertAt = (i: number, r: Row) => {
    const next = [...rows];
    next.splice(i, 0, r);
    onChange(next);
  };
  const timeText = (ms: number) => (startMs ? (clockLabel ?? offset)(startMs + ms) : offset(ms));

  const onDrop = (e: React.DragEvent, at: number) => {
    e.preventDefault();
    setDropAt(null);
    const lib = e.dataTransfer.getData(LIBRARY_MIME);
    if (lib) {
      const item = JSON.parse(lib) as LibraryResult;
      if (item.track_id || item.audio_asset_id) insertAt(at, rowFromLibrary(item));
    } else if (dragFrom !== null) move(dragFrom, at > dragFrom ? at - 1 : at);
    setDragFrom(null);
  };

  return (
    <div className="sch-slots">
      <ol
        className="sch-slots-list"
        onDragOver={(e) => {
          if (!editable) return;
          e.preventDefault();
          if (dropAt === null) setDropAt(rows.length);
        }}
        onDrop={(e) => editable && onDrop(e, dropAt ?? rows.length)}
      >
        {rows.length === 0 && <li className="sch-slots-empty sch-dim">{editable ? "Nothing here yet. Add items below, or drag them in from the library." : "Nothing here yet."}</li>}
        {rows.map((r, i) => {
          const emptyEp = r.slot_kind === "episode";
          return (
            <li
              key={r.key}
              className={`sch-slot is-${r.slot_kind}${r.auto_filled ? " is-auto" : ""}${emptyEp && highlightEmpty ? " is-highlight" : ""}${r.missing ? " is-missing" : ""}${dropAt === i ? " is-drop" : ""}`}
              draggable={editable}
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => {
                if (!editable) return;
                e.preventDefault();
                e.stopPropagation();
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                setDropAt(e.clientY > rect.top + rect.height / 2 ? i + 1 : i);
              }}
              onDrop={(e) => {
                e.stopPropagation();
                if (editable) onDrop(e, dropAt ?? i);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDropAt(null);
              }}
            >
              <span className="sch-slot-time">{timeText(starts[i])}</span>
              <span className="sch-slot-icon" aria-hidden="true">
                {typeIcon(r)}
              </span>
              <span className="sch-slot-main">
                <span className="sch-slot-title">
                  {emptyEp ? <em>{r.label ?? "Episode slot"}: empty</em> : r.slot_kind === "rule" ? (r.label ? `${r.label}: ${ruleText(r.rule)}` : ruleText(r.rule)) : r.title}
                </span>
                <span className="sch-dim">
                  {r.slot_kind === "fixed" && r.label ? `${r.label} · ` : ""}
                  {r.slot_kind === "rule" ? "Rule slot, picked when the log is built" : emptyEp ? "Episode slot: filled per episode" : r.auto_filled ? "Auto-filled" : "Fixed"}
                  {r.missing && " · no audio: it can't play"}
                  {r.no_match && " · nothing matches: skipped"}
                </span>
              </span>
              <span className="sch-slot-len">{r.ms !== null ? `${r.slot_kind === "rule" ? "≈" : ""}${clock(r.ms)}` : "–"}</span>
              {allowAt && (
                <span className="sch-slot-at">
                  {atEdit?.index === i ? (
                    <input
                      className="sch-input sch-slot-at-input"
                      value={atEdit.text}
                      autoFocus
                      aria-label="Starts at (minutes:seconds into the block)"
                      onChange={(e) => setAtEdit({ index: i, text: e.target.value })}
                      onBlur={() => {
                        const v = atEdit.text.trim() === "" ? null : parseOffset(atEdit.text);
                        if (atEdit.text.trim() === "" || v !== null) replace(i, { ...r, at_ms: v });
                        setAtEdit(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                        if (e.key === "Escape") setAtEdit(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className={`sch-slot-pin${r.at_ms !== null ? " is-on" : ""}`}
                      disabled={!editable}
                      title={r.at_ms !== null ? `Starts at exactly ${offset(r.at_ms)} into the block` : "Pin to a fixed time"}
                      onClick={() => setAtEdit({ index: i, text: r.at_ms !== null ? offset(r.at_ms) : offset(starts[i]) })}
                    >
                      📌 {r.at_ms !== null ? offset(r.at_ms) : ""}
                    </button>
                  )}
                </span>
              )}
              {editable && (
                <span className="sch-slot-actions">
                  {emptyEp && (
                    <button type="button" className="sch-btn sch-btn-sm sch-btn-red" onClick={() => setPicker({ fill: i })}>
                      Fill: {r.label ?? "slot"}
                    </button>
                  )}
                  {r.slot_kind === "rule" && (
                    <button type="button" className="sch-btn sch-btn-sm" onClick={() => setRuleForm({ index: i, rule: r.rule ?? { item_type: "song", tags_any: [] }, label: r.label ?? "" })}>
                      Edit
                    </button>
                  )}
                  <button type="button" className="sch-icon-btn" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>
                    ↑
                  </button>
                  <button type="button" className="sch-icon-btn" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, i + 1)}>
                    ↓
                  </button>
                  <button type="button" className="sch-icon-btn" aria-label={`Remove ${r.title}`} onClick={() => onChange(rows.filter((_, k) => k !== i))}>
                    ×
                  </button>
                </span>
              )}
            </li>
          );
        })}
        {dropAt === rows.length && rows.length > 0 && <li className="sch-slot-dropline" aria-hidden="true" />}
      </ol>
      {editable && (
        <div className="sch-slots-add">
          <button type="button" className="sch-btn sch-btn-sm" onClick={() => setPicker({})}>
            + Add item
          </button>
          <button type="button" className="sch-btn sch-btn-sm" onClick={() => setRuleForm({ index: null, rule: { item_type: "song", tags_any: [] }, label: "" })}>
            + Add rule slot
          </button>
          {allowEpisode && (
            <button type="button" className="sch-btn sch-btn-sm" onClick={() => setEpisodeLabel("")}>
              + Add episode slot
            </button>
          )}
        </div>
      )}

      {picker && (
        <LibraryPicker
          channelSlug={channelSlug ?? ""}
          title={picker.fill !== undefined ? `Fill: ${rows[picker.fill]?.label ?? "slot"}` : "Add an item"}
          actionLabel={picker.fill !== undefined ? "Fill" : "Add"}
          initialType={picker.fill !== undefined ? "features" : "songs"}
          onClose={() => setPicker(null)}
          onPick={(item) => {
            const row = rowFromLibrary(item);
            if (picker.fill !== undefined) {
              const was = rows[picker.fill];
              replace(picker.fill, { ...row, label: was.label, at_ms: was.at_ms });
            } else onChange([...rows, row]);
            setPicker(null);
          }}
        />
      )}
      {ruleForm && (
        <RuleForm
          initial={ruleForm}
          tags={tags}
          linkKinds={linkKinds}
          onClose={() => setRuleForm(null)}
          onSave={(rule, label) => {
            const row: Row = { key: nextKey(), slot_kind: "rule", track_id: null, audio_asset_id: null, rule, label: label || null, at_ms: null, auto_filled: false, title: ruleText(rule), ms: null, item_type: rule.item_type };
            if (ruleForm.index === null) onChange([...rows, row]);
            else replace(ruleForm.index, { ...rows[ruleForm.index], rule, label: label || null, title: ruleText(rule) });
            setRuleForm(null);
          }}
        />
      )}
      {episodeLabel !== null && (
        <div className="sch-slots-inline" role="group" aria-label="New episode slot">
          <input className="sch-input" value={episodeLabel} onChange={(e) => setEpisodeLabel(e.target.value)} placeholder="Interview" aria-label="Episode slot label" autoFocus />
          <button
            type="button"
            className="sch-btn sch-btn-sm sch-btn-red"
            disabled={!episodeLabel.trim()}
            onClick={() => {
              onChange([...rows, { key: nextKey(), slot_kind: "episode", track_id: null, audio_asset_id: null, rule: null, label: episodeLabel.trim(), at_ms: null, auto_filled: false, title: episodeLabel.trim(), ms: null, item_type: null }]);
              setEpisodeLabel(null);
            }}
          >
            Add
          </button>
          <button type="button" className="sch-btn sch-btn-sm" onClick={() => setEpisodeLabel(null)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

function RuleForm({
  initial,
  tags,
  linkKinds,
  onSave,
  onClose,
}: {
  initial: { rule: SlotRule; label: string };
  tags: string[];
  linkKinds: string[];
  onSave: (rule: SlotRule, label: string) => void;
  onClose: () => void;
}) {
  const [rule, setRule] = useState<SlotRule>(initial.rule);
  const [label, setLabel] = useState(initial.label);
  return (
    <div className="sch-slots-inline sch-ruleform" role="group" aria-label="Rule slot">
      <label className="sch-field">
        <span className="sch-label">Picks</span>
        <select className="sch-input" value={rule.item_type} onChange={(e) => setRule({ item_type: e.target.value as SlotRule["item_type"], tags_any: [] })}>
          <option value="song">A song</option>
          <option value="station_id">A station ID</option>
          <option value="link">A voice link</option>
          <option value="promo">A promo</option>
        </select>
      </label>
      {rule.item_type === "song" && (
        <div className="sch-field">
          <span className="sch-label">Tagged (any of; none = the block's pool)</span>
          <div className="sch-chips">
            {tags.map((t) => {
              const on = rule.tags_any?.includes(t) ?? false;
              return (
                <button key={t} type="button" className={`sch-chip${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => setRule({ ...rule, tags_any: on ? rule.tags_any!.filter((x) => x !== t) : [...(rule.tags_any ?? []), t] })}>
                  {t}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {rule.item_type === "link" && (
        <label className="sch-field">
          <span className="sch-label">Kind of link</span>
          <select className="sch-input" value={rule.link_kind ?? ""} onChange={(e) => setRule({ ...rule, link_kind: e.target.value || undefined })}>
            <option value="">Any</option>
            {linkKinds.map((k) => (
              <option key={k} value={k}>
                {k.replace("_", " ")}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="sch-field">
        <span className="sch-label">Label (optional)</span>
        <input className="sch-input" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder="Intro link" />
      </label>
      <div className="sch-slots-inline-actions">
        <button type="button" className="sch-btn sch-btn-sm sch-btn-red" onClick={() => onSave(rule, label.trim())}>
          {initial.label || initial.rule.tags_any?.length ? "Save rule" : "Add rule slot"}
        </button>
        <button type="button" className="sch-btn sch-btn-sm" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
