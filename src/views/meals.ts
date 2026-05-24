import { getStore } from "../store";
import { uid } from "../state";
import type { Ingredient, Meal } from "../types";
import { mealNutrition, fmtMacro } from "../nutrition";
import { esc, html, raw, confirmAction } from "../ui/components";
import { mountFoodSearchPanel } from "../ui/foodSearchPanel";

interface ViewState {
  editingId: string | null;
  searching: boolean;
}

const view: ViewState = { editingId: null, searching: false };

export function renderMeals(target: HTMLElement): void {
  if (view.editingId) {
    renderEdit(target);
  } else {
    renderList(target);
  }
}

function renderList(target: HTMLElement): void {
  const store = getStore();
  const meals = [...store.meals].sort((a, b) => a.name.localeCompare(b.name));

  target.innerHTML = html`
    <div class="view-header">
      <h2>Meals</h2>
      <button id="add-meal">+ New meal</button>
    </div>
    ${raw(
      meals.length === 0
        ? `<p class="muted">No meals yet. Add ingredients first, then build meals here.</p>`
        : meals.map((m) => renderCard(m)).join(""),
    )}
  `;

  target.querySelector("#add-meal")?.addEventListener("click", () => {
    const fresh: Meal = {
      id: uid(),
      name: "New meal",
      servings: 1,
      ingredients: [],
      notes: "",
    };
    store.meals.push(fresh);
    view.editingId = fresh.id;
    view.searching = false;
    renderMeals(target);
  });

  target.querySelectorAll<HTMLElement>("[data-open]").forEach((el) => {
    el.addEventListener("click", () => {
      view.editingId = el.dataset.open!;
      view.searching = false;
      renderMeals(target);
    });
  });

  target.querySelectorAll<HTMLElement>("[data-dup]").forEach((el) => {
    el.addEventListener("click", () => {
      const m = store.meals.find((x) => x.id === el.dataset.dup!);
      if (!m) return;
      const copy: Meal = JSON.parse(JSON.stringify(m));
      copy.id = uid();
      copy.name = `${m.name} (copy)`;
      store.meals.push(copy);
      view.editingId = copy.id;
      view.searching = false;
      renderMeals(target);
    });
  });

  target.querySelectorAll<HTMLElement>("[data-del]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.del!;
      const m = store.meals.find((x) => x.id === id);
      if (!m) return;
      if (!confirmAction(`Delete "${m.name}"? It will be removed from the week plan too.`)) return;
      store.meals = store.meals.filter((x) => x.id !== id);
      for (const day of Object.values(store.week)) {
        for (const slot of Object.keys(day) as (keyof typeof day)[]) {
          if (day[slot] === id) day[slot] = null;
        }
      }
      renderMeals(target);
    });
  });
}

function renderCard(m: Meal): string {
  const store = getStore();
  const n = mealNutrition(m, store.ingredients);
  return `
    <article class="meal-card">
      <div class="row">
        <strong class="grow">${esc(m.name)}</strong>
      </div>
      <div class="meal-meta">
        ${fmtMacro(n.kcal)} kcal · ${fmtMacro(n.protein)}g protein · ${fmtMacro(n.carbs)}g C · ${fmtMacro(n.fat)}g F
        — serves ${m.servings}
      </div>
      <div class="row" style="margin-top: 0.5rem">
        <button class="outline" data-open="${esc(m.id)}">Edit</button>
        <button class="outline" data-dup="${esc(m.id)}">Duplicate</button>
        <button class="outline secondary" data-del="${esc(m.id)}">Delete</button>
      </div>
    </article>
  `;
}

