// Thin wrapper around the Open Food Facts search API. No API key required,
// CORS-friendly, suitable for a static client-side PWA.
//
// We use the legacy CGI search endpoint because the newer /api/v2/search is
// facet-based (categories_tags, labels_tags…) and silently ignores free-text
// queries — which made every search return the same globally-popular products.
//
// Docs: https://openfoodfacts.github.io/openfoodfacts-server/api/

import type { IngredientCategory, Unit } from "../types";

export interface FoodHit {
  name: string;
  brand?: string;
  kcalPer100: number;
  proteinPer100: number;
  carbsPer100: number;
  fatPer100: number;
  category: IngredientCategory;
  // Some sources (e.g. Migros) tell us whether the per-100 figures are
  // per 100 g or per 100 ml. OFF doesn't distinguish — leave undefined
  // there and let consumers default to "g".
  unit?: Unit;
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

// OFF's free public API rate-limits aggressively. When it returns 429
// it strips the CORS headers, so the browser hands us a generic
// TypeError — we can't tell a 429 apart from a network drop. The
// helper below treats them the same way: at most one quick retry
// after a generous pause, and an in-memory cache so we don't keep
// hammering the same URL.
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 1_500;
const CACHE_MAX_ENTRIES = 64;
const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  expires: number;
  body: unknown;
}
const responseCache = new Map<string, CacheEntry>();

// Track recent failures so we can surface a "rate-limited, slow down"
// hint to the panel instead of the generic "couldn't reach" one. We
// can't read the 429 status code (CORS-stripped), so we infer it from
// fetch throwing on consecutive close-together requests.
let recentFailureCount = 0;
let recentFailureAt = 0;

export function wasRecentlyRateLimited(): boolean {
  return recentFailureCount >= 2 && Date.now() - recentFailureAt < 30_000;
}

async function cachedFetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const cached = responseCache.get(url);
  const now = Date.now();
  if (cached && cached.expires > now) {
    return cached.body as T;
  }

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const ctrl = new AbortController();
    const onParentAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) {
        // 4xx is the client and won't change on retry; bail straight away.
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          throw new Error(`HTTP ${res.status}`);
        }
        lastErr = new Error(`HTTP ${res.status}`);
      } else {
        const body = (await res.json()) as T;
        recentFailureCount = 0;
        rememberInCache(url, body);
        return body;
      }
    } catch (err) {
      if (signal?.aborted) throw err;
      lastErr = err;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onParentAbort);
    }
    if (attempt < MAX_ATTEMPTS) {
      await sleep(RETRY_BACKOFF_MS);
    }
  }
  recentFailureCount += 1;
  recentFailureAt = Date.now();
  throw lastErr ?? new Error("Request failed");
}

function rememberInCache(url: string, body: unknown): void {
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    // Map iteration is insertion-ordered, so the first key is the oldest.
    const oldest = responseCache.keys().next().value;
    if (oldest !== undefined) responseCache.delete(oldest);
  }
  responseCache.set(url, { expires: Date.now() + CACHE_TTL_MS, body });
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

  const data = await cachedFetchJson<OFFResponse>(url.toString(), signal);

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
  const data = await cachedFetchJson<OFFProductResponse>(url, signal);
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

