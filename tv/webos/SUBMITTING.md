# Submitting We Are Radio to the LG Content Store

You need the **`.ipk` file** first: run **LG TV app (webOS)** on GitHub with the address box **empty** (`README.md`, step 1a). LG signs the package itself, so there's no signing key to make or keep, unlike Fire TV.

Expect LG's review to take **a few weeks** (third-party guides say 2 to 4; LG doesn't publish a figure). Every new version of the app goes through review again. Changes to the website don't: they reach LG TVs straight away.

## 1. Seller account

1. Go to **seller.lgappstv.com** (LG Seller Lounge) and sign in with the **same LG account** you made for Developer Mode (`README.md`, step 1b).
2. Complete the **Seller Lounge membership** it asks for. Registration is free, and individuals can register. Choose to register as an **individual** (not a company) unless you'd rather publish through a company.
3. It asks for your email, country and region, and a **seller name**. Enter **We Are Radio**: LG shows this name in the Content Store.
4. The app is free, so you don't need to enter bank or tax details. If the form insists, stop and ask.

## 2. Create the app

1. In Seller Lounge, start a new app (**App → Register New App**, or similar).
2. **App ID:** `app.weareradio.tv`. It must match `tv/webos/app/appinfo.json` exactly, and it can never be changed afterwards.
3. **Type:** a web app (webOS TV). **Price:** free.
4. **Countries:** the countries to sell in. English is the app's only language, which LG requires for apps sold in several countries.
5. **webOS versions:** select **webOS 4.0 and later** (every version the form offers from 4.0 up).
6. Upload the `.ipk`.

## 3. The listing (the same as Fire TV)

- **Title:** We Are Radio
- **Short description:** Music, talk and real people: Kizzi's radio stations on your TV.
- **Long description:**

  > Listen to We Are Radio's live channels on your TV. Browse the channels, see what's on with the week's schedule, and lean back with a calm, full-screen view of the time and the song that's playing. Want to be on the radio? Scan the code on screen and send a shout out from your phone. Kizzi listens to every one.

