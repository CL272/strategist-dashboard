"""
Shared UI layer.
================
Theme, chart styling, cache loading and the sidebar controls every page uses.
Pages import from here so the dashboard stays visually consistent and a styling
change happens in one place.
"""

from __future__ import annotations

import datetime as _dt
import math as _math
from datetime import timedelta

import numpy as _np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st
from plotly.subplots import make_subplots

from data.fred import load_cache

# --------------------------------------------------------------------------- #
# Theme
# --------------------------------------------------------------------------- #

PALETTE = {
    "bg": "#0E1117",
    "panel": "#161A23",
    "grid": "#262B36",
    "text": "#E6E8EB",
    "muted": "#8B93A1",
    "blue": "#4C8DFF",
    "cyan": "#22D3EE",
    "amber": "#F5A524",
    "green": "#2DD4A7",
    "red": "#F4636E",
    "violet": "#A78BFA",
    "slate": "#94A3B8",
}

SERIES_COLORS = [
    PALETTE["blue"], PALETTE["amber"], PALETTE["cyan"], PALETTE["green"],
    PALETTE["violet"], PALETTE["red"], PALETTE["slate"],
]


def _full_width_kwargs() -> dict:
    """`use_container_width` was replaced by `width='stretch'` in Streamlit 1.49."""
    try:
        major, minor = (int(p) for p in st.__version__.split(".")[:2])
    except (ValueError, AttributeError):
        return {"use_container_width": True}
    return {"width": "stretch"} if (major, minor) >= (1, 49) else {"use_container_width": True}


FULL_WIDTH = _full_width_kwargs()


def inject_css() -> None:
    """Page chrome. Called once from app.py."""
    st.markdown(
        f"""
        <style>
            .stApp {{ background-color: {PALETTE['bg']}; }}
            section[data-testid="stSidebar"] {{
                background-color: {PALETTE['panel']};
                border-right: 1px solid {PALETTE['grid']};
            }}
            div[data-testid="stMetric"] {{
                background-color: {PALETTE['panel']};
                border: 1px solid {PALETTE['grid']};
                border-radius: 10px;
                padding: 14px 16px;
            }}
            div[data-testid="stMetricLabel"] p {{
                font-size: 0.78rem;
                letter-spacing: 0.04em;
                text-transform: uppercase;
                color: {PALETTE['muted']};
            }}
            div[data-testid="stMetricValue"] {{ font-size: 1.55rem; }}
            .stTabs [data-baseweb="tab-list"] {{ gap: 4px; }}
            .stTabs [data-baseweb="tab"] {{
                background-color: {PALETTE['panel']};
                border-radius: 8px 8px 0 0;
                padding: 8px 18px;
            }}
            .block-container {{ padding-top: 2.2rem; }}
            .caption-note {{ color: {PALETTE['muted']}; font-size: 0.82rem; margin-top: -0.4rem; }}

            /* Range picker, floated into the top-right of the chart below it.
               Streamlit widgets cannot live inside a Plotly figure, so the
               control is pulled down over the card's empty top-right corner -
               safe because chart titles and legends are both left-aligned. */
            /* The element container shrink-wraps its child, so aligning the
               button group alone does nothing - the container is what has to
               stretch and push its contents right. */
            div[class*="st-key-uirange-"] [data-testid="stElementContainer"] {{
                display: flex !important;
                justify-content: flex-end !important;
                width: 100% !important;
            }}
            div[class*="st-key-uirange-"] [data-testid="stButtonGroup"] {{
                width: auto !important;
            }}
            div[class*="st-key-uirange-"] [data-testid="stButtonGroup"] button {{
                padding: 2px 12px;
                font-size: 0.78rem;
            }}
            div[class*="st-key-uirange-tight-"] {{
                margin-bottom: -44px;
                padding-right: 16px;
                position: relative;
                z-index: 20;
                /* The floated row is full width and sits on top of the chart, so
                   without this it swallows every click and drag in the top 44px
                   of the plot - not just the mode-bar, but box-zoom too. Only
                   the buttons themselves should be clickable; everywhere else
                   the pointer has to fall through to the chart underneath. */
                pointer-events: none;
            }}
            div[class*="st-key-uirange-tight-"] [data-testid="stButtonGroup"] {{
                pointer-events: auto;
            }}
            /* Custom mode adds a date field, which must not sit over the plot. */
            div[class*="st-key-uirange-open-"] {{
                padding-right: 16px;
            }}

            /* Plotly draws its mode bar (zoom / pan / autoscale / reset / save)
               in the top-right corner of the plot - the same corner the range
               picker is floated into, so the two landed on top of each other and
               the icons could not be reached. Push the bar below the picker's
               row. `top` is what plotly sets inline-equivalent in its own
               stylesheet, so it has to be overridden rather than added to. */
            div[data-testid="stPlotlyChart"] .modebar {{
                top: 52px !important;
                right: 8px !important;
            }}
        </style>
        """,
        unsafe_allow_html=True,
    )


