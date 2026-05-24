import Alpine from "alpinejs";
import "@picocss/pico/css/pico.min.css";
import "./ui/styles.css";

import { initStore } from "./store";
import { renderIngredients } from "./views/ingredients";
import { renderMeals } from "./views/meals";
import { renderWeek } from "./views/week";
import { renderShopping } from "./views/shopping";
import { openSettings } from "./views/settings";

type RouteKey = "ingredients" | "meals" | "week" | "shopping";

const ROUTES: { key: RouteKey; label: string; render: (el: HTMLElement) => void }[] = [
  { key: "ingredients", label: "Ingredients", render: renderIngredients },
  { key: "meals", label: "Meals", render: renderMeals },
  { key: "week", label: "Week", render: renderWeek },
  { key: "shopping", label: "Shopping", render: renderShopping },
];

function currentRoute(): RouteKey {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const match = ROUTES.find((r) => r.key === hash);
  return match ? match.key : "week";
}

function renderNav(active: RouteKey): void {
  const nav = document.getElementById("main-nav");
  if (!nav) return;
  nav.innerHTML = ROUTES.map(
    (r) =>
      `<li><a href="#/${r.key}" ${r.key === active ? 'aria-current="page"' : ""}>${r.label}</a></li>`,
  ).join("");
}

function renderCurrent(): void {
  const view = document.getElementById("view");
  if (!view) return;
  const route = currentRoute();
  renderNav(route);
  const r = ROUTES.find((x) => x.key === route)!;
  r.render(view);
}

(window as unknown as { Alpine: typeof Alpine }).Alpine = Alpine;
initStore(Alpine);
Alpine.start();

// Render on hash change and on store mutations.
window.addEventListener("hashchange", renderCurrent);
Alpine.effect(() => {
  // Touch fields we want to trigger re-renders on.
  const s = Alpine.store("app") as Record<string, unknown>;
  void s.ingredients;
  void s.meals;
  void s.week;
  void s.targets;
  void s.shoppingChecked;
  renderCurrent();
});

// Settings button
const settingsBtn = document.getElementById("open-settings");
const dialog = document.getElementById("settings-dialog") as HTMLDialogElement | null;
if (settingsBtn && dialog) {
  settingsBtn.addEventListener("click", () => {
    openSettings(dialog, renderCurrent);
  });
}

// Default to /week on first load
if (!window.location.hash) window.location.hash = "#/week";

// Register service worker (production only — Vite serves dev unbundled).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.warn("SW registration failed", err);
    });
  });
}
