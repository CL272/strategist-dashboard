"""
Weekly fund prices with dividends for the portfolio allocator (Design plan 4, Step 1; owner's approval 25 Nov 2026).

Allocation → Portfolio and Add a fund work out tracking error from weekly returns. This module writes, for each fund in
FUNDS and each ticker in watchlist.txt, the last dividend-adjusted close of every week ending Friday, from 2005 or the
fund's first day (Yahoo Finance chart API, adjusted close: dividends and splits included). Prices quoted in pence (GBp)
are divided by 100 and stored as GBP. `thin` = the share of the last three years' weeks with no price change: a thinly
traded fund (the Bursa and some Singapore funds) understates its own volatility and the tracking error it causes.

Design plan 6, Step 1 (27 Nov 2026): 185 building blocks in ten groups; each row says what the block tracks ("MSCI Japan"),
shown first, with the fund's own name, ticker, currency and place of listing second.

Writes docs/data/funds.json = {"_meta": {...}, "funds": {symbol: {name, short, ccy, cls, grp, alias, place, src, d, v, thin}}}.
Isolated: a fund that fails keeps its previous history, and the file is written even if some fail.
"""
from __future__ import annotations

import time
from datetime import datetime, timezone

import pandas as pd
import requests

from fetch import EPOCH, get, load_existing, sig, write

