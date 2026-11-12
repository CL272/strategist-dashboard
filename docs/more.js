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

// ------------------------------------------------------------------ WP45. Playbook (Regime & Leading → Playbook)
// Event studies: what assets did around past events, median path 12 months either side, and how often they rose.
function pbMonthly(id) {   // month-end values {t[], v[]} (t = month-end ms)
  if (!has(id)) return null; const s = S[id], t = [], v = [];
  for (let i = 0; i < s.t.length; i++) { const d = new Date(s.t[i]), me = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0);
    if (t.length && t[t.length - 1] === me) v[v.length - 1] = s.v[i]; else { t.push(me); v.push(s.v[i]); } }
  return { t, v };
}
const pbMax = id => { if (!has(id)) return null; const s = S[id], t = [], v = []; for (let i = 0; i < s.t.length; i++) { const d = new Date(s.t[i]), me = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0); if (t.length && t[t.length - 1] === me) v[v.length - 1] = Math.max(v[v.length - 1], s.v[i]); else { t.push(me); v.push(s.v[i]); } } return { t, v }; };
const PB_EVENTS = {
  first_cut: ['First Fed cut', 'The first cut in the fed funds rate after at least a year without one (monthly average).', () => { const f = pbMonthly('FEDFUNDS'); if (!f) return []; const out = []; let last = -1e15;
    for (let i = 1; i < f.v.length; i++) if (f.v[i] - f.v[i - 1] <= -0.2) { if (f.t[i] - last > 365 * DAY) out.push(f.t[i]); last = f.t[i]; } return out; }],
  last_hike: ['Last Fed hike', 'A rise in the fed funds rate not followed by another within 12 months.', () => { const f = pbMonthly('FEDFUNDS'); if (!f) return []; const out = [];
    for (let i = 1; i < f.v.length - 12; i++) if (f.v[i] - f.v[i - 1] >= 0.2) { let more = false; for (let j = i + 1; j <= i + 12; j++) if (f.v[j] - f.v[j - 1] >= 0.2) more = true; if (!more) out.push(f.t[i]); } return out; }],
  recession: ['US recession starts', 'First month of each NBER recession.', () => { const r = pbMonthly('USREC'); if (!r) return []; const out = []; for (let i = 1; i < r.v.length; i++) if (r.v[i] === 1 && r.v[i - 1] !== 1) out.push(r.t[i]); return out; }],
  vix40: ['VIX above 40', 'First month the VIX closed above 40 after six months below it.', () => { const v = pbMax('VIXCLS') || pbMax('VIX'); if (!v) return []; const out = []; let quiet = 0;
    for (let i = 0; i < v.v.length; i++) { if (v.v[i] > 40) { if (quiet >= 6) out.push(v.t[i]); quiet = 0; } else quiet++; } return out; }],
  oil40: ['Oil up 40% in a year', 'First month WTI was more than 40% above a year earlier, after a year without that.', () => { const o = pbMonthly('LH_OIL'); if (!o) return []; const out = []; let last = -1e15;
    for (let i = 12; i < o.v.length; i++) if (o.v[i] / o.v[i - 12] > 1.4) { if (o.t[i] - last > 366 * DAY) out.push(o.t[i]); last = o.t[i]; } return out; }],
  usd_peak: ['US dollar peak', 'A 2-year high in the dollar index followed by a fall of 10% or more (known only afterwards).', () => { const d = pbMonthly('LH_USD'); if (!d) return []; const out = [];
    for (let i = 12; i < d.v.length - 18; i++) { const w = d.v.slice(i - 12, i + 13); if (d.v[i] === Math.max(...w) && Math.min(...d.v.slice(i, i + 19)) <= d.v[i] * 0.9 && (!out.length || d.t[i] - out[out.length - 1] > 730 * DAY)) out.push(d.t[i]); } return out; }],
  uninvert: ['Yield curve un-inverts', 'First month 2s10s turned positive after at least 3 months inverted.', () => { if (!has('UST10Y', 'UST2Y')) return []; const c = pbMonthly('UST10Y'), b = pbMonthly('UST2Y'), out = []; let inv = 0;
    for (let i = 0; i < c.t.length; i++) { const j = b.t.indexOf(c.t[i]); if (j < 0) continue; const s2 = c.v[i] - b.v[j]; if (s2 < 0) inv++; else { if (inv >= 3) out.push(c.t[i]); inv = 0; } } return out; }],
  ...Object.fromEntries([1, 2, 3, 4].map(q => [`reg${q}`, [`Regime turns ${(typeof QUADS !== 'undefined' && QUADS[q] ? QUADS[q].name : 'quad ' + q)}`, 'Months the dashboard’s growth / inflation regime switched to this one.',
    () => { const r = pbMonthly('REG_QUAD'); if (!r) return []; const out = []; for (let i = 1; i < r.v.length; i++) if (r.v[i] === q && r.v[i - 1] !== q) out.push(r.t[i]); return out; }]])),
};
const PB_ASSETS = [['LH_SPX', 'S&P 500', 'pct'], ['UST10Y', 'US 10Y yield', 'bp'], ['LH_USD', 'US dollar', 'pct'], ['GOLD', 'Gold', 'pct'], ['LH_OIL', 'Oil (WTI)', 'pct'], ['COPPER', 'Copper', 'pct'],
  ['EEM', 'Emerging markets', 'pct'], ['KLCI', 'FBM KLCI', 'pct'], ['STI', 'Straits Times', 'pct'], ['HY_OAS', 'US HY spread', 'bp'], ['USDMYR', 'USD/MYR', 'pct'], ['LH_GSCI', 'Commodities (GSCI)', 'pct']];
