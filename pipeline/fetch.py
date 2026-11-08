"""
Daily data pull for the strategist dashboard.

Run:  python pipeline/fetch.py
Writes JSON files into docs/data/ which the web dashboard reads.

Secrets: FRED_API_KEY (and later ESTAT_APP_ID) are read from environment
variables, or from .streamlit/secrets.toml. They are never printed or written out.
"""
from __future__ import annotations

import json
import math
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import ARCHIVE, FRED, START_DATE, YAHOO  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "data"
ARCHIVE_DIR = ROOT / "archive"
UA = {"User-Agent": "Mozilla/5.0 (strategist-dashboard data pipeline)"}
EPOCH = pd.Timestamp("1970-01-01")


# ------------------------------------------------------------------ secrets
def _clean(val: str, name: str = "") -> str:
    """Accept a bare key, a pasted line like  FRED_API_KEY = "abc123", or a whole pasted secrets.toml."""
    lines = [ln for ln in val.strip().splitlines() if ln.strip()]
    mine = [ln for ln in lines if name and ln.strip().upper().startswith(name)]
    val = (mine or lines or [""])[0].strip()
    if "=" in val:
        val = val.split("=", 1)[1]
    val = val.strip().strip('"').strip("'").strip()
    if name == "FRED_API_KEY":   # FRED keys are exactly 32 lower-case letters/digits
        import re
        m = re.search(r"[A-Za-z0-9]{32}", val)
        if m:
            val = m.group(0).lower()
    return val


def get_secret(name: str) -> str | None:
    val = os.environ.get(name)
    if val and _clean(val, name):
        return _clean(val, name)
    for p in (ROOT / ".streamlit" / "secrets.toml", Path.cwd() / ".streamlit" / "secrets.toml"):
        if p.exists():
            try:
                import tomllib
                with open(p, "rb") as f:
                    data = tomllib.load(f)
                if data.get(name):
                    return _clean(str(data[name]), name)
            except Exception:
                pass
    return None


# ------------------------------------------------------------------ helpers
def sig(x: float, n: int = 6) -> float:
    if x == 0 or not math.isfinite(x):
        return x
    return round(x, max(0, n - 1 - int(math.floor(math.log10(abs(x))))))


def pack(s: pd.Series) -> dict:
    """Series -> compact {d: [days since 1970], v: [values]}."""
    s = s.dropna()
    s = s[~s.index.duplicated(keep="last")].sort_index()
    days = ((s.index - EPOCH) // pd.Timedelta(days=1)).astype(int).tolist()
    return {"d": days, "v": [sig(float(v)) for v in s.values]}


def unpack(obj: dict) -> pd.Series:
    idx = EPOCH + pd.to_timedelta(obj["d"], unit="D")
    return pd.Series(obj["v"], index=idx, dtype="float64")


DIAG: list[str] = []   # non-secret error notes, written to meta.json for troubleshooting


def scrub(text: str) -> str:
    for name in ("FRED_API_KEY", "ESTAT_APP_ID"):
        v = get_secret(name)
        if v:
            text = text.replace(v, "***")
    return text


def get(url: str, params: dict | None = None, tries: int = 3) -> requests.Response | None:
    """GET with retries. Errors are reported without the URL (it may hold an API key)."""
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, params=params, headers=UA, timeout=30)
            if r.status_code == 200:
                return r
            last = f"HTTP {r.status_code}: {r.text[:160].strip()}"
            if 400 <= r.status_code < 500 and r.status_code != 429:
                break   # client error: retrying will not help
        except requests.RequestException as e:
            last = type(e).__name__
        time.sleep(2 * (i + 1))
    last = scrub(last or "unknown error")
    host = url.split("/")[2]
    print(f"      request failed ({host}): {last}")
    if len(DIAG) < 8:
        DIAG.append(f"{host}: {last}")
    return None


