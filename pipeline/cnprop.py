"""
China property (Design plan 5, Step 1; owner's approval 26 Nov 2026): home prices by city tier and the national sales and
building figures, from the National Bureau of Statistics' two monthly press releases.

The bureau's database (data.stats.gov.cn) refuses cloud servers, GitHub's included; its press releases do not. Two a month:
  - "YYYY年M月份70个大中城市商品住宅销售价格变动情况" (about the 16th): two HTML tables of 70 cities, new and second-hand homes,
    each with the price index on the month (last month = 100) and on the year (same month last year = 100);
  - "YYYY年1—M月份全国房地产市场基本情况" (about the 17th; titled "…开发投资增长/下降…" before 2023, "YYYY年上半年…" in June and
    "YYYY年全国…" in December): one table, year to date, with growth on a year as published: investment, floor space
    under construction, started and completed, new homes sold (floor space and value), second-hand transactions (from
    2025), unsold floor space and developers' funding, each with its residential part. January is never published alone:
    January and February are one reading, dated February.
Both are listed on www.stats.gov.cn/sj/zxfb/ (about five years back). The raw figures, as published, are kept in
archive/cn_cities.csv and archive/cn_realestate.csv (committed by the daily job), because older releases drop off the
list; archive/cn_releases.csv records every release found and whether it was read. Each full run reads the first two
list pages and any release not yet read, within a time budget; the very first run walks the whole list.

Tier averages are simple averages of the city indices over the bureau's own lists (TIERS), as the bureau computes them.
Growth rates are on the bureau's "comparable basis" (last year's base restated), so they are stored as published and
never recomputed from the levels.

Writes docs/data/cnprop.json = {"_meta": {...}, "_cities": {"month", "rows"}, "CNP_…": series, "CNR_…": series}.
Isolated: a run that cannot reach the site rebuilds the same file from the archive.
"""
from __future__ import annotations

import csv
import html as H
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import requests

from fetch import ARCHIVE_DIR, load_existing, pack, write

BASE = "https://www.stats.gov.cn/sj/zxfb/"
UA = {"User-Agent": "strategist-dashboard-data/1.0"}
GAP = 1.5                                            # seconds between requests to the bureau's site
BUDGET_S = int(os.environ.get("CNPROP_BUDGET", "240"))   # seconds of fetching per run; 0 = no limit (a local back-fill)
MAX_FETCH = 45                                       # pages per run (the price pages are 0.3 to 1.4 MB each)
CACHE = os.environ.get("CNPROP_CACHE")               # local development only: keep raw pages in this folder
PARSER = 1   # raise when the readers change: releases that failed with an older version are tried again
SRC_P = "National Bureau of Statistics of China, monthly release on home prices in 70 large and medium-sized cities"
SRC_R = "National Bureau of Statistics of China, monthly release on the national real-estate market (year to date)"

# The bureau's tiers, from its note under every 70-city commentary (e.g. 16 Nov 2026): tier 1 = 4 cities, tier 2 = 31,
# tier 3 = the other 35.
TIERS = {
    1: "北京 上海 广州 深圳".split(),
    2: ("天津 石家庄 太原 呼和浩特 沈阳 大连 长春 哈尔滨 南京 杭州 宁波 合肥 福州 厦门 南昌 济南 青岛 郑州 武汉 长沙 南宁 海口 重庆 成都 "
        "贵阳 昆明 西安 兰州 西宁 银川 乌鲁木齐").split(),
}
# English names as the bureau's English release spells them (paired with the Chinese table, Oct 2026), in table order
CITY_EN = {
    "北京": "Beijing", "唐山": "Tangshan", "天津": "Tianjin", "秦皇岛": "Qinhuangdao", "石家庄": "Shijiazhuang", "包头": "Baotou",
    "太原": "Taiyuan", "丹东": "Dandong", "呼和浩特": "Hohhot", "锦州": "Jinzhou", "沈阳": "Shenyang", "吉林": "Jilin", "大连": "Dalian",
    "牡丹江": "Mudanjiang", "长春": "Changchun", "无锡": "Wuxi", "哈尔滨": "Harbin", "徐州": "Xuzhou", "上海": "Shanghai", "扬州": "Yangzhou",
    "南京": "Nanjing", "温州": "Wenzhou", "杭州": "Hangzhou", "金华": "Jinhua", "宁波": "Ningbo", "蚌埠": "Bengbu", "合肥": "Hefei",
    "安庆": "Anqing", "福州": "Fuzhou", "泉州": "Quanzhou", "厦门": "Xiamen", "九江": "Jiujiang", "南昌": "Nanchang", "赣州": "Ganzhou",
    "济南": "Jinan", "烟台": "Yantai", "青岛": "Qingdao", "济宁": "Jining", "郑州": "Zhengzhou", "洛阳": "Luoyang", "武汉": "Wuhan",
    "平顶山": "Pingdingshan", "长沙": "Changsha", "宜昌": "Yichang", "广州": "Guangzhou", "襄阳": "Xiangyang", "深圳": "Shenzhen",
    "岳阳": "Yueyang", "南宁": "Nanning", "常德": "Changde", "海口": "Haikou", "韶关": "Shaoguan", "重庆": "Chongqing", "湛江": "Zhanjiang",
    "成都": "Chengdu", "惠州": "Huizhou", "贵阳": "Guiyang", "桂林": "Guilin", "昆明": "Kunming", "北海": "Beihai", "西安": "Xi'an",
    "三亚": "Sanya", "兰州": "Lanzhou", "泸州": "Luzhou", "西宁": "Xining", "南充": "Nanchong", "银川": "Yinchuan", "遵义": "Zunyi",
    "乌鲁木齐": "Urumqi", "大理": "Dali",
}
TIER_OF = {c: 1 for c in TIERS[1]} | {c: 2 for c in TIERS[2]} | {c: 3 for c in CITY_EN if c not in TIERS[1] + TIERS[2]}

