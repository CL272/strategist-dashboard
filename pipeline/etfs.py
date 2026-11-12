"""
Country ETF yields and money flows (WP50), from the public iShares fund pages: NAV, 12-month trailing yield, net
assets and shares outstanding for eight country and regional funds. Shares outstanding x NAV, archived daily, shows
money moving in or out (creations and redemptions): a partial stand-in for foreign-flow data, which Bursa Malaysia
blocks for automated access. Isolated: a failure keeps the previous file.
Writes docs/data/etfs.json; archive/etf_country.csv grows by one row per fund per run day.
"""
from __future__ import annotations

import re
import time
from datetime import date, datetime, timezone

import pandas as pd
import requests

from fetch import ARCHIVE_DIR, load_existing, pack, write

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36"}
FUNDS = [("EWM", 239669, "ishares-msci-malaysia-etf", "Malaysia"), ("EWS", 239678, "ishares-msci-singapore-etf", "Singapore"),
         ("MCHI", 239619, "ishares-msci-china-etf", "China"), ("EWY", 239681, "ishares-msci-south-korea-etf", "Korea"),
         ("EWT", 239686, "ishares-msci-taiwan-etf", "Taiwan"), ("INDA", 239659, "ishares-msci-india-etf", "India"),
         ("EWJ", 239665, "ishares-msci-japan-etf", "Japan"), ("EEM", 239637, "ishares-msci-emerging-markets-etf", "Emerging markets")]
VAL = re.compile(r'"name":"([^"]{3,40})","value":"([^"]{1,30})"(?:,"unitText":"[^"]*")?,"valueReference":\{"@type":"PropertyValue","name":"As of Dates","value":"([^"]+)"')
SHARES = re.compile(r"Shares Outstanding[^0-9]{0,400}?([0-9][0-9,]{5,})")
num = lambda s: float(re.sub(r"[^0-9.\-]", "", s)) if s and re.search(r"[0-9]", s) else None


def fund(ticker: str, pid: int, slug: str) -> dict | None:
    try:
        r = requests.get(f"https://www.ishares.com/us/products/{pid}/{slug}", headers=UA, timeout=60)
        if r.status_code != 200 or ticker not in r.text[:200000]:
            return None
        v = {m.group(1): (m.group(2), m.group(3)) for m in VAL.finditer(r.text)}
        so = SHARES.search(r.text)
        out = {"nav": num((v.get("NAV as of") or ("", ""))[0]), "yield": num((v.get("12m Trailing Yield as of") or ("", ""))[0]),
               "assets": num((v.get("Net Assets of Fund") or ("", ""))[0]), "shares": num(so.group(1)) if so else None,
               "nav_date": (v.get("NAV as of") or ("", ""))[1], "yield_date": (v.get("12m Trailing Yield as of") or ("", ""))[1]}
        return out if out["nav"] and out["assets"] else None
    except Exception:
        return None


def build(status: dict) -> None:
    print("Country ETFs (iShares)")
    old = load_existing("etfs.json")
    try:
        rows = {}
        for t, pid, slug, name in FUNDS:
            x = fund(t, pid, slug)
            if x:
                rows[t] = {**x, "name": name}
            time.sleep(0.5)
        print(f"  funds: {len(rows)} of {len(FUNDS)}")
        if len(rows) < 4:
            raise RuntimeError("too few funds")
        ARCHIVE_DIR.mkdir(exist_ok=True)
        ap = ARCHIVE_DIR / "etf_country.csv"
        arc = pd.read_csv(ap) if ap.exists() else pd.DataFrame(columns=["date", "ticker", "nav", "shares", "assets", "yield"])
        # date each row by the fund's own NAV date, so weekends and repeat runs do not double-count
        new = []
        for t, x in rows.items():
            try:
                d = datetime.strptime(x["nav_date"], "%b %d, %Y").date().isoformat()
            except Exception:
                d = date.today().isoformat()
            new.append({"date": d, "ticker": t, "nav": x["nav"], "shares": x["shares"], "assets": x["assets"], "yield": x["yield"]})
        nd = pd.DataFrame(new)
        arc = pd.concat([arc.merge(nd[["date", "ticker"]], on=["date", "ticker"], how="left", indicator=True).query('_merge == "left_only"').drop(columns="_merge"), nd])
        arc = arc.sort_values(["ticker", "date"])
        arc.to_csv(ap, index=False)
        out = {"_meta": {"fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "since": str(arc["date"].min())}, "funds": rows}
        for t in rows:
            a = arc[arc["ticker"] == t].copy()
            a["date"] = pd.to_datetime(a["date"])
            a = a.set_index("date")
            if a["shares"].notna().sum():
                out[f"ETF_SH_{t}"] = {"label": f"{t} shares outstanding", "group": "Flows", "kind": "level", "unit": "shares", "source": "iShares (fund page)", **pack(a["shares"].astype(float))}
                out[f"ETF_NAV_{t}"] = {"label": f"{t} NAV", "group": "Flows", "kind": "price", "unit": "USD", "source": "iShares (fund page)", **pack(a["nav"].astype(float))}
                status[f"ETF_SH_{t}"] = "ok"
        write("etfs.json", out)
    except Exception as e:
        print(f"  failed ({type(e).__name__}: {e}); kept previous")
        write("etfs.json", old or {"_meta": {"error": type(e).__name__}, "funds": {}})


if __name__ == "__main__":
    build({})
