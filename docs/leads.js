// ------------------------------------------------------------------ LEADING INDICATORS (WP51 to WP62, owner's request, 13 Nov 2026)
// Loaded after more.js; uses the helpers in app.js (leadStats, llSeries, monthlyOf, leadCard, drawLines, drawPair …).
// Rule for every page here: a series is called a lead only if the dashboard's own test agrees (leadStats: lead ≥ 2
// months, |correlation| ≥ 0.40 and ≥ 0.05 above the same month, same sign in both halves). Everything else is shown
// in grey as "context", with the reason. Data: data/leads.json (pipeline/leads.py) plus FRED and Yahoo series.
'use strict';

let LEADS = null, ldLoading = null;
function loadLeads() {
  if (!ldLoading) ldLoading = loadJSON('data/leads.json').then(d => { LEADS = d;
    for (const [id, x] of Object.entries(d)) if (!id.startsWith('_') && x && x.d) { S[id] = { id, ...x, t: x.d.map(v => v * DAY), v: x.v }; delete S[id].d; }
    ldLeadCache.clear(); return d; }).catch(() => { LEADS = { _meta: {} }; return LEADS; });
  return ldLoading;
}
const ldWait = c => { if (LEADS) return false; loadLeads().then(() => c.render()); setEmpty(c, 'Loading…'); return true; };
const SUB_PREV = Object.fromEntries(['us', 'regime', 'my', 'asia'].map(t => [t, SUBTABS[t].map(x => x[0])]));   // order before WP52, for old links

// ------------------------------------------------------------------ the lead test, searched over 2 to 18 months
const ldLeadCache = new Map();
function ldBestLead(a, ma, b, mb) {   // the best-correlated shift that passes the rule; else the best-correlated one, graded
  const key = [a, ma, b, mb].join('|'); if (ldLeadCache.has(key)) return ldLeadCache.get(key);
  let out = null;
  if (has(a, b)) {
    const A = llSeries(a, ma), B = llSeries(b, mb), cand = [];
    for (let k = 2; k <= 18; k++) { const r = llCorrAt(A, B, k); if (r != null) cand.push([k, r]); }
    cand.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
    for (const [k] of cand.slice(0, 6)) { const st = leadStats(a, ma, b, mb, k); if (!st) continue; if (st.ok) { out = st; break; } if (!out) out = st; }
    if (!out) out = { short: true, n: A.size };
    else if (out.ok && out.n < 144) out = { ...out, ok: false, thin: true, verdict: 'Thin evidence' };   // under 12 years of overlap: shown, not counted
  } else out = { missing: true };
  ldLeadCache.set(key, out); return out;
}
const ldWhy = st => !st || st.missing ? 'no data yet' : st.short ? 'history too short' : st.ok ? '' : st.thin ? `thin evidence (${Math.round(st.n / 12)} years)` : st.verdict === 'Moves together' ? 'moves in the same month'
  : st.verdict === 'Market leads the data' ? 'follows rather than leads' : 'no stable link';
const ldWhyP = st => ldWhy(st).replace(/^moves/, 'move').replace(/^follows/, 'follow');   // for plural subjects
const ldMeasured = st => st && st.ok ? `${st.k} m · ${corrF(st.rk)}` : 'context: ' + ldWhy(st);

// ------------------------------------------------------------------ the registry: one row per indicator (WP52)
// id, mode (level · yoy · chg6 · chg12), name, group, lead: [target id, mode, name, up = a rise in the target is good],
// claim = what strategists say, home = [tab, sub-tab] where the indicator's chart lives, sign = claimed direction of the link
const LB_GROUPS = ['Growth', 'Jobs', 'Inflation', 'Global & Asia', 'Markets'];
const PAY = ['PAYEMS', 'yoy', 'payrolls', true], UNR = ['UNRATE', 'chg12', 'unemployment', false], IPY = ['INDPRO', 'yoy', 'industrial output', true];
const ISM = ['ISM_BAL', 'level', 'the ISM', true], CPIY = ['CPI', 'yoy', 'CPI inflation', true], GOODS = ['CPI_GOODS', 'yoy', 'core goods prices', true];
const LB_ROWS = [
  // Growth: the US business-cycle sequence starts with housing, orders and credit
  { id: 'PERMIT1', mode: 'yoy', name: 'Single-family permits', group: 'Growth', lead: PAY, claim: '12–18 m (housing turns first)', home: ['us', 'Cycle sequence'] },
  { id: 'MSACSR', mode: 'level', name: 'New homes for sale, months’ supply', group: 'Growth', lead: UNR, sign: 1, claim: 'rising supply precedes job losses', home: ['us', 'Cycle sequence'] },
  { id: 'HSN1F', mode: 'yoy', name: 'New home sales', group: 'Growth', lead: PAY, claim: '12 m+', home: ['us', 'Housing & consumer'] },
  { id: 'LD_OI_PHI', mode: 'level', name: 'Factory orders minus inventories', group: 'Growth', lead: IPY, claim: '3–6 m ahead of the ISM', home: ['us', 'Cycle sequence'] },
  { id: 'LD_BASKET_LEAD', mode: 'level', name: 'Cycle: Leading basket', group: 'Growth', lead: ['LD_BASKET_AGG', 'level', 'the Aggregate basket', true], claim: 'turns before the economy', home: ['us', 'Cycle sequence'] },
  { id: 'LEI_6M', mode: 'level', name: 'Dashboard leading index, 6M change', group: 'Growth', lead: PAY, claim: '6–9 m', home: ['regime', 'Indicators'] },
  { id: 'NEWORDER', mode: 'yoy', name: 'Core capital-goods orders', group: 'Growth', lead: IPY, claim: '3–6 m', home: ['us', 'ISM'] },
  { id: 'CURVE_3m10y_LONG', mode: 'level', name: 'Yield curve, 10Y − 3M', group: 'Growth', lead: UNR, sign: -1, claim: '6–24 m (inversions before recessions)', home: ['fixed', 'Curves'] },
  { id: 'BAA_10Y', mode: 'chg12', name: 'Corporate bond spread (Baa), 12M change', group: 'Growth', lead: PAY, sign: -1, claim: 'wider spreads lead job cuts', home: ['stress', 'Credit cycle'] },
  { id: 'SLOOS_CI', mode: 'level', name: 'Banks tightening loan standards', group: 'Growth', lead: PAY, sign: -1, claim: '2–4 quarters', home: ['stress', 'Credit cycle'] },
  { id: 'NFCI', mode: 'level', name: 'Financial conditions (Chicago Fed)', group: 'Growth', lead: PAY, sign: -1, claim: '6 m', home: ['liquidity', 'Credit, money & rates'] },
  { id: 'M2REAL', mode: 'yoy', name: 'Real M2 money', group: 'Growth', lead: IPY, claim: '6–12 m (monetarist)', home: ['us', 'Cycle sequence'] },
  { id: 'UMCSENT', mode: 'chg12', name: 'Consumer sentiment, 12M change', group: 'Growth', lead: ['RETAIL_REAL', 'yoy', 'real retail sales', true], claim: 'spending follows mood', home: ['us', 'Housing & consumer'] },
  // Jobs
  { id: 'AWOTMAN', mode: 'chg6', name: 'Factory overtime hours, 6M change', group: 'Jobs', lead: PAY, claim: 'firms cut hours before people', home: ['us', 'Labour leads'] },
  { id: 'AWHMAN', mode: 'chg6', name: 'Factory weekly hours, 6M change', group: 'Jobs', lead: PAY, claim: '3–6 m', home: ['us', 'Labour leads'] },
  { id: 'CLAIMS', mode: 'yoy', name: 'Initial jobless claims', group: 'Jobs', lead: UNR, sign: 1, claim: 'a 20%+ rise warns of recession', home: ['us', 'Growth & jobs'] },
  { id: 'TEMPHELPS', mode: 'yoy', name: 'Temporary help jobs', group: 'Jobs', lead: PAY, claim: '3–6 m (temps go first)', home: ['us', 'Labour leads'] },
  { id: 'JOLTS', mode: 'yoy', name: 'Job openings (JOLTS)', group: 'Jobs', lead: PAY, claim: 'demand for workers turns first', home: ['us', 'Labour leads'] },
  { id: 'FT_EMP', mode: 'yoy', name: 'Full-time jobs', group: 'Jobs', lead: UNR, sign: -1, claim: 'full-time falls before part-time', home: ['us', 'Labour leads'] },
  { id: 'RES_JOBS', mode: 'yoy', name: 'Residential construction jobs', group: 'Jobs', lead: PAY, claim: 'cyclical jobs go first', home: ['us', 'Cycle sequence'] },
  { id: 'QUITS', mode: 'level', name: 'Quits rate', group: 'Jobs', lead: ['WAGE_ATL', 'level', 'wage growth', true], claim: 'about 9 m ahead of wages', home: ['us', 'Labour leads'] },
  // Inflation, early to late (stage = position in the pipeline)
  { id: 'WTI_LONG', mode: 'yoy', name: 'Oil (WTI)', group: 'Inflation', stage: 'Early', lead: CPIY, claim: '1–3 m', home: ['markets', 'Commodities'] },
  { id: 'GSCPI', mode: 'level', name: 'Supply-chain pressure (NY Fed)', group: 'Inflation', stage: 'Early', lead: GOODS, claim: '3–6 m into goods prices', home: ['us', 'Inflation pipeline'] },
  { id: 'PHILLY_PP', mode: 'level', name: 'Factory prices paid (Philadelphia Fed)', group: 'Inflation', stage: 'Early', lead: CPIY, claim: '3–6 m', home: ['us', 'Inflation pipeline'] },
  { id: 'IMPORT_PX', mode: 'yoy', name: 'Import prices', group: 'Inflation', stage: 'Middle', lead: GOODS, claim: '3 m', home: ['us', 'Inflation pipeline'] },
  { id: 'PPI_FD', mode: 'yoy', name: 'Producer prices', group: 'Inflation', stage: 'Middle', lead: CPIY, claim: '1–3 m', home: ['us', 'Inflation pipeline'] },
  { id: 'ZORI_US', mode: 'yoy', name: 'Asking rents (Zillow)', group: 'Inflation', stage: 'Middle', lead: ['CPI_SHELTER', 'yoy', 'CPI shelter', true], claim: 'about 12 m (SF Fed)', home: ['us', 'Inflation pipeline'] },
  { id: 'WAGE_ATL', mode: 'level', name: 'Wage growth (Atlanta Fed)', group: 'Inflation', stage: 'Late', lead: ['STICKY_CPI', 'level', 'sticky CPI', true], claim: 'wages feed services prices', home: ['us', 'Labour leads'] },
  { id: 'ULC', mode: 'yoy', name: 'Unit labour costs', group: 'Inflation', stage: 'Late', lead: ['CORE_CPI', 'yoy', 'core CPI', true], claim: '2–4 quarters', home: ['us', 'Inflation pipeline'] },
  { id: 'MICH', mode: 'level', name: 'Households’ 1Y inflation expectations', group: 'Inflation', stage: 'Late', lead: CPIY, claim: 'expectations feed wage demands', home: ['us', 'Inflation pipeline'] },
  // Global & Asia
  { id: 'LD_CLI_DIFF', mode: 'level', name: 'Leading indices rising (17 economies)', group: 'Global & Asia', lead: ['BCI_G7', 'level', 'G7 business confidence', true], claim: 'breadth turns before industry', home: ['regime', 'Global breadth & money'] },
  { id: 'LD_RNM6', mode: 'level', name: 'Global real narrow money (ex-China)', group: 'Global & Asia', lead: ['BCI_G7', 'level', 'G7 business confidence', true], claim: '6–9 m (Simon Ward)', home: ['regime', 'Global breadth & money'] },
  { id: 'CLI_USA', mode: 'chg6', name: 'US leading index (OECD)', group: 'Global & Asia', lead: IPY, claim: '6 m', home: ['regime', 'Indicators'] },
  { id: 'CLI_CHN', mode: 'chg6', name: 'China leading index (OECD)', group: 'Global & Asia', lead: ['COPPER', 'yoy', 'copper', true], claim: '6 m', home: ['asia', 'What leads'] },
  { id: 'LD_CN_IMPULSE', mode: 'level', name: 'China credit impulse (BIS)', group: 'Global & Asia', lead: ['COPPER', 'yoy', 'copper', true], claim: '9–12 m (arrives a year late)', home: ['cn', 'Economy'] },
  { id: 'LD_ASIA_PULSE', mode: 'level', name: 'Asian trade pulse', group: 'Global & Asia', lead: ['AAXJ', 'yoy', 'Asia ex-Japan equities', true], claim: 'early exporters move first', home: ['asia', 'Trade pulse'] },
  { id: 'TW_ORDERS_YOY', mode: 'level', name: 'Taiwan export orders', group: 'Global & Asia', lead: ['TW_EXP_YOY', 'level', 'Taiwan exports', true], claim: '1–3 m', home: ['tw', 'Economy'] },
  { id: 'KR_EXP_YOY', mode: 'level', name: 'Korea exports', group: 'Global & Asia', lead: ['TWSE', 'yoy', 'Taiwan equities', true], claim: 'the global trade bellwether', home: ['kr', 'Economy'] },
  { id: 'MY_LEADING', mode: 'yoy', name: 'Malaysia leading index (DOSM)', group: 'Global & Asia', lead: ['MY_IPI_YOY', 'level', 'Malaysian output', true], claim: '6 m (DOSM)', home: ['my', 'Economy'] },
  // Markets: price ratios that tend to turn before the economy (the ratio charts live on Markets → Trend)
  { id: 'CAN_XHB', mode: 'yoy', name: 'Homebuilders ÷ S&P 500', group: 'Markets', lead: PAY, claim: 'housing, 6–12 m', home: ['regime', 'Market signals'] },
  { id: 'CAN_KBE', mode: 'yoy', name: 'Banks ÷ S&P 500', group: 'Markets', lead: PAY, claim: 'credit supply', home: ['regime', 'Market signals'] },
  { id: 'CAN_SOX', mode: 'yoy', name: 'Semiconductors ÷ S&P 500', group: 'Markets', lead: ISM, claim: 'ISM and Asian exports, 3–6 m', home: ['regime', 'Market signals'] },
  { id: 'CAN_XLY_XLP', mode: 'yoy', name: 'Discretionary ÷ staples', group: 'Markets', lead: ISM, claim: 'consumer cycle', home: ['regime', 'Market signals'] },
  { id: 'CAN_SPHB_SPLV', mode: 'yoy', name: 'High beta ÷ low volatility', group: 'Markets', lead: ISM, claim: 'risk appetite', home: ['regime', 'Market signals'] },
  { id: 'CAN_IYT_XLU', mode: 'yoy', name: 'Transports ÷ utilities', group: 'Markets', lead: ISM, claim: 'Dow theory: goods moving', home: ['regime', 'Market signals'] },
  { id: 'LB_CUGOLD', mode: 'yoy', name: 'Copper ÷ gold', group: 'Markets', lead: ['GS10', 'chg12', 'the 10Y yield', true], claim: 'yields, 3–6 m', home: ['regime', 'Market signals'] },
  { id: 'SPX', mode: 'yoy', name: 'S&P 500', group: 'Markets', lead: ISM, claim: 'part of the official leading index', home: ['us', 'Equities'] },
];
function ldDerived() {   // ratios the board needs that no file holds
  if (!S.LB_CUGOLD && has('COPPER', 'GOLD')) { const r = combine(S.COPPER, S.GOLD, (a, b) => a / b, {}, 5 * DAY); S.LB_CUGOLD = { ...r, id: 'LB_CUGOLD', label: 'Copper ÷ gold', kind: 'price', source: 'Yahoo Finance (HG=F ÷ GC=F)' }; }
}

