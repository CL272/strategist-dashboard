"""
Robert Shiller's US stock market dataset.
=========================================
The only free, long-history source of S&P 500 **earnings**. S&P Dow Jones
licenses its own EPS, and FRED carries the index level but not the earnings
behind it - so without this file there is no trailing P/E and no CAPE.

    https://shillerdata.com/          (ie_data.xls, monthly, from January 1871)

Two warnings that belong on the chart, not buried here:

**The earnings are as-reported (GAAP), not operating.** Sell-side trailing P/E
is usually quoted on operating earnings, which are higher, so this P/E prints
*above* the number in a strategist's deck - by several points in a year with
large write-downs. It is internally consistent across 150 years, which is what
a percentile band needs; it is not the same number BofA puts in a table.

**Earnings lag.** The most recent months are Shiller's own estimates until the
quarter is fully reported. The last two or three points get revised.

The parser deliberately identifies columns by their header text rather than by
position: this is a researcher's spreadsheet, not a published API, and its
layout is not a contract. `inspect_shiller()` dumps what it actually found so a
layout change produces a fixable report instead of a wrong number.
"""

from __future__ import annotations

import io
import re

import pandas as pd
import requests

PAGE_URL = "https://shillerdata.com/"

#: Used only if the landing page stops advertising the link. It carries a
#: version query string that changes on every update, so the scrape above is
#: the primary path and this is the parachute.
FALLBACK_URL = (
    "https://img1.wsimg.com/blobby/go/e5e77e0b-59d1-44d9-ab25-4763ac982e53/"
    "downloads/70fec4f5-727f-4e53-b5f1-179af109c5fa/ie_data.xls"
)

HEADERS = {"User-Agent": "Mozilla/5.0 (macro stress dashboard)"}
TIMEOUT = 90

#: Shiller writes dates as fractional years - 1871.01 is January 1871, and
#: 2026.1 is *October* 2026, not January. The trailing zero is dropped by the
#: spreadsheet, which is the trap this parser has to survive.
_YEAR_MIN, _YEAR_MAX = 1871, 2100


class ShillerError(RuntimeError):
    """Raised when the workbook cannot be downloaded or parsed."""


# --------------------------------------------------------------------------- #
# Download
# --------------------------------------------------------------------------- #

def _resolve_url() -> str:
    """Find the current ie_data.xls link on the landing page."""
    try:
        page = requests.get(PAGE_URL, headers=HEADERS, timeout=TIMEOUT)
        page.raise_for_status()
    except requests.RequestException:
        return FALLBACK_URL

    links = re.findall(r'https://[^"\'\s<>]*ie_data[^"\'\s<>]*\.xls[^"\'\s<>]*',
                       page.text)
    if not links:
        return FALLBACK_URL
    return links[0].replace("&amp;", "&")


def download() -> bytes:
    url = _resolve_url()
    try:
        response = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
        response.raise_for_status()
    except requests.RequestException as exc:
        raise ShillerError(
            f"Could not download the Shiller workbook from {url[:80]}… — {exc}"
        ) from None
    if len(response.content) < 50_000:
        raise ShillerError(
            f"The Shiller download returned only {len(response.content):,} bytes, "
            "which is too small to be the workbook. The link on shillerdata.com "
            "has probably changed."
        )
    return response.content


def _open(content: bytes) -> dict[str, pd.DataFrame]:
    try:
        return pd.read_excel(io.BytesIO(content), sheet_name=None, header=None)
    except ImportError:
        raise ShillerError(
            "Reading the .xls needs the xlrd package. Run: pip install xlrd"
        ) from None
    except Exception as exc:  # noqa: BLE001 - pandas raises several types here
        raise ShillerError(f"Could not open the Shiller workbook: {exc}") from None


# --------------------------------------------------------------------------- #
# Parse
# --------------------------------------------------------------------------- #

def _fractional_year_score(column: pd.Series) -> float:
    """How much of this column looks like Shiller's 1871.01 date encoding."""
    values = pd.to_numeric(column, errors="coerce").dropna()
    if len(values) < 100:
        return 0.0
    in_range = values.between(_YEAR_MIN, _YEAR_MAX)
    # A year column would also sit in that range, so require a fractional part.
    fractional = (values - values.round()).abs() > 1e-9
    return float((in_range & fractional).mean())


def _to_month_start(values: pd.Series) -> pd.Series:
    """1871.01 -> 1871-01-01.  2026.1 -> 2026-10-01."""
    numeric = pd.to_numeric(values, errors="coerce")
    year = numeric.astype("Float64").round(6).apply(
        lambda v: pd.NA if pd.isna(v) else int(v))
    # Two decimal places encode the month. Formatting to exactly two digits is
    # what rescues 2026.1, where the spreadsheet dropped the trailing zero.
    month = numeric.apply(
        lambda v: pd.NA if pd.isna(v) else int(round((v - int(v)) * 100)))
    month = month.apply(lambda m: pd.NA if pd.isna(m) or not 1 <= m <= 12 else m)

    out = pd.Series(pd.NaT, index=values.index, dtype="datetime64[ns]")
    valid = year.notna() & month.notna()
    if valid.any():
        out.loc[valid] = pd.to_datetime(
            {"year": year[valid].astype(int),
             "month": month[valid].astype(int),
             "day": 1})
    return out


