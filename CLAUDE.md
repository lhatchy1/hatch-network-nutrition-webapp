# CLAUDE.md — agent handbook

A self-contained orientation for any agent (or human) picking up this
codebase cold. Pair with [`spec.md`](./spec.md) (the product spec) and
[`IMPORT.md`](./IMPORT.md) (the data-import schema).

## What this is

A multi-user **Meal Prep Planner** PWA: ingredient library → meals →
weekly plan (user-configurable slots per day) → auto shopping list →
public sharing area. State lives in `localStorage` (offline cache) and
syncs to Firestore per user. Deploys to GitHub Pages.

Accounts are **invite-only** — there's no sign-up UI; the admin creates
users from the Firebase console. The Firebase console's "Enable create
(sign-up)" toggle must be **off** to fully lock client-side account
creation.

**Live URL:** `https://food.hatchnetwork.ch/` (custom domain on GitHub
Pages, project `lhatchy1/hatch-network-nutrition-webapp`).

**Firebase project in production:** `hatch-food-planner` — a dedicated
project for this app, segmented from the owner's other Firebase work.
Auth method enabled: Email/Password only, with "Enable create (sign-up)"
turned off. Firestore is in production mode with rules from
[`firestore.rules`](./firestore.rules).

## Stack & key decisions

| Concern | Choice | Why |
| --- | --- | --- |
| Build | Vite + TypeScript (vanilla template) | Fast dev, sensible defaults |
| Reactivity | Alpine.js | Tiny; we use only the global store + `Alpine.effect` |
| CSS | Pico **classless** (forms + `<dialog>` only) + custom Greenhouse layer in `src/ui/styles.css` | Pico handles native form/dialog defaults; everything else (layout, nav, week grid, status colours, dialogs) is hand-rolled against design tokens. See "Design direction" below. |
| Design tokens | CSS custom properties at the top of `src/ui/styles.css` (`--bg`, `--ink`, `--accent`, `--cat-*`, `--status-*`, …) | Single source of truth for the warm sage/terracotta "Greenhouse" palette; theme switching swaps the same names in `[data-theme="dark"]`. |
| Fonts | Geist (display + body) + DM Mono (numerals / labels) via Google Fonts | Brief locks these two faces; nothing else. `font-variant-numeric: tabular-nums` is set on `body`. |
| Persistence | `localStorage` key `mealprep:v3[:uid]` | Single-blob, debounced 300 ms; namespaced per user once signed in. `normalise()` back-fills from v1/v2 keys on first load. |
| Auth + sync | Firebase Auth (Email/Password) + Firestore | Cross-device sync; admin-provisioned accounts; offline-first via localStorage cache |
| PWA | `public/manifest.webmanifest` + `public/sw.js` (stale-while-revalidate, versioned cache `mealprep-v4`) | Offline-capable, installable |
| Routing | Hash router (`#/week`, `#/meals`, `#/ingredients`, `#/shopping`, `#/share`) | GitHub Pages has no SPA fallback; hashes never hit the server. `#/week` is the default. |
| Hosting | GitHub Pages via Actions (`actions/deploy-pages@v4`) | No backend; main → live |
| Bundle target | None (was 50 KB, dropped during planning) | Optimise for clarity |

### Design direction — "Greenhouse"

Full visual handoff lives in the conversation history under
`design_handoff_hatch_greenhouse/` (warm off-white surfaces, sage
accent, terracotta destructive, four-macro rings, mobile bottom tab
bar + desktop horizontal nav, native `<dialog>` for Settings and the
meal picker). The locked decisions to respect when changing UI:

1. **Asymmetric per-macro status** — `kcal` symmetric ±5 %, `protein`
   under-only, `carbs` symmetric ±15 %, `fat` over-only. Implemented
   in `src/status.ts`; render via the `.v-under` / `.v-near` /
   `.v-over` classes (never inline colours).
2. **Category dot, not slot icon** — the small coloured circle on
   every meal row is derived from the meal's first ingredient's
   category (`mealCategory()` in `status.ts`).
3. **Mobile vs desktop chrome** — top context bar (`.mtop`) + bottom
   tab bar (`.mtabs`) under 920 px; horizontal `.nav` ≥ 920 px. Both
   ship in `index.html`; CSS hides the inactive set.
4. **Always-visible affordance on every Week slot** — `＋` for empty,
   `›` for filled; both open the meal picker. There is no
   "click the row" alternative.
