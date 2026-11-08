# Strategist Dashboard

A personal multi-asset strategy dashboard. It covers Fed and global liquidity, cross-asset performance and correlations, and runs on **public data only** (FRED, US Treasury, Japan MOF, ECB and Yahoo Finance).

It is a plain web page, so it opens in any browser (including a locked-down work laptop) with nothing to install. GitHub refreshes the data automatically every weekday.

## What's in it

| Tab | What it shows |
|---|---|
| **Strategist View** (opens first) | Headline tiles (regime, net liquidity, stress composite, recession odds, equity breadth, USD). **Talking points**: auto-generated, factual and copyable. **What moved**: biggest 1-week or 4-week moves ranked in σ against each asset's own 5-year history. **How fragile**: stress gauges as percentiles of their last 10 years, plus a composite. **Where we are**: cross-asset grid with 1W–12M returns, distance from the 200-day average, weekly σ and 3-month sparklines; equities switch between local, USD and SGD terms. |
| **News** | Market headlines from public RSS feeds (Bloomberg Markets/Economics/Politics, CNBC, Federal Reserve, ECB, Bank of Japan, Business Times, CNA, Nikkei Asia), refreshed every 30 minutes, with category filters and search. Titles and links only; articles open on the publisher's site. The Strategist View shows the latest 10. |
| **Liquidity** | Fed net liquidity (Fed assets − TGA − reverse repo) vs S&P 500 (levels, 13-week and YoY change, with correlation). Balance-sheet components, repo funding stress (SOFR/EFFR − IORB), Fed + ECB + BoJ balance sheets in USD, HY/IG credit spreads, Chicago Fed NFCI, M2 growth, Treasury yields and curve. Headline tiles and automatic signals. |
| **Regime** | Growth × inflation regime model ("Investment Clock" family). Growth inputs: Chicago Fed activity index, industrial production, payrolls, real retail sales, jobless claims. Inflation inputs: headline/core CPI, core CPI 3m annualised, core PCE. Each input is z-scored against its own last 10 years and averaged; the regime comes from the 3-month change in each composite (Goldilocks / Overheat / Stagflation / Slowdown). Shows the quadrant path, regime history behind any asset, a "what worked in each regime" table (investable 2-month lag or same month), and recession watch: Sahm rule, NY Fed yield-curve probability, Chauvet-Piger probability, claims, inflation. |
| **Fixed Income** | Official yield curves, daily since 2005: US Treasury nominal and real (TIPS), Japan JGB 1Y–40Y (Ministry of Finance), euro area AAA 3M–30Y (ECB). Curve vs 1M/3M/1Y ago with change bars; US/Japan/euro curves side by side; 10Y yields; curve slopes; US real yields and breakeven; US−Japan and US−euro 10Y spreads vs USD/JPY and EUR/USD; FX-hedged 10Y yields for USD investors and UST hedged into JPY/EUR. |
| **Asia & Singapore** | Singapore: SORA and 3M compounded SORA, SGS 2Y/10Y, SGS vs UST 10Y, UST 10Y hedged into SGD, S$NEER proxy (dashboard estimate) and its appreciation pace, headline and MAS core inflation, NODX (total, China, US), GDP, unemployment. Asian FX vs USD and an equal-weight Asia FX index. Malaysia: OPR, headline and core CPI, industrial production, exports, GDP, unemployment. Sources: SingStat Table Builder (incl. MAS rates), OpenDOSM, Bank Negara API, Yahoo Finance FX. |
| **China & Japan** | China: CPI, 10Y and 3M rates, exports and imports, business confidence (from the NBS PMI) and consumer confidence, US−China 10Y spread vs USD/CNY (OECD Main Economic Indicators). Japan: CPI headline/core/core-core (e-Stat), producer prices, call rate and JGB yields, Tankan large manufacturers and non-manufacturers with forecasts, production/exports/retail, wages and unemployment, BoJ balance sheet and monetary base (Bank of Japan API, OECD). The Regime tab adds OECD leading indicators for the US, China, Japan, Germany, Korea and India. |
| **Markets** | Performance table for about 60 markets (equities across US, Europe, Japan, China/HK, N. Asia, ASEAN incl. Singapore & Malaysia, India, Australia, Brazil; sectors; bonds & credit; US rates; FX; commodities; crypto; vol). Columns: 1D/1W/1M/3M/YTD/1Y and your chosen range. Tick any rows to chart them rebased to 100. |
| **Correlation** | Correlation matrix for preset universes, plus each correlation's change vs its own 3-year average. "Biggest shifts" list (where ideas start). Rolling correlation for any two series. |

Every chart shows its **source** (provider and series codes) and has its **own date range** underneath (1M … Max or custom; ↺ returns it to the top bar). Every chart also has **⤢ Focus** (enlarge for screenshots), **PNG** (downloads a titled, sourced image) and **CSV** (downloads the data). The date bar (1M … Max, or custom From/To) drives every chart and table. The URL remembers the tab and range, so you can bookmark a view.

## Daily refresh

`.github/workflows/update.yml` runs every 30 minutes. Each run refreshes the headlines; the full data refresh runs once each daily slot (06:30 and 18:15 Singapore time) has passed (`pipeline/update.py`). Pushing code or a manual run always does the full refresh. You can also run it any time: **Actions → Update data & publish dashboard → Run workflow**.

## Secrets

API keys live in **GitHub → Settings → Secrets and variables → Actions**, never in the code:

- `FRED_API_KEY`: required for reliable FRED downloads
- `ESTAT_API_KEY` (or `ESTAT_APP_ID`): Japan e-Stat (reserved for the Japan data phase)

Run locally and the pipeline reads the same names from environment variables or `.streamlit/secrets.toml` (git-ignored). It never prints them.

## Credit-spread archive

FRED cut the ICE BofA spread series to a rolling 3-year window in April 2026. The daily job merges each download into `archive/<series>.csv` and commits it, so history only grows from here. Use the Baa−10Y spread (1986→) for comparisons with 2008 or 2020.

## Legacy

`legacy/` holds the earlier Streamlit version (Macro Stress Monitor) for reference. It is not used by the live dashboard.

## Adding a market or indicator

Add one line to `pipeline/config.py` (Yahoo ticker or FRED series id). The next run picks it up.

## Roadmap

0. ✅ Strategist View front page
1. ✅ Liquidity monitor, markets table, correlation lab
2. ✅ Credit-spread archive (FRED now keeps only 3 years of ICE BofA spreads), Baa−10y long history, Euro HY & Asia EM corporate spreads, reserve scarcity ratios
3. ✅ Fixed income curves (US, Japan, euro area), slopes, real yields, rate differentials vs FX, FX-hedged yields
4. ✅ Regime tab: growth × inflation quadrant, what worked in each regime, recession watch (Sahm rule, NY Fed curve model, claims, inflation)
5. Cross-asset trend & momentum scorecard, financial-conditions composite
6. Positioning (CFTC Commitments of Traders), volatility regimes, Fed path vs market pricing
7. ✅ Asia & Singapore layer (Singapore, Asian FX, Malaysia) and News tab. 
8. ✅ China & Japan macro and global leading indicators. Next: valuation (CAPE, ERP), stress panel & calendar
8. Idea log: thesis, entry, target, stop, catalyst, review date, and P&L tracking
