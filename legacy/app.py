"""
Macro Stress Monitor
====================
Navigation shell. Each dashboard lives in pages/ and reads only from the local
parquet cache - run `python refresh.py` to update the data.

    streamlit run app.py
"""

from __future__ import annotations

import streamlit as st

import ui

st.set_page_config(
    layout="wide",
    page_title="Macro Stress Monitor",
    page_icon="🏦",
    initial_sidebar_state="expanded",
)

ui.inject_css()

st.sidebar.markdown("### 🏦 Strategist Dashboard")
st.sidebar.caption("markets · rates · macro · plumbing")
st.sidebar.divider()

# Grouped by the question each page answers, not by where the data comes from.
# The Strategist View is the default because it is the one screen that reads
# every other page and says what changed.
navigation = st.navigation(
    {
        "Overview": [
            st.Page("pages/07_strategist.py", title="Strategist View",
                    icon="🧭", default=True),
        ],
        "Markets": [
            st.Page("pages/05_equity.py", title="Global Equity", icon="🌍"),
            st.Page("pages/04_fixed_income.py", title="Fixed Income", icon="🪜"),
        ],
        "Macro": [
            st.Page("pages/08_macro.py", title="Macro & Policy", icon="🌐"),
            st.Page("pages/03_growth.py", title="US Growth & Activity",
                    icon="🏭"),
        ],
        "Risk & Plumbing": [
            st.Page("pages/00_composite.py", title="Stress Panel", icon="🌡️"),
            st.Page("pages/02_credit.py", title="Credit & Conditions", icon="📉"),
            st.Page("pages/01_liquidity.py", title="Funding & Liquidity",
                    icon="🏛️"),
        ],
    }
)

navigation.run()
