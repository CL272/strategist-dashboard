# Design plan 3: a menu that reads as a tree, a leaner tool, and the "so what" layer

**Status (25 Nov 2026): approved by the owner ("go with the defaults": all five decisions as recommended, see the end)
and built, Steps 1 to 9, one commit each. Departures from the plan are listed under "As built" at the end.**
Written after the owner said the side panel makes it "hard to differentiate between the main tab and sub tab", that he
no longer needs the Idea log and the Notebook ("I can keep that on my local drive"), and asked what else would help a
top-down investment decision. He then added: study what happens to US equities when the MOVE index spikes.
`CLAUDE.md` rules still apply; where a step changes a standing rule it says so.

**Reference mockups** (static pages on the real stylesheet; serve the repository root and open them):

| Mockup | Shows |
|---|---|
| `design/menu.html` | The menu in three states: everything open, groups folded, a country page (light and dark follow the theme) |
| `design/allocation.html` | The new Allocation page: the lead, the Evidence board, one asset's evidence, the month in ringgit |

`design/redesign3.css` holds the new classes on the existing tokens. When a step is built, move its rules into
`docs/style.css` unchanged (the "mock-only" block stays behind). Figures in the mockups are illustrative.

## Part A. The menu

### What is wrong (the owner's screenshot, dark theme, all groups folded)

| Problem | Evidence |
|---|---|
| The top level is the faintest text | Group names are 10.5px grey capitals; page names are 13px. The eye reads pages as the main items. |
| Groups and pages share one left edge | With groups folded, the open page ("Stress & Signposts") sits in line with OVERVIEW, MACRO, REGIONS: it reads as a fifth group. |
| The fold arrow is easy to miss | A 9px mark at the far right, 180px from the name it belongs to. |
| Countries are a third level with one clue | 12px of indent and nothing else. |

### Step 1. The menu as a tree (mockup: `design/menu.html`)

