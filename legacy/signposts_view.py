"""
Peak Signposts tab.
===================
Rendering only. Every rule, threshold and caveat lives in data/signposts.py.

Kept out of pages/ deliberately: Streamlit treats pages/ as navigation, and
this is a tab inside the Stress Panel rather than a page of its own.
"""

from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import ui
from data import signposts as sp
from ui import FULL_WIDTH, PALETTE, style_fig

TRIGGER_SCALE = [[0.0, "#1B2029"], [0.49, "#1B2029"],
                 [0.51, "#C4831F"], [1.0, "#C4831F"]]


def _cell_text(value: float | None) -> str:
    if value is None or pd.isna(value):
        return "–"
    return "✓" if value >= 0.5 else ""


def _grid_figure(cells: pd.DataFrame, peak_count: int) -> go.Figure:
    """The checklist itself: signposts down, dates across, grouped by section."""
    rows: list[tuple[str, pd.Series | None]] = []
    for group in sp.GROUPS:
        members = [s.label for s in sp.SIGNPOSTS
                   if s.group == group and s.label in cells.index]
        if not members:
            continue
        # A spacer row carrying the section name. All-NaN so it paints as
        # background, and its text is blanked below rather than dashed.
        rows.append((group.upper(), None))
        rows.extend((label, cells.loc[label]) for label in members)

    block = pd.DataFrame(
        [(r if r is not None else pd.Series(float("nan"), index=cells.columns))
         for _, r in rows],
        index=[label for label, _ in rows],
    )
    header_rows = {i for i, (_, r) in enumerate(rows) if r is None}

    text = [["" if i in header_rows else _cell_text(v) for v in row]
            for i, row in enumerate(block.to_numpy())]
    hover = [["" if i in header_rows else
              (f"{label}<br>{col}<br>"
               + ("triggered" if (pd.notna(v) and v >= 0.5)
                  else "not triggered" if pd.notna(v)
                  else "no data — excluded from the denominator"))
              for col, v in zip(block.columns, row)]
             for i, (label, row) in enumerate(zip(block.index, block.to_numpy()))]

    fig = go.Figure(go.Heatmap(
        z=block.to_numpy(), x=list(block.columns), y=list(block.index),
        text=text, texttemplate="%{text}",
        textfont=dict(size=18, color=PALETTE["text"]),
        colorscale=TRIGGER_SCALE, zmin=0, zmax=1, showscale=False,
        xgap=3, ygap=3,
        hovertext=hover, hovertemplate="%{hovertext}<extra></extra>",
    ))

    # Separate the historical peaks from the recent months.
    fig.add_vline(x=peak_count - 0.5,
                  line=dict(color=PALETTE["muted"], width=1.6, dash="dot"))
    fig.update_yaxes(autorange="reversed", title_text="")
    fig.update_xaxes(side="top", title_text="")

    # Section names, styled apart from the signpost labels beside them.
    for i, (label, row) in enumerate(rows):
        if row is None:
            fig.add_annotation(
                x=-0.5, y=i, xref="x", yref="y", text=f"<b>{label}</b>",
                showarrow=False, xanchor="right",
                font=dict(color=PALETTE["muted"], size=10.5))
    fig.update_yaxes(
        ticktext=["" if r is None else label for label, r in rows],
        tickvals=list(range(len(rows))))

    return style_fig(fig, 120 + 42 * len(block), None, range_controls=False)


def _share_figure(share: pd.DataFrame, peak_count: int) -> go.Figure:
    values = share["% triggered"].astype(float)
    colours = [PALETTE["slate"]] * peak_count + \
              [PALETTE["amber"]] * (len(values) - peak_count)
    fig = go.Figure(go.Bar(
        x=list(share.index), y=values, marker_color=colours,
        text=[f"{v:.0f}%" for v in values], textposition="outside",
        customdata=share[["Triggered", "Evaluated"]].to_numpy(),
        hovertemplate="%{x}<br>%{customdata[0]} of %{customdata[1]} "
                      "signposts triggered<extra></extra>",
    ))
    fig.add_vline(x=peak_count - 0.5,
                  line=dict(color=PALETTE["muted"], width=1.6, dash="dot"))
    fig.update_yaxes(title_text="% of evaluable signposts", range=[0, 118])
    fig.update_xaxes(title_text="")
    return style_fig(fig, 300, None, range_controls=False)


