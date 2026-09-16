import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { studioApi } from "../../api/client";
import { RunningOrderEditor, type RunningOrderItem } from "../components/RunningOrderEditor";

let keyCounter = 0;
const nextKey = () => `item-${keyCounter++}`;

export function ProgrammeBuilder() {
  const { id } = useParams();
  const [programme, setProgramme] = useState<any>(null);
  const [items, setItems] = useState<RunningOrderItem[]>([]);
  const [tracks, setTracks] = useState<any[]>([]);
  const [audioAssets, setAudioAssets] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [aiBrief, setAiBrief] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    const [p, t, a] = await Promise.all([
      studioApi.programme(id),
      studioApi.tracks(),
      studioApi.audioAssets(),
    ]);
    setProgramme(p.programme);
    setTracks(t.tracks);
    setAudioAssets(a.audio_assets);
    setItems(
      p.items.map((row: any) => ({
        key: nextKey(),
        item_type: row.item_type,
        track_id: row.track_id,
        audio_asset_id: row.audio_asset_id,
        label: row.label ?? row.track_title ?? row.audio_asset_title ?? row.item_type,
        duration_seconds: row.track_duration_seconds ?? row.audio_asset_duration_seconds ?? 0,
      }))
    );
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const addTrack = (trackId: string) => {
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        item_type: "song",
        track_id: track.id,
        label: track.title,
        duration_seconds: track.duration_seconds,
      },
    ]);
  };

  const addAsset = (assetId: string) => {
    const asset = audioAssets.find((a) => a.id === assetId);
    if (!asset) return;
    setItems((prev) => [
      ...prev,
      {
        key: nextKey(),
        item_type: asset.type === "jingle" || asset.type === "promo" ? "station_id" : asset.type,
        audio_asset_id: asset.id,
        label: asset.title,
        duration_seconds: asset.duration_seconds,
      },
    ]);
  };

  const save = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await studioApi.saveRunningOrder(
        id,
        items.map((i) => ({
          item_type: i.item_type,
          track_id: i.track_id ?? null,
          audio_asset_id: i.audio_asset_id ?? null,
          label: i.item_type === "song" ? null : i.label,
        }))
      );
      await load();
    } finally {
      setSaving(false);
    }
  };

  const publish = async () => {
    if (!id) return;
    await save();
    await studioApi.updateProgramme(id, { status: "published", publish_date: new Date().toISOString() });
    await load();
  };

  const runAi = async () => {
    if (!id || !aiBrief.trim()) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const { proposal } = await studioApi.proposeProgramme(aiBrief, programme?.channel_id);
      const proposedItems: RunningOrderItem[] = proposal.items.map((raw: any) => {
        if (raw.item_type === "song") {
          const track = tracks.find((t) => t.id === raw.track_id);
          return {
            key: nextKey(),
            item_type: "song",
            track_id: raw.track_id,
            label: track?.title ?? raw.track_id,
            duration_seconds: track?.duration_seconds ?? 0,
          };
        }
        return {
          key: nextKey(),
          item_type: raw.item_type,
          label: raw.label ?? raw.item_type,
          duration_seconds: 0,
        };
      });
      setItems(proposedItems);
      if (proposal.description) {
        await studioApi.updateProgramme(id, { description: proposal.description });
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "AI request failed");
    } finally {
      setAiBusy(false);
    }
  };

  if (!programme) return <p>Loading...</p>;

  return (
    <div>
      <h1>{programme.title}</h1>
      <span className="badge">{programme.status}</span>

      <div className="card" style={{ margin: "20px 0" }}>
        <h3 style={{ marginTop: 0 }}>AI producer</h3>
        <p style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
          Describe the programme in plain language. AI proposes a running order from the real catalogue - it
          replaces the draft below for you to review, edit and save. Nothing publishes automatically.
        </p>
        <textarea
          value={aiBrief}
          onChange={(e) => setAiBrief(e.target.value)}
          rows={2}
          style={{ width: "100%", marginBottom: 8 }}
          placeholder="e.g. 60-minute upbeat Saturday morning show, eight songs, a link after every two songs"
        />
        {aiError && <p style={{ color: "var(--accent)" }}>{aiError}</p>}
        <button className="btn" onClick={runAi} disabled={aiBusy}>
          {aiBusy ? "Thinking..." : "Propose running order"}
        </button>
      </div>

      <RunningOrderEditor items={items} onChange={setItems} />

      <div className="card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>Add to running order</h4>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select onChange={(e) => e.target.value && addTrack(e.target.value)} value="">
            <option value="">+ Add song...</option>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          <select onChange={(e) => e.target.value && addAsset(e.target.value)} value="">
            <option value="">+ Add spoken content...</option>
            {audioAssets.map((a) => (
              <option key={a.id} value={a.id}>
                [{a.type}] {a.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button className="btn" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save draft"}
        </button>
        <button className="btn primary" onClick={publish}>
          Publish
        </button>
      </div>
    </div>
  );
}
