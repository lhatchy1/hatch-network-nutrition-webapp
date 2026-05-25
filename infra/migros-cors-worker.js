// migros-cors-worker.js
//
// Cloudflare Worker that proxies the Migros product-display API for the
// food.hatchnetwork.ch web app. Deploy this as a Cloudflare Worker and
// drop its URL into VITE_MIGROS_PROXY (see infra/README.md). The Worker
// only forwards to Migros' public product endpoint and only allows
// requests from the configured origins — no open relay.

const ALLOWED_ORIGINS = [
  "https://food.hatchnetwork.ch",
  "http://localhost:5173",
  "http://localhost:4173",
];

const ALLOWED_HOST = "www.migros.ch";
const ALLOWED_PATH_PREFIX = "/product-display/public/v1/products/mgb/";
const GUEST_AUTH_URL =
  "https://www.migros.ch/authentication/public/v1/api/guest?authorizationNotRequired=true";

// Cloudflare Workers' default outbound User-Agent ("Cloudflare-Workers")
// is fingerprinted by Migros' bot protection and answered with HTTP 403 +
// an HTML block page. Spoof a real Chrome UA on every upstream call.
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

export default {
  async fetch(req) {
    const origin = req.headers.get("Origin") ?? "";
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : "";

    const cors = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (!allowedOrigin) {
      return new Response("Origin not allowed", { status: 403, headers: cors });
    }

    if (req.method !== "POST") {
      return new Response("Only POST is supported", { status: 405, headers: cors });
    }

    const target = new URL(req.url).searchParams.get("url");
    if (!target) {
      return new Response("Missing ?url= parameter", { status: 400, headers: cors });
    }

    let t;
    try {
      t = new URL(target);
    } catch {
      return new Response("Invalid ?url= value", { status: 400, headers: cors });
    }
    if (t.hostname !== ALLOWED_HOST || !t.pathname.startsWith(ALLOWED_PATH_PREFIX)) {
      return new Response("Target URL not allowed", { status: 403, headers: cors });
    }

    // Step 1: bootstrap a guest session. The Migros SPA does this once on
    // load — calling /authentication/public/v1/api/guest returns a
    // `leshopch` token in the response headers. Every subsequent call to
    // /product-display/... gets that token attached as a request header by
    // an Angular HTTP interceptor. Without it, the product endpoint 401s
    // with an empty body (which is exactly the symptom we were hitting
    // with the bare POST + "{}" body).
    const authResp = await fetch(GUEST_AUTH_URL, {
      method: "GET",
      headers: { ...BROWSER_HEADERS, Accept: "application/json" },
    });
    const leshopch = authResp.headers.get("leshopch");
    if (!authResp.ok || !leshopch) {
      return new Response(
        `Failed to obtain Migros guest auth token (${authResp.status})`,
        { status: 502, headers: { ...cors, "Cache-Control": "no-store" } },
      );
    }

    // Step 2: call the product endpoint with the leshopch token AND a real
    // JSON body. The SPA sends { storeType, warehouseId } — passing "{}"
    // also gets a 401. warehouseId 1 is the Lausanne region; for product
    // metadata (name, brand, macros, breadcrumb) the response is the same
    // regardless of which warehouse we ask for.
    const upstream = await fetch(t.toString(), {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": "application/json",
        Accept: "application/json",
        leshopch,
      },
      body: JSON.stringify({ storeType: "ONLINE", warehouseId: 1 }),
    });

    // Only cache successful responses — otherwise a transient 4xx sticks
    // in browser + edge caches for five minutes and every retry hits the
    // cached failure.
    const cacheable = upstream.status >= 200 && upstream.status < 300;
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": cacheable ? "public, max-age=300" : "no-store",
      },
    });
  },
};
