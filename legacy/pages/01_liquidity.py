"""
Funding & Liquidity
===================
Fed balance sheet, reserve scarcity, money market stress and monetary dynamics.
Reads cache/liquidity.parquet - run `python refresh.py` to update it.
"""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

import ui
from data.leadlag import summary
from ui import FULL_WIDTH, PALETTE, get, kpi, missing_note, style_fig

# Policy thresholds from the Fed literature.
WALLER_LCLOR = (10.0, 11.0)       # Reserves / GDP
ACHARYA_SCARCITY = (8.5, 9.0)     # Reserves / commercial bank assets

data = ui.require_block("liquidity")
context = ui.load_block("context")
# The lead/lag sleeves live on this page too; their inputs are in their own cache.
rates = ui.load_block("rates")
usrec = get(context, "NBER_Recession") if context is not None else None

# --------------------------------------------------------------------------- #
# Sidebar
# --------------------------------------------------------------------------- #

# Date range lives on each chart now (preset buttons + drag slider), so the
# page works from the full history and the reader zooms where they want.
df = data

reserves_basis = st.sidebar.radio(
    "Reserves basis",
    ["Weekly (WRESBAL)", "Monthly (TOTRESNS)"],
    index=0,
    help="WRESBAL is weekly and current. TOTRESNS is monthly and can be up to "
         "eight weeks stale on a daily dashboard.",
)
RESERVES_COL = ("Total_Reserves_Weekly" if reserves_basis.startswith("Weekly")
                else "Total_Reserves")
if RESERVES_COL not in df.columns:
    RESERVES_COL = "Total_Reserves"

st.sidebar.divider()
ui.download_button(df, "liquidity")

with st.sidebar.expander("Threshold reference"):
    st.markdown(
        f"""
        **Reserves / GDP** — Waller LCLoR band
        `{WALLER_LCLOR[0]:.1f}% – {WALLER_LCLOR[1]:.1f}%`

        **Reserves / bank assets** — inelastic demand band
        `{ACHARYA_SCARCITY[0]:.1f}% – {ACHARYA_SCARCITY[1]:.1f}%`
        Calibrated to all commercial banks: Sept 2019 ≈ 8.5% on this basis.

        **SOFR–IORB** — persistent prints above `0 bps` signal repo pressure.
        IORB only exists from 2021-07-29; nothing is plotted before that.
        """
    )

# --------------------------------------------------------------------------- #
# Header + KPIs
# --------------------------------------------------------------------------- #

st.title("Funding & Liquidity")
st.markdown(
    f"<p class='caption-note'>Data through <b>{df.index.max():%d %B %Y}</b> · "
    "deltas are 30-day changes · date range buttons sit in each chart's "
    "top-right corner</p>",
    unsafe_allow_html=True,
)
st.write("")

ui.explainer("""
        **What this is.** The Fed's plumbing — how much cash the banking system
        has, and whether short-term funding markets are clearing normally.
        Funding stress shows up here before it shows up in prices.

        Each tab below has its own **How to read this tab** panel with the
        mechanism, the thresholds and what they actually mean.

        **Date ranges** sit in the top-right of each chart, and the y-axis
        refits to whatever window you pick.
            """)
st.write("")

k1, k2, k3, k4, k5 = st.columns(5)

v, d = kpi(get(df, "Net_Liquidity_Bil"), "${:,.0f}B", "{:+,.0f}B")
k1.metric("Net Liquidity", v, d)

v, d = kpi(get(df, RESERVES_COL), "${:,.0f}B", "{:+,.0f}B")
k2.metric("Total Reserves", v, d)

v, d = kpi(get(df, "Reserves_to_GDP_%"), "{:.2f}%", "{:+.2f} pp")
k3.metric("Reserves / GDP", v, d)

v, d = kpi(get(df, "SOFR_IORB_Spread_bps"), "{:+.1f} bps", "{:+.1f} bps")
k4.metric("SOFR – IORB Spread", v, d, delta_color="inverse")

v, d = kpi(get(df, "ON_RRP_Facility"), "${:,.0f}B", "{:+,.0f}B")
k5.metric("ON RRP Facility", v, d)

st.write("")

tab1, tab2, tab3, tab4, tab5, tab6, tab7 = st.tabs([
    "🏛️  Balance Sheet",
    "📉  Reserve Scarcity",
    "⚡  Money Markets",
    "💵  M2 Dynamics",
    "🎯  Neutral & Curve",
    "💧  Excess Liquidity",
    "📈  Term Premium & Yields",
])


# --------------------------------------------------------------------------- #
# Tab 1
# --------------------------------------------------------------------------- #

