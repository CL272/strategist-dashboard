"""
Credit block builder.
=====================
Mostly a straight FRED fetch, plus the one derived column the composite panel
needs: quality decompression inside high yield.
"""

from __future__ import annotations

import pandas as pd

from data import registry
from data.fred import fetch_series_raw


def build_credit(start: str = "2005-01-01", verbose: bool = True) -> pd.DataFrame:
    """Fetch the credit block and append CCC-BB decompression."""
    ids = registry.fred_ids("Credit")
    raw = fetch_series_raw(ids, start=start, verbose=verbose)
    if not raw:
        raise RuntimeError("No credit series retrieved.")

    named = {}
    for series_id, series in raw.items():
        spec = registry.lookup(series_id)
        label = spec.name if spec else series_id
        named[label] = series.rename(label)

    frame = pd.concat(named.values(), axis=1).sort_index()

    # Quality dispersion inside high yield. Computed here rather than in the
    # page so the composite panel can treat it like any other cached column.
    if "CCC & lower OAS" in frame.columns and "BB OAS" in frame.columns:
        frame["CCC-BB Decompression"] = frame["CCC & lower OAS"] - frame["BB OAS"]

    frame.index.name = "Date"
    return frame
