import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { publicApi } from "../../api/client";

export function AlbumDetail() {
  const { id } = useParams();
  const [album, setAlbum] = useState<any>(null);
  const [tracks, setTracks] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    publicApi.album(id).then((r) => {
      setAlbum(r.album);
      setTracks(r.tracks);
    });
  }, [id]);

  if (!album) return <p>Loading...</p>;

  return (
    <div>
      <h1>{album.title}</h1>
      <p style={{ color: "var(--text-dim)" }}>{album.description}</p>
      <button className="btn primary" style={{ marginBottom: 20 }}>
        Play Album
      </button>
      <table>
        <tbody>
          {tracks.map((t) => (
            <tr key={t.id}>
              <td>{t.track_number}</td>
              <td>{t.title}</td>
              <td>{Math.round(t.duration_seconds / 60)} min</td>
              <td>
                <button className="btn">Play</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
