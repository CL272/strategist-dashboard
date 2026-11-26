# Design plan 5: four charts the owner sent, and China property

**Status (26 Nov 2026): waiting for the owner's decisions (four, at the end). Nothing is built.**
Written after the owner sent four charts (Robinhood retail flows, Bloomberg's "G10 excess liquidity" against the S&P 500,
the Conference Board's consumer confidence with its split by party, the Redbook index) and asked: "Are you able to
replicate these chart properly? Also can you find details about China property health (eg: sales, prices, tier 123) in
charts". `CLAUDE.md` rules still apply; where a step changes a standing rule it says so.

**Reference mockup** (a static page on the real stylesheet; serve the repository root and open it):

| Mockup | Shows |
|---|---|
| `design/plan5.html` | China → **Property** (five tiles, five cards), the two new US cards (sentiment by party, weekly retail sales) and the excess-liquidity card. Every figure is real, from the planning prototype (26 Nov 2026) |

`design/redesign5.css` holds only the mock's own note style: the new cards use classes the dashboard already has.

## The short answer

Two of the four charts cannot be reproduced at all, one only in part, and one only through a different survey.
China property can be done properly for prices and for national sales and building.

| The owner's chart | Can it be reproduced? | What the dashboard can show |
|---|---|---|
| Robinhood customers' daily net buying (Sherwood) | **No.** It is Robinhood's own customer data, published only as pictures by its media arm. The daily retail-flow series others quote (JPMorgan, Vanda) are paid | Nothing new. The free retail-mood gauges are already on the dashboard (AAII, NAAIM, put/call, margin debt). Not built |
| G10 excess liquidity against the S&P 500 (Bloomberg) | **Only in part.** The recipe (real narrow-money growth minus economic growth) can be rebuilt on OECD data, but it is not Bloomberg's series, its scale differs, and the planning test finds only a weak link to the S&P 500 | One card, labelled a reconstruction, with the link the dashboard measures (Step 4) |
| Conference Board consumer confidence, with the split by party | **No** for the Conference Board: the index is licensed and the party split is in its paid dataset. **Yes** for the same idea from the University of Michigan | Michigan sentiment by party, monthly since February 2017 (Step 3). Michigan's headline index is already on US → Housing & consumer |
| Redbook weekly retail sales | **No.** Redbook Research sells it; the sites that display it do not license reuse | The Chicago Fed's weekly retail sales, free on FRED: the same idea, published twice a month instead of weekly (Step 3) |
| China property (sales, prices, tiers 1, 2 and 3) | **Yes** for prices by tier and by city, and for national sales, starts, completions and investment, from the statistics bureau's monthly releases, five years back. **No** for daily or weekly sales, developers' own sales, land sales and developer bonds: all paid | A new China → Property sub-tab (Steps 1 and 2) |

## What the planning checks found (26 Nov 2026)

1. **Robinhood.** The chart's source line is "Robinhood Markets": internal data. Robinhood publishes monthly operating
   figures only, with no daily net buying. No free daily retail-flow series exists.
2. **Redbook and the Conference Board.** Neither is on FRED or in any free feed. Trading Economics, the source of the
   owner's Redbook picture, shows the figures but forbids reuse. `CLAUDE.md` already rules this out ("public data only").
3. **Michigan sentiment by party exists and is free.** The University of Michigan publishes its index for Democrats,
   Independents and Republicans as "Table 5b" on `data.sca.isr.umich.edu/tables.php`: the "RB" link is an .xls of monthly
   readings (the link carries a key that changes, so the page is read first, as with FINRA). Read in the test: 158
   months, every month since February 2017 and scattered readings back to 1980; latest October 2026 (Democrats 36.6,
   Independents 42.4, Republicans 83.0). It also carries current conditions and expectations by party. The November
   preliminary figure appears only in a PDF addendum, so the card runs on final readings.
4. **A free weekly retail series exists.** FRED `CARTS` (Federal Reserve Bank of Chicago, retail and food services sales
   excluding autos, seasonally adjusted, weekly from January 2018; `CARTSR` after inflation). Year on year it was +9.6% in
   the week to 28 October 2026 (the Redbook picture shows 9 to 11%). Two honest differences: it is published twice a month
   (last update 16 November, data to 28 October), and its calendar has 48 weeks a year, so "a year earlier" is 48 rows
   back. FRED's own "change from a year ago" counts 52 rows, which is 13 months in this calendar (it shows +9.5%): do not use it.
5. **Excess liquidity, rebuilt.** OECD key indicators give narrow money, consumer prices and industrial production to
   September 2026 for the US, the euro area, Japan, the UK and Canada: 9 of the 11 G10 members and 97% of their GDP
   (Sweden and Switzerland stopped reporting narrow money to the OECD in 2018). The existing `money()` in
   `pipeline/leads.py` already fetches the first two. Prototype = GDP-weighted real narrow-money growth, year on year,
   minus GDP-weighted industrial-production growth:
   - **In US dollars** (money converted at monthly average exchange rates, deflated by US prices; 2006 to 2026): it fell
     from +6.4 points in February 2026 to −0.3 in August, the same direction as Bloomberg's picture. Correlation with the
     S&P 500's year-on-year change: 0.25 at its best lead (11 months), 0.23 at Bloomberg's 9 months.
   - **In local currencies** (1991 to 2026): +0.6 in August 2026, no collapse; correlation 0.10 at its best lead.
   - So the picture can be drawn, but the claim on Bloomberg's chart ("stocks follow excess liquidity by 3 to 6 months")
     is not confirmed on public data. Bloomberg's exact recipe is not published and its scale (about −1.5 to +2) is not ours.
6. **China: the statistics bureau's database is closed to cloud servers.** `data.stats.gov.cn` answers 403 ("UrlACL")
   both from this environment and from GitHub's servers. That is why `SAVQ_CHN` (China's quarterly household saving)
   has never loaded: the daily log says "JSONDecodeError … kept 0 previous". The China saving card falls back to the
   OECD annual rate, so nothing on the site is empty. DBnomics' copy of the bureau's property tables holds 12 months
   and stopped in February 2026: not usable.