# rows of the real-estate table: the heading (with "新建"/"本年" dropped and the unit cut off) -> key; its "其中" rows follow it
RE_PARENT = {"房地产开发投资": "INV", "房屋施工面积": "UC", "房屋新开工面积": "STARTS", "房屋竣工面积": "DONE", "商品房销售面积": "SOLD",
             "商品房销售额": "VAL", "商品房待售面积": "UNSOLD", "二手房交易网签面积": "RESALE", "房地产开发企业到位资金": "FUNDS"}
RE_SKIP = ("土地购置面积", "土地成交价款")            # land bought by developers: dropped by the bureau in 2023
RE_CHILD = {"住宅": "R", "国内贷款": "LOAN", "定金及预收款": "DEP", "个人按揭贷款": "MORT", "自筹资金": "SELF"}
# key: (label, unit as published, divisor to the stored unit, stored unit, flow (year to date) or stock)
RE_DEF = {
    "INV": ("Real-estate investment", "亿元", 10, "CNY bn", True), "INV_R": ("Residential investment", "亿元", 10, "CNY bn", True),
    "UC": ("Floor space under construction", "万平方米", 100, "mn sq m", False),
    "UC_R": ("Residential floor space under construction", "万平方米", 100, "mn sq m", False),
    "STARTS": ("Floor space newly started", "万平方米", 100, "mn sq m", True), "STARTS_R": ("Residential floor space newly started", "万平方米", 100, "mn sq m", True),
    "DONE": ("Floor space completed", "万平方米", 100, "mn sq m", True), "DONE_R": ("Residential floor space completed", "万平方米", 100, "mn sq m", True),
    "SOLD": ("New-home floor space sold (all buildings)", "万平方米", 100, "mn sq m", True),
    "SOLD_R": ("New-home floor space sold (residential)", "万平方米", 100, "mn sq m", True),
    "VAL": ("New-home sales value (all buildings)", "亿元", 10, "CNY bn", True), "VAL_R": ("New-home sales value (residential)", "亿元", 10, "CNY bn", True),
    "UNSOLD": ("Unsold floor space, month end", "万平方米", 100, "mn sq m", False),
    "UNSOLD_R": ("Unsold residential floor space, month end", "万平方米", 100, "mn sq m", False),
    "RESALE": ("Second-hand home transactions, floor space", "万平方米", 100, "mn sq m", True),
    "FUNDS": ("Developers' funding", "亿元", 10, "CNY bn", True), "FUNDS_LOAN": ("Developers' funding: domestic loans", "亿元", 10, "CNY bn", True),
    "FUNDS_DEP": ("Developers' funding: deposits and advance payments", "亿元", 10, "CNY bn", True),
    "FUNDS_MORT": ("Developers' funding: mortgage loans", "亿元", 10, "CNY bn", True),
    "FUNDS_SELF": ("Developers' funding: own funds", "亿元", 10, "CNY bn", True),
}
DERIVE = ("INV", "STARTS", "DONE", "SOLD", "SOLD_R", "VAL", "VAL_R", "RESALE")   # single months and 12-month totals

