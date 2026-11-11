"""
Oil futures curve: Brent and WTI front month against the contract 12 months further out (Yahoo Finance contract
symbols such as BZF27.NYM, CLF27.NYM). Front − 12M above zero = backwardation (prompt barrels dearer than later
ones: a tight market); below zero = contango (ample supply).

The front contract is found by matching the continuous future (BZ=F, CL=F) against the next few dated contracts.
History: the current pair's daily closes (about 2 years), merged into archive/ so that, as contracts roll, the archive
keeps a constant-maturity record from now on. Writes docs/data/oilcurve.json. Isolated: a failure keeps the previous file.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
import requests

from fetch import load_existing, merge_archive, pack, unpack, write

URL = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=2y&interval=1d"
UA = {"User-Agent": "Mozilla/5.0 (compatible; dashboard data refresh)"}
CODES = "FGHJKMNQUVXZ"
OILS = {"BRENT": ("BZ", "Brent"), "WTI": ("CL", "WTI")}


def closes(sym: str) -> pd.Series | None:
    try:
        r = requests.get(URL.format(sym=sym), headers=UA, timeout=40)
        res = r.json()["chart"]["result"][0]
        t = pd.to_datetime(res["timestamp"], unit="s").normalize()
        s = pd.Series(res["indicators"]["quote"][0]["close"], index=t, dtype="float64").dropna()
        return s[~s.index.duplicated(keep="last")] if len(s) else None
    except Exception:
        return None


def contract(root: str, y: int, m: int) -> str:
    return f"{root}{CODES[m - 1]}{str(y)[2:]}.NYM"


def build(status: dict) -> None:
    print("Oil futures curve")
    old = load_existing("oilcurve.json")
    out, errs, meta = {}, {}, {}
    today = pd.Timestamp.today()
    for key, (root, name) in OILS.items():
        try:
            cont = closes(f"{root}=F")
            if cont is None:
                raise RuntimeError("no continuous future")
            front = None
            for i in range(0, 5):
                ym = today + pd.DateOffset(months=i)
                sym = contract(root, ym.year, ym.month)
                s = closes(sym)
                if s is not None and abs(s.iloc[-1] / cont.iloc[-1] - 1) < 0.003:
                    front = (sym, ym.year, ym.month, s)
                    break
            if front is None:
                raise RuntimeError("front contract not matched")
            sym_f, y, m, sf = front
            far_y, far_m = (y + 1, m)
            sym_b = contract(root, far_y, far_m)
            sb = closes(sym_b)
            if sb is None:
                raise RuntimeError("12-month contract missing")
            j = pd.concat([sf, sb], axis=1, sort=True).dropna()
            spread = j.iloc[:, 0] - j.iloc[:, 1]
            pct = (j.iloc[:, 0] / j.iloc[:, 1] - 1) * 100
            for sid, s, lab, unit in [(f"OIL_{key}_SPREAD", spread, f"{name} front month minus 12 months later", "USD/bbl"),
                                      (f"OIL_{key}_SPREAD_PCT", pct, f"{name} front month vs 12 months later, %", "%"),
                                      (f"OIL_{key}_12M", sb, f"{name} 12-month-ahead contract", "USD/bbl")]:
                s = merge_archive(sid, s, unpack(old[sid]) if sid in old else None)
                out[sid] = {"label": lab, "group": "Commodities · Oil curve", "kind": "level" if "SPREAD" in sid else "price", "unit": unit,
                            "source": f"Yahoo Finance ({sym_f}, {sym_b})", **pack(s)}
                status[sid] = "ok"
            meta[key] = {"front": sym_f, "far": sym_b, "front_px": float(sf.iloc[-1]), "far_px": float(sb.iloc[-1])}
        except Exception as e:   # each oil on its own; keep what was published before
            errs[key] = f"{type(e).__name__}: {e}"
            for k, v in old.items():
                if k.startswith(f"OIL_{key}_"):
                    out[k] = v
                    status[k] = "stale (kept previous)"
    out["_meta"] = {"fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "contracts": meta, "errors": errs}
    write("oilcurve.json", out)
    print(f"  {len(out) - 1} series" + (f"; failed: {errs}" if errs else "") + f"; {meta}")


if __name__ == "__main__":
    build({})
