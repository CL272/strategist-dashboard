"""
Futures positioning from the CFTC Commitments of Traders reports (public API, no key; weekly, as of Tuesday,
published Friday).

  Financial futures (Traders in Financial Futures report): leveraged funds (hedge funds / CTAs) and
  asset managers (pensions, mutual funds, insurers).
  Commodities (Disaggregated report): managed money (hedge funds / CTAs).

Net position = longs - shorts, shown as % of open interest so contracts of different size compare.
Writes docs/data/positioning.json.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd

from fetch import get, load_existing, write

API = "https://publicreporting.cftc.gov/resource/{ds}.json"
TFF, DIS = "gpe5-46if", "72hh-3qpy"
START = "2010-01-01"

# (id, label, group, code, dataset, price series id on the dashboard, price is inverse of contract?)
MARKETS = [
    ("ES", "S&P 500 E-mini", "Equities", "13874A", TFF, "SPX", False),
    ("NQ", "Nasdaq-100 E-mini", "Equities", "209742", TFF, "NDX", False),
    ("RTY", "Russell 2000 E-mini", "Equities", "239742", TFF, "RTY", False),
    ("TU", "2Y Treasury note", "Rates", "042601", TFF, "UST2Y", True),
    ("FV", "5Y Treasury note", "Rates", "044601", TFF, None, False),
    ("TY", "10Y Treasury note", "Rates", "043602", TFF, "UST10Y", True),
    ("US", "Treasury bond", "Rates", "020601", TFF, "UST30Y", True),
    ("UB", "Ultra Treasury bond", "Rates", "020604", TFF, "UST30Y", True),
    ("DX", "US dollar index", "FX", "098662", TFF, "DXY", False),
    ("EC", "Euro", "FX", "099741", TFF, "EURUSD", False),
    ("JY", "Japanese yen", "FX", "097741", TFF, "USDJPY", True),
    ("BP", "British pound", "FX", "096742", TFF, "GBPUSD", False),
    ("AD", "Australian dollar", "FX", "232741", TFF, "AUDUSD", False),
    ("CD", "Canadian dollar", "FX", "090741", TFF, None, False),
    ("MP", "Mexican peso", "FX", "095741", TFF, None, False),
    ("BTC", "Bitcoin (CME)", "Crypto", "133741", TFF, "BTC", False),
    ("VX", "VIX futures", "Volatility", "1170E1", TFF, "VIX", False),
    ("GC", "Gold", "Commodities", "088691", DIS, "GOLD", False),
    ("SI", "Silver", "Commodities", "084691", DIS, "SILVER", False),
    ("HG", "Copper", "Commodities", "085692", DIS, "COPPER", False),
    ("CL", "WTI crude oil", "Commodities", "067651", DIS, "WTI", False),
    ("NG", "Natural gas", "Commodities", "023651", DIS, "NATGAS", False),
]
COLS = {
    TFF: ["open_interest_all", "lev_money_positions_long", "lev_money_positions_short", "asset_mgr_positions_long", "asset_mgr_positions_short",
          "dealer_positions_long_all", "dealer_positions_short_all"],
    DIS: ["open_interest_all", "m_money_positions_long_all", "m_money_positions_short_all", "prod_merc_positions_long", "prod_merc_positions_short"],
}


def fetch_ds(ds: str, codes: list[str]) -> pd.DataFrame | None:
    where = f"cftc_contract_market_code in ({','.join(repr(c) for c in codes)}) AND report_date_as_yyyy_mm_dd >= '{START}'"
    r = get(API.format(ds=ds), {"$where": where, "$limit": 50000, "$order": "report_date_as_yyyy_mm_dd",
                                "$select": ",".join(["cftc_contract_market_code", "report_date_as_yyyy_mm_dd"] + COLS[ds])})
    if r is None:
        return None
    df = pd.DataFrame(r.json())
    if df.empty:
        return None
    df["date"] = pd.to_datetime(df["report_date_as_yyyy_mm_dd"]).dt.tz_localize(None)
    for c in COLS[ds]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def build_positioning(status: dict) -> None:
    print("Positioning (CFTC):")
    old = load_existing("positioning.json").get("markets", {})
    frames = {ds: fetch_ds(ds, [m[3] for m in MARKETS if m[4] == ds]) for ds in (TFF, DIS)}
    out = {}
    for mid, label, group, code, ds, price, inverse in MARKETS:
        df = frames.get(ds)
        g = df[df["cftc_contract_market_code"] == code].sort_values("date") if df is not None else None
        if g is None or g.empty:
            status[f"COT_{mid}"] = "stale (kept previous)" if mid in old else "missing"
            if mid in old:
                out[mid] = old[mid]
            continue
        oi = g["open_interest_all"]
        rec = {"label": label, "group": group, "code": code, "price": price, "inverse": inverse,
               "report": "Traders in Financial Futures" if ds == TFF else "Disaggregated",
               "d": ((g["date"] - pd.Timestamp("1970-01-01")) // pd.Timedelta(days=1)).astype(int).tolist(),
               "oi": oi.astype(float).round(0).tolist()}
        if ds == TFF:
            rec["spec"] = ((g["lev_money_positions_long"] - g["lev_money_positions_short"]) / oi * 100).round(2).tolist()
            rec["spec_label"] = "Leveraged funds"
            rec["alt"] = ((g["asset_mgr_positions_long"] - g["asset_mgr_positions_short"]) / oi * 100).round(2).tolist()
            rec["alt_label"] = "Asset managers"
        else:
            rec["spec"] = ((g["m_money_positions_long_all"] - g["m_money_positions_short_all"]) / oi * 100).round(2).tolist()
            rec["spec_label"] = "Managed money"
            rec["alt"] = ((g["prod_merc_positions_long"] - g["prod_merc_positions_short"]) / oi * 100).round(2).tolist()
            rec["alt_label"] = "Producers & merchants"
        out[mid] = rec
        status[f"COT_{mid}"] = "ok"
        print(f"  COT_{mid:<5} ok  {len(g)} weeks to {g['date'].iloc[-1]:%Y-%m-%d}")
    write("positioning.json", {"updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
                               "source": "CFTC Commitments of Traders (publicreporting.cftc.gov)", "markets": out})


if __name__ == "__main__":
    build_positioning({})
