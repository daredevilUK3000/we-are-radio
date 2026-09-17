import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { publicApi, mediaUrl } from "../../api/client";

export function AlbumDetail() {
  const { id } = useParams();
  const [album, setAlbum] = useState<any>(null);
  const [tracks, setTracks] = useState<any[]>([]);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!id) return;
    publicApi.album(id).then((r) => {
      setAlbum(r.album);
      setTracks(r.tracks);
    });
  }, [id]);

  const playIndex = (index: number) => {
    const track = tracks[index];
    if (!track?.audio_url || !audioRef.current) return;
    setPlayingIndex(index);
    audioRef.current.src = mediaUrl(track.audio_url);
    audioRef.current.play().catch(() => {});
  };

  const playAlbum = () => playIndex(0);

  const onEnded = () => {
    if (playingIndex === null) return;
    if (playingIndex + 1 < tracks.length) {
      playIndex(playingIndex + 1);
    } else {
      setPlayingIndex(null);
    }
  };

  if (!album) return <p>Loading...</p>;

  return (
    <div>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", marginBottom: 20 }}>
        {album.artwork_url ? (
          <img
            src={mediaUrl(album.artwork_url)}
            alt=""
            width={160}
            height={160}
            style={{ objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
          />
        ) : (
          <div
            style={{
              width: 160,
              height: 160,
              borderRadius: 8,
              background: "var(--bg-raised)",
              border: "1px solid var(--border)",
              flexShrink: 0,
            }}
          />
        )}
        <div>
          <h1 style={{ marginTop: 0 }}>{album.title}</h1>
          <p style={{ color: "var(--text-dim)" }}>{album.description}</p>
          <button className="btn primary" onClick={playAlbum} disabled={tracks.length === 0}>
            Play Album
          </button>
        </div>
      </div>
      <table>
        <tbody>
          {tracks.map((t, index) => (
            <tr key={t.id} style={playingIndex === index ? { color: "var(--accent)" } : undefined}>
              <td style={{ width: 40 }}>
                {t.artwork_url ? (
                  <img
                    src={mediaUrl(t.artwork_url)}
                    alt=""
                    width={32}
                    height={32}
                    style={{ objectFit: "cover", borderRadius: 4, display: "block" }}
                  />
                ) : null}
              </td>
              <td>{t.track_number}</td>
              <td>{t.title}</td>
              <td>{Math.round(t.duration_seconds / 60)} min</td>
              <td>
                <button className="btn" onClick={() => playIndex(index)}>
                  {playingIndex === index ? "Playing" : "Play"}
                </button>
              </td>
            </tr>
          ))}
          {tracks.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: "var(--text-dim)" }}>
                No published tracks on this album yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <audio ref={audioRef} onEnded={onEnded} style={{ width: "100%", marginTop: 20 }} controls />
    </div>
  );
}