with tab1:
    ui.explainer("""
        **The mechanism.** When the Fed buys a bond it pays by crediting the
        seller's bank with **reserves** — newly created money that only exists
        inside the Fed's own ledger. So the asset side of the balance sheet is
        roughly the stock of money the Fed has put into the system.

        But two other Fed liabilities *compete* for those same reserves, and
        anything sitting in them is drained out of the banking system:

        - **TGA** — the Treasury's checking account at the Fed. When Treasury
          issues bills and parks the proceeds, that cash leaves bank reserves.
        - **ON RRP** — where money market funds park cash overnight with the
          Fed instead of lending it into the market.

        Hence **Net liquidity = Assets − TGA − ON RRP**.

        **How to read it.**

        The *level* means little. The *direction and speed* are the signal.
        Weekly swings of ±$100bn around tax dates and settlement are routine.

        The important thing is **where the drain is coming from**:

        | What moves | Effect on net liquidity |
        |---|---|
        | Fed lets bonds roll off (QT) | assets fall → **tightening** |
        | Treasury rebuilds TGA after a debt-ceiling deal | cash into TGA → **tightening**, even with assets flat |
        | Money funds leave ON RRP for bills | RRP falls → **easing**, cushioning QT |

        **Why this matters right now.** Between 2022 and 2024 QT was almost
        painless because ON RRP was draining at the same time — money funds
        moved trillions out of the facility into T-bills, so reserves barely
        fell. **Once ON RRP is near zero, that cushion is gone and every
        further dollar of QT comes straight out of bank reserves.** Check the
        ON RRP number in the KPI row above: if it is near zero, the balance
        sheet and reserve scarcity tabs are telling you the same story for the
        first time in years.

        **What it cannot tell you.** Net liquidity is a plumbing aggregate, not
        a market indicator. It has no reliable lead over risk assets, and the
        popular charts overlaying it on the S&P are curve-fitted. Use it to
        understand *why* funding conditions changed, not to time anything.
                """, label="How to read this tab")
    ui.range_picker(df.index, "liq_t1")
    assets = get(df, "Fed_Total_Assets_Bil")
    tga = get(df, "TGA_Balance")
    onrrp = get(df, "ON_RRP_Facility")
    netliq = get(df, "Net_Liquidity_Bil")

    if assets is None and netliq is None:
        missing_note(["Fed_Total_Assets_Bil", "Net_Liquidity_Bil"])
    else:
        fig = make_subplots(specs=[[{"secondary_y": True}]])
        if assets is not None:
            fig.add_trace(go.Scatter(
                x=assets.index, y=assets, name="Fed Total Assets",
                line=dict(color=PALETTE["blue"], width=2.2),
                hovertemplate="Total Assets: $%{y:,.0f}B<extra></extra>"), secondary_y=False)
        if netliq is not None:
            fig.add_trace(go.Scatter(
                x=netliq.index, y=netliq, name="Net Liquidity",
                line=dict(color=PALETTE["green"], width=2.6),
                hovertemplate="Net Liquidity: $%{y:,.0f}B<extra></extra>"), secondary_y=False)
        if tga is not None:
            fig.add_trace(go.Scatter(
                x=tga.index, y=tga, name="TGA Balance",
                line=dict(color=PALETTE["amber"], width=1.8),
                hovertemplate="TGA: $%{y:,.0f}B<extra></extra>"), secondary_y=True)
        if onrrp is not None:
            fig.add_trace(go.Scatter(
                x=onrrp.index, y=onrrp, name="ON RRP Facility",
                line=dict(color=PALETTE["violet"], width=1.8),
                hovertemplate="ON RRP: $%{y:,.0f}B<extra></extra>"), secondary_y=True)

        fig.update_yaxes(title_text="Total Assets / Net Liquidity ($ Bil)", secondary_y=False)
        fig.update_yaxes(title_text="TGA / ON RRP ($ Bil)", secondary_y=True, showgrid=False)
        ui.add_recession_shading(fig, usrec, df.index)
        st.plotly_chart(style_fig(fig, 500, "Fed Balance Sheet vs. Net Liquidity"),
                        **FULL_WIDTH)
        st.caption(
            "Net Liquidity ≈ Fed Total Assets − TGA − ON RRP. Treasury cash rebuilds "
            "and RRP take-up drain reserves even when the balance sheet is unchanged."
        )

    st.divider()

    liab = [(RESERVES_COL, "Bank Reserves", PALETTE["blue"]),
            ("TGA_Balance", "Treasury General Account", PALETTE["amber"]),
            ("ON_RRP_Facility", "ON RRP Facility", PALETTE["violet"])]
    available = [(c, lbl, col) for c, lbl, col in liab if get(df, c) is not None]

    if not available:
        missing_note([c for c, _, _ in liab])
    else:
        c1, c2 = st.columns([3, 1])
        with c2:
            freq_label = st.selectbox("Bar frequency", ["Monthly", "Weekly", "Quarterly"],
                                      index=0, key="liab_freq")
            normalise = st.toggle("Show as % of total", value=False, key="liab_norm")
        freq = {"Weekly": "W", "Monthly": "ME", "Quarterly": "QE"}[freq_label]

        stack = pd.DataFrame({lbl: get(df, c) for c, lbl, _ in available})
        stack = stack.resample(freq).last().dropna(how="all")

        plot_df = stack
        if normalise:
            plot_df = stack.div(stack.sum(axis=1).replace(0, pd.NA), axis=0) * 100

        fig2 = go.Figure()
        for _, lbl, colour in available:
            if lbl in plot_df.columns:
                fig2.add_trace(go.Bar(
                    x=plot_df.index, y=plot_df[lbl], name=lbl, marker_color=colour,
                    hovertemplate=f"{lbl}: %{{y:,.1f}}"
                    + ("%<extra></extra>" if normalise else "B<extra></extra>")))
        fig2.update_layout(barmode="stack", bargap=0.12)
        fig2.update_yaxes(title_text="Share of total (%)" if normalise else "$ Billions",
                          range=[0, 100] if normalise else None)
        with c1:
            st.plotly_chart(
                style_fig(fig2, 440, "Fed Liabilities: Reserves + TGA + ON RRP"), **FULL_WIDTH)


# --------------------------------------------------------------------------- #
# Tab 2
# --------------------------------------------------------------------------- #

