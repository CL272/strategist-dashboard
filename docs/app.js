/* Strategist Dashboard. Plain JS + ECharts, no build step. */
'use strict';

const DAY = 864e5;
const S = {};                 // series store: id -> {id,label,group,kind,unit,source,note,t:[ms],v:[]}
let META = {};
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
const state = {
  tab: 'overview', preset: '3Y', from: null, to: null, latest: null, earliest: Date.UTC(2005, 0, 1),
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
  c.srcEl = el('p', { class: 'src' });
  c.range = o.defaultRange ? { preset: o.defaultRange } : null;   // null = follow the top date bar
  c.rangeEl = o.range === false ? null : buildCardRange(c);
  c.root = el('div', { class: 'card' + (o.wide ? ' wide' : '') + (o.tall ? ' tall' : '') },
    el('div', { class: 'card-head' }, el('div', {}, c.titleEl, c.subEl), tools),
    c.chartEl, c.emptyEl, c.rangeEl, c.noteEl, c.srcEl);
  parent.append(c.root);
  setSource(c, o.source || '');
  c.render = () => {
    const keep = [state.from, state.to];
    if (c.range) [state.from, state.to] = resolveRange(c.range);
    c.lastRange = [state.from, state.to];
    try { o.render(c); } catch (e) { console.error(o.key, e); setEmpty(c, 'Could not draw this chart.'); }
    finally { [state.from, state.to] = keep; }
    if (c.rangeEl) syncCardRange(c);
  };
  cards[o.key] = c;
  return c;
}
function setSource(c, txt) { c.source = txt; c.srcEl.textContent = txt ? 'Source: ' + txt : ''; c.srcEl.hidden = !txt; }
function srcOf(ids) {   // merge "Provider (detail)" sources: Yahoo Finance (A), Yahoo Finance (B) -> Yahoo Finance (A, B)
  const by = new Map();
  for (const id of ids) {
    const src = S[id] && S[id].source; if (!src) continue;
    const m = src.match(/^(.*?)\s*\((.*)\)\s*(.*)$/);
    const prov = m ? m[1] + (m[3] ? ' ' + m[3] : '') : src, det = m ? m[2] : '';
    if (!by.has(prov)) by.set(prov, []);
    if (det && !by.get(prov).includes(det)) by.get(prov).push(det);
  }
  return [...by.entries()].map(([p, d]) => d.length ? `${p} (${d.join('; ')})` : p).join('; ');
}
const RANGE_PRESETS = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'];
function presetFrom(p, to) {
  const map = { '1M': -1, '3M': -3, '6M': -6, '1Y': -12, '3Y': -36, '5Y': -60, '10Y': -120 };
  return p === 'YTD' ? Date.UTC(new Date(to).getUTCFullYear() - 1, 11, 31) : p === 'MAX' ? state.earliest : addMonths(to, map[p]);
}
function resolveRange(r) {
  if (r.preset) return [presetFrom(r.preset, state.to), state.to];
  return [r.from, Math.min(r.to, state.latest)];
}
function buildCardRange(c) {
  const row = el('div', { class: 'card-range', role: 'group', 'aria-label': 'Date range for this chart' });
  const seg = el('div', { class: 'presets mini' });
  for (const p of RANGE_PRESETS) seg.append(el('button', { type: 'button', text: p === 'MAX' ? 'Max' : p, 'data-p': p,
    onclick: () => { c.range = { preset: p }; c.render(); } }));
  const f = el('input', { type: 'date', 'aria-label': 'From' }), t = el('input', { type: 'date', 'aria-label': 'To' });
  const onDate = () => { const a = Date.parse(f.value), b = Date.parse(t.value); if (!isNaN(a) && !isNaN(b) && a < b) { c.range = { from: a, to: b }; c.render(); } };
  f.addEventListener('change', onDate); t.addEventListener('change', onDate);
  const reset = el('button', { type: 'button', class: 'ghost reset', text: '↺ Top bar', title: 'Follow the date bar at the top of the page',
    onclick: () => { c.range = null; c.render(); } });
  row.append(seg, el('span', { class: 'custom' }, f, el('span', { class: 'muted', text: '–' }), t), reset,
    el('span', { class: 'muted small zoom-hint', text: 'Tip: drag across the chart to zoom' }));
  c.rangeParts = { seg, f, t, reset };
  return row;
}
function syncCardRange(c) {
  const { seg, f, t, reset } = c.rangeParts, [a, b] = c.lastRange;
  const active = c.range ? (c.range.preset || 'custom') : (state.preset || 'custom');
  seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.p === active));
  f.value = iso(a); t.value = iso(b); f.max = t.max = iso(state.latest);
  reset.hidden = !c.range;
  c.root.classList.toggle('own-range', !!c.range);
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
// two series on different scales: one chart with left/right axes (default) or stacked panels
function drawPair(c, A, B, { fmtA, fmtB, axisA, axisB, zeroA = false, zeroB = false } = {}) {
  const ca = A.color || col(0), cb = B.color || col(1), overlay = c.pairMode !== 'stack';
  const o = baseOpt();
  o.legend.show = true;
  const sa = line(A.name, A.data, ca), sb = line(B.name, B.data, cb, { yAxisIndex: 1, xAxisIndex: overlay ? 0 : 1 });
  if (zeroA) sa.markLine = zeroLine();
  if (zeroB) sb.markLine = zeroLine();
  const tint = (axis, color) => { axis.axisLabel = { ...axis.axisLabel, color }; axis.axisLine = { show: true, lineStyle: { color, width: 2 } }; return axis; };
  if (overlay) {
    o.grid = { left: 8, right: 8, top: 34, bottom: 8, containLabel: true };
    o.xAxis = timeAxis();
    o.yAxis = [tint(valAxis(axisA), ca), tint(valAxis(axisB, { position: 'right', splitLine: { show: false } }), cb)];
  } else {
    o.grid = [{ left: 8, right: 16, top: 34, height: '40%', containLabel: true }, { left: 8, right: 16, top: '58%', bottom: 8, containLabel: true }];
    o.axisPointer = { link: [{ xAxisIndex: 'all' }] };
    o.xAxis = [timeAxis({ gridIndex: 0, axisLabel: { show: false } }), timeAxis({ gridIndex: 1 })];
    o.yAxis = [valAxis(axisA, { gridIndex: 0 }), valAxis(axisB, { gridIndex: 1 })];
  }
  o.tooltip.formatter = tipFormatter((v, n) => n === A.name ? fmtA(v) : fmtB(v));
  o.series = [sa, sb];
  setZoomable(c, o);
  c.csv = toCSV([A, B]);
}
function pairToggle(c) {   // card tool: switch between one chart with two axes and stacked panels
  c.pairMode = 'overlay';
  const b = el('button', { class: 'ghost', type: 'button', text: '⇅ Stack', title: 'Switch between one chart with two axes and two stacked panels' });
  b.addEventListener('click', () => { c.pairMode = c.pairMode === 'stack' ? 'overlay' : 'stack'; b.textContent = c.pairMode === 'stack' ? '⇅ Overlay' : '⇅ Stack'; c.render(); });
  c.root.querySelector('.card-tools').prepend(b);
}
// drag a box across a time chart to zoom: sets this chart's own date range (↺ resets)
function setZoomable(c, o) {
  // the zoom tool must exist (show: true) for drag-select to work; it is made invisible instead
  o.toolbox = { show: true, right: -200, top: -200, itemSize: 1, feature: { dataZoom: { yAxisIndex: 'none', filterMode: 'none',
    brushStyle: { color: hexA(tok('--accent'), 0.12), borderColor: tok('--accent'), borderWidth: 1 } } } };
  const ch = inst(c);
  ch.setOption(o, true);
  ch.off('datazoom');
  ch.dispatchAction({ type: 'takeGlobalCursor', key: 'dataZoomSelect', dataZoomSelectActive: true });
  ch.on('datazoom', e => {
    const dz = (e.batch || [e]).find(d => d.startValue != null && d.endValue != null);
    if (!dz) return;
    const a = Math.round(dz.startValue), b = Math.round(dz.endValue);
    if (b - a < 2 * DAY) return;
    c.range = { from: a, to: b };
    setTimeout(() => c.render(), 0);
  });
}
function drawLines(c, list, { fmt = v => fmtNum(v, autoDec(v)), axisFmt, zero = false, yExtra = {}, endLabels = true, hlines = [], areas = null } = {}) {
  const series = list.map((s, i) => line(s.name, s.data, s.color || col(i), s.extra || {}));
  if ((zero || hlines.length) && series.length) {
    const ml = zeroLine();
    if (!zero) ml.data = [];
    for (const h of hlines) ml.data.push({ yAxis: h.y, lineStyle: { color: tok('--muted'), type: 'dashed', width: 1 },
      label: { show: true, formatter: h.label, color: tok('--muted'), position: 'insideStartTop', fontSize: 11 } });
    series[0].markLine = ml;
  }
  if (areas && areas.length && series.length) {
    series[0].markArea = { silent: true, data: areas.map(([a, b, color, name]) => [{ xAxis: a, itemStyle: { color }, name: name || '' }, { xAxis: b }]),
      label: { show: false } };
  }
  const o = baseOpt();
  const pad = endLabels ? withEndLabels(series) : 0;
  o.grid.right = 16 + pad;
  o.legend.show = series.length > 1;
  o.grid.top = series.length > 1 ? 34 : 14;
  o.tooltip.formatter = tipFormatter(fmt);
  o.xAxis = timeAxis();
  o.yAxis = valAxis(axisFmt || (v => fmtNum(v, autoDec(v))), yExtra);
  o.series = series;
  setZoomable(c, o);
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
function rangeLabel(c) { const [a, b] = (c && c.lastRange) || [state.from, state.to]; return `${nice(a)} – ${nice(b)}`; }
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
  g.fillText(`Source: ${c.source || 'see dashboard'} · ${rangeLabel(c)}`, pad, cv.height - 24);
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
    c.subEl.textContent = 'Fed total assets − Treasury General Account − overnight reverse repo (weekly), against the S&P 500.';
    const a = pts(nl, from, to), b = spx ? pts(spx, from, to) : [];
    drawPair(c, { name: 'Fed net liquidity', data: a }, { name: 'S&P 500', data: b },
      { fmtA: v => '$' + fmtNum(v, 2) + 'tn', fmtB: v => fmtNum(v, 0), axisA: v => '$' + fmtNum(v, 1) + 'tn', axisB: v => fmtNum(v, 0) });
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
  setZoomable(c, o);
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
state.creditMode = 'us';
function renderCredit(c) {
  const sets = {
    us: [['HY_OAS_BP', 'IG_OAS_BP'], 'US option-adjusted spreads over Treasuries, bp (ICE BofA).'],
    global: [['HY_OAS_BP', 'EUR_HY_OAS_BP', 'ASIA_CORP_OAS_BP'], 'High yield in the US and euro area vs Asia EM corporates, bp (ICE BofA).'],
    long: [['BAA_10Y_BP'], 'Moody\'s Baa corporate yield minus 10Y Treasury, bp. Full history back to 1986 (pick Max).'],
  };
  const [ids, sub] = sets[state.creditMode];
  c.subEl.textContent = sub;
  setSource(c, { us: 'ICE BofA via FRED (BAMLH0A0HYM2 US HY, BAMLC0A0CM US IG); archived by this dashboard', global: 'ICE BofA via FRED (BAMLH0A0HYM2 US HY, BAMLHE00EHYIOAS Euro HY, BAMLEMRACRPIASIAOAS Asia EM corporate); archived by this dashboard', long: "Moody's via FRED (BAA10Y)" }[state.creditMode]);
  simple(ids, v => fmtNum(v, 0) + 'bp', v => fmtNum(v, 0) + 'bp')(c);
  if (state.creditMode !== 'long' && has('HY_OAS_BP')) {
    setNote(c, `FRED keeps only 3 years of ICE BofA spreads. This dashboard archives them from ${nice(S.HY_OAS_BP.t[0])} onwards; use Long history for stress comparisons with 2008 or 2020.`);
  }
}
function renderScarcity(c) {
  const ids = ['RES_GDP', 'RES_ASSETS'].filter(id => has(id));
  if (!ids.length) return setEmpty(c, NO_FRED);
  drawLines(c, ids.map((id, i) => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(i) })),
    { fmt: v => fmtNum(v, 1) + '%', axisFmt: v => fmtNum(v, 0) + '%' });
  const parts = ids.map(id => {
    const s = S[id], a = asOf(s, state.to); if (!a) return '';
    const hist = s.v.slice(0, a.i + 1).filter(x => x != null), below = hist.filter(x => x <= a.v).length;
    return `${s.label} ${fmtNum(a.v, 1)}% (${Math.round(below / hist.length * 100)}th percentile since ${new Date(s.t[0]).getUTCFullYear()})`;
  }).filter(Boolean);
  setNote(c, parts.join(' · '));
}
function renderRates(c) {
  if (state.ratesMode === 'curve') {
    c.subEl.textContent = 'Yield curve spreads. Below zero = inverted.';
    setSource(c, 'FRED (T10Y2Y, T10Y3M)');
    return simple(['CURVE_2s10s', 'CURVE_3m10y'], v => fmtNum(v * 100, 0) + 'bp', v => fmtNum(v * 100, 0) + 'bp', { zero: true })(c);
  }
  c.subEl.textContent = 'Nominal yields, 10Y real yield (TIPS) and 10Y breakeven inflation.';
  setSource(c, srcOf(['UST2Y', 'UST10Y', 'REAL10Y', 'BE10Y']));
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
  makeCard(g, { key: 'credit', title: 'Credit spreads', source: 'FRED (ICE BofA, Moody\'s)',
    seg: { key: 'creditMode', options: [['us', 'US'], ['global', 'Global'], ['long', 'Long history']] }, render: renderCredit });
  makeCard(g, { key: 'scarcity', title: 'Reserve scarcity', source: 'FRED (WRESBAL, GDP, TLAACBW027SBOG)',
    sub: 'Bank reserves as a share of nominal GDP and of commercial bank assets. When these ratios fall, reserves move from abundant towards scarce, and repo spreads (above) tend to react.',
    render: renderScarcity });
  makeCard(g, { key: 'nfci', title: 'Chicago Fed financial conditions (NFCI)', sub: 'Weekly. Below zero = looser than the long-run average.', source: 'FRED (NFCI)',
    render: simple(['NFCI'], v => fmtNum(v, 2), v => fmtNum(v, 2), { zero: true }) });
  makeCard(g, { key: 'm2', title: 'US M2 money supply growth', sub: 'Year-on-year %, monthly.', source: 'FRED (M2SL)',
    render: simple(['M2_YOY'], v => fmtNum(v, 1) + '%', v => fmtNum(v, 1) + '%', { zero: true }) });
  makeCard(g, { key: 'rates', title: 'US Treasury yields', source: 'FRED',
    seg: { key: 'ratesMode', options: [['yields', 'Yields'], ['curve', 'Curve']] }, render: renderRates });
}
function renderLiquidity() {
  liquidityKpis(); liquiditySignals();
  ['netliq', 'comp', 'fund', 'scarcity', 'gcb', 'credit', 'nfci', 'm2', 'rates'].forEach(k => cards[k].render());
}

// ------------------------------------------------------------------ OVERVIEW (Strategist View)
const LOCAL_CCY = { SX5E: 'EUR', DAX: 'EUR', CAC: 'EUR', UKX: 'GBP', NKY: 'JPY', AS51: 'AUD', CSI300: 'CNY', SHCOMP: 'CNY',
  HSI: 'HKD', HSCEI: 'HKD', STI: 'SGD', KLCI: 'MYR', JCI: 'IDR', KOSPI: 'KRW', TWSE: 'TWD', NIFTY: 'INR', IBOV: 'BRL' };
const USD_PER = { EUR: ['EURUSD', 1], GBP: ['GBPUSD', 1], AUD: ['AUDUSD', 1], JPY: ['USDJPY', -1], CNY: ['USDCNY', -1], HKD: ['USDHKD', -1],
  SGD: ['USDSGD', -1], MYR: ['USDMYR', -1], IDR: ['USDIDR', -1], KRW: ['USDKRW', -1], TWD: ['USDTWD', -1], INR: ['USDINR', -1], BRL: ['USDBRL', -1] };
const OV_EQ = ['SPX', 'NDX', 'SX5E', 'UKX', 'NKY', 'CSI300', 'HSI', 'KOSPI', 'TWSE', 'STI', 'KLCI', 'JCI', 'NIFTY', 'AS51', 'IBOV'];
const OV_ROWS = [
  ['Equities', OV_EQ.concat(['EEM'])],
  ['Rates & credit', ['UST2Y', 'UST10Y', 'REAL10Y', 'CURVE_2s10s', 'JGB10Y', 'EA10Y', 'CN_10Y', 'SGS10Y', 'SORA3M', 'HY_OAS', 'BAA_10Y']],
  ['FX', ['DXY', 'EURUSD', 'USDJPY', 'USDCNY', 'USDSGD', 'USDMYR', 'AUDUSD']],
  ['Commodities & crypto', ['GOLD', 'BRENT', 'COPPER', 'BTC']],
  ['Volatility', ['VIX', 'MOVE']],
];
const STRESS = [  // [id, label, higher = more stress]
  ['VIX', 'VIX (equity vol)'], ['MOVE', 'MOVE (rates vol)'], ['BAA_10Y_BP', 'Baa − 10Y spread'], ['HY_OAS_BP', 'US HY spread'],
  ['NFCI', 'Chicago Fed NFCI'], ['STLFSI', 'St. Louis Fed stress'], ['SOFR_IORB', 'SOFR − IORB'],
];
state.ovCcy = 'local'; state.ovHorizon = 'W';
const convCache = new Map();
function usdPerUnit(ccy, t) {
  if (ccy === 'USD') return 1;
  const [id, dir] = USD_PER[ccy] || []; if (!id || !has(id)) return null;
  const a = asOf(S[id], t); if (!a || t - a.t > 7 * DAY) return null;
  return dir > 0 ? a.v : 1 / a.v;
}
function inCcy(id, target) {   // equity series expressed in target currency ('local' = unchanged); unlisted = USD
  const ccy = LOCAL_CCY[id] || 'USD';
  if (target === 'local' || ccy === target) return S[id];
  const key = id + '@' + target;
  if (convCache.has(key)) return convCache.get(key);
  const s = S[id], t = [], v = [];
  for (let i = 0; i < s.t.length; i++) {
    const a = usdPerUnit(ccy, s.t[i]), b = target === 'USD' ? 1 : usdPerUnit(target, s.t[i]);
    if (a != null && b != null) { t.push(s.t[i]); v.push(s.v[i] * a / b); }
  }
  const out = { ...s, id: key, t, v };
  convCache.set(key, out); return out;
}
function ma(s, i, n) { if (i < n - 1) return null; let x = 0; for (let k = i - n + 1; k <= i; k++) x += s.v[k]; return x / n; }
// z-score of the latest h-week change vs the previous 5 years of h-week changes
function moveZ(id, h) {
  const s = S[id], W = sampled(id, 'W');
  const k = upperIdx(W.t, state.to) - 1; if (k < h + 110) return null;
  const f = s.kind === 'price' ? (a, b) => Math.log(b / a) : (a, b) => b - a;
  const now = f(W.v[k - h], W.v[k]);
  const hist = []; for (let j = Math.max(h, k - 260); j < k; j++) hist.push(f(W.v[j - h], W.v[j]));
  const m = hist.reduce((a, b) => a + b, 0) / hist.length, sd = Math.sqrt(hist.reduce((a, b) => a + (b - m) ** 2, 0) / (hist.length - 1));
  if (!(sd > 0)) return null;
  const disp = s.kind === 'price' ? (Math.exp(now) - 1) * 100 : s.kind === 'yield' ? now * 100 : now;
  return { id, z: (now - m) / sd, chg: disp, t: W.t[k] };
}
function movers(h) {
  const ids = Object.keys(S).filter(id => (S[id].source || '').startsWith('Yahoo') || PERF_FRED.concat(['EUR_HY_OAS', 'ASIA_CORP_OAS', 'BAA_10Y', 'FWD5Y5Y']).includes(id));
  return ids.filter(id => has(id)).map(id => moveZ(id, h)).filter(Boolean).sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}
