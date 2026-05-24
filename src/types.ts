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

export interface Meal {
  id: string;
  name: string;
  servings: number;
  ingredients: MealIngredient[];
  notes?: string;
}

export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

// Slot keys are user-defined strings (the slot's id).
export type SlotKey = string;

export interface MealSlot {
  id: SlotKey;
  label: string;
}

export const DAYS: { key: DayKey; label: string }[] = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
];

// Default slots preserve the historical bridge/lunch/dinner ids so older
// saved week plans keep their meal assignments after the slots became
// user-configurable.
export const DEFAULT_SLOTS: MealSlot[] = [
  { id: "bridge", label: "Bridge" },
  { id: "lunch", label: "Lunch" },
  { id: "dinner", label: "Dinner" },
];

export type WeekPlan = {
  [D in DayKey]: { [slotId: string]: string | null };
};

export interface Targets {
  kcal: number;
  protein: number;
}

export interface UserProfile {
  displayName: string;
}

export interface AppState {
  ingredients: Ingredient[];
  meals: Meal[];
  slots: MealSlot[];
  week: WeekPlan;
  targets: Targets;
  shoppingChecked: string[];
  profile: UserProfile;
}

export interface Nutrition {
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}
