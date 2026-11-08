"""
Composite stress panel and peak signposts - ported from the earlier Streamlit dashboard
(legacy/data/composite.py, legacy/data/registry.py, legacy/data/growth.py, legacy/data/signposts.py).

COMPOSITE STRESS PANEL (legacy method, unchanged)
  1. Resample every member to a weekly (Friday) grid.
  2. Percentile-rank on a trailing 10-year window (minimum 104 weeks), so no reading uses its own future.
  3. Sign-align: series where LOW means stress are flipped, so every row reads "higher = more stress".
  4. Average within block (Funding, Credit, Growth), then across blocks, unweighted.
  Bands: Calm < 25, Normal 25-50, Above normal 50-75, Elevated 75-90, Acute >= 90.
  Cross-check: OFR Financial Stress Index percentile-ranked on exactly the same basis (not a member).

PEAK SIGNPOSTS (legacy rules, unchanged)
  Nine late-cycle rules evaluated monthly using only trailing data; a rule whose inputs do not reach a date
  is excluded from that date's denominator. Shown at the five S&P 500 peaks and the latest three months.
"""
from __future__ import annotations

import io

import pandas as pd

from fetch import DIAG, get as http_get, write

WEEKLY = "W-FRI"
WINDOW_YEARS, MIN_OBS = 10, 104
OFR_URL = "https://www.financialresearch.gov/financial-stress-index/data/fsi.csv"

# (dashboard series id, label, block, higher_is_stress, unit)  - legacy registry.composite_members()
MEMBERS = [
    ("SRF", "Repo / SRF take-up", "Funding", True, "$bn"),
    ("WPC", "Discount window", "Funding", True, "$mn"),
    ("NET_LIQ", "Net liquidity", "Funding", False, "$tn"),
    ("SOFR_IORB", "SOFR − IORB", "Funding", True, "bp"),
    ("EFFR_IORB", "EFFR − IORB", "Funding", True, "bp"),
    ("RES_GDP", "Reserves / GDP", "Funding", False, "%"),
    ("RES_ASSETS", "Reserves / bank assets", "Funding", False, "%"),
    ("NFCI", "NFCI", "Credit", True, "idx"),
    ("ANFCI", "Adjusted NFCI", "Credit", True, "idx"),
    ("STLFSI", "St. Louis Fed FSI", "Credit", True, "idx"),
    ("BAA_10Y", "Baa − 10y spread", "Credit", True, "%"),
    ("HY_OAS", "HY OAS", "Credit", True, "%"),
    ("CCC_OAS", "CCC & lower OAS", "Credit", True, "%"),
    ("VIXCLS", "VIX", "Credit", True, "idx"),
    ("DECOMP", "CCC − BB decompression", "Credit", True, "pp"),
    ("CFNAIMA3", "CFNAI-MA3", "Growth", False, "idx"),
    ("WEI", "Weekly Economic Index", "Growth", False, "idx"),
    ("IC4WSA", "Initial claims 4wk MA", "Growth", True, "k"),
    ("CCSA", "Continued claims", "Growth", True, "k"),
    ("UNRATE", "Unemployment rate", "Growth", True, "%"),
    ("SAHM", "Sahm rule (real-time)", "Growth", True, "pp"),
    ("REGIONAL", "Regional Fed composite", "Growth", False, "z"),
    ("CLAIMS_52W", "Claims vs 52wk low", "Growth", True, "%"),
]
SOURCES = {"SRF": "FRED RPONTSYD", "WPC": "FRED WPC", "NET_LIQ": "FRED WALCL−WDTGAL−RRPONTSYD", "SOFR_IORB": "FRED SOFR, IORB",
           "EFFR_IORB": "FRED EFFR, IORB", "RES_GDP": "FRED WRESBAL, GDP", "RES_ASSETS": "FRED WRESBAL, TLAACBW027SBOG",
           "NFCI": "FRED NFCI", "ANFCI": "FRED ANFCI", "STLFSI": "FRED STLFSI4", "BAA_10Y": "FRED BAA10Y", "HY_OAS": "FRED BAMLH0A0HYM2",
           "CCC_OAS": "FRED BAMLH0A3HYC", "VIXCLS": "FRED VIXCLS", "DECOMP": "FRED BAMLH0A3HYC − BAMLH0A1HYBB", "CFNAIMA3": "FRED CFNAI (3m avg)",
           "WEI": "FRED WEI", "IC4WSA": "FRED IC4WSA", "CCSA": "FRED CCSA", "UNRATE": "FRED UNRATE", "SAHM": "FRED SAHMREALTIME",
           "REGIONAL": "FRED Empire, Philly, Dallas, Chicago Fed surveys", "CLAIMS_52W": "FRED IC4WSA"}
