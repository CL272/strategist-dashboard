"""One-off probe (WP20): find the CBC interest-rate file and the layout of TSMC's monthly revenue table from GitHub's runner."""
import html
import json
import re

import requests

UA = {"User-Agent": "Mozilla/5.0 (compatible; dashboard data refresh)"}
for pre in ("EF", "EG", "BP"):
    for n in range(1, 31):
        name = f"{pre}{n:02d}M01en"
        try:
            r = requests.get(f"https://cpx.cbc.gov.tw/API/DataAPI/Get?FileName={name}", headers=UA, timeout=30)
            if r.ok and r.text.startswith("{"):
                j = json.loads(r.text)
                t = (j.get("meta") or {}).get("title", "")
                print(f"PROBE CBC {name} :: {t[:110]}")
        except Exception as e:
            print(f"PROBE CBC {name} ERR {type(e).__name__}")
try:
    r = requests.get("https://cpx.cbc.gov.tw/API/DataAPI/Get?FileName=EF15M01en", headers=UA, timeout=30)
    print("PROBE CBCJSON", json.dumps(r.json())[:1500])
except Exception as e:
    print("PROBE CBCJSON ERR", type(e).__name__)
try:
    t = requests.get("https://investor.tsmc.com/english/monthly-revenue/2026", headers=UA, timeout=40).text
    rows = [[" ".join(html.unescape(re.sub(r"<[^>]+>", " ", c)).split()) for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, re.S)]
            for row in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S)]
    for row in rows[:20]:
        print("PROBE TSMC", row)
    print("PROBE TSMC links", sorted(set(re.findall(r'href="([^"]*(?:xls|csv|json|monthly-revenue)[^"]*)"', t)))[:20])
except Exception as e:
    print("PROBE TSMC ERR", type(e).__name__)
