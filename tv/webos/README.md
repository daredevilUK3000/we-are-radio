# We Are Radio for LG TVs (webOS)

A small LG TV app. It opens **https://weareradio.app/tv** full screen, like the Fire TV app, and adds what a web page can't do on its own:

- a built-in **offline screen** when there's no internet, which retries by itself;
- the remote's **Back** key (one screen back; on Home, it leaves the app the way LG's own apps do);
- the **media keys** (play, pause, rewind = Start over, fast-forward = Back to live);
- the **Magic Remote pointer**: point at anything to select it, click to open it, scroll the wheel to move between rows;
- starting again by itself if the page ever breaks.

Everything you see on the TV is the web app at `/tv`, so new features reach LG TVs as soon as the website is deployed. You only rebuild this app when the app itself changes, and each new version goes back through LG's review.

| | |
| --- | --- |
| App ID | `app.weareradio.tv` (the same as Fire TV; it can never change once published) |
| Version | 1.0.0 |
| Runs on | webOS 4.0 and later (LG TVs from 2018 onwards), including your 65UM7100 (2019, webOS 4.5) |
| Kind of app | A "hosted web app": the package holds a start page and the icons; the app itself is the website |

**Older and newer TVs.** LG TVs from 2018 to 2021 have an older built-in browser (Chromium 53 on webOS 4) that can't run the website's normal build. `/tv` notices this and switches to a second build of the same TV app made for old browsers, at `/tv-legacy/`. Newer TVs run the normal build. Both come from the same code (`app/src/tv`), and `npm run build` makes both.

---

## 1. Get a test build onto your LG TV

### a) Build it on GitHub

1. On GitHub, open the **we-are-radio** repository, then the **Actions** tab.
2. Choose **LG TV app (webOS)** on the left, then **Run workflow**. Leave the address box empty, and click the green **Run workflow** button.
3. When it finishes (about 2 minutes), open the run and download **we-are-radio-lg** under *Artifacts*. It's a zip; inside is `app.weareradio.tv_1.0.0_all.ipk`. Unzip it somewhere easy to find, such as your Desktop.

### b) An LG developer account (once)

1. Go to **webostv.developer.lge.com** and click **Sign in**, then **Create account**. It's free.
2. Use an email address and password you'll remember: you'll type them on the TV.

### c) Turn on Developer Mode on the TV (once)

1. Make sure the TV is connected to the internet.
2. On the TV, open the **LG Content Store** (on some models **Apps**), search for **Developer Mode**, and install it.
3. Open **Developer Mode** and sign in with your LG developer account.
4. Turn on **Dev Mode Status**. The TV restarts.
5. Open **Developer Mode** again. Note the **IP address** it shows, then turn on **Key Server**. Leave this screen open for the next step.

### d) Install LG's tools on your computer (once)

1. Install **Node.js** (the "LTS" version) from **nodejs.org**, with the default options.
2. Open a terminal (on Windows: **PowerShell**) and type:

   ```
   npm install --global @webos-tools/cli
   ```

3. Check it worked: `ares --version` should print a version number.

### e) Connect your computer to the TV (once)

In the terminal, with the TV still showing the Developer Mode app and **Key Server** on. Use the IP address from step c5 in place of `192.168.1.20`:

```
ares-setup-device --add lgtv -i "host=192.168.1.20" -i "port=9922" -i "username=prisoner"
ares-novacom --device lgtv --getkey
```

The second command asks for a **passphrase**: type the 6 characters shown at the bottom left of the Developer Mode app. Capitals matter. Then check the connection:

```
ares-device --system-info --device lgtv
```

It prints details of your TV. If it says it can't connect, check the IP address and that Key Server is still on.

### f) Install the app

In the terminal, go to the folder where you unzipped the `.ipk` (for example `cd Desktop`), then:

```
ares-install --device lgtv app.weareradio.tv_1.0.0_all.ipk
ares-launch --device lgtv app.weareradio.tv
```

We Are Radio now appears in the TV's apps, with the others. To install a newer test build later, run the same `ares-install` line again with the new file.

### g) Seeing what's happening (optional)

- **The page itself (Web Inspector):** while the app is running, type:

  ```
  ares-inspect --device lgtv --app app.weareradio.tv --open
  ```

  It opens Chrome's inspector on the computer, with the page's console (errors and messages). If the inspector window stays blank, your TV's browser is older than your Chrome can talk to. LG suggests using a matching older Chromium; ask Claude for help with that if you need it.
