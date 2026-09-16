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

const TYPES = [
  { value: "station_id", label: "Station ID" },
  { value: "jingle", label: "Jingle" },
  { value: "link", label: "Spoken link" },
  { value: "feature", label: "Feature" },
  { value: "interview", label: "Interview" },
  { value: "promo", label: "Promo" },
];

export function UploadAudioAsset() {
  const navigate = useNavigate();
  const [type, setType] = useState("station_id");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
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

      await studioApi.createAudioAsset({
        type,
        title,
        description: description || null,
        duration_seconds: duration,
        audio_url: key,
        status: "ready",
      });

      navigate("/studio/audio");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <h1>Upload audio</h1>
      <form onSubmit={submit}>
        <div className="form-row">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="form-row">
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </div>
        <div className="form-row">
          <label>Audio file</label>
          <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)} required />
        </div>
        {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Uploading..." : "Upload"}
        </button>
      </form>
    </div>
  );
}
