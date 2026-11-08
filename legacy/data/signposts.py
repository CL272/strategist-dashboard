"""
Peak Signposts.
===============
A late-cycle checklist in the spirit of the sell-side "signposts of a market
peak" exhibits, built only from data that can be verified for free.

**This is not a replication of anyone's published table.** Those tables lean on
inputs that are licensed or proprietary - a sell-side strategist allocation
survey, a fund manager survey, IBES long-term growth expectations, Conference
Board stock-price expectations, M&A deal counts, a bank's own credit stress
composite. None of those can be sourced here, and quietly substituting a
lookalike would make the headline "% triggered" number incomparable to theirs
while looking identical. So this carries its own name, its own rows, and prints
its own trigger rules next to them.

Design rules that keep it honest:

* **Every rule is evaluable at any past date using only trailing data.** No
  rule peeks at its own future, so a checkmark in the March 2000 column is one
  an observer standing in March 2000 could actually have ticked.
* **Unavailable is not the same as untriggered.** A rule whose inputs do not
  reach back to a given date returns NaN, renders as a dash, and is excluded
  from that column's denominator. `triggered / evaluated` is reported with the
  denominator visible.
* **Monthly grid.** These are slow, late-cycle markers. Rules that genuinely
  need daily data (did the curve invert at any point in twelve months) are
  evaluated daily and only then resampled, so a brief inversion between two
  month-ends is not lost.

Adding a signpost is one entry in SIGNPOSTS below plus whatever series it needs.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import pandas as pd

from data import registry
from data.fred import fetch_series_raw
from data.shiller import ShillerError, fetch as fetch_shiller

DEFAULT_START = "1970-01-01"

MONTHLY = "MS"

#: S&P 500 closing highs that preceded a major drawdown. Columns in the grid.
#: Dates are the index peak; the grid reads the month containing them.
PEAKS: tuple[tuple[str, str], ...] = (
    ("Jul 1990", "1990-07-16"),
    ("Mar 2000", "2000-03-24"),
    ("Oct 2007", "2007-10-09"),
    ("Feb 2020", "2020-02-19"),
    ("Jan 2022", "2022-01-03"),
)

#: FRED series this module needs. Tickers already registered elsewhere are
#: reused rather than re-declared; the registry stays the single definition of
#: what each ticker is and what units it should report.
FRED_INPUTS: tuple[str, ...] = (
    "DGS10", "DGS3MO",          # curve
    "FEDFUNDS",                 # policy stance
    "UNRATE",                   # labour slack
    "VIXCLS",                   # implied vol, from 1990
    "BAA10Y",                   # credit risk premium, from 1986
    "BAMLH0A1HYBB", "BAMLH0A3HYC",   # quality decompression
    "DRTSCILM",                 # SLOOS lending standards
)


class SignpostError(RuntimeError):
    """Raised when not enough inputs could be retrieved to build the panel."""


@dataclass(frozen=True)
class Signpost:
    key: str
    group: str
    label: str
    rule: str          # the trigger condition, printed beside the row
    source: str
    fn: Callable[[dict[str, pd.Series]], pd.Series]
    note: str = ""


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def _flag(condition: pd.Series, valid: pd.Series | None = None) -> pd.Series:
    """
    Boolean rule -> 1.0 / 0.0, with NaN wherever the rule could not be judged.

    The distinction matters: a comparison against NaN is False in pandas, which
    would silently turn "no data in 1990" into "did not trigger in 1990".
    """
    out = condition.astype("float64")
    mask = valid if valid is not None else condition.notna()
    return out.where(mask)


def _stretched(level: pd.Series, window: int, min_periods: int,
               sigmas: float = 1.0) -> pd.Series:
    """Above its own trailing mean plus `sigmas` standard deviations."""
    level = level.dropna()
    mean = level.rolling(window, min_periods=min_periods).mean()
    std = level.rolling(window, min_periods=min_periods).std()
    threshold = mean + sigmas * std
    return _flag(level > threshold, threshold.notna())


def _cheap(level: pd.Series, window: int, min_periods: int,
           quantile: float = 0.25) -> pd.Series:
    """In the bottom `quantile` of its own trailing distribution."""
    level = level.dropna()
    ranked = level.rolling(window, min_periods=min_periods).rank(pct=True)
    return _flag(ranked < quantile, ranked.notna())


def _monthly(series: pd.Series) -> pd.Series:
    """Collapse a rule onto the monthly grid.

    `max` rather than `last`: for a flag evaluated daily, the question the row
    asks is whether the condition held at any point in the month, and taking
    the last business day would discard an intra-month trigger.
    """
    if series.empty:
        return series
    return series.resample(MONTHLY).max()


def _as_monthly(series: pd.Series) -> pd.Series:
    """
    Force a level onto the monthly grid before a windowed rule touches it.

    The rules below express their windows in MONTHS - `shift(24)` means two
    years, `rolling(240)` means twenty. Every input here is monthly at source,
    but a caller handing in a daily forward-filled copy of the same series
    would silently turn twenty years into ten months. One resample removes the
    whole class of mistake.
    """
    clean = series.dropna()
    if clean.empty:
        return clean
    return clean.resample(MONTHLY).last().dropna()


# --------------------------------------------------------------------------- #
# The rules
# --------------------------------------------------------------------------- #

def _pe_stretched(s: dict[str, pd.Series]) -> pd.Series:
    # 20 years of monthly history, at least 10 before a reading is emitted.
    return _stretched(_as_monthly(s["Trailing P/E"]), window=240, min_periods=120)


def _cape_stretched(s: dict[str, pd.Series]) -> pd.Series:
    return _stretched(_as_monthly(s["CAPE"]), window=240, min_periods=120)


def _vol_complacency(s: dict[str, pd.Series]) -> pd.Series:
    # Six-month average, so one quiet fortnight cannot tick the box.
    smoothed = s["VIXCLS"].dropna().rolling(126, min_periods=90).mean()
    return _monthly(_cheap(smoothed, window=2520, min_periods=1260))


def _credit_complacency(s: dict[str, pd.Series]) -> pd.Series:
    # Moody's Baa over the 10-year Treasury, not an ICE BofA OAS. The ICE
    # series are the better spread measure, but FRED currently serves only a
    # rolling ~3 years of them, which cannot reach a single one of the peak
    # columns. Baa-10y is free, unrestricted, daily from 1986, and measures
    # the same thing one notch up the quality ladder.
    smoothed = s["BAA10Y"].dropna().rolling(63, min_periods=45).mean()
    return _monthly(_cheap(smoothed, window=2520, min_periods=1260))


def _curve_inverted(s: dict[str, pd.Series]) -> pd.Series:
    curve = (s["DGS10"] - s["DGS3MO"]).dropna()
    trough = curve.rolling(252, min_periods=180).min()
    return _monthly(_flag(trough < 0, trough.notna()))


def _policy_tightened(s: dict[str, pd.Series]) -> pd.Series:
    # Distance above the recent LOW, not the change over a fixed lookback.
    # A plain 24-month difference misses the two clearest cases in the sample:
    # the 1999-2000 cycle nets out to +35bp against a 1998 that contained three
    # cuts, and 2007 nets to +98bp - so a rule that should obviously fire at
    # both peaks fires at neither. Measuring from the trough is what "we are in
    # a tightening cycle" actually means.
    ff = _as_monthly(s["FEDFUNDS"])
    trough = ff.rolling(36, min_periods=24).min()
    return _flag(ff - trough >= 1.0, trough.notna())


def _standards_tightening(s: dict[str, pd.Series]) -> pd.Series:
    # Quarterly. Resampled WITHOUT dropping the empty months first - the whole
    # point is to create Feb and Mar as NaN so ffill can carry January's survey
    # into them. Dropping first leaves no gap to fill and the row reads
    # "unavailable" in two months out of every three.
    quarterly = s["DRTSCILM"].dropna()
    if quarterly.empty:
        return quarterly
    # Extend past the last survey before filling, or the current quarter reads
    # "unavailable" for the two months between publication dates - resample()
    # only spans the data it is given.
    grid_ = pd.date_range(quarterly.index.min().to_period("M").to_timestamp(),
                          quarterly.index.max() + pd.DateOffset(months=3),
                          freq=MONTHLY)
    sloos = quarterly.resample(MONTHLY).last().reindex(grid_).ffill(limit=3)
    return _flag(sloos > 0, sloos.notna())


def _labour_at_cycle_lows(s: dict[str, pd.Series]) -> pd.Series:
    unrate = _as_monthly(s["UNRATE"])
    floor = unrate.rolling(36, min_periods=24).min()
    return _flag(unrate <= floor + 0.3, floor.notna())


def _decompression(s: dict[str, pd.Series]) -> pd.Series:
    gap = (s["BAMLH0A3HYC"] - s["BAMLH0A1HYBB"]).dropna()
    trough = gap.rolling(252, min_periods=180).min()
    widening = gap - trough
    return _monthly(_flag(widening >= 1.0, trough.notna()))


SIGNPOSTS: tuple[Signpost, ...] = (
    Signpost(
        "pe", "Valuation", "Trailing P/E stretched",
        "Trailing 12m P/E more than 1σ above its own 20-year mean",
        "Shiller ie_data.xls", _pe_stretched,
        note="Two things to know. The earnings are as-reported (GAAP), so this "
             "prints above an operating-earnings P/E - the band is computed on "
             "the same basis, so the trigger is still internally consistent. "
             "And Shiller leaves earnings blank until a quarter is reported, "
             "so this row is normally a dash for the two or three most recent "
             "months while CAPE, which uses a ten-year average, is not.",
    ),
    Signpost(
        "cape", "Valuation", "CAPE stretched",
        "CAPE more than 1σ above its own 20-year mean",
        "Shiller ie_data.xls", _cape_stretched,
        note="A rolling band, not a fixed level - a fixed CAPE threshold has "
             "been triggered almost continuously since 1992 and says nothing.",
    ),
    Signpost(
        "vol", "Sentiment", "Volatility complacency",
        "6-month average VIX in the bottom quartile of its trailing 10 years",
        "FRED · VIXCLS", _vol_complacency,
        note="The free stand-in for the positioning and survey rows on a "
             "sell-side checklist. It measures what options cost, not what "
             "anyone says - a different thing, and worth remembering.",
    ),
    Signpost(
        "credit", "Sentiment", "Credit complacency",
        "3-month average Baa−10y spread in the bottom quartile of its "
        "trailing 10 years",
        "FRED · BAA10Y", _credit_complacency,
        note="Moody's Baa over the 10-year Treasury rather than an ICE BofA "
             "high yield OAS: FRED currently serves only a rolling three years "
             "of the ICE series, which reaches none of the peak columns. This "
             "one is daily from 1986.",
    ),
    Signpost(
        "curve", "Macro & Policy", "Curve inverted within 12 months",
        "10y minus 3m below zero at any point in the trailing 12 months",
        "FRED · DGS10, DGS3MO", _curve_inverted,
        note="Evaluated daily before being collapsed to months, so a brief "
             "inversion between two month-ends still counts.",
    ),
    Signpost(
        "policy", "Macro & Policy", "Policy tightened",
        "Fed funds 100bp or more above its trailing 36-month low",
        "FRED · FEDFUNDS", _policy_tightened,
        note="Measured from the trough rather than as a fixed-lookback change: "
             "a 24-month difference nets a hiking year against a cutting year "
             "and fires at neither the 2000 nor the 2007 peak.",
    ),
    Signpost(
        "sloos", "Macro & Policy", "Banks tightening standards",
        "SLOOS net % tightening C&I standards above zero (more tightening "
        "than easing)",
        "FRED · DRTSCILM", _standards_tightening,
        note="Quarterly. Carried forward up to three months so the flag "
             "persists between surveys.",
    ),
    Signpost(
        "labour", "Macro & Policy", "Labour market at cycle tights",
        "Unemployment within 0.3pp of its trailing 36-month low",
        "FRED · UNRATE", _labour_at_cycle_lows,
    ),
    Signpost(
        "decomp", "Sentiment", "Quality decompression widening",
        "CCC minus BB spread 100bp or more above its trailing 12-month low",
        "FRED · BAMLH0A3HYC, BAMLH0A1HYBB", _decompression,
        note="Two caveats. It turns late rather than early - a confirmation, "
             "not a warning. And FRED serves only a rolling ~3 years of the "
             "ICE BofA series, so this row cannot reach any of the peak "
             "columns and will show a dash in all of them.",
    ),
)

#: Rules whose inputs are known to be short-history at source, so a dash in the
#: peak columns is expected rather than a symptom of a broken refresh.
SHORT_HISTORY: frozenset[str] = frozenset({"decomp"})

GROUPS: tuple[str, ...] = tuple(dict.fromkeys(s.group for s in SIGNPOSTS))

#: Underlying levels carried into the cache so the page can print a 'Latest'
#: column without refetching. Key is the cache column, value the input series.
LEVEL_COLUMNS: dict[str, str] = {
    "Trailing P/E": "Trailing P/E",
    "CAPE": "CAPE",
    "S&P 500 Price": "S&P 500 Price",
    "VIX": "VIXCLS",
    "Baa - 10y spread": "BAA10Y",
    "Unemployment Rate": "UNRATE",
    "SLOOS net % tightening": "DRTSCILM",
    "Fed funds": "FEDFUNDS",
}

#: The level to quote beside each row in the detail table.
ROW_LEVEL: dict[str, str] = {
    "pe": "Trailing P/E",
    "cape": "CAPE",
    "vol": "VIX",
    "credit": "Baa - 10y spread",
    "policy": "Fed funds",
    "sloos": "SLOOS net % tightening",
    "labour": "Unemployment Rate",
    "curve": "Curve 10y - 3m",
    "decomp": "CCC - BB",
}


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #

def build_signposts(start: str = DEFAULT_START, verbose: bool = True) -> pd.DataFrame:
    """
    Fetch the inputs at full history and evaluate every rule onto a monthly grid.

    Deliberately independent of the `--start` used for the monitoring blocks:
    the peak columns need the 1990 and 2000 cycles regardless of how much
    history the day-to-day dashboard is carrying.
    """
    raw = fetch_series_raw(list(FRED_INPUTS), start=start, verbose=verbose)
    if not raw:
        raise SignpostError("No FRED series retrieved for the signpost panel.")

    inputs: dict[str, pd.Series] = dict(raw)

    try:
        shiller = fetch_shiller(verbose=verbose)
        for column in ("Trailing P/E", "CAPE", "S&P 500 Price"):
            if column in shiller.columns:
                inputs[column] = shiller[column].dropna()
    except ShillerError as exc:
        # Valuation rows drop out; the rest of the panel is unaffected.
        if verbose:
            print(f"  [SKIP] Shiller valuation data — {exc}")

    flags: dict[str, pd.Series] = {}
    for spec in SIGNPOSTS:
        missing = [k for k in _required(spec) if k not in inputs]
        if missing:
            if verbose:
                print(f"  [SKIP] signpost '{spec.key}' — missing {', '.join(missing)}")
            continue
        try:
            flags[spec.key] = spec.fn(inputs)
        except (KeyError, ValueError) as exc:
            if verbose:
                print(f"  [SKIP] signpost '{spec.key}' — {exc}")

    if not flags:
        raise SignpostError(
            "No signpost could be evaluated. Check the FRED tickers with "
            "`python refresh.py --audit`."
        )

    monthly_flags = {k: v.resample(MONTHLY).max() for k, v in flags.items()}
    levels = {
        column: inputs[key].resample(MONTHLY).last()
        for column, key in LEVEL_COLUMNS.items() if key in inputs
    }

    # Two rows read off a spread rather than a series, so their 'latest
    # reading' has to be computed here or the table shows a dash beside a row
    # that is perfectly well evaluated.
    if "DGS10" in inputs and "DGS3MO" in inputs:
        levels["Curve 10y - 3m"] = (
            (inputs["DGS10"] - inputs["DGS3MO"]).dropna().resample(MONTHLY).last())
    if "BAMLH0A3HYC" in inputs and "BAMLH0A1HYBB" in inputs:
        levels["CCC - BB"] = (
            (inputs["BAMLH0A3HYC"] - inputs["BAMLH0A1HYBB"])
            .dropna().resample(MONTHLY).last())

    frame = pd.concat({**monthly_flags, **levels}, axis=1).sort_index()
    frame.index.name = "Date"

    # Trim the leading stretch where nothing at all can be judged, and the
    # trailing stretch beyond the current month - a quarterly rule carried
    # forward three months would otherwise create rows for months that have
    # not happened.
    judged = frame[list(monthly_flags)].notna().any(axis=1)
    if judged.any():
        frame = frame.loc[judged.idxmax():]
    frame = frame.loc[:pd.Timestamp.today().to_period("M").to_timestamp()]

    frame.attrs["evaluated"] = list(monthly_flags)
    return frame


def _required(spec: Signpost) -> tuple[str, ...]:
    """Which input series a rule needs. Kept beside the rules on purpose."""
    return {
        "pe": ("Trailing P/E",),
        "cape": ("CAPE",),
        "vol": ("VIXCLS",),
        "credit": ("BAA10Y",),
        "curve": ("DGS10", "DGS3MO"),
        "policy": ("FEDFUNDS",),
        "sloos": ("DRTSCILM",),
        "labour": ("UNRATE",),
        "decomp": ("BAMLH0A3HYC", "BAMLH0A1HYBB"),
    }[spec.key]


# --------------------------------------------------------------------------- #
# Grid
# --------------------------------------------------------------------------- #

def _at(frame: pd.DataFrame, key: str, when: pd.Timestamp) -> float | None:
    """The rule's reading in the month containing `when`."""
    if key not in frame.columns:
        return None
    month = pd.Timestamp(when).to_period("M").to_timestamp()
    if month not in frame.index:
        return None
    value = frame.at[month, key]
    return None if pd.isna(value) else float(value)


