# Raymondo Portfolio (Astro + Cloudflare Pages)

Static-first portfolio for graphic design and 3D work, with an admin dashboard for content management.

## Stack

- Astro static site (`src/pages/*`)
- Cloudflare Pages Functions (`functions/*`)
- Cloudflare D1 (project and asset metadata)
- Cloudflare R2 (images, posters, GLB/GLTF files, published snapshot)
- Cloudflare Access for `/admin` and `/api/admin/*`

## Project structure

- `src/pages/index.astro`: public gallery with discipline filter chips
- `src/pages/projects/[slug].astro`: static project detail pages
- `src/pages/admin.astro`: admin dashboard UI
- `public/admin.js`: admin dashboard client logic
- `functions/api/admin/*`: admin API
- `functions/api/assets/[[key]].js`: asset delivery endpoint
- `migrations/0001_init.sql`: D1 schema
- `scripts/prepare-catalog.mjs`: build-time catalog loader

## Local development

1. Install dependencies:

```bash
npm install
```

2. Run the site locally without Cloudflare tooling:

```bash
npm run dev
```

This is pure Astro dev (`astro dev`) and does not run Wrangler/Pages/D1/R2 locally.
Because of that, `/api/admin/*` Cloudflare function routes are not available in this mode.

Optional Cloudflare-parity local mode (runs Functions + local D1/R2 emulation):

```bash
npm run dev:cloudflare
```

If you want local admin access without Cloudflare Access, set `ALLOW_LOCAL_ADMIN=true` in `.env`.
You can also set it inline when starting dev:

```bash
ALLOW_LOCAL_ADMIN=true npm run dev:cloudflare
```

`npm run dev:cloudflare` also applies local D1 migrations automatically before starting Pages dev.
It also injects a local `UPLOAD_SIGNING_SECRET` fallback for signed upload URLs if one is not set.

## Environment variables

Copy `.env.example` to `.env` and set:

- `CATALOG_URL`: Public URL to `published/catalog.json` in R2 for static builds
- `SITE_URL`: canonical site URL (used by Astro config)
- `ASSET_PUBLIC_BASE_URL`: optional asset base URL (if omitted, `/api/assets/*` is used)
- `PAGES_DEPLOY_HOOK_URL`: Cloudflare Pages deploy hook for publish trigger
- `UPLOAD_SIGNING_SECRET`: secret key used to sign upload URLs
- `ALLOW_LOCAL_ADMIN`: `true` only for local development

## D1 setup

Create DB and apply migration:

```bash
npx wrangler d1 create raymondo_portfolio
npx wrangler d1 execute raymondo_portfolio --local --file=./migrations/0001_init.sql
```

Then update `database_id` in `wrangler.toml`.

## R2 setup

```bash
npx wrangler r2 bucket create raymondo-portfolio-assets
```

The same bucket stores uploaded media and `published/catalog.json`.

## Cloudflare Pages deployment

1. Create a Pages project connected to this repo.
2. Build command: `npm run build`
3. Build output directory: `dist`
4. Ensure bindings from `wrangler.toml` are applied in Pages settings.
5. Add environment variables from `.env.example`.
6. Create a Pages Deploy Hook and set `PAGES_DEPLOY_HOOK_URL`.

## Access policy

Protect these paths with Cloudflare Access email one-time code:

- `/admin`
- `/api/admin/*`

The APIs also verify `CF-Access-Authenticated-User-Email`.

## Publish workflow

1. Login to `/admin`.
2. Create or select a project from the left list.
3. Edit core content fields (`title`, `slug`, `discipline`, short/long descriptions). Draft edits autosave.
4. Upload assets by drag/drop. Asset kind is inferred automatically (`image`, `poster`, `model3d`).
5. Use **Run Preflight** or **Publish Snapshot** to check hard requirements before publish.
6. Confirm publish in the preflight modal. The selected project is promoted to `published` and a snapshot is generated.

Publish does:

- Validation for required project content
- Snapshot write to `published/catalog.json`
- Snapshot history write to `published/history/*`
- Optional trigger of Cloudflare Pages Deploy Hook

Admin preflight endpoint:

- `POST /api/admin/publish` with `{ "dryRun": true }` runs validation without writing snapshots.

## Notes

- Home page and project routes are static, generated from catalog JSON.
- Admin endpoints are runtime functions.
- 3D viewer uses `model-viewer` via CDN on project pages.
