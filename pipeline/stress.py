"""
Stress panel and peak signposts (this dashboard's own rules, all stated below; public data only).

STRESS PANEL - each gauge is scored as a literal percentile of its own history up to that week
(expanding window, at least 3 years, so there is no look-ahead), gauges are averaged into blocks,
and blocks into a composite. 100 = the most stressed reading in the gauge's own history.

PEAK SIGNPOSTS - a late-cycle checklist evaluated monthly. Each rule is triggered (1), not triggered (0)
or not evaluable (missing) when its inputs do not reach that month; missing rules are excluded from the
denominator. Shown at five prior S&P 500 peaks and the latest months.
"""
from __future__ import annotations

import pandas as pd

from fetch import write

PEAKS = [("Jul 1990", "1990-07-01"), ("Mar 2000", "2000-03-01"), ("Oct 2007", "2007-10-01"), ("Feb 2020", "2020-02-01"), ("Jan 2022", "2022-01-01")]

BLOCKS = {   # block: [(series id, higher = more stress?, transform)]
    "Equity volatility": [("VIX", True, None), ("VXN", True, None), ("VVIX", True, None)],
    "Rates volatility": [("MOVE", True, None)],
    "Credit": [("BAA_10Y", True, None), ("HY_OAS", True, None), ("IG_OAS", True, None)],
    "Funding": [("SOFR_IORB", True, None), ("EFFR_IORB", True, None)],
    "Financial conditions": [("NFCI", True, None), ("STLFSI", True, None)],
    "Dollar squeeze": [("DXY", True, "chg13")],
    "Equity drawdown": [("SPX", True, "drawdown")],
}


def _weekly(s: pd.Series) -> pd.Series:
    return s.dropna().resample("W-FRI").last().dropna()


def stress_panel(get) -> dict[str, tuple[pd.Series, dict]]:
    out, blocks = {}, {}
    for block, members in BLOCKS.items():
        pcts = []
        for sid, up, tr in members:
            s = get(sid)
            if s is None or len(s) < 200:
                continue
            w = _weekly(s)
            if tr == "chg13":
                w = (w / w.shift(13) - 1) * 100
            elif tr == "drawdown":
                w = -(w / w.rolling(52, min_periods=1).max() - 1) * 100   # depth below 52-week high, %
            w = w.dropna()
            p = w.expanding(min_periods=156).rank(pct=True) * 100
            pcts.append(p if up else 100 - p)
        if pcts:
            b = pd.concat(pcts, axis=1).mean(axis=1, skipna=True).dropna()
            blocks[block] = b
            out["STRESS_" + block.upper().replace(" ", "_")] = (b, dict(label=block, unit="pct", kind="level", group="Stress"))
    if blocks:
        df = pd.DataFrame(blocks)
        comp = df.mean(axis=1, skipna=True).where(df.notna().sum(axis=1) >= 3).dropna()
        out["STRESS_COMPOSITE"] = (comp, dict(label="Stress composite", unit="pct", kind="level", group="Stress",
                                   note="Average of block percentiles; each gauge vs its own history up to that week"))
    return out


def _m(s):
    return None if s is None else s.dropna().resample("MS").mean()


