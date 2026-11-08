"""
Fixed Income — government bond curves
=====================================
US (Treasury), euro area (ECB), Japan (Ministry of Finance) and Malaysia
(Bank Negara) government curves. Reads cache/curves.parquet and the FX columns
of cache/rates.parquet - run `python refresh.py --block Curves` to update.
"""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

import ui
from data.curves import curve_columns, tenor_of
from ui import FULL_WIDTH, PALETTE, get, kpi, style_fig

MARKETS = {
    "US": ("US Treasury — nominal", PALETTE["blue"]),
    "US real": ("US Treasury — TIPS real", PALETTE["cyan"]),
    "EA": ("Euro area — AAA government", PALETTE["violet"]),
    "JP": ("Japan — JGB", PALETTE["amber"]),
    "MY": ("Malaysia — MGS", PALETTE["green"]),
    "MY GII": ("Malaysia — GII (Islamic)", PALETTE["slate"]),
    "MY bills": ("Malaysia — treasury bills", PALETTE["muted"]),
}

#: Hedging a foreign bond back to your own currency costs, to a first
#: approximation, the short-rate difference between the two countries. One
#: horizon is used for every pair so the numbers are comparable; see the
#: Cross-Market tab's explainer for what that approximation leaves out.
HEDGE_TENOR = "1Y"

#: Reference points on the curve, by name, in months. A market that does not
#: publish one of these simply has no row for it.
KEY_TENORS = {"3M": 3, "2Y": 24, "5Y": 60, "10Y": 120, "30Y": 360}

LOOKBACKS = {"1 month ago": 30, "3 months ago": 91,
             "6 months ago": 182, "1 year ago": 365}


# --------------------------------------------------------------------------- #
# Load
# --------------------------------------------------------------------------- #

data = ui.load_block("curves")
if data is None or data.empty:
    st.error(
        "No cached **curves** data found.\n\n"
        "Run this in the project folder, then reload:\n\n"
        "```\npython refresh.py --block Curves\n```\n\n"
        "If that fails, `python refresh.py --curves-check` prints what each "
        "source returned."
    )
    st.stop()

context = ui.load_block("context")
usrec = get(context, "NBER_Recession") if context is not None else None
rates = ui.load_block("rates")          # carries the FX legs; may be absent
opr = get(data, "MY OPR")               # decisions only - ffill before charting

df = data
available = {m: curve_columns(df, m) for m in MARKETS}
available = {m: c for m, c in available.items() if c}

st.sidebar.divider()
ui.download_button(df, "curves")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def curve_on(asof: pd.Timestamp, columns: list[str]) -> pd.Series:
    """
    The curve as it stood on the last day at or before `asof`.

    Forward-filled per tenor rather than taking one row, because the markets
    keep different holidays and a single row on a Japanese holiday would come
    back empty rather than stale.
    """
    window = df.loc[:asof, columns]
    if window.empty:
        return pd.Series(dtype="float64")
    return window.ffill().iloc[-1]


def tenor_axis(columns: list[str]) -> tuple[list[float], list[str]]:
    tenors = [tenor_of(c) for c in columns]
    return [t.months for t in tenors], [t.label for t in tenors]


def spread(market: str, long: str, short: str) -> pd.Series | None:
    """A curve slope in basis points, e.g. 2s10s."""
    a, b = get(df, f"{market} {long}"), get(df, f"{market} {short}")
    if a is None or b is None:
        return None
    out = (a - b).dropna() * 100.0
    return out if not out.empty else None


latest_day = df.dropna(how="all").index.max()


# --------------------------------------------------------------------------- #
# Header
# --------------------------------------------------------------------------- #

st.title("Fixed Income — Government Curves")
st.markdown(
    f"<p class='caption-note'>Data through <b>{latest_day:%d %B %Y}</b> · "
    f"{' · '.join(f'{m} {len(c)} tenors' for m, c in available.items())} · "
    "sources: US Treasury · ECB · Japan MoF · Bank Negara</p>",
    unsafe_allow_html=True,
)

