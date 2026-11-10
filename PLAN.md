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
