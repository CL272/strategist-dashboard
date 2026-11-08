"""
China & Japan macro.

  OECD Data API (no key)   China: CPI, trade, rates, production, confidence, CLI
                           Japan: production, unemployment, wages, retail, exports, CLI
                           Global composite leading indicators
  Bank of Japan API (no key)  Tankan, call rate, producer & import prices, monetary base, BoJ assets
  e-Stat API (ESTAT_APP_ID)   Japan CPI: headline, core (ex fresh food), core-core (ex fresh food & energy)

Returns series in the same format as the other modules, written into asia.json by asia.py.
"""
from __future__ import annotations

import io
import re

import pandas as pd

from fetch import DIAG, get, get_secret

OECD = "https://sdmx.oecd.org/public/rest/data/{flow}/{key}"
BOJ = "https://www.stat-search.boj.or.jp/api/v1/getDataCode"
ESTAT = "https://api.e-stat.go.jp/rest/3.0/app/json/{fn}"
START = "2000-01"

# OECD key economic indicators: (id, area, measure, unit, activity, transformation, label, unit_out, group)
KEI = [
    ("CN_CPI_YOY",  "CHN", "CP",     "GR", None,  "GY", "China CPI YoY",                    "%",   "Macro · China"),
    ("CN_EXP_YOY",  "CHN", "EX",     "GR", "_T",  "GY", "China exports YoY (USD, SA)",      "%",   "Macro · China"),
    ("CN_IMP_YOY",  "CHN", "IM",     "GR", "_T",  "GY", "China imports YoY (USD, SA)",      "%",   "Macro · China"),
    ("CN_10Y",      "CHN", "IRLT",   "PA", None,  None, "China 10Y government bond yield",  "%",   "Rates · China"),
    ("CN_3M",       "CHN", "IR3TIB", "PA", None,  None, "China 3M interbank rate",          "%",   "Rates · China"),
    ("CN_BCI",      "CHN", "BCICP",  "PB", None,  None, "China business confidence (OECD, from NBS PMI)", "idx", "Macro · China"),
    ("CN_CCI",      "CHN", "CCICP",  "PB", None,  None, "China consumer confidence",        "idx", "Macro · China"),
    ("JP_IP_YOY",   "JPN", "PRVM",   "GR", "BTE", "GY", "Japan industrial production YoY",  "%",   "Macro · Japan"),
    ("JP_UNEMP",    "JPN", "UNEMP",  "PT_LF", None, None, "Japan unemployment rate",        "%",   "Macro · Japan"),
    ("JP_WAGES_YOY","JPN", "H_EARN", "GR", None,  "GY", "Japan hourly earnings YoY",        "%",   "Macro · Japan"),
    ("JP_RETAIL_YOY","JPN","TOVM",   "GR", None,  "GY", "Japan retail sales volume YoY",    "%",   "Macro · Japan"),
    ("JP_EXP_YOY",  "JPN", "EX",     "GR", "_T",  "GY", "Japan exports YoY (USD, SA)",      "%",   "Macro · Japan"),
]
CLI_AREAS = {"USA": "United States", "CHN": "China", "JPN": "Japan", "DEU": "Germany", "KOR": "Korea", "IND": "India"}

# Bank of Japan: (id, db, code, label, unit, group)
BOJ_SERIES = [
    ("JP_TANKAN_LM",   "CO",   "TK99F1000601GCQ01000", "Tankan: large manufacturers, actual",         "DI",  "Macro · Japan"),
    ("JP_TANKAN_LM_F", "CO",   "TK99F1000601GCQ11000", "Tankan: large manufacturers, forecast",       "DI",  "Macro · Japan"),
    ("JP_TANKAN_LN",   "CO",   "TK99F2000601GCQ01000", "Tankan: large non-manufacturers, actual",     "DI",  "Macro · Japan"),
    ("JP_TANKAN_LN_F", "CO",   "TK99F2000601GCQ11000", "Tankan: large non-manufacturers, forecast",   "DI",  "Macro · Japan"),
    ("JP_CALL",        "FM01", "STRDCLUCON",           "Japan overnight call rate",                   "%",   "Rates · Japan"),
    ("JP_PPI_YOY",     "PR01", "PRCG20_2200000000%",   "Japan producer prices YoY",                   "%",   "Macro · Japan"),
    ("JP_IMPPX_YOY",   "PR01", "PRCG20_2600000000%",   "Japan import prices YoY (yen basis)",         "%",   "Macro · Japan"),
    ("JP_MB_YOY",      "MD01", "MABS1AN11@",           "Japan monetary base YoY",                     "%",   "Macro · Japan"),
    ("JP_BOJ_ASSETS",  "BS01", "MABJMTA",              "Bank of Japan total assets",                  "JPY 100mn", "Macro · Japan"),
]


def _period(p: str) -> pd.Timestamp | None:
    p = str(p)
    try:
        if re.fullmatch(r"\d{4}-\d{2}", p):
            return pd.Timestamp(p + "-01")
        if re.fullmatch(r"\d{4}-Q\d", p):
            return pd.Timestamp(int(p[:4]), (int(p[-1]) - 1) * 3 + 1, 1)
        return pd.Timestamp(p)
    except Exception:
        return None


