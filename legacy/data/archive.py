"""
Append-only history vault.
==========================
Keeps every observation this dashboard has ever seen, so that a source deleting
its own history cannot delete ours.

Why this exists
---------------
In April 2026 FRED truncated the entire ICE BofA index family to a rolling
three-year window. The series pages now say, verbatim:

    "Starting in April 2026, this series will only include 3 years of
     observations. For more data, go to the source."

So `HY OAS`, `BB OAS` and `CCC & lower OAS` begin in 2023 and lose another day
with every refresh. Nothing errored, nothing warned - the block simply came
back shorter each time, and the percentile tabs quietly started ranking today
against three years of post-COVID calm instead of against 2008 and 2020.

It is not only ICE. FRED deleted every Wilshire series in June 2024, and
`SP500` and `DJIA` now carry a rolling ten-year window. Treating any upstream
history as permanent is the mistake; this module stops making it.

How it works
------------
`cache/archive/<block>.parquet` holds the union of every refresh. On each run
the new frame wins wherever it has a value - so revisions land normally - and
the archive fills in everything the source has since dropped.

    frame = build_credit(start=start)
    frame = merge_archive(frame, "credit")
    save_cache(frame, "credit")

Two deliberate limits, stated plainly:

* A value the source *legitimately* withdrew (a bad print, later deleted) is
  kept by us. That is the price of not losing real history, and it is the right
  side to err on for a series nobody is going to re-derive by hand.

* If a series is re-based or re-defined, splicing old to new is wrong and no
  merge rule can know that. So the merge checks the overlap between archive and
  new data and complains loudly when they disagree - see `_overlap_warning`.
  The registry's `expect_units` audit is the other half of that guard.

What `_overlap_warning` cannot see, and why `_admissible` exists
---------------------------------------------------------------
`_overlap_warning` compares dates where BOTH frames have a value. A column
whose meaning changed produces no overlap at all on the dates that matter: the
archive fills in precisely where the new source has nothing, so there is
nothing to compare and the check stays silent.

That is not hypothetical. When the Global Equity block moved to yfinance the
column names stayed the same while the instruments behind them changed, and
`combine_first` injected the OLD instrument into today's columns on every date
the new source does not trade - month starts contributed by the OECD spine,
month ends contributed by the archive's own index. 836 values landed on
Saturdays and Sundays. `TOPIX TR` ended up holding 46 points at index scale
(8,700-27,000) inside a series that is otherwise a tenth-scale ETF (105-415),
and every one of them rendered as a 20-65x spike on a rebased chart.

So `_admissible` applies two structural rules per column, before any merge:

1. **No interior filling.** Archive values dated inside the live series' own
   span, on dates the live source does not publish, are dropped. A daily market
   series has no observations its own source skipped; anything there came from
   something else.
2. **Extensions must match scale.** A value before the first or after the last
   live observation is kept only if it is within `SCALE_TOLERANCE` of the live
   value it adjoins. Real older history is contiguous with the series it
   extends; a different instrument under the same name is not.

Neither rule can tell a re-based series from a re-priced one, and neither
replaces reading the warnings. They exist to stop the specific failure where
the archive silently outlives the meaning of a column.
"""

from __future__ import annotations

from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parent.parent
ARCHIVE_DIR = PROJECT_ROOT / "cache" / "archive"

#: A column is flagged when this share of its overlapping observations disagree
#: with the archive by more than `REBASE_TOLERANCE`.
REBASE_SHARE = 0.20
REBASE_TOLERANCE = 0.02   # 2% relative difference

#: An archived value extending a column's history is kept only if it is within
#: this factor of the live observation it adjoins. Generous on purpose: an
#: index can genuinely move fivefold across a long archive boundary, but an
#: ETF standing in for its index is out by ten or a hundred, and that is the
#: case this catches.
SCALE_TOLERANCE = 5.0

#: Blocks whose archive this run must rebuild from the live fetch alone.
#: Populated by `reset_blocks`; consulted by `merge_archive`.
_RESET: set[str] = set()


def reset_blocks(names) -> None:
    """
    Discard these blocks' vaults and rebuild them from this run's fetch.

    For when a column's MEANING changed and the stored history is therefore
    about a different thing. Nothing else clears the vault - not deleting the
    parquet by hand, because `_seed_from_cache` would then re-seed it from a
    block cache holding the very values being thrown away.
    """
    _RESET.update(str(n).lower() for n in names)