TRIPWIRES = [("SAHM", 0.50, "above", "3-month average unemployment 0.50pp above its trailing 12-month low"),
             ("CFNAIMA3", -0.70, "below", "Chicago Fed's own published recession signal"),
             ("CLAIMS_52W", 15.0, "above", "4-week claims average 15% above its 52-week low (heuristic, not an official rule)")]


def band(p: float) -> str:
    return "Acute" if p >= 90 else "Elevated" if p >= 75 else "Above normal" if p >= 50 else "Normal" if p >= 25 else "Calm"


def _expanding_z(s: pd.Series, min_periods: int = 36) -> pd.Series:
    m, sd = s.expanding(min_periods=min_periods).mean(), s.expanding(min_periods=min_periods).std()
    return (s - m) / sd.replace(0, pd.NA)


def derived_members(get) -> dict[str, pd.Series]:
    """Members the legacy growth/credit builders computed rather than fetched."""
    out = {}
    cf = get("CFNAI")
    if cf is not None:
        out["CFNAIMA3"] = cf.dropna().rolling(3).mean().dropna()
    surveys = {k: get(k) for k in ("EMPIRE", "PHILLY", "DALLAS", "CHICAGO_SVY")}
    surveys = {k: v.dropna() for k, v in surveys.items() if v is not None and len(v.dropna())}
    if surveys:
        monthly = pd.DataFrame(surveys).resample("MS").last()
        z = monthly.apply(lambda c: _expanding_z(c.astype(float)))
        need = min(3, len(surveys))
        out["REGIONAL"] = z.mean(axis=1).where(z.notna().sum(axis=1) >= need).dropna().astype(float)
    ic = get("IC4WSA")
    if ic is not None:
        w = ic.dropna().resample("W").last().dropna()
        low = w.rolling(52, min_periods=26).min()
        out["CLAIMS_52W"] = ((w / low - 1) * 100).dropna()
    ccc, bb = get("CCC_OAS"), get("BB_OAS")
    if ccc is not None and bb is not None:
        out["DECOMP"] = (ccc - bb).dropna()
    return out


