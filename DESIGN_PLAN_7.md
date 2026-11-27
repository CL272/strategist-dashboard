# Design plan 7: smooth factory overtime and the quits rate (two cards and their board rows)

**Status (27 Nov 2026): approved by the owner ("go with the defaults": all four decisions as recommended, see the end).
Build Steps 1 and 2 in order, one step per commit.**
Written after the owner asked of US → Economy → Labour leads: "does it make sense to smooth the factory over time and quit
rates so it doesnt spike too much? Idea is to get a sense. See if the correlation still holds with different lead times."
`CLAUDE.md` rules still apply.

## The answer: yes, with a 3-month average, and the leads hold

Tested on the dashboard's own data (to Oct 2026) with its own lead test (`leadStats`, searched over 2 to 18 months).
The average is trailing (this month and the two before), so nothing from the future is used.

**Factory overtime (6-month change) → payrolls (% on a year), 67 years**

| Version | Best lead | Correlation at that lead | Same month | Each half | Leads that pass the test | Turns a year |
|---|---|---|---|---|---|---|
| As published (today's card) | 7 months | +0.50 | +0.11 | +0.58 / +0.44 | 5 to 10 | 4.7 |
| **3-month average (proposed)** | **6 months** | **+0.54** | +0.19 | +0.63 / +0.47 | 4 to 10 | 2.7 |
| 6-month average | 5 months | +0.57 | +0.33 | +0.68 / +0.49 | 2 to 10 | 3.1 |

**Quits rate → wage growth (Atlanta Fed tracker), 25 years**

| Version | Best lead | Correlation at that lead | Same month | Each half | Leads that pass the test | Turns a year |
|---|---|---|---|---|---|---|
| As published (today's card) | 11 months | +0.91 | +0.72 | +0.95 / +0.87 | 2 to 18 | 3.3 |
| **3-month average (proposed)** | **10 months** | **+0.93** | +0.76 | +0.96 / +0.88 | 2 to 17 | 1.6 |
| 6-month average | 8 months | +0.93 | +0.81 | +0.97 / +0.89 | 2 to 14 | 1.8 |

What the figures say:

1. **Smoothing helps a little and costs about a month.** The correlation rises (+0.50 → +0.54; +0.91 → +0.93) and the line
   changes direction about half as often. The lead is one month shorter because a 3-month average is, on average, a month
   old. After the publication delay the usable lead goes from 6 to 5 months (overtime) and from 9 to 8 months (quits).
2. **Three months, not six.** A 6-month average adds almost nothing more for quits and, for overtime, mostly turns lead
   into "moves together" (the same-month correlation triples, +0.11 → +0.33).
3. **Why these two spike.** Both are published to one decimal. The quits rate has read 1.9, 2.0, 1.9, 2.0, 2.0, 1.9, 1.9, 2.1
   since February: a step of 0.1 is 5% of the level, so single months are mostly rounding. The wage tracker it is drawn
   against is already a 3-month average, so smoothing quits compares like with like.
4. **Quits: the exact month is not sharp.** Any lead from 7 to 13 months gives +0.89 to +0.92, so read it as "about 9 to 12
   months". The link also survives when the slow trend is taken out (12-month change against 12-month change: +0.82 at 9
   months against +0.35 in the same month; smoothed, +0.87 at 8 months), and it holds in each era (2001–2012 +0.96,
   2013–2026 +0.88, 2021–2026 +0.94).
5. **Overtime: the link is older than it looks.** By era, the best correlation was +0.66 in 1960–1979 (7 months), +0.49 in
   1980–1999 (8 months), +0.43 in 2000–2019 (11 months), +0.36 in 2010–2019, and none since 2022 (42 months only).
   Leaving the Covid months out changes nothing (+0.50 at 8 months). Smoothing does not repair this; the card should say it.

Before and after pictures (real data, prototype on the live page) were shown to the owner on 27 Nov 2026.

## Step 1. A 3-month average in the lead test, and the two cards (`docs/app.js`, `docs/leads.js`)

- **`llSeries(id, mode)`** takes an optional prefix `ma3:` (`ma3:level`, `ma3:chg6`, `ma3:yoy`, `ma3:chg12`): after the
  monthly map is built (`raw`), replace it with the trailing 3-month average (a month needs all three values), then apply
  the rest of the mode as now. The cache key keeps the whole mode. Add `llBase = mode => mode.replace(/^ma3:/, '')` and use it
  wherever a mode picks a format or a label: `llFmtF`, `llAxF`, `llLabel`, `llFmt` (app.js), `ldFmt` (leads.js). Nothing
  else changes: `leadStats`, `ldBestLead`, `monthlyOf` and `leadPair` already pass the mode through.
- **The two cards** (`lab_hours`, `lab_quits`; leads.js, in `buildLeads`): replace `leadCard(…, 7, …)` and `leadCard(…, 11, …)`
  with a render built on `ldLeadPair` + `ldLeadLabel` (as `renderGlDiff` does), so the lead on the button and in the note is
  the one **measured** for the version shown, not a typed number:
  - `seg`: "3M average" (default) · "As published" (state keys `labHrsSm`, `labQuitSm`).
  - `seg2`: "As measured" · "Lead +Nm" (default: at its lead; keep the state keys `labHrsLead`, `labQuitLead`, now '0' / '1').
  - Series names: "Overtime hours (3M average), 6-month change" and "Quits rate (3M average), %"; as published, the names of today.
  - Note: the intro sentence of today, then `ldLeadPair`'s measured sentence, then (3M average only) "Smoothed with a 3-month
    average: the figure is published to one decimal, so single months jump. The average is about a month old, so the lead
    is a month shorter than on the monthly figures." For quits add, computed live from `leadStats` over 2 to 18 months, the
    span of leads within 0.03 of the best ("any lead from 6 to 13 months fits almost as well"). For overtime add, computed
    live with `llCorrAt(A, B, k, Date.UTC(2000, 0, 1))`, "Since 2000 the link is weaker: +0.48 at the same lead."
  - Title lengths, ranges (`MAX`; overtime `earliest` 1990), sources and CSV stay as they are.
- **Check in the browser** (acceptance): 3M average shows Lead +6m, +0.54 against +0.19, halves +0.63 / +0.47 (overtime) and
  Lead +10m, +0.93 against +0.76, halves +0.96 / +0.88 (quits); "As published" shows +7m, +0.50 and +11m, +0.91 as today; the
  legend choice and the Y-axis reset still work; the sub-tab's height is unchanged; design check passes.

## Step 2. The same series on the board and in the pair list; notes (`docs/leads.js`, `CLAUDE.md`)

- **`LB_ROWS`**: `AWOTMAN` → mode `ma3:chg6`, name "Factory overtime hours, 6M change (3M average)"; `QUITS` → mode `ma3:level`,
  name "Quits rate (3M average)". One registry drives the Leading board, its tiles, breadth and the Strategist View / Weekly
  brief line, so they then show the same leads as the cards (6 and 10 months). The board's direction (`ldRead`: 3-month
  change against its noise band) flips less often on a smoothed series: check both rows read sensibly.
