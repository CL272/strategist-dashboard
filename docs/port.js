// ------------------------------------------------------------------ ALLOCATION → PORTFOLIO (Design plan 4, Step 3; owner's approval 25 Nov 2026)
// Saved portfolios, each with its own benchmark (presets such as 60/40 world, or custom), and the tracking error between
// them with each holding's share of it. Prices: weekly closes with dividends (data/funds.json, pipeline/funds.py), plus the
// dashboard's own index series (no dividends) and cash at the short rate, converted to the portfolio's currency. The maths
// is in port-model.js (PM), checked by tools/port-check.js. Portfolios are the owner's: stored only through pstore() (the
// private vault once it is set up) under sd-ports-v1. History, not a forecast; never a recommendation.
'use strict';

const PO_KEY = 'sd-ports-v1', PO_MODEL_KEY = 'sd-model-v1';   // sd-model-v1: the old model portfolio, read once and left untouched
const PO_WIN = [['1Y', 1], ['3Y', 3], ['5Y', 5], ['Max', 0]];
const PO_CCY = ['MYR', 'SGD', 'USD'];
const PO_CASH_RATE = { MYR: 'MY_OPR', SGD: 'SORA3M', USD: 'UST3M' };
const PO_CLASSES = ['Equities', 'Bonds', 'Cash', 'Gold', 'Property', 'Other'];
const PO_THIN = 0.08;   // price unchanged in more than 8% of the last three years' weeks: "thinly traded"
// benchmark presets; the world mixes use global aggregate bonds hedged to the dollar (owner's decision 3, 25 Nov 2026)
const PO_BENCH = [
  ['6040', '60/40 world', [['ACWI', 60], ['AGGU.L', 40]]], ['7030', '70/30', [['ACWI', 70], ['AGGU.L', 30]]],
  ['5050', '50/50', [['ACWI', 50], ['AGGU.L', 50]]], ['4060', '40/60', [['ACWI', 40], ['AGGU.L', 60]]],
  ['eq', 'World equities', [['ACWI', 100]]], ['my6040', 'Malaysia 60/40', [['IX:KLCI', 60], ['0800EA.KL', 40]]],
];
const PO_START = [['blank', 'Blank'], ['mybal', 'Malaysian balanced', [['IX:KLCI', 35], ['AAXJ', 15], ['ACWI', 15], ['IEF', 20], ['IX:GOLD', 5], ['CASH', 10]]],
  ['6040', '60/40 world', [['ACWI', 60], ['AGGU.L', 40]]], ['copy', 'A copy of the open portfolio']];
// the dashboard's own series the old model portfolio used (index levels, no dividends)
const PO_INDEX = [['IX:SPX', 'SPX', 'S&P 500 index (no dividends)', 'Equities'], ['IX:KLCI', 'KLCI', 'FBM KLCI index (no dividends)', 'Equities'],
  ['IX:STI', 'STI', 'Straits Times index (no dividends)', 'Equities'], ['IX:GOLD', 'GOLD', 'Gold (spot price)', 'Gold'], ['IX:BTC', 'BTC', 'Bitcoin', 'Other']];
const PO_FROM_MODEL = { ACWI: 'ACWI', SPX: 'IX:SPX', AAXJ: 'AAXJ', EEM: 'EEM', KLCI: 'IX:KLCI', STI: 'IX:STI', IEF: 'IEF', TLT: 'TLT', LQD: 'LQD',
  HYG: 'HYG', EMB: 'EMB', GOLD: 'IX:GOLD', BTC: 'IX:BTC', CASH: 'CASH' };
const PO_CARDS = ['idea_model', 'po_bench', 'idea_modelchart', 'po_src', 'idea_stress'];
const PO_EPISODES = [['Global financial crisis', '2007-10-09', '2009-03-09'], ['Taper tantrum', '2013-05-21', '2013-06-24'], ['China devaluation', '2015-08-10', '2016-02-11'],
  ['Late-2018 sell-off', '2018-09-20', '2018-12-24'], ['Covid crash', '2020-02-19', '2020-03-23'], ['2022 rates shock', '2022-01-03', '2022-10-12']];
state.poView = 'value';

