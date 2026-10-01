import { MicIcon } from "./SayItOnAir";

/** The public details of a listener's voice note on air (now_playing.voice, from the Worker). */
export interface VoiceInfo {
  first_name: string;
  place: string;
  kind: "shoutout" | "dedication" | "reaction" | "question";
  for_name: string;
}

/** "Sarah in Leeds", and "Dedication for Mum" under it when it's a dedication. */
export function voiceLines(v: VoiceInfo): { title: string; sub: string | null } {
  const title = `${v.first_name}${v.place ? ` in ${v.place}` : ""}`;
  const sub =
    v.kind === "dedication" && v.for_name ? `Dedication for ${v.for_name}` : v.kind === "question" ? "A question for Kizzi" : v.kind === "reaction" ? "Their take on the last song" : "Shout-out";
  return { title, sub };
}

export function ListenerVoicePill() {
  return (
    <span className="lv-pill">
      <MicIcon size={11} /> Listener voice
    </span>
  );
}
