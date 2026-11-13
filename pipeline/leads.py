"""
Leading indicators (WP51, owner's request, 13 Nov 2026). Writes docs/data/leads.json.

Sources (all public, no keys):
- NY Fed Global Supply Chain Pressure Index (gscpi_data.xlsx, monthly, standard deviations from average).
- Zillow Observed Rent Index, United States (asking rents for new leases, monthly from 2015).
- OECD: composite leading indices for 17 economies (for the diffusion index) and narrow and broad money for nine
  economies (for global real money growth; China publishes no series to the OECD, so the measure is "ex-China").
- data.gov.my (Bank Negara, DOSM, JPJ, Tourism Malaysia, Energy Commission): online payments (FPX, daily), car
  registrations, tourist arrivals, electricity use, machinery and electronics exports, export volumes.

Derived here, from the files written earlier in the run (so the Signals engine can use them):
- regional Fed new orders minus inventories and prices paid; the four US cycle baskets; month-end ratios for the
  market canaries; the Asian trade pulse; the China credit impulse (BIS, quarterly).

Isolated: each source that fails keeps its previously published series.
"""
from __future__ import annotations

import io
import math
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests

from fetch import load_existing, pack, unpack, write

UA = {"User-Agent": "Mozilla/5.0 (compatible; dashboard data refresh)"}
GSCPI_URL = "https://www.newyorkfed.org/medialibrary/research/interactives/gscpi/downloads/gscpi_data.xlsx"
ZORI_URL = "https://files.zillowstatic.com/research/public_csvs/zori/Metro_zori_uc_sfrcondomfr_sm_month.csv"
OECD = "https://sdmx.oecd.org/public/rest/data/{flow}/{key}"
DGM = "https://api.data.gov.my/data-catalogue/"

# the 17 economies with a current OECD leading index (checked 13 Nov 2026)
CLI_ECON = ["USA", "CAN", "MEX", "BRA", "GBR", "DEU", "FRA", "ITA", "ESP", "TUR", "ZAF", "CHN", "JPN", "KOR", "IND", "IDN", "AUS"]
# weights for global money growth: nominal GDP, USD trillions (IMF, 2024), renormalised over what is available each month
MONEY_W = {"USA": 29.2, "EA20": 16.4, "JPN": 4.0, "IND": 3.9, "GBR": 3.6, "CAN": 2.2, "BRA": 2.2, "KOR": 1.9, "AUS": 1.8}

# US cycle baskets (EPB-style sequence): component, transform, sign
#   g6 = six-month annualised growth of the 3-month average; d6 = six-month change; lvl = 3-month average level
BASKETS = {
    "LEAD": ("Leading", [("PERMIT1", "g6", 1), ("LD_OI_PHI", "lvl", 1), ("M2REAL", "g6", 1), ("T10YFF", "lvl", 1), ("AWHMAN", "d6", 1)]),
    "CYC": ("Cyclical", [("RES_JOBS", "g6", 1), ("DMANEMP", "g6", 1), ("HTRUCKS", "g6", 1), ("HSN1F", "g6", 1), ("NEWORDER", "g6", 1)]),
    "AGG": ("Aggregate", [("PAYEMS", "g6", 1), ("REALINC_XT", "g6", 1), ("RETAIL_REAL", "g6", 1), ("INDPRO", "g6", 1)]),
    "LAG": ("Lagging", [("UNRATE", "d6", -1), ("CORE_CPI", "g6", 1)]),
}
CANARIES = {"CAN_XHB": ("XHB", "SPX", "Homebuilders ÷ S&P 500"), "CAN_KBE": ("KBE", "SPX", "Banks ÷ S&P 500"),
            "CAN_KRE": ("KRE", "SPX", "Regional banks ÷ S&P 500"), "CAN_IYT_XLU": ("IYT", "XLU", "Transports ÷ utilities"),
            "CAN_SPHB_SPLV": ("SPHB", "SPLV", "High beta ÷ low volatility"), "CAN_SOX": ("SOX", "SPX", "Semiconductors ÷ S&P 500"),
            "CAN_XLY_XLP": ("XLY", "XLP", "Discretionary ÷ staples")}
