"""
Credit & Financial Conditions
=============================
Composite conditions indices and the corporate spread complex.
Reads cache/credit.parquet - run `python refresh.py` to update it.
"""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

import ui
from data import registry
from ui import FULL_WIDTH, PALETTE, get, kpi, missing_note, style_fig

data = ui.require_block("credit")
context = ui.load_block("context")
usrec = get(context, "NBER_Recession") if context is not None else None

# Date range is on the charts themselves.
df = data
st.sidebar.divider()
ui.download_button(df, "credit")

with st.sidebar.expander("How to read these"):
    st.markdown(
        """
        **NFCI** — Chicago Fed, 105 measures. Zero is the historical average;
        positive means conditions tighter than average.

        **Adjusted NFCI** — the same index with the part explained by current
        growth and inflation removed. Positive means tighter *than the economy
        justifies*, which is the more useful signal.

        **CCC − BB decompression** — quality dispersion inside high yield.
        It widens before index-level spreads do, because the marginal buyer
        steps back from the worst credits first.
        """
    )

# --------------------------------------------------------------------------- #
# Derived
# --------------------------------------------------------------------------- #

hy, bb, ccc = get(df, "HY OAS"), get(df, "BB OAS"), get(df, "CCC & lower OAS")
baa = get(df, "Baa - 10y spread")
decompression = None
if bb is not None and ccc is not None:
    decompression = (ccc - bb).dropna()

# --------------------------------------------------------------------------- #
# Header + KPIs
# --------------------------------------------------------------------------- #

st.title("Credit & Financial Conditions")
st.markdown(
    f"<p class='caption-note'>Data through <b>{df.index.max():%d %B %Y}</b> · "
    "deltas are 30-day changes · date range is in each chart's top-right</p>",
    unsafe_allow_html=True,
)
st.write("")

ui.explainer("""
        **What this is.** What it costs to borrow, and how nervous markets are
        about being repaid. Credit usually moves before equities do.

        Each tab has its own **How to read this tab** panel with the mechanism
        and the levels that matter.

        **A live data limit worth knowing up front.** Since April 2026 FRED
        serves only a rolling **three years** of the ICE BofA spread series, so
        anything ranking HY, BB or CCC against a "10-year" window is in practice
        ranking against about three. **`Baa − 10y`** is the long-history credit
        spread on this page — back to 1986, and permanent — so use it as the
        anchor whenever the question is "how unusual is this, really".
            """)
st.write("")

k1, k2, k3, k4, k5 = st.columns(5)

v, d = kpi(get(df, "Adjusted NFCI"), "{:+.2f}", "{:+.2f}")
k1.metric("Adjusted NFCI", v, d, delta_color="inverse")

v, d = kpi(get(df, "NFCI"), "{:+.2f}", "{:+.2f}")
k2.metric("NFCI", v, d, delta_color="inverse")

v, d = kpi(hy, "{:.2f}%", "{:+.2f} pp")
k3.metric("HY OAS", v, d, delta_color="inverse")

v, d = kpi(decompression, "{:.2f} pp", "{:+.2f} pp")
k4.metric("CCC − BB Decompression", v, d, delta_color="inverse")

v, d = kpi(get(df, "VIX"), "{:.1f}", "{:+.1f}")
k5.metric("VIX", v, d, delta_color="inverse")

st.write("")

tab1, tab2, tab3 = st.tabs([
    "🧭  Financial Conditions",
    "💳  Credit Spreads",
    "🌡️  Stress Percentiles",
])


# --------------------------------------------------------------------------- #
# Tab 1 - conditions indices
# --------------------------------------------------------------------------- #

