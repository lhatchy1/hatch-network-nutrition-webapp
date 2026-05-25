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

    const upstream = await fetch(t.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        // Migros data is fairly stable; cache at the edge for a few minutes
        // so repeat lookups of the same product don't hit migros.ch each time.
        "Cache-Control": "public, max-age=300",
      },
    });
  },
};