def archive_path(name: str) -> Path:
    return ARCHIVE_DIR / f"{name}.parquet"


def load_archive(name: str) -> pd.DataFrame | None:
    """Everything ever seen for this block, or None on the first ever run."""
    path = archive_path(name)
    if not path.exists():
        return None
    frame = pd.read_parquet(path)
    frame.index = pd.to_datetime(frame.index)
    return frame.sort_index()


def _seed_from_cache(name: str, *, verbose: bool = True) -> pd.DataFrame | None:
    """The block cache as it stands today, used to start the vault off."""
    path = PROJECT_ROOT / "cache" / f"{name}.parquet"
    if not path.exists():
        return None
    try:
        seed = pd.read_parquet(path)
        seed.index = pd.to_datetime(seed.index)
    except (OSError, ValueError, TypeError) as exc:
        if verbose:
            print(f"  archive  could not seed from {path.name}: {exc}")
        return None
    if verbose:
        print(f"  archive  seeded from existing {path.name} "
              f"({len(seed):,} rows, {seed.shape[1]} columns)")
    return seed.sort_index()


def _overlap_warning(new: pd.Series, old: pd.Series, column: str) -> str | None:
    """
    Flag a column whose past has changed shape, not just been revised.

    A handful of revised points is normal. A column where a fifth of the shared
    history has moved is a re-basing, a units change, or a ticker that now means
    something else - and splicing across that produces a chart that looks fine
    and is wrong.
    """
    shared = new.dropna().index.intersection(old.dropna().index)
    if len(shared) < 30:
        return None
    a, b = new.loc[shared], old.loc[shared]
    scale = b.abs().where(b.abs() > 1e-9)
    disagree = ((a - b).abs() / scale > REBASE_TOLERANCE)
    share = float(disagree.mean())
    if share <= REBASE_SHARE:
        return None
    return (f"{column}: {share:.0%} of {len(shared):,} overlapping observations "
            f"differ from the archive by more than {REBASE_TOLERANCE:.0%}. "
            f"Re-based or redefined? The merged series may splice two different "
            f"things. Check it before trusting the chart.")


def _admissible(new: pd.Series, old: pd.Series,
                column: str) -> tuple[pd.Series, list[str]]:
    """
    The archived values this column is allowed to keep, and what was refused.

    See the module docstring: interior points on dates the live source does not
    publish are dropped outright, and history extending past either end is kept
    only if it is on the same scale as the live observation it adjoins.
    """
    live, stored = new.dropna(), old.dropna()
    if live.empty or stored.empty:
        # Nothing live to judge against - the source returned nothing for this
        # column, which is exactly when the vault is supposed to carry it.
        return stored, []

    first, last = live.index[0], live.index[-1]
    notes: list[str] = []

    inside = stored.index[(stored.index > first) & (stored.index < last)
                          & ~stored.index.isin(live.index)]
    if len(inside):
        notes.append(
            f"{column}: dropped {len(inside):,} archived value(s) dated inside "
            f"the live history ({inside.min():%Y-%m-%d} to "
            f"{inside.max():%Y-%m-%d}) on dates this source does not publish. "
            f"A live series has no observations its own source skipped.")
        stored = stored.drop(inside)

    for side, dates, anchor in (
            ("before", stored.index[stored.index < first], float(live.iloc[0])),
            ("after", stored.index[stored.index > last], float(live.iloc[-1]))):
        if not len(dates) or anchor == 0:
            continue
        ratio = (stored.loc[dates] / anchor).abs()
        wrong = dates[(ratio > SCALE_TOLERANCE) | (ratio < 1 / SCALE_TOLERANCE)]
        if len(wrong):
            notes.append(
                f"{column}: dropped {len(wrong):,} archived value(s) {side} the "
                f"live history that are off its scale by more than "
                f"{SCALE_TOLERANCE:.0f}x (e.g. "
                f"{float(stored.loc[wrong[0]]):,.2f} against {anchor:,.2f}). "
                f"That is a different instrument under the same name.")
            stored = stored.drop(wrong)

    return stored, notes