// ---- data: funds.json, loaded when a portfolio sub-tab opens
let FUNDS = null, fundsLoading = null;
function loadFunds() {
  return fundsLoading || (fundsLoading = loadJSON('data/funds.json').then(d => { FUNDS = d && d.funds ? d : { funds: {}, _meta: {} }; poCache.clear(); poBlocksMemo = null; return FUNDS; })
    .catch(() => { FUNDS = { funds: {}, _meta: { failed: ['all'] } }; return FUNDS; }));
}
let poBlocksMemo = null;
function poBlocks() {   // every building block: id -> { id, label, name, cls, ccy, kind: fund | index | cash, thin, s }
  if (poBlocksMemo) return poBlocksMemo;
  const B = {};
  for (const [id, x] of Object.entries((FUNDS && FUNDS.funds) || {}))
    B[id] = { id, label: x.short || x.name || id, name: x.name || '', cls: x.cls || 'Other', ccy: x.ccy, kind: 'fund', thin: x.thin || 0, src: x.src, s: { id: 'F_' + id, label: x.short || id, t: x.d.map(d => d * DAY), v: x.v } };
  for (const [id, sid, label, cls] of PO_INDEX) if (has(sid)) B[id] = { id, label, name: S[sid].label, cls, ccy: LOCAL_CCY[sid] || 'USD', kind: 'index', thin: 0, s: S[sid] };
  B.CASH = { id: 'CASH', label: 'Cash (short rate in the portfolio currency)', name: '', cls: 'Cash', ccy: null, kind: 'cash', thin: 0 };
  if (FUNDS) poBlocksMemo = B;
  return B;
}
const poLabel = id => { const b = poBlocks()[id]; return b ? b.label : id.replace(/^IX:/, '') + ' (no data)'; };
const poTick = id => id === 'CASH' ? 'cash' : id.replace(/^IX:/, '');
const poClass = id => { const c = (poBlocks()[id] || {}).cls || 'Other'; return c === 'Cash-like' ? 'Cash' : PO_CLASSES.includes(c) ? c : 'Other'; };
const poCache = new Map();
function poSeries(id, base) {   // the block's price in the portfolio currency ({t, v}); cash accrues the short rate week by week
  const key = id + '|' + base + '|' + state.latest; if (poCache.has(key)) return poCache.get(key);
  const b = poBlocks()[id]; let out = null;
  if (b && b.kind === 'cash') {
    const rid = PO_CASH_RATE[base]; if (has(rid)) { const r = S[rid], t = [], v = []; let x = 100;
      for (let f = lastFriday(Math.max(r.t[0], Date.UTC(2005, 0, 7))); f <= state.latest + 6 * DAY; f += 7 * DAY) { const a = asOf(r, f); if (!a) continue; t.push(Math.min(f, state.latest)); v.push(x); x *= 1 + a.v / 100 * 7 / 365; }
      out = { id: 'CASH_' + base, label: `Cash (${rid})`, t, v }; }
  } else if (b && b.s) {
    if (b.ccy === base) out = b.s;
    else { const t = [], v = []; for (let i = 0; i < b.s.t.length; i++) { const a = usdPerUnit(b.ccy, b.s.t[i]), c = usdPerUnit(base, b.s.t[i]); if (a != null && c != null) { t.push(b.s.t[i]); v.push(b.s.v[i] * a / c); } }
      out = t.length > 20 ? { id: b.s.id + '@' + base, label: b.label, t, v } : null; }
  }
  poCache.set(key, out); return out;
}

// ---- the owner's portfolios (sd-ports-v1 through pstore(): encrypted once the vault is set up)
const poLocked = () => typeof vaultOn === 'function' && vaultOn() && !vaultOpen();
const poId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function poNew(name, rows, ccy = 'MYR') {
  return { id: poId(), name, ccy, win: '3Y', rows: rows.map(r => r.slice()), bench: { preset: '6040', rows: PO_BENCH[0][2].map(r => r.slice()) }, updated: new Date().toISOString() };
}
function poFromModel() {   // the first portfolio: the old model portfolio's blocks and weights, or the Malaysian balanced preset
  let m = null; try { m = JSON.parse(pstore().getItem(PO_MODEL_KEY) || 'null'); } catch (e) { m = null; }
  if (m && Array.isArray(m.rows) && m.rows.length) return poNew('My model portfolio', m.rows.map(([id, w]) => [PO_FROM_MODEL[id] || id, +w || 0]), PO_CCY.includes(m.ccy) ? m.ccy : 'MYR');
  return poNew('Malaysian balanced', PO_START[1][2]);
}
function poSave(o) { try { pstore().setItem(PO_KEY, JSON.stringify(o)); return true; } catch (e) { return false; } }
function poStore() {   // { v, sel, ports }, or null while the vault is locked (never default weights in place of the owner's)
  if (poLocked()) return null;
  let o = null; try { o = JSON.parse(pstore().getItem(PO_KEY) || 'null'); } catch (e) { o = null; }
  if (!o || !Array.isArray(o.ports) || !o.ports.length) { const p = poFromModel(); o = { v: 1, sel: p.id, ports: [p] }; poSave(o); }
  if (!o.ports.some(p => p.id === o.sel)) o.sel = o.ports[0].id;
  return o;
}
const poCur = () => { const o = poStore(); return o ? o.ports.find(p => p.id === o.sel) : null; };
function poMutate(fn) { const o = poStore(); if (!o) { if (typeof vaultAsk === 'function') vaultAsk(); return; } fn(o); poSave(o); poRefresh(); }
function poEdit(fn) { poMutate(o => { const p = o.ports.find(x => x.id === o.sel); fn(p, o); p.updated = new Date().toISOString(); }); }
function poRefresh() {
  state.poRes = null;
  PO_CARDS.forEach(k => cards[k] && cards[k].render());
  if (typeof PO_CARDS_ADD !== 'undefined') PO_CARDS_ADD.forEach(k => cards[k] && cards[k].render());
  poHook(); fitTiles('alloc');
}
const poWhenLoaded = () => { if (state.tab === 'alloc') poRefresh(); };