function pctRank(s, to, years = 10) {
  const a = asOf(s, to); if (!a) return null;
  const lo = idxLE(s, addMonths(a.t, -12 * years)) + 1;
  let n = 0, below = 0;
  for (let i = Math.max(0, lo); i <= a.i; i++) { n++; if (s.v[i] <= a.v) below++; }
  return n > 50 ? { p: below / n * 100, v: a.v, t: a.t, since: s.t[Math.max(0, lo)] } : null;
}
function stressRows() {
  return STRESS.filter(([id]) => has(id)).map(([id, label]) => ({ id, label, ...pctRank(S[id], state.to) })).filter(r => r.p != null);
}
function stressBand(p) {
  return p >= 95 ? ['critical', 'Extreme', '▲▲ '] : p >= 80 ? ['serious', 'High', '▲ '] : p >= 50 ? ['warning', 'Elevated', ''] : ['good', 'Calm', ''];
}
function htmlBody(c) {
  c.chartEl.hidden = true; c.emptyEl.hidden = true;
  let b = c.root.querySelector('.html-body');
  if (!b) { b = el('div', { class: 'html-body' }); c.root.insertBefore(b, c.noteEl); }
  b.replaceChildren(); return b;
}
function fmtMove(s, c) {
  if (s.kind === 'price') return sign(c) + fmtNum(Math.abs(c), Math.abs(c) >= 10 ? 1 : 2) + '%';
  if (s.kind === 'yield') return sign(c) + fmtNum(Math.abs(c), 0) + 'bp';
  return sign(c) + fmtNum(Math.abs(c), 2);
}
function renderMoved(c) {
  const h = state.ovHorizon === 'W' ? 1 : 4;
  const list = movers(h).slice(0, 14);
  if (!list.length) return setEmpty(c, 'Not enough history yet.');
  c.subEl.textContent = `Biggest ${h === 1 ? '1-week' : '4-week'} moves to ${nice(list[0].t)}, ranked by how unusual they are: each move is measured in standard deviations (σ) of that asset's own ${h === 1 ? 'weekly' : '4-week'} moves over the past 5 years.`;
  const rows = list.slice().reverse();
  const o = baseOpt();
  o.legend.show = false;
  o.grid = { left: 8, right: 60, top: 8, bottom: 8, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => { const r = rows[p.dataIndex];
    return `<b>${esc(fmtMove(S[r.id], r.chg))}</b> <span style="color:${tok('--ink-2')}">${esc(S[r.id].label)}</span><br>${zf(r.z)}σ vs its 5-year history`; } };
  o.xAxis = { type: 'value', axisLabel: { color: tok('--muted'), formatter: v => v + 'σ', fontSize: 11 }, splitLine: { lineStyle: { color: tok('--grid') } } };
  o.yAxis = { type: 'category', data: rows.map(r => `${S[r.id].label}  ${fmtMove(S[r.id], r.chg)}`), axisLabel: { color: tok('--ink-2'), fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } };
  o.series = [{ type: 'bar', barWidth: '62%', data: rows.map(r => ({ value: +r.z.toFixed(2), itemStyle: { color: r.z >= 0 ? tok('--pos') : tok('--neg'), borderRadius: r.z >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
    label: { show: true, position: 'right', formatter: p => zf(p.value) + 'σ', color: tok('--ink-2'), fontSize: 11 } }];
  c.chartEl.style.height = Math.max(300, rows.length * 26 + 30) + 'px';
  const ch = inst(c); ch.resize(); ch.setOption(o, true);
  c.csv = [['Asset', 'Change', 'z-score'], ...list.map(r => [S[r.id].label, r.chg.toFixed(2), r.z.toFixed(2)])];
  setNote(c, 'Blue = up, red = down (for yields and spreads, up = higher yield). A ±2σ move happens roughly 1 week in 20.');
}
function renderFragile(c) {
  const rows = stressRows();
  const b = htmlBody(c);
  if (!rows.length) { b.append(el('div', { class: 'empty', text: NO_FRED })); c.csv = null; return; }
  const comp = rows.reduce((a, r) => a + r.p, 0) / rows.length;
  const [st, lab, icon] = stressBand(comp);
  b.append(el('div', { class: 'fragile-head' },
    el('span', { class: 'big', text: `${Math.round(comp)}th` }),
    el('span', { class: 'status', style: `--st:${tok('--' + st)}` }, el('span', { class: 'dot' }), `${icon}${lab}`),
    el('span', { class: 'muted small', text: `average percentile of ${rows.length} stress gauges vs their last 10 years` })));
  for (const r of rows.sort((x, y) => y.p - x.p)) {
    const [rs] = stressBand(r.p);
    b.append(el('div', { class: 'pbar', title: `${r.label}: ${fmtNum(r.v, 2)} on ${nice(r.t)}, higher than ${Math.round(r.p)}% of readings since ${nice(r.since)}` },
      el('span', { class: 'pl', text: r.label }),
      el('span', { class: 'track' }, el('span', { class: 'fill', style: `width:${r.p.toFixed(1)}%;background:${tok('--' + rs)}` })),
      el('span', { class: 'pv', text: `${Math.round(r.p)}` })));
  }
  c.csv = [['Gauge', 'Value', 'Percentile (10y)', 'As of'], ...rows.map(r => [r.label, r.v, r.p.toFixed(1), iso(r.t)])];
  setNote(c, 'Percentile = share of the last 10 years with a lower reading (100 = most stressed). Bands: Calm < 50, Elevated 50–80, High 80–95, Extreme ≥ 95. HY spread history is short (FRED keeps 3 years).');
}
function sparkSVG(s, from, to) {
  const p = pts(s, from, to); if (p.length < 2) return null;
  const W = 84, H = 22, xs = p.map(d => d[0]), ys = p.map(d => d[1]);
  const x0 = xs[0], x1 = xs[xs.length - 1], y0 = Math.min(...ys), y1 = Math.max(...ys);
  const d = p.map(([x, y]) => `${((x - x0) / (x1 - x0 || 1) * W).toFixed(1)},${(H - 2 - (y - y0) / (y1 - y0 || 1) * (H - 4)).toFixed(1)}`).join(' ');
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', W); svg.setAttribute('height', H); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('aria-hidden', 'true');
  const pl = document.createElementNS(ns, 'polyline');
  pl.setAttribute('points', d); pl.setAttribute('fill', 'none'); pl.setAttribute('stroke', tok('--ink-2')); pl.setAttribute('stroke-width', '1.5');
  svg.append(pl); return svg;
}
function renderWhere(c) {
  const b = htmlBody(c);
  const tgt = state.ovCcy;
  const cols = [['1W', t => t - 7 * DAY], ['1M', t => addMonths(t, -1)], ['3M', t => addMonths(t, -3)],
    ['YTD', t => Date.UTC(new Date(t).getUTCFullYear() - 1, 11, 31)], ['12M', t => addMonths(t, -12)]];
  const tbl = el('table', { class: 'perf' });
  const hr = el('tr', {}, el('th', { text: 'Asset' }), el('th', { text: 'Last' }));
  cols.forEach(([k]) => hr.append(el('th', { text: k })));
  hr.append(el('th', { text: 'vs 200d', title: 'Distance from the 200-day moving average (prices only)' }), el('th', { text: '1W σ', title: 'This week’s move in standard deviations of its 5-year weekly moves' }), el('th', { text: '3M' }));
  tbl.append(el('thead', {}, hr));
  const tb = el('tbody'), csv = [['Group', 'Asset', 'Last', ...cols.map(c => c[0]), 'vs 200d %', '1W z']];
  const pos = tok('--pos'), neg = tok('--neg');
  const scale = { price: [2, 4, 8, 10, 15], yield: [10, 25, 50, 60, 80], level: [2, 4, 6, 6, 8] };
  for (const [g, ids] of OV_ROWS) {
    const ok = ids.filter(id => has(id)); if (!ok.length) continue;
    tb.append(el('tr', { class: 'grp' }, el('td', { colspan: cols.length + 5, text: g + (g === 'Equities' && tgt !== 'local' ? ` · in ${tgt}` : '') })));
    for (const id of ok) {
      const s0 = S[id], s = g === 'Equities' ? inCcy(id, tgt) : s0;
      const a = asOf(s, state.to); if (!a) continue;
      const tr = el('tr', { class: 'row', title: `${s0.source} · last ${nice(a.t)}` },
        el('td', { text: s0.label + (s !== s0 ? ` (${tgt})` : '') }),
        el('td', { text: s0.kind === 'yield' ? fmtNum(a.v, 2) + '%' : fmtVal(s0, a.v) }));
      const row = [g, s0.label, a.v];
      cols.forEach(([k, fn], j) => {
        const bb = asOf(s, fn(a.t)), v = bb ? chg(s, bb.v, a.v) : null;
        const sc = scale[s.kind][j] * (s.kind === 'level' ? Math.abs(a.v) / 100 : 1);
        tr.append(el('td', { class: 'heat', text: fmtChg(s, v), style: v ? `background:${hexA(v > 0 ? pos : neg, Math.min(1, Math.abs(v) / sc) * 0.42)}` : '' }));
        row.push(v == null ? '' : v.toFixed(2));
      });
      let d200 = null;
      if (s.kind === 'price') { const m = ma(s, a.i, 200); if (m) d200 = (a.v / m - 1) * 100; }
      tr.append(el('td', { text: d200 == null ? '–' : (d200 >= 0 ? '▲ ' : '▼ ') + sign(d200) + fmtNum(Math.abs(d200), 1) + '%' }));
      const mz = moveZ(id, 1);
      tr.append(el('td', { text: mz ? zf(mz.z) : '–', style: mz && Math.abs(mz.z) >= 2 ? 'font-weight:650' : '' }));
      const sp = sparkSVG(s, addMonths(a.t, -3), a.t);
      tr.append(el('td', {}, sp || ''));
      row.push(d200 == null ? '' : d200.toFixed(2), mz ? mz.z.toFixed(2) : '');
      csv.push(row); tb.append(tr);
    }
  }
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = csv;
  setNote(c, `Changes to ${nice(state.to)}. ${tgt === 'local' ? 'Equities in local currency.' : `Equities converted to ${tgt} at daily FX; ${tgt === 'SGD' ? 'STI is unchanged' : 'US indices are unchanged'}.`} Yields and spreads in bp, VIX/MOVE in points. ▲/▼ = above/below the 200-day average. Bold σ = an unusual week (|σ| ≥ 2).`);
}
function overviewKpis() {
  const box = $('#ovKpis'); box.replaceChildren();
  const tile = (label, value, delta, foot, statusTok) => box.append(el('div', { class: 'kpi' },
    el('div', { class: 'k-label', text: label }),
    el('div', { class: 'k-value' }, statusTok ? el('span', { class: 'qdot', style: `background:${tok(statusTok)}` }) : '', value),
    el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: foot })));
  if (has('REG_QUAD')) { const q = asOf(S.REG_QUAD, state.to); tile('Macro regime', QUADS[q.v].name, QUADS[q.v].tag, 'data month ' + monthLab(q.t), QUADS[q.v].tok); }
  else tile('Macro regime', '–', 'needs FRED data', '');
  if (has('NET_LIQ')) { const s = S.NET_LIQ, a = asOf(s, state.to), b = asOf(s, a.t - 91 * DAY);
    tile('Fed net liquidity, 13w', fmtChg(s, a.v - b.v), `level ${fmtVal(s, a.v)}`, 'as of ' + nice(a.t)); }
  else tile('Fed net liquidity, 13w', '–', 'needs FRED data', '');
  const sr = stressRows();
  if (sr.length) { const p = sr.reduce((a, r) => a + r.p, 0) / sr.length, [st, lab, icon] = stressBand(p);
    tile('Stress composite', `${Math.round(p)}th pct`, `${icon}${lab}`, `${sr.length} gauges vs 10 years`, '--' + st); }
  if (has('REC_PROB_NYF')) { const a = asOf(S.REC_PROB_NYF, state.to); tile('Recession odds, 12m', fmtNum(a.v, 0) + '%', 'NY Fed yield-curve model', monthLab(a.t)); }
  const above = OV_EQ.filter(id => has(id)).map(id => { const s = S[id], a = asOf(s, state.to); const m = a && ma(s, a.i, 200); return m ? a.v > m : null; }).filter(x => x != null);
  if (above.length) tile('Equity breadth', `${above.filter(Boolean).length} of ${above.length}`, 'global indices above their 200-day average', 'as of ' + nice(state.to));
  if (has('DXY')) { const s = S.DXY, a = asOf(s, state.to), b = asOf(s, addMonths(a.t, -1)); tile('US dollar (DXY), 1M', fmtChg(s, chg(s, b.v, a.v)), `level ${fmtNum(a.v, 1)}`, 'as of ' + nice(a.t)); }
}
function talkingPoints() {
  const out = [], to = state.to;
  const mv = movers(1).slice(0, 3);
  if (mv.length) out.push(`Biggest moves this week (vs each asset’s 5-year norm): ${mv.map(r => `${S[r.id].label} ${fmtMove(S[r.id], r.chg)} (${zf(r.z)}σ)`).join('; ')}.`);
  const eq = OV_EQ.filter(id => has(id)).map(id => { const s = S[id], a = asOf(s, to), b = asOf(s, Date.UTC(new Date(a.t).getUTCFullYear() - 1, 11, 31)); const m = ma(s, a.i, 200);
    return { id, ytd: b ? chg(s, b.v, a.v) : null, up: m ? a.v > m : null }; }).filter(r => r.ytd != null).sort((a, b) => b.ytd - a.ytd);
  if (eq.length) out.push(`Equities: ${eq.filter(r => r.up).length} of ${eq.length} major indices sit above their 200-day average. YTD leaders: ${eq.slice(0, 2).map(r => `${S[r.id].label} ${fmtChg(S[r.id], r.ytd)}`).join(', ')}; laggards: ${eq.slice(-2).reverse().map(r => `${S[r.id].label} ${fmtChg(S[r.id], r.ytd)}`).join(', ')} (local currency).`);
  if (has('UST10Y')) { const s = S.UST10Y, a = asOf(s, to), b = asOf(s, addMonths(a.t, -1));
    let t = `Rates: UST 10Y at ${fmtNum(a.v, 2)}% (${fmtChg(s, chg(s, b.v, a.v))} over 1M)`;
    if (has('CURVE_2s10s')) t += `, 2s10s at ${fmtNum(asOf(S.CURVE_2s10s, to).v * 100, 0)}bp`;
    if (has('REAL10Y')) t += `, 10Y real yield ${fmtNum(asOf(S.REAL10Y, to).v, 2)}%`;
    out.push(t + '.'); }
  if (has('NET_LIQ')) { const s = S.NET_LIQ, a = asOf(s, to), b = asOf(s, a.t - 91 * DAY);
    let t = `Liquidity: Fed net liquidity ${a.v >= b.v ? 'up' : 'down'} ${fmtChg(s, Math.abs(a.v - b.v)).replace('+', '')} over 13 weeks to ${fmtVal(s, a.v)}`;
    if (has('SOFR_IORB')) { const pp = pts(S.SOFR_IORB, to - 30 * DAY, to).map(p => p[1]); if (pp.length) t += `; SOFR averaged ${fmtNum(pp.reduce((x, y) => x + y, 0) / pp.length, 1)}bp vs IORB over the past month`; }
    out.push(t + '.'); }
  if (has('REG_QUAD')) { const q = asOf(S.REG_QUAD, to), gm = asOf(S.REG_GM, to), im = asOf(S.REG_IM, to);
    out.push(`Macro regime: ${QUADS[q.v].name} as of ${monthLab(q.t)} data. Growth momentum ${gm.v >= 0 ? 'accelerating' : 'decelerating'} (${zf(gm.v)}), inflation momentum ${im.v >= 0 ? 'accelerating' : 'decelerating'} (${zf(im.v)}).`); }
  const sr = stressRows();
  if (sr.length) { const p = sr.reduce((a, r) => a + r.p, 0) / sr.length, top = sr.slice().sort((a, b) => b.p - a.p)[0];
    out.push(`Stress: composite at the ${Math.round(p)}th percentile of the last 10 years (${stressBand(p)[1].toLowerCase()}); highest gauge is ${top.label} at the ${Math.round(top.p)}th.`); }
  if (has('DXY')) { const s = S.DXY, a = asOf(s, to), b = asOf(s, addMonths(a.t, -1));
    let t = `USD: DXY ${fmtChg(s, chg(s, b.v, a.v))} over 1M`;
    if (has('USDSGD')) { const u = S.USDSGD, ua = asOf(u, to), ub = asOf(u, addMonths(ua.t, -1)); t += `; USD/SGD ${fmtNum(ua.v, 4)} (${fmtChg(u, chg(u, ub.v, ua.v))})`; }
    if (has('USDJPY')) t += `; USD/JPY ${fmtNum(asOf(S.USDJPY, to).v, 2)}`;
    out.push(t + '.'); }
  return out;
}
function renderPoints(c) {
  const b = htmlBody(c), pts_ = talkingPoints();
  const ul = el('ul', { class: 'points' }); pts_.forEach(p => ul.append(el('li', { text: p })));
  b.append(ul);
  c.csv = [['Talking point'], ...pts_.map(p => [p])];
  c.copyText = `Market snapshot, ${nice(state.to)}\n` + pts_.map(p => '• ' + p).join('\n');
  setNote(c, 'Generated from the data on this page, as of the “To” date. Facts only, no views; edit before sharing.');
}
function buildOverview() {
  const g = $('#ovGrid');
  const tp = makeCard(g, { key: 'points', range: false, title: 'Talking points', wide: true, source: 'FRED, Yahoo Finance', render: renderPoints });
  const copy = el('button', { class: 'ghost', type: 'button', text: 'Copy', title: 'Copy as text', onclick: async () => {
    try { await navigator.clipboard.writeText(tp.copyText || ''); copy.textContent = 'Copied'; setTimeout(() => copy.textContent = 'Copy', 1500); } catch (e) { alert(tp.copyText); } } });
  tp.root.querySelector('.card-tools').prepend(copy);
  makeCard(g, { key: 'headlines', range: false, title: 'Latest headlines', wide: true, render: renderHeadlinesCard });
  makeCard(g, { key: 'moved', range: false, title: 'What moved', source: 'Yahoo Finance, FRED',
    seg: { key: 'ovHorizon', options: [['W', '1 week'], ['M', '4 weeks']] }, render: renderMoved });
  makeCard(g, { key: 'fragile', range: false, title: 'How fragile', sub: 'Stress gauges ranked against their own last 10 years.', source: 'FRED, Yahoo Finance', render: renderFragile });
  makeCard(g, { key: 'where', range: false, title: 'Where we are', wide: true, sub: 'Cross-asset snapshot. Switch the currency to see equity returns as a USD or SGD investor.', source: 'Yahoo Finance, FRED',
    seg: { key: 'ovCcy', options: [['local', 'Local'], ['USD', 'USD'], ['SGD', 'SGD']] }, render: renderWhere });
  for (const k of ['points', 'headlines', 'fragile', 'where']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
}
const CARD_SOURCES = {"netliq": "FRED (WALCL Fed total assets, WDTGAL Treasury General Account, RRPONTSYD overnight reverse repo); S&P 500 from Yahoo Finance (^GSPC)", "comp": "FRED (WALCL, WRESBAL, WDTGAL, RRPONTSYD)", "fund": "FRED (SOFR, EFFR, IORB)", "scarcity": "FRED (WRESBAL reserves, GDP nominal GDP, TLAACBW027SBOG commercial bank assets); ratios calculated", "gcb": "FRED (WALCL Fed, ECBASSETSW ECB, JPNASSETS BoJ; FX DEXUSEU, DEXJPUS); USD conversion calculated", "nfci": "Chicago Fed via FRED (NFCI)", "m2": "Federal Reserve via FRED (M2SL); YoY calculated", "quad": "Dashboard calculation from FRED (CFNAI, INDPRO, PAYEMS, RRSFS, ICSA, CPIAUCSL, CPILFESL, PCEPILFE)", "comp_gi": "Dashboard calculation from FRED (CFNAI, INDPRO, PAYEMS, RRSFS, ICSA, CPIAUCSL, CPILFESL, PCEPILFE); recession shading NBER (USREC)", "regtable": "Regimes: dashboard calculation from FRED; returns: Yahoo Finance prices (ETFs adjusted for dividends)", "zg": "FRED (CFNAI, INDPRO, PAYEMS, RRSFS, ICSA); z-scores calculated; recession shading NBER (USREC)", "zi": "FRED (CPIAUCSL, CPILFESL, PCEPILFE); z-scores calculated; recession shading NBER (USREC)", "sahm": "FRED (SAHMREALTIME); recession shading NBER (USREC)", "recprob": "Yield-curve model: NY Fed method applied to FRED T10Y3M; Chauvet-Piger: FRED (RECPROUSM156N)", "infl": "BLS via FRED (CPIAUCSL, CPILFESL); BEA via FRED (PCEPILFE); YoY calculated", "claims": "US Department of Labor via FRED (ICSA)", "points": "Calculated from the data on this dashboard (Yahoo Finance, FRED, US Treasury, MOF Japan, ECB, SingStat)", "moved": "Yahoo Finance (prices, FX, VIX/MOVE); FRED, US Treasury, MOF Japan, ECB (yields, spreads); σ calculated", "fragile": "Yahoo Finance (^VIX, ^MOVE); FRED (BAA10Y, BAMLH0A0HYM2, NFCI, STLFSI4, SOFR, IORB); percentiles calculated", "where": "Yahoo Finance (indices, FX, commodities, crypto, VIX/MOVE); FRED / US Treasury / MOF Japan / ECB (yields); FRED (credit spreads); hover a row for its exact source", "xcurve": "US Treasury (Daily Par Yield Curve); Ministry of Finance Japan (JGB interest rates); ECB Data Portal (YC, AAA euro area government spot curve)", "teny": "US Treasury (Daily Par Yield Curve, 10Y); MOF Japan (JGB 10Y); ECB Data Portal (YC SR_10Y)", "slopes": "US Treasury / MOF Japan / ECB Data Portal curves; spreads calculated; recession shading NBER (USREC)", "real": "US Treasury (Daily Par Real Yield Curve and Par Yield Curve); breakeven calculated", "diff": "US Treasury, MOF Japan, ECB Data Portal (10Y yields); Yahoo Finance (JPY=X, EURUSD=X)", "hedged": "US Treasury (3M, 10Y), MOF Japan (1Y, 10Y), ECB Data Portal (3M, 10Y); hedged yields calculated", "shifts": "Yahoo Finance and FRED / US Treasury / MOF Japan / ECB series; correlations calculated"};
function applyPairToggles() { for (const k of ['netliq', 'diff', 'sneer', 'cn_spread', 'lei', 'leadlag', 'cugold', 'cycdef']) if (cards[k]) pairToggle(cards[k]); }
function applySources() { for (const [k, v] of Object.entries(CARD_SOURCES)) if (cards[k]) setSource(cards[k], v); }
function renderOverview() {
  overviewKpis();
  ['points', 'headlines', 'moved', 'fragile', 'where'].forEach(k => cards[k].render());
}

// ------------------------------------------------------------------ REGIME
const QUADS = {
  1: { name: 'Goldilocks', tag: 'Growth ↑ · Inflation ↓', tok: '--s3', text: 'Typically favours equities (growth, tech) and credit. Bonds do fine as inflation cools.' },
  2: { name: 'Overheat', tag: 'Growth ↑ · Inflation ↑', tok: '--s4', text: 'Typically favours commodities, cyclicals and value. Long bonds lag as yields rise.' },
  3: { name: 'Stagflation', tag: 'Growth ↓ · Inflation ↑', tok: '--s2', text: 'Typically favours cash, gold and commodities. Equities and bonds both struggle.' },
  4: { name: 'Slowdown', tag: 'Growth ↓ · Inflation ↓', tok: '--s1', text: 'Typically favours long-duration bonds, defensives and the USD. Cyclicals lag.' },
};
const qColor = q => tok(QUADS[q].tok);
const monthLab = t => { const d = new Date(t); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const zf = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v), 2);
const REG_ASSETS = ['SPX', 'NDX', 'RTY', 'XLK', 'XLF', 'XLE', 'VNQ', 'SX5E', 'NKY', 'EEM', 'AAXJ', 'STI', 'TLT', 'IEF', 'LQD', 'HYG', 'EMB', 'GOLD', 'BRENT', 'COPPER', 'DXY', 'USDJPY', 'BTC'];
state.regLag = 'lag'; state.regSpan = 'long'; state.regAsset = 'SPX';

function regimeRuns(from, to) {   // consecutive months in the same regime -> [start, end, quad]
  const q = S.REG_QUAD, runs = [];
  for (let i = 0; i < q.t.length; i++) {
    const a = q.t[i], b = i + 1 < q.t.length ? q.t[i + 1] : addMonths(a, 1);
    if (b < from || a > to) continue;
    const last = runs[runs.length - 1];
    if (last && last[2] === q.v[i] && last[1] === a) last[1] = b; else runs.push([a, b, q.v[i]]);
  }
  return runs.map(([a, b, v]) => [Math.max(a, from), Math.min(b, to), v]);
}
function recessionAreas(from, to) {
  if (!has('USREC')) return [];
  const s = S.USREC, out = [];
  for (let i = 0; i < s.t.length; i++) {
    if (s.v[i] !== 1) continue;
    const a = s.t[i], b = addMonths(a, 1);
    if (b < from || a > to) continue;
    const last = out[out.length - 1];
    if (last && last[1] === a) last[1] = b; else out.push([a, b]);
  }
  return out.map(([a, b]) => [Math.max(a, from), Math.min(b, to), hexA(tok('--muted'), 0.16), 'US recession (NBER)']);
}
function regimeKpis() {
  const box = $('#regKpis'); box.replaceChildren();
  const now = $('#regNow'); now.replaceChildren();
  if (!has('REG_QUAD')) { box.append(el('div', { class: 'muted small', text: NO_FRED })); return; }
  const q = asOf(S.REG_QUAD, state.to);
  // how long in this regime
  let k = q.i; while (k > 0 && S.REG_QUAD.v[k - 1] === q.v) k--;
  const prev = k > 0 ? S.REG_QUAD.v[k - 1] : null;
  const tile = (label, valueNode, delta, asofTxt) => box.append(el('div', { class: 'kpi' },
    el('div', { class: 'k-label', text: label }), el('div', { class: 'k-value' }, valueNode),
    el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: asofTxt })));
  tile('Confirmed regime', el('span', {}, el('span', { class: 'qdot', style: `background:${qColor(q.v)}` }), QUADS[q.v].name),
    `${q.i - k + 1} month${q.i - k ? 's' : ''} in a row` + (prev ? ` · from ${QUADS[prev].name}` : ''), `data month ${monthLab(q.t)}`);
  const gm = asOf(S.REG_GM, state.to), im = asOf(S.REG_IM, state.to);
  tile('Growth momentum', el('span', { text: zf(gm.v) }), gm.v >= 0 ? 'accelerating' : 'decelerating', `z-score change · ${monthLab(gm.t)}`);
  tile('Inflation momentum', el('span', { text: zf(im.v) }), im.v >= 0 ? 'accelerating' : 'decelerating', `z-score change · ${monthLab(im.t)}`);
  regimeSignalTiles(box);
  const simple = (id, label, fmt, desc) => {
    if (!has(id)) return;
    const a = asOf(S[id], state.to); if (!a) return;
    tile(label, el('span', { text: fmt(a.v) }), desc(a.v), monthLab(a.t));
  };
  simple('SAHM', 'Sahm rule', v => fmtNum(v, 2) + 'pp', v => v >= 0.5 ? '⚠ triggered (≥0.50)' : `trigger at 0.50 (${fmtNum(0.5 - v, 2)}pp away)`);
  simple('REC_PROB_NYF', 'Recession odds, 12m (curve)', v => fmtNum(v, 0) + '%', v => v >= 30 ? '⚠ elevated (≥30%)' : 'NY Fed yield-curve model');
  simple('CORE_CPI_3M', 'Core CPI, 3m annualised', v => fmtNum(v, 1) + '%', v => has('CORE_CPI_YOY') ? `YoY ${fmtNum(asOf(S.CORE_CPI_YOY, state.to).v, 1)}%` : '');
  for (const n of [1, 2, 3, 4]) {
    now.append(el('div', { class: 'quad' + (n === q.v ? ' on' : ''), style: `--qc:${qColor(n)}` },
      el('h3', {}, el('span', { text: QUADS[n].name + (n === q.v ? ' · now' : '') }), el('span', { class: 'tag', text: QUADS[n].tag })),
      el('p', { text: QUADS[n].text })));
  }
}
function renderQuadPath(c) {
  if (!has('REG_GM', 'REG_IM')) return setEmpty(c, NO_FRED);
  const gm = S.REG_GM, im = S.REG_IM, imMap = new Map(im.t.map((t, i) => [t, im.v[i]]));
  let p = [];
  for (let i = 0; i < gm.t.length; i++) if (gm.t[i] >= addMonths(state.from, -1) && gm.t[i] <= state.to && imMap.has(gm.t[i])) p.push([gm.v[i], imMap.get(gm.t[i]), gm.t[i]]);
  const capped = p.length > 36; if (capped) p = p.slice(-36);
  if (!p.length) return setEmpty(c, 'No regime readings in this date range.');
  const qOf = (x, y) => x >= 0 ? (y < 0 ? 1 : 2) : (y >= 0 ? 3 : 4);
  const m = Math.max(0.3, ...p.map(d => Math.max(Math.abs(d[0]), Math.abs(d[1])))) * 1.2;
  c.subEl.textContent = `Change in growth (x) and inflation (y) composites, monthly path from ${monthLab(p[0][2])} to ${monthLab(p[p.length - 1][2])}${capped ? ' (last 36 months of range)' : ''}. Larger dot = latest.`;
  const o = baseOpt();
  o.legend.show = false;
  o.grid = { left: 8, right: 16, top: 14, bottom: 8, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: pp => {
    if (!pp.data || pp.data.length < 3) return '';
    const [x, y, t] = pp.data;
    return `<div style="color:${tok('--ink-2')};margin-bottom:4px">${esc(monthLab(t))} · ${esc(QUADS[qOf(x, y)].name)}</div><b>${zf(x)}</b> growth momentum<br><b>${zf(y)}</b> inflation momentum`;
  } };
  const ax = name => ({ type: 'value', min: -m, max: m, name, nameLocation: 'end', nameTextStyle: { color: tok('--muted'), fontSize: 11 },
    axisLabel: { color: tok('--muted'), fontSize: 11, formatter: v => v.toFixed(1), showMinLabel: false, showMaxLabel: false }, splitLine: { lineStyle: { color: tok('--grid') } },
    axisLine: { onZero: true, lineStyle: { color: tok('--axis') } }, axisTick: { show: false } });
  o.xAxis = ax('Growth →'); o.yAxis = ax('Inflation ↑');
  const QPOS = { 1: 'insideBottomRight', 2: 'insideTopRight', 3: 'insideTopLeft', 4: 'insideBottomLeft' };
  const area = (x0, x1, y0, y1, n) => [{ coord: [x0, y0], itemStyle: { color: hexA(qColor(n), 0.10) }, name: QUADS[n].name,
    label: { show: true, color: tok('--ink-2'), fontSize: 12, fontWeight: 600, position: QPOS[n], distance: 8 } }, { coord: [x1, y1] }];
  const n = p.length;
  o.series = [
    { type: 'line', data: p.map(d => [d[0], d[1], d[2]]), showSymbol: false, lineStyle: { color: tok('--muted'), width: 1 }, silent: true, z: 1,
      markArea: { silent: true, data: [area(0, m, -m, 0, 1), area(0, m, 0, m, 2), area(-m, 0, 0, m, 3), area(-m, 0, -m, 0, 4)] } },
    { type: 'scatter', z: 3, data: p.map((d, i) => ({ value: d, symbolSize: i === n - 1 ? 16 : 7 + 5 * (i / n),
      itemStyle: { color: qColor(qOf(d[0], d[1])), opacity: i === n - 1 ? 1 : 0.35 + 0.55 * (i / n), borderColor: tok('--surface'), borderWidth: 2 },
      label: { show: i === n - 1 || i === 0, formatter: monthLab(d[2]), position: 'right', color: tok('--ink'), fontSize: 11, fontWeight: i === n - 1 ? 600 : 400 } })) },
  ];
  inst(c).setOption(o, true);
  c.csv = [['Month', 'Growth momentum', 'Inflation momentum', 'Regime'], ...p.map(d => [iso(d[2]).slice(0, 7), d[0], d[1], QUADS[qOf(d[0], d[1])].name])];
}
function renderRegimeHistory(c) {
  if (!has('REG_QUAD')) return setEmpty(c, NO_FRED);
  const id = has(state.regAsset) ? state.regAsset : 'SPX', s = S[id];
  const data = pts(s, state.from, state.to);
  const runs = regimeRuns(state.from, state.to);
  c.titleEl.textContent = `Regime history: ${s.label}`;
  setSource(c, `Regimes: dashboard calculation from FRED; ${s.source}`);
  c.subEl.textContent = 'Background = regime for each data month. Regimes are only known 1–2 months later, when the data is published.';
  const series = [line(s.label, data, tok('--ink-2'))];
  series[0].markArea = { silent: true, data: runs.map(([a, b, q]) => [{ xAxis: a, itemStyle: { color: hexA(qColor(q), 0.28) } }, { xAxis: b }]) };
  for (const n of [1, 2, 3, 4]) series.push({ name: QUADS[n].name, type: 'line', data: [], itemStyle: { color: qColor(n) }, lineStyle: { color: qColor(n) } });
  const o = baseOpt();
  o.legend.data = [1, 2, 3, 4].map(n => ({ name: QUADS[n].name, icon: 'rect', itemStyle: { color: qColor(n) } }));
  o.tooltip.formatter = ps => {
    const p = (Array.isArray(ps) ? ps : [ps]).find(x => x.seriesIndex === 0); if (!p) return '';
    const q = asOf(S.REG_QUAD, p.value[0]);
    return `<div style="color:${tok('--ink-2')};margin-bottom:4px">${esc(nice(p.value[0]))}</div><b>${esc(fmtVal(s, p.value[1]))}</b> ${esc(s.label)}` +
      (q ? `<br><span style="color:${tok('--ink-2')}">Regime (data month ${esc(monthLab(q.t))}): </span><b>${esc(QUADS[q.v].name)}</b>` : '');
  };
  o.xAxis = timeAxis(); o.yAxis = valAxis(v => fmtNum(v, autoDec(v)));
  o.series = series;
  setZoomable(c, o);
  c.csv = [['Date', s.label, 'Regime'], ...data.map(([t, v]) => { const q = asOf(S.REG_QUAD, t); return [iso(t), v, q ? QUADS[q.v].name : '']; })];
}
function monthEnds(s) {  // month key (UTC month start ms) -> last value in that month
  const m = new Map();
  for (let i = 0; i < s.t.length; i++) { const d = new Date(s.t[i]); m.set(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), s.v[i]); }
  return m;
}
function renderRegimeTable(c) {
  c.chartEl.hidden = true; c.emptyEl.hidden = true;
  let wrap = c.root.querySelector('.table-wrap');
  if (!wrap) { wrap = el('div', { class: 'table-wrap' }); c.root.insertBefore(wrap, c.noteEl); }
  wrap.replaceChildren();
  if (!has('REG_QUAD')) { wrap.append(el('div', { class: 'empty', text: NO_FRED })); return; }
  const q = S.REG_QUAD, qMap = new Map(q.t.map((t, i) => [t, q.v[i]]));
  const lag = state.regLag === 'lag' ? 2 : 0;
  const lo = state.regSpan === 'range' ? state.from : -Infinity, hi = state.regSpan === 'range' ? state.to : Infinity;
  const cur = asOf(q, state.to);
  const rows = [], counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let counted = false;
  const assetList = (state.regSpan === 'long' ? REG_LONG : REG_ASSETS).filter(x => has(x));
  setSource(c, state.regSpan === 'long' ? 'Regimes: dashboard calculation from FRED; returns: Yahoo Finance (^GSPC, DX-Y.NYB, ^SPGSCI) and FRED (GS10, TB3MS, WTISPLC), monthly' : 'Regimes: dashboard calculation from FRED; returns: Yahoo Finance prices (ETFs adjusted for dividends)');
  for (const id of assetList) {
    const s = S[id], me = monthEnds(s), keys = [...me.keys()].sort((a, b) => a - b);
    const acc = { 1: [], 2: [], 3: [], 4: [] };
    for (let i = 1; i < keys.length; i++) {
      const mk = keys[i]; if (mk < lo || mk > hi) continue;
      const rq = qMap.get(addMonths(mk, -lag)); if (!rq) continue;
      acc[rq].push(me.get(keys[i]) / me.get(keys[i - 1]) - 1);
    }
    if (!counted && id === assetList[0]) { for (const n of [1, 2, 3, 4]) counts[n] = acc[n].length; counted = true; }
    const row = { id, s };
    for (const n of [1, 2, 3, 4]) {
      const xs = acc[n];
      row[n] = xs.length >= 3 ? { ann: xs.reduce((a, b) => a + b, 0) / xs.length * 1200, hit: xs.filter(x => x > 0).length / xs.length * 100, n: xs.length } : null;
    }
    rows.push(row);
  }
  const tbl = el('table', { class: 'perf' });
  const hr = el('tr', {}, el('th', { text: 'Asset' }));
  for (const n of [1, 2, 3, 4]) hr.append(el('th', { class: n === (cur && cur.v) ? 'now' : '', title: QUADS[n].tag,
    text: `${QUADS[n].name}${n === (cur && cur.v) ? ' · now' : ''} (${counts[n]}m)` }));
  tbl.append(el('thead', {}, hr));
  const mx = Math.max(1, ...rows.flatMap(r => [1, 2, 3, 4].map(n => r[n] ? Math.abs(r[n].ann) : 0)).sort((a, b) => a - b).slice(-Math.ceil(rows.length * 0.4)));
  const pos = tok('--pos'), neg = tok('--neg'), tb = el('tbody');
  for (const r of rows) {
    const tr = el('tr', { class: 'row' }, el('td', { text: r.s.label }));
    for (const n of [1, 2, 3, 4]) {
      const v = r[n];
      const td = el('td', { class: 'heat', title: v ? `${QUADS[n].name}: avg ${fmtNum(v.ann, 1)}% annualised, up in ${fmtNum(v.hit, 0)}% of ${v.n} months` : 'Fewer than 3 months' ,
        style: v ? `background:${hexA(v.ann >= 0 ? pos : neg, Math.min(1, Math.abs(v.ann) / mx) * 0.42)}` : '',
        text: v ? `${sign(v.ann)}${fmtNum(Math.abs(v.ann), 1)}%` : '–' });
      if (v) td.append(el('span', { class: 'muted', text: `  ${fmtNum(v.hit, 0)}%↑` }));
      tr.append(td);
    }
    tb.append(tr);
  }
  tbl.append(tb); wrap.append(tbl);
  c.csv = [['Asset', ...[1, 2, 3, 4].flatMap(n => [`${QUADS[n].name} ann. %`, `${QUADS[n].name} hit %`, `${QUADS[n].name} months`])],
    ...rows.map(r => [r.s.label, ...[1, 2, 3, 4].flatMap(n => r[n] ? [r[n].ann.toFixed(2), r[n].hit.toFixed(0), r[n].n] : ['', '', ''])])];
  setNote(c, (lag ? 'Investable: each month’s return is matched to the regime from 2 months earlier, the latest one published by then. ' :
    'Same month: each month’s return is matched to that month’s regime, which is only known with hindsight. ') +
    'Average monthly return ×12, then the share of months it was up. ' + (state.regSpan === 'long' ? 'Long history: assets with data back to the 1960s–80s (S&P 500 is price only; the 10Y Treasury is an approximate total return built from yields; commodities start 1984). Ignores the date bar.' : state.regSpan === 'etf' ? 'ETFs and indices since 2005, ignoring the date bar.' : `Months in ${rangeLabel()} only.`));
}
// ---- regime robustness, methodology and leading indicators
const REG_METHODS = [['REG_QUAD', 'Live model: 6m momentum, all-history z, confirmed 2 months'], ['REG_Q_A', 'Same, before confirmation'],
  ['REG_Q_B', '6m momentum, 10-year rolling z'], ['REG_Q_C', '3m momentum, all-history z'], ['REG_Q_D', '6m momentum, sign vote (no scaling)'],
  ['REG_Q_OLD', 'Previous model: 3m momentum, 10-year rolling z']];
