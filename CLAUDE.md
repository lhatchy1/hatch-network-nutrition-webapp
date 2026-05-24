# CLAUDE.md — agent handbook

A self-contained orientation for any agent (or human) picking up this
codebase cold. Pair with [`spec.md`](./spec.md) (the product spec) and
[`IMPORT.md`](./IMPORT.md) (the data-import schema).

## What this is

A single-user **Meal Prep Planner** PWA: ingredient library → meals →
weekly plan (bridge / lunch / dinner per day) → auto shopping list. Fully
client-side, state in `localStorage`, deploys to GitHub Pages.

## Stack & key decisions

| Concern | Choice | Why |
| --- | --- | --- |
| Build | Vite + TypeScript (vanilla template) | Fast dev, sensible defaults |
| Reactivity | Alpine.js | Tiny; we use only the global store + `Alpine.effect` |
| CSS | Pico.css | Classless, dark mode via `prefers-color-scheme` |
| Persistence | `localStorage` key `mealprep:v1` | Single-blob, debounced 300 ms |
| PWA | `public/manifest.webmanifest` + `public/sw.js` (stale-while-revalidate, versioned cache) | Offline-capable, installable |
| Routing | Hash router (`#/ingredients`, `#/meals`, `#/week`, `#/shopping`) | GitHub Pages has no SPA fallback; hashes never hit the server |
| Hosting | GitHub Pages via Actions (`actions/deploy-pages@v4`) | No backend; main → live |
| Bundle target | None (was 50 KB, dropped during planning) | Optimise for clarity |

## Architecture in one diagram

```
index.html
  ├── #main-nav            (filled by main.ts on hashchange)
  ├── #view                (the current view renders into here)
  └── #settings-dialog     (gear icon → openSettings)

main.ts
  ├── initStore(Alpine)              ← creates Alpine.store("app")
  ├── Alpine.effect(renderCurrent)   ← re-renders the view whenever any
  │                                    tracked store field changes
  ├── hashchange → renderCurrent
  └── service worker register (PROD only, via import.meta.env.PROD)

src/state.ts                 src/store.ts
  load / save / validate       Alpine store + snapshot / replaceState
  uid() / emptyWeek() / etc.   (snapshot strips Alpine proxies → JSON-safe)
                                          │
src/nutrition.ts  src/shopping.ts         ▼
  pure functions over AppState        getStore() in views

                  ┌──────────────────────────────────────────┐
Add-ingredient ──▶│ src/ui/foodSearchPanel.ts                │
flows in both     │   text search (debounced) + Scan button  │
ingredients.ts ──▶│   ↓                          ↓           │
and meals.ts      │   src/api/foodSearch.ts      src/ui/     │
                  │   (OFF: search + lookup)     barcodeScanner.ts
                  │                              (lazy-loaded,
                  │                               @zxing/browser)
                  └──────────────────────────────────────────┘
```

Views mutate the store directly (e.g. `store.ingredients.push(...)`).
The `Alpine.effect` in `main.ts` saves on every mutation (debounced) and
re-renders the active view. Views render via the `html` tagged template
in `src/ui/components.ts`, which escapes interpolations by default.

## Conventions

- **Always escape HTML.** Use `html\`<div>${value}</div>\`` from
  `src/ui/components.ts` — interpolations are auto-escaped. Use
  `raw(prebuilt)` only when intentionally injecting pre-escaped HTML.
- **Mutate via the store, never via local state.** The render loop hangs
  off Alpine's reactivity — local-only state won't trigger saves.
- **Pure logic in `nutrition.ts` / `shopping.ts`.** No DOM, no Alpine.
- **Destructive actions confirm.** Use `confirmAction(message)` from
  `ui/components.ts`.
- **No comments that just restate the code.** A `// why` line for a
  subtle constraint is fine; "// loops over items" is noise.
- **Bundled docs via `?raw`.** `IMPORT.md` is imported by
  `views/settings.ts` as `?raw` so the in-app copy stays in lockstep
  with the repo doc — don't duplicate it as a TS constant.

## Nutrition data (Open Food Facts)

Ingredients can be added in three ways, ordered by speed-to-value:

1. **Barcode scan** — opens the device camera, decodes an EAN-13 / EAN-8
   / UPC-A / UPC-E barcode via `@zxing/browser`, then hits OFF's
   `/api/v2/product/<barcode>.json`. Best for packaged products.
2. **Text search** — debounced query against OFF's legacy free-text
   endpoint `/cgi/search.pl?search_terms=…&search_simple=1&action=process&json=1`.
   The newer `/api/v2/search` is facet-based and silently ignores
   `search_terms` — don't switch to it. `lc=en` is sent to prefer
   English names where the entry has them, but we **don't filter
   non-English hits out** — the user is the better filter, and a
   hard language filter risks hiding the right product.
3. **Manual entry** — preserved fallback for raw / unbranded items.

Both surfaces (Ingredients view, Meal editor) mount the same
`mountFoodSearchPanel` component. In the meal editor, picking a hit
creates a new library ingredient *and* attaches it to the meal at
100 g in one step.

The OFF→FoodHit mapping (`productToHit` in `src/api/foodSearch.ts`)
drops products without usable `energy-kcal_100g` (those are useless
for a nutrition planner) and best-effort-maps the OFF `categories_tags`
into our six ingredient categories via `guessCategory`.

## Common changes