state.pbEvent = 'first_cut'; state.pbAsset = 'LH_SPX';
const pbCache = {};
function pbEvents(k) { return pbCache[k] || (pbCache[k] = (PB_EVENTS[k] ? PB_EVENTS[k][2]() : []).filter(t => t < state.latest)); }
function pbPaths(k, a) {   // [{t, path: [k=-12..12 → change]}]
  const [id, , kind] = PB_ASSETS.find(x => x[0] === a) || [a, a, 'pct'], m = pbMonthly(id); if (!m) return [];
  const idx = new Map(m.t.map((t, i) => [t, i]));
  return pbEvents(k).map(t => { const i = idx.get(t); if (i == null) return null; const path = [];
    for (let j = -12; j <= 12; j++) { const x = m.v[i + j]; path.push(x == null ? null : kind === 'bp' ? (x - m.v[i]) * 100 : (x / m.v[i] - 1) * 100); }
    return { t, path }; }).filter(Boolean);
}
const pbMedAt = (P, j) => spMed(P.map(p => p.path[j + 12]));
function renderPbChart(c) {
  const k = state.pbEvent, ev = PB_EVENTS[k], A = PB_ASSETS.find(x => x[0] === state.pbAsset) || PB_ASSETS[0], P = pbPaths(k, A[0]);
  const sel = el('select', { class: 'mini-select' }, ...PB_ASSETS.map(([id, l]) => el('option', { value: id, text: l }))); sel.value = A[0];
  sel.addEventListener('change', () => { state.pbAsset = sel.value; c.render(); cards.pb_events.render(); });
  c.subEl.replaceChildren(el('span', { class: 'muted small', text: 'Asset: ' }), sel, el('span', { class: 'muted small', text: ` · ${ev[1]}` }));
  if (P.length < 2) return setEmpty(c, `Too few ${ev[0].toLowerCase()} events with ${A[1]} data.`);
  const xs = [...Array(25)].map((_, j) => j - 12), unit = A[2] === 'bp' ? 'bp' : '%', f = v => sign(v) + fmtNum(Math.abs(v), unit === 'bp' ? 0 : 1) + unit;
  const o = baseOpt();
  o.series = [...P.map(p => line(new Date(p.t).getUTCFullYear() + '', xs.map((x, j) => [x, p.path[j]]).filter(q => q[1] != null), hexA(tok('--muted'), 0.35), { lineStyle: { width: 1, color: hexA(tok('--muted'), 0.35) }, silent: true })),
    line('Median of all events', xs.map(x => [x, pbMedAt(P, x)]), col(0), { lineStyle: { width: 3, color: col(0) } })];
  const last = pbEvents(k).slice(-1)[0], since = last ? Math.round((state.latest - last) / (30.44 * DAY)) : null;
  if (since != null && since <= 12) { const cur = pbPaths(k, A[0]).find(p => p.t === last); if (cur) o.series.push(line(`Now (since ${monthLab(last)})`, xs.slice(0, 13 + since).map((x, j) => [x, cur.path[j]]).filter(q => q[1] != null), col(1), { lineStyle: { width: 2.5, color: col(1) } })); }
  o.xAxis = { type: 'value', min: -12, max: 12, interval: 3, name: 'months from the event', nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: tok('--muted'), fontSize: 11 }, axisLabel: { color: tok('--muted'), fontSize: 11, formatter: v => v > 0 ? '+' + v : v }, splitLine: { show: false } };
  o.yAxis = valAxis(v => fmtNum(v, 0) + unit); o.grid.bottom = 28; o.legend.data = o.series.slice(-2).map(s => s.name);
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => `${esc(p.seriesName)}: ${f(p.value[1])} at ${p.value[0] > 0 ? '+' : ''}${p.value[0]}m` };
  o.series.push({ type: 'line', data: [], markLine: { silent: true, symbol: 'none', lineStyle: { color: tok('--axis'), type: 'dashed' }, label: { show: false }, data: [{ xAxis: 0 }, { yAxis: 0 }] } });
  inst(c).setOption(o, true);
  c.csv = [['Event', ...xs.map(x => 'm' + x)], ...P.map(p => [iso(p.t), ...p.path]), ['Median', ...xs.map(x => pbMedAt(P, x))]];
  const m12 = pbMedAt(P, 12), up12 = P.filter(p => p.path[24] != null && p.path[24] > 0).length / P.filter(p => p.path[24] != null).length * 100;
  setNote(c, `After a ${ev[0].toLowerCase()}, ${A[1]} has moved a median ${m12 == null ? '–' : f(m12)} over the next 12 months, ${A[2] === 'bp' ? 'rising' : 'up'} ${fmtNum(up12, 0)}% of the time (${P.length} events since ${new Date(P[0].t).getUTCFullYear()}). Grey = each event; blue = median; ${since != null && since <= 12 ? 'red = the latest event, so far.' : 'the latest event was ' + (since != null ? since + ' months ago.' : '–')} History, not a forecast: few events, each different.`);
  setSource(c, 'FRED, Yahoo Finance, Shiller (long S&P); calculated');
}
function renderPbTable(c) {
  const b = htmlBody(c), k = state.pbEvent, heads = ['Asset', 'n', '1M', '3M', '6M', '12M', 'Up 3M', 'Up 12M'], tb = el('tbody'), csv = [heads];
  for (const [id, lab, kind] of PB_ASSETS) {
    const P = pbPaths(k, id); if (P.length < 2) continue;
    const f = v => v == null ? '–' : sign(v) + fmtNum(Math.abs(v), kind === 'bp' ? 0 : 1) + (kind === 'bp' ? 'bp' : '%');
    const up = j => { const L = P.filter(p => p.path[j + 12] != null); return L.length ? L.filter(p => p.path[j + 12] > 0).length / L.length * 100 : null; };
    const vals = [1, 3, 6, 12].map(j => pbMedAt(P, j));
    tb.append(el('tr', { class: 'row' + (id === state.pbAsset ? ' sel' : ''), style: 'cursor:pointer', onclick: () => { state.pbAsset = id; ['pb_chart', 'pb_table'].forEach(x => cards[x].render()); } },
      el('td', { class: 'l', text: lab }), el('td', { class: 'num muted', text: P.length }), ...vals.map(v => el('td', { class: 'num ' + (v == null ? '' : v > 0 ? 'up' : 'dn'), text: f(v) })),
      el('td', { class: 'num', text: up(3) == null ? '–' : fmtNum(up(3), 0) + '%' }), el('td', { class: 'num strong', text: up(12) == null ? '–' : fmtNum(up(12), 0) + '%' })));
    csv.push([lab, P.length, ...vals, up(3), up(12)]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i ? '' : 'l' })))), tb)));
  c.csv = csv;
  setNote(c, `Median change after each ${PB_EVENTS[k][0].toLowerCase()}; Up = how often it was up (yields and spreads: rising); n = events with data. Event counts differ because histories start at different dates. Click a row to chart it.`);
  setSource(c, 'FRED, Yahoo Finance; calculated');
}
function renderPbEvents(c) {
  const b = htmlBody(c), E = pbEvents(state.pbEvent).slice().reverse();
  if (!E.length) { b.append(el('div', { class: 'empty', text: 'No events in the data.' })); return; }
  const since = Math.round((state.latest - E[0]) / (30.44 * DAY));
  b.append(el('p', { class: 'strong', text: `Latest: ${monthLab(E[0])} (${since} month${since === 1 ? '' : 's'} ago)` }), el('ul', { class: 'pb-list' }, ...E.slice(0, 18).map(t => el('li', { text: monthLab(t) }))));
  setNote(c, `${E.length} events found. ${PB_EVENTS[state.pbEvent][1]}`);
}

