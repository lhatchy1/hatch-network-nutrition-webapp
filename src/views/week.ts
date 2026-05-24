import { getStore } from "../store";
import { DAYS } from "../types";
import type { DayKey } from "../types";
import { dayTotals, fmtMacro, mealNutrition, weekAverages } from "../nutrition";
import { emptyWeek } from "../state";
import { esc, html, raw, confirmAction } from "../ui/components";
import { shareWeekPlan, isSignedIn } from "../firebase/sharing";
import { status, statusClass, mealCategory, dotClass } from "../status";
import type { Nutrition } from "../types";
import { openMealPicker } from "../ui/mealPicker";

// Active day for the mobile single-day view. Lives outside the store on
// purpose — it's an ephemeral viewport concern, not user data to persist.
let activeDay: DayKey = currentDayKey();

function currentDayKey(): DayKey {
  const idx = (new Date().getDay() + 6) % 7; // Mon=0
  return DAYS[idx].key;
}

export function renderWeek(target: HTMLElement): void {
  const store = getStore();
  const slots = store.slots;
  const t = store.targets;

  if (slots.length === 0) {
    target.innerHTML = html`
      <div class="page-h">
        <span class="eyebrow">This week</span>
        <h1>Week</h1>
      </div>
      <p class="muted" style="padding: 0 18px;">
        You have no meal slots configured. Open <strong>Settings</strong> and add a slot
        (e.g. Breakfast, Lunch, Snack) to start planning.
      </p>
    `;
    return;
  }

  // Per-day totals + statuses for the daystrip + today card.
  const totalsByDay = new Map<DayKey, Nutrition>();
  for (const { key } of DAYS) totalsByDay.set(key, dayTotals(store, key));

  const today = activeDay;
  const todayLabel = DAYS.find((d) => d.key === today)?.label ?? "";
  const todayTotals = totalsByDay.get(today)!;

  const filledCount = slots.reduce(
    (n, s) => (store.week[today]?.[s.id] ? n + 1 : n),
    0,
  );

  const avg = weekAverages(store);
  const avgKcalKey = status("kcal", avg.kcal, t.kcal);
  const avgProtKey = status("protein", avg.protein, t.protein);
  const monday = mondayOf(new Date());
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmtDate = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const weekRange = `${fmtDate(monday)} → ${fmtDate(sunday)}`;

  target.innerHTML = html`
    <header class="page-h">
      <div>
        <span class="eyebrow">This week</span>
        <h1 class="page-h-title-mobile">${esc(longDayName(todayLabel))}</h1>
        <div class="page-h-title-desktop">
          <h1>${esc(weekRange)}</h1>
          <div class="week-stats">
            <span><b class="v-${avgKcalKey}">${formatInt(avg.kcal)}</b><em>kcal avg</em></span>
            <span><b class="v-${avgProtKey}">${formatInt(avg.protein)}g</b><em>protein</em></span>
            <span><b>${formatInt(avg.carbs)}g</b><em>carbs</em></span>
            <span><b>${formatInt(avg.fat)}g</b><em>fat</em></span>
          </div>
        </div>
      </div>
      <div class="row" style="gap: 6px;">
        <button class="btn" id="share-week">Share week</button>
        <button class="btn ghost" id="dup-week">Duplicate previous</button>
        <button class="btn danger" id="clear-week">Clear week</button>
      </div>
    </header>

    ${raw(renderDaystrip(totalsByDay, t))}
    ${raw(renderTodayCard(today, todayLabel, filledCount, todayTotals, t))}
    ${raw(renderDesktopGrid(totalsByDay, t))}
  `;

  wire(target);
}

function renderDaystrip(
  totalsByDay: Map<DayKey, Nutrition>,
  t: { kcal: number; protein: number; carbs: number; fat: number },
): string {
  const today = currentDayKey();
  const monday = mondayOf(new Date());
  const buttons = DAYS.map((d, i) => {
    const totals = totalsByDay.get(d.key)!;
    const dayStatus = worstStatus(totals, t);
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    const isCur = activeDay === d.key;
    const hasMeals = totals.kcal > 0;
    return `<button class="d ${isCur ? "cur" : ""}" data-day="${d.key}" role="tab" aria-selected="${isCur}">
      <span class="lt">${d.label.charAt(0)}</span>
      <span class="num">${date.getDate()}</span>
      ${hasMeals ? `<span class="status v-${dayStatus}" aria-hidden="true"></span>` : ""}
      ${d.key === today && !isCur ? "" : ""}
    </button>`;
  }).join("");
  return `<div class="daystrip" role="tablist" aria-label="Day of week">${buttons}</div>`;
}

