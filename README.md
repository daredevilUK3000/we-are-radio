# Kizzi Radio

Personal digital radio network and broadcasting platform. See `Kizzi_Radio_Brief_v2.md`
for the full product brief this scaffold implements (Section 42's first-release scope).

## Structure

```
worker/     Cloudflare Worker API (Hono + D1 + R2)
app/        Listener PWA + Kizzi Radio Studio (Vite + React)
migrations/ D1 schema (six core tables + seed channels)
wrangler.toml   Cloudflare bindings (D1 / R2 / KV)
```

## First-time setup

1. Install dependencies (from the repo root, npm workspaces):
   ```
   npm install
   ```

2. Create the Cloudflare resources and wire their IDs into `wrangler.toml`:
   ```
   npx wrangler d1 create kizzi-radio
   npx wrangler r2 bucket create kizzi-radio-media
   npx wrangler kv namespace create CONFIG
   ```
   Copy the resulting `database_id` / KV `id` into `wrangler.toml`.

3. Apply the schema:
   ```
   npm run db:migrate:local     # local dev DB
   npm run db:migrate:remote    # once you're ready to deploy
   ```

4. Copy `.dev.vars.example` to `.dev.vars` (repo root, next to `wrangler.toml`) and fill in:
   - `STUDIO_PASSWORD` - the password for the single Studio admin account
   - `SESSION_SECRET` - any long random string
   - `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` - an R2 API token (Cloudflare dashboard ->
     R2 -> Manage API Tokens), needed to sign direct-to-R2 upload URLs
   - `R2_ACCOUNT_ID` - your Cloudflare account ID
   - `ANTHROPIC_API_KEY` - powers the AI producer (`/studio/api/ai/propose-programme`);
     the Studio and listener app work fine without it, that endpoint just returns 503

   In production, set these with `wrangler secret put <NAME>` instead of committing them.

## Running locally

```
npm run dev:worker   # API on http://127.0.0.1:8787
npm run dev:app      # PWA on http://localhost:5173, proxies /api and /studio/api to the worker
```

Studio is at `http://localhost:5173/studio` (password-gated). The listener app is
everything else.

## Deploying

**Live deployment:** https://kizzi-radio-api.kizzi.workers.dev (one Worker serves both
the app and the API - see "Single-app deployment" below).

```
cd app && npx vite build && cd ..
npm run deploy:worker
```

That's it - one command deploys everything. Secrets are set on the Worker with
`wrangler secret put <NAME>` (not committed, not in `.dev.vars`); all of
`STUDIO_PASSWORD`, `SESSION_SECRET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and
`ANTHROPIC_API_KEY` are already set on the live deployment.

### Single-app deployment

The app and API are served from one Worker, not a separate Pages project. This uses
Cloudflare's Workers static assets feature: `wrangler.toml`'s `[assets]` block points
at `app/dist`, and `worker/src/index.ts` has a catch-all route (`app.get("*", ...)`)
that hands off to the `ASSETS` binding for anything that isn't `/api/*` or
`/studio/api/*`, so client-side routes like `/studio/tracks` or `/albums/:id` still
resolve to `index.html` (the single-page-app fallback) instead of 404ing.

Because it's all one origin, the Studio session cookie only needs `SameSite=Lax`
(not `None`) and the frontend can use relative `/api` and `/studio/api` paths in
production, not just in local dev - `VITE_API_ORIGIN` (in `app/src/api/client.ts`) is
only needed if you ever split the app and API back onto different domains.

## What's built vs. deferred

Matches Section 42 of the brief: listener app (Home, Listen Now, Albums, Programmes,
Search), Studio (auth, upload, catalogue, programme builder with drag-reorder running
order, publish, channel building/live toggle with an advisory launch checklist), the six
D1 tables from Section 33, and one AI capability (AI-assisted programme running-order
proposals via Claude, never auto-published). `schedules`, `favourites`,
`listening_history` and the remaining five channels are intentionally not built yet -
see Section 33's deferral note.

"Now Playing" is computed dynamically from the current published programme's
`publish_date` and running order (Section 20) rather than a real 24/7 stream - simpler
and cheaper, per the brief.