function renderEdit(target: HTMLElement): void {
  const store = getStore();
  const meal = store.meals.find((m) => m.id === view.editingId);
  if (!meal) {
    view.editingId = null;
    renderMeals(target);
    return;
  }

  const n = mealNutrition(meal, store.ingredients);
  const ingredientOptions = [...store.ingredients]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((i) => `<option value="${esc(i.id)}">${esc(i.name)} (${i.unit})</option>`)
    .join("");

  target.innerHTML = html`
    <div class="view-header">
      <h2>Edit meal</h2>
      <button id="back" class="outline">← Back</button>
    </div>
    <label>Name <input id="m-name" value="${esc(meal.name)}" /></label>
    <div class="row">
      <label class="grow">Servings
        <input id="m-serv" type="number" min="1" step="1" value="${meal.servings}" />
      </label>
    </div>
    <label>Notes <textarea id="m-notes" rows="2">${esc(meal.notes ?? "")}</textarea></label>

    <h3>Ingredients</h3>
    ${raw(
      meal.ingredients.length === 0
        ? `<p class="muted">No ingredients yet.</p>`
        : `<figure><table role="grid">
            <thead><tr><th>Name</th><th>Amount</th><th>Unit</th><th></th></tr></thead>
            <tbody>${meal.ingredients
              .map((mi, idx) => {
                const ing = store.ingredients.find((i) => i.id === mi.ingredientId);
                return `<tr>
                  <td>${esc(ing?.name ?? "(deleted)")}</td>
                  <td><input type="number" step="any" min="0" data-amount="${idx}" value="${mi.amount}" /></td>
                  <td>${esc(ing?.unit ?? "")}</td>
                  <td><button class="outline secondary" data-rm="${idx}">Remove</button></td>
                </tr>`;
              })
              .join("")}</tbody></table></figure>`,
    )}

    <div class="row">
      <select id="m-add-ing" class="grow">
        <option value="">Pick from library…</option>
        ${raw(ingredientOptions)}
      </select>
      <input id="m-add-amt" type="number" step="any" min="0" placeholder="Amount" style="max-width: 8rem" />
      <button id="m-add-btn">Add</button>
      <button id="m-search-btn" class="outline">+ Search foods</button>
    </div>
    <div id="m-search-panel"></div>

    <h3>Per serving</h3>
    <p>
      <strong>${fmtMacro(n.kcal)} kcal</strong> ·
      ${fmtMacro(n.protein)}g protein ·
      ${fmtMacro(n.carbs)}g carbs ·
      ${fmtMacro(n.fat)}g fat
    </p>
  `;

  wireEdit(target, meal);

  if (view.searching) mountMealSearch(target, meal);
}

function mountMealSearch(target: HTMLElement, meal: Meal): void {
  const panel = target.querySelector<HTMLElement>("#m-search-panel");
  if (!panel) return;
  mountFoodSearchPanel(panel, {
    placeholder: "Search foods to add to this meal…",
    onCancel: () => {
      view.searching = false;
      renderMeals(target);
    },
    onPick: (hit) => {
      if (!hit) return;
      const store = getStore();
      const ing: Ingredient = {
        id: uid(),
        name: hit.brand ? `${hit.name} (${hit.brand})` : hit.name,
        unit: "g",
        kcalPer100: hit.kcalPer100,
        proteinPer100: hit.proteinPer100,
        carbsPer100: hit.carbsPer100,
        fatPer100: hit.fatPer100,
        category: hit.category,
      };
      store.ingredients.push(ing);
      meal.ingredients.push({ ingredientId: ing.id, amount: 100 });
      view.searching = false;
      renderMeals(target);
    },
  });
}

function wireEdit(target: HTMLElement, meal: Meal): void {
  const rerender = () => renderMeals(target);

  target.querySelector("#back")?.addEventListener("click", () => {
    view.editingId = null;
    view.searching = false;
    rerender();
  });

  (target.querySelector("#m-name") as HTMLInputElement).addEventListener("change", (e) => {
    meal.name = (e.target as HTMLInputElement).value.trim() || "Unnamed";
    rerender();
  });

  (target.querySelector("#m-serv") as HTMLInputElement).addEventListener("change", (e) => {
    meal.servings = Math.max(1, Number((e.target as HTMLInputElement).value) || 1);
    rerender();
  });

  (target.querySelector("#m-notes") as HTMLTextAreaElement).addEventListener("change", (e) => {
    meal.notes = (e.target as HTMLTextAreaElement).value;
  });

  target.querySelectorAll<HTMLInputElement>("[data-amount]").forEach((el) => {
    el.addEventListener("change", () => {
      const idx = Number(el.dataset.amount);
      meal.ingredients[idx].amount = Math.max(0, Number(el.value) || 0);
      rerender();
    });
  });

  target.querySelectorAll<HTMLElement>("[data-rm]").forEach((el) => {
    el.addEventListener("click", () => {
      const idx = Number(el.dataset.rm);
      meal.ingredients.splice(idx, 1);
      rerender();
    });
  });

  target.querySelector("#m-add-btn")?.addEventListener("click", () => {
    const sel = target.querySelector("#m-add-ing") as HTMLSelectElement;
    const amt = target.querySelector("#m-add-amt") as HTMLInputElement;
    const ingId = sel.value;
    const amount = Number(amt.value);
    if (!ingId || !amount || amount <= 0) return;
    meal.ingredients.push({ ingredientId: ingId, amount });
    sel.value = "";
    amt.value = "";
    rerender();
  });

  target.querySelector("#m-search-btn")?.addEventListener("click", () => {
    view.searching = !view.searching;
    rerender();
  });
}
