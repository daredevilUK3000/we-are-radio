export type Env = {
  DB: D1Database;
  MEDIA: R2Bucket;
  CONFIG: KVNamespace;
  ASSETS: Fetcher;

  STUDIO_PASSWORD: string;
  LISTENER_PASSWORD: string;
  SESSION_SECRET: string;

  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_ACCOUNT_ID: string;
  R2_BUCKET_NAME: string;

  ANTHROPIC_API_KEY: string;
};

export type ContentStatus = "draft" | "processing" | "ready" | "published" | "archived";
export type ProgrammeStatus = "draft" | "preview" | "published" | "archived";
export type ChannelStatus = "building" | "live";
export type ProgrammeItemType = "song" | "link" | "station_id" | "feature" | "interview";
export type AudioAssetType = "station_id" | "jingle" | "link" | "feature" | "interview" | "promo";

export interface Track {
  id: string;
  title: string;
  album_id: string | null;
  track_number: number | null;
  duration_seconds: number;
  audio_url: string;
  artwork_url: string | null;
  genre: string | null;
  subgenre: string | null;
  energy: string | null;
  tempo_bpm: number | null;
  musical_key: string | null;
  vocal_or_instrumental: string | null;
  explicit: number;
  description: string | null;
  status: ContentStatus;
  release_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Channel {
  id: string;
  slug: string;
  name: string;
  emoji: string | null;
  description: string | null;
  artwork_url: string | null;
  status: ChannelStatus;
  catalogue_rules: string | null;
  created_at: string;
}

export interface Programme {
  id: string;
  channel_id: string;
  title: string;
  description: string | null;
  artwork_url: string | null;
  episode_number: number | null;
  status: ProgrammeStatus;
  is_flagship: number;
  publish_date: string | null;
  duration_seconds: number | null;
  created_at: string;
  updated_at: string;
}

export interface ProgrammeItem {
  id: string;
  programme_id: string;
  position: number;
  item_type: ProgrammeItemType;
  track_id: string | null;
  audio_asset_id: string | null;
  label: string | null;
}

export interface AudioAsset {
  id: string;
  type: AudioAssetType;
  title: string;
  audio_url: string;
  duration_seconds: number;
  description: string | null;
  status: ContentStatus;
  created_at: string;
}
