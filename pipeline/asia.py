"""
Asia layer: Singapore (SingStat Table Builder, incl. MAS rates) and Malaysia (OpenDOSM, Bank Negara).
No API keys needed.

Each entry becomes a normal series in docs/data/asia.json (same format as fred.json),
with its source and table/series code recorded so the dashboard can quote it.
"""
from __future__ import annotations

import time
from datetime import date

import pandas as pd

from fetch import get, load_existing, pack, unpack, write

SINGSTAT = "https://tablebuilder.singstat.gov.sg/api/table/tabledata/{table}"
OPENDOSM = "https://api.data.gov.my/data-catalogue/"
BNM = "https://api.bnm.gov.my/public/{path}"
BNM_HDR = {"Accept": "application/vnd.BNM.API.v1+json"}

# (id, table, seriesNo, label, group, kind, unit, source text)
SG = [
    ("SORA",      "M700071", "21", "SORA (monthly avg)",            "Rates · Singapore", "yield", "%", "MAS via SingStat (M700071, Singapore Overnight Rate Average)"),
    ("SORA3M",    "M700071", "23", "3M compounded SORA",            "Rates · Singapore", "yield", "%", "MAS via SingStat (M700071, Compounded SORA 3M)"),
    ("SGS1Y",     "M700071", "18", "SGS 1Y T-bill yield",           "Rates · Singapore", "yield", "%", "MAS via SingStat (M700071, 1Y T-bill)"),
    ("SGS2Y",     "M700071", "13", "SGS 2Y yield",                  "Rates · Singapore", "yield", "%", "MAS via SingStat (M700071, SGS 2Y)"),
    ("SGS5Y",     "M700071", "10", "SGS 5Y yield",                  "Rates · Singapore", "yield", "%", "MAS via SingStat (M700071, SGS 5Y)"),
    ("SGS10Y",    "M700071", "15", "SGS 10Y yield",                 "Rates · Singapore", "yield", "%", "MAS via SingStat (M700071, SGS 10Y)"),
    ("SGS20Y",    "M700071", "20", "SGS 20Y yield",                 "Rates · Singapore", "yield", "%", "MAS via SingStat (M700071, SGS 20Y)"),
    ("SG_CPI",    "M213751", "1",  "Singapore CPI (all items)",     "Macro · Singapore", "level", "idx", "SingStat (M213751, CPI 2024=100)"),
    ("SG_CORE_YOY", "M213891", "1.2", "MAS core inflation YoY",     "Macro · Singapore", "level", "%", "MAS & SingStat (M213891, MAS Core Inflation Measure)"),
    ("SG_GDP",    "M015662", "1",  "Singapore real GDP (SA)",       "Macro · Singapore", "level", "S$ mn", "SingStat (M015662, GDP in chained 2015 dollars, SA)"),
    ("SG_NODX",   "M451301", "1",  "NODX total",                    "Macro · Singapore", "level", "S$ k", "Enterprise Singapore via SingStat (M451301)"),
    ("SG_NODX_CN","M451301", "1.10", "NODX to Mainland China",      "Macro · Singapore", "level", "S$ k", "Enterprise Singapore via SingStat (M451301)"),
    ("SG_NODX_US","M451301", "1.11", "NODX to United States",       "Macro · Singapore", "level", "S$ k", "Enterprise Singapore via SingStat (M451301)"),
    ("SG_UNEMP",  "M182342", "1",  "Singapore unemployment rate (SA)", "Macro · Singapore", "level", "%", "MOM via SingStat (M182342)"),
]

# (id, dataset, filter, value column, label, group, unit)
MY = [
    ("MY_CPI",      "cpi_headline", "overall@division", "index",    "Malaysia CPI",                "%"),
    ("MY_CORE_CPI", "cpi_core",     "overall@division", "index",    "Malaysia core CPI",           "%"),
    ("MY_IPI_YOY",  "ipi",          "growth_yoy@series", "index",   "Malaysia industrial production YoY", "%"),
    ("MY_UNEMP",    "lfs_month",    None,                "u_rate",  "Malaysia unemployment rate",  "%"),
    ("MY_EXPORTS",  "trade_sitc_1d", "overall@section",  "exports", "Malaysia exports",            "RM"),
    ("MY_GDP_YOY",  "gdp_qtr_real", "growth_yoy@series", "value",   "Malaysia real GDP YoY",       "%"),
]


def _singstat_key(k: str) -> pd.Timestamp | None:
    k = k.strip()
    try:
        if "Q" in k:                       # '2026 2Q'
            y, q = k.split()
            return pd.Timestamp(int(y), (int(q[0]) - 1) * 3 + 1, 1)
        return pd.to_datetime(k, format="%Y %b")   # '2026 Sep'
    except Exception:
        return None


def fetch_singstat(table: str, series_no: str) -> pd.Series | None:
    r = get(SINGSTAT.format(table=table), {"seriesNoORrowNo": series_no, "limit": 5000})
    if r is None:
        return None
    rows = (r.json().get("Data") or {}).get("row") or []
    row = next((x for x in rows if x.get("seriesNo") == series_no), None)
    if not row:
        return None
    pts = {}
    for c in row["columns"]:
        t = _singstat_key(c["key"])
        try:
            v = float(c["value"])
        except (TypeError, ValueError):
            continue
        if t is not None:
            pts[t] = v
    s = pd.Series(pts).sort_index()
    return s if len(s) > 12 else None


