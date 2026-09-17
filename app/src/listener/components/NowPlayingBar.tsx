import { useEffect, useRef, useState } from "react";
import { publicApi, mediaUrl } from "../../api/client";

function PlayIcon() {
  return <span className="play-triangle" />;
}

function PauseIcon() {
  return (
    <span className="mp-pause-icon">
      <span />
      <span />
    </span>
  );
}

export function NowPlayingBar() {
  const [data, setData] = useState<any>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentItemId = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = () => {
      publicApi
        .nowPlaying()
        .then((d) => !cancelled && setData(d))
        .catch(() => !cancelled && setData(null));
    };
    poll();
    const id = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Only touch the <audio> element when the on-air item actually changes -
  // a poll landing mid-song shouldn't restart playback.
  useEffect(() => {
    const item = data?.now_playing;
    const audio = audioRef.current;
    if (!item || !audio) return;
    if (currentItemId.current === item.id) return;
    currentItemId.current = item.id;

    if (!item.audio_url) return;
    audio.src = mediaUrl(item.audio_url);
    audio.currentTime = data.position_seconds ?? 0;
    if (playing) audio.play().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  if (!data || !data.on_air) return null;

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
    } else {
      audio.play().catch(() => {});
      setPlaying(true);
    }
  };

  return (
    <div className="now-playing-bar">
      {data.now_playing?.artwork_url ? (
        <img className="mp-art" src={mediaUrl(data.now_playing.artwork_url)} alt="" />
      ) : (
        <div className="mp-art" />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <span className="mp-onair">
          <span className="mp-onair-dot" /> On Air
        </span>
        <div className="mp-title">{data.now_playing?.label ?? "Kizzi Radio"}</div>
        <div className="mp-programme">
          {data.up_next ? `Up next: ${data.up_next.label}` : data.programme?.title}
        </div>
      </div>
      <button className="mp-play-btn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
        {playing ? <PauseIcon /> : <PlayIcon />}
      </button>
      <audio
        ref={audioRef}
        onEnded={() => publicApi.nowPlaying().then(setData).catch(() => {})}
      />
    </div>
  );
}
