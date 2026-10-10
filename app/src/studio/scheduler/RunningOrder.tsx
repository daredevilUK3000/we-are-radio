import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../../api/client";
import { contentApi, friendly, planApi, type Board, type ChannelDraft, type OccurrenceView, type PlanBlock, type RunningOrderView } from "./api";
import { clock, hm, hms, Modal } from "./common";
import { LibrarySearch } from "./LibraryPicker";
import { bodyFor, draftFromBlock } from "./PlanEditor";
import { rowFromLibrary, rowsFromViews, rowsToInputs, SlotEditor, timings, type Row } from "./SlotEditor";

/**
 * One airing's running order (Release 2, §6): the hour zoom strip on top
 * (items as they'd air, the safety net hatched), the duration bar with its
 * fixes, and the item list - editable for a manual block or a template
 * block's episode, read-only otherwise. Saving changes only the draft.
 */

const STRIP_CLASS: Record<string, string> = { song: "is-song", link: "is-link", feature: "is-feature", interview: "is-feature", station_id: "is-jingle", promo: "is-promo" };

export function HourStrip({ occ, nowMs }: { occ: OccurrenceView; nowMs: number }) {
  const span = occ.end_ms - occ.start_ms;
  const pct = (ms: number) => `${Math.max(0, Math.min(100, ((ms - occ.start_ms) / span) * 100))}%`;
  const ticks: number[] = [];
  for (let t = Math.ceil(occ.start_ms / 600_000) * 600_000; t <= occ.end_ms; t += 600_000) ticks.push(t);
  const filler = occ.items.filter((i) => i.filler && i.in_block);
  return (
    <div className="sch-hourstrip" aria-label={`Hour view: ${occ.items.length} items`}>
      <div className="sch-hourstrip-bar">
        {occ.items
          .filter((i) => i.ends_at_ms > occ.start_ms && i.starts_at_ms < occ.end_ms)
          .map((i, n) => (
            <span
              key={n}
              className={`sch-hourstrip-item ${STRIP_CLASS[i.type] ?? "is-song"}${i.filler ? " is-filler" : ""}${i.fixed ? " is-fixed" : ""}`}
              style={{ left: pct(i.starts_at_ms), width: `calc(${pct(i.ends_at_ms)} - ${pct(i.starts_at_ms)})` }}
              title={`${hms(i.starts_at_ms)} ${i.label ?? ""}${i.filler ? " (safety net / top-up)" : ""}${i.reason ? `\n${i.reason}` : ""}`}
            >
              <span>{i.label}</span>
            </span>
          ))}
        {nowMs > occ.start_ms && nowMs < occ.end_ms && <i className="sch-hourstrip-now" style={{ left: pct(nowMs) }} aria-hidden="true" />}
      </div>
      <div className="sch-hourstrip-ticks" aria-hidden="true">
        {ticks.map((t) => (
          <span key={t} style={{ left: pct(t) }}>
            {hm(t)}
          </span>
        ))}
      </div>
      {filler.length > 0 && occ.block.fill_kind === "manual" && (
        <p className="sch-dim sch-hourstrip-note">
          <span className="sch-hourstrip-swatch is-filler" /> {clock(occ.filler_ms)} filled by the safety net (the channel's own music)
        </p>
      )}
      <p className="sch-dim sch-hourstrip-note">{occ.from === "log" ? "As in the published log." : "Built from the plan now; the log may pick different songs for rule slots and top-ups."}</p>
    </div>
  );
}

export function RunningOrderDialog({
  board,
  block,
  channel,
  date,
  mode,
  editable: canEdit,
  onClose,
  onChanged,
}: {
  board: Board;
  block: PlanBlock;
  channel: string;
  date: string;
  mode: "draft" | "live";
  editable: boolean;
  onClose: () => void;
  onChanged: (message: string, drafts?: Record<string, ChannelDraft>) => void;
}) {
  const [data, setData] = useState<RunningOrderView | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dirty, setDirty] = useState(false);
  const [occ, setOcc] = useState<OccurrenceView | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [tplChoice, setTplChoice] = useState("");
  const [showLib, setShowLib] = useState(false);

  const take = (v: RunningOrderView) => {
    setData(v);
    setRows(rowsFromViews(v.items));
    setDirty(false);
  };
  const loadOcc = useCallback(() => {
    contentApi
      .occurrence(block.id, date, mode)
      .then(setOcc)
      .catch(() => setOcc(null));
  }, [block.id, date, mode]);
  useEffect(() => {
    contentApi.runningOrder(block.id, date).then(take).catch((e) => setErr(friendly(e)));
    loadOcc();
  }, [block.id, date, loadOcc]);

  const run = async (fn: () => Promise<RunningOrderView>, done?: (v: RunningOrderView) => string) => {
    setBusy(true);
    setErr(null);
    try {
      const v = await fn();
      take(v);
      loadOcc();
      const msg = v.message ?? done?.(v) ?? null;
      setNote(msg);
      onChanged(msg ?? `Saved the running order for ${v.date_label} to the draft`, v.drafts);
    } catch (e) {
      // Someone else saved it: show theirs.
      if (e instanceof ApiError && e.status === 409) contentApi.runningOrder(block.id, date).then(take).catch(() => {});
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    run(() => contentApi.saveRunningOrder(block.id, date, { items: rowsToInputs(rows), expected_updated_at_ms: data?.running_order?.updated_at_ms ?? null }), (v) => `Saved ${v.block.name}, ${v.date_label} to the draft. Publish to put it on air.`);

  const editable = canEdit && mode === "draft" && !!data?.editable;
  const length = data?.length_ms ?? 0;
  const { end } = timings(rows);
  const over = end - length;
  const tone = over > 20_000 ? "red" : over < -60_000 ? "amber" : "green";
  const pct = length ? Math.min(100, (end / length) * 100) : 0;
  const hasAuto = rows.some((r) => r.auto_filled || r.slot_kind === "rule");
  const emptyEpisodes = rows.filter((r) => r.slot_kind === "episode").length;

  /** Trim auto-filled songs (§6.3): auto and rule items go, closest to the end first, until it fits. */
  const trim = () => {
    const next = [...rows];
    for (let k = next.length - 1; k >= 0 && timings(next).end > length; k--) {
      if (next[k].auto_filled || next[k].slot_kind === "rule") next.splice(k, 1);
    }
    setRows(next);
    setDirty(true);
  };
  const letItRunOver = async () => {
    setBusy(true);
    try {
      const res = await planApi.update(block.id, { ...bodyFor(draftFromBlock(block, channel)), end_mode: "flexible", scope: block.recurrence === "once" ? "all" : "occurrence", date });
      onChanged(`${block.name} on ${data?.date_label} now ends flexibly: its last item plays out (in the draft)`, res.drafts);
      setNote("This airing now ends flexibly. The next block starts when it finishes.");
    } catch (e) {
      setErr(friendly(e));
    } finally {
      setBusy(false);
    }
  };

  const kindWord = block.fill_kind === "template" ? "episode" : "running order";
  const title = data ? `${block.fill_kind === "template" ? "Episode" : "Running order"} · ${block.name} · ${data.date_label}${data.start_ms ? ` ${hm(data.start_ms)}–${hm(data.end_ms!)}` : ""}` : "Running order";

  return (
    <Modal
      title={title}
      onClose={() => {
        if (dirty && !window.confirm("Close without saving your changes to this running order?")) return;
        onClose();
      }}
      wide
      footer={
        editable ? (
          <>
            <span className="sch-dim sch-tl-foot-note">{dirty ? "Unsaved changes." : "Saved to the draft. Nothing changes on air until you publish."}</span>
            <span className="sch-spacer" />
            {data?.running_order && (
              <button
                type="button"
                className="sch-btn"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(block.fill_kind === "template" ? "Remove this episode? The airing goes back to the template as it stands." : "Remove this running order? The safety net fills the whole block."))
                    void run(() => contentApi.deleteRunningOrder(block.id, date), () => `Removed the ${kindWord} for ${data.date_label} (in the draft)`);
                }}
              >
                Remove {kindWord}
              </button>
            )}
            <button type="button" className="sch-btn" disabled={!dirty || busy} onClick={() => data && take(data)}>
              Undo changes
            </button>
            <button type="button" className="sch-btn sch-btn-red" disabled={!dirty || busy} onClick={() => void save()}>
              Save to draft
            </button>
          </>
        ) : undefined
      }
    >
      {!data ? (
        err ? <p className="sch-error">{err}</p> : <p className="sch-dim">Loading…</p>
      ) : (
        <div className={`sch-ro${showLib && editable ? " has-lib" : ""}`}>
          <div className="sch-ro-main">
            <p className="sch-eyebrow">
              HOUR VIEW · {data.channel.name.toUpperCase()} · {data.start_ms ? `${hm(data.start_ms)}–${hm(data.end_ms!)}` : ""}
            </p>
            {occ ? <HourStrip occ={occ} nowMs={Date.now()} /> : <p className="sch-dim">Building the hour view…</p>}
            {occ?.hint && <p className="sch-dim">{occ.hint}</p>}

            <div className={`sch-tl-dur is-${tone}`}>
              <span>
                <i style={{ width: `${pct}%` }} />
              </span>
              <p>
                {clock(end)} of {clock(length)}
                {data.about || rows.some((r) => r.slot_kind === "rule") ? " (about: rule slots count at an average length)" : ""} ·{" "}
                {over > 20_000 ? `${clock(over)} over` : over < -20_000 ? `${clock(-over)} unfilled` : "fits"}
              </p>
            </div>
            {editable && (
              <div className="sch-ro-fixes">
                {over < -20_000 && (
                  <>
                    <button type="button" className="sch-btn sch-btn-sm" disabled={busy || dirty || !data.running_order} title={dirty ? "Save first" : undefined} onClick={() => void run(() => contentApi.autoFill(block.id, date))}>
                      Auto-fill {clock(-over)}
                    </button>
                    <span className="sch-dim">or leave it: {block.fill_kind === "manual" ? "the safety net fills it with the channel's own music" : "the block's songs fill it"}.</span>
                  </>
                )}
                {over > 20_000 && (
                  <>
                    {hasAuto && (
                      <button type="button" className="sch-btn sch-btn-sm" onClick={trim}>
                        Trim auto-filled songs
                      </button>
                    )}
                    <span className="sch-dim">Otherwise the last item fades at {data.end_ms ? hm(data.end_ms) : "the end"} to keep the next start on time.</span>
                    {data.next_flexible && block.end_mode !== "flexible" && (
                      <button type="button" className="sch-btn sch-btn-sm" disabled={busy} onClick={() => void letItRunOver()}>
                        Let it run over
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {data.issues.length > 0 && (
              <ul className="sch-tl-issues">
                {data.issues.map((i, n) => (
                  <li key={n} className={`is-${i.level}`}>
                    <span>{i.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {note && <p className="sch-ok" role="status">{note}</p>}
            {err && (
              <p className="sch-error" role="alert">
                {err}
              </p>
            )}

            {!data.running_order && (block.fill_kind === "template" || block.fill_kind === "manual") && (
              <div className="sch-ro-start">
                {block.fill_kind === "template" ? (
                  <>
                    <p>
                      This airing plays the template <strong>{data.list?.name ?? "(none chosen)"}</strong> as it stands
                      {emptyEpisodes ? `, leaving out its ${emptyEpisodes} empty episode slot${emptyEpisodes === 1 ? "" : "s"}` : ""}. Create an episode to fill them for {data.date_label}.
                    </p>
                    {canEdit && mode === "draft" && (
                      <button type="button" className="sch-btn sch-btn-red" disabled={busy || !data.list} onClick={() => void run(() => contentApi.fromTemplate(block.id, date), (v) => `Created the ${v.block.name} episode for ${v.date_label} (in the draft)`)}>
                        Create episode for {data.date_label}
                      </button>
                    )}
                  </>
                ) : (
                  <>
                    <p>No running order yet for {data.date_label}: the safety net fills the whole block with the channel's own music.</p>
                    {canEdit && mode === "draft" && (
                      <div className="sch-ro-start-row">
                        <button type="button" className="sch-btn sch-btn-red" disabled={busy} onClick={() => void run(() => contentApi.fromTemplate(block.id, date), (v) => `Started the running order for ${v.date_label} (in the draft)`)}>
                          Start building it
                        </button>
                        <span className="sch-dim">or start from a template:</span>
                        <select className="sch-input" value={tplChoice} onChange={(e) => setTplChoice(e.target.value)} aria-label="Template">
                          <option value="">Choose…</option>
                          {(board.lists ?? [])
                            .filter((l) => l.kind === "template" && !l.archived)
                            .map((l) => (
                              <option key={l.id} value={l.id}>
                                {l.name}
                              </option>
                            ))}
                        </select>
                        <button type="button" className="sch-btn" disabled={!tplChoice || busy} onClick={() => void run(() => contentApi.fromTemplate(block.id, date, tplChoice))}>
                          Use it
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {(data.running_order || block.fill_kind === "playlist" || (block.fill_kind === "template" && rows.length > 0)) && (
              <>
                <div className="sch-ro-listhead">
                  <h3 className="sch-h3">
                    {data.running_order ? (block.fill_kind === "template" ? `Episode for ${data.date_label}` : `Running order for ${data.date_label}`) : data.list ? `${data.list.kind === "template" ? "Template" : "Playlist"}: ${data.list.name}` : "Items"}
                  </h3>
                  {editable && (
                    <button type="button" className="sch-btn sch-btn-sm" onClick={() => setShowLib((x) => !x)} aria-pressed={showLib}>
                      {showLib ? "Hide library" : "Library"}
                    </button>
                  )}
                </div>
                {!editable && data.source !== "running_order" && <p className="sch-dim">Edit it on the Playlists & templates page. Changes there apply to every block using it.</p>}
                <SlotEditor
                  rows={rows}
                  onChange={(r) => {
                    setRows(r);
                    setDirty(true);
                  }}
                  editable={editable}
                  allowAt={block.fill_kind !== "playlist"}
                  allowEpisode={false}
                  tags={board.tags}
                  channelSlug={channel}
                  startMs={data.start_ms}
                  clockLabel={hms}
                  highlightEmpty
                />
              </>
            )}
          </div>
          {showLib && editable && (
            <aside className="sch-ro-lib" aria-label="Library">
              <LibrarySearch
                channelSlug={channel}
                actionLabel="Add"
                types={[
                  { key: "songs", label: "Songs" },
                  { key: "features", label: "Features & interviews" },
                  { key: "links", label: "Links" },
                  { key: "ids", label: "IDs & jingles" },
                  { key: "promos", label: "Promos" },
                ]}
                onPick={(item) => {
                  setRows((r) => [...r, rowFromLibrary(item)]);
                  setDirty(true);
                }}
              />
              <p className="sch-dim">Drag an item to where it should go in the list.</p>
            </aside>
          )}
        </div>
      )}
    </Modal>
  );
}
