"""
Release and decision calendar.
==============================
An event-level diary for the four regions on the desk: US, euro area, Japan,
Malaysia. One row per *number you would actually quote* - Core CPI is its own
line, not a footnote inside "Consumer Price Index".

Named `econ_calendar` rather than `calendar` so it can never shadow the standard
library module of that name, which pandas and plotly both import.

Three tiers of date, and the table never blurs them:

**Live** - dates that come from FRED's own release calendar. For each event with
a FRED series, the release it belongs to is looked up once (`series/release`)
and that release's forward dates are fetched (`release/dates`). Real agency
dates, refreshed on every run, nothing to maintain.

**Confirmed** - central bank decision dates, transcribed from each bank's own
published schedule. Announced a year or more ahead and effectively never moved,
so a checked-in table is the right answer rather than a fragile scrape. COVERAGE
records how far each one runs.

**Estimated** - Japanese and Malaysian statistical releases with no usable
forward calendar. Encoded as windows, never as days, and labelled estimated.

--------------------------------------------------------------------------- #
On the consensus column
--------------------------------------------------------------------------- #

**There is no free source of economist consensus forecasts.** Bloomberg,
Refinitiv, Econoday, MarketWatch and Trading Economics all license theirs, and
FRED carries none. Rather than substitute something that is not consensus and
let it sit under a column heading that says it is, the column is left empty and
this note explains why.

Two honest things can fill it:

1. `CONSENSUS` below is a hand-maintained override, keyed by (event, period).
   Paste the numbers in before an IC meeting and they render like any other
   value, tagged as manual.
2. Model *nowcasts* are free and public - the Cleveland Fed publishes CPI and
   PCE nowcasts, the Atlanta Fed publishes GDPNow. They are not consensus and
   should never be labelled as such, but they are a defensible expectation. Say
   the word and they go in their own clearly-named column.
"""

from __future__ import annotations

import calendar as _stdlib_calendar
import datetime as dt
import time
from dataclasses import dataclass

import numpy as np
import pandas as pd
import requests

from data.fred import FredError, _request, fetch_series

LIVE, CONFIRMED, ESTIMATED, MANUAL = "Live", "Confirmed", "Estimated", "Manual"

REGIONS: tuple[str, ...] = ("US", "Euro area", "Japan", "Malaysia")

#: How far back the table looks. Past rows are what carry actuals, so this is
#: what makes a number appear where a dash used to be on the next refresh.
DEFAULT_LOOKBACK_DAYS = 45
DEFAULT_HORIZON_DAYS = 75

#: A series whose last observation is older than this has stopped publishing.
#: Its event is dropped rather than carried as permanent dashes.
DEAD_SERIES_DAYS = 400

#: How far a reference period may sit behind a release date before the match is
#: implausible. FRED's OECD collections are full of series that quietly stopped
#: updating, and without this the last surviving observation gets printed
#: against every future release date - the euro area unemployment row was
#: showing January 2023 against August 2026.
MAX_PUBLICATION_LAG = {12: 100, 4: 220, 52: 30, 365: 20, 1: 500}

#: A release publishing more often than this is a continuous series, not an
#: event. The ECB deposit facility rate is daily, so FRED had a release date
#: for every business day and it produced 87 of 235 rows.
MIN_DAYS_BETWEEN_RELEASES = 5


class CalendarError(RuntimeError):
    """Raised when the calendar cannot be assembled at all."""


# --------------------------------------------------------------------------- #
# Events
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Event:
    region: str
    name: str                    # as it should read in the table
    series: str = ""             # FRED id the actual comes from
    transform: str = "level"     # level | yoy | mom | diff | qoq_saar
    unit: str = "%"              # % | k | index | pp | count
    schedule: str = "fred"       # fred | window
    series_source: str = "fred"  # fred | estat - where the ACTUAL comes from
    detail: str = ""
    source: str = "FRED"
    # window scheduling, used when schedule == "window"
    day_lo: int = 0
    day_hi: int = 0
    months: tuple[int, ...] = ()
    covers: str = ""

    @property
    def key(self) -> tuple[str, str]:
        """
        Identity is (region, name), never name alone.

        "Unemployment rate" exists for the US, the euro area and Japan, and
        "CPI (YoY)" for the US and Malaysia. Keying anything by name collapses
        them onto one another and quietly shows Japan's number under the US
        row.
        """
        return (self.region, self.name)


