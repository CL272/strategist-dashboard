"""
Daily prices for individual tickers, for the Idea log and its Watchlist.

Built-in list (CORE) plus any extra tickers in watchlist.txt at the repository root.
Source: Yahoo Finance chart API (daily closes, about 3 years). TradingView has no free data API.
Writes docs/data/tickers.json; a ticker that fails keeps its previously published history.
"""
from __future__ import annotations

import re
import time
from pathlib import Path

import requests

from fetch import UA, load_existing, scrub, write

CORE = """
1155.KL 1295.KL 1023.KL 5347.KL 5225.KL 6012.KL 6947.KL 4863.KL 5183.KL 6033.KL 3816.KL 5681.KL 4707.KL 1961.KL 2445.KL
5285.KL 4197.KL 1066.KL 5819.KL 1082.KL 1015.KL 4715.KL 3182.KL 5211.KL 4677.KL 6742.KL 0166.KL 5398.KL 8869.KL 7084.KL
5296.KL 1818.KL 7113.KL 5168.KL 0138.KL 6888.KL 4065.KL 0097.KL 5249.KL 8664.KL 1171.KL 3867.KL 5246.KL 7277.KL
D05.SI O39.SI U11.SI Z74.SI C6L.SI BN4.SI S68.SI C38U.SI A17U.SI 9CI.SI Y92.SI F34.SI G13.SI S63.SI V03.SI U96.SI C07.SI
H78.SI N2IU.SI M44U.SI ME8U.SI BS6.SI 5E2.SI D01.SI C09.SI U14.SI AJBU.SI S58.SI BUOU.SI J69U.SI
AAPL MSFT NVDA GOOGL AMZN META TSLA AVGO BRK-B JPM V MA LLY UNH XOM COST NFLX AMD ORCL CRM ADBE PLTR TSM ASML WMT JNJ
PG HD BAC KO PEP MRK ABBV CVX INTC QCOM MU ARM SMCI COIN MSTR UBER DIS NKE BA CAT GS MS BLK SPGI
SPY QQQ IWM DIA EEM EFA EWM EWS EWJ EWY EWT EWH INDA FXI KWEB MCHI GLD SLV GDX TLT IEF SHY HYG LQD EMB VNQ ARKK XLK XLF
XLE XLV SOXX URA TAN ICLN IBIT
0700.HK 9988.HK 3690.HK 1810.HK 0939.HK 1299.HK 0388.HK 1211.HK 0005.HK 0941.HK 2318.HK 0883.HK 9618.HK 1024.HK
7203.T 6758.T 8306.T 9984.T 6861.T 8035.T 9983.T 7974.T 6501.T 8058.T
005930.KS 000660.KS 2330.TW 2317.TW 2454.TW BHP.AX CBA.AX CSL.AX RIO.AX
ETH-USD SOL-USD XRP-USD
""".split()
WATCHLIST = Path(__file__).resolve().parent.parent / "watchlist.txt"
SUFFIX = {"MYX": ".KL", "KLSE": ".KL", "SGX": ".SI", "HKEX": ".HK", "TSE": ".T", "TYO": ".T", "ASX": ".AX", "KRX": ".KS",
          "TWSE": ".TW", "LSE": ".L", "XETR": ".DE", "NSE": ".NS", "BSE": ".BO", "IDX": ".JK", "SET": ".BK"}
US = {"NASDAQ", "NYSE", "AMEX", "ARCA", "NYSEARCA", "BATS", "CBOE"}


def normalise(raw: str) -> str | None:
    s = raw.strip().split("#")[0].strip().upper().lstrip("$")
    if not s or " " in s:
        return None
    if ":" in s:
        ex, code = s.split(":", 1)
        if ex in US:
            return code
        if ex in SUFFIX:
            if ex == "HKEX" and code.isdigit():
                code = code.zfill(4)
            return code + SUFFIX[ex]
        return None
    return s if re.fullmatch(r"[A-Z0-9.\-=^]{1,20}", s) else None


def user_list() -> list[str]:
    if not WATCHLIST.exists():
        return []
    out = []
    for line in WATCHLIST.read_text(encoding="utf-8").splitlines():
        sym = normalise(line)
        if sym and sym not in out:
            out.append(sym)
    return out


def fix_splits(d: list[int], v: list[float], splits: dict) -> None:
    """Yahoo sometimes logs a split or bonus issue on the wrong date, leaving an unadjusted jump in the
    closes (ViTrox's 2-for-1 bonus in 2024 shows as a 50% one-day fall). For each listed split, find a
    one-day move within 60 days of its date that matches the ratio (within 12%) and rescale the earlier prices."""
    for sp in splits.values():
        try:
            ratio = float(sp["numerator"]) / float(sp["denominator"])
            day = int(sp["date"] // 86400)
        except Exception:
            continue
        if not ratio or abs(ratio - 1) < 0.05:
            continue
        best = None
        for i in range(1, len(v)):
            if abs(d[i] - day) <= 60 and v[i - 1]:
                err = abs((v[i] / v[i - 1]) * ratio - 1)
                if err < 0.12 and (best is None or err < best[1]):
                    best = (i, err)
        if best:
            for k in range(best[0]):
                v[k] = float(f"{v[k] / ratio:.6g}")


def fetch(sym: str) -> dict | None:
    try:
        r = requests.get(f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(sym)}",
                         params={"range": "3y", "interval": "1d", "events": "split"}, headers=UA, timeout=30)
        if r.status_code != 200:
            return None
        res = (r.json().get("chart") or {}).get("result")
        if not res:
            return None
        meta, ts = res[0]["meta"], res[0].get("timestamp") or []
        closes = res[0]["indicators"]["quote"][0].get("close") or []
        d, v = [], []
        for t, c in zip(ts, closes):
            if c is None:
                continue
            day = int(t // 86400)
            if d and d[-1] == day:
                v[-1] = float(f"{c:.6g}")
            else:
                d.append(day)
                v.append(float(f"{c:.6g}"))
        if len(d) < 5:
            return None
        fix_splits(d, v, (res[0].get("events") or {}).get("splits") or {})
        return {"name": meta.get("longName") or meta.get("shortName") or sym, "ccy": meta.get("currency") or "",
                "exch": meta.get("fullExchangeName") or meta.get("exchangeName") or "", "type": meta.get("instrumentType") or "", "d": d, "v": v}
    except Exception as e:
        print(f"      {sym}: {scrub(type(e).__name__)}")
        return None


def build(status: dict) -> None:
    extra = [s for s in user_list() if s not in CORE]
    syms = CORE + extra
    print(f"Tickers: {len(CORE)} built-in + {len(extra)} from watchlist.txt")
    old = (load_existing("tickers.json") or {}).get("items", {})
    items, failed = {}, []
    for sym in syms:
        x = fetch(sym)
        if x is None and sym in old:
            x = {**old[sym], "stale": True}
        if x is None:
            failed.append(sym)
        else:
            x["src"] = "watchlist" if sym in extra else "core"
            items[sym] = x
        time.sleep(0.2)
    write("tickers.json", {"items": items, "failed": failed, "watchlist": extra})
    status["TICKERS"] = "ok" if len(items) > len(syms) * 0.8 else ("stale (kept previous)" if items else "missing")
    print(f"  {len(items)} tickers, {len(failed)} failed{': ' + ', '.join(failed[:12]) if failed else ''}")