PULSE = [("KR_EXP_YOY", False), ("TW_EXP_YOY", False), ("SG_NODX_YOY", False), ("JP_EXP_YOY", False), ("CN_EXP_YOY", False),
         ("TW_ORDERS_YOY", False), ("KR_CHIP_EXP", True)]


def _meta(label, unit, source, group="Macro · Leading", freq=None, kind="level"):
    m = {"label": label, "group": group, "kind": kind, "unit": unit, "source": source}
    if freq:
        m["freq"] = freq
    return m


def _ser(s: pd.Series, label, unit, source, **kw) -> dict:
    return {**_meta(label, unit, source, **kw), **pack(s.dropna())}


def _month(s: pd.Series) -> pd.Series:
    """Month-start index, last value in the month."""
    s = s.dropna().sort_index()
    return s.groupby(s.index.to_period("M")).last().pipe(lambda x: x.set_axis(x.index.to_timestamp()))


# ------------------------------------------------------------------ sources
def gscpi() -> dict:
    r = requests.get(GSCPI_URL, headers=UA, timeout=60)
    r.raise_for_status()
    x = pd.read_excel(io.BytesIO(r.content), sheet_name="GSCPI Monthly Data", header=None)
    t = pd.to_datetime(x.iloc[:, 0], errors="coerce")
    v = pd.to_numeric(x.iloc[:, 1], errors="coerce")
    s = pd.Series(v.values, index=t).dropna()
    s = _month(s[s.index.notna()])
    if len(s) < 200:
        raise RuntimeError("short GSCPI")
    return {"GSCPI": _ser(s, "Global supply chain pressure (NY Fed)", "sd", "Federal Reserve Bank of New York, Global Supply Chain Pressure Index",
                          group="Macro · Inflation")}


def zori() -> dict:
    r = requests.get(ZORI_URL, headers=UA, timeout=90)
    r.raise_for_status()
    z = pd.read_csv(io.StringIO(r.text))
    row = z[z["RegionName"] == "United States"].iloc[0]
    cols = [c for c in z.columns if c[:2] in ("19", "20")]
    s = pd.Series(pd.to_numeric(row[cols], errors="coerce").values, index=pd.to_datetime(cols)).dropna()
    return {"ZORI_US": _ser(_month(s), "US asking rents (Zillow Observed Rent Index)", "USD", "Zillow Observed Rent Index (all homes, smoothed), United States",
                            group="Macro · Inflation")}


def _oecd(flow: str, key: str, start: str = "1980-01") -> pd.DataFrame:
    r = requests.get(OECD.format(flow=flow, key=key), params={"startPeriod": start, "format": "csvfile"}, headers=UA, timeout=120)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    df["t"] = pd.to_datetime(df["TIME_PERIOD"].astype(str) + "-01", errors="coerce")
    return df.dropna(subset=["t", "OBS_VALUE"])


def cli_diffusion() -> dict:
    df = _oecd("OECD.SDD.STES,DSD_STES@DF_CLI,", f"{'+'.join(CLI_ECON)}.M.LI...AA...H")
    x = df.pivot_table(index="t", columns="REF_AREA", values="OBS_VALUE").sort_index()
    up = (x > x.shift(6)).astype(float).where(x.shift(6).notna() & x.notna())
    n = up.notna().sum(axis=1)
    s = (up.sum(axis=1) / n.where(n > 0) * 100)[n >= 10]
    return {"LD_CLI_DIFF": _ser(s, f"Leading-index diffusion: share of {len(CLI_ECON)} economies rising over 6 months", "%",
                                f"OECD composite leading indices ({', '.join(CLI_ECON)}); share above their level 6 months earlier")}


