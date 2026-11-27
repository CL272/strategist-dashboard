# Strategist Dashboard: notes for future changes

The owner cannot edit code; every change is made here and published by GitHub Actions to GitHub Pages.

**Open design work:** `DESIGN_PLAN_6.md` (approved by the owner 27 Nov 2026, all five decisions as recommended; Steps 1 to 3 built, Step 4 next): one clearer
Portfolio workspace on Allocation (changes are a draft with before → after and Save; "Add a fund" folded in; a right-hand
card to add a holding, adjust a weight or set the benchmark) and 133 more building blocks (regions, countries, US sectors,
bonds), tested on Yahoo. Mockup: `design/portfolio2.html`. Build Steps 1 to 5 in order, one step per commit; update this note as steps land.

**Design plan 5** (`DESIGN_PLAN_5.md`, approved and built 26 Nov 2026, Steps 1 to 5, one commit each): China → Property from the
statistics bureau's monthly releases (prices by city tier, sales, building), University of Michigan sentiment by party, the
Chicago Fed's weekly retail sales, and a reconstructed "excess liquidity" card. Mockup: `design/plan5.html` (not published).
Its rules are folded into the list below.

**Design plan 4** (`DESIGN_PLAN_4.md`, approved and built 25 Nov 2026, Steps 1 to 5, one commit each): a portfolio
allocator on Allocation (Portfolio and Add a fund: saved portfolios, a benchmark you choose, tracking error, the "Add a fund"
what-if), with weekly fund data in `funds.json`. Mockup: `design/portfolio.html` (not published). Its rules are folded into
the list below.

**Design plan 3** (`DESIGN_PLAN_3.md`, approved and built 25 Nov 2026, Steps 1 to 9, one commit each): the menu as a tree,
the Idea log and Notebook removed, the Allocation page (Evidence board, In ringgit, Drawdowns, Model portfolio, which Design plan 4 replaced), US profits,
Malaysia flows and finances, and the MOVE-spike study. Mockups: `design/menu.html`, `design/allocation.html` (not
published). Its rules are folded into the list below.

**Design plan 2** (`DESIGN_PLAN_2.md`, approved and built 25 Nov 2026): Strategist View, Weekly brief and click-through;
the reference mockups stay in `design/` (not published). Its rules are folded into the list below.

## Layout and design rules (the owner's standing request)

Keep the dashboard clean and compact; nobody should have to scroll a long way.

- **Every page uses sub-tabs** (`SUBTABS` in `docs/app.js`), one topic per sub-tab. A new page or section goes into
  its own sub-tab rather than being appended below existing content.
- **Height budget: about 2,300 px per sub-tab** at 1440×900 (roughly 2.5 screens). Measure after every change
  (load each tab and sub-tab, read `document.documentElement.scrollHeight`); split a sub-tab or pair cards if over.
- **Pair half-width cards** side by side; use `wide` only for charts that need it, and avoid `tall`.
- **Long lists are capped**: a table shows at most 16 rows at rest. Ranked tables use `capRows(tb, key)` ("Show all");
  lists people browse use view chips (Markets → Performance, Watchlist). Never dump hundreds of rows open.
- **Tiles: at most 5 per sub-tab, one slim strip.** Pick them per sub-tab in `TILE_SETS` (label prefixes); `fitTiles` runs
  after every render, falls back to the first five, and puts the full change and date in each tile's tooltip.
- **Page frame (redesign, Nov 2026):** one sticky header row (`.pagebar`: title and section left; the greeting only on the
  Strategist View). The page-wide date bar was removed (owner, 19 Nov 2026): each card's range pill sets its dates, cards
  without their own `defaultRange` use 3Y; then the sub-tab bar (underlined text on one line, scrolls sideways, never
  wraps); then tiles; then cards. Flat cards (no shadows, hairline borders). Colour belongs to data; navy marks
  "selected". The menu is a light panel (`docs/ui.js`: foldable groups, up to five pinned pages); on a desktop only the page list scrolls
  (brand, search and the foot stay put); groups: Overview · Macro · Regions · Markets & themes; Data health opens from the foot.
  Since Design plan 3 the menu is a tree (`nav.tabs.nav3`): each group is a `.nav-sec` with a header button (`.nav-head`:
  arrow, name, page count from the markup) and its pages on a rail (`.nav-items`); a region's countries sit in a nested
  `.nav-kids` rail. A folded group still shows the open page on its rail. Pins are the first section. Page buttons keep
  `role="tab"` and `data-tab`; select them with `.tabs button[data-tab]` (the group headers are buttons too). The design
  check fails if the list scrolls more than 200px at 1440×900 with every group open and the region trees closed.