def signposts(get) -> tuple[dict, dict[str, tuple[pd.Series, dict]]]:
    m = {k: _m(get(k)) for k in ["UNRATE", "CURVE_3m10y_LONG", "FEDFUNDS", "CORE_PCE", "LEI_6M", "CLAIMS", "SH_CAPE", "SH_ECY",
                                  "LH_SPX", "BAA_10Y", "NFCI", "SLOOS_CI", "WTI_LONG", "SAHM"]}
    yoy = lambda s: (s / s.shift(12) - 1) * 100

    def rule(fn, *keys):
        if any(m.get(k) is None for k in keys):
            return None
        try:
            r = fn()
            return r
        except Exception:
            return None

    def flag(cond, *inputs):
        """1/0 where all inputs exist that month, NaN otherwise."""
        idx = cond.index
        ok = pd.concat([x.reindex(idx) for x in inputs], axis=1).notna().all(axis=1)
        return cond.astype(float).where(ok)

    S = []
    def add(key, group, label, rulet, src, fn, *keys, level=None):
        S.append(dict(key=key, group=group, label=label, rule=rulet, source=src, series=rule(fn, *keys), level=level))

    U, C, FF = m["UNRATE"], m["CURVE_3m10y_LONG"], m["FEDFUNDS"]
    add("labour_tight", "Labour & policy", "Unemployment near its cycle low", "Unemployment rate within 0.3pp of its 24-month low",
        "FRED UNRATE", lambda: flag(U - U.rolling(24, min_periods=18).min() <= 0.3, U.rolling(24, min_periods=18).min()), "UNRATE", level=("UNRATE", "%"))
    add("curve_inv", "Labour & policy", "Yield curve inverted recently", "10Y−3M Treasury spread below zero in any of the last 24 months",
        "FRED T10Y3M", lambda: flag(C.rolling(24, min_periods=18).min() < 0, C.rolling(24, min_periods=18).min()), "CURVE_3m10y_LONG", level=("CURVE_3m10y_LONG", "%"))
    add("fed_hiked", "Labour & policy", "Fed has hiked hard", "Fed funds rate up more than 1.5pp over the last 24 months",
        "FRED FEDFUNDS", lambda: flag(FF - FF.shift(24) > 1.5, FF.shift(24)), "FEDFUNDS", level=("FEDFUNDS", "%"))
    add("real_rate", "Labour & policy", "Restrictive real policy rate", "Fed funds minus core PCE inflation above 1pp",
        "FRED FEDFUNDS, PCEPILFE", lambda: flag(FF - yoy(m["CORE_PCE"]) > 1, yoy(m["CORE_PCE"])), "FEDFUNDS", "CORE_PCE")
    add("core_infl", "Labour & policy", "Inflation above target", "Core PCE inflation above 2.5% year-on-year",
        "FRED PCEPILFE", lambda: flag(yoy(m["CORE_PCE"]) > 2.5, yoy(m["CORE_PCE"])), "CORE_PCE")
    add("lei_down", "Growth", "Leading index falling", "DIY leading index: 6-month annualised change below zero",
        "Dashboard leading index", lambda: flag(m["LEI_6M"] < 0, m["LEI_6M"]), "LEI_6M", level=("LEI_6M", "%"))
    add("claims_up", "Growth", "Jobless claims turning up", "Initial claims (monthly avg) 10%+ above their 12-month low",
        "FRED ICSA", lambda: flag(m["CLAIMS"] / m["CLAIMS"].rolling(12, min_periods=9).min() - 1 > 0.10, m["CLAIMS"].rolling(12, min_periods=9).min()), "CLAIMS")
    add("sahm_rising", "Growth", "Sahm rule rising", "Sahm rule indicator at or above 0.30pp (trigger is 0.50)",
        "FRED SAHMREALTIME", lambda: flag(m["SAHM"] >= 0.3, m["SAHM"]), "SAHM", level=("SAHM", "pp"))
    add("cape_high", "Valuation & sentiment", "Equities expensive", "Shiller CAPE in the top quartile of its history up to that month",
        "Shiller", lambda: flag(m["SH_CAPE"].expanding(120).rank(pct=True) > 0.75, m["SH_CAPE"].expanding(120).rank(pct=True)), "SH_CAPE", level=("SH_CAPE", "x"))
    add("ecy_low", "Valuation & sentiment", "Little reward over bonds", "Excess CAPE yield in the bottom quartile of its history",
        "Shiller", lambda: flag(m["SH_ECY"].expanding(120).rank(pct=True) < 0.25, m["SH_ECY"].expanding(120).rank(pct=True)), "SH_ECY", level=("SH_ECY", "%"))
    def euphoria():
        r = yoy(m["LH_SPX"])
        z = (r - r.expanding(120).mean()) / r.expanding(120).std()
        return flag(z > 1, z)
    add("euphoria", "Valuation & sentiment", "Equity euphoria", "S&P 500 12-month return more than 1σ above its long-run average",
        "Yahoo Finance ^GSPC", euphoria, "LH_SPX")
    B = m["BAA_10Y"]
    add("credit_complacent", "Credit & liquidity", "Credit complacency", "Baa−10Y spread in the bottom quartile of its trailing 10 years",
        "FRED BAA10Y", lambda: flag(B.rolling(120, min_periods=60).rank(pct=True) < 0.25, B.rolling(120, min_periods=60).rank(pct=True)), "BAA_10Y", level=("BAA_10Y", "%"))
    add("credit_widening", "Credit & liquidity", "Credit spreads widening", "Baa−10Y spread 0.4pp or more above its 12-month low",
        "FRED BAA10Y", lambda: flag(B - B.rolling(12, min_periods=9).min() >= 0.4, B.rolling(12, min_periods=9).min()), "BAA_10Y")
    add("lending_tight", "Credit & liquidity", "Banks tightening lending", "More banks tightening than easing C&I loan standards (Fed SLOOS, net % > 0)",
        "FRED DRTSCILM", lambda: flag(m["SLOOS_CI"].ffill(limit=3) > 0, m["SLOOS_CI"].ffill(limit=3)), "SLOOS_CI", level=("SLOOS_CI", "%"))
    add("fci_tighter", "Credit & liquidity", "Financial conditions tightening", "Chicago Fed NFCI higher than 6 months earlier",
        "FRED NFCI", lambda: flag(m["NFCI"] - m["NFCI"].shift(6) > 0, m["NFCI"].shift(6)), "NFCI")
    add("oil_shock", "Credit & liquidity", "Oil price shock", "WTI crude up more than 40% year-on-year",
        "FRED WTISPLC", lambda: flag(yoy(m["WTI_LONG"]) > 40, yoy(m["WTI_LONG"])), "WTI_LONG")

    grid = pd.DataFrame({x["key"]: x["series"] for x in S if x["series"] is not None})
    grid = grid[grid.index >= "1985-01-01"]
    trig, evald = grid.sum(axis=1, skipna=True), grid.notna().sum(axis=1)
    share = (trig / evald * 100).where(evald >= 4)
    last_ok = grid.dropna(how="all").index[-1] if len(grid.dropna(how="all")) else None
    cols = [(lab, pd.Timestamp(d)) for lab, d in PEAKS]
    if last_ok is not None:   # latest 3 months in which most rules can already be judged (data lags 1-3 months)
        enough = evald[evald >= 0.7 * evald.loc["2020":].max()]
        recent = enough.index[-3:]
        cols += [(f"{t:%b %Y}", t) for t in recent]
    rows = []
    for x in S:
        s = x["series"]
        cells = [None if s is None or pd.isna(s.get(t, float("nan"))) else int(s.get(t)) for _, t in cols]
        lvl = None
        if x["level"]:
            k, unit = x["level"]
            mm = m.get(k)
            if mm is not None and len(mm.dropna()):
                lvl = f"{mm.dropna().iloc[-1]:,.2f}{'' if unit in ('x',) else ' '}{unit}".replace(" %", "%")
        rows.append({"key": x["key"], "group": x["group"], "label": x["label"], "rule": x["rule"], "source": x["source"], "cells": cells,
                     "first": None if s is None or not s.notna().any() else f"{s.dropna().index[0]:%b %Y}", "level": lvl})
    col_share = [None if pd.isna(share.get(t, float("nan"))) else round(float(share.get(t)), 1) for _, t in cols]
    col_n = [int(evald.get(t, 0)) for _, t in cols]
    col_trig = [int(trig.get(t, 0)) for _, t in cols]
    meta = {"columns": [lab for lab, _ in cols], "n_peaks": len(PEAKS), "rows": rows, "share": col_share, "evaluated": col_n, "triggered": col_trig}
    return meta, {"SIGN_SHARE": (share.dropna(), dict(label="Peak signposts triggered", unit="%", kind="level", group="Stress",
                                  source="Dashboard checklist from FRED, Shiller and Yahoo Finance"))}


def build(get, status: dict) -> dict[str, tuple[pd.Series, dict]]:
    print("Stress panel & signposts:")
    out = stress_panel(get)
    meta, sig = signposts(get)
    out.update(sig)
    write("signposts.json", meta)
    status["STRESS"] = "ok" if "STRESS_COMPOSITE" in out else "missing"
    status["SIGNPOSTS"] = "ok" if meta["rows"] else "missing"
    print(f"  STRESS {status['STRESS']}  SIGNPOSTS {status['SIGNPOSTS']}  columns {meta['columns']}  share {meta['share']}")
    return out