def fetch_opendosm(dataset: str, flt: str | None, col: str) -> pd.Series | None:
    params = {"id": dataset, "limit": 20000}
    if flt:
        params["filter"] = flt
    r = get(OPENDOSM, params)
    if r is None:
        return None
    df = pd.DataFrame(r.json())
    if df.empty or col not in df:
        return None
    s = pd.Series(pd.to_numeric(df[col], errors="coerce").values, index=pd.to_datetime(df["date"])).dropna().sort_index()
    return s[~s.index.duplicated(keep="last")] if len(s) > 12 else None


def fetch_opr() -> pd.Series | None:
    """OPR decision history (step series) from BNM, 2005 onward."""
    import requests
    pts = {}
    for y in range(2005, date.today().year + 1):
        try:
            r = requests.get(BNM.format(path=f"opr/year/{y}"), headers=BNM_HDR, timeout=30)
            if r.status_code != 200:
                continue
            for d in r.json().get("data", []):
                pts[pd.Timestamp(d["date"])] = float(d["new_opr_level"])
        except Exception:
            continue
        time.sleep(0.2)
    if len(pts) < 5:
        return None
    s = pd.Series(pts).sort_index()
    # expand decision dates to a month-end step series so it charts like a rate
    idx = pd.date_range(s.index.min(), pd.Timestamp.today().normalize(), freq="ME")
    return s.reindex(s.index.union(idx)).ffill().reindex(idx)


def build_asia(status: dict) -> dict[str, pd.Series]:
    old = load_existing("asia.json")
    out, series = {}, {}

    def keep(sid, s, meta):
        if s is not None and len(s):
            out[sid] = {**meta, **pack(s)}
            series[sid] = s
            status[sid] = "ok"
        elif sid in old:
            out[sid] = old[sid]
            series[sid] = unpack(old[sid])
            status[sid] = "stale (kept previous)"
        else:
            status[sid] = "missing"
        print(f"  {sid:<12} {status[sid]}")

    print("Asia: Singapore")
    for sid, table, sno, label, group, kind, unit, src in SG:
        keep(sid, fetch_singstat(table, sno), dict(label=label, group=group, kind=kind, unit=unit, source=src))
        time.sleep(0.2)
    print("Asia: Malaysia")
    for sid, ds, flt, col, label, unit in MY:
        kind = "level"
        keep(sid, fetch_opendosm(ds, flt, col), dict(label=label, group="Macro · Malaysia", kind=kind, unit=unit,
                                                     source=f"DOSM via OpenDOSM ({ds})"))
    keep("MY_OPR", fetch_opr(), dict(label="Malaysia OPR", group="Rates · Malaysia", kind="yield", unit="%",
                                     source="Bank Negara Malaysia API (opr)"))

    # China & Japan (OECD, Bank of Japan, e-Stat)
    import cnjp
    got = cnjp.build(status)
    expected = set(got) | {k for k in old if k.startswith(("CN_", "JP_", "CLI_"))}
    for sid in sorted(expected):
        s, meta = got.get(sid, (None, None))
        if meta is None:
            meta = {k: old[sid][k] for k in ("label", "group", "kind", "unit", "source") if k in old.get(sid, {})}
        keep(sid, None if s is None else s.dropna(), meta)

    # derived: growth rates and inflation
    def yoy(s, k=12):
        return (s / s.shift(k) - 1) * 100

    der = {}
    if "SG_CPI" in series:
        der["SG_CPI_YOY"] = (yoy(series["SG_CPI"]), "Singapore headline CPI YoY", "SingStat (M213751), YoY calculated")
    if "SG_GDP" in series:
        der["SG_GDP_YOY"] = (yoy(series["SG_GDP"], 4), "Singapore real GDP YoY", "SingStat (M015662), YoY calculated")
    for k, lab in (("SG_NODX", "NODX total"), ("SG_NODX_CN", "NODX to China"), ("SG_NODX_US", "NODX to US")):
        if k in series:
            der[k + "_YOY"] = (yoy(series[k].rolling(3).sum()), f"{lab}, YoY (3-month sum)",
                               "Enterprise Singapore via SingStat (M451301), YoY calculated")
    if "MY_CPI" in series:
        der["MY_CPI_YOY"] = (yoy(series["MY_CPI"]), "Malaysia headline CPI YoY", "DOSM via OpenDOSM (cpi_headline), YoY calculated")
    if "MY_CORE_CPI" in series:
        der["MY_CORE_YOY"] = (yoy(series["MY_CORE_CPI"]), "Malaysia core CPI YoY", "DOSM via OpenDOSM (cpi_core), YoY calculated")
    if "MY_EXPORTS" in series:
        der["MY_EXPORTS_YOY"] = (yoy(series["MY_EXPORTS"].rolling(3).sum()), "Malaysia exports, YoY (3-month sum)",
                                 "DOSM via OpenDOSM (trade_sitc_1d), YoY calculated")
    for sid, (s, label, src) in der.items():
        s = s.dropna()
        if len(s):
            grp = "Macro · Singapore" if sid.startswith("SG") else "Macro · Malaysia"
            out[sid] = dict(label=label, group=grp, kind="level", unit="%", source=src, **pack(s))
    write("asia.json", out)
    return series
