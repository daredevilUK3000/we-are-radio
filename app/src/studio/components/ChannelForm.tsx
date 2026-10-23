import { useEffect, useMemo, useState } from "react";
import { studioApi, uploadFileToR2 } from "../../api/client";
import { channelMediaUrl } from "../../shared/channelInfo";

/**
 * New channel / Edit on the Studio Channels page (migrations/0029): the
 * channel's name, web address, colour, card picture and clip, and which songs
 * it plays - albums and/or tags, as its catalogue_rules.
 */

// Suggestions only: the colour field takes any colour.
const SWATCHES = ["#8B5CF6", "#A855F7", "#14B8A6", "#22C55E", "#EC4899", "#F97316"];
const FOUR_HOURS = 4 * 3600;

export const slugFrom = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");

const rulesOf = (c: any): { tags: string[]; albums: string[] } => {
  try {
    const r = c?.catalogue_rules ? JSON.parse(c.catalogue_rules) : null;
    return { tags: r?.tags_any ?? [], albums: r?.albums_any ?? [] };
  } catch {
    return { tags: [], albums: [] };
  }
};

const hours = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
};

function Upload({ label, accept, value, onChange, video }: { label: string; accept: string; value: string; onChange: (key: string) => void; video?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const url = channelMediaUrl(value);

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { upload_url, key } = await studioApi.presignUpload(file.name, file.type, "channels");
      await uploadFileToR2(upload_url, file);
      onChange(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed - please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <label style={{ display: "block", fontSize: "0.85rem", marginBottom: 4 }}>{label}</label>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        {url &&
          (video ? (
            <video src={url} muted loop autoPlay playsInline style={{ width: 120, aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 6 }} />
          ) : (
            <img src={url} alt="" style={{ width: 120, aspectRatio: "4 / 3", objectFit: "cover", borderRadius: 6 }} />
          ))}
        <input type="file" accept={accept} disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} />
        {busy && <span style={{ fontSize: "0.85rem" }}>Uploading...</span>}
        {url && !busy && (
          <button type="button" className="btn" onClick={() => onChange("")}>
            Remove
          </button>
        )}
      </div>
      {error && <div style={{ color: "#f07a7a", fontSize: "0.85rem" }}>{error}</div>}
    </div>
  );
}

