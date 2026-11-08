"""
Macro & Policy — inflation, activity, labour and policy rates by region
=======================================================================
Reads cache/macro.parquet. Run `python refresh.py --block Macro` to update.
"""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import ui
from data.globalmacro import (CATALOGUE, PANEL_ACTIVITY, PANEL_INFLATION,
                              PANEL_LABOUR, PANEL_POLICY, PANEL_TRADE,
                              panel_columns, spec_for)
from ui import FULL_WIDTH, PALETTE, get, style_fig

#: Inflation targets, for the reference line. Malaysia has no numerical target,
#: which is itself worth saying on the chart rather than inventing one.
TARGETS = {"US": 2.0, "Japan": 2.0, "Euro area": 2.0}

data = ui.load_block("macro")
if data is None or data.empty:
    st.error(
        "No cached **macro** data found.\n\n"
        "Run this in the project folder, then reload:\n\n"
        "```\npython refresh.py --block Macro\n```\n\n"
        "If that fails, `python refresh.py --macro-check` prints what each "
        "region returned."
    )
    st.stop()

context = ui.load_block("context")
usrec = get(context, "NBER_Recession") if context is not None else None

df = data
latest_day = df.dropna(how="all").index.max()

st.sidebar.divider()
ui.download_button(df, "macro")


def colour_for(column: str, index: int) -> str:
    """One colour per region, so a region keeps its colour across every tab."""
    for region, shade in (("US", PALETTE["blue"]), ("Japan", PALETTE["amber"]),
                          ("Malaysia", PALETTE["green"]),
                          ("Euro area", PALETTE["violet"])):
        if column.startswith(region):
            return shade
    return ui.SERIES_COLORS[index % len(ui.SERIES_COLORS)]


def latest_of(column: str) -> tuple[float, pd.Timestamp] | None:
    series = get(df, column)
    if series is None:
        return None
    clean = series.dropna()
    return (float(clean.iloc[-1]), clean.index[-1]) if not clean.empty else None


def draw(columns: list[str], title: str, unit: str, *, key: str,
         target: bool = False, step: tuple[str, ...] = (),
         height: int = 450) -> None:
    """One panel: a line per series, region-coloured, with the right unit."""
    if not columns:
        ui.missing_note([title])
        return
    ui.range_picker(df.index, key)
    fig = go.Figure()
    for i, column in enumerate(columns):
        series = get(df, column)
        if series is None:
            continue
        shape = "hv" if column in step else "linear"
        fig.add_trace(go.Scatter(
            x=series.index, y=series, name=column,
            line=dict(color=colour_for(column, i), width=2.0, shape=shape),
            connectgaps=False,
            hovertemplate=f"{column}: %{{y:.2f}}{unit}<extra></extra>"))
    if target:
        fig.add_hline(y=2.0, line=dict(color=PALETTE["red"], width=1.2, dash="dash"),
                      annotation_text="2% — the US, euro area and Japanese target",
                      annotation_position="top left",
                      annotation_font=dict(color=PALETTE["red"], size=10),
                      annotation_bgcolor="rgba(22,26,35,0.82)")
        fig.add_hline(y=0, line=dict(color=PALETTE["muted"], width=1.1, dash="dot"))
    fig.update_yaxes(title_text=unit if unit != "%" else "Percent")
    ui.add_recession_shading(fig, usrec, df.index)
    st.plotly_chart(style_fig(fig, height, title), **FULL_WIDTH)


# --------------------------------------------------------------------------- #
# Header
# --------------------------------------------------------------------------- #

present = [c for c in CATALOGUE if c in df.columns]
regions = sorted({c.split()[0] if not c.startswith("Euro") else "Euro area"
                  for c in present})

st.title("Macro & Policy")
st.markdown(
    f"<p class='caption-note'>Data through <b>{latest_day:%d %B %Y}</b> · "
    f"{len(present)} series · sources: FRED · e-Stat (Japan) · "
    "OpenDOSM &amp; Bank Negara (Malaysia)</p>",
    unsafe_allow_html=True,
)

ui.explainer("""
    **What this page is.** The economy, by region, on one screen — inflation,
    activity, labour and the policy rate. Every other page is about the price
    of something; this is about what those prices are responding to.

    **Where the numbers come from, and why that matters.** The Japanese and
    Malaysian series are **national statistical office data**, taken from e-Stat
    and OpenDOSM directly rather than through an aggregator. They were already
    being downloaded for the Calendar, used to fill one "Actual" column, and
    discarded; this page keeps them. The US comes from FRED and the policy rates
    from FRED and Bank Negara.

    **Read each series against its own history, not against the others.**
    Japanese inflation at 2% and Malaysian inflation at 2% are not the same
    event: one is the highest sustained rate in three decades and the other is
    unremarkable. The 2% line on the inflation chart is the *target* for the US,
    euro area and Japan — **Malaysia has no numerical inflation target**, so for
    the Malaysian line that reference means nothing at all.

    **Two things to watch for that a single series will not show you.**

    * **Divergence between core and headline.** Only the US has both here (CPI
      and core PCE). When headline runs above core the driver is energy or food
      and usually fades; when core leads, it is wages and services and does not.
    * **Divergence between inflation and the policy rate.** The gap between
      them is the real policy rate, and it is the thing that actually tightens
      or loosens. A central bank holding at 3% while inflation falls from 4% to
      2% has tightened materially without doing anything.

    **What it cannot tell you.** Revisions. Almost everything here is revised,
    some of it substantially, and the chart shows the *current* vintage — not
    what was known at the time. Any story about what a central bank "should have
    seen" is being told with numbers it did not have.

    **The euro area is a policy rate only.** Its HICP and unemployment come
    through the OECD and Eurostat families that FRED has been culling, and a
    series that quietly stops is worse than one that is absent. The ECB's own
    portal is the right source and is a separate piece of work.
""")

