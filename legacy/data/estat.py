"""
e-Stat: Japanese government statistics.
=======================================
FRED's Japan coverage runs through OECD collections, several of which have
been discontinued - which is why Japanese rows on the calendar were dates with
no numbers. e-Stat is the primary source: the Statistics Bureau's own portal,
free, and it carries CPI, the Labour Force Survey, trade and the national
accounts.

    https://www.e-stat.go.jp/api/en/api-dev/how_to_use

Needs a free application ID. Put it in .streamlit/secrets.toml:

    ESTAT_APP_ID = "..."

--------------------------------------------------------------------------- #
Why this module discovers tables instead of hardcoding their IDs
--------------------------------------------------------------------------- #

Every e-Stat table has an opaque numeric `statsDataId` (0003427113 and the
like). Those IDs are not stable across re-basings - CPI moved when the 2020
base year came in - and a wrong ID does not fail, it returns *a* table, quite
possibly a plausible-looking one. That is the worst failure mode available:
silently correct-looking numbers for the wrong series.

So nothing here is hardcoded. Each series is described by what it *is* - the
government statistics code, a pattern the table title must match, and the
category values that select one column out of it - and resolved against the
live catalogue on every refresh. `describe_resolution()` prints exactly which
table was chosen so a wrong match is visible rather than silent.

**If a spec matches more than one series, this raises rather than picking one.**
An ambiguous match is not a small problem to paper over; it means the
description is not specific enough yet, and guessing would put an unlabelled
number on the dashboard.
"""

from __future__ import annotations

import re
import time
import unicodedata
from dataclasses import dataclass, field

import pandas as pd
import requests

BASE = "https://api.e-stat.go.jp/rest/3.0/app/json"

#: How many candidate tables to open the metadata for before giving up. Each
#: costs one small request, and the right table is rarely far down the ranking.
MAX_CANDIDATES = 14

#: A table whose newest period is older than this is a retired vintage. The
#: 2005-base CPI table (平成17年基準) matched the title pattern, resolved its
#: codes perfectly, and then returned "no applicable data" - because it stopped
#: publishing years ago. Checking the time classification catches that before
#: the data request, and generalises to every re-based statistic.
MAX_TABLE_AGE_DAYS = 300
TIMEOUT = 45
MAX_RETRIES = 3
APP_ID_KEY = "ESTAT_APP_ID"


class EStatError(RuntimeError):
    """Raised when e-Stat refuses a request or a table cannot be resolved."""


# --------------------------------------------------------------------------- #
# Credentials
# --------------------------------------------------------------------------- #

def get_app_id() -> str:
    """Find the e-Stat application ID, or explain how to get one."""
    import os

    key = os.environ.get(APP_ID_KEY)
    if key and key.strip():
        return key.strip()

    from data.fred import SECRETS_PATH

    if SECRETS_PATH.exists():
        try:
            import tomllib
        except ModuleNotFoundError:            # pragma: no cover
            import tomli as tomllib            # type: ignore[no-redef]
        with SECRETS_PATH.open("rb") as fh:
            data = tomllib.load(fh)
        key = data.get(APP_ID_KEY)
        if key and str(key).strip():
            return str(key).strip()

    raise EStatError(
        f"No e-Stat application ID found.\n"
        f"Add this line to {SECRETS_PATH}:\n\n"
        f'    {APP_ID_KEY} = "your-id-here"\n\n'
        "Free, three per account: https://www.e-stat.go.jp/api/en/api-dev/how_to_use"
    )


# --------------------------------------------------------------------------- #
# HTTP
# --------------------------------------------------------------------------- #

