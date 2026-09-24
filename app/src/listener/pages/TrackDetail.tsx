import { useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { publicApi, listenerApi, mediaUrl } from "../../api/client";
import { FavouriteButton } from "../components/FavouriteButton";
import { LikeButton, useLikes } from "../components/LikeButton";
import { ShareButton } from "../components/ShareButton";
import { PlayerCard } from "../components/PlayerCard";
import { useExclusiveAudio } from "../lib/audioUtils";
import { unlockAudio, useOverlayJingles } from "../../shared/duckEngine";
import { usePlaySlot } from "../../shared/analytics";

/**
 * A single track's own shareable page (handoff: shareable links, then the
 * redesign that followed it). Built on the site's own pieces rather than a
 * one-off: the artwork panel reuses the Featured Album section's spin-ring
 * and shine-sweep classes (.fa-*), the player is the same PlayerCard used on
 * the programme/session/Radio That Knows You pages (not a bare native
 * <audio>), and /api/tracks/:id now goes through withPinnedOverlays like
 * every other direct-play route - a track pinned a jingle to plays it here
 * too, and a track with no artwork of its own falls back to its album's.
 *
 * Opening a fresh page load is never a user gesture, so true autoplay is
 * usually blocked - a clear Play button is the fallback either way asks for.
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
  const [paused, setPaused] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const plays = usePlaySlot();
  const autoplayed = useRef(false);
  const hasStarted = useRef(false);
  const likes = useLikes("track", track ? [track.id] : []);

  useExclusiveAudio("track", audioRef, !!track, () => setPaused(true));
  useOverlayJingles(audioRef, track, !!track);

  useEffect(() => {
    if (!id) return;
    setLoadError(null);
    setTrack(null);
    hasStarted.current = false;
    publicApi
      .track(id)
      .then((r) => setTrack(r.track))
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load track"));
  }, [id]);

  // Ready to play the moment the track loads, so the big button and
  // PlayerCard's own play button both just toggle from here on.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track?.audio_url) return;
    audio.src = mediaUrl(track.audio_url);
  }, [track]);

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio || !track?.audio_url) return;
    if (audio.paused) {
      void unlockAudio(audio);
      if (!hasStarted.current) {
        hasStarted.current = true;
        listenerApi.recordPlay("track", track.id).catch(() => {});
        plays.start({ contentType: "track", contentId: track.id, source: "album" }, audio);
      }
      audio.play().then(
        () => setPaused(false),
        () => setPaused(true) // the browser refused to start it by itself - the Play button stays visible
      );
    } else {
      audio.pause();
    }
  };

  // A link with ?autoplay=1 (e.g. followed straight from a share) tries to start right away -
  // it still needs a user gesture to actually play, same as the album and programme pages.
  useEffect(() => {
    if (searchParams.get("autoplay") !== "1" || autoplayed.current || !track) return;
    autoplayed.current = true;
    togglePlayPause();
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

  const artworkUrl = track.artwork_url ?? track.album_artwork_url;
  const shareText = `Listen to "${track.title}" on We Are Radio`;

  return (
    <div>
      <div className="td-hero">
        <div className="fa-art-wrap td-art-wrap">
          <div className="fa-ring" aria-hidden="true" />
          <div className="fa-art">
            {artworkUrl ? (
              <img src={mediaUrl(artworkUrl)} alt="" />
            ) : (
              <div className="fa-art-placeholder" />
            )}
            <div className="fa-shine" aria-hidden="true" />
            <button className="td-play-btn" onClick={togglePlayPause} aria-label={paused ? "Play" : "Pause"}>
              {paused ? (
                <span className="play-triangle" />
              ) : (
                <span className="pl-pause-icon">
                  <span />
                  <span />
                </span>
              )}
            </button>
          </div>
        </div>

        <div className="td-info">
          <h1 className="td-title">{track.title}</h1>
          {track.artist && <p className="td-artist">{track.artist}</p>}
          {track.album_id && (
            <Link to={`/albums/${track.album_id}`} className="td-album-link">
              From the album{track.album_title ? ` — ${track.album_title}` : ""} &rarr;
            </Link>
          )}

          <div className="td-actions">
            <button className="pill-btn pill-btn-solid" onClick={togglePlayPause}>
              {paused ? <span className="play-triangle" /> : <span className="pl-pause-icon"><span /><span /></span>}
              {paused ? "Play" : "Pause"}
            </button>
            <LikeButton liked={likes.isLiked(track.id)} onToggle={() => likes.toggle(track.id)} className="td-icon-btn" iconOnly />
            <FavouriteButton itemType="track" itemId={track.id} className="td-icon-btn" />
            <ShareButton path={`/track/${track.id}`} title={`${track.title} - We Are Radio`} text={shareText} className="td-icon-btn" iconOnly />
          </div>
        </div>
      </div>

      <div className="td-player">
        <PlayerCard audioRef={audioRef} title={track.title} fallbackDuration={track.duration_seconds} hideInfo showVolume />
      </div>

      <div className="td-airing">
        <div>
          <div className="td-airing-eyebrow">
            <span className="mp-onair-dot" />
            Currently airing on Kizzi Radio
          </div>
          <p className="td-airing-body">This track is one of hundreds on We Are Radio — a station that never stops.</p>
        </div>
        <Link to="/channel/kizzi-radio" className="pill-btn pill-btn-solid">
          Listen Live
        </Link>
      </div>

      <audio
        ref={audioRef}
        onEnded={() => {
          plays.complete();
          hasStarted.current = false;
          setPaused(true);
        }}
        onPlay={() => {
          void unlockAudio(audioRef.current);
          setPaused(false);
        }}
        onPause={() => setPaused(true)}
        style={{ display: "none" }}
      />
    </div>
  );
}
