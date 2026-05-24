import Alpine from "alpinejs";
import "@picocss/pico/css/pico.min.css";
import "./ui/styles.css";

import { initStore } from "./store";
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

type RouteKey = "ingredients" | "meals" | "week" | "shopping" | "share";

const ROUTES: { key: RouteKey; label: string; render: (el: HTMLElement) => void }[] = [
  { key: "ingredients", label: "Ingredients", render: renderIngredients },
  { key: "meals", label: "Meals", render: renderMeals },
  { key: "week", label: "Week", render: renderWeek },
  { key: "shopping", label: "Shopping", render: renderShopping },
  { key: "share", label: "Share", render: renderShare },
];

function currentRoute(): RouteKey {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const match = ROUTES.find((r) => r.key === hash);
  return match ? match.key : "week";
}

function visibleRoutes(): typeof ROUTES {
  return isFirebaseConfigured() ? ROUTES : ROUTES.filter((r) => r.key !== "share");
}

function renderNav(active: RouteKey): void {
  const nav = document.getElementById("main-nav");
  if (!nav) return;
  // Hide nav entirely when signed out (the gate fills the main area).
  if (requiresAuth() && !currentUser()) {
    nav.innerHTML = "";
    return;
  }
  nav.innerHTML = visibleRoutes()
    .map(
      (r) =>
        `<li><a href="#/${r.key}" ${r.key === active ? 'aria-current="page"' : ""}>${r.label}</a></li>`,
    )
    .join("");
}

function requiresAuth(): boolean {
  return isFirebaseConfigured();
}

function renderCurrent(): void {
  const view = document.getElementById("view");
  if (!view) return;
  const route = currentRoute();
  renderNav(route);

  // Signed-out experience: full-bleed sign-in form. We still render the Share
  // tab if a hash override points there (read-only browsing for visitors)
  // — but for the locked-down model we keep everything behind auth.
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

// Wire Firebase up before the first effect-driven render so signed-in users
// see their cloud data immediately.
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

// Render on hash change and on store mutations.
window.addEventListener("hashchange", renderCurrent);
Alpine.effect(() => {
  // Touch fields we want to trigger re-renders on.
  const s = Alpine.store("app") as Record<string, unknown>;
  void s.ingredients;
  void s.meals;
  void s.slots;
  void s.week;
  void s.targets;
  void s.shoppingChecked;
  void s.profile;
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
