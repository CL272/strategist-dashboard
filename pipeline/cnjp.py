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
    # Korea, India, Indonesia, Australia (OECD Main Economic Indicators)
    ("KR_CPI_YOY",  "KOR", "CP",     "GR", None,  "GY", "Korea CPI YoY",                    "%",   "Macro · Korea"),
    ("KR_EXP_YOY",  "KOR", "EX",     "GR", "_T",  "GY", "Korea exports YoY (USD, SA)",      "%",   "Macro · Korea"),
    ("KR_IP_YOY",   "KOR", "PRVM",   "GR", "BTE", "GY", "Korea industrial production YoY",  "%",   "Macro · Korea"),
    ("KR_UNEMP",    "KOR", "UNEMP",  "PT_LF", None, None, "Korea unemployment rate",        "%",   "Macro · Korea"),
    ("KR_BCI",      "KOR", "BCICP",  "PB", None,  None, "Korea business confidence",        "idx", "Macro · Korea"),
    ("KR_10Y",      "KOR", "IRLT",   "PA", None,  None, "Korea 10Y government bond yield",  "%",   "Rates · Korea"),
    ("KR_3M",       "KOR", "IR3TIB", "PA", None,  None, "Korea 3M interbank rate",          "%",   "Rates · Korea"),
    ("KR_IMP_YOY",  "KOR", "IM",     "GR", "_T",  "GY", "Korea imports YoY (USD, SA)",      "%",   "Macro · Korea"),
    ("KR_CCI",      "KOR", "CCICP",  "PB", None,  None, "Korea consumer confidence",        "idx", "Macro · Korea"),
    ("KR_RETAIL_YOY","KOR","TOVM",   "GR", None,  "GY", "Korea retail sales volume YoY",    "%",   "Macro · Korea"),
    ("KR_CALL",     "KOR", "IRSTCI", "PA", None,  None, "Korea overnight call rate",        "%",   "Rates · Korea"),
    ("IN_CPI_YOY",  "IND", "CP",     "GR", None,  "GY", "India CPI YoY",                    "%",   "Macro · India"),
    ("IN_IMP_YOY",  "IND", "IM",     "GR", "_T",  "GY", "India imports YoY (USD, SA)",      "%",   "Macro · India"),
    ("IN_MFG_YOY",  "IND", "PRVM",   "GR", "C",   "GY", "India manufacturing output YoY",   "%",   "Macro · India"),
    ("IN_CALL",     "IND", "IRSTCI", "PA", None,  None, "India overnight call rate",        "%",   "Rates · India"),
    ("IN_EXP_YOY",  "IND", "EX",     "GR", "_T",  "GY", "India exports YoY (USD, SA)",      "%",   "Macro · India"),
    ("IN_IP_YOY",   "IND", "PRVM",   "GR", "BTE", "GY", "India industrial production YoY",  "%",   "Macro · India"),
    ("IN_10Y",      "IND", "IRLT",   "PA", None,  None, "India 10Y government bond yield",  "%",   "Rates · India"),
    ("IN_3M",       "IND", "IR3TIB", "PA", None,  None, "India 3M interbank rate",          "%",   "Rates · India"),
    ("ID_CPI_YOY",  "IDN", "CP",     "GR", None,  "GY", "Indonesia CPI YoY",                "%",   "Macro · Indonesia"),
    ("ID_EXP_YOY",  "IDN", "EX",     "GR", "_T",  "GY", "Indonesia exports YoY (USD, SA)",  "%",   "Macro · Indonesia"),
    ("ID_IP_YOY",   "IDN", "PRVM",   "GR", "C",   "GY", "Indonesia manufacturing output YoY", "%", "Macro · Indonesia"),
    ("ID_CCI",      "IDN", "CCICP",  "PB", None,  None, "Indonesia consumer confidence",    "idx", "Macro · Indonesia"),
    ("ID_CALL",     "IDN", "IRSTCI", "PA", None,  None, "Indonesia overnight call rate",    "%",   "Rates · Indonesia"),
    ("AU_EXP_YOY",  "AUS", "EX",     "GR", "_T",  "GY", "Australia exports YoY (USD, SA)",  "%",   "Macro · Australia"),
    ("AU_CCI",      "AUS", "CCICP",  "PB", None,  None, "Australia consumer confidence",    "idx", "Macro · Australia"),
]
# quarterly key indicators: real GDP growth and the current account
KEI_Q = [
    ("KR_GDP_YOY",  "KOR", "B1GQ_Q", "GR",      "_T", "GY", "Korea real GDP YoY",              "%", "Macro · Korea"),
    ("IN_GDP_YOY",  "IND", "B1GQ_Q", "GR",      "_T", "GY", "India real GDP YoY",              "%", "Macro · India"),
    # current account: Korea's 2026 surge (16-21% of GDP) was cross-checked against its goods trade surplus (WP21)
    ("KR_CA_GDP",   "KOR", "CA_GDP", "PT_B1GQ", None, None, "Korea current account, % of GDP", "%", "Macro · Korea"),
    ("IN_CA_GDP",   "IND", "CA_GDP", "PT_B1GQ", None, None, "India current account, % of GDP", "%", "Macro · India"),
]
CLI_AREAS = {"USA": "United States", "CHN": "China", "JPN": "Japan", "DEU": "Germany", "KOR": "Korea", "IND": "India",
             "AUS": "Australia", "IDN": "Indonesia"}