def composite(get) -> tuple[dict, dict[str, tuple[pd.Series, dict]]]:
    extra = derived_members(get)
    window = 52 * WINDOW_YEARS
    pct, meta_rows, raw = {}, [], {}
    for sid, label, block, up, unit in MEMBERS:
        s = extra.get(sid) if sid in extra else get(sid)
        if s is None:
            continue
        w = s.dropna().resample(WEEKLY).last().dropna()
        if len(w) < MIN_OBS:
            continue
        r = w.rolling(window, min_periods=MIN_OBS).rank(pct=True)
        pct[label] = (r if up else 1 - r) * 100
        raw[label] = s.dropna()
        meta_rows.append((sid, label, block, up, unit))
    if not pct:
        return {}, {}
    P = pd.concat(pct, axis=1).sort_index().ffill(limit=13)
    blocks = {}
    for blk in ("Funding", "Credit", "Growth"):
        cols = [lab for _, lab, b, _, _ in meta_rows if b == blk and lab in P]
        if cols:
            blocks[blk] = P[cols].mean(axis=1)
    B = pd.DataFrame(blocks)
    B["Composite"] = B.mean(axis=1)
    out = {f"STRESS_{k.upper()}": (B[k].dropna(), dict(label=("Stress composite" if k == "Composite" else f"{k} stress"), unit="pct", kind="level",
                                                         group="Stress", source="Dashboard composite (legacy method)")) for k in B.columns}
    # snapshot table
    snap = []
    for sid, label, block, up, unit in meta_rows:
        p = P[label].dropna()
        if p.empty:
            continue
        native = raw[label]
        changed = native.ne(native.shift())
        snap.append({"id": sid, "label": label, "block": block, "pct": round(float(p.iloc[-1]), 1), "band": band(float(p.iloc[-1])),
                     "latest": round(float(native.iloc[-1]), 4), "unit": unit, "asof": f"{native.index[changed][-1]:%Y-%m-%d}",
                     "direction": "high = stress" if up else "low = stress", "source": SOURCES.get(sid, "")})
    order = {"Funding": 0, "Credit": 1, "Growth": 2}
    snap.sort(key=lambda r: (order[r["block"]], -r["pct"]))
    # heatmap: last 3 years, every 2nd week
    H = P.loc[P.index >= P.index.max() - pd.Timedelta(days=3 * 365)].iloc[::2]
    heat = {"dates": [f"{d:%Y-%m-%d}" for d in H.index],
            "rows": [{"label": lab, "block": b, "v": [None if pd.isna(x) else round(float(x)) for x in H[lab]]} for _, lab, b, _, _ in meta_rows if lab in H]}
    trip = []
    for sid, lvl, side, desc in TRIPWIRES:
        s = extra.get(sid) if sid in extra else get(sid)
        if s is None or not len(s.dropna()):
            continue
        v = float(s.dropna().iloc[-1])
        trip.append({"id": sid, "label": dict((m[0], m[1]) for m in MEMBERS)[sid], "value": round(v, 2), "threshold": lvl, "side": side,
                     "hit": (v >= lvl) if side == "above" else (v <= lvl), "rule": desc, "asof": f"{s.dropna().index[-1]:%Y-%m-%d}"})
    # OFR cross-check on the same basis
    r = http_get(OFR_URL, tries=2)
    if r is not None:
        try:
            ofr = pd.read_csv(io.StringIO(r.text), parse_dates=["Date"]).set_index("Date")["OFR FSI"].astype(float).dropna()
            w = ofr.resample(WEEKLY).last().dropna()
            out["OFR_FSI"] = (ofr, dict(label="OFR Financial Stress Index", unit="idx", kind="level", group="Stress",
                                        source="Office of Financial Research (financialresearch.gov)"))
            out["OFR_FSI_PCT"] = ((w.rolling(window, min_periods=MIN_OBS).rank(pct=True) * 100).dropna(),
                                  dict(label="OFR FSI (percentile)", unit="pct", kind="level", group="Stress",
                                       source="Office of Financial Research; percentile on the composite's basis"))
        except Exception as e:
            DIAG.append(f"OFR FSI parse: {type(e).__name__}")
    meta = {"snapshot": snap, "heatmap": heat, "tripwires": trip, "window_years": WINDOW_YEARS,
            "members": len(meta_rows), "blocks": {k: round(float(B[k].dropna().iloc[-1]), 1) for k in B.columns if len(B[k].dropna())}}
    return meta, out


# --------------------------------------------------------------------------- signposts (legacy rules)
PEAKS = [("Jul 1990", "1990-07-16"), ("Mar 2000", "2000-03-24"), ("Oct 2007", "2007-10-09"), ("Feb 2020", "2020-02-19"), ("Jan 2022", "2022-01-03")]
M = "MS"


def _flag(cond, valid):
    return cond.astype("float64").where(valid)


def _monthly(s):
    return s.resample(M).max() if len(s) else s


def _as_monthly(s):
    c = s.dropna()
    return c.resample(M).last().dropna() if len(c) else c


def _stretched(level, window, min_periods, sigmas=1.0):
    level = level.dropna()
    thr = level.rolling(window, min_periods=min_periods).mean() + sigmas * level.rolling(window, min_periods=min_periods).std()
    return _flag(level > thr, thr.notna())


def _cheap(level, window, min_periods, q=0.25):
    level = level.dropna()
    rk = level.rolling(window, min_periods=min_periods).rank(pct=True)
    return _flag(rk < q, rk.notna())


def _sloos(q):
    q = q.dropna()
    if q.empty:
        return q
    grid = pd.date_range(q.index.min().to_period("M").to_timestamp(), q.index.max() + pd.DateOffset(months=3), freq=M)
    s = q.resample(M).last().reindex(grid).ffill(limit=3)
    return _flag(s > 0, s.notna())


