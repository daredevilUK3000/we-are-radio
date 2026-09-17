import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { listenerApi, type FavouriteItemType } from "../../api/client";
import { useListenerAuth } from "../auth/ListenerAuthContext";

interface FavouriteEntry {
  item_type: FavouriteItemType;
  item_id: string;
  created_at: string;
  item: any;
}

interface FavouritesState {
  favourites: FavouriteEntry[];
  loading: boolean;
  isFavourited: (itemType: FavouriteItemType, itemId: string) => boolean;
  toggle: (itemType: FavouriteItemType, itemId: string) => Promise<void>;
}

const FavouritesContext = createContext<FavouritesState | null>(null);

// Kept separate from ListenerAuthContext so a toggle from anywhere in the
// app (a detail page, a list card) is instantly reflected everywhere else,
// including the My Radio page, without every consumer re-fetching.
export function FavouritesProvider({ children }: { children: ReactNode }) {
  const { status } = useListenerAuth();
  const [favourites, setFavourites] = useState<FavouriteEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") {
      setFavourites([]);
      return;
    }
    setLoading(true);
    listenerApi
      .favourites()
      .then((r) => setFavourites(r.favourites))
      .catch(() => setFavourites([]))
      .finally(() => setLoading(false));
  }, [status]);

  const key = (itemType: string, itemId: string) => `${itemType}:${itemId}`;

  const favouriteKeys = useMemo(() => new Set(favourites.map((f) => key(f.item_type, f.item_id))), [favourites]);

  const isFavourited = useCallback(
    (itemType: FavouriteItemType, itemId: string) => favouriteKeys.has(key(itemType, itemId)),
    [favouriteKeys]
  );

  const toggle = useCallback(
    async (itemType: FavouriteItemType, itemId: string) => {
      if (status !== "authenticated") return;
      const already = favouriteKeys.has(key(itemType, itemId));
      if (already) {
        setFavourites((prev) => prev.filter((f) => !(f.item_type === itemType && f.item_id === itemId)));
        await listenerApi.removeFavourite(itemType, itemId);
      } else {
        await listenerApi.addFavourite(itemType, itemId);
        const { favourites: fresh } = await listenerApi.favourites();
        setFavourites(fresh);
      }
    },
    [status, favouriteKeys]
  );

  return (
    <FavouritesContext.Provider value={{ favourites, loading, isFavourited, toggle }}>
      {children}
    </FavouritesContext.Provider>
  );
}

export function useFavourites(): FavouritesState {
  const ctx = useContext(FavouritesContext);
  if (!ctx) throw new Error("useFavourites must be used within FavouritesProvider");
  return ctx;
}
