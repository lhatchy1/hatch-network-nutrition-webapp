// Native <dialog> that swaps an ingredient on the current shopping list for
// another product. The user can scan a barcode, type one manually, or
// search Open Food Facts — once a hit is chosen, every meal currently on
// the week plan that referenced the old ingredient is rewritten to use
// the new one, and the new ingredient is appended to the library.

import { getStore } from "../store";
import { uid } from "../state";
import type { Ingredient } from "../types";
import { esc, html } from "./components";
import { mountFoodSearchPanel } from "./foodSearchPanel";
import type { FoodHit } from "../api/foodSearch";

let onAfter: (() => void) | null = null;

export function openReplaceDialog(oldIngredientId: string, after: () => void): void {
  const dialog = document.getElementById("replace-dialog") as HTMLDialogElement | null;
  if (!dialog) return;
  const store = getStore();
  const old = store.ingredients.find((i) => i.id === oldIngredientId);
  if (!old) return;
  onAfter = after;

  dialog.innerHTML = html`
    <div class="sheet">
      <div class="grab" aria-hidden="true"></div>
      <header class="hd">
        <h3>Replace ingredient</h3>
        <span class="sub">${esc(old.name)}</span>
      </header>
      <div class="panel-mount" id="rd-panel"></div>
    </div>
  `;

  const panel = dialog.querySelector<HTMLElement>("#rd-panel");
  if (!panel) return;
  mountFoodSearchPanel(panel, {
    placeholder: `Search a replacement for ${old.name}…`,
    onCancel: () => closeDialog(dialog),
    onPick: (hit) => {
      if (!hit) return;
      const next = adoptIngredient(hit);
      replaceInWeek(oldIngredientId, next.id);
      closeDialog(dialog);
    },
  });

  if (!dialog.open) dialog.showModal();

  if (!dialog.dataset.backdropBound) {
    dialog.addEventListener("click", (e) => {
      if (e.target !== dialog) return;
      closeDialog(dialog);
    });
    dialog.dataset.backdropBound = "1";
  }
}

function closeDialog(dialog: HTMLDialogElement): void {
  const cb = onAfter;
  onAfter = null;
  dialog.close();
  cb?.();
}

function adoptIngredient(hit: FoodHit): Ingredient {
  const store = getStore();
  const fresh: Ingredient = {
    id: uid(),
    name: hit.brand ? `${hit.name} (${hit.brand})` : hit.name,
    unit: "g",
    kcalPer100: hit.kcalPer100,
    proteinPer100: hit.proteinPer100,
    carbsPer100: hit.carbsPer100,
    fatPer100: hit.fatPer100,
    category: hit.category,
  };
  store.ingredients.push(fresh);
  return fresh;
}

// Swap ingredient references in every meal that is currently scheduled on
// the week plan. Meals outside the plan keep using the original entry so
// other weeks aren't silently rewritten.
function replaceInWeek(oldId: string, newId: string): void {
  const store = getStore();
  const planMealIds = new Set<string>();
  for (const day of Object.values(store.week)) {
    for (const id of Object.values(day)) {
      if (id) planMealIds.add(id);
    }
  }
  for (const meal of store.meals) {
    if (!planMealIds.has(meal.id)) continue;
    let changed = false;
    for (const mi of meal.ingredients) {
      if (mi.ingredientId === oldId) {
        mi.ingredientId = newId;
        changed = true;
      }
    }
    if (changed) {
      // Re-assign so Alpine notices the nested mutation on this meal.
      meal.ingredients = [...meal.ingredients];
    }
  }
  // The old line drops off the shopping list as soon as no week-meal uses
  // it; carry over its "checked" state to the replacement so the user
  // doesn't get a surprise re-tick.
  if (store.shoppingChecked.includes(oldId)) {
    store.shoppingChecked = store.shoppingChecked.filter((x) => x !== oldId);
    if (!store.shoppingChecked.includes(newId)) store.shoppingChecked.push(newId);
  }
}
