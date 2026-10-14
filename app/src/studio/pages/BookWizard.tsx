import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { mediaUrl, studioApi, uploadFileToR2 } from "../../api/client";
import { readAudioDuration } from "./UploadAudioAsset";
import "../../listener/components/promo/promo.css";
import "./promoWizard.css";

/**
 * A Book of the Month, step by step (handoff 14 Oct 2026, §4.2): the book,
 * the segment, when it airs, then a check and "Create draft airings". The
 * airings go into the Scheduler's working copy as draft blocks: nothing airs
 * until Kizzi publishes them on the Timeline. With ?id= it edits a book.
 */

const STEPS = ["The book", "The segment", "When it airs", "Check and create"];
const LABELS = ["Get the book", "Buy the book", "Order now", "Find out more"];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
const linkValid = (u: string) => {
  try {
    return /^https:\/\//i.test(u.trim()) && new URL(u.trim()).hostname.includes(".");
  } catch {
    return false;
  }
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const monthLabel = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
};
const addMonths = (m: string, n: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthDates = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return { from: `${m}-01`, to: `${m}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}` };
};
const describeDays = (mask: number) =>
  mask === 31 ? "Monday to Friday" : mask === 96 ? "Saturday and Sunday" : mask === 127 ? "Every day" : DAY_LABELS.filter((_, i) => mask & (1 << i)).join(", ") || "No days";

type Row = { days_mask: number; start_min: number };
type Feature = { id: string; title: string; duration_seconds: number | null; audio_url: string; status: string };

/** The same checks as the Worker's airingWarnings (lib/books.ts): warnings, never blocks. */
function warningsFor(rows: Row[], lengthMin: number): string[] {
  const out: string[] = [];
  for (let d = 0; d < 7; d++) {
    const n = rows.filter((r) => r.days_mask & (1 << d)).length;
    if (n > 2) out.push(`It would air ${n} times on ${DAY_LABELS[d]}: twice a day is plenty for a 5-minute feature.`);
  }
  const byTime = new Map<number, number>();
  for (const r of rows) byTime.set(r.start_min, (byTime.get(r.start_min) ?? 0) | r.days_mask);
  for (const [t, mask] of byTime) if (mask === 127) out.push(`It would air at ${hhmm(t)} every day: listeners at that time would hear it daily. Try a different time at weekends.`);
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++)
      if (rows[i].days_mask & rows[j].days_mask && Math.abs(rows[i].start_min - rows[j].start_min) < lengthMin)
        out.push(`The ${hhmm(rows[i].start_min)} and ${hhmm(rows[j].start_min)} airings overlap: each takes ${lengthMin} minutes.`);
  return out;
}

