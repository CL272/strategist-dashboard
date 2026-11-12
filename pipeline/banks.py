"""
Banking and credit data from central banks, for the markets FRED does not cover (owner's request, 12 Nov 2026).

- IMF Financial Soundness Indicators (dataset FSIC, reported by each central bank, quarterly): non-performing loans
  to gross loans, Tier 1 capital to risk-weighted assets, return on equity and private credit growth, for 17
  economies (Malaysia, Singapore, Indonesia, Thailand, the Philippines, Korea, India, China, Hong Kong, Australia,
  Japan, the US, the UK, Germany, France, Italy, Spain).
- Bank Negara Malaysia via data.gov.my (household-debt dashboard, from the Central Credit Reference Information
  System): monthly household loans applied for, approved, disbursed and repaid, by purpose, since Dec 2006.
- MAS via SingStat (M701091): commercial bank loans to residents (business, consumer, housing), monthly from Jul 2021.

Isolated: each source that fails keeps its previously published series. Writes docs/data/banks.json.
"""
from __future__ import annotations

import io
import re
import time
from datetime import datetime, timezone

import pandas as pd
import requests

from fetch import load_existing, pack, unpack, write

UA = {"User-Agent": "Mozilla/5.0 (compatible; dashboard data refresh)"}
IMF = "https://api.imf.org/external/sdmx/2.1/data/IMF.STA,FSIC/{key}"
FSI_C = {"MYS": "Malaysia", "SGP": "Singapore", "IDN": "Indonesia", "THA": "Thailand", "PHL": "Philippines", "KOR": "Korea", "IND": "India",
         "CHN": "China", "HKG": "Hong Kong", "AUS": "Australia", "JPN": "Japan", "USA": "United States", "GBR": "United Kingdom",
         "DEU": "Germany", "FRA": "France", "ITA": "Italy", "ESP": "Spain"}
FSI_I = {"AQ12_CFSI_PT": ("NPL", "non-performing loans, % of gross loans"), "FSI626_CFSI_PT": ("T1", "Tier 1 capital, % of risk-weighted assets"),
         "ROE_CFSI_PT": ("ROE", "bank return on equity, %"), "FSI709_AFSI_PT": ("CRG", "credit growth to the private sector, %")}
HHDEBT = "https://storage.data.gov.my/dashboards/hhdebt_timeseries.parquet"
HH_COLS = {"property_residental": "property", "vehicles_passenger": "cars", "credit_card": "cards", "personal_total": "personal", "securities": "securities"}
SINGSTAT = "https://tablebuilder.singstat.gov.sg/api/table/tabledata/M701091"
SG_ROWS = {"1": ("SG_LOANS", "Singapore bank loans to residents, total"), "1.1": ("SG_LOANS_BUS", "Singapore bank loans to businesses"),
           "1.2": ("SG_LOANS_CONS", "Singapore consumer loans"), "1.2.1": ("SG_LOANS_HOUSING", "Singapore housing loans")}


def _quarter(p: str) -> pd.Timestamp | None:
    m = re.match(r"(\d{4})-Q(\d)", p)
    return pd.Timestamp(int(m.group(1)), int(m.group(2)) * 3, 1) + pd.offsets.MonthEnd(0) if m else None


