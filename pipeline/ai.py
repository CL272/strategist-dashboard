"""
AI adoption & economics indicators.

  OpenRouter (public)  models API: list prices per model (USD per million tokens)
                       rankings page (public, robots.txt allows): weekly tokens of the top-20 models,
                       usage-weighted input prices, average cost per request (US cents),
                       benchmark scores (Artificial Analysis intelligence index)
                       -> only a current snapshot is published, so each run is archived in
                          archive/ai_openrouter_daily.csv and archive/ai_models_weekly.csv
  Epoch AI (CC BY)     AI lab revenue, data-centre power, AI chip shipments, frontier benchmark scores

Writes docs/data/ai.json.
"""
from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import datetime, timezone

import pandas as pd
import requests

from fetch import ROOT, write

UA = {"User-Agent": "Mozilla/5.0 (strategist-dashboard; daily public-data snapshot)"}
ARCH = ROOT / "archive"
OR_MODELS = "https://openrouter.ai/api/v1/models"
OR_RANKINGS = "https://openrouter.ai/rankings"
EPOCH = "https://epoch.ai/data/{f}"


def _get(url, **kw):
    r = requests.get(url, headers=UA, timeout=60, **kw)
    r.raise_for_status()
    return r


def _dehydrated(html: str, query_key: str):
    """Pull one React-Query result embedded in the rankings page."""
    u = html.replace('\\"', '"').replace('\\\\', '\\')
    i = u.find('"queryKey":' + query_key)
    if i < 0:
        return None
    j = u.rfind('"state":{"data":', 0, i) + len('"state":{"data":')
    depth, k = 0, j
    while k < len(u):
        ch = u[k]
        if ch in "[{":
            depth += 1
        elif ch in "]}":
            depth -= 1
        k += 1
        if depth == 0:
            break
    try:
        return json.loads(u[j:k])
    except Exception:
        return None