def money(fred: dict, asia: dict) -> dict:
    areas = list(MONEY_W)
    m = _oecd("OECD.SDD.STES,DSD_KEI@DF_KEI,", f"{'+'.join(areas)}.M.MANM+MABM....")
    m = m[m["UNIT_MEASURE"] == "IX"]
    p = _oecd("OECD.SDD.STES,DSD_KEI@DF_KEI,", f"{'+'.join(areas)}.M.CP....")
    p = p[p["UNIT_MEASURE"] == "IX"]
    infl = {}
    for a in areas:   # CPI inflation, year on year: OECD where current, else FRED (euro area) or the Japan series already loaded
        g = p[p["REF_AREA"] == a]
        s = pd.Series(g["OBS_VALUE"].astype(float).values, index=g["t"]).sort_index()
        s = s[~s.index.duplicated(keep="last")]
        y = (s / s.shift(12) - 1) * 100
        if a == "EA20" and "EA_HICP" in fred:   # OECD's euro-area CPI stopped in Dec 2025
            h = _month(unpack(fred["EA_HICP"]))
            y = ((h / h.shift(12) - 1) * 100).combine_first(y)
        if a == "JPN" and "JP_CPI_YOY" in asia:
            y = _month(unpack(asia["JP_CPI_YOY"])).combine_first(y)
        infl[a] = y.dropna()
    out = {}
    for meas, sid, lab in (("MANM", "LD_RNM6", "narrow"), ("MABM", "LD_RBM6", "broad")):
        rows = {}
        for a in areas:
            g = m[(m["REF_AREA"] == a) & (m["MEASURE"] == meas)]
            if g.empty or a not in infl:
                continue
            s = pd.Series(g["OBS_VALUE"].astype(float).values, index=g["t"]).sort_index()
            s = s[~s.index.duplicated(keep="last")]
            if s.index[-1] < pd.Timestamp.today() - pd.DateOffset(months=9):   # stopped reporting (Brazil and India broad money end in 2018)
                continue
            g6 = ((s / s.shift(6)) ** 2 - 1) * 100
            pi = infl[a].reindex(g6.index.union(infl[a].index)).ffill(limit=3).reindex(g6.index)
            rows[a] = (g6 - pi).dropna()
        x = pd.DataFrame(rows).sort_index()
        w = pd.Series(MONEY_W)[x.columns]
        have = x.notna()
        cover = (have * w).sum(axis=1) / w.sum()
        s = (x.fillna(0) * w).sum(axis=1) / (have * w).sum(axis=1)
        s = s[(cover >= 0.6) & (have.sum(axis=1) >= 4)]
        out[sid] = _ser(s, f"Global real {lab} money, 6-month annualised growth (ex-China)", "%",
                        f"OECD key indicators ({meas}) for {', '.join(x.columns)}, less CPI inflation; GDP-weighted. China publishes no series to the OECD.")
    return out


def _dgm(dataset: str, filt: str | None = None) -> pd.DataFrame:
    params = {"id": dataset, "limit": 100000}
    if filt:
        params["filter"] = filt
    r = requests.get(DGM, params=params, headers=UA, timeout=90)
    r.raise_for_status()
    d = pd.DataFrame(r.json())
    d["date"] = pd.to_datetime(d["date"])
    return d.sort_values("date")


def malaysia() -> dict:
    out = {}
    src = "data.gov.my"
    for model, sid, lab in (("B2C", "MY_FPX_B2C", "consumers"), ("B2B", "MY_FPX_B2B", "businesses")):
        d = _dgm("trnsc_daily_fpx", f"{model}@model").set_index("date")["value"].astype(float)
        d = d.asfreq("D").fillna(0).rolling(28, min_periods=28).sum() / 1e9
        out[sid] = _ser(d, f"Malaysia online payments (FPX) by {lab}, 28-day total", "RM bn", f"Bank Negara Malaysia via {src} (trnsc_daily_fpx, {model})",
                        group="Malaysia · Pulse")
    c = _dgm("registrations_type_fuel", "car@type")
    c = c[c["fuel"] == "all_fuels"].set_index("date")["registrations"].astype(float)
    out["MY_CARS"] = _ser(c, "Malaysia new car registrations", "cars", f"Road Transport Department via {src} (registrations_type_fuel)", group="Malaysia · Pulse")
    for code, sid, lab in (("ALL", "MY_ARR", "all countries"), ("CHN", "MY_ARR_CN", "from China"), ("SGP", "MY_ARR_SG", "from Singapore")):
        a = _dgm("arrivals", f"{code}@country").set_index("date")["arrivals"].astype(float)
        out[sid] = _ser(a, f"Malaysia tourist arrivals, {lab}", "persons", f"Tourism Malaysia via {src} (arrivals)", group="Malaysia · Pulse")
    for sec, sid, lab in (("local_commercial", "MY_ELEC_COM", "business (commercial and industrial)"), ("total", "MY_ELEC_TOT", "total")):
        e = _dgm("electricity_consumption", f"{sec}@sector").set_index("date")["consumption"].astype(float)
        out[sid] = _ser(e, f"Malaysia electricity use, {lab}", "GWh", f"Energy Commission via {src} (electricity_consumption)", group="Malaysia · Pulse")
    x = _dgm("trade_sitc_1d", "7@section").set_index("date")["exports"].astype(float) / 1e9
    out["MY_EXP_EE"] = _ser(x, "Malaysia machinery and transport equipment exports (SITC 7, incl. electronics)", "RM bn", f"DOSM via {src} (trade_sitc_1d)",
                            group="Malaysia · Pulse")
    v = _dgm("tradeidx", "overall@section").set_index("date")["exports_volume"].astype(float)
    out["MY_EXP_VOL"] = _ser(v, "Malaysia export volume index", "idx", f"DOSM via {src} (tradeidx)", group="Malaysia · Pulse")
    return out


