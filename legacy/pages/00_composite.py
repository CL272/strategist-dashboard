"""
Stress Panel
============
The landing page. Every tracked indicator percentile-ranked against its own
trailing history, sign-aligned so higher always means more stress, averaged
within block and then across blocks.

Weekly grid — see data/composite.py for why.

Second tab is the release and decision calendar (data/econ_calendar.py,
calendar_view.py).
"""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import calendar_view
import ui
from data.composite import (band, block_composites, latest_snapshot,
                            percentile_of, stress_percentiles)
from data.ofr import CATEGORIES, REGIONS
from ui import FULL_WIDTH, PALETTE, style_fig

BLOCK_ORDER = ("Funding", "Credit", "Growth")

# Calm -> acute. Deliberately not a rainbow: one hue family until things are
# genuinely bad, so red means something when it appears.
STRESS_SCALE = [
    [0.00, "#0F3B33"],
    [0.25, "#1C6B5C"],
    [0.50, "#4A5568"],
    [0.72, "#8A6A1F"],
    [0.85, "#C4831F"],
    [1.00, "#C1414E"],
]

# --------------------------------------------------------------------------- #
# Load
# --------------------------------------------------------------------------- #

frames = {}
for block, cache_name in (("Funding", "liquidity"), ("Credit", "credit"),
                          ("Growth", "growth")):
    frame = ui.load_block(cache_name)
    if frame is not None and not frame.empty:
        frames[block] = frame

if not frames:
    st.error(
        "No cached data found.\n\nRun this in the project folder, then reload:\n\n"
        "```\npython refresh.py\n```"
    )
    st.stop()

missing = [b for b in BLOCK_ORDER if b not in frames]

# --------------------------------------------------------------------------- #
# Sidebar
# --------------------------------------------------------------------------- #

window_years = st.sidebar.slider(
    "Trailing window (years)", 3, 20, 10, key="comp_window",
    help="How much history each indicator is ranked against. Longer is more "
         "stable; shorter reacts faster to a changed regime.",
)
percentiles, meta = stress_percentiles(frames, window_years=window_years)

if percentiles.empty:
    st.error(
        "Not enough history to rank anything. The percentile window needs at "
        "least two years of weekly data.\n\nTry:\n\n```\npython refresh.py "
        "--start 2005-01-01\n```"
    )
    st.stop()

blocks = block_composites(percentiles, meta)
snapshot = latest_snapshot(percentiles, meta, frames)

# Full history: every chart carries its own range buttons and slider.
view = percentiles
block_view = blocks

st.sidebar.divider()
ui.download_button(percentiles, "stress_percentiles")

# --------------------------------------------------------------------------- #
# Header
# --------------------------------------------------------------------------- #

composite_now = float(blocks["Composite"].dropna().iloc[-1])
as_of = blocks["Composite"].dropna().index[-1]

st.title("Stress Panel")
st.markdown(
    f"<p class='caption-note'>Week ending <b>{as_of:%d %B %Y}</b> · "
    f"{len(meta)} indicators across {len(blocks.columns) - 1} blocks · "
    f"ranked against {window_years} years of weekly history</p>",
    unsafe_allow_html=True,
)
if missing:
    st.warning(
        f"Missing block(s): {', '.join(missing)}. The composite is being computed "
        f"without them — run `python refresh.py` to fill the gaps."
    )
st.write("")

tab_panel, tab_calendar = st.tabs([
    "🌡️  Stress Panel",
    "🗓️  Calendar",
])


