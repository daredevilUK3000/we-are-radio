import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { publicApi } from "../../api/client";

export function Albums() {
  const [albums, setAlbums] = useState<any[]>([]);

  useEffect(() => {
    publicApi.albums().then((r) => setAlbums(r.albums)).catch(() => {});
  }, []);

  return (
    <div>
      <h1>Albums</h1>
      <div className="grid">
        {albums.map((a) => (
          <Link key={a.id} to={`/albums/${a.id}`} className="card">
            <div style={{ fontWeight: 600 }}>{a.title}</div>
            <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>{a.genre}</div>
          </Link>
        ))}
        {albums.length === 0 && <div style={{ color: "var(--text-dim)" }}>No albums published yet.</div>}
      </div>
    </div>
  );
}