ui.explainer("""
    **What this page is.** The price of government money, by maturity, in four
    markets — the United States, the euro area, Japan and Malaysia. Everything
    else on this dashboard is about stress or activity; this is the discount
    rate that all of it eventually shows up in.

    **Why these sources and not FRED.** Treasury, the ECB and the Japanese
    Ministry of Finance publish these curves themselves. FRED has twice in two
    years silently shortened or withdrawn a series it redistributed — so where a
    primary source exists, the dashboard uses it. Japan runs to **40 years** and
    back to **1974**, which FRED has never carried, and the euro area curve is
    the AAA-rated one, not the all-issuer version that blends in peripheral
    credit risk.

    **Malaysia, and a correction.** This page used to say Malaysia was
    impossible — Bank Negara's published endpoint list does not mention it and
    the curve appears on the FMIP portal only as a rendered page. It turns out
    the Open API does serve `/public/gov-sec-yield`; it is simply undocumented
    in the places that were checked. **MGS and GII now appear as real curves**
    where the data is in the cache.

    Two things to keep straight about them. **MGS and GII are different
    instruments** — conventional and Islamic — with a persistent basis between
    them, so they are kept on separate curves rather than blended. And BNM
    serves **one day per request**, so Malaysian history starts from the first
    refresh and lengthens from there; it is not a deep series yet.

    **Three things a curve tells you that a single yield does not.**

    1. **Level** — what long money costs. Mostly growth and inflation expectations.
    2. **Slope** — what the market thinks the central bank does next. An
       inverted curve is the bond market saying policy is tighter than the
       economy can carry for long.
    3. **Real vs nominal** — the US TIPS curve separates the two. A rising
       nominal yield with a flat real yield is an inflation story; both rising
       together is a growth or term-premium story, and they mean opposite
       things for equities.

    **What it cannot tell you.** A curve is a price, not a forecast. Inversion
    has preceded every US recession since 1970 and has also inverted without
    one; the lag has ranged from six months to two years, which is too wide to
    trade on by itself. Read it as a constraint on what the market believes,
    not as a date.
""")

# --------------------------------------------------------------------------- #
# KPIs
# --------------------------------------------------------------------------- #

kpis = [
    ("US 10y", get(df, "US 10Y"), "{:.2f}%", "{:+.2f} pp"),
    ("US 10y real", get(df, "US real 10Y"), "{:.2f}%", "{:+.2f} pp"),
    ("US 2s10s", spread("US", "10Y", "2Y"), "{:.0f} bp", "{:+.0f} bp"),
    ("JGB 10y", get(df, "JP 10Y"), "{:.2f}%", "{:+.2f} pp"),
    ("EA 10y", get(df, "EA 10Y"), "{:.2f}%", "{:+.2f} pp"),
]
# Malaysia takes the last slot: the MGS 10-year if the curve is cached, the
# policy rate if it is not, so the row never carries an empty box.
if get(df, "MY 10Y") is not None:
    kpis.append(("MGS 10y", get(df, "MY 10Y"), "{:.2f}%", "{:+.2f} pp"))
elif opr is not None:
    kpis.append(("MY OPR", opr, "{:.2f}%", "{:+.2f} pp"))
else:
    kpis.append(("JGB 2s10s", spread("JP", "10Y", "2Y"), "{:.0f} bp", "{:+.0f} bp"))
columns = st.columns(len(kpis))
for box, (label, series, fmt, delta_fmt) in zip(columns, kpis):
    value, delta = kpi(series, fmt, delta_fmt)
    box.metric(label, value, delta, delta_color="off")

st.write("")

tab1, tab2, tab3, tab4 = st.tabs(["📐 Curve Shape Today", "📈 Levels Over Time",
                                  "🪜 Slope History", "🌏 Cross-Market"])


# --------------------------------------------------------------------------- #
# Tab 1 - the curve itself
# --------------------------------------------------------------------------- #

