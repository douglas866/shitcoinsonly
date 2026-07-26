// Cloudflare Pages Function: /api/prices?ids=dogecoin,shiba-inu,...
// Proxies the CoinGecko /coins/markets endpoint for live shitcoin quotes.
// Fetching server-side avoids browser CORS limits and lets us cache at the
// Cloudflare edge so we never hammer CoinGecko's rate limit.
//
// Response: the raw CoinGecko markets array (id, symbol, name, image,
// current_price, market_cap, market_cap_rank, total_volume,
// price_change_percentage_24h, ...). The client merges it with data/coins.json.

const UA = "ShitcoinsOnly shitcoinsonly.com";

// Hard cap so a crafted query string can't ask CoinGecko for the world.
const MAX_IDS = 250;

// Only lowercase letters, digits and hyphens are valid CoinGecko ids. Anything
// else is dropped before the id list is forwarded upstream.
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
  const ids = sanitizeIds(url.searchParams.get("ids"));

  if (ids.length === 0) {
    return json({ error: "no valid ids" }, 400, 0);
  }

  const upstream = new URL("https://api.coingecko.com/api/v3/coins/markets");
  upstream.searchParams.set("vs_currency", "usd");
  upstream.searchParams.set("ids", ids.join(","));
  upstream.searchParams.set("order", "market_cap_desc");
  upstream.searchParams.set("per_page", String(ids.length));
  upstream.searchParams.set("page", "1");
  upstream.searchParams.set("sparkline", "false");
  upstream.searchParams.set("price_change_percentage", "24h");

  try {
    const res = await fetch(upstream.toString(), {
      headers: { accept: "application/json", "user-agent": UA },
      // Edge-cache the upstream response for 60s across all visitors.
      cf: { cacheTtl: 60, cacheEverything: true },
    });
    if (!res.ok) {
      return json({ error: "upstream", status: res.status }, 502, 0);
    }
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
    sMaxAge > 0
      ? `public, max-age=${sMaxAge}, s-maxage=${sMaxAge}`
      : "no-store";
  return new Response(JSON.stringify(body), { status, headers });
}
