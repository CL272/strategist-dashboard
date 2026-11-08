"""
Global Equity — regional performance and trend, in local currency
=================================================================
Every index stays in its own currency. Reads cache/equity.parquet - run
`python refresh.py --block Equity` to update it.
"""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import ui
from data.equity import (BENCHMARK_DEFAULT, FRED_DAILY, QUOTE_BASIS,
                         QUOTE_NOTES, SOURCE_TAGS, TR_UNAVAILABLE,
                         benchmarks_present, oecd_column, oecd_regions,
                         rebase, stale_columns)
from ui import FULL_WIDTH, PALETTE, get, style_fig

HORIZONS = {"1m": 30, "3m": 91, "6m": 182, "12m": 365, "3y": 365 * 3}

#: Regions shown as cards above the tabs.
CARD_REGIONS = ("United States", "Europe", "Japan", "Asia ex Japan", "Malaysia")

data = ui.load_block("equity")
if data is None or data.empty:
    st.error(
        "No cached **equity** data found.\n\n"
        "Run this in the project folder, then reload:\n\n"
        "```\npython refresh.py --block Equity\n```\n\n"
        "If that fails, `python refresh.py --equity-check` prints what each "
        "source returned."
    )
    st.stop()

context = ui.load_block("context")
usrec = get(context, "NBER_Recession") if context is not None else None

df = data
regions = oecd_regions(df)
bench = benchmarks_present(df)
bench_tr = benchmarks_present(df, total_return=True)
daily_names = [n for n in list(FRED_DAILY) + list(QUOTE_BASIS)
               if n in df.columns]
latest_day = df.dropna(how="all").index.max()
stale = stale_columns(df)

st.sidebar.divider()
ui.download_button(df, "equity")


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

def change_over(series: pd.Series | None, days: int) -> float | None:
    """Percentage change over roughly `days`, using the last print at or before."""
    if series is None:
        return None
    clean = series.dropna()
    if clean.empty:
        return None
    end_stamp = clean.index[-1]
    window = clean.loc[:end_stamp - pd.Timedelta(days=days)]
    if window.empty or not window.iloc[-1]:
        return None
    return float(clean.iloc[-1] / window.iloc[-1] - 1.0) * 100.0


def ytd(series: pd.Series | None) -> float | None:
    if series is None:
        return None
    clean = series.dropna()
    if clean.empty:
        return None
    start = clean.loc[:pd.Timestamp(clean.index[-1].year, 1, 1)]
    if start.empty or not start.iloc[-1]:
        return None
    return float(clean.iloc[-1] / start.iloc[-1] - 1.0) * 100.0


def drawdown(series: pd.Series) -> pd.Series:
    clean = series.dropna()
    return (clean / clean.cummax() - 1.0) * 100.0


# --------------------------------------------------------------------------- #
# Header
# --------------------------------------------------------------------------- #

st.title("Global Equity")
st.markdown(
    f"<p class='caption-note'>Data through <b>{latest_day:%d %B %Y}</b> · "
    f"{len(bench)} regional benchmarks, daily · "
    f"{len(regions)} countries of monthly OECD history · sources: Yahoo "
    "via yfinance, FRED, OECD via FRED</p>",
    unsafe_allow_html=True,
)

