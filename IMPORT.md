# Importing into Hatch · Food planner

The Settings → **Import library JSON** flow accepts a JSON file
containing ingredients and meals and **merges them into your
library**. Your meal slots, week plan, daily macro targets, theme,
display name and shared items are not touched. Importing is
non-destructive: every imported item is given a fresh id, so
re-importing the same file won't overwrite anything you already have.

> To share a **week plan** (slots + assignments) between accounts, use
> the in-app **Share** tab instead. JSON import is for seeding the
> library with ingredients and meals only.

There is a **Copy import prompt** button in the Settings modal that
copies this document to your clipboard. Hand it (whole) to a chat,
describe the ingredients and meals you want, paste the JSON it returns
into a `.json` file, then Import it.

---

## Schema

The importer expects a single JSON object with `ingredients` and/or
`meals` arrays. At least one of them must be non-empty. Anything else
in the file (e.g. `week`, `slots`, `targets`) is ignored.

```ts
type Unit = "g" | "ml" | "unit";

type IngredientCategory =
  | "Protein" | "Carbs" | "Produce" | "Dairy" | "Pantry" | "Other";

interface Ingredient {
  id: string;             // any unique string within this file (UUID recommended)
  name: string;
  unit: Unit;
  kcalPer100: number;     // per 100 g / 100 ml for "g"/"ml" units;
  proteinPer100: number;  // per 1 item for "unit" ingredients
  carbsPer100: number;    // (despite the field name)
  fatPer100: number;      // grams of each macro
  fibrePer100: number;    // grams; optional in older files (back-fills to 0)
  sugarPer100: number;    // grams; subset of carbohydrate
  saltPer100: number;     // grams; not sodium — multiply sodium by 2.5
  category: IngredientCategory;
  densityGPerMl?: number; // grams per ml; only meaningful for "g"/"ml";
                          // optional, defaults to 1 (water). Use ~0.92 for
                          // oils, ~1.4 for honey, etc. Used to convert
                          // when a meal-line measures the ingredient in
                          // the other unit.
}

interface MealIngredient {
  ingredientId: string;   // MUST match an Ingredient.id above
  amount: number;         // in `unit` below (or the ingredient's native
                          // unit when `unit` is omitted)
  unit?: "g" | "ml";      // optional override; only valid when the parent
                          // ingredient is a "g"/"ml" type. When set and
                          // different from the ingredient's unit, the
                          // amount is converted via density.
}

interface Meal {
  id: string;             // any unique string within this file
  name: string;
  servings: number;       // >= 1; nutrition is divided by this
  ingredients: MealIngredient[];
  notes?: string;         // optional prep notes
}

interface ImportPayload {
  ingredients?: Ingredient[];
  meals?: Meal[];
}
```

## Hard rules

- Every `MealIngredient.ingredientId` must reference an `Ingredient.id`
  inside the same file (the importer remaps these ids to fresh ones at
  import time).
- IDs in the file must be unique within the file. They do **not** need
  to match anything in the existing library — the importer always
  assigns fresh ids.
- Macros are **per 100** for `g`/`ml` ingredients, **per single item**
  for `unit` ingredients (e.g. an egg or a slice of bread).
- `fibrePer100`, `sugarPer100`, `saltPer100` are optional in files
  produced before v4. Missing fields back-fill to `0` on import, so old
  exports still load — but the four-macro view will be the only useful
  signal until you refill the values.
- `densityGPerMl` is optional and defaults to `1` (water-equivalent).
  Only set it when you actually know the density — e.g. olive oil
  ≈ 0.92, honey ≈ 1.4, ethanol ≈ 0.79. It only does anything when a
  meal-line carries a `unit` override that differs from the ingredient's
  native unit.

## Minimal valid example

```json
{
  "ingredients": [
    { "id": "ing-chicken", "name": "Chicken thigh, raw",
      "unit": "g", "kcalPer100": 209, "proteinPer100": 17,
      "carbsPer100": 0, "fatPer100": 15,
      "fibrePer100": 0, "sugarPer100": 0, "saltPer100": 0.2,
      "category": "Protein" },
    { "id": "ing-rice", "name": "Basmati rice, dry",
      "unit": "g", "kcalPer100": 360, "proteinPer100": 8,
      "carbsPer100": 78, "fatPer100": 1,
      "fibrePer100": 1.4, "sugarPer100": 0.1, "saltPer100": 0,
      "category": "Carbs" }
  ],
  "meals": [
    { "id": "meal-chicken-rice", "name": "Chicken & rice",
      "servings": 2,
      "ingredients": [
        { "ingredientId": "ing-chicken", "amount": 400 },
        { "ingredientId": "ing-rice",    "amount": 200 }
      ],
      "notes": "Pan-fry chicken, simmer rice."
    }
  ]
}
```

## Ingredients-only / meals-only files

Both arrays are optional, but at least one must be non-empty. A
"recipes only" file:

```json
{ "meals": [ /* ... */ ] }
```

is fine, as long as every `ingredientId` it references also appears in
an `ingredients` array in the same file. If the meals reference
ingredients you've already added to your library, you'll need to
include those ingredients in the file too — the importer doesn't
match-by-name against your existing library.

## File details

- Exports include the full app state (slots, week, targets, theme,
  profile), but the importer only reads the `ingredients` and `meals`
  arrays. Use export for backups; use import for seeding new content.
- Exported filename: `mealprep-YYYY-MM-DD.json`.
- `localStorage` key: `mealprep:v5` (or `mealprep:v5:{uid}` when
  signed in). Older `v1` … `v4` keys auto-migrate on first load.
