"""
Data health: flag series that have stopped updating (silently discontinued or broken sources).

For every series in the published files, infer its normal frequency from recent gaps and compare the age of
the last observation with what that frequency allows. Writes docs/data/health.json; the workflow opens or
closes a GitHub issue "Data health alert" from it, so you get an email when something goes stale.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

import pandas as pd

from fetch import EPOCH, OUT, write

FILES = ["yahoo.json", "fred.json", "derived.json", "asia.json", "cbwatch.json", "korea.json", "ramp.json", "gpu.json", "taiwan.json", "oilcurve.json", "gpr.json"]
# (max median gap in days, allowed age in days, label)
FREQ = [(4, 10, "daily"), (10, 21, "weekly"), (40, 130, "monthly"), (100, 260, "quarterly"), (10_000, 500, "annual")]
# slow publishers: allowed age in days (data dated at period start + long publication lags)
SLOW = {"JP_RETAIL_YOY": 220, "CN_CCI": 160, "MY_GDP_YOY": 280, "SH_PE": 200, "SH_DY": 200}  # Shiller earnings/dividends lag ~3 months
# BNM monthly statistics reach data.gov.my about 4 months late; BIS effective exchange rates reach FRED about 3-4 months late
SLOW.update({k: 200 for k in ("MY_ALR", "MY_BR", "MY_FD12", "MY_M2", "MY_M3", "MY_M2_YOY", "MY_M3_YOY")})
SLOW.update({f"REER_{c}": 190 for c in ("USD", "EUR", "JPY", "CNY", "GBP", "SGD", "MYR", "KRW", "INR", "AUD", "IDR")})
SLOW["ID_IP_YOY"] = 200
SLOW["MMF_RETAIL"] = 50
# UN Comtrade publishes Korea's monthly trade about 10 months late; Ramp's token table is weekly but posted with a lag
SLOW.update({"KR_CHIP_EXP": 420, "KR_MEM_EXP": 420})   # weekly, but the Fed publishes it about a month late (H.6)
# series that are expected to be old or irregular: reports, monthly-lagged reference data
IGNORE_PREFIX = ("LEIC_", "REG_Q_", "RZG_", "RZI_")
IGNORE = {"USREC", "SH_FWD10"}     # recession flag only changes at NBER announcements; forward returns end 10 years back


def allowed_for(sid: str, default: int) -> int:
    if sid.startswith("RAMP_TOK_"):
        return 45
    return SLOW.get(sid, default)


def classify(days: list[int]) -> tuple[str, int]:
    gaps = pd.Series(days).diff().dropna().tail(24)
    med = float(gaps.median()) if len(gaps) else 9999
    for mx, allowed, lab in FREQ:
        if med <= mx:
            return lab, allowed
    return "annual", 450


def build_health(status: dict) -> dict:
    today = datetime.now(timezone.utc).date()
    rows = []
    for fname in FILES:
        p = OUT / fname
        if not p.exists():
            continue
        for sid, s in json.loads(p.read_text()).items():
            if not s.get("d") or sid in IGNORE or sid.startswith(IGNORE_PREFIX):
                continue
            last = (EPOCH + pd.Timedelta(days=s["d"][-1])).date()
            freq, allowed = classify(s["d"])
            allowed = allowed_for(sid, allowed)
            age = (today - last).days
            st = status.get(sid, "ok")
            state = "stale" if age > allowed else ("kept previous" if st.startswith("stale") else ("missing" if st == "missing" else "ok"))
            rows.append({"id": sid, "label": s.get("label", sid), "source": s.get("source", ""), "file": fname, "freq": freq,
                         "last": last.isoformat(), "age_days": age, "allowed_days": allowed, "state": state})
    # sources that are not time series
    for k, v in status.items():
        if v == "missing" and not any(r["id"] == k for r in rows):
            rows.append({"id": k, "label": k, "source": "", "file": "", "freq": "", "last": "", "age_days": None, "allowed_days": None, "state": "missing"})
    news = OUT / "news.json"
    if news.exists():
        try:
            u = datetime.strptime(json.loads(news.read_text())["updated_utc"], "%Y-%m-%d %H:%M UTC").replace(tzinfo=timezone.utc)
            hrs = (datetime.now(timezone.utc) - u).total_seconds() / 3600
            rows.append({"id": "NEWS", "label": "News headlines", "source": "Public RSS feeds", "file": "news.json", "freq": "30 min",
                         "last": u.strftime("%Y-%m-%d %H:%M"), "age_days": round(hrs / 24, 2), "allowed_days": 0.25,
                         "state": "stale" if hrs > 6 else "ok"})
        except Exception:
            pass
    rows.sort(key=lambda r: ({"stale": 0, "missing": 1, "kept previous": 2, "ok": 3}[r["state"]], r["id"]))
    bad = [r for r in rows if r["state"] in ("stale", "missing")]
    out = {"checked_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "n": len(rows), "n_bad": len(bad), "rows": rows}
    write("health.json", out)
    print(f"Data health: {len(rows)} series checked, {len(bad)} stale or missing")
    for r in bad[:20]:
        print(f"  {r['state'].upper():8} {r['id']:<16} last {r['last']}  ({r['freq']}, allowed {r['allowed_days']} days)")
    return out


if __name__ == "__main__":
    build_health({})
