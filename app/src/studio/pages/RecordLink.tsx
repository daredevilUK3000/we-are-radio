import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { studioApi, uploadFileToR2 } from "../../api/client";
import { recordingToWav } from "../lib/wav";

/**
 * Record a spoken link straight into the link bank. These are the short clips
 * the Radio Brain drops into a "Radio That Knows You" programme - an intro, a
 * bridge between songs, a fun fact, an outro - so a listener hears Kizzi
 * presenting their little show. Recorded once, used for every listener.
 */

export const LINK_KINDS: { value: string; label: string; hint: string }[] = [
  { value: "intro", label: "Intro", hint: "Opens the programme: 'Hi, it's Kizzi - here's a little radio for you...'" },
  { value: "transition", label: "Transition", hint: "Bridges two songs: 'That was..., and next up...'" },
  { value: "fun_fact", label: "Fun fact", hint: "A short drop-in about a song, a mood, or something to smile at." },
  { value: "observation", label: "Observation", hint: "A funny or thoughtful aside between songs." },
  { value: "outro", label: "Outro", hint: "Closes the programme: 'That's your little radio - come back any time.'" },
];

// Each need's key is also the tag that says "this link is made for that need".
export const NEED_TAGS: { key: string; label: string }[] = [
  { key: "energy", label: "⚡ Energy" },
  { key: "love", label: "❤️ Love" },
  { key: "switch-off", label: "🌙 Switch off" },
  { key: "fun", label: "🎉 Fun" },
];

const MAX_SECONDS = 45;

type Stage = "idle" | "recording" | "converting" | "recorded";