def oecd_frame(flow: str, key: str) -> pd.DataFrame | None:
    r = get(OECD.format(flow=flow, key=key), {"startPeriod": START, "format": "csvfile"})
    if r is None or not r.text.startswith("DATAFLOW"):
        return None
    df = pd.read_csv(io.StringIO(r.text))
    df["t"] = df["TIME_PERIOD"].map(_period)
    return df.dropna(subset=["t", "OBS_VALUE"])


def _pick(df, area, measure, unit, activity, transf) -> pd.Series | None:
    m = (df["REF_AREA"] == area) & (df["MEASURE"] == measure) & (df["UNIT_MEASURE"] == unit)
    if activity:
        m &= df["ACTIVITY"] == activity
    if transf:
        m &= df["TRANSFORMATION"] == transf
    g = df[m]
    if g.empty:
        return None
    # if several variants remain (e.g. SA and not SA), keep the one with the most observations
    keycols = [c for c in ("ADJUSTMENT", "ACTIVITY", "TRANSFORMATION") if c in g]
    best = max(g.groupby(keycols), key=lambda kv: len(kv[1]))[1]
    s = pd.Series(best["OBS_VALUE"].astype(float).values, index=best["t"]).sort_index()
    return s[~s.index.duplicated(keep="last")]


def boj_series(db: str, code: str) -> pd.Series | None:
    start = "197001" if db != "FM01" else "200001"
    r = get(BOJ, {"format": "json", "lang": "en", "db": db, "code": code, "startDate": start})
    if r is None:
        return None
    try:
        res = r.json()["RESULTSET"][0]["VALUES"]
    except Exception:
        return None
    pts = {}
    for d, v in zip(res["SURVEY_DATES"], res["VALUES"]):
        if v is None:
            continue
        d = str(d)
        if len(d) == 8:
            t = pd.Timestamp(int(d[:4]), int(d[4:6]), int(d[6:]))
        elif len(d) == 6 and db == "CO":          # quarterly: YYYYQQ
            t = pd.Timestamp(int(d[:4]), (int(d[4:]) - 1) * 3 + 1, 1)
        elif len(d) == 6:
            t = pd.Timestamp(int(d[:4]), int(d[4:]), 1)
        else:
            continue
        pts[t] = float(v)
    s = pd.Series(pts).sort_index()
    return s if len(s) > 8 else None


# ------------------------------------------------------------------ e-Stat (Japan CPI)
def _estat(fn: str, params: dict, app_id: str) -> dict | None:
    r = get(ESTAT.format(fn=fn), {"appId": app_id, **params})
    if r is None:
        return None
    try:
        return r.json()
    except Exception:
        return None


def _as_list(x):
    return x if isinstance(x, list) else ([x] if x is not None else [])


def estat_cpi(app_id: str, notes: list) -> dict[str, pd.Series]:
    """Find the national monthly CPI tables (newest base years) and return YoY for headline/core/core-core."""
    lst = _estat("getStatsList", {"statsCode": "00200573", "searchWord": "全国 月次", "limit": 200}, app_id)
    if not lst:
        notes.append("e-Stat: table search failed")
        return {}
    res = lst.get("GET_STATS_LIST", {})
    st = res.get("RESULT", {})
    if str(st.get("STATUS")) not in ("0", "1", "2"):
        notes.append(f"e-Stat: {st.get('ERROR_MSG', 'error')}")
        return {}
    tables = _as_list(res.get("DATALIST_INF", {}).get("TABLE_INF"))
    cands = []
    for t in tables:
        title = t.get("TITLE")
        title = title.get("$", "") if isinstance(title, dict) else str(title or "")
        stat = t.get("STATISTICS_NAME", "")
        full = f"{stat} {title}"
        if "品目別価格指数" in full and "全国" in full and "月" in full and "年平均" not in full:
            cands.append((str(t.get("OPEN_DATE", "")), str(t.get("@id")), full.strip()))
    cands.sort(reverse=True)
    if not cands:
        notes.append(f"e-Stat: no national monthly CPI table among {len(tables)} results")
        return {}
    want = {"JP_CPI_YOY": ["総合"], "JP_CORE_YOY": ["生鮮食品を除く総合"], "JP_CORECORE_YOY": ["生鮮食品及びエネルギーを除く総合"]}
    found: dict[str, list[pd.Series]] = {k: [] for k in want}
    for _, sid, title in cands[:3]:
        d = _estat("getStatsData", {"statsDataId": sid, "metaGetFlg": "Y", "cntGetFlg": "N", "limit": 100000}, app_id)
        if not d:
            continue
        sd = d.get("GET_STATS_DATA", {}).get("STATISTICAL_DATA", {})
        objs = {o.get("@id"): _as_list(o.get("CLASS")) for o in _as_list(sd.get("CLASS_INF", {}).get("CLASS_OBJ"))}
        cat = objs.get("cat01", [])
        code_for = {}
        for k, names in want.items():
            for c in cat:
                if c.get("@name", "").strip().split(" ")[-1] in names or c.get("@name", "").strip() in names:
                    code_for[k] = c.get("@code")
                    break
        tabs = objs.get("tab", [])
        yoy_tab = next((c.get("@code") for c in tabs if "前年同月比" in c.get("@name", "")), None)
        idx_tab = next((c.get("@code") for c in tabs if c.get("@name", "") in ("指数", "指数値")), tabs[0].get("@code") if tabs else None)
        area = next((c.get("@code") for c in objs.get("area", []) if "全国" in c.get("@name", "")), None)
        notes.append(f"e-Stat table {sid}: {title[:60]} | cats {sorted(code_for)} | tab {'YoY' if yoy_tab else 'index'}")
        rows = _as_list(sd.get("DATA_INF", {}).get("VALUE"))
        for k, code in code_for.items():
            pts = {}
            for v in rows:
                if v.get("@cat01") != code or (area and v.get("@area", area) != area):
                    continue
                tab = v.get("@tab")
                if (yoy_tab and tab != yoy_tab) or (not yoy_tab and idx_tab and tab != idx_tab):
                    continue
                tc = str(v.get("@time", ""))
                m = re.fullmatch(r"(\d{4})00(\d{2})\d{2}", tc)
                if not m or int(m.group(2)) == 0:
                    continue
                try:
                    pts[pd.Timestamp(int(m.group(1)), int(m.group(2)), 1)] = float(v.get("$"))
                except (TypeError, ValueError):
                    continue
            s = pd.Series(pts).sort_index()
            if len(s) > 24:
                found[k].append(s if yoy_tab else (s / s.shift(12) - 1) * 100)
    out = {}
    for k, parts in found.items():
        if parts:   # newest base first; older base fills earlier history
            s = parts[0]
            for p in parts[1:]:
                s = s.combine_first(p)
            out[k] = s.dropna()
    return out