with tab2:
    ui.explainer("""
        **The mechanism.** Reserves are the only asset that settles a payment
        between two banks instantly and with no credit risk. Every bank wants a
        buffer of them — for intraday payments, for the liquidity rules it has
        to satisfy, and for the days when a large outflow arrives unannounced.

        The Fed currently runs an **ample reserves** regime: it deliberately
        supplies more reserves than the system strictly needs, so that the
        overnight rate is set by the rate the Fed *administers* (IORB) rather
        than by how scarce reserves are. That works only while there is slack.

        Banks' demand for reserves is **flat, then suddenly steep**. While there
        is plenty, draining some has no effect on rates — banks are indifferent.
        Past a point, banks stop being indifferent and start bidding for
        reserves, and the curve turns near-vertical. **The same $50bn drain that
        did nothing last year moves repo 20bp today.** Nobody can observe where
        that kink is in advance; the two bands on this chart are estimates of it.

        **Reading the two bands.**

        | Reserves / GDP | What it means |
        |---|---|
        | above 11% | **Ample.** Cushion is thick, drains are absorbed with no rate response. |
        | 10–11% | **The Waller band.** Approaching the lowest comfortable level. Banks start competing for reserves. Start watching SOFR–IORB on the next tab daily. |
        | below 10% | **Scarce.** Expect repo spikes at settlement and quarter-ends, intraday payment delays, and pressure on the Fed to stop QT or add reserves. |

        The second band, **8.5–9.0% of commercial bank assets**, is the same
        question with a different denominator. It is calibrated to a real event:
        in **September 2019** repo rates spiked to 10% intraday and the Fed had
        to restart reserve injections — and reserves were about **8.5% of bank
        assets** when that happened.

        **Why two denominators, and why they disagree.** GDP scales the ratio to
        the size of the economy. But reserve demand is really driven by the size
        of *bank balance sheets* and the liquidity rules written against them,
        which is the better theoretical denominator. If bank assets grow faster
        than GDP, the bank-assets ratio falls first and warns earlier. **When
        both ratios are inside their bands at once, that is the strong signal** —
        one alone can be a denominator effect.

        **How this is "liquidity tightness", concretely.** Below the band, a bank
        that needs cash overnight can no longer assume it will get it at the
        Fed's administered rate. It bids up in repo. Repo pulls the fed funds
        rate with it. The Fed's target range stops being where money actually
        trades — which is precisely what it cannot tolerate, so it intervenes.
        That sequence is what the bands are trying to give you warning of.

        **What they cannot tell you.** These are **estimates from Fed research,
        not thresholds the Fed has committed to**, and the level of "comfortable"
        moves over time with regulation and bank behaviour — it shifted after
        March 2023. Treat a band as the point to start paying attention, never
        as a line that triggers something.
                """, label="How to read this tab")
    reserves = get(df, RESERVES_COL)
    res_gdp = get(df, "Reserves_to_GDP_%")
    res_bank = get(df, "Reserves_to_Large_Bank_Assets_%")
    # Note: `a or b` is not usable here - truth-testing a Series raises.
    conc = get(df, "Large_Bank_Share_of_Reserves_%")
    if conc is None:
        conc = get(df, "Large_Bank_Cash_Share_%")

    if reserves is None and res_gdp is None and res_bank is None:
        missing_note([RESERVES_COL, "Reserves_to_GDP_%", "Reserves_to_Large_Bank_Assets_%"])
    else:
        show_bands = st.checkbox("Show policy stress bands", value=True, key="bands")
        ui.range_picker(df.index, "liq_t2")
        fig = make_subplots(specs=[[{"secondary_y": True}]])

        if reserves is not None:
            fig.add_trace(go.Scatter(
                x=reserves.index, y=reserves, name="Total Reserves ($ Bil)",
                line=dict(color=PALETTE["blue"], width=2.4),
                fill="tozeroy", fillcolor="rgba(76,141,255,0.10)",
                hovertemplate="Reserves: $%{y:,.0f}B<extra></extra>"), secondary_y=False)
        if res_gdp is not None:
            fig.add_trace(go.Scatter(
                x=res_gdp.index, y=res_gdp, name="Reserves / GDP (%)",
                line=dict(color=PALETTE["amber"], width=2.2),
                hovertemplate="Reserves/GDP: %{y:.2f}%<extra></extra>"), secondary_y=True)
        if res_bank is not None:
            fig.add_trace(go.Scatter(
                x=res_bank.index, y=res_bank, name="Reserves / Bank Assets (%)",
                line=dict(color=PALETTE["cyan"], width=2.2),
                hovertemplate="Reserves/Bank Assets: %{y:.2f}%<extra></extra>"), secondary_y=True)

        if show_bands:
            def add_band(lo: float, hi: float, colour: str, label: str) -> None:
                fig.add_hrect(y0=lo, y1=hi, fillcolor=colour, opacity=0.16,
                              line_width=0, secondary_y=True, layer="below")
                fig.add_annotation(xref="paper", x=0.995, xanchor="right",
                                   yref="y2", y=(lo + hi) / 2, yanchor="middle",
                                   text=label, showarrow=False,
                                   font=dict(color=colour, size=11),
                                   bgcolor="rgba(22,26,35,0.82)", borderpad=3)

            if res_gdp is not None:
                add_band(*WALLER_LCLOR, PALETTE["amber"], "Waller LCLoR band · 10.0–11.0%")
            if res_bank is not None:
                add_band(*ACHARYA_SCARCITY, PALETTE["red"], "Inelastic demand band · 8.5–9.0%")

        fig.update_yaxes(title_text="Total Reserves ($ Bil)", secondary_y=False)
        fig.update_yaxes(title_text="Ratio (%)", secondary_y=True, showgrid=False)
        ui.add_recession_shading(fig, usrec, df.index)
        st.plotly_chart(
            style_fig(fig, 540, "Reserve Adequacy vs. Policy Stress Thresholds"), **FULL_WIDTH)

        c1, c2, c3 = st.columns(3)

        def status(series, lo, hi):
            if series is None or series.empty:
                return "—", "No data"
            x = float(series.iloc[-1])
            if x < lo:
                return f"{x:.2f}%", "🔴 Below band — scarce"
            if x <= hi:
                return f"{x:.2f}%", "🟠 In band — approaching scarcity"
            return f"{x:.2f}%", "🟢 Above band — ample"

        val, note = status(res_gdp, *WALLER_LCLOR)
        c1.metric("Reserves / GDP", val, note, delta_color="off")
        val, note = status(res_bank, *ACHARYA_SCARCITY)
        c2.metric("Reserves / Bank Assets", val, note, delta_color="off")
        v, d = kpi(conc, "{:.1f}%", "{:+.2f} pp")
        c3.metric("Large-Bank Share of Reserves", v, d)

        st.caption(
            "Waller's LCLoR frames reserve adequacy against nominal GDP; the second "
            "ratio measures reserves against commercial bank assets, where demand "
            "turns inelastic below roughly 8.5–9.0%."
        )


