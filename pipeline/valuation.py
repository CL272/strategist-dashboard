"""
Valuation inputs.

  Shiller (Yale)      US stock market data since 1871: price, earnings, dividends, CAPE, excess CAPE yield,
                      and the realised 10-year forward real return for each month.
                      Download: https://www.econ.yale.edu/~shiller/data/ie_data.xls
                      (falls back to the last published copy, then to legacy/ie_data.xls in this repo)
  NY Fed              ACM 10-year Treasury term premium (daily)

Returns {id: (series, meta)} merged into derived.json by fetch.py.
"""
from __future__ import annotations

import io

import pandas as pd

from fetch import DIAG, ROOT, get

SHILLER_URLS = ["https://www.econ.yale.edu/~shiller/data/ie_data.xls", "http://www.econ.yale.edu/~shiller/data/ie_data.xls"]
ACM_URL = "https://www.newyorkfed.org/medialibrary/media/research/data_indicators/ACMTermPremium.xls"


def _shiller_frame(raw: bytes) -> pd.DataFrame | None:
    df = pd.read_excel(io.BytesIO(raw), sheet_name="Data", header=None, engine="xlrd")
    df = df[pd.to_numeric(df[0], errors="coerce").notna()].copy()
    # dates are written as 1871.01 ... 1871.1 (October) ... 1871.12
    def to_date(x):
        s = f"{float(x):.2f}"
        y, m = s.split(".")
        return pd.Timestamp(int(y), int(m), 1)
    df.index = df[0].map(to_date)
    cols = {1: "P", 2: "D", 3: "E", 4: "CPI", 6: "GS10", 12: "CAPE", 16: "ECY", 19: "FWD10_STOCK", 20: "FWD10_BOND"}
    out = df[list(cols)].rename(columns=cols).apply(pd.to_numeric, errors="coerce")
    return out if len(out) > 1000 else None


def shiller(status: dict) -> pd.DataFrame | None:
    for url in SHILLER_URLS:
        r = get(url, tries=2)
        if r is not None and r.content[:4] == b"\xd0\xcf\x11\xe0":    # legacy Excel signature
            try:
                df = _shiller_frame(r.content)
                if df is not None:
                    status["SHILLER"] = "ok"
                    return df
            except Exception as e:
                DIAG.append(f"Shiller parse: {type(e).__name__}")
    p = ROOT / "legacy" / "ie_data.xls"
    if p.exists():
        status["SHILLER"] = "stale (repo copy)"
        return _shiller_frame(p.read_bytes())
    status["SHILLER"] = "missing"
    return None


def acm(status: dict) -> pd.Series | None:
    r = get(ACM_URL, tries=2)
    if r is None:
        status["ACM_TP"] = "missing"
        return None
    try:
        d = pd.read_excel(io.BytesIO(r.content), sheet_name="ACM Daily", usecols=["DATE", "ACMTP10"])
        s = pd.Series(d["ACMTP10"].astype(float).values, index=pd.to_datetime(d["DATE"], format="%d-%b-%Y", errors="coerce")).dropna()
        s = s[s.index >= "1990-01-01"]
        status["ACM_TP"] = "ok"
        return s
    except Exception as e:
        DIAG.append(f"ACM parse: {type(e).__name__}")
        status["ACM_TP"] = "missing"
        return None


def build(status: dict) -> dict[str, tuple[pd.Series, dict]]:
    out = {}
    print("Valuation:")
    sh = shiller(status)
    src = "Robert Shiller, Yale (ie_data.xls)"
    if sh is not None:
        out["SH_CAPE"] = (sh["CAPE"].dropna(), dict(label="US CAPE (Shiller P/E10)", unit="x", kind="level", group="Valuation", source=src))
        pe = (sh["P"] / sh["E"]).dropna()
        out["SH_PE"] = (pe, dict(label="US trailing P/E (S&P composite)", unit="x", kind="level", group="Valuation", source=src))
        out["SH_DY"] = ((sh["D"] / sh["P"] * 100).dropna(), dict(label="US dividend yield", unit="%", kind="level", group="Valuation", source=src))
        out["SH_ECY"] = ((sh["ECY"] * 100).dropna(), dict(label="Excess CAPE yield (Shiller)", unit="%", kind="level", group="Valuation", source=src,
                         note="1/CAPE minus the real 10-year Treasury yield (Shiller's definition)"))
        out["SH_FWD10"] = ((sh["FWD10_STOCK"] * 100).dropna(), dict(label="Realised next-10-year real return, US stocks", unit="%", kind="level",
                           group="Valuation", source=src))
        out["SH_P"] = (sh["P"].dropna(), dict(label="S&P composite (Shiller, monthly average)", unit="idx", kind="price", group="Valuation", source=src))
        print(f"  SHILLER      {status['SHILLER']} (to {sh['CAPE'].dropna().index[-1]:%b %Y})")
    tp = acm(status)
    if tp is not None:
        out["ACM_TP10"] = (tp, dict(label="10Y Treasury term premium (ACM)", unit="%", kind="yield", group="Valuation",
                           source="Federal Reserve Bank of New York (ACM term premium, ACMTP10)"))
    print(f"  ACM_TP       {status.get('ACM_TP')}")
    return out
