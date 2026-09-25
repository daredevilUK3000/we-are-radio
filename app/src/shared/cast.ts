import { useSyncExternalStore } from "react";
import { publicApi, mediaUrl } from "../api/client";

/**
 * Chromecast (Google Cast Web Sender SDK + Google's Default Media Receiver -
 * no receiver app of our own).
 *
 * A channel isn't a stream: it's a running order of individual files, timed
 * by the server clock (see /api/schedule). So casting loads a *queue* of the
 * next hour into the Chromecast, starting partway into the song that's on air
 * now, and tops it up as it plays. The TV/speaker then plays on its own - the
 * phone can lock or leave the page. Listeners who cast may drift a few
 * seconds from everyone else; that's accepted.
 *
 * Overlay jingles (music ducked under a voice) are done by the listener's
 * browser and can't be sent to a Chromecast, so they're skipped there;
 * jingles and station IDs that play between songs are in the queue.
 *
 * Chrome only (desktop and Android). iPhones use AirPlay instead (CastButtons).
 */

export interface CastState {
  /** A Cast device is on the network - only then is the button shown. */
  available: boolean;
  connected: boolean;
  deviceName: string | null;
  /** The channel on the Chromecast, if we loaded (or recognised) one. */
  channelSlug: string | null;
  paused: boolean;
}

