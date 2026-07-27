// ShitcoinsOnly front-end bootstrap.
// Live market data: CoinGecko "meme-token" category (top 100 by market cap),
// proxied through /api/prices (edge-cached 60s) with a direct-CoinGecko
// fallback for local static preview. Renders: topbar market-cap quote, the
// squarified heatmap, the paginated top-100 table (price/24h/mcap), plus
// top-gainers, top-losers and highest-volume panels. Polls once per minute,
// and pauses while the tab is hidden so background tabs never hit the API.

const PAGE_SIZE = 10;
const MAX_PAGES = 10; // 10 pages x 10 = top 100

// Universe = the whole market's top coins by market cap, MINUS Bitcoin and
// stablecoins ("everything except Bitcoin is a shitcoin"). We pull ~150 and
// filter down to the top 100 that survive. excludeSet is seeded here and topped
// up from /data/exclude.json (the live stablecoin list, generated at build time).
const API_URL = "/api/prices?per_page=150";
const CG_FALLBACK =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=150&page=1&sparkline=false&price_change_percentage=24h,7d";
let excludeSet = new Set(["BTC", "USDT", "USDC", "USDS", "DAI", "USDE", "FDUSD", "TUSD", "USDD", "PYUSD", "USD1", "BUSD", "GUSD", "FRAX", "LUSD", "USDP", "EURC", "USDG", "RLUSD", "USR", "USDX", "USYC", "USDY", "BUIDL", "USD0", "OUSG", "USTB", "BENJI", "USDL", "STABLE", "EUTBL", "EURSAFO", "JTRSY", "JUSD", "SYRUPUSDC", "FIGR_HELOC"]);
const REFRESH_MS = 60_000;

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

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

