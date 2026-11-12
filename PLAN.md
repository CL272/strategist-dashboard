# Build plan: next additions

Written 10 Nov 2026 as a design brief. Build in the order below, one work package (WP) per commit.
Follow `CLAUDE.md` for every package: own sub-tab, about 2,300 px per sub-tab at 1440×900 (measure it),
half-width cards paired, long tables capped, sources on every card, public data only.

**Progress (10 Nov 2026, evening):** WP-R1 to WP-R5 done; WP1 to WP6 built and published. WP7 (sentiment) built
after the owner's go-ahead. Palm oil, GDPNow, MICH, EXPINF1YR and the money-fund series come from FRED: confirm in the
run log that each loaded.

Status of each data source is marked **[verified]** (fetched from the sandbox on 10 Nov 2026) or
**[check on runner]** (FRED is blocked in the sandbox; confirm in the GitHub run log before relying on it).

---

## To do next (owner's request, 11 Nov 2026): WP8, WP9, WP10, WP11, WP12

**Status: all five built on 11 Nov 2026.** Departures: WP10 uses UN Comtrade only (the Bank of Korea ECOS key is issued to Korean residents only), so Korea chip exports run several months behind and say so on the card; WP11 sits in AI → Business vs developers; WP12 in AI → Compute prices (Silicon Data is linked in a note, not charted).

Scheduled to be built at 13:50 SGT on 11 Nov, after the usage limit resets, in this order. Follow `CLAUDE.md` (sub-tabs, ≤ 2,300 px, ≤ 5 tiles,
≤ 16 rows at rest, quiet card headers) and run `node tools/design-check.js` before each push. One commit per package.

### WP8. Spreads in Fixed Income

**Why:** Fixed Income has curves, yields and FX hedging but no spreads; today the credit charts sit on Liquidity
and Stress. All the data is on FRED (checked 11 Nov 2026).

**New data** (`pipeline/config.py`, FRED; add the ICE BofA ones to `ARCHIVE`, because FRED keeps only 3 years of them):

| id | FRED | what | status |
|---|---|---|---|
| `AAA_OAS`, `AA_OAS`, `A_OAS`, `BBB_OAS` | BAMLC0A1CAAA, BAMLC0A2CAA, BAMLC0A3CA, BAMLC0A4CBBB | US IG by rating | new |
| `B_OAS` | BAMLH0A2HYB | US single-B | new (BB, CCC already loaded) |
| `EM_CORP_OAS`, `EM_HY_OAS` | BAMLEMCBPIOAS, BAMLEMHBHYCRPIOAS | EM corporates, EM high yield | new |
| `AAA_10Y` | AAA10Y | Moody's Aaa − 10Y (since 1983) | new |
| `MORT_10Y` | MORTGAGE30US minus DGS10 (derived) | US mortgage spread | new |
| `IT_10Y`, `ES_10Y`, `FR_10Y`, `DE_10Y` | IRLTLT01ITM156N, …ES…, …FR…, …DE… | euro sovereign 10Y, monthly | new |
| already loaded | HY_OAS, IG_OAS, BB_OAS, CCC_OAS, EUR_HY_OAS, ASIA_CORP_OAS, BAA_10Y, 2s10s, 3m10y | | reuse |

**New sub-tab** Fixed Income → **Spreads** (after Yields), about 1,800 px:
1. Wide: **Credit spreads** with a segmented toggle US IG · US HY · Europe & EM · Asia. Default US IG vs HY. Each line
   gets a dashed 10-year median (archive + Baa−10Y for the long view; note where history is only 3 years).
2. Half: **Rating ladder** table: AAA, AA, A, BBB, BB, B, CCC: level, 1M change, 1Y range bar, percentile vs history
   available. 7 rows.
3. Half: **Where spreads stand** table: every spread above, level, 1M change, percentile, one-word read
   (Tight / Normal / Wide at the 20th and 80th percentiles). Capped at 12 with Show all.
4. Half: **Euro periphery**: Italy − Germany and Spain − Germany 10Y, France − Germany (monthly), bp.
5. Half: **Spreads vs equities**: US HY OAS vs S&P 500 drawdown from its high, dual axis (drawPair).
- Tiles (≤ 5): US IG OAS, US HY OAS, BBB OAS, Italy − Germany, mortgage spread.
- Liquidity → Credit card stays as a summary but gains a "More in Fixed Income → Spreads" link; Stress unchanged.
- Add LL_PAIRS: HY OAS → S&P 500 YoY (inverse), HY OAS → unemployment change.
- health.py: the new FRED series are daily (OAS, AAA10Y), weekly (mortgage) or monthly (euro 10Y, ~2-month lag:
  allow 100 days).

### WP9. Regions: US · Europe · Asia ex-Japan · Japan · Australia

**Why:** the sidebar's Regions group holds only "Asia", and US and euro-area data are spread across the Macro pages.
Each region gets one page with the same shape, so a client question ("what about Europe?") has one place to go.

**Sidebar after this:** Overview (5) · Macro: Regime & Leading, Stress & Signposts, Liquidity, Central banks ·
**Regions: US · Europe · Asia ex-Japan · Japan · Australia** · Markets (5) · Themes (1) · System (1).

**Page shape (every region):** tiles (≤ 5) · sub-tabs `Economy` · `Rates & markets` · `Policy` (a short summary that
links to Central banks for the detail; no duplicate cards). Cards that already exist are moved, not copied; where a
chart is needed on two pages, build a second card from the same render function with its own key.

