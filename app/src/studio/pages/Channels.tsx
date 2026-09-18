import { useEffect, useState } from "react";
import { studioApi } from "../../api/client";

export function Channels() {
  const [channels, setChannels] = useState<any[]>([]);
  const [checklists, setChecklists] = useState<Record<string, any>>({});

  const load = () => studioApi.channels().then((r) => setChannels(r.channels));
  useEffect(() => {
    load();
  }, []);

  const toggle = async (c: any) => {
    const next = c.status === "live" ? "building" : "live";
    await studioApi.setChannelStatus(c.id, next);
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
      <h1>Channels</h1>
      {channels.map((c) => (
        <div key={c.id} className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ marginRight: 8 }}>{c.emoji}</span>
              <strong>{c.name}</strong>{" "}
              <span className={`badge ${c.status === "live" ? "live" : ""}`}>{c.status}</span>{" "}
              <span className="badge" title="How this channel decides what plays - see the Radio Brain roadmap">
                {c.programming_mode === "autopilot" ? "autopilot" : "manual"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
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
      ))}
    </div>
  );
}
