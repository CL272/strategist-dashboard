"""
Calendar tab.
=============
Rendering only. The event list, the tiers and the fetching live in
data/econ_calendar.py.

One table, deliberately: Date, Region, Event, Actual, Consensus. Provenance -
which tier a date came from, what the underlying source is - moves to an
expander rather than crowding five columns into nine.
"""

from __future__ import annotations

import datetime as dt

import pandas as pd
import streamlit as st

import ui
from data import econ_calendar as ec
from ui import FULL_WIDTH

#: No flag emoji. Windows ships Segoe UI Emoji, which has no glyphs for
#: regional-indicator pairs, so a flag renders as the two letters it is built
#: from - "US" came out as a tiny "us" box instead of a flag. A short code in
#: front of the region name does the same job and renders everywhere.
REGION_CODE = {"US": "US", "Euro area": "EA", "Japan": "JP", "Malaysia": "MY"}


def region_label(region: str) -> str:
    code = REGION_CODE.get(region)
    return f"{code} · {region}" if code and code != region else region


def _when(row: pd.Series) -> str:
    """A day, or a window for the events with no published forward date."""
    end = row["Window end"]
    if pd.isna(end) or end == row["Date"]:
        return f"{row['Date']:%a %d %b}"
    if row["Date"].month == end.month:
        return f"{row['Date']:%d}–{end:%d %b}"
    return f"{row['Date']:%d %b} – {end:%d %b}"