START = "2005-01-01"
GAP = 0.25   # seconds between calls
THIN_YEARS = 3
# Design plan 6, Step 1 (owner's approval 27 Nov 2026): one row per building block: symbol, what it tracks (shown first), asset
# class (for the mix by asset class), group (the browse chips), search words (a country's other names). Every symbol was
# read on Yahoo on 26 Nov 2026 (prices, currency, first date): see DESIGN_PLAN_6.md. Rule for additions: one fund per
# index per place of listing, at least three years of prices on Yahoo; anything else can go in watchlist.txt.
GROUPS = ['World', 'Regions', 'United States', 'US sectors', 'Asia Pacific', 'Europe', 'Americas, Middle East and Africa', 'Bonds', 'Gold, cash and property', 'Other']
FUNDS = [
    # World
    ('ACWI', 'MSCI ACWI', 'Equities', 'World', 'world global all country'),
    ('VT', 'FTSE Global All Cap', 'Equities', 'World', 'world global'),
    ('URTH', 'MSCI World', 'Equities', 'World', 'world global developed'),
    ('VWRA.L', 'FTSE All-World', 'Equities', 'World', 'world global'),
    ('IWDA.L', 'MSCI World', 'Equities', 'World', 'world global developed'),
    ('ISAC.L', 'MSCI ACWI', 'Equities', 'World', 'world global all country'),
    ('ACWX', 'MSCI ACWI ex USA', 'Equities', 'World', 'world global international ex us'),
    # Regions
    ('EFA', 'MSCI EAFE (developed ex US and Canada)', 'Equities', 'Regions', 'developed international europe australasia far east'),
    ('VEA', 'FTSE Developed ex US', 'Equities', 'Regions', 'developed international'),
    ('SCZ', 'MSCI EAFE Small Cap', 'Equities', 'Regions', 'developed international small'),
    ('EEM', 'MSCI Emerging Markets', 'Equities', 'Regions', 'em emerging'),
    ('VWO', 'FTSE Emerging Markets', 'Equities', 'Regions', 'em emerging'),
    ('EIMI.L', 'MSCI Emerging Markets IMI', 'Equities', 'Regions', 'em emerging'),
    ('VFEA.L', 'FTSE Emerging Markets', 'Equities', 'Regions', 'em emerging'),
    ('EMXC', 'MSCI Emerging Markets ex China', 'Equities', 'Regions', 'em emerging'),
    ('EEMS', 'MSCI Emerging Markets Small Cap', 'Equities', 'Regions', 'em emerging small'),
    ('EEMA', 'MSCI Emerging Markets Asia', 'Equities', 'Regions', 'em emerging asia'),
    ('CEMA.L', 'MSCI Emerging Markets Asia', 'Equities', 'Regions', 'em emerging asia'),
    ('AAXJ', 'MSCI Asia ex Japan', 'Equities', 'Regions', 'asia axj'),
    ('IDFF.L', 'MSCI AC Far East ex Japan', 'Equities', 'Regions', 'asia far east axj'),
    ('AIA', 'S&P Asia 50', 'Equities', 'Regions', 'asia'),
    ('EPP', 'MSCI Pacific ex Japan', 'Equities', 'Regions', 'asia pacific'),
    ('CPXJ.L', 'MSCI Pacific ex Japan', 'Equities', 'Regions', 'asia pacific'),
    ('VPL', 'FTSE Developed Asia Pacific', 'Equities', 'Regions', 'asia pacific japan'),
    ('ASEA', 'FTSE Southeast Asia 40', 'Equities', 'Regions', 'asean south east asia'),
    ('0825EA.KL', 'MSCI South East Asia Islamic Dividend', 'Equities', 'Regions', 'asean south east asia shariah islamic'),
    ('IEUR', 'MSCI Europe IMI', 'Equities', 'Regions', 'europe'),
    ('VGK', 'FTSE Developed Europe', 'Equities', 'Regions', 'europe'),
    ('VEUA.L', 'FTSE Developed Europe', 'Equities', 'Regions', 'europe'),
    ('EZU', 'MSCI Eurozone', 'Equities', 'Regions', 'europe euro area emu'),
    ('CEU1.L', 'MSCI EMU (eurozone)', 'Equities', 'Regions', 'europe euro area emu eurozone'),
    ('FEZ', 'Euro Stoxx 50', 'Equities', 'Regions', 'europe eurozone sx5e'),
    ('CSX5.L', 'Euro Stoxx 50', 'Equities', 'Regions', 'europe eurozone sx5e'),
    ('ILF', 'S&P Latin America 40', 'Equities', 'Regions', 'latin america latam'),
    ('AFK', 'Africa (MVIS GDP Africa)', 'Equities', 'Regions', 'africa'),
    # United States
    ('SPY', 'S&P 500', 'Equities', 'United States', 'us usa america spx'),
    ('CSPX.L', 'S&P 500', 'Equities', 'United States', 'us usa america spx'),
    ('QQQ', 'Nasdaq 100', 'Equities', 'United States', 'us usa america tech ndx'),
    ('CNDX.L', 'Nasdaq 100', 'Equities', 'United States', 'us usa america tech ndx'),
    ('PBUS', 'MSCI USA', 'Equities', 'United States', 'us usa america'),
    ('CSUS.L', 'MSCI USA', 'Equities', 'United States', 'us usa america'),
    ('VTI', 'CRSP US Total Market', 'Equities', 'United States', 'us usa america total'),
    ('DIA', 'Dow Jones Industrial Average', 'Equities', 'United States', 'us usa america dow'),
    ('IWM', 'Russell 2000', 'Equities', 'United States', 'us usa america small cap'),
    ('MDY', 'S&P MidCap 400', 'Equities', 'United States', 'us usa america mid cap'),
    ('IJR', 'S&P SmallCap 600', 'Equities', 'United States', 'us usa america small cap'),
    ('RSP', 'S&P 500 Equal Weight', 'Equities', 'United States', 'us usa america'),
    ('IWF', 'Russell 1000 Growth', 'Equities', 'United States', 'us usa america growth style'),
    ('IWD', 'Russell 1000 Value', 'Equities', 'United States', 'us usa america value style'),
    ('MTUM', 'MSCI USA Momentum', 'Equities', 'United States', 'us usa america factor'),
    ('QUAL', 'MSCI USA Quality', 'Equities', 'United States', 'us usa america factor'),
    ('USMV', 'MSCI USA Minimum Volatility', 'Equities', 'United States', 'us usa america factor low vol'),
    ('VYM', 'FTSE High Dividend Yield (US)', 'Equities', 'United States', 'us usa america dividend income'),
    ('0827EA.KL', 'Dow Jones US Titans 50', 'Equities', 'United States', 'us usa america'),
    # US sectors
    ('XLK', 'S&P 500 Technology', 'Equities', 'US sectors', 'us sector tech'),
    ('XLF', 'S&P 500 Financials', 'Equities', 'US sectors', 'us sector banks'),
    ('XLV', 'S&P 500 Health Care', 'Equities', 'US sectors', 'us sector healthcare pharma'),
    ('XLE', 'S&P 500 Energy', 'Equities', 'US sectors', 'us sector oil'),
    ('XLI', 'S&P 500 Industrials', 'Equities', 'US sectors', 'us sector'),
    ('XLY', 'S&P 500 Consumer Discretionary', 'Equities', 'US sectors', 'us sector consumer'),
    ('XLP', 'S&P 500 Consumer Staples', 'Equities', 'US sectors', 'us sector consumer'),
    ('XLU', 'S&P 500 Utilities', 'Equities', 'US sectors', 'us sector'),
    ('XLB', 'S&P 500 Materials', 'Equities', 'US sectors', 'us sector'),
    ('XLRE', 'S&P 500 Real Estate', 'Equities', 'US sectors', 'us sector reits property'),
    ('XLC', 'S&P 500 Communication Services', 'Equities', 'US sectors', 'us sector media'),
    ('SOXX', 'US semiconductors (NYSE Semiconductor)', 'Equities', 'US sectors', 'us sector chips semis'),
    # Asia Pacific
    ('EWJ', 'MSCI Japan', 'Equities', 'Asia Pacific', 'japan'),
    ('IJPA.L', 'MSCI Japan IMI', 'Equities', 'Asia Pacific', 'japan'),
    ('DXJ', 'Japan, yen-hedged (WisdomTree)', 'Equities', 'Asia Pacific', 'japan hedged'),
    ('1306.T', 'TOPIX', 'Equities', 'Asia Pacific', 'japan'),
    ('1321.T', 'Nikkei 225', 'Equities', 'Asia Pacific', 'japan'),
    ('MCHI', 'MSCI China', 'Equities', 'Asia Pacific', 'china'),
    ('HMCD.L', 'MSCI China', 'Equities', 'Asia Pacific', 'china'),
    ('FXI', 'FTSE China 50', 'Equities', 'Asia Pacific', 'china large cap'),
    ('0823EA.KL', 'FTSE China 50', 'Equities', 'Asia Pacific', 'china'),
    ('ASHR', 'CSI 300 (China A-shares)', 'Equities', 'Asia Pacific', 'china onshore a-shares'),
    ('3188.HK', 'CSI 300 (China A-shares)', 'Equities', 'Asia Pacific', 'china onshore a-shares'),
    ('CNYA.L', 'MSCI China A', 'Equities', 'Asia Pacific', 'china onshore a-shares'),
    ('KWEB', 'China internet (CSI Overseas)', 'Equities', 'Asia Pacific', 'china tech'),
    ('EWH', 'MSCI Hong Kong', 'Equities', 'Asia Pacific', 'hong kong hk'),
    ('2800.HK', 'Hang Seng Index', 'Equities', 'Asia Pacific', 'hong kong hk hsi'),
    ('3033.HK', 'Hang Seng TECH', 'Equities', 'Asia Pacific', 'hong kong hk china tech'),
    ('HST.SI', 'Hang Seng TECH', 'Equities', 'Asia Pacific', 'hong kong hk china tech'),
    ('EWY', 'MSCI South Korea', 'Equities', 'Asia Pacific', 'korea'),
    ('CSKR.L', 'MSCI Korea', 'Equities', 'Asia Pacific', 'south korea'),
    ('069500.KS', 'KOSPI 200', 'Equities', 'Asia Pacific', 'korea south korea'),
    ('EWT', 'MSCI Taiwan', 'Equities', 'Asia Pacific', 'taiwan'),
    ('IDTW.L', 'MSCI Taiwan', 'Equities', 'Asia Pacific', 'taiwan'),
    ('0050.TW', 'FTSE TWSE Taiwan 50', 'Equities', 'Asia Pacific', 'taiwan'),
    ('INDA', 'MSCI India', 'Equities', 'Asia Pacific', 'india'),
    ('NDIA.L', 'MSCI India', 'Equities', 'Asia Pacific', 'india'),
    ('SMIN', 'MSCI India Small Cap', 'Equities', 'Asia Pacific', 'india small'),
    ('NIFTYBEES.NS', 'Nifty 50', 'Equities', 'Asia Pacific', 'india'),
    ('EWA', 'MSCI Australia', 'Equities', 'Asia Pacific', 'australia'),
    ('STW.AX', 'S&P/ASX 200', 'Equities', 'Asia Pacific', 'australia'),
    ('ENZL', 'MSCI New Zealand', 'Equities', 'Asia Pacific', 'new zealand nz'),
    ('EWS', 'MSCI Singapore', 'Equities', 'Asia Pacific', 'singapore sg'),
    ('ES3.SI', 'Straits Times Index', 'Equities', 'Asia Pacific', 'singapore sti sg'),
    ('G3B.SI', 'Straits Times Index', 'Equities', 'Asia Pacific', 'singapore sti sg'),
    ('EWM', 'MSCI Malaysia', 'Equities', 'Asia Pacific', 'malaysia my'),
    ('XCS3.L', 'MSCI Malaysia', 'Equities', 'Asia Pacific', 'malaysia my'),
    ('0820EA.KL', 'FBM KLCI', 'Equities', 'Asia Pacific', 'malaysia my klci'),
    ('0821EA.KL', 'Dow Jones Islamic Malaysia Titans 25', 'Equities', 'Asia Pacific', 'malaysia shariah islamic'),
    ('0824EA.KL', 'MSCI Malaysia Islamic Dividend', 'Equities', 'Asia Pacific', 'malaysia shariah islamic dividend'),
    ('EIDO', 'MSCI Indonesia', 'Equities', 'Asia Pacific', 'indonesia'),
    ('HIDD.L', 'MSCI Indonesia', 'Equities', 'Asia Pacific', 'indonesia'),
    ('XIIT.JK', 'IDX30', 'Equities', 'Asia Pacific', 'indonesia'),
    ('THD', 'MSCI Thailand', 'Equities', 'Asia Pacific', 'thailand'),
    ('XCS4.L', 'MSCI Thailand', 'Equities', 'Asia Pacific', 'thailand'),
    ('TDEX.BK', 'SET50', 'Equities', 'Asia Pacific', 'thailand'),
    ('EPHE', 'MSCI Philippines', 'Equities', 'Asia Pacific', 'philippines'),
    ('VNM', 'Vietnam (MarketVector)', 'Equities', 'Asia Pacific', 'vietnam'),
    ('XVTD.L', 'FTSE Vietnam', 'Equities', 'Asia Pacific', 'vietnam'),
    # Europe
    ('EWU', 'MSCI United Kingdom', 'Equities', 'Europe', 'uk britain united kingdom england'),
    ('CUKX.L', 'FTSE 100', 'Equities', 'Europe', 'uk britain united kingdom'),
    ('EWG', 'MSCI Germany', 'Equities', 'Europe', 'germany'),
    ('EXS1.DE', 'DAX', 'Equities', 'Europe', 'germany'),
    ('EWQ', 'MSCI France', 'Equities', 'Europe', 'france'),
    ('EWI', 'MSCI Italy', 'Equities', 'Europe', 'italy'),
    ('EWP', 'MSCI Spain', 'Equities', 'Europe', 'spain'),
    ('EWL', 'MSCI Switzerland', 'Equities', 'Europe', 'switzerland swiss'),
    ('EWN', 'MSCI Netherlands', 'Equities', 'Europe', 'netherlands holland dutch'),
    ('EWD', 'MSCI Sweden', 'Equities', 'Europe', 'sweden nordic'),
    ('EDEN', 'MSCI Denmark', 'Equities', 'Europe', 'denmark nordic'),
    ('EFNL', 'MSCI Finland', 'Equities', 'Europe', 'finland nordic'),
    ('ENOR', 'MSCI Norway', 'Equities', 'Europe', 'norway nordic'),
    ('EWK', 'MSCI Belgium', 'Equities', 'Europe', 'belgium'),
    ('EWO', 'MSCI Austria', 'Equities', 'Europe', 'austria'),
    ('EIRL', 'MSCI Ireland', 'Equities', 'Europe', 'ireland'),
    ('EPOL', 'MSCI Poland', 'Equities', 'Europe', 'poland'),
    ('GREK', 'MSCI Greece', 'Equities', 'Europe', 'greece'),
    ('TUR', 'MSCI Turkey', 'Equities', 'Europe', 'turkey turkiye'),
    # Americas, Middle East and Africa
    ('EWC', 'MSCI Canada', 'Equities', 'Americas, Middle East and Africa', 'canada'),
    ('EWW', 'MSCI Mexico', 'Equities', 'Americas, Middle East and Africa', 'mexico latin america'),
    ('EWZ', 'MSCI Brazil', 'Equities', 'Americas, Middle East and Africa', 'brazil latin america'),
    ('IDBZ.L', 'MSCI Brazil', 'Equities', 'Americas, Middle East and Africa', 'brazil latin america'),
    ('ECH', 'MSCI Chile', 'Equities', 'Americas, Middle East and Africa', 'chile latin america'),
    ('COLO', 'MSCI Colombia', 'Equities', 'Americas, Middle East and Africa', 'colombia latin america'),
    ('EPU', 'MSCI Peru', 'Equities', 'Americas, Middle East and Africa', 'peru latin america'),
    ('ARGT', 'MSCI Argentina', 'Equities', 'Americas, Middle East and Africa', 'argentina latin america'),
    ('EZA', 'MSCI South Africa', 'Equities', 'Americas, Middle East and Africa', 'south africa'),
    ('EIS', 'MSCI Israel', 'Equities', 'Americas, Middle East and Africa', 'israel middle east'),
    ('KSA', 'MSCI Saudi Arabia', 'Equities', 'Americas, Middle East and Africa', 'saudi arabia middle east gulf'),
    ('UAE', 'MSCI UAE', 'Equities', 'Americas, Middle East and Africa', 'uae emirates dubai middle east gulf'),
    ('QAT', 'MSCI Qatar', 'Equities', 'Americas, Middle East and Africa', 'qatar middle east gulf'),
    ('KWT', 'MSCI Kuwait', 'Equities', 'Americas, Middle East and Africa', 'kuwait middle east gulf'),
    # Bonds
    ('AGG', 'US aggregate bonds', 'Bonds', 'Bonds', 'us usa bonds'),
    ('BND', 'US total bond market', 'Bonds', 'Bonds', 'us usa bonds'),
    ('BNDW', 'Global aggregate bonds, dollar-hedged', 'Bonds', 'Bonds', 'world global bonds'),
    ('BNDX', 'Global bonds ex US, dollar-hedged', 'Bonds', 'Bonds', 'world global international bonds'),
    ('AGGU.L', 'Global aggregate bonds, dollar-hedged', 'Bonds', 'Bonds', 'world global bonds'),
    ('IGLA.L', 'Global government bonds', 'Bonds', 'Bonds', 'world global treasuries sovereign'),
    ('BWX', 'Global government bonds ex US', 'Bonds', 'Bonds', 'world international treasuries sovereign'),
    ('IGOV', 'International government bonds', 'Bonds', 'Bonds', 'world international treasuries sovereign'),
    ('SHY', 'US Treasuries 1–3 years', 'Bonds', 'Bonds', 'us treasury short'),
    ('IBTA.L', 'US Treasuries 1–3 years', 'Bonds', 'Bonds', 'us treasury short'),
    ('IEF', 'US Treasuries 7–10 years', 'Bonds', 'Bonds', 'us treasury'),
    ('TLT', 'US Treasuries 20+ years', 'Bonds', 'Bonds', 'us treasury long duration'),
    ('IDTL.L', 'US Treasuries 20+ years', 'Bonds', 'Bonds', 'us treasury long duration'),
    ('TIP', 'US inflation-linked Treasuries (TIPS)', 'Bonds', 'Bonds', 'us treasury inflation linked'),
    ('FLOA.L', 'US floating-rate notes', 'Bonds', 'Bonds', 'us floating rate frn'),
    ('ERNA.L', 'US dollar ultrashort bonds', 'Bonds', 'Bonds', 'us short'),
    ('LQD', 'US investment-grade corporate bonds', 'Bonds', 'Bonds', 'us credit corporate ig'),
    ('LQDA.L', 'US investment-grade corporate bonds', 'Bonds', 'Bonds', 'us credit corporate ig'),
    ('HYG', 'US high-yield bonds', 'Bonds', 'Bonds', 'us credit high yield junk'),
    ('IHYA.L', 'US high-yield bonds', 'Bonds', 'Bonds', 'us credit high yield junk'),
    ('EMB', 'EM dollar government bonds (JPM EMBI)', 'Bonds', 'Bonds', 'emerging markets em sovereign'),
    ('JPEA.L', 'EM dollar government bonds (JPM EMBI)', 'Bonds', 'Bonds', 'emerging markets em sovereign'),
    ('VWOB', 'EM dollar government bonds (Bloomberg)', 'Bonds', 'Bonds', 'emerging markets em sovereign'),
    ('EMLC', 'EM local-currency government bonds', 'Bonds', 'Bonds', 'emerging markets em local currency'),
    ('CEMB', 'EM dollar corporate bonds', 'Bonds', 'Bonds', 'emerging markets em credit corporate'),
    ('N6M.SI', 'Asia dollar credit', 'Bonds', 'Bonds', 'asia credit corporate'),
    ('IGLT.L', 'UK gilts', 'Bonds', 'Bonds', 'uk britain government gilts'),
    ('CBON', 'China onshore bonds', 'Bonds', 'Bonds', 'china'),
    ('2829.HK', 'China government bonds', 'Bonds', 'Bonds', 'china'),
    ('A35.SI', 'Singapore government bonds (ABF)', 'Bonds', 'Bonds', 'singapore sgs'),
    ('MBH.SI', 'Singapore dollar corporate bonds', 'Bonds', 'Bonds', 'singapore credit'),
    ('0800EA.KL', 'Malaysian government bonds (ABF)', 'Bonds', 'Bonds', 'malaysia mgs'),
    # Gold, cash and property
    ('BIL', 'US Treasury bills 1–3 months', 'Cash-like', 'Gold, cash and property', 'cash t-bills money market'),
    ('IB01.L', 'US Treasury bills 0–1 year', 'Cash-like', 'Gold, cash and property', 'cash t-bills money market'),
    ('GLD', 'Gold', 'Gold', 'Gold, cash and property', 'gold bullion'),
    ('IGLN.L', 'Gold', 'Gold', 'Gold, cash and property', 'gold bullion physical'),
    ('VNQ', 'US real estate (REITs)', 'Property', 'Gold, cash and property', 'us reits property'),
    ('IWDP.L', 'Developed-market property', 'Property', 'Gold, cash and property', 'world global reits property'),
    ('CLR.SI', 'Singapore REITs', 'Property', 'Gold, cash and property', 'singapore s-reits property'),
]