// ------------------------------------------------------------------ WP46. Earnings dates on the Calendar (from structured.json)
const ER_KEY = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'AVGO', 'TSLA', 'JPM', 'TSM'];   // flagged as key events (Weekly brief week ahead)
let erAdded = false;
CAL_REGIONS.push('Earnings'); state.calRegions.add('Earnings');   // the chip exists from the start; the dates arrive with structured.json
function addEarningsToCal() {
  if (erAdded || !CAL || !CAL.events || !SPD || !SPD.earnings) return; erAdded = true;
  for (const [sym, e] of Object.entries(SPD.earnings)) {
    CAL.events.push({ d: e.d, region: 'Earnings', name: `${SP_SHORT(sym)} (${sym}) earnings`, kind: 'Data', conf: 'Estimated', hi: ER_KEY.includes(sym),
      sgt: e.when === 'after close' ? '≈04:05 (+1 day)' : e.when === 'before open' ? '≈20:00' : '', src: 'Nasdaq',
      detail: [e.when ? `${e.when} (US)` : '', e.eps ? `EPS forecast ${e.eps}` : '', e.move ? `options imply a ±${fmtNum(e.move, 1)}% move` : ''].filter(Boolean).join('; ') + '. Date as listed by Nasdaq; may change.' });
  }
  CAL.events.sort((a, b) => a.d.localeCompare(b.d));
}