def _request(endpoint: str, params: dict) -> dict:
    """
    GET an e-Stat endpoint.

    e-Stat returns HTTP 200 with an error *inside* the body, so the status code
    alone tells you nothing - the RESULT.STATUS field is the real answer.
    """
    payload = {**params, "appId": get_app_id()}
    last = None

    for attempt in range(MAX_RETRIES):
        try:
            response = requests.get(f"{BASE}/{endpoint}", params=payload,
                                    timeout=TIMEOUT)
            response.raise_for_status()
            body = response.json()
        except (requests.RequestException, ValueError) as exc:
            last = str(exc)
            time.sleep(1.5 * (attempt + 1))
            continue

        root = next(iter(body.values())) if body else {}
        result = root.get("RESULT", {})
        status = result.get("STATUS")
        if status not in (0, "0"):
            raise EStatError(
                f"e-Stat rejected {endpoint}: status {status} — "
                f"{result.get('ERROR_MSG', 'no message')}"
            )
        return root

    raise EStatError(f"Gave up on {endpoint} after {MAX_RETRIES} attempts — {last}")


def _as_list(value) -> list:
    """e-Stat collapses single-element arrays into bare objects."""
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


# --------------------------------------------------------------------------- #
# Catalogue
# --------------------------------------------------------------------------- #

def search(word: str | None = None, stats_code: str | None = None,
           limit: int = 100) -> pd.DataFrame:
    """
    Look up tables in the catalogue.

    Exposed as `refresh.py --estat-search` because finding the right table is
    the genuinely hard part of using e-Stat, and it is far easier to eyeball a
    list of titles than to guess a numeric ID.
    """
    params: dict = {"limit": limit}
    if word:
        params["searchWord"] = word
    if stats_code:
        params["statsCode"] = stats_code

    root = _request("getStatsList", params)
    tables = _as_list(root.get("DATALIST_INF", {}).get("TABLE_INF"))

    rows = []
    for table in tables:
        rows.append({
            "id": str(table.get("@id", "")),
            "statistic": _text(table.get("STAT_NAME")),
            "title": _text(table.get("TITLE")),
            "cycle": _text(table.get("CYCLE")),
            "survey": _text(table.get("SURVEY_DATE")),
            "updated": _text(table.get("UPDATED_DATE")),
        })
    return pd.DataFrame(rows)


def _text(node) -> str:
    """e-Stat wraps labelled values as {'@code': ..., '$': 'label'}."""
    if node is None:
        return ""
    if isinstance(node, dict):
        return str(node.get("$", "")).strip()
    return str(node).strip()


# --------------------------------------------------------------------------- #
# Time codes
# --------------------------------------------------------------------------- #

def is_aggregate_period(code: str) -> bool:
    """
    True for a year or fiscal-year row rather than a month or quarter.

    e-Stat mixes them in the same table: 2026000808 is August 2026, while
    2025100000 is the 2025 FISCAL YEAR. Both parse to a date, so without this
    an annual figure lands in the middle of a monthly series and the
    year-on-year calculation quietly compares a month against a year.
    """
    text = str(code).strip()
    return text.isdigit() and len(text) >= 10 and text[6:10] == "0000"


def parse_time(code: str) -> pd.Timestamp | None:
    """
    Turn an e-Stat time code into a timestamp.

    The codes are ten digits: four for the year, two for the period type, then
    the start and end month. 2026000909 is September 2026; 2026001012 is
    October-December 2026; 2026000000 is the year as a whole. The period is
    dated by where it ENDS, so a quarter lands on its final month and lines up
    with everything else on the calendar.
    """
    text = str(code).strip()
    if not text.isdigit():
        return None

    year = int(text[:4])
    if len(text) == 4:
        return pd.Timestamp(year=year, month=1, day=1)
    if len(text) < 10:
        text = text.ljust(10, "0")

    end = int(text[8:10])
    start = int(text[6:8])
    month = end or start or 1
    if not 1 <= month <= 12:
        return None
    return pd.Timestamp(year=year, month=month, day=1)


# --------------------------------------------------------------------------- #
# Data
# --------------------------------------------------------------------------- #