ui.explainer("""
    **What this page is, and what it is not.** It shows regional equity
    **price and trend**, in local currency. It does **not** show valuation for
    most regions, and that is a data limitation rather than an oversight — see
    the note at the bottom of this panel.

    **One index per region, daily.** The S&P 500 for the US, MSCI Europe,
    TOPIX for Japan, MSCI AC Asia ex Japan, plus the FTSE 100, Hang Seng,
    KOSPI, Nifty 50 and FBM KLCI. Every return on this page is computed from
    daily closes, so a year-to-date number here is the market's year-to-date
    number.

    **This was wrong until recently and is worth knowing about.** The headline
    figures used to come off the OECD monthly spine, which lags one to three
    months *and* is a monthly **average** rather than a month-end close. In a
    trending year that combination pulls a year-to-date figure a long way
    toward zero — it showed the US up 3.8% in a year the S&P 500 was up 11.6%.
    The spine is still here, under **Long history** below, for the one thing it
    is uniquely good at: eight countries on one construction back to the 1950s.
    It is no longer allowed near a current return.

    **Mind the source markings.**

    * **⚠ Yahoo** — Yahoo Finance, read through `yfinance`. A free consumer
      service, not an exchange feed or a statistical agency: no SLA, symbol
      coverage changes without notice, and its terms describe personal use.
      Nothing sourced this way should be redistributed. It is here because
      there is no free official source for most of these — FBM KLCI history
      above all, which is FTSE Russell licensed and sold by Bursa.
    * **⚠ ETF proxy** — MSCI licenses its index levels and publishes no free
      history, and Yahoo does not carry TOPIX, so those three are represented
      by a **fund price**, not an index level. They carry a fee drag and a
      little tracking noise. Fine for "which region is leading"; not a number
      for a factsheet.

    **Every symbol's currency is checked, not assumed.** These funds list on
    six or seven exchanges in four currencies, and the share class currency is
    not the trading currency — the Amundi TOPIX fund's London line is in
    dollars, the UBS Asia fund's Xetra line is in euro. A yen index read off a
    dollar listing is the index multiplied by USD/JPY, which over three years
    is a bigger move than the index. So the fetcher asks Yahoo what currency
    each symbol actually is and **refuses** anything that does not match.

    **Price return and total return are separate views, on purpose.** The
    **Price return** view is nine regions, dividends excluded. The **Total
    return** view is six, taken from the **adjusted close** of the same
    instrument — dividends reinvested and back-adjusted. Using one instrument
    for both is what makes them comparable; a bare index pays no dividends, so
    where a region needs a total return the instrument is a dividend-paying
    fund in that market's own currency. The US is the exception: Yahoo carries
    the real S&P 500 total-return index.

    The two never share a chart. Europe yields roughly 3.2% a year against the
    US at roughly 1.2%, so a total-return European line beside a price-return
    S&P 500 would hand Europe about two points a year of outperformance that is
    purely dividend treatment, with nothing on the chart to say so.

    **Two currency notes.** Hang Seng is in **Hong Kong dollars** and is
    Hong Kong-listed China — a different investor base from the A-share market,
    which the OECD China series tracks. MSCI AC Asia ex Japan is in **US
    dollars** because the index itself is; there is no single local currency
    for a thirteen-market region. Everything else is in its own.

    **On valuation.** P/E and P/B with real history exist free only for the US
    (Shiller, back to 1871) and Japan (JPX, back to 2005). For Europe, Asia and
    Malaysia only a current snapshot is published free, with no back-history —
    and a valuation number with no distribution behind it cannot tell you
    whether something is cheap. Those pieces live on the Valuation page;
    nothing here pretends to be valuation.
""")

if stale:
    st.warning(
        "**Stale series** — these have not printed in longer than their "
        "frequency allows, which looks identical to a flat line on a chart:  \n"
        + "  \n".join(f"· `{c}` — last print {d:%d %b %Y}" for c, d in stale.items())
    )

# --------------------------------------------------------------------------- #
# KPIs
# --------------------------------------------------------------------------- #

def mark(column: str) -> str:
    """The source marking a column carries, if any."""
    tag = SOURCE_TAGS.get(column)
    return " ⚠" if tag in ("Yahoo", "ETF proxy") else ""


def as_of(series: pd.Series | None):
    if series is None:
        return None
    clean = series.dropna()
    return None if clean.empty else clean.index[-1]