def grid(frame: pd.DataFrame, recent_months: int = 3) -> tuple[pd.DataFrame, list[str]]:
    """
    The checklist: signposts down the side, prior peaks and recent months across.

    Cells are 1.0 (triggered), 0.0 (not triggered) or NaN (not evaluable at that
    date). The caller renders NaN as a dash and leaves it out of the denominator.
    """
    columns: list[tuple[str, pd.Timestamp]] = [
        (label, pd.Timestamp(date)) for label, date in PEAKS
    ]

    judged = frame[[s.key for s in SIGNPOSTS if s.key in frame.columns]]

    # Anchor the recent columns on the last month with near-full coverage.
    #
    # The right edge is always ragged: Shiller's earnings are provisional for
    # two or three months, monthly FRED series land mid-month, and a quarterly
    # rule carried forward outlives both. Anchoring on the last month with ANY
    # reading puts the panel on a month where most rows are dashes, and the
    # "% triggered" headline is then a ratio out of two or three - which reads
    # far higher than the same conditions measured out of nine.
    #
    # Tolerate exactly one lagging series. Demanding full coverage would drag
    # the panel months into the past whenever one input is provisional; a
    # looser bar lets a half-empty month set the headline.
    counts = judged.notna().sum(axis=1)
    recent_max = int(counts.loc[counts.index >= counts.index.max()
                                - pd.DateOffset(years=3)].max())
    broad = counts[(counts >= max(1, recent_max - 1))
                   & (counts.index <= pd.Timestamp.today())]
    last = broad.index.max() if not broad.empty else judged.dropna(how="all").index.max()

    recent = [last - pd.DateOffset(months=i) for i in range(recent_months - 1, -1, -1)]
    columns += [(f"{d:%b %Y}", d) for d in recent]

    rows = {}
    for spec in SIGNPOSTS:
        rows[spec.label] = [_at(frame, spec.key, when) for _, when in columns]

    out = pd.DataFrame(rows, index=[label for label, _ in columns]).T
    return out, [label for label, _ in columns]


