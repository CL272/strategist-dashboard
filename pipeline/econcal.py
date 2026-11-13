"""
Economic calendar: releases and central bank decisions, with the actual printed
(past events) and the previous reading (upcoming events).

Ported from the earlier Streamlit version (legacy/data/econ_calendar.py) and widened
to Singapore, Australia, China, Korea, Taiwan, India and the UK.

Three kinds of date, never blurred:
  Live       US releases: dates from FRED's own release calendar (release/dates).
  Confirmed  Central bank decisions, transcribed from each bank's published schedule.
  Estimated  Asian statistical releases with no machine-readable forward calendar,
             encoded as a window ("between the 20th and 25th"), never as a day.

There is no free source of economist consensus forecasts, so there is no consensus
column (see the legacy file for the reasoning).

Writes docs/data/calendar.json. Times are converted to Singapore/Malaysia time (UTC+8).
"""
from __future__ import annotations

import calendar as _cal
import datetime as dt
import time
from zoneinfo import ZoneInfo

import pandas as pd

from fetch import DIAG, fetch_fred, get, load_existing, unpack, write

LOOKBACK_DAYS, HORIZON_DAYS = 21, 75
SGT = ZoneInfo("Asia/Singapore")
TZ = {"ET": "America/New_York", "CET": "Europe/Berlin", "JST": "Asia/Tokyo", "MYT": "Asia/Kuala_Lumpur", "SGT": "Asia/Singapore",
      "SYD": "Australia/Sydney", "UK": "Europe/London", "CST": "Asia/Shanghai", "KST": "Asia/Seoul", "TPE": "Asia/Taipei", "IST": "Asia/Kolkata"}
FRED_API = "https://api.stlouisfed.org/fred/{path}"

# ---------------------------------------------------------------- data releases
# value = (source, id, transform): source 'fred' (FRED code) or 'asia' (dashboard id from asia.json)
# sched = ('fred', FRED code whose release calendar gives the dates) or ('win', day_lo, day_hi, months or None, covers)
# t = (time zone, "HH:MM") of the usual release time, or None
def ev(region, name, value, unit, sched, t=None, hi=False, detail="", src=""):
    return dict(region=region, name=name, value=value, unit=unit, sched=sched, t=t, hi=hi, detail=detail, src=src)


