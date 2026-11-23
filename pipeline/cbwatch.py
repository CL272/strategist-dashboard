"""
Central bank watch: free market gauges of where policy rates are heading, for banks without a
fed-funds-futures-style market. These are money-market and bond-curve reads that include a term and
credit premium; the dashboard compares each with its own 2-year average and never turns them into
probabilities.

  BNM  interbank rates (overnight to 6 months)      Bank Negara Malaysia API, interest-rate?product=interbank
  RBA  bank bills (1, 3, 6 months), 3Y bond         RBA tables F1 (daily) and F2 (daily)
  ECB  deposit facility rate; instantaneous forwards (3M, 6M, 1Y, 2Y) on the AAA government curve
                                                    ECB Data Portal (FM and YC datasets)
  BoJ  call rate and JGB 1Y/2Y are already on the dashboard (asia.json, curves.json).

Writes docs/data/cbwatch.json in the same series format as the other modules.
"""
from __future__ import annotations

import io
import re
import time
from datetime import date

import pandas as pd
import requests

from fetch import DIAG, get, load_existing, pack, unpack, write

BNM_URL = "https://api.bnm.gov.my/public/interest-rate/year/{y}/month/{m}"
BNM_HDR = {"Accept": "application/vnd.BNM.API.v1+json"}
BNM_TENORS = [("overnight", "ON", "overnight"), ("1_week", "1W", "1-week"), ("1_month", "1M", "1-month"),
              ("3_month", "3M", "3-month"), ("6_month", "6M", "6-month")]
BNM_BACKFILL_MONTHS = 36
ECB = "https://data-api.ecb.europa.eu/service/data/{flow}/{key}"
ECB_SERIES = [
    ("EA_DFR", "FM", "D.U2.EUR.4F.KR.DFR.LEV", "ECB deposit facility rate", "Rates · Euro area"),
    ("EA_FWD_3M", "YC", "B.U2.EUR.4F.G_N_A.SV_C_YM.IF_3M", "Euro AAA instantaneous forward, 3 months ahead", "Rates · Euro area"),
    ("EA_FWD_6M", "YC", "B.U2.EUR.4F.G_N_A.SV_C_YM.IF_6M", "Euro AAA instantaneous forward, 6 months ahead", "Rates · Euro area"),
    ("EA_FWD_1Y", "YC", "B.U2.EUR.4F.G_N_A.SV_C_YM.IF_1Y", "Euro AAA instantaneous forward, 1 year ahead", "Rates · Euro area"),
    ("EA_FWD_2Y", "YC", "B.U2.EUR.4F.G_N_A.SV_C_YM.IF_2Y", "Euro AAA instantaneous forward, 2 years ahead", "Rates · Euro area"),
    # Europe page: FRED's copies of these stopped in 2023
    ("EA_UNEMP", "LFSI", "M.I9.S.UNEHRT.TOTAL0.15_74.T", "Euro area unemployment rate", "Macro · Euro area"),
    ("EA_M3_YOY", "BSI", "M.U2.Y.V.M30.X.I.U2.2300.Z01.A", "Euro area M3 growth YoY", "Macro · Euro area"),
]
RBA_SERIES = [  # (id, table, RBA series id, label)
    ("AU_BB_1M", "f1", "FIRMMBAB30D", "Australia 1-month bank bill"),
    ("AU_BB_3M", "f1", "FIRMMBAB90D", "Australia 3-month bank bill"),
    ("AU_BB_6M", "f1", "FIRMMBAB180D", "Australia 6-month bank bill"),
    ("AU_3Y", "f2", "FCMYGBAG3D", "Australia 3Y government bond yield"),
]


def _months_back(n: int) -> list[tuple[int, int]]:
    t = date.today()
    y, m, out = t.year, t.month, []
    for _ in range(n):
        out.append((y, m))
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return out


