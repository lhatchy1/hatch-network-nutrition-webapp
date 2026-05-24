import type { ThemePref } from "./types";

// Writes/clears [data-theme] on <html>. "auto" removes the attribute so
// prefers-color-scheme takes over.
export function applyTheme(pref: ThemePref): void {
  const html = document.documentElement;
  if (pref === "auto") html.removeAttribute("data-theme");
  else html.setAttribute("data-theme", pref);
}