# where a fund is listed, from its Yahoo suffix: the same index listed in London closes hours before New York, so the place
# changes weekly returns a little and is shown with every block
PLACE = {"": "New York", ".L": "London (UCITS)", ".DE": "Frankfurt", ".HK": "Hong Kong", ".SI": "Singapore", ".KL": "Bursa Malaysia",
         ".T": "Tokyo", ".KS": "Seoul", ".TW": "Taipei", ".NS": "Mumbai", ".AX": "Sydney", ".BK": "Bangkok", ".JK": "Jakarta"}


def place_of(sym: str) -> str:
    suf = sym[sym.rfind("."):] if "." in sym else ""
    return PLACE.get(suf, suf.lstrip(".") or "New York")


def check_funds() -> None:
    """Refuse to run with a duplicate symbol or a group that is not in GROUPS."""
    seen, bad = set(), []
    for sym, _, _, grp, _ in FUNDS:
        if sym in seen:
            bad.append(f"duplicate {sym}")
        seen.add(sym)
        if grp not in GROUPS:
            bad.append(f"{sym}: unknown group {grp!r}")
    if bad:
        raise ValueError("funds.py FUNDS: " + "; ".join(bad))


def fetch_fund(sym: str) -> dict | None:
    """Daily adjusted closes -> the last close of each week ending Friday, with the fund's name and currency."""
    r = get(f"https://query1.finance.yahoo.com/v8/finance/chart/{requests.utils.quote(sym)}",
            {"period1": int(pd.Timestamp(START).timestamp()), "period2": int(time.time()), "interval": "1d", "includeAdjustedClose": "true"})
    if r is None:
        return None
    res = (r.json().get("chart") or {}).get("result")
    if not res:
        return None
    res = res[0]
    meta, ts = res.get("meta") or {}, res.get("timestamp") or []
    adj = ((res.get("indicators") or {}).get("adjclose") or [{}])[0].get("adjclose") or []
    if not ts or not adj:
        return None
    tz = meta.get("exchangeTimezoneName", "UTC")
    idx = pd.to_datetime(ts, unit="s", utc=True).tz_convert(tz).tz_localize(None).normalize()
    s = pd.Series(adj, index=idx, dtype="float64").dropna()
    s = s[s > 0]
    ccy = meta.get("currency") or ""
    if ccy == "GBp":   # London quotes in pence
        s, ccy = s / 100, "GBP"
    w = s.groupby(s.index.to_period("W-FRI")).tail(1)   # the last close of each week ending Friday, dated the day it was made (never a future Friday)
    if len(w) < 60:
        return None
    recent = w[w.index >= w.index[-1] - pd.DateOffset(years=THIN_YEARS)]
    ch = recent.pct_change().dropna()
    thin = float((ch.abs() < 1e-9).mean()) if len(ch) else 0.0
    return {"name": meta.get("longName") or meta.get("shortName") or sym, "ccy": ccy, "type": meta.get("instrumentType") or "",
            "d": [int((t - EPOCH).days) for t in w.index], "v": [sig(float(x)) for x in w.values], "thin": round(thin, 3)}


