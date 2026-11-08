"""
Growth & Activity
=================
The ISM substitute: four regional Fed surveys standardised into one composite,
broad activity indices, and the rule-based recession tripwires.
Reads cache/growth.parquet - run `python refresh.py` to update it.
"""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

import ui
from data.growth import SURVEYS, TRIPWIRES, last_change, tripwire_status
from ui import FULL_WIDTH, PALETTE, get, kpi, missing_note, style_fig

data = ui.require_block("growth")
context = ui.load_block("context")
usrec = get(context, "NBER_Recession") if context is not None else None

# Date range is on the charts themselves.
df = data
st.sidebar.divider()
ui.download_button(df, "growth")

with st.sidebar.expander("Why not ISM?"):
    st.markdown(
        """
        ISM is a licensed product and was removed from FRED in June 2016 —
        there is no free feed.

        The four regional Fed surveys here print **before** ISM does, and
        Richmond and Kansas City are absent only because they do not publish
        to FRED either.

        Standardising them and taking the average gives a national signal
        that is both free and earlier — and, unlike a single ISM print, it
        shows dispersion between districts.
        """
    )

# --------------------------------------------------------------------------- #
# Header + KPIs
# --------------------------------------------------------------------------- #

st.title("Growth & Activity")
st.markdown(
    f"<p class='caption-note'>Data through <b>{df.index.max():%d %B %Y}</b> · "
    "deltas are 30-day changes · date range is in each chart's top-right</p>",
    unsafe_allow_html=True,
)
st.write("")

ui.explainer("""
        **What this is.** The real economy — whether activity is speeding up or
        slowing down, and whether the labour market is turning.

        Each tab has its own **How to read this tab** panel with the mechanism
        and the thresholds.

        **Why there is no ISM here.** ISM is a licensed product and was pulled
        from FRED in June 2016; there is no free feed. Four regional Fed surveys
        stand in, and they print *before* ISM does.
            """)
st.write("")

k1, k2, k3, k4, k5 = st.columns(5)

v, d = kpi(get(df, "Regional Fed Composite"), "{:+.2f} σ", "{:+.2f}")
k1.metric("Regional Fed Composite", v, d)

v, d = kpi(get(df, "CFNAI-MA3"), "{:+.2f}", "{:+.2f}")
k2.metric("CFNAI-MA3", v, d)

v, d = kpi(get(df, "Sahm Rule (real-time)"), "{:.2f} pp", "{:+.2f}")
k3.metric("Sahm Rule", v, d, delta_color="inverse")

v, d = kpi(get(df, "Initial Claims 4wk MA"), "{:,.0f}", "{:+,.0f}")
k4.metric("Initial Claims (4wk MA)", v, d, delta_color="inverse")

v, d = kpi(get(df, "Weekly Economic Index"), "{:+.2f}", "{:+.2f}")
k5.metric("Weekly Economic Index", v, d)

st.write("")

tab1, tab2, tab3 = st.tabs([
    "🏭  Regional Surveys",
    "🚨  Recession Tripwires",
    "👷  Labour Market",
])


# --------------------------------------------------------------------------- #
# Tab 1 - regional composite
# --------------------------------------------------------------------------- #

