# KIZZI RADIO
### Developer Brief — Personal Digital Radio Network & Broadcasting Platform (v2)

**Revision note:** This is an update to the original brief. It incorporates three decisions made since the first draft:
1. **Channel status.** All six planned channels exist in the schema from day one, but only channels marked `live` are visible to listeners. Kizzi Radio launches `live`; the other five launch `building` and become visible only when Kizzi flips them on.
2. **Saturday Morning with Kizzi is a flagship *programme*, not a separate channel.** It airs within the main Kizzi Radio channel and is promoted heavily, rather than existing as its own station.
3. **A detailed core data model** (tracks, channels, programmes, programme items, audio assets, tags) has been specified — see Section 33 below, which replaces the placeholder table list in the original draft. `schedules`, `favourites`, and `listening_history` are deliberately deferred — see the note at the end of Section 33.

Everything else in the original brief still stands. This document is intended to be handed to a developer (or to Claude Code) to generate the D1 (SQLite) DDL and scaffold the build.

---

## Project concept

Kizzi Radio is a personal digital radio network and broadcasting platform built around Kizzi's music catalogue, personality, voice and media background.

The central concept is:

Kizzi Radio is not simply a music-streaming app. It is a personal radio station/network in which Kizzi is the presenter and AI acts as the production assistant.

Kizzi has extensive radio and television presenting experience, a journalism/editing background, and a catalogue of more than 40 self-produced albums available on mainstream streaming platforms.

The app should recreate the experience of tuning into a real radio station, while giving Kizzi complete control over the station's content and programming.

The station is primarily pre-recorded rather than genuinely live. Kizzi should be able to create programmes, upload music and spoken-word content, arrange running orders and publish changes without requiring a new version of the app.

---

## 1. CORE OBJECTIVES

**For listeners**
- Listen to Kizzi Radio continuously.
- Browse and play individual songs.
- Browse albums.
- Listen to programmes.
- Discover different Kizzi Radio channels (only channels marked `live`).
- See what is currently playing.
- See what is coming next.
- Search the catalogue.
- Save favourites.
- Create playlists.
- Resume listening.
- View recently played material.
- Share music/programmes.
- Set a sleep timer.
- Receive notifications about new programmes/music.
- Use the app comfortably on desktop and mobile.

**For Kizzi**

Kizzi needs a private Kizzi Radio Studio / Control Room allowing him to:
- Upload music.
- Upload voice recordings.
- Upload station IDs/jingles.
- Upload programmes.
- Create programmes.
- Create playlists.
- Arrange running orders.
- Schedule programmes.
- Manage all six channels — including the five not yet visible to listeners.
- Edit catalogue metadata, including mood/genre tags.
- Preview programmes.
- Publish programmes.
- Flip a channel's status between `building` and `live`.
- Change station content at any time.
- See what is currently scheduled.
- Manage the entire station without editing code.

**For AI**

AI should function primarily as a radio production assistant, not as the personality of the station. AI should eventually assist with:
- Programme creation.
- Playlist creation.
- Running-order suggestions.
- Music discovery within Kizzi's catalogue.
- Metadata creation.
- Programme descriptions.
- Spoken-link scripts.
- Programme ideas.
- Content categorisation and mood/genre tagging.
- Intelligent scheduling.
- Content recommendations.

Kizzi's real voice should remain the primary presenter voice. AI-generated voice should be optional and should not be the foundation of the product.

---

## 2. IMPORTANT ARCHITECTURAL PRINCIPLE — DO NOT USE SUPABASE

The project should be designed without Supabase. Preferred infrastructure:

- **Cloudflare R2** for audio/media storage.
- **Cloudflare Workers** for server-side functionality/API.
- **Cloudflare CDN/cache** for delivery.
- **Cloudflare D1** where a relational database is genuinely required.
- **Cloudflare KV** where simple key/value storage is appropriate.

The architecture should avoid unnecessary infrastructure and recurring API costs. Favour simple, inexpensive, maintainable infrastructure over automatically introducing third-party services. This is a deliberate departure from Kizzi's other projects (which run on Supabase/Next.js/Vercel) — the cost and architecture win (no egress fees on R2, cheap edge compute) is judged worth the fresh stack to learn.

---

