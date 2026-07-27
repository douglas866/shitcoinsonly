// Cloudflare Pages Function: /api/prices
// Proxies the CoinGecko /coins/markets endpoint for live shitcoin quotes.
// Two modes:
//   /api/prices?category=meme-token&per_page=100   -> top-N of a CoinGecko category
//   /api/prices?ids=dogecoin,pepe,...              -> a specific id list
// Fetching server-side avoids browser CORS limits and lets us cache at the
// Cloudflare edge so we never hammer CoinGecko's rate limit.

const UA = "ShitcoinsOnly shitcoinsonly.com";
const MAX_IDS = 250;
const MAX_PER_PAGE = 250;

// Best-effort per-IP burst limiter (in-isolate memory): 30 requests / 60s.
// Mirrors the reference tracker's prices.js. Does not coordinate across Cloudflare PoPs,
// but is enough to stop a single runaway tab from hammering the endpoint. The
// 60s edge cache does the real heavy lifting of protecting CoinGecko's limit.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 30;
const rateBuckets = new Map();
function rateLimited(ip) {
  if (!ip) return false;
  const now = Date.now();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    rateBuckets.set(ip, { start: now, count: 1 });
    return false;
  }
  bucket.count++;
  return bucket.count > RATE_LIMIT_MAX;
}

function sanitizeIds(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9-]+$/.test(s))
    .slice(0, MAX_IDS);
}

export async function onRequestGet(context) {
  const ip = context.request.headers.get("cf-connecting-ip");
  if (rateLimited(ip)) return json({ error: "rate limited" }, 429, 0);

  const url = new URL(context.request.url);
  const category = (url.searchParams.get("category") || "").trim().toLowerCase();
  const ids = sanitizeIds(url.searchParams.get("ids"));

  const upstream = new URL("https://api.coingecko.com/api/v3/coins/markets");
  upstream.searchParams.set("vs_currency", "usd");
  upstream.searchParams.set("order", "market_cap_desc");
  upstream.searchParams.set("page", "1");
  upstream.searchParams.set("sparkline", "false");
  upstream.searchParams.set("price_change_percentage", "24h,7d");

  if (/^[a-z0-9-]+$/.test(category)) {
    upstream.searchParams.set("category", category);
    let perPage = parseInt(url.searchParams.get("per_page") || "100", 10);
    if (!isFinite(perPage) || perPage < 1) perPage = 100;
    upstream.searchParams.set("per_page", String(Math.min(perPage, MAX_PER_PAGE)));
  } else if (ids.length) {
    upstream.searchParams.set("ids", ids.join(","));
    upstream.searchParams.set("per_page", String(ids.length));
  } else {
    // General top-by-market-cap mode (the whole market; the client filters out
    // Bitcoin + stablecoins and keeps the top 100 "shitcoins").
    let perPage = parseInt(url.searchParams.get("per_page") || "150", 10);
    if (!isFinite(perPage) || perPage < 1) perPage = 150;
    upstream.searchParams.set("per_page", String(Math.min(perPage, MAX_PER_PAGE)));
  }

  // Optional CoinGecko Demo API key (set as a Pages env var CG_API_KEY). Public
  // CoinGecko rate-limits Cloudflare's shared Worker IPs (429); a free Demo key
  // lifts that so the edge cache actually serves data instead of falling through.
  const headers = { accept: "application/json", "user-agent": UA };
  const key = context.env && context.env.CG_API_KEY;
  if (key) { headers["x-cg-demo-api-key"] = key; upstream.searchParams.set("x_cg_demo_api_key", key); }

  try {
    const res = await fetch(upstream.toString(), {
      headers,
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!res.ok) return json({ error: "upstream", status: res.status }, 502, 0);
    const data = await res.json();
    return json(data, 200, 60);
  } catch (e) {
    return json({ error: "fetch failed" }, 502, 0);
  }
}

function json(body, status, sMaxAge) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
  };
  headers["cache-control"] =
    sMaxAge > 0 ? `public, max-age=${sMaxAge}, s-maxage=${sMaxAge}` : "no-store";
  return new Response(JSON.stringify(body), { status, headers });
}