// Symbol -> per-coin-page slug (only coins listed on >=2 major exchanges have a
// page; the rest render as plain text). Loaded from /data/coins-pages.json.
let pageMap = {};
let logoMap = {}; // coin id -> "<id>.<ext>" self-hosted logo file
function coinHref(symbol) {
  const s = pageMap[symbol];
  return s ? `/coin/${s}/` : null;
}
function logoImg(c) {
  const f = c && c.id && logoMap[c.id];
  return f ? `<img class="coin-ico" src="/assets/coins/${f}" width="18" height="18" alt="" loading="lazy" decoding="async">` : "";
}
const BRAND = { ETH:"#7a9cff", BNB:"#f3ba2f", XRP:"#4bb8ff", SOL:"#14f195", TRX:"#ff4b4b", DOGE:"#e0c04a", SHIB:"#ff6c2f", PEPE:"#63d15a", ADA:"#3e78e0", AVAX:"#ff5a5b", LINK:"#4b8af5", DOT:"#ff45a0", XLM:"#4bccf0", LTC:"#8fb0e0", XMR:"#ff8a3d", ATOM:"#8f9bef", UNI:"#ff5fb2", AAVE:"#c86ec0", NEAR:"#2ff0a0", ARB:"#4aa8f0", POL:"#a86bff", MATIC:"#a86bff", HBAR:"#a0acc4", BCH:"#4ec26a", CRO:"#6b8cff", SUI:"#4da8ff", APT:"#3ad8c8", INJ:"#4fb8ff", TIA:"#9a6cf6", RENDER:"#ff6a4c", FIL:"#4ec3e0", ALGO:"#cfcfe0", ICP:"#e85fa0", CRV:"#7bd07b", LDO:"#5fd0e0", PENGU:"#7ec8ff", TRUMP:"#e0b84a", PYTH:"#9a6cf6", JUP:"#4fd8c8", ZEC:"#f4b728", DASH:"#3aa8e0", ETC:"#4ec26a", HYPE:"#3fe0c0", VET:"#4ab0f0", TAO:"#dcdce0", ENA:"#cfcfe0", SKY:"#4fb0ff", WLD:"#e0e0e6", MORPHO:"#6b8cff", CAKE:"#4fd0e0", AERO:"#4fa8ff", SEI:"#e85a5a", JTO:"#4fd8c8", GNO:"#4fd0a0", ONDO:"#4a8fff", KAS:"#4ec6b0", SPX:"#e0b84a", VIRTUAL:"#6bb0ff", FET:"#6b8cff", SUN:"#f3ba2f", QNT:"#dcdce0", OKB:"#4b8af5", KCS:"#4fd0a0", GT:"#e05a7a", NEXO:"#4a6fff", LEO:"#f3ba2f", WBT:"#4fb0ff", MNT:"#8fa0b4", BGB:"#4fd0e0", XAUT:"#e0b84a", PAXG:"#e0c84a", KAU:"#e0c84a", WLFI:"#e0b84a", ASTER:"#a86bff", PI:"#c9a0ff", JST:"#5fd0e0", BDX:"#6b8cff", XDC:"#4fb0d0", HASH:"#7a9cff", ETHFI:"#7a9cff", NIGHT:"#8f9bef", KAITO:"#4fd8c8", MEME:"#e0b84a", CC:"#cfcfe0" };
function brandColor(sym) {
  const s = String(sym || "").toUpperCase();
  if (BRAND[s]) return BRAND[s];
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 72% 66%)`;
}
function tickerCellHtml(c) {
  const h = coinHref(c.symbol), t = esc(c.symbol), col = brandColor(c.symbol), ico = logoImg(c);
  return h ? `${ico}<a class="ticker-link" style="color:${col}" href="${h}">${t}</a>` : `${ico}<span class="ticker-link" style="color:${col}">${t}</span>`;
}
function nameCellHtml(c) {
  const h = coinHref(c.symbol), t = esc(c.name);
  return h ? `<a class="company-link" href="${h}">${t}</a>` : `<span class="company-link">${t}</span>`;
}

function pctCell(change, extraClass) {
  const cls = change == null || isNaN(change) ? "" : change >= 0 ? "up" : "down";
  const txt = change == null || isNaN(change) ? "—" : fmtPctNum(change);
  return `<td class="num ${cls} ${extraClass || ""}">${txt}</td>`;
}

function setDelta(el, change) {
  if (!el) return;
  if (change == null || isNaN(change)) {
    el.textContent = "—";
    el.classList.remove("up", "down");
    return;
  }
  el.textContent = fmtPctNum(change);
  el.classList.toggle("up", change >= 0);
  el.classList.toggle("down", change < 0);
}

let marketCache = [];
let marketPage = 0;
let inFlight = false;
let lastLoad = 0;

// === Data ===
async function fetchMarkets() {
  const getJSON = (u) =>
    fetch(u, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error(u + " " + r.status);
      return r.json();
    });
  try {
    return await getJSON(API_URL);
  } catch (e) {
    return await getJSON(CG_FALLBACK);
  }
}

async function loadMarket() {
  if (inFlight) return;
  inFlight = true;
  try {
    const raw = await fetchMarkets();
    if (!Array.isArray(raw)) throw new Error("bad payload");
    const seen = new Set();
    marketCache = raw
      .map((m) => ({
        id: m.id,
        symbol: (m.symbol || "").toUpperCase(),
        name: m.name || "",
        price: m.current_price,
        change: m.price_change_percentage_24h,
        change7d: (m.price_change_percentage_7d_in_currency != null ? m.price_change_percentage_7d_in_currency : m.price_change_percentage_7d),
        marketCap: m.market_cap,
        volume: m.total_volume,
      }))
      .filter((c) => isFinite(c.marketCap) && c.marketCap > 0)
      .filter((c) => c.id !== "bitcoin" && !excludeSet.has(c.symbol)) // no BTC, no stablecoins (list from /data/exclude.json)
      .sort((a, b) => b.marketCap - a.marketCap)
      // Dedupe by symbol (CoinGecko lists e.g. DOGE + Binance-Peg DOGE): keep
      // the highest-market-cap instance, which sort() already placed first.
      .filter((c) => (seen.has(c.symbol) ? false : (seen.add(c.symbol), true)))
      .slice(0, 100);
    lastLoad = Date.now();
    renderMarket();
    renderMovers();
    renderVolume();
    renderBestWeek();
    renderIndex();
    updateQuote();
    renderHeatmapFrom(marketCache);
    markLiveUpdate();
    setStatus("");
  } catch (e) {
    setStatus("Live data unavailable — retrying…");
  } finally {
    inFlight = false;
  }
}

function setStatus(msg) {
  const el = document.getElementById("marketStatus");
  if (el) el.textContent = msg;
}

function markLiveUpdate() {
  const el = document.getElementById("heatmapUpdated");
  if (!el) return;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date());
  const lk = {};
  parts.forEach((p) => (lk[p.type] = p.value));
  el.textContent = `${lk.year}-${lk.month}-${lk.day} ${lk.hour}:${lk.minute} ET`;
}

// === Pagination (mirrors the reference tracker's holdings pager exactly) ===
function paginate(total, page) {
  const cap = Math.min(total, MAX_PAGES * PAGE_SIZE);
  const maxPage = Math.max(0, Math.ceil(cap / PAGE_SIZE) - 1);
  const safePage = Math.min(page, maxPage);
  const start = safePage * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, cap);
  return { start, end, cap, maxPage, page: safePage };
}

function updatePagerControls(prefix, current, cap, maxPage, start, end) {
  const label = document.getElementById(`${prefix}Label`);
  const prev = document.getElementById(`${prefix}Prev`);
  const next = document.getElementById(`${prefix}Next`);
  if (!label || !prev || !next) return;
  if (cap === 0) {
    label.textContent = "—";
    prev.hidden = true;
    next.disabled = true;
    return;
  }
  label.textContent = `${start + 1}–${end} / ${cap}`;
  prev.hidden = current === 0;
  next.disabled = current >= maxPage;
}

// === Main market table ===
function renderMarket() {
  const tbody = document.querySelector("#marketTable tbody");
  if (!tbody) return;
  if (!marketCache.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="loading">NO DATA</td></tr>`;
    return;
  }
  const p = paginate(marketCache.length, marketPage);
  marketPage = p.page;
  tbody.innerHTML = marketCache
    .slice(p.start, p.end)
    .map((c, i) => {
      const rank = p.start + i + 1;
      return `
        <tr data-rank="${rank}" data-symbol="${esc(c.symbol)}">
          <td class="num rank">${rank}</td>
          <td class="ticker-cell">${tickerCellHtml(c)}</td>
          <td class="company-cell col-name">${nameCellHtml(c)}</td>
          <td class="num col-price">${fmtPrice(c.price)}</td>
          ${pctCell(c.change)}
          <td class="num">${fmtBig(c.marketCap)}</td>
        </tr>`;
    })
    .join("");
  updatePagerControls("pager", p.page, p.cap, p.maxPage, p.start, p.end);
}

