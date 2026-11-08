"""
Series registry.
================
The single list of everything the dashboard tracks. Pages read from here,
refresh.py fetches from here, and the composite stress panel will build itself
from here - so a series is added in exactly one place.

Two fields exist specifically to stop a whole class of silent bug:

    expect_units  what FRED should report for this series
    scale         multiplier applied to reach the unit we actually want

`python refresh.py --audit` checks every registered series' live FRED units
against `expect_units`. If the Fed ever re-bases a series - or if a ticker is
swapped for one reported in different units - the audit fails loudly instead of
the dashboard quietly plotting a number that is 1,000x wrong.

`higher_is_stress` is what lets the composite stress panel build itself later:
    True  -> rising value means more stress (HY spreads, SOFR-IORB)
    False -> falling value means more stress (reserves/GDP)
    None  -> context only, excluded from the composite (levels, volumes)
"""

from __future__ import annotations

from dataclasses import dataclass, field

MILLIONS = "Millions of U.S. Dollars"
MILLIONS_ALT = "Millions of Dollars"
BILLIONS_US = "Billions of U.S. Dollars"
BILLIONS = "Billions of Dollars"
BILLIONS_ALT = "Billions of US Dollars"
PERCENT = "Percent"
INDEX = "Index"

M_TO_B = 1.0 / 1000.0  # millions -> billions


@dataclass(frozen=True)
class Series:
    id: str                             # FRED series ID
    name: str                           # output column name
    block: str                          # module it belongs to
    higher_is_stress: bool | None = None
    unit: str = ""                      # unit AFTER scaling
    scale: float = 1.0                  # raw value multiplier
    expect_units: str | tuple[str, ...] = ""   # what FRED should report
    source: str = "fred"
    note: str = ""
    display: str = ""     # chart/table label; falls back to `name`


# --------------------------------------------------------------------------- #
# Block: Funding  (the liquidity dashboard you already have)
# Column names below match macro_liquidity_master.csv so app.py keeps working.
# Every ticker and unit verified against the live FRED API on 2026-08-27.
# --------------------------------------------------------------------------- #

FUNDING: tuple[Series, ...] = (
    Series("WALCL", "Fed_Total_Assets_Bil", "Funding", None, "$bn",
           scale=M_TO_B, expect_units=MILLIONS,
           note="H.4.1 total assets. FRED reports millions."),

    Series("TOTRESNS", "Total_Reserves", "Funding", None, "$bn",
           expect_units=BILLIONS,
           note="Monthly, NSA. Lags by up to 8 weeks - see Total_Reserves_Weekly."),

    Series("WRESBAL", "Total_Reserves_Weekly", "Funding", None, "$bn",
           scale=M_TO_B, expect_units=MILLIONS,
           note="Weekly reserve balances. FRED reports MILLIONS despite the "
                "sibling series TOTRESNS being in billions."),

    Series("WTREGEN", "TGA_Balance", "Funding", None, "$bn",
           scale=M_TO_B, expect_units=MILLIONS,
           note="Treasury General Account, week average. FRED reports MILLIONS."),

    Series("RRPONTSYD", "ON_RRP_Facility", "Funding", None, "$bn",
           expect_units=(BILLIONS_ALT, BILLIONS_US, BILLIONS),
           note="Daily ON RRP take-up. Already billions - do not scale."),

    Series("RPONTSYD", "SRF_Daily_Accepted_Bil", "Funding", True, "$bn",
           display="Repo / SRF take-up",
           expect_units=(BILLIONS_ALT, BILLIONS_US, BILLIONS),
           note="Daily repo take-up incl. Standing Repo Facility, billions, "
                "back to 2000. Replaces the NY Fed operations API call."),

    Series("WPC", "Discount_Window_Primary_Credit", "Funding", True, "$mn",
           display="Discount window",
           expect_units=MILLIONS,
           note="Primary credit, week average. Left in millions to match the "
                "existing column."),

    Series("IORB", "IORB_Rate", "Funding", None, "%",
           expect_units=PERCENT,
           note="Starts 2021-07-29 only. Nothing before that - IOER preceded it."),

    Series("SOFR", "SOFR_Rate", "Funding", None, "%", expect_units=PERCENT),
    Series("EFFR", "EFFR_Rate", "Funding", None, "%", expect_units=PERCENT),
    Series("WPCREDIT", "Primary_Credit_Rate", "Funding", None, "%",
           expect_units=PERCENT),

    Series("M2SL", "M2_Money_Supply", "Funding", None, "$bn",
           expect_units=BILLIONS, note="Monthly, seasonally adjusted."),

    Series("CASLCBW027SBOG", "Large_Bank_Cash", "Funding", None, "$bn",
           expect_units=(BILLIONS_US, BILLIONS),
           note="Cash assets, large domestically chartered banks."),

    Series("TLAACBW027SBOG", "All_Bank_Assets", "Funding", None, "$bn",
           expect_units=(BILLIONS_US, BILLIONS),
           note="Total assets, ALL commercial banks - this is the denominator "
                "the 8.5-9.0% scarcity band is calibrated to (Sept 2019 was "
                "~8.5% on this basis). Renamed from Large_Bank_Assets, which "
                "was a misnomer. True large-bank assets = TLALCBW027SBOG, but "
                "that would need a different band."),

    Series("GDP", "Nominal_GDP", "Funding", None, "$bn",
           expect_units=BILLIONS, note="Quarterly, SAAR."),
)


