import type { AppState, MealSlot, WeekPlan } from "./types";
import { DAYS, DEFAULT_SLOTS } from "./types";

// Bumped from v1 to v2 when slots / profile were added — see normalise().
const STORAGE_KEY = "mealprep:v2";
const LEGACY_STORAGE_KEY = "mealprep:v1";
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
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) raw = legacy;
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
    localStorage.removeItem(LEGACY_STORAGE_KEY);
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
    targets: { kcal: 2050, protein: 140 },
    shoppingChecked: [],
    profile: { displayName: "" },
  };
}

export function load(): AppState {
  try {
    let raw = localStorage.getItem(activeKey);
    // One-shot migration from the v1 single-blob key.
    if (!raw && activeKey === STORAGE_KEY) {
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        raw = legacy;
        try {
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        } catch {
          /* ignore */
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

export type { DayKey, SlotKey } from "./types";
