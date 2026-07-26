// ShitcoinsOnly site generator.
// Fetches live market data (CoinGecko meme-token top 100), determines which
// coins are listed on >=2 major exchanges (Coinbase / Kraken / Binance) and
// gives ONLY those a clickable per-coin page with factual, self-authored copy
// (no fabrication). Generates: homepage SSR, section pages (/market/ /heatmap/
// /gainers/ /losers/ /volume/), per-coin pages (/coin/<id>/), data/coins-pages.json
// (symbol->slug map the client uses to link rows), and sitemap.xml.
//
// Run:  node tools/build.mjs

import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = path.join(ROOT, "index.html");
const ORIGIN = "https://shitcoinsonly.com";
const UA = { headers: { accept: "application/json", "user-agent": "ShitcoinsOnly build" } };

const MARKETS =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=meme-token&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h";

// ---------- formatting ----------
const fmtPctNum = (n) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
function fmtBig(n) {
  if (!isFinite(n) || n <= 0) return "—";
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(2) + "K";
  return "$" + n.toFixed(0);
}
function fmtPrice(p) {
  if (!isFinite(p) || p <= 0) return "—";
  if (p >= 1000) return "$" + p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1) return "$" + p.toFixed(2);
  if (p >= 0.01) return "$" + p.toFixed(4);
  if (p >= 0.0001) return "$" + p.toFixed(6);
  return "$" + p.toPrecision(2);
}
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function pctCell(ch, extra = "") {
  const cls = ch == null || isNaN(ch) ? "" : ch >= 0 ? "up" : "down";
  const txt = ch == null || isNaN(ch) ? "—" : fmtPctNum(ch);
  return `<td class="num ${cls} ${extra}">${txt}</td>`;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- shared HTML shell ----------
const SHELL_STYLE = `
    .panel__head--heatmap{flex-wrap:wrap;gap:8px;align-items:baseline;justify-content:space-between}
    .heatmap-meta{font-size:11px;color:#b4b4b4;letter-spacing:.06em;text-transform:uppercase}
    .heatmap-canvas{position:relative;width:100%;aspect-ratio:2 / 1;min-height:360px;background:#050505;border:1px solid #2c2c2c;overflow:hidden;margin-top:10px}
    .heatmap-cell{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;text-decoration:none;color:#fff;border:1px solid rgba(0,0,0,.4);font-family:var(--mono);overflow:hidden;line-height:1.1;transition:outline .12s ease,z-index 0s}
    .heatmap-cell:hover{outline:2px solid #fff;z-index:2}
    .heatmap-cell__ticker{font-weight:700;letter-spacing:.04em;white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:clip;padding:0 2px;text-align:center}
    .heatmap-cell__pct{opacity:.9;margin-top:2px}
    .heatmap-figure{margin:0;padding:0}
    .panel-title-link{color:inherit;text-decoration:none}
    .panel-title-link:hover{color:#ff7a00}
    .ticker-link,.company-link{color:inherit;text-decoration:none}
    a.ticker-link:hover,a.company-link:hover{color:#ff7a00}
    .home-twin-panels{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    @media (max-width:720px){.home-twin-panels{grid-template-columns:1fr}}
    #marketTable tbody tr[data-rank-hidden]{display:none}
    #marketTable .company-cell, #volumeTable .company-cell{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    @media (max-width:720px){
      #marketTable .col-name, #marketTable thead th.col-name{display:none}
      #marketTable .col-price, #marketTable thead th.col-price{display:none}
      #volumeTable .col-name, #volumeTable thead th.col-name{display:none}
    }
    @media (max-width:640px){
      .heatmap-canvas{aspect-ratio:4 / 5;min-height:460px}
      .panel__head--heatmap{flex-direction:column;align-items:flex-start}
    }
    .coin-hero{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;padding:22px 16px 6px}
    .coin-hero__sym{font-size:34px;font-weight:800;letter-spacing:-.01em;color:#f2f2f2}
    .coin-hero__name{font-size:18px;color:#b4b4b4}
    .coin-hero__chain{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#ff7a00;border:1px solid #2c2c2c;border-radius:4px;padding:3px 8px}
    .coin-stats{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:#1f1f1f;border-top:1px solid #1f1f1f;border-bottom:1px solid #1f1f1f;margin:14px 0 0}
    .coin-stat{background:#0a0a0a;padding:16px}
    .coin-stat__label{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#777;margin:0 0 6px}
    .coin-stat__value{font-size:20px;font-weight:700;color:#f2f2f2;font-variant-numeric:tabular-nums}
    @media (max-width:720px){.coin-stats{grid-template-columns:repeat(2,1fr)}}
    .coin-body{padding:18px 16px;color:#cfcfcf;line-height:1.7;font-size:15.5px;max-width:70ch}
    .coin-back{display:inline-block;margin:8px 16px 24px;color:#ff7a00;font-size:13px;letter-spacing:.04em;text-transform:uppercase;text-decoration:none}
    .coin-back:hover{text-decoration:underline}`;

function favicons() {
  return `  <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml" />
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png" />
  <link rel="icon" type="image/png" sizes="192x192" href="/assets/favicon-192x192.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png" />`;
}
function topbar() {
  return `  <header class="topbar">
    <div class="topbar__brand">
      <a href="/" class="brand-link" aria-label="ShitcoinsOnly home"><span class="brand__name">SHITCOINS</span><span class="brand__mark">ONLY</span></a>
    </div>
    <div class="topbar__quote" aria-label="Tracked memecoin market cap"><span class="quote__label">MCAP</span><span id="mcapValue" class="quote__value">&mdash;</span><span id="mcapChange" class="quote__delta">&mdash;</span></div>
  </header>`;
}
function ticker() {
  const links = [
    ["/market/", "TOP 100 SHITCOINS"], ["/heatmap/", "LIVE HEATMAP"], ["/gainers/", "TOP GAINERS 24H"],
    ["/losers/", "TOP LOSERS 24H"], ["/volume/", "HIGHEST VOLUME"], ["/market/", "RANKED BY MARKET CAP"], ["/market/", "MEMECOINS ONLY"],
  ];
  const a = links.map(([h, t]) => `<a href="${h}">${t}</a>`).join("");
  return `  <section class="ticker" aria-label="Section navigator">
    <div class="topbar__carousel" aria-label="Section navigator"><div class="topbar__carousel-track">${a}${a}</div></div>
  </section>`;
}
function footer() {
  return `  <footer class="footer">
    <div class="footer__links"><span class="footer__source">DATA</span><span class="footer__sep">&middot;</span><span class="footer__source">COINGECKO</span></div>
    <p class="footer__legal">&copy; <span id="year">2026</span> SHITCOINSONLY. Independent tracker. For informational purposes only. Not investment advice. Shitcoins and memecoins are extremely high-risk and can lose all value. Data displayed may be delayed, incomplete, or inaccurate and should be independently verified before use.</p>
  </footer>`;
}
function page({ title, description, canonical, jsonLd = "", main, script }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="${esc(description)}" />
  <meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1" />
  <meta name="theme-color" content="#0a0a0a" />
  <meta name="color-scheme" content="dark" />
  <link rel="canonical" href="${canonical}" />
  <link rel="manifest" href="/manifest.json" />
  <link rel="dns-prefetch" href="https://api.coingecko.com" />
  <link rel="preconnect" href="https://api.coingecko.com" crossorigin />
  <title>${esc(title)}</title>
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:image" content="${ORIGIN}/assets/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="ShitcoinsOnly" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${ORIGIN}/assets/og-image.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="/css/styles.css" />
${jsonLd}${favicons()}
  <style>${SHELL_STYLE}
  </style>
</head>
<body>
  <h1 class="sr-only">${esc(title)}</h1>
${topbar()}
${ticker()}
  <main class="layout">
${main}
  </main>
${footer()}
${script}
</body>
</html>
`;
}

// ---------- renderers (shared with homepage SSR) ----------
function tickerLink(coin, pageSet) {
  const slug = pageSet.get(coin.symbol);
  const t = esc(coin.symbol);
  return slug ? `<a class="ticker-link" href="/coin/${slug}/">${t}</a>` : `<span class="ticker-link">${t}</span>`;
}
function nameLink(coin, pageSet, cls = "company-link") {
  const slug = pageSet.get(coin.symbol);
  const t = esc(coin.name);
  return slug ? `<a class="${cls}" href="/coin/${slug}/">${t}</a>` : `<span class="${cls}">${t}</span>`;
}
function marketRows(coins, pageSet) {
  return coins
    .map((c, i) => `<tr data-rank="${i + 1}" data-symbol="${esc(c.symbol)}"${i >= 10 ? " data-rank-hidden=\"\"" : ""}><td class="num rank">${i + 1}</td><td class="ticker-cell">${tickerLink(c, pageSet)}</td><td class="company-cell col-name">${nameLink(c, pageSet)}</td><td class="num col-price">${fmtPrice(c.price)}</td>${pctCell(c.change)}<td class="num">${fmtBig(c.marketCap)}</td></tr>`)
    .join("");
}
function moverRows(list, pageSet) {
  return list
    .map((c, i) => `<tr><td class="num rank">${i + 1}</td><td class="ticker-cell">${tickerLink(c, pageSet)}</td>${pctCell(c.change)}<td class="num">${fmtPrice(c.price)}</td></tr>`)
    .join("");
}
function volumeRows(list, pageSet) {
  return list
    .map((c, i) => `<tr><td class="num rank">${i + 1}</td><td class="ticker-cell">${tickerLink(c, pageSet)}</td><td class="company-cell col-name">${nameLink(c, pageSet)}</td><td class="num">${fmtBig(c.volume)}</td><td class="num">${fmtBig(c.marketCap)}</td></tr>`)
    .join("");
}
function heatmapIsland(coins) {
  const maxCap = coins.reduce((m, c) => Math.max(m, c.marketCap || 0), 0);
  const off = Math.sqrt(Math.max(1, maxCap)) * 0.14;
  const size = (m) => Math.sqrt(Math.max(0, m || 0)) + off;
  return JSON.stringify({
    updatedAt: new Date().toISOString(),
    coins: coins.map((c) => ({ symbol: c.symbol, name: c.name, size: size(c.marketCap), changePct: isFinite(c.change) ? c.change : 0 })),
  });
}
function replaceBetween(html, start, end, inner) {
  const a = html.indexOf(start), b = html.indexOf(end);
  if (a === -1 || b === -1 || b < a) throw new Error(`markers not found: ${start}`);
  return html.slice(0, a + start.length) + inner + html.slice(b);
}

// ---------- panel fragments for section pages ----------
function heatmapPanel(island) {
  return `    <section id="heatmap" class="panel">
      <header class="panel__head panel__head--heatmap"><h2 class="panel__title">HEATMAP</h2><time id="heatmapUpdated" class="heatmap-meta">&mdash;</time></header>
      <figure class="heatmap-figure"><div id="heatmapCanvas" class="heatmap-canvas" role="img" aria-label="Treemap of top shitcoins by market cap, colored by 24h change"><noscript>Enable JavaScript to load the live heatmap.</noscript></div></figure>
      <script id="heatmapData" type="application/json">${island}</script>
    </section>`;
}
function marketPanel(rows) {
  return `    <section id="market" class="panel">
      <header class="panel__head"><h2 class="panel__title">TOP 100 SHITCOINS</h2>
        <div class="pager" aria-label="Market pagination">
          <button type="button" class="pager__btn" id="pagerPrev" aria-label="Previous 10" hidden><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg></button>
          <span class="pager__label" id="pagerLabel">&mdash;</span>
          <button type="button" class="pager__btn" id="pagerNext" aria-label="Next 10"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg></button>
        </div>
      </header>
      <div class="table-wrap"><table class="data-table" id="marketTable"><thead><tr><th class="num">#</th><th>COIN</th><th class="col-name">NAME</th><th class="num col-price">PRICE</th><th class="num">24H</th><th class="num">MARKET CAP</th></tr></thead><tbody>${rows}</tbody></table></div>
    </section>`;
}
function moverPanel(id, title, rows) {
  return `    <section id="${id}" class="panel"><header class="panel__head"><h2 class="panel__title">${title}</h2></header>
      <div class="table-wrap"><table class="data-table" id="${id}Table"><thead><tr><th class="num">#</th><th>COIN</th><th class="num">24H</th><th class="num">PRICE</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}
function volumePanel(rows) {
  return `    <section id="volume" class="panel"><header class="panel__head"><h2 class="panel__title">HIGHEST VOLUME &middot; 24H</h2></header>
      <div class="table-wrap"><table class="data-table" id="volumeTable"><thead><tr><th class="num">#</th><th>COIN</th><th class="col-name">NAME</th><th class="num">24H VOLUME</th><th class="num">MARKET CAP</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// ---------- factual per-coin copy (self-authored from structured facts) ----------
// Host chain for tokens; null for native-chain coins (e.g. DOGE) so we never
// print the redundant "a memecoin on Dogecoin".
function chainLabel(platformId) {
  if (!platformId) return null;
  const map = { ethereum: "Ethereum", solana: "Solana", base: "Base", "binance-smart-chain": "BNB Chain", "the-open-network": "TON", "arbitrum-one": "Arbitrum", polygon: "Polygon", avalanche: "Avalanche", sui: "Sui", aptos: "Aptos", tron: "Tron" };
  return map[platformId] || platformId.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
function exchangeNames(on) {
  const m = { CB: "Coinbase", KR: "Kraken", BN: "Binance" };
  const names = on.map((x) => m[x]);
  if (names.length === 1) return names[0];
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}
function coinParagraph(c) {
  const chain = chainLabel(c.platformId);
  let lead = `${c.name} (${c.symbol}) is a memecoin`;
  if (chain) lead += ` on ${chain}`;
  if (c.year) lead += `, first recorded in ${c.year}`;
  lead += ".";
  const rank = c.rank
    ? `It currently ranks #${c.rank} among meme-token cryptocurrencies by market capitalization`
    : `It is tracked among the top meme-token cryptocurrencies by market capitalization`;
  return [
    lead,
    `${rank}, with a market capitalization of ${fmtBig(c.marketCap)} and 24-hour trading volume of ${fmtBig(c.volume)}.`,
    `It is listed on ${exchangeNames(c.on)}.`,
    `Like all memecoins, ${c.symbol} is highly speculative and its price can be extremely volatile.`,
  ].join(" ");
}
function coinPage(c) {
  const chain = chainLabel(c.platformId);
  const canonical = `${ORIGIN}/coin/${c.id}/`;
  const desc = `${c.name} (${c.symbol}) live price, market cap, 24h change and volume. Factual overview of the ${chain ? chain + " " : ""}memecoin, listed on ${exchangeNames(c.on)}.`;
  const jsonLd = `  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"${ORIGIN}/"},{"@type":"ListItem","position":2,"name":"Coins","item":"${ORIGIN}/market/"},{"@type":"ListItem","position":3,"name":"${esc(c.name)}"}]}
  </script>
`;
  const main = `    <section class="panel" data-coin-id="${esc(c.id)}" data-coin-symbol="${esc(c.symbol)}">
      <div class="coin-hero">
        <span class="coin-hero__sym">${esc(c.symbol)}</span>
        <span class="coin-hero__name">${esc(c.name)}</span>
        ${chain ? `<span class="coin-hero__chain">${esc(chain)}</span>` : ""}
      </div>
      <div class="coin-stats">
        <div class="coin-stat"><p class="coin-stat__label">Price</p><p class="coin-stat__value" id="coinPrice">${fmtPrice(c.price)}</p></div>
        <div class="coin-stat"><p class="coin-stat__label">24h</p><p class="coin-stat__value ${c.change >= 0 ? "up" : "down"}" id="coinChange">${isFinite(c.change) ? fmtPctNum(c.change) : "—"}</p></div>
        <div class="coin-stat"><p class="coin-stat__label">Market cap</p><p class="coin-stat__value" id="coinMcap">${fmtBig(c.marketCap)}</p></div>
        <div class="coin-stat"><p class="coin-stat__label">Rank</p><p class="coin-stat__value">${c.rank ? "#" + c.rank : "—"}</p></div>
        <div class="coin-stat"><p class="coin-stat__label">24h volume</p><p class="coin-stat__value" id="coinVol">${fmtBig(c.volume)}</p></div>
      </div>
      <div class="coin-body"><p>${esc(coinParagraph(c))}</p></div>
      <a class="coin-back" href="/market/">&larr; Back to all shitcoins</a>
    </section>`;
  return page({
    title: `${c.symbol} — ${c.name} price, market cap & 24h | ShitcoinsOnly`,
    description: desc,
    canonical,
    jsonLd,
    main,
    script: `  <script src="/js/coin.js" defer></script>`,
  });
}

// ---------- main ----------
async function main() {
  const raw = await (await fetch(MARKETS, UA)).json();
  const seen = new Set();
  const coins = raw
    .map((m) => ({ id: m.id, symbol: (m.symbol || "").toUpperCase(), name: m.name || "", price: m.current_price, change: m.price_change_percentage_24h, marketCap: m.market_cap, volume: m.total_volume, rank: m.market_cap_rank }))
    .filter((c) => isFinite(c.marketCap) && c.marketCap > 0)
    .sort((a, b) => b.marketCap - a.marketCap)
    .filter((c) => (seen.has(c.symbol) ? false : (seen.add(c.symbol), true)))
    .slice(0, 100);

  // Exchange listings
  const setFrom = async (url, pick) => { try { return new Set((pick(await (await fetch(url, UA)).json())).map((s) => s.toUpperCase())); } catch { return new Set(); } };
  const cb = await setFrom("https://api.exchange.coinbase.com/currencies", (a) => a.map((x) => x.id || ""));
  const kr = await setFrom("https://api.kraken.com/0/public/Assets", (k) => Object.values(k.result || {}).map((a) => a.altname || ""));
  const bn = await setFrom("https://api.binance.com/api/v3/exchangeInfo", (b) => (b.symbols || []).map((s) => s.baseAsset || ""));

  const eligible = [];
  for (const c of coins) {
    const on = [cb.has(c.symbol) && "CB", kr.has(c.symbol) && "KR", bn.has(c.symbol) && "BN"].filter(Boolean);
    if (on.length >= 2) { c.on = on; eligible.push(c); }
  }

  // Enrich eligible coins with chain + launch year (throttled to respect rate limit)
  for (const c of eligible) {
    try {
      const d = await (await fetch(`https://api.coingecko.com/api/v3/coins/${c.id}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false&sparkline=false`, UA)).json();
      c.platformId = d.asset_platform_id || null;
      c.year = d.genesis_date ? String(d.genesis_date).slice(0, 4) : null;
      if (!c.rank && d.market_cap_rank) c.rank = d.market_cap_rank;
    } catch {}
    await sleep(2600);
  }

  const pageSet = new Map(eligible.map((c) => [c.symbol, c.id]));

  // Homepage SSR
  const movers = coins.filter((c) => isFinite(c.change));
  const gainers = [...movers].sort((a, b) => b.change - a.change).slice(0, 10);
  const losers = [...movers].sort((a, b) => a.change - b.change).slice(0, 10);
  const volume = [...coins].filter((c) => isFinite(c.volume) && c.volume > 0).sort((a, b) => b.volume - a.volume).slice(0, 10);
  const island = heatmapIsland(coins);
  const etParts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const et = {}; etParts.forEach((p) => (et[p.type] = p.value));
  const updatedStamp = `${et.year}-${et.month}-${et.day} ${et.hour}:${et.minute} ET`;
  const nowIso = new Date().toISOString();

  let html = await readFile(INDEX, "utf8");
  html = replaceBetween(html, "<!--SSR_ROWS_START-->", "<!--SSR_ROWS_END-->", marketRows(coins, pageSet));
  html = replaceBetween(html, "<!--SSR_GAINERS_START-->", "<!--SSR_GAINERS_END-->", moverRows(gainers, pageSet));
  html = replaceBetween(html, "<!--SSR_LOSERS_START-->", "<!--SSR_LOSERS_END-->", moverRows(losers, pageSet));
  html = replaceBetween(html, "<!--SSR_VOLUME_START-->", "<!--SSR_VOLUME_END-->", volumeRows(volume, pageSet));
  html = replaceBetween(html, "<!--SSR_HEATMAP_START-->", "<!--SSR_HEATMAP_END-->", island);
  html = html.replace(/<time id="heatmapUpdated"[^>]*>[^<]*<\/time>/, `<time id="heatmapUpdated" class="heatmap-meta" datetime="${nowIso}">${updatedStamp}</time>`);
  await writeFile(INDEX, html, "utf8");

  // Section pages
  const sections = [
    ["market", page({ title: "Top 100 Shitcoins by Market Cap | ShitcoinsOnly", description: "The top 100 shitcoins and memecoins ranked by market capitalization, with live price, 24h change and market cap.", canonical: `${ORIGIN}/market/`, main: marketPanel(marketRows(coins, pageSet)), script: `  <script src="/js/app.js" defer></script>` })],
    ["heatmap", page({ title: "Shitcoin Heatmap | ShitcoinsOnly", description: "Live treemap of the top shitcoins by market cap, colored by 24h price change.", canonical: `${ORIGIN}/heatmap/`, main: heatmapPanel(island), script: `  <script src="/js/app.js" defer></script>` })],
    ["gainers", page({ title: "Top Shitcoin Gainers (24h) | ShitcoinsOnly", description: "The biggest 24-hour gainers among the top 100 shitcoins and memecoins.", canonical: `${ORIGIN}/gainers/`, main: moverPanel("gainers", "TOP GAINERS &middot; 24H", moverRows(gainers, pageSet)), script: `  <script src="/js/app.js" defer></script>` })],
    ["losers", page({ title: "Top Shitcoin Losers (24h) | ShitcoinsOnly", description: "The biggest 24-hour losers among the top 100 shitcoins and memecoins.", canonical: `${ORIGIN}/losers/`, main: moverPanel("losers", "TOP LOSERS &middot; 24H", moverRows(losers, pageSet)), script: `  <script src="/js/app.js" defer></script>` })],
    ["volume", page({ title: "Highest Volume Shitcoins (24h) | ShitcoinsOnly", description: "The shitcoins with the highest 24-hour trading volume among the top 100 by market cap.", canonical: `${ORIGIN}/volume/`, main: volumePanel(volumeRows(volume, pageSet)), script: `  <script src="/js/app.js" defer></script>` })],
  ];
  for (const [slug, out] of sections) {
    const dir = path.join(ROOT, slug);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), out, "utf8");
  }

  // Per-coin pages. Wipe the coin/ tree first so coins that dropped off the
  // >=2-exchange list (live data shifts) don't leave orphan pages behind.
  await rm(path.join(ROOT, "coin"), { recursive: true, force: true });
  for (const c of eligible) {
    const dir = path.join(ROOT, "coin", c.id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "index.html"), coinPage(c), "utf8");
  }

  // Client link map
  await mkdir(path.join(ROOT, "data"), { recursive: true });
  await writeFile(path.join(ROOT, "data", "coins-pages.json"), JSON.stringify(Object.fromEntries(pageSet)), "utf8");

  // Sitemap
  const urls = [`${ORIGIN}/`, `${ORIGIN}/market/`, `${ORIGIN}/heatmap/`, `${ORIGIN}/gainers/`, `${ORIGIN}/losers/`, `${ORIGIN}/volume/`, ...eligible.map((c) => `${ORIGIN}/coin/${c.id}/`)];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><changefreq>hourly</changefreq></url>`).join("\n")}\n</urlset>\n`;
  await writeFile(path.join(ROOT, "sitemap.xml"), sitemap, "utf8");

  console.log(`Homepage SSR + ${sections.length} section pages + ${eligible.length} coin pages. Clickable: ${eligible.map((c) => c.symbol).join(", ")}`);
}
main().catch((e) => { console.error("build failed:", e.message); process.exit(1); });
