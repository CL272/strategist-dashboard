"""
Strategist View — the one screen before a meeting
=================================================
Reads every other module's cache and answers five questions: where we are,
what it costs, what moved, how fragile the system is, and what is coming.

Fetches nothing of its own. If a block is missing this page says so and carries
on with the rest, because a partial answer beats a blank page.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import ui
from data.composite import block_composites, stress_percentiles
from ui import FULL_WIDTH, PALETTE, get, style_fig

#: Horizons for the "where we are" table, in calendar days.
HORIZONS = {"1w": 7, "1m": 30, "3m": 91, "12m": 365}

#: How many years of weekly changes each move is ranked against.
Z_WINDOW_YEARS = 5
#: A weekly change needs at least this many prior weeks to be scored at all.
Z_MIN_WEEKS = 60


@dataclass(frozen=True)
class Watch:
    group: str
    label: str
    block: str          # cache name
    column: str
    kind: str           # "price" | "rate" | "index"


#: What the page watches. `kind` decides the arithmetic AND the sign:
#:   price  - percentage change; up is up
#:   rate   - basis-point change on a series quoted in percent
#:   index  - plain point change (VIX, NFCI, a $bn balance)
WATCH: tuple[Watch, ...] = (
    # One line per region, plus the two US/Japan pairs a strategist is
    # normally asked about. DAX and FTSE 100 are not here: both sit inside
    # MSCI Europe, and they are still on the Global Equity page in full.
    Watch("Equity", "S&P 500", "equity", "S&P 500", "price"),
    Watch("Equity", "NASDAQ Composite", "equity", "NASDAQ Composite", "price"),
    Watch("Equity", "MSCI Europe", "equity", "MSCI Europe", "price"),
    Watch("Equity", "TOPIX", "equity", "TOPIX", "price"),
    Watch("Equity", "Nikkei 225", "equity", "Nikkei 225", "price"),
    Watch("Equity", "MSCI AC Asia ex Japan", "equity",
          "MSCI AC Asia ex Japan", "price"),
    Watch("Equity", "Hang Seng", "equity", "Hang Seng", "price"),
    Watch("Equity", "KOSPI", "equity", "KOSPI", "price"),
    Watch("Equity", "Nifty 50", "equity", "Nifty 50", "price"),
    Watch("Equity", "FBM KLCI", "equity", "FBM KLCI", "price"),

    Watch("Rates", "US 2y", "curves", "US 2Y", "rate"),
    Watch("Rates", "US 10y", "curves", "US 10Y", "rate"),
    Watch("Rates", "US 10y real", "curves", "US real 10Y", "rate"),
    Watch("Rates", "Euro area 10y", "curves", "EA 10Y", "rate"),
    Watch("Rates", "JGB 10y", "curves", "JP 10Y", "rate"),
    Watch("Rates", "JGB 30y", "curves", "JP 30Y", "rate"),
    Watch("Rates", "MGS 10y", "curves", "MY 10Y", "rate"),

    Watch("Credit & risk", "HY OAS", "credit", "HY OAS", "rate"),
    Watch("Credit & risk", "Baa − 10y", "credit", "Baa - 10y spread", "rate"),
    Watch("Credit & risk", "VIX", "credit", "VIX", "index"),
    Watch("Credit & risk", "NFCI", "credit", "NFCI", "index"),

    Watch("Currency", "USD/JPY", "rates", "USD/JPY", "price"),
    Watch("Currency", "USD/MYR", "rates", "USD/MYR", "price"),
    Watch("Currency", "EUR/USD", "rates", "EUR/USD", "price"),
    Watch("Currency", "Broad dollar", "rates", "Broad dollar index", "price"),

    Watch("Liquidity", "Net liquidity", "liquidity", "Net_Liquidity_Bil", "price"),
    Watch("Liquidity", "SOFR − IORB", "liquidity", "SOFR_IORB_Spread_bps", "index"),
    Watch("Liquidity", "Reserves / GDP", "liquidity", "Reserves_to_GDP_%", "index"),
)

BLOCKS = ("equity", "curves", "credit", "rates", "liquidity", "growth",
          "valuation", "calendar")


# --------------------------------------------------------------------------- #
# Load
# --------------------------------------------------------------------------- #

cache = {name: ui.load_block(name) for name in BLOCKS}
cache = {k: v for k, v in cache.items() if v is not None and not v.empty}

if not cache:
    st.error(
        "No cached data found.\n\nRun this in the project folder, then reload:\n\n"
        "```\npython refresh.py\n```"
    )
    st.stop()

missing = [b for b in BLOCKS if b not in cache]


def series_for(item: Watch) -> pd.Series | None:
    frame = cache.get(item.block)
    if frame is None:
        return None
    return get(frame, item.column)


live = [(w, s) for w in WATCH if (s := series_for(w)) is not None]


# --------------------------------------------------------------------------- #
# Arithmetic
# --------------------------------------------------------------------------- #

def change(series: pd.Series, days: int, kind: str) -> float | None:
    """The move over `days`, in the unit that suits the series."""
    clean = series.dropna()
    if clean.empty:
        return None
    past = clean.loc[:clean.index[-1] - pd.Timedelta(days=days)]
    if past.empty:
        return None
    now, then = float(clean.iloc[-1]), float(past.iloc[-1])
    if kind == "price":
        return None if then == 0 else (now / then - 1.0) * 100.0
    if kind == "rate":
        return (now - then) * 100.0          # percent -> basis points
    return now - then


def weekly_changes(series: pd.Series, kind: str) -> pd.Series:
    """The whole history of week-on-week moves, in the same unit as `change`."""
    weekly = series.dropna().resample("W-FRI").last().dropna()
    if len(weekly) < 3:
        return pd.Series(dtype="float64")
    if kind == "price":
        return (weekly.pct_change() * 100.0).dropna()
    if kind == "rate":
        return (weekly.diff() * 100.0).dropna()
    return weekly.diff().dropna()


def z_of_last(series: pd.Series, kind: str) -> tuple[float, float] | None:
    """
    (latest weekly move, how unusual it is in sigma).

    Ranked against the trailing five years of that same series' OWN weekly
    moves. This is the part that makes the table readable across asset classes:
    fifteen basis points on JGBs and fifteen on Treasuries are the same number
    and nothing like the same event, and only the distribution knows that.

    Deliberately NOT a percentile. The question here is "how big, and which
    way", and a z-score keeps the sign and the magnitude in one figure.
    """
    moves = weekly_changes(series, kind)
    if len(moves) < Z_MIN_WEEKS:
        return None
    window = moves.loc[moves.index[-1] - pd.DateOffset(years=Z_WINDOW_YEARS):]
    if len(window) < Z_MIN_WEEKS:
        window = moves
    spread = float(window.std())
    latest = float(moves.iloc[-1])
    if not np.isfinite(spread) or spread == 0:
        return None
    return latest, (latest - float(window.mean())) / spread


def unit_of(kind: str) -> str:
    return {"price": "%", "rate": "bp"}.get(kind, "")


# --------------------------------------------------------------------------- #
# Header
# --------------------------------------------------------------------------- #

as_of = max((s.dropna().index.max() for _, s in live), default=pd.Timestamp.today())

st.title("Strategist View")
st.markdown(
    f"<p class='caption-note'>Data through <b>{as_of:%d %B %Y}</b> · "
    f"{len(live)} series across {len(set(w.group for w, _ in live))} asset classes · "
    "every number below comes from another page, nothing is fetched here</p>",
    unsafe_allow_html=True,
)

ui.explainer("""
    **What this page is for.** One screen, before a meeting. It answers five
    questions in order — where we are, what it costs, what moved, how fragile
    the system is, and what is coming — and then sends you to the module that
    explains any of them properly.

    **What it deliberately does not do.** There is no single risk-on / risk-off
    verdict, no score out of ten, no traffic light for "the market". Every
    such number is a weighted average of judgements someone made in advance,
    and a dashboard that prints one will eventually print a confident wrong one
    in front of your investment committee. The composite stress reading below
    is the closest thing here, and it is a **percentile of observed
    conditions**, not a forecast.

    **The one idea worth understanding: what "σ" means in the second section.**
    Each series is ranked against **its own** history of weekly moves over the
    last five years. Fifteen basis points on a JGB and fifteen on a Treasury are
    the same number and nothing like the same event; a 2% week in the KLCI and
    a 2% week in the Nasdaq are not comparable either. Dividing by each series'
    own volatility is what makes them sit on one axis honestly. **2σ means a
    move that size happens about one week in twenty** for that series.

    **What it cannot tell you.** Why anything moved. A large σ says something
    happened, not what, and the cause is frequently something this dashboard
    does not track — a headline, a flow, a position being unwound. Treat the
    ranking as a list of questions, not answers.