ARCH_CITIES, ARCH_RE, ARCH_REG = ARCHIVE_DIR / "cn_cities.csv", ARCHIVE_DIR / "cn_realestate.csv", ARCHIVE_DIR / "cn_releases.csv"


# ------------------------------------------------------------------ fetching
class Fetcher:
    def __init__(self):
        self.t0, self.n, self.last = time.time(), 0, 0.0

    def spent(self) -> bool:
        return BUDGET_S > 0 and (self.n >= MAX_FETCH or time.time() - self.t0 > BUDGET_S)

    def page(self, url: str) -> str | None:
        cp = Path(CACHE) / re.sub(r"[^A-Za-z0-9_.]", "_", url.split("/sj/zxfb/")[-1] or "index.html") if CACHE else None
        if cp and cp.exists() and cp.stat().st_size > 2000:
            return cp.read_text(encoding="utf-8", errors="replace")
        for i in range(3):   # the site resets about one connection in ten
            wait = GAP - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            try:
                self.n += 1
                r = requests.get(url, headers=UA, timeout=90)
                if r.status_code == 200 and len(r.content) > 2000:
                    text = r.content.decode("utf-8", "replace")
                    if cp:
                        cp.parent.mkdir(parents=True, exist_ok=True)
                        cp.write_text(text, encoding="utf-8")
                    return text
                if 400 <= r.status_code < 500:
                    print(f"      {url.split('/')[2]}: HTTP {r.status_code}")
                    return None
            except requests.RequestException as e:
                print(f"      {url.split('/')[2]}: {type(e).__name__} (try {i + 1})")
            time.sleep(4 * (i + 1))
        return None


def _month_of(kind: str, title: str) -> str | None:
    if kind == "P":
        m = re.search(r"(\d{4})年(\d{1,2})月份", title)
        return f"{m.group(1)}-{int(m.group(2)):02d}" if m else None
    m = re.search(r"(\d{4})年1[—\-－–~至]+(\d{1,2})月份", title)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}"
    m = re.search(r"(\d{4})年(上半年|前三季度|一季度)?全国", title)
    return f"{m.group(1)}-{ {'上半年': 6, '前三季度': 9, '一季度': 3}.get(m.group(2), 12):02d}" if m else None


def list_page(html: str) -> tuple[dict[str, str], int | None, int]:
    """{href: title} of the property releases on one list page, the number of list pages (page 0 only), and how many
    releases of any kind the page lists (0 = past the end of the list)."""
    found: dict[str, str] = {}
    links = re.findall(r'<a[^>]+href="(\./\d{6}/t\d+_\d+\.html)"([^>]*)>(.*?)</a>', html, re.S)
    for href, attrs, inner in links:
        for t in (re.search(r'title="([^"]*)"', attrs).group(1) if 'title="' in attrs else "", re.sub(r"<[^>]+>", "", inner)):
            t = re.sub(r"\s+", "", H.unescape(t))
            if t and "…" not in t and "..." not in t and ("70个大中城市" in t or "全国房地产" in t) and len(t) > len(found.get(href, "")):
                found[href] = t
    m = re.search(r"createPageHTML\((\d+)\s*,", html)
    return found, (int(m.group(1)) if m else None), len({h for h, _, _ in links})