export function RecordLink() {
  const [stage, setStage] = useState<Stage>("idle");
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [wav, setWav] = useState<{ blob: Blob; seconds: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const [kind, setKind] = useState("intro");
  const [needs, setNeeds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [said, setSaid] = useState("");
  const [publish, setPublish] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | undefined>(undefined);
  const meterRef = useRef<{ context: AudioContext; raf: number } | null>(null);
  const startedAt = useRef(0);

  const releaseMic = () => {
    window.clearInterval(timerRef.current);
    if (meterRef.current) {
      cancelAnimationFrame(meterRef.current.raf);
      void meterRef.current.context.close();
      meterRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setLevel(0);
  };

  useEffect(() => releaseMic, []);
  useEffect(() => {
    if (!wav) return setPreviewUrl(null);
    const url = URL.createObjectURL(wav.blob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [wav]);

  const startRecording = async () => {
    setError(null);
    setWav(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = stream;

      // A level meter, so Kizzi can see the microphone is hearing her.
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const meter = { context, raf: 0 };
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
        setLevel(peak);
        meter.raf = requestAnimationFrame(tick);
      };
      meter.raf = requestAnimationFrame(tick);
      meterRef.current = meter;

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        releaseMic();
        setStage("converting");
        try {
          const result = await recordingToWav(new Blob(chunksRef.current, { type: recorder.mimeType }));
          setWav(result);
          setStage("recorded");
        } catch {
          setError("That recording couldn't be read - please try again.");
          setStage("idle");
        }
      };
      recorderRef.current = recorder;
      recorder.start();
      startedAt.current = Date.now();
      setSeconds(0);
      setStage("recording");
      timerRef.current = window.setInterval(() => {
        const s = (Date.now() - startedAt.current) / 1000;
        setSeconds(s);
        if (s >= MAX_SECONDS) stopRecording();
      }, 200);
    } catch {
      releaseMic();
      setError("Couldn't use the microphone. Allow microphone access for this site in your browser, then try again.");
    }
  };

  const stopRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
    window.clearInterval(timerRef.current);
  };

  const save = async () => {
    if (!wav || !title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const safe = title.trim().replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40) || "link";
      const presigned = await studioApi.presignUpload(`link-${safe}.wav`, "audio/wav", "audio");
      await uploadFileToR2(presigned.upload_url, new File([wav.blob], `link-${safe}.wav`, { type: "audio/wav" }));
      const { id } = await studioApi.createAudioAsset({
        type: "link",
        link_kind: kind,
        title: title.trim(),
        description: said.trim() || null,
        duration_seconds: Math.max(1, Math.round(wav.seconds)),
        audio_url: presigned.key,
        status: publish ? "published" : "ready",
      });
      if (needs.length > 0) await studioApi.setAudioAssetTags(id, needs);
      setSavedCount((n) => n + 1);
      setWav(null);
      setStage("idle");
      setTitle("");
      setSaid("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the recording - please try again.");
    } finally {
      setSaving(false);
    }
  };

  const kindInfo = LINK_KINDS.find((k) => k.value === kind);
  const busy = stage === "recording" || stage === "converting" || saving;

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>Record a spoken link</h1>
        <Link to="/studio/audio?tab=spoken" className="btn">
          Back to spoken audio
        </Link>
      </div>
      <p style={{ color: "var(--text-dim)" }}>
        Short clips in your own voice that the radio drops into a listener's personal programme: an intro, a bridge between
        songs, a fun fact, a goodbye. Record a good batch of each kind and the programmes will sound like you presented them.
        Keep each one short - a few seconds to about half a minute.
      </p>

      <div className="card" style={{ display: "grid", gap: 14 }}>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>What kind of link is it?</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {LINK_KINDS.map((k) => (
              <button key={k.value} type="button" className={`chip${kind === k.value ? " selected" : ""}`} onClick={() => setKind(k.value)}>
                {k.label}
              </button>
            ))}
          </div>
          <small style={{ color: "var(--text-dim)" }}>{kindInfo?.hint}</small>
        </div>

        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Which moods is it for?</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {NEED_TAGS.map((n) => (
              <button
                key={n.key}
                type="button"
                className={`chip${needs.includes(n.key) ? " selected" : ""}`}
                onClick={() => setNeeds((p) => (p.includes(n.key) ? p.filter((x) => x !== n.key) : [...p, n.key]))}
              >
                {n.label}
              </button>
            ))}
          </div>
          <small style={{ color: "var(--text-dim)" }}>
            Pick the moods it suits. Leave them all off for a link that works with anything.
          </small>
        </div>

        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>Give it a name (only you see this)</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Friday intro - big energy" disabled={busy} />
        </div>
        <div className="form-row" style={{ marginBottom: 0 }}>
          <label>What you say (optional, to help you find it later)</label>
          <textarea value={said} onChange={(e) => setSaid(e.target.value)} rows={2} disabled={busy} />
        </div>

        <div>
          {stage === "idle" && (
            <button className="btn primary" onClick={startRecording}>
              ● Start recording
            </button>
          )}
          {stage === "recording" && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <button className="btn primary" onClick={stopRecording}>
                ■ Stop
              </button>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>
                <span style={{ color: "var(--accent)" }}>●</span> {seconds.toFixed(1)}s
              </span>
              <span style={{ display: "inline-block", width: 160, height: 8, background: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${Math.min(100, level * 140)}%`, background: "var(--accent)", transition: "width 0.05s" }} />
              </span>
            </div>
          )}
          {stage === "converting" && <span style={{ color: "var(--text-dim)" }}>Preparing your recording...</span>}
          {stage === "recorded" && wav && previewUrl && (
            <div style={{ display: "grid", gap: 10 }}>
              <span style={{ color: "var(--text-dim)" }}>Recorded {wav.seconds.toFixed(1)} seconds. Have a listen:</span>
              <audio controls src={previewUrl} style={{ width: "100%" }} />
              {wav.seconds > 40 && <span style={{ color: "#f0a12a" }}>That's quite long for a link - shorter ones work better.</span>}
              <label className="bi-inline">
                <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} /> add straight to the link bank
                (live in listeners' programmes)
              </label>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="btn primary" onClick={save} disabled={saving || !title.trim()}>
                  {saving ? "Saving..." : "Save link"}
                </button>
                <button className="btn" onClick={() => { setWav(null); setStage("idle"); }} disabled={saving}>
                  Re-record
                </button>
              </div>
              {!title.trim() && <small style={{ color: "#f0a12a" }}>Give it a name first.</small>}
            </div>
          )}
        </div>

        {error && <p style={{ color: "var(--accent)", margin: 0 }}>{error}</p>}
        {savedCount > 0 && stage === "idle" && (
          <p style={{ margin: 0 }}>
            Saved {savedCount} link{savedCount === 1 ? "" : "s"} this session. Record another, or{" "}
            <Link to="/studio/audio?tab=spoken">see them all</Link>.
          </p>
        )}
      </div>
    </div>
  );
}
