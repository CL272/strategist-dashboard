# Design plan 6: a clearer portfolio workspace, and many more building blocks

**Status (27 Nov 2026): approved by the owner ("go with the defaults": all five decisions as recommended, see the end).
Build Steps 1 to 5 in order, one step per commit.**
Written after the owner said of Allocation → Portfolio: "can you plan to make it more easier to add and see the changes?
It's abit confusing now", and asked for "more country building blocks, make it as extensive as possible, as well as
enhanced of the region building blocks. Eg: MSCI USA, SP500, Europe, Japan, MSCI asia ex Japan, MSCI EM and etc".
`CLAUDE.md` rules still apply; where a step changes a standing rule it says so.

**Reference mockup** (a static page on the real stylesheet; serve the repository root and open it):

| Mockup | Shows |
|---|---|
| `design/portfolio2.html` | The one Portfolio sub-tab with two unsaved changes: the bar as a sentence, tiles with before → after, the change bar, Holdings, and the right-hand card on its three tabs (Add a holding · Adjust a weight · Benchmark); then the chart and the sources table showing both states. Every figure is real, from the planning prototype |

`design/redesign6.css` holds the new classes, already named `po-*`. When a step is built, move its rules into
`docs/style.css` unchanged (the "mock-only" block stays behind).

## What is confusing today (found on the live page, 26 Nov 2026)

1. **Adding a fund does nothing you can see.** The search box under the holdings adds the fund at 0%. No figure
   moves, and nothing says "now give it a weight".
2. **Typing a weight breaks the total.** Give the new fund 10 and the total reads 110; the card then says "scaled to
   100%" and every figure is for weights other than the ones on screen.
3. **Every edit overwrites the portfolio at once.** The tiles simply change. There is no before and after, no undo, and
   no way to try something and walk away.
4. **The real "what if" is on another sub-tab** ("Add a fund"), with its own portfolio picker, slider and "paid for by"
   choice, and it needs "Apply" to come back. Two places to add a fund, behaving differently.
5. **Funds are listed by brand** ("iShares MSCI ACWI"). The search shows eight matches and cannot be browsed, so a
   block is only found by someone who already knows its name.
6. **The benchmark takes half of the first row**, though it is set once and rarely touched.

## The idea: one workspace, changes shown before they are saved

- **One sub-tab.** "Add a fund" goes; everything it did happens on Portfolio.
- **The bar reads as a sentence**: Portfolio [Malaysian balanced] against [60/40 world] in [MYR] over [3Y].
- **Changing holdings makes a draft.** Add, remove or re-weight and a **change bar** appears: "2 changes, not saved yet",
  each change in words, with Undo · Discard · Save as new… · Save. Nothing is saved until Save.
- **Before → after everywhere while a draft exists**: the five tiles ("5.5% → 4.9%"), each holding's weight ("was 35.0"),
  the chart (as saved, dashed, against with your changes), the share of tracking error per holding.
- **The total always stays 100%.** A weight that goes up is taken from the other holdings in proportion, or from cash
  first (one choice under the table); a weight that goes down is given back the same way. A locked holding is left alone.
- **One right-hand card, three tabs**: **Add a holding** (browse by group or search by country, index or ticker; every
  row shows what the tracking error would be with that block), **Adjust a weight** (slider, curve and target for one
  holding), **Benchmark** (presets, a two-part mix of any two blocks, one block, or custom rows).

## What the planning checks found (26 Nov 2026)

1. **Yahoo carries nearly everything.** 181 candidate funds were read with the pipeline's own reader (`funds.fetch_fund`,
   160 seconds): 167 have prices, none of the US-listed ones is stale, thin or short. 14 have no data: delisted
   (`FM`, `GULF`, `PGAL`, `GXG`, `EGPT`, `NGE`, `PAK`) or not on Yahoo under that ticker (`IMEA.L`, `ICHN.L`, `XPQP.L`,
   `XBAS.L`, `FMETF.PS`, `0822EA.KL`, `IEGA.L`).