function renderTodayCard(
  today: DayKey,
  todayLabel: string,
  filled: number,
  totals: Nutrition,
  t: { kcal: number; protein: number; carbs: number; fat: number },
): string {
  const store = getStore();
  const slots = store.slots;
  const dateLabel = formatDayDate(today);

  const kcalKey = status("kcal", totals.kcal, t.kcal);
  const protKey = status("protein", totals.protein, t.protein);
  const carbKey = status("carbs", totals.carbs, t.carbs);
  const fatKey = status("fat", totals.fat, t.fat);

  return `<article class="today-card" id="today">
    <header class="day-h">
      <div class="dn">${esc(longDayName(todayLabel))} · ${esc(dateLabel)}</div>
      <div class="dt">${filled}/${slots.length} slots filled</div>
    </header>

    <div class="rings">
      ${ring(totals.kcal, t.kcal, kcalKey, "kcal", formatInt(totals.kcal))}
      ${ring(totals.protein, t.protein, protKey, "protein", formatInt(totals.protein) + "g")}
      ${ring(totals.carbs, t.carbs, carbKey, "carbs", formatInt(totals.carbs) + "g")}
      ${ring(totals.fat, t.fat, fatKey, "fat", formatInt(totals.fat) + "g")}
    </div>

    <div class="slots">
      ${slots
        .map((s) => {
          const mealId = store.week[today]?.[s.id] ?? null;
          const meal = mealId ? store.meals.find((m) => m.id === mealId) : null;
          if (!meal) {
            return `<div class="slot empty" data-slot="${esc(s.id)}">
              <div class="body">
                <div class="lab">${esc(s.label)}</div>
                <div class="nm">Not planned</div>
              </div>
              <button class="plus" data-pick="${esc(s.id)}" aria-label="Pick a meal">＋</button>
            </div>`;
          }
          const cat = mealCategory(meal, store.ingredients);
          const n = mealNutrition(meal, store.ingredients);
          return `<div class="slot" data-slot="${esc(s.id)}">
            <div class="body">
              <div class="lab">${esc(s.label)}</div>
              <div class="nm">
                <span class="${dotClass(cat)}" aria-hidden="true"></span>
                ${esc(meal.name)}
              </div>
            </div>
            <div class="kc">${fmtMacro(n.kcal)} · ${fmtMacro(n.protein)}P</div>
            <button class="chevron" data-pick="${esc(s.id)}" aria-label="Open meal">›</button>
          </div>`;
        })
        .join("")}
    </div>
  </article>`;
}

function renderDesktopGrid(
  totalsByDay: Map<DayKey, Nutrition>,
  t: { kcal: number; protein: number; carbs: number; fat: number },
): string {
  const store = getStore();
  const slots = store.slots;
  const today = currentDayKey();
  const monday = mondayOf(new Date());

  const cols = DAYS.map((d, i) => {
    const totals = totalsByDay.get(d.key)!;
    const isCur = d.key === today;
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);

    const kcalKey = status("kcal", totals.kcal, t.kcal);
    const protKey = status("protein", totals.protein, t.protein);

    const mealRows = slots
      .map((s) => {
        const mealId = store.week[d.key]?.[s.id] ?? null;
        const meal = mealId ? store.meals.find((m) => m.id === mealId) : null;
        if (!meal) {
          return `<button class="meal empty" data-day="${d.key}" data-pick="${esc(s.id)}">
            <div class="lab">${esc(s.label)}</div>
            <div class="nm">Not planned</div>
          </button>`;
        }
        const cat = mealCategory(meal, store.ingredients);
        const n = mealNutrition(meal, store.ingredients);
        return `<button class="meal" data-day="${d.key}" data-pick="${esc(s.id)}">
          <div class="lab">${esc(s.label)}</div>
          <div class="nm"><span class="${dotClass(cat)} sm"></span>${esc(meal.name)}</div>
          <div class="kc">${fmtMacro(n.kcal)} · ${fmtMacro(n.protein)}P</div>
        </button>`;
      })
      .join("");

    return `<article class="day-col ${isCur ? "cur" : ""}">
      <header class="h"><div class="dn">${d.label}</div><div class="dt">${date.getDate()}</div></header>
      ${mealRows}
      <div class="day-totals">
        <div class="big v-${kcalKey}">${formatInt(totals.kcal)}</div>
        <div class="of">/ ${t.kcal.toLocaleString()} kcal</div>
        <div class="macros">
          <span>P <b class="v-${protKey}">${formatInt(totals.protein)}</b></span>
          <span>C <b>${formatInt(totals.carbs)}</b></span>
          <span>F <b>${formatInt(totals.fat)}</b></span>
        </div>
      </div>
    </article>`;
  }).join("");

  return `<div class="week-grid">${cols}</div>`;
}

