# Meal Prep Planner — Spec

A lightweight, single-user web app for planning weekly meals, tracking nutrition, and generating shopping lists.

## Goals & non-goals

**Goals**

- Single-page web app, fully client-side, no backend
- Build a library of reusable ingredients and meals
- Plan a week (lunch + dinner per day) and see daily nutrition totals
- Auto-generate a shopping list from the weekly plan
- Persist everything locally; export/import as JSON for backup or sync
- Mobile-friendly (will mostly be used on a phone in the kitchen)
- Installable as a PWA (offline-capable)

**Non-goals**

- No user accounts, auth, or multi-user support
- No backend, database, or cloud sync (export/import covers this)
- No recipe scraping, barcode scanning, or external nutrition APIs (manual entry only, for now)
- No calorie tracking against actual consumption — this is a *planning* tool, not a food diary

## Stack

- **Vite + TypeScript**, vanilla — no React, Vue, Svelte, etc.
- **Alpine.js** (~15 KB) for reactivity
- **Pico.css** for default styling (classless, built-in dark mode, ~10 KB gzipped)
- **localStorage** for persistence
- **PWA**: web manifest + service worker for offline + installable
- **Deploy**: GitHub Pages via GitHub Actions (`actions/deploy-pages@v4`); main triggers a build & deploy. Vite `base` is `/hatch-network-nutrition-webapp/` to match the repo subpath.
- No hard bundle-size budget — favour clarity and small deps, but no obsessive byte-counting

## Data model

```ts
interface Ingredient {
  id: string;                 // uuid or slug
  name: string;               // "Chicken thigh, raw"
  unit: "g" | "ml" | "unit";  // base unit for amounts
  kcalPer100: number;         // per 100g/ml, or per 1 unit if unit==="unit"
  proteinPer100: number;      // grams
  carbsPer100: number;        // grams
  fatPer100: number;          // grams
  category?: string;          // "Protein" | "Carbs" | "Produce" | "Dairy" | "Pantry"
}

interface MealIngredient {
  ingredientId: string;
  amount: number;             // in the ingredient's unit
}

interface Meal {
  id: string;
  name: string;
  servings: number;           // recipe yields this many servings
  ingredients: MealIngredient[];
  tags: ("lunch" | "dinner" | "bridge" | "snack")[];
  notes?: string;             // optional prep notes
}

type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type SlotKey = "bridge" | "lunch" | "dinner";

interface WeekPlan {
  // mealId reference, or null if slot is empty
  [day in DayKey]: { [slot in SlotKey]: string | null };
}

interface AppState {
  ingredients: Ingredient[];
  meals: Meal[];
  week: WeekPlan;
  targets: {
    kcal: number;             // e.g., 2050
    protein: number;          // e.g., 140
  };
  shoppingChecked: string[];  // ingredientIds currently checked off
}
```

**Derived (computed, not stored):**

- `mealNutrition(meal)` → `{ kcal, protein, carbs, fat }` per serving
- `dayTotals(day)` → sum of meal-per-serving nutrition for filled slots
- `shoppingList(week)` → ingredients aggregated across the week’s meals, grouped by category

## Views

The app has 4 main views. Use tabs or a simple hash-router (`#/ingredients`, `#/meals`, etc.).

### 1. Ingredients

- Table: name, unit, kcal/100, protein/100, carbs/100, fat/100, category
- Add / edit / delete rows inline or via a small modal
- Search/filter by name and category
- Sort by any column

### 2. Meals

- List view: meal name, tags, kcal/serving, protein/serving
- Detail/edit view:
  - Name, servings, tags, notes
  - Add ingredients: pick from ingredient library + enter amount
  - Live-calculated nutrition per serving
- “Duplicate meal” button (handy for variants)
- Delete with confirmation

### 3. Week

- Grid: 7 columns (Mon–Sun), 3 rows (bridge, lunch, dinner)
- Each cell: dropdown of meals (filtered by tag) or “empty”
- Per-day totals row at bottom: kcal, protein
- Weekly average row, with colour-coded deficit/surplus vs target
- “Clear week” and “Duplicate previous week” actions

### 4. Shopping list

- Auto-generated from the current week’s plan
- Grouped by ingredient category
- Each line: ingredient name + total amount + unit
- Checkbox per line (state persists in `shoppingChecked`)
- Buttons: “Copy as text” (markdown list), “Reset checks”
- Smart unit display: 1500 g → “1.5 kg”; 1200 ml → “1.2 L”

## Persistence

- Entire `AppState` serialised to `localStorage` under a single key (e.g., `mealprep:v1`)
- Save on every mutation (debounce ~300 ms)
- On load: if key missing, initialise with empty state and default targets

## Import / export

- A gear icon in the header opens a Settings modal containing:
  - **Export JSON** — downloads `mealprep-YYYY-MM-DD.json`
  - **Import JSON** — file picker; validates shape, confirms before overwriting
  - **Reset all data** — confirms, then clears localStorage
  - **Edit targets** — kcal and protein
- This is the de facto sync mechanism between devices (drop the file in iCloud/Drive)

## PWA

- `manifest.webmanifest` with name, icons (192, 512), `display: "standalone"`
- Service worker caches the app shell for offline use
- Versioned cache so updates roll out cleanly

## UI / UX principles

- Mobile-first; week grid scrolls horizontally on narrow screens, or stacks per day
- Dark mode via `prefers-color-scheme` (Pico.css handles this)
- Keyboard-friendly: tab through inputs, Enter to confirm
- No flash of unstyled content; render skeleton until state loads
- Confirm before destructive actions (delete, reset)
- No analytics, no telemetry, no external requests once loaded

## File structure (suggested)

```
/
├── index.html
├── manifest.webmanifest
├── sw.js
├── src/
│   ├── main.ts           # entry, router, state init
│   ├── state.ts          # AppState, load/save, mutations
│   ├── nutrition.ts      # mealNutrition, dayTotals, weekTotals
│   ├── shopping.ts       # shoppingList aggregation + unit formatting
│   ├── views/
│   │   ├── ingredients.ts
│   │   ├── meals.ts
│   │   ├── week.ts
│   │   └── shopping.ts
│   └── ui/
│       ├── components.ts # small render helpers
│       └── styles.css
├── public/
│   └── icons/            # PWA icons
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## Acceptance checklist

- [ ] Can add an ingredient and see it in the ingredient list
- [ ] Can create a meal using 2+ ingredients and see calculated per-serving nutrition
- [ ] Can assign meals to slots in the weekly grid
- [ ] Daily and weekly totals update live
- [ ] Shopping list aggregates correctly across the week (same ingredient in two meals = summed)
- [ ] Export produces a valid JSON file; import restores state
- [ ] App works offline after first load (PWA)
- [ ] Data survives page reload
- [ ] Mobile layout is usable one-handed

## Future enhancements (out of scope for v1)

- Meal templates / weekly plan presets (“cutting week”, “maintenance week”)
- Cost tracking per ingredient
- Multiple weeks history
- Recipe import from URL
- User accounts and respective data synced using firebase instance