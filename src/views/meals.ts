import { getStore } from "../store";
import { uid } from "../state";
import type { Ingredient, Meal } from "../types";
import { mealNutrition, fmtMacro, fmtSalt } from "../nutrition";
import { esc, html, raw, confirmAction } from "../ui/components";
import { mountFoodSearchPanel } from "../ui/foodSearchPanel";
import { shareMeal, isSignedIn } from "../firebase/sharing";
import { mealCategory, dotClass } from "../status";

interface ViewState {
  editingId: string | null;
  selectedId: string | null; // desktop master-detail focus
  searching: boolean;
  query: string;
}

const view: ViewState = {
  editingId: null,
  selectedId: null,
  searching: false,
  query: "",
};

export function renderMeals(target: HTMLElement): void {
  const store = getStore();

  if (view.editingId) {
    renderEdit(target);
    return;
  }

  const meals = [...store.meals].sort((a, b) => a.name.localeCompare(b.name));
  const filtered = view.query
    ? meals.filter((m) => m.name.toLowerCase().includes(view.query.toLowerCase()))
    : meals;

  if (!view.selectedId && filtered.length > 0) view.selectedId = filtered[0].id;
  const selected = filtered.find((m) => m.id === view.selectedId) ?? null;

  target.innerHTML = html`
    <div class="page-h">
      <div>
        <span class="eyebrow">Library · ${meals.length} saved</span>
        <h1>Meals</h1>
      </div>
      <button class="btn primary" id="add-meal">＋ New meal</button>
    </div>

    <div class="meals-d">
      <aside class="list-col">
        <div style="padding: 4px 6px 8px;">
          <input
            type="search"
            id="meals-filter"
            value="${esc(view.query)}"
            placeholder="Filter your meals…"
            style="width: 100%; padding: 8px 12px; font-size: 12.5px;"
          />
        </div>
        ${raw(
          filtered.length === 0
            ? `<p class="muted" style="padding: 12px;">${
                meals.length === 0 ? "No meals yet — tap ＋ New meal to start." : "No meals match."
              }</p>`
            : filtered.map((m) => renderListItem(m)).join(""),
        )}
      </aside>
      <div class="detail-pane">${raw(selected ? renderDetail(selected) : `<p class="muted" style="padding: 22px;">Pick a meal on the left.</p>`)}</div>
    </div>
  `;

  wireList(target);
}

function renderListItem(m: Meal): string {
  const store = getStore();
  const n = mealNutrition(m, store.ingredients);
  const cat = mealCategory(m, store.ingredients);
  const isCur = view.selectedId === m.id;
  // On mobile (.meals-d isn't a grid) the same .m row becomes the
  // primary tap target; on desktop we use it as a list item.
  return `<button class="m ${isCur ? "cur" : ""}" data-pick="${esc(m.id)}">
    <span class="${dotClass(cat)}"></span>
    <div class="nm">${esc(m.name)}</div>
    <div class="kc">${fmtMacro(n.kcal)}</div>
  </button>`;
}