Q_MID = (2, 5, 8, 11)     # month after quarter-end + 1
Q_NEXT = (1, 4, 7, 10)    # month after quarter-end
EVENTS = [
    # ---- United States (dates live from FRED)
    ev("US", "Nonfarm payrolls (chg)", ("fred", "PAYEMS", "diff"), "k", ("fred", "PAYEMS"), ("ET", "08:30"), True, "Employment Situation"),
    ev("US", "Unemployment rate", ("fred", "UNRATE", "level"), "%", ("fred", "UNRATE"), ("ET", "08:30"), True),
    ev("US", "Average hourly earnings (YoY)", ("fred", "CES0500000003", "yoy"), "%", ("fred", "CES0500000003"), ("ET", "08:30")),
    ev("US", "CPI (YoY)", ("fred", "CPIAUCSL", "yoy"), "%", ("fred", "CPIAUCSL"), ("ET", "08:30"), True),
    ev("US", "Core CPI (MoM)", ("fred", "CPILFESL", "mom"), "%", ("fred", "CPILFESL"), ("ET", "08:30"), True, "Ex food and energy"),
    ev("US", "Core CPI (YoY)", ("fred", "CPILFESL", "yoy"), "%", ("fred", "CPILFESL"), ("ET", "08:30"), True),
    ev("US", "PPI final demand (YoY)", ("fred", "PPIFIS", "yoy"), "%", ("fred", "PPIFIS"), ("ET", "08:30")),
    ev("US", "Core PCE (YoY)", ("fred", "PCEPILFE", "yoy"), "%", ("fred", "PCEPILFE"), ("ET", "08:30"), True, "The Fed's target measure"),
    ev("US", "Personal spending (MoM)", ("fred", "PCE", "mom"), "%", ("fred", "PCE"), ("ET", "08:30")),
    ev("US", "Retail sales (MoM)", ("fred", "RSAFS", "mom"), "%", ("fred", "RSAFS"), ("ET", "08:30"), True),
    ev("US", "Real GDP (QoQ SAAR)", ("fred", "A191RL1Q225SBEA", "level"), "%", ("fred", "A191RL1Q225SBEA"), ("ET", "08:30"), True),
    ev("US", "Industrial production (MoM)", ("fred", "INDPRO", "mom"), "%", ("fred", "INDPRO"), ("ET", "09:15")),
    ev("US", "JOLTS job openings", ("fred", "JTSJOL", "level"), "k", ("fred", "JTSJOL"), ("ET", "10:00")),
    ev("US", "Initial jobless claims", ("fred", "ICSA", "level"), "count", ("fred", "ICSA"), ("ET", "08:30"), False, "Weekly"),
    ev("US", "UMich consumer sentiment", ("fred", "UMCSENT", "level"), "idx", ("fred", "UMCSENT"), ("ET", "10:00")),
    ev("US", "Housing starts", ("fred", "HOUST", "level"), "k", ("fred", "HOUST"), ("ET", "08:30"), False, "Annualised"),
    # leading indicators (WP62): the first dominoes of the cycle and the regional Fed surveys
    ev("US", "Building permits", ("fred", "PERMIT", "level"), "k", ("fred", "PERMIT"), ("ET", "08:30"), False, "Annualised; single-family permits lead jobs (Leading board)"),
    ev("US", "New home sales", ("fred", "HSN1F", "level"), "k", ("fred", "HSN1F"), ("ET", "10:00"), False, "Annualised"),
    ev("US", "Durable goods orders (MoM)", ("fred", "DGORDER", "mom"), "%", ("fred", "DGORDER"), ("ET", "08:30")),
    ev("US", "Empire State manufacturing survey", ("fred", "GACDISA066MSFRBNY", "level"), "idx", ("fred", "GACDISA066MSFRBNY"), ("ET", "08:30"), False, "New York Fed; first factory survey of the month"),
    ev("US", "Philadelphia Fed manufacturing survey", ("fred", "GACDFSA066MSFRBPHI", "level"), "idx", ("fred", "GACDFSA066MSFRBPHI"), ("ET", "08:30"), False, "New orders, inventories and prices paid feed the Leading board"),
    # ---- Euro area
    ev("Euro area", "HICP inflation (YoY)", ("fred", "CP0000EZ19M086NEST", "yoy"), "%", ("fred", "CP0000EZ19M086NEST"), ("CET", "11:00"), True),
    # ---- euro-area countries and the UK (WP36): flash CPI near the end of the month it covers, GDP flash a month after the quarter
    ev("Euro area", "Germany CPI flash (HICP, YoY)", ("fred", "CP0000DEM086NEST", "yoy"), "%", ("win", 27, 31, None, "current month"), ("CET", "14:00"), True,
       "Number shown is the final HICP for the month", "Destatis"),
    ev("Euro area", "France CPI flash (HICP, YoY)", ("fred", "CP0000FRM086NEST", "yoy"), "%", ("win", 28, 31, None, "current month"), ("CET", "08:45"), src="INSEE"),
    ev("Euro area", "Italy CPI flash (HICP, YoY)", ("fred", "CP0000ITM086NEST", "yoy"), "%", ("win", 28, 31, None, "current month"), ("CET", "11:00"), src="Istat"),
    ev("Euro area", "Spain CPI flash (HICP, YoY)", ("fred", "CP0000ESM086NEST", "yoy"), "%", ("win", 27, 31, None, "current month"), ("CET", "09:00"), src="INE"),
    ev("Euro area", "Germany GDP flash (YoY)", ("asia", "DE_GDP_YOY", "level"), "%", ("win", 28, 31, Q_NEXT, "previous quarter"), ("CET", "10:00"), True, src="Destatis"),
    ev("Euro area", "France GDP flash (YoY)", ("asia", "FR_GDP_YOY", "level"), "%", ("win", 28, 31, Q_NEXT, "previous quarter"), ("CET", "07:30"), src="INSEE"),
    ev("Euro area", "Italy GDP flash (YoY)", ("asia", "IT_GDP_YOY", "level"), "%", ("win", 28, 31, Q_NEXT, "previous quarter"), ("CET", "10:00"), src="Istat"),
    ev("Euro area", "Spain GDP flash (YoY)", ("asia", "ES_GDP_YOY", "level"), "%", ("win", 27, 31, Q_NEXT, "previous quarter"), ("CET", "09:00"), src="INE"),
    ev("UK", "CPI (YoY)", ("asia", "UK_CPI_YOY", "level"), "%", ("win", 15, 22, None, "previous month"), ("UK", "07:00"), True, "Number shown is the OECD series", "ONS"),
    ev("UK", "GDP first estimate (YoY)", ("asia", "UK_GDP_YOY", "level"), "%", ("win", 10, 15, Q_MID, "previous quarter"), ("UK", "07:00"), True, src="ONS"),
    ev("UK", "Labour market: unemployment", ("asia", "UK_UNEMP", "level"), "%", ("win", 11, 18, None, "two months back"), ("UK", "07:00"), src="ONS"),
    # ---- Malaysia (DOSM: no forward calendar in machine-readable form, so windows)
    ev("Malaysia", "CPI (YoY)", ("asia", "MY_CPI", "yoy"), "%", ("win", 20, 26, None, "previous month"), ("MYT", "12:00"), True, src="DOSM"),
    ev("Malaysia", "Exports (YoY)", ("asia", "MY_EXPORTS", "yoy"), "%", ("win", 17, 22, None, "previous month"), ("MYT", "12:00"), True, src="DOSM"),
    ev("Malaysia", "Industrial production (YoY)", ("asia", "MY_IPI_YOY", "level"), "%", ("win", 8, 13, None, "two months back"), ("MYT", "12:00"), src="DOSM"),
    ev("Malaysia", "Unemployment rate", ("asia", "MY_UNEMP", "level"), "%", ("win", 6, 13, None, "two months back"), ("MYT", "12:00"), src="DOSM"),
    ev("Malaysia", "Leading index (YoY)", ("asia", "MY_LEADING", "yoy"), "%", ("win", 22, 28, None, "two months back"), ("MYT", "12:00"), src="DOSM"),
    ev("Malaysia", "Producer prices (YoY)", ("asia", "MY_PPI_YOY", "level"), "%", ("win", 26, 31, None, "previous month"), ("MYT", "12:00"), src="DOSM"),
    ev("Malaysia", "GDP advance estimate (YoY)", ("asia", "MY_GDP_YOY", "level"), "%", ("win", 15, 20, Q_NEXT, "previous quarter"), ("MYT", "12:00"), True, src="DOSM"),
    ev("Malaysia", "GDP final (YoY)", ("asia", "MY_GDP_YOY", "level"), "%", ("win", 12, 17, Q_MID, "previous quarter"), ("MYT", "12:00"), True,
       "Released with BNM's quarterly bulletin", "DOSM & BNM"),
    # ---- Singapore
    ev("Singapore", "CPI (YoY)", ("asia", "SG_CPI", "yoy"), "%", ("win", 22, 26, None, "previous month"), ("SGT", "13:00"), True, src="SingStat"),
    ev("Singapore", "MAS core inflation (YoY)", ("asia", "SG_CORE_YOY", "level"), "%", ("win", 22, 26, None, "previous month"), ("SGT", "13:00"), True, src="MAS & SingStat"),
    ev("Singapore", "NODX (YoY)", ("asia", "SG_NODX", "yoy"), "%", ("win", 15, 19, None, "previous month"), ("SGT", "08:30"), True, src="Enterprise Singapore"),
    ev("Singapore", "GDP advance estimate (YoY)", ("asia", "SG_GDP", "yoy"), "%", ("win", 1, 14, Q_NEXT, "previous quarter"), ("SGT", "08:00"), True, src="MTI"),
    ev("Singapore", "GDP final (YoY)", ("asia", "SG_GDP", "yoy"), "%", ("win", 18, 25, Q_MID, "previous quarter"), ("SGT", "08:00"), src="MTI"),
    # ---- Australia
    ev("Australia", "CPI (monthly)", None, "%", ("win", 24, 31, None, "previous month"), ("SYD", "11:30"), True,
       "Monthly CPI; this dashboard carries the quarterly series only, so no number here", "ABS"),
    ev("Australia", "Labour force: unemployment", ("asia", "AU_UNEMP", "level"), "%", ("win", 12, 20, None, "previous month"), ("SYD", "11:30"), True, src="ABS"),
    ev("Australia", "GDP (YoY)", ("asia", "AU_GDP_YOY", "level"), "%", ("win", 1, 8, (3, 6, 9, 12), "previous quarter"), ("SYD", "11:30"), True, src="ABS"),
    # ---- China
    ev("China", "CPI (YoY)", ("asia", "CN_CPI_YOY", "level"), "%", ("win", 9, 12, None, "previous month"), ("CST", "09:30"), True, src="NBS"),
    ev("China", "Exports (YoY)", ("asia", "CN_EXP_YOY", "level"), "%", ("win", 7, 10, None, "previous month"), ("CST", "11:00"), True,
       "Number shown is the OECD seasonally adjusted series; the customs headline differs", "China Customs"),
    ev("China", "Activity data (IP, retail, FAI)", None, "%", ("win", 14, 18, None, "previous month"), ("CST", "10:00"), True, src="NBS"),
    ev("China", "Official PMIs", None, "idx", ("win", 30, 31, None, "current month"), ("CST", "09:30"), True, src="NBS"),
    ev("China", "GDP (YoY)", None, "%", ("win", 14, 20, Q_NEXT, "previous quarter"), ("CST", "10:00"), True, src="NBS"),
    # ---- Japan
    ev("Japan", "CPI nationwide (YoY)", ("asia", "JP_CPI_YOY", "level"), "%", ("win", 17, 24, None, "previous month"), ("JST", "08:30"), True, src="Statistics Bureau"),
    ev("Japan", "Core CPI nationwide (YoY)", ("asia", "JP_CORE_YOY", "level"), "%", ("win", 17, 24, None, "previous month"), ("JST", "08:30"), True,
       "Ex fresh food", "Statistics Bureau"),
    ev("Japan", "Tokyo CPI (advance)", None, "%", ("win", 24, 31, None, "current month"), ("JST", "08:30"), False, "Leads the nationwide print", "Statistics Bureau"),
    ev("Japan", "Unemployment rate", ("asia", "JP_UNEMP", "level"), "%", ("win", 26, 31, None, "previous month"), ("JST", "08:30"), src="Statistics Bureau"),
    ev("Japan", "Exports (YoY)", ("asia", "JP_EXP_YOY", "level"), "%", ("win", 16, 21, None, "previous month"), ("JST", "08:50"), src="Ministry of Finance"),
    ev("Japan", "Tankan: large manufacturers", ("asia", "JP_TANKAN_LM", "level"), "idx", ("win", 1, 3, (4, 7, 10), "current quarter"), ("JST", "08:50"), True,
       "December survey comes out mid-December", "Bank of Japan"),
    ev("Japan", "Tankan (December)", ("asia", "JP_TANKAN_LM", "level"), "idx", ("win", 12, 16, (12,), "current quarter"), ("JST", "08:50"), True, src="Bank of Japan"),
    # ---- Korea: first major economy to report trade each month
    ev("Korea", "Exports (YoY)", ("asia", "KR_EXP_YOY", "level"), "%", ("win", 1, 1, None, "previous month"), ("KST", "09:00"), True,
       "Global trade and chip-cycle bellwether", "Korea Customs"),
    # ---- Taiwan (numbers from DGBAS via taiwan.json)
    ev("Taiwan", "Exports (YoY)", ("asia", "TW_EXP_YOY", "level"), "%", ("win", 7, 10, None, "previous month"), ("TPE", "16:00"), True,
       "Number shown is the 3-month-sum YoY the dashboard charts; the headline single-month figure differs", "Ministry of Finance"),
    ev("Taiwan", "CPI (YoY)", ("asia", "TW_CPI_YOY", "level"), "%", ("win", 5, 9, None, "previous month"), ("TPE", "16:00"), src="DGBAS"),
    ev("Taiwan", "Export orders (YoY)", ("asia", "TW_ORDERS_YOY", "level"), "%", ("win", 18, 23, None, "previous month"), ("TPE", "16:00"), True,
       "Number shown is the 3-month-sum YoY the dashboard charts (DGBAS copy of the ministry's figures)", "Ministry of Economic Affairs"),
    ev("Taiwan", "GDP advance estimate (YoY)", ("asia", "TW_GDP_YOY", "level"), "%", ("win", 28, 31, Q_NEXT, "previous quarter"), ("TPE", "16:00"), True, src="DGBAS"),
    # ---- India
    ev("India", "CPI (YoY)", ("asia", "IN_CPI_YOY", "level"), "%", ("win", 12, 14, None, "previous month"), ("IST", "16:00"), True,
       "Number shown is the OECD series", "MoSPI"),
    ev("India", "Industrial production (YoY)", ("asia", "IN_IP_YOY", "level"), "%", ("win", 27, 31, None, "previous month"), ("IST", "16:00"), src="MoSPI"),
    ev("India", "GDP (YoY)", ("asia", "IN_GDP_YOY", "level"), "%", ("win", 27, 31, Q_MID, "previous quarter"), ("IST", "16:00"), True, src="MoSPI"),
]

