"""
Signal engine (WP22): fixed rules on the dashboard's own data, each tested on history, turned into
"ideas to investigate". Research prompts, not recommendations.

How a signal is tested
  - Monthly data (month-end). Macro inputs are moved forward by their publication delay before the rule is checked,
    so the test only uses what was known at the time (OECD leading indices 2 months, DOSM 3, other macro 1, prices 0).
  - Event = the rule switching on, at least `gap` months after the previous event.
  - For each horizon (1, 3, 6, 12 months): the target's move after each event against its move in all months over the
    same period (the baseline): median, quartiles, share of rises (hit rate), edge = median after events − baseline.
  - Tier (at the best horizon): "Tested edge" = 12+ events, hit rate at least 12 points away from the baseline's in the
    signal's direction, and the edge has the same sign in both halves of the history. "Thin evidence" = 6 to 11 events
    and at least 20 points. "Not enough history" = fewer than 6 events. Otherwise "Context only".
Ideas = signals that are on now and still inside their best horizon, grouped by target and direction.
Divergences = pairs that normally move together, now apart by more than 2 standard deviations (weekly data).
Writes docs/data/signals.json; appends each new firing to archive/signals_log.csv (the live track record).
Isolated: a failure keeps the previous file.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from fetch import ARCHIVE_DIR, OUT, load_existing, unpack, write

FILES = ["yahoo.json", "fred.json", "derived.json", "asia.json", "cbwatch.json", "korea.json", "taiwan.json", "gpu.json", "ramp.json"]
HORIZONS = (1, 3, 6, 12)
TIER_W = {"Tested edge": 3, "Thin evidence": 1, "Context only": 0, "Not enough history": 0}
NAMES = {"TWSE": "Taiwan Weighted", "KOSPI": "KOSPI", "JCI": "Jakarta Composite", "NIFTY": "Nifty 50", "COPPER": "Copper", "IN_10Y": "India 10Y yield",
         "AAXJ": "Asia ex-Japan (AAXJ)", "LH_SPX": "S&P 500", "SPX": "S&P 500", "UST10Y": "US 10Y yield", "GOLD": "Gold", "KLCI": "FBM KLCI",
         "R_AAXJ_ACWI": "Asia ex-Japan vs world", "R_EEM_SPX": "Emerging markets vs S&P 500", "R_SOX_SPX": "Chip stocks vs S&P 500",
         "R_KLCI_AAXJ": "KLCI (USD) vs Asia ex-Japan", "NVDA": "Nvidia", "KR_CPI_YOY": "Korea CPI", "TLT": "Long Treasuries (TLT)",
         "USDMYR": "USD/MYR", "AUDUSD": "Australian dollar (AUD/USD)", "EURUSD": "Euro (EUR/USD)"}
REGION = {"TWSE": ["Taiwan", "US"], "KOSPI": ["Korea", "US"], "JCI": [], "NIFTY": ["India"], "IN_10Y": ["India"], "COPPER": ["China"], "AAXJ": ["China", "US"],
          "LH_SPX": ["US"], "SPX": ["US"], "UST10Y": ["US"], "GOLD": ["US"], "KLCI": ["Malaysia"], "R_KLCI_AAXJ": ["Malaysia"], "R_AAXJ_ACWI": ["China", "US"],
          "R_EEM_SPX": ["US", "China"], "R_SOX_SPX": ["Korea", "Taiwan", "US"], "NVDA": ["US"], "TLT": ["US"],
          "USDMYR": ["Malaysia", "US"], "AUDUSD": ["Australia"], "EURUSD": ["Euro area"]}


def lag_of(sid: str) -> int:
    if sid.startswith(("CLI_", "BCI_")):
        return 2
    if sid.startswith("MY_LEAD"):
        return 3
    if sid in ("PALM", "STLFSI", "NFCI"):
        return 1 if sid == "PALM" else 0
    if sid.startswith(("KR_", "TW_", "IN_", "ID_", "CN_", "LEI_", "REG_")) and not sid.endswith(("_10Y", "_3M")):
        return 1
    return 0


def load_all() -> dict[str, pd.Series]:
    S = {}
    for f in FILES:
        for k, v in load_existing(f).items():
            if isinstance(v, dict) and v.get("d") and not k.startswith("_"):
                S[k] = unpack(v).dropna()
    sent = load_existing("sentiment.json").get("series", {})
    for k, v in sent.items():
        if isinstance(v, dict) and v.get("d"):
            S[k] = unpack(v).dropna()
    return S


def monthly(s: pd.Series, sid: str = "", now: pd.Timestamp | None = None) -> pd.Series:
    """Month-end values, dated when they became known (publication delay applied, never past the current month)."""
    m = s.resample("ME").last().dropna()
    lag = lag_of(sid)
    if lag:
        now_me = (now or pd.Timestamp.today()).to_period("M").to_timestamp("M")
        idx = [min(t + pd.offsets.MonthEnd(lag), now_me) for t in m.index]
        m = pd.Series(m.values, index=pd.DatetimeIndex(idx))
        m = m[~m.index.duplicated(keep="last")]
    full = pd.date_range(m.index.min(), m.index.max(), freq="ME")
    return m.reindex(full).ffill(limit=3)


def chg(m, k):
    return m - m.shift(k)


def yoy(m):
    return (m / m.shift(12) - 1) * 100


def pct_rank(m, years=10):
    return m.rolling(years * 12, min_periods=60).apply(lambda w: (w <= w[-1]).mean() * 100, raw=True)


# ---------------------------------------------------------------- the rules
# (id, family, name, rule text, inputs, condition(M) -> bool series, target, direction (+1 rise / -1 fall), kind, gap)
def rules():
    R = []

    def add(sid, fam, name, text, inputs, cond, target, d, kind="ret", gap=6):
        R.append(dict(id=sid, family=fam, name=name, rule=text, inputs=inputs, cond=cond, target=target, dir=d, kind=kind, gap=gap))

    for area, lab, tgts in [("KOR", "Korea", [("TWSE", 5), ("KOSPI", 4)]), ("IDN", "Indonesia", [("JCI", 4)]), ("IND", "India", [("NIFTY", 5)]), ("CHN", "China", [("COPPER", 7)])]:
        cid = f"CLI_{area}"
        for tgt, _ in tgts:
            add(f"cli_{area.lower()}_up_{tgt.lower()}", "Tested leads", f"{lab} leading index turns up → {NAMES[tgt]}", f"OECD {lab} leading index higher than 6 months earlier",
                [cid], lambda M, c=cid: chg(M[c], 6) > 0, tgt, 1)
            add(f"cli_{area.lower()}_dn_{tgt.lower()}", "Tested leads", f"{lab} leading index turns down → {NAMES[tgt]}", f"OECD {lab} leading index lower than 6 months earlier",
                [cid], lambda M, c=cid: chg(M[c], 6) < 0, tgt, -1)
    add("tw_m1b_dn", "Tested leads", "Taiwan M1B − M2 gap turns down → Taiwan Weighted", "Taiwan M1B minus M2 growth lower than 6 months earlier",
        ["TW_M1B_M2"], lambda M: chg(M["TW_M1B_M2"], 6) < 0, "TWSE", -1)
    add("tw_m1b_up", "Tested leads", "Taiwan M1B − M2 gap turns up → Taiwan Weighted", "Taiwan M1B minus M2 growth higher than 6 months earlier",
        ["TW_M1B_M2"], lambda M: chg(M["TW_M1B_M2"], 6) > 0, "TWSE", 1)
    add("oil_hot_in10y", "Tested leads", "Oil surge → India 10Y yield up", "Brent more than 40% higher than a year earlier",
        ["BRENT"], lambda M: yoy(M["BRENT"]) > 40, "IN_10Y", 1, "chg")
    add("oil_cold_in10y", "Tested leads", "Oil slump → India 10Y yield down", "Brent more than 30% lower than a year earlier",
        ["BRENT"], lambda M: yoy(M["BRENT"]) < -30, "IN_10Y", -1, "chg")
    add("usd_strong_asia", "Tested leads", "Strong dollar → Asia ex-Japan", "US dollar index more than 8% higher than a year earlier",
        ["DXY"], lambda M: yoy(M["DXY"]) > 8, "AAXJ", -1)
    add("usd_weak_asia", "Tested leads", "Weak dollar → Asia ex-Japan", "US dollar index more than 8% lower than a year earlier",
        ["DXY"], lambda M: yoy(M["DXY"]) < -8, "AAXJ", 1)
    add("us_lei_neg", "Tested leads", "US leading index turns negative → S&P 500", "Dashboard US leading index: 6-month growth below zero",
        ["LEI_6M"], lambda M: M["LEI_6M"] < 0, "LH_SPX", -1)
    add("us_lei_pos", "Tested leads", "US leading index turns positive → S&P 500", "Dashboard US leading index: 6-month growth above zero",
        ["LEI_6M"], lambda M: M["LEI_6M"] > 0, "LH_SPX", 1)
    add("cu_au_up", "Tested leads", "Copper ÷ gold rising → US 10Y yield up", "Copper-to-gold ratio higher than 6 months earlier",
        ["COPPER", "GOLD"], lambda M: chg(M["COPPER"] / M["GOLD"], 6) > 0, "UST10Y", 1, "chg")
    add("cu_au_dn", "Tested leads", "Copper ÷ gold falling → US 10Y yield down", "Copper-to-gold ratio lower than 6 months earlier",
        ["COPPER", "GOLD"], lambda M: chg(M["COPPER"] / M["GOLD"], 6) < 0, "UST10Y", -1, "chg")
    add("liq_up", "Tested leads", "Fed net liquidity growing → S&P 500", "Fed balance sheet minus TGA and reverse repo higher than a year earlier",
        ["NET_LIQ"], lambda M: yoy(M["NET_LIQ"]) > 0, "SPX", 1)
    # regime
    for q, nm, tgt, d in [(1, "Goldilocks", "LH_SPX", 1), (2, "Overheat", "COPPER", 1), (3, "Stagflation", "GOLD", 1), (4, "Slowdown", "LH_SPX", -1)]:
        add(f"regime_{q}", "Regime", f"Regime switches to {nm} → {NAMES[tgt]}", f"Dashboard growth/inflation regime becomes {nm}",
            ["REG_QUAD"], lambda M, q=q: M["REG_QUAD"] == q, tgt, d, gap=3)
    # extremes
    add("cape_hi", "Extremes", "Shiller CAPE above its 90th percentile → S&P 500", "Shiller CAPE in the top 10% of the last 30 years",
        ["SH_CAPE"], lambda M: pct_rank(M["SH_CAPE"], 30) > 90, "LH_SPX", -1, gap=12)
    add("baa_wide", "Extremes", "Credit spreads very wide → S&P 500", "Baa − 10Y spread in the top 20% of the last 10 years",
        ["BAA_10Y"], lambda M: pct_rank(M["BAA_10Y"]) > 80, "LH_SPX", 1)
    add("baa_tight", "Extremes", "Credit spreads very tight → S&P 500", "Baa − 10Y spread in the bottom 10% of the last 10 years",
        ["BAA_10Y"], lambda M: pct_rank(M["BAA_10Y"]) < 10, "LH_SPX", -1)
    add("vix_high", "Extremes", "VIX above 30 → S&P 500", "VIX closes a month above 30", ["VIX"], lambda M: M["VIX"] > 30, "SPX", 1)
    add("vix_low", "Extremes", "VIX below 13 → S&P 500", "VIX closes a month below 13", ["VIX"], lambda M: M["VIX"] < 13, "SPX", -1)
    add("rec_prob", "Extremes", "Recession probability above 30% → S&P 500", "NY Fed yield-curve recession probability above 30%",
        ["REC_PROB_NYF"], lambda M: M["REC_PROB_NYF"] > 30, "LH_SPX", -1, gap=12)
    add("fg_fear", "Extremes", "Extreme fear (CNN index below 25) → S&P 500", "CNN Fear & Greed index below 25", ["FG"], lambda M: M["FG"] < 25, "SPX", 1, gap=3)
    add("fg_greed", "Extremes", "Extreme greed (CNN index above 75) → S&P 500", "CNN Fear & Greed index above 75", ["FG"], lambda M: M["FG"] > 75, "SPX", -1, gap=3)
    # trend and leadership
    for rid, nm in [("R_AAXJ_ACWI", "Asia ex-Japan vs world"), ("R_EEM_SPX", "Emerging markets vs S&P 500"), ("R_SOX_SPX", "Chip stocks vs S&P 500"), ("R_KLCI_AAXJ", "KLCI (USD) vs Asia ex-Japan")]:
        add(f"{rid.lower()}_up", "Trend", f"{nm}: ratio moves above its 10-month average", f"{nm} ratio closes a month above its 10-month average",
            [rid], lambda M, r=rid: M[r] > M[r].rolling(10).mean(), rid, 1)
        add(f"{rid.lower()}_dn", "Trend", f"{nm}: ratio moves below its 10-month average", f"{nm} ratio closes a month below its 10-month average",
            [rid], lambda M, r=rid: M[r] < M[r].rolling(10).mean(), rid, -1)
    add("spx_below_10m", "Trend", "S&P 500 below its 10-month average", "S&P 500 closes a month below its 10-month average",
        ["SPX"], lambda M: M["SPX"] < M["SPX"].rolling(10).mean(), "SPX", -1)
    add("klci_above_10m", "Trend", "KLCI above its 10-month average", "KLCI closes a month above its 10-month average",
        ["KLCI"], lambda M: M["KLCI"] > M["KLCI"].rolling(10).mean(), "KLCI", 1)
    # central bank pricing: the market's 2-year or forward rate against the policy rate
    add("fed_cuts_priced", "Policy", "Market prices Fed cuts → S&P 500", "US 2Y yield more than 0.5pt below the effective Fed funds rate",
        ["UST2Y", "EFFR"], lambda M: (M["UST2Y"] - M["EFFR"]) < -0.5, "SPX", -1)
    add("fed_cuts_gold", "Policy", "Market prices Fed cuts → gold", "US 2Y yield more than 0.5pt below the effective Fed funds rate",
        ["UST2Y", "EFFR"], lambda M: (M["UST2Y"] - M["EFFR"]) < -0.5, "GOLD", 1)
    add("fed_hikes_priced", "Policy", "Market prices Fed hikes → S&P 500", "US 2Y yield more than 0.5pt above the effective Fed funds rate",
        ["UST2Y", "EFFR"], lambda M: (M["UST2Y"] - M["EFFR"]) > 0.5, "SPX", -1)
    add("rba_hikes_priced", "Policy", "Bank bills price RBA hikes → Australian dollar", "3M bank bill more than 0.25pt above the RBA cash rate",
        ["AU_BB_3M", "AU_CASH"], lambda M: (M["AU_BB_3M"] - M["AU_CASH"]) > 0.25, "AUDUSD", 1)
    add("rba_cuts_priced", "Policy", "Bank bills price RBA cuts → Australian dollar", "3M bank bill more than 0.10pt below the RBA cash rate",
        ["AU_BB_3M", "AU_CASH"], lambda M: (M["AU_BB_3M"] - M["AU_CASH"]) < -0.10, "AUDUSD", -1)
    add("ecb_hikes_priced", "Policy", "Forwards price ECB hikes → euro", "1-year-ahead euro short rate more than 0.25pt above the ECB deposit rate",
        ["EA_FWD_1Y", "EA_DFR"], lambda M: (M["EA_FWD_1Y"] - M["EA_DFR"]) > 0.25, "EURUSD", 1)
    add("ecb_cuts_priced", "Policy", "Forwards price ECB cuts → euro", "1-year-ahead euro short rate more than 0.25pt below the ECB deposit rate",
        ["EA_FWD_1Y", "EA_DFR"], lambda M: (M["EA_FWD_1Y"] - M["EA_DFR"]) < -0.25, "EURUSD", -1)
    # stress
    add("stress_high", "Stress", "Stress composite above 80th percentile → S&P 500", "Dashboard stress composite above 80 (elevated or acute)",
        ["STRESS_COMPOSITE"], lambda M: M["STRESS_COMPOSITE"] > 80, "SPX", -1)
    add("stress_easing", "Stress", "Stress composite falls 20 points in 3 months → S&P 500", "Dashboard stress composite at least 20 points lower than 3 months earlier",
        ["STRESS_COMPOSITE"], lambda M: chg(M["STRESS_COMPOSITE"], 3) <= -20, "SPX", 1)
    add("nfci_tight", "Stress", "Financial conditions tighter than average → S&P 500", "Chicago Fed NFCI above zero",
        ["NFCI"], lambda M: M["NFCI"] > 0, "LH_SPX", -1, gap=12)
    add("stlfsi_high", "Stress", "St. Louis Fed stress index above 1 → S&P 500", "St. Louis Fed financial stress index above 1",
        ["STLFSI"], lambda M: M["STLFSI"] > 1, "LH_SPX", 1)
    # Malaysia
    add("myr_uptrend_klci", "Malaysia", "Ringgit in an uptrend → KLCI", "USD/MYR closes a month below its 10-month average (ringgit strengthening)",
        ["USDMYR"], lambda M: M["USDMYR"] < M["USDMYR"].rolling(10).mean(), "KLCI", 1)
    add("usd_weak_myr", "Malaysia", "Weak dollar → ringgit", "US dollar index more than 5% lower than a year earlier",
        ["DXY"], lambda M: yoy(M["DXY"]) < -5, "USDMYR", -1)
    add("oil_up_myr", "Malaysia", "Oil up sharply → ringgit", "Brent more than 30% higher than a year earlier",
        ["BRENT"], lambda M: yoy(M["BRENT"]) > 30, "USDMYR", -1)
    add("opr_cut_klci", "Malaysia", "BNM cuts the OPR → KLCI", "OPR lower than 3 months earlier",
        ["MY_OPR"], lambda M: chg(M["MY_OPR"], 3) < 0, "KLCI", 1, gap=12)
    add("opr_hike_klci", "Malaysia", "BNM raises the OPR → KLCI", "OPR higher than 3 months earlier",
        ["MY_OPR"], lambda M: chg(M["MY_OPR"], 3) > 0, "KLCI", -1, gap=12)
    add("us_my_gap_narrow", "Malaysia", "US−Malaysia rate gap narrowing → ringgit", "US 2Y yield minus the OPR at least 0.5pt lower than 6 months earlier",
        ["UST2Y", "MY_OPR"], lambda M: chg(M["UST2Y"] - M["MY_OPR"], 6) <= -0.5, "USDMYR", -1)
    add("cn_cli_up_klci", "Malaysia", "China leading index turns up → KLCI", "OECD China leading index higher than 6 months earlier",
        ["CLI_CHN"], lambda M: chg(M["CLI_CHN"], 6) > 0, "KLCI", 1)
    add("my_lead_klci", "Malaysia", "Malaysia leading diffusion above 50 → KLCI", "DOSM leading index diffusion above 50%",
        ["MY_LEAD_DIFF"], lambda M: M["MY_LEAD_DIFF"] > 50, "KLCI", 1)
    add("palm_up_klci", "Malaysia", "Palm oil up sharply → KLCI", "Palm oil (IMF) more than 20% higher than a year earlier",
        ["PALM"], lambda M: yoy(M["PALM"]) > 20, "KLCI", 1)
    # AI theme (short histories: shown, graded honestly)
    add("gpu_rent_up", "AI theme", "GPU rents rising → Nvidia", "H100 on-demand rent more than 5% higher than 3 months earlier",
        ["GPU_H100_OD"], lambda M: (M["GPU_H100_OD"] / M["GPU_H100_OD"].shift(3) - 1) * 100 > 5, "NVDA", 1, gap=3)
    return R


# ---------------------------------------------------------------- testing
def fwd(t: pd.Series, h: int, kind: str) -> pd.Series:
    return (t.shift(-h) / t - 1) * 100 if kind == "ret" else (t.shift(-h) - t)


def study(cond: pd.Series, target: pd.Series, kind: str, d: int, gap: int) -> dict:
    cond = cond.reindex(target.index).astype("boolean").fillna(False).astype(bool)
    valid = target.index[target.notna()]
    start = cond.index[cond.notna()].min()
    prev = cond.shift(1, fill_value=False)
    ev, last = [], None
    for t in cond.index[cond & ~prev]:
        if last is None or (t - last).days > gap * 30.4:
            ev.append(t)
            last = t
    run_start = None
    if cond.iloc[-1]:
        j = len(cond) - 1
        while j > 0 and cond.iloc[j - 1]:
            j -= 1
        run_start = cond.index[j]
    stats, mid = {}, (ev[len(ev) // 2] if ev else None)
    for h in HORIZONS:
        f = fwd(target, h, kind)
        x = f.reindex(ev).dropna()
        base = f[(f.index >= valid.min())].dropna()
        if len(x) == 0 or len(base) < 24:
            continue
        def edge_in(lo, hi):
            xx = x[(x.index >= lo) & (x.index < hi)]
            bb = base[(base.index >= lo) & (base.index < hi)]
            return float(xx.median() - bb.median()) if len(xx) >= 2 and len(bb) >= 12 else None
        stats[h] = dict(n=int(len(x)), med=float(x.median()), p25=float(x.quantile(.25)), p75=float(x.quantile(.75)), hit=float((x > 0).mean() * 100),
                        base_med=float(base.median()), base_hit=float((base > 0).mean() * 100), edge=float(x.median() - base.median()),
                        h1=edge_in(pd.Timestamp.min, mid) if mid is not None else None, h2=edge_in(mid, pd.Timestamp.max) if mid is not None else None)
    # best horizon: biggest hit-rate gap in the signal's direction (3, 6, 12 months)
    best, tier = None, "Not enough history"
    for h in (3, 6, 12):
        s = stats.get(h)
        if s and (best is None or d * (s["hit"] - s["base_hit"]) > d * (stats[best]["hit"] - stats[best]["base_hit"])):
            best = h
    if best:
        s = stats[best]
        gap_pts = d * (s["hit"] - s["base_hit"])
        halves = s["h1"] is not None and s["h2"] is not None and d * s["h1"] > 0 and d * s["h2"] > 0
        if s["n"] < 6:
            tier = "Not enough history"
        elif s["n"] >= 12 and gap_pts >= 12 and d * s["edge"] > 0 and halves:
            tier = "Tested edge"
        elif s["n"] >= 6 and gap_pts >= 20 and d * s["edge"] > 0:
            tier = "Thin evidence"
        else:
            tier = "Context only"
    return dict(events=[str(t.date()) for t in ev], n_events=len(ev), on=bool(cond.iloc[-1]), since=str(run_start.date()) if run_start is not None else None,
                stats={str(h): v for h, v in stats.items()}, best_h=best, tier=tier, history_from=str(start.date()) if start is not None else None)


# ---------------------------------------------------------------- divergences (weekly)
PAIRS = [("SPX", "KLCI", "S&P 500", "FBM KLCI"), ("SOX", "TWSE", "SOX", "Taiwan Weighted"), ("SOX", "KOSPI", "SOX", "KOSPI"), ("COPPER", "AAXJ", "Copper", "Asia ex-Japan"),
         ("DXY", "USDMYR", "US dollar index", "USD/MYR"), ("BRENT", "USDINR", "Brent", "USD/INR"), ("ACWI", "AAXJ", "World equities", "Asia ex-Japan"),
         ("SPX", "STI", "S&P 500", "Straits Times"), ("GOLD", "SILVER", "Gold", "Silver"), ("SPX", "NKY", "S&P 500", "Nikkei 225")]


def divergences(S: dict) -> list[dict]:
    out = []
    for a, b, na, nb in PAIRS:
        if a not in S or b not in S:
            continue
        w = pd.concat([S[a].resample("W-FRI").last(), S[b].resample("W-FRI").last()], axis=1, sort=True).dropna()
        w.columns = ["a", "b"]
        r = (w / w.shift(13) - 1) * 100
        r = r.dropna()
        if len(r) < 300:
            continue
        beta = r.a.rolling(260, min_periods=156).cov(r.b) / r.a.rolling(260, min_periods=156).var()
        alpha = r.b.rolling(260, min_periods=156).mean() - beta * r.a.rolling(260, min_periods=156).mean()
        gap = r.b - (alpha + beta * r.a)
        sd = gap.rolling(260, min_periods=156).std()
        z = gap / sd
        # history: after |z| first exceeded 2, did the gap shrink by half within 13 weeks?
        closed = []
        zz = z.dropna()
        last = None
        for t in zz.index[(zz.abs() > 2) & (zz.shift(1).abs() <= 2)]:
            if last is not None and (t - last).days < 180:
                continue
            last = t
            fut = gap.loc[t:].iloc[1:14]
            if len(fut) == 13:
                closed.append(bool((fut.abs() <= abs(gap.loc[t]) / 2).any()))
        corr = r.a.tail(260).corr(r.b.tail(260))
        out.append(dict(a=a, b=b, name_a=na, name_b=nb, ret_a=float(r.a.iloc[-1]), ret_b=float(r.b.iloc[-1]), beta=float(beta.iloc[-1]),
                        implied_b=float(alpha.iloc[-1] + beta.iloc[-1] * r.a.iloc[-1]), gap=float(gap.iloc[-1]), z=float(z.iloc[-1]), corr=float(corr),
                        past=len(closed), closed=int(sum(closed)), week=str(w.index[-1].date()),
                        z_hist=[[str(t.date()), round(float(v), 2)] for t, v in z.dropna().tail(156).items()]))
    out.sort(key=lambda x: -abs(x["z"]))
    return out


# ---------------------------------------------------------------- build
def build(status: dict) -> None:
    print("Signals")
    old = load_existing("signals.json")
    try:
        S = load_all()
        now = pd.Timestamp.today()
        # ratio series (USD terms where needed)
        def ratio(a, b):
            j = pd.concat([a, b], axis=1, sort=True).dropna()
            return (j.iloc[:, 0] / j.iloc[:, 1]).dropna()
        extra = {}
        if "AAXJ" in S and "ACWI" in S:
            extra["R_AAXJ_ACWI"] = ratio(S["AAXJ"], S["ACWI"])
        if "EEM" in S and "SPX" in S:
            extra["R_EEM_SPX"] = ratio(S["EEM"], S["SPX"])
        if "SOX" in S and "SPX" in S:
            extra["R_SOX_SPX"] = ratio(S["SOX"], S["SPX"])
        if "KLCI" in S and "USDMYR" in S and "AAXJ" in S:
            extra["R_KLCI_AAXJ"] = ratio(ratio(S["KLCI"], S["USDMYR"]), S["AAXJ"])
        S.update(extra)
        cache = {}
        def M_get(sid):
            if sid not in cache:
                cache[sid] = monthly(S[sid], sid, now) if sid in S else None
            return cache[sid]
        class MView(dict):
            def __missing__(self, k):
                v = M_get(k)
                if v is None:
                    raise KeyError(k)
                return v
        M = MView()
        sigs = []
        for r in rules():
            try:
                tgt = M_get(r["target"])
                if tgt is None or any(M_get(i) is None for i in r["inputs"]):
                    continue
                cond = r["cond"](M)
                # align to the target's months, through the current month
                idx = pd.date_range(min(cond.index.min(), tgt.index.min()), max(cond.index.max(), tgt.index.max()), freq="ME")
                cond = cond.reindex(idx)
                tgt_full = tgt.reindex(idx)
                res = study(cond, tgt_full, r["kind"], r["dir"], r["gap"])
                months_on = None
                if res["since"]:
                    months_on = (now.to_period("M") - pd.Timestamp(res["since"]).to_period("M")).n
                active = res["on"] and res["best_h"] is not None and months_on is not None and months_on <= res["best_h"]
                moved = None
                if res["on"] and res["since"] and r["target"] in S:
                    t = S[r["target"]]
                    a0 = t[t.index <= pd.Timestamp(res["since"])]
                    if len(a0):
                        moved = float((t.iloc[-1] / a0.iloc[-1] - 1) * 100 if r["kind"] == "ret" else t.iloc[-1] - a0.iloc[-1])
                now_vals = {}
                for i in r["inputs"]:
                    m = M_get(i)
                    now_vals[i] = [str(m.dropna().index[-1].date()), float(m.dropna().iloc[-1])]
                sigs.append(dict(id=r["id"], family=r["family"], name=r["name"], rule=r["rule"], inputs=r["inputs"], inputs_now=now_vals,
                                 target=r["target"], target_name=NAMES.get(r["target"], r["target"]), dir=r["dir"], kind=r["kind"],
                                 revised=any(i.startswith("CLI_") or i == "REG_QUAD" for i in r["inputs"]),
                                 lags={i: lag_of(i) for i in r["inputs"]}, months_on=months_on, active=bool(active), moved=moved, **res))
            except Exception as e:   # one bad rule never stops the rest
                print(f"  rule {r['id']} failed: {type(e).__name__}: {e}")
        # ideas: active signals grouped by target and direction
        cal = load_existing("calendar.json").get("events", [])
        today = now.normalize()
        ideas = {}
        for s in sigs:
            if not s["active"]:
                continue
            key = (s["target"], s["dir"])
            g = ideas.setdefault(key, dict(target=s["target"], target_name=s["target_name"], dir=s["dir"], kind=s["kind"], signals=[], score=0))
            g["signals"].append(s["id"])
            g["score"] += TIER_W[s["tier"]]
        out_ideas = []
        for (tgt, d), g in ideas.items():
            against = [s["id"] for s in sigs if s["active"] and s["target"] == tgt and s["dir"] == -d and TIER_W[s["tier"]] > 0]
            g["against"] = against
            g["net"] = g["score"] - sum(TIER_W[next(x for x in sigs if x["id"] == a)["tier"]] for a in against)
            regs = REGION.get(tgt, [])
            g["catalysts"] = [dict(d=e["d"], region=e["region"], name=e["name"]) for e in cal
                              if e.get("region") in regs and e.get("hi") and today <= pd.Timestamp(e["d"]) <= today + pd.Timedelta(days=14)][:4]
            out_ideas.append(g)
        out_ideas.sort(key=lambda g: (-g["net"], -g["score"]))
        # live track record: append new firings
        log_p = ARCHIVE_DIR / "signals_log.csv"
        rows = []
        for s in sigs:
            if s["on"] and s["since"] and s["target"] in S:
                t = S[s["target"]]
                a0 = t[t.index <= pd.Timestamp(s["since"])]
                if len(a0):
                    rows.append(dict(since=s["since"], signal=s["id"], target=s["target"], dir=s["dir"], kind=s["kind"], tier=s["tier"], best_h=s["best_h"],
                                     level=float(a0.iloc[-1]), logged=str(today.date())))
        if rows:
            new = pd.DataFrame(rows)
            if log_p.exists():
                prev = pd.read_csv(log_p)
                new = pd.concat([prev, new[~new.set_index(["signal", "since"]).index.isin(prev.set_index(["signal", "since"]).index)]])
            ARCHIVE_DIR.mkdir(exist_ok=True)
            new.sort_values(["since", "signal"]).to_csv(log_p, index=False)
        log = pd.read_csv(log_p).to_dict(orient="records") if log_p.exists() else []
        divs = divergences(S)
        # ratio series the browser does not have
        ex = {}
        for k, v in extra.items():
            w = v.resample("W-FRI").last().dropna()
            ex[k] = {"label": NAMES.get(k, k), "kind": "price", "d": [int((t - pd.Timestamp("1970-01-01")).days) for t in w.index], "v": [round(float(x), 6) for x in w.values]}
        out = dict(generated=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), signals=sigs, ideas=out_ideas, divergences=divs, log=log, extra=ex,
                   tiers=list(TIER_W), horizons=list(HORIZONS))
        write("signals.json", out)
        status["SIGNALS"] = "ok"
        n_on = sum(s["on"] for s in sigs)
        print(f"  {len(sigs)} signals ({n_on} on, {sum(s['active'] for s in sigs)} active), {len(out_ideas)} ideas, {len(divs)} divergence pairs")
    except Exception as e:
        print(f"  failed ({type(e).__name__}: {e}); kept previous")
        if old:
            write("signals.json", old)
        status["SIGNALS"] = "stale (kept previous)"


if __name__ == "__main__":
    build({})