#: How much history to ask for. The 2020-base CPI table is every item, for
#: every city, for every month - far past e-Stat's 100,000-record response cap.
#: The calendar only needs recent prints and a year of base for the YoY.
DEFAULT_FROM_YEARS = 12


def _time_from(years: int = DEFAULT_FROM_YEARS) -> str:
    """An e-Stat time code `years` back, for cdTimeFrom."""
    year = pd.Timestamp.today().year - years
    return f"{year}000101"


def fetch_table(stats_data_id: str, limit: int = 100_000,
                years: int | None = DEFAULT_FROM_YEARS, **extra) -> pd.DataFrame:
    """
    One table, tidied into long form.

    Columns: Date, Value, and one column per classification the table uses,
    holding the human-readable label rather than the code.
    """
    params = {"statsDataId": stats_data_id, "limit": limit, **extra}
    if years and "cdTimeFrom" not in params:
        params["cdTimeFrom"] = _time_from(years)
    root = _request("getStatsData", params)
    block = root.get("STATISTICAL_DATA", {})

    # Map each classification code back to its label, per dimension.
    labels: dict[str, dict[str, str]] = {}
    names: dict[str, str] = {}
    for obj in _as_list(block.get("CLASS_INF", {}).get("CLASS_OBJ")):
        dim = str(obj.get("@id", ""))
        label = str(obj.get("@name", dim))
        # Skip the time classification. It is already parsed into Date, and
        # carrying it as a category as well gives every table a dimension with
        # hundreds of distinct values - which made pick_series's ambiguity
        # guard fire on EVERY table, every time.
        if dim == "time" or "時間軸" in label or "time" in label.lower():
            continue
        names[dim] = label
        labels[dim] = {str(c.get("@code")): str(c.get("@name"))
                       for c in _as_list(obj.get("CLASS"))}

    rows = []
    for item in _as_list(block.get("DATA_INF", {}).get("VALUE")):
        row = {"Date": parse_time(item.get("@time", "")),
               "Aggregate": is_aggregate_period(item.get("@time", "")),
               "Value": pd.to_numeric(item.get("$"), errors="coerce")}
        for dim, label_map in labels.items():
            if dim == "Aggregate":
                continue
            code = item.get(f"@{dim}")
            if code is not None:
                row[names[dim]] = label_map.get(str(code), str(code))
        rows.append(row)

    total = block.get("RESULT_INF", {}).get("TOTAL_NUMBER")
    returned = block.get("RESULT_INF", {}).get("TO_NUMBER")
    try:
        if total and returned and int(returned) < int(total):
            raise EStatError(
                f"Table {stats_data_id} has {int(total):,} records but only "
                f"{int(returned):,} came back — the filters need to be applied "
                "server-side (cdCat01/cdArea) or the window shortened, because "
                "a truncated table can silently omit the series wanted."
            )
    except (TypeError, ValueError):
        pass

    frame = pd.DataFrame(rows)
    if frame.empty:
        raise EStatError(f"Table {stats_data_id} returned no observations.")
    frame = frame.dropna(subset=["Date"])

    # Drop annual rows only when the table also carries finer ones. A genuinely
    # annual table is all aggregate rows and must keep them.
    if "Aggregate" in frame.columns and not frame["Aggregate"].all():
        frame = frame[~frame["Aggregate"]]
    return frame.drop(columns=["Aggregate"], errors="ignore").sort_values("Date")


# --------------------------------------------------------------------------- #
# Metadata
# --------------------------------------------------------------------------- #

#: Members named like this mean "all of them". Japanese statistical tables
#: almost always carry a total row per breakdown, and picking it is what turns
#: "by sex, by age group" into one national series.
TOTAL_NAMES = re.compile(r"^(総数|総計|合計|計|全域|全国|total)$", re.IGNORECASE)


def _classes(root: dict) -> list[dict]:
    """CLASS_OBJ list from either getMetaInfo or getStatsData."""
    for holder in ("METADATA_INF", "STATISTICAL_DATA"):
        objs = root.get(holder, {}).get("CLASS_INF", {}).get("CLASS_OBJ")
        if objs is not None:
            return _as_list(objs)
    return []


