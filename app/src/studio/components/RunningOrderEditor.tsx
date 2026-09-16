import { useState } from "react";

export interface RunningOrderItem {
  key: string; // client-side only, for React keys / drag tracking
  item_type: "song" | "link" | "station_id" | "feature" | "interview";
  track_id?: string | null;
  audio_asset_id?: string | null;
  label: string;
  duration_seconds: number;
}

function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function RunningOrderEditor({
  items,
  onChange,
}: {
  items: RunningOrderItem[];
  onChange: (items: RunningOrderItem[]) => void;
}) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const totalDuration = items.reduce((sum, i) => sum + i.duration_seconds, 0);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const remove = (index: number) => onChange(items.filter((_, i) => i !== index));

  const duplicate = (index: number) => {
    const item = items[index];
    const next = [...items];
    next.splice(index + 1, 0, { ...item, key: `${item.key}-copy-${Date.now()}` });
    onChange(next);
  };

  return (
    <div>
      <div style={{ marginBottom: 12, color: "var(--text-dim)" }}>
        Total duration: <strong style={{ color: "var(--text)" }}>{formatDuration(totalDuration)}</strong>
      </div>

      {items.map((item, index) => (
        <div
          key={item.key}
          className={`running-order-item${draggingIndex === index ? " dragging" : ""}`}
          draggable
          onDragStart={() => setDraggingIndex(index)}
          onDragEnd={() => setDraggingIndex(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (draggingIndex === null || draggingIndex === index) return;
            move(draggingIndex, index);
            setDraggingIndex(null);
          }}
        >
          <span aria-hidden>⠿</span>
          <span className="badge">{item.item_type}</span>
          <span style={{ flex: 1 }}>{item.label}</span>
          <span style={{ color: "var(--text-dim)", fontSize: "0.8rem" }}>
            {formatDuration(item.duration_seconds)}
          </span>
          <button className="btn" onClick={() => move(index, index - 1)} disabled={index === 0}>
            ↑
          </button>
          <button className="btn" onClick={() => move(index, index + 1)} disabled={index === items.length - 1}>
            ↓
          </button>
          <button className="btn" onClick={() => duplicate(index)}>
            Duplicate
          </button>
          <button className="btn" onClick={() => remove(index)}>
            Remove
          </button>
        </div>
      ))}

      {items.length === 0 && <p style={{ color: "var(--text-dim)" }}>No items yet - add a song or spoken link below.</p>}
    </div>
  );
}