2. **133 are kept** (the list is below), which makes 183 funds, 5 indices and cash with the 50 already there, plus
   whatever is in `watchlist.txt`. The other 34 with prices are left out on purpose: a second fund on an index or idea
   already covered from the same place of listing (`IVV`, `VOO`, `IEFA`, `IEMG`, `VXUS`, `VEU`, `IEV`, `GMF`, `EWX`, `BKF`,
   `EMQQ`, `EUSA`, `IWB`, `VUG`, `VTV`, `NORW`, `CNYA`, `EPI`, `VUAA.L`, `CSJP.L`, `VJPA.L`, `VAPU.L`, `IDKO.L`, `XMTD.L`, `XIDD.L`,
   `ISF.L`, `S27.SI`, `VAS.AX`, `QL3.SI`), three that Yahoo holds under three years of history for (`2828.HK`, `2823.HK`,
   `2821.HK`), and `QK9.SI`, whose ticker turned out to be another fund (`0827EA.KL` also was: it is kept under its true
   name, the Dow Jones US Titans 50). Any of them can still be added through `watchlist.txt`.
3. **Every one converts and computes.** All 185 funds gave a figure against the default portfolio in ringgit (currencies:
   USD 109, MYR 5, GBP 4, HKD 4, EUR 2, JPY 2 and one each of KRW, TWD, INR, AUD, THB, IDR, SGD; all have an exchange rate
   on the dashboard). Working out "what 10% of each block does" for all 185 took 0.2 seconds in the browser.
4. **Size.** `funds.json` grows from 0.6 MB to 2.3 MB (0.58 MB as served, compressed); it is still loaded only when the
   Portfolio sub-tab opens. The daily read grows from about one minute to about three.
5. **Thin trading.** Only the four new Bursa funds trip the tag (`0821EA.KL` 0.23, `0824EA.KL` 0.22, `0823EA.KL` 0.17,
   `0825EA.KL` 0.13), as the two Bursa funds already listed do.
6. **Where a fund is listed changes the figure.** With 10% of MSCI USA added, the tracking error is 4.56% using the New
   York fund (`PBUS`) and 4.78% using the London one (`CSUS.L`): London and Asia close before New York, and weekly returns
   soften that but do not remove it. So every row names the place of listing, and the note says to compare like with like.
7. **The draft, in real figures** (default portfolio against 60/40 world, ringgit, three years): add 10% MSCI Japan
   from every other holding, then gold +3 points from cash: tracking error 5.50% → 4.92%, beta 0.55 → 0.68, volatility
   6.2% → 7.2%, return 5.5% → 6.5% a year, worst fall −9.0% → −10.2%. A target of 5%: 7.5% of MSCI Japan (5.00%).
   A target of 4% cannot be reached with MSCI Japan (lowest 4.75%, at 17.1%).

## The building blocks to add (all tested; label = what the block tracks, then the Yahoo ticker)

- **World** (1): MSCI ACWI ex USA `ACWX`.
- **Regions** (24): FTSE Developed ex US `VEA` · MSCI EAFE Small Cap `SCZ` · FTSE Emerging Markets `VWO` · MSCI Emerging
  Markets ex China `EMXC` · MSCI Emerging Markets Small Cap `EEMS` · MSCI Emerging Markets Asia `EEMA` · S&P Asia 50
  `AIA` · MSCI Pacific ex Japan `EPP` · FTSE Developed Asia Pacific `VPL` · FTSE Southeast Asia 40 `ASEA` · MSCI Europe
  IMI `IEUR` · FTSE Developed Europe `VGK` · MSCI Eurozone `EZU` · Euro Stoxx 50 `FEZ` · S&P Latin America 40 `ILF` ·
  Africa (MVIS GDP Africa) `AFK` · FTSE Emerging Markets (UCITS, Acc) `VFEA.L` · MSCI EM Asia (UCITS, Acc) `CEMA.L` ·
  MSCI AC Far East ex Japan (UCITS) `IDFF.L` · MSCI Pacific ex Japan (UCITS, Acc) `CPXJ.L` · FTSE Developed Europe
  (UCITS, Acc) `VEUA.L` · MSCI EMU (UCITS, Acc) `CEU1.L` · Euro Stoxx 50 (UCITS, Acc) `CSX5.L` · MSCI South East Asia
  Islamic Dividend (Bursa) `0825EA.KL`.
