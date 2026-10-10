import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { SchedulerNav } from "./common";
import "./scheduler.css";
import "./timeline.css";
import "./content.css";
import "./whatsnew.css";

/**
 * Studio -> Scheduler -> What's new (/studio/scheduler/whats-new): a
 * step-by-step guide to the Scheduler's Release 2 (the plan, the Timeline,
 * playlists and templates, episodes, manual hours, Hold, the report, the
 * public schedule). Progress is remembered per browser so it can be resumed.
 */

const KEY = "sch-whatsnew";
export const WHATS_NEW_VERSION = "r2-2026-10";

export function useWhatsNewSeen(): [boolean, () => void] {
  const [seen, setSeen] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "{}").done === WHATS_NEW_VERSION;
    } catch {
      return true;
    }
  });
  const markSeen = () => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      localStorage.setItem(KEY, JSON.stringify({ ...v, done: WHATS_NEW_VERSION }));
    } catch {
      /* fine */
    }
    setSeen(true);
  };
  return [seen, markSeen];
}

/** "New in the Scheduler: take the tour" - shown on Master Control until the guide has been finished or dismissed. */
export function WhatsNewBanner() {
  const [seen, markSeen] = useWhatsNewSeen();
  if (seen) return null;
  return (
    <div className="wn-banner" role="status">
      <span className="wn-banner-spark" aria-hidden="true">
        ✦
      </span>
      <span>
        <strong>New in the Scheduler:</strong> plan a week and publish it, playlists and templates, show episodes, hand-built hours, Hold and the report.
      </span>
      <span className="sch-spacer" />
      <Link className="sch-btn sch-btn-red sch-btn-sm" to="/studio/scheduler/whats-new">
        Take the tour
      </Link>
      <button type="button" className="sch-icon-btn" aria-label="Dismiss" onClick={markSeen}>
        ×
      </button>
    </div>
  );
}

interface Step {
  id: string;
  kicker: string;
  title: string;
  intro: React.ReactNode;
  picture?: React.ReactNode;
  how?: { title: string; steps: React.ReactNode[] };
  tips?: React.ReactNode[];
  go?: { to: string; label: string };
}