with tab1:
    ui.explainer("""
        **What you are looking at.** Yield on the vertical axis, maturity on the
        horizontal — one line per date. This is the only chart on the dashboard
        where the x-axis is *not* time.

        **How to read it.** The gap between the lines is the move. Watch *where*
        on the curve it happened, because that is the information:

        * **Front end moves, long end doesn't** — the market repriced the
          central bank. Policy expectation, not a growth view.
        * **Long end moves, front end doesn't** — term premium, supply, or a
          changed inflation view. This is the one that hurts risk assets,
          because it raises the discount rate without any offsetting growth
          story.
        * **Whole curve shifts in parallel** — usually a global rates move or an
          inflation surprise.
        * **Curve pivots around the belly (5-7y)** — a change in the expected
          path rather than the destination.

        **Japan specifically.** The JGB curve is the one place a free dataset
        gives you 40 years, and the 30y-40y segment is where the pension and
        life-insurance bid shows up. A steepening there with a pinned front end
        is a Bank of Japan story, not a global one, and it has spilled into US
        long rates more than once — a Japanese investor who can suddenly get
        the yield at home stops hedging into Treasuries.

        **What it cannot tell you.** These are *par* yields interpolated from
        traded bonds, not the yield on any specific bond you could buy. Liquidity
        at the very long end is thin, so a 40y move on a quiet day may be
        marking, not trading.
                """, label="How to read this tab")

    picks = st.multiselect(
        "Compare with", list(LOOKBACKS), default=["3 months ago", "1 year ago"],
        key="fi_lookbacks",
        help="Each adds one line to every curve below.")

    dates = [("Latest", latest_day)] + [
        (name, latest_day - pd.Timedelta(days=LOOKBACKS[name])) for name in picks]

    shades = [PALETTE["text"], PALETTE["slate"], PALETTE["muted"], "#5B6472", "#454B57"]

    for market, columns_for_market in available.items():
        title, colour = MARKETS[market]
        months, labels = tenor_axis(columns_for_market)

        fig = go.Figure()
        for i, (name, asof) in enumerate(dates):
            values = curve_on(asof, columns_for_market)
            if values.empty or values.isna().all():
                continue
            actual = df.loc[:asof, columns_for_market].dropna(how="all")
            stamp = actual.index.max() if not actual.empty else asof
            is_latest = i == 0
            fig.add_trace(go.Scatter(
                x=months, y=[values[c] for c in columns_for_market],
                name=f"{name} ({stamp:%d %b %y})",
                mode="lines+markers",
                line=dict(color=colour if is_latest else shades[min(i, len(shades) - 1)],
                          width=2.6 if is_latest else 1.5,
                          dash=None if is_latest else "dot"),
                marker=dict(size=7 if is_latest else 4),
                hovertemplate="%{text}: %{y:.2f}%<extra></extra>",
                text=labels))

        if not fig.data:
            continue
        fig.update_xaxes(title_text="Maturity", tickvals=months, ticktext=labels,
                         type="log")
        fig.update_yaxes(title_text="Par yield (%)"
                         if market != "US real" else "Real yield (%)")
        if market == "US real":
            fig.add_hline(y=0, line=dict(color=PALETTE["muted"], width=1.1, dash="dash"))
        st.plotly_chart(style_fig(fig, 400, title, range_controls=False), **FULL_WIDTH)

        # Levels and changes, in the units a rates person actually quotes.
        latest_values = curve_on(latest_day, columns_for_market)
        table = pd.DataFrame({"Yield (%)": [latest_values[c] for c in columns_for_market]},
                             index=labels)
        for name in picks:
            then = curve_on(latest_day - pd.Timedelta(days=LOOKBACKS[name]),
                            columns_for_market)
            if then.empty:
                continue
            table[f"Δ vs {name} (bp)"] = [
                (latest_values[c] - then[c]) * 100 if pd.notna(then.get(c)) else None
                for c in columns_for_market]
        st.dataframe(table.T.style.format("{:.2f}", na_rep="—"), **FULL_WIDTH)
        st.write("")


# --------------------------------------------------------------------------- #
# Tab 2 - levels over time
# --------------------------------------------------------------------------- #