const REG_LONG = ['LH_SPX', 'LH_UST10', 'LH_CASH', 'LH_GSCI', 'LH_OIL', 'LH_USD'];
function strengthLabel(x) { return x == null ? 'n/a' : x >= 1 ? 'strong' : x >= 0.5 ? 'moderate' : 'weak'; }
function methodStats(id, from) {
  const s = S[id], base = S.REG_QUAD; if (!s || !base) return null;
  const bm = new Map(base.t.map((t, i) => [t, base.v[i]]));
  let n = 0, same = 0, changes = 0, prev = null;
  for (let i = 0; i < s.t.length; i++) {
    if (s.t[i] < from) continue;
    n++; if (bm.get(s.t[i]) === s.v[i]) same++;
    if (prev != null && s.v[i] !== prev) changes++; prev = s.v[i];
  }
  const cur = asOf(s, state.to);
  return { n, agree: n ? same / n * 100 : null, changes, spell: changes ? n / (changes + 1) : n, cur: cur && cur.v };
}
function renderMethodPanel() {
  const d = $('#regMethod'); d.replaceChildren();
  d.append(el('summary', { text: 'How this regime model works, what the research says, and its limits' }));
  const b = el('div', { class: 'body' });
  const P = t => el('p', { text: t }), H = t => el('h4', { text: t });
  b.append(H('What it measures'),
    P('Two questions: is US growth speeding up or slowing down, and is inflation rising or falling? Each answer is up or down, giving four regimes: Goldilocks (growth up, inflation down), Overheat (both up), Stagflation (growth down, inflation up) and Slowdown (both down). The grid is a framework, not something discovered in the data: growth drives company earnings and inflation drives interest rates, the two main forces on asset prices.'),
    H('How it is built'),
    P('Growth inputs: Chicago Fed activity index, industrial production, payrolls, real retail sales and jobless claims (inverted). Inflation inputs: headline CPI, core CPI (year-on-year and 3-month annualised) and core PCE. Each input is compared with all of its own history up to that month (expanding window, so the 1970s are never forgotten), averaged into a growth and an inflation composite, and the direction is the change in the 3-month average over 6 months. A new regime is only declared after two consecutive months agree. Inputs start in 1959, so regimes run from the early 1970s.'),
    H('Research behind it'),
    P('Merrill Lynch “Investment Clock” (Greetham & Hartnett, 2004; US data from 1973): bonds lead when growth and inflation fall, equities in recoveries, commodities when the economy overheats, cash in stagflation. Bridgewater “All Weather”: the same four environments, measured against expectations, used to balance risk. Ilmanen, Maloney & Ross (2014, Journal of Portfolio Management; 1972–2013): equities prefer high growth and low inflation, government bonds low growth and low inflation, commodities high inflation. Neville, Harvey, Van Hemert et al. (2021, Man Group/Duke; 1926–2020): equities and bonds both struggle when inflation is high; commodities and trend-following did best. Kritzman, Page & Turkington (2012, Financial Analysts Journal) show a statistical alternative: regimes found by a regime-switching model rather than a fixed grid.'),
    H('Robustness: does the construction change the answer?'));
  const tbl = el('table', { class: 'perf' });
  tbl.append(el('thead', {}, el('tr', {}, el('th', { text: 'Construction' }), el('th', { text: 'Same regime as live, since 1972' }),
    el('th', { text: 'Since 2005' }), el('th', { text: 'Avg regime length' }), el('th', { text: 'Reading now' }))));
  const tb = el('tbody');
  for (const [id, lab] of REG_METHODS) {
    const a = methodStats(id, Date.UTC(1972, 0, 1)), r = methodStats(id, Date.UTC(2005, 0, 1)); if (!a) continue;
    tb.append(el('tr', { class: 'row' }, el('td', { text: lab }), el('td', { text: id === 'REG_QUAD' ? '—' : fmtNum(a.agree, 0) + '%' }),
      el('td', { text: id === 'REG_QUAD' ? '—' : fmtNum(r.agree, 0) + '%' }), el('td', { text: fmtNum(a.spell, 1) + ' months' }),
      el('td', { text: a.cur ? QUADS[a.cur].name : '–' })));
  }
  tbl.append(tb); b.append(tbl);
  b.append(H('Limits to keep in mind'),
    P('1) Publication lag: most inputs arrive 2–6 weeks after month end, so use the “Investable” view of the returns table, which matches each month’s return to the regime known at the time. 2) Revisions: the model uses today’s revised data, not what was known then, so history looks cleaner than it was live. 3) Small samples: each regime has only a few dozen episodes since 1972, and individual cells in the returns table can flip sign with small changes in construction; treat them as tendencies. 4) Only the US: other economies can be in different regimes. 5) A label hides intensity: check “Signal strength” and how many constructions agree before leaning on it.'));
  d.append(b);
}
function regimeSignalTiles(box) {
  const tile = (label, valueNode, delta, foot) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: label }),
    el('div', { class: 'k-value' }, valueNode), el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: foot })));
  if (has('REG_Q_A')) {
    const raw = asOf(S.REG_Q_A, state.to), conf = asOf(S.REG_QUAD, state.to), ag = has('REG_AGREE') ? asOf(S.REG_AGREE, state.to) : null;
    const pending = raw && conf && raw.v !== conf.v;
    tile('Latest signal', el('span', {}, el('span', { class: 'qdot', style: `background:${qColor(raw.v)}` }), QUADS[raw.v].name),
      pending ? 'pending: needs a second month to confirm' : 'confirmed', ag ? `${ag.v} of 4 constructions agree` : '');
  }
  if (has('REG_STRENGTH')) { const s = asOf(S.REG_STRENGTH, state.to);
    tile('Signal strength', el('span', { text: strengthLabel(s.v) }), `${fmtNum(s.v, 2)}× a typical move (weaker of the two signals)`, monthLab(s.t)); }
  if (has('REG_G')) { const g = asOf(S.REG_G, state.to);
    tile('Growth level', el('span', { text: g.v >= 0 ? 'above trend' : 'below trend' }), `composite ${zf(g.v)} vs its history`, monthLab(g.t)); }
}
function renderLEI(c) {
  if (!has('LEI_6M', 'LEI_DIFF')) return setEmpty(c, 'Waiting for the leading-index inputs (next daily run).');
  const a = pts(S.LEI_6M, state.from, state.to), d = pts(S.LEI_DIFF, state.from, state.to);
  drawPair(c, { name: 'Leading index, 6m change annualised', data: a }, { name: 'Diffusion: % of components rising', data: d },
    { fmtA: v => sign(v) + fmtNum(Math.abs(v), 1) + '%', fmtB: v => fmtNum(v, 0) + '%', axisA: v => fmtNum(v, 0) + '%', axisB: v => fmtNum(v, 0) + '%', zeroA: true });
  const la = asOf(S.LEI_6M, state.to), ld = asOf(S.LEI_DIFF, state.to);
  const warn = la && ld && la.v <= -4.3 && ld.v <= 50;
  setNote(c, `Built like the Conference Board's Leading Economic Index, using free stand-ins for its components. Recession warning (the Conference Board's "3Ds" rule): 6-month change below −4.3% annualised and half or fewer components rising. Now: ${la ? sign(la.v) + fmtNum(Math.abs(la.v), 1) + '%' : 'n/a'}, ${ld ? fmtNum(ld.v, 0) + '% rising' : ''} → ${warn ? '⚠ warning ON' : 'no warning'}.`);
  setSource(c, S.LEI_6M.source || 'Dashboard calculation from FRED');
}
function renderLEIDrivers(c) {
  const ids = Object.keys(S).filter(k => k.startsWith('LEIC_'));
  if (!ids.length) return setEmpty(c, 'Waiting for the leading-index inputs (next daily run).');
  const rows = ids.map(id => { const a = asOf(S[id], state.to); return a && { id, v: a.v, t: a.t }; }).filter(Boolean).sort((x, y) => x.v - y.v);
  c.subEl.textContent = `Contribution of each component to the index over the 6 months to ${rows.length ? monthLab(rows[0].t) : ''} (weighted, points). Positive = pointing to stronger growth.`;
  const o = baseOpt(); o.legend.show = false;
  o.grid = { left: 8, right: 50, top: 8, bottom: 8, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => `<b>${sign(p.value)}${fmtNum(Math.abs(p.value), 2)}</b> <span style="color:${tok('--ink-2')}">${esc(S[rows[p.dataIndex].id].label)}</span>` };
  o.xAxis = { type: 'value', axisLabel: { color: tok('--muted'), fontSize: 11 }, splitLine: { lineStyle: { color: tok('--grid') } } };
  o.yAxis = { type: 'category', data: rows.map(r => S[r.id].label), axisLabel: { color: tok('--ink-2'), fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } };
  o.series = [{ type: 'bar', barWidth: '60%', data: rows.map(r => ({ value: +r.v.toFixed(3), itemStyle: { color: r.v >= 0 ? tok('--pos') : tok('--neg'), borderRadius: r.v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
    label: { show: true, position: 'right', color: tok('--ink-2'), fontSize: 11, formatter: p => sign(p.value) + fmtNum(Math.abs(p.value), 2) } }];
  inst(c).setOption(o, true);
  c.csv = [['Component', '6m contribution'], ...rows.map(r => [S[r.id].label, r.v.toFixed(3)])];
  setSource(c, S[ids[0]].source || '');
}
function laggedCorr(lead, follow, maxLag = 12) {   // monthly: corr(lead_t, follow_{t+k}) for k = 0..maxLag
  const fm = new Map(follow.t.map((t, i) => [t, follow.v[i]]));
  const res = [];
  for (let k = 0; k <= maxLag; k++) {
    const a = [], b = [];
    for (let i = 0; i < lead.t.length; i++) { const t2 = addMonths(lead.t[i], k); if (fm.has(t2)) { a.push(lead.v[i]); b.push(fm.get(t2)); } }
    res.push([k, pearson(a, b)]);
  }
  return res;
}
function renderLeadLag(c) {
  if (!has('LEI_6M', 'REG_GM')) return setEmpty(c, 'Waiting for the leading-index inputs (next daily run).');
  drawPair(c, { name: 'Leading index, 6m annualised', data: pts(S.LEI_6M, state.from, state.to) }, { name: 'Growth momentum (regime model)', data: pts(S.REG_GM, state.from, state.to) },
    { fmtA: v => sign(v) + fmtNum(Math.abs(v), 1) + '%', fmtB: v => zf(v), axisA: v => fmtNum(v, 0) + '%', axisB: v => v.toFixed(1), zeroA: true, zeroB: true });
  const cc = laggedCorr(S.LEI_6M, S.REG_GM).filter(x => x[1] != null), best = cc.reduce((m, x) => x[1] > m[1] ? x : m, [0, -2]);
  setNote(c, `Does the leading index turn before the regime's growth signal? Correlation of the leading index with growth momentum k months later: ${cc.filter(x => [0, 3, 6, 9, 12].includes(x[0])).map(x => `${x[0]}m ${fmtNum(x[1], 2)}`).join(' · ')}. Strongest at ${best[0]} months. Caution: scanning many lags always finds a best one; treat the lead as a tendency, not a forecast.`);
  setSource(c, 'Dashboard calculations from FRED and Yahoo Finance');
}
function ratioSeries(numIds, denIds) {   // equal-weight ratio of baskets, daily
  if (![...numIds, ...denIds].every(id => has(id))) return null;
  const base = S[numIds[0]], t = [], v = [];
  const b0 = Object.fromEntries([...numIds, ...denIds].map(id => [id, null]));
  for (let i = 0; i < base.t.length; i++) {
    const x = base.t[i]; const vals = {};
    let ok = true; for (const id of [...numIds, ...denIds]) { const a = asOf(S[id], x); if (!a || x - a.t > 5 * DAY) { ok = false; break; } vals[id] = a.v; }
    if (!ok) continue;
    for (const id in vals) if (b0[id] == null) b0[id] = vals[id];
    const num = numIds.reduce((m, id) => m + vals[id] / b0[id], 0) / numIds.length, den = denIds.reduce((m, id) => m + vals[id] / b0[id], 0) / denIds.length;
    t.push(x); v.push(num / den);
  }
  return { t, v, kind: 'price' };
}
function renderCopperGold(c) {
  if (!has('COPPER', 'GOLD', 'UST10Y')) return setEmpty(c, 'Waiting for data.');
  const r = combine(S.COPPER, S.GOLD, (a, b) => a / b * 1000, {}, 5 * DAY);
  drawPair(c, { name: 'Copper / gold ratio (×1000)', data: pts(r, state.from, state.to) }, { name: 'UST 10Y yield', data: pts(S.UST10Y, state.from, state.to) },
    { fmtA: v => fmtNum(v, 3), fmtB: v => fmtNum(v, 2) + '%', axisA: v => fmtNum(v, 2), axisB: v => fmtNum(v, 1) + '%' });
  setNote(c, 'Copper (industrial demand) relative to gold (safety) is a market-based read on growth; it has historically tracked the 10Y yield. A rising ratio with flat yields hints yields may follow, and vice versa.');
  setSource(c, srcOf(['COPPER', 'GOLD', 'UST10Y']) + '; ratio calculated');
}
function renderCycDef(c) {
  const r = ratioSeries(['XLY', 'XLI'], ['XLP', 'XLU']);
  if (!r || !has('SPX')) return setEmpty(c, 'Waiting for sector data (next daily run).');
  const p = pts(r, state.from, state.to); const b = p.length ? p[0][1] : 1;
  drawPair(c, { name: 'Cyclicals / defensives (= 100 at start)', data: p.map(([t, v]) => [t, v / b * 100]) }, { name: 'S&P 500', data: pts(S.SPX, state.from, state.to) },
    { fmtA: v => fmtNum(v, 1), fmtB: v => fmtNum(v, 0), axisA: v => fmtNum(v, 0), axisB: v => fmtNum(v, 0) });
  setNote(c, 'Equal-weight consumer discretionary and industrials versus consumer staples and utilities. Investors rotate into cyclicals when they expect growth to improve, so this ratio often turns before the economic data.');
  setSource(c, srcOf(['XLY', 'XLI', 'XLP', 'XLU', 'SPX']) + '; ratio calculated');
}

function buildRegime() {
  const g = $('#regGrid');
  makeCard(g, { key: 'quad', title: 'Growth × inflation quadrant', tall: true, source: 'FRED; growth and inflation composites', render: renderQuadPath });
  makeCard(g, { key: 'comp_gi', title: 'Growth and inflation composites', sub: 'Average z-score of the inputs below, each against all of its own history up to that month. 0 = normal.', source: 'FRED',
    render: c => { if (!has('REG_G', 'REG_I')) return setEmpty(c, NO_FRED);
      drawLines(c, [{ name: 'Growth', data: pts(S.REG_G, state.from, state.to), color: col(0) }, { name: 'Inflation', data: pts(S.REG_I, state.from, state.to), color: col(1) }],
        { fmt: zf, axisFmt: v => v.toFixed(1), zero: true, areas: recessionAreas(state.from, state.to) }); } });
  const hist = makeCard(g, { key: 'reghist', title: 'Regime history', wide: true, tall: true, source: 'FRED, Yahoo Finance',
    seg: { key: 'regAsset', options: [['SPX', 'S&P 500'], ['NDX', 'Nasdaq'], ['TLT', 'Long UST'], ['GOLD', 'Gold'], ['COPPER', 'Copper'], ['DXY', 'USD']] }, render: renderRegimeHistory });
  makeCard(g, { key: 'regtable', range: false, title: 'What worked in each regime', wide: true, source: 'FRED, Yahoo Finance',
    sub: 'Annualised average monthly return by regime (local currency; ETFs include dividends). Hover a cell for details.',
    seg: { key: 'regLag', options: [['lag', 'Investable'], ['same', 'Same month']] }, render: renderRegimeTable });
  const t = cards.regtable, seg2 = el('div', { class: 'seg', role: 'group' });
  for (const [val, lab] of [['long', 'Since 1970s'], ['etf', 'Since 2005'], ['range', 'Date bar']]) {
    const b = el('button', { type: 'button', text: lab, class: state.regSpan === val ? 'on' : '' });
    b.addEventListener('click', () => { state.regSpan = val; seg2.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); t.render(); });
    seg2.append(b);
  }
  t.root.querySelector('.card-tools').prepend(seg2);
  t.root.querySelector('[title^="Focus"]').hidden = true; t.root.querySelector('[title^="Download chart as"]').hidden = true;
  g.append(el('h3', { class: 'section', text: 'Leading indicators: where growth is heading' }));
  makeCard(g, { key: 'lei', title: 'DIY leading index', wide: true, sub: 'US leading index built with the Conference Board method from free data: 6-month change and the share of components rising.', render: renderLEI });
  makeCard(g, { key: 'leidrv', title: 'What is driving the leading index', range: false, render: renderLEIDrivers });
  makeCard(g, { key: 'leadlag', title: 'Leading index vs regime growth signal', render: renderLeadLag });
  makeCard(g, { key: 'cli', title: 'OECD leading indicators', wide: true, sub: 'Composite leading indicators for six economies: they tend to turn 6–9 months before activity. 100 = long-term trend.', render: renderCLI });
  makeCard(g, { key: 'cugold', title: 'Copper / gold ratio vs UST 10Y', render: renderCopperGold });
  makeCard(g, { key: 'cycdef', title: 'Cyclicals vs defensives', render: renderCycDef });
  g.append(el('h3', { class: 'section', text: 'Regime inputs and recession watch' }));
  const zcard = (key, title, prefix) => makeCard(g, { key, title, source: 'FRED', sub: 'z-scores against each input’s full history up to that month (capped at ±3). Grey = US recession.',
    render: c => { const ids = Object.keys(S).filter(k => k.startsWith(prefix)); if (!ids.length) return setEmpty(c, NO_FRED);
      drawLines(c, ids.map((id, i) => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(i) })),
        { fmt: zf, axisFmt: v => v.toFixed(1), zero: true, endLabels: false, areas: recessionAreas(state.from, state.to) }); } });
  zcard('zg', 'Growth inputs', 'RZG_');
  zcard('zi', 'Inflation inputs', 'RZI_');
  makeCard(g, { key: 'sahm', title: 'Sahm rule recession indicator', source: 'FRED (SAHMREALTIME)',
    sub: '3-month average unemployment rate minus its low of the prior 12 months. 0.50pp or more has marked every US recession since 1970.',
    render: c => { if (!has('SAHM')) return setEmpty(c, NO_FRED);
      drawLines(c, [{ name: 'Sahm rule (real-time)', data: pts(S.SAHM, state.from, state.to) }],
        { fmt: v => fmtNum(v, 2) + 'pp', axisFmt: v => v.toFixed(2), hlines: [{ y: 0.5, label: 'trigger 0.50' }], areas: recessionAreas(state.from, state.to) }); } });
  makeCard(g, { key: 'recprob', title: 'Recession probability', source: 'FRED (T10Y3M, RECPROUSM156N); NY Fed model',
    sub: 'Yield-curve model: odds of recession 12 months ahead. Chauvet-Piger: odds the US is in recession now.',
    render: c => { const ids = ['REC_PROB_NYF', 'REC_PROB_CP'].filter(x => has(x)); if (!ids.length) return setEmpty(c, NO_FRED);
      const names = { REC_PROB_NYF: 'Yield curve, 12m ahead', REC_PROB_CP: 'Chauvet-Piger, now' };
      drawLines(c, ids.map((id, i) => ({ name: names[id], data: pts(S[id], state.from, state.to), color: col(i) })),
        { fmt: v => fmtNum(v, 0) + '%', axisFmt: v => v + '%', yExtra: { min: 0, max: 100, scale: false }, hlines: [{ y: 30, label: '30%' }], areas: recessionAreas(state.from, state.to) }); } });
  makeCard(g, { key: 'infl', title: 'US inflation', source: 'FRED (CPIAUCSL, CPILFESL, PCEPILFE)', sub: 'Year-on-year %, plus core CPI 3-month annualised for the latest trend.',
    render: c => { const ids = ['CPI_YOY', 'CORE_CPI_YOY', 'CORE_PCE_YOY', 'CORE_CPI_3M'].filter(x => has(x)); if (!ids.length) return setEmpty(c, NO_FRED);
      drawLines(c, ids.map((id, i) => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(i) })),
        { fmt: v => fmtNum(v, 1) + '%', axisFmt: v => fmtNum(v, 1) + '%', hlines: [{ y: 2, label: '2% target' }] }); } });
  makeCard(g, { key: 'claims', title: 'Initial jobless claims', source: 'FRED (ICSA)', sub: '4-week average, thousands. Weekly, the timeliest labour-market signal.',
    render: c => { if (!has('CLAIMS_4WK')) return setEmpty(c, NO_FRED);
      drawLines(c, [{ name: 'Initial claims, 4-week avg', data: pts(S.CLAIMS_4WK, state.from, state.to) }],
        { fmt: v => fmtNum(v, 0) + 'k', axisFmt: v => fmtNum(v, 0) + 'k', areas: recessionAreas(state.from, state.to) }); } });
}
function renderRegime() {
  regimeKpis();
  renderMethodPanel();
  ['quad', 'comp_gi', 'reghist', 'regtable', 'lei', 'leidrv', 'leadlag', 'cli', 'cugold', 'cycdef', 'zg', 'zi', 'sahm', 'recprob', 'infl', 'claims'].forEach(k => cards[k].render());
}

