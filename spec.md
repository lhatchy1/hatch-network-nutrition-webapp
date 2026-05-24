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
- **Pico.css** for default styling (classless CSS, dark mode via
  `prefers-color-scheme`)
- **Firebase** (Auth + Firestore) for accounts, per-user sync, and
  the public sharing collections
- **Open Food Facts** for nutrition lookups (text search + barcode);
  `@zxing/browser` is lazy-loaded for the camera-based barcode scanner
- **localStorage** as offline cache (key `mealprep:v2[:uid]`)
- **PWA**: web manifest + service worker for offline + installable
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
  category: IngredientCategory;
}

interface MealIngredient {
  ingredientId: string;
  amount: number;             // in the ingredient's unit
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

interface AppState {
  ingredients: Ingredient[];
  meals: Meal[];
  slots: MealSlot[];          // ordered; renders week-grid rows top→bottom
  week: WeekPlan;
  targets: { kcal: number; protein: number };
  shoppingChecked: string[];
  profile: UserProfile;
}
```

New accounts get three default slots (`bridge`, `lunch`, `dinner`) so
older saves keep working. Slots are editable from Settings.

**Derived (computed, not stored):**

- `mealNutrition(meal)` → `{ kcal, protein, carbs, fat }` per serving
- `dayTotals(day)` → sum of meal-per-serving nutrition for filled slots
- `shoppingList(week)` → ingredients aggregated across the week’s meals, grouped by category

## Views

Five routes via a hash-router: `#/ingredients`, `#/meals`, `#/week`,
`#/shopping`, `#/share`. (The Share tab is hidden when Firebase is not
configured.)

### 1. Ingredients

- Table: name, unit, kcal/100, protein/100, carbs/100, fat/100, category
- Add via OFF (barcode scan, text search) or fall back to manual entry
- Edit / delete / **Share** rows inline
- Filter by name and category, sort by any column

### 2. Meals

- List view: meal name, ingredient count, kcal/serving, protein/serving
- Detail/edit view:
  - Name, servings, notes
  - Add ingredients: pick from the library, or use **+ Search foods**
    to look up + attach in one step
  - Live-calculated nutrition per serving
- Duplicate / **Share** / Delete actions on each meal
- A shared meal carries its ingredients with it

### 3. Week

- Grid: 7 columns (Mon–Sun), N rows (one per slot in `state.slots`)
- Each cell: dropdown of every meal in the library, or "empty"
- Per-day totals row at bottom: kcal, protein
- Weekly average row, colour-coded vs target
- **Share this week**, "Clear week", and the (deferred) "Duplicate
  previous week" actions

### 4. Shopping list

- Auto-generated from the current week's plan
- Grouped by ingredient category
- Each line: ingredient name + total amount + unit
- Checkbox per line (state persists in `shoppingChecked`)
- Buttons: "Copy as text" (markdown list), "Reset checks"
- Smart unit display: 1500 g → "1.5 kg"; 1200 ml → "1.2 L"

### 5. Share

- Three tabs: Meals (default), Ingredients, Week plans
- Cards show author display name + share date
- "Add to my library" / "Adopt this plan" copies items locally with
  fresh ids (no collisions on re-import)
- "Unshare" appears only on items the current user authored

## Authentication & sync

- **Auth**: Firebase Auth, Email/Password only. No sign-up form. The
  admin provisions accounts in Firebase Console. Firebase Console's
  "Enable create (sign-up)" toggle is off so the SDK can't be used
  to create accounts either.
- **Per-user data**: Firestore at `/users/{uid}/state/main` holds the
  whole `AppState` as a single document.
- **Cache**: localStorage at `mealprep:v2:{uid}` for signed-in users,
  `mealprep:v2` while signed out. The signed-out scope migrates into
  the per-uid scope on first sign-in (with a reconcile prompt if the
  cloud has different data).
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
  library, three default slots, 2050 kcal / 140 g protein targets

## Import / export

- The gear icon opens a Settings modal with:
  - **Account** (signed-in only) — email, display name, sign-out
  - **Daily targets** — kcal and protein
  - **Meal slots** — add / rename / reorder / remove
  - **Export JSON** — downloads `mealprep-YYYY-MM-DD.json` (full
    snapshot, used for backups)
  - **Import ingredients & meals…** — file picker; reads the
    `ingredients` and `meals` arrays from the file and **merges**
    them into the library with fresh ids. Slots, week plan,
    targets, profile and shared items are untouched. See
    [`IMPORT.md`](./IMPORT.md).
  - **Copy import prompt** — copies `IMPORT.md` to the clipboard
    so a chat can generate a JSON payload from a natural-language
    brief
  - **Reset all data** — confirms, then clears localStorage (the
    sync hook also pushes the empty state up)

To move a week plan between accounts, use the in-app **Share** tab,
not JSON import.

## PWA

- `public/manifest.webmanifest` with name, icons (192, 512 PNG + SVG),
  `display: "standalone"`
- `public/sw.js` caches the app shell stale-while-revalidate; only
  intercepts same-origin GETs so Firebase requests pass through
- Versioned cache key (`mealprep-v<n>`) — bump `CACHE_VERSION` in
  `sw.js` on shape-breaking releases so old assets evict. Current
  version: **v3**.

## UI / UX principles

- Mobile-first; week grid scrolls horizontally on narrow screens
- Dark mode via `prefers-color-scheme` (Pico.css handles this)
- Keyboard-friendly: tab through inputs, Enter to confirm
- No flash of unstyled content; render skeleton until state loads
- Confirm before destructive actions (delete, reset, unshare)
- No analytics, no telemetry; only outbound traffic is Firebase and
  the Open Food Facts API

## File structure

See [`CLAUDE.md`](./CLAUDE.md) for a full annotated tree. Headline
layout:

```
src/
├── main.ts              # entry, router, Alpine + Firebase init
├── types.ts             # all shared types + default slots / categories
├── state.ts             # load/save/import/validate, storage scope
├── store.ts             # Alpine store + snapshot / replace / reseed
├── nutrition.ts         # mealNutrition, dayTotals, weekAverages
├── shopping.ts          # aggregate + unit format + markdown export
├── api/foodSearch.ts    # Open Food Facts (search + barcode lookup)
├── firebase/            # config, auth, sync, sharing
├── ui/                  # components, authGate, foodSearchPanel,
│                          barcodeScanner (lazy), styles
└── views/               # ingredients, meals, week, shopping, share,
                           settings
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