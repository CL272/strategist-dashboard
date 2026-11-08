"""
Inflation, activity, labour and policy rates, by region.
========================================================
This block adds almost no new plumbing. The Japanese series come from e-Stat
and the Malaysian ones from OpenDOSM and Bank Negara - both fetchers already
existed, built for the Calendar, where they were used to fill a single "Actual"
column and then thrown away. Here they are kept.

    Japan      e-Stat: CPI nationwide, Tokyo CPI (the advance read), unemployment
    Malaysia   OpenDOSM: CPI, industrial production, unemployment, trade,
               GDP. Bank Negara: the OPR.
    US         FRED: CPI, core PCE, industrial production, unemployment, and
               the fed funds target.
    Euro area  FRED: the ECB deposit facility rate only.

Why the euro area is thin
-------------------------
Its policy rate is on FRED and reliable. Euro-area HICP and unemployment are
distributed through the OECD and Eurostat families that FRED has been culling -
the euro-area *share price* aggregate in data/equity.py froze for five months
in 2026 with no discontinuation flag - so rather than add two series that may
quietly stop, the euro area appears here as a policy rate and is charted
alongside the others. The ECB's own SDMX portal is the right place to get the
rest, and that is a separate piece of work.

Everything is stated in the unit the series is actually published in. Nothing
is rebased, spliced or annualised silently; where a transform is applied it is
named in the registry below.
"""

from __future__ import annotations

from dataclasses import dataclass

import pandas as pd

from data.fred import fetch_series_raw


class MacroError(RuntimeError):
    """No regional macro series could be retrieved."""


PANEL_INFLATION = "Inflation"
PANEL_ACTIVITY = "Activity"
PANEL_LABOUR = "Labour"
PANEL_POLICY = "Policy"
PANEL_TRADE = "Trade"


@dataclass(frozen=True)
class Macro:
    label: str          # column name in the cache
    panel: str
    unit: str
    note: str = ""


# --------------------------------------------------------------------------- #
# What each upstream series becomes
# --------------------------------------------------------------------------- #

#: (region, spec name) as e-Stat's fetcher keys them -> what to call it here.
JAPAN: dict[tuple[str, str], Macro] = {
    ("Japan", "CPI (nationwide, YoY)"): Macro(
        "Japan CPI YoY", PANEL_INFLATION, "%"),
    ("Japan", "CPI (Tokyo, advance)"): Macro(
        "Japan Tokyo CPI YoY", PANEL_INFLATION, "%",
        "Published about three weeks before the nationwide figure and tracks "
        "it closely - the earliest read on Japanese inflation there is."),
    ("Japan", "Unemployment rate"): Macro(
        "Japan unemployment", PANEL_LABOUR, "%"),
}

#: Keyed the way data/malaysia.py names its specs, which is not how anyone
#: would name them on a chart.
MALAYSIA: dict[tuple[str, str], Macro] = {
    ("Malaysia", "CPI (YoY)"): Macro("Malaysia CPI YoY", PANEL_INFLATION, "%"),
    ("Malaysia", "Industrial Production Index"): Macro(
        "Malaysia IPI YoY", PANEL_ACTIVITY, "%"),
    ("Malaysia", "Labour force / unemployment"): Macro(
        "Malaysia unemployment", PANEL_LABOUR, "%"),
    ("Malaysia", "External trade"): Macro(
        "Malaysia trade balance", PANEL_TRADE, "RM mn",
        "Monthly goods balance. Kept on its own panel because it is a level "
        "in ringgit, not a rate."),
    ("Malaysia", "GDP and balance of payments"): Macro(
        "Malaysia GDP YoY", PANEL_ACTIVITY, "%",
        "Quarterly. Charted as a step, because that is what it is."),
}

#: FRED id -> (what it becomes, how to transform it).
#: "yoy" means twelve-month percentage change on the monthly series; "level"
#: means the published number is already what we want.
US_AND_POLICY: dict[str, tuple[Macro, str]] = {
    "CPIAUCSL": (Macro("US CPI YoY", PANEL_INFLATION, "%"), "yoy"),
    "PCEPILFE": (Macro("US core PCE YoY", PANEL_INFLATION, "%",
                       "The Fed's own target measure - core, and PCE rather "
                       "than CPI, which runs a few tenths lower."), "yoy"),
    "INDPRO": (Macro("US industrial production YoY", PANEL_ACTIVITY, "%"), "yoy"),
    "UNRATE": (Macro("US unemployment", PANEL_LABOUR, "%"), "level"),
    "DFEDTARU": (Macro("US policy rate", PANEL_POLICY, "%",
                       "Fed funds target, upper bound."), "level"),
    "ECBDFR": (Macro("Euro area policy rate", PANEL_POLICY, "%",
                     "Deposit facility rate."), "level"),
}

#: Everything the page can show, by the column name it will find in the cache.
CATALOGUE: dict[str, Macro] = {
    **{m.label: m for m in JAPAN.values()},
    **{m.label: m for m in MALAYSIA.values()},
    **{m.label: m for spec, (m, _) in US_AND_POLICY.items()},
    "Malaysia policy rate": Macro(
        "Malaysia policy rate", PANEL_POLICY, "%",
        "The Overnight Policy Rate, from Bank Negara. Decision dates only - "
        "forward-fill before charting it as a line."),
}


def panel_columns(frame: pd.DataFrame, panel: str) -> list[str]:
    """This panel's columns, in catalogue order, that are actually present."""
    return [label for label, spec in CATALOGUE.items()
            if spec.panel == panel and label in frame.columns]


def spec_for(column: str) -> Macro | None:
    return CATALOGUE.get(column)


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #

def _yoy(series: pd.Series) -> pd.Series:
    """Twelve-month percentage change, computed on a clean monthly grid."""
    monthly = series.dropna().resample("MS").last()
    return (monthly.pct_change(12) * 100.0).dropna()


def fetch_us_and_policy(start: str = "1990-01-01",
                        verbose: bool = True) -> pd.DataFrame:
    raw = fetch_series_raw(list(US_AND_POLICY), start=start, verbose=False)
    collected = {}
    for series_id, (spec, transform) in US_AND_POLICY.items():
        series = raw.get(series_id)
        if series is None or series.empty:
            continue
        values = _yoy(series) if transform == "yoy" else series.dropna()
        if not values.empty:
            collected[spec.label] = values.rename(spec.label)

    if not collected:
        raise MacroError(
            f"None of {list(US_AND_POLICY)} returned data from FRED.")

    frame = pd.concat(collected.values(), axis=1).sort_index()
    frame.index.name = "Date"
    if verbose:
        print(f"  [ok]   US and policy rates  {len(collected)} series, through "
              f"{frame.dropna(how='all').index.max():%Y-%m-%d}")
    return frame


def _from_actuals(actuals: dict[tuple[str, str], pd.Series],
                  mapping: dict[tuple[str, str], Macro],
                  label: str, verbose: bool) -> pd.DataFrame:
    """Rename the calendar's actuals into chart columns, dropping the rest."""
    collected, unmapped = {}, []
    for key, series in actuals.items():
        spec = mapping.get(key)
        if spec is None:
            unmapped.append(key[1])
            continue
        clean = series.dropna()
        if not clean.empty:
            collected[spec.label] = clean.rename(spec.label)

    if not collected:
        raise MacroError(f"{label}: nothing usable came back "
                         f"({len(actuals)} series fetched, none recognised).")

    frame = pd.concat(collected.values(), axis=1).sort_index()
    frame = frame[~frame.index.duplicated(keep="last")]
    frame.index.name = "Date"
    if verbose:
        print(f"  [ok]   {label:<21} {len(collected)} series, through "
              f"{frame.dropna(how='all').index.max():%Y-%m}")
        if unmapped:
            print(f"         fetched but not charted: {', '.join(unmapped)}")
    return frame


def build_macro(start: str = "1990-01-01", verbose: bool = True) -> pd.DataFrame:
    """
    One frame of regional inflation, activity, labour and policy.

    Each source is isolated: Japan being down must not cost Malaysia, and
    neither must cost the US block, which is the one that always works.
    """
    from data.econ_calendar import fetch_estat_actuals, fetch_malaysia_actuals

    parts, problems = [], {}

    def attempt(name, call):
        try:
            parts.append(call())
        except Exception as exc:      # noqa: BLE001 - one source of four
            problems[name] = str(exc)
            if verbose:
                print(f"  [FAIL] {name:<21} {str(exc).splitlines()[0]}")

    attempt("US and policy", lambda: fetch_us_and_policy(start, verbose))
    attempt("Japan (e-Stat)", lambda: _from_actuals(
        fetch_estat_actuals(verbose=False), JAPAN, "Japan (e-Stat)", verbose))
    attempt("Malaysia (DOSM)", lambda: _from_actuals(
        fetch_malaysia_actuals(verbose=False), MALAYSIA,
        "Malaysia (DOSM)", verbose))

    def opr() -> pd.DataFrame:
        from data.malaysia import fetch_opr_history
        series = fetch_opr_history(years=15, verbose=False)
        out = series.rename("Malaysia policy rate").to_frame()
        out.index.name = "Date"
        if verbose:
            print(f"  [ok]   Malaysia policy rate  {len(out)} decisions, "
                  f"through {out.index.max():%Y-%m-%d}")
        return out

    attempt("Malaysia policy rate", opr)

    if not parts:
        raise MacroError("No regional macro source returned data. First error:\n  "
                         + next(iter(problems.values()), "unknown"))

    frame = pd.concat(parts, axis=1).sort_index()
    frame = frame.loc[pd.Timestamp(start):]
    frame.index.name = "Date"
    frame.attrs["problems"] = problems

    # Catalogue order, so the cached CSV reads region by region rather than in
    # whatever order the sources happened to answer.
    ordered = [c for c in CATALOGUE if c in frame.columns]
    return frame[ordered + [c for c in frame.columns if c not in ordered]]


def describe() -> pd.DataFrame:
    """`python refresh.py --macro-check` - what each region actually served."""
    from data.econ_calendar import fetch_estat_actuals, fetch_malaysia_actuals

    rows = []
    checks = (
        ("US and policy", lambda: fetch_us_and_policy(verbose=False)),
        ("Japan (e-Stat)", lambda: _from_actuals(
            fetch_estat_actuals(verbose=False), JAPAN, "Japan", False)),
        ("Malaysia (DOSM)", lambda: _from_actuals(
            fetch_malaysia_actuals(verbose=False), MALAYSIA, "Malaysia", False)),
    )
    for label, call in checks:
        try:
            frame = call()
        except Exception as exc:      # noqa: BLE001
            rows.append({"Source": label, "Status": "FAIL", "Series": 0,
                         "From": "", "To": "",
                         "Detail": str(exc).replace("\n", " ")[:160]})
            continue
        live = frame.dropna(how="all")
        rows.append({
            "Source": label, "Status": "ok", "Series": frame.shape[1],
            "From": f"{live.index.min():%Y-%m}" if len(live) else "",
            "To": f"{live.index.max():%Y-%m}" if len(live) else "",
            "Detail": ", ".join(frame.columns)[:160],
        })
    return pd.DataFrame(rows)