# ---------------------------------------------------------------- central bank decisions (Confirmed)
FOMC = "federalreserve.gov/monetarypolicy/fomccalendars.htm"
ECB = "ecb.europa.eu (Governing Council calendar)"
BOJ = "boj.or.jp (monetary policy meeting schedule)"
BNM = "bnm.gov.my (Schedule of Monetary Policy Decisions 2027, published 5 Nov 2026)"
RBA = "rba.gov.au/schedules-events/board-meeting-schedules.html"
BOE = "bankofengland.co.uk (MPC dates for 2027)"
MAS = "mas.gov.sg (Advance Release Calendar)"
RBI = "rbi.org.in (MPC schedule for 2026-27, announced 23 Mar 2026; dates as reported by Indian press, official page unreachable from here)"
CBC = "cbc.gov.tw (provisional 2026 board meeting schedule, as reported; check the bank's site)"
SEP = "with Summary of Economic Projections"
MEETINGS = [
    # (region, event, decision date, local time (tz, HH:MM) or None, detail, source, policy-rate (source, id) or None)
    *[("US", "FOMC decision", d, ("ET", "14:00"), x, FOMC, ("fred", "DFEDTARU")) for d, x in [
        ("2026-09-16", SEP), ("2026-10-28", ""), ("2026-12-09", SEP), ("2027-01-27", ""), ("2027-03-17", SEP), ("2027-04-28", ""), ("2027-06-09", SEP),
        ("2027-07-28", ""), ("2027-09-15", SEP), ("2027-10-27", ""), ("2027-12-08", SEP)]],
    *[("Euro area", "ECB decision", d, ("CET", "14:15"), "", ECB, ("fred", "ECBDFR")) for d in [
        "2026-10-29", "2026-12-17", "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-10", "2027-07-22", "2027-09-09", "2027-10-28", "2027-12-16"]],
    *[("Japan", "BoJ decision", d, None, x + ("; " if x else "") + "announced around midday Tokyo time, no fixed hour", BOJ, None) for d, x in [
        ("2026-10-30", "with Outlook Report"), ("2026-12-18", ""), ("2027-01-22", "with Outlook Report"), ("2027-03-18", ""), ("2027-04-28", "with Outlook Report"),
        ("2027-06-11", ""), ("2027-07-22", "with Outlook Report"), ("2027-09-22", ""), ("2027-10-29", "with Outlook Report"), ("2027-12-17", "")]],
    *[("Malaysia", "BNM OPR decision", d, ("MYT", "15:00"), "", BNM, ("asia", "MY_OPR")) for d in [
        "2026-11-05", "2027-01-21", "2027-03-04", "2027-05-06", "2027-07-08", "2027-09-09", "2027-11-04"]],
    *[("Australia", "RBA decision", d, ("SYD", "14:30"), "", RBA, ("asia", "AU_CASH")) for d in [
        "2026-11-03", "2026-12-08", "2027-02-09", "2027-03-23", "2027-05-04", "2027-06-22", "2027-08-10", "2027-09-28", "2027-11-02", "2027-12-14"]],
    *[("UK", "BoE decision", d, ("UK", "12:00"), "", BOE, None) for d in [
        "2026-11-05", "2026-12-17", "2027-02-04", "2027-03-18", "2027-04-29", "2027-06-17", "2027-07-29", "2027-09-16", "2027-11-04", "2027-12-16"]],
    ("Singapore", "MAS monetary policy statement", "2026-10-14", ("SGT", "08:00"), "S$NEER policy band", MAS, None),
    *[("India", "RBI repo rate decision", d, ("IST", "10:00"), "Monetary Policy Committee resolution", RBI, None) for d in [
        "2026-10-07", "2026-12-04", "2027-02-05"]],
    ("Taiwan", "CBC discount rate decision", "2026-12-17", None, "Quarterly board meeting (provisional date); news conference follows, usually late afternoon Taipei time", CBC, None),
]
# MAS gives only a "no later than" date for its next statement
MAS_WINDOWS = [("2027-01-20", "2027-01-29", "Due no later than 29 Jan 2027 (MAS advance release calendar); S$NEER policy band")]
COVERAGE = {"US": "2027-12-08", "Euro area": "2027-12-16", "Japan": "2027-12-17", "Malaysia": "2027-11-04", "Australia": "2027-12-14",
            "UK": "2027-12-16", "Singapore": "2027-01-29", "India": "2027-02-05", "Taiwan": "2026-12-17"}
