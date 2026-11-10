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
        keep(sid, s, dict(label=label, group=group, kind="yield", unit="%", source=f"ECB Data Portal ({flow} {key})"))
        time.sleep(0.2)
    write("cbwatch.json", out)
    missing = [k for k in out if status.get(k) != "ok"]
    if missing and len(DIAG) < 12:
        DIAG.append("cbwatch: kept previous for " + ", ".join(missing))
    print(f"  {len(out)} series ({sum(status.get(k) == 'ok' for k in out)} fresh)")
