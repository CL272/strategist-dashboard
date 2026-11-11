"""One-off probe (WP20): can GitHub's runner reach Taiwan sources that the build environment cannot? Prints status only."""
import requests

URLS = [
    "https://index.ndc.gov.tw/n/en",
    "https://index.ndc.gov.tw/n/zh_tw/data/eco",
    "https://index.ndc.gov.tw/n/json/data/eco/indicators",
    "https://www.cbc.gov.tw/en/mp-2.html",
    "https://cpx.cbc.gov.tw/API/DataAPI/Get?FileName=EF15M01en",
    "https://investor.tsmc.com/english/monthly-revenue",
    "https://investor.tsmc.com/english/monthly-revenue/2026",
    "https://dmz26.moea.gov.tw/GMWeb/investigate/InvestigateDA.aspx?lang=E",
]
UA = {"User-Agent": "Mozilla/5.0 (compatible; dashboard data refresh)"}
for u in URLS:
    try:
        r = requests.get(u, headers=UA, timeout=40)
        head = " ".join(r.text[:160].split())
        print(f"PROBE {r.status_code} {len(r.content):>8} {r.headers.get('content-type', '')[:30]:<30} {u} :: {head}")
    except Exception as e:
        print(f"PROBE ERR {type(e).__name__} {u}")
