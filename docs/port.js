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
const PO_INDEX = [['IX:SPX', 'SPX', 'S&P 500 index (no dividends)', 'Equities', 'United States', 'us usa america spx'],
  ['IX:KLCI', 'KLCI', 'FBM KLCI index (no dividends)', 'Equities', 'Asia Pacific', 'malaysia my klci'], ['IX:STI', 'STI', 'Straits Times index (no dividends)', 'Equities', 'Asia Pacific', 'singapore sti sg'],
  ['IX:GOLD', 'GOLD', 'Gold (spot price)', 'Gold', 'Gold, cash and property', 'gold bullion'], ['IX:BTC', 'BTC', 'Bitcoin', 'Other', 'Other', 'crypto btc']];
// Design plan 6, Step 1: the browse groups, in order (funds.json carries each fund's group; pipeline/funds.py GROUPS is the source)
const PO_GROUPS = ['World', 'Regions', 'United States', 'US sectors', 'Asia Pacific', 'Europe', 'Americas, Middle East and Africa', 'Bonds', 'Gold, cash and property', 'Other'];
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
    B[id] = { id, label: x.short || x.name || id, name: x.name || '', cls: x.cls || 'Other', grp: x.grp || 'Other', place: x.place || '', alias: x.alias || '', ccy: x.ccy, kind: 'fund',
      thin: x.thin || 0, src: x.src, s: { id: 'F_' + id, label: x.short || id, t: x.d.map(d => d * DAY), v: x.v } };
  for (const [id, sid, label, cls, grp, alias] of PO_INDEX) if (has(sid)) B[id] = { id, label, name: S[sid].label, cls, grp, alias, place: '', ccy: LOCAL_CCY[sid] || 'USD', kind: 'index', thin: 0, s: S[sid] };
  B.CASH = { id: 'CASH', label: 'Cash (short rate in the portfolio currency)', name: '', cls: 'Cash', grp: 'Gold, cash and property', alias: 'cash deposit money market', place: '', ccy: null, kind: 'cash', thin: 0 };
  if (FUNDS) poBlocksMemo = B;
  return B;
}
const poLabel = id => { const b = poBlocks()[id]; return b ? b.label : id.replace(/^IX:/, '') + ' (no data)'; };
const poTick = id => id === 'CASH' ? 'cash' : id.replace(/^IX:/, '');
// the line under a block's name: the fund (shortened), ticker, currency and place of listing; an index or cash says what it is
const poFundName = n => (n || '').replace(/ETF Series - |iShares VII PLC - |iShares Asia Trust - |State Street |SPDR ETFs Australia - /g, '').replace(/\s+(UCITS\s+)?ETF\b.*$/i, '').replace(/\s+Index Fund$/i, '').trim();
function poSub(id) {
  const b = poBlocks()[id]; if (!b) return poTick(id);
  if (b.kind === 'cash') return 'interest at the short rate';
  if (b.kind === 'index') return `index, no dividends · ${b.ccy}`;
  const nm = poFundName(b.name);
  return [nm && nm.toLowerCase() !== b.label.toLowerCase() ? nm : '', poTick(id), b.ccy, b.place].filter(Boolean).join(' · ');
}
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
// Design plan 6, Step 3 (owner's approval 27 Nov 2026): a holdings change makes a draft, p.draft = { rows, steps: [{ id, from,
// text }] }, shown before → after until Save; Save copies the draft to p.rows, Save as new makes a new portfolio from it,
// Discard drops it. The draft is stored (it survives a reload and syncs with the vault); Undo is a stack kept in memory for
// this visit. Settings apply at once: benchmark, currency, window, the rule for where a weight comes from (p.rule: 'all' or
// 'cash'), locks (p.locks) and the target. Every change goes through PM.pmSet, so the total always stays 100%.
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

// ---- weights: saved rows scaled to 100 (rows typed as amounts under the old page read as shares); the draft's rows if any
const poScaledRows = rows => { const t = rows.reduce((s, [, w]) => s + Math.max(0, +w || 0), 0); return rows.map(([id, w]) => [id, t > 0 ? Math.max(0, +w || 0) / t * 100 : 0]); };
const poRound2Rows = rows => { const r = rows.map(([id, w]) => [id, Math.round(w * 100) / 100]), rest = Math.round((100 - r.reduce((s, x) => s + x[1], 0)) * 100) / 100;
  if (rest && r.length) { const big = r.reduce((m, x) => x[1] > m[1] ? x : m); big[1] = Math.round((big[1] + rest) * 100) / 100; } return r; };
const poWorkRows = p => p.draft ? p.draft.rows : poScaledRows(p.rows);
const poObj = rows => { const o = {}; for (const [id, w] of rows) if (+w > 0) o[id] = (o[id] || 0) + +w; return o; };
const poSameRows = (a, b) => { const x = poObj(a), y = poObj(b); return Object.keys({ ...x, ...y }).every(k => Math.abs((x[k] || 0) - (y[k] || 0)) < 0.02); };   // within rounding: no draft
const PO_ADD_AT = 10;   // a holding added from the search box starts at 10% of the portfolio
const poW1 = v => { const r = Math.round(v * 10) / 10; return fmtNum(r, r % 1 ? 1 : 0); };
state.poUndo = {};
function poStepText(id, from, to, rule) {   // one change, in words: "＋ MSCI Japan 10%, taken from every other holding"
  const L = poLabel(id), d = to - from, take = rule === 'cash' ? 'taken from cash first' : 'taken from every other holding', give = rule === 'cash' ? 'into cash' : 'given back to the others';
  if (Math.abs(d) < 0.005) return '';
  if (from < 0.005) return `＋ ${L} ${poW1(to)}%, ${take}`;
  if (to < 0.005) return `− ${L}, ${give}`;
  return `${L} ${d > 0 ? '+' : '−'}${poW1(Math.abs(d))} ${poW1(Math.abs(d)) === '1' ? 'point' : 'points'}, ${d > 0 ? take : give}`;
}
function poDraftWrite(p, rows, step) {   // keep the undo snapshot, write the draft, merge consecutive changes to one holding
  (state.poUndo[p.id] = state.poUndo[p.id] || []).push(p.draft ? JSON.parse(JSON.stringify(p.draft)) : null);
  if (state.poUndo[p.id].length > 60) state.poUndo[p.id].shift();
  const steps = p.draft ? p.draft.steps.slice() : [], last = steps[steps.length - 1];
  if (step) {
    if (last && last.id && last.id === step.id) { steps.pop(); step = { ...step, from: last.from, text: step.redo(last.from) }; }
    if (step.text) steps.push({ id: step.id, from: step.from, text: step.text });
  }
  p.draft = poSameRows(rows, poScaledRows(p.rows)) ? null : { rows, steps };
}
function poChange(id, to) {   // set one holding's weight in the draft; the others follow the rule; locked holdings stay
  poEdit(p => {
    const base = p.draft ? p.draft.rows : poRound2Rows(poScaledRows(p.rows)), rule = p.rule === 'cash' ? 'cash' : 'all';
    const w = Object.fromEntries(base.map(([k, v]) => [k, v])), before = w[id] || 0, out = PM.pmSet(w, id, to, rule, p.locks || []);
    if (Math.abs((out[id] || 0) - before) < 0.005) return;   // nothing could move (everything else locked)
    const order = [...base.map(r => r[0]), ...Object.keys(out).filter(k => !base.some(r => r[0] === k))];
    poDraftWrite(p, order.map(k => [k, out[k] || 0]), { id, from: before, text: poStepText(id, before, out[id] || 0, rule), redo: f => poStepText(id, f, out[id] || 0, rule) });
  });
}
function poSaveDraft() { poEdit(p => { if (!p.draft) return; p.rows = p.draft.rows.filter(([, w]) => w > 0.005).map(([k, w]) => [k, Math.round(w * 100) / 100]); p.draft = null; state.poUndo[p.id] = []; }); }
function poDiscard() { poEdit(p => { p.draft = null; state.poUndo[p.id] = []; }); }
function poUndo() { const p = poCur(); const st = p && state.poUndo[p.id]; if (!st || !st.length) return; const prev = st.pop(); poEdit(q => { q.draft = prev; }); }
function poSaveAsNew() {
  const p = poCur(); if (!p || !p.draft) return;
  const box = poDialog('Save the changes as a new portfolio', false, n => poMutate(q => { const cur = q.ports.find(x => x.id === q.sel);
    const x = { ...JSON.parse(JSON.stringify(cur)), id: poId(), name: n, rows: cur.draft.rows.filter(([, w]) => w > 0.005).map(([k, w]) => [k, Math.round(w * 100) / 100]), updated: new Date().toISOString() };
    delete x.draft; cur.draft = null; state.poUndo[cur.id] = []; q.ports.push(x); q.sel = x.id; }), 'Save');
  const i = box && box.querySelector('input'); if (i) i.value = p.name + ' (changed)';
}

