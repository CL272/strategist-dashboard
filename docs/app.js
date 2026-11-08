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
  if (o.seg && o.seg.select) {   // compact drop-down (e.g. currency choice)
    const sel = el('select', { class: 'mini-select', 'aria-label': o.seg.label || 'Option', title: o.seg.label || '' });
    for (const [val, lab] of o.seg.options) sel.append(el('option', { value: val, text: lab }));
    sel.value = state[o.seg.key];
    sel.addEventListener('change', () => { state[o.seg.key] = sel.value; (o.seg.onchange || c.render)(); });
    c.segSel = sel;
    tools.append(o.seg.prefix ? el('label', { class: 'mini-label' }, el('span', { class: 'muted small', text: o.seg.prefix }), sel) : sel);
  } else if (o.seg) {
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
  c.yBtn = el('button', { class: 'ghost', type: 'button', text: '↕ Y', title: 'Set the y-axis range by hand', onclick: () => toggleYPanel(c) });
  tools.append(c.yBtn,
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
    el('div', { class: 'card-head' }, el('div', {}, c.titleEl), tools), c.subEl,
    c.chartEl, c.emptyEl, c.yPanel = el('div', { class: 'y-panel', hidden: true }), c.rangeEl, c.noteEl, c.srcEl);
  parent.append(c.root);
  setSource(c, o.source || '');
  c.render = () => {
    if (!subActive(c.root)) return;   // drawn when its sub-tab is opened
    const keep = [state.from, state.to];
    if (c.range) [state.from, state.to] = resolveRange(c.range);
    if (o.earliest != null && c.range && c.range.preset === 'MAX') state.from = o.earliest;
    c.lastRange = [state.from, state.to];
    try { o.render(c); applyYRange(c); } catch (e) { console.error(o.key, e); setEmpty(c, 'Could not draw this chart.'); }
    finally { [state.from, state.to] = keep; }
    c.yBtn.hidden = !valueAxes(c).length;
    if (c.rangeEl) syncCardRange(c);
  };
  cards[o.key] = c;
  return c;
}
// ---- y-axis: hand-set min / max per axis (left, right), kept until reset
function valueAxes(c) {   // [{i, name, extent:[lo,hi]}] for the chart's numeric y axes
  if (!c.inst || c.chartEl.hidden) return [];
  const opt = c.inst.getOption(), out = [];
  (opt.yAxis || []).forEach((ax, i) => {
    if (ax.type !== 'value') return;
    let ext = null;
    try { ext = c.inst.getModel().getComponent('yAxis', i).axis.scale.getExtent(); } catch (e) { /* not drawn yet */ }
    const name = (opt.yAxis.length > 1 ? (ax.position === 'right' ? 'Right' : i === 0 ? 'Left' : 'Lower') : 'Y') + ' axis';
    out.push({ i, name, ext });
  });
  return out;
}
function applyYRange(c) {
  if (!c.yRange || !c.inst || c.chartEl.hidden) return;
  const n = (c.inst.getOption().yAxis || []).length;
  const patch = [];
  for (let i = 0; i < n; i++) {
    const r = c.yRange[i];
    const q = {}; if (r && r.min != null) q.min = r.min; if (r && r.max != null) q.max = r.max;
    patch.push(q);
  }
  c.inst.setOption({ yAxis: patch });
  c.yBtn.classList.toggle('on', Object.values(c.yRange).some(r => r && (r.min != null || r.max != null)));
}
function toggleYPanel(c) {
  if (!c.yPanel.hidden) { c.yPanel.hidden = true; return; }
  const axes = valueAxes(c);
  c.yPanel.replaceChildren();
  if (!axes.length) { c.yPanel.append(el('span', { class: 'muted small', text: 'This view has no numeric y-axis to adjust.' })); c.yPanel.hidden = false; return; }
  const inputs = [];
  const dec = v => Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 1 ? 2 : 4;
  for (const a of axes) {
    const cur = (c.yRange && c.yRange[a.i]) || {};
    const lo = el('input', { type: 'number', step: 'any', 'aria-label': a.name + ' minimum', placeholder: a.ext ? (+a.ext[0].toFixed(dec(a.ext[0]))).toString() : 'auto' });
    const hi = el('input', { type: 'number', step: 'any', 'aria-label': a.name + ' maximum', placeholder: a.ext ? (+a.ext[1].toFixed(dec(a.ext[1]))).toString() : 'auto' });
    if (cur.min != null) lo.value = cur.min; if (cur.max != null) hi.value = cur.max;
    inputs.push([a.i, lo, hi]);
    c.yPanel.append(el('span', { class: 'y-axis' }, el('b', { class: 'small', text: a.name }), el('span', { class: 'muted small', text: 'min' }), lo, el('span', { class: 'muted small', text: 'max' }), hi));
  }
  const apply = () => {
    c.yRange = {};
    for (const [i, lo, hi] of inputs) {
      const a = lo.value === '' ? null : +lo.value, b = hi.value === '' ? null : +hi.value;
      if (a != null && b != null && a >= b) continue;
      c.yRange[i] = { min: a, max: b };
    }
    c.render();
  };
  inputs.forEach(([, lo, hi]) => [lo, hi].forEach(x => x.addEventListener('keydown', e => { if (e.key === 'Enter') apply(); })));
  c.yPanel.append(el('button', { type: 'button', text: 'Apply', onclick: apply }),
    el('button', { type: 'button', class: 'ghost', text: 'Auto', title: 'Back to automatic scaling', onclick: () => { c.yRange = null; c.yBtn.classList.remove('on'); c.yPanel.hidden = true; c.render(); } }),
    el('span', { class: 'muted small', text: 'Blank = automatic. Grey numbers show the current range.' }));
  c.yPanel.hidden = false;
}
function setSource(c, txt) { c.source = txt; c.srcEl.textContent = txt ? 'Source: ' + txt : ''; c.srcEl.hidden = !txt; }
function srcOf(ids) {   // merge "Provider (detail)" sources: Yahoo Finance (A), Yahoo Finance (B) -> Yahoo Finance (A, B)
  const by = new Map();
  for (const id of ids) {
    const src = S[id] && S[id].source; if (!src) continue;
    const m = src.match(/^(.*?)\s*\((.*)\)\s*(.*)$/);
    const prov = m ? m[1] + (m[3] ? (/^[,;.]/.test(m[3]) ? '' : ' ') + m[3] : '') : src, det = m ? m[2] : '';
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
  if (series.length < 2 || series.length > 4 || series.some(s => s.name.length > 26)) return 0;
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
  const top = 12 + 22 * legendRows(c, [A.name, B.name]);
  if (overlay) {
    o.grid = { left: 8, right: 8, top, bottom: 8, containLabel: true };
    o.xAxis = timeAxis();
    o.yAxis = [tint(valAxis(axisA), ca), tint(valAxis(axisB, { position: 'right', splitLine: { show: false } }), cb)];
  } else {
    o.grid = [{ left: 8, right: 16, top, height: '40%', containLabel: true }, { left: 8, right: 16, top: '58%', bottom: 8, containLabel: true }];
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
function legendRows(c, names) {   // how many lines the legend wraps onto at this card width
  const w = (c.chartEl.clientWidth || 600) - 16; let rows = 1, x = 0;
  for (const n of names) { const iw = n.length * 6.6 + 30; if (x > 0 && x + iw > w) { rows++; x = iw; } else x += iw; }
  return rows;
}
function endsTooClose(list) {   // end labels collide when the last values sit close together
  const last = list.map(s => s.data.length ? s.data[s.data.length - 1][1] : null).filter(v => v != null);
  const all = list.flatMap(s => s.data.map(p => p[1])).filter(v => v != null);
  if (last.length < 2 || !all.length) return false;
  const span = Math.max(...all) - Math.min(...all) || 1;
  last.sort((a, b) => a - b);
  return last.some((v, i) => i > 0 && (v - last[i - 1]) / span < 0.07);
}
function drawLines(c, list, { fmt = v => fmtNum(v, autoDec(v)), axisFmt, zero = false, yExtra = {}, endLabels = true, hlines = [], areas = null } = {}) {
  if (endLabels && endsTooClose(list)) endLabels = false;
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
  o.grid.top = series.length > 1 ? 12 + 22 * legendRows(c, list.map(s => s.name)) : 14;
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
// stress thresholds from the earlier Streamlit version (legacy/pages/01_liquidity.py)
const SCARCITY = {
  RES_GDP: { band: [10, 11], name: 'Waller band', who: 'Fed Governor Waller: reserves of about 10–11% of GDP mark the edge of "ample" (2025 speeches)' },
  RES_ASSETS: { band: [8.5, 9], name: 'Acharya threshold', who: 'Acharya et al. (NY Fed / NYU, 2022–24): repo and funding spreads start to react when reserves fall to about 8.5–9% of bank assets' },
};
function scarcityStatus(v, [lo, hi]) { return v > hi ? ['ample', '--good'] : v >= lo ? ['approaching scarcity', '--serious'] : ['scarce', '--critical']; }
state.m2Mode = 'spx';
function monthlyYoY(s) {   // month-end values -> YoY % series stamped at month start
  const me = monthEnds(s), keys = [...me.keys()].sort((a, b) => a - b), t = [], v = [];
  for (const k of keys) { const p = me.get(addMonths(k, -12)); if (p) { t.push(k); v.push((me.get(k) / p - 1) * 100); } }
  return { t, v };
}
let spxYoY = null;
function renderM2(c) {
  if (!has('M2_YOY')) return setEmpty(c, NO_FRED);
  const pct = v => fmtNum(v, 1) + '%';
  if (state.m2Mode === 'm2' || !has('SPX')) {
    c.subEl.textContent = 'Year-on-year %, monthly.';
    setSource(c, 'Federal Reserve via FRED (M2SL); YoY calculated');
    return simple(['M2_YOY'], pct, pct, { zero: true })(c);
  }
  const base = has('LH_SPX') ? S.LH_SPX : S.SPX;
  spxYoY = spxYoY || { ...monthlyYoY(base), label: 'S&P 500 YoY', unit: '%', kind: 'level' };
  const lag = state.m2Mode === 'lead' ? 6 : 0;
  const m2 = S.M2_YOY, shifted = lag ? { t: m2.t.map(t => addMonths(t, lag)), v: m2.v } : m2;
  drawPair(c, { name: lag ? 'M2 YoY, moved forward 6 months' : 'M2 YoY', data: pts(shifted, state.from, state.to + lag * 31 * DAY) },
    { name: 'S&P 500 YoY (price)', data: pts(spxYoY, state.from, state.to) }, { fmtA: pct, fmtB: pct, axisA: pct, axisB: pct, zeroA: true, zeroB: true });
  if (lag) inst(c).setOption({ xAxis: c.pairMode === 'stack' ? [{ max: state.to + lag * 31 * DAY }, { max: state.to + lag * 31 * DAY }] : { max: state.to + lag * 31 * DAY } });
  c.subEl.textContent = lag ? 'M2 growth shifted 6 months ahead, to test whether money growth leads equity returns. Left axis M2, right axis S&P 500, both YoY %.'
    : 'Year-on-year %, monthly: money supply growth (left axis) against S&P 500 price change (right axis).';
  setSource(c, 'Federal Reserve via FRED (M2SL); S&P 500 from Yahoo Finance (^GSPC); YoY calculated');
  // correlation of the two monthly YoY series over the visible range
  const a = [], b = [];
  for (let i = 0; i < shifted.t.length; i++) { const t = shifted.t[i]; if (t < state.from || t > state.to) continue; const j = idxLE(spxYoY, t); if (j >= 0 && spxYoY.t[j] === t) { a.push(shifted.v[i]); b.push(spxYoY.v[j]); } }
  const r = pearson(a, b), la = asOf(m2, state.to), lb = asOf(spxYoY, state.to);
  setNote(c, `Latest: M2 ${la ? pct(la.v) : '–'} YoY (${la ? monthLab(la.t) : ''}), S&P 500 ${lb ? sign(lb.v) + fmtNum(Math.abs(lb.v), 1) + '%' : '–'} YoY.` +
    (r != null ? ` Correlation over this range${lag ? ' with the 6-month lead' : ''}: ${fmtCorr(r)} (${a.length} months). ` : ' ') +
    'Faster money growth tends to support asset prices, but the link is loose and changes over time; the 2020–22 surge and contraction is the extreme case.');
}
function renderScarcity(c) {
  const ids = ['RES_GDP', 'RES_ASSETS'].filter(id => has(id));
  if (!ids.length) return setEmpty(c, NO_FRED);
  const list = ids.map((id, i) => {
    const color = col(i), { band, name } = SCARCITY[id];
    return { name: S[id].label, data: pts(S[id], state.from, state.to), color, extra: {
      markArea: { silent: true, itemStyle: { color: hexA(color, 0.14) }, data: [[{ yAxis: band[0], name: `${name} ${band[0]}–${band[1]}%`,
        label: { color, fontSize: 11, position: 'insideLeft', fontWeight: 600 } }, { yAxis: band[1] }]] } } };
  });
  const lowest = Math.min(...ids.map(id => SCARCITY[id].band[0]));
  drawLines(c, list, { fmt: v => fmtNum(v, 1) + '%', axisFmt: v => fmtNum(v, 0) + '%', yExtra: { min: v => Math.floor(Math.min(v.min, lowest - 0.5)) } });
  const parts = ids.map(id => {
    const s = S[id], a = asOf(s, state.to); if (!a) return '';
    const { band, name } = SCARCITY[id], [st] = scarcityStatus(a.v, band);
    const hist = s.v.slice(0, a.i + 1).filter(x => x != null), below = hist.filter(x => x <= a.v).length;
    const where = a.v > band[1] ? fmtNum(a.v - band[1], 1) + ' pts above' : a.v >= band[0] ? 'inside' : fmtNum(band[0] - a.v, 1) + ' pts below';
    return `${s.label} ${fmtNum(a.v, 1)}%: ${st.toUpperCase()} (${where} the ${name} of ${band[0]}–${band[1]}%; ${Math.round(below / hist.length * 100)}th percentile since ${new Date(s.t[0]).getUTCFullYear()})`;
  }).filter(Boolean);
  setNote(c, parts.join(' · ') + '. Shaded bands = where stress starts: above the band reserves are ample, inside it they are approaching scarcity, below it they are scarce. ' + ids.map(id => SCARCITY[id].who).join('. ') + '.');
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
    sub: 'Bank reserves as a share of nominal GDP and of commercial bank assets, with the levels where stress starts shaded. Into the bands, reserves move from ample towards scarce and repo spreads (Repo funding stress chart) tend to react.',
    render: renderScarcity });
  makeCard(g, { key: 'nfci', title: 'Chicago Fed financial conditions (NFCI)', sub: 'Weekly. Below zero = looser than the long-run average.', source: 'FRED (NFCI)',
    render: simple(['NFCI'], v => fmtNum(v, 2), v => fmtNum(v, 2), { zero: true }) });
  makeCard(g, { key: 'm2', title: 'US M2 vs S&P 500', source: 'FRED (M2SL); Yahoo Finance (^GSPC)',
    seg: { key: 'm2Mode', options: [['spx', 'vs S&P'], ['lead', '6m lead'], ['m2', 'M2']] }, render: renderM2 });
  makeCard(g, { key: 'rates', title: 'US Treasury yields', source: 'FRED',
    seg: { key: 'ratesMode', options: [['yields', 'Yields'], ['curve', 'Curve']] }, render: renderRates });
}
function renderLiquidity() {
  liquidityKpis(); liquiditySignals();
  ['netliq', 'comp', 'fund', 'scarcity', 'gcb', 'credit', 'nfci', 'm2', 'rates'].forEach(k => cards[k].render());
}

// ------------------------------------------------------------------ OVERVIEW (Strategist View)
const LOCAL_CCY = { SX5E: 'EUR', DAX: 'EUR', CAC: 'EUR', UKX: 'GBP', NKY: 'JPY', TOPIX: 'JPY', AS51: 'AUD', CSI300: 'CNY', SHCOMP: 'CNY',
  HSI: 'HKD', HSCEI: 'HKD', STI: 'SGD', KLCI: 'MYR', JCI: 'IDR', KOSPI: 'KRW', TWSE: 'TWD', NIFTY: 'INR', IBOV: 'BRL' };
const USD_PER = { EUR: ['EURUSD', 1], GBP: ['GBPUSD', 1], AUD: ['AUDUSD', 1], JPY: ['USDJPY', -1], CNY: ['USDCNY', -1], HKD: ['USDHKD', -1],
  SGD: ['USDSGD', -1], MYR: ['USDMYR', -1], IDR: ['USDIDR', -1], KRW: ['USDKRW', -1], TWD: ['USDTWD', -1], INR: ['USDINR', -1], BRL: ['USDBRL', -1],
  THB: ['USDTHB', -1], PHP: ['USDPHP', -1] };
const CCY_CHOICES = [['local', 'Local currency'], ['USD', 'in USD'], ['SGD', 'in SGD'], ['MYR', 'in MYR'], ['EUR', 'in EUR'], ['GBP', 'in GBP'], ['JPY', 'in JPY'], ['AUD', 'in AUD']];
// prices that can be re-expressed in another currency: equities, commodities, crypto and USD ETFs (not FX pairs, yields or vol)
const convertible = id => S[id] && S[id].kind === 'price' && !/^FX/.test(S[id].group || '') && S[id].unit !== 'USD tn';
const OV_EQ = ['SPX', 'NDX', 'SX5E', 'UKX', 'NKY', 'TOPIX', 'CSI300', 'HSI', 'KOSPI', 'TWSE', 'STI', 'KLCI', 'JCI', 'NIFTY', 'AS51', 'IBOV'];
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
    const conv = g === 'Equities' || g.startsWith('Commodities');
    tb.append(el('tr', { class: 'grp' }, el('td', { colspan: cols.length + 5, text: g + (conv && tgt !== 'local' ? ` · in ${tgt}` : '') })));
    for (const id of ok) {
      const s0 = S[id], s = conv && convertible(id) ? inCcy(id, tgt) : s0;
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
  setNote(c, `Changes to ${nice(state.to)}. ${tgt === 'local' ? 'Equities in local currency, commodities and crypto in USD.' : `Equities, commodities and crypto converted to ${tgt} at daily FX (markets already priced in ${tgt} are unchanged).`} Yields and spreads in bp, VIX/MOVE in points. ▲/▼ = above/below the 200-day average. Bold σ = an unusual week (|σ| ≥ 2).`);
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
  if (has('STRESS_COMPOSITE')) { const a = asOf(S.STRESS_COMPOSITE, state.to), [lab, tk] = legacyBand(a.v);
    tile('Stress composite', `${Math.round(a.v)}th pct`, lab, 'Funding · Credit · Growth vs 10 years', tk); }
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
  if (has('STRESS_COMPOSITE')) { const a = asOf(S.STRESS_COMPOSITE, to), bl = ['Funding', 'Credit', 'Growth'].filter(k => has(STRESS_IDS[k])).map(k => `${k} ${Math.round(asOf(S[STRESS_IDS[k]], to).v)}`);
    out.push(`Stress: composite at the ${Math.round(a.v)}th percentile of the last 10 years (${legacyBand(a.v)[0].toLowerCase()}); blocks: ${bl.join(', ')}.`); }
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
  makeCard(g, { key: 'fragile', range: false, title: 'Market stress gauges', sub: 'Market-priced stress gauges ranked against their own last 10 years. The full composite is on the Stress & Signposts page.', source: 'FRED, Yahoo Finance', render: renderFragile });
  makeCard(g, { key: 'where', range: false, title: 'Where we are', wide: true, sub: 'Cross-asset snapshot. Switch the currency to see equity and commodity returns as a USD, SGD, MYR, EUR, GBP, JPY or AUD investor.', source: 'Yahoo Finance, FRED',
    seg: { key: 'ovCcy', select: true, label: 'Currency for equity moves', options: CCY_CHOICES }, render: renderWhere });
  for (const k of ['points', 'headlines', 'fragile', 'where']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
}
const CARD_SOURCES = {"netliq": "FRED (WALCL Fed total assets, WDTGAL Treasury General Account, RRPONTSYD overnight reverse repo); S&P 500 from Yahoo Finance (^GSPC)", "comp": "FRED (WALCL, WRESBAL, WDTGAL, RRPONTSYD)", "fund": "FRED (SOFR, EFFR, IORB)", "scarcity": "FRED (WRESBAL reserves, GDP nominal GDP, TLAACBW027SBOG commercial bank assets); ratios calculated", "gcb": "FRED (WALCL Fed, ECBASSETSW ECB, JPNASSETS BoJ; FX DEXUSEU, DEXJPUS); USD conversion calculated", "nfci": "Chicago Fed via FRED (NFCI)", "quad": "Dashboard calculation from FRED (CFNAI, INDPRO, PAYEMS, RRSFS, ICSA, CPIAUCSL, CPILFESL, PCEPILFE)", "comp_gi": "Dashboard calculation from FRED (CFNAI, INDPRO, PAYEMS, RRSFS, ICSA, CPIAUCSL, CPILFESL, PCEPILFE); recession shading NBER (USREC)", "regtable": "Regimes: dashboard calculation from FRED; returns: Yahoo Finance prices (ETFs adjusted for dividends)", "zg": "FRED (CFNAI, INDPRO, PAYEMS, RRSFS, ICSA); z-scores calculated; recession shading NBER (USREC)", "zi": "FRED (CPIAUCSL, CPILFESL, PCEPILFE); z-scores calculated; recession shading NBER (USREC)", "sahm": "FRED (SAHMREALTIME); recession shading NBER (USREC)", "recprob": "Yield-curve model: NY Fed method applied to FRED T10Y3M; Chauvet-Piger: FRED (RECPROUSM156N)", "infl": "BLS via FRED (CPIAUCSL, CPILFESL); BEA via FRED (PCEPILFE); YoY calculated", "claims": "US Department of Labor via FRED (ICSA)", "points": "Calculated from the data on this dashboard (Yahoo Finance, FRED, US Treasury, MOF Japan, ECB, SingStat)", "moved": "Yahoo Finance (prices, FX, VIX/MOVE); FRED, US Treasury, MOF Japan, ECB (yields, spreads); σ calculated", "fragile": "Yahoo Finance (^VIX, ^MOVE); FRED (BAA10Y, BAMLH0A0HYM2, NFCI, STLFSI4, SOFR, IORB); percentiles calculated", "where": "Yahoo Finance (indices, FX, commodities, crypto, VIX/MOVE); FRED / US Treasury / MOF Japan / ECB (yields); FRED (credit spreads); hover a row for its exact source", "xcurve": "US Treasury (Daily Par Yield Curve); Ministry of Finance Japan (JGB interest rates); ECB Data Portal (YC, AAA euro area government spot curve)", "teny": "US Treasury (Daily Par Yield Curve, 10Y); MOF Japan (JGB 10Y); ECB Data Portal (YC SR_10Y)", "slopes": "US Treasury / MOF Japan / ECB Data Portal curves; spreads calculated; recession shading NBER (USREC)", "real": "US Treasury (Daily Par Real Yield Curve and Par Yield Curve); breakeven calculated", "diff": "US Treasury, MOF Japan, ECB Data Portal (10Y yields); Yahoo Finance (JPY=X, EURUSD=X)", "hedged": "US Treasury (3M, 10Y), MOF Japan (1Y, 10Y), ECB Data Portal (3M, 10Y); hedged yields calculated", "shifts": "Yahoo Finance and FRED / US Treasury / MOF Japan / ECB series; correlations calculated"};
function applyPairToggles() { for (const k of ['netliq', 'diff', 'sneer', 'cn_spread', 'lei', 'leadlag', 'cugold', 'cycdef', 'vol_ratio', 'pos_hist']) if (cards[k]) pairToggle(cards[k]); }
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
  if (has('MY_OPR')) { const a = asOf(S.MY_OPR, state.to); tile('Malaysia OPR', fmtNum(a.v, 2) + '%', has('MY_CPI_YOY') ? `CPI ${fmtNum(asOf(S.MY_CPI_YOY, state.to).v, 1)}% YoY` : '', 'Bank Negara · ' + monthLab(a.t)); }
  if (has('USDMYR')) { const s = S.USDMYR, a = asOf(s, state.to), b = asOf(s, addMonths(a.t, -1)); tile('USD/MYR', fmtNum(a.v, 4), `1M ${fmtChg(s, chg(s, b.v, a.v))}`, 'Yahoo Finance · ' + nice(a.t)); }
  if (has('KLCI')) { const s = S.KLCI, a = asOf(s, state.to), b = asOf(s, Date.UTC(new Date(a.t).getUTCFullYear() - 1, 11, 31)); tile('FBM KLCI', fmtNum(a.v, 0), b ? `YTD ${fmtChg(s, chg(s, b.v, a.v))}` : '', 'Yahoo Finance · ' + nice(a.t)); }
  if (has('MY_LEADING')) { const y = yoyOf('MY_LEADING'), a = asOf(y, state.to); if (a) tile('Malaysia leading index', sign(a.v) + fmtNum(Math.abs(a.v), 1) + '% YoY', has('MY_LEAD_DIFF') ? `diffusion ${fmtNum(asOf(S.MY_LEAD_DIFF, state.to).v, 0)}%` : '', 'DOSM · ' + monthLab(a.t)); }
  yv('SORA3M', '3M compounded SORA'); yv('SGS10Y', 'SGS 10Y yield');
  if (has('UST10Y', 'SGS10Y')) { const g = asOf(S.SGS10Y, state.to), u = asOf(S.UST10Y, g.t + 31 * DAY); tile('UST − SGS 10Y', fmtNum((u.v - g.v) * 100, 0) + 'bp', 'US yield premium', 'month-end ' + monthLab(g.t)); }
  if (has('USDSGD')) { const s = S.USDSGD, a = asOf(s, state.to), b = asOf(s, addMonths(a.t, -1)); tile('USD/SGD', fmtNum(a.v, 4), `1M ${fmtChg(s, chg(s, b.v, a.v))}`, 'Yahoo Finance · ' + nice(a.t)); }
  const sn = sneerProxy(); if (sn && sn.t.length > 30) { const i = idxLE(sn, state.to); const pace = (Math.pow(sn.v[i] / sn.v[i - 26], 2) - 1) * 100;
    tile('S$NEER proxy pace', sign(pace) + fmtNum(Math.abs(pace), 1) + '% a yr', '26-week change, annualised', 'dashboard estimate'); }
  if (has('SG_CORE_YOY')) { const a = asOf(S.SG_CORE_YOY, state.to); tile('MAS core inflation', fmtNum(a.v, 1) + '%', has('SG_CPI_YOY') ? `headline ${fmtNum(asOf(S.SG_CPI_YOY, state.to).v, 1)}%` : '', 'SingStat · ' + monthLab(a.t)); }
  if (has('AU_CASH')) { const a = asOf(S.AU_CASH, state.to); tile('RBA cash rate', fmtNum(a.v, 2) + '%', has('AU_TRIM_YOY') ? `trimmed-mean CPI ${fmtNum(asOf(S.AU_TRIM_YOY, state.to).v, 1)}%` : '', 'RBA · ' + monthLab(a.t)); }
  yv('AU_10Y', 'Australia 10Y yield');
}
function seriesCard(ids, fmt, axisFmt, opts = {}) {
  return c => { const ok = ids.filter(id => has(id)); if (!ok.length) return setEmpty(c, 'Waiting for data.');
    drawLines(c, ok.map((id, i) => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(i) })), { fmt, axisFmt, endLabels: ok.length < 3, ...opts });
    setSource(c, srcOf(ok)); if (opts.note) setNote(c, opts.note); };
}
const pct1 = v => fmtNum(v, 1) + '%', pct2 = v => fmtNum(v, 2) + '%', pct0 = v => fmtNum(v, 0) + '%';
function yoyOf(id, k = 12) {   // YoY % of a monthly index series (cached)
  const key = id + '_YOYc'; if (S[key]) return S[key];
  const s = S[id], t = [], v = [];
  for (let i = k; i < s.t.length; i++) if (s.v[i - k]) { t.push(s.t[i]); v.push((s.v[i] / s.v[i - k] - 1) * 100); }
  return (S[key] = { ...s, id: key, label: s.label.replace(/ \(DOSM\)$/, '') + ' YoY', unit: '%', t, v });
}
// MYR against the currencies Malaysian clients care about: + = ringgit stronger
const MYR_VS = [['USD', 'US dollar'], ['SGD', 'Singapore dollar'], ['EUR', 'Euro'], ['GBP', 'Pound'], ['JPY', 'Yen'], ['AUD', 'Australian dollar'], ['CNY', 'Chinese yuan']];
function myrCross(ccy) {   // value of 1 MYR in ccy, daily
  const key = 'MYR_IN_' + ccy; if (S[key]) return S[key];
  const base = S.USDMYR, t = [], v = [];
  if (!base) return null;
  for (const x of base.t) { const a = usdPerUnit('MYR', x), b = usdPerUnit(ccy, x); if (a != null && b != null) { t.push(x); v.push(a / b); } }
  return (S[key] = { id: key, label: `MYR in ${ccy}`, unit: ccy, kind: 'price', source: 'Cross rates calculated from Yahoo Finance (MYR=X and USD crosses)', t, v });
}
function renderMyrFx(c) {
  if (!has('USDMYR')) return setEmpty(c, 'Waiting for FX data.');
  const list = [];
  MYR_VS.forEach(([ccy, name], i) => {
    const s = ccy === 'USD' ? { t: S.USDMYR.t, v: S.USDMYR.v.map(x => 1 / x) } : myrCross(ccy); if (!s || !s.t.length) return;
    const p = pts(s, state.from, state.to), b = asOf(s, state.from) || (p[0] && { v: p[0][1] }); if (!b) return;
    list.push({ name: 'vs ' + name, data: p.map(([t, v]) => [t, v / b.v * 100]), color: col(i) });
  });
  drawLines(c, list, { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0), hlines: [{ y: 100, label: '' }], endLabels: false });
  const last = list.map(l => [l.name, l.data.length ? l.data[l.data.length - 1][1] - 100 : null]).filter(x => x[1] != null).sort((a, b) => b[1] - a[1]);
  setNote(c, `Ringgit value in each currency, 100 on ${nice(state.from)}; up = MYR stronger. Over this range: ${last.map(([n, v]) => `${n.replace('vs ', '')} ${sign(v)}${fmtNum(Math.abs(v), 1)}%`).join(', ')}.`);
  setSource(c, 'Yahoo Finance (MYR=X, SGD=X, EURUSD=X, GBPUSD=X, JPY=X, AUDUSD=X, CNY=X); cross rates calculated');
}
function renderMyrTable(c) {
  if (!has('USDMYR')) return setEmpty(c, 'Waiting for FX data.');
  const b = htmlBody(c);
  const cols = [['1W', t => t - 7 * DAY], ['1M', t => addMonths(t, -1)], ['3M', t => addMonths(t, -3)], ['YTD', t => Date.UTC(new Date(t).getUTCFullYear() - 1, 11, 31)], ['1Y', t => addMonths(t, -12)]];
  const tbl = el('table', { class: 'perf' }), hr = el('tr', {}, el('th', { text: 'Rate' }), el('th', { text: 'Last' }));
  cols.forEach(([k]) => hr.append(el('th', { text: k }))); tbl.append(el('thead', {}, hr));
  const tb = el('tbody'), csv = [['Rate', 'Last', ...cols.map(x => x[0])]], pos = tok('--pos'), neg = tok('--neg');
  for (const [ccy] of MYR_VS) {
    // quote as MYR per unit of foreign currency (how Malaysians read it), change shown as MYR strength
    const s = ccy === 'USD' ? S.USDMYR : (() => { const x = myrCross(ccy); return x && { ...x, v: x.v.map(y => 1 / y) }; })();
    if (!s || !s.t.length) continue;
    const a = asOf(s, state.to); if (!a) continue;
    const label = `${ccy}/MYR` + (ccy === 'JPY' ? ' (per 100)' : ''), mult = ccy === 'JPY' ? 100 : 1;
    const tr = el('tr', { class: 'row' }, el('td', { text: label }), el('td', { text: fmtNum(a.v * mult, 4) })), row = [label, (a.v * mult).toFixed(4)];
    for (const [, fn] of cols) {
      const p = asOf(s, fn(a.t)), v = p ? (p.v / a.v - 1) * 100 : null;   // + = MYR stronger
      tr.append(el('td', { class: 'heat', text: v == null ? '–' : sign(v) + fmtNum(Math.abs(v), 1) + '%', style: v ? `background:${hexA(v > 0 ? pos : neg, Math.min(1, Math.abs(v) / 5) * 0.42)}` : '' }));
      row.push(v == null ? '' : v.toFixed(2));
    }
    tb.append(tr); csv.push(row);
  }
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = csv;
  setNote(c, `Ringgit per unit of each currency, as of ${nice(state.to)}. Changes are MYR strength: green = the ringgit gained against that currency.`);
}
function renderAuDiff(c) {
  if (!has('AU_2Y', 'UST2Y', 'AUDUSD')) return setEmpty(c, 'Waiting for data.');
  const d = combine(S.AU_2Y, S.UST2Y, (a, b) => (a - b) * 100, {}, 5 * DAY);
  drawPair(c, { name: 'Australia − US 2Y yield (bp)', data: pts(d, state.from, state.to) }, { name: 'AUD/USD', data: pts(S.AUDUSD, state.from, state.to) },
    { fmtA: v => fmtNum(v, 0) + 'bp', fmtB: v => fmtNum(v, 4), axisA: v => fmtNum(v, 0), axisB: v => fmtNum(v, 2), zeroA: true });
  const a = asOf(d, state.to);
  setNote(c, `Short-rate gap between Australia and the US against the Aussie dollar. A wider gap in Australia's favour usually supports AUD.${a ? ` Latest gap ${sign(a.v)}${fmtNum(Math.abs(a.v), 0)}bp.` : ''}`);
  setSource(c, 'Reserve Bank of Australia (F2, FCMYGBAG2D); US Treasury / FRED (2Y); Yahoo Finance (AUDUSD=X)');
}
function bandCard(ids, fmt, axisFmt, band, label) {   // lines plus a shaded target band
  return c => {
    seriesCard(ids, fmt, axisFmt, { zero: true })(c);
    if (!c.inst || c.chartEl.hidden) return;
    c.inst.setOption({ series: [{ markArea: { silent: true, itemStyle: { color: hexA(tok('--good'), 0.12) }, data: [[{ yAxis: band[0], name: label, label: { color: tok('--muted'), fontSize: 11, position: 'insideTopLeft' } }, { yAxis: band[1] }]] } }] });
  };
}
const segCard = (key, modes) => c => {   // modes: {mode: [ids, sub, {opts}]}
  const [ids, sub, opts = {}] = modes[state[key]];
  c.subEl.textContent = sub; seriesCard(ids, opts.fmt || pct1, opts.axisFmt || pct0, { zero: opts.zero !== false, ...opts })(c);
};
function buildAsia() {
  const g = $('#asiaGrid');
  // ---------------- Malaysia
  g.append(el('h3', { class: 'section', text: 'Malaysia' }));
  makeCard(g, { key: 'myrfx', title: 'Ringgit vs major currencies', wide: true, sub: 'MYR against USD, SGD, EUR, GBP, JPY, AUD and CNY.', render: renderMyrFx });
  makeCard(g, { key: 'myrtbl', title: 'Ringgit cross rates', range: false, sub: 'MYR per unit of each currency, and how far the ringgit has moved.', source: 'Yahoo Finance (MYR=X and USD crosses); cross rates calculated', render: renderMyrTable });
  makeCard(g, { key: 'myrates', title: 'Malaysia: OPR and inflation', sub: 'Overnight Policy Rate and CPI (headline and core), year-on-year %.', render: seriesCard(['MY_OPR', 'MY_CPI_YOY', 'MY_CORE_YOY'], pct2, pct1, { zero: true }) });
  makeCard(g, { key: 'mylend', title: 'Malaysia: bank lending and deposit rates', sub: 'Commercial banks, weighted averages, against the OPR.', render: seriesCard(['MY_OPR', 'MY_BR', 'MY_ALR', 'MY_FD12'], pct2, pct1, { endLabels: false }) });
  state.myLead = 'yoy';
  makeCard(g, { key: 'mylead', title: 'Malaysia: leading indicators (DOSM)', seg: { key: 'myLead', options: [['yoy', 'Growth'], ['level', 'Index'], ['diff', 'Diffusion']] },
    render: c => {
      const m = state.myLead;
      if (m === 'diff') { c.subEl.textContent = 'Share of leading-index components rising, %. Above 50 = broad improvement.';
        seriesCard(['MY_LEAD_DIFF'], pct0, pct0)(c); if (c.inst && !c.chartEl.hidden) c.inst.setOption({ series: [{ markLine: { silent: true, symbol: 'none', data: [{ yAxis: 50, lineStyle: { color: tok('--muted'), type: 'dashed' }, label: { formatter: '50', color: tok('--muted') } }] } }] }); return; }
      if (m === 'level') { c.subEl.textContent = 'Leading, coincident and lagging indices (2015 = 100).'; return seriesCard(['MY_LEADING', 'MY_COINCIDENT', 'MY_LAGGING'], v => fmtNum(v, 1), v => fmtNum(v, 0))(c); }
      c.subEl.textContent = 'Year-on-year %. The leading index tends to turn about 4–6 months before the economy (coincident index).';
      if (!has('MY_LEADING', 'MY_COINCIDENT')) return setEmpty(c, 'Waiting for data.');
      const A = yoyOf('MY_LEADING'), B = yoyOf('MY_COINCIDENT');
      drawLines(c, [{ name: 'Leading index YoY', data: pts(A, state.from, state.to) }, { name: 'Coincident index YoY', data: pts(B, state.from, state.to) }], { fmt: pct1, axisFmt: pct0, zero: true });
      setSource(c, 'DOSM via OpenDOSM (economic_indicators); YoY calculated');
    } });
  state.myMode = 'infl';
  makeCard(g, { key: 'mygrowth', title: 'Malaysia: activity', seg: { key: 'myMode', options: [['infl', 'Production'], ['retail', 'Retail'], ['gdp', 'GDP'], ['jobs', 'Jobs']] },
    render: segCard('myMode', { infl: [['MY_IPI_YOY'], 'Industrial production, year-on-year %.'], retail: [['MY_RETAIL_YOY'], 'Wholesale & retail trade volume, year-on-year %.'],
      gdp: [['MY_GDP_YOY'], 'Real GDP, year-on-year % (quarterly).'], jobs: [['MY_UNEMP'], 'Unemployment rate, monthly.', { zero: false, fmt: pct1, axisFmt: pct1 }] }) });
  state.myTrade = 'growth';
  makeCard(g, { key: 'mytrade', title: 'Malaysia: trade', seg: { key: 'myTrade', options: [['growth', 'Exports & imports'], ['bal', 'Trade balance']] },
    render: segCard('myTrade', { growth: [['MY_EXPORTS_YOY', 'MY_IMPORTS_YOY'], 'Year-on-year % of 3-month sums (RM).'],
      bal: [['MY_TRADE_BAL', 'MY_TRADE_BAL_3M'], 'Exports minus imports, RM billion: monthly and 3-month average.', { fmt: v => 'RM ' + fmtNum(v, 1) + 'bn', axisFmt: v => fmtNum(v, 0) }] }) });
  makeCard(g, { key: 'myprices', title: 'Malaysia: price pressure', sub: 'Consumer and producer prices, year-on-year %.', render: seriesCard(['MY_CPI_YOY', 'MY_CORE_YOY', 'MY_PPI_YOY'], pct1, pct0, { zero: true }) });
  makeCard(g, { key: 'mymoney', title: 'Malaysia: money supply', sub: 'Broad money (M2, M3), year-on-year %.', render: seriesCard(['MY_M2_YOY', 'MY_M3_YOY'], pct1, pct0, { zero: true }) });
  // ---------------- Singapore
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
    render: segCard('sgGrowth', { nodx: [['SG_NODX_YOY', 'SG_NODX_CN_YOY', 'SG_NODX_US_YOY'], 'Non-oil domestic exports, YoY % of 3-month sums: total, to China, to the US.'],
      gdp: [['SG_GDP_YOY'], 'Real GDP, year-on-year % (quarterly).'], jobs: [['SG_UNEMP'], 'Unemployment rate, seasonally adjusted (quarterly).', { zero: false, fmt: pct1, axisFmt: pct1 }] }) });
  // ---------------- Australia
  g.append(el('h3', { class: 'section', text: 'Australia' }));
  makeCard(g, { key: 'aurates', title: 'Australia: RBA cash rate and bond yields', sub: 'Cash rate target, 3M bank bills, 2Y and 10Y government bonds.', render: seriesCard(['AU_CASH', 'AU_3M', 'AU_2Y', 'AU_10Y'], pct2, pct1, { endLabels: false }) });
  makeCard(g, { key: 'auinfl', title: 'Australia: inflation vs RBA target', sub: 'Headline and trimmed-mean CPI, year-on-year % (quarterly). Shaded: the RBA 2–3% target band.', render: bandCard(['AU_CPI_YOY', 'AU_TRIM_YOY'], pct1, pct0, [2, 3], 'RBA target 2–3%') });
  makeCard(g, { key: 'audiff', title: 'AUD/USD vs the Australia − US 2Y gap', wide: true, render: renderAuDiff });
  state.auMode = 'jobs';
  makeCard(g, { key: 'augrowth', title: 'Australia: activity and credit', seg: { key: 'auMode', options: [['jobs', 'Jobs'], ['gdp', 'GDP'], ['credit', 'Credit'], ['ext', 'Trade']] },
    render: segCard('auMode', { jobs: [['AU_UNEMP', 'AU_EMP_YOY'], 'Unemployment rate (SA) and employment growth YoY, %.'], gdp: [['AU_GDP_YOY'], 'Real GDP, year-on-year % (quarterly).'],
      credit: [['AU_CREDIT_YOY', 'AU_HOUSING_YOY', 'AU_BROAD_YOY'], 'Total credit, housing credit and broad money, 12-month growth %.'],
      ext: [['AU_EXP_YOY'], 'Exports in USD, year-on-year %. Australia is a large commodity exporter, so this tracks iron ore, coal and LNG demand from Asia.'] }) });
  makeCard(g, { key: 'autot', title: 'Australia: terms of trade and the AUD', sub: 'Export prices relative to import prices (quarterly) and the trade-weighted AUD.', render: c => {
    if (!has('AU_TOT')) return setEmpty(c, 'Waiting for data.');
    if (has('AU_TWI')) drawPair(c, { name: 'Terms of trade', data: pts(S.AU_TOT, state.from, state.to) }, { name: 'AUD trade-weighted index', data: pts(S.AU_TWI, state.from, state.to) },
      { fmtA: v => fmtNum(v, 1), fmtB: v => fmtNum(v, 1), axisA: v => fmtNum(v, 0), axisB: v => fmtNum(v, 0) });
    else seriesCard(['AU_TOT'], v => fmtNum(v, 1), v => fmtNum(v, 0))(c);
    setSource(c, srcOf(['AU_TOT', 'AU_TWI'])); } });
  // ---------------- Asia ex-Japan / China comparisons
  g.append(el('h3', { class: 'section', text: 'Across Asia' }));
  makeCard(g, { key: 'ax_cpi', title: 'Inflation across Asia-Pacific', sub: 'Headline CPI, year-on-year %.', render: seriesCard(['MY_CPI_YOY', 'SG_CPI_YOY', 'AU_CPI_YOY', 'KR_CPI_YOY', 'IN_CPI_YOY', 'ID_CPI_YOY', 'CN_CPI_YOY', 'JP_CPI_YOY'], pct1, pct0, { zero: true, endLabels: false }) });
  makeCard(g, { key: 'ax_exp', title: 'Exports across Asia-Pacific', sub: 'Year-on-year %. Korea is the global trade bellwether: it reports first each month.', render: seriesCard(['KR_EXP_YOY', 'CN_EXP_YOY', 'JP_EXP_YOY', 'MY_EXPORTS_YOY', 'SG_NODX_YOY', 'IN_EXP_YOY', 'ID_EXP_YOY', 'AU_EXP_YOY'], pct1, pct0, { zero: true, endLabels: false }) });
  makeCard(g, { key: 'ax_10y', title: '10-year government bond yields', sub: 'Monthly (OECD, MAS) and daily (RBA, US Treasury, MOF Japan).', render: seriesCard(['UST10Y', 'AU_10Y', 'KR_10Y', 'IN_10Y', 'CN_10Y', 'SGS10Y', 'JGB10Y'], pct2, pct1, { endLabels: false }) });
  makeCard(g, { key: 'ax_short', title: 'Policy and short rates', sub: 'Policy rates and 3-month money-market rates, %.', render: seriesCard(['MY_OPR', 'SORA3M', 'AU_CASH', 'KR_3M', 'IN_3M', 'CN_3M', 'JP_CALL'], pct2, pct1, { endLabels: false }) });
  makeCard(g, { key: 'ax_ip', title: 'Industrial production', sub: 'Year-on-year %.', render: seriesCard(['MY_IPI_YOY', 'KR_IP_YOY', 'IN_IP_YOY', 'ID_IP_YOY', 'JP_IP_YOY'], pct1, pct0, { zero: true, endLabels: false }) });
  makeCard(g, { key: 'ax_conf', title: 'Business and consumer confidence', sub: 'Survey balances (optimists minus pessimists, %) as published by the OECD. Above 0 = more optimists.',
    render: seriesCard(['KR_BCI', 'CN_BCI', 'AU_CCI', 'ID_CCI'], v => fmtNum(v, 1), v => fmtNum(v, 0), { endLabels: false, zero: true }) });
  // ---------------- FX
  g.append(el('h3', { class: 'section', text: 'Asian currencies' }));
  makeCard(g, { key: 'asiafx', title: 'Asian FX vs USD', render: renderAsiaFx });
  makeCard(g, { key: 'asiaidx', title: 'Asia FX index vs USD', sub: 'Broad Asian currency strength against the dollar.', render: renderAsiaIdx });
}
const ASIA_CARDS = ['myrfx', 'myrtbl', 'myrates', 'mylend', 'mylead', 'mygrowth', 'mytrade', 'myprices', 'mymoney', 'sgrates', 'sgust', 'sghedge', 'sneer', 'sginfl', 'sggrowth',
  'aurates', 'auinfl', 'audiff', 'augrowth', 'autot', 'ax_cpi', 'ax_exp', 'ax_10y', 'ax_short', 'ax_ip', 'ax_conf', 'asiafx', 'asiaidx'];
