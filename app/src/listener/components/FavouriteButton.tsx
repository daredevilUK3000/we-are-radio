import type { FavouriteItemType } from "../../api/client";
import { useListenerAuth } from "../auth/ListenerAuthContext";
import { useFavourites } from "../favourites/FavouritesContext";

/**
 * Kizzi's private favourites (the single listener account, see
 * migrations/0002). Public visitors get the Like button instead
 * (LikeButton.tsx), so this renders nothing unless that account is signed
 * in - it used to show visitors a heart that only led to a sign-in page.
 *
 * It's a star, not a heart, so it can't be confused with Like when both
 * appear side by side on Kizzi's own devices.
 */
export function FavouriteButton({
  itemType,
  itemId,
  label,
  className = "btn",
}: {
  itemType: FavouriteItemType;
  itemId: string;
  label?: string;
  className?: string;
}) {
  const { status } = useListenerAuth();
  const { isFavourited, toggle } = useFavourites();

  if (status !== "authenticated") return null;

  const favourited = isFavourited(itemType, itemId);

  return (
    <button
      type="button"
      className={className}
      style={favourited ? { color: "#f0a12a", borderColor: "#f0a12a" } : undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(itemType, itemId);
      }}
      title={favourited ? "Remove from your favourites" : "Add to your favourites"}
      aria-label={label ? undefined : favourited ? "Favourited" : "Favourite"}
    >
      {favourited ? "★" : "☆"}
      {label ? ` ${label}` : ""}
    </button>
  );
}
