# Design plan 2: a front page, a one-page brief, fewer clicks

**Status (25 Nov 2026): approved by the owner; Steps 1–2 built.** Departure in Step 2: "My open ideas" (the owner's
own, shown only when the Idea log has open ideas) stays on the brief, at most three rows, under Week ahead. All five decisions at the end were answered "yes, as
recommended", so every step, including Step 4, can be built. Written after the owner said the Strategist View and the Weekly brief
are "too messy and clunky" and that some pages are "not very clean to click through". This plan adds no data: it
rearranges what exists. The earlier clean-up (`DESIGN_PLAN.md`, D1–D9) fixed the cards; this one fixes the two
pages read every day and the path through the rest. `CLAUDE.md` rules still apply; where a step changes a standing
rule it says so (see "Decisions for the owner", all approved).

**Reference mockups** (static pages that use the real stylesheet; serve the repository root and open them):

| Mockup | Shows | Height at 1440 × 900 |
|---|---|---|
| `design/strategist-view.html` | Strategist View → Today after Step 1 | 1,208 px (today 2,173) |
| `design/weekly-brief.html` | Weekly brief after Step 2 | 1,418 px (today 2,004; 2,934 on a 1280 laptop) |
| `design/click-through.html` | Two-level sub-tabs (US), a merged country page (China), the pager | n/a |

`design/redesign.css` holds every new class used by the mockups, written on the existing tokens. When a step is
built, move its rules into `docs/style.css` unchanged (the block marked "mock-only" stays behind). Build the real
page to match the mockup; where the two differ, the text of this plan wins.

## What the review found

Measured on the live site, 25 Nov 2026, 1440 × 900 (and 1280 × 720 for the two pages), every page and sub-tab.

| Problem | Evidence |
|---|---|
| The Strategist View has no entry point | Seven cards of equal weight, 2,173 px (2.4 screens). The first is "Talking points": seven bullets holding 43 numbers. |
| It says the same thing three or four times | "Taiwan Weighted −17.5% (−7.26σ)" is in Talking points, in What changed and in What moved. Three of the five "What changed" items are the top three "What moved" bars. The regime and the stress reading are in a tile, in Talking points, and (stress) in a card. |
| Two stress numbers that disagree | The tile says "57th pct"; the gauges card leads with a large "60th" (the average of seven gauges). Both are right and it reads as an error. |
| Ragged rows | What moved is a 520 px chart beside a 370 px card: 150 px of blank card. What changed and Signals are different heights too. |
| Small print everywhere | Each of the seven cards carries a sub-line, a note or rule text, "How to read" and a source line: about 14 lines of grey text on one page. |
| Unstyled links | Signals are raw underlined blue links; three bullet styles on one page. |
| The Weekly brief is not a brief | "Key takeaways" is nine bullets that restate the tables (52 numbers). Seven boxes of unequal height follow; on a 1280 laptop the seventh wraps onto its own row. |
| …and not one page | 2,004 px on a desktop; below about 1,300 px wide it drops to one column and becomes 2,934 px. The page says it "fits one A4 sheet". |
| …and it looks like a different product | Full-cell red and blue fills (retired from every other table in D2), its own list and box styles, a right column of seven sections in four formats ending 330 px below the left column. |
| Sub-tab bars that hide tabs | US has 12 sub-tabs (1,350 px of tabs in a 1,168 px bar) and Regime & Leading has 10 (1,525 px): the last ones are off-screen until the bar is scrolled sideways. |
| Many clicks for little content | 150 views; of the 144 sub-tabs, 58 hold one or two cards and 22 hold one. China is four clicks for nine charts; Germany three clicks for nine. |
| Half-empty screens | 30 sub-tabs have a half-width card alone on its row beside a blank half (China → Equities is one chart on an empty page). |
| No way to read a page through | To go on from the foot of a sub-tab the reader scrolls back up to the bar. |
| The menu is taller than the screen | 36 entries; with both region trees closed the sidebar is 1,334 px in a 900 px window (1,661 px with one open), and the whole column scrolls, so the brand, search and the status line scroll away with it. |

## Principles

1. **One answer first.** A daily page opens with one sentence that says what happened. Evidence sits below it.
2. **Say each thing once.** A fact has one place on a page. Other places link to it; they do not repeat it.
3. **Three weights, not one.** A headline on the page background, then cards, then quiet lists inside cards. No boxes
   inside boxes, no full-cell colour fills, no bullets in three styles.
