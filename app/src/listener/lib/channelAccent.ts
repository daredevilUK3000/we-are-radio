import { channelInfo } from "../../shared/channelInfo";

// Each channel's accent colour is on its row now (migrations/0029: red and
// amber are the brand's own on-air/warm tones, blue the after-dark channel's).
// Grey/silver stays the neutral default for a channel without one, rather
// than guessing a colour for it.
const GREY = "#8B8B93";
const AMBER = "#F5B942";

export function channelAccent(slug: string | null | undefined): string {
  return channelInfo(slug)?.accent || GREY;
}

export const CHANNEL_AMBER = AMBER;