def newest_period(classes: list[dict]) -> pd.Timestamp | None:
    """The most recent period a table's time classification offers."""
    for obj in classes:
        if str(obj.get("@id")) != "time":
            continue
        dates = [parse_time(m.get("@code", "")) for m in _as_list(obj.get("CLASS"))]
        dates = [d for d in dates if d is not None]
        return max(dates) if dates else None
    return None


def get_meta(stats_data_id: str) -> list[dict]:
    """
    A table's classifications and their members, without downloading the data.

    This is what makes filtering possible: knowing the CODE for "All items"
    lets the data request ask for that one column instead of pulling three
    million records and hoping the right one survived truncation.
    """
    root = _request("getMetaInfo", {"statsDataId": stats_data_id})
    classes = _classes(root)
    if not classes:
        raise EStatError(f"Table {stats_data_id} returned no metadata.")
    return classes


def normalise(name: str) -> str:
    """
    Compare member names on their meaning, not their typography.

    e-Stat labels carry full-width spaces, occasional leading item codes
    ("0001 総合") and inconsistent padding. NFKC folds the width variants
    together; the rest is stripped. Without this, /^総合$/ fails against a
    label that reads as 総合 to a human.
    """
    text = unicodedata.normalize("NFKC", str(name)).strip()
    text = re.sub(r"^[0-9A-Za-z_.-]+\s+", "", text)   # drop a leading code
    return re.sub(r"\s+", " ", text).strip()


def _param_for(dim_id: str) -> str:
    """Class id 'cat01' -> query parameter 'cdCat01'."""
    return "cd" + dim_id[:1].upper() + dim_id[1:]


def match_codes(classes: list[dict], spec: "TableSpec",
                verbose: bool = False) -> tuple[dict[str, str], list[str]]:
    """
    Turn a spec's patterns into concrete filter codes for this table.

    Returns (params, notes). Raises if a pattern matches nothing or matches
    more than one member - an ambiguous match here is the same error as before,
    caught earlier and far more cheaply.

    Any classification the spec does not mention is pinned to its total member
    if it has one. A Labour Force Survey table broken down by sex and age needs
    both set to 総数 to give a national rate, and requiring the spec to list
    every such breakdown by hand would make the specs unmaintainable.
    """
    params: dict[str, str] = {}
    notes: list[str] = []
    handled: set[str] = set()

    for hint, pattern in spec.select.items():
        candidates = [c for c in classes if hint in str(c.get("@name", ""))]
        if not candidates:                      # hint missed - try every class
            candidates = classes
        # "code:0001" selects by classification code instead of by label. The
        # CPI item list contains TWO members named 総合 - 0001 (the headline)
        # and 0201 (the same word inside a different grouping) - so no pattern
        # over names can separate them. The code can, and it is stable across
        # re-basings: 0001 is 総合 in the 2020 and 2025 tables alike.
        by_code = pattern.startswith("code:")
        wanted = pattern[5:] if by_code else pattern
        found = None
        for obj in candidates:
            members = [m for m in _as_list(obj.get("CLASS"))
                       if (str(m.get("@code", "")) == wanted if by_code else
                           (re.search(wanted, normalise(m.get("@name", "")))
                            or re.search(wanted, str(m.get("@name", "")))))]
            if len(members) > 1:
                raise EStatError(
                    f"{spec.name}: /{pattern}/ matches {len(members)} members of "
                    f"'{obj.get('@name')}' — "
                    + ", ".join(str(m.get("@name")) for m in members[:4])
                    + ". Refusing to guess between them.")
            if members:
                found = (str(obj.get("@id")), str(members[0].get("@code")),
                         str(obj.get("@name")), str(members[0].get("@name")))
                break
        if found is None:
            detail = "; ".join(
                f"{c.get('@name')} [" + ", ".join(
                    normalise(m.get("@name", ""))
                    for m in _as_list(c.get("CLASS"))[:6]) + "]"
                for c in classes if str(c.get("@id")) != "time")
            raise EStatError(
                f"{spec.name}: nothing matches /{pattern}/. "
                f"The table offers — {detail}")
        dim, code, dim_name, member = found
        params[_param_for(dim)] = code
        handled.add(dim)
        notes.append(f"{dim_name}={member}")

    # Everything else gets its total, or is left alone if it has none.
    for obj in classes:
        dim = str(obj.get("@id", ""))
        if dim in handled or dim == "time":
            continue
        members = _as_list(obj.get("CLASS"))
        if len(members) <= 1:
            continue
        totals = [m for m in members
                  if TOTAL_NAMES.match(normalise(m.get("@name", "")))]
        if len(totals) == 1:
            params[_param_for(dim)] = str(totals[0].get("@code"))
            notes.append(f"{obj.get('@name')}={totals[0].get('@name')} (total)")
        else:
            # No way to collapse this breakdown to one series. Raising here
            # lets resolve() move to the next candidate table; discovering it
            # after the download would just fail the whole spec on a table
            # that was never usable - which is how the age-banded variant of
            # the unemployment table kept winning.
            raise EStatError(
                f"cannot reduce '{obj.get('@name')}' to a single series "
                f"({len(members)} members, no total): "
                + ", ".join(normalise(m.get("@name", "")) for m in members[:5]))

    return params, notes