// ------------------------------------------------------------------ reading a row: latest value, direction, percentile, verdict
const ldFmt = (row, v) => v == null || !isFinite(v) ? '–' : row.mode === 'yoy' ? pctF1(v) : row.mode === 'level'
  ? (v < 0 ? '−' : '') + fmtNum(Math.abs(v), Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2) + ((S[row.id] || {}).unit === '%' ? '%' : '') : sign(v) + fmtNum(Math.abs(v), Math.abs(v) >= 10 ? 1 : 2);
function ldRead(row, back = 0) {   // back = months earlier (for "turned this month" and the breadth history)
  if (!has(row.id)) return null;
  const m = monthlyOf(row.id, row.mode), n = m.t.length - 1 - back; if (n < 12) return null;
  const v = m.v[n], t = m.t[n], d3 = v - m.v[n - 3], d6 = v - m.v[n - 6];
  const lo = addMonths(t, -120), w = [], dd = [];
  for (let i = 0; i <= n; i++) if (m.t[i] >= lo) { w.push(m.v[i]); if (i >= 3) dd.push(Math.abs(m.v[i] - m.v[i - 3])); }
  const pct = w.filter(x => x <= v).length / w.length * 100, noise = dd.length ? dd.sort((a, b) => a - b)[Math.floor(dd.length / 2)] * 0.25 : 0;
  const st = ldBestLead(row.id, row.mode, row.lead[0], row.lead[1]), tested = !!(st && st.ok);
  const link = tested ? Math.sign(st.rk) : (row.sign || 1), good = row.lead[3] === false ? -1 : 1;
  const dir = Math.abs(d3) <= noise ? 0 : Math.sign(d3) * link * good;   // +1 = points to a better outcome for what it leads
  return { v, t, d3, d6, pct, st, tested, dir, n: n + 1 };
}
const ldWord = (row, dir) => row.group === 'Inflation' ? (dir > 0 ? 'rising' : dir < 0 ? 'easing' : 'flat') : (dir > 0 ? 'improving' : dir < 0 ? 'deteriorating' : 'flat');
const ldArrow = v => v == null ? '–' : v > 0 ? '▲' : v < 0 ? '▼' : '▬';
let ldBoardCache = null;
function ldBoard() {   // every row read once per data load
  if (ldBoardCache && ldBoardCache.at === state.latest && ldBoardCache.n === Object.keys(S).length) return ldBoardCache.rows;
  ldDerived();
  const rows = LB_ROWS.map(row => ({ row, r: ldRead(row) })).filter(x => x.r);
  ldBoardCache = { at: state.latest, n: Object.keys(S).length, rows }; return rows;
}
function ldCount(rows, groups) {   // tested leads only: improving (or rising, for inflation) of all
  const L = rows.filter(x => groups.includes(x.row.group) && x.r.tested);
  return { up: L.filter(x => x.r.dir > 0).length, n: L.length, down: L.filter(x => x.r.dir < 0).length };
}
const LB_GROWTH = ['Growth', 'Jobs', 'Global & Asia', 'Markets'];
function lbSummary() {   // one line for the Strategist View and the Weekly brief
  if (!LEADS) return null;
  const rows = ldBoard(), a = ldCount(rows, LB_GROWTH); if (!a.n) return null;
  const g = ldCount(rows, ['Growth', 'Jobs']), w = ldCount(rows, ['Global & Asia']), m = ldCount(rows, ['Markets']), i = ldCount(rows, ['Inflation']);
  return `${a.up} of ${a.n} tested leads improving (US growth and jobs ${g.up} of ${g.n}, global and Asia ${w.up} of ${w.n}, market canaries ${m.up} of ${m.n})`
    + (i.n ? `; inflation leads ${i.up} of ${i.n} rising.` : '.');
}
function lbSummaryEl(rerender) {
  if (!LEADS) { loadLeads().then(rerender); return null; }
  const s = lbSummary(); if (!s) return null;
  return el('p', { class: 'small lb-line' }, el('b', { text: 'Leads · ' }), s + ' ',
    el('a', { href: '#', text: 'Leading board →', onclick: e => { e.preventDefault(); goSub('regime', 'Leading board'); } }));
}

// ------------------------------------------------------------------ WP52. Leading board (Regime & Leading → Leading board)
state.lbView = 'Growth';
function renderLbTable(c) {
  if (ldWait(c)) return;
  const b = htmlBody(c), view = state.lbView, rows = ldBoard().filter(x => x.row.group === view)
    .sort((x, y) => (y.r.tested - x.r.tested) || (x.row.stage && y.row.stage ? ['Early', 'Middle', 'Late'].indexOf(x.row.stage) - ['Early', 'Middle', 'Late'].indexOf(y.row.stage) : 0));
  const heads = ['Indicator', 'Latest', '3M', '6M', 'Pct (10Y)', 'Leads', 'Claimed', 'Measured', 'Read'], tb = el('tbody'), csv = [heads];
  let ctxShown = false;
  for (const { row, r } of rows) {
    if (!r.tested && !ctxShown) { ctxShown = true; tb.append(el('tr', { class: 'grp' }, el('td', { colspan: heads.length, text: 'Context: shown, but not counted (no stable lead on the dashboard’s test)' }))); }
    const st = r.st, word = ldWord(row, r.dir), [tab, sub] = row.home;
    const tip = (st && st.thin ? `Passes the lead test at ${st.k} months (${corrF(st.rk)} against ${corrF(st.r0)} in the same month) but on only ${Math.round(st.n / 12)} years of history, so it is shown and not counted.`
      : st && !st.missing && !st.short ? leadNote({ ...st, a: row.id }, row.name, row.lead[2]) : `Not tested: ${ldWhy(st)}.`) + ` Data to ${monthLab(r.t)}. Click to open its chart.`;
    tb.append(el('tr', { class: 'row' + (r.tested ? '' : ' ld-ctx'), style: 'cursor:pointer', title: tip, onclick: () => goSub(tab, sub) },
      el('td', { class: 'l', text: row.name }), el('td', { class: 'num strong', text: ldFmt(row, r.v) }),
      el('td', { class: 'num', text: ldArrow(r.d3) }), el('td', { class: 'num', text: ldArrow(r.d6) }), el('td', { class: 'num', text: ordF(r.pct) }),
      el('td', { class: 'l', text: row.lead[2] }), el('td', { class: 'l muted', text: row.claim }), el('td', { class: 'l', text: ldMeasured(st) }),
      el('td', { class: 'num ' + (r.dir > 0 ? (row.group === 'Inflation' ? 'dn' : 'up') : r.dir < 0 ? (row.group === 'Inflation' ? 'up' : 'dn') : ''), text: word })));
    csv.push([row.name, r.v, r.d3, r.d6, r.pct, row.lead[2], row.claim, ldMeasured(st), word, monthLab(r.t)]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table ld-table' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: [0, 5, 6, 7].includes(i) ? 'l' : '' })))), tb)));
  capRows(tb, 'lb_table_' + view, 16);
  c.csv = csv;
  const k = ldCount(ldBoard(), [view]);
  setNote(c, `${view}: ${k.up} of ${k.n} tested leads ${view === 'Inflation' ? 'point to rising inflation' : 'point to improvement'}, ${k.down} the other way. `
    + 'Measured = the lead the dashboard finds on the full history (months, then the correlation at that lead), searched over 2 to 18 months; it counts only if it is at least 0.40, beats the same-month figure by 0.05 and holds in both halves of the history. Grey rows fail that test: they are still worth watching, but are not counted. Claimed = what strategists usually say. 3M and 6M = direction of the indicator; Read = what that direction implies for what it leads (inflation rows read rising or easing). Hover a row for the full test; click it to open its chart.');
  setSource(c, 'FRED, OECD, NY Fed, Zillow, Yahoo Finance, DOSM via data.gov.my; lead tests calculated by the dashboard');
}
function ldHistory(groups, months = 120) {   // share of tested leads improving at each month-end (tests use the full history: a description, not a back-test)
  const rows = ldBoard().filter(x => groups.includes(x.row.group) && x.r.tested), out = { t: [], v: [] };
  if (!rows.length) return out;
  const ser = rows.map(({ row, r }) => { const m = monthlyOf(row.id, row.mode); return { m, at: new Map(m.t.map((t, i) => [t, i])), link: Math.sign(r.st.rk) * (row.lead[3] === false ? -1 : 1) }; });
  const end = Math.max(...ser.map(x => x.m.t[x.m.t.length - 1]));
  for (let j = months; j >= 0; j--) {
    const t = addMonths(end, -j); let up = 0, n = 0;
    for (const { m, at, link } of ser) { const i = at.has(t) ? at.get(t) : -1; if (i < 3) continue; n++; if (Math.sign(m.v[i] - m.v[i - 3]) * link > 0) up++; }
    if (n >= Math.max(3, rows.length * 0.6)) { out.t.push(t); out.v.push(up / n * 100); }
  }
  return out;
}
state.lbBreadth = 'groups';
function renderLbBreadth(c) {
  if (ldWait(c)) return;
  const yrs = Math.max(3, Math.round((state.to - state.from) / (365.25 * DAY))), mo = Math.min(240, yrs * 12);
  if (state.lbBreadth === 'spx') {
    const all = ldHistory(LB_GROWTH, mo); if (!all.t.length || !has('SPX')) return setEmpty(c, 'Waiting for data.');
    drawPair(c, { name: 'Tested leads improving, % (growth, global, markets)', data: pts(all, state.from, state.to) }, { name: 'S&P 500, % YoY', data: pts(yoyOf('SPX', 12), state.from, state.to) },
      { fmtA: v => fmtNum(v, 0) + '%', fmtB: pctF1, axisA: v => fmtNum(v, 0) + '%', axisB: v => fmtNum(v, 0) + '%', zeroB: true });
  } else {
    const L = [['All growth leads', LB_GROWTH], ['US growth & jobs', ['Growth', 'Jobs']], ['Global & Asia', ['Global & Asia']], ['Market canaries', ['Markets']], ['Inflation (rising)', ['Inflation']]]
      .map(([name, g]) => ({ name, data: pts(ldHistory(g, mo), state.from, state.to) })).filter(x => x.data.length);
    if (!L.length) return setEmpty(c, 'Waiting for data.');
    drawLines(c, L, { fmt: v => fmtNum(v, 0) + '%', axisFmt: v => fmtNum(v, 0) + '%', hlines: [{ y: 50 }], endLabels: false, areas: recessionAreas(state.from, state.to) });
  }
  setNote(c, 'The breadth of the leads: the share of tested leads whose 3-month direction points to improvement (for inflation: to rising prices). Readings below 50% for several months have come before slowdowns; a rebound from below 30% before recoveries. The leads are chosen with the full history, so this is a description of the past, not a back-tested signal. Shaded: US recessions.');
  setSource(c, 'Dashboard calculation from the Leading board’s tested rows');
}
function renderLbChanges(c) {
  if (ldWait(c)) return;
  const b = htmlBody(c), out = [];
  for (const { row, r } of ldBoard()) { const p = ldRead(row, 1); if (!p || p.dir === r.dir || r.dir === 0) continue; out.push({ row, r, p }); }
  out.sort((x, y) => (y.r.t - x.r.t) || (y.r.tested - x.r.tested));
  if (!out.length) { b.append(el('div', { class: 'empty', text: 'No lead changed direction in its latest month.' })); return; }
  const tb = el('tbody'), csv = [['Indicator', 'Turned', 'Data month', 'Tested lead']];
  for (const { row, r } of out.slice(0, 14)) {
    tb.append(el('tr', { class: 'row' + (r.tested ? '' : ' ld-ctx'), style: 'cursor:pointer', title: 'Click to open its chart', onclick: () => goSub(...row.home) },
      el('td', { class: 'l', text: row.name }), el('td', { class: 'num ' + ((r.dir > 0) !== (row.group === 'Inflation') ? 'up' : 'dn'), text: (r.dir > 0 ? '▲ ' : '▼ ') + ldWord(row, r.dir) }),
      el('td', { class: 'num muted', text: monthLab(r.t) }), el('td', { class: 'num', text: r.tested ? 'yes' : 'context' })));
    csv.push([row.name, ldWord(row, r.dir), monthLab(r.t), r.tested ? 'yes' : 'context']);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf watch' }, el('thead', {}, el('tr', {}, ...['Indicator', 'Turned', 'Data', 'Tested'].map((h, i) => el('th', { text: h, class: i ? '' : 'l' })))), tb)));
  c.csv = csv;
  setNote(c, 'Leads whose 3-month direction changed in their latest month, newest data first. One turn is noise until it lasts; grey rows are context, not tested leads.');
  setSource(c, 'Dashboard calculation');
}
function lbTiles() {
  const box = $('#regKpis'), sub = (SUBTABS.regime[state.sub.regime || 0] || [])[0]; if (!box || sub !== 'Leading board') return;
  if (!LEADS) { loadLeads().then(() => state.tab === 'regime' && renderTab()); return; }
  box.querySelectorAll('.kpi').forEach(k => { k.hidden = true; });
  const rows = ldBoard(), back = ldBoard3m(), tile = (l, v, d, f) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: l }), el('div', { class: 'k-value', text: v }), el('div', { class: 'k-delta', text: d }), el('div', { class: 'k-asof', text: f })));
  for (const [lab, g, word] of [['Tested leads improving', LB_GROWTH, 'improving'], ['US growth & jobs leads', ['Growth', 'Jobs'], 'improving'], ['Inflation leads rising', ['Inflation'], 'rising'],
    ['Global & Asia leads', ['Global & Asia'], 'improving'], ['Market canaries', ['Markets'], 'improving']]) {
    const k = ldCount(rows, g), p = ldCount(back, g); if (!k.n) continue;
    tile(lab, `${k.up} of ${k.n}`, `3M ago: ${p.up} of ${p.n} ${word}`, 'tested leads only');
  }
}
function ldBoard3m() { return LB_ROWS.map(row => ({ row, r: ldRead(row, 3) })).filter(x => x.r); }

