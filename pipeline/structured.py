"""
Structured products data (WP37): the market inputs that set structured-product terms.

- Option-implied volatility surfaces from Cboe's delayed option chains (US shares, ADRs and ETFs that stand in for
  indices), reduced to a small grid per underlying: implied vol at 1, 3, 6 and 12 months for strikes 60% to 120% of
  spot, plus the bid of the listed 3-month put nearest 90% of spot. The chains themselves are never published.
- Cboe index histories: implied volatility indices (VIX1Y, VXN, RVX, VXEEM, VXFXI, single-stock VX*), implied
  correlation (COR1M, COR3M), dispersion (DSPX), SKEW and the PUT / BXM option-selling benchmarks.
- For every underlying (indices and the ticker list): 20 years of weekly closes (Yahoo), trailing dividend yield,
  realised volatility and barrier history (how often the price fell below B% of a start level within T months).
- Underlyings without listed options get an estimated surface: realised vol x the median implied/realised ratio of
  names that have options, with the median skew shape of the index proxies. Flagged est.
- US earnings dates (Nasdaq calendar) with the option-implied move.

Writes docs/data/structured.json (summary, loaded with the page) and docs/data/structured_hist.json (weekly closes,
lazy-loaded by the Pricer and My notes). Archives three numbers per name per day in archive/structured_iv.csv.
Isolated: any failure keeps the previously published files.
"""
from __future__ import annotations

import io
import json
import math
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone

import numpy as np
import pandas as pd
import requests

from fetch import ARCHIVE_DIR, load_existing, pack, write

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
      "Accept": "application/json,text/csv,*/*"}
CBOE_HIST = "https://cdn.cboe.com/api/global/us_indices/daily_prices/{}_History.csv"
CBOE_CHAIN = "https://cdn.cboe.com/api/global/delayed_quotes/options/{}.json"
YAHOO = "https://query1.finance.yahoo.com/v8/finance/chart/{}"

# indices: (id in yahoo.json, yahoo symbol, option proxy or None, name, currency)
SP_INDEX = [
    ("SPX", "^GSPC", "SPY", "S&P 500", "USD"), ("NDX", "^NDX", "QQQ", "Nasdaq 100", "USD"), ("RTY", "^RUT", "IWM", "Russell 2000", "USD"),
    ("SX5E", "^STOXX50E", "FEZ", "Euro Stoxx 50", "EUR"), ("NKY", "^N225", "EWJ", "Nikkei 225", "JPY"), ("HSI", "^HSI", "FXI", "Hang Seng", "HKD"),
    ("KOSPI", "^KS11", "EWY", "KOSPI", "KRW"), ("TWSE", "^TWII", "EWT", "Taiwan Weighted", "TWD"), ("NIFTY", "^NSEI", "INDA", "Nifty 50", "INR"),
    ("STI", "^STI", None, "Straits Times", "SGD"), ("KLCI", "^KLSE", None, "FBM KLCI", "MYR"), ("AS51", "^AXJO", "EWA", "ASX 200", "AUD"),
    ("EEM", "EEM", "EEM", "Emerging markets (EEM)", "USD"), ("GOLD", "GC=F", "GLD", "Gold", "USD"),
]
DIV_PROXY = {"STI": "EWS", "KLCI": "EWM"}   # dividend yield for indices comes from a fund that tracks them
FX_CHAINS = {"EURUSD": "FXE", "USDJPY": "FXY", "AUDUSD": "FXA", "GBPUSD": "FXB"}   # currency ETFs: implied vol for DCI pairs
CBOE_IDX = ["VIX1Y", "VXN", "RVX", "VXD", "VXEEM", "VXFXI", "VXEWZ", "VXEFA", "VXAPL", "VXAZN", "VXGOG", "VXGS", "GVZ", "OVX",
            "VXTLT", "VXSLV", "COR1M", "COR3M", "DSPX", "SKEW", "PUT", "BXM"]