def build(status: dict) -> dict[str, tuple[pd.Series, dict]]:
    out: dict[str, tuple[pd.Series, dict]] = {}
    print("Asia: China & Japan (OECD)")
    measures = "+".join(sorted({m for _, _, m, *_ in KEI}))
    kei = oecd_frame("OECD.SDD.STES,DSD_KEI@DF_KEI,", f"CHN+JPN.M.{measures}....")
    for sid, area, meas, unit, act, tr, label, uout, group in KEI:
        s = _pick(kei, area, meas, unit, act, tr) if kei is not None else None
        if s is not None and len(s) > 12:
            kind = "yield" if group.startswith("Rates") else "level"
            out[sid] = (s, dict(label=label, unit=uout, kind=kind, group=group, source=f"OECD Main Economic Indicators ({area} {meas})"))
    cli = oecd_frame("OECD.SDD.STES,DSD_STES@DF_CLI,", f"{'+'.join(CLI_AREAS)}.M.LI...AA...H")
    if cli is not None:
        for area, name in CLI_AREAS.items():
            g = cli[cli["REF_AREA"] == area]
            if len(g):
                s = pd.Series(g["OBS_VALUE"].astype(float).values, index=g["t"]).sort_index()
                out[f"CLI_{area}"] = (s, dict(label=f"{name} leading indicator", unit="idx", kind="level", group="Macro · Leading indicators",
                                              source="OECD Composite Leading Indicators (amplitude adjusted, 100 = trend)"))
    print("Asia: Japan (Bank of Japan)")
    for sid, db, code, label, unit, group in BOJ_SERIES:
        s = boj_series(db, code)
        if s is not None:
            kind = "yield" if group.startswith("Rates") else "level"
            out[sid] = (s, dict(label=label, unit=unit, kind=kind, group=group, source=f"Bank of Japan ({db} {code})"))
    print("Asia: Japan CPI (e-Stat)")
    app_id = get_secret("ESTAT_APP_ID")
    notes: list[str] = []
    if app_id:
        names = {"JP_CPI_YOY": "Japan CPI YoY", "JP_CORE_YOY": "Japan core CPI YoY (ex fresh food)",
                 "JP_CORECORE_YOY": "Japan core-core CPI YoY (ex fresh food & energy)"}
        for k, s in estat_cpi(app_id, notes).items():
            out[k] = (s, dict(label=names[k], unit="%", kind="level", group="Macro · Japan",
                              source="Statistics Bureau of Japan via e-Stat (Consumer Price Index, national, monthly)"))
    else:
        notes.append("e-Stat: no ESTAT_APP_ID / ESTAT_API_KEY secret")
    for n in notes:
        print("      " + n)
        if len(DIAG) < 12:
            DIAG.append(n)
    for sid in [k[0] for k in KEI] + [f"CLI_{a}" for a in CLI_AREAS] + [b[0] for b in BOJ_SERIES] + ["JP_CPI_YOY", "JP_CORE_YOY", "JP_CORECORE_YOY"]:
        status[sid] = "ok" if sid in out else "missing"
    return out
