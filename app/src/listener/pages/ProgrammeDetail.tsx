import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { publicApi } from "../../api/client";

export function ProgrammeDetail() {
  const { id } = useParams();
  const [programme, setProgramme] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    publicApi.programme(id).then((r) => {
      setProgramme(r.programme);
      setItems(r.items);
    });
  }, [id]);

  if (!programme) return <p>Loading...</p>;

  return (
    <div>
      {programme.is_flagship ? <span className="badge live">FLAGSHIP</span> : null}
      <h1>{programme.title}</h1>
      <p style={{ color: "var(--text-dim)" }}>{programme.description}</p>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <button className="btn primary">Listen Now</button>
        <button className="btn">Listen On Demand</button>
      </div>

      <h3>Running order</h3>
      {items.map((item) => (
        <div key={item.id} className="running-order-item" style={{ cursor: "default" }}>
          <span className="badge">{item.item_type}</span>
          <span>{item.label ?? item.track_title ?? item.audio_asset_title}</span>
        </div>
      ))}
    </div>
  );
}
