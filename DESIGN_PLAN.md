# Design clean-up plan

Written 11 Nov 2026 after reviewing every page and sub-tab at 1440×900 (62 views). No new data in this
plan: it is about making what exists calmer to look at and faster to find. Build in the order below, one
package per commit, and re-measure after each (script in D9). `CLAUDE.md` rules still apply.

## What the review found

| Problem | Evidence |
|---|---|
| Every chart card repeats a full control strip | Under each chart: 9 range buttons + 2 date boxes + "Top bar"; above it 4–6 tool buttons (Stack, toggle, ↕Y, expand, PNG, CSV). About 110 px and ~17 controls per card, on ~150 cards. |
| Tables are dense and duplicated | Markets → Performance: 68 rows × 9 columns, every cell heat-filled, 18 fold headings, a checkbox per row. Strategist View → Where we are: a second, different-looking table of 46 rows × 10 columns covering much the same assets. |
| Long lists left open | Watchlist 206 rows; Data health 328; Calendar → Later 93; Positioning 28; Stress → Where everything stands 26; Lead-lag 26; Valuation scorecard 24. |
| Too many lines per chart | Asia → Across Asia has six charts with 6–8 lines each; legends run to 3 rows because labels repeat the measure ("Malaysia headline CPI YoY", "Korea exports YoY (USD, SA)"). |
| Tiles not matched to the open sub-tab | Regime shows the same 9 tiles (two rows) on five sub-tabs; AI shows the same 6 on all five; Liquidity 8 on both; Stress 7 on all three. |
| Explanations are long | Notes under cards run 300–580 characters (Liquidity scarcity 584, Policy monitor 535, Calendar 512). Source lines add 1–3 more lines per card. |
| Titles wrap | Half-width cards with a toggle wrap the title to 2–4 lines because the tool row takes the width. |
| Finding things relies on memory | 19 sidebar pages and 62 sub-tabs, no search. Asia is split across two pages (Asia Pacific; China & Japan). Regime has 7 sub-tabs in one ungrouped row. |
| An unexplained signal | Some cards have a blue left edge. It means "this card is on its own date range", but nothing says so. |

## D1. Card chrome diet (do first: biggest change for least risk)

One change to `makeCard` in `docs/app.js` and its styles fixes every card.

- **Range**: remove the strip under the chart. Put one small pill in the card header showing the range in
  force ("3Y"). Click opens a popover with the presets, custom dates, and "Follow page range". When a card is
  on its own range the pill is filled with the accent colour; drop the blue left edge.
- **Tools**: keep toggles (segmented buttons) visible. Move ↕Y, Stack/Overlay, PNG and CSV into one "⋯" menu;
  keep the expand icon. Target: at most 3 visible controls per card.
- **Header layout**: title on its own line, never wrapping more than once; toggles sit on a second row when
  the card is half-width. Titles ≤ 32 characters.
- **Sub-text**: one line maximum. Anything longer moves into the note.
- **Note**: show the first sentence only (the takeaway, with the number). The rest goes behind a
  "How to read ▸" disclosure, closed by default, remembered per card in localStorage.
- **Source**: one muted line truncated with an ellipsis; full text on hover/click. PNG export and print keep
  the full source.
- Drag-to-rescale on the y-axis, wheel zoom and double-click reset stay exactly as they are.

Acceptance: no card shows more than 3 controls at rest; no range strip anywhere; half-width card height falls
by ≥ 80 px; every sub-tab is shorter than before (expect about −15%).

## D2. One table component; rebuild Markets → Performance (the owner's example)

Create one `assetTable` renderer and use it for Markets → Performance and Strategist View → Where we are, so
the two look and behave the same.

- **Filter instead of fold.** Remove the 18 fold headings. Keep the asset-class chips; under Equities add a
  second chip row: Key markets (default) · US · Europe · Japan · China/HK · Asia ex-Japan · Sectors & styles ·
  AI · All. One flat list at a time, at most 15 rows, "Show all" for longer sets.
- **Key markets** default: about 16 rows, one per major market (S&P 500, Nasdaq, Euro Stoxx, FTSE, Nikkei,
  CSI 300, Hang Seng, KOSPI, Taiwan, STI, KLCI, Jakarta, Nifty, ASX, Bovespa, EM).
- **Columns**: Asset · Last · 1D · 1W · 1M · YTD · 1Y · 3-month sparkline. 3M, Range, vs 200-day and the σ
  column go behind a "Columns ▾" picker (choice remembered). Where we are uses the same table with 1D swapped
  for vs 200-day.
