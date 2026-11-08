"""
Government bond yield curves.
=============================
Three sources, all free, all official, all keyless:

    Japan      Ministry of Finance, JGB par yields, 15 tenors 1Y-40Y, daily,
               back to 1974-09-24.
    US         Treasury's own daily yield curve, nominal (1M-30Y) and TIPS real
               (5Y-30Y), one CSV per calendar year.
    Euro area  ECB Data Portal, AAA-rated central government curve, 3M-30Y,
               daily from 2004-09-06, SDMX over HTTP.

    Malaysia   Bank Negara's Open API, /public/gov-sec-yield. MGS and GII, one
               day per request, so history is walked backwards and the archive
               keeps it.

A correction worth recording: this module used to say Malaysia was impossible.
Bank Negara's published endpoint list does not mention gov-sec-yield and the
yield curve appears on the FMIP portal only as a rendered page, so the
conclusion was that no machine-readable MGS source existed. It does. The
endpoint was simply undocumented in the places that were checked.

Why Treasury rather than FRED's DGS series
------------------------------------------
FRED's `DGS*` are the same underlying H.15 numbers, but FRED has shown twice in
two years that it will silently shorten or withdraw a series (Wilshire deleted
outright in 2024, the whole ICE BofA family put on a rolling three-year window
in 2026). Treasury publishes the curve itself, in full, and has no reason to
stop. Going to the primary source removes a dependency rather than adding one.

Parsing, defensively
--------------------
Neither file is a clean CSV and neither is under our control, so nothing here
relies on column position:

* MOF prefixes the file with a title row ("Interest Rate (September 2026),,,,")
  before the real header, so the header is *found* by looking for the line that
  starts with "Date", not assumed to be line 2. Missing tenors are "-", not
  blank. Dates are YYYY/M/D, zero-padding not guaranteed.
* Treasury's headers differ between the nominal file ("1 Mo", "2 Yr") and the
  real file ("5 YR"), and a "1.5 Month" column appeared partway through the
  history. Every non-date header is therefore matched by pattern and converted
  to a tenor in months; anything unrecognised is reported rather than dropped
  silently.

Both fetchers raise `CurveError` with the URL and what came back. A yield curve
that quietly loses its long end is worse than one that fails.
"""

from __future__ import annotations

import datetime as dt
import io
import re
import time
from dataclasses import dataclass

import pandas as pd
import requests

MOF_LATEST = ("https://www.mof.go.jp/english/policy/jgbs/reference/"
              "interest_rate/jgbcme.csv")
MOF_HISTORY = ("https://www.mof.go.jp/english/policy/jgbs/reference/"
               "interest_rate/historical/jgbcme_all.csv")

TREASURY_BASE = ("https://home.treasury.gov/resource-center/data-chart-center/"
                 "interest-rates/daily-treasury-rates.csv/{year}/all")
TREASURY_NOMINAL = "daily_treasury_yield_curve"
TREASURY_REAL = "daily_treasury_real_yield_curve"

#: Treasury refuses the default python-requests agent often enough to be worth
#: setting. This is not a disguise - it is a working browser string, which is
#: what the endpoint expects from a CSV download link.
HEADERS = {"User-Agent": "Mozilla/5.0 (compatible; macro-dashboard/1.0)"}

TIMEOUT = 60
PAUSE = 0.2

#: Treasury started publishing the TIPS real curve in 2003.
REAL_CURVE_FIRST_YEAR = 2003
#: Its nominal curve file exists from 1990.
NOMINAL_FIRST_YEAR = 1990

#: The ECB's euro area yield curve. Keyless, daily from 2004-09-06.
#: Key shape (quoted from the ECB's own documentation):
#:     YC . B . U2 . EUR . 4F . G_N_A . SV_C_YM . SR_10Y
#: where G_N_A is the AAA-rated central government curve and G_N_C is the
#: all-issuer one. AAA is the right default: it is the euro area's risk-free
#: curve, whereas the all-issuer version blends in Italian and Greek credit
#: risk and so is not comparable with the US and Japanese curves here.
ECB_BASE = "https://data-api.ecb.europa.eu/service/data/YC"
ECB_KEY_PREFIX = "B.U2.EUR.4F.G_N_A.SV_C_YM"
ECB_TENOR_CODES = ("SR_3M", "SR_6M", "SR_1Y", "SR_2Y", "SR_3Y", "SR_5Y",
                   "SR_7Y", "SR_10Y", "SR_15Y", "SR_20Y", "SR_30Y")
ECB_FIRST_DAY = "2004-09-06"