def bnm_interbank(old: dict) -> dict[str, pd.Series]:
    have = all(f"MY_IB_{code}" in old for _, code, _ in BNM_TENORS)
    months = _months_back(2 if have else BNM_BACKFILL_MONTHS)
    pts: dict[str, dict] = {code: {} for _, code, _ in BNM_TENORS}
    fails = 0
    for y, m in months:
        try:
            r = requests.get(BNM_URL.format(y=y, m=m), params={"product": "interbank"}, headers=BNM_HDR, timeout=30)
            rows = r.json().get("data") if r.status_code == 200 else None
        except Exception:
            rows = None
        if not rows:
            fails += 1
            continue
        for row in rows if isinstance(rows, list) else [rows]:
            try:
                d = pd.Timestamp(row["date"])
            except Exception:
                continue
            for key, code, _ in BNM_TENORS:
                v = row.get(key)
                if v is not None:
                    pts[code][d] = float(v)
        time.sleep(0.2)
    print(f"  BNM interbank: {len(months) - fails}/{len(months)} months")
    out = {}
    for _, code, _ in BNM_TENORS:
        s = pd.Series(pts[code], dtype="float64").sort_index()
        sid = f"MY_IB_{code}"
        if sid in old:   # keep history from earlier runs; new readings win
            prev = unpack(old[sid])
            s = s.combine_first(prev) if len(s) else prev
        if len(s):
            out[sid] = s[~s.index.duplicated(keep="last")].sort_index()
    return out


# Malaysian Treasury bill yields (owner's request, 23 Nov 2026): Bank Negara's API, gov-sec-yield?date=YYYY-MM-DD
# ("short-terms_bills", from Jan 2019, one trading day per call). Each run reads recent days first, then a weekly sample of
# older days, then the rest, within a budget; days with no trading (holidays) are remembered so they are not asked again.
BNM_GSY = "https://api.bnm.gov.my/public/gov-sec-yield"
BILL_TENORS = [("3M", "up to 3 months", "up_to_three_month"), ("6M", "3 to 6 months", "above_three_to_six_month"),
               ("12M", "6 to 12 months", "above_six_to_twelve_month")]
BILL_START = "2019-01-02"
BILL_MAX_CALLS = 200   # about 3 KB and ~1.5 s each: ~5 minutes while the history since 2019 fills in, then a few calls a day


def _bill_day(day: str):
    r = requests.get(BNM_GSY, params={"date": day}, headers=BNM_HDR, timeout=30)
    if r.status_code != 200:
        return None
    rows = ((r.json() or {}).get("data") or {}).get("short-terms_bills") or []
    for row in rows:
        if "treasury" in str(row.get("type", "")).lower() and "islamic" not in str(row.get("type", "")).lower():
            try:
                return [float(row[k]) for _, _, k in BILL_TENORS]
            except (KeyError, TypeError, ValueError):
                return None
    return []   # no bills that day: a holiday or no trading


def bnm_bills(old: dict) -> tuple[dict[str, pd.Series], list[str]]:
    pts = {code: {} for code, _, _ in BILL_TENORS}
    for code, _, _ in BILL_TENORS:   # keep what earlier runs collected
        sid = f"MY_MTB_{code}"
        if sid in old:
            for t, v in unpack(old[sid]).items():
                pts[code][t.strftime("%Y-%m-%d")] = v
    empty = set((old.get("MY_MTB_3M") or {}).get("no_trading", []))
    days = [d.strftime("%Y-%m-%d") for d in pd.bdate_range(BILL_START, pd.Timestamp.today())][::-1]   # newest first
    todo = [d for d in days if d not in pts["3M"] and d not in empty]
    recent = [d for d in todo if d >= (pd.Timestamp.today() - pd.Timedelta(days=120)).strftime("%Y-%m-%d")]
    weekly = [d for k, d in enumerate(days) if k % 5 == 0 and d in todo and d not in recent]
    rest = [d for d in todo if d not in set(recent) | set(weekly)]
    got = calls = 0
    for d in (recent + weekly + rest)[:BILL_MAX_CALLS]:
        try:
            v = _bill_day(d)
        except Exception:
            continue
        calls += 1
        if v:
            for (code, _, _), x in zip(BILL_TENORS, v):
                pts[code][d] = x
            got += 1
        elif v == [] and d < (pd.Timestamp.today() - pd.Timedelta(days=7)).strftime("%Y-%m-%d"):
            empty.add(d)   # a past day with no bills: do not ask again
        time.sleep(0.1)
    print(f"  BNM Treasury bills: {got} new days from {calls} calls; {len(pts['3M'])} trading days on file since {BILL_START}")
    out = {}
    for code, _, _ in BILL_TENORS:
        sr = pd.Series({pd.Timestamp(k): v for k, v in pts[code].items()}, dtype="float64").sort_index()
        if len(sr):
            out[f"MY_MTB_{code}"] = sr
    return out, sorted(empty)


