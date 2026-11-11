"""
Ramp AI Index (ramp.com/data/ai-index): what US companies actually pay for, from 85,000+ firms' card and bill-pay data.

The page embeds its chart data (Next.js payload): monthly adoption overall and by vendor, AI's share of business
spend and spend per employee, from Jul 2023. Its "Tokenomics" table gives the latest week and the same week a month
earlier for token spend share, token volume share and blended token prices; each run stores those readings in
archive/ so a weekly history builds up. Scraped from a public page (no API), so it is isolated: a failure keeps the
previous file and never raises the data-health alert. Writes docs/data/ramp.json (series, plus "_meta").
"""
from __future__ import annotations

import html
import json
import re
from datetime import datetime, timezone

import pandas as pd
import requests

from fetch import load_existing, merge_archive, pack, unpack, write

URL = "https://ramp.com/data/ai-index"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}
VENDORS = ["OpenAI", "Anthropic", "Google", "xAI", "Microsoft", "Mistral", "Perplexity"]
SRC = "Ramp AI Index (ramp.com/data/ai-index)"


def _payload(t: str) -> str:
    return "".join(json.loads(c) for c in re.findall(r'self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)', t))


def _props(payload: str) -> dict:
    for line in payload.split("\n"):
        if "adoptionOverall" in line and ":" in line:
            obj = json.loads(line.split(":", 1)[1])
            stack = [obj]
            while stack:
                o = stack.pop()
                if isinstance(o, dict):
                    if "adoptionOverall" in o:
                        return o
                    stack.extend(o.values())
                elif isinstance(o, list):
                    stack.extend(o)
    raise RuntimeError("chart data not found")


def _series(rows, date_key, val_key, scale=1.0) -> pd.Series:
    s = pd.Series({pd.Timestamp(r[date_key]): float(r[val_key]) * scale for r in rows if r.get(val_key) is not None}, dtype="float64")
    return s[~s.index.duplicated(keep="last")].sort_index()


def _tokenomics(t: str) -> dict[str, pd.Series]:
    i = t.find("Tokenomics")
    if i < 0:
        return {}
    seg = t[i:i + 30000]
    rows = [[html.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", r, re.S)]
            for r in re.findall(r"<tr[^>]*>(.*?)</tr>", seg, re.S)]
    if not rows or len(rows[0]) < 3:
        return {}
    dates = [pd.to_datetime(h.replace("Week ending", "").strip(), format="%b %d, %Y", errors="coerce") for h in rows[0][1:3]]
    out = {}
    for r in rows[1:]:
        if len(r) < 3:
            continue
        m = re.match(r"(Share of token spend|Share of token volume|Blended price per million tokens): (.+)", r[0])
        if not m:
            continue
        kind = {"Share of token spend": "SPEND", "Share of token volume": "VOL", "Blended price per million tokens": "PRICE"}[m.group(1)]
        who = re.sub(r"[^A-Za-z]+", "_", m.group(2)).strip("_").upper()
        vals = {}
        for d, cell in zip(dates, r[1:3]):
            v = re.sub(r"[^0-9.\-]", "", cell)
            if d is not pd.NaT and v not in ("", "-", "."):
                vals[d] = float(v)
        if vals:
            out[f"RAMP_TOK_{kind}_{who}"] = (pd.Series(vals, dtype="float64").sort_index(), f"{m.group(1)}: {m.group(2)}", "%" if kind != "PRICE" else "USD per 1M tokens")
    return out


def build(status: dict) -> None:
    print("Ramp AI Index")
    old = load_existing("ramp.json")
    out, err = {}, None
    try:
        r = requests.get(URL, headers=UA, timeout=60)
        r.raise_for_status()
        t = r.text
        props = _props(_payload(t))
        series = {"RAMP_ADOPT": (_series(props["adoptionOverall"], "date_month", "adoption_rate_pct"), "US businesses paying for AI (Ramp)", "%")}
        for v in VENDORS:
            s = _series([x for x in props.get("adoptionVendor", []) if x.get("vendor") == v], "date_month", "adoption_rate_pct")
            if len(s):
                series[f"RAMP_ADOPT_{v.upper()}"] = (s, f"Businesses paying for {v} (Ramp)", "%")
        for size in sorted({x.get("business_size") for x in props.get("adoptionSize", []) if x.get("business_size")}):
            s = _series([x for x in props["adoptionSize"] if x.get("business_size") == size], "date_month", "adoption_rate_pct")
            if len(s):
                series["RAMP_ADOPT_" + size.split()[0].upper().replace("-SIZED", "")] = (s, f"{size} paying for AI (Ramp)", "%")
        share = (props.get("spendShareData") or {}).get("overall") or []
        if share:
            series["RAMP_AI_SHARE"] = (_series(share, "my_date", "ai_share_of_tpv", 100), "AI share of business spend (Ramp)", "%")
        pepm = props.get("spendPerEmployee") or []
        if pepm:
            series["RAMP_PEPM"] = (_series(pepm, "date_month", "median_pepm"), "AI spend per employee, median (Ramp)", "USD a month")
        for sid, val in _tokenomics(t).items():
            series[sid] = val
        for sid, (s, label, unit) in series.items():
            s = merge_archive(sid, s, unpack(old[sid]) if sid in old else None) if sid.startswith("RAMP_TOK_") else s
            out[sid] = {"label": label, "group": "AI · Ramp", "kind": "level", "unit": unit, "source": SRC, **pack(s)}
            status[sid] = "ok"
    except Exception as e:   # a scraped page: keep what was published before
        err = type(e).__name__
        out = {k: v for k, v in old.items() if not k.startswith("_")}
        for k in out:
            status[k] = "stale (kept previous)"
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    meta_old = old.get("_meta") or {}
    out["_meta"] = {"fetched_utc": now if not err else meta_old.get("fetched_utc"), "ok": not err, "error": err}
    write("ramp.json", out)
    print(f"  {'ok' if not err else 'failed (' + err + '), kept previous'}: {len(out) - 1} series")


if __name__ == "__main__":
    build({})