// ------------------------------------------------------------------ WP47. Model portfolio: past episodes and risk contribution (Idea log → Model portfolio)
const MP_EPISODES = [['Global financial crisis', '2007-10-09', '2009-03-09'], ['Taper tantrum', '2013-05-21', '2013-06-24'], ['China devaluation', '2015-08-10', '2016-02-11'],
  ['Late-2018 sell-off', '2018-09-20', '2018-12-24'], ['Covid crash', '2020-02-19', '2020-03-23'], ['2022 rates shock', '2022-01-03', '2022-10-12']];
function renderModelStress(c) {
  const o = mpLoad(), b = htmlBody(c), rows = o.rows.filter(([id, w]) => w > 0), tot = rows.reduce((a, [, w]) => a + w, 0); if (!tot) { b.append(el('div', { class: 'empty', text: 'Add weights first.' })); return; }
  const lab = id => (MP_ASSETS.find(x => x[0] === id) || [, id])[1].replace(/ \(.*\)$/, '');
  const ret = (id, a, z) => { if (id === 'CASH') { const cr = CASH_RATE[o.ccy], r = has(cr) ? asOf(S[cr], a) : null; return r ? r.v * (z - a) / (365.25 * DAY) : 0; }
    if (!has(id)) return null; const s2 = inCcy(id, o.ccy), p = asOf(s2, a), q = asOf(s2, z); return p && q && p.t >= a - 10 * DAY ? (q.v / p.v - 1) * 100 : null; };
  const heads = ['Episode', 'Portfolio', ...rows.map(([id]) => lab(id))], tb = el('tbody'), csv = [heads];
  for (const [name, f, t] of MP_EPISODES) {
    const a = dayMs(f), z = dayMs(t), rs = rows.map(([id]) => ret(id, a, z)), known = rows.map(([, w], i) => rs[i] == null ? 0 : w).reduce((x, y) => x + y, 0);
    const port = known >= tot * 0.8 ? rows.reduce((acc, [, w], i) => acc + (rs[i] == null ? 0 : w / known * rs[i]), 0) : null;
    tb.append(el('tr', { class: 'row', title: `${f} to ${t}` }, el('td', { class: 'l', text: name }), el('td', { class: 'num strong ' + (port == null ? '' : port < 0 ? 'dn' : 'up'), text: port == null ? '–' : pctF1(port) }),
      ...rs.map(v => el('td', { class: 'num ' + (v == null ? 'muted' : v < 0 ? 'dn' : 'up'), text: v == null ? '–' : pctF1(v) }))));
    csv.push([name, port, ...rs]);
  }
  // contribution to risk over the last 3 years (weekly returns)
  const fr = []; for (let t = state.latest - 3 * 365 * DAY; t <= state.latest; t += 7 * DAY) fr.push(t);
  const R = rows.map(([id]) => fr.slice(1).map((t, k) => { if (id === 'CASH') return 0; if (!has(id)) return 0; const s2 = inCcy(id, o.ccy), p = asOf(s2, fr[k]), q = asOf(s2, t); return p && q ? q.v / p.v - 1 : 0; }));
  const W = rows.map(([, w]) => w / tot), n = R[0].length, mu = R.map(r => r.reduce((x, y) => x + y, 0) / n);
  const cov = (i, j) => R[i].reduce((acc, x, k) => acc + (x - mu[i]) * (R[j][k] - mu[j]), 0) / (n - 1);
  const sw = W.map((_, i) => W.reduce((acc, wj, j) => acc + wj * cov(i, j), 0)), varP = W.reduce((acc, wi, i) => acc + wi * sw[i], 0);
  tb.append(el('tr', { class: 'grp' }, el('td', { colspan: heads.length, text: 'Share of portfolio risk (last 3 years, weekly)' })));
  tb.append(el('tr', { class: 'row' }, el('td', { class: 'l', text: 'Contribution to risk' }), el('td', { class: 'num', text: varP > 0 ? fmtNum(Math.sqrt(varP * 52) * 100, 1) + '% vol' : '–' }),
    ...W.map((w, i) => el('td', { class: 'num strong', text: varP > 0 ? fmtNum(w * sw[i] / varP * 100, 0) + '%' : '–', title: `weight ${fmtNum(w * 100, 0)}%` }))));
  csv.push(['Contribution to risk %', '', ...W.map((w, i) => varP > 0 ? w * sw[i] / varP * 100 : '')]);
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i ? '' : 'l' })))), tb)));
  c.csv = csv;
  setNote(c, `How today’s weights would have done in six past sell-offs (peak to trough of world equities, in ${o.ccy}, no rebalancing inside the episode) and which holdings carry the risk now. A holding with a small weight but a large share of risk is where the portfolio’s swings come from. – = no price history for that period (the portfolio figure needs 80% of the weight covered).`);
  setSource(c, 'Your weights; Yahoo Finance, FRED, Bank Negara, MAS; calculated');
}
function buildModelStress(g) {
  makeCard(g, { key: 'idea_stress', title: 'Stress test and risk', wide: true, range: false, render: renderModelStress });
  const r = cards.idea_stress.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; r.hidden = true;
}