// === Gainers / Losers ===
function renderMovers() {
  // Exclude new-listing garbage (|24h| > 900% is a data artifact, not a real move).
  const eligible = marketCache.filter((c) => isFinite(c.change) && Math.abs(c.change) <= 900);
  // Dedicated /gainers/ and /losers/ pages show the FULL ranked list; the homepage
  // panels stay at 10.
  const path = location.pathname;
  const gLimit = /\/gainers\//.test(path) ? Infinity : 10;
  const lLimit = /\/losers\//.test(path) ? Infinity : 10;
  const gainers = [...eligible].sort((a, b) => b.change - a.change).slice(0, gLimit);
  const losers = [...eligible].sort((a, b) => a.change - b.change).slice(0, lLimit);
  fillMovers("gainersTable", gainers);
  fillMovers("losersTable", losers);
}

function fillMovers(id, rows) {
  const tbody = document.querySelector(`#${id} tbody`);
  if (!tbody) return;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="4" class="loading">NO DATA</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((c, i) => `
      <tr>
        <td class="num rank">${i + 1}</td>
        <td class="ticker-cell">${tickerCellHtml(c)}</td>
        ${pctCell(c.change)}
        <td class="num">${fmtPrice(c.price)}</td>
      </tr>`)
    .join("");
}

