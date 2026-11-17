# Strategist Dashboard: notes for future changes

The owner cannot edit code; every change is made here and published by GitHub Actions to GitHub Pages.

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
- **Page frame (redesign, Nov 2026):** one sticky header row (`.pagebar`: title and section left, date range right; the
  greeting only on the Strategist View); then the sub-tab bar (underlined text on one line, scrolls sideways, never
  wraps); then tiles; then cards. Flat cards (no shadows, hairline borders). Colour belongs to data; navy marks
  "selected". The menu is a light panel (`docs/ui.js`: foldable groups, up to five pinned pages).
- **Sources live in the card's "⋯" menu** (`setSource` fills it) and in CSV and PNG downloads; only licence credits
  (Cboe, Vast.ai, GetDeploying, Zillow: `SRC_KEEP`) stay on the card face. Text columns in tables use class `l` so they
  wrap; numbers never wrap. On phones the first table column stays put while the rest scrolls.
- **Card headers stay quiet**: toggles (`seg`) are visible; everything else goes in the "⋯" menu (`c.menuEl`). The
  date range is the header pill (`range: false` for cards that follow the page range). Notes lead with one takeaway
  sentence; the explanation folds behind "How to read" automatically (`setNote`). Keep titles under ~32 characters.
- **Charts: at most 5 coloured lines.** `drawLines` greys the rest (home markets first) and shortens legend names;
  give series full names and let it shorten them.
- **Grouped sub-tabs**: a third element in a `SUBTABS` entry is its group label (see `cbwatch`, `us`, `regime`).
- **Region and country pages hold everything about one place, split by asset class.** Sub-tabs always in this order,
  leaving out any with no data: **Equities · Rates & bonds · Currency · Economy** (a page may split one in two to stay
  within the height budget, e.g. Malaysia "Sectors", US "Sectors & styles", the US Economy group).
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
- **Structured products** live in `docs/sp.js` (page), `docs/sp-model.js` (pricing maths, shared with the Monte Carlo worker
  `docs/sp-worker.js`) and `pipeline/structured.py` (data). Generic structure names only, never issuer or product brand
  names; every figure says "indicative … not a quote". Run `node tools/sp-check.js` after any change to the model or the
  surfaces: it checks identities and listed put prices (within 15%) and must pass before pushing. The owner's notes stay
  in localStorage (`sd-notes-v1`), never in the repository.
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
- **Australia's RBA pages** live in `docs/au.js` (What the RBA is watching, Labour market, Housing & households) with data
  from `pipeline/rba.py` (RBA tables) and `pipeline/abs_au.py` (ABS Data API). The RBA's NAIRU and forecasts have no feed:
  after each Statement on Monetary Policy (Feb, May, Aug, Nov) update `RBA_SMP` in `pipeline/config.py`, including
  `asof`; data health flags it after 100 days. The lean rules in `AU_DRIVERS` are printed in the card's note: change both together.
- New cards, sections and markets are found by search (Ctrl+K) automatically; give cards a real title at build time.
- **Before every push**: serve `docs/` and run `node tools/design-check.js`. It fails on height, tiles, rows, title
  wrapping, header controls, a wrapping sub-tab bar, the first card starting more than 260px down, and script errors;
  then repeats at phone width (390px: bar, first card within 380px, no sideways scroll, no squeezed titles).
  Deliberate exceptions are listed in its `ALLOW` table.
- Theme: navy + red tokens in `docs/style.css` (inspired by UOB colours; never use UOB's name or logo; the site is
  public). Chart palette was validated with the dataviz palette checker; keep series colours from the tokens.
- Dual-axis charts are the owner's preference for two-series comparisons (`drawPair`).

## Data and privacy

- Public data only; secrets (`FRED_API_KEY`, `ESTAT_API_KEY`) live in GitHub repository secrets, never in code.
- The repository and site are public: the idea log and starred watchlist stay in the browser (localStorage) only.