# ------------------------------------------------------------------ sources
def fetch_yahoo(symbol: str) -> pd.Series | None:
    p1 = int(pd.Timestamp(START_DATE).timestamp())
    p2 = int(time.time())
    r = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(symbol)}",
            {"period1": p1, "period2": p2, "interval": "1d", "includeAdjustedClose": "true"})
    if r is None:
        return None
    res = (r.json().get("chart") or {}).get("result")
    if not res:
        return None
    res = res[0]
    ts = res.get("timestamp") or []
    ind = res.get("indicators", {})
    vals = None
    if ind.get("adjclose") and ind["adjclose"][0].get("adjclose"):
        vals = ind["adjclose"][0]["adjclose"]
    elif ind.get("quote"):
        vals = ind["quote"][0].get("close")
    if not ts or not vals:
        return None
    tz = res.get("meta", {}).get("exchangeTimezoneName", "UTC")
    idx = pd.to_datetime(ts, unit="s", utc=True).tz_convert(tz).tz_localize(None).normalize()
    s = pd.Series(vals, index=idx, dtype="float64").dropna()
    return s[s > 0] if len(s) else None


def fetch_fred(series_id: str, api_key: str | None, start: str = START_DATE) -> pd.Series | None:
    s = None
    if api_key:
        r = get("https://api.stlouisfed.org/fred/series/observations",
                {"series_id": series_id, "api_key": api_key, "file_type": "json",
                 "observation_start": start})
        if r is not None:
            obs = r.json().get("observations", [])
            s = pd.Series({pd.Timestamp(o["date"]): o["value"] for o in obs})
    if s is None:  # no key, or the API failed: public CSV download
        r = get("https://fred.stlouisfed.org/graph/fredgraph.csv", {"id": series_id, "cosd": start})
        if r is None:
            return None
        from io import StringIO
        df = pd.read_csv(StringIO(r.text))
        s = pd.Series(df.iloc[:, 1].values, index=pd.to_datetime(df.iloc[:, 0]))
    s = pd.to_numeric(s, errors="coerce").dropna()
    return s if len(s) else None


# ------------------------------------------------------------------ derived
def asof(s: pd.Series, idx: pd.DatetimeIndex) -> pd.Series:
    """Value of s as of each date in idx (last known value, no look-ahead)."""
    s = s.dropna().sort_index()
    return s.reindex(s.index.union(idx)).ffill().reindex(idx)


def build_derived(f: dict[str, pd.Series]) -> dict[str, tuple[pd.Series, dict]]:
    out = {}

    def need(*keys):
        return all(k in f and f[k] is not None and len(f[k]) for k in keys)

    if need("FED_ASSETS", "TGA", "RRP"):
        idx = f["FED_ASSETS"].index
        net = f["FED_ASSETS"] / 1000 - asof(f["TGA"], idx) / 1000 - asof(f["RRP"], idx)
        out["NET_LIQ"] = (net / 1000, dict(label="Fed net liquidity", unit="USD tn", kind="level",
                          note="Fed total assets − TGA − ON RRP (weekly, Wednesday)"))
        out["FED_ASSETS_TN"] = (f["FED_ASSETS"] / 1e6, dict(label="Fed total assets", unit="USD tn", kind="level"))
        out["TGA_TN"] = (asof(f["TGA"], idx) / 1e6, dict(label="Treasury General Account", unit="USD tn", kind="level"))
        out["RRP_TN"] = (asof(f["RRP"], idx) / 1000, dict(label="Overnight reverse repo", unit="USD tn", kind="level"))
    if need("RESERVES"):
        out["RESERVES_TN"] = (f["RESERVES"] / 1e6, dict(label="Bank reserves", unit="USD tn", kind="level"))
    if need("RESERVES", "GDP"):
        idx = f["RESERVES"].index
        out["RES_GDP"] = (f["RESERVES"] / 1000 / asof(f["GDP"], idx) * 100,
                          dict(label="Reserves / nominal GDP", unit="%", kind="level",
                               note="Weekly reserves over latest quarterly nominal GDP (SAAR)"))
    if need("RESERVES", "BANK_ASSETS"):
        idx = f["RESERVES"].index
        out["RES_ASSETS"] = (f["RESERVES"] / 1000 / asof(f["BANK_ASSETS"], idx) * 100,
                             dict(label="Reserves / bank assets", unit="%", kind="level",
                                  note="Reserves over total assets of all US commercial banks"))

    if need("FED_ASSETS", "ECB_ASSETS", "BOJ_ASSETS", "FX_USDEUR", "FX_JPYUSD"):
        idx = f["FED_ASSETS"].index
        fed = f["FED_ASSETS"] / 1e6
        ecb = asof(f["ECB_ASSETS"], idx) * asof(f["FX_USDEUR"], idx) / 1e6
        boj = asof(f["BOJ_ASSETS"], idx) * 1e8 / asof(f["FX_JPYUSD"], idx) / 1e12
        start = max(f["ECB_ASSETS"].index.min(), f["BOJ_ASSETS"].index.min())
        keep = idx >= start
        out["GCB_FED"] = (fed[keep], dict(label="Fed", unit="USD tn", kind="level"))
        out["GCB_ECB"] = (ecb[keep], dict(label="ECB", unit="USD tn", kind="level"))
        out["GCB_BOJ"] = (boj[keep], dict(label="BoJ", unit="USD tn", kind="level"))
        out["GCB_TOTAL"] = ((fed + ecb + boj)[keep], dict(label="Fed + ECB + BoJ", unit="USD tn", kind="level",
                            note="In USD at market FX; BoJ is monthly, carried forward"))

    if need("SOFR", "IORB"):
        idx = f["SOFR"].index[f["SOFR"].index >= f["IORB"].index.min()]
        out["SOFR_IORB"] = ((f["SOFR"].reindex(idx) - asof(f["IORB"], idx)) * 100,
                            dict(label="SOFR − IORB", unit="bp", kind="level"))
    if need("EFFR", "IORB"):
        idx = f["EFFR"].index[f["EFFR"].index >= f["IORB"].index.min()]
        out["EFFR_IORB"] = ((f["EFFR"].reindex(idx) - asof(f["IORB"], idx)) * 100,
                            dict(label="EFFR − IORB", unit="bp", kind="level"))
    if need("M2"):
        out["M2_YOY"] = (f["M2"].pct_change(12) * 100, dict(label="US M2 YoY", unit="%", kind="level"))
    for k, lab in (("HY_OAS", "US HY spread"), ("IG_OAS", "US IG spread"), ("EUR_HY_OAS", "Euro HY spread"),
                   ("ASIA_CORP_OAS", "Asia EM corporate spread"), ("BAA_10Y", "Moody's Baa − 10Y")):
        if need(k):
            out[k + "_BP"] = (f[k] * 100, dict(label=lab, unit="bp", kind="level"))
    out.update(build_regime(f))
    return out


