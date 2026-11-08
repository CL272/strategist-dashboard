/* Strategist Dashboard. Plain JS + ECharts, no build step. */
'use strict';

const DAY = 864e5;
const S = {};                 // series store: id -> {id,label,group,kind,unit,source,note,t:[ms],v:[]}
let META = {};
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const state = {
  tab: 'liquidity', preset: '3Y', from: null, to: null, latest: null, earliest: Date.UTC(2005, 0, 1),
  liqMode: 'level', gcbMode: 'level', ratesMode: 'yields',
  mktSel: ['SPX', 'SX5E', 'NKY', 'CSI300', 'STI'], selSlot: {},
  perfSort: null,
  corrA: 'SPX', corrB: 'UST10Y',
};
const cards = {};

// ------------------------------------------------------------------ utils
const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids) if (c != null) n.append(c);
  return n;
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tok = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const SLOTS = ['--s1', '--s2', '--s3', '--s4', '--s5', '--s6', '--s7', '--s8'];
const col = i => tok(SLOTS[i % 8]);

const iso = t => new Date(t).toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const nice = t => { const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
function addMonths(t, m) {
  const d = new Date(t), y = d.getUTCFullYear(), mo = d.getUTCMonth() + m, day = d.getUTCDate();
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return Date.UTC(y, mo, Math.min(day, last));
}
function fmtNum(v, dec) {
  if (v == null || !isFinite(v)) return '–';
  return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function autoDec(v) { const a = Math.abs(v); return a >= 1000 ? 0 : a >= 100 ? 1 : a >= 10 ? 2 : a >= 1 ? 3 : 4; }
function fmtVal(s, v) {
  if (v == null) return '–';
  switch (s.unit) {
    case '%': return fmtNum(v, 2) + '%';
    case 'USD tn': return '$' + fmtNum(v, 2) + 'tn';
    case 'bp': return fmtNum(v, 0) + 'bp';
    case 'idx': return fmtNum(v, Math.abs(v) < 10 ? 2 : 1);
    default: return fmtNum(v, autoDec(v));
  }
}
const sign = v => (v > 0 ? '+' : v < 0 ? '−' : '');
function fmtChg(s, c) {
  if (c == null || !isFinite(c)) return '–';
  const a = Math.abs(c);
  if (s.kind === 'price') return sign(c) + fmtNum(a, a >= 100 ? 0 : 1) + '%';
  if (s.kind === 'yield') return sign(c) + fmtNum(a, 0) + 'bp';
  if (s.unit === 'USD tn') return sign(c) + '$' + fmtNum(a * 1000, 0) + 'bn';
  if (s.unit === 'bp') return sign(c) + fmtNum(a, 0) + 'bp';
  if (s.unit === '%') return sign(c) + fmtNum(a, 2) + 'pp';
  return sign(c) + fmtNum(a, a >= 10 ? 1 : 2);
}

// ------------------------------------------------------------------ series access
function idxLE(s, x) {
  let lo = 0, hi = s.t.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (s.t[m] <= x) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
}
function asOf(s, x) { const i = idxLE(s, x); return i < 0 ? null : { t: s.t[i], v: s.v[i], i }; }
function pts(s, from, to) {
  const out = [];
  for (let i = Math.max(0, idxLE(s, from - 1) + 1); i < s.t.length && s.t[i] <= to; i++) out.push([s.t[i], s.v[i]]);
  return out;
}
function chg(s, base, last) {
  if (base == null || last == null) return null;
  if (s.kind === 'price') return (last / base - 1) * 100;
  if (s.kind === 'yield') return (last - base) * 100;
  return last - base;
}
const has = (...ids) => ids.every(id => S[id] && S[id].t.length);
function derive(id, label, unit, t, v, extra = {}) { return { id, label, unit, kind: 'level', source: '', t, v, ...extra }; }
// % change over k observations
function pctChangeK(s, k) {
  const t = [], v = [];
  for (let i = k; i < s.t.length; i++) { t.push(s.t[i]); v.push((s.v[i] / s.v[i - k] - 1) * 100); }
  return derive(s.id + '_pc' + k, s.label, '%', t, v);
}
// sample s at the dates of ref (as-of, no look-ahead)
function sampleAt(s, refT) {
  const t = [], v = [];
  for (const x of refT) { const a = asOf(s, x); if (a && x - a.t < 10 * DAY) { t.push(x); v.push(a.v); } }
  return derive(s.id + '_at', s.label, s.unit, t, v, { kind: s.kind });
}
function pearson(a, b) {
  const n = a.length; if (n < 3) return null;
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; saa += a[i] * a[i]; sbb += b[i] * b[i]; sab += a[i] * b[i]; }
  const cov = sab - sa * sb / n, va = saa - sa * sa / n, vb = sbb - sb * sb / n;
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null;
}

// ------------------------------------------------------------------ cards & charts
function makeCard(parent, o) {
  const c = { ...o, inst: null, csv: null };
  const tools = el('div', { class: 'card-tools' });
  if (o.seg) {
    const seg = el('div', { class: 'seg', role: 'group' });
    for (const [val, lab] of o.seg.options) {
      const b = el('button', { type: 'button', text: lab, class: val === state[o.seg.key] ? 'on' : '' });
      b.addEventListener('click', () => {
        state[o.seg.key] = val;
        seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        c.render();
      });
      seg.append(b);
    }
    tools.append(seg);
  }
  tools.append(
    el('button', { class: 'ghost', type: 'button', text: '⤢', title: 'Focus (enlarge for screenshots)', onclick: () => { c.root.classList.toggle('focus'); setTimeout(() => c.inst && c.inst.resize(), 0); } }),
    el('button', { class: 'ghost', type: 'button', text: 'PNG', title: 'Download chart as image', onclick: () => exportPNG(c) }),
    el('button', { class: 'ghost', type: 'button', text: 'CSV', title: 'Download chart data', onclick: () => c.csv && downloadCSV(c.csv, c.title) }),
  );
  c.titleEl = el('h2', { text: o.title });
  c.subEl = el('p', { class: 'muted small', text: o.sub || '' });
  c.chartEl = el('div', { class: 'chart' });
  c.emptyEl = el('div', { class: 'empty', hidden: true });
  c.noteEl = el('p', { class: 'note', hidden: true });
  c.root = el('div', { class: 'card' + (o.wide ? ' wide' : '') + (o.tall ? ' tall' : '') },
    el('div', { class: 'card-head' }, el('div', {}, c.titleEl, c.subEl), tools),
    c.chartEl, c.emptyEl, c.noteEl);
  parent.append(c.root);
  c.render = () => { try { o.render(c); } catch (e) { console.error(o.key, e); setEmpty(c, 'Could not draw this chart.'); } };
  cards[o.key] = c;
  return c;
}
function inst(c) {
  c.chartEl.hidden = false; c.emptyEl.hidden = true;
  if (!c.inst) c.inst = echarts.init(c.chartEl, null, { renderer: 'canvas' });
  return c.inst;
}
function setEmpty(c, msg) {
  c.chartEl.hidden = true; c.emptyEl.hidden = false; c.emptyEl.textContent = msg; c.csv = null;
  setNote(c, '');
}
function setNote(c, txt) { c.noteEl.hidden = !txt; c.noteEl.textContent = txt || ''; }
const NO_FRED = 'Waiting for FRED data. It arrives with the first daily run on GitHub (see README).';

function baseOpt() {
  return {
    animation: false, backgroundColor: 'transparent',
    textStyle: { fontFamily: FONT, color: tok('--ink-2') },
    grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
    tooltip: {
      trigger: 'axis', confine: true, axisPointer: { type: 'line', lineStyle: { color: tok('--muted'), width: 1 } },
      backgroundColor: tok('--surface'), borderColor: tok('--border'), padding: [8, 10],
      textStyle: { color: tok('--ink'), fontSize: 12, fontFamily: FONT }, extraCssText: 'box-shadow:0 4px 14px rgba(0,0,0,.12);border-radius:8px;',
    },
    legend: { top: 0, left: 0, icon: 'roundRect', itemWidth: 14, itemHeight: 3, itemGap: 14, textStyle: { color: tok('--ink-2'), fontSize: 12 } },
  };
}
function timeAxis(extra = {}) {
  return {
    type: 'time', axisLine: { lineStyle: { color: tok('--axis') } }, axisTick: { show: false },
    axisLabel: { color: tok('--muted'), hideOverlap: true, fontSize: 11 }, splitLine: { show: false },
    min: state.from, max: state.to, ...extra,
  };
}
function valAxis(fmt, extra = {}) {
  return {
    type: 'value', scale: true, axisLabel: { color: tok('--muted'), formatter: fmt, fontSize: 11 },
    splitLine: { lineStyle: { color: tok('--grid') } }, axisLine: { show: false }, ...extra,
  };
}
function line(name, data, color, extra = {}) {
  return {
    name, type: 'line', data, showSymbol: false, symbol: 'circle', symbolSize: 8, sampling: 'lttb',
    lineStyle: { width: 2, color }, itemStyle: { color }, emphasis: { disabled: true }, ...extra,
  };
}
function zeroLine() {
  return { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: tok('--axis'), type: 'solid', width: 1 }, data: [{ yAxis: 0 }] };
}
function tipFormatter(fmt) {
  return params => {
    const ps = Array.isArray(params) ? params : [params];
    if (!ps.length) return '';
    const head = `<div style="color:${tok('--ink-2')};margin-bottom:4px">${esc(nice(ps[0].value[0]))}</div>`;
    const rows = ps.filter(p => p.value && p.value[1] != null).map(p =>
      `<div style="display:flex;align-items:center;gap:8px;line-height:1.6">
         <span style="width:12px;height:2px;background:${p.color};display:inline-block"></span>
         <b style="font-variant-numeric:tabular-nums">${esc(fmt(p.value[1], p.seriesName))}</b>
         <span style="color:${tok('--ink-2')}">${esc(p.seriesName)}</span></div>`).join('');
    return head + rows;
  };
}
// direct end-labels for 2-4 line series
function withEndLabels(series) {
  if (series.length < 2 || series.length > 4) return 0;
  let maxLen = 0;
  for (const s of series) {
    s.endLabel = { show: true, formatter: p => p.seriesName, color: tok('--ink-2'), fontSize: 11, distance: 6 };
    maxLen = Math.max(maxLen, s.name.length);
  }
  return Math.min(140, maxLen * 6.2 + 10);
}
function drawLines(c, list, { fmt = v => fmtNum(v, autoDec(v)), axisFmt, zero = false, yExtra = {}, endLabels = true } = {}) {
  const series = list.map((s, i) => line(s.name, s.data, s.color || col(i), s.extra || {}));
  if (zero && series.length) series[0].markLine = zeroLine();
  const o = baseOpt();
  const pad = endLabels ? withEndLabels(series) : 0;
  o.grid.right = 16 + pad;
  o.legend.show = series.length > 1;
  o.grid.top = series.length > 1 ? 34 : 14;
  o.tooltip.formatter = tipFormatter(fmt);
  o.xAxis = timeAxis();
  o.yAxis = valAxis(axisFmt || (v => fmtNum(v, autoDec(v))), yExtra);
  o.series = series;
  inst(c).setOption(o, true);
  c.csv = toCSV(list);
}
function toCSV(list) {
  const map = new Map();
  list.forEach((s, j) => s.data.forEach(([t, v]) => { if (!map.has(t)) map.set(t, Array(list.length).fill('')); map.get(t)[j] = v; }));
  const rows = [['Date', ...list.map(s => s.name)]];
  [...map.keys()].sort((a, b) => a - b).forEach(t => rows.push([iso(t), ...map.get(t)]));
  return rows;
}
function downloadCSV(rows, name) {
  const txt = rows.map(r => r.map(x => /[",\n]/.test(String(x)) ? `"${String(x).replace(/"/g, '""')}"` : x).join(',')).join('\n');
  download(URL.createObjectURL(new Blob([txt], { type: 'text/csv' })), slug(name) + '.csv');
}
function download(href, filename) { const a = el('a', { href, download: filename }); document.body.append(a); a.click(); a.remove(); }
const slug = s => (s || 'chart').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '_' + iso(state.to);
function rangeLabel() { return `${nice(state.from)} – ${nice(state.to)}`; }
async function exportPNG(c) {
  if (!c.inst || c.chartEl.hidden) return;
  const img = new Image();
  img.src = c.inst.getDataURL({ pixelRatio: 2, backgroundColor: tok('--surface') });
  await img.decode();
  const pad = 36, head = 112, foot = 60;
  const cv = el('canvas'); cv.width = img.width + pad * 2; cv.height = img.height + head + foot;
  const g = cv.getContext('2d');
  g.fillStyle = tok('--surface'); g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = tok('--ink'); g.font = `600 32px ${FONT}`; g.fillText(c.title, pad, 54);
  g.fillStyle = tok('--ink-2'); g.font = `24px ${FONT}`; g.fillText(c.subEl.textContent, pad, 92);
  g.drawImage(img, pad, head);
  g.fillStyle = tok('--muted'); g.font = `20px ${FONT}`;
  g.fillText(`Source: ${c.source || 'FRED, Yahoo Finance'} · ${rangeLabel()}`, pad, cv.height - 24);
  download(cv.toDataURL('image/png'), slug(c.title) + '.png');
}

// ------------------------------------------------------------------ LIQUIDITY
function liquidityKpis() {
  const box = $('#liqKpis'); box.replaceChildren();
  const to = state.to;
  const tile = (label, valTxt, deltaTxt, asofT) => box.append(el('div', { class: 'kpi' },
    el('div', { class: 'k-label', text: label }), el('div', { class: 'k-value', text: valTxt }),
    el('div', { class: 'k-delta', text: deltaTxt }), el('div', { class: 'k-asof', text: asofT ? 'as of ' + nice(asofT) : '' })));
  const std = (id, label, lag1, lag2, lab1, lab2) => {
    if (!has(id)) return tile(label, '–', 'no data yet', null);
    const s = S[id], a = asOf(s, to); if (!a) return tile(label, '–', '', null);
    const b1 = asOf(s, a.t - lag1), b2 = asOf(s, a.t - lag2);
    tile(label, fmtVal(s, a.v), `${lab1} ${fmtChg(s, chg(s, b1 && b1.v, a.v))} · ${lab2} ${fmtChg(s, chg(s, b2 && b2.v, a.v))}`, a.t);
  };
  std('NET_LIQ', 'Fed net liquidity', 28 * DAY, 91 * DAY, '4w', '13w');
  std('FED_ASSETS_TN', 'Fed balance sheet', 28 * DAY, 91 * DAY, '4w', '13w');
  std('RESERVES_TN', 'Bank reserves', 28 * DAY, 91 * DAY, '4w', '13w');
  std('TGA_TN', 'Treasury cash (TGA)', 28 * DAY, 91 * DAY, '4w', '13w');
  std('RRP_TN', 'Reverse repo (ON RRP)', 28 * DAY, 91 * DAY, '4w', '13w');
  std('SOFR_IORB', 'SOFR − IORB', 7 * DAY, 30 * DAY, '1w', '1m');
  std('HY_OAS_BP', 'US HY spread', 7 * DAY, 30 * DAY, '1w', '1m');
  std('NFCI', 'Financial conditions (NFCI)', 28 * DAY, 91 * DAY, '4w', '13w');
}
function liquiditySignals() {
  const box = $('#liqSignals'); box.replaceChildren();
  const sig = (status, icon, text) => box.append(el('span', { class: 'signal' },
    el('span', { class: 'dot', style: `background:${tok('--' + status)}` }), el('span', { text: (icon ? icon + ' ' : '') + text })));
  const to = state.to;
  if (has('NET_LIQ')) {
    const s = S.NET_LIQ, a = asOf(s, to), b = a && asOf(s, a.t - 91 * DAY);
    if (a && b) {
      const d = (a.v - b.v) * 1000;
      d >= 0 ? sig('good', '▲', `Net liquidity rising: +$${fmtNum(d, 0)}bn over 13 weeks`)
             : sig('critical', '▼', `Net liquidity draining: −$${fmtNum(-d, 0)}bn over 13 weeks`);
    }
  }
  if (has('SOFR_IORB')) {
    const pp = pts(S.SOFR_IORB, to - 30 * DAY, to).map(p => p[1]);
    if (pp.length) {
      const avg = pp.reduce((x, y) => x + y, 0) / pp.length;
      avg > 0 ? sig('warning', '!', `Repo pressure: SOFR averaging ${fmtNum(avg, 1)}bp above IORB (1m)`)
              : sig('good', '', `Repo funding calm: SOFR ${fmtNum(-avg, 1)}bp below IORB (1m avg)`);
    }
  }
  if (has('HY_OAS_BP')) {
    const s = S.HY_OAS_BP, a = asOf(s, to), b = a && asOf(s, a.t - 30 * DAY);
    if (a && b && a.v - b.v > 50) sig('serious', '▲', `HY spreads widened ${fmtNum(a.v - b.v, 0)}bp in a month`);
    else if (a && a.v < 300) sig('warning', '', `HY spreads tight at ${fmtNum(a.v, 0)}bp (below 300bp)`);
  }
  if (has('NFCI')) {
    const a = asOf(S.NFCI, to);
    if (a) a.v < 0 ? sig('good', '', `Financial conditions looser than average (NFCI ${fmtNum(a.v, 2)})`)
                   : sig('serious', '', `Financial conditions tighter than average (NFCI ${fmtNum(a.v, 2)})`);
  }
  if (!box.children.length) box.append(el('span', { class: 'muted small', text: 'Signals will appear once FRED data has loaded.' }));
}
function renderNetLiq(c) {
  if (!has('NET_LIQ')) return setEmpty(c, NO_FRED);
  const nl = S.NET_LIQ, spx = S.SPX, { from, to } = state;
  if (state.liqMode === 'level' || !spx) {
    c.subEl.textContent = 'Fed total assets − Treasury General Account − overnight reverse repo (weekly). S&P 500 below, same dates.';
    const a = pts(nl, from, to), b = spx ? pts(spx, from, to) : [];
    const o = baseOpt();
    o.legend.show = true;
    o.grid = [{ left: 8, right: 16, top: 34, height: '40%', containLabel: true }, { left: 8, right: 16, top: '58%', bottom: 8, containLabel: true }];
    o.axisPointer = { link: [{ xAxisIndex: 'all' }] };
    o.xAxis = [timeAxis({ gridIndex: 0, axisLabel: { show: false } }), timeAxis({ gridIndex: 1 })];
    o.yAxis = [valAxis(v => '$' + fmtNum(v, 1) + 'tn', { gridIndex: 0 }), valAxis(v => fmtNum(v, 0), { gridIndex: 1 })];
    o.tooltip.formatter = tipFormatter((v, n) => n === 'S&P 500' ? fmtNum(v, 0) : '$' + fmtNum(v, 2) + 'tn');
    o.series = [line('Fed net liquidity', a, col(0)), line('S&P 500', b, col(1), { xAxisIndex: 1, yAxisIndex: 1 })];
    inst(c).setOption(o, true);
    c.csv = toCSV([{ name: 'Fed net liquidity (USD tn)', data: a }, { name: 'S&P 500', data: b }]);
    setNote(c, '');
    return;
  }
  const k = state.liqMode === 'chg13' ? 13 : 52;
  c.subEl.textContent = `${k === 13 ? '13-week' : 'Year-on-year'} % change, both on weekly Wednesday dates.`;
  const spxW = sampleAt(spx, nl.t);
  const nlc = pctChangeK(nl, k), spc = pctChangeK(spxW, k);
  const a = pts(nlc, from, to), b = pts(spc, from, to);
  drawLines(c, [{ name: 'Fed net liquidity', data: a }, { name: 'S&P 500', data: b }],
    { fmt: v => sign(v) + fmtNum(Math.abs(v), 1) + '%', axisFmt: v => fmtNum(v, 0) + '%', zero: true });
  const bm = new Map(b);
  const pairs = a.filter(p => bm.has(p[0]));
  const r = pearson(pairs.map(p => p[1]), pairs.map(p => bm.get(p[0])));
  setNote(c, r == null ? '' : `Correlation of the two ${k === 13 ? '13-week' : 'YoY'} changes over the selected range: ${fmtNum(r, 2)} (${pairs.length} weeks).`);
}
function renderComponents(c) {
  const ids = ['FED_ASSETS_TN', 'RESERVES_TN', 'TGA_TN', 'RRP_TN'].filter(id => has(id));
  if (!ids.length) return setEmpty(c, NO_FRED);
  drawLines(c, ids.map((id, i) => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(i) })),
    { fmt: v => '$' + fmtNum(v, 2) + 'tn', axisFmt: v => '$' + fmtNum(v, 1) + 'tn', yExtra: { scale: false } });
}
function renderFunding(c) {
  const ids = ['SOFR_IORB', 'EFFR_IORB'].filter(id => has(id));
  if (!ids.length) return setEmpty(c, NO_FRED);
  drawLines(c, ids.map((id, i) => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(i) })),
    { fmt: v => fmtNum(v, 0) + 'bp', axisFmt: v => fmtNum(v, 0) + 'bp', zero: true });
  setNote(c, 'Above zero means banks pay more for overnight cash than the Fed pays on reserves, a sign reserves are getting scarce.');
}
function renderGCB(c) {
  const ids = ['GCB_FED', 'GCB_ECB', 'GCB_BOJ'];
  if (!has(...ids)) return setEmpty(c, NO_FRED);
  if (state.gcbMode === 'yoy') {
    c.subEl.textContent = 'Year-on-year % change in the combined Fed + ECB + BoJ balance sheet, in USD.';
    const tot = S.GCB_TOTAL, k = 52;
    drawLines(c, [{ name: 'Fed + ECB + BoJ, YoY', data: pts(pctChangeK(tot, k), state.from, state.to) }],
      { fmt: v => sign(v) + fmtNum(Math.abs(v), 1) + '%', axisFmt: v => fmtNum(v, 0) + '%', zero: true });
    return;
  }
  c.subEl.textContent = 'Fed, ECB and BoJ total assets in USD at market FX, stacked. BoJ is monthly.';
  const surf = tok('--surface');
  const series = ids.map((id, i) => ({
    ...line(S[id].label, pts(S[id], state.from, state.to), col(i)),
    stack: 'gcb', areaStyle: { color: col(i), opacity: 0.9 }, lineStyle: { width: 1.5, color: surf },
  }));
  const o = baseOpt();
  o.tooltip.formatter = tipFormatter(v => '$' + fmtNum(v, 2) + 'tn');
  o.xAxis = timeAxis(); o.yAxis = valAxis(v => '$' + fmtNum(v, 0) + 'tn', { scale: false });
  o.series = series;
  inst(c).setOption(o, true);
  c.csv = toCSV(ids.map(id => ({ name: S[id].label + ' (USD tn)', data: pts(S[id], state.from, state.to) })));
  const tot = S.GCB_TOTAL, a = asOf(tot, state.to), b = a && asOf(tot, a.t - 365 * DAY);
  setNote(c, a ? `Total ${fmtVal(tot, a.v)} as of ${nice(a.t)}` + (b ? `, ${sign(a.v - b.v)}${fmtNum(Math.abs((a.v / b.v - 1) * 100), 1)}% YoY.` : '.') : '');
}
function simple(ids, fmt, axisFmt, opts = {}) {
  return c => {
    const ok = ids.filter(id => has(id));
    if (!ok.length) return setEmpty(c, NO_FRED);
    drawLines(c, ok.map((id, i) => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(i) })), { fmt, axisFmt, ...opts });
    if (opts.note) setNote(c, opts.note);
  };
}
function renderRates(c) {
  if (state.ratesMode === 'curve') {
    c.subEl.textContent = 'Yield curve spreads. Below zero = inverted.';
    return simple(['CURVE_2s10s', 'CURVE_3m10y'], v => fmtNum(v * 100, 0) + 'bp', v => fmtNum(v * 100, 0) + 'bp', { zero: true })(c);
  }
  c.subEl.textContent = 'Nominal yields, 10Y real yield (TIPS) and 10Y breakeven inflation.';
  simple(['UST2Y', 'UST10Y', 'REAL10Y', 'BE10Y'], v => fmtNum(v, 2) + '%', v => fmtNum(v, 1) + '%')(c);
}
function buildLiquidity() {
  const g = $('#liqGrid');
  makeCard(g, { key: 'netliq', title: 'Fed net liquidity vs S&P 500', wide: true, tall: true, source: 'FRED (WALCL, WDTGAL, RRPONTSYD), Yahoo Finance',
    seg: { key: 'liqMode', options: [['level', 'Levels'], ['chg13', '13w %'], ['yoy', 'YoY %']] }, render: renderNetLiq });
  makeCard(g, { key: 'comp', title: 'Fed balance sheet components', sub: 'USD trillions. Reserves are what banks hold at the Fed; TGA and reverse repo drain them.', source: 'FRED', render: renderComponents });
  makeCard(g, { key: 'fund', title: 'Repo funding stress', sub: 'Overnight rates minus interest on reserve balances (IORB), bp.', source: 'FRED', render: renderFunding });
  makeCard(g, { key: 'gcb', title: 'Global central bank balance sheets', source: 'FRED (WALCL, ECBASSETSW, JPNASSETS, DEXUSEU, DEXJPUS)',
    seg: { key: 'gcbMode', options: [['level', 'Level'], ['yoy', 'YoY %']] }, render: renderGCB });
  makeCard(g, { key: 'credit', title: 'US credit spreads', sub: 'ICE BofA option-adjusted spreads over Treasuries, bp.', source: 'FRED (ICE BofA)',
    render: simple(['HY_OAS_BP', 'IG_OAS_BP'], v => fmtNum(v, 0) + 'bp', v => fmtNum(v, 0) + 'bp') });
  makeCard(g, { key: 'nfci', title: 'Chicago Fed financial conditions (NFCI)', sub: 'Weekly. Below zero = looser than the long-run average.', source: 'FRED (NFCI)',
    render: simple(['NFCI'], v => fmtNum(v, 2), v => fmtNum(v, 1), { zero: true }) });
  makeCard(g, { key: 'm2', title: 'US M2 money supply growth', sub: 'Year-on-year %, monthly.', source: 'FRED (M2SL)',
    render: simple(['M2_YOY'], v => fmtNum(v, 1) + '%', v => fmtNum(v, 1) + '%', { zero: true }) });
  makeCard(g, { key: 'rates', title: 'US Treasury yields', source: 'FRED',
    seg: { key: 'ratesMode', options: [['yields', 'Yields'], ['curve', 'Curve']] }, render: renderRates });
}
function renderLiquidity() {
  liquidityKpis(); liquiditySignals();
  ['netliq', 'comp', 'fund', 'gcb', 'credit', 'nfci', 'm2', 'rates'].forEach(k => cards[k].render());
}

// ------------------------------------------------------------------ MARKETS
const GROUP_ORDER = ['Equities · US', 'Equities · Europe', 'Equities · Japan', 'Equities · China/HK', 'Equities · N. Asia',
  'Equities · ASEAN', 'Equities · India', 'Equities · Australia', 'Equities · LatAm', 'Equities · Global', 'Equities · US sectors',
  'Rates · US', 'Credit', 'Bonds & credit', 'FX', 'Commodities', 'Crypto', 'Volatility'];
const PERF_FRED = ['UST2Y', 'UST10Y', 'UST30Y', 'REAL10Y', 'BE10Y', 'CURVE_2s10s', 'HY_OAS', 'IG_OAS'];
const PERIODS = [['1D', null], ['1W', t => t - 7 * DAY], ['1M', t => addMonths(t, -1)], ['3M', t => addMonths(t, -3)],
  ['YTD', t => Date.UTC(new Date(t).getUTCFullYear() - 1, 11, 31)], ['1Y', t => addMonths(t, -12)], ['Range', () => state.from]];
function perfRows() {
  const ids = Object.keys(S).filter(id => S[id].source && S[id].source.startsWith('Yahoo')).concat(PERF_FRED.filter(id => has(id)));
  return ids.filter(id => has(id)).map(id => {
    const s = S[id], a = asOf(s, state.to);
    if (!a) return null;
    const r = { id, s, last: a.v, t: a.t };
    for (const [k, fn] of PERIODS) {
      const b = k === '1D' ? (a.i > 0 ? { v: s.v[a.i - 1] } : null) : asOf(s, fn(a.t));
      r[k] = b ? chg(s, b.v, a.v) : null;
    }
    return r;
  }).filter(Boolean);
}
function assignSlot(id) {
  if (state.selSlot[id] != null) return;
  const used = new Set(Object.values(state.selSlot));
  for (let i = 0; i < 8; i++) if (!used.has(i)) { state.selSlot[id] = i; return; }
}
function toggleSel(id, on) {
  if (on && !state.mktSel.includes(id)) {
    if (state.mktSel.length >= 8) { alert('Up to 8 series at once. Untick one first.'); return false; }
    state.mktSel.push(id); assignSlot(id);
  } else if (!on) {
    state.mktSel = state.mktSel.filter(x => x !== id); delete state.selSlot[id];
  }
  renderMktCharts(); return true;
}
function renderPerfTable() {
  const rows = perfRows();
  const tbl = $('#perfTable'); tbl.replaceChildren();
  const cols = PERIODS.map(p => p[0]);
  const hdr = el('tr', {}, el('th', { text: 'Asset' }), el('th', { text: 'Last' }));
  cols.forEach(k => hdr.append(el('th', { text: (k === 'Range' ? 'Range' : k) + (state.perfSort && state.perfSort.k === k ? (state.perfSort.dir > 0 ? ' ▲' : ' ▼') : ''),
    title: 'Sort within each group', onclick: () => { state.perfSort = state.perfSort && state.perfSort.k === k ? { k, dir: -state.perfSort.dir } : { k, dir: -1 }; renderPerfTable(); } })));
  tbl.append(el('thead', {}, hdr));
  // colour scale per column & kind = 90th percentile of |change|
  const scale = {};
  for (const k of cols) for (const kind of ['price', 'yield', 'level']) {
    const xs = rows.filter(r => r.s.kind === kind && r[k] != null).map(r => Math.abs(kind === 'level' ? r[k] / Math.max(1e-9, Math.abs(r.last)) * 100 : r[k])).sort((a, b) => a - b);
    scale[k + kind] = xs.length ? xs[Math.floor(xs.length * 0.9)] || xs[xs.length - 1] : 1;
  }
  const pos = tok('--pos'), neg = tok('--neg');
  const tb = el('tbody');
  const groups = [...new Set(rows.map(r => r.s.group))].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
  for (const gname of groups) {
    tb.append(el('tr', { class: 'grp' }, el('td', { colspan: cols.length + 2, text: gname })));
    let gr = rows.filter(r => r.s.group === gname);
    if (state.perfSort) gr = gr.sort((a, b) => ((a[state.perfSort.k] ?? -1e9) - (b[state.perfSort.k] ?? -1e9)) * -state.perfSort.dir);
    for (const r of gr) {
      const on = state.mktSel.includes(r.id);
      const cb = el('input', { type: 'checkbox', 'aria-label': 'Chart ' + r.s.label });
      cb.checked = on;
      cb.addEventListener('change', () => { if (!toggleSel(r.id, cb.checked)) cb.checked = false; renderPerfTable(); });
      const sw = el('span', { class: 'swatch', style: on ? `background:${col(state.selSlot[r.id])}` : 'background:transparent' });
      const tr = el('tr', { class: 'row', title: `${r.s.source} · last ${nice(r.t)}` },
        el('td', { class: 'name' }, cb, sw, el('span', { text: r.s.label })),
        el('td', { text: r.s.kind === 'yield' ? fmtNum(r.last, 2) + '%' : fmtVal(r.s, r.last) }));
      for (const k of cols) {
        const v = r[k];
        const mag = v == null ? 0 : Math.abs(r.s.kind === 'level' ? v / Math.max(1e-9, Math.abs(r.last)) * 100 : v);
        const alpha = Math.min(1, mag / (scale[k + r.s.kind] || 1)) * 0.42;
        const bg = v == null || v === 0 ? '' : `background:${hexA(v > 0 ? pos : neg, alpha)}`;
        tr.append(el('td', { class: 'heat', style: bg, text: fmtChg(r.s, v) }));
      }
      tb.append(tr);
    }
  }
  tbl.append(tb);
  $('#perfNote').textContent = `Changes to ${nice(state.to)}. “Range” runs from ${nice(state.from)}. Prices in % (ETFs include dividends); yields and spreads in bp; VIX/MOVE in points. Tick a row to chart it.`;
  $('#perfCsv').onclick = () => downloadCSV([['Asset', 'Group', 'Last', ...cols], ...rows.map(r => [r.s.label, r.s.group, r.last, ...cols.map(k => r[k] == null ? '' : r[k].toFixed(2))])], 'cross-asset-performance');
}
function hexA(hex, a) {
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}
function renderMktCharts() {
  const pr = state.mktSel.filter(id => has(id) && S[id].kind !== 'yield');
  const yl = state.mktSel.filter(id => has(id) && S[id].kind === 'yield');
  const c1 = cards.rebased, c2 = cards.yields;
  if (!pr.length) setEmpty(c1, 'Tick assets in the table below to compare them.');
  else {
    const list = pr.map(id => {
      const s = S[id], p = pts(s, state.from, state.to), b = asOf(s, state.from) || (p[0] && { v: p[0][1] });
      return { name: s.label, data: b ? p.map(([t, v]) => [t, v / b.v * 100]) : [], color: col(state.selSlot[id]) };
    });
    drawLines(c1, list, { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0) });
    c1.subEl.textContent = `Each series = 100 on ${nice(state.from)}. Local currency; ETFs in USD with dividends.`;
  }
  c2.root.hidden = !yl.length;
  if (yl.length) {
    drawLines(c2, yl.map(id => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(state.selSlot[id]) })),
      { fmt: v => fmtNum(v, 2) + '%', axisFmt: v => fmtNum(v, 1) + '%' });
  }
}
function buildMarkets() {
  const g = $('#mktCharts');
  makeCard(g, { key: 'rebased', title: 'Relative performance', wide: true, source: 'Yahoo Finance, FRED', render: renderMktCharts });
  makeCard(g, { key: 'yields', title: 'Selected rates & spreads', wide: true, sub: 'Levels, %.', source: 'FRED', render: renderMktCharts });
}
function renderMarkets() { state.mktSel.forEach(assignSlot); renderMktCharts(); renderPerfTable(); }

// ------------------------------------------------------------------ CORRELATION
const UNIVERSES = {
  'Core cross-asset': ['SPX', 'SX5E', 'NKY', 'CSI300', 'STI', 'EEM', 'UST10Y', 'REAL10Y', 'DXY', 'GOLD', 'BRENT', 'COPPER', 'BTC', 'HY_OAS'],
  'Global equities': ['SPX', 'NDX', 'SX5E', 'UKX', 'NKY', 'CSI300', 'HSI', 'KOSPI', 'TWSE', 'STI', 'KLCI', 'AS51', 'NIFTY', 'IBOV'],
  'Asia & FX': ['NKY', 'CSI300', 'HSI', 'STI', 'KLCI', 'AS51', 'DXY', 'USDJPY', 'USDCNY', 'USDSGD', 'USDMYR', 'USDKRW', 'AUDUSD', 'UST10Y'],
  'Liquidity & macro': ['NET_LIQ', 'GCB_TOTAL', 'SPX', 'NDX', 'BTC', 'GOLD', 'COPPER', 'UST10Y', 'REAL10Y', 'DXY', 'HY_OAS', 'VIX'],
  'Rates & commodities': ['UST2Y', 'UST10Y', 'REAL10Y', 'BE10Y', 'TLT', 'GOLD', 'SILVER', 'BRENT', 'COPPER', 'NATGAS', 'DXY', 'AUDUSD'],
};
const corrCache = new Map();
function sampled(id, freq) {
  const key = id + '|' + freq;
  if (corrCache.has(key)) return corrCache.get(key);
  const s = S[id]; let out;
  if (freq === 'D') out = { t: s.t, v: s.v };
  else {
    const m = new Map();
    for (let i = 0; i < s.t.length; i++) { const wk = Math.floor((s.t[i] / DAY + 3) / 7); m.set(wk, s.v[i]); }
    const t = [], v = [];
    for (const [wk, val] of m) { t.push((wk * 7 - 3 + 4) * DAY); v.push(val); }   // stamp on Friday
    out = { t, v };
  }
  corrCache.set(key, out); return out;
}
const isLogKind = id => S[id].kind === 'price' && S[id].unit !== 'USD tn';
function pairReturns(a, b, freq) {
  const key = a + '~' + b + '|' + freq;
  if (corrCache.has(key)) return corrCache.get(key);
  const A = sampled(a, freq), B = sampled(b, freq);
  const t = [], ra = [], rb = [];
  let i = 0, j = 0, pa = null, pb = null;
  const la = isLogKind(a), lb = isLogKind(b);
  while (i < A.t.length && j < B.t.length) {
    if (A.t[i] < B.t[j]) i++; else if (A.t[i] > B.t[j]) j++;
    else {
      const va = A.v[i], vb = B.v[j];
      if (pa != null) {
        t.push(A.t[i]);
        ra.push(la ? Math.log(va / pa) : va - pa);
        rb.push(lb ? Math.log(vb / pb) : vb - pb);
      }
      pa = va; pb = vb; i++; j++;
    }
  }
  // prefix sums for O(1) window correlation
  const n = t.length, P = { t, sa: new Float64Array(n + 1), sb: new Float64Array(n + 1), saa: new Float64Array(n + 1), sbb: new Float64Array(n + 1), sab: new Float64Array(n + 1) };
  for (let k = 0; k < n; k++) {
    P.sa[k + 1] = P.sa[k] + ra[k]; P.sb[k + 1] = P.sb[k] + rb[k];
    P.saa[k + 1] = P.saa[k] + ra[k] * ra[k]; P.sbb[k + 1] = P.sbb[k] + rb[k] * rb[k]; P.sab[k + 1] = P.sab[k] + ra[k] * rb[k];
  }
  corrCache.set(key, P); return P;
}
function upperIdx(t, x) { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] <= x) lo = m + 1; else hi = m; } return lo; }
function windowCorr(P, end, months) {
  const hi = upperIdx(P.t, end), lo = upperIdx(P.t, addMonths(end, -months));
  const n = hi - lo; if (n < 8) return { r: null, n };
  const sa = P.sa[hi] - P.sa[lo], sb = P.sb[hi] - P.sb[lo], saa = P.saa[hi] - P.saa[lo], sbb = P.sbb[hi] - P.sbb[lo], sab = P.sab[hi] - P.sab[lo];
  const cov = sab - sa * sb / n, va = saa - sa * sa / n, vb = sbb - sb * sb / n;
  return { r: va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null, n };
}
function avgCorr(P, end, months, years = 3) {
  let s = 0, k = 0;
  for (let m = 0; m < years * 12; m++) { const { r } = windowCorr(P, addMonths(end, -m), months); if (r != null) { s += r; k++; } }
  return k >= 12 ? s / k : null;
}
function corrSettings() {
  return { uni: $('#corrUniverse').value, months: +$('#corrWindow').value, freq: $('#corrFreq').value, show: $('#corrShow').value };
}
function renderCorrMatrix(c) {
  const { uni, months, freq, show } = corrSettings();
  const ids = UNIVERSES[uni].filter(id => has(id));
  if (ids.length < 2) return setEmpty(c, 'Not enough data loaded for this universe yet.');
  const wLab = $('#corrWindow').selectedOptions[0].text;
  c.titleEl.textContent = show === 'now' ? `Correlation matrix: ${uni}` : `Correlation change vs 3Y average: ${uni}`;
  c.subEl.textContent = `${freq === 'D' ? 'Daily' : 'Weekly'} returns, ${wLab} window ending ${nice(state.to)}.` + (show === 'chg' ? ' Blue = more positive than usual.' : '');
  const data = [], rows = [['', ...ids]];
  const shifts = [];
  for (let y = 0; y < ids.length; y++) {
    const row = [ids[y]];
    for (let x = 0; x < ids.length; x++) {
      let v = null, n = 0, now = null, avg = null;
      if (x === y) v = show === 'now' ? 1 : 0;
      else {
        const P = pairReturns(ids[y], ids[x], freq);
        ({ r: now, n } = windowCorr(P, state.to, months));
        if (show === 'chg' || x > y) avg = avgCorr(P, state.to, months);
        v = show === 'now' ? now : (now != null && avg != null ? now - avg : null);
        if (x > y && now != null && avg != null) shifts.push({ a: ids[y], b: ids[x], now, avg, d: now - avg });
      }
      data.push([x, y, v == null ? '-' : +v.toFixed(2), n]);
      row.push(v == null ? '' : v.toFixed(2));
    }
    rows.push(row);
  }
  const N = ids.length;
  c.chartEl.style.height = Math.max(320, N * 34 + 90) + 'px';
  const o = baseOpt();
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => {
    const [x, y, v, n] = p.value;
    return `<b style="font-variant-numeric:tabular-nums">${v === '-' ? 'n/a' : (v > 0 ? '+' : '') + v.toFixed(2)}</b> <span style="color:${tok('--ink-2')}">${esc(S[ids[y]].label)} vs ${esc(S[ids[x]].label)}${n ? ` · ${n} obs` : ''}</span>`;
  } };
  o.grid = { left: 8, right: 8, top: 8, bottom: 40, containLabel: true };
  o.xAxis = { type: 'category', data: ids, position: 'top', axisLabel: { color: tok('--ink-2'), fontSize: 11, rotate: 45, interval: 0 }, axisLine: { show: false }, axisTick: { show: false } };
  o.yAxis = { type: 'category', data: ids, inverse: true, axisLabel: { color: tok('--ink-2'), fontSize: 11, interval: 0 }, axisLine: { show: false }, axisTick: { show: false } };
  o.visualMap = { dimension: 2, min: -1, max: 1, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemWidth: 10, itemHeight: 160,
    text: ['+1', '−1'], textStyle: { color: tok('--muted'), fontSize: 11 }, inRange: { color: [tok('--neg'), tok('--mid'), tok('--pos')] } };
  o.series = [{ type: 'heatmap', data, label: { show: N <= 16, fontSize: 10, color: tok('--ink'), formatter: p => p.value[2] === '-' ? '' : p.value[2].toFixed(2).replace('-', '−') },
    itemStyle: { borderColor: tok('--surface'), borderWidth: 2, borderRadius: 3 }, emphasis: { itemStyle: { borderColor: tok('--ink'), borderWidth: 1 } } }];
  const ch = inst(c); ch.resize(); ch.setOption(o, true);
  c.csv = rows;
  setNote(c, 'Names: hover a cell for full labels. Diagonal = 1.');
  renderShifts(shifts);
}
function renderShifts(shifts) {
  const c = cards.shifts;
  c.chartEl.hidden = true; c.emptyEl.hidden = true;
  let ul = c.root.querySelector('.shifts'); if (!ul) { ul = el('ul', { class: 'shifts' }); c.root.insertBefore(ul, c.noteEl); }
  ul.replaceChildren();
  shifts.sort((p, q) => Math.abs(q.d) - Math.abs(p.d)).slice(0, 10).forEach(s => {
    ul.append(el('li', { title: 'Click to chart the rolling correlation', onclick: () => { state.corrA = s.a; state.corrB = s.b; syncPairSelects(); cards.pair.render(); cards.pair.root.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
      el('span', { text: `${S[s.a].label} vs ${S[s.b].label}` }),
      el('span', { class: 'num', text: `${fmtCorr(s.now)} now · ${fmtCorr(s.avg)} avg` }),
      el('b', { class: 'num', text: (s.d > 0 ? '+' : '−') + Math.abs(s.d).toFixed(2) })));
  });
  if (!shifts.length) ul.append(el('li', { text: 'Not enough history for this window.' }));
  c.csv = [['Pair', 'Now', '3Y avg', 'Change'], ...shifts.map(s => [`${s.a} vs ${s.b}`, s.now.toFixed(2), s.avg.toFixed(2), s.d.toFixed(2)])];
  setNote(c, 'Relationships that have moved furthest from their 3-year norm. Breakdowns like these are where relative-value and hedging ideas often start.');
}
const fmtCorr = v => (v < 0 ? '−' : '+') + Math.abs(v).toFixed(2);
function allIdsSorted() { return Object.keys(S).filter(id => S[id].t.length > 30 && !/^FX_/.test(id)).sort((a, b) => S[a].label.localeCompare(S[b].label)); }
function syncPairSelects() {
  const c = cards.pair;
  for (const [sel, key] of [[c.selA, 'corrA'], [c.selB, 'corrB']]) {
    const ids = allIdsSorted();
    if (sel.options.length !== ids.length) { sel.replaceChildren(...ids.map(id => el('option', { value: id, text: S[id].label }))); }
    sel.value = has(state[key]) ? state[key] : ids[0];
    state[key] = sel.value;
  }
}
function renderPair(c) {
  syncPairSelects();
  const { months, freq } = corrSettings();
  const a = state.corrA, b = state.corrB;
  if (!has(a, b) || a === b) return setEmpty(c, 'Pick two different series.');
  const P = pairReturns(a, b, freq);
  const lo = upperIdx(P.t, state.from - 1), hi = upperIdx(P.t, state.to);
  const data = [];
  for (let k = lo; k < hi; k++) { const { r } = windowCorr(P, P.t[k], months); if (r != null) data.push([P.t[k], r]); }
  const wLab = $('#corrWindow').selectedOptions[0].text;
  c.titleEl.textContent = `Rolling correlation: ${S[a].label} vs ${S[b].label}`;
  c.subEl.textContent = `${wLab} rolling window, ${freq === 'D' ? 'daily' : 'weekly'} returns. Window, frequency and universe are set above.`;
  if (!data.length) return setEmpty(c, 'Not enough overlapping history in this range.');
  const mean = data.reduce((s, p) => s + p[1], 0) / data.length;
  drawLines(c, [{ name: `${S[a].label} vs ${S[b].label}`, data }], { fmt: v => fmtCorr(v), axisFmt: v => v.toFixed(1), zero: true, yExtra: { min: -1, max: 1, scale: false }, endLabels: false });
  inst(c).setOption({ series: [{ markLine: { silent: true, symbol: 'none', data: [{ yAxis: 0, lineStyle: { color: tok('--axis'), type: 'solid' }, label: { show: false } },
    { yAxis: +mean.toFixed(3), lineStyle: { color: tok('--muted'), type: 'dashed' }, label: { formatter: `avg ${fmtCorr(mean)}`, color: tok('--muted'), position: 'insideEndTop', fontSize: 11 } }] } }] });
  let hint = '';
  const yieldish = id => S[id].kind === 'yield';
  if ((yieldish(a) && S[b].kind === 'price' && S[b].group && S[b].group.startsWith('Equities')) || (yieldish(b) && S[a].kind === 'price' && S[a].group && S[a].group.startsWith('Equities')))
    hint = ' Equities vs yield changes: positive means stocks and yields rise together, so bonds are hedging equities. Negative means bonds and stocks are selling off together, as in 2022.';
  setNote(c, `Latest ${fmtCorr(data[data.length - 1][1])}, range average ${fmtCorr(mean)}.` + hint);
}
function buildCorrelation() {
  const u = $('#corrUniverse');
  Object.keys(UNIVERSES).forEach(k => u.append(el('option', { value: k, text: k })));
  const mc = { root: $('#corrMatrixCard') }, sc = { root: $('#corrShiftsCard') }, pc = { root: $('#corrPairCard') };
  // reuse makeCard into placeholders
  const host = (ph, opts) => { const tmp = el('div'); const c = makeCard(tmp, opts); ph.root.replaceWith(c.root); return c; };
  host(mc, { key: 'matrix', title: 'Correlation matrix', source: 'Yahoo Finance, FRED', render: renderCorrMatrix });
  host(sc, { key: 'shifts', title: 'Biggest shifts vs 3-year norm', sub: 'Pairs in this universe, same window. Click one to chart it.', source: 'Yahoo Finance, FRED', render: () => cards.matrix.render() });
  const p = host(pc, { key: 'pair', title: 'Rolling correlation', wide: true, source: 'Yahoo Finance, FRED', render: renderPair });
  p.selA = el('select', { 'aria-label': 'Series A' }); p.selB = el('select', { 'aria-label': 'Series B' });
  p.selA.addEventListener('change', () => { state.corrA = p.selA.value; p.render(); });
  p.selB.addEventListener('change', () => { state.corrB = p.selB.value; p.render(); });
  p.root.querySelector('.card-head').after(el('div', { class: 'pairsel' }, p.selA, el('span', { class: 'muted', text: 'vs' }), p.selB));
  ['#corrUniverse', '#corrWindow', '#corrFreq', '#corrShow'].forEach(s => $(s).addEventListener('change', renderCorrelation));
}
function renderCorrelation() { cards.matrix.render(); cards.pair.render(); }

// ------------------------------------------------------------------ range, tabs, theme
function applyPreset(p) {
  state.preset = p;
  const to = state.latest;
  const map = { '1M': -1, '3M': -3, '6M': -6, '1Y': -12, '3Y': -36, '5Y': -60, '10Y': -120 };
  state.to = to;
  state.from = p === 'YTD' ? Date.UTC(new Date(to).getUTCFullYear() - 1, 11, 31) : p === 'MAX' ? state.earliest : addMonths(to, map[p]);
}
function syncFilterUI() {
  document.querySelectorAll('#presets button').forEach(b => b.classList.toggle('on', b.dataset.p === state.preset));
  $('#fromDate').value = iso(state.from); $('#toDate').value = iso(state.to);
  $('#fromDate').max = $('#toDate').max = iso(state.latest);
  $('#fromDate').min = $('#toDate').min = iso(state.earliest);
  const h = new URLSearchParams({ tab: state.tab, ...(state.preset === 'custom' ? { from: iso(state.from), to: iso(state.to) } : { range: state.preset }) });
  history.replaceState(null, '', '#' + h.toString());
}
function renderTab() {
  syncFilterUI();
  ({ liquidity: renderLiquidity, markets: renderMarkets, correlation: renderCorrelation })[state.tab]();
}
function setTab(t) {
  state.tab = t;
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  document.querySelectorAll('.tab-panel').forEach(p => p.hidden = p.id !== 'tab-' + t);
  renderTab();
}
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
function wire() {
  document.querySelectorAll('#presets button').forEach(b => b.addEventListener('click', () => { applyPreset(b.dataset.p); renderTab(); }));
  const onDate = () => {
    const f = Date.parse($('#fromDate').value), t = Date.parse($('#toDate').value);
    if (isNaN(f) || isNaN(t) || f >= t) return;
    state.preset = 'custom'; state.from = f; state.to = Math.min(t, state.latest); renderTab();
  };
  $('#fromDate').addEventListener('change', onDate); $('#toDate').addEventListener('change', onDate);
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
  $('#themeBtn').addEventListener('click', () => {
    const next = isDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('sd-theme', next); } catch (e) {}
    renderTab();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderTab);
  let rt; addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => Object.values(cards).forEach(c => c.inst && c.inst.resize()), 120); });
}
async function loadJSON(p) { const r = await fetch(p, { cache: 'no-cache' }); if (!r.ok) throw new Error(p + ' ' + r.status); return r.json(); }
async function init() {
  const [meta, y, f, d] = await Promise.allSettled(['data/meta.json', 'data/yahoo.json', 'data/fred.json', 'data/derived.json'].map(loadJSON));
  META = meta.status === 'fulfilled' ? meta.value : {};
  for (const res of [y, f, d]) if (res.status === 'fulfilled') {
    for (const [id, s] of Object.entries(res.value)) { S[id] = { id, ...s, t: s.d.map(x => x * DAY), v: s.v }; delete S[id].d; }
  }
  const lasts = Object.values(S).filter(s => (s.group || '').startsWith('Equities') || s.id === 'NET_LIQ').map(s => s.t[s.t.length - 1]).filter(Boolean);
  state.latest = lasts.length ? Math.max(...lasts) : Date.now();
  $('#asof').textContent = `Data to ${nice(state.latest)}` + (META.updated_utc ? ` · refreshed ${META.updated_utc}` : '');
  const fredOk = has('NET_LIQ');
  const pill = $('#status');
  if (META.total) {
    pill.hidden = false;
    pill.textContent = fredOk ? `${META.ok}/${META.total} series live` : `${META.ok}/${META.total} series · FRED pending`;
    pill.title = Object.entries(META.status || {}).filter(([, v]) => v !== 'ok').map(([k, v]) => `${k}: ${v}`).join('\n') || 'All series refreshed';
  }
  // restore view from URL
  const h = new URLSearchParams(location.hash.slice(1));
  applyPreset(['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'].includes(h.get('range')) ? h.get('range') : '3Y');
  if (h.get('from') && h.get('to')) {
    const fr = Date.parse(h.get('from')), to = Date.parse(h.get('to'));
    if (!isNaN(fr) && !isNaN(to) && fr < to) { state.preset = 'custom'; state.from = fr; state.to = Math.min(to, state.latest); }
  }
  buildLiquidity(); buildMarkets(); buildCorrelation(); wire();
  setTab(['liquidity', 'markets', 'correlation'].includes(h.get('tab')) ? h.get('tab') : 'liquidity');
}
init();
