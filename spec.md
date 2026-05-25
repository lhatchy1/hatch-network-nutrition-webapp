# Meal Prep Planner — Spec

A web app for planning weekly meals, tracking nutrition, generating
shopping lists, and sharing recipes / plans with other users.

> Implementation details (architecture, conventions, gotchas) live in
> [`CLAUDE.md`](./CLAUDE.md). This file is the product spec.

## Goals & non-goals

**Goals**

- Single-page app with no app-specific backend (Firebase as managed
  BaaS for auth + sync + sharing)
- Build a library of reusable ingredients and meals
- Plan a week with **user-configurable slots** (Breakfast, Bridge,
  Lunch, Snack, Dinner — add as many as you want) and see daily
  nutrition totals
- Auto-generate a shopping list from the weekly plan
- Persist locally (offline cache) and sync per-user to Firestore for
  cross-device continuity
- Public sharing area so users can share ingredients, meals, and whole
  week plans with each other
- Mobile-friendly (will mostly be used on a phone in the kitchen)
- Installable as a PWA (offline-capable)
- **Invite-only**: only the admin can provision accounts (Firebase
  Console). No in-app sign-up.

**Non-goals**

- No public sign-up flow; Firebase's "Enable create (sign-up)" toggle
  is off
- No in-app password-reset / email-verification (admin handles in
  console)
- No recipe scraping
- No calorie tracking against actual consumption — this is a
  *planning* tool, not a food diary

## Stack

- **Vite + TypeScript**, vanilla — no React, Vue, Svelte, etc.
- **Alpine.js** (~15 KB) for reactivity
- **Pico.css classless** for native form/dialog defaults only; the
  rest of the UI is a hand-rolled "Greenhouse" layer in
  `src/ui/styles.css` (design tokens, mobile bottom tab bar +
  desktop nav, four-macro rings, native `<dialog>` for Settings and
  the meal picker). Theme via `[data-theme="light|dark"]` on
  `<html>`; `"auto"` removes the attribute so `prefers-color-scheme`
  takes over.
- **Fonts**: Geist (display + body) + DM Mono (numerals / labels) via
  Google Fonts. `font-variant-numeric: tabular-nums` on `body`.
- **Firebase** (Auth + Firestore) for accounts, per-user sync, and
  the public sharing collections
- **Open Food Facts** for nutrition lookups (text search + barcode);
  `@zxing/browser` is lazy-loaded for the camera-based barcode scanner
- **localStorage** as offline cache (key `mealprep:v5[:uid]`,
  back-fills from v1…v4 on first load)
- **PWA**: web manifest + service worker for offline + installable;
  cache key `mealprep-v6`
- No hard bundle-size budget — favour clarity

## Data model

```ts
type Unit = "g" | "ml" | "unit";

type IngredientCategory =
  | "Protein" | "Carbs" | "Produce" | "Dairy" | "Pantry" | "Other";

interface Ingredient {
  id: string;
  name: string;
  unit: Unit;
  kcalPer100: number;         // per 100g/ml, or per 1 unit if unit==="unit"
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  fibrePer100: number;        // grams; defaults to 0 on legacy ingredients
  sugarPer100: number;        // grams; subset of carbs
  saltPer100: number;         // grams (NaCl) — converted from sodium ×2.5
  category: IngredientCategory;
  densityGPerMl?: number;     // g/ml; only for "g"/"ml" units. Optional
                              // (defaults to 1) — used when a meal-line
                              // measures the ingredient in the other unit.
}

interface MealIngredient {
  ingredientId: string;
  amount: number;             // in `unit` if set, else the ingredient's native unit
  unit?: "g" | "ml";          // optional override; converted via density
}

interface Meal {
  id: string;
  name: string;
  servings: number;
  ingredients: MealIngredient[];
  notes?: string;
}

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

// Slot ids are user-defined strings (e.g. "bridge", "lunch", or any
// uid() value). The fixed-union SlotKey is gone.
type SlotKey = string;

interface MealSlot {
  id: SlotKey;
  label: string;
}

interface WeekPlan {
  [day in DayKey]: { [slotId: string]: string | null };  // mealId or null
}

interface UserProfile {
  displayName: string;        // shown on items the user shares
}

type ThemePref = "light" | "dark" | "auto";

interface AppState {
  ingredients: Ingredient[];
  meals: Meal[];
  slots: MealSlot[];          // ordered; renders week-grid rows top→bottom
  week: WeekPlan;
  targets: {
    kcal: number; protein: number; carbs: number; fat: number;
    fibre: number; sugar: number; salt: number;
  };
  shoppingChecked: string[];
  profile: UserProfile;
  theme: ThemePref;           // persisted; applied on boot by theme.ts
}
```

New accounts get three default slots (`bridge`, `lunch`, `dinner`) so
older saves keep working. Slots are editable from Settings.

**Derived (computed, not stored):**

- `mealNutrition(meal)` → `{ kcal, protein, carbs, fat, fibre, sugar, salt }` per serving
- `dayTotals(day)` → sum of meal-per-serving nutrition for filled slots
- `shoppingList(week)` → ingredients aggregated across the week’s meals, grouped by category

