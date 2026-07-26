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

function sanitizeIds(raw) {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^[a-z0-9-]+$/.test(s))
    .slice(0, MAX_IDS);
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const category = (url.searchParams.get("category") || "").trim().toLowerCase();
  const ids = sanitizeIds(url.searchParams.get("ids"));

  const upstream = new URL("https://api.coingecko.com/api/v3/coins/markets");
  upstream.searchParams.set("vs_currency", "usd");
  upstream.searchParams.set("order", "market_cap_desc");
  upstream.searchParams.set("page", "1");
  upstream.searchParams.set("sparkline", "false");
  upstream.searchParams.set("price_change_percentage", "24h");

  if (/^[a-z0-9-]+$/.test(category)) {
    upstream.searchParams.set("category", category);
    let perPage = parseInt(url.searchParams.get("per_page") || "100", 10);
    if (!isFinite(perPage) || perPage < 1) perPage = 100;
    upstream.searchParams.set("per_page", String(Math.min(perPage, MAX_PER_PAGE)));
  } else if (ids.length) {
    upstream.searchParams.set("ids", ids.join(","));
    upstream.searchParams.set("per_page", String(ids.length));
  } else {
    return json({ error: "need category or ids" }, 400, 0);
  }

  try {
    const res = await fetch(upstream.toString(), {
      headers: { accept: "application/json", "user-agent": UA },
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