with tab1:
    ui.explainer("""
        **What a diffusion index is, and why zero matters.** These surveys ask
        firms a simple question: is business better, the same, or worse than
        last month? The index is **the percentage saying better minus the
        percentage saying worse**.

        So **zero does not mean zero growth — it means as many firms improving
        as deteriorating**. It measures the *breadth of change*, not its size. A
        reading of +20 tells you improvement is widespread; it tells you nothing
        about how much output rose.

        **Why they are standardised here.** The four districts run on different
        scales and different volatilities — a +10 from Dallas is not a +10 from
        Philadelphia. Each is converted to a z-score against its own history
        before averaging, so the composite is not dominated by whichever survey
        happens to swing the widest.

        **How to read the composite.** Zero is the average. The **level** gives
        the direction of change in activity. But the more useful reading is the
        **dispersion between the four lines**: a composite at zero with all four
        districts clustered is a genuinely flat economy, while a composite at
        zero with two districts strongly positive and two strongly negative is a
        rotating one. Those are different worlds and the average hides it.

        **Why a reading sometimes does not appear.** The districts publish on
        different days of the month. The composite requires **at least three of
        the four** to have reported before it prints a value — otherwise the
        line lurches every time a single district lands.

        **What it cannot tell you.** These are **manufacturing** surveys, and
        manufacturing is roughly a tenth of US employment. They are early and
        they are noisy, and they systematically overstate the amplitude of the
        cycle because goods production swings far more than services. Richmond
        and Kansas City are missing only because they do not publish to FRED.
                """, label="How to read this tab")
    composite = get(df, "Regional Fed Composite")
    present = [s for s in SURVEYS if get(df, s) is not None]

    if composite is None and not present:
        missing_note(list(SURVEYS))
    else:
        show_districts = st.checkbox("Show individual districts", value=True,
                                     key="show_districts")
        ui.range_picker(df.index, "gr_t1")

        fig = go.Figure()
        if show_districts:
            for name, colour in zip(present, ui.SERIES_COLORS):
                s = get(df, name)
                fig.add_trace(go.Scatter(
                    x=s.index, y=s, name=name,
                    line=dict(color=colour, width=1.3), opacity=0.55,
                    hovertemplate=f"{name}: %{{y:.1f}}<extra></extra>"))
        if composite is not None:
            fig.add_trace(go.Scatter(
                x=composite.index, y=composite, name="Regional composite (σ)",
                line=dict(color=PALETTE["green"], width=3.0),
                hovertemplate="Composite: %{y:+.2f}σ<extra></extra>", yaxis="y2"))

        fig.add_hline(y=0, line=dict(color=PALETTE["muted"], width=1.2, dash="dash"))
        # Set both axis titles in one call - update_yaxes() would apply the
        # same title to the overlaying axis as well.
        fig.update_layout(
            yaxis=dict(title="District diffusion index"),
            yaxis2=dict(overlaying="y", side="right",
                        title="Composite (std. dev.)", showgrid=False),
        )
        ui.add_recession_shading(fig, usrec, df.index)
        st.plotly_chart(
            style_fig(fig, 500, "Regional Fed Surveys — the ISM Substitute"), **FULL_WIDTH)
        reporting = get(df, "Districts Reporting")
        n_now = int(reporting.iloc[-1]) if reporting is not None else len(present)
        st.caption(
            "Districts are raw diffusion indices on the left axis; the composite is "
            "the average of their expanding-window z-scores on the right. Expanding "
            "rather than full-sample, so no reading uses information from its own "
            f"future. **Latest reading uses {n_now} of {len(SURVEYS)} districts** — "
            "they publish on different days, so the current month can revise as the "
            "stragglers land."
        )

    st.divider()

    if len(present) >= 2:
        latest = pd.DataFrame({
            "District": present,
            "Latest": [float(get(df, s).iloc[-1]) for s in present],
            "As of": [(last_change(get(df, s)) or get(df, s).index[-1]).strftime("%b %Y")
                      for s in present],
        }).sort_values("Latest")

        fig2 = go.Figure(go.Bar(
            x=latest["Latest"], y=latest["District"], orientation="h",
            marker_color=[PALETTE["red"] if v < 0 else PALETTE["green"]
                          for v in latest["Latest"]],
            text=[f"{v:+.1f}" for v in latest["Latest"]], textposition="outside",
            customdata=latest["As of"],
            hovertemplate="%{y}<br>%{x:+.1f} (%{customdata})<extra></extra>"))
        fig2.add_vline(x=0, line=dict(color=PALETTE["muted"], width=1.2))
        fig2.update_xaxes(title_text="Latest diffusion index (expansion above zero)")
        st.plotly_chart(
            style_fig(fig2, 90 + 46 * len(latest), "District Dispersion — Latest Print"),
            **FULL_WIDTH)
        st.caption(
            "Districts do not print on the same day, so 'latest' can mean different "
            "months. The date is on the hover."
        )


# --------------------------------------------------------------------------- #
# Tab 2 - tripwires
# --------------------------------------------------------------------------- #

