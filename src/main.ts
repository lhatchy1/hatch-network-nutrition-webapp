import Alpine from "alpinejs";
import "@picocss/pico/css/pico.classless.min.css";
import "./ui/styles.css";

import { initStore, getStore } from "./store";
import { renderIngredients } from "./views/ingredients";
import { renderMeals } from "./views/meals";
import { renderWeek } from "./views/week";
import { renderShopping } from "./views/shopping";
import { renderShare } from "./views/share";
import { openSettings } from "./views/settings";
import { renderAuthGate } from "./ui/authGate";
import { isFirebaseConfigured } from "./firebase/config";
import { initAuth, currentUser } from "./firebase/auth";
import { initSync, setRenderHook, setReconcilePrompt } from "./firebase/sync";
import { applyTheme } from "./theme";
import { setMealPickerCreateHook } from "./ui/mealPicker";

type RouteKey = "week" | "meals" | "ingredients" | "shopping" | "share";

interface RouteSpec {
  key: RouteKey;
  label: string;
  shortLabel: string;
  render: (el: HTMLElement) => void;
  ctx: () => string;
}

const ROUTES: RouteSpec[] = [
  {
    key: "week",
    label: "Week",
    shortLabel: "Week",
    render: renderWeek,
    ctx: () => weekContext(),
  },
  {
    key: "meals",
    label: "Meals",
    shortLabel: "Meals",
    render: renderMeals,
    ctx: () => `${getStore().meals.length} saved`,
  },
  {
    key: "ingredients",
    label: "Ingredients",
    shortLabel: "Ingreds",
    render: renderIngredients,
    ctx: () => `${getStore().ingredients.length} items`,
  },
  {
    key: "shopping",
    label: "Shopping",
    shortLabel: "Shop",
    render: renderShopping,
    ctx: () => shoppingContext(),
  },
  {
    key: "share",
    label: "Share",
    shortLabel: "Share",
    render: renderShare,
    ctx: () => "Your circle",
  },
];

function currentRoute(): RouteKey {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const match = ROUTES.find((r) => r.key === hash);
  return match ? match.key : "week";
}

function visibleRoutes(): RouteSpec[] {
  return isFirebaseConfigured() ? ROUTES : ROUTES.filter((r) => r.key !== "share");
}

function weekContext(): string {
  const now = new Date();
  const monday = new Date(now);
  const day = monday.getDay();
  const diff = (day + 6) % 7;
  monday.setDate(monday.getDate() - diff);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const weekNum = isoWeekNumber(now);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `W${weekNum} · ${fmt(monday)} → ${fmt(sunday)}`;
}

function isoWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

function shoppingContext(): string {
  const store = getStore();
  let total = 0;
  let done = 0;
  // We can't import shopping here (circular-ish); recount cheaply.
  for (const day of Object.values(store.week)) {
    for (const id of Object.values(day)) {
      if (!id) continue;
      const meal = store.meals.find((m) => m.id === id);
      if (!meal) continue;
      for (const mi of meal.ingredients) {
        total++;
        if (store.shoppingChecked.includes(mi.ingredientId)) done++;
      }
    }
  }
  return total > 0 ? `${done}/${total} picked up` : "Nothing on the list yet";
}

function renderNav(active: RouteKey): void {
  const desktop = document.getElementById("desktop-nav");
  const mobile = document.getElementById("mobile-tabs");
  const mtopCtx = document.getElementById("mtop-ctx");

  // Hide app chrome when signed out (the gate fills the main area).
  if (requiresAuth() && !currentUser()) {
    if (desktop) desktop.innerHTML = "";
    if (mobile) mobile.innerHTML = "";
    if (mtopCtx) mtopCtx.textContent = "";
    return;
  }

  const routes = visibleRoutes();
  if (desktop) {
    desktop.innerHTML = routes
      .map(
        (r) =>
          `<a class="${r.key === active ? "cur" : ""}" data-route="${r.key}" href="#/${r.key}">${r.label}</a>`,
      )
      .join("");
  }
  if (mobile) {
    mobile.innerHTML = routes
      .map(
        (r) =>
          `<a class="${r.key === active ? "cur" : ""}" data-route="${r.key}" href="#/${r.key}">${r.shortLabel}</a>`,
      )
      .join("");
  }

  if (mtopCtx) {
    const spec = routes.find((r) => r.key === active) ?? routes[0];
    try {
      mtopCtx.textContent = spec.ctx();
    } catch {
      mtopCtx.textContent = "";
    }
  }
}

function requiresAuth(): boolean {
  return isFirebaseConfigured();
}

function renderCurrent(): void {
  const view = document.getElementById("view");
  if (!view) return;
  const route = currentRoute();
  renderNav(route);

  if (requiresAuth() && !currentUser()) {
    renderAuthGate(view);
    return;
  }

  const r = visibleRoutes().find((x) => x.key === route) ?? ROUTES[0];
  r.render(view);
}

(window as unknown as { Alpine: typeof Alpine }).Alpine = Alpine;
initStore(Alpine);
Alpine.start();

// Apply the persisted theme before the first paint of the inner view.
applyTheme(getStore().theme);

if (isFirebaseConfigured()) {
  initAuth();
  setRenderHook(() => renderCurrent());
  setReconcilePrompt(async ({ hasLocal, hasRemote }) => {
    if (!hasLocal || !hasRemote) return "use-cloud";
    const useLocal = window.confirm(
      "You have unsaved data on this device that's different from your cloud account.\n\nOK = upload this device's data to the cloud (overwrites cloud).\nCancel = use the cloud copy (this device's local changes will be replaced).",
    );
    return useLocal ? "push-local" : "use-cloud";
  });
  initSync();
}

window.addEventListener("hashchange", renderCurrent);
Alpine.effect(() => {
  const s = Alpine.store("app") as Record<string, unknown>;
  void s.ingredients;
  void s.meals;
  void s.slots;
  void s.week;
  void s.targets;
  void s.shoppingChecked;
  void s.profile;
  void s.theme;
  renderCurrent();
});

// Settings dialog — both gear buttons (mobile + desktop) trigger the same.
const dialog = document.getElementById("settings-dialog") as HTMLDialogElement | null;
for (const id of ["open-settings-desktop", "open-settings-mobile"]) {
  document.getElementById(id)?.addEventListener("click", () => {
    if (dialog) openSettings(dialog, renderCurrent);
  });
}

// Meal-picker "+ New meal" shortcut — hop over to the Meals tab so the user
// can build one; we don't preserve slot context across the trip.
setMealPickerCreateHook(() => {
  window.location.hash = "#/meals";
});

if (!window.location.hash) window.location.hash = "#/week";

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.warn("SW registration failed", err);
    });
  });
}