TENORS = [30, 91, 182, 365]
MNY = [0.6, 0.7, 0.8, 0.9, 0.95, 1.0, 1.05, 1.1, 1.2]
BARRIERS = [50, 60, 65, 70, 75, 80, 90]
HORIZ = [3, 6, 12, 18, 24]   # months
ENDK = [80, 90, 100]
BASKETS = [
    ("US chips", ["NVDA", "AMD", "AVGO"]), ("US megacap tech", ["AAPL", "MSFT", "GOOGL"]), ("US consumer tech", ["AMZN", "META", "NFLX"]),
    ("Tesla + Nvidia", ["TSLA", "NVDA"]), ("US banks", ["JPM", "GS", "MS"]), ("US, Europe, Japan indices", ["SPX", "SX5E", "NKY"]),
    ("US, Japan, Hong Kong indices", ["SPX", "NKY", "HSI"]), ("China internet", ["0700.HK", "9988.HK", "3690.HK"]),
    ("Singapore banks", ["D05.SI", "O39.SI", "U11.SI"]), ("Malaysian banks", ["1155.KL", "1295.KL", "1023.KL"]),
    ("Korea memory", ["005930.KS", "000660.KS"]), ("Asia chips", ["TSM", "005930.KS", "000660.KS"]),
]


def _get(url, params=None, tries=2, timeout=60):
    for i in range(tries):
        try:
            r = requests.get(url, params=params, headers=UA, timeout=timeout)
            if r.status_code == 200:
                return r
        except requests.RequestException:
            pass
        time.sleep(1.5 * (i + 1))
    return None


# ---------------------------------------------------------------- Black-Scholes helpers (for the estimated surfaces)
def _ncdf(x):
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def bs_put(S, K, T, r, q, v):
    if T <= 0 or v <= 0:
        return max(K - S, 0.0)
    d1 = (math.log(S / K) + (r - q + 0.5 * v * v) * T) / (v * math.sqrt(T))
    d2 = d1 - v * math.sqrt(T)
    return K * math.exp(-r * T) * _ncdf(-d2) - S * math.exp(-q * T) * _ncdf(-d1)


# ---------------------------------------------------------------- option chains -> surface
OCC = re.compile(r"^([A-Z_]+?)(\d{6})([CP])(\d{8})$")
PCV = re.compile(r"\d{6}([CP])\d{8}$")


