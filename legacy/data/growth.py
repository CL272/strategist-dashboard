"""
Growth block builder.
=====================
The ISM substitute. Fetches the four regional Fed surveys, standardises them
into one composite, and adds the rule-based recession tripwires.

    from data.growth import build_growth
    df = build_growth(start="2005-01-01")
"""

from __future__ import annotations

import pandas as pd

from data import registry
from data.fred import fetch_series_raw

DEFAULT_START = "2005-01-01"

#: The four districts that publish to FRED. Richmond and Kansas City do not.
SURVEYS = ("Empire State (NY)", "Philly Fed (PA)", "Dallas Fed (TX)", "Chicago Fed (IL)")

#: Published thresholds. Each is (column, level, direction) where direction is
#: "below" or "above" for the stressed side.
TRIPWIRES = (
    ("Sahm Rule (real-time)", 0.50, "above",
     "3-month MA of U-3 up 0.50pp from its trailing 12-month low"),
    ("CFNAI-MA3", -0.70, "below",
     "Chicago Fed's own published recession signal"),
    ("Claims vs 52wk low (%)", 15.0, "above",
     "4-week claims MA 15% above its 52-week low — heuristic, not an official rule"),
)


def _expanding_z(series: pd.Series, min_periods: int = 36) -> pd.Series:
    """
    Standardise using only data available up to each point.

    A full-sample z-score would tell you 2008 was extreme using information
    from 2015. The expanding window keeps the composite honest.
    """
    mean = series.expanding(min_periods=min_periods).mean()
    std = series.expanding(min_periods=min_periods).std()
    return (series - mean) / std.replace(0, pd.NA)


def build_growth(start: str = DEFAULT_START, end: str | None = None,
                 verbose: bool = True) -> pd.DataFrame:
    """Fetch the growth block, add the regional composite and claims heuristic."""
    ids = registry.fred_ids("Growth")
    raw = fetch_series_raw(ids, start=start, verbose=verbose)
    if not raw:
        raise RuntimeError("No growth series retrieved.")

    named = {}
    for series_id, series in raw.items():
        spec = registry.lookup(series_id)
        label = spec.name if spec else series_id
        # rename, not just re-key: pd.concat takes column labels from
        # Series.name, so a dict key alone would leave FRED IDs as columns.
        named[label] = series.rename(label)

    # ---- regional composite, on the native monthly frequency ---------------
    survey_cols = {name: named[name] for name in SURVEYS if name in named}
    composite = None
    districts_reporting = None
    if survey_cols:
        monthly = pd.DataFrame(survey_cols).resample("MS").last()
        z_scores = monthly.apply(_expanding_z)
        reporting = z_scores.notna().sum(axis=1)

        # Require a near-full panel. Districts publish on different days, so the
        # current month is usually short one survey - averaging over whichever
        # happen to have reported makes the composite lurch when the missing one
        # lands. Demanding 3 of 4 keeps the district mix stable month to month.
        min_required = min(3, len(survey_cols))
        composite = z_scores.mean(axis=1).where(reporting >= min_required)
        composite.name = "Regional Fed Composite"

        districts_reporting = reporting.astype(float)
        districts_reporting.name = "Districts Reporting"

    # ---- claims vs their own 52-week low -----------------------------------
    claims_ratio = None
    claims_ma = named.get("Initial Claims 4wk MA")
    if claims_ma is not None:
        weekly = claims_ma.resample("W").last().dropna()
        low52 = weekly.rolling(52, min_periods=26).min()
        claims_ratio = ((weekly / low52) - 1.0) * 100.0
        claims_ratio.name = "Claims vs 52wk low (%)"

    # ---- align everything on a daily index ---------------------------------
    parts = list(named.values())
    if composite is not None:
        parts.append(composite)
    if districts_reporting is not None:
        parts.append(districts_reporting)
    if claims_ratio is not None:
        parts.append(claims_ratio)

    frame = pd.concat(parts, axis=1).sort_index()
    last = pd.Timestamp(end) if end else frame.index.max()
    daily = pd.date_range(start=start, end=last, freq="D", name="Date")
    frame = frame.reindex(daily).ffill()
    frame.index.name = "Date"
    return frame


def last_change(series: pd.Series) -> pd.Timestamp | None:
    """
    The date a forward-filled series last actually moved.

    Everything in this block is reindexed to a daily grid and forward-filled, so
    `series.index[-1]` is today for a survey that printed six weeks ago. Reporting
    that as the observation date would be a small lie on every card. This finds
    the start of the final flat run instead.
    """
    clean = series.dropna()
    if clean.empty:
        return None
    changed = clean.ne(clean.shift())
    changed.iloc[0] = True
    return clean.index[changed][-1]


def tripwire_status(frame: pd.DataFrame) -> pd.DataFrame:
    """
    Distance to each published threshold.

    `distance` is signed so that positive always means "into stress" - it is how
    far past the trigger the indicator currently sits, in the indicator's own
    units.
    """
    rows = []
    for column, level, direction, description in TRIPWIRES:
        if column not in frame.columns:
            continue
        series = frame[column].dropna()
        if series.empty:
            continue
        latest = float(series.iloc[-1])
        distance = latest - level if direction == "above" else level - latest
        rows.append({
            "Indicator": column,
            "Latest": latest,
            "Threshold": level,
            "Direction": direction,
            "Distance": distance,
            "Triggered": distance >= 0,
            "Rule": description,
            "As of": last_change(series) or series.index[-1],
        })
    return pd.DataFrame(rows)
