import { useNavigate } from "react-router-dom";
import type { FavouriteItemType } from "../../api/client";
import { useListenerAuth } from "../auth/ListenerAuthContext";
import { useFavourites } from "../favourites/FavouritesContext";

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
  const navigate = useNavigate();

  if (status !== "authenticated") {
    return (
      <button
        type="button"
        className={className}
        title="Sign in on My Radio to save favourites"
        onClick={() => navigate("/my-radio")}
      >
        ♡{label ? ` ${label}` : ""}
      </button>
    );
  }

  const favourited = isFavourited(itemType, itemId);

  return (
    <button
      type="button"
      className={className}
      style={favourited ? { color: "var(--accent)", borderColor: "var(--accent)" } : undefined}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(itemType, itemId);
      }}
      title={favourited ? "Remove from favourites" : "Add to favourites"}
    >
      {favourited ? "♥" : "♡"}
      {label ? ` ${label}` : ""}
    </button>
  );
}