def chain_surface(sym: str) -> dict | None:
    r = _get(CBOE_CHAIN.format(sym), timeout=90)
    if r is None:
        return None
    try:
        d = r.json()["data"]
    except Exception:
        return None
    # spot consistent with the option quotes: put-call parity near the money at the nearest expiry (the "current_price"
    # field can include after-hours trading, while the option quotes are from the last session)
    S0 = d.get("close") or d.get("current_price")
    if not S0:
        return None
    mids: dict[tuple, dict] = {}
    for o in d.get("options", []):
        m = OCC.match(o.get("option", ""))
        if m and (o.get("bid") or 0) > 0 and (o.get("ask") or 0) > 0:
            K = int(m.group(4)) / 1000
            if abs(K / S0 - 1) < 0.04:
                mids.setdefault((m.group(2), K), {})[m.group(3)] = (o["bid"] + o["ask"]) / 2
    S = S0
    for e in sorted({e for e, _ in mids}):
        est = [K + v["C"] - v["P"] for (e2, K), v in mids.items() if e2 == e and "C" in v and "P" in v]
        if len(est) >= 3:
            S = float(np.median(est))
            break
    asof = datetime.strptime(r.json().get("timestamp", "")[:10], "%Y-%m-%d").date() if r.json().get("timestamp") else date.today()
    byexp: dict[int, list] = {}
    put90 = None
    for o in d.get("options", []):
        m = OCC.match(o.get("option", ""))
        if not m:
            continue
        exp = datetime.strptime(m.group(2), "%y%m%d").date()
        days = (exp - asof).days
        K = int(m.group(4)) / 1000
        iv, bid, ask, oi = o.get("iv") or 0, o.get("bid") or 0, o.get("ask") or 0, o.get("open_interest") or 0
        if days < 5 or iv <= 0.01 or iv > 3 or bid <= 0:
            continue
        cp = m.group(3)
        # out-of-the-money side only (cleaner implied vols)
        if (cp == "P" and K <= S * 1.02) or (cp == "C" and K >= S * 0.98):
            byexp.setdefault(days, []).append((K / S, iv))
        if cp == "P" and 60 <= days <= 130 and 0.85 <= K / S <= 0.95:
            score = abs(days - 91) / 91 + abs(K / S - 0.9) * 5
            if put90 is None or score < put90[0]:
                mid = (bid + ask) / 2
                put90 = (score, days, K / S, bid / K * 100, mid / K * 100, oi, (ask - bid) / mid if mid else 9)
    exps = sorted(e for e, v in byexp.items() if len(v) >= 4)
    if len(exps) < 2:
        return None

    def smile(e, m):
        pts = sorted(byexp[e])
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        if m <= xs[0]:
            return ys[0] if xs[0] - m < 0.12 else None
        if m >= xs[-1]:
            return ys[-1] if m - xs[-1] < 0.12 else None
        return float(np.interp(m, xs, ys))

    surf = []
    for T in TENORS:
        row = []
        for m in MNY:
            lo = [e for e in exps if e <= T]
            hi = [e for e in exps if e >= T]
            cand = []
            if lo and hi:
                e1, e2 = lo[-1], hi[0]
                v1, v2 = smile(e1, m), smile(e2, m)
                if v1 is not None and v2 is not None:
                    if e1 == e2:
                        cand = [v1]
                    else:   # linear in total variance
                        w = (v1 * v1 * e1 + (v2 * v2 * e2 - v1 * v1 * e1) * (T - e1) / (e2 - e1)) / T
                        cand = [math.sqrt(max(w, 1e-6))]
            elif lo:   # beyond the last listed expiry: flat
                v = smile(lo[-1], m)
                cand = [v] if v is not None else []
            elif hi:
                v = smile(hi[0], m)
                cand = [v] if v is not None else []
            row.append(round(cand[0], 4) if cand else None)
        surf.append(row)
    # fill gaps along each row from the nearest known strike
    for row in surf:
        known = [(i, v) for i, v in enumerate(row) if v is not None]
        if not known:
            return None
        for i in range(len(row)):
            if row[i] is None:
                row[i] = min(known, key=lambda kv: abs(kv[0] - i))[1]
    out = {"spot": S, "asof": asof.isoformat(), "iv30": d.get("iv30"), "surf": surf, "src": "chain", "exp_max": exps[-1]}
    # session volume of puts and calls (for the put/call ratio, WP58)
    pv = cv = 0.0
    for o in d.get("options", []):
        m = PCV.search(o.get("option", ""))
        if m:
            if m.group(1) == "P":
                pv += o.get("volume") or 0
            else:
                cv += o.get("volume") or 0
    out["pcv"] = [pv, cv]
    if put90:
        _, days, k, bidp, midp, oi, spr = put90
        out["put90"] = {"days": days, "k": round(k, 3), "bid": round(bidp, 3), "mid": round(midp, 3), "oi": oi, "spread": round(spr, 3),
                        "liquid": bool(oi >= 100 and spr <= 0.25)}
    # implied move into the next expiry (for earnings): ATM straddle / spot at the nearest two expiries
    out["front"] = []
    for e in exps[:3]:
        atm = smile(e, 1.0)
        if atm:
            out["front"].append([e, round(atm * math.sqrt(e / 365) * 0.8 * 100, 2)])   # straddle ~ 0.8 * vol * sqrt(T) * S
    return out


# ---------------------------------------------------------------- weekly history, dividends, realised vol, barriers
def yahoo_weekly(sym: str):
    r = _get(YAHOO.format(requests.utils.quote(sym)), {"range": "20y", "interval": "1wk", "events": "div"}, timeout=40)
    if r is None:
        return None, 0.0
    try:
        res = r.json()["chart"]["result"][0]
        ts = res["timestamp"]
        q = res["indicators"]["quote"][0]["close"]
        s = pd.Series(q, index=pd.to_datetime(ts, unit="s")).dropna()
        s = s.resample("W-FRI").last().dropna()   # one point a week, aligned across exchanges
        divs = (res.get("events") or {}).get("dividends") or {}
        cut = datetime.now().timestamp() - 365 * 86400
        dsum = sum(v["amount"] for v in divs.values() if v["date"] >= cut)
        px = float(s.iloc[-1]) if len(s) else 0
        return s, (dsum / px * 100 if px else 0.0)
    except Exception:
        return None, 0.0