#: US. Every ticker here is a headline print, and the transform is the form the
#: number is quoted in - CPI as a year-on-year percentage, payrolls as a monthly
#: change in thousands, not the raw index or level.
US_EVENTS: tuple[Event, ...] = (
    Event("US", "Nonfarm payrolls (chg)", "PAYEMS", "diff", "k",
          detail="Establishment survey, monthly change"),
    Event("US", "Unemployment rate", "UNRATE", "level", "%"),
    Event("US", "Average hourly earnings (YoY)", "CES0500000003", "yoy", "%"),
    Event("US", "CPI (YoY)", "CPIAUCSL", "yoy", "%"),
    Event("US", "CPI (MoM)", "CPIAUCSL", "mom", "%"),
    Event("US", "Core CPI (YoY)", "CPILFESL", "yoy", "%",
          detail="Ex food and energy"),
    Event("US", "PPI final demand (YoY)", "PPIFIS", "yoy", "%"),
    Event("US", "Core PPI (YoY)", "WPSFD4131", "yoy", "%",
          detail="Final demand less foods and energy"),
    Event("US", "PCE price index (YoY)", "PCEPI", "yoy", "%"),
    Event("US", "Core PCE (YoY)", "PCEPILFE", "yoy", "%",
          detail="The Fed's target measure"),
    Event("US", "Personal spending (MoM)", "PCE", "mom", "%"),
    Event("US", "Retail sales (MoM)", "RSAFS", "mom", "%"),
    Event("US", "Real GDP (QoQ SAAR)", "A191RL1Q225SBEA", "level", "%"),
    Event("US", "Industrial production (MoM)", "INDPRO", "mom", "%"),
    Event("US", "Job openings", "JTSJOL", "level", "k", detail="JOLTS"),
    Event("US", "Initial claims", "ICSA", "level", "count", detail="Weekly"),
    Event("US", "U. Michigan sentiment", "UMCSENT", "level", "index"),
    Event("US", "Housing starts", "HOUST", "level", "k", detail="SAAR"),
    Event("US", "SLOOS net % tightening", "DRTSCILM", "level", "%",
          detail="C&I standards, large and middle-market firms"),
)

EURO_EVENTS: tuple[Event, ...] = (
    Event("Euro area", "HICP (YoY)", "CP0000EZ19M086NEST", "yoy", "%",
          detail="Euro area 19 aggregate"),

    # Two events were removed here, both for reasons worth recording.
    #
    # ECBDFR (deposit facility rate) is a DAILY series, so FRED's calendar has
    # a release date for every business day - it produced 87 of 235 rows and
    # buried the actual ECB decision underneath itself. A policy rate is a
    # level that exists every day, not an event. It now appears as the
    # *outcome* on the Governing Council row instead (see Meeting.rate_series).
    #
    # LRHUTTTTEZM156S (euro area unemployment) is an OECD series that stopped
    # updating: it was printing January 2023 against an August 2026 release
    # date, a lag of 1,324 days. The staleness guards below would now catch it,
    # but there is no reason to keep asking for a dead series.
)

#: Japan and Malaysia. FRED's coverage of both is thin and much of what exists
#: comes through OECD collections that have been discontinued, so the series
#: here are best-effort: `refresh.py --audit-events` is what proves which of
#: them actually resolve. A row whose series fails still carries its date.
JAPAN_EVENTS: tuple[Event, ...] = (
    # Actuals come from e-Stat, not FRED. FRED carried these via OECD
    # collections that stopped updating; e-Stat is the Statistics Bureau's own
    # portal. Their FRED tickers are gone rather than left in place, so nothing
    # silently falls back to a dead series.
    Event("Japan", "CPI (nationwide, YoY)", "", "level", "%",
          schedule="window", series_source="estat",
          day_lo=18, day_hi=26, covers="previous month",
          source="Statistics Bureau of Japan · e-Stat"),
    Event("Japan", "CPI (Tokyo, advance)", "", "level", "%",
          schedule="window", series_source="estat",
          day_lo=24, day_hi=31, covers="current month",
          detail="Leads the nationwide print by about three weeks",
          source="Statistics Bureau of Japan · e-Stat"),
    Event("Japan", "Unemployment rate", "", "level", "%",
          schedule="window", series_source="estat",
          day_lo=26, day_hi=31, covers="previous month",
          source="Statistics Bureau of Japan · e-Stat"),

    # GDP, the trade balance and the Tankan were removed rather than left as
    # permanent dashes.
    #
    # GDP: the right table exists but every copy is frozen at 2018 in an old
    # price base, and the live one is not reachable through the catalogue
    # search. Trade sits with Customs under a different code, and the Tankan
    # is not on e-Stat at all - the BoJ publishes it on its own site.
)

MALAYSIA_EVENTS: tuple[Event, ...] = (
    Event("Malaysia", "CPI (YoY)", "", "yoy", "%",
          schedule="window", series_source="dosm",
          day_lo=20, day_hi=25, covers="previous month",
          source="DOSM · OpenDOSM API"),
    Event("Malaysia", "External trade", "", "level", "rm",
          schedule="window", series_source="dosm",
          day_lo=18, day_hi=22, covers="previous month",
          source="DOSM · OpenDOSM API"),
    Event("Malaysia", "Industrial Production Index", "", "yoy", "%",
          schedule="window", series_source="dosm",
          day_lo=9, day_hi=13, covers="previous month",
          source="DOSM · OpenDOSM API"),
    Event("Malaysia", "Labour force / unemployment", "", "level", "%",
          schedule="window", series_source="dosm",
          day_lo=6, day_hi=12, covers="previous month",
          source="DOSM · OpenDOSM API"),
    Event("Malaysia", "GDP and balance of payments", "", "yoy", "%",
          schedule="window", series_source="dosm",
          day_lo=13, day_hi=17, months=(2, 5, 8, 11), covers="previous quarter",
          detail="Released jointly with BNM's quarterly briefing",
          source="DOSM · OpenDOSM API"),
)