- **Category:** Music & Audio (the closest LG offers, if it's worded differently).
- **Privacy policy:** https://weareradio.app/privacy

## 4. Images

**Check the sizes Seller Lounge asks for when you get there.** LG's developer site and the guides available at the time of writing say:

| Image | Size | File |
| --- | --- | --- |
| App icon | 400×400 PNG, square, solid background (LG rejects rounded corners and see-through backgrounds) | `tv/webos/store/icon-400x400.png` |
| Background | 1920×1080 | `tv/webos/store/background-1920x1080.jpg` (the Fire TV background) |
| Main screenshot, plus 2 to 5 more | 1920×1080, no two the same | Home, Now Playing, What's on, Send a shout out, Lean back |

The icons inside the app (80×80 and 130×130) and the 1920×1080 splash screen are already in `tv/webos/app/`.

**Taking the screenshots:**

- **On a computer (easiest):** in Chrome, open `https://weareradio.app/tv?shell=webos`, make the window exactly 1920×1080 (or use Chrome's device toolbar set to 1920×1080), and take a screenshot of the page. It's the same page the TV shows. You can reuse the Fire TV screenshots (`Files for Claude/TV screenshots`) if they still match the app.
- **In LG's webOS TV Simulator** (webostv.developer.lge.com, *Tools*): open the `tv/webos/app` folder in it and use its screenshot button. It shows the app in a TV frame at the TV's own size.

## 5. Questions about the app's content

Answer these truthfully. LG tests the app against the answers.

- **Advertising: yes.** Since 13 October 2026 the station's **audio** contains advertising: promos labelled "Advertisement" on screen (InvoiceHawk at the time of writing) and "We Are Radio recommends" (Kizzi's books), alongside Book of the Month and Advertising For Good messages. They're part of the radio programme: on screen they're a label and a QR code, and nothing opens on the TV. There are no ad banners, and no ad tracking.
- **In-app purchases:** none.
- **Accounts, sign-in, membership:** none.
- **User-generated content:** none is shown. Listeners' shout-outs are recorded on their phones, checked by Kizzi, and only some are played on air, as audio.
- **Adult content, violence, gambling:** none.
- **Network:** required.

## 6. The documents LG asks for

LG wants two documents with the submission, both in its "documents for app QA" download: **webostv.developer.lge.com → Distribute → App Self Checklist → App Self Checklist** (a zip). **Download it fresh each time you submit**: LG rejects old versions. In October 2026 it held *Self Evaluation Checklist 5.0* (Excel) and *UX Scenario Document 4.3* (PowerPoint).

### a) UX scenario

Copy `UX_SCENARIO.md` (in this folder) into LG's PowerPoint template, section by section, with a screenshot of each screen.

### b) Self-checklist

Fill it in **with real results from your own TV**: **Pass**, or **N/A** where an item doesn't apply. LG rejects a checklist with guessed answers. Take your time over it; Claude can help you fill it in once you've tested.

Most items apply to this app. The ones that are **N/A**, because the app doesn't have the feature:

- Virtual keyboard and text input, search, terms, sign up, sign in and sign out, adult authentication, payment;
- changing the app's language (English only), subtitles, DRM;
- full/original screen size and resolutions for **video** (there's no video to watch; the background loops are decoration);
- the colour keys (not used).

Things to test on the TV before you tick them:

| Checklist item | How to test |
| --- | --- |
| Execution, main page | The splash, then Home, everything inside the edges of the screen. |
| Reboot | Open the app, turn the TV off and on, open it again. |
| Mouse over / focus | Every button and card shows when it's selected, with the arrows and with the pointer. |
| Navigation keys, OK | Every screen, arrows and OK only. |
| Magic Remote pointer, OK, wheel | Every screen with the pointer: pointing selects, clicking opens, the wheel moves up and down. |
| Back key | One screen back from every screen; on Home it leaves the app. |
| Home key | The launcher appears; the station pauses. Open the app again: it's still there, and Play rejoins live. |
| Exit / Live key (if your remote has them) | The app closes, or the TV goes to live TV. |
| Other keys (numbers, colour keys) | Nothing happens and nothing breaks. |
| Sound, play contents, real time | The station plays without noise; channel changes; volume works. |
| Playback control | Play, Pause, Rewind (Start over), Fast-forward (Back to live), with the remote's keys and with the on-screen buttons. |
| Replay | An album or podcast plays to the end, and can be played again. |
| Abnormal end, network | Unplug the network (or turn off Wi-Fi) while listening: "Reconnecting…" shows, and it recovers. Start the app with no network: the offline screen shows, and it opens by itself when the network comes back. |
| Advertisement | While an "Advertisement" plays, nothing opens on the TV; Back and the other keys still work. |
| Factory reset | Only if you're happy to reset the TV; otherwise ask LG if N/A is acceptable. |

## 7. Submit

Submit in Seller Lounge, then wait for LG's review. If LG rejects it, they send a list of what to fix: bring it back here, fix it, build a new `.ipk` (the version in `appinfo.json` goes up, for example to 1.0.1; LG won't take the same version twice), and submit again.

These are the usual reasons for rejection, and how the app already handles each one:

| Reason | How it's covered |
| --- | --- |
| Something can't be reached with the arrows, or with the pointer | Every screen works with both. The pointer is an extra: arrows and OK are always enough. |
| Nothing shows which item is selected | Exactly one item is always selected and outlined. |
| Back on the first screen doesn't leave the app | Back on Home calls LG's own exit (`platformBack`). |
| The app is unusable without a network | A built-in offline screen with **Try again**, which also retries by itself. |
| A black screen while loading | LG's splash screen, then the page's own loading screen. |
| The icon has rounded corners or a see-through background | The 400×400 icon is square and solid. |