RANGE_PRESETS: dict[str, int | None] = {
    "1Y": 1, "3Y": 3, "5Y": 5, "10Y": 10, "Max": None, "Custom": -1,
}

#: Where the picker leaves the window it chose, for style_fig to pick up.
_RANGE_STATE = "_ui_active_range"


def _x_extent(fig: go.Figure) -> tuple[pd.Timestamp | None, pd.Timestamp | None]:
    """
    First and last x value across every trace, if the axis is dates.

    Only the endpoints are parsed - these series run to fifteen thousand points
    and converting all of them on every render would be felt.
    """
    lows, highs = [], []
    for trace in fig.data:
        x = getattr(trace, "x", None)
        try:
            n = len(x)
        except TypeError:
            continue
        if not n:
            continue
        # Type-check before parsing. pd.to_datetime(1) happily returns
        # 1970-01-01 00:00:00.000000001, so coercing alone would treat the
        # numeric axis of a horizontal bar chart as dates.
        if not isinstance(x[0], (str, _dt.date, _dt.datetime,
                                 pd.Timestamp, _np.datetime64)):
            continue
        first = pd.to_datetime(x[0], errors="coerce")
        last = pd.to_datetime(x[n - 1], errors="coerce")
        if pd.isna(first) or pd.isna(last):
            continue
        lows.append(min(first, last))
        highs.append(max(first, last))
    return (min(lows), max(highs)) if lows else (None, None)


def range_picker(index: pd.DatetimeIndex, key: str, default: str = "3Y",
                 label: str = "Range") -> tuple[pd.Timestamp, pd.Timestamp]:
    """
    Date-range control rendered directly above the chart(s) it governs.

    This has to live in Streamlit rather than in Plotly's own rangeselector,
    because Plotly does NOT rescale the y-axis when its buttons are clicked -
    zoom into a quiet year on a chart containing the 2020 spike and you get a
    flat line at the bottom of a y-axis still stretched to 6. Deciding the
    window server-side lets style_fig fit the y-axis to what is actually shown.

    The chosen window is also stashed in session state so every chart rendered
    after this call inherits it without the call site passing it along.
    """
    low, high = pd.Timestamp(index.min()), pd.Timestamp(index.max())
    presets = list(RANGE_PRESETS)

    # "tight" floats the row over the chart. Custom needs the date field in
    # normal flow, so it drops back out.
    previous = st.session_state.get(f"{key}_preset")
    mode = "open" if previous == "Custom" else "tight"
    try:
        box = st.container(key=f"uirange-{mode}-{key}")
    except TypeError:  # Streamlit too old for container keys
        box = st.container()

    with box:
        control = getattr(st, "segmented_control", None)
        if control is not None:
            choice = control(label, presets, default=default,
                             key=f"{key}_preset", label_visibility="collapsed")
        else:  # older Streamlit
            choice = st.radio(label, presets, index=presets.index(default),
                              horizontal=True, key=f"{key}_preset",
                              label_visibility="collapsed")
        choice = choice or default

        picked = None
        if choice == "Custom":
            picked = st.date_input(
                "From / to",
                value=(max(low, high - pd.DateOffset(years=1)).date(), high.date()),
                min_value=low.date(), max_value=high.date(), key=f"{key}_custom",
            )

    if choice == "Custom":
        if isinstance(picked, (tuple, list)) and len(picked) == 2:
            start, end = pd.Timestamp(picked[0]), pd.Timestamp(picked[1])
        else:  # mid-edit, only one date chosen so far
            start, end = low, high
    elif RANGE_PRESETS[choice] is None:
        start, end = low, high
    else:
        start, end = high - pd.DateOffset(years=RANGE_PRESETS[choice]), high

    start, end = max(start, low), min(end, high)
    if start >= end:
        start, end = low, high

    st.session_state[_RANGE_STATE] = (start, end)
    return start, end