5. **Settings + meal picker = native `<dialog>`** — `showModal()`
   handles backdrop/focus-trap/Esc. The custom layer resets Pico's
   `dialog { display: flex }` overlay so a closed dialog can't paint;
   see "Gotchas" below.

## Architecture in one diagram

```
index.html
  ├── .nav                   (desktop horizontal nav, filled by main.ts)
  ├── .mtop                  (mobile top bar: brand · #mtop-ctx · gear)
  ├── #view                  (the current view OR the sign-in form)
  ├── .mtabs                 (mobile bottom tab bar, filled by main.ts)
  ├── #settings-dialog       (native <dialog class="settings">)
  └── #meal-picker-dialog    (native <dialog class="meal-picker">)

main.ts
  ├── initStore(Alpine)              ← creates Alpine.store("app")
  ├── applyTheme(store.theme)        ← writes [data-theme] before paint
  ├── initAuth() + initSync()        ← only if isFirebaseConfigured()
  ├── Alpine.effect(renderCurrent)   ← re-renders on any tracked field
  ├── hashchange → renderCurrent
  ├── renderNav(active)              ← fills both .nav .links and .mtabs,
  │                                    plus #mtop-ctx (per-route caption)
  ├── setMealPickerCreateHook(...)   ← "＋ New meal" footer → #/meals
  └── service worker register (PROD only)

src/state.ts                 src/store.ts                src/theme.ts
  load / save / validate       Alpine store +              applyTheme(pref) →
  setStorageScope(uid)         snapshot / replaceState     [data-theme] on <html>
  setOnSave(hook)              reseedStore() (sign-in/out) ("auto" removes it)
  (signed-out / per-uid keys)  snapshot strips proxies
                                          │
src/nutrition.ts  src/shopping.ts         ▼          src/status.ts
  pure functions over AppState        getStore()       status(macro,v,t) →
                                       in views        "under"|"near"|"over"
                                                       mealCategory(meal,ings)
                                                       dotClass(category)

  ┌─ src/firebase/ ────────────────────────────────────────────┐
  │  config.ts   readEnv() + lazy initializeApp/getAuth/getDb  │
  │  auth.ts     initAuth, onAuthChange, signIn, signOut       │
  │  sync.ts     load/reconcile on sign-in, onSnapshot live    │
  │              updates, mirror saves up via state.setOnSave  │
  │  sharing.ts  shareIngredient/Meal/WeekPlan, listShared,    │
  │              deleteShared (top-level shared_* collections) │
  └────────────────────────────────────────────────────────────┘

  ┌─ src/ui/ ──────────────────────────────────────────────────┐
  │  components.ts      html`` tagged template (auto-escapes), │
  │                     esc(), raw(), confirmAction()          │
  │  styles.css         design tokens + custom Greenhouse layer│
  │  authGate.ts        signed-out sign-in form                │
  │  foodSearchPanel.ts text search + Scan, used by ingredients│
  │                     view AND meals editor                  │
  │  mealPicker.ts      <dialog class="meal-picker"> wired by  │
  │                     every Week slot's ＋/› button.         │
  │                     openMealPicker({day, slotId}, after).  │
  │  barcodeScanner.ts  lazy-loaded ZXing camera scanner       │
  └────────────────────────────────────────────────────────────┘
```

Views mutate the store directly (e.g. `store.ingredients.push(...)`).
The `Alpine.effect` in `main.ts` saves on every mutation (debounced) and
re-renders the active view. Views render via the `html` tagged template
in `src/ui/components.ts`, which escapes interpolations by default.

When signed in, every persisted save also fires the `setOnSave` hook
that `sync.ts` registers — that hook pushes the snapshot up to
Firestore (with a `lastPushed` JSON cache so we don't echo our own
remote updates back to the server).

## Conventions

- **Always escape HTML.** Use `html\`<div>${value}</div>\`` from
  `src/ui/components.ts` — interpolations are auto-escaped. Use
  `raw(prebuilt)` only when intentionally injecting pre-escaped HTML.
- **Mutate via the store, never via local state.** The render loop hangs
  off Alpine's reactivity — local-only state won't trigger saves.
- **Pure logic in `nutrition.ts` / `shopping.ts` / `status.ts`.** No
  DOM, no Alpine.
- **Destructive actions confirm.** Use `confirmAction(message)` from
  `ui/components.ts`.
- **Status colours go through `status.ts`.** Compute the key with
  `status(macro, value, target)` and render via the `.v-under` /
  `.v-near` / `.v-over` classes — never inline a colour. Themes
  cascade automatically.
