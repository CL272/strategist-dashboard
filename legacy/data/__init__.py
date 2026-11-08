"""
Data access layer for the macro stress dashboard.

Everything that touches an external API lives in this package. Streamlit pages
import from here and never call an API directly, so the dashboard reads only
from the local parquet cache written by refresh.py.

    fred.py       FRED (needs a free API key)
    registry.py   the single list of tracked series
"""
