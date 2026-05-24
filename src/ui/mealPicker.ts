// Native <dialog> meal picker. Opens from every Week slot's trailing
// ＋/› button. Single interaction for "pick" + "clear" + "+ new meal".
//
// The trigger sets {day, slotId} before opening; this module commits
// the selection back into the store on tap.

import { getStore } from "../store";
import type { DayKey, Meal, SlotKey } from "../types";
import { mealNutrition, fmtMacro } from "../nutrition";
import { mealCategory, dotClass } from "../status";
import { esc, html, raw } from "./components";
import { DAYS } from "../types";

interface Target {
  day: DayKey;
  slotId: SlotKey;
}

let activeTarget: Target | null = null;
let onCommit: (() => void) | null = null;
let onCreateNew: ((target: Target) => void) | null = null;
let query = "";

export function setMealPickerCreateHook(fn: ((target: Target) => void) | null): void {
  onCreateNew = fn;
}

export function openMealPicker(target: Target, after: () => void): void {
  activeTarget = target;
  onCommit = after;
  query = "";
  const dialog = document.getElementById("meal-picker-dialog") as HTMLDialogElement | null;
  if (!dialog) return;
  render(dialog);
  if (!dialog.open) dialog.showModal();
}

function close(): void {
  const dialog = document.getElementById("meal-picker-dialog") as HTMLDialogElement | null;
  dialog?.close();
}

function commit(mealId: string | null): void {
  if (!activeTarget) return;
  const store = getStore();
  const { day, slotId } = activeTarget;
  if (!store.week[day]) store.week[day] = {};
  store.week[day][slotId] = mealId;
  const cb = onCommit;
  activeTarget = null;
  onCommit = null;
  close();
  cb?.();
}

function render(dialog: HTMLDialogElement): void {
  if (!activeTarget) return;
  const store = getStore();
  const meals = [...store.meals].sort((a, b) => a.name.localeCompare(b.name));
  const filtered = query
    ? meals.filter((m) => m.name.toLowerCase().includes(query.toLowerCase()))
    : meals;

  // "Recent" — meals most-recently used elsewhere in the current week,
  // ranked by frequency. The app doesn't track a pick history yet, so
  // this proxies for it cheaply.
  const usage = new Map<string, number>();
  for (const { key } of DAYS) {
    const day = store.week[key] ?? {};
    for (const sid of Object.keys(day)) {
      const id = day[sid];
      if (id) usage.set(id, (usage.get(id) ?? 0) + 1);
    }
  }
  const recent = [...usage.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id]) => meals.find((m) => m.id === id))
    .filter((m): m is Meal => Boolean(m))
    .filter((m) => !query || m.name.toLowerCase().includes(query.toLowerCase()));

  const dayLabel = DAYS.find((d) => d.key === activeTarget!.day)?.label ?? "";
  const slotLabel = store.slots.find((s) => s.id === activeTarget!.slotId)?.label ?? "";

  dialog.innerHTML = html`
    <div class="sheet">
      <div class="grab" aria-hidden="true"></div>
      <header class="hd">
        <h3>Pick a meal</h3>
        <span class="sub">${esc(dayLabel)} · ${esc(slotLabel)}</span>
      </header>
      <div class="search">
        <input
          id="mp-search"
          type="search"
          placeholder="Search meals…"
          value="${esc(query)}"
          autocomplete="off"
        />
      </div>
      ${raw(
        recent.length > 0
          ? `<div class="sect-h">Recent</div>` + recent.map((m) => renderMeal(m)).join("")
          : "",
      )}
      <div class="sect-h">All meals</div>
      ${raw(
        filtered.length === 0
          ? `<div class="empty">No meals match — try a different search, or create one below.</div>`
          : filtered.map((m) => renderMeal(m)).join(""),
      )}
      <footer class="footer">
        <button class="btn" id="mp-clear">Clear slot</button>
        <button class="btn primary" id="mp-new">＋ New meal</button>
      </footer>
    </div>
  `;

  wire(dialog);
}

function renderMeal(m: Meal): string {
  const store = getStore();
  const n = mealNutrition(m, store.ingredients);
  const cat = mealCategory(m, store.ingredients);
  return `
    <button class="meal" data-meal-id="${esc(m.id)}">
      <span class="${dotClass(cat)}" aria-hidden="true"></span>
      <div class="body">
        <div class="nm">${esc(m.name)}</div>
        <div class="mac">${fmtMacro(n.protein)}P · ${fmtMacro(n.carbs)}C · ${fmtMacro(n.fat)}F</div>
      </div>
      <div class="kc">${fmtMacro(n.kcal)}</div>
    </button>
  `;
}

function wire(dialog: HTMLDialogElement): void {
  dialog.querySelectorAll<HTMLButtonElement>("[data-meal-id]").forEach((btn) => {
    btn.addEventListener("click", () => commit(btn.dataset.mealId!));
  });

  const search = dialog.querySelector<HTMLInputElement>("#mp-search");
  search?.addEventListener("input", () => {
    query = search.value;
    render(dialog);
    dialog.querySelector<HTMLInputElement>("#mp-search")?.focus();
  });

  dialog.querySelector("#mp-clear")?.addEventListener("click", () => commit(null));

  dialog.querySelector("#mp-new")?.addEventListener("click", () => {
    if (!activeTarget) return;
    const target = activeTarget;
    activeTarget = null;
    const cb = onCommit;
    onCommit = null;
    close();
    onCreateNew?.(target);
    cb?.();
  });

  // Backdrop click → cancel. Native <dialog> dispatches the click with
  // target === dialog when the backdrop is hit; inner clicks bubble with
  // the inner element as the target.
  if (!dialog.dataset.backdropBound) {
    dialog.addEventListener("click", (e) => {
      if (e.target !== dialog) return;
      activeTarget = null;
      onCommit = null;
      dialog.close();
    });
    dialog.dataset.backdropBound = "1";
  }
}