with tab2:
    ui.explainer("""
        **What this shows.** One line per maturity, through time. Use it to see
        *when* a curve move happened and whether it has held.

        **How to read it.** Two questions are worth asking of every line:

        * **Where is it against its own history?** A 10-year JGB at 3% is
          unremarkable in a US chart and is the highest in a generation in a
          Japanese one. Levels only mean something against their own past.
        * **Are the lines converging or fanning out?** Converging is the curve
          flattening — the market pulling the expected policy path and the
          destination closer together. Fanning out is steepening.

        **The real curve is the one to watch for asset allocation.** US TIPS
        yields are what a long-duration asset is actually discounted at once
        inflation is stripped out. A 10-year real yield above roughly 2% has
        historically been where equity valuations start to feel it, because at
        that point a risk-free real return competes with the equity risk
        premium rather than being rounding error against it.

        **What it cannot tell you.** Nothing here is a total return. A yield
        rising from 3% to 4% is a loss for whoever owned the bond, and the size
        of that loss depends on duration, which this page does not show.
                """, label="How to read this tab")

    market = st.segmented_control(
        "Market", list(available), default=list(available)[0], key="fi_market") \
        if hasattr(st, "segmented_control") else st.radio(
            "Market", list(available), horizontal=True, key="fi_market")
    market = market or list(available)[0]

    columns_for_market = available[market]
    labels = [tenor_of(c).label for c in columns_for_market]
    default = [c for c, label in zip(columns_for_market, labels)
               if label in KEY_TENORS] or columns_for_market[:4]

    chosen = st.multiselect(
        "Tenors", columns_for_market, default=default, key=f"fi_tenors_{market}",
        format_func=lambda c: tenor_of(c).label)

    if not chosen:
        st.info("Pick at least one tenor.")
    else:
        ui.range_picker(df.index, f"fi_levels_{market}")
        fig = go.Figure()
        for i, column in enumerate(chosen):
            series = get(df, column)
            if series is None:
                continue
            fig.add_trace(go.Scatter(
                x=series.index, y=series, name=tenor_of(column).label,
                line=dict(color=ui.SERIES_COLORS[i % len(ui.SERIES_COLORS)], width=1.9),
                hovertemplate=f"{tenor_of(column).label}: %{{y:.2f}}%<extra></extra>"))
        if market == "US real":
            fig.add_hline(y=0, line=dict(color=PALETTE["muted"], width=1.1, dash="dash"),
                          annotation_text="zero real yield",
                          annotation_position="bottom right",
                          annotation_font=dict(color=PALETTE["muted"], size=10))
        fig.update_yaxes(title_text="Yield (%)")
        if market.startswith("US"):
            ui.add_recession_shading(fig, usrec, df.index)
        st.plotly_chart(style_fig(fig, 470, MARKETS[market][0]), **FULL_WIDTH)


# --------------------------------------------------------------------------- #
# Tab 3 - slope
# --------------------------------------------------------------------------- #

SLOPES = [
    ("2s10s", "10Y", "2Y",
     "The classic recession signal. Inverts when the market expects cuts."),
    ("3m10y", "10Y", "3M",
     "The Fed's own preferred version — it tracks the near-term policy path "
     "more cleanly than 2s10s, which carries a term-premium component."),
    ("10s30s", "30Y", "10Y",
     "The long end alone. Steepens on supply, term premium and fiscal worry "
     "rather than on anything the central bank is about to do."),
]