## 3. HIGH-LEVEL ARCHITECTURE

```
                   KIZZI RADIO
                         |
          +--------------+--------------+
          |                             |
    LISTENER APP                 KIZZI RADIO STUDIO
          |                             |
          +--------------+--------------+
                         |
                  CLOUDFLARE WORKERS
                         |
          +--------------+--------------+
          |              |              |
          R2             D1             KV
       AUDIO/IMAGES    DATABASE      CONFIG/CACHE
          |
       CDN/Cache
          |
      Listener
```

The architecture should be modular so that individual components can be replaced later.

---

## 4. AUDIO STORAGE

Cloudflare R2 should be the primary storage location for:
- Music (MP3, AAC/M4A if required, WAV/master files where appropriate — masters should ideally not be publicly accessible).
- Spoken content: presenter links, introductions, features, interviews, station IDs, promos, jingles, programme recordings.
- Artwork: album covers, track artwork, programme artwork, channel artwork, station branding.

The application should not require music to be hosted on Spotify, Apple Music or another streaming service. Kizzi should be able to stream his own recordings directly through Kizzi Radio.

---

## 5. MUSIC CATALOGUE — TAGGING

Each track needs rich metadata, and mood/vibe descriptors (romantic, upbeat, relaxing, dance, rock, pop, instrumental, orchestral, 1950s-inspired, 1960s-inspired, Christmas, summer, night, morning, slow, fast, etc.) should live as a **flexible, growable tag system** rather than fixed columns — see Section 33. This matters for two reasons: it's what lets AI construct programmes intelligently, and it's what lets a channel (Section 10) pull in matching tracks automatically without Kizzi manually assigning each track to a channel.

---

## 6. ALBUMS

The app should have an album catalogue. Each album should contain: artwork, title, description, release date, genre, track list, a "Play Album" button, and individual track controls.

---

## 7. THE RADIO EXPERIENCE

The primary listener experience should feel like radio, not Spotify. The principal call-to-action is **LISTEN NOW**. When pressed, the listener joins the current Kizzi Radio programme. The listener should not need to make a decision about which song to play — they simply tune in.

---

## 8. CONTINUOUS PLAYBACK

The radio player should support continuous programming: station ID → presenter introduction → song → presenter link → song → feature → song → presenter link → song, automatically progressing through the running order. Ideally: no unnecessary silence, preloading of the next audio item, smooth transitions, accurate progress indication, recovery from temporary network interruptions, and continued playback when the screen is locked where platform permissions allow.

---

## 9. PROGRAMMES

Programmes are a major part of the product. A programme has: ID, title, description, artwork, channel, duration, publish date, episode number, status, audio/running order, tags — and, as of this revision, an **`is_flagship`** flag.

**Saturday Morning with Kizzi** is the flagship programme: a 90-minute pre-recorded show airing weekly within the main Kizzi Radio channel (introduction, music, commentary, features, music, closing link), marked `is_flagship = true` so it can be pinned and promoted on the home screen without needing a channel of its own. The listener should be able to choose **Listen Now** or **Listen On Demand**.

---

## 10. CHANNELS

The architecture supports multiple channels from day one, even though only one is visible at launch. A channel is a **curated lens over the shared catalogue** — tracks and programmes are tagged once (Section 5) and each channel's rules automatically pull in matching content. A track never "belongs" to a channel directly.

**Planned channels:**

| Channel | Focus | Launch status |
|---|---|---|
| 🎙️ Kizzi Radio | Main, personality-driven station | `live` |
| 🎸 Kizzi Rock | Rock material | `building` |
| ❤️ Kizzi Love | Romantic music | `building` |
| 🌙 Kizzi After Dark | Slower, atmospheric material | `building` |
| 🎼 Kizzi Instrumental | Instrumental material | `building` |
| 📻 The Kizzi Archive | Older recordings, stories, interviews, career material | `building` |

Each channel supports: name, description, logo/artwork, programme schedule, playlist/catalogue rules, station IDs, and a **status** of `building` or `live` (replacing the earlier "active/inactive" naming to make clear that "not live" means "not ready yet," not "broken").