// ---- the numbers: the open portfolio against its benchmark over its window (cached until anything changes)
function poCompute() {
  const p = poCur(); if (!p) return { locked: true };
  if (!FUNDS) return { loading: true, p };
  const key = JSON.stringify([p.id, p.rows, p.bench.rows, p.ccy, p.win, state.latest]);
  if (state.poRes && state.poRes.key === key) return state.poRes;
  const wObj = {}, bObj = {}; for (const [id, w] of p.rows) if (+w > 0) wObj[id] = (wObj[id] || 0) + +w; for (const [id, w] of p.bench.rows) if (+w > 0) bObj[id] = (bObj[id] || 0) + +w;
  const ids = [...new Set([...Object.keys(wObj), ...Object.keys(bObj)])], missing = ids.filter(id => !poSeries(id, p.ccy)), use = ids.filter(id => !missing.includes(id));
  const yrs = (PO_WIN.find(x => x[0] === p.win) || PO_WIN[1])[1], from = yrs ? addMonths(state.latest, -12 * yrs) : -Infinity;
  const R = { key, p, ids: use, missing, wObj, bObj, yrs, from };
  if (!Object.keys(wObj).length) return (state.poRes = { ...R, reason: 'Add a holding to see the tracking error.' });
  if (!Object.keys(bObj).length) return (state.poRes = { ...R, reason: 'Pick a benchmark to compare with.' });
  const A = PM.pmAlign(use.map(id => poSeries(id, p.ccy)), from);
  let k = -1, f = yrs ? from + 21 * DAY : -Infinity; A.first.forEach((t, i) => { if (t != null && t > f) { f = t; k = i; } });   // the holding whose history cuts the window
  const limit = k >= 0 ? { id: use[k], t: A.first[k] } : null;
  const st = A.n >= 52 ? PM.pmStats(A, PM.pmVec(use, wObj), PM.pmVec(use, bObj)) : null;
  const reason = st ? null : `Only ${A.n} weeks that every holding and the benchmark share${limit ? ` (${poLabel(limit.id)} starts in ${monthLab(limit.t)})` : ''}; at least 52 are needed. Try a longer window or another fund.`;
  return (state.poRes = { ...R, A, st, limit, reason });
}
const poBenchName = p => p.bench.preset === 'custom' ? 'Custom benchmark' : ((PO_BENCH.find(b => b[0] === p.bench.preset) || [])[1] || 'Benchmark');
const poScaled = (rows) => { const t = rows.reduce((s, [, w]) => s + Math.max(0, +w || 0), 0); return id => { const r = rows.find(x => x[0] === id); return t > 0 && r ? Math.max(0, +r[1] || 0) / t * 100 : 0; }; };
const poPct = (v, d = 1) => { if (v == null) return '–'; const r = Math.round(Math.abs(v) * 10 ** d) / 10 ** d; return `${v < 0 && r > 0 ? '−' : ''}${fmtNum(r, d)}%`; };
const poPts = v => { const r = Math.round(Math.abs(v) * 10) / 10; return `${r && v > 0 ? '+' : r && v < 0 ? '−' : ''}${fmtNum(r, r % 1 ? 1 : 0)}`; };   // points, one decimal only when needed
const poThinIds = ids => ids.filter(id => (poBlocks()[id] || {}).thin > PO_THIN);
const poThinNote = ids => { const t = poThinIds(ids); return t.length ? ` ⚑ ${t.map(poTick).join(', ')} ${t.length > 1 ? 'are' : 'is'} thinly traded (price unchanged in many weeks), so the volatility and tracking error ${t.length > 1 ? 'they add' : 'it adds'} may be understated.` : ''; };
const PO_SRC = 'Prices: Yahoo Finance (weekly closes with dividends; index levels without); cash: Bank Negara, MAS, US Treasury short rates; calculated';

// ---- a search box for adding a building block (the list floats under the box)
function poSearch(placeholder, onPick, exclude = []) {
  const wrap = el('div', { class: 'po-find' }), inp = el('input', { type: 'search', class: 'perf-search', placeholder, 'aria-label': placeholder }), list = el('div', { class: 'po-sugg', hidden: true });
  const find = q => { q = q.trim().toLowerCase(); if (!q) return [];
    return Object.values(poBlocks()).filter(b => !exclude.includes(b.id) && [b.id, b.label, b.name, b.cls].join(' ').toLowerCase().includes(q))
      .sort((a, b) => (poTick(a.id).toLowerCase().startsWith(q) ? 0 : 1) - (poTick(b.id).toLowerCase().startsWith(q) ? 0 : 1) || a.label.localeCompare(b.label)).slice(0, 8); };
  const show = () => { const L = find(inp.value);
    list.replaceChildren(...L.map(b => el('button', { type: 'button', onmousedown: e => { e.preventDefault(); onPick(b.id); } }, el('b', { text: poTick(b.id) }), ' ' + b.label, el('span', { class: 'muted', text: ' · ' + b.cls }))));
    if (!L.length && inp.value.trim()) list.append(el('div', { class: 'muted small', text: 'No fund matches. Add its ticker to watchlist.txt; it appears after the next daily refresh.' }));
    list.hidden = !inp.value.trim(); };
  inp.addEventListener('input', show);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { const L = find(inp.value); if (L[0]) onPick(L[0].id); } else if (e.key === 'Escape') { inp.value = ''; list.hidden = true; } });
  inp.addEventListener('blur', () => setTimeout(() => { list.hidden = true; }, 150));
  wrap.append(inp, list); return wrap;
}
function poWeightInput(v, onSet, label) {
  const i = el('input', { type: 'number', min: 0, step: 'any', value: +(+v).toFixed(4), class: 'mp-w', 'aria-label': label });
  i.addEventListener('change', () => onSet(Math.max(0, +i.value || 0))); i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); });
  return i;
}
const poFocus = (c, id) => setTimeout(() => { const x = c.root.querySelector(`input[data-id="${CSS.escape(id)}"]`); if (x) { x.focus(); x.select(); } }, 30);
function poEmpty(c, msg) { const hb = c.root.querySelector('.html-body'); if (hb) hb.replaceChildren(); setEmpty(c, msg); }   // an HTML card's last table goes too
const poWait = c => { if (typeof vaultLockedCard === 'function' && vaultLockedCard(c)) return true; if (!FUNDS) { loadFunds().then(poWhenLoaded); poEmpty(c, 'Loading fund prices…'); return true; } return false; };