MARKET_US = "US"
MARKET_US_REAL = "US real"
MARKET_JP = "JP"
MARKET_EA = "EA"
MARKET_MY = "MY"


class CurveError(RuntimeError):
    """A curve source did not return something we can parse."""


# --------------------------------------------------------------------------- #
# Tenors
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Tenor:
    label: str      # "3M", "1.5M", "10Y"
    months: float

    def __str__(self) -> str:  # pragma: no cover - display only
        return self.label


_TENOR_RE = re.compile(
    r"^\s*(\d+(?:\.\d+)?)\s*(mo|mos|month|months|yr|yrs|year|years|m|y)\s*$",
    re.IGNORECASE)


def parse_tenor(header: str) -> Tenor | None:
    """
    '1 Mo' -> 1 month, '1.5 Month' -> 1.5, '10 Yr' -> 120, '40Y' -> 480.

    Returns None for anything that is not a tenor, so the caller can tell a
    date column apart from a maturity without hard-coding either.
    """
    match = _TENOR_RE.match(str(header))
    if not match:
        return None
    size = float(match.group(1))
    unit = match.group(2).lower()
    months = size if unit.startswith("m") else size * 12.0
    if months <= 0 or months > 600:
        return None
    if months < 12:
        label = f"{size:g}M"
    else:
        label = f"{size:g}Y" if not unit.startswith("m") else f"{size / 12:g}Y"
    return Tenor(label, months)


def tenor_of(column: str) -> Tenor | None:
    """The tenor inside a built column name like 'US 10Y' or 'US real 5Y'."""
    return parse_tenor(str(column).rsplit(" ", 1)[-1])


def market_of(column: str) -> str:
    return str(column).rsplit(" ", 1)[0]


def curve_columns(frame: pd.DataFrame, market: str) -> list[str]:
    """This market's columns, ordered short to long."""
    picked = [(tenor_of(c).months, c) for c in frame.columns
              if market_of(c) == market and tenor_of(c) is not None]
    return [c for _, c in sorted(picked)]


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