VERIFIED_ON = "2026-11-11"

# The People's Bank of China sets its loan prime rates on the 20th (next business day if a weekend or holiday)
LPR_NOTE = "1Y and 5Y loan prime rates, 09:00 Beijing time on the 20th (moved to the next business day if it falls on a weekend or holiday)"

# days after a decision until the policy-rate series shows the new rate (Fed: next day; ECB: the following Wednesday;
# BNM: the API records the decision date; RBA: the next day in table F1)
RATE_LAG = {"DFEDTARU": 1, "ECBDFR": 7, "MY_OPR": 0, "AU_CASH": 1}
MAX_LAG = {52: 30, 12: 100, 4: 220, 1: 500}   # days a release may sit after the end of its period


# ---------------------------------------------------------------- helpers
def per_year(s: pd.Series) -> int:
    if len(s) < 3:
        return 12
    gap = s.index.to_series().diff().dt.days.median()
    return 52 if gap <= 10 else 12 if gap <= 45 else 4 if gap <= 120 else 1


def transform(s: pd.Series, how: str) -> pd.Series:
    s = s.dropna()
    if how == "yoy":
        return ((s / s.shift(per_year(s)) - 1) * 100).dropna()
    if how == "mom":
        return ((s / s.shift(1) - 1) * 100).dropna()
    if how == "diff":
        return s.diff().dropna()
    return s