- **Theme writes go through `theme.ts`.** Use `applyTheme(pref)`;
  don't poke `[data-theme]` directly from views. `"auto"` removes
  the attribute so `prefers-color-scheme` takes over.
- **No comments that just restate the code.** A `// why` line for a
  subtle constraint is fine; "// loops over items" is noise.
- **Bundled docs via `?raw`.** `IMPORT.md` is imported by
  `views/settings.ts` as `?raw` so the in-app copy stays in lockstep
  with the repo doc — don't duplicate it as a TS constant.
- **JSON import is library-only.** The `Import JSON…` flow merges
  ingredients and meals into the library with fresh ids; it does
  **not** transport slots, the week plan, targets or the profile.
  Use the **Share** tab to move week plans (and meal/ingredient
  packages) between accounts — sharing handles the dependency graph
  and re-ids on adoption. `validateImport` + `mergeImport` live in
  `state.ts`; widening the import payload requires updating
  `IMPORT.md` too.
- **Export is a full snapshot.** Even though import is library-only,
  `Export JSON` serialises the entire `AppState` so users have a
  proper backup file. If you ever wire up a "restore from backup"
  flow, that's a different path from `Import JSON…` and should keep
  the "overwrite all data" confirmation.

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
| New view | Add `src/views/<name>.ts`, register in `ROUTES` in `main.ts` (with a `ctx: () => …` caption for the mobile top bar), and the nav fills both `.nav .links` and `.mtabs` from that array. |
| Tweak default meal slots | `src/types.ts` (`DEFAULT_SLOTS`). Live slots are stored in `state.slots` and editable per-user from Settings. |
| New ingredient category | `src/types.ts` (`INGREDIENT_CATEGORIES`) — listed categories drive the shopping-list grouping order. Also update `guessCategory` in `src/api/foodSearch.ts` so Open Food Facts hits map into it, add a `--cat-<slug>` swatch + `.cat-tag.<slug>` background in `src/ui/styles.css`, and (if the slug isn't one of the brief's five) consider whether the filter pill row in `src/views/ingredients.ts` (`PILL_CATEGORIES`) should include it. |
| Tweak per-macro status thresholds | `src/status.ts`'s `status()` switch (kcal / protein / carbs / fat each have their own band). Keep it asymmetric — the design choice is "only flag what actually matters." |
| New status colour shade | `src/ui/styles.css` `--status-{under,near,over}` (both light + dark `[data-theme="dark"]` blocks). |
| Storage shape change | Bump key in `src/state.ts` (`STORAGE_KEY`) **and** bump `CACHE_VERSION` in `public/sw.js`. Append the old key to `LEGACY_STORAGE_KEYS` so old saves auto-migrate. Update `normalise()`. Add the field to the `void s.foo` list in `main.ts` and to `snapshot()` / `replaceState()` / `reseedStore()` in `store.ts`. If the new field belongs in the JSON-import payload too, also update `validateImport` and `mergeImport` (and `IMPORT.md`). |
| Add a new persisted preference | Same as "Storage shape change", plus surface a control in the Settings dialog (`src/views/settings.ts`). If it affects rendering globally, write a thin helper module (see `theme.ts` for the pattern) so views don't poke the DOM directly. |
| New `<dialog>` | Mount the element in `index.html`. In `src/ui/styles.css`, **scope every custom rule that sets `display` / position / size to `dialog.<class>[open]`** — Pico classless's `dialog { display: flex; backdrop-filter: … }` will otherwise paint the closed dialog full-screen on top of the page. Backdrop click via `e.target === dialog` (don't use `{ once: true }` — inside clicks consume the listener). |
| New shareable kind | Add to `ShareKind` in `src/firebase/sharing.ts`, define a `Shared*` interface, add a tab in `src/views/share.ts`, and update `firestore.rules`. |
| Change custom domain | DNS `CNAME` at the registrar, `public/CNAME`, Settings → Pages → Custom domain, and `base` in `vite.config.ts` (`/` for a subdomain root, `/<subpath>/` if you ever subpath-serve again) |

## Auth + sync (Firebase)

