"""
Malaysian data: OpenDOSM and Bank Negara.
=========================================
Two free APIs, neither needing a key.

**OpenDOSM** - the Department of Statistics' open API, serving the datasets
behind open.dosm.gov.my.

    https://api.data.gov.my/opendosm?id=<dataset>

**BNM Open API** - Bank Negara's rates and statistics. Needs no key either,
but it does need an Accept header naming the API version; without it the
server answers 406.

    https://api.bnm.gov.my/public/<endpoint>

--------------------------------------------------------------------------- #
Why every spec here is tolerant about column names
--------------------------------------------------------------------------- #

The dataset ids are documented and stable. The *column* names inside each
response are not documented anywhere I could read, so each series says which
columns it would accept rather than naming one. `--my-check` prints the columns
that actually came back, which turns a wrong guess into a one-line fix instead
of a silent empty column.

The same rule as everywhere else applies: where a filter leaves more than one
series standing, this raises rather than picking one.
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field

import pandas as pd
import requests

DOSM_BASE = "https://api.data.gov.my/opendosm"
DATA_GOV_BASE = "https://api.data.gov.my/data-catalogue"
BNM_BASE = "https://api.bnm.gov.my/public"

#: BNM answers 406 Not Acceptable without this. It is the whole "authentication"
#: story for their API - no key, just a version in the Accept header.
BNM_HEADERS = {"Accept": "application/vnd.BNM.API.v1+json"}

TIMEOUT = 40
MAX_RETRIES = 3


class MalaysiaError(RuntimeError):
    """Raised when a Malaysian source refuses a request or cannot be parsed."""


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

def _get(url: str, params: dict | None = None,
         headers: dict | None = None) -> object:
    last = None
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(url, params=params or {},
                                    headers=headers or {}, timeout=TIMEOUT)
            if response.status_code == 406:
                raise MalaysiaError(
                    f"{url} returned 406 — the Accept header is wrong or "
                    "missing. BNM requires "
                    "'application/vnd.BNM.API.v1+json'.")
            response.raise_for_status()
            return response.json()
        except MalaysiaError:
            raise
        except (requests.RequestException, ValueError) as exc:
            last = str(exc)
            time.sleep(1.2 * (attempt + 1))
    raise MalaysiaError(f"Gave up on {url} after {MAX_RETRIES} attempts — {last}")


def _rows(payload: object) -> list[dict]:
    """
    Pull the row list out of whatever shape the response arrived in.

    data.gov.my returns a bare array; BNM wraps its rows in {"data": ...} and
    sometimes returns a single object rather than a list. Handling all three
    here keeps every caller from having to care.
    """
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in ("data", "result", "results", "records"):
            inner = payload.get(key)
            if isinstance(inner, list):
                return [r for r in inner if isinstance(r, dict)]
            if isinstance(inner, dict):
                return [inner]
        # A flat object with no envelope is itself one row.
        if payload and not any(isinstance(v, (list, dict)) for v in payload.values()):
            return [payload]
    return []


# --------------------------------------------------------------------------- #
# Fetching
# --------------------------------------------------------------------------- #

def dosm_table(dataset: str, limit: int | None = None,
               catalogue: bool = False, **filters) -> pd.DataFrame:
    """One OpenDOSM dataset as a DataFrame."""
    params = {"id": dataset, **{k: v for k, v in filters.items() if v is not None}}
    if limit:
        params["limit"] = limit
    base = DATA_GOV_BASE if catalogue else DOSM_BASE
    rows = _rows(_get(base, params))
    if not rows:
        raise MalaysiaError(
            f"OpenDOSM dataset '{dataset}' returned no rows. Check the id at "
            "https://open.dosm.gov.my/data-catalogue")
    return pd.DataFrame(rows)


def bnm_table(endpoint: str) -> pd.DataFrame:
    """One BNM endpoint as a DataFrame."""
    rows = _rows(_get(f"{BNM_BASE}/{endpoint}", headers=BNM_HEADERS))
    if not rows:
        raise MalaysiaError(f"BNM endpoint '{endpoint}' returned no rows.")
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- #
# Column matching
# --------------------------------------------------------------------------- #

DATE_PATTERNS = (r"^date$", r"^month$", r"^period$", r"^time$", r"date")


def pick_column(frame: pd.DataFrame, patterns: tuple[str, ...],
                what: str, series_name: str) -> str:
    """
    The first column matching any pattern, in order.

    Order is the whole mechanism: patterns are listed most-specific first, so
    an exact name wins over a loose one. A miss lists every column available,
    because the fix is always "use this other name" and there is no reason to
    make that a second round trip.
    """
    lowered = {str(c).strip().lower(): c for c in frame.columns}
    for pattern in patterns:
        for low, original in lowered.items():
            if re.search(pattern, low):
                return original
    raise MalaysiaError(
        f"{series_name}: no {what} column matching {patterns}. "
        f"Columns present: {', '.join(map(str, frame.columns))}")


@dataclass(frozen=True)
class Spec:
    """A Malaysian series: where it lives, and how to reduce it to one column."""
    name: str
    source: str                      # dosm | bnm
    dataset: str
    value_patterns: tuple[str, ...]
    filters: dict[str, str] = field(default_factory=dict)
    transform: str = "level"         # level | yoy | mom | diff
    unit: str = "%"
    catalogue: bool = False
    note: str = ""


#: Dataset ids are from OpenDOSM's published catalogue. Column names are
#: guesses ordered most-likely-first; `--my-check` prints what actually came
#: back so a wrong one is a one-line fix.
MALAYSIA_SPECS: tuple[Spec, ...] = (
    # Neither cpi_headline nor ipi carries a year-on-year column - both return
    # the INDEX. Taking it and reading it as a percentage printed Malaysian
    # inflation as "137.1%". The index is now taken deliberately and the
    # year-on-year change computed from it.
    Spec("CPI (YoY)", "dosm", "cpi_headline",
         value_patterns=(r"^index$", r"^value$"),
         filters={"division": r"^overall$"},
         transform="yoy", unit="%",
         note="Headline CPI, all divisions, year-on-year from the index."),

    Spec("Industrial Production Index", "dosm", "ipi",
         value_patterns=(r"^index$", r"^value$"),
         filters={"series": r"^abs$"},
         transform="yoy", unit="%",
         note="IPI year-on-year, computed from the level."),

    Spec("Labour force / unemployment", "dosm", "lfs_month",
         value_patterns=(r"^u_rate$", r"unemploy.*rate", r"^rate$"),
         transform="level", unit="%",
         note="Monthly principal labour force statistics. Already a rate."),

    # trade_headline stacks several SERIES TYPES on the same dates - the first
    # row came back as series='growth_mom'. Pinning series=abs is what makes
    # 'balance' the actual trade balance rather than a percentage change.
    Spec("External trade", "dosm", "trade_headline",
         value_patterns=(r"^balance$",),
         filters={"series": r"^abs$"},
         transform="level", unit="rm",
         note="Headline monthly trade balance in ringgit."),

    # gdp_qtr_real has only date/value/series, and value is the level in RM
    # million. Malaysia quotes real GDP as a year-on-year rate, so it is
    # computed from the quarterly level.
    Spec("GDP and balance of payments", "dosm", "gdp_qtr_real",
         value_patterns=(r"^value$",),
         filters={"series": r"^abs$"},
         transform="yoy", unit="%",
         note="Quarterly real GDP, year-on-year from the level."),

    # International reserves removed: BNM has no /public/reserves endpoint -
    # it answers 404 - and their published endpoint list does not include it.
    # The reserves release still has no free API I can reach, so those rows
    # are gone rather than permanently blank.
)

#: The rate a BNM MPC decision sets, shown as that meeting's outcome.
BNM_OPR_ENDPOINT = "opr"
OPR_PATTERNS = (r"^new_opr_level$", r"^opr", r"rate", r"^value$")
OPR_DATE_PATTERNS = (r"^effective_date$", r"^date$", r"date")


# --------------------------------------------------------------------------- #
# Reduction
# --------------------------------------------------------------------------- #

def to_series(frame: pd.DataFrame, spec: Spec) -> pd.Series:
    """Reduce one dataset to a single dated series."""
    working = frame.copy()

    for column, pattern in spec.filters.items():
        match = next((c for c in working.columns
                      if str(c).strip().lower() == column.lower()), None)
        if match is None:
            continue                       # dataset does not carry this split
        filtered = working[working[match].astype(str).str.lower()
                           .str.contains(pattern, regex=True, na=False)]
        if filtered.empty:
            options = sorted(working[match].astype(str).unique())[:8]
            raise MalaysiaError(
                f"{spec.name}: nothing in '{match}' matches /{pattern}/. "
                f"Values present: {', '.join(options)}")
        working = filtered

    date_col = pick_column(working, DATE_PATTERNS, "date", spec.name)
    value_col = pick_column(working, spec.value_patterns, "value", spec.name)

    # Any other column still carrying several values means the filters did not
    # reduce this to one series - the same refusal to guess as everywhere else.
    leftovers = [
        c for c in working.columns
        if c not in (date_col, value_col)
        and working[c].nunique(dropna=True) > 1
        and working[c].dtype == object
    ]
    if leftovers:
        detail = "; ".join(
            f"{c} = {', '.join(map(str, sorted(working[c].dropna().unique())[:5]))}"
            for c in leftovers[:3])
        raise MalaysiaError(
            f"{spec.name}: more than one series remains after filtering — "
            f"{detail}. Needs another filter.")

    dates = pd.to_datetime(working[date_col], errors="coerce")
    values = pd.to_numeric(working[value_col], errors="coerce")
    series = (pd.Series(values.to_numpy(), index=pd.DatetimeIndex(dates))
                .dropna().sort_index())

    # Repeated dates mean this is still several series stacked on top of each
    # other. The object-column check above misses that whenever the column
    # that distinguishes them is absent or numeric - and deduplicating anyway
    # would silently keep whichever row happened to sort last. On a CPI
    # dataset that is the difference between headline inflation and the price
    # of food.
    duplicates = int(series.index.duplicated().sum())
    if duplicates:
        raise MalaysiaError(
            f"{spec.name}: {duplicates} repeated dates after filtering, so "
            f"'{value_col}' still holds more than one series. Columns "
            f"available to filter on: "
            + ", ".join(str(c) for c in working.columns
                        if c not in (date_col, value_col)))
    if series.empty:
        raise MalaysiaError(f"{spec.name}: no usable observations after parsing.")
    series.name = spec.name
    return series


def fetch_opr_history(years: int = 3, verbose: bool = True) -> pd.Series:
    """
    OPR decisions over several years.

    The bare /public/opr endpoint returns only the latest decision - one row -
    which is enough to label today but not enough to put an outcome against a
    meeting held six months ago. BNM exposes history a year at a time.
    """
    frames = []
    this_year = pd.Timestamp.today().year
    for year in range(this_year - years + 1, this_year + 1):
        try:
            frames.append(bnm_table(f"{BNM_OPR_ENDPOINT}/year/{year}"))
        except MalaysiaError:
            continue                      # that year simply may not be served
    if not frames:
        frames = [bnm_table(BNM_OPR_ENDPOINT)]

    frame = pd.concat(frames, ignore_index=True)
    date_col = pick_column(frame, OPR_DATE_PATTERNS, "date", "OPR")
    value_col = pick_column(frame, OPR_PATTERNS, "rate", "OPR")
    series = (pd.Series(pd.to_numeric(frame[value_col], errors="coerce").to_numpy(),
                        index=pd.DatetimeIndex(
                            pd.to_datetime(frame[date_col], errors="coerce")))
              .dropna().sort_index())
    series = series[~series.index.duplicated(keep="last")]
    if series.empty:
        raise MalaysiaError("OPR history parsed to nothing.")
    if verbose:
        print(f"  [ok]   bnm   OPR history{'':<20} {len(series):>5} obs  "
              f"through {series.index[-1]:%Y-%m-%d}  latest {series.iloc[-1]:.2f}%")
    return series


def fetch_spec(spec: Spec, verbose: bool = True) -> pd.Series:
    frame = (bnm_table(spec.dataset) if spec.source == "bnm"
             else dosm_table(spec.dataset, catalogue=spec.catalogue))
    series = to_series(frame, spec)
    if verbose:
        print(f"  [ok]   {spec.source:<5} {spec.name:<30} {len(series):>5} obs  "
              f"through {series.index[-1]:%Y-%m}  latest {series.iloc[-1]:,.2f}")
    time.sleep(0.15)
    return series


def fetch_opr(verbose: bool = True) -> pd.Series:
    """The Overnight Policy Rate, for the BNM decision rows."""
    frame = bnm_table(BNM_OPR_ENDPOINT)
    date_col = pick_column(frame, OPR_DATE_PATTERNS, "date", "OPR")
    value_col = pick_column(frame, OPR_PATTERNS, "rate", "OPR")
    series = (pd.Series(pd.to_numeric(frame[value_col], errors="coerce").to_numpy(),
                        index=pd.DatetimeIndex(
                            pd.to_datetime(frame[date_col], errors="coerce")))
              .dropna().sort_index())
    if series.empty:
        raise MalaysiaError("OPR endpoint parsed to nothing.")
    if verbose:
        print(f"  [ok]   bnm   OPR{'':<28} {len(series):>5} obs  "
              f"through {series.index[-1]:%Y-%m-%d}  latest {series.iloc[-1]:.2f}%")
    return series


# --------------------------------------------------------------------------- #
# Diagnostics
# --------------------------------------------------------------------------- #

def describe(verbose: bool = True) -> pd.DataFrame:
    """
    Try every Malaysian series and report what happened.

    On failure it prints the columns the dataset actually returned, which is
    the one piece of information needed to correct a spec.
    """
    rows = []
    for spec in MALAYSIA_SPECS:
        try:
            series = fetch_spec(spec, verbose=verbose)
            rows.append({"Series": spec.name, "Source": spec.source,
                         "Status": "ok", "Observations": len(series),
                         "To": f"{series.index[-1]:%Y-%m}",
                         "Latest": round(float(series.iloc[-1]), 2)})
        except MalaysiaError as exc:
            rows.append({"Series": spec.name, "Source": spec.source,
                         "Status": "FAILED", "Observations": 0,
                         "To": "", "Latest": None})
            if verbose:
                print(f"\n  FAILED  {spec.name}  ({spec.source}:{spec.dataset})")
                print(f"    {exc}")
                try:
                    raw = (bnm_table(spec.dataset) if spec.source == "bnm"
                           else dosm_table(spec.dataset, limit=3,
                                           catalogue=spec.catalogue))
                    print(f"    columns: {', '.join(map(str, raw.columns))}")
                    print(f"    first row: {raw.head(1).to_dict('records')}")
                except MalaysiaError as inner:
                    print(f"    (could not sample the dataset: {inner})")
                print()

    try:
        opr = fetch_opr_history(verbose=verbose)
        rows.append({"Series": "OPR (policy rate)", "Source": "bnm",
                     "Status": "ok", "Observations": len(opr),
                     "To": f"{opr.index[-1]:%Y-%m}",
                     "Latest": round(float(opr.iloc[-1]), 2)})
    except MalaysiaError as exc:
        rows.append({"Series": "OPR (policy rate)", "Source": "bnm",
                     "Status": "FAILED", "Observations": 0, "To": "",
                     "Latest": None})
        if verbose:
            print(f"\n  FAILED  OPR\n    {exc}\n")

    return pd.DataFrame(rows)
