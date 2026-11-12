// ------------------------------------------------------------------ STRUCTURED PRODUCTS (WP38 to WP43)
// Every structured product is a bond plus options the client buys or sells; five market inputs set its terms:
// volatility, skew, correlation, interest rates and dividends. This page shows those inputs, turns them into "which
// structure families have rich terms now, and is the backdrop safe for them", ranks underlyings by premium per unit of
// barrier risk, prices indicative terms with a back-test, and tracks the owner's live notes (browser only).
// Loaded after app.js; uses its helpers (makeCard, drawLines, S, state, ...). Data: data/structured.json (WP37).
// Generic structure names only; every number is indicative, before issuer margin, not a quote.
'use strict';
let SPD = null, SPH = null, spLoading = null, sphLoading = null;
const SP_LBL = 'Indicative, from public option prices and a simple model, before issuer margin; not a quote.';
const SPX_SRC_ALL = 'Cboe (delayed option prices and index histories); Yahoo Finance (prices, dividends); FRED (rates); calculated';
state.spMargin = 1.5;   // issuer margin, % a year (owner's default)
async function loadSP() {
  if (SPD) return SPD;
  if (!spLoading) spLoading = loadJSON('data/structured.json').then(d => {
    SPD = d;
    for (const [id, x] of Object.entries(d)) if (id.startsWith('SP_') && x && x.d) { S[id] = { id, ...x, t: x.d.map(v => v * DAY), v: x.v }; delete S[id].d; }
    return d;
  }).catch(() => { SPD = { under: {}, baskets: [], earnings: {}, fx: {}, _meta: {} }; return SPD; });
  return spLoading;
}
async function loadSPH() {
  if (SPH) return SPH;
  if (!sphLoading) sphLoading = loadJSON('data/structured_hist.json').then(d => {
    SPH = {}; for (const [id, x] of Object.entries(d)) SPH[id] = { t: x.d.map(v => v * DAY), v: x.v }; return SPH;
  }).catch(() => { SPH = {}; return SPH; });
  return sphLoading;
}
const spU = id => SPD && SPD.under && SPD.under[id];
const spPct = id => { if (!has(id)) return null; const r = pctRank(S[id], state.latest, 10); return r ? r.p : null; };
const spLast = id => has(id) ? asOf(S[id], state.latest) : null;
const ordF = p => p == null ? '–' : ordinal(Math.max(1, p));
const pc1 = v => v == null || isNaN(v) ? '–' : fmtNum(v, 1) + '%';
const pc2 = v => v == null || isNaN(v) ? '–' : fmtNum(v, 2) + '%';
function spMed(a) { const b = a.filter(x => x != null && isFinite(x)).sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : null; }
// interest rates for pricing (owner's choice: FRED; the ringgit and Singapore dollar have no FRED series)
function rateFor(ccy, years) {
  const L = id => { const a = spLast(id); return a ? a.v : null; };
  const curve = pts => { const p = pts.map(([t, id]) => [t, L(id)]).filter(x => x[1] != null); if (!p.length) return null;
    if (years <= p[0][0]) return p[0][1]; if (years >= p[p.length - 1][0]) return p[p.length - 1][1];
    let i = 1; while (p[i][0] < years) i++; const w = (years - p[i - 1][0]) / (p[i][0] - p[i - 1][0]); return p[i - 1][1] + w * (p[i][1] - p[i - 1][1]); };
  const two = (s, l) => curve([[0.25, s], [10, l]]);
  const map = {
    USD: [() => curve([[1 / 12, 'UST1M'], [0.25, 'UST3M'], [0.5, 'UST6M'], [1, 'UST1Y'], [2, 'UST2Y'], [3, 'UST3Y'], [5, 'UST5Y'], [10, 'UST10Y']]), 'FRED (Treasury curve)'],
    EUR: [() => two('EA_DFR_F', 'DE_10Y'), 'FRED (ECB deposit rate, Bund)'], AUD: [() => two('AU_IB3M_F', 'AU_LT_F'), 'FRED (OECD Australian rates)'],
    JPY: [() => two('JP_IB3M_F', 'JP_LT_F'), 'FRED (OECD Japanese rates)'], GBP: [() => two('UK_CALL', 'GB_LT_F'), 'UK overnight rate (OECD); FRED (UK 10Y)'],
    MYR: [() => curve([[1 / 12, 'MY_IB_1M'], [0.25, 'MY_IB_3M'], [0.5, 'MY_IB_6M'], [1, 'MY_FD12']]), 'Bank Negara (interbank rates, 12-month deposit rate; no FRED series)'],
    SGD: [() => curve([[0.25, 'SORA3M'], [1, 'SGS1Y'], [2, 'SGS2Y'], [10, 'SGS10Y']]), 'MAS (SORA, SGS yields; no FRED series)'],
    CNY: [() => two('CN_3M', 'CN_10Y'), 'OECD'], KRW: [() => two('KR_3M', 'KR_10Y'), 'OECD'], INR: [() => two('IN_3M', 'IN_10Y'), 'OECD'],
  };
  const m = map[ccy] || (ccy === 'HKD' ? map.USD : null);   // Hong Kong dollar: pegged, uses US rates
  let v = m ? m[0]() : null, src = m ? m[1] + (ccy === 'HKD' ? ' (HKD pegged to USD)' : '') : '';
  if (v == null) { v = map.USD[0]() ?? 4; src = 'US rates (no local rate on file)'; }
  return { r: v / 100, src };
}
const spCcyRate = ccy => ['MYR', 'SGD', 'USD', 'EUR', 'AUD', 'JPY', 'GBP', 'CNY', 'KRW', 'INR', 'HKD'].includes(ccy) ? ccy : 'USD';
function spVol(x, days, m) { const M = SPD._meta; return x && x.surf ? SPM.volAt(x.surf, M.tenors, M.mny, days, m) : null; }