- **Strategist View → Today** (Design plan 2, 25 Nov 2026): the week in one sentence (`weekLine`, shared with the brief)
  above the five tiles; then two rows of three equal cards (What moved · What changed · Signals; Stress gauges · Week ahead ·
  Headlines) written as quiet lists (`.rows`); Talking points fold into a bar at the foot. At most 1,350px at 1440 and 1280.
- **Weekly brief** (Design plan 2): masthead, the same `weekLine`, three takeaways, five tiles, a 25-row scoreboard (`WK_ROWS`,
  numbers in colour, a faint tint only on a 2σ week) beside Asia focus, unusual moves, signals and the week ahead. At most
  1,500px on screen and exactly one A4 page in print (the design check prints it).
- **Say each thing once on a page**: a fact lives in one card; other places link to it (What changed leaves market moves to
  What moved; the stress composite is in the tile, the gauges in the card).
- **No lone half-width card** (`layoutLone` widens it for that view; design check `lone`), and every sub-tab ends with a
  pager (previous · next; keys `[` and `]`).
- **Sources and dates sit under every card** (owner's request, 19 Nov 2026): one muted line, source on the left (click to
  show in full), "Data to …" on the right. `setSource` sets the source; the date is worked out after each render (`showAsOf`)
  from the series the card read (`idxLE`/`pts` record them), one date per frequency, with each series listed in the date's
  tooltip. Cards drawn from a data file rather than the series store get a date from `ASOF_FILES`; a render can also call
  `setAsOf(c, t)`. A card drawn outside `c.render` must call `showAsOf` itself (see `renderMktCharts`). Both go into CSV downloads.
  Text columns in tables use class `l` so they
  wrap; numbers never wrap. On phones the first table column stays put while the rest scrolls.
- **Card headers stay quiet**: toggles (`seg`) are visible; everything else goes in the "⋯" menu (`c.menuEl`). A card
  that needs two toggles (a "vs" picker plus "As measured / Lead") passes `seg2`; both sit in one `.tool-row` group, and
  `ldLeadLabel` writes the measured months on the lead button ("Best fit +Nm" when the link fails the test). The
  date range is the header pill (`range: false` for cards that follow the page range). Notes lead with one takeaway
  sentence; the explanation folds behind "How to read" automatically (`setNote`). Keep titles under ~32 characters.