boxes = st.columns(4)
for box, column in zip(boxes, ("US CPI YoY", "US core PCE YoY",
                               "Japan CPI YoY", "Malaysia CPI YoY")):
    found = latest_of(column)
    if found is None:
        box.metric(column, "—")
        continue
    value, when = found
    box.metric(column.replace(" YoY", ""), f"{value:.2f}%",
               f"{when:%b %Y}", delta_color="off")

st.write("")

tab_inflation, tab_activity, tab_policy = st.tabs(
    ["🔥 Inflation", "🏭 Activity & Labour", "🏛️ Policy Rates"])


# --------------------------------------------------------------------------- #
# Inflation
# --------------------------------------------------------------------------- #

with tab_inflation:
    ui.explainer("""
        **What you are looking at.** Twelve-month percentage change in consumer
        prices, by region, plus the US core PCE measure the Fed actually targets.

        **How to read it.**

        * **The level against 2%** — but only for the US, euro area and Japan.
          Malaysia does not run a numerical inflation target; Bank Negara
          targets price stability without publishing a number, so the line is
          context for three of the four regions and decoration for the fourth.
        * **The direction and its second derivative.** Inflation falling from 5%
          to 4% and from 3% to 2.8% are the same sign and very different
          situations. The first is disinflation doing the work; the second is
          the last mile, which has historically taken far longer than the first.
        * **Japan separately from everyone.** Japan spent twenty-five years
          trying to *create* inflation. A print that would alarm a Western
          central bank is, there, the policy working. The Tokyo series prints
          about three weeks before the national one and tracks it closely — it
          is the earliest read available anywhere.

        **CPI versus core PCE.** They are different baskets with different
        weights, and PCE typically runs a few tenths below CPI because it
        allows for substitution and weights healthcare differently. The Fed's
        2% is on core PCE, so comparing a CPI print to the 2% target
        overstates the gap — a distinction most commentary drops.

        **What it cannot tell you.** What inflation is *expected* to be. These
        are realised prints; expectations are on the Fixed Income page as
        breakevens, and they are the number that matters for a bond.
                    """, label="How to read this tab")

    draw(panel_columns(df, PANEL_INFLATION), "Inflation — year-over-year",
         "%", key="macro_infl", target=True, height=470)

    rows = []
    for column in panel_columns(df, PANEL_INFLATION):
        found = latest_of(column)
        if found is None:
            continue
        value, when = found
        series = get(df, column).dropna()
        year_ago = series.loc[:series.index[-1] - pd.DateOffset(years=1)]
        rows.append({
            "Series": column, "Latest": value, "As of": f"{when:%b %Y}",
            "A year ago": float(year_ago.iloc[-1]) if not year_ago.empty else None,
            "Change (pp)": (value - float(year_ago.iloc[-1])
                            if not year_ago.empty else None),
        })
    if rows:
        st.dataframe(
            pd.DataFrame(rows).style.format(
                {"Latest": "{:.2f}%", "A year ago": "{:.2f}%",
                 "Change (pp)": "{:+.2f}"}, na_rep="—"),
            **FULL_WIDTH, hide_index=True)


# --------------------------------------------------------------------------- #
# Activity & labour
# --------------------------------------------------------------------------- #

