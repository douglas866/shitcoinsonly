import { readFile, writeFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "coins");
const map = JSON.parse(await readFile(path.join(ROOT, "data", "coin-logos-map.json"), "utf8"));

function ext(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return "png";
  if (b[0] === 0xff && b[1] === 0xd8) return "jpg";
  if (b.toString("ascii", 0, 4) === "RIFF") return "webp";
  return null;
}
// Last-resort transparent PNGs for the few coins CoinGecko/CoinCap only had as jpg.
const TW = {
  pepe: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6982508145454Ce325dDbE47a25d4ec3d2311933/logo.png",
  layerzero: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0x6985884C4392D348587B19cb9eAAf157F13271cd/logo.png",
};
for (const [id, url] of Object.entries(TW)) {
  try {
    const r = await fetch(url, { headers: { "user-agent": "logos" } });
    if (!r.ok) { console.log(`${id}: TW ${r.status}`); continue; }
    const b = Buffer.from(await r.arrayBuffer());
    if (ext(b) === "png") { await writeFile(path.join(OUT, `${id}.png`), b); map[id] = `${id}.png`; console.log(`${id}: replaced with transparent PNG`); }
  } catch (e) { console.log(`${id}: ${e.message}`); }
}
await writeFile(path.join(ROOT, "data", "coin-logos-map.json"), JSON.stringify(map), "utf8");

// Remove any file not referenced by the (updated) map.
const keep = new Set(Object.values(map));
let removed = 0;
for (const f of await readdir(OUT)) {
  if (!keep.has(f)) { await unlink(path.join(OUT, f)); removed++; }
}
console.log(`Cleanup: removed ${removed} stale files; ${keep.size} referenced.`);
const jpg = Object.values(map).filter((f) => !f.endsWith(".png"));
console.log(`Remaining non-PNG: ${jpg.length}` + (jpg.length ? " (" + jpg.join(", ") + ")" : ""));
