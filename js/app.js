// ShitcoinsOnly - homepage renderer.
// Loads the tracked-coin list (data/coins.json), fetches live market data
// (/api/prices, which proxies CoinGecko), and renders the market table,
// the heatmap and the topbar total-market-cap quote. Refreshes every 60s.

(function () {
  "use strict";

  var REFRESH_MS = 60000;
  var COINS_URL = "/data/coins.json";
  var API_URL = "/api/prices";
  // Direct fallback for local static preview where /api/prices does not exist.
  var CG_MARKETS = "https://api.coingecko.com/api/v3/coins/markets";

  var usd = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Sub-cent memecoin prices need many decimals to be meaningful.
  function fmtPrice(p) {
    if (!isFinite(p) || p <= 0) return "—";
    if (p >= 1) return usd.format(p);
    if (p >= 0.01) return "$" + p.toFixed(4);
    if (p >= 0.0001) return "$" + p.toFixed(6);
    return "$" + p.toPrecision(2);
  }

  function fmtBig(n) {
    if (!isFinite(n) || n <= 0) return "—";
    if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(2) + "K";
    return "$" + n.toFixed(0);
  }

  function fmtPct(v) {
    if (v == null || !isFinite(v)) return "—";
    return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
  }

  function pctClass(v) {
    if (v == null || !isFinite(v)) return "";
    return v >= 0 ? "up" : "down";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function getJSON(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error(url + " -> " + r.status);
      return r.json();
    });
  }

  // Try the edge proxy first; on any failure fall back to CoinGecko directly.
  function fetchMarkets(ids) {
    var q = "?ids=" + encodeURIComponent(ids.join(","));
    return getJSON(API_URL + q).catch(function () {
      var u =
        CG_MARKETS +
        q +
        "&vs_currency=usd&order=market_cap_desc&per_page=" +
        ids.length +
        "&page=1&sparkline=false&price_change_percentage=24h";
      return getJSON(u);
    });
  }

  function renderTable(rows) {
    var tbody = document.getElementById("marketBody");
    if (!tbody) return;
    var html = "";
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      var pc = pctClass(c.change);
      html +=
        '<tr data-rank="' + (i + 1) + '" data-symbol="' + esc(c.symbol) + '">' +
        '<td class="num rank">' + (i + 1) + "</td>" +
        '<td class="ticker-cell"><span class="ticker-link">' + esc(c.symbol) + "</span></td>" +
        '<td class="company-cell"><span class="company-link">' + esc(c.name) + "</span></td>" +
        '<td class="country-cell">' + esc(c.chain || "") + "</td>" +
        '<td class="num">' + fmtPrice(c.price) + "</td>" +
        '<td class="num ' + pc + '">' + fmtPct(c.change) + "</td>" +
        '<td class="num">' + fmtBig(c.marketCap) + "</td>" +
        '<td class="num">' + fmtBig(c.volume) + "</td>" +
        "</tr>";
    }
    tbody.innerHTML = html;
  }

  function renderHeatmap(rows) {
    var canvas = document.getElementById("heatmapCanvas");
    if (!canvas) return;
    var withCap = rows.filter(function (c) {
      return isFinite(c.marketCap) && c.marketCap > 0;
    });
    if (!withCap.length) return;
    var html = "";
    for (var i = 0; i < withCap.length; i++) {
      var c = withCap[i];
      // sqrt keeps the biggest coin from swallowing the whole grid.
      var grow = Math.max(1, Math.sqrt(c.marketCap));
      var cls = pctClass(c.change);
      html +=
        '<div class="heat-tile ' + cls + '" style="flex-grow:' + grow.toFixed(2) + '">' +
        '<span class="heat-sym">' + esc(c.symbol) + "</span>" +
        '<span class="heat-chg">' + fmtPct(c.change) + "</span>" +
        "</div>";
    }
    canvas.innerHTML = html;
  }

  function updateQuote(rows) {
    var priceEl = document.getElementById("mcapValue");
    var deltaEl = document.getElementById("mcapChange");
    if (!priceEl) return;
    var total = 0;
    var weighted = 0;
    for (var i = 0; i < rows.length; i++) {
      var c = rows[i];
      if (isFinite(c.marketCap) && c.marketCap > 0) {
        total += c.marketCap;
        if (isFinite(c.change)) weighted += c.marketCap * c.change;
      }
    }
    if (total <= 0) return;
    priceEl.textContent = fmtBig(total);
    if (deltaEl) {
      var avg = weighted / total;
      deltaEl.textContent = fmtPct(avg);
      deltaEl.classList.toggle("up", avg >= 0);
      deltaEl.classList.toggle("down", avg < 0);
    }
  }

  function setStatus(msg) {
    var el = document.getElementById("marketStatus");
    if (el) el.textContent = msg;
  }

  var COINS = [];

  function refresh() {
    if (!COINS.length) return;
    var ids = COINS.map(function (c) {
      return c.coingeckoId;
    }).filter(Boolean);
    var meta = {};
    COINS.forEach(function (c) {
      meta[c.coingeckoId] = c;
    });

    fetchMarkets(ids)
      .then(function (mk) {
        if (!Array.isArray(mk)) throw new Error("bad payload");
        var rows = mk.map(function (m) {
          var base = meta[m.id] || {};
          return {
            symbol: (base.symbol || m.symbol || "").toUpperCase(),
            name: base.name || m.name,
            chain: base.chain || "",
            price: m.current_price,
            change: m.price_change_percentage_24h,
            marketCap: m.market_cap,
            volume: m.total_volume,
          };
        });
        rows.sort(function (a, b) {
          return (b.marketCap || 0) - (a.marketCap || 0);
        });
        renderTable(rows);
        renderHeatmap(rows);
        updateQuote(rows);
        setStatus("");
      })
      .catch(function (e) {
        setStatus("Live data unavailable — retrying…");
      });
  }

  getJSON(COINS_URL)
    .then(function (list) {
      COINS = Array.isArray(list) ? list : [];
      refresh();
      setInterval(refresh, REFRESH_MS);
    })
    .catch(function () {
      setStatus("Could not load coin list.");
    });
})();
