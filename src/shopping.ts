import type { AppState, IngredientCategory, Unit } from "./types";
import { DAYS, INGREDIENT_CATEGORIES } from "./types";
import { consumedNativeAmount } from "./nutrition";

export interface ShoppingLine {
  ingredientId: string;
  name: string;
  amount: number;
  unit: Unit;
  category: IngredientCategory;
}

export type ShoppingGroups = { category: IngredientCategory; lines: ShoppingLine[] }[];

export function aggregateShopping(state: AppState): ShoppingGroups {
  const totals = new Map<string, number>();
  const ingredientById = new Map(state.ingredients.map((i) => [i.id, i] as const));
  for (const { key: day } of DAYS) {
    for (const slot of state.slots) {
      const mealId = state.week[day][slot.id];
      if (!mealId) continue;
      const meal = state.meals.find((m) => m.id === mealId);
      if (!meal) continue;
      for (const mi of meal.ingredients) {
        const ing = ingredientById.get(mi.ingredientId);
        // Aggregate in the ingredient's native unit so g/ml overrides
        // collapse into one shopping line via density conversion.
        const qty = ing ? consumedNativeAmount(ing, mi) : mi.amount;
        totals.set(mi.ingredientId, (totals.get(mi.ingredientId) ?? 0) + qty);
      }
    }
  }

  const byCategory = new Map<IngredientCategory, ShoppingLine[]>();
  for (const [id, amount] of totals) {
    const ing = state.ingredients.find((i) => i.id === id);
    if (!ing) continue;
    const line: ShoppingLine = {
      ingredientId: id,
      name: ing.name,
      amount,
      unit: ing.unit,
      category: ing.category,
    };
    const arr = byCategory.get(ing.category) ?? [];
    arr.push(line);
    byCategory.set(ing.category, arr);
  }

  const groups: ShoppingGroups = [];
  for (const cat of INGREDIENT_CATEGORIES) {
    const lines = byCategory.get(cat);
    if (!lines || lines.length === 0) continue;
    lines.sort((a, b) => a.name.localeCompare(b.name));
    groups.push({ category: cat, lines });
  }
  return groups;
}

// 1500 g → "1.5 kg", 1200 ml → "1.2 L", 3 unit → "3"
export function formatAmount(amount: number, unit: Unit): string {
  if (unit === "g") {
    return amount >= 1000
      ? `${trim(amount / 1000)} kg`
      : `${trim(amount)} g`;
  }
  if (unit === "ml") {
    return amount >= 1000
      ? `${trim(amount / 1000)} L`
      : `${trim(amount)} ml`;
  }
  return trim(amount);
}

function trim(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toString();
}

export function shoppingAsMarkdown(groups: ShoppingGroups): string {
  const lines: string[] = ["# Shopping list", ""];
  for (const g of groups) {
    lines.push(`## ${g.category}`);
    for (const l of g.lines) {
      lines.push(`- [ ] ${l.name} — ${formatAmount(l.amount, l.unit)}`);
    }
    lines.push("");
  }
  return lines.join("\n").trim() + "\n";
}