export function ChannelForm({ channel, onDone, onCancel }: { channel: any | null; onDone: (message: string) => void; onCancel: () => void }) {
  const initialRules = useMemo(() => rulesOf(channel), [channel]);
  const [name, setName] = useState<string>(channel?.name ?? "");
  const [slug, setSlug] = useState<string>(channel?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(!!channel);
  const [emoji, setEmoji] = useState<string>(channel?.emoji ?? "");
  const [description, setDescription] = useState<string>(channel?.description ?? "");
  const [shortLabel, setShortLabel] = useState<string>(channel?.short_label ?? "");
  const [accent, setAccent] = useState<string>(channel?.accent ?? "");
  const [cardImage, setCardImage] = useState<string>(channel?.card_image ?? "");
  const [cardVideo, setCardVideo] = useState<string>(channel?.card_video ?? "");
  const [albums, setAlbums] = useState<string[]>(initialRules.albums);
  const [tags, setTags] = useState<string[]>(initialRules.tags);
  const [allAlbums, setAllAlbums] = useState<any[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [pool, setPool] = useState<{ tracks: number; seconds: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    studioApi.albums().then((r) => setAllAlbums(r.albums)).catch(() => {});
    studioApi.tags().then((r) => setAllTags(r.tags.map((t: any) => t.name).sort())).catch(() => {});
  }, []);

  // The song count and hours, as the picker changes.
  useEffect(() => {
    let live = true;
    setPool(null);
    const id = setTimeout(() => {
      studioApi
        .channelPool(albums, tags)
        .then((r) => live && setPool(r))
        .catch(() => {});
    }, 250);
    return () => {
      live = false;
      clearTimeout(id);
    };
  }, [albums, tags]);

  const isLive = channel?.status === "live";
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const data: Record<string, unknown> = {
      name,
      emoji,
      description,
      short_label: shortLabel,
      accent: accent || null,
      card_image: cardImage || null,
      card_video: cardVideo || null,
      albums,
      tags,
    };
    if (!isLive) data.slug = slug;
    try {
      if (channel) {
        await studioApi.updateChannel(channel.id, data);
        onDone(`Saved ${name}.`);
      } else {
        await studioApi.createChannel(data);
        onDone(`Created ${name}. It stays in building, hidden from listeners, until you press Go live.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the channel - please try again.");
    } finally {
      setBusy(false);
    }
  };

  const field = { display: "block", fontSize: "0.85rem", marginBottom: 4 } as const;

  return (
    <div className="card" style={{ marginBottom: 16, display: "grid", gap: 14 }}>
      <strong>{channel ? `Edit ${channel.name}` : "New channel"}</strong>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 220px" }}>
          <label style={field}>Name</label>
          <input
            value={name}
            maxLength={60}
            placeholder="We Are WanderLust"
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugFrom(e.target.value));
            }}
          />
        </div>
        <div style={{ flex: "1 1 220px" }}>
          <label style={field}>Web address</label>
          <input
            value={slug}
            maxLength={40}
            disabled={isLive}
            onChange={(e) => {
              setSlugTouched(true);
              setSlug(e.target.value.toLowerCase());
            }}
          />
          <div style={{ color: "var(--text-dim)", fontSize: "0.8rem", marginTop: 2 }}>
            weareradio.app/channel/{slug || "..."}
            {isLive ? " (fixed once live)" : " - can't change after Go live"}
          </div>
        </div>
        <div style={{ flex: "0 0 90px" }}>
          <label style={field}>Emoji</label>
          <input value={emoji} maxLength={8} placeholder="🌍" onChange={(e) => setEmoji(e.target.value)} />
        </div>
      </div>

      <div>
        <label style={field}>Description (one line, shown to listeners)</label>
        <input value={description} maxLength={160} placeholder="Songs about the world's great cities" style={{ width: "100%", maxWidth: 560 }} onChange={(e) => setDescription(e.target.value)} />
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label style={field}>Accent colour</label>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <input type="color" value={accent || "#8B8B93"} onChange={(e) => setAccent(e.target.value.toUpperCase())} style={{ width: 44, height: 32, padding: 0 }} aria-label="Accent colour" />
            {SWATCHES.map((s) => (
              <button
                key={s}
                type="button"
                title={s}
                aria-label={`Use ${s}`}
                onClick={() => setAccent(s)}
                style={{ width: 24, height: 24, borderRadius: "50%", background: s, border: accent === s ? "2px solid #fff" : "1px solid var(--border)", cursor: "pointer" }}
              />
            ))}
            <span style={{ fontSize: "0.8rem", color: "var(--text-dim)" }}>{accent || "none (grey)"}</span>
          </div>
        </div>
        <div style={{ flex: "0 1 200px" }}>
          <label style={field}>Short label (optional)</label>
          <input value={shortLabel} maxLength={24} placeholder="WanderLust" onChange={(e) => setShortLabel(e.target.value)} />
        </div>
      </div>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Upload label="Card picture (also the TV background)" accept="image/jpeg,image/png,image/webp" value={cardImage} onChange={setCardImage} />
        <Upload label="Card clip (optional, a short looping MP4)" accept="video/mp4" value={cardVideo} onChange={setCardVideo} video />
      </div>

      <div>
        <label style={field}>Songs: pick albums and/or tags</label>
        <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px", maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}>
            <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginBottom: 4 }}>Albums</div>
            {allAlbums.map((a) => (
              <label key={a.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.9rem" }}>
                <input type="checkbox" checked={albums.includes(a.id)} onChange={() => toggle(albums, setAlbums, a.id)} />
                {a.title}
              </label>
            ))}
          </div>
          <div style={{ flex: "1 1 200px", maxHeight: 220, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 6, padding: 8 }}>
            <div style={{ fontSize: "0.8rem", color: "var(--text-dim)", marginBottom: 4 }}>Tags</div>
            {allTags.map((t) => (
              <label key={t} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.9rem" }}>
                <input type="checkbox" checked={tags.includes(t)} onChange={() => toggle(tags, setTags, t)} />
                {t}
              </label>
            ))}
          </div>
        </div>
        <div style={{ fontSize: "0.9rem", marginTop: 8 }}>
          {!albums.length && !tags.length && "Nothing picked: the channel plays every published song (as Kizzi Radio does). "}
          {pool ? (
            <>
              <strong>{pool.tracks}</strong> published song{pool.tracks === 1 ? "" : "s"}, <strong>{hours(pool.seconds)}</strong> of music.
              {pool.seconds < FOUR_HOURS && <span style={{ color: "#f0a12a" }}> Under 4 hours: listeners may hear repeats.</span>}
            </>
          ) : (
            <span style={{ color: "var(--text-dim)" }}>Counting...</span>
          )}
        </div>
      </div>

      {error && <p style={{ color: "#f07a7a", fontSize: "0.9rem", margin: 0 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn primary" onClick={save} disabled={busy || !name.trim() || !slug.trim()}>
          {busy ? "Saving..." : channel ? "Save" : "Create channel"}
        </button>
        <button className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