// ------------------------------------------------------------------ WP53. US cycle sequence (US → Cycle sequence)
const CS_BASKETS = [['LD_BASKET_LEAD', 'Leading'], ['LD_BASKET_CYC', 'Cyclical'], ['LD_BASKET_AGG', 'Aggregate'], ['LD_BASKET_LAG', 'Lagging']];
const CS_COMP = [   // [basket, id, name, transform: g6 (6M annualised growth) · d6 (6M change) · lvl (level), sign]
  ['Leading', 'PERMIT1', 'Single-family permits', 'g6', 1], ['Leading', 'LD_OI_PHI', 'Orders minus inventories', 'lvl', 1], ['Leading', 'M2REAL', 'Real M2', 'g6', 1],
  ['Leading', 'T10YFF', '10Y − fed funds', 'lvl', 1], ['Leading', 'AWHMAN', 'Factory weekly hours', 'd6', 1],
  ['Cyclical', 'RES_JOBS', 'Residential construction jobs', 'g6', 1], ['Cyclical', 'DMANEMP', 'Durable-goods jobs', 'g6', 1], ['Cyclical', 'HTRUCKS', 'Heavy truck sales', 'g6', 1],
  ['Cyclical', 'HSN1F', 'New home sales', 'g6', 1], ['Cyclical', 'NEWORDER', 'Core capital-goods orders', 'g6', 1],
  ['Aggregate', 'PAYEMS', 'Payrolls', 'g6', 1], ['Aggregate', 'REALINC_XT', 'Real income less transfers', 'g6', 1], ['Aggregate', 'RETAIL_REAL', 'Real retail sales', 'g6', 1], ['Aggregate', 'INDPRO', 'Industrial production', 'g6', 1],
  ['Lagging', 'UNRATE', 'Unemployment rate (inverted)', 'd6', -1], ['Lagging', 'CORE_CPI', 'Core CPI', 'g6', 1],
];
function csTransform(id, how) {   // monthly, from the 3-month average
  const m = monthlyOf(id, 'level'), t = [], v = [], a = [];
  for (let i = 2; i < m.v.length; i++) a.push([m.t[i], (m.v[i] + m.v[i - 1] + m.v[i - 2]) / 3]);
  for (let i = 0; i < a.length; i++) {
    if (how === 'lvl') { t.push(a[i][0]); v.push(a[i][1]); continue; }
    if (i < 6) continue; const p = a[i - 6][1];
    if (how === 'g6' && p > 0) { t.push(a[i][0]); v.push((Math.pow(a[i][1] / p, 2) - 1) * 100); } else if (how === 'd6') { t.push(a[i][0]); v.push(a[i][1] - p); }
  }
  return { t, v, avg: a };
}
const runOf = s => { const n = s.v.length - 1, sg = Math.sign(s.v[n]); let k = n; while (k > 0 && Math.sign(s.v[k - 1]) === sg) k--; return { sg, months: n - k + 1, since: s.t[k] }; };
function renderCsBaskets(c) {
  if (ldWait(c)) return;
  const L = CS_BASKETS.filter(([id]) => has(id)); if (!L.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, L.map(([id, n]) => ({ name: n + ' basket', data: pts(S[id], state.from, state.to) })), { fmt: zf, axisFmt: v => fmtNum(v, 1), zero: true, endLabels: false, areas: recessionAreas(state.from, state.to) });
  const desc = L.map(([id, n]) => { const r = runOf(S[id]); return `${n} ${r.sg >= 0 ? 'above' : 'below'} its usual pace for ${r.months} month${r.months === 1 ? '' : 's'}`; });
  const st = ldBestLead('LD_BASKET_LEAD', 'level', 'LD_BASKET_AGG', 'level');
  setNote(c, `Where the sequence stands: ${desc.join('; ')}. `
    + `Recessions have followed the order Leading → Cyclical → Aggregate → Lagging: housing, orders and money turn first, then the cyclical jobs and big-ticket purchases, then the whole economy, and inflation and unemployment last. On this history the Leading basket ${st && st.ok ? `has led the Aggregate basket by ${st.k} months (correlation ${corrF(st.rk)} against ${corrF(st.r0)} in the same month)` : `is ${ldWhy(st)} against the Aggregate basket`}. `
    + 'The Cyclical basket moves in the same month as payrolls on the dashboard’s test, so read it as confirmation, not warning. Each basket averages its components’ six-month change, each measured in standard deviations from its own past (using only data available at the time), so 0 is the usual pace and below 0 means slower than usual, not shrinking. Shaded: US recessions.');
  setSource(c, 'FRED (permits, regional Fed surveys, money, curve, hours, jobs, trucks, orders, income, retail sales, output, unemployment, CPI); calculated (method after EPB Macro Research)');
}
function renderCsTable(c) {
  const b = htmlBody(c), heads = ['Component', 'Basket', '6M change', 'Since its peak', 'Flag'], tb = el('tbody'), csv = [heads];
  let grp = null;
  for (const [bk, id, name, how, sg] of CS_COMP) {
    if (!has(id)) continue;
    const x = csTransform(id, how); if (!x.v.length) continue;
    const v = x.v[x.v.length - 1] * sg, a = x.avg, n = a.length - 1, lo = addMonths(a[n][0], -60);
    let pk = n; for (let i = n; i >= 0 && a[i][0] >= lo; i--) if (sg > 0 ? a[i][1] > a[pk][1] : a[i][1] < a[pk][1]) pk = i;
    const since = n - pk, flag = v < 0 && since >= 6 ? '⚠ rolled over' : v < 0 ? 'falling' : since === 0 ? 'at a 5-year high' : 'rising';
    if (bk !== grp) { grp = bk; tb.append(el('tr', { class: 'grp' }, el('td', { colspan: heads.length, text: bk })));
    }
    tb.append(el('tr', { class: 'row', title: `${S[id].label} · data to ${monthLab(a[n][0])}` }, el('td', { class: 'l', text: name }), el('td', { class: 'l muted', text: bk }),
      el('td', { class: 'num ' + (v > 0 ? 'up' : v < 0 ? 'dn' : ''), text: how === 'g6' ? pctF1(v) + ' a yr' : (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v), Math.abs(v) >= 10 ? 1 : 2) }),
      el('td', { class: 'num', text: since === 0 ? 'at peak' : since + ' m' }), el('td', { class: 'num ' + (flag.startsWith('⚠') ? 'dn' : ''), text: flag })));
    csv.push([name, bk, v, since, flag]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf watch' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i < 2 ? 'l' : '' })))), tb)));
  c.csv = csv;
  setNote(c, '6M change = six-month annualised growth of the 3-month average (levels and spreads: the change, or the level itself for the survey and the curve). Since its peak = months since the 3-month average was highest in the last 5 years. ⚠ rolled over = falling and six months or more past its peak.');
  setSource(c, 'FRED; calculated');
}
state.csHouse = 'supply';
function renderCsHousing(c) {
  if (ldWait(c)) return;
  if (state.csHouse === 'xhb') {
    if (!has('PERMIT1', 'CAN_XHB')) return setEmpty(c, 'Waiting for data.');
    drawPair(c, { name: 'Single-family permits, % YoY', data: pts(yoyOf('PERMIT1', 12), state.from, state.to) }, { name: 'Homebuilders ÷ S&P 500, % YoY', data: pts(monthlyOf('CAN_XHB', 'yoy'), state.from, state.to) },
      { fmtA: pctF1, fmtB: pctF1, axisA: v => fmtNum(v, 0) + '%', axisB: v => fmtNum(v, 0) + '%', zeroA: true, zeroB: true });
    const st = ldBestLead('CAN_XHB', 'yoy', 'PERMIT1', 'yoy');
    setNote(c, `Homebuilder shares price the housing cycle as it happens: ${st && st.ok ? `they have led permits by ${st.k} months` : `on this history they ${ldWhyP(st)} as permits`} (correlation ${st && st.r0 != null ? corrF(st.r0) : '–'} in the same month). Against payrolls the shares lead by more than a year (Leading board, Markets view).`);
  } else {
    if (!has('PERMIT1', 'MSACSR')) return setEmpty(c, 'Waiting for data.');
    drawPair(c, { name: 'Single-family permits, % YoY', data: pts(yoyOf('PERMIT1', 12), state.from, state.to) }, { name: 'New homes for sale, months’ supply', data: pts(S.MSACSR, state.from, state.to) },
      { fmtA: pctF1, fmtB: v => fmtNum(v, 1), axisA: v => fmtNum(v, 0) + '%', axisB: v => fmtNum(v, 0), zeroA: true });
    const p = ldBestLead('PERMIT1', 'yoy', 'UNRATE', 'chg12'), m = ldBestLead('MSACSR', 'level', 'UNRATE', 'chg12'), a = asOf(S.MSACSR, state.latest), y = asOf(yoyOf('PERMIT1', 12), state.latest);
    setNote(c, `Permits ${y ? (y.v >= 0 ? 'up ' : 'down ') + fmtNum(Math.abs(y.v), 1) + '% on a year' : ''}; ${a ? fmtNum(a.v, 1) : '–'} months of new homes for sale (${monthLab(a.t)}). Housing is the business cycle’s first domino: on the dashboard’s test, falling permits have led a rise in unemployment by ${p && p.ok ? p.k + ' months (' + corrF(p.rk) + ')' : '– (' + ldWhy(p) + ')'}, and a rising supply of unsold homes by ${m && m.ok ? m.k + ' months (' + corrF(m.rk) + ')' : '– (' + ldWhy(m) + ')'}. Both since the 1960s.`);
  }
  setSource(c, srcOf(state.csHouse === 'xhb' ? ['PERMIT1', 'XHB', 'SPX'] : ['PERMIT1', 'MSACSR']));
}
function renderCsFreight(c) {
  const L = [['HTRUCKS', 'Heavy truck sales'], ['TRUCK_TON', 'Truck tonnage'], ['FREIGHT_CASS', 'Cass freight shipments']].filter(([id]) => has(id))
    .map(([id, n]) => ({ name: n + ', % YoY', data: pts(yoyOf(id, 12), state.from, state.to) }));
  if (!L.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, L, { fmt: pctF1, axisFmt: v => fmtNum(v, 0) + '%', zero: true, endLabels: false, areas: recessionAreas(state.from, state.to) });
  const st = ldBestLead('HTRUCKS', 'yoy', 'UNRATE', 'chg12');
  setNote(c, `Goods have to move before they are sold: freight volumes and orders for heavy trucks track the goods economy closely. On the dashboard’s test heavy truck sales ${st && st.ok ? 'lead unemployment by ' + st.k + ' months' : ldWhyP(st) + ' as unemployment'}, so treat them as a confirmation of the cycle, not a warning. Truck tonnage and Cass shipments are freight-industry indices published through FRED. Shaded: US recessions.`);
  setSource(c, srcOf(['HTRUCKS', 'TRUCK_TON', 'FREIGHT_CASS']));
}
function csTiles(box, tile) {
  for (const [id, n] of CS_BASKETS.slice(0, 3)) if (has(id)) { const a = asOf(S[id], state.latest), b = asOf(S[id], addMonths(a.t, -3)), r = runOf(S[id]);
    tile(n + ' basket', zf(a.v), `${r.sg >= 0 ? 'above' : 'below'} usual ${r.months} m${b ? ' · 3M ago ' + zf(b.v) : ''}`, monthLab(a.t)); }
  if (has('PERMIT1')) { const y = yoyOf('PERMIT1', 12), a = asOf(y, state.latest); tile('Single-family permits', pctF1(a.v), 'year on year', monthLab(a.t)); }
  if (has('MSACSR')) { const a = asOf(S.MSACSR, state.latest), b = asOf(S.MSACSR, addMonths(a.t, -12)); tile('Months’ supply of new homes', fmtNum(a.v, 1), b ? `a year ago ${fmtNum(b.v, 1)}` : '', monthLab(a.t)); }
}

// ------------------------------------------------------------------ WP54. Labour leads (US → Labour leads)
function renderLabTemp(c) {
  const L = [['TEMPHELPS', 'Temporary help jobs'], ['FT_EMP', 'Full-time jobs'], ['PAYEMS', 'All payrolls']].filter(([id]) => has(id))
    .map(([id, n]) => ({ name: n + ', % YoY', data: pts(yoyOf(id, 12), state.from, state.to) }));
  if (!L.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, L, { fmt: pctF1, axisFmt: v => fmtNum(v, 0) + '%', zero: true, endLabels: false, areas: recessionAreas(state.from, state.to) });
  const st = ldBestLead('TEMPHELPS', 'yoy', 'PAYEMS', 'yoy'), a = asOf(yoyOf('TEMPHELPS', 12), state.latest);
  setNote(c, `Temporary help jobs ${a ? (a.v >= 0 ? 'up ' : 'down ') + fmtNum(Math.abs(a.v), 1) + '% on a year' : ''}. Temps are the first hired and the first let go, so the swings are larger, but on the dashboard’s test they ${st && st.ok ? 'lead payrolls by ' + st.k + ' months' : ldWhyP(st) + ' as payrolls (context, not a lead)'}: read a fall as confirmation that hiring is cooling, not as an early warning. Full-time jobs fall faster than part-time ones in downturns. Shaded: US recessions.`);
  setSource(c, srcOf(['TEMPHELPS', 'FT_EMP', 'PAYEMS']));
}
function renderLabPostings(c) {
  if (!has('INDEED', 'JOLTS')) return setEmpty(c, 'Waiting for data.');
  drawPair(c, { name: 'Indeed job postings (Feb 2020 = 100, daily)', data: pts(S.INDEED, state.from, state.to) }, { name: 'Job openings, JOLTS (millions)', data: pts({ t: S.JOLTS.t, v: S.JOLTS.v.map(v => v / 1000) }, state.from, state.to) },
    { fmtA: v => fmtNum(v, 1), fmtB: v => fmtNum(v, 2) + 'm', axisA: v => fmtNum(v, 0), axisB: v => fmtNum(v, 1) + 'm' });
  const a = asOf(S.INDEED, state.latest), j = asOf(S.JOLTS, state.latest);
  setNote(c, `Online job postings at ${fmtNum(a.v, 1)} (${nice(a.t)}; 100 = February 2020) against ${fmtNum(j.v / 1000, 2)} million official openings (${monthLab(j.t)}). Postings are daily and the official count arrives about six weeks late, so postings show the turn first; their history starts in 2020, too short to test as a lead.`);
  setSource(c, srcOf(['INDEED', 'JOLTS']));
}
function labTiles(box, tile) {
  const lv = (id, l, f, d) => { if (!has(id)) return; const a = asOf(S[id], state.latest), b = asOf(S[id], addMonths(a.t, -12)); tile(l, f(a.v), b ? `a year ago ${f(b.v)}` : '', d ? d(a.t) : monthLab(a.t)); };
  lv('AWOTMAN', 'Overtime hours', v => fmtNum(v, 1) + ' h'); lv('QUITS', 'Quits rate', v => fmtNum(v, 1) + '%');
  if (has('TEMPHELPS')) { const a = asOf(yoyOf('TEMPHELPS', 12), state.latest); tile('Temp help jobs', pctF1(a.v), 'year on year', monthLab(a.t)); }
  lv('INDEED', 'Job postings (Indeed)', v => fmtNum(v, 1), nice); lv('CCSA', 'Continuing claims', v => fmtNum(v / 1e6, 2) + 'm', nice);
}

// ------------------------------------------------------------------ WP55. Inflation pipeline (US → Inflation)
const INF_LATE = [['STICKY_CPI', 'level', 'Sticky-price core CPI'], ['MEDIAN_CPI', 'avg12', 'Median CPI (12-month average)'], ['TRIM_PCE', 'level', 'Trimmed-mean PCE'], ['FWD5Y5Y', 'level', 'Market 5y5y inflation expectations']];
function ldAvg12(id) { const m = monthlyOf(id, 'level'), t = [], v = []; for (let i = 11; i < m.v.length; i++) { t.push(m.t[i]); v.push(m.v.slice(i - 11, i + 1).reduce((a, b) => a + b, 0) / 12); } return { t, v }; }
function renderInfPipe(c) {
  if (ldWait(c)) return;
  const b = htmlBody(c), heads = ['Stage', 'Latest', '3M', 'Pct (10Y)', 'Feeds into', 'Measured lead', 'Read'], tb = el('tbody'), csv = [heads];
  const rows = ldBoard().filter(x => x.row.group === 'Inflation'), stages = { Early: 'Early: commodities, supply chains, factory prices', Middle: 'Middle: import, producer and rent prices', Late: 'Late: wages, costs and expectations' };
  for (const sg of ['Early', 'Middle', 'Late']) {
    tb.append(el('tr', { class: 'grp ld-' + sg.toLowerCase() }, el('td', { colspan: heads.length, text: stages[sg] })));
    for (const { row, r } of rows.filter(x => x.row.stage === sg)) {
      const w = ldWord(row, r.dir);
      tb.append(el('tr', { class: 'row' + (r.tested ? '' : ' ld-ctx'), title: (r.st && !r.st.missing && !r.st.short ? leadNote({ ...r.st, a: row.id }, row.name, row.lead[2]) : 'Not tested: ' + ldWhy(r.st)) + ` Data to ${monthLab(r.t)}.` },
        el('td', { class: 'l', text: row.name }), el('td', { class: 'num strong', text: ldFmt(row, r.v) }), el('td', { class: 'num', text: ldArrow(r.d3) }), el('td', { class: 'num', text: ordF(r.pct) }),
        el('td', { class: 'l', text: row.lead[2] }), el('td', { class: 'l', text: ldMeasured(r.st) }), el('td', { class: 'num ' + (r.dir > 0 ? 'dn' : r.dir < 0 ? 'up' : ''), text: w })));
      csv.push([row.name, r.v, r.d3, r.pct, row.lead[2], ldMeasured(r.st), w]);
    }
  }
  tb.append(el('tr', { class: 'grp' }, el('td', { colspan: heads.length, text: 'Where it ends: underlying inflation' })));
  for (const [id, how, name] of INF_LATE) {
    if (!has(id)) continue; const s = how === 'avg12' ? ldAvg12(id) : monthlyOf(id, 'level'), n = s.v.length - 1; if (n < 3) continue;
    const v = s.v[n], d3 = v - s.v[n - 3], lo = addMonths(s.t[n], -120), w = s.v.filter((x, i) => s.t[i] >= lo), pct = w.filter(x => x <= v).length / w.length * 100;
    tb.append(el('tr', { class: 'row', title: `Data to ${monthLab(s.t[n])}` }, el('td', { class: 'l', text: name }), el('td', { class: 'num strong', text: fmtNum(v, 2) + '%' }), el('td', { class: 'num', text: ldArrow(Math.abs(d3) < 0.05 ? 0 : d3) }),
      el('td', { class: 'num', text: ordF(pct) }), el('td', { class: 'l muted', text: '–' }), el('td', { class: 'l muted', text: 'outcome' }), el('td', { class: 'num', text: d3 > 0.05 ? 'rising' : d3 < -0.05 ? 'easing' : 'flat' })));
    csv.push([name, v, d3, pct, '', 'outcome', '']);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table ld-table' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: [0, 4, 5].includes(i) ? 'l' : '' })))), tb)));
  c.csv = csv;
  const front = rows.filter(x => x.row.stage === 'Early'), up = front.filter(x => x.r.dir > 0).length, back = rows.filter(x => x.row.stage !== 'Early'), bu = back.filter(x => x.r.dir > 0).length;
  setNote(c, `The front of the pipeline is ${up > front.length / 2 ? 'warming' : up < front.length / 2 ? 'cooling' : 'mixed'} (${up} of ${front.length} rising) and the back ${bu > back.length / 2 ? 'warming' : bu < back.length / 2 ? 'cooling' : 'mixed'} (${bu} of ${back.length}). `
    + 'Price pressure usually travels from commodities and supply chains, through factory, import and producer prices and rents, to wages and the sticky part of consumer prices. On the dashboard’s test only factory prices paid lead CPI reliably; most other stages move in the same month as the price they feed, and asking rents look strong but on only ten years of history, too little to count. So this table says where pressure is building, not when CPI will turn. Grey = context.');
  setSource(c, 'FRED (EIA oil, BLS import, producer and consumer prices, Philadelphia Fed, Atlanta Fed, Cleveland Fed, Dallas Fed, BLS unit labour costs, University of Michigan); NY Fed; Zillow; calculated');
}
function renderInfCore(c) {
  const L = [];
  if (has('CORE_CPI')) L.push({ name: 'Core CPI, % YoY', data: pts(yoyOf('CORE_CPI', 12), state.from, state.to) });
  for (const [id, how, name] of INF_LATE.slice(0, 3)) if (has(id)) L.push({ name, data: pts(how === 'avg12' ? ldAvg12(id) : S[id], state.from, state.to) });
  if (!L.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, L, { fmt: v => fmtNum(v, 2) + '%', axisFmt: v => fmtNum(v, 0) + '%', hlines: [{ y: 2, label: '2% target' }], endLabels: false });
  setNote(c, 'Measures that strip out the noisiest prices: sticky-price CPI (Atlanta Fed: prices that change rarely, so they reflect expected inflation), median CPI (Cleveland Fed, the middle price change each month, averaged over a year here) and trimmed-mean PCE (Dallas Fed). When they turn, the Fed listens; they move slowly and lag the pipeline above.');
  setSource(c, srcOf(['CORE_CPI', 'STICKY_CPI', 'MEDIAN_CPI', 'TRIM_PCE']));
}
function infTiles(box, tile) {
  if (has('ZORI_US')) { const a = asOf(monthlyOf('ZORI_US', 'yoy'), state.latest); if (a) tile('Asking rents', pctF1(a.v), 'year on year (Zillow)', monthLab(a.t)); }
  if (has('PHILLY_PP')) { const a = asOf(S.PHILLY_PP, state.latest), q = pctRank(S.PHILLY_PP, state.latest, 10); tile('Prices paid (Philly Fed)', fmtNum(a.v, 1), q ? ordinal(q.p) + ' percentile, 10 years' : '', monthLab(a.t)); }
  if (has('WAGE_ATL')) { const a = asOf(S.WAGE_ATL, state.latest), b = asOf(S.WAGE_ATL, addMonths(a.t, -12)); tile('Wage tracker', fmtNum(a.v, 1) + '%', b ? `a year ago ${fmtNum(b.v, 1)}%` : '', monthLab(a.t)); }
}
function usLeadTiles() {   // appended to the US tiles; TILE_SETS picks five per sub-tab
  const box = $('#usKpis'); if (!box) return;
  const sub = (SUBTABS.us[state.sub.us || 0] || [])[0]; if (!['Cycle sequence', 'Labour leads', 'Inflation pipeline'].includes(sub)) return;
  if (!LEADS) { loadLeads().then(() => state.tab === 'us' && renderTab()); if (sub !== 'Labour leads') return; }
  const tile = (l, v, d, f) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: l }), el('div', { class: 'k-value', text: v }), el('div', { class: 'k-delta', text: d }), el('div', { class: 'k-asof', text: f })));
  if (sub === 'Cycle sequence') csTiles(box, tile); else if (sub === 'Labour leads') labTiles(box, tile); else infTiles(box, tile);
}

