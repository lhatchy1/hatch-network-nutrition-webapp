import { getStore } from "../store";
import { uid } from "../state";
import { INGREDIENT_CATEGORIES } from "../types";
import type { Ingredient, IngredientCategory, Unit } from "../types";
import { esc, html, raw, confirmAction } from "../ui/components";
import { mountFoodSearchPanel } from "../ui/foodSearchPanel";

type SortKey = keyof Pick<
  Ingredient,
  "name" | "unit" | "kcalPer100" | "proteinPer100" | "carbsPer100" | "fatPer100" | "category"
>;

interface ViewState {
  query: string;
  category: IngredientCategory | "";
  sort: SortKey;
  dir: 1 | -1;
  editingId: string | null;
  searching: boolean;
}

const view: ViewState = {
  query: "",
  category: "",
  sort: "name",
  dir: 1,
  editingId: null,
  searching: false,
};

const UNITS: Unit[] = ["g", "ml", "unit"];

export function renderIngredients(target: HTMLElement): void {
  const store = getStore();
  const filtered = store.ingredients
    .filter((i) => (view.query ? i.name.toLowerCase().includes(view.query.toLowerCase()) : true))
    .filter((i) => (view.category ? i.category === view.category : true))
    .sort((a, b) => {
      const av = a[view.sort];
      const bv = b[view.sort];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * view.dir;
      return String(av).localeCompare(String(bv)) * view.dir;
    });

  target.innerHTML = html`
    <div class="view-header">
      <h2>Ingredients</h2>
      <button id="add-ing">+ Add ingredient</button>
    </div>
    <div id="ing-search-panel"></div>
    <div class="row" style="margin-bottom: 0.5rem">
      <input type="search" id="ing-search" class="grow" placeholder="Filter your list…" value="${view.query}" />
      <select id="ing-cat">
        <option value="">All categories</option>
        ${raw(
          INGREDIENT_CATEGORIES.map(
            (c) => `<option value="${esc(c)}" ${view.category === c ? "selected" : ""}>${esc(c)}</option>`,
          ).join(""),
        )}
      </select>
    </div>
    ${raw(renderTable(filtered))}
  `;

  if (view.searching) {
    const panel = target.querySelector<HTMLElement>("#ing-search-panel")!;
    mountFoodSearchPanel(panel, {
      placeholder: "Search foods to auto-fill macros…",
      manualLabel: "Add manually instead",
      onCancel: () => {
        view.searching = false;
        renderIngredients(target);
      },
      onPick: (hit) => {
        const store = getStore();
        if (hit) {
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
          view.searching = false;
          view.editingId = null;
        } else {
          const fresh: Ingredient = {
            id: uid(),
            name: "New ingredient",
            unit: "g",
            kcalPer100: 0,
            proteinPer100: 0,
            carbsPer100: 0,
            fatPer100: 0,
            category: "Other",
          };
          store.ingredients.push(fresh);
          view.searching = false;
          view.editingId = fresh.id;
        }
        renderIngredients(target);
      },
    });
  }

  wire(target);
}

function renderTable(rows: Ingredient[]): string {
  if (rows.length === 0) {
    return `<p class="muted">No ingredients yet. Click <em>Add ingredient</em> to start.</p>`;
  }
  const th = (key: SortKey, label: string, cls = "") => {
    const arrow = view.sort === key ? (view.dir === 1 ? " ↑" : " ↓") : "";
    return `<th class="${cls}" style="cursor:pointer" data-sort="${key}">${esc(label)}${arrow}</th>`;
  };
  return `
    <figure>
    <table role="grid">
      <thead><tr>
        ${th("name", "Name")}
        ${th("unit", "Unit")}
        ${th("kcalPer100", "kcal", "right")}
        ${th("proteinPer100", "P", "right")}
        ${th("carbsPer100", "C", "right")}
        ${th("fatPer100", "F", "right")}
        ${th("category", "Category")}
        <th></th>
      </tr></thead>
      <tbody>
        ${rows.map((r) => renderRow(r)).join("")}
      </tbody>
    </table>
    </figure>
  `;
}

function renderRow(r: Ingredient): string {
  if (view.editingId === r.id) return renderEditRow(r);
  const perLabel = r.unit === "unit" ? "/unit" : "/100";
  return `
    <tr class="ingredient-row">
      <td>${esc(r.name)}</td>
      <td>${esc(r.unit)}</td>
      <td class="right nowrap">${fmt(r.kcalPer100)}<small class="muted">${perLabel}</small></td>
      <td class="right">${fmt(r.proteinPer100)}</td>
      <td class="right">${fmt(r.carbsPer100)}</td>
      <td class="right">${fmt(r.fatPer100)}</td>
      <td>${esc(r.category)}</td>
      <td class="actions">
        <button class="outline" data-edit="${esc(r.id)}">Edit</button>
        <button class="outline secondary" data-del="${esc(r.id)}">Delete</button>
      </td>
    </tr>
  `;
}