def period_ends(s: pd.Series) -> pd.DatetimeIndex:
    n = per_year(s)
    if n == 12:
        return s.index + pd.offsets.MonthEnd(0)
    if n == 4:
        return s.index + pd.offsets.QuarterEnd(0)
    return s.index


COVERS_BACK = {"current month": 0, "previous month": 1, "two months back": 2}


def cutoff(date: dt.date, covers: str | None) -> pd.Timestamp | None:
    """Latest period end a release on `date` can cover, given what it covers (None = anything that has ended)."""
    t = pd.Timestamp(date)
    if covers in COVERS_BACK:
        return (t - pd.offsets.MonthBegin(1) if t.day != 1 else t) - pd.DateOffset(months=COVERS_BACK[covers]) + pd.offsets.MonthEnd(0)
    if covers == "previous quarter":
        return t.to_period("Q").start_time - pd.Timedelta(days=1)
    if covers == "current quarter":
        return t.to_period("Q").end_time.normalize()
    return None


def published_at(s: pd.Series | None, when: pd.Timestamp, last: pd.Timestamp | None = None):
    """Position of the observation a release on `when` published: its period ended before the release
    (and no later than `last`, the period the release covers), or None."""
    if s is None or s.empty:
        return None
    ends = period_ends(s)
    if last is not None:   # the release covers exactly one period: the one ending at `last`
        f = "Q" if per_year(s) == 4 else "M"
        ok = [i for i, e in enumerate(ends) if e.to_period(f) == last.to_period(f)]
    else:
        ok = [i for i, e in enumerate(ends) if e < when]
    if not ok:
        return None
    i = ok[-1]
    return i if (when - ends[i]).days <= MAX_LAG.get(per_year(s), 200) else None