export function BookWizard() {
  const [params] = useSearchParams();
  const editId = params.get("id");

  const [loaded, setLoaded] = useState(false);
  const [step, setStep] = useState(0);
  const [books, setBooks] = useState<any[]>([]);
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [currentMonth, setCurrentMonth] = useState("");

  // Step 1: the book
  const [month, setMonth] = useState("");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("Kizzi Nkwocha");
  const [blurb, setBlurb] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [buyUrl, setBuyUrl] = useState("https://");
  const [buyLabel, setBuyLabel] = useState("Get the book");
  const [tested, setTested] = useState(false);
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  // Step 2: the segment and its jingle
  const [segmentMode, setSegmentMode] = useState<"upload" | "pick">("upload");
  const [segmentFile, setSegmentFile] = useState<File | null>(null);
  const [segmentSeconds, setSegmentSeconds] = useState<number | null>(null);
  const [segmentId, setSegmentId] = useState("");
  const [jingleMode, setJingleMode] = useState<"pick" | "upload" | "none">("pick");
  const [jingleFile, setJingleFile] = useState<File | null>(null);
  const [jingleSeconds, setJingleSeconds] = useState<number | null>(null);
  const [jingleId, setJingleId] = useState("");
  // Step 3: when it airs
  const [picked, setPicked] = useState<string[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Row[]>([]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(editId);
  // Uploaded once: kept so trying again after a problem doesn't upload them twice.
  const [uploaded, setUploaded] = useState<{ segment?: string; jingle?: string }>({});
  const [done, setDone] = useState<null | { airings: boolean; blocks: number; channels: string[]; warnings: string[] }>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    studioApi.books().then((r) => {
      setBooks(r.books);
      setChannels(r.channels);
      setFeatures(r.features);
      setCurrentMonth(r.current_month);
      const b = editId ? r.books.find((x: any) => x.id === editId) : null;
      if (b) {
        setMonth(b.month);
        setTitle(b.title);
        setAuthor(b.author);
        setBlurb(b.blurb ?? "");
        setCoverKey(b.cover_url ?? null);
        setBuyUrl(b.buy_url ?? "https://");
        setBuyLabel(b.buy_label ?? "Get the book");
        setSlug(b.slug);
        setSlugTouched(true);
        if (b.segment_asset_id) {
          setSegmentMode("pick");
          setSegmentId(b.segment_asset_id);
        }
        setJingleMode(b.jingle_asset_id ? "pick" : "none");
        setJingleId(b.jingle_asset_id ?? "");
        const a = b.airing_settings;
        const d = monthDates(b.month);
        setPicked(a?.channels ?? r.channels.map((c) => c.id));
        setFrom(a?.date_from ?? d.from);
        setTo(a?.date_to ?? d.to);
        setRows(a?.rows ?? r.default_rows);
      } else {
        // The next month without a book, starting with this one.
        const taken = new Set(r.books.map((x: any) => x.month));
        let m = r.current_month;
        for (let i = 0; i < 24 && taken.has(m); i++) m = addMonths(m, 1);
        setMonth(m);
        setJingleId(r.jingle_asset_id ?? "");
        setJingleMode(r.jingle_asset_id ? "pick" : r.features.length ? "pick" : "upload");
        setPicked(r.channels.map((c) => c.id));
        setRows(r.default_rows);
      }
      setLoaded(true);
    });
  }, [editId]);

  // The short link follows the title until one is typed.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(title));
  }, [title, slugTouched]);

  // The dates follow the month for a new book (the whole month).
  const lastMonth = useRef("");
  useEffect(() => {
    if (!month || month === lastMonth.current) return;
    const prev = lastMonth.current;
    lastMonth.current = month;
    if (editId && !prev) return; // a book being edited keeps its saved dates
    const d = monthDates(month);
    setFrom(d.from);
    setTo(d.to);
  }, [month, editId]);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const coverUrl = useMemo(() => (coverFile ? URL.createObjectURL(coverFile) : coverKey ? mediaUrl(coverKey) : null), [coverFile, coverKey]);
  const segmentFileUrl = useMemo(() => (segmentFile ? URL.createObjectURL(segmentFile) : null), [segmentFile]);

  const segFeature = features.find((f) => f.id === segmentId);
  const jinFeature = features.find((f) => f.id === jingleId);
  const segLength = segmentMode === "upload" ? segmentSeconds : (segFeature?.duration_seconds ?? null);
  const jinLength = jingleMode === "none" ? 0 : jingleMode === "upload" ? (jingleSeconds ?? 0) : (jinFeature?.duration_seconds ?? 0);
  const lengthMin = segLength ? Math.max(5, Math.ceil(((segLength + jinLength) * 1000) / 300_000) * 5) : 0;
  const warnings = lengthMin ? warningsFor(rows, lengthMin) : [];

  const monthTaken = books.find((b) => b.month === month && b.id !== savedId);
  const slugTaken = books.some((b) => b.slug === slug && b.id !== savedId);
  const months = useMemo(() => {
    if (!currentMonth) return [];
    const list = Array.from({ length: 13 }, (_, i) => addMonths(currentMonth, i - 1));
    return month && !list.includes(month) ? [month, ...list] : list;
  }, [currentMonth, month]);

  const problem = (s: number): string | null => {
    if (s === 0) {
      if (!month) return "Choose the month.";
      if (monthTaken) return `${monthTaken.title} is already the Book of the Month for ${monthLabel(month)}.`;
      if (!title.trim()) return "Give the book's title.";
      if (!linkValid(buyUrl)) return "Paste the full purchase link, starting with https://";
      if (!buyLabel.trim()) return "Choose the words on the button.";
      if (!SLUG.test(slug)) return "Use lower-case letters, numbers and hyphens for the short link, e.g. ikigai.";
      if (slugTaken) return "Another book already uses this short link: try another.";
      return null;
    }
    if (s === 1) {
      if (segmentMode === "upload" && !segmentFile && !uploaded.segment) return "Choose the segment to upload, or pick one already uploaded.";
      if (segmentMode === "upload" && segmentFile && !segmentSeconds) return "Reading the recording...";
      if (segmentMode === "pick" && !segmentId) return "Pick the segment.";
      if (jingleMode === "pick" && !jingleId) return 'Pick the jingle, upload it, or choose "No jingle".';
      if (jingleMode === "upload" && !jingleFile && !uploaded.jingle) return "Choose the jingle to upload.";
      return null;
    }
    if (s === 2) {
      if (picked.length === 0) return "Choose at least one channel.";
      if (!from || !to) return "Choose the first and last day.";
      if (to < from) return "The last day comes before the first.";
      if (rows.length === 0) return "Add at least one airing.";
      if (rows.some((r) => !r.days_mask)) return "Each airing needs at least one day.";
      return null;
    }
    return null;
  };
  const blocker = problem(step);

  const readFile = async (f: File | null, setFile: (f: File | null) => void, setSeconds: (n: number | null) => void) => {
    setFile(f);
    setSeconds(null);
    if (!f) return;
    try {
      setSeconds(await readAudioDuration(f));
    } catch {
      setError("That file couldn't be read as audio. Try an MP3 or M4A.");
      setFile(null);
    }
  };

  const uploadFeature = async (file: File, seconds: number, name: string) => {
    const up = await studioApi.presignUpload(file.name, file.type, "audio");
    await uploadFileToR2(up.upload_url, file);
    const created = await studioApi.createAudioAsset({ type: "feature", title: name, description: null, duration_seconds: seconds, audio_url: up.key, status: "published" });
    return created.id as string;
  };

  const finish = async (withAirings: boolean) => {
    setBusy(true);
    setError(null);
    try {
      let seg = segmentMode === "pick" ? segmentId : uploaded.segment;
      if (!seg) {
        if (!segmentFile || !segmentSeconds) throw new Error("The segment is missing.");
        seg = await uploadFeature(segmentFile, segmentSeconds, `Book of the Month: ${title.trim()}`);
        setUploaded((u) => ({ ...u, segment: seg }));
      }
      let jin: string | null = jingleMode === "none" ? null : jingleMode === "pick" ? jingleId : (uploaded.jingle ?? null);
      if (jingleMode === "upload" && !jin) {
        if (!jingleFile) throw new Error("The jingle is missing.");
        jin = await uploadFeature(jingleFile, jingleSeconds ?? 5, "Book of the Month jingle");
        setUploaded((u) => ({ ...u, jingle: jin ?? undefined }));
      }
      let cover = coverKey;
      if (coverFile) {
        const up = await studioApi.presignUpload(coverFile.name, coverFile.type, "artwork");
        await uploadFileToR2(up.upload_url, coverFile);
        cover = up.key;
        setCoverKey(cover);
        setCoverFile(null);
      }
      const data = {
        month,
        title: title.trim(),
        author: author.trim(),
        blurb: blurb.trim(),
        cover_url: cover,
        buy_url: buyUrl.trim(),
        buy_label: buyLabel.trim(),
        slug,
        segment_asset_id: seg,
        jingle_asset_id: jin,
      };
      const id = savedId ? (await studioApi.saveBook(savedId, data)).id : (await studioApi.createBook(data)).id;
      setSavedId(id);
      if (!withAirings) {
        setDone({ airings: false, blocks: 0, channels: [], warnings: [] });
        return;
      }
      const r = await studioApi.saveBookAirings(id, { channels: picked, date_from: from, date_to: to, rows });
      setDone({ airings: true, blocks: r.blocks, channels: r.channels, warnings: r.warnings });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save. Nothing is lost: try again.");
    } finally {
      setBusy(false);
    }
  };

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const channelNames = channels.filter((c) => picked.includes(c.id)).map((c) => c.name);

  if (!loaded) return <p>Loading...</p>;

  if (done) {
    return (
      <div className="pw">
        <h1 tabIndex={-1} ref={heading}>
          {done.airings ? "Draft airings created" : "The book is saved"}
        </h1>
        <div className="pw-card">
          {done.airings ? (
            <>
              <p>
                <strong>{title}</strong> has {done.blocks} draft block{done.blocks === 1 ? "" : "s"} in the Scheduler on {done.channels.join(", ")}.{" "}
                <strong>Nothing is on air yet.</strong>
              </p>
              <p>Open the Timeline, check the gold “Book of the Month” blocks, then publish each channel as usual. They air from then on.</p>
              {done.warnings.length > 0 && (
                <ul className="pw-warnings">
                  {done.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p>
              <strong>{title}</strong> is saved, with no airings yet. Open it again from the Book of the Month tab to create them.
            </p>
          )}
          <p>
            Its short link is <strong>weareradio.app/go/{slug}</strong>. The landing page card appears once its airings are published.
          </p>
        </div>
        <div className="pw-actions">
          {done.airings && (
            <Link to="/studio/scheduler/timeline" className="btn primary">
              Open the Timeline
            </Link>
          )}
          <Link to="/studio/audio?tab=books" className="btn">
            Back to Book of the Month
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="pw">
      <div className="pw-top">
        <Link to="/studio/audio?tab=books" className="pw-exit">
          ← Back to Book of the Month (nothing is saved)
        </Link>
      </div>
      <ol className="pw-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "is-current" : i < step ? "is-done" : ""} aria-current={i === step ? "step" : undefined}>
            <button type="button" disabled={i > step && !(editId && !problem(0) && !problem(1) && !problem(2))} onClick={() => setStep(i)}>
              <span className="pw-num">{i < step ? "✓" : i + 1}</span>
              <span className="pw-step-name">{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="pw-eyebrow">
        Step {step + 1} of {STEPS.length}
      </div>
      <h1 tabIndex={-1} ref={heading}>
        {STEPS[step]}
      </h1>

      <div className="pw-card">
        {step === 0 && (
          <div className="pw-two">
            <div>
              <div className="form-row">
                <label htmlFor="bw-month">Month</label>
                <select id="bw-month" value={month} onChange={(e) => setMonth(e.target.value)}>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {monthLabel(m)}
                      {books.some((b) => b.month === m && b.id !== savedId) ? " (has a book)" : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <label htmlFor="bw-title">Title</label>
                <input id="bw-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="form-row">
                <label htmlFor="bw-author">Author</label>
                <input id="bw-author" value={author} maxLength={80} onChange={(e) => setAuthor(e.target.value)} />
              </div>
              <div className="form-row">
                <label htmlFor="bw-blurb">Blurb: one or two lines for the website</label>
                <textarea id="bw-blurb" value={blurb} maxLength={300} rows={3} onChange={(e) => setBlurb(e.target.value)} />
              </div>
              <div className="form-row">
                <label htmlFor="bw-cover">Cover picture</label>
                <input id="bw-cover" type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} />
              </div>
              <div className="form-row">
                <label htmlFor="bw-buy">Purchase link</label>
                <input
                  id="bw-buy"
                  value={buyUrl}
                  maxLength={500}
                  inputMode="url"
                  onChange={(e) => {
                    setBuyUrl(e.target.value);
                    setTested(false);
                  }}
                />
                <a
                  className="btn pw-small"
                  href={linkValid(buyUrl) ? buyUrl.trim() : undefined}
                  target="_blank"
                  rel="noopener"
                  aria-disabled={!linkValid(buyUrl)}
                  style={linkValid(buyUrl) ? undefined : { opacity: 0.5, pointerEvents: "none" }}
                  onClick={() => setTested(true)}
                >
                  Test link
                </a>
                <p className="pw-hint">{tested ? "✓ Opened. Check that it went to the right page." : "Worth a check: click Test link and make sure the book's page opens."}</p>
              </div>
              <div className="form-row">
                <label>Words on the button</label>
                <div className="pw-chips">
                  {LABELS.map((l) => (
                    <button key={l} type="button" className={`chip${buyLabel === l ? " selected" : ""}`} onClick={() => setBuyLabel(l)}>
                      {l}
                    </button>
                  ))}
                </div>
                <input aria-label="Or type your own button words" value={buyLabel} maxLength={30} onChange={(e) => setBuyLabel(e.target.value)} />
              </div>
              <div className="form-row">
                <label htmlFor="bw-slug">Short link</label>
                <div className="pw-slug">
                  <span>weareradio.app/go/</span>
                  <input
                    id="bw-slug"
                    value={slug}
                    maxLength={40}
                    onChange={(e) => {
                      setSlugTouched(true);
                      setSlug(slugify(e.target.value));
                    }}
                  />
                </div>
                <p className="pw-hint">Also its page: weareradio.app/books/{slug || "…"}</p>
              </div>
            </div>
            <div>
              <div className="pw-preview-label">How it looks on the website</div>
              <div className="pw-preview">
                {coverUrl ? <img src={coverUrl} alt="" className="pw-preview-cover" /> : <div className="pw-preview-cover pw-preview-blank" />}
                <div className="pw-preview-text">
                  <span className="promo-pill promo-pill-small is-book">Book of the Month</span>
                  <div className="pw-preview-title">{title || "The book's title"}</div>
                  <div className="pw-hint">by {author || "…"}</div>
                  <span className="promo-btn is-book pw-preview-btn">{buyLabel || "Get the book"} →</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <>
            <p className="pw-help">The segment is your recorded feature, about 5 minutes. It plays only in its Book of the Month airings.</p>
            <div className="pw-chips">
              <button type="button" className={`chip${segmentMode === "upload" ? " selected" : ""}`} onClick={() => setSegmentMode("upload")}>
                Upload the segment
              </button>
              <button type="button" className={`chip${segmentMode === "pick" ? " selected" : ""}`} onClick={() => setSegmentMode("pick")} disabled={features.length === 0}>
                Pick one already uploaded
              </button>
            </div>
            {segmentMode === "upload" ? (
              <div className="form-row">
                <label htmlFor="bw-seg">Audio file</label>
                <input id="bw-seg" type="file" accept="audio/*" onChange={(e) => readFile(e.target.files?.[0] ?? null, setSegmentFile, setSegmentSeconds)} />
                {segmentFileUrl && <audio src={segmentFileUrl} controls className="pw-audio" />}
                {uploaded.segment && !segmentFile && <p className="pw-hint">Already uploaded.</p>}
              </div>
            ) : (
              <div className="form-row">
                <label htmlFor="bw-seg-pick">Segment</label>
                <select id="bw-seg-pick" value={segmentId} onChange={(e) => setSegmentId(e.target.value)}>
                  <option value="">Choose...</option>
                  {features.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.title} ({f.duration_seconds ? clock(f.duration_seconds) : "?"}){f.status !== "published" ? " - switched off" : ""}
                    </option>
                  ))}
                </select>
                {segFeature && <audio src={mediaUrl(segFeature.audio_url)} controls className="pw-audio" />}
              </div>
            )}
            {segLength ? <p className="pw-hint">It's {clock(segLength)} long.</p> : null}

            <div className="form-row" style={{ marginTop: 20 }}>
              <label>The jingle that opens it</label>
              <div className="pw-chips">
                <button type="button" className={`chip${jingleMode === "pick" ? " selected" : ""}`} onClick={() => setJingleMode("pick")} disabled={features.length === 0}>
                  Pick the jingle
                </button>
                <button type="button" className={`chip${jingleMode === "upload" ? " selected" : ""}`} onClick={() => setJingleMode("upload")}>
                  Upload the jingle
                </button>
                <button type="button" className={`chip${jingleMode === "none" ? " selected" : ""}`} onClick={() => setJingleMode("none")}>
                  No jingle
                </button>
              </div>
              {jingleMode === "pick" && (
                <>
                  <select aria-label="Jingle" value={jingleId} onChange={(e) => setJingleId(e.target.value)}>
                    <option value="">Choose...</option>
                    {features.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.title} ({f.duration_seconds ? clock(f.duration_seconds) : "?"})
                      </option>
                    ))}
                  </select>
                  {jinFeature && <audio src={mediaUrl(jinFeature.audio_url)} controls className="pw-audio" />}
                </>
              )}
              {jingleMode === "upload" && (
                <input type="file" accept="audio/*" aria-label="Jingle audio file" onChange={(e) => readFile(e.target.files?.[0] ?? null, setJingleFile, setJingleSeconds)} />
              )}
              <p className="pw-hint">
                The jingle is kept as a feature, not a station jingle, so it only plays before a Book of the Month and never in the jingle rotation. The one
                you choose is remembered for next time.
              </p>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="pw-help">
              These become draft blocks in the Scheduler. Each airing takes {lengthMin || "…"} minutes: the jingle, the segment, then music for any minutes
              left. It starts on time or a few seconds after: the song before it is never cut short (if it's the song on air when you publish, the airing waits for it to end).
            </p>
            <div className="form-row">
              <label>Channels</label>
              <div className="pw-checks">
                {channels.map((c) => (
                  <label key={c.id}>
                    <input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))} />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
            <div className="form-row">
              <label>Dates</label>
              <div className="pw-dates">
                <label>
                  From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </label>
                <label>
                  Until <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </label>
              </div>
            </div>
            <div className="form-row">
              <label>Airings (times are Paris time, like the rest of the Scheduler)</label>
              {rows.map((r, i) => (
                <div key={i} className="bw-row">
                  <div className="pw-chips" role="group" aria-label={`Days for airing ${i + 1}`}>
                    {DAY_LABELS.map((d, k) => (
                      <button
                        key={d}
                        type="button"
                        className={`chip${r.days_mask & (1 << k) ? " selected" : ""}`}
                        aria-pressed={!!(r.days_mask & (1 << k))}
                        onClick={() => setRow(i, { days_mask: r.days_mask ^ (1 << k) })}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                  <input
                    type="time"
                    step={300}
                    aria-label={`Time for airing ${i + 1}`}
                    value={hhmm(r.start_min)}
                    onChange={(e) => {
                      const [h, m] = e.target.value.split(":").map(Number);
                      if (Number.isFinite(h) && Number.isFinite(m)) setRow(i, { start_min: h * 60 + Math.round(m / 5) * 5 });
                    }}
                  />
                  <button type="button" className="btn pw-small" onClick={() => setRows((rs) => rs.filter((_, k) => k !== i))}>
                    Remove
                  </button>
                </div>
              ))}
              {rows.length < 6 && (
                <button type="button" className="btn pw-small" onClick={() => setRows((rs) => [...rs, { days_mask: 31, start_min: 12 * 60 + 5 }])}>
                  + Add an airing
                </button>
              )}
            </div>
            {warnings.length > 0 && (
              <ul className="pw-warnings" role="status">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <p className="pw-help">Here's everything. Nothing goes on air until you publish it on the Timeline.</p>
            <dl className="pw-summary">
              <dt>The book</dt>
              <dd>
                {title} by {author}, Book of the Month for {monthLabel(month)}. “{buyLabel} →” goes to weareradio.app/go/{slug}
                <button className="btn pw-small" onClick={() => setStep(0)}>
                  Change
                </button>
              </dd>
              <dt>What airs</dt>
              <dd>
                {jingleMode === "none" ? "" : "The jingle, then "}the segment ({segLength ? clock(segLength) : "?"}), in a {lengthMin}-minute slot; music fills the rest
                <button className="btn pw-small" onClick={() => setStep(1)}>
                  Change
                </button>
              </dd>
              <dt>When</dt>
              <dd>
                {rows.map((r) => `${describeDays(r.days_mask)} at ${hhmm(r.start_min)}`).join("; ")}, from {from} to {to}
                <button className="btn pw-small" onClick={() => setStep(2)}>
                  Change
                </button>
              </dd>
              <dt>Where</dt>
              <dd>
                {channelNames.join(", ")}: {rows.length * picked.length} draft block{rows.length * picked.length === 1 ? "" : "s"}
              </dd>
            </dl>
            {warnings.length > 0 && (
              <ul className="pw-warnings">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {editId && <p className="pw-hint">This replaces the book's earlier draft blocks. What's already published keeps airing until you publish again.</p>}
          </>
        )}
      </div>

      {error && (
        <p className="pw-error" role="alert">
          {error}
        </p>
      )}

      <div className="pw-actions">
        {step > 0 && (
          <button className="btn" onClick={() => setStep(step - 1)} disabled={busy}>
            ← Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <>
            <button className="btn primary" onClick={() => setStep(step + 1)} disabled={!!blocker}>
              Next →
            </button>
            {blocker && <span className="pw-blocker">{blocker}</span>}
          </>
        ) : (
          <>
            <button className="btn primary" onClick={() => finish(true)} disabled={busy}>
              {busy ? "Saving..." : "Create draft airings"}
            </button>
            <button className="btn" onClick={() => finish(false)} disabled={busy}>
              Save the book only
            </button>
          </>
        )}
      </div>
    </div>
  );
}
