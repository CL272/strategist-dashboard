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
  { id: 'LD_CLI_DIFF', mode: 'level', name: 'Leading indices rising (17 economies)', group: 'Global & Asia', lead: ['ACWI', 'yoy', 'world equities', true], claim: 'breadth turns before markets', home: ['regime', 'Global business cycle'] },
  { id: 'LD_RNM6', mode: 'level', name: 'Global real narrow money (ex-China)', group: 'Global & Asia', lead: ['BCI_G7', 'level', 'G7 business confidence', true], claim: '6–9 m (Simon Ward)', home: ['regime', 'Global business cycle'] },
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

// ------------------------------------------------------------------ build and wiring
const EXTRA_HOOKS = { regime: [lbTiles], us: [usLeadTiles] };
{ const R = SUBTABS.regime, i = R.findIndex(x => x[0] === 'Indicators'); R.splice(i < 0 ? R.length : i, 0, ['Leading board', ['lb_table', 'lb_breadth', 'lb_changes'], 'Leading']); }
{ const U = SUBTABS.us, i = U.findIndex(x => x[0] === 'Growth & jobs') + 1;
  U.splice(i, 0, ['Cycle sequence', ['cs_baskets', 'cs_table', 'cs_housing', 'cs_orders', 'cs_freight'], 'Economy'], ['Labour leads', ['lab_temp', 'lab_hours', 'lab_postings', 'lab_quits'], 'Economy']);
  const j = U.findIndex(x => x[0] === 'Inflation'); U[j][1].push('inf_core');
  U.splice(j + 1, 0, ['Inflation pipeline', ['inf_pipe', 'inf_rents', 'inf_paid'], 'Economy']); }
Object.assign(TILE_SETS.regime, { 'Leading board': ['Tested leads improving', 'US growth & jobs leads', 'Inflation leads rising', 'Global & Asia leads', 'Market canaries'] });
Object.assign(TILE_SETS.us, { 'Cycle sequence': ['Leading basket', 'Cyclical basket', 'Aggregate basket', 'Single-family permits', 'Months’ supply'],
  'Labour leads': ['Overtime hours', 'Quits rate', 'Temp help jobs', 'Job postings', 'Continuing claims'], 'Inflation pipeline': ['Prices paid', 'Asking rents', 'Wage tracker', 'CPI', 'Core PCE'] });
function buildLeads() {
  setTimeout(() => loadLeads().then(() => { if (['weekly', 'overview', 'regime', 'us'].includes(state.tab)) renderTab(); }), 500);   // small file (~200 KB): loaded after the first page is drawn
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
}
