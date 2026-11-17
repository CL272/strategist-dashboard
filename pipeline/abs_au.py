"""
Australia: Australian Bureau of Statistics Data API (public SDMX, no key), WP74 (Nov 2026).

  HSI_M         Monthly Household Spending Indicator: total and discretionary, % on a year (from 2019)
  LF_UNDER      underemployment and underutilisation rates (from 1978)
  LEND_HOUSING  new housing loan commitments: all, owner-occupiers, investors (quarterly, from 2002)
  RES_DWELL_ST  mean price of residential dwellings (quarterly, from 2011)

Returns series in the same format as rba.build(), merged into asia.json by asia.py. Each dataset is isolated: one
that fails leaves the previous values in place (asia.py keeps old AU_ series it does not receive).
"""
from __future__ import annotations

import csv
import io

import pandas as pd
import requests

URL = "https://data.api.abs.gov.au/rest/data/ABS,{flow}/{key}"
HEAD = {"Accept": "application/vnd.sdmx.data+csv", "User-Agent": "Mozilla/5.0 (strategist-dashboard data pipeline)"}
# (id, dataflow, key, start, label, unit, transform)
SERIES = [
    ("AU_HSI_YOY", "HSI_M", "9.TOT.CUR.20.AUS.M", "2018-01", "Australia household spending, % YoY (nominal)", "%", None),
    ("AU_HSI_DISC_YOY", "HSI_M", "9.3.CUR.20.AUS.M", "2018-01", "Australia discretionary household spending, % YoY (nominal)", "%", None),
    ("AU_UNDEREMP", "LF_UNDER", "M23.3.1599.20.AUS.M", "1978-01", "Australia underemployment rate (SA)", "%", None),
    ("AU_UNDERUTIL", "LF_UNDER", "M24.3.1599.20.AUS.M", "1978-01", "Australia underutilisation rate (SA)", "%", None),
    ("AU_LOANS", "LEND_HOUSING", "FIN_VAL.NEWCOMMITS.DV8368.TOTDWELL.TOT.TOT.20.AUS.Q", "2002-Q1", "Australia new home loans, A$ bn a quarter (SA)", "A$ bn", 1e-3),
    ("AU_LOANS_OO", "LEND_HOUSING", "FIN_VAL.NEWCOMMITS.DV8368.TOTDWELL.TOT.DV5167.20.AUS.Q", "2002-Q1", "Australia new home loans to owner-occupiers, A$ bn a quarter (SA)", "A$ bn", 1e-3),
    ("AU_LOANS_INV", "LEND_HOUSING", "FIN_VAL.NEWCOMMITS.DV8368.TOTDWELL.TOT.DV5168.20.AUS.Q", "2002-Q1", "Australia new home loans to investors, A$ bn a quarter (SA)", "A$ bn", 1e-3),
    ("AU_HOUSE_PX", "RES_DWELL_ST", "5.AUS.Q", "2011-Q1", "Australia mean dwelling price, A$ thousands (quarterly)", "A$ k", None),
]


def _period(p: str) -> pd.Timestamp:
    if "-Q" in p:
        y, q = p.split("-Q")
        return pd.Timestamp(int(y), (int(q) - 1) * 3 + 1, 1)
    return pd.Timestamp(p + "-01")


def fetch(flow: str, key: str, start: str) -> pd.Series | None:
    r = requests.get(URL.format(flow=flow, key=key), params={"startPeriod": start, "detail": "dataonly"}, headers=HEAD, timeout=120)
    if r.status_code != 200:
        return None
    pts = {}
    for row in csv.DictReader(io.StringIO(r.text)):
        try:
            pts[_period(row["TIME_PERIOD"])] = float(row["OBS_VALUE"])
        except (KeyError, ValueError):
            continue
    s = pd.Series(pts).sort_index()
    return s if len(s) >= 8 else None


def build(status: dict) -> dict[str, tuple[pd.Series, dict]]:
    print("Asia: Australia (ABS Data API)")
    out: dict[str, tuple[pd.Series, dict]] = {}
    for sid, flow, key, start, label, unit, scale in SERIES:
        try:
            s = fetch(flow, key, start)
        except requests.RequestException as e:
            print(f"      {sid}: {type(e).__name__}")
            s = None
        if s is not None:
            if scale:
                s = s * scale
            meta = dict(label=label, unit=unit, kind="level", group="Macro · Australia", source=f"Australian Bureau of Statistics Data API ({flow}, {key})")
            if flow in ("LEND_HOUSING", "RES_DWELL_ST"):
                meta["freq"] = "Q"
            out[sid] = (s, meta)
        status[sid] = "ok" if sid in out else "missing"
    return out


if __name__ == "__main__":
    for k, (s, m) in build({}).items():
        print(f"{k:16} {s.index[0].date()} → {s.index[-1].date()} last {s.iloc[-1]:.4g}  {m['label']}")