# ------------------------------------------------------------------ regime model
REGIMES = {1: "Goldilocks", 2: "Overheat", 3: "Stagflation", 4: "Slowdown"}


def _monthly(s: pd.Series) -> pd.Series:
    return s.resample("MS").mean()


def _z(x: pd.Series, window: int = 120, min_periods: int = 60) -> pd.Series:
    """Rolling 10-year z-score (only past data), clipped at ±3 so COVID doesn't dominate."""
    m = x.rolling(window, min_periods=min_periods).mean()
    sd = x.rolling(window, min_periods=min_periods).std()
    return ((x - m) / sd).clip(-3, 3)


def build_regime(f: dict[str, pd.Series]) -> dict[str, tuple[pd.Series, dict]]:
    """
    Growth x inflation regime (the 'Investment Clock' / 'GIP quad' family of models).

    1. Each input becomes a year-on-year growth rate (CFNAI is used as a 3-month average level).
    2. Each is z-scored against its own trailing 10 years, then averaged into a
       Growth composite and an Inflation composite.
    3. Momentum = change in the 3-month average of each composite over 3 months.
    4. Growth momentum up/down x inflation momentum up/down -> 4 regimes.
    """
    out = {}
    have = lambda k: k in f and f[k] is not None and len(f[k]) > 24
    yoy = lambda s: (s / s.shift(12) - 1) * 100
    g_in, i_in = {}, {}
    if have("CFNAI"):
        g_in["CFNAI"] = ("Chicago Fed activity index (3m avg)", _monthly(f["CFNAI"]).rolling(3).mean())
    if have("INDPRO"):
        g_in["INDPRO"] = ("Industrial production YoY", yoy(_monthly(f["INDPRO"])))
    if have("PAYEMS"):
        g_in["PAYEMS"] = ("Payrolls YoY", yoy(_monthly(f["PAYEMS"])))
    if have("RETAIL_REAL"):
        g_in["RETAIL_REAL"] = ("Real retail sales YoY", yoy(_monthly(f["RETAIL_REAL"])))
    if have("CLAIMS"):
        c = _monthly(f["CLAIMS"])
        g_in["CLAIMS"] = ("Jobless claims YoY (inverted)", -100 * (c / c.shift(12)).apply(math.log))
    if have("CPI"):
        i_in["CPI"] = ("Headline CPI YoY", yoy(_monthly(f["CPI"])))
    if have("CORE_CPI"):
        cc = _monthly(f["CORE_CPI"])
        i_in["CORE_CPI"] = ("Core CPI YoY", yoy(cc))
        i_in["CORE_CPI_3M"] = ("Core CPI 3m annualised", ((cc / cc.shift(3)) ** 4 - 1) * 100)
    if have("CORE_PCE"):
        i_in["CORE_PCE"] = ("Core PCE YoY", yoy(_monthly(f["CORE_PCE"])))
    if len(g_in) < 3 or len(i_in) < 2:
        return out

    def composite(inputs, prefix, side):
        zs = {}
        for k, (label, x) in inputs.items():
            z = _z(x.dropna())
            zs[k] = z
            out[f"{prefix}_{k}"] = (z, dict(label=label, unit="z", kind="level", side=side))
        df = pd.DataFrame(zs)
        need = max(2, len(inputs) - 2)
        comp = df.mean(axis=1, skipna=True).where(df.notna().sum(axis=1) >= need)
        return comp.dropna()

    G = composite(g_in, "RZG", "growth")
    I = composite(i_in, "RZI", "inflation")
    Gs, Is = G.rolling(3).mean(), I.rolling(3).mean()
    Gm, Im = (Gs - Gs.shift(3)).dropna(), (Is - Is.shift(3)).dropna()
    idx = Gm.index.intersection(Im.index)
    Gm, Im = Gm.reindex(idx), Im.reindex(idx)
    quad = pd.Series(4.0, index=idx)
    quad[(Gm >= 0) & (Im < 0)] = 1
    quad[(Gm >= 0) & (Im >= 0)] = 2
    quad[(Gm < 0) & (Im >= 0)] = 3
    note = "Monthly. Dated to the data month; most inputs are published 2-6 weeks after month end."
    out["REG_G"] = (G, dict(label="Growth composite", unit="z", kind="level", note=note))
    out["REG_I"] = (I, dict(label="Inflation composite", unit="z", kind="level", note=note))
    out["REG_GM"] = (Gm, dict(label="Growth momentum", unit="z", kind="level", note=note))
    out["REG_IM"] = (Im, dict(label="Inflation momentum", unit="z", kind="level", note=note))
    out["REG_QUAD"] = (quad, dict(label="Regime", unit="", kind="level", note=note, names=REGIMES))

    # NY Fed yield-curve recession model (Estrella & Mishkin probit), 12 months ahead
    curve = f.get("CURVE_3m10y_LONG")
    if curve is None or not len(curve):
        curve = f.get("CURVE_3m10y")
    if curve is not None and len(curve):
        sp = _monthly(curve)
        prob = sp.apply(lambda x: 50 * (1 + math.erf((-0.5333 - 0.6330 * x) / math.sqrt(2))) * 1.0)
        out["REC_PROB_NYF"] = (prob, dict(label="Recession probability, 12m ahead (NY Fed curve model)", unit="%", kind="level",
                               note="Probit on the monthly-average 10y-3m Treasury spread: P = Φ(−0.5333 − 0.6330 × spread)"))
    if have("CLAIMS"):
        out["CLAIMS_4WK"] = (f["CLAIMS"].rolling(4).mean() / 1000, dict(label="Initial jobless claims, 4-week avg", unit="k", kind="level"))
    if have("CORE_CPI"):
        cc = _monthly(f["CORE_CPI"])
        out["CORE_CPI_YOY"] = (yoy(cc), dict(label="Core CPI YoY", unit="%", kind="level"))
        out["CORE_CPI_3M"] = (((cc / cc.shift(3)) ** 4 - 1) * 100, dict(label="Core CPI 3m annualised", unit="%", kind="level"))
    if have("CPI"):
        out["CPI_YOY"] = (yoy(_monthly(f["CPI"])), dict(label="Headline CPI YoY", unit="%", kind="level"))
    if have("CORE_PCE"):
        out["CORE_PCE_YOY"] = (yoy(_monthly(f["CORE_PCE"])), dict(label="Core PCE YoY", unit="%", kind="level"))
    return out