| Task | Touch points |
| --- | --- |
| New view | Add `src/views/<name>.ts`, register in `ROUTES` in `main.ts`, add a link to the nav (auto-generated from `ROUTES`) |
| New week slot | `src/types.ts` (`SlotKey`, `SLOTS`) |
| New ingredient category | `src/types.ts` (`INGREDIENT_CATEGORIES`) — listed categories drive the shopping-list grouping order. Also update `guessCategory` in `src/api/foodSearch.ts` so Open Food Facts hits map into it. |
| Storage shape change | Bump key in `src/state.ts` (`STORAGE_KEY`) **and** bump `CACHE_VERSION` in `public/sw.js`. Update `validateImport` and `normalise` |
| Change custom domain | DNS `CNAME` at the registrar, `public/CNAME`, Settings → Pages → Custom domain, and `base` in `vite.config.ts` (`/` for a subdomain root, `/<subpath>/` if you ever subpath-serve again) |

## Build / dev / deploy

```sh
npm install
npm run dev        # http://localhost:5173/
npm run build      # tsc --noEmit && vite build
npm run preview    # serve dist/
npm run typecheck  # tsc --noEmit only
npm run icons      # regenerate PWA icon PNGs
```

CI: `.github/workflows/deploy.yml` builds on push to `main` and deploys
to Pages. The deploy job needs **Repo Settings → Pages → Source: GitHub
Actions** set once before the first deploy can publish.

## Gotchas

- **Barcode scanner is lazy-loaded.** `src/ui/barcodeScanner.ts` pulls in
  `@zxing/browser` (~114 KB gzipped). Import it via `await import("./barcodeScanner")`
  inside the click handler so the initial bundle stays slim — never
  static-import it from anything the app loads on boot.
- **Camera needs a secure context.** iOS Safari hides
  `navigator.mediaDevices` entirely on plain HTTP, so the scanner checks
  `window.isSecureContext` first and surfaces an explicit "needs HTTPS"
  message before falling through to the no-camera-support path. There's
  also an inline `<script>` at the top of `index.html` that bounces
  `http://` → `https://` before any other code runs — leave that in.
- **OFF API endpoint choice matters.** Use `/cgi/search.pl` for text
  search (it does free-text matching). Don't switch to `/api/v2/search`
  — that endpoint is facet-based and silently drops `search_terms`,
  which makes every query return the same popular products.
- **Custom domain.** The site is served at `https://food.hatchnetwork.ch/`
  via a DNS `CNAME` pointing the `food` subdomain at `lhatchy1.github.io`.
  `public/CNAME` ships in the Pages artifact to persist the
  Settings → Pages custom-domain value across deploys. `vite.config.ts`
  uses `base: "/"` because the site is at the subdomain root, not a
  subpath. If you ever move back to plain `<user>.github.io/<repo>/`,
  flip `base` to `/<repo-name>/` and delete `public/CNAME`.
- **`public/` vs root.** The service worker (`sw.js`) and manifest must
  be in `public/` so Vite copies them verbatim into `dist/` at the
  correct path. Source-tree imports for them won't work.
- **Service worker registers in prod only** (`import.meta.env.PROD`).
  Don't expect offline behaviour from `npm run dev`; use `npm run
  preview` to test the SW.
- **Cache invalidation.** The SW uses a versioned cache name
  (`mealprep-v<n>`). Old caches are cleaned on activation, but
  hash-named asset URLs do the heavy lifting. Bump `CACHE_VERSION` only
  if you change non-hashed assets (e.g. `sw.js` or the manifest).
- **Alpine proxies aren't JSON-safe.** Always go through
  `snapshot(store)` (in `src/store.ts`) before `JSON.stringify` — it
  deep-clones to plain objects.
- **`Alpine.effect` re-runs on any tracked read.** The effect in
  `main.ts` reads every top-level store field to subscribe; if you add a
  new top-level field, add it to that `void s.foo` list.

## Branching & PRs

- Default branch: `main`.
- Feature branches: `claude/<topic>-<token>` (the harness's convention).
  Branch off `main`, open a PR, squash-merge.
- Never push directly to `main`. Pages deploys are triggered by merges
  to `main`.

## Open items / not yet done

- "Duplicate previous week" button shows a placeholder — needs week
  history first (listed under Future enhancements in `spec.md`).
- PWA icons are placeholders generated by `scripts/generate-icons.mjs`.
  Replace the PNGs or edit the script.
- Acceptance checklist in `spec.md` is unticked; tick after running
  through it on a real device.

## Where to find things

| Looking for… | Open |
| --- | --- |
| Product spec | `spec.md` |
| Import JSON schema + prompt | `IMPORT.md` |
| All shared types | `src/types.ts` |
| Anything render-related | `src/views/<name>.ts` + `src/ui/` |
| Anything maths-related | `src/nutrition.ts`, `src/shopping.ts` |
| State / persistence | `src/state.ts`, `src/store.ts` |
| Routing / startup | `src/main.ts` |
| Open Food Facts integration | `src/api/foodSearch.ts` (search + barcode lookup) |
| Food-search UI (shared) | `src/ui/foodSearchPanel.ts` |
| Barcode camera scanner | `src/ui/barcodeScanner.ts` (lazy-loaded) |
| PWA shell + custom domain | `public/manifest.webmanifest`, `public/sw.js`, `public/CNAME` |
| HTTPS bounce / app shell | `index.html` |
| CI / deploy | `.github/workflows/deploy.yml` |
