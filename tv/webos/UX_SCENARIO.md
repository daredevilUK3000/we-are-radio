# We Are Radio for LG TVs: UX scenario

LG asks for a **UX scenario** with every submission: how the app's screens fit together and what each key does, for LG's testers. Their template is a PowerPoint file in the "documents for app QA" download (`ux_scenario_document_4.3.ppt` at the time of writing; see `SUBMITTING.md`). Copy the sections below into it, with a screenshot of each screen where the template asks for one.

Written from the app as built on 16 October 2026.

---

## 1. About the app

| | |
| --- | --- |
| App | We Are Radio (`app.weareradio.tv`), version 1.0.0 |
| What it is | Live internet radio. Five channels (Kizzi Radio, We Are 50s, We Are Love, We Are After Dark, We Are Instrumental), a week's schedule, and music and podcasts on demand. |
| Kind of app | Hosted web app. The app opens https://weareradio.app/tv. |
| Network | Required. Without it the app shows its own offline screen and keeps trying. |
| Sign-in, membership, terms | None. |
| Payment | None. No in-app purchases. |
| Advertising | The radio's **audio** includes advertising: promos labelled "Advertisement" on screen, "We Are Radio recommends" (the station's own books and products), "Book of the Month", and "Advertising For Good" (short charity-style messages that ask listeners to be kind, not to buy). These show as a label on screen with a QR code to scan with a phone; nothing opens on the TV. |
| User content | None is shown. Listeners can record shout-outs on their phones (by scanning a QR code). The station's presenter checks each one and plays some on air, as audio. |
| Adult content | None. |
| Sound | The radio stream (music, talk, jingles). No other sound effects. Volume is the TV's own. |
| Video | Short silent background loops behind the Home screen (muted; slow TVs show still pictures instead). |
| Languages | English |
| Screen | 1920×1080, everything inside the safe area |

---

## 2. Remote keys (all screens)