def _get(url: str, what: str) -> str:
    try:
        response = requests.get(url, headers=HEADERS, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise CurveError(f"{what}: could not reach {url}\n  {exc}") from exc

    if response.status_code != 200:
        raise CurveError(f"{what}: {url} returned HTTP {response.status_code}")

    return response.text


def _get_json(url: str, what: str) -> object:
    """A JSON endpoint. Bank Negara needs its own Accept header or every path 404s."""
    try:
        response = requests.get(url, headers=BNM_ACCEPT, timeout=TIMEOUT)
    except requests.RequestException as exc:
        raise CurveError(f"{what}: could not reach {url}\n  {exc}") from exc
    if response.status_code == 406:
        raise CurveError(
            f"{what}: {url} returned 406 - the Accept header was rejected. "
            f"BNM requires 'application/vnd.BNM.API.v1+json'.")
    if response.status_code != 200:
        raise CurveError(f"{what}: {url} returned HTTP {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise CurveError(
            f"{what}: {url} did not return JSON ({exc}). "
            f"First 200 characters: {response.text.strip()[:200]}") from exc


def _require_csv(text: str, url: str) -> str:
    """
    Reject a web page politely served in place of a data file.

    This lives with the parsers rather than with the HTTP call on purpose. Both
    endpoints answer a wrong or retired query parameter with HTTP 200 and an
    HTML error page, and `pd.read_csv` will happily turn that into a one-column
    frame of markup. Checking here means the guard holds however the text
    arrived - including from a stub in the tests.
    """
    if text.lstrip().startswith("<"):
        raise CurveError(
            f"{url} returned HTML, not CSV. The endpoint or its query "
            f"parameters have changed. First 200 characters:\n"
            f"  {text.strip()[:200]}")
    return text


# --------------------------------------------------------------------------- #
# Japan - Ministry of Finance
# --------------------------------------------------------------------------- #

def _mof_frame(text: str, url: str) -> pd.DataFrame:
    """Parse one MOF file. The header is found, never assumed."""
    lines = _require_csv(text, url).splitlines()
    header_at = next((i for i, line in enumerate(lines)
                      if line.strip().lower().startswith("date,")), None)
    if header_at is None:
        raise CurveError(
            f"MOF: no header row starting with 'Date,' in {url}. "
            f"The file layout has changed. First three lines:\n  "
            + "\n  ".join(lines[:3]))

    frame = pd.read_csv(io.StringIO("\n".join(lines[header_at:])))
    date_column = frame.columns[0]

    tenors = {c: parse_tenor(c) for c in frame.columns[1:]}
    unknown = [c for c, t in tenors.items() if t is None]
    if unknown:
        raise CurveError(
            f"MOF: unrecognised column(s) {unknown} in {url}. Expected only "
            f"maturities after the date column.")

    index = pd.to_datetime(frame[date_column], format="%Y/%m/%d", errors="coerce")
    if index.isna().all():
        index = pd.to_datetime(frame[date_column], errors="coerce")

    out = pd.DataFrame(index=pd.DatetimeIndex(index, name="Date"))
    for column, tenor in tenors.items():
        # "-" marks a tenor that did not exist yet. Coercion turns it into NaN,
        # which is what it means: no 40-year JGB in 1974.
        out[f"{MARKET_JP} {tenor.label}"] = pd.to_numeric(
            frame[column].astype(str).str.strip(), errors="coerce").to_numpy()

    out = out[out.index.notna()]
    return out[~out.index.duplicated(keep="last")].sort_index()


def fetch_jgb(history: bool = True, verbose: bool = True) -> pd.DataFrame:
    """
    The JGB par curve from the Ministry of Finance.

    `history=True` pulls the whole file back to 1974. The current-month file is
    fetched too and merged on top, because the history file is rebuilt on a
    slower cadence than the daily one.
    """
    frames = []
    if history:
        frames.append(_mof_frame(_get(MOF_HISTORY, "MOF history"), MOF_HISTORY))
    frames.append(_mof_frame(_get(MOF_LATEST, "MOF current month"), MOF_LATEST))

    # Later frames win: the current-month file is the fresher of the two.
    merged = frames[-1]
    for earlier in reversed(frames[:-1]):
        merged = merged.combine_first(earlier)
    merged = merged.sort_index()

    if verbose:
        last = merged.dropna(how="all")
        print(f"  [ok]   Japan (MOF)          {len(merged):>6,} days, "
              f"{merged.shape[1]} tenors, through "
              f"{last.index.max():%Y-%m-%d}")
    return merged


# --------------------------------------------------------------------------- #
# United States - Treasury
# --------------------------------------------------------------------------- #

def _treasury_url(year: int, kind: str) -> str:
    return (f"{TREASURY_BASE.format(year=year)}"
            f"?type={kind}&field_tdr_date_value={year}&page&_format=csv")


def _treasury_frame(text: str, prefix: str, url: str) -> pd.DataFrame:
    frame = pd.read_csv(io.StringIO(_require_csv(text, url)))
    date_column = next((c for c in frame.columns if "date" in str(c).lower()), None)
    if date_column is None:
        raise CurveError(f"Treasury: no date column in {url}. "
                         f"Columns were: {list(frame.columns)}")

    tenors = {c: parse_tenor(c) for c in frame.columns if c != date_column}
    known = {c: t for c, t in tenors.items() if t is not None}
    if not known:
        raise CurveError(f"Treasury: no maturity columns recognised in {url}. "
                         f"Columns were: {list(frame.columns)}")

    index = pd.to_datetime(frame[date_column], format="%m/%d/%Y", errors="coerce")
    if index.isna().all():
        index = pd.to_datetime(frame[date_column], errors="coerce")

    out = pd.DataFrame(index=pd.DatetimeIndex(index, name="Date"))
    for column, tenor in known.items():
        out[f"{prefix} {tenor.label}"] = pd.to_numeric(
            frame[column], errors="coerce").to_numpy()

    out = out[out.index.notna()]
    out = out[~out.index.duplicated(keep="last")].sort_index()
    out.attrs["skipped"] = [c for c, t in tenors.items() if t is None]
    return out


def fetch_treasury(first_year: int, kind: str = TREASURY_NOMINAL,
                   prefix: str = MARKET_US, verbose: bool = True) -> pd.DataFrame:
    """
    Treasury's daily curve, one calendar-year file at a time.

    A single year failing is reported and skipped - one bad year should not
    cost the other thirty. Everything failing raises.
    """
    this_year = dt.date.today().year
    floor = REAL_CURVE_FIRST_YEAR if kind == TREASURY_REAL else NOMINAL_FIRST_YEAR
    years = range(max(first_year, floor), this_year + 1)

    collected, failures, skipped = [], {}, set()
    for year in years:
        url = _treasury_url(year, kind)
        try:
            frame = _treasury_frame(_get(url, f"Treasury {year}"), prefix, url)
        except CurveError as exc:
            failures[year] = str(exc)
            continue
        if not frame.empty:
            collected.append(frame)
            skipped.update(frame.attrs.get("skipped", []))
        time.sleep(PAUSE)

    if not collected:
        first = next(iter(failures.values()), "no years requested")
        raise CurveError(f"Treasury {kind}: nothing retrieved. First error:\n  {first}")

    out = pd.concat(collected).sort_index()
    out = out[~out.index.duplicated(keep="last")]

    if verbose:
        label = "US nominal" if kind == TREASURY_NOMINAL else "US real"
        print(f"  [ok]   {label:<20} {len(out):>6,} days, {out.shape[1]} tenors, "
              f"through {out.dropna(how='all').index.max():%Y-%m-%d}")
        if failures:
            print(f"         {len(failures)} year(s) unavailable: "
                  f"{', '.join(str(y) for y in failures)}")
        if skipped:
            print(f"         columns not recognised as maturities and dropped: "
                  f"{sorted(skipped)}")
    return out


# --------------------------------------------------------------------------- #
# Euro area - European Central Bank
# --------------------------------------------------------------------------- #

_ECB_TENOR_RE = re.compile(r"SR_(\d+(?:\.\d+)?)(M|Y)\s*$", re.IGNORECASE)


def _ecb_url(codes: tuple[str, ...], start: str) -> str:
    return (f"{ECB_BASE}/{ECB_KEY_PREFIX}.{'+'.join(codes)}"
            f"?format=csvdata&startPeriod={start}")


def _ecb_frame(text: str, url: str) -> pd.DataFrame:
    """
    Parse the ECB's SDMX csvdata response.

    The response is long, not wide: one row per series per day, with the series
    identified by a KEY column whose last segment carries the maturity. Column
    names are matched case-insensitively rather than by position, because SDMX
    responses carry a variable number of attribute columns.
    """
    frame = pd.read_csv(io.StringIO(_require_csv(text, url)))
    lookup = {str(c).strip().upper(): c for c in frame.columns}

    missing = [name for name in ("KEY", "TIME_PERIOD", "OBS_VALUE")
               if name not in lookup]
    if missing:
        raise CurveError(
            f"ECB: {url} is missing column(s) {missing}. Columns present: "
            f"{list(frame.columns)}")

    key, period, value = (lookup["KEY"], lookup["TIME_PERIOD"], lookup["OBS_VALUE"])

    tenors = {}
    for raw in frame[key].astype(str).unique():
        match = _ECB_TENOR_RE.search(raw)
        if match:
            size, unit = float(match.group(1)), match.group(2).upper()
            tenors[raw] = Tenor(f"{size:g}{unit}", size if unit == "M" else size * 12)
    if not tenors:
        raise CurveError(
            f"ECB: no maturity could be read from any KEY in {url}. "
            f"First key was: {frame[key].iloc[0] if len(frame) else '(no rows)'}")

    long = pd.DataFrame({
        "date": pd.to_datetime(frame[period], errors="coerce"),
        "tenor": frame[key].astype(str).map(lambda k: tenors[k].label
                                            if k in tenors else None),
        "value": pd.to_numeric(frame[value], errors="coerce"),
    }).dropna(subset=["date", "tenor"])

    wide = long.pivot_table(index="date", columns="tenor", values="value",
                            aggfunc="last")
    wide.columns = [f"{MARKET_EA} {c}" for c in wide.columns]
    wide.index.name = "Date"
    # pivot_table sorts columns as strings, which puts "10Y" before "3M".
    # Re-order by actual maturity so the frame reads as a curve.
    return wide.sort_index()[curve_columns(wide, MARKET_EA)]


def fetch_ecb(start: str = ECB_FIRST_DAY, verbose: bool = True) -> pd.DataFrame:
    """
    The euro area AAA government curve.

    Every tenor is requested in one call. If that fails - one bad code in an
    SDMX key list rejects the whole request - each tenor is retried on its own,
    so a single retired maturity costs that maturity and nothing else.
    """
    start = max(pd.Timestamp(start), pd.Timestamp(ECB_FIRST_DAY)).strftime("%Y-%m-%d")
    url = _ecb_url(ECB_TENOR_CODES, start)
    try:
        frame = _ecb_frame(_get(url, "ECB"), url)
    except CurveError as bulk_error:
        if verbose:
            print(f"  [retry] ECB bulk request failed, falling back to one "
                  f"request per tenor\n          {str(bulk_error).splitlines()[0]}")
        parts, failed = [], []
        for code in ECB_TENOR_CODES:
            one = _ecb_url((code,), start)
            try:
                parts.append(_ecb_frame(_get(one, f"ECB {code}"), one))
            except CurveError:
                failed.append(code)
        if not parts:
            raise CurveError(
                f"ECB: neither the bulk request nor any single tenor returned "
                f"usable data.\n  Bulk error was: {bulk_error}") from bulk_error
        frame = pd.concat(parts, axis=1).sort_index()
        if verbose and failed:
            print(f"          tenors unavailable: {', '.join(failed)}")

    frame = frame[~frame.index.duplicated(keep="last")]
    if verbose:
        live = frame.dropna(how="all")
        print(f"  [ok]   Euro area (ECB)      {len(frame):>6,} days, "
              f"{frame.shape[1]} tenors, through {live.index.max():%Y-%m-%d}")
    return frame


# --------------------------------------------------------------------------- #
# Malaysia - Bank Negara
# --------------------------------------------------------------------------- #

MGS_URL = "https://api.bnm.gov.my/public/gov-sec-yield"
BNM_ACCEPT = {"Accept": "application/vnd.BNM.API.v1+json",
              "User-Agent": HEADERS["User-Agent"]}

#: Anything in a field name that says "this is an Islamic security" puts the
#: reading on its own curve rather than into the MGS one. MGS and GII are
#: different instruments with a persistent basis between them; averaging them
#: would produce a curve that is neither.
_ISLAMIC = re.compile(r"\b(gii|mgii|islamic|sukuk)\b", re.IGNORECASE)
_BILL = re.compile(r"\b(bill|mtb|mitb|treasury\s*bill)\b", re.IGNORECASE)

#: "3", "3y", "3 year", "3-yr", "mgs_3y", "yield3year" -> 3 years.
_MY_TENOR = re.compile(
    r"(?:^|[^0-9])(\d+(?:\.\d+)?)\s*[-_ ]?\s*(y|yr|yrs|year|years|m|mo|month|months)?"
    r"(?:$|[^a-z0-9])", re.IGNORECASE)

_DATE_KEYS = ("date", "day", "period", "trade_date", "tradedate", "as_at", "asat")


def _my_tenor(text: str) -> Tenor | None:
    """The maturity inside a BNM field name, if there is one."""
    matches = _MY_TENOR.findall(str(text).replace("/", " "))
    if not matches:
        return None
    size, unit = matches[-1]              # the last number is the maturity
    try:
        value = float(size)
    except ValueError:
        return None
    unit = (unit or "y").lower()
    months = value if unit.startswith("m") else value * 12.0
    if months <= 0 or months > 600:
        return None
    return Tenor(f"{value:g}M" if months < 12 else f"{value:g}Y", months)


def _flatten(record: object, prefix: str = "") -> dict[str, object]:
    """One level of dotted keys out of an arbitrarily nested JSON record."""
    out: dict[str, object] = {}
    if isinstance(record, dict):
        for key, value in record.items():
            out.update(_flatten(value, f"{prefix}{key}." if prefix == "" else
                                f"{prefix}{key}."))
    elif isinstance(record, list):
        for i, value in enumerate(record):
            out.update(_flatten(value, f"{prefix}{i}."))
    else:
        out[prefix.rstrip(".")] = record
    return out


def _mgs_rows(payload: object) -> list[dict]:
    """BNM wraps rows in {"data": ...} and sometimes returns a lone object."""
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in ("data", "result", "results", "records"):
            inner = payload.get(key)
            if isinstance(inner, list):
                return [r for r in inner if isinstance(r, dict)]
            if isinstance(inner, dict):
                return [inner]
        if payload and not any(isinstance(v, (list, dict)) for v in payload.values()):
            return [payload]
    return []


_TENOR_KEY = re.compile(r"\b(tenor|tenure|maturity|term)\b", re.IGNORECASE)

#: A government bond yield. Anything outside this is an id, a volume, a code or
#: a price, and must not be mistaken for a rate.
MIN_YIELD, MAX_YIELD = 0.01, 30.0


def _date_in(scalars: dict[str, object]) -> pd.Timestamp | None:
    for key, value in scalars.items():
        if any(d in str(key).lower() for d in _DATE_KEYS):
            parsed = pd.to_datetime(value, errors="coerce")
            if pd.notna(parsed):
                return parsed.normalize()
    return None


def _records(node: object, date: pd.Timestamp | None = None):
    """
    Every innermost record in the tree, each carrying the nearest date above it.

    BNM's shape is undocumented and could reasonably be any of: one wide object
    per day, a list of rows each holding a tenure and one yield per instrument,
    or a day object wrapping a nested list of tenor rows. Walking the tree and
    treating the innermost dicts as records handles all three without the
    parser needing to know which it got.
    """
    if isinstance(node, list):
        for item in node:
            yield from _records(item, date)
        return
    if not isinstance(node, dict):
        return

    scalars = {k: v for k, v in node.items()
               if not isinstance(v, (dict, list))}
    nested = {k: v for k, v in node.items() if isinstance(v, (dict, list))}
    here = _date_in(scalars) or date

    if scalars:
        yield here, scalars
    for value in nested.values():
        yield from _records(value, here)


#: Field names that say nothing about which instrument they belong to, so the
#: rest of the record has to be consulted.
_GENERIC_FIELD = re.compile(r"^(yield|rate|value|ytm|price|level)s?$", re.IGNORECASE)


def _words(text: object) -> str:
    """Separators become spaces so \\b works: 'gii_3y' must match /\\bgii\\b/.

    Without this an Islamic yield named `gii_3y` is classified as conventional
    and then silently OVERWRITES the real `mgs_3y` in the same record, because
    both land on the column 'MY 3Y'. Found by testing, not by reading.
    """
    return re.sub(r"[^0-9a-zA-Z]+", " ", str(text))


def _market_for(key: str, context: dict | None = None) -> str:
    """
    MGS, GII or bills, decided from the field name first.

    The field name wins because a record like {"tenure": "3", "mgs": 3.12,
    "gii": 3.20} holds both instruments at once - consulting the whole record
    there would label the MGS yield as Islamic. Only when the field name says
    nothing ("yield", "rate") is the rest of the record read, which is the
    shape {"security": "MGS", "tenure": "3", "yield": 3.12}.
    """
    name = _words(str(key).rsplit(".", 1)[-1])
    if _BILL.search(name):
        return "MY bills"
    if _ISLAMIC.search(name):
        return "MY GII"
    if _GENERIC_FIELD.match(name.strip()) and context:
        blob = _words(" ".join(str(v) for v in context.values()
                               if isinstance(v, str)))
        if _BILL.search(blob):
            return "MY bills"
        if _ISLAMIC.search(blob):
            return "MY GII"
    return MARKET_MY


def _mgs_frame(rows: object, fallback_date: str | None = None) -> pd.DataFrame:
    """
    Turn BNM's yield records into '<market> <tenor>' columns.

    Field names are not documented and are not assumed. For each record the
    maturity is taken either from a dedicated tenor/tenure field's VALUE, or
    failing that from the field NAME of each number. Anything naming GII, sukuk
    or bills is routed to its own market label, so an Islamic yield can never
    land in the conventional MGS curve - they are different instruments with a
    persistent basis between them.
    """
    collected: dict[pd.Timestamp, dict[str, float]] = {}
    default = pd.to_datetime(fallback_date, errors="coerce") if fallback_date else None
    default = default.normalize() if default is not None and pd.notna(default) else None

    for stamp, scalars in _records(rows):
        stamp = stamp or default
        if stamp is None:
            continue

        # Shape B/C: the record says which maturity it is about.
        row_tenor = None
        for key, value in scalars.items():
            if _TENOR_KEY.search(str(key)):
                row_tenor = _my_tenor(value) or _my_tenor(f"{key} {value}")
                if row_tenor:
                    break

        for key, value in scalars.items():
            if any(d in str(key).lower() for d in _DATE_KEYS):
                continue
            if row_tenor is not None and _TENOR_KEY.search(str(key)):
                continue
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            if not (MIN_YIELD < number < MAX_YIELD):
                continue
            tenor = row_tenor or _my_tenor(key)
            if tenor is None:
                continue
            market = _market_for(key, scalars)
            collected.setdefault(stamp, {})[f"{market} {tenor.label}"] = number

    if not collected:
        return pd.DataFrame()
    frame = pd.DataFrame.from_dict(collected, orient="index").sort_index()
    frame.index.name = "Date"
    return frame[curve_columns(frame, MARKET_MY)
                 + curve_columns(frame, "MY GII")
                 + curve_columns(frame, "MY bills")]


def fetch_mgs(days: int = 90, verbose: bool = True) -> pd.DataFrame:
    """
    The Malaysian government securities curve, from Bank Negara's Open API.

    The endpoint serves one day at a time, so history is walked backwards a
    business day at a time and the archive keeps whatever has been collected.
    A one-off deeper backfill is `python refresh.py --block Curves --mgs-days N`.

    Every date is independent: a public holiday, a gap in the series or a
    throttled request costs that day and nothing else.
    """
    frames, failures, empty = [], {}, 0

    try:
        latest = _mgs_frame(_mgs_rows(_get_json(MGS_URL, "BNM gov-sec-yield")))
        if not latest.empty:
            frames.append(latest)
    except CurveError as exc:
        failures["latest"] = str(exc)

    today = dt.date.today()
    wanted = [d.date() for d in pd.bdate_range(today - dt.timedelta(days=int(days * 1.5)),
                                               today)][-days:]
    for day in reversed(wanted):
        stamp = day.strftime("%Y-%m-%d")
        try:
            rows = _mgs_rows(_get_json(f"{MGS_URL}?date={stamp}",
                                       f"BNM gov-sec-yield {stamp}"))
        except CurveError as exc:
            failures[stamp] = str(exc)
            if len(failures) > 12:      # the endpoint is not answering at all
                break
            continue
        frame = _mgs_frame(rows, fallback_date=stamp)
        if frame.empty:
            empty += 1
        else:
            frames.append(frame)
        time.sleep(PAUSE)

    if not frames:
        first = next(iter(failures.values()),
                     "none - the responses parsed to no maturity-bearing fields")
        raise CurveError(
            "Bank Negara gov-sec-yield returned nothing usable.\n"
            f"  {len(failures)} request(s) failed, {empty} returned no yields.\n"
            f"  First error: {first}\n"
            "  Run `python refresh.py --mgs-check` to see the raw response.")

    out = pd.concat(frames).sort_index()
    out = out[~out.index.duplicated(keep="last")]
    if verbose:
        for market in (MARKET_MY, "MY GII", "MY bills"):
            columns = curve_columns(out, market)
            if columns:
                print(f"  [ok]   {market:<20} {len(columns)} tenors, "
                      f"{len(out.dropna(how='all')):>4} days, through "
                      f"{out[columns].dropna(how='all').index.max():%Y-%m-%d}")
        if failures or empty:
            print(f"         {len(failures)} day(s) failed, {empty} returned "
                  f"no yields (holidays and weekends are normal)")
    return out


def describe_mgs(limit: int = 1200) -> str:
    """`--mgs-check` - the raw BNM response, so the parser can be aimed properly."""
    import json as _json

    lines = []
    for label, url in (("latest", MGS_URL),
                       ("dated", f"{MGS_URL}?date="
                                 f"{(dt.date.today() - dt.timedelta(days=3)):%Y-%m-%d}")):
        lines.append(f"\n=== {label} ===\n{url}")
        try:
            payload = _get_json(url, f"BNM {label}")
        except CurveError as exc:
            lines.append(f"  FAILED: {exc}")
            continue
        text = _json.dumps(payload, indent=1, ensure_ascii=False)
        lines.append("  " + text[:limit].replace("\n", "\n  "))
        if len(text) > limit:
            lines.append(f"  … {len(text) - limit} more characters")

        rows = _mgs_rows(payload)
        lines.append(f"\n  rows found: {len(rows)}")
        if rows:
            lines.append(f"  flattened keys of row 0: "
                         f"{sorted(_flatten(rows[0]))}")
        frame = _mgs_frame(rows)
        if frame.empty:
            lines.append("  PARSER SELECTED: nothing - no field carried both a "
                         "maturity and a plausible yield")
        else:
            lines.append(f"  PARSER SELECTED: {frame.shape[0]} row(s) x "
                         f"{frame.shape[1]} columns")
            lines.append(f"  columns: {list(frame.columns)}")
            lines.append("  " + frame.to_string().replace("\n", "\n  "))
    return "\n".join(lines)


def fetch_my_policy_rate(years: int = 12, verbose: bool = True) -> pd.DataFrame:
    """
    The Overnight Policy Rate, as the Malaysian short rate.

    This is NOT a curve and is not pretended to be one. Bank Negara publishes a
    full MGS and GII curve daily, but only as a rendered page inside a
    single-page app - no CSV, no export, no endpoint - and its Open API excludes
    bond yields by design. The OPR is what can be had honestly, and it is what
    the hedging cost of a foreign bond is actually paid at.

    Left sparse, at decision dates only, rather than forward-filled into the
    cache: the cache should say when the rate changed, and any page that needs
    a daily line can ffill in one call.
    """
    from data.malaysia import fetch_opr_history

    try:
        series = fetch_opr_history(years=years, verbose=False)
    except Exception as exc:   # noqa: BLE001 - one source among several
        raise CurveError(f"Bank Negara OPR: {exc}") from exc

    frame = series.rename("MY OPR").to_frame()
    frame.index.name = "Date"
    if verbose:
        print(f"  [ok]   Malaysia (BNM OPR)   {len(frame):>6,} decisions, "
              f"through {frame.index.max():%Y-%m-%d}, latest "
              f"{float(frame.iloc[-1, 0]):.2f}%")
    return frame


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #

def build_curves(start: str = "2000-01-01", verbose: bool = True,
                 mgs_days: int = 90) -> pd.DataFrame:
    """
    One wide frame: every market's every tenor, on a shared daily index.

    Columns are named '<market> <tenor>' - 'US 10Y', 'US real 10Y', 'JP 40Y' -
    so a page can pull a whole curve with `curve_columns(frame, "JP")` without
    the registry needing an entry per tenor.

    A market that fails is reported and left out rather than killing the build;
    the page shows what is there and says what is missing.
    """
    first_year = pd.Timestamp(start).year
    parts: list[pd.DataFrame] = []
    problems: dict[str, str] = {}

    for name, call in (
        (MARKET_JP, lambda: fetch_jgb(verbose=verbose)),
        (MARKET_US, lambda: fetch_treasury(first_year, TREASURY_NOMINAL,
                                           MARKET_US, verbose)),
        (MARKET_US_REAL, lambda: fetch_treasury(first_year, TREASURY_REAL,
                                                MARKET_US_REAL, verbose)),
        (MARKET_EA, lambda: fetch_ecb(start, verbose)),
        ("MY curve", lambda: fetch_mgs(mgs_days, verbose)),
        ("MY policy rate", lambda: fetch_my_policy_rate(verbose=verbose)),
    ):
        try:
            parts.append(call())
        except CurveError as exc:
            problems[name] = str(exc)
            if verbose:
                print(f"  [FAIL] {name:<20} {exc}")

    if not parts:
        raise CurveError(
            "No curve source returned data. First error:\n  "
            + next(iter(problems.values()), "unknown"))

    frame = pd.concat(parts, axis=1).sort_index()
    frame = frame.loc[pd.Timestamp(start):]
    frame.index.name = "Date"
    frame.attrs["problems"] = problems

    # Tenor order, short to long, market by market - so the cached CSV reads
    # like a curve rather than like whatever order the sources happened to use.
    ordered: list[str] = []
    for market in (MARKET_US, MARKET_US_REAL, MARKET_EA, MARKET_JP,
                   MARKET_MY, "MY GII", "MY bills"):
        ordered += curve_columns(frame, market)
    ordered += [c for c in frame.columns if c not in ordered]
    return frame[ordered]


# --------------------------------------------------------------------------- #
# Diagnostics  (python refresh.py --curves-check)
# --------------------------------------------------------------------------- #

def _recent(days: int = 30) -> str:
    return (dt.date.today() - dt.timedelta(days=days)).strftime("%Y-%m-%d")


def describe() -> pd.DataFrame:
    """
    What each source actually returned, for when one of them changes shape.

    Deliberately fetches a single Treasury year rather than the whole history -
    this is a format check, not a download.
    """
    this_year = dt.date.today().year
    rows = []

    checks = [
        ("Japan (MOF, current month)", lambda: _mof_frame(
            _get(MOF_LATEST, "MOF"), MOF_LATEST)),
        ("Japan (MOF, full history)", lambda: _mof_frame(
            _get(MOF_HISTORY, "MOF"), MOF_HISTORY)),
        (f"US nominal ({this_year})", lambda: _treasury_frame(
            _get(_treasury_url(this_year, TREASURY_NOMINAL), "Treasury"),
            MARKET_US, _treasury_url(this_year, TREASURY_NOMINAL))),
        (f"US real ({this_year})", lambda: _treasury_frame(
            _get(_treasury_url(this_year, TREASURY_REAL), "Treasury"),
            MARKET_US_REAL, _treasury_url(this_year, TREASURY_REAL))),
        ("Malaysia (BNM gov-sec-yield)", lambda: _mgs_frame(
            _mgs_rows(_get_json(MGS_URL, "BNM")))),
        ("Euro area (ECB, last 30 days)", lambda: _ecb_frame(
            _get(_ecb_url(ECB_TENOR_CODES, _recent()), "ECB"),
            _ecb_url(ECB_TENOR_CODES, _recent()))),
    ]

    for label, call in checks:
        try:
            frame = call()
        except CurveError as exc:
            rows.append({"Source": label, "Status": "FAIL", "Rows": 0,
                         "Tenors": "", "From": "", "To": "",
                         "Detail": str(exc).replace("\n", " ")[:160]})
            continue
        live = frame.dropna(how="all")
        rows.append({
            "Source": label, "Status": "ok", "Rows": len(frame),
            "Tenors": " ".join(t.label for t in
                               (tenor_of(c) for c in frame.columns) if t),
            "From": f"{live.index.min():%Y-%m-%d}" if len(live) else "",
            "To": f"{live.index.max():%Y-%m-%d}" if len(live) else "",
            "Detail": f"{frame.shape[1]} columns",
        })

    return pd.DataFrame(rows)
