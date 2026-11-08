"""
Forward earnings multiples - State Street SPDR.
==============================================================================
One source. The US (Shiller), Japan (JPX) and market-cap-to-GDP (World Bank)
blocks were removed on 2026-09-12: Shiller's DataHub mirror had stopped in
2023 and none of the three were being used. Their code is gone rather than
disabled, so nothing here half-fetches a series the dashboard no longer shows.

The forward P/E problem, stated plainly
---------------------------------------
A 12-month forward P/E needs analyst consensus earnings, which is the core
product of the vendors this dashboard deliberately avoids. There is exactly
one free published exception: SSGA discloses `Price/Earnings Ratio FY1` for
its own regional ETFs, so the figure here is the forward multiple of a fund's
holdings rather than of the index itself. Close, not identical.

What this source cannot do
--------------------------
* **No history.** SSGA publishes a current characteristics table and nothing
  else. Each refresh appends one row stamped that day, so the series grows
  forward from whenever you started and cannot be backfilled. Read it as a
  snapshot, not a time series, until enough refreshes have accumulated.
* **Harmonic, not arithmetic.** Fund-level multiples are weighted *harmonic*
  averages of holdings. That is the right way to aggregate a P/E and not the
  same statistic as a simple index ratio.
* **Label traps.** `Price/Earnings` is a prefix of `Price/Earnings Ratio FY1`.
  A substring match on the trailing multiple silently returns the forward one,
  which is why SSGA_LABELS below is matched on exact equality.

Sources verified against the live pages; every URL and column name below was
read off the real thing rather than recalled.
"""

from __future__ import annotations

import datetime as dt
import io
import re
import time
from dataclasses import dataclass

import pandas as pd
import requests

TIMEOUT = 60
PAUSE = 0.3
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; macro-dashboard/1.0)"}


class ValuationError(RuntimeError):
    """A valuation source did not return something usable."""


def _get(url: str, what: str, binary: bool = False):
    try:
        response = requests.get(url, headers=HEADERS, timeout=TIMEOUT,
                                allow_redirects=True)
    except requests.RequestException as exc:
        raise ValuationError(f"{what}: could not reach {url}\n  {exc}") from exc
    if response.status_code != 200:
        raise ValuationError(f"{what}: {url} returned HTTP {response.status_code}")
    return response.content if binary else response.text


# --------------------------------------------------------------------------- #
# Forward multiples - State Street SPDR
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Fund:
    ticker: str
    region: str
    slugs: tuple[str, ...]


#: SSGA is mid-rebrand and both slug forms resolve, so both are tried. The
#: fact-sheet URL is keyed on the ticker alone and is the stable fallback.
#:
#: Japan and Malaysia are absent, and now have no substitute anywhere in the
#: dashboard. There is no US-listed SPDR Japan ETF; Japan used to come from
#: JPX, which was removed with the rest of this block on 2026-09-12. There is
#: no SPDR Malaysia ETF at all - the closest, GMF, holds about 2.5% Malaysia,
#: which is a country weight and not a valuation proxy. Neither market carries
#: a valuation figure here; that is a gap, not an oversight.
FUNDS: tuple[Fund, ...] = (
    Fund("SPY", "United States",
         ("spdr-sp-500-etf-trust-spy", "state-street-spdr-sp-500-etf-trust-spy")),
    Fund("SPEU", "Europe",
         ("spdr-portfolio-europe-etf-speu",
          "state-street-spdr-portfolio-europe-etf-speu")),
    Fund("GMF", "Emerging Asia",
         ("spdr-sp-emerging-asia-pacific-etf-gmf",
          "state-street-spdr-sp-emerging-asia-pacific-etf-gmf")),
    Fund("SPEM", "Emerging Markets",
         ("spdr-portfolio-emerging-markets-etf-spem",
          "state-street-spdr-portfolio-emerging-markets-etf-spem")),
)

SSGA_PAGE = "https://www.ssga.com/us/en/intermediary/etfs/{slug}"
SSGA_FACTSHEET = ("https://www.ssga.com/library-content/products/factsheets/"
                  "etfs/us/factsheet-us-en-{ticker}.pdf")

#: Label -> metric, spelled exactly as SSGA spells it. Exact equality only:
#: "Price/Earnings" is a prefix of "Price/Earnings Ratio FY1", so a substring
#: match on the trailing multiple silently returns the forward one.
SSGA_LABELS = {
    "Price/Earnings Ratio FY1": "forward P/E",
    "Price/Earnings": "trailing P/E",
    "Price/Book Ratio": "P/B",
    "Average Price/Book": "P/B",          # the EMEA sheets spell it this way
    "Price/Cash Flow": "P/CF",
    "Index Dividend Yield": "dividend yield",
    "Est. 3-5 Year EPS Growth": "est. EPS growth",
}

_NUMBER_RE = re.compile(r"-?\d[\d,]*\.?\d*")


