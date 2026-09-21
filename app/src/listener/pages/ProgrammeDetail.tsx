import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { publicApi, listenerApi, mediaUrl } from "../../api/client";
import { FavouriteButton } from "../components/FavouriteButton";
import { EyebrowPill } from "../components/BrandMark";
import { ProgrammeEqSilhouette } from "../components/HeroBackdrop";
import { PlayerCard } from "../components/PlayerCard";
import { plainText, useExclusiveAudio } from "../lib/audioUtils";
import { unlockAudio, useOverlayJingles } from "../../shared/duckEngine";
import { trackListenNow, usePlaySlot } from "../../shared/analytics";

export function ProgrammeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [programme, setProgramme] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [searchParams] = useSearchParams();
  const autoplayed = useRef(false);
  // The whole programme (or podcast episode), and whichever song inside it is playing.
  const programmePlay = usePlaySlot();
  const songPlay = usePlaySlot();

  useExclusiveAudio("programme", audioRef);
  useOverlayJingles(audioRef, playingIndex !== null ? items[playingIndex] : null, !!programme);

  useEffect(() => {
    if (!id) return;
    publicApi.programme(id).then((r) => {
      setProgramme(r.programme);
      setItems(r.items);
    });
  }, [id]);

  const playIndex = (index: number) => {
    const item = items[index];
    if (!item?.track_audio_url && !item?.audio_asset_audio_url) return;
    setPlayingIndex(index);
    void unlockAudio(audioRef.current);
    audioRef.current!.src = mediaUrl(item.track_audio_url ?? item.audio_asset_audio_url);
    audioRef.current!.play().catch(() => {});
    // Songs are logged as songs; spoken links and podcast audio belong to the programme's own play.
    if (item.track_id) songPlay.start({ contentType: "track", contentId: item.track_id, source: "programme" }, audioRef.current);
    else songPlay.abandon();
  };

  // Start the programme from the top and log it to listening history.
  const startProgramme = () => {
    playIndex(0);
    if (programme) {
      listenerApi.recordPlay("programme", programme.id).catch(() => {});
      programmePlay.start({ contentType: "programme", contentId: programme.id, source: "programme" });
    }
  };

  // Arriving via a landing-page play button (?autoplay=1) starts the episode
  // straight away - the click that got us here is the user gesture browsers
  // require before audio may play.
  useEffect(() => {
    if (searchParams.get("autoplay") !== "1" || autoplayed.current || items.length === 0 || !programme) return;
    autoplayed.current = true;
    startProgramme();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, programme, searchParams]);

  const onEnded = () => {
    songPlay.complete();
    if (playingIndex === null) return;
    if (playingIndex + 1 < items.length) {
      playIndex(playingIndex + 1);
    } else {
      programmePlay.complete();
      setPlayingIndex(null);
    }
  };

  const togglePause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  };

  if (!programme) return <p>Loading...</p>;

  const isPodcast = !!programme.show_name;
  const current = playingIndex !== null ? items[playingIndex] : null;
  const upNext = playingIndex !== null ? items.slice(playingIndex + 1) : items;
  const description = plainText(programme.description);

  return (
    <div>
      <div className="programme-hero-art">
        <ProgrammeEqSilhouette />
      </div>

      <EyebrowPill label={isPodcast ? `Podcast · ${programme.show_name}` : "On Air · Kizzi Radio"} />
      {programme.is_flagship ? <span className="badge live" style={{ marginLeft: 8 }}>FLAGSHIP</span> : null}
      <h1 className="programme-headline">{programme.title}</h1>
      {description && <p className="programme-description" style={{ whiteSpace: "pre-line" }}>{description}</p>}

      <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
        {isPodcast ? (
          <button
            className="pill-btn pill-btn-solid"
            onClick={() => (current ? togglePause() : startProgramme())}
            disabled={items.length === 0}
          >
            {current && !paused ? <span className="pl-pause-icon"><span /><span /></span> : <span className="play-triangle" />}
            {current ? (paused ? "Resume" : "Pause") : "Play episode"}
          </button>
        ) : (
          <>
            <button
              className="pill-btn pill-btn-solid"
              onClick={() => {
                trackListenNow();
                navigate("/listen");
              }}
            >
              <span className="play-triangle" />
              Listen Now
            </button>
            <button className="pill-btn pill-btn-ghost" onClick={startProgramme} disabled={items.length === 0}>
              Listen On Demand
            </button>
          </>
        )}
        <FavouriteButton itemType="programme" itemId={programme.id} />
      </div>

      {current && (
        <PlayerCard
          audioRef={audioRef}
          title={current.label ?? current.track_title ?? current.audio_asset_title}
          artUrl={current.track_artwork_url ?? programme.artwork_url ?? null}
          fallbackDuration={current.audio_asset_duration_seconds ?? current.track_duration_seconds}
          onPrev={!isPodcast && playingIndex! > 0 ? () => playIndex(playingIndex! - 1) : undefined}
          onNext={!isPodcast && playingIndex! + 1 < items.length ? () => playIndex(playingIndex! + 1) : undefined}
        />
      )}

      {!isPodcast && (
        <>
          <h3 style={{ fontFamily: "var(--font-display)", textTransform: "uppercase" }}>
            {current ? "Up Next" : "Running order"}
          </h3>
          <div className="up-next-list">
            {upNext.map((item) => (
              <div key={item.id} className="up-next-row">
                {item.track_artwork_url ? (
                  <img className="up-next-thumb" src={mediaUrl(item.track_artwork_url)} alt="" />
                ) : (
                  <div className="up-next-thumb" />
                )}
                <span className="up-next-title">{item.label ?? item.track_title ?? item.audio_asset_title}</span>
                <span className="up-next-duration">
                  {Math.round((item.track_duration_seconds ?? item.audio_asset_duration_seconds ?? 0) / 60)} min
                </span>
                <button className="btn" onClick={() => playIndex(items.indexOf(item))} style={{ marginLeft: 8 }}>
                  Play
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <audio
        ref={audioRef}
        onEnded={onEnded}
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        style={{ display: "none" }}
      />
    </div>
  );
}
