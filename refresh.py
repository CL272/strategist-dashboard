"""
Refresh the local data cache.
=============================
Hits the APIs, writes parquet into cache/ (plus a CSV mirror for Excel). The
Streamlit pages only ever read that cache - so the dashboard loads instantly,
works offline, and never rate-limits itself while you click around.

    python refresh.py                     # everything
    python refresh.py --block Funding     # one block
    python refresh.py --start 2015-01-01
    python refresh.py --check             # verify the API key, fetch nothing
    python refresh.py --audit             # verify every ticker's live FRED units
"""

from __future__ import annotations

import argparse
import sys

import pandas as pd
import requests

from data import registry
from data.archive import merge_archive, reset_blocks
from data.fred import (CACHE_DIR, FredError, fetch_many, get_api_key,
                       save_cache, series_meta)
from data.credit import build_credit
from data.curves import (CurveError, build_curves, curve_columns,
                         describe as describe_curves,
                         describe_mgs)
from data.econ_calendar import audit_events, build_calendar
from data.equity import (EquityError, build_equity,
                         describe as describe_equity, stale_columns)
from data.globalmacro import (MacroError, build_macro,
                              describe as describe_macro)
from data.valuation import (ValuationError, build_valuation,
                            describe as describe_valuation)
from data.estat import (EStatError, describe_metadata, describe_resolution,
                        search as estat_search)
from data.growth import build_growth
from data.malaysia import MalaysiaError, describe as describe_malaysia
from data.ofr import OFRError, build_ofr
from data.rates import RatesError, build_rates, inspect_hlw
from data.liquidity import CHANGE_LOG, build_liquidity

#: Not registry blocks - they have no FRED series - but they refresh like one.
CALENDAR_BLOCK = "Calendar"
CURVES_BLOCK = "Curves"
EQUITY_BLOCK = "Equity"
VALUATION_BLOCK = "Valuation"
MACRO_BLOCK = "Macro"

LIQUIDITY_CSV = CACHE_DIR.parent / "macro_liquidity_master.csv"


# --------------------------------------------------------------------------- #
# Checks
# --------------------------------------------------------------------------- #

def check_key() -> int:
    try:
        key = get_api_key()
    except FredError as exc:
        print(f"FAIL  {exc}")
        return 1
    print(f"OK    FRED API key found ({key[:4]}…{key[-4:]}, {len(key)} chars)")
    return 0


def audit_units() -> int:
    """
    Compare every registered series' live FRED units against what the registry
    expects. This is the guard against the 1,000x class of bug - FRED reports
    some balance-sheet series in millions and their close siblings in billions.
    """
    print("\nAuditing units against live FRED metadata\n")
    print(f"  {'SERIES':<16} {'COLUMN':<34} {'FRED UNITS':<28} STATUS")
    print("  " + "-" * 92)

    session = requests.Session()
    problems = 0
    for spec in registry.REGISTRY:
        if spec.source != "fred":
            continue
        try:
            meta = series_meta(spec.id, session=session)
        except (FredError, requests.RequestException) as exc:
            print(f"  {spec.id:<16} {spec.name:<34} {'-':<28} UNREACHABLE ({exc})")
            problems += 1
            continue

        reported = meta.get("units", "")
        ok = registry.units_ok(spec, reported)
        scale_note = "" if spec.scale == 1.0 else f"  x{spec.scale:g}"
        status = f"ok{scale_note}" if ok else f"MISMATCH - expected {spec.expect_units}"
        if not ok:
            problems += 1
        print(f"  {spec.id:<16} {spec.name:<34} {reported[:27]:<28} {status}")

    print()
    if problems:
        print(f"{problems} problem(s). Fix the registry before trusting the numbers.")
        return 1
    print("All registered series report the units the registry expects.")
    return 0


# --------------------------------------------------------------------------- #
# Builders
# --------------------------------------------------------------------------- #

def _summarise(frame: pd.DataFrame, name: str) -> None:
    print(f"\n  rows     {len(frame):,}")
    print(f"  columns  {frame.shape[1]}")
    print(f"  span     {frame.index.min():%Y-%m-%d} to {frame.index.max():%Y-%m-%d}")

    tail = pd.DataFrame({
        "last date": [frame[c].last_valid_index() for c in frame.columns],
        "value": [round(float(frame[c].dropna().iloc[-1]), 3)
                  if frame[c].notna().any() else None for c in frame.columns],
    }, index=frame.columns)
    print(f"\n  Latest value per column ({name}):")
    with pd.option_context("display.max_rows", None, "display.width", 110):
        print("  " + tail.to_string().replace("\n", "\n  "))


