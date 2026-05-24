# Importing data into Meal Prep Planner

The Settings → **Import JSON** flow accepts a single file matching the
schema below. Importing **overwrites all current data** (ingredients,
meals, week plan, targets, and shopping-list checks).

Hand this whole document to a chat (or to yourself) and ask for a JSON
file that matches — paste the result into a `.json` file and import it.

There is a **Copy import prompt** button in the Settings modal that
copies this document to your clipboard for exactly that purpose.

---

## Schema

The import expects a single JSON object matching this TypeScript shape
exactly. Field names, casing, and types must match.

```ts
type Unit = "g" | "ml" | "unit";

type IngredientCategory =
  | "Protein" | "Carbs" | "Produce" | "Dairy" | "Pantry" | "Other";

interface Ingredient {
  id: string;             // any unique string; UUID recommended
  name: string;
  unit: Unit;
  kcalPer100: number;     // per 100 g / 100 ml for "g"/"ml" units;
  proteinPer100: number;  // per 1 item for "unit" ingredients
  carbsPer100: number;    // (despite the field name)
  fatPer100: number;      // grams of each macro
  category: IngredientCategory;
}

interface MealIngredient {
  ingredientId: string;   // MUST match an Ingredient.id above
  amount: number;         // in the ingredient's unit (g, ml, or count)
}

type MealTag = "bridge" | "lunch" | "dinner" | "snack";

interface Meal {
  id: string;
  name: string;
  servings: number;       // >= 1; nutrition is divided by this
  ingredients: MealIngredient[];
  tags: MealTag[];        // controls which week-slot dropdowns list it
  notes?: string;
}

type DayKey  = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
type SlotKey = "bridge" | "lunch" | "dinner";

// All 7 days and all 3 slots must be present.
type WeekPlan = {
  [D in DayKey]: { [S in SlotKey]: string | null };  // meal.id or null
};

interface AppState {
  ingredients: Ingredient[];
  meals: Meal[];
  week: WeekPlan;
  targets: { kcal: number; protein: number };  // daily targets
  shoppingChecked: string[];                    // ingredient ids ticked off
}
```

## Hard rules

- Every `MealIngredient.ingredientId` must reference an existing
  `Ingredient.id`.
- Every non-null value in `week` must reference an existing `Meal.id`.
- A meal only appears in a week slot's dropdown if its `tags` include
  that slot — i.e. assign `"bridge"`, `"lunch"`, or `"dinner"` to meals
  you want to use in those slots.
- `WeekPlan` must include all 7 days and all 3 slots; use `null` for
  empty slots.
- Macros are **per 100** for `g`/`ml` ingredients, **per single item**
  for `unit` ingredients (e.g. an egg or a slice of bread).

## Minimal valid example

```json
{
  "ingredients": [
    { "id": "ing-chicken", "name": "Chicken thigh, raw",
      "unit": "g", "kcalPer100": 209, "proteinPer100": 17,
      "carbsPer100": 0, "fatPer100": 15, "category": "Protein" },
    { "id": "ing-rice", "name": "Basmati rice, dry",
      "unit": "g", "kcalPer100": 360, "proteinPer100": 8,
      "carbsPer100": 78, "fatPer100": 1, "category": "Carbs" }
  ],
  "meals": [
    { "id": "meal-chicken-rice", "name": "Chicken & rice",
      "servings": 2, "tags": ["lunch", "dinner"],
      "ingredients": [
        { "ingredientId": "ing-chicken", "amount": 400 },
        { "ingredientId": "ing-rice",    "amount": 200 }
      ],
      "notes": "Pan-fry chicken, simmer rice."
    }
  ],
  "week": {
    "mon": { "bridge": null, "lunch": "meal-chicken-rice", "dinner": null },
    "tue": { "bridge": null, "lunch": null, "dinner": "meal-chicken-rice" },
    "wed": { "bridge": null, "lunch": null, "dinner": null },
    "thu": { "bridge": null, "lunch": null, "dinner": null },
    "fri": { "bridge": null, "lunch": null, "dinner": null },
    "sat": { "bridge": null, "lunch": null, "dinner": null },
    "sun": { "bridge": null, "lunch": null, "dinner": null }
  },
  "targets": { "kcal": 2050, "protein": 140 },
  "shoppingChecked": []
}
```

## File details

- Filename when exported: `mealprep-YYYY-MM-DD.json`
- `localStorage` key: `mealprep:v1`
- The import flow validates the top-level shape, normalises missing
  optional fields, and then overwrites the current state on confirm.
