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

type Tab = "meal" | "ingredient" | "plan";

interface ViewState {
  tab: Tab;
  loading: boolean;
  ingredients: SharedIngredient[];
  meals: SharedMeal[];
  plans: SharedPlan[];
  loaded: { ingredient: boolean; meal: boolean; plan: boolean };
  imported: Set<string>;
}

const view: ViewState = {
  tab: "meal",
  loading: false,
  ingredients: [],
  meals: [],
  plans: [],
  loaded: { ingredient: false, meal: false, plan: false },
  imported: new Set(),
};

export function renderShare(target: HTMLElement): void {
  if (!isFirebaseConfigured()) {
    target.innerHTML = html`
      <div class="page-h">
        <span class="eyebrow">Shared by your circle</span>
        <h1>Shared with you</h1>
      </div>
      <p class="muted" style="padding: 0 18px;">
        Firebase isn't configured for this deployment, so the sharing area is offline.
      </p>
    `;
    return;
  }

  const counts = {
    meal: view.meals.length,
    ingredient: view.ingredients.length,
    plan: view.plans.length,
  };

  target.innerHTML = html`
    <div class="page-h">
      <span class="eyebrow">Shared by your circle</span>
      <h1>Shared with you</h1>
    </div>

    <div role="tablist" aria-label="Share categories"
         style="padding: 0 14px 14px; display: flex; gap: 6px;">
      <button class="pill ${view.tab === "meal" ? "cur" : ""}" data-tab="meal">Meals · ${counts.meal}</button>
      <button class="pill ${view.tab === "ingredient" ? "cur" : ""}" data-tab="ingredient">Ingredients · ${counts.ingredient}</button>
      <button class="pill ${view.tab === "plan" ? "cur" : ""}" data-tab="plan">Weeks · ${counts.plan}</button>
    </div>

    <div class="share-list" id="share-list">${raw(renderList())}</div>
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
  if (view.loading) return `<p class="muted" style="padding: 14px;">Loading…</p>`;
  if (view.tab === "ingredient") return renderIngredientList();
  if (view.tab === "meal") return renderMealList();
  return renderPlanList();
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const day = 1000 * 60 * 60 * 24;
  if (diff < day) return "today";
  const days = Math.round(diff / day);
  if (days < 7) return `${days}d ago`;
  if (days < 28) return `${Math.round(days / 7)}w ago`;
  return new Date(ts).toLocaleDateString();
}

function authorMeta(s: { authorName: string; authorUid: string; sharedAt: number }): string {
  const me = currentUser()?.uid === s.authorUid;
  const name = s.authorName || (me ? "you" : "—");
  return `${esc(name)}${me ? " (you)" : ""} · published ${esc(relativeTime(s.sharedAt))}`;
}

function avatarOf(authorName: string): string {
  const letter = (authorName || "?").trim().charAt(0).toUpperCase() || "?";
  return `<div class="avatar" aria-hidden="true">${esc(letter)}</div>`;
}

function copyButton(id: string, label: string): string {
  const added = view.imported.has(id);
  return `<button class="add ${added ? "added" : ""}" data-import="${esc(id)}" ${added ? "disabled" : ""}>${added ? "In library" : esc(label)}</button>`;
}

function unshareButton(authorUid: string, kind: Tab, id: string): string {
  const me = currentUser()?.uid;
  if (!me || me !== authorUid) return "";
  return `<button class="unshare" data-share-delete data-kind="${kind}" data-id="${esc(id)}">Unshare</button>`;
}

function renderMealList(): string {
  if (view.meals.length === 0)
    return `<p class="muted" style="padding: 14px;">No shared meals yet.</p>`;
  return view.meals
    .map((s) => {
      const id = s.id ?? "";
      const totalIng = s.meal.ingredients.length;
      return `<article class="share-card">
        ${avatarOf(s.authorName)}
        <div class="body">
          <div class="who">${authorMeta(s)}</div>
          <div class="nm">${esc(s.meal.name)}</div>
          <div class="meta">${totalIng} ingredient${totalIng === 1 ? "" : "s"} · serves ${s.meal.servings}</div>
          ${s.meal.notes ? `<div class="meta">${esc(s.meal.notes)}</div>` : ""}
        </div>
        <div class="actions">
          ${copyButton(id, "Copy")}
          ${unshareButton(s.authorUid, "meal", id)}
        </div>
      </article>`;
    })
    .join("");
}

function renderIngredientList(): string {
  if (view.ingredients.length === 0)
    return `<p class="muted" style="padding: 14px;">No shared ingredients yet.</p>`;
  return view.ingredients
    .map((s) => {
      const id = s.id ?? "";
      return `<article class="share-card">
        ${avatarOf(s.authorName)}
        <div class="body">
          <div class="who">${authorMeta(s)}</div>
          <div class="nm">${esc(s.ingredient.name)}</div>
          <div class="meta">${Math.round(s.ingredient.kcalPer100)} kcal · ${Math.round(s.ingredient.proteinPer100)}P · ${Math.round(s.ingredient.carbsPer100)}C · ${Math.round(s.ingredient.fatPer100)}F per ${s.ingredient.unit === "unit" ? "unit" : "100 " + s.ingredient.unit} · ${esc(s.ingredient.category)}</div>
        </div>
        <div class="actions">
          ${copyButton(id, "Copy")}
          ${unshareButton(s.authorUid, "ingredient", id)}
        </div>
      </article>`;
    })
    .join("");
}

function renderPlanList(): string {
  if (view.plans.length === 0)
    return `<p class="muted" style="padding: 14px;">No shared week plans yet.</p>`;
  return view.plans
    .map((s) => {
      const id = s.id ?? "";
      return `<article class="share-card">
        ${avatarOf(s.authorName)}
        <div class="body">
          <div class="who">${authorMeta(s)}</div>
          <div class="nm">${esc(s.name)}</div>
          <div class="meta">${s.meals.length} meal${s.meals.length === 1 ? "" : "s"} · ${s.slots.length} slot${s.slots.length === 1 ? "" : "s"}</div>
        </div>
        <div class="actions">
          ${copyButton(id, "Copy week")}
          ${unshareButton(s.authorUid, "plan", id)}
        </div>
      </article>`;
    })
    .join("");
}

function wireListActions(target: HTMLElement): void {
  target.querySelectorAll<HTMLButtonElement>("[data-import]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.import!;
      if (view.tab === "ingredient") {
        const item = view.ingredients.find((x) => x.id === id);
        if (item) importIngredient(item.ingredient, id);
      } else if (view.tab === "meal") {
        const item = view.meals.find((x) => x.id === id);
        if (item) importMeal(item, id);
      } else {
        const item = view.plans.find((x) => x.id === id);
        if (!item) return;
        if (
          !confirmAction(
            `Adopt "${item.name}"? Its slots, meals and ingredients will be added to yours, and the week plan will be replaced.`,
          )
        )
          return;
        importPlan(item, id);
      }
      renderShare(target);
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
        view.loaded[kind] = false;
        void refresh(target);
      } catch (err) {
        alert("Couldn't unshare: " + (err instanceof Error ? err.message : String(err)));
      }
    });
  });
}

function importIngredient(ing: Ingredient, sharedId: string): void {
  const store = getStore();
  const fresh: Ingredient = { ...ing, id: newId() };
  store.ingredients = [...store.ingredients, fresh];
  view.imported.add(sharedId);
}

function importMeal(item: SharedMeal, sharedId: string): void {
  const store = getStore();
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
  view.imported.add(sharedId);
}

function importPlan(item: SharedPlan, sharedId: string): void {
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
  store.slots = JSON.parse(JSON.stringify(item.slots));
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
  view.imported.add(sharedId);
}

async function refresh(target: HTMLElement): Promise<void> {
  view.loading = true;
  const listEl = target.querySelector("#share-list");
  if (listEl) listEl.innerHTML = `<p class="muted" style="padding: 14px;">Loading…</p>`;
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
      listEl.innerHTML = `<p class="auth-error" style="padding: 14px;">Couldn't load: ${esc(err instanceof Error ? err.message : String(err))}</p>`;
    }
    view.loading = false;
    return;
  }
  view.loading = false;
  renderShare(target);
}
