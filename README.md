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

**Live deployment:**
- API (Worker): https://kizzi-radio-api.kizzi.workers.dev
- App (Pages): https://kizzi-radio-app.pages.dev

```
npm run deploy:worker

# The app needs to know the deployed worker's URL at build time, since
# Pages and the Worker are on different domains (no dev proxy in prod):
cd app && VITE_API_ORIGIN='https://kizzi-radio-api.kizzi.workers.dev' npx vite build && cd ..
npx wrangler pages deploy app/dist --project-name kizzi-radio-app
```

Because the app and API are on different domains, the Studio session cookie is set
with `SameSite=None; Secure` (see `worker/src/lib/auth.ts`) so it survives cross-site
fetch calls - this only works over HTTPS, which both `workers.dev` and `pages.dev`
provide by default.

Secrets are set on the deployed Worker with `wrangler secret put <NAME>` (not
committed, not in `.dev.vars`). `STUDIO_PASSWORD` and `SESSION_SECRET` are already set.
Still to do for full functionality in production:
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID` - an R2 API token
  (dashboard -> R2 -> Manage API Tokens), needed for direct-to-R2 uploads to work
- `ANTHROPIC_API_KEY` - powers the AI producer endpoint; everything else works without it

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
