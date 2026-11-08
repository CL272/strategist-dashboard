"""
Liquidity block builder.
========================
Replaces the standalone generator script. Produces exactly the columns
macro_liquidity_master.csv had, so app.py keeps working unchanged - but the
series come through the registry (units audited, no bfill) and the output goes
to the cache rather than to a file you then have to remember to regenerate.

    from data.liquidity import build_liquidity
    df = build_liquidity(start="2010-01-01")

Differences from the original script are marked FIX / CHANGE below and are
listed in refresh.py's output when the block is built.
"""

from __future__ import annotations

import pandas as pd

from data import registry
from data.fred import fetch_series_raw

# The original script started here. 2010 is a better default: it puts the
# September 2019 repo episode - the reference case for reserve scarcity -
# inside the sample, which matters for any percentile-based scoring later.
DEFAULT_START = "2010-01-01"


def _scaled(raw: dict[str, pd.Series], series_id: str) -> pd.Series | None:
    """Apply the registry scale factor to a raw FRED series."""
    if series_id not in raw:
        return None
    spec = registry.lookup(series_id)
    series = raw[series_id]
    if spec is not None and spec.scale != 1.0:
        series = series * spec.scale
    return series


def _m2_metrics(m2_monthly: pd.Series) -> pd.DataFrame:
    """
    M2 growth computed on the NATIVE MONTHLY series.

    CHANGE: the original computed these on a daily forward-filled copy, using
    pct_change(365) and rolling(90). That works out to roughly the right
    numbers but produces a staircase, and the 90-calendar-day window drifts
    against actual quarters. Computing on monthly data and then reindexing
    gives the same shape without the artefacts.
    """
    monthly = m2_monthly.resample("MS").last().dropna()
    return pd.DataFrame({
        "M2_YoY_Growth_%": monthly.pct_change(12) * 100.0,
        "M2_3M_MA": monthly.rolling(3).mean(),
        "M2_3M_Annualized_%": ((monthly / monthly.shift(3)) ** 4 - 1.0) * 100.0,
    })


