"""
Rates block builder.
====================
Neutral rate, curve slopes, real yields and an excess-liquidity proxy - the
inputs for the lead/lag charts.

Two things here are not straight FRED pulls:

**r-star** comes from the New York Fed's Holston-Laubach-Williams estimates,
published as an Excel workbook rather than a series. The parser below is
deliberately tolerant about sheet names and header positions, because that file
is a research output and its layout is not a contract. `inspect_hlw()` prints
what it actually found if the parse fails.

**Excess liquidity** is a proxy, not a replica. Bloomberg's "Excess Liquidity
Leading Indicator" is a proprietary composite with undisclosed construction, so
it cannot be reproduced. What CAN be reproduced is the standard concept it comes
from: money growing faster than the economy that has to absorb it. Here that is
real M2 growth minus industrial production growth, standardised. Same idea,
different line - do not expect the two to overlay.
"""

from __future__ import annotations

import io
import re
import warnings

import pandas as pd
import requests

from data import registry
from data.fred import fetch_series_raw

DEFAULT_START = "1985-01-01"

HLW_URL = ("https://www.newyorkfed.org/medialibrary/media/research/economists/"
           "williams/data/Holston_Laubach_Williams_current_estimates.xlsx")

#: Tried in order. The real-time file is a different vintage of the same
#: estimates and is a perfectly good substitute if the current-estimates file
#: is missing or moved.
HLW_URLS = (
    HLW_URL,
    ("https://www.newyorkfed.org/medialibrary/media/research/economists/"
     "williams/data/Holston_Laubach_Williams_real_time_estimates.xlsx"),
)

#: The NY Fed media library sits behind a CDN that rejects some non-browser
#: clients. requests sends "python-requests/2.x" by default, which is the kind
#: of thing that gets a 403 - and a 403 here looks identical to "the file
#: moved", which is why this was worth ruling out explicitly.
HLW_HEADERS = {"User-Agent": "Mozilla/5.0 (macro stress dashboard)"}
HLW_TIMEOUT = 60

#: Fallback when the workbook cannot be reached at all: the FOMC's own
#: longer-run median dot for the fed funds rate, less the 2% inflation target.
#: That is the Committee's implied real neutral rate - a different object from
#: a model estimate, and labelled differently wherever it is used.
SEP_LONGRUN_ID = "FEDTARMDLR"
INFLATION_TARGET = 2.0

#: Extra inputs the builder fetches directly. M2SL is deliberately duplicated
#: from the Funding block - one extra API call is cheaper than a build-order
#: dependency between two cache files.
EXTRA_FRED = ("M2SL", "FEDTARMDLR")


class RatesError(RuntimeError):
    """Raised when r-star cannot be retrieved or parsed."""


# --------------------------------------------------------------------------- #
# Holston-Laubach-Williams r-star
# --------------------------------------------------------------------------- #

def _download_hlw(url: str | None = None) -> dict[str, pd.DataFrame]:
    """Fetch the workbook, trying each known URL before giving up."""
    try:
        import openpyxl  # noqa: F401
    except ModuleNotFoundError:
        raise RatesError(
            "Reading .xlsx needs the openpyxl package, which is not installed. "
            "Run:  pip install openpyxl"
        ) from None

    urls = (url,) if url else HLW_URLS
    problems = []
    for candidate in urls:
        try:
            response = requests.get(candidate, headers=HLW_HEADERS,
                                    timeout=HLW_TIMEOUT)
            response.raise_for_status()
        except requests.RequestException as exc:
            problems.append(f"{candidate.rsplit('/', 1)[-1]}: {exc}")
            continue
        if len(response.content) < 20_000:
            problems.append(f"{candidate.rsplit('/', 1)[-1]}: only "
                            f"{len(response.content):,} bytes, not a workbook")
            continue
        try:
            return pd.read_excel(io.BytesIO(response.content),
                                 sheet_name=None, header=None)
        except Exception as exc:  # noqa: BLE001 - pandas raises several types
            problems.append(f"{candidate.rsplit('/', 1)[-1]}: {exc}")

    raise RatesError("Could not download or open the HLW workbook. "
                     + "  |  ".join(problems))