- **Close the app:** `ares-launch --device lgtv --close app.weareradio.tv`
- **Remove it:** `ares-install --device lgtv --remove app.weareradio.tv`

### h) How long Developer Mode lasts

Developer Mode only lasts a limited time. The Developer Mode app shows the time left under **Remain Session** (usually around 50 hours). To reset the clock, open **Developer Mode** on the TV, with the TV online, and click **EXTEND**. Do this before it runs out: once the time is up, it can't be extended. If it runs out, the TV removes the test apps you installed. Sign in to Developer Mode again, turn it back on, and install the `.ipk` again from step f.

(It also switches off if the TV restarts 10 times without a network connection.)

---

## 2. Trying a preview of the website

Sometimes it's useful to try a preview of the website (a version that isn't live yet) on the TV.

**The easy way, a test build:** in step 1a, paste the preview's TV address into the **address** box before clicking **Run workflow**. For example:

```
https://abc123-kizzi-radio-api.<your-subdomain>.workers.dev/tv
```

The download is then called **we-are-radio-lg-TEST-build**. Install it as in step 1f. It opens the preview instead of weareradio.app. **Never upload a test build to LG.** Build again with the box empty to get the real app back.

**Without rebuilding:** the real app accepts a preview address when it's started from the computer, as long as the address is one of We Are Radio's own (weareradio.app, or a `kizzi-radio-api` preview on workers.dev):

```
ares-launch --device lgtv --close app.weareradio.tv
ares-launch --device lgtv app.weareradio.tv --params "{\"url\":\"https://abc123-kizzi-radio-api.<your-subdomain>.workers.dev/tv\"}"
```

---

## 3. Testing on a computer (no TV needed)

- **The old-TV build in an ordinary browser:** open `https://weareradio.app/tv-legacy/?shell=webos`. `shell=webos` switches on the LG behaviour (the pointer, LG's key codes).
- **The normal build with the LG behaviour:** `https://weareradio.app/tv?shell=webos`.
- **LG's webOS TV Simulator** (from webostv.developer.lge.com, under *Tools*) runs the app on a computer for webOS 22 and later. Open the `tv/webos/app` folder in it. It's also the easiest way to take screenshots for the store (see `SUBMITTING.md`).

---

## 4. How it fits together (for developers)

- `app/appinfo.json`: the app's details for webOS. `disableBackHistoryAPI` is on, so the page handles Back itself. `requiredACG` is an empty list, as LG requires of every app from webOS 27 (the app calls none of LG's system services).
- `app/index.html`: the start page, plain ES5 (old TVs). It loads a tiny picture from weareradio.app to check the site can be reached, then replaces itself with `https://weareradio.app/tv?shell=webos`. Without a connection it shows the offline screen and tries again every 15 seconds, as soon as the TV reports it's back online, or when **Try again** is pressed. Back on this screen leaves the app.
- **The TV app's LG side** (all switched on only by `?shell=webos`, so Fire TV and browsers are unaffected):
  - `app/src/tv/nativeBridge.ts`: `isWebOsShell()`. Exit on Home calls LG's `platformBack()`. Keep-awake does nothing: webOS can't keep the screen on for audio, so the screensaver comes on during long listens and the station keeps playing.
  - `app/src/tv/useTvKeys.ts`: LG's media key codes (Play 415, Pause 19, Rewind 412, Fast-forward 417, Stop 413). Back is 461.
  - `app/src/tv/pointer.ts`: the Magic Remote pointer (point to focus, click as OK, wheel steps up and down).
  - `TvRecovery` in `app/src/tv/TvApp.tsx`: if the TV app breaks, it says so and reloads once the site can be reached.
- **The old-TV build:** `app/vite.tv-legacy.config.ts` builds `app/tv-legacy/index.html` and `app/src/tv/legacy/` into `dist/tv-legacy/`, after the site's own build. The check near the top of `app/index.html` sends browsers too old for the normal build there. `app/src/tv/legacy/legacy.css` holds the layout fixes for old browsers that can't be made automatically.
- **Leaving the app:** as on Fire TV, leaving the app (Home, another input, another app) pauses the station. Opening it again shows the station paused; **OK** or **Play** rejoins it live.