def refresh_funding(start: str) -> int:
    print(f"\n=== Funding block ===\n")
    try:
        frame = build_liquidity(start=start)
    except (FredError, RuntimeError) as exc:
        print(f"\nFAIL  {exc}")
        return 1

    frame = merge_archive(frame, "liquidity")
    save_cache(frame, "liquidity")
    frame.to_csv(LIQUIDITY_CSV)
    print(f"\nWrote {CACHE_DIR / 'liquidity.parquet'}")
    print(f"Wrote {LIQUIDITY_CSV}  (CSV mirror for Excel)")
    _summarise(frame, "Funding")

    print("\n  Changes vs the original generator script:")
    for kind, text in CHANGE_LOG:
        print(f"    [{kind}] {text}")
    return 0


def refresh_growth(start: str) -> int:
    print(f"\n=== Growth block ===\n")
    try:
        frame = build_growth(start=start)
    except (FredError, RuntimeError) as exc:
        print(f"\nFAIL  {exc}")
        return 1
    frame = merge_archive(frame, "growth")
    save_cache(frame, "growth")
    csv_path = CACHE_DIR / "growth.csv"
    frame.to_csv(csv_path)
    print(f"\nWrote {CACHE_DIR / 'growth.parquet'}")
    print(f"Wrote {csv_path}  (CSV mirror)")
    _summarise(frame, "Growth")
    return 0


def refresh_credit(start: str) -> int:
    print(f"\n=== Credit block ===\n")
    try:
        frame = build_credit(start=start)
    except (FredError, RuntimeError) as exc:
        print(f"\nFAIL  {exc}")
        return 1
    frame = merge_archive(frame, "credit")
    save_cache(frame, "credit")
    csv_path = CACHE_DIR / "credit.csv"
    frame.to_csv(csv_path)
    print(f"\nWrote {CACHE_DIR / 'credit.parquet'}")
    print(f"Wrote {csv_path}  (CSV mirror)")
    _summarise(frame, "Credit")
    return 0


def refresh_ofr(start: str) -> int:
    print(f"\n=== External block (OFR Financial Stress Index) ===\n")
    try:
        frame = build_ofr(start=start)
    except OFRError as exc:
        # A cross-check failing should never break the rest of the refresh.
        print(f"  [SKIP] {exc}")
        print("  The dashboard still works; the cross-check section will be hidden.")
        return 0
    frame = merge_archive(frame, "ofr")
    save_cache(frame, "ofr")
    csv_path = CACHE_DIR / "ofr.csv"
    frame.to_csv(csv_path)
    print(f"\nWrote {CACHE_DIR / 'ofr.parquet'}")
    print(f"Wrote {csv_path}  (CSV mirror)")
    _summarise(frame, "External")
    return 0


def refresh_rates(start: str) -> int:
    print(f"\n=== Rates block ===\n")
    try:
        frame = build_rates(start=start)
    except (FredError, RatesError, RuntimeError) as exc:
        print(f"\nFAIL  {exc}")
        return 1
    frame = merge_archive(frame, "rates")
    save_cache(frame, "rates")
    csv_path = CACHE_DIR / "rates.csv"
    frame.to_csv(csv_path)
    print(f"\nWrote {CACHE_DIR / 'rates.parquet'}")
    print(f"Wrote {csv_path}  (CSV mirror)")
    _summarise(frame, "Rates")
    return 0