def _coerce_dates(column: pd.Series) -> pd.Series:
    """Parse a date column that may hold timestamps or '1961:Q1'-style strings."""
    with warnings.catch_warnings():
        # Probing a column that may not be dates at all - the fallback parser
        # warning is expected noise, not a problem.
        warnings.simplefilter("ignore", UserWarning)
        parsed = pd.to_datetime(column, errors="coerce")
    if parsed.notna().mean() > 0.5:
        return parsed
    text = column.astype(str).str.replace(":", "", regex=False).str.strip()
    try:
        return pd.PeriodIndex(text, freq="Q").to_timestamp().to_series(index=column.index)
    except Exception:  # noqa: BLE001
        return parsed


def _pick_sheet(sheets: dict[str, pd.DataFrame], economy: str) -> tuple[str, pd.DataFrame]:
    """
    The sheet for the economy we want, matched on whole tokens.

    Substring matching is not safe here: the workbook carries the US, Canada,
    the euro area and the UK side by side, and "us" is a substring of
    "Australia" among others. A loose match would return another country's
    r-star under a US label - wrong in a way nothing downstream could detect.
    """
    wanted = economy.strip().lower()
    aliases = {"us": {"us", "u.s.", "usa", "united", "states", "unitedstates"}}.get(
        wanted, {wanted})
    for name, frame in sheets.items():
        tokens = set(re.split(r"[^a-z.]+", str(name).strip().lower())) - {""}
        if tokens & aliases:
            return name, frame
    name = next(iter(sheets))
    return name, sheets[name]


def _parse_one_sheet(raw: pd.DataFrame, sheet_name: str) -> pd.Series | None:
    """Pull an r-star column out of a single sheet, or return None."""
    header_row = None
    for i in range(min(20, len(raw))):
        cells = [str(c).strip().lower() for c in raw.iloc[i].tolist()]
        if any(_looks_like_rstar(c) for c in cells):
            header_row = i
            break
    if header_row is None:
        return None

    frame = raw.iloc[header_row + 1:].copy()
    frame.columns = [str(c).strip() for c in raw.iloc[header_row].tolist()]
    frame = frame.loc[:, [c for c in frame.columns if c and c.lower() != "nan"]]

    star_col = next((c for c in frame.columns
                     if _looks_like_rstar(str(c).strip().lower())), None)
    if star_col is None:
        return None

    date_col = None
    for column in frame.columns:
        if column is star_col:
            continue
        if _coerce_dates(frame[column]).notna().mean() > 0.5:
            date_col = column
            break
    if date_col is None:
        return None

    out = pd.DataFrame({
        "Date": _coerce_dates(frame[date_col]),
        "R* (HLW)": pd.to_numeric(frame[star_col], errors="coerce"),
    }).dropna()

    series = out.set_index("Date")["R* (HLW)"].sort_index()
    series = series[~series.index.duplicated(keep="last")]
    if series.empty:
        return None

    # An r-star estimate is a real short rate. Anything outside this range is a
    # different column that happened to sit under a matching header.
    if not series.between(-4, 8).mean() > 0.9:
        return None
    return series


def _looks_like_rstar(text: str) -> bool:
    cleaned = text.strip().lower().replace(" ", "").replace("-", "")
    return cleaned in {"rstar", "r*", "rstar(t)", "r*(t)"} or cleaned.startswith("rstar")


def parse_hlw(sheets: dict[str, pd.DataFrame], economy: str = "US") -> pd.Series:
    """
    Pull the r-star column out of the HLW workbook.

    Tries the sheet whose name matches the economy first, then every other
    sheet. The workbook is a research output and its sheet naming has changed
    before - insisting on one sheet is how a working file still produces
    "no data".
    """
    preferred, _ = _pick_sheet(sheets, economy)
    order = [preferred] + [n for n in sheets if n != preferred]

    tried = []
    for name in order:
        series = _parse_one_sheet(sheets[name], name)
        if series is not None:
            # Surfaced in the refresh output: if the sheet match ever goes
            # wrong, a US dashboard quietly plotting Canada's r-star is exactly
            # the failure that would never announce itself.
            series.attrs["sheet"] = str(name)
            return series
        tried.append(str(name))

    raise RatesError(
        f"No usable r-star column on any sheet. Looked at: {', '.join(tried)}. "
        "Run `python refresh.py --inspect-hlw` and send me the output."
    )


def fetch_hlw(economy: str = "US") -> pd.Series:
    return parse_hlw(_download_hlw(), economy=economy)