with tab2:
    ui.explainer("""
        **What these are.** Three published rules, each with a specific
        threshold that its own author defined. They are **rules of thumb fitted
        to fewer than ten recessions**, which is the single most important thing
        to know about them.

        **CFNAI-MA3 below −0.70.** The CFNAI condenses 85 indicators into one
        number where zero is trend growth. The Chicago Fed's own published rule
        is that the **three-month average** falling below −0.70 *following a
        period of expansion* has historically signalled the onset of recession.
        The three-month average matters — the monthly series is far too noisy to
        use raw.

        **Sahm rule at 0.50pp.** The three-month average unemployment rate
        rising half a point above its lowest reading of the previous twelve
        months. Note what this is designed for: Claudia Sahm built it as a
        **real-time trigger for automatic fiscal stimulus**, not as a recession
        forecast. She has said publicly that the 2024 trigger may be a false
        positive, because it was driven by **labour supply growth — more people
        entering the workforce — rather than by layoffs**. A rule that fires
        because the denominator grew is telling you something different from one
        that fires because people lost jobs.

        **Claims above their 52-week low.** Initial claims bottoming and then
        rising perhaps 10–15% off that low has preceded past downturns. There is
        no official threshold here; it is a shape, not a level.

        **How to read the set.** **Two of three firing matters far more than one
        firing.** Each rule has its own characteristic false positive, and they
        are not the same false positive — Sahm breaks on labour supply, CFNAI
        breaks on a manufacturing air-pocket, claims break on hurricanes and
        strikes. Agreement between them is what carries information.

        **What they cannot tell you.** Timing. Even when these fire correctly,
        the lead has ranged from a couple of months to more than a year, and
        the recession is usually dated afterwards by the NBER anyway.
                """, label="How to read this tab")
    st.markdown(
        "Rule-based indicators with **published thresholds**. On a monitor these "
        "read better as distance-to-trigger than as time series — the history is "
        "below for anyone who wants it."
    )

    status = tripwire_status(df)
    if status.empty:
        missing_note([c for c, _, _, _ in TRIPWIRES])
    else:
        cols = st.columns(len(status))
        for col, (_, row) in zip(cols, status.iterrows()):
            triggered = bool(row["Triggered"])
            gap = abs(float(row["Distance"]))
            col.metric(
                row["Indicator"],
                f"{row['Latest']:.2f}",
                help=f"{row['Rule']}. Threshold {row['Direction']} "
                     f"{row['Threshold']:.2f}. As of {row['As of']:%d %b %Y}.",
            )
            # A st.metric delta would draw an up/down arrow, which reads as a
            # move rather than a state. Status belongs in its own line.
            colour = PALETTE["red"] if triggered else PALETTE["green"]
            text = "TRIGGERED" if triggered else f"{gap:.2f} from trigger"
            col.markdown(
                f"<div style='margin-top:-8px;font-size:0.82rem;color:{colour}'>"
                f"● {text}<span style='color:{PALETTE['muted']}'> · "
                f"as of {row['As of']:%d %b %Y}</span></div>",
                unsafe_allow_html=True,
            )

        st.write("")
        fig = go.Figure(go.Bar(
            x=status["Distance"], y=status["Indicator"], orientation="h",
            marker_color=[PALETTE["red"] if t else PALETTE["green"]
                          for t in status["Triggered"]],
            text=[f"{d:+.2f}" for d in status["Distance"]], textposition="outside",
            hovertemplate="%{y}<br>%{x:+.2f} past trigger<extra></extra>"))
        fig.add_vline(x=0, line=dict(color=PALETTE["amber"], width=1.6, dash="dash"),
                      annotation_text="trigger", annotation_position="top",
                      annotation_font=dict(color=PALETTE["amber"], size=11))
        fig.update_xaxes(title_text="Distance past trigger (indicator's own units) "
                                    "— positive is stressed")
        st.plotly_chart(
            style_fig(fig, 100 + 52 * len(status), "Distance to Trigger"), **FULL_WIDTH)

    st.divider()

    available = [c for c, _, _, _ in TRIPWIRES if get(df, c) is not None]
    if available:
        hist = st.selectbox("History for", available, key="tripwire_hist")
        series = get(df, hist)
        level = next(l for c, l, _, _ in TRIPWIRES if c == hist)
        f = go.Figure(go.Scatter(
            x=series.index, y=series, name=hist,
            line=dict(color=PALETTE["blue"], width=2.2),
            hovertemplate="%{y:.2f}<extra></extra>"))
        f.add_hline(y=level, line=dict(color=PALETTE["red"], width=1.5, dash="dash"),
                    annotation_text=f"trigger · {level:g}",
                    annotation_position="top right",
                    annotation_font=dict(color=PALETTE["red"], size=11),
                    annotation_bgcolor="rgba(22,26,35,0.82)", annotation_borderpad=3)
        ui.add_recession_shading(f, usrec, df.index)
        st.plotly_chart(style_fig(f, 400, hist), **FULL_WIDTH)


# --------------------------------------------------------------------------- #
# Tab 3 - labour
# --------------------------------------------------------------------------- #

