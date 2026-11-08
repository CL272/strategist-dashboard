"""
Lead/lag toolkit.
=================
The machinery behind "pushed forward N months" charts, plus the check those
charts usually omit.

Shifting a series forward and eyeballing the fit is the most overfitted genre in
macro: the lag is a free parameter, and it is almost always chosen after looking
at the answer. So this module gives you three things together, and the page shows
all three:

    shift_forward()      the overlay itself
    cross_correlation()  correlation at EVERY lag, so the data picks the lead
    rolling_correlation() whether the relationship holds up, or is really just
                          2008 and 2020 doing the work

A peak correlation of 0.7 at a lag the CCF agrees on, stable across decades, is
a finding. A peak of 0.3 at a lag that wanders is a chart.
"""

from __future__ import annotations

import pandas as pd

MONTHLY = "MS"


def shift_forward(series: pd.Series, months: int) -> pd.Series:
    """
    Push a series forward in time by N months.

    The values are unchanged; their dates move later. A leading indicator
    plotted this way extends N months beyond today, which is the point - that
    overhang is its implied path for whatever it leads.
    """
    if series is None or series.empty or months == 0:
        return series
    out = series.copy()
    out.index = out.index + pd.DateOffset(months=months)
    return out


def to_monthly(series: pd.Series) -> pd.Series:
    """Month-start grid, last observation in each month."""
    if series is None or series.empty:
        return pd.Series(dtype="float64")
    return series.resample(MONTHLY).last().dropna()


def align(a: pd.Series, b: pd.Series, lead_months: int = 0) -> pd.DataFrame:
    """Monthly frame of the two series with `a` pushed forward `lead_months`."""
    left = to_monthly(shift_forward(a, lead_months))
    right = to_monthly(b)
    if left.empty or right.empty:
        return pd.DataFrame()
    return pd.concat({"a": left, "b": right}, axis=1).dropna()


def cross_correlation(a: pd.Series, b: pd.Series, max_lag: int = 24,
                      min_overlap: int = 36) -> pd.DataFrame:
    """
    Correlation between `a` and `b` at every lead from -max_lag to +max_lag months.

    Positive lead means `a` leads `b`: a's value today lines up with b's value
    `lead` months from now. Returns lead, correlation and the sample size behind
    each point - a correlation computed on 40 overlapping months deserves less
    weight than one computed on 300.
    """
    rows = []
    for lead in range(-max_lag, max_lag + 1):
        paired = align(a, b, lead)
        if len(paired) < min_overlap:
            continue
        rows.append({
            "Lead (months)": lead,
            "Correlation": float(paired["a"].corr(paired["b"])),
            "Observations": len(paired),
        })
    return pd.DataFrame(rows)


def best_lead(ccf: pd.DataFrame) -> dict | None:
    """The lead with the strongest absolute correlation."""
    if ccf.empty:
        return None
    row = ccf.loc[ccf["Correlation"].abs().idxmax()]
    return {
        "lead": int(row["Lead (months)"]),
        "correlation": float(row["Correlation"]),
        "observations": int(row["Observations"]),
    }


def rolling_correlation(a: pd.Series, b: pd.Series, lead_months: int,
                        window_months: int = 60) -> pd.Series:
    """
    Correlation at a fixed lead, computed on a rolling window.

    This is the honesty check. If a relationship only exists in two crisis
    windows, this line collapses in between and you can see it.
    """
    paired = align(a, b, lead_months)
    if len(paired) < window_months:
        return pd.Series(dtype="float64")
    return paired["a"].rolling(window_months).corr(paired["b"]).dropna()


def summary(a: pd.Series, b: pd.Series, lead_months: int,
            max_lag: int = 24) -> dict:
    """Everything the page needs for one pair, in one call."""
    ccf = cross_correlation(a, b, max_lag=max_lag)
    paired = align(a, b, lead_months)
    return {
        "ccf": ccf,
        "best": best_lead(ccf),
        "correlation_at_lead": (float(paired["a"].corr(paired["b"]))
                                if len(paired) > 2 else None),
        "observations_at_lead": len(paired),
    }
