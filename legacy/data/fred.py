"""
FRED data access layer.
=======================
One place that knows how to talk to FRED. Nothing else in the project should
import `requests` for FRED data.

Key resolution order:
    1. FRED_API_KEY environment variable
    2. .streamlit/secrets.toml  ->  FRED_API_KEY = "..."

Typical use:
    from data.fred import fetch_many, save_cache
    df = fetch_many(["NFCI", "ANFCI"], start="2000-01-01")
    save_cache(df, "fred")
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pandas as pd
import requests

FRED_BASE = "https://api.stlouisfed.org/fred"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
CACHE_DIR = PROJECT_ROOT / "cache"
SECRETS_PATH = PROJECT_ROOT / ".streamlit" / "secrets.toml"

DEFAULT_START = "2000-01-01"
MAX_RETRIES = 3
TIMEOUT = 30


class FredError(RuntimeError):
    """Raised when FRED refuses a request or a series cannot be retrieved."""


# --------------------------------------------------------------------------- #
# Credentials
# --------------------------------------------------------------------------- #

def get_api_key() -> str:
    """Find the FRED API key, or explain clearly how to supply one."""
    key = os.environ.get("FRED_API_KEY")
    if key and key.strip():
        return key.strip()

    if SECRETS_PATH.exists():
        try:
            import tomllib  # Python 3.11+
        except ModuleNotFoundError:  # pragma: no cover - older interpreters
            try:
                import tomli as tomllib  # type: ignore[no-redef]
            except ModuleNotFoundError:
                raise FredError(
                    "Python < 3.11 needs the 'tomli' package to read secrets.toml.\n"
                    "Run: pip install tomli   (or set the FRED_API_KEY env var instead)"
                ) from None
        with SECRETS_PATH.open("rb") as fh:
            data = tomllib.load(fh)
        key = data.get("FRED_API_KEY")
        if key and str(key).strip():
            return str(key).strip()

    raise FredError(
        "No FRED API key found.\n"
        f"Create {SECRETS_PATH} containing:\n\n"
        '    FRED_API_KEY = "your-key-here"\n\n'
        "Free keys: https://fred.stlouisfed.org/docs/api/api_key.html"
    )


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

def _request(path: str, params: dict, session: requests.Session | None = None) -> dict:
    """GET a FRED endpoint with retries. Raises FredError with FRED's own message."""
    sess = session or requests
    params = {**params, "api_key": get_api_key(), "file_type": "json"}

    last_error: str | None = None
    for attempt in range(MAX_RETRIES):
        try:
            resp = sess.get(f"{FRED_BASE}/{path}", params=params, timeout=TIMEOUT)
        except requests.RequestException as exc:
            last_error = f"network error: {exc}"
            time.sleep(1.5 * (attempt + 1))
            continue

        if resp.status_code == 429:  # rate limited - back off and retry
            last_error = "rate limited (429)"
            time.sleep(5 * (attempt + 1))
            continue

        if resp.status_code == 400:
            # FRED reports bad series IDs and bad keys as 400 with a useful message.
            try:
                message = resp.json().get("error_message", resp.text)
            except ValueError:
                message = resp.text
            raise FredError(f"FRED rejected the request: {message}")

        resp.raise_for_status()
        return resp.json()

    raise FredError(f"Gave up after {MAX_RETRIES} attempts - {last_error}")


# --------------------------------------------------------------------------- #
# Series
# --------------------------------------------------------------------------- #

def _to_series(observations: list[dict], series_id: str) -> pd.Series:
    """Convert FRED's observation list into a clean float Series indexed by date."""
    if not observations:
        return pd.Series(dtype="float64", name=series_id,
                         index=pd.DatetimeIndex([], name="Date"))

    frame = pd.DataFrame(observations)
    index = pd.to_datetime(frame["date"], errors="coerce")
    # FRED encodes missing observations as "." - coerce turns those into NaN.
    values = pd.to_numeric(frame["value"], errors="coerce")

    series = pd.Series(values.to_numpy(), index=pd.DatetimeIndex(index, name="Date"),
                       name=series_id)
    series = series[series.index.notna()].dropna()
    series = series[~series.index.duplicated(keep="last")].sort_index()
    return series


