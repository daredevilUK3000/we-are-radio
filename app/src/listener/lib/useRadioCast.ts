import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import { publicApi, mediaUrl } from "../../api/client";
import { setCastHint, useCastState, type CastState } from "../../shared/cast";

/**
 * Keeps a radio player (mini-player or Listen page) in step with Chromecast:
 * - while this channel is on the Chromecast, the player's button shows and
 *   controls the device (castingHere / cast.paused),
 * - when a cast starts, the player stops playing out loud,
 * - when the cast ends while it was playing, the player picks the broadcast
 *   back up locally, at the live point.
 */
export function useRadioCast({
  audioRef,
  channelSlug,
  currentItemId,
  setData,
  setPlaying,
  isDefault = false,
}: {
  audioRef: RefObject<HTMLAudioElement>;
  channelSlug: string;
  currentItemId: MutableRefObject<string | null>;
  setData: (d: any) => void;
  setPlaying: (p: boolean) => void;
  /** The mini-player's channel is the one Chrome's own Cast menu casts. */
  isDefault?: boolean;
}): { cast: CastState; castingHere: boolean } {
  const cast = useCastState();
  const castingHere = cast.connected && cast.channelSlug === channelSlug;
  const latest = useRef({ channelSlug, setData, setPlaying });
  latest.current = { channelSlug, setData, setPlaying };

  useEffect(() => {
    if (isDefault) setCastHint(channelSlug);
  }, [isDefault, channelSlug]);

  useEffect(() => {
    const onLoaded = () => {
      audioRef.current?.pause();
      latest.current.setPlaying(false);
    };
    const onEnded = (e: Event) => {
      const { channelSlug: castSlug, wasPlaying } = (e as CustomEvent).detail ?? {};
      if (!wasPlaying || castSlug !== latest.current.channelSlug) return;
      publicApi
        .nowPlaying(castSlug)
        .then((d) => {
          const audio = audioRef.current;
          const item = d?.now_playing;
          if (!audio || !d?.on_air || !item?.audio_url) return;
          // Load it here rather than via the player's own effect, so a play()
          // refused by the browser leaves the button showing "play".
          currentItemId.current = item.id;
          audio.src = mediaUrl(item.audio_url);
          audio.currentTime = d.position_seconds ?? 0;
          latest.current.setData(d);
          audio
            .play()
            .then(() => latest.current.setPlaying(true))
            .catch(() => latest.current.setPlaying(false));
        })
        .catch(() => {});
    };
    window.addEventListener("war:cast-loaded", onLoaded);
    window.addEventListener("war:cast-ended", onEnded);
    return () => {
      window.removeEventListener("war:cast-loaded", onLoaded);
      window.removeEventListener("war:cast-ended", onEnded);
    };
  }, [audioRef, currentItemId]);

  return { cast, castingHere };
}
