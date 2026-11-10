"""
Sentiment gauges, scraped from public web pages (none of these has an official API, so any of them can break
without notice; each source is isolated and a failure keeps the previously published readings).

  CNN Fear & Greed      production.dataviz.cnn.io/index/fearandgreed/graphdata/<start>   JSON, daily, ~5 years
                        (also its put/call component: 5-day average of the CBOE put/call ratio)
  AAII Sentiment Survey www.aaii.com/sentimentsurvey/sent_results   HTML table, weekly, last ~6 months only
  NAAIM Exposure Index  index.naaim.org/embeddable/chart and /table (embedded in naaim.org)   weekly

Every reading is also appended to archive/<id>.csv (committed by the workflow), so history keeps growing even
where the source only shows recent weeks. Writes docs/data/sentiment.json:
  {"series": {id: {label, group, kind, unit, source, d, v}}, "meta": {source: {fetched_utc, ok, latest, note}}}
Status values never read "missing", so a broken scraper does not raise the data-health alert; the page shows
each gauge's own "last updated" date instead.
"""
from __future__ import annotations

import html
import json
import re
import time
from datetime import date, datetime, timezone

import pandas as pd
import requests

from fetch import load_existing, merge_archive, pack, unpack, write

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "Accept": "application/json, text/html;q=0.9, */*;q=0.8"}
CNN_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata/{start}"
AAII_URL = "https://www.aaii.com/sentimentsurvey/sent_results"
NAAIM_CHART = "https://index.naaim.org/embeddable/chart"
NAAIM_TABLE = "https://index.naaim.org/embeddable/table"
MONTHS = {m: i for i, m in enumerate(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], 1)}

META = {
    "FG":         ("CNN Fear & Greed index", "0–100", "CNN Business Fear & Greed (dataviz.cnn.io)"),
    "FG_PUTCALL": ("Put/call ratio, 5-day average (CNN component)", "ratio", "CNN Business Fear & Greed: CBOE put/call component"),
    "AAII_BULL":  ("AAII bulls", "%", "AAII Sentiment Survey (aaii.com)"),
    "AAII_NEUT":  ("AAII neutral", "%", "AAII Sentiment Survey (aaii.com)"),
    "AAII_BEAR":  ("AAII bears", "%", "AAII Sentiment Survey (aaii.com)"),
    "NAAIM":      ("NAAIM Exposure Index", "% exposure", "NAAIM Exposure Index (naaim.org)"),
}


def _get(url: str, tries: int = 3) -> requests.Response:
    """GET with a pause between tries: AAII's bot screen ("Pardon Our Interruption") comes and goes."""
    last = None
    for i in range(tries):
        try:
            r = requests.get(url, headers=UA, timeout=45)
            r.raise_for_status()
            if "Pardon Our Interruption" in r.text[:3000]:
                raise RuntimeError("bot screen")
            return r
        except Exception as e:
            last = e
            if i < tries - 1:
                time.sleep(15)
    raise last


def cnn() -> dict[str, pd.Series]:
    j = None
    for start in ("2021-01-01", "2023-01-01", "2024-01-01"):   # the API refuses some start dates; step forward
        try:
            j = _get(CNN_URL.format(start=start)).json()
            break
        except Exception:
            continue
    if j is None:
        raise RuntimeError("no response")

    def ser(block):
        pts = (j.get(block) or {}).get("data") or []
        s = pd.Series({pd.Timestamp(int(p["x"]), unit="ms").normalize(): float(p["y"]) for p in pts if p.get("y") is not None}, dtype="float64")
        return s[~s.index.duplicated(keep="last")].sort_index()

    out = {"FG": ser("fear_and_greed_historical"), "FG_PUTCALL": ser("put_call_options")}
    now = j.get("fear_and_greed") or {}
    if now.get("score") is not None and now.get("timestamp"):   # today's live score
        out["FG"].loc[pd.Timestamp(now["timestamp"][:10])] = float(now["score"])
    return {k: v.sort_index() for k, v in out.items() if len(v) > 20}