def sep_neutral(dot: pd.Series) -> pd.Series:
    """
    The FOMC's implied real neutral rate: its longer-run median dot for the
    fed funds rate, less the 2% inflation target.

    Not the same object as HLW. HLW is a statistical estimate of an
    unobservable equilibrium; this is what the Committee says it thinks that
    number is. It steps rather than drifts - it only moves when the projections
    are updated, four times a year - and it is a policy signal as much as an
    estimate. Used only when the NY Fed workbook cannot be retrieved, and
    labelled differently wherever it appears so the two are never confused.
    """
    clean = dot.dropna()
    if clean.empty:
        return clean
    out = clean - INFLATION_TARGET
    out.name = "R* (FOMC dot)"
    return out


def inspect_hlw() -> str:
    """Human-readable dump of the workbook layout, for when the parser fails."""
    try:
        sheets = _download_hlw()
    except RatesError as exc:
        return str(exc)
    lines = [f"Sheets: {list(sheets)}"]
    for name, frame in sheets.items():
        lines.append(f"\n--- {name}  shape={frame.shape} ---")
        for i in range(min(8, len(frame))):
            cells = [str(c)[:18] for c in frame.iloc[i].tolist()[:10]]
            lines.append(f"  row {i}: {cells}")
    return "\n".join(lines)


# --------------------------------------------------------------------------- #
# Derived
# --------------------------------------------------------------------------- #

def _expanding_z(series: pd.Series, min_periods: int = 60) -> pd.Series:
    mean = series.expanding(min_periods=min_periods).mean()
    std = series.expanding(min_periods=min_periods).std()
    return (series - mean) / std.replace(0, pd.NA)


def excess_liquidity(m2: pd.Series, cpi: pd.Series, ip: pd.Series) -> pd.Series:
    """
    Real money growth minus real activity growth, standardised.

    A proxy for the concept, not a copy of anyone's proprietary indicator.
    Positive means money is growing faster than the economy absorbing it.
    """
    monthly = pd.concat({
        "m2": m2.resample("MS").last(),
        "cpi": cpi.resample("MS").last(),
        "ip": ip.resample("MS").last(),
    }, axis=1).dropna()

    if monthly.empty:
        return pd.Series(dtype="float64")

    real_m2_growth = (monthly["m2"] / monthly["cpi"]).pct_change(12) * 100.0
    activity_growth = monthly["ip"].pct_change(12) * 100.0
    gap = (real_m2_growth - activity_growth).dropna()

    out = _expanding_z(gap)
    out.name = "Excess Liquidity (proxy, z)"
    return out