# --------------------------------------------------------------------------- #
# Specs
# --------------------------------------------------------------------------- #

@dataclass(frozen=True)
class TableSpec:
    """
    A Japanese series described by what it is, not by an ID.

    `select` maps a classification name (matched loosely) to the value that
    picks our one series out of the table - for CPI that is the item "All
    items" and the region "All Japan". Patterns are matched against the
    Japanese labels, with the English in a comment beside each spec.
    """
    name: str
    stats_code: str
    title_pattern: str
    select: dict[str, str] = field(default_factory=dict)
    search_word: str = ""        # narrows the catalogue before ranking
    #: Tried in order when one keyword is not enough to surface the right
    #: table. "四半期別GDP速報" returned only retired nominal-series vintages,
    #: while the live seasonally-adjusted table sits under different wording.
    search_words: tuple[str, ...] = ()
    transform: str = "yoy"
    unit: str = "%"
    prefer_cycle: str = ""
    note: str = ""


#: Best-effort specifications. Every pattern here is written from the published
#: names of these statistics, NOT verified against a live catalogue - this
#: session cannot reach api.e-stat.go.jp. `--estat-check` is what turns them
#: from plausible into confirmed, and it prints what each one resolved to.
JAPAN_SPECS: tuple[TableSpec, ...] = (
    TableSpec(
        # 表章項目 offers 前年同月比 directly, so the official year-on-year
        # figure is taken rather than derived from the index. It is the number
        # Japan actually publishes, it needs no 13 months of base data, and it
        # cannot drift from the headline through rounding.
        "CPI (nationwide, YoY)", "00200573",
        title_pattern=r"(全国|nationwide).*(総合|general|all items)|(消費者物価指数)",
        # Anchored at both ends on purpose. A Japanese CPI table carries
        # 総合, 生鮮食品を除く総合 and 生鮮食品及びエネルギーを除く総合 side by
        # side, and an unanchored /総合$/ matches all three - headline, core
        # and core-core - which is precisely the ambiguity the guard exists to
        # catch. Same for 指数 against 季節調整済指数.
        # 総合 appears TWICE in the item list - 0001 (headline) and 0201 -
        # so the item and region are selected by code. 0001/00000 are the same
        # in the 2020 and 2025 base tables, and the retired-vintage check keeps
        # resolution on whichever base is current.
        select={"地域": r"code:00000", "品目": r"code:0001",
                "表章": r"^前年同月比$"},
        transform="level", prefer_cycle="月次",
        note="Consumer Price Index, Statistics Bureau. All Japan, all items, "
             "official year-on-year.",
    ),

    TableSpec(
        # The same CPI table with the region code swapped: 13100 is 東京都区部,
        # sitting in that table's own region list beside 00000 全国. One extra
        # request and no new discovery problem - and Tokyo prints about three
        # weeks ahead of the nationwide figure, which is what earns it a row.
        "CPI (Tokyo, advance)", "00200573",
        title_pattern=r"(全国|nationwide).*(総合|general|all items)|(消費者物価指数)",
        select={"地域": r"code:13100", "品目": r"code:0001",
                "表章": r"^前年同月比$"},
        transform="level", prefer_cycle="月次",
        note="Tokyo ward area CPI, all items, year-on-year.",
    ),

    # Japan GDP was attempted twice and removed.
    #
    # The catalogue does surface exactly the right KIND of table -
    # 国内総生産（支出側）実質季節調整系列 実額, the real seasonally-adjusted
    # expenditure series - but every copy of it is frozen at 2018 Q4 in the
    # 2011 chain-linked price base. The live series moved to a newer base
    # under groupings that neither the statistics code nor any of four search
    # keywords surfaced. Finding it needs the tstat grouping id, which this
    # API's catalogue search does not expose.
    #
    # FRED carries Japanese real GDP as well, which would cost one line and no
    # discovery - the existing dead-series guard drops it automatically if the
    # ticker turns out to be one of the retired OECD ones. Say the word.

    TableSpec(
        # Every table under this code says "labour force" somewhere, so the
        # title cannot distinguish them - the metadata check does the real
        # work and this only orders the candidates sensibly.
        #
        # The rate is not a member called 完全失業率. This table encodes it as
        # 表章項目=率 crossed with 就業状態=完全失業者 - the same 率 measure
        # gives 労働力人口比率 and 就業率 against the other two statuses. Asking
        # for a member literally named 完全失業率 finds nothing, which is why
        # every candidate was rejected.
        #
        # 完全失業者 alone is a HEADCOUNT. It is only the rate because 表章項目
        # is 率. Both halves are required.
        "Unemployment rate", "00200531",
        title_pattern=r"(完全失業率|就業率|労働力人口比率)",
        select={"表章": r"^率$", "就業状態": r"^完全失業者$"},
        transform="level", prefer_cycle="月次", search_word="完全失業率",
        note="Labour Force Survey, Statistics Bureau. 表章項目=率 crossed with "
             "就業状態=完全失業者, sex pinned to 総数.",
    ),
)