# --------------------------------------------------------------------------- #
# Tab 3
# --------------------------------------------------------------------------- #

with tab3:
    ui.explainer("""
        **The mechanism.** Three overnight rates, and the gaps between them are
        the cleanest real-time read on whether cash is abundant.

        - **IORB** — what the Fed pays banks on the reserves they already hold.
          Risk-free, no effort.
        - **SOFR** — what borrowers actually pay overnight in repo, secured
          against Treasuries. A real transaction rate off ~$2trn a day.
        - **EFFR** — unsecured overnight lending between banks.

        **The arbitrage that makes SOFR–IORB meaningful.** A bank with spare
        reserves can earn IORB for doing nothing. It has no reason to lend below
        that. So if repo is trading **above** IORB, someone in the market needs
        cash badly enough to pay more than the risk-free alternative — and the
        banks that could supply it either cannot or will not. That is scarcity
        showing itself in a price.

        **How to read the spread.**

        | SOFR − IORB | Reading |
        |---|---|
        | negative, or around zero | **Ample.** Cash is competing for collateral. |
        | brief spikes at month or quarter-end | **Normal.** Balance-sheet window-dressing; dealers step back for reporting dates. Mean-reverts within days — do not react. |
        | **persistently positive** over weeks | **The signal.** Genuine scarcity, and the September 2019 signature. |

        The word doing the work is *persistently*. A single +5bp print on
        31 December is noise. The same print for two weeks in mid-month is not.

        **The Fed's ceiling tools, and why any use matters.**

        - **SRF / repo take-up** — the Standing Repo Facility lets dealers turn
          Treasuries into cash at a rate the Fed sets. Take-up above zero on an
          ordinary day means someone preferred the Fed to the market. That is a
          real signal, not a technicality.
        - **Discount window** — carries genuine stigma; banks avoid it because
          being seen there invites questions. **Any** meaningful rise means the
          alternatives were worse.

        **A data limit to keep in mind.** IORB only exists from **29 July 2021**.
        Nothing is plotted before that, and the earlier IOER series is not
        spliced on — an apparent gap is missing data, not a zero spread.
                """, label="How to read this tab")
    sofr_sprd = get(df, "SOFR_IORB_Spread_bps")
    effr_sprd = get(df, "EFFR_IORB_Spread_bps")

    if sofr_sprd is None and effr_sprd is None:
        missing_note(["SOFR_IORB_Spread_bps", "EFFR_IORB_Spread_bps"])
    else:
        vol_window = st.slider(
            "Rolling volatility window (days)", 5, 60, 15, step=5,
            help="The Fed's own reserve-ampleness note uses a 15-day rolling "
                 "standard deviation of these spreads. Volatility moves before "
                 "the level does.",
        )
        ui.range_picker(df.index, "liq_t3")

        fig = make_subplots(specs=[[{"secondary_y": True}]])
        for series, label, colour in ((sofr_sprd, "SOFR – IORB (bps)", PALETTE["cyan"]),
                                      (effr_sprd, "EFFR – IORB (bps)", PALETTE["amber"])):
            if series is not None:
                fig.add_trace(go.Scatter(
                    x=series.index, y=series, name=label,
                    line=dict(color=colour, width=2.1),
                    hovertemplate=f"{label}: %{{y:+.1f}}<extra></extra>"), secondary_y=False)

        if sofr_sprd is not None:
            vol = sofr_sprd.rolling(vol_window).std()
            fig.add_trace(go.Scatter(
                x=vol.index, y=vol, name=f"SOFR spread σ ({vol_window}d)",
                line=dict(color=PALETTE["violet"], width=1.6, dash="dot"),
                hovertemplate="σ: %{y:.2f} bps<extra></extra>"), secondary_y=True)

        fig.add_hline(y=0, line=dict(color=PALETTE["red"], width=1.4, dash="dash"),
                      annotation_text="0 bps — IORB floor", annotation_position="top right",
                      annotation_font=dict(color=PALETTE["red"], size=11),
                      annotation_bgcolor="rgba(22,26,35,0.82)", annotation_borderpad=3)
        fig.update_yaxes(title_text="Spread to IORB (bps)", secondary_y=False)
        fig.update_yaxes(title_text=f"{vol_window}-day σ (bps)", secondary_y=True, showgrid=False)
        st.plotly_chart(style_fig(fig, 480, "Money Market Spreads to IORB"), **FULL_WIDTH)
        st.caption(
            "Sustained positive SOFR–IORB prints indicate repo collateral pressure. "
            "The dotted line is the rolling standard deviation — the Fed's fourth "
            "market-based indicator of reserve ampleness, and the one that tends to "
            "move first."
        )

    st.divider()

    srf = get(df, "SRF_Daily_Accepted_Bil")
    dw = get(df, "Discount_Window_Primary_Credit")

    if srf is None and dw is None:
        missing_note(["SRF_Daily_Accepted_Bil", "Discount_Window_Primary_Credit"])
    else:
        agg = st.selectbox("Facility aggregation",
                           ["Daily / as reported", "Weekly max", "Monthly max"],
                           index=1, key="fac_freq")
        rule = {"Weekly max": "W", "Monthly max": "ME"}.get(agg)

        def prep(s):
            if s is None:
                return None
            return s.resample(rule).max().dropna() if rule else s

        left, right = st.columns(2)
        with left:
            s = prep(srf)
            if s is None:
                missing_note(["SRF_Daily_Accepted_Bil"])
            else:
                f = go.Figure(go.Bar(x=s.index, y=s, name="Repo / SRF accepted",
                                     marker_color=PALETTE["green"],
                                     hovertemplate="$%{y:,.2f}B<extra></extra>"))
                f.update_yaxes(title_text="$ Billions")
                st.plotly_chart(
                    style_fig(f, 400, "Repo Operations Accepted (incl. SRF)"), **FULL_WIDTH)
        with right:
            s = prep(dw)
            if s is None:
                missing_note(["Discount_Window_Primary_Credit"])
            else:
                f = go.Figure(go.Bar(x=s.index, y=s, name="Primary credit",
                                     marker_color=PALETTE["red"],
                                     hovertemplate="$%{y:,.0f}M<extra></extra>"))
                f.update_yaxes(title_text="$ Millions")
                st.plotly_chart(
                    style_fig(f, 400, "Discount Window — Primary Credit"), **FULL_WIDTH)

    corridor = [("IORB_Rate", "IORB", PALETTE["blue"]),
                ("SOFR_Rate", "SOFR", PALETTE["cyan"]),
                ("EFFR_Rate", "EFFR", PALETTE["amber"]),
                ("Primary_Credit_Rate", "Primary Credit Rate", PALETTE["red"])]
    present = [(c, lbl, col) for c, lbl, col in corridor if get(df, c) is not None]
    if present:
        with st.expander("Policy rate corridor (IORB · SOFR · EFFR · Primary Credit)"):
            f = go.Figure()
            for col, lbl, colour in present:
                s = get(df, col)
                f.add_trace(go.Scatter(
                    x=s.index, y=s, name=lbl,
                    line=dict(color=colour, width=1.9,
                              dash="dot" if col == "Primary_Credit_Rate" else "solid"),
                    hovertemplate=f"{lbl}: %{{y:.2f}}%<extra></extra>"))
            f.update_yaxes(title_text="Rate (%)")
            st.plotly_chart(style_fig(f, 400), **FULL_WIDTH)


