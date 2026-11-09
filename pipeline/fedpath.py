"""
Fed path vs market pricing.

Market: CBOT 30-day fed funds futures (Yahoo Finance, ZQ<month><yy>.CBT). Each contract settles on the
average effective fed funds rate (EFFR) of its month, so 100 - price = the market's expected average
EFFR for that month. From the monthly averages and the FOMC calendar, the rate expected after each
meeting is backed out the way CME FedWatch does it:

    month with a meeting effective on day e of N days:   avg = (e-1)/N * r_before + (N-e+1)/N * r_after
    if the next month has no meeting, r_after = that month's average (more robust when e is late in the month)

Fed: the Summary of Economic Projections median ("dots"), range and central tendency, and the
longer-run median, from FRED (FEDTARMD, FEDTARRH/RL, FEDTARCTH/CTL, FEDTARMDLR).

Writes docs/data/fedpath.json.
"""
from __future__ import annotations

import calendar as _cal
import datetime as dt
import time

import pandas as pd

from fetch import DIAG, fetch_fred, fetch_yahoo, load_existing, write

CODES = "FGHJKMNQUVXZ"
MONTHS_AHEAD = 26
SNAPSHOTS = {"now": 0, "1M ago": 30, "3M ago": 91}
DOTS = {"median": "FEDTARMD", "range_hi": "FEDTARRH", "range_lo": "FEDTARRL", "ct_hi": "FEDTARCTH", "ct_lo": "FEDTARCTL"}
LONG_RUN = "FEDTARMDLR"


def month_key(d) -> str:
    return f"{d.year}-{d.month:02d}"


def add_months(y, m, k):
    m0 = m - 1 + k
    return y + m0 // 12, m0 % 12 + 1


def fomc_dates() -> list[dt.date]:
    from econcal import MEETINGS
    return sorted(dt.date.fromisoformat(d) for region, _, d, *_ in MEETINGS if region == "US")


def sep_meetings() -> list[dt.date]:
    from econcal import MEETINGS
    return sorted(dt.date.fromisoformat(d) for region, _, d, _, detail, *_ in MEETINGS if region == "US" and "Projections" in detail)


def path_at(asof: dt.date, avg: dict[str, float], spot: float, meetings: list[dt.date]) -> list[dict]:
    """Expected rate after each FOMC meeting, as priced on `asof`. avg: 'YYYY-MM' -> expected average EFFR."""
    by_month = {}
    for d in meetings:
        eff = d + dt.timedelta(days=1)            # a decision takes effect the next day
        if d >= asof:
            by_month.setdefault(month_key(eff), []).append((d, eff))
    out, r = [], spot
    # start at the first contract still listed (expired months drop off Yahoo, so older snapshots start later)
    first = min((k for k in avg if k >= month_key(asof)), default=None)
    if first is None:
        return []
    y, m = int(first[:4]), int(first[5:])
    for _ in range(MONTHS_AHEAD):
        k = f"{y}-{m:02d}"
        if k not in avg:
            break
        ny, nm = add_months(y, m, 1)
        nk = f"{ny}-{nm:02d}"
        if k in by_month:
            d, eff = by_month[k][0]
            n, e = _cal.monthrange(y, m)[1], eff.day
            if nk not in by_month and nk in avg:
                after = avg[nk]
            else:
                after = (avg[k] * n - r * (e - 1)) / (n - e + 1)
            out.append(dict(d=d.isoformat(), before=r, after=after, chg=after - r))
            r = after
        else:
            r = avg[k]                            # no meeting: the month's average is the level
        y, m = ny, nm
    for row in out:
        row["cum"] = row["after"] - spot
    return out


def move_odds(chg_bp: float) -> str:
    """Simplified FedWatch reading of one meeting's priced change."""
    n = chg_bp / 25
    word = "cut" if n < 0 else "hike"
    a = abs(n)
    if a < 0.05:
        return "hold ~100%"
    if a <= 1:
        return f"{a * 100:.0f}% {word} 25bp"
    if a <= 2:
        return f"{(a - 1) * 100:.0f}% {word} 50bp, rest 25bp"
    return f"{a:.1f} x 25bp {word}s priced"


