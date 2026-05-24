import { getStore } from "../store";
import { DAYS, SLOTS } from "../types";
import type { DayKey, SlotKey } from "../types";
import { dayTotals, fmtMacro, weekAverages } from "../nutrition";
import { emptyWeek } from "../state";
import { esc, html, raw, confirmAction } from "../ui/components";

export function renderWeek(target: HTMLElement): void {
  const store = getStore();
  const cells: string[] = [];

  // Header row: blank corner + day labels
  cells.push(`<div class="cell head"></div>`);
  for (const { label } of DAYS) cells.push(`<div class="cell head">${esc(label)}</div>`);

  // Slot rows
  for (const { key: slot, label: slotLabel } of SLOTS) {
    cells.push(`<div class="cell slot-label">${esc(slotLabel)}</div>`);
    for (const { key: day } of DAYS) {
      cells.push(`<div class="cell">${slotSelect(day, slot)}</div>`);
    }
  }

  // Per-day totals row
  cells.push(`<div class="cell slot-label totals">Day</div>`);
  for (const { key: day } of DAYS) {
    const t = dayTotals(store, day);
    cells.push(
      `<div class="cell totals">
        <div>${fmtMacro(t.kcal)} kcal</div>
        <div class="muted">${fmtMacro(t.protein)}g P</div>
      </div>`,
    );
  }

  const avg = weekAverages(store);
  const kcalClass = vsTarget(avg.kcal, store.targets.kcal, 100);
  const proteinClass = vsTarget(avg.protein, store.targets.protein, 10, true);

  target.innerHTML = html`
    <div class="view-header">
      <h2>Week</h2>
      <div class="row">
        <button id="dup-week" class="outline">Duplicate previous week</button>
        <button id="clear-week" class="outline secondary">Clear week</button>
      </div>
    </div>
    <div class="week-wrap">
      <div class="week-grid">${raw(cells.join(""))}</div>
    </div>
    <h3 style="margin-top: 1.5rem">Weekly average</h3>
    <p>
      <span class="${kcalClass}">${fmtMacro(avg.kcal)} kcal</span>
      <small class="muted">target ${store.targets.kcal}</small>
      ·
      <span class="${proteinClass}">${fmtMacro(avg.protein)}g protein</span>
      <small class="muted">target ${store.targets.protein}</small>
    </p>
  `;

  wire(target);
}

function slotSelect(day: DayKey, slot: SlotKey): string {
  const store = getStore();
  const eligible = [...store.meals].sort((a, b) => a.name.localeCompare(b.name));
  const current = store.week[day][slot];
  return `<select data-day="${day}" data-slot="${slot}">
    <option value="">— empty —</option>
    ${eligible
      .map(
        (m) =>
          `<option value="${esc(m.id)}" ${current === m.id ? "selected" : ""}>${esc(m.name)}</option>`,
      )
      .join("")}
  </select>`;
}

// Colour vs target. For kcal we colour by distance from target;
// for protein, only being under target is bad.
function vsTarget(value: number, target: number, tol: number, higherIsOk = false): string {
  if (target <= 0) return "";
  const diff = value - target;
  if (Math.abs(diff) <= tol) return "macro-good";
  if (higherIsOk && diff > 0) return "macro-good";
  if (diff > 0) return "macro-warn";
  return "macro-bad";
}

function wire(target: HTMLElement): void {
  const store = getStore();

  target.querySelectorAll<HTMLSelectElement>("select[data-day]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const day = sel.dataset.day as DayKey;
      const slot = sel.dataset.slot as SlotKey;
      store.week[day][slot] = sel.value || null;
      renderWeek(target);
    });
  });

  target.querySelector("#clear-week")?.addEventListener("click", () => {
    if (!confirmAction("Clear all slots for this week?")) return;
    store.week = emptyWeek();
    store.shoppingChecked = [];
    renderWeek(target);
  });

  // "Duplicate previous week" — no week history yet, so this re-applies the
  // current week to itself (no-op). Kept for future history support.
  target.querySelector("#dup-week")?.addEventListener("click", () => {
    alert("Week history isn't tracked yet — this will copy from a previous week once history is added.");
  });
}