## Views

Five routes via a hash-router: `#/ingredients`, `#/meals`, `#/week`,
`#/shopping`, `#/share`. (The Share tab is hidden when Firebase is not
configured.)

### 1. Ingredients

- Promoted **Scan a barcode** CTA at the top (sage-tinted card) — the
  primary add path. Opens the same panel as the **+ Add ingredient**
  button but auto-opens the camera scanner first.
- Filter pills (All / Protein / Carbs / Produce / Dairy / Pantry) +
  free-text search.
- Card rows showing kcal / P / C / F per 100 g/ml/unit, with a
  coloured `.cat-tag` on the right for the category.
- Inline edit panel on tap; Share appears only when signed in.

### 2. Meals

- Each row carries a small coloured category dot derived from the
  meal's first ingredient.
- Master-detail on desktop (sticky list left, detail right with the
  four-macro tile grid + ingredient lines). On mobile both panels
  stack — a future tap-to-detail navigation is a known gap.
- Detail/edit view:
  - Name, servings, notes
  - Add ingredients: pick from the library, or use **+ Search foods**
    to look up + attach in one step
  - Live-calculated nutrition per serving (all four macros)
- Duplicate / **Share** / Delete actions in the detail header.
- A shared meal carries its ingredients with it.

### 3. Week

- **Mobile**: page header (eyebrow + active day name) → 7-day strip
  (initial + date + status dot per day, current day in inverted ink)
  → today card with four macro rings + four slot rows. Every slot
  has an always-visible trailing button: `＋` (filled accent) when
  empty, `›` (muted ghost) when filled. Both open the meal picker
  dialog, which can pick, replace, or clear in one interaction.
- **Desktop**: page header (Mon → Sun date range + weekly macro
  averages inline) → 7-column `.week-grid` of `.day-col` cards. Each
  column has the slot rows + a totals block (status-coloured big
  kcal number, mono `/ N,NNN kcal`, P/C/F line). Current day's
  column uses the sage tint.
- Day swipe (mobile): horizontal swipe on the today card moves to
  the prev/next day.
- Status colours land in: day-strip status dot, macro ring stroke,
  day-total big-number, and the P value on the day-totals row —
  always via the `.v-under` / `.v-near` / `.v-over` classes from
  `status.ts`.
- **Share this week**, "Clear week", and the (deferred) "Duplicate
  previous week" actions.

### 4. Shopping list

- Auto-generated from the current week's plan.
- Summary card with a progress ring + "N of M items · K aisles".
- Category groups (`.cat-h` + `.cat-group`) — the cat-h carries the
  category swatch + checked count; each item has a circular `.ck`
  that fills with sage when checked. Done items strike-through.
- Buttons: "Copy as text" (markdown list), "Reset checks".
- Smart unit display: 1500 g → "1.5 kg"; 1200 ml → "1.2 L".

### 5. Share