// ------------------------------------------------------------------ shared: a dual-axis card drawn at the measured lead
function ldLeadPair(c, a, b, shift, intro, fm = {}, outro = '') {   // a, b = [id, mode, name]; shift: move a forward by its measured lead (if it passes)
  if (!has(a[0], b[0])) { setEmpty(c, 'Waiting for data.'); return null; }
  const st = ldBestLead(a[0], a[1], b[0], b[1]), k = shift && st && st.ok ? st.k : 0;
  leadPair(c, a, b, k, { fmtA: fm.fmtA || llFmtF(a[1]), fmtB: fm.fmtB || llFmtF(b[1]), axisA: fm.axisA || llAxF(a[1]), axisB: fm.axisB || llAxF(b[1]), zeroA: a[1] !== 'level', zeroB: b[1] !== 'level' });
  const short = s => s.replace(/,.*$/, '');
  const res = !st || st.missing ? '' : st.short ? 'History too short to test a lead.' : st.thin
    ? `On only ${Math.round(st.n / 12)} years of history it passes at ${st.k} months (${corrF(st.rk)} against ${corrF(st.r0)} in the same month), too little to count as a lead.`
    : leadNote({ ...st, a: a[0] }, short(a[2]), short(b[2]));
  setNote(c, [intro, res, k ? `The first series is drawn ${k} months later than measured, so its turns line up; the part past today hints at the months ahead.` : '', outro].filter(Boolean).join(' '));
  setSource(c, srcOf([a[0], b[0]]));
  return st;
}
const LEAD_SEG = key => { state[key] = '1'; return { key, options: [['0', 'As measured'], ['1', 'At its lead']] }; };

