import { useEffect, useState } from "react";
import { studioApi, mediaUrl } from "../../api/client";

interface FeedEpisode {
  guid: string;
  title: string;
  description: string | null;
  audio_url: string;
  duration_seconds: number;
  artwork_url: string | null;
  published_at: string | null;
  episode_number: number | null;
  already_imported: boolean;
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function PodcastImporter() {
  const [feedUrl, setFeedUrl] = useState("");
  const [showName, setShowName] = useState("");
  const [showNameEdited, setShowNameEdited] = useState(false);
  const [episodes, setEpisodes] = useState<FeedEpisode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [channels, setChannels] = useState<any[]>([]);
  const [channelId, setChannelId] = useState("");
  const [channelEdited, setChannelEdited] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null);

  useEffect(() => {
    studioApi.channels().then((r) => {
      setChannels(r.channels);
      const archive = r.channels.find((c: any) => c.slug === "we-are-archive");
      setChannelId(archive?.id ?? r.channels[0]?.id ?? "");
    });
  }, []);

  const fetchFeed = async () => {
    if (!feedUrl.trim()) return;
    setFetching(true);
    setError(null);
    setResult(null);
    try {
      const { episodes: fetched, show_title } = await studioApi.fetchPodcastFeed(feedUrl.trim());
      // Prefill from the feed's own title, but never overwrite a name Kizzi
      // has typed (e.g. when the feed calls the show something different
      // from what she wants listeners to see).
      if (!showNameEdited && show_title) setShowName(show_title);
      // Preselect the channel named after the show (e.g. "Kizzi's Friday Game
      // Changers" -> "Friday Game Changers"), unless she has already chosen.
      if (!channelEdited && show_title) {
        const norm = (t: string) => t.toLowerCase().replace(/['’]/g, "");
        const match = channels.find((c) => norm(show_title).includes(norm(c.name)));
        if (match) setChannelId(match.id);
      }
      setEpisodes(fetched);
      setSelected(new Set(fetched.filter((e: FeedEpisode) => !e.already_imported).map((e: FeedEpisode) => e.guid)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read that feed");
      setEpisodes([]);
    } finally {
      setFetching(false);
    }
  };

  const toggle = (guid: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid);
      else next.add(guid);
      return next;
    });
  };

  const selectAllNew = () => {
    setSelected(new Set(episodes.filter((e) => !e.already_imported).map((e) => e.guid)));
  };

  const selectNone = () => setSelected(new Set());

  const importSelected = async () => {
    const toImport = episodes.filter((e) => selected.has(e.guid) && !e.already_imported);
    if (toImport.length === 0 || !channelId) return;
    setImporting(true);
    setError(null);
    try {
      const r = await studioApi.importPodcastEpisodes(channelId, toImport, showName.trim());
      setResult(r);
      // Re-fetch so the list reflects what's now imported.
      await fetchFeed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const newCount = episodes.filter((e) => !e.already_imported).length;
  const selectedNewCount = episodes.filter((e) => selected.has(e.guid) && !e.already_imported).length;

  return (
    <div>
      <h1>Podcast Importer</h1>
      <p style={{ color: "var(--text-dim)" }}>
        Pull episodes in directly from a podcast RSS feed (e.g. Spotify for Creators - find yours under
        Settings &rarr; Availability &rarr; RSS Distribution on creators.spotify.com), referencing the
        existing hosted audio rather than re-uploading it. Nothing publishes automatically - each
        imported episode lands as a draft programme for you to review and publish as usual.
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="form-row">
          <label>Feed URL</label>
          <input
            value={feedUrl}
            onChange={(e) => {
              setFeedUrl(e.target.value);
              setShowNameEdited(false);
            }}
            placeholder="https://anchor.fm/s/.../podcast/rss"
          />
        </div>
        <button className="btn primary" onClick={fetchFeed} disabled={fetching || !feedUrl.trim()}>
          {fetching ? "Fetching..." : episodes.length > 0 ? "Check for new episodes" : "Fetch episodes"}
        </button>
        {error && <p style={{ color: "var(--accent)" }}>{error}</p>}
      </div>

      {episodes.length > 0 && (
        <>
          <div className="card" style={{ marginBottom: 20, display: "flex", gap: 14, alignItems: "center" }}>
            <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
              <label>Import into channel</label>
              <select value={channelId} onChange={(e) => {
                  setChannelId(e.target.value);
                  setChannelEdited(true);
                }}>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row" style={{ marginBottom: 0, flex: 1 }}>
              <label>Show name (shown on episode cards)</label>
              <input
                value={showName}
                onChange={(e) => {
                  setShowName(e.target.value);
                  setShowNameEdited(true);
                }}
                placeholder="e.g. Kizzi's Friday Game Changers"
              />
            </div>
            <button className="btn" onClick={selectAllNew}>
              Select all new ({newCount})
            </button>
            <button className="btn" onClick={selectNone}>
              Select none
            </button>
            <button className="btn primary" onClick={importSelected} disabled={importing || selectedNewCount === 0}>
              {importing ? "Importing..." : `Import ${selectedNewCount} episode${selectedNewCount === 1 ? "" : "s"}`}
            </button>
          </div>

          {result && (
            <p style={{ color: "var(--text-dim)" }}>
              Imported {result.imported}
              {result.skipped > 0 ? `, skipped ${result.skipped} already imported` : ""}.
            </p>
          )}

          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}></th>
                <th style={{ width: 56 }}></th>
                <th>Title</th>
                <th>Published</th>
                <th>Duration</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {episodes.map((ep) => (
                <tr key={ep.guid} style={ep.already_imported ? { opacity: 0.5 } : undefined}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(ep.guid)}
                      disabled={ep.already_imported}
                      onChange={() => toggle(ep.guid)}
                    />
                  </td>
                  <td>
                    {ep.artwork_url && (
                      <img
                        src={mediaUrl(ep.artwork_url)}
                        alt=""
                        width={40}
                        height={40}
                        style={{ objectFit: "cover", borderRadius: 4, display: "block" }}
                      />
                    )}
                  </td>
                  <td>{ep.title}</td>
                  <td className="muted">{formatDate(ep.published_at)}</td>
                  <td className="muted">{Math.round(ep.duration_seconds / 60)} min</td>
                  <td>{ep.already_imported && <span className="badge">imported</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