def _as_number(text: str) -> float | None:
    match = _NUMBER_RE.search(str(text).replace(",", ""))
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _from_tables(html: str) -> dict[str, float]:
    """
    Label/value pairs out of the product page's characteristic tables.

    The page renders two tables with overlapping labels - a Fund one and an
    Index one - so values are merged with the Index table winning where both
    publish the same metric. The index is the thing being valued; the fund is
    the index plus a fee and a tracking difference.
    """
    try:
        tables = pd.read_html(io.StringIO(html))
    except Exception as exc:      # noqa: BLE001 - lxml raises several types
        raise ValuationError(f"no HTML tables could be parsed ({exc})") from exc

    fund_side: dict[str, float] = {}
    index_side: dict[str, float] = {}
    for table in tables:
        if table.shape[1] < 2:
            continue
        labels = table.iloc[:, 0].astype(str).str.strip()
        values = table.iloc[:, 1]
        found = {}
        for label, value in zip(labels, values):
            metric = SSGA_LABELS.get(label)
            number = _as_number(value)
            if metric and number is not None:
                found[metric] = number
        if not found:
            continue
        # Only the index table carries these two.
        if "P/CF" in found or "trailing P/E" in found:
            index_side.update(found)
        else:
            fund_side.update(found)

    merged = {**fund_side, **index_side}
    if not merged:
        raise ValuationError(
            "tables parsed but none carried a recognised characteristic label")
    return merged


def _from_factsheet(ticker: str) -> dict[str, float]:
    """The quarterly fact sheet PDF, used when the live page yields nothing."""
    try:
        import pdfplumber
    except ModuleNotFoundError as exc:
        raise ValuationError(
            "the product page gave nothing and pdfplumber is not installed, so "
            "the fact-sheet fallback cannot be read. `pip install pdfplumber`"
        ) from exc

    content = _get(SSGA_FACTSHEET.format(ticker=ticker.lower()),
                   f"SSGA fact sheet {ticker}", binary=True)
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        text = "\n".join((page.extract_text() or "") for page in pdf.pages[:3])

    found: dict[str, float] = {}
    for line in text.splitlines():
        line = line.strip()
        for label in sorted(SSGA_LABELS, key=len, reverse=True):
            if line.startswith(label):
                number = _as_number(line[len(label):])
                if number is not None:
                    found.setdefault(SSGA_LABELS[label], number)
                break
    if not found:
        raise ValuationError(
            f"fact sheet for {ticker} parsed to no recognised labels")
    return found


def fetch_fund(fund: Fund) -> tuple[dict[str, float], str]:
    """Today's characteristics for one fund. Live page first, PDF second."""
    problems = []
    for slug in fund.slugs:
        try:
            return _from_tables(_get(SSGA_PAGE.format(slug=slug),
                                     f"SSGA {fund.ticker}")), "page"
        except ValuationError as exc:
            problems.append(f"page/{slug}: {exc}")
    try:
        return _from_factsheet(fund.ticker), "factsheet"
    except ValuationError as exc:
        problems.append(f"factsheet: {exc}")
    raise ValuationError(f"{fund.ticker}: nothing readable.\n  "
                         + "\n  ".join(problems))


def fetch_spdr(verbose: bool = True) -> pd.DataFrame:
    """
    One dated row of forward and trailing multiples per region.

    A single row, stamped today. The archive turns successive runs into a
    series; nothing here can reconstruct the past, because SSGA does not
    publish it.
    """
    today = pd.Timestamp(dt.date.today())
    row, problems = {}, {}
    for fund in FUNDS:
        try:
            found, source = fetch_fund(fund)
        except ValuationError as exc:
            problems[fund.ticker] = str(exc)
            if verbose:
                print(f"  [FAIL] {fund.region:<20} {str(exc).splitlines()[0]}")
            continue
        for metric, value in found.items():
            row[f"{fund.region} {metric}"] = value
        if verbose:
            forward = found.get("forward P/E")
            print(f"  [ok]   {fund.region:<20} via {source}, "
                  f"{len(found)} metrics"
                  + (f", forward P/E {forward:.2f}x" if forward else ""))
        time.sleep(PAUSE)

    if not row:
        raise ValuationError(
            "No SPDR fund returned characteristics. First error:\n  "
            + next(iter(problems.values()), "unknown"))

    frame = pd.DataFrame([row], index=pd.DatetimeIndex([today], name="Date"))
    frame.attrs["problems"] = problems
    return frame


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #

def build_valuation(verbose: bool = True) -> pd.DataFrame:
    """
    The forward-multiple snapshot, in the wide shape the cache expects.

    This block used to carry four sources and tolerate one failing. It now has
    one, so a failure is fatal rather than partial - there is nothing left to
    fall back to, and a block that returned an empty frame would look like a
    source with no data rather than a source that did not answer.
    """
    frame = fetch_spdr(verbose)
    frame = frame.sort_index()
    frame.index.name = "Date"
    frame.attrs["problems"] = dict(frame.attrs.get("problems", {}))
    return frame


def describe() -> pd.DataFrame:
    """`python refresh.py --valuation-check` - what the source actually served."""
    rows = []
    checks = (("SPDR forward multiples", lambda: fetch_spdr(verbose=False)),)

    for label, call in checks:
        try:
            frame = call()
        except Exception as exc:      # noqa: BLE001
            rows.append({"Source": label, "Status": "FAIL", "Rows": 0,
                         "Columns": 0, "From": "", "To": "",
                         "Detail": str(exc).replace("\n", " ")[:170]})
            continue
        live = frame.dropna(how="all")
        rows.append({
            "Source": label, "Status": "ok", "Rows": len(frame),
            "Columns": frame.shape[1],
            "From": f"{live.index.min():%Y-%m-%d}" if len(live) else "",
            "To": f"{live.index.max():%Y-%m-%d}" if len(live) else "",
            "Detail": ", ".join(map(str, frame.columns[:6]))[:170],
        })
    return pd.DataFrame(rows)
