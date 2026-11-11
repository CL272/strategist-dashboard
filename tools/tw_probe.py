"""One-off probe (WP29): geopolitical risk index and ICI fund flows from GitHub's runner. Prints status only."""
import re

import requests

UA = {"User-Agent": "Mozilla/5.0 (compatible; dashboard data refresh)"}
for u in ["https://www.matteoiacoviello.com/gpr_files/data_gpr_daily_recent.xls", "https://www.matteoiacoviello.com/gpr_files/data_gpr_export.xls",
          "https://www.matteoiacoviello.com/gpr.htm", "https://www.ici.org/research/stats/flows", "https://www.ici.org/research/stats/combined_flows"]:
    try:
        r = requests.get(u, headers=UA, timeout=40)
        ct = r.headers.get("content-type", "")
        print(f"PROBE {r.status_code} {len(r.content):>9} {ct[:40]:<40} {u} :: {' '.join(r.text[:120].split()) if 'text' in ct else ''}")
        if "ici.org" in u and r.ok:
            print("PROBE ICI links", sorted(set(re.findall(r'href="([^"]*(?:xls|xlsx|csv)[^"]*)"', r.text)))[:10])
    except Exception as e:
        print(f"PROBE ERR {type(e).__name__} {u}")
