import { useEffect, useRef, useState } from "react";
import { studioApi, mediaUrl } from "../../api/client";
import { cancelOverlay, playOverlay, unlockAudio } from "../../shared/duckEngine";

/**
 * How a jingle is played: as its own clip between songs ("sequenced"), or
 * over a song with the music turned down underneath ("duck over music").
 * The preview plays a real published track and brings the jingle in over it
 * using the current slider values - saved or not - so the level and fade can
 * be tuned by ear before anything goes on air.
 */
export function JingleSettings({ asset, onSaved }: { asset: any; onSaved: () => void }) {
  const [mode, setMode] = useState<"sequenced" | "duck_over_music">(asset.play_mode ?? "sequenced");
  const [levelPct, setLevelPct] = useState(Math.round((asset.duck_level ?? 0.28) * 100));
  const [fadeMs, setFadeMs] = useState<number>(asset.duck_fade_ms ?? 400);
  const [tracks, setTracks] = useState<any[]>([]);
  const [trackId, setTrackId] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    studioApi.tracks().then((r) => {
      const published = r.tracks.filter((t: any) => t.status === "published" && t.audio_url);
      setTracks(published);
      setTrackId(published[0]?.id ?? "");
    });
    return () => stopPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopPreview = () => {
    window.clearTimeout(timerRef.current);
    const music = musicRef.current;
    if (music) {
      cancelOverlay(music);
      music.pause();
    }
    musicRef.current = null;
    setPreviewing(false);
  };

  const preview = () => {
    stopPreview();
    const track = tracks.find((t) => t.id === trackId);
    if (!track) return;
    const music = new Audio();
    musicRef.current = music;
    setPreviewing(true);
    // Both start straight from the click, so the browser allows the audio.
    void unlockAudio(music);
    music.src = mediaUrl(track.audio_url);
    music.play().catch(() => setPreviewing(false));
    // Let the song establish itself, then bring the voice in over it.
    timerRef.current = window.setTimeout(() => {
      void playOverlay(music, {
        asset_id: asset.id,
        audio_url: asset.audio_url,
        duration_seconds: asset.duration_seconds,
        start_offset_seconds: 0,
        duck_level: levelPct / 100,
        duck_fade_ms: fadeMs,
      });
    }, 3000);
    music.addEventListener("ended", () => setPreviewing(false));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await studioApi.updateAudioAsset(asset.id, {
        play_mode: mode,
        duck_level: levelPct / 100,
        duck_fade_ms: fadeMs,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const ducking = mode === "duck_over_music";

  return (
    <div className="card" style={{ display: "grid", gap: 14 }}>
      <div className="form-row" style={{ marginBottom: 0 }}>
        <label>How it plays</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
          <option value="sequenced">Sequenced - its own clip, between songs</option>
          <option value="duck_over_music">Over the music - the song dips underneath (a sweeper)</option>
        </select>
      </div>

      {ducking && (
        <>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>
              Music level while the jingle speaks: <strong>{levelPct}%</strong>
            </label>
            <input type="range" min={5} max={90} value={levelPct} onChange={(e) => setLevelPct(Number(e.target.value))} />
            <small style={{ color: "var(--text-dim)" }}>Lower means the music dips further. About 25-30% is typical.</small>
          </div>
          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>
              Fade time: <strong>{fadeMs} ms</strong>
            </label>
            <input type="range" min={100} max={1500} step={50} value={fadeMs} onChange={(e) => setFadeMs(Number(e.target.value))} />
            <small style={{ color: "var(--text-dim)" }}>How long the music takes to dip, and to come back up afterwards.</small>
          </div>

          <div className="form-row" style={{ marginBottom: 0 }}>
            <label>Try it over</label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <select value={trackId} onChange={(e) => setTrackId(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
              {previewing ? (
                <button className="btn" onClick={stopPreview}>
                  Stop
                </button>
              ) : (
                <button className="btn" onClick={preview} disabled={!trackId}>
                  Preview
                </button>
              )}
            </div>
            <small style={{ color: "var(--text-dim)" }}>
              Plays the song, and brings the jingle in over it after 3 seconds using the settings above - saved or not.
            </small>
          </div>
        </>
      )}

      {error && <p style={{ color: "var(--accent)", margin: 0 }}>{error}</p>}
      <div>
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
