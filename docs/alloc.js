// ------------------------------------------------------------------ ALLOCATION → EVIDENCE BOARD (Design plan 3, Step 3; owner's approval, 25 Nov 2026)
// 13 assets × 6 pillars. Each cell is one mark: ▲ supportive, ● neutral, ▼ against, – no measure. The tally counts the
// marks; there is no score, no weight and no rank. Every mark is worked out from a card that is already on the dashboard,
// quotes its numbers and links to that card; the rules are printed under the board ("How the board works").
// Wording is fixed: evidence, for, against, tally. Never buy, sell, overweight or recommend: like the signals, the board
// is a research prompt, not a recommendation. One registry (AL_ROWS) drives the table, the detail card, the lead and the tiles.
'use strict';

const AL_PILLARS = [['cycle', 'Cycle'], ['val', 'Valuation'], ['trend', 'Trend'], ['sent', 'Sentiment'], ['pol', 'Policy & liquidity'], ['sig', 'Signals']];
// k · group · name · short (detail card title) · id: the price (or yield, yld) whose trend is read · reg: its row in "What worked
// in each regime" · lead: [local leading index, how, sign] where the regime table has no row · val: valuation rule ·
// sent: 'us' (Fear & Greed, AAII) or a CFTC market code · pol: policy rule · sig: signal-engine targets (a relative rule
// R_X_Y counts for X) · na: why a pillar has no measure
const AL_ROWS = [
  { k: 'us', g: 'Equities', n: 'US', short: 'US equities', id: 'SPX', reg: 'SPX', val: 'ecy', sent: 'us', pol: 'Fed', sig: ['SPX', 'LH_SPX', 'NDX'] },
  { k: 'eu', g: 'Equities', n: 'Europe', short: 'European equities', id: 'SX5E', reg: 'SX5E', val: 'stretch', pol: 'ECB', sig: ['SX5E', 'DAX', 'CAC', 'FTSEMIB', 'IBEX'] },
  { k: 'jp', g: 'Equities', n: 'Japan', short: 'Japanese equities', id: 'NKY', reg: 'NKY', val: 'stretch', pol: 'BoJ', sig: ['NKY'] },
  { k: 'cn', g: 'Equities', n: 'China', short: 'Chinese equities', id: 'CSI300', lead: ['CLI_CHN', 'chg6', 1], val: 'stretch', sig: ['CSI300', 'HSI'],
    na: { pol: 'The dashboard has no market gauge of what the PBoC is expected to do.' } },
  { k: 'axj', g: 'Equities', n: 'Asia ex-Japan', short: 'Asia ex-Japan equities', id: 'AAXJ', reg: 'AAXJ', val: 'stretch', sig: ['AAXJ'],
    na: { pol: 'No single central bank sets rates across Asia ex-Japan.' } },
  { k: 'my', g: 'Equities', n: 'Malaysia', short: 'Malaysian equities', id: 'KLCI', lead: ['MY_LEADING', 'pct6', 1], val: 'stretch', pol: 'BNM', sig: ['KLCI'] },
  { k: 'sg', g: 'Equities', n: 'Singapore', short: 'Singapore equities', id: 'STI', reg: 'STI', val: 'stretch', sig: ['STI'],
    na: { pol: 'MAS steers the currency, not a policy rate, so there is no rate gauge to read.' } },
  { k: 'ust', g: 'Bonds', n: 'US Treasuries (duration)', short: 'US Treasuries', id: 'IEF', reg: 'IEF', val: 'ust', sent: 'TY', pol: 'Fed', sig: ['UST10Y', 'IEF', 'TLT'] },
  { k: 'hy', g: 'Bonds', n: 'US high yield', short: 'US high yield', id: 'HYG', reg: 'HYG', val: 'hy', pol: 'Fed', sig: ['HYG', 'HY_OAS'] },
  { k: 'mgs', g: 'Bonds', n: 'Malaysian government bonds', short: 'Malaysian govt bonds', id: 'MY_MGS_10Y', yld: true, lead: ['MY_LEADING', 'pct6', -1], val: 'mgs', pol: 'BNM', sig: ['MY_MGS_10Y'] },
  { k: 'gold', g: 'Other', n: 'Gold', short: 'Gold', id: 'GOLD', reg: 'GOLD', val: 'gold', sent: 'GC', pol: 'real', sig: ['GOLD'] },
  { k: 'usd', g: 'Other', n: 'US dollar vs ringgit', short: 'US dollar vs ringgit', id: 'USDMYR', lead: ['MY_LEADING', 'pct6', -1], val: 'reer', sent: 'DX', pol: 'gap', sig: ['USDMYR'] },
  { k: 'cash', g: 'Other', n: 'Ringgit cash (12M deposits)', short: 'Ringgit cash', id: null, val: 'cash', pol: 'BNM-cash', sig: [],
    na: { cycle: 'The cycle has no single reading for cash.', trend: 'A deposit has no price trend.', sig: 'The signal engine has no rule for cash.' } },
];
// printed under the board; change a rule here and in the functions below together
const AL_RULES = [
  ['Cycle', 'In today’s confirmed regime the asset’s past return (matched to the regime known two months earlier) beat its all-month return and it rose in at least 55% of months',
    'Its past return in this regime was below zero, or it rose in under 45% of months', 'What worked in each regime; where that table has no row, the local leading index: 6-month change above zero and rising = ▲, below zero and falling = ▼ (for MGS and the dollar against the ringgit the sign is turned)'],
  ['Valuation', 'Cheapest fifth of its own history', 'Dearest fifth', 'Valuation scorecard and price vs 10-year trend: excess CAPE yield (US); price vs trend (other equities); real yield and term premium (Treasuries); Baa spread (high yield); MGS 10Y minus CPI; real gold price; ringgit real effective rate (a cheap ringgit counts against the dollar); cash: real deposit rate above zero = ● at best'],
  ['Trend', 'Above its 200-day average and 12-1 month momentum positive', 'Below and negative', 'Trend and momentum; for MGS the yield is read with the sign turned (a falling yield is an uptrend for bonds)'],
  ['Sentiment', 'Washed out: Fear & Greed 25 or less, or AAII bulls − bears in its lowest tenth (US equities); CFTC speculators’ net position in its lowest tenth of 3 years (Treasuries, gold, dollar)', 'Crowded: the mirror image', 'Sentiment and Positioning (CFTC); other markets show –'],
  ['Policy & liquidity', 'The asset’s central bank is priced to cut; gold: US real yield down 15bp or more over 3 months; dollar vs ringgit: US 3Y − MGS 3Y wider by 15bp or more; cash: BNM priced to hike', 'The mirror image', 'Central banks (policy monitor, Fed futures); Gold; Malaysia rate gap'],
  ['Signals', 'A rule with a tested edge is switched on in the asset’s favour', 'One is switched on against it (both = ●)', 'Signals: ideas to investigate'],
];
const AL_MARK = { u: ['▲', 'up', 'supportive'], m: ['●', 'mid', 'neutral'], d: ['▼', 'dn', 'against'], n: ['–', 'na', 'no measure'] };
const alNA = txt => ({ m: 'n', txt: txt || 'No measure for this asset on the dashboard.', go: null });
const alDear = p => p >= 50 ? `dearer than ${fmtNum(p, 0)}% of` : `cheaper than ${fmtNum(100 - p, 0)}% of`;
const alCheap = p => Math.round(p) <= 20 ? 'u' : Math.round(p) >= 80 ? 'd' : 'm';   // valuation percentiles are oriented so that high = expensive
const alFifth = p => Math.round(p) <= 20 ? 'the cheapest fifth' : Math.round(p) >= 80 ? 'the dearest fifth' : 'between the cheapest and the dearest fifth';
const alFlip = m => ({ u: 'd', d: 'u' })[m] || m;
state.alSel = 'us';