# --------------------------------------------------------------------------- #
# Block: Credit & financial conditions
# --------------------------------------------------------------------------- #

CREDIT: tuple[Series, ...] = (
    Series("NFCI", "NFCI", "Credit", True, "index", expect_units=INDEX,
           note="Chicago Fed, 105 measures. Positive = tighter than average."),
    Series("ANFCI", "Adjusted NFCI", "Credit", True, "index", expect_units=INDEX,
           note="NFCI stripped of what growth and inflation justify."),
    Series("NFCICREDIT", "NFCI - credit", "Credit", None, "index", expect_units=INDEX),
    Series("NFCILEVERAGE", "NFCI - leverage", "Credit", None, "index", expect_units=INDEX,
           note="Tends to turn before the headline index."),
    Series("NFCIRISK", "NFCI - risk", "Credit", None, "index", expect_units=INDEX),
    Series("STLFSI4", "St. Louis Fed FSI", "Credit", True, "index", expect_units=INDEX),
    # The long-history credit spread, and the reason it is here.
    #
    # In April 2026 FRED truncated every ICE BofA series to a rolling 3-year
    # window ("this series will only include 3 years of observations"). The
    # three OAS rows below therefore start in 2023 and cannot be ranked against
    # 2008 or 2020 - which is exactly what a percentile is for. Moody's Baa
    # minus the 10-year runs from 1986, is not going anywhere, and gives the
    # block one credit measure with a real distribution behind it.
    Series("BAA10Y", "Baa - 10y spread", "Credit", True, "%",
           expect_units=PERCENT,
           note="Moody's Baa corporate yield minus 10y Treasury, daily from "
                "1986. Coarser than an OAS - it is a yield difference, not "
                "option-adjusted, and the Baa basket's duration drifts - but it "
                "is the only long, permanent credit spread available free."),

    Series("BAMLH0A0HYM2", "HY OAS", "Credit", True, "%", expect_units=PERCENT),
    Series("BAMLH0A1HYBB", "BB OAS", "Credit", None, "%", expect_units=PERCENT),
    Series("BAMLH0A3HYC", "CCC & lower OAS", "Credit", True, "%", expect_units=PERCENT,
           note="CCC minus BB decompression turns before the index level does."),
    Series("VIXCLS", "VIX", "Credit", True, "index", expect_units=INDEX),

    # Quarterly, from 1990Q2. Deliberately higher_is_stress=None: it is a real
    # stress signal, but adding it to the composite would change the membership
    # of an existing block without being asked. It is charted on the Credit
    # page and carried as an event on the Calendar.
    Series("DRTSCILM", "SLOOS net % tightening", "Credit", None, "%",
           expect_units=PERCENT,
           note="Net percentage of domestic banks tightening standards for C&I "
                "loans to large and middle-market firms. Quarterly, from "
                "1990Q2. Above zero means more banks tightening than easing."),
)


# --------------------------------------------------------------------------- #
# Block: Growth & activity  (the ISM substitute)
#
# ISM itself is licensed and was removed from FRED in June 2016. Richmond and
# Kansas City do not publish to FRED either. What is left - and what is arguably
# better for a stress dashboard - is four regional surveys that print BEFORE
# ISM does, plus higher-frequency activity and labour measures.
# --------------------------------------------------------------------------- #

NUMBER = "Number"
PCT_POINTS = "Percentage Points"

