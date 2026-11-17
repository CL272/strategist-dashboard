"""
Australia: Reserve Bank of Australia statistical tables (public CSVs, no key).

  F1.1  cash rate target, 3M bank bills       F2   government bond yields (daily)
  G1    CPI, trimmed mean (quarterly)         H5   labour force
  H1    GDP, terms of trade (quarterly)       D1   credit and broad money growth
  F11.1 trade-weighted AUD (daily)
  WP74 (Nov 2026), what the RBA watches: H5 participation, hours, vacancies; H4 wages and unit labour costs; H3 dwelling
  approvals, consumer sentiment, business conditions; H2 consumption, dwelling investment, saving; G4 monthly CPI;
  G3 inflation expectations; E2 household debt; E13 mortgage payments; F6 mortgage rates; D1 housing credit by borrower

Returns series in the same format as cnjp.build(), written into asia.json by asia.py.
"""
from __future__ import annotations

import csv
import functools
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
    ("AU_CREDIT_YOY", "d1",   "DGFACNF12",      "Australia total credit growth YoY",      "%",   "Macro · Australia"),
    ("AU_HOUSING_YOY","d1",   "DGFACH12",     "Australia housing credit growth YoY",    "%",   "Macro · Australia"),
    ("AU_BROAD_YOY",  "d1",   "DGFABM12",     "Australia broad money growth YoY",       "%",   "Macro · Australia"),
    ("AU_TWI",        "f11.1","FXRTWI",       "AUD trade-weighted index (May 1970=100)", "idx", "FX · Australia"),
    # WP74: the drivers of RBA decisions (labour market, housing, households)
    ("AU_PART",       "h5",   "GLFSPRSA",     "Australia participation rate (SA)",      "%",   "Macro · Australia"),
    ("AU_EMPPOP",     "h5",   "GLFSEPTPOP",   "Australia employment to population",     "%",   "Macro · Australia"),
    ("AU_HOURS_YOY",  "h5",   "GLFMHWTRYP",   "Australia hours worked growth YoY (trend)", "%", "Macro · Australia"),
    ("AU_VAC_LF",     "h5",   "GLFOSVTLF",    "Australia job vacancies, % of labour force", "%", "Macro · Australia"),
    ("AU_WPI_YOY",    "h4",   "GWPIYP",       "Australia wage price index growth YoY",  "%",   "Macro · Australia"),
    ("AU_ULC_YOY",    "h4",   "GNFULCYP",     "Australia unit labour costs growth YoY", "%",   "Macro · Australia"),
    ("AU_APPROVALS",  "h3",   "GISPSDA",      "Australia private dwelling approvals (thousands)", "k", "Macro · Australia"),
    ("AU_CONS_SENT",  "h3",   "GICWMICS",     "Australia consumer sentiment (Westpac-Melbourne Institute; 100 = neutral)", "idx", "Macro · Australia"),
    ("AU_NAB_COND",   "h3",   "GICNBC",       "Australia business conditions (NAB, deviation from average)", "idx", "Macro · Australia"),
    ("AU_CONS_YOY",   "h2",   "GGDPECCVPSHY", "Australia household consumption growth YoY (real)", "%", "Macro · Australia"),
    ("AU_DWELL_INV_YOY", "h2", "GGDPECCVPSDY", "Australia dwelling investment growth YoY (real)", "%", "Macro · Australia"),
    ("AU_SAVING",     "h2",   "GGDPICHDISR",  "Australia household saving ratio",       "%",   "Macro · Australia"),
    ("AU_RDI_YOY",    "h2",   "GGDPICHRDIY",  "Australia real household disposable income growth YoY", "%", "Macro · Australia"),
    ("AU_CPI_M_YOY",  "g4",   "GCPIAGYPM",    "Australia monthly CPI YoY",              "%",   "Macro · Australia"),
    ("AU_INFEXP_CONS","g3",   "GCONEXP",      "Australia consumers' 1-year inflation expectations", "%", "Macro · Australia"),
    ("AU_INFEXP_MKT", "g3",   "GMAREXPY",     "Australia market economists' 1-year inflation expectations", "%", "Macro · Australia"),
    ("AU_DEBT_INC",   "e2",   "BHFDDIT",      "Australia household debt to income",     "%",   "Macro · Australia"),
    ("AU_MORT_PAY",   "e13",  "LPHTSPRI",     "Australia scheduled mortgage payments, % of household income", "%", "Macro · Australia"),
    ("AU_MORT_RATE",  "f6",   "FLRHOOVA",     "Australia mortgage rate, outstanding variable (owner-occupier)", "%", "Rates · Australia"),
    ("AU_MORT_RATE_NEW", "f6", "FLRHOFTA",    "Australia mortgage rate, new loans (owner-occupier)", "%", "Rates · Australia"),
    ("AU_CREDIT_OO_YOY", "d1", "DGFACOH12",   "Australia owner-occupier housing credit growth YoY", "%", "Macro · Australia"),
    ("AU_CREDIT_INV_YOY", "d1", "DGFACIH12",  "Australia investor housing credit growth YoY", "%", "Macro · Australia"),
]
# daily versions (table F1, from 2011) spliced onto the monthly history, so a decision shows the day after it is made
DAILY = {"AU_CASH": "FIRMMCRTD", "AU_3M": "FIRMMBAB90D"}
TABLE_NAMES = {"f1": "F1", "f1.1": "F1.1", "f2": "F2", "g1": "G1", "h5": "H5", "h1": "H1", "d1": "D1", "f11.1": "F11.1",
               "h2": "H2", "h3": "H3", "h4": "H4", "g3": "G3", "g4": "G4", "e2": "E2", "e13": "E13", "f6": "F6"}
# long histories kept in full (the Labour market page draws unemployment since 1978); everything else from 2000
LONG = {"AU_UNEMP", "AU_PART", "AU_EMPPOP", "AU_VAC_LF", "AU_APPROVALS", "AU_CONS_YOY", "AU_DWELL_INV_YOY", "AU_SAVING", "AU_WPI_YOY", "AU_ULC_YOY"}


@functools.lru_cache(maxsize=None)   # the asia and cbwatch steps both read F1/F2: download each table once per run
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
            s = s if sid in LONG else s[s.index >= "2000-01-01"]
            kind = "yield" if group.startswith("Rates") else "level"
            out[sid] = (s, dict(label=label, unit=unit, kind=kind, group=group,
                                source=f"Reserve Bank of Australia (table {TABLE_NAMES[t]}, {code})"))
        status[sid] = "ok" if sid in out else "missing"
    return out