with tab_activity:
    ui.explainer("""
        **Two questions, on one tab.** Is output growing, and is the labour
        market tight?

        **Activity.** US industrial production and Malaysian IPI are
        year-over-year changes in physical output. They are narrow — industry is
        a minority of both economies — but they are **monthly and barely
        revised**, which makes them a faster read than GDP. Malaysian GDP is
        here too, quarterly, drawn as a step because that is what a quarterly
        series is; drawing it as a smooth line would invent movement between
        prints that did not happen.

        **Labour is the slower and more reliable one.** Unemployment turns late
        — by the time it is rising, the thing that caused it happened months
        ago — but it almost never gives a false signal. Watch the **change from
        the low**, not the level: a rate of 4% means completely different things
        on the way down and on the way up, and the Sahm rule on the Growth page
        exists precisely because the rise from the trough is what carries the
        information.

        **The comparison that does not work.** Unemployment rates are not
        comparable across countries. Japan's counts differently from the US,
        which counts differently from Malaysia — participation, discouraged
        workers and the treatment of informal employment all differ. **Compare
        each country against its own history**, which is what the chart is for;
        the fact that Japan's number is lower than Malaysia's says more about
        measurement than about either labour market.

        **What it cannot tell you.** Quality. Hours, wages and the
        full-time/part-time mix all move independently of the headline rate,
        and a falling unemployment rate driven by people leaving the labour
        force entirely looks identical here to one driven by hiring.
                    """, label="How to read this tab")

    draw(panel_columns(df, PANEL_ACTIVITY), "Activity — year-over-year", "%",
         key="macro_act", step=("Malaysia GDP YoY",), height=430)

    st.divider()
    draw(panel_columns(df, PANEL_LABOUR), "Unemployment rate", "%",
         key="macro_lab", height=400)
    st.caption(
        "Levels are **not comparable across countries** — the definitions "
        "differ. Read each line against its own history."
    )

    trade = panel_columns(df, PANEL_TRADE)
    if trade:
        st.divider()
        draw(trade, "Malaysia — monthly goods trade balance", "RM mn",
             key="macro_trade", height=360)
        st.caption(
            "A level in ringgit, not a rate, which is why it has its own panel. "
            "Malaysia runs a persistent goods surplus; the informative move is "
            "a change in its size, not its sign."
        )


# --------------------------------------------------------------------------- #
# Policy rates
# --------------------------------------------------------------------------- #

with tab_policy:
    ui.explainer("""
        **Four central banks on one axis.** The Fed funds target upper bound,
        the ECB deposit facility rate, and Bank Negara's OPR. Each is drawn as
        a **step**, because a policy rate does not drift — it sits still and
        then jumps, and a smooth line between decisions would draw movement
        that never happened.

        **What to look at.**

        * **The level relative to inflation.** A policy rate of 3% with
          inflation at 2% is restrictive; the same 3% with inflation at 5% is
          not. That difference — the real policy rate — is what actually
          tightens, and it moves even when the central bank does nothing. Read
          this tab beside the Inflation one.
        * **Divergence between banks.** When one central bank moves and another
          does not, the gap shows up in the currency and in the hedging cost on
          the Fixed Income page's Cross-Market tab. Policy divergence is the
          single most reliable driver of the FX moves that matter to a
          ringgit-based book.
        * **How long a level has held.** A rate that has not moved in eighteen
          months tells you the central bank believes it is at the right level.
          The interesting moment is when the market stops believing that, which
          shows up in the curve before it shows up here.

        **Bank Negara is a different animal.** The OPR has moved in a narrow
        band for a decade and Bank Negara does not publish a numerical inflation
        target, so its reaction function is less mechanical than the Fed's.
        Reading Malaysian policy through a Fed-shaped lens gets it wrong.

        **What it cannot tell you.** What happens next. There is no free source
        of market-implied policy expectations — OIS curves are vendor data — so
        the closest available proxy is the front end of the yield curve on the
        Fixed Income page, and it is a proxy, not the thing itself.
                    """, label="How to read this tab")

    policy = panel_columns(df, PANEL_POLICY)
    if not policy:
        ui.missing_note(["policy rates"])
    else:
        # Every one of these is a step series; the OPR is additionally sparse,
        # carrying a value only on decision dates.
        ui.range_picker(df.index, "macro_policy")
        fig = go.Figure()
        for i, column in enumerate(policy):
            series = get(df, column)
            if series is None:
                continue
            line = series.reindex(df.index.union(series.index)).ffill()
            line = line.loc[df.index.min():]
            fig.add_trace(go.Scatter(
                x=line.index, y=line, name=column,
                line=dict(color=colour_for(column, i), width=2.1, shape="hv"),
                hovertemplate=f"{column}: %{{y:.2f}}%<extra></extra>"))
        fig.update_yaxes(title_text="Percent")
        ui.add_recession_shading(fig, usrec, df.index)
        st.plotly_chart(style_fig(fig, 450, "Policy Rates"), **FULL_WIDTH)

        rows = []
        for column in policy:
            series = get(df, column)
            if series is None:
                continue
            clean = series.dropna()
            changed = clean.ne(clean.shift())
            changed.iloc[0] = True
            last_move = clean.index[changed][-1]
            rows.append({
                "Central bank": column.replace(" policy rate", ""),
                "Rate": float(clean.iloc[-1]),
                "Last change": f"{last_move:%d %b %Y}",
                "Held for": f"{(clean.index[-1] - last_move).days // 30} months",
            })
        if rows:
            st.dataframe(
                pd.DataFrame(rows).style.format({"Rate": "{:.2f}%"}),
                **FULL_WIDTH, hide_index=True)
            st.caption(
                "**Held for** is measured from the last change in the series, "
                "so for a rate read daily it is the true stretch since the last "
                "move. The OPR carries a value only on decision dates and is "
                "forward-filled onto the chart."
            )
