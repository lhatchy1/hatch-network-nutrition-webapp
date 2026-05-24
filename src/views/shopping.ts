import { getStore } from "../store";
import { aggregateShopping, formatAmount, shoppingAsMarkdown } from "../shopping";
import { esc, html, raw, confirmAction } from "../ui/components";

export function renderShopping(target: HTMLElement): void {
  const store = getStore();
  const groups = aggregateShopping(store);

  target.innerHTML = html`
    <div class="view-header">
      <h2>Shopping list</h2>
      <div class="row">
        <button id="copy-md" class="outline">Copy as text</button>
        <button id="reset-checks" class="outline secondary">Reset checks</button>
      </div>
    </div>
    ${raw(
      groups.length === 0
        ? `<p class="muted">No meals on the week plan yet.</p>`
        : groups
            .map(
              (g) => `
              <section class="shopping-group">
                <h3>${esc(g.category)}</h3>
                ${g.lines
                  .map((l) => {
                    const checked = store.shoppingChecked.includes(l.ingredientId);
                    return `<label class="shopping-line ${checked ? "checked" : ""}">
                      <input type="checkbox" data-id="${esc(l.ingredientId)}" ${checked ? "checked" : ""} />
                      <span>${esc(l.name)}</span>
                      <span class="amount">${esc(formatAmount(l.amount, l.unit))}</span>
                    </label>`;
                  })
                  .join("")}
              </section>`,
            )
            .join(""),
    )}
  `;

  target.querySelectorAll<HTMLInputElement>("input[data-id]").forEach((el) => {
    el.addEventListener("change", () => {
      const id = el.dataset.id!;
      if (el.checked) {
        if (!store.shoppingChecked.includes(id)) store.shoppingChecked.push(id);
      } else {
        store.shoppingChecked = store.shoppingChecked.filter((x) => x !== id);
      }
      // Re-render only the line's style — but cheapest is a full re-render.
      renderShopping(target);
    });
  });

  target.querySelector("#copy-md")?.addEventListener("click", async () => {
    const md = shoppingAsMarkdown(groups);
    try {
      await navigator.clipboard.writeText(md);
      alert("Copied to clipboard.");
    } catch {
      // Fallback: open a prompt the user can copy from.
      window.prompt("Copy the shopping list:", md);
    }
  });

  target.querySelector("#reset-checks")?.addEventListener("click", () => {
    if (!confirmAction("Uncheck all items?")) return;
    store.shoppingChecked = [];
    renderShopping(target);
  });
}