with tab3:
    ui.explainer("""
        **The two claims series ask different questions**, and the difference
        between them is the most useful thing on this tab.

        - **Initial claims** — how many people **lost a job** last week. Weekly,
          barely revised, and the fastest hard data in the US. Use the
          **four-week moving average**: the weekly series is dominated by
          holidays, weather, strikes and a handful of state-level filing quirks.
        - **Continued claims** — how many people are **still** claiming, which is
          really a measure of **how hard it is to get rehired**.

        **The configuration that matters.** Continued claims rising while
        initial claims stay flat means **firms have stopped hiring but have not
        started firing**. That is exactly what a slowdown looks like before it
        becomes a recession, and it is invisible if you only watch the headline
        initial claims number. When initial claims finally rise too, the labour
        market has moved from a hiring freeze to actual job losses.

        **On levels.** Rough historical guides — below ~250k is tight, above
        ~350k is deteriorating — but treat them loosely. The labour force has
        grown substantially, so a given claims count represents a smaller share
        of employment than it did twenty years ago and the thresholds drift
        upward over time. **The direction and the rate of change are far more
        reliable than the level.**

        **Unemployment rate.** Genuinely lagging — it turns after the recession
        has started, because people only get counted as unemployed once they are
        already out of work and looking. It is here for the Sahm rule and for
        context, not as a leading signal.
                """, label="How to read this tab")
    ui.range_picker(df.index, "gr_t3")
    initial = get(df, "Initial Claims")
    ma4 = get(df, "Initial Claims 4wk MA")
    cont = get(df, "Continued Claims")
    unrate = get(df, "Unemployment Rate")

    if initial is None and cont is None:
        missing_note(["Initial Claims", "Continued Claims"])
    else:
        fig = make_subplots(specs=[[{"secondary_y": True}]])
        if initial is not None:
            fig.add_trace(go.Scatter(
                x=initial.index, y=initial, name="Initial claims",
                line=dict(color=PALETTE["slate"], width=1.1), opacity=0.6,
                hovertemplate="Initial: %{y:,.0f}<extra></extra>"), secondary_y=False)
        if ma4 is not None:
            fig.add_trace(go.Scatter(
                x=ma4.index, y=ma4, name="Initial claims, 4wk MA",
                line=dict(color=PALETTE["blue"], width=2.4),
                hovertemplate="4wk MA: %{y:,.0f}<extra></extra>"), secondary_y=False)
        if cont is not None:
            fig.add_trace(go.Scatter(
                x=cont.index, y=cont, name="Continued claims",
                line=dict(color=PALETTE["amber"], width=1.9),
                hovertemplate="Continued: %{y:,.0f}<extra></extra>"), secondary_y=True)

        fig.update_yaxes(title_text="Initial claims (persons)", secondary_y=False)
        fig.update_yaxes(title_text="Continued claims (persons)",
                         secondary_y=True, showgrid=False)
        ui.add_recession_shading(fig, usrec, df.index)
        st.plotly_chart(style_fig(fig, 470, "Jobless Claims"), **FULL_WIDTH)
        st.caption(
            "Initial claims are the fastest labour signal available. Continued "
            "claims say whether the people losing jobs are finding new ones — "
            "the two diverging is the more informative pattern."
        )

    st.divider()

    ratio = get(df, "Claims vs 52wk low (%)")
    c1, c2 = st.columns([3, 1])
    with c1:
        if ratio is None and unrate is None:
            missing_note(["Claims vs 52wk low (%)", "Unemployment Rate"])
        else:
            f = make_subplots(specs=[[{"secondary_y": True}]])
            if ratio is not None:
                f.add_trace(go.Scatter(
                    x=ratio.index, y=ratio, name="Claims vs 52wk low (%)",
                    line=dict(color=PALETTE["cyan"], width=2.2),
                    hovertemplate="%{y:+.1f}% above 52wk low<extra></extra>"),
                    secondary_y=False)
                f.add_hline(y=15, line=dict(color=PALETTE["red"], width=1.4, dash="dash"),
                            annotation_text="+15% heuristic",
                            annotation_position="top right",
                            annotation_font=dict(color=PALETTE["red"], size=11),
                            annotation_bgcolor="rgba(22,26,35,0.82)", annotation_borderpad=3)
            if unrate is not None:
                f.add_trace(go.Scatter(
                    x=unrate.index, y=unrate, name="Unemployment rate (%)",
                    line=dict(color=PALETTE["violet"], width=1.8, dash="dot"),
                    hovertemplate="U-3: %{y:.1f}%<extra></extra>"), secondary_y=True)
            f.update_yaxes(title_text="% above 52-week low", secondary_y=False)
            f.update_yaxes(title_text="Unemployment rate (%)",
                           secondary_y=True, showgrid=False)
            ui.add_recession_shading(f, usrec, df.index)
            st.plotly_chart(
                style_fig(f, 430, "Claims Off Their Lows vs. Unemployment"), **FULL_WIDTH)
    with c2:
        st.write("")
        v, d = kpi(unrate, "{:.1f}%", "{:+.1f} pp")
        st.metric("Unemployment rate", v, d, delta_color="inverse")
        v, d = kpi(ratio, "{:+.1f}%", "{:+.1f} pp")
        st.metric("Claims vs 52wk low", v, d, delta_color="inverse")
        v, d = kpi(cont, "{:,.0f}", "{:+,.0f}")
        st.metric("Continued claims", v, d, delta_color="inverse")