// ------------------------------------------------------------------ WP48. Credit cycle (Stress & Signposts → Credit cycle)
function renderCcStd(c) {
  if (!has('SLOOS_CI', 'HY_OAS')) return setEmpty(c, 'Waiting for data.');
  drawPair(c, { name: 'Banks tightening business-lending standards, net %', data: pts(S.SLOOS_CI, state.from, state.to) }, { name: 'US high-yield spread, %', data: pts(S.HY_OAS, state.from, state.to) },
    { fmtA: v => fmtNum(v, 1) + '%', fmtB: v => fmtNum(v, 2) + '%', axisA: v => fmtNum(v, 0) + '%', axisB: v => fmtNum(v, 1) + '%', zeroA: true });
  const a = asOf(S.SLOOS_CI, state.to), cc = has('SLOOS_CC') ? asOf(S.SLOOS_CC, state.to) : null;
  setNote(c, `${a ? fmtNum(a.v, 1) + '% of banks net are tightening business-lending standards' : ''}${cc ? ` (credit cards: ${fmtNum(cc.v, 1)}%)` : ''}, ${monthLab(a.t)}. Tighter standards have tended to come before wider credit spreads and defaults; above 20% has preceded every recession since 1990. Quarterly survey (Fed SLOOS).`);
  setSource(c, 'Federal Reserve SLOOS via FRED (DRTSCILM, DRTSCLCC); ICE BofA via FRED');
}
function renderCcDelinq(c) {
  const ids = ['DELINQ_ALL', 'DELINQ_BUS', 'DELINQ_CC'].filter(id => has(id)); if (!ids.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, ids.map(id => ({ name: S[id].label, data: pts(S[id], state.from, state.to) })), { fmt: v => fmtNum(v, 2) + '%', axisFmt: v => fmtNum(v, 0) + '%', areas: recessionAreas(state.from, state.to), endLabels: false });
  const a = asOf(S[ids[0]], state.to), b = asOf(S[ids[0]], addMonths(a.t, -12));
  setNote(c, `All bank loans ${fmtNum(a.v, 2)}% delinquent (${monthLab(a.t)}), ${b ? (a.v > b.v ? 'up' : 'down') + ' from ' + fmtNum(b.v, 2) + '% a year earlier' : ''}. Delinquencies rise late in the cycle; credit cards turn first.`);
  setSource(c, 'Federal Reserve via FRED (DRALACBS, DRBLACBS, DRCCLACBS), quarterly');
}
function renderCcCcc(c) {
  if (!has('CCC_OAS', 'BB_OAS')) return setEmpty(c, 'Waiting for data.');
  const s2 = combine(S.CCC_OAS, S.BB_OAS, (a, b) => (a - b) * 100, { label: 'CCC − BB spread' }, 5 * DAY), q = pctRank(s2, state.latest, 10);
  drawLines(c, [{ name: 'CCC & lower minus BB spread, bp', data: pts(s2, state.from, state.to) }], { fmt: v => fmtNum(v, 0) + 'bp', axisFmt: v => fmtNum(v, 0), areas: recessionAreas(state.from, state.to) });
  setNote(c, `${q ? fmtNum(q.v, 0) + 'bp, ' + ordF(q.p) + ' percentile of 10 years' : ''}. The gap between the weakest and the best junk bonds: it widens first when lenders start to worry about defaults.`);
  setSource(c, 'ICE BofA via FRED (archived by this dashboard); calculated');
}
function renderCcCredit(c) {
  const L = []; if (has('BANK_CREDIT')) L.push({ name: 'Bank credit, % YoY', data: pts(yoyOf('BANK_CREDIT', 52), state.from, state.to) });
  if (has('CI_LOANS')) L.push({ name: 'Business (C&I) loans, % YoY', data: pts(yoyOf('CI_LOANS', 12), state.from, state.to) });
  if (!L.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, L, { fmt: v => pctF1(v), axisFmt: v => fmtNum(v, 0) + '%', zero: true, areas: recessionAreas(state.from, state.to), endLabels: false });
  setNote(c, 'Growth of credit from US commercial banks. Lending usually slows before and through downturns as standards tighten.');
  setSource(c, 'Federal Reserve H.8 via FRED (TOTBKCR weekly, BUSLOANS monthly)');
}

