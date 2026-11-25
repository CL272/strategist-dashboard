"""
Central bank watch: free market gauges of where policy rates are heading, for banks without a
fed-funds-futures-style market. These are money-market and bond-curve reads that include a term and
credit premium; the dashboard compares each with its own 2-year average and never turns them into
probabilities.

  BNM  interbank rates (overnight to 6 months)      Bank Negara Malaysia API, interest-rate?product=interbank
       Monthly Statistical Bulletin (msb): reserves, non-resident holdings of ringgit debt, federal finance, MGS by tenor
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
# The same call carries the MGS benchmark closes ("malaysian_government_securities": 3Y, 5Y, 7Y, 10Y, 15Y, 20Y, 30Y; no 2Y
# benchmark), kept as MY_MGS_* (owner's request, 23 Nov 2026). Days read before the MGS were added are read again.
BNM_GSY = "https://api.bnm.gov.my/public/gov-sec-yield"
BILL_TENORS = [("3M", "up to 3 months", "up_to_three_month"), ("6M", "3 to 6 months", "above_three_to_six_month"),
               ("12M", "6 to 12 months", "above_six_to_twelve_month")]
BILL_START = "2019-01-02"
BILL_MAX_CALLS = 600   # about 3 KB and ~1.2 s each, four at a time: ~3 minutes while the history fills in, then a few calls a day
MGS_TENORS = ["3Y", "5Y", "7Y", "10Y", "15Y", "20Y", "30Y"]


def _bill_day(day: str):
    """(bills, mgs) for one day: bills = [3M, 6M, 12M], [] when there were none (holiday), None on a failed call;
    mgs = {tenor: closing yield} for the MGS benchmarks that traded."""
    r = requests.get(BNM_GSY, params={"date": day}, headers=BNM_HDR, timeout=30)
    if r.status_code != 200:
        return None, {}
    data = (r.json() or {}).get("data") or {}
    mgs = {}
    for row in data.get("malaysian_government_securities") or []:
        t = str(row.get("tenure", "")).strip().upper()
        try:
            v = float(row["tra_yie_close"])
            if t in MGS_TENORS and v > 0.3:   # "0.00" = the benchmark did not trade that day
                mgs[t] = v
        except (KeyError, TypeError, ValueError):
            pass
    for row in data.get("short-terms_bills") or []:
        if "treasury" in str(row.get("type", "")).lower() and "islamic" not in str(row.get("type", "")).lower():
            try:
                return [float(row[k]) for _, _, k in BILL_TENORS], mgs
            except (KeyError, TypeError, ValueError):
                return None, mgs
    return [], mgs   # no bills that day: a holiday or no trading


def bnm_bills(old: dict) -> tuple[dict[str, pd.Series], list[str], list[str]]:
    from concurrent.futures import ThreadPoolExecutor
    pts = {code: {} for code, _, _ in BILL_TENORS}
    mg = {t: {} for t in MGS_TENORS}
    for store, pre in ((pts, "MY_MTB_"), (mg, "MY_MGS_")):   # keep what earlier runs collected
        for code in store:
            if pre + code in old:
                for t, v in unpack(old[pre + code]).items():
                    if v > 0.3:
                        store[code][t.strftime("%Y-%m-%d")] = v
    empty = set((old.get("MY_MTB_3M") or {}).get("no_trading", []))
    no_mgs = set((old.get("MY_MGS_10Y") or {}).get("no_mgs", []))   # days with bills but no MGS benchmark trade
    mgs_days = set().union(*[set(x) for x in mg.values()]) | no_mgs
    days = [d.strftime("%Y-%m-%d") for d in pd.bdate_range(BILL_START, pd.Timestamp.today())][::-1]   # newest first
    todo = [d for d in days if d not in empty and (d not in pts["3M"] or d not in mgs_days)]
    recent = [d for d in todo if d >= (pd.Timestamp.today() - pd.Timedelta(days=120)).strftime("%Y-%m-%d")]
    weekly = [d for k, d in enumerate(days) if k % 5 == 0 and d in todo and d not in recent]
    rest = [d for d in todo if d not in set(recent) | set(weekly)]
    got = calls = 0
    week_ago = (pd.Timestamp.today() - pd.Timedelta(days=7)).strftime("%Y-%m-%d")

    def one(d):
        try:
            return d, _bill_day(d)
        except Exception:
            return d, None

    with ThreadPoolExecutor(max_workers=4) as ex:   # four at a time keeps a run to a few minutes
        for d, res in ex.map(one, (recent + weekly + rest)[:BILL_MAX_CALLS]):
            if res is None or res[0] is None:
                continue
            v, mgs = res
            calls += 1
            if v:
                for (code, _, _), x in zip(BILL_TENORS, v):
                    pts[code][d] = x
                got += 1
                for t, x in mgs.items():
                    mg[t][d] = x
                if not mgs and d < week_ago:
                    no_mgs.add(d)
            elif d < week_ago:
                empty.add(d)   # a past day with no bills: do not ask again
    n_mgs = len(set().union(*[set(x) for x in mg.values()]))
    print(f"  BNM bills and MGS: {got} new days from {calls} calls; {len(pts['3M'])} bill days and {n_mgs} MGS days on file since {BILL_START}")
    out = {}
    for store, pre in ((pts, "MY_MTB_"), (mg, "MY_MGS_")):
        for code, x in store.items():
            sr = pd.Series({pd.Timestamp(k): v for k, v in x.items()}, dtype="float64").sort_index()
            if len(sr):
                out[pre + code] = sr
    return out, sorted(empty), sorted(no_mgs)


# ---- Design plan 3, Step 7: Bank Negara's Monthly Statistical Bulletin, api.bnm.gov.my/public/msb/{table}[/year/{y}]
# Checked 25 Nov 2026 against published figures: values are RM million as strings (gross reserves RM 520.9bn at end-2023
# = BNM's USD 113.5bn at the year-end rate); table 2.5's yields are in % and match the daily MGS closes. Table 3.1's
# fields from "ov_sur_def" on are shifted by one place, so the overall balance is worked out from the fields before it:
# (revenue - operating expenditure) - net development expenditure. Records with no month or quarter are annual summaries
# and are skipped. The API refuses bursts ("Too Many Attempts"): one call every 3.5 seconds, the history once (carried
# over between runs in "msb_years"), then only the current year (and the year before in the first quarter).
BNM_MSB = "https://api.bnm.gov.my/public/msb/{t}/year/{y}"
MSB_GAP = 3.5
MSB_MAX_CALLS = 60
MSB = {   # table: (first year, quarterly?, {series id: (value from the record in RM million or %, label, unit, scale)})
    "3.8": (2000, False, {"MY_RESERVES": (lambda r: r.get("bnm_gro_int_res_tot"), "BNM international reserves (gross)", "RM bn", 1000)}),
    "3.7": (2005, True, {"MY_NR_DEBT": (lambda r: r.get("ext_deb_out_non_hol_of_rin_den_deb_tot"), "Non-resident holdings of ringgit debt securities", "RM bn", 1000)}),
    "3.1": (2005, True, {
        "MY_FED_BAL": (lambda r: _msb_sub(r, "cur_bud_rev", "cur_bud_exp", "dev_exp_net_dev_exp"), "Federal government overall balance, quarter", "RM bn", 1000),
        "MY_FED_REV": (lambda r: r.get("cur_bud_rev"), "Federal government revenue, quarter", "RM bn", 1000)}),
    "2.5": (2005, False, {
        "MY_MGS_2Y_M": (lambda r: r.get("mat_yr_two"), "MGS 2Y yield (monthly)", "%", 1),
        "MY_MGS_10Y_M": (lambda r: r.get("mat_yr_ten"), "MGS 10Y yield (monthly)", "%", 1)}),
}


def _msb_sub(r: dict, rev: str, exp: str, dev: str):
    try:
        return float(r[rev]) - float(r[exp]) - float(r[dev])
    except (KeyError, TypeError, ValueError):
        return None


def _msb_date(r: dict, quarterly: bool):
    y = r.get("year_dt")
    if quarterly:
        m = re.match(r"([1-4])Q", str(r.get("period") or ""))
        return pd.Timestamp(int(y), (int(m.group(1)) - 1) * 3 + 1, 1) if y and m else None
    mo = r.get("month_dt")
    return pd.Timestamp(int(y), int(mo), 1) if y and mo else None


def bnm_msb(old: dict) -> tuple[dict[str, pd.Series], dict[str, list[int]]]:
    """Bulletin tables 3.8, 3.7, 3.1 and 2.5 -> {series id: pd.Series}, plus the years read so far for each table."""
    today = date.today()
    done = {t: set((old.get(next(iter(spec[2]))) or {}).get("msb_years", [])) for t, spec in MSB.items()}
    plan = []
    for t, (first, _, _) in MSB.items():
        recent = {today.year} | ({today.year - 1} if today.month <= 3 else set())
        plan += [(t, y) for y in sorted(recent | (set(range(first, today.year + 1)) - done[t]), reverse=True)]
    plan = plan[:MSB_MAX_CALLS]
    got: dict[str, dict] = {sid: {} for spec in MSB.values() for sid in spec[2]}
    calls = 0
    for t, y in plan:
        first, quarterly, series = MSB[t]
        data = None
        for attempt in range(2):
            if calls:
                time.sleep(MSB_GAP)
            calls += 1
            try:
                r = requests.get(BNM_MSB.format(t=t, y=y), headers=BNM_HDR, timeout=30)
            except requests.RequestException as e:
                print(f"  BNM bulletin {t} {y}: {type(e).__name__}")
                break
            if r.status_code == 429 or "Too Many" in r.text[:200]:
                time.sleep(20)
                continue
            if r.ok:
                try:
                    data = r.json().get("data")
                except ValueError:
                    data = None
            break
        if data is None:
            print(f"  BNM bulletin {t} {y}: no answer; the rest waits for the next run")
            if calls > 3 and not any(got.values()):
                break
            continue
        for rec in (data if isinstance(data, list) else [data]):
            d = _msb_date(rec, quarterly)
            if d is None:
                continue
            for sid, (fn, _, _, scale) in series.items():
                try:
                    v = fn(rec)
                    v = None if v in (None, "") else float(v) / scale
                except (TypeError, ValueError):
                    v = None
                if v is not None:
                    got[sid][d] = v
        if y < today.year:
            done[t].add(y)
    out = {}
    for t, (_, _, series) in MSB.items():
        for sid in series:
            new = pd.Series(got[sid], dtype="float64").sort_index()
            prev = unpack(old[sid]) if sid in old else pd.Series(dtype="float64")
            s = new.combine_first(prev) if len(new) else prev
            if len(s):
                out[sid] = s
    print(f"  BNM bulletin: {calls} calls; " + ", ".join(f"{sid} {len(s)} pts" for sid, s in out.items()))
    return out, {t: sorted(v) for t, v in done.items()}


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
        bills, no_trading, no_mgs = bnm_bills(old)
    except Exception as e:
        print(f"  BNM Treasury bills failed ({type(e).__name__}); kept previous")
        bills, no_trading, no_mgs = {}, (old.get("MY_MTB_3M") or {}).get("no_trading", []), (old.get("MY_MGS_10Y") or {}).get("no_mgs", [])
    for code, name, _ in BILL_TENORS:
        keep(f"MY_MTB_{code}", bills.get(f"MY_MTB_{code}"), dict(label=f"Malaysia Treasury bill, {name}", group="Rates · Malaysia", kind="yield", unit="%",
                                                                     source="Bank Negara Malaysia API (gov-sec-yield: Malaysian Treasury Bills, indicative)"))
    for t in MGS_TENORS:
        keep(f"MY_MGS_{t}", bills.get(f"MY_MGS_{t}"), dict(label=f"MGS {t} yield", group="Rates · Malaysia", kind="yield", unit="%",
                                                          source="Bank Negara Malaysia API (gov-sec-yield: Malaysian Government Securities, benchmark close)"))
    if "MY_MTB_3M" in out:
        out["MY_MTB_3M"]["no_trading"] = no_trading   # holidays already asked about
    if "MY_MGS_10Y" in out:
        out["MY_MGS_10Y"]["no_mgs"] = no_mgs
    try:   # Design plan 3, Step 7: Malaysia → Flows & finances, and the monthly MGS 2Y for the rate-gap card
        msb, msb_years = bnm_msb(old)
    except Exception as e:
        print(f"  BNM bulletin failed ({type(e).__name__}); kept previous")
        msb, msb_years = {}, None
    for t, (_, quarterly, series) in MSB.items():
        for sid, (_, label, unit, _) in series.items():
            keep(sid, msb.get(sid), dict(label=label, group="Macro · Malaysia" if unit != "%" else "Rates · Malaysia", kind="yield" if unit == "%" else "level", unit=unit,
                                         source=f"Bank Negara Malaysia API (Monthly Statistical Bulletin, table {t})"))
        first = next(iter(series))
        if first in out:
            out[first]["msb_years"] = (msb_years or {}).get(t) or (old.get(first) or {}).get("msb_years", [])
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
