import { getStore } from "../store";
import { uid } from "../state";
import { INGREDIENT_CATEGORIES } from "../types";
import type { Ingredient, IngredientCategory, Unit } from "../types";
import { esc, html, raw, confirmAction } from "../ui/components";
import { mountFoodSearchPanel } from "../ui/foodSearchPanel";
import { shareIngredient, isSignedIn } from "../firebase/sharing";

type FilterCategory = IngredientCategory | "";

interface ViewState {
  query: string;
  category: FilterCategory;
  editingId: string | null;
  searching: boolean;
  scanning: boolean;
}

const view: ViewState = {
  query: "",
  category: "",
  editingId: null,
  searching: false,
  scanning: false,
};

const UNITS: Unit[] = ["g", "ml", "unit"];
// Category swatches used in the filter pills + cat-tag — Brief lists 5.
// "Other" stays in the data model but is hidden from the pill row.
const PILL_CATEGORIES: IngredientCategory[] = ["Protein", "Carbs", "Produce", "Dairy", "Pantry"];

export function renderIngredients(target: HTMLElement): void {
  const store = getStore();
  const filtered = store.ingredients
    .filter((i) => (view.query ? i.name.toLowerCase().includes(view.query.toLowerCase()) : true))
    .filter((i) => (view.category ? i.category === view.category : true))
    .sort((a, b) => a.name.localeCompare(b.name));

  target.innerHTML = html`
    <div class="page-h">
      <div>
        <span class="eyebrow">Library · per 100 g/ml</span>
        <h1>Ingredients</h1>
      </div>
      <button class="btn primary" id="add-ing">＋ Add ingredient</button>
    </div>

    <button class="scan-cta" id="scan-cta">
      <span class="ic" aria-hidden="true">⌖</span>
      <div class="body">
        <div class="t">Scan a barcode</div>
        <div class="s">Pulls macros from Open Food Facts</div>
      </div>
      <span class="arrow" aria-hidden="true">›</span>
    </button>

    <div class="search-card">
      <input type="search" id="ing-search" value="${esc(view.query)}" placeholder="Filter your list…" />
    </div>

    <div class="filter-pills">
      <button class="pill ${view.category === "" ? "cur" : ""}" data-cat="">All</button>
      ${raw(
        PILL_CATEGORIES.map(
          (c) =>
            `<button class="pill ${view.category === c ? "cur" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`,
        ).join(""),
      )}
    </div>

    <div id="ing-search-panel"></div>

    <div class="ingr-list">
      ${raw(
        filtered.length === 0
          ? `<p class="muted" style="padding: 18px;">${store.ingredients.length === 0 ? "No ingredients yet. Tap ＋ Add ingredient or scan a barcode." : "No ingredients match."}</p>`
          : filtered.map((r) => renderRowOrEdit(r)).join(""),
      )}
    </div>
  `;

  if (view.searching) {
    const panel = target.querySelector<HTMLElement>("#ing-search-panel")!;
    mountFoodSearchPanel(panel, {
      placeholder: "Search foods to auto-fill macros…",
      manualLabel: "Add manually instead",
      autoOpenScanner: view.scanning,
      onCancel: () => {
        view.searching = false;
        view.scanning = false;
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
          view.scanning = false;
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
          view.scanning = false;
          view.editingId = fresh.id;
        }
        renderIngredients(target);
      },
    });
  }

  wire(target);
}

function renderRowOrEdit(r: Ingredient): string {
  if (view.editingId === r.id) return renderEditCard(r);
  return renderRow(r);
}

function renderRow(r: Ingredient): string {
  const perLabel = r.unit === "unit" ? "/unit" : "/100" + r.unit;
  const catSlug = r.category.toLowerCase();
  return `<div class="ingr-row" data-row="${esc(r.id)}">
    <div>
      <div class="nm">${esc(r.name)}</div>
      <div class="meta">${fmt(r.kcalPer100)} kcal · ${fmt(r.proteinPer100)}P · ${fmt(r.carbsPer100)}C · ${fmt(r.fatPer100)}F ${esc(perLabel)}</div>
    </div>
    <div class="right">
      <span class="cat-tag ${esc(catSlug)}">${esc(r.category)}</span>
      <button class="row-action" data-edit="${esc(r.id)}" aria-label="Edit">✎</button>
      ${isSignedIn() ? `<button class="row-action" data-share="${esc(r.id)}" aria-label="Share">↗</button>` : ""}
      <button class="row-action danger" data-del="${esc(r.id)}" aria-label="Delete">✕</button>
    </div>
  </div>`;
}

function renderEditCard(r: Ingredient): string {
  return `<div class="ingr-edit" data-edit-row="${esc(r.id)}">
    <label>Name <input name="name" value="${esc(r.name)}" /></label>
    <div class="grid" style="margin-top: 10px;">
      <label>Unit
        <select name="unit">
          ${UNITS.map((u) => `<option value="${u}" ${r.unit === u ? "selected" : ""}>${u}</option>`).join("")}
        </select>
      </label>
      <label>Category
        <select name="category">
          ${INGREDIENT_CATEGORIES.map(
            (c) => `<option value="${c}" ${r.category === c ? "selected" : ""}>${c}</option>`,
          ).join("")}
        </select>
      </label>
      <label>kcal /100 <input name="kcal" type="number" step="any" value="${r.kcalPer100}" /></label>
      <label>Protein g <input name="protein" type="number" step="any" value="${r.proteinPer100}" /></label>
      <label>Carbs g <input name="carbs" type="number" step="any" value="${r.carbsPer100}" /></label>
      <label>Fat g <input name="fat" type="number" step="any" value="${r.fatPer100}" /></label>
    </div>
    <div class="actions">
      <button class="btn primary" data-save="${esc(r.id)}">Save</button>
      <button class="btn ghost" data-cancel>Cancel</button>
    </div>
  </div>`;
}

function fmt(n: number): string {
  return Math.round(n * 10) / 10 + "";
}

function wire(root: HTMLElement): void {
  const store = getStore();

  root.querySelector("#add-ing")?.addEventListener("click", () => {
    view.searching = true;
    view.scanning = false;
    renderIngredients(root);
  });

  root.querySelector("#scan-cta")?.addEventListener("click", () => {
    view.searching = true;
    view.scanning = true;
    renderIngredients(root);
  });

  root.querySelector("#ing-search")?.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    const caret = t.selectionStart;
    view.query = t.value;
    renderIngredients(root);
    // Re-render replaces the input; restore focus + caret so typing
    // doesn't drop the cursor between keystrokes.
    const fresh = root.querySelector<HTMLInputElement>("#ing-search");
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

  root.querySelectorAll<HTMLButtonElement>("[data-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      view.category = btn.dataset.cat as FilterCategory;
      renderIngredients(root);
    });
  });

  root.querySelectorAll<HTMLElement>("[data-edit]").forEach((el) => {
    el.addEventListener("click", () => {
      view.editingId = el.dataset.edit!;
      renderIngredients(root);
    });
  });

  root.querySelectorAll<HTMLElement>("[data-share]").forEach((el) => {
    el.addEventListener("click", async () => {
      const id = el.dataset.share!;
      const ing = store.ingredients.find((i) => i.id === id);
      if (!ing) return;
      if (!confirmAction(`Share "${ing.name}" to the public area?`)) return;
      try {
        await shareIngredient(store, ing);
        alert("Shared. Browse it under the Share tab.");
      } catch (err) {
        alert("Couldn't share: " + (err instanceof Error ? err.message : String(err)));
      }
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
      const row = root.querySelector<HTMLElement>(`[data-edit-row="${id}"]`);
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
