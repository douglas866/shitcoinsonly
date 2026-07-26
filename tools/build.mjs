// SSR snapshot generator for ShitcoinsOnly.
// Fetches the current top-100 meme coins from CoinGecko and bakes a static
// snapshot into index.html (market table, gainers, losers, volume, and the
// heatmap island) so crawlers and no-JS visitors see real data and the page
// paints instantly. app.js then hydrates everything with live data on load.
//
// Run:  node tools/build.mjs
// (Wire this to a GitHub Actions cron later to keep the snapshot fresh.)

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INDEX = path.join(ROOT, "index.html");
const CG =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&category=meme-token&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=24h";

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

function replaceBetween(html, start, end, inner) {
  const a = html.indexOf(start);
  const b = html.indexOf(end);
  if (a === -1 || b === -1 || b < a) throw new Error(`markers not found: ${start}`);
  return html.slice(0, a + start.length) + inner + html.slice(b);
}

async function main() {
  const res = await fetch(CG, { headers: { accept: "application/json", "user-agent": "ShitcoinsOnly build" } });
  if (!res.ok) throw new Error("CoinGecko " + res.status);
  const raw = await res.json();
  const coins = raw
    .map((m) => ({
      symbol: (m.symbol || "").toUpperCase(),
      name: m.name || "",
      price: m.current_price,
      change: m.price_change_percentage_24h,
      marketCap: m.market_cap,
      volume: m.total_volume,
    }))
    .filter((c) => isFinite(c.marketCap) && c.marketCap > 0)
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, 100);

  const rows = coins
    .map((c, i) => `<tr data-rank="${i + 1}" data-symbol="${esc(c.symbol)}"><td class="num rank">${i + 1}</td><td class="ticker-cell"><span class="ticker-link">${esc(c.symbol)}</span></td><td class="company-cell col-name"><span class="company-link">${esc(c.name)}</span></td><td class="num col-price">${fmtPrice(c.price)}</td>${pctCell(c.change)}<td class="num">${fmtBig(c.marketCap)}</td></tr>`)
    .join("");

  const movers = coins.filter((c) => isFinite(c.change));
  const gainers = [...movers].sort((a, b) => b.change - a.change).slice(0, 10);
  const losers = [...movers].sort((a, b) => a.change - b.change).slice(0, 10);
  const moverRows = (list) =>
    list
      .map((c, i) => `<tr><td class="num rank">${i + 1}</td><td class="ticker-cell"><span class="ticker-link">${esc(c.symbol)}</span></td>${pctCell(c.change)}<td class="num">${fmtPrice(c.price)}</td></tr>`)
      .join("");

  const volume = [...coins].filter((c) => isFinite(c.volume) && c.volume > 0).sort((a, b) => b.volume - a.volume).slice(0, 10);
  const volRows = volume
    .map((c, i) => `<tr><td class="num rank">${i + 1}</td><td class="ticker-cell"><span class="ticker-link">${esc(c.symbol)}</span></td><td class="company-cell col-name"><span class="company-link">${esc(c.name)}</span></td><td class="num">${fmtBig(c.volume)}</td><td class="num">${fmtBig(c.marketCap)}</td></tr>`)
    .join("");

  const island = JSON.stringify({
    updatedAt: new Date().toISOString(),
    coins: coins.map((c) => ({ symbol: c.symbol, name: c.name, size: c.marketCap, changePct: isFinite(c.change) ? c.change : 0 })),
  });

  let html = await readFile(INDEX, "utf8");
  html = replaceBetween(html, "<!--SSR_ROWS_START-->", "<!--SSR_ROWS_END-->", rows);
  html = replaceBetween(html, "<!--SSR_GAINERS_START-->", "<!--SSR_GAINERS_END-->", moverRows(gainers));
  html = replaceBetween(html, "<!--SSR_LOSERS_START-->", "<!--SSR_LOSERS_END-->", moverRows(losers));
  html = replaceBetween(html, "<!--SSR_VOLUME_START-->", "<!--SSR_VOLUME_END-->", volRows);
  html = replaceBetween(html, "<!--SSR_HEATMAP_START-->", "<!--SSR_HEATMAP_END-->", island);
  await writeFile(INDEX, html, "utf8");

  console.log(`Baked snapshot: ${coins.length} coins, ${gainers.length} gainers, ${losers.length} losers, ${volume.length} by volume.`);
}

main().catch((e) => {
  console.error("build failed:", e.message);
  process.exit(1);
});