// ---- the six pillars: each returns { m, txt, go: [tab, sub-tab, card key, before?] }
function alRegStat(id) {   // the "What worked in each regime" calculation for one asset, investable (2-month lag), all its months
  if (!has('REG_QUAD', id)) return null;
  const q = S.REG_QUAD, qMap = new Map(q.t.map((t, i) => [t, q.v[i]])), cur = asOf(q, state.latest);
  const me = monthEnds(S[id]), keys = [...me.keys()].sort((a, b) => a - b), all = [], inR = [];
  for (let i = 1; i < keys.length; i++) {
    const rq = qMap.get(addMonths(keys[i], -2)); if (!rq) continue;
    const r = me.get(keys[i]) / me.get(keys[i - 1]) - 1; all.push(r); if (rq === cur.v) inR.push(r);
  }
  if (inR.length < 12) return null;
  const ann = xs => xs.reduce((a, b) => a + b, 0) / xs.length * 1200;
  return { q: cur.v, t: cur.t, ann: ann(inR), all: ann(all), hit: inR.filter(x => x > 0).length / inR.length * 100, n: inR.length };
}
function alCycle(r) {
  if (r.reg) {
    const st = alRegStat(r.reg); if (!st) return alNA('Fewer than 12 months of this asset in today’s regime.');
    const q = QUADS[st.q].name, m = st.ann > st.all && st.hit >= 55 ? 'u' : st.ann < 0 || st.hit < 45 ? 'd' : 'm';
    return { m, go: ['regime', 'Regime now', 'regtable', () => { state.regSpan = 'etf'; state.regLag = 'lag';   // the same span and lag as the board
        const t = cards.regtable; if (t) t.root.querySelectorAll('.card-tools > .seg button').forEach(b => b.classList.toggle('on', b.textContent === 'Since 2005')); }],
      txt: `Regime is ${q} (${monthLab(st.t)}). In past ${q} months ${S[r.reg].label} returned ${pctF1(st.ann)} a year, against ${pctF1(st.all)} over all months, and rose in ${fmtNum(st.hit, 0)}% of ${st.n} months.` };
  }
  if (!r.lead) return alNA(r.na && r.na.cycle);
  const [id, how, sg] = r.lead; if (!has(id)) return alNA();
  const s = S[id], a = asOf(s, state.latest);
  const ch = t => { const x = asOf(s, t), y = x && asOf(s, addMonths(x.t, -6)); return x && y ? (how === 'pct6' ? (x.v / y.v - 1) * 100 : x.v - y.v) : null; };
  const now = ch(a.t), prev = ch(addMonths(a.t, -1)); if (now == null || prev == null) return alNA();
  const m0 = now > 0 && now > prev ? 'u' : now < 0 && now < prev ? 'd' : 'm', unit = how === 'pct6' ? '%' : ' points';
  const name = id === 'MY_LEADING' ? 'Malaysia’s leading index (DOSM)' : `${s.label} (OECD)`;
  return { m: sg < 0 ? alFlip(m0) : m0, go: id === 'MY_LEADING' ? ['my', 'Economy', 'mylead'] : ['regime', 'Indicators', 'cli'],
    txt: `${name}: ${sign(now)}${fmtNum(Math.abs(now), 2)}${unit} over 6 months to ${monthLab(a.t)}, ${now > prev ? 'up' : 'down'} from ${sign(prev)}${fmtNum(Math.abs(prev), 2)}${unit} a month earlier.`
      + (sg < 0 ? ` A strengthening Malaysian cycle counts against ${r.k === 'usd' ? 'the dollar' : 'bonds'}, a weakening one for ${r.k === 'usd' ? 'it' : 'them'}.` : '') };
}
function alVal(r, V) {
  const go = ['valuation', 'Scorecard', 'val_table'];
  const row = name => { const x = V(name); return x && x.p != null ? x : null; };
  switch (r.val) {
    case 'ecy': { const e = row('Excess CAPE yield (vs real bonds)'), c = row('CAPE (Shiller P/E10)'); if (!e) return alNA();
      return { m: alCheap(e.p), go, txt: `Excess CAPE yield ${e.valTxt}, ${alDear(e.p)} months since 1881: ${alFifth(e.p)}` + (c ? `. CAPE ${c.valTxt}, ${alDear(c.p)} its history.` : '.') + ' Valuation is a slow force, not a timing tool.' }; }
    case 'stretch': { const x = stretch(r.id); if (!x) return alNA('Less than 10 years of weekly prices.');
      return { m: alCheap(x.p), go: ['valuation', 'Bonds, FX & global', 'val_stretch'],
        txt: `${S[r.id].label} is ${fmtNum(Math.abs(x.pct), 1)}% ${x.pct >= 0 ? 'above' : 'below'} its 10-year trend (${zf(x.z)}σ), ${alDear(x.p)} the past 10 years: ${alFifth(x.p)}.` }; }
    case 'ust': { const a = row('UST 10Y real yield (TIPS)'), b = row('10Y term premium (ACM)'); if (!a && !b) return alNA();
      const p = [a, b].filter(Boolean).reduce((s, x, i, l) => s + x.p / l.length, 0);
      return { m: alCheap(p), go, txt: [a && `10Y real yield ${a.valTxt}, ${alDear(a.p)} its history ${a.how.split(';')[0]}`, b && `term premium ${b.valTxt}, ${alDear(b.p)} its history ${b.how.split(';')[0]}`].filter(Boolean).join('; ')
        + `. Together: ${alFifth(p)}.` }; }
    case 'hy': { const x = row('Baa − 10Y spread'); if (!x) return alNA();
      return { m: alCheap(x.p), go, txt: `Baa − 10Y spread ${x.valTxt}, ${alDear(x.p)} its history since 1990: ${alFifth(x.p)} (a tight spread is dear). FRED keeps only 3 years of the high-yield spread itself, so the longer Baa spread stands in.` }; }
    case 'mgs': { const x = row('MGS 10Y real yield (minus CPI)'); if (!x) return alNA();
      return { m: alCheap(x.p), go, txt: `MGS 10Y minus Malaysian CPI: ${x.valTxt} real, ${alDear(x.p)} its history since 2019 (a high real yield is cheap): ${alFifth(x.p)}.` }; }
    case 'gold': { const x = row('Real gold price (gold / US CPI)'); if (!x) return alNA();
      return { m: alCheap(x.p), go, txt: `Gold deflated by US CPI is ${alDear(x.p)} its history since 2005: ${alFifth(x.p)}.` }; }
    case 'reer': { const nm = has('REER_MYR') ? S.REER_MYR.label.replace(' REER', '') : '', x = nm ? row(nm) : null; if (!x) return alNA();
      const m = alFlip(alCheap(x.p));   // a dear ringgit counts for the dollar, a cheap one against
      return { m, go, txt: `Ringgit real effective rate ${x.valTxt}, ${x.p >= 50 ? 'stronger' : 'weaker'} than ${fmtNum(x.p >= 50 ? x.p : 100 - x.p, 0)}% of its history ${x.how.split(';')[0].replace('percentile ', '')}. `
        + (m === 'd' ? 'A cheap ringgit counts against the dollar.' : m === 'u' ? 'A dear ringgit counts for the dollar.' : 'The ringgit is neither cheap nor dear.') }; }
    case 'cash': { if (!has('MY_FD12', 'MY_CPI_YOY')) return alNA();
      const f = asOf(S.MY_FD12, state.latest), c = asOf(S.MY_CPI_YOY, state.latest), real = f.v - c.v;
      return { m: real > 0 ? 'm' : 'd', go: ['my', 'Rates & bonds', 'myrates'],
        txt: `12-month fixed deposits ${fmtNum(f.v, 2)}% (${monthLab(f.t)}) minus CPI ${fmtNum(c.v, 1)}% (${monthLab(c.t)}) = ${sign(real)}${fmtNum(Math.abs(real), 2)}% real. ${real > 0 ? 'A positive real return is neutral at best.' : 'Cash is losing to inflation.'}` }; }
  }
  return alNA(r.na && r.na.val);
}
function alTrend(r) {
  if (!r.id) return alNA(r.na && r.na.trend);
  const t = trendStats(r.id); if (!t || t.mom == null) return alNA('Not enough daily history.');
  const s = r.yld ? -1 : 1, above = t.vs200 * s > 0, mom = t.mom * s > 0, m = above && mom ? 'u' : !above && !mom ? 'd' : 'm';
  const set = Object.keys(TREND_SETS).find(k => TREND_SETS[k].includes(r.id));
  const go = r.yld ? ['my', 'Rates & bonds', 'my_mgs'] : ['markets', 'Trend', 'tr_table', () => { if (set) state.trSet = set; }];
  if (r.yld) {
    const S0 = S[r.id], v = k => (asOf(S0, addMonths(t.t, -k)) || {}).v, m200 = t.last / (1 + t.vs200 / 100), d12 = v(1) != null && v(12) != null ? (v(1) - v(12)) * 100 : null;
    return { m, go, txt: `${S0.label} ${fmtNum(t.last, 2)}%, ${bp((t.last - m200) * 100)} against its 200-day average` + (d12 != null ? `, ${bp(d12)} over 12-1 months` : '') + '. For bonds a falling yield is the uptrend.' };
  }
  return { m, go, txt: `${S[r.id].label} is ${fmtNum(Math.abs(t.vs200), 1)}% ${t.vs200 >= 0 ? 'above' : 'below'} its 200-day average; 12-1 month momentum ${pctF1(t.mom)}${t.up ? '; 50-day above 200-day' : '; 50-day below 200-day'}.` };
}
function alSent(r) {
  if (r.sent === 'us') {
    const fg = has('FG') ? asOf(S.FG, state.latest) : null, sp = typeof aaiiSpread === 'function' ? aaiiSpread() : null, ap = sp ? pctile(sp, state.latest) : null;
    if (!fg && !ap) return alNA();
    const wash = (fg && fg.v <= 25) || (ap && ap.p <= 10), crowd = (fg && fg.v >= 75) || (ap && ap.p >= 90), m = wash && !crowd ? 'u' : crowd && !wash ? 'd' : 'm';
    return { m, go: ['posvol', 'Sentiment', 'sent_fg'],
      txt: [fg && `CNN Fear & Greed ${fmtNum(fg.v, 0)}, ${fgBand(fg.v).toLowerCase()} (${dShort(fg.t)})`, ap && `AAII bulls − bears ${sign(ap.v)}${fmtNum(Math.abs(ap.v), 1)} pts, ${ordinal(Math.max(1, ap.p))} percentile of its ${ap.n} weeks on file`].filter(Boolean).join('; ')
        + (m === 'u' ? '. Washed out: that has tended to come before gains.' : m === 'd' ? '. Crowded optimism: that has tended to come before weaker returns.' : '. Neither washed out nor crowded.') };
  }
  const mk = r.sent && typeof POS !== 'undefined' && POS && POS.markets[r.sent]; if (!mk) return alNA(r.na && r.na.sent || 'No sentiment or positioning gauge for this market on the dashboard.');
  const st = posStats(mk); if (!st) return alNA();
  const m = Math.round(st.pct) <= 10 ? 'u' : Math.round(st.pct) >= 90 ? 'd' : 'm';
  return { m, go: ['posvol', 'Positioning (CFTC)', 'pos_table'],
    txt: `CFTC ${mk.label}: ${mk.spec_label.toLowerCase()} net ${sign(st.v)}${fmtNum(Math.abs(st.v), 1)}% of open interest (${dShort(st.t)}), ${ordinal(Math.max(1, st.pct))} percentile of 3 years.`
      + (m === 'u' ? ' Washed out.' : m === 'd' ? ' Crowded.' : ' Neither washed out nor crowded.') };
}
function alPol(r) {
  const fromRead = (read, txt) => ({ m: read === 'Cuts priced' ? 'u' : read === 'Hikes priced' ? 'd' : 'm', txt, go: ['cbwatch', 'Policy monitor', 'cb_table'] });
  switch (r.pol) {
    case 'Fed': { const f = typeof FP !== 'undefined' && FP ? fedRow() : null; if (!f || f.read === '–') return alNA('Fed futures not loaded.');
      return fromRead(f.read, `Fed: ${f.read.toLowerCase()} (${f.gauge}).`); }
    case 'ECB': case 'BoJ': case 'BNM': { const st = cbStats(r.pol); if (!st || st.read === '–') return alNA();
      const C = CBS[r.pol]; return fromRead(st.read, `${C.short}: ${st.read.toLowerCase()}; ${C.gaugeLab} ${bp(st.spread.v)} against a usual ${bp(st.avg)} (${dShort(st.spread.t)}).`); }
    case 'BNM-cash': { const st = cbStats('BNM'); if (!st || st.read === '–') return alNA();
      const x = fromRead(st.read, `BNM: ${st.read.toLowerCase()}. Deposit rates follow the OPR, so priced cuts count against cash and priced hikes for it.`); x.m = alFlip(x.m); return x; }
    case 'real': { if (!has('REAL10Y')) return alNA(); const a = asOf(S.REAL10Y, state.latest), b = asOf(S.REAL10Y, addMonths(a.t, -3)), d = (a.v - b.v) * 100;
      return { m: d <= -15 ? 'u' : d >= 15 ? 'd' : 'm', go: ['markets', 'Gold', 'gold_real'],
        txt: `US 10Y real yield ${fmtNum(a.v, 2)}%, ${bp(d)} over 3 months. A falling real yield lowers the cost of holding a metal that pays nothing.` }; }
    case 'gap': { if (!has('UST3Y', 'MY_MGS_3Y')) return alNA(); const g = combine(S.UST3Y, S.MY_MGS_3Y, (a, b) => a - b, {}, 5 * DAY), a = asOf(g, state.latest), b = a && asOf(g, addMonths(a.t, -3));
      if (!a || !b) return alNA(); const d = (a.v - b.v) * 100;
      return { m: d >= 15 ? 'u' : d <= -15 ? 'd' : 'm', go: ['my', 'Rates & bonds', 'my_gap', () => { state.myGapVs = 'mgs3'; }],
        txt: `US 3Y − MGS 3Y ${bp(a.v * 100)}, ${bp(d)} over 3 months. A gap widening in the dollar’s favour counts for the dollar; a narrowing one for the ringgit.` }; }
  }
  return alNA(r.na && r.na.pol);
}
function alSig(r) {
  if (typeof SIG === 'undefined' || !SIG || !r.sig.length) return alNA(r.na && r.na.sig || 'Signals not loaded.');
  const base = t => /^R_/.test(t) ? t.split('_')[1] : t;   // a relative rule (R_KLCI_AAXJ) counts for its first market
  if (!SIG.signals.some(x => r.sig.includes(base(x.target)))) return alNA('The signal engine has no rule for this asset.');
  const on = SIG.ideas.filter(g => g.net > 0 && r.sig.includes(base(g.target)));
  const tested = on.filter(g => g.signals.some(id => (sigById(id) || {}).tier === 'Tested edge'));
  const up = tested.filter(g => sigSide(g) > 0), dn = tested.filter(g => sigSide(g) < 0), m = up.length && !dn.length ? 'u' : dn.length && !up.length ? 'd' : 'm';
  const txt = tested.length ? tested.map(g => sigHeadline(g, (sigById(g.signals[0]) || {}).best_h || 6)).join('; ') + '.'
    : on.length ? `${on.length} rule${on.length > 1 ? 's are' : ' is'} switched on for it, none with a tested edge.` : 'No rule for this asset is switched on.';
  return { m, txt, go: ['signals', 'Ideas to investigate', 'sig_ideas'] };
}

