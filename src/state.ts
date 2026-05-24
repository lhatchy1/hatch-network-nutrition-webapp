import type { AppState, Ingredient, Meal, MealSlot, ThemePref, WeekPlan } from "./types";
import { DAYS, DEFAULT_SLOTS } from "./types";

// v3 widened `targets` from {kcal, protein} to all four macros and added the
// `theme` preference. The normalise() function below back-fills both for any
// older save it reads — kept indefinitely, no hard cut-over.
const STORAGE_KEY = "mealprep:v3";
const LEGACY_STORAGE_KEYS = ["mealprep:v2", "mealprep:v1"];
const SAVE_DEBOUNCE_MS = 300;

// localStorage key the app should currently read/write. Defaults to the
// signed-out, single-device key; flips to a per-uid key once a user signs in.
let activeKey = STORAGE_KEY;

export function setStorageScope(uid: string | null): void {
  activeKey = uid ? `${STORAGE_KEY}:${uid}` : STORAGE_KEY;
}

// Read a state snapshot from a specific scope without changing the active
// scope. Used by sync.ts to peek at the signed-out localStorage at sign-in
// (so users don't "lose" data they entered before creating an account).
export function loadFromScope(uid: string | null): AppState {
  const key = uid ? `${STORAGE_KEY}:${uid}` : STORAGE_KEY;
  try {
    let raw = localStorage.getItem(key);
    if (!raw && !uid) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacy = localStorage.getItem(legacyKey);
        if (legacy) {
          raw = legacy;
          break;
        }
      }
    }
    if (!raw) return defaultState();
    return normalise(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

// Clears the signed-out scope after its data has been migrated into a
// signed-in account. Stops the same data showing up again on next sign-in.
export function clearSignedOutScope(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    for (const legacyKey of LEGACY_STORAGE_KEYS) localStorage.removeItem(legacyKey);
  } catch {
    /* ignore */
  }
}

export function emptyWeek(slots: MealSlot[] = DEFAULT_SLOTS): WeekPlan {
  const week = {} as WeekPlan;
  for (const { key: day } of DAYS) {
    const slotMap: { [slotId: string]: string | null } = {};
    for (const s of slots) slotMap[s.id] = null;
    week[day] = slotMap;
  }
  return week;
}

export function defaultState(): AppState {
  const slots = DEFAULT_SLOTS.map((s) => ({ ...s }));
  return {
    ingredients: [],
    meals: [],
    slots,
    week: emptyWeek(slots),
    targets: { kcal: 2050, protein: 140, carbs: 220, fat: 70 },
    shoppingChecked: [],
    profile: { displayName: "" },
    theme: "auto",
  };
}

export function load(): AppState {
  try {
    let raw = localStorage.getItem(activeKey);
    // One-shot migration from any older v1/v2 single-blob key.
    if (!raw && activeKey === STORAGE_KEY) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacy = localStorage.getItem(legacyKey);
        if (legacy) {
          raw = legacy;
          try {
            localStorage.removeItem(legacyKey);
          } catch {
            /* ignore */
          }
          break;
        }
      }
    }
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return normalise(parsed);
  } catch {
    return defaultState();
  }
}

// Fills in any missing top-level fields so older saves keep working.
export function normalise(input: unknown): AppState {
  const base = defaultState();
  if (!input || typeof input !== "object") return base;
  const obj = input as Partial<AppState>;
  const slots = Array.isArray(obj.slots) && obj.slots.length > 0
    ? obj.slots.map((s) => ({ id: String(s.id), label: String(s.label) }))
    : base.slots;
  const theme: ThemePref =
    obj.theme === "light" || obj.theme === "dark" || obj.theme === "auto"
      ? obj.theme
      : base.theme;
  return {
    ingredients: Array.isArray(obj.ingredients) ? obj.ingredients : base.ingredients,
    meals: Array.isArray(obj.meals) ? obj.meals.map(stripLegacyMealFields) : base.meals,
    slots,
    week: obj.week && typeof obj.week === "object"
      ? mergeWeek(obj.week as WeekPlan, slots)
      : emptyWeek(slots),
    targets:
      obj.targets && typeof obj.targets === "object"
        ? { ...base.targets, ...obj.targets }
        : base.targets,
    shoppingChecked: Array.isArray(obj.shoppingChecked) ? obj.shoppingChecked : [],
    profile:
      obj.profile && typeof obj.profile === "object"
        ? { displayName: String((obj.profile as UserProfileLike).displayName ?? "") }
        : base.profile,
    theme,
  };
}