def barrier_stats(s: pd.Series) -> dict | None:
    v = s.values.astype(float)
    n = len(v)
    if n < 80:
        return None
    lr = np.diff(np.log(v))
    rv13 = pd.Series(lr).rolling(13).std().values * math.sqrt(52)   # 3-month realised vol at each week (index i -> ends at i+1)
    rvs = np.concatenate([[np.nan], rv13])
    out = {"from": s.index[0].strftime("%Y-%m-%d"), "touch": {}, "end": {}, "med": {}, "worst": {}, "touch_hv": {}, "n": {}}
    hv_cut = np.nanpercentile(rvs, 66.7) if np.isfinite(rvs).sum() > 50 else np.inf
    for H in HORIZ:
        W = int(round(H * 52 / 12))
        m = n - W
        if m < 26:
            continue
        # min of the next W closes (excluding the start)
        mins = np.array([v[i + 1:i + W + 1].min() for i in range(m)])
        ends = v[W:W + m]
        starts = v[:m]
        rmin, rend = mins / starts, ends / starts
        hv = rvs[:m] >= hv_cut
        out["n"][H] = int(m)
        out["touch"][H] = [round(float((rmin < b / 100).mean() * 100), 1) for b in BARRIERS]
        out["touch_hv"][H] = [round(float((rmin[hv] < b / 100).mean() * 100), 1) if hv.sum() >= 20 else None for b in BARRIERS]
        out["end"][H] = [round(float((rend < k / 100).mean() * 100), 1) for k in ENDK]
        out["med"][H] = round(float(np.median(rend) * 100 - 100), 1)
        out["worst"][H] = round(float(rend.min() * 100 - 100), 1)
    return out


def realised(s: pd.Series) -> dict:
    lr = np.diff(np.log(s.values.astype(float)))
    r = pd.Series(lr, index=s.index[1:])
    v13 = r.rolling(13).std() * math.sqrt(52) * 100
    v52 = r.rolling(52).std() * math.sqrt(52) * 100
    last = v13.dropna()
    w = last[last.index >= last.index[-1] - pd.DateOffset(years=10)] if len(last) else last
    pct = float((w <= w.iloc[-1]).mean() * 100) if len(w) > 50 else None
    px = s.values.astype(float)
    ma40 = pd.Series(px).rolling(40).mean().iloc[-1]   # 40 weeks ~ 200 days
    hi52 = px[-52:].max()
    return {"rv3m": round(float(last.iloc[-1]), 2) if len(last) else None, "rv1y": round(float(v52.dropna().iloc[-1]), 2) if v52.notna().any() else None,
            "rv_pct": round(pct, 0) if pct is not None else None, "above200": bool(px[-1] > ma40) if np.isfinite(ma40) else None,
            "from_hi": round(float(px[-1] / hi52 * 100 - 100), 1)}


# ---------------------------------------------------------------- Cboe index histories
def cboe_history(name: str) -> pd.Series | None:
    r = _get(CBOE_HIST.format(name), timeout=60)
    if r is None or not r.text[:20].strip():
        return None
    try:
        df = pd.read_csv(io.StringIO(r.text))
    except Exception:
        return None
    df.columns = [c.strip().upper() for c in df.columns]
    col = "CLOSE" if "CLOSE" in df.columns else df.columns[-1]
    s = pd.Series(pd.to_numeric(df[col], errors="coerce").values, index=pd.to_datetime(df[df.columns[0]], errors="coerce")).dropna()
    s = s[s.index.notna()].sort_index()
    s = s[~s.index.duplicated(keep="last")]
    if len(s) < 100:
        return None
    # daily for the last 3 years, weekly before: keeps the file small
    cut = s.index[-1] - pd.DateOffset(years=3)
    return pd.concat([s[s.index < cut].resample("W-FRI").last().dropna(), s[s.index >= cut]])


