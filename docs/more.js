// ------------------------------------------------------------------ COMPLETENESS PACKAGES (WP44 to WP50)
// Loaded after app.js and sp.js; uses their helpers. Each package adds a sub-tab to an existing page.
'use strict';

// ------------------------------------------------------------------ WP44. Income menu (Fixed Income → Income menu)
// What pays what: cash, government bonds, credit, dividends, REITs and put-selling, with the yield hedged to MYR and
// SGD, after inflation, and the worst 12-month result in the history the dashboard holds.
const INC_CPI = { USD: 'CPI_YOY', SGD: 'SG_CPI_YOY', MYR: 'MY_CPI_YOY', AUD: 'AU_CPI_YOY', EUR: 'EA_HICP@yoy' };
const INC_ROWS = [   // [label, group, source: series id | fn, currency, duration (years, for the worst 12-month estimate) | 'eq:<id>' | 'put']
  ['US Treasury bills (3M)', 'Cash', 'UST3M', 'USD', 0], ['Singapore dollar cash (SORA 3M)', 'Cash', 'SORA3M', 'SGD', 0],
  ['Ringgit fixed deposit (12M)', 'Cash', 'MY_FD12', 'MYR', 0], ['Australian dollar cash (3M bills)', 'Cash', 'AU_3M', 'AUD', 0], ['Euro cash (ECB deposit rate)', 'Cash', 'EA_DFR', 'EUR', 0],
  ['US Treasury 2Y', 'Government', 'UST2Y', 'USD', 1.9], ['US Treasury 10Y', 'Government', 'UST10Y', 'USD', 8.3], ['Singapore government 10Y', 'Government', 'SGS10Y', 'SGD', 8.5],
  ['Australia government 10Y', 'Government', 'AU_10Y', 'AUD', 8.3], ['German Bund 10Y', 'Government', 'DE_10Y', 'EUR', 8.8],
  ['US investment grade', 'Credit', 'IG_EY', 'USD', 6.8], ['US high yield', 'Credit', 'HY_EY', 'USD', 3.3], ['EM corporates (USD)', 'Credit', 'EM_CORP_EY', 'USD', 4.6], ['Asia corporates (USD)', 'Credit', 'ASIA_CORP_EY', 'USD', 4.3],
  ['S&P 500 dividends', 'Equity income', 'dy:SPX', 'USD', 'eq:SPX'], ['STI dividends', 'Equity income', 'dy:STI', 'SGD', 'eq:STI'], ['FBM KLCI dividends', 'Equity income', 'dy:KLCI', 'MYR', 'eq:KLCI'],
  ['Malaysian REITs (basket)', 'Equity income', 'reit:MY', 'MYR', 'reit:MY'], ['Singapore REITs (basket)', 'Equity income', 'reit:SG', 'SGD', 'reit:SG'],
  ['Selling S&P 500 puts, 3M, 10% below', 'Options', 'put', 'USD', 'put'],
];
const REITS = { MY: ['5176.KL', '5227.KL', '5106.KL', '5235SS.KL'], SG: ['C38U.SI', 'A17U.SI', 'N2IU.SI', 'M44U.SI', 'ME8U.SI', 'AJBU.SI', 'BUOU.SI', 'J69U.SI'] };
function incYield(src) {
  if (typeof src !== 'string') return null;
  if (src.startsWith('dy:')) { const x = typeof spU === 'function' && spU(src.slice(3)); return x ? { v: x.dy } : null; }
  if (src.startsWith('reit:')) { const L = REITS[src.slice(5)].map(id => spU(id)).filter(x => x && x.dy > 0).map(x => x.dy); return L.length ? { v: spMed(L), n: L.length } : null; }
  if (src === 'put') { const x = spU('SPX'), p = x && spPutYield(x); return p ? { v: p.y } : null; }
  if (!has(src)) return null; const a = asOf(S[src], state.latest), b = asOf(S[src], addMonths(a.t, -12)), q = pctRank(S[src], state.latest, 10);
  return { v: a.v, chg: b ? a.v - b.v : null, pct: q ? q.p : null, t: a.t, id: src };
}
function incWorst(row) {   // worst 12-month result in the history held: bonds by duration × rise in yield; equities and REITs by price
  const [, , src, , d] = row;
  if (typeof d === 'number') { if (!has(src)) return null; if (!d) return 0; const s = S[src]; let w = Infinity, j = 0;
    for (let i = 0; i < s.t.length; i++) { while (s.t[j] < s.t[i] - 366 * DAY) j++; if (s.t[i] - s.t[0] < 360 * DAY) continue; const k = idxLE(s, s.t[i] - 365 * DAY); if (k < 0) continue; w = Math.min(w, s.v[k] - d * (s.v[i] - s.v[k])); }
    return w === Infinity ? null : { v: w, from: s.t[0] }; }
  const w12 = (t, v) => { let w = Infinity; for (let i = 0; i < t.length; i++) { const k = idxLE({ t, v }, t[i] - 365 * DAY); if (k >= 0 && t[i] - t[0] > 360 * DAY) w = Math.min(w, (v[i] / v[k] - 1) * 100); } return w === Infinity ? null : w; };
  if (d.startsWith('eq:')) { const h = SPH && SPH[d.slice(3)]; return h ? { v: w12(h.t, h.v), from: h.t[0] } : null; }
  if (d.startsWith('reit:')) { const L = REITS[d.slice(5)].map(id => SPH && SPH[id]).filter(Boolean).map(h => w12(h.t, h.v)).filter(v => v != null); return L.length ? { v: spMed(L), from: null, med: true } : null; }
  if (d === 'put' && has('SP_PUT')) return { v: w12(S.SP_PUT.t, S.SP_PUT.v), from: S.SP_PUT.t[0] };
  return null;
}
function renderIncMenu(c) {
  const b = htmlBody(c); if (!SPD || !SPD.under) { loadSP().then(() => c.render()); b.append(el('div', { class: 'empty', text: 'Loading…' })); return; }
  if (!SPH) loadSPH().then(() => c.render());
  const heads = ['', 'Yield', '1Y change', 'Pct (10Y)', 'Hedged to MYR', 'Hedged to SGD', 'After inflation', 'Worst 12 months'], tb = el('tbody'), csv = [['Instrument', 'Group', ...heads.slice(1)]];
  const r3 = ccy => rateFor(ccy, 0.25).r * 100;
  let grp = null;
  for (const row of INC_ROWS) {
    const [lab, g, src, ccy] = row, y = incYield(src); if (!y || y.v == null) continue;
    if (g !== grp) { grp = g; tb.append(el('tr', { class: 'grp' }, el('td', { colspan: heads.length, text: g }))); }
    const hedge = to => ccy === to ? y.v : y.v + r3(to) - r3(ccy), cpi = scSer(INC_CPI[ccy]), inf = cpi ? asOf(cpi, state.latest) : null, w = incWorst(row);
    const vals = [y.v, y.chg, y.pct, hedge('MYR'), hedge('SGD'), inf ? y.v - inf.v : null, w ? w.v : null];
    tb.append(el('tr', { class: 'row', title: `${ccy}${y.t ? ' · ' + nice(y.t) : ''}${y.n ? ` · median of ${y.n} REITs` : ''}${w && w.from ? ' · worst since ' + new Date(w.from).getUTCFullYear() : ''}` },
      el('td', { class: 'l', text: lab }), el('td', { class: 'num strong', text: pc2(vals[0]) }), el('td', { class: 'num', text: vals[1] == null ? '–' : sign(vals[1]) + fmtNum(Math.abs(vals[1]) * 100, 0) + 'bp' }),
      el('td', { class: 'num', text: vals[2] == null ? '–' : ordF(vals[2]) }), el('td', { class: 'num', text: pc2(vals[3]) }), el('td', { class: 'num', text: pc2(vals[4]) }),
      el('td', { class: 'num ' + (vals[5] == null ? '' : vals[5] > 0 ? 'up' : 'dn'), text: pc1(vals[5]) }), el('td', { class: 'num ' + (vals[6] != null && vals[6] < -10 ? 'dn' : ''), text: vals[6] == null ? '–' : pctF1(vals[6]) })));
    csv.push([lab, g, ...vals]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i ? '' : 'l' })))), tb)));
  c.csv = csv;
  setNote(c, 'What each source of income pays now, against its own 10 years. Hedged = the yield after hedging the currency into MYR or SGD for 3 months at a time (add the target currency’s short rate, subtract the instrument’s). After inflation = minus the latest consumer inflation of the instrument’s currency. Worst 12 months: bonds estimated from the largest rise in yield × duration (credit history from 2023, when the dashboard began archiving it); equities, REITs and put-selling from prices (since 2006, REITs about 3 years, median of the basket). Dividend yields are trailing 12 months; REIT baskets are equal-weight medians.');
  setSource(c, 'FRED (Treasuries, ICE BofA effective yields), MAS, Bank Negara, RBA, ECB; Yahoo Finance (dividends, prices); Cboe (put-selling); calculated');
}
state.incIds = 'core';
function renderIncChart(c) {
  const sets = { core: ['UST10Y', 'IG_EY', 'HY_EY', 'ASIA_CORP_EY', 'MY_FD12'], cash: ['UST3M', 'SORA3M', 'MY_FD12', 'AU_3M', 'EA_DFR'] };
  const ids = sets[state.incIds].filter(id => has(id)); if (!ids.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, ids.map(id => ({ name: S[id].label, data: pts(S[id], state.from, state.to) })), { fmt: v => fmtNum(v, 2) + '%', axisFmt: v => fmtNum(v, 1) + '%', endLabels: false });
  setNote(c, 'Yields over time. Credit effective yields: FRED keeps three years; the dashboard archives them daily from now on, so the history lengthens.');
  setSource(c, srcOf(ids));
}

// ------------------------------------------------------------------ build and wiring
const EXTRA_RENDER = { fixed: ['inc_menu', 'inc_chart'] };   // pages whose own render function lists its cards: render these too
SUBTABS.fixed.push(['Income menu', ['inc_menu', 'inc_chart']]);
function buildMore() {
  const fi = $('#fiGrid');
  makeCard(fi, { key: 'inc_menu', title: 'Income menu: what pays what', wide: true, range: false, render: renderIncMenu });
  makeCard(fi, { key: 'inc_chart', title: 'Yields over time', wide: true, defaultRange: '3Y', seg: { key: 'incIds', options: [['core', 'Bonds & credit'], ['cash', 'Cash']] }, render: renderIncChart });
  const r = cards.inc_menu.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true;
}