# --------------------------------------------------------------------------- #
# Tab 4
# --------------------------------------------------------------------------- #

with tab4:
    ui.explainer("""
        **What M2 is.** Currency, checking and savings deposits, and retail money
        market funds — broad money held by households and firms.

        **How to read it.** The level is meaningless; growth rates are the point.

        - **Year-on-year** is the headline. M2 turned **negative in 2023** for
          the first time since the 1930s.
        - **Three-month annualised** turns much faster and is the one to watch
          for direction — it picks up an inflection roughly two quarters before
          the year-on-year rate does, at the cost of more false starts.

        **The concept behind it.** Money growing faster than the economy that has
        to absorb it has to go somewhere: historically into asset prices first
        and consumer prices later, with **long and variable lags of roughly two
        to three years**. Money growing slower is disinflationary on the same
        lag.

        **The honest caveat, which is large.** The link between money growth and
        inflation broke down as a forecasting relationship after the early
        1980s, because velocity stopped being stable. M2 got the 2021 inflation
        right when most models did not, which revived interest in it — but one
        good call is not a restored relationship. **Read this tab as context for
        the medium term, not as a signal.** Nothing on this page should be
        traded off M2 alone.
                """, label="How to read this tab")
    ui.range_picker(df.index, "liq_t4")
    m2_yoy = get(df, "M2_YoY_Growth_%")
    m2_3mann = get(df, "M2_3M_Annualized_%")

    if m2_yoy is None and m2_3mann is None:
        missing_note(["M2_YoY_Growth_%", "M2_3M_Annualized_%"])
    else:
        fig = go.Figure()
        if m2_yoy is not None:
            fig.add_trace(go.Scatter(x=m2_yoy.index, y=m2_yoy, name="M2 YoY Growth (%)",
                                     line=dict(color=PALETTE["blue"], width=2.4),
                                     hovertemplate="YoY: %{y:.2f}%<extra></extra>"))
        if m2_3mann is not None:
            fig.add_trace(go.Scatter(x=m2_3mann.index, y=m2_3mann,
                                     name="M2 3M Annualised (%)",
                                     line=dict(color=PALETTE["green"], width=2.0),
                                     hovertemplate="3M ann.: %{y:.2f}%<extra></extra>"))
        fig.add_hline(y=0, line=dict(color=PALETTE["muted"], width=1.2, dash="dash"),
                      annotation_text="0% — contraction below",
                      annotation_position="bottom right",
                      annotation_font=dict(color=PALETTE["muted"], size=11),
                      annotation_bgcolor="rgba(22,26,35,0.82)", annotation_borderpad=3)
        fig.update_yaxes(title_text="Growth (%)", ticksuffix="%")
        ui.add_recession_shading(fig, usrec, df.index)
        st.plotly_chart(
            style_fig(fig, 470, "M2 Growth: Year-over-Year vs. 3-Month Annualised"),
            **FULL_WIDTH)
        st.caption(
            "The 3-month annualised rate leads the year-over-year series — divergence "
            "between the two marks turning points in money growth momentum. Both are "
            "computed on the native monthly M2 series."
        )

    st.divider()

    m2 = get(df, "M2_Money_Supply")
    m2_ma = get(df, "M2_3M_MA")
    if m2 is None and m2_ma is None:
        missing_note(["M2_Money_Supply", "M2_3M_MA"])
    else:
        c1, c2 = st.columns([3, 1])
        with c1:
            f = go.Figure()
            if m2 is not None:
                f.add_trace(go.Scatter(x=m2.index, y=m2, name="M2 Money Supply",
                                       line=dict(color=PALETTE["violet"], width=2.2),
                                       hovertemplate="M2: $%{y:,.0f}B<extra></extra>"))
            if m2_ma is not None:
                f.add_trace(go.Scatter(x=m2_ma.index, y=m2_ma, name="M2 3-Month MA",
                                       line=dict(color=PALETTE["slate"], width=1.7, dash="dash"),
                                       hovertemplate="3M MA: $%{y:,.0f}B<extra></extra>"))
            f.update_yaxes(title_text="$ Billions")
            st.plotly_chart(style_fig(f, 420, "M2 Level and 3-Month Moving Average"),
                            **FULL_WIDTH)
        with c2:
            st.write("")
            v, d = kpi(m2, "${:,.0f}B", "{:+,.0f}B")
            st.metric("M2 Money Supply", v, d)
            v, d = kpi(m2_yoy, "{:.2f}%", "{:+.2f} pp")
            st.metric("M2 YoY Growth", v, d)
            v, d = kpi(m2_3mann, "{:.2f}%", "{:+.2f} pp")
            st.metric("M2 3M Annualised", v, d)