- **Quieter heat**: no full-cell fills. Numbers in blue (up) or red (down), plus a faint background only for
  moves beyond about 1σ for that column. Yields and spreads keep bp; a small "bp"/"%" unit sits in the column
  group header, not in every cell.
- **Charting rows**: replace checkboxes with a pin icon on hover. Pinned rows appear as removable chips above
  the chart ("S&P 500 ×"), max 6.
- Sticky header, 32 px rows, right-aligned tabular numbers, search box kept.

Acceptance: Performance opens with ≤ 16 rows and no fold headings; the two tables are the same component;
the page is ≤ 1,500 px tall.

## D3. Charts: fewer, clearer lines

- **Rule: at most 5 full-colour lines.** Charts with more use focus + context: the home markets (Malaysia,
  Singapore, US) in colour, the rest thin grey; hovering or clicking a legend chip brings one forward.
  Applies to Asia → Across Asia (six cards), Policy and short rates, Business confidence around the world,
  Energy/metals rebased, OECD leading indicators, Policy rates.
- **Short legend labels.** The card title names the measure; the legend names only the country or asset
  ("Malaysia", "Korea"). Add a `short` name to series built in `asia.py`/`cnjp.py` labels or a mapping in
  `app.js`. Legends fit one row.
- **≤ 4 lines**: label the line ends and hide the legend.
- Four horizontal gridlines, lighter than now; no vertical gridlines.

## D4. Tiles

- At most 5 tiles, one row, on every sub-tab. Define a tile set per sub-tab and use `filterKpis` everywhere
  (Regime, Stress, Liquidity, AI, Asia are the offenders).
- Tile = label, value, one short line. Move the "as of" date and source to a hover title. Equal heights.

## D5. Finding data

- **Search (Ctrl+K, "/", and a box at the top of the sidebar).** Index every series label, card title,
  sub-tab and page. Typing "palm", "KLCI", "BNM" or "ISM" lists matches grouped by page; Enter opens the page
  and sub-tab, scrolls to the card and flashes its border once.
- **One Asia page.** Merge Asia Pacific and China & Japan into "Asia" with grouped sub-tabs, in the style
  already used on Central banks: `Malaysia` Markets & rates · Economy | `Region` Singapore · Australia ·
  China · Japan | `Compare` Across Asia · Asian FX. Old links must still land in the right place.
- **Group Regime's 7 sub-tabs**: `Regime` Now · What's driving it | `Leading` Indicators · US ISM · Global
  cycle · Market signals | `Risk` Recession watch.
- Sidebar after this: Overview (5) · Macro (4) · Regions (1) · Markets (5) · Themes (1) · System (1).

## D6. Long lists: same caps everywhere

- Watchlist (206): default = starred names plus the 10 biggest risers and fallers; search and market chips;
  "Show all" pages 25 at a time.
- Data health (328): default = problems only, with a one-line count per source; "Show all" collapsed.
- Calendar → Later (93): next two weeks open, later weeks collapsed to a one-line header with a count.
- Positioning, Stress "Where everything stands", Valuation scorecard, Lead-lag: top 12 with "Show all".

## D7. Page header

- Top bar keeps the range presets; From/To boxes move behind a "Custom…" chip.
- Shorten page titles ("Asia Pacific: Malaysia, Singapore, Australia & region" → "Asia").

## D8. Consistency pass

- One spacing scale (8/12/16/24), one card radius, one shadow.
- Colour meaning: red = down/alert only. Keep series colours from the validated palette; when a chart has
  both a red series and a red alert marker, move the series to another token.
- Re-check dark mode and the weekly brief's A4 print after D1–D4.

## D9. Guardrails so it stays neat

- Add `tools/design-check.js` (Playwright): for every page and sub-tab fail if height > 2,300 px, visible
  tiles > 5, a table shows > 16 rows at rest, a legend takes > 2 rows, a card title wraps to 3+ lines, or a
  card shows > 3 controls. Run it before each push.
- Add these limits to `CLAUDE.md` under the layout rules.

## Order and size

| Step | Package | Risk |
|---|---|---|
| 1 | D1 Card chrome | Low: one shared function |
| 2 | D2 Tables (Markets, Where we are) | Medium |
| 3 | D4 Tiles | Low |
| 4 | D3 Charts | Medium: touches many cards |
| 5 | D5 Search, Asia merge, Regime grouping | Medium |
| 6 | D6 Long lists | Low |
| 7 | D7–D8 Header and consistency | Low |
| 8 | D9 Guardrails | Low |

## Decisions for the owner (defaults in brackets)

1. Merge the two Asia pages into one [yes].
2. Heat in tables: coloured numbers with faint fills for big moves only [yes], or keep full-cell heat.
3. Source lines: one truncated line with the full text on hover [yes], or always in full.