- **United States** (15): MSCI USA `PBUS` · CRSP US Total Market `VTI` · Dow Jones Industrial Average `DIA` · Russell
  2000 `IWM` · S&P MidCap 400 `MDY` · S&P SmallCap 600 `IJR` · S&P 500 Equal Weight `RSP` · Russell 1000 Growth `IWF` ·
  Russell 1000 Value `IWD` · MSCI USA Momentum `MTUM` · MSCI USA Quality `QUAL` · MSCI USA Minimum Volatility `USMV` ·
  FTSE High Dividend Yield `VYM` · MSCI USA (UCITS, Acc) `CSUS.L` · Dow Jones US Titans 50 (Bursa) `0827EA.KL`.
- **US sectors** (12): S&P 500 Technology `XLK` · S&P 500 Financials `XLF` · S&P 500 Health Care `XLV` · S&P 500 Energy
  `XLE` · S&P 500 Industrials `XLI` · S&P 500 Consumer Discretionary `XLY` · S&P 500 Consumer Staples `XLP` · S&P 500
  Utilities `XLU` · S&P 500 Materials `XLB` · S&P 500 Real Estate `XLRE` · S&P 500 Communication Services `XLC` · US
  semiconductors (NYSE Semiconductor) `SOXX`.
- **Asia Pacific** (39): MSCI Australia `EWA` · MSCI New Zealand `ENZL` · MSCI Hong Kong `EWH` · Japan, yen-hedged
  (WisdomTree) `DXJ` · FTSE China 50 `FXI` · CSI 300 (China A-shares) `ASHR` · China internet (CSI Overseas) `KWEB` ·
  MSCI India Small Cap `SMIN` · MSCI Indonesia `EIDO` · MSCI South Korea `EWY` · MSCI Philippines `EPHE` · MSCI Taiwan
  `EWT` · MSCI Thailand `THD` · Vietnam (MarketVector) `VNM` · MSCI Japan IMI (UCITS, Acc) `IJPA.L` · MSCI China A
  (UCITS, Acc) `CNYA.L` · MSCI China (UCITS) `HMCD.L` · MSCI India (UCITS, Acc) `NDIA.L` · MSCI Korea (UCITS, Acc)
  `CSKR.L` · MSCI Taiwan (UCITS) `IDTW.L` · MSCI Malaysia (UCITS) `XCS3.L` · MSCI Thailand (UCITS) `XCS4.L` · MSCI
  Indonesia (UCITS) `HIDD.L` · FTSE Vietnam (UCITS, swap) `XVTD.L` · Hang Seng Index (Tracker Fund) `2800.HK` · Hang
  Seng TECH `3033.HK` · CSI 300 (ChinaAMC, HK) `3188.HK` · TOPIX (Nomura) `1306.T` · Nikkei 225 (Nomura) `1321.T` ·
  KOSPI 200 (KODEX) `069500.KS` · FTSE TWSE Taiwan 50 (Yuanta) `0050.TW` · Nifty 50 (Nippon India) `NIFTYBEES.NS` ·
  S&P/ASX 200 (SPDR) `STW.AX` · SET50 (ThaiDEX) `TDEX.BK` · IDX30 (Premier ETF) `XIIT.JK` · Dow Jones Islamic Malaysia
  Titans 25 (Bursa) `0821EA.KL` · FTSE China 50 (Bursa) `0823EA.KL` · MSCI Malaysia Islamic Dividend (Bursa) `0824EA.KL`
  · Hang Seng TECH (Lion-OCBC) `HST.SI`.
- **Europe** (19): MSCI United Kingdom `EWU` · MSCI Germany `EWG` · MSCI France `EWQ` · MSCI Italy `EWI` · MSCI Spain
  `EWP` · MSCI Switzerland `EWL` · MSCI Netherlands `EWN` · MSCI Sweden `EWD` · MSCI Denmark `EDEN` · MSCI Finland
  `EFNL` · MSCI Norway `ENOR` · MSCI Belgium `EWK` · MSCI Austria `EWO` · MSCI Ireland `EIRL` · MSCI Poland `EPOL` ·
  MSCI Greece `GREK` · MSCI Turkey `TUR` · FTSE 100 (UCITS, Acc) `CUKX.L` · DAX (Xetra) `EXS1.DE`.