with tab1:
    ui.explainer("""
        **What the NFCI is.** The Chicago Fed takes **105 separate measures** of
        money markets, debt and equity markets, and banking, and weights them
        into one weekly number scaled so that **zero is the historical average
        and one unit is one standard deviation**.

        **Positive means conditions are tighter than average. Negative means
        easier.** It is not a percentage of anything.

        **Why the Adjusted NFCI is the more useful line.** Conditions *should*
        be tight when growth and inflation are strong — that is the system
        working. The adjusted index regresses the NFCI on current growth and
        inflation and keeps only the residual, so it answers a sharper question:
        **are conditions tighter than the economy justifies?** A positive
        adjusted reading with a negative headline reading means financial
        conditions are doing more restraining than the data warrant.

        **How to read it.** The **level** tells you the regime. The **change**
        tells you the impulse, and the impulse usually matters more: moving from
        −0.5 to −0.2 is still easy in level but is a genuine tightening in
        direction, and it is the direction that transmits to the economy.

        **The three sub-indexes, and which one turns first.**

        - **Leverage** — debt-to-equity, margin borrowing. Usually turns
          **first**, because it measures willingness to *fund* rather than the
          price of funding.
        - **Credit** — lending volumes and standards.
        - **Risk** — volatility and spreads. Turns last but moves hardest.

        **What it cannot tell you.** The NFCI is heavily driven by market
        prices, so it partly contains the same information as an equity
        drawdown. It is **not independent** of the thing you are usually trying
        to anticipate. Use it to characterise the regime, not to predict the
        market that is half of its own input.
                """, label="How to read this tab")
    ui.range_picker(df.index, "cr_t1")
    nfci, anfci, stlfsi = get(df, "NFCI"), get(df, "Adjusted NFCI"), get(df, "St. Louis Fed FSI")

    if nfci is None and anfci is None:
        missing_note(["NFCI", "Adjusted NFCI"])
    else:
        fig = go.Figure()
        for series, label, colour, width in (
            (nfci, "NFCI", PALETTE["blue"], 2.2),
            (anfci, "Adjusted NFCI", PALETTE["amber"], 2.4),
            (stlfsi, "St. Louis Fed FSI", PALETTE["slate"], 1.6),
        ):
            if series is not None:
                fig.add_trace(go.Scatter(
                    x=series.index, y=series, name=label,
                    line=dict(color=colour, width=width,
                              dash="dot" if label.startswith("St.") else "solid"),
                    hovertemplate=f"{label}: %{{y:+.2f}}<extra></extra>"))

        fig.add_hline(y=0, line=dict(color=PALETTE["muted"], width=1.3, dash="dash"),
                      annotation_text="0 — historical average",
                      annotation_position="bottom right",
                      annotation_font=dict(color=PALETTE["muted"], size=11),
                      annotation_bgcolor="rgba(22,26,35,0.82)", annotation_borderpad=3)
        fig.update_yaxes(title_text="Index (standard deviations)")
        ui.add_recession_shading(fig, usrec, df.index)
        st.plotly_chart(style_fig(fig, 480, "Financial Conditions: Tighter Above Zero"),
                        **FULL_WIDTH)
        st.caption(
            "Above zero is tighter than the historical average. The adjusted series is "
            "the one to watch — it removes the tightening that current growth and "
            "inflation already explain."
        )

    st.divider()

    subs = [("NFCI - credit", "Credit", PALETTE["cyan"]),
            ("NFCI - leverage", "Leverage", PALETTE["violet"]),
            ("NFCI - risk", "Risk", PALETTE["red"])]
    present = [(c, lbl, col) for c, lbl, col in subs if get(df, c) is not None]

    if not present:
        missing_note([c for c, _, _ in subs])
    else:
        fig2 = go.Figure()
        for col, label, colour in present:
            s = get(df, col)
            fig2.add_trace(go.Scatter(
                x=s.index, y=s, name=label, line=dict(color=colour, width=2.0),
                hovertemplate=f"{label}: %{{y:+.2f}}<extra></extra>"))
        fig2.add_hline(y=0, line=dict(color=PALETTE["muted"], width=1.2, dash="dash"))
        fig2.update_yaxes(title_text="Sub-index contribution")
        ui.add_recession_shading(fig2, usrec, df.index)
        st.plotly_chart(style_fig(fig2, 420, "NFCI Sub-Indexes: Which Kind of Tightening"),
                        **FULL_WIDTH)
        st.caption("Leverage typically turns before the headline index.")


