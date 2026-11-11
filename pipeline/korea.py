"""
Korea's chip exports, the timeliest hard data on AI memory demand (DRAM / HBM are most of it).

Source: UN Comtrade public preview API (no key; one month per call, about 15 seconds each):
  comtradeapi.un.org/public/v1/preview/C/M/HS?reporterCode=410&period=YYYYMM&cmdCode=8542,854232&flowCode=X&partnerCode=0
  HS 8542 = electronic integrated circuits; HS 854232 = memories. Values in US dollars, monthly.
Comtrade runs several months behind Korea's own release (the Bank of Korea's ECOS API is timely but its keys are only
issued to Korean residents). History since 2018 was back-filled once into archive/KR_CHIP_EXP.csv and KR_MEM_EXP.csv;
each run asks only for the next missing months (at most MAX_CALLS) and appends them.
Writes docs/data/korea.json.
"""
from __future__ import annotations

import time
from datetime import date

import pandas as pd
import requests

from fetch import ARCHIVE_DIR, load_existing, merge_archive, pack, write

URL = "https://comtradeapi.un.org/public/v1/preview/C/M/HS"
CODES = {"8542": ("KR_CHIP_EXP", "Korea chip exports (HS 8542)"), "854232": ("KR_MEM_EXP", "Korea memory chip exports (HS 854232)")}
MAX_CALLS = 4


def _month(y: int, m: int) -> pd.Timestamp:
    return pd.Timestamp(year=y, month=m, day=1)


def fetch_month(y: int, m: int) -> dict[str, float] | None:
    try:
        r = requests.get(URL, params={"reporterCode": 410, "period": f"{y}{m:02d}", "cmdCode": ",".join(CODES), "flowCode": "X", "partnerCode": 0},
                         headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
        if not r.ok:
            return None
        return {d["cmdCode"]: d["primaryValue"] / 1e9 for d in r.json().get("data", []) if d.get("primaryValue") is not None}
    except Exception:
        return None


def build(status: dict) -> None:
    print("Korea chip exports (UN Comtrade)")
    old = load_existing("korea.json")
    archived = {}
    for code, (sid, _) in CODES.items():
        p = ARCHIVE_DIR / f"{sid}.csv"
        archived[sid] = pd.read_csv(p, parse_dates=["date"]).set_index("date")["value"] if p.exists() else pd.Series(dtype="float64")
    last = max((s.index.max() for s in archived.values() if len(s)), default=pd.Timestamp("2017-12-01"))
    new = {sid: {} for sid, _ in CODES.values()}
    y, m, calls, today = last.year, last.month, 0, date.today()
    while calls < MAX_CALLS:
        m += 1
        if m == 13:
            y, m = y + 1, 1
        if (y, m) >= (today.year, today.month):
            break
        got = fetch_month(y, m)
        calls += 1
        if not got:   # not published yet: later months will not be either
            break
        for code, v in got.items():
            if code in CODES:
                new[CODES[code][0]][_month(y, m)] = v
        time.sleep(1)
    out = {}
    for code, (sid, label) in CODES.items():
        fresh = pd.Series(new[sid], dtype="float64") if new[sid] else None
        s = merge_archive(sid, fresh, None)
        if s is None or not len(s):
            if sid in old:
                out[sid] = old[sid]
            status[sid] = "stale (kept previous)" if sid in old else "unavailable"
            continue
        out[sid] = {"label": label, "group": "Macro · Korea", "kind": "level", "unit": "USD bn", "source": f"UN Comtrade (Korea exports, HS {code})", **pack(s)}
        status[sid] = "ok"
    write("korea.json", out)
    added = sum(len(v) for v in new.values()) // len(CODES)
    print(f"  {calls} call(s), {added} new month(s); latest {max((pd.Timestamp(EPOCH_DAY(v['d'][-1])) for v in out.values()), default='none')}")


def EPOCH_DAY(d: int) -> pd.Timestamp:
    return pd.Timestamp("1970-01-01") + pd.Timedelta(days=int(d))


if __name__ == "__main__":
    build({})