function ring(
  value: number,
  target: number,
  key: ReturnType<typeof status>,
  label: string,
  display: string,
): string {
  const pct = target > 0 ? Math.max(0, Math.min(100, (value / target) * 100)) : 0;
  return `<div class="r">
    <svg class="ring" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
      <circle class="bg" cx="18" cy="18" r="16" fill="none" stroke-width="4"></circle>
      <circle class="fg ${statusClass(key)}" cx="18" cy="18" r="16" fill="none" stroke-width="4"
              stroke-dasharray="${pct.toFixed(1)} 100"></circle>
    </svg>
    <div class="v">${esc(display)}</div>
    <div class="k">${esc(label)}</div>
  </div>`;
}

function worstStatus(
  totals: Nutrition,
  t: { kcal: number; protein: number; carbs: number; fat: number },
): "under" | "near" | "over" {
  const keys = [
    status("kcal", totals.kcal, t.kcal),
    status("protein", totals.protein, t.protein),
    status("carbs", totals.carbs, t.carbs),
    status("fat", totals.fat, t.fat),
  ];
  if (keys.includes("over")) return "over";
  if (keys.includes("under")) return "under";
  return "near";
}

function mondayOf(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay();
  const diff = (day + 6) % 7;
  out.setDate(out.getDate() - diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

function formatDayDate(key: DayKey): string {
  const monday = mondayOf(new Date());
  const idx = DAYS.findIndex((d) => d.key === key);
  const d = new Date(monday);
  d.setDate(monday.getDate() + idx);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function longDayName(label: string): string {
  // "Mon" → "Monday"
  const map: Record<string, string> = {
    Mon: "Monday",
    Tue: "Tuesday",
    Wed: "Wednesday",
    Thu: "Thursday",
    Fri: "Friday",
    Sat: "Saturday",
    Sun: "Sunday",
  };
  return map[label] ?? label;
}

function formatInt(n: number): string {
  return Math.round(n).toLocaleString();
}

function wire(target: HTMLElement): void {
  const store = getStore();

  target.querySelectorAll<HTMLButtonElement>(".daystrip .d").forEach((btn) => {
    btn.addEventListener("click", () => {
      activeDay = btn.dataset.day as DayKey;
      renderWeek(target);
    });
  });

  // Mobile + desktop slot picker triggers — both data-pick buttons.
  target.querySelectorAll<HTMLElement>("[data-pick]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const slotId = btn.dataset.pick!;
      const day = (btn.dataset.day as DayKey) ?? activeDay;
      openMealPicker({ day, slotId }, () => renderWeek(target));
    });
  });

  target.querySelector("#clear-week")?.addEventListener("click", () => {
    if (!confirmAction("Clear all slots for this week?")) return;
    store.week = emptyWeek(store.slots);
    store.shoppingChecked = [];
    renderWeek(target);
  });

  target.querySelector("#share-week")?.addEventListener("click", async () => {
    if (!isSignedIn()) {
      alert("Sign in to share content.");
      return;
    }
    if (
      !confirmAction(
        "Share this week plan to the public area? It will include the meals and ingredients used.",
      )
    )
      return;
    try {
      await shareWeekPlan(store);
      alert("Week plan shared. Open the Share tab to see it.");
    } catch (err) {
      alert("Couldn't share: " + (err instanceof Error ? err.message : String(err)));
    }
  });

  target.querySelector("#dup-week")?.addEventListener("click", () => {
    alert(
      "Week history isn't tracked yet — this will copy from a previous week once history is added.",
    );
  });

  // Swipe gestures on the today card (mobile).
  const card = target.querySelector<HTMLElement>("#today");
  if (card) wireSwipe(card, target);
}

function wireSwipe(card: HTMLElement, target: HTMLElement): void {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  card.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    tracking = true;
  }, { passive: true });
  card.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    if (Math.abs(dx) < 40 || Math.abs(dy) > Math.abs(dx)) return;
    const idx = DAYS.findIndex((d) => d.key === activeDay);
    const nextIdx = dx < 0 ? Math.min(6, idx + 1) : Math.max(0, idx - 1);
    if (nextIdx === idx) return;
    activeDay = DAYS[nextIdx].key;
    renderWeek(target);
  });
}