def _tables(html: str) -> list[list[list[str]]]:
    return [[[re.sub(r"\s+", "", H.unescape(re.sub(r"<[^>]+>", "", td))) for td in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, re.S | re.I)]
             for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", tb, re.S | re.I)] for tb in re.findall(r"<table[^>]*>(.*?)</table>", html, re.S | re.I)]


def _num(x: str) -> float | None:
    x = x.replace(",", "").replace("，", "")
    try:
        return float(x)
    except ValueError:
        return None


def parse_prices(html: str) -> dict[str, tuple] | None:
    """{city: (new m/m, new y/y, second-hand m/m, second-hand y/y)} as published indices (previous = 100), or None."""
    tb = _tables(html)
    if len(tb) < 2:
        return None
    parts = []
    for rows in tb[:2]:
        d = {}
        for row in rows:
            w = len(row) // 2
            for k in (0, w):   # each row holds two cities: (city, m/m, y/y, year-to-date average) twice
                if w >= 3 and row[k] in CITY_EN:
                    a, b = _num(row[k + 1]), _num(row[k + 2])
                    if a is not None and b is not None:
                        d[row[k]] = (a, b)
        parts.append(d)
    if any(len(p) != 70 for p in parts):
        return None
    return {c: parts[0][c] + parts[1][c] for c in CITY_EN}


def parse_realestate(html: str) -> dict[str, tuple] | None:
    """{key: (value as published, growth % as published)} from the first table, read in order (a "其中" row belongs to
    the heading above it). None if the main rows are not there."""
    tb = _tables(html)
    if not tb:
        return None
    out, parent = {}, None
    for row in tb[0]:
        row = [x for x in row if x != ""]
        if len(row) < 2:
            continue
        lab, val, g = row[0], _num(row[1]), (_num(row[2]) if len(row) > 2 else None)
        if "（" in lab and not lab.startswith("其中"):   # a heading: "新建商品房销售面积（万平方米）"
            name = re.sub(r"（.*", "", lab).replace("新建", "").replace("本年", "")
            parent = RE_PARENT.get(name)
            if parent is None and not name.startswith(RE_SKIP):
                print(f"      real estate: unknown row '{lab}' (skipped)")
            if parent and val is not None:
                out[parent] = (val, g)
        elif parent:
            child = RE_CHILD.get(lab.replace("其中：", "").replace("其中:", ""))
            funding = parent.startswith("FUNDS")   # "住宅" belongs under the floor-space and money headings, the funding sources under funding
            if child and val is not None and (child != "R") == funding:
                out[f"{parent}_{child}"] = (val, g)
    return out if all(k in out for k in ("INV", "STARTS", "DONE", "SOLD", "VAL")) else None


# ------------------------------------------------------------------ archive
def _read_csv(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f))


def _write_csv(path: Path, fields: list[str], rows: list[dict]) -> None:
    ARCHIVE_DIR.mkdir(exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)


# ------------------------------------------------------------------ series
def _ts(month: str) -> pd.Timestamp:
    return pd.Timestamp(f"{month}-01")


def _dser(d: dict) -> pd.Series:
    return pd.Series(list(d.values()), index=pd.DatetimeIndex(list(d.keys())), dtype=float).sort_index()


def _ser(s: pd.Series, label: str, unit: str, source: str, kind: str = "level") -> dict:
    return {"label": label, "group": "Macro · China property", "kind": kind, "unit": unit, "source": source, "freq": "M", **pack(s.dropna())}


def price_series(cities: list[dict]) -> tuple[dict, dict | None]:
    if not cities:
        return {}, None
    df = pd.DataFrame(cities)
    for c in ("new_mom", "new_yoy", "old_mom", "old_yoy"):
        df[c] = df[c].astype(float)
    df["tier"] = df["city"].map(TIER_OF)
    out = {}
    groups = {"T1": df[df.tier == 1], "T2": df[df.tier == 2], "T3": df[df.tier == 3], "ALL": df}
    tname = {"T1": "tier-1 cities (4)", "T2": "tier-2 cities (31)", "T3": "tier-3 cities (35)", "ALL": "70 cities"}
    for kind, kname in (("new", "New homes"), ("old", "Second-hand homes")):
        for g, sub in groups.items():
            m = sub.groupby("month")
            mom, yoy = m[f"{kind}_mom"].mean() - 100, m[f"{kind}_yoy"].mean() - 100
            mom.index, yoy.index = [_ts(x) for x in mom.index], [_ts(x) for x in yoy.index]
            out[f"CNP_{kind.upper()}_{g}_MOM"] = _ser(mom, f"{kname}, {tname[g]}: price on the month", "%", SRC_P + "; simple average, as the bureau's tiers")
            out[f"CNP_{kind.upper()}_{g}_YOY"] = _ser(yoy, f"{kname}, {tname[g]}: price on a year", "%", SRC_P + "; simple average, as the bureau's tiers")
            lvl = (1 + mom.sort_index() / 100).cumprod() * 100   # chained from the monthly changes; the first month = 100
            out[f"CNP_{kind.upper()}_{g}_IDX"] = _ser(lvl, f"{kname}, {tname[g]}: price level chained from monthly changes", f"{mom.index.min():%b %Y} = 100",
                                                      SRC_P + "; calculated")
        up = df.groupby("month")[f"{kind}_mom"].apply(lambda x: float((x > 100).sum()))
        up.index = [_ts(x) for x in up.index]
        out[f"CNP_{kind.upper()}_UP"] = _ser(up, f"{kname}: cities with a price rise on the month (of 70)", "cities", SRC_P + "; calculated")
    last = max(r["month"] for r in cities)
    rows = [[CITY_EN[r["city"]], r["city"], TIER_OF[r["city"]]] + [round(float(r[c]) - 100, 1) for c in ("new_mom", "new_yoy", "old_mom", "old_yoy")]
            for r in cities if r["month"] == last]
    order = list(CITY_EN)
    rows.sort(key=lambda r: order.index(r[1]))
    return out, {"month": last, "cols": ["city", "city_cn", "tier", "new_mom", "new_yoy", "old_mom", "old_yoy"], "rows": rows}