// The Cast SDK has no bundled types; it's used through these loose handles.
declare global {
  interface Window {
    __onGCastApiAvailable?: (available: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}

const SDK_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
// When fewer than this many seconds are queued after the playing item, more is fetched.
const TOP_UP_BELOW_SECONDS = 20 * 60;
const QUEUE_MINUTES = 60;

let state: CastState = { available: false, connected: false, deviceName: null, channelSlug: null, paused: true };
const subscribers = new Set<() => void>();
let started = false;
let player: any = null;
let controller: any = null;
// Air time (unix seconds) at which the last queued item ends, per channel load.
let queuedUntil = 0;
let toppingUp = false;
// The channel to cast if a session starts from Chrome's own Cast menu rather than our button.
let hintChannel = "kizzi-radio";
let pendingChannel: string | null = null;

// When the device was last heard playing - stopping a cast often pauses it a
// moment before the session ends, and that still counts as "was playing".
let lastPlayingAt = 0;

function setState(patch: Partial<CastState>) {
  if (!state.paused) lastPlayingAt = Date.now();
  state = { ...state, ...patch };
  subscribers.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function useCastState(): CastState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Load the Cast SDK once (Chrome only). Safe to call from every player. */
export function initCast() {
  if (started || typeof window === "undefined") return;
  started = true;
  if (!window.chrome || isIOS() || !window.isSecureContext) return;
  window.__onGCastApiAvailable = (available) => {
    if (available) setup();
  };
  const script = document.createElement("script");
  script.src = SDK_URL;
  script.async = true;
  document.head.appendChild(script);
}

/** Which channel to cast when a session starts from outside our button. */
export function setCastHint(channelSlug: string) {
  hintChannel = channelSlug;
}

function session(): any {
  return window.cast?.framework.CastContext.getInstance().getCurrentSession() ?? null;
}

function setup() {
  const { cast, chrome } = window;
  const context = cast.framework.CastContext.getInstance();
  context.setOptions({
    receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
    autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
  });

  const applyCastState = (castState: string) =>
    setState({
      available: castState !== cast.framework.CastState.NO_DEVICES_AVAILABLE,
      connected: castState === cast.framework.CastState.CONNECTED,
    });
  applyCastState(context.getCastState());
  context.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, (e: any) => applyCastState(e.castState));

  context.addEventListener(cast.framework.CastContextEventType.SESSION_STATE_CHANGED, (e: any) => {
    const S = cast.framework.SessionState;
    if (e.sessionState === S.SESSION_STARTED) {
      setState({ deviceName: e.session.getCastDevice()?.friendlyName ?? null });
      const slug = pendingChannel ?? hintChannel;
      pendingChannel = null;
      void loadChannel(slug);
    } else if (e.sessionState === S.SESSION_RESUMED) {
      // Page reloaded while casting: carry on with whatever is on the device.
      setState({ deviceName: e.session.getCastDevice()?.friendlyName ?? null });
      readPlayingMedia();
    } else if (e.sessionState === S.SESSION_ENDED) {
      const ended = { channelSlug: state.channelSlug, wasPlaying: !state.paused || Date.now() - lastPlayingAt < 5000 };
      setState({ connected: false, deviceName: null, channelSlug: null, paused: true });
      queuedUntil = 0;
      if (ended.channelSlug) window.dispatchEvent(new CustomEvent("war:cast-ended", { detail: ended }));
    }
  });

  player = new cast.framework.RemotePlayer();
  controller = new cast.framework.RemotePlayerController(player);
  controller.addEventListener(cast.framework.RemotePlayerEventType.ANY_CHANGE, (e: any) => {
    if (e.field === "isPaused" || e.field === "playerState") {
      setState({ paused: player.isPaused || player.playerState === "IDLE" });
    }
    if (e.field === "mediaInfo") {
      readPlayingMedia();
      void topUp();
    }
  });
}

// Each queued item carries its channel and air time in customData, so the
// sender can always tell what the device is on (even after a page reload).
function readPlayingMedia() {
  const data = player?.mediaInfo?.customData;
  if (data?.channel && data.channel !== state.channelSlug) setState({ channelSlug: data.channel });
  // After a page reload the sender doesn't know how far the queue reaches;
  // work it out from the device's queue if it reports one. If it doesn't,
  // leave it unknown (no top-up) rather than guess and queue songs twice.
  if (!queuedUntil) {
    const items: any[] = session()?.getMediaSession()?.items ?? [];
    queuedUntil = items.reduce((max, i) => Math.max(max, i.media?.customData?.ends_at ?? 0), 0);
  }
}

function contentType(url: string): string {
  const ext = /\.(\w+)(?:[?#]|$)/.exec(url)?.[1]?.toLowerCase();
  switch (ext) {
    case "m4a":
    case "aac":
    case "mp4":
      return "audio/mp4";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "flac":
      return "audio/flac";
    default:
      return "audio/mpeg";
  }
}

function absolute(url: string) {
  return new URL(url, window.location.href).href;
}

function toQueueItem(item: any, channel: any, startTime = 0) {
  const { chrome } = window;
  const url = absolute(mediaUrl(item.audio_url));
  const info = new chrome.cast.media.MediaInfo(url, contentType(url));
  info.streamType = chrome.cast.media.StreamType.BUFFERED;
  const meta = new chrome.cast.media.MusicTrackMediaMetadata();
  const station = channel?.name ?? "We Are Radio";
  const isSong = item.item_type === "song";
  meta.title = item.label ?? station;
  meta.artist = isSong ? item.artist || "Kizzi" : station;
  meta.albumName = (isSong && item.album_title) || station;
  meta.images = [new chrome.cast.Image(absolute(item.artwork_url ? mediaUrl(item.artwork_url) : "/icons/icon-512.png"))];
  info.metadata = meta;
  info.customData = { channel: channel?.slug, starts_at: item.starts_at, ends_at: item.starts_at + item.duration_seconds };
  const queueItem = new chrome.cast.media.QueueItem(info);
  queueItem.autoplay = true;
  queueItem.preloadTime = 10;
  queueItem.startTime = startTime;
  return queueItem;
}

async function loadChannel(slug: string): Promise<boolean> {
  const s = session();
  if (!s) return false;
  let schedule;
  try {
    schedule = await publicApi.schedule(slug, QUEUE_MINUTES);
  } catch {
    return false; // hidden or unknown channel: /api/schedule only serves live ones
  }
  const items = schedule.items.filter((i: any) => i.audio_url);
  if (!schedule.on_air || items.length === 0) return false;

  // The first item is on air now; start it where the broadcast is (recomputed
  // from its start time, as the fetch itself took a moment).
  const nowSec = Date.now() / 1000;
  const queue = items.map((item: any, i: number) =>
    toQueueItem(item, schedule.channel, i === 0 ? Math.max(0, nowSec - item.starts_at) : 0)
  );
  const last = items[items.length - 1];
  const { chrome } = window;
  const request = new chrome.cast.media.QueueLoadRequest(queue);
  request.startIndex = 0;
  request.repeatMode = chrome.cast.media.RepeatMode.OFF;

  return new Promise((resolve) => {
    s.getSessionObj().queueLoad(
      request,
      () => {
        queuedUntil = last.starts_at + last.duration_seconds;
        setState({ channelSlug: slug, paused: false });
        // Every radio player on the page stops playing out loud.
        window.dispatchEvent(new CustomEvent("war:cast-loaded", { detail: { channelSlug: slug } }));
        resolve(true);
      },
      () => resolve(false)
    );
  });
}

// When the device gets within 20 minutes of the end of its queue, append the
// items that come after it on air.
async function topUp() {
  const slug = state.channelSlug;
  const media = session()?.getMediaSession();
  if (!slug || !media || toppingUp || !queuedUntil) return;
  const playingEndsAt = player?.mediaInfo?.customData?.ends_at ?? Date.now() / 1000;
  if (queuedUntil - playingEndsAt > TOP_UP_BELOW_SECONDS) return;

  toppingUp = true;
  try {
    const schedule = await publicApi.schedule(slug, QUEUE_MINUTES + 30);
    const fresh = schedule.items.filter((i: any) => i.audio_url && i.starts_at >= queuedUntil - 1);
    if (fresh.length === 0) return;
    const { chrome } = window;
    await new Promise<void>((resolve) =>
      media.queueInsertItems(
        new chrome.cast.media.QueueInsertItemsRequest(fresh.map((i: any) => toQueueItem(i, schedule.channel))),
        () => resolve(),
        () => resolve()
      )
    );
    const last = fresh[fresh.length - 1];
    queuedUntil = last.starts_at + last.duration_seconds;
  } catch {
    // Channel switched off or offline: the queue simply runs out.
  } finally {
    toppingUp = false;
  }
}

/**
 * Cast a channel: opens Chrome's device picker if nothing is connected yet
 * (the channel loads once a device is chosen), or switches the connected
 * device to this channel.
 */
export async function startCasting(channelSlug: string): Promise<void> {
  const cast = window.cast;
  if (!cast) return;
  if (session()) {
    await loadChannel(channelSlug);
    return;
  }
  pendingChannel = channelSlug;
  try {
    await cast.framework.CastContext.getInstance().requestSession();
  } catch {
    pendingChannel = null; // picker closed without choosing a device
  }
}

export function toggleCastPlayback() {
  controller?.playOrPause();
}

export function stopCasting() {
  window.cast?.framework.CastContext.getInstance().endCurrentSession(true);
}

/** While casting: Chrome's own dialog, to switch device or stop casting. */
export function openCastDialog() {
  window.cast?.framework.CastContext.getInstance()
    .requestSession()
    .catch(() => {});
}