def build_liquidity(start: str = DEFAULT_START,
                    end: str | None = None,
                    verbose: bool = True) -> pd.DataFrame:
    """Fetch, scale, align and derive the full liquidity panel on a daily index."""
    ids = registry.fred_ids("Funding")
    raw = fetch_series_raw(ids, start=start, verbose=verbose)

    # ---- M2 growth on native monthly frequency, before any reindexing -------
    m2_raw = raw.get("M2SL")
    m2_frame = _m2_metrics(m2_raw) if m2_raw is not None else None

    # ---- scale to target units and align on a daily index ------------------
    scaled = {}
    for series_id in ids:
        series = _scaled(raw, series_id)
        if series is None or series.empty:
            continue
        spec = registry.lookup(series_id)
        scaled[spec.name if spec else series_id] = series

    if not scaled:
        raise RuntimeError("No liquidity series retrieved.")

    frame = pd.concat(scaled.values(), axis=1, keys=scaled.keys()).sort_index()
    last = pd.Timestamp(end) if end else frame.index.max()
    daily = pd.date_range(start=start, end=last, freq="D", name="Date")

    # FIX: the original did .ffill().bfill(). The back-fill invented history -
    # IORB does not exist before 2021-07-29, so every pre-2021 IORB value (and
    # therefore both spread columns) was the July 2021 rate copied backwards.
    # Forward-fill only; leading gaps stay NaN and are dropped per-series at
    # plot time by app.py's get() helper.
    frame = frame.reindex(daily).ffill()

    if m2_frame is not None:
        frame = frame.join(m2_frame.reindex(daily).ffill())

    # ---- derived columns ---------------------------------------------------
    def has(*cols: str) -> bool:
        return all(c in frame.columns for c in cols)

    if has("SOFR_Rate", "IORB_Rate"):
        frame["SOFR_IORB_Spread_bps"] = (frame["SOFR_Rate"] - frame["IORB_Rate"]) * 100.0
    if has("EFFR_Rate", "IORB_Rate"):
        frame["EFFR_IORB_Spread_bps"] = (frame["EFFR_Rate"] - frame["IORB_Rate"]) * 100.0

    # FIX: TGA_Balance is now correctly scaled from millions to billions.
    # The original subtracted a millions figure (~950,000) from a billions
    # figure (~6,700), which made Net_Liquidity_Bil roughly -945,000.
    if has("Fed_Total_Assets_Bil", "TGA_Balance", "ON_RRP_Facility"):
        frame["Net_Liquidity_Bil"] = (
            frame["Fed_Total_Assets_Bil"] - frame["TGA_Balance"] - frame["ON_RRP_Facility"]
        )

    if has("Total_Reserves", "Nominal_GDP"):
        frame["Reserves_to_GDP_%"] = frame["Total_Reserves"] / frame["Nominal_GDP"] * 100.0

    if has("Total_Reserves", "All_Bank_Assets"):
        # Column name kept for app.py compatibility. The denominator is all
        # commercial banks, which is what the 8.5-9.0% band is calibrated to.
        frame["Reserves_to_Large_Bank_Assets_%"] = (
            frame["Total_Reserves"] / frame["All_Bank_Assets"] * 100.0
        )

    if has("Large_Bank_Cash", "Total_Reserves"):
        # CHANGE: same arithmetic as the original, honest name. This is large
        # banks' cash as a share of SYSTEM RESERVES - a reserve-concentration
        # measure - not cash as a share of their own assets.
        frame["Large_Bank_Share_of_Reserves_%"] = (
            frame["Large_Bank_Cash"] / frame["Total_Reserves"] * 100.0
        )
        # Alias so the existing app.py chart keeps rendering.
        frame["Large_Bank_Cash_Share_%"] = frame["Large_Bank_Share_of_Reserves_%"]

    if has("Large_Bank_Cash", "All_Bank_Assets"):
        # The metric the old column NAME implied, now actually computed.
        frame["Large_Bank_Cash_to_Assets_%"] = (
            frame["Large_Bank_Cash"] / frame["All_Bank_Assets"] * 100.0
        )

    # SRF: no operation on a given day genuinely means zero take-up.
    if "SRF_Daily_Accepted_Bil" in frame.columns:
        frame["SRF_Daily_Accepted_Bil"] = frame["SRF_Daily_Accepted_Bil"].fillna(0.0)

    frame.index.name = "Date"
    return frame


#: Reported by refresh.py so the changes are visible rather than silent.
CHANGE_LOG: tuple[tuple[str, str], ...] = (
    ("FIX", "TGA_Balance: WTREGEN is reported in MILLIONS. It was being used as "
            "billions, so Net_Liquidity_Bil was ~-945,000 instead of ~+5,750."),
    ("FIX", "SRF_Daily_Accepted_Bil: the NY Fed URL in the old script "
            "(/api/rp/reposts/all/results/summary/) returns HTTP 400, so the "
            "except branch ran and the column was 0.0 for its entire history. "
            "Now sourced from FRED RPONTSYD - daily, billions, back to 2000."),
    ("FIX", "No more .bfill(). IORB starts 2021-07-29, so both spread columns "
            "were fabricated before that date."),
    ("CHANGE", "Large_Bank_Assets renamed All_Bank_Assets - TLAACBW027SBOG is "
               "All Commercial Banks. Ticker kept: the 8.5-9.0% band is "
               "calibrated to that basis."),
    ("CHANGE", "Large_Bank_Cash_Share_% renamed Large_Bank_Share_of_Reserves_% "
               "(old name aliased). Added Large_Bank_Cash_to_Assets_%, which is "
               "what the old name actually implied."),
    ("CHANGE", "M2 growth computed on native monthly data, not daily-ffilled."),
    ("CHANGE", "Added Total_Reserves_Weekly (WRESBAL). TOTRESNS is monthly and "
               "can be 8 weeks stale on a daily dashboard."),
    ("CHANGE", "Default history starts 2010, not 2020 - puts Sept 2019 in sample."),
)