EVENTS: tuple[Event, ...] = US_EVENTS + EURO_EVENTS + JAPAN_EVENTS + MALAYSIA_EVENTS


#: Hand-maintained consensus, keyed by (region, event name, reference period).
#: Nothing populates this automatically - see the note at the top of the file.
#:
#:     CONSENSUS = {
#:         ("US", "Core CPI (YoY)", "2026-08"): "3.0%",
#:         ("US", "Nonfarm payrolls (chg)", "2026-08"): "+75k",
#:     }
CONSENSUS: dict[tuple[str, str, str], str] = {}


# --------------------------------------------------------------------------- #
# Central bank decisions
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class Meeting:
    region: str
    event: str
    date: str          # the decision day, not day one of the meeting
    detail: str = ""
    source: str = ""


#: The rate each decision sets, so a past meeting can show what it did rather
#: than a dash. This is what the daily policy-rate rows should have been all
#: along: one number on the day it was decided, not 87 rows of the same level.
POLICY_RATE: dict[str, tuple[str, str]] = {
    "US": ("DFEDTARU", "fed funds target, upper bound"),
    "Euro area": ("ECBDFR", "deposit facility rate"),
}

#: Days after a decision to read the rate. Central banks announce on the day
#: but the new rate is usually effective a few days later, so reading it on the
#: announcement date returns the OLD rate.
RATE_EFFECTIVE_LAG = 10


_FOMC_SRC = "federalreserve.gov/monetarypolicy/fomccalendars.htm"
_ECB_SRC = "ecb.europa.eu/press/calendars/mgcgc"
_BOJ_SRC = "boj.or.jp/en/mopo/mpmsche_minu"
_BNM_SRC = "bnm.gov.my/mpc-meeting-schedule"

#: Verified against the four pages above on 2026-09-10.
MEETINGS: tuple[Meeting, ...] = (
    Meeting("US", "FOMC decision", "2026-09-16", "with Summary of Economic Projections", _FOMC_SRC),
    Meeting("US", "FOMC decision", "2026-10-28", "", _FOMC_SRC),
    Meeting("US", "FOMC decision", "2026-12-09", "with Summary of Economic Projections", _FOMC_SRC),
    Meeting("US", "FOMC decision", "2027-01-27", "", _FOMC_SRC),
    Meeting("US", "FOMC decision", "2027-03-17", "with Summary of Economic Projections", _FOMC_SRC),
    Meeting("US", "FOMC decision", "2027-04-28", "", _FOMC_SRC),
    Meeting("US", "FOMC decision", "2027-06-09", "with Summary of Economic Projections", _FOMC_SRC),
    Meeting("US", "FOMC decision", "2027-07-28", "", _FOMC_SRC),
    Meeting("US", "FOMC decision", "2027-09-15", "with Summary of Economic Projections", _FOMC_SRC),
    Meeting("US", "FOMC decision", "2027-10-27", "", _FOMC_SRC),
    Meeting("US", "FOMC decision", "2027-12-08", "with Summary of Economic Projections", _FOMC_SRC),

    Meeting("Euro area", "ECB Governing Council", "2026-09-10", "Berlin", _ECB_SRC),
    Meeting("Euro area", "ECB Governing Council", "2026-10-29", "", _ECB_SRC),
    Meeting("Euro area", "ECB Governing Council", "2026-12-17", "", _ECB_SRC),
    Meeting("Euro area", "ECB Governing Council", "2027-02-04", "", _ECB_SRC),
    Meeting("Euro area", "ECB Governing Council", "2027-03-18", "", _ECB_SRC),
    Meeting("Euro area", "ECB Governing Council", "2027-04-29", "", _ECB_SRC),
    Meeting("Euro area", "ECB Governing Council", "2027-06-10", "", _ECB_SRC),
    Meeting("Euro area", "ECB Governing Council", "2027-07-22", "", _ECB_SRC),
    Meeting("Euro area", "ECB Governing Council", "2027-09-09", "", _ECB_SRC),
    Meeting("Euro area", "ECB Governing Council", "2027-10-28", "", _ECB_SRC),
    Meeting("Euro area", "ECB Governing Council", "2027-12-16", "", _ECB_SRC),

    Meeting("Japan", "BoJ policy decision", "2026-09-18", "", _BOJ_SRC),
    Meeting("Japan", "BoJ policy decision", "2026-10-30", "with Outlook Report", _BOJ_SRC),
    Meeting("Japan", "BoJ policy decision", "2026-12-18", "", _BOJ_SRC),
    Meeting("Japan", "BoJ policy decision", "2027-01-22", "with Outlook Report", _BOJ_SRC),
    Meeting("Japan", "BoJ policy decision", "2027-03-18", "", _BOJ_SRC),
    Meeting("Japan", "BoJ policy decision", "2027-04-28", "with Outlook Report", _BOJ_SRC),
    Meeting("Japan", "BoJ policy decision", "2027-06-11", "", _BOJ_SRC),
    Meeting("Japan", "BoJ policy decision", "2027-07-22", "with Outlook Report", _BOJ_SRC),
    Meeting("Japan", "BoJ policy decision", "2027-09-22", "", _BOJ_SRC),
    Meeting("Japan", "BoJ policy decision", "2027-10-29", "with Outlook Report", _BOJ_SRC),
    Meeting("Japan", "BoJ policy decision", "2027-12-17", "", _BOJ_SRC),

    Meeting("Malaysia", "BNM MPC decision", "2026-11-05", "OPR statement 3:00pm MYT", _BNM_SRC),
)

