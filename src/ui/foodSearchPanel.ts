// Reusable inline food-search panel used by the ingredients view and the meal
// editor. Renders a search input + results list, debounces network calls, and
// calls back with a chosen FoodHit (or null when "Add manually" is clicked).

import { searchFoods } from "../api/foodSearch";
import type { FoodHit } from "../api/foodSearch";
import { esc, html, raw } from "./components";

export interface PanelOptions {
  /** Called with a chosen hit; called with null when the user picks manual entry. */
  onPick: (hit: FoodHit | null) => void;
  /** Called when the user dismisses the panel without picking anything. */
  onCancel?: () => void;
  placeholder?: string;
  /** If set, renders an "Add manually" fallback button; omit to hide it. */
  manualLabel?: string;
}

const DEBOUNCE_MS = 300;

export function mountFoodSearchPanel(container: HTMLElement, opts: PanelOptions): void {
  container.innerHTML = html`
    <div class="food-search">
      <div class="row">
        <input
          type="search"
          class="grow"
          data-food-q
          autocomplete="off"
          placeholder="${opts.placeholder ?? "Search foods (e.g. chicken breast)…"}"
        />
        <button class="outline secondary" data-food-cancel>Cancel</button>
      </div>
      <p class="muted food-status" data-food-status>
        <small>Type at least 2 letters. Powered by Open Food Facts.</small>
      </p>
      <div class="food-results" data-food-results></div>
      ${raw(
        opts.manualLabel
          ? `<p><button class="outline" data-food-manual>${esc(opts.manualLabel)}</button></p>`
          : "",
      )}
    </div>
  `;

  const input = container.querySelector<HTMLInputElement>("[data-food-q]")!;
  const results = container.querySelector<HTMLElement>("[data-food-results]")!;
  const status = container.querySelector<HTMLElement>("[data-food-status]")!;
  const manual = container.querySelector<HTMLButtonElement>("[data-food-manual]");
  const cancel = container.querySelector<HTMLButtonElement>("[data-food-cancel]")!;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: AbortController | null = null;
  let latestHits: FoodHit[] = [];

  const setStatus = (msg: string) => {
    status.innerHTML = `<small>${esc(msg)}</small>`;
  };

  const run = async (q: string) => {
    if (inflight) inflight.abort();
    if (q.trim().length < 2) {
      latestHits = [];
      results.innerHTML = "";
      setStatus("Type at least 2 letters. Powered by Open Food Facts.");
      return;
    }
    setStatus("Searching…");
    const ctrl = new AbortController();
    inflight = ctrl;
    try {
      const hits = await searchFoods(q, ctrl.signal);
      if (ctrl.signal.aborted) return;
      latestHits = hits;
      renderResults(results, hits);
      setStatus(
        hits.length === 0
          ? "No matches with macros found. Try a simpler query."
          : `${hits.length} match${hits.length === 1 ? "" : "es"} — click one to add.`,
      );
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      console.error(err);
      setStatus("Couldn't reach Open Food Facts. Check your connection or add manually.");
    }
  };

  input.addEventListener("input", () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => run(input.value), DEBOUNCE_MS);
  });

  // Press Enter to skip the debounce.
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (timer) clearTimeout(timer);
      run(input.value);
    }
  });

  results.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-pick]");
    if (!btn) return;
    const idx = Number(btn.dataset.pick);
    const hit = latestHits[idx];
    if (hit) opts.onPick(hit);
  });

  manual?.addEventListener("click", () => opts.onPick(null));
  cancel.addEventListener("click", () => opts.onCancel?.());

  // Autofocus so the user can start typing immediately.
  queueMicrotask(() => input.focus());
}

function renderResults(target: HTMLElement, hits: FoodHit[]): void {
  if (hits.length === 0) {
    target.innerHTML = "";
    return;
  }
  target.innerHTML = html`
    <ul class="food-hits">
      ${raw(
        hits
          .map(
            (h, i) => `
        <li>
          <button class="food-hit" data-pick="${i}">
            <span class="food-hit-name">
              ${esc(h.name)}${h.brand ? ` <span class="muted">· ${esc(h.brand)}</span>` : ""}
            </span>
            <span class="food-hit-macros muted">
              ${h.kcalPer100} kcal · ${h.proteinPer100}g P · ${h.carbsPer100}g C · ${h.fatPer100}g F
              <small>per 100g</small>
            </span>
          </button>
        </li>`,
          )
          .join(""),
      )}
    </ul>
  `;
}