def _combined_headers(raw: pd.DataFrame, header_row: int) -> list[str]:
    """
    Shiller's header spans several rows ('Cyclically Adjusted' on one line,
    'P/E10 or CAPE' on the next). Join a small band of rows per column so a
    label split across two lines is still matched.
    """
    lo = max(0, header_row - 2)
    hi = min(len(raw), header_row + 3)
    band = raw.iloc[lo:hi]
    out = []
    for column in band.columns:
        cells = [str(c).strip() for c in band[column].tolist()
                 if str(c).strip().lower() not in {"nan", ""}]
        out.append(" ".join(cells).lower())
    return out


def _find(headers: list[str], patterns: tuple[str, ...],
          reject: tuple[str, ...] = ()) -> int | None:
    for index, text in enumerate(headers):
        if any(bad in text for bad in reject):
            continue
        if any(re.search(p, text) for p in patterns):
            return index
    return None


def parse(sheets: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """
    Return a monthly frame with Price, Earnings, Trailing P/E and CAPE.

    Columns are located by header text; the date column is located by the shape
    of its values, which is far more stable than any label.
    """
    name = next((n for n in sheets if str(n).strip().lower() == "data"),
                next(iter(sheets)))
    raw = sheets[name]

    date_col = max(raw.columns, key=lambda c: _fractional_year_score(raw[c]))
    if _fractional_year_score(raw[date_col]) < 0.8:
        raise ShillerError(
            f"No fractional-year date column found on sheet '{name}'. "
            "Run `python refresh.py --inspect-shiller` and send me the output."
        )

    # The header sits on the last row before the numbers start.
    dates = _to_month_start(raw[date_col])
    first_data_row = int(dates.notna().idxmax())
    header_row = max(0, first_data_row - 1)
    headers = _combined_headers(raw, header_row)

    price_col = _find(headers, (r"\bprice\b", r"^p$", r"\bp\b.*comp"),
                      reject=("real", "total return", "cape", "p/e", "scaled"))
    earn_col = _find(headers, (r"\bearnings\b", r"^e$"),
                     reject=("real", "scaled", "yield", "cape", "p/e"))
    cape_col = _find(headers, (r"cape", r"p/e ?10", r"pe ?10"),
                     reject=("tr ", "total return", "excess"))

    if price_col is None or earn_col is None:
        raise ShillerError(
            f"Could not locate the price and earnings columns on sheet '{name}'. "
            f"Headers seen: {headers[:14]}. "
            "Run `python refresh.py --inspect-shiller` and send me the output."
        )

    frame = pd.DataFrame({"Date": dates})
    frame["S&P 500 Price"] = pd.to_numeric(raw[price_col], errors="coerce")
    frame["S&P 500 Earnings"] = pd.to_numeric(raw[earn_col], errors="coerce")
    if cape_col is not None:
        frame["CAPE"] = pd.to_numeric(raw[cape_col], errors="coerce")

    frame = frame.dropna(subset=["Date"]).set_index("Date").sort_index()
    frame = frame[~frame.index.duplicated(keep="last")]

    # Guard against picking up a footnote row far in the future.
    frame = frame.loc[: pd.Timestamp.today() + pd.DateOffset(years=1)]

    earnings = frame["S&P 500 Earnings"]
    frame["Trailing P/E"] = (frame["S&P 500 Price"] / earnings.where(earnings > 0))

    frame = frame.dropna(subset=["S&P 500 Price"], how="all")
    if frame.empty:
        raise ShillerError("The Shiller workbook parsed to an empty frame.")

    sanity = frame["Trailing P/E"].dropna()
    if not sanity.empty and not sanity.between(3, 200).mean() > 0.95:
        raise ShillerError(
            "Parsed trailing P/E is outside any plausible range "
            f"(median {sanity.median():.1f}) - the price and earnings columns "
            "were probably mismatched. Run `python refresh.py --inspect-shiller`."
        )

    frame.index.name = "Date"
    return frame


def fetch(verbose: bool = True) -> pd.DataFrame:
    frame = parse(_open(download()))
    if verbose:
        last = frame.dropna(subset=["Trailing P/E"]).index.max()
        print(f"  [ok]   Shiller ie_data       {len(frame):>6,} months  "
              f"through {last:%Y-%m}  "
              f"P/E {frame.loc[last, 'Trailing P/E']:.1f}"
              + (f"  CAPE {frame.loc[last, 'CAPE']:.1f}"
                 if "CAPE" in frame.columns and pd.notna(frame.loc[last, "CAPE"])
                 else ""))
    return frame


def inspect_shiller() -> str:
    """Dump the workbook layout, for when the parser fails."""
    try:
        sheets = _open(download())
    except ShillerError as exc:
        return str(exc)
    lines = [f"Sheets: {list(sheets)}"]
    for name, frame in sheets.items():
        lines.append(f"\n--- {name}  shape={frame.shape} ---")
        for i in range(min(12, len(frame))):
            cells = [str(c)[:16] for c in frame.iloc[i].tolist()[:16]]
            lines.append(f"  row {i:>2}: {cells}")
        scores = {c: round(_fractional_year_score(frame[c]), 2)
                  for c in list(frame.columns)[:16]}
        lines.append(f"  date-likeness by column: {scores}")
    return "\n".join(lines)