def triggered_share(cells: pd.DataFrame) -> pd.DataFrame:
    """Per-column triggered count, evaluated count and percentage."""
    triggered = cells.sum(axis=0, skipna=True)
    evaluated = cells.notna().sum(axis=0)
    share = (triggered / evaluated.replace(0, pd.NA) * 100.0).astype("Float64")
    return pd.DataFrame({"Triggered": triggered.astype(int),
                         "Evaluated": evaluated.astype(int),
                         "% triggered": share})


def coverage(frame: pd.DataFrame) -> pd.DataFrame:
    """
    When each rule first becomes evaluable, and how much history it has.

    Every dash in the grid should be explained by a row here. Without this, a
    short-history input looks identical to a broken refresh - which is exactly
    the confusion that made the ICE BofA truncation worth catching.
    """
    rows = []
    for spec in SIGNPOSTS:
        if spec.key not in frame.columns:
            rows.append({"Signpost": spec.label, "First evaluable": pd.NaT,
                         "Months": 0, "Reaches earliest peak": False,
                         "Source": spec.source})
            continue
        judged = frame[spec.key].dropna()
        first = judged.index.min() if not judged.empty else pd.NaT
        earliest_peak = pd.Timestamp(min(date for _, date in PEAKS))
        rows.append({
            "Signpost": spec.label,
            "First evaluable": first,
            "Months": int(len(judged)),
            "Reaches earliest peak": bool(pd.notna(first) and first <= earliest_peak),
            "Source": spec.source,
        })
    return pd.DataFrame(rows)


def history(frame: pd.DataFrame, min_evaluated: int = 4) -> pd.Series:
    """
    Share of evaluable signposts triggered, month by month.

    Months with fewer than `min_evaluated` judgeable rules are dropped rather
    than plotted. With a denominator of one or two the series can only take the
    values 0, 50 and 100, and a chart of that reads as violent regime change
    when all it shows is that most of the panel did not exist yet.
    """
    keys = [s.key for s in SIGNPOSTS if s.key in frame.columns]
    if not keys:
        return pd.Series(dtype="float64")
    block = frame[keys]
    evaluated = block.notna().sum(axis=1)
    triggered = block.sum(axis=1, skipna=True)
    out = (triggered / evaluated.where(evaluated >= min_evaluated) * 100.0).dropna()
    out.name = "% of signposts triggered"
    return out
