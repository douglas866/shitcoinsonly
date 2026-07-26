# ShitcoinsOnly

A dark, minimalist tracker for shitcoins and memecoins — live price, 24h change,
market cap and volume. Static front-end on Cloudflare Pages with one Pages
Function that proxies live market data. Deploys to **shitcoinsonly.com**.

> Separate project from hodlingbtc.com. Own repo, own Cloudflare Pages project,
> own domain. Nothing here touches the BTC site.

## Architecture

```
/
├── index.html            # Topbar, tagline, heatmap, live market table
├── css/styles.css        # Dark theme, dense data grids (shared visual system)
├── js/app.js             # Loads coins.json, polls /api/prices, renders table + heatmap
├── data/coins.json       # Tracked coin list (symbol, name, slug, coingeckoId, chain)
├── functions/api/
│   └── prices.js         # Proxies CoinGecko /coins/markets, edge-cached 60s
├── _headers / _redirects # Cloudflare Pages edge config (CSP, caching)
├── robots.txt / sitemap.xml
└── manifest.json
```

## Data source

All market data comes from the public **CoinGecko** `/coins/markets` endpoint,
proxied through `/api/prices` so the browser never calls CoinGecko directly
(avoids CORS + rate limits, and lets the Cloudflare edge cache each response for
60s). The client falls back to calling CoinGecko directly only for local static
preview where the Function isn't running.

No contract addresses and no outbound links are shown on the site by design.

## Adding or removing coins

Edit `data/coins.json`. Each entry needs a valid `coingeckoId` (the id CoinGecko
uses in its URL, e.g. `dogwifcoin` for WIF) — that's the key everything hinges
on. The table re-sorts by market cap automatically on the next load.

## Local preview

Any static server from the project root works, e.g.:

```powershell
npx serve .
```

`/api/prices` won't exist locally, so `app.js` falls back to CoinGecko directly.

## Deployment

Deploys to Cloudflare Pages via **Connect to Git** (its own new repo + its own
new Pages project — never the hodlingbtc project):

1. Push this repository to a new GitHub repo.
2. Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**,
   select the repo.
3. Build settings: framework preset *None*, no build command, output directory `/`.
4. Add the custom domain **shitcoinsonly.com** in the Pages project.
