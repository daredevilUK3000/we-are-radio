import { useEffect, useState } from "react";
import { studioApi } from "../../api/client";
import { ChannelForm } from "../components/ChannelForm";

export function Channels() {
  const [channels, setChannels] = useState<any[]>([]);
  const [checklists, setChecklists] = useState<Record<string, any>>({});
  // "new", a channel's id (its Edit form), or null.
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => studioApi.channels().then((r) => setChannels(r.channels));
  useEffect(() => {
    load();
  }, []);

  const toggle = async (c: any) => {
    const next = c.status === "live" ? "building" : "live";
    const r = await studioApi.setChannelStatus(c.id, next);
    // Going live also puts it on the Scheduler once it has a log (routes/scheduler.ts enableOnGoLive).
    setMessage(
      next === "building"
        ? `${c.name} is back in building: hidden from listeners.`
        : r.scheduler?.enabled
          ? `${c.name} is live, on the Scheduler.`
          : `${c.name} is live. It isn't on the Scheduler yet (${r.scheduler?.reason ?? "not ready"}), so it plays the old way for now. Put it back in building and press Go live again in a few minutes.`
    );
    load();
  };

  const toggleMode = async (c: any) => {
    const next = c.programming_mode === "autopilot" ? "manual" : "autopilot";
    await studioApi.setChannelProgrammingMode(c.id, next);
    load();
  };

  const showChecklist = async (c: any) => {
    const { checklist } = await studioApi.channelLaunchChecklist(c.id);
    setChecklists((prev) => ({ ...prev, [c.id]: checklist }));
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Channels</h1>
        {editing !== "new" && (
          <button className="btn primary" onClick={() => setEditing("new")}>
            New channel
          </button>
        )}
      </div>
      {message && <p style={{ fontSize: "0.9rem" }}>{message}</p>}
      {editing === "new" && (
        <ChannelForm
          channel={null}
          onCancel={() => setEditing(null)}
          onDone={(m) => {
            setEditing(null);
            setMessage(m);
            load();
          }}
        />
      )}
      {channels.map((c) =>
        editing === c.id ? (
          <ChannelForm
            key={c.id}
            channel={c}
            onCancel={() => setEditing(null)}
            onDone={(m) => {
              setEditing(null);
              setMessage(m);
              load();
            }}
          />
        ) : (
          <div key={c.id} className="card" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <span style={{ marginRight: 8 }}>{c.emoji}</span>
                {c.accent && (
                  <span
                    aria-hidden="true"
                    style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: c.accent, marginRight: 8 }}
                  />
                )}
                <strong>{c.name}</strong>{" "}
                <span className={`badge ${c.status === "live" ? "live" : ""}`}>{c.status}</span>{" "}
                <span className="badge" title="How this channel decides what plays - see the Radio Brain roadmap">
                  {c.programming_mode === "autopilot" ? "autopilot" : "manual"}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="btn" onClick={() => setEditing(c.id)}>
                  Edit
                </button>
                {c.status === "building" && (
                  <button className="btn" onClick={() => showChecklist(c)}>
                    Check readiness
                  </button>
                )}
                <button className="btn" onClick={() => toggleMode(c)}>
                  {c.programming_mode === "autopilot" ? "Switch to manual" : "Switch to autopilot"}
                </button>
                <button className="btn primary" onClick={() => toggle(c)}>
                  {c.status === "live" ? "Set to building" : "Go live"}
                </button>
              </div>
            </div>
            <p style={{ color: "var(--text-dim)", margin: "8px 0 0" }}>{c.description}</p>
            {checklists[c.id] && (
              <ul style={{ fontSize: "0.85rem", color: "var(--text-dim)" }}>
                <li>{checklists[c.id].has_artwork ? "✓" : "○"} Artwork set</li>
                <li>
                  {checklists[c.id].has_matching_tracks ? "✓" : "○"} Matching tracks tagged (
                  {checklists[c.id].matching_track_count})
                </li>
                <li>
                  {checklists[c.id].has_published_spoken_content ? "✓" : "○"} At least one piece of published spoken
                  content
                </li>
              </ul>
            )}
          </div>
        )
      )}
    </div>
  );
}