GROWTH: tuple[Series, ...] = (
    # --- regional surveys: the ISM proxy, standardised into a composite ----
    Series("GACDISA066MSFRBNY", "Empire State (NY)", "Growth", None, "index",
           expect_units=INDEX, note="First regional print of the month."),
    Series("GACDFSA066MSFRBPHI", "Philly Fed (PA)", "Growth", None, "index",
           note="Longest continuous manufacturing survey in the US, from 1968."),
    Series("BACTSAMFRBDAL", "Dallas Fed (TX)", "Growth", None, "index",
           note="Texas Manufacturing Outlook Survey, general business activity."),
    Series("CFSBCACTIVITYMFG", "Chicago Fed (IL)", "Growth", None, "index",
           expect_units=INDEX, note="Chicago Fed Survey of Economic Conditions."),

    # --- broad activity ----------------------------------------------------
    Series("CFNAI", "CFNAI", "Growth", None, "index", expect_units=INDEX,
           note="85 indicators in one number."),
    Series("CFNAIMA3", "CFNAI-MA3", "Growth", False, "index", expect_units=INDEX,
           note="Chicago Fed's published rule: below -0.70 after an expansion "
                "signals recession."),
    Series("WEI", "Weekly Economic Index", "Growth", False, "index",
           expect_units=INDEX,
           note="Lewis-Mertens-Stock. Ten weekly series scaled to GDP growth."),

    # --- labour ------------------------------------------------------------
    Series("ICSA", "Initial Claims", "Growth", None, "persons", expect_units=NUMBER),
    Series("IC4WSA", "Initial Claims 4wk MA", "Growth", True, "persons",
           expect_units=NUMBER, note="The series the 52-week-low heuristic uses."),
    Series("CCSA", "Continued Claims", "Growth", True, "persons", expect_units=NUMBER),
    Series("UNRATE", "Unemployment Rate", "Growth", True, "%", expect_units=PERCENT),
    Series("SAHMREALTIME", "Sahm Rule (real-time)", "Growth", True, "pp",
           expect_units=PCT_POINTS,
           note="Triggers at 0.50. Real-time vintage - use this one, not "
                "SAHMCURRENT, which is revised."),
)


# --------------------------------------------------------------------------- #
# Block: Context  (not stress indicators - shading and reference for every page)
# --------------------------------------------------------------------------- #

CONTEXT: tuple[Series, ...] = (
    Series("USREC", "NBER_Recession", "Context", None, "0/1",
           expect_units="+1 or 0",
           note="Peak-through-trough NBER indicator, monthly. Used for chart shading."),
)


# --------------------------------------------------------------------------- #
# Block: Rates  (neutral, curve, real yields, excess liquidity)
#
# Inputs for the lead/lag charts. Nothing here votes in the composite: these are
# levels and slopes whose stress reading depends entirely on context, and the
# lead/lag work is exploratory rather than a monitor.
# --------------------------------------------------------------------------- #

