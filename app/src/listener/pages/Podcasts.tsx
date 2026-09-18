import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { publicApi, mediaUrl } from "../../api/client";

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function Podcasts() {
  const [podcasts, setPodcasts] = useState<any[]>([]);

  useEffect(() => {
    publicApi.podcasts().then((r) => setPodcasts(r.podcasts)).catch(() => {});
  }, []);

  return (
    <div>
      <h1>Podcasts</h1>
      <p style={{ color: "var(--text-dim)" }}>Episodes from Kizzi's back catalogue.</p>
      <div className="up-next-list">
        {podcasts.map((p) => (
          <Link key={p.id} to={`/programmes/${p.id}`} className="up-next-row" style={{ textDecoration: "none" }}>
            {p.artwork_url ? (
              <img
                src={mediaUrl(p.artwork_url)}
                alt=""
                width={56}
                height={56}
                style={{ objectFit: "cover", borderRadius: 6, flexShrink: 0 }}
              />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: 6, background: "var(--bg-raised)", flexShrink: 0 }} />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{p.title}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>{formatDate(p.publish_date)}</div>
            </div>
            <span className="up-next-duration">
              {p.duration_seconds ? `${Math.round(p.duration_seconds / 60)} min` : ""}
            </span>
          </Link>
        ))}
        {podcasts.length === 0 && (
          <div style={{ color: "var(--text-dim)", padding: "12px 4px" }}>No podcast episodes published yet.</div>
        )}
      </div>
    </div>
  );
}
