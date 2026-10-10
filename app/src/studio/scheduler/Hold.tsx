import { useEffect, useState } from "react";
import { contentApi, friendly, type ActionResult, type HoldPreview } from "./api";
import { Modal } from "./common";

/**
 * Hold (Release 2, §8): play N more minutes of what's on now. Each hard start
 * from now to the end of today is listed, unticked: tick the ones that should
 * move N minutes later. The list stops at the first one left unticked (or a
 * High priority one, which Hold can never move); the schedule catches up
 * before it. The move is for this airing only.
 */
export function HoldDialog({ slug, name, onClose, onDone, onError }: { slug: string; name: string; onClose: () => void; onDone: (r: ActionResult) => void; onError: (e: unknown) => void }) {
  const [minutes, setMinutes] = useState(10);
  const [data, setData] = useState<HoldPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setData(null);
    contentApi
      .holdPreview(slug, minutes)
      .then((d) => {
        setData(d);
        setErr(null);
      })
      .catch((e) => setErr(friendly(e)));
  }, [slug, minutes]);

  const starts = data?.starts ?? [];
  // What actually moves: ticked ones, in order, up to the first unticked or High one.
  const moving: string[] = [];
  let stop: (typeof starts)[number] | null = null;
  for (const s of starts) {
    if (s.high || !ticked.has(s.key)) {
      stop = s;
      break;
    }
    moving.push(s.key);
  }
  const toggle = (key: string) =>
    setTicked((t) => {
      const n = new Set(t);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const hold = async () => {
    if (!data) return;
    setBusy(true);
    try {
      onDone(await contentApi.hold(slug, { minutes, move: moving, expected_version: data.live_version }));
    } catch (e) {
      setErr(friendly(e));
      onError(e);
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Hold ${name}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="sch-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="sch-btn sch-btn-red" disabled={!data || busy} onClick={() => void hold()}>
            Hold {minutes} minutes
          </button>
        </>
      }
    >
      <div className="sch-hold">
        <fieldset className="sch-field">
          <legend className="sch-label">Hold the schedule for</legend>
          <div className="sch-seg" role="radiogroup" aria-label="Minutes">
            {[5, 10, 15, 30].map((m) => (
              <button key={m} type="button" role="radio" aria-checked={minutes === m} className={minutes === m ? "is-on" : ""} onClick={() => setMinutes(m)}>
                {m} minutes
              </button>
            ))}
          </div>
        </fieldset>
        <p className="sch-dim">After the item on air now, {name} plays {minutes} more minutes of what's on. Then the schedule catches up, dropping a few songs if it must.</p>
        {err && (
          <p className="sch-error" role="alert">
            {err}
          </p>
        )}
        {!data && !err && <p className="sch-dim">Looking at today's schedule…</p>}
        {data && starts.length === 0 && <p className="sch-dim">No hard starts for the rest of today: it catches up at the next top of the hour.</p>}
        {starts.length > 0 && (
          <ul className="sch-hold-list">
            {starts.map((s) => {
              const reachable = moving.includes(s.key) || s === stop || !stop;
              return (
                <li key={s.key} className={`${s.high ? "is-high" : ""}${!reachable ? " is-after" : ""}`}>
                  <label className="sch-check">
                    <input type="checkbox" checked={!s.high && ticked.has(s.key)} disabled={s.high || !reachable} onChange={() => toggle(s.key)} />
                    {s.high ? (
                      <span>
                        <strong>{s.name}</strong> at {s.time} <span className="sch-dim">· 📌 High priority: Hold can't move it</span>
                      </span>
                    ) : (
                      <span>
                        <strong>{s.name}</strong> will start at <strong>{s.new_time}</strong> instead of {s.time}. Move it?
                      </span>
                    )}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        {data && (
          <p className="sch-hold-sum" role="status">
            {stop
              ? `The schedule catches up by ${stop.time} (${stop.name} keeps its time).`
              : moving.length
                ? `${moving.length === 1 ? "That start moves" : "Those starts move"} ${minutes} minutes later; it catches up after them.`
                : "It catches up at the next top of the hour."}
            {moving.length > 0 && " Moves are for today's airing only: next time they're back at their usual time."}
          </p>
        )}
      </div>
    </Modal>
  );
}
