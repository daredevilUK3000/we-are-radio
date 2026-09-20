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

// Which song each jingle is previewed against. Every jingle remembers its own
// choice (between visits too), so picking a song for one never changes another.
// This only affects what you hear when you press Preview - on air, a jingle
// plays over whatever song the station is playing at the time.
const TRACK_KEY = "we-are-radio:studio-preview-tracks";
let chosenTracks: Record<string, string> = {};
try {
  chosenTracks = JSON.parse(localStorage.getItem(TRACK_KEY) ?? "{}") ?? {};
} catch {
  // storage unavailable or unreadable - choices just won't be remembered
}
const trackListeners = new Set<() => void>();

function chooseTrack(assetId: string, trackId: string) {
  chosenTracks = { ...chosenTracks, [assetId]: trackId };
  try {
    localStorage.setItem(TRACK_KEY, JSON.stringify(chosenTracks));
  } catch {
    // ignore
  }
  trackListeners.forEach((notify) => notify());
}

export function usePreviewTrack(assetId: string) {
  const [tracks, setTracks] = useState<any[]>([]);
  const [, refresh] = useState(0);

  useEffect(() => {
    loadSampleTracks().then(setTracks);
    const notify = () => refresh((n) => n + 1);
    trackListeners.add(notify);
    return () => {
      trackListeners.delete(notify);
    };
  }, []);

  // Falls back to the first song if none was chosen (or it has since been removed).
  const track = tracks.find((t) => t.id === chosenTracks[assetId]) ?? tracks[0];
  return { tracks, track, trackId: track?.id ?? "", setTrackId: (id: string) => chooseTrack(assetId, id) };
}

/** The "preview this jingle over which song?" dropdown. */
export function PreviewSongPicker({ assetId, style }: { assetId: string; style?: React.CSSProperties }) {
  const { tracks, trackId, setTrackId } = usePreviewTrack(assetId);
  return (
    <select
      value={trackId}
      onChange={(e) => setTrackId(e.target.value)}
      style={style}
      aria-label="Song to preview this jingle over"
    >
      {tracks.map((t) => (
        <option key={t.id} value={t.id}>
          {t.title}
        </option>
      ))}
    </select>
  );
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

  // `atSecond` is where in the song the jingle comes in. The song starts a
  // few seconds before that, so a jingle pinned 40 s in doesn't mean waiting 40 s.
  const start = (asset: any, settings: PreviewSettings, track: any, atSecond = 3) => {
    stop();
    if (!track) return;
    const seek = Math.max(0, atSecond - 3);
    const wait = atSecond - seek;
    const music = new Audio();
    musicRef.current = music;
    setPreviewing(true);
    // Both start straight from the click, so the browser allows the audio.
    void unlockAudio(music);
    music.src = mediaUrl(track.audio_url);
    if (seek > 0) {
      music.addEventListener("loadedmetadata", () => {
        music.currentTime = seek;
      });
    }
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
    }, wait * 1000);
  };

  return { previewing, start, stop };
}