const ASIA_KPI = { Malaysia: ['Malaysia OPR', 'USD/MYR', 'FBM KLCI', 'Malaysia leading index'], Singapore: ['3M compounded SORA', 'SGS 10Y yield', 'UST − SGS 10Y', 'USD/SGD', 'S$NEER proxy pace', 'MAS core inflation'],
  Australia: ['RBA cash rate', 'Australia 10Y yield'] };
const ASIA_KPI_MIX = ['Malaysia OPR', 'USD/MYR', '3M compounded SORA', 'USD/SGD', 'RBA cash rate', 'Australia 10Y yield'];
function renderAsia() {
  regionKpis();
  const sub = SUBTABS.asia[state.sub.asia || 0][0];
  filterKpis('#asiaKpis', l => ASIA_KPI[sub] ? (ASIA_KPI[sub].includes(l) ? sub : '') : (ASIA_KPI_MIX.includes(l) ? '*' : ''));
  ASIA_CARDS.forEach(k => cards[k].render());
}
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
  filterKpis('#cnjpKpis', l => l.startsWith('China') ? 'China' : 'Japan');
}
function renderCLI(c) {
  const ids = ['CLI_USA', 'CLI_CHN', 'CLI_JPN', 'CLI_DEU', 'CLI_KOR', 'CLI_IND', 'CLI_AUS', 'CLI_IDN'].filter(id => has(id));
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

// ------------------------------------------------------------------ VALUATION
const REER = ['REER_USD', 'REER_EUR', 'REER_JPY', 'REER_CNY', 'REER_GBP', 'REER_SGD', 'REER_MYR', 'REER_KRW', 'REER_INR', 'REER_AUD', 'REER_IDR'];
const STRETCH_EQ = ['SPX', 'NDX', 'SX5E', 'UKX', 'NKY', 'CSI300', 'HSI', 'KOSPI', 'TWSE', 'STI', 'KLCI', 'NIFTY', 'AS51', 'IBOV', 'EEM'];
function pctile(s, to, from = -Infinity) {   // share of history (from..to) at or below the latest value
  const a = asOf(s, to); if (!a) return null;
  let n = 0, below = 0; for (let i = 0; i <= a.i; i++) { if (s.t[i] < from) continue; n++; if (s.v[i] <= a.v) below++; }
  return n > 24 ? { p: below / n * 100, v: a.v, t: a.t, n, since: s.t[Math.max(0, idxLE(s, from - 1) + 1)] } : null;
}
function capeNow() {   // CAPE estimated to the latest S&P 500 close (Shiller's file lags a month or two)
  if (!has('SH_CAPE', 'SH_P', 'SPX')) return null;
  const c = asOf(S.SH_CAPE, state.to), p = asOf(S.SH_P, c.t + 20 * DAY), x = asOf(S.SPX, state.to);
  return c && p && x ? { cape: c.v * x.v / p.v, base: c, t: x.t } : null;
}
function stretch(id) {   // % above/below a 10-year log-linear trend, and its z-score vs its own history of deviations
  const s = S[id]; if (!s) return null;
  const W = sampled(id, 'W'), k = upperIdx(W.t, state.to) - 1; if (k < 520) return null;
  const xs = [], ys = []; for (let j = k - 520; j <= k; j++) { xs.push(j); ys.push(Math.log(W.v[j])); }
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxy / sxx, a = my - b * mx, res = ys.map((y, i) => y - (a + b * xs[i]));
  const sd = Math.sqrt(res.reduce((m, r) => m + r * r, 0) / (n - 2)), last = res[n - 1];
  return { pct: (Math.exp(last) - 1) * 100, z: last / sd, trend: (Math.exp(b * 52) - 1) * 100 };
}
const READ = p => p == null ? ['–', ''] : p >= 80 ? ['Expensive', '--critical'] : p >= 60 ? ['Rich', '--serious'] : p > 40 ? ['Fair', '--muted'] : p > 20 ? ['Cheapish', '--s3'] : ['Cheap', '--good'];
function valRows() {
  const rows = [], to = state.to;
  const add = (group, name, valTxt, p, how, src, invert = false) => rows.push({ group, name, valTxt, p: p == null ? null : (invert ? 100 - p : p), how, src });
  if (has('SH_CAPE')) { const c = pctile(S.SH_CAPE, to), now = capeNow();
    add('US equities', 'CAPE (Shiller P/E10)', `${fmtNum(c.v, 1)}x` + (now ? ` (≈${fmtNum(now.cape, 1)}x today)` : ''), c.p, 'percentile since 1881; high = expensive', 'Shiller'); }
  if (has('SH_PE')) { const c = pctile(S.SH_PE, to); add('US equities', 'Trailing P/E', `${fmtNum(c.v, 1)}x`, c.p, 'since 1871', 'Shiller'); }
  if (has('SH_ECY')) { const c = pctile(S.SH_ECY, to); add('US equities', 'Excess CAPE yield (vs real bonds)', fmtNum(c.v, 2) + '%', c.p, 'since 1881; low = equities expensive vs bonds', 'Shiller', true); }
  if (has('SH_DY')) { const c = pctile(S.SH_DY, to); add('US equities', 'Dividend yield', fmtNum(c.v, 2) + '%', c.p, 'since 1871; low = expensive', 'Shiller', true); }
  if (has('REAL10Y')) { const c = pctile(S.REAL10Y, to); add('US bonds', 'UST 10Y real yield (TIPS)', fmtNum(c.v, 2) + '%', c.p, 'since 2003; high yield = cheap bonds', 'FRED DFII10', true); }
  if (has('ACM_TP10')) { const c = pctile(S.ACM_TP10, to); add('US bonds', '10Y term premium (ACM)', fmtNum(c.v, 2) + '%', c.p, 'since 1990; high = paid more for duration (cheap)', 'NY Fed', true); }
  if (has('BAA_10Y_BP')) { const c = pctile(S.BAA_10Y_BP, to); add('Credit', 'Baa − 10Y spread', fmtNum(c.v, 0) + 'bp', c.p, 'since 1990; tight = expensive', "Moody's via FRED", true); }
  for (const id of REER) if (has(id)) { const c = pctile(S[id], to); if (c) add('FX (real effective rate)', S[id].label.replace(' REER', ''), fmtNum(c.v, 1), c.p, `percentile since ${new Date(c.since).getUTCFullYear()}; high = strong / expensive`, 'BIS via FRED'); }
  if (has('WTI_LONG', 'CPI')) { const r = combine(S.WTI_LONG, S.CPI, (a, b) => a / b, {}, 40 * DAY); const c = pctile({ ...r, t: r.t, v: r.v }, to);
    if (c) add('Commodities', 'Real oil price (WTI / CPI)', '', c.p, 'since 1959', 'FRED WTISPLC, CPIAUCSL'); }
  return rows;
}
function renderValTable(c) {
  const b = htmlBody(c), rows = valRows();
  if (!rows.length) { b.append(el('div', { class: 'empty', text: 'Waiting for valuation data (next daily run).' })); return; }
  const tbl = el('table', { class: 'perf' });
  tbl.append(el('thead', {}, el('tr', {}, ...['Measure', 'Now', 'Percentile (expensive = high)', 'Read', 'Basis'].map(h => el('th', { text: h })))));
  const tb = el('tbody'); let g = null;
  for (const r of rows) {
    if (r.group !== g) { g = r.group; tb.append(el('tr', { class: 'grp' }, el('td', { colspan: 5, text: g }))); }
    const [lab, tk] = READ(r.p);
    tb.append(el('tr', { class: 'row', title: 'Source: ' + r.src },
      el('td', { text: r.name }), el('td', { text: r.valTxt }),
      el('td', {}, el('span', { class: 'pbar' }, el('span', { class: 'track' }, el('span', { class: 'fill', style: `width:${(r.p || 0).toFixed(0)}%;background:${tok(tk || '--muted')}` })),
        el('span', { class: 'pv', text: r.p == null ? '–' : Math.round(r.p) }))),
      el('td', {}, el('span', { class: 'chip', style: `--st:${tok(tk || '--muted')}` }, lab)), el('td', { class: 'muted', text: r.how })));
  }
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = [['Group', 'Measure', 'Now', 'Percentile (expensive = high)', 'Read', 'Basis'], ...rows.map(r => [r.group, r.name, r.valTxt, r.p == null ? '' : r.p.toFixed(0), READ(r.p)[0], r.how])];
  setNote(c, 'Percentiles are oriented so that a high number always means expensive (for yields and spreads, a low yield is expensive). Valuation is a poor timing tool: expensive markets can stay expensive for years. It says more about 5–10 year returns than the next few months.');
}
function renderCape(c) {
  if (!has('SH_CAPE')) return setEmpty(c, 'Waiting for Shiller data.');
  const p = pts(S.SH_CAPE, state.from, state.to), m = S.SH_CAPE.v.reduce((a, b) => a + b, 0) / S.SH_CAPE.v.length;
  drawLines(c, [{ name: 'CAPE', data: p }], { fmt: v => fmtNum(v, 1) + 'x', axisFmt: v => fmtNum(v, 0) + 'x', hlines: [{ y: +m.toFixed(1), label: `long-run average ${fmtNum(m, 1)}x` }] });
  const now = capeNow();
  setNote(c, now ? `Latest Shiller month ${monthLab(now.base.t)}: ${fmtNum(now.base.v, 1)}x. Rolled forward to the S&P 500 close on ${nice(now.t)}: ≈${fmtNum(now.cape, 1)}x.` : '');
}
function renderCapeFwd(c) {
  if (!has('SH_CAPE', 'SH_FWD10')) return setEmpty(c, 'Waiting for Shiller data.');
  const fm = new Map(S.SH_FWD10.t.map((t, i) => [t, S.SH_FWD10.v[i]])), xs = [], ys = [], dots = [];
  for (let i = 0; i < S.SH_CAPE.t.length; i++) { const t = S.SH_CAPE.t[i]; if (fm.has(t)) { xs.push(Math.log(S.SH_CAPE.v[i])); ys.push(fm.get(t)); dots.push([S.SH_CAPE.v[i], fm.get(t), t]); } }
  const n = xs.length, mx = xs.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
  const b = sxy / sxx, a = my - b * mx, r2 = sxy * sxy / (sxx * syy);
  const res = ys.map((y, i) => y - (a + b * xs[i])), se = Math.sqrt(res.reduce((m, r) => m + r * r, 0) / (n - 2));
  const now = capeNow(), capeX = now ? now.cape : asOf(S.SH_CAPE, state.to).v, fit = a + b * Math.log(capeX);
  const curve = []; for (let x = 5; x <= 45; x += 1) curve.push([x, a + b * Math.log(x)]);
  const o = baseOpt(); o.legend.show = false;
  o.grid = { left: 8, right: 24, top: 14, bottom: 30, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => p.seriesIndex === 0 ? `${esc(monthLab(dots[p.dataIndex][2]))}: CAPE ${fmtNum(p.value[0], 1)}x → next 10 years ${sign(p.value[1])}${fmtNum(Math.abs(p.value[1]), 1)}% a year (real)` : '' };
  o.xAxis = { type: 'value', name: 'CAPE at the start', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: tok('--muted'), fontSize: 11 }, min: 0, axisLabel: { color: tok('--muted'), fontSize: 11 }, splitLine: { show: false } };
  o.yAxis = valAxis(v => v + '%', { name: 'real return, next 10 years (% a year)', nameTextStyle: { color: tok('--muted'), fontSize: 11 } });
  o.series = [{ type: 'scatter', symbolSize: 4, data: dots.map(d => [d[0], d[1]]), itemStyle: { color: hexA(tok('--s1'), 0.35) } },
    { type: 'line', data: curve, showSymbol: false, lineStyle: { color: tok('--s2'), width: 2 }, silent: true },
    { type: 'line', data: [], markLine: { silent: true, symbol: 'none', data: [{ xAxis: +capeX.toFixed(1), lineStyle: { color: tok('--ink'), type: 'dashed' }, label: { formatter: `today ${fmtNum(capeX, 1)}x`, color: tok('--ink'), fontSize: 11 } }] } }];
  c.chartEl.style.height = '400px';
  const ch = inst(c); ch.resize(); ch.setOption(o, true);
  c.csv = [['Month', 'CAPE', 'Next 10y real return % a year'], ...dots.map(d => [iso(d[2]).slice(0, 7), d[0], d[1]])];
  setNote(c, `Every month since 1881: CAPE then vs the real return of US stocks over the following 10 years. The fitted line (R² ${fmtNum(r2, 2)}) implies about ${sign(fit)}${fmtNum(Math.abs(fit), 1)}% a year real from today's ≈${fmtNum(capeX, 1)}x, with a typical miss of ±${fmtNum(se, 1)}pp. Today's CAPE is near the edge of history, so the estimate leans on few comparable points (mainly 1999–2000).`);
}
function renderERP(c) {
  if (!has('SH_ECY')) return setEmpty(c, 'Waiting for Shiller data.');
  const list = [{ name: 'Excess CAPE yield (Shiller)', data: pts(S.SH_ECY, state.from, state.to) }];
  if (has('SH_CAPE', 'REAL10Y')) {
    const ey = { t: S.SH_CAPE.t, v: S.SH_CAPE.v.map(x => 100 / x) };
    list.push({ name: 'CAPE earnings yield − 10Y TIPS', data: pts(combine(ey, S.REAL10Y, (a, b) => a - b, {}, 40 * DAY), state.from, state.to) });
  }
  drawLines(c, list, { fmt: v => fmtNum(v, 2) + '%', axisFmt: v => fmtNum(v, 0) + '%', zero: true });
}
function renderReer(c) {
  const rows = REER.filter(id => has(id)).map(id => { const s = S[id], a = asOf(s, state.to); if (!a) return null;
    const lo = addMonths(a.t, -120), win = s.v.filter((v, i) => s.t[i] >= lo && s.t[i] <= a.t), avg = win.reduce((x, y) => x + y, 0) / win.length;
    return { name: s.label.replace(' REER', ''), v: (a.v / avg - 1) * 100, t: a.t }; }).filter(Boolean).sort((a, b) => b.v - a.v);
  if (!rows.length) return setEmpty(c, 'Waiting for BIS real exchange rates (next daily run).');
  c.subEl.textContent = `Real effective exchange rate vs its own 10-year average, as of ${monthLab(rows[0].t)}. Positive = stronger (more expensive) than usual.`;
  const o = baseOpt(); o.legend.show = false;
  o.grid = { left: 8, right: 60, top: 8, bottom: 8, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => `<b>${sign(p.value)}${fmtNum(Math.abs(p.value), 1)}%</b> <span style="color:${tok('--ink-2')}">${esc(rows[p.dataIndex].name)} vs 10-year average</span>` };
  o.xAxis = { type: 'value', axisLabel: { color: tok('--muted'), fontSize: 11, formatter: v => v + '%' }, splitLine: { lineStyle: { color: tok('--grid') } } };
  o.yAxis = { type: 'category', inverse: true, data: rows.map(r => r.name), axisLabel: { color: tok('--ink-2'), fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } };
  o.series = [{ type: 'bar', barWidth: '60%', data: rows.map(r => ({ value: +r.v.toFixed(2), itemStyle: { color: r.v >= 0 ? tok('--neg') : tok('--pos'), borderRadius: r.v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
    label: { show: true, position: 'right', color: tok('--ink-2'), fontSize: 11, formatter: p => sign(p.value) + fmtNum(Math.abs(p.value), 1) + '%' } }];
  c.chartEl.style.height = Math.max(280, rows.length * 26 + 30) + 'px';
  const ch = inst(c); ch.resize(); ch.setOption(o, true);
  c.csv = [['Currency', '% vs 10y average'], ...rows.map(r => [r.name, r.v.toFixed(2)])];
  setNote(c, 'Red = rich (stronger than its 10-year norm), blue = cheap. Real effective rates adjust for inflation and weight each currency by trade.');
}
function renderStretch(c) {
  const rows = STRETCH_EQ.filter(id => has(id)).map(id => { const x = stretch(id); return x && { name: S[id].label, v: x.pct, z: x.z, tr: x.trend }; }).filter(Boolean).sort((a, b) => b.v - a.v);
  if (!rows.length) return setEmpty(c, 'Not enough history.');
  const o = baseOpt(); o.legend.show = false;
  o.grid = { left: 8, right: 60, top: 8, bottom: 8, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => { const r = rows[p.dataIndex]; return `<b>${sign(r.v)}${fmtNum(Math.abs(r.v), 1)}%</b> vs 10-year trend (${zf(r.z)}σ)<br><span style="color:${tok('--ink-2')}">${esc(r.name)} · trend growth ${fmtNum(r.tr, 1)}% a year</span>`; } };
  o.xAxis = { type: 'value', axisLabel: { color: tok('--muted'), fontSize: 11, formatter: v => v + '%' }, splitLine: { lineStyle: { color: tok('--grid') } } };
  o.yAxis = { type: 'category', inverse: true, data: rows.map(r => r.name), axisLabel: { color: tok('--ink-2'), fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } };
  o.series = [{ type: 'bar', barWidth: '60%', data: rows.map(r => ({ value: +r.v.toFixed(2), itemStyle: { color: r.v >= 0 ? tok('--neg') : tok('--pos'), borderRadius: r.v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
    label: { show: true, position: 'right', color: tok('--ink-2'), fontSize: 11, formatter: p => `${sign(p.value)}${fmtNum(Math.abs(p.value), 0)}% (${zf(rows[p.dataIndex].z)}σ)` } }];
  c.chartEl.style.height = Math.max(300, rows.length * 26 + 30) + 'px';
  const ch = inst(c); ch.resize(); ch.setOption(o, true);
  c.csv = [['Index', '% vs 10y trend', 'z', 'trend % a year'], ...rows.map(r => [r.name, r.v.toFixed(2), r.z.toFixed(2), r.tr.toFixed(2)])];
  setNote(c, `Price relative to its own 10-year log-linear trend (weekly, local currency), as of ${nice(state.to)}. Not a valuation measure (no earnings), but free for every market: far above trend usually means returns were pulled forward.`);
  setSource(c, srcOf(STRETCH_EQ) + '; trend calculated');
}
function buildValuation() {
  const g = $('#valGrid');
  makeCard(g, { key: 'val_table', title: 'Valuation scorecard', wide: true, range: false, sub: 'Where each market sits against its own history.',
    source: 'Shiller (Yale), FRED (DFII10, BAA10Y, BAMLH0A0HYM2, BIS real effective exchange rates, WTISPLC, CPIAUCSL), NY Fed (ACM term premium)', render: renderValTable });
  g.append(el('h3', { class: 'section', text: 'US equities' }));
  makeCard(g, { key: 'val_cape', title: 'US CAPE (Shiller P/E10)', defaultRange: 'MAX', earliest: Date.UTC(1881, 0, 1), sub: 'Price over 10-year average inflation-adjusted earnings, monthly since 1881.',
    source: 'Robert Shiller, Yale (ie_data.xls); latest estimate rolled forward with the S&P 500 from Yahoo Finance (^GSPC)', render: renderCape });
  makeCard(g, { key: 'val_fwd', title: 'What CAPE has meant for the next 10 years', range: false, source: 'Robert Shiller, Yale (ie_data.xls); regression calculated', render: renderCapeFwd });
  makeCard(g, { key: 'val_erp', title: 'Equity risk premium', wide: true, defaultRange: 'MAX', earliest: Date.UTC(1881, 0, 1),
    sub: 'Earnings yield on stocks minus the real yield on bonds. Low = little extra reward for owning equities over bonds.',
    source: 'Robert Shiller, Yale (Excess CAPE Yield); FRED (DFII10); spread calculated', render: renderERP });
  g.append(el('h3', { class: 'section', text: 'Bonds, FX and global equities' }));
  makeCard(g, { key: 'val_tp', title: 'Treasury term premium and real yield', defaultRange: 'MAX', earliest: Date.UTC(1990, 0, 1),
    sub: 'Extra yield for holding 10-year Treasuries rather than rolling short bills (NY Fed ACM model), and the 10Y real (TIPS) yield, %.',
    source: 'Federal Reserve Bank of New York (ACMTP10); FRED (DFII10)',
    render: c => { const ids = ['ACM_TP10', 'REAL10Y'].filter(x => has(x)); if (!ids.length) return setEmpty(c, 'Waiting for data.');
      drawLines(c, ids.map((id, i) => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(i) })), { fmt: v => fmtNum(v, 2) + '%', axisFmt: v => fmtNum(v, 1) + '%', zero: true }); } });
  makeCard(g, { key: 'val_reer', title: 'Currency valuation', range: false, source: 'BIS real effective exchange rates (broad) via FRED', render: renderReer });
  makeCard(g, { key: 'val_stretch', title: 'Global equities: price vs 10-year trend', wide: true, range: false, render: renderStretch });
}
function renderValuation() { ['val_table', 'val_cape', 'val_fwd', 'val_erp', 'val_tp', 'val_reer', 'val_stretch'].forEach(k => cards[k].render()); }

// ------------------------------------------------------------------ DATA HEALTH
let HEALTH = null;
function renderHealth() {
  const box = $('#healthBody'); box.replaceChildren();
  if (!HEALTH) { box.append(el('div', { class: 'empty', text: 'The data health report arrives with the next daily run.' })); return; }
  const cnt = s => HEALTH.rows.filter(r => r.state === s).length;
  box.append(el('p', { text: `Checked ${HEALTH.checked_utc}: ${HEALTH.n} series. ${cnt('stale')} stale, ${cnt('missing')} missing, ${cnt('kept previous')} using the previous download, ${cnt('ok')} up to date.` }),
    el('p', { class: 'muted small', text: 'A series is stale when its latest observation is older than its normal publishing rhythm allows (daily 10 days, weekly 3 weeks, monthly ~4 months, quarterly ~8 months). When anything is stale or missing, the daily run opens a "Data health alert" issue in the GitHub repo (GitHub emails you) and closes it once the data is back.' }));
  const tbl = el('table', { class: 'perf' });
  tbl.append(el('thead', {}, el('tr', {}, ...['State', 'Series', 'Source', 'Frequency', 'Latest data', 'Age (days)'].map(h => el('th', { text: h })))));
  const tb = el('tbody'), col_ = { stale: '--critical', missing: '--serious', 'kept previous': '--warning', ok: '--good' };
  for (const r of HEALTH.rows) tb.append(el('tr', { class: 'row' }, el('td', {}, el('span', { class: 'chip', style: `--st:${tok(col_[r.state])}` }, r.state)),
    el('td', { text: `${r.label} (${r.id})` }), el('td', { class: 'muted', text: r.source }), el('td', { text: r.freq }), el('td', { text: r.last }), el('td', { text: r.age_days == null ? '' : String(r.age_days) })));
  tbl.append(tb); box.append(el('div', { class: 'table-wrap' }, tbl));
}

// ------------------------------------------------------------------ POSITIONING & VOLATILITY
let POS = null;
state.posSel = 'ES';
const COT_SRC = 'CFTC Commitments of Traders (publicreporting.cftc.gov): Traders in Financial Futures and Disaggregated reports, futures only';
function posSeries(m, key) { return { t: m.d.map(x => x * DAY), v: m[key], kind: 'level' }; }
function posStats(m, key = 'spec') {   // latest vs last 3 years (156 weeks) up to the "To" date
  const s = posSeries(m, key), a = asOf(s, state.to); if (!a) return null;
  const lo = Math.max(0, a.i - 155), win = s.v.slice(lo, a.i + 1).filter(v => v != null);
  if (win.length < 52) return null;
  const mean = win.reduce((x, y) => x + y, 0) / win.length, sd = Math.sqrt(win.reduce((x, y) => x + (y - mean) ** 2, 0) / (win.length - 1));
  const pct = win.filter(v => v <= a.v).length / win.length * 100;
  return { v: a.v, t: a.t, z: sd > 0 ? (a.v - mean) / sd : 0, pct, chg: a.i > 0 ? a.v - s.v[a.i - 1] : null, chg4: a.i > 3 ? a.v - s.v[a.i - 4] : null };
}
const crowd = (p, v = 0) => p >= 90 ? (v > 0 ? ['Crowded long', '--critical'] : ['Shorts covered (3y high)', '--serious'])
  : p <= 10 ? (v < 0 ? ['Crowded short', '--s1'] : ['Longs cut (3y low)', '--s3'])
  : p >= 75 ? ['Long-heavy', '--serious'] : p <= 25 ? ['Short-heavy', '--s3'] : ['Neutral', '--muted'];
function realizedVol(id, n = 21) {   // annualised realised vol of daily log returns, rolling n days
  const s = S[id], t = [], v = [];
  for (let i = n; i < s.t.length; i++) { let m = 0, q = 0; for (let k = i - n + 1; k <= i; k++) { const r = Math.log(s.v[k] / s.v[k - 1]); m += r; q += r * r; }
    const mean = m / n; t.push(s.t[i]); v.push(Math.sqrt((q / n - mean * mean) * n / (n - 1)) * Math.sqrt(252) * 100); }
  return { t, v, kind: 'level' };
}
let rvCache = null;
function posvolKpis() {
  const box = $('#pvKpis'); box.replaceChildren();
  const tile = (label, val, delta, foot) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: label }), el('div', { class: 'k-value', text: val }),
    el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: foot })));
  if (has('VIX')) { const p = pctRank(S.VIX, state.to, 10); if (p) tile('VIX', fmtNum(p.v, 1), `${Math.round(p.p)}th percentile (10y)`, 'as of ' + nice(p.t)); }
  if (has('VIX', 'VIX3M')) { const a = asOf(S.VIX, state.to), b = asOf(S.VIX3M, state.to), r = b.v / a.v;
    tile('VIX 3M / VIX', fmtNum(r, 2), r <= 1 ? '⚠ below 1, inverted: near-term stress priced above 3-month' : 'above 1, normal (contango): calm near term', nice(a.t)); }
  if (has('VIX', 'SPX')) { rvCache = rvCache || realizedVol('SPX'); const a = asOf(S.VIX, state.to), r = asOf(rvCache, state.to);
    if (r) tile('VIX − realised vol', sign(a.v - r.v) + fmtNum(Math.abs(a.v - r.v), 1) + ' pts', `S&P 500 realised (1m) ${fmtNum(r.v, 1)}%`, 'insurance premium'); }
  if (has('MOVE')) { const p = pctRank(S.MOVE, state.to, 10); if (p) tile('MOVE (rates vol)', fmtNum(p.v, 0), `${Math.round(p.p)}th percentile (10y)`, nice(p.t)); }
  if (POS) { const st = Object.values(POS.markets).map(m => posStats(m)).filter(Boolean);
    tile('Crowded positions', `${st.filter(s => s.pct >= 90 || s.pct <= 10).length} of ${st.length}`, 'speculators at a 3-year extreme (top/bottom 10%)', 'CFTC, week of ' + nice(Math.max(...st.map(s => s.t)))); }
}
function renderVolTS(c) {
  const ids = ['VIX9D', 'VIX', 'VIX3M', 'VIX6M'], names = ['9 days', '30 days', '3 months', '6 months'];
  if (!ids.every(id => has(id))) return setEmpty(c, 'Waiting for VIX term-structure data (next daily run).');
  const at = t => ids.map(id => { const a = asOf(S[id], t); return a ? a.v : null; });
  const now = asOf(S.VIX, state.to).t, comps = [['Now (' + nice(now) + ')', now], ['1 month ago', addMonths(now, -1)], ['1 year ago', addMonths(now, -12)]];
  const o = baseOpt(); o.legend.data = comps.map(x => x[0]);
  o.xAxis = { type: 'category', data: names, boundaryGap: false, axisLabel: { color: tok('--muted'), fontSize: 11 }, axisLine: { lineStyle: { color: tok('--axis') } }, axisTick: { show: false } };
  o.yAxis = valAxis(v => fmtNum(v, 0));
  o.tooltip.formatter = ps => `<div style="color:${tok('--ink-2')};margin-bottom:4px">${esc(ps[0].axisValue)}</div>` + ps.map(p => `<div><b>${fmtNum(p.value, 1)}</b> <span style="color:${tok('--ink-2')}">${esc(p.seriesName)}</span></div>`).join('');
  o.series = comps.map(([n, t], i) => ({ ...line(n, at(t), col(i)), sampling: undefined, showSymbol: true, symbolSize: 7, lineStyle: { width: i ? 2 : 3, color: col(i) } }));
  inst(c).setOption(o, true);
  c.csv = [['Tenor', ...comps.map(x => x[0])], ...names.map((n, j) => [n, ...comps.map(([, t]) => at(t)[j])])];
  const v = at(now); setNote(c, v[0] > v[2] ? 'Inverted: near-term protection costs more than 3-month. This usually happens during sell-offs and has tended to mark stress peaks.' : 'Upward-sloping (contango): the normal shape in calm markets.');
}
function renderVolRatio(c) {
  if (!has('VIX', 'VIX3M', 'SPX')) return setEmpty(c, 'Waiting for data (next daily run).');
  const r = combine(S.VIX3M, S.VIX, (a, b) => a / b, {}, 4 * DAY);   // inverted ratio: falls with the S&P 500 in stress
  drawPair(c, { name: 'VIX 3M / VIX', data: pts(r, state.from, state.to) }, { name: 'S&P 500', data: pts(S.SPX, state.from, state.to) },
    { fmtA: v => fmtNum(v, 2), fmtB: v => fmtNum(v, 0), axisA: v => fmtNum(v, 2), axisB: v => fmtNum(v, 0) });
  inst(c).setOption({ series: [{ markLine: { silent: true, symbol: 'none', data: [{ yAxis: 1, lineStyle: { color: tok('--critical'), type: 'dashed' }, label: { formatter: 'stress below 1.0 (inverted curve)', color: tok('--muted'), fontSize: 11, position: 'insideStartBottom' } }] } }] });
  // what happened next: S&P 500 1m and 3m returns after the ratio first crosses above 1 (since 2007)
  const fwd = (t, m) => { const a = asOf(S.SPX, t), b = asOf(S.SPX, addMonths(t, m)); return a && b && b.t > a.t + 20 * DAY ? b.v / a.v - 1 : null; };
  const ev = []; let lastEv = -Infinity;
  for (let i = 1; i < r.t.length; i++) if (r.v[i] <= 1 && r.v[i - 1] > 1 && r.t[i] - lastEv > 60 * DAY) { ev.push(r.t[i]); lastEv = r.t[i]; }
  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length * 100 : null;
  const f1 = ev.map(t => fwd(t, 1)).filter(x => x != null), f3 = ev.map(t => fwd(t, 3)).filter(x => x != null);
  const all1 = [], all3 = []; for (let i = 0; i < S.SPX.t.length; i += 21) { const t = S.SPX.t[i]; if (t < r.t[0]) continue; const a = fwd(t, 1), b = fwd(t, 3); if (a != null) all1.push(a); if (b != null) all3.push(b); }
  setNote(c, `Shown as VIX 3M ÷ VIX so it moves with the S&P 500. Above 1.0 = normal upward-sloping vol curve (calm). Below 1.0 = inverted: near-term fear priced above 3-month (stress). Since ${new Date(r.t[0]).getUTCFullYear()}, the ratio has dropped below 1 on ${ev.length} separate occasions. Average S&P 500 return afterwards: ${fmtNum(avg(f1), 1)}% over 1 month and ${fmtNum(avg(f3), 1)}% over 3 months, against ${fmtNum(avg(all1), 1)}% and ${fmtNum(avg(all3), 1)}% for all periods. Small sample: a tendency, not a rule.`);
  setSource(c, srcOf(['VIX', 'VIX3M', 'SPX']) + '; ratio and statistics calculated');
}
function renderIvRv(c) {
  if (!has('VIX', 'SPX')) return setEmpty(c, 'Waiting for data.');
  rvCache = rvCache || realizedVol('SPX');
  drawLines(c, [{ name: 'VIX (implied, next 30 days)', data: pts(S.VIX, state.from, state.to) }, { name: 'S&P 500 realised vol (last 21 days)', data: pts(rvCache, state.from, state.to) }],
    { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0) });
  setNote(c, 'The gap is the price of insurance. VIX usually sits a few points above realised volatility; when realised vol overtakes VIX, markets are moving more than options were pricing.');
  setSource(c, srcOf(['VIX', 'SPX']) + '; realised volatility calculated');
}
function renderVolX(c) {
  const ids = ['VIX', 'VXN', 'VVIX', 'SKEW', 'MOVE', 'OVX', 'GVZ'].filter(id => has(id));
  const rows = ids.map(id => { const p = pctRank(S[id], state.to, 5); return p && { name: S[id].label, v: p.p, lvl: p.v }; }).filter(Boolean).sort((a, b) => b.v - a.v);
  if (!rows.length) return setEmpty(c, 'Waiting for volatility data (next daily run).');
  const o = baseOpt(); o.legend.show = false;
  o.grid = { left: 8, right: 70, top: 8, bottom: 8, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => { const r = rows[p.dataIndex]; return `<b>${Math.round(r.v)}th percentile</b> (5 years)<br><span style="color:${tok('--ink-2')}">${esc(r.name)}: ${fmtNum(r.lvl, 1)}</span>`; } };
  o.xAxis = { type: 'value', min: 0, max: 100, axisLabel: { color: tok('--muted'), fontSize: 11 }, splitLine: { lineStyle: { color: tok('--grid') } } };
  o.yAxis = { type: 'category', inverse: true, data: rows.map(r => r.name), axisLabel: { color: tok('--ink-2'), fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } };
  o.series = [{ type: 'bar', barWidth: '60%', data: rows.map(r => ({ value: +r.v.toFixed(1), itemStyle: { color: tok('--' + stressBand(r.v)[0]), borderRadius: [0, 4, 4, 0] } })),
    label: { show: true, position: 'right', color: tok('--ink-2'), fontSize: 11, formatter: p => `${Math.round(p.value)} (${fmtNum(rows[p.dataIndex].lvl, 1)})` } }];
  c.chartEl.style.height = Math.max(240, rows.length * 30 + 30) + 'px';
  const ch = inst(c); ch.resize(); ch.setOption(o, true);
  c.csv = [['Index', 'Percentile (5y)', 'Level'], ...rows.map(r => [r.name, r.v.toFixed(0), r.lvl])];
  setNote(c, 'Each implied-volatility index against its own last 5 years (100 = highest). Labels show the percentile and, in brackets, the level. SKEW measures the price of crash protection; VVIX the volatility of the VIX itself.');
  setSource(c, srcOf(ids) + '; percentiles calculated');
}
function renderPosTable(c) {
  const b = htmlBody(c);
  if (!POS) { b.append(el('div', { class: 'empty', text: 'Positioning data arrives with the next daily run.' })); return; }
  const rows = Object.entries(POS.markets).map(([id, m]) => ({ id, m, s: posStats(m), a: posStats(m, 'alt') })).filter(r => r.s);
  const tbl = el('table', { class: 'perf' });
  tbl.append(el('thead', {}, el('tr', {}, ...['Market', 'Speculators', 'Net % of OI', '3-year percentile', 'z (3y)', '1w / 4w change', 'Read', 'Other side'].map(h => el('th', { text: h })))));
  const tb = el('tbody'); let g = null;
  for (const r of rows) {
    if (r.m.group !== g) { g = r.m.group; tb.append(el('tr', { class: 'grp' }, el('td', { colspan: 8, text: g }))); }
    const [lab, tk] = crowd(r.s.pct, r.s.v);
    const tr = el('tr', { class: 'row' + (state.posSel === r.id ? ' sel' : ''), title: 'Click to chart the history. ' + (r.m.inverse ? 'Note: long these futures = long the bond / currency (yield or USD/JPY falls).' : '') },
      el('td', { text: r.m.label }), el('td', { class: 'muted', text: r.m.spec_label }),
      el('td', { text: sign(r.s.v) + fmtNum(Math.abs(r.s.v), 1) + '%' }),
      el('td', {}, el('span', { class: 'pbar' }, el('span', { class: 'track' }, el('span', { class: 'fill', style: `width:${r.s.pct.toFixed(0)}%;background:${tok(tk)}` })), el('span', { class: 'pv', text: Math.round(r.s.pct) }))),
      el('td', { text: zf(r.s.z), style: Math.abs(r.s.z) >= 2 ? 'font-weight:650' : '' }),
      el('td', { text: `${r.s.chg == null ? '–' : sign(r.s.chg) + fmtNum(Math.abs(r.s.chg), 1)} / ${r.s.chg4 == null ? '–' : sign(r.s.chg4) + fmtNum(Math.abs(r.s.chg4), 1)}` }),
      el('td', {}, el('span', { class: 'chip', style: `--st:${tok(tk)}` }, lab)),
      el('td', { class: 'muted', text: r.a ? `${r.m.alt_label} ${sign(r.a.v)}${fmtNum(Math.abs(r.a.v), 1)}%` : '' }));
    tr.addEventListener('click', () => { state.posSel = r.id; renderPosTable(c); cards.pos_hist.render(); cards.pos_hist.root.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    tb.append(tr);
  }
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  const wk = Math.max(...rows.map(r => r.s.t));
  c.subEl.textContent = `Net position (longs − shorts) as % of open interest, report as of ${nice(wk)} (Tuesday; published the following Friday). Financial futures use leveraged funds (hedge funds, CTAs); commodities use managed money.`;
  c.csv = [['Market', 'Speculators', 'Net % OI', '3y percentile', 'z', '1w change', '4w change', 'Read', 'Other side'],
    ...rows.map(r => [r.m.label, r.m.spec_label, r.s.v, r.s.pct.toFixed(0), r.s.z.toFixed(2), r.s.chg ?? '', r.s.chg4 ?? '', crowd(r.s.pct, r.s.v)[0], r.a ? `${r.m.alt_label} ${r.a.v}` : ''])];
  setNote(c, 'Crowded = speculators in the top or bottom 10% of their 3-year range and on that side of zero (if they are still net short at a 3-year high, it reads “shorts covered”). Crowded positions are vulnerable to sharp reversals if the news turns, but can stay crowded while a trend runs. For Treasury, yen and other futures quoted against the USD, long futures means long the bond or long the currency.');
}
function renderPosHist(c) {
  if (!POS || !POS.markets[state.posSel]) return setEmpty(c, 'Positioning data arrives with the next daily run.');
  const m = POS.markets[state.posSel];
  c.titleEl.textContent = `Positioning history: ${m.label}`;
  const spec = pts(posSeries(m, 'spec'), state.from, state.to);
  const price = m.price && has(m.price) ? pts(S[m.price], state.from, state.to) : null;
  if (price) drawPair(c, { name: `${m.spec_label}, net % of OI`, data: spec }, { name: S[m.price].label, data: price },
    { fmtA: v => sign(v) + fmtNum(Math.abs(v), 1) + '%', fmtB: v => fmtNum(v, autoDec(v)), axisA: v => fmtNum(v, 0) + '%', axisB: v => fmtNum(v, autoDec(v)), zeroA: true });
  else drawLines(c, [{ name: `${m.spec_label}, net % of OI`, data: spec }, { name: `${m.alt_label}, net % of OI`, data: pts(posSeries(m, 'alt'), state.from, state.to) }],
    { fmt: v => sign(v) + fmtNum(Math.abs(v), 1) + '%', axisFmt: v => fmtNum(v, 0) + '%', zero: true });
  c.subEl.textContent = (price ? `Weekly speculative positioning against the price (${S[m.price].label}).` : 'Weekly positioning by trader type.') +
    (m.inverse ? ' Long futures = long the bond / currency, so positioning moves opposite to the yield or USD/JPY on the right axis.' : '') + ' Pick another market in the table above.';
  setSource(c, COT_SRC + (price ? '; ' + srcOf([m.price]) : ''));
}
function renderPosExt(c) {
  if (!POS) return setEmpty(c, 'Positioning data arrives with the next daily run.');
  const rows = Object.values(POS.markets).map(m => { const s = posStats(m); return s && { name: m.label, v: s.z, pct: s.pct }; }).filter(Boolean).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 12).sort((a, b) => b.v - a.v);
  const o = baseOpt(); o.legend.show = false;
  o.grid = { left: 8, right: 60, top: 8, bottom: 8, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => { const r = rows[p.dataIndex]; return `<b>${zf(r.v)}σ</b> · ${Math.round(r.pct)}th percentile<br><span style="color:${tok('--ink-2')}">${esc(r.name)}, speculators vs 3 years</span>`; } };
  o.xAxis = { type: 'value', axisLabel: { color: tok('--muted'), fontSize: 11, formatter: v => v + 'σ' }, splitLine: { lineStyle: { color: tok('--grid') } } };
  o.yAxis = { type: 'category', inverse: true, data: rows.map(r => r.name), axisLabel: { color: tok('--ink-2'), fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } };
  o.series = [{ type: 'bar', barWidth: '60%', data: rows.map(r => ({ value: +r.v.toFixed(2), itemStyle: { color: r.v >= 0 ? tok('--pos') : tok('--neg'), borderRadius: r.v >= 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] } })),
    label: { show: true, position: 'right', color: tok('--ink-2'), fontSize: 11, formatter: p => zf(p.value) + 'σ' } }];
  c.chartEl.style.height = Math.max(260, rows.length * 26 + 30) + 'px';
  const ch = inst(c); ch.resize(); ch.setOption(o, true);
  c.csv = [['Market', 'z (3y)', 'Percentile'], ...rows.map(r => [r.name, r.v.toFixed(2), r.pct.toFixed(0)])];
  setNote(c, 'The 12 markets where speculators are furthest from their 3-year average, in standard deviations. Blue = unusually long, red = unusually short.');
  setSource(c, COT_SRC + '; z-scores calculated');
}
function buildPosVol() {
  const g = $('#pvGrid');
  g.append(el('h3', { class: 'section', text: 'Volatility' }));
  makeCard(g, { key: 'vol_ts', title: 'VIX term structure', range: false, sub: 'Implied S&P 500 volatility for 9 days, 30 days, 3 months and 6 months ahead.', source: 'Cboe via Yahoo Finance (^VIX9D, ^VIX, ^VIX3M, ^VIX6M)', render: renderVolTS });
  makeCard(g, { key: 'vol_x', title: 'Cross-asset implied volatility', range: false, render: renderVolX });
  makeCard(g, { key: 'vol_ratio', title: 'Stress gauge: VIX 3-month / VIX', wide: true, sub: 'Ratio of 3-month to 30-day implied volatility, against the S&P 500. Falls when near-term fear jumps.', render: renderVolRatio });
  makeCard(g, { key: 'vol_ivrv', title: 'Implied vs realised volatility', wide: true, sub: 'VIX against the S&P 500’s actual volatility over the last month, annualised %.', render: renderIvRv });
  g.append(el('h3', { class: 'section', text: 'Positioning (CFTC Commitments of Traders)' }));
  makeCard(g, { key: 'pos_table', title: 'Speculative positioning', wide: true, range: false, source: COT_SRC, render: renderPosTable });
  makeCard(g, { key: 'pos_ext', title: 'Most extreme positioning', range: false, render: renderPosExt });
  makeCard(g, { key: 'pos_hist', title: 'Positioning history', render: renderPosHist });
  for (const k of ['pos_table']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
}
function renderPosVol() { posvolKpis(); ['vol_ts', 'vol_x', 'vol_ratio', 'vol_ivrv', 'pos_table', 'pos_ext', 'pos_hist'].forEach(k => cards[k].render()); }

// ------------------------------------------------------------------ STRESS PANEL & PEAK SIGNPOSTS (ported from the Streamlit version)
let SIGN = null, STR = null;
state.stMode = 'composite';
const STRESS_IDS = { Composite: 'STRESS_COMPOSITE', Funding: 'STRESS_FUNDING', Credit: 'STRESS_CREDIT', Growth: 'STRESS_GROWTH' };
const legacyBand = p => p >= 90 ? ['Acute', '--critical'] : p >= 75 ? ['Elevated', '--serious'] : p >= 50 ? ['Above normal', '--warning'] : p >= 25 ? ['Normal', '--muted'] : ['Calm', '--good'];
const STR_SRC = 'Dashboard composite (method of the earlier Streamlit version): 23 FRED series in Funding, Credit and Growth blocks, each percentile-ranked weekly against its trailing 10 years';
function stressKpis() {
  const box = $('#stKpis'); box.replaceChildren();
  const tile = (label, valueNode, delta, foot, tk) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: label }),
    el('div', { class: 'k-value' }, tk ? el('span', { class: 'qdot', style: `background:${tok(tk)}` }) : '', valueNode), el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: foot })));
  for (const [lab, id] of Object.entries(STRESS_IDS)) if (has(id)) {
    const a = asOf(S[id], state.to), b = asOf(S[id], a.t - 28 * DAY), [bl, tk] = legacyBand(a.v);
    tile(lab === 'Composite' ? 'Stress composite' : `${lab} block`, `${Math.round(a.v)}`, `${bl} · 4w ${sign(a.v - b.v)}${fmtNum(Math.abs(a.v - b.v), 0)}`, 'percentile · week of ' + nice(a.t), tk);
  }
  if (has('OFR_FSI_PCT')) { const a = asOf(S.OFR_FSI_PCT, state.to); tile('OFR FSI cross-check', `${Math.round(a.v)}`, legacyBand(a.v)[0] + ', same basis', 'not a member of the composite', legacyBand(a.v)[1]); }
  if (SIGN) { const n = SIGN.n_peaks, cols = SIGN.columns; let j = cols.length - 1; while (j > n && SIGN.share[j] == null) j--; if (SIGN.share[j] == null) j = n - 1;
    const avg = SIGN.share.slice(0, n).filter(x => x != null).reduce((a, b) => a + b, 0) / SIGN.share.slice(0, n).filter(x => x != null).length;
    tile(`Signposts triggered (${cols[j]})`, `${SIGN.triggered[j]} of ${SIGN.evaluated[j]}`, `${fmtNum(SIGN.share[j], 0)}% of rules that can be judged`, 'late-cycle checklist');
    tile('Average at prior peaks', fmtNum(avg, 0) + '%', `now ${sign(SIGN.share[j] - avg)}${fmtNum(Math.abs(SIGN.share[j] - avg), 0)} pts vs that average`, 'five S&P 500 peaks'); }
}
function renderStressHist(c) {
  if (!has('STRESS_COMPOSITE')) return setEmpty(c, 'Waiting for data (next daily run).');
  const list = state.stMode === 'composite' ? [{ name: 'Stress composite', data: pts(S.STRESS_COMPOSITE, state.from, state.to) }]
    : ['Funding', 'Credit', 'Growth'].filter(k => has(STRESS_IDS[k])).map((k, i) => ({ name: k, data: pts(S[STRESS_IDS[k]], state.from, state.to), color: col(i) }));
  drawLines(c, list, { fmt: v => fmtNum(v, 0), axisFmt: v => fmtNum(v, 0), endLabels: list.length > 1, yExtra: { min: 0, max: 100, scale: false },
    hlines: [{ y: 50, label: 'above normal' }, { y: 75, label: 'elevated' }, { y: 90, label: 'acute' }], areas: recessionAreas(state.from, state.to) });
  setNote(c, 'Weekly, 0–100. Each member is ranked against its own trailing 10 years, so a decade of calm can make modest stress look high (and vice versa). Grey = US recessions.');
}
function renderStressOfr(c) {
  if (!has('STRESS_COMPOSITE', 'OFR_FSI_PCT')) return setEmpty(c, 'Waiting for data (next daily run).');
  const a = pts(S.STRESS_COMPOSITE, state.from, state.to), b = pts(S.OFR_FSI_PCT, state.from, state.to);
  drawLines(c, [{ name: 'Dashboard composite', data: a }, { name: 'OFR FSI, same basis', data: b }], { fmt: v => fmtNum(v, 0), axisFmt: v => fmtNum(v, 0), yExtra: { min: 0, max: 100, scale: false } });
  const m = new Map(b.map(p => [p[0], p[1]])), pr = a.filter(p => m.has(p[0])), r = pearson(pr.map(p => p[1]), pr.map(p => m.get(p[0])));
  setNote(c, `The Office of Financial Research's Financial Stress Index (33 market variables), percentile-ranked exactly like the composite. It is a check, not a member. Correlation over the selected range: ${r == null ? 'n/a' : fmtNum(r, 2)}. Large gaps usually mean the macro and funding blocks see something markets do not (or the reverse).`);
}
function renderStressHeat(c) {
  if (!STR || !STR.heatmap || !STR.heatmap.rows.length) return setEmpty(c, 'Waiting for data (next daily run).');
  const H = STR.heatmap, ys = H.rows.map(r => `${r.label}`), data = [];
  H.rows.forEach((r, y) => r.v.forEach((v, x) => { if (v != null) data.push([x, y, v]); }));
  const o = baseOpt(); o.legend.show = false;
  o.grid = { left: 8, right: 8, top: 8, bottom: 52, containLabel: true };
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => `<b>${p.value[2]}th percentile</b><br><span style="color:${tok('--ink-2')}">${esc(ys[p.value[1]])}, ${esc(nice(Date.parse(H.dates[p.value[0]])))}</span>` };
  o.xAxis = { type: 'category', data: H.dates.map(d => d.slice(0, 7)), axisLabel: { color: tok('--muted'), fontSize: 10, interval: Math.ceil(H.dates.length / 8) }, axisTick: { show: false }, axisLine: { show: false } };
  o.yAxis = { type: 'category', inverse: true, data: ys, axisLabel: { color: tok('--ink-2'), fontSize: 11 }, axisTick: { show: false }, axisLine: { show: false } };
  o.visualMap = { min: 0, max: 100, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 160, itemWidth: 10, text: ['100 stressed', '0 calm'], textStyle: { color: tok('--muted'), fontSize: 11 },
    inRange: { color: [tok('--s1'), tok('--mid'), tok('--serious'), tok('--critical')] } };
  o.series = [{ type: 'heatmap', data, itemStyle: { borderColor: tok('--surface'), borderWidth: 1 } }];
  c.chartEl.style.height = Math.max(360, ys.length * 20 + 90) + 'px';
  const ch = inst(c); ch.resize(); ch.setOption(o, true);
  c.csv = [['Indicator', ...H.dates], ...H.rows.map(r => [r.label, ...r.v])];
  setNote(c, 'Every member over the last three years (fortnightly), sign-aligned so warmer always means more stress. Rows run Funding, Credit, Growth.');
}
function renderStressTable(c) {
  const b = htmlBody(c);
  if (!STR) { b.append(el('div', { class: 'empty', text: 'Waiting for data (next daily run).' })); return; }
  const tbl = el('table', { class: 'perf' });
  tbl.append(el('thead', {}, el('tr', {}, ...['Indicator', 'Percentile', 'Band', 'Latest', 'Last changed', 'Direction', 'Source'].map(h => el('th', { text: h })))));
  const tb = el('tbody'); let g = null;
  for (const r of STR.snapshot) {
    if (r.block !== g) { g = r.block; tb.append(el('tr', { class: 'grp' }, el('td', { colspan: 7, text: `${g} block · ${Math.round(STR.blocks[g] ?? 0)}` }))); }
    const [lab, tk] = legacyBand(r.pct);
    const val = r.unit === '$tn' ? '$' + fmtNum(r.latest, 2) + 'tn' : r.unit === 'k' ? fmtNum(r.latest / 1000, 0) + 'k' : r.unit === '%' ? fmtNum(r.latest, 2) + '%' : r.unit === 'bp' ? fmtNum(r.latest, 1) + 'bp' : fmtNum(r.latest, Math.abs(r.latest) < 10 ? 2 : 0) + (r.unit && r.unit !== 'idx' ? ' ' + r.unit : '');
    tb.append(el('tr', { class: 'row' }, el('td', { text: r.label }),
      el('td', {}, el('span', { class: 'pbar' }, el('span', { class: 'track' }, el('span', { class: 'fill', style: `width:${r.pct}%;background:${tok(tk)}` })), el('span', { class: 'pv', text: Math.round(r.pct) }))),
      el('td', {}, el('span', { class: 'chip', style: `--st:${tok(tk)}` }, lab)), el('td', { text: val }), el('td', { class: 'muted', text: r.asof }),
      el('td', { class: 'muted', text: r.direction }), el('td', { class: 'muted', text: r.source })));
  }
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  if (STR.tripwires && STR.tripwires.length) {
    b.append(el('h4', { text: 'Growth tripwires' }));
    const t2 = el('table', { class: 'perf' });
    t2.append(el('thead', {}, el('tr', {}, ...['Tripwire', 'Latest', 'Threshold', 'Status', 'Rule'].map(h => el('th', { text: h })))));
    const tb2 = el('tbody');
    for (const t of STR.tripwires) tb2.append(el('tr', { class: 'row' }, el('td', { text: t.label }), el('td', { text: `${fmtNum(t.value, 2)} (${t.asof})` }),
      el('td', { text: `${t.side} ${t.threshold}` }), el('td', {}, el('span', { class: 'chip', style: `--st:${tok(t.hit ? '--critical' : '--good')}` }, t.hit ? '⚠ triggered' : 'not triggered')), el('td', { class: 'muted', text: t.rule })));
    t2.append(tb2); b.append(el('div', { class: 'table-wrap' }, t2));
  }
  c.csv = [['Block', 'Indicator', 'Percentile', 'Band', 'Latest', 'Unit', 'Last changed', 'Direction', 'Source'], ...STR.snapshot.map(r => [r.block, r.label, r.pct, r.band, r.latest, r.unit, r.asof, r.direction, r.source])];
  setNote(c, `${STR.members} members, each percentile-ranked weekly against its own trailing ${STR.window_years} years and sign-aligned (low reserves, weak growth and low net liquidity count as stress). Blocks are simple averages; the composite weights the three blocks equally so a block with more members does not outvote one with fewer. "Last changed" is when the series last moved, which shows how stale a slow monthly series is.`);
}
function renderSignGrid(c) {
  const b = htmlBody(c);
  if (!SIGN) { b.append(el('div', { class: 'empty', text: 'Signposts arrive with the next daily run.' })); return; }
  const n = SIGN.n_peaks, tbl = el('table', { class: 'perf sign' });
  const hr = el('tr', {}, el('th', { text: 'Signpost' }));
  SIGN.columns.forEach((cname, j) => hr.append(el('th', { class: 'center' + (j === n ? ' sep' : ''), text: cname })));
  tbl.append(el('thead', {}, el('tr', {}, el('th', {}), el('th', { colspan: n, class: 'center', text: 'Prior S&P 500 peaks' }), el('th', { colspan: SIGN.columns.length - n, class: 'center sep', text: 'Last three months' })), hr));
  const tb = el('tbody'); let g = null;
  for (const r of SIGN.rows) {
    if (r.group !== g) { g = r.group; tb.append(el('tr', { class: 'grp' }, el('td', { colspan: SIGN.columns.length + 1, text: g }))); }
    const tr = el('tr', { class: 'row', title: r.rule }, el('td', { text: r.label }));
    r.cells.forEach((v, j) => tr.append(el('td', { class: 'cell ' + (v === 1 ? 'on' : v === 0 ? 'off' : 'na') + (j === n ? ' sep' : ''), text: v === 1 ? '✓' : v === 0 ? '·' : '–' })));
    tb.append(tr);
  }
  const sr = el('tr', { class: 'grp' }, el('td', { text: '% triggered (triggered / evaluated)' }));
  SIGN.share.forEach((v, j) => sr.append(el('td', { class: 'center' + (j === n ? ' sep' : ''), text: v == null ? '–' : `${fmtNum(v, 0)}% (${SIGN.triggered[j]}/${SIGN.evaluated[j]})` })));
  tb.append(sr); tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = [['Signpost', ...SIGN.columns], ...SIGN.rows.map(r => [r.label, ...r.cells.map(v => v == null ? '' : v)]), ['% triggered', ...SIGN.share]];
  setNote(c, '✓ triggered · “·” not triggered · “–” the rule’s inputs do not reach that month, so it is excluded from that column’s denominator (a share on fewer than four rules is not shown). Hover a row for its rule. Five peaks is a very small sample: this asks which conditions rhyme with prior late cycles, not how likely a peak is.');
}
function renderSignShare(c) {
  if (!has('SIGN_SHARE')) return setEmpty(c, 'Signposts arrive with the next daily run.');
  const peaks = (SIGN ? SIGN.peak_dates : ['1990-07-16', '2000-03-24', '2007-10-09', '2020-02-19', '2022-01-03']).map(d => Date.parse(d));
  const n = SIGN ? SIGN.n_peaks : 5, ps = SIGN ? SIGN.share.slice(0, n).filter(x => x != null) : [], avg = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : null;
  drawLines(c, [{ name: '% of evaluable signposts triggered', data: pts(S.SIGN_SHARE, state.from, state.to), extra: { areaStyle: { color: hexA(col(1), 0.14) }, lineStyle: { width: 2, color: col(1) } }, color: col(1) }],
    { fmt: v => fmtNum(v, 0) + '%', axisFmt: v => v + '%', yExtra: { min: 0, max: 100, scale: false }, endLabels: false, hlines: avg ? [{ y: +avg.toFixed(1), label: `average at prior peaks · ${fmtNum(avg, 0)}%` }] : [], areas: recessionAreas(state.from, state.to) });
  inst(c).setOption({ series: [{}, { type: 'line', data: [], markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: tok('--critical'), type: 'dotted', width: 1.2 },
    data: peaks.filter(t => t >= state.from && t <= state.to).map(t => ({ xAxis: t })) } }] });
  setNote(c, `Dotted red lines mark the five peaks; grey = US recessions. The line starts in ${new Date(S.SIGN_SHARE.t[0]).getUTCFullYear()}: before that fewer than four rules can be judged, and a share on a denominator of two says more about which series existed than about the cycle.`);
}
function renderSignRules(c) {
  const b = htmlBody(c);
  if (!SIGN) { b.append(el('div', { class: 'empty', text: 'Signposts arrive with the next daily run.' })); return; }
  let j = SIGN.columns.length - 1;
  const tbl = el('table', { class: 'perf rules' });
  tbl.append(el('thead', {}, el('tr', {}, ...['Group', 'Signpost', 'Now', 'Latest reading', 'Trigger rule', 'Source'].map(h => el('th', { text: h })))));
  const tb = el('tbody');
  for (const r of SIGN.rows) { let k = j; while (k > SIGN.n_peaks && r.cells[k] == null) k--; const v = r.cells[k];
    tb.append(el('tr', { class: 'row' }, el('td', { class: 'muted', text: r.group }), el('td', { text: r.label }),
      el('td', { text: (v === 1 ? '✓ triggered' : v === 0 ? '·  no' : '—  no data') + (v != null && k !== j ? ` (${SIGN.columns[k]})` : '') }),
      el('td', { text: r.level || '—' }), el('td', { class: 'rule', text: r.rule }), el('td', { class: 'muted', text: r.source }))); }
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  const notes = SIGN.rows.filter(r => r.note);
  if (notes.length) { const d = el('details', { class: 'method' }, el('summary', { text: 'Notes on individual rows' }));
    const bd = el('div', { class: 'body' }); notes.forEach(r => bd.append(el('p', {}, el('b', { text: r.label + ' — ' }), r.note))); d.append(bd); b.append(d); }
  const short = SIGN.rows.filter(r => !r.reaches_first_peak);
  const cov = el('details', { class: 'method' }, el('summary', { text: `Data coverage — ${short.length} row(s) cannot reach every peak` }));
  const cb = el('div', { class: 'body' }); SIGN.rows.forEach(r => cb.append(el('p', { text: `${r.label}: first evaluable ${r.first || 'never'}${r.reaches_first_peak ? '' : ' (does not reach Jul 1990)'}` })));
  cb.append(el('p', { class: 'muted', text: 'A short history here is a property of the source, not a failed refresh. The ICE BofA spread series are served by FRED as a rolling three-year window, which is why the decompression row reaches none of the peak columns. VIX starts in 1990 and needs five years before its 10-year rank is emitted.' }));
  cov.append(cb); b.append(cov);
  const nd = el('details', { class: 'method' }, el('summary', { text: 'What this deliberately does not attempt' }));
  const nb = el('div', { class: 'body' });
  nb.append(el('p', { text: 'Published sell-side peak checklists lean on inputs that are licensed or proprietary. Rather than substitute lookalikes and report a “% triggered” number that would silently mean something different, those rows are simply absent: sell-side strategist equity allocation (a bank’s own survey, not published free); fund manager survey cash levels (subscription only); Conference Board expectations for stock prices (licensed; UMich sentiment asks a different question, so it is not a substitute); IBES long-term growth expectations (LSEG/Refinitiv); M&A deal counts (Dealogic/Refinitiv/Bloomberg); and a bank’s own credit stress composite (undisclosed weights).' }),
    el('p', { text: 'Two rows are related to that last one without replicating it: the Baa−10y complacency row and the CCC−BB decompression row measure credit conditions from public data, on rules stated above.' }),
    el('p', { text: 'Five peaks is not a sample you can do statistics on. A row that ticked at four of five is a pattern worth a second look, not evidence. And every threshold here (1σ, the bottom quartile, 100bp, 0.3pp) is a choice. Move them and the picture moves.' }));
  nd.append(nb); b.append(nd);
  c.csv = [['Group', 'Signpost', 'Rule', 'Source', 'Latest reading', 'First evaluable'], ...SIGN.rows.map(r => [r.group, r.label, r.rule, r.source, r.level || '', r.first || ''])];
}
function buildStress() {
  const g = $('#stGrid');
  g.append(el('h3', { class: 'section', text: 'Composite stress panel' }));
  makeCard(g, { key: 'st_hist', title: 'Stress composite', wide: true, defaultRange: '10Y', sub: 'Percentile of current stress against the trailing 10 years: Funding, Credit and Growth blocks, weighted equally.',
    seg: { key: 'stMode', options: [['composite', 'Composite'], ['blocks', 'Blocks']] }, source: STR_SRC, render: renderStressHist });
  makeCard(g, { key: 'st_heat', title: 'Where the stress is', range: false, source: STR_SRC, render: renderStressHeat });
  makeCard(g, { key: 'st_ofr', title: 'Cross-check: OFR Financial Stress Index', defaultRange: '10Y', source: 'Office of Financial Research (financialresearch.gov, OFR FSI); dashboard composite', render: renderStressOfr });
  makeCard(g, { key: 'st_table', title: 'Where everything stands', wide: true, range: false, source: STR_SRC, render: renderStressTable });
  g.append(el('h3', { class: 'section', text: 'Peak signposts: a late-cycle checklist' }));
  makeCard(g, { key: 'sg_grid', title: 'Peak signposts', wide: true, range: false,
    sub: 'A late-cycle checklist built only from data that can be verified for free. Not a replication of any published bank exhibit: the rows, thresholds and denominator are this dashboard’s own, and every rule is printed below.',
    source: 'FRED (VIXCLS, BAA10Y, T10Y3M, FEDFUNDS, DRTSCILM, UNRATE, BAMLH0A3HYC, BAMLH0A1HYBB); Shiller (ie_data.xls)', render: renderSignGrid });
  makeCard(g, { key: 'sg_share', title: 'Share of signposts triggered, month by month', wide: true, defaultRange: 'MAX', earliest: Date.UTC(1970, 0, 1), source: 'Peak signposts (rules below)', render: renderSignShare });
  makeCard(g, { key: 'sg_rules', title: 'What each row actually tests', wide: true, range: false, source: 'Rules from the earlier Streamlit version (legacy/data/signposts.py)', render: renderSignRules });
  for (const k of ['st_table', 'sg_grid', 'sg_rules']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
}
function renderStress() { stressKpis(); ['st_hist', 'st_heat', 'st_ofr', 'st_table', 'sg_grid', 'sg_share', 'sg_rules'].forEach(k => cards[k].render()); }

// ------------------------------------------------------------------ MARKETS
const GROUP_ORDER = ['Equities · US', 'Equities · Europe', 'Equities · Japan', 'Equities · China/HK', 'Equities · N. Asia',
  'Equities · ASEAN', 'Equities · India', 'Equities · Australia', 'Equities · LatAm', 'Equities · Global', 'Equities · AI', 'Equities · US sectors',
  'Rates · US', 'Rates · Japan', 'Rates · Euro area', 'Rates · Singapore', 'Rates · Malaysia', 'Rates · China', 'Credit', 'Bonds & credit', 'FX', 'Commodities', 'Crypto', 'Volatility'];
const PERF_FRED = ['UST2Y', 'UST10Y', 'UST30Y', 'REAL10Y', 'BE10Y', 'CURVE_2s10s', 'HY_OAS', 'IG_OAS', 'JGB2Y', 'JGB10Y', 'JGB30Y', 'EA2Y', 'EA10Y', 'EA30Y', 'SORA3M', 'SGS2Y', 'SGS10Y', 'MY_OPR', 'CN_10Y', 'JP_CALL'];
const PERIODS = [['1D', null], ['1W', t => t - 7 * DAY], ['1M', t => addMonths(t, -1)], ['3M', t => addMonths(t, -3)],
  ['YTD', t => Date.UTC(new Date(t).getUTCFullYear() - 1, 11, 31)], ['1Y', t => addMonths(t, -12)], ['Range', () => state.from]];
state.mktCcy = 'local';
const mktSeries = id => state.mktCcy !== 'local' && convertible(id) ? inCcy(id, state.mktCcy) : S[id];
function perfRows() {
  const ids = Object.keys(S).filter(id => S[id].source && S[id].source.startsWith('Yahoo')).concat(PERF_FRED.filter(id => has(id)));
  return ids.filter(id => has(id)).map(id => {
    const s = mktSeries(id), a = asOf(s, state.to);
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
const PERF_CLASSES = ['Equities', 'Rates & credit', 'FX', 'Commodities & crypto', 'Volatility', 'All'];
const perfClass = g => /^Equities/.test(g) ? 'Equities' : /^(Rates|Credit|Bonds)/.test(g) ? 'Rates & credit' : /^FX/.test(g) ? 'FX'
  : /^(Commodities|Crypto)/.test(g) ? 'Commodities & crypto' : /^Volatility/.test(g) ? 'Volatility' : 'All';
state.perfClass = 'Equities';
function renderPerfTable() {
  const rows = perfRows().filter(r => state.perfClass === 'All' || perfClass(r.s.group) === state.perfClass);
  const nav = $('#perfNav');
  if (nav) nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', b.textContent === state.perfClass));
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
  $('#perfNote').textContent = `Changes to ${nice(state.to)}. “Range” runs from ${nice(state.from)}. ${state.mktCcy === 'local' ? 'Prices in local currency' : `Equities, ETFs, commodities and crypto in ${state.mktCcy} (FX pairs unchanged)`}, % (ETFs include dividends); yields and spreads in bp; VIX/MOVE in points. Tick a row to chart it.`;
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
      const s = mktSeries(id), p = pts(s, state.from, state.to), b = asOf(s, state.from) || (p[0] && { v: p[0][1] });
      return { name: s.label, data: b ? p.map(([t, v]) => [t, v / b.v * 100]) : [], color: col(state.selSlot[id]) };
    });
    drawLines(c1, list, { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0) });
    c1.subEl.textContent = `Each series = 100 on ${nice(state.from)}. ${state.mktCcy === 'local' ? 'Local currency; ETFs in USD with dividends.' : `Converted to ${state.mktCcy} at daily FX; FX pairs unchanged.`}`;
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
  makeCard(g, { key: 'rebased', title: 'Relative performance', wide: true, source: 'Yahoo Finance, FRED', render: renderMktCharts,
    seg: { key: 'mktCcy', select: true, label: 'Currency', options: CCY_CHOICES, onchange: () => { syncMktCcy(); renderMarkets(); } } });
  const sel = el('select', { class: 'mini-select', id: 'perfCcy', 'aria-label': 'Currency' });
  CCY_CHOICES.forEach(([v, l]) => sel.append(el('option', { value: v, text: l })));
  sel.addEventListener('change', () => { state.mktCcy = sel.value; syncMktCcy(); renderMarkets(); });
  $('#perfCsv').before(sel);
  // the performance table is split by asset class, like the sub-tabs on other pages
  const nav = el('div', { class: 'subtabs', id: 'perfNav', role: 'tablist', 'aria-label': 'Asset class' });
  PERF_CLASSES.forEach(k => nav.append(el('button', { type: 'button', role: 'tab', text: k, onclick: () => { state.perfClass = k; renderPerfTable(); } })));
  $('#mktCharts').before(nav);
  makeCard(g, { key: 'yields', title: 'Selected rates & spreads', wide: true, sub: 'Levels, %.', source: 'FRED', render: renderMktCharts });
}
function syncMktCcy() { if (cards.rebased.segSel) cards.rebased.segSel.value = state.mktCcy; const p = $('#perfCcy'); if (p) p.value = state.mktCcy; }
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
// bond-return convention: a fall in a yield or spread counts as a positive return (−Δyield), except curve slopes
const flipsSign = id => corrSettings().yields === 'bond' && S[id].kind === 'yield' && !/^CURVE_|_SLOPE|^SOFR_/.test(id);
function pairReturns(a, b, freq) {
  const fa = flipsSign(a), fb = flipsSign(b);
  const key = a + '~' + b + '|' + freq + (fa ? '-a' : '') + (fb ? '-b' : '');
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
        ra.push(la ? Math.log(va / pa) : fa ? pa - va : va - pa);
        rb.push(lb ? Math.log(vb / pb) : fb ? pb - vb : vb - pb);
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
  return { uni: $('#corrUniverse').value, months: +$('#corrWindow').value, freq: $('#corrFreq').value, show: $('#corrShow').value, yields: $('#corrYields').value };
}
function renderCorrMatrix(c) {
  const { uni, months, freq, show } = corrSettings();
  const ids = UNIVERSES[uni].filter(id => has(id));
  if (ids.length < 2) return setEmpty(c, 'Not enough data loaded for this universe yet.');
  const wLab = $('#corrWindow').selectedOptions[0].text;
  c.titleEl.textContent = show === 'now' ? `Correlation matrix: ${uni}` : `Correlation change vs 3Y average: ${uni}`;
  setSource(c, srcOf(ids) + '; correlations calculated');
  c.subEl.textContent = `${freq === 'D' ? 'Daily' : 'Weekly'} returns, ${wLab} window ending ${nice(state.to)}.` + (corrSettings().yields === 'bond' ? ' Yields and spreads as bond returns (a fall in yield = positive), so stocks vs yields reads as stocks vs bonds.' : ' Yields and spreads as changes in level.') + (show === 'chg' ? ' Blue = more positive than usual.' : '');
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
    ul.append(el('li', { title: 'Click to chart the rolling correlation', onclick: () => { state.corrA = s.a; state.corrB = s.b; setSub('correlation', 1); } },
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
  const yieldish = id => S[id].kind === 'yield' && !/^CURVE_/.test(id), eq = id => S[id].kind === 'price' && S[id].group && S[id].group.startsWith('Equities');
  if ((yieldish(a) && eq(b)) || (yieldish(b) && eq(a))) {
    hint = flipsSign(a) || flipsSign(b)
      ? ' Read as stocks vs bonds (bond return = fall in yield). Positive: they gain and lose together, so bonds do not diversify equities (as in 2022). Negative: bonds rally when stocks fall, so they hedge.'
      : ' Read as stocks vs yield changes. Positive: stocks and yields rise together, so bonds rally when stocks fall (they hedge). Negative: stocks fall as yields rise, as in 2022.';
  }
  const conv = [a, b].filter(flipsSign);
  if (conv.length) c.subEl.textContent += ` ${conv.map(id => S[id].label).join(' and ')} shown as bond return (−Δyield).`;
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
  ['#corrUniverse', '#corrWindow', '#corrFreq', '#corrShow', '#corrYields'].forEach(s => $(s).addEventListener('change', renderCorrelation));
}
function renderCorrelation() { cards.matrix.render(); cards.pair.render(); }

// ------------------------------------------------------------------ sub-tabs
// Each page is split into sub-tabs so only one section shows at a time. Entries are card keys or '#element-id'.
const SUBTABS = {
  overview: [['Today', ['points', 'headlines', 'moved', 'fragile']], ['Where we are', ['where']]],
  liquidity: [['Fed & reserves', ['netliq', 'comp', 'fund', 'scarcity', 'gcb']], ['Credit, money & rates', ['credit', 'nfci', 'm2', 'rates']]],
  regime: [['Regime now', ['#regMethod', '#regNow', 'quad', 'comp_gi', 'reghist', 'regtable']], ['Leading indicators', ['lei', 'leidrv', 'leadlag', 'cli', 'cugold', 'cycdef']],
    ['Inputs & recession watch', ['zg', 'zi', 'sahm', 'recprob', 'infl', 'claims']]],
  fixed: [['Curves', ['curve', 'xcurve', 'slopes']], ['Yields', ['teny', 'real']], ['FX & hedging', ['diff', 'hedged']]],
  asia: [['Malaysia', ['myrfx', 'myrtbl', 'myrates', 'mylend', 'mylead', 'mygrowth', 'mytrade', 'myprices', 'mymoney']],
    ['Singapore', ['sgrates', 'sgust', 'sghedge', 'sneer', 'sginfl', 'sggrowth']], ['Australia', ['aurates', 'auinfl', 'audiff', 'augrowth', 'autot']],
    ['Across Asia', ['ax_cpi', 'ax_exp', 'ax_10y', 'ax_short', 'ax_ip', 'ax_conf']], ['Asian FX', ['asiafx', 'asiaidx']]],
  cnjp: [['China', ['cn_infl', 'cn_trade', 'cn_conf', 'cn_spread']], ['Japan', ['jp_infl', 'jp_policy', 'jp_tankan', 'jp_act', 'jp_boj']]],
  ai: [['Adoption', ['ai_usage', 'ai_share', 'ai_hist']], ['Prices & cost', ['ai_frontier', 'ai_cpr']], ['Build-out', ['ai_bench', 'ai_rev', 'ai_dc', 'ai_chips']], ['AI stocks', ['ai_eq']]],
  valuation: [['Scorecard', ['val_table']], ['US equities', ['val_cape', 'val_fwd', 'val_erp']], ['Bonds, FX & global', ['val_tp', 'val_reer', 'val_stretch']]],
  posvol: [['Volatility', ['vol_ts', 'vol_x', 'vol_ratio', 'vol_ivrv']], ['Positioning (CFTC)', ['pos_table', 'pos_ext', 'pos_hist']]],
  stress: [['Stress composite', ['st_hist', 'st_heat', 'st_ofr', 'st_table']], ['Peak signposts', ['sg_grid', 'sg_share', 'sg_rules']]],
  correlation: [['Matrix & shifts', ['matrix', 'shifts']], ['Rolling correlation', ['pair']]],
};
state.sub = {};
function subActive(node) {
  const g = node.dataset && node.dataset.sub; if (g == null) return true;
  return (state.sub[node.dataset.subtab] || 0) === +g;
}
function buildSubtabs() {
  for (const [tab, groups] of Object.entries(SUBTABS)) {
    const panel = $('#tab-' + tab); if (!panel) continue;
    const nodes = groups.map(([, keys]) => keys.map(k => k[0] === '#' ? $(k) : cards[k] && cards[k].root).filter(Boolean));
    const first = nodes.flat()[0]; if (!first) continue;
    // section headings are replaced by the sub-tab bar
    panel.querySelectorAll('.grid > h3.section').forEach(h => h.remove());
    const nav = el('div', { class: 'subtabs', role: 'tablist', 'aria-label': 'Sections' });
    (first.parentElement.classList.contains('grid') ? first.parentElement : first).before(nav);
    groups.forEach(([label], i) => {
      nav.append(el('button', { type: 'button', role: 'tab', text: label, 'data-i': i, onclick: () => setSub(tab, i) }));
      for (const n of nodes[i]) {
        n.dataset.sub = i; n.dataset.subtab = tab;
        if (n.parentElement.classList.contains('grid')) n.parentElement.append(n);   // regroup in sub-tab order
      }
    });
    syncSub(tab);
  }
}
function syncSub(tab) {
  const panel = $('#tab-' + tab), cur = state.sub[tab] || 0;
  panel.querySelectorAll('.subtabs button').forEach(b => b.setAttribute('aria-selected', +b.dataset.i === cur));
  panel.querySelectorAll('[data-sub]').forEach(n => { if (n.dataset.subtab === tab) n.hidden = +n.dataset.sub !== cur; });
}
function setSub(tab, i) {
  state.sub[tab] = i; syncSub(tab);
  if (state.tab === tab) { renderTab(); window.scrollTo({ top: 0 }); }
}
function filterKpis(boxSel, groupOf) {   // show only the KPI tiles that belong to the open sub-tab
  const tab = $(boxSel).closest('.tab-panel').id.slice(4), groups = SUBTABS[tab], sub = groups[state.sub[tab] || 0][0];
  $(boxSel).querySelectorAll('.kpi').forEach(k => { const g = groupOf(k.querySelector('.k-label').textContent); k.hidden = !(g === sub || g === '*'); });
}

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
  const h = new URLSearchParams({ tab: state.tab, ...(state.sub[state.tab] ? { sub: state.sub[state.tab] } : {}), ...(state.preset === 'custom' ? { from: iso(state.from), to: iso(state.to) } : { range: state.preset }) });
  history.replaceState(null, '', '#' + h.toString());
}
function renderTab() {
  syncFilterUI();
  ({ overview: renderOverview, news: renderNews, liquidity: renderLiquidity, regime: renderRegime, fixed: renderFixedIncome, asia: renderAsia, cnjp: renderCnJp, ai: renderAI, valuation: renderValuation, health: renderHealth, posvol: renderPosVol, stress: renderStress, markets: renderMarkets, correlation: renderCorrelation })[state.tab]();
}
const TAB_TITLES = { overview: 'Strategist View', news: 'News', regime: 'Regime & Leading Indicators', liquidity: 'Liquidity', asia: 'Asia Pacific: Malaysia, Singapore, Australia & region',
  cnjp: 'China & Japan', markets: 'Markets', fixed: 'Fixed Income', correlation: 'Correlation', ai: 'AI: adoption, prices & capex', valuation: 'Valuation', health: 'Data health', posvol: 'Positioning & Volatility', stress: 'Stress & Peak Signposts' };
function setTab(t) {
  state.tab = t;
  $('#pageTitle').textContent = TAB_TITLES[t] || '';
  $('#side').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false');
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  document.querySelectorAll('.tab-panel').forEach(p => p.hidden = p.id !== 'tab-' + t);
  $('.filters').hidden = t === 'news';
  setFiltersHeight();
  renderTab();
}
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
function setFiltersHeight() {   // the sub-tab bar sticks just under the date bar
  const f = $('.filters'), sticky = f && getComputedStyle(f).position === 'sticky';
  document.documentElement.style.setProperty('--filters-h', (sticky && !f.hidden ? f.offsetHeight : 0) + 'px');
}
function wire() {
  window.addEventListener('resize', setFiltersHeight);
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
  try { HEALTH = await loadJSON('data/health.json'); } catch (e) { HEALTH = null; }
  try { POS = await loadJSON('data/positioning.json'); } catch (e) { POS = null; }
  try { SIGN = await loadJSON('data/signposts.json'); } catch (e) { SIGN = null; }
  try { STR = await loadJSON('data/stress.json'); } catch (e) { STR = null; }
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
    if (HEALTH && HEALTH.n_bad) { pill.textContent += ` · ${HEALTH.n_bad} stale`; pill.classList.add('warn'); }
    pill.style.cursor = 'pointer'; pill.addEventListener('click', () => setTab('health'));
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
  buildOverview(); buildLiquidity(); buildRegime(); buildFixedIncome(); buildAsia(); buildCnJp(); buildAI(); buildValuation(); buildPosVol(); buildStress(); buildMarkets(); buildCorrelation(); applySources(); applyPairToggles(); wire();
  if (h.get('tab') && +h.get('sub') > 0 && SUBTABS[h.get('tab')] && +h.get('sub') < SUBTABS[h.get('tab')].length) state.sub[h.get('tab')] = +h.get('sub');
  buildSubtabs();
  setTab(['overview', 'news', 'liquidity', 'regime', 'fixed', 'asia', 'cnjp', 'markets', 'correlation', 'ai', 'valuation', 'health', 'posvol', 'stress'].includes(h.get('tab')) ? h.get('tab') : 'overview');
}
init();