// ---- cards
function renderPbHold(c) {   // key idea_model (kept from the old Model portfolio card)
  if (poWait(c)) return;
  const R = poCompute(), p = R.p, b = htmlBody(c), sw = poScaled(p.rows), sb = poScaled(p.bench.rows), tot = p.rows.reduce((s, [, w]) => s + Math.max(0, +w || 0), 0);
  const tb = el('tbody'), amounts = Math.abs(tot - 100) > 0.01;
  for (const [id, w] of p.rows) {
    const thin = (poBlocks()[id] || {}).thin > PO_THIN, act = sw(id) - sb(id), inp = poWeightInput(w, v => poEdit(q => { const r = q.rows.find(x => x[0] === id); if (r) r[1] = v; }), `Weight of ${poLabel(id)}`);
    inp.dataset.id = id;
    tb.append(el('tr', { class: 'row' },
      el('td', { class: 'l' }, poLabel(id), el('span', { class: 'cell-sub' }, `${poTick(id)} · ${(poBlocks()[id] || {}).cls || '–'}`, thin ? el('span', { class: 'po-thin', title: `Price unchanged in ${fmtNum(poBlocks()[id].thin * 100, 0)}% of the last three years' weeks`, text: 'thinly traded' }) : '')),
      el('td', { class: 'num' }, inp, amounts ? el('span', { class: 'po-scaled muted', text: poPct(sw(id), 0) }) : ''),
      el('td', { class: 'num muted', text: sb(id) ? fmtNum(sb(id), 0) : '–' }),
      el('td', { class: 'num ' + (act > 0.05 ? 'up' : act < -0.05 ? 'dn' : 'muted'), text: poPts(act) }),
      el('td', {}, el('button', { type: 'button', class: 'ghost', text: '✕', title: `Remove ${poLabel(id)}`, onclick: () => poEdit(q => { q.rows = q.rows.filter(r => r[0] !== id); }) }))));
  }
  if (!p.rows.length) tb.append(el('tr', {}, el('td', { colspan: 5, class: 'muted', text: 'No holdings yet: add a fund below.' })));
  tb.append(el('tr', { class: 'row po-total' }, el('td', { class: 'l strong', text: 'Total' }), el('td', { class: 'num strong', text: fmtNum(tot, tot % 1 ? 2 : 0) }), el('td', { class: 'num muted', text: '100' }), el('td', {}), el('td', {})));
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, ...['Holding', 'Weight', 'Benchmark', 'Active', ''].map((h, i) => el('th', { class: i ? '' : 'l', text: h })))), tb)),
    poSearch('＋ Add a fund: name or ticker (VWRA, CSPX, AGGU, 0800EA…)', id => poEdit(q => { if (!q.rows.some(r => r[0] === id)) q.rows.push([id, 0]); }) || poFocus(c, id), p.rows.map(r => r[0])),
    el('div', { class: 'card-foot' }, el('span', { text: amounts ? `Weights or amounts: scaled to 100% (shown beside each).` : 'Weights or amounts: scaled to 100%.' }),
      el('a', { href: `https://github.com/${REPO_PATH}/edit/main/watchlist.txt`, target: '_blank', rel: 'noopener', text: 'Not listed? Add it to watchlist.txt →' })));
  setCount(c, `${p.rows.length} holding${p.rows.length === 1 ? '' : 's'}`);
  c.csv = [['Holding', 'Ticker', 'Class', 'Weight entered', 'Weight %', 'Benchmark %', 'Active pts'], ...p.rows.map(([id, w]) => [poLabel(id), poTick(id), poClass(id), w, sw(id).toFixed(2), sb(id).toFixed(2), (sw(id) - sb(id)).toFixed(2)])];
  const thin = poThinNote(p.rows.map(r => r[0]));
  setNote(c, (R.missing && R.missing.length ? `No prices for ${R.missing.map(poTick).join(', ')}: left out of the figures. ` : '') + `Active = the portfolio's weight minus the benchmark's, in points.${thin}`);
  setSource(c, 'Your weights, kept in your private vault once it is set up'); setAsOf(c, R.st ? R.st.to : null);
}
function renderPbBench(c) {
  if (poWait(c)) return;
  const R = poCompute(), p = R.p, b = htmlBody(c), sb = poScaled(p.bench.rows), sw = poScaled(p.rows);
  b.append(el('div', { class: 'seg-chips po-presets' }, ...PO_BENCH.map(([k, lab, rows]) => el('button', { type: 'button', 'aria-selected': String(p.bench.preset === k), text: lab,
    onclick: () => poEdit(q => { q.bench = { preset: k, rows: rows.map(r => r.slice()) }; }) })),
    el('button', { type: 'button', 'aria-selected': String(p.bench.preset === 'custom'), text: 'Custom…', title: 'Edit the rows below', onclick: () => poEdit(q => { q.bench.preset = 'custom'; }) })));
  const tb = el('tbody');
  for (const [id, w] of p.bench.rows) {
    const inp = poWeightInput(w, v => poEdit(q => { const r = q.bench.rows.find(x => x[0] === id); if (r) r[1] = v; q.bench.preset = 'custom'; }), `Benchmark weight of ${poLabel(id)}`); inp.dataset.id = id;
    tb.append(el('tr', { class: 'row' }, el('td', { class: 'l' }, poLabel(id), el('span', { class: 'cell-sub', text: `${poTick(id)} · ${(poBlocks()[id] || {}).cls || '–'}` })), el('td', { class: 'num' }, inp),
      el('td', {}, el('button', { type: 'button', class: 'ghost', text: '✕', title: `Remove ${poLabel(id)} from the benchmark`, onclick: () => poEdit(q => { q.bench.rows = q.bench.rows.filter(r => r[0] !== id); q.bench.preset = 'custom'; }) }))));
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, ...['Benchmark holding', 'Weight', ''].map((h, i) => el('th', { class: i ? '' : 'l', text: h })))), tb)),
    poSearch('＋ Add to the benchmark', id => poEdit(q => { if (!q.bench.rows.some(r => r[0] === id)) q.bench.rows.push([id, 0]); q.bench.preset = 'custom'; }) || poFocus(c, id), p.bench.rows.map(r => r[0])));
  const mix = PO_CLASSES.map(cl => [cl, p.rows.filter(([id]) => poClass(id) === cl).reduce((s, [id]) => s + sw(id), 0), p.bench.rows.filter(([id]) => poClass(id) === cl).reduce((s, [id]) => s + sb(id), 0)]).filter(([, x, y]) => x > 0.05 || y > 0.05);
  b.append(el('h3', { class: 'po-h', text: 'Mix by asset class: portfolio vs benchmark' }), ...mix.map(([cl, x, y]) => el('div', { class: 'po-mix' }, el('span', { class: 'nm', text: cl }),
    el('span', { class: 'bar', title: `Portfolio ${fmtNum(x, 1)}% (bar) · benchmark ${fmtNum(y, 1)}% (line)` }, el('i', { style: `width:${Math.min(100, x)}%` }), el('b', { style: `width:${Math.min(100, y)}%` })),
    el('span', { class: 'v' }, `${fmtNum(x, 0)}% `, el('span', { class: 'muted', text: `vs ${fmtNum(y, 0)}%` })))));
  setCount(c, poBenchName(p));
  c.csv = [['Benchmark holding', 'Ticker', 'Weight %'], ...p.bench.rows.map(([id]) => [poLabel(id), poTick(id), sb(id).toFixed(2)]), [], ['Asset class', 'Portfolio %', 'Benchmark %'], ...mix.map(([cl, x, y]) => [cl, x.toFixed(2), y.toFixed(2)])];
  setNote(c, 'The world mixes hold world equities (iShares MSCI ACWI) and global bonds hedged to the dollar (iShares Global Aggregate, AGGU); pick a preset or edit the rows. Bar = the portfolio, line = the benchmark.');
  setSource(c, 'Your choice of benchmark'); setAsOf(c, R.st ? R.st.to : null);
}
function renderPbChart(c) {   // key idea_modelchart
  if (poWait(c)) return;
  const R = poCompute(), p = R.p; if (!R.st) return poEmpty(c, R.reason || 'Waiting for data.');
  const st = R.st, d = R.A.dates, view = state.poView;
  [state.from, state.to] = [d[0], d[d.length - 1]];
  const lim = R.limit ? ` From ${monthLab(st.from)}: ${poTick(R.limit.id)}'s history starts then.` : '';
  if (view === 'gap') {
    drawLines(c, [{ name: `${p.name} vs ${poBenchName(p)}, cumulative gap`, data: d.map((t, i) => [t, (st.cumP[i] / st.cumB[i] - 1) * 100]) }], { fmt: v => poPct(v, 1), axisFmt: v => fmtNum(v, 0) + '%', zero: true, endLabels: false });
    setNote(c, `Over the window the portfolio ${st.cumP[st.cumP.length - 1] >= st.cumB[st.cumB.length - 1] ? 'gained' : 'lost'} ${fmtNum(Math.abs(st.cumP[st.cumP.length - 1] / st.cumB[st.cumB.length - 1] - 1) * 100, 1)}% against the benchmark in ${p.ccy}.${lim} The line is the portfolio's value divided by the benchmark's, minus one.`);
  } else if (view === 'te') {
    const roll = PM.pmRolling(R.A, PM.pmVec(R.ids, R.wObj), PM.pmVec(R.ids, R.bObj));
    if (!roll.length) return poEmpty(c, 'The rolling tracking error needs more than a year of shared weeks: pick a longer window.');
    [state.from, state.to] = [roll[0][0], roll[roll.length - 1][0]];
    drawLines(c, [{ name: 'Tracking error, past 52 weeks', data: roll }], { fmt: v => poPct(v, 2), axisFmt: v => fmtNum(v, 1) + '%', endLabels: false, hlines: [{ y: +st.te.toFixed(2), label: `whole window ${fmtNum(st.te, 1)}%` }] });
    const lo = roll.reduce((m, x) => x[1] < m[1] ? x : m), hi = roll.reduce((m, x) => x[1] > m[1] ? x : m);
    setNote(c, `Over the 52 weeks to ${nice(roll[roll.length - 1][0])} the tracking error was ${fmtNum(roll[roll.length - 1][1], 1)}%; within the window it ranged from ${fmtNum(lo[1], 1)}% (${monthLab(lo[0])}) to ${fmtNum(hi[1], 1)}% (${monthLab(hi[0])}).${lim}`);
  } else {
    drawLines(c, [{ name: p.name, data: d.map((t, i) => [t, st.cumP[i]]) }, { name: poBenchName(p), data: d.map((t, i) => [t, st.cumB[i]]) }], { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0), hlines: [{ y: 100 }], endLabels: false });
    setNote(c, `The portfolio returned ${poPct(st.retP)} a year in ${p.ccy} against ${poPct(st.retB)} for the benchmark, with ${fmtNum(st.volP / st.volB * 100, 0)}% of its volatility.${lim} Both = 100 at the start and held at their weights (rebalanced weekly), dividends included.`);
  }
  c.csv = [['Week to', 'Portfolio (= 100 at start)', 'Benchmark (= 100 at start)'], ...d.map((t, i) => [iso(t), st.cumP[i].toFixed(3), st.cumB[i].toFixed(3)])];
  setSource(c, PO_SRC); setAsOf(c, st.to);
}
function renderPbSrc(c) {   // where the tracking error comes from
  if (poWait(c)) return;
  const R = poCompute(); if (!R.st) return poEmpty(c, R.reason || 'Waiting for data.');
  const st = R.st, rows = R.ids.map((id, i) => ({ id, act: st.active[i], sh: st.share[i] })).sort((a, b) => b.sh - a.sh);
  const b = htmlBody(c), tb = el('tbody');
  for (const r of rows) tb.append(el('tr', { class: 'row' }, el('td', { class: 'l', text: poLabel(r.id) }),
    el('td', { class: 'num ' + (r.act > 0.05 ? 'up' : r.act < -0.05 ? 'dn' : 'muted'), text: poPts(r.act) }), el('td', { class: 'num strong', text: poPct(r.sh, 0) }),
    el('td', {}, el('span', { class: 'po-share' + (r.sh < 0 ? ' neg' : '') }, el('i', { style: `width:${Math.min(100, Math.abs(r.sh)).toFixed(0)}%` })))));
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, ...['Holding', 'Active weight', 'Share of tracking error', ''].map((h, i) => el('th', { class: i ? '' : 'l', text: h })))), tb)));
  capRows(tb, 'po_src', 12);
  const top = rows[0];
  setCount(c, `${fmtNum(st.te, 1)}% in all`);
  c.csv = [['Holding', 'Ticker', 'Active weight pts', 'Share of tracking error %'], ...rows.map(r => [poLabel(r.id), poTick(r.id), r.act.toFixed(2), r.sh.toFixed(2)])];
  setNote(c, (top ? `${poLabel(top.id)} explains ${fmtNum(top.sh, 0)}% of the tracking error: the portfolio holds ${fmtNum(Math.abs(top.act), 0)} points ${top.act >= 0 ? 'more' : 'less'} of it than the benchmark.` : '')
    + (rows.some(r => r.sh < -0.5) ? ' A negative share offsets part of the rest.' : '') + poThinNote(R.ids)
    + ` Share = the holding's active weight times its covariance with the whole gap, over the tracking error squared; the shares sum to 100%. ${R.yrs ? R.yrs + '-year' : 'Whole'} window, weekly returns.`);
  setSource(c, PO_SRC); setAsOf(c, st.to);
}
function renderPbStress(c) {   // key idea_stress (moved from the old model portfolio, WP47): past sell-offs and where the risk sits
  if (poWait(c)) return;
  const R = poCompute(), p = R.p, rows = p.rows.filter(([, w]) => +w > 0), b = htmlBody(c);
  if (!rows.length) { b.append(el('div', { class: 'empty', text: 'Add weights first.' })); return; }
  const ret = (id, a, z) => {
    if (id === 'CASH') { const r = has(PO_CASH_RATE[p.ccy]) ? asOf(S[PO_CASH_RATE[p.ccy]], a) : null; return r ? r.v * (z - a) / (365.25 * DAY) : null; }
    const s = poSeries(id, p.ccy); if (!s) return null; const x = asOf(s, a), y = asOf(s, z); return x && y && x.t >= a - 10 * DAY && y.t >= z - 10 * DAY ? (y.v / x.v - 1) * 100 : null; };
  const mixRet = (rs, a, z) => { const tot = rs.reduce((s, [, w]) => s + +w, 0); let known = 0, acc = 0; for (const [id, w] of rs) { const r = ret(id, a, z); if (r != null) { known += +w; acc += +w * r; } } return known >= tot * 0.8 ? acc / known : null; };
  const heads = ['Episode', 'Portfolio', 'Benchmark', ...rows.map(([id]) => poTick(id))], tb = el('tbody'), csv = [heads];
  const cell = (v, strong) => el('td', { class: 'num' + (strong ? ' strong' : '') + (v == null ? ' muted' : v < 0 ? ' dn' : ' up'), text: v == null ? '–' : pctF1(v) });
  for (const [name, f, t] of PO_EPISODES) {
    const a = dayMs(f), z = dayMs(t), rs = rows.map(([id]) => ret(id, a, z)), pr = mixRet(rows, a, z), br = mixRet(p.bench.rows.filter(([, w]) => +w > 0), a, z);
    tb.append(el('tr', { class: 'row', title: `${f} to ${t}` }, el('td', { class: 'l', text: name }), cell(pr, true), cell(br, true), ...rs.map(v => cell(v))));
    csv.push([name, pr, br, ...rs]);
  }
  // where the portfolio's own risk sits: the last three years of weekly returns
  const ids = rows.map(([id]) => id).filter(id => poSeries(id, p.ccy)), A = PM.pmAlign(ids.map(id => poSeries(id, p.ccy)), addMonths(state.latest, -36));
  if (A.n >= 52) {
    const { C } = PM.pmCov(A.R), w = PM.pmVec(ids, Object.fromEntries(rows)), Cw = C.map(r => r.reduce((s, x, j) => s + x * w[j], 0)), v = w.reduce((s, x, i) => s + x * Cw[i], 0);
    tb.append(el('tr', { class: 'grp' }, el('td', { colspan: heads.length, text: 'Share of the portfolio’s own risk (last 3 years, weekly)' })));
    tb.append(el('tr', { class: 'row' }, el('td', { class: 'l', text: 'Contribution to risk' }), el('td', { class: 'num', text: v > 0 ? fmtNum(Math.sqrt(v * 52) * 100, 1) + '% vol' : '–' }), el('td', {}),
      ...rows.map(([id]) => { const i = ids.indexOf(id); return el('td', { class: 'num strong', text: i >= 0 && v > 0 ? fmtNum(w[i] * Cw[i] / v * 100, 0) + '%' : '–' }); })));
    csv.push(['Contribution to risk %', '', '', ...rows.map(([id]) => { const i = ids.indexOf(id); return i >= 0 && v > 0 ? w[i] * Cw[i] / v * 100 : ''; })]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i ? '' : 'l' })))), tb)));
  c.csv = csv;
  setNote(c, `How today's weights, and the benchmark's, would have done in six past sell-offs (peak to trough of world equities, in ${p.ccy}, no rebalancing inside the episode), and which holdings carry the portfolio's own risk now. “–” = no price for that holding then; an episode needs prices for 80% of the weights.`);
  setSource(c, PO_SRC);
}