- **Legend choices persist** (owner's request, 25 Nov 2026): a line switched off in a legend stays off when the card redraws
  for a new range or toggle (`keepLegend`, wrapped round every chart's `setOption`).
- **Y-axis by hand, back in one click**: dragging the axis numbers (or Ctrl + wheel over them; a plain wheel scrolls the
  page) sets `c.yRange`; the header then shows "↕ Auto" (`yAutoReset`), and a new date range, toggle or layout clears it.
- **Axis labels never repeat a rounded number**: when an axis's ticks fall between whole numbers, `valAxis` and
  `fixAxisDecimals` relabel that whole axis with 2 decimals (owner's request). Keep axis formatters on `fmtNum`.
  A series moved forward to show a lead carries `_src` (the unshifted series) so its card's date stays true.
- **Charts: every line in colour, up to ten** (owner's request, 19 Nov 2026; readability over the house palette). `drawLines`
  greys only lines beyond ten (home markets first) and shortens legend names; give series full names and let it shorten them.
  Slots `--s1`…`--s10` in `style.css`. Asia-Pacific economies keep one colour on every chart (`COUNTRY_TOK`; `seriesCard`
  uses it when every id has a country prefix). The Playbook's faint past-episode fan is deliberate and stays grey.
- **Grouped sub-tabs**: a third element in a `SUBTABS` entry is its group label (see `cbwatch`, `us`, `regime`). A page
  with more than eight sub-tabs, all grouped, gets a row of group pills above the bar and shows only the open group's
  sub-tabs (`twoLevel`; US: Markets · Economy, Regime: Regime · Leading · Surveys); no bar may hide tabs off-screen on a
  desktop (design check `bar-hidden`). US merges (`SUB_MERGES`): Rates & dollar, Growth & recession, Inflation (with the
  pipeline); old labels work through `SUB_ALIAS`.
- **Region and country pages hold everything about one place, split by asset class.** Sub-tabs in this order, leaving
  out any with no data: **Equities · Rates & bonds · Currency · Economy** (a page may split one in two to stay within the
  height budget, e.g. Malaysia "Sectors", US "Sectors & styles", the US Economy group). On the smaller pages (owner's
  approval, 25 Nov 2026: Germany, France, Italy, Spain, UK, China, Korea, Taiwan, India, Japan, Europe, Australia) the
  first three merge into one **Markets** sub-tab (Singapore: "Rates & currency"), keeping that order; `mergeMarkets`
  (`MARKETS_MERGE`) does it at start-up, each card there shows its asset class above the title (`CARD_CLASS`,
  `labelAssetCards`), the "See also" rows join (`mergeSeeAlso`), and old labels still work in `goSub` and in links
  (`SUB_ALIAS`, `subIndexOf`; URLs carry `v=4`, older ones are mapped). Keep writing new cards into the asset-class
  lists in `SUBTABS`; the merge places them. A sub-tab should hold at least three cards.
- **Markets-group pages (Markets, Fixed Income, Valuation, Positioning & Vol, Correlation) are cross-market tools**:
  tables and charts that compare places or asset classes. Anything about a single place lives on that place's page.
- **One home per card.** A card is never shown in two places. Where a reader would look for it elsewhere, add a
  "See also" row at the top of that sub-tab (`seeAlso(id, grid, [[label, tab, sub], …])` in `buildSeeAlso`, then list
  `'#id'` first in the sub-tab). Theme pages stay whole (AI → Chip cycle keeps its Korea and Malaysia cards).
- **Sidebar tree**: country pages are child buttons (`data-parent`) under their region (Asia ex-Japan: `my`, `sg`,
  `cn`, `kr`, `tw`, `in`; Europe: `de`, `fr`, `it`, `es`, `uk`, built from `EUC`). A new page id must be registered in `index.html` (button and panel),
  `TAB_TITLES`, the `renderTab` map, the `init` validation array, `SUBTABS`, `TILE_SETS`, and `loadTickers` if it uses
  tickers. If a page's sub-tab order changes, add its old order to `OLD_SUBS` so bookmarks still land correctly.
- Each Equities sub-tab starts with the "Signals for this market" strip (`SIG_TARGETS`); `eqCard` and `fxCard` build
  the standard equity and currency views.
- **Signals show both directions alike**: bullish and bearish (sell-side) rules are tested the same way; label them with
  `sigDirLab`/`sigSide` (a rising yield reads as bearish for bonds) and state bearish odds as "down X%". `signals.py` writes
  `off_since` (first month off); rules with a record that ended in the last three months are the exit prompts in
  "Signals that just ended". The Strategist View shows them in two columns (`ov_signals`, sell-side first).
  Signals are research prompts, never recommendations.
- **Structured products** live in `docs/sp.js` (page), `docs/sp-model.js` (pricing maths, shared with the Monte Carlo worker
  `docs/sp-worker.js`) and `pipeline/structured.py` (data). Generic structure names only, never issuer or product brand
  names; every figure says "indicative … not a quote". The upfront commission (`comm`, owner's request 20 Nov 2026) is applied
  after pricing (`spWithComm`): the client pays 100 and only 100 − comm buys the note, so the note's coupon and participation
  stay as priced while the client's yield, break-even, protection, payoff, back-test and "Worth today" are per 100 paid. Run `node tools/sp-check.js` after any change to the model or the
  surfaces: it checks identities and listed put prices (within 15%) and must pass before pushing. The owner's notes stay
  in the private vault (`sd-notes-v1`), never in the repository.
- **Later packages** (Income menu, Playbook, earnings, model stress, credit cycle, gold, country funds) live in
  `docs/more.js`. Pages whose render function lists its own cards (Fixed Income, Stress, Markets) also render the keys
  in `EXTRA_RENDER`; add new cards there.
- **Leading indicators** live in `docs/leads.js` (page code, loaded after `more.js`) and `pipeline/leads.py` (`leads.json`:
  supply chains, rents, OECD breadth and money, the Malaysia pulse, and derived series such as orders minus inventories,
  the cycle baskets, canary ratios, the Asian pulse and the China credit impulse). One registry, `LB_ROWS`, drives the
  Leading board, its tiles, breadth and the Strategist View / Weekly brief line: add a lead there in one line.
  **Every lead shown carries its measured lead or the word "context"**: figures come live from `ldBestLead` (the
  `leadStats` rule searched over 2 to 18 months, plus at least 12 years of overlap); never type a lead into a note.
  Add publication delays for new series to `PUB_LAG` (app.js) and `lag_of` (signals.py). Tiles for app.js pages are added
  through `EXTRA_HOOKS` (renderTab calls them before `fitTiles`). Old links: hashes carry `v=3`; `SUB_PREV` maps older ones.
- **Household saving rates** (owner's request, 20 Nov 2026) come from `pipeline/leads.py` (`savings_oecd`: OECD quarterly
  GROSS rate `SAVQ_*` and annual NET rate `SAVA_*` (China: the OECD annual rate only; the bureau's quarterly figure came from
  its database, which refuses cloud servers, and was removed in Design plan 5); `savings_japan`: OECD quarterly sector accounts, households, NET rate
  `SAVQN_JPN` from 1994, kept apart from the gross `SAVQ_*`; `savings_ea`: ECB quarterly sector accounts, euro area 21,
  gross rate `SAVQ_EA` from 1999, same definition as the OECD gross rates). Page code is in `docs/leads.js` (`buildSavings`): Regime & Leading →
  Household saving (table, quarterly, annual) plus one card on the US, Europe, UK, Japan, Korea and China pages (Australia's
  is in au.js). Gross and net rates differ by several points: never put them on one axis as if comparable. Malaysia,
  Singapore, Taiwan, Indonesia and India publish no household rate.
- **Margin debt** (owner's request, 22 Nov 2026): US → Equities, "Margin debt vs money supply" (`renderUsMargin`), as a
  share of M2 and of currency in circulation. "FINRA monthly" (default) reads FINRA's margin statistics file in
  `pipeline/leads.py` (`finra_margin`: `FINRA_DEBIT`, free credit balances; from Jan 1997); "Fed quarterly" uses the
  Financial Accounts on FRED (`MARGIN_Z1`). FINRA updates the same .xlsx address in place; the page link is read first.
- **After VIX spikes** (owner's request, 23 Nov 2026): Positioning & Vol → After VIX spikes (`docs/leads.js`, end of file;
  card "After a volatility spike" since Design plan 3: MOVE triggers 120/140/160 from Nov 2002, a "1M before" column for
  every trigger, UST 7–10Y (IEF) in the picker, a third quick pick, and "MOVE vs the S&P 500", the rolling 1-year
  correlation of weekly changes; all-days medians cover the trigger series' own years; fewer than 10 episodes says "thin").
  `pipeline/events.py` writes `events.json` (VIX from FRED VIXCLS since 1990 plus Yahoo's latest days; daily closes since
  1990 for S&P 500, Nasdaq 100, Nikkei, Hang Seng, STI, KLCI), loaded only when the card opens (`loadEvents`). An episode
  = first close above the level after 63 trading days without one; returns at 1, 21, 63, 126, 252 trading days, against all days. The "When" menu also has curve triggers (VIX 3M ÷ VIX < 1 / 0.95 / 0.90, from 2006);
  two quick-pick buttons above the table switch between VIX above 35 and the inverted curve.
  The margin-debt rules (`margin_record`, `margin_surge`) are in `signals.py` (Extremes); FINRA series lag one month.
- **Malaysian Treasury bills** (owner's request, 23 Nov 2026): `pipeline/cbwatch.py` reads Bank Negara's API
  `gov-sec-yield?date=` ("short-terms_bills", from Jan 2019) into `MY_MTB_3M/6M/12M`, up to 200 days per full run (recent
  days, then a weekly sample, then the rest; holidays remembered in `no_trading`). Central banks → BNM's spread card adds
  the 3M bill − OPR and its premium in the three months after the last OPR move (`billPremium`).
  The same call carries the **MGS benchmark closes** (`MY_MGS_3Y/5Y/7Y/10Y/15Y/20Y/30Y`; "0.00" = not traded, dropped;
  no 2Y benchmark exists). Days read before MGS were added are read again (four calls at a time, 600 per full run).
  Malaysia → Rates & bonds: "MGS yields" (`my_mgs`) and "Rate gap vs USD/MYR" (`my_gap`: US 3Y − MGS 3Y, 10Y − MGS 10Y,
  "2Y (monthly)" = US 2Y at month-end − the bulletin's MGS 2Y (`MY_MGS_2Y_M`), or US 2Y − OPR, with the level correlation
  over the shown range in the note).
- **Allocation** (Design plan 3, `docs/alloc.js`, loaded after au.js): Evidence board · In ringgit · Drawdowns · Portfolio · Add a fund.
  The **Evidence board** is 13 assets × 6 pillars (cycle, valuation, trend, sentiment, policy & liquidity, signals), one mark
  per cell (▲ ● ▼ –) from one registry, `AL_ROWS`; the rules are printed from `AL_RULES` under the board (change both
  together). Every mark reads a card that is already on the dashboard (`valRows`, `stretch`, `trendStats`, `cbStats`, `fedRow`,
  `posStats`, the signal ideas, the regime returns) and links to it (`go`). It is a count: no score, weight or rank. Wording is
  fixed (evidence, for, against, tally); never buy, sell, overweight or recommend: the design check fails on those words.
  **In ringgit**: own-currency return × currency effect = ringgit return (`rgSplit`); hedging cost = ringgit 3M interbank −
  US 3M bill (an estimate, not a quote; from Dec 2023). **Drawdowns**: `events.json` histories since 1990 are spliced in
  front of the dashboard series (`ddSer`). The stress test (`idea_stress`) moved here from the Idea log and sits on Portfolio.
- **Portfolio allocator** (Design plan 4): Allocation → Portfolio and Add a fund. Data: `pipeline/funds.py` → `funds.json`
  (`FUNDS`: 52 funds plus every ticker in `watchlist.txt`; Yahoo adjusted closes from 2005, the last trading day of each
  Saturday-to-Friday week, `GBp` ÷ 100 stored as GBP; `thin` = share of unchanged weeks over three years; a fund that fails
  keeps its history), loaded only when a Portfolio sub-tab opens (`loadFunds`). Maths: `docs/port-model.js` (`PM`, pure, shared
  with `tools/port-check.js`); page: `docs/port.js` (prefix `po`, never `pb`: the Playbook uses `pb*`).
  **One universe registry**: `poBlocks()` = every fund in `funds.json` + the index series in `PO_INDEX` ("index, no dividends")
  + cash (`PO_CASH_RATE`: OPR, SORA, US 3M bill). A new fund goes into `FUNDS` (or `watchlist.txt`), never into page code.
  **The method** (printed in the cards' notes; change both together): weekly returns with dividends, in the portfolio's
  currency at each week's closing rate; both sides held at their weights (rebalanced weekly); tracking error = √(52 · aᵀΣa)
  on the weeks every holding shares (equal to the realised spread of weekly gaps × √52); share of holding i = aᵢ(Σa)ᵢ ÷ aᵀΣa;
  window 1Y · 3Y · 5Y · Max, cut by the shortest history (the card names that fund); under 52 shared weeks, no figure. History,
  not a forecast, before costs and tax. **Thin trading**: `thin` above 0.08 (`PO_THIN`) gives a "thinly traded" tag and the
  figure says it may be understated. **Benchmarks** (`PO_BENCH`): world mixes = ACWI + AGGU.L (USD-hedged aggregate);
  Malaysia 60/40 = FBM KLCI index + 0800EA.KL; editing a preset makes it "Custom". **Storage**: `sd-ports-v1` in `VAULT_ITEMS`
  through `pstore()` (`{v, sel, ports: [{id, name, ccy, win, rows, bench: {preset, rows}, updated}]}`); the first visit copies
  the old model portfolio (`sd-model-v1`, left untouched); a locked vault shows the lock (`poEmpty` clears the card first),
  never defaults. **Add a fund**: `pmAdd` raises the fund by exactly x points, paid for by all holdings in proportion, cash
  first, or one holding first (never below zero); the what-if uses the weights rounded as they are saved (`poRound2`), so
  "after" equals what Apply or Save as new then shows on Portfolio. The ranked table adds every fund at 5/10/20% (eight lowest
  and six highest at rest). **Target a tracking error** (owner's request, 26 Nov 2026; the plan's "Later" item 1): each
  portfolio keeps a target (`target` in its record, 3% until set, `PO_TARGET`); `PM.pmTarget` tries every 0.1 point of the
  chosen fund from 0 to 100%, paid for as chosen, and halves the interval where the tracking error first crosses the target.
  The row in "What if I add a fund?" rounds that weight to 0.1 point on the safe side (up when bringing it down, down when
  keeping it within), quotes the figure worked out again at that weight (`poTargetFor`), and "Use" sets the weight; out of
  reach, it gives the lowest point instead. The curve draws the target as a dashed rule and runs to 100% only when the
  answer lies beyond 50% (the slider follows). Allocator cards are dated by the last week analysed (`poAsOf`). Wording is arithmetic on past
  returns: never buy, sell, overweight or recommend (the design check scans both sub-tabs). Run `node tools/port-check.js`
  after any change to `port-model.js` or the method; it must pass before pushing.
- **China → Property** (Design plan 5; `pipeline/cnprop.py` → `cnprop.json`, page code `CNP_SUB` in `docs/more.js`, last on
  China, loaded when the sub-tab opens). Two monthly press releases of the National Bureau of Statistics, listed on
  `www.stats.gov.cn/sj/zxfb/`: "70个大中城市…" (70-city prices, two tables: new and second-hand, index on the month and on the
  year) and "全国房地产…" (year to date: investment, building, new-home sales, second-hand transactions, unsold stock,
  developers' funding). **Never build on `data.stats.gov.cn`**: the bureau's database refuses cloud servers, GitHub's included.
  The raw figures as published are archived (`archive/cn_cities.csv`, `cn_realestate.csv`; every release found and whether it
  was read in `cn_releases.csv`) because the list holds about five years; every series is derived from the archive, so a
  run that cannot reach the site rebuilds the same file. Each run reads the first two list pages and anything unread,
  within 240 seconds (`CNPROP_BUDGET`). Tiers live in one place (`TIERS`, from the bureau's own note; English city names
  in `CITY_EN`); a tier figure is the simple average of its cities' indices as published, so it can differ from the bureau's
  own (which averages unrounded indices) by up to 0.1 point. Growth is the bureau's "comparable basis": stored as published,
  never recomputed from the levels. January is never published alone: January and February are one reading, dated
  February. Sales cards show residential figures (the headline counts offices and shops). Run
  `python3 tools/cnprop-check.py` after any change to the reader: it checks the tiers against the bureau's published figures
  for three months, completeness, figures from the release text and the arithmetic. BIS quarterly prices (`CN_HPI_BIS`,
  `CN_HPI_BIS_REAL`, FRED) give the long view from 2005.
- **US → Housing & consumer additions** (Design plan 5): "Consumer sentiment by party" (University of Michigan Table 5b,
  read by `umich_party` in `pipeline/sentiment.py`: the tables page first, because the .xls link carries a changing key;
  `UMS_*`, `UMC_*`, `UME_*` for Democrats, Independents, Republicans; final monthly readings, every month since Feb 2017) and
  "Weekly retail sales" (Chicago Fed CARTS on FRED, `CARTS`, `CARTS_REAL`; its calendar has 48 weeks a year, so a year
  earlier is 48 rows back; FRED's own "change from a year ago" counts 52 rows and is off by a month: never use it).
- **Excess liquidity** (Design plan 5): `excess_liquidity` in `pipeline/leads.py` (`LD_EL_G10`, with `LD_EL_MONEY` and
  `LD_EL_IP`): GDP-weighted real narrow-money growth for the US, euro area, Japan, UK and Canada in US dollars (monthly
  average rates, US CPI) minus their industrial-production growth, from 2006. A reconstruction on public data of the idea in a
  Bloomberg chart, never called Bloomberg's series. One `LB_ROWS` line against the S&P 500; the dashboard's test finds a weak
  link (best fit about 10 months, correlation about 0.24), so it shows as context. Card on Regime & Leading → Global breadth
  & money.
- **Profits** (Design plan 3): US → Economy → Profits (`docs/more.js`, `PF_SUB`, pushed last in `init`): profits vs the
  S&P 500, profits ÷ GDP (GDP fetched from 1959), S&P 500 trailing EPS (`SH_EPS`, Shiller's E column; the page falls back to
  price ÷ P/E). Forward earnings are licensed: never shown.
- **Malaysia → Flows & finances** (Design plan 3, `MYF_SUB` in `docs/more.js`, last on Malaysia): Bank Negara's Monthly
  Statistical Bulletin (`bnm_msb` in `pipeline/cbwatch.py`, `/public/msb/{table}/year/{y}`, one call every 3.5 seconds, history
  once in `msb_years`, then the current year): 3.7 non-resident holdings of ringgit debt (`MY_NR_DEBT`), 3.8 reserves
  (`MY_RESERVES`), 3.1 federal finance (`MY_FED_BAL`, `MY_FED_REV`), 2.5 MGS by tenor (`MY_MGS_2Y_M`, `MY_MGS_10Y_M`); RM
  billion. Table 3.1's fields are shifted from `ov_sur_def` on: the balance is revenue − operating spending − net development
  spending (checked: RM 18.7bn in 2005, RM 91.4bn in 2023). Bursa's foreign equity flows cannot be read automatically.
- **PMIs and business surveys** (owner's request, 24 Nov 2026): Regime & Leading → PMIs & surveys (`docs/leads.js`, `PMI_ROWS`:
  one registry drives the table, the chart and the tiles). Free PMIs: US ISM (`ISM_PMI`) and China NBS (`CN_PMI` = 50 +
  `CN_BCI` / 2, `cnPmiPrep`; exact, checked against NBS releases). Other economies use official surveys: EC industrial and services
  confidence (`BTS_IND_EA20`, `BTS_SVC_*` from the OECD's DF_BTS in `cnjp.py`; country industry lines are `DE_BCI` etc.), OECD
  national indicators (UK, Korea), the Tankan, Singapore's business expectations (`SG_BEXP_MFG/SVC`, SingStat, quarterly).
  S&P Global PMIs (HCOB, au Jibun Bank, Caixin/RatingDog, Malaysia, India, Taiwan, ASEAN) are licensed: never scrape or show them.
  Balances are read against their own record since 2005 (percentile and z-score), never against 50.
- **USD, real yields & commodities** (owner's request, 24 Nov 2026): US → Currency, `us_usd_drv`, three axes (`drawTriple`; the outer right axis drags like the others, `axisAt` picks it by its offset; the separate DXY card was removed):
  the Bloomberg Commodity Index via the iPath ETN that tracks its total return (`DJP`, Yahoo) or the S&P GSCI (`SPGSCI`), the 10Y
  TIPS yield (`REAL10Y`), and the DXY or the Fed's broad dollar (`USD_BROAD`, DTWEXBGS). Bloomberg's own indices have no free feed.
- Several series of one country on a chart use the normal palette; `COUNTRY_TOK` colours apply only when each line is a
  different economy (`seriesCard`).
- **Australia's RBA pages** live in `docs/au.js` (What the RBA is watching, Labour market, Housing & households) with data
  from `pipeline/rba.py` (RBA tables) and `pipeline/abs_au.py` (ABS Data API). The RBA's NAIRU and forecasts have no feed:
  after each Statement on Monetary Policy (Feb, May, Aug, Nov) update `RBA_SMP` in `pipeline/config.py`, including
  `asof`; data health flags it after 100 days. The lean rules in `AU_DRIVERS` are printed in the card's note: change both together.
- New cards, sections and markets are found by search (Ctrl+K) automatically; give cards a real title at build time.
- **Before every push**: serve `docs/` and run `node tools/design-check.js`. It fails on height, tiles, rows, title
  wrapping, header controls, a wrapping sub-tab bar, the first card starting more than 260px down, and script errors;
  then repeats at phone width (390px: bar, first card within 380px, no sideways scroll, no squeezed titles).
  Since Design plan 2 it also fails on a lone half-width card (`lone`), a desktop sub-tab bar that hides tabs (`bar-hidden`),
  the Strategist View over 1,350px or the Weekly brief over 1,500px (at 1440 and 1280), and a brief that prints on more than
  one A4 page. Deliberate exceptions are listed in its `ALLOW` table (`first300` for the two pages with a group row).
  Since Design plan 3 it also fails on a menu list that scrolls more than 200px and on advice words on the Evidence board
  (since Design plan 4 also on Allocation → Portfolio and Add a fund). Model checks run beside it when their code changes:
  `tools/sp-check.js`, `tools/port-check.js`, `tools/cnprop-check.py`.
- Theme: navy + red tokens in `docs/style.css` (inspired by UOB colours; never use UOB's name or logo; the site is
  public). Chart palette was validated with the dataviz palette checker; keep series colours from the tokens.
- Dual-axis charts are the owner's preference for two-series comparisons (`drawPair`).

## Data and privacy

- Public data only; secrets (`FRED_API_KEY`, `ESTAT_API_KEY`) live in GitHub repository secrets, never in code.
- **Licensed or private data: never scraped or shown**: S&P Global PMIs; Robinhood, JPMorgan and Vanda retail-flow data; the
  Redbook index; the Conference Board's consumer confidence index and its party split; Bloomberg's own indices and its
  excess-liquidity series; forward earnings; China's daily property sales, developers' sales, land sales and developer bond
  prices (Wind, CRIC, CREIS). Where a free equivalent exists, the dashboard shows that and says what it is.
- The repository and site are public. Everything the owner writes (watchlist, saved portfolios, signal watch and dismiss,
  structured notes) goes through `pstore()`, which is the **private vault**
  (`docs/vault.js`) once it is set up: AES-256-GCM with a key derived from the owner's passphrase (PBKDF2-SHA-256,
  600,000 rounds) in the browser; only ciphertext is stored or synced. A new private item must use a key listed in
  `VAULT_ITEMS` and read and write through `pstore()`, never `localStorage` directly. Sync (optional) writes the same
  encrypted file to the owner's own private GitHub repository with a fine-grained token kept inside the vault; the
  token and the passphrase never enter this repository. A forgotten passphrase cannot be recovered: never add a back door.
- The Idea log, house views and the Notebook were removed (Design plan 3, Step 2, owner's request 25 Nov 2026). Their stored
  items (`sd-ideas-v1`, `sd-views-v1`, `sd-notebook-v1`) stay in `VAULT_ITEMS`, untouched, encrypted and synced; no page reads
  them; the vault dialog (the vault button at the foot of the menu, which also holds the vault and sync settings) exports
  them as a JSON file. Never delete them or drop them from `VAULT_ITEMS`. The Watchlist is Markets → Watchlist; the old
  model portfolio became the first saved portfolio on Allocation → Portfolio (card keys `idea_model`, `idea_modelchart`,
  `idea_stress` kept; `sd-model-v1` stays in `VAULT_ITEMS`, untouched); old `#tab=ideas` / `#tab=notebook` links are mapped.
- After any change to `docs/vault.js` or to how private data is stored, run `node tools/vault-check.js` and
  `node tools/vault-sync-check.js` (local server up); both must pass before pushing.
- A login screen in front of the public site would only be cosmetic (the files are public); hiding the whole site needs
  other hosting (Cloudflare Access), described as WP73 in PLAN.md and not built.