// ------------------------------------------------------------------ WP49. Gold (Markets → Gold)
function renderGoldReal(c) {
  if (!has('GOLD', 'REAL10Y')) return setEmpty(c, 'Waiting for data.');
  drawPair(c, { name: 'Gold, USD/oz', data: pts(S.GOLD, state.from, state.to) }, { name: 'US 10Y real yield (TIPS), %', data: pts(S.REAL10Y, state.from, state.to) },
    { fmtA: v => fmtNum(v, 0), fmtB: v => fmtNum(v, 2) + '%', axisA: v => fmtNum(v, 0), axisB: v => fmtNum(v, 1) + '%' });
  const r = typeof corrW === 'function' ? corrW(S.GOLD, S.REAL10Y, state.from, state.to) : null;
  setNote(c, `For years gold moved against the real yield (what bonds pay after inflation): the lower it, the cheaper it is to hold a metal that pays nothing. Central-bank buying has weakened that link since 2022.${r != null ? ` Correlation of weekly changes over this range: ${r >= 0 ? '+' : '−'}${fmtNum(Math.abs(r), 2)}.` : ''}`);
  setSource(c, 'Yahoo Finance (GC=F); FRED (DFII10)');
}
function renderGoldDxy(c) {
  if (!has('GOLD', 'DXY')) return setEmpty(c, 'Waiting for data.');
  drawPair(c, { name: 'Gold, USD/oz', data: pts(S.GOLD, state.from, state.to) }, { name: 'US dollar index', data: pts(S.DXY, state.from, state.to) },
    { fmtA: v => fmtNum(v, 0), fmtB: v => fmtNum(v, 1), axisA: v => fmtNum(v, 0), axisB: v => fmtNum(v, 0) });
  setNote(c, 'Gold is priced in dollars, so a weaker dollar usually lifts it.');
  setSource(c, 'Yahoo Finance');
}
function renderGoldCcy(c) {
  if (!has('GOLD')) return setEmpty(c, 'Waiting for data.');
  const L = [['USD', 'Gold in US dollars'], ['MYR', 'Gold in ringgit'], ['SGD', 'Gold in Singapore dollars']].map(([ccy, n]) => ({ name: n, data: rebase(inCcy('GOLD', ccy), state.from, state.to) })).filter(x => x.data.length);
  drawLines(c, L, { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0), hlines: [{ y: 100 }] });
  const r = id => { const s2 = inCcy('GOLD', id), a = asOf(s2, state.to), b = asOf(s2, state.from); return a && b ? pctF1((a.v / b.v - 1) * 100) : '–'; };
  setNote(c, `Over this range: ${r('USD')} in US dollars, ${r('MYR')} in ringgit, ${r('SGD')} in Singapore dollars. For a Malaysian client the ringgit line is the one that counts.`);
  setSource(c, 'Yahoo Finance; converted at daily FX');
}
function renderGoldRatio(c) {
  if (!has('GOLD', 'SILVER')) return setEmpty(c, 'Waiting for data.');
  const r = combine(S.GOLD, S.SILVER, (a, b) => a / b, { label: 'Gold ÷ silver' }, 4 * DAY), q = pctRank(r, state.latest, 10);
  drawLines(c, [{ name: 'Gold ÷ silver (ounces of silver per ounce of gold)', data: pts(r, state.from, state.to) }], { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0) });
  setNote(c, `${q ? fmtNum(q.v, 1) + ', ' + ordF(q.p) + ' percentile of 10 years' : ''}. A high ratio = silver cheap against gold; it tends to fall when industry and risk appetite recover.`);
  setSource(c, 'Yahoo Finance; calculated');
}
function renderGoldVol(c) {
  if (!has('SP_GVZ')) return setEmpty(c, 'Waiting for data.');
  const g = typeof spU === 'function' ? spU('GOLD') : null, M = SPD && SPD._meta, i1 = M ? M.mny.indexOf(1) : -1;
  drawLines(c, [{ name: 'Gold implied volatility (Cboe GVZ)', data: pts(S.SP_GVZ, state.from, state.to) }], { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0) });
  const q = pctRank(S.SP_GVZ, state.latest, 10), term = g && g.surf && i1 >= 0 ? ['1M', '3M', '6M', '1Y'].map((l, i) => `${l} ${fmtNum(g.surf[i][i1] * 100, 1)}%`).join(', ') : '';
  setNote(c, `Gold volatility at its ${q ? ordF(q.p) : '–'} percentile of 10 years. Higher = gold-linked ELNs and DCIs pay more (see Structured products).${term ? ` Implied vol by tenor (GLD options): ${term}.` : ''}`);
  setSource(c, 'Cboe (GVZ, GLD options)');
}

