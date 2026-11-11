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
- **Tiles: at most 5 per sub-tab, one row.** Pick them per sub-tab in `TILE_SETS` (label prefixes); `fitTiles` runs
  after every render and falls back to the first five.
- **Card headers stay quiet**: toggles (`seg`) are visible; everything else goes in the "⋯" menu (`c.menuEl`). The
  date range is the header pill (`range: false` for cards that follow the page range). Notes lead with one takeaway
  sentence; the explanation folds behind "How to read" automatically (`setNote`). Keep titles under ~32 characters.
- **Charts: at most 5 coloured lines.** `drawLines` greys the rest (home markets first) and shortens legend names;
  give series full names and let it shorten them.
- **Grouped sub-tabs**: a third element in a `SUBTABS` entry is its group label (see `cbwatch`, `asia`, `regime`).
- New cards, sections and markets are found by search (Ctrl+K) automatically; give cards a real title at build time.
- **Before every push**: serve `docs/` and run `node tools/design-check.js`. It fails on height, tiles, rows, title
  wrapping, header controls and script errors; deliberate exceptions are listed in its `ALLOW` table.
- Theme: navy + red tokens in `docs/style.css` (inspired by UOB colours; never use UOB's name or logo; the site is
  public). Chart palette was validated with the dataviz palette checker; keep series colours from the tokens.
- Dual-axis charts are the owner's preference for two-series comparisons (`drawPair`).

## Data and privacy

- Public data only; secrets (`FRED_API_KEY`, `ESTAT_API_KEY`) live in GitHub repository secrets, never in code.
- The repository and site are public: the idea log and starred watchlist stay in the browser (localStorage) only.