Files: `docs/index.html` (the `<nav class="tabs">` markup), `docs/ui.js` (`navGroupsWire`, `navGroupsApply`,
`pinsRender`), `docs/app.js` (`setTab`'s group lookup, `navOpen`), `docs/style.css`.

- **Markup.** Each group becomes `<div class="nav-sec">` holding `<button class="nav-head">` (arrow, name, count) and
  `<div class="nav-items">` with its page buttons. A region's countries sit in a nested `.nav-items` straight after
  the region's button. Keep `class="tabs"` on the `<nav>` (many selectors and the design check use `.tabs button`)
  and add `nav3`. Page buttons keep `role="tab"`, `data-tab`, `data-parent`.
- **Groups look like headers**: arrow on the left (▸ closed, turned 90° when open), name in 12.5px semi-bold ink,
  sentence case, the number of pages on the right in muted text, the whole row clickable, a hairline between groups.
- **Pages hang from a rail**: `.nav-items` is indented 12px with a 1px left border; the open page gets the wash
  background, navy text and a 2px accent that sits on the rail. Countries hang from a second rail under their region.
- **A folded group keeps the open page on its rail**, under its header (CSS: hide the other buttons of a `.folded`
  section). A folded Regions group with a country open shows only that country, still two levels in.
- **Pinned pages** become the first `.nav-sec` ("Pinned"), same style, no fold.
- Fold state stays in `sd-nav-fold-v1` keyed by group name; the region trees keep `NAV_OPEN`.
- Phones use the same markup inside the existing slide-down menu.

Acceptance: the three states match the mockup in light and dark; with every group folded the open page is indented
under its group; Enter and Space fold a group; pins, search (Ctrl+K), the Data health link and the phone menu work;
at 1440 × 900 with the region trees closed the list scrolls at most 200px; `node tools/design-check.js` passes.

## Part B. Removing the Idea log and the Notebook

### What those two pages hold, and what leans on them

| Item | Where it lives | What else uses it |
|---|---|---|
| Open ideas, Closed, Scorecard | Idea log (three of its six views) | Weekly brief "My open ideas"; What changed "Idea hit its target"; backup export/import |
| Watchlist | Idea log view | Search; the ticker loader |
| House views | Idea log view | Weekly brief "House views" line |
| Model portfolio | Idea log view | The model stress card (`docs/more.js`) |
| Notes | Notebook page; "+ Note" in every page header; dots on cards | Search (`vaultSearch`) |
| Vault and sync settings | Notebook → Vault & sync | The lock button in the menu foot |
| My notes (structured products) | Structured products → My notes | What changed (knock-in alerts) |
| Signal watch and dismiss | Signals page | Strategist View → Signals |

### Step 2. Remove the diaries, keep the tools (the scope the owner approved; House views go too, decision 3)

Remove:
- The Idea log page: Open ideas, Closed, Scorecard, their form, P&L code, backup export/import, the `ideas` tab id
  (button, panel, `TAB_TITLES`, the `renderTab` map, the `init` list, `IDEA_VIEWS`, the design-check allowance).
- The Notebook page, the "+ Note" button, the note dots, `afterRenderNotes`, the notes part of `vaultSearch`.
- "My open ideas" and the "House views" line on the Weekly brief; the idea rule in `whatChanged`.
- House views (`sd-views-v1`): the view, its history, `hvCurrent` and `HV_ROWS`.

Keep, and re-home:
- **Watchlist** → Markets, a new last sub-tab "Watchlist" (same cards and chips).
- **Model portfolio** and its stress card → the new Allocation page (Step 3), sub-tab "Model portfolio".
- **Vault**: stays optional, exactly as now, for the items that remain (`sd-watch-v1`, `sd-model-v1`, `sd-notes-v1`,
  `sd-signals-v1`, `sd-sync-v1`). Its settings card ("Vault and sync") moves into a dialog opened from the lock button
  in the menu foot. Stored `sd-ideas-v1`, `sd-views-v1` and `sd-notebook-v1` are **left untouched inside the vault
  record** (never delete the owner's writing): remove the keys from the code paths, not from storage, and add a
  one-line "Export my old ideas and notes" button in the vault dialog that downloads them as a JSON file.
- Structured products → My notes and the Signals watch/dismiss buttons: unchanged.

Old links: `#tab=ideas` and `#tab=notebook` open the Strategist View; `#tab=ideas&sub=1` (Watchlist) opens Markets →
Watchlist; `sub=5` (Model portfolio) opens Allocation → Model portfolio.

Acceptance: no page, button or search result leads to an idea, a note or a house view; the export button returns
the old data when the vault holds any; `node tools/vault-check.js` and `node tools/vault-sync-check.js` pass (update
their seeds for the removed items); the design check passes; `CLAUDE.md`'s privacy section lists the items that remain.

## Part C. What to add for a top-down decision

### Where the dashboard stands against the seven questions a top-down view answers

| Question | Today | Gap |
|---|---|---|
| 1. Where are we in the cycle? | Regime, leading board, PMIs and surveys, country pages | none |
| 2. What are policy and liquidity doing? | Central banks, Liquidity | none |
| 3. What are profits doing? | Nothing (one series, `PROFITS`, sits unused inside the cycle baskets) | **Step 6** |
| 4. What is priced in? | US valuation in depth; FX and bond valuation | Index P/E outside the US is licensed data: not possible. Dividend-yield gaps: later (C-later 1) |
| 5. Who holds what, and where is money going? | CFTC, sentiment surveys, margin debt, country fund flows | Foreign money in Malaysian bonds: **Step 7** |
| 6. What could go wrong? | Stress, signposts, VIX study, credit cycle | Rate-volatility shocks: **Step 8**; drawdowns in context: **Step 5** |
| 7. So what, for each asset, in ringgit? | Nothing pulls 1–6 together; ringgit returns only as a table switch | **Steps 3 and 4** |

### Step 3. Allocation page: the Evidence board (mockup: `design/allocation.html`)

A new page, `alloc`, second in the Overview group ("Allocation"). Register it everywhere a page id is needed
(`index.html` button and panel, `TAB_TITLES`, `renderTab`, the `init` list, `SUBTABS`, `TILE_SETS`).
Sub-tabs: **Evidence board · In ringgit (Step 4) · Drawdowns (Step 5) · Model portfolio (moved in Step 2)**.

The board is a table: 13 assets down, six pillars across, one mark per cell (▲ supportive, ● neutral, ▼ against,
– no measure), and a plain tally at the end ("3 for · 3 against"). No score, no weights, no rank: a count of what the
dashboard already shows elsewhere. Clicking a row fills the card beside it with one sentence per pillar, each with
its numbers and a link to the card it came from. Above the table, one lead sentence built from the counts.

Assets: Equities: US (`SPX`), Europe (`SX5E`), Japan (`NKY`), China (`CSI300`), Asia ex-Japan (`AAXJ`), Malaysia
(`KLCI`), Singapore (`STI`). Bonds: US Treasuries (`UST10Y`, price proxy `IEF`), US high yield (`HY_OAS`, `HYG`),
Malaysian government bonds (`MY_MGS_10Y`). Other: Gold (`GOLD`), US dollar vs ringgit (`USDMYR`), ringgit cash
(`MY_FD12`).

Pillar rules (write them once in a registry, `AL_ROWS`, so the table, the detail card and the lead read the same
thing; print the rules behind "How the board works ▸"):

| Pillar | Supportive (▲) | Against (▼) | Source already on the dashboard |
|---|---|---|---|
| Cycle | In the confirmed regime the asset's past annualised return beat its all-period return **and** it rose in at least 55% of months | Past return in this regime below zero, or it rose in under 45% of months | "What worked in each regime" (`regtable`); for markets it does not cover, the local OECD leading index: 6-month change above zero and rising = ▲, below zero and falling = ▼ |
| Valuation | Cheapest fifth of its own history | Dearest fifth | Equities: excess CAPE yield (US), price vs 10-year trend (others). Bonds: real yield and term premium (US), spread percentile (high yield), 10Y yield minus CPI (Malaysia). Gold: real gold price. USD/MYR: ringgit real effective rate (a cheap ringgit counts against the dollar). Cash: 12-month deposit rate minus CPI above zero = ● at best |
| Trend | Above its 200-day average and 12-1 month momentum positive | Below and negative | Trend table (`tr_table`); for yields the sign is turned so that falling yields are an uptrend for bonds |
| Sentiment | Washed out: Fear & Greed ≤ 25 or AAII bull-bear spread in its lowest tenth (US equities); CFTC net speculative position in its lowest tenth over 3 years (Treasuries, gold, dollar) | Crowded: the mirror image | Sentiment and Positioning pages. Markets with no measure show "–" |
| Policy & liquidity | The asset's central bank is priced to cut | Priced to hike | `cbStats(k).read` and the Fed path; gold uses the 3-month change in the US real yield (down = ▲); USD/MYR uses the 3-month change in the US 3Y − MGS 3Y gap (wider = ▲ for the dollar) |
| Signals | A tested rule is switched on in the asset's favour | A tested rule is switched on against it | The signal engine (`SIG.ideas`, tier "Tested edge") |

The lead (`.sv-lead`): "The evidence leans against risk: …" when at least five of the seven equity rows have more
against than for; "leans towards risk" for the mirror; "is mixed" otherwise; then the pillar that is most one-sided
across the rows, and the one that most disagrees with it.

Wording is fixed: "evidence", "for", "against", "tally". Never "buy", "sell", "overweight", "recommend". The card
foot says: "A tally of the dashboard's own evidence, not a recommendation." (The rule that signals are research
prompts covers this page too.)

Tiles (five): equity rows leaning for · equity rows leaning against · most supportive pillar · most adverse
pillar · regime.

Acceptance: every mark can be traced: the detail sentence quotes the number and the linked card shows the same
number; a market with no measure shows "–" and is not counted; the board is one table of 13 rows (allow it in the
design check, as grouped tables are elsewhere); the page is within the height budget at 1440 and 1280; dark theme
checked by eye.

### Step 4. In ringgit (Allocation → In ringgit)

For Malaysian clients the return that matters is in ringgit, and the question that follows is whether to hedge.

- **Returns split in two** (wide table, about 14 rows, toggle 1M · 3M · YTD · 1Y): each asset's return in its own
  currency, the currency effect, and the return in ringgit. Uses `inCcy`. Ringgit assets show "–" for the effect.
- **What hedging dollars back to ringgit costs** (chart): 3-month KLIBOR (`MY_IB_3M`) minus the 3-month US bill
  (`UST3M`), in % a year; negative = hedging costs that much. Note the caveat: an interest-parity estimate, not a
  dealer's forward quote.
- **US Treasury 10Y for a ringgit investor** (chart): UST 10Y unhedged, UST 10Y hedged to ringgit
  (`UST10Y` + the line above), and MGS 10Y (`MY_MGS_10Y`). The takeaway sentence says which pays more today and by
  how much.

Acceptance: the three columns of the table add up (own-currency return compounded with the FX move equals the
ringgit return, to 0.1 points); the hedged line equals UST 10Y plus the cost line on every date.

### Step 5. Drawdowns (Allocation → Drawdowns)

- **How far from the high** (table, the 16 key markets of Markets → Performance plus gold, Bitcoin and UST 7–10Y):
  last · below 52-week high · below the record high in the data · days since that high · deepest fall in 10 years.
  Sorted by depth; rows 20% or more below the high are marked.
- **This fall against past ones** (chart, a market picker): the underwater curve (percent below the running high),
  and under it a short table of every past fall of 10% or more: depth, days to the low, days back to the old high.
  Use the long daily histories in `events.json` (S&P 500, Nasdaq 100, Nikkei, Hang Seng, STI, KLCI since 1990,
  loaded on demand with `loadEvents`) and `yahoo.json` for the rest.
- Takeaway sentence, in this form (figures here are placeholders): "The S&P 500 is 7.8% below its high after 34
  days; since 1990 it has had 28 falls of 10% or more, with a median depth of 14% and a median 5 months to recover."

### Step 6. Profits (US → Economy → new sub-tab "Profits")

Three cards. Data: `PROFITS` (FRED `CP`, already fetched), `GDP`, and Shiller's earnings series (add `SH_EPS` in
`pipeline/valuation.py`: column `E` of the file that already gives CAPE).

- **Profits vs the S&P 500**: corporate profits after tax, year on year, against the index, year on year (dual axis).
- **Profit margin**: profits as a share of GDP, with its long-run average.
- **S&P 500 earnings**: trailing 12-month earnings per share (level and year on year); the note states that it lags
  by a quarter and that forward estimates are licensed data and are not shown.

### Step 7. Malaysia: foreign money and public finances (Malaysia → new sub-tab "Flows & finances")

Checked on 25 Nov 2026: Bank Negara's API serves its Monthly Statistical Bulletin at
`https://api.bnm.gov.my/public/msb/{table}` (and `/msb/{table}/year/{yyyy}`), same `Accept` header as the bills.
It limits requests ("Too Many Attempts" after a burst): wait 3.5 seconds between calls and read only the current
year once the history is on file, as `bnm_bills` does.

| Table | Holds | Frequency | Use |
|---|---|---|---|
| 3.7 | External debt, including **non-resident holdings of ringgit debt securities** (`ext_deb_out_non_hol_of_rin_den_deb_tot` and its government-securities parts) | quarterly | Foreign holdings of ringgit bonds: level and change, against USD/MYR |
| 3.8 | International reserves (`bnm_gro_int_res_tot`, `net_off_res`) | monthly | Reserves, level and 12-month change |
| 3.1 | Federal government finance (revenue, expenditure, `ov_sur_def`, borrowing) | check on first read | Budget balance, 12-month sum |
| 2.5 | MGS yields by maturity, including **2 years** (`mat_yr_two`) | monthly | A "2Y (monthly)" view on the rate-gap card: US 2Y − MGS 2Y, which the owner asked for on 23 Nov and the daily feed cannot give |

Cards: Foreign holdings of ringgit bonds · International reserves · Federal budget balance · and the existing
Malaysia fund (EWM) flow line from "Country funds: yields and flows" gets a "See also" link, not a copy.
Before drawing anything, print each series beside the figure in Bank Negara's published bulletin for one date and
confirm the units (the API returns RM million as strings). Bursa's foreign equity flow data blocks automated access
(noted in `pipeline/etfs.py`): say so in the sub-tab's first note.

### Step 8. After MOVE spikes (Positioning & Vol → After VIX spikes)

The owner's question: when bond volatility (the MOVE index) spikes, are US equities hit too? A first pass on the
data on file (MOVE from Jan 2005, daily) gives:

| | Episodes | S&P 500, next 1M (median) | next 3M | next 1Y | Share higher after 3M |
|---|---|---|---|---|---|
| First close above 120 | 7 | +5.9% | +7.5% | +4.2% | 6 of 7 |
| First close above 140 | 5 | +0.2% | +5.6% | +18.5% | 3 of 5 |
| First close above 160 | 5 | +1.1% | +11.4% | +21.0% | 4 of 5 |
| All days since 2005 | | +1.4% | +3.5% | +12.6% | 71% |

Two findings to show on the page: (1) equities fall **with** the spike, not after it: weekly changes in the MOVE and
S&P 500 returns have a correlation of −0.32 since 2005 and −0.51 over the last three years, and the S&P 500 had
already lost a median 6.3% in the month before the MOVE first closed above 140; (2) after the first close above a
level, returns were about normal to better than normal, with a wide spread (the worst cases are 2008). Five to seven
episodes is a thin sample: the card must say so.

Build: add MOVE triggers to the existing study (`EVT_TRIG`: MOVE > 120, 140, 160; the card title "After VIX stress"
becomes "After a volatility spike"); add a "month before" column to the table for every trigger; add UST 7–10Y
(`IEF`) to the market picker so the bond side is visible; in `pipeline/events.py` store the MOVE from the earliest
date Yahoo gives (`^MOVE`) and `IEF` daily. Add one small card: "MOVE vs the S&P 500", the rolling 1-year
correlation of weekly changes. A third quick-pick button: "MOVE above 140".

### Later, if wanted (not in this plan's steps)

1. **Dividend-yield gap by market**: each country fund's trailing yield minus its local 10-year yield, as a
   valuation column for markets with no P/E. History is short (the fund archive began in November 2026).
2. **US fiscal and Treasury supply**: deficit, interest cost and debt from FRED beside the term premium.

### Not possible on free, public data (so not planned)

Index P/E and forward earnings outside Shiller's US series; S&P Global PMIs; Bursa's foreign equity flows;
Bloomberg's own indices.

## Order and size

One step per commit; run the design check before each push, and the two vault checks after Step 2.

| Step | What | Decision (all approved) | Risk | Size |
|---|---|---|---|---|
| 1 | Menu as a tree | 1 | low | small |
| 2 | Remove the Idea log and Notebook; re-home Watchlist and Model portfolio | 2, 3 | medium: vault code and old links | medium |
| 3 | Allocation page: Evidence board | 4 | medium: many inputs, all existing | large |
| 4 | In ringgit | 5 | low | small |
| 5 | Drawdowns | 5 | low | medium |
| 6 | Profits | 5 | low: one new series | small |
| 7 | Malaysia: flows and finances | 5 | medium: new feed, rate limit, units to verify | medium |
| 8 | After MOVE spikes | none (asked for) | low | small |
| 9 | Guardrails and notes: design-check allowances, `CLAUDE.md`, this plan's status | none | none | small |

Steps 1, 2 and 8 answer what the owner asked for directly. Step 3 is the one that changes how the dashboard is used.

## Do not change

- The vault's encryption, passphrase handling and sync; never delete stored private data, never add a back door.
- Signal and structured-products wording; the source and date line under every card; card keys of cards that stay.
- Design plan 2's rules (say each thing once, no lone cards, the pager, page caps, Markets · Economy).

## Decisions (answered by the owner, 25 Nov 2026: "go with the defaults")

Every default in brackets below is approved. The alternatives were not chosen: do not build them.

1. **The menu as in `design/menu.html`**: group names as headers with the arrow on the left, pages on a rail,
   countries on a second rail. [Yes] **Approved.**
2. **How much personal tracking to remove.** [Remove the Idea log (open, closed, scorecard), the Notebook and
   "+ Note"; keep the Watchlist (moved to Markets), the Model portfolio (moved to Allocation), structured-product
   notes and the signal watch buttons.] Alternative: remove all of those too, and the vault with them, so the tool
   stores nothing of yours. **Approved as the default: the vault stays, for the items that are kept.**
3. **House views.** [Remove, as you track views yourself.] Alternative: keep them as a "My view" column on the
   Evidence board, to see where your stance and the evidence disagree. **Approved as the default: remove; no "My view"
   column.** Stored views (`sd-views-v1`) are left untouched and included in the export.
4. **The Evidence board's rules and wording**: a count of marks for and against, no score, never a recommendation.
   [Yes] **Approved.**
5. **Which additions to build**: In ringgit, Drawdowns, Profits, Malaysia flows and finances. [All four] **Approved: build all four** (Steps 4 to 7), plus Step 8, which the owner asked for.

## As built (25 Nov 2026)

All nine steps are live, one commit each. Where the build departs from the text above:

- **Step 1.** Group page counts are worked out from the markup. With every group open and the region trees closed the list
  scrolls 189px at 1440 × 900; the design check now fails above 200px.
- **Step 2.** The Allocation page was created in this step to receive the Model portfolio; Step 3 then put the Evidence board
  first. The vault and sync settings open in a dialog from the vault button; the export downloads the old ideas, house views
  and notes as one JSON file. The vault-sync check now syncs the old Notebook item (no page reads it), so the test no longer
  wakes the structured-notes price history.
- **Step 3.** In `docs/alloc.js`. China, Asia ex-Japan and Singapore have no policy gauge ("–"); the Bank of Japan reading needs
  the JGB tenors built on first use (`cbPrep`). High-yield valuation uses the Baa − 10Y spread (FRED keeps only three years of
  the high-yield spread). The valuation scorecard gained two rows the board reads (real gold price, MGS 10Y real yield) and the
  price-vs-trend chart gained Asia ex-Japan, so each linked card shows the board's number. The lead is one line (counts are in
  the tiles), to keep the first card within 260px. A third card, "Evidence by pillar", counts the marks per column.
- **Step 4.** The ringgit interbank series on file starts in December 2023, so the hedging-cost card starts there.
- **Step 5.** The past-falls table counts falls that recovered; the takeaway gives the median months from the low back to the
  old high.
- **Step 6.** "Profits" is the last US Economy sub-tab (appended so older links keep their place). US GDP is now fetched from
  1959 so the margin's average covers the long history; the next data run fills it in.
- **Step 7.** "Flows & finances" is the last Malaysia sub-tab. Foreign holdings in the bulletin start in 2009, MGS by tenor in
  2007. The rate-gap view is labelled "2Y (monthly)" and dated at each month's end.
- **Step 8.** MOVE runs from November 2002 (Yahoo's first year), adding a 2003 episode: above 140 there are 6 episodes, a median
  −6.3% in the month before; weekly correlation −0.30 since 2002 and −0.51 over the last three years. The sub-tab keeps its
  label "After VIX spikes" (bookmarks); the card is titled "After a volatility spike". The all-days medians now cover the
  trigger series' own years.