4. **A screen and a bit.** Strategist View → Today and the Weekly brief each fit within 1,500 px at 1440 × 900 and
   at 1280 × 720. The brief prints on one A4 page.
5. **One click per place.** A sub-tab earns its place with at least three cards or one board that fills a screen.
   A row never holds a lone half-width card.

## Step 1. Strategist View → Today (mockup: `design/strategist-view.html`)

Files: `docs/app.js` (the overview block around `renderMoved`, `renderFragile`, `talkingPoints`, `renderPoints`,
`whatChanged`, `renderChanges`, `renderOvSignals`, `renderOverview`, `renderHeadlinesCard`, `renderCalNext`),
`docs/style.css`. Card keys do not change (`points`, `changes`, `ov_signals`, `moved`, `fragile`, `headlines`,
`cal_next`, `where`), so search, bookmarks and `SUBTABS.overview` keep working; only the order in `SUBTABS.overview`
changes to `['moved', 'changes', 'ov_signals', 'fragile', 'cal_next', 'headlines', 'points']`.

Layout, top to bottom:

1. **The lead** (`.sv-lead`, on the page background, above the tiles): an eyebrow "This week · to {date}" and one
   sentence from a new `weekLine(end = state.latest)`. Rules for the sentence (facts only, no forecast words, at
   most 200 characters; return `null` and hide the block when the inputs are missing):
   - *Equities clause.* Take the 1-week change of the equity rows in `WK_ROWS`. If at least 8 of 10 moved the same way
     and the median move is 2% or more: "world equities fell a–b%" (or "rose"), where a and b are the second-smallest
     and second-largest moves, whole numbers, coloured `.dn` / `.up`. If the median is under 1%: "world equities were
     little changed". Otherwise: "equities were mixed (n of 10 higher)".
   - *Tone word.* "Risk-off:" when equities fell by the rule above and the VIX's 1-week move is +2σ or more or the US
     high-yield spread widened; "Risk-on:" for the mirror image; no tone word otherwise.
   - *Change clause.* The first item of `whatChanged(end)` that is not a market move (regime switch, stress band,
     VIX curve, breadth crossing), shortened to a phrase. Omit when there is none.
   - *Dollar and real-yield clause.* From the 1-week change in `DXY` (threshold ±0.3%) and `REAL10Y` (±5bp): "the
     dollar and real yields rose", "the dollar rose while real yields fell", and so on. Omit when both are inside
     the thresholds.
2. **Tiles**: the same five, unchanged.
3. **Row 1, three equal cards** (`.grid.g3`; two columns below 1,180 px with the third spanning; one on phones):
   - **What moved** (`moved`): the top 6 from `movers()` as `.rows.mv` rows: name, change, σ, and under them a
     thin two-way bar whose length is the σ (8σ = full). The "1 week / 4 weeks" toggle stays. "All 14 →" opens the
     list to 14 rows in place. The 14-bar chart is retired.
   - **What changed** (`changes`): at most 5 `.rows.chg` rows: status dot, bold subject, one line of detail.
     Market moves of 2σ or more are **no longer listed here** (they are in What moved): give `whatChanged` an
     option to leave them out and use it on this card and in `weekLine`. The paragraph of rules moves behind
     "How the rules work ▸" (closed).
   - **Signals** (`ov_signals`): "Bearish · n" and "Bullish · n" labels, each idea one `.rows.sg` row (direction
     mark, name, horizon and tier). Rows are buttons that open the idea on the Signals page; no underlined links.
     Sell-side stays first. The foot line carries "Just ended: …" and "Signals →". Wording stays "research
     prompts", never recommendations.
4. **Row 2, three equal cards**:
   - **Stress gauges** (`fragile`): the seven bars as `.rows.gz`. Remove the large "60th" figure and its sentence;
     the card's count line reads "parts of the composite" and the foot links to Stress & Signposts. The composite
     figure lives only in the tile.
   - **Week ahead** (`cal_next`): at most 6 events from the next 7 days, top tier first, grouped under day labels:
     time, "Region · event", previous. No stars. "All n →" opens the Calendar.
   - **Headlines** (`headlines`): 5 items, the title on at most two lines, source and age under it.