// ------------------------------------------------------------------ FIXED INCOME
const CURVES = {};
const CURVE_KEYS = [['US', 'US'], ['US_REAL', 'US real'], ['JP', 'Japan'], ['EA', 'Euro AAA']];
state.fiMkt = 'US'; state.fiSlope = 'US'; state.fiDiff = 'JP'; state.fiHedge = 'usd';
function curveAt(key, t) {
  const c = CURVES[key]; if (!c) return null;
  const i = idxLE(c, t); return i < 0 ? null : { t: c.t[i], y: c.y[i] };
}
const curveCache = new Map();
function curveSeries(key, years, meta = {}) {   // one tenor of a curve as a normal series
  const ck = key + '|' + years; if (curveCache.has(ck)) return curveCache.get(ck);
  const c = CURVES[key]; if (!c) return null;
  const j = c.tenors.findIndex(x => Math.abs(x - years) < 1e-6); if (j < 0) return null;
  const t = [], v = [];
  for (let i = 0; i < c.t.length; i++) if (c.y[i][j] != null) { t.push(c.t[i]); v.push(c.y[i][j]); }
  const s = { id: ck, label: `${c.label} ${c.names[j]}`, kind: 'yield', unit: '%', source: c.source, t, v, ...meta };
  curveCache.set(ck, s); return s;
}
function combine(a, b, fn, meta, maxGap = 7 * DAY) {   // align two series on a's dates (b as-of within maxGap)
  const t = [], v = [];
  for (let i = 0; i < a.t.length; i++) { const x = asOf(b, a.t[i]); if (x && a.t[i] - x.t < maxGap) { t.push(a.t[i]); v.push(fn(a.v[i], x.v)); } }
  return { kind: 'level', unit: '', source: '', ...meta, t, v };
}
function registerCurveSeries() {
  const reg = (id, key, yrs, label, group) => { const s = curveSeries(key, yrs); if (s && !has(id)) S[id] = { ...s, id, label, group }; };
  reg('JGB2Y', 'JP', 2, 'JGB 2Y yield', 'Rates · Japan'); reg('JGB10Y', 'JP', 10, 'JGB 10Y yield', 'Rates · Japan'); reg('JGB30Y', 'JP', 30, 'JGB 30Y yield', 'Rates · Japan');
  reg('EA2Y', 'EA', 2, 'Euro AAA 2Y yield', 'Rates · Euro area'); reg('EA10Y', 'EA', 10, 'Euro AAA 10Y yield', 'Rates · Euro area'); reg('EA30Y', 'EA', 30, 'Euro AAA 30Y yield', 'Rates · Euro area');
  // US from the Treasury curve when FRED is unavailable
  reg('UST3M', 'US', 0.25, 'UST 3M yield', 'Rates · US'); reg('UST2Y', 'US', 2, 'UST 2Y yield', 'Rates · US');
  reg('UST10Y', 'US', 10, 'UST 10Y yield', 'Rates · US'); reg('UST30Y', 'US', 30, 'UST 30Y yield', 'Rates · US');
  reg('REAL10Y', 'US_REAL', 10, 'UST 10Y real yield (TIPS)', 'Rates · US');
  if (!has('CURVE_2s10s') && has('UST2Y', 'UST10Y')) S.CURVE_2s10s = { ...combine(S.UST10Y, S.UST2Y, (a, b) => a - b), id: 'CURVE_2s10s', label: '2s10s curve', group: 'Rates · US', kind: 'yield', unit: '%', source: 'US Treasury' };
}
function renderCurve(c) {
  const key = state.fiMkt, cv = CURVES[key];
  if (!cv) return setEmpty(c, 'Curve data arrives with the next daily run.');
  const now = curveAt(key, state.to); if (!now) return setEmpty(c, 'No curve on or before this date.');
  const comps = [['1M ago', addMonths(now.t, -1)], ['3M ago', addMonths(now.t, -3)], ['1Y ago', addMonths(now.t, -12)]].map(([n, t]) => [n, curveAt(key, t)]).filter(x => x[1]);
  c.titleEl.textContent = `Yield curve: ${cv.label}`;
  setSource(c, { US: 'US Treasury, Daily Treasury Par Yield Curve Rates', US_REAL: 'US Treasury, Daily Treasury Par Real Yield Curve Rates', JP: 'Ministry of Finance Japan, JGB interest rates (jgbcme)', EA: 'ECB Data Portal, YC dataset (AAA-rated euro area government spot rates)' }[key]);
  c.subEl.textContent = `${cv.source}. Curve on ${nice(now.t)} against 1 month, 3 months and 1 year earlier; bars show the change by maturity.`;
  const names = cv.names, o = baseOpt();
  o.grid = [{ left: 8, right: 16, top: 34, height: '52%', containLabel: true }, { left: 8, right: 16, top: '70%', bottom: 8, containLabel: true }];
  o.axisPointer = { link: [{ xAxisIndex: 'all' }] };
  const cat = gi => ({ type: 'category', data: names, gridIndex: gi, boundaryGap: true, axisLabel: { color: tok('--muted'), fontSize: 11, show: gi === 1 }, axisLine: { lineStyle: { color: tok('--axis') } }, axisTick: { show: false } });
  o.xAxis = [cat(0), cat(1)];
  o.yAxis = [valAxis(v => fmtNum(v, 1) + '%', { gridIndex: 0 }), valAxis(v => fmtNum(v, 0) + 'bp', { gridIndex: 1, scale: false, splitNumber: 3 })];
  o.tooltip.formatter = ps => {
    const arr = Array.isArray(ps) ? ps : [ps]; if (!arr.length) return '';
    return `<div style="color:${tok('--ink-2')};margin-bottom:4px">${esc(cv.label)} ${esc(arr[0].axisValue)}</div>` + arr.filter(p => p.value != null).map(p =>
      `<div style="display:flex;gap:8px;align-items:center;line-height:1.6"><span style="width:12px;height:2px;background:${p.color};display:inline-block"></span><b style="font-variant-numeric:tabular-nums">${p.seriesIndex < 1 + comps.length ? fmtNum(p.value, 2) + '%' : (p.value > 0 ? '+' : '') + fmtNum(p.value, 0) + 'bp'}</b><span style="color:${tok('--ink-2')}">${esc(p.seriesName)}</span></div>`).join('');
  };
  const nowName = `${nice(now.t)}`;
  o.series = [{ ...line(nowName, now.y, col(0)), sampling: undefined, showSymbol: true, symbolSize: 6, lineStyle: { width: 3, color: col(0) }, connectNulls: true }];
  comps.forEach(([n, cc], i) => o.series.push({ ...line(`${n} (${nice(cc.t)})`, cc.y, col(i + 1)), sampling: undefined, showSymbol: true, symbolSize: 5, connectNulls: true }));
  comps.forEach(([n, cc], i) => o.series.push({ name: `Change vs ${n}`, type: 'bar', xAxisIndex: 1, yAxisIndex: 1, barGap: '10%', barMaxWidth: 12,
    data: now.y.map((y, j) => y == null || cc.y[j] == null ? null : +((y - cc.y[j]) * 100).toFixed(1)), itemStyle: { color: col(i + 1), borderRadius: 2 } }));
  o.legend.data = o.series.slice(0, 1 + comps.length).map(s => s.name);
  inst(c).setOption(o, true);
  c.csv = [['Tenor', nowName, ...comps.map(([n, cc]) => `${n} (${iso(cc.t)})`), ...comps.map(([n]) => `Change vs ${n} (bp)`)],
    ...names.map((nm, j) => [nm, now.y[j], ...comps.map(([, cc]) => cc.y[j]), ...comps.map(([, cc]) => now.y[j] == null || cc.y[j] == null ? '' : ((now.y[j] - cc.y[j]) * 100).toFixed(1))])];
  setNote(c, key === 'EA' ? 'ECB AAA curve is a fitted zero-coupon (spot) curve; US and Japan are par yields.' : '');
}
function renderXCurve(c) {
  const ks = ['US', 'JP', 'EA'].filter(k => CURVES[k]);
  if (!ks.length) return setEmpty(c, 'Curve data arrives with the next daily run.');
  const o = baseOpt(), list = [];
  o.series = ks.map((k, i) => { const a = curveAt(k, state.to); const data = a ? CURVES[k].tenors.map((x, j) => [x, a.y[j]]).filter(p => p[1] != null) : [];
    list.push({ name: CURVES[k].label, data, t: a && a.t });
    return { ...line(`${CURVES[k].label} (${a ? nice(a.t) : '–'})`, data, col(i)), sampling: undefined, showSymbol: true, symbolSize: 6 }; });
  o.xAxis = { type: 'value', min: 0, max: 40, name: 'maturity (years)', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: tok('--muted'), fontSize: 11 },
    axisLabel: { color: tok('--muted'), fontSize: 11 }, splitLine: { show: false }, axisLine: { lineStyle: { color: tok('--axis') } } };
  o.yAxis = valAxis(v => fmtNum(v, 1) + '%');
  o.grid.bottom = 28;
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => `<b>${fmtNum(p.value[1], 2)}%</b> <span style="color:${tok('--ink-2')}">${esc(p.seriesName)}, ${fmtNum(p.value[0], p.value[0] < 1 ? 2 : 0)}Y</span>` };
  inst(c).setOption(o, true);
  c.csv = [['Market', 'Date', 'Maturity (years)', 'Yield %'], ...list.flatMap(l => l.data.map(([x, y]) => [l.name, l.t ? iso(l.t) : '', x, y]))];
}
function slopeSeries(key, a, b, label) {
  const A = curveSeries(key, a), B = curveSeries(key, b); if (!A || !B) return null;
  return { name: label, data: pts(combine(B, A, (yb, ya) => (yb - ya) * 100), state.from, state.to) };
}
function renderSlopes(c) {
  const key = state.fiSlope; if (!CURVES[key]) return setEmpty(c, 'Curve data arrives with the next daily run.');
  const defs = { US: [[0.25, 10, '3m10y'], [2, 10, '2s10s'], [10, 30, '10s30s']], JP: [[1, 10, '1s10s'], [2, 10, '2s10s'], [10, 30, '10s30s']], EA: [[0.25, 10, '3m10y'], [2, 10, '2s10s'], [10, 30, '10s30s']] };
  const list = defs[key].map(([a, b, n]) => slopeSeries(key, a, b, n)).filter(Boolean);
  c.subEl.textContent = `${CURVES[key].label} curve slopes in bp. Below zero = inverted.`;
  drawLines(c, list, { fmt: v => fmtNum(v, 0) + 'bp', axisFmt: v => fmtNum(v, 0) + 'bp', zero: true, areas: key === 'US' ? recessionAreas(state.from, state.to) : null });
}
function renderTenY(c) {
  const list = [['US', 'UST 10Y'], ['JP', 'JGB 10Y'], ['EA', 'Euro AAA 10Y']].map(([k, n]) => { const s = curveSeries(k, 10); return s && { name: n, data: pts(s, state.from, state.to) }; }).filter(Boolean);
  if (!list.length) return setEmpty(c, 'Curve data arrives with the next daily run.');
  drawLines(c, list, { fmt: v => fmtNum(v, 2) + '%', axisFmt: v => fmtNum(v, 1) + '%' });
}
function renderDiff(c) {
  const k = state.fiDiff, fx = k === 'JP' ? 'USDJPY' : 'EURUSD';
  const us = curveSeries('US', 10), fo = curveSeries(k, 10);
  if (!us || !fo || !has(fx)) return setEmpty(c, 'Curve data arrives with the next daily run.');
  const spread = pts(combine(us, fo, (a, b) => (a - b) * 100), state.from, state.to), f = pts(S[fx], state.from, state.to);
  const nm = k === 'JP' ? 'US − Japan 10Y spread' : 'US − Euro AAA 10Y spread';
  c.subEl.textContent = `${nm} (bp) against ${S[fx].label}. A wider US yield advantage usually supports the USD.`;
  drawPair(c, { name: nm, data: spread }, { name: S[fx].label, data: f },
    { fmtA: v => fmtNum(v, 0) + 'bp', fmtB: v => fmtNum(v, autoDec(v)), axisA: v => fmtNum(v, 0) + 'bp', axisB: v => fmtNum(v, autoDec(v)) });
  const m = new Map(f.map(p => [p[0], p[1]])), pairs = spread.filter(p => m.has(p[0]));
  const wk = pairs.filter((p, i) => i % 5 === 0), dx = [], dy = [];
  for (let i = 1; i < wk.length; i++) { dx.push(wk[i][1] - wk[i - 1][1]); dy.push(Math.log(m.get(wk[i][0]) / m.get(wk[i - 1][0]))); }
  const r = pearson(dx, dy);
  setNote(c, r == null ? '' : `Correlation of weekly changes over the selected range: ${fmtCorr(r)} (spread vs ${S[fx].label}).`);
}
function renderHedged(c) {
  const us10 = curveSeries('US', 10), us3m = curveSeries('US', 0.25), jp10 = curveSeries('JP', 10), jp1 = curveSeries('JP', 1), ea10 = curveSeries('EA', 10), ea3m = curveSeries('EA', 0.25);
  if (!us10 || !us3m) return setEmpty(c, 'Curve data arrives with the next daily run.');
  const list = [];
  if (state.fiHedge === 'usd') {
    c.subEl.textContent = 'What a USD-based investor earns on 10Y government bonds after hedging the currency: foreign 10Y yield + (US short rate − foreign short rate).';
    list.push({ name: 'UST 10Y', data: pts(us10, state.from, state.to) });
    if (jp10 && jp1) { const carry = combine(us3m, jp1, (a, b) => a - b); list.push({ name: 'JGB 10Y, USD-hedged', data: pts(combine(jp10, carry, (a, b) => a + b), state.from, state.to) }); }
    if (ea10 && ea3m) { const carry = combine(us3m, ea3m, (a, b) => a - b); list.push({ name: 'Euro AAA 10Y, USD-hedged', data: pts(combine(ea10, carry, (a, b) => a + b), state.from, state.to) }); }
  } else {
    c.subEl.textContent = 'What a Japanese or euro-area investor earns on UST 10Y after hedging back to their currency: UST 10Y − (US short rate − home short rate), against their home 10Y.';
    if (jp10 && jp1) { const carry = combine(us3m, jp1, (a, b) => a - b);
      list.push({ name: 'UST 10Y, JPY-hedged', data: pts(combine(us10, carry, (a, b) => a - b), state.from, state.to) }, { name: 'JGB 10Y', data: pts(jp10, state.from, state.to) }); }
    if (ea10 && ea3m) { const carry = combine(us3m, ea3m, (a, b) => a - b);
      list.push({ name: 'UST 10Y, EUR-hedged', data: pts(combine(us10, carry, (a, b) => a - b), state.from, state.to) }, { name: 'Euro AAA 10Y', data: pts(ea10, state.from, state.to) }); }
  }
  drawLines(c, list, { fmt: v => fmtNum(v, 2) + '%', axisFmt: v => fmtNum(v, 1) + '%', zero: true, endLabels: false });
  setNote(c, 'Approximation: hedge cost ≈ short-rate differential (3-month bills; Japan uses the 1Y JGB as its shortest tenor). Ignores cross-currency basis, which can add or subtract 10–50bp. SGD-hedged view comes with the Singapore data phase.');
}
function renderReal(c) {
  const r5 = curveSeries('US_REAL', 5), r10 = curveSeries('US_REAL', 10), r30 = curveSeries('US_REAL', 30), n10 = curveSeries('US', 10);
  if (!r10 || !n10) return setEmpty(c, 'Curve data arrives with the next daily run.');
  const be = combine(n10, r10, (a, b) => a - b);
  drawLines(c, [{ name: 'Real 5Y', data: pts(r5, state.from, state.to) }, { name: 'Real 10Y', data: pts(r10, state.from, state.to) },
    { name: 'Real 30Y', data: pts(r30, state.from, state.to) }, { name: '10Y breakeven inflation', data: pts(be, state.from, state.to) }],
    { fmt: v => fmtNum(v, 2) + '%', axisFmt: v => fmtNum(v, 1) + '%', zero: true, endLabels: false });
  setNote(c, 'Breakeven = 10Y nominal − 10Y real (TIPS) par yield: the inflation rate the bond market is pricing.');
}
function buildFixedIncome() {
  const g = $('#fiGrid');
  makeCard(g, { key: 'curve', range: false, title: 'Yield curve', wide: true, tall: true, source: 'US Treasury, MOF Japan, ECB',
    seg: { key: 'fiMkt', options: CURVE_KEYS }, render: renderCurve });
  makeCard(g, { key: 'xcurve', range: false, title: 'Curves compared', sub: 'US, Japan and euro area AAA curves on the “To” date, by maturity.', source: 'US Treasury, MOF Japan, ECB', render: renderXCurve });
  makeCard(g, { key: 'teny', title: '10-year yields', sub: 'US Treasury, JGB and euro area AAA 10Y.', source: 'US Treasury, MOF Japan, ECB', render: renderTenY });
  makeCard(g, { key: 'slopes', title: 'Curve slopes', source: 'US Treasury, MOF Japan, ECB', seg: { key: 'fiSlope', options: [['US', 'US'], ['JP', 'Japan'], ['EA', 'Euro AAA']] }, render: renderSlopes });
  makeCard(g, { key: 'real', title: 'US real yields & breakeven', sub: 'TIPS real par yields and 10Y breakeven inflation, %.', source: 'US Treasury', render: renderReal });
  makeCard(g, { key: 'diff', title: 'Rate differentials vs FX', wide: true, tall: true, source: 'US Treasury, MOF Japan, ECB, Yahoo Finance',
    seg: { key: 'fiDiff', options: [['JP', 'US − Japan vs USD/JPY'], ['EA', 'US − Euro vs EUR/USD']] }, render: renderDiff });
  makeCard(g, { key: 'hedged', title: 'FX-hedged 10Y yields', wide: true, source: 'US Treasury, MOF Japan, ECB',
    seg: { key: 'fiHedge', options: [['usd', 'For a USD investor'], ['home', 'UST for JPY / EUR investors']] }, render: renderHedged });
}
function renderFixedIncome() { ['curve', 'xcurve', 'teny', 'slopes', 'real', 'diff', 'hedged'].forEach(k => cards[k].render()); }

