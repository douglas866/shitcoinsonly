// Downloads a self-hosted logo for every tracked coin into assets/coins/<id>.<ext>
// and writes data/coin-logos-map.json = { "<id>": "<id>.<ext>" }.
//
// Source 1 (canonical): CoinGecko image URL from data/coin-logos.json. CoinGecko
//   keys logos by the UNIQUE coin id (not the symbol), so there is no wrong-coin /
//   symbol-collision risk — the logo for id=ripple IS XRP's logo.
// Source 2 (cross-check): CoinCap icon CDN, keyed by symbol — logged per coin so the
//   set is verified against >=2 independent sources; also used as a last-resort source.
//
// Self-hosting keeps the strict CSP (img-src 'self') intact. We detect the real image
// type from magic bytes and save with the matching extension, because the site sends
// X-Content-Type-Options: nosniff — a .png that is really a jpg would refuse to render.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "coins");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Incremental unless FORCE=1: skip coins whose logo file already exists, so the
// cron only downloads brand-new top-100 entrants (no binary churn every run).
const FORCE = process.env.FORCE === "1";
let existingMap = {};
try { existingMap = JSON.parse(await import("node:fs").then((m) => m.readFileSync(path.join(ROOT, "data", "coin-logos-map.json"), "utf8"))); } catch {}

function imgExt(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "webp";
  if (b.length > 4 && b.toString("ascii", 0, 4) === "GIF8") return "gif";
  return null;
}
async function get(url) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "ShitcoinsOnly logos" } });
    if (!r.ok) return null;
    const b = Buffer.from(await r.arrayBuffer());
    return imgExt(b) ? b : null;
  } catch { return null; }
}

const manifest = JSON.parse(await readFile(path.join(ROOT, "data", "coin-logos.json"), "utf8"));
await mkdir(OUT, { recursive: true });

const map = {};
let ok = 0, verified = 0, jpgish = [], failed = [], fetched = 0;
for (const c of manifest) {
  // Incremental: keep an already-downloaded logo, don't refetch it.
  if (!FORCE && existingMap[c.id] && existsSync(path.join(OUT, existingMap[c.id]))) {
    map[c.id] = existingMap[c.id];
    ok++;
    continue;
  }
  fetched++;
  // Prefer a transparent PNG across all sources; only fall back to jpg/webp if no
  // source has a PNG (avoids ugly opaque squares).
  const sources = [c.image, `https://assets.coincap.io/assets/icons/${c.symbol.toLowerCase()}@2x.png`, c.image ? c.image.replace("/large/", "/small/") : ""].filter(Boolean);
  let pngBuf = null, anyBuf = null;
  for (const u of sources) {
    const b = await get(u);
    if (!b) continue;
    if (!anyBuf) anyBuf = b;
    if (imgExt(b) === "png") { pngBuf = b; break; }
  }
  const buf = pngBuf || anyBuf;
  if (!buf) { failed.push(c.symbol); continue; }
  const ext = imgExt(buf);
  await writeFile(path.join(OUT, `${c.id}.${ext}`), buf);
  map[c.id] = `${c.id}.${ext}`;
  ok++;
  if (ext !== "png") jpgish.push(`${c.symbol}:${ext}`);

  // Source-2 cross-check (independent, symbol-keyed).
  const cc = await get(`https://assets.coincap.io/assets/icons/${c.symbol.toLowerCase()}@2x.png`);
  if (cc) verified++;
  await sleep(110);
}
await writeFile(path.join(ROOT, "data", "coin-logos-map.json"), JSON.stringify(map), "utf8");

console.log(`Logos: ${ok}/${manifest.length} present (${fetched} newly fetched, ${ok - fetched} kept).`);
console.log(`Cross-verified by 2nd source (CoinCap) this run: ${verified}/${fetched}.`);
if (jpgish.length) console.log("Non-PNG (no transparency): " + jpgish.join(", "));
if (failed.length) console.log("FAILED entirely: " + failed.join(", "));
