import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi, uploadFileToR2 } from "../../api/client";
import { readAudioDuration } from "../lib/audio";
import { GENRE_OPTIONS, MOOD_OPTIONS, BPM_PRESETS } from "../lib/presets";
import { ChipPicker } from "../components/ChipPicker";

type AlbumChoice =
  | { mode: "none" }
  | { mode: "existing"; albumId: string }
  | { mode: "new"; title: string; genre: string; description: string; artworkFile: File | null };

function StepBadge({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: "0.85rem",
        flexShrink: 0,
        background: active || done ? "var(--accent)" : "var(--bg-raised)",
        color: active || done ? "#fff" : "var(--text-dim)",
        border: active || done ? "none" : "1px solid var(--border)",
      }}
    >
      {done ? "✓" : n}
    </div>
  );
}

export function PublishWizard() {
  const [step, setStep] = useState(1);

  // Step 1 - song details
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState<string[]>([]);
  const [mood, setMood] = useState<string[]>([]);
  const [bpm, setBpm] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [step1Error, setStep1Error] = useState<string | null>(null);

  // Step 2 - album
  const [albums, setAlbums] = useState<any[]>([]);
  const [albumsError, setAlbumsError] = useState<string | null>(null);
  const [albumChoice, setAlbumChoice] = useState<AlbumChoice>({ mode: "none" });

  // Step 3 - publish
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [result, setResult] = useState<{ trackId: string; albumId: string | null } | null>(null);

  const loadAlbums = () => {
    setAlbumsError(null);
    studioApi
      .albums()
      .then((r) => setAlbums(r.albums))
      .catch((err) => setAlbumsError(err instanceof Error ? err.message : "Failed to load albums"));
  };

  useEffect(() => {
    loadAlbums();
  }, []);

  const goToStep2 = () => {
    if (!title.trim()) return setStep1Error("Give the song a title");
    if (!audioFile) return setStep1Error("Choose an audio file");
    setStep1Error(null);
    setStep(2);
  };

  const publish = async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      let albumId: string | null = null;

      if (albumChoice.mode === "existing") {
        albumId = albumChoice.albumId;
      } else if (albumChoice.mode === "new") {
        let artwork_url: string | undefined;
        if (albumChoice.artworkFile) {
          const presigned = await studioApi.presignUpload(
            albumChoice.artworkFile.name,
            albumChoice.artworkFile.type,
            "artwork"
          );
          await uploadFileToR2(presigned.upload_url, albumChoice.artworkFile);
          artwork_url = presigned.key;
        }
        const { id } = await studioApi.createAlbum({
          title: albumChoice.title,
          genre: albumChoice.genre || null,
          description: albumChoice.description || null,
          artwork_url,
        });
        albumId = id;
      }

      const duration = await readAudioDuration(audioFile!);
      const { upload_url, key } = await studioApi.presignUpload(audioFile!.name, audioFile!.type, "audio");
      await uploadFileToR2(upload_url, audioFile!);

      let artworkKey: string | undefined;
      if (artworkFile) {
        const presigned = await studioApi.presignUpload(artworkFile.name, artworkFile.type, "artwork");
        await uploadFileToR2(presigned.upload_url, artworkFile);
        artworkKey = presigned.key;
      }

      const { id: trackId } = await studioApi.createTrack({
        title,
        genre: genre.length > 0 ? genre.join(", ") : null,
        tempo_bpm: bpm ? Number(bpm) : null,
        duration_seconds: duration,
        audio_url: key,
        artwork_url: artworkKey ?? null,
        album_id: albumId,
        status: "published",
      });

      if (mood.length > 0) {
        await studioApi.setTrackTags(trackId, mood);
      }

      setResult({ trackId, albumId });
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setPublishing(false);
    }
  };

  const reset = () => {
    setStep(1);
    setTitle("");
    setGenre([]);
    setMood([]);
    setBpm("");
    setAudioFile(null);
    setArtworkFile(null);
    setAlbumChoice({ mode: "none" });
    setResult(null);
    setPublishError(null);
  };

  if (result) {
    return (
      <div style={{ maxWidth: 560 }}>
        <h1>🎉 It's live</h1>
        <p style={{ color: "var(--text-dim)" }}>
          "{title}" is published - listeners can hear it right now
          {result.albumId ? " on its album" : ""}.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn primary" onClick={reset}>
            Publish another song
          </button>
          {result.albumId ? (
            <Link className="btn" to={`/studio/albums/${result.albumId}`}>
              View album
            </Link>
          ) : (
            <Link className="btn" to="/studio/tracks">
              View in Music
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560 }}>
      <h1>Publish music</h1>
      <p style={{ color: "var(--text-dim)" }}>
        One guided flow: add the song, decide where it belongs, then publish. Nothing is saved
        until you click "Publish now" on the last step.
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
        <StepBadge n={1} active={step === 1} done={step > 1} />
        <div style={{ height: 1, flex: 1, background: "var(--border)" }} />
        <StepBadge n={2} active={step === 2} done={step > 2} />
        <div style={{ height: 1, flex: 1, background: "var(--border)" }} />
        <StepBadge n={3} active={step === 3} done={false} />
      </div>

      {step === 1 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Step 1 - The song</h3>
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
            <label>Audio file</label>
            <input type="file" accept="audio/*" onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)} />
            {audioFile && (
              <p style={{ color: "var(--text-dim)", fontSize: "0.85rem", margin: "4px 0 0" }}>
                ✓ {audioFile.name} selected
              </p>
            )}
          </div>
          <div className="form-row">
            <label>Artwork (optional)</label>
            <input type="file" accept="image/*" onChange={(e) => setArtworkFile(e.target.files?.[0] ?? null)} />
            {artworkFile && (
              <p style={{ color: "var(--text-dim)", fontSize: "0.85rem", margin: "4px 0 0" }}>
                ✓ {artworkFile.name} selected
              </p>
            )}
          </div>
          {step1Error && <p style={{ color: "var(--accent)" }}>{step1Error}</p>}
          <button className="btn primary" onClick={goToStep2}>
            Next: choose an album
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Step 2 - Where does it belong?</h3>
          {albumsError && (
            <p style={{ color: "var(--accent)" }}>
              Couldn't load your albums ({albumsError}).{" "}
              <button className="btn" onClick={loadAlbums} type="button">
                Retry
              </button>
            </p>
          )}
          <div className="form-row">
            <label>
              <input
                type="radio"
                checked={albumChoice.mode === "none"}
                onChange={() => setAlbumChoice({ mode: "none" })}
              />{" "}
              Standalone track (no album)
            </label>
          </div>
          <div className="form-row">
            <label>
              <input
                type="radio"
                checked={albumChoice.mode === "existing"}
                onChange={() =>
                  setAlbumChoice({ mode: "existing", albumId: albums[0]?.id ?? "" })
                }
                disabled={albums.length === 0}
              />{" "}
              Add to an existing album {albums.length === 0 && !albumsError && "(none yet)"}
            </label>
            {albumChoice.mode === "existing" && (
              <select
                value={albumChoice.albumId}
                onChange={(e) => setAlbumChoice({ mode: "existing", albumId: e.target.value })}
                style={{ marginTop: 6 }}
              >
                {albums.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="form-row">
            <label>
              <input
                type="radio"
                checked={albumChoice.mode === "new"}
                onChange={() =>
                  setAlbumChoice({ mode: "new", title: "", genre: "", description: "", artworkFile: null })
                }
              />{" "}
              Create a new album for it
            </label>
            {albumChoice.mode === "new" && (
              <div style={{ marginTop: 10, paddingLeft: 20 }}>
                <div className="form-row">
                  <label>Album title</label>
                  <input
                    value={albumChoice.title}
                    onChange={(e) => setAlbumChoice({ ...albumChoice, title: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <label>Genre</label>
                  <input
                    value={albumChoice.genre}
                    onChange={(e) => setAlbumChoice({ ...albumChoice, genre: e.target.value })}
                  />
                </div>
                <div className="form-row">
                  <label>Description</label>
                  <textarea
                    value={albumChoice.description}
                    onChange={(e) => setAlbumChoice({ ...albumChoice, description: e.target.value })}
                    rows={2}
                  />
                </div>
                <div className="form-row">
                  <label>Artwork (optional)</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => setAlbumChoice({ ...albumChoice, artworkFile: e.target.files?.[0] ?? null })}
                  />
                  {albumChoice.artworkFile && (
                    <p style={{ color: "var(--text-dim)", fontSize: "0.85rem", margin: "4px 0 0" }}>
                      ✓ {albumChoice.artworkFile.name} selected
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={() => setStep(1)}>
              Back
            </button>
            <button
              className="btn primary"
              onClick={() => setStep(3)}
              disabled={albumChoice.mode === "new" && !albumChoice.title.trim()}
            >
              Next: review &amp; publish
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Step 3 - Review &amp; publish</h3>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginBottom: 16 }}>
            {artworkFile && (
              <img
                src={URL.createObjectURL(artworkFile)}
                alt=""
                width={64}
                height={64}
                style={{ objectFit: "cover", borderRadius: 6 }}
              />
            )}
            <div>
              <div style={{ fontWeight: 700 }}>{title}</div>
              <div style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
                {genre.join(", ") || "No genre"} {bpm && `· ${bpm} BPM`}
              </div>
              <div style={{ color: "var(--text-dim)", fontSize: "0.85rem" }}>
                {mood.length > 0 ? mood.join(", ") : "No mood tags"}
              </div>
            </div>
          </div>
          <p style={{ color: "var(--text-dim)" }}>
            {albumChoice.mode === "none" && "Will be published as a standalone track."}
            {albumChoice.mode === "existing" &&
              `Will be added to "${albums.find((a) => a.id === albumChoice.albumId)?.title}" and published.`}
            {albumChoice.mode === "new" && `Will create the album "${albumChoice.title}" and publish this track to it.`}
          </p>
          <p style={{ fontWeight: 600 }}>
            This makes the song audible to listeners immediately - there's no separate "go live" step.
          </p>
          {publishError && <p style={{ color: "var(--accent)" }}>{publishError}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn" onClick={() => setStep(2)} disabled={publishing}>
              Back
            </button>
            <button className="btn primary" onClick={publish} disabled={publishing}>
              {publishing ? "Publishing..." : "Publish now"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