def _series_bounds(fig: go.Figure, start, end) -> dict[str, list[float]]:
    """
    Min and max of each y-axis over the visible window only.

    Shapes count too: a threshold line at zero or a policy band at 8.5-9.0%
    should stay on screen even when the data has moved away from it.
    """
    bounds: dict[str, list[float]] = {}

    def note(axis: str, value) -> None:
        try:
            v = float(value)
        except (TypeError, ValueError):
            return
        if not _np.isfinite(v):
            return
        lo, hi = bounds.get(axis, [v, v])
        bounds[axis] = [min(lo, v), max(hi, v)]

    stacked = getattr(fig.layout, "barmode", None) == "stack"
    stacks: dict[str, list[pd.Series]] = {}

    for trace in fig.data:
        x, y = getattr(trace, "x", None), getattr(trace, "y", None)
        if x is None or y is None:
            continue
        axis = "yaxis2" if getattr(trace, "yaxis", None) == "y2" else "yaxis"
        try:
            xs = pd.to_datetime(pd.Series(list(x)), errors="coerce")
        except (TypeError, ValueError):
            continue
        ys = pd.to_numeric(pd.Series(list(y)), errors="coerce")
        if len(xs) != len(ys):
            continue
        visible = ys[(xs >= start) & (xs <= end)].dropna()
        if visible.empty:
            continue
        note(axis, visible.min())
        note(axis, visible.max())

        if stacked and trace.type == "bar":
            # A stacked bar reaches the sum of its segments, not the tallest
            # one, so the per-trace maximum above would crop the top off.
            stacks.setdefault(axis, []).append(
                pd.Series(ys.to_numpy(), index=xs).loc[start:end])

    for axis, parts in stacks.items():
        total = pd.concat(parts, axis=1).sum(axis=1, min_count=1).dropna()
        if not total.empty:
            note(axis, total.max())
            note(axis, min(0.0, float(total.min())))

    for shape in fig.layout.shapes or ():
        ref = getattr(shape, "yref", "y") or "y"
        if ref.startswith("y") and not ref.startswith("y domain"):
            axis = "yaxis2" if ref == "y2" else "yaxis"
            # Only pull the axis toward a shape we already have data for -
            # otherwise a band on an axis with nothing visible would define it.
            if axis in bounds:
                note(axis, getattr(shape, "y0", None))
                note(axis, getattr(shape, "y1", None))

    return bounds


def fit_y_axes(fig: go.Figure, start, end, pad: float = 0.06) -> None:
    """
    Fit each y-axis to the visible window, unless the page set it explicitly.

    On a LOG axis Plotly reads `range` as base-10 exponents, not as data
    values. Handing it [3, 63] for a P/E chart therefore asks for 10^3 to
    10^63, and the chart renders as an empty grid with the data flat on the
    floor - which is what happened to the credit page's log-scale checkbox and
    to the US multiples chart. So a log axis gets log10 bounds, and the padding
    is applied in log space where it means the same thing at every level.
    """
    for axis, (lo, hi) in _series_bounds(fig, start, end).items():
        existing = getattr(fig.layout, axis, None)
        if existing is not None and getattr(existing, "range", None) is not None:
            continue  # the page pinned this one on purpose (0-100, -1..1)

        flipped = getattr(existing, "autorange", None) == "reversed"

        if getattr(existing, "type", None) == "log":
            if hi <= 0:
                continue          # nothing a log axis can show
            # A non-positive floor cannot be plotted; fall back to six decades
            # below the top, which is far more than any series here spans.
            if lo <= 0:
                lo = hi / 1e6
            low, high = _np.log10(lo), _np.log10(hi)
            span = high - low
            margin = span * pad if span else 0.05
        else:
            low, high = lo, hi
            span = high - low
            margin = span * pad if span else (abs(high) * 0.1 or 1.0)

        # A page can ask for a flipped axis (autorange="reversed"); an explicit
        # range would silently undo that, so emit the bounds descending instead.
        bounds = ([high + margin, low - margin] if flipped
                  else [low - margin, high + margin])
        fig.update_layout(**{axis: dict(range=bounds, autorange=False)})