# --------------------------------------------------------------------------- #
# Tab 2 - spreads
# --------------------------------------------------------------------------- #

with tab2:
    ui.explainer("""
        **What an OAS is.** The extra yield a corporate bond pays over
        Treasuries, after adjusting for the issuer's right to call it early.
        Quoted here in **percentage points** — 3.5% means 350bp of compensation
        for taking credit risk.

        **Rough levels for high yield**, though the ranges drift with the
        composition of the index:

        | HY OAS | Reading |
        |---|---|
        | around 3% | very tight — investors are reaching for yield |
        | 4–6% | normal |
        | above 8% | stress |
        | above 10% | recessionary pricing |

        **Why decompression is the row to watch.** When spreads are tight,
        investors reach down the quality ladder for yield, which compresses the
        gap between the worst credits and the best junk credits. When they stop
        reaching, they stop at the bottom first — so **CCC minus BB widens
        before the index level does**. The sequence is:

        1. CCC−BB widens while the HY index is still tight → **early warning**.
           Investors have started distinguishing on survival rather than yield.
        2. The index widens too → **confirmation**, and by then it is priced.

        A widening gap with a flat index is the informative configuration.

        **Use the log scale** for any window containing 2020. Spreads are
        roughly lognormally distributed, and on a linear axis one spike flattens
        every other episode into a straight line.

        **What it cannot tell you.** Spreads compensate for *expected* losses
        plus liquidity plus risk appetite, and you cannot separate them from the
        outside. A tight spread can mean low default risk or it can mean too
        much money chasing paper — the number looks identical either way.
                """, label="How to read this tab")
    if hy is None and bb is None and ccc is None:
        missing_note(["HY OAS", "BB OAS", "CCC & lower OAS"])
    else:
        log_scale = st.checkbox(
            "Log scale", value=False, key="oas_log",
            help="Spreads are lognormally distributed — a log axis makes the 2020 "
                 "spike stop flattening everything else.",
        )
        ui.range_picker(df.index, "cr_t2")
        fig = go.Figure()
        for series, label, colour in ((hy, "HY OAS", PALETTE["amber"]),
                                      (bb, "BB OAS", PALETTE["green"]),
                                      (ccc, "CCC & lower OAS", PALETTE["red"])):
            if series is not None:
                fig.add_trace(go.Scatter(
                    x=series.index, y=series, name=label,
                    line=dict(color=colour, width=2.1),
                    hovertemplate=f"{label}: %{{y:.2f}}%<extra></extra>"))
        fig.update_yaxes(title_text="Option-adjusted spread (%)",
                         type="log" if log_scale else "linear")
        ui.add_recession_shading(fig, usrec, df.index)
        st.plotly_chart(style_fig(fig, 470, "ICE BofA Option-Adjusted Spreads"), **FULL_WIDTH)
        if hy is not None:
            st.caption(
                f"ICE BofA history on FRED begins {hy.index.min():%B %Y} — a rolling "
                "three-year window, not the full series. The chart below is the long view."
            )

    st.divider()

    # The only credit spread on this page with 2008 and 2020 in it. Kept as its
    # own chart rather than added to the OAS figure above, because a Baa yield
    # difference and an option-adjusted spread are not the same measurement and
    # putting them on one axis would invite reading a level difference that is
    # mostly definitional.
    if baa is None:
        missing_note(["Baa - 10y spread"])
    else:
        pct = ui.percentile_of_last(baa, years=40)
        figb = go.Figure(go.Scatter(
            x=baa.index, y=baa, name="Baa − 10y",
            line=dict(color=PALETTE["violet"], width=2.1),
            hovertemplate="Baa − 10y: %{y:.2f} pp<extra></extra>"))
        median = float(baa.median())
        figb.add_hline(y=median, line=dict(color=PALETTE["muted"], width=1.2, dash="dash"),
                       annotation_text=f"Median since {baa.index.min():%Y} · {median:.2f} pp",
                       annotation_position="top right",
                       annotation_font=dict(color=PALETTE["muted"], size=11),
                       annotation_bgcolor="rgba(22,26,35,0.82)", annotation_borderpad=3)
        figb.update_yaxes(title_text="Baa yield − 10y Treasury (pp)")
        ui.add_recession_shading(figb, usrec, baa.index)
        st.plotly_chart(
            style_fig(figb, 440, "Baa − 10y Spread — the Long View"), **FULL_WIDTH)
        note = (f"Currently the **{ui.ordinal(pct * 100)} percentile** of its own history "
                f"since {baa.index.min():%Y}. " if pct is not None else "")
        st.caption(
            note + "Moody's Baa corporate yield minus the 10-year Treasury. Coarser "
            "than an option-adjusted spread — it is a plain yield difference, and the "
            "Baa basket's composition and duration drift over forty years — but it is "
            "the only long, permanent credit spread available free, and it is the one "
            "to reach for when the question is whether today is actually unusual."
        )

    st.divider()

    if decompression is None:
        missing_note(["BB OAS", "CCC & lower OAS"])
    else:
        median = float(decompression.median())
        fig3 = make_subplots(specs=[[{"secondary_y": True}]])
        fig3.add_trace(go.Scatter(
            x=decompression.index, y=decompression, name="CCC − BB (pp)",
            line=dict(color=PALETTE["red"], width=2.3),
            fill="tozeroy", fillcolor="rgba(244,99,110,0.12)",
            hovertemplate="Decompression: %{y:.2f} pp<extra></extra>"), secondary_y=False)
        if hy is not None:
            fig3.add_trace(go.Scatter(
                x=hy.index, y=hy, name="HY OAS (%)",
                line=dict(color=PALETTE["amber"], width=1.6, dash="dot"),
                hovertemplate="HY OAS: %{y:.2f}%<extra></extra>"), secondary_y=True)

        fig3.add_hline(y=median, line=dict(color=PALETTE["muted"], width=1.2, dash="dash"),
                       annotation_text=f"Median in window · {median:.2f} pp",
                       annotation_position="top right",
                       annotation_font=dict(color=PALETTE["muted"], size=11),
                       annotation_bgcolor="rgba(22,26,35,0.82)", annotation_borderpad=3)
        fig3.update_yaxes(title_text="CCC − BB (pp)", secondary_y=False)
        fig3.update_yaxes(title_text="HY OAS (%)", secondary_y=True, showgrid=False)
        ui.add_recession_shading(fig3, usrec, df.index)
        st.plotly_chart(
            style_fig(fig3, 460, "Quality Decompression Inside High Yield"), **FULL_WIDTH)
        st.caption(
            "The gap between CCC and BB spreads. It widens when investors stop "
            "distinguishing on yield and start distinguishing on survival — which "
            "tends to happen before the index level moves."
        )


