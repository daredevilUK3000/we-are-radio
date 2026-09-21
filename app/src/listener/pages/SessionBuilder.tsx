import { useRef, useState } from "react";
import { publicApi, listenerApi, mediaUrl } from "../../api/client";
import { SelectChips } from "../components/SelectChips";
import { MOOD_OPTIONS } from "../../shared/moods";
import { PlayerCard } from "../components/PlayerCard";
import { useExclusiveAudio } from "../lib/audioUtils";
import { unlockAudio, useOverlayJingles } from "../../shared/duckEngine";
import { usePlaySlot } from "../../shared/analytics";

const DURATIONS = [15, 30, 45, 60];

export function SessionBuilder({ embedded = false }: { embedded?: boolean }) {
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
  const plays = usePlaySlot();

  useExclusiveAudio("session", audioRef, !!session);
  useOverlayJingles(audioRef, playingIndex !== null ? session?.items[playingIndex] : null, !!session);

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
        setMessage(r.message ?? null);
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
    void unlockAudio(audioRef.current);
    audioRef.current.src = mediaUrl(item.audio_url);
    audioRef.current.play().catch(() => {});
    if (item.track_id) listenerApi.recordPlay("track", item.track_id).catch(() => {});
    // My Mood picks a free-form tag, not one of the four Radio That Knows You needs, so no mood is recorded.
    if (item.track_id) plays.start({ contentType: "track", contentId: item.track_id, source: "my-mood" }, audioRef.current);
    else plays.abandon();
  };

  const onEnded = () => {
    plays.complete();
    if (playingIndex === null || !session) return;
    if (playingIndex + 1 < session.items.length) {
      playIndex(playingIndex + 1);
    } else {
      setPlayingIndex(null);
    }
  };

  return (
    <div>
      {!embedded && (
        <>
          <h1>My Mood</h1>
          <p style={{ color: "var(--text-dim)" }}>
            Pick a mood and how long you've got - we'll put a running order together from the catalogue
            instantly. No account needed, and every build is a fresh mix.
          </p>
        </>
      )}

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

          {playingIndex === null ? (
            <button className="pill-btn pill-btn-solid" style={{ marginBottom: 16 }} onClick={() => playIndex(0)}>
              <span className="play-triangle" />
              Play session
            </button>
          ) : (
            <div className="player-sticky">
            <PlayerCard
              audioRef={audioRef}
              title={session.items[playingIndex].label}
              artUrl={session.items[playingIndex].artwork_url}
              fallbackDuration={session.items[playingIndex].duration_seconds}
              subtitle={`Track ${playingIndex + 1} of ${session.items.length}`}
              onPrev={playingIndex > 0 ? () => playIndex(playingIndex - 1) : undefined}
              onNext={playingIndex + 1 < session.items.length ? () => playIndex(playingIndex + 1) : undefined}
            />
            </div>
          )}

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