SIGNPOSTS = [  # key, group, label, rule, source, inputs, fn, note
    ("pe", "Valuation", "Trailing P/E stretched", "Trailing 12m P/E more than 1σ above its own 20-year mean", "Shiller ie_data.xls", ["SH_PE"],
     lambda s: _stretched(_as_monthly(s["SH_PE"]), 240, 120),
     "Earnings are as-reported (GAAP), so this prints above an operating-earnings P/E; the band uses the same basis. Shiller leaves earnings blank until a quarter is reported, so the latest two or three months are normally a dash."),
    ("cape", "Valuation", "CAPE stretched", "CAPE more than 1σ above its own 20-year mean", "Shiller ie_data.xls", ["SH_CAPE"],
     lambda s: _stretched(_as_monthly(s["SH_CAPE"]), 240, 120),
     "A rolling band, not a fixed level: a fixed CAPE threshold has been triggered almost continuously since 1992 and says nothing."),
    ("vol", "Sentiment", "Volatility complacency", "6-month average VIX in the bottom quartile of its trailing 10 years", "FRED · VIXCLS", ["VIXCLS"],
     lambda s: _monthly(_cheap(s["VIXCLS"].dropna().rolling(126, min_periods=90).mean(), 2520, 1260)),
     "The free stand-in for positioning and survey rows on a sell-side checklist. It measures what options cost, not what anyone says."),
    ("credit", "Sentiment", "Credit complacency", "3-month average Baa−10y spread in the bottom quartile of its trailing 10 years", "FRED · BAA10Y", ["BAA_10Y"],
     lambda s: _monthly(_cheap(s["BAA_10Y"].dropna().rolling(63, min_periods=45).mean(), 2520, 1260)),
     "Moody's Baa over the 10-year Treasury rather than an ICE BofA HY OAS: FRED serves only a rolling three years of the ICE series. This one is daily from 1986."),
    ("curve", "Macro & Policy", "Curve inverted within 12 months", "10y minus 3m below zero at any point in the trailing 12 months", "FRED · T10Y3M", ["CURVE_3m10y_LONG"],
     lambda s: (lambda tr: _monthly(_flag(tr < 0, tr.notna())))(s["CURVE_3m10y_LONG"].dropna().rolling(252, min_periods=180).min()),
     "Evaluated daily before being collapsed to months, so a brief inversion between two month-ends still counts."),
    ("policy", "Macro & Policy", "Policy tightened", "Fed funds 100bp or more above its trailing 36-month low", "FRED · FEDFUNDS", ["FEDFUNDS"],
     lambda s: (lambda ff: _flag(ff - ff.rolling(36, min_periods=24).min() >= 1.0, ff.rolling(36, min_periods=24).min().notna()))(_as_monthly(s["FEDFUNDS"])),
     "Measured from the trough rather than as a fixed-lookback change: a 24-month difference nets a hiking year against a cutting year and fires at neither the 2000 nor the 2007 peak."),
    ("sloos", "Macro & Policy", "Banks tightening standards", "SLOOS net % tightening C&I standards above zero (more tightening than easing)", "FRED · DRTSCILM", ["SLOOS_CI"],
     lambda s: _sloos(s["SLOOS_CI"]), "Quarterly. Carried forward up to three months so the flag persists between surveys."),
    ("labour", "Macro & Policy", "Labour market at cycle tights", "Unemployment within 0.3pp of its trailing 36-month low", "FRED · UNRATE", ["UNRATE"],
     lambda s: (lambda u: _flag(u <= u.rolling(36, min_periods=24).min() + 0.3, u.rolling(36, min_periods=24).min().notna()))(_as_monthly(s["UNRATE"])), ""),
    ("decomp", "Sentiment", "Quality decompression widening", "CCC minus BB spread 100bp or more above its trailing 12-month low", "FRED · BAMLH0A3HYC, BAMLH0A1HYBB",
     ["CCC_OAS", "BB_OAS"],
     lambda s: (lambda g: (lambda tr: _monthly(_flag(g - tr >= 1.0, tr.notna())))(g.rolling(252, min_periods=180).min()))((s["CCC_OAS"] - s["BB_OAS"]).dropna()),
     "Turns late rather than early (a confirmation, not a warning). FRED serves only a rolling ~3 years of the ICE BofA series, so this row cannot reach the peak columns."),
]
ROW_LEVEL = {"pe": ("SH_PE", "x"), "cape": ("SH_CAPE", "x"), "vol": ("VIXCLS", ""), "credit": ("BAA_10Y", "%"), "curve": ("CURVE_3m10y_LONG", "%"),
             "policy": ("FEDFUNDS", "%"), "sloos": ("SLOOS_CI", "%"), "labour": ("UNRATE", "%")}