# ------------------------------------------------------------------ derived
def _get(files: list[dict], sid: str) -> pd.Series | None:
    for f in files:
        if sid in f and isinstance(f[sid], dict) and "d" in f[sid]:
            return unpack(f[sid])
    return None


def _transform(s: pd.Series, how: str) -> pd.Series:
    x = _month(s).rolling(3, min_periods=3).mean()
    if how == "g6":
        return ((x / x.shift(6)) ** 2 - 1) * 100
    if how == "d6":
        return x - x.shift(6)
    return x


def derived(files: list[dict], have: dict) -> dict:
    out = {}
    g = lambda k: _get(files, k) if _get(files, k) is not None else (unpack(have[k]) if k in have else None)
    # regional Fed surveys: new orders minus inventories, prices paid
    pno, piv, eno, eiv, ppp, epp = (g(k) for k in ("PHILLY_NO", "PHILLY_IV", "EMPIRE_NO", "EMPIRE_IV", "PHILLY_PP", "EMPIRE_PP"))
    if pno is not None and piv is not None:
        oi = (_month(pno) - _month(piv)).dropna()
        out["LD_OI_PHI"] = _ser(oi, "Philadelphia Fed new orders minus inventories", "pts", "Philadelphia Fed manufacturing survey via FRED (NOCDFSA066MSFRBPHI − IVCDFSA066MSFRBPHI)")
        have["LD_OI_PHI"] = out["LD_OI_PHI"]
        if eno is not None and eiv is not None:
            avg = pd.concat([oi, (_month(eno) - _month(eiv))], axis=1).dropna().mean(axis=1)
            out["LD_OI_AVG"] = _ser(avg, "Regional Fed new orders minus inventories (Philadelphia and New York)", "pts",
                                    "Philadelphia and New York Fed manufacturing surveys via FRED; average of the two")
    if ppp is not None and epp is not None:
        pp = pd.concat([_month(ppp), _month(epp)], axis=1).dropna().mean(axis=1)
        out["LD_PP_AVG"] = _ser(pp, "Regional Fed prices paid (Philadelphia and New York)", "pts", "Philadelphia and New York Fed manufacturing surveys via FRED; average of the two",
                                group="Macro · Inflation")
    # cycle baskets: average z-score (expanding, so past values never use later data) of each component's six-month change
    for key, (name, comps) in BASKETS.items():
        zs = []
        for sid, how, sign in comps:
            s = g(sid)
            if s is None:
                continue
            y = _transform(s, how).dropna() * sign
            mu, sd = y.expanding(120).mean(), y.expanding(120).std()
            zs.append(((y - mu) / sd).dropna())
        if len(zs) >= max(2, math.ceil(len(comps) / 2)):
            x = pd.concat(zs, axis=1, sort=True)
            b = x.mean(axis=1)[x.notna().sum(axis=1) >= math.ceil(len(comps) / 2)]
            out[f"LD_BASKET_{key}"] = _ser(b, f"US cycle: {name} basket", "z",
                                           f"Average of {len(zs)} components' six-month change, each in standard deviations from its own past (FRED: {', '.join(c[0] for c in comps)})",
                                           group="Macro · Cycle")
    # market canaries: month-end price ratios
    for sid, (a, b, lab) in CANARIES.items():
        sa, sb = g(a), g(b)
        if sa is not None and sb is not None:
            r = (_month(sa) / _month(sb)).dropna()
            out[sid] = _ser(r, lab, "ratio", f"Yahoo Finance ({a} ÷ {b}), month-end", group="Markets · Canaries")
    # Asian trade pulse: average z-score of the early exporters (3-month average, year on year)
    zs = []
    for sid, level in PULSE:
        s = g(sid)
        if s is None:
            continue
        m = _month(s)
        y = (m / m.shift(12) - 1) * 100 if level else m
        y = y.rolling(3, min_periods=3).mean().dropna()
        y = y[y.index >= "2000-01-01"]
        zs.append(((y - y.expanding(60).mean()) / y.expanding(60).std()).dropna())
    if len(zs) >= 4:
        x = pd.concat(zs, axis=1, sort=True)
        out["LD_ASIA_PULSE"] = _ser(x.mean(axis=1)[x.notna().sum(axis=1) >= 4], "Asian trade pulse (early exporters)", "z",
                                    "Korea, Taiwan, Singapore, Japan and China exports, Taiwan export orders, Korean chip exports: 3-month average growth, "
                                    "each in standard deviations from its own past, averaged", group="Macro · Asia")
    # China credit impulse (BIS, quarterly): change in the 4-quarter flow of new credit, % of GDP
    cr, pct = g("CN_CREDIT"), g("CN_CREDIT_GDP")
    if cr is not None and pct is not None:
        df = pd.concat([cr, pct], axis=1, keys=["c", "p"]).dropna()
        gdp = df["c"] / (df["p"] / 100)
        flow = df["c"] - df["c"].shift(4)
        out["LD_CN_FLOW"] = _ser((flow / gdp * 100).dropna(), "China new credit over 4 quarters, % of GDP (BIS)", "% of GDP",
                                 "BIS credit to the private non-financial sector via FRED (CRDQCNAPABIS, QCNPAM770A)", group="Macro · China", freq="Q")
        out["LD_CN_IMPULSE"] = _ser(((flow - flow.shift(4)) / gdp * 100).dropna(), "China credit impulse (BIS, quarterly)", "% of GDP",
                                    "BIS via FRED: change over a year in the 4-quarter flow of new private credit, % of GDP. Arrives about a year late.",
                                    group="Macro · China", freq="Q")
    return out