// ---- the numbers: the open portfolio (with the draft, if any) against its benchmark over its window, and the saved one on the
// same weeks for before → after (cached until anything changes)
function poCompute() {
  const p = poCur(); if (!p) return { locked: true };
  if (!FUNDS) return { loading: true, p };
  const key = JSON.stringify([p.id, p.rows, p.draft ? p.draft.rows : null, p.bench.rows, p.ccy, p.win, state.latest]);
  if (state.poRes && state.poRes.key === key) return state.poRes;
  const draft = !!p.draft, wObj = poObj(poWorkRows(p)), w0Obj = poObj(poScaledRows(p.rows)), bObj = poObj(p.bench.rows);
  const ids = [...new Set([...Object.keys(wObj), ...Object.keys(w0Obj), ...Object.keys(bObj)])], missing = ids.filter(id => !poSeries(id, p.ccy)), use = ids.filter(id => !missing.includes(id));
  const yrs = (PO_WIN.find(x => x[0] === p.win) || PO_WIN[1])[1], from = yrs ? addMonths(state.latest, -12 * yrs) : -Infinity;
  const R = { key, p, draft, ids: use, missing, wObj, w0Obj, bObj, yrs, from };
  if (!Object.keys(wObj).length) return (state.poRes = { ...R, reason: 'Add a holding to see the tracking error.' });
  if (!Object.keys(bObj).length) return (state.poRes = { ...R, reason: 'Pick a benchmark to compare with.' });
  const A = PM.pmAlign(use.map(id => poSeries(id, p.ccy)), from);
  let k = -1, f = yrs ? from + 21 * DAY : -Infinity; A.first.forEach((t, i) => { if (t != null && t > f) { f = t; k = i; } });   // the holding whose history cuts the window
  const limit = k >= 0 ? { id: use[k], t: A.first[k] } : null, B = PM.pmVec(use, bObj);
  const st = A.n >= 52 ? PM.pmStats(A, PM.pmVec(use, wObj), B) : null;
  const st0 = st && draft && Object.keys(w0Obj).length ? PM.pmStats(A, PM.pmVec(use, w0Obj), B) : null;
  let shorter = null;   // a holding only the draft has, whose history shortens the window
  if (draft && limit && !(limit.id in w0Obj) && !(limit.id in bObj)) { const old = use.filter(id => id in w0Obj || id in bObj); const n0 = PM.pmAlign(old.map(id => poSeries(id, p.ccy)), from).n; if (n0 > A.n) shorter = { id: limit.id, weeks: n0 - A.n }; }
  const reason = st ? null : `Only ${A.n} weeks that every holding and the benchmark share${limit ? ` (${poLabel(limit.id)} starts in ${monthLab(limit.t)})` : ''}; at least 52 are needed. Try a longer window or another fund.`;
  return (state.poRes = { ...R, A, st, st0, limit, shorter, reason });
}
const poBenchName = p => p.bench.preset === 'custom' ? 'Custom benchmark' : ((PO_BENCH.find(b => b[0] === p.bench.preset) || [])[1] || 'Benchmark');
const poScaled = (rows) => { const t = rows.reduce((s, [, w]) => s + Math.max(0, +w || 0), 0); return id => { const r = rows.find(x => x[0] === id); return t > 0 && r ? Math.max(0, +r[1] || 0) / t * 100 : 0; }; };
const poPct = (v, d = 1) => { if (v == null) return '–'; const r = Math.round(Math.abs(v) * 10 ** d) / 10 ** d; return `${v < 0 && r > 0 ? '−' : ''}${fmtNum(r, d)}%`; };
const poPts = v => { const r = Math.round(Math.abs(v) * 10) / 10; return `${r && v > 0 ? '+' : r && v < 0 ? '−' : ''}${fmtNum(r, r % 1 ? 1 : 0)}`; };   // points, one decimal only when needed
const poThinIds = ids => ids.filter(id => (poBlocks()[id] || {}).thin > PO_THIN);
const poThinNote = ids => { const t = poThinIds(ids); return t.length ? ` ⚑ ${t.map(poTick).join(', ')} ${t.length > 1 ? 'are' : 'is'} thinly traded (price unchanged in many weeks), so the volatility and tracking error ${t.length > 1 ? 'they add' : 'it adds'} may be understated.` : ''; };
const PO_SRC = 'Prices: Yahoo Finance (weekly closes with dividends; index levels without); cash: Bank Negara, MAS, US Treasury short rates; calculated';