# --------------------------------------------------------------------------- #
# Lead/lag sleeves - tabs 5 to 7
#
# Each one is a single chart: a leading series pushed forward against what it is
# supposed to lead. The shifted line deliberately runs past today; that overhang
# is its implication, and the dotted marker shows where actual data stops.
# --------------------------------------------------------------------------- #

def sleeve(leader_col: str, follower_col: str, leader_label: str,
           follower_label: str, default_lead: int, key: str, title: str,
           leader_axis: str, follower_axis: str, note: str) -> None:
    if rates is None or rates.empty:
        st.info(
            "This chart needs the Rates data.\n\n"
            "```\npython refresh.py --block Rates\n```"
        )
        return

    leader, follower = get(rates, leader_col), get(rates, follower_col)
    if leader is None or follower is None:
        missing_note([c for c, v in ((leader_col, leader), (follower_col, follower))
                      if v is None])
        return

    lead = st.slider("Push the leading series forward (months)", 0, 24,
                     default_lead, key=f"{key}_lead")
    # After the slider: the shifted series runs past the data's own end, so the
    # window has to include that overhang.
    ui.range_picker(leader.index.union(follower.index), f"{key}_range",
                    default="Max")

    st.plotly_chart(
        ui.lead_lag_chart(leader, follower, leader_label, follower_label, lead,
                          usrec=usrec, leader_axis=leader_axis,
                          follower_axis=follower_axis, title=title,
                          default_years=15),
        **FULL_WIDTH)
    st.caption(note)

    with st.expander("Does the data actually prefer this lead?"):
        stats = summary(leader, follower, lead)
        ccf, best = stats["ccf"], stats["best"]
        if ccf.empty or best is None:
            st.info("Not enough overlapping history to check.")
            return
        c1, c2, c3 = st.columns(3)
        at_lead = stats["correlation_at_lead"]
        c1.metric(f"Correlation at {lead}m",
                  f"{at_lead:+.2f}" if at_lead is not None else "—",
                  help=f"{stats['observations_at_lead']} overlapping months.")
        c2.metric("Preferred lead", f"{best['lead']}m")
        c3.metric("Correlation there", f"{best['correlation']:+.2f}")
        st.plotly_chart(ui.ccf_chart(ccf, lead), **FULL_WIDTH)
        if abs(best["correlation"]) < 0.35:
            st.warning(
                f"Peak correlation is only {best['correlation']:+.2f}. The overlay "
                "is illustration, not evidence."
            )


with tab5:
    ui.explainer("""
        **What r-star is.** The real short-term interest rate that would keep the
        economy at full employment with stable inflation — neither stimulating
        nor restraining. It cannot be observed. Holston-Laubach-Williams is the
        New York Fed's published *model estimate* of it.

        **The arithmetic on this tab.**

        - **Real fed funds** = the effective fed funds rate minus core PCE
          inflation year-on-year. What policy costs in real terms.
        - **Restrictiveness** = real fed funds − r*. **Positive means policy is
          above neutral, i.e. actively restraining the economy.**

        **How to read it.** This is a measure of the *level of restraint*, not a
        forecast. Policy can sit restrictive for a long time without a
        recession — restraint that is mild and stable is very different from
        restraint that is deepening. Watch the direction more than the level.

        The chart pairs restrictiveness with the **10s30s curve** because the
        long end tends to re-steepen once the market becomes confident the
        restraint will be removed. The steepening usually starts well before the
        first cut.

        **Why you should not over-read it.** r* is estimated with a confidence
        interval of roughly **±1 percentage point** — wider than most of the
        moves people discuss. It is quarterly, and it gets **revised with every
        vintage**, sometimes substantially, so today's history is not the history
        anyone saw at the time. A restrictiveness reading of +0.4pp and one of
        +0.9pp are not meaningfully different. Treat this as "restrictive /
        neutral / accommodative", not as a number.
                """, label="How to read this tab")
    st.markdown(
        "**Faithful replica.** r-star is the New York Fed's published "
        "Holston-Laubach-Williams estimate; real fed funds is the monthly "
        "effective rate less core PCE."
    )
    _neutral = next((c for c in ("R* (HLW)", "R* (FOMC dot)")
                     if rates is not None and c in rates.columns), None)
    if _neutral == "R* (FOMC dot)":
        st.warning(
            "**Using the FOMC's longer-run dot, not the HLW model estimate.** "
            "The New York Fed's r-star workbook could not be retrieved on the "
            "last refresh, so neutral here is the Committee's median longer-run "
            "fed funds projection less the 2% inflation target. That is what "
            "the Fed *says* neutral is, rather than a statistical estimate of "
            "it — it steps four times a year instead of drifting, and it "
            "carries a policy signal. Re-run `python refresh.py --block Rates` "
            "to try the workbook again."
        )
    elif _neutral is None:
        st.info(
            "**No neutral-rate estimate in the cache**, so restrictiveness "
            "cannot be computed — it needs *real fed funds minus r\**, and "
            "only the first half is present.\n\n"
            "Re-run `python refresh.py --block Rates` and watch for a line "
            "beginning `HLW r-star UNAVAILABLE`. If it appears, run "
            "`python refresh.py --inspect-hlw` and send me the output.\n\n"
            "The other charts on this page are unaffected."
        )

    sleeve("Curve 10s30s (bps)", "Restrictiveness (Real FF - R*)",
           "10s30s curve", "Real fed funds − R*", 9, "neutral",
           "Rates Get More Restrictive as the Curve Flattens",
           "10s30s (bps)", "Restrictiveness (pp)",
           "Positive restrictiveness means policy sits above the neutral rate. "
           "r-star is quarterly and revises with each vintage.")

