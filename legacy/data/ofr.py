"""
OFR Financial Stress Index.
===========================
An independently constructed daily stress index from the Treasury's Office of
Financial Research: 33 market variables, five categories, three regions. No API
key, no registration - one CSV.

It exists here as a **cross-check, not an input**. Every series in this block
carries `higher_is_stress=None`, which keeps it out of the composite panel by
construction. That is the point: an index that voted in the composite could no
longer be used to check the composite.

Worth knowing what it is and isn't. The OFR index is built entirely from
*market prices* - spreads, implied vols, valuation ratios, funding rates. Our
own panel also carries quantity data (reserves, repo take-up, discount window)
and real-economy data (claims, surveys, activity indices) that no market price
reflects directly. So the two disagreeing is informative rather than an error:
it usually means the plumbing or the real economy is saying something markets
have not priced yet, or the reverse.

The index publishes with a two-business-day lag.
"""

from __future__ import annotations

import io

import pandas as pd
import requests

FSI_URL = "https://www.financialresearch.gov/financial-stress-index/data/fsi.csv"
TIMEOUT = 45

#: Source header -> our column name. Source headers are matched case-insensitively
#: and whitespace-stripped, so a cosmetic change upstream doesn't break the load.
COLUMN_MAP = {
    "ofr fsi": "OFR FSI",
    "credit": "OFR - credit",
    "equity valuation": "OFR - equity valuation",
    "safe assets": "OFR - safe assets",
    "funding": "OFR - funding",
    "volatility": "OFR - volatility",
    "united states": "OFR - United States",
    "other advanced economies": "OFR - other advanced",
    "emerging markets": "OFR - emerging markets",
}

CATEGORIES = ("OFR - credit", "OFR - equity valuation", "OFR - safe assets",
              "OFR - funding", "OFR - volatility")

REGIONS = ("OFR - United States", "OFR - other advanced", "OFR - emerging markets")


class OFRError(RuntimeError):
    """Raised when the index cannot be retrieved or parsed."""


def fetch_fsi(url: str = FSI_URL) -> pd.DataFrame:
    """Download and parse the OFR FSI CSV."""
    try:
        response = requests.get(url, timeout=TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise OFRError(f"Could not reach the OFR index: {exc}") from None

    try:
        raw = pd.read_csv(io.StringIO(response.text))
    except (ValueError, pd.errors.ParserError) as exc:
        raise OFRError(f"Could not parse the OFR CSV: {exc}") from None

    return _prepare(raw)


def _prepare(raw: pd.DataFrame) -> pd.DataFrame:
    """Normalise headers, index on date, coerce to float."""
    lookup = {str(c).strip().lower(): c for c in raw.columns}

    date_col = lookup.get("date")
    if date_col is None:
        raise OFRError(f"No Date column in the OFR CSV. Got: {list(raw.columns)}")

    frame = raw.copy()
    frame[date_col] = pd.to_datetime(frame[date_col], errors="coerce")
    frame = frame.dropna(subset=[date_col]).set_index(date_col).sort_index()
    frame.index.name = "Date"

    renamed = {}
    for source_key, target in COLUMN_MAP.items():
        original = lookup.get(source_key)
        if original is not None and original in frame.columns:
            renamed[target] = pd.to_numeric(frame[original], errors="coerce")

    if "OFR FSI" not in renamed:
        raise OFRError(
            "The OFR CSV had no 'OFR FSI' column - the format may have changed. "
            f"Columns seen: {list(raw.columns)}"
        )

    out = pd.DataFrame(renamed)
    out = out[~out.index.duplicated(keep="last")]
    out.index.name = "Date"
    return out


def build_ofr(start: str = "2005-01-01", verbose: bool = True) -> pd.DataFrame:
    """Fetch the index and trim to the requested history."""
    frame = fetch_fsi()
    frame = frame.loc[pd.Timestamp(start):]
    if frame.empty:
        raise OFRError(f"No OFR observations on or after {start}.")
    if verbose:
        last = frame["OFR FSI"].dropna()
        print(f"  [ok]   OFR FSI{'':<15} {len(frame):>6,} obs   "
              f"through {last.index[-1]:%Y-%m-%d}   latest {last.iloc[-1]:+.2f}")
    return frame