- Config in `src/firebase/config.ts` — pulls `VITE_FIREBASE_*` env vars
  (`API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `APP_ID`). When any are
  missing, `isFirebaseConfigured()` returns false and the app silently
  runs in offline-only mode (no auth gate, no Share tab). This keeps
  local dev usable without a `.env`.
- Auth observer lives in `src/firebase/auth.ts`. `initAuth()` registers
  `onAuthStateChanged`; consumers subscribe via `onAuthChange()`.
- Sync loop in `src/firebase/sync.ts`:
  1. On sign-in, switch the localStorage scope to `mealprep:v3:{uid}`.
  2. Read `/users/{uid}/state/main` from Firestore.
  3. If both local and remote have data and they differ, prompt the
     user (push-local vs use-cloud) via `window.confirm`:
     **OK = push local**, **Cancel/Esc = use cloud** (the safer
     default for multi-device).
  4. If the per-uid local cache is empty but the signed-out localStorage
     scope has data (data the user entered before creating an account),
     it gets surfaced as "local" in the reconcile step and the
     signed-out scope is cleared once adopted.
  5. Subscribe via `onSnapshot` so other devices receive live updates.
  6. Mirror local saves up to Firestore (debounced by `state.save()`'s
     timer, then re-debounced via the `lastPushed` JSON cache to avoid
     re-pushing values we just received).
- Sharing in `src/firebase/sharing.ts`: top-level `shared_ingredients`,
  `shared_meals`, `shared_plans` collections. Each doc is self-contained
  (a shared meal carries its ingredients; a shared plan carries its
  meals + ingredients) so importers don't need them pre-installed.
  Importers re-id every nested entity locally so duplicate "Add to my
  library" doesn't collide with an earlier copy.
- Security rules at `firestore.rules` — copy/paste into Firebase
  Console → Firestore Database → Rules. There is no automated rules
  deploy (no firebase-tools in CI); after editing the file, paste the
  whole thing into the console and click Publish.

### Firebase project setup (one-time, already done in production)

Documented in detail in [`README.md`](./README.md). Summary for any
future agent recreating the setup:

1. Create a new Firebase project (e.g. `hatch-food-planner`).
2. Authentication → Sign-in method → enable Email/Password (first
   toggle only).
3. Authentication → Settings → User actions → **untick "Enable create
   (sign-up)"**. Without this, anyone with the public API key can
   create accounts via the SDK.
4. Authentication → Users → add accounts manually.
5. Firestore Database → Create (production mode) → Rules tab →
   paste `firestore.rules` → Publish.
6. Project settings → register a web app → copy the four config values
   into `.env` locally and into GitHub Actions secrets for production
   (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`,
   `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`).
7. Authentication → Settings → Authorized domains → add
   `food.hatchnetwork.ch`. Without this, sign-in on the live site
   fails with `auth/unauthorized-domain`.

## Build / dev / deploy

```sh
npm install
cp .env.example .env  # then fill in your Firebase config (optional)
npm run dev        # http://localhost:5173/
npm run build      # tsc --noEmit && vite build
npm run preview    # serve dist/
npm run typecheck  # tsc --noEmit only
npm run icons      # regenerate PWA icon PNGs
```

CI: `.github/workflows/deploy.yml` builds on push to `main` and deploys
to Pages. The deploy job needs **Repo Settings → Pages → Source: GitHub
Actions** set once before the first deploy can publish, plus the
`VITE_FIREBASE_*` secrets configured at **Repo Settings → Secrets and
variables → Actions** for the production build to bake them into the
bundle.

## Gotchas

- **"Failed to read remote state … client is offline" is benign on
  first sign-in.** Firestore's first `getDoc()` can resolve before the
  WebSocket-style transport is up; we catch it and fall through to
  `onSnapshot`, which retries automatically. For a brand-new user
  there's no document to read anyway. Don't be tempted to convert it
  into a hard error or a user-facing alert — it self-heals.
- **Slot IDs are user-defined strings.** `DEFAULT_SLOTS` keeps the
  literal IDs `bridge` / `lunch` / `dinner` purely so older saved
  `WeekPlan` keys remain valid. New slots use `uid()` IDs. The
  `WeekPlan` type is `Record<DayKey, Record<string, string | null>>`
  — don't reintroduce a fixed-union `SlotKey` type.
- **`mergeWeek` in `state.ts` drops slot keys not present in the
  current `slots` list.** That's intentional — removing a slot from
  Settings should also strip it from every day — but it means a
  corrupted save where `slots` doesn't match `week` will silently
  forget assignments. If you ever change slot id semantics, audit
  this function.
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
- **Don't commit `.env`.** It's gitignored. Production config lives in
  GitHub Actions secrets and is baked into the bundle at build time by
  the deploy workflow (`.github/workflows/deploy.yml`). If you change
  the env-var names, update the workflow's `env:` block too.