def build(status: dict) -> None:
    print("Funds for the portfolio allocator (Yahoo, weekly adjusted closes)")
    check_funds()
    old = (load_existing("funds.json") or {}).get("funds", {})
    try:
        from tickers import user_list
        extra = [s for s in user_list() if s not in {f[0] for f in FUNDS}]
    except Exception:
        extra = []
    universe = [(s, short, cls, grp, alias, "core") for s, short, cls, grp, alias in FUNDS] + [(s, None, "Other", "Other", "", "watchlist") for s in extra]
    out, failed = {}, []
    for k, (sym, short, cls, grp, alias, src) in enumerate(universe):
        if k:
            time.sleep(GAP)
        x = None
        try:
            x = fetch_fund(sym)
        except Exception as e:
            print(f"  {sym}: {type(e).__name__}")
        if x:
            out[sym] = {"name": x["name"], "short": short or x["name"], "ccy": x["ccy"], "cls": cls, "grp": grp, "alias": alias, "place": place_of(sym),
                        "src": src, "d": x["d"], "v": x["v"], "thin": x["thin"]}
            status[f"FUND_{sym}"] = "ok"
        elif sym in old:   # kept from the last run, with this run's labels
            out[sym] = {**old[sym], "short": short or old[sym].get("short") or sym, "cls": cls, "grp": grp, "alias": alias, "place": place_of(sym)}
            status[f"FUND_{sym}"] = "stale (kept previous)"
            failed.append(sym)
        else:
            status[f"FUND_{sym}"] = "missing"
            failed.append(sym)
    write("funds.json", {"_meta": {"fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"), "failed": failed,
                                    "classes": ["Equities", "Bonds", "Cash-like", "Gold", "Property", "Other"], "groups": GROUPS, "watchlist": extra},
                         "funds": out})
    print(f"  {len(out)} funds ({len(out) - len([f for f in failed if f in out])} fresh)" + (f"; failed: {', '.join(failed)}" if failed else ""))


if __name__ == "__main__":
    build({})