5. **Talking points** (`points`): one slim bar at the foot (`.fold-bar`), closed by default: title, one line of
   description, "Show ▸" and "Copy". Open shows the same bullets as today; the open state is remembered
   (plain `localStorage`, it is a display preference, not the owner's writing).

Small print on these cards: no sub-line and no note at rest. Each card keeps one muted line with the source on the
left and the date on the right (the owner's 19 Nov rule), pinned to the bottom edge so the three cards in a row end
level. Any one-line key sits in the card foot (`.card-foot`), as in the mockup.

"Where we are" (the second sub-tab) is not changed.

Acceptance: Today is at most 1,350 px tall at 1440 × 900 and at 1280 × 720; no fact appears in two cards; the three
cards in each row are the same height; no raw underlined link; `node tools/design-check.js` passes; dark theme
checked by eye.

## Step 2. Weekly brief (mockup: `design/weekly-brief.html`)

Files: `docs/app.js` (`WK_ROWS`, `wkTakeaways`, `wkTiles`, `wkAsia`, `wkAhead`, `renderWeekly`), `docs/style.css`
(the `.op-*` rules are replaced by the `.wb-*` rules; keep the print block and re-test it).

The sheet (`.wb`, at most 1,060 px wide, centred) from top to bottom:

1. **Masthead**: title, "Week to Friday …", "Data as of …". No refresh timestamp on the sheet.
2. **Lead**: `weekLine(end)` from Step 1, as `.wb-lead`. The brief and the Strategist View can no longer disagree.
3. **Three takeaways** (`.wb-take`, three columns): Equities · Rates & the Fed · FX & commodities. Each is a label
   and at most two short sentences with at most five numbers. `wkTakeaways` returns `[{head, text}]`. The bullets
   for central banks, unusual moves, what changed and the regime are dropped: each has its own section or tile.
4. **Five tiles, one row** (the standard `.kpis` strip): Macro regime · Stress composite · Recession odds (12m) ·
   Fed funds (with the next meeting's pricing) · VIX. Peak signposts and Fed net liquidity leave the brief.
5. **Two columns** (`.wb-cols`, 1.12 : 1; they stay side by side down to 1,000 px):
   - Left: **Cross-asset scoreboard**, 25 rows: Equities 9 (S&P 500, Nasdaq 100, Euro Stoxx 50, Nikkei 225,
     CSI 300, Hang Seng, KOSPI, Straits Times, FBM KLCI) · Rates & credit 5 (UST 2Y, 10Y, 10Y real, MGS 10Y,
     US HY spread) · FX 6 (DXY, EUR/USD, USD/JPY, USD/CNY, USD/SGD, USD/MYR) · Commodities & vol 5 (gold, Brent,
     copper, Bitcoin, VIX). Columns: Asset · Last · 1W · YTD · 3M sparkline. **Quiet heat**: numbers in blue or red;
     a faint tint only on a 1W cell whose move is 2σ or more for that asset (the same σ as `movers`). No full-cell
     fills.
   - Right, four sections in this order: **Asia focus** as a five-row table (Malaysia, Singapore, China, Japan,
     Australia × policy or short rate, CPI, FX 1W, equities 1W; reuse the values `wkAsia` already gathers) ·
     **Most unusual moves** (5 `.rows.mv` rows) · **Signals to watch** (3 rows, then one "Leads" row from
     `lbSummary`; the house-views line stays under it when the vault holds views) · **Week ahead** (at most 8
     top-tier events after the week's Friday, under day labels).
6. **Foot**: one line of sources.

Dropped from the brief: Headlines (stale by the time a brief is read; they are on the Strategist View) and the
Structures line (it belongs to Structured products). "Copy as text" follows the new order and content.

Acceptance: at most 1,500 px tall at 1440 × 900 and at 1280 × 720; two columns at 1,100 px; `page.pdf({ format:
'A4' })` of the page with the site's print styles is exactly one page; no cell with a full background fill; the
lead matches the Strategist View's for the latest week; an older week from the selector still renders.

## Step 3. No lone cards; a pager under every sub-tab

Files: `docs/app.js` (`setSub` / wherever a sub-tab's cards are shown), `docs/style.css`, `tools/design-check.js`.

- **Lone cards.** After a sub-tab's cards are placed, if the last visible half-width card sits alone on its row, give
  it the full width for that view (a `span2` class set and cleared by the layout code, then resize its chart). Do
  not edit `wide` in each `makeCard`. Fixes 30 sub-tabs at once.
- **Pager** (`.pager`): at the foot of every sub-tab on pages with two or more, "← {previous}" and "{next} →"
  buttons that call `setSub` and scroll to the top. The first sub-tab shows only "next"; the last only "previous".
  Hidden in print.
- **Keys**: `[` and `]` move to the previous and next sub-tab when no input has the focus. Add the hint to the
  search box's help text.

Acceptance: `design-check.js` fails on a sub-tab whose last row is a lone half-width card (new rule `lone`);
every multi-tab page shows the pager; heights stay within the budget.

## Step 4. Country pages: Markets · Economy (mockup B in `design/click-through.html`)

**Approved by the owner on 25 Nov 2026** (it replaces his 12 Nov rule "Equities · Rates & bonds · Currency · Economy" on
the pages in the table; update that rule in `CLAUDE.md` when this step ships).

Rule: on a country or region page, asset-class sub-tabs with fewer than three cards merge, in the fixed order, into
one **Markets** sub-tab. Inside it each card carries its asset class as an eyebrow above the title
(`.card .eyebrow`: "Equities", "Rates & bonds", "Currency"); the order of the cards stays Equities → Rates & bonds →
Currency. "See also" rows and the Signals strip move with their cards (one of each at the top of Markets).

| Page | Now | After |
|---|---|---|
| Germany, France, Italy, Spain | Equities 2 · Rates 2 · Economy 5 | Markets 4 · Economy 5 |
| UK | Equities 2 · Rates 2 · Currency 2 · Economy 6 | Markets 6 · Economy 6 |
| China | Equities 1 · Rates 2 · Currency 1 · Economy 5 | Markets 4 · Economy 5 |
| Korea | Equities 2 · Rates 1 · Currency 1 · Economy 4 | Markets 4 · Economy 4 |
| Taiwan | Equities 3 · Currency 1 · Economy 3 | Markets 4 · Economy 3 |
| India | Equities 2 · Rates 2 · Currency 1 · Economy 2 | Markets 5 · Economy 2 |
| Japan | Equities 1 · Rates 3 · Currency 1 · Economy 4 | Markets 5 · Economy 4 |
| Europe | Equities 1 · Rates 4 · Currency 1 · Economy 6 · Countries compared | Markets 6 · Economy 6 · Countries compared |
| Australia | Equities 1 · Rates 3 · Currency 2 · three Economy tabs | Markets 6 · the three Economy tabs |
| Singapore | Equities 4 · Rates 3 · Currency 2 · Economy 3 | Equities 4 · Rates & currency 5 · Economy 3 |
| US, Malaysia | unchanged here (US: see Step 5) | |

(Card counts leave out the Signals strip and "See also" rows.) Sub-tabs fall from 144 to about 121; reading
every country page takes half the clicks.

Also: add each page's old order to `OLD_SUBS`/`SUB_PREV` handling so bookmarks land on the merged tab (bump the
hash version if needed); update `seeAlso` targets, `SIG_TARGETS`, `TILE_SETS` keys, `REGION_MOVES`, `goSub` callers
and the PMI board's links (`PMI_ROWS`) that name "Equities", "Rates & bonds", "Currency" on these pages; update the
rule in `CLAUDE.md`.

Acceptance: no country sub-tab has fewer than three cards except India → Economy (two cards, one full row);
every old bookmark (`#tab=cn&sub=2&v=3` and the like) opens the tab that now holds those cards; search still
finds every card; design check passes at both widths.

## Step 5. US and Regime & Leading: sub-tab bars that hide nothing (mockup A in `design/click-through.html`)

Files: `docs/app.js` (`SUBTABS.us`, `SUBTABS.regime`, `buildSubtabs`, `setSub`), `docs/leads.js`, `docs/more.js`
(they push sub-tabs into these pages), `docs/style.css`.

- **Merge thin US sub-tabs** (12 → 9): Currency (1 card) joins Rates & bonds as **Rates & dollar**; Inflation (2) and
  Inflation pipeline (3) become **Inflation** (5); Recession watch (2) joins Growth & jobs as **Growth & recession**
  (6). Check each merged tab against the height budget; if Inflation exceeds it, pair its half-width cards.
- **Two-level bar** for a page with more than eight sub-tabs (after the merges: US 9, Regime 10): a row of group
  pills (`.subgroups`, each with its count), then the usual underlined bar showing only that group's sub-tabs. US
  groups: Markets (3) · Economy (6). Regime groups: Regime (2) · Leading (6) · Surveys (2: PMIs & surveys,
  Household saving). Choosing a group opens its first sub-tab, or the one last open in it. Pages with eight or
  fewer keep the single bar with inline group labels, as now.
- The sub-tab index in the hash stays the flat index, so no bookmark changes on Regime; US needs the `OLD_SUBS`
  treatment from Step 4 for its three merges.

Acceptance: no `.subtabs` bar has `scrollWidth > clientWidth` at 1440 or 1280 (new design-check rule `bar-hidden`,
replacing the allowance for a scrolling bar on desktop); every US and Regime sub-tab is reachable in two clicks
without scrolling the bar; the first card still starts within 260 px of the top (raise this limit to 300 px only for
the two pages with a group row, in `ALLOW`).

## Step 6. The menu

Files: `docs/index.html`, `docs/style.css`, `docs/ui.js`.

- Only the list scrolls: `.side` becomes a fixed column (`overflow: hidden`), `.tabs` takes the free height and
  scrolls (`overflow-y: auto`), so the brand and search stay at the top and the status line and theme button at the
  bottom. A soft fade at the foot of the list shows there is more below.
- Rows 32 → 28 px; trim the space above each group heading by a third.
- "Themes" (one page, AI) joins the Markets group, renamed **Markets & themes**. "System" (one page, Data health)
  leaves the list: the status pill in the sidebar foot ("808/809 series live · 5 stale") already opens it; put a small
  "Data health" label above the pill so the page is still findable by name (search finds it too).
- No page is renamed, moved between groups otherwise, or removed. Pins and folded groups keep working.

Acceptance: at 1440 × 900 with both region trees closed the list needs at most 200 px of scrolling (today the whole
column scrolls 434 px);
the brand, search and foot never scroll away; Ctrl+K and pins unchanged; phone menu unchanged.

## Step 7. Guardrails and paperwork

- `tools/design-check.js`: add `lone` (Step 3), `bar-hidden` (Step 5), a height limit of 1,350 px for
  overview → Today and 1,500 px for the Weekly brief at both widths, and the one-page A4 check for the brief
  (`page.pdf`, count pages). Remove allowances that are no longer needed.
- `CLAUDE.md`: the Strategist View and Weekly brief structure in three lines each; the Markets · Economy rule;
  the three-card minimum for a sub-tab; the two-level bar; the pager; "say each thing once on a page".
- `DESIGN_PLAN_2.md`: set the status line and note departures, as was done for the first plan.
- Delete nothing in `design/`: the mockups stay as the record of what was agreed.

## Order and size

One step per commit; run the design check before each push (and `node tools/vault-check.js` if `pstore` code is
touched, which no step should need).

| Step | What | Risk | Size |
|---|---|---|---|
| 1 | Strategist View → Today | low: one page, card keys unchanged | medium |
| 2 | Weekly brief | low: one page; re-test print | medium |
| 3 | Lone cards and pager | low: layout code only | small |
| 4 | Country pages: Markets · Economy | medium: bookmarks, see-also targets | medium |
| 5 | US and Regime bars | medium: three files push sub-tabs | medium |
| 6 | Menu | low | small |
| 7 | Guardrails and notes | none | small |

Steps 1 and 2 answer the owner's first complaint and can ship on their own. Build in the order 1 to 7.

## Do not change

- The private vault and everything that reads or writes through `pstore()`.
- Signal wording: research prompts, tested both ways, never recommendations; sell-side first on the Strategist View.
- Structured products wording ("indicative … not a quote"; generic names).
- The source and date line under every card; chart colours and tokens; card keys; data files and the pipeline.
- "Where we are", Markets → Performance and every page not named above.

## Decisions for the owner (all approved as recommended, 25 Nov 2026)

1. **Country pages become "Markets · Economy"** on the eleven smaller pages, replacing the four asset-class
   sub-tabs you asked for on 12 Nov; the US and Malaysia keep theirs, Singapore merges only rates and currency.
   **Approved.**
2. **What moved becomes a six-row list** with small bars, and the 14-bar chart goes. **Approved.**
3. **Talking points fold away** at the foot of the Strategist View, one click to open and copy. **Approved.**
4. **The brief loses Headlines and the Structures line**, and has three takeaways instead of nine. **Approved.**
5. **A pager under every sub-tab** ("← previous · next →"). **Approved.**
