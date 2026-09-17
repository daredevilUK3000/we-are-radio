import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { studioApi, uploadFileToR2 } from "../../api/client";
import { ChipPicker } from "../components/ChipPicker";

function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(Math.round(audio.duration));
    audio.onerror = () => reject(new Error("Could not read audio metadata"));
    audio.src = URL.createObjectURL(file);
  });
}

const GENRE_OPTIONS = [
  "Pop",
  "Rock",
  "Gospel",
  "Pop Gospel",
  "R&B",
  "Soul",
  "Hip-Hop",
  "Jazz",
  "Blues",
  "Country",
  "Electronic",
  "Dance",
  "Classical",
  "Reggae",
  "Folk",
  "Instrumental",
];

// Straight from Section 5 of the brief - the flexible, growable mood/vibe vocabulary.
const MOOD_OPTIONS = [
  "romantic",
  "upbeat",
  "relaxing",
  "dance",
  "rock",
  "pop",
  "instrumental",
  "orchestral",
  "1950s-inspired",
  "1960s-inspired",
  "Christmas",
  "summer",
  "night",
  "morning",
  "slow",
  "fast",
];

const BPM_PRESETS: { label: string; value: number }[] = [
  { label: "Slow (~70)", value: 70 },
  { label: "Chill (~90)", value: 90 },
  { label: "Medium (~110)", value: 110 },
  { label: "Upbeat (~128)", value: 128 },
  { label: "Fast (~140)", value: 140 },
  { label: "Very fast (~160)", value: 160 },
];

export function UploadTrack() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState<string[]>([]);
  const [mood, setMood] = useState<string[]>([]);
  const [bpm, setBpm] = useState("");
  const [description, setDescription] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!audioFile) {
      setError("An audio file is required");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const duration = await readAudioDuration(audioFile);

      const { upload_url, key } = await studioApi.presignUpload(audioFile.name, audioFile.type, "audio");
      await uploadFileToR2(upload_url, audioFile);

      let artworkKey: string | undefined;
      if (artworkFile) {
        const presigned = await studioApi.presignUpload(artworkFile.name, artworkFile.type, "artwork");
        await uploadFileToR2(presigned.upload_url, artworkFile);
        artworkKey = presigned.key;
      }

      const { id } = await studioApi.createTrack({
        title,
        genre: genre.length > 0 ? genre.join(", ") : null,
        description: description || null,
        tempo_bpm: bpm ? Number(bpm) : null,
        duration_seconds: duration,
        audio_url: key,
        artwork_url: artworkKey ?? null,
        status: "ready",
      });

      if (mood.length > 0) {
        await studioApi.setTrackTags(id, mood);
      }

      navigate("/studio/tracks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <h1>Upload music</h1>
      <form onSubmit={submit}>
        <div className="form-row">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="form-row">
          <label>Genre</label>
          <ChipPicker options={GENRE_OPTIONS} value={genre} onChange={setGenre} customPlaceholder="Other genre..." />
        </div>
        <div className="form-row">
          <label>Mood / vibe</label>
          <ChipPicker options={MOOD_OPTIONS} value={mood} onChange={setMood} customPlaceholder="Other mood/vibe..." />
        </div>
        <div className="form-row">
          <label>BPM</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
            {BPM_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                className="btn"
                onClick={() => setBpm(String(p.value))}
                style={
                  Number(bpm) === p.value
                    ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
                    : undefined
                }
              >
                {p.label}
              </button>
            ))}
          </div>
          <input
            value={bpm}
            onChange={(e) => setBpm(e.target.value)}
            type="number"
            placeholder="or enter an exact BPM"
            style={{ maxWidth: 200 }}
          />
        </div>
        <div className="form-row">
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>
        <div className="form-row">
          <label>Audio file</label>
          <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)} required />
        </div>
        <div className="form-row">
          <label>Artwork (optional)</label>
          <input type="file" accept="image/*" onChange={(e) => setArtworkFile(e.target.files?.[0] ?? null)} />
        </div>
        {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Uploading..." : "Upload"}
        </button>
      </form>
    </div>
  );
}
