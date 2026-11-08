# Strategist Dashboard

A personal multi-asset strategy dashboard. It covers Fed and global liquidity, cross-asset performance and correlations, and runs on **public data only** (FRED, US Treasury, Japan MOF, ECB and Yahoo Finance).

It is a plain web page, so it opens in any browser (including a locked-down work laptop) with nothing to install. GitHub refreshes the data automatically every weekday.

## What's in it

| Tab | What it shows |
|---|---|
| **Strategist View** (opens first) | Headline tiles (regime, net liquidity, stress composite, recession odds, equity breadth, USD). **Talking points**: auto-generated, factual and copyable. **What moved**: biggest 1-week or 4-week moves ranked in σ against each asset's own 5-year history. **How fragile**: stress gauges as percentiles of their last 10 years, plus a composite. **Where we are**: cross-asset grid with 1W–12M returns, distance from the 200-day average, weekly σ and 3-month sparklines; equities switch between local, USD and SGD terms. |
| **News** | Market headlines from public RSS feeds (Bloomberg Markets/Economics/Politics, CNBC, Federal Reserve, ECB, Bank of Japan, Business Times, CNA, Nikkei Asia), refreshed every 30 minutes, with category filters and search. Titles and links only; articles open on the publisher's site. The Strategist View shows the latest 10. |
| **Stress & Signposts** | Ported from the earlier Streamlit version (legacy/data/composite.py, registry.py, growth.py, signposts.py). Composite stress panel: 23 members in Funding, Credit and Growth blocks, each percentile-ranked weekly against its trailing 10 years and sign-aligned, blocks weighted equally (bands Calm / Normal / Above normal / Elevated / Acute); heatmap of every member, "where everything stands" table, growth tripwires (Sahm, CFNAI-MA3, claims vs 52-week low) and the OFR Financial Stress Index as a cross-check. Peak signposts: the nine legacy rules (P/E and CAPE stretched, volatility and credit complacency, curve inversion, policy tightening, bank lending standards, labour at cycle tights, quality decompression) at the five S&P 500 peaks and the last three months, % triggered since 1970, rules, notes and coverage. |
| **Liquidity** | Fed net liquidity (Fed assets − TGA − reverse repo) vs S&P 500 (levels, 13-week and YoY change, with correlation). Balance-sheet components, repo funding stress (SOFR/EFFR − IORB), Fed + ECB + BoJ balance sheets in USD, HY/IG credit spreads, Chicago Fed NFCI, M2 growth, Treasury yields and curve. Headline tiles and automatic signals. |
| **Regime & Leading** | Growth × inflation regime model ("Investment Clock" family), inputs from 1959 so regimes cover the 1970s onward. Each input is z-scored against all of its own history; direction = 6-month change in each composite; a regime is confirmed after two consecutive months. Shows signal strength, how many of four alternative constructions agree, growth level vs trend, and a built-in methodology/robustness panel with the research behind it. Leading indicators: a DIY US leading index (Conference Board method, free FRED proxies) with diffusion, drivers and the 3Ds recession rule, its lead over the regime growth signal, OECD leading indicators, copper/gold vs 10Y, cyclicals vs defensives. Shows the quadrant path, regime history behind any asset, a "what worked in each regime" table (investable 2-month lag or same month), and recession watch: Sahm rule, NY Fed yield-curve probability, Chauvet-Piger probability, claims, inflation. |
| **Fixed Income** | Official yield curves, daily since 2005: US Treasury nominal and real (TIPS), Japan JGB 1Y–40Y (Ministry of Finance), euro area AAA 3M–30Y (ECB). Curve vs 1M/3M/1Y ago with change bars; US/Japan/euro curves side by side; 10Y yields; curve slopes; US real yields and breakeven; US−Japan and US−euro 10Y spreads vs USD/JPY and EUR/USD; FX-hedged 10Y yields for USD investors and UST hedged into JPY/EUR. |
| **Asia Pacific** | Malaysia first: ringgit vs USD, SGD, EUR, GBP, JPY, AUD and CNY (chart and cross-rate table), OPR and inflation, bank lending/base/fixed-deposit rates, DOSM leading/coincident/lagging indices and diffusion, industrial production, retail trade, GDP, unemployment, exports/imports and trade balance, CPI/core/PPI, M2/M3. Singapore: SORA, SGS yields, SGS vs UST, UST hedged into SGD, S$NEER proxy, inflation, NODX, GDP, unemployment. Australia: RBA cash rate, bank bills, 2Y/10Y, CPI and trimmed mean vs the 2–3% target, AUD/USD vs the AU−US 2Y gap, jobs, GDP, credit, terms of trade. Across Asia: inflation, exports, 10Y yields, short rates, industrial production and confidence for Malaysia, Singapore, Australia, Korea, India, Indonesia, China and Japan. Asian FX vs USD. Sources: OpenDOSM, Bank Negara, SingStat/MAS, Reserve Bank of Australia, OECD, Yahoo Finance. |
| **China & Japan** | China: CPI, 10Y and 3M rates, exports and imports, business confidence (from the NBS PMI) and consumer confidence, US−China 10Y spread vs USD/CNY (OECD Main Economic Indicators). Japan: CPI headline/core/core-core (e-Stat), producer prices, call rate and JGB yields, Tankan large manufacturers and non-manufacturers with forecasts, production/exports/retail, wages and unemployment, BoJ balance sheet and monetary base (Bank of Japan API, OECD). The Regime tab adds OECD leading indicators for the US, China, Japan, Germany, Korea and India. |
| **AI** | OpenRouter: most-used models and share by model maker (weekly tokens), token volume and usage-weighted price over time (archived daily from 8 Nov 2026), price vs capability frontier, cost per request. Epoch AI: frontier benchmark progress (GPQA Diamond, SWE-bench Verified), AI lab revenue, AI data-centre power (built and planned), AI chip compute shipped by designer. AI equity basket vs S&P 500 and semiconductors. |
| **Markets** | Performance table and relative-performance chart in local currency or in USD, SGD, MYR, EUR, GBP, JPY or AUD, for about 60 markets (equities across US, Europe, Japan, China/HK, N. Asia, ASEAN incl. Singapore & Malaysia, India, Australia, Brazil; sectors; bonds & credit; US rates; FX; commodities; crypto; vol). Columns: 1D/1W/1M/3M/YTD/1Y and your chosen range. Tick any rows to chart them rebased to 100. |
| **Valuation** | Scorecard of where each market sits against its own history (CAPE, P/E, excess CAPE yield, dividend yield, TIPS real yield, term premium, Baa spread, BIS real exchange rates, real oil), CAPE since 1881 rolled forward to today, CAPE vs the next 10 years' real return with the implied return today, equity risk premium, ACM term premium, currency valuation vs 10-year average, global equities vs their 10-year trend. Sources: Shiller (Yale), NY Fed, BIS via FRED. |
| **Data health** | Every series checked against its normal publishing rhythm; stale or missing series open a "Data health alert" issue on GitHub (which emails you) and close it when fixed. |
| **Positioning & Vol** | Volatility: VIX term structure (9-day to 6-month) vs 1M/1Y ago, cross-asset implied vol percentiles (VIX, VXN, VVIX, SKEW, MOVE, OVX, GVZ), VIX/VIX-3M stress gauge with what the S&P 500 did after past inversions, implied vs realised vol. Positioning: CFTC Commitments of Traders for 22 futures (equities, Treasuries, FX, Bitcoin, VIX, metals, energy): speculators' net % of open interest, 3-year percentile and z-score, weekly changes, crowded-trade flags, the other side (asset managers / producers), and history vs price. |
| **Correlation** | Correlation matrix for preset universes, plus each correlation's change vs its own 3-year average. "Biggest shifts" list (where ideas start). Rolling correlation for any two series. Yields and spreads count as bond returns by default (a fall in yield = a gain), so positive stocks vs yields means stocks and bonds move together; switch with "Yields as". |

