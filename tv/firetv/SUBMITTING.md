# Submitting We Are Radio to the Amazon Appstore (Fire TV)

You need the **signed release APK** first (`README.md`, section 3).

## 1. Developer account

Create a free Amazon Developer account at **developer.amazon.com**, with your details and **We Are Radio** as the publisher name. The tax and payment interviews are only needed for paid apps or in-app purchases; this app is free, so you can skip them.

## 2. Create the app

1. In the Developer Console: **Apps & Services → Add New App → Android**.
2. Choose **Fire TV**.
3. Upload `app-release.apk`.
4. Under **Device support**, keep the **Fire TV (Fire OS)** devices and **remove tablets and phones**. The app needs no touchscreen.

## 3. The listing

- **Title:** We Are Radio
- **Short description:** Music, talk and real people: Kizzi's radio stations on your TV.
- **Long description** (suggested):

  > Listen to We Are Radio's live channels on your TV. Browse the channels, see what's on with the week's schedule, and lean back with a calm, full-screen view of the time and the song that's playing. Want to be on the radio? Scan the code on screen and send a shout out from your phone. Kizzi listens to every one.

- **Category:** Music & Audio
- **Privacy policy:** https://weareradio.app/privacy

## 4. Images

The console shows the exact current sizes. At the time of writing:

- **Icon:** 512×512 and 114×114 PNG. Use `app/public/icons/icon-512.png` from the website (and a resized copy).
- **Fire TV background:** 1920×1080.
- **At least 3 screenshots at 1920×1080:** Home, Now Playing and What's on. Take them on the TV, or in Chrome on a computer set to 1920×1080 at `https://weareradio.app/tv?shell=firetv`.
- **Banner:** 320×180. It's already inside the app (`res/drawable-xhdpi/banner.png`); upload the same file if asked.

## 5. Content rating questionnaire

- Music and talk.
- No user-generated content is **shown** in the app: shout-outs are moderated by Kizzi and only played as audio on air.
- No ads, no purchases, no account.

## 6. Live App Testing (optional, recommended)

Invite your own Amazon account as a tester, install the app through the Appstore on the TCL, and run through everything once more.

## 7. Submit

Reviews usually take a few days. These are the usual reasons for rejection, and how the app already handles each one:

| Reason | How it's covered |
| --- | --- |
| Back doesn't exit from the first screen | Back on Home closes the app. |
| The app is unusable without a network | A built-in offline screen with **Try again**, which also retries by itself. |
| Something needs touch | Everything works with the remote. |
| The focus outline is lost | Exactly one item is always focused and outlined. |
| Audio carries on after pressing Home | Leaving the app pauses the station. |
