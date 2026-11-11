"""One-off probe (WP20): CBC key-indicator columns, and where TSMC's monthly revenue page gets its numbers."""
import json
import re

import requests

UA = {"User-Agent": "Mozilla/5.0 (compatible; dashboard data refresh)"}


def walk(o, depth=0, path=""):
    if depth > 3:
        return
    if isinstance(o, dict):
        for k, v in list(o.items())[:12]:
            print(f"PROBE KEY {path}/{k} :: {json.dumps(v)[:180] if not isinstance(v, (dict, list)) else type(v).__name__ + str(len(v))}")
            walk(v, depth + 1, f"{path}/{k}")
    elif isinstance(o, list) and o:
        walk(o[0], depth + 1, f"{path}[0]")


for name in ("EF01M01en", "EF03M01en", "EF05M01en", "EF07M01en"):
    try:
        j = requests.get(f"https://cpx.cbc.gov.tw/API/DataAPI/Get?FileName={name}", headers=UA, timeout=30).json()
        print(f"PROBE ==== {name}")
        walk(j)
        txt = json.dumps(j, ensure_ascii=False)
        for kw in ("Rediscount", "Discount", "Overnight", "Interbank", "Government Bond", "10-Year", "Yield", "Rate"):
            for m in list(re.finditer(kw, txt))[:2]:
                print(f"PROBE HIT {name} {kw} :: {txt[max(0, m.start() - 60):m.start() + 120]}")
    except Exception as e:
        print(f"PROBE {name} ERR {type(e).__name__}")
try:
    t = requests.get("https://investor.tsmc.com/english/monthly-revenue/2026", headers=UA, timeout=40).text
    for kw in ("revenue", "Revenue", "api", "json", "xlsx", "csv", "drupal-settings"):
        hits = [t[max(0, m.start() - 80):m.start() + 120].replace("\n", " ") for m in list(re.finditer(kw, t))[:3]]
        for h in hits:
            print(f"PROBE TSMC {kw} :: {' '.join(h.split())}")
except Exception as e:
    print("PROBE TSMC ERR", type(e).__name__)