def fmt(v, unit, signed=False):
    if v is None or pd.isna(v):
        return ""
    sg = "+" if signed and v > 0 else ""
    if unit == "%":
        return f"{sg}{v:.1f}%"
    if unit == "k":
        return f"{sg}{v:,.0f}k"
    if unit == "count":
        return f"{v:,.0f}"
    return f"{sg}{v:.1f}"


def period_label(s: pd.Series, i: int) -> str:
    t, n = s.index[i], per_year(s)
    if n == 4:
        return f"Q{(t.month - 1) // 3 + 1} {t.year}"
    if n == 52:
        return f"w/e {t:%d %b}"
    return f"{t:%b %Y}"


def to_sgt(date: dt.date, t):
    """Local release time -> 'HH:MM' Singapore/Malaysia time, and whether it falls on the next calendar day there."""
    if not t:
        return None, 0
    tz, hm = t
    h, m = map(int, hm.split(":"))
    loc = dt.datetime(date.year, date.month, date.day, h, m, tzinfo=ZoneInfo(TZ[tz]))
    sg = loc.astimezone(SGT)
    return sg.strftime("%H:%M"), (sg.date() - date).days


def clamp(y, m, d):
    return dt.date(y, m, min(d, _cal.monthrange(y, m)[1]))


def windows(lo, hi, months, start: dt.date, end: dt.date):
    out, y, m = [], start.year, start.month
    for _ in range(6):
        if not months or m in months:
            a, b = clamp(y, m, lo), clamp(y, m, hi)
            if b >= start and a <= end:
                out.append((a, b))
        m += 1
        if m > 12:
            y, m = y + 1, 1
    return out


def next_business(d: dt.date) -> dt.date:
    while d.weekday() >= 5:
        d += dt.timedelta(days=1)
    return d