The menu sits in a **sidebar** on the left (a ☰ button on phones). Each page is split into **sub-tabs** (e.g. Asia Pacific: Malaysia · Singapore · Australia · Across Asia · Asian FX; Markets: Equities · Rates & credit · FX · Commodities & crypto · Volatility), so only one section shows at a time; the sub-tab bar stays in view as you scroll and the URL remembers it. Every chart shows its **source** (provider and series codes) and has its **own date range** underneath (1M … Max or custom; ↺ returns it to the top bar). **Drag across any time chart to zoom** into that period. Paired series (e.g. net liquidity vs S&P 500) share one chart with left and right axes; **⇅ Stack** switches to two panels. **↕ Y** sets the y-axis minimum and maximum by hand (left and right axes separately; Auto resets). Every chart also has **⤢ Focus** (enlarge for screenshots), **PNG** (downloads a titled, sourced image) and **CSV** (downloads the data). The date bar (1M … Max, or custom From/To) drives every chart and table. The URL remembers the tab and range, so you can bookmark a view.

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
7. ✅ Asia Pacific layer (Malaysia, Singapore, Australia, Korea, India, Indonesia, Asian FX) and News tab. 
8. ✅ China & Japan macro and global leading indicators.
11. ✅ Positioning & volatility; stress panel and peak signposts
10. ✅ Valuation tab and data-health alerts
9. ✅ Robust regime model with long history, DIY leading index, AI tab, sidebar layout. Next: valuation (CAPE, ERP), stress panel & calendar
8. Idea log: thesis, entry, target, stop, catalyst, review date, and P&L tracking