def refresh_curves(start: str, mgs_days: int = 90) -> int:
    print(f"\n=== Curves block (government bond yield curves) ===\n")
    try:
        frame = build_curves(start=start, mgs_days=mgs_days)
    except CurveError as exc:
        print(f"\nFAIL  {exc}")
        print("\n  Run `python refresh.py --curves-check` to see what each "
              "source returned.")
        return 1

    problems = frame.attrs.get("problems", {})
    frame = merge_archive(frame, "curves")
    save_cache(frame, "curves")
    csv_path = CACHE_DIR / "curves.csv"
    frame.to_csv(csv_path)
    print(f"\nWrote {CACHE_DIR / 'curves.parquet'}")
    print(f"Wrote {csv_path}  (CSV mirror)")

    print(f"\n  rows     {len(frame):,}")
    print(f"  span     {frame.index.min():%Y-%m-%d} to {frame.index.max():%Y-%m-%d}")
    for market in ("US", "US real", "EA", "JP", "MY", "MY GII", "MY bills"):
        columns = curve_columns(frame, market)
        if not columns:
            continue
        live = frame[columns].dropna(how="all")
        latest = frame[columns].ffill().iloc[-1]
        print(f"\n  {market} - {len(columns)} tenors, "
              f"{live.index.min():%Y-%m-%d} to {live.index.max():%Y-%m-%d}")
        print("    " + "  ".join(
            f"{c.rsplit(' ', 1)[-1]}:{latest[c]:.2f}" for c in columns
            if pd.notna(latest[c])))

    if "MY OPR" in frame.columns:
        opr = frame["MY OPR"].dropna()
        if len(opr):
            print(f"\n  MY policy rate - {len(opr)} decisions, "
                  f"{opr.index.min():%Y-%m-%d} to {opr.index.max():%Y-%m-%d}, "
                  f"latest {float(opr.iloc[-1]):.2f}%")

    if problems:
        print("\n  " + "!" * 60)
        for market, message in problems.items():
            print(f"  {market} is MISSING from this refresh:")
            print(f"    {message.splitlines()[0]}")
        print("  The page will show what it has and name what it does not.")
        print("  " + "!" * 60)
        return 1
    return 0


def refresh_equity(start: str) -> int:
    print(f"\n=== Equity block (global indices) ===\n")
    try:
        frame = build_equity(start=start)
    except EquityError as exc:
        print(f"\nFAIL  {exc}")
        print("\n  Run `python refresh.py --equity-check` to see what each "
              "source returned.")
        return 1

    problems = frame.attrs.get("problems", {})
    stale = frame.attrs.get("stale", {})
    frame = merge_archive(frame, "equity")
    save_cache(frame, "equity")
    csv_path = CACHE_DIR / "equity.csv"
    frame.to_csv(csv_path)
    print(f"\nWrote {CACHE_DIR / 'equity.parquet'}")
    print(f"Wrote {csv_path}  (CSV mirror)")
    _summarise(frame, "Equity")

    if stale:
        print("\n  STALE - last observation older than the frequency allows:")
        for column, when in stale.items():
            print(f"    {column:<28} last print {when:%Y-%m-%d}")
        print("  A source that stops publishing without saying so looks exactly "
              "like a flat line.")

    if problems:
        print("\n  " + "!" * 60)
        for what, message in problems.items():
            print(f"  MISSING  {what}: {message.splitlines()[0]}")
        print("  " + "!" * 60)
        return 1
    return 0


def refresh_macro(start: str) -> int:
    print(f"\n=== Macro block (inflation, activity, labour, policy) ===\n")
    try:
        frame = build_macro(start=start)
    except MacroError as exc:
        print(f"\nFAIL  {exc}")
        print("\n  Run `python refresh.py --macro-check` to see what each "
              "region returned.")
        return 1

    problems = frame.attrs.get("problems", {})
    frame = merge_archive(frame, "macro")
    save_cache(frame, "macro")
    csv_path = CACHE_DIR / "macro.csv"
    frame.to_csv(csv_path)
    print(f"\nWrote {CACHE_DIR / 'macro.parquet'}")
    print(f"Wrote {csv_path}  (CSV mirror)")
    _summarise(frame, "Macro")

    if problems:
        print("\n  " + "!" * 60)
        for what, message in problems.items():
            print(f"  MISSING  {what}: {message.splitlines()[0]}")
        print("  The page shows what it has and names what it does not.")
        print("  " + "!" * 60)
        return 1
    return 0