# ------------------------------------------------------------------ archive
def merge_archive(sid: str, new: pd.Series | None, published: pd.Series | None) -> pd.Series | None:
    """Append-only history: archive CSV + last published data + today's fetch (newest wins)."""
    parts = []
    path = ARCHIVE_DIR / f"{sid}.csv"
    if path.exists():
        a = pd.read_csv(path, parse_dates=["date"]).set_index("date")["value"]
        parts.append(a)
    if published is not None:
        parts.append(published)
    if new is not None:
        parts.append(new)
    if not parts:
        return None
    merged = pd.concat(parts)
    merged = merged[~merged.index.duplicated(keep="last")].sort_index().dropna()
    if new is not None:   # only rewrite the archive when we actually got fresh data
        ARCHIVE_DIR.mkdir(exist_ok=True)
        merged.rename("value").rename_axis("date").to_csv(path, date_format="%Y-%m-%d")
    return merged


# ------------------------------------------------------------------ main
def load_existing(name: str) -> dict:
    p = OUT / name
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            pass
    return {}


def write(name: str, obj: dict):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / name).write_text(json.dumps(obj, separators=(",", ":")))


def main() -> int:
    status = {}
    fred_key = get_secret("FRED_API_KEY")
    print(f"FRED API key: {'found' if fred_key else 'not set - using public CSV download'}")

    # --- Yahoo
    old = load_existing("yahoo.json")
    yahoo = {}
    print(f"Yahoo: {len(YAHOO)} series")
    for sid, sym, label, group, kind, unit in YAHOO:
        s = fetch_yahoo(sym)
        meta = dict(label=label, group=group, kind=kind, unit=unit, source=f"Yahoo Finance ({sym})")
        if s is not None and len(s) > 20:
            yahoo[sid] = {**meta, **pack(s)}
            status[sid] = "ok"
        elif sid in old:
            yahoo[sid] = old[sid]
            status[sid] = "stale (kept previous)"
        else:
            status[sid] = "missing"
        print(f"  {sid:<12} {status[sid]}")
        time.sleep(0.3)
    write("yahoo.json", yahoo)

    # --- FRED
    old = load_existing("fred.json")
    fred, fred_series = {}, {}
    print(f"FRED: {len(FRED)} series")
    fails_in_a_row = 0
    for sid, code, label, group, kind, unit, *rest in FRED:
        start = rest[0] if rest else START_DATE
        # if FRED is unreachable, stop hammering it and keep previous data
        s = None if fails_in_a_row >= 3 else fetch_fred(code, fred_key, start)
        fails_in_a_row = 0 if s is not None else fails_in_a_row + 1
        meta = dict(label=label, group=group, kind=kind, unit=unit, source=f"FRED ({code})")
        if sid in ARCHIVE:
            s = merge_archive(sid, s, unpack(old[sid]) if sid in old else None)
        if s is not None:
            fred[sid] = {**meta, **pack(s)}
            fred_series[sid] = s
            status[sid] = "ok"
        elif sid in old:
            fred[sid] = old[sid]
            fred_series[sid] = unpack(old[sid])
            status[sid] = "stale (kept previous)"
        else:
            status[sid] = "missing"
        print(f"  {sid:<12} {status[sid]}")
        time.sleep(0.2)
    write("fred.json", fred)

    # --- derived
    derived = {}
    for sid, (s, meta) in build_derived(fred_series).items():
        derived[sid] = {**meta, "group": "Derived", "source": "Calculated from FRED", **pack(s)}
    write("derived.json", derived)
    print(f"Derived: {', '.join(derived) or 'none (FRED data missing)'}")

    # --- yield curves (official sources, no keys)
    import curves
    import fetch as _self   # curves.py imports this module by name; collect its error notes too
    curves.build_curves(status)
    import asia
    asia.build_asia(status)
    if _self is not sys.modules.get("__main__"):
        DIAG.extend(x for x in _self.DIAG if x not in DIAG)

    try:
        import news
        news.build_news()
    except Exception as e:   # headlines must never break the data refresh
        print(f"News failed: {type(e).__name__}")

    ok = sum(v == "ok" for v in status.values())
    write("meta.json", {"updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                        "ok": ok, "total": len(status), "status": status,
                        "fred_key_found": bool(fred_key), "errors": DIAG})
    print(f"Done: {ok}/{len(status)} series refreshed")
    return 0 if ok > len(status) * 0.5 else 1


if __name__ == "__main__":
    sys.exit(main())
