"""
Taiwan from DGBAS, the national statistics office (nstatdb.dgbas.gov.tw, SDMX-JSON, no key).

  A030101015  consumer price index, headline (series 1)
  A050104010  industrial production index: total (1) and information & electronics (6)
  A040107010  labour force: unemployment rate (series 12, total)
  A081201010  merchandise trade in US$ mn: exports and imports
  A018101010  national accounts: real GDP growth, % year on year (quarterly)
Export orders (Ministry of Economic Affairs), the National Development Council's leading index and monitoring score,
the central bank's rates and TSMC's monthly revenue could not be reached from the build environment (blocked or timing
out), so they are not used. Isolated: a failure keeps the previous file. Writes docs/data/taiwan.json.
"""
from __future__ import annotations

import re

import pandas as pd
import requests

from fetch import load_existing, pack, unpack, write

URL = "https://nstatdb.dgbas.gov.tw/dgbasall/webMain.aspx?sdmx/{table}/{key}&startTime={start}&endTime={end}"
UA = {"User-Agent": "Mozilla/5.0 (compatible; dashboard data refresh)"}
SRC = "DGBAS national statistics database"


def _period(p: str) -> pd.Timestamp | None:
    m = re.fullmatch(r"(\d{4})-M(\d{1,2})", p)
    if m:
        return pd.Timestamp(int(m.group(1)), int(m.group(2)), 1)
    m = re.fullmatch(r"(\d{4})-Q(\d)", p)
    if m:
        return pd.Timestamp(int(m.group(1)), (int(m.group(2)) - 1) * 3 + 1, 1)
    return None


def sdmx(table: str, key: str, quarterly: bool = False) -> dict[str, pd.Series]:
    start, end = ("2000-Q1", "2030-Q4") if quarterly else ("2000-M01", "2030-M12")
    r = requests.get(URL.format(table=table, key=key, start=start, end=end), headers=UA, timeout=90)
    r.raise_for_status()
    j = r.json()
    st = j["data"].get("structure") or j["structure"]
    obs = [_period(v["id"]) for v in st["dimensions"]["observation"][0]["values"]]
    out = {}
    for k, ser in j["data"]["dataSets"][0]["series"].items():
        pts = {obs[int(i)]: float(v[0]) for i, v in ser["observations"].items() if v and v[0] not in (None, 0) and obs[int(i)] is not None}
        if pts:
            out[k] = pd.Series(pts, dtype="float64").sort_index()
    return out


def yoy(s: pd.Series, sum3: bool = False) -> pd.Series:
    s = s.asfreq("MS")
    if sum3:
        s = s.rolling(3).sum()
    return ((s / s.shift(12) - 1) * 100).dropna()


def build(status: dict) -> None:
    print("Taiwan (DGBAS)")
    old = load_existing("taiwan.json")
    out, errs = {}, {}

    def put(sid, s, label, unit, table, freq=None):
        if s is None or not len(s):
            return
        out[sid] = {"label": label, "group": "Macro · Taiwan", "kind": "level", "unit": unit, "source": f"{SRC} ({table})",
                    **({"freq": freq} if freq else {}), **pack(s)}
        status[sid] = "ok"

    jobs = [
        ("cpi", lambda: put("TW_CPI_YOY", yoy(sdmx("A030101015", "1..1.M")["0"]), "Taiwan CPI YoY", "%", "A030101015, YoY calculated")),
        ("ip", lambda: [put(sid, yoy(s), lab, "%", "A050104010, YoY calculated") for (sid, lab), s in
                        zip([("TW_IP_YOY", "Taiwan industrial production YoY"), ("TW_IP_ICT_YOY", "Taiwan electronics output YoY")],
                            [v for _, v in sorted(sdmx("A050104010", "1+6..1.M").items())])]),
        ("jobs", lambda: put("TW_UNEMP", sdmx("A040107010", "12..1.M").get("0:0"), "Taiwan unemployment rate", "%", "A040107010")),
        ("trade", lambda: (lambda t: (put("TW_EXP_YOY", yoy(t["0:0"], True), "Taiwan exports, YoY (3-month sum)", "%", "A081201010, USD, YoY calculated"),
                                      put("TW_IMP_YOY", yoy(t["0:1"], True), "Taiwan imports, YoY (3-month sum)", "%", "A081201010, USD, YoY calculated"),
                                      put("TW_EXP", t["0:0"] / 1000, "Taiwan exports", "USD bn", "A081201010")))(sdmx("A081201010", "2..1.M"))),
        ("gdp", lambda: put("TW_GDP_YOY", sdmx("A018101010", "3..1.Q", quarterly=True)["0"], "Taiwan real GDP YoY", "%", "A018101010, quarterly", "Q")),
        ("orders", lambda: (lambda t: (put("TW_ORDERS_YOY", yoy(t["0:0"], True), "Taiwan export orders, YoY (3-month sum)", "%", "A050105010, USD, YoY calculated"),
                                       put("TW_ORDERS_US_YOY", yoy(t["0:1"], True), "Taiwan export orders from the US, YoY (3-month sum)", "%", "A050105010, USD, YoY calculated"),
                                       put("TW_ORDERS_CN_YOY", yoy(t["0:2"], True), "Taiwan export orders from China & HK, YoY (3-month sum)", "%", "A050105010, USD, YoY calculated"),
                                       put("TW_ORDERS", t["0:0"] / 1000, "Taiwan export orders", "USD bn", "A050105010")))(sdmx("A050105010", "2..1.M"))),
        ("money", lambda: (lambda t: (lambda m1b, m2: (put("TW_M1B_YOY", yoy(m1b), "Taiwan M1B growth YoY", "%", "A090501010, daily average, calculated"),
                                                       put("TW_M2_YOY", yoy(m2), "Taiwan M2 growth YoY", "%", "A090501010, daily average, calculated"),
                                                       put("TW_M1B_M2", (yoy(m1b) - yoy(m2)).dropna(), "Taiwan M1B minus M2 growth", "pts", "A090501010, calculated")))
                           (t["0:0"] + t["0:1"], t["0:0"] + t["0:1"] + t["0:5"]))(sdmx("A090501010", "1..1.M"))),
    ]
    for name, fn in jobs:
        try:
            fn()
        except Exception as e:   # each table on its own; keep what was published before
            errs[name] = type(e).__name__
    for k, v in old.items():
        if k not in out and not k.startswith("_"):
            out[k] = v
            status[k] = "stale (kept previous)"
    out["_meta"] = {"errors": errs}
    write("taiwan.json", out)
    print(f"  {len(out) - 1} series" + (f"; failed: {errs}" if errs else ""))


if __name__ == "__main__":
    build({})