// ------------------------------------------------------------------ ASIA & SINGAPORE
// S$NEER proxy: approximate trade weights (dashboard estimate - MAS does not publish the basket)
const SNEER_W = { CNY: 0.19, USD: 0.15, MYR: 0.13, EUR: 0.11, TWD: 0.07, JPY: 0.06, IDR: 0.06, KRW: 0.05, HKD: 0.04, THB: 0.04, INR: 0.03, AUD: 0.03, PHP: 0.02, GBP: 0.02 };
USD_PER.THB = ['USDTHB', -1]; USD_PER.PHP = ['USDPHP', -1];
const ASIA_FX = [['CNY', 'USDCNY', 'Chinese yuan'], ['JPY', 'USDJPY', 'Japanese yen'], ['KRW', 'USDKRW', 'Korean won'], ['TWD', 'USDTWD', 'Taiwan dollar'],
  ['SGD', 'USDSGD', 'Singapore dollar'], ['MYR', 'USDMYR', 'Malaysian ringgit'], ['IDR', 'USDIDR', 'Indonesian rupiah'], ['INR', 'USDINR', 'Indian rupee'],
  ['THB', 'USDTHB', 'Thai baht'], ['PHP', 'USDPHP', 'Philippine peso'], ['AUD', 'AUDUSD', 'Australian dollar']];
