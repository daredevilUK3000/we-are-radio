import { useRef, useState } from "react";
import { publicApi, listenerApi, mediaUrl } from "../../api/client";
import { SelectChips } from "../components/SelectChips";
import { MOOD_OPTIONS } from "../../shared/moods";

const DURATIONS = [15, 30, 45, 60];

export function SessionBuilder() {
  const [mood, setMood] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [session, setSession] = useState<{
    mood: string;
    duration_minutes: number;
    total_duration_seconds: number;
    items: any[];
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  const build = async () => {
    if (!mood || !duration) return;
    setBuilding(true);
    setMessage(null);
    setSession(null);
    setPlayingIndex(null);
    try {
      const r = await publicApi.buildSession(mood, duration);
      if (!r.session) {
        setMessage(r.message ?? "No tracks tagged for that mood yet.");
      } else {
        setSession(r.session);
      }
    } catch {
      setMessage("Couldn't build a session just now - try again.");
    } finally {
      setBuilding(false);
    }
  };

  const playIndex = (index: number) => {
    const item = session?.items[index];
    if (!item?.audio_url || !audioRef.current) return;
    setPlayingIndex(index);
    audioRef.current.src = mediaUrl(item.audio_url);
    audioRef.current.play().catch(() => {});
    if (item.track_id) listenerApi.recordPlay("track", item.track_id).catch(() => {});
  };

  const onEnded = () => {
    if (playingIndex === null || !session) return;
    if (playingIndex + 1 < session.items.length) {
      playIndex(playingIndex + 1);
    } else {
      setPlayingIndex(null);
    }
  };

  return (
    <div>
      <h1>Build a Session</h1>
      <p style={{ color: "var(--text-dim)" }}>
        Pick a mood and how long you've got - we'll put a running order together from the catalogue
        instantly. No account needed, and every build is a fresh mix.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>Mood</h3>
        <SelectChips options={MOOD_OPTIONS} value={mood} onChange={setMood} />

        <h3 style={{ marginBottom: 8 }}>Duration</h3>
        <SelectChips options={DURATIONS} value={duration} onChange={setDuration} labels={(d) => `${d} min`} />

        <button
          className="btn primary"
          style={{ marginTop: 18 }}
          onClick={build}
          disabled={!mood || !duration || building}
        >
          {building ? "Building..." : "Build my session"}
        </button>
      </div>

      {message && <p style={{ color: "var(--text-dim)" }}>{message}</p>}

      {session && (
        <div>
          <h3 style={{ fontFamily: "var(--font-display)", textTransform: "uppercase" }}>
            {session.mood} &middot; ~{Math.round(session.total_duration_seconds / 60)} min
          </h3>
          <div className="up-next-list">
            {session.items.map((item, index) => (
              <div
                key={item.id}
                className="up-next-row"
                style={playingIndex === index ? { borderColor: "var(--accent)" } : undefined}
              >
                <span className="badge">{item.item_type}</span>
                <span className="up-next-title">{item.label}</span>
                <span className="up-next-duration">{Math.round(item.duration_seconds / 60)} min</span>
                <button className="btn" onClick={() => playIndex(index)} style={{ marginLeft: 8 }}>
                  {playingIndex === index ? "Playing" : "Play"}
                </button>
              </div>
            ))}
          </div>
          <audio ref={audioRef} onEnded={onEnded} style={{ display: "none" }} />
        </div>
      )}
    </div>
  );
}
