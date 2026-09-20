import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { publicApi, listenerApi, mediaUrl } from "../../api/client";
import { PlayerCard } from "../components/PlayerCard";
import { useExclusiveAudio } from "../lib/audioUtils";
import { unlockAudio, useOverlayJingles } from "../../shared/duckEngine";
import { useActiveChannel } from "../context/ActiveChannelContext";
import { SessionBuilder } from "./SessionBuilder";

/**
 * Radio That Knows You: the listener says what they need, and gets a produced
 * programme - a name, songs, Kizzi's recorded spoken links, a surprise or two -
 * built on the spot from rules over the catalogue (no AI, no cost per listener).
 *
 * The "Your Radio Is Ready" beat is deliberate pacing: the programme is built
 * almost instantly, and a few seconds of anticipation is what makes it feel
 * made for you.
 */

interface Need {
  key: string;
  label: string;
  emoji: string;
  blurb: string;
}

// Shown if the list can't be fetched, so the page is never an empty screen.
const FALLBACK_NEEDS: Need[] = [
  { key: "energy", label: "I need energy", emoji: "⚡", blurb: "Lift me up and get me moving" },
  { key: "love", label: "I want to fall in love", emoji: "❤️", blurb: "Something warm and romantic" },
  { key: "switch-off", label: "I want to switch off", emoji: "🌙", blurb: "Slow down and let it all go" },
  { key: "fun", label: "I want to have fun", emoji: "🎉", blurb: "Good times, good music" },
];

const BEAT_MS = 3200; // the anticipation beat: never shorter than this
const LENGTHS = [10, 15, 20];

// A short silent clip, played inside the tap so the browser lets the programme
// start by itself a few seconds later (an audio element is unlocked by a tap).
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

function BeatWave() {
  const bars = useMemo(
    () =>
      Array.from({ length: 48 }, (_, i) => ({
        height: 25 + Math.round(Math.abs(Math.sin(i * 1.7) * 55 + Math.cos(i * 0.6) * 20)),
        duration: 0.8 + ((i * 37) % 10) / 10,
        delay: -((i * 13) % 10) / 6,
      })),
    []
  );
  return (
    <div className="np-wave rfy-wave" aria-hidden="true">
      {bars.map((b, i) => (
        <span key={i} style={{ height: `${b.height}%`, animationDuration: `${b.duration}s`, animationDelay: `${b.delay}s` }} />
      ))}
    </div>
  );
}

type Phase = "ask" | "beat" | "programme";