// ------------------------------------------------------------------ WP50. Country ETFs: yields and money flows (Asia ex-Japan → Across Asia)
let ETFS = null, etfLoading = null;
function loadEtfs() {
  if (!etfLoading) etfLoading = loadJSON('data/etfs.json').then(d => { ETFS = d;
    for (const [id, x] of Object.entries(d)) if (id.startsWith('ETF_') && x && x.d) { S[id] = { id, ...x, t: x.d.map(v => v * DAY), v: x.v }; delete S[id].d; } return d; }).catch(() => { ETFS = { funds: {} }; return ETFS; });
  return etfLoading;
}
function etfFlow(t, days) {   // USD flowing in (+) or out (−) over the last `days`: change in shares × NAV each day
  const sh = S['ETF_SH_' + t], nav = S['ETF_NAV_' + t]; if (!sh || sh.t.length < 2) return null;
  const end = sh.t[sh.t.length - 1], from = end - days * DAY; if (sh.t[0] > from + 2 * DAY) return null;
  let f = 0; for (let i = 1; i < sh.t.length; i++) if (sh.t[i] > from) { const n = asOf(nav, sh.t[i]); f += (sh.v[i] - sh.v[i - 1]) * (n ? n.v : 0); }
  return f;
}
function renderEtfFlows(c) {
  const b = htmlBody(c); if (!ETFS) { loadEtfs().then(() => c.render()); b.append(el('div', { class: 'empty', text: 'Loading…' })); return; }
  const F = ETFS.funds || {}; if (!Object.keys(F).length) { b.append(el('div', { class: 'empty', text: 'Fund data arrives with the next data run.' })); return; }
  const heads = ['Fund', 'Market', 'NAV', '12M yield', 'Net assets', 'Flow 1W', 'Flow 1M', 'Flow 3M'], tb = el('tbody'), csv = [heads];
  const fm = (v, a) => v == null ? '–' : `${sign(v)}$${fmtNum(Math.abs(v) / 1e6, 0)}m (${sign(v)}${fmtNum(Math.abs(v) / a * 100, 1)}%)`;
  for (const [t, x] of Object.entries(F)) {
    const fl = [7, 31, 92].map(d => etfFlow(t, d));
    tb.append(el('tr', { class: 'row' }, el('td', { class: 'l', text: t }), el('td', { class: 'l', text: x.name }), el('td', { class: 'num', text: fmtNum(x.nav, 2) }),
      el('td', { class: 'num', text: x.yield != null ? fmtNum(x.yield, 2) + '%' : '–', title: x.yield_date ? 'as of ' + x.yield_date : '' }), el('td', { class: 'num', text: '$' + fmtNum(x.assets / 1e9, 2) + 'bn' }),
      ...fl.map(v => el('td', { class: 'num ' + (v == null ? 'muted' : v > 0 ? 'up' : v < 0 ? 'dn' : ''), text: fm(v, x.assets) }))));
    csv.push([t, x.name, x.nav, x.yield, x.assets, ...fl]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i < 2 ? 'l' : '' })))), tb)));
  c.csv = csv;
  setNote(c, `Money moving into or out of the main US-listed country funds (shares created or redeemed × NAV): a partial stand-in for foreign flows into each market. The dashboard started recording on ${ETFS._meta && ETFS._meta.since ? ETFS._meta.since : '12 Nov 2026'}, so flows fill in over the coming weeks; – = not enough days yet. 12M yield = trailing distribution yield.`);
  setSource(c, 'iShares fund pages (NAV, yield, net assets, shares outstanding); calculated');
}