# OECD business confidence (manufacturing, amplitude adjusted, 100 = long-run average). The US series is built from
# the ISM manufacturing survey, so BCI_USA is the free long-history stand-in for the ISM PMI (100 ~ ISM 50).
BCI_AREAS = {"USA": "US (ISM-based)", "EA20": "Euro area", "DEU": "Germany", "JPN": "Japan", "CHN": "China", "KOR": "Korea", "G7": "G7"}

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
    """Japan CPI from the e-Stat CPI databases (newest two base years), national, YoY.

    e-Stat lists the CPI as one database per base year, e.g. 消費者物価指数（2025年基準）.
    For each: read its metadata to find the codes for all items / core / core-core and
    the nationwide area, then request just those series."""
    lst = _estat("getStatsList", {"statsCode": "00200573", "limit": 3000}, app_id)
    if not lst:
        notes.append("e-Stat: table search failed")
        return {}
    res = lst.get("GET_STATS_LIST", {})
    st = res.get("RESULT", {})
    if str(st.get("STATUS")) not in ("0", "1", "2"):
        notes.append(f"e-Stat: {st.get('ERROR_MSG', 'error')}")
        return {}

    def txt(x):
        return x.get("$", "") if isinstance(x, dict) else str(x or "")

    dbs = []
    for t in _as_list(res.get("DATALIST_INF", {}).get("TABLE_INF")):
        title = txt(t.get("TITLE")) or txt(t.get("STATISTICS_NAME"))
        m = re.search(r"(20\d{2})年基準", title)
        if m:
            dbs.append((int(m.group(1)), str(t.get("@id")), title))
    dbs.sort(reverse=True)
    if not dbs:
        notes.append("e-Stat: no CPI base-year database found")
        return {}
    want = {"JP_CPI_YOY": "総合", "JP_CORE_YOY": "生鮮食品を除く総合", "JP_CORECORE_YOY": "生鮮食品及びエネルギーを除く総合"}
    found: dict[str, list[pd.Series]] = {k: [] for k in want}
    for base, sid, title in dbs[:2]:
        meta = _estat("getMetaInfo", {"statsDataId": sid}, app_id)
        if not meta:
            continue
        objs = {o.get("@id"): (o.get("@name", ""), _as_list(o.get("CLASS")))
                for o in _as_list(meta.get("GET_META_INFO", {}).get("METADATA_INF", {}).get("CLASS_INF", {}).get("CLASS_OBJ"))}
        item_dim = next((k for k, (nm, cl) in objs.items() if any(c.get("@name", "").split(" ")[-1] == "総合" for c in cl)), None)
        if not item_dim:
            notes.append(f"e-Stat {base}: item dimension not found ({', '.join(f'{k}={nm}' for k, (nm, _) in objs.items())})")
            continue
        codes = {}
        for k, nm in want.items():
            for c in objs[item_dim][1]:
                if c.get("@name", "").strip().split(" ")[-1] == nm:
                    codes[k] = c.get("@code")
                    break
        params = {"statsDataId": sid, "metaGetFlg": "N", "cntGetFlg": "N", "limit": 100000,
                  "cd" + item_dim[0].upper() + item_dim[1:]: ",".join(codes.values())}
        for k, (nm, cl) in objs.items():
            if k in (item_dim, "time"):
                continue
            if k == "area":
                code = next((c.get("@code") for c in cl if "全国" in c.get("@name", "")), None)
            elif k == "tab":
                code = next((c.get("@code") for c in cl if "前年同月比" in c.get("@name", "")), None) or \
                       next((c.get("@code") for c in cl if c.get("@name", "") in ("指数", "指数値")), None)
            else:   # other dimensions (e.g. monthly vs annual series): prefer a 'monthly' member, else the first
                code = next((c.get("@code") for c in cl if "月" in c.get("@name", "") and "年" not in c.get("@name", "")), None)
            if code:
                params["cd" + k[0].upper() + k[1:]] = code
        yoy = "cdTab" in params and any("前年同月比" in c.get("@name", "") and c.get("@code") == params["cdTab"] for c in objs.get("tab", ("", []))[1])
        d = _estat("getStatsData", params, app_id)
        if not d:
            continue
        sd = d.get("GET_STATS_DATA", {})
        rows = _as_list(sd.get("STATISTICAL_DATA", {}).get("DATA_INF", {}).get("VALUE"))
        notes.append(f"e-Stat {base}-base ({sid}): {len(rows)} values, items {sorted(codes)}, {'YoY' if yoy else 'index'}")
        for k, code in codes.items():
            pts = {}
            for v in rows:
                if v.get("@" + item_dim) != code:
                    continue
                m = re.fullmatch(r"(\d{4})00(\d{2})\d{2}", str(v.get("@time", "")))
                if not m or not 1 <= int(m.group(2)) <= 12:
                    continue
                try:
                    pts[pd.Timestamp(int(m.group(1)), int(m.group(2)), 1)] = float(v.get("$"))
                except (TypeError, ValueError):
                    continue
            s = pd.Series(pts).sort_index()
            if len(s) > 12:
                found[k].append(s if yoy else (s / s.shift(12) - 1) * 100)
    out = {}
    for k, parts in found.items():
        if parts:   # newest base first; the older base fills earlier history
            s = parts[0]
            for p in parts[1:]:
                s = s.combine_first(p)
            out[k] = s.dropna()
    return out