def build_rates(start: str = DEFAULT_START, verbose: bool = True) -> pd.DataFrame:
    """Fetch the rates block, add curve slopes, real fed funds and the proxy."""
    ids = list(registry.fred_ids("Rates")) + list(EXTRA_FRED)
    raw = fetch_series_raw(ids, start=start, verbose=verbose)
    if not raw:
        raise RatesError("No rates series retrieved.")

    named = {}
    for series_id, series in raw.items():
        if series_id == SEP_LONGRUN_ID:
            continue          # used only for the r-star fallback below
        spec = registry.lookup(series_id)
        label = spec.name if spec else series_id
        named[label] = series.rename(label)

    # ---- excess liquidity, on native monthly data --------------------------
    proxy = None
    if all(k in named for k in ("M2_Money_Supply", "CPI", "Industrial production")):
        proxy = excess_liquidity(named["M2_Money_Supply"], named["CPI"],
                                 named["Industrial production"])

    # ---- real fed funds, monthly (core PCE is monthly) ---------------------
    real_ff = None
    if "Fed funds (monthly)" in named and "Core PCE index" in named:
        ff = named["Fed funds (monthly)"].resample("MS").last()
        core = named["Core PCE index"].resample("MS").last().pct_change(12) * 100.0
        real_ff = (ff - core).dropna()
        real_ff.name = "Real Fed Funds"

    # ---- r-star ------------------------------------------------------------
    rstar = None
    try:
        rstar = fetch_hlw("US")
        if verbose:
            print(f"  [ok]   HLW r-star{'':<12} {len(rstar):>6,} obs   "
                  f"through {rstar.index[-1]:%Y-%m-%d}   latest {rstar.iloc[-1]:.2f}%"
                  f"   sheet '{rstar.attrs.get('sheet', '?')}'")
    except RatesError as exc:
        if verbose:
            print("\n  " + "!" * 70)
            print(f"  HLW r-star UNAVAILABLE — {exc}")
            print("  Without it the Neutral & Curve tab cannot compute "
                  "restrictiveness from")
            print("  the model estimate. Falling back to the FOMC's own "
                  "longer-run dot.")
            print("  " + "!" * 70 + "\n")
        # Fall back to the Committee's implied neutral rate rather than
        # leaving the whole tab empty.
        if SEP_LONGRUN_ID in raw:
            rstar = sep_neutral(raw[SEP_LONGRUN_ID])
            if verbose and not rstar.empty:
                print(f"  [ok]   FOMC dot − 2%{'':<9} {len(rstar):>6,} obs   "
                      f"through {rstar.index[-1]:%Y-%m-%d}   "
                      f"latest {rstar.iloc[-1]:.2f}%")

    parts = list(named.values())
    for extra in (proxy, real_ff, rstar):
        if extra is not None and not extra.empty:
            parts.append(extra)

    frame = pd.concat(parts, axis=1).sort_index()
    daily = pd.date_range(start=start, end=frame.index.max(), freq="D", name="Date")
    frame = frame.reindex(daily).ffill()

    # ---- curve slopes and changes, on the daily grid ------------------------
    def slope(long: str, short: str, label: str) -> None:
        if long in frame.columns and short in frame.columns:
            frame[label] = (frame[long] - frame[short]) * 100.0

    slope("UST 30y", "UST 10y", "Curve 10s30s (bps)")
    slope("UST 10y", "UST 3m", "Curve 3m10y (bps)")
    slope("UST 10y", "UST 2y", "Curve 2s10s (bps)")

    if "Curve 3m10y (bps)" in frame.columns:
        frame["Curve 3m10y, 1y change (bps)"] = (
            frame["Curve 3m10y (bps)"] - frame["Curve 3m10y (bps)"].shift(365))

    if "UST 10y real" in frame.columns:
        frame["10y Real Yield, 1y change (bps)"] = (
            frame["UST 10y real"] - frame["UST 10y real"].shift(365)) * 100.0

    # Positive = policy above neutral = restrictive. Computed from whichever
    # neutral-rate estimate is available; the column name records which, so a
    # chart can never imply HLW when it is showing the FOMC dot.
    neutral = next((c for c in ("R* (HLW)", "R* (FOMC dot)")
                    if c in frame.columns), None)
    if "Real Fed Funds" in frame.columns and neutral:
        frame["Restrictiveness (Real FF - R*)"] = (
            frame["Real Fed Funds"] - frame[neutral])
        frame.attrs["neutral_source"] = neutral

    # ---- the price-insensitive buyer base ----------------------------------
    # The Fed and foreign official accounts buy Treasuries for reasons other
    # than price. As their combined share of the debt shrinks, the marginal
    # buyer becomes someone who demands compensation for duration - which is
    # what a term premium is.
    holdings = ("Debt held by Fed", "Debt held by foreign", "Total public debt")
    if all(c in frame.columns for c in holdings):
        fed, foreign, total = (named.get(c) for c in holdings)
        if all(x is not None for x in (fed, foreign, total)):
            spec = registry.lookup("GFDEBTN")
            total = total * (spec.scale if spec else 1.0)
            # Inner join on the native quarterly index: foreign holdings publish
            # a quarter behind, and forward-filling before the division would
            # invent a share for a quarter that has not been reported.
            quarterly = pd.concat({"fed": fed, "foreign": foreign, "total": total},
                                  axis=1).dropna()
            if not quarterly.empty:
                share = ((quarterly["fed"] + quarterly["foreign"])
                         / quarterly["total"] * 100.0)
                frame["Fed + Foreign Share of Debt (%)"] = share.reindex(daily).ffill()
                frame["Fed Share of Debt (%)"] = (
                    (quarterly["fed"] / quarterly["total"] * 100.0)
                    .reindex(daily).ffill())
                frame["Foreign Share of Debt (%)"] = (
                    (quarterly["foreign"] / quarterly["total"] * 100.0)
                    .reindex(daily).ffill())

    frame.index.name = "Date"
    return frame
