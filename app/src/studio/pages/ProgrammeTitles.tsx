import { useEffect, useState } from "react";
import { studioApi } from "../../api/client";

/**
 * The bank of names for "Radio That Knows You" programmes. Each listener request
 * gets one, picked by rule from the titles written for the mood they asked for
 * (and, when a title has a time of day, favouring the listener's time of day).
 */

const NEEDS: { key: string; label: string; blurb: string }[] = [
  { key: "energy", label: "⚡ I need energy", blurb: "e.g. Get Up and Go" },
  { key: "love", label: "❤️ I want to fall in love", blurb: "e.g. A Little Love Radio" },
  { key: "switch-off", label: "🌙 I want to switch off", blurb: "e.g. A Little Radio for a Long Day" },
  { key: "fun", label: "🎉 I want to have fun", blurb: "e.g. Friday Night Escape" },
];

const BANDS = [
  { value: "", label: "any time of day" },
  { value: "morning", label: "mornings" },
  { value: "afternoon", label: "afternoons" },
  { value: "evening", label: "evenings" },
  { value: "night", label: "late night" },
];

interface Title {
  id: string;
  need: string;
  title: string;
  time_band: string | null;
}

function TitleRow({ t, onChanged }: { t: Title; onChanged: () => void }) {
  const [text, setText] = useState(t.title);
  useEffect(() => setText(t.title), [t.title]);

  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
      <input
        value={text}
        style={{ flex: 1, minWidth: 220 }}
        aria-label="Programme title"
        onChange={(e) => setText(e.target.value)}
        onBlur={async () => {
          const next = text.trim();
          if (!next) return setText(t.title);
          if (next !== t.title) {
            await studioApi.updateProgrammeTitle(t.id, { title: next });
            onChanged();
          }
        }}
      />
      <select
        value={t.time_band ?? ""}
        aria-label="Time of day"
        onChange={async (e) => {
          await studioApi.updateProgrammeTitle(t.id, { time_band: e.target.value || null });
          onChanged();
        }}
      >
        {BANDS.map((b) => (
          <option key={b.value} value={b.value}>
            {b.label}
          </option>
        ))}
      </select>
      <button
        className="btn"
        onClick={async () => {
          await studioApi.deleteProgrammeTitle(t.id);
          onChanged();
        }}
      >
        Delete
      </button>
    </div>
  );
}

function AddTitle({ need, onAdded }: { need: string; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [band, setBand] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      await studioApi.createProgrammeTitle({ need, title: title.trim(), time_band: band || null });
      setTitle("");
      onAdded();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
      <input
        value={title}
        placeholder="Add a title..."
        style={{ flex: 1, minWidth: 220 }}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      <select value={band} onChange={(e) => setBand(e.target.value)} aria-label="Time of day">
        {BANDS.map((b) => (
          <option key={b.value} value={b.value}>
            {b.label}
          </option>
        ))}
      </select>
      <button className="btn primary" onClick={add} disabled={busy || !title.trim()}>
        Add
      </button>
    </div>
  );
}

export function ProgrammeTitles() {
  const [titles, setTitles] = useState<Title[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = () =>
    studioApi.programmeTitles().then((r) => {
      setTitles(r.titles);
      setLoaded(true);
    });
  useEffect(() => {
    load();
  }, []);

  return (
    <div style={{ maxWidth: 820 }}>
      <h1>Programme titles</h1>
      <p style={{ color: "var(--text-dim)" }}>
        Every "Radio That Knows You" programme gets a name. Write a handful for each mood and one is picked each time -
        if a title is set to a time of day, it's favoured when the listener is listening at that time. The starter titles
        are placeholders: change them to sound like you.
      </p>
      {!loaded && <p style={{ color: "var(--text-dim)" }}>Loading...</p>}
      {NEEDS.map((n) => (
        <div key={n.key} className="card" style={{ marginBottom: 14 }}>
          <h3 style={{ marginTop: 0, marginBottom: 2 }}>{n.label}</h3>
          <small style={{ color: "var(--text-dim)", display: "block", marginBottom: 10 }}>{n.blurb}</small>
          {titles
            .filter((t) => t.need === n.key)
            .map((t) => (
              <TitleRow key={t.id} t={t} onChanged={load} />
            ))}
          {loaded && titles.every((t) => t.need !== n.key) && (
            <p style={{ color: "var(--text-dim)", margin: "0 0 8px" }}>No titles yet - programmes for this mood will just be called "Your Radio".</p>
          )}
          <AddTitle need={n.key} onAdded={load} />
        </div>
      ))}
    </div>
  );
}
