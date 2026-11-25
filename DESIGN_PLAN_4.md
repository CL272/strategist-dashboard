# Design plan 4: a portfolio allocator (tracking error against a benchmark you choose)

**Status (25 Nov 2026): planned, waiting for the owner's answers to the decisions at the end. Nothing is built.**
Written after the owner asked for "a portfolio allocator": start a new portfolio or open an existing one, add an ETF,
and see the tracking error against a benchmark that can be customised ("like 60/40"). `CLAUDE.md` rules still apply;
where a step changes a standing rule it says so.

**Reference mockup** (a static page on the real stylesheet; serve the repository root and open it):

| Mockup | Shows |
|---|---|
| `design/portfolio.html` | The two new sub-tabs of Allocation on one page: **Portfolio** (portfolio bar, five tiles, holdings, benchmark, chart, where the tracking error comes from) and **Add a fund** (what-if, the weight curve, the ranked table) |

`design/redesign4.css` holds the new classes on the existing tokens. When a step is built, move its rules into
`docs/style.css` unchanged (the "mock-only" block stays behind). The mockup's figures are real: weekly closes with
dividends from Yahoo to 21 Nov 2026, in ringgit, three years, worked out by the planning prototype.

## What exists today, and what is missing

| Today | Gap |
|---|---|
| Allocation → Model portfolio: one portfolio of 14 fixed building blocks, weights, return, volatility, a chart against world equities, a stress test | One portfolio only; no benchmark; no tracking error; cannot add a fund that is not one of the 14 |
| `tickers.json`: 36 US-listed ETFs, three years of **unadjusted** closes | No UCITS, Singapore or Malaysian funds; no dividends (bond funds look worse than they were); too short for a 5-year window |
| The Watchlist: any ticker can be added through `watchlist.txt` | Nothing turns those tickers into portfolio building blocks |

## What the planning checks found (25 Nov 2026)

1. **The funds are available.** Yahoo serves dividend-adjusted history for all 52 funds tested: US-listed, UCITS in London
   (CSPX, VWRA, IWDA, AGGU, IB01 and others), Singapore (STI ETF, ABF Singapore bond) and Malaysia (the KLCI ETF and the
   ABF Malaysia Bond Index Fund, both from 2008). One London fund is quoted in pence (`GBp`) and must be divided by 100.
2. **The maths is exact, so each holding's share can be shown.** With both sides held at their target weights, the
   tracking error from the covariance of weekly returns equals the realised tracking error to the decimal
   (5.18% both ways in a first test against 60% ACWI and 40% US aggregate bonds). That gives a closed form for each
   holding's share of it.
3. **The base currency hardly changes tracking error** (5.18% in ringgit, 5.19% in dollars for that pair): the
   currency cancels out of the difference between two fully invested portfolios. It does change return and volatility.
4. **Thinly traded funds distort it.** The two Bursa funds show no price change in 17 and 18 of 157 weeks, the SGD
   corporate bond fund in 24; the London and New York funds in 1 or none. Such funds need a visible flag.
5. **A worked example** (the mockup): the "Malaysian balanced" preset against 60% world equities and 40% global
   aggregate bonds, three years: tracking error 5.1%, beta 0.59, volatility 6.4% against 9.0%. Holding 45 points less
   world equity than the benchmark explains 80% of it. Adding 10% of a world equity fund, paid for by all holdings in
   proportion, lowers it to 4.35%; the lowest point is at about 45% (2.9%). Adding 10% gold raises it to about 5.6%.

## The method (fixed; printed under the cards)

- **Returns**: weekly, Friday to Friday, dividends included (adjusted closes), converted to the portfolio's currency at
  each week's closing exchange rate. Cash earns the short rate (`CASH_RATE`: OPR, SORA or the US 3-month bill).
- **Both sides are held at their target weights** (rebalanced every week). Then, with `a` = portfolio weights minus
  benchmark weights and `Σ` = the covariance of weekly returns over the window on the weeks every holding has:
  tracking error = √(52 · aᵀΣa); share of holding i = aᵢ(Σa)ᵢ ÷ aᵀΣa (shares sum to 100%; a negative share offsets).