# --------------------------------------------------------------------------- #
# Resolution
# --------------------------------------------------------------------------- #

def _score(title: str, spec: TableSpec) -> int:
    return len(re.findall(spec.title_pattern, title))


def resolve(spec: TableSpec, limit: int = 100, verbose: bool = True
            ) -> tuple[str, str, dict[str, str], list[str]]:
    """
    Find the table for a spec, and the filter codes inside it.

    Ranks candidates by title, then **checks each one's metadata actually
    contains what the spec asks for** before accepting it. Title matching alone
    put the unemployment rate on a table of population by age group: every
    table under the Labour Force Survey code has "labour force" in its title,
    so the pattern matched something meaningless and the score sorted it to the
    top. Asking "does this table contain 完全失業率?" is the question that
    actually distinguishes them.
    """
    # Each keyword is a different slice of the catalogue; pooling them widens
    # the candidate set without loosening the metadata check that follows.
    words = list(spec.search_words) or [spec.search_word]
    frames = []
    for word in words:
        try:
            frames.append(search(stats_code=spec.stats_code, word=word or None,
                                 limit=limit))
        except EStatError:
            continue
    frames = [f for f in frames if not f.empty]
    catalogue = (pd.concat(frames, ignore_index=True).drop_duplicates(subset=["id"])
                 if frames else pd.DataFrame())
    if catalogue.empty:
        raise EStatError(
            f"{spec.name}: no tables under statistics code {spec.stats_code}. "
            "Run `python refresh.py --estat-search \"<words>\"` to find the "
            "right code."
        )

    catalogue = catalogue.copy()
    catalogue["score"] = [
        _score(f"{t} {s}", spec)
        for t, s in zip(catalogue["title"], catalogue["statistic"])
    ]
    if spec.prefer_cycle:
        catalogue.loc[catalogue["cycle"].str.contains(spec.prefer_cycle,
                                                      na=False), "score"] += 2
    ranked = catalogue.sort_values(["score", "updated"], ascending=[False, False])

    problems: list[str] = []
    for _, row in ranked.head(MAX_CANDIDATES).iterrows():
        table_id, title = str(row["id"]), str(row["title"])
        try:
            classes = get_meta(table_id)
            latest = newest_period(classes)
            if latest is not None:
                age = (pd.Timestamp.today() - latest).days
                if age > MAX_TABLE_AGE_DAYS:
                    raise EStatError(
                        f"retired vintage — newest period {latest:%Y-%m}, "
                        f"{age} days old")
            params, notes = match_codes(classes, spec)
        except EStatError as exc:
            problems.append(f"{table_id} {title[:44]} — {str(exc)[:110]}")
            time.sleep(0.15)
            continue
        return table_id, title, params, notes

    raise EStatError(
        f"{spec.name}: checked {len(problems)} candidate tables under code "
        f"{spec.stats_code}, none contained what the spec asks for.\n      "
        + "\n      ".join(problems[:4])
    )


