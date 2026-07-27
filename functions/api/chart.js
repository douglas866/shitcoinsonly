// Cloudflare Pages Function: /api/chart
// Proxies CoinGecko /coins/{id}/market_chart for the per-coin price graph.
//   /api/chart?id=ethereum&days=30
// Cached hard at the Cloudflare edge (15 min) so a busy coin page never hammers
// CoinGecko's public rate limit — chart history barely moves, so 15 min is plenty.
// Falls back to no-store on error; the client falls back to CoinGecko direct.

const UA = "ShitcoinsOnly shitcoinsonly.com";
const ALLOWED_DAYS = new Set(["1", "7", "30", "90", "365"]);
const EDGE_TTL = 900; // 15 min

// Best-effort per-IP burst limiter (in-isolate memory): 30 requests / 60s.
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

export async function onRequestGet(context) {
  const ip = context.request.headers.get("cf-connecting-ip");
  if (rateLimited(ip)) return json({ error: "rate limited" }, 429, 0);

  const url = new URL(context.request.url);
  const id = (url.searchParams.get("id") || "").trim().toLowerCase();
  const days = (url.searchParams.get("days") || "30").trim();
  if (!/^[a-z0-9-]{1,64}$/.test(id)) return json({ error: "bad id" }, 400, 0);
  const d = ALLOWED_DAYS.has(days) ? days : "30";

  const upstream = new URL(`https://api.coingecko.com/api/v3/coins/${id}/market_chart`);
  upstream.searchParams.set("vs_currency", "usd");
  upstream.searchParams.set("days", d);

  const headers = { accept: "application/json", "user-agent": UA };
  const key = context.env && context.env.CG_API_KEY;
  if (key) { headers["x-cg-demo-api-key"] = key; upstream.searchParams.set("x_cg_demo_api_key", key); }

  try {
    const res = await fetch(upstream.toString(), {
      headers,
      cf: { cacheTtl: EDGE_TTL, cacheEverything: true },
    });
    if (!res.ok) return json({ error: "upstream", status: res.status }, 502, 0);
    const data = await res.json();
    // Trim to just the price series the chart needs (smaller payload, same info).
    return json({ prices: Array.isArray(data.prices) ? data.prices : [] }, 200, EDGE_TTL);
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