def merge_archive(frame: pd.DataFrame, name: str, *,
                  verbose: bool = True) -> pd.DataFrame:
    """
    Union `frame` with this block's archive and return the result.

    New values win where both have one, so revisions flow through. The archive
    supplies everything the source has stopped publishing. Columns that are in
    the archive but not in this refresh stay in the vault and are NOT returned -
    the live block reflects the current registry, not every series ever tracked.
    """
    if not isinstance(frame.index, pd.DatetimeIndex):
        raise TypeError(
            f"merge_archive expects a time series; {name} has a "
            f"{type(frame.index).__name__}. Rebuilt tables (the calendar) must "
            f"not be archived - each refresh replaces them wholesale by design."
        )

    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    frame = frame.sort_index()

    if name.lower() in _RESET:
        # Rebuild from this fetch alone. Deliberately BEFORE _seed_from_cache:
        # the block cache holds the values being discarded, so seeding from it
        # would quietly restore them.
        frame.to_parquet(archive_path(name))
        if verbose:
            print(f"  archive  RESET {archive_path(name).name} - rebuilt from "
                  f"this fetch alone ({len(frame):,} rows, "
                  f"{frame.shape[1]} columns). Prior history discarded.")
        return frame

    old = load_archive(name)

    if old is None:
        # First archived run. Seed from the block cache already on disk rather
        # than from this fetch alone - otherwise history that is in the current
        # cache but has since been dropped upstream would be thrown away by the
        # very refresh that was meant to start protecting it.
        old = _seed_from_cache(name, verbose=verbose)

    if old is None:
        frame.to_parquet(archive_path(name))
        if verbose:
            print(f"  archive  started {archive_path(name).name} "
                  f"({len(frame):,} rows, {frame.shape[1]} columns)")
        return frame

    # Filter the archive column by column before any of it is merged in. The
    # refusals are printed rather than swallowed: a column shedding archived
    # values is either a redefinition or a bug, and both want looking at.
    admitted, refusals = old.copy(), []
    for column in frame.columns:
        if column not in old.columns:
            continue
        kept, notes = _admissible(frame[column], old[column], column)
        admitted[column] = kept.reindex(old.index)
        refusals.extend(notes)

    if refusals and verbose:
        print(f"  archive  {len(refusals)} column(s) refused archived values:")
        for note in refusals:
            print(f"           {note}")

    # The vault keeps everything; the returned block keeps today's columns.
    vault = frame.combine_first(admitted).sort_index()
    vault.to_parquet(archive_path(name))

    merged = vault[[c for c in frame.columns]]
    merged.attrs.update(frame.attrs)

    if verbose:
        _report(frame, old, merged, name)
    return merged


def _report(frame: pd.DataFrame, old: pd.DataFrame, merged: pd.DataFrame,
            name: str) -> None:
    """Say what the archive put back, and shout about anything suspicious."""
    rescued: list[str] = []
    warnings: list[str] = []

    for column in frame.columns:
        if column not in old.columns:
            continue
        new_obs, old_obs = frame[column].dropna(), old[column].dropna()
        if old_obs.empty:
            continue

        # What the archive actually put back - read off the merged result, not
        # off the raw vault, or values `_admissible` refused are reported as
        # recovered when they were dropped.
        recovered = merged[column].dropna().index.difference(new_obs.index)
        if len(recovered):
            earliest = recovered.min()
            lost_front = (not new_obs.empty) and earliest < new_obs.index.min()
            rescued.append(
                f"    {column:<34} +{len(recovered):>6,} obs, back to "
                f"{earliest:%Y-%m-%d}" + ("   <- source truncated" if lost_front else ""))

        warning = _overlap_warning(new_obs, old_obs, column)
        if warning:
            warnings.append(warning)

    absent = [c for c in old.columns if c not in frame.columns]

    print(f"  archive  {archive_path(name).name}: "
          f"{len(merged):,} rows after merge (this refresh returned {len(frame):,})")
    if rescued:
        print("    recovered from archive:")
        for line in rescued:
            print(line)
    if absent:
        print(f"    held in the vault but not in this refresh: {', '.join(absent)}")
    for warning in warnings:
        print(f"\n  !! ARCHIVE WARNING  {warning}\n")