RATES: tuple[Series, ...] = (
    Series("DGS3MO", "UST 3m", "Rates", None, "%", expect_units=PERCENT),
    Series("DGS2", "UST 2y", "Rates", None, "%", expect_units=PERCENT),
    Series("DGS10", "UST 10y", "Rates", None, "%", expect_units=PERCENT),
    Series("DGS30", "UST 30y", "Rates", None, "%", expect_units=PERCENT),
    Series("DFII10", "UST 10y real", "Rates", None, "%", expect_units=PERCENT,
           note="TIPS constant maturity. Starts 2003."),
    Series("FEDFUNDS", "Fed funds (monthly)", "Rates", None, "%",
           expect_units=PERCENT, note="Monthly average, from 1954 - the long "
                                      "history the r-star comparison needs."),
    Series("PCEPILFE", "Core PCE index", "Rates", None, "index",
           note="Deflator for the real fed funds rate."),
    Series("CPIAUCSL", "CPI", "Rates", None, "index",
           note="Deflator for real M2 in the excess-liquidity proxy."),
    Series("INDPRO", "Industrial production", "Rates", None, "index",
           note="Real-activity leg of the excess-liquidity proxy."),

    Series("FEDTARMDLR", "FOMC longer-run dot", "Rates", None, "%",
           expect_units=PERCENT,
           note="FOMC Summary of Economic Projections, median longer-run fed "
                "funds rate. Less the 2% target it is the Committee's implied "
                "REAL neutral rate - the fallback for r-star when the NY Fed "
                "HLW workbook cannot be retrieved. Quarterly, and it steps "
                "rather than drifts."),

    # --- term premium and the price-insensitive buyer base -----------------
    Series("THREEFYTP10", "Term Premium 10y (KW)", "Rates", None, "%",
           expect_units=PERCENT,
           note="Kim-Wright term premium on a 10-year zero coupon bond, from "
                "the Board's three-factor model. Daily, back to 1990."),

    Series("FDHBFRBN", "Debt held by Fed", "Rates", None, "$bn",
           expect_units=BILLIONS, note="Quarterly, end of period."),
    Series("FDHBFIN", "Debt held by foreign", "Rates", None, "$bn",
           expect_units=BILLIONS,
           note="Foreign and international investors. Publishes about a "
                "quarter behind the Fed holdings series."),
    # The expectation here USED TO SAY BILLIONS, which was simply wrong: the
    # note beside it and the M_TO_B scale both said millions, and the scaling
    # has always been correct. Only the audit's expectation was stale, so the
    # audit was reporting a mismatch against a claim the code never made.
    # Fixing the label, not the maths - the cached numbers were never affected.
    #
    # Note the unit string: FRED says "Millions of Dollars" here and "Millions
    # of U.S. Dollars" on the H.4.1 series, which is why both spellings exist.
    Series("GFDEBTN", "Total public debt", "Rates", None, "$bn",
           scale=M_TO_B, expect_units=(MILLIONS_ALT, MILLIONS),
           note="Total public debt outstanding. FRED reports MILLIONS here "
                "while the two holdings series above are in BILLIONS - scaled "
                "so the ratio is not out by 1,000."),

    # --- exchange rates ----------------------------------------------------
    #
    # Here rather than in a block of their own because on this dashboard FX is
    # never the subject - it is the thing that converts a foreign yield or a
    # foreign index into what a ringgit-based investor actually earns.
    #
    # Each is named the way the market quotes it, which is also the direction
    # FRED reports it, so the number on the chart and the label agree:
    #   DEXJPUS  yen per dollar     -> USD/JPY, up = stronger dollar
    #   DEXMAUS  ringgit per dollar -> USD/MYR, up = weaker ringgit
    #   DEXUSEU  dollars per euro   -> EUR/USD, up = stronger euro
    # Getting one of these inverted would flip the sign of every conclusion on
    # the cross-market tab, so `python refresh.py --audit` is the check that
    # matters here - it reads FRED's own unit string back.
    Series("DEXJPUS", "USD/JPY", "Rates", None, "JPY per USD",
           expect_units="Japanese Yen to One U.S. Dollar"),
    Series("DEXMAUS", "USD/MYR", "Rates", None, "MYR per USD",
           expect_units="Malaysian Ringgit to One U.S. Dollar",
           note="The ringgit leg of every unhedged foreign return in this book."),
    Series("DEXUSEU", "EUR/USD", "Rates", None, "USD per EUR",
           expect_units="U.S. Dollars to One Euro"),
    Series("DTWEXBGS", "Broad dollar index", "Rates", None, "index",
           note="Nominal broad trade-weighted dollar. Units string is a "
                "moving base year, so it is deliberately not pinned."),

    # FX context for the regions the equity page covers. These are NOT used to
    # convert anything - every price on this dashboard stays in its own local
    # currency by choice - they are here so "what did the ringgit do against
    # the won" is answerable from the cache.
    #
    # Direction is NOT uniform across FRED's DEX family, so the labels follow
    # FRED rather than market convention: GBP and EUR are quoted as USD PER
    # unit, the rest as units PER USD.
    #
    # DEXUSUK is why the audit exists. FRED calls it "U.S. Dollars to One U.K.
    # Pound", not "...British Pound" - close enough to guess wrong, far enough
    # to fail a string match. Both spellings are accepted in case it is ever
    # normalised.
    Series("DEXUSUK", "GBP/USD", "Rates", None, "USD per GBP",
           expect_units=("U.S. Dollars to One U.K. Pound",
                         "U.S. Dollars to One British Pound")),
    Series("DEXKOUS", "USD/KRW", "Rates", None, "KRW per USD",
           expect_units="South Korean Won to One U.S. Dollar"),
    Series("DEXINUS", "USD/INR", "Rates", None, "INR per USD",
           expect_units="Indian Rupees to One U.S. Dollar"),
    Series("DEXCHUS", "USD/CNY", "Rates", None, "CNY per USD",
           expect_units="Chinese Yuan Renminbi to One U.S. Dollar"),
)


# --------------------------------------------------------------------------- #
# Block: External  (independent cross-check, deliberately non-voting)
#
# The OFR Financial Stress Index - 33 market variables, five categories, three
# regions, published daily by the US Treasury with no API key.
#
# Every entry carries higher_is_stress=None on purpose. That keeps the whole
# block out of composite_members(), so the index can be used to CHECK our
# composite rather than becoming part of it. source="ofr" also keeps it out of
# fred_ids() and the units audit.
# --------------------------------------------------------------------------- #