**Workflow:** Kizzi can upload, tag, and build out a `building` channel — including scheduling programmes and running the AI producer against it — entirely invisibly to listeners. Only `live` channels appear anywhere in the listener app: home screen, "Explore Channels," search results. Flipping a channel from `building` to `live` is one explicit action in the Studio, ideally with a lightweight advisory checklist (minimum tracks tagged, at least one piece of spoken content, artwork set) rather than a hard gate — a nudge, not a blocker.

---

## 11. KIZZI RADIO STUDIO

The private administration system. Main navigation:

```
DASHBOARD

RADIO
  Current Programme
  Schedule
  Channels
  Running Order

MUSIC
  Albums
  Tracks
  Upload Music

AUDIO
  Voice
  Station IDs
  Jingles
  Features
  Interviews

PROGRAMMES
  Programmes
  Episodes
  Playlists

AI PRODUCER

ANALYTICS

SETTINGS
```

---

## 12. DASHBOARD

The dashboard should immediately tell Kizzi: station online status, currently playing track, current programme, what's next, listener count, today's programme count, new music count, and recent activity.

---

## 13. UPLOAD SYSTEM

Files should preferably upload **directly to R2 using secure upload mechanisms** (presigned URLs) rather than passing large audio files through the application server. Upload form fields: title, album, genre, mood, BPM, description, plus audio and artwork file pickers.

---

## 14. PROGRAMME BUILDER

Kizzi should be able to create a programme visually — a drag-and-reorder running order of items (welcome, song, link, song, story, song, thought, song, closing). Items can be dragged, reordered, removed, duplicated, and previewed. The system should calculate total programme duration automatically by summing item durations.

---

## 15. AI PROGRAMME PRODUCER

AI should be integrated into the Studio. Example: Kizzi describes a programme in natural language ("Create a 60-minute upbeat Saturday morning programme using my music, eight songs, spoken link after every two songs, include the story behind 'Closer'"), and AI returns a **proposed** running order — never automatically published. Kizzi can accept, edit, regenerate, or publish. AI must never publish significant content without explicit human approval unless Kizzi later enables an automatic mode.

---

## 16. AI MUSIC SELECTION

AI should search Kizzi's catalogue using natural language ("Find five upbeat romantic songs between three and five minutes," "three slower instrumental tracks for late-night radio," "something energetic to follow this song"), working from actual catalogue metadata — never inventing tracks.

---

## 17. AI METADATA ASSISTANT

When Kizzi uploads a new song, AI can suggest genre, mood, energy, description, tags, and programme suitability, presented as an editable suggestion (Accept / Edit). Kizzi retains final control.

---

## 18. AI SPOKEN-LINK ASSISTANT

Kizzi can ask AI to draft a spoken-link script (e.g. a 30-second introduction to a song), which he then records himself. AI generates the script; Kizzi provides the personality. An optional text-to-speech system could be added later.

---

## 19. STATION IDS / JINGLES

Reusable station elements ("You're listening to Kizzi Radio," "This is Kizzi Radio," etc.), insertable manually or, eventually, by rule (e.g. "insert a station ID every 20 minutes").

---

## 20. SCHEDULING

Kizzi should be able to create a weekly schedule mapping time slots to programmes. The scheduler determines which programme is presented when a listener presses Listen Now. Important: the station does not need to generate a true 24/7 audio stream — the application can dynamically determine the current programme and play its sequence, which keeps the system simpler and cheaper.

---

## 21. ON-DEMAND CONTENT

