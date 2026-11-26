# Temporary planning probe (Design plan 5): can GitHub's servers reach the candidate data sources? Prints one line per source.
import re, time, urllib.request, urllib.error

UA = {"User-Agent": "strategist-dashboard-data/1.0"}
def get(url, data=None, tries=3):
    last = ""
    for k in range(tries):
        t0 = time.time()
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, data=data, headers=UA), timeout=60)
            b = r.read()
            return r.status, b, time.time() - t0, ""
        except urllib.error.HTTPError as e:
            return e.code, e.read()[:400], time.time() - t0, ""
        except Exception as e:   # reset, timeout, DNS
            last = f"{type(e).__name__}: {str(e)[:120]}"
            time.sleep(6)
    return 0, b"", 0.0, last

def show(name, url, data=None):
    code, b, dt, err = get(url, data)
    txt = b[:4000].decode("utf-8", "replace")
    print(f"{name:34s} {code} {len(b):>8d}b {dt:5.1f}s tables={len(re.findall(rb'<table', b))} {err} | {re.sub(chr(92)+'s+', ' ', re.sub('<[^>]+>', ' ', txt))[:90]}")
    return code, b

show("NBS english release list", "https://www.stats.gov.cn/english/PressRelease/")
show("NBS 70 cities (Oct 2026, EN)", "https://www.stats.gov.cn/english/PressRelease/202611/t20261116_1965848.html")
show("NBS real estate (Jan-Oct, EN)", "https://www.stats.gov.cn/english/PressRelease/202611/t20261117_1965879.html")
show("NBS chinese release list", "https://www.stats.gov.cn/sj/zxfb/")
show("NBS english list, page 2", "https://www.stats.gov.cn/english/PressRelease/index_1.html")
show("NBS data API (easyquery)", "https://data.stats.gov.cn/english/easyquery.htm", b"id=zb&dbcode=hgyd&wdcode=zb&m=getTree")
show("UMich sentiment csv", "https://www.sca.isr.umich.edu/files/tbmics.csv")
code, b = show("UMich tables page", "https://data.sca.isr.umich.edu/tables.php")
m = re.findall(rb'href="(get-table\.php\?c=RB[^"]*n=5b&(?:amp;)?f=xls[^"]*)"', b)
if m:
    show("UMich table 5b by party (xls)", "https://data.sca.isr.umich.edu/" + m[0].decode().replace("&amp;", "&"))
else:
    print("UMich table 5b link not found on the tables page")
show("UMich reports page", "https://data.sca.isr.umich.edu/reports.php")
show("FRED graph csv (CARTS)", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=CARTS")
