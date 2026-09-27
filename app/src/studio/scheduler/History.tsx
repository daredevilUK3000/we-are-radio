import { useEffect, useRef, useState } from "react";
import { friendly, schedApi, type ActionResult } from "./api";
import { dayHm, hms, Modal } from "./common";

const KIND: Record<string, string> = {
  generate: "Generated",
  extend: "Extended",
  play_now: "Play now",
  skip: "Skip",
  insert_next: "Insert next",
  replace: "Replace",
  insert_jingle: "Insert jingle",
  record_link: "Record a link",
  back_on_schedule: "Back on schedule",
  rollback: "Rollback",
  grid: "Grid change",
};
const ACTOR: Record<string, string> = { studio: "You", generator: "Generator", system: "System" };

/** Every published version, newest first, with "Roll back to this version". */
export function VersionHistory({
  slug,
  canRollBack,
  onClose,
  onRolledBack,
  onError,
}: {
  slug: string;
  canRollBack: boolean;
  onClose: () => void;
  onRolledBack: (r: ActionResult) => void;
  onError: (e: unknown) => void;
}) {
  const [data, setData] = useState<{ versions: any[]; failed: any[]; live_version: number } | null>(null);
  const [confirm, setConfirm] = useState<{ number: number; preview: any | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  useEffect(() => {
    schedApi.versions(slug).then(setData).catch((e) => onErrorRef.current(e));
  }, [slug]);

  const more = () => {
    const last = data?.versions[data.versions.length - 1];
    if (!last) return;
    schedApi.versions(slug, last.number).then((r) => setData((d) => (d ? { ...d, versions: [...d.versions, ...r.versions] } : r)));
  };

  const ask = (number: number) => {
    setConfirm({ number, preview: null });
    schedApi.versionPreview(slug, number).then((p) => setConfirm({ number, preview: p })).catch(() => {});
  };
  const roll = async () => {
    if (!confirm || !data) return;
    setBusy(true);
    try {
      onRolledBack(await schedApi.rollback(slug, confirm.number, data.live_version));
    } catch (err) {
      onError(err);
      setBusy(false);
    }
  };

  if (confirm) {
    return (
      <Modal
        title={`Roll back to v${confirm.number}?`}
        onClose={() => setConfirm(null)}
        footer={
          <>
            <button type="button" className="sch-btn" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button type="button" className="sch-btn sch-btn-red" disabled={busy} onClick={() => void roll()}>
              Roll back
            </button>
          </>
        }
      >
        <p>From the end of what's on air now, the channel plays v{confirm.number}'s plan again, as a new version. The song on air isn't interrupted.</p>
        {!confirm.preview && <p className="sch-dim">Loading what changes…</p>}
        {confirm.preview && !confirm.preview.covers_now && <p className="sch-error">v{confirm.number} doesn't reach this far ahead, so there's nothing to roll back to.</p>}
        {confirm.preview && confirm.preview.covers_now && (
          <div className="sch-compare">
            <div>
              <h3 className="sch-eyebrow">Now</h3>
              <ol>
                {confirm.preview.live.map((i: any) => (
                  <li key={i.starts_at_ms}>
                    <span className="sch-dim">{hms(i.starts_at_ms)}</span> {i.label}
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <h3 className="sch-eyebrow">After rolling back</h3>
              <ol>
                {confirm.preview.rolled_back.map((i: any) => (
                  <li key={i.starts_at_ms}>
                    <span className="sch-dim">{hms(i.starts_at_ms)}</span> {i.label}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </Modal>
    );
  }

  return (
    <Modal title="Version history" onClose={onClose} wide>
      {!data && <p className="sch-dim">Loading…</p>}
      {data && (
        <table className="sch-table">
          <thead>
            <tr>
              <th scope="col">Version</th>
              <th scope="col">When</th>
              <th scope="col">Who</th>
              <th scope="col">What</th>
              <th scope="col">
                <span className="sch-sr">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.versions.map((v) => (
              <tr key={v.id} className={v.number === data.live_version ? "is-live" : undefined}>
                <td>
                  v{v.number}
                  {v.number === data.live_version && <span className="sch-tag is-green">Live</span>}
                </td>
                <td>{dayHm(v.published_at_ms)}</td>
                <td>{ACTOR[v.actor] ?? v.actor}</td>
                <td>
                  <strong>{KIND[v.kind] ?? v.kind}</strong> <span className="sch-dim">{v.summary}</span>
                </td>
                <td>
                  {canRollBack && v.number !== data.live_version && (
                    <button type="button" className="sch-link" onClick={() => ask(v.number)}>
                      Roll back to this version
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && data.versions.length >= 30 && (
        <button type="button" className="sch-btn" onClick={more}>
          Older versions
        </button>
      )}
      {data && data.failed.length > 0 && (
        <>
          <h3 className="sch-eyebrow">Recent builds that failed (never went on air)</h3>
          <ul className="sch-plain">
            {data.failed.map((f) => (
              <li key={f.id}>
                <span className="sch-dim">{dayHm(f.created_at_ms)}</span> {KIND[f.kind] ?? f.kind}: {f.error}
              </li>
            ))}
          </ul>
        </>
      )}
      {!canRollBack && <p className="sch-dim">Rollback works once the Scheduler is on air for this channel.</p>}
    </Modal>
  );
}

/** One airing: what was scheduled, what aired, and every change to it. */
export function AiringHistory({ slug, airingId, label, onClose }: { slug: string; airingId: string; label: string | null; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    schedApi.airingHistory(slug, airingId).then(setData).catch((e) => setError(friendly(e)));
  }, [slug, airingId]);
  const s = data?.scheduled;
  const a = data?.aired;
  const how: Record<string, string> = { completed: "Played to the end", skipped: "Skipped", interrupted: "Interrupted (Play now)" };
  return (
    <Modal title={`History: ${label ?? "an item"}`} onClose={onClose}>
      {error && <p className="sch-error">{error}</p>}
      {!data && !error && <p className="sch-dim">Loading…</p>}
      {data && (
        <ol className="sch-timeline">
          {s && (
            <li>
              <strong>Scheduled</strong> in v{s.number} ({KIND[s.kind] ?? s.kind}) for {hms(s.starts_at_ms)}
              {s.reason_json && <p className="sch-dim">{(JSON.parse(s.reason_json) as string[]).join(" · ")}</p>}
            </li>
          )}
          {data.changes.map((c: any, i: number) => (
            <li key={i}>
              <strong>{dayHm(c.at_ms)}</strong> · {ACTOR[c.actor] ?? c.actor}
              {c.version ? ` · v${c.version}` : ""}: {c.reason}
            </li>
          ))}
          {a ? (
            <li>
              <strong>Aired</strong> {hms(a.starts_at_ms)}
              {a.actual_end_ms ? `–${hms(a.actual_end_ms)}` : " (on air now)"}
              {a.ended_how && ` · ${how[a.ended_how] ?? a.ended_how}`}
            </li>
          ) : (
            <li className="sch-dim">Not aired yet.</li>
          )}
        </ol>
      )}
    </Modal>
  );
}
