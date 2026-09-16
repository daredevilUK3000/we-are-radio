import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { publicApi } from "../../api/client";

export function Programmes() {
  const [programmes, setProgrammes] = useState<any[]>([]);

  useEffect(() => {
    publicApi.programmes().then((r) => setProgrammes(r.programmes)).catch(() => {});
  }, []);

  return (
    <div>
      <h1>Programmes</h1>
      <div className="grid">
        {programmes.map((p) => (
          <Link key={p.id} to={`/programmes/${p.id}`} className="card">
            {p.is_flagship ? <span className="badge live">FLAGSHIP</span> : null}
            <div style={{ fontWeight: 600, marginTop: 6 }}>{p.title}</div>
          </Link>
        ))}
        {programmes.length === 0 && (
          <div style={{ color: "var(--text-dim)" }}>No programmes published yet.</div>
        )}
      </div>
    </div>
  );
}
