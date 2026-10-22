import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { studioApi, uploadFileToR2 } from "../../api/client";
import { ChipPicker } from "../components/ChipPicker";
import { readAudioDuration } from "../lib/audio";
import { tidyAllCaps, titleFromFilename } from "../lib/bulkImport";
import { readFileTags } from "../lib/id3";
import { GENRE_OPTIONS, MOOD_OPTIONS, BPM_PRESETS } from "../lib/presets";

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
  // Where the title in the box came from, so a hand-typed one is never replaced.
  const [titleSource, setTitleSource] = useState<"typed" | "tag" | "filename" | null>(null);

  // Choosing the file fills the title from the MP3's own tag (or, without
  // one, its file name). It's only a suggestion - the box stays editable.
  const chooseAudio = async (file: File | null) => {
    setAudioFile(file);
    if (!file || (titleSource === "typed" && title.trim())) return;
    const tags = await readFileTags(file);
    if (tags.title) {
      setTitle(tidyAllCaps(tags.title));
      setTitleSource("tag");
    } else {
      setTitle(titleFromFilename(file.name, true));
      setTitleSource("filename");
    }
  };

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
          <label>Audio file</label>
          <input type="file" accept="audio/*" onChange={(e) => void chooseAudio(e.target.files?.[0] ?? null)} required />
        </div>
        <div className="form-row">
          <label>Title</label>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleSource("typed");
            }}
            required
          />
          {titleSource === "tag" && (
            <small style={{ color: "var(--text-dim)" }}>Taken from the MP3's own title - change it here if needed.</small>
          )}
          {titleSource === "filename" && (
            <small style={{ color: "var(--text-dim)" }}>
              This file has no title inside it, so this comes from the file name - change it here if needed.
            </small>
          )}
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
