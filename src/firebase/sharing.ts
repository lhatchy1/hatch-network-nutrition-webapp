import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import type { AppState, Ingredient, Meal, MealSlot, WeekPlan } from "../types";
import { getDb } from "./config";
import { currentUser } from "./auth";

export type ShareKind = "ingredient" | "meal" | "plan";

// What the public collections actually store. The payload deep-copies any
// referenced data so importers don't need to already have those ingredients.
export interface SharedIngredient {
  id?: string;
  authorUid: string;
  authorName: string;
  sharedAt: number;
  ingredient: Ingredient;
}

export interface SharedMeal {
  id?: string;
  authorUid: string;
  authorName: string;
  sharedAt: number;
  meal: Meal;
  ingredients: Ingredient[];
}

export interface SharedPlan {
  id?: string;
  authorUid: string;
  authorName: string;
  sharedAt: number;
  name: string;
  slots: MealSlot[];
  week: WeekPlan;
  meals: Meal[];
  ingredients: Ingredient[];
}

const COLLECTIONS: Record<ShareKind, string> = {
  ingredient: "shared_ingredients",
  meal: "shared_meals",
  plan: "shared_plans",
};

export function isSignedIn(): boolean {
  return currentUser() !== null;
}

function authorOrThrow(state: AppState): { authorUid: string; authorName: string } {
  const user = currentUser();
  if (!user) throw new Error("Sign in to share.");
  return {
    authorUid: user.uid,
    authorName: state.profile.displayName || user.email || "Someone",
  };
}

export async function shareIngredient(state: AppState, ing: Ingredient): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Firebase isn't configured.");
  const { authorUid, authorName } = authorOrThrow(state);
  await addDoc(collection(db, COLLECTIONS.ingredient), {
    authorUid,
    authorName,
    sharedAt: Date.now(),
    createdAt: serverTimestamp(),
    ingredient: stripIds([ing])[0],
  });
}

export async function shareMeal(state: AppState, meal: Meal): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Firebase isn't configured.");
  const { authorUid, authorName } = authorOrThrow(state);
  const used = state.ingredients.filter((i) =>
    meal.ingredients.some((mi) => mi.ingredientId === i.id),
  );
  await addDoc(collection(db, COLLECTIONS.meal), {
    authorUid,
    authorName,
    sharedAt: Date.now(),
    createdAt: serverTimestamp(),
    meal: JSON.parse(JSON.stringify(meal)),
    ingredients: JSON.parse(JSON.stringify(used)),
  });
}

export async function shareWeekPlan(state: AppState, name?: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Firebase isn't configured.");
  const { authorUid, authorName } = authorOrThrow(state);

  // Walk the week plan to find every meal referenced and every ingredient
  // those meals use. Snapshot the lot so importers can adopt the plan even
  // when their own library has none of these items.
  const mealIds = new Set<string>();
  for (const day of Object.values(state.week)) {
    for (const v of Object.values(day)) if (v) mealIds.add(v);
  }
  const meals = state.meals.filter((m) => mealIds.has(m.id));
  const ingIds = new Set<string>();
  for (const m of meals) for (const mi of m.ingredients) ingIds.add(mi.ingredientId);
  const ingredients = state.ingredients.filter((i) => ingIds.has(i.id));

  await addDoc(collection(db, COLLECTIONS.plan), {
    authorUid,
    authorName,
    sharedAt: Date.now(),
    createdAt: serverTimestamp(),
    name: name || `${authorName}'s week plan`,
    slots: JSON.parse(JSON.stringify(state.slots)),
    week: JSON.parse(JSON.stringify(state.week)),
    meals: JSON.parse(JSON.stringify(meals)),
    ingredients: JSON.parse(JSON.stringify(ingredients)),
  });
}

function stripIds(arr: Ingredient[]): Ingredient[] {
  // We keep the IDs (callers re-id on import), but deep-clone via JSON.
  return JSON.parse(JSON.stringify(arr));
}

export async function listShared<K extends ShareKind>(
  kind: K,
): Promise<
  K extends "ingredient" ? SharedIngredient[]
  : K extends "meal" ? SharedMeal[]
  : SharedPlan[]
> {
  const db = getDb();
  if (!db) return [] as never;
  const q = query(collection(db, COLLECTIONS[kind]), orderBy("sharedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })) as never;
}

export async function deleteShared(kind: ShareKind, id: string): Promise<void> {
  const db = getDb();
  if (!db) throw new Error("Firebase isn't configured.");
  await deleteDoc(doc(db, COLLECTIONS[kind], id));
}
