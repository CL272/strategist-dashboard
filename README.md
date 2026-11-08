# Strategist Dashboard

A personal multi-asset strategy dashboard. It covers Fed and global liquidity, cross-asset performance and correlations, and runs on **public data only** (FRED and Yahoo Finance).

It is a plain web page, so it opens in any browser (including a locked-down work laptop) with nothing to install. GitHub refreshes the data automatically every weekday.

## What's in it

| Tab | What it shows |
|---|---|
| **Liquidity** | Fed net liquidity (Fed assets − TGA − reverse repo) vs S&P 500 (levels, 13-week and YoY change, with correlation). Balance-sheet components, repo funding stress (SOFR/EFFR − IORB), Fed + ECB + BoJ balance sheets in USD, HY/IG credit spreads, Chicago Fed NFCI, M2 growth, Treasury yields and curve. Headline tiles and automatic signals. |
| **Regime** | Growth × inflation regime model ("Investment Clock" family). Growth inputs: Chicago Fed activity index, industrial production, payrolls, real retail sales, jobless claims. Inflation inputs: headline/core CPI, core CPI 3m annualised, core PCE. Each input is z-scored against its own last 10 years and averaged; the regime comes from the 3-month change in each composite (Goldilocks / Overheat / Stagflation / Slowdown). Shows the quadrant path, regime history behind any asset, a "what worked in each regime" table (investable 2-month lag or same month), and recession watch: Sahm rule, NY Fed yield-curve probability, Chauvet-Piger probability, claims, inflation. |
| **Markets** | Performance table for about 60 markets (equities across US, Europe, Japan, China/HK, N. Asia, ASEAN incl. Singapore & Malaysia, India, Australia, Brazil; sectors; bonds & credit; US rates; FX; commodities; crypto; vol). Columns: 1D/1W/1M/3M/YTD/1Y and your chosen range. Tick any rows to chart them rebased to 100. |
| **Correlation** | Correlation matrix for preset universes, plus each correlation's change vs its own 3-year average. "Biggest shifts" list (where ideas start). Rolling correlation for any two series. |

Every chart has **⤢ Focus** (enlarge for screenshots), **PNG** (downloads a titled, sourced image) and **CSV** (downloads the data). The date bar (1M … Max, or custom From/To) drives every chart and table. The URL remembers the tab and range, so you can bookmark a view.

## Daily refresh

`.github/workflows/update.yml` runs at 06:30 and 18:15 Singapore time on weekdays. It pulls the data and republishes the site. You can also run it any time: **Actions → Update data & publish dashboard → Run workflow**.

## Secrets

API keys live in **GitHub → Settings → Secrets and variables → Actions**, never in the code:

- `FRED_API_KEY`: required for reliable FRED downloads
- `ESTAT_APP_ID`: Japan e-Stat (reserved for the Japan data phase)

Run locally and the pipeline reads the same names from environment variables or `.streamlit/secrets.toml` (git-ignored). It never prints them.

## Adding a market or indicator

Add one line to `pipeline/config.py` (Yahoo ticker or FRED series id). The next run picks it up.

## Roadmap

1. ✅ Liquidity monitor, markets table, correlation lab
2. ✅ Regime tab: growth × inflation quadrant, what worked in each regime, recession watch (Sahm rule, NY Fed curve model, claims, inflation)
3. Cross-asset trend & momentum scorecard, financial-conditions composite
4. Positioning (CFTC Commitments of Traders), volatility regimes, Fed path vs market pricing
5. Asia & Singapore layer: SORA, MAS S$NEER, China credit impulse, Japan (e-Stat), Malaysia, ASEAN flows
6. Idea log: thesis, entry, target, stop, catalyst, review date, and P&L tracking
