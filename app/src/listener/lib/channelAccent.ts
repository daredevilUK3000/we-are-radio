// The site's four channel accent colors (Now Playing flagship page handoff) -
// red and amber are already the brand's own on-air/warm tones, blue reads
// cool for the after-dark channel, and grey/silver is the neutral default
// for talk-only or not-yet-launched channels rather than guessing a colour
// for them.
const RED = "#E11D2E";
const AMBER = "#F5B942";
const BLUE = "#3E7CB1";
const GREY = "#8B8B93";

const CHANNEL_ACCENT: Record<string, string> = {
  "kizzi-radio": RED,
  "we-are-love": RED,
  "we-are-50s": AMBER,
  "we-are-after-dark": BLUE,
};

export function channelAccent(slug: string | null | undefined): string {
  return (slug && CHANNEL_ACCENT[slug]) || GREY;
}

export const CHANNEL_AMBER = AMBER;
