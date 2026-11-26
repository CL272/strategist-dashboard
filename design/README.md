# Design mockups (reference only)

Static pages for `DESIGN_PLAN_2.md`. They are not part of the published site (only `docs/` is published).
Serve the repository root (`python3 -m http.server`) and open `design/strategist-view.html`,
`design/weekly-brief.html` and `design/click-through.html`. They load the real `docs/style.css` plus
`design/redesign.css`, so they follow the light and dark themes. Figures are a snapshot from 25 Nov 2026.

Design plan 3 (`DESIGN_PLAN_3.md`, 25 Nov 2026) adds `design/menu.html` (the menu as a tree, three states) and
`design/allocation.html` (the Allocation page), with their classes in `design/redesign3.css`.

Design plan 4 (`DESIGN_PLAN_4.md`, 25 Nov 2026) adds `design/portfolio.html` (the portfolio allocator: the Portfolio and
Add a fund sub-tabs on one page), with its classes in `design/redesign4.css`. Its figures are real, from the planning
prototype (weekly closes with dividends to 21 Nov 2026, in ringgit, three years). Built the same day; the build names its classes
`po-*` rather than the mock's `pb-*` (the Playbook already uses `pb-*`).

Design plan 5 (`DESIGN_PLAN_5.md`, 26 Nov 2026) adds `design/plan5.html` (China → Property, the two new US cards and the
excess-liquidity card on one page), with `design/redesign5.css` (the mock's note style only). Its figures are real, from the
planning prototype: the statistics bureau's releases to October 2026, Michigan's party table, FRED and the OECD. Built the same day.

Design plan 6 (`DESIGN_PLAN_6.md`, 26 Nov 2026) adds `design/portfolio2.html` (the one Portfolio sub-tab with unsaved
changes: change bar, Holdings, and the right-hand card on its three tabs), with its classes in `design/redesign6.css`
(already named `po-*`). Its figures are real, from the planning prototype (185 funds read from Yahoo on 26 Nov 2026).
