import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi, mediaUrl, uploadFileToR2 } from "../../api/client";
import { readDuration } from "../lib/bulkImport";

/**
 * Time Capsules: requests from listeners for a message to go out on a date.
 * A request comes in "requested"; Kizzi records (or uploads) the message,
 * which makes it "recorded"; scheduling it lets it air on its date. On the day,
 * the radio drops it into the live channels like a station ID, and once the
 * day has passed it becomes "aired".
 */

type Status = "requested" | "recorded" | "scheduled" | "aired" | "cancelled";

interface Capsule {
  id: string;
  audio_asset_id: string | null;
  requester_name: string;
  recipient_name: string;
  occasion_label: string;
  message_note: string;
  notify_email: string | null;
  scheduled_date: string;
  status: Status;
  audio_url: string | null;
  duration_seconds: number | null;
}

const STATUS_LABEL: Record<Status, string> = {
  requested: "Needs recording",
  recorded: "Recorded",
  scheduled: "Scheduled",
  aired: "Aired",
  cancelled: "Cancelled",
};

const STATUS_COLOUR: Record<Status, string> = {
  requested: "#f0a12a",
  recorded: "#3b8bf0",
  scheduled: "#2fb86a",
  aired: "#7a7a84",
  cancelled: "#5a5a63",
};

const ACTIVE: Status[] = ["requested", "recorded", "scheduled"];

const dayMs = 86400000;
const asDate = (iso: string) => new Date(`${iso}T12:00:00Z`);
const daysBetween = (fromIso: string, toIso: string) => Math.round((asDate(toIso).getTime() - asDate(fromIso).getTime()) / dayMs);
const prettyDate = (iso: string) =>
  asDate(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function when(iso: string, today: string): string {
  const d = daysBetween(today, iso);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d > 1) return `in ${d} days`;
  if (d === -1) return "yesterday";
  return `${-d} days ago`;
}

function StatusBadge({ status }: { status: Status }) {
  return (
    <span className="badge" style={{ color: STATUS_COLOUR[status], borderColor: STATUS_COLOUR[status] }}>
      {STATUS_LABEL[status]}
    </span>
  );
}

// ------------------------------------------------------------------ calendar