def imf_fsi() -> dict:
    key = f"{'+'.join(FSI_C)}.S12CFSI.{'+'.join(FSI_I)}.Q"
    r = requests.get(IMF.format(key=key), params={"startPeriod": "2005"}, headers=UA, timeout=120)
    r.raise_for_status()
    out = {}
    for attrs, body in re.findall(r"<Series ([^>]*)>(.*?)</Series>", r.text, re.S):
        a = dict(re.findall(r'(\w+)="([^"]*)"', attrs))
        c, ind = a.get("COUNTRY"), a.get("INDICATOR")
        if c not in FSI_C or ind not in FSI_I:
            continue
        obs = [(_quarter(t), float(v)) for t, v in re.findall(r'TIME_PERIOD="([^"]+)"[^>]*OBS_VALUE="([^"]+)"', body)]
        s = pd.Series({t: v for t, v in obs if t is not None}).sort_index()
        if len(s) >= 4 and s.index[-1] >= pd.Timestamp.today() - pd.DateOffset(years=2):   # leave out series the country stopped reporting
            short, lab = FSI_I[ind]
            out[f"FSI_{short}_{c}"] = {"label": f"{FSI_C[c]}: {lab}", "group": "Banks", "kind": "level", "unit": "%", "freq": "Q",
                                       "source": f"IMF Financial Soundness Indicators (FSIC, {ind}), reported by the central bank", **pack(s)}
    return out


def my_household() -> dict:
    r = requests.get(HHDEBT, headers=UA, timeout=90)
    r.raise_for_status()
    df = pd.read_parquet(io.BytesIO(r.content))
    df = df[df["chart_type"] == "rm"].copy()
    df["date"] = pd.to_datetime(df["date"])
    out = {}
    for tr in ("applied", "approved", "disbursed", "repaid"):
        d = df[df["transaction"] == tr].set_index("date").sort_index()
        if d.empty:
            continue
        tot = d[list(HH_COLS)].sum(axis=1) / 1e9
        out[f"MY_HH_{tr.upper()}"] = {"label": f"Malaysia household loans {tr}, RM bn a month", "group": "Banks", "kind": "level", "unit": "RM bn",
                                      "source": "Bank Negara Malaysia (CCRIS) via data.gov.my (household debt)", **pack(tot)}
        if tr in ("applied", "approved"):
            for col, short in HH_COLS.items():
                out[f"MY_HH_{tr.upper()}_{short.upper()}"] = {"label": f"Malaysia household loans {tr}: {short}, RM bn", "group": "Banks", "kind": "level",
                                                              "unit": "RM bn", "source": "Bank Negara Malaysia (CCRIS) via data.gov.my", **pack(d[col] / 1e9)}
    return out


def sg_loans() -> dict:
    out = {}
    for sno, (sid, lab) in SG_ROWS.items():
        r = requests.get(SINGSTAT, params={"seriesNoORrowNo": sno, "limit": 5000}, headers=UA, timeout=60)
        r.raise_for_status()
        cols = r.json()["Data"]["row"][0]["columns"]
        s = pd.Series({pd.Timestamp(datetime.strptime(c["key"], "%Y %b")) + pd.offsets.MonthEnd(0): float(c["value"]) for c in cols if c.get("value") not in (None, "", "na")}).sort_index()
        out[sid] = {"label": lab + ", S$ mn", "group": "Banks", "kind": "level", "unit": "S$ mn", "source": "MAS via SingStat (M701091, commercial banks, end of month)", **pack(s)}
        time.sleep(0.3)
    return out


def build(status: dict) -> None:
    print("Banks and credit (IMF FSI, Bank Negara, MAS)")
    old = load_existing("banks.json")
    out = {}
    for name, fn, prefix in (("IMF FSI", imf_fsi, "FSI_"), ("BNM household loans", my_household, "MY_HH_"), ("MAS bank loans", sg_loans, "SG_LOANS")):
        try:
            got = fn()
            if not got:
                raise RuntimeError("no series")
            out.update(got)
            print(f"  {name}: {len(got)} series")
            for k in got:
                status[k] = "ok"
        except Exception as e:
            kept = {k: v for k, v in old.items() if k.startswith(prefix)}
            out.update(kept)
            print(f"  {name} failed ({type(e).__name__}: {str(e)[:80]}); kept {len(kept)} previous")
            for k in kept:
                status[k] = "stale (kept previous)"
    out["_meta"] = {"fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "countries": FSI_C}
    write("banks.json", out)


if __name__ == "__main__":
    build({})