def style_fig(fig: go.Figure, height: int = 460, title: str | None = None,
              range_controls: bool | None = None,
              default_years: int = 3) -> go.Figure:
    """
    Apply shared dark styling to a Plotly figure.

    On a date axis the x-window comes from the nearest `range_picker` above it
    (or `default_years` back from the last observation if there isn't one), and
    every y-axis is then fitted to that window. Pass `range_controls=False` to
    leave both axes alone.
    """
    # The horizontal legend sits just above the plot area and grows UPWARDS as
    # it wraps, so a chart with enough series writes its second legend row
    # straight through the title. Plotly does not reserve room for this, so
    # estimate the number of rows from the legend text and buy the space.
    names = [str(t.name) for t in fig.data
             if getattr(t, "name", None) and getattr(t, "showlegend", None) is not False]
    # ~105 characters of legend fit on one row at the widths these charts use;
    # each entry also costs a swatch and a gap, hence the constant per name.
    legend_rows = max(1, _math.ceil(sum(len(n) + 7 for n in names) / 105)) if names else 1
    top_margin = (60 if title else 30) + 21 * (legend_rows - 1)

    # Only touch `title` when there is one. Passing title=None makes Plotly
    # render the literal string "undefined" above the chart.
    if title:
        fig.update_layout(title=dict(
            text=title, x=0.01, xanchor="left", font=dict(size=17),
            # Pinned to the top of the figure rather than floated above the
            # plot area, so the extra margin goes to the legend beneath it.
            yref="container", y=1.0, yanchor="top", pad=dict(t=12)))

    if range_controls is not False:
        low, high = _x_extent(fig)
        if low is not None:
            window = st.session_state.get(_RANGE_STATE)
            if window:
                start, end = window
                start, end = max(pd.Timestamp(start), low), min(pd.Timestamp(end), high)
                if start >= end:
                    start, end = low, high
            else:
                start = max(low, high - pd.DateOffset(years=default_years))
                end = high
            fig.update_xaxes(type="date", range=[start, end])
            fit_y_axes(fig, start, end)

    fig.update_layout(
        template="plotly_dark",
        height=height,
        margin=dict(l=60, r=60, t=top_margin, b=40),
        paper_bgcolor=PALETTE["panel"],
        plot_bgcolor=PALETTE["panel"],
        font=dict(color=PALETTE["text"], size=12),
        hovermode="x unified",
        legend=dict(orientation="h", yanchor="bottom", y=1.01,
                    xanchor="left", x=0, bgcolor="rgba(0,0,0,0)"),
        # The mode bar is dropped below the range picker by CSS in inject_css;
        # what is set here is its contents and colour. Lasso and box select do
        # nothing useful on a time series and only widen the bar, so they go -
        # the fewer buttons, the less of the chart the bar covers on hover.
        modebar=dict(
            remove=["lasso2d", "select2d", "toggleSpikelines",
                    "hoverCompareCartesian", "hoverClosestCartesian"],
            bgcolor="rgba(22,26,35,0.85)",
            color=PALETTE["muted"],
            activecolor=PALETTE["text"],
        ),
    )
    fig.update_xaxes(showgrid=True, gridcolor=PALETTE["grid"], zeroline=False)
    fig.update_yaxes(showgrid=True, gridcolor=PALETTE["grid"], zeroline=False)
    return fig


# --------------------------------------------------------------------------- #
# Data
# --------------------------------------------------------------------------- #

