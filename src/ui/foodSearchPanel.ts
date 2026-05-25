// Reusable inline food-search panel used by the ingredients view and the meal
// editor. Renders a search input + results list, debounces network calls, and
// calls back with a chosen FoodHit (or null when "Add manually" is clicked).

import { lookupBarcode, searchFoods, wasRecentlyRateLimited } from "../api/foodSearch";
import type { FoodHit } from "../api/foodSearch";
import { extractMigrosProductId, lookupMigrosProduct } from "../api/migros";
import { esc, html, raw } from "./components";

export interface PanelOptions {
  /** Called with a chosen hit; called with null when the user picks manual entry. */
  onPick: (hit: FoodHit | null) => void;
  /** Called when the user dismisses the panel without picking anything. */
  onCancel?: () => void;
  placeholder?: string;
  /** If set, renders an "Add manually" fallback button; omit to hide it. */
  manualLabel?: string;
  /** If true, open the barcode scanner as soon as the panel mounts. */
  autoOpenScanner?: boolean;
}

// 500 ms keeps OFF from seeing a request per keystroke. Open Food
// Facts rate-limits the public API hard (and strips CORS from the
// 429), so easing off is more reliable than retrying through it.
const DEBOUNCE_MS = 500;

function networkErrorStatus(): string {
  return wasRecentlyRateLimited()
    ? "Open Food Facts is rate-limiting this device. Wait a few seconds and try again."
    : "Couldn't reach Open Food Facts. Check your connection and try again.";
}