function Calendar({
  capsules,
  today,
  month,
  setMonth,
  selected,
  onSelect,
}: {
  capsules: Capsule[];
  today: string;
  month: string; // YYYY-MM
  setMonth: (m: string) => void;
  selected: string | null;
  onSelect: (date: string | null) => void;
}) {
  const [year, mon] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, mon - 1, 1, 12));
  const daysInMonth = new Date(Date.UTC(year, mon, 0, 12)).getUTCDate();
  const offset = (first.getUTCDay() + 6) % 7; // Monday first

  const byDate = useMemo(() => {
    const map = new Map<string, Capsule[]>();
    for (const c of capsules) {
      if (c.status === "cancelled") continue;
      map.set(c.scheduled_date, [...(map.get(c.scheduled_date) ?? []), c]);
    }
    return map;
  }, [capsules]);

  const shift = (delta: number) => {
    const d = new Date(Date.UTC(year, mon - 1 + delta, 1, 12));
    setMonth(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  };

  const cells: (string | null)[] = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];

  return (
    <div className="card tcal">
      <div className="tcal-head">
        <button className="btn" onClick={() => shift(-1)} aria-label="Previous month">
          ‹
        </button>
        <strong>{first.toLocaleDateString(undefined, { month: "long", year: "numeric", timeZone: "UTC" })}</strong>
        <button className="btn" onClick={() => shift(1)} aria-label="Next month">
          ›
        </button>
        <button className="btn" onClick={() => setMonth(today.slice(0, 7))}>
          Today
        </button>
        <span style={{ flex: 1 }} />
        {selected && (
          <button className="btn" onClick={() => onSelect(null)}>
            Showing {prettyDate(selected)} - show all
          </button>
        )}
      </div>
      <div className="tcal-grid">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d} className="tcal-dow">
            {d}
          </div>
        ))}
        {cells.map((date, i) => {
          if (!date) return <div key={`b${i}`} className="tcal-cell tcal-blank" />;
          const list = byDate.get(date) ?? [];
          return (
            <button
              key={date}
              className={`tcal-cell${date === today ? " today" : ""}${date === selected ? " selected" : ""}${list.length ? " has" : ""}`}
              onClick={() => onSelect(date === selected ? null : date)}
              title={list.length ? list.map((c) => `${c.occasion_label} (${STATUS_LABEL[c.status]})`).join("\n") : undefined}
            >
              <span className="tcal-day">{Number(date.slice(8))}</span>
              {list.slice(0, 3).map((c) => (
                <span key={c.id} className="tcal-chip" style={{ background: STATUS_COLOUR[c.status] }}>
                  {c.recipient_name || c.occasion_label}
                </span>
              ))}
              {list.length > 3 && <span className="tcal-more">+{list.length - 3} more</span>}
            </button>
          );
        })}
      </div>
      <div className="tcal-legend">
        {(Object.keys(STATUS_LABEL) as Status[])
          .filter((s) => s !== "cancelled")
          .map((s) => (
            <span key={s}>
              <i style={{ background: STATUS_COLOUR[s] }} /> {STATUS_LABEL[s]}
            </span>
          ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ one request

function Fields({
  value,
  onChange,
}: {
  value: { requester_name: string; recipient_name: string; occasion_label: string; message_note: string; notify_email: string; scheduled_date: string };
  onChange: (next: typeof value) => void;
}) {
  const set = (k: keyof typeof value) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    onChange({ ...value, [k]: e.target.value });
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Occasion (shown on the radio)</label>
          <input value={value.occasion_label} onChange={set("occasion_label")} maxLength={120} />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>For</label>
          <input value={value.recipient_name} onChange={set("recipient_name")} maxLength={80} />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Requested by</label>
          <input value={value.requester_name} onChange={set("requester_name")} maxLength={80} />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Air on</label>
          <input type="date" value={value.scheduled_date} onChange={set("scheduled_date")} />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Email (optional)</label>
          <input type="email" value={value.notify_email} onChange={set("notify_email")} maxLength={254} />
        </div>
      </div>
      <div className="form-row" style={{ marginBottom: 0 }}>
        <label>What they'd like said</label>
        <textarea value={value.message_note} onChange={set("message_note")} rows={3} maxLength={600} />
      </div>
    </div>
  );
}

function CapsuleCard({
  c,
  today,
  onChanged,
  onError,
}: {
  c: Capsule;
  today: string;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState({
    requester_name: c.requester_name,
    recipient_name: c.recipient_name,
    occasion_label: c.occasion_label,
    message_note: c.message_note,
    notify_email: c.notify_email ?? "",
    scheduled_date: c.scheduled_date,
  });

  const patch = async (data: Record<string, unknown>) => {
    setBusy(true);
    try {
      await studioApi.updateTimeCapsule(c.id, data);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "That didn't work - please try again.");
    } finally {
      setBusy(false);
    }
  };

  const uploadRecording = async (file: File) => {
    setBusy(true);
    try {
      const duration = await readDuration(file);
      const presigned = await studioApi.presignUpload(file.name, file.type || "audio/mpeg", "audio");
      await uploadFileToR2(presigned.upload_url, file);
      const { id } = await studioApi.createAudioAsset({
        type: "feature",
        title: `Time capsule - ${c.occasion_label}`.slice(0, 140),
        description: `For ${c.recipient_name}`,
        duration_seconds: duration,
        audio_url: presigned.key,
        status: "published",
      });
      await studioApi.updateTimeCapsule(c.id, { audio_asset_id: id, status: "recorded" });
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Couldn't upload that recording.");
    } finally {
      setBusy(false);
    }
  };

  const overdue = (c.status === "requested" || c.status === "recorded") && c.scheduled_date < today;
  const dueSoon = c.status === "requested" && !overdue && daysBetween(today, c.scheduled_date) <= 7;
  const mailto = c.notify_email
    ? `mailto:${c.notify_email}?subject=${encodeURIComponent(`Your We Are Radio time capsule goes out on ${prettyDate(c.scheduled_date)}`)}&body=${encodeURIComponent(
        `Hi ${c.requester_name},\n\nJust a heads-up: the message for ${c.recipient_name} (${c.occasion_label}) goes out on We Are Radio on ${prettyDate(
          c.scheduled_date
        )}. It will play at some point during the day - tune in at weareradio.app.\n\nKizzi`
      )}`
    : null;

  return (
    <div className="card tc-req" style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong>{prettyDate(c.scheduled_date)}</strong>
        <span style={{ color: overdue ? "var(--accent)" : "var(--text-dim)" }}>
          {when(c.scheduled_date, today)}
          {overdue ? " - date has passed" : ""}
        </span>
        <StatusBadge status={c.status} />
        {dueSoon && <span className="badge" style={{ color: "#f0a12a", borderColor: "#f0a12a" }}>coming up - record soon</span>}
      </div>
      <h3 style={{ margin: "6px 0 2px" }}>{c.occasion_label}</h3>
      <div style={{ color: "var(--text-dim)", fontSize: "0.9rem" }}>
        For <strong style={{ color: "var(--text)" }}>{c.recipient_name || "-"}</strong> · requested by {c.requester_name}
        {c.notify_email && (
          <>
            {" "}
            · <a href={`mailto:${c.notify_email}`}>{c.notify_email}</a>
          </>
        )}
      </div>
      {c.message_note && (
        <blockquote style={{ margin: "8px 0", padding: "6px 12px", borderLeft: "3px solid var(--border)", color: "var(--text-dim)", whiteSpace: "pre-wrap" }}>
          {c.message_note}
        </blockquote>
      )}

      {c.audio_url && (
        <audio controls preload="none" src={mediaUrl(c.audio_url)} style={{ width: "100%", maxWidth: 420, margin: "4px 0 8px" }} />
      )}

      {editing ? (
        <div style={{ marginTop: 8 }}>
          <Fields value={draft} onChange={setDraft} />
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button
              className="btn primary"
              disabled={busy}
              onClick={async () => {
                await patch({ ...draft, notify_email: draft.notify_email.trim() || null });
                setEditing(false);
              }}
            >
              Save changes
            </button>
            <button className="btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          {(c.status === "requested" || c.status === "recorded") && (
            <Link className="btn primary" to={`/studio/record-link?capsule=${c.id}`}>
              ● {c.audio_url ? "Re-record" : "Record now"}
            </Link>
          )}
          {(c.status === "requested" || c.status === "recorded") && (
            <label className="btn" style={{ cursor: busy ? "default" : "pointer" }}>
              Upload a recording
              <input
                type="file"
                accept="audio/*"
                style={{ display: "none" }}
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (file) void uploadRecording(file);
                }}
              />
            </label>
          )}
          {c.status === "recorded" && !overdue && (
            <button className="btn primary" disabled={busy} onClick={() => patch({ status: "scheduled" })}>
              Schedule for {prettyDate(c.scheduled_date)}
            </button>
          )}
          {c.status === "recorded" && overdue && (
            <span style={{ alignSelf: "center", color: "var(--text-dim)", fontSize: "0.85rem" }}>
              That date has passed - use Edit to pick a new date, then schedule it.
            </span>
          )}
          {c.status === "scheduled" && (
            <button className="btn" disabled={busy} onClick={() => patch({ status: "recorded" })}>
              Unschedule
            </button>
          )}
          {(c.status === "requested" || c.status === "recorded" || c.status === "scheduled") && (
            <button className="btn" disabled={busy} onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {mailto && (c.status === "recorded" || c.status === "scheduled") && (
            <a className="btn" href={mailto}>
              Email a heads-up
            </a>
          )}
          {(c.status === "cancelled" || c.status === "aired") && (
            <button className="btn" disabled={busy} onClick={() => patch({ status: c.audio_asset_id ? "recorded" : "requested" })}>
              Reopen
            </button>
          )}
          {c.status !== "cancelled" && c.status !== "aired" && (
            <button className="btn" disabled={busy} onClick={() => patch({ status: "cancelled" })}>
              Cancel request
            </button>
          )}
          <button
            className="btn"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm("Delete this request? This can't be undone.")) return;
              setBusy(true);
              await studioApi.deleteTimeCapsule(c.id).catch(() => onError("Couldn't delete it."));
              setBusy(false);
              onChanged();
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ page

export function TimeCapsules() {
  const [capsules, setCapsules] = useState<Capsule[]>([]);
  const [today, setToday] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [filter, setFilter] = useState<"active" | Status | "all">("active");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [month, setMonth] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newCapsule, setNewCapsule] = useState({
    requester_name: "",
    recipient_name: "",
    occasion_label: "",
    message_note: "",
    notify_email: "",
    scheduled_date: "",
  });

  const load = async () => {
    const r = await studioApi.timeCapsules();
    setCapsules(r.capsules as Capsule[]);
    setToday(r.today);
    setMonth((m) => m || r.today.slice(0, 7));
    setLoaded(true);
  };
  useEffect(() => {
    load().catch(() => setLoaded(true));
  }, []);

  const shown = useMemo(
    () =>
      capsules.filter(
        (c) =>
          (filter === "all" ? true : filter === "active" ? ACTIVE.includes(c.status) : c.status === filter) &&
          (!selectedDate || c.scheduled_date === selectedDate)
      ),
    [capsules, filter, selectedDate]
  );

  const counts = useMemo(() => {
    const n: Record<string, number> = {};
    for (const c of capsules) n[c.status] = (n[c.status] ?? 0) + 1;
    return n;
  }, [capsules]);
  const needAttention = capsules.filter((c) => c.status === "requested" && today && daysBetween(today, c.scheduled_date) <= 14).length;

  const addCapsule = async () => {
    setMessage(null);
    try {
      await studioApi.createTimeCapsule({ ...newCapsule, notify_email: newCapsule.notify_email.trim() || null });
      setAdding(false);
      setNewCapsule({ requester_name: "", recipient_name: "", occasion_label: "", message_note: "", notify_email: "", scheduled_date: "" });
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Couldn't add that.");
    }
  };

  return (
    <div style={{ maxWidth: 980 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Time capsules</h1>
        <button className="btn primary" onClick={() => setAdding((v) => !v)}>
          {adding ? "Close" : "+ Add a capsule"}
        </button>
      </div>
      <p style={{ color: "var(--text-dim)" }}>
        Messages people have asked for, to go out on a date that matters. Record each one (or upload a recording), then
        schedule it: on its date the radio plays it on the live channels, spaced out through the day like a station ID.
        Nothing airs until you've recorded and scheduled it. The public request form is at{" "}
        <a href="/time-capsule" target="_blank" rel="noreferrer">
          weareradio.app/time-capsule
        </a>
        .
      </p>

      {adding && (
        <div className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ marginTop: 0 }}>New capsule</h3>
          <Fields value={newCapsule} onChange={setNewCapsule} />
          <div style={{ marginTop: 10 }}>
            <button className="btn primary" onClick={addCapsule}>
              Add capsule
            </button>
          </div>
        </div>
      )}

      {loaded && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <span className="badge" style={{ color: STATUS_COLOUR.requested, borderColor: STATUS_COLOUR.requested }}>
            {counts.requested ?? 0} need recording
          </span>
          <span className="badge" style={{ color: STATUS_COLOUR.recorded, borderColor: STATUS_COLOUR.recorded }}>
            {counts.recorded ?? 0} recorded, not scheduled
          </span>
          <span className="badge" style={{ color: STATUS_COLOUR.scheduled, borderColor: STATUS_COLOUR.scheduled }}>
            {counts.scheduled ?? 0} scheduled
          </span>
          {needAttention > 0 && (
            <span className="badge" style={{ color: "var(--accent)", borderColor: "var(--accent)" }}>
              {needAttention} unrecorded within 2 weeks
            </span>
          )}
        </div>
      )}

      {today && (
        <Calendar capsules={capsules} today={today} month={month} setMonth={setMonth} selected={selectedDate} onSelect={setSelectedDate} />
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0 10px" }}>
        {(
          [
            ["active", "Active"],
            ["requested", "Needs recording"],
            ["recorded", "Recorded"],
            ["scheduled", "Scheduled"],
            ["aired", "Aired"],
            ["cancelled", "Cancelled"],
            ["all", "All"],
          ] as [typeof filter, string][]
        ).map(([key, label]) => (
          <button key={key} className={`chip${filter === key ? " selected" : ""}`} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
      </div>

      {message && <p style={{ color: "var(--accent)" }}>{message}</p>}

      {shown.map((c) => (
        <CapsuleCard key={c.id} c={c} today={today} onChanged={load} onError={setMessage} />
      ))}
      {loaded && shown.length === 0 && (
        <p style={{ color: "var(--text-dim)" }}>
          {capsules.length === 0
            ? "No requests yet. They'll appear here when someone uses the request form."
            : "Nothing matches that filter."}
        </p>
      )}
    </div>
  );
}
