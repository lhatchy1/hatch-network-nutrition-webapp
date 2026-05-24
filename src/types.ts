export type Unit = "g" | "ml" | "unit";

export type IngredientCategory =
  | "Protein"
  | "Carbs"
  | "Produce"
  | "Dairy"
  | "Pantry"
  | "Other";

export const INGREDIENT_CATEGORIES: IngredientCategory[] = [
  "Protein",
  "Carbs",
  "Produce",
  "Dairy",
  "Pantry",
  "Other",
];

export interface Ingredient {
  id: string;
  name: string;
  unit: Unit;
  kcalPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  category: IngredientCategory;
}

export interface MealIngredient {
  ingredientId: string;
  amount: number;
}

export type MealTag = "lunch" | "dinner" | "bridge" | "snack";

export const MEAL_TAGS: MealTag[] = ["bridge", "lunch", "dinner", "snack"];

export interface Meal {
  id: string;
  name: string;
  servings: number;
  ingredients: MealIngredient[];
  tags: MealTag[];
  notes?: string;
}

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type SlotKey = "bridge" | "lunch" | "dinner";

export const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

export const SLOTS: { key: SlotKey; label: string }[] = [
  { key: "bridge", label: "Bridge" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
];

export type WeekPlan = {
  [D in DayKey]: { [S in SlotKey]: string | null };
};

export interface Targets {
  kcal: number;
  protein: number;
}

export interface AppState {
  ingredients: Ingredient[];
  meals: Meal[];
  week: WeekPlan;
  targets: Targets;
  shoppingChecked: string[];
}

export interface Nutrition {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}