COVERAGE: dict[str, tuple[str, str]] = {
    "US": ("2027-12-08", _FOMC_SRC),
    "Euro area": ("2027-12-16", _ECB_SRC),
    "Japan": ("2027-12-17", _BOJ_SRC),
    "Malaysia": ("2026-11-05", _BNM_SRC),
}

VERIFIED_ON = "2026-09-10"

COLUMNS = ["Date", "Region", "Event", "Actual", "Consensus",
           "Period", "Kind", "Confidence", "Detail", "Source", "Window end"]


# --------------------------------------------------------------------------- #
# Actuals
# --------------------------------------------------------------------------- #

def apply_transform(series: pd.Series, transform: str) -> pd.Series:
    """Turn a raw FRED series into the form the number is quoted in."""
    clean = series.dropna()
    if clean.empty:
        return clean
    if transform == "yoy":
        step = _periods_per_year(clean)
        return (clean / clean.shift(step) - 1.0) * 100.0
    if transform == "mom":
        return (clean / clean.shift(1) - 1.0) * 100.0
    if transform == "diff":
        return clean.diff()
    if transform == "qoq_saar":
        return ((clean / clean.shift(1)) ** 4 - 1.0) * 100.0
    return clean


def _periods_per_year(series: pd.Series) -> int:
    """Infer the shift a year-on-year change needs from the index spacing."""
    if len(series) < 3:
        return 12
    gap = series.index.to_series().diff().dt.days.median()
    if gap <= 10:
        return 52
    if gap <= 45:
        return 12
    if gap <= 120:
        return 4
    return 1


def is_signed(event: Event) -> bool:
    """
    Should the number carry an explicit sign?

    A change reads wrong without one - "150k" and "-150k" for payrolls, or
    "0.3%" and "-0.3%" for a monthly CPI, sit very differently on the eye. A
    level does not need it: nobody writes "+4.1%" for an unemployment rate.
    """
    return event.transform in {"diff", "mom", "qoq_saar"}


def format_value(value: float | None, unit: str, signed: bool = False) -> str:
    if value is None or pd.isna(value):
        return "—"
    sign = "+" if signed else ""
    if unit == "%":
        return f"{value:{sign}.1f}%"
    if unit == "pp":
        return f"{value:{sign}.2f} pp"
    if unit == "k":
        return f"{value:{sign},.0f}k"
    if unit == "rm":
        return f"-RM {abs(value):,.1f}b" if value < 0 else f"RM {value:,.1f}b"
    if unit == "count":
        return f"{value:{sign},.0f}"
    return f"{value:{sign},.1f}"


def fetch_actuals(events: tuple[Event, ...], start: str = "2015-01-01",
                  verbose: bool = True) -> dict[tuple[str, str], pd.Series]:
    """
    Transformed series for every event that has one, keyed by (region, name).

    A ticker that fails is reported and skipped - one retired series should
    never cost the whole calendar its dates.
    """
    out: dict[tuple[str, str], pd.Series] = {}
    seen: dict[str, pd.Series] = {}

    for event in events:
        if not event.series or event.series_source != "fred" or event.key in out:
            continue
        try:
            if event.series not in seen:
                seen[event.series] = fetch_series(event.series, start=start)
                time.sleep(0.1)
            raw = seen[event.series]
        except (FredError, requests.RequestException) as exc:
            if verbose:
                print(f"  [skip] {event.name:<32} {event.series:<20} {exc}")
            continue

        values = apply_transform(raw, event.transform).dropna()
        if values.empty:
            if verbose:
                print(f"  [skip] {event.name:<32} {event.series:<20} "
                      "no observations after transform")
            continue

        age = (pd.Timestamp.today() - period_ends(values)[-1]).days
        if age > DEAD_SERIES_DAYS:
            if verbose:
                print(f"  [DEAD] {event.name:<32} {event.series:<20} "
                      f"last observation {values.index[-1]:%Y-%m}, "
                      f"{age} days old — dropping this event")
            continue
        out[event.key] = values
        if verbose:
            latest = format_value(float(values.iloc[-1]), event.unit, is_signed(event))
            print(f"  [ok]   {event.name:<32} {event.series:<20} "
                  f"latest {latest:>10} ({values.index[-1]:%Y-%m})")
    return out


def period_ends(values: pd.Series) -> pd.DatetimeIndex:
    """
    The last day each observation covers.

    FRED stamps a monthly observation on the FIRST of the month, so August's
    CPI is indexed 2026-08-01. That is not the day it was published and it is
    not even inside the published window - the month has to finish first.
    """
    per_year = _periods_per_year(values)
    if per_year == 12:
        return values.index + pd.offsets.MonthEnd(0)
    if per_year == 4:
        return values.index + pd.offsets.QuarterEnd(0)
    if per_year == 1:
        return values.index + pd.offsets.YearEnd(0)
    return values.index          # weekly and daily are already period-end