def refresh_valuation() -> int:
    print(f"\n=== Valuation block ===\n")
    try:
        frame = build_valuation()
    except ValuationError as exc:
        print(f"\nFAIL  {exc}")
        print("\n  Run `python refresh.py --valuation-check` to see what each "
              "source returned.")
        return 1

    problems = frame.attrs.get("problems", {})
    before = len(frame)
    frame = merge_archive(frame, "valuation")
    save_cache(frame, "valuation")
    csv_path = CACHE_DIR / "valuation.csv"
    frame.to_csv(csv_path)
    print(f"\nWrote {CACHE_DIR / 'valuation.parquet'}")
    print(f"Wrote {csv_path}  (CSV mirror)")
    _summarise(frame, "Valuation")

    forward = [c for c in frame.columns if c.endswith("forward P/E")]
    if forward:
        history = frame[forward].dropna(how="all")
        print(f"\n  Forward P/E is a SNAPSHOT source - SSGA publishes today's "
              f"number and keeps no archive.")
        print(f"  Readings collected so far: {len(history)} "
              f"({history.index.min():%Y-%m-%d} to {history.index.max():%Y-%m-%d}). "
              f"Each refresh adds one.")
        latest = frame[forward].ffill().iloc[-1]
        print("    " + "  ".join(
            f"{c.replace(' forward P/E', '')}: {latest[c]:.2f}x"
            for c in forward if pd.notna(latest[c])))

    if problems:
        print("\n  " + "!" * 60)
        for what, message in problems.items():
            print(f"  MISSING  {what}: {message.splitlines()[0]}")
        print("  " + "!" * 60)
        return 1
    return 0


def refresh_calendar() -> int:
    print(f"\n=== Calendar ===\n")
    try:
        frame = build_calendar()
    except Exception as exc:  # noqa: BLE001 - report loudly, never silently
        import traceback
        existing = CACHE_DIR / "calendar.parquet"
        print("\n" + "!" * 74)
        print(f"  CALENDAR BUILD FAILED — {type(exc).__name__}: {exc}")
        traceback.print_exc()
        if existing.exists():
            import datetime as _dt
            age = _dt.datetime.now() - _dt.datetime.fromtimestamp(
                existing.stat().st_mtime)
            hours = age.total_seconds() / 3600
            print(f"\n  The dashboard is still showing the PREVIOUS calendar, "
                  f"built {hours:.1f} hours ago.")
            print("  It will look current and will not be. Re-run this block "
                  "once the cause above is fixed.")
        print("!" * 74 + "\n")
        return 1
    save_cache(frame, "calendar")
    csv_path = CACHE_DIR / "calendar.csv"
    frame.to_csv(csv_path, index=False)
    print(f"\nWrote {CACHE_DIR / 'calendar.parquet'}")
    print(f"Wrote {csv_path}  (CSV mirror)")

    counts = frame.groupby(["Region", "Confidence"]).size()
    print("\n  Entries by region and confidence:")
    print("  " + counts.to_string().replace("\n", "\n  "))

    released = int((frame["Actual"] != "\u2014").sum())
    print(f"\n  {released} of {len(frame)} rows already carry an actual. "
          "The rest fill in as the data publishes.")
    return 0


def refresh_fred_block(block: str, start: str) -> int:
    ids = registry.fred_ids(block)
    print(f"\n=== {block} block ===\n")
    try:
        frame = fetch_many(ids, start=start)
    except FredError as exc:
        print(f"\nFAIL  {exc}")
        return 1

    frame = frame.rename(columns=registry.labels(block))
    frame = merge_archive(frame, block.lower())
    save_cache(frame, block.lower())
    csv_path = CACHE_DIR / f"{block.lower()}.csv"
    frame.to_csv(csv_path)
    print(f"\nWrote {CACHE_DIR / (block.lower() + '.parquet')}")
    print(f"Wrote {csv_path}  (CSV mirror)")
    _summarise(frame, block)
    return 0


# --------------------------------------------------------------------------- #

