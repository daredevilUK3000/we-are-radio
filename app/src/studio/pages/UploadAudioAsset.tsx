import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { studioApi, uploadFileToR2 } from "../../api/client";
import { LINK_KINDS, NEED_TAGS } from "./RecordLink";

function readAudioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    audio.preload = "metadata";
    audio.onloadedmetadata = () => resolve(Math.round(audio.duration));
    audio.onerror = () => reject(new Error("Could not read audio metadata"));
    audio.src = URL.createObjectURL(file);
  });
}

// Each type lives in one section of the Audio library, so the section being
// uploaded to decides which types are offered.
const JINGLE_TYPES = [
  { value: "jingle", label: "Jingle" },
  { value: "station_id", label: "Station ID" },
  { value: "promo", label: "Promo" },
];
const SPOKEN_TYPES = [
  { value: "link", label: "Spoken link" },
  { value: "feature", label: "Feature" },
  { value: "interview", label: "Interview" },
];

export function UploadAudioAsset() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const spoken = searchParams.get("kind") === "spoken";
  const TYPES = spoken ? SPOKEN_TYPES : JINGLE_TYPES;
  const [type, setType] = useState(TYPES[0].value);
  // Jingles, station IDs and promos go live the moment they're uploaded (they
  // start out as ordinary "sequenced" clips between songs); spoken content
  // is still reviewed and published by hand.
  const goesLive = JINGLE_TYPES.some((t) => t.value === type);
  // A spoken link also says what it is FOR and which moods it suits, so the
  // radio can place it in a listener's programme.
  const [linkKind, setLinkKind] = useState("transition");
  const [linkNeeds, setLinkNeeds] = useState<string[]>([]);
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

      const created = await studioApi.createAudioAsset({
        type,
        link_kind: type === "link" ? linkKind : null,
        title,
        description: description || null,
        duration_seconds: duration,
        audio_url: key,
        status: goesLive ? "published" : "ready",
      });

      if (type === "link" && linkNeeds.length > 0) await studioApi.setAudioAssetTags(created.id, linkNeeds);
      // Straight back to the section it was uploaded into.
      navigate(spoken ? "/studio/audio?tab=spoken" : "/studio/audio");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ maxWidth: 480 }}>
      <h1>{spoken ? "Upload spoken audio" : "Upload jingle"}</h1>
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
        {type === "link" && (
          <>
            <div className="form-row">
              <label>What is this link for?</label>
              <select value={linkKind} onChange={(e) => setLinkKind(e.target.value)}>
                {LINK_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>Which moods is it for? (none = works with anything)</label>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {NEED_TAGS.map((n) => (
                  <button
                    key={n.key}
                    type="button"
                    className={`chip${linkNeeds.includes(n.key) ? " selected" : ""}`}
                    onClick={() => setLinkNeeds((p) => (p.includes(n.key) ? p.filter((x) => x !== n.key) : [...p, n.key]))}
                  >
                    {n.label}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
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
        <p style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
          {goesLive
            ? "This goes live as soon as it's uploaded. You can change how it plays, or take it off air, from the Audio page afterwards."
            : "This is saved ready for you to review - publish it from the Audio page when you're happy."}
        </p>
        {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Uploading..." : "Upload"}
        </button>
      </form>
    </div>
  );
}
