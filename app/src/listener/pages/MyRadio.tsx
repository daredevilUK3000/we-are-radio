import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listenerApi, mediaUrl } from "../../api/client";
import { useListenerAuth } from "../auth/ListenerAuthContext";
import { useFavourites } from "../favourites/FavouritesContext";

// Tracks don't have their own listener page yet - link to the album that
// contains them (AlbumDetail is where a track is actually playable), or the
// album list as a last resort for an unassigned track.
function detailPath(itemType: string, itemId: string, item: any): string {
  if (itemType === "album") return `/albums/${itemId}`;
  if (itemType === "programme") return `/programmes/${itemId}`;
  return item.album_id ? `/albums/${item.album_id}` : "/albums";
}

function LoginForm() {
  const { login } = useListenerAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(password);
    } catch {
      setError("Incorrect password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 320, margin: "40px auto" }}>
      <h1>My Radio</h1>
      <p style={{ color: "var(--text-dim)" }}>
        Sign in to save favourites and see your listening history across your own devices.
      </p>
      <form onSubmit={submit}>
        <div className="form-row">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        </div>
        {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
        <button className="btn primary" disabled={submitting} type="submit">
          {submitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export function MyRadio() {
  const { status, logout } = useListenerAuth();
  const { favourites, loading } = useFavourites();
  const [history, setHistory] = useState<any[]>([]);

  useEffect(() => {
    if (status !== "authenticated") return;
    listenerApi
      .history()
      .then((r) => setHistory(r.history))
      .catch(() => setHistory([]));
  }, [status]);

  if (status === "checking") return <p>Loading...</p>;
  if (status === "anonymous") return <LoginForm />;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1>My Radio</h1>
        <button className="btn" onClick={() => logout()}>
          Sign out
        </button>
      </div>

      <section style={{ marginBottom: 32 }}>
        <h2>Favourites</h2>
        <div className="grid">
          {favourites.map((f) => (
            <Link
              key={`${f.item_type}:${f.item_id}`}
              to={detailPath(f.item_type, f.item_id, f.item)}
              className="card"
            >
              {f.item.artwork_url && (
                <img
                  src={mediaUrl(f.item.artwork_url)}
                  alt=""
                  width={120}
                  height={120}
                  style={{ objectFit: "cover", borderRadius: 6, marginBottom: 8 }}
                />
              )}
              <span className="badge">{f.item_type}</span>
              <div style={{ fontWeight: 600 }}>{f.item.title}</div>
            </Link>
          ))}
          {!loading && favourites.length === 0 && (
            <div style={{ color: "var(--text-dim)" }}>
              No favourites yet - look for the ♡ button on a track, album or programme.
            </div>
          )}
        </div>
      </section>

      <section>
        <h2>Recently played</h2>
        <div className="grid">
          {history.map((h) => (
            <Link
              key={`${h.item_type}:${h.item_id}`}
              to={detailPath(h.item_type, h.item_id, h.item)}
              className="card"
            >
              {h.item.artwork_url && (
                <img
                  src={mediaUrl(h.item.artwork_url)}
                  alt=""
                  width={120}
                  height={120}
                  style={{ objectFit: "cover", borderRadius: 6, marginBottom: 8 }}
                />
              )}
              <span className="badge">{h.item_type}</span>
              <div style={{ fontWeight: 600 }}>{h.item.title}</div>
            </Link>
          ))}
          {history.length === 0 && (
            <div style={{ color: "var(--text-dim)" }}>Nothing played yet on this account.</div>
          )}
        </div>
      </section>
    </div>
  );
}
