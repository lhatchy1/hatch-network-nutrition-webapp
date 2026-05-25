import type {
  AppState,
  DayKey,
  Ingredient,
  Meal,
  Nutrition,
  SlotKey,
} from "./types";
import { DAYS } from "./types";

const EMPTY: Nutrition = {
  kcal: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  fibre: 0,
  sugar: 0,
  salt: 0,
};

function ingredientLookup(ingredients: Ingredient[]): Map<string, Ingredient> {
  const map = new Map<string, Ingredient>();
  for (const i of ingredients) map.set(i.id, i);
  return map;
}

// "g" and "ml" ingredients store nutrition per 100; "unit" stores nutrition per single unit.
function scaleFactor(ingredient: Ingredient, amount: number): number {
  return ingredient.unit === "unit" ? amount : amount / 100;
}

// `?? 0` on each per-100 field defends against ingredients adopted from
// shared docs or older JSON imports that haven't been through normalise().
export function mealNutrition(meal: Meal, ingredients: Ingredient[]): Nutrition {
  const lookup = ingredientLookup(ingredients);
  const total = { ...EMPTY };
  for (const mi of meal.ingredients) {
    const ing = lookup.get(mi.ingredientId);
    if (!ing) continue;
    const f = scaleFactor(ing, mi.amount);
    total.kcal += (ing.kcalPer100 ?? 0) * f;
    total.protein += (ing.proteinPer100 ?? 0) * f;
    total.carbs += (ing.carbsPer100 ?? 0) * f;
    total.fat += (ing.fatPer100 ?? 0) * f;
    total.fibre += (ing.fibrePer100 ?? 0) * f;
    total.sugar += (ing.sugarPer100 ?? 0) * f;
    total.salt += (ing.saltPer100 ?? 0) * f;
  }
  const servings = Math.max(1, meal.servings || 1);
  return {
    kcal: total.kcal / servings,
    protein: total.protein / servings,
    carbs: total.carbs / servings,
    fat: total.fat / servings,
    fibre: total.fibre / servings,
    sugar: total.sugar / servings,
    salt: total.salt / servings,
  };
}

export function dayTotals(state: AppState, day: DayKey): Nutrition {
  const total = { ...EMPTY };
  for (const slot of state.slots) {
    const mealId = state.week[day][slot.id];
    if (!mealId) continue;
    const meal = state.meals.find((m) => m.id === mealId);
    if (!meal) continue;
    const n = mealNutrition(meal, state.ingredients);
    total.kcal += n.kcal;
    total.protein += n.protein;
    total.carbs += n.carbs;
    total.fat += n.fat;
    total.fibre += n.fibre;
    total.sugar += n.sugar;
    total.salt += n.salt;
  }
  return total;
}

export function weekAverages(state: AppState): Nutrition {
  const sum = { ...EMPTY };
  for (const { key } of DAYS) {
    const d = dayTotals(state, key);
    sum.kcal += d.kcal;
    sum.protein += d.protein;
    sum.carbs += d.carbs;
    sum.fat += d.fat;
    sum.fibre += d.fibre;
    sum.sugar += d.sugar;
    sum.salt += d.salt;
  }
  return {
    kcal: sum.kcal / DAYS.length,
    protein: sum.protein / DAYS.length,
    carbs: sum.carbs / DAYS.length,
    fat: sum.fat / DAYS.length,
    fibre: sum.fibre / DAYS.length,
    sugar: sum.sugar / DAYS.length,
    salt: sum.salt / DAYS.length,
  };
}

export function fmtMacro(n: number): string {
  return Math.round(n).toString();
}

// Salt is reported in fractional grams (e.g. 0.8 g) so we keep one
// decimal — rounding to 0 would visually collapse meaningful values.
export function fmtSalt(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

export type { DayKey, SlotKey };
