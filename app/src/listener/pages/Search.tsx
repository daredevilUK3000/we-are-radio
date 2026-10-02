import { useState } from "react";
import { Link } from "react-router-dom";
import { publicApi, mediaUrl } from "../../api/client";

export function Search() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ tracks: any[]; albums: any[]; programmes: any[] } | null>(null);

  const runSearch = async (value: string) => {
    setQ(value);
    if (!value.trim()) {
      setResults(null);
      return;
    }
    const r = await publicApi.search(value);
    setResults(r);
  };

  return (
    <div>
      <h1>Search</h1>
      <input
        value={q}
        onChange={(e) => runSearch(e.target.value)}
        placeholder="Search songs, albums, programmes..."
        style={{ width: "100%", marginBottom: 20 }}
      />

      {results && (
        <>
          {results.tracks.length > 0 && (
            <section>
              <h3>Songs</h3>
              {results.tracks.map((t) => (
                <Link
                  key={t.id}
                  to={`/track/${t.id}`}
                  className="card"
                  style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}
                >
                  {t.artwork_url ? (
                    <img src={mediaUrl(t.artwork_url)} alt="" width={40} height={40} style={{ objectFit: "cover", borderRadius: 4, flexShrink: 0 }} />
                  ) : null}
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "block" }}>{t.title}</span>
                    {(t.artist || t.album_title) && (
                      <span style={{ display: "block", fontSize: "0.85em", color: "var(--text-dim)" }}>
                        {[t.artist, t.album_title].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                </Link>
              ))}
            </section>
          )}
          {results.albums.length > 0 && (
            <section>
              <h3>Albums</h3>
              {results.albums.map((a) => (
                <Link key={a.id} to={`/albums/${a.id}`} className="card" style={{ display: "block", marginBottom: 8 }}>
                  {a.title}
                </Link>
              ))}
            </section>
          )}
          {results.programmes.length > 0 && (
            <section>
              <h3>Programmes</h3>
              {results.programmes.map((p) => (
                <Link
                  key={p.id}
                  to={`/programmes/${p.id}`}
                  className="card"
                  style={{ display: "block", marginBottom: 8 }}
                >
                  {p.title}
                </Link>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