| Page | Sub-tabs and contents | New data |
|---|---|---|
| **US** | Growth & jobs (payrolls, unemployment, claims, retail sales, GDP/GDPNow) · Inflation (CPI/PCE, expectations) · **US ISM** and **Recession watch** move here from Regime · Housing & consumer (housing starts, Case-Shiller YoY, mortgage rate, UMich sentiment) · Rates & markets (UST curve, real yields, S&P/Nasdaq/Russell, DXY) | HOUST, CSUSHPINSA, MORTGAGE30US, RSAFS (retail sales nominal) |
| **Europe** | Economy (HICP headline/core, unemployment, GDP growth, euro and German business confidence) · Rates & spreads (Bund curve from `curves.json` EA, EA 2/10/30Y, Italy − Bund from WP8, euro HY OAS) · Markets (Euro Stoxx 50, DAX, CAC, FTSE, EUR/USD, GBP/USD) · Policy (ECB summary + link) | euro unemployment and M3 from the ECB Data Portal (FRED's copies stopped in 2023): find the LFSI and BSI keys on build; GDP CLVMNACSCAB1GQEA19 (FRED, quarterly) |
| **Asia ex-Japan** | today's Asia page minus Japan and Australia: `Malaysia` Markets & rates · Economy │ `Region` Singapore · China │ `Compare` Across Asia · Asian FX | none |
| **Japan** | Economy (the current Japan cards: CPI, Tankan, activity) · Rates & markets (JGB curve from `curves.json`, JGB 2/10/30Y, USD/JPY, Nikkei/TOPIX) · Policy (BoJ summary + link) | none |
| **Australia** | the current Australia cards (cash rate, inflation, rate differential, growth, terms of trade) split into Economy · Rates & markets (ASX 200, AUD/USD, iron ore vs AUD from Commodities as a second card) · Policy (RBA summary + link) | none |

- **Regime** keeps the model: Regime now, What's driving it, Indicators, Global business cycle, Market signals. Its
  US ISM and Recession watch sub-tabs move to the US page; old links (`#tab=regime&sub=…`) are redirected.
- **Across Asia** keeps Japan and Australia lines in its comparison charts (it is a comparison view).
- Search, `TILE_SETS`, `What changed` links (`goSub`), the weekly brief and README follow the moves. Redirect old
  links for `asia` sub-tabs that moved to Japan or Australia.
- Each new page ≤ 2,300 px per sub-tab; `tools/design-check.js` must pass.

**Acceptance:** five region pages in the sidebar; no card appears twice by accident; every old bookmark lands on a
page; design check passes; no script errors.

### WP10. Korea: the AI memory cycle (AI → Chip cycle)

**Why:** Korean exports are dominated by memory chips (DRAM, HBM), so they are the timeliest hard data on AI hardware
demand; KOSPI is now heavily weighted to Samsung and SK hynix.

**Data**
- Korea semiconductor exports, monthly, USD: **Bank of Korea ECOS API** (exports by commodity, customs basis), which
  is timely but needs a free key in the URL. If the owner adds a GitHub secret `ECOS_API_KEY`, use it. Otherwise fall
  back to **UN Comtrade** public preview (`comtradeapi.un.org/public/v1/preview/C/M/HS`, reporter 410, HS 8542 and 854232
  memory, flow X, one period per call, keyless), checked 11 Nov 2026: data to Dec 2025, about a 9-month lag; label the
  lag on the card. Archive the series in `archive/` (Comtrade revises little; ECOS may revise, newest wins).
- Already loaded: Korea total exports YoY (OECD), KOSPI, SMH, SOX, tickers 005930.KS (Samsung) and 000660.KS (SK hynix).

**Cards** (Chip cycle sub-tab gets a second row, or a new "Korea & memory" sub-tab if it passes 2,300 px):
1. Korea chip exports YoY (or total exports YoY until chip data loads) vs KOSPI YoY, dual axis, with a lead toggle;
   note the measured lead (live `laggedCorr`).
2. Memory makers: SK hynix and Samsung (rebased, KRW) vs KOSPI and SOX.
3. Tile: Korea exports YoY (latest month); tile: SK hynix 3M.
- LL_PAIRS: Korea chip exports → KOSPI; Korea chip exports → SOX.

### WP11. Ramp AI Index on the AI page, shown with OpenRouter

**Data:** `ramp.com/data/ai-index` (reachable, checked 11 Nov 2026). The page carries the monthly series (Jul 2023
to Sep 2026): share of US businesses paying for AI (55.9% in Sep 2026), adoption by vendor (OpenAI, Anthropic, …), AI
spend per employee, token volume and spend, token spend share by vendor (Anthropic 60.5% in the week to 23 Oct) and
token prices. New scraper `pipeline/ramp.py`: parse the embedded chart data (look in the page's JSON/RSC payload
for the series; fall back to the HTML tables), isolate in try/except, archive every reading in `archive/ramp_*.csv`, show
"last read" like the sentiment gauges. Add `ramp.json` to the carry-over list in `update.yml`.

**Showing both together** (OpenRouter = developers and apps through one API; Ramp = what US companies pay for):
1. **Adoption: two lenses** (Adoption sub-tab, wide): Ramp share of businesses paying for AI (%) vs OpenRouter weekly
   tokens (log scale), dual axis, both from mid-2023.
2. **Who is winning, two ways** (Adoption, half): latest share by vendor, side-by-side bars: Ramp business adoption or
   token spend share vs OpenRouter token share by model maker (OpenAI, Anthropic, Google, others).
3. **Prices, two ways** (Prices & cost, half): Ramp token price index vs OpenRouter average price paid per million
   tokens, dual axis.
4. Tiles: Ramp adoption % (replaces the least useful AI tile on Adoption), Anthropic's Ramp token spend share.
- Note on each card: Ramp covers US firms on Ramp's card and bill pay (85,000+); OpenRouter covers apps routing through
  its API. Different samples, so compare direction, not levels.

### WP12. NVIDIA GPU rental prices (AI page)

**Why:** the rent on AI chips is the cleanest real-time read of AI compute demand against supply. If rents rise,
capacity is tight (good for Nvidia, memory, neoclouds); if they fall, supply is catching up.

**Data** (all checked 11 Nov 2026; hosts added to the environment):
- **GetDeploying weekly GPU price dataset**, `getdeploying.com/dataset/gpu-prices/weekly.csv`, **CC BY 4.0** (free with
  attribution). Columns: gpu_slug, date, billing_type (ON_DEMAND, SPOT, RESERVATION, RESERVATION_12_MONTH, …),
  reservation_months, min/max/median price, provider median, provider count, offering count; 82 providers. Use
  `nvidia-h100`, `nvidia-h200`, `nvidia-b200`, `nvidia-b300`, `nvidia-gb200`, `nvidia-a100`, `nvidia-l40s`. On-demand
  medians now: H100 $4.09/GPU-hr (a year ago $2.95), H200 $4.83 ($3.50), B200 $8.08 ($5.39), A100 $2.05 ($1.49). Archive
  each week in `archive/gpu_*.csv` (allowed under CC BY) so history grows. Credit "GetDeploying (CC BY 4.0)" on the card.
- **Vast.ai public pricing feed**, `storage.googleapis.com/vast-public-gpu-pricing/gpu-pricing-public.json`, hourly,
  daily marketplace medians for about 90 days per GPU. Licence: "free for display and citation with attribution; bulk
  collection, redistribution or use in an index requires a data licence". So **display the live 90-day window with
  attribution only; do not archive it**.
- **Silicon Data H100 index (SDH100RT)**, the benchmark behind the new CME compute futures: its page shows the last 30
  daily readings (H100 $3.06 on 10 Nov). Its terms for reuse are unclear, so **do not chart or store it**; give the
  latest reading as a linked reference line in the card note only if the terms allow, otherwise just a link.

**Placement:** AI → new sub-tab **Compute prices** (after Build-out), about 1,600 px:
1. Wide: **GPU rent per hour**, weekly on-demand median for H100, H200, B200 and A100 (5 lines max; B300/GB200 join
   when they have 3 months of data), with a toggle **On-demand · 12-month reserved · Spot**.
2. Half: **Rental table**: each GPU: $/hr on-demand, 1M, 3M and 1Y change, 12-month reserved price, number of providers.
3. Half: **Marketplace vs cloud list price**: Vast.ai daily median vs GetDeploying on-demand median for H100 and H200
   (90 days), so tightness in the spot market shows before list prices move.
4. Half: **Compute cost vs AI stocks**: H100 rent YoY vs Nvidia (NVDA) share price YoY, dual axis.
5. Half: **Compute cost vs token prices**: H100 rent vs OpenRouter average price paid per million tokens, dual axis
   (and the Ramp token price index once WP11 lands).
- Tiles (≤ 5): H100 $/hr (1Y change), B200 $/hr, H200 $/hr, Vast H100 marketplace median.
- LL_PAIRS: H100 rent → NVDA; H100 rent → Korea chip exports (WP10).
- health.py: weekly series; the scraper is isolated like the sentiment gauges and never raises the health alert.

---

## Planned, not built (owner's request, 11 Nov 2026): WP13 to WP16, Asia ex-Japan

**Status: WP13 to WP16 built on 11 Nov 2026.** Departures: Taiwan uses DGBAS only (CPI, industrial and electronics output, unemployment, exports and imports, GDP); export orders (MOEA), the NDC leading index and monitoring score, CBC rates and TSMC revenue were blocked or timed out, so they are not shown. Korea and India current account left out (OECD's provisional 2026 Korea figures looked wrong). India's leading index fails the lead rule (0.37) and says so on its card. Taiwan tests: Taiwan Weighted leads Taiwan exports by 4 months (0.77) and electronics output by 2 (0.68); Korea's leading index leads Taiwan exports by 9 months (0.54); Brent leads Taiwan CPI by 2 months (0.49). Calendar entries for Taiwan and India were not added. Follow `CLAUDE.md` (sub-tabs,
≤ 2,300 px, ≤ 5 tiles, ≤ 16 rows at rest, ≤ 5 coloured lines) and run `node tools/design-check.js` before each push.
One commit per package.

**The request:** (1) Asia ex-Japan should cover Korea, Taiwan and India, not only Singapore and China.
(2) Check whether the region's data points lead the local equity market or yields.

### What the data says about leads (tested 11 Nov 2026)

Tested on the dashboard's own monthly data, mostly 2006 to 2026: correlation of the indicator with the target 0 to 12
months later, the reverse direction, and each half of the sample separately. Equities are year-on-year %, yields are
12-month changes. "Halves" = the correlation in the first and second half of the sample; a real lead holds in both.

**Confirmed leads (build these as "leading" cards):**

| Indicator | Target | Lead | Corr. | Halves | Comment |
|---|---|---|---|---|---|
| Korea OECD leading index, 6-month change | Taiwan Weighted (TWSE) | 5 months | 0.72 | 0.74 / 0.76 | Strongest and most stable |
| Korea OECD leading index, 6-month change | KOSPI | 4 months | 0.53 | 0.54 / 0.61 | Same-month correlation is only 0.35 |
| Indonesia OECD leading index, 6-month change | Jakarta Composite (JCI) | 4 months | 0.59 | 0.78 / 0.56 | |
| India OECD leading index, 6-month change | Nifty 50 | 5 months | 0.38 | 0.75 / 0.47 | Modest; say so on the card |
| China OECD leading index, 6-month change | Copper | 7 months | 0.51 | 0.62 / 0.45 | |
| Malaysia leading index diffusion (DOSM) | KLCI | 4 months | 0.55 | 0.66 / 0.38 | Weaker since 2016 |
| Brent, % YoY | India 10Y yield | 2 months | 0.60 | 0.56 / 0.67 | The one clear lead for yields |
| Brent, % YoY | Korea CPI | 7 months | 0.51 | 0.54 / 0.47 | Inflation, so indirectly policy |
| Brent, % YoY | Singapore core inflation | 8 months | 0.56 | 0.69 / 0.48 | |
| US dollar (DXY), % YoY | Korea exports | 4 months | −0.53 | −0.61 / −0.47 | Strong dollar, weaker exports later |
| Korea 3M rate, 12-month change | KOSPI | 8 months | −0.35 | −0.34 / −0.48 | Modest: rate rises precede weaker equities |
| Korea exports | Malaysia and Indonesia exports | 1 month | 0.79 / 0.70 | stable | Already on the dashboard |

**The market leads the data (show as a caution, not as a signal):** KOSPI leads Korea's exports by 4 months (0.83),
Taiwan Weighted by 2 months (0.76), STI leads Singapore NODX by 3 months (0.61), KLCI leads Malaysia's exports by
4 months (0.41), Hang Seng leads China's exports by 3 months (0.46). Exports confirm a move in equities; they do not
predict it.

**Moves together, no lead:** local 10Y yields follow US Treasuries in the same month (Korea 0.65, India 0.67,
Singapore 0.83). The US dollar and copper move with Asian equities in the same month (DXY vs Hang Seng −0.57,
copper vs AAXJ 0.83). SOX and Taiwan Weighted 0.86, same month.

**Tested and not confirmed (do not present as leading):** money supply M1 and M3 (Korea, India, China, Indonesia),
consumer confidence, the Korea and India yield curves against equities, CPI against local 10Y yields, China's PMI-based
confidence against the CSI 300, China's leading index against Hang Seng since 2016 (0.22). US 2Y leads Korea's 3M rate
by 3 months (0.62) but only in the second half (0.33 / 0.88): show as a note, not a claim.

**Caveats to print in "How to read":** the OECD leading indices are revised after the fact, smoothed, and partly built
from share prices, so the real-time lead is shorter than the table shows. They are published about 6 weeks after the
month, so a 4-month statistical lead is roughly 2 to 3 usable months. Year-on-year series overstate correlations.

**Acceptance rule for any new "leads" claim** (Taiwan's indicators cannot be tested until WP14 loads them): lead of
at least 2 months, correlation at least 0.40 in size and at least 0.05 above the same-month figure, same sign in both
halves and at least 0.25 in each. Compute it live in the browser (as the existing lead cards do), never hard-code it.
If a pair fails, show the chart without the word "leads".

### WP13. Korea and India sub-tabs (no new data source)

Asia ex-Japan sub-tabs become: **Malaysia:** Markets & rates · Economy | **Region:** Singapore · China · **Korea ·
Taiwan · India** | **Compare:** Across Asia · Asian FX · **What leads**.

**Data** (`pipeline/cnjp.py`, OECD key indicators, same call as today; all checked present to Sep/Oct 2026):
- Korea: `KR_IMP_YOY` (IM, GY), `KR_CCI` (CCICP), `KR_RETAIL_YOY` (TOVM G47, GY), `KR_CALL` (IRSTCI, overnight call
  rate, tracks the Bank of Korea base rate), `KR_GDP_YOY` (B1GQ_Q, GY, **quarterly**), `KR_CA_GDP` (quarterly).
- India: `IN_IMP_YOY`, `IN_CALL` (IRSTCI, tracks the RBI repo rate), `IN_MFG_YOY` (PRVM activity C, GY),
  `IN_GDP_YOY` and `IN_CA_GDP` (quarterly).
- The current call is monthly only (`.M.`): add one quarterly call (`.Q.`) for GDP and current account.
- Money supply is deliberately left out (no lead found; OECD's India and China money series stop in 2018).

**Korea sub-tab** (6 half cards; tiles: KOSPI, USD/KRW, Korea 10Y, CPI YoY, Exports YoY):
1. `kr_mkt` KOSPI vs Asia ex-Japan: KOSPI in won, KOSPI in USD (`inCcy`), AAXJ; all = 100 at the range start.
2. `kr_lead` Leading index vs KOSPI: CLI 6-month change vs KOSPI YoY, dual axis, toggle "As measured / Lead +4m"
   (`leadPair`). Note states the live correlation, the halves and the publication lag.
3. `kr_trade` Exports, imports and chips: `KR_EXP_YOY`, `KR_IMP_YOY`, `KR_CHIP_EXP` YoY (Comtrade, lag labelled).
   Note: KOSPI has led exports by about 4 months; DXY has led exports by about 4 months (inverse).
4. `kr_infl` Inflation and policy: CPI YoY vs call rate, dual axis; note on Brent leading CPI by about 7 months.
5. `kr_rates` Korean yields vs US: `KR_10Y`, `KR_3M`, `UST10Y`; note: moves with Treasuries in the same month.
6. `kr_act` Activity: IP YoY, retail YoY, GDP YoY (quarterly, stepped), business and consumer confidence in the "⋯".
Link line to AI → Chip cycle for memory makers (do not duplicate those cards).

**India sub-tab** (6 half cards; tiles: Nifty 50, USD/INR, India 10Y, CPI YoY, GDP YoY):
1. `in_mkt` Nifty vs Asia ex-Japan (rupee, USD, AAXJ).
2. `in_oil` Oil vs Indian yields: Brent YoY vs India 10Y 12-month change, toggle "Lead +2m". The yields lead card.
3. `in_infl` Inflation and policy: CPI YoY with the RBI's 2 to 6% band shaded (4% line), call rate on the right axis.
4. `in_rates` Indian yields vs US: `IN_10Y`, `IN_3M`, `UST10Y`.
5. `in_act` Activity: IP, manufacturing, GDP YoY; exports and imports YoY.
6. `in_lead` Leading index vs Nifty: CLI 6-month change vs Nifty YoY, toggle "Lead +5m", labelled a modest lead.
   Current account (% of GDP) vs USD/INR goes in this card's "⋯" or replaces card 5's trade lines if space is tight.

### WP14. Taiwan sub-tab (new sources: check first)

Today the dashboard has only Taiwan Weighted, USD/TWD and TSM. Taiwan is not in the OECD, UN Comtrade (checked: no
reporter data) or DBnomics. The official Taiwan sites could not be reached from the planning session (the session's
network allow-list blocks them), so **the endpoints below are unverified**. Step 1 of the build is a probe.

**Step 1, probe** (ask the owner to approve the hosts; test each from the session and confirm it works from a GitHub
runner, since some government sites block cloud addresses):

| Data | Likely source | Host to allow |
|---|---|---|
| Export orders (total, electronics), industrial production | Ministry of Economic Affairs statistics | `dmz26.moea.gov.tw` |
| Exports, imports | Ministry of Finance trade statistics | `web02.mof.gov.tw` |
| CPI, core CPI, unemployment, GDP | DGBAS national statistics database | `nstatdb.dgbas.gov.tw` |
| Leading index, coincident index, monitoring score ("business cycle light", 9 to 45) | National Development Council | `index.ndc.gov.tw` |
| Discount rate, M1B, M2, 10Y government bond yield | Central Bank (CBC) statistics API | `cpx.cbc.gov.tw` |
| TSMC monthly revenue (published about the 10th) | TSMC investor relations | `investor.tsmc.com` |
| Mirror for most of the above | Taiwan open data portal | `data.gov.tw` |

New module `pipeline/taiwan.py` → `docs/data/taiwan.json`, isolated like `ramp.py` (a failure keeps the previous file
and does not raise the health alert until the feed has proved stable). Add the file to the carry-over list in
`update.yml` and to the loader. Archive TSMC revenue (`merge_archive`) if the page only shows recent months.

**Fallback if the official sites cannot be used:** build a markets-only Taiwan sub-tab (cards 1 and 2 below, plus Korea
chip exports as the trade proxy) and say on the page that Taiwan's official statistics have no usable public feed.

**Taiwan sub-tab** (6 half cards; tiles: Taiwan Weighted, USD/TWD, Export orders YoY, CPI YoY, TSMC revenue YoY):
1. `tw_mkt` Taiwan Weighted vs SOX and TSMC (rebased); note: moves with the SOX in the same month (0.86).
2. `tw_lead` Korea's leading index vs Taiwan Weighted: 6-month change, toggle "Lead +5m" (0.72, the best lead found).
3. `tw_orders` Export orders vs exports, YoY, toggle "Lead"; electronics orders in the "⋯". Test orders → exports,
   → Taiwan Weighted and → SOX against the acceptance rule.
4. `tw_tsmc` TSMC monthly revenue YoY vs SOX YoY: the timeliest hard number on AI hardware demand. Test it.
5. `tw_cycle` Business cycle signal: NDC monitoring score with its five colour bands, leading index on the right axis.
6. `tw_infl` Inflation and policy: CPI, core CPI, CBC discount rate. M1B minus M2 growth vs Taiwan Weighted (the gap
   local investors watch) goes in only if it passes the acceptance rule.
Also add Taiwan to the Across Asia charts (inflation, exports, 10Y, policy rates) and to the calendar (`econcal.py`):
export orders (about the 20th), TSMC revenue (about the 10th), plus India CPI (about the 12th).

### WP15. "What leads" sub-tab (Asia ex-Japan → Compare)

One place that answers "what is pointing where, and how far ahead". Tiles (≤ 5): leading indices rising (n of 5),
Korea leading index 6-month change, Brent YoY, DXY YoY, KOSPI YoY.
1. Wide `asia_now` **Leading index momentum now**: horizontal bars, 6-month change of the leading index for Korea,
   India, Indonesia, China and Malaysia (DOSM), each labelled with the market it has led and by how many months.
2. Half `asia_ll` **What has led what**: table (≤ 16 rows, `capRows`): indicator → target, lead (months), correlation,
   stable in both halves (yes / no), usable lead after publication lag, and the indicator's current direction.
   Verdict chip per row: "Leads" / "Moves together" / "Market leads the data". Computed live; click a row to chart it.
3. Half `asia_llchart` the selected pair as a dual-axis chart with the lead applied (default: Korea leading index →
   Taiwan Weighted).
4. Half `asia_mktlead` **Where the market leads the data**: KOSPI → Korea exports, Taiwan Weighted → Korea exports,
   STI → NODX, KLCI → Malaysia exports, Hang Seng → China exports, with months and correlation.
5. Half `asia_oil` **Oil into Asian inflation and yields**: Brent YoY led forward against India 10Y, Korea CPI,
   Singapore core, Malaysia CPI (choice in a `seg`).

**Code notes:**
- `llSeries` needs a new mode `chg6` (6-month change); `leadPair` and `llScan` take it unchanged.
- Add a half-sample stability check next to `llScan` (split the overlapping months in two) and a publication-lag
  table per indicator (OECD leading index 2 months, exports 1, CPI 1, Brent 0) for the "usable lead" column.
- Add the confirmed pairs to `LL_PAIRS` so the Lead-lag page picks them up.
- `TILE_SETS.asia` gets entries for Korea, Taiwan, India and What leads. Search picks up the new cards by title.

### WP16. Housekeeping

README (Asia ex-Japan row, sources), `tools/design-check.js` allow-list only if a deliberate exception is needed,
PLAN.md status line. Check the live run: new OECD series loaded, Taiwan feed status in Data health.

### WP17. Ramp token volume, spend and prices in more detail (owner's request, later; not now)

**Status: built on 11 Nov 2026 (AI → Token market).** Ramp's page publishes token data only by model maker (spend share, volume share) and blended prices for OpenAI, Anthropic and the two together: no model-level rows and no input/output split, so the by-model view uses OpenRouter (labelled) and a spend ÷ volume ratio stands in for relative price by maker. OpenRouter's archive now stores list-price blends (all top 20 models; OpenAI & Anthropic; each separately) and the usage-weighted output price. Business vs developers was renamed Business adoption. Original brief: The AI → Business vs developers sub-tab now shows Ramp's token spend share
and blended price only as small parts of two cards. The owner wants:
1. **Token volume and spend by model maker** (OpenAI, Anthropic, Google, xAI, DeepSeek, Cursor and others): share of
   token volume and share of token spend side by side, latest week and the trend as the weekly archive grows
   (`RAMP_TOK_VOL_*`, `RAMP_TOK_SPEND_*` are already archived from 11 Nov 2026).
2. **By model** where Ramp publishes it: first inspect the page payload (`_props` in `pipeline/ramp.py` keeps only the
   chart object; search the full `self.__next_f` payload and the Tokenomics section for model-level rows such as
   "Claude Sonnet" or "GPT-5"). If model-level data exists, scrape it into `RAMP_TOKM_*` and archive it; if not, say so
   on the card and fall back to OpenRouter's model ranking for the model view.
3. **Token prices, blended input and output**: Ramp's blended price per million tokens (overall, OpenAI, Anthropic),
   with input and output shown separately if the page has them; next to OpenRouter's usage-weighted input price and,
   if added to `pipeline/ai.py`, its output price, so the two are compared like for like.
Layout: its own AI sub-tab ("Token market"), wide chart plus three half cards, ≤ 5 tiles; move `ai_vendor` and
`ai_tokprice` there so the topic is in one place.

### WP18 to WP21. Follow-ups (owner approved 11 Nov 2026; build after WP17, one commit each)

**WP18. Data health for the new feeds.** *Built 11 Nov 2026: 54 series added; Comtrade allowed 420 days, Ramp token table 45 days, the rest by their detected frequency.* Add `korea.json`, `ramp.json`, `gpu.json` and `taiwan.json` to `FILES` in
`pipeline/health.py`. Allowances: Korea chip exports (UN Comtrade, about 10 months late) about 400 days; Ramp monthly
adoption and spend series about 75 days, weekly token series about 21 days; GPU weekly series about 21 days; Vast.ai
daily about 7 days; Taiwan monthly series the usual monthly rule, GDP quarterly. Skip keys starting with "_".
Check that nothing new shows as stale today (the alert issue must stay closed).

**WP19. Calendar: Taiwan, India and MAS 2027.** *Built 11 Nov 2026: Taiwan (exports, CPI, export orders without a number, advance GDP) and India (CPI, industrial production, GDP) windows; RBI decisions 4 Dec 2026 and 5 Feb 2027 (MPC schedule from 23 Mar 2026, as reported by Indian press: rbi.org.in is unreachable here); Taiwan CBC 17 Dec 2026 (provisional). MAS has published only 29 Jan 2027 so far (already on file); April to October 2027 are not out yet, so the Singapore coverage warning will show from mid-November until MAS adds them. Strategist View → Coming up now shows 9 events (height budget).* In `pipeline/econcal.py`, add Taiwan (exports, about the 7th to 9th
for the previous month; CPI, about the 5th to 8th; advance GDP, end of the month after the quarter) and India (CPI,
the 12th; GDP, end of the second month after the quarter; RBI policy decisions, 2026/27 schedule from the RBI site)
using the existing helpers and their "estimated date" labelling where dates are rule-based. Add MAS's 2027 monetary
policy statement dates from the MAS website (Singapore coverage runs out on 29 Jan 2027) and update `COVERAGE` and
`VERIFIED_ON`. Use official pages only; if a page cannot be reached, leave that schedule out and say so.

**WP20. Retry the blocked Taiwan sources from GitHub's runner.** *Built 11 Nov 2026. Export orders (total, US, China & HK) and money supply (M1B, M2) turned out to be in the DGBAS database (tables A050105010, A090501010), so they come from there. Runner probes: the NDC leading index and monitoring score return 403 from GitHub too; TSMC's revenue page sits behind a Cloudflare challenge; the MOEA site does not connect. The CBC data API (cpx.cbc.gov.tw/API/DataAPI/Get?FileName=...) does answer from GitHub, but its policy-rate table was not among the files probed (EF01-EF29, EG01-EG30, BP01-BP30 list money, balance sheets and bank rates; "29. Interest Rates - A" was not found): a later build can look for it. Lead tests: orders move with exports in the same month (0.90), Taiwan Weighted leads orders by 2 months (0.79), orders lead Malaysia exports by 2 months (0.76), and the M1B - M2 gap (6-month change) leads Taiwan Weighted by 5 months (0.50, both halves). The probe workflow was removed.* Export orders (MOEA), the NDC leading index and
monitoring score, central bank (CBC) rates and TSMC monthly revenue were blocked or timed out from the build
environment. Add a one-off probe step (a small script run once in the workflow, output to the log, removed
afterwards) or isolated fetchers in `pipeline/taiwan.py` that fail quietly. Keep whatever works: export orders vs
exports and vs Taiwan Weighted (test with the lead rule), TSMC revenue YoY vs SOX, the monitoring score with its
colour bands, CBC discount rate. Drop the rest and say so in PLAN.md.

**WP21. Korea and India current account.** *Built 11 Nov 2026. IMF data on DBnomics stops at Q1 2025, so Korea's 2026 figures were cross-checked against its goods trade instead (OECD exports and imports in USD): the goods surplus went from US$27bn in Q4 2025 to US$58bn in Q1 2026 and US$83bn in Q2, about 19% of quarterly GDP, consistent with the reported 16.0% and 20.9% current account. India's figures (around -0.3% to -1% of GDP) are steady and plausible. Both added as a "Current account" toggle on the Korea and India activity cards.* Re-fetch OECD `CA_GDP` (quarterly). Korea's provisional 2026 values were
16 to 21% of GDP against about 6 to 8% in 2025. Cross-check against another public source (IMF via DBnomics, or the
OECD's balance of payments dataset). Add the series to the Korea and India activity cards (toggle or "⋯") only if
the figures agree; otherwise leave them out and note why.

### Suggested order

WP13 → WP15 → WP14 → WP16. WP13 and WP15 need no new source and no approvals, so Korea, India and the lead
indicators can go live first; Taiwan follows once its sources are proven.

---

## Planned, not built (owner's request, 11 Nov 2026): WP22 to WP29, signals and strategist tools

**Status: WP23, WP22 and WP24 built on 11 Nov 2026; engine extended the same day** (central bank pricing, stress and Malaysia rules: 63 rules in all; most new ones grade "context only" or "thin evidence"; the stress composite and Malaysian interbank rates have too little history to test; a "Signals to watch" block in the Weekly brief, whose Headlines section is now screen-only so the brief prints on one page). Earlier: **WP23 and WP22 built on 11 Nov 2026** (owner chose the engine first and the wording "ideas to investigate";
WP24 to WP29 wait for a later "Go").

**Correction to the prototype table below:** the planning prototype counted events wrongly (a pandas type slip made it
count months that were not new switch-ons), so its event counts and edges were overstated. The engine counts
correctly and also applies publication delays. Corrected readings on 11 Nov 2026: Korea leading index turning up has
9 events (not 26); its record for Taiwan Weighted and KOSPI over 6 months is still strong (all 9 positive) but rates
"Thin evidence". **Taiwan M1B − M2 turning down is "Context only"** (11 events, up 55% of the time against 67% normally,
and the edge flips between the two halves), so it is not shown as an idea. Tested edges in the engine: Indonesia's
leading index turning up (Jakarta Composite, 3 months), Taiwan M1B − M2 turning up, the Goldilocks regime (S&P 500),
VIX below 13 (caution), copper ÷ gold falling (lower US 10Y), and trend persistence in the Asia ÷ world, EM ÷ S&P 500
and SOX ÷ S&P 500 ratios.

**Departures:** divergences are computed once, in the engine, and shown on Signals → Divergences (not also under
Correlation); the plan's "about 40 signals" is 44 rules across leads, regime, extremes, trend and the AI theme
(policy pricing and the stress composite are not encoded yet); the top-ideas strip on Strategist View → Today was left
out because that page is at its height limit (Signals sits right under it in the menu).

**The request:** (1) what else a strategist's dashboard should have; (2) have the dashboard turn its signals into
investment ideas for the owner to note and dig into, to get ahead of the market.

**What the dashboard already has (do not rebuild):** regime and "what worked in each regime", leading indicators,
stress composite and peak signposts, liquidity (Fed, global central bank balance sheets, NFCI), central bank pricing,
region pages, performance with distance from the 200-day average, breadth, styles and sectors, commodities, curves,
spreads, valuation scorecard (CAPE, ERP, term premium, REER), volatility, CFTC positioning, sentiment, correlation and
lead-lag, the AI pages, the idea log, a "what changed" list, the weekly brief and the calendar.

### What a prototype showed (11 Nov 2026): most famous signals have no edge; a few do

An event study was run on the dashboard's own history: each time a condition switched on (at least 6 months after the
previous time), what did the target do over the next 1, 3, 6 and 12 months, against what it did in all months
(the baseline)?

| Signal → target | Times | After the signal | Baseline (all months) | Verdict | On now? |
|---|---|---|---|---|---|
| Taiwan M1B − M2 gap turns down → Taiwan Weighted, next 3m | 26 | median −1.2%, up 38% of the time | +2.9%, up 67% | Edge (caution signal) | Yes, since Jul 2026 |
| Korea leading index turns up → KOSPI, next 6m | 26 | +4.5%, up 73% | +2.7%, up 60% | Edge, moderate | Yes, since May 2026 |
| Korea leading index turns up → Taiwan Weighted, next 12m | 25 | +12.7%, up 80% | +10.4%, up 72% | Small edge | Yes |
| Dollar up more than 8% on a year → Asia ex-Japan (AAXJ), next 3m | 9 | −3.7%, up 22% | +2.2%, up 58% | Edge, thin sample | No |
| Brent up more than 40% on a year → India 10Y, next 3m | 6 | +0.3 pts, up 83% | 0.0 pts, up 45% | Edge, thin sample | Yes, since Sep 2026 |
| VIX curve inverts → S&P 500, next 3m | 15 | +3.6%, up 60% | +3.2%, up 72% | No edge | No |
| S&P 500 falls below its 10-month average → S&P 500, next 6m | 16 | +10.3%, up 75% | +5.5%, up 76% | No sell signal | No |
| 2s10s curve un-inverts → S&P 500, next 12m | 20 | +10.9%, up 75% | +12.8%, up 81% | No edge | Yes |
| Malaysia leading diffusion above 50 → KLCI, next 6m | 37 | +2.7%, up 62% | +1.8%, up 59% | No real edge | Yes |

Lessons for the build: (a) every idea must show its edge against the baseline, or it is noise; (b) samples are small,
so the page must say "thin evidence" where it is; (c) credit spreads (ICE series, 3 years of history) and the
sentiment gauges have too little history to test: use long-history stand-ins (Baa − 10Y) or label "not enough
history"; (d) markets lead most macro data (WP13 to WP15), so the useful ideas come from tested leads, from one market
moving while a linked one has not, from extremes in positioning and valuation, and from dated catalysts.

Divergences today (3-month moves against the usual relationship, in standard deviations): KLCI has lagged the S&P 500
(−1.6), KOSPI has fallen more than the SOX implies (−1.5), Asia ex-Japan more than copper implies (−1.5). None is
past the ±2 trigger.

### WP22. Signal engine and "Signals" page (the idea generator)

**Principle:** rules, not opinions. Each signal is a fixed, published rule, tested on history, shown with its record.
The page offers research prompts, never recommendations. The site is public: generated signals are visible to anyone
with the link (they are built from public data); what the owner does with them (watch, dismiss, add to the idea log)
stays in the browser only.

**Pipeline** (new `pipeline/signals.py`, run last; reads the published JSON files; writes `docs/data/signals.json`;
appends each new firing to `archive/signals_log.csv`; add to the carry-over list in `update.yml` and to `health.py`):
- `SIGNALS`: a declarative list. Each entry: id, family, plain-language name, the condition (a small function of named
  series), target asset(s), whether the target is a return or a change (yields), horizons (1, 3, 6, 12 months), the
  minimum gap between events, and the publication lag of each input.
- **No look-ahead:** monthly macro inputs are shifted by their publication lag before the condition is tested
  (OECD leading index 2 months, exports and CPI 1 month, DOSM leading index 3 months, market prices 0). Signals built
  on revised series (OECD leading indices) carry a "revised data" tag.
- `study()`: events = the condition switching on after the gap; forward return of the target from the date the data
  was known; per horizon: n, median, 25th to 75th percentile, hit rate; the same for the baseline over the same
  period; edge = signal median − baseline median; and the edge in each half of the history.
- **Tier rule** (best horizon): *Tested edge* = n ≥ 12, hit rate at least 12 points from the baseline's, same sign of
  edge in both halves. *Thin evidence* = n 6 to 11 and hit rate at least 20 points from the baseline's. *Context
  only* = everything else: shown, but labelled "has not helped historically". *Not enough history* = n < 6.
- **Active now:** the condition is on and switched on within its best horizon. Output: since when, how much of the
  usual window is left, and "priced in?": the target's move since the signal against the typical move.
- **Ideas** = active signals grouped by target and direction: "3 for, 1 against", score = tier-weighted sum (tested 3,
  thin 1, context 0). Each idea carries: headline, what fired (with the numbers), the evidence table, what would
  cancel it (the condition switching off; the target breaking its 200-day average the wrong way), the next calendar
  events for that market within 14 days (from `calendar.json`), and links to the charts.
- Keep the engine under 60 seconds; cache nothing in the browser.

**Signal families to encode first** (about 40 signals; ids are existing dashboard series):
1. *Tested leads* (from `LL_PAIRS` and the Asia tables, using the same acceptance rule): Korea leading index → Taiwan
   Weighted, KOSPI, Taiwan exports; Indonesia leading index → JCI; Taiwan M1B − M2 → Taiwan Weighted; Taiwan export
   orders → Malaysia exports and the Malaysia tech basket; Brent → India 10Y, Korea, Taiwan, Singapore, Malaysia CPI;
   dollar → Korea exports and AAXJ; China leading index → copper; US leading index and ISM → S&P 500 sectors; Fed net
   liquidity and global central bank assets → S&P 500, gold, Bitcoin; Korea chip exports → SOX.
2. *Regime:* the growth/inflation regime switching → the assets "What worked in each regime" favours, flagged when
   the asset has not yet moved in line.
3. *Extremes:* valuation scorecard percentiles (above 90th, below 10th); Baa − 10Y and HY spreads; CFTC positioning
   beyond ±2 standard deviations (contrarian); AAII, NAAIM, Fear & Greed extremes; breadth below 20% or above 80%;
   REER percentiles for FX.
4. *Trend and relative strength* (from WP23): new 12-month highs and lows; 50/200-day crosses; ratios turning
   (KLCI ÷ AAXJ, AAXJ ÷ ACWI, EM ÷ S&P 500, growth ÷ value, small ÷ large, SOX ÷ S&P 500, copper ÷ gold, HY ÷
   Treasuries).
5. *Divergences* (from WP23): a linked pair more than 2 standard deviations apart; the study asks which side closed
   the gap in the past.
6. *Policy:* market pricing against the central bank (Fed path against the dots; the BNM, RBA, BoJ, ECB gauges) and
   decisions due within 14 days.
7. *Stress:* stress composite changing band; peak signposts count rising; recession probability crossing 30%.
8. *AI theme:* GPU rents rising while token prices fall (margin squeeze); Ramp adoption accelerating; Korea chip
   exports and Taiwan electronics output turning.

**Front end:** new page **Signals** in the Overview group, sub-tabs:
- **Ideas to investigate**: at most 8 cards, ranked by score. Each: headline in plain words ("Taiwan equities:
  caution for the next 3 months"), tier chip, "for / against" count, the evidence line ("26 times since 2001: median
  −1.2% over 3 months, up 38% of the time; normal is +2.9%, up 67%"), priced-in bar, cancel conditions, next catalyst,
  and buttons **Add to idea log** (pre-fills instrument, direction, entry, horizon and rationale), **Watch**,
  **Dismiss** (browser only).
- **All signals**: table (view chips by family; ≤ 16 rows at rest): state now, since, tier, best horizon, edge.
- **Divergences**: the pairs, the gap in standard deviations, which side moved, how past gaps closed.
- **Track record**: every firing since the engine went live, with the return since; live hit rate next to the
  back-test, by signal and family. Starts empty and says so.
- **How it works**: the rules, the tier definitions and the limits (small samples, revised data, public information,
  not advice).
Also: the top 3 ideas as a strip on Strategist View → Today (inside the height budget: fold them into "What changed"
if needed) and a "Signals to watch" block in the Weekly brief if it still prints on one page. Tiles: active ideas,
tested-edge signals on, divergences beyond ±2, signals that switched this week.

**Acceptance:** each number on a card can be reproduced from the published data; no signal uses data before it was
published; the nine rows of the prototype table above are reproduced to within rounding (allowing for the lag shift).

### WP23. Trend, relative strength and divergence monitor (build before WP22: it feeds it)

- Markets → new sub-tab **Trend**: table of the main assets (view chips by asset class; `capRows`): 12-1 month
  momentum, distance from the 200-day average, date of the last 50/200-day cross, distance from the 52-week high,
  current drawdown. Tiles: share of assets in an uptrend, new 12-month highs and lows this week.
- Same sub-tab: **relative-strength pairs** (the ratios listed in WP22 family 4): ratio against its 200-day average,
  date it last turned, 3-month change.
- Correlation → new sub-tab **Divergences**: pairs that normally move together (S&P 500 and KLCI, SOX and Taiwan
  Weighted, SOX and KOSPI, copper and AAXJ, dollar and USD/MYR, UST 10Y and Korea, India, Singapore 10Y, real yields
  and gold, HY spread and S&P 500, Brent and USD/INR). Method: 3-month changes, 60-month rolling beta, gap = actual −
  implied, in standard deviations; flag beyond ±2; chart of the gap for the selected pair.

### WP24. Country scorecard

Regions group → new page **Country scorecard** (one screen): rows US, euro area, Japan, China, Korea, Taiwan, India,
Indonesia, Malaysia, Singapore, Australia. Columns, each an arrow with a tooltip number: growth momentum (leading
index 6-month change, else industrial production or exports), inflation momentum (CPI against 3 months ago and against
target), policy (real short rate; direction over 6 months), equity trend (200-day, 12-1 momentum, 3 months against
ACWI), currency (3 months against USD; REER percentile), 10Y yield (3-month change). Last column: a plain one-line
read ("growth up, inflation easing, equities lagging"). Click a row to open that region's page.

### WP25. Malaysia sectors (clients are mostly in Malaysia)

*Built 12 Nov 2026: ten baskets (REITs added to the ticker list: Sunway REIT, IGB REIT, Axis REIT, KLCC Property); healthcare & gloves and consumer kept as defined; three sector tiles on the Malaysia tiles row.*

Asia ex-Japan → Malaysia group → new sub-tab **Sectors**: equal-weight baskets from the Bursa ticker list (banks,
plantations, technology, utilities, telecoms, REITs, oil and gas, construction, gloves and healthcare, consumer;
add tickers to `pipeline/tickers.py` where a basket has fewer than 3 names): performance table (1M, 3M, YTD, against
KLCI), relative-strength chart, each basket against its driver (plantations and palm oil, technology and SOX, oil and
gas and Brent, banks and the OPR / 3M interbank gap). Ticker history is about 3 years: say so.

### WP26. House views and model portfolios (private, browser only)

*Built 12 Nov 2026 as two new Idea log views. Export now writes version 2 (ideas, views, model); Import still reads old files. The Weekly brief shows the views as one line; its signals explanation is screen-only so the brief still prints on one page.*

Idea log → new views **House views** and **Model portfolio**. House views: a grid of asset classes and regions with
a stance (overweight, neutral, underweight), date and one-line reason; relative performance since each change against
a benchmark; a log of changes; shown in the Weekly brief. Model portfolio: weights the owner sets (presets: 60/40
global, Malaysian balanced); return, drawdown and volatility in MYR, SGD or USD. Stored like the idea log
(localStorage, export and import), never published.

### WP27. FX carry and value

*Built 12 Nov 2026: Indonesia's overnight call rate (OECD IRSTCI) added as ID_CALL; MYR uses the OPR (the 3-month interbank rate has only three years of history), EUR the ECB deposit rate; Taiwan blank.*

Asia ex-Japan → Asian FX gains a table for MYR, SGD, KRW, INR, IDR, CNY, JPY, AUD, EUR, TWD: 3-month rate gap against
the US (carry), 3-month realised volatility, carry ÷ volatility, REER percentile (value), 3- and 12-month spot move,
200-day trend. Add Indonesia's short rate from the OECD feed. Taiwan has no short rate on file: leave the cell blank.

### WP28. Seasonality and sensitivities

*Built 12 Nov 2026 as planned (one factor at a time; Asian markets' same-week betas to US moves are understated by the time-zone gap, noted on the card).*

- Markets → new sub-tab **Seasonality**: for a chosen asset, average return and hit rate by calendar month (20 years),
  this year's path against the average year; a table of this month's and next month's record across assets.
- Correlation → new sub-tab **Sensitivities**: 2-year weekly betas of each asset to the S&P 500, UST 10Y (per 10bp),
  the dollar and Brent, as a table ("S&P 500 −10% has gone with KLCI −x%"), with a stability flag.

### WP29. Uncertainty, oil curve and flows (probe first; build what loads)

*Built 12 Nov 2026: US daily, global and US trade policy uncertainty from FRED (USEPUINDXD, GEPUCURRENT, EPUTRADE); geopolitical risk index from matteoiacoviello.com (reachable from GitHub's runner only; its column names are read at run time); Brent and WTI front vs 12-month contracts from Yahoo contract symbols (pipeline/oilcurve.py, archived so a rolling record builds). Skipped: ICI fund flows (ici.org returns Access Denied to GitHub's runner too).*

- Stress → new sub-tab **Uncertainty**: FRED economic policy uncertainty (US daily `USEPUINDXD`, global
  `GEPUCURRENT`), trade policy uncertainty and the geopolitical risk index if their sources are reachable.
- Markets → Commodities: Brent and WTI front month against the 12-month contract (backwardation = tight market), from
  Yahoo contract symbols if they resolve.
- Fund flows (ICI weekly mutual fund and ETF flows): probe from the runner; skip if there is no stable file.

### WP30. Share prices inside leading indices; stock-free alternatives (owner's request)

*Built 12 Nov 2026.* (a) Signals built on an OECD leading index (or the dashboard's own US leading index, which includes
the S&P 500) are kept but graded down one tier ("tier_before" keeps the original) and marked ⓢ; the Asia lead tables
show "Leads ⓢ" and the cards explain why. (b) Stock-free alternatives tested (engine family "Clean leads", and the Asia
tables): **US business confidence (OECD, ISM-based), 6-month change, leads Taiwan Weighted by 3 months (0.62 against
0.52 in the same month, stable in both halves) and KOSPI by 3 months (0.46 against 0.40)**; in the engine, its turning
down is a tested-edge caution signal for both (not on now). Korea and US business confidence turning up, Korea exports,
Taiwan export orders and Korea consumer confidence are context only (the market leads exports and orders); Korea chip
exports have only 2 events in real time (Comtrade is about 10 months late). The OECD does not publish the leading
indices' components in its CLI dataflow, so a "Korea leading index without KOSPI" could not be built. The Korea and Taiwan
lead cards now name the best stock-free alternative.

### WP31. Out-of-sample check, stock-free Korea index, email alerts (owner's request, 12 Nov 2026)

*Built 12 Nov 2026.* (1) Walk-forward check in pipeline/signals.py: best horizon chosen on the first 60% of each rule's
history, tested on the last 40%; rules that fail are graded down one tier ("failed out-of-sample"). On 12 Nov no graded
rule failed; several had too few later events to judge. (2) KR_LI_XSP: Korea's OECD leading index rebuilt from its five
non-stock components (average of the normalised series). By correlation, with the 2-month publication delay counted, it
gives about 1 usable month over KOSPI and none over Taiwan Weighted; as an event signal, its turning up has a tested
edge for both (Taiwan Weighted up 92% of the time over 3 months vs 67% normally; KOSPI up 92% over 12 months vs 63%),
and held up out of sample. (3) tools/signal_alerts.py, run by update.yml: one GitHub issue (label signal-idea) per
active idea to investigate, closed with a comment when it switches off; GitHub emails both.

### Suggested order

WP23 → WP22 → WP24 → WP25 → WP26 → WP27 → WP28 → WP29. WP23 and WP22 answer the idea-generation request and need no new
data source. Still not possible with free data: earnings revisions and forward P/E, MGS yields, Bursa foreign flows.

### Decisions for the owner

1. Wording: call the page **Signals** with "ideas to investigate", not "investment ideas" (recommended: the site is
   public and these are untested-in-real-time rules).
2. Whether to build all of WP24 to WP29 or pick.
3. Optional later: a written daily summary of the signals by an AI model in the data run. It needs a paid API key
   stored as a repository secret; not planned unless asked.

---

## Planned, not built (owner's request, 12 Nov 2026): WP37 to WP50, structured products and completeness

**Status: plan only. Nothing below is built. Build when the owner says "Go" and names the packages.** Follow
`CLAUDE.md` (sub-tabs, 2,300 px, ≤ 5 tiles, ≤ 16 rows, one home per card) and run `node tools/design-check.js` before
each push. One commit per package.

**The request:** (1) what else would make the dashboard more comprehensive; (2) the owner's new role includes
structured products: what to monitor, and how to find ideas to discuss with clients across the many structure types.

**The idea in one paragraph.** Every structured product is a bond plus options the client buys or sells. Its terms
are set by five market inputs: volatility, skew, correlation, interest rates and dividends. So the dashboard should
(a) show those five inputs live with their history, (b) translate them into "which structure families have rich terms
now, and is the backdrop safe for them", (c) rank underlyings by premium earned per unit of barrier risk, (d) price an
indicative coupon and show how the same note would have done if issued every week since 2005, and (e) track live
notes against their barriers. Rich terms always mean the market sees more risk; the page must say so every time.

### Data (all tested 12 Nov 2026 from this environment)

| Source | What it gives | Result |
|---|---|---|
| Cboe index history files (`cdn.cboe.com/api/global/us_indices/daily_prices/<X>_History.csv`, redirects to `cdn-api.cboe.com`) | Daily history: VIX1Y (2007), VXN, RVX, VXD (2009), VXEEM, VXFXI, VXEWZ, VXEFA, VXAPL, VXAZN, VXGOG, VXGS (2011), GVZ, OVX, VXTLT, VXSLV, implied correlation COR1M and COR3M (2006), dispersion DSPX (2014), SKEW (1990), put-selling index PUT (1991) and buy-write BXM | Works. EVZ (euro vol) is denied. |
| Cboe delayed option chains (`…/delayed_quotes/options/<SYM>.json`; index = `_SPX`) | Every listed option with bid, ask, implied vol, delta, open interest, plus `iv30` | Works for US stocks, ADRs (BABA, TSM), country ETFs (EWY, EWT, FXI, KWEB, INDA, EWJ, EEM), GLD, FXE, FXY. EWM and EWS chains are too thin to use (2 to 3 expiries, 5-cent bids). Files are large (SPY 6 MB, `_SPX` 14 MB). |
| Yahoo chart with `events=div` | Dividends paid: trailing 12-month yield for any stock (Maybank 6.5%, DBS 4.5%) | Works (host already allowed). |
| Yahoo chart `range=20y&interval=1wk` | 20 years of weekly closes for barrier back-tests (the ticker file holds only 3 years) | Works. |
| Nasdaq calendar (`api.nasdaq.com/api/calendar/earnings?date=…`, `/api/analyst/<SYM>/earnings-date`) | US earnings dates and EPS forecasts | Works with a browser User-Agent. |
| FRED | Effective yields (US IG, HY, EM, Asia credit: 3 years only, so archive), bank lending standards, delinquencies | Works. |
| iShares fund pages | 12-month yield, net assets and NAV are in the page; P/E, P/B and the history download load through a script | Partly: yields and net assets readable; P/E and P/B need the page's data API (not located; bounded effort in WP50). |
| Bursa Malaysia (foreign flows) | – | Blocked (Cloudflare 403). Not planned. |

Not available free: implied volatility for Malaysian, Singapore and Hong Kong shares and for USD/MYR and SGD pairs
(use realised volatility with a stated mark-up); VSTOXX, VHSI and Nikkei VI (use options on FEZ, FXI, EWJ); issuer
quotes (never shown).

**Reading today (12 Nov 2026), to show what the page would say:** index volatility is ordinary (VIX 17.5, 53rd
percentile of 10 years) but single-stock and EM volatility is high (Nvidia 55%, Korea ETF 52%, EM 91st percentile,
gold 89th); implied correlation is at its 5th percentile and dispersion at its 95th; skew is at its 84th; the US 2Y
and 10Y yields are at their 88th and 98th percentiles. In plain terms: capital-protected notes on indices get good
terms (high rates, ordinary index volatility); single-stock and worst-of coupons look very rich but for a reason (the
dashboard's own signals are negative on chips); deep barriers are relatively well paid (steep skew). A 3-month put
10% below spot pays about 13.7% a year on Nvidia against 3.5% on the S&P 500.

### New page: Structured products (`sp`, sidebar group Markets, after Positioning & Vol)

Sub-tabs: **What suits now · Underlyings · Pricer · FX & DCI · Protection & rates · My notes**.

Rules for the whole page:
- Generic structure names only (ELN, FCN, autocallable, DCI, …). No issuer or product brand names; the site is public.
- Every number is labelled "indicative, from public option prices and a simple model, before issuer margin; not a
  quote". The pricer has an "issuer margin" input (default 1.5% a year) and shows the coupon before and after it.
- Every structure carries one plain sentence each for "fits a client who…", "main risk" and "not for".
- Wording: "structures to discuss", never "recommended" or "to sell".
- Publish derived figures only (never the option chains), with the credit "Cboe (delayed)".

### WP37. Data layer (`pipeline/structured.py` → `structured.json`, `structured_hist.json`)

1. **Universe** (`SP_UNIVERSE` in `pipeline/config.py`): indices already in `yahoo.json` (SPX, NDX, RTY, SX5E, NKY,
   HSI, CSI300, KOSPI, TWSE, NIFTY, STI, KLCI, AS51, GOLD) and every equity in `tickers.py` (US 50, Malaysia 48,
   Singapore 30, Hong Kong 14, others 19). Option proxies: SPX→`_SPX`, NDX→QQQ, RTY→IWM, SX5E→FEZ, NKY→EWJ, HSI→FXI,
   CSI300→FXI, KOSPI→EWY, TWSE→EWT, NIFTY→INDA, GOLD→GLD; US stocks and ADRs use their own chain.
2. **Option-implied block** (about 70 chain downloads per full run, 0.3 s apart, full runs only; keep the previous
   values when a download fails). Per underlying: spot; at-the-money implied vol at 1, 3, 6 and 12 months
   (interpolate total variance between listed expiries); implied vol at 90% and 80% of spot (3M and 12M: the skew);
   put premium as % of strike, bid and mid, on a grid of strikes 100/95/90/85/80/70% × 1/3/6/12 months; call premium
   at 100/105/110% × 12/24 months where listed; a liquidity flag (hide rows with open interest under 100 or a
   bid-ask spread over 25% of mid); `iv30`; timestamp. Parse the OCC symbol (`ROOT[W]YYMMDD[C|P]STRIKE×1000`).
3. **Archive** `archive/structured_iv.csv`: date, underlying, 3M ATM vol, 3M 90% vol, `iv30` (three numbers a day per
   name), so percentiles build from the first day; until a name has 250 days, show its realised-vol percentile
   instead and say so.
4. **Cboe index histories** listed above → series `SP_<NAME>` in `structured.json` (monthly before 2015, daily after,
   to keep the file small).
5. **Realised block** for the whole universe, from 20 years of weekly closes and 3 years of daily closes: realised
   vol 1M, 3M, 1Y and its 10-year percentile; trailing 12-month dividend yield; **barrier tables**: for every weekly
   start date since 2005 (or listing), the share of cases where the weekly close fell below B% of the start within T
   months (B = 50, 60, 65, 70, 75, 80, 90; T = 3, 6, 12, 18, 24), the share ending below K% at T (K = 80, 90, 100), the
   median and worst result at T, and the same shares for start dates when 3M realised vol was in its top third.
   Weekly observation understates daily barrier touches slightly: say so in the note.
6. **`structured_hist.json`**: the weekly closes themselves (about 200 series × 1,040 points, rounded to 4
   significant figures, roughly 1.3 MB), loaded only when the Pricer or My notes sub-tab opens.
7. **Earnings dates** for the US names (Nasdaq calendar, next 60 days) with the option-implied move over the date
   (front at-the-money straddle ÷ spot).
8. Wire-up: `fetch.py` module loop, the carry-over list in `update.yml`, `health.py` (`FILES`; allow 5 days), README.
   Estimated extra run time: 3 to 4 minutes per full run.

### WP38. Sub-tab "What suits now": the structure matrix

- **Tiles (5):** index volatility (VIX, percentile), single-stock volatility (median 3M ATM vol of the US names,
  percentile), implied correlation (COR3M, percentile), skew (SKEW, percentile), USD 2Y yield (percentile).
- **Card `sp_matrix` (wide table, 12 rows, no chart):** one row per structure family with five columns:
  **Terms now** (Rich / Fair / Thin, with the inputs that drive it), **Backdrop** (Supportive / Mixed / Hostile),
  **Fits a client who…**, **Main risk**, and a link to the Pricer pre-filled. Terms measure how much the market is
  paying; Backdrop measures whether conditions suit holding it. Show both, because rich terms with a hostile backdrop
  is the classic trap.

| Structure | Terms are rich when | Backdrop is supportive when |
|---|---|---|
| ELN / FCN on a single share | that share's 3M vol percentile ≥ 60 and implied > realised | share above its 200-day average, no negative Signals idea on it or its sector, no earnings inside the tenor |
| FCN / autocallable on an index | index vol percentile ≥ 60, or skew percentile ≥ 70 (deep barriers pay) | stress composite not rising, regime not Slowdown, breadth above 40% |
| Worst-of autocallable (basket) | implied correlation percentile ≤ 30 and single-stock vol ≥ 60 | dispersion (DSPX) percentile < 80 and breadth above 50%; otherwise "rich but fragile: one name can break it" |
| Capital-protected participation note | rate percentile ≥ 60 and 1Y index vol percentile ≤ 50 | any; the cost is opportunity, not capital (issuer credit risk aside) |
| Sharkfin / capped participation | rate percentile ≥ 60 and vol percentile ≥ 50 (the cap is worth more) | client expects a moderate rise, not a surge |
| Dual currency investment (DCI) | pair's vol percentile ≥ 60 and a rate gap in the client's favour | the conversion currency is cheap (REER percentile < 40) and the client has a real use for it |
| Gold-linked ELN / DCI | gold vol (GVZ) percentile ≥ 60 | gold above its 200-day average; real yields not rising |
| Accumulator / decumulator | single-stock vol percentile ≥ 60 (bigger discount) | share in a steady uptrend with low volatility of volatility; always flagged **high risk: leveraged, open-ended commitment** |
| Range accrual (rates or FX) | rates vol (MOVE) percentile ≥ 60 | central bank read is "on hold" on the Central banks page; reference inside the range for ≥ 80% of the last 2 years |
| Callable fixed-rate / step-up note | rate percentile ≥ 60 and MOVE percentile ≥ 60 | client accepts being called when rates fall |
| Curve steepener note | 2s10s percentile ≤ 30 (flat or inverted curve) | Fed pricing shows cuts ahead |
| Credit-linked note | HY and IG spread percentile ≥ 60 | spreads not widening for 3 months; stress composite credit block calm |

- **Card `sp_inputs` (wide chart, toggle between five inputs):** the chosen input against its 10-year median with the
  current percentile; note leads with what a high reading means for terms.
- **Card `sp_putwrite` (half):** Cboe PUT index (sell 1-month S&P puts, fully collateralised) against the S&P 500:
  since 2007 about 7.3% a year with a 37% worst fall, against 8.8% (price only) and 57%. This is the long-run record
  of the "yield for downside risk" trade that ELNs and FCNs are built on.
- **Card `sp_read` (half):** three or four rule-based sentences ("Today: …") built from the matrix, as in the
  reading above. Also one line in the Weekly brief (screen only).

### WP39. Sub-tab "Underlyings": the screener and coupon matrix

- **Card `sp_screen` (wide table, view chips: Indices & ETFs · US shares · Singapore · Malaysia · Hong Kong & Asia;
  16 rows at rest with "Show all"):** 3M implied vol (or "est." from realised × the median implied ÷ realised ratio
  of names that have options), vol percentile, implied − realised, skew (90% vol − ATM vol), **3M 90% put yield a
  year** (market bid where a chain exists, model otherwise), dividend yield, trend (above or below 200-day), distance
  from 52-week high, **breach history** (share of past 6-month windows ending below 80%; share of 12-month windows
  touching 70%), next earnings date (flag if inside 3 months), and a **score = premium per unit of risk** (put yield
  ÷ max(breach share, 2%)), sortable. Estimated rows are marked "est." and never rank above a market-priced row with
  the same score.
- **Card `sp_grid` (half), for the selected row: the coupon matrix.** Strike (100 to 70%) × tenor (1 to 12 months):
  put premium as a yield a year; a toggle shows the breach history for the same cells, so premium and risk are read
  from the same grid.
- **Card `sp_term` (half):** the selected name's implied vol by tenor and its skew, against the index.
- **Card `sp_baskets` (wide table):** candidate worst-of baskets (the ten most-used pairs and triples in each region,
  plus any the owner adds): average pairwise 1-year correlation, weakest member's trend, share of past 12-month
  windows where the worst member touched 60% and 70%, and how much more often that is than the best single member.
  Note leads with: lower correlation raises the coupon because it raises the odds that one member falls.
- Region pages: the "Signals for this market" strip gains one line "Structures: terms Rich/Fair/Thin" linking here.

### WP40. Sub-tab "Pricer": indicative terms and the back-test

- **Inputs (one card, `sp_form`):** structure (ELN · FCN with knock-in · autocallable, single or worst-of up to 3 ·
  capital-protected note · sharkfin · accumulator), underlying(s), tenor, strike, knock-in level and type (at
  maturity or any day), autocall level and frequency, coupon barrier and memory, issuer margin. Pre-filled from the
  matrix and screener links.
- **Model (`docs/sp-model.js`, plain functions with a test file `tools/sp-check.js`):** Black-Scholes with the vol
  read at the strike or barrier from the chain grid where there is one (so skew is respected), dividend yield from
  WP37, rates from the existing curves (USD Treasury, SGS; MYR uses the 12-month deposit rate; say so). ELN = cash
  rate + put premium. FCN with at-maturity knock-in = put at the barrier plus a digital for the gap to the strike;
  any-day knock-in = closed-form down-and-in put with the standard discrete-monitoring adjustment. Autocallables and
  worst-of: Monte Carlo (20,000 correlated paths, fixed seed, in a Web Worker), solving for the coupon that prices
  the note at 100 minus margin. Capital-protected: zero-coupon bond + call; participation = budget ÷ call premium.
  `sp-check.js` must show the model reproduces listed put prices within 15% for SPY, QQQ and three shares, and known
  textbook values for the barrier formulas, or the build fails.
- **Card `sp_terms`:** indicative coupon (before and after margin), break-even level, and a small sensitivity grid
  (strike × knock-in).
- **Card `sp_backtest` (wide): "If this note had been issued every week since 2005".** Using the weekly closes:
  share called early (and when), share paid in full at maturity, share knocked in, share ending in a loss, average
  and worst loss, average annualised return, and the same for simply holding the underlying. Chart: outcome by issue
  date, so the clusters of losses (2007–08, 2020, 2022) are visible. The coupon is the one typed or priced above,
  held constant: note that real coupons would have been higher in volatile periods.
- **Card `sp_payoff` (half):** payoff at maturity against the worst underlying's final level, with today's level and
  the barriers marked.

### WP41. Sub-tab "FX & DCI"

- **Card `dci_table` (wide):** pairs USD/MYR, SGD/MYR, USD/SGD, AUD/USD, AUD/SGD, EUR/USD, GBP/USD, USD/JPY, XAU/USD:
  spot, deposit-rate gap, volatility (implied from FXE, FXY, GLD chains where they exist; otherwise 3M realised ×
  1.1, marked "est."), **indicative yield a year for a strike 1% away at 2 weeks and 1 month**, how often spot has
  actually moved that far in that time (history), the conversion currency's REER percentile, trend.
- **Card `dci_grid` (half):** for the selected pair and direction, strike distance (0.5, 1, 1.5, 2, 3%) × tenor
  (1W, 2W, 1M, 3M): indicative yield, with a toggle to the historical conversion frequency.
- **Card `dci_hist` (half):** the pair with its 200-day average and the chosen strike drawn; note says which outcome
  the client must be content with (being converted at the strike).
- Model: Garman-Kohlhagen. Note for ringgit pairs: onshore pricing differs from this estimate.

### WP42. Sub-tab "Protection & rates"

- **Card `pp_budget` (wide table):** currency (USD, SGD, MYR, AUD) × tenor (1, 2, 3, 5 years): zero-coupon price,
  option budget for 100% and 95% protection after margin, and indicative participation in the S&P 500, gold and
  Asia ex-Japan (call premiums from the `_SPX`, GLD and EEM chains; model for others).
- **Card `pp_map` (half):** history of the USD 3-year option budget against 1-year index volatility, today marked:
  participation is best when rates are high and volatility is low.
- **Card `ra_range` (half):** range accrual helper: for a chosen reference (3M T-bill, UST 10Y, USD/MYR, 3M KLIBOR,
  SORA) and range, the share of days inside it over each past 1-year window, and where it sits now.
- **Card `ra_curve` (half):** 2s10s and 10s30s with percentiles (moved view of existing series, not a copy of a
  card), for steepener and callable-note conversations. "See also" to Fixed Income → Curves and Central banks.

### WP43. Sub-tab "My notes": private book of live notes

- Stored in the browser only (`localStorage` key `sd-notes-v1`), included in the Idea log export (bump to version
  3). The form warns: "This site is public code; notes stay on this device. Do not enter client names."
- Fields: label, structure, underlyings (from the universe, or any watchlist ticker), trade date, maturity, initial
  levels (auto-filled from the trade date), strike, knock-in and type, autocall level and dates, coupon and barrier.
- **Table `nb_table`:** worst performer and its level against initial, distance to knock-in, strike and autocall,
  next observation date, status (Likely to call · On track · Coupon at risk · Near knock-in · Knocked in), and value
  if it matured today. Sorted by distance to knock-in.
- **Card `nb_chart`:** the selected note's underlyings rebased to the trade date with the barriers drawn.
- Alerts: "What changed" on the Strategist View gains lines when a note's worst underlying comes within 10% of its
  knock-in, crosses it, or stands above the autocall level a week before an observation. Never in the printed brief.

### Completeness (the first half of the request)

| Package | What | Where | Size |
|---|---|---|---|
| **WP44. Income menu** | "What pays what" table: cash and deposits (USD, SGD, MYR, AUD), government 2Y and 10Y, US IG, HY, EM and Asia USD credit (FRED effective yields, archived), dividend yields (KLCI, STI and S&P baskets, Malaysian and Singapore REIT baskets from Yahoo dividends), and the S&P 3M 90% put yield from WP37. Columns: yield, 1-year change, percentile, yield hedged to MYR and to SGD (existing hedging-cost logic), yield after inflation, worst 12-month loss. | Fixed Income → new sub-tab "Income menu" | Medium |
| **WP45. Playbook** | Event studies: pick an event set (first Fed cut, last Fed hike, recession start, VIX above 40, oil up 40% in a year, dollar peak, curve un-inversion, each regime switch) and see the median path of any asset 12 months before and after, with hit rates at 1, 3, 6 and 12 months for twelve assets and a marker for where we are now relative to the latest event. Monthly Shiller data extends the S&P 500 before 2005. | Regime & Leading → new sub-tab "Playbook" | Medium |
| **WP46. Earnings dates** | US earnings dates for the names in the ticker list (Nasdaq), with the option-implied move, on the Calendar (new filter chip "Earnings") and in the Weekly brief's week ahead (top 5 by size). Reuses WP37. | Calendar | Small |
| **WP47. Model portfolio stress** | For the Idea log's model portfolio: return in six past episodes (2008, 2013 taper, 2015 China, late 2018, Covid, 2022) for the portfolio and each holding, and contribution to risk. Check what `mpStats` already shows first; add only what is missing. | Idea log → Model portfolio | Small |
| **WP48. Credit cycle** | Bank lending standards (already loaded) against HY spreads, delinquency rates, CCC − BB spread, bank credit growth. | Stress & Signposts → new sub-tab "Credit cycle" | Small |
| **WP49. Gold** | Gold against the US real yield and the dollar, gold in MYR and SGD, gold ÷ silver, gold volatility (GVZ) and the GLD implied-vol term structure. Central-bank buying has no free feed. | Markets → new sub-tab "Gold" (cards move out of Commodities only if they are gold-only) | Small |
| **WP50. Country ETF flows and yields** | iShares country funds (EWM, EWS, MCHI, EWY, EWT, INDA, EWJ, EEM): 12-month yield for the Valuation scorecard, and net assets ÷ NAV archived daily to show money moving in or out (a partial stand-in for foreign-flow data, which Bursa blocks). Spend at most 30 minutes locating the page's data API for P/E, P/B and history; if not found, ship yields and flows only. | Valuation; Asia ex-Japan → Across Asia | Small, uncertain |

Considered and left out: Bursa foreign flows and ICI fund flows (blocked), forward earnings estimates by market (no
free feed), Treasury auction results (low value for this audience; can be added later from the Treasury's public API),
more ASEAN country pages (thin free data beyond Indonesia).

### Suggested order

1. **Run 1: WP37 + WP38 + WP39.** Answers the question directly: the inputs, the matrix, the screener and coupon
   grid. Largest run (WP37 is the heavy one).
2. **Run 2: WP40 + WP43.** Pricer, back-test and the private notes book (they share `sp-model.js` and the history file).
3. **Run 3: WP41 + WP42 + WP46.** FX and DCI, protection and rates, earnings dates.
4. **Run 4: WP44, WP45, then WP47 to WP50 as wanted.**

### Risks and how the build handles them

- **A public site showing coupons.** Everything is generic, model-based and labelled; no issuer names; margin shown
  explicitly. If the owner's compliance team objects to any part, each sub-tab can be switched off with one flag
  (`SP_SHOW` in `docs/app.js`); the notes book never leaves the browser.
- **Cboe terms.** The delayed data is public but not licensed for redistribution: publish derived figures only, with
  credit, and archive three numbers per name per day. If Cboe blocks the runner, the page falls back to realised
  volatility and says so; nothing else on the dashboard depends on it.
- **False precision.** Asian shares have no listed-option data: their rows say "est." and the note gives the mark-up
  used. The model must pass `sp-check.js` against listed prices before any coupon is shown.
- **Run time and size.** About 150 MB of chain downloads per full run; if the run passes 20 minutes, cut the US
  share list to the 30 largest. `structured_hist.json` is lazy-loaded.
- **Height.** Six sub-tabs, at most four cards each; the matrix is 12 rows.

### Decisions for the owner

1. **Which packages, in which order?** Recommended: Run 1 first (WP37 to WP39), then decide.
2. **Which structures does your desk offer?** The matrix has twelve families; say which to drop or add.
3. **Underlyings.** Default is the current ticker list plus the index and country ETFs. Name any shares clients ask
   for most (they can also be added through the watchlist).
4. **Issuer margin shown by default:** 1.5% a year (recommended), or another figure.
5. **The private notes book (WP43):** include it (recommended) or leave it out?

---

## Built (owner's request, 12 Nov 2026): WP32 to WP36, regions reorganised

**Status: WP32 to WP36 all built on 12 Nov 2026** (WP36: see its own status line below). Earlier: **WP32 to WP35 built on 12 Nov 2026** (WP35: the rule, sidebar tree and four-sub-tab order are in `CLAUDE.md`; checks passed: every card listed in a sub-tab exists once and sits on its own page, every scorecard row, See-also link and signals-strip link opens a real page, "what changed" links resolve, search finds the moved cards, old links land correctly, design check passes). Earlier: **WP32, WP33 and WP34** (WP34: equity cards for Malaysia, Singapore and China against Asia ex-Japan and the world in local currency and US dollars; a currency card for every Asian page and Japan with the 200-day average, carry and a real-effective-rate toggle; Malaysia Rates & bonds adds the BNM summary and US 2Y − OPR vs USD/MYR; China Rates & bonds adds its own rates card and the inflation card keeps CPI only; a "Signals for this market" strip on each Equities sub-tab; See-also rows to Central banks, Asian FX, Chip cycle and Commodities. Taiwan has no Rates & bonds sub-tab: no public bond-yield or policy-rate source is wired in, stated on its currency card). Earlier: **WP32 and WP33** (WP33: US, Europe, Japan and Australia split Equities · Rates & bonds · Currency · Economy; breadth is one set per market on Malaysia, Singapore and US → Equities, with a cross-market table left on Markets → Breadth; US style ratios and sector tables moved to US → Sectors & styles; palm oil to Malaysia → Sectors; iron ore to Australia → Currency; Fixed Income's euro periphery chart was a duplicate of Europe's and was removed; "See also" rows on Markets and Fixed Income; old links remapped). Earlier: **WP32** (country pages `my`, `sg`, `cn`, `kr`, `tw`, `in` under Asia ex-Japan in the sidebar; old `#tab=asia&sub=N` and `#tab=cnjp` links land on the new pages; Asia overview links carry `v=2`). WP33 to WP36 follow in order. Follow `CLAUDE.md` and run
`node tools/design-check.js` before each push. One commit per package.

**The request:** (1) move the region-specific parts of the Markets pages to their regions; (2) organise each region
by asset class (equities, fixed income, currency, economy); (3) break Asia ex-Japan down in the sidebar (Asia ex-Japan
→ Singapore, → China, …), each country on its own page.

### The rule (add to `CLAUDE.md`)

- **Region and country pages hold everything about one place, split by asset class.** Sub-tabs, always in this
  order, leaving out any with no data: **Equities · Rates & bonds · Currency · Economy** (a page may split one of
  these in two if it runs over the height budget, e.g. Malaysia "Sectors", US "Inflation").
- **Markets-group pages (Markets, Fixed Income, Valuation, Positioning & Vol, Correlation) are cross-market tools:**
  tables and charts that compare places or asset classes. Anything about a single place lives on that place's page.
- **One home per card.** A card is never shown in two places. Where a reader would look for it elsewhere, put a
  "See also" link row at the top of that sub-tab (small helper `seeAlso(tab, sub, [[label, tab, sub], …])`).
- **Theme pages stay whole** (AI → Chip cycle keeps its Korea and Malaysia cards); country pages link to them.

### WP32. Sidebar tree and country pages for Asia ex-Japan (a move, no new cards)

**Sidebar** (Regions group):

    Country scorecard
    US
    Europe
    Asia ex-Japan  ▾        ← click: opens the Asia overview and expands the list
        Malaysia
        Singapore
        China
        Korea
        Taiwan
        India
    Japan
    Australia

- Children are indented buttons, hidden when the parent is collapsed. The list opens by itself when a child page is
  active, and the open/closed state is remembered (localStorage, with the usual try/catch). Same on phones.
- The page header's group label reads "Regions · Asia ex-Japan" on a child page (`setTab` walks back to the parent).
- Keyboard and search (Ctrl+K) work as before; search results name the new page.

**Pages** (new tab ids `my`, `sg`, `cn`, `kr`, `tw`, `in`; each gets a panel with its own tiles box and grid, like
`us`): cards are moved with the existing `REGION_MOVES` mechanism, before `buildSubtabs()`.

| Page | Equities | Rates & bonds | Currency | Economy |
|---|---|---|---|---|
| Malaysia | `my_sec_table`, `my_sec_rs`, `my_sec_drv` (as a second sub-tab "Sectors") | `myrates`, `mylend` | `myrfx`, `myrtbl` | `mylead`, `mygrowth`, `mytrade`, `myprices`, `mymoney` |
| Singapore | (WP34) | `sgrates`, `sgust`, `sghedge` | `sneer` | `sginfl`, `sggrowth` |
| China | (WP34) | `cn_spread` | (WP34) | `cn_infl`, `cn_trade`, `cn_conf` |
| Korea | `kr_mkt`, `kr_lead` | `kr_rates` | (WP34) | `kr_trade`, `kr_infl`, `kr_act` |
| Taiwan | `tw_mkt`, `tw_lead`, `tw_money` | none (no public source: say so in a note) | (WP34) | `tw_trade`, `tw_growth`, `tw_infl` |
| India | `in_mkt`, `in_lead` | `in_rates`, `in_oil` | (WP34) | `in_infl`, `in_act` |

- **Asia ex-Japan (overview)** keeps the comparison sub-tabs: Across Asia · Asian FX · What leads.
- Tiles: move the per-country lists from `ASIA_KPI` into `TILE_SETS` per page and sub-tab; extend `regionTiles` /
  `renderRegion` to the six pages (≤ 5 tiles each).
- Register the new ids everywhere a tab id is listed: the validation array in `init`, `TAB_TITLES`, the render map in
  `renderTab`, `SUBTABS`, `TILE_SETS`, the late-loading re-render list in `loadTickers`.
- Update every link into the old sub-tabs: `goSub('asia', …)` (8 places: country scorecard rows, signals, "what
  changed", policy summaries, weekly brief), `REGION` in `pipeline/signals.py` is unaffected.
- **Old links keep working:** in the hash parser, map `tab=asia&sub=0…10` (the old order) to the new page and
  sub-tab, as was done for `cnjp`.

### WP33. Asset-class sub-tabs for US, Europe, Japan, Australia; moves out of the Markets group

| Page | Equities | Rates & bonds | Currency | Economy |
|---|---|---|---|---|
| US | `us_eq`; second sub-tab "Sectors & breadth": `sty_ratio`, `sty_sect`, `sty_style`, US breadth | `us_rates`, `us_be`, `us_fed` | `us_dxy` | Growth & jobs · Inflation · ISM · Housing & consumer · Recession watch (as now, grouped "Economy") |
| Europe | `eu_eq` | `eu_yields`, `eu_spread`, `sp_euro`, `eu_hy`, `eu_ecb` | `eu_fx` | `eu_infl`, `eu_unemp`, `eu_gdp`, `eu_bci`, `eu_m3` |
| Japan | `jp_eq` | `jp_policy`, `jp_boj`, `jp_bojsum` | (WP34) | `jp_infl`, `jp_tankan`, `jp_act` |
| Australia | `au_eq` | `aurates`, `au_rba` | `audiff`, `cm_iron` | `auinfl`, `augrowth`, `autot` |

**Moves out of the Markets group** (the source page gets a "See also" link in their place):
- Markets → **Breadth**: one set of four cards with a Malaysia / Singapore / US toggle becomes three sets, one per
  market (`renderBrTrend`, `renderBrTable` and the two others take the market as an argument instead of
  `state.brMkt`): Malaysia → Malaysia Equities, Singapore → Singapore Equities, US → US "Sectors & breadth". Markets
  keeps one small table "Breadth across markets" (three rows: share above the 200-day average, new highs and lows).
- Markets → **Styles & sectors** (US sector ETFs and style ratios) → US "Sectors & breadth". The sub-tab leaves Markets.
- Markets → Commodities: `cm_palm` → Malaysia Sectors; `cm_iron` → Australia Currency.
- Fixed Income → Spreads: `sp_euro` (Italy, Spain, France against Germany) → Europe Rates & bonds.
- Stays put (cross-market tools): Markets Performance, Trend, Seasonality, the rest of Commodities; Fixed Income
  Curves, Yields, the credit spread cards, FX & hedging; Valuation; Positioning & Vol; Correlation.

### WP34. Fill the gaps so every page has all four asset classes

Built from data already loaded; two helpers do most of it.
- `eqCard(index, benchmarks)`: the index in local currency and in US dollars against Asia ex-Japan (AAXJ) and world
  (ACWI), rebased; note with the 200-day trend and 3-month relative performance. Used for **Malaysia** (KLCI),
  **Singapore** (STI) and **China** (CSI 300, Hang Seng, MCHI). Korea, Taiwan and India already have theirs.
- `fxCard(ccy)`: spot against the dollar with its 200-day average, and the real effective exchange rate percentile
  (20 years) as a second line or a tile; note with carry from the FX table. Used for **Korea, Taiwan, India, China,
  Singapore (next to the S$NEER card), Japan**; Malaysia adds a REER card beside the existing ringgit cards.
- Malaysia Rates & bonds: `my_bnm` (policy summary, reusing `renderPolicySummary` with the BNM entry in `CBS`) and
  `my_gap` (US 2Y − OPR against USD/MYR, dual axis). Note on the sub-tab: no public source for MGS yields.
- China Rates & bonds: `cn_rates` (10Y and 3M; today they sit inside the inflation card).
- **"Signals for this market" strip** on each Equities sub-tab: the active ideas and switched-on rules from the
  Signals page whose target is that market (from `SIG`), one line each, linking to Signals. Empty = one muted line.
- "See also" rows: Korea Equities → AI Chip cycle; Malaysia Sectors → AI Chip cycle (Malaysian tech) and Markets
  Commodities; each Rates & bonds → that bank's Central banks sub-tab; each Currency → Asian FX carry table.
- Country scorecard rows open the new country pages.

### WP35. Housekeeping

`CLAUDE.md` (the rule above, the sidebar tree, the four-sub-tab order), README (page list), `PLAN.md` status. Check:
every page and sub-tab renders with no empty card; old `#tab=asia&sub=…` links land in the right place; the Weekly
brief, "what changed" and signal links open the right pages; `design-check` passes (it walks the sidebar buttons, so
the six new pages are covered automatically); search finds the moved cards.

### WP36. Europe by country (owner's request, 12 Nov 2026): Germany, France, Italy, Spain, UK

**Status: built on 12 Nov 2026.** As planned, with these findings: the OECD feed and the ECB's per-country HICP
(dataset ICP) both stop France, Italy and Spain inflation at Dec 2025, so euro members' HICP comes from Eurostat via
FRED (`CP0000xxM086NEST`, current to Sep 2026); Germany's total-industry output stops in 2023 in the OECD feed, so all
five use manufacturing output; the euro members share one 3-month rate and the UK's stops in Feb 2026, so short rates
are the ECB deposit rate and the UK overnight rate (SONIA). The periphery-spread card keeps its one home in Europe →
Rates & bonds (Countries compared links to it). The 13 new signal rules (five leading indices against their own
indices, the Italy spread against the FTSE MIB and the euro) all grade "Context only" on today's history, so none
shows as an idea; the engine re-tests them every run. UK unemployment reaches the feed ~4 months late (data-health
allowance 170 days). Not available free: daily gilt yields and a market-implied BoE path.

The Europe page stays as the main page for the whole region (euro area), as now. Under it in the sidebar, the same
kind of collapsible list as Asia:

    Europe  ▾               ← click: opens the Europe page and expands the list
        Germany
        France
        Italy
        Spain
        UK

**Why these five:** Germany, France, Italy and Spain are the four largest euro-area economies (about 28%, 20%, 15%
and 10% of euro-area GDP, nearly three-quarters together). The UK is outside the EU but is Europe's second-largest
economy and has its own central bank, currency and bond market. The owner named UK, Italy, France and Germany; Spain
is added as the fourth-largest euro economy (drop it if not wanted).

**Data** (checked 12 Nov 2026; no new host needed):
- OECD key indicators (`pipeline/cnjp.py`, same call as Korea and India) for DEU, FRA, ITA, ESP, GBR: industrial
  production, exports and imports, unemployment, retail sales, 10Y yield, 3M and overnight rates, business and consumer
  confidence, quarterly GDP; OECD leading indices for all five. All present to Q3 / Oct 2026.
- **Inflation:** the OECD feed has CPI for Germany and the UK but not for France, Italy or Spain. Use the ECB data API
  (already used by `pipeline/cbwatch.py`) for each euro country's HICP (dataflow ICP, annual rate); verify the series
  keys at build time. UK CPI from the OECD.
- Equities (Yahoo, checked): DAX, CAC 40 and FTSE 100 are loaded; add FTSE MIB (`FTSEMIB.MI`) and IBEX 35 (`^IBEX`).
- 10Y yields for Germany, France, Italy and Spain are already loaded (FRED, monthly); UK 10Y from the OECD feed.
- Sterling: GBP/USD and the pound's real effective rate are loaded; EUR/GBP is calculated.
- Not available free: daily gilt yields and a market-implied Bank of England path (the BoE's files were unreachable
  earlier); the UK page uses monthly yields and the BoE meeting dates already in the calendar, and says so.

**Each country page** (new tab ids `de`, `fr`, `it`, `es`, `uk`; the standard order):
- **Equities:** the index in local currency and in US dollars against the Euro Stoxx 50 and world equities (`eqCard`
  from WP34); 200-day trend; the "signals for this market" strip.
- **Rates & bonds:** 10Y yield and its spread over the German Bund (Germany: Bund against the US 10Y and the ECB
  deposit rate); short rate. Italy and Spain: the spread with its history percentile (the stress gauge for the euro).
  UK: gilt 10Y against Bunds and Treasuries, Bank Rate (overnight rate) against CPI, next BoE decision.
- **Currency:** UK only (GBP/USD, EUR/GBP, real effective rate: `fxCard`). The four euro members share the euro, so
  they have no Currency sub-tab; a "See also" link goes to Europe → Currency.
- **Economy:** inflation against the 2% target, unemployment, GDP growth (quarterly), industrial production and
  retail sales, exports, business and consumer confidence, leading-index momentum.
- Tiles (≤ 5): equity index, 10Y (or spread over Bund), inflation, unemployment, GDP growth.

**Europe main page** gains one sub-tab, **Countries compared**: a table of the five with GDP growth, inflation,
unemployment, 10Y yield, spread over the Bund, equity index year to date and 3 months against the Euro Stoxx 50, and
leading-index momentum; rows open the country pages. The existing periphery-spread card (`sp_euro`, moved here in
WP33) sits beside it.

**Also:** the Country scorecard gains the five rows (16 rows in all, the table limit); the calendar gains German,
French, Italian, Spanish and UK CPI and GDP windows; the signal engine tests the five leading indices against their
own equity indices (graded down one tier like the others, since they contain share prices) and the Italy spread
against the FTSE MIB and the euro; only rules that pass are shown as ideas.

**Order:** build after WP32 to WP35, reusing the sidebar tree, `eqCard`, `fxCard`, the tiles and the "See also" row.

### Risks and how the build handles them

- **Height:** Malaysia Equities with breadth and the equity card may pass 2,300 px: that is why Sectors is its own
  sub-tab; split further if the check fails.
- **Thin sub-tabs:** a sub-tab with one card is fine; a sub-tab with none is left out (Taiwan Rates & bonds).
- **Sidebar length:** the Asia list is collapsed unless you are on one of its pages.
- **Order of work:** WP32 changes only where cards live, so it can be checked against today's pages card by card
  before anything new is added.

### Decisions for the owner

1. **One home per card** (recommended) or show region cards in both Markets and the region page? One home keeps
   pages short and avoids two copies drifting apart; links cover the rest.
2. **Malaysia's place:** first under Asia ex-Japan (recommended, matches your sketch), or its own top-level entry in
   Regions because your clients are Malaysian?
3. **Theme pages stay whole** (recommended): AI → Chip cycle keeps its Korea and Malaysia cards and the country
   pages link to it. The alternative is to move those cards to Korea and Malaysia.

---

## WP1. Central bank watch (highest priority)

**Why:** the Fed page shows market pricing against the Fed. Clients in Malaysia, Singapore and Australia
ask the same question about BNM, the RBA, the BoJ and the ECB. No free futures-based path exists for those
banks, so each gets the best free market gauge, labelled honestly as a money-market or bond-curve read
(not OIS, not a probability).

**New page** `cbwatch` ("Central bank watch") in the Macro group, directly under "Fed path vs market".
Sub-tabs: **Policy monitor · Malaysia (BNM) · Australia (RBA) · Japan (BoJ) · Euro area (ECB)**.

### Data (new module `pipeline/cbwatch.py` → `docs/data/cbwatch.json`)

| Bank | Policy rate | Market gauge | Source and status |
|---|---|---|---|
| BNM | `MY_OPR` (have) | Interbank rates: overnight, 1W, 1M, 3M, 6M | `api.bnm.gov.my/public/interest-rate/year/{Y}/month/{M}?product=interbank`, header `Accept: application/vnd.BNM.API.v1+json` **[verified]**: Oct 2026 returned 22 daily rows; 6 Nov: O/N 2.75, 1M 2.99, 3M 3.58. Tenors are often null on a given day: forward-fill up to 5 business days. |
| RBA | `AU_CASH` (have, daily) | Bank bills 1M, 3M, 6M (daily); 2Y, 3Y bonds | RBA table F1 daily: `FIRMMBAB30D`, `FIRMMBAB90D`, `FIRMMBAB180D` **[verified]** (9 Nov: 4.81 / 4.93 / 5.27 vs cash 4.85). F2 daily: `FCMYGBAG2D`, `FCMYGBAG3D`. The OIS columns in F1 stopped in Dec 2022: do not use them. |
| BoJ | `JP_CALL` (have) | JGB 1Y and 2Y yields | MOF Japan curve already in `curves.json` (`JP`, tenors 1 and 2) **[verified earlier]** |
| ECB | Deposit facility rate | Instantaneous forward rates at 3M, 6M, 1Y, 2Y (AAA government curve) | ECB Data Portal `FM/D.U2.EUR.4F.KR.DFR.LEV` (2.50 on 10 Nov) and `YC/B.U2.EUR.4F.G_N_A.SV_C_YM.IF_3M` / `IF_6M` / `IF_1Y` / `IF_2Y`, daily since 2005 **[verified]** |
| Fed | existing `fedpath.json` | Fed funds futures | reuse; do not rebuild |

BNM history: first run fetches 36 months (36 calls, 0.2 s apart); later runs fetch only the current and
previous month and merge into the previously published file (same keep-previous pattern as the other
modules). Add `cbwatch.json` to the "Fetch previously published data" list in `update.yml`.

### Calculations (keep them simple and state them on the card)

- **Spread to policy rate** for each tenor: market rate minus policy rate, in bp. This is the headline gauge.
- **Implied forward** between two tenors, e.g. 3M→6M: `(r6 × 6 − r3 × 3) / 3`. For JGBs, 1y1y forward `= 2 × y2 − y1`.
- **Premium caveat:** interbank and bank-bill rates carry a credit and term premium, so a positive spread is
  not all "hikes priced". Show each spread against its own 2-year average and call the difference
  "pricing vs normal". Never print a hike/cut probability for these banks.
- **Snapshots:** now, 1 month ago, 3 months ago (same as the Fed page).

### Sub-tab layouts

**Policy monitor** (one wide table card, about 10 rows, plus one half-width chart pair):
- Table columns: Bank · Policy rate · Last change (date, size) · Next decision (date and SGT time, from
  `calendar.json`) · Latest inflation · Real policy rate (policy − inflation) · Market gauge (6-month
  spread, bp) · Change in that gauge over 1 month · one-word read (Hikes priced / On hold / Cuts priced,
  using "pricing vs normal" with a ±15 bp dead band).
- Rows: Fed, ECB, BoJ, BNM, RBA, plus MAS (no policy rate: show the S$NEER proxy slope and say so) and
  China (3M interbank `CN_3M` as the rate; no pricing column).
- Chart A: policy rates of the five banks since 2019, step lines. Chart B: real policy rates.

**Each bank sub-tab** (target about 1,400 px):
- Wide card: policy rate history (step line, 3 years back) continuing into a "priced by the market" zone,
  drawn like the Fed path chart: points at each tenor's horizon for now / 1M ago / 3M ago.
- Half card: headline spread (3M for BNM and RBA, 2Y for BoJ, 1Y forward for ECB) minus policy rate, long
  history, with its 2-year average as a dashed line.
- Half card: small table of the next decisions from `calendar.json` (date, SGT time) and the last three
  rate changes.
- KPI tiles filtered to the open sub-tab.

### Acceptance checks
- BNM 3M interbank minus OPR on 6 Nov 2026 reads about +83 bp; RBA 3M bills minus cash about +8 bp;
  ECB 1Y forward minus DFR about +52 bp.
- Every card states "money-market / bond-curve read, includes a term premium; not OIS pricing".
- Weekly brief: add one line to Key takeaways from the Policy monitor (the bank whose gauge moved most
  over the week).

---

## WP2. Commodities that matter for Malaysia and Asia

**Placement:** Markets → new sub-tab **Commodities**.

- Palm oil: FRED `PPOILUSDM` (IMF, monthly, USD/tonne) **[check on runner]**. Daily palm-oil futures are
  not on Yahoo (`KPO=F`, `FCPO=F` return nothing).
- Iron ore: Yahoo `TIO=F` **[verified]**. Dry bulk shipping proxy: Yahoo `BDRY` (ETF) **[verified]**.
- Already loaded: Brent, WTI, gold, copper, natural gas.
- Cards: (1) energy and metals rebased, with the currency drop-down (reuse `CCY_CHOICES`, so "Brent in MYR"
  works); (2) palm oil vs an equal-weight plantation basket from the ticker list (IOI 1961.KL, KLK 2445.KL,
  SD Guthrie 5285.KL), dual axis; (3) iron ore vs AUD/USD, dual axis; (4) a compact performance table.
- Add palm oil → plantation basket and iron ore → AUD to `LL_PAIRS` in the Lead-lag finder.

## WP3. Semiconductor and trade cycle

**Placement:** AI page → new sub-tab **Chip cycle** (Malaysia's tech exporters live off this cycle).

- Yahoo `^SOX` **[verified]**; already loaded: SMH, Korea exports, TWSE, KOSPI.
- Cards: (1) SOX ÷ S&P 500 (relative strength) with SOX year-on-year; (2) SOX YoY vs Korea exports YoY,
  dual axis, with a "lead +2m" toggle (the Lead-lag finder measured semis leading Korea exports by 2 months,
  r = +0.58); (3) Malaysian tech basket from tickers (Inari 0166.KL, ViTrox 0097.KL, MPI 3867.KL) vs SOX,
  both in USD.

## WP4. Styles and sectors

**Placement:** Markets → new sub-tab **Styles & sectors**.

- Add to `config.py` YAHOO: `MTUM`, `QUAL`, `VLUE`, `USMV`, `IWF`, `IWD` **[verified]**. Already loaded:
  SPXEW, RTY, sector ETFs.
- Cards: (1) ratio lines rebased to 100: growth ÷ value (IWF/IWD), small ÷ large (RTY/SPX), equal ÷ cap
  (SPXEW/SPX), momentum ÷ market, low-vol ÷ market; (2) sector relative-strength table: each sector ETF's
  return minus the S&P 500 over 1M / 3M / YTD, heat-shaded, sorted; (3) one-line read under the chart,
  rule-based (e.g. "defensive leadership: low-vol and staples beating the index over 3M").

## WP5. Nowcasts and cash on the sidelines

- FRED **[check on runner]**: `GDPNOW` (Atlanta Fed GDPNow), `MICH` (UMich 1-year inflation expectations),
  `EXPINF1YR` (Cleveland Fed), money-market fund assets `WRMFNS` (weekly retail) or `MMMFFAQ027S`
  (quarterly total). If an ID fails, drop that series rather than block the package.
- Placement: Regime → **Recession watch** gets GDPNow as a KPI tile and a half card (GDPNow vs last
  official GDP); the inflation card there gains an "Expectations" toggle; Liquidity → "Credit, money &
  rates" gets money-market fund assets as a half card. Check the height budget on both sub-tabs.

## WP6. "What changed" alerts on the Strategist View

Front-end only, rule-based, no new data. One half-width card on Strategist View → Today listing changes
over the last week, most important first, each a link to its page:
regime switched or a method newly disagrees · stress composite crossed a band · a peak signpost newly
triggered · breadth crossed 20% or 80% · VIX 3M/VIX fell below 1 · a central bank gauge moved more than
15 bp (after WP1) · a market moved more than 2σ · an open idea hit its target or stop · a data series went
stale. If nothing changed, say so in one line. Reuse the same list in the Weekly brief.

## WP7. Sentiment gauges (optional; ask the owner first)

AAII bull/bear, NAAIM exposure, CNN Fear & Greed are scraped from websites with no API, so they can break
without notice. Build only if the owner confirms. If built: archive each reading in `archive/` (like the
credit spreads), isolate each scraper in its own try/except, and show "last updated" on each tile.

---

## Not planned (no free, reliable source)

MGS yields; Bursa foreign fund flows; earnings revisions and forward P/E; economic surprise indices;
put/call ratios; OIS curves for MYR, SGD, AUD, JPY; a UK path (no SONIA contract history on Yahoo, and the
BoE's curve files need a host the sandbox cannot reach; revisit if the owner wants GBP rates).

---

## Reliability work (do WP-R1 and WP-R5 before WP1; the rest alongside)

- **WP-R1. Survive a Pages outage.** On 10 Nov the site went offline (repo toggled private), and the next
  run could not load yesterday's data as a fallback, so two SingStat series went missing. After each
  successful full run, force-push the published `docs/data/*.json` to a `data-cache` branch (single commit,
  like `live-news`); in "Fetch previously published data", fall back to that branch when the site returns
  404.
- **WP-R2. Retries for SingStat.** It times out often. In `asia.py`, retry each table twice with a
  20-second pause before falling back.
- **WP-R3. Run time.** A full run takes 10–12 minutes against a 30-minute limit. Print per-module seconds
  at the end of `fetch.main()` and keep new modules under 60 seconds each (the BNM back-fill is one-off).
- **WP-R4. Health coverage.** Add every new series to `health.py` with the right frequency (BNM interbank:
  daily; ECB forwards: daily; palm oil: monthly), so stale data raises the existing alert issue.

- **WP-R5. Archive step fails when two pushes land close together.** Seen on 10 Nov (run 42773077776):
  the second queued run checked out its own older commit, both runs rewrote the same line of
  `archive/ai_openrouter_daily.csv`, and `git pull --rebase` hit a conflict, so that run failed before
  deploying. The site was unaffected because the other run deployed. Fix in `update.yml`: check out the
  latest `main` for the archive step (or, on a rebase conflict, abort and skip the archive commit for that
  run, since the next run rewrites the same rows), and never let this step block the deploy.

## Things to keep an eye on (no build needed)

- Headline job handover: first self-restart due about 13:00 UTC on 10 Nov; a check is scheduled for 13:25.
- Central bank dates in `econcal.py`: BNM 2027 and BoE 2027 came from news reports, not the banks' own
  pages; MAS has only its January 2027 window. `COVERAGE` warns 75 days before each schedule runs out.
- GitHub's scheduler still fires irregularly; data refreshes rely on it plus pushes. If daily refreshes
  start being missed, chain the data workflow from the headline job (it already runs around the clock).
- The idea log and watchlist stars live only in the browser: remind the owner to Export now and then.