with tab6:
    ui.explainer("""
        **What this is.** Real M2 growth minus industrial production growth,
        standardised into a z-score. The idea it comes from: money growing
        faster than the real economy that has to absorb it leaves a surplus
        looking for a home.

        **How to read it.** Zero is the historical average. **Positive means
        money is growing faster than activity** — liquidity accumulating.
        Negative means liquidity draining relative to the economy's needs.

        It is charted against the **one-year change in the 3m10y curve** because
        surplus liquidity tends to steepen the curve — the front end is
        anchored by policy while the surplus pushes into duration and risk —
        and draining liquidity tends to flatten it.

        **Two things that keep it honest.** The z-score uses an **expanding
        window**, so a reading in 2015 was computed only from data available in
        2015 and no point on the line uses its own future. And industrial
        production is used because it is the highest-frequency real-activity
        series available monthly.

        **What it is not.** This is a **proxy for a concept, not a replica of
        anyone's indicator.** Bloomberg's excess liquidity indicator is a
        proprietary composite whose construction is not published; this is the
        textbook idea behind it, built from two public series. Do not expect the
        two lines to overlay. And industrial production is a narrow read on
        activity — manufacturing is about a tenth of the economy — so the
        denominator here is imperfect and the series is noisier than a broad
        activity measure would be.
                """, label="How to read this tab")
    st.markdown(
        "**Proxy, not a replica.** Excess liquidity here is real M2 growth minus "
        "industrial production growth, standardised — the standard concept behind "
        "Bloomberg's indicator, not the indicator itself, whose construction is "
        "not published."
    )
    sleeve("Excess Liquidity (proxy, z)", "Curve 3m10y, 1y change (bps)",
           "Excess liquidity (z)", "3m10y, 1y change", 6, "exliq",
           "Excess Liquidity and the Slope of the Curve",
           "Standard deviations", "1y change (bps)",
           "Money growing faster than the economy that has to absorb it tends to "
           "steepen the curve; liquidity draining flattens it. The z-score uses an "
           "expanding window, so no reading uses its own future.")

