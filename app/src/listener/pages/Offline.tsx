import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { publicApi } from "../../api/client";
import {
  cancelDownload,
  downloadBlock,
  downloadFraction,
  formatBytes,
  isIOS,
  offlineSupported,
  playDownloads,
  removeAllDownloads,
  removeBlock,
  storageInfo,
  useDownloadProgress,
  useOfflineBlocks,
  useOnline,
  type OfflineBlock,
} from "../../shared/offline";
import { InstallCard } from "../components/InstallCard";

const DURATIONS = [
  { minutes: 30, label: "Next 30 minutes" },
  { minutes: 60, label: "Next hour" },
];

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ChannelRow({
  slug,
  name,
  block,
  online,
  highlight,
  withdrawn,
}: {
  slug: string;
  name: string;
  block?: OfflineBlock;
  online: boolean;
  highlight: boolean;
  /** Downloaded earlier, but the channel has since been switched off: remove only. */
  withdrawn: boolean;
}) {
  const progress = useDownloadProgress();
  const mine = progress?.channelSlug === slug ? progress : null;
  const busy = !!progress && !progress.finished;
  const downloadingHere = !!mine && !mine.finished;
  const minutes = block ? Math.round(block.items.reduce((s, i) => s + i.duration_seconds, 0) / 60) : 0;

  return (
    <div className={`off-channel${highlight ? " is-highlight" : ""}`}>
      <div className="off-channel-head">
        <h3>{name}</h3>
        {block && (
          <span className="off-meta">
            Downloaded {formatWhen(block.downloadedAt)} &middot; {block.items.length} tracks &middot; about {minutes} min &middot; {formatBytes(block.bytes)}
          </span>
        )}
      </div>

      {downloadingHere ? (
        <div className="off-progress" role="status">
          <div className="off-bar">
            <span style={{ width: `${downloadFraction(mine!) * 100}%` }} />
          </div>
          <div className="off-progress-row">
            <span>
              {mine!.total ? `Downloading ${Math.min(mine!.done + 1, mine!.total)} of ${mine!.total}` : "Getting the running order..."} &middot; {formatBytes(mine!.bytes)}
            </span>
            <button type="button" className="btn" onClick={cancelDownload}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="off-actions">
          {withdrawn && <span className="off-meta">This channel is no longer on air, so its download can't be played.</span>}
          {block && !withdrawn && (
            <button type="button" className="btn primary" onClick={() => playDownloads(slug)}>
              ▶ Play downloads
            </button>
          )}
          {online &&
            !withdrawn &&
            DURATIONS.map((d) => (
              <button key={d.minutes} type="button" className="btn" disabled={busy} onClick={() => void downloadBlock(slug, d.minutes)}>
                {block ? `Replace with ${d.label.toLowerCase()}` : `Download ${d.label.toLowerCase()}`}
              </button>
            ))}
          {block && (
            <button type="button" className="btn off-remove" onClick={() => void removeBlock(slug)}>
              Remove
            </button>
          )}
        </div>
      )}
      {mine?.finished && mine.error && <p className="off-error">{mine.error}</p>}
      {mine?.finished && !mine.error && block && <p className="off-done">Downloaded - ready to play with no connection.</p>}
    </div>
  );
}

/**
 * Offline listening: download the next stretch of a live channel, see what's
 * stored and how much room it takes, remove it, and play it. Also where the
 * "install the app" offer lives.
 */
export function Offline() {
  const online = useOnline();
  const blocks = useOfflineBlocks();
  const [params] = useSearchParams();
  const highlight = params.get("channel");
  const [channels, setChannels] = useState<{ slug: string; name: string }[] | null>(null);
  const [quota, setQuota] = useState<number | null>(null);

  // Live channels only - the only ones that can be downloaded.
  useEffect(() => {
    publicApi
      .channels()
      .then((r) => setChannels(r.channels.map((c) => ({ slug: c.slug, name: c.name }))))
      .catch(() => setChannels(null));
  }, [online]);

  useEffect(() => {
    storageInfo().then((s) => setQuota(s.quota));
  }, [blocks]);

  // Live channels, plus any channel with a download (offline, the live list
  // can't be fetched; online, a download may be of a channel since switched off).
  const rows = [...(channels ?? [])];
  for (const b of blocks ?? []) {
    if (!rows.some((r) => r.slug === b.channelSlug)) rows.push({ slug: b.channelSlug, name: b.channelName });
  }
  // Arrived from a channel's download button: that channel first, in view.
  rows.sort((a, b) => Number(b.slug === highlight) - Number(a.slug === highlight));
  const channelsHeading = useRef<HTMLHeadingElement>(null);
  const scrolled = useRef(false);
  useEffect(() => {
    if (highlight && channels && !scrolled.current) {
      scrolled.current = true;
      channelsHeading.current?.scrollIntoView({ block: "start" });
    }
  }, [highlight, channels]);
  const total = (blocks ?? []).reduce((sum, b) => sum + b.bytes, 0);

  return (
    <div className="off-page">
      <h1>Offline listening</h1>
      <p className="off-intro">
        Download the next stretch of a channel and keep listening with no signal - on a plane, on the Underground, anywhere. It plays in order, just as it was on air.
      </p>

      {!online && (
        <div className="off-notice" role="status">
          You're offline. {blocks?.length ? "Your downloads still play - press Play downloads." : "Nothing is downloaded yet - come back here when you're connected."}
        </div>
      )}

      <InstallCard />

      {!offlineSupported ? (
        <p className="off-error">This browser can't store music for offline listening. Try Chrome on Android, or Safari on iPhone.</p>
      ) : (
        <>
          <h2 className="off-h2" ref={channelsHeading}>Channels</h2>
          {rows.length === 0 && <p className="off-meta">{online ? "Loading channels..." : "No downloads on this device."}</p>}
          {rows.map((c) => (
            <ChannelRow
              key={c.slug}
              slug={c.slug}
              name={c.name}
              block={blocks?.find((b) => b.channelSlug === c.slug)}
              online={online}
              highlight={highlight === c.slug}
              withdrawn={!!channels && !channels.some((ch) => ch.slug === c.slug)}
            />
          ))}

          <h2 className="off-h2">Storage</h2>
          <p className="off-meta">
            Downloads on this device: <strong>{total ? formatBytes(total) : "none"}</strong>
            {quota ? ` (this browser allows the site up to about ${formatBytes(quota)})` : ""}.
          </p>
          <p className="off-meta">An hour of radio takes roughly 100 MB of space.</p>
          {isIOS() && (
            <p className="off-meta">
              On iPhone, keep downloads short - the phone gives websites limited space, and may clear downloads if the app isn't opened for about a week.
            </p>
          )}
          {!!blocks?.length && (
            <button type="button" className="btn off-remove" onClick={() => void removeAllDownloads()}>
              Remove all downloads
            </button>
          )}
        </>
      )}
    </div>
  );
}
