import type Alpine from "alpinejs";
import type { AppState } from "./types";
import { load, save } from "./state";

export interface Store extends AppState {
  /** Marker so Alpine treats this as a reactive store. */
  readonly __store: true;
}

let store: Store | null = null;

export function initStore(alpine: typeof Alpine): Store {
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
      week: s.week,
      targets: s.targets,
      shoppingChecked: s.shoppingChecked,
    }),
  );
}

export function replaceState(next: AppState): void {
  const s = getStore();
  s.ingredients = next.ingredients;
  s.meals = next.meals;
  s.week = next.week;
  s.targets = next.targets;
  s.shoppingChecked = next.shoppingChecked;
}