export function mountFoodSearchPanel(container: HTMLElement, opts: PanelOptions): void {
  container.innerHTML = html`
    <div class="food-search">
      <div class="actions">
        <input
          type="search"
          class="grow"
          data-food-q
          autocomplete="off"
          inputmode="search"
          placeholder="${opts.placeholder ?? "Search foods, paste a barcode or Migros URL…"}"
          style="flex: 1 1 200px;"
        />
        <button class="btn" data-food-scan title="Scan barcode">⌖ Scan</button>
        <button class="btn ghost" data-food-cancel>Cancel</button>
      </div>
      <p class="food-status" data-food-status>
        Scan or type a barcode, paste a Migros product URL, or search by name.
      </p>
      <div class="food-results" data-food-results></div>
      ${raw(
        opts.manualLabel
          ? `<p style="margin-top:8px;"><button class="btn ghost" data-food-manual>${esc(opts.manualLabel)}</button></p>`
          : "",
      )}
    </div>
  `;

  const input = container.querySelector<HTMLInputElement>("[data-food-q]")!;
  const results = container.querySelector<HTMLElement>("[data-food-results]")!;
  const status = container.querySelector<HTMLElement>("[data-food-status]")!;
  const manual = container.querySelector<HTMLButtonElement>("[data-food-manual]");
  const cancel = container.querySelector<HTMLButtonElement>("[data-food-cancel]")!;
  const scanBtn = container.querySelector<HTMLButtonElement>("[data-food-scan]")!;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: AbortController | null = null;
  // Monotonic id — every response checks against this before touching the DOM
  // so an aborted/stale request can't paint over a fresher one.
  let requestSeq = 0;
  let latestHits: FoodHit[] = [];

  const setStatus = (msg: string) => {
    status.textContent = msg;
  };

  const run = async (q: string) => {
    if (inflight) inflight.abort();
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      latestHits = [];
      results.innerHTML = "";
      setStatus("Scan or type a barcode, paste a Migros product URL, or search by name.");
      return;
    }

    const mySeq = ++requestSeq;

    // A Migros product URL routes to the Migros JSON API (via the
    // corsproxy.io reflector — see src/api/migros.ts for why).
    const migrosId = extractMigrosProductId(trimmed);
    if (migrosId) {
      setStatus(`Looking up Migros product ${migrosId}…`);
      try {
        const hit = await lookupMigrosProduct(migrosId);
        if (mySeq !== requestSeq) return;
        if (hit) {
          latestHits = [hit];
          renderResults(results, [hit]);
          setStatus("1 match from Migros — click to add.");
        } else {
          latestHits = [];
          results.innerHTML = "";
          setStatus(
            `Migros returned no nutrition data for product ${migrosId}. Try a different product or add manually.`,
          );
        }
      } catch (err) {
        if (mySeq !== requestSeq) return;
        console.error(err);
        setStatus("Couldn't reach Migros. Check the URL and your connection.");
      }
      return;
    }

    // A pure-digit string of 8–14 chars is almost certainly a barcode
    // (EAN-8 up to EAN-13 / UPC-A); hit the product endpoint directly.
    // Text-search on a numeric string returns junk on OFF, so this also
    // covers the "I typed a barcode into the search field" case.
    const isBarcode = /^\d{8,14}$/.test(trimmed);

    if (isBarcode) {
      setStatus(`Looking up barcode ${trimmed}…`);
      try {
        const hit = await lookupBarcode(trimmed);
        if (mySeq !== requestSeq) return;
        if (hit) {
          latestHits = [hit];
          renderResults(results, [hit]);
          setStatus("1 match — click to add.");
        } else {
          latestHits = [];
          results.innerHTML = "";
          setStatus(`Barcode ${trimmed} isn't in Open Food Facts. Try a name search instead.`);
        }
      } catch (err) {
        if (mySeq !== requestSeq) return;
        console.error(err);
        setStatus(networkErrorStatus());
      }
      return;
    }

    setStatus("Searching…");
    const ctrl = new AbortController();
    inflight = ctrl;
    try {
      const hits = await searchFoods(trimmed, ctrl.signal);
      if (mySeq !== requestSeq) return;
      latestHits = hits;
      renderResults(results, hits);
      setStatus(
        hits.length === 0
          ? "No matches with macros found. Try a simpler query."
          : `${hits.length} match${hits.length === 1 ? "" : "es"} — click one to add.`,
      );
    } catch (err) {
      // Swallow anything from a stale or aborted request — only the latest
      // request is allowed to report errors to the user.
      if (mySeq !== requestSeq) return;
      const name = (err as { name?: string })?.name;
      if (name === "AbortError" || ctrl.signal.aborted) return;
      console.error(err);
      setStatus(networkErrorStatus());
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

  scanBtn.addEventListener("click", async () => {
    // The ZXing-based scanner is ~140 KB gzipped — load it on demand so
    // the initial bundle stays slim for users who never scan.
    setStatus("Loading scanner…");
    scanBtn.disabled = true;
    try {
      const { openBarcodeScanner } = await import("./barcodeScanner");
      setStatus("Scan a barcode, or type at least 2 letters. Powered by Open Food Facts.");
      openBarcodeScanner({
        onResult: async (code) => {
          setStatus(`Looking up barcode ${code}…`);
          // Bump the seq so any in-flight text-search response is ignored
          // and can't paint over the barcode result below.
          const mySeq = ++requestSeq;
          try {
            const hit = await lookupBarcode(code);
            if (mySeq !== requestSeq) return;
            if (hit) {
              opts.onPick(hit);
            } else {
              setStatus(
                `Barcode ${code} isn't in Open Food Facts. Try a text search or add manually.`,
              );
            }
          } catch (err) {
            if (mySeq !== requestSeq) return;
            console.error(err);
            setStatus(networkErrorStatus());
          }
        },
        onCancel: () => {
          // Scanner closed without a result — leave the panel intact.
        },
        onError: (msg) => setStatus(msg),
      });
    } catch (err) {
      console.error(err);
      setStatus("Couldn't load the barcode scanner.");
    } finally {
      scanBtn.disabled = false;
    }
  });

  // Autofocus so the user can start typing immediately.
  queueMicrotask(() => input.focus());

  if (opts.autoOpenScanner) {
    queueMicrotask(() => scanBtn.click());
  }
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
              · ${h.fibrePer100}g fib · ${h.sugarPer100}g sug · ${h.saltPer100}g salt
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
