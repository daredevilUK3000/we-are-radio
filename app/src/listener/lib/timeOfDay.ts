import type { TimeOfDayBand } from "../../shared/moods";

// Phase 3 (handoff_radio_brain_roadmap.md): which live channel the main
// player defaults to for each time band. Only "morning" (Kizzi Radio) and
// "night" (We Are After Dark) are specified directly by the brief ("Kizzi
// Radio for a morning feel... We Are After Dark late at night"); afternoon
// and evening fill in the two live channels left (We Are Love as the
// "warmer material" the brief calls for in the afternoon, We Are 50s for a
// lighter evening wind-down) - easy to re-map here if that pairing doesn't
// feel right once it's actually live.
const BAND_CHANNELS: Record<TimeOfDayBand, string> = {
  morning: "kizzi-radio",
  afternoon: "we-are-love",
  evening: "we-are-50s",
  night: "we-are-after-dark",
};

// The band whose startHour is the largest one <= the current hour wins -
// night (22:00) naturally wins back over evening once it starts, and wraps
// around to cover the small hours (00:00-04:59) before morning begins.
const BAND_START_HOURS: { band: TimeOfDayBand; startHour: number }[] = [
  { band: "morning", startHour: 5 },
  { band: "afternoon", startHour: 12 },
  { band: "evening", startHour: 17 },
  { band: "night", startHour: 22 },
];

export function currentTimeBand(date: Date = new Date()): TimeOfDayBand {
  const hour = date.getHours();
  const started = BAND_START_HOURS.filter((b) => hour >= b.startHour);
  if (started.length === 0) return "night"; // 00:00-04:59, still last night's band
  return started.reduce((latest, b) => (b.startHour > latest.startHour ? b : latest)).band;
}

export function channelForBand(band: TimeOfDayBand): string {
  return BAND_CHANNELS[band];
}

export function currentTimeOfDayChannel(date: Date = new Date()): { band: TimeOfDayBand; channelSlug: string } {
  const band = currentTimeBand(date);
  return { band, channelSlug: channelForBand(band) };
}
