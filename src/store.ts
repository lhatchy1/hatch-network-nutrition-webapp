import type Alpine from "alpinejs";
import type { AppState } from "./types";
import { load, save } from "./state";

export interface Store extends AppState {
  /** Marker so Alpine treats this as a reactive store. */
  readonly __store: true;
}

let store: Store | null = null;
let alpineRef: typeof Alpine | null = null;

export function initStore(alpine: typeof Alpine): Store {
  alpineRef = alpine;
  const initial = load();
  alpine.store("app", { ...initial, __store: true });
  store = alpine.store("app") as Store;

  // Persist on any mutation. Alpine's effect runs synchronously when the
  // tracked data changes, and save() is debounced internally.
  alpine.effect(() => {
    save(snapshot(store!));
  });
  return store;
}

export function getStore(): Store {
  if (!store) throw new Error("Store not initialised");
  return store;
}

/** Plain-object snapshot (strips Alpine proxies) — safe to JSON.stringify. */
export function snapshot(s: Store): AppState {
  return JSON.parse(
    JSON.stringify({
      ingredients: s.ingredients,
      meals: s.meals,
      slots: s.slots,
      week: s.week,
      targets: s.targets,
      shoppingChecked: s.shoppingChecked,
      profile: s.profile,
    }),
  );
}

export function replaceState(next: AppState): void {
  const s = getStore();
  s.ingredients = next.ingredients;
  s.meals = next.meals;
  s.slots = next.slots;
  s.week = next.week;
  s.targets = next.targets;
  s.shoppingChecked = next.shoppingChecked;
  s.profile = next.profile;
}

// Re-seed the store from a freshly-loaded AppState (used after sign-in /
// sign-out, when the underlying localStorage scope changes).
export function reseedStore(next: AppState): void {
  if (!alpineRef) throw new Error("Store not initialised");
  const current = alpineRef.store("app") as Store;
  current.ingredients = next.ingredients;
  current.meals = next.meals;
  current.slots = next.slots;
  current.week = next.week;
  current.targets = next.targets;
  current.shoppingChecked = next.shoppingChecked;
  current.profile = next.profile;
}