with tab3:
    ui.explainer("""
        **What this shows.** The difference between two points on the same
        curve, in basis points, through time. Below zero is inverted — long
        money cheaper than short money, which is not the natural order and
        happens when the market expects the policy rate to fall.

        **How to read it, in sequence.** The part people get wrong is that the
        *un*-inversion is the signal, not the inversion:

        1. **Inverting** — the market is pricing cuts. Policy is being called
           restrictive. On its own this can persist for a very long time.
        2. **Deeply inverted, stable** — that view is entrenched. Historically
           the least informative state, and the easiest to get bored of.
        3. **Re-steepening from inversion** — this is the part that has clustered
           near recessions. It comes two ways, and they are not the same thing.
           *Bull steepening* (front end falls faster) is the market pulling cuts
           forward — it is the recessionary one. *Bear steepening* (long end
           rises faster) is a term-premium or fiscal story, and usually is not.
           This chart shows the slope, not which leg moved, so check the Levels
           tab before concluding anything.

        **3m10y versus 2s10s.** Prefer 3m10y when the question is about policy.
        The 3-month bill is anchored to the actual policy rate, so the spread is
        a nearly pure read on the expected path. 2s10s mixes in two years of
        term premium, which is why the two have sometimes given different signals
        at exactly the moment it mattered.

        **What it cannot tell you.** Sample size. There have been about eight US
        recessions since these series begin. Any statement of the form "it
        inverts N months before" is fitted on fewer observations than you would
        accept in any other context. Japan's curve has spent most of thirty
        years shaped by the Bank of Japan's own purchases rather than by an
        expectation of growth, so the same reading does not transfer.
                """, label="How to read this tab")

    ui.range_picker(df.index, "fi_slope")

    for market in available:
        if market in ("US real", "MY bills"):
            continue  # a real-yield slope and a bill curve are different animals
        series_set = [(name, spread(market, long, short), note)
                      for name, long, short, note in SLOPES]
        series_set = [(n, s, note) for n, s, note in series_set if s is not None]
        if not series_set:
            continue

        fig = go.Figure()
        for i, (name, series, _) in enumerate(series_set):
            fig.add_trace(go.Scatter(
                x=series.index, y=series, name=name,
                line=dict(color=ui.SERIES_COLORS[i % len(ui.SERIES_COLORS)], width=2.0),
                hovertemplate=f"{name}: %{{y:.0f}} bp<extra></extra>"))
        fig.add_hline(y=0, line=dict(color=PALETTE["red"], width=1.3, dash="dash"),
                      annotation_text="inverted below here",
                      annotation_position="bottom right",
                      annotation_font=dict(color=PALETTE["red"], size=10),
                      annotation_bgcolor="rgba(22,26,35,0.82)", annotation_borderpad=3)
        fig.update_yaxes(title_text="Slope (bp)")
        if market == "US":
            ui.add_recession_shading(fig, usrec, df.index)
        st.plotly_chart(
            style_fig(fig, 430, f"{MARKETS[market][0]} — curve slopes"), **FULL_WIDTH)

        latest = {name: float(series.iloc[-1]) for name, series, _ in series_set}
        st.caption(" · ".join(
            f"**{name}** {latest[name]:+.0f} bp" for name, _, _ in series_set)
            + "  ·  " + "; ".join(f"*{name}*: {note}" for name, _, note in series_set))
        st.write("")


# --------------------------------------------------------------------------- #
# Tab 4 - across markets
# --------------------------------------------------------------------------- #

#: (label, foreign market, the investor's home short rate, FX column, FX label)
PAIRS = [
    ("Japan → US", "JP", f"JP {HEDGE_TENOR}", "USD/JPY",
     "Yen per dollar — up means a weaker yen"),
    ("Euro area → US", "EA", f"EA {HEDGE_TENOR}", "EUR/USD",
     "Dollars per euro — up means a stronger euro"),
]