def realestate_series(rows: list[dict]) -> dict:
    if not rows:
        return {}
    df = pd.DataFrame(rows)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df["growth"] = pd.to_numeric(df["growth"], errors="coerce")
    out, lev = {}, {}
    for key, g in df.groupby("key"):
        if key not in RE_DEF:
            continue
        lab, _, div, unit, flow = RE_DEF[key]
        v = pd.Series(g["value"].values / div, index=[_ts(m) for m in g["month"]]).sort_index()
        gr = pd.Series(g["growth"].values, index=[_ts(m) for m in g["month"]]).sort_index()
        lev[key] = v
        out[f"CNR_{key}"] = _ser(v, lab + (", year to date" if flow else ""), unit, SRC_R)
        out[f"CNR_{key}_G"] = _ser(gr, lab + (", year to date" if flow else "") + ": growth on a year (as published, comparable basis)", "%", SRC_R)
    for key in DERIVE:   # single months (January and February are one reading, dated February) and 12-month totals
        if key not in lev:
            continue
        y = lev[key]
        single, tot = {}, {}
        for t, v in y.items():
            prev = y.get(t - pd.DateOffset(months=1))
            if t.month == 2 or t.month == 1:
                single[t] = v
            elif prev is not None and not pd.isna(prev) and t.month > 2:
                single[t] = v - prev
            dec, same = y.get(pd.Timestamp(t.year - 1, 12, 1)), y.get(t - pd.DateOffset(years=1))
            if t.month == 12:
                tot[t] = v
            elif dec is not None and same is not None and not pd.isna(dec) and not pd.isna(same):
                tot[t] = v + dec - same
        lab, _, _, unit, _ = RE_DEF[key]
        single, tot = _dser(single), _dser(tot)
        if len(single):
            out[f"CNR_{key}_M"] = _ser(single, lab + ", single month (January and February together)", unit, SRC_R + "; calculated")
        if len(tot):
            out[f"CNR_{key}_12M"] = _ser(tot, lab + ", last 12 months", unit, SRC_R + "; calculated")
            lev[key + "_12M"] = tot
    for k, lab in (("", "all buildings"), ("_R", "residential")):   # average price: value / floor space, last 12 months
        a, b = lev.get(f"VAL{k}_12M"), lev.get(f"SOLD{k}_12M")
        if a is not None and b is not None and len(a) and len(b):
            p = (a / b * 1000).dropna()   # CNY bn / mn sq m = CNY 1,000 per sq m
            out[f"CNR_AVGP{k}_12M"] = _ser(p.round(0), f"Average price of new homes sold ({lab}), last 12 months", "CNY per sq m", SRC_R + "; calculated")
    return out