function renderDetail(m: Meal): string {
  const store = getStore();
  const n = mealNutrition(m, store.ingredients);
  const cat = mealCategory(m, store.ingredients);
  const usedDays = countMealUsage(m.id);

  return `<article class="detail">
    <header class="head">
      <div>
        <div class="eyebrow">Serves ${m.servings}${usedDays > 0 ? ` · used in ${usedDays} day${usedDays === 1 ? "" : "s"} this week` : ""}</div>
        <h2><span class="${dotClass(cat)}"></span>${esc(m.name)}</h2>
      </div>
      <div class="head-actions">
        <button class="btn" data-dup="${esc(m.id)}">Duplicate</button>
        <button class="btn primary" data-edit="${esc(m.id)}">Edit</button>
        ${isSignedIn() ? `<button class="btn" data-share="${esc(m.id)}">Share</button>` : ""}
        <button class="btn danger" data-del="${esc(m.id)}">Delete</button>
      </div>
    </header>

    <div class="macro-tiles">
      <div class="macro-tile"><div class="v">${fmtMacro(n.kcal)}</div><div class="k">kcal</div></div>
      <div class="macro-tile"><div class="v">${fmtMacro(n.protein)}g</div><div class="k">protein</div></div>
      <div class="macro-tile"><div class="v">${fmtMacro(n.carbs)}g</div><div class="k">carbs</div></div>
      <div class="macro-tile"><div class="v">${fmtMacro(n.fat)}g</div><div class="k">fat</div></div>
    </div>
    <div class="macro-tiles secondary">
      <div class="macro-tile"><div class="v">${fmtMacro(n.fibre)}g</div><div class="k">fibre</div></div>
      <div class="macro-tile"><div class="v">${fmtMacro(n.sugar)}g</div><div class="k">sugar</div></div>
      <div class="macro-tile"><div class="v">${fmtSalt(n.salt)}g</div><div class="k">salt</div></div>
    </div>

    <div style="font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-2); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px;">Ingredients</div>
    ${
      m.ingredients.length === 0
        ? `<p class="muted">No ingredients yet — tap Edit to add some.</p>`
        : m.ingredients
            .map((mi) => {
              const ing = store.ingredients.find((i) => i.id === mi.ingredientId);
              if (!ing) {
                return `<div class="ing-line"><div class="nm muted">(deleted ingredient)</div><div class="amt">${mi.amount}</div></div>`;
              }
              const f = ing.unit === "unit" ? mi.amount : mi.amount / 100;
              const kc = Math.round(ing.kcalPer100 * f);
              return `<div class="ing-line">
                <div class="nm">${esc(ing.name)}</div>
                <div class="amt">${mi.amount}${ing.unit === "unit" ? "" : " " + ing.unit}</div>
                <div class="kc">${kc} kcal</div>
              </div>`;
            })
            .join("")
    }
    ${m.notes ? `<p class="muted" style="margin-top: 12px; font-size: 13px;">${esc(m.notes)}</p>` : ""}
  </article>`;
}

function countMealUsage(mealId: string): number {
  const store = getStore();
  let n = 0;
  for (const day of Object.values(store.week)) {
    for (const id of Object.values(day)) if (id === mealId) n++;
  }
  return n;
}