with tab7:
    ui.explainer("""
        **What a term premium is.** Break a 10-year yield into two parts: the
        average short rate the market expects over the next ten years, plus the
        **extra compensation demanded for actually holding the bond** rather
        than rolling bills. That second part is the term premium — payment for
        bearing duration risk. **Kim-Wright** is the Federal Reserve Board's
        three-factor model estimate of it.

        **Why the buyer base sits on the same chart.** The Fed and foreign
        official accounts buy Treasuries for reasons that have nothing to do
        with price — monetary policy, reserve management, currency intervention.
        They are **price-insensitive**. As their combined share of outstanding
        debt shrinks, the marginal buyer becomes a private investor who is very
        much price-sensitive and who demands compensation for duration. That
        compensation *is* the term premium.

        **The right axis is deliberately inverted** so a shrinking buyer share
        and a rising term premium move in the same visual direction.

        **How to read it, and why it matters.** When the 10-year sells off, the
        first question is *which component moved*.

        - **Expected short rates rose** → the market repriced the Fed. Bad for
          bonds, usually explicable, and equities can live with it if growth is
          the reason.
        - **Term premium rose while short-rate expectations were flat** → the
          long end is selling off for **supply and duration reasons**, not
          policy reasons. That is the more uncomfortable case: it tightens
          financial conditions without any growth improvement behind it, it
          tends to hit long-duration equities hardest, and the Fed cannot fix it
          by cutting.

        **What it cannot tell you.** A term premium is a **model output, not a
        market price** — nobody trades it. Different models disagree by tens of
        basis points on the level, and the decomposition is only as good as the
        assumptions inside it. The debt-share series is **quarterly**, and
        foreign holdings publish a quarter behind the Fed's, so the ratio is
        computed only where both are actually reported rather than being
        forward-filled into an invented number.
                """, label="How to read this tab")
    if rates is None or rates.empty:
        st.info("This tab needs the Rates data.\n\n```\npython refresh.py --block Rates\n```")
    else:
        st.markdown(
            "**Faithful replica.** Term premium is the Kim-Wright estimate from "
            "the Federal Reserve Board's three-factor model. The buyer base is "
            "the Fed plus foreign and international investors, as a share of "
            "total public debt — plotted **inverted**, so a shrinking share and "
            "a rising term premium move together."
        )

        premium = get(rates, "Term Premium 10y (KW)")
        share = get(rates, "Fed + Foreign Share of Debt (%)")
        fed_share = get(rates, "Fed Share of Debt (%)")
        foreign_share = get(rates, "Foreign Share of Debt (%)")

        m1, m2, m3, m4 = st.columns(4)
        v, d = kpi(premium, "{:+.2f}%", "{:+.2f}", lookback=365)
        m1.metric("Term premium (10y)", v, d,
                  help="Kim-Wright, on a 10-year zero coupon bond.")
        v, d = kpi(share, "{:.1f}%", "{:+.1f} pp", lookback=365)
        m2.metric("Fed + foreign share", v, d, delta_color="inverse")
        v, d = kpi(fed_share, "{:.1f}%", "{:+.1f} pp", lookback=365)
        m3.metric("Fed share", v, d, delta_color="inverse")
        v, d = kpi(foreign_share, "{:.1f}%", "{:+.1f} pp", lookback=365)
        m4.metric("Foreign share", v, d, delta_color="inverse")

        st.write("")

        if premium is None or share is None:
            missing_note([n for n, v in (("Term Premium 10y (KW)", premium),
                                         ("Fed + Foreign Share of Debt (%)", share))
                          if v is None])
        else:
            ui.range_picker(rates.index, "liq_t7_tp", default="Max")
            fig = make_subplots(specs=[[{"secondary_y": True}]])
            fig.add_trace(go.Scatter(
                x=premium.index, y=premium, name="Term premium, 10y (KW)",
                line=dict(color=PALETTE["blue"], width=2.2),
                hovertemplate="Term premium: %{y:+.2f}%<extra></extra>"),
                secondary_y=False)
            fig.add_trace(go.Scatter(
                x=share.index, y=share, name="Fed + foreign share of debt (inverted)",
                line=dict(color=PALETTE["cyan"], width=2.2),
                hovertemplate="Share: %{y:.1f}%<extra></extra>"), secondary_y=True)

            fig.add_hline(y=0, line=dict(color=PALETTE["muted"], width=1.1, dash="dash"))
            fig.update_yaxes(title_text="Term premium (%)", secondary_y=False)
            # Inverted, as in the original: less price-insensitive demand pushes
            # the line down the page while the premium climbs.
            fig.update_yaxes(title_text="Fed + foreign share of debt (%, inverted)",
                             secondary_y=True, showgrid=False, autorange="reversed")
            ui.add_recession_shading(fig, usrec, premium.index)
            st.plotly_chart(
                style_fig(fig, 480,
                          "Term Premium vs. the Price-Insensitive Buyer Base"),
                **FULL_WIDTH)
            st.caption(
                "The Fed and foreign official accounts buy Treasuries for reasons "
                "other than price. As their combined share of the debt shrinks, "
                "the marginal buyer is someone who wants paying for duration risk "
                "— which is what a term premium is. Holdings are quarterly and "
                "foreign data publishes about a quarter behind the Fed's, so the "
                "share is computed only through the last quarter both have "
                "reported, then held flat."
            )

            with st.expander("Split the buyer base: Fed vs foreign"):
                if fed_share is None or foreign_share is None:
                    missing_note(["Fed Share of Debt (%)", "Foreign Share of Debt (%)"])
                else:
                    f3 = go.Figure()
                    for series, name, colour in (
                        (fed_share, "Fed", PALETTE["violet"]),
                        (foreign_share, "Foreign & international", PALETTE["amber"]),
                    ):
                        f3.add_trace(go.Scatter(
                            x=series.index, y=series, name=name,
                            stackgroup="one", line=dict(width=0.5, color=colour),
                            hovertemplate=f"{name}: %{{y:.1f}}%<extra></extra>"))
                    f3.update_yaxes(title_text="Share of total public debt (%)")
                    ui.add_recession_shading(f3, usrec, fed_share.index)
                    st.plotly_chart(
                        style_fig(f3, 380, "Who Holds the Debt"), **FULL_WIDTH)
                    st.caption(
                        "Stacked, so the top of the band is the combined share "
                        "plotted above. Useful for telling a Fed-driven decline "
                        "(QT) from a foreign-driven one (reserve managers "
                        "stepping back)."
                    )

        st.divider()

        change = get(rates, "10y Real Yield, 1y change (bps)")
        level = get(rates, "UST 10y real")
        if change is None and level is None:
            missing_note(["10y Real Yield, 1y change (bps)", "UST 10y real"])
        else:
            ui.range_picker(rates.index, "liq_t7", default="10Y")
        if change is not None:
            fig = go.Figure(go.Scatter(
                x=change.index, y=change, name="10y real yield, 1y change",
                line=dict(color=PALETTE["text"], width=2.2),
                hovertemplate="%{y:+.0f} bps<extra></extra>"))
            fig.add_hline(y=0, line=dict(color=PALETTE["muted"], width=1.2, dash="dash"))
            fig.update_yaxes(title_text="1-year change (bps)")
            ui.add_recession_shading(fig, usrec, change.index)
            st.plotly_chart(
                style_fig(fig, 400, "10-Year Real Yield — Year-over-Year Change"),
                **FULL_WIDTH)

        if level is not None:
            f2 = go.Figure(go.Scatter(
                x=level.index, y=level, name="10y real yield",
                line=dict(color=PALETTE["cyan"], width=2.2),
                fill="tozeroy", fillcolor="rgba(34,211,238,0.10)",
                hovertemplate="%{y:.2f}%<extra></extra>"))
            f2.add_hline(y=0, line=dict(color=PALETTE["muted"], width=1.2, dash="dash"))
            f2.update_yaxes(title_text="Yield (%)")
            ui.add_recession_shading(f2, usrec, level.index)
            st.plotly_chart(
                style_fig(f2, 380, "10-Year Real Yield — Level"), **FULL_WIDTH)
            st.caption(
                "TIPS constant maturity, so history starts in 2003. The level "
                "matters more than the change for anything balance-sheet related; "
                "the change is what the original chart tracked."
            )


st.divider()
with st.expander("Underlying data"):
    st.dataframe(df.tail(250).iloc[::-1], height=380, **FULL_WIDTH)
