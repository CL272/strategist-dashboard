// ------------------------------------------------------------------ AUSTRALIA: WHAT DRIVES THE RBA (WP74 to WP76, owner's request, 16 Nov 2026)
// Loaded after leads.js. Data: RBA tables and the ABS Data API (asia.json), BIS house prices (fred.json), and the RBA's
// own NAIRU and forecasts from its quarterly Statement, kept by hand in pipeline/config.py (RBA_SMP, published in meta.json).
'use strict';

const auSmp = () => (META && META.rba_smp) || { nairu: 4.75, nairu_models: 5.0, unemp_fc: [], asof: '', trim_fc_note: '' };
const auQ = id => { const s = S[id]; if (!s || s.t.length < 3) return false; const n = s.t.length; return s.freq === 'Q' || (s.t[n - 1] - s.t[n - 3]) / 2 > 60 * DAY; };   // quarterly series
function auRead(id, k = 0, s0 = null) {   // latest value, change over 3 months, 10-year percentile; k = year-on-year over k observations
  const s = s0 || (k ? yoyOf(id, k) : S[id]); if (!s || !s.t || !s.t.length) return null;
  const a = asOf(s, state.latest); if (!a) return null;
  const b = asOf(s, addMonths(a.t, -3)), lo = addMonths(a.t, -120), w = [];
  for (let i = 0; i <= a.i; i++) if (s.t[i] >= lo) w.push(s.v[i]);
  const y = asOf(s, addMonths(a.t, -12));
  return { v: a.v, t: a.t, d3: b && b.t < a.t ? a.v - b.v : null, y: y && y.t < a.t ? y.v : null, pct: w.length >= 8 ? w.filter(x => x <= a.v).length / w.length * 100 : null };
}
const auWhen = (id, t) => auQ(id) ? `Q${Math.floor(new Date(t).getUTCMonth() / 3) + 1} ${new Date(t).getUTCFullYear()}` : monthLab(t);

