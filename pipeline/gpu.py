"""
NVIDIA GPU rental prices.

  GetDeploying GPU price dataset (getdeploying.com/dataset/gpu-prices), CC BY 4.0: weekly min / median / max price per
  GPU-hour across 80+ cloud providers, by billing type (on-demand, spot, reservations). Archived in archive/ so history
  keeps growing. Credit: "GetDeploying (CC BY 4.0)".
  Vast.ai public pricing feed (storage.googleapis.com/vast-public-gpu-pricing/gpu-pricing-public.json): daily marketplace
  medians for about 90 days. Its licence allows display and citation with attribution but not bulk collection, so it
  is shown as published and never archived.
Writes docs/data/gpu.json (series, plus "_meta"). Isolated: a failure keeps the previous file and never raises the
data-health alert.
"""
from __future__ import annotations

import io
from datetime import datetime, timezone

import pandas as pd
import requests

from fetch import load_existing, merge_archive, pack, unpack, write

GD_URL = "https://getdeploying.com/dataset/gpu-prices/weekly.csv"
VAST_URL = "https://storage.googleapis.com/vast-public-gpu-pricing/gpu-pricing-public.json"
UA = {"User-Agent": "Mozilla/5.0 (compatible; dashboard data refresh)"}
GPUS = {"nvidia-h100": "H100", "nvidia-h200": "H200", "nvidia-b200": "B200", "nvidia-b300": "B300", "nvidia-gb200": "GB200", "nvidia-a100": "A100", "nvidia-l40s": "L40S"}
BILLING = {"ON_DEMAND": ("OD", "on-demand"), "RESERVATION_12_MONTH": ("R12", "12-month reserved"), "SPOT": ("SPOT", "spot")}
VAST = {"H100 SXM": "H100", "H200": "H200", "B200": "B200", "A100 SXM4": "A100"}


def getdeploying(old: dict) -> dict:
    r = requests.get(GD_URL, headers=UA, timeout=90)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text), parse_dates=["date"])
    out = {}
    for slug, name in GPUS.items():
        for bt, (code, lab) in BILLING.items():
            g = df[(df.gpu_slug == slug) & (df.billing_type == bt)]
            if bt == "RESERVATION_12_MONTH" and g.empty:
                g = df[(df.gpu_slug == slug) & (df.billing_type == "RESERVATION") & (df.reservation_months == 12)]
            if g.empty:
                continue
            g = g.groupby("date").agg(median=("median_price", "median"), providers=("provider_count", "max"))
            sid = f"GPU_{name}_{code}"
            s = merge_archive(sid, g["median"].astype(float), unpack(old[sid]) if sid in old else None)
            out[sid] = {"label": f"{name} rental, {lab} median", "group": "AI · Compute prices", "kind": "price", "unit": "USD per GPU-hour",
                        "source": "GetDeploying GPU price dataset (CC BY 4.0)", **pack(s)}
            if code == "OD":
                out[sid]["providers"] = int(g["providers"].iloc[-1])
    return out


def vast() -> dict:
    j = requests.get(VAST_URL, headers=UA, timeout=60).json()
    out = {}
    for item in (j.get("gpus") or {}).values():
        name = item.get("name")
        if name not in VAST or not item.get("daily"):
            continue
        s = pd.Series({pd.Timestamp(d["date"]): float(d["median"]) for d in item["daily"] if d.get("median") is not None}, dtype="float64").sort_index()
        if len(s) > 10:
            out[f"VAST_{VAST[name]}"] = {"label": f"{name} on Vast.ai marketplace, daily median", "group": "AI · Compute prices", "kind": "price",
                                         "unit": "USD per GPU-hour", "source": "Vast.ai public GPU pricing (display with attribution; not stored)", **pack(s)}
    return out


def build(status: dict) -> None:
    print("GPU rental prices")
    old = load_existing("gpu.json")
    out, errs = {}, {}
    for name, fn in (("GetDeploying", lambda: getdeploying(old)), ("Vast.ai", vast)):
        try:
            got = fn()
            if not got:
                raise RuntimeError("no rows")
            out.update(got)
            for k in got:
                status[k] = "ok"
        except Exception as e:   # each source on its own
            errs[name] = type(e).__name__
            pre = "GPU_" if name == "GetDeploying" else "VAST_"
            out.update({k: v for k, v in old.items() if k.startswith(pre)})
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    meta_old = old.get("_meta") or {}
    out["_meta"] = {"fetched_utc": now if not errs else meta_old.get("fetched_utc", now), "errors": errs}
    write("gpu.json", out)
    print(f"  {len(out) - 1} series" + (f"; failed: {errs}" if errs else ""))


if __name__ == "__main__":
    build({})
