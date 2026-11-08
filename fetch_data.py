import io
import pandas as pd
import requests
from fredapi import Fred

print("\n--- STARTING LIQUIDITY DATA FETCH ---")
print("1. Connecting to FRED API...")

# Your FRED API Key
api_key = '5907b758430183ee403cf76fd364d8f5'
fred = Fred(api_key=api_key)

# Tickers to fetch
fred_tickers = {
    'TOTRESNS': 'Total_Reserves',
    'RRPONTSYD': 'ON_RRP_Facility',
    'WTREGEN': 'TGA_Balance',
    'WALCL': 'Fed_Total_Assets',
    'WPC': 'Discount_Window_Primary_Credit',
    'IORB': 'IORB_Rate',
    'SOFR': 'SOFR_Rate',
    'EFFR': 'EFFR_Rate',
    'WPCREDIT': 'Primary_Credit_Rate',
    'M2SL': 'M2_Money_Supply',
    'CASLCBW027SBOG': 'Large_Bank_Cash',
    'TLAACBW027SBOG': 'Large_Bank_Assets',
    'GDP': 'Nominal_GDP',
}

df_list = []
for ticker, name in fred_tickers.items():
  print(f"   -> Fetching {ticker} ({name})...")
  try:
    s = fred.get_series(ticker, observation_start='2020-01-01')
    df_temp = pd.DataFrame(s, columns=[name])
    df_list.append(df_temp)
  except Exception as e:
    print(f"   [!] Error fetching {ticker}: {e}")

print("\n2. Merging data series...")
master_df = pd.concat(df_list, axis=1)
daily_idx = pd.date_range(start='2020-01-01', end=master_df.index.max(), freq='D')
master_df = master_df.reindex(daily_idx).ffill().bfill()

print("\n3. Fetching NY Fed Standing Repo Facility (SRF) operational data...")
try:
  url = 'https://markets.newyorkfed.org/api/rp/reposts/all/results/summary/last/1200.json'
  res = requests.get(url).json()
  ops = res.get('repo', {}).get('operations', [])
  if ops:
    df_ops = pd.DataFrame(ops)
    df_ops = df_ops[df_ops['operationType'] == 'Repo'].copy()
    df_ops['operationDate'] = pd.to_datetime(df_ops['operationDate'])
    df_ops['totalAmtAccepted'] = df_ops['totalAmtAccepted'].astype(float)
    srf_daily = (
        df_ops.groupby('operationDate')['totalAmtAccepted'].sum().reset_index()
    )
    srf_daily.columns = ['Date', 'SRF_Daily_Accepted_Bil']
    srf_daily.set_index('Date', inplace=True)
    master_df = master_df.join(srf_daily, how='left')
except Exception as e:
  print(f"   [!] NY Fed API warning: {e}")

if 'SRF_Daily_Accepted_Bil' not in master_df.columns:
  master_df['SRF_Daily_Accepted_Bil'] = 0.0
master_df['SRF_Daily_Accepted_Bil'] = master_df[
    'SRF_Daily_Accepted_Bil'
].fillna(0.0)

print("\n4. Computing financial indicators & ratios...")
master_df['Fed_Total_Assets_Bil'] = master_df['Fed_Total_Assets'] / 1000.0
master_df['M2_YoY_Growth_%'] = (
    master_df['M2_Money_Supply'].pct_change(365) * 100.0
)
master_df['M2_3M_MA'] = master_df['M2_Money_Supply'].rolling(90).mean()
master_df['M2_3M_Annualized_%'] = (
    ((master_df['M2_Money_Supply'] / master_df['M2_Money_Supply'].shift(90))
     ** 4)
    - 1.0
) * 100.0
master_df['SOFR_IORB_Spread_bps'] = (
    master_df['SOFR_Rate'] - master_df['IORB_Rate']
) * 100.0
master_df['EFFR_IORB_Spread_bps'] = (
    master_df['EFFR_Rate'] - master_df['IORB_Rate']
) * 100.0
master_df['Net_Liquidity_Bil'] = (
    master_df['Fed_Total_Assets_Bil']
    - master_df['TGA_Balance']
    - master_df['ON_RRP_Facility']
)
master_df['Reserves_to_GDP_%'] = (
    master_df['Total_Reserves'] / master_df['Nominal_GDP']
) * 100.0
master_df['Reserves_to_Large_Bank_Assets_%'] = (
    master_df['Total_Reserves'] / master_df['Large_Bank_Assets']
) * 100.0
master_df['Large_Bank_Cash_Share_%'] = (
    master_df['Large_Bank_Cash'] / master_df['Total_Reserves']
) * 100.0

output_file = 'macro_liquidity_master.csv'
master_df.to_csv(output_file)
print(f"\nSUCCESS! Created '{output_file}' in your folder.\n")