// ------------------------------------------------------------------ "What the RBA is watching" (Rates & bonds)
// Each driver has a fixed rule for its lean; the note prints every rule. A reading aid: the Board decides on its forecasts and judgement.
function auHsiReal() {   // household spending growth less monthly CPI inflation: a rough real growth rate
  if (!has('AU_HSI_YOY', 'AU_CPI_M_YOY')) return null;
  const c = combine(S.AU_HSI_YOY, S.AU_CPI_M_YOY, (a, b) => a - b, {}, 40 * DAY); return c.t.length ? { ...c, id: 'AU_HSI_REAL' } : null;
}
const AU_DRIVERS = [
  { name: 'Trimmed-mean inflation', id: 'AU_TRIM_YOY', f: v => fmtNum(v, 1) + '%', lean: x => x.v > 3 ? 1 : x.v < 2.5 ? -1 : 0, rule: 'above 3% leans toward a rise, below 2½% toward a cut', fc: s => s.trim_fc_note },
  { name: 'Monthly CPI', id: 'AU_CPI_M_YOY', f: v => fmtNum(v, 1) + '%', lean: x => x.v > 3.5 && x.d3 > 0 ? 1 : x.v < 2.5 ? -1 : 0, rule: 'above 3½% and rising: rise; below 2½%: cut' },
  { name: 'Unemployment vs the RBA’s line', id: 'AU_UNEMP', f: v => fmtNum(v, 1) + '%', lean: (x, s) => { const g = x.v - s.nairu; return g < -0.25 ? 1 : g > 0.25 && x.d3 > 0 ? -1 : 0; },
    rule: 'more than ¼ point below the RBA’s full-employment line: rise; more than ¼ point above it and rising: cut',
    fc: s => s.unemp_fc && s.unemp_fc.length ? `${fmtNum(s.unemp_fc[0][1], 1)}% end-${s.unemp_fc[0][0].slice(0, 4)} → ${fmtNum(s.unemp_fc[s.unemp_fc.length - 1][1], 1)}% end-${s.unemp_fc[s.unemp_fc.length - 1][0].slice(0, 4)}` : '' },
  { name: 'Underemployment', id: 'AU_UNDEREMP', f: v => fmtNum(v, 1) + '%', lean: x => x.pct == null ? 0 : x.pct < 25 ? 1 : x.pct > 75 ? -1 : 0, rule: 'in the lowest quarter of its 10 years: rise; highest quarter: cut' },
  { name: 'Wage growth (WPI)', id: 'AU_WPI_YOY', f: v => fmtNum(v, 1) + '%', lean: x => x.v > 3.75 ? 1 : x.v < 3 ? -1 : 0, rule: 'above 3¾%: rise; below 3%: cut (about 3 to 3½% fits the target given weak productivity)' },
  { name: 'Household spending, after inflation', id: 'AU_HSI_YOY', real: true, f: v => pctF1(v), lean: x => x.v > 3 ? 1 : x.v < 1 ? -1 : 0, rule: 'spending growth less monthly CPI inflation above 3%: rise; below 1%: cut' },
  { name: 'New home loans', id: 'AU_LOANS', k: 4, f: v => pctF1(v), lean: x => x.v > 10 ? 1 : x.v < -10 ? -1 : 0, rule: 'up more than 10% on a year: rise; down more than 10%: cut' },
  { name: 'House prices (ABS, lags)', id: 'AU_HOUSE_PX', k: 4, f: v => pctF1(v), lean: x => x.v > 8 ? 1 : x.v < 0 ? -1 : 0, rule: 'up more than 8% on a year: rise; falling: cut' },
  { name: 'Consumer sentiment', id: 'AU_CONS_SENT', f: v => fmtNum(v, 1), lean: x => x.v > 105 ? 1 : x.v < 90 ? -1 : 0, rule: 'above 105: rise; below 90 (100 = as many optimists as pessimists): cut' },
  { name: 'Economists’ 1-year inflation expectations', id: 'AU_INFEXP_MKT', f: v => fmtNum(v, 1) + '%', lean: x => x.v > 3 ? 1 : x.v < 2.5 ? -1 : 0, rule: 'above 3%: rise; below 2½%: cut' },
];
function auDriverRows() {
  const smp = auSmp();
  return AU_DRIVERS.map(d => { const x = d.real ? auRead('AU_HSI_REAL', 0, auHsiReal()) : auRead(d.id, d.k || 0); return x ? { d, x, lean: d.lean(x, smp) } : null; }).filter(Boolean);
}
function auMarket() {   // 3-month bank bill less the cash rate: what the market prices for the next three months
  if (!has('AU_3M', 'AU_CASH')) return null;
  const a = asOf(S.AU_3M, state.latest), c = asOf(S.AU_CASH, state.latest); if (!a || !c) return null;
  const g = (a.v - c.v) * 100; return { g, t: a.t, lean: g > 10 ? 1 : g < -10 ? -1 : 0 };
}
const leanTxt = l => l > 0 ? '▲ toward a rise' : l < 0 ? '▼ toward a cut' : '▬ neutral';
function renderAuDrivers(c) {
  const b = htmlBody(c), smp = auSmp(), rows = auDriverRows(), heads = ['Driver', 'Latest', 'Data', '3M', 'Pct (10Y)', 'RBA forecast', 'Lean'], tb = el('tbody'), csv = [heads];
  if (!rows.length) { b.append(el('div', { class: 'empty', text: 'Waiting for data.' })); return; }
  for (const { d, x, lean } of rows) {
    const fc = d.fc ? d.fc(smp) : '';
    tb.append(el('tr', { class: 'row', title: `Rule: ${d.rule}.` },
      el('td', { class: 'l', text: d.name + (d.id === 'AU_UNEMP' ? ` (line ${fmtNum(smp.nairu, 2)}%)` : '') }), el('td', { class: 'num strong', text: d.f(x.v) }),
      el('td', { class: 'num muted', text: auWhen(d.real ? 'AU_HSI_YOY' : d.id, x.t) }), el('td', { class: 'num', text: ldArrow(x.d3 == null ? null : Math.abs(x.d3) < 0.05 ? 0 : x.d3) }),
      el('td', { class: 'num', text: ordF(x.pct) }), el('td', { class: 'l muted', text: fc || '–' }), el('td', { class: 'num' + (lean ? ' strong' : ' muted'), text: leanTxt(lean) })));
    csv.push([d.name, x.v, auWhen(d.real ? 'AU_HSI_YOY' : d.id, x.t), x.d3, x.pct, fc, leanTxt(lean), d.rule]);
  }
  const m = auMarket();
  if (m) { tb.append(el('tr', { class: 'grp' }, el('td', { colspan: heads.length, text: 'The market (not counted)' })));
    tb.append(el('tr', { class: 'row', title: 'The 3-month bank bill rate less the cash rate: roughly what the market prices for the next three months. Above +10bp: a rise priced; below −10bp: a cut.' },
      el('td', { class: 'l', text: '3M bank bill − cash rate' }), el('td', { class: 'num strong', text: sign(m.g) + fmtNum(Math.abs(m.g), 0) + 'bp' }), el('td', { class: 'num muted', text: nice(m.t) }),
      el('td', { class: 'num', text: '–' }), el('td', { class: 'num', text: '–' }), el('td', { class: 'l muted', text: '–' }), el('td', { class: 'num strong', text: leanTxt(m.lean).replace('toward', 'priced:') })));
    csv.push(['3M bank bill − cash rate (bp)', m.g, iso(m.t), '', '', '', leanTxt(m.lean)]); }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table ld-table' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: [0, 5].includes(i) ? 'l' : '' })))), tb)));
  c.csv = csv;
  const up = rows.filter(r => r.lean > 0).length, dn = rows.filter(r => r.lean < 0).length;
  setNote(c, `${up} of ${rows.length} drivers lean toward a rise and ${dn} toward a cut; ${m ? `the market prices ${m.g >= 0 ? 'about +' : 'about −'}${fmtNum(Math.abs(m.g), 0)}bp over three months` : 'market pricing unavailable'}. `
    + `The RBA moves on inflation first: it raised the cash rate in November because inflation stays above its 2–3% target, even with house prices and consumer spending soft. Its full-employment line is the unemployment rate it thinks keeps inflation stable (the NAIRU): ${fmtNum(smp.nairu, 2)}% in its ${smp.asof ? monthLab(Date.parse(smp.asof)) : 'latest'} Statement, with its models averaging about ${fmtNum(smp.nairu_models, 1)}%. `
    + 'Rules for the lean (fixed, so the reading is repeatable): ' + AU_DRIVERS.map(d => `${d.name}: ${d.rule}`).join('; ') + '. '
    + 'A reading aid, not a forecast: the Board decides on its own forecasts and judgement, and some drivers (house prices, wages) arrive a quarter late. Household spending is in dollars, so monthly CPI is taken off it.');
  setSource(c, 'RBA tables G1, G3, G4, H3, H4, H5, F1; ABS Data API (Household Spending Indicator, Labour Force, Lending Indicators, Residential Dwellings); RBA Statement on Monetary Policy (NAIRU, forecasts)');
}

