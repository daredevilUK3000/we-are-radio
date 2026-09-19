import { useEffect, useRef, useState } from "react";
import { studioApi, mediaUrl } from "../../api/client";
import { cancelOverlay, playOverlay, unlockAudio } from "../../shared/duckEngine";

type PlayMode = "sequenced" | "duck_over_music";

interface PreviewSettings {
  mode: PlayMode;
  levelPct: number;
  fadeMs: number;
}

// Published songs to try a jingle against, fetched once for the whole page.
let sampleTracks: Promise<any[]> | null = null;
function loadSampleTracks(): Promise<any[]> {
  sampleTracks ??= studioApi
    .tracks()
    .then((r) => r.tracks.filter((t: any) => t.status === "published" && t.audio_url))
    .catch(() => {
      sampleTracks = null;
      return [];
    });
  return sampleTracks;
}

/**
 * Plays a real song and brings a jingle in the way it will be heard on air,
 * so it can be judged by ear before it goes live:
 *   - "over the music": the song dips underneath while the jingle speaks;
 *   - "sequenced": the song pauses, the jingle plays as its own clip, and
 *     the song carries on.
 * Either way the jingle comes in 3 seconds after the song starts.
 */
export function useJinglePreview() {
  const [previewing, setPreviewing] = useState(false);
  const musicRef = useRef<HTMLAudioElement | null>(null);
  const jingleRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  const stop = () => {
    window.clearTimeout(timerRef.current);
    const music = musicRef.current;
    if (music) {
      cancelOverlay(music);
      music.pause();
    }
    jingleRef.current?.pause();
    musicRef.current = null;
    jingleRef.current = null;
    setPreviewing(false);
  };

  // Don't leave anything playing when the page or panel is closed.
  useEffect(() => stop, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (asset: any, settings: PreviewSettings, track: any) => {
    stop();
    if (!track) return;
    const music = new Audio();
    musicRef.current = music;
    setPreviewing(true);
    // Both start straight from the click, so the browser allows the audio.
    void unlockAudio(music);
    music.src = mediaUrl(track.audio_url);
    music.play().catch(() => setPreviewing(false));
    music.addEventListener("ended", () => setPreviewing(false));

    timerRef.current = window.setTimeout(() => {
      if (settings.mode === "duck_over_music") {
        void playOverlay(music, {
          asset_id: asset.id,
          audio_url: asset.audio_url,
          duration_seconds: asset.duration_seconds,
          start_offset_seconds: 0,
          duck_level: settings.levelPct / 100,
          duck_fade_ms: settings.fadeMs,
        });
      } else {
        music.pause();
        const jingle = new Audio(mediaUrl(asset.audio_url));
        jingleRef.current = jingle;
        jingle.addEventListener("ended", () => music.play().catch(() => {}));
        jingle.play().catch(() => music.play().catch(() => {}));
      }
    }, 3000);
  };

  return { previewing, start, stop };
}

/** One-click preview of a jingle using its saved settings (the row button). */
export function JinglePreviewButton({ asset }: { asset: any }) {
  const { previewing, start, stop } = useJinglePreview();

  const run = async () => {
    const tracks = await loadSampleTracks();
    start(
      asset,
      {
        mode: asset.play_mode ?? "sequenced",
        levelPct: Math.round((asset.duck_level ?? 0.28) * 100),
        fadeMs: asset.duck_fade_ms ?? 400,
      },
      tracks[0]
    );
  };

  return (
    <button
      className="btn"
      onClick={previewing ? stop : run}
      title="Hear this jingle against a song, the way it will sound on air"
    >
      {previewing ? "Stop preview" : "Preview"}
    </button>
  );
}

/**
 * How a jingle is played: as its own clip between songs ("sequenced"), or
 * over a song with the music turned down underneath ("duck over music").
 * The preview uses the current slider values - saved or not - so the level
 * and fade can be tuned by ear before anything goes on air.
 */
export function JingleSettings({ asset, onSaved }: { asset: any; onSaved: () => void }) {
  const [mode, setMode] = useState<PlayMode>(asset.play_mode ?? "sequenced");
  const [levelPct, setLevelPct] = useState(Math.round((asset.duck_level ?? 0.28) * 100));
  const [fadeMs, setFadeMs] = useState<number>(asset.duck_fade_ms ?? 400);
  const [tracks, setTracks] = useState<any[]>([]);
  const [trackId, setTrackId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { previewing, start, stop } = useJinglePreview();

  useEffect(() => {
    loadSampleTracks().then((published) => {
      setTracks(published);
      setTrackId(published[0]?.id ?? "");
    });
  }, []);

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
        <select value={mode} onChange={(e) => setMode(e.target.value as PlayMode)}>
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
        </>
      )}

      <div className="form-row" style={{ marginBottom: 0 }}>
        <label>Preview against a song</label>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select value={trackId} onChange={(e) => setTrackId(e.target.value)} style={{ flex: 1, minWidth: 180 }}>
            {tracks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
          {previewing ? (
            <button className="btn" onClick={stop}>
              Stop
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => start(asset, { mode, levelPct, fadeMs }, tracks.find((t) => t.id === trackId))}
              disabled={!trackId}
            >
              Preview
            </button>
          )}
        </div>
        <small style={{ color: "var(--text-dim)" }}>
          {ducking
            ? "Plays the song, then brings the jingle in over it after 3 seconds using the settings above - saved or not."
            : "Plays the song, then pauses it after 3 seconds, plays the jingle as its own clip, and carries on."}
        </small>
      </div>

      {error && <p style={{ color: "var(--accent)", margin: 0 }}>{error}</p>}
      <div>
        <button className="btn primary" onClick={save} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
