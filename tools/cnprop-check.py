"""Checks China property data (pipeline/cnprop.py -> docs/data/cnprop.json, archive/cn_*.csv) against the bureau's own
published figures. Run: python3 tools/cnprop-check.py   (after a run of the module, or on the published file)

Tier figures: the bureau publishes its tier averages, rounded to 0.1, in the commentary under each 70-city release
(www.stats.gov.cn/sj/sjjd/). It averages the cities' unrounded indices; ours averages the indices as published (rounded
to 0.1), so the two can differ by up to 0.05 (their rounding) + 0.05 (ours): 0.10 allowed. Example: December 2024, tier-1
new homes on the month: Shanghai +0.5, Shenzhen +0.2, Beijing -0.1, Guangzhou -0.1 average +0.125; the bureau says +0.2."""
import csv, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
fails = []
def ok(cond, msg):
    print(f"  {'ok  ' if cond else 'FAIL'} {msg}")
    if not cond:
        fails.append(msg)

D = json.loads((ROOT / "docs/data/cnprop.json").read_text())
def last_at(sid, month):
    s = D.get(sid)
    if not s:
        return None
    import datetime as dt
    d = (dt.date.fromisoformat(month + "-01") - dt.date(1970, 1, 1)).days
    return s["v"][s["d"].index(d)] if d in s["d"] else None

# the bureau's commentary: (new m/m, second-hand m/m, new y/y, second-hand y/y) for tiers 1, 2, 3; and cities rising (new, second-hand)
PUBLISHED = {
    "2022-04": {"new_mom": (0.2, -0.1, -0.6), "old_mom": (0.4, -0.3, -0.3), "new_yoy": (3.9, 1.0, -1.5), "old_yoy": (2.4, -1.0, -2.5)},
    "2024-12": {"new_mom": (0.2, 0.0, -0.2), "old_mom": (0.3, -0.3, -0.4), "new_yoy": (-3.8, -5.4, -6.2), "old_yoy": (-6.7, -7.9, -8.4), "up": (23, 9)},
    "2026-10": {"new_mom": (0.0, -0.1, -0.2), "old_mom": (0.2, -0.3, -0.3), "new_yoy": (-0.1, -2.0, -3.6), "old_yoy": (-0.4, -4.1, -5.0), "up": (14, 7)},
}
print("China property: tier averages against the bureau's published figures")
for month, P in PUBLISHED.items():
    worst, same, n = 0.0, 0, 0
    for key, vals in P.items():
        if key == "up":
            got = (last_at("CNP_NEW_UP", month), last_at("CNP_OLD_UP", month))
            ok(got == vals, f"{month}: cities with a price rise on the month, new and second-hand {got} = published {vals}")
            continue
        kind, what = key.split("_")
        for t, pub in zip((1, 2, 3), vals):
            v = last_at(f"CNP_{kind.upper()}_T{t}_{what.upper()}", month)
            worst = max(worst, abs(v - pub) if v is not None else 99)
            n += 1; same += v is not None and abs(round(v + 1e-9, 1) - pub) < 1e-9
    ok(worst <= 0.10 + 1e-9, f"{month}: all 12 tier figures within 0.10 point of the bureau's; {same} of {n} round to the same figure (largest gap {worst:.3f})")

print("China property: completeness")
cities = list(csv.DictReader((ROOT / "archive/cn_cities.csv").open(encoding="utf-8")))
by = {}
for r in cities:
    by.setdefault(r["month"], set()).add(r["city"])
months = sorted(by)
ok(all(len(v) == 70 for v in by.values()), f"70 cities in every month ({len(months)} months, {months[0]} to {months[-1]})")
import datetime as dt
def month_range(a, b):
    y, m = int(a[:4]), int(a[5:]); out = []
    while f"{y}-{m:02d}" <= b:
        out.append(f"{y}-{m:02d}"); m += 1
        if m == 13: y, m = y + 1, 1
    return out
miss = [m for m in month_range(months[0], months[-1]) if m not in by]
ok(not miss, f"no month missing between the first and the latest price release ({', '.join(miss) or 'none'})")
re_m = sorted(D["_meta"]["read"]["realestate"])
miss_r = [m for m in month_range(re_m[0], re_m[-1]) if m not in re_m and not m.endswith("-01")]
ok(not miss_r, f"real estate: every month from {re_m[0]} to {re_m[-1]} except January (published with February) ({', '.join(miss_r) or 'none'} missing)")
ok(not D["_meta"]["failed"], f"no release failed to parse ({len(D['_meta']['failed'])})")

print("China property: sales and building against the release text")
TEXT = {("2026-10", "CNR_INV_G"): -21.6, ("2026-10", "CNR_STARTS_G"): -24.4, ("2026-10", "CNR_DONE_G"): -26.6, ("2026-10", "CNR_SOLD_G"): -13.7,
        ("2026-10", "CNR_VAL_G"): -14.3, ("2026-10", "CNR_RESALE_G"): 11.4, ("2026-10", "CNR_SOLD"): 613.58, ("2026-10", "CNR_VAL"): 5855.0,
        ("2026-10", "CNR_UNSOLD"): 744.12, ("2021-11", "CNR_INV"): 13731.4, ("2021-12", "CNR_INV_G"): 4.4}
for (m, sid), want in TEXT.items():
    got = last_at(sid, m)
    ok(got is not None and abs(got - want) < 1e-6, f"{m} {sid} = {got} (release: {want})")
# a year's single months add up to its December total; a 12-month total in December is the year's total
for y in ("2023", "2024", "2025"):
    m = [last_at("CNR_SOLD_M", f"{y}-{k:02d}") for k in range(2, 13)]
    dec = last_at("CNR_SOLD", f"{y}-12")
    ok(None not in m and abs(sum(m) - dec) < 1e-6, f"{y}: single months of floor space sold add up to December's year-to-date figure ({dec})")
ok(abs(last_at("CNR_SOLD_12M", "2025-12") - last_at("CNR_SOLD", "2025-12")) < 1e-9, "the 12-month total in December equals the year's total")
p = last_at("CNR_AVGP_R_12M", "2026-10")
ok(p is not None and 5000 < p < 15000, f"average residential price, last 12 months, in a sensible range ({p} CNY per sq m)")

size = (ROOT / "docs/data/cnprop.json").stat().st_size
ok(size < 300_000, f"cnprop.json under 300 KB ({size / 1000:.0f} KB)")
tbl = D.get("_cities") or {}
ok(tbl.get("month") == months[-1] and len(tbl.get("rows", [])) == 70, f"the latest month's 70-city table is in the file ({tbl.get('month')})")

if fails:
    print(f"\nChina property check: {len(fails)} failure(s).")
    sys.exit(1)
print("\nChina property check passed.")