state.sgGrowth = 'nodx'; state.myMode = 'infl';
let sneerCache = null;
function sneerProxy() {   // weekly geometric index of SGD vs a trade-weighted basket, 100 = first week
  if (sneerCache) return sneerCache;
  if (!has('USDSGD')) return null;
  const W = sampled('USDSGD', 'W'), t = [], v = [];
  let base = null;
  for (let i = 0; i < W.t.length; i++) {
    const x = W.t[i], sgd = usdPerUnit('SGD', x); if (sgd == null) continue;
    let acc = 0, wsum = 0;
    for (const [ccy, w] of Object.entries(SNEER_W)) { const u = usdPerUnit(ccy, x); if (u == null) continue; acc += w * Math.log(sgd / u); wsum += w; }
    if (wsum < 0.9) continue;
    const lv = acc / wsum; if (base == null) base = lv;
    t.push(x); v.push(Math.exp(lv - base) * 100);
  }
  sneerCache = { id: 'SNEER', label: 'S$NEER proxy (dashboard estimate)', kind: 'price', unit: 'idx', source: 'Dashboard estimate from Yahoo Finance FX', t, v };
  return sneerCache;
}
function renderSneer(c) {
  const s = sneerProxy(); if (!s || s.t.length < 60) return setEmpty(c, 'Not enough FX history.');
  const p = pts(s, state.from, state.to); if (!p.length) return setEmpty(c, 'No data in range.');
  const b0 = p[0][1], lvl = p.map(([t, v]) => [t, v / b0 * 100]);
  const slope = [];   // 26-week change, annualised
  for (let i = 26; i < s.t.length; i++) if (s.t[i] >= state.from && s.t[i] <= state.to) slope.push([s.t[i], (Math.pow(s.v[i] / s.v[i - 26], 2) - 1) * 100]);
  drawPair(c, { name: 'S$NEER proxy (= 100 at range start)', data: lvl }, { name: 'Pace: 26-week change, annualised', data: slope },
    { fmtA: v => fmtNum(v, 2), fmtB: v => sign(v) + fmtNum(Math.abs(v), 2) + '% a year', axisA: v => fmtNum(v, 1), axisB: v => fmtNum(v, 1) + '%', zeroB: true });
  const last = slope[slope.length - 1];
  setNote(c, `Estimate only: MAS does not publish the S$NEER basket or band. Weights here approximate Singapore's trade shares (${Object.entries(SNEER_W).map(([k, w]) => `${k} ${Math.round(w * 100)}%`).join(', ')}). Up = stronger SGD. Latest pace ${last ? sign(last[1]) + fmtNum(Math.abs(last[1]), 1) + '% a year' : 'n/a'}; MAS steers the slope of the band, so watch changes in this pace around MAS policy statements (January, April, July, October).`);
}
function renderAsiaFx(c) {
  const rows = ASIA_FX.filter(([, id]) => has(id)).map(([ccy, id, name]) => {
    const s = S[id], a = asOf(s, state.to), b = asOf(s, state.from); if (!a || !b) return null;
    const usdPer = id === 'AUDUSD' ? (a.v / b.v - 1) : (b.v / a.v - 1);   // + = currency stronger vs USD
    return { ccy, name, id, chg: usdPer * 100 };
  }).filter(Boolean).sort((x, y) => x.chg - y.chg);
  if (!rows.length) return setEmpty(c, 'No FX data.');
  c.subEl.textContent = `Change vs USD from ${nice(state.from)} to ${nice(state.to)}. Positive = the Asian currency strengthened.`;
  const o = baseOpt(); o.legend.show = false;
  o.grid = { left: 8, right: 60, top: 8, bottom: 8, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => `<b>${sign(p.value)}${fmtNum(Math.abs(p.value), 2)}%</b> <span style="color:${tok('--ink-2')}">${esc(rows[p.dataIndex].name)} vs USD</span>` };
  o.xAxis = { type: 'value', axisLabel: { color: tok('--muted'), formatter: v => v + '%', fontSize: 11 }, splitLine: { lineStyle: { color: tok('--grid') } } };
  o.yAxis = { type: 'category', data: rows.map(r => r.name), axisLabel: { color: tok('--ink-2'), fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } };
  o.series = [{ type: 'bar', barWidth: '60%', data: rows.map(r => ({ value: +r.chg.toFixed(2), itemStyle: { color: r.chg >= 0 ? tok('--pos') : tok('--neg'), borderRadius: r.chg >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
    label: { show: true, position: 'right', color: tok('--ink-2'), fontSize: 11, formatter: p => sign(p.value) + fmtNum(Math.abs(p.value), 1) + '%' } }];
  c.chartEl.style.height = Math.max(300, rows.length * 28 + 30) + 'px';
  const ch = inst(c); ch.resize(); ch.setOption(o, true);
  c.csv = [['Currency', 'Change vs USD %'], ...rows.map(r => [r.name, r.chg.toFixed(2)])];
  setSource(c, srcOf(rows.map(r => r.id)));
}
function renderAsiaIdx(c) {
  const ids = ASIA_FX.filter(([ccy, id]) => ccy !== 'AUD' && has(id));
  if (ids.length < 5 || !has('DXY')) return setEmpty(c, 'Not enough FX data.');
  const W = sampled('USDSGD', 'W'), idx = [], dxy = [];
  let b = null, bd = null;
  for (const x of W.t) {
    if (x < state.from || x > state.to) continue;
    let acc = 0, n = 0; for (const [ccy] of ids) { const u = usdPerUnit(ccy, x); if (u != null) { acc += Math.log(u); n++; } }
    const d = asOf(S.DXY, x); if (n < ids.length - 1 || !d) continue;
    const lv = acc / n; if (b == null) { b = lv; bd = d.v; }
    idx.push([x, Math.exp(lv - b) * 100]); dxy.push([x, bd / d.v * 100]);
  }
  drawLines(c, [{ name: 'Asia FX index (equal-weight)', data: idx }, { name: 'US dollar index, inverted', data: dxy }], { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0) });
  setNote(c, `Both = 100 at range start; up = Asian currencies / non-USD stronger. Asia FX index is a dashboard estimate: equal-weight ${ids.map(x => x[0]).join(', ')} vs USD, weekly.`);
  setSource(c, 'Dashboard calculation from ' + srcOf(ids.map(x => x[1]).concat(['DXY'])));
}
function renderSgHedge(c) {
  const us10 = has('UST10Y') ? S.UST10Y : null, us3 = has('UST3M') ? S.UST3M : null;
  if (!us10 || !us3 || !has('SORA3M', 'SGS10Y')) return setEmpty(c, 'Waiting for data.');
  const carry = combine(us3, S.SORA3M, (a, b) => a - b, {}, 45 * DAY);
  const hedged = combine(us10, carry, (a, b) => a - b, {}, 10 * DAY);
  const list = [{ name: 'UST 10Y, SGD-hedged', data: pts(hedged, state.from, state.to) }, { name: 'UST 10Y, unhedged', data: pts(us10, state.from, state.to) },
    { name: 'SGS 10Y', data: pts(S.SGS10Y, state.from, state.to) }];
  drawLines(c, list, { fmt: v => fmtNum(v, 2) + '%', axisFmt: v => fmtNum(v, 1) + '%', zero: true, endLabels: false });
  const h = asOf(hedged, state.to), g = asOf(S.SGS10Y, state.to);
  setNote(c, `What an SGD-based investor earns on 10Y Treasuries after hedging the currency: UST 10Y − (US 3M bill − 3M compounded SORA).${h && g ? ` Latest: ${fmtNum(h.v, 2)}% hedged vs SGS 10Y ${fmtNum(g.v, 2)}% (${sign(h.v - g.v)}${fmtNum(Math.abs(h.v - g.v) * 100, 0)}bp pickup).` : ''} Approximation: SORA is monthly and backward-looking; real hedges use SGD forward points.`);
}
function regionKpis() {
  const box = $('#asiaKpis'); box.replaceChildren();
  const tile = (label, val, delta, foot) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: label }), el('div', { class: 'k-value', text: val }),
    el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: foot })));
  const yv = (id, label) => { if (!has(id)) return; const s = S[id], a = asOf(s, state.to); if (!a) return; const b = asOf(s, addMonths(a.t, -3));
    tile(label, fmtNum(a.v, 2) + '%', b ? `3M ${fmtChg(s, chg(s, b.v, a.v))}` : '', (s.source || '').split(' (')[0] + ' · ' + monthLab(a.t)); };
  yv('SORA3M', '3M compounded SORA'); yv('SGS10Y', 'SGS 10Y yield');
  if (has('UST10Y', 'SGS10Y')) { const g = asOf(S.SGS10Y, state.to), u = asOf(S.UST10Y, g.t + 31 * DAY); tile('UST − SGS 10Y', fmtNum((u.v - g.v) * 100, 0) + 'bp', 'US yield premium', 'month-end ' + monthLab(g.t)); }
  if (has('USDSGD')) { const s = S.USDSGD, a = asOf(s, state.to), b = asOf(s, addMonths(a.t, -1)); tile('USD/SGD', fmtNum(a.v, 4), `1M ${fmtChg(s, chg(s, b.v, a.v))}`, 'Yahoo Finance · ' + nice(a.t)); }
  const sn = sneerProxy(); if (sn && sn.t.length > 30) { const i = idxLE(sn, state.to); const pace = (Math.pow(sn.v[i] / sn.v[i - 26], 2) - 1) * 100;
    tile('S$NEER proxy pace', sign(pace) + fmtNum(Math.abs(pace), 1) + '% a yr', '26-week change, annualised', 'dashboard estimate'); }
  if (has('SG_CORE_YOY')) { const a = asOf(S.SG_CORE_YOY, state.to); tile('MAS core inflation', fmtNum(a.v, 1) + '%', has('SG_CPI_YOY') ? `headline ${fmtNum(asOf(S.SG_CPI_YOY, state.to).v, 1)}%` : '', 'SingStat · ' + monthLab(a.t)); }
  if (has('MY_OPR')) { const a = asOf(S.MY_OPR, state.to); tile('Malaysia OPR', fmtNum(a.v, 2) + '%', has('MY_CPI_YOY') ? `CPI ${fmtNum(asOf(S.MY_CPI_YOY, state.to).v, 1)}% YoY` : '', 'Bank Negara · ' + monthLab(a.t)); }
}
function seriesCard(ids, fmt, axisFmt, opts = {}) {
  return c => { const ok = ids.filter(id => has(id)); if (!ok.length) return setEmpty(c, 'Waiting for data.');
    drawLines(c, ok.map((id, i) => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(i) })), { fmt, axisFmt, endLabels: ok.length < 3, ...opts });
    setSource(c, srcOf(ok)); if (opts.note) setNote(c, opts.note); };
}
function buildAsia() {
  const g = $('#asiaGrid');
  const pct2 = v => fmtNum(v, 2) + '%', pct1 = v => fmtNum(v, 1) + '%';
  g.append(el('h3', { class: 'section', text: 'Singapore' }));
  makeCard(g, { key: 'sgrates', title: 'Singapore rates', sub: 'SORA, 3M compounded SORA and SGS yields, monthly (end of period).', render: seriesCard(['SORA', 'SORA3M', 'SGS2Y', 'SGS10Y'], pct2, pct1) });
  makeCard(g, { key: 'sgust', title: 'SGS vs US Treasury 10Y', sub: 'Singapore government 10Y (monthly) against UST 10Y (daily).', render: c => {
    seriesCard(['SGS10Y', 'UST10Y'], pct2, pct1)(c);
    if (has('SGS10Y', 'UST10Y')) { const gg = asOf(S.SGS10Y, state.to); if (gg) { const u = asOf(S.UST10Y, gg.t + 31 * DAY); setNote(c, `Latest month-end: SGS 10Y ${fmtNum(gg.v, 2)}% vs UST 10Y ${fmtNum(u.v, 2)}%, a ${fmtNum((u.v - gg.v) * 100, 0)}bp US premium.`); } } } });
  makeCard(g, { key: 'sghedge', title: 'UST 10Y for an SGD investor', wide: true, sub: 'Treasuries hedged back into SGD, against SGS 10Y.',
    source: 'US Treasury (3M, 10Y); MAS via SingStat (M700071: compounded SORA 3M, SGS 10Y); hedged yield calculated', render: renderSgHedge });
  makeCard(g, { key: 'sneer', title: 'S$NEER proxy', wide: true, tall: true, sub: 'Trade-weighted SGD (dashboard estimate) and its pace of appreciation.',
    source: 'Dashboard estimate from Yahoo Finance FX (SGD=X, CNY=X, MYR=X, EURUSD=X, TWD=X, JPY=X, IDR=X, KRW=X, HKD=X, THB=X, INR=X, AUDUSD=X, PHP=X, GBPUSD=X)', render: renderSneer });
  makeCard(g, { key: 'sginfl', title: 'Singapore inflation', sub: 'Headline CPI and MAS core inflation, year-on-year %.', render: seriesCard(['SG_CPI_YOY', 'SG_CORE_YOY'], pct1, pct1, { zero: true }) });
  makeCard(g, { key: 'sggrowth', title: 'Singapore activity', seg: { key: 'sgGrowth', options: [['nodx', 'NODX'], ['gdp', 'GDP'], ['jobs', 'Unemployment']] },
    render: c => {
      const m = { nodx: [['SG_NODX_YOY', 'SG_NODX_CN_YOY', 'SG_NODX_US_YOY'], 'Non-oil domestic exports, YoY % of 3-month sums: total, to China, to the US.'],
        gdp: [['SG_GDP_YOY'], 'Real GDP, year-on-year % (quarterly).'], jobs: [['SG_UNEMP'], 'Unemployment rate, seasonally adjusted (quarterly).'] }[state.sgGrowth];
      c.subEl.textContent = m[1]; seriesCard(m[0], pct1, v => fmtNum(v, 0) + '%', { zero: state.sgGrowth !== 'jobs' })(c); } });
  g.append(el('h3', { class: 'section', text: 'Asian currencies' }));
  makeCard(g, { key: 'asiafx', title: 'Asian FX vs USD', render: renderAsiaFx });
  makeCard(g, { key: 'asiaidx', title: 'Asia FX index vs USD', sub: 'Broad Asian currency strength against the dollar.', render: renderAsiaIdx });
  g.append(el('h3', { class: 'section', text: 'Malaysia' }));
  makeCard(g, { key: 'myrates', title: 'Malaysia: OPR and inflation', sub: 'Overnight Policy Rate and CPI (headline and core), year-on-year %.', render: seriesCard(['MY_OPR', 'MY_CPI_YOY', 'MY_CORE_YOY'], pct2, pct1, { zero: true }) });
  makeCard(g, { key: 'mygrowth', title: 'Malaysia: activity', seg: { key: 'myMode', options: [['infl', 'Production & exports'], ['gdp', 'GDP'], ['jobs', 'Unemployment']] },
    render: c => {
      const m = { infl: [['MY_IPI_YOY', 'MY_EXPORTS_YOY'], 'Industrial production YoY % and exports YoY % (3-month sums).'], gdp: [['MY_GDP_YOY'], 'Real GDP, year-on-year % (quarterly).'],
        jobs: [['MY_UNEMP'], 'Unemployment rate, monthly.'] }[state.myMode];
      c.subEl.textContent = m[1]; seriesCard(m[0], pct1, v => fmtNum(v, 0) + '%', { zero: state.myMode !== 'jobs' })(c); } });
}
function renderAsia() {
  regionKpis();
  ['sgrates', 'sgust', 'sghedge', 'sneer', 'sginfl', 'sggrowth', 'asiafx', 'asiaidx', 'myrates', 'mygrowth'].forEach(k => cards[k].render());
}

