# We Are Radio for Fire TV

A small Android app for Fire TV (Fire OS). It opens **https://weareradio.app/tv** full screen and adds what a web page can't do on a TV:

- the remote's **Back** and **media keys** (play/pause, rewind = Start over, fast-forward = Back to live, menu = What's on);
- keeping the screen on while the station plays;
- a built-in **offline screen** when there's no internet, which retries by itself;
- recovering if the page crashes.

Everything you see on the TV is the web app at `/tv`, so new features reach the TV as soon as the website is deployed. You only rebuild this app when the shell itself changes.

| | |
| --- | --- |
| Package | `app.weareradio.tv` |
| Version | 1.0.0 (code 1) |
| Runs on | Fire OS 6 and later (`minSdk 25`) |
| Targets | Android 16, API 36 (`targetSdk 36`). Amazon requires new Fire TV submissions to target **at least API 34** and asks for 36 (checked 1 Oct 2026, [Fire OS 16 developer page](https://developer.amazon.com/docs/fire-tv/fire-os-16.html)). Check that page again before each submission. |
| Not supported | Vega OS (the newest Fire TV sticks can't run Android apps) |

---

## 1. Get a test build onto your TV (no Android Studio needed)

### a) Build it on GitHub

1. On GitHub, open the **we-are-radio** repository, then the **Actions** tab.
2. Choose **Fire TV debug APK** on the left, then **Run workflow**, then the green **Run workflow** button.
3. When it finishes (about 5 minutes), open the run and download **we-are-radio-tv-debug** under *Artifacts*. It's a zip containing `app-debug.apk`.

### b) Turn on developer options on the TCL

1. On the TV: **Settings → My Fire TV** (on some models **Device & Software**) **→ About**.
2. Click the TV's name **7 times**. A message says you're now a developer.
3. Go back one step: there's now **Developer options**. Turn on **ADB debugging**.
4. Note the TV's IP address: **About → Network**.

### c) Install it, either way

**From a computer** (needs Android's `adb` tool: install "Android SDK Platform-Tools" from developer.android.com):

```
adb connect <tv-ip>:5555
```

Accept the prompt that appears on the TV, then:

```
adb install -r app-debug.apk
```

**With no computer**: install Amazon's **Downloader** app from the Appstore on the TV. In **Developer options → Install unknown apps**, allow **Downloader**. Put `app-debug.apk` somewhere with a plain download link (a short link to a file in your Google Drive or Dropbox works), type that link into Downloader, and install.

The app appears under **Your Apps & Channels**.

### d) Seeing what's happening (optional)

- App logs: `adb logcat | grep -i weareradio`
- The page itself: debug builds allow Chrome's inspector. With the TV connected by `adb`, open `chrome://inspect` in Chrome on the computer and choose the We Are Radio page.
- Point a debug build at a different address (a preview):
  `adb shell am start -n app.weareradio.tv/.MainActivity --es url "https://<preview-address>/tv?shell=firetv"`
- Memory check (for the 3-hour test): `adb shell dumpsys meminfo app.weareradio.tv`

---

## 2. Your signing key (once, and keep it safe)

The Appstore version must be signed with **your own key**. Make it once, on your computer (it needs Java, which comes with Android Studio):

```
keytool -genkeypair -v -keystore weareradio-tv.jks -keyalg RSA -keysize 2048 -validity 10000 -alias weareradio
```

It asks for a password and a few details (your name, "We Are Radio", your country).

**Back up `weareradio-tv.jks` and its passwords somewhere safe** (a password manager, plus a copy of the file outside this computer). **Without them you can never update the app in the Appstore.** Never put them in git; this folder's `.gitignore` already refuses them.

Then create a file called `keystore.properties` in this folder (`tv/firetv/`), next to this README:

```
storeFile=weareradio-tv.jks
storePassword=<the store password>
keyAlias=weareradio
keyPassword=<the key password>
```

and put `weareradio-tv.jks` in the same folder.

---

## 3. Build the release version (for the Appstore)

1. Install **Android Studio** (free, developer.android.com/studio).
2. **File → Open**, and choose the `tv/firetv` folder. Android Studio sets up Gradle by itself the first time (it may offer to add the "Gradle wrapper": say yes).
3. With `keystore.properties` in place, open **Terminal** at the bottom of Android Studio and run:

   ```
   ./gradlew assembleRelease
   ```

   (On Windows: `gradlew.bat assembleRelease`.)
4. The signed app is at `app/build/outputs/apk/release/app-release.apk`. That's the file you upload to Amazon (see `SUBMITTING.md`).

Release builds are shrunk with R8, with a rule that keeps the page's bridge to the app (`proguard-rules.pro`).

To publish an update later: raise `versionCode` (by 1) and `versionName` in `app/build.gradle.kts`, build again, and upload.

---

## 4. How it fits together (for developers)

- `MainActivity.kt`: the WebView, the remote's keys, the offline screen, the splash, lifecycle (leaving the app pauses the station; no background playback in v1).
- `NativeBridge.kt`: `window.WeAreRadioNative` for the page (`keepScreenOn`, `exitApp`, `shellReady`, `log`, and `retry` for the offline screen). The other half is `app/src/tv/nativeBridge.ts` in the web app.
- **Back:** the app asks the page (`weAreRadioTv.back()`). The page answers "handled" or "exit". No answer within 500 ms, or no page, closes the app, so the user is never trapped.
- **Navigation lock:** the WebView only ever shows `weareradio.app` (and the bundled offline page).
- `assets/offline.html`: shown when weareradio.app can't be reached. It retries every 15 seconds and as soon as the network comes back.
