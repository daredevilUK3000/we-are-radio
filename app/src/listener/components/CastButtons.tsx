import { useEffect, useState, type RefObject } from "react";
import { initCast, openCastDialog, startCasting, useCastState } from "../../shared/cast";

function CastIcon({ connected }: { connected: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M1 18v3h3c0-1.66-1.34-3-3-3zm0-4v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7zm0-4v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11zm20-7H3c-1.1 0-2 .9-2 2v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
      {connected && <path d="M5 7v1.63c3.96 1.28 7.09 4.41 8.37 8.37H19V7H5z" />}
    </svg>
  );
}

function AirPlayIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M6 22h12l-6-6zM21 3H3c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h4v-2H3V5h18v12h-4v2h4c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
    </svg>
  );
}

/**
 * Chromecast and AirPlay buttons for a radio player. Each appears only when
 * there's a device to send to: Cast on Chrome (desktop/Android) when a Cast
 * device is on the network, AirPlay on Safari when an AirPlay target is.
 *
 * AirPlay sends this player's own <audio> element to the speaker, so
 * everything the player does (next song, pause) carries on through it.
 * Chromecast gets a queue of its own - see shared/cast.ts.
 */
export function CastButtons({
  audioRef,
  channelSlug,
  ready,
  className,
}: {
  audioRef: RefObject<HTMLAudioElement>;
  channelSlug: string;
  /** The <audio> element is mounted (the station is on air). */
  ready: boolean;
  className: string;
}) {
  const cast = useCastState();
  const [airplayAvailable, setAirplayAvailable] = useState(false);
  const [airplayActive, setAirplayActive] = useState(false);

  useEffect(() => {
    initCast();
  }, []);

  useEffect(() => {
    const audio = audioRef.current as (HTMLAudioElement & { webkitCurrentPlaybackTargetIsWireless?: boolean }) | null;
    if (!audio || !ready || !("WebKitPlaybackTargetAvailabilityEvent" in window)) return;
    audio.setAttribute("x-webkit-airplay", "allow");
    const onAvailability = (e: Event) => setAirplayAvailable((e as any).availability === "available");
    const onTarget = () => setAirplayActive(!!audio.webkitCurrentPlaybackTargetIsWireless);
    audio.addEventListener("webkitplaybacktargetavailabilitychanged", onAvailability);
    audio.addEventListener("webkitcurrentplaybacktargetiswirelesschanged", onTarget);
    return () => {
      audio.removeEventListener("webkitplaybacktargetavailabilitychanged", onAvailability);
      audio.removeEventListener("webkitcurrentplaybacktargetiswirelesschanged", onTarget);
    };
  }, [audioRef, ready]);

  const castingHere = cast.connected && cast.channelSlug === channelSlug;

  return (
    <>
      {cast.available && (
        <button
          type="button"
          className={`${className} cast-btn${castingHere ? " is-active" : ""}`}
          onClick={() => (castingHere ? openCastDialog() : void startCasting(channelSlug))}
          title={castingHere ? `Casting to ${cast.deviceName ?? "your device"}` : "Cast to a speaker or TV"}
          aria-label={castingHere ? `Casting to ${cast.deviceName ?? "your device"} - change or stop` : "Cast to a speaker or TV"}
        >
          <CastIcon connected={castingHere} />
        </button>
      )}
      {airplayAvailable && (
        <button
          type="button"
          className={`${className} cast-btn${airplayActive ? " is-active" : ""}`}
          onClick={() => (audioRef.current as any)?.webkitShowPlaybackTargetPicker?.()}
          title="AirPlay"
          aria-label={airplayActive ? "Playing on AirPlay - change or stop" : "AirPlay to a speaker or TV"}
        >
          <AirPlayIcon />
        </button>
      )}
    </>
  );
}