def build(status: dict) -> None:
    print("Leading indicators (NY Fed, Zillow, OECD, data.gov.my, derived)")
    old = load_existing("leads.json")
    fred, yahoo, asia = load_existing("fred.json"), load_existing("yahoo.json"), load_existing("asia.json")
    files = [fred, yahoo, asia, load_existing("korea.json"), load_existing("taiwan.json"), load_existing("derived.json")]
    out: dict = {}
    steps = (("GSCPI", gscpi, ("GSCPI",)), ("Zillow rents", zori, ("ZORI_",)), ("OECD leading-index diffusion", cli_diffusion, ("LD_CLI_DIFF",)),
             ("OECD money", lambda: money(fred, asia), ("LD_RNM6", "LD_RBM6")), ("Malaysia pulse", malaysia, ("MY_",)),
             ("derived", lambda: derived(files, out), ("LD_OI", "LD_PP", "LD_BASKET", "CAN_", "LD_ASIA", "LD_CN")))
    for name, fn, prefixes in steps:
        try:
            got = fn()
            if not got:
                raise RuntimeError("no series")
            out.update(got)
            print(f"  {name}: {len(got)} series")
            for k in got:
                status[k] = "ok"
        except Exception as e:
            kept = {k: v for k, v in old.items() if k.startswith(prefixes) and k not in out}
            out.update(kept)
            print(f"  {name} failed ({type(e).__name__}: {str(e)[:80]}); kept {len(kept)} previous")
            for k in kept:
                status[k] = "stale (kept previous)"
    out["_meta"] = {"fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "cli_econ": CLI_ECON, "money_w": MONEY_W}
    write("leads.json", out)


if __name__ == "__main__":
    build({})
