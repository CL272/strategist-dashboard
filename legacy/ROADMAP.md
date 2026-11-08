# Strategist Dashboard — proposed build

Where this goes from a Fed-plumbing monitor to something you can run an
allocation conversation off. Everything below is costed against **what free,
official data can actually deliver** — the source audit is in the last section,
and the gaps are stated plainly rather than papered over.

---

## 1. Three things to deal with before anything new gets built

### 1.1 Your credit spread history is being deleted, one day per day

FRED truncated the **entire ICE BofA family to a rolling 3-year window in
April 2026**. It is on the series pages now:

> "Starting in April 2026, this series will only include 3 years of
> observations. For more data, go to the source."

This is already in your cache. `HY OAS`, `BB OAS` and `CCC & lower OAS` all
begin **2023-08-29** and nothing earlier exists any more. Every refresh drops
another day off the front.

Earlier I put this down to a quirk of your local cache. That was wrong — it is
FRED deleting history upstream, and it is permanent.

What it costs: HY OAS with no 2020 and no 2008 cannot be percentile-ranked
against anything meaningful. The "Stress Percentiles" tab is currently ranking
today against three years of post-COVID calm, which flatters it badly.

**Fix:** make the refresh *append-only* for these series — keep every
observation ever seen in a separate archive parquet and merge on load, instead
of overwriting the block with whatever FRED hands back today. Small change,
and it has to happen before more history rolls off. One-session job.