def build(status: dict) -> dict[str, tuple[pd.Series, dict]]:
    out: dict[str, tuple[pd.Series, dict]] = {}
    print("Asia: China & Japan (OECD)")
    measures = "+".join(sorted({m for _, _, m, *_ in KEI}))
    kei = oecd_frame("OECD.SDD.STES,DSD_KEI@DF_KEI,", f"{'+'.join(sorted({a for _, a, *_ in KEI}))}.M.{measures}....")
    for sid, area, meas, unit, act, tr, label, uout, group in KEI:
        s = _pick(kei, area, meas, unit, act, tr) if kei is not None else None
        if s is not None and len(s) > 12:
            kind = "yield" if group.startswith("Rates") else "level"
            out[sid] = (s, dict(label=label, unit=uout, kind=kind, group=group, source=f"OECD Main Economic Indicators ({area} {meas})"))
    keiq = oecd_frame("OECD.SDD.STES,DSD_KEI@DF_KEI,", f"{'+'.join(sorted({a for _, a, *_ in KEI_Q}))}.Q.{'+'.join(sorted({m for _, _, m, *_ in KEI_Q}))}....")
    for sid, area, meas, unit, act, tr, label, uout, group in KEI_Q:
        s = _pick(keiq, area, meas, unit, act, tr) if keiq is not None else None
        if s is not None and len(s) > 8:
            out[sid] = (s, dict(label=label, unit=uout, kind="level", group=group, freq="Q", source=f"OECD Main Economic Indicators ({area} {meas}, quarterly)"))
    cli = oecd_frame("OECD.SDD.STES,DSD_STES@DF_CLI,", f"{'+'.join(CLI_AREAS)}.M.LI...AA...H")
    if cli is not None:
        for area, name in CLI_AREAS.items():
            g = cli[cli["REF_AREA"] == area]
            if len(g):
                s = pd.Series(g["OBS_VALUE"].astype(float).values, index=g["t"]).sort_index()
                out[f"CLI_{area}"] = (s, dict(label=f"{name} leading indicator", unit="idx", kind="level", group="Macro · Leading indicators",
                                              source="OECD Composite Leading Indicators (amplitude adjusted, 100 = trend)"))
    # Korea's leading index rebuilt without its share-price component (LOCOSP = the KOSPI): the average of the other
    # normalised OECD components, so the lead over equity markets is not circular
    comp = oecd_frame("OECD.SDD.STES,DSD_STES@DF_CLI,", "KOR.M.LOCOBS+LOCOIS+LOCOSI+LOCOSK+LOCOTT...NOR...")
    if comp is not None and len(comp):
        x = comp.pivot_table(index="t", columns="MEASURE", values="OBS_VALUE").sort_index()
        if x.shape[1] >= 4:
            out["KR_LI_XSP"] = (x.mean(axis=1).dropna(), dict(label="Korea leading index without share prices", unit="idx", kind="level", group="Macro · Leading indicators",
                                source=f"OECD Composite Leading Indicators: average of the normalised non-stock components ({', '.join(x.columns)})"))
    bci = oecd_frame("OECD.SDD.STES,DSD_STES@DF_CLI,", f"{'+'.join(BCI_AREAS)}.M.BCICP...AA...H")
    if bci is not None:
        for area, name in BCI_AREAS.items():
            g = bci[bci["REF_AREA"] == area]
            if len(g):
                s = pd.Series(g["OBS_VALUE"].astype(float).values, index=g["t"]).sort_index()
                out[f"BCI_{area}"] = (s[~s.index.duplicated(keep="last")], dict(label=f"{name} business confidence", unit="idx", kind="level",
                                      group="Macro · Business cycle", source="OECD business confidence, manufacturing (amplitude adjusted, 100 = long-run average)"
                                      + ("; based on the ISM manufacturing survey" if area == "USA" else "")))
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
        labels = {"JP_CPI_YOY": "Japan CPI YoY", "JP_CORE_YOY": "Japan core CPI YoY (ex fresh food)",
                 "JP_CORECORE_YOY": "Japan core-core CPI YoY (ex fresh food & energy)"}
        for k, s in estat_cpi(app_id, notes).items():
            out[k] = (s, dict(label=labels[k], unit="%", kind="level", group="Macro · Japan",
                              source="Statistics Bureau of Japan via e-Stat (Consumer Price Index, national, monthly)"))
    else:
        notes.append("e-Stat: no ESTAT_APP_ID / ESTAT_API_KEY secret")
    cpi_missing = not all(k in out for k in ("JP_CPI_YOY", "JP_CORE_YOY", "JP_CORECORE_YOY"))
    for n in notes:
        print("      " + n)
        if cpi_missing and len(DIAG) < 12:   # only surface e-Stat notes when something failed
            DIAG.append(n)
    for sid in ["KR_LI_XSP"] + [k[0] for k in KEI + KEI_Q] + [f"CLI_{a}" for a in CLI_AREAS] + [f"BCI_{a}" for a in BCI_AREAS] + [b[0] for b in BOJ_SERIES] + ["JP_CPI_YOY", "JP_CORE_YOY", "JP_CORECORE_YOY"]:
        status[sid] = "ok" if sid in out else "missing"
    return out