// ---- a search box for adding a building block (the list floats under the box)
// search order: the ticker typed, then a label that starts with (or has a word starting with) the query, then the label anywhere,
// then the fund's name, then the search words
function poRankHit(b, q) {
  const l = b.label.toLowerCase();
  return poTick(b.id).toLowerCase().startsWith(q) ? 0 : l.startsWith(q) || l.includes(' ' + q) ? 1 : l.includes(q) ? 2 : (b.name || '').toLowerCase().includes(q) ? 3 : 4;
}
function poSearch(placeholder, onPick, exclude = []) {
  const wrap = el('div', { class: 'po-find' }), inp = el('input', { type: 'search', class: 'perf-search', placeholder, 'aria-label': placeholder }), list = el('div', { class: 'po-sugg', hidden: true });
  const find = q => { q = q.trim().toLowerCase(); if (!q) return [];
    const words = q.split(/\s+/);   // every word must match somewhere: "msci em" or "japan hedged"
    return Object.values(poBlocks()).filter(b => !exclude.includes(b.id) && (hay => words.every(w => hay.includes(w)))([b.id, b.label, b.name, b.cls, b.grp, b.place, b.alias].join(' ').toLowerCase()))
      .sort((a, b) => poRankHit(a, q) - poRankHit(b, q) || a.label.localeCompare(b.label)).slice(0, 8); };
  const show = () => { const L = find(inp.value);
    list.replaceChildren(...L.map(b => el('button', { type: 'button', onmousedown: e => { e.preventDefault(); onPick(b.id); } }, el('b', { text: b.label }), el('span', { class: 'muted', text: ' · ' + poSub(b.id) }))));
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
// the weight of one holding: − and + move it one point a press; typing takes one decimal (Enter commits, Esc cancels)
function poStepper(id, w, onSet) {
  const r1 = v => Math.round(v * 10) / 10, i = el('input', { type: 'text', inputmode: 'decimal', value: fmtNum(r1(w), 1), 'aria-label': `Weight of ${poLabel(id)}, %` });
  i.dataset.id = id; i.dataset.v = String(w);
  const commit = () => { const v = r1(Math.min(100, Math.max(0, +String(i.value).replace(/[^0-9.]/g, '') || 0))); if (Math.abs(v - r1(w)) < 0.05) { i.value = fmtNum(r1(w), 1); return; } onSet(v); };
  i.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') { i.value = fmtNum(r1(w), 1); i.blur(); } });
  i.addEventListener('change', commit);
  i.addEventListener('focus', () => i.select());
  const b = (t, lab, d) => el('button', { type: 'button', text: t, 'aria-label': `${lab} ${poLabel(id)}`, title: `${lab}: one point`, onclick: () => onSet(Math.min(100, Math.max(0, Math.round((w + d) * 10) / 10))) });
  return el('span', { class: 'po-step' }, b('−', 'Less', -1), i, b('+', 'More', 1));
}
function renderPbHold(c) {   // key idea_model (kept from the old Model portfolio card): the holdings, edited as a draft
  if (poWait(c)) return;
  const R = poCompute(), p = R.p, b = htmlBody(c), work = poWorkRows(p), saved = poScaledRows(p.rows), sb = poScaled(p.bench.rows);
  const w0 = id => (saved.find(r => r[0] === id) || [, 0])[1], w1 = id => (work.find(r => r[0] === id) || [, 0])[1], locks = p.locks || [];
  const order = [...work.map(r => r[0]), ...saved.map(r => r[0]).filter(id => !work.some(r => r[0] === id))].filter((id, i, a) => a.indexOf(id) === i);
  const rows = order.filter(id => w1(id) > 0.005 || w0(id) > 0.005 || (!p.draft && p.rows.some(r => r[0] === id)));
  const tb = el('tbody'), x1 = v => fmtNum(Math.round(v * 10) / 10, 1);
  for (const id of rows) {
    const a = w0(id), z = w1(id), gone = p.draft && z < 0.005 && a > 0.005, added = p.draft && a < 0.005 && z > 0.005, moved = p.draft && !gone && !added && Math.abs(z - a) >= 0.05;
    const thin = (poBlocks()[id] || {}).thin > PO_THIN, act = z - sb(id), lk = locks.includes(id);
    const lock = el('button', { type: 'button', class: 'ghost' + (lk ? ' on' : ''), text: lk ? '🔒' : '🔓', 'aria-pressed': String(lk),
      title: lk ? `Locked: other changes leave ${poLabel(id)} alone. Click to unlock.` : `Lock ${poLabel(id)}: other changes leave this weight alone`,
      onclick: () => poEdit(q => { const L = new Set(q.locks || []); L.has(id) ? L.delete(id) : L.add(id); q.locks = [...L]; }) });
    tb.append(el('tr', { class: 'row' + (added ? ' po-new' : '') + (gone ? ' po-gone' : '') + (lk ? ' po-locked' : '') },
      el('td', { class: 'l' }, el('span', { class: 'po-nm', text: poLabel(id) }), added ? el('span', { class: 'po-tag', text: 'new' }) : '',
        el('span', { class: 'cell-sub', title: poSub(id) }, poSub(id), thin ? el('span', { class: 'po-thin', title: `Price unchanged in ${fmtNum(poBlocks()[id].thin * 100, 0)}% of the last three years' weeks`, text: 'thinly traded' }) : '')),
      el('td', { class: 'num po-wcell' }, gone ? el('span', { class: 'muted po-zero', text: '0.0' }) : poStepper(id, z, v => poChange(id, v)),
        added || gone || moved ? el('span', { class: 'po-wascol', text: added ? 'added' : `was ${x1(a)}` }) : null),
      el('td', { class: 'num ' + (act > 0.05 ? 'up' : act < -0.05 ? 'dn' : 'muted') }, poPts(act), el('span', { class: 'po-bw', text: sb(id) ? `of ${fmtNum(sb(id), sb(id) % 1 ? 1 : 0)}` : '' })),
      el('td', { class: 'po-acts' }, gone ? el('button', { type: 'button', class: 'ghost', text: 'Put back', title: `Put ${poLabel(id)} back at ${x1(a)}%`, onclick: () => poChange(id, Math.round(a * 100) / 100) })
        : lock, gone ? null : el('button', { type: 'button', class: 'ghost', text: '✕', title: `Remove ${poLabel(id)}`, 'aria-label': `Remove ${poLabel(id)}`, onclick: () => poChange(id, 0) }))));
  }
  if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: 4, class: 'muted', text: 'No holdings yet: add one below.' })));
  const tot = work.reduce((s, [, w]) => s + w, 0);
  tb.append(el('tr', { class: 'row po-total' }, el('td', { class: 'l strong', text: 'Total' }), el('td', { class: 'num strong po-tot', text: rows.length ? x1(tot) : '0.0' }), el('td', { class: 'num muted', text: 'of 100' }), el('td', {})));
  const rule = el('select', { class: 'mini-select', 'aria-label': 'Where a change in weight comes from' }, el('option', { value: 'all', text: 'all other holdings, in proportion' }), el('option', { value: 'cash', text: 'cash first' }));
  rule.value = p.rule === 'cash' ? 'cash' : 'all'; rule.onchange = () => poEdit(q => { q.rule = rule.value; });
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table po-hold' }, el('thead', {}, el('tr', {}, ...[['Holding'], ['Weight %'], ['Active', 'The portfolio\'s weight minus the benchmark\'s, in points; beneath it, the benchmark\'s weight'], ['']].map(([h, t], i) => el('th', { class: i ? '' : 'l', text: h, title: t || null })))), tb)),
    el('div', { class: 'po-rule' }, el('label', {}, 'When I change a weight, take it from ', rule), el('span', { class: 'muted small', text: 'The total always stays 100%. A locked holding is left alone.' })),
    poSearch(`＋ Add a holding at ${PO_ADD_AT}%: a country, an index or a ticker (Japan, MSCI EM, CSPX…)`, id => { poChange(id, Math.max(w1(id), PO_ADD_AT)); poFocus(c, id); }, work.filter(r => r[1] > 0.005).map(r => r[0])),
    el('div', { class: 'card-foot' }, el('span', { text: p.draft ? 'Not saved yet: Save or Discard in the bar above.' : '' }),
      el('a', { href: `https://github.com/${REPO_PATH}/edit/main/watchlist.txt`, target: '_blank', rel: 'noopener', text: 'Not listed? Add it to watchlist.txt →' })));
  const n = work.filter(r => r[1] > 0.005).length;
  setCount(c, `${n} holding${n === 1 ? '' : 's'}`);
  c.csv = [['Holding', 'Fund', 'Ticker', 'Place', 'Class', 'Saved weight %', 'Weight with changes %', 'Benchmark %', 'Active pts', 'Locked'], ...rows.map(id => [poLabel(id), (poBlocks()[id] || {}).name || '', poTick(id), (poBlocks()[id] || {}).place || '', poClass(id), w0(id).toFixed(2), w1(id).toFixed(2), sb(id).toFixed(2), (w1(id) - sb(id)).toFixed(2), locks.includes(id) ? 'yes' : ''])];
  const thin = poThinNote(rows), st = R.st, st0 = R.st0;
  const lead = p.draft && st && st0 ? `With these changes the tracking error would have been ${poPct(st.te)} instead of ${poPct(st0.te)}.` : p.draft ? 'These changes are not saved yet.' : st ? `The tracking error was ${poPct(st.te)} against ${poBenchName(p)}.` : '';
  setNote(c, `${lead} ` + (R.shorter ? `${poLabel(R.shorter.id)}'s history is shorter: the figures cover ${R.shorter.weeks} fewer weeks than before. ` : '')
    + (R.missing && R.missing.length ? `No prices for ${R.missing.map(poTick).join(', ')}: left out of the figures. ` : '')
    + `− and + move a weight one point; type a weight to one decimal (Enter keeps it, Esc cancels). The difference comes from the other holdings as chosen under the table, so the total stays 100%; a locked holding is left alone. Every change is a draft, shown as was → now, until you press Save. Active = the portfolio's weight minus the benchmark's, in points, with the benchmark's weight beneath ("of 60").${thin}`);
  setSource(c, 'Your weights, kept in your private vault once it is set up'); poAsOf(c, st ? st.to : null);
}
function renderPbBench(c) {
  if (poWait(c)) return;
  const R = poCompute(), p = R.p, b = htmlBody(c), sb = poScaled(p.bench.rows), work = poWorkRows(p), sw = poScaled(work);
  b.append(el('div', { class: 'seg-chips po-presets' }, ...PO_BENCH.map(([k, lab, rows]) => el('button', { type: 'button', 'aria-selected': String(p.bench.preset === k), text: lab,
    onclick: () => poEdit(q => { q.bench = { preset: k, rows: rows.map(r => r.slice()) }; }) })),
    el('button', { type: 'button', 'aria-selected': String(p.bench.preset === 'custom'), text: 'Custom…', title: 'Edit the rows below', onclick: () => poEdit(q => { q.bench.preset = 'custom'; }) })));
  const tb = el('tbody');
  for (const [id, w] of p.bench.rows) {
    const inp = poWeightInput(w, v => poEdit(q => { const r = q.bench.rows.find(x => x[0] === id); if (r) r[1] = v; q.bench.preset = 'custom'; }), `Benchmark weight of ${poLabel(id)}`); inp.dataset.id = id;
    tb.append(el('tr', { class: 'row' }, el('td', { class: 'l' }, poLabel(id), el('span', { class: 'cell-sub', text: poSub(id) })), el('td', { class: 'num' }, inp),
      el('td', {}, el('button', { type: 'button', class: 'ghost', text: '✕', title: `Remove ${poLabel(id)} from the benchmark`, onclick: () => poEdit(q => { q.bench.rows = q.bench.rows.filter(r => r[0] !== id); q.bench.preset = 'custom'; }) }))));
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, ...['Benchmark holding', 'Weight', ''].map((h, i) => el('th', { class: i ? '' : 'l', text: h })))), tb)),
    poSearch('＋ Add to the benchmark', id => poEdit(q => { if (!q.bench.rows.some(r => r[0] === id)) q.bench.rows.push([id, 0]); q.bench.preset = 'custom'; }) || poFocus(c, id), p.bench.rows.map(r => r[0])));
  const mix = PO_CLASSES.map(cl => [cl, work.filter(([id]) => poClass(id) === cl).reduce((s, [id]) => s + sw(id), 0), p.bench.rows.filter(([id]) => poClass(id) === cl).reduce((s, [id]) => s + sb(id), 0)]).filter(([, x, y]) => x > 0.05 || y > 0.05);
  b.append(el('h3', { class: 'po-h', text: `Mix by asset class: portfolio${p.draft ? ' (with your changes)' : ''} vs benchmark` }), ...mix.map(([cl, x, y]) => el('div', { class: 'po-mix' }, el('span', { class: 'nm', text: cl }),
    el('span', { class: 'bar', title: `Portfolio ${fmtNum(x, 1)}% (bar) · benchmark ${fmtNum(y, 1)}% (line)` }, el('i', { style: `width:${Math.min(100, x)}%` }), el('b', { style: `width:${Math.min(100, y)}%` })),
    el('span', { class: 'v' }, `${fmtNum(x, 0)}% `, el('span', { class: 'muted', text: `vs ${fmtNum(y, 0)}%` })))));
  setCount(c, poBenchName(p));
  c.csv = [['Benchmark holding', 'Ticker', 'Weight %'], ...p.bench.rows.map(([id]) => [poLabel(id), poTick(id), sb(id).toFixed(2)]), [], ['Asset class', 'Portfolio %', 'Benchmark %'], ...mix.map(([cl, x, y]) => [cl, x.toFixed(2), y.toFixed(2)])];
  setNote(c, 'The world mixes hold world equities (iShares MSCI ACWI) and global bonds hedged to the dollar (iShares Global Aggregate, AGGU); pick a preset or edit the rows. A benchmark change applies at once. Bar = the portfolio, line = the benchmark.');
  setSource(c, 'Your choice of benchmark'); poAsOf(c, R.st ? R.st.to : null);
}
function renderPbChart(c) {   // key idea_modelchart; with a draft, the saved portfolio is the dashed line
  if (poWait(c)) return;
  const R = poCompute(), p = R.p; if (!R.st) return poEmpty(c, R.reason || 'Waiting for data.');
  const st = R.st, s0 = R.st0, d = R.A.dates, view = state.poView, dash = { lineStyle: { type: 'dashed', width: 1.5 } };
  [state.from, state.to] = [d[0], d[d.length - 1]];
  const lim = R.limit ? ` From ${monthLab(st.from)}: ${poTick(R.limit.id)}'s history starts then.` : '', was = s0 ? ' Dashed: the portfolio as saved, on the same weeks.' : '';
  const gapOf = x => d.map((t, i) => [t, (x.cumP[i] / x.cumB[i] - 1) * 100]), endGap = x => x.cumP[x.cumP.length - 1] / x.cumB[x.cumB.length - 1] - 1;
  if (view === 'gap') {
    drawLines(c, [{ name: `${p.name}${s0 ? ' with your changes' : ''} vs ${poBenchName(p)}, cumulative gap`, data: gapOf(st) }, ...(s0 ? [{ name: `${p.name} as saved, cumulative gap`, data: gapOf(s0), color: col(0), extra: dash }] : [])],
      { fmt: v => poPct(v, 1), axisFmt: v => fmtNum(v, 0) + '%', zero: true, endLabels: false });
    setNote(c, `Over the window the portfolio${s0 ? ' with your changes' : ''} ${endGap(st) >= 0 ? 'gained' : 'lost'} ${fmtNum(Math.abs(endGap(st)) * 100, 1)}% against the benchmark in ${p.ccy}${s0 ? ` (as saved: ${endGap(s0) >= 0 ? 'gained' : 'lost'} ${fmtNum(Math.abs(endGap(s0)) * 100, 1)}%)` : ''}.${lim}${was} The line is the portfolio's value divided by the benchmark's, minus one.`);
  } else if (view === 'te') {
    const roll = PM.pmRolling(R.A, PM.pmVec(R.ids, R.wObj), PM.pmVec(R.ids, R.bObj)), roll0 = s0 ? PM.pmRolling(R.A, PM.pmVec(R.ids, R.w0Obj), PM.pmVec(R.ids, R.bObj)) : [];
    if (!roll.length) return poEmpty(c, 'The rolling tracking error needs more than a year of shared weeks: pick a longer window.');
    [state.from, state.to] = [roll[0][0], roll[roll.length - 1][0]];
    drawLines(c, [{ name: `Tracking error, past 52 weeks${s0 ? ', with your changes' : ''}`, data: roll }, ...(s0 ? [{ name: 'As saved', data: roll0, color: col(0), extra: dash }] : [])],
      { fmt: v => poPct(v, 2), axisFmt: v => fmtNum(v, 1) + '%', endLabels: false, hlines: [{ y: +st.te.toFixed(2), label: `whole window ${fmtNum(st.te, 1)}%` }] });
    const lo = roll.reduce((m, x) => x[1] < m[1] ? x : m), hi = roll.reduce((m, x) => x[1] > m[1] ? x : m);
    setNote(c, `Over the 52 weeks to ${nice(roll[roll.length - 1][0])} the tracking error was ${fmtNum(roll[roll.length - 1][1], 1)}%${s0 && roll0.length ? ` (as saved: ${fmtNum(roll0[roll0.length - 1][1], 1)}%)` : ''}; within the window it ranged from ${fmtNum(lo[1], 1)}% (${monthLab(lo[0])}) to ${fmtNum(hi[1], 1)}% (${monthLab(hi[0])}).${lim}${was}`);
  } else {
    drawLines(c, [{ name: p.name + (s0 ? ' with your changes' : ''), data: d.map((t, i) => [t, st.cumP[i]]) }, { name: poBenchName(p), data: d.map((t, i) => [t, st.cumB[i]]) },
      ...(s0 ? [{ name: `${p.name} as saved`, data: d.map((t, i) => [t, s0.cumP[i]]), color: col(0), extra: dash }] : [])], { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0), hlines: [{ y: 100 }], endLabels: false });
    setNote(c, `The portfolio${s0 ? ' with your changes' : ''} returned ${poPct(st.retP)} a year in ${p.ccy} against ${poPct(st.retB)} for the benchmark${s0 ? ` (as saved: ${poPct(s0.retP)})` : ''}, with ${fmtNum(st.volP / st.volB * 100, 0)}% of its volatility.${lim}${was} All lines = 100 at the start and held at their weights (rebalanced weekly), dividends included.`);
  }
  c.csv = [['Week to', 'Portfolio (= 100 at start)', 'Benchmark (= 100 at start)', ...(s0 ? ['Portfolio as saved (= 100 at start)'] : [])], ...d.map((t, i) => [iso(t), st.cumP[i].toFixed(3), st.cumB[i].toFixed(3), ...(s0 ? [s0.cumP[i].toFixed(3)] : [])])];
  setSource(c, PO_SRC); poAsOf(c, st.to);
}
function renderPbSrc(c) {   // where the tracking error comes from; with a draft, each share as saved → with your changes
  if (poWait(c)) return;
  const R = poCompute(); if (!R.st) return poEmpty(c, R.reason || 'Waiting for data.');
  const st = R.st, s0 = R.st0, rows = R.ids.map((id, i) => ({ id, act: st.active[i], sh: st.share[i], sh0: s0 ? s0.share[i] : null })).filter(r => Math.abs(r.act) > 1e-9 || (r.sh0 != null && Math.abs(r.sh0) > 0.05) || Math.abs(r.sh) > 0.05).sort((a, b) => b.sh - a.sh);
  const b = htmlBody(c), tb = el('tbody');
  for (const r of rows) tb.append(el('tr', { class: 'row' }, el('td', { class: 'l', text: poLabel(r.id) }),
    el('td', { class: 'num ' + (r.act > 0.05 ? 'up' : r.act < -0.05 ? 'dn' : 'muted'), text: poPts(r.act) }),
    el('td', { class: 'num strong' }, ...(s0 && Math.abs(r.sh0 - r.sh) >= 0.5 ? [el('span', { class: 'po-was', text: poPct(r.sh0, 0) }), el('span', { class: 'po-arr', text: ' → ' })] : []), poPct(r.sh, 0)),
    el('td', {}, el('span', { class: 'po-share' + (r.sh < 0 ? ' neg' : '') }, el('i', { style: `width:${Math.min(100, Math.abs(r.sh)).toFixed(0)}%` })))));
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, ...['Holding', 'Active weight', s0 ? 'Share: saved → now' : 'Share of tracking error', ''].map((h, i) => el('th', { class: i ? '' : 'l', text: h })))), tb)));
  capRows(tb, 'po_src', 12);
  const top = rows[0];
  setCount(c, s0 ? `${fmtNum(s0.te, 1)}% → ${fmtNum(st.te, 1)}% in all` : `${fmtNum(st.te, 1)}% in all`);
  c.csv = [['Holding', 'Ticker', 'Active weight pts', 'Share of tracking error %', ...(s0 ? ['Share as saved %'] : [])], ...rows.map(r => [poLabel(r.id), poTick(r.id), r.act.toFixed(2), r.sh.toFixed(2), ...(s0 ? [r.sh0.toFixed(2)] : [])])];
  setNote(c, (top ? `${poLabel(top.id)} explains ${fmtNum(top.sh, 0)}% of the tracking error${s0 ? ' with your changes' : ''}: the portfolio holds ${fmtNum(Math.abs(top.act), 0)} points ${top.act >= 0 ? 'more' : 'less'} of it than the benchmark.` : '')
    + (rows.some(r => r.sh < -0.5) ? ' A negative share offsets part of the rest.' : '') + poThinNote(R.ids)
    + (s0 ? ' Where a share moves, the figure as saved is struck through beside it.' : '')
    + ` Share = the holding's active weight times its covariance with the whole gap, over the tracking error squared; the shares sum to 100%. ${R.yrs ? R.yrs + '-year' : 'Whole'} window, weekly returns.`);
  setSource(c, PO_SRC); poAsOf(c, st.to);
}
function renderPbStress(c) {   // key idea_stress (moved from the old model portfolio, WP47): past sell-offs and where the risk sits; reads the draft
  if (poWait(c)) return;
  const R = poCompute(), p = R.p, rows = poWorkRows(p).filter(([, w]) => +w > 0.005), b = htmlBody(c);
  setCount(c, p.draft ? 'with your changes' : '');
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
  setNote(c, `How the weights${p.draft ? ' with your changes (not saved yet)' : ''}, and the benchmark's, would have done in six past sell-offs (peak to trough of world equities, in ${p.ccy}, no rebalancing inside the episode), and which holdings carry the portfolio's own risk now. “–” = no price for that holding then; an episode needs prices for 80% of the weights.`);
  setSource(c, PO_SRC); poAsOf(c, R.st ? R.st.to : null);
}