export function RadioForYou() {
  const { band } = useActiveChannel();
  const [needs, setNeeds] = useState<Need[]>(FALLBACK_NEEDS);
  const [minutes, setMinutes] = useState(15);
  const [phase, setPhase] = useState<Phase>("ask");
  const [need, setNeed] = useState<Need | null>(null);
  const [beatStage, setBeatStage] = useState<"building" | "ready">("building");
  const [programme, setProgramme] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const requestId = useRef(0);

  useExclusiveAudio("radio-for-you", audioRef);
  useOverlayJingles(audioRef, playingIndex !== null ? items[playingIndex] : null);

  useEffect(() => {
    publicApi
      .needs()
      .then((r) => r.needs.length > 0 && setNeeds(r.needs))
      .catch(() => {});
  }, []);

  useEffect(() => () => audioRef.current?.pause(), []);

  const playIndex = useCallback((index: number) => {
    const audio = audioRef.current;
    const item = itemsRef.current[index];
    if (!audio || !item?.audio_url) return;
    setPlayingIndex(index);
    setFinished(false);
    audio.src = mediaUrl(item.audio_url);
    audio.play().catch(() => {
      // The browser refused to start it by itself: the player shows Paused with a Play button.
    });
    if (item.item_type === "song" && item.track_id) listenerApi.recordPlay("track", item.track_id).catch(() => {});
  }, []);

  const onEnded = () => {
    if (playingIndex === null) return;
    if (playingIndex + 1 < items.length) playIndex(playingIndex + 1);
    else {
      setPlayingIndex(null);
      setFinished(true);
    }
  };

  const request = useCallback(
    async (chosen: Need) => {
      const audio = audioRef.current;
      // Inside the tap: let the audio element start later without another press.
      if (audio) {
        audio.src = SILENT_WAV;
        audio.play().catch(() => {});
        void unlockAudio(audio);
      }
      const id = ++requestId.current;
      setNeed(chosen);
      setMessage(null);
      setBeatStage("building");
      setPhase("beat");
      setFinished(false);
      setPlayingIndex(null);

      const started = Date.now();
      let result = null as { programme: any; items: any[]; message?: string } | null;
      let failed = false;
      try {
        result = await publicApi.radioForYou(chosen.key, minutes, band);
      } catch {
        failed = true;
      }
      // Hold the beat for its full length even though the programme is already built.
      const wait = Math.max(0, BEAT_MS - 1200 - (Date.now() - started));
      await new Promise((r) => setTimeout(r, wait));
      if (id !== requestId.current) return;
      if (failed || !result?.programme) {
        audio?.pause();
        setMessage(
          failed
            ? "Couldn't make your radio just now - please try again."
            : (result?.message ?? "There isn't any music tagged for that yet - check back soon.")
        );
        setPhase("ask");
        return;
      }
      setBeatStage("ready");
      await new Promise((r) => setTimeout(r, 1200));
      if (id !== requestId.current) return;
      setProgramme(result.programme);
      setItems(result.items);
      itemsRef.current = result.items;
      setPhase("programme");
      playIndex(0);
    },
    [minutes, band, playIndex]
  );

  const restart = () => {
    audioRef.current?.pause();
    requestId.current++;
    setPlayingIndex(null);
    setPhase("ask");
    setMessage(null);
  };

  const songCount = items.filter((i) => i.item_type === "song").length;
  const linkCount = items.filter((i) => i.item_type === "link").length;
  const current = playingIndex !== null ? items[playingIndex] : null;

  return (
    <div className="rfy">
      {phase === "ask" && (
        <>
          <span className="rfy-eyebrow">Radio that knows you</span>
          <h1 className="rfy-h1">What do you need right now?</h1>
          <p className="rfy-lede">Tell us, and we'll create the radio.</p>

          {message && <p className="rfy-message">{message}</p>}

          <div className="rfy-needs">
            {needs.map((n) => (
              <button key={n.key} className="rfy-need" onClick={() => request(n)}>
                <span className="rfy-need-emoji" aria-hidden="true">
                  {n.emoji}
                </span>
                <span className="rfy-need-label">{n.label}</span>
                <span className="rfy-need-blurb">{n.blurb}</span>
              </button>
            ))}
          </div>

          <div className="rfy-length">
            <span>About</span>
            {LENGTHS.map((m) => (
              <button key={m} className={`chip${minutes === m ? " selected" : ""}`} onClick={() => setMinutes(m)}>
                {m} min
              </button>
            ))}
          </div>

          <details className="rfy-classic">
            <summary>Prefer to choose an exact mood and length?</summary>
            <SessionBuilder embedded />
          </details>
        </>
      )}

      {phase === "beat" && (
        <div className="rfy-beat" role="status" aria-live="polite">
          <span className="rfy-eyebrow">{need ? `${need.emoji} ${need.label}` : ""}</span>
          <BeatWave />
          <div className="rfy-beat-title">{beatStage === "building" ? "Building your radio..." : "Your Radio Is Ready"}</div>
        </div>
      )}

      {phase === "programme" && programme && (
        <>
          <span className="rfy-eyebrow">{programme.need_label}</span>
          <h1 className="rfy-h1">{programme.title}</h1>
          <p className="rfy-lede">
            {songCount} song{songCount === 1 ? "" : "s"}
            {linkCount > 0 ? ` and ${linkCount} spoken link${linkCount === 1 ? "" : "s"}` : ""} · about{" "}
            {Math.round(programme.total_duration_seconds / 60)} minutes
          </p>

          {current ? (
            <div className="player-sticky">
              <PlayerCard
                audioRef={audioRef}
                title={current.label}
                artUrl={current.artwork_url}
                fallbackDuration={current.duration_seconds}
                subtitle={`${current.item_type === "link" ? "Spoken link" : current.item_type === "song" ? "Song" : "Station ID"} · part ${
                  (playingIndex ?? 0) + 1
                } of ${items.length}`}
                onPrev={playingIndex! > 0 ? () => playIndex(playingIndex! - 1) : undefined}
                onNext={playingIndex! + 1 < items.length ? () => playIndex(playingIndex! + 1) : undefined}
              />
            </div>
          ) : (
            finished && <p className="rfy-lede">That's your programme. Thanks for listening.</p>
          )}

          <ol className="rfy-order">
            {items.map((item, i) => (
              <li
                key={item.id}
                className={`rfy-item rfy-item-${item.item_type}${playingIndex === i ? " now" : ""}`}
                onClick={() => playIndex(i)}
              >
                <span className="rfy-item-icon" aria-hidden="true">
                  {item.item_type === "link" ? "🎙" : item.item_type === "song" ? "♪" : "◦"}
                </span>
                <span className="rfy-item-title">{item.label}</span>
                <span className="rfy-item-kind">
                  {item.item_type === "link" ? "spoken link" : item.item_type === "song" ? "" : "station ID"}
                </span>
                <span className="rfy-item-time">
                  {item.duration_seconds < 60 ? `${Math.max(1, Math.round(item.duration_seconds))}s` : `${Math.round(item.duration_seconds / 60)} min`}
                </span>
              </li>
            ))}
          </ol>

          <div className="rfy-actions">
            <button className="pill-btn pill-btn-solid" onClick={() => need && request(need)}>
              Another one, same mood
            </button>
            <button className="pill-btn pill-btn-ghost" onClick={restart}>
              Change my mood
            </button>
          </div>
        </>
      )}

      <audio ref={audioRef} onEnded={onEnded} style={{ display: "none" }} />
    </div>
  );
}
