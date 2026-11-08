"""
Series catalogue for the strategist dashboard.

To ADD a market or indicator, add one line here and the next daily run picks it up.
  - Yahoo entries:  (id, yahoo_symbol, label, group, kind, unit)
  - FRED entries:   (id, fred_series_id, label, group, kind, unit[, start_date])

kind tells the dashboard how to measure change:
  "price"  -> % returns          (equities, FX, commodities, ETFs)
  "yield"  -> change in bp       (interest rates, spreads quoted in %)
  "level"  -> simple difference  (balance sheets, index levels like NFCI)
"""

START_DATE = "2005-01-01"
MACRO_START = "1959-01-01"   # macro series: long history so regimes include the 1970s-80s inflation cycles

# ---------------------------------------------------------------- Yahoo Finance
YAHOO = [
    # Equities - developed
    ("SPX",      "^GSPC",     "S&P 500",              "Equities · US",        "price", "pts"),
    ("NDX",      "^NDX",      "Nasdaq 100",           "Equities · US",        "price", "pts"),
    ("RTY",      "^RUT",      "Russell 2000",         "Equities · US",        "price", "pts"),
    ("SX5E",     "^STOXX50E", "Euro Stoxx 50",        "Equities · Europe",    "price", "pts"),
    ("DAX",      "^GDAXI",    "DAX",                  "Equities · Europe",    "price", "pts"),
    ("CAC",      "^FCHI",     "CAC 40",               "Equities · Europe",    "price", "pts"),
    ("UKX",      "^FTSE",     "FTSE 100",             "Equities · Europe",    "price", "pts"),
    ("NKY",      "^N225",     "Nikkei 225",           "Equities · Japan",     "price", "pts"),
    ("AS51",     "^AXJO",     "ASX 200",              "Equities · Australia", "price", "pts"),
    # Equities - Asia / EM
    ("CSI300",   "510300.SS", "CSI 300 (510300 ETF)", "Equities · China/HK",  "price", "CNY"),
    ("SHCOMP",   "000001.SS", "Shanghai Composite",   "Equities · China/HK",  "price", "pts"),
    ("HSCEI",    "^HSCE",     "HS China Enterprises", "Equities · China/HK",  "price", "pts"),
    ("MCHI",     "MCHI",      "MSCI China (MCHI)",    "Equities · China/HK",  "price", "USD"),
    ("HSI",      "^HSI",      "Hang Seng",            "Equities · China/HK",  "price", "pts"),
    ("STI",      "^STI",      "Straits Times",        "Equities · ASEAN",     "price", "pts"),
    ("KLCI",     "^KLSE",     "FBM KLCI",             "Equities · ASEAN",     "price", "pts"),
    ("JCI",      "^JKSE",     "Jakarta Composite",    "Equities · ASEAN",     "price", "pts"),
    ("KOSPI",    "^KS11",     "KOSPI",                "Equities · N. Asia",   "price", "pts"),
    ("TWSE",     "^TWII",     "Taiwan Weighted",      "Equities · N. Asia",   "price", "pts"),
    ("NIFTY",    "^NSEI",     "Nifty 50",             "Equities · India",     "price", "pts"),
    ("IBOV",     "^BVSP",     "Bovespa",              "Equities · LatAm",     "price", "pts"),
    ("ACWI",     "URTH",      "MSCI World (URTH)",    "Equities · Global",    "price", "USD"),
    ("EEM",      "EEM",       "MSCI EM (EEM)",        "Equities · Global",    "price", "USD"),
    ("AAXJ",     "AAXJ",      "MSCI Asia ex-JP (AAXJ)","Equities · Global",   "price", "USD"),
    # US sectors
    ("XLK",      "XLK",       "US Tech (XLK)",        "Equities · US sectors","price", "USD"),
    ("XLF",      "XLF",       "US Financials (XLF)",  "Equities · US sectors","price", "USD"),
    ("XLE",      "XLE",       "US Energy (XLE)",      "Equities · US sectors","price", "USD"),
    ("VNQ",      "VNQ",       "US REITs (VNQ)",       "Equities · US sectors","price", "USD"),
    ("XLY",      "XLY",       "US Cons. Discretionary (XLY)", "Equities · US sectors","price", "USD"),
    ("XLI",      "XLI",       "US Industrials (XLI)", "Equities · US sectors","price", "USD"),
    ("XLP",      "XLP",       "US Cons. Staples (XLP)", "Equities · US sectors","price", "USD"),
    ("XLU",      "XLU",       "US Utilities (XLU)",   "Equities · US sectors","price", "USD"),
    # AI complex
    ("NVDA",     "NVDA",      "Nvidia",               "Equities · AI",        "price", "USD"),
    ("AVGO",     "AVGO",      "Broadcom",             "Equities · AI",        "price", "USD"),
    ("TSM",      "TSM",       "TSMC (ADR)",           "Equities · AI",        "price", "USD"),
    ("AMD",      "AMD",       "AMD",                  "Equities · AI",        "price", "USD"),
    ("MSFT",     "MSFT",      "Microsoft",            "Equities · AI",        "price", "USD"),
    ("GOOGL",    "GOOGL",     "Alphabet",             "Equities · AI",        "price", "USD"),
    ("AMZN",     "AMZN",      "Amazon",               "Equities · AI",        "price", "USD"),
    ("META",     "META",      "Meta",                 "Equities · AI",        "price", "USD"),
    ("SMH",      "SMH",       "Semiconductors ETF (SMH)", "Equities · AI",    "price", "USD"),
    # Bonds / credit (ETF total return proxies)
    ("TLT",      "TLT",       "UST 20Y+ (TLT)",       "Bonds & credit",       "price", "USD"),
    ("IEF",      "IEF",       "UST 7-10Y (IEF)",      "Bonds & credit",       "price", "USD"),
    ("LQD",      "LQD",       "US IG credit (LQD)",   "Bonds & credit",       "price", "USD"),
    ("HYG",      "HYG",       "US HY credit (HYG)",   "Bonds & credit",       "price", "USD"),
    ("EMB",      "EMB",       "EM USD bonds (EMB)",   "Bonds & credit",       "price", "USD"),
    # FX (quoted as Yahoo quotes them; USDxxx up = USD stronger)
    ("DXY",      "DX-Y.NYB",  "US Dollar Index",      "FX",                   "price", "idx"),
    ("EURUSD",   "EURUSD=X",  "EUR/USD",              "FX",                   "price", ""),
    ("USDJPY",   "JPY=X",     "USD/JPY",              "FX",                   "price", ""),
    ("USDCNY",   "CNY=X",     "USD/CNY",              "FX",                   "price", ""),
    ("AUDUSD",   "AUDUSD=X",  "AUD/USD",              "FX",                   "price", ""),
    ("USDSGD",   "SGD=X",     "USD/SGD",              "FX",                   "price", ""),
    ("USDMYR",   "MYR=X",     "USD/MYR",              "FX",                   "price", ""),
    ("USDKRW",   "KRW=X",     "USD/KRW",              "FX",                   "price", ""),
    ("USDINR",   "INR=X",     "USD/INR",              "FX",                   "price", ""),
    ("USDBRL",   "BRL=X",     "USD/BRL",              "FX",                   "price", ""),
    ("GBPUSD",   "GBPUSD=X",  "GBP/USD",              "FX",                   "price", ""),
    ("USDHKD",   "HKD=X",     "USD/HKD",              "FX",                   "price", ""),
    ("USDTWD",   "TWD=X",     "USD/TWD",              "FX",                   "price", ""),
    ("USDIDR",   "IDR=X",     "USD/IDR",              "FX",                   "price", ""),
    ("USDTHB",   "THB=X",     "USD/THB",              "FX",                   "price", ""),
    ("USDPHP",   "PHP=X",     "USD/PHP",              "FX",                   "price", ""),
    # Commodities
    ("GOLD",     "GC=F",      "Gold",                 "Commodities",          "price", "USD/oz"),
    ("SILVER",   "SI=F",      "Silver",               "Commodities",          "price", "USD/oz"),
    ("BRENT",    "BZ=F",      "Brent crude",          "Commodities",          "price", "USD/bbl"),
    ("WTI",      "CL=F",      "WTI crude",            "Commodities",          "price", "USD/bbl"),
    ("COPPER",   "HG=F",      "Copper",               "Commodities",          "price", "USD/lb"),
    ("NATGAS",   "NG=F",      "US natural gas",       "Commodities",          "price", "USD/MMBtu"),
    # Crypto
    ("BTC",      "BTC-USD",   "Bitcoin",              "Crypto",               "price", "USD"),
    ("ETH",      "ETH-USD",   "Ether",                "Crypto",               "price", "USD"),
    # Volatility
    ("VIX",      "^VIX",      "VIX (equity vol)",     "Volatility",           "level", "pts"),
    ("MOVE",     "^MOVE",     "MOVE (rates vol)",     "Volatility",           "level", "pts"),
    ("VIX9D",    "^VIX9D",    "VIX 9-day",            "Volatility",           "level", "pts"),
    ("VIX3M",    "^VIX3M",    "VIX 3-month",          "Volatility",           "level", "pts"),
    ("VIX6M",    "^VIX6M",    "VIX 6-month",          "Volatility",           "level", "pts"),
    ("VVIX",     "^VVIX",     "VVIX (vol of VIX)",    "Volatility",           "level", "pts"),
    ("SKEW",     "^SKEW",     "CBOE SKEW (tail risk)", "Volatility",          "level", "pts"),
    ("VXN",      "^VXN",      "Nasdaq-100 vol (VXN)", "Volatility",           "level", "pts"),
    ("OVX",      "^OVX",      "Oil vol (OVX)",        "Volatility",           "level", "pts"),
    ("GVZ",      "^GVZ",      "Gold vol (GVZ)",       "Volatility",           "level", "pts"),
]