""")

if missing:
    st.warning(
        f"**Not loaded:** {', '.join(missing)}. This page is showing what it "
        "has. Run `python refresh.py` to fill the gaps."
    )

st.write("")


# --------------------------------------------------------------------------- #
# 1. Where we are
# --------------------------------------------------------------------------- #

st.subheader("Where we are")

rows = []
for item, series in live:
    clean = series.dropna()
    row = {"Class": item.group, "Series": item.label,
           "Latest": float(clean.iloc[-1]),
           # This is the unit of the four CHANGE columns, not of Latest: the
           # Nasdaq's level is an index and its move is a percent, HY OAS is
           # quoted in percent and its move is in basis points. Headed
           # "Change in" so it cannot be read as describing Latest.
           "Change in": unit_of(item.kind) or "pts"}
    for name, days in HORIZONS.items():
        row[name] = change(series, days, item.kind)
    row["As of"] = f"{clean.index[-1]:%d %b}"
    rows.append(row)

if not rows:
    st.info("Nothing loaded yet.")
else:
    # Kept as plain columns rather than a MultiIndex: Streamlit gives index
    # levels a fixed narrow width and "Credit & risk" renders as "Credit & ri".
    table = pd.DataFrame(rows)[
        ["Class", "Series", "Latest", "Change in", *HORIZONS, "As of"]]
    styled = table.style.format(
        {"Latest": "{:,.2f}", **{h: "{:+,.1f}" for h in HORIZONS}}, na_rep="—")
    styled = ui.heat_map(styled, ["1w", "1m"], vmin=-8, vmax=8)
    styled = ui.heat_map(styled, ["3m", "12m"], vmin=-20, vmax=20)
    st.dataframe(
        styled,
        **FULL_WIDTH, hide_index=True,
        height=min(36 * len(rows) + 60, 760))
    st.caption(
        "**Latest** is each series in the unit it is published in; the four "
        "change columns are in the unit named by **Change in** — percent for "
        "equities and currencies, basis points for yields and spreads, plain "
        "points for everything else. The colour is a "
        "rough visual sort, not a signal — and green on a yield row means the "
        "yield fell, which is good for a bondholder and not necessarily good "
        "for anything else."
    )

st.divider()


# --------------------------------------------------------------------------- #
# 2. What it costs
# --------------------------------------------------------------------------- #
# A snapshot, deliberately not part of the table above. SSGA publishes today's
# characteristics and no history at all, so these have no 1w/1m/3m/12m to show
# and would sit in that table as four empty columns.

st.subheader("What it costs")

valuation = cache.get("valuation")
forward_columns = sorted(
    c for c in (valuation.columns if valuation is not None else [])
    if c.endswith(" forward P/E"))

if not forward_columns:
    st.info(
        "No forward multiples cached. Run `python refresh.py --block Valuation` "
        "— SSGA publishes a snapshot, so each run adds one reading."
    )
else:
    # Named apart from the page-level `as_of` in the header, which is the max
    # date across every watched series and must not be overwritten here.
    dated = valuation[forward_columns].dropna(how="all")
    costs_as_of = dated.index.max()

    METRICS = (("forward P/E", "Forward P/E"),
               ("trailing P/E", "Trailing P/E"),
               ("P/B", "P/B"),
               ("P/CF", "P/CF"),
               ("dividend yield", "Dividend yield %"),
               ("est. EPS growth", "Est. EPS growth %"))

    snapshot = []
    for column in forward_columns:
        region = column[:-len(" forward P/E")]
        row = {"Region": region}
        for metric, label in METRICS:
            source = f"{region} {metric}"
            if source in valuation.columns:
                values = valuation[source].dropna()
                if len(values):
                    row[label] = float(values.iloc[-1])
        # What the market is paying for, not a forecast: the earnings growth
        # that would have to arrive for today's price to become the forward
        # multiple. Needs both legs, and the forward leg cannot be zero.
        if row.get("Trailing P/E") and row.get("Forward P/E"):
            row["Implied growth %"] = (
                row["Trailing P/E"] / row["Forward P/E"] - 1) * 100
        snapshot.append(row)

    costs = pd.DataFrame(snapshot)
    st.dataframe(
        costs.style.format({c: "{:,.2f}" for c in costs.columns if c != "Region"},
                           na_rep="—"),
        **FULL_WIDTH, hide_index=True,
        height=36 * len(costs) + 60)
    st.caption(
        f"State Street SPDR fund characteristics, **{costs_as_of:%d %b %Y}** — the "
        "only free published forward earnings multiple. Two caveats that matter: "
        "these are the multiples of each SPDR **fund's holdings**, not of the "
        "index itself, and they are weighted *harmonic* averages, which is the "
        "right way to aggregate a P/E and not the same statistic as a simple "
        "index ratio. **There is no history** — SSGA publishes today's table and "
        "nothing else, so this grows forward one row per refresh and cannot be "
        "backfilled. Japan and Malaysia have no SPDR line and do not appear."
    )

st.divider()


# --------------------------------------------------------------------------- #
# 3. What moved
# --------------------------------------------------------------------------- #

st.subheader("What moved this week")

scored = []
for item, series in live:
    result = z_of_last(series, item.kind)
    if result is None:
        continue
    move, z = result
    if not np.isfinite(z):
        continue
    scored.append({"Series": item.label, "Group": item.group,
                   "Move": move, "z": z, "Unit": unit_of(item.kind)})

if not scored:
    st.info(
        "Not enough weekly history yet to rank moves. Each series needs about "
        f"{Z_MIN_WEEKS} weeks before a move can be called unusual."
    )
else:
    ranked = (pd.DataFrame(scored)
              .assign(size=lambda f: f["z"].abs())
              .sort_values("size", ascending=False)
              .head(16)
              .sort_values("z"))

    colours = [PALETTE["red"] if abs(z) >= 2 else
               PALETTE["amber"] if abs(z) >= 1 else PALETTE["slate"]
               for z in ranked["z"]]
    labels = [f"{m:+,.1f}{u}" for m, u in zip(ranked["Move"], ranked["Unit"])]

    fig = go.Figure(go.Bar(
        x=ranked["z"], y=ranked["Series"], orientation="h",
        marker_color=colours, text=labels, textposition="outside",
        customdata=np.stack([ranked["Group"], ranked["Move"]], axis=-1),
        hovertemplate="%{y} (%{customdata[0]})<br>%{x:.2f}σ<extra></extra>"))
    for level, note in ((2, "2σ · about one week in twenty"),
                        (-2, "")):
        fig.add_vline(x=level, line=dict(color=PALETTE["red"], width=1.1,
                                         dash="dot"),
                      annotation_text=note, annotation_position="top",
                      annotation_font=dict(color=PALETTE["red"], size=10),
                      annotation_bgcolor="rgba(22,26,35,0.82)")
    fig.add_vline(x=0, line=dict(color=PALETTE["muted"], width=1.1))
    fig.update_xaxes(title_text="Weekly move, in standard deviations of its own "
                                "5-year history")
    fig.update_yaxes(title_text="")
    st.plotly_chart(
        style_fig(fig, 110 + 34 * len(ranked),
                  "This week's moves, scaled by each series' own volatility",
                  range_controls=False),
        **FULL_WIDTH)

    notable = ranked.reindex(ranked["z"].abs().sort_values(ascending=False).index)
    top = notable.head(3)
    st.caption(
        "Biggest: " + " · ".join(
            f"**{r.Series}** {r.Move:+,.1f}{r.Unit} ({r.z:+.1f}σ)"
            for r in top.itertuples())
        + ".  The label on each bar is the actual move; the axis is how "
          "unusual it is. A large bar with a small label is a quiet series "
          "doing something out of character, which is often the more "
          "interesting of the two."
    )

st.divider()


# --------------------------------------------------------------------------- #
# 4. How fragile
# --------------------------------------------------------------------------- #

st.subheader("How fragile")

stress_frames = {}
for block, name in (("Funding", "liquidity"), ("Credit", "credit"),
                    ("Growth", "growth")):
    if name in cache:
        stress_frames[block] = cache[name]

if not stress_frames:
    st.info("The stress blocks are not cached. Run `python refresh.py`.")
else:
    percentiles, meta = stress_percentiles(stress_frames, window_years=10)
    blocks = block_composites(percentiles, meta)
    if blocks.empty:
        st.info("Not enough weekly history to rank anything yet.")
    else:
        latest = blocks.dropna(how="all").iloc[-1]
        composite = float(latest.get("Composite", float("nan")))
        week = blocks.dropna(how="all").index[-1]

        boxes = st.columns(len(latest))
        ordered = ["Composite"] + [c for c in latest.index if c != "Composite"]
        for box, name in zip(boxes, ordered):
            value = float(latest[name])
            if not np.isfinite(value):
                continue
            prior = blocks[name].dropna()
            delta = (value - float(prior.iloc[-5])) if len(prior) >= 5 else None
            box.metric(f"{name}" + (" (all blocks)" if name == "Composite" else ""),
                       ui.ordinal(value),
                       None if delta is None else f"{delta:+.0f} pts 4w",
                       delta_color="off")

        st.caption(
            f"Week ending **{week:%d %B %Y}**, ranked against ten years of "
            "weekly history. Each block is the unweighted mean of its members' "
            "percentiles, and the composite the unweighted mean of the blocks — "
            "so a block with more series does not get more votes. "
            f"**{ui.ordinal(composite)} percentile** means conditions have been "
            f"calmer than this about {composite:.0f}% of the weeks in that "
            "ten-year window. The Stress Panel breaks it down indicator by "
            "indicator."
        )

st.divider()


# --------------------------------------------------------------------------- #
# 5. What's next
# --------------------------------------------------------------------------- #

st.subheader("What's next")

calendar = cache.get("calendar")
if calendar is None:
    st.info("The calendar is not cached. Run `python refresh.py --block Calendar`.")
else:
    frame = calendar.copy()
    if "Date" in frame.columns:
        frame["Date"] = pd.to_datetime(frame["Date"], errors="coerce")
        today = pd.Timestamp.today().normalize()
        horizon = st.segmented_control(
            "Window", ["Next 7 days", "Next 14 days", "Next 30 days"],
            default="Next 14 days", key="strat_horizon") \
            if hasattr(st, "segmented_control") else "Next 14 days"
        days = int((horizon or "Next 14 days").split()[1])

        upcoming = frame[(frame["Date"] >= today)
                         & (frame["Date"] <= today + pd.Timedelta(days=days))]
        upcoming = upcoming.sort_values("Date")

        if upcoming.empty:
            st.info(f"Nothing scheduled in the next {days} days.")
        else:
            show = upcoming.copy()
            show["When"] = show["Date"].map(
                lambda d: f"{d:%a %d %b}"
                + (" · today" if d == today else
                   f" · in {int((d - today).days)}d"))
            keep = [c for c in ("When", "Region", "Event", "Kind", "Confidence")
                    if c in show.columns]
            st.dataframe(show[keep].reset_index(drop=True),
                         **FULL_WIDTH, hide_index=True,
                         height=min(38 * len(show) + 60, 520))
            st.caption(
                f"**{len(upcoming)}** scheduled item(s) in the next {days} days. "
                "Dates marked lower-confidence on the Calendar tab are inferred "
                "from past release cadence rather than announced, so treat them "
                "as approximate."
            )
    else:
        st.info("The cached calendar has no Date column — re-run "
                "`python refresh.py --block Calendar`.")