function renderEditRow(r: Ingredient): string {
  return `
    <tr class="ingredient-row" data-edit-row="${esc(r.id)}">
      <td><input name="name" value="${esc(r.name)}" /></td>
      <td>
        <select name="unit">
          ${UNITS.map((u) => `<option value="${u}" ${r.unit === u ? "selected" : ""}>${u}</option>`).join("")}
        </select>
      </td>
      <td><input name="kcal" type="number" step="any" value="${r.kcalPer100}" /></td>
      <td><input name="protein" type="number" step="any" value="${r.proteinPer100}" /></td>
      <td><input name="carbs" type="number" step="any" value="${r.carbsPer100}" /></td>
      <td><input name="fat" type="number" step="any" value="${r.fatPer100}" /></td>
      <td>
        <select name="category">
          ${INGREDIENT_CATEGORIES.map(
            (c) => `<option value="${c}" ${r.category === c ? "selected" : ""}>${c}</option>`,
          ).join("")}
        </select>
      </td>
      <td class="actions">
        <button data-save="${esc(r.id)}">Save</button>
        <button class="outline" data-cancel>Cancel</button>
      </td>
    </tr>
  `;
}

function fmt(n: number): string {
  return Math.round(n * 10) / 10 + "";
}

function wire(root: HTMLElement): void {
  const store = getStore();

  root.querySelector("#add-ing")?.addEventListener("click", () => {
    view.searching = !view.searching;
    renderIngredients(root);
  });

  root.querySelector("#ing-search")?.addEventListener("input", (e) => {
    view.query = (e.target as HTMLInputElement).value;
    renderIngredients(root);
  });

  root.querySelector("#ing-cat")?.addEventListener("change", (e) => {
    view.category = (e.target as HTMLSelectElement).value as IngredientCategory | "";
    renderIngredients(root);
  });

  root.querySelectorAll<HTMLElement>("[data-sort]").forEach((el) => {
    el.addEventListener("click", () => {
      const key = el.dataset.sort as SortKey;
      if (view.sort === key) view.dir = view.dir === 1 ? -1 : 1;
      else {
        view.sort = key;
        view.dir = 1;
      }
      renderIngredients(root);
    });
  });

  root.querySelectorAll<HTMLElement>("[data-edit]").forEach((el) => {
    el.addEventListener("click", () => {
      view.editingId = el.dataset.edit!;
      renderIngredients(root);
    });
  });

  root.querySelectorAll<HTMLElement>("[data-del]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.del!;
      const ing = store.ingredients.find((i) => i.id === id);
      if (!ing) return;
      if (!confirmAction(`Delete "${ing.name}"? This won't remove it from existing meals.`)) return;
      store.ingredients = store.ingredients.filter((i) => i.id !== id);
      renderIngredients(root);
    });
  });

  root.querySelectorAll<HTMLElement>("[data-save]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.save!;
      const row = root.querySelector<HTMLTableRowElement>(`[data-edit-row="${id}"]`);
      if (!row) return;
      const get = (n: string) =>
        (row.querySelector(`[name="${n}"]`) as HTMLInputElement | HTMLSelectElement).value;
      const ing = store.ingredients.find((i) => i.id === id);
      if (!ing) return;
      const name = get("name").trim();
      if (!name) {
        alert("Name is required.");
        return;
      }
      ing.name = name;
      ing.unit = get("unit") as Unit;
      ing.kcalPer100 = Number(get("kcal")) || 0;
      ing.proteinPer100 = Number(get("protein")) || 0;
      ing.carbsPer100 = Number(get("carbs")) || 0;
      ing.fatPer100 = Number(get("fat")) || 0;
      ing.category = get("category") as IngredientCategory;
      view.editingId = null;
      renderIngredients(root);
    });
  });

  root.querySelector<HTMLElement>("[data-cancel]")?.addEventListener("click", () => {
    // If we cancelled on a freshly-added (still default-named) row, drop it.
    const id = view.editingId;
    if (id) {
      const ing = store.ingredients.find((i) => i.id === id);
      if (ing && ing.name === "New ingredient" && ing.kcalPer100 === 0) {
        store.ingredients = store.ingredients.filter((i) => i.id !== id);
      }
    }
    view.editingId = null;
    renderIngredients(root);
  });
}