with tab_panel:
    ui.explainer("""
        **What this is.** One number per week answering "how unusual are
        conditions right now, compared with the recent past?" Everything on the
        other three pages is folded into it.

        **How a reading is built.** Each indicator is ranked against its own
        history — not against other indicators. A reading of **80** means "this
        series has been below today's level 80% of the time over the trailing
        window". Series where a *low* number is the worrying one (bank reserves,
        say) are flipped first, so on this page **higher always means more
        stressed**, whatever the underlying series does.

        **Reading the numbers.**

        | Percentile | Reading |
        |---|---|
        | below 25 | calm — conditions unusually easy |
        | 25–75 | normal |
        | 75–90 | elevated — worth opening the module page |
        | above 90 | acute — this has been rarer than one week in ten |

        **The three blocks.** *Funding* is the Fed's plumbing — reserves, repo,
        the balance sheet. *Credit* is what borrowing costs and how nervous
        markets are. *Growth* is the real economy — surveys, jobless claims.
        They are averaged inside each block first, then with each other, so a
        block with more members does not outvote one with fewer.

        **The slider in the sidebar** sets how much history each indicator is
        ranked against. Ten years is the default. Shorter reacts faster but
        cries wolf more often.

        **What it cannot tell you.** A percentile says where something sits in
        its *own recent* distribution — not whether that distribution is
        dangerous. After a decade of ample reserves, mild scarcity looks
        extreme. This is a triage tool for deciding which page to open next,
        not a signal to trade off.
                """)
    st.write("")

    cols = st.columns(len(blocks.columns))
    ordered = [c for c in BLOCK_ORDER if c in blocks.columns] + ["Composite"]

    for col, name in zip(cols, ordered):
        series = blocks[name].dropna()
        if series.empty:
            continue
        now = float(series.iloc[-1])
        prior = series.loc[:series.index[-1] - pd.Timedelta(weeks=4)]
        delta = None if prior.empty else f"{now - float(prior.iloc[-1]):+.0f} pts (4wk)"
        col.metric(
            "Composite" if name == "Composite" else f"{name} block",
            f"{ui.ordinal(now)}",
            delta,
            delta_color="inverse",
            help=f"{band(now)}. Percentile of the block average against "
                 f"{window_years} years of weekly history.",
        )

    st.write("")

    # --------------------------------------------------------------------------- #
    # Composite over time
    # --------------------------------------------------------------------------- #

    ui.range_picker(block_view.index, "comp_range")

    fig = go.Figure()
    for name, colour in zip([c for c in BLOCK_ORDER if c in block_view.columns],
                            (PALETTE["blue"], PALETTE["amber"], PALETTE["cyan"])):
        fig.add_trace(go.Scatter(
            x=block_view.index, y=block_view[name], name=f"{name} block",
            line=dict(color=colour, width=1.6), opacity=0.75,
            hovertemplate=f"{name}: %{{y:.0f}}<extra></extra>"))

    fig.add_trace(go.Scatter(
        x=block_view.index, y=block_view["Composite"], name="Composite",
        line=dict(color=PALETTE["text"], width=3.0),
        hovertemplate="Composite: %{y:.0f}<extra></extra>"))

    for level, label, colour in ((75, "75th — elevated", PALETTE["amber"]),
                                 (90, "90th — acute", PALETTE["red"])):
        fig.add_hline(y=level, line=dict(color=colour, width=1.1, dash="dot"),
                      annotation_text=label, annotation_position="top left",
                      annotation_font=dict(color=colour, size=10),
                      annotation_bgcolor="rgba(22,26,35,0.82)", annotation_borderpad=2)

    fig.update_yaxes(title_text="Percentile", range=[0, 100])
    st.plotly_chart(style_fig(fig, 420, "Composite Stress Over Time"), **FULL_WIDTH)

    st.divider()

    # --------------------------------------------------------------------------- #
    # Independent cross-check - OFR Financial Stress Index
    # --------------------------------------------------------------------------- #

    ofr = ui.load_block("ofr")

    if ofr is None or ofr.empty or "OFR FSI" not in ofr.columns:
        with st.expander("Cross-check against the OFR Financial Stress Index"):
            st.info(
                "No OFR data cached. Run `python refresh.py --block External` to add "
                "it — no API key needed. It is a fully independent index, which is "
                "what makes it useful for checking this panel."
            )
    else:
        st.subheader("Cross-check — OFR Financial Stress Index")

        ofr_level = ofr["OFR FSI"].dropna()
        ofr_pct = percentile_of(ofr_level, window_years=window_years)
        ours = blocks["Composite"].dropna()

        # sort=True is explicit: pandas warns when concatenating DatetimeIndexes
        # without it, and the comparison is meaningless if the two are misaligned.
        paired = pd.concat({"Ours": ours, "OFR": ofr_pct}, axis=1, sort=True).dropna()

        if paired.empty:
            st.info(
                "Not enough overlapping history to compare. Try a shorter trailing "
                "window, or refresh with more history."
            )
        else:
            latest = paired.iloc[-1]
            gap = float(latest["Ours"] - latest["OFR"])

            c1, c2, c3, c4 = st.columns(4)
            c1.metric("OFR FSI level", f"{float(ofr_level.iloc[-1]):+.2f}",
                      help="Zero is the OFR's own historical average. "
                           f"As of {ofr_level.index[-1]:%d %b %Y}.")
            c2.metric("OFR percentile", ui.ordinal(latest["OFR"]),
                      help="Ranked on the same weekly, trailing basis as our panel.")
            c3.metric("Our composite", ui.ordinal(latest["Ours"]))
            c4.metric("Divergence", f"{gap:+.0f} pts",
                      help="Ours minus OFR. Positive means our panel sees more "
                           "stress than market pricing alone does.")

            window = paired
            correlation = window["Ours"].corr(window["OFR"])

            fig_x = go.Figure()
            fig_x.add_trace(go.Scatter(
                x=window.index, y=window["OFR"], name="OFR FSI (percentile)",
                line=dict(color=PALETTE["violet"], width=2.0),
                hovertemplate="OFR: %{y:.0f}<extra></extra>"))
            fig_x.add_trace(go.Scatter(
                x=window.index, y=window["Ours"], name="Our composite",
                line=dict(color=PALETTE["text"], width=2.6),
                fill="tonexty", fillcolor="rgba(148,163,184,0.13)",
                hovertemplate="Ours: %{y:.0f}<extra></extra>"))
            fig_x.update_yaxes(title_text="Percentile", range=[0, 100])
            st.plotly_chart(
                style_fig(fig_x, 400,
                          "Our Composite vs. an Independently Built Index"),
                **FULL_WIDTH)

            st.caption(
                f"Correlation over the full overlap: **{correlation:.2f}**. The "
                "shaded gap is the disagreement. The OFR index is built entirely "
                "from **market prices** — spreads, implied vols, valuations, funding "
                "rates. Our panel also carries quantity data (reserves, repo take-up, "
                "the discount window) and real-economy data (claims, surveys) that no "
                "market price reflects directly. So a gap is usually information, not "
                "error: **ours above OFR** means the plumbing or the real economy is "
                "flagging something markets have not priced; **OFR above ours** means "
                "markets are pricing stress our fundamentals do not yet show."
            )

            with st.expander("OFR decomposition — categories and regions"):
                cats = [c for c in CATEGORIES if c in ofr.columns]
                regs = [r for r in REGIONS if r in ofr.columns]
                recent = ofr

                if cats:
                    f_cat = go.Figure()
                    for name, colour in zip(cats, ui.SERIES_COLORS):
                        f_cat.add_trace(go.Scatter(
                            x=recent.index, y=recent[name],
                            name=name.replace("OFR - ", "").title(),
                            stackgroup="one", line=dict(width=0.5, color=colour),
                            hovertemplate="%{y:+.2f}<extra></extra>"))
                    f_cat.update_yaxes(title_text="Contribution to the index")
                    st.plotly_chart(
                        style_fig(f_cat, 380, "Contribution by Category"), **FULL_WIDTH)
                    st.caption(
                        "Contributions sum to the headline index. **Funding** is the "
                        "category that overlaps our own Funding block — when those two "
                        "disagree, one of them is wrong about the plumbing."
                    )

                if regs:
                    f_reg = go.Figure()
                    for name, colour in zip(regs, (PALETTE["blue"], PALETTE["amber"],
                                                   PALETTE["red"])):
                        f_reg.add_trace(go.Scatter(
                            x=recent.index, y=recent[name],
                            name=name.replace("OFR - ", ""),
                            line=dict(color=colour, width=1.9),
                            hovertemplate="%{y:+.2f}<extra></extra>"))
                    f_reg.update_yaxes(title_text="Contribution to the index")
                    st.plotly_chart(
                        style_fig(f_reg, 360, "Contribution by Region"), **FULL_WIDTH)
                    st.caption(
                        "Everything else on this dashboard is US-only. This is the one "
                        "place offshore stress shows up."
                    )


    # --------------------------------------------------------------------------- #
    # Heatmaps
    # --------------------------------------------------------------------------- #

    def heatmap(frame: pd.DataFrame, rows: list[str], title: str, height: int):
        grid = frame[rows].T
        fig = go.Figure(go.Heatmap(
            z=grid.values, x=grid.columns, y=grid.index,
            colorscale=STRESS_SCALE, zmin=0, zmax=100,
            hovertemplate="%{y}<br>%{x|%d %b %Y}<br>%{z:.0f}th percentile<extra></extra>",
            colorbar=dict(title=dict(text="pct", side="right"), thickness=12,
                          tickvals=[0, 25, 50, 75, 100]),
        ))
        fig.update_yaxes(autorange="reversed", title_text="")
        fig.update_xaxes(title_text="")
        return style_fig(fig, height, title)


    block_rows = [c for c in BLOCK_ORDER if c in block_view.columns] + ["Composite"]
    st.plotly_chart(
        heatmap(block_view, block_rows, "Block Stress — Weekly", 90 + 46 * len(block_rows)),
        **FULL_WIDTH)

    # Indicators, grouped by block and ordered within block by current reading.
    order = []
    for block in BLOCK_ORDER:
        members = snapshot[snapshot["Block"] == block]["Indicator"].tolist()
        order.extend([m for m in members if m in view.columns])

    if order:
        st.plotly_chart(
            heatmap(view, order, "Indicator Detail — Weekly", 120 + 26 * len(order)),
            **FULL_WIDTH)
        st.caption(
            "Rows are grouped by block and sorted by current reading. Colour is the "
            "percentile against the trailing window, sign-aligned so warmer always "
            "means more stressed — never the raw level."
        )

    st.divider()

    # --------------------------------------------------------------------------- #
    # Snapshot table
    # --------------------------------------------------------------------------- #

    st.subheader("Where everything stands")

    def fmt_value(x: float) -> str:
        """Readable across five orders of magnitude - claims counts to spread bps."""
        if x is None or pd.isna(x):
            return "—"
        if abs(x) >= 10_000:
            return f"{x:,.0f}"
        if abs(x) >= 100:
            return f"{x:,.1f}"
        return f"{x:,.2f}"


    table = snapshot.copy()
    table["Reading"] = table["Percentile"].map(band)
    table["Percentile"] = table["Percentile"].round(0).astype(int)
    table["Latest"] = table["Latest"].map(fmt_value)
    table["As of"] = pd.to_datetime(table["As of"]).dt.strftime("%d %b %Y")

    st.dataframe(
        table[["Block", "Indicator", "Percentile", "Reading", "Latest", "As of",
               "Direction"]].set_index(["Block", "Indicator"]),
        height=min(620, 42 + 35 * len(table)),
        **FULL_WIDTH,
    )

    st.caption(
        "**Latest** is the underlying value in its own units; **As of** is when that "
        "value last actually changed, not when it was last forward-filled. "
        "**Direction** records which way the series had to be flipped to make higher "
        "mean more stress."
    )

    with st.expander("Method, and what it can't tell you"):
        st.markdown(
            f"""
            Every series is resampled to a **weekly (Friday)** grid, percentile-ranked
            against its own trailing **{window_years} years**, and sign-aligned so
            higher always means more stress. Blocks are averaged internally, then
            averaged with each other — unweighted, so an eight-member block doesn't
            outvote a seven-member one on headcount alone.

            **Percentiles, not z-scores.** Stress series are fat-tailed and skewed;
            a z-score of 3 means something different for VIX than for the SOFR–IORB
            spread. Percentiles put them on one footing.

            **The window is backward-looking**, so no reading uses information from
            its own future.

            **What it can't tell you.** A percentile says where something sits in its
            own recent distribution — not whether that distribution is dangerous. Ten
            years of ample reserves makes mild scarcity look extreme; a decade of
            cheap credit makes normal spreads look alarming. Shorten the window and
            it reacts faster but calls more false alarms. It is a triage tool for
            deciding which page to open next, not a signal to trade off.
            """
        )



with tab_calendar:
    calendar_view.render()