const STEPS: Step[] = [
  {
    id: "welcome",
    kicker: "Welcome",
    title: "What's new in the Scheduler",
    intro: (
      <>
        <p>The Scheduler can now do a lot more. This short guide walks you through it one thing at a time: what it is, why it's useful, and exactly where to click.</p>
        <p>Take your time. You can leave at any point and pick up where you left off: the guide remembers your place. Nothing here changes what's on air.</p>
      </>
    ),
    picture: (
      <ul className="wn-checklist">
        <li>Plan in a draft, then publish when you're ready</li>
        <li>The Timeline: every channel's day, or one channel's week</li>
        <li>One-off specials, seasons and skipped dates</li>
        <li>Playlists and templates (a show with a set shape)</li>
        <li>Episodes: fill this week's interview into the show</li>
        <li>Hours you build by hand, item by item</li>
        <li>Hold: run a few minutes late, on purpose</li>
        <li>The report: what was planned versus what aired</li>
        <li>The public schedule page for listeners</li>
      </ul>
    ),
  },
  {
    id: "draft",
    kicker: "The big idea",
    title: "Draft first, publish when ready",
    intro: (
      <>
        <p>
          Everything you change in the schedule goes into a <strong>draft</strong>. Listeners hear nothing different until you press <strong>Publish</strong>. So you can try things, move shows around and
          change your mind safely.
        </p>
        <p>Before it publishes, the Scheduler checks your plan. Anything that would stop it working (two shows at the same time, a show with no audio) must be fixed first. Smaller things are shown as warnings.</p>
      </>
    ),
    picture: (
      <div className="wn-mock wn-mock-banner">
        <span>
          <strong>Draft:</strong> 2 changes on Kizzi Radio, not yet live.
        </span>
        <span className="sch-spacer" />
        <span className="wn-fake-btn">Preview</span>
        <span className="wn-fake-btn">Discard</span>
        <span className="wn-fake-btn is-red">Publish</span>
      </div>
    ),
    how: {
      title: "How to publish",
      steps: [
        <>Open the <strong>Timeline</strong> and make sure the switch at the top says <strong>Draft</strong>.</>,
        <>Make your changes. The red banner counts them.</>,
        <>Press <strong>Preview</strong> to see the day as it will play, next to what's planned now.</>,
        <>Press <strong>Publish</strong>, tick the channels, and confirm. It tells you when it goes live ("Goes live today 18:00").</>,
      ],
    },
    tips: [
      <>Changed your mind? <strong>Discard</strong> puts the draft back to what's live.</>,
      <>Every publish is kept. <strong>LIVE · History</strong> (top right of the Timeline) lists them, and <strong>Roll back to this plan</strong> undoes a publish.</>,
      <>Switch to <strong>Live</strong> at the top to look at what's actually published.</>,
    ],
    go: { to: "/studio/scheduler/timeline", label: "Open the Timeline" },
  },
  {
    id: "timeline",
    kicker: "Where you plan",
    title: "The Timeline",
    intro: (
      <>
        <p>
          The Timeline shows your <strong>blocks</strong>: named stretches of time like "Friday Game Changers, 18:00–19:00". <strong>Day</strong> shows every channel side by side; <strong>Week</strong> shows one
          channel across seven days.
        </p>
        <p>Grey stretches are the channel's own music (its default). The red line is now.</p>
      </>
    ),
    picture: (
      <div className="wn-mock wn-mock-lane">
        <span className="wn-lane-name">Kizzi Radio</span>
        <span className="wn-bar is-grey" style={{ width: "30%" }}>
          Kizzi Radio
        </span>
        <span className="wn-bar is-purple" style={{ width: "18%" }}>
          📌 Game Changers
        </span>
        <span className="wn-bar is-blue" style={{ width: "22%" }}>
          Evening Mix ↻
        </span>
        <span className="wn-bar is-grey" style={{ width: "20%" }} />
      </div>
    ),
    how: {
      title: "Add and change a block",
      steps: [
        <>Press <strong>+ Add block</strong>, or drag across empty time in a channel's row.</>,
        <>Give it a name and a one-line description (listeners see it on the schedule), the days it repeats, and the times.</>,
        <>Choose what fills it (more on that in the next steps) and press <strong>Save to draft</strong>.</>,
        <>To move a block, drag it. Drag its left or right edge to change its start or end. Everything snaps to 5 minutes.</>,
        <>For a block that repeats, it asks: <strong>just this Friday</strong>, or <strong>every Friday</strong>?</>,
      ],
    },
    tips: [
      <>Click a block to open its panel on the right: times, how it's filled, warnings, and buttons to edit, duplicate or delete.</>,
      <>No mouse? Click a block, then use the arrow keys to move it by 5 minutes, Shift + arrows to change its end, and Enter to save.</>,
    ],
    go: { to: "/studio/scheduler/timeline", label: "Open the Timeline" },
  },
  {
    id: "repeats",
    kicker: "When it airs",
    title: "One-offs, seasons and skipped dates",
    intro: (
      <>
        <p>
          A block can air <strong>once</strong> (a special), <strong>weekly</strong> or <strong>monthly</strong> (the 15th, or the first Saturday, or the last Friday). Repeating blocks can also run only in a
          <strong> season</strong> (say 1–24 December) and <strong>skip dates</strong> (every Friday except 25 December).
        </p>
        <p>
          A one-off <strong>sits on top</strong> of the regular week without deleting it. If your Friday show runs 18:00–22:00 and you add a special 20:00–21:00, the Friday show plays until 20:00, the special
          plays, and the Friday show carries on at 21:00.
        </p>
      </>
    ),
    picture: (
      <div className="wn-mock wn-mock-lane">
        <span className="wn-lane-name">Friday</span>
        <span className="wn-bar is-blue" style={{ width: "28%" }}>
          Friday show
        </span>
        <span className="wn-bar is-gold" style={{ width: "20%" }}>
          ONE-OFF special
        </span>
        <span className="wn-bar is-blue" style={{ width: "28%" }}>
          ↳ Friday show
        </span>
      </div>
    ),
    how: {
      title: "Starts, ends and priority",
      steps: [
        <><strong>📌 Hard start</strong> (the default): the block starts exactly on time. The music before it is trimmed to fit.</>,
        <><strong>Flexible end into a flexible start</strong>: the last song finishes naturally and the next block starts a little later.</>,
        <><strong>High priority</strong>: a Hold can never move this start (see Hold later in this guide).</>,
      ],
    },
    tips: [<>If two blocks overlap, the Timeline marks it with a red <strong>⚠ Conflict</strong>. Click it and choose a fix: move one, shorten one, replace one, or skip one that day.</>],
  },
  {
    id: "fills",
    kicker: "What plays",
    title: "Five ways to fill a block",
    intro: <p>In a block's editor, <strong>Fill with</strong> decides what plays in it:</p>,
    picture: (
      <dl className="wn-fills">
        <dt>Songs by tag</dt>
        <dd>The Scheduler picks songs with the tags you choose (or the channel's own songs). Hands-off.</dd>
        <dt>A programme</dt>
        <dd>One of your programmes, from item 1.</dd>
        <dt>A playlist</dt>
        <dd>Your list of songs and audio, in order. If it's shorter than the block, songs fill the rest (or it loops).</dd>
        <dt>A template</dt>
        <dd>A show with a set shape: an opening jingle, an interview at 5 minutes in, songs, an outro. Each week you fill in the episode.</dd>
        <dt>Built by hand</dt>
        <dd>A manual hour: you choose every item for that date. Anything you leave empty is filled with the channel's music, never silence.</dd>
      </dl>
    ),
    go: { to: "/studio/scheduler/timeline", label: "Try it on a block" },
  },
  {
    id: "templates",
    kicker: "New page",
    title: "Playlists & templates",
    intro: (
      <>
        <p>
          The new <strong>Playlists &amp; templates</strong> tab is where you make them. A <strong>template</strong> is the shape of a regular show, for example Friday Game Changers:
        </p>
      </>
    ),
    picture: (
      <ol className="wn-mock wn-slots">
        <li>
          <span>00:00</span> 📌 Opening jingle <em>fixed</em>
        </li>
        <li>
          <span>00:08</span> Intro link <em>rule: picked for you</em>
        </li>
        <li className="is-episode">
          <span>05:00</span> 📌 Interview <em>episode slot: filled each week</em>
        </li>
        <li>
          <span>…</span> Two songs <em>rule: a song from the pool</em>
        </li>
        <li>
          <span>…</span> Outro <em>rule</em>
        </li>
      </ol>
    ),
    how: {
      title: "Make a template",
      steps: [
        <>Open <strong>Playlists &amp; templates</strong>, choose the <strong>Templates</strong> tab, and press <strong>+ New template</strong>. Give it a name.</>,
        <>Set <strong>the show's length</strong> (for example 60 minutes).</>,
        <><strong>+ Add item</strong> adds a particular song, jingle or recording (a <em>fixed</em> item).</>,
        <><strong>+ Add rule slot</strong> lets the Scheduler pick one, for example "a song tagged soul" or "an intro link".</>,
        <><strong>+ Add episode slot</strong> leaves a labelled gap ("Interview") that you fill for each airing.</>,
        <>To make an item start at an exact moment, press its <strong>📌</strong> and type the time into the show (for example 5:00).</>,
        <>Press <strong>Save</strong>. Then, on the Timeline, set a block to <strong>Fill with: A template</strong> and choose it.</>,
      ],
    },
    tips: [
      <>The bar shows the template's length against the show's. Any time left over is filled with songs.</>,
      <>Editing a template is a draft change on every channel that uses it, and goes on air when you publish.</>,
      <><strong>Archive</strong> hides a list from new blocks; blocks already using it keep working.</>,
    ],
    go: { to: "/studio/scheduler/lists?tab=template", label: "Open Playlists & templates" },
  },
  {
    id: "episodes",
    kicker: "Each week",
    title: "Episodes: fill in this week's show",
    intro: <p>Once a block uses a template, each airing can have its own <strong>episode</strong>: a copy of the template with this week's content in it, such as this Friday's interview.</p>,
    how: {
      title: "Create and fill an episode",
      steps: [
        <>On the Timeline, click the show's block and press <strong>Create next episode</strong>. (It's also on the template's page.)</>,
        <>The episode opens. Empty slots are highlighted: press <strong>Fill: Interview</strong>, find the recording, and press <strong>Fill</strong>.</>,
        <>Press <strong>Save to draft</strong>, then <strong>Publish</strong> on the Timeline.</>,
        <>That's it: the interview starts at exactly the time you pinned (for example 18:05).</>,
      ],
    },
    tips: [
      <>Forgot to fill a slot? It's skipped and music fills the gap. The Timeline warns you beforehand.</>,
      <>To change a different week, use the arrows on the Timeline to go to that day, click the block and press <strong>Open running order</strong>.</>,
    ],
    go: { to: "/studio/scheduler/timeline", label: "Open the Timeline" },
  },
  {
    id: "running-order",
    kicker: "Item by item",
    title: "The running order and the hour view",
    intro: (
      <>
        <p>
          Click any template, playlist or manual block and press <strong>Open running order</strong>. At the top, the <strong>hour view</strong> shows every item as it will play: songs in blue, voice links green,
          features purple, jingles gold. Below it, the list shows each item's start time.
        </p>
      </>
    ),
    picture: (
      <div className="wn-mock wn-strip">
        <span className="is-jingle" style={{ width: "3%" }} />
        <span className="is-link" style={{ width: "4%" }} />
        <span className="is-song" style={{ width: "10%" }}>
          Song
        </span>
        <span className="is-feature" style={{ width: "48%" }}>
          Interview
        </span>
        <span className="is-song" style={{ width: "13%" }}>
          Song
        </span>
        <span className="is-filler" style={{ width: "22%" }}>
          7:23 unfilled
        </span>
      </div>
    ),
    how: {
      title: "Get the length just right",
      steps: [
        <>The bar under the hour view says how full it is: "52:37 of 1:00:00 · 7:23 unfilled".</>,
        <>Too short? Press <strong>Auto-fill</strong> and it adds songs that fit to within 20 seconds, without cutting any. Or leave it and music fills the gap.</>,
        <>Too long? <strong>Trim auto-filled songs</strong> takes the auto-picked ones out first. Otherwise the last item fades at the end so the next show starts on time.</>,
        <>If the next block starts flexibly, <strong>Let it run over</strong> lets this one finish naturally instead.</>,
        <>Reorder items by dragging them or with the ↑ ↓ buttons. <strong>Library</strong> opens a search: drag songs or recordings into the list.</>,
      ],
    },
    tips: [<>Items you put in by hand are never dropped to make things fit. Only songs the Scheduler picked are.</>],
  },
  {
    id: "manual",
    kicker: "Total control",
    title: "Hours you build by hand",
    intro: <p>For a one-off hour you want to plan exactly (a launch, a tribute, a special set), set a block to <strong>Fill with: Built by hand</strong>.</p>,
    how: {
      title: "Build an hour",
      steps: [
        <>Add a block and choose <strong>Built by hand (manual)</strong>. Save it.</>,
        <>Click it and press <strong>Open running order</strong>, then <strong>Start building it</strong> (or start from one of your templates).</>,
        <>Add items with <strong>+ Add item</strong> or drag them in from the <strong>Library</strong>.</>,
        <>Press <strong>Auto-fill</strong> to top it up, then <strong>Save to draft</strong> and publish.</>,
      ],
    },
    tips: [<>An hour with no running order isn't silent: the channel's own music plays, and the Timeline shows a reminder.</>],
  },
  {
    id: "library",
    kicker: "Shortcut",
    title: "Drag from the library",
    intro: (
      <p>
        On the Timeline's day view, press <strong>Library</strong> (top right). A search panel opens on the left with your playlists, templates, programmes, songs and audio.
      </p>
    ),
    how: {
      title: "What you can drag where",
      steps: [
        <>A <strong>playlist, template or programme</strong> onto a block: it asks, then fills the block with it.</>,
        <>A <strong>playlist, template or programme</strong> onto empty time: it creates a one-hour block there.</>,
        <>A <strong>song or recording</strong> onto a manual or template block: it opens that hour's running order so you can place it.</>,
      ],
    },
    go: { to: "/studio/scheduler/timeline", label: "Open the Timeline" },
  },
  {
    id: "hold",
    kicker: "Live",
    title: "Hold: run late on purpose",
    intro: (
      <>
        <p>
          Sometimes you want to keep going: a great interview, breaking news. <strong>Hold</strong> (in Master Control's live controls) plays a few more minutes of what's on and pushes the shows you choose later. Then the schedule
          catches up by itself.
        </p>
      </>
    ),
    picture: (
      <div className="wn-mock wn-hold">
        <p>
          <strong>Hold the schedule for</strong> 5 · <b>10</b> · 15 · 30 minutes
        </p>
        <p>☑ Friday Game Changers will start at <strong>18:10</strong> instead of 18:00. Move it?</p>
        <p className="wn-dim">☐ Evening Mix will start at 19:10 instead of 19:00. Move it?</p>
        <p>
          <strong>The schedule catches up by 19:00 (Evening Mix keeps its time).</strong>
        </p>
      </div>
    ),
    how: {
      title: "Hold the schedule",
      steps: [
        <>In <strong>Master Control</strong>, choose the channel and press <strong>Hold…</strong>.</>,
        <>Choose how long: 5, 10, 15 or 30 minutes.</>,
        <>Tick each show that should start later. Shows you don't tick keep their time, and the schedule catches up before them.</>,
        <>Press <strong>Hold</strong>. You can <strong>Undo</strong> for a minute afterwards, or press <strong>Back on schedule</strong> later.</>,
      ],
    },
    tips: [
      <>A <strong>High priority</strong> show can't be moved: it's shown locked.</>,
      <>The move is for today only. Next week the show is back at its usual time.</>,
      <>If there isn't room to catch up, Hold says so and changes nothing: pick a shorter hold, or tick the next show too.</>,
    ],
    go: { to: "/studio/scheduler", label: "Open Master Control" },
  },
  {
    id: "report",
    kicker: "Evidence",
    title: "The report: planned versus aired",
    intro: (
      <p>
        The new <strong>Report</strong> tab compares what your published plan said with what actually played, for one channel and one day (yesterday by default). Each item is marked: As planned, Moved (a Hold),
        Replaced, Skipped, Inserted, Dropped, Trimmed or Late, with who changed it and why.
      </p>
    ),
    how: {
      title: "Read and export it",
      steps: [
        <>Open <strong>Report</strong>, choose the channel and the day.</>,
        <>The boxes at the top give the totals: how much aired as planned, how many live changes, the biggest delay, time on the emergency playlist and how many songs aired.</>,
        <>Press <strong>Only differences</strong> to see just what changed, and <strong>History</strong> on a row for the full story of that item.</>,
        <>Press <strong>Export CSV</strong> for a spreadsheet: your airplay evidence (for the Top 3, for example).</>,
      ],
    },
    tips: [<>"Not recorded" means the station's own record of what aired had a gap at that time; those rows are left out of the totals.</>],
    go: { to: "/studio/scheduler/report", label: "Open the Report" },
  },
  {
    id: "listeners",
    kicker: "For listeners",
    title: "What listeners see",
    intro: (
      <>
        <p>
          Your named shows now appear on the public <strong>Schedule</strong> page (weareradio.app/schedule), in each listener's own time zone, with <strong>Add to calendar</strong> for Apple, Outlook and Google.
          The players also say <strong>"Coming up at 18:00: Friday Game Changers"</strong> in the hour before a show.
        </p>
        <p>Only published blocks show, and only ones with <strong>Show on the public schedule</strong> ticked in their editor. Everything else appears as the channel's name.</p>
        <p>
          Also new since early October: songs tagged with a time of day (morning, afternoon, evening, night) only play at that time, on every channel. Untagged songs play any time.
        </p>
      </>
    ),
    go: { to: "/schedule", label: "See the public schedule" },
  },
  {
    id: "health",
    kicker: "Peace of mind",
    title: "Health and warnings",
    intro: (
      <>
        <p>
          <strong>Schedule Health</strong> in Master Control now also checks your published plan for the next two days: missing audio, empty episode slots, hours with no running order, shows that run long. Red means fix it soon;
          amber means have a look.
        </p>
        <p>On the Timeline, a block's panel lists its warnings with a button to fix each one ("Open running order", "Edit block", "Resolve").</p>
      </>
    ),
  },
  {
    id: "done",
    kicker: "You're ready",
    title: "Try your first show in five steps",
    intro: <p>The best way to learn it is to try it. Nothing reaches the air until you publish, and anything you publish can be rolled back.</p>,
    how: {
      title: "Your first templated show",
      steps: [
        <>
          <Link to="/studio/scheduler/lists?tab=template">Playlists &amp; templates</Link>: make a template with an opening jingle at 00:00, an "Interview" episode slot pinned at 5:00, and two song rule slots.
        </>,
        <>
          <Link to="/studio/scheduler/timeline">Timeline</Link>: add a weekly block that fills with that template.
        </>,
        <>Click the block, press <strong>Create next episode</strong>, and <strong>Fill: Interview</strong>.</>,
        <>Press <strong>Preview</strong> to check the day, then <strong>Publish</strong>.</>,
        <>Watch it in Master Control when it airs, and see it in the Report the next day.</>,
      ],
    },
    tips: [<>You can come back to this guide any time: <strong>What's new</strong> is in the Scheduler's menu.</>],
  },
];

export function WhatsNew() {
  const [params, setParams] = useSearchParams();
  const [, markSeen] = useWhatsNewSeen();
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "{}").step as string | undefined;
    } catch {
      return undefined;
    }
  })();
  const fromUrl = params.get("step");
  const index = Math.max(0, STEPS.findIndex((s) => s.id === (fromUrl ?? saved ?? "welcome")));
  const step = STEPS[index];
  const head = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? "{}");
      localStorage.setItem(KEY, JSON.stringify({ ...v, step: step.id }));
    } catch {
      /* fine */
    }
    head.current?.focus();
    window.scrollTo({ top: 0 });
  }, [step.id]);

  const goTo = (i: number) => setParams({ step: STEPS[Math.max(0, Math.min(STEPS.length - 1, i))].id });
  const last = index === STEPS.length - 1;

  return (
    <div className="sch sch-wn">
      <SchedulerNav />
      <div className="wn-layout">
        <nav className="wn-steps" aria-label="Guide steps">
          <p className="sch-eyebrow">What's new · {STEPS.length} steps</p>
          <ol>
            {STEPS.map((s, i) => (
              <li key={s.id}>
                <button type="button" className={`${i === index ? "is-on" : ""}${i < index ? " is-done" : ""}`} aria-current={i === index ? "step" : undefined} onClick={() => goTo(i)}>
                  <span className="wn-num" aria-hidden="true">
                    {i < index ? "✓" : i + 1}
                  </span>
                  {s.title}
                </button>
              </li>
            ))}
          </ol>
        </nav>

        <article className="sch-card wn-card" aria-labelledby="wn-title">
          <div className="wn-progress" aria-hidden="true">
            <i style={{ width: `${((index + 1) / STEPS.length) * 100}%` }} />
          </div>
          <p className="sch-eyebrow">
            Step {index + 1} of {STEPS.length} · {step.kicker}
          </p>
          <h1 id="wn-title" className="wn-title" tabIndex={-1} ref={head}>
            {step.title}
          </h1>
          <div className="wn-intro">{step.intro}</div>
          {step.picture && <div className="wn-picture">{step.picture}</div>}
          {step.how && (
            <section className="wn-how">
              <h2 className="sch-h3">{step.how.title}</h2>
              <ol>
                {step.how.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </section>
          )}
          {step.tips && (
            <aside className="wn-tips">
              <p className="sch-eyebrow">Good to know</p>
              <ul>
                {step.tips.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </aside>
          )}
          <footer className="wn-foot">
            <button type="button" className="sch-btn" onClick={() => goTo(index - 1)} disabled={index === 0}>
              ← Back
            </button>
            {step.go && (
              <Link className="sch-btn" to={step.go.to} target={step.go.to === "/schedule" ? "_blank" : undefined}>
                {step.go.label} ↗
              </Link>
            )}
            <span className="sch-spacer" />
            {last ? (
              <Link className="sch-btn sch-btn-red" to="/studio/scheduler" onClick={markSeen}>
                Finish
              </Link>
            ) : (
              <button type="button" className="sch-btn sch-btn-red" onClick={() => goTo(index + 1)}>
                Next →
              </button>
            )}
          </footer>
          <p className="sch-dim wn-resume">The guide remembers where you were. Open it again from <strong>What's new</strong> in the Scheduler menu.</p>
        </article>
      </div>
    </div>
  );
}