7. **China: the bureau's press releases are open, also to GitHub's servers** (probe run 45750567935 on a temporary
   branch: every page answered 200 with its tables). Two releases a month carry everything needed:
   - **"70 cities"** (about the 16th): two HTML tables of 70 cities, new and second-hand homes, month on month and year
     on year. Tier averages are simple averages over the bureau's own lists (tier 1: Beijing, Shanghai, Guangzhou,
     Shenzhen; tier 2: 31 cities; tier 3: 35). Checked against the bureau's published tier figures for October 2026: 12 of
     12 agree within rounding (new homes on a year: −0.1%, −2.0%, −3.6%; second-hand: −0.4%, −4.1%, −5.0%).
   - **"National real estate market"** (about the 17th): one HTML table, year to date with growth on a year: investment,
     floor space under construction, newly started and completed, new-home floor space and value sold, second-hand
     transactions, each with the residential part; plus the regional split. October 2026: investment −21.6%, starts
     −24.4%, completions −26.6%, floor space sold −13.7%, sales value −14.3%.
   - **History**: the release list (`www.stats.gov.cn/sj/zxfb/`, 67 pages) reaches back to the releases for late 2021.
     The prototype read all of it: 67 list pages and 114 releases (59 price releases, December 2021 to October 2026; 55
     sales-and-building releases, November 2021 to October 2026, one a month with January and February together). All
     114 parsed, 70 cities in every price table, no month missing. It took about 25 minutes from this environment (the
     price pages are 0.3 to 1.4 MB each and about one connection in ten is reset), hence "at most 60 pages a run" below.
   - **Three traps the prototype met**: June's release is titled "上半年" (first half) and has no month number; the
     "of which: residential" rows repeat under every heading, so rows must be read in order under their parent; from
     2024 the sales rows are named "新建商品房…" (newly built) where they were "商品房…". The same table also carries
     unsold floor space and developers' sources of funds (including mortgage loans) in every month.
8. **A long price history exists quarterly.** BIS residential property prices for China on FRED (`QCNN628BIS`, and
   `QCNR628BIS` after inflation; 2005 to the second quarter of 2026; 70-city coverage).

## Step 1. China property data (`pipeline/cnprop.py` → `docs/data/cnprop.json`)

Files: new `pipeline/cnprop.py`; `pipeline/fetch.py` (add it to the isolated modules loop, as `funds` was);
`.github/workflows/update.yml` (the list of previously published files); `pipeline/health.py`; `pipeline/config.py`
(the two BIS series in the FRED list). No new Python package: the standard library's `re` and `html` read the tables.

- **Find the releases**: read list pages `index.html`, `index_1.html` … under `www.stats.gov.cn/sj/zxfb/`; keep links whose
  title holds "70个大中城市" (prices) or "全国房地产" (sales and building). One request every 1.5 seconds, a plain
  client name, three tries (the site resets about one connection in ten).
- **History once, then the newest**: the first full runs walk the list back to its end, at most 60 pages a run, and
  remember which releases are read (`_meta.done`, the `msb_years` pattern); afterwards each full run reads the first two
  list pages and any release not yet read. A release that fails to parse is skipped and named in `_meta.failed`; the
  file keeps everything it already had. The monthly figures are also written to `archive/` (as the spread history is),
  because the bureau's list holds about five years and older releases will drop off it.
