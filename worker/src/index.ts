import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./lib/types";
import { requireStudioAuth, requireListenerAuth } from "./lib/auth";

import { authRoutes } from "./routes/auth";
import { listenerAuthRoutes } from "./routes/listenerAuth";
import { trackRoutes } from "./routes/tracks";
import { albumRoutes } from "./routes/albums";
import { channelRoutes } from "./routes/channels";
import { programmeRoutes } from "./routes/programmes";
import { audioAssetRoutes } from "./routes/audioAssets";
import { tagRoutes } from "./routes/tags";
import { uploadRoutes } from "./routes/upload";
import { aiRoutes } from "./routes/ai";
import { publicRoutes } from "./routes/public";
import { mediaRoutes } from "./routes/media";
import { favouriteRoutes } from "./routes/favourites";
import { historyRoutes } from "./routes/history";
import { podcastImportRoutes } from "./routes/podcastImport";
import { bulkImportRoutes } from "./routes/bulkImport";
import { programmeTitleRoutes } from "./routes/programmeTitles";
import { timeCapsuleRoutes } from "./routes/timeCapsules";
import { analyticsPublicRoutes, analyticsStudioRoutes } from "./routes/analytics";
import { shareLinkRoutes } from "./routes/shareLinks";
import { contestPublicRoutes } from "./routes/contest";
import { contestStudioRoutes } from "./routes/contestStudio";
import { likePublicRoutes, likeStudioRoutes } from "./routes/likes";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ credentials: true, origin: (origin) => origin ?? "*" }));

app.get("/health", (c) => c.json({ ok: true }));

// Public, listener-facing API - read-only, no auth. See routes/public.ts:
// it only ever selects published/live rows, independently of the Studio CRUD routers.
app.route("/api", publicRoutes);

// The listener app logs plays and visits here (aggregate only, no identity).
app.route("/api/analytics", analyticsPublicRoutes);

// Top 3 Creator Songs of 2026 (entries, song pages) and public Likes. These
// MUST stay above the listener sub-app below: its sign-in check applies to
// every /api/* route registered after it, which would turn every contest
// entry and like into a 401.
app.route("/api/contest", contestPublicRoutes);
app.route("/api/likes", likePublicRoutes);

// Listener auth (login/logout/session are unauthenticated by nature).
app.route("/api/auth", listenerAuthRoutes);

// Favourites and listening history belong to the single listener account
// (Kizzi, across her own devices) - gated on her session, not on the
// Studio's. See migrations/0002_favourites_and_history.sql.
const listener = new Hono<{ Bindings: Env }>();
listener.use("*", requireListenerAuth);
listener.route("/favourites", favouriteRoutes);
listener.route("/history", historyRoutes);
app.route("/api", listener);

// Studio auth (login/logout are unauthenticated by nature).
app.route("/studio/api/auth", authRoutes);

// Everything else under /studio/api/* requires a valid session.
const studio = new Hono<{ Bindings: Env }>();
studio.use("*", requireStudioAuth);
studio.route("/tracks", trackRoutes);
studio.route("/albums", albumRoutes);
studio.route("/channels", channelRoutes);
studio.route("/programmes", programmeRoutes);
studio.route("/audio-assets", audioAssetRoutes);
studio.route("/tags", tagRoutes);
studio.route("/upload", uploadRoutes);
studio.route("/ai", aiRoutes);
studio.route("/podcast-import", podcastImportRoutes);
studio.route("/bulk-import", bulkImportRoutes);
studio.route("/programme-titles", programmeTitleRoutes);
studio.route("/time-capsules", timeCapsuleRoutes);
studio.route("/analytics", analyticsStudioRoutes);
studio.route("/contest", contestStudioRoutes);
studio.route("/likes", likeStudioRoutes);
app.route("/studio/api", studio);

// Streams audio straight out of R2 - not gated on Studio auth, since
// published tracks/assets need to be playable by ordinary listeners. Draft
// content isn't linked anywhere in the listener app, but the R2 key itself
// isn't a secret either way. Top 3 contest files are the exception: only
// approved songs are served (see routes/media.ts).
app.route("/media", mediaRoutes);

// Shareable pages (track/album/channel/mood) get the SPA shell with Open
// Graph tags filled in server-side - see routes/shareLinks.ts. Must come
// before the plain catch-all below, which has no tags of its own beyond
// index.html's static defaults.
app.route("/", shareLinkRoutes);

// Everything else is the SPA (listener app + Studio shell). Exact static
// files (JS/CSS/etc) are served automatically before the Worker even runs;
// this catch-all only fires for client-side routes like /studio/tracks or
// /albums/:id. wrangler.toml's not_found_handling only applies to that
// automatic front-door routing, not to a binding-level fetch() called from
// here, so index.html is requested explicitly to get the SPA fallback.
app.get("*", (c) => {
  // Fetching "/index.html" directly gets 307-redirected by the asset
  // handler's URL canonicalization; "/" serves the same file as a 200.
  //
  // Deliberately a brand new Request with none of the original headers -
  // forwarding the incoming Accept-Encoding here caused Cloudflare's edge
  // cache for this fetch to serve whatever encoding (e.g. zstd) got cached
  // first to every subsequent visitor regardless of what their own browser
  // could decode (the cached response's Vary header never included
  // Accept-Encoding), which broke navigation for real users with ERR_FAILED
  // even though curl - which doesn't negotiate the same way - looked fine.
  const url = new URL(c.req.url);
  url.pathname = "/";
  return c.env.ASSETS.fetch(new Request(url, { method: "GET" }));
});

export default app;
