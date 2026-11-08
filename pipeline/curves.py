"""
Government bond yield curves from official sources (no API keys needed).

  US  nominal + real (TIPS) par curves   US Treasury daily CSV, one file per year
  JP  JGB par curve 1Y-40Y               Ministry of Finance Japan, jgbcme_all.csv + current month
  EA  euro area AAA spot curve 3M-30Y    ECB Data Portal, YC dataset

Output: docs/data/curves.json
  {market: {label, source, tenors: [years], names: [...], d: [days since 1970], y: [[yield per tenor] per day]}}
"""
from __future__ import annotations

import io
import re
from datetime import date

import pandas as pd

from fetch import EPOCH, get, load_existing, write  # shared helpers

START_YEAR = 2005

TREASURY = ("https://home.treasury.gov/resource-center/data-chart-center/interest-rates/"
            "daily-treasury-rates.csv/{year}/all")
MOF_ALL = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/historical/jgbcme_all.csv"
MOF_NOW = "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv"
ECB = "https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.{keys}"
ECB_TENORS = ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "7Y", "10Y", "15Y", "20Y", "30Y"]


def tenor_years(name: str) -> float | None:
    """'1 Mo' / '1.5 Month' / '10 Yr' / '5 YR' / '10Y' / '3M' -> years."""
    m = re.match(r"\s*([\d.]+)\s*(mo|month|m|yr|y)\b", name.strip(), re.I)
    if not m:
        return None
    n, unit = float(m.group(1)), m.group(2).lower()
    return n / 12 if unit.startswith("m") else n


def label(years: float) -> str:
    if years < 1:
        m = round(years * 12, 1)
        return f"{m:g}M"
    return f"{years:g}Y"


def pack_curve(df: pd.DataFrame, lab: str, source: str) -> dict:
    df = df.sort_index()
    df = df[~df.index.duplicated(keep="last")].dropna(how="all")
    df = df[sorted(df.columns)]
    df = df.loc[:, df.notna().sum() > 20]
    days = ((df.index - EPOCH) // pd.Timedelta(days=1)).astype(int).tolist()
    rows = [[None if pd.isna(x) else round(float(x), 3) for x in r] for r in df.to_numpy()]
    return {"label": lab, "source": source, "tenors": [round(c, 4) for c in df.columns],
            "names": [label(c) for c in df.columns], "d": days, "y": rows}


def fetch_treasury(kind: str) -> pd.DataFrame | None:
    frames = []
    for year in range(START_YEAR, date.today().year + 1):
        r = get(TREASURY.format(year=year), {"type": kind, "field_tdr_date_value": year, "page": "", "_format": "csv"})
        if r is None or not r.text.strip():
            continue
        df = pd.read_csv(io.StringIO(r.text))
        df.index = pd.to_datetime(df.pop("Date"), format="%m/%d/%Y")
        df.columns = [tenor_years(c) for c in df.columns]
        frames.append(df.loc[:, [c is not None for c in df.columns]])
    if not frames:
        return None
    out = pd.concat(frames)
    return out.apply(pd.to_numeric, errors="coerce")


def _read_mof(text: str) -> pd.DataFrame:
    lines = text.splitlines()
    hdr = next(i for i, ln in enumerate(lines) if ln.startswith("Date,"))
    df = pd.read_csv(io.StringIO("\n".join(lines[hdr:])), na_values=["-", ""])
    df = df[df["Date"].astype(str).str.match(r"^\d{4}/\d{1,2}/\d{1,2}$")]
    df.index = pd.to_datetime(df.pop("Date"), format="%Y/%m/%d")
    df.columns = [tenor_years(c) for c in df.columns]
    df = df.loc[:, [c is not None for c in df.columns]].apply(pd.to_numeric, errors="coerce")
    return df[df.index >= f"{START_YEAR}-01-01"]


def fetch_jgb() -> pd.DataFrame | None:
    frames = []
    for url in (MOF_ALL, MOF_NOW):
        r = get(url)
        if r is not None:
            frames.append(_read_mof(r.content.decode("utf-8", errors="ignore")))
    return pd.concat(frames) if frames else None


def fetch_ecb() -> pd.DataFrame | None:
    keys = "+".join(f"SR_{t}" for t in ECB_TENORS)
    r = get(ECB.format(keys=keys), {"format": "csvdata", "detail": "dataonly", "startPeriod": f"{START_YEAR}-01-01"})
    if r is None:
        return None
    df = pd.read_csv(io.StringIO(r.text), usecols=["DATA_TYPE_FM", "TIME_PERIOD", "OBS_VALUE"])
    df["tenor"] = df["DATA_TYPE_FM"].str.replace("SR_", "", regex=False).map(tenor_years)
    wide = df.pivot_table(index="TIME_PERIOD", columns="tenor", values="OBS_VALUE")
    wide.index = pd.to_datetime(wide.index)
    return wide


MARKETS = {
    "US": ("US Treasury", "US Treasury (par yield curve)", lambda: fetch_treasury("daily_treasury_yield_curve")),
    "US_REAL": ("US Treasury real (TIPS)", "US Treasury (real par yield curve)", lambda: fetch_treasury("daily_treasury_real_yield_curve")),
    "JP": ("Japan JGB", "Ministry of Finance Japan (JGB par yields)", fetch_jgb),
    "EA": ("Euro area AAA", "ECB (AAA-rated euro area government spot curve)", fetch_ecb),
}


def build_curves(status: dict) -> None:
    old = load_existing("curves.json")
    out = {}
    print("Curves:")
    for key, (lab, source, fn) in MARKETS.items():
        try:
            df = fn()
        except Exception as e:  # never let one source break the run
            print(f"      {key}: {type(e).__name__}")
            df = None
        if df is not None and len(df) > 100:
            out[key] = pack_curve(df, lab, source)
            status["CURVE_" + key] = "ok"
        elif key in old:
            out[key] = old[key]
            status["CURVE_" + key] = "stale (kept previous)"
        else:
            status["CURVE_" + key] = "missing"
        print(f"  CURVE_{key:<8} {status['CURVE_' + key]}")
    write("curves.json", out)