# ---------------------------------------------------------------- earnings (Nasdaq calendar)
def earnings(symbols: set[str], days: int = 60) -> dict:
    out = {}
    d0 = date.today()
    for k in range(days):
        dd = d0 + timedelta(days=k)
        if dd.weekday() >= 5:
            continue
        r = _get("https://api.nasdaq.com/api/calendar/earnings", {"date": dd.isoformat()}, tries=1, timeout=30)
        if r is None:
            continue
        try:
            rows = (r.json().get("data") or {}).get("rows") or []
        except Exception:
            continue
        for row in rows:
            sym = (row.get("symbol") or "").upper()
            if sym in symbols and sym not in out:
                t = row.get("time") or ""
                out[sym] = {"d": dd.isoformat(), "when": "after close" if "after" in t else "before open" if "pre" in t else "",
                            "eps": row.get("epsForecast") or ""}
        time.sleep(0.25)
    return out


# ---------------------------------------------------------------- main
def _universe() -> list[dict]:
    U = [dict(id=i, sym=y, chain=c, name=n, ccy=ccy, kind="index") for i, y, c, n, ccy in SP_INDEX]
    t = load_existing("tickers.json").get("items", {})
    for sym, x in t.items():
        if x.get("type") != "EQUITY":
            continue
        us = "." not in sym and not sym.endswith("-USD")
        U.append(dict(id=sym, sym=sym, chain=sym.replace("-", ".") if us else None, name=x.get("name", sym),
                      ccy=x.get("ccy", ""), kind="us" if us else ("sg" if sym.endswith(".SI") else "my" if sym.endswith(".KL") else "hk" if sym.endswith(".HK") else "asia")))
    return U


PC_INDEX = ("_SPX", "QQQ", "IWM")


def put_call(surfs: dict, equity: set, status: dict) -> dict:
    """Daily equity and index put/call volume ratios from the chains, archived (history builds from Nov 2026)."""
    today = date.today().isoformat()
    vals = {}
    for sid, syms in (("SP_PC_EQUITY", equity), ("SP_PC_INDEX", set(PC_INDEX))):
        p = sum(surfs[s]["pcv"][0] for s in syms if s in surfs and surfs[s].get("pcv"))
        c = sum(surfs[s]["pcv"][1] for s in syms if s in surfs and surfs[s].get("pcv"))
        if c > 0 and p > 0:
            vals[sid] = (round(p / c, 4), p, c)
    ARCHIVE_DIR.mkdir(exist_ok=True)
    ap = ARCHIVE_DIR / "structured_pc.csv"
    arc = pd.read_csv(ap) if ap.exists() else pd.DataFrame(columns=["date", "id", "ratio", "puts", "calls"])
    if vals:
        new = pd.DataFrame([{"date": today, "id": k, "ratio": v[0], "puts": v[1], "calls": v[2]} for k, v in vals.items()])
        arc = pd.concat([arc[arc["date"] != today], new]).sort_values(["date", "id"])
        arc.to_csv(ap, index=False)
    out = {}
    lab = {"SP_PC_EQUITY": "Put/call volume ratio, US single shares (dashboard's own sample)",
           "SP_PC_INDEX": "Put/call volume ratio, S&P 500, Nasdaq 100 and Russell 2000 options"}
    for sid in lab:
        a = arc[arc["id"] == sid]
        if len(a):
            s = pd.Series(a["ratio"].astype(float).values, index=pd.to_datetime(a["date"])).sort_index()
            out[sid] = {"label": lab[sid], "group": "Structured products", "kind": "level", "unit": "ratio",
                        "source": "Cboe (delayed) option volume, summed by the dashboard; history from Nov 2026", **pack(s)}
            status[sid] = "ok"
    return out