@st.cache_data(show_spinner="Loading cached data…")
def load_block(name: str) -> pd.DataFrame | None:
    """Read cache/<name>.parquet. Returns None if refresh.py hasn't been run."""
    try:
        frame = load_cache(name)
    except (FileNotFoundError, OSError):
        return None
    frame.index = pd.to_datetime(frame.index)
    return frame.sort_index()


def require_block(name: str) -> pd.DataFrame:
    """Load a block or stop the page with an actionable message."""
    frame = load_block(name)
    if frame is None or frame.empty:
        st.error(
            f"No cached **{name}** data found.\n\n"
            "Run this in the project folder, then reload:\n\n"
            "```\npython refresh.py\n```"
        )
        st.stop()
    return frame


def explainer(body: str, label: str = "What this page shows, and how to read it",
              expanded: bool = False) -> None:
    """
    The 'new here?' panel that sits under every page title.

    Collapsed by default so it never gets in the way of someone who already
    knows the page, but always in the same place so someone who doesn't can
    find it without hunting. Written for a reader who has never seen the
    dashboard: what the numbers are, which direction is bad, and what the page
    cannot tell them.
    """
    with st.expander(f"❔  {label}", expanded=expanded):
        st.markdown(body)


def get(df: pd.DataFrame, column: str) -> pd.Series | None:
    """A cleaned series, or None if the column is absent or entirely empty."""
    if column not in df.columns:
        return None
    series = df[column].dropna()
    return series if not series.empty else None


def missing_note(labels: list[str]) -> None:
    st.info(f"Not available in this dataset: {', '.join(labels)}")


# --------------------------------------------------------------------------- #
# Sidebar controls
# --------------------------------------------------------------------------- #

RANGES = {
    "Last 1 Year": 365,
    "Last 3 Years": 365 * 3,
    "Last 5 Years": 365 * 5,
    "Full History": None,
    "Custom…": -1,
}


def date_filter(df: pd.DataFrame, key: str = "range") -> tuple[pd.DataFrame, str]:
    """Sidebar date-range control. Returns the filtered frame and a label."""
    full_start, full_end = df.index.min(), df.index.max()
    choice = st.sidebar.radio("Date range", list(RANGES), index=1, key=key)

    if choice == "Custom…":
        picked = st.sidebar.date_input(
            "Select window",
            value=(max(full_start, full_end - timedelta(days=365)).date(), full_end.date()),
            min_value=full_start.date(), max_value=full_end.date(), key=f"{key}_custom",
        )
        if isinstance(picked, (tuple, list)) and len(picked) == 2:
            start, end = pd.Timestamp(picked[0]), pd.Timestamp(picked[1])
        else:
            start, end = full_start, full_end
    elif RANGES[choice] is None:
        start, end = full_start, full_end
    else:
        start, end = full_end - timedelta(days=RANGES[choice]), full_end

    start, end = max(start, full_start), min(end, full_end)
    out = df.loc[start:end]

    if out.empty:
        st.warning("No observations in the selected window. Widen the date range.")
        st.stop()

    st.sidebar.caption(
        f"**{len(out):,}** observations  \n"
        f"{out.index.min():%d %b %Y} → {out.index.max():%d %b %Y}"
    )
    return out, choice.replace("…", "")


def download_button(df: pd.DataFrame, stem: str) -> None:
    """Whole block as CSV. Date filtering happens on the charts, not here."""
    st.sidebar.download_button(
        "⬇️  Download CSV",
        data=df.reset_index().to_csv(index=False).encode("utf-8"),
        file_name=f"{stem}_{df.index.min():%Y%m%d}_{df.index.max():%Y%m%d}.csv",
        mime="text/csv",
        **FULL_WIDTH,
    )


# --------------------------------------------------------------------------- #
# Table shading
# --------------------------------------------------------------------------- #
#
# pandas' own Styler.background_gradient needs matplotlib, which is a large
# dependency to carry for what is a purely cosmetic wash behind four numeric
# columns - and one whose Windows wheels lag new Python releases. This does the
# same job in a dozen lines, using the dashboard's own palette instead of
# matplotlib's RdYlGn, so the tables match the charts.

