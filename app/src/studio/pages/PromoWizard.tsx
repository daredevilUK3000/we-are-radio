import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { mediaUrl, studioApi, uploadFileToR2 } from "../../api/client";
import { PromoPill, PROMO_PILL_TEXT } from "../../listener/components/promo/PromoOnAir";
import { readAudioDuration } from "./UploadAudioAsset";
import "./promoWizard.css";

/**
 * New promo, step by step (handoff_house_promos.md §3.2): the recording,
 * what listeners see, the link, the short link, when and where, then a check
 * and the switch. Everything is saved at the end, in one go. With ?id= it
 * sets up a promo that's already uploaded (from the Promos tab's "Set up").
 */

const LABELS = ["Get the book", "Try it free", "Find out more", "Listen now", "Order now"];
const STEPS = ["The recording", "What listeners see", "Where the button goes", "The short link", "When and where", "Check and switch on"];

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const linkValid = (u: string) => {
  try {
    return /^https:\/\//i.test(u.trim()) && new URL(u.trim()).hostname.includes(".");
  } catch {
    return false;
  }
};
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

type Channel = { id: string; name: string };

export function PromoWizard() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const existingId = params.get("id");

  const [step, setStep] = useState(existingId ? 1 : 0);
  const [promos, setPromos] = useState<any[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [existing, setExisting] = useState<any | null>(null);

  // Step 1: the recording
  const [file, setFile] = useState<File | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [name, setName] = useState("");
  // Step 2: what listeners see
  const [title, setTitle] = useState("");
  const [label, setLabel] = useState("Get the book");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  // Step 3: the link
  const [link, setLink] = useState("https://");
  const [tested, setTested] = useState(false);
  // Step 4: the short link
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  // Step 5: when and where
  const [allChannels, setAllChannels] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const [useDates, setUseDates] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [perDay, setPerDay] = useState(4);
  // The label (migrations/0027): a recommendation, or an ad for one of Kizzi's own businesses.
  const [pill, setPill] = useState<"recommends" | "advert">("recommends");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(existingId);
  const [done, setDone] = useState<null | { on: boolean }>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    studioApi.promos().then((r) => {
      setPromos(r.promos);
      setChannels(r.channels);
      if (existingId) {
        const p = r.promos.find((x: any) => x.id === existingId);
        if (p) {
          setExisting(p);
          setName(p.title);
          setTitle(p.on_air_title ?? p.title);
          setLabel(p.link_label ?? "Find out more");
          setCoverKey(p.cover_url ?? null);
          if (p.link_url) setLink(p.link_url);
          if (p.slug) {
            setSlug(p.slug);
            setSlugTouched(true);
          }
          if (p.channel_ids) {
            setAllChannels(false);
            setPicked(p.channel_ids);
          }
          if (p.runs_from || p.runs_to) {
            setUseDates(true);
            setFrom(p.runs_from ?? "");
            setTo(p.runs_to ?? "");
          }
          setPerDay(p.max_per_day ?? 4);
          setPill(p.pill === "advert" ? "advert" : "recommends");
        }
      }
    });
  }, [existingId]);

  // The short link follows the title until one is typed.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(title));
  }, [title, slugTouched]);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const fileUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  const coverUrl = useMemo(() => (coverFile ? URL.createObjectURL(coverFile) : coverKey ? mediaUrl(coverKey) : null), [coverFile, coverKey]);

  const slugTaken = !!slug && promos.some((p) => p.slug === slug && p.id !== createdId);
  const linkOk = linkValid(link);
  const datesOk = !useDates || ((!from || !to || from <= to) && (!!from || !!to));

  // What stops each step, in plain words (null = ready to go on).
  const problem = (s: number): string | null => {
    if (s === 0) return existing || file ? (existing || duration ? null : "Reading the recording...") : "Choose the recording to upload.";
    if (s === 1) return !title.trim() ? "Give it a title for the screen." : !label.trim() ? "Choose the words on the button." : null;
    if (s === 2) return linkOk ? null : "Paste the full web address, starting with https://";
    if (s === 3) return !SLUG.test(slug) ? "Use lower-case letters, numbers and hyphens, e.g. wedding." : slugTaken ? "Another promo already uses this one: try another." : null;
    if (s === 4)
      return !allChannels && picked.length === 0
        ? "Choose at least one channel."
        : useDates && !from && !to
          ? "Pick a start date, an end date or both (or choose \"From today\")."
          : !datesOk
            ? "The end date comes before the start date."
            : perDay < 1 || perDay > 48 ? "Plays a day must be 1 to 48." : null;
    return null;
  };
  const blocker = problem(step);

  const chooseFile = async (f: File | null) => {
    setFile(f);
    setDuration(null);
    if (!f) return;
    if (!name) setName(f.name.replace(/\.[^.]+$/, ""));
    try {
      setDuration(await readAudioDuration(f));
    } catch {
      setError("That file couldn't be read as audio. Try an MP3 or M4A.");
      setFile(null);
    }
  };

  const finish = async (switchOn: boolean) => {
    setBusy(true);
    setError(null);
    try {
      let id = createdId;
      if (!id) {
        if (!file || !duration) throw new Error("The recording is missing.");
        const up = await studioApi.presignUpload(file.name, file.type, "audio");
        await uploadFileToR2(up.upload_url, file);
        const created = await studioApi.createAudioAsset({
          type: "promo",
          title: name.trim() || title.trim(),
          description: null,
          duration_seconds: duration,
          audio_url: up.key,
          status: "published",
        });
        id = created.id;
        // Kept, so trying again after a problem doesn't upload it twice.
        setCreatedId(id);
      }
      let cover = coverKey;
      if (coverFile) {
        const up = await studioApi.presignUpload(coverFile.name, coverFile.type, "artwork");
        await uploadFileToR2(up.upload_url, coverFile);
        cover = up.key;
        setCoverKey(cover);
        setCoverFile(null);
      }
      await studioApi.savePromo(id, {
        on_air_title: title.trim(),
        link_url: link.trim(),
        link_label: label.trim(),
        slug,
        cover_url: cover,
        active: switchOn,
        runs_from: useDates && from ? from : null,
        runs_to: useDates && to ? to : null,
        max_per_day: perDay,
        channel_ids: allChannels ? null : picked,
        pill,
      });
      setDone({ on: switchOn });
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't save. Nothing is lost: try again.");
    } finally {
      setBusy(false);
    }
  };

  const channelText = allChannels ? "All live channels" : channels.filter((c) => picked.includes(c.id)).map((c) => c.name).join(", ");
  const datesText = !useDates ? "From today, with no end date" : `${from ? `From ${from}` : "From today"}${to ? ` until ${to}` : ", with no end date"}`;

  if (done) {
    return (
      <div className="pw">
        <h1 tabIndex={-1} ref={heading}>
          {done.on ? "Your promo is switched on" : "Your promo is saved"}
        </h1>
        <div className="pw-card">
          <p>
            <strong>{title}</strong>{" "}
            {done.on
              ? "will start airing between songs within the next hour or so, as gaps between songs come up."
              : "is saved but switched off. Switch it on from the Promos tab when you're ready."}
          </p>
          <p>
            Its short link is <strong>weareradio.app/go/{slug}</strong>. You can say it on air, and every tap, scan and visit is counted in the Promos
            tab.
          </p>
        </div>
        <div className="pw-actions">
          <Link to="/studio/audio?tab=promos" className="btn primary">
            Go to the Promos tab
          </Link>
          <button className="btn" onClick={() => window.location.assign("/studio/promos/new")}>
            Make another promo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pw">
      <div className="pw-top">
        <Link to="/studio/audio?tab=promos" className="pw-exit">
          ← Back to Promos (nothing is saved)
        </Link>
      </div>
      <ol className="pw-steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} className={i === step ? "is-current" : i < step ? "is-done" : ""} aria-current={i === step ? "step" : undefined}>
            <button type="button" disabled={i > step || (i === 0 && !!existing)} onClick={() => setStep(i)}>
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
          <>
            <p className="pw-help">Choose your recorded promo (an MP3 or M4A file). It plays between two songs.</p>
            {existing ? (
              <p>
                Using <strong>{existing.title}</strong> ({clock(existing.duration_seconds)}), already uploaded.
              </p>
            ) : (
              <>
                <div className="form-row">
                  <label htmlFor="pw-file">Audio file</label>
                  <input id="pw-file" type="file" accept="audio/*" onChange={(e) => chooseFile(e.target.files?.[0] ?? null)} />
                </div>
                {fileUrl && (
                  <>
                    <audio src={fileUrl} controls className="pw-audio" />
                    <p className="pw-hint">{duration ? `It's ${clock(duration)} long. Have a listen to check it's the right one.` : "Reading the file..."}</p>
                    <div className="form-row">
                      <label htmlFor="pw-name">A name for it in Studio (listeners don't see this)</label>
                      <input id="pw-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {step === 1 && (
          <div className="pw-two">
            <div>
              <p className="pw-help">While the promo plays, the players show a title and a button. Keep the title short, like the book's name.</p>
              <div className="form-row">
                <label htmlFor="pw-title">Title on screen</label>
                <input id="pw-title" value={title} maxLength={80} placeholder="Your Wedding Sorted!" onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="form-row">
                <label>Words on the button</label>
                <div className="pw-chips">
                  {LABELS.map((l) => (
                    <button key={l} type="button" className={`chip${label === l ? " selected" : ""}`} onClick={() => setLabel(l)}>
                      {l}
                    </button>
                  ))}
                </div>
                <input aria-label="Or type your own button words" value={label} maxLength={30} onChange={(e) => setLabel(e.target.value)} placeholder="Or type your own" />
              </div>
              <div className="form-row">
                <label>Label</label>
                <div className="pw-chips">
                  <button type="button" className={`chip${pill === "recommends" ? " selected" : ""}`} onClick={() => setPill("recommends")}>
                    {PROMO_PILL_TEXT}
                  </button>
                  <button type="button" className={`chip${pill === "advert" ? " selected" : ""}`} onClick={() => setPill("advert")}>
                    Advertisement
                  </button>
                </div>
                <p className="pw-hint">Choose Advertisement for an ad for a business, including your own. A book you publish is a recommendation.</p>
              </div>
              <div className="form-row">
                <label htmlFor="pw-cover">Cover picture (optional): the book cover or the platform's logo</label>
                <input id="pw-cover" type="file" accept="image/*" onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)} />
                {(coverFile || coverKey) && (
                  <button
                    type="button"
                    className="btn pw-small"
                    onClick={() => {
                      setCoverFile(null);
                      setCoverKey(null);
                    }}
                  >
                    Remove the cover
                  </button>
                )}
              </div>
            </div>
            <div>
              <div className="pw-preview-label">How listeners will see it</div>
              <div className="pw-preview">
                {coverUrl ? <img src={coverUrl} alt="" className="pw-preview-cover" /> : <div className="pw-preview-cover pw-preview-blank" />}
                <div className="pw-preview-text">
                  <PromoPill promo={{ pill: pill === "advert" ? "Advertisement" : PROMO_PILL_TEXT }} small />
                  <div className="pw-preview-title">{title || "Your title here"}</div>
                  <span className="promo-btn pw-preview-btn">{label || "Find out more"} →</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <>
            <p className="pw-help">Where should the button take people? Paste the full web address of the book's page or the platform.</p>
            <div className="form-row">
              <label htmlFor="pw-link">Web address</label>
              <input
                id="pw-link"
                value={link}
                maxLength={500}
                inputMode="url"
                onChange={(e) => {
                  setLink(e.target.value);
                  setTested(false);
                }}
              />
            </div>
            <a
              className="btn"
              href={linkOk ? link.trim() : undefined}
              target="_blank"
              rel="noopener"
              aria-disabled={!linkOk}
              style={linkOk ? undefined : { opacity: 0.5, pointerEvents: "none" }}
              onClick={() => setTested(true)}
            >
              Test the link (opens a new tab)
            </a>
            <p className="pw-hint">
              {tested ? "✓ Opened. Check that it went to the right page." : "Worth a check: click Test the link and make sure the right page opens."}
            </p>
          </>
        )}

        {step === 3 && (
          <>
            <p className="pw-help">
              Every promo gets its own short web address. The button and the TV's QR code use it, so each tap and scan is counted. It's also short
              enough to say on air.
            </p>
            <div className="form-row">
              <label htmlFor="pw-slug">Short link</label>
              <div className="pw-slug">
                <span>weareradio.app/go/</span>
                <input
                  id="pw-slug"
                  value={slug}
                  maxLength={40}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(slugify(e.target.value));
                  }}
                />
              </div>
            </div>
            <p className="pw-hint">
              On air you could say: <em>“find it at weareradio.app slash go slash {slug || "…"}”</em>.
            </p>
          </>
        )}

        {step === 4 && (
          <>
            <div className="form-row">
              <label>Which channels?</label>
              <div className="pw-chips">
                <button type="button" className={`chip${allChannels ? " selected" : ""}`} onClick={() => setAllChannels(true)}>
                  All live channels
                </button>
                <button type="button" className={`chip${!allChannels ? " selected" : ""}`} onClick={() => setAllChannels(false)}>
                  Only some
                </button>
              </div>
              {!allChannels && (
                <div className="pw-checks">
                  {channels.map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={picked.includes(c.id)}
                        onChange={(e) => setPicked((p) => (e.target.checked ? [...p, c.id] : p.filter((x) => x !== c.id)))}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="form-row">
              <label>When?</label>
              <div className="pw-chips">
                <button type="button" className={`chip${!useDates ? " selected" : ""}`} onClick={() => setUseDates(false)}>
                  From today, no end date
                </button>
                <button type="button" className={`chip${useDates ? " selected" : ""}`} onClick={() => setUseDates(true)}>
                  Pick dates
                </button>
              </div>
              {useDates && (
                <div className="pw-dates">
                  <label>
                    From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                  </label>
                  <label>
                    Until <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                  </label>
                </div>
              )}
            </div>
            <div className="form-row">
              <label htmlFor="pw-perday">Most plays a day, across all channels</label>
              <input id="pw-perday" type="number" min={1} max={48} value={perDay} onChange={(e) => setPerDay(Number(e.target.value))} className="pw-num-input" />
              <p className="pw-hint">4 is a good start: enough to be heard, not so often that listeners tire of it.</p>
            </div>
          </>
        )}

        {step === 5 && (
          <>
            <p className="pw-help">Here's everything. Click Change next to anything to fix it.</p>
            <dl className="pw-summary">
              <dt>Recording</dt>
              <dd>
                {existing ? existing.title : name} {duration || existing ? `(${clock(duration ?? existing.duration_seconds)})` : ""}
                {!existing && <button className="btn pw-small" onClick={() => setStep(0)}>Change</button>}
              </dd>
              <dt>On screen</dt>
              <dd>
                {title}, with a “{label} →” button{coverUrl ? " and a cover" : ", no cover"}
                <button className="btn pw-small" onClick={() => setStep(1)}>Change</button>
              </dd>
              <dt>Link</dt>
              <dd>
                {link}
                <button className="btn pw-small" onClick={() => setStep(2)}>Change</button>
              </dd>
              <dt>Short link</dt>
              <dd>
                weareradio.app/go/{slug}
                <button className="btn pw-small" onClick={() => setStep(3)}>Change</button>
              </dd>
              <dt>Where and when</dt>
              <dd>
                {channelText}. {datesText}. At most {perDay} plays a day.
                <button className="btn pw-small" onClick={() => setStep(4)}>Change</button>
              </dd>
            </dl>
            <p className="pw-hint">
              Promos air between two songs, never next to a jingle, an Advertising For Good ad or a voice note, and at least 20 minutes apart.
            </p>
          </>
        )}
      </div>

      {error && (
        <p className="pw-error" role="alert">
          {error}
        </p>
      )}

      <div className="pw-actions">
        {step > (existing ? 1 : 0) && (
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
              {busy ? "Saving..." : "Save and switch on"}
            </button>
            <button className="btn" onClick={() => finish(false)} disabled={busy}>
              Save, keep it switched off
            </button>
          </>
        )}
      </div>
    </div>
  );
}