cards = [b for b in bench if b.region in CARD_REGIONS]
if cards:
    boxes = st.columns(max(len(cards), 2))
    for box, item in zip(boxes, cards):
        series = get(df, item.column)
        value, twelve = ytd(series), change_over(series, 365)
        stamp = as_of(series)
        # The index name goes underneath rather than into the metric label:
        # five cards across, a label long enough to name the index truncates
        # to "United States · S&P 5…", which is worse than no label at all.
        box.metric(f"{item.region} YTD",
                   "—" if value is None else f"{value:+.1f}%",
                   None if twelve is None else f"{twelve:+.1f}% 12m",
                   delta_color="off")
        box.caption(
            f"{item.card}{mark(item.column)} · {item.ccy}"
            + (f" · {stamp:%d %b}" if stamp is not None else ""))

    # Every card is as-of its own last close, and they are not all the same
    # day. Say the range rather than picking one and implying the others.
    dates = [d for d in (as_of(get(df, b.column)) for b in cards) if d is not None]
    if dates:
        span = (f"{min(dates):%d %b %Y}" if min(dates) == max(dates)
                else f"{min(dates):%d %b} – {max(dates):%d %b %Y}")
        st.caption(
            f"**Year to date**, from each index's last close of last year to "
            f"its latest close ({span}), in local currency, price only. "
            f"The 12-month figure below each is a trailing 365 days, not a "
            f"calendar year."
        )

st.write("")

tab1, tab2 = st.tabs(["🌍 Regional Performance", "📊 Daily Detail"])


# --------------------------------------------------------------------------- #
# Tab 1 - regional performance, local currency
# --------------------------------------------------------------------------- #

