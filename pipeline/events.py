"""Daily history for event studies (owner's request, 23 Nov 2026): what markets did after VIX (and, since Design plan 3, the MOVE)
closed above a level.

Writes docs/data/events.json, loaded by the page only when the "After VIX spikes" card is opened:
  VIX   daily close from 1990: FRED VIXCLS (Cboe's VIX via FRED), topped up with Yahoo's ^VIX for the latest days
  markets: daily closes from 1990 (or each index's first year on Yahoo): S&P 500, Nasdaq 100, Nikkei 225, Hang Seng,
  Straits Times, FBM KLCI (prices, local currency, no dividends), and UST 7-10Y (IEF, adjusted close: coupons included).
  MOVE  ICE BofA MOVE index (Treasury implied volatility), Yahoo ^MOVE from its first year; the dashboard copy if that fails.
Isolated: a failure keeps the previous file's series.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from fetch import fetch_yahoo, load_existing, pack, unpack, write

START = "1990-01-01"
MARKETS = [("SPX", "^GSPC", "S&P 500"), ("NDX", "^NDX", "Nasdaq 100"), ("NKY", "^N225", "Nikkei 225"), ("HSI", "^HSI", "Hang Seng"),
           ("STI", "^STI", "Straits Times"), ("KLCI", "^KLSE", "FBM KLCI"), ("IEF", "IEF", "UST 7-10Y (IEF)")]


def _ser(s: pd.Series, label: str, source: str) -> dict:
    s = s.dropna().round(2)
    return {"label": label, "source": source, **pack(s[~s.index.duplicated(keep="last")].sort_index())}


def build(status: dict) -> None:
    print("Event-study history (FRED VIX, Yahoo daily closes from 1990)")
    old, fred, yahoo = load_existing("events.json"), load_existing("fred.json"), load_existing("yahoo.json")
    out: dict = {}
    # VIX: FRED from 1990, with Yahoo's latest closes on top (FRED posts a day later)
    try:
        v = unpack(fred["VIXCLS"]) if "VIXCLS" in fred else None
        if v is None or len(v) < 5000:
            raise RuntimeError("no VIXCLS")
        if "VIX" in yahoo:
            y = unpack(yahoo["VIX"])
            v = pd.concat([v, y[y.index > v.index[-1]]])
        out["VIX"] = _ser(v, "VIX", "Cboe VIX via FRED (VIXCLS); latest days Yahoo Finance (^VIX)")
        status["EV_VIX"] = "ok"
    except Exception as e:
        if "VIX" in old:
            out["VIX"] = old["VIX"]
        print(f"  VIX failed ({type(e).__name__}); kept previous")
    # VIX 3-month (for the curve: VIX3M ÷ VIX below 1 = inverted), Yahoo from Jul 2006
    if "VIX3M" in yahoo:
        out["VIX3M"] = _ser(unpack(yahoo["VIX3M"]), "VIX 3-month", "Cboe VIX3M via Yahoo Finance (^VIX3M)")
        status["EV_VIX3M"] = "ok"
    elif "VIX3M" in old:
        out["VIX3M"] = old["VIX3M"]
    # MOVE (Design plan 3, Step 8): when bond volatility spikes, what do equities do?
    try:
        m = fetch_yahoo("^MOVE", START)
        if m is None or len(m) < 2500:
            raise RuntimeError("short")
        out["MOVE"] = _ser(m, "MOVE (Treasury implied volatility)", "ICE BofA MOVE index via Yahoo Finance (^MOVE)")
        status["EV_MOVE"] = "ok"
    except Exception as e:
        if "MOVE" in old:
            out["MOVE"] = old["MOVE"]
        elif "MOVE" in yahoo:
            out["MOVE"] = _ser(unpack(yahoo["MOVE"]), "MOVE (Treasury implied volatility)", "ICE BofA MOVE index via Yahoo Finance (^MOVE)")
        print(f"  MOVE failed ({type(e).__name__}); kept previous")
    for sid, sym, lab in MARKETS:
        try:
            s = fetch_yahoo(sym, START)
            if s is None or len(s) < 2500:
                raise RuntimeError("short")
            out[sid] = _ser(s, lab, f"Yahoo Finance ({sym}), daily " + ("adjusted close" if sid == "IEF" else "close"))
            status[f"EV_{sid}"] = "ok"
        except Exception as e:
            if sid in old:
                out[sid] = old[sid]
            print(f"  {lab} failed ({type(e).__name__}); kept previous")
    out["_meta"] = {"fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "markets": [[a, c] for a, _, c in MARKETS]}
    print(f"  {len(out) - 1} series")
    write("events.json", out)


if __name__ == "__main__":
    build({})