- **`LL_PAIRS`** (Correlation → Lead-lag): the two pairs use the same modes; labels add "(3M average)".
- **Not changed**: the tiles that show the published levels (`lv('AWOTMAN')`, `lv('QUITS')`); `AWHMAN` and the other board
  rows; the two quits signal rules in `pipeline/signals.py` (see decision 3).
- **`CLAUDE.md`**: a rule in the leading-indicators paragraph: a series published to one decimal may be drawn and tested as
  a trailing 3-month average (`ma3:` prefix); the card says so, offers "As published", and the lead shown is always the one
  measured on what is drawn; six months is too much (it turns lead into "moves together"). Record this plan as built.
- **Acceptance**: the Leading board shows overtime at 6 m and quits at 10 m, still counted as leads; the Strategist View and
  Weekly brief lines still render; design check passes (the brief stays one A4 page).

## Decisions (answered by the owner, 27 Nov 2026: "go with the defaults")

Every default in brackets below is approved. The alternatives were not chosen: do not build them.

1. **Smooth both with a 3-month average, shown by default, with "As published" one click away.** [Yes.]
2. **Use the same smoothed series on the Leading board and in Correlation → Lead-lag,** so every page quotes one lead. [Yes.]
3. **The two quits signals** ("quits rate 0.2 points lower / higher than 6 months earlier → wage growth") stay on the
   published figures. [Leave them: changing a rule changes its track record; it can be tested separately later.]
4. **Say on the overtime card that the link has weakened since 2000.** [Yes, one sentence, computed live.]

## Do not change

The lead test's rule; other cards and rows; the pipeline; the published levels in the tiles.
