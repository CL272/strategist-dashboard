"""
Australia: Reserve Bank of Australia statistical tables (public CSVs, no key).

  F1.1  cash rate target, 3M bank bills       F2   government bond yields (daily)
  G1    CPI, trimmed mean (quarterly)         H5   labour force
  H1    GDP, terms of trade (quarterly)       D1   credit and broad money growth
  F11.1 trade-weighted AUD (daily)

Returns series in the same format as cnjp.build(), written into asia.json by asia.py.
"""
from __future__ import annotations

import csv
import io

import pandas as pd

from fetch import get

URL = "https://www.rba.gov.au/statistics/tables/csv/{t}-data.csv"

# (id, table, RBA series id, label, unit, group)
SERIES = [
    ("AU_CASH",       "f1.1", "FIRMMCRT",     "RBA cash rate target",                   "%",   "Rates · Australia"),
    ("AU_3M",         "f1.1", "FIRMMBAB90",   "Australia 3M bank bill rate",            "%",   "Rates · Australia"),
    ("AU_2Y",         "f2",   "FCMYGBAG2D",   "Australia 2Y government bond yield",     "%",   "Rates · Australia"),
    ("AU_10Y",        "f2",   "FCMYGBAG10D",  "Australia 10Y government bond yield",    "%",   "Rates · Australia"),
    ("AU_CPI_YOY",    "g1",   "GCPIAGYP",     "Australia CPI YoY",                      "%",   "Macro · Australia"),
    ("AU_TRIM_YOY",   "g1",   "GCPIOCPMTMYP", "Australia trimmed-mean CPI YoY",         "%",   "Macro · Australia"),
    ("AU_UNEMP",      "h5",   "GLFSURSA",     "Australia unemployment rate (SA)",       "%",   "Macro · Australia"),
    ("AU_EMP_YOY",    "h5",   "GLFSEPTSYP",   "Australia employment growth YoY",        "%",   "Macro · Australia"),
    ("AU_GDP_YOY",    "h1",   "GGDPCVGDPY",   "Australia real GDP YoY",                 "%",   "Macro · Australia"),
    ("AU_TOT",        "h1",   "GOPITT",       "Australia terms of trade",               "idx", "Macro · Australia"),
    ("AU_CREDIT_YOY", "d1",   "DGFAC12",      "Australia total credit growth YoY",      "%",   "Macro · Australia"),
    ("AU_HOUSING_YOY","d1",   "DGFACH12",     "Australia housing credit growth YoY",    "%",   "Macro · Australia"),
    ("AU_BROAD_YOY",  "d1",   "DGFABM12",     "Australia broad money growth YoY",       "%",   "Macro · Australia"),
    ("AU_TWI",        "f11.1","FXRTWI",       "AUD trade-weighted index (May 1970=100)", "idx", "FX · Australia"),
]
# daily versions (table F1, from 2011) spliced onto the monthly history, so a decision shows the day after it is made
DAILY = {"AU_CASH": "FIRMMCRTD", "AU_3M": "FIRMMBAB90D"}
TABLE_NAMES = {"f1": "F1", "f1.1": "F1.1", "f2": "F2", "g1": "G1", "h5": "H5", "h1": "H1", "d1": "D1", "f11.1": "F11.1"}


def rba_table(t: str) -> dict[str, pd.Series] | None:
    r = get(URL.format(t=t))
    if r is None:
        return None
    rows = list(csv.reader(io.StringIO(r.content.decode("utf-8-sig", errors="replace"))))
    head = {row[0]: row for row in rows[:15] if row}
    ids, freq = head.get("Series ID"), head.get("Frequency", [])
    if not ids:
        return None
    start = next(i for i, row in enumerate(rows) if row and row[0] == "Series ID") + 1
    cols: dict[str, dict] = {sid: {} for sid in ids[1:]}
    for row in rows[start:]:
        if not row or not row[0]:
            continue
        try:
            d = pd.to_datetime(row[0], dayfirst=True)
        except Exception:
            continue
        for sid, v in zip(ids[1:], row[1:]):
            try:
                cols[sid][d] = float(v)
            except ValueError:
                pass
    out = {}
    for j, sid in enumerate(ids[1:], start=1):
        s = pd.Series(cols[sid]).sort_index()
        if len(s) < 8:
            continue
        f = freq[j] if j < len(freq) else ""
        if f == "Monthly":          # month-end -> month start, as elsewhere in the dashboard
            s.index = s.index.to_period("M").to_timestamp()
        elif f == "Quarterly":      # quarter-end -> quarter start
            s.index = s.index.to_period("Q").to_timestamp()
        out[sid] = s[~s.index.duplicated(keep="last")]
    return out


def build(status: dict) -> dict[str, tuple[pd.Series, dict]]:
    print("Asia: Australia (RBA)")
    out: dict[str, tuple[pd.Series, dict]] = {}
    tables = {t: rba_table(t) for t in dict.fromkeys(["f1"] + [t for _, t, *_ in SERIES])}
    for sid, t, code, label, unit, group in SERIES:
        s = (tables.get(t) or {}).get(code)
        d = (tables.get("f1") or {}).get(DAILY.get(sid, ""))
        if d is not None and len(d):
            s = d if s is None else pd.concat([s[s.index < d.index[0]], d])
            code, t = f"{DAILY[sid]}, with {code} before {d.index[0]:%Y}", "f1"
        if s is not None:
            s = s[s.index >= "2000-01-01"]
            kind = "yield" if group.startswith("Rates") else "level"
            out[sid] = (s, dict(label=label, unit=unit, kind=kind, group=group,
                                source=f"Reserve Bank of Australia (table {TABLE_NAMES[t]}, {code})"))
        status[sid] = "ok" if sid in out else "missing"
    return out