/** One-click preview of a jingle using its saved settings (the row button). */
export function JinglePreviewButton({ asset }: { asset: any }) {
  const { previewing, start, stop } = useJinglePreview();
  const { track } = usePreviewTrack(asset.id);

  const run = () =>
    start(
      asset,
      {
        mode: asset.play_mode ?? "sequenced",
        levelPct: Math.round((asset.duck_level ?? 0.28) * 100),
        fadeMs: asset.duck_fade_ms ?? 400,
      },
      track
    );

  return (
    <button
      className="btn"
      onClick={previewing ? stop : run}
      disabled={!track && !previewing}
      title={`Hear this jingle over "${track?.title ?? "a song"}", the way it will sound on air`}
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
  const { track, trackId } = usePreviewTrack(asset.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { previewing, start, stop } = useJinglePreview();

  // Songs this jingle is pinned to: it plays over each of them every time
  // they come up. Changes here save straight away, like tags do.
  const { tracks } = usePreviewTrack(asset.id);
  const [pins, setPins] = useState<{ track_id: string; title: string; start_offset_seconds: number }[]>([]);
  const [pinChoice, setPinChoice] = useState("");
  const [pinStatus, setPinStatus] = useState<string | null>(null);
  const [pinPreviewId, setPinPreviewId] = useState<string | null>(null);

  useEffect(() => {
    studioApi.audioAssetPins(asset.id).then((r) => setPins(r.pins));
  }, [asset.id]);

  const savePins = async (next: typeof pins) => {
    setPinStatus("Saving...");
    try {
      await studioApi.setAudioAssetPins(
        asset.id,
        next.map((p) => ({ track_id: p.track_id, start_offset_seconds: p.start_offset_seconds }))
      );
      setPins(next);
      setPinStatus("Saved");
      window.setTimeout(() => setPinStatus(null), 2000);
    } catch (err) {
      setPinStatus(err instanceof Error ? err.message : "Could not save");
    }
  };

  // Alphabetical, and no song is pre-selected: the list is newest-first, so a
  // default would silently pin the most recently added song.
  const unpinned = tracks
    .filter((t) => !pins.some((p) => p.track_id === t.id))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
  const pinChoiceId = unpinned.some((t) => t.id === pinChoice) ? pinChoice : "";

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
  // Pinned jingles always play over their song, so the level/fade sliders matter for them too.
  const showDuckSettings = ducking || pins.length > 0;

  return (
    <div className="card" style={{ display: "grid", gap: 14 }}>
      <div className="form-row" style={{ marginBottom: 0 }}>
        <label>How it plays</label>
        <select value={mode} onChange={(e) => setMode(e.target.value as PlayMode)}>
          <option value="sequenced">Sequenced - its own clip, between songs</option>
          <option value="duck_over_music">Over the music - the song dips underneath (a sweeper)</option>
        </select>
      </div>

      {showDuckSettings && (
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
          <PreviewSongPicker assetId={asset.id} style={{ flex: 1, minWidth: 180 }} />
          {previewing ? (
            <button className="btn" onClick={stop}>
              Stop
            </button>
          ) : (
            <button
              className="btn"
              onClick={() => start(asset, { mode, levelPct, fadeMs }, track)}
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

      <div className="form-row" style={{ marginBottom: 0 }}>
        <label>
          Always play over these songs {pinStatus && <span style={{ color: "var(--text-dim)", fontWeight: 400 }}> - {pinStatus}</span>}
        </label>
        {pins.length === 0 ? (
          <small style={{ color: "var(--text-dim)", marginBottom: 8 }}>
            Not pinned to any song. Pin it to one and this jingle plays over that song every time it comes up, on top
            of the jingles the station rotates in by itself.
          </small>
        ) : (
          <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
            {pins.map((pin) => (
              <div key={pin.track_id + pin.start_offset_seconds} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 140 }}>{pin.title}</span>
                <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.85rem", color: "var(--text-dim)" }}>
                  comes in after
                  <input
                    type="number"
                    min={0}
                    max={900}
                    defaultValue={pin.start_offset_seconds}
                    style={{ width: 70 }}
                    aria-label={`Seconds into ${pin.title} that the jingle comes in`}
                    onBlur={(e) => {
                      const value = Math.min(900, Math.max(0, Math.round(Number(e.target.value) || 0)));
                      if (value !== pin.start_offset_seconds) {
                        void savePins(pins.map((p) => (p.track_id === pin.track_id ? { ...p, start_offset_seconds: value } : p)));
                      }
                    }}
                  />
                  seconds
                </label>
                <button
                  className="btn"
                  onClick={() => {
                    if (pinPreviewId === pin.track_id && previewing) {
                      stop();
                      setPinPreviewId(null);
                      return;
                    }
                    setPinPreviewId(pin.track_id);
                    // A pinned jingle always plays over the song, whatever its rotation mode.
                    start(
                      asset,
                      { mode: "duck_over_music", levelPct, fadeMs },
                      tracks.find((t) => t.id === pin.track_id),
                      pin.start_offset_seconds
                    );
                  }}
                >
                  {previewing && pinPreviewId === pin.track_id ? "Stop" : "Preview"}
                </button>
                <button className="btn" onClick={() => savePins(pins.filter((p) => p.track_id !== pin.track_id))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <select value={pinChoiceId} onChange={(e) => setPinChoice(e.target.value)} style={{ flex: 1, minWidth: 180 }} aria-label="Song to pin this jingle to">
            <option value="">Choose a song to pin to...</option>
            {unpinned.map((t) => (
              <option key={t.id} value={t.id}>
                {t.album_title ? `${t.title} (${t.album_title})` : t.title}
              </option>
            ))}
          </select>
          <button
            className="btn"
            disabled={!pinChoiceId}
            onClick={() => {
              const track = tracks.find((t) => t.id === pinChoiceId);
              if (track) void savePins([...pins, { track_id: track.id, title: track.title, start_offset_seconds: 4 }]);
            }}
          >
            Pin to this song
          </button>
        </div>
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