def signposts(get) -> tuple[dict, dict[str, tuple[pd.Series, dict]]]:
    inputs = {k: get(k) for k in {i for sp in SIGNPOSTS for i in sp[5]}}
    flags, rows = {}, []
    for key, group, label, rule, src, need, fn, note in SIGNPOSTS:
        if any(inputs.get(k) is None or not len(inputs[k].dropna()) for k in need):
            continue
        try:
            flags[key] = fn(inputs).resample(M).max()
        except Exception as e:
            DIAG.append(f"Signpost {key}: {type(e).__name__}")
    grid = pd.DataFrame(flags).sort_index()
    this_month = pd.Timestamp.today().to_period("M").to_timestamp()
    grid = grid[(grid.index >= "1970-01-01") & (grid.index <= this_month)]   # SLOOS carry-forward can run past today
    evald, trig = grid.notna().sum(axis=1), grid.sum(axis=1, skipna=True)
    share = (trig / evald * 100).where(evald >= 4)
    last = grid.dropna(how="all").index.max()
    cols = [(lab, pd.Timestamp(d).to_period("M").to_timestamp()) for lab, d in PEAKS]
    cols += [(f"{t:%b %Y}", t) for t in pd.date_range(last - pd.DateOffset(months=2), last, freq=M)]
    for key, group, label, rule, src, need, fn, note in SIGNPOSTS:
        s = grid[key] if key in grid else None
        cells = [None if s is None or pd.isna(s.get(t, float("nan"))) else int(s.get(t)) for _, t in cols]
        lvl = None
        if key in ROW_LEVEL:
            k, unit = ROW_LEVEL[key]
            x = get(k)
            if x is not None and len(x.dropna()):
                lvl = f"{float(x.dropna().iloc[-1]):,.2f}{unit}"
        elif key == "decomp" and inputs.get("CCC_OAS") is not None and inputs.get("BB_OAS") is not None:
            g = (inputs["CCC_OAS"] - inputs["BB_OAS"]).dropna()
            lvl = f"{float(g.iloc[-1]):,.2f}pp" if len(g) else None
        first = None if s is None or not s.notna().any() else f"{s.dropna().index[0]:%b %Y}"
        rows.append({"key": key, "group": group, "label": label, "rule": rule, "source": src, "note": note, "cells": cells, "first": first, "level": lvl,
                     "reaches_first_peak": bool(s is not None and s.notna().any() and s.dropna().index[0] <= cols[0][1])})
    meta = {"columns": [c[0] for c in cols], "n_peaks": len(PEAKS),
            "share": [None if pd.isna(share.get(t, float("nan"))) else round(float(share.get(t)), 1) for _, t in cols],
            "evaluated": [int(evald.get(t, 0)) for _, t in cols], "triggered": [int(trig.get(t, 0)) for _, t in cols], "rows": rows,
            "peak_dates": [d for _, d in PEAKS]}
    return meta, {"SIGN_SHARE": (share.dropna(), dict(label="Peak signposts triggered", unit="%", kind="level", group="Stress",
                                                       source="Peak signposts (legacy rules) from FRED and Shiller"))}


def build(get, status: dict) -> dict[str, tuple[pd.Series, dict]]:
    print("Stress panel & signposts (legacy method):")
    cmeta, out = composite(get)
    smeta, sig = signposts(get)
    out.update(sig)
    write("stress.json", cmeta)
    write("signposts.json", smeta)
    status["STRESS"] = "ok" if "STRESS_COMPOSITE" in out else "missing"
    status["SIGNPOSTS"] = "ok" if smeta["rows"] else "missing"
    status["OFR_FSI"] = "ok" if "OFR_FSI" in out else "missing"
    print(f"  STRESS {status['STRESS']} ({cmeta.get('members')} members, blocks {cmeta.get('blocks')})  OFR {status['OFR_FSI']}")
    print(f"  SIGNPOSTS {smeta['columns']} share {smeta['share']} n {smeta['evaluated']}")
    return out