def _max_lag(values: pd.Series) -> int:
    return MAX_PUBLICATION_LAG.get(_periods_per_year(values), 200)


def _isolated(label: str, fetcher, verbose: bool
              ) -> dict[tuple[str, str], pd.Series]:
    """
    Run one source's fetcher, swallowing anything it throws.

    Deliberately catches bare Exception. These are third-party JSON APIs whose
    shapes are not under our control, and a KeyError deep in a parser should
    cost that source its rows rather than take the calendar down - which is
    exactly what happened: the build threw, the refresh caught it, and the
    stale cache stayed on the dashboard looking current.
    """
    if verbose:
        print(f"\n  {label}")
    try:
        return fetcher(verbose=verbose)
    except Exception as exc:  # noqa: BLE001
        if verbose:
            import traceback
            print(f"  [SKIP] {label} — {type(exc).__name__}: {exc}")
            print("         " + traceback.format_exc().strip().replace(
                "\n", "\n         ")[-700:])
        return {}


def fetch_estat_actuals(verbose: bool = True) -> dict[tuple[str, str], pd.Series]:
    """
    Japanese actuals from e-Stat.

    Isolated behind its own try/except for the same reason the OFR block is:
    a second API is a second thing that can be down, and the rest of the
    calendar must not care.
    """
    try:
        from data.estat import EStatError, JAPAN_SPECS, fetch_spec
    except ImportError as exc:          # pragma: no cover
        if verbose:
            print(f"  [SKIP] e-Stat — {exc}")
        return {}

    out: dict[tuple[str, str], pd.Series] = {}
    failed: list[str] = []
    for spec in JAPAN_SPECS:
        try:
            series, _ = fetch_spec(spec, verbose=verbose)
        except Exception as exc:  # noqa: BLE001 - one series, not the source
            failed.append(f"{spec.name}: {exc}")
            if verbose:
                print(f"  [SKIP] e-Stat {spec.name} — {exc}")
            continue
        values = apply_transform(series, spec.transform).dropna()
        if values.empty:
            continue
        out[("Japan", spec.name)] = values
        if verbose:
            print(f"  [ok]   e-Stat {spec.name:<26} "
                  f"latest {format_value(float(values.iloc[-1]), spec.unit):>8} "
                  f"({values.index[-1]:%Y-%m})")

    # A banner, not another [SKIP] line among fifty. Japanese rows going blank
    # is otherwise indistinguishable from them simply not being published yet,
    # and the reason scrolls past unread.
    if failed and verbose:
        print("\n  " + "!" * 70)
        print(f"  {len(failed)} Japanese series did NOT resolve — their calendar "
              "rows will be blank:")
        for line in failed:
            print(f"    - {line[:160]}")
        print("  Diagnose with:  python refresh.py --estat-check")
        print("  " + "!" * 70 + "\n")
    return out


def fetch_malaysia_actuals(verbose: bool = True
                           ) -> dict[tuple[str, str], pd.Series]:
    """
    Malaysian actuals from OpenDOSM and Bank Negara.

    Same isolation as e-Stat: a third API is a third thing that can be down,
    and the rest of the calendar must not notice.
    """
    try:
        from data.malaysia import MALAYSIA_SPECS, MalaysiaError, fetch_spec
    except ImportError as exc:              # pragma: no cover
        if verbose:
            print(f"  [SKIP] Malaysia — {exc}")
        return {}

    out: dict[tuple[str, str], pd.Series] = {}
    failed: list[str] = []
    for spec in MALAYSIA_SPECS:
        try:
            series = fetch_spec(spec, verbose=verbose)
        except Exception as exc:  # noqa: BLE001 - one series, not the source
            failed.append(f"{spec.name}: {exc}")
            if verbose:
                print(f"  [SKIP] {spec.source} {spec.name} — {str(exc)[:150]}")
            continue
        values = apply_transform(series, spec.transform).dropna()
        if not values.empty:
            out[("Malaysia", spec.name)] = values

    if failed and verbose:
        print("\n  " + "!" * 70)
        print(f"  {len(failed)} Malaysian series did NOT resolve — their rows "
              "are dropped:")
        for line in failed:
            print(f"    - {line[:160]}")
        print("  Diagnose with:  python refresh.py --my-check")
        print("  " + "!" * 70 + "\n")
    return out


def actual_before(values: pd.Series | None, when: pd.Timestamp) -> tuple:
    """
    The observation a release on `when` would have published.

    Compares against the period END, not the index date. Using the index date
    reads August's number as published on 12 August - a month that has not
    finished - and so reports every mid-month release one period too new.
    """
    if values is None or values.empty:
        return None, None
    ends = period_ends(values)
    published = np.asarray(ends < pd.Timestamp(when))
    if not published.any():
        return None, None
    position = int(np.flatnonzero(published)[-1])

    # Reject an implausibly old match. A release publishes recent data; if the
    # newest observation before it is a year stale, the series has stopped
    # updating and this is not the number that release put out.
    lag = (pd.Timestamp(when) - ends[position]).days
    if lag > _max_lag(values):
        return None, None
    return float(values.iloc[position]), values.index[position]