def fetch_series(series_id: str, start: str = DEFAULT_START,
                 session: requests.Session | None = None) -> pd.Series:
    """Download one FRED series as a float Series indexed by date."""
    payload = _request(
        "series/observations",
        {"series_id": series_id, "observation_start": start},
        session=session,
    )
    return _to_series(payload.get("observations", []), series_id)


def fetch_many(series_ids: list[str], start: str = DEFAULT_START,
               pause: float = 0.12, verbose: bool = True) -> pd.DataFrame:
    """
    Download several series and outer-join them on date.

    A series that fails is reported and skipped rather than killing the run -
    one retired series should never block a refresh.
    """
    session = requests.Session()
    collected: dict[str, pd.Series] = {}
    failures: dict[str, str] = {}

    for series_id in series_ids:
        try:
            series = fetch_series(series_id, start=start, session=session)
        except (FredError, requests.RequestException) as exc:
            failures[series_id] = str(exc)
            if verbose:
                print(f"  [FAIL] {series_id:<22} {exc}")
            continue

        if series.empty:
            failures[series_id] = "no observations in range"
            if verbose:
                print(f"  [EMPTY] {series_id:<21} no observations since {start}")
            continue

        collected[series_id] = series
        if verbose:
            print(f"  [ok]   {series_id:<22} {len(series):>6,} obs   "
                  f"through {series.index[-1]:%Y-%m-%d}")
        time.sleep(pause)  # be polite; FRED allows 120 req/min

    if not collected:
        raise FredError(
            "No series were retrieved. First error: "
            + (next(iter(failures.values())) if failures else "unknown")
        )

    frame = pd.concat(collected.values(), axis=1).sort_index()
    frame.index.name = "Date"
    frame.attrs["failures"] = failures
    return frame


def fetch_series_raw(series_ids: list[str], start: str = DEFAULT_START,
                     pause: float = 0.12, verbose: bool = True) -> dict[str, pd.Series]:
    """
    Download several series and return them unaligned, at native frequency,
    in native units.

    Use this when the caller needs to do frequency-aware work before aligning
    (M2 growth on monthly data, say). `fetch_many` is the flat-table version.
    """
    session = requests.Session()
    collected: dict[str, pd.Series] = {}

    for series_id in series_ids:
        try:
            series = fetch_series(series_id, start=start, session=session)
        except (FredError, requests.RequestException) as exc:
            if verbose:
                print(f"  [FAIL] {series_id:<22} {exc}")
            continue
        if series.empty:
            if verbose:
                print(f"  [EMPTY] {series_id:<21} no observations since {start}")
            continue
        collected[series_id] = series
        if verbose:
            print(f"  [ok]   {series_id:<22} {len(series):>6,} obs   "
                  f"through {series.index[-1]:%Y-%m-%d}")
        time.sleep(pause)

    return collected


def series_meta(series_id: str, session: requests.Session | None = None) -> dict:
    """Metadata for one series: title, units, frequency, observation range."""
    payload = _request("series", {"series_id": series_id}, session=session)
    rows = payload.get("seriess", [])
    if not rows:
        raise FredError(f"{series_id}: no metadata returned")
    return rows[0]


def search(text: str, limit: int = 20) -> pd.DataFrame:
    """
    Look up series IDs by description. Use this instead of guessing -
    a good half of FRED's IDs are unguessable.
    """
    payload = _request(
        "series/search",
        {"search_text": text, "limit": limit,
         "order_by": "popularity", "sort_order": "desc"},
    )
    rows = payload.get("seriess", [])
    if not rows:
        return pd.DataFrame(columns=["id", "title", "frequency", "observation_end"])
    return pd.DataFrame(rows)[["id", "title", "frequency_short", "observation_end"]]


# --------------------------------------------------------------------------- #
# Cache
# --------------------------------------------------------------------------- #

def cache_path(name: str) -> Path:
    return CACHE_DIR / f"{name}.parquet"


def save_cache(frame: pd.DataFrame, name: str) -> Path:
    """Write a frame to cache/<name>.parquet."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = cache_path(name)
    frame.to_parquet(path)
    return path


def load_cache(name: str) -> pd.DataFrame:
    """Read cache/<name>.parquet. Raises FileNotFoundError if refresh hasn't run."""
    path = cache_path(name)
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found - run `python refresh.py` first."
        )
    return pd.read_parquet(path)