- **The Firebase web `apiKey` isn't a secret** in the security sense —
  it's bundled into the published JS and visible to anyone. Real
  security lives in (a) the disabled sign-up toggle, (b) Firestore
  rules, and (c) the authorized-domains list. Treat the key like a
  project identifier, not a credential.
- **Pico classless paints closed `<dialog>` elements.** Pico's
  classless build ships `dialog { display: flex; position: fixed;
  inset: 0; backdrop-filter: var(--pico-modal-overlay-backdrop-filter)
  }` plus `dialog:not([open]) { display: none }` at the same
  specificity. Any later custom rule that sets `display` on the same
  selector — including a media-query override like
  `@media (min-width: 920px) { dialog.meal-picker { display: grid } }`
  — wins the cascade for the **closed** dialog too, blurring the page
  on first load. `src/ui/styles.css` restates `dialog:not([open])
  { display: none !important }` near the top and resets Pico's
  `backdrop-filter` / overlay `background`; keep that guard in place
  and always qualify your own `display`-setting dialog rules with
  `[open]`.
- **Pico injects a magnifying-glass on `[type=search]`.** Classless
  Pico sets a background image and a matching `padding-inline-start`
  to reserve space for it. `src/ui/styles.css` clears both so app-
  level inline padding doesn't sit on top of the icon — the design
  uses plain inputs without icons. If you want the icon back, undo
  that reset in CSS rather than per-input.
- **Circular icon buttons need `padding: 0; line-height: 1`.** Pico's
  default `button { padding: 0.75rem 1rem }` is asymmetric, and with
  a fixed `width`/`height` + `box-sizing: border-box` it squishes the
  glyph off-centre. All `.gear` / `.close` / `.plus` / `.chevron`
  rules in `styles.css` reset both — match that pattern for any new
  circular button.
- **Backdrop click on a `<dialog>`: use `e.target === dialog`, not
  geometry.** Native dialogs dispatch the click with `target === dialog`
  when the backdrop area is hit; inner clicks bubble with the inner
  element as `target`. Don't use `addEventListener("click", …, { once:
  true })` either — an inner click consumes the listener, and you lose
  backdrop-to-close after that. Use a `dialog.dataset.backdropBound`
  guard to bind once (see `mealPicker.ts` / `settings.ts`).
- **Mobile chrome and desktop nav both ship every page.** `index.html`
  has both `.nav` (desktop) and `.mtop` + `.mtabs` (mobile); CSS hides
  the inactive set at 920 px. The Week view also renders both the
  mobile daystrip + today card AND the desktop 7-day grid — same
  rule. If you add a new surface that only makes sense at one
  viewport, mirror this pattern (render-both-hide-one) rather than
  branching on `matchMedia` — it survives resize without re-rendering.

## Branching & PRs

- Default branch: `main`.
- Feature branches: `claude/<topic>-<token>` (the harness's convention).
  Branch off `main`, open a PR, squash-merge.
- Never push directly to `main`. Pages deploys are triggered by merges
  to `main`.

## Open items / not yet done

- "Duplicate previous week" button shows a placeholder alert — needs
  week history first (listed under Future enhancements in `spec.md`).
- PWA icons are placeholders generated by `scripts/generate-icons.mjs`.
  Replace the PNGs or edit the script. The brief picked the
  Greenhouse palette; icons should match (sage `#5e8a4d` on the warm
  `#f7f1e5` background) but haven't been regenerated.
- Acceptance checklist in `spec.md` is unticked; tick after running
  through it on a real device.
- **Settings sections deliberately omitted from the brief.** The
  brief sketched "Sharing circle" (list of invited users), "Week
  starts on" segment, and "Compact density" toggle. None are wired —
  the app doesn't track an invited-users list (admin provisions via
  Firebase console), the week is hard-coded Monday-start, and the
  brief didn't define what compact mode would do. Surface only if /
  when the underlying data model actually exists.
- **Meal-picker "＋ New meal" loses slot context.** Tapping the
  footer's `＋ New meal` navigates to `#/meals` (see
  `setMealPickerCreateHook` in `main.ts`). The active `{day, slotId}`
  is dropped, so the user has to come back and pick the new meal
  manually. A future iteration could persist the target and auto-
  assign after the new meal is saved.
- **Mobile Meals doesn't push-navigate list → detail.** The Meals
  view uses the desktop `.meals-d` master-detail markup at every
  viewport; on mobile the detail panel stacks below the list rather
  than replacing it. The brief expected a tap-to-detail flow. Easy
  follow-up: add a `mobileDetailOpen` flag and toggle a body class.
