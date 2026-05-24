import type {
  AppState,
  DayKey,
  Ingredient,
  Meal,
  Nutrition,
  SlotKey,
} from "./types";
import { DAYS } from "./types";

const EMPTY: Nutrition = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

function ingredientLookup(ingredients: Ingredient[]): Map<string, Ingredient> {
  const map = new Map<string, Ingredient>();
  for (const i of ingredients) map.set(i.id, i);
  return map;
}

// "g" and "ml" ingredients store nutrition per 100; "unit" stores nutrition per single unit.
function scaleFactor(ingredient: Ingredient, amount: number): number {
  return ingredient.unit === "unit" ? amount : amount / 100;
}

export function mealNutrition(meal: Meal, ingredients: Ingredient[]): Nutrition {
  const lookup = ingredientLookup(ingredients);
  const total = { ...EMPTY };
  for (const mi of meal.ingredients) {
    const ing = lookup.get(mi.ingredientId);
    if (!ing) continue;
    const f = scaleFactor(ing, mi.amount);
    total.kcal += ing.kcalPer100 * f;
    total.protein += ing.proteinPer100 * f;
    total.carbs += ing.carbsPer100 * f;
    total.fat += ing.fatPer100 * f;
  }
  const servings = Math.max(1, meal.servings || 1);
  return {
    kcal: total.kcal / servings,
    protein: total.protein / servings,
    carbs: total.carbs / servings,
    fat: total.fat / servings,
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
  }
  return {
    kcal: sum.kcal / DAYS.length,
    protein: sum.protein / DAYS.length,
    carbs: sum.carbs / DAYS.length,
    fat: sum.fat / DAYS.length,
  };
}

export function fmtMacro(n: number): string {
  return Math.round(n).toString();
}

export type { DayKey, SlotKey };