| Key | What it does |
| --- | --- |
| Arrows | Move the selection. Exactly one item is selected (outlined) at any time. |
| OK | Opens or presses the selected item. |
| Back | One screen back (see each screen). On Home, it leaves the app (LG's own exit: the Home screen, or LG's exit question on some webOS versions). |
| Play ▶ | Plays the station (or the on-demand item that's open). |
| Pause ❚❚ / Stop ■ | Pauses. |
| Rewind ◀◀ | **Start over**: replays the current song from its beginning, when available. In the on-demand player: the previous item. |
| Fast-forward ▶▶ | **Back to live**, after Start over. In the on-demand player: the next item. |
| Magic Remote pointer | Pointing at an item selects it. A click (OK in pointer mode) opens it. Moving the pointer counts as using the remote. |
| Magic Remote wheel | Moves the selection up or down, like the Up and Down arrows (between rows on Home; between channels on What's on). |
| Number and colour keys | Not used; they do nothing. |
| Home, input, volume, power | The TV's own. Leaving the app pauses the station. |

**Lean back.** After 2 minutes with no key pressed while the station plays, the app shows Lean back: a calm full-screen view of the time and the song. Any key, or moving the pointer, returns to the screen underneath. Play and Pause also do their job.

---

## 3. Screen flow

```
App start ──► (no network) ──► Offline screen ──(network back)──┐
    │                                                           │
    └──────────────────────────────► Home ◄─────────────────────┘
                                      │
      ┌──────────────┬────────────────┼──────────────┬───────────────────┐
      ▼              ▼                ▼              ▼                   ▼
 Now Playing     What's on      On-demand player   QR screens        Lean back
 (a channel)   (the schedule)  (ad, mix, album,  (Send a shout out, (from Home,
      │              │          Top 3 song,       Time Capsule,      Now Playing,
      │              └─OK on a   podcast)          Top 3)             or 2 min idle)
      │                programme
      │                on now ──► Now Playing
      └── Back ──► the screen it came from; Back on Home leaves the app
```

---

## 4. The screens

### 4.1 Offline screen (inside the app; no network)

Shown when weareradio.app can't be reached at start. Logo, "We can't reach We Are Radio right now.", "Check your TV's internet connection." and a **Try again** button (selected).

| Key | Result |
| --- | --- |
| OK / click Try again | Tries again; opens Home if the connection is back. |
| (nothing) | Tries again by itself every 15 seconds, and as soon as the TV reports the network is back. |
| Back | Leaves the app. |

### 4.2 Home

The selected channel fills the screen (picture or silent video loop): its name, what's on, the song playing now (with its progress), and what's coming up. Under it are rows of cards, top to bottom:

1. **Listen** and **Schedule** buttons (Listen is selected when the app opens).
2. **Channels**: the five channels, each with the song playing now.
3. **Advertising For Good**: short messages to play on demand.
4. **Radio That Knows You**: moods (for example Energy, Love, Switch off, Fun). Each builds a mix.
5. **The featured album**: play all, or any track.
6. **Top 3 Creator Songs of 2026**: about the contest (opens a QR screen), then the songs.
7. **Podcasts**: the latest episodes.
8. **More from We Are Radio**: What's on, Send a shout out, Time Capsule, Lean back.

Rows 3 to 7 only appear when there's something in them.

| Key | Result |
| --- | --- |
| Left / Right | Along a row. The row slides to keep the selection in view. Selecting a channel card shows that channel at the top. |
| Up / Down | Between rows. The screen slides up to show the lower rows. |
| OK on Listen or a channel | Starts that channel and opens **Now Playing**. |
| OK on Schedule or What's on | Opens **What's on**. |
| OK on an Advertising For Good, mood, album, Top 3 song or podcast card | Opens the **on-demand player** and plays it. A mood shows "Building your radio…" briefly first. |
| OK on Top 3 Creator Songs, Send a shout out or Time Capsule | Opens that **QR screen**. |
| OK on Lean back | Opens **Lean back** (and starts the station if it was paused). |
| Back | Leaves the app. |

When the song playing is a promo or a Book of the Month, the "Now playing" label says so ("Advertisement", "We Are Radio recommends" or "Book of the Month", in their own colours), and the line under it says "Scan the code on Now Playing". An Advertising For Good message shows a green "Advertising For Good" label.

### 4.3 Now Playing

The channel that's playing: large artwork, the song title and artist, the show on now, a progress bar, and the next few items under **Coming up**. Controls, left to right: **Start over** (when available), **Play/Pause** (selected on arrival), **Like** (songs only), **Lean back**. A **‹ Channels** button sits at the top left.

| Key | Result |
| --- | --- |
| Left / Right | Between the controls (and up to ‹ Channels). |
| Up / Down (on the controls) | Previous / next channel. Its name shows briefly. |
| OK on Play/Pause | Pauses, or plays. Play always rejoins the station live. |
| OK on Start over (or Rewind) | Replays the current song from the start. A **Back to live** button then appears above the controls (Up reaches it). |
| OK on Back to live (or Fast-forward) | Returns to the live station. |
| OK on Like | Likes the song (again to unlike). |
| OK on Lean back | Opens **Lean back**. |
| OK on ‹ Channels | Returns to Home. |
| Back | Returns to the screen it came from (Home, or What's on). |

**Promos, books and ads.** While a promo, an advertisement or a Book of the Month plays, its label shows above the title ("Advertisement", "We Are Radio recommends" or "Book of the Month") with a **QR code** and a short web address: "Scan with your phone". Nothing opens on the TV. An Advertising For Good message shows its green label and the line "A short message that asks you to be kind, not to buy". A listener's shout-out shows "Listener voice" with the person's first name and town.

If the connection drops, a small "Reconnecting…" note shows while the station keeps playing from its buffer.

### 4.4 What's on (the schedule)

A grid: the channels down the side, time across (four hours at a time), with a red line at the current time. Above it: the selected programme's name, time and description; a **back** button and day tabs (**Today**, **Tomorrow** and the next five days).

| Key | Result |
| --- | --- |
| Left / Right | Earlier / later programme. At the edge of the grid, time moves on an hour. |
| Up / Down | Previous / next channel. Up from the first channel goes to the day tabs. |
| OK on a programme that's on now | Starts that channel and opens **Now Playing**. |
| OK on a later programme | Nothing (shows when it starts). |
| OK on a day tab | Shows that day, from 18:00 (today: from now). |
| Pointer | Pointing at a programme selects it. Clicking one that's on now opens it. |
| OK on the back button | Returns to Home. |
| Back | Returns to the screen it came from. |

### 4.5 On-demand player

What was picked on Home: an Advertising For Good message, a mood mix, album tracks, a Top 3 song or a podcast episode. Title, artwork, progress, **Previous** / **Play/Pause** / **Next** (Previous and Next only when there's more than one item), and **Up next**. A **‹ Back to the radio** button sits at the top left. The radio is paused while this plays.

| Key | Result |
| --- | --- |
| Left / Right | Between the controls. |
| OK on Play/Pause, or Play / Pause keys | Plays or pauses. |
| OK on Previous / Next, or Rewind / Fast-forward | Previous / next item. |
| OK on ‹ Back to the radio, or Back | Stops, and returns to where the listener was. |
| (the last item ends) | Returns to where the listener was. |

### 4.6 QR screens: Send a shout out, Time Capsule, Top 3 Creator Songs

Things that can only be done on a phone. Each explains it in three steps, with a large **QR code** and the web address (weareradio.app/on-air, /time-capsule or /top3). One button: **Done** (selected).

| Key | Result |
| --- | --- |
| OK on Done, or Back | Returns to the screen it came from (Home). |

### 4.7 Lean back

The station's picture, the time and date, and the song playing. The text drifts slowly and the logo changes corner every 10 minutes (screen burn protection). "Press any button" at the top.

| Key | Result |
| --- | --- |
| Any key, or moving the pointer | Returns to the screen underneath. Play and Pause also play or pause. |
| Back | Returns to the screen underneath. |

### 4.8 Leaving and coming back

- **Home key, another input, or another app:** the station pauses.
- **Opening the app again:** it returns where it was, paused. OK on Play (or the Play key) rejoins the station live.
- **If the app ever breaks:** "Something went wrong. Starting again…" and it reloads by itself as soon as weareradio.app can be reached.
- **The TV's screensaver:** webOS starts it after a while without a key press (only full-screen video holds it off). The station keeps playing underneath.
