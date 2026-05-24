import { getStore } from "../store";
import { uid as newId } from "../state";
import { esc, html, raw, confirmAction } from "../ui/components";
import {
  listShared,
  deleteShared,
  isSignedIn,
  type SharedIngredient,
  type SharedMeal,
  type SharedPlan,
} from "../firebase/sharing";
import { currentUser } from "../firebase/auth";
import { isFirebaseConfigured } from "../firebase/config";
import type { Ingredient, Meal } from "../types";

type Tab = "ingredient" | "meal" | "plan";

interface ViewState {
  tab: Tab;
  loading: boolean;
  ingredients: SharedIngredient[];
  meals: SharedMeal[];
  plans: SharedPlan[];
  loaded: { ingredient: boolean; meal: boolean; plan: boolean };
}

const view: ViewState = {
  tab: "meal",
  loading: false,
  ingredients: [],
  meals: [],
  plans: [],
  loaded: { ingredient: false, meal: false, plan: false },
};

export function renderShare(target: HTMLElement): void {
  if (!isFirebaseConfigured()) {
    target.innerHTML = html`
      <h2>Share</h2>
      <p>Firebase isn't configured for this deployment, so the sharing area is offline.</p>
    `;
    return;
  }

  target.innerHTML = html`
    <div class="view-header">
      <h2>Share</h2>
      <div class="row">
        <button data-tab="meal" class="${view.tab === "meal" ? "" : "outline"}">Meals</button>
        <button data-tab="ingredient" class="${view.tab === "ingredient" ? "" : "outline"}">Ingredients</button>
        <button data-tab="plan" class="${view.tab === "plan" ? "" : "outline"}">Week plans</button>
      </div>
    </div>
    <div id="share-list">${raw(renderList())}</div>
  `;

  target.querySelectorAll<HTMLButtonElement>("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      view.tab = btn.dataset.tab as Tab;
      renderShare(target);
    });
  });

  wireListActions(target);

  if (!view.loaded[view.tab] && !view.loading) {
    void refresh(target);
  }
}

function renderList(): string {
  if (view.loading) return `<p class="muted">Loading…</p>`;
  if (view.tab === "ingredient") return renderIngredientList();
  if (view.tab === "meal") return renderMealList();
  return renderPlanList();
}

function authorBadge(authorName: string, authorUid: string, sharedAt: number): string {
  const me = currentUser()?.uid === authorUid;
  const when = new Date(sharedAt).toLocaleDateString();
  return `<small class="muted">Shared by ${esc(authorName)}${me ? " (you)" : ""} · ${esc(when)}</small>`;
}

function deleteButton(authorUid: string, kind: Tab, id: string): string {
  const me = currentUser()?.uid;
  if (!me || me !== authorUid) return "";
  return `<button class="outline secondary" data-share-delete data-kind="${kind}" data-id="${esc(id)}">Unshare</button>`;
}

function renderIngredientList(): string {
  if (view.ingredients.length === 0)
    return `<p class="muted">No shared ingredients yet.</p>`;
  return view.ingredients
    .map(
      (s) => `<article class="share-card">
        <div class="row">
          <strong class="grow">${esc(s.ingredient.name)}</strong>
          ${deleteButton(s.authorUid, "ingredient", s.id ?? "")}
        </div>
        <div class="muted"><small>
          ${Math.round(s.ingredient.kcalPer100)} kcal · ${Math.round(s.ingredient.proteinPer100)}g P ·
          ${Math.round(s.ingredient.carbsPer100)}g C · ${Math.round(s.ingredient.fatPer100)}g F
          per ${s.ingredient.unit === "unit" ? "unit" : "100" + s.ingredient.unit}
          · ${esc(s.ingredient.category)}
        </small></div>
        <div>${authorBadge(s.authorName, s.authorUid, s.sharedAt)}</div>
        <div class="row" style="margin-top: 0.5rem">
          <button class="outline" data-import-ing="${esc(s.id ?? "")}">+ Add to my ingredients</button>
        </div>
      </article>`,
    )
    .join("");
}

function renderMealList(): string {
  if (view.meals.length === 0) return `<p class="muted">No shared meals yet.</p>`;
  return view.meals
    .map((s) => {
      const totalIng = s.meal.ingredients.length;
      return `<article class="share-card">
        <div class="row">
          <strong class="grow">${esc(s.meal.name)}</strong>
          ${deleteButton(s.authorUid, "meal", s.id ?? "")}
        </div>
        <div class="muted"><small>${totalIng} ingredient${totalIng === 1 ? "" : "s"} · serves ${s.meal.servings}</small></div>
        ${s.meal.notes ? `<p><small>${esc(s.meal.notes)}</small></p>` : ""}
        <div>${authorBadge(s.authorName, s.authorUid, s.sharedAt)}</div>
        <div class="row" style="margin-top: 0.5rem">
          <button class="outline" data-import-meal="${esc(s.id ?? "")}">+ Add to my meals</button>
        </div>
      </article>`;
    })
    .join("");
}

function renderPlanList(): string {
  if (view.plans.length === 0) return `<p class="muted">No shared week plans yet.</p>`;
  return view.plans
    .map(
      (s) => `<article class="share-card">
        <div class="row">
          <strong class="grow">${esc(s.name)}</strong>
          ${deleteButton(s.authorUid, "plan", s.id ?? "")}
        </div>
        <div class="muted"><small>${s.meals.length} meal${s.meals.length === 1 ? "" : "s"} · ${s.slots.length} slot${s.slots.length === 1 ? "" : "s"}</small></div>
        <div>${authorBadge(s.authorName, s.authorUid, s.sharedAt)}</div>
        <div class="row" style="margin-top: 0.5rem">
          <button class="outline" data-import-plan="${esc(s.id ?? "")}">Adopt this plan</button>
        </div>
      </article>`,
    )
    .join("");
}

