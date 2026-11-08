"""
Global equity: prices and trend, in local currency, via yfinance.
=================================================================
Everything here stays in the currency it is quoted in. No index is translated
into ringgit or dollars: a line on a chart is then a move that actually
happened in that market, rather than a blend of the market and a currency.

Why this module was rewritten
-----------------------------
It used to call Yahoo's chart endpoint directly with `requests`, with Stooq as
a fallback. Yahoo now requires a **cookie and a crumb** on that endpoint, and a
plain `requests.get` sends neither. So the Yahoo leg was failing on every
symbol and every series was silently coming from Stooq instead - whose index
coverage is partial, whose symbols are undocumented, and which serves some
"indices" that are not the index you asked for. The fallback did its job of
never failing, which is exactly how a whole page of wrong numbers gets served
without a single error.

`yfinance` handles the cookie and crumb, and it exposes the instrument's own
metadata, which buys the thing that matters most here:

    **The currency is checked, not assumed.**

These funds list on six or seven exchanges in four currencies, and the share
class currency is not the trading currency. Reading a yen index off a dollar
listing gives you the index multiplied by USD/JPY - over the last three years a
larger move than the index itself. Every instrument below declares the currency
it must be in, `_history()` asks Yahoo what currency it actually is, and a
mismatch is rejected rather than charted. That turns a fact I had to look up by
hand, and got wrong more than once, into something the fetcher enforces.

There is no Stooq fallback any more. One source that reports what it served
beats two sources where the quiet one wins.

Price and total return
----------------------
Both come from the same instrument and the same rows:

    price         Close        - what the market did, dividends excluded
    total return  Adj Close    - dividends reinvested, back-adjusted

Using one instrument for both is what makes them comparable. It also retires
the accumulating share classes the previous version used: `IMAE.AS`, `CSPX.L`,
`CUKX.L`, `TPXY.PA`, `AJEUAS.SW`. They were correct, but they meant the price
and total-return lines for a region came from two different funds on two
different exchanges, each with its own listing-currency trap.

A pure index (`^GSPC`, `^FTSE`) pays no dividends, so its Adj Close equals its
Close and it has no total-return series. Where a region needs one, the
instrument is a **distributing** ETF in that market's own currency, whose
adjusted close is the total return. The US is the exception: Yahoo publishes
`^SP500TR`, the real S&P 500 total-return index, so that is used directly.

Yahoo's adjustment applies dividends gross and back-adjusts the whole history,
which is the standard approximation. A taxable holder earned less.

Still not official
------------------
Yahoo is a free consumer service, not an exchange feed or a statistical agency.
It has no SLA, it changes symbol coverage without notice, and its terms
describe personal use. Nothing sourced here should be redistributed, and every
column it serves is tagged in `SOURCE_TAGS` so the page can mark it on screen.

The OECD spine (monthly, official, back to the 1950s) still comes from FRED and
is unaffected by any of this.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import pandas as pd

from data.fred import fetch_series_raw

PAUSE = 0.15

#: A daily series with fewer rows than this is not a real price history - it is
#: a symbol that resolved to something thin, or a delisted stub.
MIN_QUOTE_ROWS = 120


class EquityError(RuntimeError):
    """An equity source did not return something usable."""


# --------------------------------------------------------------------------- #
# The official spine
# --------------------------------------------------------------------------- #

#: region label -> FRED id. OECD "share price index", monthly, 2015 = 100.
#:
#: Kept for the one thing it is uniquely good at - eight countries on one
#: construction back to the 1950s - and kept away from current returns, which
#: it cannot answer: it lags one to three months and is a monthly *average*
#: rather than a month-end close.
OECD_SPINE: dict[str, str] = {
    "United States": "SPASTT01USM661N",
    "Germany": "SPASTT01DEM661N",
    "France": "SPASTT01FRM661N",
    "United Kingdom": "SPASTT01GBM661N",
    "Japan": "SPASTT01JPM661N",
    "Korea": "SPASTT01KRM661N",
    "India": "SPASTT01INM661N",
    "China": "SPASTT01CNM661N",
}

#: Daily index levels FRED carries officially and permanently. These need no
#: cookie, no crumb and no currency check - FRED says what they are.
FRED_DAILY: dict[str, str] = {
    "NASDAQ Composite": "NASDAQCOM",
    "Nikkei 225": "NIKKEI225",
}

OECD_PREFIX = "OECD"

#: A series whose last observation is older than this is reported as stale.
STALE_MONTHLY_DAYS = 120
STALE_DAILY_DAYS = 12


@dataclass(frozen=True)
class Currency:
    code: str
    column: str | None          # column name in the Rates block, None for USD
    usd_per_unit: bool = False


CURRENCY: dict[str, Currency] = {
    "United States": Currency("USD", None, True),
    "Germany": Currency("EUR", "EUR/USD", True),
    "France": Currency("EUR", "EUR/USD", True),
    "United Kingdom": Currency("GBP", "GBP/USD", True),
    "Japan": Currency("JPY", "USD/JPY", False),
    "Korea": Currency("KRW", "USD/KRW", False),
    "India": Currency("INR", "USD/INR", False),
    "China": Currency("CNY", "USD/CNY", False),
    "Malaysia": Currency("MYR", "USD/MYR", False),
}


def oecd_column(region: str) -> str:
    return f"{OECD_PREFIX} {region}"


def oecd_regions(frame: pd.DataFrame) -> list[str]:
    """Spine regions actually present in a frame, in OECD_SPINE order."""
    return [r for r in OECD_SPINE if oecd_column(r) in frame.columns]


def fetch_oecd(start: str = "1990-01-01", verbose: bool = True) -> pd.DataFrame:
    """The monthly, cross-country comparable spine."""
    raw = fetch_series_raw(list(OECD_SPINE.values()), start=start, verbose=False)
    by_id = {v: k for k, v in OECD_SPINE.items()}

    collected, missing = {}, []
    for series_id, region in by_id.items():
        series = raw.get(series_id)
        if series is None or series.empty:
            missing.append(f"{region} ({series_id})")
            continue
        collected[oecd_column(region)] = series.rename(oecd_column(region))

    if not collected:
        raise EquityError(
            "No OECD share-price series retrieved. Every one of "
            f"{list(OECD_SPINE.values())} came back empty.")

    frame = pd.concat(collected.values(), axis=1).sort_index()
    frame.index.name = "Date"
    if verbose:
        live = frame.dropna(how="all")
        print(f"  [ok]   OECD spine           {len(collected)} regions, monthly, "
              f"{live.index.min():%Y-%m} to {live.index.max():%Y-%m}")
        if missing:
            print(f"         unavailable: {', '.join(missing)}")
    return frame


def fetch_fred_daily(start: str = "1990-01-01", verbose: bool = True) -> pd.DataFrame:
    """Daily index levels FRED carries in full."""
    raw = fetch_series_raw(list(FRED_DAILY.values()), start=start, verbose=False)
    by_id = {v: k for k, v in FRED_DAILY.items()}

    collected = {name: raw[sid].rename(name)
                 for sid, name in by_id.items() if raw.get(sid) is not None}
    if not collected:
        raise EquityError("Neither NASDAQCOM nor NIKKEI225 returned data.")

    frame = pd.concat(collected.values(), axis=1).sort_index()
    frame.index.name = "Date"
    if verbose:
        for name, series in collected.items():
            print(f"  [ok]   {name:<20} {len(series):>6,} days, through "
                  f"{series.index[-1]:%Y-%m-%d}")
    return frame


# --------------------------------------------------------------------------- #
# Yahoo, via yfinance
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Quote:
    name: str                    # column name in the cache
    symbols: tuple[str, ...]     # Yahoo symbols to try, in order
    region: str                  # key into CURRENCY, for the ringgit translation
    ccy: str                     # the currency it MUST be quoted in - enforced
    kind: str = "index"          # "index" | "etf"
    tr: bool = False             # does Adj Close give a usable total return?
    note: str = ""


#: One instrument per region. Where Yahoo carries the index itself, that is
#: what is used; where it does not (MSCI is licensed, and Yahoo does not serve
#: TOPIX under any spelling tried), a fund in that market's own currency
#: stands in.
#:
#: `tr=True` means the instrument pays dividends, so its Adj Close is a total
#: return. A bare index does not, so `tr=False` and that region has no
#: total-return line unless a separate TR instrument exists (see the US).
QUOTES: tuple[Quote, ...] = (
    Quote("S&P 500", ("^GSPC",), "United States", "USD"),
    Quote("S&P 500 TR", ("^SP500TR",), "United States", "USD", tr=True,
          note="Yahoo publishes the real S&P 500 total-return index, so the "
               "US total return is the index itself rather than a fund. Its "
               "Close is already a total return; no adjustment is applied."),

    Quote("MSCI Europe", ("IMEU.AS", "IMEU.MI"), "Germany", "EUR",
          kind="etf", tr=True,
          note="iShares Core MSCI Europe UCITS ETF EUR (Dist), IE00B1YZSC51, "
               "TER 0.12%. MSCI licenses its index levels and publishes no "
               "free history, so a fund stands in. Amsterdam and Milan are "
               "the euro listings - its London line (SMEA) is in pence and "
               "its Zurich line (IMEA) in francs."),

    Quote("FTSE 100", ("^FTSE",), "United Kingdom", "GBP"),
    Quote("FTSE 100 TR", ("ISF.L",), "United Kingdom", "GBP",
          kind="etf", tr=True,
          note="iShares Core FTSE 100 UCITS ETF GBP (Dist), IE0005042456. "
               "The UK is where dividends matter most - the price index "
               "leaves out roughly three and a half points a year."),

    Quote("TOPIX", ("1475.T", "1306.T", "1348.T"), "Japan", "JPY",
          kind="etf", tr=True,
          note="iShares Core TOPIX ETF (1475.T), then NEXT FUNDS (1306.T), "
               "then MAXIS (1348.T) - all Tokyo-listed and in yen. Yahoo "
               "does not serve the TOPIX index level itself under any "
               "spelling tried. TOPIX is capitalisation-weighted across "
               "roughly 1,700 names, against the Nikkei's price-weighted 225."),

    Quote("MSCI AC Asia ex Japan", ("AAXJ",), "United States", "USD",
          kind="etf", tr=True,
          note="iShares MSCI All Country Asia ex Japan ETF, TER 0.72% - not "
               "negligible over a decade. Quoted in USD because the index is; "
               "there is no single local currency for a thirteen-market "
               "region, so this is the one series not in a local currency."),

    Quote("Hang Seng", ("^HSI",), "China", "HKD"),
    Quote("Hang Seng TR", ("2800.HK",), "China", "HKD", kind="etf", tr=True,
          note="Tracker Fund of Hong Kong, in Hong Kong dollars. Hang Seng "
               "is Hong Kong-listed China - a different investor base and a "
               "different currency from the A-share market."),

    Quote("KOSPI", ("^KS11",), "Korea", "KRW"),
    Quote("Nifty 50", ("^NSEI",), "India", "INR"),
    Quote("FBM KLCI", ("^KLSE",), "Malaysia", "MYR"),

    # Not a regional benchmark - Germany sits inside MSCI Europe - but kept
    # for the Daily Detail tab, and named " TR" because it IS one. The DAX
    # (^GDAXI) is a *performance index*: it reinvests dividends by
    # construction, which almost no other headline index does. Charting it
    # against the FTSE 100 or the S&P 500 as though both were price indices
    # flatters Germany by roughly its dividend yield every year.
    Quote("DAX TR", ("^GDAXI",), "Germany", "EUR", tr=True,
          note="The DAX is a total-return index by construction - it "
               "reinvests dividends, unlike the FTSE 100, the S&P 500 or "
               "TOPIX. Labelled TR here so it is never put on a price chart "
               "beside them. Germany's price-return exposure is inside "
               "MSCI Europe."),
)

QUOTE_BY_NAME: dict[str, Quote] = {q.name: q for q in QUOTES}


def emitted_columns(quote: Quote) -> list[tuple[str, str]]:
    """
    The (column, basis) pairs one instrument produces.

    An instrument whose own name ends " TR" is a total-return instrument and
    produces only that. Any other dividend-paying instrument produces **both**
    bases from the same rows - its Close is the price return and its Adj Close
    is the total return - which is the point of using a fund rather than an
    index for MSCI Europe, TOPIX and Asia ex Japan.
    """
    if quote.name.endswith(" TR"):
        return [(quote.name, "total")]
    pairs = [(quote.name, "price")]
    if quote.tr:
        pairs.append((f"{quote.name} TR", "total"))
    return pairs


#: Every column the Yahoo layer can produce, with its basis.
QUOTE_BASIS: dict[str, str] = {
    column: basis for q in QUOTES for column, basis in emitted_columns(q)}

#: Column name -> where it came from. The page reads this to mark unofficial
#: series on screen, so nothing sourced from Yahoo can pass as official.
SOURCE_TAGS: dict[str, str] = {
    column: ("ETF proxy" if q.kind == "etf" else "Yahoo")
    for q in QUOTES for column, _ in emitted_columns(q)}
SOURCE_TAGS.update({oecd_column(r): "OECD via FRED" for r in OECD_SPINE})
SOURCE_TAGS.update({name: "FRED" for name in FRED_DAILY})

QUOTE_NOTES: dict[str, str] = {
    column: q.note for q in QUOTES for column, _ in emitted_columns(q) if q.note}
QUOTE_CCY: dict[str, str] = {
    column: q.ccy for q in QUOTES for column, _ in emitted_columns(q)}
QUOTE_CCY.update({"NASDAQ Composite": "USD", "Nikkei 225": "JPY"})


def _history(symbol: str, expect_ccy: str) -> tuple[pd.Series, pd.Series, str]:
    """
    (close, adjusted close, what Yahoo calls it) for one symbol.

    Raises rather than returning anything doubtful. The currency check is the
    important one: these funds list in four currencies and the ticker you find
    first is frequently the wrong one.
    """
    import yfinance as yf

    ticker = yf.Ticker(symbol)
    try:
        frame = ticker.history(period="max", auto_adjust=False, actions=False,
                               raise_errors=True)
    except Exception as exc:                      # noqa: BLE001 - yfinance
        raise EquityError(f"{symbol}: {type(exc).__name__}: "
                          f"{str(exc).splitlines()[0][:160]}") from exc

    if frame is None or frame.empty:
        raise EquityError(f"{symbol}: no rows returned")

    columns = {str(c).strip().lower(): c for c in frame.columns}
    if "close" not in columns:
        raise EquityError(f"{symbol}: no Close column; got {list(frame.columns)}")

    # yfinance indexes by a tz-aware timestamp in the exchange's own zone.
    # Left alone, a Tokyo series and a New York series carry different offsets
    # and will not align on concat - and midnight Tokyo is the previous day in
    # UTC, which silently shifts every Japanese observation back a day.
    index = pd.DatetimeIndex(frame.index)
    if index.tz is not None:
        index = index.tz_localize(None)
    index = index.normalize()
    index.name = "Date"

    close = pd.Series(pd.to_numeric(frame[columns["close"]], errors="coerce")
                      .to_numpy(), index=index).dropna()
    close = close[~close.index.duplicated(keep="last")].sort_index()

    adj_key = columns.get("adj close") or columns.get("adjclose")
    if adj_key is None:
        adjusted = close.copy()
    else:
        adjusted = pd.Series(pd.to_numeric(frame[adj_key], errors="coerce")
                             .to_numpy(), index=index).dropna()
        adjusted = adjusted[~adjusted.index.duplicated(keep="last")].sort_index()

    if len(close) < MIN_QUOTE_ROWS:
        raise EquityError(
            f"{symbol}: only {len(close)} rows, rejected as probably not the "
            f"instrument meant")

    # What Yahoo thinks this is. fast_info is the cheap path; .info is a much
    # heavier call, so it is only a fallback, and neither is allowed to break
    # the fetch on its own.
    currency, label = None, symbol
    try:
        fast = ticker.fast_info
        currency = (fast.get("currency") if hasattr(fast, "get")
                    else getattr(fast, "currency", None))
    except Exception:                             # noqa: BLE001
        currency = None
    try:
        info = getattr(ticker, "info", None) or {}
        currency = currency or info.get("currency")
        label = info.get("shortName") or info.get("longName") or symbol
    except Exception:                             # noqa: BLE001
        pass

    if currency and str(currency).upper() != expect_ccy.upper():
        raise EquityError(
            f"{symbol}: Yahoo quotes this in {str(currency).upper()}, not "
            f"{expect_ccy}. Refusing it - a {expect_ccy} index read off a "
            f"{str(currency).upper()} listing is the index multiplied by a "
            f"currency, which is not what the chart claims to show.")

    return close, adjusted, str(label)


def fetch_quote(quote: Quote) -> tuple[pd.Series, pd.Series, str]:
    """
    (price, total return, "symbol — what Yahoo calls it") for one instrument.

    Each candidate symbol is tried in turn. A symbol that fails, returns
    almost nothing, or is quoted in the wrong currency is skipped, and the
    reason is carried into the error if none of them work.
    """
    problems = []
    for symbol in quote.symbols:
        try:
            close, adjusted, label = _history(symbol, quote.ccy)
        except EquityError as exc:
            problems.append(str(exc))
            continue
        total = adjusted if quote.tr else None
        return (close.rename(quote.name),
                None if total is None else total.rename(quote.name),
                f"{symbol} — {label}")
    raise EquityError(f"{quote.name}: no symbol served it.\n  "
                      + "\n  ".join(problems))


def fetch_quotes(verbose: bool = True) -> pd.DataFrame:
    """Every instrument. A dividend-paying fund contributes two columns."""
    collected, problems = {}, {}
    for quote in QUOTES:
        try:
            close, adjusted, label = fetch_quote(quote)
        except EquityError as exc:
            problems[quote.name] = str(exc)
            if verbose:
                print(f"  [FAIL] {quote.name:<24} {str(exc).splitlines()[0]}")
            continue

        for column, basis in emitted_columns(quote):
            source = adjusted if basis == "total" else close
            if source is None or source.empty:
                continue
            collected[column] = source.rename(column)

        if verbose:
            produced = [c for c, _ in emitted_columns(quote) if c in collected]
            main = collected.get(produced[0]) if produced else None
            if main is not None:
                print(f"  [ok]   {quote.name:<24} {len(main):>6,} days via "
                      f"{label}, through {main.index[-1]:%Y-%m-%d} "
                      f"({quote.ccy}{', + TR' if len(produced) > 1 else ''})")
        time.sleep(PAUSE)

    if not collected:
        raise EquityError(
            "No index quotes retrieved from Yahoo. First error:\n  "
            + next(iter(problems.values()), "unknown"))

    frame = pd.concat(collected.values(), axis=1).sort_index()
    frame.index.name = "Date"
    frame.attrs["problems"] = problems
    return frame


# --------------------------------------------------------------------------- #
# What each region is represented by
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Benchmark:
    region: str
    column: str
    ccy: str
    short: str = ""     # for the metric cards, which truncate at ~30 chars

    @property
    def card(self) -> str:
        return self.short or self.column


#: Price return - dividends excluded. Nine regions, in display order.
BENCHMARKS: tuple[Benchmark, ...] = (
    Benchmark("United States", "S&P 500", "USD"),
    Benchmark("Europe", "MSCI Europe", "EUR"),
    Benchmark("United Kingdom", "FTSE 100", "GBP"),
    Benchmark("Japan", "TOPIX", "JPY"),
    Benchmark("Asia ex Japan", "MSCI AC Asia ex Japan", "USD",
              short="MSCI AC Asia xJP"),
    Benchmark("China", "Hang Seng", "HKD"),
    Benchmark("Korea", "KOSPI", "KRW"),
    Benchmark("India", "Nifty 50", "INR"),
    Benchmark("Malaysia", "FBM KLCI", "MYR"),
)

#: Total return - dividends reinvested.
#:
#: Where the column has no " TR" suffix, the instrument is itself a
#: distributing fund and this is its adjusted close: MSCI Europe, TOPIX and
#: MSCI AC Asia ex Japan appear on BOTH views, from the same fund, because
#: Close and Adj Close of one instrument are exactly the price and total
#: return of the same thing. That is the whole reason for using a fund rather
#: than an index for those three.
TR_BENCHMARKS: tuple[Benchmark, ...] = (
    Benchmark("United States", "S&P 500 TR", "USD"),
    Benchmark("Europe", "MSCI Europe TR", "EUR"),
    Benchmark("United Kingdom", "FTSE 100 TR", "GBP"),
    Benchmark("Japan", "TOPIX TR", "JPY"),
    Benchmark("Asia ex Japan", "MSCI AC Asia ex Japan TR", "USD",
              short="MSCI AC Asia xJP TR"),
    Benchmark("China", "Hang Seng TR", "HKD"),
)

#: Regions with no local-currency total-return series *that I have found*.
#:
#: The wording matters. This list once said Japan was impossible - that
#: Japanese funds must distribute, so no accumulating TOPIX share class could
#: exist. The premise was true and the conclusion did not follow, and it is now
#: moot: a distributing fund's adjusted close is a total return, so the
#: accumulating share class was never needed in the first place.
#:
#: What closes any of these is the same thing: a dividend-paying fund on the
#: index, listed in that market's own currency, that Yahoo carries.
TR_UNAVAILABLE: dict[str, str] = {
    "Korea": "No won-quoted KOSPI fund wired up yet - KODEX 200 (069500.KS) "
             "tracks KOSPI 200 rather than the full index.",
    "India": "No rupee-quoted Nifty 50 fund wired up yet.",
    "Malaysia": "No ringgit-quoted KLCI fund wired up yet.",
}

BENCHMARK_DEFAULT = ("United States", "Europe", "Japan", "Asia ex Japan",
                     "Malaysia")


def benchmarks_present(frame: pd.DataFrame,
                       total_return: bool = False) -> list[Benchmark]:
    """Benchmarks whose column is actually in a frame, in display order."""
    table = TR_BENCHMARKS if total_return else BENCHMARKS
    return [b for b in table if b.column in frame.columns]


# --------------------------------------------------------------------------- #
# Ringgit translation
# --------------------------------------------------------------------------- #

def to_myr(local: pd.Series, region: str, rates: pd.DataFrame) -> pd.Series | None:
    """
    A locally-quoted index expressed in ringgit.

    NOT USED BY ANY PAGE. The dashboard shows every market in its own currency
    by deliberate choice, so nothing calls this today. It is kept, and kept
    tested, because the conversion is easy to get backwards and re-deriving it
    later from scratch is how that mistake gets made.

    index_MYR  =  index_local  x  (USD per local unit)  x  (MYR per USD)

    The two FX legs point in opposite directions in FRED's own data - GBP and
    EUR are published as dollars per unit, the Asian crosses as units per
    dollar - so the direction is taken from the CURRENCY table rather than
    assumed. Getting this backwards produces a chart that looks entirely
    plausible and is inverted, which is why the direction lives in one place.
    """
    spec = CURRENCY.get(region)
    myr_per_usd = rates.get("USD/MYR") if rates is not None else None
    if spec is None or myr_per_usd is None:
        return None
    myr_per_usd = myr_per_usd.dropna()

    if spec.column is None:                      # already USD
        usd_per_unit = pd.Series(1.0, index=myr_per_usd.index)
    else:
        leg = rates.get(spec.column)
        if leg is None:
            return None
        leg = leg.dropna()
        usd_per_unit = leg if spec.usd_per_unit else 1.0 / leg.where(leg != 0)

    joined = pd.concat({"local": local.dropna(),
                        "usd": usd_per_unit,
                        "myr": myr_per_usd}, axis=1).ffill().dropna()
    if joined.empty:
        return None
    out = joined["local"] * joined["usd"] * joined["myr"]
    return out.reindex(local.dropna().index).dropna()


def rebase(series: pd.Series, start=None) -> pd.Series:
    """Index to 100 at the first observation in the window."""
    window = series.dropna()
    if start is not None:
        window = window.loc[pd.Timestamp(start):]
    if window.empty:
        return window
    first = window.iloc[0]
    return window / first * 100.0 if first else window


# --------------------------------------------------------------------------- #
# Build
# --------------------------------------------------------------------------- #

def stale_columns(frame: pd.DataFrame, today=None) -> dict[str, pd.Timestamp]:
    """
    Columns whose last observation is older than their frequency allows.

    The euro-area aggregate froze for five months with no discontinuation flag.
    Nothing failed, nothing warned, and a chart would have kept drawing a flat
    line off the end. This is what catches the next one.
    """
    today = pd.Timestamp(today or pd.Timestamp.today().normalize())
    out = {}
    for column in frame.columns:
        series = frame[column].dropna()
        if series.empty:
            continue
        monthly = column.startswith(OECD_PREFIX)
        limit = STALE_MONTHLY_DAYS if monthly else STALE_DAILY_DAYS
        if (today - series.index.max()).days > limit:
            out[column] = series.index.max()
    return out


# --------------------------------------------------------------------------- #
# Same-market cross-check
# --------------------------------------------------------------------------- #
# Yahoo's 1475.T history prints 8 and 9 Aug 2024 at exactly one tenth of the
# surrounding level (25.23 and 25.51 against ~254) while the Nikkei is flat.
# Rebuilding from a fresh fetch did not clear it - the glitch is in Yahoo's own
# data - and on a rebased chart it draws a two-day collapse that never happened.
#
# This is deliberately NOT an outlier filter. A real crash moves the instrument
# and its reference together and leaves their ratio alone; the 5 Aug 2024
# crash, -12% in a day, passes untouched. Only a day where two series that
# cannot part company suddenly disagree by a multiple is dropped.

#: Instrument -> the series it must move with. Same market only, and the
#: reference must come from a DIFFERENT source, or one bad feed corrupts both
#: and the check sees nothing: 1475.T is Yahoo, NIKKEI225 is FRED.
CROSS_CHECKS: dict[str, str] = {
    "TOPIX": "Nikkei 225",
    "TOPIX TR": "Nikkei 225",
}

#: A day is dropped when instrument / reference sits more than this factor
#: away from that ratio's median over the surrounding month. Measured on the
#: real 2015-2026 history before choosing it: apart from the two glitch days
#: (x0.10), the widest any day strays is x1.12 - and that day, 5 Aug 2024, is
#: itself a bad Yahoo close (-2.2% on the day TOPIX fell ~12%), which this
#: factor deliberately does not reach. The widest clean day is x1.06. Two is a
#: scale error, not a market move - the NT ratio does not double or halve
#: inside a month.
CROSS_CHECK_FACTOR = 2.0

#: The centred window, in observations, that the local ratio is measured over.
#: A glitch run longer than about half of it would drag the median with it and
#: go uncaught. That is the known limit, stated rather than hidden.
CROSS_CHECK_WINDOW = 21


def cross_check(frame: pd.DataFrame
                ) -> tuple[pd.DataFrame, dict[str, list[tuple]]]:
    """
    Drop days where an instrument and its same-market reference disagree by a
    multiple. Returns the cleaned frame and, per column, what was dropped as
    (date, value as served, level the reference implies).

    A day the reference cannot speak to - before it starts, or more than five
    days from its nearest observation - is not judged and is kept.
    """
    out = frame.copy()
    dropped: dict[str, list[tuple]] = {}

    for column, reference in CROSS_CHECKS.items():
        if column not in out.columns or reference not in out.columns:
            continue
        inst, ref = out[column].dropna(), out[reference].dropna()
        if inst.empty or ref.empty:
            continue

        ref_on = ref.reindex(inst.index, method="ffill",
                             tolerance=pd.Timedelta(days=5))
        ratio = (inst / ref_on).where(ref_on > 0)
        local = ratio.rolling(CROSS_CHECK_WINDOW, center=True,
                              min_periods=5).median()
        off = ratio / local
        bad = off.index[(off > CROSS_CHECK_FACTOR)
                        | (off < 1 / CROSS_CHECK_FACTOR)]
        if len(bad):
            dropped[column] = [(day, float(inst[day]),
                                float(local[day] * ref_on[day])) for day in bad]
            out.loc[bad, column] = float("nan")

    return out, dropped


def build_equity(start: str = "1990-01-01", verbose: bool = True) -> pd.DataFrame:
    """Spine, daily officials and Yahoo instruments in one wide frame."""
    parts, problems = [], {}
    for name, call in (
        ("OECD spine", lambda: fetch_oecd(start, verbose)),
        ("FRED daily", lambda: fetch_fred_daily(start, verbose)),
        ("Yahoo quotes", lambda: fetch_quotes(verbose)),
    ):
        try:
            parts.append(call())
        except Exception as exc:      # noqa: BLE001 - one source must not kill the rest
            problems[name] = str(exc)
            if verbose:
                print(f"  [FAIL] {name:<24} {str(exc).splitlines()[0]}")

    if not parts:
        raise EquityError("No equity source returned data. First error:\n  "
                          + next(iter(problems.values()), "unknown"))

    frame = pd.concat(parts, axis=1).sort_index()
    frame = frame.loc[pd.Timestamp(start):]
    frame.index.name = "Date"

    # After the concat, because the instrument (Yahoo) and its reference
    # (FRED) arrive in different parts. Printed, never silent: a dropped day
    # is a claim that the source is wrong, and that claim should be visible.
    frame, dropped = cross_check(frame)
    if verbose:
        for column, rows in dropped.items():
            detail = ", ".join(f"{day:%Y-%m-%d} {value:,.2f} (expected ~{implied:,.2f})"
                               for day, value, implied in rows)
            print(f"  [DROP] {column:<20} {len(rows)} day(s) off "
                  f"{CROSS_CHECKS[column]} by more than {CROSS_CHECK_FACTOR:g}x: "
                  f"{detail}")

    for part in parts:
        problems.update(part.attrs.get("problems", {}))
    frame.attrs["problems"] = problems
    frame.attrs["cross_check"] = dropped
    frame.attrs["stale"] = stale_columns(frame)
    return frame


def describe() -> pd.DataFrame:
    """
    `python refresh.py --equity-check`.

    Prints what Yahoo calls each symbol, the currency it reports, and the
    latest level - which between them make a wrong instrument obvious on
    sight rather than after it has been charted for a week.
    """
    rows = []

    for quote in QUOTES:
        try:
            close, adjusted, label = fetch_quote(quote)
        except EquityError as exc:
            rows.append({"Series": quote.name, "Resolved": "none of: "
                         + ", ".join(quote.symbols), "Ccy": quote.ccy,
                         "Status": "FAIL", "Obs": 0, "From": "", "To": "",
                         "Latest": "",
                         "Detail": str(exc).replace("\n", " ")[:200]})
            continue
        series = adjusted if (quote.name.endswith(" TR")
                              and adjusted is not None) else close
        gap = ""
        if adjusted is not None and len(adjusted) and len(close):
            # How far the two bases have diverged over the whole history - a
            # rough sanity check that Adj Close really is doing something.
            span = (adjusted.index[-1] - adjusted.index[0]).days / 365.25
            if span > 1:
                ratio = float(adjusted.iloc[-1] / adjusted.iloc[0]) \
                    / float(close.iloc[-1] / close.iloc[0])
                gap = f", div ≈ {(ratio ** (1 / span) - 1) * 100:+.1f}%/yr"
        rows.append({
            "Series": quote.name, "Resolved": label, "Ccy": quote.ccy,
            "Status": "ok", "Obs": len(series),
            "From": f"{series.index.min():%Y-%m-%d}",
            "To": f"{series.index.max():%Y-%m-%d}",
            "Latest": f"{series.iloc[-1]:,.2f}",
            "Detail": f"{'total return' if quote.name.endswith(' TR') else 'price'}"
                      f"{gap}",
        })

    for label, getter in (("OECD spine", fetch_oecd), ("FRED daily", fetch_fred_daily)):
        try:
            frame = getter(verbose=False)
        except Exception as exc:      # noqa: BLE001
            rows.append({"Series": label, "Resolved": "fred", "Ccy": "",
                         "Status": "FAIL", "Obs": 0, "From": "", "To": "",
                         "Latest": "",
                         "Detail": str(exc).replace("\n", " ")[:150]})
            continue
        live = frame.dropna(how="all")
        stale = stale_columns(frame)
        rows.append({"Series": label, "Resolved": "fred", "Ccy": "",
                     "Status": "STALE" if stale else "ok",
                     "Obs": len(frame), "From": f"{live.index.min():%Y-%m-%d}",
                     "To": f"{live.index.max():%Y-%m-%d}", "Latest": "",
                     "Detail": (f"stale: {', '.join(stale)}" if stale
                                else f"{frame.shape[1]} columns")})

    return pd.DataFrame(rows)