// ------------------------------------------------------------------ build and wiring
const EXTRA_RENDER = { fixed: ['inc_menu', 'inc_chart'], stress: ['cc_std', 'cc_delinq', 'cc_ccc', 'cc_credit'], markets: ['gold_real', 'gold_dxy', 'gold_ccy', 'gold_ratio', 'gold_vol'] };   // pages whose own render function lists its cards: render these too
SUBTABS.fixed.push(['Income menu', ['inc_menu', 'inc_chart']]);
SUBTABS.regime.push(['Playbook', ['pb_chart', 'pb_table', 'pb_events'], 'Leading']);
SUBTABS.asia[0][1].push('etf_flows');   // Asia ex-Japan → Across Asia
SUBTABS.stress.push(['Credit cycle', ['cc_std', 'cc_delinq', 'cc_ccc', 'cc_credit']]);
SUBTABS.markets.push(['Gold', ['gold_ccy', 'gold_real', 'gold_dxy', 'gold_ratio', 'gold_vol']]);
function buildMore() {
  const fi = $('#fiGrid');
  makeCard(fi, { key: 'inc_menu', title: 'Income menu: what pays what', wide: true, range: false, render: renderIncMenu });
  makeCard(fi, { key: 'inc_chart', title: 'Yields over time', wide: true, defaultRange: '3Y', seg: { key: 'incIds', options: [['core', 'Bonds & credit'], ['cash', 'Cash']] }, render: renderIncChart });
  const r = cards.inc_menu.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true;
  const rg = $('#regGrid');
  makeCard(rg, { key: 'pb_chart', title: 'Playbook: around past events', wide: true, range: false, seg: { key: 'pbEvent', select: true, label: 'Event', options: Object.entries(PB_EVENTS).map(([k, v]) => [k, v[0]]) },
    render: c => { renderPbChart(c); cards.pb_table && cards.pb_table.render(); cards.pb_events && cards.pb_events.render(); } });
  makeCard(rg, { key: 'pb_table', title: 'What followed, by asset', range: false, render: renderPbTable });
  makeCard(rg, { key: 'pb_events', title: 'The events', range: false, render: renderPbEvents });
  for (const k of ['pb_table', 'pb_events']) { const x = cards[k].root; x.querySelector('[title^="Focus"]').hidden = true; x.querySelector('[title^="Download chart as"]').hidden = true; }
  const sg = $('#stGrid');
  makeCard(sg, { key: 'cc_std', title: 'Lending standards vs credit spreads', wide: true, defaultRange: 'MAX', render: renderCcStd });
  makeCard(sg, { key: 'cc_delinq', title: 'Loan delinquencies', defaultRange: 'MAX', render: renderCcDelinq });
  makeCard(sg, { key: 'cc_ccc', title: 'Weakest vs best junk bonds', defaultRange: '10Y', render: renderCcCcc });
  makeCard(sg, { key: 'cc_credit', title: 'Bank credit growth', wide: true, defaultRange: '10Y', render: renderCcCredit });
  makeCard($('#asiaGrid'), { key: 'etf_flows', title: 'Country funds: yields and flows', wide: true, range: false, render: renderEtfFlows });
  { const x = cards.etf_flows.root; x.querySelector('[title^="Focus"]').hidden = true; x.querySelector('[title^="Download chart as"]').hidden = true; }
  const mg = el('div', { class: 'grid', id: 'goldGrid' }); $('#tab-markets').append(mg);
  makeCard(mg, { key: 'gold_ccy', title: 'Gold in USD, ringgit and SGD', wide: true, defaultRange: '3Y', render: renderGoldCcy });
  makeCard(mg, { key: 'gold_real', title: 'Gold vs the real yield', defaultRange: '10Y', render: renderGoldReal });
  makeCard(mg, { key: 'gold_dxy', title: 'Gold vs the US dollar', defaultRange: '3Y', render: renderGoldDxy });
  makeCard(mg, { key: 'gold_ratio', title: 'Gold ÷ silver', defaultRange: '10Y', render: renderGoldRatio });
  makeCard(mg, { key: 'gold_vol', title: 'Gold volatility', defaultRange: '10Y', render: renderGoldVol });
}
