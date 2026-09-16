import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env } from "./lib/types";
import { requireStudioAuth } from "./lib/auth";

import { authRoutes } from "./routes/auth";
import { trackRoutes } from "./routes/tracks";
import { albumRoutes } from "./routes/albums";
import { channelRoutes } from "./routes/channels";
import { programmeRoutes } from "./routes/programmes";
import { audioAssetRoutes } from "./routes/audioAssets";
import { tagRoutes } from "./routes/tags";
import { uploadRoutes } from "./routes/upload";
import { aiRoutes } from "./routes/ai";
import { publicRoutes } from "./routes/public";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ credentials: true, origin: (origin) => origin ?? "*" }));

app.get("/health", (c) => c.json({ ok: true }));

// Public, listener-facing API - read-only, no auth. See routes/public.ts:
// it only ever selects published/live rows, independently of the Studio CRUD routers.
app.route("/api", publicRoutes);

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
app.route("/studio/api", studio);

export default app;
