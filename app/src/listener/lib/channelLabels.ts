import { channelInfo } from "../../shared/channelInfo";

// The display name for whichever channel the time-of-day flow (and Vibe
// Shift) has tuned to, from the channel rows already fetched by
// ActiveChannelContext - so anything showing "the current channel" can label
// it without another fetch.
export const channelLabel = (slug: string | null | undefined): string | undefined => channelInfo(slug)?.name;