// ---- the board: computed on each render so the card's date line records the series it read
function alCompute() {
  if (typeof cbPrep === 'function') cbPrep();   // the JGB tenors behind the BoJ gauge are built on first use
  let V = () => null; try { const rows = valRows(); V = name => rows.find(x => x.name === name); } catch (e) { console.warn('evidence: valuation', e); }
  const safe = (f, r, k) => { try { return f(r) || alNA(); } catch (e) { console.warn('evidence', r.k, k, e); return alNA('Could not be read today.'); } };
  return AL_ROWS.map(r => {
    const c = { cycle: safe(alCycle, r, 'cycle'), val: safe(x => alVal(x, V), r, 'val'), trend: safe(alTrend, r, 'trend'), sent: safe(alSent, r, 'sent'), pol: safe(alPol, r, 'pol'), sig: safe(alSig, r, 'sig') };
    for (const [k] of AL_PILLARS) if (c[k].m === 'n' && r.na && r.na[k]) c[k].txt = r.na[k];
    const ms = Object.values(c).map(x => x.m);
    return { r, c, up: ms.filter(m => m === 'u').length, dn: ms.filter(m => m === 'd').length };
  });
}
function alPillarCounts(R) {
  return AL_PILLARS.map(([k, n]) => ({ k, n, U: R.filter(x => x.c[k].m === 'u').length, D: R.filter(x => x.c[k].m === 'd').length, N: R.filter(x => x.c[k].m !== 'n').length }));
}
const alMark = (m, title) => { const [g, cls, w] = AL_MARK[m]; return el('span', { class: 'pm ' + cls, title: title ? `${w}: ${title}` : w, text: g }); };
const alTally = x => el('span', { class: 'tally' }, el('b', { class: 'up', text: `${x.up} for` }), ' · ', el('b', { class: 'dn', text: `${x.dn} against` }));
function alGo(go) {
  const [tab, sub, key, pre] = go; if (pre) pre();
  goSub(tab, sub);
  const c = key && cards[key]; if (c) setTimeout(() => { c.root.scrollIntoView({ block: 'center', behavior: 'smooth' }); c.root.classList.remove('flash'); void c.root.offsetWidth; c.root.classList.add('flash'); }, 150);
}
function renderAlBoard(c) {
  const R = alCompute(); state.alRes = R;
  const b = htmlBody(c), tb = el('tbody'), cols = AL_PILLARS.length + 2;
  let g = null;
  for (const x of R) {
    if (x.r.g !== g) { g = x.r.g; tb.append(el('tr', { class: 'grp' }, el('td', { colspan: cols, text: g }))); }
    tb.append(el('tr', { class: 'row' + (x.r.k === state.alSel ? ' sel' : ''), 'data-k': x.r.k, title: `${x.r.n}: click for the evidence`, onclick: ev => {
        state.alSel = x.r.k; tb.querySelectorAll('tr.row').forEach(t => t.classList.toggle('sel', t.dataset.k === x.r.k)); if (cards.al_detail) cards.al_detail.render(); } },
      el('td', { class: 'l', text: x.r.n }), ...AL_PILLARS.map(([k]) => el('td', {}, alMark(x.c[k].m, x.c[k].txt))), el('td', {}, alTally(x))));
  }
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'alloc' }, el('thead', {}, el('tr', {}, el('th', { text: 'Asset' }), ...AL_PILLARS.map(([, n]) => el('th', { text: n })), el('th', { text: 'Evidence' }))), tb)),
    el('div', { class: 'legend-line' }, ...['u', 'm', 'd', 'n'].map(m => el('span', {}, alMark(m), AL_MARK[m][2]))),
    el('details', { class: 'al-how' }, el('summary', { text: 'How the board works' }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'perf al-rules' }, el('thead', {}, el('tr', {}, ...['Pillar', '▲ supportive', '▼ against', 'Read from'].map(h => el('th', { class: 'l', text: h })))),
        el('tbody', {}, ...AL_RULES.map(rw => el('tr', {}, ...rw.map((t, i) => el('td', { class: 'l' + (i ? '' : ' strong'), text: t }))))))),
      el('p', { class: 'muted small', text: 'Neutral (●) is anything in between. “–” means the dashboard has no measure for that asset; it is not counted. The tally is a count, not a score: the pillars are not weighted and the rows are not ranked.' })),
    el('div', { class: 'card-foot' }, el('span', { text: 'A tally of the dashboard’s own evidence, not a recommendation.' })));
  const up = R.reduce((s, x) => s + x.up, 0), dn = R.reduce((s, x) => s + x.dn, 0), na = R.reduce((s, x) => s + Object.values(x.c).filter(y => y.m === 'n').length, 0);
  setCount(c, `${R.length} assets × ${AL_PILLARS.length} pillars`);
  c.csv = [['Group', 'Asset', ...AL_PILLARS.map(([, n]) => n), 'For', 'Against', ...AL_PILLARS.map(([, n]) => n + ' (evidence)')],
    ...R.map(x => [x.r.g, x.r.n, ...AL_PILLARS.map(([k]) => AL_MARK[x.c[k].m][2]), x.up, x.dn, ...AL_PILLARS.map(([k]) => x.c[k].txt)])];
  setNote(c, `${up} marks for and ${dn} against across the board; ${na} cells have no measure. Each mark repeats what a card elsewhere on the dashboard already shows: hover a mark for its numbers, or click a row to see all six with a link to each card. The rules are under “How the board works”.`);
  setSource(c, 'Dashboard rules on its own data: regime table, valuation scorecard, trend, sentiment and CFTC positioning, central-bank pricing, signal engine');
}
function renderAlDetail(c) {
  const R = state.alRes || alCompute(), x = R.find(y => y.r.k === state.alSel) || R[0]; if (!x) return setEmpty(c, 'Waiting for data.');
  c.titleEl.textContent = x.r.short;
  c.subEl.textContent = 'The evidence, pillar by pillar.';
  setCount(c, `${x.up} for · ${x.dn} against`);
  const b = htmlBody(c);
  b.append(el('ul', { class: 'ev' }, ...AL_PILLARS.map(([k, n]) => { const y = x.c[k], ck = y.go && cards[y.go[2]];
    return el('li', {}, alMark(y.m), el('span', { class: 'pl', text: n }),
      el('span', {}, y.txt + ' ', y.go ? el('button', { type: 'button', class: 'lnk', text: `${ck ? (ck.titleEl.textContent || ck.title) : y.go[1]} →`, onclick: () => alGo(y.go) }) : '')); })));
  c.csv = [['Pillar', 'Mark', 'Evidence'], ...AL_PILLARS.map(([k, n]) => [n, AL_MARK[x.c[k].m][2], x.c[k].txt])];
  setNote(c, 'Click another row of the board to see its evidence. Each line names the card it comes from; the card shows the same number.');
  setSource(c, 'The cards linked on each line');
  setAsOf(c, state.latest);
}
function renderAlPillars(c) {
  const R = state.alRes || alCompute(), P = alPillarCounts(R);
  const o = baseOpt(); o.legend = { ...o.legend, show: true, top: 0, data: ['For', 'Against'] };
  o.grid = { left: 8, right: 34, top: 28, bottom: 8, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, formatter: ps => { const p = P[ps[0].dataIndex]; return `<b>${esc(p.n)}</b><br>${p.U} for · ${p.D} against · ${p.N - p.U - p.D} neutral · ${R.length - p.N} no measure`; } };
  o.xAxis = { type: 'value', minInterval: 1, min: -Math.max(1, ...P.map(p => p.D)) - 1, max: Math.max(1, ...P.map(p => p.U)) + 1, axisLabel: { color: tok('--muted'), fontSize: 11, formatter: v => String(Math.abs(v)) }, splitLine: { lineStyle: { color: tok('--grid') } } };
  o.yAxis = { type: 'category', inverse: true, data: P.map(p => p.n), axisLabel: { color: tok('--ink-2'), fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } };
  const lab = (pos) => ({ show: true, position: pos, color: tok('--ink-2'), fontSize: 11, formatter: p => p.value ? String(Math.abs(p.value)) : '' });
  o.series = [{ name: 'For', type: 'bar', stack: 'n', barWidth: '55%', data: P.map(p => p.U), itemStyle: { color: tok('--pos'), borderRadius: [0, 3, 3, 0] }, label: lab('right') },
    { name: 'Against', type: 'bar', stack: 'n', data: P.map(p => -p.D), itemStyle: { color: tok('--neg'), borderRadius: [3, 0, 0, 3] }, label: lab('left') }];
  const ch = inst(c); ch.resize(); ch.setOption(o, true);
  const top = P.slice().sort((a, b) => (b.U - b.D) - (a.U - a.D))[0], low = P.slice().sort((a, b) => (a.U - a.D) - (b.U - b.D))[0];
  c.csv = [['Pillar', 'For', 'Against', 'Neutral', 'No measure'], ...P.map(p => [p.n, p.U, p.D, p.N - p.U - p.D, R.length - p.N])];
  setNote(c, `${top.n} leans most for (${top.U} for, ${top.D} against); ${low.n} most against (${low.U} for, ${low.D} against). Bars count the board’s marks in each column across the ${R.length} assets; neutral and “–” cells are left out.`);
  setSource(c, 'Evidence board (this page)');
  setAsOf(c, state.latest);
}
function alLeadTiles() {   // EXTRA_HOOKS: the lead sentence and five tiles above the board
  const lead = $('#alLead'), box = $('#alKpis'); if (!lead || !box) return;
  const R = state.alRes || alCompute(), P = alPillarCounts(R), eq = R.filter(x => x.r.g === 'Equities');
  const fr = eq.filter(x => x.up > x.dn), ag = eq.filter(x => x.dn > x.up);
  const lean = ag.length >= 5 ? 'leans against risk' : fr.length >= 5 ? 'leans towards risk' : 'is mixed';
  const one = P.slice().sort((a, b) => Math.abs(b.U - b.D) - Math.abs(a.U - a.D) || (b.U + b.D) - (a.U + a.D))[0], dDir = one.D >= one.U;
  const other = P.filter(p => p !== one).sort((a, b) => dDir ? b.U - a.U : b.D - a.D)[0], oN = other ? (dDir ? other.U : other.D) : 0;
  const w = (cls, t) => el('span', { class: cls, text: t });
  // one line: the lean of the equity rows, the most one-sided pillar, and the pillar that most disagrees with it (counts are in the tiles)
  lead.replaceChildren(el('div', { class: 'eyebrow', text: `Evidence tally · ${dLong(state.latest)}` }),
    el('h2', { title: `${one.n}: ${one.U} for, ${one.D} against, of the ${one.N} assets it measures` + (other ? `. ${other.n}: ${other.U} for, ${other.D} against.` : '') },
      `The evidence ${lean}: ${one.n.toLowerCase()} counts `, w(dDir ? 'dn' : 'up', dDir ? 'against' : 'for'), ` ${dDir ? one.D : one.U} of ${one.N} assets`,
      ...(oN ? [`, ${other.n.toLowerCase()} `, w(dDir ? 'up' : 'dn', dDir ? 'for' : 'against'), ` ${oN}`] : []), '.'));
  box.replaceChildren();
  const tile = (label, value, delta, asof) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: label }), el('div', { class: 'k-value' }, value), el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: asof })));
  const names = L => L.map(x => x.r.n).join(', ') || 'none';
  tile('Equity markets leaning for', `${fr.length} of ${eq.length}`, names(fr), 'more marks for than against');
  tile('Equity markets leaning against', `${ag.length} of ${eq.length}`, names(ag), 'more marks against than for');
  const best = P.slice().sort((a, b) => (b.U - b.D) - (a.U - a.D))[0], worst = P.slice().sort((a, b) => (a.U - a.D) - (b.U - b.D))[0];
  tile('Most supportive pillar', best.n, `${best.U} for · ${best.D} against`, `across ${R.length} assets`);
  tile('Most adverse pillar', worst.n, `${worst.U} for · ${worst.D} against`, `across ${R.length} assets`);
  if (has('REG_QUAD')) { const q = asOf(S.REG_QUAD, state.latest);
    tile('Regime', el('span', {}, el('span', { class: 'qdot', style: `background:${qColor(q.v)}` }), QUADS[q.v].name), QUADS[q.v].tag, `sets the Cycle column · ${monthLab(q.t)}`); }
}
function buildEvidence(g) {
  makeCard(g, { key: 'al_board', title: 'Evidence board', wide: true, range: false, render: renderAlBoard });
  makeCard(g, { key: 'al_detail', title: 'The evidence', range: false, render: renderAlDetail });
  makeCard(g, { key: 'al_pillars', title: 'Evidence by pillar', range: false, render: renderAlPillars });
  for (const k of ['al_board', 'al_detail']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
}
SUBTABS.alloc.unshift(['Evidence board', ['#alLead', '#alKpis', 'al_board', 'al_detail', 'al_pillars']]);
TILE_SETS.alloc = { 'Evidence board': ['Equity markets leaning for', 'Equity markets leaning against', 'Most supportive pillar', 'Most adverse pillar', 'Regime'] };
EXTRA_HOOKS.alloc = [alLeadTiles];