with tab1:
    ui.explainer("""
        **What this shows.** Every region rebased to 100 at the start of the
        window you pick, in **its own currency**. So it answers "which market
        went up more", not "which made me more money" — that is the next tab.

        **How to read it.** Three questions, in order:

        1. **Is the dispersion wide or narrow?** When everything moves together
           the driver is global — rates, the dollar, a growth scare. When
           dispersion widens, something country-specific is doing the work, and
           that is when regional allocation earns its fee.
        2. **Who is leading, and have they always been?** A market that has led
           for a decade is not necessarily a better market; it may just be a
           more expensive one. Lengthen the window before concluding anything —
           the US-versus-rest picture inverts depending on whether you start in
           2010 or 1990.
        3. **Where is each one against its own past?** The table below gives
           returns over fixed horizons, which is a fairer comparison than
           eyeballing lines that start from an arbitrary date.

        **What it cannot tell you.** These are **price** indices, not total
        return — no dividends. That understates markets with high payout ratios
        (the UK, and Malaysia) against markets that retain and buy back (the US)
        by roughly two to four percentage points a year. Over ten years that
        compounding difference is large enough to reverse a ranking, so do not
        use this to conclude one market beat another over a long horizon.
                """, label="How to read this tab")

    if not bench and not bench_tr and not regions:
        ui.missing_note(["the regional benchmarks"])
    else:
        # Three views, and the separation is the point. Price return and total
        # return must not share a rebased chart, and the monthly spine cannot
        # answer a question about this year.
        PRICE = f"Price return — daily ({len(bench)})"
        TOTAL = f"Total return — daily ({len(bench_tr)})"
        LONG = f"Long history — OECD, monthly ({len(regions)})"
        views = ([PRICE] if bench else []) + ([TOTAL] if bench_tr else []) \
            + ([LONG] if regions else [])
        view = st.segmented_control("View", views, default=views[0],
                                    key="eq_view") or views[0]
        mode = {PRICE: "price", TOTAL: "total"}.get(view, "long")

        if mode in ("price", "total"):
            table_of = bench_tr if mode == "total" else bench
            options = [b.region for b in table_of]
            by_region = {b.region: b for b in table_of}
            # With only four total-return regions there is nothing to thin out.
            default = (options if len(options) <= 5
                       else [r for r in BENCHMARK_DEFAULT if r in options]
                       or options[:4])
            column_of = lambda r: by_region[r].column          # noqa: E731
            ccy_of = lambda r: by_region[r].ccy                # noqa: E731
        else:
            options = regions
            default = [r for r in ("United States", "Japan", "United Kingdom",
                                   "China") if r in options] or options[:4]
            column_of = oecd_column                            # noqa: E731
            ccy_of = lambda r: "2015 = 100"                    # noqa: E731

        daily_view = mode in ("price", "total")

        if mode == "total":
            st.info(
                "**Total return** — each line is the **adjusted close** of the "
                "same instrument as its price line, with dividends reinvested "
                "and back-adjusted. Every line here is on that basis; nothing "
                "on this view is a price index, so the comparison is like for "
                "like.  \n"
                + "**Not available for "
                + ", ".join(f"{r}" for r in TR_UNAVAILABLE)
                + "** — expand the note below the table for why."
            )

        chosen = st.multiselect("Regions", options, default=default,
                                key=f"eq_regions_{mode}")
        ui.range_picker(df.index, "eq_perf")
        window = st.session_state.get("_ui_active_range")
        start = window[0] if window else df.index.min()

        fig = go.Figure()
        for i, region in enumerate(chosen):
            series = get(df, column_of(region))
            if series is None:
                continue
            line = rebase(series, start)
            label = (f"{region} ({column_of(region)})" if daily_view else region)
            fig.add_trace(go.Scatter(
                x=line.index, y=line, name=label,
                line=dict(color=ui.SERIES_COLORS[i % len(ui.SERIES_COLORS)], width=2.0),
                hovertemplate=f"{label}: %{{y:.1f}}<extra></extra>"))
        fig.add_hline(y=100, line=dict(color=PALETTE["muted"], width=1.1, dash="dash"))
        fig.update_yaxes(title_text="Rebased to 100")
        ui.add_recession_shading(fig, usrec, df.index)
        subtitle = {"price": "  ·  price return",
                    "total": "  ·  total return",
                    "long": "  ·  OECD monthly"}[mode]
        st.plotly_chart(
            style_fig(fig, 470,
                      "Regional Equity — local currency, rebased" + subtitle),
            **FULL_WIDTH)

        rows = []
        for region in options:
            series = get(df, column_of(region))
            stamp = as_of(series)
            row = {"Region": region,
                   "Index": column_of(region) + mark(column_of(region)),
                   "Ccy": ccy_of(region),
                   "YTD": ytd(series)}
            row.update({label: change_over(series, days)
                        for label, days in HORIZONS.items()})
            row["As of"] = "—" if stamp is None else f"{stamp:%d %b %y}"
            rows.append(row)
        table = pd.DataFrame(rows).set_index("Region")
        numeric = [c for c in table.columns if c not in ("Index", "Ccy", "As of")]
        st.dataframe(
            ui.heat_map(
                table.style.format("{:+.1f}%", na_rep="—", subset=numeric),
                numeric, vmin=-30, vmax=30),
            **FULL_WIDTH)

        if daily_view:
            st.caption(
                ("**Total return** — dividends reinvested — " if mode == "total"
                 else "**Price return** — dividends excluded — ")
                + "in each index's own quote currency, from daily closes. "
                "The **As of** column is each index's own last close — they "
                "are not all the same day, and a stale one shows up here "
                "rather than hiding inside a return. Not comparable as a "
                "realised return to anyone paid in a different currency."
            )
            notes = {b.column: QUOTE_NOTES[b.column]
                     for b in (bench_tr if mode == "total" else bench)
                     if b.column in QUOTE_NOTES}
            if notes:
                with st.expander("What each benchmark actually is"):
                    for column, note in notes.items():
                        st.markdown(f"**{column}{mark(column)}** — {note}")
                    if mode == "total":
                        st.markdown("---")
                        st.markdown(
                            "**What is missing, and why.** A total-return line "
                            "needs a dividend-paying fund on the index, listed "
                            "in that market's own currency, that Yahoo carries. "
                            "For these it is not wired up yet:")
                        for region, why in TR_UNAVAILABLE.items():
                            st.markdown(f"· **{region}** — {why}")
                        st.markdown(
                            "Substituting a dollar-quoted fund would produce a "
                            "line that is the market blended with the dollar — "
                            "a different question from the one this page asks — "
                            "so these stay empty until the right listing is "
                            "found rather than being filled with the wrong one.")
        else:
            st.caption(
                "OECD share-price indices, **2015 = 100**, monthly. These are "
                "a monthly **average** and lag one to three months, so the "
                "YTD and shorter columns above are **not** current market "
                "returns — read them as history, and use the Benchmarks view "
                "for anything recent."
            )