def openrouter(notes: list) -> dict:
    out = {}
    names, prices = {}, {}
    try:
        for m in _get(OR_MODELS).json().get("data", []):
            p = m.get("pricing") or {}
            try:
                pin, pout = float(p.get("prompt") or 0) * 1e6, float(p.get("completion") or 0) * 1e6
            except ValueError:
                continue
            for key in (m.get("id"), m.get("canonical_slug")):
                if key:
                    names[key] = m.get("name", key)
                    prices[key] = (pin, pout)
        out["n_models"] = len({v for v in names.values()})
    except Exception as e:
        notes.append(f"OpenRouter models API: {type(e).__name__}")
    try:
        html = _get(OR_RANKINGS).text
    except Exception as e:
        notes.append(f"OpenRouter rankings: {type(e).__name__}")
        return out
    week = _dehydrated(html, '["rankings","models",{"view":"week"}]') or []
    bench = _dehydrated(html, '["rankings","benchmarks"]') or {}
    apps = _dehydrated(html, '["rankings","apps"]') or {}
    wprice = bench.get("weightedInputPrices", {}) or {}
    cpr = bench.get("costPerRequest", {}) or {}
    intel = {x.get("permaslug"): x.get("score") for x in (bench.get("aaData", {}) or {}).get("intelligence", [])}
    coding = {x.get("permaslug"): x.get("score") for x in (bench.get("aaData", {}) or {}).get("coding", [])}

    def base(slug):   # 'anthropic/claude-opus-5-20260723' -> 'anthropic/claude-opus-5'
        return re.sub(r"-\d{8}$", "", slug or "")

    rows = []
    for x in week:
        slug = x.get("model_permaslug", "")
        toks = (x.get("total_prompt_tokens") or 0) + (x.get("total_completion_tokens") or 0)
        pin, pout = prices.get(slug) or prices.get(base(slug)) or (None, None)
        rows.append({"slug": slug, "name": names.get(slug) or names.get(base(slug)) or base(slug).split("/")[-1],
                     "org": slug.split("/")[0], "tokens": toks, "prompt": x.get("total_prompt_tokens"), "completion": x.get("total_completion_tokens"),
                     "requests": x.get("count"), "price_in": pin, "price_out": pout, "wprice": wprice.get(slug),
                     "cpr_cents": cpr.get(slug), "intel": intel.get(slug), "date": (x.get("date") or "")[:10]})
    rows.sort(key=lambda r: -r["tokens"])
    out["week"] = rows
    out["week_date"] = rows[0]["date"] if rows else None
    scatter = []
    for slug, sc in intel.items():
        if sc is None or wprice.get(slug) is None:
            continue
        scatter.append({"slug": slug, "name": names.get(slug) or names.get(base(slug)) or base(slug).split("/")[-1],
                        "org": slug.split("/")[0], "intel": sc, "coding": coding.get(slug), "wprice": wprice.get(slug), "cpr_cents": cpr.get(slug)})
    out["scatter"] = scatter
    out["apps"] = [{"name": (a.get("app") or {}).get("title") or (a.get("app") or {}).get("name") or str(a.get("app_id")),
                    "tokens": float(a.get("total_tokens") or 0), "categories": (a.get("app") or {}).get("categories", [])}
                   for a in (apps.get("week") or [])[:15]]
    # ---- daily snapshot -> archive
    tot = sum(r["tokens"] for r in rows)
    wp = [(r["tokens"], r["wprice"]) for r in rows if r["wprice"]]
    cp = [(r["requests"] or 0, r["cpr_cents"]) for r in rows if r["cpr_cents"]]
    # list-price blends (input and output tokens at each model's listed prices), comparable with Ramp's blended price
    def blend(rs):
        rs = [r for r in rs if r["price_in"] is not None and r["price_out"] is not None and r["prompt"] is not None and r["completion"] is not None]
        t = sum(r["prompt"] + r["completion"] for r in rs)
        return sum(r["prompt"] * r["price_in"] + r["completion"] * r["price_out"] for r in rs) / t if t else None
    co = [r for r in rows if r["price_out"] is not None and r["completion"]]
    prices_now = {"blended_list_price": blend(rows), "blended_list_price_openai_anthropic": blend([r for r in rows if r["org"] in ("openai", "anthropic")]),
                  "blended_list_price_openai": blend([r for r in rows if r["org"] == "openai"]), "blended_list_price_anthropic": blend([r for r in rows if r["org"] == "anthropic"]),
                  "usage_weighted_output_price": sum(r["completion"] * r["price_out"] for r in co) / sum(r["completion"] for r in co) if co else None}
    out["prices_now"] = prices_now
    frontier = max((s["intel"] for s in scatter), default=None)
    near = [s["wprice"] for s in scatter if frontier is not None and s["intel"] >= frontier - 5]
    snap = {"date": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "week_ending": out.get("week_date"),
            "top20_weekly_tokens": tot,
            "usage_weighted_input_price": sum(t * p for t, p in wp) / sum(t for t, _ in wp) if wp else None,
            "request_weighted_cost_per_request_cents": sum(n * c for n, c in cp) / sum(n for n, _ in cp) if cp and sum(n for n, _ in cp) else None,
            "frontier_intelligence": frontier,
            "cheapest_near_frontier_price": min(near) if near else None, **prices_now}
    ARCH.mkdir(exist_ok=True)
    pd.DataFrame([snap]).pipe(_append, ARCH / "ai_openrouter_daily.csv", ["date"])
    if rows:
        pd.DataFrame([{"week_ending": r["date"], "slug": r["slug"], "org": r["org"], "tokens": r["tokens"]} for r in rows]) \
          .pipe(_append, ARCH / "ai_models_weekly.csv", ["week_ending", "slug"])
    hist = pd.read_csv(ARCH / "ai_openrouter_daily.csv")
    out["history"] = hist.astype(object).where(hist.notna(), None).to_dict(orient="list")
    wk = pd.read_csv(ARCH / "ai_models_weekly.csv") if (ARCH / "ai_models_weekly.csv").exists() else pd.DataFrame()
    if len(wk):
        by = wk.groupby(["week_ending", "org"])["tokens"].sum().unstack(fill_value=0)
        out["weekly_by_org"] = {"weeks": list(by.index), "orgs": {o: [float(v) for v in by[o]] for o in by.columns}}
    return out


def _append(df: pd.DataFrame, path, keys):
    if path.exists():
        old = pd.read_csv(path)
        df = pd.concat([old, df]).drop_duplicates(subset=keys, keep="last")
    df.sort_values(keys).to_csv(path, index=False)