// ---- the portfolio bar and the five tiles (EXTRA_HOOKS: drawn after the cards, before fitTiles)
function poDialog(title, startChoice, then) {   // a name, and for a new portfolio what to start from
  const name = el('input', { type: 'text', class: 'vdlg-in', placeholder: 'Name', value: '' }), from = startChoice ? el('select', { class: 'vdlg-in' }, ...PO_START.map(([k, l]) => el('option', { value: k, text: l }))) : null;
  const go = el('button', { type: 'button', class: 'primary', text: startChoice ? 'Create' : 'Rename', onclick: () => { const n = name.value.trim(); if (!n) { name.focus(); return; } closeVDialog(); then(n, from && from.value); } });
  name.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
  const box = vDialog(title, [el('p', { class: 'muted small', text: 'Kept in your private vault once it is set up, never published.' }), name, ...(from ? [el('label', { class: 'small' }, 'Start from ', from)] : [])],
    [el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: closeVDialog }), go]);
  return box;
}
function poBar() {
  const bar = $('#poBar'); if (!bar) return; bar.replaceChildren();
  if (poLocked()) { bar.append(el('span', { class: 'muted small', text: '🔒 Your portfolios are in your locked vault. ' }), el('button', { type: 'button', class: 'ghost', text: 'Unlock', onclick: () => vaultAsk() })); return; }
  const o = poStore(); if (!o) return; const p = o.ports.find(x => x.id === o.sel);
  const sel = el('select', { class: 'mini-select', 'aria-label': 'Portfolio' }, ...o.ports.map(x => el('option', { value: x.id, text: x.name }))); sel.value = o.sel;
  sel.onchange = () => poMutate(q => { q.sel = sel.value; });
  const btn = (text, title, fn) => el('button', { type: 'button', class: 'ghost', text, title, onclick: fn });
  const ccy = el('select', { class: 'mini-select', 'aria-label': 'Currency' }, ...PO_CCY.map(x => el('option', { value: x, text: x }))); ccy.value = p.ccy;
  ccy.onchange = () => poEdit(q => { q.ccy = ccy.value; });
  bar.append(el('label', {}, 'Portfolio ', sel),
    btn('＋ New', 'Start a new portfolio', () => poDialog('New portfolio', true, (n, f) => poMutate(q => { const cur = q.ports.find(x => x.id === q.sel);
      const x = f === 'copy' ? { ...JSON.parse(JSON.stringify(cur)), id: poId(), name: n } : poNew(n, f === 'blank' ? [] : (PO_START.find(s => s[0] === f) || PO_START[1])[2], cur.ccy);
      q.ports.push(x); q.sel = x.id; }))),
    btn('Duplicate', 'Copy this portfolio', () => poMutate(q => { const x = { ...JSON.parse(JSON.stringify(p)), id: poId(), name: p.name + ' (copy)' }; q.ports.push(x); q.sel = x.id; })),
    btn('Rename', 'Rename this portfolio', () => { const box = poDialog('Rename portfolio', false, n => poEdit(q => { q.name = n; })); const i = box && box.querySelector('input'); if (i) i.value = p.name; }),
    btn('Delete', 'Delete this portfolio', () => { if (o.ports.length < 2) { alert('This is your only portfolio: start a new one before deleting it.'); return; }
      if (!confirm(`Delete “${p.name}”? This cannot be undone.`)) return; poMutate(q => { q.ports = q.ports.filter(x => x.id !== p.id); q.sel = q.ports[0].id; }); }),
    el('span', { class: 'sp' }), el('label', {}, 'In ', ccy),
    el('div', { class: 'seg-chips' }, ...PO_WIN.map(([k]) => el('button', { type: 'button', 'aria-selected': String(p.win === k), text: k, onclick: () => poEdit(q => { q.win = k; }) }))),
    el('span', { class: 'muted small', text: typeof vaultOn === 'function' && vaultOn() ? '🔒 saved in your private vault' : 'saved in this browser (the vault encrypts it)' }));
}
function poTiles() {
  const box = $('#poKpis'); if (!box) return; box.replaceChildren();
  const R = poCompute(); if (!R.st) return;
  const st = R.st, tile = (label, value, delta, asof) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: label }), el('div', { class: 'k-value', text: value }), el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: asof })));
  const span = R.limit ? `from ${monthLab(st.from)} (${poTick(R.limit.id)})` : `${R.p.win === 'Max' ? 'whole history' : R.p.win}, weekly returns`, to = `to ${nice(st.to)}`;
  tile('Tracking error', poPct(st.te), span, to);
  tile('Active return', `${poPct(st.activeRet)} a year`, `${poPct(st.retP)} vs ${poPct(st.retB)}`, to);
  tile('Beta to benchmark', st.beta == null ? '–' : fmtNum(st.beta, 2), `correlation ${st.corr == null ? '–' : fmtNum(st.corr, 2)}`, to);
  tile('Volatility', poPct(st.volP), `benchmark ${poPct(st.volB)}`, to);
  tile('Worst fall', poPct(st.ddP), `benchmark ${poPct(st.ddB)}`, to);
}
function poHook() {   // only while a portfolio sub-tab is open: nothing to load on the other Allocation sub-tabs
  const bar = $('#poBar'); if (!bar || !subActive(bar)) return;
  if (!FUNDS && !poLocked()) { loadFunds().then(poWhenLoaded); }
  poBar(); poTiles();
}
function buildPortfolio(g) {
  makeCard(g, { key: 'idea_model', title: 'Portfolio', range: false, render: renderPbHold });
  makeCard(g, { key: 'po_bench', title: 'Benchmark', range: false, render: renderPbBench });
  makeCard(g, { key: 'idea_modelchart', title: 'Portfolio vs benchmark', range: false, seg: { key: 'poView', options: [['value', 'Value'], ['gap', 'Gap'], ['te', 'Rolling TE']] }, render: renderPbChart });
  makeCard(g, { key: 'po_src', title: 'Where the tracking error comes from', range: false, render: renderPbSrc });
  makeCard(g, { key: 'idea_stress', title: 'Stress test and risk', wide: true, range: false, render: renderPbStress });
  for (const k of ['idea_model', 'po_bench', 'po_src', 'idea_stress']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
}
SUB_ALIAS.alloc = { ...(SUB_ALIAS.alloc || {}), 'Model portfolio': 'Portfolio' };   // old links and the Idea log mapping
TILE_SETS.alloc.Portfolio = ['Tracking error', 'Active return', 'Beta to benchmark', 'Volatility', 'Worst fall'];
EXTRA_HOOKS.alloc.push(poHook);
