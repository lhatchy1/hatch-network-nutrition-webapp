// Thin wrapper around the Migros product-display API. Used when the user
// pastes a https://www.migros.ch/<locale>/product/<id> URL into the food
// search panel — Migros is an Angular SPA, so HTML scraping returns an
// empty <app-root>; the actual product payload lives behind a JSON API
// that the SPA itself calls.
//
// Why POST: the endpoint is a POST that takes no meaningful body. We
// match what the Migros SPA sends (Content-Type: application/json, body
// "{}") so any future server-side validation behaves the same way.
//
// Why a proxy: Migros doesn't set Access-Control-Allow-Origin, so a
// direct browser fetch from food.hatchnetwork.ch is blocked by CORS.
// corsproxy.io is a free public reflector — fine for personal use, but
// see the "Gotchas" entry in CLAUDE.md if it ever flakes.

import type { IngredientCategory, Unit } from "../types";
import type { FoodHit } from "./foodSearch";

const PRODUCT_ENDPOINT = "https://www.migros.ch/product-display/public/v1/products/mgb";
const CORS_PROXY = "https://corsproxy.io/?url=";
const REQUEST_TIMEOUT_MS = 12_000;

interface MigrosNutrientRow {
  label?: string;
  values?: string[];
}

interface MigrosBreadcrumbItem {
  name?: string;
}

interface MigrosResponse {
  name?: string;
  brand?: string;
  versioning?: string;
  title?: string;
  productInformation?: {
    nutrientsInformation?: {
      nutrientsTable?: {
        headers?: string[];
        rows?: MigrosNutrientRow[];
      };
    };
  };
  breadcrumb?: MigrosBreadcrumbItem[];
}

// Match the URL form regardless of locale (/en/, /fr/, /de/, /it/) and
// tolerate a trailing slug or query string. Bare numeric IDs are not
// accepted — they'd collide with the barcode auto-detect path.
const URL_RE = /migros\.ch\/[a-z]{2}\/product\/(\d{6,})/i;

export function extractMigrosProductId(input: string): string | null {
  const m = input.trim().match(URL_RE);
  return m ? m[1] : null;
}

