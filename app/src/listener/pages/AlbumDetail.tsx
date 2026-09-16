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
      <h1>{album.title}</h1>
      <p style={{ color: "var(--text-dim)" }}>{album.description}</p>
      <button className="btn primary" style={{ marginBottom: 20 }} onClick={playAlbum} disabled={tracks.length === 0}>
        Play Album
      </button>
      <table>
        <tbody>
          {tracks.map((t, index) => (
            <tr key={t.id} style={playingIndex === index ? { color: "var(--accent)" } : undefined}>
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
              <td colSpan={4} style={{ color: "var(--text-dim)" }}>
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