# ---------------------------------------------------------------- FRED
def fred_json(path: str, params: dict, key: str) -> dict | None:
    r = get(FRED_API.format(path=path), {**params, "api_key": key, "file_type": "json"})
    try:
        return r.json() if r is not None else None
    except ValueError:
        return None


def fred_release_dates(codes: list[str], key: str, start: dt.date, end: dt.date) -> dict[str, list[dt.date]]:
    """Scheduled release dates per FRED series, one lookup per release (CPI and core CPI share one)."""
    rel_of, dates_of, out, fails = {}, {}, {}, 0
    for code in codes:
        if fails >= 4:
            break
        if code not in rel_of:
            j = fred_json("series/release", {"series_id": code}, key)
            rows = (j or {}).get("releases") or []
            if not rows:
                fails += 1
                continue
            rel_of[code] = rows[0]["id"]
            time.sleep(0.1)
        rid = rel_of[code]
        if rid not in dates_of:
            j = fred_json("release/dates", {"release_id": rid, "realtime_start": start.isoformat(), "realtime_end": end.isoformat(),
                                            "include_release_dates_with_no_data": "true", "sort_order": "asc", "limit": 200}, key)
            ds = []
            for e in (j or {}).get("release_dates") or []:
                try:
                    ds.append(dt.date.fromisoformat(e["date"]))
                except (KeyError, ValueError):
                    pass
            ds = sorted({d for d in ds if start <= d <= end})
            # a release publishing every few days is a continuous series, not an event (weekly claims are the exception)
            if code != "ICSA" and len(ds) > 1 and (end - start).days / len(ds) < 5:
                ds = []
            dates_of[rid] = ds
            time.sleep(0.1)
        if dates_of[rid]:
            out[code] = dates_of[rid]
    print(f"  FRED release calendar: {len(dates_of)} releases, {sum(len(v) for v in dates_of.values())} dates")
    return out