export async function lookupMigrosProduct(
  productId: string,
  signal?: AbortSignal,
): Promise<FoodHit | null> {
  const id = productId.trim();
  if (!/^\d+$/.test(id)) return null;

  const apiUrl = `${PRODUCT_ENDPOINT}/${id}`;
  const proxied = CORS_PROXY + encodeURIComponent(apiUrl);

  const ctrl = new AbortController();
  const onParentAbort = () => ctrl.abort();
  signal?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);

  try {
    // Force this to be a "simple" CORS POST so the browser never sends
    // an OPTIONS preflight — corsproxy.io's free tier 403s preflights
    // from non-localhost origins. The only CORS-safelisted values for
    // Content-Type are application/x-www-form-urlencoded,
    // multipart/form-data, and text/plain (no parameters). We pick
    // bare "text/plain" because some browsers (Firefox) preflight when
    // the auto-set default tacks ";charset=UTF-8" on. Migros' product
    // -display endpoint doesn't read the body, so the content-type
    // doesn't matter at the server.
    const res = await fetch(proxied, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: "{}",
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Migros API responded ${res.status}`);
    const data = (await res.json()) as MigrosResponse;
    return migrosToHit(data);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onParentAbort);
  }
}

function migrosToHit(p: MigrosResponse): FoodHit | null {
  const table = p.productInformation?.nutrientsInformation?.nutrientsTable;
  const rows = table?.rows;
  if (!rows || rows.length === 0) return null;

  const kcal = energyKcal(rows);
  if (!Number.isFinite(kcal) || kcal <= 0) return null;

  const name = (p.name || p.title || "").trim();
  if (!name) return null;

  const versioning = (p.versioning || "").trim();
  const fullName = versioning ? `${name} ${versioning}` : name;

  return {
    name: fullName,
    brand: (p.brand || "").trim() || undefined,
    kcalPer100: round(kcal),
    proteinPer100: round(nutrient(rows, /^(protein|eiwei|prot[eé]ines|proteine)/i)),
    carbsPer100: round(nutrient(rows, /^(carbohydrate|kohlenhydrat|glucides|carboidrati)/i)),
    fatPer100: round(nutrient(rows, /^(fat\b|fett\b|mati[eè]res grasses|lipidi|grassi)/i)),
    category: guessCategoryFromBreadcrumb(p.breadcrumb ?? []),
    unit: detectUnit(table?.headers?.[0] ?? ""),
  };
}

function detectUnit(header: string): Unit {
  return /\bml\b/i.test(header) ? "ml" : "g";
}

// Migros encodes energy as "1720 kJ (415 kcal)". Prefer the parenthesised
// kcal; fall back to the first number for the rare row that only carries
// one figure.
function energyKcal(rows: MigrosNutrientRow[]): number {
  for (const row of rows) {
    const label = (row.label ?? "").trim();
    if (!/^(energy|energie|énergie|valeur énergétique|valore energetico)/i.test(label)) continue;
    const v = row.values?.[0] ?? "";
    const kcal = v.match(/(\d+(?:[.,]\d+)?)\s*kcal/i);
    if (kcal) return toFloat(kcal[1]);
    return firstNumber(v);
  }
  return 0;
}

// Skip the "of which …" sub-rows (saturates / sugars) before matching so
// the fat lookup doesn't accidentally pick up "of which saturates".
function nutrient(rows: MigrosNutrientRow[], pattern: RegExp): number {
  for (const row of rows) {
    const label = (row.label ?? "").trim();
    if (!label) continue;
    if (/^(of which|davon|dont|di cui)\b/i.test(label)) continue;
    if (pattern.test(label)) return firstNumber(row.values?.[0] ?? "");
  }
  return 0;
}

// "< 0.5 g" → 0.5 (conservative); "35 g" → 35; "" → 0.
function firstNumber(v: string): number {
  const m = v.match(/(\d+(?:[.,]\d+)?)/);
  return m ? toFloat(m[1]) : 0;
}

function toFloat(s: string): number {
  return parseFloat(s.replace(",", "."));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

// Migros breadcrumbs are localised to whatever language the user's URL
// was in, so match the major EN/DE/FR/IT terms for each bucket. The user
// can still recategorise after adding if we guess wrong.
function guessCategoryFromBreadcrumb(breadcrumb: MigrosBreadcrumbItem[]): IngredientCategory {
  const blob = breadcrumb
    .map((b) => b.name ?? "")
    .join(" ")
    .toLowerCase();
  if (/meat|fish|seafood|poultry|egg|legume|tofu|tempeh|fleisch|wurst|viande|poisson|carne|pesce|uova/.test(blob))
    return "Protein";
  if (/cereal|bread|pasta|rice|grain|noodle|oat|flour|getreide|brot|reis|nudel|riz|pain|pâtes|pane|riso/.test(blob))
    return "Carbs";
  if (/fruit|vegetable|salad|herb|mushroom|gem(ü|ue)se|obst|salat|pilz|l[ée]gume|frutta|verdura|ortaggi/.test(blob))
    return "Produce";
  if (/dair|milk|cheese|yogurt|yoghurt|butter|cream|milch|k(ä|ae)se|joghurt|rahm|lait|fromage|latte|formaggio/.test(blob))
    return "Dairy";
  if (/sauce|condiment|oil|spice|sweet|sugar|snack|biscuit|chocolate|drink|beverage|gew(ü|ue)rz|(ö|oe)l|getr(ä|ae)nk|s(ü|ue)ssware|huile|boisson|olio|dolci|biscotti|bevanda/.test(blob))
    return "Pantry";
  return "Other";
}