- **Americas, Middle East and Africa** (14): MSCI Canada `EWC` · MSCI Mexico `EWW` · MSCI Brazil `EWZ` · MSCI Chile
  `ECH` · MSCI Colombia `COLO` · MSCI Peru `EPU` · MSCI Argentina `ARGT` · MSCI South Africa `EZA` · MSCI Israel `EIS` ·
  MSCI Saudi Arabia `KSA` · MSCI UAE `UAE` · MSCI Qatar `QAT` · MSCI Kuwait `KWT` · MSCI Brazil (UCITS) `IDBZ.L`.
- **Bonds** (9): Global treasuries ex US (Bloomberg) `BWX` · International treasuries (FTSE) `IGOV` · EM local-currency
  government bonds `EMLC` · EM corporate bonds (USD) `CEMB` · EM government bonds (USD, Vanguard) `VWOB` · UK gilts
  (UCITS) `IGLT.L` · China onshore bonds (VanEck) `CBON` · Asia USD credit (iShares, SGX) `N6M.SI` · China government
  bonds (iShares, HK) `2829.HK`.

Kept as they are: the 50 funds already listed (22 equity, 21 bond, 2 cash-like, 2 gold, 3 property), the five indices
(`PO_INDEX`) and cash. Groups after the change: World 7 · Regions 28 · United States 20 · US sectors 12 · Asia Pacific 49 ·
Europe 19 · Americas, Middle East and Africa 14 · Bonds 30 · Gold, cash and property 9 · Other (Bitcoin, the watchlist).

## Step 1. The universe (`pipeline/funds.py` → `funds.json`)

Files: `pipeline/funds.py`, `docs/port.js` (`poBlocks`, labels), `tools/port-check.js` (a fixture for the new fields).

- `FUNDS` becomes one row per block: symbol, **what it tracks** (the label shown first), asset class, **group** (one of
  the ten above), and optional search words (a country's other names: "UK Britain", "Korea South Korea", "Holland").
  The 50 existing rows are relabelled the same way ("iShares MSCI ACWI" becomes "MSCI ACWI"); ids do not change, so
  saved portfolios are untouched.
- Written to each fund in `funds.json`: `short` (what it tracks), `grp`, `alias`, and `place`, worked out from the
  ticker (no suffix New York · `.L` London (UCITS) · `.DE` Frankfurt · `.HK` Hong Kong · `.SI` Singapore · `.KL` Bursa ·
  `.T` Tokyo · `.KS` Seoul · `.TW` Taipei · `.NS` Mumbai · `.AX` Sydney · `.BK` Bangkok · `.JK` Jakarta). The manager and
  fund name stay in `name` (from Yahoo), shown second.
- The module refuses to run with a duplicate symbol or an unknown group. `watchlist.txt` tickers go to "Other".
- `PO_INDEX` rows get a group too (S&P 500 → United States; KLCI, STI → Asia Pacific; gold → Gold, cash and property).
- Rule for later additions: one fund per index per place of listing; at least three years of prices on Yahoo.

Acceptance: 183 listed funds present (or named in `_meta.failed` with their old history kept); `funds.json` under 3 MB;
the acceptance checks of Design plan 4, Step 1 still hold for `CSPX.L`, `AGGU.L` and `IEF`; one-year returns of three new
funds (`EWT`, `VGK`, `PBUS`) within 0.5 point of the issuers' published NAV returns; Data health lists the new weekly
series; `node tools/port-check.js` passes.

## Step 2. The maths of changing one weight (`docs/port-model.js`, `tools/port-check.js`)

- `pmSet(w, k, to, how, locked)` → new weights in percent, summing to 100. `w` is scaled to 100 first. The gap between
  `to` and `k`'s weight is taken from (or given to) the holdings that are not `k` and not in `locked`: `how` = `'all'` in
  proportion to their weights; `'cash'` = the holding `CASH` first (created when weight is given back and there is none),
  then the rest in proportion. If the others cannot supply the whole rise, `k` gets what there is. If nothing else is
  unlocked, a fall goes to cash. Weights are rounded to 0.01 and the rounding remainder goes to the largest unlocked holding.
- `pmAdd`, `pmCurve` and `pmTarget` stay; `pmCurve` and `pmTarget` accept `locked` and use `pmSet`, so the curve and the
  target follow the same rule as the table.
- Checks added to `tools/port-check.js`: the total is 100 after any change; a locked holding never moves; `pmSet` to the
  current weight changes nothing; raising by x with `'all'` equals `pmAdd(…, x, 'all')`; `'cash'` uses cash first and
  never takes it below zero; a fall with everything else locked lands in cash; removing (to 0) then re-adding at the old
  weight with `'all'` does not restore the old mix (so Undo must restore the stored state, not replay the inverse).

Acceptance: `node tools/port-check.js` passes with the new checks, with and without data.

## Step 3. The workspace: draft, change bar, before → after (`docs/port.js`, `docs/style.css`, `docs/vault.js` only if needed)

- **Storage** (`sd-ports-v1`, through `pstore()` as now): a portfolio may carry `draft: { rows, steps: [text] }` and
  `locks: [ids]`. Holdings edits write the draft; **Save** copies `draft.rows` to `rows` and drops the draft; **Save as
  new…** makes a new portfolio from the draft and drops it from the old one; **Discard** drops it. The draft survives a
  reload and syncs with the vault. **Undo** steps back through this session's changes (a stack in memory; after a reload
  only Discard is offered). Benchmark, currency and window are settings: they apply at once, as today.
