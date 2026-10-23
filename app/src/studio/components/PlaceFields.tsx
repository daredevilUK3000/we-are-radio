import { useEffect, useMemo, useState } from "react";
import { studioApi } from "../../api/client";
import { CITY_NAMES, citySuggestion, TIME_ZONES } from "../lib/cities";

/**
 * The city a song is about (migrations/0029): city, country and time zone,
 * all optional. Typing a city we know fills in its country and time zone,
 * unless they've been typed in by hand.
 */
export interface PlaceDraft {
  place_city: string;
  place_country: string;
  place_timezone: string;
}

export const placeDraftOf = (t: any): PlaceDraft => ({
  place_city: t.place_city ?? "",
  place_country: t.place_country ?? "",
  place_timezone: t.place_timezone ?? "",
});

const orNull = (s: string) => s.trim() || null;
export const placePayload = (id: string, d: PlaceDraft) => ({
  id,
  place_city: orNull(d.place_city),
  place_country: orNull(d.place_country),
  place_timezone: orNull(d.place_timezone),
});

export const samePlace = (a: PlaceDraft, b: PlaceDraft) =>
  a.place_city.trim() === b.place_city.trim() && a.place_country.trim() === b.place_country.trim() && a.place_timezone.trim() === b.place_timezone.trim();

/** A new city, with its country and time zone suggested where those are empty or still the last suggestion. */
export function withCity(d: PlaceDraft, city: string): PlaceDraft {
  const before = citySuggestion(d.place_city);
  const after = citySuggestion(city);
  const replaceable = (v: string, was: string | undefined) => !v.trim() || v === was;
  return {
    place_city: city,
    place_country: after && replaceable(d.place_country, before?.country) ? after.country : d.place_country,
    place_timezone: after && replaceable(d.place_timezone, before?.zone) ? after.zone : d.place_timezone,
  };
}

/** The shared lists for the city and time zone inputs (rendered once per page). */
export function PlaceDatalists() {
  return (
    <>
      <datalist id="place-cities">
        {CITY_NAMES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="place-zones">
        {TIME_ZONES.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
    </>
  );
}

export function PlaceInputs({ value, onChange, onKeyDown }: { value: PlaceDraft; onChange: (d: PlaceDraft) => void; onKeyDown?: (e: React.KeyboardEvent) => void }) {
  return (
    <>
      <input
        value={value.place_city}
        list="place-cities"
        aria-label="City"
        placeholder="City (optional)"
        style={{ maxWidth: 170 }}
        onChange={(e) => onChange(withCity(value, e.target.value))}
        onKeyDown={onKeyDown}
      />
      <input
        value={value.place_country}
        aria-label="Country"
        placeholder="Country"
        style={{ maxWidth: 150 }}
        onChange={(e) => onChange({ ...value, place_country: e.target.value })}
        onKeyDown={onKeyDown}
      />
      <input
        value={value.place_timezone}
        list="place-zones"
        aria-label="Time zone"
        placeholder="Time zone, e.g. Asia/Shanghai"
        style={{ maxWidth: 200 }}
        onChange={(e) => onChange({ ...value, place_timezone: e.target.value })}
        onKeyDown={onKeyDown}
      />
    </>
  );
}

/** Places for a whole album at once: one row per song, saved together. */
export function AlbumPlaces({ tracks, onSaved, onClose }: { tracks: any[]; onSaved: (message: string) => void; onClose: () => void }) {
  const albums = useMemo(() => {
    const byId = new Map<string, string>();
    for (const t of tracks) if (t.album_id) byId.set(t.album_id, t.album_title ?? "Untitled album");
    return [...byId].sort((a, b) => a[1].localeCompare(b[1]));
  }, [tracks]);
  const [albumId, setAlbumId] = useState("");
  const songs = useMemo(
    () =>
      tracks
        .filter((t) => t.album_id === albumId)
        .sort((a, b) => (a.track_number ?? 999) - (b.track_number ?? 999) || String(a.title).localeCompare(String(b.title))),
    [tracks, albumId]
  );
  const [drafts, setDrafts] = useState<Record<string, PlaceDraft>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDrafts(Object.fromEntries(songs.map((t) => [t.id, placeDraftOf(t)])));
    setError(null);
  }, [songs]);

  const changed = songs.filter((t) => drafts[t.id] && !samePlace(drafts[t.id], placeDraftOf(t)));

  // Copy the first song's country and time zone down to the songs with none, for an album set in one country.
  const copyDown = () => {
    const first = songs.map((t) => drafts[t.id]).find((d) => d?.place_country.trim() || d?.place_timezone.trim());
    if (!first) return;
    setDrafts((prev) =>
      Object.fromEntries(
        Object.entries(prev).map(([id, d]) => [
          id,
          { ...d, place_country: d.place_country.trim() ? d.place_country : first.place_country, place_timezone: d.place_timezone.trim() ? d.place_timezone : first.place_timezone },
        ])
      )
    );
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await studioApi.setTrackPlaces(changed.map((t) => placePayload(t.id, drafts[t.id])));
      onSaved(`Saved places for ${r.updated} song${r.updated === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the places - please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <strong>Places for an album</strong>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      <p style={{ color: "var(--text-dim)", fontSize: "0.85rem", margin: "6px 0 10px" }}>
        The city each song is about. Listeners see it under the title while the song plays, on any channel. Typing a city suggests its country and time zone.
      </p>
      <select value={albumId} onChange={(e) => setAlbumId(e.target.value)} aria-label="Album" style={{ maxWidth: 320 }}>
        <option value="">Choose an album...</option>
        {albums.map(([id, title]) => (
          <option key={id} value={id}>
            {title}
          </option>
        ))}
      </select>
      {albumId && (
        <>
          <table style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th>Song</th>
                <th>City, country and time zone</th>
              </tr>
            </thead>
            <tbody>
              {songs.map((t) => (
                <tr key={t.id}>
                  <td>
                    {t.track_number ? `${t.track_number}. ` : ""}
                    {t.title}
                  </td>
                  <td>
                    {drafts[t.id] && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <PlaceInputs value={drafts[t.id]} onChange={(d) => setDrafts((prev) => ({ ...prev, [t.id]: d }))} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {error && <p style={{ color: "#f07a7a", fontSize: "0.9rem" }}>{error}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button className="btn primary" onClick={save} disabled={busy || changed.length === 0}>
              {busy ? "Saving..." : changed.length ? `Save ${changed.length} song${changed.length === 1 ? "" : "s"}` : "Nothing to save"}
            </button>
            <button className="btn" onClick={copyDown} disabled={busy}>
              Copy the first country and time zone to empty rows
            </button>
          </div>
        </>
      )}
    </div>
  );
}
