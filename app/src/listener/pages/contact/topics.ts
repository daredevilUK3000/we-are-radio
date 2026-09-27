/**
 * The six "lines" on the contact page's switchboard, and what each one asks
 * for. Keep the keys, field names and required flags in step with TOPICS in
 * worker/src/routes/contact.ts, which checks them again.
 */

export const CONTACT_EMAIL = "info@weareradio.app";
/** Promised in the aside, the FAQ and the confirmation email (the worker has the same number). */
export const REPLY_DAYS = 3;

export type TopicKey = "studio" | "request" | "top3" | "business" | "press" | "problem";

export interface ExtraField {
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  type?: "text" | "url" | "date";
  inputMode?: "numeric";
  autoComplete?: string;
  /** Narrow field (the Top 3 song number). */
  narrow?: boolean;
}

export interface Topic {
  key: TopicKey;
  line: number;
  title: string;
  text: string;
  heading: string;
  short: string;
  placeholder: string;
  fields: ExtraField[];
}

export const TOPICS: Topic[] = [
  {
    key: "studio",
    line: 1,
    title: "Message the studio",
    text: "Say hello, share a thought, tell us what you love.",
    heading: "Say it to the studio",
    short: "STUDIO",
    placeholder: "Hi Kizzi, I was listening this morning and...",
    fields: [],
  },
  {
    key: "request",
    line: 2,
    title: "Request or dedication",
    text: "Ask for a song, or dedicate one to someone special.",
    heading: "Make a request",
    short: "REQUESTS",
    placeholder: "Tell us why this song, and who it's for.",
    fields: [
      { key: "song", label: "Song and artist", required: true, placeholder: "e.g. Leave a candle burning" },
      { key: "dedicate_to", label: "Dedicate it to", placeholder: "Their first name" },
    ],
  },
  {
    key: "top3",
    line: 3,
    title: "Top 3 competition",
    text: "Questions about entering, your entry, or the vote.",
    heading: "Ask about the Top 3",
    short: "TOP 3",
    placeholder: "What would you like to know about the competition?",
    fields: [{ key: "song_number", label: "Your song number, if you've entered", inputMode: "numeric", narrow: true }],
  },
  {
    key: "business",
    line: 4,
    title: "Sponsorship & advertising",
    text: "Partner with the station or the Top 3 competition.",
    heading: "Let's work together",
    short: "BUSINESS",
    placeholder: "Tell us about your brand and what you have in mind.",
    fields: [
      { key: "company", label: "Company", required: true, autoComplete: "organization" },
      { key: "website", label: "Website", type: "url", placeholder: "https://" },
    ],
  },
  {
    key: "press",
    line: 5,
    title: "Press & media",
    text: "Interviews, features and information for journalists.",
    heading: "Press enquiry",
    short: "PRESS",
    placeholder: "What's the story, and what do you need from us?",
    fields: [
      { key: "outlet", label: "Publication or outlet", required: true },
      { key: "deadline", label: "Your deadline", type: "date" },
    ],
  },
  {
    key: "problem",
    line: 6,
    title: "Problem with the app",
    text: "Something not playing or not working? Tell us.",
    heading: "Report a problem",
    short: "HELP",
    placeholder: "What happened, and what did you expect to happen?",
    fields: [
      { key: "device", label: "Device and browser", required: true },
      { key: "page", label: "Which page?" },
    ],
  },
];

export const topicByKey = (key: string | null | undefined): Topic => TOPICS.find((t) => t.key === key) ?? TOPICS[0];
export const isTopicKey = (key: string | null | undefined): key is TopicKey => TOPICS.some((t) => t.key === key);
export const lineLabel = (t: Topic) => `LINE ${String(t.line).padStart(2, "0")}`;
