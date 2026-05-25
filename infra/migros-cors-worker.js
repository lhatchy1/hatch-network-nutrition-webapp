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

    // Cloudflare Workers' default outbound User-Agent ("Cloudflare-
    // Workers") is fingerprinted by Migros' bot protection and answered
    // with HTTP 403 + an HTML block page. Spoof a real browser UA and
    // send the Origin/Referer pair the Migros SPA itself would send so
    // the upstream request matches the shape their WAF expects.
    const productId = t.pathname.slice(ALLOWED_PATH_PREFIX.length);
    const upstream = await fetch(t.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Origin: "https://www.migros.ch",
        Referer: `https://www.migros.ch/en/product/${productId}`,
      },
      body: "{}",
    });

    // Only cache successful responses — otherwise a transient 403 from
    // Migros (bot block, rate limit) sticks in browser + edge caches for
    // five minutes and the next paste of the same URL keeps failing.
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
