// Thin wrapper around the Open Food Facts search API. No API key required,
// CORS-friendly, suitable for a static client-side PWA.
//
// We use the legacy CGI search endpoint because the newer /api/v2/search is
// facet-based (categories_tags, labels_tags…) and silently ignores free-text
// queries — which made every search return the same globally-popular products.
//
// Docs: https://openfoodfacts.github.io/openfoodfacts-server/api/

import type { IngredientCategory } from "../types";

export interface FoodHit {
  name: string;
  brand?: string;
  kcalPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  category: IngredientCategory;
}

interface OFFNutriments {
  "energy-kcal_100g"?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
}

interface OFFProduct {
  product_name?: string;
  product_name_en?: string;
  generic_name?: string;
  generic_name_en?: string;
  brands?: string;
  categories_tags?: string[];
  nutriments?: OFFNutriments;
}

interface OFFResponse {
  products?: OFFProduct[];
}

interface OFFProductResponse {
  status: number;
  product?: OFFProduct;
}

const SEARCH_ENDPOINT = "https://world.openfoodfacts.org/cgi/search.pl";
const PRODUCT_ENDPOINT = "https://world.openfoodfacts.org/api/v2/product";
const FIELDS =
  "product_name,product_name_en,generic_name,generic_name_en,brands,categories_tags,nutriments";

// OFF's free public API is regularly flaky — individual requests hang
// or return 5xx, but a quick retry usually succeeds. These knobs let
// callers cancel via AbortSignal while the fetch helper still budgets
// each attempt and retries transient failures transparently.
const REQUEST_TIMEOUT_MS = 8_000;
const MAX_ATTEMPTS = 3;
const RETRY_BACKOFF_MS = 400;

async function fetchWithRetry(url: string, signal?: AbortSignal): Promise<Response> {
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const ctrl = new AbortController();
    const onParentAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      // Only retry on server-side or transient errors; 4xx is the user
      // and won't change on retry.
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)) {
        return res;
      }
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      // The user-supplied signal aborted; surface immediately.
      if (signal?.aborted) throw err;
      lastErr = err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onParentAbort);
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BACKOFF_MS * attempt);
    }
  }
  throw lastErr ?? new Error("Request failed");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function searchFoods(
  query: string,
  signal?: AbortSignal,
): Promise<FoodHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("search_terms", q);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", "20");
  url.searchParams.set("fields", FIELDS);
  // Prefer English-language product names where the entry has one.
  url.searchParams.set("lc", "en");

  const res = await fetchWithRetry(url.toString(), signal);
  if (!res.ok) throw new Error(`Food search failed (${res.status})`);
  const data = (await res.json()) as OFFResponse;

  const hits: FoodHit[] = [];
  for (const p of data.products ?? []) {
    const hit = productToHit(p);
    if (hit) hits.push(hit);
  }
  return hits;
}

// Look up a single product by barcode (EAN-13, UPC-A, EAN-8, UPC-E).
// Returns null when OFF doesn't know the barcode or the entry lacks
// usable nutriments.
export async function lookupBarcode(
  barcode: string,
  signal?: AbortSignal,
): Promise<FoodHit | null> {
  const code = barcode.trim();
  if (!code) return null;
  const url = `${PRODUCT_ENDPOINT}/${encodeURIComponent(code)}.json?fields=${encodeURIComponent(
    FIELDS,
  )}&lc=en`;
  const res = await fetchWithRetry(url, signal);
  if (!res.ok) throw new Error(`Barcode lookup failed (${res.status})`);
  const data = (await res.json()) as OFFProductResponse;
  // OFF returns { status: 0 } when the barcode isn't in the database.
  if (data.status !== 1 || !data.product) return null;
  return productToHit(data.product);
}

function productToHit(p: OFFProduct): FoodHit | null {
  const n = p.nutriments;
  if (!n) return null;
  const kcal = n["energy-kcal_100g"];
  // Skip entries with no usable kcal — they're unhelpful for a nutrition app.
  if (typeof kcal !== "number" || kcal <= 0) return null;
  const name = (
    p.product_name_en ||
    p.product_name ||
    p.generic_name_en ||
    p.generic_name ||
    ""
  ).trim();
  if (!name) return null;
  return {
    name,
    brand: p.brands?.split(",")[0]?.trim() || undefined,
    kcalPer100: round(kcal),
    proteinPer100: round(n.proteins_100g ?? 0),
    carbsPer100: round(n.carbohydrates_100g ?? 0),
    fatPer100: round(n.fat_100g ?? 0),
    category: guessCategory(p.categories_tags ?? []),
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// Best-effort mapping from OFF category tags to our six buckets.
// OFF tags look like "en:chicken-meat", "en:dairies", "en:cereals", …
function guessCategory(tags: string[]): IngredientCategory {
  const blob = tags.join(" ").toLowerCase();
  if (/meat|fish|seafood|poultry|eggs|legume|tofu|tempeh/.test(blob)) return "Protein";
  if (/cereal|bread|pasta|rice|grain|noodle|oat|flour/.test(blob)) return "Carbs";
  if (/fruit|vegetable|salad|herb|mushroom/.test(blob)) return "Produce";
  if (/dair|milk|cheese|yogurt|yoghurt|butter|cream/.test(blob)) return "Dairy";
  if (/sauce|condiment|oil|spice|sweet|sugar|snack|biscuit|chocolate|drink|beverage/.test(blob))
    return "Pantry";
  return "Other";
}