// ------------------------------------------------------------------ WP56. Global breadth and money (Regime & Leading → Global breadth & money)
const GL_DIFF_T = [['BCI_G7', 'level', 'G7 business confidence'], ['EEM', 'yoy', 'Emerging-market equities, % YoY'], ['ACWI', 'yoy', 'World equities (MSCI World), % YoY'], ['COPPER', 'yoy', 'Copper, % YoY']];
state.glDiffT = 'BCI_G7';
function renderGlDiff(c) {
  if (ldWait(c)) return; if (!has('LD_CLI_DIFF')) return setEmpty(c, 'Waiting for data.');
  const tg = GL_DIFF_T.find(x => x[0] === state.glDiffT) || GL_DIFF_T[0], a = asOf(S.LD_CLI_DIFF, state.latest), n = (LEADS._meta.cli_econ || []).length || 17;
  ldLeadPair(c, ['LD_CLI_DIFF', 'level', `Leading indices rising, % of ${n} economies`], tg, true,
    `${fmtNum(a.v, 0)}% of ${n} economies’ OECD leading indices are higher than six months earlier (${monthLab(a.t)}).`, { fmtA: v => fmtNum(v, 0) + '%', axisA: v => fmtNum(v, 0) + '%' },
    'Breadth matters more than any one country: when most leading indices turn up together, global manufacturing, emerging markets and commodities have tended to follow. A reading below 30% that starts rising has marked the early stage of past recoveries. The OECD indices are revised and partly built from share prices, so the real-time lead is shorter than the history suggests.');
  setSource(c, 'OECD composite leading indices (' + (LEADS._meta.cli_econ || []).join(', ') + '); ' + srcOf([tg[0]]) + '; calculated');
}
state.glMoney = 'LD_RNM6';
function renderGlMoney(c) {
  if (ldWait(c)) return; const id = state.glMoney; if (!has(id)) return setEmpty(c, 'Waiting for data.');
  const a = asOf(S[id], state.latest), lab = id === 'LD_RNM6' ? 'narrow' : 'broad';
  ldLeadPair(c, [id, 'level', `Global real ${lab} money, 6M annualised, %`], ['BCI_G7', 'level', 'G7 business confidence'], false,
    `Real ${lab} money in nine large economies is growing ${pctF1(a.v)} a year (six-month pace after inflation, ${monthLab(a.t)}).`, { fmtA: pctF1, axisA: v => fmtNum(v, 0) + '%' },
    'Simon Ward (Janus Henderson) reads real narrow money as a 6-to-9-month lead for global industry. On this broader, longer sample it does not pass the dashboard’s test, so it is context, not a counted lead. It excludes China, which publishes no money series to the OECD; the weights are GDP shares (US, euro area, Japan, India, UK, Canada, Brazil, Korea, Australia).');
  setSource(c, 'OECD key indicators (narrow and broad money, CPI), FRED (euro-area HICP), Japan CPI via e-Stat; calculated');
}
function renderGlTable(c) {
  const b = htmlBody(c), ids = Object.keys(S).filter(k => /^CLI_/.test(k) && has(k)), heads = ['Economy', 'Level', '1M', '6M change', 'Phase'], tb = el('tbody'), csv = [heads];
  const name = id => (S[id].label || id).replace(/ leading indicator$/, ''), rows = ids.map(id => { const s = S[id], n = s.v.length - 1; return { id, v: s.v[n], d1: s.v[n] - s.v[n - 1], d6: s.v[n] - s.v[n - 6], t: s.t[n] }; })
    .sort((x, y) => y.d6 - x.d6);
  const phase = r => r.v >= 100 ? (r.d1 >= 0 ? 'Expansion' : 'Downturn') : (r.d1 >= 0 ? 'Recovery' : 'Slowdown');
  for (const r of rows) {
    const ph = phase(r);
    tb.append(el('tr', { class: 'row' + (['CLI_G7', 'CLI_G20'].includes(r.id) ? ' sel' : ''), title: `OECD leading indicator, data to ${monthLab(r.t)}` }, el('td', { class: 'l', text: name(r.id) }), el('td', { class: 'num', text: fmtNum(r.v, 2) }),
      el('td', { class: 'num', text: ldArrow(r.d1) }), el('td', { class: 'num ' + (r.d6 > 0 ? 'up' : 'dn'), text: (r.d6 > 0 ? '+' : '−') + fmtNum(Math.abs(r.d6), 2) }),
      el('td', { class: 'num ' + (ph === 'Expansion' || ph === 'Recovery' ? 'up' : 'dn'), text: ph })));
    csv.push([name(r.id), r.v, r.d1, r.d6, ph]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf watch' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i ? '' : 'l' })))), tb)));
  capRows(tb, 'gl_table', 14); c.csv = csv;
  setNote(c, 'Each economy’s OECD leading indicator, strongest six-month change first. Phase uses the OECD’s own words: above 100 and rising = expansion, above 100 and falling = downturn, below 100 and falling = slowdown, below 100 and rising = recovery. 100 = the economy’s long-run trend.');
  setSource(c, 'OECD composite leading indicators (amplitude adjusted)');
}
function glTiles(box, tile) {
  if (has('LD_CLI_DIFF')) { const a = asOf(S.LD_CLI_DIFF, state.latest), b = asOf(S.LD_CLI_DIFF, addMonths(a.t, -3)); tile('Leading indices rising', fmtNum(a.v, 0) + '%', b ? `3M ago ${fmtNum(b.v, 0)}%` : '', monthLab(a.t)); }
  if (has('LD_RNM6')) { const a = asOf(S.LD_RNM6, state.latest), b = asOf(S.LD_RNM6, addMonths(a.t, -3)); tile('Global real money', pctF1(a.v), b ? `3M ago ${pctF1(b.v)} · ex-China` : 'ex-China', monthLab(a.t)); }
  if (has('CLI_G7')) { const s = S.CLI_G7, n = s.v.length - 1; tile('G7 leading index', fmtNum(s.v[n], 2), `6M ${sign(s.v[n] - s.v[n - 6])}${fmtNum(Math.abs(s.v[n] - s.v[n - 6]), 2)}`, monthLab(s.t[n])); }
}

// ------------------------------------------------------------------ WP56. Asian trade pulse (Asia ex-Japan → Trade pulse) and China credit (China → Economy)
const AX_PULSE = [['KR_EXP_YOY', 'Korea exports'], ['TW_EXP_YOY', 'Taiwan exports'], ['SG_NODX_YOY', 'Singapore non-oil exports'], ['JP_EXP_YOY', 'Japan exports'], ['CN_EXP_YOY', 'China exports'],
  ['TW_ORDERS_YOY', 'Taiwan export orders'], ['KR_CHIP_EXP', 'Korea chip exports']];
const AX_PULSE_T = [['AAXJ', 'yoy', 'Asia ex-Japan equities, % YoY'], ['MY_EXPORTS_YOY', 'level', 'Malaysia exports, % YoY'], ['KLCI', 'yoy', 'FBM KLCI, % YoY'], ['EEM', 'yoy', 'Emerging-market equities, % YoY']];
state.axPulseT = 'AAXJ';
function renderAxPulse(c) {
  if (ldWait(c)) return; if (!has('LD_ASIA_PULSE')) return setEmpty(c, 'Waiting for data.');
  const tg = AX_PULSE_T.find(x => x[0] === state.axPulseT) || AX_PULSE_T[0], a = asOf(S.LD_ASIA_PULSE, state.latest);
  ldLeadPair(c, ['LD_ASIA_PULSE', 'level', 'Asian trade pulse (standard deviations)'], tg, false,
    `The pulse is ${zf(a.v)}: Asia’s early-reporting exporters are growing ${a.v > 1 ? 'far faster' : a.v > 0 ? 'faster' : a.v > -1 ? 'slower' : 'far slower'} than usual (${monthLab(a.t)}).`, { fmtA: zf, axisA: v => fmtNum(v, 1) },
    'The pulse averages seven early trade readings (Korea, Taiwan, Singapore, Japan and China exports, Taiwan export orders, Korean chip exports), each as 3-month growth in standard deviations from its own past. Equity markets usually move first, so read the pulse as a check on what markets already price; a gap between the two is the signal worth investigating.');
  setSource(c, 'Korea Customs and MOTIE, Taiwan MOF and MOEA, Enterprise Singapore, Japan MOF, China customs (via OECD and the dashboard’s Asia feeds); ' + srcOf([tg[0]]) + '; calculated');
}
function renderAxPulseTable(c) {
  const b = htmlBody(c), heads = ['Exporter', 'Growth (3M avg)', '3M', 'vs its normal', 'Data'], tb = el('tbody'), csv = [heads];
  for (const [id, name] of AX_PULSE) {
    if (!has(id)) continue;
    const y = id === 'KR_CHIP_EXP' ? yoy3(monthlyOf(id, 'level')) : avg3(monthlyOf(id, 'level')), n = y.v.length - 1; if (n < 24) continue;
    const w = y.v.filter((_, i) => y.t[i] >= Date.UTC(2005, 0, 1)), mu = w.reduce((a, x) => a + x, 0) / w.length, sd = Math.sqrt(w.reduce((a, x) => a + (x - mu) ** 2, 0) / w.length), z = (y.v[n] - mu) / sd, d3 = y.v[n] - y.v[n - 3];
    tb.append(el('tr', { class: 'row' }, el('td', { class: 'l', text: name }), el('td', { class: 'num strong', text: pctF1(y.v[n]) }), el('td', { class: 'num', text: ldArrow(d3) }),
      el('td', { class: 'num ' + (z > 0 ? 'up' : 'dn'), text: zf(z) + ' sd' }), el('td', { class: 'num muted', text: monthLab(y.t[n]) })));
    csv.push([name, y.v[n], d3, z, monthLab(y.t[n])]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf watch' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i ? '' : 'l' })))), tb)));
  c.csv = csv;
  setNote(c, 'The pulse’s seven parts: growth on a year (3-month average), its direction over three months, and how far it sits from its own average since 2005 in standard deviations. Korea reports first each month (the first 20 days), so its exports are the earliest read on Asian trade.');
  setSource(c, 'National statistics via OECD and the dashboard’s Asia feeds; calculated');
}
function renderAxKrw(c) {
  if (ldWait(c)) return; ldDerived();
  const a = has('USDKRW') ? asOf(S.USDKRW, state.latest) : null;
  ldLeadPair(c, ['LB_KRW', 'yoy', 'Korean won against the dollar, % YoY'], ['KR_EXP_YOY', 'level', 'Korea exports, % YoY'], state.axKrw === '1',
    a ? `USD/KRW is ${fmtNum(a.v, 0)} (${nice(a.t)}); a stronger won means more dollars flowing in for Korean goods.` : '', { fmtA: pctF1, axisA: v => fmtNum(v, 0) + '%' },
    'The won trades all day on what global buyers expect from Korean factories, so it has turned before the monthly export figures. Its lead is short and weaker in the second half of the history.');
}
function axTiles(box, tile) {
  if (has('LD_ASIA_PULSE')) { const a = asOf(S.LD_ASIA_PULSE, state.latest), b = asOf(S.LD_ASIA_PULSE, addMonths(a.t, -3)); tile('Asian trade pulse', zf(a.v), b ? `3M ago ${zf(b.v)} · sd from normal` : 'sd from normal', monthLab(a.t)); }
}
function renderCnCredit(c) {
  if (ldWait(c)) return; if (!has('CN_CREDIT_GDP', 'LD_CN_IMPULSE')) return setEmpty(c, 'Waiting for data.');
  drawPair(c, { name: 'Private credit, % of GDP (BIS)', data: pts(S.CN_CREDIT_GDP, state.from, state.to) }, { name: 'Credit impulse: change in the yearly flow of new credit, % of GDP', data: pts(S.LD_CN_IMPULSE, state.from, state.to) },
    { fmtA: v => fmtNum(v, 1) + '%', fmtB: v => sign(v) + fmtNum(Math.abs(v), 1) + 'pp', axisA: v => fmtNum(v, 0) + '%', axisB: v => fmtNum(v, 0), zeroB: true });
  const a = asOf(S.LD_CN_IMPULSE, state.latest), q = d => { const x = new Date(d); return `Q${Math.floor(x.getUTCMonth() / 3) + 1} ${x.getUTCFullYear()}`; }, st = ldBestLead('LD_CN_IMPULSE', 'level', 'COPPER', 'yoy');
  setNote(c, `China’s credit impulse was ${sign(a.v)}${fmtNum(Math.abs(a.v), 1)} points of GDP in ${q(a.t)}, the latest the BIS has published: it arrives about a year late. `
    + 'The impulse is the change in the flow of new credit, the part that adds to demand; strategists watch it as a 9-to-12-month lead for metals and Chinese imports. '
    + `On the dashboard’s test against copper it is ${st && st.ok ? 'a lead of ' + st.k + ' months' : 'context: ' + ldWhy(st)}, and the year-long delay makes it a description of the recent past. The monthly version needs the PBoC’s total social financing, which has no free machine-readable feed.`);
  setSource(c, 'BIS credit to the private non-financial sector via FRED (CRDQCNAPABIS, QCNPAM770A); calculated');
}

// ------------------------------------------------------------------ WP57. Market canaries (Regime & Leading → Market signals)
const CAN_ROWS = [   // [series id (built in ldCanaries), name, numerator, denominator or 'x' (product) or 'inv', what it leads, claim]
  ['LB_R_XHB', 'Homebuilders ÷ S&P 500', 'XHB', 'SPX', PAY, 'housing'], ['LB_R_KBE', 'Banks ÷ S&P 500', 'KBE', 'SPX', PAY, 'credit supply'],
  ['LB_R_KRE', 'Regional banks ÷ S&P 500', 'KRE', 'SPX', PAY, 'credit to smaller firms'], ['LB_R_IYT', 'Transports ÷ utilities', 'IYT', 'XLU', ISM, 'goods moving'],
  ['LB_R_SPHB', 'High beta ÷ low volatility', 'SPHB', 'SPLV', ISM, 'risk appetite'], ['LB_R_SOX', 'Semiconductors ÷ S&P 500', 'SOX', 'SPX', ISM, 'ISM, Asian exports'],
  ['LB_R_RTY', 'Small ÷ large caps', 'RTY', 'SPX', ISM, 'domestic growth'], ['LB_R_XLY', 'Discretionary ÷ staples', 'XLY', 'XLP', ISM, 'consumer spending'],
  ['LB_CUGOLD', 'Copper ÷ gold', 'COPPER', 'GOLD', ['GS10', 'chg12', 'the 10Y yield', true], 'bond yields'], ['LB_R_HYG', 'High yield ÷ Treasuries', 'HYG', 'IEF', PAY, 'credit risk appetite'],
  ['LB_AUDJPY', 'AUD/JPY', 'AUDUSD', 'x', ['KR_EXP_YOY', 'level', 'Korea exports', true], 'global risk appetite'], ['LB_KRW', 'Korean won (vs USD)', 'USDKRW', 'inv', ['KR_EXP_YOY', 'level', 'Korea exports', true], 'the trade cycle'],
];
function ldCanaries() {
  ldDerived();
  for (const [id, , a, b] of CAN_ROWS) {
    if (S[id] || !has(a)) continue;
    if (b === 'inv') { S[id] = { ...S[a], id, label: id, kind: 'price', v: S[a].v.map(v => 1 / v) }; continue; }
    const bb = b === 'x' ? 'USDJPY' : b; if (!has(bb)) continue;
    const r = combine(S[a], S[bb], b === 'x' ? (x, y) => x * y : (x, y) => x / y, {}, 5 * DAY);
    S[id] = { ...r, id, label: id, kind: 'price', source: `Yahoo Finance (${a} ${b === 'x' ? '×' : '÷'} ${bb})` };
  }
}
function canStats(id) {   // vs 200-day average, since when, 3-month change (daily ratio)
  const s = S[id]; if (!s || s.v.length < 260) return null;
  const n = s.v.length, cs = [0]; for (let i = 0; i < n; i++) cs.push(cs[i] + s.v[i]);
  const ma = (cs[n] - cs[n - 200]) / 200, vs = (s.v[n - 1] / ma - 1) * 100, above = vs > 0;
  let since = null; for (let j = n - 2; j >= 200; j--) { const m = (cs[j + 1] - cs[j - 199]) / 200; if ((s.v[j] > m) !== above) { since = s.t[j + 1]; break; } }
  const p = asOf(s, addMonths(s.t[n - 1], -3)), m3 = p ? (s.v[n - 1] / p.v - 1) * 100 : null;
  return { vs, above, since, m3, t: s.t[n - 1] };
}
state.canSel = 0;
function renderCanTable(c) {
  ldCanaries();
  const b = htmlBody(c), heads = ['Canary', 'vs 200-day', 'Trend', '3M', 'Leads', 'Measured', 'Signal'], tb = el('tbody'), csv = [heads];
  const rows = CAN_ROWS.map((r, i) => ({ r, i, x: canStats(r[0]), st: ldBestLead(r[0], 'yoy', r[4][0], r[4][1]) })).filter(z => z.x).sort((p, q) => (!!q.st.ok - !!p.st.ok) || p.i - q.i);
  let ctx = false;
  for (const { r, i, x, st } of rows) {
    if (!st.ok && !ctx) { ctx = true; tb.append(el('tr', { class: 'grp' }, el('td', { colspan: heads.length, text: 'Context: no stable lead on the dashboard’s test' }))); }
    const sig = x.above && x.m3 > 0 ? 'supportive' : !x.above && x.m3 < 0 ? 'warning' : 'mixed';
    tb.append(el('tr', { class: 'row' + (st.ok ? '' : ' ld-ctx') + (i === state.canSel ? ' sel' : ''), style: 'cursor:pointer', title: `Rising = ${r[5]} improving. ${st.short || st.missing ? '' : leadNote({ ...st, a: r[0] }, r[1], r[4][2])} Click to chart.`,
      onclick: () => { state.canSel = i; cards.can_table.render(); cards.can_chart.render(); } },
      el('td', { class: 'l', text: r[1] }), el('td', { class: 'num ' + (x.above ? 'up' : 'dn'), text: pctF1(x.vs) }), el('td', { class: 'num', text: `${x.above ? '▲ above' : '▼ below'} ${sinceF(x.since)}` }),
      el('td', { class: 'num ' + (x.m3 > 0 ? 'up' : 'dn'), text: pctF1(x.m3) }), el('td', { class: 'l', text: r[4][2] }), el('td', { class: 'l', text: ldMeasured(st) }),
      el('td', { class: 'num ' + (sig === 'supportive' ? 'up' : sig === 'warning' ? 'dn' : ''), text: sig })));
    csv.push([r[1], x.vs, x.above ? 'above' : 'below', x.m3, r[4][2], ldMeasured(st), sig]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table ld-table' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: [0, 4, 5].includes(i) ? 'l' : '' })))), tb)));
  c.csv = csv;
  const up = rows.filter(z => z.x.above).length, t = rows.filter(z => z.st.ok), tu = t.filter(z => z.x.above).length;
  setNote(c, `${up} of ${rows.length} canaries are above their 200-day average, ${tu} of the ${t.length} with a tested lead. `
    + 'Each is a price ratio that tends to turn before the part of the economy it reflects. Signal: supportive = above its 200-day average and up over three months; warning = below and falling. Measured = the lead of its yearly change over what it leads, on the dashboard’s test (grey rows fail it). The ratio charts with their trend lines are on Markets → Trend; click a row here to compare one with what it leads.');
  setSource(c, 'Yahoo Finance; FRED; calculated');
}
state.canLead = '1';
function renderCanChart(c) {
  ldCanaries();
  const r = CAN_ROWS[state.canSel] || CAN_ROWS[0]; c.titleEl.textContent = r[1] + ' vs ' + r[4][2];
  const tgName = { PAYEMS: 'Payrolls, % YoY', ISM_BAL: 'ISM manufacturing (balance)', GS10: '10Y yield, 12M change (pp)', KR_EXP_YOY: 'Korea exports, % YoY' }[r[4][0]] || r[4][2];
  ldLeadPair(c, [r[0], 'yoy', r[1] + ', % YoY'], [r[4][0], r[4][1], tgName], state.canLead === '1', `Rising = ${r[5]} improving.`, { fmtA: pctF1, axisA: v => fmtNum(v, 0) + '%' });
}
function canTile(box, tile) {
  ldCanaries(); const L = CAN_ROWS.map(r => canStats(r[0])).filter(Boolean); if (!L.length) return;
  tile('Canaries above trend', `${L.filter(x => x.above).length} of ${L.length}`, 'above their 200-day average', 'price ratios');
}

// ------------------------------------------------------------------ WP59. Malaysia pulse (Malaysia → Pulse)
const MY_PULSE = [   // [id, name, unit formatter, daily]
  ['MY_FPX_B2C', 'Online payments by consumers (28 days)', v => 'RM' + fmtNum(v, 1) + 'bn', true], ['MY_FPX_B2B', 'Online payments by businesses (28 days)', v => 'RM' + fmtNum(v, 1) + 'bn', true],
  ['MY_CARS', 'New car registrations', v => fmtNum(v / 1000, 1) + 'k'], ['MY_ARR', 'Tourist arrivals', v => fmtNum(v / 1e6, 2) + 'm'], ['MY_ARR_CN', 'Arrivals from China', v => fmtNum(v / 1000, 0) + 'k'],
  ['MY_ARR_SG', 'Arrivals from Singapore', v => fmtNum(v / 1e6, 2) + 'm'], ['MY_ELEC_COM', 'Electricity use, business', v => fmtNum(v / 1000, 1) + ' TWh'],
  ['MY_EXP_EE', 'Machinery & electronics exports', v => 'RM' + fmtNum(v, 1) + 'bn'], ['MY_EXP_VOL', 'Export volume index', v => fmtNum(v, 1)],
];
const MY_PULSE_CORE = ['MY_FPX_B2C', 'MY_FPX_B2B', 'MY_CARS', 'MY_ARR', 'MY_ELEC_COM', 'MY_EXP_EE'];
function myGrowth(id, daily) {   // year-on-year: daily 28-day totals against the same window a year earlier; monthly as 3-month averages
  if (!has(id)) return null;
  if (daily) { const s = S[id], t = [], v = [], ok = (i, p) => p && p.v && s.t[i] - 364 * DAY - p.t < 5 * DAY;
    for (let i = 0; i < s.t.length; i += 7) { const p = asOf(s, s.t[i] - 364 * DAY); if (ok(i, p)) { t.push(s.t[i]); v.push((s.v[i] / p.v - 1) * 100); } }
    const n = s.t.length - 1, p = asOf(s, s.t[n] - 364 * DAY); if (ok(n, p) && t[t.length - 1] !== s.t[n]) { t.push(s.t[n]); v.push((s.v[n] / p.v - 1) * 100); } return { t, v }; }
  return yoy3(monthlyOf(id, 'level'));
}
function myPulseRows() {
  return MY_PULSE.map(([id, name, f, daily]) => { const g = myGrowth(id, daily); if (!g || g.v.length < 4) return null;
    const n = g.v.length - 1, back = asOf(g, addMonths(g.t[n], -3)), d3 = back ? g.v[n] - back.v : null, s = S[id], last = asOf(s, state.latest);
    return { id, name, f, daily, g: g.v[n], d3, t: g.t[n], last, st: ldBestLead(id, 'yoy', 'MY_COINCIDENT', 'yoy') }; }).filter(Boolean);
}
function renderMyPulse(c) {
  if (ldWait(c)) return;
  const b = htmlBody(c), heads = ['Indicator', 'Latest', 'YoY', '3M', 'Data', 'Measured lead (DOSM coincident index)', 'Read'], tb = el('tbody'), csv = [heads];
  for (const r of myPulseRows()) {
    const read = r.d3 == null ? '–' : r.d3 > 0.5 ? 'improving' : r.d3 < -0.5 ? 'slowing' : 'steady';
    tb.append(el('tr', { class: 'row' + (r.st && r.st.ok ? '' : ' ld-ctx'), title: (r.st && !r.st.missing && !r.st.short ? leadNote({ ...r.st, a: r.id }, r.name, 'the coincident index') : 'History too short to test a lead.') + ' YoY: ' + (r.daily ? 'latest 28 days against the same 28 days a year earlier.' : '3-month average against a year earlier.') },
      el('td', { class: 'l', text: r.name }), el('td', { class: 'num strong', text: r.f(r.last.v) }), el('td', { class: 'num ' + (r.g > 0 ? 'up' : 'dn'), text: pctF1(r.g) }),
      el('td', { class: 'num', text: ldArrow(r.d3 == null ? null : Math.abs(r.d3) <= 0.5 ? 0 : r.d3) }), el('td', { class: 'num muted', text: r.daily ? nice(r.last.t) : monthLab(r.last.t) }),
      el('td', { class: 'l', text: ldMeasured(r.st) }), el('td', { class: 'num ' + (read === 'improving' ? 'up' : read === 'slowing' ? 'dn' : ''), text: read })));
    csv.push([r.name, r.last.v, r.g, r.d3, r.daily ? iso(r.last.t) : monthLab(r.last.t), ldMeasured(r.st), read]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table ld-table' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: [0, 5].includes(i) ? 'l' : '' })))), tb)));
  c.csv = csv;
  const k = myPulseCount();
  setNote(c, `${k.up} of ${k.n} pulse readings are improving (growth faster than three months earlier). `
    + 'These come out weeks before DOSM’s monthly figures: online payments daily, car registrations, arrivals, electricity use and exports monthly. On the dashboard’s test none leads the economy reliably (most move with it, and payments and arrivals start in 2020), so read them as an early, real-time check on spending, tourism and factory activity rather than a forecast. Grey = context.');
  setSource(c, 'Bank Negara Malaysia, Road Transport Department, Tourism Malaysia, Energy Commission and DOSM via data.gov.my; calculated');
}
function myPulseCount() { const L = myPulseRows().filter(r => MY_PULSE_CORE.includes(r.id) && r.d3 != null); return { up: L.filter(r => r.d3 > 0.5).length, n: L.length }; }
function renderMyPay(c) {
  if (ldWait(c)) return; const L = [['MY_FPX_B2C', 'Consumers'], ['MY_FPX_B2B', 'Businesses']].filter(([id]) => has(id)); if (!L.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, L.map(([id, n]) => ({ name: `${n}, RM bn over 28 days`, data: pts(S[id], state.from, state.to) })), { fmt: v => 'RM' + fmtNum(v, 1) + 'bn', axisFmt: v => fmtNum(v, 0), endLabels: false });
  const g = myGrowth('MY_FPX_B2C', true), a = g && g.v.length ? g.v[g.v.length - 1] : null;
  setNote(c, `Consumers paid ${a == null ? '–' : fmtNum(Math.abs(a), 1) + '% ' + (a >= 0 ? 'more' : 'less')} online in the latest 28 days than a year earlier. FPX is Malaysia’s bank-to-bank online payment system; the 28-day total smooths out paydays and weekends. Part of the growth is the long shift from cash to online, so compare the pace with its own recent past.`);
  setSource(c, 'Bank Negara Malaysia (PayNet FPX) via data.gov.my');
}
function renderMyCars(c) {
  if (ldWait(c)) return;
  ldLeadPair(c, ['MY_CARS', 'yoy', 'New car registrations, % YoY'], ['MY_RETAIL_YOY', 'level', 'Retail trade, % YoY'], false, 'Cars are the biggest purchase most households make, so registrations show confidence and credit early.', { fmtA: pctF1, axisA: v => fmtNum(v, 0) + '%' },
    'Registrations swing with model launches and tax changes (the 2020 sales-tax holiday), so read the trend over several months.');
}
function renderMyArrivals(c) {
  if (ldWait(c)) return; const L = [['MY_ARR', 'All arrivals'], ['MY_ARR_SG', 'From Singapore'], ['MY_ARR_CN', 'From China']].filter(([id]) => has(id)); if (!L.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, L.map(([id, n]) => ({ name: n + ', thousands a month', data: pts({ t: S[id].t, v: S[id].v.map(v => v / 1000) }, state.from, state.to) })), { fmt: v => fmtNum(v, 0) + 'k', axisFmt: v => fmtNum(v, 0), endLabels: false });
  const g = myGrowth('MY_ARR'), gc = myGrowth('MY_ARR_CN'), a = asOf(S.MY_ARR, state.latest);
  setNote(c, `${fmtNum(a.v / 1e6, 2)} million visitors in ${monthLab(a.t)}, ${g ? pctF1(g.v[g.v.length - 1]) : '–'} on a year (3-month average); from China ${gc ? pctF1(gc.v[gc.v.length - 1]) : '–'}. Tourism feeds hotels, retail and the ringgit; Singapore day-trippers are about half of all arrivals. The series starts in 2020, so it holds no full cycle yet.`);
  setSource(c, 'Tourism Malaysia via data.gov.my (arrivals)');
}
function renderMyEe(c) {
  if (ldWait(c)) return;
  ldLeadPair(c, ['MY_EXP_EE', 'yoy', 'Machinery & electronics exports, % YoY'], ['SOX', 'yoy', 'Philadelphia semiconductor index, % YoY'], false,
    'Malaysia assembles and tests a large share of the world’s chips, so its machinery and electronics exports (SITC 7) track the global chip cycle.', { fmtA: pctF1, axisA: v => fmtNum(v, 0) + '%' });
}
function myPulseTile(box, tile) { const k = myPulseCount(); if (k.n) tile('Malaysia pulse', `${k.up} of ${k.n} improving`, 'payments, cars, tourists, power, exports', 'faster growth than 3 months ago'); }

// ------------------------------------------------------------------ WP60. Presidential cycle (Markets → Seasonality)
const CYC_NAMES = ['Post-election year', 'Mid-term year', 'Pre-election year', 'Election year'];
function cycleData() {   // S&P 500 month-end levels (monthly since 1960): one 48-month path per four-year cycle starting the year after an election
  const s = S.LH_SPX || S.SPX; if (!s) return null;
  const me = monthEnds(s), at = (y, m) => me.get(Date.UTC(y, m, 1)), cur = new Date(state.latest).getUTCFullYear(), c0 = cur - ((cur - 1961) % 4 + 4) % 4;
  const paths = [];
  for (let y = 1961; y <= cur; y += 4) {
    const base = at(y - 1, 11); if (!base) continue; const p = [0];
    for (let m = 0; m < 48; m++) { const v = at(y + Math.floor(m / 12), m % 12); if (v == null) break; p.push((v / base - 1) * 100); }
    paths.push({ y, p, full: p.length === 49 });
  }
  return { paths, full: paths.filter(x => x.full && x.y !== c0), current: paths.find(x => x.y === c0), c0, at };
}
function renderSeaCycle(c) {
  const d = cycleData(); if (!d || !d.full.length) return setEmpty(c, 'Waiting for data.');
  const avg = Array.from({ length: 49 }, (_, m) => d.full.reduce((a, x) => a + x.p[m], 0) / d.full.length);
  const o = baseOpt(); o.legend.show = true; o.grid.top = 34;
  o.xAxis = { type: 'category', data: Array.from({ length: 49 }, (_, m) => m === 0 ? 'Start' : `${['Y1', 'Y2', 'Y3', 'Y4'][Math.floor((m - 1) / 12)]} ${MONTHS[(m - 1) % 12]}`),
    axisLabel: { color: tok('--ink-2'), interval: 11, formatter: (v, i) => i === 0 ? 'Start' : CYC_NAMES[Math.floor((i - 1) / 12)].replace(' year', '') }, axisTick: { show: false } };
  o.yAxis = valAxis(v => fmtNum(v, 0) + '%'); o.tooltip = { ...o.tooltip, trigger: 'axis', valueFormatter: v => v == null ? '–' : pctF1(v) };
  o.series = [{ name: `Average of ${d.full.length} cycles since 1961`, type: 'line', data: avg.map(v => +v.toFixed(2)), showSymbol: false, lineStyle: { type: 'dashed', width: 2, color: tok('--muted') }, itemStyle: { color: tok('--muted') } }];
  if (d.current) o.series.push({ name: `This cycle (from Jan ${d.c0})`, type: 'line', data: d.current.p.map(v => +v.toFixed(2)), showSymbol: false, lineStyle: { width: 2.5, color: col(0) }, itemStyle: { color: col(0) } });
  inst(c).setOption(o, true);
  const m = d.current ? d.current.p.length - 1 : 0;
  setNote(c, `We are in month ${m} of the cycle (${CYC_NAMES[Math.floor(Math.max(0, m - 1) / 12)].toLowerCase()}): this cycle is ${d.current ? pctF1(d.current.p[m]) : '–'} so far against ${pctF1(avg[m])} for the average cycle at the same point. `
    + 'The S&P 500 (price only, month-end) through each four-year US presidential cycle, rebased to 0 at the end of the election year. The stretch from the mid-term year’s autumn to mid way through the pre-election year has been the strongest of the four years, the pattern most often quoted; with only 16 cycles one bad year moves the average a lot, so the table beside shows how often it worked.');
  setSource(c, 'Yahoo Finance (^GSPC, monthly since 1960); calculated');
}
function renderSeaCycleTbl(c) {
  const d = cycleData(); if (!d || !d.full.length) return setEmpty(c, 'Waiting for data.');
  const b = htmlBody(c), heads = ['Cycle year', 'Q1', 'Q2', 'Q3', 'Q4', 'Whole year'], tb = el('tbody'), csv = [heads];
  const qret = (x, yr, q) => { const a = x.p[yr * 12 + q * 3], z = x.p[yr * 12 + q * 3 + 3]; return a == null || z == null ? null : ((100 + z) / (100 + a) - 1) * 100; };
  const cur = d.current ? d.current.p.length - 1 : -1;
  for (let yr = 0; yr < 4; yr++) {
    const cells = [0, 1, 2, 3].map(q => d.full.map(x => qret(x, yr, q)).filter(v => v != null)).concat([d.full.map(x => ((100 + x.p[yr * 12 + 12]) / (100 + x.p[yr * 12]) - 1) * 100)]);
    tb.append(el('tr', { class: 'row' + (cur > yr * 12 && cur <= yr * 12 + 12 ? ' sel' : '') }, el('td', { class: 'l', text: CYC_NAMES[yr] }),
      ...cells.map(L => { const a = L.reduce((s, v) => s + v, 0) / L.length, h = L.filter(v => v > 0).length; return el('td', { class: 'num ' + (a > 0 ? 'up' : 'dn'), title: `${h} of ${L.length} up; worst ${pctF1(Math.min(...L))}`, text: `${pctF1(a)} (${h}/${L.length})` }); })));
    csv.push([CYC_NAMES[yr], ...cells.map(L => L.reduce((s, v) => s + v, 0) / L.length)]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf watch' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i ? '' : 'l' })))), tb)));
  // the best-known window: end of September in the mid-term year to end of June in the pre-election year
  const W = d.full.map(x => ({ y: x.y + 1, r: ((100 + x.p[30]) / (100 + x.p[21]) - 1) * 100 })), wa = W.reduce((s, x) => s + x.r, 0) / W.length, worst = W.reduce((m, x) => x.r < m.r ? x : m);
  c.csv = csv;
  setNote(c, `Mid-term October to pre-election June: average ${pctF1(wa)}, up in ${W.filter(x => x.r > 0).length} of ${W.length} cycles; worst ${pctF1(worst.r)} (from the ${worst.y} mid-terms). `
    + 'Average S&P 500 price return by quarter of the cycle, with the number of cycles it rose (hover for the worst). The current cycle year is highlighted. A tendency, not a rule: valuations, the Fed and recessions matter far more in any single cycle.');
  setSource(c, 'Yahoo Finance (^GSPC); calculated');
}

// ------------------------------------------------------------------ WP58. Options positioning (Positioning & Vol → Sentiment)
function renderSentPc(c) {
  if (!SPD) { loadSP().then(() => c.render()); return setEmpty(c, 'Loading…'); }
  const L = [['SP_PC_EQUITY', 'Single shares (dashboard’s own count)'], ['SP_PC_INDEX', 'Index options: S&P 500, Nasdaq 100, Russell 2000'], ['FG_PUTCALL', 'CNN’s Cboe put/call, 5-day average']].filter(([id]) => has(id));
  if (!L.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, L.map(([id, n]) => ({ name: n, data: pts(S[id], state.from, state.to), extra: S[id].v.length < 3 ? { showSymbol: true, symbolSize: 7 } : {} })), { fmt: v => fmtNum(v, 2), axisFmt: v => fmtNum(v, 1), hlines: [{ y: 1, label: '1 = as many puts as calls' }], endLabels: false });
  const e = has('SP_PC_EQUITY') ? asOf(S.SP_PC_EQUITY, state.latest) : null, x = has('SP_PC_INDEX') ? asOf(S.SP_PC_INDEX, state.latest) : null, n = has('SP_PC_EQUITY') ? S.SP_PC_EQUITY.v.length : 0;
  setNote(c, `${e ? `Puts per call traded: ${fmtNum(e.v, 2)} on single shares and ${x ? fmtNum(x.v, 2) : '–'} on index options (${nice(e.t)}).` : 'The dashboard’s own count starts with the next full run.'} `
    + 'A very high ratio means heavy buying of protection (fear), which has often come near market lows; a very low one means complacency. Index options are mostly hedges, so they run higher than single shares. '
    + `The dashboard began counting volumes from the Cboe option chains it already reads in November 2026 (${n} day${n === 1 ? '' : 's'} so far); a 10-day average and percentiles follow once there is enough history. Until then CNN’s 5-day average gives the longer view.`);
  setSource(c, 'Cboe (delayed) option volumes, summed by the dashboard; CNN Business Fear & Greed (put/call component)');
}

// ------------------------------------------------------------------ build and wiring
function ldTiles(sel, fn) {   // append tiles to a page's tile box (TILE_SETS then picks five for the open sub-tab)
  const box = $(sel); if (!box) return;
  fn(box, (l, v, d, f) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: l }), el('div', { class: 'k-value', text: v }), el('div', { class: 'k-delta', text: d }), el('div', { class: 'k-asof', text: f }))));
}
const ldSub = tab => (SUBTABS[tab][state.sub[tab] || 0] || [])[0];
function regLeadTiles() {
  const sub = ldSub('regime');
  if (sub === 'Market signals') ldTiles('#regKpis', canTile);
  if (sub === 'Global breadth & money') { if (!LEADS) { loadLeads().then(() => state.tab === 'regime' && renderTab()); return; } ldTiles('#regKpis', glTiles); }
}
function asiaLeadTiles() { if (ldSub('asia') !== 'Trade pulse') return; if (!LEADS) { loadLeads().then(() => state.tab === 'asia' && renderTab()); return; } ldTiles('#asiaKpis', axTiles); }
function myLeadTiles() { if (['Equities', 'Sectors'].includes(ldSub('my'))) return; if (!LEADS) { loadLeads().then(() => state.tab === 'my' && renderTab()); return; } ldTiles('#myKpis', myPulseTile); }
const EXTRA_HOOKS = { regime: [lbTiles, regLeadTiles], us: [usLeadTiles], asia: [asiaLeadTiles], my: [myLeadTiles] };
{ const R = SUBTABS.regime, i = R.findIndex(x => x[0] === 'Indicators'); R.splice(i < 0 ? R.length : i, 0, ['Leading board', ['lb_table', 'lb_breadth', 'lb_changes'], 'Leading']);
  const g = R.findIndex(x => x[0] === 'Global business cycle'); R.splice(g + 1, 0, ['Global breadth & money', ['gl_diff', 'gl_money', 'gl_table'], 'Leading']);
  R.find(x => x[0] === 'Market signals')[1].push('can_table', 'can_chart'); }
SUBTABS.asia.push(['Trade pulse', ['#sa_asia_pulse', 'ax_pulse', 'ax_pulse_table', 'ax_krw']]);
SUBTABS.cn.find(x => x[0] === 'Economy')[1].push('cn_credit');
{ const M = SUBTABS.my, i = M.findIndex(x => x[0] === 'Economy'); M.splice(i + 1, 0, ['Pulse', ['my_pulse', 'my_pay', 'my_cars', 'my_arrivals', 'my_ee']]); }
SUBTABS.posvol.find(x => x[0] === 'Sentiment')[1].push('sent_pc');
SUBTABS.markets.find(x => x[0] === 'Seasonality')[1].push('sea_cycle', 'sea_cycle_tbl');
EXTRA_RENDER.posvol = ['sent_pc'];
EXTRA_RENDER.markets.push('sea_cycle', 'sea_cycle_tbl');
ASIA_KPI['Trade pulse'] = ['Korea exports', 'Taiwan exports', 'KOSPI', 'Taiwan Weighted', 'USD/KRW'];
Object.assign(TILE_SETS.asia, { 'Trade pulse': ['Asian trade pulse', 'Korea exports', 'Taiwan exports', 'KOSPI', 'USD/KRW'] });
Object.assign(TILE_SETS.my, { 'Pulse': ['Malaysia pulse', 'FBM KLCI', 'USD/MYR', 'Malaysia OPR', 'Malaysia leading index'] });
TILE_SETS.my['*'] = [...TILE_SETS.my['*'].filter(x => x !== 'Malaysia pulse'), 'Malaysia pulse'];
Object.assign(TILE_SETS.regime, { 'Global breadth & money': ['Leading indices rising', 'Global real money', 'G7 leading index', 'Confirmed regime', 'Growth momentum'],
  'Market signals': ['Canaries above trend', 'Confirmed regime', 'Growth momentum', 'Inflation momentum'] });
{ const U = SUBTABS.us, i = U.findIndex(x => x[0] === 'Growth & jobs') + 1;
  U.splice(i, 0, ['Cycle sequence', ['cs_baskets', 'cs_table', 'cs_housing', 'cs_orders', 'cs_freight'], 'Economy'], ['Labour leads', ['lab_temp', 'lab_hours', 'lab_postings', 'lab_quits'], 'Economy']);
  const j = U.findIndex(x => x[0] === 'Inflation'); U[j][1].push('inf_core');
  U.splice(j + 1, 0, ['Inflation pipeline', ['inf_pipe', 'inf_rents', 'inf_paid'], 'Economy']); }
Object.assign(TILE_SETS.regime, { 'Leading board': ['Tested leads improving', 'US growth & jobs leads', 'Inflation leads rising', 'Global & Asia leads', 'Market canaries'] });
Object.assign(TILE_SETS.us, { 'Cycle sequence': ['Leading basket', 'Cyclical basket', 'Aggregate basket', 'Single-family permits', 'Months’ supply'],
  'Labour leads': ['Overtime hours', 'Quits rate', 'Temp help jobs', 'Job postings', 'Continuing claims'], 'Inflation pipeline': ['Prices paid', 'Asking rents', 'Wage tracker', 'CPI', 'Core PCE'] });
function buildLeads() {
  setTimeout(() => loadLeads().then(() => { if (['weekly', 'overview', 'regime', 'us', 'asia', 'my', 'cn'].includes(state.tab)) renderTab(); }), 500);   // small file (~200 KB): loaded after the first page is drawn
  const rg = $('#regGrid');
  makeCard(rg, { key: 'lb_table', title: 'Leading board', wide: true, range: false, seg: { key: 'lbView', options: LB_GROUPS.map(g => [g, g]) }, render: renderLbTable });
  makeCard(rg, { key: 'lb_breadth', title: 'Breadth of the leads', defaultRange: '10Y', seg: { key: 'lbBreadth', options: [['groups', 'By group'], ['spx', 'vs S&P 500']] }, render: renderLbBreadth });
  makeCard(rg, { key: 'lb_changes', title: 'Leads that turned this month', range: false, render: renderLbChanges });
  for (const k of ['lb_table', 'lb_changes']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
  const ug = $('#usGrid');
  makeCard(ug, { key: 'cs_baskets', title: 'US cycle sequence: four baskets', wide: true, defaultRange: 'MAX', earliest: Date.UTC(1975, 0, 1), render: renderCsBaskets });
  makeCard(ug, { key: 'cs_table', title: 'The components', range: false, render: c => { if (ldWait(c)) return; renderCsTable(c); } });
  makeCard(ug, { key: 'cs_housing', title: 'Housing: the first domino', defaultRange: '10Y', seg: { key: 'csHouse', options: [['supply', 'Permits & supply'], ['xhb', 'Homebuilders']] }, render: renderCsHousing });
  makeCard(ug, { key: 'cs_orders', title: 'Orders minus inventories', defaultRange: '10Y', ...leadCard('csOrdLead', ['LD_OI_PHI', 'level', 'Philadelphia Fed new orders minus inventories'], ['INDPRO', 'yoy', 'Industrial production, % YoY'], 9,
    'When orders run ahead of stock on the shelves, factories have to produce more. The Philadelphia Fed survey stands in for ISM’s new-orders and inventories figures, which are licensed. Against the ISM itself the gap moves in the same month (both are surveys of the same month), so it is drawn against output.') });
  { const o = cards.cs_orders, r0 = o.render; o.render = () => { if (!LEADS) { loadLeads().then(() => o.render()); } r0(); }; }
  makeCard(ug, { key: 'cs_freight', title: 'Freight and heavy trucks', defaultRange: '10Y', render: renderCsFreight });
  { const r = cards.cs_table.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
  makeCard(ug, { key: 'lab_temp', title: 'Temporary and full-time jobs', defaultRange: 'MAX', earliest: Date.UTC(1995, 0, 1), render: renderLabTemp });
  makeCard(ug, { key: 'lab_hours', title: 'Factory overtime hours', defaultRange: 'MAX', earliest: Date.UTC(1990, 0, 1),
    ...leadCard('labHrsLead', ['AWOTMAN', 'chg6', 'Factory overtime hours, 6-month change'], ['PAYEMS', 'yoy', 'Payrolls, % YoY'], 7, 'Firms cut overtime before they cut people, and add it back before they hire.') });
  makeCard(ug, { key: 'lab_postings', title: 'Job postings vs openings', defaultRange: '5Y', render: renderLabPostings });
  makeCard(ug, { key: 'lab_quits', title: 'Quits lead wages', defaultRange: 'MAX',
    ...leadCard('labQuitLead', ['QUITS', 'level', 'Quits rate, %'], ['WAGE_ATL', 'level', 'Wage growth (Atlanta Fed tracker), %'], 11, 'Workers quit when they are confident of a better-paid job, so a falling quits rate means less pressure on pay about a year later.') });
  makeCard(ug, { key: 'inf_pipe', title: 'Inflation pipeline', wide: true, range: false, render: renderInfPipe });
  { const r = cards.inf_pipe.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
  makeCard(ug, { key: 'inf_rents', title: 'Asking rents vs CPI shelter', defaultRange: 'MAX',
    ...leadCard('infRentLead', ['ZORI_US', 'yoy', 'Asking rents (Zillow), % YoY'], ['CPI_SHELTER', 'yoy', 'CPI shelter, % YoY'], 12, 'CPI shelter measures rents on all leases, most signed long ago, so it trails the rents asked on new leases. San Francisco Fed research puts the lag at about a year.') });
  { const o = cards.inf_rents, r0 = o.render; o.render = () => { if (!LEADS) { loadLeads().then(() => o.render()); setEmpty(o, 'Loading…'); return; } r0(); }; }
  makeCard(ug, { key: 'inf_paid', title: 'Factory prices paid vs CPI', defaultRange: 'MAX', earliest: Date.UTC(1990, 0, 1),
    ...leadCard('infPaidLead', ['PHILLY_PP', 'level', 'Philadelphia Fed prices paid'], ['CPI', 'yoy', 'CPI, % YoY'], 5, 'Factories report the prices they pay for materials before those costs reach shop prices.') });
  makeCard(ug, { key: 'inf_core', title: 'Underlying inflation', defaultRange: '10Y', render: renderInfCore });
  // Run 2: global breadth and money, canaries, Asian trade pulse, China credit, Malaysia pulse, presidential cycle, put/call
  makeCard(rg, { key: 'gl_diff', title: 'Breadth of the leading indices', wide: true, defaultRange: 'MAX', earliest: Date.UTC(1990, 0, 1),
    seg: { key: 'glDiffT', select: true, label: 'Compare with', prefix: 'vs', options: GL_DIFF_T.map(x => [x[0], x[2].replace(/,.*$/, '')]) }, render: renderGlDiff });
  makeCard(rg, { key: 'gl_money', title: 'Global real money (ex-China)', defaultRange: 'MAX', earliest: Date.UTC(1990, 0, 1), seg: { key: 'glMoney', options: [['LD_RNM6', 'Narrow'], ['LD_RBM6', 'Broad']] }, render: renderGlMoney });
  makeCard(rg, { key: 'gl_table', title: 'Leading indices by economy', range: false, render: renderGlTable });
  makeCard(rg, { key: 'can_table', title: 'Market canaries', wide: true, range: false, render: renderCanTable });
  makeCard(rg, { key: 'can_chart', title: 'Canary vs what it leads', defaultRange: '10Y', seg: LEAD_SEG('canLead'), render: renderCanChart });
  for (const k of ['gl_table', 'can_table']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
  const ag = $('#asiaGrid');
  seeAlso('sa_asia_pulse', ag, [['China credit impulse', 'cn', 'Economy'], ['Korea: exports and chips', 'kr', 'Economy'], ['Exports across Asia-Pacific', 'asia', 'Across Asia'], ['Leading board', 'regime', 'Leading board']]);
  makeCard(ag, { key: 'ax_pulse', title: 'Asian trade pulse', wide: true, defaultRange: '10Y',
    seg: { key: 'axPulseT', select: true, label: 'Compare with', prefix: 'vs', options: AX_PULSE_T.map(x => [x[0], x[2].replace(/,.*$/, '')]) }, render: renderAxPulse });
  makeCard(ag, { key: 'ax_pulse_table', title: 'The pulse’s parts', range: false, render: c => { if (ldWait(c)) return; renderAxPulseTable(c); } });
  makeCard(ag, { key: 'ax_krw', title: 'Korean won vs Korea’s exports', defaultRange: '10Y', seg: LEAD_SEG('axKrw'), render: renderAxKrw });
  { const r = cards.ax_pulse_table.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
  makeCard($('#cnGrid'), { key: 'cn_credit', title: 'China credit impulse (BIS)', defaultRange: 'MAX', earliest: Date.UTC(2000, 0, 1), render: renderCnCredit });
  const mg = $('#myGrid');
  makeCard(mg, { key: 'my_pulse', title: 'Malaysia pulse', wide: true, range: false, render: renderMyPulse });
  makeCard(mg, { key: 'my_pay', title: 'Online payments (FPX)', defaultRange: '3Y', render: renderMyPay });
  makeCard(mg, { key: 'my_cars', title: 'Car registrations vs retail', defaultRange: '10Y', render: renderMyCars });
  makeCard(mg, { key: 'my_arrivals', title: 'Tourist arrivals', defaultRange: 'MAX', render: renderMyArrivals });
  makeCard(mg, { key: 'my_ee', title: 'Electronics exports vs chips', defaultRange: '10Y', render: renderMyEe });
  { const r = cards.my_pulse.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
  const sg = $('#seaGrid');
  makeCard(sg, { key: 'sea_cycle', title: 'US presidential cycle', range: false, render: renderSeaCycle });
  makeCard(sg, { key: 'sea_cycle_tbl', title: 'Presidential cycle by quarter', range: false, render: renderSeaCycleTbl });
  { const r = cards.sea_cycle_tbl.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
  makeCard($('#pvGrid'), { key: 'sent_pc', title: 'Put/call ratios', defaultRange: '1Y', render: renderSentPc });
}