def _zip_csv(z: zipfile.ZipFile, name: str) -> pd.DataFrame:
    return pd.read_csv(io.BytesIO(z.read(name)))


def epoch(notes: list) -> dict:
    out = {}
    try:
        z = zipfile.ZipFile(io.BytesIO(_get(EPOCH.format(f="ai_companies.zip")).content))
        rev = _zip_csv(z, "ai_companies_revenue_reports.csv")
        rev = rev[(rev["Scope"] == "Full company")].dropna(subset=["Date", "Annualized revenue (USD)"])
        out["revenue"] = {c: [[d, float(v)] for d, v in sorted(zip(g["Date"], g["Annualized revenue (USD)"]))]
                          for c, g in rev.groupby("Company") if len(g) >= 3}
        use = _zip_csv(z, "ai_companies_usage_reports.csv").dropna(subset=["Date", "Daily tokens"])
        out["daily_tokens"] = [{"company": c, "product": p, "date": d, "tokens": float(t)}
                               for c, p, d, t in use[["Company", "Product", "Date", "Daily tokens"]].itertuples(index=False, name=None)]
    except Exception as e:
        notes.append(f"Epoch companies: {type(e).__name__}")
    try:
        z = zipfile.ZipFile(io.BytesIO(_get(EPOCH.format(f="data_centers/data_centers.zip")).content))
        t = _zip_csv(z, "data_center_timelines.csv").dropna(subset=["Date", "Power (MW)"])
        t["Date"] = pd.to_datetime(t["Date"], errors="coerce")
        t = t.dropna(subset=["Date"]).sort_values("Date")
        today = pd.Timestamp.today().normalize()
        grid = list(pd.date_range("2022-01-01", t["Date"].max(), freq="QS"))
        built, planned = [], []
        for d in grid + [today]:
            last = t[t["Date"] <= d].groupby("Data center")["Power (MW)"].last()
            (built if d <= today else planned).append([d.strftime("%Y-%m-%d"), float(last.sum())])
        built.sort()
        out["dc_power"] = built            # capacity Epoch has observed as built, to today
        out["dc_planned"] = planned        # announced / projected capacity after today
        out["dc_count"] = int(t["Data center"].nunique())
    except Exception as e:
        notes.append(f"Epoch data centres: {type(e).__name__}")
    try:
        z = zipfile.ZipFile(io.BytesIO(_get(EPOCH.format(f="ai_chip_sales.zip")).content))
        c = _zip_csv(z, "cumulative_timelines_by_designer.csv").dropna(subset=["End date"])
        col = "Compute estimate in H100e (median)"
        out["chips"] = {m: [[d, float(v)] for d, v in sorted(zip(g["End date"], g[col]))] for m, g in c.groupby("Chip manufacturer")}
    except Exception as e:
        notes.append(f"Epoch chips: {type(e).__name__}")
    try:
        z = zipfile.ZipFile(io.BytesIO(_get(EPOCH.format(f="benchmark_data.zip")).content))
        for key, fname in (("gpqa", "gpqa_diamond.csv"), ("swe", "swe_bench_verified.csv")):
            b = _zip_csv(z, fname).dropna(subset=["Release date", "mean_score"]).sort_values("Release date")
            best, pts = -1.0, []
            for model, score, date, org in b[["Model version", "mean_score", "Release date", "Organization"]].itertuples(index=False, name=None):
                if score > best:
                    best = score
                    pts.append([str(date), round(float(score) * 100, 1), str(model), str(org)])
            out[key] = pts
    except Exception as e:
        notes.append(f"Epoch benchmarks: {type(e).__name__}")
    return out


def build_ai(status: dict) -> None:
    notes: list[str] = []
    print("AI indicators:")
    data = {"updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}
    data["openrouter"] = openrouter(notes)
    data["epoch"] = epoch(notes)
    data["notes"] = notes
    status["AI_OPENROUTER"] = "ok" if data["openrouter"].get("week") else "missing"
    status["AI_EPOCH"] = "ok" if data["epoch"].get("revenue") else "missing"
    for n in notes:
        print("      " + n)
    print(f"  AI_OPENROUTER {status['AI_OPENROUTER']}   AI_EPOCH {status['AI_EPOCH']}")
    write("ai.json", data)


if __name__ == "__main__":
    build_ai({})