- Three pill tabs: Meals (default), Ingredients, Weeks.
- Cards have an avatar (first initial of the author's display name)
  + relative publish time ("2d ago", "1w ago", date for older).
- "Copy" / "Copy week" verb; after import the button switches to
  the muted `.added` state with a ✓ prefix.
- "Unshare" appears only on items the current user authored.

## Authentication & sync

- **Auth**: Firebase Auth, Email/Password only. No sign-up form. The
  admin provisions accounts in Firebase Console. Firebase Console's
  "Enable create (sign-up)" toggle is off so the SDK can't be used
  to create accounts either.
- **Per-user data**: Firestore at `/users/{uid}/state/main` holds the
  whole `AppState` as a single document.
- **Cache**: localStorage at `mealprep:v5:{uid}` for signed-in users,
  `mealprep:v5` while signed out. The signed-out scope migrates into
  the per-uid scope on first sign-in (with a reconcile prompt if the
  cloud has different data). Older `v1` / `v2` / `v3` keys are
  auto-migrated on first read (v3 → v4 back-fills missing per-100
  fibre / sugar / salt to `0`).
- **Live sync**: `onSnapshot` keeps multiple devices in sync. Local
  saves debounce up to Firestore; remote updates re-seed the store.
- **Sharing**: top-level Firestore collections `shared_ingredients`,
  `shared_meals`, `shared_plans`. Each doc carries the dependencies
  it needs (a shared meal includes its ingredients; a shared plan
  includes its slots, meals, and ingredients).
- **Security rules**: source in [`firestore.rules`](./firestore.rules)
  — paste into Firebase Console → Firestore → Rules to publish.
  Public read on shared collections; auth-required create; author-
  only delete; updates denied (re-share to publish a new version).

## Persistence

- Entire `AppState` serialised to `localStorage` on every mutation
  (debounce ~300 ms)
- When signed in, the same snapshot mirrors to Firestore (with a
  `lastPushed` JSON cache to avoid echoing remote updates back)
- On load: if key missing, initialise with default state — empty
  library, three default slots (`bridge` / `lunch` / `dinner`),
  targets `{ kcal: 2050, protein: 140, carbs: 220, fat: 70, fibre: 30,
  sugar: 50, salt: 6 }`, theme `"auto"`.

## Import / export

- The gear icon (top-right on both viewports) opens a native
  `<dialog>` with five grouped sections:
  - **Account** (signed-in only) — email, display name, sign-out
  - **Daily macro targets** — kcal / P / C / F tiles; tap a tile to
    edit inline
  - **Day structure** — slot count, slot labels (rename / reorder /
    remove)
  - **Appearance** — theme segment (Light / Dark / Auto)
  - **Data** — Export everything (JSON), Import library JSON…, Copy
    import prompt, Clear all data
- **Export JSON** downloads `mealprep-YYYY-MM-DD.json` (full
  snapshot, used for backups; includes the theme preference).
- **Import ingredients & meals…** — file picker; reads the
  `ingredients` and `meals` arrays from the file and **merges**
  them into the library with fresh ids. Slots, week plan, targets,
  theme, profile and shared items are untouched. See
  [`IMPORT.md`](./IMPORT.md).
- **Copy import prompt** — copies `IMPORT.md` to the clipboard so a
  chat can generate a JSON payload from a natural-language brief.
- **Reset all data** — confirms, then clears localStorage (the sync
  hook also pushes the empty state up).

To move a week plan between accounts, use the in-app **Share** tab,
not JSON import.

## PWA

- `public/manifest.webmanifest` with name, icons (192, 512 PNG + SVG),
  `display: "standalone"`
- `public/sw.js` caches the app shell stale-while-revalidate; only
  intercepts same-origin GETs so Firebase requests pass through
- Versioned cache key (`mealprep-v<n>`) — bump `CACHE_VERSION` in
  `sw.js` on shape-breaking releases so old assets evict. Current
  version: **v4**.

## UI / UX principles

- Mobile-first; ≥ 920 px swaps to desktop chrome (horizontal nav +
  full 7-day grid). Mobile Week is a single-day view (daystrip +
  today card with rings + slot rows).
- Dark mode via `[data-theme="dark"]` on `<html>` (or
  `prefers-color-scheme` when theme is `"auto"`). Switching is
  persisted per user.
- Asymmetric per-macro status thresholds (kcal ±5 %, protein under-
  only, carbs ±15 %, fat over-only; fibre under-only, sugar over-only,
  salt over-only) — only flag what actually matters.
- Keyboard-friendly: tab through inputs, Enter to confirm.
- No flash of unstyled content; render skeleton until state loads.
- Confirm before destructive actions (delete, reset, unshare,
  clear week).
- No analytics, no telemetry; only outbound traffic is Firebase,
  the Open Food Facts API, and Google Fonts.

## File structure

See [`CLAUDE.md`](./CLAUDE.md) for a full annotated tree. Headline
layout:

```
src/
├── main.ts              # entry, router, nav rendering, Alpine + Firebase init
├── types.ts             # all shared types + default slots / categories
├── state.ts             # load/save/import/validate, storage scope, migration
├── store.ts             # Alpine store + snapshot / replace / reseed
├── nutrition.ts         # mealNutrition, dayTotals, weekAverages
├── shopping.ts          # aggregate + unit format + markdown export
├── status.ts            # asymmetric per-macro status() + mealCategory / dotClass
├── theme.ts             # applyTheme(pref) → [data-theme] on <html>
├── api/foodSearch.ts    # Open Food Facts (search + barcode lookup)
├── firebase/            # config, auth, sync, sharing
├── ui/                  # components, authGate, foodSearchPanel,
│                          mealPicker, barcodeScanner (lazy), styles
└── views/               # week, meals, ingredients, shopping, share, settings
```

## Acceptance checklist

- [ ] Sign in with an admin-provisioned account
- [ ] Can add an ingredient and see it in the ingredient list
- [ ] Can create a meal using 2+ ingredients and see calculated
      per-serving nutrition
- [ ] Can add / rename / reorder / remove slots from Settings; removing
      a slot strips it from the week
- [ ] Can assign meals to slots in the weekly grid
- [ ] Daily and weekly totals update live
- [ ] Shopping list aggregates correctly across the week (same
      ingredient in two meals = summed)
- [ ] Changes made on one device appear on a second device within a
      few seconds (Firestore live sync)
- [ ] Sharing an ingredient / meal / plan makes it appear in the Share
      tab; "Add to my library" creates fresh local copies
- [ ] Importing a JSON file merges its ingredients/meals into the
      library and leaves the week plan alone
- [ ] App works offline after first load (PWA)
- [ ] Data survives page reload
- [ ] Mobile layout is usable one-handed

## Future enhancements

- Meal templates / weekly plan presets ("cutting week", "maintenance
  week")
- Cost tracking per ingredient
- Multiple weeks history (would unblock "Duplicate previous week")
- Recipe import from URL
- Search / filter in the Share tab once the public catalogue grows
- Versioning shared items (currently `update` is denied; re-share to
  publish a new version)