def _hex_to_rgb(value: str) -> tuple[int, int, int]:
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]


def heat_style(value, vmin: float, vmax: float,
               positive: str | None = None,
               negative: str | None = None) -> str:
    """
    A `background-color` CSS rule for one cell, shading away from zero.

    `vmin`/`vmax` are the saturation points, not the data range: anything at or
    beyond them gets the full colour, so a single outlier cannot wash the rest
    of the column out to grey the way an auto-scaled gradient does. Blanks and
    non-numbers return no rule at all rather than a colour that means nothing.
    """
    try:
        number = float(value)
    except (TypeError, ValueError):
        return ""
    if number != number:                      # NaN
        return ""

    limit = vmax if number >= 0 else abs(vmin)
    if not limit:
        return ""
    weight = min(abs(number) / limit, 1.0)
    if weight < 0.02:
        return ""

    base = positive or PALETTE["green"]
    if number < 0:
        base = negative or PALETTE["red"]
    red, green, blue = _hex_to_rgb(base)

    # Alpha, not a blend: the cell keeps whatever background Streamlit's theme
    # gives it, so this reads correctly in both light and dark mode. Only the
    # background is set - Streamlit's table is drawn on a canvas and takes the
    # `color` property literally, so a `color: inherit` here does not inherit,
    # it renders the number invisible.
    alpha = 0.10 + 0.45 * weight
    return f"background-color: rgba({red},{green},{blue},{alpha:.3f})"


def heat_map(styler, subset, vmin: float, vmax: float):
    """
    `heat_style` applied across `subset` of a Styler. Returns the Styler.

    Styler.map was called applymap before pandas 2.1 and applymap now warns,
    so pick whichever this pandas actually has rather than pinning a version.
    """
    apply_elementwise = getattr(styler, "map", None) or styler.applymap
    return apply_elementwise(lambda v: heat_style(v, vmin, vmax), subset=subset)


# --------------------------------------------------------------------------- #
# Metrics
# --------------------------------------------------------------------------- #

def kpi(series: pd.Series | None, fmt: str, delta_fmt: str, lookback: int = 30):
    """(value, delta) strings for the latest print vs ~`lookback` days earlier."""
    if series is None or series.empty:
        return "—", None
    latest = series.iloc[-1]
    prior = series.loc[:series.index[-1] - timedelta(days=lookback)]
    if prior.empty:
        return fmt.format(latest), None
    return fmt.format(latest), delta_fmt.format(latest - prior.iloc[-1])


def percentile_of_last(series: pd.Series | None, years: int = 10) -> float | None:
    """
    Where the latest print sits in its own trailing distribution, 0-1.

    Backward-looking by construction - the window ends at the last observation,
    so this never uses information the reader wouldn't have had.
    """
    if series is None or len(series) < 60:
        return None
    window = series.loc[series.index[-1] - pd.DateOffset(years=years):]
    if len(window) < 60:
        return None
    return float((window <= window.iloc[-1]).mean())


# --------------------------------------------------------------------------- #
# Recession shading
# --------------------------------------------------------------------------- #

def recession_spans(usrec: pd.Series | None) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    """Convert the 0/1 NBER indicator into (start, end) pairs."""
    if usrec is None or usrec.empty:
        return []
    flag = usrec.fillna(0) > 0
    spans, start = [], None
    for date, in_recession in flag.items():
        if in_recession and start is None:
            start = date
        elif not in_recession and start is not None:
            spans.append((start, date))
            start = None
    if start is not None:
        spans.append((start, flag.index[-1]))
    return spans


def add_recession_shading(fig: go.Figure, usrec: pd.Series | None,
                          within: pd.DatetimeIndex | None = None) -> go.Figure:
    """
    Shade NBER recessions behind the data.

    `within` is the index actually being plotted. Spans are clipped to it and
    spans that fall entirely outside are dropped - otherwise a vrect for 2008
    silently stretches the x-axis of a chart showing the last three years.
    """
    lo = hi = None
    if within is not None and len(within):
        lo, hi = within.min(), within.max()

    for start, end in recession_spans(usrec):
        if lo is not None:
            if end < lo or start > hi:
                continue
            start, end = max(start, lo), min(end, hi)
        fig.add_vrect(x0=start, x1=end, fillcolor=PALETTE["slate"],
                      opacity=0.13, line_width=0, layer="below")
    return fig