Every completed programme should optionally become an on-demand episode, so listeners can experience Kizzi Radio either live-style (tune into whatever's currently broadcasting) or on-demand (choose a specific programme).

---

## 22. SEARCH

Search should cover songs, albums, programmes, episodes, channels, and spoken content (Kizzi Talks, features). A query like "Paris" could return songs, albums, and programmes with matching metadata.

---

## 23. LISTENER LIBRARY

Eventually: favourite tracks, favourite programmes, recently played, saved albums, playlists, continue listening. Initial version can store some of this locally; full account sync can come later. (See also the deferral note at the end of Section 33.)

---

## 24. PLAYLISTS

Listeners can create, add to, remove from, reorder, rename, play, and shuffle playlists.

---

## 25. SHARING

Every song/programme/album should have a shareable URL/deep link where possible, taking the recipient directly to the relevant content.

---

## 26. NOTIFICATIONS

Optional, user-controlled notifications: new programme available, new album added, special programme broadcasting.

---

## 27. SLEEP TIMER

15 / 30 / 45 / 60 minutes, end of programme, or off.

---

## 28. LISTENING ANALYTICS

Basic Studio analytics: listeners (today / 7 days / 30 days), top tracks, top programmes, top channels, average listening duration, most popular content. Avoid unnecessarily invasive tracking — collect only what's genuinely useful to operating the station.

---

## 29. PWA / APP STRATEGY

Build initially as a Progressive Web App: mobile-friendly, desktop-friendly, installable, responsive, fast, addable to a phone home screen. This allows testing without maintaining separate native codebases. Native app-store versions can follow later if traction justifies it.

---

## 30. ADMIN SECURITY

The public should never have access to the Studio. The Studio requires authentication. Audio uploads use secure upload URLs. Private/master audio files are never publicly exposed. Admin API endpoints must be protected. No secret API keys in client-side JavaScript.

---

## 31. AI COST CONTROL

AI should not be invoked unnecessarily — never call an AI API just because someone opens a song. AI is used primarily in the Studio for programme creation, metadata generation, content discovery, script generation, and production assistance. Generated results should be saved/cached where practical. The listener-facing experience should function normally even if an AI service is temporarily unavailable.

---

## 32. PERFORMANCE

Fast initial playback, audio preloading, appropriate caching, a responsive player, network-failure recovery, low-bandwidth and mobile-data awareness, artwork optimisation, lazy loading for large catalogues. Investigate appropriate audio formats/bitrates rather than simply serving huge files.

---

## 33. CORE DATA MODEL (DETAILED)

This section replaces the placeholder table list in the original draft. It covers the four tables that should be built first, plus two supporting tables. Everything else is deferred (see note below).

### tracks
```
id                  TEXT PRIMARY KEY
title               TEXT NOT NULL
album_id            TEXT NULL            -- FK -> albums.id
track_number        INTEGER NULL
duration_seconds    INTEGER NOT NULL
audio_url           TEXT NOT NULL        -- R2 key
artwork_url         TEXT NULL
genre               TEXT NULL
subgenre            TEXT NULL
energy              TEXT NULL
tempo_bpm           INTEGER NULL
musical_key         TEXT NULL
vocal_or_instrumental TEXT NULL
explicit            INTEGER DEFAULT 0
description         TEXT NULL
status              TEXT NOT NULL        -- draft | processing | ready | published | archived
release_date        TEXT NULL
created_at          TEXT NOT NULL
updated_at          TEXT NOT NULL
```

### channels
```
id                  TEXT PRIMARY KEY
slug                TEXT UNIQUE NOT NULL -- kizzi-radio, kizzi-rock, kizzi-love, kizzi-after-dark, kizzi-instrumental, kizzi-archive
name                TEXT NOT NULL
emoji               TEXT NULL
description         TEXT NULL
artwork_url         TEXT NULL
status              TEXT NOT NULL        -- building | live
catalogue_rules     TEXT NULL            -- JSON, e.g. {"genre": ["Rock"], "tags_any": ["rock","upbeat"]}
created_at          TEXT NOT NULL
```

### programmes
```
id                  TEXT PRIMARY KEY
channel_id          TEXT NOT NULL        -- FK -> channels.id
title               TEXT NOT NULL
description         TEXT NULL
artwork_url         TEXT NULL
episode_number      INTEGER NULL
status              TEXT NOT NULL        -- draft | preview | published | archived
is_flagship         INTEGER DEFAULT 0
publish_date        TEXT NULL
duration_seconds    INTEGER NULL         -- computed from programme_items
created_at          TEXT NOT NULL
updated_at          TEXT NOT NULL
```

### programme_items
```
id                  TEXT PRIMARY KEY
programme_id        TEXT NOT NULL        -- FK -> programmes.id
position             INTEGER NOT NULL
item_type           TEXT NOT NULL        -- song | link | station_id | feature | interview
track_id            TEXT NULL            -- FK -> tracks.id (when item_type = song)
audio_asset_id       TEXT NULL           -- FK -> audio_assets.id (when item_type != song)
label                TEXT NULL           -- e.g. "Story behind Closer"
```

### audio_assets
```
id                  TEXT PRIMARY KEY
type                TEXT NOT NULL        -- station_id | jingle | link | feature | interview | promo
title               TEXT NOT NULL
audio_url           TEXT NOT NULL        -- R2 key
duration_seconds    INTEGER NOT NULL
description         TEXT NULL
status              TEXT NOT NULL        -- draft | processing | ready | published | archived
created_at          TEXT NOT NULL
```

### tags + track_tags (supporting the mood/genre system from Section 5)
```
tags
  id      TEXT PRIMARY KEY
  name    TEXT UNIQUE NOT NULL           -- e.g. "romantic", "upbeat", "1960s-inspired"

track_tags
  track_id  TEXT NOT NULL                -- FK -> tracks.id
  tag_id    TEXT NOT NULL                -- FK -> tags.id
  PRIMARY KEY (track_id, tag_id)
```

Mood/vibe descriptors are modelled as a tag table rather than fixed columns on `tracks`, because the tag vocabulary will keep growing as AI suggests new descriptors (Section 17), and this avoids a schema migration every time a new mood appears. The same `tags`/`track_tags` pattern can later be reused for programmes or audio assets without duplicating the taxonomy.

**`catalogue_rules` on channels** works against this tag system — e.g. Kizzi Rock's rule might be `{"genre": ["Rock"], "tags_any": ["rock", "upbeat"]}`, and any track matching that rule appears in Kizzi Rock's rotation automatically. Nothing needs to be manually assigned per channel.

### `schedules`, `favourites`, and `listening_history` — deliberately deferred

These three tables were listed in the original brief's data-model sketch, and they are real, needed features — but they should **not** be built alongside the six tables above. The reasoning:

- The four core tables (`tracks`, `channels`, `programmes`, `programme_items`) plus their two supporting tables (`audio_assets`, `tags`/`track_tags`) define *what content exists and how it's organised*. That's the foundation everything else — including the AI producer, the Studio, and the listener app — depends on.
- `schedules`, `favourites`, and `listening_history` are all *downstream* of that foundation: a schedule maps time slots to programmes that must already exist; favourites and listening history record listener interaction with tracks and programmes that must already exist and be structured correctly.
- Building them prematurely, before the core shape has been used and pressure-tested (via the Studio, via the AI producer, via a real upload-and-publish cycle), risks having to unwind or migrate them once the core tables inevitably get refined.
- This mirrors the brief's own instruction in Section 42 not to overengineer the first release, and the general principle in Section 33 of the original draft not to create tables merely because they appear on a list.

**The rule of thumb:** once the core six tables have been built, used to publish real content through the Studio, and feel solid — add `schedules` next (it unlocks Section 20's scheduling and Section 9's on-demand distinction), then `favourites` and `listening_history` as the listener-facing features in Sections 23 and 28 are actually built.

---

## 34. CONTENT STATES

Content should have statuses: Draft, Processing, Ready, Published, Scheduled, Archived — preventing incomplete uploads from appearing on the station. (Channels use their own two-state `building`/`live` status — see Section 10.)

---

## 35. AUDIO PROCESSING

Automated upload pipeline: Upload → Validate file → Extract metadata → Generate waveform/duration → Optimise/encode if necessary → Store in R2 → Mark Ready. Audio mastering/normalisation should not destructively alter Kizzi's original masters.

---

## 36. BRAND / DESIGN DIRECTION

The app should feel like a real radio station, not a generic AI SaaS application. Avoid purple AI gradients, excessive glassmorphism, generic chatbot appearance, corporate SaaS dashboards. Visual identity: broadcasting + music + personality + premium digital media — strong station branding, large album artwork, radio-console influences, "ON AIR" indicators, tuning/broadcast motifs, clear typography, rich but restrained colour palette, excellent dark mode, strong use of Kizzi's photography/identity where appropriate.

*(Home-screen layout and detailed look-and-feel are being deferred to a later pass, after the backend is built.)*

---

## 37–39. RESPONSIVE DESIGN / HOME SCREEN / PUBLISH MODEL

Deferred to the design pass, once the backend and Studio are working. Note for later: changes made in the Studio should generally remain drafts until explicitly published (Save Draft / Preview / Publish), so Kizzi can experiment without accidentally changing the public station — this already aligns with the `status` fields on tracks, programmes, and audio assets above.

---

## 40. BACKUP

Because this application contains Kizzi's creative catalogue, backups matter: D1 database backups, R2 storage protection/versioning where appropriate, exportable catalogue metadata, exportable programme definitions, clear separation between master files and streaming copies. The architecture should avoid a situation where the only copy of a recording exists inside the app.

---

## 41. FUTURE FEATURES

Architecture should not prevent: multi-station broadcasting, guest presenters, searchable interview archives, listener requests, dedications, listener voice-message submissions, live broadcasting, optional AI-generated Kizzi voice (subject to consent/licensing), rule-based smart programming, and fully personalised AI-generated listening sessions ("play me a one-hour Kizzi Radio programme for driving at night").

---

## 42. VERY IMPORTANT — DO NOT OVERENGINEER THE FIRST RELEASE

Initial development should concentrate on:

1. **Listener app** — Home, Listen Now, radio player, Now Playing, Up Next, Albums, Tracks, Programmes, Search.
2. **Studio** — Authentication, upload audio, upload artwork, catalogue, programme builder, running order, preview, publish, channel status toggle (building/live).
3. **Infrastructure** — R2, Workers, D1 (the six tables in Section 33), secure audio delivery.
4. **First AI capability** — AI-assisted programme creation.

Once this works properly, add scheduling, favourites, listening history, and the remaining channels incrementally.

---

## 43. ACCEPTANCE CRITERIA

**Listener:** open Kizzi Radio, immediately understand what the service is, press Listen Now, hear Kizzi's voice, hear a song, automatically hear the next piece of content, see what's playing and what's coming next, browse albums, browse programmes, search for music, play individual tracks, use the app on desktop and mobile.

**Kizzi:** log into Studio, upload a song, add metadata, upload a voice recording, create a programme, drag content into a running order, preview it, publish it, open the public app, see the new content without deploying a new app version — and separately, build out a `building` channel invisibly and flip it to `live` when ready.

**AI:** Kizzi describes a programme, AI examines the available catalogue, AI proposes a running order, Kizzi edits and approves it, the programme becomes available to listeners.

---

## 44. CORE PRODUCT PHILOSOPHY

1. **RADIO FIRST** — this should feel like radio.
2. **KIZZI FIRST** — Kizzi is the personality and presenter.
3. **MUSIC SECOND** — the catalogue is an enormous asset, but the experience is more than a music library.
4. **AI AS PRODUCER** — AI assists Kizzi rather than replacing him.
5. **KIZZI CONTROLS THE CONTENT** — nothing important auto-publishes without approval unless he deliberately enables automation.
6. **NO SUPABASE** — lightweight, appropriate Cloudflare infrastructure instead.
7. **LOW RUNNING COST** — avoid unnecessary paid APIs and services.
8. **CONTENT MUST BE EASY TO UPDATE** — adding a new album is a routine administrative task, not a software-development task.
9. **BUILD FOR THE BIGGER VISION** — the schema already supports multiple channels, programmes, and AI-assisted broadcasting; visibility is a status flag, not a structural limit.

---

### THE ONE-SENTENCE PRODUCT DEFINITION

Kizzi Radio is a personal digital radio network where Kizzi's original music, voice and ideas are turned into continuously programmed radio shows and on-demand audio, with AI acting as his virtual radio producer.

### Recommended technical direction

- **Frontend:** modern responsive PWA
- **Audio/media:** Cloudflare R2
- **Backend/API:** Cloudflare Workers
- **Database:** D1 (SQLite) — six core tables first (Section 33); `schedules`, `favourites`, `listening_history` deferred until the core feels solid
- **Simple configuration/cache:** KV where appropriate
- **Authentication:** lightweight secure solution appropriate to final account requirements
- **AI:** pluggable AI API layer, used primarily by the private Studio
- **Deployment:** Cloudflare/Vercel-compatible architecture
- **No Supabase**

Don't build a generic music app and then bolt radio features onto it. Build the radio engine and the Kizzi Radio Studio as the core of the product. The catalogue, albums, playlists and listener features sit around that central broadcasting experience.
