"""
Composite stress engine.
========================
Turns the block caches into one comparable panel.

The method, in four steps:

1. **Resample to weekly.** Blocks arrive at mixed frequencies - daily repo
   rates next to monthly surveys next to quarterly GDP. Weekly (Friday) is the
   common grid: fast enough that a funding squeeze shows up inside a week,
   slow enough that a monthly series forward-filled onto it doesn't spend
   twenty days pretending to be new information.

2. **Percentile-rank on a trailing window.** Not z-scores: stress series are
   fat-tailed and skewed, so a z of 3 means very different things for VIX and
   for the SOFR-IORB spread. Percentiles put everything on the same 0-100
   footing. The window is backward-looking, so no reading uses its own future.

3. **Sign-align.** Series where low means stressed (reserves/GDP, CFNAI) are
   flipped, so every row reads "higher = more stress".

4. **Average within block, then across blocks.** A block with eight members
   would otherwise outvote one with seven purely on headcount.

Nothing here imports streamlit - it takes frames and returns frames.
"""

from __future__ import annotations

import pandas as pd

from data import registry

WEEKLY_RULE = "W-FRI"
WEEKS_PER_YEAR = 52

#: Minimum weekly observations inside the window before a percentile is emitted.
MIN_OBS = 104  # two years


def cache_column(spec: registry.Series) -> str:
    """
    The column a registry entry actually occupies in its cached frame.

    Block builders write fetched series under their display name (`spec.name`),
    so `spec.id` - the FRED ticker - is not what lands in the parquet. Derived
    entries are the exception: their `id` IS the column the builder created,
    and `name` is a prettier label for the chart axis.
    """
    return spec.id if spec.source == "derived" else spec.name


def to_weekly(frame: pd.DataFrame) -> pd.DataFrame:
    """Resample a block frame onto the common weekly (Friday) grid."""
    if frame is None or frame.empty:
        return pd.DataFrame()
    weekly = frame.resample(WEEKLY_RULE).last()
    weekly.index.name = "Date"
    return weekly


def percentile_of(series: pd.Series, window_years: int = 10,
                   min_obs: int = MIN_OBS, higher_is_stress: bool = True) -> pd.Series:
    """
    Percentile-rank one series on the same weekly, trailing, sign-aligned basis
    the composite uses. Exposed so an external index can be put on exactly the
    same footing as the panel it is checking - a comparison against a differently
    computed percentile would not mean anything.
    """
    weekly = series.resample(WEEKLY_RULE).last().dropna()
    if len(weekly) < min_obs:
        return pd.Series(dtype="float64")
    window = int(WEEKS_PER_YEAR * window_years)
    ranked = weekly.rolling(window, min_periods=min_obs).rank(pct=True)
    aligned = ranked if higher_is_stress else 1.0 - ranked
    return aligned * 100.0


def stress_percentiles(frames: dict[str, pd.DataFrame],
                       window_years: int = 10,
                       min_obs: int = MIN_OBS) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Percentile-rank every composite member, sign-aligned.

    `frames` maps block name -> that block's cached frame.

    Returns (percentiles, meta) where percentiles is weekly 0-100 per indicator
    and meta describes each column (block, source column, direction).
    """
    window = int(WEEKS_PER_YEAR * window_years)
    weekly_blocks = {name: to_weekly(frame) for name, frame in frames.items()}

    columns: dict[str, pd.Series] = {}
    meta_rows = []

    for spec in registry.composite_members():
        weekly = weekly_blocks.get(spec.block)
        column = cache_column(spec)
        if weekly is None or column not in weekly.columns:
            continue

        series = weekly[column].dropna()
        if len(series) < min_obs:
            continue

        ranked = series.rolling(window, min_periods=min_obs).rank(pct=True)
        aligned = ranked if spec.higher_is_stress else 1.0 - ranked
        label = registry.display_name(spec)
        columns[label] = aligned * 100.0

        meta_rows.append({
            "Indicator": label,
            "Block": spec.block,
            "Column": column,
            "Direction": "high = stress" if spec.higher_is_stress else "low = stress",
            "Unit": spec.unit,
        })

    if not columns:
        return pd.DataFrame(), pd.DataFrame()

    percentiles = pd.concat(columns.values(), axis=1, keys=columns.keys()).sort_index()
    # Blocks share the same weekly grid, but a block whose source data ends
    # earlier leaves a short tail of NaN. Bridge only small gaps - anything
    # longer than a quarter should read as missing, not as stale-but-current.
    percentiles = percentiles.ffill(limit=13)
    percentiles.index.name = "Date"

    return percentiles, pd.DataFrame(meta_rows)


def block_composites(percentiles: pd.DataFrame, meta: pd.DataFrame) -> pd.DataFrame:
    """Average within each block, then across blocks for the headline."""
    if percentiles.empty or meta.empty:
        return pd.DataFrame()

    out = {}
    for block, group in meta.groupby("Block", sort=False):
        members = [c for c in group["Indicator"] if c in percentiles.columns]
        if members:
            out[block] = percentiles[members].mean(axis=1)

    frame = pd.DataFrame(out)
    if not frame.empty:
        # Unweighted across blocks on purpose: an eight-member block should not
        # count more than a seven-member one just because it has more series.
        frame["Composite"] = frame.mean(axis=1)
    frame.index.name = "Date"
    return frame


def latest_snapshot(percentiles: pd.DataFrame, meta: pd.DataFrame,
                    frames: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """Current percentile per indicator, with the underlying value and its date."""
    if percentiles.empty or meta.empty:
        return pd.DataFrame()

    rows = []
    for _, spec in meta.iterrows():
        name = spec["Indicator"]
        if name not in percentiles.columns:
            continue
        series = percentiles[name].dropna()
        if series.empty:
            continue

        raw = frames.get(spec["Block"])
        value, as_of = None, None
        if raw is not None and spec["Column"] in raw.columns:
            native = raw[spec["Column"]].dropna()
            if not native.empty:
                value = float(native.iloc[-1])
                changed = native.ne(native.shift())
                changed.iloc[0] = True
                as_of = native.index[changed][-1]

        rows.append({
            "Indicator": name,
            "Block": spec["Block"],
            "Percentile": float(series.iloc[-1]),
            "Latest": value,
            "As of": as_of,
            "Direction": spec["Direction"],
        })

    return pd.DataFrame(rows).sort_values(["Block", "Percentile"],
                                          ascending=[True, False])


def band(percentile: float) -> str:
    """Plain-language reading of a percentile."""
    if percentile >= 90:
        return "Acute"
    if percentile >= 75:
        return "Elevated"
    if percentile >= 50:
        return "Above normal"
    if percentile >= 25:
        return "Normal"
    return "Calm"