- **Meal-picker "Recent" is a proxy.** No pick-history is persisted;
  it's derived from the most-used meals in the current week. Fine for
  the small-circle model but won't survive a fresh week.
- Bundle size sits around ~148 KB gzipped for the main chunk after
  the Greenhouse refresh (Firebase + Alpine + the design layer).
  Code-splitting Firebase Auth + Firestore out of the boot path is a
  possible win; not pursued because cold-start sign-in needs them
  immediately.
- No password-reset / forgot-password UI. By design — accounts are
  admin-provisioned, and the owner resets passwords in the Firebase
  console. Add only if the user base outgrows that model.

## Closing a session ("close chat")

When the user says **"close chat"** (or "wrap up", "ship it",
"finalise"), treat it as a single instruction to leave the repo in a
clean, shippable state with no further questions. Run this checklist
end-to-end without prompting:

1. **Reconcile docs with code.** Walk through every change made in the
   conversation and update:
   - `CLAUDE.md` — keep the "Stack & key decisions" table, the
     architecture diagram, "Common changes", "Gotchas", "Open items"
     and "Where to find things" sections accurate. Add any new module
     to the diagram + the lookup table. Add any non-obvious trap you
     hit during the session to "Gotchas" (with a one-line
     reproduction recipe).
   - `spec.md` — update if the data model, view list, persistence
     key, default state, or PWA cache version changed.
   - `IMPORT.md` — update only if `validateImport` / `mergeImport`
     widened the accepted payload.
   - `README.md` — update only if first-run / setup steps changed.
2. **Build green.** Run `npm run typecheck` then `npm run build`. If
   either fails, fix the failure before continuing — don't ship a red
   build.
3. **Commit.** Stage everything with `git add -A`, then `git status`
   to confirm nothing sensitive (`.env`, credentials, build artifacts
   that aren't already gitignored) is included. Compose a commit
   message in the project's existing style — short imperative subject,
   then a body that explains *why* not just *what*. Do **not** add
   marketing-style headers or co-author trailers; the existing log
   uses plain prose only. (See recent `git log` for examples.)
4. **Push.** `git push -u origin <branch>` on the working branch from
   the harness's "Git Development Branch Requirements" block. Retry
   up to 4× with exponential backoff (2s, 4s, 8s, 16s) on network
   failure; never force-push, never skip hooks.
5. **Do not open a PR.** PRs are explicit-only — the user will ask if
   they want one. Do not run `mcp__github__create_pull_request`.
6. **Summarise.** Reply with a tight summary: the commit SHA, the
   one-line subject of each commit pushed this session, the
   touched-file count, and any deferred items the user should know
   about. Keep it under ~150 words.

The point of this protocol is that a fresh chat opening this repo
tomorrow should be able to orient from `CLAUDE.md` alone, without
re-reading the conversation history.

## Where to find things

| Looking for… | Open |
| --- | --- |
| Product spec | `spec.md` |
| Import JSON schema + prompt | `IMPORT.md` |
| All shared types | `src/types.ts` |
| Anything render-related | `src/views/<name>.ts` + `src/ui/` |
| Design tokens + custom CSS | `src/ui/styles.css` (single combined file) |
| Per-macro status thresholds + category dots | `src/status.ts` |
| Theme application | `src/theme.ts` (writes `[data-theme]` on `<html>`) |
| Anything maths-related | `src/nutrition.ts`, `src/shopping.ts` |
| State / persistence / import / migration | `src/state.ts`, `src/store.ts` |
| Auth + cloud sync | `src/firebase/{config,auth,sync,sharing}.ts`, `firestore.rules` |
| Sign-in form | `src/ui/authGate.ts` |
| Sharing UI | `src/views/share.ts` |
| Routing / startup / nav rendering / mtop context | `src/main.ts` |
| Open Food Facts integration | `src/api/foodSearch.ts` (search + barcode lookup) |
| Food-search UI (shared) | `src/ui/foodSearchPanel.ts` |
| Meal picker dialog | `src/ui/mealPicker.ts` |
| Barcode camera scanner | `src/ui/barcodeScanner.ts` (lazy-loaded) |
| PWA shell + custom domain | `public/manifest.webmanifest`, `public/sw.js`, `public/CNAME` |
| HTTPS bounce / app shell + dialog mounts | `index.html` |
| CI / deploy | `.github/workflows/deploy.yml` |
