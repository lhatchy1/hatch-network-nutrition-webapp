// Thin wrapper around the Open Food Facts search API. No API key required,
// CORS-friendly, suitable for a static client-side PWA.
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
  generic_name?: string;
  brands?: string;
  categories_tags?: string[];
  nutriments?: OFFNutriments;
}

interface OFFResponse {
  products?: OFFProduct[];
}

const ENDPOINT = "https://world.openfoodfacts.org/api/v2/search";
const FIELDS = "product_name,generic_name,brands,categories_tags,nutriments";

export async function searchFoods(
  query: string,
  signal?: AbortSignal,
): Promise<FoodHit[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const url = new URL(ENDPOINT);
  url.searchParams.set("search_terms", q);
  url.searchParams.set("fields", FIELDS);
  url.searchParams.set("page_size", "15");
  url.searchParams.set("sort_by", "popularity_key");

  const res = await fetch(url.toString(), { signal });
  if (!res.ok) throw new Error(`Food search failed (${res.status})`);
  const data = (await res.json()) as OFFResponse;

  const hits: FoodHit[] = [];
  for (const p of data.products ?? []) {
    const n = p.nutriments;
    if (!n) continue;
    const kcal = n["energy-kcal_100g"];
    // Skip entries with no usable kcal — they're unhelpful for a nutrition app.
    if (typeof kcal !== "number" || kcal <= 0) continue;
    const name = (p.product_name || p.generic_name || "").trim();
    if (!name) continue;
    hits.push({
      name,
      brand: p.brands?.split(",")[0]?.trim() || undefined,
      kcalPer100: round(kcal),
      proteinPer100: round(n.proteins_100g ?? 0),
      carbsPer100: round(n.carbohydrates_100g ?? 0),
      fatPer100: round(n.fat_100g ?? 0),
      category: guessCategory(p.categories_tags ?? []),
    });
  }
  return hits;
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