// ---- the portfolio bar (one sentence), the change bar and the five tiles (EXTRA_HOOKS: drawn after the cards, before fitTiles)
function poDialog(title, startChoice, then, okText) {   // a name, and for a new portfolio what to start from
  const name = el('input', { type: 'text', class: 'vdlg-in', placeholder: 'Name', value: '' }), from = startChoice ? el('select', { class: 'vdlg-in' }, ...PO_START.map(([k, l]) => el('option', { value: k, text: l }))) : null;
  const go = el('button', { type: 'button', class: 'primary', text: okText || (startChoice ? 'Create' : 'Rename'), onclick: () => { const n = name.value.trim(); if (!n) { name.focus(); return; } closeVDialog(); then(n, from && from.value); } });
  name.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
  const box = vDialog(title, [el('p', { class: 'muted small', text: 'Kept in your private vault once it is set up, never published.' }), name, ...(from ? [el('label', { class: 'small' }, 'Start from ', from)] : [])],
    [el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: closeVDialog }), go]);
  return box;
}
function poBar() {   // Portfolio [picker] against [benchmark] in [currency] over [window] · New · Duplicate · Rename · Delete
  const bar = $('#poBar'); if (!bar) return; bar.replaceChildren(); bar.classList.add('po-sentence');
  if (poLocked()) { bar.append(el('span', { class: 'muted small', text: '🔒 Your portfolios are in your locked vault. ' }), el('button', { type: 'button', class: 'ghost', text: 'Unlock', onclick: () => vaultAsk() })); return; }
  const o = poStore(); if (!o) return; const p = o.ports.find(x => x.id === o.sel);
  const sel = el('select', { class: 'mini-select', 'aria-label': 'Portfolio', title: typeof vaultOn === 'function' && vaultOn() ? 'Kept in your private vault' : 'Kept in this browser (set up the vault to encrypt it); a dot marks changes not saved yet' }, ...o.ports.map(x => el('option', { value: x.id, text: x.name + (x.draft ? ' •' : ''), title: x.draft ? 'Has changes not saved yet' : '' }))); sel.value = o.sel;
  sel.onchange = () => poMutate(q => { q.sel = sel.value; });
  const btn = (text, title, fn) => el('button', { type: 'button', class: 'ghost', text, title, onclick: fn });
  const bench = el('select', { class: 'mini-select', 'aria-label': 'Benchmark' }, ...PO_BENCH.map(([k, lab]) => el('option', { value: k, text: lab })), el('option', { value: 'custom', text: p.bench.preset === 'custom' ? 'Custom benchmark' : 'Custom…' }));
  bench.value = p.bench.preset === 'custom' ? 'custom' : p.bench.preset;
  bench.onchange = () => { const v = bench.value, pre = PO_BENCH.find(x => x[0] === v);
    if (pre) poEdit(q => { q.bench = { preset: v, rows: pre[2].map(r => r.slice()) }; });
    else { if (p.bench.preset !== 'custom') poEdit(q => { q.bench.preset = 'custom'; }); const bc = cards.po_bench; if (bc) bc.root.scrollIntoView({ block: 'start', behavior: 'smooth' }); } };
  const ccy = el('select', { class: 'mini-select', 'aria-label': 'Currency' }, ...PO_CCY.map(x => el('option', { value: x, text: x }))); ccy.value = p.ccy;
  ccy.onchange = () => poEdit(q => { q.ccy = ccy.value; });
  bar.append(el('label', {}, 'Portfolio ', sel), el('label', {}, 'against ', bench), el('label', {}, 'in ', ccy),
    el('span', { class: 'seg-chips', role: 'group', 'aria-label': 'Window' }, ...PO_WIN.map(([k]) => el('button', { type: 'button', 'aria-selected': String(p.win === k), text: k, title: k === 'Max' ? 'The whole shared history' : `The past ${k.replace('Y', ' year')}${k === '1Y' ? '' : 's'}`, onclick: () => poEdit(q => { q.win = k; }) }))),
    el('span', { class: 'sp' }),
    btn('＋ New', 'Start a new portfolio', () => poDialog('New portfolio', true, (n, f) => poMutate(q => { const cur = q.ports.find(x => x.id === q.sel);
      const x = f === 'copy' ? { ...JSON.parse(JSON.stringify(cur)), id: poId(), name: n } : poNew(n, f === 'blank' ? [] : (PO_START.find(s => s[0] === f) || PO_START[1])[2], cur.ccy);
      delete x.draft; q.ports.push(x); q.sel = x.id; }))),
    btn('Duplicate', 'Copy this portfolio as saved', () => poMutate(q => { const x = { ...JSON.parse(JSON.stringify(p)), id: poId(), name: p.name + ' (copy)', updated: new Date().toISOString() }; delete x.draft; q.ports.push(x); q.sel = x.id; })),
    btn('Rename', 'Rename this portfolio', () => { const box = poDialog('Rename portfolio', false, n => poEdit(q => { q.name = n; })); const i = box && box.querySelector('input'); if (i) i.value = p.name; }),
    btn('Delete', 'Delete this portfolio', () => { if (o.ports.length < 2) { alert('This is your only portfolio: start a new one before deleting it.'); return; }
      if (!confirm(`Delete “${p.name}”${p.draft ? ' and its changes not saved yet' : ''}? This cannot be undone.`)) return; poMutate(q => { q.ports = q.ports.filter(x => x.id !== p.id); q.sel = q.ports[0].id; }); }));
}
function poChangesBar() {   // only while the open portfolio has a draft: the steps in words, then Undo · Discard · Save as new… · Save
  const bar = $('#poChanges'); if (!bar) return; bar.replaceChildren();
  const p = poLocked() ? null : poCur();
  if (!p || !p.draft) return;   // empty: hidden by the style sheet (the sub-tab switch sets the hidden attribute itself)
  const st = p.draft.steps || [], n = st.length || 1, undo = (state.poUndo[p.id] || []).length, sub = $('#tab-alloc .subtabs');
  bar.style.top = `calc(var(--filters-h, 0px) + ${sub ? sub.offsetHeight : 0}px)`;   // sticks just under the sub-tab bar
  bar.append(el('b', { text: `${n} change${n === 1 ? '' : 's'}, not saved yet` }),
    el('span', { class: 'po-chgs', title: st.map(s => s.text).join('\n') },   // one line on a desktop: the latest steps, cut short with the full text on hover
      ...(st.length > 3 ? [el('span', { class: 'muted small po-more', text: `${st.length - 3} earlier ·` })] : []),
      ...(st.length ? st.slice(-3).map(s => el('span', { class: 'po-chg', text: s.text, title: s.text })) : [el('span', { class: 'po-chg', text: 'weights rounded' })])),
    el('button', { type: 'button', class: 'ghost', text: '↶ Undo', title: undo ? 'Step back one change' : 'Nothing to undo in this visit: Discard drops every change', disabled: !undo, onclick: poUndo }),
    el('button', { type: 'button', class: 'ghost', text: 'Discard', title: 'Drop every change and go back to the saved portfolio', onclick: poDiscard }),
    el('button', { type: 'button', class: 'ghost', text: 'Save as new…', title: 'Keep the saved portfolio as it is and save these weights as a new one', onclick: poSaveAsNew }),
    el('button', { type: 'button', class: 'primary', text: 'Save', title: 'Keep these weights', onclick: poSaveDraft }));
}
function poTiles() {   // with a draft, a figure that moves shows saved → now
  const box = $('#poKpis'); if (!box) return; box.replaceChildren();
  const R = poCompute(); if (!R.st) return;
  const st = R.st, s0 = R.st0, to = `to ${nice(st.to)}`;
  const val = (f, k, d) => { const now = f(st[k]); if (!s0 || s0[k] == null || st[k] == null) return now; const was = f(s0[k]); return was === now ? now : [el('span', { class: 'po-was', text: was }), el('span', { class: 'po-arr', text: ' → ' }), now]; };
  const tile = (label, value, delta, asof) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: label }), el('div', { class: 'k-value' }, ...[].concat(value)), el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: asof })));
  const span = R.limit ? `from ${monthLab(st.from)} (${poTick(R.limit.id)})` : `${R.p.win === 'Max' ? 'whole history' : R.p.win}, weekly returns`;
  const dTe = s0 ? st.te - s0.te : 0;
  tile('Tracking error', val(poPct, 'te'), s0 && Math.abs(dTe) >= 0.05 ? `${poPts(dTe)} pts` : span, s0 ? `with your changes, ${span}; ${to}` : to);
  tile('Active return', val(v => `${poPct(v)}`, 'activeRet'), `${poPct(st.retP)} vs ${poPct(st.retB)} a year`, to);
  tile('Beta to benchmark', val(v => v == null ? '–' : fmtNum(v, 2), 'beta'), `correlation ${st.corr == null ? '–' : fmtNum(st.corr, 2)}`, to);
  tile('Volatility', val(poPct, 'volP'), `benchmark ${poPct(st.volB)}`, to);
  tile('Worst fall', val(poPct, 'ddP'), `benchmark ${poPct(st.ddB)}`, to);
}
function poHook() {   // only while a portfolio sub-tab is open: nothing to load on the other Allocation sub-tabs
  const bar = $('#poBar'); if (!bar || !subActive(bar)) return;
  if (!FUNDS && !poLocked()) { loadFunds().then(poWhenLoaded); }
  poBar(); poTiles(); poChangesBar();
}
function buildPortfolio(g) {
  makeCard(g, { key: 'idea_model', title: 'Holdings', range: false, render: renderPbHold });
  makeCard(g, { key: 'po_bench', title: 'Benchmark', range: false, render: renderPbBench });
  makeCard(g, { key: 'idea_modelchart', title: 'Portfolio vs benchmark', range: false, seg: { key: 'poView', options: [['value', 'Value'], ['gap', 'Gap'], ['te', 'Rolling TE']] }, render: renderPbChart });
  makeCard(g, { key: 'po_src', title: 'Where the tracking error comes from', range: false, render: renderPbSrc });
  makeCard(g, { key: 'idea_stress', title: 'Stress test and risk', wide: true, range: false, render: renderPbStress });
  for (const k of ['idea_model', 'po_bench', 'po_src', 'idea_stress']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
  buildAddFund(g);   // Step 4
}
SUB_ALIAS.alloc = { ...(SUB_ALIAS.alloc || {}), 'Model portfolio': 'Portfolio' };   // old links and the Idea log mapping
TILE_SETS.alloc.Portfolio = ['Tracking error', 'Active return', 'Beta to benchmark', 'Volatility', 'Worst fall'];
EXTRA_HOOKS.alloc.push(poHook);

// ------------------------------------------------------------------ ALLOCATION → ADD A FUND (Design plan 4, Step 4)
// What adding a fund would have done to the open portfolio's tracking error: one fund at a chosen weight (before → after),
// the curve as its weight rises, and every fund at 5, 10 or 20%. The added weight is paid for by every other holding in
// proportion, by cash, or by one holding. Arithmetic on past returns, never a recommendation; numbers stay in plain ink.
const PO_CARDS_ADD = ['po_whatif', 'po_curve', 'po_rank'];
state.poAdd = { id: 'ACWI', x: 10, how: 'all', from: null }; state.poRankW = '10'; state.poRankAll = false;
const poHowLab = { all: 'every other holding, in proportion', cash: 'cash first', one: 'one holding first' };
function poWhatIf(k = state.poAdd.id, x = state.poAdd.x) {   // before and after on the same weeks (the window, cut by the added fund's history if needed)
  const R = poCompute(); if (!R.st) return { R, reason: R.reason };
  const p = R.p, a = state.poAdd, how = a.how === 'one' && a.from ? 'one:' + a.from : a.how === 'one' ? 'all' : a.how;
  if (!poSeries(k, p.ccy)) return { R, reason: `No prices for ${poTick(k)} in ${p.ccy}.` };
  const ids = [...new Set([...R.ids, k])], A = PM.pmAlign(ids.map(id => poSeries(id, p.ccy)), R.from);
  if (A.n < 52) return { R, reason: `${poLabel(k)} shares only ${A.n} weeks with the portfolio and the benchmark; at least 52 are needed.` };
  const w1 = poRound2(PM.pmAdd(R.wObj, k, x, how)), B = PM.pmVec(ids, R.bObj);   // rounded as they will be saved, so 'after' is what Apply gives
  return { R, A, ids, how, w1, st0: PM.pmStats(A, PM.pmVec(ids, R.wObj), B), st1: PM.pmStats(A, PM.pmVec(ids, w1), B) };
}
const poAsOf = (c, t) => { setAsOf(c, t); c.read && c.read.clear(); c.used && c.used.clear(); };   // date = the last week analysed, not the exchange rates read on the way
// Target a tracking error (DESIGN_PLAN_4, "Later" item 1; owner's request 26 Nov 2026): the weight of the chosen fund at which
// the tracking error reaches the portfolio's target (PM.pmTarget, searched every 0.1 point from 0 to 100%, paid for as chosen).
// The weight is rounded to 0.1 point on the safe side (up when bringing it down, down when keeping it within) and the figure
// shown is worked out again at that weight with the weights as they would be saved, like every 'after' figure.
const PO_TARGET = 3;   // % a year, until the owner sets a target for a portfolio (kept with the portfolio in the vault)
const poTgtOf = p => p && +p.target > 0 ? +p.target : PO_TARGET;
function poTargetFor(W) {
  const a = state.poAdd, T = poTgtOf(W.R.p), key = [W.R.key, a.id, W.how, T].join('|');
  if (state.poTgt && state.poTgt.key === key) return state.poTgt;
  const t = PM.pmTarget(W.A, W.ids, W.R.wObj, W.R.bObj, a.id, W.how, T);
  const xr = t.x == null ? null : Math.min(100, t.dir === 'down' ? Math.ceil(t.x * 10 - 1e-6) / 10 : Math.floor(t.x * 10 + 1e-6) / 10);
  const W2 = xr == null || t.dir === 'at' ? null : poWhatIf(a.id, xr);
  return (state.poTgt = { ...t, key, T, xr, teR: t.dir === 'at' ? t.te0 : W2 && W2.st1 ? W2.st1.te : null, loX: Math.round(t.lo[0] * 10) / 10 });
}
const poRound2 = w => Object.fromEntries(Object.entries(w).map(([k, v]) => [k, +v.toFixed(2)]));
const poRowsFrom = (p, w1) => { const out = [...new Set(poWorkRows(p).map(r => r[0]))].filter(id => (w1[id] || 0) > 1e-4).map(id => [id, +w1[id].toFixed(2)]);
  for (const [id, v] of Object.entries(w1)) if (v > 1e-4 && !out.some(r => r[0] === id)) out.push([id, +v.toFixed(2)]); return out; };
function renderPoWhatIf(c) {
  if (poWait(c)) return;
  const o = poStore(), R = poCompute(), p = R.p, a = state.poAdd, b = htmlBody(c);
  if (!poBlocks()[a.id]) a.id = poBlocks().ACWI ? 'ACWI' : Object.keys(poBlocks()).find(k => poBlocks()[k].kind === 'fund');
  const portSel = el('select', { class: 'mini-select', 'aria-label': 'Portfolio' }, ...o.ports.map(x => el('option', { value: x.id, text: x.name }))); portSel.value = o.sel;
  portSel.onchange = () => poMutate(q => { q.sel = portSel.value; });
  const slider = el('input', { type: 'range', min: 0, max: a.x > 50 ? 100 : 50, step: 0.1, value: a.x, 'aria-label': 'Weight to add' }), xLab = el('b', { text: a.x + '%' });
  slider.addEventListener('input', () => { xLab.textContent = slider.value + '%'; });
  slider.addEventListener('change', () => { a.x = +slider.value; PO_CARDS_ADD.slice(0, 2).forEach(k => cards[k].render()); });
  const how = el('select', { class: 'mini-select', 'aria-label': 'Paid for by' }, el('option', { value: 'all', text: 'all holdings, in proportion' }), el('option', { value: 'cash', text: 'cash first' }),
    ...p.rows.filter(([id, w]) => +w > 0 && id !== a.id).map(([id]) => el('option', { value: 'one:' + id, text: 'from ' + poTick(id) + ' first' })));
  how.value = a.how === 'one' && a.from ? 'one:' + a.from : a.how; if (!how.value) how.value = 'all';
  how.onchange = () => { const v = how.value; if (v.startsWith('one:')) { a.how = 'one'; a.from = v.slice(4); } else { a.how = v; a.from = null; } PO_CARDS_ADD.slice(0, 2).forEach(k => cards[k].render()); };
  b.append(el('div', { class: 'po-what' }, el('label', {}, 'Portfolio ', portSel), el('label', {}, 'Weight ', slider, xLab), el('label', {}, 'Paid for by ', how)),
    el('div', { class: 'po-pick' }, el('span', { class: 'muted small', text: 'Fund: ' }), el('b', { text: poLabel(a.id) }), el('span', { class: 'muted small', text: ' · ' + poSub(a.id) }),
      poSearch('Change fund: name or ticker', id => { a.id = id; if (a.from === id) { a.how = 'all'; a.from = null; } PO_CARDS_ADD.forEach(k => cards[k].render()); }, [a.id])));
  const W = poWhatIf();
  if (!W.st1) { b.append(el('div', { class: 'empty', text: W.reason || 'Waiting for data.' })); setCount(c, ''); c.csv = null; setNote(c, ''); return; }
  const tg = poTargetFor(W), tick = poTick(a.id), pc = v => fmtNum(v, 2) + '%', x1 = v => fmtNum(v, 1) + '%';
  const tin = el('input', { type: 'number', class: 'po-tin', min: 0.1, max: 30, step: 0.1, value: String(tg.T), 'aria-label': 'Target tracking error, % a year' });
  tin.addEventListener('change', () => { const v = Math.round(+tin.value * 10) / 10; if (!(v > 0 && v <= 30)) { tin.value = String(tg.T); return; } poEdit(q => { q.target = v; }); });
  let msg, useX = null;
  if (tg.dir === 'at') msg = `The portfolio is at ${pc(tg.te0)} already.`;
  else if (tg.dir === 'down' && tg.xr != null) { msg = `${x1(tg.xr)} of ${tick} brings it down to ${pc(tg.teR)}.`; useX = tg.xr; }
  else if (tg.dir === 'down') { msg = `${tick} cannot bring it down to ${pc(tg.T)}: the lowest is ${pc(tg.lo[1])}, at ${x1(tg.loX)}.`; useX = tg.loX; }
  else if (tg.xr != null) { msg = `Up to ${x1(tg.xr)} of ${tick} keeps it within ${pc(tg.T)} (${pc(tg.teR)}).`; useX = tg.xr; }
  else msg = `Even 100% of ${tick} keeps it within ${pc(tg.T)} (at most ${pc(tg.hi[1])}).`;
  b.append(el('div', { class: 'po-target' }, el('label', {}, 'Target tracking error ', tin, '%'), el('span', { class: 'po-tmsg', text: msg }),
    useX != null && Math.abs(useX - a.x) > 1e-9 ? el('button', { type: 'button', class: 'ghost', text: `Use ${x1(useX)}`, title: 'Set the weight above to this', onclick: () => { a.x = useX; PO_CARDS_ADD.slice(0, 2).forEach(k => cards[k].render()); } }) : ''));
  const { st0, st1 } = W, row = (k, v0, v1, d) => el('div', {}, el('span', { class: 'k', text: k }), el('span', { class: 'v' }, v0, el('span', { class: 'arr', text: ' → ' }), el('b', { text: v1 })), el('span', { class: 'd', text: d || '' }));
  const f2 = v => v == null ? '–' : fmtNum(v, 2), dte = st1.te - st0.te;
  b.append(el('div', { class: 'po-ba' },
    row('Tracking error', poPct(st0.te, 2), poPct(st1.te, 2), `${dte > 0.005 ? '+' : dte < -0.005 ? '−' : ''}${fmtNum(Math.abs(dte), 2)} pts`),
    row('Beta to benchmark', f2(st0.beta), f2(st1.beta)), row('Correlation', f2(st0.corr), f2(st1.corr)),
    row('Volatility', poPct(st0.volP), poPct(st1.volP), `benchmark ${poPct(st0.volB)}`), row('Return a year', poPct(st0.retP), poPct(st1.retP), `benchmark ${poPct(st0.retB)}`)),
    el('div', { class: 'card-foot po-foot' }, el('span', { text: 'History, not a forecast.' }), el('span', {},
      el('button', { type: 'button', class: 'ghost', text: 'Apply to this portfolio', title: 'Put these weights in the open portfolio as a change, to Save or Discard on Portfolio', onclick: () => {
        const cur = poCur(), had = (R.wObj[a.id] || 0) > 0.005, txt = had ? `${poLabel(a.id)} +${poW1(a.x)} points, taken from ${poHowLab[a.how]}` : `＋ ${poLabel(a.id)} ${poW1(a.x)}%, taken from ${poHowLab[a.how]}`;
        if (cur) poEdit(q => poDraftWrite(q, poRowsFrom(q, W.w1), { id: null, from: 0, text: txt })); goSub('alloc', 'Portfolio'); } }), ' ',
      el('button', { type: 'button', class: 'ghost', text: 'Save as new', title: 'Keep the open portfolio as it is and save these weights as a new one', onclick: () => {
        poMutate(q => { const cur = q.ports.find(x => x.id === q.sel), n = { ...JSON.parse(JSON.stringify(cur)), id: poId(), name: `${cur.name} + ${a.x}% ${poTick(a.id)}`, rows: poRowsFrom(cur, W.w1), updated: new Date().toISOString() }; delete n.draft; q.ports.push(n); q.sel = n.id; });
        goSub('alloc', 'Portfolio'); } }))));
  setCount(c, `vs ${poBenchName(p)}`);
  c.csv = [['Measure', 'Before', 'After'], ['Tracking error %', st0.te, st1.te], ['Beta', st0.beta, st1.beta], ['Correlation', st0.corr, st1.corr], ['Volatility %', st0.volP, st1.volP], ['Return a year %', st0.retP, st1.retP],
    [], ['Holding', 'Weight before %', 'Weight after %'], ...W.ids.map(id => [poLabel(id), (PM.pmVec(W.ids, W.R.wObj)[W.ids.indexOf(id)] * 100).toFixed(2), (W.w1[id] || 0).toFixed(2)]),
    [], ['Target tracking error %', tg.T], [tg.dir === 'up' ? `Largest weight of ${tick} within the target %` : `Weight of ${tick} that reaches the target %`, tg.xr ?? ''], ['Tracking error at that weight %', tg.teR ?? '']];
  setNote(c, `Adding ${a.x}% of ${poTick(a.id)}, paid for by ${poHowLab[a.how]}, ${dte < -0.005 ? 'would have lowered' : dte > 0.005 ? 'would have raised' : 'would have left'} the tracking error ${Math.abs(dte) > 0.005 ? `by ${fmtNum(Math.abs(dte), 2)} points ` : 'unchanged '}over ${st0.weeks} weeks to ${nice(st0.to)}, in ${p.ccy}.`
    + (W.A.n < (W.R.A ? W.R.A.n : 0) ? ` The window is shorter than on Portfolio because ${poTick(a.id)}'s history starts in ${monthLab(W.A.dates[0])}.` : '') + poThinNote([a.id])
    + ` Target: kept with each portfolio. The weight that reaches it is found by trying every 0.1 point of ${tick} from 0 to 100% of the portfolio, paid for as chosen above, and narrowing down where the tracking error first crosses the target; it is rounded to 0.1 point on the safe side (up when bringing the tracking error down, down when keeping it within) and the figure shown is worked out again at that weight. “Use” sets the weight above to it.`);
  setSource(c, PO_SRC); poAsOf(c, st1.to);
}
function renderPoCurve(c) {
  if (poWait(c)) return;
  const W = poWhatIf(); if (!W.st1) return poEmpty(c, W.reason || 'Waiting for data.');
  const a = state.poAdd, tg = poTargetFor(W), tX = tg.dir === 'at' ? null : tg.xr;
  const xEnd = a.x > 50 || tX > 50 || (tg.dir === 'down' && tX == null && tg.loX > 50) ? 100 : 50;   // 0–100% only when the answer lies beyond 50%
  const xs = [...new Set([...Array.from({ length: xEnd / 5 + 1 }, (_, i) => i * 5), a.x, ...[tX, tg.loX].filter(v => v != null && v <= xEnd)])].sort((p, q) => p - q);
  const C = PM.pmCurve(W.A, W.ids, W.R.wObj, W.R.bObj, a.id, W.how, xs), lo = C.reduce((m, q) => q[1] < m[1] ? q : m), at = C.find(q => q[0] === a.x), tq = tX == null ? null : C.find(q => q[0] === tX);
  c.titleEl.textContent = 'Tracking error by weight added';
  const o = baseOpt(); o.legend.show = false;
  o.grid = { left: 8, right: 18, top: 26, bottom: 24, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: 'axis', formatter: ps => { const q = ps.find(x => x.seriesIndex === 0) || ps[0]; return `${poTick(a.id)} +${fmtNum(q.value[0], q.value[0] % 1 ? 1 : 0)}%: tracking error <b>${fmtNum(q.value[1], 2)}%</b>`; } };
  o.xAxis = { type: 'value', min: 0, max: xEnd, interval: xEnd / 5, axisLabel: { color: tok('--muted'), fontSize: 11, formatter: v => v + '%' }, splitLine: { show: false }, name: 'weight added', nameLocation: 'middle', nameGap: 24, nameTextStyle: { color: tok('--muted'), fontSize: 11 } };
  o.yAxis = valAxis(v => fmtNum(v, 1) + '%', { scale: true });
  const xl = v => fmtNum(v, v % 1 ? 1 : 0) + '%', ys = C.map(q => q[1]), pad = Math.max(0.05, (Math.max(...ys, tg.T) - Math.min(...ys, tg.T)) * 0.06);
  const mk = (q, lab, filled, shape = 'circle', below = false) => ({ coord: q, value: lab, symbol: shape, symbolSize: shape === 'circle' ? 9 : 11, itemStyle: { color: filled ? tok('--s1') : tok('--surface'), borderColor: tok('--s1'), borderWidth: 2 },
    label: { show: true, formatter: lab, position: q[0] <= xEnd * 0.1 ? 'right' : q[0] >= xEnd * 0.9 ? 'left' : below ? 'bottom' : 'top', color: tok('--ink'), fontSize: 11, fontWeight: 600 } });
  o.series = [{ type: 'line', data: C, symbol: 'none', lineStyle: { width: 2, color: tok('--s1') }, itemStyle: { color: tok('--s1') },
    markPoint: { data: [mk(at, `+${xl(a.x)} → ${fmtNum(at[1], 2)}%`, true), ...(lo[0] !== a.x && lo[0] !== tX ? [mk(lo, `lowest at ${xl(lo[0])}: ${fmtNum(lo[1], 2)}%`, false)] : []),
      ...(tq && tX !== a.x ? [mk(tq, `target at ${xl(tX)}`, false, 'diamond', tq[1] > at[1])] : [])] } },
    // the target: a dashed rule; the hidden points just above and below it keep it inside the axis, clear of the edges
    { type: 'line', name: 'Target', data: [[0, tg.T - pad], [0, tg.T + pad]], symbol: 'none', silent: true, tooltip: { show: false }, lineStyle: { opacity: 0 }, z: 1,
      markLine: { silent: true, symbol: 'none', lineStyle: { width: 1, type: 'dashed', color: tok('--muted') }, data: [{ yAxis: tg.T }],
        label: { formatter: `target ${fmtNum(tg.T, 1)}%`, position: 'insideEndTop', color: tok('--muted'), fontSize: 10.5 } } }];
  const ch = inst(c); ch.resize(); ch.setOption(o, true);
  c.csv = [['Weight added %', 'Tracking error %'], ...C.map(([x, v]) => [x, v.toFixed(3)]), [], ['Target tracking error %', tg.T]];
  setCount(c, poLabel(a.id));
  setNote(c, (lo[0] === 0 ? `Any amount of ${poTick(a.id)} would have raised the tracking error: it moves away from what the benchmark holds.`
    : lo[0] >= xEnd ? `More ${poTick(a.id)} lowered the tracking error all the way to ${xEnd}% (${fmtNum(lo[1], 2)}%).`
    : `Adding ${poTick(a.id)} lowered the tracking error until about ${xl(lo[0])} of the portfolio (${fmtNum(lo[1], 2)}%); beyond that it rises again.`)
    + ` Dashed line: the portfolio's target (${fmtNum(tg.T, 1)}%), set in the card beside this one.`);
  setSource(c, PO_SRC); poAsOf(c, W.st1.to);
}
function poRankRows(x) {   // every fund added at x%, paid for in proportion; cached per portfolio state
  const R = poCompute(); if (!R.st) return null;
  const key = R.key + '|' + x; if (state.poRank && state.poRank.key === key) return state.poRank;
  const rows = []; let skipped = 0;
  for (const bk of Object.values(poBlocks())) {
    if (bk.kind !== 'fund') continue;
    const ids = [...new Set([...R.ids, bk.id])], ser = ids.map(id => poSeries(id, R.p.ccy)); if (ser.some(s => !s)) { skipped++; continue; }
    const A = PM.pmAlign(ser, R.from); if (A.n < 52) { skipped++; continue; }
    const B = PM.pmVec(ids, R.bObj), s0 = PM.pmStats(A, PM.pmVec(ids, R.wObj), B), s1 = PM.pmStats(A, PM.pmVec(ids, PM.pmAdd(R.wObj, bk.id, x, 'all')), B);
    rows.push({ id: bk.id, te: s1.te, d: s1.te - s0.te, vol: s1.volP, beta: s1.beta, corr: s1.corr, weeks: A.n });
  }
  rows.sort((p, q) => p.d - q.d);
  return (state.poRank = { key, rows, skipped });
}
function renderPoRank(c) {
  if (poWait(c)) return;
  const x = +state.poRankW, RR = poRankRows(x); if (!RR) return poEmpty(c, poCompute().reason || 'Waiting for data.');
  c.titleEl.textContent = `What ${x}% of each fund would do`;
  const rows = RR.rows, b = htmlBody(c), tb = el('tbody'), cut = !state.poRankAll && rows.length > 16, shown = cut ? [...rows.slice(0, 8), null, ...rows.slice(-6)] : rows;
  const f2 = v => v == null ? '–' : fmtNum(v, 2), d2 = v => `${v > 0.005 ? '+' : v < -0.005 ? '−' : ''}${fmtNum(Math.abs(v), 2)}`;
  for (const r of shown) {
    if (!r) { tb.append(el('tr', { class: 'grp' }, el('td', { colspan: 6 }, el('button', { type: 'button', class: 'ghost more-btn', text: `Show all ${rows.length} (${rows.length - 14} more in the middle)`, onclick: () => { state.poRankAll = true; c.render(); } })))); continue; }
    const thin = (poBlocks()[r.id] || {}).thin > PO_THIN;
    tb.append(el('tr', { class: 'row' + (r.id === state.poAdd.id ? ' sel' : ''), style: 'cursor:pointer', title: `Try ${poTick(r.id)} in “What if I add a fund?”`,
      onclick: () => { state.poAdd.id = r.id; PO_CARDS_ADD.forEach(k => cards[k].render()); cards.po_whatif.root.scrollIntoView({ block: 'center', behavior: 'smooth' }); } },
      el('td', { class: 'l' }, poLabel(r.id), el('span', { class: 'cell-sub' }, poSub(r.id), thin ? el('span', { class: 'po-thin', text: 'thinly traded' }) : '')),
      el('td', { class: 'num', text: poPct(r.te, 2) }), el('td', { class: 'num strong', text: d2(r.d) }), el('td', { class: 'num', text: poPct(r.vol) }), el('td', { class: 'num', text: f2(r.beta) }), el('td', { class: 'num', text: f2(r.corr) })));
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, ...[`Fund, at ${x}% of the portfolio`, 'Tracking error', 'Change, pts', 'Volatility', 'Beta', 'Correlation'].map((h, i) => el('th', { class: i ? '' : 'l', text: h })))), tb)),
    el('div', { class: 'card-foot' }, el('span', { text: 'Arithmetic on past returns, not a recommendation.' })));
  if (state.poRankAll && rows.length > 16) b.append(el('button', { type: 'button', class: 'ghost more-btn', text: 'Show fewer', onclick: () => { state.poRankAll = false; c.render(); } }));
  setCount(c, `${rows.length} funds`);
  c.csv = [['Fund', 'Ticker', `Tracking error with ${x}% added %`, 'Change pts', 'Volatility %', 'Beta', 'Correlation', 'Weeks'], ...rows.map(r => [poLabel(r.id), poTick(r.id), r.te.toFixed(3), r.d.toFixed(3), r.vol.toFixed(2), r.beta, r.corr, r.weeks])];
  const R = poCompute();
  setNote(c, (cut ? `The eight funds that would have lowered the tracking error most and the six that would have raised it most, of ${rows.length}. ` : '')
    + `Each fund added at ${x}% of ${R.p.name}, paid for by every other holding in proportion, against ${poBenchName(R.p)}, over the same window as Portfolio (or shorter where a fund's history is). Click a row to try it above.`
    + (RR.skipped ? ` ${RR.skipped} fund${RR.skipped > 1 ? 's are' : ' is'} left out: fewer than 52 weeks in common.` : ''));
  setSource(c, PO_SRC); poAsOf(c, R.st.to);
}
function buildAddFund(g) {
  makeCard(g, { key: 'po_whatif', title: 'What if I add a fund?', range: false, render: renderPoWhatIf });
  makeCard(g, { key: 'po_curve', title: 'Tracking error by weight added', range: false, render: renderPoCurve });
  makeCard(g, { key: 'po_rank', title: 'What 10% of each fund would do', wide: true, range: false, seg: { key: 'poRankW', options: [['5', '5%'], ['10', '10%'], ['20', '20%']] }, render: renderPoRank });
  for (const k of ['po_whatif', 'po_rank']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
}
SUBTABS.alloc.push(['Add a fund', ['po_whatif', 'po_curve', 'po_rank']]);
