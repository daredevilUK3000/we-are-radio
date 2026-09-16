import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { studioApi, uploadFileToR2 } from "../../api/client";

function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(Math.round(audio.duration));
    audio.onerror = () => reject(new Error("Could not read audio metadata"));
    audio.src = URL.createObjectURL(file);
  });
}

export function UploadTrack() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
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
        genre: genre || null,
        description: description || null,
        tempo_bpm: bpm ? Number(bpm) : null,
        duration_seconds: duration,
        audio_url: key,
        artwork_url: artworkKey ?? null,
        status: "ready",
      });

      if (mood.trim()) {
        await studioApi.setTrackTags(
          id,
          mood.split(",").map((m) => m.trim()).filter(Boolean)
        );
      }

      navigate("/studio/tracks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <h1>Upload music</h1>
      <form onSubmit={submit}>
        <div className="form-row">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="form-row">
          <label>Genre</label>
          <input value={genre} onChange={(e) => setGenre(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Mood / vibe tags (comma-separated)</label>
          <input value={mood} onChange={(e) => setMood(e.target.value)} placeholder="upbeat, summer, dance" />
        </div>
        <div className="form-row">
          <label>BPM</label>
          <input value={bpm} onChange={(e) => setBpm(e.target.value)} type="number" />
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