- **Prices** (`CNP_*`, monthly): for new and second-hand homes, the tier means month on month and year on year
  (`CNP_NEW_T1_YOY` … `CNP_OLD_T3_MOM`), the 70-city mean, the number of cities whose price rose on the month
  (`CNP_NEW_UP`, `CNP_OLD_UP`), and a chained level from the monthly changes (first month = 100). The latest month's
  table of 70 cities (English names from one fixed list in the module, tier, the four changes) goes in as `cities`.
  The three tier lists live in one place, `TIERS`, with the bureau's note as the source.
- **Sales and building** (`CNR_*`, monthly, January and February as one reading dated February): the year-to-date value
  and the published growth for investment, starts, completions, new-home floor space sold, sales value (each with its
  residential part where published) and second-hand transactions; from the year-to-date values, single months by
  difference and a 12-month running total; average price = sales value ÷ floor space; unsold floor space at month end.
  The published growth is on a "comparable basis" (the bureau restates last year's base), so it is stored as published
  and never recomputed from the levels.
- **Long history**: `CN_HPI_BIS`, `CN_HPI_BIS_REAL` from FRED, quarterly.

Acceptance: every month from the oldest listed release to the latest present for both releases, or named in
`_meta.failed`; tier figures for three test months (April 2022, December 2024, October 2026) within 0.05 point of the
bureau's published tier figures; 70 cities in every month's two tables; a run with the site blocked keeps the old file;
`cnprop.json` under 300 KB; Data health lists the monthly series.

## Step 2. China → Property (a new sub-tab, last on China)

Files: `docs/more.js` (a `CNP_SUB`, pushed in `init` as `MYF_SUB` is, so old links keep their place), `docs/app.js`
(`TILE_SETS.cn.Property`, `ASOF_FILES` if the cards read the file directly), `docs/index.html` only if a tile strip is needed.

- **Five tiles**: Tier 1 new homes · Tier 2 · Tier 3 (each: % on a year, the month's change beneath) · Cities with rising
  prices (new homes, "n of 70") · New-home floor space sold (year to date, with value beneath).
- **Home prices by city tier** (half): three lines; toggle New · Second-hand · Since Dec 2021 (the chained level) ·
  Long history (the BIS quarterly index, one line, with a second toggle for "after inflation" only if it fits the header rule).
- **Cities where prices rose** (half): count of 70 on the month, new and second-hand.
- **New-home sales** (half): toggle Growth (published, year to date, floor space and value) · 12-month total ·
  Average price · Unsold stock.
- **Building: starts, completions, investment** (half): published growth, year to date; the note gives the latest three.
- **Prices by city** (wide table): view chips "Tier 1 and movers" (tier 1's four cities, then tier 2's four weakest
  and four strongest on a year) · Tier 2 · Tier 3, each capped at 16 rows with "Show all" (`capRows`).
- Notes lead with one sentence of figures; "How to read" explains tiers, the year-to-date basis, the comparable-basis
  caveat and that January and February are one reading. Wording describes; it does not call a bottom.

Acceptance: the sub-tab is within the height budget at 1440 and 1280 and passes at 390px; each tile equals its card's
latest figure; old China links still open the same sub-tabs; no lone card; design check passes.

## Step 3. US: sentiment by party, and weekly retail sales

Files: `pipeline/sentiment.py` (`umich_party()`), `pipeline/config.py` (`CARTS`, `CARTSR` in the FRED list),
`pipeline/signals.py` and `docs/app.js` (publication delays: `lag_of`, `PUB_LAG`), `docs/app.js` (two cards, `SUBTABS.us`).

- **Michigan by party**: read `tables.php`, take the Table 5b "RB" .xls link, parse with `pandas` and `xlrd` (both
  already installed). Series `UMS_DEM`, `UMS_IND`, `UMS_REP`, plus current conditions (`UMC_*`) and expectations (`UME_*`);
  months in which the question was not asked are simply absent.
- **Card "Consumer sentiment by party"** (US → Economy → Housing & consumer): three lines from 2017 (Democrats `--s1`,
  Republicans `--s2`, Independents `--s10`; full names, `drawLines` shortens them); toggle Sentiment · Expectations ·
  Current conditions; the note gives the three latest readings and the gap between the two parties.
- **Card "Weekly retail sales"** (same sub-tab): bars, % on a year (48 rows back), three years by default; toggle
  Value · After inflation; the note says how far behind the series runs.
- The sub-tab then holds six cards in three pairs (starts, home prices, mortgage rate, sentiment, by party, weekly retail).

Acceptance: the three party series end within one month of Michigan's latest final reading; `CARTS` year on year for
the week to 28 October 2026 is +9.6% (against the week to 28 October 2025); the sub-tab stays within the height budget.

## Step 4. Excess liquidity (only if decision 2 says build)

Files: `pipeline/leads.py` (`money()`: add industrial production `PRVM`, activity `BTE`, to the OECD call; a new derived
series), `pipeline/config.py` (`DEXUSUK`, `DEXCAUS` beside the two FRED exchange rates already fetched), `docs/leads.js`
(one `LB_ROWS` line and one card).

- **`LD_EL_G10`** = GDP-weighted real narrow-money growth, year on year, in US dollars (monthly average exchange rates,
  US consumer prices), minus GDP-weighted industrial-production growth, for the US, euro area, Japan, UK and Canada.
  The May 2020 break in US narrow money is spliced as `money()` already does. The label says "a reconstruction on public
  data"; Bloomberg is named only as the idea's source, never as the series.
- **`LB_ROWS`**: one line with target `['SPX', 'yoy', …]`, so the Leading board, breadth and tiles pick it up and the
  lead shown is the one `ldBestLead` measures. The planning test expects "context" (correlation about 0.25).
- **Card "Excess liquidity vs the S&P 500"** (Regime & Leading → Global breadth & money, beside "Global real money"):
  dual axis (`drawPair`), toggle "As measured / Lead" through `ldLeadLabel`; the note states the measured link in words.

Acceptance: the prototype's figures are reproduced (August 2026 about −0.3; February 2026 about +6.4); the card shows
the measured lead or "context", never a typed one; the sub-tab stays within the height budget with no lone card.

## Step 5. Guardrails and notes

- `CLAUDE.md`: China property (the two releases, the tier lists in one place, comparable-basis growth stored as
  published, the bureau's database is closed to cloud servers so never build on `data.stats.gov.cn`); Michigan by party;
  CARTS and its 48-week year; excess liquidity as a reconstruction; Robinhood, Redbook and the Conference Board listed
  beside the S&P Global PMIs as licensed, never scraped or shown.
- `pipeline/leads.py`: drop the `savings_china` call (it has never worked and cannot); the China saving card keeps the
  OECD annual rate. `design/README.md`; this plan's status and an "As built" list.

## Later, if wanted (not in this plan's steps)

1. **China household saving, quarterly**: the bureau's quarterly income-and-spending release could be read the same way
   as Step 1, replacing the series the closed database never delivered.
2. **Developer shares as a daily gauge**: a mainland real-estate share fund is on Yahoo (512200.SS).
3. **A 70-city map or heat table through time** (which cities turned first).

## Not possible on free, public data (so not planned)

Robinhood, JPMorgan or Vanda retail flows; the Redbook index; the Conference Board's index and its party split;
Bloomberg's own excess-liquidity series; China's daily 30-city sales, the top-100 developers' monthly sales, land
sales and developer bond prices (Wind, CRIC, CREIS: all paid).

## Order and size

One step per commit; run the design check before each push.

| Step | What | Decision | Risk | Size |
|---|---|---|---|---|
| 1 | China property data from the bureau's two monthly releases | 1 | medium: reads web pages, so a layout change at the bureau breaks it (it then keeps the old data and says so) | medium |
| 2 | China → Property sub-tab | 1 | low | medium |
| 3 | Michigan sentiment by party; weekly retail sales | 3 | low | small |
| 4 | Excess liquidity card | 2 | low to build; the series itself is weak | small |
| 5 | Guardrails and notes | none | none | small |

## Do not change

- The vault, the allocator, the Evidence board, signals wording: untouched by this plan.
- "Public data only": nothing in this plan reads a page that forbids reuse.

## Decisions (for the owner)

Defaults are in brackets; "go with the defaults" approves all four.

1. **China property.** [Build the Property sub-tab from the bureau's releases: tiers and cities for prices, national
   sales and building, five years of monthly history plus the BIS quarterly index from 2005.]
   Alternative: prices only, without sales and building.
2. **Excess liquidity.** [Build it, labelled as a reconstruction, in US dollars, showing the weak link it measures.]
   Alternative: do not build it, since it is not Bloomberg's series and the test does not support the chart's claim.
3. **The two US cards.** [Build both: Michigan sentiment by party, and the Chicago Fed's weekly retail sales.]
   Alternative: either one alone.
4. **Robinhood retail flows.** [Build nothing: no public data.] Tell me if a paid source is ever available to you.
