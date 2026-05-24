import { getStore } from "../store";
import { aggregateShopping, formatAmount, shoppingAsMarkdown } from "../shopping";
import { esc, html, raw, confirmAction } from "../ui/components";
import type { IngredientCategory } from "../types";

export function renderShopping(target: HTMLElement): void {
  const store = getStore();
  const groups = aggregateShopping(store);
  const totalItems = groups.reduce((sum, g) => sum + g.lines.length, 0);
  const checked = groups.reduce(
    (sum, g) => sum + g.lines.filter((l) => store.shoppingChecked.includes(l.ingredientId)).length,
    0,
  );
  const pct = totalItems > 0 ? Math.round((checked / totalItems) * 100) : 0;
  const ringDash = totalItems > 0 ? (checked / totalItems) * 100 : 0;

  target.innerHTML = html`
    <div class="page-h">
      <div>
        <span class="eyebrow">Auto-generated · this week</span>
        <h1>Shopping</h1>
      </div>
      <div class="row" style="gap: 6px;">
        <button class="btn" id="copy-md">Copy as text</button>
        <button class="btn ghost" id="reset-checks">Reset checks</button>
      </div>
    </div>

    ${raw(
      groups.length === 0
        ? `<p class="muted" style="padding: 0 18px;">No meals on the week plan yet.</p>`
        : `<div class="shop-summary">
            <svg class="ring" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
              <circle class="bg" cx="22" cy="22" r="20" fill="none" stroke-width="5"></circle>
              <circle class="fg accent" cx="22" cy="22" r="20" fill="none" stroke-width="5"
                      stroke-dasharray="${ringDash.toFixed(1)} 100"></circle>
            </svg>
            <div class="info">
              <div class="l">${pct}% picked up</div>
              <div class="v">${checked} of ${totalItems} item${totalItems === 1 ? "" : "s"} · ${groups.length} aisle${groups.length === 1 ? "" : "s"}</div>
            </div>
          </div>` +
          groups
            .map((g) => {
              const groupChecked = g.lines.filter((l) =>
                store.shoppingChecked.includes(l.ingredientId),
              ).length;
              const catSlug = categorySlug(g.category);
              return `<div class="cat-h ${esc(catSlug)}">
                <span class="swatch"></span>
                <span>${esc(g.category)}</span>
                <span class="count">${groupChecked}/${g.lines.length}</span>
              </div>
              <div class="cat-group">
                ${g.lines
                  .map((l) => {
                    const done = store.shoppingChecked.includes(l.ingredientId);
                    return `<label class="item ${done ? "done" : ""}" data-line="${esc(l.ingredientId)}">
                      <span class="ck"></span>
                      <input type="checkbox" hidden data-id="${esc(l.ingredientId)}" ${done ? "checked" : ""} />
                      <span class="nm">${esc(l.name)}</span>
                      <span class="q">${esc(formatAmount(l.amount, l.unit))}</span>
                    </label>`;
                  })
                  .join("")}
              </div>`;
            })
            .join(""),
    )}
  `;

  target.querySelectorAll<HTMLInputElement>("input[data-id]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const id = cb.dataset.id!;
      if (cb.checked) {
        if (!store.shoppingChecked.includes(id)) store.shoppingChecked.push(id);
      } else {
        store.shoppingChecked = store.shoppingChecked.filter((x) => x !== id);
      }
      renderShopping(target);
    });
  });

  target.querySelector("#copy-md")?.addEventListener("click", async () => {
    const md = shoppingAsMarkdown(groups);
    try {
      await navigator.clipboard.writeText(md);
      alert("Copied to clipboard.");
    } catch {
      window.prompt("Copy the shopping list:", md);
    }
  });

  target.querySelector("#reset-checks")?.addEventListener("click", () => {
    if (!confirmAction("Uncheck all items?")) return;
    store.shoppingChecked = [];
    renderShopping(target);
  });
}

function categorySlug(cat: IngredientCategory): string {
  // The brief's 5 categories map straight to slugs; "Other" falls through
  // to a neutral swatch (handled by the .cat-h default rule).
  return cat.toLowerCase();
}