// ------------------------------------------------------------------ Labour market
function renderAuNairu(c) {
  if (!has('AU_UNEMP')) return setEmpty(c, 'Waiting for data.');
  const smp = auSmp(), L = [{ name: 'Unemployment rate', data: pts(S.AU_UNEMP, state.from, state.to) }];
  if (smp.unemp_fc && smp.unemp_fc.length) { const last = asOf(S.AU_UNEMP, state.latest);
    L.push({ name: `RBA forecast (${smp.asof ? monthLab(Date.parse(smp.asof)) : 'latest'} Statement)`, data: [[last.t, last.v], ...smp.unemp_fc.map(([t, v]) => [Date.parse(t), v])],
      extra: { lineStyle: { type: 'dashed', width: 2 }, showSymbol: true, symbolSize: 6 } }); }
  drawLines(c, L, { fmt: v => fmtNum(v, 1) + '%', axisFmt: v => fmtNum(v, 0) + '%', endLabels: false,
    hlines: [{ y: smp.nairu, label: `RBA full-employment line ${fmtNum(smp.nairu, 2)}%` }, { y: smp.nairu_models, label: `its models ${fmtNum(smp.nairu_models, 1)}%` }] });
  if (c.inst && smp.unemp_fc && smp.unemp_fc.length) c.inst.setOption({ xAxis: { max: Math.max(state.to, Date.parse(smp.unemp_fc[smp.unemp_fc.length - 1][0])) } });
  const a = asOf(S.AU_UNEMP, state.latest), g = a.v - smp.nairu;
  setNote(c, `Unemployment is ${fmtNum(a.v, 1)}% (${monthLab(a.t)}), ${Math.abs(g) < 0.05 ? 'right at' : `${fmtNum(Math.abs(g), 2)} points ${g > 0 ? 'above' : 'below'}`} the RBA’s ${fmtNum(smp.nairu, 2)}% line. `
    + 'The line is the RBA’s estimate of the lowest unemployment rate that does not push up inflation (the NAIRU): below it, firms compete for workers and wages and prices rise faster; above it, the opposite. '
    + `The RBA raised it in November from about 4½% and still calls the labour market “a little tight”; its models average about ${fmtNum(smp.nairu_models, 1)}%. It forecasts unemployment to rise to ${smp.unemp_fc && smp.unemp_fc.length ? fmtNum(smp.unemp_fc[smp.unemp_fc.length - 1][1], 1) + '%' : 'about 5%'} by end-2028: it expects to go above its line to bring inflation down. `
    + 'The line is uncertain by about half a point either way and has been revised before; it is entered by hand from each quarterly Statement.');
  setSource(c, 'RBA table H5 (ABS Labour Force); RBA Statement on Monetary Policy (NAIRU and forecasts)');
}
const AU_TIGHT = [   // [id, name, higher = tighter?]
  ['AU_UNDEREMP', 'Underemployment rate', false], ['AU_UNDERUTIL', 'Underutilisation rate', false], ['AU_VAC_LF', 'Job vacancies, % of labour force', true],
  ['AU_HOURS_YOY', 'Hours worked growth (trend)', true], ['AU_EMPPOP', 'Employment ÷ population', true], ['AU_PART', 'Participation rate', true],
];
function renderAuTight(c) {
  const b = htmlBody(c), heads = ['Gauge', 'Latest', 'A year ago', 'Pct (10Y)', 'Reads'], tb = el('tbody'), csv = [heads];
  for (const [id, name, up] of AU_TIGHT) {
    const x = auRead(id); if (!x) continue;
    const tp = x.pct == null ? null : up ? x.pct : 100 - x.pct, read = tp == null ? '–' : tp >= 60 ? 'tight' : tp <= 40 ? 'loose' : 'normal';
    tb.append(el('tr', { class: 'row', title: `${S[id].label} · data to ${auWhen(id, x.t)}` }, el('td', { class: 'l', text: name }), el('td', { class: 'num strong', text: fmtNum(x.v, 1) + '%' }),
      el('td', { class: 'num muted', text: x.y == null ? '–' : fmtNum(x.y, 1) + '%' }), el('td', { class: 'num', text: ordF(x.pct) }), el('td', { class: 'num' + (read === 'tight' ? ' strong' : ''), text: read })));
    csv.push([name, x.v, x.y, x.pct, read]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf watch' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i ? '' : 'l' })))), tb)));
  c.csv = csv;
  const tight = csv.slice(1).filter(r => r[4] === 'tight').length;
  setNote(c, `${tight} of ${csv.length - 1} gauges read tight against their own 10 years. These are the measures the RBA lists when it judges how tight the labour market is; it reads underemployment, underutilisation and quits as the clearest signs of tightness now. Tight = in the tighter 40% of its 10-year range.`);
  setSource(c, 'ABS Data API (Labour Force: underemployment); RBA table H5');
}
function renderAuWages(c) {
  const L = [['AU_WPI_YOY', 'Wage price index, % YoY'], ['AU_ULC_YOY', 'Unit labour costs, % YoY'], ['AU_TRIM_YOY', 'Trimmed-mean inflation, % YoY']].filter(([id]) => has(id))
    .map(([id, n]) => ({ name: n, data: pts(S[id], state.from, state.to), extra: { step: 'end' } }));
  if (!L.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, L, { fmt: v => fmtNum(v, 1) + '%', axisFmt: v => fmtNum(v, 0) + '%', endLabels: false, hlines: [{ y: 3, label: 'top of the 2–3% target' }] });
  const w = auRead('AU_WPI_YOY'), u = auRead('AU_ULC_YOY');
  setNote(c, `Wages are growing ${w ? fmtNum(w.v, 1) + '%' : '–'} a year and unit labour costs ${u ? fmtNum(u.v, 1) + '%' : '–'} (${w ? auWhen('AU_WPI_YOY', w.t) : ''}). Unit labour costs are wages per unit of output: with productivity barely growing, almost all of a wage rise becomes a cost rise, which is why the RBA watches them alongside inflation.`);
  setSource(c, 'RBA tables H4 (ABS Wage Price Index, national accounts) and G1');
}
function renderAuLf(c) {
  if (!has('AU_PART', 'AU_UNEMP')) return setEmpty(c, 'Waiting for data.');
  drawPair(c, { name: 'Participation rate, %', data: pts(S.AU_PART, state.from, state.to) }, { name: 'Unemployment rate, %', data: pts(S.AU_UNEMP, state.from, state.to) },
    { fmtA: v => fmtNum(v, 1) + '%', fmtB: v => fmtNum(v, 1) + '%', axisA: v => fmtNum(v, 0) + '%', axisB: v => fmtNum(v, 1) + '%' });
  const p = auRead('AU_PART'), u = auRead('AU_UNEMP');
  setNote(c, `Participation ${p ? fmtNum(p.v, 1) + '%' : '–'}, unemployment ${u ? fmtNum(u.v, 1) + '%' : '–'} (${u ? monthLab(u.t) : ''}). Unemployment rising because more people are looking for work is different from it rising because jobs are lost: the RBA says the recent rise was mostly the first kind, with employment still growing, so it reads the labour market as only a little looser.`);
  setSource(c, 'RBA table H5 (ABS Labour Force)');
}

// ------------------------------------------------------------------ Housing & households
function renderAuHousePx(c) {
  const L = [['AU_HOUSE_PX', 'Mean dwelling price (ABS), % YoY'], ['AU_HPI_NOM', 'House prices (BIS), % YoY']].filter(([id]) => has(id))
    .map(([id, n]) => ({ name: n, data: pts(yoyOf(id, 4), state.from, state.to), extra: { step: 'end' } }));
  if (!L.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, L, { fmt: pctF1, axisFmt: v => fmtNum(v, 0) + '%', zero: true, endLabels: false });
  const a = auRead('AU_HOUSE_PX', 4);
  setNote(c, `The official price series is ${a ? (a.v >= 0 ? 'up ' : 'down ') + fmtNum(Math.abs(a.v), 1) + '%' : '–'} on a year to ${a ? auWhen('AU_HOUSE_PX', a.t) : '–'}, but it is quarterly and arrives late. The RBA’s November Statement, using monthly private data, says national prices were 4.7% below their March peak by September, one of the steepest falls in 50 years, driven by higher rates and tax changes for investors. The monthly index it quotes (Cotality) is not free.`);
  setSource(c, 'ABS Data API (Residential Dwellings, mean price); BIS residential property prices via FRED (QAUN628BIS)');
}
function renderAuLoans(c) {
  const L = [['AU_LOANS', 'All new home loans'], ['AU_LOANS_OO', 'Owner-occupiers'], ['AU_LOANS_INV', 'Investors']].filter(([id]) => has(id))
    .map(([id, n]) => ({ name: n + ', % YoY', data: pts(yoyOf(id, 4), state.from, state.to), extra: { step: 'end' } }));
  if (!L.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, L, { fmt: pctF1, axisFmt: v => fmtNum(v, 0) + '%', zero: true, endLabels: false });
  const a = auRead('AU_LOANS', 4), i = auRead('AU_LOANS_INV', 4), st = typeof ldBestLead === 'function' ? ldBestLead('AU_LOANS', 'yoy', 'AU_HOUSE_PX', 'yoy') : null;
  setNote(c, `New home loans are ${a ? (a.v >= 0 ? 'up ' : 'down ') + fmtNum(Math.abs(a.v), 1) + '%' : '–'} on a year (${a ? auWhen('AU_LOANS', a.t) : ''}), and loans to investors ${i ? (i.v >= 0 ? 'up ' : 'down ') + fmtNum(Math.abs(i.v), 1) + '%' : '–'}. Credit has to be approved before a purchase settles, so loans tend to turn before prices; on the dashboard’s test ${st && st.ok ? `they have led prices by ${st.k} months (correlation ${corrF(st.rk)})` : `the lead over prices is context: ${ldWhy(st)}`}. Quarterly since the ABS changed the release in 2025.`);
  setSource(c, 'ABS Data API (Lending Indicators, new loan commitments, seasonally adjusted)');
}
state.auCredit = 'growth';
function renderAuCredit(c) {
  if (state.auCredit === 'rates') {
    const L = [['AU_MORT_RATE', 'Mortgage rate, outstanding variable loans'], ['AU_MORT_RATE_NEW', 'Mortgage rate, new loans'], ['AU_CASH', 'RBA cash rate']].filter(([id]) => has(id))
      .map(([id, n]) => ({ name: n, data: pts(S[id], state.from, state.to) }));
    if (!L.length) return setEmpty(c, 'Waiting for data.');
    drawLines(c, L, { fmt: v => fmtNum(v, 2) + '%', axisFmt: v => fmtNum(v, 1) + '%', endLabels: false });
    const m = auRead('AU_MORT_RATE');
    setNote(c, `The average owner-occupier variable mortgage rate is ${m ? fmtNum(m.v, 2) + '%' : '–'} (${m ? monthLab(m.t) : ''}). Most Australian mortgages are variable, so a cash-rate rise reaches household budgets within a month or two: the reason RBA moves bite faster than in the US. Owner-occupier loans; series from 2019.`);
    setSource(c, 'RBA tables F6 and F1');
  } else {
    const L = [['AU_CREDIT_OO_YOY', 'Owner-occupier housing credit, % YoY'], ['AU_CREDIT_INV_YOY', 'Investor housing credit, % YoY']].filter(([id]) => has(id))
      .map(([id, n]) => ({ name: n, data: pts(S[id], state.from, state.to) }));
    if (!L.length) return setEmpty(c, 'Waiting for data.');
    drawLines(c, L, { fmt: pctF1, axisFmt: v => fmtNum(v, 0) + '%', zero: true, endLabels: false });
    const o = auRead('AU_CREDIT_OO_YOY'), i = auRead('AU_CREDIT_INV_YOY');
    setNote(c, `Housing credit is growing ${o ? fmtNum(o.v, 1) + '%' : '–'} a year for owner-occupiers and ${i ? fmtNum(i.v, 1) + '%' : '–'} for investors (${o ? monthLab(o.t) : ''}). Credit outstanding changes slowly; new loans (left) show the turn first.`);
    setSource(c, 'RBA table D1');
  }
}
function renderAuBuild(c) {
  ldLeadPair(c, ['AU_APPROVALS', 'yoy', 'Dwelling approvals, % YoY'], ['AU_DWELL_INV_YOY', 'level', 'Dwelling investment, % YoY'], state.auBuildLead === '1',
    'Approvals are permits to build; construction (dwelling investment) follows over the next year or so.', { fmtA: pctF1, axisA: v => fmtNum(v, 0) + '%', fmtB: pctF1, axisB: v => fmtNum(v, 0) + '%' },
    'The RBA expects higher rates and falling prices to weigh on dwelling investment; builders report fewer enquiries and sales.');
}
function renderAuSpend(c) {
  if (!has('AU_HSI_YOY', 'AU_CONS_SENT')) return setEmpty(c, 'Waiting for data.');
  drawPair(c, { name: 'Household spending, % YoY (in dollars)', data: pts(S.AU_HSI_YOY, state.from, state.to) }, { name: 'Consumer sentiment (100 = neutral)', data: pts(S.AU_CONS_SENT, state.from, state.to) },
    { fmtA: pctF1, axisA: v => fmtNum(v, 0) + '%', fmtB: v => fmtNum(v, 1), axisB: v => fmtNum(v, 0), zeroA: true });
  const h = auRead('AU_HSI_YOY'), r = auRead('AU_HSI_REAL', 0, auHsiReal()), s = auRead('AU_CONS_SENT'), k = auRead('AU_CONS_YOY');
  setNote(c, `Household spending is up ${h ? fmtNum(h.v, 1) + '%' : '–'} on a year (${h ? monthLab(h.t) : ''}), about ${r ? pctF1(r.v) : '–'} after monthly CPI inflation; the national accounts show real consumption growing ${k ? fmtNum(k.v, 1) + '%' : '–'} (${k ? auWhen('AU_CONS_YOY', k.t) : ''}), which the RBA calls below trend. `
    + `Sentiment at ${s ? fmtNum(s.v, 1) : '–'} is well below 100: more households are pessimistic than optimistic. Dollar spending can look strong while volumes are soft when prices are rising; the RBA notes the timely indicators give mixed signals.`);
  setSource(c, 'ABS Data API (Monthly Household Spending Indicator); RBA tables H3 (Westpac-Melbourne Institute) and H2; calculated');
}
function renderAuBuffers(c) {
  const L = [['AU_SAVING', 'Household saving ratio, %'], ['AU_MORT_PAY', 'Scheduled mortgage payments, % of household income']].filter(([id]) => has(id))
    .map(([id, n]) => ({ name: n, data: pts(S[id], state.from, state.to), extra: { step: 'end' } }));
  if (!L.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, L, { fmt: v => fmtNum(v, 1) + '%', axisFmt: v => fmtNum(v, 0) + '%', endLabels: false });
  const sv = auRead('AU_SAVING'), mp = auRead('AU_MORT_PAY'), d = auRead('AU_DEBT_INC');
  setNote(c, `Households save ${sv ? fmtNum(sv.v, 1) + '%' : '–'} of income, and scheduled mortgage payments take ${mp ? fmtNum(mp.v, 1) + '%' : '–'} of it (${mp ? auWhen('AU_MORT_PAY', mp.t) : ''}); household debt is ${d ? fmtNum(d.v, 0) + '%' : '–'} of annual income. A thin saving buffer with rising repayments is when higher rates cut spending fastest.`);
  setSource(c, 'RBA tables H2, E13 and E2');
}

// ------------------------------------------------------------------ tiles, wiring
function auTiles() {
  const sub = (SUBTABS.australia[state.sub.australia || 0] || [])[0];
  ldTiles('#australiaKpis', (box, tile) => {
    const smp = auSmp(), t1 = (l, x, f, d, w) => { if (x) tile(l, f(x.v), d, w); };
    if (sub === 'Rates & bonds') { const r = auDriverRows(); if (r.length) tile('RBA drivers', `${r.filter(x => x.lean > 0).length} of ${r.length} → rise`, `${r.filter(x => x.lean < 0).length} toward a cut`, 'What the RBA is watching'); }
    if (sub === 'Labour market') {
      tile('RBA full-employment line', fmtNum(smp.nairu, 2) + '%', `models ${fmtNum(smp.nairu_models, 1)}%`, smp.asof ? 'Statement ' + monthLab(Date.parse(smp.asof)) : '');
      const u = auRead('AU_UNDEREMP'), w = auRead('AU_WPI_YOY'), p = auRead('AU_PART');
      t1('Underemployment', u, v => fmtNum(v, 1) + '%', u && u.y != null ? `a year ago ${fmtNum(u.y, 1)}%` : '', u && monthLab(u.t));
      t1('Wage growth', w, v => fmtNum(v, 1) + '%', 'wage price index, YoY', w && auWhen('AU_WPI_YOY', w.t));
      t1('Participation', p, v => fmtNum(v, 1) + '%', p && p.y != null ? `a year ago ${fmtNum(p.y, 1)}%` : '', p && monthLab(p.t));
    }
    if (sub === 'Housing & households') {
      const l = auRead('AU_LOANS', 4), h = auRead('AU_HOUSE_PX', 4), s = auRead('AU_HSI_YOY'), c = auRead('AU_CONS_SENT'), m = auRead('AU_MORT_RATE');
      t1('New home loans', l, pctF1, 'on a year', l && auWhen('AU_LOANS', l.t)); t1('House prices', h, pctF1, 'on a year (ABS, lags)', h && auWhen('AU_HOUSE_PX', h.t));
      t1('Household spending', s, pctF1, 'on a year, in dollars', s && monthLab(s.t)); t1('Consumer sentiment', c, v => fmtNum(v, 1), '100 = neutral', c && monthLab(c.t));
      t1('Mortgage rate', m, v => fmtNum(v, 2) + '%', 'outstanding variable', m && monthLab(m.t));
    }
  });
}
SUB_PREV.australia = SUBTABS.australia.map(x => x[0] === 'Economy' ? 'Inflation & growth' : x[0]);   // old links: Economy is now "Inflation & growth"
{ const A = SUBTABS.australia, e = A.find(x => x[0] === 'Economy'); e[0] = 'Inflation & growth'; e[2] = 'Economy';
  A.push(['Labour market', ['au_nairu', 'au_tight', 'au_wages', 'au_lf'], 'Economy'], ['Housing & households', ['au_house_px', 'au_loans', 'au_hcredit', 'au_build', 'au_spend', 'au_buffers'], 'Economy']);
  const r = A.find(x => x[0] === 'Rates & bonds')[1]; r.splice(r.indexOf('#sa_australia_rates') + 1, 0, 'au_drivers'); }
Object.assign(TILE_SETS.australia, { 'Rates & bonds': ['RBA cash rate', 'RBA drivers', 'Trimmed-mean CPI', 'Unemployment rate', 'Australia 10Y'],
  'Labour market': ['Unemployment rate', 'RBA full-employment line', 'Underemployment', 'Wage growth', 'Participation'],
  'Housing & households': ['New home loans', 'House prices', 'Household spending', 'Consumer sentiment', 'Mortgage rate'] });
EXTRA_HOOKS.australia = [auTiles];
// lead tests (Correlation → Lead-lag)
LL_PAIRS.push(['AU_LOANS', 'yoy', 'AU_HOUSE_PX', 'yoy', 'Australia: new home loans → house prices'], ['AU_APPROVALS', 'yoy', 'AU_DWELL_INV_YOY', 'level', 'Australia: dwelling approvals → construction'],
  ['AU_CONS_SENT', 'level', 'AU_HSI_YOY', 'level', 'Australia: consumer sentiment → household spending'], ['AU_VAC_LF', 'level', 'AU_UNEMP', 'chg', 'Australia: job vacancies → unemployment'],
  ['AU_UNEMP', 'level', 'AU_WPI_YOY', 'level', 'Australia: unemployment → wage growth']);
function buildAu() {
  const g = $('#australiaGrid');
  makeCard(g, { key: 'au_drivers', title: 'What the RBA is watching', wide: true, range: false, render: renderAuDrivers });
  { const r = cards.au_drivers.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
  makeCard(g, { key: 'au_nairu', title: 'Unemployment vs the RBA’s line', wide: true, defaultRange: 'MAX', earliest: Date.UTC(1978, 0, 1), render: renderAuNairu });
  makeCard(g, { key: 'au_tight', title: 'How tight are jobs?', range: false, render: renderAuTight });
  { const r = cards.au_tight.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
  makeCard(g, { key: 'au_wages', title: 'Wages and labour costs', defaultRange: '10Y', render: renderAuWages });
  makeCard(g, { key: 'au_lf', title: 'Who is looking for work', defaultRange: '10Y', render: renderAuLf });
  makeCard(g, { key: 'au_house_px', title: 'House prices', defaultRange: 'MAX', earliest: Date.UTC(2000, 0, 1), render: renderAuHousePx });
  makeCard(g, { key: 'au_loans', title: 'New home loans', defaultRange: '10Y', render: renderAuLoans });
  makeCard(g, { key: 'au_hcredit', title: 'Housing credit and mortgage rates', defaultRange: '10Y', seg: { key: 'auCredit', options: [['growth', 'Credit growth'], ['rates', 'Mortgage rates']] }, render: renderAuCredit });
  makeCard(g, { key: 'au_build', title: 'Approvals vs construction', defaultRange: 'MAX', earliest: Date.UTC(1990, 0, 1), seg: LEAD_SEG('auBuildLead'), render: renderAuBuild });
  makeCard(g, { key: 'au_spend', title: 'Spending and sentiment', defaultRange: '5Y', render: renderAuSpend });
  makeCard(g, { key: 'au_buffers', title: 'Household buffers', defaultRange: '10Y', render: renderAuBuffers });
}