Permanent-history substitutes that are not going anywhere, for the long
percentile windows: `BAA10Y` (Moody's Baa minus 10y, 1986→), `BAMLH0A0HYM2`
archived forward from today, and the NFCI credit sub-index (1971→).

### 1.2 S&P and Dow on FRED are now a rolling 10-year window

`SP500` and `DJIA` only carry 2016→present, and both pages carry an S&P Dow
Jones reproduction restriction. Not a problem today — you don't use them — but
it rules them out as the US equity spine. `NASDAQCOM` (1971→) and Shiller
(1871→) are the unencumbered long US series.

### 1.3 Two tabs are in the wrong module

**Term Premium & Yields** and **Neutral & Curve** are fixed income, not Fed
plumbing. They move to the new Fixed Income section rather than being rebuilt
there — otherwise the same chart exists twice and the two drift apart.

---

## 2. Proposed structure

Your three sections plus an overall, with liquidity/stress split out from the
calendar because they answer different questions — one is "what happens this
week", the other is "how fragile is the system right now".

```
STRATEGIST VIEW          one screen. cross-asset state, what moved, what's next
─────────────────────────────────────────────────────────────────────────────
GLOBAL EQUITY            US · Europe · Asia · Japan · Malaysia
FIXED INCOME             US · Japan · Euro area · Malaysia
MACRO & POLICY           calendar · inflation & activity by region · policy rates
LIQUIDITY & STRESS       (what you already have, trimmed from 13 tabs to 9)
```

### 2.1 Strategist View — the overall page

The screen you open before an IC meeting. Nothing new is fetched here; it reads
the four modules and answers four questions.

| Block | Content |
|---|---|
| **Where we are** | Cross-asset grid: each region's equity 1w/1m/3m/12m, in local currency **and in MYR**; 10y yield and 1m change; credit spreads; USD/MYR, USD/JPY, EUR/USD; VIX. |
| **What moved** | Same universe ranked by *z-score of the weekly change against its own trailing 5-year distribution* — so a 15bp move in JGBs outranks a 15bp move in Treasuries when it should. This is the bit that stops you missing something. |
| **How fragile** | Existing composite stress score + the block breakdown. |
| **What's next** | Next 10 days from the calendar, already built. |

One deliberate omission: **no single "risk on / risk off" verdict.** A dashboard
that prints a regime label is a dashboard that will eventually print a confident
wrong one in front of your IC. The quadrant framing (growth ↑↓ × inflation ↑↓)
can go on the Macro page with its inputs visible; it should not be the headline.

### 2.2 Global Equity

The honest position: **price, trend, relative strength and currency effects are
fully buildable. Valuation is not, outside the US and Japan.** Forward P/E
anywhere requires analyst consensus, which is the core product of exactly the
vendors that cost money. There is no free workaround and I would rather say so
now than build a box that stays empty.

| Tab | What's in it | Data |
|---|---|---|
| **Regional performance** | Rebased cumulative return, 12m momentum, drawdown from peak, distance from 12m average — US, Germany, France, UK, Japan, Korea, India, China on one comparable base (2015=100) | OECD `SPASTT01*` on FRED, monthly, 1955–1999 starts, still updating |
| **In MYR terms** | The same regions converted at spot, plus a local-vs-MYR return decomposition — how much of the last 12 months was the market and how much was the ringgit | FRED `DEX*` daily FX |
| **US & Japan daily** | Daily close, 50/200-day averages, drawdown, 20d/60d realised vol | `NASDAQCOM` 1971→, `NIKKEI225` 1949→ |
| **Valuation** | US CAPE and trailing P/E, 1871→; **equity risk premium = Shiller earnings yield − 10y TIPS real yield**; Japan trailing PER/PBR | Shiller / DataHub mirror (public domain), JPX monthly xlsx, FRED `DFII10` |
| **Risk appetite** | VIX, VXN, VIX minus realised vol, HY OAS, Asia EM corporate OAS | FRED |

The equity risk premium chart is the one worth building carefully. It is the
only genuinely free cross-check on whether US equities are cheap or dear against
the bond market, it goes back to 2003 on the real-yield leg, and it is the kind
of thing that carries weight in a strategy note.

**Monthly is the honest frequency for the cross-region spine.** The OECD series
are monthly. Daily cross-region comparison would need a price vendor.

**Malaysia is a hole.** See §3 — it needs a decision from you.

### 2.3 Fixed Income

This is the best-covered of the three, and the biggest gap versus what your job
actually needs. Full daily curves are available free and official for three of
your four markets.

| Tab | What's in it | Data |
|---|---|---|
| **Curves** | Full par curve per market, today vs 1m / 3m / 12m ago, small multiples across all four | US Treasury daily CSV (1M–30Y + TIPS real curve, per-year files); **MOF Japan `jgbcme_all.csv`, 15 tenors 1Y–40Y, daily, back to 1974**; ECB `YC` API (3M–30Y AAA, daily, 2004→, no key) |
| **Shape** | 2s10s, 3m10y, 10s30s per market, against recession shading and policy rate | same |
| **Real yields & breakevens** | US 5y/10y/30y real, `T10YIE`, `T5YIFR`; Japan real via MOF yield − CPI | FRED + MOF + e-Stat (already fetched) |
| **Cross-market** | US−JP and US−MY 10y differentials against USD/JPY and USD/MYR; **and MYR-hedged UST yield** ≈ UST 10y − (SOFR − KLIBOR/OPR) | FRED + MOF + BNM |
| **Credit** | US IG/HY OAS, **Euro HY** `BAMLHE00EHYIOAS`, **Asia EM corporate** `BAMLEMRACRPIASIAOAS` — all free on FRED, all on the 3-year clock, all archived forward from day one | FRED |
| **Term premium / neutral** | The two tabs moved out of Liquidity | existing |

The hedged-yield chart is the highest-value single addition in this whole plan
for a Malaysian multi-asset book. It answers "does a Malaysian investor actually
get paid to own Treasuries this month" in one line, it is computable entirely
from free data, and nobody's terminal screen shows it by default.

### 2.4 Macro & Policy

Mostly assembly of things already fetched but only used once.

- **Calendar** — as built. Moves here from under the Stress tab.
- **Inflation & activity by region** — you are *already downloading* Japan CPI,
  Tokyo CPI and unemployment from e-Stat, and Malaysia CPI, IPI, unemployment,
  trade and GDP from OpenDOSM, purely to fill in one column of the calendar.
  Charting them is nearly free work and gives you a genuine four-region
  inflation and activity panel.
- **Policy rates** — Fed, ECB, BOJ, BNM on one axis with market-implied
  direction where free (US via the 3m-vs-spot spread; no free OIS curve).
- **Growth & Activity** — the existing US regional-survey composite, claims and
  Sahm rule, unchanged.

### 2.5 Liquidity & Stress — what I'd cut

You asked me to say if anything isn't pulling its weight. Going tab by tab:

| Tab | Verdict |
|---|---|
| Reserve Scarcity (Waller / Acharya) | **Keep.** The sharpest thing in the dashboard and your own framing. |
| Balance Sheet, Money Markets | **Keep.** SOFR–IORB is the real-time stress tell. |
| M2 Dynamics | **Merge** into Balance Sheet. Slow-moving; doesn't need its own tab. |
| Excess Liquidity | **Keep**, one chart. |
| Neutral & Curve, Term Premium | **Move** to Fixed Income. |
| Financial Conditions (NFCI), Credit Spreads | **Keep.** |
| Stress Percentiles | **Keep, but it needs the archive fix first** — it is currently ranking against a 3-year window on the spread series. |
| Composite Stress Panel | **Keep**, and make the block scores literal percentiles rather than z-score blends, so "83rd percentile since 2010" means exactly that. |
| Lead/lag + cross-correlation | **Keep with the health warning already on it.** Scanning every lead and reporting the best correlation finds a relationship in noise roughly always. Fine as a diagnostic, dangerous as a forecast. |

That takes 13 tabs to 9 and removes both duplications.

---

## 3. The Malaysia problem — this one needs your call

Malaysia is the only region where the free-and-official route genuinely fails,
in both asset classes. What I confirmed:

**Equity.** The FTSE Bursa Malaysia KLCI is FTSE Russell licensed. Bursa sells
history as a commercial package and blocks automated traffic. Bank Negara's
Open API has twelve datasets and none are capital markets. data.gov.my has
CPI, trade and labour but no financial-market data. FRED has one Malaysia
equity series — an annual volatility statistic that ended in 2021. **There is
no free official KLCI price history.**

**Government bonds.** BNM *does* publish a complete free official MGS and GII
curve, 1Y to 30Y, daily — at `financialmarkets.bnm.gov.my/ytm-matrix`. But it
is a rendered web page inside a single-page app: no CSV, no export button, no
API endpoint. The Open API deliberately excludes bond yields. `bondinfo.bnm.gov.my`
is dead. BIX Malaysia is registration-gated and BPAM-sourced. FRED has no
Malaysian yield series at all.

Three ways forward, and they are genuinely different:

**(a) Sanctioned only.** No KLCI, no MGS curve. Malaysia gets OPR, KLIBOR,
interbank and deposit rates from the BNM Open API, plus CPI/IPI/trade/GDP from
OpenDOSM. Honest, zero legal exposure, and Malaysia stays visibly thinner than
the other three regions.

**(b) Manual drop folder.** A `manual/` directory the dashboard reads if the
file is there and reports "not available" if it isn't. You drop in a KLCI
history — or MSCI regional indices, or forward P/E — exported from whatever you
are already licensed to use at work. The dashboard never touches a licensed
feed itself; it just reads a CSV you put there. This also future-proofs every
other gap in this document.

**(c) Grey source.** Stooq or Yahoo. Both unofficial. Stooq's robots.txt
explicitly disallows the download path. Yahoo's terms say personal use only.
Both break without warning. I'll build it if you want it, with a comment in the
code saying exactly what it is — but I'm not going to pretend it's clean.

There is also a fourth, partial route for MGS specifically: BNM's Data Download
menu offers **trade-level bond data including traded yield per ISIN**, which is
a sanctioned bulk file. A curve can be approximated from it. More work, and it
is transaction data rather than an indicative curve, but it is the only
legitimate bulk path to Malaysian yields I could find.

My recommendation: **(a) + (b)**. Ship the sanctioned version, and put the
manual folder in so the moment you have a legitimate export, it appears.

---

## 4. Suggested build order

Small steps, each one reviewable, in the order that puts usable output in front
of you soonest.

| # | Step | Why first |
|---|---|---|
| 0 | Append-only archive for the ICE BofA series | History is being lost right now |
| 1 | **Fixed Income: Japan (MOF) + US (Treasury) curves** | Highest data certainty, biggest gap vs your job, two clean CSV sources |
| 2 | Fixed Income: euro area (ECB) + cross-market + hedged yield | Completes three of four markets |
| 3 | Malaysia rates panel, per your answer in §3 | Depends on your call |
| 4 | **Global Equity: OECD regional spine + MYR translation** | One FRED block, immediately useful |
| 5 | Global Equity: US/Japan daily, valuation, ERP | Shiller and JPX both need their own fetchers |
| 6 | Navigation restructure + tab merges and moves | Do it once, after the content exists |
| 7 | **Strategist View** | Can only be built on top of everything else |
| 8 | Macro & Policy: chart the Japan/Malaysia series already being fetched | Cheap, mostly wiring |

Steps 1, 4 and 7 are the ones that change how you use the thing.

---

## 5. Source audit

Everything below was checked against the live source, not recalled. Anything
not confirmed is marked.

### Confirmed good

| Source | Gives | Key | History |
|---|---|---|---|
| **MOF Japan** `jgbcme_all.csv` | JGB par curve, 15 tenors 1Y–40Y, daily | none | 1974-09-24 → |
| **US Treasury** `daily-treasury-rates.csv` | UST curve 1M–30Y + TIPS real curve, daily | none | per-year files |
| **ECB Data Portal** `YC` dataset | Euro area AAA curve 3M–30Y, daily | none | 2004-09-06 → |
| **FRED** `SPASTT01{JP,GB,KR,IN,CN,DE,FR,US}M661N` | Share price index, monthly, 2015=100 | none | 1955–1999 starts |
| **FRED** `NIKKEI225` | Daily close | none | 1949-05-16 → |
| **FRED** `NASDAQCOM` / `NASDAQ100` | Daily close | none | 1971 / 1986 → |
| **FRED** `VIXCLS` / `VXNCLS` | Daily | none | 1990 / 2001 → |
| **FRED** `IRLTLT01JPM156N`, `IRLTLT01DEM156N` | 10y govt yield, monthly | none | still updating |
| **FRED** `BAMLHE00EHYIOAS`, `BAMLEMRACRPIASIAOAS` | Euro HY, Asia EM corp OAS | none | 3-year rolling ⚠ |
| **Shiller** via DataHub mirror | US price, earnings, CAPE, monthly | none | 1871 → , public domain |
| **JPX** PER/PBR xlsx | Japan trailing PER and PBR, monthly | none | 2005 → |
| **data.gov.my** `interestrates` | MY deposit/base/lending rates, monthly | none | 1997 → |
| **BNM Open API** | OPR, interbank, base rates, FX, KLIBOR-adjacent | none | varies |

### Confirmed unavailable

- Forward P/E — **any region**. Requires analyst consensus. No free source exists.
- Trailing P/E for Europe, Asia ex-Japan, Malaysia.
- KLCI price history — FTSE Russell licensed.
- MGS/GII indicative curve as a machine-readable feed — published, but HTML only.
- TOPIX history — JPX sells it; the free J-Quants tier is individual-use only.
- Euro **investment grade** corporate OAS on FRED — euro HY exists, IG not found.

### Gotchas that would corrupt the dashboard silently

- `WILL5000PR` and `WILL5000PRFC` were **removed from FRED in June 2024** and
  now 302-redirect into an HTML page rather than returning an error.
- `SPASTT01EZM661N` (euro area aggregate) **stopped updating in February 2026**
  with no discontinuation flag, while every country-level sibling refreshed in
  July. Use Germany and France, not the aggregate — and assert on last-observation
  age for every series at load.
- `INTGSBJPM193N` / `INTGSTJPM193N` are dead (last data 2017) but not flagged.

### Not verified

- Stooq CSV format, symbol coverage and rate limits — robots-blocked, could not check.
- AsianBondsOnline (ADB) — the site is JS-rendered and returned no readable
  data. It may cover Malaysian yields; I could not confirm a single byte.
- BNM Open API endpoint paths could not be re-executed (the check needs a custom
  header), though the documented list matches BNM's own announcement page.
- The ECB API returns what its documentation says it returns — the endpoint
  shape is quoted from ECB, but the live call has to be smoke-tested from your
  machine.
