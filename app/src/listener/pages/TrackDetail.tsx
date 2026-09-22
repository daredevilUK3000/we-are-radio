import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { publicApi, listenerApi, mediaUrl } from "../../api/client";
import { FavouriteButton } from "../components/FavouriteButton";
import { ShareButton } from "../components/ShareButton";
import { useExclusiveAudio } from "../lib/audioUtils";
import { unlockAudio, useOverlayJingles } from "../../shared/duckEngine";
import { usePlaySlot } from "../../shared/analytics";

/**
 * A single track's own shareable page (handoff: shareable links). Opening a
 * fresh page load is never a user gesture, so true autoplay is usually
 * blocked - a clear Play button is the fallback the handoff asks for.
 * Analytics-wise this is logged the same as playing a track from its album
 * (source: "album") rather than a fifth source, since it's the same kind of
 * play - one song, no rotation - just reached by a direct link instead of
 * an album page.
 */
export function TrackDetail() {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const [track, setTrack] = useState<any>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const plays = usePlaySlot();
  const autoplayed = useRef(false);

  useExclusiveAudio("track", audioRef, !!track, () => setPlaying(false));
  useOverlayJingles(audioRef, track, !!track);

  useEffect(() => {
    if (!id) return;
    setLoadError(null);
    setTrack(null);
    publicApi
      .track(id)
      .then((r) => setTrack(r.track))
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load track"));
  }, [id]);

  const play = () => {
    const audio = audioRef.current;
    if (!audio || !track?.audio_url) return;
    void unlockAudio(audio);
    audio.src = mediaUrl(track.audio_url);
    audio.play().then(
      () => setPlaying(true),
      () => setPlaying(false) // the browser refused to start it by itself - the Play button stays visible
    );
    listenerApi.recordPlay("track", track.id).catch(() => {});
    plays.start({ contentType: "track", contentId: track.id, source: "album" }, audio);
  };

  // A link with ?autoplay=1 (e.g. followed straight from a share) tries to start right away,
  // same as the album and programme pages - it still needs a user gesture to actually play.
  useEffect(() => {
    if (searchParams.get("autoplay") !== "1" || autoplayed.current || !track) return;
    autoplayed.current = true;
    play();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track, searchParams]);

  if (loadError) {
    return (
      <p style={{ color: "var(--accent)" }}>
        Couldn't load this track ({loadError}).
      </p>
    );
  }
  if (!track) return <p>Loading...</p>;

  const shareText = `Listen to "${track.title}" on We Are Radio`;

  return (
    <div>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", marginBottom: 20 }}>
        {track.artwork_url ? (
          <img
            src={mediaUrl(track.artwork_url)}
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
          <h1 style={{ marginTop: 0, marginBottom: 4 }}>{track.title}</h1>
          {track.artist && <p style={{ color: "var(--text-dim)", margin: "0 0 4px" }}>{track.artist}</p>}
          {track.album_id && (
            <p style={{ margin: "0 0 12px" }}>
              <Link to={`/albums/${track.album_id}`} style={{ color: "var(--text-dim)" }}>
                From the album
              </Link>
            </p>
          )}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn primary" onClick={play}>
              {playing ? "Playing" : "Play"}
            </button>
            <FavouriteButton itemType="track" itemId={track.id} />
            <ShareButton path={`/track/${track.id}`} title={`${track.title} - We Are Radio`} text={shareText} />
          </div>
        </div>
      </div>

      <audio
        ref={audioRef}
        onEnded={() => {
          plays.complete();
          setPlaying(false);
        }}
        onPlay={() => {
          void unlockAudio(audioRef.current);
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        style={{ width: "100%" }}
        controls
      />
    </div>
  );
}
