"""
Entry point for the GitHub workflow, which runs every 30 minutes.

- Headlines are refreshed on every run.
- The full data refresh (all markets, FRED, curves, Asia) runs when a daily slot
  has passed since the last full refresh: 22:30 UTC (06:30 SGT) and 10:15 UTC (18:15 SGT).
  A manual run or a code push (FULL=true) always does the full refresh.
"""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import fetch  # noqa: E402
import news   # noqa: E402

SLOTS_UTC = [(22, 30), (10, 15)]
DATA_FILES = ["yahoo.json", "fred.json", "derived.json", "curves.json", "asia.json", "meta.json"]


def last_slot(now: datetime) -> datetime:
    cands = []
    for back in range(3):
        d = (now - timedelta(days=back)).date()
        for h, m in SLOTS_UTC:
            t = datetime(d.year, d.month, d.day, h, m, tzinfo=timezone.utc)
            if t <= now:
                cands.append(t)
    return max(cands)


def main() -> int:
    now = datetime.now(timezone.utc)
    full = os.environ.get("FULL", "").lower() == "true"
    reason = "requested" if full else ""
    if not full:
        if not all((fetch.OUT / f).exists() for f in DATA_FILES):
            full, reason = True, "published data incomplete"
        else:
            meta = fetch.load_existing("meta.json")
            try:
                last = datetime.strptime(meta["updated_utc"], "%Y-%m-%d %H:%M UTC").replace(tzinfo=timezone.utc)
            except Exception:
                last = None
            if last is None or last < last_slot(now):
                full, reason = True, f"scheduled slot {last_slot(now):%H:%M} UTC due"
    print(f"Mode: {'FULL refresh (' + reason + ')' if full else 'headlines only'}")
    if full:
        return fetch.main()
    news.build_news()
    return 0


if __name__ == "__main__":
    sys.exit(main())