# ---------------------------------------------------------------- FRED (St. Louis Fed)
FRED = [
    # Fed balance sheet & liquidity plumbing
    ("FED_ASSETS",  "WALCL",       "Fed total assets",            "Liquidity", "level", "USD mn"),
    ("TGA",         "WDTGAL",      "Treasury General Account",    "Liquidity", "level", "USD mn"),
    ("RRP",         "RRPONTSYD",   "Overnight reverse repo",      "Liquidity", "level", "USD bn"),
    ("RESERVES",    "WRESBAL",     "Bank reserves",               "Liquidity", "level", "USD mn"),
    ("SRF",         "RPONTSYD",    "Repo operations (SRF)",       "Liquidity", "level", "USD bn"),
    ("SOFR",        "SOFR",        "SOFR",                        "Liquidity", "yield", "%"),
    ("IORB",        "IORB",        "Interest on reserves (IORB)", "Liquidity", "yield", "%"),
    ("EFFR",        "EFFR",        "Effective fed funds",         "Liquidity", "yield", "%"),
    ("M2",          "M2SL",        "US M2 money supply",          "Liquidity", "level", "USD bn"),
    ("GDP",         "GDP",         "US nominal GDP (SAAR)",       "Liquidity", "level", "USD bn"),
    ("BANK_ASSETS", "TLAACBW027SBOG", "Commercial bank total assets", "Liquidity", "level", "USD bn"),
    # Other central banks
    ("ECB_ASSETS",  "ECBASSETSW",  "ECB total assets",            "Global CBs", "level", "EUR mn"),
    ("BOJ_ASSETS",  "JPNASSETS",   "BoJ total assets",            "Global CBs", "level", "JPY 100mn"),
    ("FX_USDEUR",   "DEXUSEU",     "USD per EUR (FRED)",          "Global CBs", "price", ""),
    ("FX_JPYUSD",   "DEXJPUS",     "JPY per USD (FRED)",          "Global CBs", "price", ""),
    # Rates
    ("UST3M",       "DGS3MO",      "UST 3M yield",                "Rates · US", "yield", "%"),
    ("UST2Y",       "DGS2",        "UST 2Y yield",                "Rates · US", "yield", "%"),
    ("UST10Y",      "DGS10",       "UST 10Y yield",               "Rates · US", "yield", "%"),
    ("UST30Y",      "DGS30",       "UST 30Y yield",               "Rates · US", "yield", "%"),
    ("REAL10Y",     "DFII10",      "UST 10Y real yield (TIPS)",   "Rates · US", "yield", "%"),
    ("BE10Y",       "T10YIE",      "10Y breakeven inflation",     "Rates · US", "yield", "%"),
    ("CURVE_2s10s", "T10Y2Y",      "2s10s curve",                 "Rates · US", "yield", "%"),
    ("CURVE_3m10y", "T10Y3M",      "3m10y curve",                 "Rates · US", "yield", "%"),
    # Credit & financial conditions
    ("HY_OAS",      "BAMLH0A0HYM2","US HY spread (OAS)",          "Credit",     "yield", "%"),
    ("IG_OAS",      "BAMLC0A0CM",  "US IG spread (OAS)",          "Credit",     "yield", "%"),
    ("EUR_HY_OAS",  "BAMLHE00EHYIOAS", "Euro HY spread (OAS)",    "Credit",     "yield", "%"),
    ("ASIA_CORP_OAS","BAMLEMRACRPIASIAOAS", "Asia EM corporate spread (OAS)", "Credit", "yield", "%"),
    ("BAA_10Y",     "BAA10Y",      "Moody's Baa − 10Y Treasury",  "Credit",     "yield", "%", MACRO_START),
    ("NFCI",        "NFCI",        "Chicago Fed financial conditions", "Credit", "level", "idx", MACRO_START),
    ("STLFSI",      "STLFSI4",     "St. Louis Fed financial stress", "Credit",  "level", "idx", MACRO_START),
    ("FWD5Y5Y",     "T5YIFR",      "5y5y forward inflation expectation", "Rates · US", "yield", "%"),

    # ---- Regime model inputs (monthly macro, longer history for rolling z-scores)
    # Growth
    ("CFNAI",       "CFNAI",       "Chicago Fed National Activity Index", "Macro · Growth", "level", "idx", MACRO_START),
    ("INDPRO",      "INDPRO",      "Industrial production",       "Macro · Growth", "level", "idx", MACRO_START),
    ("PAYEMS",      "PAYEMS",      "Nonfarm payrolls",            "Macro · Growth", "level", "k", MACRO_START),
    ("RETAIL_REAL", "RRSFS",       "Real retail sales",           "Macro · Growth", "level", "USD mn", MACRO_START),
    ("CLAIMS",      "ICSA",        "Initial jobless claims",      "Macro · Growth", "level", "persons", MACRO_START),
    ("UNRATE",      "UNRATE",      "Unemployment rate",           "Macro · Growth", "level", "%", MACRO_START),
    # Inflation
    ("CPI",         "CPIAUCSL",    "CPI (headline)",              "Macro · Inflation", "level", "idx", MACRO_START),
    ("CORE_CPI",    "CPILFESL",    "Core CPI",                    "Macro · Inflation", "level", "idx", MACRO_START),
    ("CORE_PCE",    "PCEPILFE",    "Core PCE price index",        "Macro · Inflation", "level", "idx", MACRO_START),
    # Leading index components (Conference Board method, free proxies)
    ("AWHMAN",      "AWHMAN",      "Avg weekly hours, manufacturing", "Macro · Leading", "level", "hours", MACRO_START),
    ("ACOGNO",      "ACOGNO",      "New orders: consumer goods & materials", "Macro · Leading", "level", "USD mn", MACRO_START),
    ("PHILLY_NO",   "NOCDFSA066MSFRBPHI", "Philly Fed new orders (diffusion)", "Macro · Leading", "level", "idx", MACRO_START),
    ("NEWORDER",    "NEWORDER",    "Core capital goods orders (ex defence & aircraft)", "Macro · Leading", "level", "USD mn", MACRO_START),
    ("PERMIT",      "PERMIT",      "Building permits",            "Macro · Leading", "level", "k", MACRO_START),
    ("T10YFF",      "T10YFF",      "10Y Treasury − fed funds",    "Macro · Leading", "yield", "%", MACRO_START),
    ("UMCSENT",     "UMCSENT",     "UMich consumer sentiment",    "Macro · Leading", "level", "idx", MACRO_START),
    # Long-history assets for regime statistics
    ("GS10",        "GS10",        "10Y Treasury yield (monthly)", "Rates · US", "yield", "%", MACRO_START),
    ("TB3MS",       "TB3MS",       "3M T-bill rate (monthly)",    "Rates · US", "yield", "%", MACRO_START),
    ("WTI_LONG",    "WTISPLC",     "WTI crude spot (monthly)",    "Commodities", "price", "USD/bbl", MACRO_START),
    # Real effective exchange rates (BIS broad, monthly) for FX valuation
    ("REER_USD",    "RBUSBIS",     "US dollar REER",              "Valuation · FX", "level", "idx", MACRO_START),
    ("REER_EUR",    "RBXMBIS",     "Euro REER",                   "Valuation · FX", "level", "idx", MACRO_START),
    ("REER_JPY",    "RBJPBIS",     "Japanese yen REER",           "Valuation · FX", "level", "idx", MACRO_START),
    ("REER_CNY",    "RBCNBIS",     "Chinese yuan REER",           "Valuation · FX", "level", "idx", MACRO_START),
    ("REER_GBP",    "RBGBBIS",     "British pound REER",          "Valuation · FX", "level", "idx", MACRO_START),
    ("REER_SGD",    "RBSGBIS",     "Singapore dollar REER",       "Valuation · FX", "level", "idx", MACRO_START),
    ("REER_MYR",    "RBMYBIS",     "Malaysian ringgit REER",      "Valuation · FX", "level", "idx", MACRO_START),
    ("REER_KRW",    "RBKRBIS",     "Korean won REER",             "Valuation · FX", "level", "idx", MACRO_START),
    ("REER_INR",    "RBINBIS",     "Indian rupee REER",           "Valuation · FX", "level", "idx", MACRO_START),
    ("REER_AUD",    "RBAUBIS",     "Australian dollar REER",      "Valuation · FX", "level", "idx", MACRO_START),
    ("REER_IDR",    "RBIDBIS",     "Indonesian rupiah REER",      "Valuation · FX", "level", "idx", MACRO_START),
    # Stress panel / peak signposts
    ("FEDFUNDS",    "FEDFUNDS",    "Fed funds rate (monthly)",    "Rates · US", "yield", "%", MACRO_START),
    ("SLOOS_CI",    "DRTSCILM",    "Banks tightening C&I lending standards (net %)", "Credit", "level", "%", MACRO_START),
    # Recession watch
    ("SAHM",        "SAHMREALTIME","Sahm rule (real-time)",       "Macro · Recession", "level", "pp", MACRO_START),
    ("REC_PROB_CP", "RECPROUSM156N","Recession probability (Chauvet-Piger)", "Macro · Recession", "level", "%", MACRO_START),
    ("USREC",       "USREC",       "NBER recession indicator",    "Macro · Recession", "level", "", MACRO_START),
    ("CURVE_3m10y_LONG", "T10Y3M", "3m10y curve (long history)",  "Macro · Recession", "yield", "%", MACRO_START),
]

# FRED cut the ICE BofA spread family to a rolling 3-year window in April 2026.
# These are archived in archive/<id>.csv (committed by the daily job) so history
# is never lost again: each run merges what FRED returns into the archive.
ARCHIVE = {"HY_OAS", "IG_OAS", "EUR_HY_OAS", "ASIA_CORP_OAS"}

# Long daily histories from Yahoo (for regime statistics back to the 1970s), stored monthly
LONG_YAHOO = [("LH_SPX", "^GSPC", "S&P 500 (price, since 1960)"), ("LH_USD", "DX-Y.NYB", "US Dollar Index (since 1971)"),
              ("LH_GSCI", "^SPGSCI", "S&P GSCI commodities (since 1984)")]
