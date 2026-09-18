import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { publicApi, mediaUrl } from "../../api/client";

export function Listen() {
  const [searchParams] = useSearchParams();
  const channelSlug = searchParams.get("channel") ?? "kizzi-radio";
  const [data, setData] = useState<any>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const currentItemId = useRef<string | null>(null);

  useEffect(() => {
    setData(null);
    currentItemId.current = null;
    setPlaying(false);
    const poll = () => publicApi.nowPlaying(channelSlug).then(setData).catch(() => {});
    poll();
    const id = setInterval(poll, 15_000);
    return () => clearInterval(id);
  }, [channelSlug]);

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

  if (!data) return <p>Tuning in...</p>;
  if (!data.on_air) return <p>{data.channel?.name ?? "This channel"} isn't broadcasting anything published yet.</p>;

  return (
    <div>
      <span className="on-air-badge">
        <span className="on-air-dot" /> ON AIR &middot; {data.channel.name}
      </span>
      <h1 style={{ marginBottom: 4 }}>{data.programme?.title}</h1>
      <p style={{ color: "var(--text-dim)" }}>{data.programme?.description}</p>

      <div className="card" style={{ marginBottom: 16, display: "flex", alignItems: "center", gap: 16 }}>
        {data.now_playing?.artwork_url ? (
          <img
            src={mediaUrl(data.now_playing.artwork_url)}
            alt=""
            width={56}
            height={56}
            style={{ objectFit: "cover", borderRadius: 8, flexShrink: 0 }}
          />
        ) : (
          <div style={{ width: 56, height: 56, borderRadius: 8, background: "var(--bg)", flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginBottom: 4 }}>NOW PLAYING</div>
          <div style={{ fontWeight: 700, fontSize: "1.1rem" }}>{data.now_playing?.label}</div>
        </div>
        <button className="mp-play-btn" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
          {playing ? (
            <span className="mp-pause-icon">
              <span />
              <span />
            </span>
          ) : (
            <span className="play-triangle" />
          )}
        </button>
      </div>

      {data.up_next && (
        <div className="card">
          <div style={{ fontSize: "0.75rem", color: "var(--text-dim)", marginBottom: 4 }}>UP NEXT</div>
          <div>{data.up_next.label}</div>
        </div>
      )}

      <audio ref={audioRef} onEnded={() => publicApi.nowPlaying(channelSlug).then(setData).catch(() => {})} />
    </div>
  );
}