function wireList(target: HTMLElement): void {
  const store = getStore();

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
    view.selectedId = fresh.id;
    view.searching = false;
    renderMeals(target);
  });

  target.querySelector("#meals-filter")?.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    const caret = t.selectionStart;
    view.query = t.value;
    view.selectedId = null;
    renderMeals(target);
    const fresh = target.querySelector<HTMLInputElement>("#meals-filter");
    if (fresh) {
      fresh.focus();
      if (caret !== null) {
        try {
          fresh.setSelectionRange(caret, caret);
        } catch {
          /* setSelectionRange is unsupported on some input types */
        }
      }
    }
  });

  target.querySelectorAll<HTMLButtonElement>("[data-pick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      view.selectedId = btn.dataset.pick!;
      renderMeals(target);
    });
  });

  target.querySelectorAll<HTMLButtonElement>("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      view.editingId = btn.dataset.edit!;
      view.searching = false;
      renderMeals(target);
    });
  });

  target.querySelectorAll<HTMLButtonElement>("[data-dup]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const m = store.meals.find((x) => x.id === btn.dataset.dup);
      if (!m) return;
      const copy: Meal = JSON.parse(JSON.stringify(m));
      copy.id = uid();
      copy.name = `${m.name} (copy)`;
      store.meals.push(copy);
      view.editingId = copy.id;
      view.selectedId = copy.id;
      view.searching = false;
      renderMeals(target);
    });
  });

  target.querySelectorAll<HTMLButtonElement>("[data-share]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const m = store.meals.find((x) => x.id === btn.dataset.share);
      if (!m) return;
      if (
        !confirmAction(
          `Share "${m.name}" to the public area? Its ingredients will be included so others can use it standalone.`,
        )
      )
        return;
      try {
        await shareMeal(store, m);
        alert("Shared. Browse it under the Share tab.");
      } catch (err) {
        alert("Couldn't share: " + (err instanceof Error ? err.message : String(err)));
      }
    });
  });

  target.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.del!;
      const m = store.meals.find((x) => x.id === id);
      if (!m) return;
      if (!confirmAction(`Delete "${m.name}"? It will be removed from the week plan too.`)) return;
      store.meals = store.meals.filter((x) => x.id !== id);
      for (const day of Object.values(store.week)) {
        for (const slot of Object.keys(day) as (keyof typeof day)[]) {
          if (day[slot] === id) day[slot] = null;
        }
      }
      if (view.selectedId === id) view.selectedId = null;
      renderMeals(target);
    });
  });
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
    <div class="page-h">
      <div>
        <span class="eyebrow">Editing meal</span>
        <h1>${esc(meal.name)}</h1>
      </div>
      <button class="btn ghost" id="back">← Back</button>
    </div>

    <article class="card" style="margin: 0 14px 14px;">
      <label style="font-size:12px;color:var(--ink-2);">Name
        <input id="m-name" value="${esc(meal.name)}" style="display:block;margin-top:4px;" />
      </label>
      <label style="font-size:12px;color:var(--ink-2);display:block;margin-top:12px;">Servings
        <input id="m-serv" type="number" min="1" step="1" value="${meal.servings}" style="display:block;margin-top:4px;max-width:120px;" />
      </label>
      <label style="font-size:12px;color:var(--ink-2);display:block;margin-top:12px;">Notes
        <textarea id="m-notes" rows="2" style="display:block;margin-top:4px;width:100%;">${esc(meal.notes ?? "")}</textarea>
      </label>
    </article>

    <div style="padding: 0 14px;">
      <div style="font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-2); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px;">Ingredients</div>
    </div>

    <article class="card" style="margin: 0 14px 14px;">
      ${raw(
        meal.ingredients.length === 0
          ? `<p class="muted" style="margin:0;">No ingredients yet.</p>`
          : meal.ingredients
              .map((mi, idx) => {
                const ing = store.ingredients.find((i) => i.id === mi.ingredientId);
                return `<div class="ing-line">
                  <div class="nm">${esc(ing?.name ?? "(deleted)")}</div>
                  <input type="number" step="any" min="0" data-amount="${idx}" value="${mi.amount}" />
                  <div class="amt">${esc(ing?.unit ?? "")}</div>
                  <button class="rm" data-rm="${idx}" aria-label="Remove">✕</button>
                </div>`;
              })
              .join(""),
      )}
      <div class="add-ing-row">
        <select id="m-add-ing">
          <option value="">Pick from library…</option>
          ${raw(ingredientOptions)}
        </select>
        <input id="m-add-amt" type="number" step="any" min="0" placeholder="Amount" />
        <button class="btn" id="m-add-btn">Add</button>
        <button class="btn ghost" id="m-search-btn">＋ Search foods</button>
      </div>
      <div id="m-search-panel" style="margin-top: 10px;"></div>
    </article>

    <div style="padding: 0 14px;">
      <div style="font-family: var(--font-mono); font-size: 10.5px; color: var(--ink-2); letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px;">Per serving</div>
    </div>
    <article class="card" style="margin: 0 14px 14px;">
      <div class="macro-tiles">
        <div class="macro-tile"><div class="v">${fmtMacro(n.kcal)}</div><div class="k">kcal</div></div>
        <div class="macro-tile"><div class="v">${fmtMacro(n.protein)}g</div><div class="k">protein</div></div>
        <div class="macro-tile"><div class="v">${fmtMacro(n.carbs)}g</div><div class="k">carbs</div></div>
        <div class="macro-tile"><div class="v">${fmtMacro(n.fat)}g</div><div class="k">fat</div></div>
      </div>
      <div class="macro-tiles secondary">
        <div class="macro-tile"><div class="v">${fmtMacro(n.fibre)}g</div><div class="k">fibre</div></div>
        <div class="macro-tile"><div class="v">${fmtMacro(n.sugar)}g</div><div class="k">sugar</div></div>
        <div class="macro-tile"><div class="v">${fmtSalt(n.salt)}g</div><div class="k">salt</div></div>
      </div>
    </article>
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
        unit: hit.unit ?? "g",
        kcalPer100: hit.kcalPer100,
        proteinPer100: hit.proteinPer100,
        carbsPer100: hit.carbsPer100,
        fatPer100: hit.fatPer100,
        fibrePer100: hit.fibrePer100,
        sugarPer100: hit.sugarPer100,
        saltPer100: hit.saltPer100,
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
