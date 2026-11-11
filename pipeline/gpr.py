"""
Geopolitical Risk index (Caldara and Iacoviello), daily, from matteoiacoviello.com (data_gpr_daily_recent.xls).
The index counts newspaper articles about geopolitical tensions; 100 = the 1985-2019 average.
Reachable from GitHub's runner (not from the build environment). Isolated: a failure keeps the previous file.
Writes docs/data/gpr.json.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone

import pandas as pd
import requests

from fetch import load_existing, pack, write

URL = "https://www.matteoiacoviello.com/gpr_files/data_gpr_daily_recent.xls"
UA = {"User-Agent": "Mozilla/5.0 (compatible; dashboard data refresh)"}


def build(status: dict) -> None:
    print("Geopolitical risk index")
    old = load_existing("gpr.json")
    try:
        r = requests.get(URL, headers=UA, timeout=90)
        r.raise_for_status()
        df = pd.read_excel(io.BytesIO(r.content))
        cols = {c.lower(): c for c in df.columns}
        print(f"  columns: {list(df.columns)[:12]}")
        dcol = next((cols[k] for k in ("date", "day", "time") if k in cols), None)
        if dcol is None:
            raise RuntimeError("no date column")
        t = pd.to_datetime(df[dcol].astype(str), errors="coerce")
        out = {}
        for want, sid, lab in (("gprd", "GPR_DAILY", "Geopolitical risk index (daily)"), ("gprd_ma30", "GPR_MA30", "Geopolitical risk index, 30-day average"),
                               ("gprd_act", "GPR_ACTS", "Geopolitical risk: acts"), ("gprd_threat", "GPR_THREATS", "Geopolitical risk: threats")):
            if want in cols:
                s = pd.Series(pd.to_numeric(df[cols[want]], errors="coerce").values, index=t).dropna()
                s = s[s.index.notna()].sort_index()
                s = s[s.index >= "2005-01-01"]
                if len(s):
                    out[sid] = {"label": lab, "group": "Uncertainty", "kind": "level", "unit": "idx",
                                "source": "Caldara & Iacoviello, Geopolitical Risk index (matteoiacoviello.com)", **pack(s)}
                    status[sid] = "ok"
        if not out:
            raise RuntimeError("no GPR columns")
        out["_meta"] = {"fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
        write("gpr.json", out)
        print(f"  {len(out) - 1} series")
    except Exception as e:
        print(f"  failed ({type(e).__name__}: {e}); kept previous")
        write("gpr.json", old or {"_meta": {"error": type(e).__name__}})   # always publish a file, so the page never 404s
        for k in old:
            if not k.startswith("_"):
                status[k] = "stale (kept previous)"


if __name__ == "__main__":
    build({})