- **A portfolio whose saved weights do not add to 100** (amounts typed under the old page) is shown scaled to 100; the
  stored numbers change only when a draft is saved. The "scaled to 100%" line goes.
- **The bar** (`.po-sentence`): Portfolio [picker; a dot marks one with unsaved changes] against [benchmark: the presets,
  then "One block…" and "Custom…", which open the Benchmark tab] in [currency] over [window]; New · Duplicate · Rename ·
  Delete on the right. Duplicate copies what is saved.
- **The change bar** (`.po-changes`, sticky under the page bar, only while a draft exists): the count, one chip per step
  in words ("＋ MSCI Japan 10%, taken from every other holding" · "Gold +3 points, taken from cash" · "− US Treasuries
  7–10 years"), then Undo · Discard · Save as new… · Save. Consecutive changes to one holding count as one step.
- **Holdings card** (key `idea_model`): what it tracks with fund, ticker and currency beneath; the weight with − and +
  (one point a press; typing takes one decimal; Enter commits, Esc cancels); "was 35.0" when it differs from the saved
  weight, "added" on a new row (tinted, tagged "new"); benchmark weight; active weight; lock; remove. A removed
  holding stays as a struck-through row with "Put back" until the draft is saved. Under the table: "When I change a
  weight, take it from [all other holdings, in proportion | cash first]" (kept per portfolio) and "＋ Add a holding",
  which opens the first tab of the right-hand card. The note states the effect in one sentence.
- **Before → after**: `poCompute` returns the saved and the draft state on the same weeks (every holding of either and
  of the benchmark, as `poWhatIf` did). Tiles show "old → new" when a figure moves (`.po-was`); "Portfolio vs benchmark"
  draws the saved portfolio dashed beside the draft; "Where the tracking error comes from" shows each share as
  old → new; the stress test reads the draft and says so in its count. If a new holding's history shortens the window,
  the note says by how much and names it.

Acceptance: adding a holding moves the tiles at once and shows the change bar; the total is 100.0 after every edit;
Discard returns every figure to the saved one; Save then reload shows the same weights and no change bar; a draft
survives a reload; Undo restores the previous state exactly; Save as new leaves the original as saved; a locked vault
shows the lock; `vault-check.js` and `vault-sync-check.js` pass (the record gained two fields); the sub-tab is within
the height budget at 1440 and 1280 and passes at 390px.

## Step 4. The right-hand card, and one sub-tab instead of two

- **Card "Change the portfolio"** (key `po_side`, replacing `po_bench`, `po_whatif`, `po_curve`, `po_rank`), tabs `.po-tabs`:
  - **Add a holding**: a search box that matches what a block tracks, the fund's name, the ticker, the group and the
    search words; group chips with counts; "Add at [10]%"; a table of at most 10 rows at rest ("Show all n"): what it
    tracks, fund · ticker · currency · place (tags: "thinly traded", "index, no dividends", "short history"), the tracking
    error with that weight added and its change, and "＋ Add" (or "in the portfolio"). Sorted A to Z; a second choice
    sorts by the effect on tracking error. Add makes a draft step with the rule under the Holdings table.
  - **Adjust a weight**: one holding (the last one touched); the slider (0 to 50%, to 100% when the answer lies beyond);
    the curve of tracking error by that holding's weight with "now", "lowest" and the target rule; the target row and
    its "Use" button. Moving the slider or pressing Use changes the draft.
  - **Benchmark**: the six presets, "One block…" (any block alone), a two-part mix (a percentage and a block on each
    side; the second percentage follows the first) and "Custom…" (the editable rows of today); the mix by asset class.
    A benchmark change applies at once.
- **Sub-tabs**: Allocation is Evidence board · In ringgit · Drawdowns · Portfolio. `SUB_ALIAS.alloc` maps "Add a fund" and
  "Model portfolio" to "Portfolio"; the old order goes into `OLD_SUBS` so `#tab=alloc&sub=4` opens Portfolio.
- **Words**: the card describes ("tracking error with 10%"); the design check's advice-word scan covers it.

Acceptance: searching "japan", "msci em", "uk", "0820" and "s&p" each finds the expected blocks; the figure on a picker
row equals the Tracking error tile after adding that block at that weight; the target's "Use" gives the quoted figure;
"One block… MSCI Asia ex Japan" makes that the benchmark and the tiles follow; old links to "Add a fund" open Portfolio;
no table shows more than 16 rows at rest; design check passes.

## Step 5. Guardrails and notes

- `tools/design-check.js`: the advice-word scan drops "Add a fund"; `ALLOW` only if a rule needs it.
- `CLAUDE.md`: the workspace rules (draft and Save, the total stays 100, `pmSet` and locks, one card with three tabs,
  labels say what a block tracks, one fund per index per place); the universe's groups; this plan as built.
- `design/README.md`; this plan's status and an "As built" list.

## Later, if wanted (not in this plan's steps)

1. **Compare two saved portfolios** side by side (the before → after machinery already does it for a draft).
2. **Mix by region**, which needs each fund's country weights (issuer files; not on Yahoo).
3. **Currency-hedged twins** where they exist (a few more London share classes).

## Not possible on free, public data (so not planned)

Index levels from MSCI, FTSE or S&P themselves (the blocks are funds that track them, so each carries its fees and its
place of listing); funds' holdings and country weights in one feed; unit trusts sold in Malaysia (no public price history).

## Order and size

One step per commit; design check before each push; `port-check.js` from Step 2; the two vault checks in Step 3.

| Step | What | Decision | Risk | Size |
|---|---|---|---|---|
| 1 | 133 more building blocks, relabelled and grouped | 4, 5 | low: the same reader, more rows | medium |
| 2 | `pmSet`: change one weight, total stays 100, locks | 3 | low | small |
| 3 | Draft, change bar, Holdings, before → after | 2 | medium: replaces how edits are saved | large |
| 4 | The right-hand card; "Add a fund" folded in | 1 | medium: three cards become one | large |
| 5 | Guardrails and notes | none | none | small |

## Do not change

- The vault's encryption, passphrase handling and sync; `sd-model-v1` and the other stored items.
- The method (weekly returns, both sides rebalanced, tracking error and shares as defined in Design plan 4).
- Evidence board, In ringgit, Drawdowns; fund ids (saved portfolios must open as they are).

## Decisions (answered by the owner, 27 Nov 2026: "go with the defaults")

Every default in brackets below is approved. The alternatives were not chosen: do not build them.

1. **One workspace.** [Fold "Add a fund" into Portfolio: one sub-tab, one right-hand card with three tabs.]
   **Approved as the default.**
2. **Changes are a draft until you press Save.** [Yes: with the change bar, Undo, Discard and Save as new.]
   **Approved as the default.**
3. **When a weight changes, where the difference comes from.** [All other holdings in proportion, with "cash first" as
   the other choice under the table, and a lock per holding.] **Approved as the default.**
4. **How many blocks.** [All 133 tested: world and regions 25, United States 15, US sectors 12, countries 72, bonds 9.]
   **Approved as the default.**
5. **Names.** [Show what a block tracks first ("MSCI Japan"), the fund, ticker, currency and place second, for the
   existing 50 too.] **Approved as the default.**