// ------------------------------------------------------------------ NEWS
let NEWS = null;
state.newsCat = 'All'; state.newsQ = '';
async function loadNews() {
  try { NEWS = await (await fetch('data/news.json', { cache: 'no-store' })).json(); } catch (e) { NEWS = NEWS || null; }
}
function timeAgo(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 60 ? `${Math.max(m, 0)}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
}
function newsList(items, limit) {
  const ul = el('ul', { class: 'news' });
  for (const n of items.slice(0, limit)) {
    const t = n.t ? Date.parse(n.t) : null;
    ul.append(el('li', {},
      el('span', { class: 'n-meta', title: t ? new Date(t).toLocaleString() : '' }, el('b', { text: t ? timeAgo(t) : '' }), ` · ${n.source}`),
      el('a', { href: n.link, target: '_blank', rel: 'noopener noreferrer', text: n.title })));
  }
  return ul;
}
function renderNews() {
  const box = $('#newsBody'); box.replaceChildren();
  if (!NEWS || !NEWS.items) { box.append(el('div', { class: 'empty', text: 'Headlines arrive with the next run (every 30 minutes).' })); return; }
  const cats = ['All', ...new Set(NEWS.items.map(n => n.cat))];
  const bar = el('div', { class: 'controls' });
  const seg = el('div', { class: 'presets' });
  for (const c of cats) seg.append(el('button', { type: 'button', text: c, class: c === state.newsCat ? 'on' : '', onclick: () => { state.newsCat = c; renderNews(); } }));
  const q = el('input', { type: 'search', placeholder: 'Filter headlines (e.g. Fed, China, oil)', value: state.newsQ, 'aria-label': 'Filter headlines' });
  q.addEventListener('input', () => { state.newsQ = q.value; const pos = q.selectionStart; renderNews(); const nq = $('#newsBody input[type=search]'); nq.focus(); nq.setSelectionRange(pos, pos); });
  const refresh = el('button', { class: 'ghost', type: 'button', text: '↻ Refresh', onclick: async () => { refresh.textContent = 'Loading…'; await loadNews(); renderNews(); } });
  bar.append(seg, q, refresh);
  const ql = state.newsQ.trim().toLowerCase();
  const items = NEWS.items.filter(n => (state.newsCat === 'All' || n.cat === state.newsCat) && (!ql || n.title.toLowerCase().includes(ql) || n.source.toLowerCase().includes(ql)));
  const ok = Object.entries(NEWS.feeds || {}).filter(([, v]) => v.startsWith('ok')).map(([k]) => k);
  const bad = Object.entries(NEWS.feeds || {}).filter(([, v]) => !v.startsWith('ok')).map(([k]) => k);
  box.append(bar,
    el('p', { class: 'muted small', text: `Headlines refreshed ${NEWS.updated_utc} (every 30 minutes; ↻ reloads the latest). ${items.length} of ${NEWS.items.length} shown. Links open the original publisher; paywalls may apply.` }),
    newsList(items, 200),
    el('p', { class: 'src', text: `Source: public RSS feeds: ${ok.join(', ')}.` + (bad.length ? ` Unavailable this run: ${bad.join(', ')}.` : '') }));
}
function renderHeadlinesCard(c) {
  const b = htmlBody(c);
  if (!NEWS || !NEWS.items) { b.append(el('div', { class: 'empty', text: 'Headlines arrive with the next run.' })); return; }
  b.append(newsList(NEWS.items, 10));
  setNote(c, `Refreshed ${NEWS.updated_utc}. More on the News tab.`);
  setSource(c, 'Public RSS feeds: ' + Object.entries(NEWS.feeds || {}).filter(([, v]) => v.startsWith('ok')).map(([k]) => k).join(', '));
}

// ------------------------------------------------------------------ CHINA & JAPAN
state.cnConf = 'bci'; state.jpAct = 'output'; state.jpBoj = 'assets';
function cnjpKpis() {
  const box = $('#cnjpKpis'); box.replaceChildren();
  const tile = (label, val, delta, foot) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: label }), el('div', { class: 'k-value', text: val }),
    el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: foot })));
  const lv = (id, label, fmt, dl) => { if (!has(id)) return; const s = S[id], a = asOf(s, state.to); if (!a) return; const b = asOf(s, addMonths(a.t, -3));
    tile(label, fmt(a.v), b ? `3M ${dl(a.v - b.v)}` : '', (s.source || '').split(' (')[0] + ' · ' + monthLab(a.t)); };
  const pp = d => sign(d) + fmtNum(Math.abs(d), 1) + 'pp', bp = d => sign(d) + fmtNum(Math.abs(d) * 100, 0) + 'bp', pt = d => sign(d) + fmtNum(Math.abs(d), 0) + 'pts';
  lv('CN_CPI_YOY', 'China CPI YoY', v => fmtNum(v, 1) + '%', pp);
  lv('CN_10Y', 'China 10Y yield', v => fmtNum(v, 2) + '%', bp);
  lv('CN_EXP_YOY', 'China exports YoY', v => sign(v) + fmtNum(Math.abs(v), 1) + '%', pp);
  lv('JP_CORE_YOY', 'Japan core CPI YoY', v => fmtNum(v, 1) + '%', pp);
  lv('JP_TANKAN_LM', 'Tankan large manufacturers', v => sign(v) + fmtNum(Math.abs(v), 0), pt);
  lv('JP_CALL', 'Japan call rate', v => fmtNum(v, 3) + '%', bp);
}
function idsCard(ids, fmt, axisFmt, opts = {}) {
  return c => { const ok = ids.filter(id => has(id)); if (!ok.length) return setEmpty(c, opts.empty || 'Waiting for data.');
    drawLines(c, ok.map((id, i) => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(i), extra: (opts.dashed || []).includes(id) ? { lineStyle: { width: 2, type: 'dashed', color: col(i) } } : {} })),
      { fmt, axisFmt, endLabels: ok.length < 3, ...opts });
    setSource(c, srcOf(ok)); if (opts.note) setNote(c, opts.note); };
}
function renderCnSpread(c) {
  if (!has('UST10Y', 'CN_10Y', 'USDCNY')) return setEmpty(c, 'Waiting for data.');
  const spread = pts(combine(S.CN_10Y, S.UST10Y, (cn, us) => (us - cn) * 100, {}, 40 * DAY), state.from, state.to);
  const f = pts(S.USDCNY, state.from, state.to), nm = 'US − China 10Y spread';
  drawPair(c, { name: nm, data: spread }, { name: 'USD/CNY', data: f },
    { fmtA: v => fmtNum(v, 0) + 'bp', fmtB: v => fmtNum(v, 4), axisA: v => fmtNum(v, 0) + 'bp', axisB: v => fmtNum(v, 2), zeroA: true });
  setSource(c, srcOf(['UST10Y', 'CN_10Y', 'USDCNY']) + '; spread calculated');
  setNote(c, 'China 10Y is a monthly average (OECD); UST 10Y daily, matched to the month. A US yield advantage over China puts weakening pressure on the yuan.');
}
function buildCnJp() {
  const g = $('#cnjpGrid'), p1 = v => fmtNum(v, 1) + '%', p2 = v => fmtNum(v, 2) + '%', a0 = v => fmtNum(v, 0) + '%';
  g.append(el('h3', { class: 'section', text: 'China' }));
  makeCard(g, { key: 'cn_infl', title: 'China: inflation and rates', sub: 'CPI year-on-year, 10Y government bond yield and 3M interbank rate, %. Monthly.',
    render: idsCard(['CN_CPI_YOY', 'CN_10Y', 'CN_3M'], p2, p1, { zero: true }) });
  makeCard(g, { key: 'cn_trade', title: 'China: trade', sub: 'Merchandise exports and imports, USD, seasonally adjusted, year-on-year %.',
    render: idsCard(['CN_EXP_YOY', 'CN_IMP_YOY'], p1, a0, { zero: true }) });
  makeCard(g, { key: 'cn_conf', title: 'China: confidence', seg: { key: 'cnConf', options: [['bci', 'Business (PMI)'], ['cci', 'Consumer']] },
    render: c => { const b = state.cnConf === 'bci';
      c.subEl.textContent = b ? 'OECD business confidence for China, built from the official NBS manufacturing PMI. 0 = long-run average.' : 'OECD consumer confidence for China (index, 100 = long-run average).';
      idsCard([b ? 'CN_BCI' : 'CN_CCI'], v => fmtNum(v, 1), v => fmtNum(v, 0), b ? { zero: true } : { hlines: [{ y: 100, label: 'average' }] })(c); } });
  makeCard(g, { key: 'cn_spread', title: 'US − China 10Y spread vs USD/CNY', tall: true, render: renderCnSpread });
  g.append(el('h3', { class: 'section', text: 'Japan' }));
  makeCard(g, { key: 'jp_infl', title: 'Japan: inflation', sub: 'CPI headline, core (ex fresh food, the BoJ focus) and core-core, plus producer prices; year-on-year %.',
    render: idsCard(['JP_CPI_YOY', 'JP_CORE_YOY', 'JP_CORECORE_YOY', 'JP_PPI_YOY'], p1, a0, { zero: true, hlines: [{ y: 2, label: 'BoJ 2% target' }],
      empty: 'Waiting for data.' }) });
  makeCard(g, { key: 'jp_policy', title: 'Japan: policy rate and JGB yields', sub: 'Uncollateralised overnight call rate (BoJ policy rate), JGB 2Y and 10Y, %.',
    render: idsCard(['JP_CALL', 'JGB2Y', 'JGB10Y'], v => fmtNum(v, 3) + '%', p1, { zero: true }) });
  makeCard(g, { key: 'jp_tankan', title: 'Japan: Tankan business conditions', sub: 'BoJ Tankan diffusion index, large enterprises (% good − % poor). Dashed = companies’ own forecast for the next quarter.',
    render: idsCard(['JP_TANKAN_LM', 'JP_TANKAN_LN', 'JP_TANKAN_LM_F', 'JP_TANKAN_LN_F'], v => sign(v) + fmtNum(Math.abs(v), 0), v => fmtNum(v, 0), { zero: true, dashed: ['JP_TANKAN_LM_F', 'JP_TANKAN_LN_F'] }) });
  makeCard(g, { key: 'jp_act', title: 'Japan: activity', seg: { key: 'jpAct', options: [['output', 'Output & trade'], ['labour', 'Labour']] },
    render: c => { const o = state.jpAct === 'output';
      c.subEl.textContent = o ? 'Industrial production, exports (USD, SA) and retail sales volume, year-on-year %.' : 'Hourly earnings year-on-year % and the unemployment rate, %.';
      idsCard(o ? ['JP_IP_YOY', 'JP_EXP_YOY', 'JP_RETAIL_YOY'] : ['JP_WAGES_YOY', 'JP_UNEMP'], p1, a0, { zero: true })(c); } });
  makeCard(g, { key: 'jp_boj', title: 'Bank of Japan balance sheet', seg: { key: 'jpBoj', options: [['assets', 'Total assets'], ['mb', 'Monetary base YoY']] },
    render: c => {
      if (state.jpBoj === 'assets') {
        c.subEl.textContent = 'Bank of Japan total assets, ¥ trillion (month-end).';
        if (!has('JP_BOJ_ASSETS')) return setEmpty(c, 'Waiting for data.');
        drawLines(c, [{ name: 'BoJ total assets', data: pts(S.JP_BOJ_ASSETS, state.from, state.to).map(([t, v]) => [t, v / 10000]) }], { fmt: v => '¥' + fmtNum(v, 0) + 'tn', axisFmt: v => '¥' + fmtNum(v, 0) + 'tn' });
        setSource(c, srcOf(['JP_BOJ_ASSETS']));
      } else { c.subEl.textContent = 'Monetary base, year-on-year %. Negative = the BoJ is shrinking its balance sheet.'; idsCard(['JP_MB_YOY'], p1, a0, { zero: true })(c); }
    } });
}
function renderCnJp() {
  cnjpKpis();
  ['cn_infl', 'cn_trade', 'cn_conf', 'cn_spread', 'jp_infl', 'jp_policy', 'jp_tankan', 'jp_act', 'jp_boj'].forEach(k => cards[k].render());
}
function renderCLI(c) {
  const ids = ['CLI_USA', 'CLI_CHN', 'CLI_JPN', 'CLI_DEU', 'CLI_KOR', 'CLI_IND'].filter(id => has(id));
  if (!ids.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, ids.map((id, i) => ({ name: S[id].label.replace(' leading indicator', ''), data: pts(S[id], state.from, state.to), color: col(i) })),
    { fmt: v => fmtNum(v, 2), axisFmt: v => fmtNum(v, 1), endLabels: false, hlines: [{ y: 100, label: 'trend' }] });
  setSource(c, 'OECD Composite Leading Indicators (amplitude adjusted)');
  const rising = ids.filter(id => { const s = S[id], a = asOf(s, state.to), b = a && asOf(s, addMonths(a.t, -3)); return a && b && a.v > b.v; });
  setNote(c, `Above 100 = growth above trend; the direction matters more than the level (rising = expanding momentum). Rising over the last 3 months: ${rising.length ? rising.map(id => S[id].label.replace(' leading indicator', '')).join(', ') : 'none'}.`);
}

// ------------------------------------------------------------------ AI
let AI = null;
const AI_BASKET = ['NVDA', 'AVGO', 'TSM', 'AMD', 'MSFT', 'GOOGL', 'AMZN', 'META'];
const fmtTok = v => v >= 1e12 ? fmtNum(v / 1e12, 1) + 'T' : v >= 1e9 ? fmtNum(v / 1e9, 1) + 'B' : fmtNum(v / 1e6, 1) + 'M';
const usd = v => v >= 1e9 ? '$' + fmtNum(v / 1e9, v >= 1e10 ? 0 : 1) + 'bn' : '$' + fmtNum(v / 1e6, 0) + 'm';
const OR_SRC = 'OpenRouter rankings (openrouter.ai/rankings) and models API; benchmark scores from Artificial Analysis as shown on OpenRouter';
const EPOCH_SRC = 'Epoch AI data (epoch.ai/data, CC BY 4.0)';
function hbar(c, rows, { valFmt, label, color }) {
  const o = baseOpt(); o.legend.show = false;
  o.grid = { left: 8, right: 70, top: 8, bottom: 8, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => { const r = rows[p.dataIndex]; return `<b>${esc(valFmt(r.v))}</b> <span style="color:${tok('--ink-2')}">${esc(r.name)}</span>` + (r.tip ? `<br><span style="color:${tok('--ink-2')}">${esc(r.tip)}</span>` : ''); } };
  o.xAxis = { type: 'value', axisLabel: { color: tok('--muted'), fontSize: 11, formatter: v => valFmt(v) }, splitLine: { lineStyle: { color: tok('--grid') } } };
  o.yAxis = { type: 'category', inverse: true, data: rows.map(r => r.name), axisLabel: { color: tok('--ink-2'), fontSize: 11, width: 190, overflow: 'truncate' }, axisLine: { show: false }, axisTick: { show: false } };
  o.series = [{ type: 'bar', barWidth: '62%', data: rows.map(r => ({ value: r.v, itemStyle: { color: color || tok('--s1'), borderRadius: [0, 4, 4, 0] } })),
    label: { show: true, position: 'right', color: tok('--ink-2'), fontSize: 11, formatter: p => valFmt(p.value) } }];
  c.chartEl.style.height = Math.max(260, rows.length * 24 + 30) + 'px';
  const ch = inst(c); ch.resize(); ch.setOption(o, true);
  c.csv = [[label, 'Value'], ...rows.map(r => [r.name, r.v])];
}
function aiKpis() {
  const box = $('#aiKpis'); box.replaceChildren();
  const tile = (label, val, delta, foot) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: label }), el('div', { class: 'k-value', text: val }),
    el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: foot })));
  const o = AI && AI.openrouter, h = o && o.history;
  if (o && o.week && o.week.length) {
    const tot = o.week.reduce((a, r) => a + r.tokens, 0);
    const n = h ? h.top20_weekly_tokens.length : 0, prev = n > 7 ? h.top20_weekly_tokens[n - 8] : null;
    tile('OpenRouter weekly tokens', fmtTok(tot), prev ? `vs a week earlier ${sign(tot / prev - 1)}${fmtNum(Math.abs(tot / prev - 1) * 100, 0)}%` : 'top 20 models; history builds daily', 'week to ' + o.week_date);
    const wp = h && h.usage_weighted_input_price[n - 1]; if (wp != null) tile('Avg price paid, input', '$' + fmtNum(wp, 3) + '/M tokens', 'usage-weighted, top 20 models', 'OpenRouter');
    const cp = h && h.request_weighted_cost_per_request_cents[n - 1]; if (cp != null) tile('Avg cost per request', fmtNum(cp, 2) + '¢', 'request-weighted, top 20 models', 'OpenRouter');
    const fr = (o.scatter || []).slice().sort((a, b) => b.intel - a.intel)[0];
    if (fr) tile('Frontier model (intelligence)', fmtNum(fr.intel, 1), fr.name, 'Artificial Analysis index');
    const near = h && h.cheapest_near_frontier_price[n - 1]; if (near != null) tile('Cheapest near-frontier', '$' + fmtNum(near, 2) + '/M', 'input price, within 5 pts of the top score', 'OpenRouter');
  }
  const ids = AI_BASKET.filter(id => has(id));
  if (ids.length && has('SPX')) {
    const ytd = id => { const s = S[id], a = asOf(s, state.to), b = asOf(s, Date.UTC(new Date(a.t).getUTCFullYear() - 1, 11, 31)); return b ? a.v / b.v - 1 : null; };
    const avg = ids.map(ytd).filter(x => x != null); const bk = avg.reduce((a, b) => a + b, 0) / avg.length, sp = ytd('SPX');
    tile('AI equity basket, YTD', sign(bk) + fmtNum(Math.abs(bk) * 100, 1) + '%', `S&P 500 ${sign(sp)}${fmtNum(Math.abs(sp) * 100, 1)}%`, 'equal-weight, 8 stocks');
  }
}
function renderAiUsage(c) {
  const o = AI && AI.openrouter; if (!o || !o.week || !o.week.length) return setEmpty(c, 'Waiting for OpenRouter data (next daily run).');
  c.subEl.textContent = `Tokens processed through OpenRouter in the week to ${o.week_date}, top 20 models. OpenRouter is one marketplace (mostly developers and apps), not the whole AI market.`;
  hbar(c, o.week.map(r => ({ name: r.name, v: r.tokens, tip: `${r.org} · input $${r.price_in != null ? fmtNum(r.price_in, 3) : '–'}/M · ${r.cpr_cents != null ? fmtNum(r.cpr_cents, 2) + '¢ per request' : ''}` })), { valFmt: fmtTok, label: 'Model' });
  setSource(c, OR_SRC);
}
function renderAiShare(c) {
  const o = AI && AI.openrouter; if (!o || !o.week || !o.week.length) return setEmpty(c, 'Waiting for OpenRouter data.');
  const by = {}; let tot = 0; for (const r of o.week) { by[r.org] = (by[r.org] || 0) + r.tokens; tot += r.tokens; }
  const rows = Object.entries(by).map(([k, v]) => ({ name: k, v: v / tot * 100 })).sort((a, b) => b.v - a.v);
  c.subEl.textContent = `Share of top-20 model tokens by model maker, week to ${o.week_date}.`;
  hbar(c, rows, { valFmt: v => fmtNum(v, 1) + '%', label: 'Model maker', color: tok('--s2') });
  setSource(c, OR_SRC);
}
function renderAiHistory(c) {
  const h = AI && AI.openrouter && AI.openrouter.history;
  if (!h || !h.date || h.date.length < 2) return setEmpty(c, `OpenRouter only publishes the current week, so this dashboard archives a snapshot every day. The history line starts ${h && h.date ? h.date[0] : 'with the first run'} and fills in over the coming weeks.`);
  const t = h.date.map(d => Date.parse(d));
  drawPair(c, { name: 'Weekly tokens, top 20 models', data: t.map((x, i) => [x, h.top20_weekly_tokens[i]]) }, { name: 'Usage-weighted input price ($/M)', data: t.map((x, i) => [x, h.usage_weighted_input_price[i]]) },
    { fmtA: fmtTok, fmtB: v => '$' + fmtNum(v, 3), axisA: fmtTok, axisB: v => '$' + fmtNum(v, 2) });
  setSource(c, OR_SRC + '; archived daily by this dashboard');
}
function renderAiFrontier(c) {
  const o = AI && AI.openrouter; if (!o || !o.scatter || !o.scatter.length) return setEmpty(c, 'Waiting for OpenRouter data.');
  const pts_ = o.scatter.filter(x => x.wprice > 0);
  // Pareto frontier: best score at or below each price
  const sorted = pts_.slice().sort((a, b) => a.wprice - b.wprice); let best = -1; const pareto = new Set();
  for (const p of sorted) if (p.intel > best) { best = p.intel; pareto.add(p.slug); }
  const o2 = baseOpt(); o2.legend.show = false;
  o2.grid = { left: 8, right: 24, top: 14, bottom: 30, containLabel: true };
  o2.tooltip = { ...o2.tooltip, trigger: 'item', formatter: p => { const d = pts_[p.dataIndex]; return `<b>${esc(d.name)}</b><br>Intelligence ${fmtNum(d.intel, 1)} · $${fmtNum(d.wprice, 3)}/M input` + (d.cpr_cents != null ? ` · ${fmtNum(d.cpr_cents, 2)}¢/request` : ''); } };
  o2.xAxis = { type: 'log', name: 'usage-weighted input price, $ per million tokens (log scale)', nameLocation: 'middle', nameGap: 28, nameTextStyle: { color: tok('--muted'), fontSize: 11 },
    axisLabel: { color: tok('--muted'), fontSize: 11, formatter: v => '$' + v }, splitLine: { lineStyle: { color: tok('--grid') } } };
  o2.yAxis = valAxis(v => fmtNum(v, 0), { name: 'intelligence index', nameTextStyle: { color: tok('--muted'), fontSize: 11 } });
  o2.series = [{ type: 'scatter', data: pts_.map(d => ({ value: [d.wprice, d.intel], symbolSize: pareto.has(d.slug) ? 11 : 8,
      itemStyle: { color: pareto.has(d.slug) ? tok('--s1') : hexA(tok('--s1'), 0.35), borderColor: tok('--surface'), borderWidth: 1.5 },
      label: { show: pareto.has(d.slug), formatter: d.name.split(': ').pop().slice(0, 22), position: 'right', fontSize: 10, color: tok('--ink-2') } })) },
    { type: 'line', step: 'end', data: sorted.filter(p => pareto.has(p.slug)).map(p => [p.wprice, p.intel]), showSymbol: false, lineStyle: { color: tok('--s1'), width: 1, type: 'dashed' }, silent: true }];
  c.chartEl.style.height = '420px';
  const ch = inst(c); ch.resize(); ch.setOption(o2, true);
  c.csv = [['Model', 'Intelligence', 'Input $/M (usage-weighted)', 'Cost per request (¢)'], ...pts_.map(d => [d.name, d.intel, d.wprice, d.cpr_cents ?? ''])];
  setNote(c, 'Each dot is a model. Highlighted dots form the price/performance frontier: the most capable model at or below each price. Moving down and right over time = AI getting cheaper for the same capability.');
  setSource(c, OR_SRC);
}
function renderAiCost(c) {
  const o = AI && AI.openrouter; if (!o || !o.week) return setEmpty(c, 'Waiting for OpenRouter data.');
  const rows = o.week.filter(r => r.cpr_cents != null).slice(0, 15).map(r => ({ name: r.name, v: r.cpr_cents, tip: `${fmtTok(r.tokens)} tokens this week` })).sort((a, b) => b.v - a.v);
  c.subEl.textContent = 'Average cost of one request (a "task" sent to the model) for the most-used models, US cents. Reflects both price per token and how much each request uses.';
  hbar(c, rows, { valFmt: v => fmtNum(v, 2) + '¢', label: 'Model', color: tok('--s3') });
  setNote(c, 'OpenRouter publishes this figure without a unit; it is consistent with US cents (e.g. GPT-4, with an 8k-token limit, shows 1.38, i.e. about 460 tokens at $30/M).');
  setSource(c, OR_SRC);
}
function epochLines(c, obj, { fmt, axisFmt, log = false, dashed = {} }) {
  const names = Object.keys(obj || {}); if (!names.length) return setEmpty(c, 'Waiting for Epoch AI data.');
  const list = names.map((n, i) => ({ name: n, data: obj[n].map(([d, v]) => [Date.parse(d), v]).filter(p => p[0] >= state.from && p[0] <= state.to), color: col(i),
    extra: dashed[n] ? { lineStyle: { width: 2, type: 'dashed', color: col(i) } } : { showSymbol: true, symbolSize: 5 } })).filter(l => l.data.length);
  drawLines(c, list, { fmt, axisFmt, endLabels: list.length <= 4, yExtra: log ? { type: 'log' } : {} });
}
function buildAI() {
  const g = $('#aiGrid');
  g.append(el('h3', { class: 'section', text: 'Adoption: who is using what (OpenRouter)' }));
  makeCard(g, { key: 'ai_usage', title: 'Most-used models this week', range: false, render: renderAiUsage });
  makeCard(g, { key: 'ai_share', title: 'Share by model maker', range: false, render: renderAiShare });
  makeCard(g, { key: 'ai_hist', title: 'Token volume and price paid over time', wide: true, render: renderAiHistory });
  g.append(el('h3', { class: 'section', text: 'Prices and cost per task' }));
  makeCard(g, { key: 'ai_frontier', title: 'Price vs capability', range: false, render: renderAiFrontier });
  makeCard(g, { key: 'ai_cpr', title: 'Cost per request', range: false, render: renderAiCost });
  g.append(el('h3', { class: 'section', text: 'Capability, revenue and build-out (Epoch AI)' }));
  makeCard(g, { key: 'ai_bench', title: 'Frontier capability over time', defaultRange: '5Y', sub: 'Best score to date on two hard benchmarks: GPQA Diamond (PhD-level science questions) and SWE-bench Verified (real software engineering tasks), %.',
    render: c => { const e = AI && AI.epoch; if (!e) return setEmpty(c, 'Waiting for Epoch AI data.');
      const step = a => (a || []).map(([d, v]) => [Date.parse(d), v]).filter(p => p[0] >= state.from && p[0] <= state.to);
      drawLines(c, [{ name: 'GPQA Diamond', data: step(e.gpqa), extra: { step: 'end' } }, { name: 'SWE-bench Verified', data: step(e.swe), extra: { step: 'end' } }],
        { fmt: v => fmtNum(v, 1) + '%', axisFmt: v => v + '%', yExtra: { max: 100 } });
      const lg = (e.gpqa || []).slice(-1)[0]; setNote(c, lg ? `Latest GPQA record: ${lg[1]}% by ${lg[2]} (${lg[3]}, ${lg[0]}).` : ''); setSource(c, EPOCH_SRC + ': benchmark_data'); } });
  makeCard(g, { key: 'ai_rev', title: 'AI lab revenue (annualised run rate)', defaultRange: '5Y', sub: 'Reported annualised revenue, USD, log scale. Points are individual reports collected by Epoch AI.',
    render: c => { epochLines(c, AI && AI.epoch && AI.epoch.revenue, { fmt: usd, axisFmt: usd, log: true }); setSource(c, EPOCH_SRC + ': ai_companies (revenue reports)'); } });
  makeCard(g, { key: 'ai_dc', title: 'AI data-centre power capacity', defaultRange: '5Y', sub: 'Total power of the large AI data centres Epoch AI tracks, gigawatts. Dashed = announced / projected.',
    render: c => { const e = AI && AI.epoch; if (!e || !e.dc_power) return setEmpty(c, 'Waiting for Epoch AI data.');
      const lim = p => p.map(([d, v]) => [Date.parse(d), v / 1000]).filter(p => p[0] >= state.from);
      drawLines(c, [{ name: 'Built', data: lim(e.dc_power) }, { name: 'Planned', data: lim([e.dc_power[e.dc_power.length - 1], ...(e.dc_planned || [])]), extra: { lineStyle: { width: 2, type: 'dashed', color: col(1) } } }],
        { fmt: v => fmtNum(v, 1) + ' GW', axisFmt: v => fmtNum(v, 0) + ' GW' });
      inst(c).setOption({ xAxis: { max: null } });
      setNote(c, `${e.dc_count} data centres tracked. For scale, 1 GW is roughly the output of a large nuclear reactor.`); setSource(c, EPOCH_SRC + ': data_centers (timelines)'); } });
  makeCard(g, { key: 'ai_chips', title: 'AI chips shipped (cumulative compute)', defaultRange: '5Y', sub: 'Cumulative AI accelerator compute shipped since 2022 by chip designer, in millions of Nvidia H100-equivalents.',
    render: c => { const e = AI && AI.epoch; const ch = e && e.chips ? Object.fromEntries(Object.entries(e.chips).map(([k, v]) => [k, v.map(([d, x]) => [d, x / 1e6])])) : null;
      epochLines(c, ch, { fmt: v => fmtNum(v, 2) + 'm H100e', axisFmt: v => fmtNum(v, 0) + 'm' }); setSource(c, EPOCH_SRC + ': ai_chip_sales (cumulative by designer)'); } });
  g.append(el('h3', { class: 'section', text: 'Markets' }));
  makeCard(g, { key: 'ai_eq', title: 'AI equity basket vs S&P 500', wide: true, sub: 'Equal-weight Nvidia, Broadcom, TSMC, AMD, Microsoft, Alphabet, Amazon and Meta (= 100 at range start), against the S&P 500 and the semiconductor ETF.',
    render: c => { const ids = AI_BASKET.filter(id => has(id)); if (!ids.length || !has('SPX')) return setEmpty(c, 'Waiting for data (next daily run).');
      const base = {}; ids.forEach(id => { const a = asOf(S[id], state.from) || { v: S[id].v[0] }; base[id] = a.v; });
      const b = []; for (const [t] of pts(S.SPX, state.from, state.to)) { let x = 0, n = 0; for (const id of ids) { const a = asOf(S[id], t); if (a) { x += a.v / base[id]; n++; } } if (n === ids.length) b.push([t, x / n * 100]); }
      const reb = id => { const p = pts(S[id], state.from, state.to), b0 = asOf(S[id], state.from) || (p[0] && { v: p[0][1] }); return b0 ? p.map(([t, v]) => [t, v / b0.v * 100]) : []; };
      drawLines(c, [{ name: 'AI basket', data: b }, { name: 'S&P 500', data: reb('SPX') }, ...(has('SMH') ? [{ name: 'Semiconductors (SMH)', data: reb('SMH') }] : [])], { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0) });
      setSource(c, srcOf([...ids, 'SPX', 'SMH']) + '; basket calculated'); } });
}
function renderAI() {
  aiKpis();
  ['ai_usage', 'ai_share', 'ai_hist', 'ai_frontier', 'ai_cpr', 'ai_bench', 'ai_rev', 'ai_dc', 'ai_chips', 'ai_eq'].forEach(k => cards[k].render());
}

// ------------------------------------------------------------------ MARKETS
const GROUP_ORDER = ['Equities · US', 'Equities · Europe', 'Equities · Japan', 'Equities · China/HK', 'Equities · N. Asia',
  'Equities · ASEAN', 'Equities · India', 'Equities · Australia', 'Equities · LatAm', 'Equities · Global', 'Equities · AI', 'Equities · US sectors',
  'Rates · US', 'Rates · Japan', 'Rates · Euro area', 'Rates · Singapore', 'Rates · Malaysia', 'Rates · China', 'Credit', 'Bonds & credit', 'FX', 'Commodities', 'Crypto', 'Volatility'];
const PERF_FRED = ['UST2Y', 'UST10Y', 'UST30Y', 'REAL10Y', 'BE10Y', 'CURVE_2s10s', 'HY_OAS', 'IG_OAS', 'JGB2Y', 'JGB10Y', 'JGB30Y', 'EA2Y', 'EA10Y', 'EA30Y', 'SORA3M', 'SGS2Y', 'SGS10Y', 'MY_OPR', 'CN_10Y', 'JP_CALL'];
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
    setSource(c1, srcOf(pr));
  }
  c2.root.hidden = !yl.length;
  if (yl.length) {
    setSource(c2, srcOf(yl));
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
  'Rates & commodities': ['UST2Y', 'UST10Y', 'REAL10Y', 'JGB10Y', 'EA10Y', 'TLT', 'GOLD', 'SILVER', 'BRENT', 'COPPER', 'NATGAS', 'DXY', 'AUDUSD'],
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
  setSource(c, srcOf(ids) + '; correlations calculated');
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
  setSource(c, srcOf([a, b]) + '; correlation calculated');
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
  host(mc, { key: 'matrix', range: false, title: 'Correlation matrix', source: 'Yahoo Finance, FRED', render: renderCorrMatrix });
  host(sc, { key: 'shifts', range: false, title: 'Biggest shifts vs 3-year norm', sub: 'Pairs in this universe, same window. Click one to chart it.', source: 'Yahoo Finance, FRED', render: () => cards.matrix.render() });
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
  state.from = presetFrom(p, to);
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
  ({ overview: renderOverview, news: renderNews, liquidity: renderLiquidity, regime: renderRegime, fixed: renderFixedIncome, asia: renderAsia, cnjp: renderCnJp, ai: renderAI, markets: renderMarkets, correlation: renderCorrelation })[state.tab]();
}
const TAB_TITLES = { overview: 'Strategist View', news: 'News', regime: 'Regime & Leading Indicators', liquidity: 'Liquidity', asia: 'Asia & Singapore',
  cnjp: 'China & Japan', markets: 'Markets', fixed: 'Fixed Income', correlation: 'Correlation', ai: 'AI: adoption, prices & capex' };
function setTab(t) {
  state.tab = t;
  $('#pageTitle').textContent = TAB_TITLES[t] || '';
  $('#side').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false');
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  document.querySelectorAll('.tab-panel').forEach(p => p.hidden = p.id !== 'tab-' + t);
  $('.filters').hidden = t === 'news';
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
  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => { setTab(b.dataset.tab); scrollTo({ top: 0 }); }));
  $('#menuBtn').addEventListener('click', () => { const o = $('#side').classList.toggle('open'); $('#menuBtn').setAttribute('aria-expanded', String(o)); });
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
  const [meta, y, f, d, cv, as] = await Promise.allSettled(['data/meta.json', 'data/yahoo.json', 'data/fred.json', 'data/derived.json', 'data/curves.json', 'data/asia.json'].map(loadJSON));
  await loadNews();
  try { AI = await loadJSON('data/ai.json'); } catch (e) { AI = null; }
  setInterval(async () => { await loadNews(); if (state.tab === 'news') renderNews(); }, 10 * 60 * 1000);
  META = meta.status === 'fulfilled' ? meta.value : {};
  for (const res of [y, f, d, as]) if (res.status === 'fulfilled') {
    for (const [id, s] of Object.entries(res.value)) { S[id] = { id, ...s, t: s.d.map(x => x * DAY), v: s.v }; delete S[id].d; }
  }
  if (cv.status === 'fulfilled') {
    for (const [k, c] of Object.entries(cv.value)) CURVES[k] = { ...c, t: c.d.map(x => x * DAY) };
    registerCurveSeries();
  }
  // latest trading day = most recent close among the major indices (ignores stray weekend bars)
  const lasts = ['SPX', 'SX5E', 'NKY', 'HSI', 'STI'].filter(id => has(id)).map(id => S[id].t[S[id].t.length - 1]);
  state.latest = lasts.length ? Math.max(...lasts) : Date.now();
  $('#asof').textContent = `Data to ${nice(state.latest)}` + (META.updated_utc ? ` · refreshed ${META.updated_utc}` : '');
  const fredOk = has('NET_LIQ');
  const pill = $('#status');
  if (META.total) {
    pill.hidden = false;
    pill.textContent = fredOk ? `${META.ok}/${META.total} series live` : `${META.ok}/${META.total} series · FRED pending`;
    const bad = Object.entries(META.status || {}).filter(([, v]) => v !== 'ok').map(([k, v]) => `${k}: ${v}`);
    pill.title = (bad.length ? bad.join('\n') : 'All series refreshed') +
      ('fred_key_found' in META ? `\n\nFRED API key on GitHub: ${META.fred_key_found ? 'found' : 'NOT found'}` : '') +
      ((META.errors || []).length ? '\nErrors:\n' + META.errors.join('\n') : '');
  }
  // restore view from URL
  const h = new URLSearchParams(location.hash.slice(1));
  applyPreset(['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', '10Y', 'MAX'].includes(h.get('range')) ? h.get('range') : '3Y');
  if (h.get('from') && h.get('to')) {
    const fr = Date.parse(h.get('from')), to = Date.parse(h.get('to'));
    if (!isNaN(fr) && !isNaN(to) && fr < to) { state.preset = 'custom'; state.from = fr; state.to = Math.min(to, state.latest); }
  }
  buildOverview(); buildLiquidity(); buildRegime(); buildFixedIncome(); buildAsia(); buildCnJp(); buildAI(); buildMarkets(); buildCorrelation(); applySources(); applyPairToggles(); wire();
  setTab(['overview', 'news', 'liquidity', 'regime', 'fixed', 'asia', 'cnjp', 'markets', 'correlation', 'ai'].includes(h.get('tab')) ? h.get('tab') : 'overview');
}
init();
