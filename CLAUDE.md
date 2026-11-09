# Strategist Dashboard: notes for future changes

The owner cannot edit code; every change is made here and published by GitHub Actions to GitHub Pages.

## Layout and design rules (the owner's standing request)

Keep the dashboard clean and compact; nobody should have to scroll a long way.

- **Every page uses sub-tabs** (`SUBTABS` in `docs/app.js`), one topic per sub-tab. A new page or section goes into
  its own sub-tab rather than being appended below existing content.
- **Height budget: about 2,300 px per sub-tab** at 1440×900 (roughly 2.5 screens). Measure after every change
  (load each tab and sub-tab, read `document.documentElement.scrollHeight`); split a sub-tab or pair cards if over.
- **Pair half-width cards** side by side; use `wide` only for charts that need it, and avoid `tall`.
- **Long lists are capped**: tables show the essentials and fold the rest (`foldableGroups` with a default-fold
  rule, a "Show all" button, or a `<details>` box). Never dump hundreds of rows open.
- Keep KPI tiles relevant to the open sub-tab (`filterKpis`).
- Theme: navy + red tokens in `docs/style.css` (inspired by UOB colours; never use UOB's name or logo; the site is
  public). Chart palette was validated with the dataviz palette checker; keep series colours from the tokens.
- Dual-axis charts are the owner's preference for two-series comparisons (`drawPair`).

## Data and privacy

- Public data only; secrets (`FRED_API_KEY`, `ESTAT_API_KEY`) live in GitHub repository secrets, never in code.
- The repository and site are public: the idea log and starred watchlist stay in the browser (localStorage) only.
