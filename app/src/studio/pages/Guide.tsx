function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div
          style={{
            flexShrink: 0,
            width: 28,
            height: 28,
            borderRadius: "50%",
            background: "var(--accent)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 700,
            fontSize: "0.9rem",
          }}
        >
          {n}
        </div>
        <div>
          <h3 style={{ margin: "2px 0 6px" }}>{title}</h3>
          <div style={{ color: "var(--text-dim)", fontSize: "0.9rem", lineHeight: 1.5 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Guide() {
  return (
    <div style={{ maxWidth: 720 }}>
      <h1>Getting started</h1>
      <p style={{ color: "var(--text-dim)" }}>
        The recommended order for putting together a real broadcast, start to finish.
        Nothing here happens automatically - every step below is something you do on
        purpose, and nothing reaches listeners until you explicitly publish it.
      </p>

      <div className="card" style={{ marginBottom: 20, borderColor: "var(--accent-dim)" }}>
        <strong>Shortcut:</strong> if all you want is to add a song and make it audible - upload,
        pick or create an album, publish - the{" "}
        <a href="/studio/publish" style={{ color: "var(--accent)" }}>
          Publish Music
        </a>{" "}
        wizard on the Dashboard walks through exactly that in one guided flow. Steps 1-2 below
        cover the same ground manually, plus spoken content, which the wizard doesn't handle yet.
      </div>

      <Step n={1} title="Upload some music">
        Go to <strong>Music</strong> and click <strong>Upload music</strong>. Fill in the
        title and click chips for genre, mood/vibe and BPM (or add your own if nothing fits)
        - moods become reusable tags other tracks can share. Pick an audio file; artwork is
        optional.
        <br />
        <br />
        A newly uploaded track starts as <span className="badge">ready</span>, not{" "}
        <span className="badge">published</span>. On the Music page, click{" "}
        <strong>Publish</strong> next to a track once it's ready to go - only{" "}
        <span className="badge">published</span> tracks are visible to listeners, and only
        published tracks show up for the AI producer or in the "add song" picker on a
        programme.
      </Step>

      <Step n={2} title="Upload spoken content (optional)">
        Go to <strong>Voice &amp; Station Audio</strong> to upload station IDs, jingles,
        spoken links, features or interviews - the same upload-then-publish pattern as
        tracks. You don't need any of this to build a programme (a programme can be just
        songs), but it's what makes a running order feel like radio instead of a playlist.
      </Step>

      <Step n={3} title="Create a programme">
        Go to <strong>Programmes</strong>, type a title, pick a channel, and click{" "}
        <strong>Create</strong>. This opens the programme builder, which is where you
        assemble the actual running order.
      </Step>

      <Step n={4} title="Build the running order">
        Two ways to fill it in, and you can mix both:
        <ul style={{ marginTop: 6 }}>
          <li>
            <strong>Manually:</strong> use the "+ Add song..." and "+ Add spoken
            content..." dropdowns at the bottom of the builder. Reorder items by
            dragging them or using the ↑/↓ buttons; duplicate or remove items as needed.
            The total duration at the top updates automatically.
          </li>
          <li>
            <strong>AI producer:</strong> describe what you want in the text box near the
            top - e.g. "60-minute upbeat Saturday morning show, eight songs, a link after
            every two songs" - and click <strong>Propose running order</strong>. It only
            ever picks from your real, published catalogue (never invents songs), and it
            <em> replaces</em> the running order below for you to review - nothing
            publishes automatically. If you haven't published any tracks yet (Step 1),
            it won't have real songs to work with.
          </li>
        </ul>
      </Step>

      <Step n={5} title="Save and publish the programme">
        <strong>Save draft</strong> keeps your work without making it public - safe to
        use any time while you're still arranging things. <strong>Publish</strong> makes
        the programme visible to listeners immediately (under Programmes, and it becomes
        the "on air" programme for its channel if it's the most recently published one).
        There's no in-between "scheduled for later" yet - see the note at the bottom of
        this page.
      </Step>

      <Step n={6} title="Manage channels">
        Kizzi Radio is <span className="badge live">live</span> from day one; the other
        five channels start as <span className="badge">building</span> - completely
        invisible to listeners - so you can upload, tag and build out a channel's content
        at your own pace. On the <strong>Channels</strong> page, <strong>Check
        readiness</strong> gives you a quick advisory checklist (artwork set, matching
        tagged tracks, at least one published spoken item) - it's a nudge, not a hard
        gate. When you're happy, click <strong>Go live</strong> to make that channel and
        its published programmes visible everywhere.
      </Step>

      <h2 style={{ marginTop: 32 }}>How content flows through to listeners</h2>
      <div className="card">
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>
            <strong>Home / Explore Channels</strong> only shows channels with status{" "}
            <span className="badge live">live</span>.
          </li>
          <li>
            <strong>Albums, Programmes, Search</strong> only show tracks/programmes with
            status <span className="badge">published</span>.
          </li>
          <li>
            <strong>Listen Now</strong> picks the most recently published programme on a
            live channel and works out where in it a listener joining "right now" would
            be, based on how long ago it was published - looping once it finishes. There's
            no real 24/7 stream to manage; publishing a programme is enough to put it "on
            air."
          </li>
        </ul>
      </div>

      <h2 style={{ marginTop: 32 }}>Not built yet</h2>
      <p style={{ color: "var(--text-dim)" }}>
        Weekly scheduling (mapping time slots to programmes ahead of time), listener
        favourites, and listening history are intentionally deferred until the core
        catalogue/programme/publish workflow above has been used for real and feels
        solid. Right now, "publish" is the only lever - a programme goes on air as soon
        as you publish it, not at a scheduled future time.
      </p>
    </div>
  );
}