# --------------------------------------------------------------------------- #
# Dates from FRED's release calendar
# --------------------------------------------------------------------------- #

def _release_for(series_id: str) -> int | None:
    payload = _request("series/release", {"series_id": series_id})
    rows = payload.get("releases", [])
    return int(rows[0]["id"]) if rows else None


def _release_dates(release_id: int, start: dt.date, end: dt.date) -> list[dt.date]:
    payload = _request("release/dates", {
        "release_id": release_id,
        "realtime_start": start.isoformat(),
        "realtime_end": end.isoformat(),
        "include_release_dates_with_no_data": "true",
        "sort_order": "asc", "limit": 200,
    })
    dates = []
    for entry in payload.get("release_dates", []):
        try:
            dates.append(dt.date.fromisoformat(entry["date"]))
        except (KeyError, ValueError):
            continue
    return dates


def fetch_fred_dates(events: tuple[Event, ...], lookback_days: int,
                     horizon_days: int, verbose: bool = True
                     ) -> dict[tuple[str, str], list[dt.date]]:
    """
    Release dates per event, from FRED.

    Deliberately one lookup per *release* rather than one page through every
    release FRED has. CPI and Core CPI share a release, so the work is bounded
    by the number of distinct releases (about ten) and each call is small. The
    previous approach paged the whole calendar and stalled.
    """
    today = dt.date.today()
    start, end = today - dt.timedelta(days=lookback_days), today + dt.timedelta(days=horizon_days)

    release_of: dict[str, int] = {}
    dates_of: dict[int, list[dt.date]] = {}
    out: dict[tuple[str, str], list[dt.date]] = {}
    failures = 0

    for event in events:
        if event.schedule != "fred" or not event.series:
            continue
        try:
            if event.series not in release_of:
                rid = _release_for(event.series)
                if rid is None:
                    raise FredError("no release attached to this series")
                release_of[event.series] = rid
                time.sleep(0.1)
            rid = release_of[event.series]

            if rid not in dates_of:
                found = _release_dates(rid, start, end)
                span = (end - start).days
                if len(found) > 1 and span / len(found) < MIN_DAYS_BETWEEN_RELEASES:
                    if verbose:
                        print(f"  [skip] {event.name:<32} its release publishes "
                              f"{len(found)} times in {span} days — that is a "
                              "continuous series, not an event")
                    found = []
                dates_of[rid] = found
                time.sleep(0.1)
        except (FredError, requests.RequestException) as exc:
            failures += 1
            if verbose:
                print(f"  [skip] {event.name:<32} release lookup — {exc}")
            if failures >= 4:
                if verbose:
                    print("  [stop] four release lookups failed in a row; "
                          "leaving the rest to the estimated windows.")
                break
            continue

        if dates_of[rid]:
            out[event.key] = dates_of[rid]

    if verbose:
        print(f"  [ok]   FRED release calendar  {len(dates_of)} releases, "
              f"{sum(len(v) for v in dates_of.values())} dates "
              f"between {start} and {end}")
    return out


# --------------------------------------------------------------------------- #
# Windows, for the events with no published forward calendar
# --------------------------------------------------------------------------- #

def _clamp_day(year: int, month: int, day: int) -> dt.date:
    last = _stdlib_calendar.monthrange(year, month)[1]
    return dt.date(year, month, min(day, last))


def window_dates(event: Event, start: dt.date, months_ahead: int
                 ) -> list[tuple[dt.date, dt.date]]:
    spans = []
    cursor = dt.date(start.year, start.month, 1)
    for _ in range(months_ahead + 2):
        if not event.months or cursor.month in event.months:
            lo = _clamp_day(cursor.year, cursor.month, event.day_lo)
            hi = _clamp_day(cursor.year, cursor.month, event.day_hi)
            if hi >= start:
                spans.append((lo, hi))
        cursor = (pd.Timestamp(cursor) + pd.DateOffset(months=1)).date()
    return spans


# --------------------------------------------------------------------------- #
# Assembly
# --------------------------------------------------------------------------- #

def _row(date, region, name, actual, consensus, period, kind, confidence,
         detail, source, window_end=pd.NaT) -> dict:
    return {"Date": pd.Timestamp(date), "Region": region, "Event": name,
            "Actual": actual, "Consensus": consensus, "Period": period,
            "Kind": kind, "Confidence": confidence, "Detail": detail,
            "Source": source, "Window end": pd.Timestamp(window_end)}


def _consensus_for(key: tuple[str, str], period: pd.Timestamp | None) -> str:
    if period is None:
        return "—"
    region, name = key
    return CONSENSUS.get((region, name, f"{period:%Y-%m}"), "—")