# ---------------------------------------------------------------- build
def build(fred_key: str | None, asia: dict[str, pd.Series], status: dict) -> None:
    print("Economic calendar")
    tw = load_existing("taiwan.json")   # Taiwan numbers live in their own file (DGBAS)
    asia = {**asia, **{k: unpack(v) for k, v in tw.items() if not k.startswith("_") and isinstance(v, dict) and v.get("d")}}
    today = dt.date.today()
    start, end = today - dt.timedelta(days=LOOKBACK_DAYS), today + dt.timedelta(days=HORIZON_DAYS)
    old = load_existing("calendar.json")

    cache: dict[tuple, pd.Series | None] = {}

    def series(src, sid, how="level"):
        k = (src, sid, how)
        if k not in cache:
            raw = None
            if src == "asia":
                raw = asia.get(sid)
            elif src == "fred" and fred_key:
                raw = fetch_fred(sid, fred_key, "2010-01-01")
                time.sleep(0.1)
            cache[k] = transform(raw, how) if raw is not None and len(raw) else None
        return cache[k]

    rows = []

    def add(date, end_date, region, name, kind, conf, hi, t, detail, src, s=None, unit="%", signed=False, covers=None):
        sg, nextday = to_sgt(date, t)
        r = dict(d=date.isoformat(), region=region, name=name, kind=kind, conf=conf, hi=hi, detail=detail, src=src)
        if end_date:
            r["end"] = end_date.isoformat()
        if sg:
            r["sgt"] = sg + (" (+1 day)" if nextday > 0 else "")
        last = cutoff(date, covers)
        if last is not None:   # the period this release covers
            r["covers"] = f"Q{(last.month - 1) // 3 + 1} {last.year}" if "quarter" in covers else f"{last:%b %Y}"
        if s is not None:
            when = pd.Timestamp(date)
            i = published_at(s, when + pd.Timedelta(days=1) if covers else when, cutoff(date, covers))
            if date <= today and i is not None:
                r["actual"], r["period"] = fmt(s.iloc[i], unit, signed), period_label(s, i)
                if i > 0:
                    r["prev"] = fmt(s.iloc[i - 1], unit, signed)
            else:   # upcoming (or released but not yet in this dashboard's data): latest reading as "previous"
                if date <= today:
                    r["pending"] = True
                j = len(s) - 1
                r["prev"], r["prev_period"] = fmt(s.iloc[j], unit, signed), period_label(s, j)
        rows.append(r)

    # data releases
    fred_codes = [e["sched"][1] for e in EVENTS if e["sched"][0] == "fred"]
    live = fred_release_dates(list(dict.fromkeys(fred_codes)), fred_key, start, end) if fred_key else {}
    for e in EVENTS:
        s = series(*e["value"]) if e["value"] else None
        if e["value"] and s is None and e["value"][0] == "asia":
            status_note = f"calendar: no data for {e['region']} {e['name']}"
            print("  " + status_note)
        signed = bool(e["value"]) and e["value"][2] in ("diff", "mom")
        src = e["src"] or ("FRED release calendar" if e["sched"][0] == "fred" else "")
        if e["sched"][0] == "fred":
            for d in live.get(e["sched"][1], []):
                add(d, None, e["region"], e["name"], "Data", "Live", e["hi"], e["t"], e["detail"], src, s, e["unit"], signed)
        else:
            _, lo, hi_, months, covers = e["sched"]
            for a, b in windows(lo, hi_, months, start, end):
                detail = e["detail"]
                add(a, b if b != a else None, e["region"], e["name"], "Data", "Estimated", e["hi"], e["t"], detail, src, s, e["unit"], signed, covers)

    # US rows need FRED; if it was unreachable, keep the previous run's live rows rather than lose the US calendar
    if not live and old.get("events"):
        kept = [r for r in old["events"] if r.get("conf") == "Live" and start.isoformat() <= r["d"] <= end.isoformat()]
        rows.extend(kept)
        print(f"  FRED release calendar unavailable: kept {len(kept)} rows from the previous run")
        if kept and len(DIAG) < 12:
            DIAG.append("calendar: FRED release dates unavailable, previous US dates kept")

    # central bank decisions
    for region, name, d, t, detail, src, rate in MEETINGS:
        date = dt.date.fromisoformat(d)
        if not start <= date <= end:
            continue
        r_s = series(*rate) if rate else None
        sg, nextday = to_sgt(date, t)
        r = dict(d=d, region=region, name=name, kind="Policy", conf="Confirmed", hi=True, detail=detail, src=src)
        if sg:
            r["sgt"] = sg + (" (+1 day)" if nextday > 0 else "")
        if r_s is not None and len(r_s):
            before = r_s[r_s.index < pd.Timestamp(date)]
            if len(before):
                r["prev"] = f"{before.iloc[-1]:.2f}%"
            lag = RATE_LAG.get(rate[1], 1)
            after = r_s[(r_s.index >= pd.Timestamp(date) + pd.Timedelta(days=lag)) & (r_s.index <= pd.Timestamp(date) + pd.Timedelta(days=45))]
            if date <= today and len(after):
                r["actual"] = f"{after.iloc[0]:.2f}%"
            elif date <= today:
                r["pending"] = True
        rows.append(r)
    for a, b, detail in MAS_WINDOWS:
        da, db = dt.date.fromisoformat(a), dt.date.fromisoformat(b)
        if db >= start and da <= end:
            rows.append(dict(d=a, end=b, region="Singapore", name="MAS monetary policy statement", kind="Policy", conf="Estimated", hi=True,
                             sgt="08:00", detail=detail, src=MAS))
    # PBoC loan prime rate: a fixed monthly rule
    y, m = start.year, start.month
    for _ in range(5):
        d = next_business(dt.date(y, m, 20))
        if start <= d <= end:
            rows.append(dict(d=d.isoformat(), region="China", name="PBoC loan prime rates", kind="Policy", conf="Rule", hi=False, sgt="09:00",
                             detail=LPR_NOTE + "; public holidays not checked", src="People's Bank of China"))
        m += 1
        if m > 12:
            y, m = y + 1, 1

    rows.sort(key=lambda r: (r["d"], 0 if r["kind"] == "Policy" else 1, r["region"], r["name"]))
    seen, uniq = set(), []
    for r in rows:
        k = (r["d"], r["region"], r["name"])
        if k not in seen:
            seen.add(k)
            uniq.append(r)
    notes = []
    for region, last in COVERAGE.items():
        left = (dt.date.fromisoformat(last) - today).days
        if left <= 75:
            notes.append(f"{region}: central bank dates on file run out on {last}; the next schedule needs adding.")
    # full decision schedules (not just the calendar window): the central bank page uses them to judge market pricing
    schedules = {}
    for _, name, d, *_ in MEETINGS:
        schedules.setdefault(name.split()[0], []).append(d)
    write("calendar.json", dict(generated=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), verified_on=VERIFIED_ON,
                                start=start.isoformat(), end=end.isoformat(), notes=notes, events=uniq, schedules=schedules))
    status["CALENDAR"] = "ok" if uniq else "missing"
    print(f"  {len(uniq)} calendar rows ({sum(r['conf'] == 'Live' for r in uniq)} live US dates)")