# ------------------------------------------------------------------ build
def build(status: dict) -> None:
    print("China property (NBS releases: 70-city prices, national real estate)")
    old = load_existing("cnprop.json") or {}
    meta_old = old.get("_meta") or {}
    reg = {(r["kind"], r["month"]): r for r in _read_csv(ARCH_REG)}
    cities, rer = _read_csv(ARCH_CITIES), _read_csv(ARCH_RE)
    F = Fetcher()
    walk = meta_old.get("walk")   # the next list page while the first walk through the whole list is unfinished
    if not reg and walk is None:
        walk = 2
    reached, n_pages, new_p, new_r = False, meta_old.get("list_pages"), [], []

    def read_list(page: int) -> str:   # "ok", "end" (past the last page) or "fail" (no answer)
        nonlocal reached, n_pages
        html = F.page(BASE + ("index.html" if page == 0 else f"index_{page}.html"))
        if html is None:
            return "fail"
        reached = True
        found, n, n_links = list_page(html)
        if page == 0 and n:
            n_pages = n
        for href, title in found.items():
            kind = "P" if "70个大中城市" in title else "R"
            month = _month_of(kind, title)
            if month and (kind, month) not in reg:
                reg[(kind, month)] = {"kind": kind, "month": month, "status": "pending", "url": BASE + href[2:], "title": title}
        return "ok" if n_links else "end"

    # 1. the list: its first two pages every run; the rest on the first runs, resuming one page early (the list shifts as
    #    releases are added)
    if read_list(0) == "ok" and read_list(1) == "ok" and walk is not None:
        p = max(2, walk - 1)
        while p < (n_pages or 80) and not F.spent():
            got = read_list(p)
            if got == "fail":
                break
            p = (n_pages or 80) if got == "end" else p + 1
        walk = None if p >= (n_pages or 80) else p   # stopped by the budget or the site: resume there next run
    # 2. the releases not yet read (or that failed with an older reader), newest first
    def due(r):
        return r["status"] == "pending" or (r["status"].startswith("failed") and r["status"] != f"failed v{PARSER}")
    for r in sorted((r for r in reg.values() if due(r)), key=lambda r: r["month"], reverse=True):
        if F.spent():
            break
        html = F.page(r["url"])
        if html is None:
            continue   # stays as it was: tried again next run
        if r["kind"] == "P":
            x = parse_prices(html)
            if x:
                cities = [c for c in cities if c["month"] != r["month"]] + [
                    {"month": r["month"], "city": c, "new_mom": v[0], "new_yoy": v[1], "old_mom": v[2], "old_yoy": v[3]} for c, v in x.items()]
                new_p.append(r["month"])
        else:
            x = parse_realestate(html)
            if x:
                rer = [c for c in rer if c["month"] != r["month"]] + [
                    {"month": r["month"], "key": k, "value": v[0], "growth": "" if v[1] is None else v[1]} for k, v in x.items()]
                new_r.append(r["month"])
        r["status"] = "ok" if x else f"failed v{PARSER}"
        if not x:
            print(f"      could not read: {r['title']} ({r['url']})")
    # 3. archive (each file rewritten only when it changed)
    if new_p:
        _write_csv(ARCH_CITIES, ["month", "city", "new_mom", "new_yoy", "old_mom", "old_yoy"],
                   sorted(cities, key=lambda c: (c["month"], list(CITY_EN).index(c["city"]))))
    if new_r:
        _write_csv(ARCH_RE, ["month", "key", "value", "growth"], sorted(rer, key=lambda c: (c["month"], c["key"])))
    if reached:
        _write_csv(ARCH_REG, ["kind", "month", "status", "url", "title"], sorted(reg.values(), key=lambda r: (r["kind"], r["month"])))
    # 4. the series, from the whole archive
    ps, table = price_series(cities)
    rs = realestate_series(rer)
    if not ps and not rs:
        print("  nothing read and no archive: the previous file is kept")
        status["CNPROP"] = "stale (kept previous)" if old else "missing"
        return
    for sid in list(ps) + list(rs):
        status[sid] = "ok" if reached else "stale (kept previous)"
    pending = [f"{r['kind']} {r['month']}" for r in reg.values() if due(r)]
    failed = [f"{r['kind']} {r['month']}: {r['title']}" for r in reg.values() if r["status"] == f"failed v{PARSER}"]
    mp, mr = sorted({c["month"] for c in cities}), sorted({c["month"] for c in rer})
    out = {"_meta": {"fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "reached": reached, "walk": walk,
                     "list_pages": n_pages, "fetched": F.n, "read": {"prices": mp, "realestate": mr}, "pending": pending, "failed": failed,
                     "tiers": {str(t): [CITY_EN[c] for c in CITY_EN if TIER_OF[c] == t] for t in (1, 2, 3)},
                     "source": "www.stats.gov.cn/sj/zxfb/"},
           "_cities": table, **ps, **rs}
    write("cnprop.json", out)
    print(f"  prices: {len(mp)} months ({mp[0] if mp else '-'} to {mp[-1] if mp else '-'}), {len(new_p)} new; real estate: {len(mr)} months "
          f"({mr[0] if mr else '-'} to {mr[-1] if mr else '-'}), {len(new_r)} new; {F.n} pages fetched"
          + (f"; {len(pending)} releases still to read" if pending else "") + (f"; walking the list (next page {walk})" if walk is not None else "")
          + (f"; could not read: {', '.join(failed)}" if failed else "") + ("" if reached else "; the site did not answer"))


if __name__ == "__main__":
    build({})