def meetings_frame(lookback: dt.date, horizon: dt.date,
                   verbose: bool = True) -> pd.DataFrame:
    """Policy decisions, with the resulting rate on any meeting already held."""
    today = dt.date.today()
    wanted = [m for m in MEETINGS
              if lookback <= dt.date.fromisoformat(m.date) <= horizon]

    rates: dict[str, pd.Series] = {}

    # Malaysia's policy rate comes from BNM, not FRED, so the MPC row can show
    # the OPR it set the same way the FOMC and ECB rows show theirs.
    if any(m.region == "Malaysia" for m in wanted):
        try:
            from data.malaysia import MalaysiaError, fetch_opr_history
            rates["Malaysia"] = fetch_opr_history(verbose=verbose)
        except Exception as exc:  # noqa: BLE001 - never block the calendar
            if verbose:
                print(f"  [skip] BNM OPR — {str(exc)[:140]}")

    for region in {m.region for m in wanted if m.region in POLICY_RATE}:
        series_id, _ = POLICY_RATE[region]
        try:
            rates[region] = fetch_series(series_id, start="2000-01-01").dropna()
            time.sleep(0.1)
        except (FredError, requests.RequestException) as exc:
            if verbose:
                print(f"  [skip] {region} policy rate {series_id} — {exc}")

    rows = []
    for m in wanted:
        date = dt.date.fromisoformat(m.date)
        actual, detail = "—", m.detail
        if date <= today and m.region in rates:
            series = rates[m.region]
            asof = pd.Timestamp(date) + pd.Timedelta(days=RATE_EFFECTIVE_LAG)
            # The series must actually reach the decision. Capping the lookup
            # at the last observation would otherwise report the rate from
            # whenever the series stopped as though the meeting had set it -
            # the same failure that put January 2023 on an August 2026 row.
            prior = (series.loc[:asof] if series.index.max() >= pd.Timestamp(date)
                     else pd.Series(dtype="float64"))
            if not prior.empty:
                label = POLICY_RATE.get(m.region, ("", "OPR"))[1]
                actual = f"{float(prior.iloc[-1]):.2f}%"
                detail = " · ".join(x for x in (m.detail, label) if x)
        rows.append(_row(m.date, m.region, m.event, actual, "—", None,
                         "Policy", CONFIRMED, detail, m.source))
    return pd.DataFrame(rows, columns=COLUMNS)


def build_calendar(lookback_days: int = DEFAULT_LOOKBACK_DAYS,
                   horizon_days: int = DEFAULT_HORIZON_DAYS,
                   verbose: bool = True) -> pd.DataFrame:
    """
    Everything, one table.

    Built offline-first: the policy dates and the estimated windows need no
    network at all, so a FRED outage costs the calendar its US actuals and
    nothing else.
    """
    today = dt.date.today()
    lookback = today - dt.timedelta(days=lookback_days)
    horizon = today + dt.timedelta(days=horizon_days)
    months_ahead = horizon_days // 30 + 1

    parts: list[pd.DataFrame] = [meetings_frame(lookback, horizon, verbose)]

    # ---- actuals, fetched BEFORE the window rows are built ------------------
    # This ordering is the fix for a real bug: the window rows used to be
    # assembled first and hard-coded to "—", so a Japanese or Malaysian event
    # that DID have a live FRED series still never showed its number. Only the
    # FRED-scheduled rows were ever given one.
    actuals: dict[tuple[str, str], pd.Series] = {}
    try:
        if verbose:
            print("\n  Actuals")
        actuals = fetch_actuals(EVENTS, verbose=verbose)
    except Exception as exc:  # noqa: BLE001 - see _isolated below
        if verbose:
            print(f"  [SKIP] FRED actuals — {type(exc).__name__}: {exc}")

    # Each source is isolated. Four APIs means four things that can be down or
    # change shape, and one of them failing must cost only its own rows - not
    # the whole calendar, and above all not silently, leaving yesterday's cache
    # in place looking current.
    actuals.update(_isolated("Japan (e-Stat)", fetch_estat_actuals, verbose))
    actuals.update(_isolated("Malaysia (OpenDOSM + BNM)",
                             fetch_malaysia_actuals, verbose))

    # An event sourced from e-Stat or OpenDOSM whose spec did not resolve has
    # no number and never will on this refresh, so its rows are dropped rather
    # than left as permanent dashes.
    #
    # This must be computed HERE, above the window rows that read it. It used
    # to live further down beside the FRED block; moving the window rows above
    # that block left the reference pointing at a name that did not exist yet,
    # and the whole calendar build died on an UnboundLocalError.
    unresolved = {e.key for e in EVENTS
                  if e.series_source in ("estat", "dosm")
                  and e.key not in actuals}

    # ---- windowed events ----------------------------------------------------
    window_rows = []
    for event in EVENTS:
        if event.schedule != "window":
            continue
        if event.key in unresolved:
            continue
        values = actuals.get(event.key)
        for lo, hi in window_dates(event, lookback, months_ahead):
            if lo > horizon:
                continue
            detail = " · ".join(x for x in (f"covers {event.covers}" if event.covers
                                            else "", event.detail) if x)
            # The release lands somewhere inside the window, so the number it
            # published is the last one whose period ended before the window
            # opened. actual_before applies the same staleness ceiling it
            # applies everywhere else.
            value, period = (None, None)
            if values is not None and lo <= today:
                value, period = actual_before(values, pd.Timestamp(lo))
            window_rows.append(_row(
                lo, event.region, event.name,
                format_value(value, event.unit, is_signed(event))
                if value is not None else "—",
                _consensus_for(event.key, period),
                period, "Data", ESTIMATED, detail, event.source, hi))
    parts.append(pd.DataFrame(window_rows, columns=COLUMNS))

    # ---- FRED-scheduled events ---------------------------------------------
    fred_rows = []
    try:
        if verbose:
            print("\n  Release dates")
        dates_by_event = fetch_fred_dates(EVENTS, lookback_days, horizon_days,
                                          verbose=verbose)
    except (FredError, requests.RequestException) as exc:
        dates_by_event = {}
        if verbose:
            print(f"  [SKIP] release calendar — {exc}")

    by_key = {e.key: e for e in EVENTS}

    live = set(actuals)
    for key, dates in dates_by_event.items():
        event = by_key[key]
        # An event whose series was dropped as dead has no number to show and
        # no reason to occupy a row.
        if event.series and key not in live:
            continue
        for date in dates:
            stamp = pd.Timestamp(date)
            value, period = actual_before(actuals.get(key), stamp)
            published = date <= today
            fred_rows.append(_row(
                date, event.region, event.name,
                (format_value(value, event.unit, is_signed(event))
                 if published else "—"),
                _consensus_for(key, period if published else None),
                period, "Data", LIVE, event.detail, "FRED release calendar"))
    parts.append(pd.DataFrame(fred_rows, columns=COLUMNS))

    populated = [p for p in parts if not p.empty]
    if not populated:
        raise CalendarError(
            "Every source produced nothing — even the policy dates, which need "
            "no network. That is a code fault, not an outage.")
    frame = pd.concat(populated, ignore_index=True)
    frame["Date"] = pd.to_datetime(frame["Date"])
    frame["Window end"] = pd.to_datetime(frame["Window end"])
    frame["Period"] = pd.to_datetime(frame["Period"])
    frame = (frame.sort_values(["Date", "Region", "Event"])
                  .drop_duplicates(subset=["Date", "Region", "Event"])
                  .reset_index(drop=True))
    frame.attrs["verified_on"] = VERIFIED_ON
    return frame