interface UserProfileLike {
  displayName?: unknown;
}

// Drop fields removed by past migrations (e.g. `tags`) so saves stay clean.
function stripLegacyMealFields(m: unknown): AppState["meals"][number] {
  const { tags: _tags, ...rest } = (m ?? {}) as Record<string, unknown> & {
    tags?: unknown;
  };
  return rest as unknown as AppState["meals"][number];
}

// Keep slot keys that exist in the slots list; drop keys that don't.
function mergeWeek(week: Partial<WeekPlan>, slots: MealSlot[]): WeekPlan {
  const validIds = new Set(slots.map((s) => s.id));
  const result = emptyWeek(slots);
  for (const { key: day } of DAYS) {
    const incoming = week[day];
    if (!incoming) continue;
    for (const slotId of Object.keys(incoming)) {
      if (!validIds.has(slotId)) continue;
      const v = incoming[slotId];
      if (typeof v === "string" || v === null) result[day][slotId] = v;
    }
  }
  return result;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let onSaveHook: ((state: AppState) => void) | null = null;

// Optional callback invoked on every persisted save — used by the cloud-sync
// layer to mirror the snapshot up to Firestore.
export function setOnSave(hook: ((state: AppState) => void) | null): void {
  onSaveHook = hook;
}

export function save(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(activeKey, JSON.stringify(state));
    } catch (err) {
      console.error("Failed to save state", err);
    }
    if (onSaveHook) {
      try {
        onSaveHook(state);
      } catch (err) {
        console.warn("onSave hook failed", err);
      }
    }
  }, SAVE_DEBOUNCE_MS);
}

export function flushSave(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  localStorage.setItem(activeKey, JSON.stringify(state));
  if (onSaveHook) onSaveHook(state);
}

export function clearStorage(): void {
  localStorage.removeItem(activeKey);
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export interface ImportPayload {
  ingredients: Ingredient[];
  meals: Meal[];
}

// Shape check for imported JSON. Library-only — week plans, slots,
// targets, etc. are user-personal and not transported via this flow
// (use the Share tab for week plans, or re-enter them from Settings).
// Returns null if the payload is shaped wrong or carries nothing useful.
export function validateImport(input: unknown): ImportPayload | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as { ingredients?: unknown; meals?: unknown };
  const ingredients = Array.isArray(obj.ingredients) ? obj.ingredients : [];
  const meals = Array.isArray(obj.meals) ? obj.meals : [];
  if (ingredients.length === 0 && meals.length === 0) return null;

  for (const i of ingredients) {
    if (!i || typeof i !== "object") return null;
    const ing = i as Partial<Ingredient>;
    if (typeof ing.name !== "string" || typeof ing.id !== "string") return null;
  }
  for (const m of meals) {
    if (!m || typeof m !== "object") return null;
    const meal = m as Partial<Meal>;
    if (typeof meal.name !== "string" || typeof meal.id !== "string") return null;
    if (!Array.isArray(meal.ingredients)) return null;
  }
  return { ingredients: ingredients as Ingredient[], meals: meals as Meal[] };
}

// Merge an import payload into the current store. All payload entities
// get fresh IDs so re-importing the same file won't clobber existing
// items; meal→ingredient references are rewritten through the same
// id map. Returns counts so the UI can confirm what happened.
export function mergeImport(
  state: AppState,
  payload: ImportPayload,
): { ingredients: number; meals: number } {
  const idMap = new Map<string, string>();
  const newIngredients: Ingredient[] = [];
  for (const ing of payload.ingredients) {
    const id = uid();
    idMap.set(ing.id, id);
    newIngredients.push({ ...ing, id });
  }
  const newMeals: Meal[] = [];
  for (const m of payload.meals) {
    const id = uid();
    newMeals.push({
      ...m,
      id,
      ingredients: m.ingredients.map((mi) => ({
        ingredientId: idMap.get(mi.ingredientId) ?? mi.ingredientId,
        amount: mi.amount,
      })),
    });
  }
  state.ingredients = [...state.ingredients, ...newIngredients];
  state.meals = [...state.meals, ...newMeals];
  return { ingredients: newIngredients.length, meals: newMeals.length };
}

export function exportFilename(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `mealprep-${y}-${m}-${d}.json`;
}

export type { DayKey, SlotKey } from "./types";