function wireListActions(target: HTMLElement): void {
  target.querySelectorAll<HTMLButtonElement>("[data-import-ing]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.importIng!;
      const item = view.ingredients.find((x) => x.id === id);
      if (!item) return;
      importIngredient(item.ingredient);
    });
  });

  target.querySelectorAll<HTMLButtonElement>("[data-import-meal]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.importMeal!;
      const item = view.meals.find((x) => x.id === id);
      if (!item) return;
      importMeal(item);
    });
  });

  target.querySelectorAll<HTMLButtonElement>("[data-import-plan]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.importPlan!;
      const item = view.plans.find((x) => x.id === id);
      if (!item) return;
      if (!confirmAction(`Adopt "${item.name}"? Its slots, meals and ingredients will be added to yours, and the week plan will be replaced.`)) return;
      importPlan(item);
    });
  });

  target.querySelectorAll<HTMLButtonElement>("[data-share-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!isSignedIn()) return;
      if (!confirmAction("Unshare this item? It will be removed from the public area.")) return;
      const kind = btn.dataset.kind as Tab;
      const id = btn.dataset.id!;
      try {
        await deleteShared(kind, id);
        // Invalidate cache so the list refreshes.
        view.loaded[kind] = false;
        void refresh(target);
      } catch (err) {
        alert("Couldn't unshare: " + (err instanceof Error ? err.message : String(err)));
      }
    });
  });
}

function importIngredient(ing: Ingredient): Ingredient {
  const store = getStore();
  const fresh: Ingredient = { ...ing, id: newId() };
  store.ingredients = [...store.ingredients, fresh];
  alert(`Added "${fresh.name}" to your ingredients.`);
  return fresh;
}

function importMeal(item: SharedMeal): void {
  const store = getStore();
  // Map remote ingredient IDs → freshly minted local ones.
  const idMap = new Map<string, string>();
  const addedIngredients: Ingredient[] = [];
  for (const ing of item.ingredients) {
    const newID = newId();
    idMap.set(ing.id, newID);
    addedIngredients.push({ ...ing, id: newID });
  }
  const meal: Meal = JSON.parse(JSON.stringify(item.meal));
  meal.id = newId();
  meal.ingredients = meal.ingredients.map((mi) => ({
    ingredientId: idMap.get(mi.ingredientId) ?? mi.ingredientId,
    amount: mi.amount,
  }));
  store.ingredients = [...store.ingredients, ...addedIngredients];
  store.meals = [...store.meals, meal];
  alert(`Added "${meal.name}" to your meals (with ${addedIngredients.length} ingredient${addedIngredients.length === 1 ? "" : "s"}).`);
}

function importPlan(item: SharedPlan): void {
  const store = getStore();
  const ingIdMap = new Map<string, string>();
  const addedIngredients: Ingredient[] = [];
  for (const ing of item.ingredients) {
    const id = newId();
    ingIdMap.set(ing.id, id);
    addedIngredients.push({ ...ing, id });
  }
  const mealIdMap = new Map<string, string>();
  const addedMeals: Meal[] = [];
  for (const m of item.meals) {
    const id = newId();
    mealIdMap.set(m.id, id);
    addedMeals.push({
      ...m,
      id,
      ingredients: m.ingredients.map((mi) => ({
        ingredientId: ingIdMap.get(mi.ingredientId) ?? mi.ingredientId,
        amount: mi.amount,
      })),
    });
  }

  // Adopt the slot layout (preserving IDs is fine; they're user-defined strings).
  store.slots = JSON.parse(JSON.stringify(item.slots));

  // Rewrite the week plan to point at our new local meal IDs and only the
  // currently-known slot IDs.
  const validSlotIds = new Set(store.slots.map((s) => s.id));
  const week: typeof store.week = {} as typeof store.week;
  for (const day of Object.keys(item.week) as (keyof typeof item.week)[]) {
    const slotMap: { [slotId: string]: string | null } = {};
    for (const slotId of Object.keys(item.week[day])) {
      if (!validSlotIds.has(slotId)) continue;
      const mealId = item.week[day][slotId];
      slotMap[slotId] = mealId ? (mealIdMap.get(mealId) ?? null) : null;
    }
    week[day] = slotMap;
  }
  store.week = week;
  store.ingredients = [...store.ingredients, ...addedIngredients];
  store.meals = [...store.meals, ...addedMeals];

  alert(`Adopted "${item.name}". Open the Week tab to review.`);
}

async function refresh(target: HTMLElement): Promise<void> {
  view.loading = true;
  const listEl = target.querySelector("#share-list");
  if (listEl) listEl.innerHTML = `<p class="muted">Loading…</p>`;
  try {
    if (view.tab === "ingredient") {
      view.ingredients = await listShared("ingredient");
      view.loaded.ingredient = true;
    } else if (view.tab === "meal") {
      view.meals = await listShared("meal");
      view.loaded.meal = true;
    } else {
      view.plans = await listShared("plan");
      view.loaded.plan = true;
    }
  } catch (err) {
    if (listEl) {
      listEl.innerHTML = `<p class="auth-error">Couldn't load: ${esc(err instanceof Error ? err.message : String(err))}</p>`;
    }
    view.loading = false;
    return;
  }
  view.loading = false;
  if (listEl) listEl.innerHTML = renderList();
  wireListActions(target);
}