// realised volatility of a daily series (FX pairs): latest 3-month value (%, a year) and its 10-year percentile
const fxRvCache = {};
function fxRv(id, days = 63) {
  if (!has(id)) return null; if (fxRvCache[id + days]) return fxRvCache[id + days];
  const s = S[id], r = []; for (let i = 1; i < s.v.length; i++) r.push(Math.log(s.v[i] / s.v[i - 1]));
  const vol = []; let a = 0, b = 0;
  for (let i = 0; i < r.length; i++) { a += r[i]; b += r[i] * r[i]; if (i >= days) { a -= r[i - days]; b -= r[i - days] * r[i - days]; }
    if (i >= days - 1) vol.push([s.t[i + 1], Math.sqrt(Math.max(b / days - (a / days) ** 2, 0) * 252) * 100]); }
  if (!vol.length) return null;
  const last = vol[vol.length - 1], w = vol.filter(x => x[0] >= addMonths(last[0], -120)).map(x => x[1]);
  return (fxRvCache[id + days] = { v: last[1], t: last[0], pct: w.filter(x => x <= last[1]).length / w.length * 100, series: vol });
}
// ---- the five inputs (and percentiles) behind the matrix
function spInputs() {
  const us = Object.entries(SPD.under).filter(([, x]) => x.kind === 'us' && x.src === 'chain');
  const ssVol = spMed(us.map(([, x]) => x.surf[1][SPD._meta.mny.indexOf(1)] * 100));
  const ssPct = spMed(['SP_VXAPL', 'SP_VXAZN', 'SP_VXGOG', 'SP_VXGS'].map(spPct));
  const ivrv = spMed(us.map(([, x]) => x.rv3m ? x.surf[1][SPD._meta.mny.indexOf(1)] * 100 / x.rv3m : null));
  const usAbove = us.length ? us.filter(([, x]) => x.above200).length / us.length * 100 : null;
  const s2 = has('UST10Y', 'UST2Y') ? combine(S.UST10Y, S.UST2Y, (a, b) => a - b, { label: '2s10s' }, 5 * DAY) : null;
  const cur = s2 && pctRank(s2, state.latest, 10);
  const effr = spLast('EFFR'), u2 = spLast('UST2Y'), gap = effr && u2 ? u2.v - effr.v : null;
  const chg = (id, m) => { const a = spLast(id), b = a && asOf(S[id], addMonths(a.t, -m)); return a && b ? a.v - b.v : null; };
  const brUS = TICK && typeof breadth === 'function' ? breadth('US') : null, brNow = brUS && brUS.t.length ? brUS.a200.filter(v => v != null).slice(-1)[0] : null;
  return { vix: spLast('VIX'), vixP: spPct('VIX'), vix1yP: spPct('SP_VIX1Y'), ssVol, ssPct, ivrv, corrP: spPct('SP_COR3M'), corr: spLast('SP_COR3M'),
    skewP: spPct('SP_SKEW'), skew: spLast('SP_SKEW'), dspxP: spPct('SP_DSPX'), rateP: spPct('UST2Y'), rate: u2, moveP: spPct('MOVE'), gvzP: spPct('SP_GVZ'),
    curveP: cur ? cur.p : null, curve: cur ? cur.v : null, fedGap: gap, hyP: spPct('HY_OAS'), igP: spPct('IG_OAS'), hy3m: chg('HY_OAS', 3),
    stress3m: chg('STRESS_COMPOSITE', 3), regime: spLast('REG_QUAD'), breadth: brNow, usAbove, real3m: chg('REAL10Y', 3),
    goldUp: (trendStats('GOLD') || {}).up, spxUp: (trendStats('SPX') || {}).up, vvixP: spPct('VVIX'), emP: spPct('SP_VXEEM'),
    fxP: spMed(['USDMYR', 'USDSGD', 'AUDUSD', 'EURUSD'].map(id => { const v = fxRv(id); return v ? v.pct : null; })), myrReer: spPct('REER_MYR') };
}
// ---- the structure matrix: terms (what the market pays) and backdrop (whether conditions suit holding it)
const RFT = (rich, thin) => rich ? 'Rich' : thin ? 'Thin' : 'Fair';
const SP_STRUCT = [
  { key: 'eln', name: 'ELN / FCN on a single share', go: ['Underlyings'], price: 'fcn',
    terms: I => [RFT(I.ssPct >= 60 && I.ivrv > 1.1, I.ssPct != null && I.ssPct <= 30), `single-stock vol ${ordF(I.ssPct)} pct; implied ÷ realised ${I.ivrv ? fmtNum(I.ivrv, 2) : '–'}`],
    back: I => I.usAbove == null ? ['Mixed', 'check each share'] : I.usAbove >= 50 ? ['Supportive', `${fmtNum(I.usAbove, 0)}% of US names above their 200-day`] : I.usAbove < 35 ? ['Hostile', `only ${fmtNum(I.usAbove, 0)}% of US names above their 200-day`] : ['Mixed', `${fmtNum(I.usAbove, 0)}% of US names above their 200-day`],
    fits: 'is happy to own the share at the strike and wants income meanwhile', risk: 'ends up holding the share after a fall below the strike', not: 'anyone who would not buy the share outright' },
  { key: 'idx', name: 'FCN / autocallable on an index', go: ['Pricer'], price: 'auto1',
    terms: I => [RFT(I.vixP >= 60 || I.skewP >= 70, I.vixP != null && I.vixP <= 30 && I.skewP <= 40), `index vol ${ordF(I.vixP)} pct; skew ${ordF(I.skewP)} pct (deep barriers ${I.skewP >= 70 ? 'well paid' : 'ordinary'})`],
    back: I => { const ok = [I.stress3m == null || I.stress3m <= 0, !I.regime || I.regime.v !== 4, I.breadth == null || I.breadth > 40]; const n = ok.filter(Boolean).length;
      return [n === 3 ? 'Supportive' : n === 2 ? 'Mixed' : 'Hostile', `stress ${I.stress3m != null && I.stress3m > 0 ? 'rising' : 'not rising'}; regime ${I.regime && I.regime.v === 4 ? 'Slowdown' : 'not Slowdown'}; US breadth ${I.breadth != null ? fmtNum(I.breadth, 0) + '%' : '–'}`]; },
    fits: 'expects the index to hold or drift and wants a steady coupon', risk: 'a sharp fall through the knock-in turns it into an index loss', not: 'a client who needs the money before maturity' },
  { key: 'wo', name: 'Worst-of autocallable (basket)', go: ['Underlyings'], price: 'auto3',
    terms: I => [RFT(I.corrP <= 30 && I.ssPct >= 60, I.corrP >= 60), `implied correlation ${ordF(I.corrP)} pct (low = higher coupons); single-stock vol ${ordF(I.ssPct)} pct`],
    back: I => I.dspxP >= 80 ? ['Hostile', `dispersion ${ordF(I.dspxP)} pct: rich but fragile, one name can break it`] : I.breadth != null && I.breadth > 50 ? ['Supportive', `dispersion ${ordF(I.dspxP)} pct; breadth ${fmtNum(I.breadth, 0)}%`] : ['Mixed', `dispersion ${ordF(I.dspxP)} pct; breadth ${I.breadth != null ? fmtNum(I.breadth, 0) + '%' : '–'}`],
    fits: 'is comfortable owning the weakest of the names', risk: 'only one name needs to fall for a loss; low correlation is why the coupon is high', not: 'a first structured product' },
  { key: 'cpn', name: 'Capital-protected participation note', go: ['Protection & rates'], price: 'pp',
    terms: I => [RFT(I.rateP >= 60 && (I.vix1yP == null || I.vix1yP <= 50), I.rateP != null && I.rateP <= 30), `USD 2Y ${I.rate ? fmtNum(I.rate.v, 2) + '%' : '–'} (${ordF(I.rateP)} pct); 1-year index vol ${ordF(I.vix1yP)} pct`],
    back: () => ['Supportive', 'the cost is giving up some upside, not capital (issuer credit risk aside)'],
    fits: 'wants market upside without risking capital at maturity', risk: 'issuer credit; money locked until maturity; upside below owning the index', not: 'a client who may need early access' },
  { key: 'shark', name: 'Sharkfin / capped participation', go: ['Pricer'], price: 'shark',
    terms: I => [RFT(I.rateP >= 60 && I.vixP >= 50, I.rateP != null && I.rateP <= 30), `rates ${ordF(I.rateP)} pct; index vol ${ordF(I.vixP)} pct (the cap is worth more when vol is high)`],
    back: I => I.spxUp && I.vixP < 70 ? ['Supportive', 'index in an uptrend, volatility not stretched'] : ['Mixed', 'suits a moderate rise, not a surge or a fall'],
    fits: 'expects a moderate rise and wants capital protected', risk: 'gains are capped; above the cap the return drops back', not: 'a client expecting a strong rally' },
  { key: 'dci', name: 'Dual currency investment (DCI)', go: ['FX & DCI'],
    terms: I => [RFT(I.fxP >= 60, I.fxP != null && I.fxP <= 30), `FX volatility ${ordF(I.fxP)} pct of 10 years (MYR, SGD, AUD, EUR pairs)`],
    back: I => I.myrReer != null && I.myrReer < 40 ? ['Supportive', `ringgit cheap (real rate ${ordF(I.myrReer)} pct): being converted into MYR is less painful`] : ['Mixed', `ringgit real rate ${ordF(I.myrReer)} pct; check the pair on FX & DCI`],
    fits: 'has a real use for the second currency', risk: 'converted at the strike after an adverse move', not: 'a client who needs a specific currency back' },
  { key: 'gold', name: 'Gold-linked ELN / DCI', go: ['FX & DCI'],
    terms: I => [RFT(I.gvzP >= 60, I.gvzP != null && I.gvzP <= 30), `gold volatility ${ordF(I.gvzP)} pct`],
    back: I => { const n = [I.goldUp, I.real3m != null && I.real3m <= 0].filter(Boolean).length; return [n === 2 ? 'Supportive' : n === 1 ? 'Mixed' : 'Hostile', `gold ${I.goldUp ? 'above' : 'below'} its trend; US real yield ${I.real3m != null && I.real3m > 0 ? 'rising' : 'not rising'}`]; },
    fits: 'is happy to buy gold lower or wants income on a gold view', risk: 'converted into gold (or cash) at the strike after a fall', not: 'a client who cannot hold gold' },
  { key: 'acc', name: 'Accumulator / decumulator', go: ['Pricer'], price: 'acc', warn: 'High risk: leveraged, open-ended commitment',
    terms: I => [RFT(I.ssPct >= 60, I.ssPct != null && I.ssPct <= 30), `single-stock vol ${ordF(I.ssPct)} pct (higher = bigger discount)`],
    back: I => I.spxUp && I.vvixP < 50 ? ['Mixed', 'steady uptrend and calm vol-of-vol; still high risk'] : ['Hostile', 'trend or volatility not steady enough'],
    fits: 'wants to build a position below the market and can afford double buying in a fall', risk: 'buys twice as much as the price falls; knocked out early in a rise', not: 'most private clients' },
  { key: 'ra', name: 'Range accrual (rates or FX)', go: ['Protection & rates'],
    terms: I => [RFT(I.moveP >= 60, I.moveP != null && I.moveP <= 30), `rates volatility (MOVE) ${ordF(I.moveP)} pct`],
    back: I => I.fedGap != null && Math.abs(I.fedGap) < 0.25 ? ['Supportive', 'Fed on hold (2Y close to the policy rate)'] : ['Mixed', `2Y ${I.fedGap != null ? (I.fedGap < 0 ? 'below' : 'above') : '–'} the policy rate: a move is priced`],
    fits: 'expects the reference to stay in a range', risk: 'earns nothing on days outside the range', not: 'a client expecting a big move either way' },
  { key: 'call', name: 'Callable fixed-rate / step-up note', go: ['Protection & rates'],
    terms: I => [RFT(I.rateP >= 60 && I.moveP >= 60, I.rateP != null && I.rateP <= 30), `rates ${ordF(I.rateP)} pct; rates vol ${ordF(I.moveP)} pct`],
    back: I => I.fedGap != null && I.fedGap < -0.25 ? ['Mixed', 'cuts are priced: likely to be called early'] : ['Supportive', 'high coupon locked in unless rates fall'],
    fits: 'wants a high fixed coupon and accepts being called when rates fall', risk: 'called when it suits the issuer; reinvestment at lower rates', not: 'a client who needs a fixed maturity' },
  { key: 'steep', name: 'Curve steepener note', go: ['Protection & rates'],
    terms: I => [RFT(I.curveP <= 30, I.curveP != null && I.curveP >= 70), `2s10s ${I.curve != null ? fmtNum(I.curve * 100, 0) + 'bp' : '–'} (${ordF(I.curveP)} pct; flat = cheap entry)`],
    back: I => I.fedGap != null && I.fedGap < -0.25 ? ['Supportive', 'Fed cuts priced: curves usually steepen'] : ['Mixed', 'no cuts priced yet'],
    fits: 'expects the gap between long and short rates to widen', risk: 'pays little if the curve stays flat', not: 'a client wanting a fixed income stream' },
  { key: 'cln', name: 'Credit-linked note', go: null,
    terms: I => [RFT(I.hyP >= 60 && I.igP >= 60, I.hyP != null && I.hyP <= 30), `HY spread ${ordF(I.hyP)} pct; IG spread ${ordF(I.igP)} pct`],
    back: I => I.hy3m != null && I.hy3m > 0.3 ? ['Hostile', 'spreads widening over 3 months'] : I.stress3m != null && I.stress3m > 10 ? ['Mixed', 'stress composite rising'] : ['Supportive', 'spreads not widening; stress calm'],
    fits: 'wants a higher yield for taking a named company’s credit risk', risk: 'a default or credit event at the reference company', not: 'a client who cannot judge credit risk' },
];
function spMatrix() { const I = spInputs(); return SP_STRUCT.map(s => { const [t, tw] = s.terms(I), [b, bw] = s.back(I); return { s, t, tw, b, bw }; }); }
const SP_TONE = { Rich: '--good', Fair: '--muted', Thin: '--warning', Supportive: '--good', Mixed: '--warning', Hostile: '--critical' };
const spDot = w => el('span', { class: 'qdot', style: `background:${tok(SP_TONE[w])}` });
function spGoPrice(preset) { state.spPreset = preset; goSub('sp', 'Pricer'); }
function renderSpMatrix(c) {
  const b = htmlBody(c); if (!SPD || !SPD.under) { b.append(el('div', { class: 'empty', text: 'Loading…' })); return; }
  const heads = ['Structure', 'Terms now', 'Backdrop', 'Fits a client who…', 'Main risk', ''];
  const tb = el('tbody'), csv = [['Structure', 'Terms', 'Why', 'Backdrop', 'Why', 'Fits', 'Main risk', 'Not for']];
  for (const { s, t, tw, b: bk, bw } of spMatrix()) {
    tb.append(el('tr', { class: 'row' }, el('td', { class: 'l' }, el('b', { text: s.name }), s.warn ? el('div', { class: 'small', style: `color:${tok('--critical')}`, text: s.warn }) : ''),
      el('td', { class: 'l', title: tw }, spDot(t), t, el('div', { class: 'muted small', text: tw })), el('td', { class: 'l', title: bw }, spDot(bk), bk, el('div', { class: 'muted small', text: bw })),
      el('td', { class: 'l small', text: s.fits, title: 'Not for: ' + s.not }), el('td', { class: 'l small', text: s.risk }),
      el('td', {}, s.price ? el('button', { type: 'button', class: 'ghost', text: 'Price →', onclick: () => spGoPrice(s.price) }) : s.go ? el('button', { type: 'button', class: 'ghost', text: 'Open →', onclick: () => goSub('sp', s.go[0]) }) : el('button', { type: 'button', class: 'ghost', text: 'Spreads →', onclick: () => goSub('fixed', 'Spreads') }))));
    csv.push([s.name, t, tw, bk, bw, s.fits, s.risk, s.not]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'sp-matrix' }, el('thead', {}, el('tr', {}, ...heads.map(h => el('th', { class: 'l', text: h })))), tb)));
  c.csv = csv;
  setNote(c, 'Rich terms always mean the market sees more risk: read Terms and Backdrop together; rich with a hostile backdrop is the classic trap. Terms = how much the option market pays now against its own 10-year history; Backdrop = whether trend, stress, breadth and policy suit holding it. Hover a client column for who it is not for. Structures to discuss, not recommendations. ' + SP_LBL);
  setSource(c, SPX_SRC_ALL + '; dashboard stress, regime and breadth');
}
function spReadLines() {
  const I = spInputs(), out = [];
  if (I.rateP >= 60 && (I.vixP == null || I.vixP <= 60)) out.push(`Capital-protected notes on indices get good terms: US 2-year yield ${I.rate ? fmtNum(I.rate.v, 2) + '%' : ''} (${ordF(I.rateP)} percentile) while index volatility is ordinary (VIX ${I.vix ? fmtNum(I.vix.v, 1) : '–'}).`);
  if (I.ssPct >= 60 || (I.ssVol && I.vix && I.ssVol > I.vix.v * 1.8)) {
    const neg = SIG && SIG.ideas ? SIG.ideas.filter(g => g.net > 0 && g.dir < 0).map(g => g.target_name) : [];
    out.push(`Single-stock and worst-of coupons look rich (median US share 3-month implied vol ${fmtNum(I.ssVol, 0)}% against ${I.vix ? fmtNum(I.vix.v, 0) : '–'}% for the index)${neg.length ? `, but the Signals page is cautious on ${neg.slice(0, 2).join(' and ')}` : ''}.`);
  }
  if (I.corrP != null && I.corrP <= 20) out.push(`Implied correlation is at its ${ordF(I.corrP)} percentile${I.dspxP >= 80 ? ` and dispersion at its ${ordF(I.dspxP)}` : ''}: worst-of baskets pay more because one name can break away; that is the risk being paid for.`);
  if (I.skewP >= 70) out.push(`Downside protection is expensive (skew ${ordF(I.skewP)} percentile), so deep barriers are relatively well paid.`);
  if (I.gvzP >= 70) out.push(`Gold volatility is high (${ordF(I.gvzP)} percentile): gold-linked ELNs and DCIs pay more than usual.`);
  if (I.vixP != null && I.vixP <= 25) out.push('Index volatility is low: coupons on index notes are thin; protection is cheap to buy.');
  return out.length ? out : ['No input is far from its normal range: terms are ordinary across structures.'];
}
function renderSpRead(c) {
  const b = htmlBody(c); if (!SPD || !SPD.under) { b.append(el('div', { class: 'empty', text: 'Loading…' })); return; }
  b.append(el('ul', { class: 'sp-read' }, ...spReadLines().map(t => el('li', { text: t }))));
  setNote(c, 'Rule-based sentences from the inputs on this page, refreshed with every data run. A starting point for a client conversation, not advice.');
  setSource(c, SPX_SRC_ALL);
}
function renderSpPutwrite(c) {
  if (!has('SP_PUT', 'SPX')) return setEmpty(c, 'Waiting for data.');
  const from = Math.max(state.from, S.SP_PUT.t[0]);
  drawLines(c, [{ name: 'Selling 1-month S&P 500 puts (Cboe PUT index)', data: rebase(S.SP_PUT, from, state.to) }, { name: 'S&P 500 (price)', data: rebase(S.SPX, from, state.to) }],
    { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0), hlines: [{ y: 100 }] });
  const st = s => { const p = pts(s, Date.UTC(2007, 0, 1), state.latest); if (p.length < 2) return null; const yrs = (p[p.length - 1][0] - p[0][0]) / (365.25 * DAY); let pk = -Infinity, dd = 0; for (const [, v] of p) { pk = Math.max(pk, v); dd = Math.min(dd, v / pk - 1); } return [(Math.pow(p[p.length - 1][1] / p[0][1], 1 / yrs) - 1) * 100, dd * 100]; };
  const a = st(S.SP_PUT), b = st(S.SPX);
  setNote(c, `The long-run record of the trade inside ELNs and FCNs: since 2007 selling puts returned ${a ? fmtNum(a[0], 1) : '–'}% a year with a worst fall of ${a ? fmtNum(-a[1], 0) : '–'}%, against ${b ? fmtNum(b[0], 1) : '–'}% (price only) and ${b ? fmtNum(-b[1], 0) : '–'}% for the index. The put seller gives up the big gains in exchange for income and smaller (not small) losses.`);
  setSource(c, 'Cboe (PUT index, fully collateralised; total return); Yahoo Finance (S&P 500, price only)');
}
const SP_INPUTS = [['VIX', 'Index volatility (VIX)', 'Higher = coupons on index notes are richer and capital-protected notes buy less upside.'],
  ['SP_VIX1Y', 'Index volatility, 1 year (VIX1Y)', 'The volatility a 1-year note is priced on.'], ['SP_COR3M', 'Implied correlation (COR3M)', 'Lower = worst-of baskets pay more, because one name is likelier to break away.'],
  ['SP_SKEW', 'Skew (Cboe SKEW)', 'Higher = deep out-of-the-money puts are expensive, so deep barriers are better paid.'], ['SP_DSPX', 'Dispersion (DSPX)', 'Higher = single names moving apart: rich but fragile for worst-of notes.'],
  ['SP_VXEEM', 'Emerging-market volatility (VXEEM)', 'Higher = Asian and EM underlyings pay more.'], ['SP_GVZ', 'Gold volatility (GVZ)', 'Higher = gold-linked structures pay more.'],
  ['MOVE', 'Rates volatility (MOVE)', 'Higher = range accruals and callable notes pay more.'], ['UST2Y', 'US 2-year yield', 'Higher = more budget for capital protection.']];