def date_only_events(region: str | None = None) -> list[tuple[str, str]]:
    """
    Events with no FRED series behind them - date, no number, ever.

    Worth surfacing rather than leaving as an unexplained column of dashes.
    FRED's coverage of Japan and Malaysia is thin, and most of what exists
    arrives through OECD collections that have been discontinued, so for these
    the calendar can tell you *when* to look but not *what* was printed.
    """
    return [(e.region, e.name) for e in EVENTS
            if not e.series and e.series_source == "fred"
            and (region is None or e.region == region)]


def coverage_warnings(today: dt.date | None = None,
                      within_days: int = 75) -> list[str]:
    """Which transcribed schedules are about to run out."""
    today = today or dt.date.today()
    notes = []
    for region, (last, source) in COVERAGE.items():
        remaining = (dt.date.fromisoformat(last) - today).days
        if remaining < 0:
            notes.append(
                f"**{region}** — the policy schedule on file ended {last}. "
                f"Check {source} and update `data/econ_calendar.py`.")
        elif remaining <= within_days:
            notes.append(
                f"**{region}** — policy dates on file run out on {last} "
                f"({remaining} days). The next year is usually published a few "
                f"months ahead at {source}.")
    return notes


# --------------------------------------------------------------------------- #
# Audit
# --------------------------------------------------------------------------- #

def audit_events(verbose: bool = True) -> int:
    """
    Check every event's ticker against live FRED.

    Worth its own command because the non-US tickers in particular are
    best-effort: FRED's coverage of Japan and Malaysia leans on OECD
    collections, several of which have been discontinued. This says which ones
    are real rather than letting a dead series show up as a permanent dash.
    """
    from data.fred import series_meta

    print(f"\n  {'EVENT':<34} {'SERIES':<20} {'FREQ':<6} {'LAST':<12} STATUS")
    print("  " + "-" * 96)

    problems = 0
    for event in EVENTS:
        if not event.series:
            print(f"  {event.name:<34} {'—':<20} {'—':<6} {'—':<12} "
                  "no series (date only, by design)")
            continue
        try:
            meta = series_meta(event.series)
        except (FredError, requests.RequestException) as exc:
            print(f"  {event.name:<34} {event.series:<20} {'—':<6} {'—':<12} "
                  f"UNRESOLVED — {exc}")
            problems += 1
            continue

        last = meta.get("observation_end", "?")
        freq = meta.get("frequency_short", "?")
        stale = ""
        try:
            age = (dt.date.today() - dt.date.fromisoformat(last)).days
            if age > 200:
                stale = f"  STALE ({age} days old)"
                problems += 1
        except ValueError:
            pass
        print(f"  {event.name:<34} {event.series:<20} {freq:<6} {last:<12} "
              f"ok{stale}")
        time.sleep(0.08)

    print()
    if problems:
        print(f"{problems} event ticker(s) unresolved or stale. Tell me which "
              "and I will find replacements or drop the row.")
        return 1
    print("Every event ticker resolves and is current.")
    return 0
