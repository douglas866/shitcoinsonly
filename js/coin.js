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
