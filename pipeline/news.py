"""
Market headlines from public RSS feeds (no logins, no paywalled content: title, time, link only).

Writes docs/data/news.json:
  {"updated_utc": ..., "feeds": {name: status}, "items": [{t, title, link, source, cat}]}
"""
from __future__ import annotations

import html
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import requests

from fetch import write

UA = {"User-Agent": "Mozilla/5.0 (strategist-dashboard headline reader)"}

# (name, category, url)
FEEDS = [
    ("Bloomberg Markets",   "Markets",       "https://feeds.bloomberg.com/markets/news.rss"),
    ("Bloomberg Economics", "Macro",         "https://feeds.bloomberg.com/economics/news.rss"),
    ("Bloomberg Politics",  "Politics",      "https://feeds.bloomberg.com/politics/news.rss"),
    ("CNBC Top News",       "Markets",       "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114"),
    ("CNBC Economy",        "Macro",         "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"),
    ("CNBC Asia",           "Asia",          "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=19832390"),
    ("Federal Reserve",     "Central banks", "https://www.federalreserve.gov/feeds/press_all.xml"),
    ("ECB",                 "Central banks", "https://www.ecb.europa.eu/rss/press.html"),
    ("Bank of Japan",       "Central banks", "https://www.boj.or.jp/en/rss/whatsnew.xml"),
    ("Business Times SG",   "Asia",          "https://www.businesstimes.com.sg/rss/top-stories"),
    ("CNA Business",        "Asia",          "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6936"),
    ("Nikkei Asia",         "Asia",          "https://asia.nikkei.com/rss/feed/nar"),
]
MAX_AGE = timedelta(days=7)
PER_FEED = 40


def _when(s: str) -> datetime | None:
    if not s:
        return None
    try:
        d = parsedate_to_datetime(s)
    except Exception:
        try:
            d = datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return None
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def parse(raw: bytes) -> list[dict]:
    raw = re.sub(rb"<\?xml-stylesheet[^>]*\?>", b"", raw)
    root = ET.fromstring(raw)
    ns = {"a": "http://www.w3.org/2005/Atom", "dc": "http://purl.org/dc/elements/1.1/",
          "rss1": "http://purl.org/rss/1.0/"}
    out = []
    items = root.findall(".//item") or root.findall(".//rss1:item", ns) or root.findall(".//a:entry", ns)
    for it in items:
        title = (it.findtext("title") or it.findtext("{http://purl.org/rss/1.0/}title")
                 or it.findtext("{http://www.w3.org/2005/Atom}title") or "").strip()
        link = (it.findtext("link") or it.findtext("{http://purl.org/rss/1.0/}link") or "").strip()
        if not link:
            a = it.find("{http://www.w3.org/2005/Atom}link")
            link = a.get("href", "") if a is not None else ""
        when = _when((it.findtext("pubDate") or "").strip() or it.findtext("{http://purl.org/dc/elements/1.1/}date") or
                     it.findtext("{http://www.w3.org/2005/Atom}updated") or it.findtext("{http://www.w3.org/2005/Atom}published") or "")
        title = html.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", title))).strip()
        if title and link.startswith("http"):
            out.append({"title": title, "link": link, "when": when})
    return out


def build_news() -> dict:
    now = datetime.now(timezone.utc)
    items, feeds, seen = [], {}, set()
    print("News:")
    for name, cat, url in FEEDS:
        try:
            r = requests.get(url, headers=UA, timeout=25)
            r.raise_for_status()
            got = parse(r.content)
        except Exception as e:
            feeds[name] = f"failed ({type(e).__name__})"
            print(f"  {name:<22} {feeds[name]}")
            continue
        n = 0
        for x in got[:PER_FEED]:
            if x["when"] and now - x["when"] > MAX_AGE:
                continue
            key = re.sub(r"\W+", "", x["title"].lower())[:80]
            if key in seen:
                continue
            seen.add(key)
            items.append({"t": x["when"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if x["when"] else None,
                          "title": x["title"][:300], "link": x["link"], "source": name, "cat": cat})
            n += 1
        feeds[name] = f"ok ({n})"
        print(f"  {name:<22} {feeds[name]}")
    items.sort(key=lambda x: x["t"] or "", reverse=True)
    out = {"updated_utc": now.strftime("%Y-%m-%d %H:%M UTC"), "feeds": feeds, "items": items}
    write("news.json", out)
    return out


if __name__ == "__main__":
    build_news()
