import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { studioApi, mediaUrl } from "../../api/client";

export function AlbumDetail() {
  const { id } = useParams();
  const [album, setAlbum] = useState<any>(null);
  const [albumTracks, setAlbumTracks] = useState<any[]>([]);
  const [allTracks, setAllTracks] = useState<any[]>([]);

  const load = async () => {
    if (!id) return;
    const [a, t] = await Promise.all([studioApi.album(id), studioApi.tracks()]);
    setAlbum(a.album);
    setAlbumTracks(a.tracks);
    setAllTracks(t.tracks);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const addTrack = async (trackId: string) => {
    if (!id || !trackId) return;
    await studioApi.updateTrack(trackId, { album_id: id });
    load();
  };

  const removeTrack = async (trackId: string) => {
    await studioApi.updateTrack(trackId, { album_id: null });
    load();
  };

  const setTrackNumber = async (trackId: string, trackNumber: string) => {
    await studioApi.updateTrack(trackId, { track_number: trackNumber ? Number(trackNumber) : null });
    load();
  };

  if (!album) return <p>Loading...</p>;

  const availableTracks = allTracks.filter((t) => t.album_id !== album.id);

  return (
    <div>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", marginBottom: 20 }}>
        {album.artwork_url && (
          <img
            src={mediaUrl(album.artwork_url)}
            alt=""
            width={140}
            height={140}
            style={{ objectFit: "cover", borderRadius: 8 }}
          />
        )}
        <div>
          <h1 style={{ marginTop: 0, marginBottom: 4 }}>{album.title}</h1>
          <p style={{ color: "var(--text-dim)" }}>{album.description}</p>
        </div>
      </div>

      <h3>Tracks on this album</h3>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Title</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {albumTracks.map((t) => (
            <tr key={t.id}>
              <td style={{ width: 60 }}>
                <input
                  type="number"
                  defaultValue={t.track_number ?? ""}
                  onBlur={(e) => setTrackNumber(t.id, e.target.value)}
                  style={{ width: 50 }}
                />
              </td>
              <td>{t.title}</td>
              <td>
                <span className="badge">{t.status}</span>
              </td>
              <td>
                <button className="btn" onClick={() => removeTrack(t.id)}>
                  Remove from album
                </button>
              </td>
            </tr>
          ))}
          {albumTracks.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: "var(--text-dim)" }}>
                No tracks assigned yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="card" style={{ marginTop: 16 }}>
        <h4 style={{ marginTop: 0 }}>Add a track</h4>
        <select onChange={(e) => e.target.value && addTrack(e.target.value)} value="">
          <option value="">+ Add track to this album...</option>
          {availableTracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
