import type { AppState, DayKey, SlotKey, WeekPlan } from "./types";
import { DAYS, SLOTS } from "./types";

const STORAGE_KEY = "mealprep:v1";
const SAVE_DEBOUNCE_MS = 300;

export function emptyWeek(): WeekPlan {
  const week = {} as WeekPlan;
  for (const { key: day } of DAYS) {
    const slots = {} as { [S in SlotKey]: string | null };
    for (const { key: slot } of SLOTS) slots[slot] = null;
    week[day] = slots;
  }
  return week;
}

export function defaultState(): AppState {
  return {
    ingredients: [],
    meals: [],
    week: emptyWeek(),
    targets: { kcal: 2050, protein: 140 },
    shoppingChecked: [],
  };
}

export function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw);
    return normalise(parsed);
  } catch {
    return defaultState();
  }
}

// Fills in any missing top-level fields so older saves keep working.
function normalise(input: unknown): AppState {
  const base = defaultState();
  if (!input || typeof input !== "object") return base;
  const obj = input as Partial<AppState>;
  return {
    ingredients: Array.isArray(obj.ingredients) ? obj.ingredients : base.ingredients,
    meals: Array.isArray(obj.meals) ? obj.meals : base.meals,
    week: obj.week && typeof obj.week === "object" ? mergeWeek(obj.week as WeekPlan) : base.week,
    targets:
      obj.targets && typeof obj.targets === "object"
        ? { ...base.targets, ...obj.targets }
        : base.targets,
    shoppingChecked: Array.isArray(obj.shoppingChecked) ? obj.shoppingChecked : [],
  };
}

function mergeWeek(week: Partial<WeekPlan>): WeekPlan {
  const result = emptyWeek();
  for (const { key: day } of DAYS) {
    const incoming = week[day];
    if (!incoming) continue;
    for (const { key: slot } of SLOTS) {
      const v = incoming[slot];
      if (typeof v === "string" || v === null) result[day][slot] = v;
    }
  }
  return result;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function save(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.error("Failed to save state", err);
    }
  }, SAVE_DEBOUNCE_MS);
}

export function flushSave(state: AppState): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearStorage(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// Shape check for imported JSON. Returns null on failure.
export function validateImport(input: unknown): AppState | null {
  if (!input || typeof input !== "object") return null;
  const obj = input as Partial<AppState>;
  if (!Array.isArray(obj.ingredients) || !Array.isArray(obj.meals)) return null;
  if (!obj.week || typeof obj.week !== "object") return null;
  return normalise(obj);
}

export function exportFilename(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `mealprep-${y}-${m}-${d}.json`;
}

export type { DayKey, SlotKey };