def render() -> None:
    data = ui.load_block("calendar")

    st.subheader("Calendar")

    if data is None or data.empty:
        st.info(
            "No calendar cached yet.\n\n```\npython refresh.py --block Calendar"
            "\n```\n\nThe policy dates and the estimated windows need no network "
            "at all — only the US actuals and release dates call FRED."
        )
        return

    data = data.copy()
    for column in ("Date", "Window end", "Period"):
        if column in data.columns:
            data[column] = pd.to_datetime(data[column])

    today = pd.Timestamp(dt.date.today())

    st.markdown(
        f"<p class='caption-note'>Actuals fill in on each refresh as the data "
        f"publishes · policy dates verified against official schedules on "
        f"{data.attrs.get('verified_on', ec.VERIFIED_ON)}</p>",
        unsafe_allow_html=True,
    )
    ui.explainer("""
        **What this is.** What is coming, and what has just landed, for the four
        regions on the desk.

        **The columns.** *Actual* is the number as published. It is blank for a
        date in the future and fills in on the next refresh once the data is
        out. The month in brackets after an event is the **period the number
        covers** — CPI released in September is August's number.

        **There is no consensus column.** No free source of economist consensus
        exists — Bloomberg, Refinitiv and Econoday all license theirs and FRED
        carries none — and an always-empty column is worse than none at all.
        Fill in the `CONSENSUS` dictionary in `data/econ_calendar.py` and the
        column reappears; or ask for free model **nowcasts** (Cleveland Fed for
        CPI and PCE, Atlanta Fed GDPNow) in their own clearly-named column.

        **Policy decisions carry their outcome.** A past FOMC or ECB meeting
        shows the rate it set. Policy rates are *not* listed as daily rows —
        a rate is a level that exists every day, not an event.

        **Three kinds of date, and they are not equally certain.**

        - **A weekday and a date** (Wed 12 Aug) — a published date, either from
          FRED's release calendar or from a central bank's own schedule.
        - **A range** (18–26 Aug) — an *estimated window*. Neither Japan's
          Statistics Bureau nor Malaysia's DOSM publishes a forward calendar
          that can be read automatically, so these come from the usual
          publication pattern. Fine for planning a week; confirm the day before
          you commit to a deadline.

        The **Provenance** panel at the bottom shows which tier every single row
        belongs to and where it came from.
                """)
    st.write("")


    # ---- next decision per region ------------------------------------------
    policy = data[(data["Kind"] == "Policy") & (data["Date"] >= today)]
    cols = st.columns(len(ec.REGIONS))
    for col, region in zip(cols, ec.REGIONS):
        upcoming = policy[policy["Region"] == region].sort_values("Date")
        label = region_label(region)
        if upcoming.empty:
            col.metric(label, "—", help="No further dates on file — see the "
                                        "schedule coverage note below.")
            continue
        row = upcoming.iloc[0]
        days = int((row["Date"] - today).days)
        col.metric(label, f"{row['Date']:%d %b}",
                   f"in {days} day{'s' if days != 1 else ''}", delta_color="off",
                   help=f"{row['Event']}"
                        + (f" — {row['Detail']}" if row["Detail"] else ""))

    st.write("")

    # ---- controls, inline: the sidebar belongs to the stress panel ---------
    c1, c2, c3 = st.columns([2, 1, 1])
    regions = c1.multiselect("Regions", list(ec.REGIONS),
                             default=list(ec.REGIONS), key="cal_regions")
    back = c2.number_input("Days back", 0, 180, 30, step=15, key="cal_back",
                           help="How far into the past to list. Past rows are "
                                "the ones carrying actuals.")
    ahead = c3.number_input("Days ahead", 7, 180, 45, step=7, key="cal_ahead")

    show_estimated = st.checkbox(
        "Include estimated dates (Japan and Malaysia statistical releases)",
        value=True, key="cal_estimated",
        help="Neither DOSM nor Japan's Statistics Bureau publishes a forward "
             "calendar that can be read automatically, so these are windows "
             "derived from the usual publication pattern.",
    )

    low, high = today - pd.Timedelta(days=int(back)), today + pd.Timedelta(days=int(ahead))
    ends = data["Window end"].fillna(data["Date"])
    view = data[(ends >= low) & (data["Date"] <= high)
                & data["Region"].isin(regions)]
    if not show_estimated:
        view = view[view["Confidence"] != ec.ESTIMATED]

    if view.empty:
        st.info("Nothing in this window with the current filters.")
        return

    view = view.sort_values(["Date", "Region", "Event"]).copy()
    view["Date "] = view.apply(_when, axis=1)
    view["Region "] = view["Region"].map(region_label)

    # Reference period disambiguates an actual: the CPI released in September
    # is August's number, and without that the value is uninterpretable.
    view["Event "] = [
        f"{name}  ({period:%b %Y})" if pd.notna(period) else name
        for name, period in zip(view["Event"], view["Period"])
    ]

    # Consensus renders only when CONSENSUS has been filled in by hand. An
    # always-empty column is worse than no column: it takes width and implies
    # the number is coming.
    wanted = ["Date ", "Region ", "Event ", "Actual"]
    names = ["Date", "Region", "Event", "Actual"]
    if ec.CONSENSUS:
        wanted.append("Consensus")
        names.append("Consensus")
    table = view[wanted]
    table.columns = names

    released = int((view["Actual"] != "—").sum())
    st.dataframe(table.set_index("Date"),
                 height=min(760, 42 + 35 * len(table)), **FULL_WIDTH)
    st.caption(
        f"{len(table)} entries · {released} already released. A date shown as a "
        "range is an estimated window, not a published day."
    )

    # A column of dashes should never go unexplained. Some of these events have
    # no free series behind them at all, which is a different thing from "not
    # published yet".
    shown = {(r, e) for r, e in zip(view["Region"], view["Event"])}
    dateless = sorted({e for r, e in ec.date_only_events() if (r, e) in shown})
    if dateless:
        st.info(
            f"**{len(dateless)} event(s) in this view are date-only** — the "
            "calendar knows when they land but cannot show the number, because "
            "FRED has no free series for them: "
            + ", ".join(f"*{name}*" for name in dateless) + ".\n\n"
            "FRED's Japan and Malaysia coverage is thin and most of what exists "
            "comes through OECD collections that have been discontinued. Real "
            "actuals for these would need their own sources — **BNM's open API** "
            "and **OpenDOSM** for Malaysia (both free, no key for BNM), and "
            "Japan's **e-Stat API** (free, needs a registration). Say the word "
            "and I will wire them up."
        )

    warnings = ec.coverage_warnings()
    if warnings:
        st.warning("**Schedules running out**\n\n"
                   + "\n\n".join(f"- {w}" for w in warnings))

    with st.expander("Provenance — where each date and each number comes from"):
        detail = view[["Date ", "Region", "Event", "Confidence", "Kind",
                       "Detail", "Source"]]
        detail.columns = ["Date", "Region", "Event", "Confidence", "Kind",
                          "Detail", "Source"]
        st.dataframe(detail.set_index("Date"), height=380, **FULL_WIDTH)

        coverage = pd.DataFrame([
            {"Region": region, "Policy dates on file through": last,
             "Source": source}
            for region, (last, source) in ec.COVERAGE.items()
        ])
        st.dataframe(coverage.set_index("Region"), **FULL_WIDTH)

        st.markdown(
            f"""
            **Live** — the date came from FRED's release calendar. For each
            event the release it belongs to is looked up once, then that
            release's forward dates are fetched. Agency dates, refreshed every
            run.

            **Confirmed** — FOMC, ECB Governing Council, BoJ MPM and BNM MPC
            decision days, transcribed from each bank's published schedule and
            verified on **{ec.VERIFIED_ON}**.

            **Estimated** — Japanese and Malaysian statistical releases, shown
            as windows because the exact day is not published in a form that can
            be read automatically. Confirm the day on DOSM's advance release
            calendar or the Statistics Bureau's schedule before committing to a
            deadline; a public holiday moves any of them.

            **Actuals** come from the FRED series behind each event, transformed
            into the form the number is quoted in — CPI year-on-year, payrolls
            as a monthly change. FRED dates an observation by the period it
            covers rather than the day it was published, so the value shown
            against a release date is the last observation before it. Run
            `python refresh.py --audit-events` to check every ticker resolves;
            FRED's Japan and Malaysia coverage in particular leans on OECD
            collections, several of which have been discontinued.
            """
        )
