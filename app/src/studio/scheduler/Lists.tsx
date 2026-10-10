import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import { contentApi, friendly, planApi, type ListDetail, type ListSummary } from "./api";
import { clock, SchedulerNav, Toast, type ToastState } from "./common";
import { rowsFromViews, rowsToInputs, SlotEditor, timings, type Row } from "./SlotEditor";
import "./scheduler.css";
import "./timeline.css";
import "./content.css";

/**
 * Studio -> Scheduler -> Playlists & templates (/studio/scheduler/lists),
 * Release 2 §7. Playlists are an ordered list of items; templates give a show
 * its shape (items at fixed times, rule slots, and episode slots filled per
 * airing with Create next episode). Lists are station-wide: editing one is a
 * draft change on every channel with a block that uses it, and reaches the
 * air only when that channel is published.
 */
export function Lists() {
  const [params, setParams] = useSearchParams();
  const tab: "playlist" | "template" = params.get("tab") === "template" ? "template" : "playlist";
  const openId = params.get("open");
  const [lists, setLists] = useState<ListSummary[] | null>(null);
  const [archived, setArchived] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);

  const load = useCallback(() => {
    contentApi
      .lists(undefined, archived)
      .then((r) => {
        setLists(r.lists);
        setErr(null);
      })
      .catch((e) => setErr(friendly(e)));
  }, [archived]);
  useEffect(() => {
    load();
  }, [load]);
  // Opening a list from a link (?open=) shows its tab.
  useEffect(() => {
    if (!openId || !lists) return;
    const l = lists.find((x) => x.id === openId);
    if (l && l.kind !== tab) setParams({ tab: l.kind, open: openId }, { replace: true });
  }, [openId, lists, tab, setParams]);

  const shown = (lists ?? []).filter((l) => l.kind === tab);
  const word = tab === "template" ? "template" : "playlist";

  const create = async () => {
    if (!newName?.trim()) return;
    try {
      const r = await contentApi.createList({ kind: tab, name: newName.trim(), length_ms: tab === "template" ? 3_600_000 : null });
      setNewName(null);
      load();
      setParams({ tab, open: r.list.id });
    } catch (e) {
      setToast({ message: friendly(e), tone: "error" });
    }
  };

  return (
    <div className="sch sch-lists">
      <SchedulerNav />
      <header className="sch-tl-top">
        <h1 className="sch-h2">Playlists & templates</h1>
        <div className="sch-seg" role="tablist" aria-label="Kind">
          <button type="button" role="tab" aria-selected={tab === "playlist"} className={tab === "playlist" ? "is-on" : ""} onClick={() => setParams({ tab: "playlist" })}>
            Playlists
          </button>
          <button type="button" role="tab" aria-selected={tab === "template"} className={tab === "template" ? "is-on" : ""} onClick={() => setParams({ tab: "template" })}>
            Templates
          </button>
        </div>
        <label className="sch-check">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived
        </label>
        <span className="sch-spacer" />
        {newName === null ? (
          <button type="button" className="sch-btn sch-btn-red" onClick={() => setNewName("")}>
            + New {word}
          </button>
        ) : (
          <span className="sch-lists-new">
            <input className="sch-input" autoFocus value={newName} maxLength={60} placeholder={tab === "template" ? "Friday Game Changers" : "Morning Energy"} aria-label={`New ${word} name`} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
            <button type="button" className="sch-btn sch-btn-red" disabled={!newName.trim()} onClick={() => void create()}>
              Create
            </button>
            <button type="button" className="sch-btn" onClick={() => setNewName(null)}>
              Cancel
            </button>
          </span>
        )}
      </header>
      <p className="sch-dim sch-lists-intro">
        {tab === "template"
          ? "A template gives a show its shape: items at fixed times (📌), rule slots the Scheduler fills, and episode slots you fill for each airing with Create next episode."
          : "A playlist plays in order from its block's start. If it's shorter than the block, songs fill the rest (or it loops, if the block says so)."}{" "}
        Use one by choosing it in a block on the <Link to="/studio/scheduler/timeline">Timeline</Link>.
      </p>
      {err && <p className="sch-error">{err}</p>}

      <div className={`sch-lists-layout${openId ? " has-editor" : ""}`}>
        <table className="sch-table sch-lists-table">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Items</th>
              <th scope="col">Length</th>
              <th scope="col">Used by</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lists === null && (
              <tr>
                <td colSpan={5} className="sch-dim">
                  Loading…
                </td>
              </tr>
            )}
            {lists && shown.length === 0 && (
              <tr>
                <td colSpan={5} className="sch-dim">
                  No {word}s yet.
                </td>
              </tr>
            )}
            {shown.map((l) => (
              <tr key={l.id} className={`${openId === l.id ? "is-selected" : ""}${l.archived ? " is-archived" : ""}`}>
                <td>
                  <button type="button" className="sch-linkbtn" onClick={() => setParams({ tab, open: l.id })}>
                    {l.name}
                  </button>
                  {l.archived ? <span className="sch-tl-badge">ARCHIVED</span> : null}
                  {l.description && <div className="sch-dim">{l.description}</div>}
                </td>
                <td>
                  {l.slot_count}
                  {l.episode_slots ? <span className="sch-dim"> · {l.episode_slots} episode</span> : null}
                </td>
                <td>
                  {l.about ? "about " : ""}
                  {clock(l.total_ms)}
                  {l.length_ms ? <span className="sch-dim"> of {clock(l.length_ms)}</span> : null}
                </td>
                <td>{l.used_by.length ? `${l.used_by.length} block${l.used_by.length === 1 ? "" : "s"}` : <span className="sch-dim">Not used</span>}</td>
                <td className="sch-lists-actions">
                  <button
                    type="button"
                    className="sch-btn sch-btn-sm"
                    onClick={async () => {
                      try {
                        const r = await contentApi.duplicateList(l.id);
                        load();
                        setParams({ tab, open: r.list.id });
                        setToast({ message: `Duplicated as ${r.list.name}`, tone: "info" });
                      } catch (e) {
                        setToast({ message: friendly(e), tone: "error" });
                      }
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="sch-btn sch-btn-sm"
                    onClick={async () => {
                      try {
                        await contentApi.saveList(l.id, { archived: !l.archived });
                        load();
                        setToast({ message: l.archived ? `${l.name} is back` : `Archived ${l.name}: it can't be chosen for new blocks; blocks using it keep working.`, tone: "info" });
                      } catch (e) {
                        setToast({ message: friendly(e), tone: "error" });
                      }
                    }}
                  >
                    {l.archived ? "Restore" : "Archive"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {openId && (
          <ListEditor
            key={openId}
            id={openId}
            onClose={() => setParams({ tab })}
            onSaved={(msg) => {
              load();
              setToast({ message: msg, tone: "info" });
            }}
            onError={(e) => setToast({ message: friendly(e), tone: "error" })}
          />
        )}
      </div>
      <Toast toast={toast} onUndo={() => {}} onClose={() => setToast(null)} />
    </div>
  );
}

function ListEditor({ id, onClose, onSaved, onError }: { id: string; onClose: () => void; onSaved: (msg: string) => void; onError: (e: unknown) => void }) {
  const [data, setData] = useState<ListDetail | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [lengthMin, setLengthMin] = useState(60);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [episodeFor, setEpisodeFor] = useState<string>("");
  const [episodeMsg, setEpisodeMsg] = useState<{ text: string; link: string } | null>(null);

  const take = (d: ListDetail) => {
    setData(d);
    setRows(rowsFromViews(d.list.slots));
    setName(d.list.name);
    setDescription(d.list.description ?? "");
    setLengthMin(Math.round((d.list.length_ms ?? 3_600_000) / 60_000));
    setDirty(false);
  };
  useEffect(() => {
    contentApi.list(id).then(take).catch((e) => setErr(friendly(e)));
    // Tags for rule slots come with the Timeline's board.
    const now = Date.now();
    planApi
      .board(now, now + 3_600_000, "draft", "__none__")
      .then((b) => setTags(b.tags))
      .catch(() => {});
  }, [id]);

  if (!data) return <aside className="sch-card sch-lists-editor">{err ? <p className="sch-error">{err}</p> : <p className="sch-dim">Loading…</p>}</aside>;
  const isTemplate = data.list.kind === "template";
  const { end } = timings(rows);
  const target = isTemplate ? lengthMin * 60_000 : null;
  const touch = () => setDirty(true);
  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await contentApi.saveList(id, {
        name,
        description,
        length_ms: isTemplate ? lengthMin * 60_000 : null,
        slots: rowsToInputs(rows),
        expected_updated_at_ms: data.list.updated_at_ms,
      });
      take({ ...data, list: r.list, used_by: r.used_by });
      const channels = [...new Set(r.used_by.map((u) => u.channel_name))];
      onSaved(
        channels.length
          ? `${isTemplate ? "Template" : "Playlist"} ${r.list.name} saved: a draft change on ${channels.join(", ")}. Publish from the Timeline to put it on air.`
          : `${isTemplate ? "Template" : "Playlist"} ${r.list.name} saved.`
      );
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) contentApi.list(id).then(take).catch(() => {});
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };
  const templateBlocks = data.used_by;

  return (
    <aside className="sch-card sch-lists-editor" aria-labelledby="sch-list-h">
      <header>
        <p className="sch-eyebrow">{isTemplate ? "Template" : "Playlist"}</p>
        <button type="button" className="sch-icon-btn" onClick={() => (!dirty || window.confirm("Close without saving?")) && onClose()} aria-label="Close">
          ×
        </button>
      </header>
      <h2 id="sch-list-h" className="sch-h3">
        {data.list.name}
      </h2>
      <div className="sch-form">
        <label className="sch-field">
          <span className="sch-label">Name</span>
          <input className="sch-input" value={name} maxLength={60} onChange={(e) => (setName(e.target.value), touch())} />
        </label>
        <label className="sch-field">
          <span className="sch-label">Description (for you; listeners don't see it)</span>
          <input className="sch-input" value={description} maxLength={200} onChange={(e) => (setDescription(e.target.value), touch())} />
        </label>
        {isTemplate && (
          <label className="sch-field sch-tl-inline">
            <span className="sch-label">The show's length (minutes)</span>
            <input className="sch-input sch-lists-len" type="number" min={5} max={720} step={5} value={lengthMin} onChange={(e) => (setLengthMin(Number(e.target.value) || 60), touch())} />
          </label>
        )}
      </div>
      {target && (
        <div className={`sch-tl-dur is-${end > target + 20_000 ? "red" : end < target - 60_000 ? "amber" : "green"}`}>
          <span>
            <i style={{ width: `${Math.min(100, (end / target) * 100)}%` }} />
          </span>
          <p>
            {rows.some((r) => r.slot_kind === "rule") ? "About " : ""}
            {clock(end)} of {clock(target)}
            {end < target - 60_000 ? `: ${clock(target - end)} left for songs from the block's pool` : end > target + 20_000 ? `: ${clock(end - target)} too long, songs will be dropped to fit` : ""}
            {rows.some((r) => r.slot_kind === "episode") ? " (episode slots count once filled)" : ""}
          </p>
        </div>
      )}
      {!target && (
        <p className="sch-dim">
          {rows.length} item{rows.length === 1 ? "" : "s"} · {rows.some((r) => r.slot_kind === "rule") ? "about " : ""}
          {clock(end)}
        </p>
      )}
      <SlotEditor
        rows={rows}
        onChange={(r) => {
          setRows(r);
          touch();
        }}
        editable
        allowAt={isTemplate}
        allowEpisode={isTemplate}
        tags={tags}
        linkKinds={data.link_kinds}
      />
      {err && (
        <p className="sch-error" role="alert">
          {err}
        </p>
      )}
      <div className="sch-tl-panel-actions">
        <button type="button" className="sch-btn sch-btn-red" disabled={!dirty || busy} onClick={() => void save()}>
          Save
        </button>
        <button type="button" className="sch-btn" disabled={!dirty || busy} onClick={() => take(data)}>
          Undo changes
        </button>
      </div>
      <h3 className="sch-h3 sch-lists-sub">Used by</h3>
      {data.used_by.length ? (
        <ul className="sch-lists-used">
          {data.used_by.map((u) => (
            <li key={u.block_id}>
              {u.block_name} <span className="sch-dim">on {u.channel_name}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="sch-dim">No block uses it yet. Choose it in a block's "Fill with" on the Timeline.</p>
      )}
      {isTemplate && templateBlocks.length > 0 && (
        <div className="sch-lists-episode">
          <h3 className="sch-h3 sch-lists-sub">Create next episode</h3>
          <div className="sch-ro-start-row">
            {templateBlocks.length > 1 && (
              <select className="sch-input" value={episodeFor} onChange={(e) => setEpisodeFor(e.target.value)} aria-label="For which block">
                <option value="">Which block?</option>
                {templateBlocks.map((u) => (
                  <option key={u.block_id} value={u.block_id}>
                    {u.block_name} ({u.channel_name})
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="sch-btn"
              disabled={dirty || (templateBlocks.length > 1 && !episodeFor)}
              title={dirty ? "Save the template first" : undefined}
              onClick={async () => {
                const blockId = templateBlocks.length === 1 ? templateBlocks[0].block_id : episodeFor;
                try {
                  const r = await contentApi.nextEpisode(blockId);
                  setEpisodeMsg({ text: `Created the ${r.block.name} episode for ${r.date_label}. Fill its empty slots on the Timeline.`, link: `/studio/scheduler/timeline?date=${r.date}` });
                } catch (e) {
                  onError(e);
                }
              }}
            >
              Create next episode
            </button>
          </div>
          {episodeMsg && (
            <p className="sch-ok" role="status">
              {episodeMsg.text} <Link to={episodeMsg.link}>Open the Timeline</Link>
            </p>
          )}
        </div>
      )}
    </aside>
  );
}
