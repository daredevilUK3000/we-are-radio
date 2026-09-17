import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { studioApi, uploadFileToR2, mediaUrl } from "../../api/client";

export function Albums() {
  const navigate = useNavigate();
  const [albums, setAlbums] = useState<any[]>([]);
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [description, setDescription] = useState("");
  const [artworkFile, setArtworkFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => studioApi.albums().then((r) => setAlbums(r.albums));
  useEffect(() => {
    load();
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      let artwork_url: string | undefined;
      if (artworkFile) {
        const presigned = await studioApi.presignUpload(artworkFile.name, artworkFile.type, "artwork");
        await uploadFileToR2(presigned.upload_url, artworkFile);
        artwork_url = presigned.key;
      }
      const { id } = await studioApi.createAlbum({
        title,
        genre: genre || null,
        description: description || null,
        artwork_url,
      });
      navigate(`/studio/albums/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create album");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1>Albums</h1>

      <form onSubmit={create} className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginTop: 0 }}>New album</h3>
        <div className="form-row">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="form-row">
          <label>Genre</label>
          <input value={genre} onChange={(e) => setGenre(e.target.value)} />
        </div>
        <div className="form-row">
          <label>Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
        <div className="form-row">
          <label>Artwork (optional)</label>
          <input type="file" accept="image/*" onChange={(e) => setArtworkFile(e.target.files?.[0] ?? null)} />
        </div>
        {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Creating..." : "Create album"}
        </button>
      </form>

      <div className="grid">
        {albums.map((a) => (
          <Link key={a.id} to={`/studio/albums/${a.id}`} className="card">
            {a.artwork_url && (
              <img
                src={mediaUrl(a.artwork_url)}
                alt=""
                width={120}
                height={120}
                style={{ objectFit: "cover", borderRadius: 6, marginBottom: 8 }}
              />
            )}
            <div style={{ fontWeight: 600 }}>{a.title}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>{a.genre}</div>
          </Link>
        ))}
        {albums.length === 0 && <div style={{ color: "var(--text-dim)" }}>No albums yet.</div>}
      </div>
    </div>
  );
}