def aaii() -> dict[str, pd.Series]:
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", _get(AAII_URL).text))
    rows = re.findall(r"\b([A-Z][a-z]{2}) (\d{1,2}) (\d+\.\d)% (\d+\.\d)% (\d+\.\d)%", t)
    if len(rows) < 4:
        raise RuntimeError("table not found")
    # dates carry no year: newest first, so step back a year whenever the month jumps forward
    today, y, prev_m, out = date.today(), date.today().year, None, {"AAII_BULL": {}, "AAII_NEUT": {}, "AAII_BEAR": {}}
    for mon, day, bull, neut, bear in rows:
        m = MONTHS.get(mon)
        if m is None:
            continue
        if prev_m is None and date(y, m, min(int(day), 28)) > today:
            y -= 1
        elif prev_m is not None and m > prev_m:
            y -= 1
        prev_m = m
        d = pd.Timestamp(year=y, month=m, day=int(day))
        out["AAII_BULL"][d], out["AAII_NEUT"][d], out["AAII_BEAR"][d] = float(bull), float(neut), float(bear)
    return {k: pd.Series(v, dtype="float64").sort_index() for k, v in out.items()}


def naaim() -> dict[str, pd.Series]:
    s = {}
    try:   # history from the chart's embedded Chart.js data
        h = _get(NAAIM_CHART).text
        m = re.search(r'data-symfony--ux-chartjs--chart-view-value="([^"]+)"', h)
        j = json.loads(html.unescape(m.group(1)))
        lab = j["data"]["labels"]
        ds = next(d for d in j["data"]["datasets"] if "NAAIM" in (d.get("label") or ""))
        s.update({pd.Timestamp(a): float(b) for a, b in zip(lab, ds["data"]) if b not in (None, "")})
    except Exception:
        pass
    t = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", _get(NAAIM_TABLE).text))   # the table carries the latest week
    for d, v in re.findall(r"(\d\d/\d\d/\d{4}) (-?\d+\.\d+)", t):
        s[pd.to_datetime(d, format="%m/%d/%Y")] = float(v)
    if len(s) < 4:
        raise RuntimeError("no readings found")
    return {"NAAIM": pd.Series(s, dtype="float64").sort_index()}


def build(status: dict) -> None:
    print("Sentiment gauges")
    old_all = load_existing("sentiment.json")
    old, old_meta = old_all.get("series", {}), old_all.get("meta", {})
    series, meta = {}, {}
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    for src, fn, ids in (("CNN", cnn, ["FG", "FG_PUTCALL"]), ("AAII", aaii, ["AAII_BULL", "AAII_NEUT", "AAII_BEAR"]), ("NAAIM", naaim, ["NAAIM"])):
        try:
            got, err = fn(), None
        except Exception as e:   # each scraper on its own: one breaking never affects the others
            got, err = {}, type(e).__name__
        for sid in ids:
            fresh = got.get(sid)
            s = merge_archive(sid, fresh, unpack(old[sid]) if sid in old else None)
            if s is not None and len(s):
                label, unit, source = META[sid]
                series[sid] = {"label": label, "group": "Sentiment", "kind": "level", "unit": unit, "source": source, **pack(s)}
            status[sid] = "ok" if fresh is not None else ("stale (kept previous)" if sid in series else "unavailable")
        latest = max((pd.Timestamp(EPOCH_DAY(series[i]["d"][-1])) for i in ids if i in series), default=None)
        meta[src] = {"fetched_utc": now if not err else (old_meta.get(src) or {}).get("fetched_utc"), "ok": not err,
                     "latest": latest.strftime("%Y-%m-%d") if latest is not None else None, "error": err}
        print(f"  {src:6} {'ok' if not err else 'failed (' + err + '), kept previous'}; latest reading {meta[src]['latest']}")
    write("sentiment.json", {"series": series, "meta": meta})


def EPOCH_DAY(d: int) -> pd.Timestamp:
    return pd.Timestamp("1970-01-01") + pd.Timedelta(days=int(d))


if __name__ == "__main__":
    build({})