# --------------------------------------------------------------------------- #
# Tab 2 - daily detail
# --------------------------------------------------------------------------- #

with tab2:
    ui.explainer("""
        **What this shows.** The daily indices, at daily frequency, with two
        derived views: **drawdown from the running peak**, and **distance from
        the 200-day average**.

        **Drawdown is the honest risk measure.** Volatility describes the ride;
        drawdown describes the hole. It is also what a client or an IC actually
        remembers. Read the *depth* for how bad it got and the *width* for how
        long it took to recover — the second is usually the more painful and is
        almost never quoted.

        **Distance from the 200-day average** is a trend filter, not a signal.
        Above it, drawdowns have historically been shallower and briefer; below
        it, deeper and longer. That is a statement about the distribution of
        outcomes, not a prediction about the next one, and it whipsaws badly in
        range-bound markets. Treat a cross as a change in the odds, not a trade.

        **Mind the source.** Series marked **⚠ mirror** come from a public quote
        mirror, not an official exchange or statistical agency. They are here
        because no free official source publishes them — the FBM KLCI most of
        all. They can change or disappear without notice, and nothing sourced
        this way should be redistributed.

        **What it cannot tell you.** Price indices again — no dividends. And
        this is the drawdown *in local currency*; an unhedged foreign holder
        lived through a different one, because the currency moved too.
                """, label="How to read this tab")

    if not daily_names:
        ui.missing_note(["daily index levels"])
    else:
        def label_for(name: str) -> str:
            tag = SOURCE_TAGS.get(name)
            return f"{name}  ⚠ {tag}" if tag in ("Yahoo", "ETF proxy") else name

        name = st.selectbox("Index", daily_names, key="eq_daily",
                            format_func=label_for)
        series = get(df, name)
        if series is None:
            ui.missing_note([name])
        else:
            ui.range_picker(df.index, "eq_daily_range")
            clean = series.dropna()
            ma200 = clean.rolling(200, min_periods=100).mean()

            fig = go.Figure()
            fig.add_trace(go.Scatter(
                x=clean.index, y=clean, name=name,
                line=dict(color=PALETTE["blue"], width=1.9),
                hovertemplate="%{y:,.1f}<extra></extra>"))
            fig.add_trace(go.Scatter(
                x=ma200.index, y=ma200, name="200-day average",
                line=dict(color=PALETTE["amber"], width=1.4, dash="dot"),
                hovertemplate="200dma: %{y:,.1f}<extra></extra>"))
            fig.update_yaxes(title_text="Index level")
            ui.add_recession_shading(fig, usrec, clean.index)
            st.plotly_chart(
                style_fig(fig, 430, f"{label_for(name)} — level and trend"),
                **FULL_WIDTH)

            down = drawdown(clean)
            fig2 = go.Figure(go.Scatter(
                x=down.index, y=down, name="Drawdown",
                line=dict(color=PALETTE["red"], width=1.6),
                fill="tozeroy", fillcolor="rgba(244,99,110,0.18)",
                hovertemplate="%{y:.1f}% from peak<extra></extra>"))
            fig2.update_yaxes(title_text="Drawdown (%)")
            st.plotly_chart(
                style_fig(fig2, 320, f"{name} — drawdown"), **FULL_WIDTH)

            latest = float(clean.iloc[-1])
            trend = (latest / float(ma200.dropna().iloc[-1]) - 1) * 100 \
                if not ma200.dropna().empty else None
            worst = float(down.min()) if not down.empty else None
            st.caption(
                f"Latest **{latest:,.1f}** · "
                + (f"**{trend:+.1f}%** vs its 200-day average · " if trend is not None else "")
                + f"currently **{float(down.iloc[-1]):.1f}%** off its peak"
                + (f" · worst drawdown in the record **{worst:.1f}%**"
                   if worst is not None else "")
            )