state.spInput = 'VIX';
function renderSpInputs(c) {
  const row = SP_INPUTS.find(x => x[0] === state.spInput) || SP_INPUTS[0], id = row[0]; if (!has(id)) return setEmpty(c, 'Waiting for data.');
  const r = pctRank(S[id], state.latest, 10), w = S[id].v.filter((_, i) => S[id].t[i] >= addMonths(state.latest, -120)).slice().sort((a, b) => a - b), med = w[Math.floor(w.length / 2)];
  drawLines(c, [{ name: row[1], data: pts(S[id], state.from, state.to) }], { fmt: v => fmtNum(v, 2), axisFmt: v => fmtNum(v, 0), hlines: [{ y: med, label: '10-year median' }] });
  setNote(c, `${row[1]} is at its ${r ? ordF(r.p) : '–'} percentile of 10 years. ${row[2]}`);
  setSource(c, id.startsWith('SP_') ? 'Cboe' : srcOf([id]));
}
function spTiles() {
  const box = $('#spKpis'); box.replaceChildren(); if (!SPD || !SPD.under) return;
  const I = spInputs(), tile = (l, v, d, f) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: l }), el('div', { class: 'k-value', text: v }), el('div', { class: 'k-delta', text: d }), el('div', { class: 'k-asof', text: f })));
  tile('Index volatility', I.vix ? fmtNum(I.vix.v, 1) : '–', `VIX · ${ordF(I.vixP)} pct of 10 years`, I.vix ? nice(I.vix.t) : '');
  tile('Single-stock volatility', I.ssVol ? fmtNum(I.ssVol, 0) + '%' : '–', `median US share, 3M · ${ordF(I.ssPct)} pct`, 'Cboe option prices');
  tile('Implied correlation', I.corr ? fmtNum(I.corr.v, 1) : '–', `COR3M · ${ordF(I.corrP)} pct (low = worst-of pays more)`, I.corr ? nice(I.corr.t) : '');
  tile('Skew', I.skew ? fmtNum(I.skew.v, 0) : '–', `Cboe SKEW · ${ordF(I.skewP)} pct`, I.skew ? nice(I.skew.t) : '');
  tile('USD 2Y yield', I.rate ? fmtNum(I.rate.v, 2) + '%' : '–', `${ordF(I.rateP)} pct (high = more protection budget)`, I.rate ? nice(I.rate.t) : '');
}
// ---- page wiring
SUBTABS.sp = [['What suits now', ['sp_matrix', 'sp_read', 'sp_putwrite', 'sp_inputs']]];
TAB_TITLES.sp = 'Structured products';
TILE_SETS.sp = { '*': ['Index volatility', 'Single-stock volatility', 'Implied correlation', 'Skew', 'USD 2Y yield'] };
function buildSP() {
  const g = $('#spGrid');
  makeCard(g, { key: 'sp_matrix', title: 'Which structures suit now', wide: true, range: false, render: renderSpMatrix });
  makeCard(g, { key: 'sp_read', title: 'Today’s read', range: false, render: renderSpRead });
  makeCard(g, { key: 'sp_putwrite', title: 'Selling puts vs owning the index', defaultRange: 'MAX', earliest: Date.UTC(2007, 0, 1), render: renderSpPutwrite });
  makeCard(g, { key: 'sp_inputs', title: 'The inputs behind the terms', wide: true, defaultRange: '10Y', seg: { key: 'spInput', select: true, label: 'Input', options: SP_INPUTS.map(x => [x[0], x[1]]) }, render: renderSpInputs });
  for (const k of ['sp_matrix', 'sp_read']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
  buildSPUnder();
}
function renderSP() {
  if (!SPD) { loadSP().then(() => { if (state.tab === 'sp') renderTab(); }); }
  spTiles(); renderPanel('sp');
}

// ------------------------------------------------------------------ WP39. Underlyings: screener, coupon grid, term structure, baskets
state.spView = 'index'; state.spSel = 'SPX'; state.spGrid = 'prem';
const SP_VIEWS = [['index', 'Indices & ETFs'], ['us', 'US shares'], ['sg', 'Singapore'], ['my', 'Malaysia'], ['hk', 'Hong Kong & Asia']];
const SP_TINY = id => { const x = spU(id); return x && x.kind === 'us' ? id : SP_SHORT(id).replace(/ (Manuf.*|Chinese Banking|Overseas Bank)$/, '').slice(0, 16); };
const SP_SHORT = id => { const x = spU(id); return x ? (x.kind === 'index' ? x.name : (x.name || id).replace(/,? (Inc\.?|Incorporated|Corporation|Corp\.?|Holdings?|Berhad|Bhd\.?|Limited|Ltd\.?|plc|Co\.?|Group)\b.*$/i, '').slice(0, 26)) : id; };
function spPutYield(x, m = 0.9, days = 91) {   // indicative put premium as % of strike, annualised; market bid where a liquid listed put exists
  if (!x || !x.surf) return null;
  if (m === 0.9 && days === 91 && x.put90 && x.put90.liquid && x.src === 'chain') return { y: x.put90.bid * 365 / x.put90.days, mkt: true };
  const r = rateFor(spCcyRate(x.ccy), days / 365).r, v = spVol(x, days, m);
  return { y: SPM.bs('P', 1, m, days / 365, r, (x.dy || 0) / 100, v) / m * 365 / days * 100, mkt: false };
}
function spRows(view) {
  const U = SPD.under, out = [];
  for (const [id, x] of Object.entries(U)) {
    const k = x.kind === 'asia' ? 'hk' : x.kind; if (k !== view) continue;
    const atm = x.surf ? x.surf[1][SPD._meta.mny.indexOf(1)] * 100 : null, v90 = x.surf ? x.surf[1][SPD._meta.mny.indexOf(0.9)] * 100 : null;
    const py = spPutYield(x), bar = x.bar || {}, b12 = bar.touch && bar.touch[12] ? bar.touch[12][SPD._meta.barriers.indexOf(70)] : null;
    const e6 = bar.end && bar.end[6] ? bar.end[6][0] : null, er = SPD.earnings && SPD.earnings[id];
    const erIn = er && (Date.parse(er.d) - Date.now()) / DAY <= 91 ? er : null;
    out.push({ id, x, atm, est: x.src !== 'chain', pct: x.iv_pct ?? x.rv_pct, pctRealised: x.iv_pct == null, ivrv: atm && x.rv3m ? atm - x.rv3m : null, skew: atm && v90 ? v90 - atm : null,
      py, dy: x.dy, up: x.above200, hi: x.from_hi, e6, b12, er: erIn, score: py && b12 != null ? py.y / Math.max(b12, 2) : null });
  }
  return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || (a.est - b.est));
}
function renderSpScreen(c) {
  const b = htmlBody(c); if (!SPD || !SPD.under) { b.append(el('div', { class: 'empty', text: 'Loading…' })); return; }
  const chips = el('div', { class: 'presets view-chips' }, ...SP_VIEWS.map(([k, l]) => el('button', { type: 'button', text: l, class: state.spView === k ? 'on' : '', onclick: () => { state.spView = k; capOpen.delete('sp_screen'); c.render(); } })));
  const rows = spRows(state.spView), heads = ['Underlying', '3M vol', 'Pct', 'I − R', 'Skew', '90% put/yr', 'Div', 'Trend', 'Off high', '6M <80%', '12M ≤70%', 'Earn.', 'Score'];
  const tb = el('tbody'), csv = [heads];
  const cell = (t, cls = '', title = '') => el('td', { class: 'num ' + cls, text: t, title });
  for (const r of rows) {
    const tr = el('tr', { class: 'row' + (r.id === state.spSel ? ' sel' : ''), style: 'cursor:pointer', title: `Show ${SP_SHORT(r.id)} in the coupon grid`, onclick: () => { state.spSel = r.id; ['sp_screen', 'sp_grid', 'sp_term'].forEach(k => cards[k].render()); } },
      el('td', { class: 'l nm', text: SP_SHORT(r.id) + (r.x.proxy && r.x.kind === 'index' && !SP_SHORT(r.id).includes(r.x.proxy) ? ` (${r.x.proxy})` : ''), title: r.id + (r.x.proxy ? ` · options on ${r.x.proxy}` : '') }),
      cell(r.atm ? fmtNum(r.atm, 0) + '%' + (r.est ? ' est.' : '') : '–', r.est ? 'muted' : ''), cell(r.pct != null ? ordF(r.pct) + (r.pctRealised ? '*' : '') : '–', '', r.pctRealised ? 'percentile of realised volatility (implied history builds from Nov 2026)' : 'percentile of 3-month implied volatility'),
      cell(r.ivrv != null ? sign(r.ivrv) + fmtNum(Math.abs(r.ivrv), 0) : '–'), cell(r.skew != null ? sign(r.skew) + fmtNum(Math.abs(r.skew), 1) : '–'),
      cell(r.py ? pc1(r.py.y) + (r.py.mkt ? '' : ' m') : '–', r.py && r.py.mkt ? '' : 'muted', r.py ? (r.py.mkt ? 'listed put, bid, about 3 months' : 'model price from the surface') : ''),
      cell(r.dy ? pc1(r.dy) : '–'), cell(r.up == null ? '–' : r.up ? '▲' : '▼', r.up ? 'up' : 'dn'), cell(r.hi != null ? pctF1(r.hi) : '–'),
      cell(r.e6 != null ? fmtNum(r.e6, 0) + '%' : '–'), cell(r.b12 != null ? fmtNum(r.b12, 0) + '%' : '–'),
      cell(r.er ? dShort(Date.parse(r.er.d)) : '', r.er ? 'dn' : '', r.er ? `earnings ${r.er.d} ${r.er.when}${r.er.move ? '; options imply ±' + fmtNum(r.er.move, 1) + '%' : ''}` : ''),
      cell(r.score != null ? fmtNum(r.score, 1) : '–', 'strong'));
    tb.append(tr);
    csv.push([r.id, r.atm, r.pct, r.ivrv, r.skew, r.py && r.py.y, r.dy, r.up, r.hi, r.e6, r.b12, r.er ? r.er.d : '', r.score]);
  }
  b.append(chips, el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table sp-screen' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i ? '' : 'l' })))), tb)));
  capRows(tb, 'sp_screen', 14);
  c.csv = csv;
  setNote(c, `Ranked by premium per unit of risk (Score): the 3-month put 10% below spot as a yield a year (90% put/yr), divided by how often the price has touched 70% of a start level within 12 months (12M ≤70%). Pct = volatility percentile of 10 years; I − R = implied minus realised vol, points; Skew = 90%-strike vol minus at-the-money; 6M <80% = share of 6-month periods ending below 80%; Earn. = US earnings date inside 3 months (history since ${state.spView === 'index' ? '2006' : 'listing or 2006'}). est. = no listed options: implied vol estimated as realised × ${fmtNum(SPD._meta.ratio || 1.2, 2)} (the median ratio of names that have options), with the index skew shape. m = model price. * = realised-volatility percentile until a year of implied history has built up. Weekly closes understate daily barrier touches slightly. Click a row for its coupon grid. ` + SP_LBL);
  setSource(c, SPX_SRC_ALL + '; Nasdaq (earnings dates)');
}
function renderSpGrid(c) {
  const b = htmlBody(c), x = spU(state.spSel); if (!x) { b.append(el('div', { class: 'empty', text: 'Pick a row in the screener.' })); return; }
  c.titleEl.textContent = `Coupon grid: ${SP_SHORT(state.spSel)}`;
  const lv = [100, 90, 80, 75, 70, 60], tn = [3, 6, 12], M = SPD._meta, prem = state.spGrid === 'prem';
  const tb = el('tbody');
  for (const l of lv) {
    const tds = tn.map(t => {
      if (prem) { const p = spPutYield(x, l / 100, Math.round(t * 30.4)); return p ? pc1(p.y) : '–'; }
      const bar = x.bar || {}; if (l === 100) { const e = bar.end && bar.end[t]; return e ? fmtNum(e[2], 0) + '% end below' : '–'; }
      const i = M.barriers.indexOf(l), tt = bar.touch && bar.touch[t]; return tt && i >= 0 ? fmtNum(tt[i], 0) + '%' : '–';
    });
    tb.append(el('tr', { class: 'row' }, el('td', { class: 'l', text: `${l}% of spot` }), ...tds.map(t => el('td', { class: 'num', text: t }))));
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, el('th', { class: 'l', text: 'Strike / barrier' }), ...tn.map(t => el('th', { text: t + ' months' })))), tb)));
  const rr = rateFor(spCcyRate(x.ccy), 0.5);
  setNote(c, prem ? `Put premium at each strike as a yield a year: roughly what an ELN struck there pays above cash before the issuer's margin. ${x.src === 'chain' ? 'From listed option prices' : 'Estimated from realised volatility (no listed options)'}; rates: ${rr.src}; dividend yield ${pc1(x.dy || 0)}. Switch to Breach history to see how often the price got there.`
    : `How often, since ${(x.bar || {}).from || '–'}, the weekly close fell below each level at some point within the tenor (top row: share of periods ending below the start). Read it against the premium: a high yield with a high breach rate is not cheap.`);
  setSource(c, prem ? 'Cboe option prices; Yahoo Finance; model' : 'Yahoo Finance weekly closes; calculated');
}
function renderSpTerm(c) {
  const b = htmlBody(c), x = spU(state.spSel), ix = spU(x && x.kind === 'index' ? 'SPX' : (x && ['my', 'sg', 'hk', 'asia'].includes(x.kind) ? ({ my: 'KLCI', sg: 'STI', hk: 'HSI', asia: 'HSI' })[x.kind] : 'SPX'));
  if (!x || !x.surf) { b.append(el('div', { class: 'empty', text: 'No volatility data.' })); return; }
  const M = SPD._meta, i1 = M.mny.indexOf(1), i9 = M.mny.indexOf(0.9), i8 = M.mny.indexOf(0.8), lab = ['1 month', '3 months', '6 months', '1 year'];
  const tb = el('tbody');
  M.tenors.forEach((t, ti) => tb.append(el('tr', { class: 'row' }, el('td', { class: 'l', text: lab[ti] }), el('td', { class: 'num', text: pc1(x.surf[ti][i1] * 100) }),
    el('td', { class: 'num', text: pc1(x.surf[ti][i9] * 100) }), el('td', { class: 'num', text: pc1(x.surf[ti][i8] * 100) }),
    el('td', { class: 'num', text: '+' + fmtNum((x.surf[ti][i8] - x.surf[ti][i1]) * 100, 1) }), el('td', { class: 'num muted', text: ix && ix.surf ? pc1(ix.surf[ti][i1] * 100) : '–' }))));
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, ...['Tenor', 'ATM', '90%', '80%', 'Skew', ix ? 'Index ATM' : ''].map((h, i) => el('th', { text: h, class: i ? '' : 'l' })))), tb)));
  setNote(c, `Implied volatility by tenor and strike for ${SP_SHORT(state.spSel)}${x.src === 'chain' ? '' : ' (estimated: no listed options)'}. Steeper skew = protection below the market costs more, so barrier notes pay more for deep barriers. Realised volatility over 3 months: ${pc1(x.rv3m)}; over a year: ${pc1(x.rv1y)}.`);
  setSource(c, x.src === 'chain' ? `Cboe delayed option prices (${x.asof || ''})` : 'Estimated from Yahoo Finance prices');
}
function renderSpBaskets(c) {
  const b = htmlBody(c); if (!SPD || !SPD.baskets) { b.append(el('div', { class: 'empty', text: 'Loading…' })); return; }
  const heads = ['Basket', 'Members', 'Corr.', 'Worst ≤60%', 'Worst ≤70%', 'Best single ≤70%', '× more', 'Weakest'];
  const tb = el('tbody'), csv = [heads];
  for (const k of SPD.baskets) {
    const ratio = k.best70 ? k.t70 / k.best70 : null;
    tb.append(el('tr', { class: 'row' }, el('td', { class: 'l', text: k.name }), el('td', { class: 'l small', style: 'text-align:left', text: k.mem.map(SP_TINY).join(', '), title: k.mem.map(SP_SHORT).join(', ') }),
      el('td', { class: 'num', text: fmtNum(k.corr, 2) }), el('td', { class: 'num', text: fmtNum(k.t60, 0) + '%' }), el('td', { class: 'num', text: fmtNum(k.t70, 0) + '%' }),
      el('td', { class: 'num muted', text: fmtNum(k.best70, 0) + '%' }), el('td', { class: 'num strong', text: ratio ? fmtNum(ratio, 1) + '×' : '–' }), el('td', { class: 'l small', style: 'text-align:left', text: SP_TINY(k.weak) })));
    csv.push([k.name, k.mem.join(' '), k.corr, k.t60, k.t70, k.best70, ratio, k.weak]);
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf asset-table' }, el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i < 2 ? 'l' : '' })))), tb)));
  c.csv = csv;
  setNote(c, 'Lower correlation raises a worst-of coupon because it raises the odds that one member falls: these are the odds. Corr. = average pairwise correlation of weekly returns over a year. Share of past 12-month periods (weekly closes, common history) in which the weakest member touched 60% or 70% of its start, against the safest single member alone. Weakest now = furthest from its 52-week high.');
  setSource(c, 'Yahoo Finance weekly closes; calculated');
}
// region pages: one line in the "Signals for this market" strip
const SP_PAGE_IDX = { us: 'SPX', europe: 'SX5E', japan: 'NKY', australia: 'AS51', my: 'KLCI', sg: 'STI', cn: 'HSI', kr: 'KOSPI', tw: 'TWSE', in: 'NIFTY' };
function spStripLines() {
  if (!SPD || !SPD.under) return;
  for (const [t, id] of Object.entries(SP_PAGE_IDX)) {
    const ul = document.querySelector(`#sig_${t} ul`), x = spU(id); if (!ul || !x || ul.querySelector('.sp-line')) continue;
    const py = spPutYield(x), pct = x.iv_pct ?? x.rv_pct;
    ul.append(el('li', { class: 'sp-line' }, el('span', { class: 'qdot', style: `background:${tok('--muted')}` }),
      el('a', { href: '#', text: `Structures on ${x.name}`, onclick: e => { e.preventDefault(); state.spSel = id; state.spView = 'index'; goSub('sp', 'Underlyings'); } }),
      el('span', { class: 'muted', text: ` · 3-month vol ${x.surf ? fmtNum(x.surf[1][SPD._meta.mny.indexOf(1)] * 100, 0) + '%' : '–'}${x.src === 'chain' ? '' : ' (est.)'}, ${ordF(pct)} pct; a 90% put pays about ${py ? pc1(py.y) : '–'} a year` })));
  }
}
SUBTABS.sp.push(['Underlyings', ['sp_screen', 'sp_grid', 'sp_term', 'sp_baskets']]);
TILE_SETS.sp.Underlyings = ['Single-stock volatility', 'Index volatility', 'Implied correlation', 'Skew', 'USD 2Y yield'];
function buildSPUnder() {
  const g = $('#spGrid');
  makeCard(g, { key: 'sp_screen', title: 'Underlyings: premium per unit of risk', wide: true, range: false, render: renderSpScreen });
  makeCard(g, { key: 'sp_grid', title: 'Coupon grid', range: false, seg: { key: 'spGrid', options: [['prem', 'Premium'], ['breach', 'Breach history']] }, render: renderSpGrid });
  makeCard(g, { key: 'sp_term', title: 'Volatility by tenor and strike', range: false, render: renderSpTerm });
  makeCard(g, { key: 'sp_baskets', title: 'Worst-of baskets: the odds', wide: true, range: false, render: renderSpBaskets });
  for (const k of ['sp_screen', 'sp_grid', 'sp_term', 'sp_baskets']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
}