def build(status: dict) -> None:
    print("Structured products")
    old = load_existing("structured.json")
    try:
        U = _universe()
        print(f"  universe: {len(U)} underlyings")
        # 1. weekly history + dividends (Yahoo)
        hist, rows = {}, {}

        def wk(u):
            return u["id"], *yahoo_weekly(u["sym"])
        with ThreadPoolExecutor(6) as ex:
            for uid, s, dy in ex.map(wk, U):
                if s is not None and len(s) > 60:
                    hist[uid] = s
                    rows[uid] = {"dy": round(dy, 2)}
        print(f"  weekly history: {len(hist)}")
        for u in U:   # indices pay no dividends themselves: use the tracking fund's trailing yield
            px = u.get("chain") or DIV_PROXY.get(u["id"])
            if u["kind"] == "index" and u["id"] in rows and px and u["id"] != "GOLD":
                rows[u["id"]]["dy"] = round(yahoo_weekly(px)[1], 2)
        # 2. option chains (US shares, ADRs, index proxies, currency ETFs)
        chains_wanted = {u["chain"] for u in U if u.get("chain")} | set(FX_CHAINS.values())
        surfs = {}
        with ThreadPoolExecutor(4) as ex:
            for sym, sf in zip(sorted(chains_wanted), ex.map(chain_surface, sorted(chains_wanted))):
                if sf:
                    surfs[sym] = sf
        print(f"  option chains: {len(surfs)} of {len(chains_wanted)}")
        # 3. per underlying
        ratios, skews = [], []
        for u in U:
            uid = u["id"]
            if uid not in hist:
                continue
            x = rows[uid]
            x.update(name=u["name"], ccy=u["ccy"], kind=u["kind"], proxy=u.get("chain") if u["kind"] == "index" else None)
            x.update(realised(hist[uid]))
            b = barrier_stats(hist[uid])
            if b:
                x["bar"] = b
            sf = surfs.get(u.get("chain")) if u.get("chain") else None
            if sf:
                x["surf"], x["src"], x["iv30"], x["asof"] = sf["surf"], "chain", sf.get("iv30"), sf["asof"]
                if sf.get("put90"):
                    x["put90"] = sf["put90"]
                if sf.get("front"):
                    x["front"] = sf["front"]
                atm3 = sf["surf"][1][MNY.index(1.0)]
                if x.get("rv3m"):
                    ratios.append(atm3 * 100 / x["rv3m"])
                if u["kind"] == "index":
                    skews.append([sf["surf"][ti][mi] / sf["surf"][ti][MNY.index(1.0)] for ti in range(len(TENORS)) for mi in range(len(MNY))])
        ratio = float(np.median(ratios)) if ratios else 1.1
        ratio = min(max(ratio, 0.9), 1.6)
        shape = np.median(np.array(skews), axis=0).reshape(len(TENORS), len(MNY)) if skews else np.ones((len(TENORS), len(MNY)))
        for uid, x in rows.items():
            if "surf" not in x and x.get("rv3m"):
                atm = x["rv3m"] / 100 * ratio
                x["surf"] = [[round(float(atm * shape[ti][mi]), 4) for mi in range(len(MNY))] for ti in range(len(TENORS))]
                x["src"] = "est"
        # 4. archive: three numbers per name per day
        today = date.today().isoformat()
        ARCHIVE_DIR.mkdir(exist_ok=True)
        ap = ARCHIVE_DIR / "structured_iv.csv"
        arc = pd.read_csv(ap) if ap.exists() else pd.DataFrame(columns=["date", "id", "atm3m", "v90_3m", "iv30"])
        new = [{"date": today, "id": uid, "atm3m": x["surf"][1][MNY.index(1.0)], "v90_3m": x["surf"][1][MNY.index(0.9)], "iv30": x.get("iv30")}
               for uid, x in rows.items() if x.get("src") == "chain"]
        if new:
            arc = pd.concat([arc[arc["date"] != today], pd.DataFrame(new)]).sort_values(["date", "id"])
            arc.to_csv(ap, index=False)
        for uid, x in rows.items():   # implied-vol percentile once a name has 250 days of archive
            a = arc[arc["id"] == uid]
            if len(a) >= 250:
                w = a["atm3m"].astype(float).tail(2520)
                x["iv_pct"] = round(float((w <= w.iloc[-1]).mean() * 100), 0)
                x["iv_days"] = int(len(a))
        # 5. baskets
        baskets = []
        for name, mem in BASKETS:
            if not all(m in hist for m in mem):
                continue
            df = pd.concat([hist[m] for m in mem], axis=1, keys=mem, sort=True).dropna()
            if len(df) < 120:
                continue
            ret = np.log(df).diff().dropna().tail(52)
            c = ret.corr().values
            pairs = [c[i][j] for i in range(len(mem)) for j in range(i + 1, len(mem))]
            v = df.values
            W = 52
            m = len(v) - W
            worst = np.array([min(v[i + 1:i + W + 1, k].min() / v[i, k] for k in range(len(mem))) for i in range(m)])
            single = [np.array([v[i + 1:i + W + 1, k].min() / v[i, k] for i in range(m)]) for k in range(len(mem))]
            best = min(single, key=lambda z: (z < 0.7).mean())
            baskets.append({"name": name, "mem": mem, "corr": round(float(np.mean(pairs)), 2), "from": df.index[0].strftime("%Y-%m-%d"),
                            "t60": round(float((worst < 0.6).mean() * 100), 1), "t70": round(float((worst < 0.7).mean() * 100), 1),
                            "best70": round(float((best < 0.7).mean() * 100), 1),
                            "weak": min(mem, key=lambda k: rows[k].get("from_hi", 0) if k in rows else 0)})
        # 6. Cboe index histories
        idx = {}
        for nm in CBOE_IDX:
            s = cboe_history(nm)
            if s is not None:
                idx["SP_" + nm] = {"label": nm, "group": "Structured products", "kind": "level", "unit": "pts", "source": f"Cboe ({nm} index)", **pack(s)}
                status["SP_" + nm] = "ok"
            time.sleep(0.2)
        print(f"  Cboe indices: {len(idx)} of {len(CBOE_IDX)}")
        # 7. earnings dates (US names) + implied move
        us_syms = {uid for uid, x in rows.items() if x["kind"] == "us"}
        er = earnings(us_syms)
        for sym, e in er.items():
            fr = rows.get(sym, {}).get("front") or []
            days = (date.fromisoformat(e["d"]) - date.today()).days
            after = [f for f in fr if f[0] >= days + 1]
            if after:
                e["move"] = after[0][1]
        print(f"  earnings dates: {len(er)}")
        # 8. put/call volume ratios (WP58): single US shares, and the index proxies (S&P 500, Nasdaq 100, Russell 2000)
        pc = put_call(surfs, {u["chain"] for u in U if u["kind"] == "us" and u.get("chain")}, status)
        idx.update(pc)
        fx = {pair: {"atm": [surfs[sym]["surf"][ti][MNY.index(1.0)] for ti in range(len(TENORS))], "asof": surfs[sym]["asof"]}
              for pair, sym in FX_CHAINS.items() if sym in surfs}
        if len(rows) < 20:
            raise RuntimeError("too few underlyings")
        out = {"_meta": {"fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "tenors": TENORS, "mny": MNY, "barriers": BARRIERS,
                         "horiz": HORIZ, "endk": ENDK, "ratio": round(ratio, 3), "n_chain": sum(1 for x in rows.values() if x.get("src") == "chain")},
               "under": rows, "baskets": baskets, "earnings": er, "fx": fx, **idx}
        write("structured.json", out)
        H = {uid: {"d": [int((t - pd.Timestamp("1970-01-01")).days) for t in s.index], "v": [float(f"{v:.5g}") for v in s.values]} for uid, s in hist.items()}
        write("structured_hist.json", H)
        status["STRUCTURED"] = "ok"
        print(f"  wrote {len(rows)} underlyings ({out['_meta']['n_chain']} with option prices)")
    except Exception as e:
        print(f"  failed ({type(e).__name__}: {e}); kept previous")
        if old:
            write("structured.json", old)
        status["STRUCTURED"] = f"failed ({type(e).__name__})"


if __name__ == "__main__":
    build({})
