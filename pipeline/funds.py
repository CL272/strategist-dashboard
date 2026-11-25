"""
Weekly fund prices with dividends for the portfolio allocator (Design plan 4, Step 1; owner's approval 25 Nov 2026).

Allocation → Portfolio and Add a fund work out tracking error from weekly returns. This module writes, for each fund in
FUNDS and each ticker in watchlist.txt, the last dividend-adjusted close of every week ending Friday, from 2005 or the
fund's first day (Yahoo Finance chart API, adjusted close: dividends and splits included). Prices quoted in pence (GBp)
are divided by 100 and stored as GBP. `thin` = the share of the last three years' weeks with no price change: a thinly
traded fund (the Bursa and some Singapore funds) understates its own volatility and the tracking error it causes.

Writes docs/data/funds.json = {"_meta": {...}, "funds": {symbol: {name, short, ccy, cls, src, d, v, thin}}}.
Isolated: a fund that fails keeps its previous history, and the file is written even if some fail.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import pandas as pd
import requests

from fetch import EPOCH, get, load_existing, sig, write

START = "2005-01-01"
GAP = 0.3   # seconds between calls
THIN_YEARS = 3
# symbol, short name, asset class. Checked on Yahoo on 25 Nov 2026 (adjusted closes, currency, first date): see DESIGN_PLAN_4.md
FUNDS = [
    # equities
    ("ACWI", "iShares MSCI ACWI", "Equities"), ("VT", "Vanguard Total World Stock", "Equities"), ("URTH", "iShares MSCI World", "Equities"),
    ("SPY", "SPDR S&P 500", "Equities"), ("QQQ", "Invesco QQQ (Nasdaq 100)", "Equities"), ("EFA", "iShares MSCI EAFE", "Equities"),
    ("EEM", "iShares MSCI Emerging Markets", "Equities"), ("AAXJ", "iShares MSCI Asia ex Japan", "Equities"), ("EWJ", "iShares MSCI Japan", "Equities"),
    ("MCHI", "iShares MSCI China", "Equities"), ("INDA", "iShares MSCI India", "Equities"), ("EWM", "iShares MSCI Malaysia", "Equities"),
    ("EWS", "iShares MSCI Singapore", "Equities"), ("CSPX.L", "iShares Core S&P 500 UCITS (Acc)", "Equities"),
    ("VWRA.L", "Vanguard FTSE All-World UCITS (Acc)", "Equities"), ("IWDA.L", "iShares Core MSCI World UCITS (Acc)", "Equities"),
    ("ISAC.L", "iShares MSCI ACWI UCITS (Acc)", "Equities"), ("EIMI.L", "iShares Core MSCI EM IMI UCITS (Acc)", "Equities"),
    ("CNDX.L", "iShares Nasdaq 100 UCITS (Acc)", "Equities"), ("ES3.SI", "SPDR Straits Times Index ETF", "Equities"),
    ("G3B.SI", "Amova Singapore STI ETF", "Equities"), ("0820EA.KL", "FTSE Bursa Malaysia KLCI ETF", "Equities"),
    # bonds
    ("AGG", "iShares Core US Aggregate Bond", "Bonds"), ("BND", "Vanguard Total Bond Market", "Bonds"), ("BNDW", "Vanguard Total World Bond", "Bonds"),
    ("BNDX", "Vanguard Total International Bond (USD-hedged)", "Bonds"), ("SHY", "iShares 1–3 Year Treasury", "Bonds"),
    ("IEF", "iShares 7–10 Year Treasury", "Bonds"), ("TLT", "iShares 20+ Year Treasury", "Bonds"), ("TIP", "iShares TIPS Bond", "Bonds"),
    ("LQD", "iShares USD Investment Grade Corporate", "Bonds"), ("HYG", "iShares USD High Yield Corporate", "Bonds"),
    ("EMB", "iShares JPM USD Emerging Markets Bond", "Bonds"), ("AGGU.L", "iShares Global Aggregate Bond UCITS (USD-hedged)", "Bonds"),
    ("IGLA.L", "iShares Global Government Bond UCITS (Acc)", "Bonds"), ("IBTA.L", "iShares USD Treasury 1–3yr UCITS (Acc)", "Bonds"),
    ("IDTL.L", "iShares USD Treasury 20+yr UCITS", "Bonds"), ("LQDA.L", "iShares USD Corporate Bond UCITS (Acc)", "Bonds"),
    ("IHYA.L", "iShares USD High Yield Corporate UCITS (Acc)", "Bonds"), ("JPEA.L", "iShares JPM USD EM Bond UCITS (Acc)", "Bonds"),
    ("FLOA.L", "iShares USD Floating Rate Bond UCITS (Acc)", "Bonds"), ("ERNA.L", "iShares USD Ultrashort Bond UCITS (Acc)", "Bonds"),
    ("A35.SI", "ABF Singapore Bond Index Fund", "Bonds"), ("MBH.SI", "Amova SGD Investment Grade Corporate Bond ETF", "Bonds"),
    ("0800EA.KL", "ABF Malaysia Bond Index Fund", "Bonds"),
    # cash-like, gold, property
    ("BIL", "SPDR 1–3 Month T-Bill", "Cash-like"), ("IB01.L", "iShares USD Treasury 0–1yr UCITS (Acc)", "Cash-like"),
    ("GLD", "SPDR Gold Shares", "Gold"), ("IGLN.L", "iShares Physical Gold ETC", "Gold"),
    ("VNQ", "Vanguard Real Estate (US REITs)", "Property"), ("IWDP.L", "iShares Developed Markets Property Yield UCITS", "Property"),
    ("CLR.SI", "Lion-Phillip S-REIT ETF", "Property"),
]


def fetch_fund(sym: str) -> dict | None:
    """Daily adjusted closes -> the last close of each week ending Friday, with the fund's name and currency."""
    r = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(sym)}",
            {"period1": int(pd.Timestamp(START).timestamp()), "period2": int(time.time()), "interval": "1d", "includeAdjustedClose": "true"})
    if r is None:
        return None
    res = (r.json().get("chart") or {}).get("result")
    if not res:
        return None
    res = res[0]
    meta, ts = res.get("meta") or {}, res.get("timestamp") or []
    adj = ((res.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose") or []
    if not ts or not adj:
        return None
    tz = meta.get("exchangeTimezoneName", "UTC")
    idx = pd.to_datetime(ts, unit="s", utc=True).tz_convert(tz).tz_localize(None).normalize()
    s = pd.Series(adj, index=idx, dtype="float64").dropna()
    s = s[s > 0]
    ccy = meta.get("currency") or ""
    if ccy == "GBp":   # London quotes in pence
        s, ccy = s / 100, "GBP"
    w = s.groupby(s.index.to_period("W-FRI")).tail(1)   # the last close of each week ending Friday, dated the day it was made (never a future Friday)
    if len(w) < 60:
        return None
    recent = w[w.index >= w.index[-1] - pd.DateOffset(years=THIN_YEARS)]
    ch = recent.pct_change().dropna()
    thin = float((ch.abs() < 1e-9).mean()) if len(ch) else 0.0
    return {"name": meta.get("longName") or meta.get("shortName") or sym, "ccy": ccy, "type": meta.get("instrumentType") or "",
            "d": [int((t - EPOCH).days) for t in w.index], "v": [sig(float(x)) for x in w.values], "thin": round(thin, 3)}


def build(status: dict) -> None:
    print("Funds for the portfolio allocator (Yahoo, weekly adjusted closes)")
    old = (load_existing("funds.json") or {}).get("funds", {})
    try:
        from tickers import user_list
        extra = [s for s in user_list() if s not in {f[0] for f in FUNDS}]
    except Exception:
        extra = []
    universe = [(s, short, cls, "core") for s, short, cls in FUNDS] + [(s, None, "Other", "watchlist") for s in extra]
    out, failed = {}, []
    for k, (sym, short, cls, src) in enumerate(universe):
        if k:
            time.sleep(GAP)
        x = None
        try:
            x = fetch_fund(sym)
        except Exception as e:
            print(f"  {sym}: {type(e).__name__}")
        if x:
            out[sym] = {"name": x["name"], "short": short or x["name"], "ccy": x["ccy"], "cls": cls, "src": src, "d": x["d"], "v": x["v"], "thin": x["thin"]}
            status[f"FUND_{sym}"] = "ok"
        elif sym in old:
            out[sym] = old[sym]
            status[f"FUND_{sym}"] = "stale (kept previous)"
            failed.append(sym)
        else:
            status[f"FUND_{sym}"] = "missing"
            failed.append(sym)
    write("funds.json", {"_meta": {"fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "failed": failed,
                                    "classes": ["Equities", "Bonds", "Cash-like", "Gold", "Property", "Other"], "watchlist": extra},
                         "funds": out})
    print(f"  {len(out)} funds ({len(out) - len([f for f in failed if f in out])} fresh)" + (f"; failed: {', '.join(failed)}" if failed else ""))


if __name__ == "__main__":
    build({})