def build(fred_key: str | None, fred_series: dict[str, pd.Series], status: dict) -> None:
    print("Fed path vs market pricing")
    today = dt.date.today()
    old = load_existing("fedpath.json")

    # ---- futures: one series of implied rates per contract month
    contracts = {}
    y, m = today.year, today.month
    n_diag = len(DIAG)
    for _ in range(MONTHS_AHEAD):
        sym = f"ZQ{CODES[m - 1]}{y % 100:02d}.CBT"
        s = fetch_yahoo(sym, (today - dt.timedelta(days=400)).isoformat())
        if s is not None and len(s) > 5:
            contracts[f"{y}-{m:02d}"] = (sym, (100 - s).round(4))
        elif len(contracts) >= 12:
            break                                 # past the last listed contract
        time.sleep(0.2)
        y, m = add_months(y, m, 1)
    del DIAG[n_diag:]                             # a contract that is not listed yet is not a data error
    print(f"  fed funds futures: {len(contracts)} contracts")
    if len(contracts) < 6:
        if old:
            print("  too few contracts: keeping the previous file")
            status["FEDPATH"] = "stale (kept previous)"
            DIAG.append("fedpath: fed funds futures unavailable, previous pricing kept")
            return
        status["FEDPATH"] = "missing"
        return

    effr = fred_series.get("EFFR")
    if effr is None and fred_key:
        effr = fetch_fred("EFFR", fred_key, "2024-01-01")
    upper = fetch_fred("DFEDTARU", fred_key, "2024-01-01") if fred_key else None
    lower = fetch_fred("DFEDTARL", fred_key, "2024-01-01") if fred_key else None

    def asof(s, d):
        if s is None or not len(s):
            return None
        s = s[s.index <= pd.Timestamp(d)]
        return float(s.iloc[-1]) if len(s) else None

    meetings = fomc_dates()
    snaps = {}
    for name, back in SNAPSHOTS.items():
        d = today - dt.timedelta(days=back)
        avg = {k: asof(s, d) for k, (_, s) in contracts.items()}
        avg = {k: v for k, v in avg.items() if v is not None and k >= month_key(d)}
        spot = asof(effr, d)
        if spot is None or not avg:
            continue
        snaps[name] = dict(asof=d.isoformat(), effr=spot, path=path_at(d, avg, spot, meetings))

    # ---- Fed projections
    dots = {}
    for k, code in DOTS.items():
        s = fetch_fred(code, fred_key, "2015-01-01")
        if s is not None and len(s):
            dots[k] = {str(t.year): round(float(v), 3) for t, v in s.items() if t.year >= today.year}
        time.sleep(0.1)
    lr = fetch_fred(LONG_RUN, fred_key, "2015-01-01")
    if lr is not None and len(lr):
        dots["longer_run"] = round(float(lr.iloc[-1]), 3)
    seps = [d for d in sep_meetings() if d <= today]
    if not dots and old.get("dots"):
        dots = old["dots"]
    from econcal import to_sgt
    for name, snap in snaps.items():
        for row in snap["path"]:
            row["odds"] = move_odds(row["chg"] * 100)
            sg, nxt = to_sgt(dt.date.fromisoformat(row["d"]), ("ET", "14:00"))
            row["sgt"] = sg + (" (+1 day)" if nxt > 0 else "")

    out = dict(
        generated=dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        target=[asof(lower, today), asof(upper, today)],
        effr=asof(effr, today), effr_date=(effr.index[-1].date().isoformat() if effr is not None and len(effr) else None),
        sep_date=(seps[-1].isoformat() if seps else None),
        dots=dots, snapshots=snaps,
        contracts={k: dict(sym=sym, d=[t.strftime("%Y-%m-%d") for t in s.index], v=[round(float(x), 4) for x in s.values]) for k, (sym, s) in contracts.items()},
        meetings=[d.isoformat() for d in meetings], sep_meetings=[d.isoformat() for d in sep_meetings()],
    )
    write("fedpath.json", out)
    status["FEDPATH"] = "ok"
    n = snaps.get("now", {}).get("path", [])
    print(f"  path: {len(n)} meetings priced" + (f", next {n[0]['d']}: {n[0]['chg'] * 100:+.1f}bp" if n else ""))
