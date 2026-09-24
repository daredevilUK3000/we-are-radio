import { useCallback, useEffect, useState } from "react";
import { likesApi, type LikeItemType } from "../../api/client";

/**
 * Public Like (worker/src/routes/likes.ts): anyone can like a song, no
 * account needed. A listener only ever sees their OWN state - a filled or
 * empty heart - never a count; only the Studio sees how many likes a song has.
 *
 * Not to be confused with FavouriteButton, which is Kizzi's own private
 * favourites list behind the listener sign-in.
 *
 * useLikes() loads "which of these have I liked?" for a whole list in one
 * request (a grid of songs), and toggles optimistically.
 */
export function useLikes(itemType: LikeItemType, ids: string[]) {
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const key = ids.join(",");

  useEffect(() => {
    if (ids.length === 0) return;
    let cancelled = false;
    // Up to 100 per request; a page of songs is well under that.
    likesApi
      .mine(itemType, ids.slice(0, 100))
      .then((r) => !cancelled && setLiked((prev) => new Set([...prev, ...r.liked])))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemType, key]);

  const toggle = useCallback(
    async (id: string) => {
      const was = liked.has(id);
      const flip = (on: boolean) =>
        setLiked((prev) => {
          const next = new Set(prev);
          if (on) next.add(id);
          else next.delete(id);
          return next;
        });
      flip(!was);
      try {
        if (was) await likesApi.unlike(itemType, id);
        else await likesApi.like(itemType, id);
      } catch {
        flip(was); // put it back - the heart shouldn't claim something that didn't happen
      }
    },
    [itemType, liked]
  );

  return { isLiked: (id: string) => liked.has(id), toggle };
}

export function LikeButton({
  liked,
  onToggle,
  className = "btn",
  iconOnly = false,
}: {
  liked: boolean;
  onToggle: () => void;
  className?: string;
  iconOnly?: boolean;
}) {
  return (
    <button
      type="button"
      className={`${className} like-btn${liked ? " liked" : ""}`}
      aria-pressed={liked}
      title={liked ? "Liked - tap to unlike" : "Like"}
      aria-label={iconOnly ? (liked ? "Liked" : "Like") : undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      {liked ? "♥" : "♡"}
      {iconOnly ? "" : liked ? " Liked" : " Like"}
    </button>
  );
}