def pick_series(frame: pd.DataFrame, spec: TableSpec) -> pd.Series:
    """
    Reduce a table to the single series the spec describes.

    Deliberately strict. If the filters leave more than one series standing,
    this raises and names what is left rather than taking the first - an
    unlabelled guess between "All items" and "All items less fresh food" is
    exactly the error nobody would catch by looking at the chart.
    """
    working = frame.copy()
    dimensions = [c for c in working.columns if c not in ("Date", "Value")]

    for wanted_dim, pattern in spec.select.items():
        # A "code:" selector was already applied server-side, as a cdCat/cdArea
        # parameter. The downloaded frame carries LABELS, not codes, so
        # re-applying it here can only fail - which is exactly what it did:
        # resolution reported 地域=全国 correctly, then this loop looked for a
        # label literally called "code:00000" and threw the table away.
        if pattern.startswith("code:"):
            continue
        column = next((c for c in dimensions if wanted_dim in c), None)
        if column is None:
            continue
        matched = working[working[column].astype(str).str.contains(
            pattern, regex=True, na=False)]
        if matched.empty:
            options = sorted(working[column].dropna().unique())[:8]
            raise EStatError(
                f"{spec.name}: nothing in '{column}' matches /{pattern}/. "
                f"Available: {', '.join(map(str, options))}"
            )
        working = matched

    remaining = [c for c in dimensions
                 if working[c].nunique(dropna=True) > 1]
    if remaining:
        detail = "; ".join(
            f"{c} = {', '.join(map(str, sorted(working[c].dropna().unique())[:6]))}"
            for c in remaining[:3])
        raise EStatError(
            f"{spec.name}: the filters leave {len(working)} rows across more "
            f"than one series — {detail}. The spec needs another filter; "
            "refusing to guess which column is the right one."
        )

    series = (working.set_index("Date")["Value"]
                     .dropna().sort_index())
    series = series[~series.index.duplicated(keep="last")]
    if series.empty:
        raise EStatError(f"{spec.name}: filters left no observations.")
    series.name = spec.name
    return series