def ecb_series(flow: str, key: str, start: str = "2010-01-01", min_len: int = 50) -> pd.Series | None:
    r = get(ECB.format(flow=flow, key=key), {"startPeriod": start, "format": "csvdata"})
    if r is None:
        return None
    try:
        df = pd.read_csv(io.StringIO(r.text), usecols=["TIME_PERIOD", "OBS_VALUE"])
    except Exception:
        return None
    s = pd.Series(pd.to_numeric(df["OBS_VALUE"], errors="coerce").values, index=pd.to_datetime(df["TIME_PERIOD"])).dropna().sort_index()
    return s if len(s) > min_len else None


def build(status: dict) -> None:
    print("Central bank watch")
    old = load_existing("cbwatch.json")
    out = {}

    def keep(sid, s, meta):
        if s is not None and len(s):
            out[sid] = {**meta, **pack(s)}
            status[sid] = "ok"
        elif sid in old:
            out[sid] = old[sid]
            status[sid] = "stale (kept previous)"
        else:
            status[sid] = "missing"

    got = bnm_interbank(old)
    for _, code, name in BNM_TENORS:
        keep(f"MY_IB_{code}", got.get(f"MY_IB_{code}"), dict(label=f"Malaysia {name} interbank rate", group="Rates · Malaysia", kind="yield", unit="%",
                                                                source="Bank Negara Malaysia API (interest-rate, interbank)"))
    try:
        bills, no_trading = bnm_bills(old)
    except Exception as e:
        print(f"  BNM Treasury bills failed ({type(e).__name__}); kept previous")
        bills, no_trading = {}, (old.get("MY_MTB_3M") or {}).get("no_trading", [])
    for code, name, _ in BILL_TENORS:
        keep(f"MY_MTB_{code}", bills.get(f"MY_MTB_{code}"), dict(label=f"Malaysia Treasury bill, {name}", group="Rates · Malaysia", kind="yield", unit="%",
                                                                     source="Bank Negara Malaysia API (gov-sec-yield: Malaysian Treasury Bills, indicative)"))
    if "MY_MTB_3M" in out:
        out["MY_MTB_3M"]["no_trading"] = no_trading   # holidays already asked about
    import rba
    tables = {t: rba.rba_table(t) for t in ("f1", "f2")}
    for sid, t, code, label in RBA_SERIES:
        s = (tables.get(t) or {}).get(code)
        keep(sid, s[s.index >= "2010-01-01"] if s is not None else None,
             dict(label=label, group="Rates · Australia", kind="yield", unit="%", source=f"Reserve Bank of Australia (table {t.upper()}, {code})"))
    for sid, flow, key, label, group in ECB_SERIES:
        s = None
        if sid in old:   # only fetch the last two months and merge into the published history
            prev = unpack(old[sid])
            new = ecb_series(flow, key, (prev.index[-1] - pd.Timedelta(days=60)).strftime("%Y-%m-%d"), 0) if len(prev) else None
            s = new.combine_first(prev) if new is not None else None
        if s is None:
            s = ecb_series(flow, key)
        keep(sid, s, dict(label=label, group=group, kind="level" if group.startswith("Macro") else "yield", unit="%", source=f"ECB Data Portal ({flow} {key})"))
        time.sleep(0.2)
    write("cbwatch.json", out)
    missing = [k for k in out if status.get(k) != "ok"]
    if missing and len(DIAG) < 12:
        DIAG.append("cbwatch: kept previous for " + ", ".join(missing))
    print(f"  {len(out)} series ({sum(status.get(k) == 'ok' for k in out)} fresh)")