def ordinal(n: float) -> str:
    """1 -> 1st, 2 -> 2nd, 13 -> 13th, 95 -> 95th."""
    i = int(round(n))
    if 10 <= i % 100 <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(i % 10, "th")
    return f"{i}{suffix}"


# --------------------------------------------------------------------------- #
# Lead / lag charts
# --------------------------------------------------------------------------- #

def lead_lag_chart(leader: pd.Series, follower: pd.Series,
                   leader_label: str, follower_label: str,
                   lead_months: int, usrec: pd.Series | None = None,
                   leader_axis: str = "", follower_axis: str = "",
                   height: int = 470, title: str | None = None,
                   default_years: int = 15) -> go.Figure:
    """
    The 'pushed forward N months' overlay.

    `leader` is shifted forward before plotting, so it extends past today - that
    overhang is the whole point of the chart and is deliberately not truncated.
    Recession shading spans the union of both series so the shifted tail keeps
    its context.
    """
    from data.leadlag import shift_forward

    shifted = shift_forward(leader, lead_months)
    fig = make_subplots(specs=[[{"secondary_y": True}]])

    suffix = f" (pushed forward {lead_months}m)" if lead_months else ""
    fig.add_trace(go.Scatter(
        x=shifted.index, y=shifted, name=f"{leader_label}{suffix}",
        line=dict(color=PALETTE["amber"], width=2.2),
        hovertemplate=f"{leader_label}: %{{y:,.2f}}<extra></extra>"), secondary_y=False)
    fig.add_trace(go.Scatter(
        x=follower.index, y=follower, name=follower_label,
        line=dict(color=PALETTE["text"], width=2.0),
        hovertemplate=f"{follower_label}: %{{y:,.2f}}<extra></extra>"), secondary_y=True)

    fig.update_yaxes(title_text=leader_axis or leader_label, secondary_y=False)
    fig.update_yaxes(title_text=follower_axis or follower_label,
                     secondary_y=True, showgrid=False)

    if usrec is not None:
        span = shifted.index.union(follower.index)
        add_recession_shading(fig, usrec, span)

    if lead_months:
        # Mark where the follower's data stops and the leader's implication starts.
        edge = follower.dropna().index.max()
        fig.add_vline(x=edge, line=dict(color=PALETTE["muted"], width=1.1, dash="dot"),
                      annotation_text="latest actual", annotation_position="top left",
                      annotation_font=dict(color=PALETTE["muted"], size=10),
                      annotation_bgcolor="rgba(22,26,35,0.82)", annotation_borderpad=2)

    return style_fig(fig, height, title, default_years=default_years)


def ccf_chart(ccf: pd.DataFrame, chosen_lead: int, height: int = 300) -> go.Figure:
    """
    Correlation at every lead. Bars, not a line - each lead is its own estimate.

    The chosen lead is highlighted so you can see whether the lead you picked is
    the one the data actually prefers, or one you talked yourself into.
    """
    colours = [PALETTE["blue"] if lead == chosen_lead else PALETTE["slate"]
               for lead in ccf["Lead (months)"]]
    fig = go.Figure(go.Bar(
        x=ccf["Lead (months)"], y=ccf["Correlation"], marker_color=colours,
        customdata=ccf["Observations"],
        hovertemplate="lead %{x}m<br>corr %{y:.2f}<br>%{customdata} obs<extra></extra>"))
    fig.add_hline(y=0, line=dict(color=PALETTE["muted"], width=1.1))
    fig.add_vline(x=0, line=dict(color=PALETTE["muted"], width=1.1, dash="dot"))
    fig.update_xaxes(title_text="Lead in months — positive means the first series leads")
    fig.update_yaxes(title_text="Correlation", range=[-1, 1])
    return style_fig(fig, height)
