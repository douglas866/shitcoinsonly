// Per-coin page: refresh this coin's live price/mcap/24h/volume from /api/prices
// (falls back to CoinGecko directly for local static preview), plus the shared
// topbar carousel highlight and sticky-topbar height sync.

(function () {
  "use strict";
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

  const host = document.querySelector("[data-coin-id]");
  const id = host && host.getAttribute("data-coin-id");

  function set(elId, text, cls) {
    const el = document.getElementById(elId);
    if (!el) return;
    el.textContent = text;
    if (cls !== undefined) { el.classList.remove("up", "down"); if (cls) el.classList.add(cls); }
  }

  function refresh() {
    if (!id) return;
    const api = "/api/prices?ids=" + encodeURIComponent(id);
    const cg = "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=" + encodeURIComponent(id) + "&price_change_percentage=24h";
    const get = (u) => fetch(u, { cache: "no-store" }).then((r) => { if (!r.ok) throw 0; return r.json(); });
    get(api).catch(() => get(cg)).then((arr) => {
      const m = Array.isArray(arr) && arr[0];
      if (!m) return;
      set("coinPrice", fmtPrice(m.current_price));
      const ch = m.price_change_percentage_24h;
      set("coinChange", ch == null || isNaN(ch) ? "—" : fmtPctNum(ch), ch >= 0 ? "up" : "down");
      set("coinMcap", fmtBig(m.market_cap));
      set("coinVol", fmtBig(m.total_volume));
    }).catch(() => {});
  }

  // ---- neon price chart (self-contained canvas, no library) ----
  const brand = (host && host.getAttribute("data-brand")) || "#b06bff";
  function hexToRgb(h) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
    return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [176, 107, 255];
  }
  const rgb = hexToRgb(brand);
  const rgba = (a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
  let lastPrices = null;

  function drawChart(prices) {
    const cv = document.getElementById("coinChart");
    const empty = document.getElementById("coinChartEmpty");
    if (!cv) return;
    if (prices) lastPrices = prices;
    if (!prices || prices.length < 2) { if (empty) { empty.textContent = "Chart unavailable"; empty.style.display = ""; } cv.style.opacity = "0"; return; }
    if (empty) empty.style.display = "none";
    cv.style.opacity = "1";
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = cv.clientWidth || 820, cssH = cv.clientHeight || 260;
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const vals = prices.map((p) => p[1]);
    let lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi === lo) { hi += 1; lo -= 1; }
    const padT = 14, padB = 16, padL = 0, padR = 0;
    const W = cssW - padL - padR, H = cssH - padT - padB;
    const x = (i) => padL + (i / (prices.length - 1)) * W;
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * H;
    // faint baseline grid
    ctx.strokeStyle = "rgba(255,255,255,0.05)"; ctx.lineWidth = 1;
    for (let g = 0; g <= 3; g++) { const gy = padT + (g / 3) * H; ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cssW, gy); ctx.stroke(); }
    // area fill
    ctx.beginPath(); ctx.moveTo(x(0), y(vals[0]));
    for (let i = 1; i < prices.length; i++) ctx.lineTo(x(i), y(vals[i]));
    ctx.lineTo(x(prices.length - 1), padT + H); ctx.lineTo(x(0), padT + H); ctx.closePath();
    const grad = ctx.createLinearGradient(0, padT, 0, padT + H);
    grad.addColorStop(0, rgba(0.34)); grad.addColorStop(1, rgba(0));
    ctx.fillStyle = grad; ctx.fill();
    // glowing line
    ctx.beginPath(); ctx.moveTo(x(0), y(vals[0]));
    for (let i = 1; i < prices.length; i++) ctx.lineTo(x(i), y(vals[i]));
    ctx.shadowColor = rgba(0.6); ctx.shadowBlur = 10;
    ctx.strokeStyle = brand; ctx.lineWidth = 2.2; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.stroke();
    ctx.shadowBlur = 0;
    // last-point dot
    const lx = x(prices.length - 1), ly = y(vals[vals.length - 1]);
    ctx.beginPath(); ctx.arc(lx, ly, 3.4, 0, Math.PI * 2); ctx.fillStyle = brand; ctx.fill();
    ctx.beginPath(); ctx.arc(lx, ly, 6.5, 0, Math.PI * 2); ctx.fillStyle = rgba(0.22); ctx.fill();
  }

  function loadChart(days) {
    if (!id) return;
    const empty = document.getElementById("coinChartEmpty");
    if (empty) { empty.textContent = "Loading chart…"; empty.style.display = ""; }
    const url = "https://api.coingecko.com/api/v3/coins/" + encodeURIComponent(id) + "/market_chart?vs_currency=usd&days=" + days;
    fetch(url, { cache: "no-store" }).then((r) => { if (!r.ok) throw 0; return r.json(); })
      .then((d) => drawChart(d && d.prices))
      .catch(() => { if (empty) { empty.textContent = "Chart unavailable"; empty.style.display = ""; } });
  }

  (function chartInit() {
    const ranges = document.getElementById("coinChartRanges");
    let current = 30;
    if (ranges) {
      ranges.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-days]");
        if (!b) return;
        ranges.querySelectorAll("button").forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
        current = parseInt(b.getAttribute("data-days"), 10) || 30;
        loadChart(current);
      });
    }
    let redrawTimer;
    window.addEventListener("resize", () => { clearTimeout(redrawTimer); redrawTimer = setTimeout(() => { if (lastPrices) drawChart(lastPrices); }, 150); });
    loadChart(current);
  })();

  // Shared topbar carousel spotlight (same behaviour as the homepage).
  (function carousel() {
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
    setInterval(tick, 50); tick();
  })();

  function syncTopbarHeight() {
    const topbar = document.querySelector(".topbar");
    if (topbar) document.documentElement.style.setProperty("--topbar-h", `${Math.round(topbar.getBoundingClientRect().height)}px`);
  }
  const y = document.getElementById("year");
  if (y) y.textContent = new Date().getFullYear();
  syncTopbarHeight();
  window.addEventListener("resize", syncTopbarHeight);
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
})();