# --------------------------------------------------------------------------- #
# Tab 3 - percentile strip (preview of the composite panel)
# --------------------------------------------------------------------------- #

with tab3:
    ui.explainer("""
        **What this does.** The same mechanism as the Stress Panel, applied to
        this block alone. Each indicator is ranked against **its own** trailing
        history — never against the others — and then flipped where necessary so
        that **higher always means more stress**.

        A reading of **80** means this series has spent 80% of the trailing
        window below where it is today.

        **The slider** sets the length of that window. Ten years is the default.
        Shorter reacts faster to a changed regime and calls more false alarms;
        longer is steadier but slow to accept that the world has moved.

        **Why percentiles rather than z-scores.** Credit series are fat-tailed
        and badly skewed — a z-score of 3 means something completely different
        for VIX than for a BB spread. Ranking puts them on one honest footing.

        **The block composite** at the bottom is the plain unweighted mean of
        the rows, so no single spread series can dominate simply because the
        index has three points on the same curve.

        **A real limitation on this tab, and what is being done about it.**
        In April 2026 FRED truncated every ICE BofA series to a **rolling
        three-year window** — its own series pages now say so. HY, BB, CCC and
        the decompression row therefore have no history before 2023, so they are
        ranked against roughly three post-COVID years even when the slider says
        ten. That makes them look more extreme than they are, in both
        directions, and nothing can restore what was already deleted upstream.

        Two things mitigate it. **`Baa − 10y`** is a long, permanent credit
        spread running back to 1986 — coarser than an OAS, but it has a real
        distribution behind it, so read it as the anchor row on this tab.
        And the refresh now keeps an **append-only archive**, so from here on
        every observation this dashboard has ever seen is kept even after the
        source stops publishing it. The ICE rows will rebuild a usable window
        from today forward.

        The NFCI rows, VIX and Baa − 10y are unaffected by any of this.
                """, label="How to read this tab")
    st.markdown(
        "Where each indicator sits in its own trailing distribution, sign-aligned "
        "so **higher always means more stress**. This is the mechanism the composite "
        "panel will use once more modules exist."
    )

    years = st.slider("Trailing window (years)", 3, 20, 10, key="pct_years")

    rows = []
    for spec in registry.by_block("Credit"):
        if spec.higher_is_stress is None:
            continue
        series = get(data, spec.name)          # full history, not the filtered window
        pct = ui.percentile_of_last(series, years=years)
        if pct is None:
            continue
        aligned = pct if spec.higher_is_stress else 1.0 - pct
        rows.append({"Indicator": spec.name,
                     "Percentile": aligned * 100,
                     "Latest": float(series.iloc[-1])})

    if decompression is not None:
        pct = ui.percentile_of_last(decompression, years=years)
        if pct is not None:
            rows.append({"Indicator": "CCC − BB decompression",
                         "Percentile": pct * 100,
                         "Latest": float(decompression.iloc[-1])})

    if not rows:
        st.info("Not enough history in the cache to compute percentiles. "
                "Re-run `python refresh.py --start 2005-01-01`.")
    else:
        table = pd.DataFrame(rows).sort_values("Percentile")

        def band_color(p: float) -> str:
            if p >= 90:
                return PALETTE["red"]
            if p >= 75:
                return PALETTE["amber"]
            if p <= 25:
                return PALETTE["green"]
            return PALETTE["slate"]

        fig = go.Figure(go.Bar(
            x=table["Percentile"], y=table["Indicator"], orientation="h",
            marker_color=[band_color(p) for p in table["Percentile"]],
            text=[ui.ordinal(p) for p in table["Percentile"]],
            textposition="outside",
            hovertemplate="%{y}<br>%{x:.0f}th percentile<extra></extra>",
        ))
        for level, label, colour in ((75, "75th", PALETTE["amber"]),
                                     (90, "90th", PALETTE["red"])):
            fig.add_vline(x=level, line=dict(color=colour, width=1.1, dash="dot"),
                          annotation_text=label, annotation_position="top",
                          annotation_font=dict(color=colour, size=10))
        fig.update_xaxes(title_text=f"Percentile within trailing {years} years",
                         range=[0, 108])
        fig.update_yaxes(title_text="")
        st.plotly_chart(
            style_fig(fig, 90 + 42 * len(table), "Stress Percentiles — Credit Block"),
            **FULL_WIDTH)

        composite = table["Percentile"].mean()
        c1, c2 = st.columns([1, 3])
        c1.metric("Credit block composite", f"{ui.ordinal(composite)} percentile")
        c2.caption(
            "Percentiles are computed on a backward-looking rolling window ending at "
            "the latest observation, so nothing here uses information the reader "
            "would not have had at the time. The block composite is the simple mean "
            "of the rows above — deliberately unweighted, so no single spread series "
            "dominates."
        )

        st.dataframe(
            table.set_index("Indicator").style.format({"Percentile": "{:.0f}",
                                                       "Latest": "{:.2f}"}),
            **FULL_WIDTH)