// === Highest volume ===
function renderVolume() {
  const tbody = document.querySelector("#volumeTable tbody");
  if (!tbody) return;
  const vLimit = /\/volume\//.test(location.pathname) ? Infinity : 10;
  const rows = [...marketCache]
    .filter((c) => isFinite(c.volume) && c.volume > 0)
    .sort((a, b) => b.volume - a.volume)
    .slice(0, vLimit);
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="loading">NO DATA</td></tr>`;
    return;
  }
  tbody.innerHTML = rows
    .map((c, i) => `
      <tr>
        <td class="num rank">${i + 1}</td>
        <td class="ticker-cell">${tickerCellHtml(c)}</td>
        <td class="company-cell col-name">${nameCellHtml(c)}</td>
        <td class="num">${fmtBig(c.volume)}</td>
        <td class="num">${fmtBig(c.marketCap)}</td>
      </tr>`)
    .join("");
}

// === Best performing shitcoins of the week (7d) ===
function renderBestWeek() {
  const tbody = document.querySelector("#bestWeekTable tbody");
  if (!tbody) return;
  const rows = marketCache.filter((c) => isFinite(c.change7d) && Math.abs(c.change7d) <= 1500).sort((a, b) => b.change7d - a.change7d).slice(0, 10);
  if (!rows.length) { tbody.innerHTML = `<tr><td colspan="4" class="loading">NO DATA</td></tr>`; return; }
  tbody.innerHTML = rows
    .map((c, i) => `
      <tr>
        <td class="num rank">${i + 1}</td>
        <td class="ticker-cell">${tickerCellHtml(c)}</td>
        ${pctCell(c.change7d)}
        <td class="num">${fmtPrice(c.price)}</td>
      </tr>`)
    .join("");
}

// === Daily Shitcoins Index — market-cap-weighted performance of the top 100.
// Index level = 100 means the pack is flat; +/- tracks the weighted average move. ===
// New-listing coins report garbage % (e.g. +56000% over 7d). Winsorize each
// coin's period change to +/-90% before weighting so one glitch/moonshot can't
// dominate the index — it stays a market measure, not an outlier readout.
function weightedChange(field) {
  let total = 0, weighted = 0;
  marketCache.forEach((c) => {
    if (isFinite(c.marketCap) && c.marketCap > 0 && isFinite(c[field])) {
      total += c.marketCap;
      weighted += c.marketCap * Math.max(-90, Math.min(90, c[field]));
    }
  });
  return total > 0 ? weighted / total : null;
}
function renderIndex() {
  const valEl = document.getElementById("indexValue");
  if (!valEl) return;
  const w24 = weightedChange("change");
  const w7 = weightedChange("change7d");
  if (w24 != null) {
    valEl.textContent = (100 * (1 + w24 / 100)).toFixed(2);
    setDelta(document.getElementById("indexChange"), w24);
  }
  const v7 = document.getElementById("index7dValue");
  if (v7 && w7 != null) { v7.textContent = (100 * (1 + w7 / 100)).toFixed(2); setDelta(document.getElementById("index7dChange"), w7); }
  const cnt = document.getElementById("indexCount");
  if (cnt) cnt.textContent = String(marketCache.length);
  const upd = document.getElementById("indexUpdated");
  if (upd) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
    const lk = {}; parts.forEach((p) => (lk[p.type] = p.value));
    upd.textContent = `${lk.year}-${lk.month}-${lk.day} ${lk.hour}:${lk.minute} ET`;
  }
}

// === Topbar total-market-cap quote ===
function updateQuote() {
  const priceEl = document.getElementById("mcapValue");
  if (!priceEl) return;
  let total = 0, weighted = 0;
  marketCache.forEach((c) => {
    if (isFinite(c.marketCap) && c.marketCap > 0) {
      total += c.marketCap;
      if (isFinite(c.change)) weighted += c.marketCap * c.change;
    }
  });
  if (total <= 0) return;
  priceEl.textContent = fmtBig(total);
  setDelta(document.getElementById("mcapChange"), weighted / total);
}

// === Heatmap (ported squarified treemap from the reference tracker) ===
const heatmap = (function () {
  const measureCtx = document.createElement("canvas").getContext("2d");
  function widthAt(label, size) {
    measureCtx.font = `700 ${size}px ui-monospace, "SF Mono", "Cascadia Mono", "Consolas", monospace`;
    let w = measureCtx.measureText(label).width;
    if (label.length > 1) w += (label.length - 1) * size * 0.04;
    return w;
  }
  function bestFontSize(label, maxW, maxH) {
    const hi = Math.min(20, Math.floor(maxH));
    for (let s = hi; s >= 7; s--) if (widthAt(label, s) <= maxW) return s;
    return 7;
  }
  function pickLabel(label, ticker, maxW) {
    if (widthAt(label, 7) <= maxW) return label;
    if (ticker && widthAt(ticker, 7) <= maxW) return ticker;
    const ref = ticker || label;
    if (!ref) return label;
    for (let n = ref.length; n >= 1; n--) if (widthAt(ref.slice(0, n), 7) <= maxW) return ref.slice(0, n);
    return ref.slice(0, 1);
  }
  function squarify(items, x, y, w, h, out) {
    if (!items.length) return;
    if (items.length === 1) { out.push({ item: items[0], x, y, w, h }); return; }
    let total = 0;
    for (const it of items) total += it.size;
    const shortSide = Math.min(w, h);
    let bestEnd = 0, bestRatio = Infinity, rowSum = 0;
    for (let i = 0; i < items.length; i++) {
      rowSum += items[i].size;
      let worst = 0;
      for (let j = 0; j <= i; j++) {
        const area = (items[j].size / total) * w * h;
        const side = (items[j].size / rowSum) * shortSide;
        const other = area / side;
        const ratio = Math.max(side / other, other / side);
        if (ratio > worst) worst = ratio;
      }
      if (worst <= bestRatio) { bestRatio = worst; bestEnd = i; } else break;
    }
    const row = items.slice(0, bestEnd + 1);
    const rest = items.slice(bestEnd + 1);
    let rowTotal = 0;
    for (const r of row) rowTotal += r.size;
    const rowFrac = rowTotal / total;
    let cursor = 0;
    if (w >= h) {
      const rowW = w * rowFrac;
      for (const m of row) { const ih = (m.size / rowTotal) * h; out.push({ item: m, x, y: y + cursor, w: rowW, h: ih }); cursor += ih; }
      squarify(rest, x + rowW, y, w - rowW, h, out);
    } else {
      const rowH = h * rowFrac;
      for (const n of row) { const iw = (n.size / rowTotal) * w; out.push({ item: n, x: x + cursor, y, w: iw, h: rowH }); cursor += iw; }
      squarify(rest, x, y + rowH, w, h - rowH, out);
    }
  }
  // Memecoins routinely move tens of percent intraday, so the reference's +/-5%
  // clamp would paint almost every cell max green/red. Widen to +/-20% so the
  // color channel still carries information across the pack.
  function colorForChange(pct) {
    const CAP = 20;
    const clamped = Math.max(-CAP, Math.min(CAP, pct));
    if (clamped === 0) return "#1a1a1a";
    if (clamped > 0) { const t = clamped / CAP; return `rgb(${Math.round(26 + 20 * (1 - t))},${Math.round(60 + 130 * t)},${Math.round(40 + 10 * (1 - t))})`; }
    const t = -clamped / CAP;
    return `rgb(${Math.round(80 + 130 * t)},${Math.round(30 + 10 * (1 - t))},${Math.round(30 + 10 * (1 - t))})`;
  }
  let items = [];
  function setItems(next) { items = next; }
  function render() {
    const canvas = document.getElementById("heatmapCanvas");
    if (!canvas || !items.length) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width, h = rect.height;
    if (w < 1 || h < 1) return;
    const laidOut = [];
    squarify(items.slice().sort((a, b) => b.size - a.size), 0, 0, w, h, laidOut);
    canvas.innerHTML = laidOut.map((c) => {
      const pct = c.item.changePct || 0;
      const color = colorForChange(pct);
      const minSide = Math.min(c.w, c.h);
      const displayLabel = pickLabel(c.item.label || c.item.ticker, c.item.ticker, c.w - 8);
      const tickerSize = bestFontSize(displayLabel, c.w - 8, c.h * 0.55);
      let pctSize = Math.max(6, Math.min(14, Math.round(minSide / 5)));
      const sign = pct >= 0 ? "+" : "-", abs = Math.abs(pct);
      const variants = [sign + abs.toFixed(2) + "%", sign + abs.toFixed(1) + "%", sign + abs.toFixed(1), sign + Math.round(abs), String(Math.round(abs))];
      const avail = c.w - 4;
      let pctText = variants[variants.length - 1];
      for (const v of variants) if (widthAt(v, pctSize) <= avail) { pctText = v; break; }
      while (pctSize > 5 && widthAt(pctText, pctSize) > avail) pctSize--;
      const showPct = widthAt(pctText, pctSize) <= avail && c.h >= tickerSize + pctSize + 4;
      const href = coinHref(c.item.ticker);
      const tag = href ? "a" : "div";
      return `<${tag} class="heatmap-cell"${href ? ` href="${href}"` : ""} ` +
        `style="left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;background:${color}" ` +
        `title="${esc(c.item.name)} · ${(pct >= 0 ? "+" : "") + pct.toFixed(2)}%">` +
        `<span class="heatmap-cell__ticker" style="font-size:${tickerSize}px">${esc(displayLabel)}</span>` +
        (showPct ? `<span class="heatmap-cell__pct" style="font-size:${pctSize}px">${pctText}</span>` : "") +
        `</${tag}>`;
    }).join("");
  }
  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 100); });
  return { setItems, render };
})();

// Treemap area weight = sqrt(marketCap) + offset. sqrt compresses the DOGE-vs-
// everyone gap (raw market cap makes small coins invisible slivers); the offset
// (~14% of the largest cell's weight) guarantees a visible minimum cell. Mirrors
// the reference tracker's regen-heatmap.ps1 `sqrt(btc)+80` intent, scaled to market cap.
function heatmapSize(mcap, maxCap) {
  const offset = Math.sqrt(Math.max(1, maxCap)) * 0.14;
  return Math.sqrt(Math.max(0, mcap || 0)) + offset;
}
function renderHeatmapFrom(coins) {
  const maxCap = coins.reduce((m, c) => Math.max(m, c.marketCap || 0), 0);
  heatmap.setItems(coins.map((c) => ({
    label: c.symbol, ticker: c.symbol, name: c.name,
    size: heatmapSize(c.marketCap, maxCap),
    changePct: isFinite(c.change) ? c.change : 0,
  })));
  heatmap.render();
}

// Instant paint from the SSR heatmap island before the first live fetch lands.
(function hydrateHeatmapIsland() {
  const el = document.getElementById("heatmapData");
  if (!el || !el.textContent.trim()) return;
  try {
    const payload = JSON.parse(el.textContent);
    if (payload && Array.isArray(payload.coins) && payload.coins.length) {
      heatmap.setItems(payload.coins.map((c) => ({
        label: c.symbol, ticker: c.symbol, name: c.name, size: c.size, changePct: c.changePct || 0,
      })));
      heatmap.render();
    }
  } catch (e) {}
})();

// === Ticker carousel char-highlight (ported behaviour) ===
(function carouselHighlight() {
  const c = document.querySelector(".topbar__carousel");
  if (!c) return;
  c.querySelectorAll("a").forEach((lnk) => {
    if (lnk.getAttribute("data-split") === "1") return;
    lnk.setAttribute("data-split", "1");
    const t = lnk.textContent, frag = document.createDocumentFragment();
    for (let k = 0; k < t.length; k++) { const s = document.createElement("span"); s.className = "tcc"; s.textContent = t.charAt(k); frag.appendChild(s); }
    lnk.textContent = ""; lnk.appendChild(frag);
  });
  const HALF = 110;
  function tick() {
    const r = c.getBoundingClientRect();
    if (r.width === 0) return;
    const cx = r.left + r.width / 2;
    for (const a of c.querySelectorAll("a")) {
      const lr = a.getBoundingClientRect();
      if (lr.right < r.left - 50 || lr.left > r.right + 50) continue;
      for (const ch of a.querySelectorAll(".tcc")) {
        const ar = ch.getBoundingClientRect();
        const d = Math.abs(ar.left + ar.width / 2 - cx);
        if (d > HALF) { ch.style.color = ""; continue; }
        const t = d / HALF;
        ch.style.color = `rgb(${Math.round(255 - 48 * t)},${Math.round(122 + 85 * t)},${Math.round(207 * t)})`;
      }
    }
  }
  setInterval(tick, 50);
  tick();
})();

// === Keep --topbar-h in sync with the sticky topbar's height ===
function syncTopbarHeight() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) return;
  document.documentElement.style.setProperty("--topbar-h", `${Math.round(topbar.getBoundingClientRect().height)}px`);
}

// === Pager clicks ===
document.addEventListener("click", (e) => {
  if (e.target.closest("#pagerNext")) {
    const cap = Math.min(marketCache.length, MAX_PAGES * PAGE_SIZE);
    const maxPage = Math.max(0, Math.ceil(cap / PAGE_SIZE) - 1);
    if (marketPage < maxPage) { marketPage++; renderMarket(); }
  } else if (e.target.closest("#pagerPrev")) {
    if (marketPage > 0) { marketPage--; renderMarket(); }
  }
});

document.querySelector(".topbar__brand .brand-link")?.addEventListener("click", (e) => {
  const path = window.location.pathname;
  if (path === "/" || path === "/index.html") { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }
});

// === Boot ===
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear();
syncTopbarHeight();
window.addEventListener("resize", syncTopbarHeight);
window.addEventListener("load", syncTopbarHeight);

// Load the symbol->page-slug map first so the first render can already link
// clickable coins, then fetch market data.
Promise.all([
  fetch("/data/coins-pages.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
  fetch("/data/exclude.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])).catch(() => []),
  fetch("/data/coin-logos-map.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({})),
]).then(([pm, ex, lg]) => {
  pageMap = pm || {};
  logoMap = lg || {};
  (ex || []).forEach((s) => excludeSet.add(String(s).toUpperCase()));
}).finally(loadMarket);

// Visibility-aware polling: never fetch while the tab is hidden, and refresh
// immediately (if data is stale) when the tab comes back to the foreground.
setInterval(() => { if (!document.hidden) loadMarket(); }, REFRESH_MS);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && Date.now() - lastLoad > REFRESH_MS) loadMarket();
});