def fetch_spec(spec: TableSpec, verbose: bool = True) -> tuple[pd.Series, str]:
    """Resolve, download and reduce one spec. Returns (series, table title)."""
    table_id, title, params, notes = resolve(spec, verbose=verbose)
    if verbose:
        print(f"  [find] {spec.name:<28} table {table_id}  {title[:52]}")
        print(f"         filtered to  {' · '.join(notes)}")
    # The filters go to the SERVER. Without them the 2025-base CPI table is
    # 3.3 million records against a 100,000-record response cap - the series
    # wanted may simply not be in what comes back.
    series = pick_series(fetch_table(table_id, **params), spec)
    time.sleep(0.2)
    return series, title


def describe_metadata(stats_data_id: str, max_members: int = 14) -> str:
    """Human-readable dump of a table's classifications and their members."""
    try:
        classes = get_meta(stats_data_id)
    except EStatError as exc:
        return f"      (metadata unavailable: {exc})"
    lines = []
    for obj in classes:
        members = _as_list(obj.get("CLASS"))
        shown = ", ".join(f"{m.get('@code')}={normalise(m.get('@name',''))}"
                          for m in members[:max_members])
        more = f"  …and {len(members) - max_members} more" if len(members) > max_members else ""
        lines.append(f"      {obj.get('@id')}  {obj.get('@name')}  "
                     f"({len(members)} members)")
        lines.append(f"         {shown}{more}")
    return "\n".join(lines)


def candidates_for(spec: "TableSpec", limit: int = 100) -> pd.DataFrame:
    """The ranked candidate tables for a spec, without opening any metadata."""
    words = list(spec.search_words) or [spec.search_word]
    frames = []
    for word in words:
        try:
            frames.append(search(stats_code=spec.stats_code, word=word or None,
                                 limit=limit))
        except EStatError:
            continue
    frames = [f for f in frames if not f.empty]
    if not frames:
        return pd.DataFrame()
    catalogue = pd.concat(frames, ignore_index=True).drop_duplicates(subset=["id"])
    if catalogue.empty:
        return catalogue
    catalogue = catalogue.copy()
    catalogue["score"] = [_score(f"{a} {b}", spec)
                          for a, b in zip(catalogue["title"], catalogue["statistic"])]
    if spec.prefer_cycle:
        catalogue.loc[catalogue["cycle"].str.contains(spec.prefer_cycle, na=False),
                      "score"] += 2
    return catalogue.sort_values(["score", "updated"], ascending=[False, False])


def describe_resolution(verbose: bool = True) -> pd.DataFrame:
    """
    Try every spec and report what happened.

    This is the command to run first: it proves the application ID works and
    shows which table each series resolved to, so a wrong match is caught
    before it reaches the calendar.
    """
    # Fail once, up front, on the thing that is wrong for every spec at once.
    # Reporting "no application ID" separately per series buries the one line
    # that matters under repetition.
    get_app_id()

    rows = []
    for spec in JAPAN_SPECS:
        try:
            series, title = fetch_spec(spec, verbose=verbose)
            rows.append({
                "Series": spec.name, "Status": "ok", "Table": title[:60],
                "Observations": len(series),
                "From": f"{series.index.min():%Y-%m}",
                "To": f"{series.index.max():%Y-%m}",
                "Latest": round(float(series.iloc[-1]), 2),
            })
        except EStatError as exc:
            rows.append({"Series": spec.name, "Status": "FAILED",
                         "Table": "see the detail printed above",
                         "Observations": 0, "From": "", "To": "", "Latest": None})
            if verbose:
                # Printed, not tabulated. A DataFrame column truncates the
                # message precisely where the useful part begins - which is
                # how two rounds of diagnosis went by without the actual
                # member names ever being visible.
                print(f"\n  FAILED  {spec.name}")
                print(f"    {exc}")
                top = candidates_for(spec).head(2)
                for _, row in top.iterrows():
                    print(f"\n    Candidate {row['id']}  {row['title']}")
                    print(describe_metadata(str(row["id"])))
                print()
    return pd.DataFrame(rows)
