import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi } from "../../api/client";

/**
 * Likes (/studio/likes): which songs listeners have liked, and how often.
 * Listeners themselves never see a count - only whether they liked it.
 */
export function Likes() {
  const [itemType, setItemType] = useState<"all" | "track" | "contest_entry">("all");
  const [sort, setSort] = useState<"total" | "week">("total");
  const [items, setItems] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setItems(null);
    studioApi
      .likes(itemType, sort)
      .then((r) => setItems(r.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, [itemType, sort]);

  return (
    <div>
      <h1>Likes</h1>
      <p style={{ color: "var(--text-dim)" }}>Only you can see likes. Listeners never see counts.</p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}>
        {(
          [
            ["all", "All"],
            ["track", "Tracks"],
            ["contest_entry", "Contest songs"],
          ] as const
        ).map(([value, label]) => (
          <button key={value} className={`chip${itemType === value ? " selected" : ""}`} onClick={() => setItemType(value)}>
            {label}
          </button>
        ))}
      </div>

      {error && <p className="tc-error">{error}</p>}
      {items === null && !error && <p>Loading...</p>}
      {items && items.length === 0 && <p style={{ color: "var(--text-dim)" }}>No likes yet.</p>}
      {items && items.length > 0 && (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="t3s-table">
            <thead>
              <tr>
                <th>Song</th>
                <th>Type</th>
                <th>
                  <button className={`t3s-sort${sort === "total" ? " active" : ""}`} onClick={() => setSort("total")}>
                    Total likes
                  </button>
                </th>
                <th>
                  <button className={`t3s-sort${sort === "week" ? " active" : ""}`} onClick={() => setSort("week")}>
                    This week
                  </button>
                </th>
                <th>Last liked</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={`${i.itemType}:${i.itemId}`}>
                  <td>
                    {i.itemType === "track" ? (
                      <Link to={`/track/${i.itemId}`} target="_blank">
                        {i.title ?? "(deleted track)"}
                      </Link>
                    ) : (
                      <Link to="/studio/contest">
                        #{i.itemId} {i.title ?? "(deleted entry)"}
                      </Link>
                    )}
                    {i.artist && <span style={{ color: "var(--text-dim)" }}> · {i.artist}</span>}
                  </td>
                  <td>{i.itemType === "track" ? "Track" : "Contest song"}</td>
                  <td>{i.likes}</td>
                  <td>{i.likes7d}</td>
                  <td>{i.lastLikedAt ? new Date(i.lastLikedAt).toLocaleDateString() : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