def render() -> None:
    frame = ui.load_block("signposts")

    if frame is None or frame.empty:
        st.info(
            "No signpost data cached yet. This block fetches its own long "
            "history — the peak columns need the 1990 and 2000 cycles — so it "
            "has to be built once:\n\n```\npython refresh.py --block Signposts"
            "\n```"
        )
        return

    cells, columns = sp.grid(frame)
    share = sp.triggered_share(cells)
    peak_count = len(sp.PEAKS)

    st.subheader("Peak Signposts")
    st.markdown(
        "<p class='caption-note'>A late-cycle checklist built only from data "
        "that can be verified for free. <b>Not a replication of any published "
        "bank exhibit</b> — the rows, the thresholds and the denominator are "
        "this dashboard's own, and every trigger rule is printed below.</p>",
        unsafe_allow_html=True,
    )
    st.write("")

    now_label = columns[-1]
    now = share.loc[now_label]
    prior_label = columns[-2] if len(columns) > peak_count + 1 else None
    peak_avg = share.iloc[:peak_count]["% triggered"].astype(float).mean()

    k1, k2, k3, k4 = st.columns(4)
    delta = None
    if prior_label is not None:
        move = float(now["% triggered"]) - float(share.loc[prior_label, "% triggered"])
        delta = f"{move:+.0f} pts vs {prior_label}"
    k1.metric(f"Triggered now ({now_label})", f"{float(now['% triggered']):.0f}%",
              delta, delta_color="inverse")
    k2.metric("Signposts triggered",
              f"{int(now['Triggered'])} of {int(now['Evaluated'])}",
              help="The denominator counts only rules whose inputs reach this "
                   "date. A rule with no data is never counted as untriggered.")
    k3.metric("Average at prior peaks", f"{peak_avg:.0f}%",
              help="Mean of the five peak columns. Each uses its own "
                   "denominator, so early peaks with less data are not "
                   "penalised.")
    gap = float(now["% triggered"]) - peak_avg
    k4.metric("Distance from that average", f"{gap:+.0f} pts",
              delta_color="off",
              help="Positive means more of the checklist is ticked now than "
                   "was typical at the five peaks in the sample.")

    st.write("")
    st.plotly_chart(_grid_figure(cells, peak_count), **FULL_WIDTH)
    st.plotly_chart(_share_figure(share, peak_count), **FULL_WIDTH)
    st.caption(
        "✓ triggered · blank not triggered · **–** the rule's inputs do not "
        "reach that date, so it is excluded from that column's denominator. "
        "The dotted line separates prior S&P 500 peaks from the last three "
        "months. Five peaks is a very small sample — this is a way of asking "
        "*which* conditions rhyme with prior late cycles, not a probability."
    )

    st.divider()

    # ---- history ----------------------------------------------------------
    series = sp.history(frame)
    if not series.empty:
        context = ui.load_block("context")
        usrec = ui.get(context, "NBER_Recession") if context is not None else None

        ui.range_picker(series.index, "sign_hist", default="Max")
        fig = go.Figure()
        fig.add_trace(go.Scatter(
            x=series.index, y=series, name="% triggered",
            line=dict(color=PALETTE["amber"], width=2.2),
            fill="tozeroy", fillcolor="rgba(245,165,36,0.12)",
            hovertemplate="%{x|%b %Y}: %{y:.0f}%<extra></extra>"))
        for _, date in sp.PEAKS:
            fig.add_vline(x=pd.Timestamp(date),
                          line=dict(color=PALETTE["red"], width=1.1, dash="dot"))
        fig.add_hline(y=peak_avg,
                      line=dict(color=PALETTE["muted"], width=1.2, dash="dash"),
                      annotation_text=f"average at prior peaks · {peak_avg:.0f}%",
                      annotation_position="top left",
                      annotation_font=dict(color=PALETTE["muted"], size=10),
                      annotation_bgcolor="rgba(22,26,35,0.82)",
                      annotation_borderpad=2)
        fig.update_yaxes(title_text="% of evaluable signposts", range=[0, 100])
        ui.add_recession_shading(fig, usrec, series.index)
        st.plotly_chart(
            style_fig(fig, 400, "Share of Signposts Triggered, Month by Month"),
            **FULL_WIDTH)
        st.caption(
            f"Dotted red lines mark the five peaks. The line starts in "
            f"**{series.index.min():%b %Y}** — before that fewer than four "
            "rules can be judged, and a share computed on a denominator of "
            "two says more about which series existed than about the cycle."
        )

    st.divider()

    # ---- the rules, in the open -------------------------------------------
    st.subheader("What each row actually tests")

    rows = []
    for spec in sp.SIGNPOSTS:
        value = sp._at(frame, spec.key, pd.Timestamp(columns[-1]))
        level_col = sp.ROW_LEVEL.get(spec.key)
        level = None
        if level_col and level_col in frame.columns:
            clean = frame[level_col].dropna()
            level = float(clean.iloc[-1]) if not clean.empty else None
        rows.append({
            "Group": spec.group,
            "Signpost": spec.label,
            "Now": "✓ triggered" if value == 1.0
                   else "—  no data" if value is None else "·  no",
            "Latest reading": "—" if level is None else f"{level:,.2f}",
            "Trigger rule": spec.rule,
        })

    # Source is deliberately not a column here - it would squeeze the trigger
    # rule, which is the thing worth reading. It is in the coverage table below.
    st.dataframe(pd.DataFrame(rows).set_index(["Group", "Signpost"]),
                 height=42 + 35 * len(rows), **FULL_WIDTH)

    notes = [(s.label, s.note) for s in sp.SIGNPOSTS if s.note]
    if notes:
        with st.expander("Notes on individual rows"):
            for label, note in notes:
                st.markdown(f"**{label}** — {note}")

    # ---- coverage ----------------------------------------------------------
    cover = sp.coverage(frame)
    short = cover[~cover["Reaches earliest peak"]]

    with st.expander(f"Data coverage — {len(short)} row(s) cannot reach every peak"):
        table = cover.copy()
        table["First evaluable"] = pd.to_datetime(
            table["First evaluable"]).dt.strftime("%b %Y").fillna("never")
        st.dataframe(table.set_index("Signpost"), **FULL_WIDTH)
        st.caption(
            "Every dash in the grid should be explained by this table. A short "
            "history here is a property of the source, not a failed refresh — "
            "the ICE BofA spread series in particular are served by FRED as a "
            "rolling three-year window, which is why the decompression row "
            "reaches none of the peak columns."
        )

    with st.expander("What this deliberately does not attempt"):
        st.markdown(
            """
            Published sell-side peak checklists lean on inputs that are
            licensed or proprietary. Rather than substitute lookalikes and
            report a "% triggered" number that would silently mean something
            different, those rows are simply absent:

            * **Sell-side strategist equity allocation** — a bank's own survey
              of its competitors. Not published anywhere free, and no proxy
              exists.
            * **Fund manager survey cash levels** — subscription only.
            * **Conference Board expectations for stock prices** — the
              Conference Board licenses its data and FRED does not carry it.
              University of Michigan sentiment is free but asks a different
              question, so it is not a substitute.
            * **IBES long-term growth expectations** — LSEG/Refinitiv licensed.
            * **M&A deal counts** — Dealogic/Refinitiv/Bloomberg. No free
              source complete enough to build a standard-deviation band on.
            * **A bank's own credit stress composite** — undisclosed weights.

            Two rows here are *related* to that last one without replicating
            it: the Baa−10y complacency row and the CCC−BB decompression row
            measure credit conditions from public data, on rules stated above.

            One more limitation worth stating plainly: **five peaks is not a
            sample you can do statistics on.** A row that ticked at four of
            five is a pattern worth a second look, not evidence. And every
            threshold here — 1σ, the bottom quartile, 100bp, 0.3pp — is a
            choice. Move them and the picture moves.
            """
        )
