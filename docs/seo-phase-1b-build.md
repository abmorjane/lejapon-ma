# SEO 1B build pipeline

`npm run build` is the only production build entry point. It runs, in order:

1. `vite build`;
2. a read-only public Supabase fetch that creates `dist/sitemap.xml` and `dist/generated-seo-routes.json`;
3. a Puppeteer post-build pass that renders every indexable SEO route into a physical `index.html`;
4. a blocking validator for sitemap exclusions, canonicals, metadata, H1/body content, JSON-LD and languages.

## Why Puppeteer instead of a Vite prerender plugin

The evaluated Vite prerender plugin and `react-snap` are no longer actively maintained. Puppeteer is maintained, works with the existing Vite 5 / React 18 SPA, and lets the build wait for an explicit page readiness signal. It adds no production server and no browser code to the application bundle.

The minimum build runtime is Node.js 22.12 because Puppeteer 25 requires it. Chromium is a build-time dependency only.

## Client boot strategy

The output is a search-engine snapshot rather than React SSR markup. Each generated `#root` is marked `data-prerendered="true"`. At client boot, `main.tsx` clears that snapshot and starts the existing SPA with `createRoot`. It intentionally does not call `hydrateRoot`, because browser-captured HTML is not guaranteed to be byte-for-byte identical to a fresh React render.

## Dynamic URL enforcement

Published article slugs and quality-approved hotel slugs become physical directories in `dist`. Apache serves a generated `index.html` first; a missing `/blog/:slug` or `/hotels/:slug` then receives HTTP 404. The JSON manifest is generated for validation and traceability, while the filesystem itself is the Apache-compatible allowlist.

Hotel inclusion requires an active record, a safe stable slug, a name, and at least 300 characters of combined French short/full description. Existing mixed-case hotel slugs are preserved. New or changed slugs are normalized to lowercase by the admin code.

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are used. The scripts issue GET requests only; no service-role key, mutation, migration, or Supabase write is involved.