def main() -> int:
    parser = argparse.ArgumentParser(description="Refresh the dashboard data cache.")
    parser.add_argument("--start", default="2010-01-01", help="earliest date (YYYY-MM-DD)")
    parser.add_argument("--rates-start", default="1985-01-01",
                        help="earliest date for the Rates block, which needs a "
                             "long history for the r-star comparison")
    parser.add_argument("--curves-start", default="2000-01-01",
                        help="earliest date for the Curves block. Treasury "
                             "serves one file per year, so an early start "
                             "means one request per year - it only has to be "
                             "done once, the archive keeps it after that")
    parser.add_argument("--mgs-days", type=int, default=90,
                        help="how many business days of Malaysian government "
                             "securities yields to request. BNM serves one day "
                             "per call, so this is one request per day - the "
                             "archive keeps whatever has been collected, so a "
                             "large one-off backfill only has to be run once")
    parser.add_argument("--equity-start", default="1990-01-01",
                        help="earliest date for the Equity block")
    parser.add_argument("--block", default=None,
                        help=f"one of: {', '.join(registry.BLOCKS)}, "
                             f"{CALENDAR_BLOCK}, {CURVES_BLOCK}, "
                             f"{EQUITY_BLOCK}, {VALUATION_BLOCK}, "
                             f"{MACRO_BLOCK}")
    parser.add_argument("--reset-archive", action="store_true",
                        help="throw away this block's stored history and "
                             "rebuild it from this fetch alone. For when a "
                             "column's MEANING changed and the vault is now "
                             "about a different instrument. Requires --block, "
                             "because the vault holds history no source will "
                             "serve again")
    parser.add_argument("--check", action="store_true", help="verify the API key and exit")
    parser.add_argument("--audit", action="store_true",
                        help="verify every ticker's live FRED units and exit")
    parser.add_argument("--inspect-hlw", action="store_true",
                        help="dump the layout of the NY Fed r-star workbook and exit")
    parser.add_argument("--audit-events", action="store_true",
                        help="verify every calendar event ticker against live "
                             "FRED and exit")
    parser.add_argument("--estat-check", action="store_true",
                        help="resolve every Japanese series against e-Stat, "
                             "print which table each one matched, and exit")
    parser.add_argument("--estat-search", default=None, metavar="WORDS",
                        help="search the e-Stat catalogue by keyword and exit "
                             "- use this to find the right table")
    parser.add_argument("--curves-check", action="store_true",
                        help="fetch one file from each yield-curve source, "
                             "print what came back, and exit")
    parser.add_argument("--macro-check", action="store_true",
                        help="fetch from each region's macro source, print "
                             "what came back, and exit")
    parser.add_argument("--mgs-check", action="store_true",
                        help="print Bank Negara's raw gov-sec-yield response "
                             "and what the parser made of it, then exit")
    parser.add_argument("--valuation-check", action="store_true",
                        help="fetch from each valuation source, print what came "
                             "back, and exit")
    parser.add_argument("--equity-check", action="store_true",
                        help="fetch one file from each equity source, print "
                             "what came back, and exit")
    parser.add_argument("--my-check", action="store_true",
                        help="resolve every Malaysian series against OpenDOSM "
                             "and BNM, print what came back, and exit")
    parser.add_argument("--estat-inspect", default=None, metavar="TABLE_ID",
                        help="dump one e-Stat table's classifications and the "
                             "names inside them, and exit")
    args = parser.parse_args()

    if args.inspect_hlw:
        print(inspect_hlw())
        return 0
    if args.check:
        return check_key()
    if check_key() != 0:
        return 1
    if args.audit:
        return audit_units()
    if args.audit_events:
        return audit_events()
    if args.estat_search:
        try:
            found = estat_search(word=args.estat_search, limit=40)
        except EStatError as exc:
            print(f"FAIL  {exc}")
            return 1
        if found.empty:
            print(f"Nothing in the e-Stat catalogue matches {args.estat_search!r}.")
            return 0
        with pd.option_context("display.max_rows", None, "display.width", 200,
                               "display.max_colwidth", 70):
            print(found.to_string(index=False))
        return 0
    if args.macro_check:
        print("\nChecking each regional macro source\n")
        report = describe_macro()
        with pd.option_context("display.width", 210, "display.max_colwidth", 80):
            print(report.to_string(index=False))
        failed = int((report["Status"] != "ok").sum())
        print()
        if failed:
            print(f"{failed} source(s) failed. Japan and Malaysia share their "
                  "fetchers with the Calendar, so --estat-check and --my-check "
                  "will say more.")
            return 1
        print("Every region responded. Run `python refresh.py --block Macro`.")
        return 0
    if args.mgs_check:
        print("\nBank Negara gov-sec-yield\n")
        print(describe_mgs())
        return 0
    if args.valuation_check:
        print("\nChecking each valuation source\n")
        report = describe_valuation()
        with pd.option_context("display.width", 220, "display.max_colwidth", 90):
            print(report.to_string(index=False))
        failed = int((report["Status"] != "ok").sum())
        print()
        if failed:
            print(f"{failed} source(s) failed. Send me the rows above and I "
                  "will correct the parser.")
            return 1
        print("Every valuation source parsed. Run "
              "`python refresh.py --block Valuation`.")
        return 0
    if args.equity_check:
        print("\nChecking each equity source\n")
        report = describe_equity()
        with pd.option_context("display.width", 210, "display.max_colwidth", 80):
            print(report.to_string(index=False))
        failed = int((report["Status"] == "FAIL").sum())
        print()
        if failed:
            print(f"{failed} source(s) failed. The mirrors are unofficial and "
                  "change symbols without notice - send me the rows above and "
                  "I will correct them.")
            return 1
        print("Every equity source responded. Run `python refresh.py --block Equity`.")
        return 0
    if args.curves_check:
        print("\nChecking each yield-curve source\n")
        report = describe_curves()
        with pd.option_context("display.width", 200, "display.max_colwidth", 90):
            print(report.to_string(index=False))
        failed = int((report["Status"] != "ok").sum())
        print()
        if failed:
            print(f"{failed} source(s) did not parse. Send me the rows above "
                  "and I will correct the parser.")
            return 1
        print("Every curve source parsed. Run `python refresh.py --block Curves`.")
        return 0
    if args.my_check:
        print("\nResolving Malaysian series against OpenDOSM and BNM\n")
        try:
            report = describe_malaysia()
        except MalaysiaError as exc:
            print(f"FAIL  {exc}")
            return 1
        print()
        with pd.option_context("display.width", 200, "display.max_colwidth", 70):
            print(report.to_string(index=False))
        failed = int((report["Status"] != "ok").sum())
        print()
        if failed:
            print(f"{failed} series did not resolve. The columns each dataset "
                  "returned are printed above — send them and I will correct "
                  "the specs.")
            return 1
        print("Every Malaysian series resolved. Run `python refresh.py "
              "--block Calendar`.")
        return 0
    if args.estat_inspect:
        print(f"\nClassifications in e-Stat table {args.estat_inspect}\n")
        print(describe_metadata(args.estat_inspect, max_members=30))
        return 0
    if args.estat_check:
        print("\nResolving Japanese series against the live e-Stat catalogue\n")
        try:
            report = describe_resolution()
        except EStatError as exc:
            print(f"FAIL  {exc}")
            return 1
        print()
        with pd.option_context("display.width", 200, "display.max_colwidth", 70):
            print(report[["Series", "Status", "Observations", "From", "To",
                          "Latest"]].to_string(index=False))
        failed = int((report["Status"] != "ok").sum())
        print()
        if failed:
            print(f"{failed} series did not resolve. Send me the rows above and "
                  "I will correct the patterns.")
            return 1
        print("Every Japanese series resolved. Run `python refresh.py "
              "--block Calendar` to pull them into the calendar.")
        return 0

    known = list(registry.BLOCKS) + [CALENDAR_BLOCK, CURVES_BLOCK,
                                     EQUITY_BLOCK, VALUATION_BLOCK,
                                     MACRO_BLOCK]
    blocks = [args.block] if args.block else known
    unknown = [b for b in blocks if b not in known]
    if unknown:
        print(f"Unknown block(s): {', '.join(unknown)}. "
              f"Known: {', '.join(known)}")
        return 1

    if args.reset_archive:
        if not args.block:
            # The vault is the only copy of history FRED and others have
            # deleted upstream - the ICE BofA family among it. Wiping every
            # block at once is never what anyone means.
            print("--reset-archive needs --block. It discards stored history "
                  "that no source will serve again, so it is deliberately not "
                  "something you can do to every block in one command.")
            return 1
        reset_blocks(blocks)
        print(f"\nResetting the {args.block} archive: stored history will be "
              f"discarded and rebuilt from this fetch alone.")

    status = 0
    for block in blocks:
        if block == CALENDAR_BLOCK:
            status |= refresh_calendar()
        elif block == CURVES_BLOCK:
            status |= refresh_curves(args.curves_start, args.mgs_days)
        elif block == EQUITY_BLOCK:
            status |= refresh_equity(args.equity_start)
        elif block == VALUATION_BLOCK:
            status |= refresh_valuation()
        elif block == MACRO_BLOCK:
            status |= refresh_macro(args.equity_start)
        elif block == "Funding":
            status |= refresh_funding(args.start)
        elif block == "Growth":
            status |= refresh_growth(args.start)
        elif block == "Credit":
            status |= refresh_credit(args.start)
        elif block == "External":
            status |= refresh_ofr(args.start)
        elif block == "Rates":
            status |= refresh_rates(args.rates_start)
        else:
            status |= refresh_fred_block(block, args.start)
    return status


if __name__ == "__main__":
    sys.exit(main())