with tab4:
    ui.explainer("""
        **Why this tab exists.** Everything before it looks at one market at a
        time. Capital does not. A Malaysian or Japanese investor choosing
        between a local bond and a Treasury is comparing two numbers neither of
        which is the headline yield, because the foreign one has to be paid for
        in someone else's currency.

        **The differential and the currency.** Rate differentials and spot FX
        move together often enough that the relationship gets treated as a law.
        It is not one — it broke down through most of 2022 and again in 2024 —
        but when a currency moves a long way *without* the differential moving,
        that gap is worth explaining rather than ignoring. Usually the answer is
        positioning, intervention, or a change in risk appetite.

        **Hedged yield: the number that actually decides the trade.** Hedging a
        foreign bond back to your own currency costs, to a first approximation,
        the difference in short rates:

        > hedged yield  ≈  foreign bond yield  −  (foreign short rate  −  your short rate)

        So a Japanese investor looking at a 10-year Treasury does not earn the
        Treasury yield. They earn it minus the cost of rolling a currency hedge,
        and when US short rates are far above Japanese ones that cost can eat
        the entire pickup — which is exactly what pushed Japanese institutions
        out of Treasuries in 2022-23 and into JGBs and European paper.
        **When the hedged line drops below the domestic line, the foreign bond
        stops making sense for a hedged buyer, and flows follow with a lag.**

        **What this approximation leaves out, and it matters.**

        * **The cross-currency basis.** Real forward points are not exactly the
          rate difference. In stress the basis widens — hedging dollars gets
          more expensive than covered-interest parity says it should — so the
          true hedged yield is *worse* than this chart in precisely the moments
          you would most want it to be right.
        * **The horizon.** This uses the **1-year** point on both legs for every
          pair, so the pairs are comparable with each other. A 3-month rolling
          hedge is the more common practice and gives a different, usually more
          volatile, number.
        * **Malaysia's short leg is the OPR**, an overnight policy rate, not a
          1-year rate. 3-month KLIBOR is the correct leg; it is not available
          from Bank Negara's Open API, so the OPR stands in. Read the Malaysian
          line as indicative of direction rather than as an executable level.
        * **No MGS.** The honest Malaysian comparison is hedged Treasuries
          against the **10-year MGS**, and there is no free machine-readable
          source for the MGS curve. Until there is, the Malaysian panel compares
          against cash, which is a weaker question.

        **What none of it can tell you.** Whether the hedge is worth doing at
        all. An unhedged position is a bond position plus a currency position,
        and the second one has historically been the larger source of variance
        for a ringgit-based holder of US assets.
                """, label="How to read this tab")

    # --- 10-year yields, everything on one axis ---------------------------- #
    ui.range_picker(df.index, "fi_cross")

    fig = go.Figure()
    for market in ("US", "EA", "JP", "MY"):
        series = get(df, f"{market} 10Y")
        if series is None:
            continue
        fig.add_trace(go.Scatter(
            x=series.index, y=series, name=f"{market} 10y",
            line=dict(color=MARKETS[market][1], width=2.1),
            hovertemplate=f"{market} 10y: %{{y:.2f}}%<extra></extra>"))
    if opr is not None:
        # Decisions only in the cache, so step it out to a line. `hv` keeps the
        # step where the decision was, rather than sloping between meetings.
        daily = opr.reindex(df.index.union(opr.index)).ffill().loc[df.index.min():]
        fig.add_trace(go.Scatter(
            x=daily.index, y=daily, name="MY policy rate (OPR)",
            line=dict(color=PALETTE["green"], width=1.8, shape="hv", dash="dot"),
            hovertemplate="OPR: %{y:.2f}%<extra></extra>"))
    fig.update_yaxes(title_text="Yield / policy rate (%)")
    ui.add_recession_shading(fig, usrec, df.index)
    st.plotly_chart(
        style_fig(fig, 450,
                  "10-Year Government Yields"
                  + ("" if get(df, "MY 10Y") is not None
                     else " — and Malaysia's Policy Rate")),
        **FULL_WIDTH)
    st.caption(
        ("The **MGS 10-year** is a bond yield and comparable with the others; "
         "the OPR beside it is a **policy rate** and is not, which is why it is "
         "drawn as a dotted step."
         if get(df, "MY 10Y") is not None else
         "Malaysia shows a policy rate, not a bond yield — the MGS curve is not "
         "in the cache yet. Run `python refresh.py --block Curves`, or "
         "`--mgs-check` if it fails.")
    )

    st.divider()

    # --- differential vs FX ------------------------------------------------ #
    if rates is None:
        st.info("Exchange rates are not in the cache yet. Run "
                "`python refresh.py --block Rates` to add them.")
    else:
        choice = st.segmented_control(
            "Pair", [label for label, *_ in PAIRS], default=PAIRS[0][0],
            key="fi_pair") if hasattr(st, "segmented_control") else st.radio(
            "Pair", [label for label, *_ in PAIRS], horizontal=True, key="fi_pair")
        choice = choice or PAIRS[0][0]
        label, foreign, short_column, fx_name, fx_note = next(
            p for p in PAIRS if p[0] == choice)

        us10 = get(df, "US 10Y")
        local10 = get(df, f"{foreign} 10Y")
        fx = get(rates, fx_name)

        if us10 is None or local10 is None or fx is None:
            ui.missing_note([n for n, s in (("US 10Y", us10),
                                            (f"{foreign} 10Y", local10),
                                            (fx_name, fx)) if s is None])
        else:
            differential = (us10 - local10).dropna() * 100.0
            fig2 = make_subplots(specs=[[{"secondary_y": True}]])
            fig2.add_trace(go.Scatter(
                x=differential.index, y=differential,
                name=f"US − {foreign} 10y (bp)",
                line=dict(color=PALETTE["blue"], width=2.1),
                hovertemplate="differential: %{y:.0f} bp<extra></extra>"),
                secondary_y=False)
            fig2.add_trace(go.Scatter(
                x=fx.index, y=fx, name=fx_name,
                line=dict(color=PALETTE["amber"], width=1.8),
                hovertemplate=f"{fx_name}: %{{y:.3f}}<extra></extra>"),
                secondary_y=True)
            fig2.update_yaxes(title_text="10-year differential (bp)", secondary_y=False)
            fig2.update_yaxes(title_text=fx_name, secondary_y=True, showgrid=False)
            st.plotly_chart(
                style_fig(fig2, 440, f"{label} — rate differential against the currency"),
                **FULL_WIDTH)
            st.caption(fx_note + ".  A differential that moves while the currency "
                       "does not — or the reverse — is the part worth explaining.")

    st.divider()

    # --- hedged yields ----------------------------------------------------- #
    us10 = get(df, "US 10Y")
    us_short = get(df, f"US {HEDGE_TENOR}")

    if us10 is None or us_short is None:
        ui.missing_note(["US 10Y", f"US {HEDGE_TENOR}"])
    else:
        panels = []
        for label, foreign, short_column, _, _ in PAIRS:
            home_short = get(df, short_column)
            domestic_long = get(df, f"{foreign} 10Y")
            if home_short is None or domestic_long is None:
                continue
            hedged = (us10 - (us_short - home_short)).dropna()
            panels.append((f"{foreign} investor", hedged, domestic_long,
                           f"{foreign} 10y", MARKETS[foreign][1]))

        # Malaysia's short leg: the 1-year MGS if the curve is cached, and the
        # OPR only as a stand-in when it is not. The comparator moves the same
        # way - against the 10-year MGS where there is one, against cash where
        # there is not, which is a much weaker question.
        my_short = get(df, f"MY {HEDGE_TENOR}")
        my_long = get(df, "MY 10Y")
        if my_short is None and opr is not None:
            my_short = opr.reindex(df.index.union(opr.index)).ffill().reindex(df.index)
        if my_long is None and opr is not None:
            my_long = opr.reindex(df.index.union(opr.index)).ffill().reindex(df.index)
        if my_short is not None and my_long is not None:
            hedged = (us10 - (us_short - my_short)).dropna()
            label = "MY 10y (MGS)" if get(df, "MY 10Y") is not None \
                else "MY policy rate"
            panels.append(("MY investor", hedged, my_long.dropna(), label,
                           PALETTE["green"]))

        if not panels:
            ui.missing_note(["a foreign short rate to hedge against"])
        for name, hedged, domestic, domestic_label, colour in panels:
            fig3 = go.Figure()
            fig3.add_trace(go.Scatter(
                x=hedged.index, y=hedged, name="US 10y, hedged",
                line=dict(color=PALETTE["blue"], width=2.2),
                hovertemplate="hedged UST 10y: %{y:.2f}%<extra></extra>"))
            fig3.add_trace(go.Scatter(
                x=domestic.index, y=domestic, name=domestic_label,
                line=dict(color=colour, width=2.0,
                          shape="hv" if "policy" in domestic_label else "linear"),
                hovertemplate=f"{domestic_label}: %{{y:.2f}}%<extra></extra>"))
            if us10 is not None:
                fig3.add_trace(go.Scatter(
                    x=us10.index, y=us10, name="US 10y, unhedged",
                    line=dict(color=PALETTE["slate"], width=1.2, dash="dot"),
                    hovertemplate="unhedged UST 10y: %{y:.2f}%<extra></extra>"))
            fig3.update_yaxes(title_text="Yield (%)")
            st.plotly_chart(
                style_fig(fig3, 400, f"{name} — hedged US 10y vs domestic"),
                **FULL_WIDTH)

            common = hedged.index.intersection(domestic.dropna().index)
            if len(common):
                gap = float(hedged.loc[common[-1]] - domestic.loc[common[-1]])
                verdict = ("**above** the domestic alternative — a hedged buyer is "
                           "paid to hold Treasuries"
                           if gap > 0 else
                           "**below** the domestic alternative — a hedged buyer "
                           "earns more at home")
                st.caption(
                    f"Latest: hedged US 10y is **{gap:+.2f} pp** {verdict}. "
                    f"Hedge cost assumed at the {HEDGE_TENOR} point on both legs, "
                    f"cross-currency basis ignored — see the panel above for what "
                    f"that leaves out."
                )
            st.write("")