EXTERNAL: tuple[Series, ...] = (
    Series("OFR FSI", "OFR FSI", "External", None, "index", source="ofr",
           note="Headline index. Zero is the historical average."),
    Series("OFR - credit", "OFR credit", "External", None, "index", source="ofr"),
    Series("OFR - equity valuation", "OFR equity valuation", "External", None,
           "index", source="ofr"),
    Series("OFR - safe assets", "OFR safe assets", "External", None, "index",
           source="ofr"),
    Series("OFR - funding", "OFR funding", "External", None, "index", source="ofr",
           note="Closest overlap with our own Funding block - watch this one."),
    Series("OFR - volatility", "OFR volatility", "External", None, "index",
           source="ofr"),
    Series("OFR - United States", "OFR United States", "External", None, "index",
           source="ofr"),
    Series("OFR - other advanced", "OFR other advanced", "External", None, "index",
           source="ofr"),
    Series("OFR - emerging markets", "OFR emerging markets", "External", None,
           "index", source="ofr"),
)


# --------------------------------------------------------------------------- #
# Derived columns
#
# Produced by the block builders rather than fetched. They carry a block and a
# stress sign so the composite panel picks them up like any other indicator.
# `source="derived"` keeps them out of fred_ids() and the units audit.
# --------------------------------------------------------------------------- #

DERIVED: tuple[Series, ...] = (
    Series("Net_Liquidity_Bil", "Net Liquidity", "Funding", False, "$bn",
           source="derived", note="Assets - TGA - ON RRP. Falling is stress."),
    Series("SOFR_IORB_Spread_bps", "SOFR - IORB", "Funding", True, "bps",
           source="derived"),
    Series("EFFR_IORB_Spread_bps", "EFFR - IORB", "Funding", True, "bps",
           source="derived"),
    Series("Reserves_to_GDP_%", "Reserves / GDP", "Funding", False, "%",
           source="derived"),
    Series("Reserves_to_Large_Bank_Assets_%", "Reserves / bank assets", "Funding",
           False, "%", source="derived"),

    Series("CCC-BB Decompression", "CCC - BB decompression", "Credit", True, "pp",
           source="derived", note="Quality dispersion inside high yield."),

    Series("Regional Fed Composite", "Regional Fed composite", "Growth", False, "z",
           source="derived", note="Standardised average of the four districts."),
    Series("Claims vs 52wk low (%)", "Claims vs 52wk low", "Growth", True, "%",
           source="derived"),
)


# --------------------------------------------------------------------------- #
# Assembly
# --------------------------------------------------------------------------- #

REGISTRY: tuple[Series, ...] = (FUNDING + CREDIT + GROWTH + RATES + EXTERNAL
                                + DERIVED + CONTEXT)

BLOCKS: tuple[str, ...] = tuple(dict.fromkeys(s.block for s in REGISTRY))


def by_block(block: str) -> tuple[Series, ...]:
    return tuple(s for s in REGISTRY if s.block == block)


def fred_ids(block: str | None = None) -> list[str]:
    items = REGISTRY if block is None else by_block(block)
    return [s.id for s in items if s.source == "fred"]


def lookup(series_id: str) -> Series | None:
    return next((s for s in REGISTRY if s.id == series_id), None)


def labels(block: str | None = None) -> dict[str, str]:
    """{series_id: output column name}"""
    items = REGISTRY if block is None else by_block(block)
    return {s.id: s.name for s in items}


def units_ok(spec: Series, reported: str) -> bool:
    """Does FRED's reported unit string match what the registry expects?"""
    if not spec.expect_units:
        return True
    expected = spec.expect_units
    if isinstance(expected, str):
        expected = (expected,)
    return reported.strip() in expected


def composite_members(block: str | None = None) -> tuple[Series, ...]:
    """
    Series that vote in the composite stress panel.

    Membership is deliberately pruned: within a block, several series often
    measure the same thing (five NFCI variants, three points on the same credit
    curve, four regional surveys already summarised by their own composite).
    Left unchecked, one concept would vote five times and drown the rest. Those
    duplicates carry higher_is_stress=None - still charted on their own page,
    simply not counted twice here.
    """
    items = REGISTRY if block is None else by_block(block)
    return tuple(s for s in items if s.higher_is_stress is not None)


def display_name(spec: Series) -> str:
    """Label for charts and tables. Falls back to the column name."""
    return spec.display or spec.name