- **Also shown**: active return (annualised return minus the benchmark's), beta and correlation to the benchmark,
  volatility of each, worst fall of each, and on request the rolling 52-week tracking error.
- **Window**: 1Y · 3Y (default) · 5Y · Max. It is cut to the shortest history among the holdings and the card names the
  fund that cuts it ("limited by VWRA, from Jul 2019"). Under 52 shared weeks: no figure, and the card says why.
- **It is history, not a forecast**: what the tracking error would have been, before trading costs and tax. Fund fees
  are already inside fund prices. Asian and US markets close at different hours; weekly returns soften that but do not remove it.
- **Thin trading**: a fund whose price did not change in more than 8% of the window's weeks carries a "thinly traded"
  tag, and any figure that uses it says it may be understated.

## Step 1. Fund data (`pipeline/funds.py` → `docs/data/funds.json`)

Files: new `pipeline/funds.py`; `pipeline/fetch.py` (add `"funds"` to the isolated modules loop); `.github/workflows/update.yml`
(add `funds.json` to the list of previously published files, so a failed run keeps the old one); `pipeline/health.py`.

- **Universe** (`FUNDS`: symbol, short name, asset class). The 52 tested, in six classes:
  Equities: ACWI, VT, URTH, SPY, QQQ, EFA, EEM, AAXJ, EWJ, MCHI, INDA, EWM, EWS, CSPX.L, VWRA.L, IWDA.L, ISAC.L, EIMI.L,
  CNDX.L, ES3.SI, G3B.SI, 0820EA.KL · Bonds: AGG, BND, BNDW, BNDX, SHY, IEF, TLT, TIP, LQD, HYG, EMB, AGGU.L, IGLA.L,
  IBTA.L, IDTL.L, LQDA.L, IHYA.L, JPEA.L, FLOA.L, ERNA.L, A35.SI, MBH.SI, 0800EA.KL · Cash-like: BIL, IB01.L ·
  Gold: GLD, IGLN.L · Property: VNQ, IWDP.L, CLR.SI. Plus every ticker in `watchlist.txt` (class "Other" unless Yahoo
  says ETF and the name gives it away; the owner can live with "Other").
- **Fetch** daily adjusted closes from 2005 (or the fund's first day) with the existing `fetch_yahoo`; keep the last close
  of each week ending Friday; write `{ id: { name, ccy, cls, d: [days], v: [closes], thin: share of unchanged weeks in the
  last 3 years } }`. Divide `GBp` quotes by 100 and store `GBP`. One call per fund, 0.3 seconds apart.
- **Isolated**: a fund that fails keeps its previous history; the file is written even if some fail; `_meta` lists failures.
- The page loads the file only when a Portfolio sub-tab opens (`loadFunds`, the `loadEvents` pattern).

Acceptance: `funds.json` under 1 MB; every fund in the list present; three funds' one-year returns (CSPX.L, AGGU.L,
IEF) within 0.5 point of the issuer's published one-year NAV return; the pence fund's level matches its dollar twin's
move; `thin` above 0.08 for the Bursa funds and below 0.02 for SPY; a run with Yahoo blocked keeps the old file.

## Step 2. The maths and its check (`docs/port-model.js`, `tools/port-check.js`)

Pure functions with no page code, so Node can test them (the `sp-model.js` and `sp-check.js` pattern).

- `pmAlign(series, from, to)` → shared weekly dates and a returns matrix; `pmCov(R)`; `pmStats(R, w, b)` → tracking
  error, shares, beta, correlation, volatilities, annualised returns, worst falls, active return; `pmAdd(w, k, x, how)`
  → new weights (`how`: all holdings in proportion · from cash · from one holding); `pmCurve(R, w, b, k, how)` →
  tracking error for x = 0…50%; `pmRolling(R, w, b, 52)`.
- `tools/port-check.js` (run before pushing any change to the model, like `sp-check.js`): (1) the closed form equals the
  realised tracking error to 1e-9; (2) portfolio = benchmark gives zero; (3) shares sum to 100%; (4) the figure in
  ringgit and in dollars differ by under 0.05 point for fully invested pairs; (5) adding 0% changes nothing;
  (6) "from one holding" never takes a weight below zero; (7) a three-asset fixture with a known answer.

Acceptance: `node tools/port-check.js` passes against the local server and against a fixture with no network.

## Step 3. Allocation → Portfolio (replaces "Model portfolio")

Files: new `docs/port.js` (loaded after `alloc.js`), `docs/index.html` (script tag, `#pbBar`, `#pbKpis`), `docs/app.js`
(`buildAlloc`, `SUBTABS.alloc`, `SUB_ALIAS.alloc = { 'Model portfolio': 'Portfolio' }`, remove `renderModel` and
`renderModelChart` once the new cards cover them), `docs/vault.js` (`VAULT_ITEMS`), `docs/style.css`, both vault checks.

- **Building blocks** (`PB_UNIVERSE`, one registry): every fund in `funds.json`, plus the dashboard's own series the old
  model portfolio used, marked "index, no dividends" (FBM KLCI, Straits Times, S&P 500, gold, Bitcoin), plus cash.
- **Storage**: `sd-ports-v1` in `VAULT_ITEMS`, through `pstore()`:
  `{ v: 1, sel, ports: [{ id, name, ccy, win, rows: [[block, weight]], bench: { preset, rows }, updated }] }`.
  First visit: one portfolio is made from the saved model portfolio (`sd-model-v1`, same blocks and weights; that item is
  left untouched), or from the "Malaysian balanced" preset if there is none. A locked vault shows the lock, never defaults.
- **Portfolio bar** (`.pb-bar`, above the tiles): portfolio picker · ＋ New (blank, or from a preset) · Duplicate ·
  Rename · Delete (asks first) · currency (MYR, SGD, USD) · window. Names are the owner's and stay in the vault.
- **Five tiles** (`TILE_SETS.alloc.Portfolio`): Tracking error · Active return · Beta to benchmark · Volatility · Worst fall.
- **Portfolio card** (half): holding, weight (an input), benchmark weight, active weight, remove; a search box to add a
  fund by name or ticker; "Weights or amounts: scaled to 100%"; a link to `watchlist.txt` for funds not listed.
  A thinly traded fund shows its tag here.
- **Benchmark card** (half): preset chips (60/40 world · 70/30 · 50/50 · 40/60 · World equities · Malaysia 60/40 ·
  Custom), the benchmark's own editable rows, and "Mix by asset class: portfolio vs benchmark" (`.pb-mix`).
  Presets (`PB_BENCH`): world mixes = ACWI + AGGU.L (decision 3); Malaysia 60/40 = FBM KLCI index + 0800EA.KL.
- **Portfolio vs benchmark** (half, chart): toggle Value (both rebased to 100) · Gap (cumulative difference) · Rolling TE.
- **Where the tracking error comes from** (half, table): active weight and share of tracking error per holding, largest
  first, benchmark-only holdings included; the note names the biggest source in one sentence.
- **Stress test** (the existing `idea_stress` card, wide): reads the selected portfolio and adds a benchmark column.

Acceptance: the old model portfolio opens as the first saved portfolio with the same weights; create, duplicate, rename
and delete work and survive a reload and a lock/unlock; the Tracking error tile equals `pmStats` for the same inputs;
portfolio = benchmark shows 0.0%; `#tab=alloc` links to "Model portfolio" open "Portfolio"; the sub-tab is within the
height budget at 1440 and 1280 and passes at 390px; `vault-check.js` and `vault-sync-check.js` pass with the new item.

## Step 4. Allocation → Add a fund

- **What if I add a fund?** (half): fund picker (search), weight slider 0–50%, "paid for by" (all holdings in proportion ·
  cash · one holding); then before → after rows (`.pb-ba`): tracking error, beta, correlation, volatility, return a
  year; buttons "Apply to this portfolio" and "Save as new". Numbers are plain ink: a lower tracking error is not
  "good" in itself, so no green or red.
- **Tracking error as its weight rises** (half, chart): the curve for 0–50% with the chosen weight and the lowest point marked.
- **What 10% of each fund would do** (wide table, toggle 5% · 10% · 20%): every fund in the universe added at that
  weight; tracking error after, change in points, volatility, beta, correlation; sorted by change; eight that lower it
  most and six that raise it most at rest, "Show all". The foot says: "Arithmetic on past returns, not a recommendation."
  A fund with under 52 shared weeks is left out and counted in the note.

Acceptance: the "after" column equals recomputing the edited portfolio on the Portfolio sub-tab; "Apply" then shows that
same tracking error there; "Save as new" leaves the original untouched; the table shows at most 16 rows at rest;
no advice words on either sub-tab (the design check's Evidence-board rule is extended to them).

## Step 5. Guardrails and notes

- `tools/design-check.js`: the advice-word rule covers "Portfolio" and "Add a fund"; an allowance only if a rule needs one.
- `CLAUDE.md`: the allocator's rules (one universe registry, the method, the thin-trading tag, `sd-ports-v1` in the
  vault, run `port-check.js` after model changes); `design/README.md`; this plan's status and an "As built" list.

## Later, if wanted (not in this plan's steps)

1. **Target a tracking error**: "what weight of this fund brings tracking error to 3%?" (the curve already holds the answer).
2. **Malaysian unit trusts**: Yahoo carries some under fund codes; each would need checking before it is trusted.
3. **A factsheet page for one portfolio**, printable like the Weekly brief.

## Not possible on free, public data (so not planned)

A forward-looking risk model (this is history, not a forecast); ringgit-hedged share classes or hedged benchmarks
beyond the funds that exist (AGGU is hedged to the dollar); index-provider benchmark levels (MSCI, Bloomberg): the
benchmark is built from funds that track them; live or intraday prices.

## Order and size

One step per commit; run the design check before each push, `port-check.js` from Step 2 on, and the two vault checks in Step 3.

| Step | What | Decision | Risk | Size |
|---|---|---|---|---|
| 1 | Fund data: weekly closes with dividends for about 52 funds | 2 | low: one new isolated module | small |
| 2 | The maths and its check | none | low | small |
| 3 | Portfolio sub-tab: saved portfolios, benchmark, tracking error | 1, 3, 4 | medium: vault item, replaces two cards | large |
| 4 | Add a fund: what-if, weight curve, ranked table | 5 | low | medium |
| 5 | Guardrails and notes | none | none | small |

## Do not change

- The vault's encryption, passphrase handling and sync; never delete stored private data (`sd-model-v1` stays).
- The Watchlist and `tickers.json` (prices for browsing); the allocator reads `funds.json`.
- The Evidence board, In ringgit and Drawdowns sub-tabs; signal and structured-products wording.

## Decisions for the owner (defaults in brackets)

1. **Where it lives.** [Two sub-tabs on Allocation, "Portfolio" and "Add a fund", replacing "Model portfolio".]
   Alternative: its own page in the menu ("Portfolios"); the menu's scroll limit would rise from 200px to about 230px.
2. **The fund list.** [The 52 funds above, plus anything in `watchlist.txt`.] Tell me any fund you want in from day one.
3. **The standard benchmark's bond half.** [Global aggregate bonds hedged to the dollar (AGGU), history from late 2017.]
   Alternative: US aggregate bonds (AGG), history from 2008. Either way every benchmark stays editable.
4. **Saved portfolios.** [Several, each with a name and its own benchmark, kept in the private vault.]
   Alternative: one portfolio only, as today.
5. **The ranked table** ("What 10% of each fund would do"). [Include it, worded as arithmetic, never a recommendation.]
   Alternative: leave it out and keep only the one-fund what-if.
