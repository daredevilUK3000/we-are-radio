import { Fragment, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { studioApi, mediaUrl } from "../../api/client";
import { ChipPicker } from "../components/ChipPicker";
import { JingleSettings, JinglePreviewButton, PreviewSongPicker } from "../components/JingleSettings";
import { MOOD_OPTIONS } from "../lib/presets";
import { LINK_KINDS } from "./RecordLink";

// The Audio library is split in two so a jingle is never lost among the
// spoken material: each type belongs to exactly one section, so anything
// uploaded lands in the right place automatically.
const JINGLE_TYPES = ["jingle", "station_id", "promo"];
const SPOKEN_TYPES = ["link", "feature", "interview"];

const TABS = {
  jingles: {
    label: "Jingles & Station IDs",
    types: JINGLE_TYPES,
    upload: "Upload jingle",
    blurb:
      'Jingles, station IDs and promos. Tag them "morning", "afternoon", "evening" or "night" so the right one plays when the main player changes channel, use Preview to hear a jingle against a song, and Playback settings to choose whether it plays as its own clip or over the music.',
    empty: "No jingles yet - upload one and it will appear here.",
  },
  spoken: {
    label: "Spoken & Features",
    types: SPOKEN_TYPES,
    upload: "Upload audio",
    blurb:
      "Spoken links, features and interviews - the talking building blocks of a running order. Links you record in your own voice (an intro, a bridge between songs, a fun fact, an outro) are what make each listener's personal programme sound presented: set what each one is for, and tag the moods it suits.",
    empty: "No spoken audio yet - upload some and it will appear here.",
  },
} as const;

type TabKey = keyof typeof TABS;

const TYPE_LABELS: Record<string, string> = {
  jingle: "jingle",
  station_id: "station ID",
  promo: "promo",
  link: "link",
  feature: "feature",
  interview: "interview",
};

export function AudioAssets() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: TabKey = searchParams.get("tab") === "spoken" ? "spoken" : "jingles";

  const [assets, setAssets] = useState<any[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [editingTagsId, setEditingTagsId] = useState<string | null>(null);
  const [editingPlaybackId, setEditingPlaybackId] = useState<string | null>(null);

  // Podcast episodes are audio assets too (hundreds of them), but they're
  // managed on the Podcasts page - only files uploaded here belong in this list.
  const load = () =>
    studioApi.audioAssets({ storage: "r2" }).then((r) => {
      // Recordings made for a Time Capsule are managed on that page, not here.
      setAssets(r.audio_assets.filter((a: any) => !a.capsule_count));
      setLoaded(true);
    });
  useEffect(() => {
    load();
  }, []);

  const setStatus = async (id: string, status: string) => {
    await studioApi.updateAudioAsset(id, { status });
    load();
  };

  const tagsFor = (a: any): string[] => (a.tag_names ? a.tag_names.split(",") : []);

  const setTags = async (id: string, tags: string[]) => {
    await studioApi.setAudioAssetTags(id, tags);
    load();
  };

  const countFor = (key: TabKey) => assets.filter((a) => (TABS[key].types as readonly string[]).includes(a.type)).length;

  const current = TABS[tab];
  const query = search.trim().toLowerCase();
  const visible = assets.filter(
    (a) =>
      (current.types as readonly string[]).includes(a.type) &&
      (!query || a.title.toLowerCase().includes(query) || tagsFor(a).some((t) => t.toLowerCase().includes(query)))
  );

  const switchTab = (key: TabKey) => {
    setSearchParams(key === "jingles" ? {} : { tab: key });
    setSearch("");
    setPlayingId(null);
    setEditingTagsId(null);
    setEditingPlaybackId(null);
  };

  const showPlaybackColumn = tab === "jingles";
  const columns = showPlaybackColumn ? 7 : 6;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Audio</h1>
        <div style={{ display: "flex", gap: 8 }}>
          {tab === "spoken" && (
            <Link to="/studio/record-link" className="btn primary">
              ● Record a link
            </Link>
          )}
          <Link to={`/studio/audio/upload?kind=${tab}`} className={tab === "spoken" ? "btn" : "btn primary"}>
            {current.upload}
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {(Object.keys(TABS) as TabKey[]).map((key) => (
          <button key={key} className={`chip${tab === key ? " selected" : ""}`} onClick={() => switchTab(key)}>
            {TABS[key].label}
            {loaded ? ` (${countFor(key)})` : ""}
          </button>
        ))}
      </div>

      <p style={{ color: "var(--text-dim)" }}>{current.blurb}</p>

      <div className="form-row" style={{ maxWidth: 320 }}>
        <input
          type="search"
          placeholder={`Search ${current.label.toLowerCase()}...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Type</th>
            <th>Tags</th>
            {!showPlaybackColumn && <th>Used as</th>}
            {showPlaybackColumn && <th>Plays</th>}
            {showPlaybackColumn && <th>Preview over</th>}
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {visible.map((a) => (
            <Fragment key={a.id}>
              <tr>
                <td>{a.title}</td>
                <td>
                  <span className="badge">{TYPE_LABELS[a.type] ?? a.type}</span>
                </td>
                <td>
                  {tagsFor(a).length > 0 ? (
                    tagsFor(a).map((t) => (
                      <span key={t} className="badge" style={{ marginRight: 4 }}>
                        {t}
                      </span>
                    ))
                  ) : (
                    <span style={{ color: "var(--text-dim)" }}>none</span>
                  )}
                </td>
                {!showPlaybackColumn && (
                  <td>
                    {a.type === "link" ? (
                      <select
                        value={a.link_kind ?? ""}
                        aria-label="What this link is for"
                        onChange={async (e) => {
                          await studioApi.updateAudioAsset(a.id, { link_kind: e.target.value || null });
                          load();
                        }}
                      >
                        <option value="">(not used in programmes)</option>
                        {LINK_KINDS.map((k) => (
                          <option key={k.value} value={k.value}>
                            {k.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span style={{ color: "var(--text-dim)" }}>-</span>
                    )}
                  </td>
                )}
                {showPlaybackColumn && (
                  <td>
                    <span className={`badge${a.play_mode === "duck_over_music" ? " live" : ""}`}>
                      {a.play_mode === "duck_over_music"
                        ? `Over music · ${Math.round((a.duck_level ?? 0.28) * 100)}%`
                        : "Sequenced"}
                    </span>
                    {a.pin_count > 0 && (
                      <span className="badge live" style={{ marginLeft: 4 }}>
                        Pinned to {a.pin_count} song{a.pin_count === 1 ? "" : "s"}
                      </span>
                    )}
                  </td>
                )}
                {showPlaybackColumn && (
                  <td>
                    <PreviewSongPicker assetId={a.id} style={{ maxWidth: 170 }} />
                  </td>
                )}
                <td>
                  <span className="badge">{a.status}</span>
                </td>
                <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button className="btn" onClick={() => setPlayingId(playingId === a.id ? null : a.id)}>
                    {playingId === a.id ? "Hide player" : "Play"}
                  </button>
                  <button className="btn" onClick={() => setEditingTagsId(editingTagsId === a.id ? null : a.id)}>
                    {editingTagsId === a.id ? "Done" : "Edit tags"}
                  </button>
                  {showPlaybackColumn && <JinglePreviewButton asset={a} />}
                  {showPlaybackColumn && (
                    <button
                      className="btn"
                      onClick={() => setEditingPlaybackId(editingPlaybackId === a.id ? null : a.id)}
                    >
                      {editingPlaybackId === a.id ? "Close" : "Playback settings"}
                    </button>
                  )}
                  {a.status !== "published" && (
                    <button className="btn" onClick={() => setStatus(a.id, "published")}>
                      Publish
                    </button>
                  )}
                </td>
              </tr>
              {playingId === a.id && (
                <tr>
                  <td colSpan={columns} style={{ paddingTop: 0 }}>
                    <audio controls autoPlay src={mediaUrl(a.audio_url)} style={{ width: "100%" }} />
                  </td>
                </tr>
              )}
              {editingPlaybackId === a.id && (
                <tr>
                  <td colSpan={columns} style={{ paddingTop: 0 }}>
                    <JingleSettings
                      asset={a}
                      onSaved={() => {
                        setEditingPlaybackId(null);
                        load();
                      }}
                    />
                  </td>
                </tr>
              )}
              {editingTagsId === a.id && (
                <tr>
                  <td colSpan={columns} style={{ paddingTop: 0 }}>
                    <ChipPicker options={MOOD_OPTIONS} value={tagsFor(a)} onChange={(next) => setTags(a.id, next)} />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
          {loaded && visible.length === 0 && (
            <tr>
              <td colSpan={columns} style={{ color: "var(--text-dim)" }}>
                {query ? "Nothing matches that search." : current.empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
