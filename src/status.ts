// Macro status logic — asymmetric per-macro thresholds. See the design
// brief for the rationale; the gist:
//   kcal     symmetric ±5%
//   protein  under-only  (overshooting is fine)
//   carbs    symmetric ±15%
//   fat      over-only   (undershooting is fine)
//   fibre    under-only  (more is better)
//   sugar    over-only   (less is better)
//   salt     over-only   (less is better)
//
// Status keys map to .v-under / .v-near / .v-over classes via setStatusClass.

import type { IngredientCategory, Ingredient, Meal } from "./types";

export type StatusKey = "under" | "near" | "over";
export type MacroKey =
  | "kcal"
  | "p"
  | "protein"
  | "c"
  | "carbs"
  | "f"
  | "fat"
  | "fibre"
  | "sugar"
  | "salt";

export function status(macro: MacroKey, value: number, target: number): StatusKey {
  if (!target) return "near";
  const r = value / target;
  switch (macro) {
    case "kcal":
      if (r < 0.95) return "under";
      if (r > 1.05) return "over";
      return "near";
    case "p":
    case "protein":
      return r < 0.95 ? "under" : "near";
    case "c":
    case "carbs":
      if (r < 0.85) return "under";
      if (r > 1.15) return "over";
      return "near";
    case "f":
    case "fat":
      return r > 1.10 ? "over" : "near";
    case "fibre":
      return r < 0.95 ? "under" : "near";
    case "sugar":
    case "salt":
      return r > 1.10 ? "over" : "near";
  }
  return "near";
}

export function statusClass(key: StatusKey): string {
  return "v-" + key;
}

export function setStatusClass(el: Element, key: StatusKey | null): void {
  el.classList.remove("v-under", "v-near", "v-over");
  if (key) el.classList.add(statusClass(key));
}

// Dominant ingredient category for a meal. Mirrors the brief's mealCategory.
export function mealCategory(meal: Meal, ingredients: Ingredient[]): IngredientCategory {
  const first = meal.ingredients[0];
  if (!first) return "Pantry";
  const ing = ingredients.find((i) => i.id === first.ingredientId);
  return ing?.category ?? "Pantry";
}

export function dotClass(category: IngredientCategory): string {
  return "dot dot-" + category.toLowerCase();
}
