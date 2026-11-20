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
- **Page frame (redesign, Nov 2026):** one sticky header row (`.pagebar`: title and section left; the greeting only on the
  Strategist View). The page-wide date bar was removed (owner, 19 Nov 2026): each card's range pill sets its dates, cards
  without their own `defaultRange` use 3Y; then the sub-tab bar (underlined text on one line, scrolls sideways, never
  wraps); then tiles; then cards. Flat cards (no shadows, hairline borders). Colour belongs to data; navy marks
  "selected". The menu is a light panel (`docs/ui.js`: foldable groups, up to five pinned pages).
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
- **Y-axis by hand, back in one click**: dragging the axis numbers (or Ctrl + wheel over them; a plain wheel scrolls the
  page) sets `c.yRange`; the header then shows "↕ Auto" (`yAutoReset`), and a new date range, toggle or layout clears it.
- **Axis labels never repeat a rounded number**: when an axis's ticks fall between whole numbers, `valAxis` and
  `fixAxisDecimals` relabel that whole axis with 2 decimals (owner's request). Keep axis formatters on `fmtNum`.
  A series moved forward to show a lead carries `_src` (the unshifted series) so its card's date stays true.
- **Charts: every line in colour, up to ten** (owner's request, 19 Nov 2026; readability over the house palette). `drawLines`
  greys only lines beyond ten (home markets first) and shortens legend names; give series full names and let it shorten them.
  Slots `--s1`…`--s10` in `style.css`. Asia-Pacific economies keep one colour on every chart (`COUNTRY_TOK`; `seriesCard`
  uses it when every id has a country prefix). The Playbook's faint past-episode fan is deliberate and stays grey.
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
- **Signals show both directions alike**: bullish and bearish (sell-side) rules are tested the same way; label them with
  `sigDirLab`/`sigSide` (a rising yield reads as bearish for bonds) and state bearish odds as "down X%". `signals.py` writes
  `off_since` (first month off); rules with a record that ended in the last three months are the exit prompts in
  "Signals that just ended". The Strategist View shows them in two columns (`ov_signals`, sell-side first).
  Signals are research prompts, never recommendations.
- **Structured products** live in `docs/sp.js` (page), `docs/sp-model.js` (pricing maths, shared with the Monte Carlo worker
  `docs/sp-worker.js`) and `pipeline/structured.py` (data). Generic structure names only, never issuer or product brand
  names; every figure says "indicative … not a quote". Run `node tools/sp-check.js` after any change to the model or the
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
  GROSS rate `SAVQ_*` and annual NET rate `SAVA_*`; `savings_china`: NBS per-capita income and spending, `SAVQ_CHN`, tried
  each run and skipped if the site does not answer). Page code is in `docs/leads.js` (`buildSavings`): Regime & Leading →
  Household saving (table, quarterly, annual) plus one card on the US, Europe, UK, Japan, Korea and China pages (Australia's
  is in au.js). Gross and net rates differ by several points: never put them on one axis as if comparable. Malaysia,
  Singapore, Taiwan, Indonesia and India publish no household rate.
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
- The repository and site are public. Everything the owner writes (ideas, watchlist, house views, model portfolio,
  signal watch and dismiss, structured notes, the Notebook) goes through `pstore()`, which is the **private vault**
  (`docs/vault.js`) once it is set up: AES-256-GCM with a key derived from the owner's passphrase (PBKDF2-SHA-256,
  600,000 rounds) in the browser; only ciphertext is stored or synced. A new private item must use a key listed in
  `VAULT_ITEMS` and read and write through `pstore()`, never `localStorage` directly. Sync (optional) writes the same
  encrypted file to the owner's own private GitHub repository with a fine-grained token kept inside the vault; the
  token and the passphrase never enter this repository. A forgotten passphrase cannot be recovered: never add a back door.
- After any change to `docs/vault.js` or to how private data is stored, run `node tools/vault-check.js` and
  `node tools/vault-sync-check.js` (local server up); both must pass before pushing.
- A login screen in front of the public site would only be cosmetic (the files are public); hiding the whole site needs
  other hosting (Cloudflare Access), described as WP73 in PLAN.md and not built.
