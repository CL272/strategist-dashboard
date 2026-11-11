/* Strategist Dashboard. Plain JS + ECharts, no build step. */
'use strict';

const DAY = 864e5;
const S = {};                 // series store: id -> {id,label,group,kind,unit,source,note,t:[ms],v:[]}
let META = {};
const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
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
  c.range = o.defaultRange ? { preset: o.defaultRange } : null;   // null = follow the top date bar
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
  // rarely used tools live in one "⋯" menu; toggles stay visible in .card-tools
  c.yBtn = el('button', { class: 'menu-item', type: 'button', text: '↕ Y-axis range…', title: 'Y-axis: drag the axis numbers on the chart up or down to stretch or squeeze the scale (Shift-drag slides it, mouse wheel zooms, double-click resets). Click here for exact values', onclick: () => { closePops(); toggleYPanel(c); } });
  c.menuEl = el('div', { class: 'card-menu pop', hidden: true, role: 'menu' }, c.yBtn,
    el('button', { class: 'menu-item', type: 'button', text: '⤓ Download PNG', title: 'Download chart as image', onclick: () => { closePops(); exportPNG(c); } }),
    el('button', { class: 'menu-item', type: 'button', text: '⤓ Download CSV', title: 'Download chart data', onclick: () => { closePops(); c.csv && downloadCSV(c.csv, c.title); } }));
  const kebab = el('button', { class: 'ghost kebab', type: 'button', text: '⋯', title: 'More: y-axis range, downloads', 'aria-haspopup': 'menu', onclick: e => { e.stopPropagation(); togglePop(c.menuEl); } });
  const actions = el('div', { class: 'card-actions' });
  c.rangeEl = o.range === false ? null : buildCardRange(c);
  if (c.rangeEl) actions.append(c.rangePill);
  actions.append(el('button', { class: 'ghost', type: 'button', text: '⤢', title: 'Focus (enlarge for screenshots)', onclick: () => { c.root.classList.toggle('focus'); setTimeout(() => c.inst && c.inst.resize(), 0); } }),
    el('span', { class: 'pop-anchor' }, kebab, c.menuEl));
  c.titleEl = el('h2', { text: o.title });
  c.subEl = el('p', { class: 'muted small card-sub', text: o.sub || '' });
  c.subEl.addEventListener('click', () => c.subEl.classList.toggle('open'));
  c.subEl.addEventListener('mouseenter', () => { c.subEl.title = c.subEl.scrollHeight > c.subEl.clientHeight + 2 ? c.subEl.textContent + ' (click to expand)' : ''; });
  c.chartEl = el('div', { class: 'chart' });
  c.emptyEl = el('div', { class: 'empty', hidden: true });
  c.noteEl = el('p', { class: 'note', hidden: true });
  c.srcEl = el('p', { class: 'src' });
  c.root = el('div', { class: 'card' + (o.wide ? ' wide' : '') + (o.tall ? ' tall' : '') },
    el('div', { class: 'card-head' }, el('div', { class: 'card-title' }, c.titleEl), tools, actions), c.subEl,
    c.chartEl, c.emptyEl, c.yPanel = el('div', { class: 'y-panel', hidden: true }), c.noteEl, c.srcEl);
  c.srcEl.addEventListener('click', () => c.srcEl.classList.toggle('open'));
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
// ---- TradingView-style y-axis: drag the axis numbers up/down to stretch or squeeze the scale,
// Shift-drag (or two-finger scroll over the axis) to slide it, mouse wheel to zoom at the pointer, double-click to reset.
function axisAt(c, x, y) {   // the numeric y axis whose label strip is under the pointer, or null
  const ch = c.inst, opt = ch.getOption(), n = (opt.yAxis || []).length;
  for (let i = 0; i < n; i++) {
    let m, rect, ext;
    try { m = ch.getModel().getComponent('yAxis', i); if (!m || m.get('type') !== 'value') continue;
      rect = m.getCoordSysModel().coordinateSystem.getRect(); ext = m.axis.scale.getExtent(); } catch (e) { continue; }
    if (y < rect.y - 6 || y > rect.y + rect.height + 6) continue;
    const right = m.axis.position === 'right';
    if (right ? (x >= rect.x + rect.width && x <= rect.x + rect.width + 80) : (x <= rect.x && x >= rect.x - 80)) return { i, rect, ext: [ext[0], ext[1]] };
  }
  return null;
}
function setAxisRange(c, i, lo, hi) {
  if (!(hi > lo) || !isFinite(lo) || !isFinite(hi)) return;
  c.yRange = c.yRange || {};
  c.yRange[i] = { min: lo, max: hi, drag: true };
  const n = (c.inst.getOption().yAxis || []).length, patch = [];
  // a dragged range rarely ends on round numbers, so the two end labels are hidden to keep the axis tidy
  for (let k = 0; k < n; k++) patch.push(k === i ? { min: lo, max: hi, axisLabel: { showMinLabel: false, showMaxLabel: false } } : {});
  c.inst.setOption({ yAxis: patch });
  c.yBtn.classList.add('on');
  if (!c.yPanel.hidden) c.yPanel.hidden = true;
}
function attachAxisDrag(c) {
  const zr = c.inst.getZr();
  let drag = null;
  zr.on('mousedown', e => {
    const a = axisAt(c, e.offsetX, e.offsetY); if (!a) return;
    drag = { ...a, y0: e.offsetY, pan: !!(e.event && e.event.shiftKey) };
    if (e.event && e.event.preventDefault) e.event.preventDefault();
  });
  zr.on('mousemove', e => {
    if (!drag) { if (axisAt(c, e.offsetX, e.offsetY)) zr.setCursorStyle('ns-resize'); return; }
    zr.setCursorStyle('ns-resize');
    const dy = e.offsetY - drag.y0, [lo, hi] = drag.ext, span = hi - lo;
    if (drag.pan) { const d = dy / drag.rect.height * span; setAxisRange(c, drag.i, lo + d, hi + d); }
    else { const f = Math.exp(dy / 160), mid = (lo + hi) / 2; setAxisRange(c, drag.i, mid - span / 2 * f, mid + span / 2 * f); }   // down = squeeze, up = stretch
  });
  const end = () => { drag = null; };
  zr.on('mouseup', end); zr.on('globalout', end);
  zr.on('mousewheel', e => {
    const a = axisAt(c, e.offsetX, e.offsetY); if (!a) return;
    if (e.event) { e.event.preventDefault && e.event.preventDefault(); e.event.stopPropagation && e.event.stopPropagation(); }
    const [lo, hi] = a.ext, span = hi - lo, f = e.wheelDelta > 0 ? 0.88 : 1 / 0.88;
    const at = hi - (e.offsetY - a.rect.y) / a.rect.height * span;   // value under the pointer stays put
    setAxisRange(c, a.i, at - (at - lo) * f, at + (hi - at) * f);
  });
  zr.on('dblclick', e => {
    const a = axisAt(c, e.offsetX, e.offsetY); if (!a || !c.yRange) return;
    delete c.yRange[a.i];
    if (!Object.keys(c.yRange).length) { c.yRange = null; c.yBtn.classList.remove('on'); }
    c.render();
  });
}
function applyYRange(c) {
  if (!c.yRange || !c.inst || c.chartEl.hidden) return;
  const n = (c.inst.getOption().yAxis || []).length;
  const patch = [];
  for (let i = 0; i < n; i++) {
    const r = c.yRange[i];
    const q = {}; if (r && r.min != null) q.min = r.min; if (r && r.max != null) q.max = r.max;
    if (r && r.drag) q.axisLabel = { showMinLabel: false, showMaxLabel: false };
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
    el('span', { class: 'muted small', text: 'Blank = automatic. Grey numbers show the current range. Tip: you can also drag the axis numbers on the chart (double-click the axis to reset).' }));
  c.yPanel.hidden = false;
}
function setSource(c, txt) { c.source = txt; c.srcEl.textContent = txt ? 'Source: ' + txt : ''; c.srcEl.hidden = !txt; c.srcEl.title = txt ? 'Source: ' + txt + ' (click to show in full)' : ''; }
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
  const row = el('div', { class: 'card-range pop', role: 'group', 'aria-label': 'Date range for this chart', hidden: true });
  row.addEventListener('click', e => e.stopPropagation());
  const seg = el('div', { class: 'presets mini' });
  for (const p of RANGE_PRESETS) seg.append(el('button', { type: 'button', text: p === 'MAX' ? 'Max' : p, 'data-p': p,
    onclick: () => { c.range = { preset: p }; c.render(); } }));
  const f = el('input', { type: 'date', 'aria-label': 'From' }), t = el('input', { type: 'date', 'aria-label': 'To' });
  const onDate = () => { const a = Date.parse(f.value), b = Date.parse(t.value); if (!isNaN(a) && !isNaN(b) && a < b) { c.range = { from: a, to: b }; c.render(); } };
  f.addEventListener('change', onDate); t.addEventListener('change', onDate);
  const reset = el('button', { type: 'button', class: 'ghost reset', text: '↺ Follow page range', title: 'Use the date range at the top of the page again',
    onclick: () => { c.range = null; c.render(); closePops(); } });
  seg.title = 'Date range for this chart. Tip: you can also drag across the chart to zoom';
  row.append(el('div', { class: 'pop-label', text: 'Date range for this chart' }), seg, el('span', { class: 'custom' }, f, el('span', { class: 'muted', text: '–' }), t), reset,
    el('div', { class: 'pop-hint', text: 'Tip: drag across the chart to zoom.' }));
  c.rangePill = el('button', { type: 'button', class: 'ghost range-pill', onclick: e => { e.stopPropagation(); togglePop(row); } });
  c.rangePill = el('span', { class: 'pop-anchor' }, c.rangePill, row);
  c.rangeParts = { seg, f, t, reset, pill: c.rangePill.firstChild };
  return row;
}
function syncCardRange(c) {
  const { seg, f, t, reset, pill } = c.rangeParts, [a, b] = c.lastRange;
  const active = c.range ? (c.range.preset || 'custom') : (state.preset || 'custom');
  seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.p === active));
  f.value = iso(a); t.value = iso(b); f.max = t.max = iso(state.latest);
  reset.hidden = !c.range;
  const short = t0 => { const d = new Date(t0); return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`; };
  pill.textContent = (active === 'custom' ? `${short(a)}–${short(b)}` : active === 'MAX' ? 'Max' : active) + ' ▾';
  pill.classList.toggle('own', !!c.range);
  pill.title = `Date range for this chart: ${nice(a)} – ${nice(b)}` + (c.range ? ' (set on this chart; the page range does not change it)' : ' (follows the page range)');
}
function inst(c) {
  c.chartEl.hidden = false; c.emptyEl.hidden = true;
  if (!c.inst) { c.inst = echarts.init(c.chartEl, null, { renderer: 'canvas' }); attachAxisDrag(c); }
  else if (c.chartEl.clientWidth && Math.abs(c.inst.getWidth() - c.chartEl.clientWidth) > 2) c.inst.resize();   // was drawn while hidden
  return c.inst;
}
function setEmpty(c, msg) {
  c.chartEl.hidden = true; c.emptyEl.hidden = false; c.emptyEl.textContent = msg; c.csv = null;
  setNote(c, '');
}
const NOTE_OPEN_KEY = 'sd-notes-open-v1';
let noteOpen = (() => { try { return new Set(JSON.parse(localStorage.getItem(NOTE_OPEN_KEY) || '[]')); } catch (e) { return new Set(); } })();
function splitNote(txt) {   // [lead, rest]: the first sentence (plus any ⚠ warnings) stays visible, the rest folds away
  const parts = txt.split(/(?<=[.!?])\s+(?=[A-Z(“"⚠0-9+−-])/);
  if (parts.length < 2 || txt.length < 170) return [txt, ''];
  let lead = parts[0], i = 1;
  while (lead.length < 40 && i < parts.length) lead += ' ' + parts[i++];   // a very short opener takes the next sentence too
  const rest = parts.slice(i), warn = rest.filter(x => x.includes('⚠')), more = rest.filter(x => !x.includes('⚠'));
  return [[lead, ...warn].join(' '), more.join(' ')];
}
function setNote(c, txt) {
  c.noteEl.hidden = !txt; c.noteEl.replaceChildren(); if (!txt) return;
  const [lead, more] = splitNote(txt);
  c.noteEl.append(el('span', { class: 'note-lead', text: lead }));
  if (!more) return;
  const key = c.key || c.title, open = noteOpen.has(key), rest = el('span', { class: 'note-more', text: ' ' + more, hidden: !open });
  const btn = el('button', { type: 'button', class: 'note-toggle', text: open ? 'Less ▴' : 'How to read ▸', 'aria-expanded': String(open) });
  btn.addEventListener('click', () => {
    const now = rest.hidden; rest.hidden = !now; btn.textContent = now ? 'Less ▴' : 'How to read ▸'; btn.setAttribute('aria-expanded', String(now));
    if (now) noteOpen.add(key); else noteOpen.delete(key);
    try { localStorage.setItem(NOTE_OPEN_KEY, JSON.stringify([...noteOpen])); } catch (e) { /* kept for this visit */ }
  });
  c.noteEl.append(rest, ' ', btn);
}
// ---- small popovers (card range, card menu): one open at a time; click outside or Esc closes
function closePops(except) { document.querySelectorAll('.pop').forEach(p => { if (p !== except) p.hidden = true; }); }
function togglePop(p) { const show = p.hidden; closePops(p); p.hidden = !show; }
document.addEventListener('click', e => { if (!e.target.closest('.pop')) closePops(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closePops(); });
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
  const b = el('button', { class: 'menu-item', type: 'button', text: '⇅ Show as two panels', title: 'Switch between one chart with two axes and two stacked panels' });
  b.addEventListener('click', () => { c.pairMode = c.pairMode === 'stack' ? 'overlay' : 'stack'; b.textContent = c.pairMode === 'stack' ? '⇅ Show on one chart' : '⇅ Show as two panels'; closePops(); c.render(); });
  c.menuEl.prepend(b);
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
// ---- busy charts: short legend names, and at most five lines in colour
const MAX_COLOUR = 5;
const HOME_RE = /^(Malaysia|Malaysian|MY |KLCI|FBM KLCI|BNM|OPR|Singapore|SG |SGS|STI|Straits|S\$|MAS|US |US$|UST|United States|S&P|Fed|EFFR|Effective fed)/i;
function shortNames(names) {   // drop words every legend entry repeats ("… CPI YoY", "… 10Y yield")
  if (names.length < 3) return names;
  let n = names.map(x => x.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\b(headline|government bond)\b/gi, '').replace(/[, ]+$/g, '').replace(/\s{2,}/g, ' ').trim());
  for (let k = 0; k < 4; k++) {   // strip the longest shared trailing words
    const w = n.map(x => x.split(' ')), last = w[0][w[0].length - 1];
    if (!last || w.some(a => a.length < 2 || a[a.length - 1].toLowerCase() !== last.toLowerCase())) break;
    n = w.map(a => a.slice(0, -1).join(' ').replace(/[, ]+$/, ''));
  }
  return new Set(n).size === n.length && n.every(x => x) ? n : names;
}
function focusSeries(list) {   // indexes drawn in colour: home markets first, then list order
  if (list.length <= MAX_COLOUR) return new Set(list.map((_, i) => i));
  const home = list.map((s, i) => HOME_RE.test(s.name) ? i : -1).filter(i => i >= 0).slice(0, MAX_COLOUR - 1);
  const rest = list.map((_, i) => i).filter(i => !home.includes(i));
  return new Set([...home, ...rest].slice(0, home.length ? Math.max(home.length, 3) : 4));
}
function drawLines(c, list, { fmt = v => fmtNum(v, autoDec(v)), axisFmt, zero = false, yExtra = {}, endLabels = true, hlines = [], areas = null, noLegend = false } = {}) {
  if (endLabels && endsTooClose(list)) endLabels = false;
  const focus = focusSeries(list), muted = tok('--muted');
  const series = list.map((s, i) => focus.has(i) ? line(s.name, s.data, s.color || col(i), s.extra || {})
    : line(s.name, s.data, muted, { ...(s.extra || {}), lineStyle: { width: 1.1, color: muted, opacity: 0.55 }, itemStyle: { color: muted }, z: 1 }));
  if (focus.size < list.length) { endLabels = false; series.forEach(x => { x.emphasis = { focus: 'series', lineStyle: { width: 2.6, opacity: 1 } }; x.blur = { lineStyle: { opacity: 0.25 } }; }); }
  const legendNames = shortNames(list.map(s => s.name)), legendMap = new Map(list.map((s, i) => [s.name, legendNames[i]]));
  if ((zero || hlines.length) && series.length) {
    const ml = zeroLine();
    if (!zero) ml.data = [];
    for (const h of hlines) ml.data.push({ yAxis: h.y, lineStyle: { color: h.color || tok('--muted'), type: 'dashed', width: h.color ? 1.5 : 1 },
      label: { show: true, formatter: h.label, color: h.color || tok('--muted'), position: 'insideStartTop', fontSize: 11 } });
    series[0].markLine = ml;
  }
  if (areas && areas.length && series.length) {
    series[0].markArea = { silent: true, data: areas.map(([a, b, color, name]) => [{ xAxis: a, itemStyle: { color }, name: name || '' }, { xAxis: b }]),
      label: { show: false } };
  }
  const o = baseOpt();
  const pad = endLabels ? withEndLabels(series) : 0;
  o.grid.right = 16 + pad;
  o.legend.show = series.length > 1 && !noLegend;
  o.grid.top = o.legend.show ? 12 + 22 * legendRows(c, legendNames) : 14;
  o.legend.formatter = name => legendMap.get(name) || name;
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
state.inflMode = 'actual';
function monthlyYoY(s) {   // month-end values -> YoY % series stamped at month start
  const me = monthEnds(s), keys = [...me.keys()].sort((a, b) => a - b), t = [], v = [];
  for (const k of keys) { const p = me.get(addMonths(k, -12)); if (p) { t.push(k); v.push((me.get(k) / p - 1) * 100); } }
  return { t, v };
}
let spxYoY = null;
function renderM2(c) {
  c.titleEl.textContent = state.m2Mode === 'mmf' ? 'Cash on the sidelines: money market funds' : 'US M2 vs S&P 500';
  if (state.m2Mode === 'mmf') return renderMMF(c);
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
  makeCard(g, { key: 'netliq', title: 'Fed net liquidity vs S&P 500', wide: true, source: 'FRED (WALCL, WDTGAL, RRPONTSYD), Yahoo Finance',
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
    seg: { key: 'm2Mode', options: [['spx', 'vs S&P'], ['lead', '6m lead'], ['m2', 'M2'], ['mmf', 'Money funds']] }, render: renderM2 });
  makeCard(g, { key: 'rates', title: 'US Treasury yields', source: 'FRED',
    seg: { key: 'ratesMode', options: [['yields', 'Yields'], ['curve', 'Curve']] }, render: renderRates });
}
function renderMMF(c) {
  const L = [];
  if (has('MMF_TOTAL')) L.push({ name: 'All money market funds (quarterly)', data: pts(S.MMF_TOTAL, state.from, state.to).map(([t, v]) => [t, v / 1e6]), color: col(0), extra: { step: 'end' } });
  if (has('MMF_RETAIL')) L.push({ name: 'Retail money market funds (weekly)', data: pts(S.MMF_RETAIL, state.from, state.to).map(([t, v]) => [t, v / 1e3]), color: col(1) });
  if (!L.length) return setEmpty(c, NO_FRED);
  c.subEl.textContent = 'Assets of US money market funds, $ trillion. Retail = weekly (ICI); all funds = quarterly (Fed financial accounts).';
  setSource(c, 'FRED (WRMFNS, MMMFFAQ027S); ICI, Federal Reserve Z.1');
  drawLines(c, L, { fmt: v => '$' + fmtNum(v, 2) + 'tn', axisFmt: v => '$' + fmtNum(v, 1) + 'tn', areas: recessionAreas(state.from, state.to) });
  const r = has('MMF_RETAIL') ? asOf(S.MMF_RETAIL, state.to) : null, r1 = r && asOf(S.MMF_RETAIL, addMonths(r.t, -12));
  const head = r ? 'Retail funds $' + fmtNum(r.v / 1e3, 2) + 'tn on ' + dShort(r.t) + (r1 ? ' (' + sign(r.v - r1.v) + fmtNum(Math.abs(r.v / r1.v - 1) * 100, 0) + '% on a year)' : '') + '. ' : '';
  setNote(c, head + 'Money parked in funds can move into risk assets if yields on cash fall, but balances usually keep rising with interest income, so watch the pace, not the level.');
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
  const ids = Object.keys(S).filter(id => ((S[id].source || '').startsWith('Yahoo') && S[id].group !== 'Tickers' && S[id].group !== 'Derived') || PERF_FRED.concat(['EUR_HY_OAS', 'ASIA_CORP_OAS', 'BAA_10Y', 'FWD5Y5Y']).includes(id));
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
  const tbl = el('table', { class: 'perf asset-table' });
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
        tr.append(moveCell(s, v, scale[s.kind][j], a.v));
        row.push(v == null ? '' : v.toFixed(2));
      });
      let d200 = null;
      if (s.kind === 'price') { const m = ma(s, a.i, 200); if (m) d200 = (a.v / m - 1) * 100; }
      tr.append(el('td', { class: 'num ' + (d200 == null ? '' : d200 >= 0 ? 'up' : 'dn'), text: d200 == null ? '–' : (d200 >= 0 ? '▲ ' : '▼ ') + sign(d200) + fmtNum(Math.abs(d200), 1) + '%' }));
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
// ------------------------------------------------------------------ WHAT CHANGED (Strategist View → Today; weekly brief)
// Rule-based list of changes over the week to `end`, most important first. Monthly signals (regime, signposts)
// count as changed when the latest data month differs from the one before.
function goSub(tab, name) { setTab(tab); if (name && SUBTABS[tab]) { const i = SUBTABS[tab].findIndex(x => x[0] === name); if (i >= 0) setSub(tab, i); } }
function whatChanged(end = state.latest) {
  const out = [], wk = end - 7 * DAY, add = (pri, text, tab, sub) => out.push({ pri, text, tab, sub });
  // regime switch and method disagreement
  if (has('REG_QUAD')) { const a = asOf(S.REG_QUAD, end); if (a && a.i > 0 && S.REG_QUAD.v[a.i - 1] !== a.v)
    add(1, `Regime switched to ${QUADS[a.v].name} (from ${QUADS[S.REG_QUAD.v[a.i - 1]].name}) with the ${monthLab(a.t)} data.`, 'regime', 'Regime now'); }
  if (has('REG_Q_A', 'REG_QUAD')) { const r = asOf(S.REG_Q_A, end), c = asOf(S.REG_QUAD, end), r0 = r && r.i > 0 ? S.REG_Q_A.v[r.i - 1] : null;
    if (r && c && r.v !== c.v && r0 === c.v) add(2, `Raw regime signal newly points to ${QUADS[r.v].name} (${monthLab(r.t)}); needs a second month to confirm.`, 'regime', 'Regime now'); }
  // stress composite band
  if (has('STRESS_COMPOSITE')) { const a = asOf(S.STRESS_COMPOSITE, end), b = asOf(S.STRESS_COMPOSITE, wk);
    if (a && b && legacyBand(a.v)[0] !== legacyBand(b.v)[0]) add(a.v > b.v ? 1 : 3, `Stress composite moved from ${legacyBand(b.v)[0].toLowerCase()} to ${legacyBand(a.v)[0].toLowerCase()} (${Math.round(b.v)}th → ${Math.round(a.v)}th percentile).`, 'stress', 'Stress composite'); }
  // peak signposts
  if (SIGN) { const n = SIGN.n_peaks, cols = SIGN.columns; let j = cols.length - 1; while (j > n && SIGN.triggered[j] == null) j--;
    if (j > n && SIGN.triggered[j] != null && SIGN.triggered[j - 1] != null && SIGN.triggered[j] > SIGN.triggered[j - 1])
      add(2, `Peak signposts: ${SIGN.triggered[j] - SIGN.triggered[j - 1]} more triggered in ${cols[j]} (${SIGN.triggered[j]} of ${SIGN.evaluated[j]}).`, 'stress', 'Peak signposts'); }
  // breadth crossing 20% / 80%
  if (TICK) for (const mk of Object.keys(BR_MKTS)) { const b = breadth(mk); if (!b || !b.t.length) continue;
    const at = t => { const i = upperIdx(b.t, t) - 1; return i >= 0 ? b.a200[i] : null; }, x = at(end), y = at(wk);
    if (x == null || y == null) continue;
    for (const lv of [20, 80]) if ((y - lv) * (x - lv) < 0) add(lv === 20 && x < 20 ? 2 : 3, `${BR_MKTS[mk].name} breadth crossed ${lv}%: ${fmtNum(x, 0)}% of large caps above their 200-day average (${fmtNum(y, 0)}% a week ago).`, 'markets', 'Breadth'); }
  // VIX term structure
  if (has('VIX', 'VIX3M')) { const r = t => { const a = asOf(S.VIX3M, t), b = asOf(S.VIX, t); return a && b ? a.v / b.v : null; }, x = r(end), y = r(wk);
    if (x != null && y != null && (x < 1) !== (y < 1)) add(x < 1 ? 1 : 3, x < 1 ? `VIX curve inverted: VIX3M/VIX at ${fmtNum(x, 2)}, below 1 (near-term fear above longer-term).` : `VIX curve back to normal: VIX3M/VIX at ${fmtNum(x, 2)}, above 1 again.`, 'posvol', 'Volatility'); }
  // central bank gauges
  cbPrep();
  for (const k of Object.keys(CBS)) { const a = cbStats(k, end), b = cbStats(k, wk); if (!a || !b || !a.spread || !b.spread) continue;
    if (a.p && b.p && Math.abs(a.p.v - b.p.v) >= 0.05) { add(1, `${CBS[k].short} changed its ${CBS[k].policyLab} by ${bp((a.p.v - b.p.v) * 100)} to ${fmtNum(a.p.v, 2)}%; market gauge now ${bp(a.spread.v)} (read: ${a.read.toLowerCase()}).`, 'cbwatch', CBS[k].sub); continue; }
    const d = a.spread.v - b.spread.v; if (Math.abs(d) > CB_DEAD) add(2, `${CBS[k].short} pricing moved ${bp(d)} on the week (${CBS[k].gaugeLab} ${bp(a.spread.v)}; read: ${a.read.toLowerCase()}).`, 'cbwatch', CBS[k].sub); }
  // big market moves
  const keep = state.to; state.to = end; const mv = movers(1).filter(r => Math.abs(r.z) >= 2).slice(0, 3); state.to = keep;
  for (const r of mv) add(Math.abs(r.z) >= 3 ? 1 : 2, `${S[r.id].label} ${fmtMove(S[r.id], r.chg)} on the week (${zf(r.z)}σ vs its 5-year norm).`, 'markets', 'Performance');
  // ideas hitting target or stop
  for (const x of (IDEAS || []).filter(i => i.status !== 'closed')) { const h = ideaHits(x);
    if (h && h.t > wk && h.t <= end) add(1, `Idea “${x.title}” hit its ${h.what} on ${dShort(h.t)}.`, 'ideas', null); }
  // stale data
  if (HEALTH && HEALTH.n_bad) add(4, `${HEALTH.n_bad} data series stale or missing (Data health page).`, 'health', null);
  return out.sort((a, b) => a.pri - b.pri);
}
function renderChanges(c) {
  const b = htmlBody(c), L = whatChanged();
  if (!L.length) { b.append(el('div', { class: 'muted', text: 'Nothing crossed a threshold this week.' })); return; }
  const ul = el('ul', { class: 'changes' });
  for (const x of L.slice(0, 8)) ul.append(el('li', {}, el('span', { class: 'qdot', style: `background:${tok(x.pri === 1 ? '--critical' : x.pri === 2 ? '--warning' : '--muted')}` }),
    el('a', { href: '#', text: x.text, onclick: e => { e.preventDefault(); goSub(x.tab, x.sub); } })));
  b.append(ul);
  if (L.length > 8) b.append(el('div', { class: 'muted small', text: `${L.length - 8} more not shown.` }));
  c.csv = [['priority', 'change', 'page'], ...L.map(x => [x.pri, x.text, x.tab])];
  setNote(c, 'Rules: regime switch or new raw signal; stress band change; more peak signposts; breadth crossing 20% or 80%; VIX curve inverting; a central bank rate change or gauge move over 15bp; a ≥2σ market move; an idea hitting its target or stop; stale data. Red = most important; click a line to open its page.');
}

function buildOverview() {
  const g = $('#ovGrid');
  const tp = makeCard(g, { key: 'points', range: false, title: 'Talking points', wide: true, source: 'FRED, Yahoo Finance', render: renderPoints });
  const copy = el('button', { class: 'ghost', type: 'button', text: 'Copy', title: 'Copy as text', onclick: async () => {
    try { await navigator.clipboard.writeText(tp.copyText || ''); copy.textContent = 'Copied'; setTimeout(() => copy.textContent = 'Copy', 1500); } catch (e) { alert(tp.copyText); } } });
  tp.root.querySelector('.card-tools').prepend(copy);
  makeCard(g, { key: 'changes', range: false, wide: true, title: 'What changed this week', source: 'Dashboard rules on its own data', render: renderChanges });
  makeCard(g, { key: 'headlines', range: false, title: 'Latest headlines', render: renderHeadlinesCard });
  makeCard(g, { key: 'moved', range: false, title: 'What moved', source: 'Yahoo Finance, FRED',
    seg: { key: 'ovHorizon', options: [['W', '1 week'], ['M', '4 weeks']] }, render: renderMoved });
  makeCard(g, { key: 'fragile', range: false, title: 'Market stress gauges', sub: 'Market-priced stress gauges ranked against their own last 10 years. The full composite is on the Stress & Signposts page.', source: 'FRED, Yahoo Finance', render: renderFragile });
  makeCard(g, { key: 'where', range: false, title: 'Where we are', wide: true, sub: 'Cross-asset snapshot. Switch the currency to see equity and commodity returns as a USD, SGD, MYR, EUR, GBP, JPY or AUD investor.', source: 'Yahoo Finance, FRED',
    seg: { key: 'ovCcy', select: true, label: 'Currency for equity moves', options: CCY_CHOICES }, render: renderWhere });
  makeCard(g, { key: 'cal_next', range: false, title: 'Coming up: next 7 days', sub: 'Key releases and central bank decisions. Times in Singapore/Malaysia time. Full list on the Calendar page.',
    source: 'FRED release calendar; central bank schedules; estimated windows for Asian releases', render: renderCalNext });
  for (const k of ['points', 'changes', 'headlines', 'fragile', 'where', 'cal_next']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
}
const CARD_SOURCES = {"netliq": "FRED (WALCL Fed total assets, WDTGAL Treasury General Account, RRPONTSYD overnight reverse repo); S&P 500 from Yahoo Finance (^GSPC)", "comp": "FRED (WALCL, WRESBAL, WDTGAL, RRPONTSYD)", "fund": "FRED (SOFR, EFFR, IORB)", "scarcity": "FRED (WRESBAL reserves, GDP nominal GDP, TLAACBW027SBOG commercial bank assets); ratios calculated", "gcb": "FRED (WALCL Fed, ECBASSETSW ECB, JPNASSETS BoJ; FX DEXUSEU, DEXJPUS); USD conversion calculated", "nfci": "Chicago Fed via FRED (NFCI)", "quad": "Dashboard calculation from FRED (CFNAI, INDPRO, PAYEMS, RRSFS, ICSA, CPIAUCSL, CPILFESL, PCEPILFE)", "comp_gi": "Dashboard calculation from FRED (CFNAI, INDPRO, PAYEMS, RRSFS, ICSA, CPIAUCSL, CPILFESL, PCEPILFE); recession shading NBER (USREC)", "regtable": "Regimes: dashboard calculation from FRED; returns: Yahoo Finance prices (ETFs adjusted for dividends)", "zg": "FRED (CFNAI, INDPRO, PAYEMS, RRSFS, ICSA); z-scores calculated; recession shading NBER (USREC)", "zi": "FRED (CPIAUCSL, CPILFESL, PCEPILFE); z-scores calculated; recession shading NBER (USREC)", "sahm": "FRED (SAHMREALTIME); recession shading NBER (USREC)", "recprob": "Yield-curve model: NY Fed method applied to FRED T10Y3M; Chauvet-Piger: FRED (RECPROUSM156N)", "infl": "BLS via FRED (CPIAUCSL, CPILFESL); BEA via FRED (PCEPILFE); YoY calculated", "claims": "US Department of Labor via FRED (ICSA)", "points": "Calculated from the data on this dashboard (Yahoo Finance, FRED, US Treasury, MOF Japan, ECB, SingStat)", "moved": "Yahoo Finance (prices, FX, VIX/MOVE); FRED, US Treasury, MOF Japan, ECB (yields, spreads); σ calculated", "fragile": "Yahoo Finance (^VIX, ^MOVE); FRED (BAA10Y, BAMLH0A0HYM2, NFCI, STLFSI4, SOFR, IORB); percentiles calculated", "where": "Yahoo Finance (indices, FX, commodities, crypto, VIX/MOVE); FRED / US Treasury / MOF Japan / ECB (yields); FRED (credit spreads); hover a row for its exact source", "xcurve": "US Treasury (Daily Par Yield Curve); Ministry of Finance Japan (JGB interest rates); ECB Data Portal (YC, AAA euro area government spot curve)", "teny": "US Treasury (Daily Par Yield Curve, 10Y); MOF Japan (JGB 10Y); ECB Data Portal (YC SR_10Y)", "slopes": "US Treasury / MOF Japan / ECB Data Portal curves; spreads calculated; recession shading NBER (USREC)", "real": "US Treasury (Daily Par Real Yield Curve and Par Yield Curve); breakeven calculated", "diff": "US Treasury, MOF Japan, ECB Data Portal (10Y yields); Yahoo Finance (JPY=X, EURUSD=X)", "hedged": "US Treasury (3M, 10Y), MOF Japan (1Y, 10Y), ECB Data Portal (3M, 10Y); hedged yields calculated", "shifts": "Yahoo Finance and FRED / US Treasury / MOF Japan / ECB series; correlations calculated"};
function applyPairToggles() { for (const k of ['ism_ip', 'ism_sv', 'bc_cn', 'bc_mkt', 'bc_my', 'bc_ea', 'netliq', 'diff', 'sneer', 'cn_spread', 'lei', 'leadlag', 'cugold', 'cycdef', 'vol_ratio', 'pos_hist']) if (cards[k]) pairToggle(cards[k]); }
function applySources() { for (const [k, v] of Object.entries(CARD_SOURCES)) if (cards[k]) setSource(cards[k], v); }
function renderOverview() {
  overviewKpis();
  ['points', 'changes', 'headlines', 'moved', 'fragile', 'where', 'cal_next'].forEach(k => cards[k].render());
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
  simple('GDPNOW', 'GDPNow (Atlanta Fed)', v => sign(v) + fmtNum(Math.abs(v), 1) + '%', v => v < 0 ? '⚠ contraction estimate' : v < 1 ? 'below-trend growth' : v > 3 ? 'above-trend growth' : 'around trend', );
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
// ------------------------------------------------------------------ CHIP CYCLE (AI → Chip cycle)
const CHIP_MY = ['0166.KL', '0097.KL', '3867.KL'];   // Inari, ViTrox, MPI
function monthlyOf(id, mode) { const m = llSeries(id, mode), t = [...m.keys()].sort((a, b) => a - b); return { t, v: t.map(x => m.get(x)) }; }
function renderChipRS(c) {
  if (!has('SOX', 'SPX')) return setEmpty(c, 'Waiting for data (next daily run).');
  const r = ratioSeries(['SOX'], ['SPX']), x = pts(S.SOX, state.from - 400 * DAY, state.to), yoy = [];
  for (const [t, v] of x) { const a = asOf(S.SOX, t - 365 * DAY); if (a && t >= state.from && t - 365 * DAY - a.t < 7 * DAY) yoy.push([t, (v / a.v - 1) * 100]); }
  const rp = pts(r, state.from, state.to), r0 = rp.length ? rp[0][1] : 1;
  drawPair(c, { name: 'SOX ÷ S&P 500 (=100)', data: rp.map(([t, v]) => [t, v / r0 * 100]) }, { name: 'SOX, % YoY', data: yoy },
    { fmtA: v => fmtNum(v, 1), fmtB: v => sign(v) + fmtNum(Math.abs(v), 1) + '%', axisA: v => fmtNum(v, 0), axisB: v => fmtNum(v, 0) + '%', zeroB: true });
  const a = rp.length ? rp[rp.length - 1][1] / r0 * 100 - 100 : null;
  setNote(c, `Rising line = chips beating the S&P 500. ${a != null ? `Over this range semis ${a >= 0 ? 'beat' : 'lagged'} the index by ${fmtNum(Math.abs(a), 1)}%. ` : ''}SOX year-on-year growth is the cycle gauge used against trade data on the right.`);
  setSource(c, 'Yahoo Finance (^SOX, ^GSPC); calculated');
}
function renderChipKr(c) {
  if (!has('SOX', 'KR_EXP_YOY')) return setEmpty(c, 'Waiting for data.');
  const k = +state.chipLead || 0, sx = monthlyOf('SOX', 'yoy'), kr = monthlyOf('KR_EXP_YOY', 'level');
  const lead = k ? { t: sx.t.map(t => addMonths(t, k)), v: sx.v } : sx, xmax = k ? addMonths(state.to, k) : state.to;
  drawPair(c, { name: k ? `SOX % YoY, moved forward ${k} months` : 'SOX % YoY (month-end)', data: pts(lead, state.from, xmax) }, { name: 'Korea exports % YoY', data: pts(kr, state.from, state.to) },
    { fmtA: v => sign(v) + fmtNum(Math.abs(v), 1) + '%', fmtB: v => sign(v) + fmtNum(Math.abs(v), 1) + '%', axisA: v => fmtNum(v, 0) + '%', axisB: v => fmtNum(v, 0) + '%', zeroA: true, zeroB: true });
  if (k) c.inst.setOption({ xAxis: c.pairMode === 'stack' ? [{ max: xmax }, { max: xmax }] : { max: xmax } });
  const cc = laggedCorr(sx, kr).filter(x => x[1] != null), best = cc.reduce((m, x) => x[1] > m[1] ? x : m, [0, -2]), c0 = cc.find(x => x[0] === 0);
  setNote(c, (k ? `SOX growth is drawn ${k} months later than measured, so its turns line up with exports; the part past today hints at the next ${k} months. ` : '')
    + `Korea's exports are about a fifth chips and report first in Asia each month, so they set the tone for Taiwan, Malaysia and Singapore. Full-history correlation: ${c0 ? fmtNum(c0[1], 2) : '–'} same month, best ${best[1] > -2 ? `${fmtNum(best[1], 2)} with SOX leading ${best[0]} month${best[0] === 1 ? '' : 's'}` : '–'}.`);
  setSource(c, 'Yahoo Finance (^SOX); Korea exports from OECD (MEI); calculated');
}
function renderChipMy(c) {
  if (!TICK) return setEmpty(c, 'Loading ticker prices…');
  if (!S.MY_TECH || !has('SOX')) return setEmpty(c, 'Malaysian tech tickers not available.');
  const from = Math.max(state.from, S.MY_TECH.t[0]), list = [];
  const reb = (s, name) => { const p = pts(s, from, state.to), b = p.length ? p[0][1] : null; if (b) list.push({ name, data: p.map(([t, v]) => [t, v / b * 100]) }); };
  reb(inCcy('MY_TECH', 'USD'), 'Malaysia tech basket (in USD)'); reb(S.SOX, 'SOX'); if (has('KLCI')) reb(inCcy('KLCI', 'USD'), 'KLCI (in USD)');
  for (const sym of CHIP_MY) { const id = TICK_SYM[sym]; if (id) reb(inCcy(id, 'USD'), S[id].short.replace(/ (Corporation|Amertron|Berhad|Bhd)\b/g, '')); }
  list.slice(3).forEach(x => x.extra = { lineStyle: { width: 1, type: 'dotted' } });
  drawLines(c, list, { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0), endLabels: false });
  const r = corrW(inCcy('MY_TECH', 'USD'), S.SOX, from, state.to);
  setNote(c, `All = 100 at ${nice(from)}, in US dollars. Basket = equal weight Inari, ViTrox and MPI (dotted lines): Malaysian test, automation and back-end suppliers to the global chip makers.${r != null ? ` Correlation of weekly changes with the SOX over this range: ${fmtNum(r, 2)}.` : ''} Ticker history covers about 3 years.`);
  setSource(c, 'Yahoo Finance (Bursa Malaysia, ^SOX, ^KLSE), converted at daily USD/MYR; calculated');
}
function buildChip() {
  const g = $('#aiGrid');
  makeCard(g, { key: 'chip_rs', title: 'Semiconductors vs the market', defaultRange: '5Y', render: renderChipRS });
  makeCard(g, { key: 'chip_kr', title: 'Chip stocks vs Korea exports', defaultRange: '10Y', seg: { key: 'chipLead', options: [['0', 'As measured'], ['2', 'Lead +2m']] }, render: renderChipKr });
  makeCard(g, { key: 'chip_my', title: 'Malaysian tech vs the global chip cycle', wide: true, defaultRange: '3Y', render: renderChipMy });
}
state.chipLead = '0';
// ------------------------------------------------------------------ US ISM (Regime & Leading → US ISM)
// The ISM manufacturing PMI, from the OECD's "national indicator" for the US on FRED (BSCICP02USM460S): ISM's own
// survey expressed as a balance (% better − % worse), so PMI = 50 + balance / 2. Matches ISM's published PMI to within
// a few tenths (seasonal-factor revisions). ISM services has no free history.
state.ismLeadIp = '0'; state.ismLeadSv = '0';
const ISM_SRC = 'ISM manufacturing survey via OECD / FRED (BSCICP02USM460S; PMI = 50 + balance / 2)';
function ismPrep() {
  if (S.ISM_PMI || !has('ISM_BAL')) return;
  const b = S.ISM_BAL;
  S.ISM_PMI = { ...b, id: 'ISM_PMI', label: 'ISM manufacturing PMI', unit: 'idx', group: 'Macro · Business cycle', source: ISM_SRC, t: b.t.slice(), v: b.v.map(x => 50 + x / 2) };
}
function ismState(t = state.to) {
  const a = has('ISM_PMI') ? asOf(S.ISM_PMI, t) : null; if (!a) return null;
  const b = asOf(S.ISM_PMI, addMonths(a.t, -3)), ch = b ? a.v - b.v : null;
  return { a, ch, lab: (a.v >= 50 ? 'Above 50' : 'Below 50') + (ch == null ? '' : ch > 0 ? ', rising' : ', falling') };
}
function renderIsmMain(c) {
  ismPrep(); if (!has('ISM_PMI')) return setEmpty(c, NO_FRED);
  drawLines(c, [{ name: 'ISM manufacturing PMI', data: pts(S.ISM_PMI, state.from, state.to) }],
    { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0), hlines: [{ y: 50, label: '50 = no change' }], areas: recessionAreas(state.from, state.to), endLabels: false });
  const st = ismState();
  setNote(c, `${st ? `Latest ${fmtNum(st.a.v, 1)} (${monthLab(st.a.t)}): ${st.lab.toLowerCase()}${st.ch != null ? ` (${sign(st.ch)}${fmtNum(Math.abs(st.ch), 1)} over 3 months)` : ''}. ` : ''}Purchasing managers’ survey: above 50 = manufacturing expanding. Rebuilt from the OECD’s copy of the ISM survey, so it can differ from ISM’s headline by a few tenths. ISM services has no free history; services are covered here through payrolls.`);
  setSource(c, ISM_SRC);
}
function renderIsmIp(c) {
  ismPrep(); if (!has('ISM_PMI', 'IPMAN')) return setEmpty(c, NO_FRED);
  const k = +state.ismLeadIp || 0;
  const r = leadPair(c, ['ISM_PMI', 'level', 'ISM manufacturing PMI'], ['IPMAN', 'yoy', 'Manufacturing output, % YoY'], k,
    { fmtA: v => fmtNum(v, 1), fmtB: pctF, axisA: v => fmtNum(v, 0), axisB: v => fmtNum(v, 0) + '%', zeroB: true });
  setNote(c, (k ? `The ISM is drawn ${k} months later than measured, so its turns line up with output; the part past today hints at the next ${k} months. ` : '')
    + `The survey asks about orders and production now, so it shows up in factory output a little later. Correlation: ${r.c0 == null ? '–' : corrF(r.c0)} same month; best ${corrF(r.best[1])} with the ISM leading ${r.best[0]} month${r.best[0] === 1 ? '' : 's'}.`);
  setSource(c, ISM_SRC + '; Federal Reserve industrial production via FRED (IPMAN)');
}
function renderIsmSv(c) {
  ismPrep(); if (!has('ISM_PMI', 'SRVPRD')) return setEmpty(c, NO_FRED);
  const k = +state.ismLeadSv || 0;
  const r = leadPair(c, ['ISM_PMI', 'level', 'ISM manufacturing PMI'], ['SRVPRD', 'yoy', 'Services payrolls, % YoY'], k,
    { fmtA: v => fmtNum(v, 1), fmtB: pctF, axisA: v => fmtNum(v, 0), axisB: v => fmtNum(v, 1) + '%', zeroB: true });
  setNote(c, (k ? `The ISM is drawn ${k} months later than measured. ` : '') + `Services are ~85% of US jobs and turn later than factories. Correlation: ${r.c0 == null ? '–' : corrF(r.c0)} same month; best ${corrF(r.best[1])} with the ISM leading ${r.best[0]} month${r.best[0] === 1 ? '' : 's'}. A long, loose lead: useful for direction, not timing.`);
  setSource(c, ISM_SRC + '; BLS payrolls via FRED (SRVPRD)');
}
function renderIsmRule(c) {   // the classic rule, tested live: ISM level x direction -> S&P 500 over the next 12 months
  ismPrep(); const b = htmlBody(c);
  const sp = has('LH_SPX') ? S.LH_SPX : null;
  if (!has('ISM_PMI') || !sp) { b.append(el('div', { class: 'empty', text: NO_FRED })); return; }
  const I = monthlyOf('ISM_PMI', 'level'), L = monthlyOf('LH_SPX', 'level'), P = new Map(L.t.map((t, i) => [t, L.v[i]]));
  const g = {}, start = Date.UTC(1990, 0, 1);
  for (let i = 3; i < I.t.length; i++) { const t = I.t[i]; if (t < start) continue;
    const p0 = P.get(t), p1 = P.get(addMonths(t, 12)); if (p0 == null || p1 == null) continue;
    const key = (I.v[i] >= 50 ? 'Above 50' : 'Below 50') + (I.v[i] - I.v[i - 3] > 0 ? ', rising' : ', falling');
    (g[key] = g[key] || []).push((p1 / p0 - 1) * 100); }
  const all = Object.values(g).flat(), st = ismState(state.latest);
  const heads = ['ISM state', 'Months', 'S&P next 12m, avg', 'Share up'];
  const tbl = el('table', { class: 'perf watch' });
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i === 0 ? 'l' : '' })))));
  const tb = el('tbody'), avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  for (const k of ['Below 50, rising', 'Above 50, rising', 'Above 50, falling', 'Below 50, falling']) { const a = g[k]; if (!a) continue;
    tb.append(el('tr', { class: 'row' + (st && st.lab === k ? ' sel' : '') }, el('td', { class: 'l', text: k + (st && st.lab === k ? '  ← now' : '') }), el('td', { text: a.length }),
      el('td', { text: pctF(avg(a)) }), el('td', { text: fmtNum(a.filter(x => x > 0).length / a.length * 100, 0) + '%' }))); }
  tb.append(el('tr', { class: 'row' }, el('td', { class: 'l muted', text: 'All months' }), el('td', { class: 'muted', text: all.length }), el('td', { class: 'muted', text: pctF(avg(all)) }), el('td', { class: 'muted', text: fmtNum(all.filter(x => x > 0).length / all.length * 100, 0) + '%' })));
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = [heads, ...Object.entries(g).map(([k, a]) => [k, a.length, avg(a).toFixed(2), (a.filter(x => x > 0).length / a.length * 100).toFixed(0)])];
  setNote(c, 'S&P 500 price return over the 12 months after each month since 1990, grouped by where the ISM stood (level vs 50, direction over 3 months). The popular “below 50 and rising” buy signal has done no better than average; weak, still-falling readings were often already priced in.');
  setSource(c, ISM_SRC + '; S&P 500 monthly (Yahoo Finance); calculated');
}
function renderBcCn(c) {
  if (!has('BCI_CHN', 'BCI_USA')) return setEmpty(c, 'Waiting for data.');
  const k = +state.bcLeadCn || 0;
  const r = leadPair(c, ['BCI_CHN', 'level', 'China business confidence'], ['BCI_USA', 'level', 'US business confidence'], k,
    { fmtA: v => fmtNum(v, 1), fmtB: v => fmtNum(v, 1), axisA: v => fmtNum(v, 1), axisB: v => fmtNum(v, 1) });
  setNote(c, (k ? `China is drawn ${k} months later than measured. ` : '') + `China’s factory cycle has tended to turn slightly before the US one (supply chains and credit impulses). Correlation since 2000: ${r.c0 == null ? '–' : corrF(r.c0)} same month; best ${corrF(r.best[1])} with China leading ${r.best[0]} month${r.best[0] === 1 ? '' : 's'}.`);
  setSource(c, BC_SRC);
}
state.bcLeadCn = '0';
function ismKpis() {
  ismPrep(); const out = [], st = ismState();
  if (st) out.push(['ISM manufacturing', fmtNum(st.a.v, 1), st.lab.toLowerCase() + (st.ch != null ? ` (3m ${sign(st.ch)}${fmtNum(Math.abs(st.ch), 1)})` : ''), monthLab(st.a.t) + ' · 50 = no change']);
  for (const [id, nm] of [['IPMAN', 'Manufacturing output'], ['SRVPRD', 'Services payrolls']]) if (has(id)) { const a = asOf(S[id], state.to), b = asOf(S[id], addMonths(a.t, -12));
    if (b) out.push([nm + ', YoY', pctF((a.v / b.v - 1) * 100), id === 'IPMAN' ? 'industrial production, manufacturing' : 'jobs in service-providing industries', monthLab(a.t)]); }
  return out;
}

// ------------------------------------------------------------------ GLOBAL BUSINESS CYCLE (Regime & Leading → Global business cycle)
// OECD business confidence (manufacturing; 100 = long-run average). The US series is built from the ISM manufacturing survey.
const BC_AREAS = [['BCI_USA', 'US (ISM-based)'], ['BCI_EA20', 'Euro area'], ['BCI_DEU', 'Germany'], ['BCI_JPN', 'Japan'], ['BCI_CHN', 'China'], ['BCI_KOR', 'Korea'], ['BCI_G7', 'G7']];
const BC_SRC = 'OECD business confidence, manufacturing (amplitude adjusted; US series based on the ISM manufacturing survey)';
state.bcLeadMy = '0'; state.bcLeadEa = '0'; state.bcMkt = 'spx';
function bcState(id, t = state.to) {
  const a = has(id) ? asOf(S[id], t) : null; if (!a) return null;
  const b = asOf(S[id], addMonths(a.t, -3)), ch = b ? a.v - b.v : null;
  const lab = (a.v >= 100 ? 'Above average' : 'Below average') + (ch == null ? '' : ch > 0.05 ? ', improving' : ch < -0.05 ? ', worsening' : ', flat');
  const short = (a.v >= 100 ? 'Above' : 'Below') + (ch == null ? '' : ch > 0.05 ? ' · rising' : ch < -0.05 ? ' · falling' : ' · flat');
  const tk = a.v >= 100 ? (ch >= 0 ? '--good' : '--warning') : (ch > 0 ? '--warning' : '--critical');
  return { a, ch, lab, short, tk };
}
function renderBcAll(c) {
  const ids = BC_AREAS.filter(([id]) => has(id)); if (!ids.length) return setEmpty(c, 'Waiting for the OECD business confidence data (next daily run).');
  drawLines(c, ids.map(([id, nm], i) => ({ name: nm, data: pts(S[id], state.from, state.to), color: col(i), extra: id === 'BCI_G7' ? { lineStyle: { width: 1.5, type: 'dashed' } } : (id === 'BCI_USA' ? { lineStyle: { width: 2.6 } } : {}) })),
    { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 1), hlines: [{ y: 100, label: 'long-run average' }], endLabels: false, areas: recessionAreas(state.from, state.to) });
  setNote(c, 'Manufacturing business confidence by economy, on one scale: 100 = each economy’s long-run average, so readings compare across regions. The US line comes from the ISM manufacturing survey (100 is roughly an ISM of 50). Japan reports a month later than the others.');
  setSource(c, BC_SRC);
}
function renderBcTable(c) {
  const b = htmlBody(c), rows = BC_AREAS.map(([id, nm]) => ({ id, nm, st: bcState(id) })).filter(r => r.st);
  if (!rows.length) { b.append(el('div', { class: 'empty', text: 'Waiting for data.' })); return; }
  const heads = ['Economy', 'Latest', 'vs avg', '3m chg', 'Month', 'State'];
  const tbl = el('table', { class: 'perf watch' });
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i === 0 || i === 5 ? 'l' : '' })))));
  const tb = el('tbody');
  for (const r of rows) { const { a, ch, short, tk } = r.st;
    tb.append(el('tr', { class: 'row' }, el('td', { class: 'l', text: r.nm }), el('td', { text: fmtNum(a.v, 1) }), el('td', { text: sign(a.v - 100) + fmtNum(Math.abs(a.v - 100), 1) }),
      el('td', { text: ch == null ? '–' : sign(ch) + fmtNum(Math.abs(ch), 2) }), el('td', { class: 'muted', text: monthLab(a.t).replace(/ 20(\d\d)$/, ' $1') }),
      el('td', { class: 'l' }, el('span', { class: 'chip', style: `--st:${tok(tk)}` }, short)))); }
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = [heads, ...rows.map(r => [r.nm, r.st.a.v, (r.st.a.v - 100).toFixed(2), r.st.ch == null ? '' : r.st.ch.toFixed(2), iso(r.st.a.t), r.st.lab])];
  const up = rows.filter(r => r.st.ch > 0.05).length;
  setNote(c, `${rows.filter(r => r.st.a.v >= 100).length} of ${rows.length} above their long-run average; ${up} improving over 3 months. Green = above average and improving; amber = mixed; red = below average and worsening.`);
  setSource(c, BC_SRC);
}
function leadPair(c, a, b, k, o) {   // monthly dual-axis chart; series a drawn k months later than measured
  const A = monthlyOf(a[0], a[1]), B = monthlyOf(b[0], b[1]);
  const lead = k ? { t: A.t.map(t => addMonths(t, k)), v: A.v } : A, xmax = k ? addMonths(state.to, k) : state.to;
  drawPair(c, { name: k ? `${a[2]}, moved forward ${k} months` : a[2], data: pts(lead, state.from, xmax) }, { name: b[2], data: pts(B, state.from, state.to) }, o);
  if (k) c.inst.setOption({ xAxis: c.pairMode === 'stack' ? [{ max: xmax }, { max: xmax }] : { max: xmax } });
  const cc = laggedCorr(A, B).filter(x => x[1] != null), best = cc.reduce((m, x) => x[1] > m[1] ? x : m, [0, -2]), c0 = cc.find(x => x[0] === 0);
  const rev = laggedCorr(B, A).filter(x => x[1] != null), bestR = rev.reduce((m, x) => x[1] > m[1] ? x : m, [0, -2]);
  return { c0: c0 ? c0[1] : null, best, bestR };
}
const pctF = v => sign(v) + fmtNum(Math.abs(v), 1) + '%', corrF = v => (v >= 0 ? '+' : '−') + fmtNum(Math.abs(v), 2);
function renderBcMy(c) {
  if (!has('BCI_USA', 'MY_EXPORTS_YOY')) return setEmpty(c, 'Waiting for data.');
  const k = +state.bcLeadMy || 0;
  const r = leadPair(c, ['BCI_USA', 'level', 'US business confidence'], ['MY_EXPORTS_YOY', 'level', 'Malaysia exports, % YoY'], k,
    { fmtA: v => fmtNum(v, 1), fmtB: pctF, axisA: v => fmtNum(v, 1), axisB: v => fmtNum(v, 0) + '%', zeroB: true });
  setNote(c, (k ? `US confidence is drawn ${k} months later than measured, so its turns line up with Malaysian exports; the part past today hints at the next ${k} months. ` : '')
    + `US manufacturers’ orders feed Asian supply chains, so US confidence has tended to turn before Malaysia’s exports. Correlation since 2000: ${r.c0 == null ? '–' : corrF(r.c0)} same month; best ${corrF(r.best[1])} with US confidence leading ${r.best[0]} month${r.best[0] === 1 ? '' : 's'}.`);
  setSource(c, BC_SRC + '; DOSM via OpenDOSM (exports)');
}
function renderBcEa(c) {
  if (!has('BCI_USA', 'BCI_EA20')) return setEmpty(c, 'Waiting for data.');
  const k = +state.bcLeadEa || 0;
  const r = leadPair(c, ['BCI_USA', 'level', 'US business confidence'], ['BCI_EA20', 'level', 'Euro area business confidence'], k,
    { fmtA: v => fmtNum(v, 1), fmtB: v => fmtNum(v, 1), axisA: v => fmtNum(v, 1), axisB: v => fmtNum(v, 1) });
  setNote(c, (k ? `US confidence is drawn ${k} months later than measured. ` : '') + `The US manufacturing cycle has tended to turn before Europe’s. Correlation since 2000: ${r.c0 == null ? '–' : corrF(r.c0)} same month; best ${corrF(r.best[1])} with the US leading ${r.best[0]} month${r.best[0] === 1 ? '' : 's'}.`);
  setSource(c, BC_SRC);
}
function renderBcMkt(c) {
  const opt = { spx: ['LH_SPX', 'S&P 500, % YoY'], copper: ['COPPER', 'Copper, % YoY'], klci: ['KLCI', 'KLCI, % YoY'] }[state.bcMkt] || ['LH_SPX', 'S&P 500, % YoY'];
  const id = has(opt[0]) ? opt[0] : (opt[0] === 'LH_SPX' && has('SPX') ? 'SPX' : null);
  if (!id || (!has('BCI_USA') && !has('ISM_BAL'))) return setEmpty(c, 'Waiting for data.');
  ismPrep(); const src = has('ISM_PMI') ? ['ISM_PMI', 'level', 'ISM manufacturing PMI'] : ['BCI_USA', 'level', 'US business confidence (ISM-based)'];
  const r = leadPair(c, src, [id, 'yoy', opt[1]], 0,
    { fmtA: v => fmtNum(v, 1), fmtB: pctF, axisA: v => fmtNum(v, src[0] === 'ISM_PMI' ? 0 : 1), axisB: v => fmtNum(v, 0) + '%', zeroB: true });
  const mLead = r.bestR[0], bLead = r.best[0];
  const who = r.bestR[1] > r.best[1] && mLead > 0 ? `the market leads by about ${mLead} month${mLead === 1 ? '' : 's'}` : bLead > 0 ? `confidence leads by about ${bLead} month${bLead === 1 ? '' : 's'}` : 'they move together';
  setNote(c, `Correlation: ${r.c0 == null ? '–' : corrF(r.c0)} same month; ${who}. The ISM confirms the market’s trend rather than predicting it: in a test back to 1990 it had no useful link with the S&P 500’s next 3–12 months, and readings that are low but rising did no better than average.`);
  setSource(c, (src[0] === 'ISM_PMI' ? ISM_SRC : BC_SRC) + '; Yahoo Finance');
}
function bcKpis() {   // tiles for the Global business cycle sub-tab
  const out = [];
  for (const [id, nm] of [['BCI_USA', 'US business confidence'], ['BCI_EA20', 'Euro area confidence'], ['BCI_CHN', 'China confidence'], ['BCI_G7', 'G7 confidence']]) {
    const st = bcState(id); if (st) out.push([nm, fmtNum(st.a.v, 1), st.lab.toLowerCase() + (st.ch != null ? ` (3m ${sign(st.ch)}${fmtNum(Math.abs(st.ch), 2)})` : ''), monthLab(st.a.t) + ' · 100 = average']); }
  return out;
}

function renderLeadLag(c) {
  if (!has('LEI_6M', 'REG_GM')) return setEmpty(c, 'Waiting for the leading-index inputs (next daily run).');
  const k = +state.llShift || 0, L = S.LEI_6M, lead = k ? { t: L.t.map(t => addMonths(t, k)), v: L.v } : L, xmax = k ? addMonths(state.to, k) : state.to;
  drawPair(c, { name: k ? `Leading index, moved forward ${k} months` : 'Leading index, 6m annualised', data: pts(lead, state.from, xmax) }, { name: 'Growth momentum (regime model)', data: pts(S.REG_GM, state.from, state.to) },
    { fmtA: v => sign(v) + fmtNum(Math.abs(v), 1) + '%', fmtB: v => zf(v), axisA: v => fmtNum(v, 0) + '%', axisB: v => v.toFixed(1), zeroA: true, zeroB: true });
  if (k) c.inst.setOption({ xAxis: c.pairMode === 'stack' ? [{ max: xmax }, { max: xmax }] : { max: xmax } });
  const cc = laggedCorr(S.LEI_6M, S.REG_GM).filter(x => x[1] != null), best = cc.reduce((m, x) => x[1] > m[1] ? x : m, [0, -2]);
  setNote(c, (k ? `The leading index is drawn ${k} months later than measured, so its turns line up with growth; the stretch past today is its hint for the next ${k} months. ` : '') + `Does the leading index turn before the regime's growth signal? Correlation of the leading index with growth momentum k months later: ${cc.filter(x => [0, 3, 6, 9, 12].includes(x[0])).map(x => `${x[0]}m ${fmtNum(x[1], 2)}`).join(' · ')}. Strongest at ${best[0]} months. Caution: scanning many lags always finds a best one; treat the lead as a tendency, not a forecast.`);
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
  const hist = makeCard(g, { key: 'reghist', title: 'Regime history', wide: true, source: 'FRED, Yahoo Finance',
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
  state.llShift = '0';
  makeCard(g, { key: 'leadlag', title: 'Leading index vs regime growth signal', seg: { key: 'llShift', options: [['0', 'As measured'], ['3', 'Lead +3m']] }, render: renderLeadLag });
  makeCard(g, { key: 'ism_main', title: 'ISM manufacturing PMI', wide: true, defaultRange: '10Y', render: renderIsmMain });
  makeCard(g, { key: 'ism_ip', title: 'ISM → factory output', defaultRange: '10Y', seg: { key: 'ismLeadIp', options: [['0', 'As measured'], ['2', 'Lead +2m']] }, render: renderIsmIp });
  makeCard(g, { key: 'ism_sv', title: 'ISM → services jobs', defaultRange: '10Y', seg: { key: 'ismLeadSv', options: [['0', 'As measured'], ['8', 'Lead +8m']] }, render: renderIsmSv });
  makeCard(g, { key: 'ism_rule', title: 'Does the ISM time the market?', range: false, render: renderIsmRule });
  makeCard(g, { key: 'bc_cn', title: 'China → US', defaultRange: '10Y', seg: { key: 'bcLeadCn', options: [['0', 'As measured'], ['2', 'Lead +2m']] }, render: renderBcCn });
  makeCard(g, { key: 'bc_all', title: 'Business confidence around the world', wide: true, defaultRange: '10Y', render: renderBcAll });
  makeCard(g, { key: 'bc_table', title: 'Where each economy stands', range: false, render: renderBcTable });
  makeCard(g, { key: 'bc_mkt', title: 'ISM vs markets', defaultRange: '10Y', seg: { key: 'bcMkt', options: [['spx', 'S&P 500'], ['copper', 'Copper'], ['klci', 'KLCI']] }, render: renderBcMkt });
  makeCard(g, { key: 'bc_my', title: 'US → Malaysia exports', defaultRange: '10Y', seg: { key: 'bcLeadMy', options: [['0', 'As measured'], ['3', 'Lead +3m']] }, render: renderBcMy });
  makeCard(g, { key: 'bc_ea', title: 'US → euro area', defaultRange: '10Y', seg: { key: 'bcLeadEa', options: [['0', 'As measured'], ['4', 'Lead +4m']] }, render: renderBcEa });
  for (const k of ['bc_table', 'ism_rule']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
  makeCard(g, { key: 'cli', title: 'OECD leading indicators', wide: true, sub: 'Composite leading indicators for six economies: they tend to turn 6–9 months before activity. 100 = long-term trend.', render: renderCLI });
  makeCard(g, { key: 'cugold', title: 'Copper / gold ratio vs UST 10Y', render: renderCopperGold });
  makeCard(g, { key: 'cycdef', title: 'Cyclicals vs defensives', render: renderCycDef });
  g.append(el('h3', { class: 'section', text: 'Regime inputs and recession watch' }));
  const zcard = (key, title, prefix) => makeCard(g, { key, title, source: 'FRED', sub: 'z-scores against each input’s full history up to that month (capped at ±3). Grey = US recession.',
    render: c => { const ids = Object.keys(S).filter(k => k.startsWith(prefix)); if (!ids.length) return setEmpty(c, NO_FRED);
      drawLines(c, ids.map((id, i) => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(i) })),
        { fmt: zf, axisFmt: v => v.toFixed(1), zero: true, endLabels: false, areas: recessionAreas(state.from, state.to) }); } });
  void zcard;
  state.regSide = 'G';
  const sideSeg = { key: 'regSide', options: [['G', 'Growth'], ['I', 'Inflation']] };
  makeCard(g, { key: 'reg_contrib', title: 'What is driving the regime', wide: true, defaultRange: '5Y', seg: sideSeg, render: renderRegContrib });
  makeCard(g, { key: 'reg_now', range: false, title: 'Latest month: who added what', render: renderRegNow });
  makeCard(g, { key: 'zin', title: 'Input z-scores', defaultRange: '10Y', seg: sideSeg, source: 'FRED',
    render: c => { const side = state.regSide, prefix = side === 'G' ? 'RZG_' : 'RZI_', ids = Object.keys(S).filter(k => k.startsWith(prefix)); if (!ids.length) return setEmpty(c, NO_FRED);
      c.titleEl.textContent = side === 'G' ? 'Growth inputs (z-scores)' : 'Inflation inputs (z-scores)';
      c.subEl.textContent = 'Each input against its full history up to that month (capped at ±3). Grey = US recession.';
      drawLines(c, ids.map((id, i) => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(i) })),
        { fmt: zf, axisFmt: v => v.toFixed(1), zero: true, endLabels: false, areas: recessionAreas(state.from, state.to) }); } });
  // the Growth / Inflation switch is shared by both cards
  for (const key of ['reg_contrib', 'zin']) cards[key].root.querySelectorAll('.card-tools .seg button').forEach(btn => btn.addEventListener('click', () => {
    const other = key === 'reg_contrib' ? 'zin' : 'reg_contrib';
    cards[other].root.querySelectorAll('.card-tools .seg button').forEach(x => x.classList.toggle('on', x.textContent === btn.textContent)); cards[other].render(); }));
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
    seg: { key: 'inflMode', options: [['actual', 'Actual'], ['exp', 'Expectations']] },
    render: c => { const exp = state.inflMode === 'exp' && has('MICH', 'EXPINF1YR') ? ['CPI_YOY', 'MICH', 'EXPINF1YR'] : null;
      const ids = (exp || ['CPI_YOY', 'CORE_CPI_YOY', 'CORE_PCE_YOY', 'CORE_CPI_3M']).filter(x => has(x)); if (!ids.length) return setEmpty(c, NO_FRED);
      drawLines(c, ids.map((id, i) => ({ name: S[id].label, data: pts(S[id], state.from, state.to), color: col(i) })),
        { fmt: v => fmtNum(v, 1) + '%', axisFmt: v => fmtNum(v, 1) + '%', hlines: [{ y: 2, label: '2% target' }] });
      c.subEl.textContent = exp ? 'What households (University of Michigan survey) and markets plus surveys (Cleveland Fed model) expect inflation to be a year ahead, against actual CPI.' : 'Year-on-year %, plus core CPI 3-month annualised for the latest trend.';
      setSource(c, exp ? 'FRED (CPIAUCSL, MICH, EXPINF1YR)' : 'FRED (CPIAUCSL, CPILFESL, PCEPILFE)');
      if (state.inflMode === 'exp' && !exp) setNote(c, 'Expectations series arrive with the next daily run; showing actual inflation.'); else setNote(c, ''); } });
  makeCard(g, { key: 'gdpnow', title: 'GDPNow vs reported GDP', source: 'FRED (GDPNOW, A191RL1Q225SBEA); Atlanta Fed',
    sub: 'Real GDP growth, quarter on quarter annualised, %. GDPNow is the Atlanta Fed’s running model estimate for the quarter, before the official number.',
    render: c => { if (!has('GDPNOW') && !has('RGDP_SAAR')) return setEmpty(c, NO_FRED);
      const L = []; if (has('RGDP_SAAR')) L.push({ name: 'Reported real GDP (BEA)', data: pts(S.RGDP_SAAR, state.from, state.to), color: col(0), extra: { step: 'end' } });
      if (has('GDPNOW')) L.push({ name: 'GDPNow estimate', data: pts(S.GDPNOW, state.from, state.to), color: col(1), extra: { step: 'end', lineStyle: { type: 'dashed', width: 2 } } });
      drawLines(c, L, { fmt: v => sign(v) + fmtNum(Math.abs(v), 1) + '%', axisFmt: v => fmtNum(v, 1) + '%', zero: true, areas: recessionAreas(state.from, state.to) });
      const g = has('GDPNOW') ? asOf(S.GDPNOW, state.to) : null, r = has('RGDP_SAAR') ? asOf(S.RGDP_SAAR, state.to) : null, q = t => `Q${Math.floor(new Date(t).getUTCMonth() / 3) + 1} ${new Date(t).getUTCFullYear()}`;
      setNote(c, [g ? `GDPNow for ${q(g.t)}: ${sign(g.v)}${fmtNum(Math.abs(g.v), 1)}%.` : '', r ? `Last reported (${q(r.t)}): ${sign(r.v)}${fmtNum(Math.abs(r.v), 1)}%.` : ''].join(' ')); } });
  makeCard(g, { key: 'claims', title: 'Initial jobless claims', source: 'FRED (ICSA)', sub: '4-week average, thousands. Weekly, the timeliest labour-market signal.',
    render: c => { if (!has('CLAIMS_4WK')) return setEmpty(c, NO_FRED);
      drawLines(c, [{ name: 'Initial claims, 4-week avg', data: pts(S.CLAIMS_4WK, state.from, state.to) }],
        { fmt: v => fmtNum(v, 0) + 'k', axisFmt: v => fmtNum(v, 0) + 'k', areas: recessionAreas(state.from, state.to) }); } });
}
// ---- contributions to regime momentum: each input's share of the 6-month change in its composite
// composite = average of input z-scores, so input k adds (3m avg z_k now − 3m avg z_k 6 months ago) / number of inputs
function regContrib(side) {
  const prefix = side === 'G' ? 'RZG_' : 'RZI_', mom = side === 'G' ? S.REG_GM : S.REG_IM;
  const ids = Object.keys(S).filter(k => k.startsWith(prefix)); if (!ids.length || !mom) return null;
  const maps = ids.map(id => new Map(S[id].t.map((t, i) => [t, S[id].v[i]])));
  // exact split: the composite each month is the average of the inputs that reported that month,
  // so input k's share of month m is z_k(m) / n(m); momentum = 3m average now − 3m average 6 months earlier
  // (months where too few inputs reported are skipped, exactly as the model does, so offsets count reported months)
  const nOf = t => maps.filter(m => m.has(t)).length, need = Math.max(2, ids.length - 2);
  const months = [...new Set(maps.flatMap(m => [...m.keys()]))].sort((a, b) => a - b).filter(t => nOf(t) >= need);
  const pos = new Map(months.map((t, i) => [t, i]));
  const share = (m, t) => { const v = m.get(t); return v != null ? v / nOf(t) : 0; };
  const out = { t: [], ids, parts: ids.map(() => []), total: [] };
  for (let i = 0; i < mom.t.length; i++) {
    const t = mom.t[i], q = pos.get(t); if (q == null || q < 8) continue;
    out.t.push(t); out.total.push(mom.v[i]);
    maps.forEach((m, k) => { let x = 0; for (let j = 0; j < 3; j++) x += share(m, months[q - j]) - share(m, months[q - 6 - j]); out.parts[k].push(x / 3); });
  }
  return out;
}
const regShort = id => S[id].label.replace(/ \(3m avg\)| \(inverted\)/g, '').replace('Chicago Fed activity index', 'Chicago Fed activity');
function renderRegContrib(c) {
  const side = state.regSide, r = regContrib(side);
  if (!r) return setEmpty(c, NO_FRED);
  c.titleEl.textContent = side === 'G' ? 'What is driving growth momentum' : 'What is driving inflation momentum';
  c.subEl.textContent = `Each bar splits the regime's ${side === 'G' ? 'growth' : 'inflation'} momentum (the 6-month change in the composite) into what each input added. Above zero pushes towards ${side === 'G' ? 'growth ↑' : 'inflation ↑'}; the line is the total.`;
  const keep = r.t.map((t, i) => t >= state.from && t <= state.to ? i : -1).filter(i => i >= 0);
  const o = baseOpt(); o.legend.show = true;
  const names = r.ids.map(regShort).concat([side === 'G' ? 'Growth momentum (total)' : 'Inflation momentum (total)']);
  o.grid.top = 12 + 22 * legendRows(c, names);
  o.xAxis = timeAxis(); o.yAxis = valAxis(v => v.toFixed(1));
  o.tooltip.formatter = tipFormatter(v => zf(v));
  o.series = r.ids.map((id, k) => ({ name: regShort(id), type: 'bar', stack: 'c', barMaxWidth: 14, itemStyle: { color: col(k) }, emphasis: { disabled: true },
    data: keep.map(i => [r.t[i], +r.parts[k][i].toFixed(3)]) }));
  o.series.push(line(names[names.length - 1], keep.map(i => [r.t[i], r.total[i]]), tok('--ink'), { z: 5, lineStyle: { width: 2, color: tok('--ink') } }));
  o.series[0].markLine = zeroLine();
  setZoomable(c, o);
  c.csv = [['Month', ...names], ...keep.map(i => [iso(r.t[i]), ...r.parts.map(p => p[i].toFixed(3)), r.total[i].toFixed(3)])];
  const i = r.t.length - 1, top = r.ids.map((id, k) => [regShort(id), r.parts[k][i]]).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))[0];
  setNote(c, `Latest (${monthLab(r.t[i])} data): ${side === 'G' ? 'growth' : 'inflation'} momentum ${zf(r.total[i])}; the biggest single push came from ${top[0]} (${zf(top[1])}). The bars add up to the total line.`);
  setSource(c, 'Dashboard calculation from FRED (CFNAI, INDPRO, PAYEMS, RRSFS, ICSA, CPIAUCSL, CPILFESL, PCEPILFE)');
}
function renderRegNow(c) {
  const g = regContrib('G'), f = regContrib('I');
  if (!g || !f) return setEmpty(c, NO_FRED);
  const rows = [];
  for (const [r, side] of [[g, 'Growth'], [f, 'Inflation']]) { const i = r.t.length - 1;
    r.ids.forEach((id, k) => rows.push({ name: `${side}: ${regShort(id)}`, v: r.parts[k][i], side })); }
  const view = rows.slice().reverse();
  const o = baseOpt(); o.legend.show = false;
  o.grid = { left: 8, right: 54, top: 8, bottom: 8, containLabel: true };
  o.xAxis = { type: 'value', axisLabel: { color: tok('--muted'), fontSize: 11, formatter: v => v.toFixed(2) }, splitLine: { lineStyle: { color: tok('--grid') } } };
  o.yAxis = { type: 'category', data: view.map(r => r.name), axisLabel: { color: tok('--ink-2'), fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false } };
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => `<b>${zf(p.value)}</b> ${esc(view[p.dataIndex].name)}` };
  o.series = [{ type: 'bar', barWidth: '60%', data: view.map(r => ({ value: +r.v.toFixed(3), itemStyle: { color: r.v >= 0 ? tok('--pos') : tok('--neg'), borderRadius: r.v >= 0 ? [0, 3, 3, 0] : [3, 0, 0, 3] } })),
    label: { show: true, position: 'right', fontSize: 11, color: tok('--ink-2'), formatter: p => zf(p.value) } }];
  const ch = inst(c); ch.setOption(o, true);
  const gi = g.t.length - 1, fi = f.t.length - 1;
  c.subEl.textContent = `${monthLab(g.t[gi])} data. Contribution of each input to the 6-month momentum: growth ${zf(g.total[gi])}, inflation ${zf(f.total[fi])}.`;
  c.csv = [['Input', 'Contribution'], ...rows.map(r => [r.name, r.v.toFixed(3)])];
  setNote(c, `Blue pushes the score up, red pulls it down. The regime is ${QUADS[asOf(S.REG_QUAD, state.to).v].name}: growth momentum ${g.total[gi] >= 0 ? 'positive' : 'negative'}, inflation momentum ${f.total[fi] >= 0 ? 'positive' : 'negative'}.`);
  setSource(c, 'Dashboard calculation from FRED');
}
function bcTiles() {   // business-cycle tiles show only on their sub-tab; the regime tiles everywhere else
  const box = $('#regKpis'), sub = (SUBTABS.regime[state.sub.regime || 0] || [])[0], onBc = sub === 'Global business cycle' || sub === 'US ISM';
  box.querySelectorAll('.kpi').forEach(k => k.hidden = onBc);
  for (const [l, v, d, f] of (sub === 'US ISM' ? ismKpis() : sub === 'Global business cycle' ? bcKpis() : [])) box.append(el('div', { class: 'kpi', hidden: !onBc }, el('div', { class: 'k-label', text: l }), el('div', { class: 'k-value', text: v }), el('div', { class: 'k-delta', text: d }), el('div', { class: 'k-asof', text: f })));
}
function renderRegime() {
  regimeKpis(); bcTiles();
  renderMethodPanel();
  ['quad', 'comp_gi', 'reghist', 'regtable', 'lei', 'leidrv', 'leadlag', 'cli', 'cugold', 'cycdef', 'reg_contrib', 'reg_now', 'zin', 'sahm', 'recprob', 'infl', 'claims', 'gdpnow', 'ism_main', 'ism_ip', 'ism_sv', 'ism_rule', 'bc_all', 'bc_table', 'bc_mkt', 'bc_cn', 'bc_my', 'bc_ea'].forEach(k => cards[k].render());
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
  makeCard(g, { key: 'sghedge', title: 'UST 10Y for an SGD investor', sub: 'Treasuries hedged back into SGD, against SGS 10Y.',
    source: 'US Treasury (3M, 10Y); MAS via SingStat (M700071: compounded SORA 3M, SGS 10Y); hedged yield calculated', render: renderSgHedge });
  makeCard(g, { key: 'sneer', title: 'S$NEER proxy', sub: 'Trade-weighted SGD (dashboard estimate) and its pace of appreciation.',
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
  const [lab, , grp] = SUBTABS.asia[state.sub.asia || 0], sub = grp === 'Malaysia' ? 'Malaysia' : lab, cj = lab === 'China' || lab === 'Japan';
  filterKpis('#asiaKpis', l => ASIA_KPI[sub] ? (ASIA_KPI[sub].includes(l) ? '*' : '') : (ASIA_KPI_MIX.includes(l) ? '*' : ''));
  $('#asiaKpis').hidden = cj; $('#cnjpKpis').hidden = !cj;
  ASIA_CARDS.forEach(k => cards[k].render());
  if (cj) renderCnJp();
}
let NEWS = null;
state.newsCat = 'All'; state.newsQ = '';
// Headlines: a fast lane (the "live-news" branch, refreshed every 10 minutes by .github/workflows/news.yml)
// with the copy published on the site as a fallback; whichever is newer wins.
const REPO_PATH = location.hostname.endsWith('github.io')
  ? `${location.hostname.split('.')[0]}/${location.pathname.split('/').filter(Boolean)[0] || ''}` : 'CL272/strategist-dashboard';
const LIVE_NEWS = `https://raw.githubusercontent.com/${REPO_PATH}/live-news/news.json`;
async function loadNews() {
  const get = async u => { try { const r = await fetch(u, { cache: 'no-store' }); return r.ok ? await r.json() : null; } catch (e) { return null; } };
  const [live, site] = await Promise.all([get(LIVE_NEWS + '?t=' + Date.now()), get('data/news.json?t=' + Date.now())]);
  const best = [live, site].filter(x => x && x.items).sort((a, b) => (b.updated_utc || '').localeCompare(a.updated_utc || ''))[0];
  if (best) { const fresh = !NEWS || best.updated_utc !== NEWS.updated_utc; NEWS = best; NEWS.via = best === live ? 'live' : 'site'; state.newsFresh = fresh; }
  state.newsChecked = Date.now();
}
const newsAge = () => { if (!NEWS || !NEWS.updated_utc) return ''; const t = Date.parse(NEWS.updated_utc.replace(' UTC', 'Z').replace(' ', 'T')); return isNaN(t) ? NEWS.updated_utc : `${timeAgo(t)} (${new Date(t + 8 * 3600e3).toISOString().slice(11, 16)} SGT)`; };
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
  const refresh = el('button', { class: 'ghost', type: 'button', text: '↻ Refresh', onclick: async () => {
    refresh.textContent = 'Checking…'; refresh.disabled = true; await loadNews(); state.newsMsg = Date.now(); renderNews(); } });
  bar.append(seg, q, refresh);
  const ql = state.newsQ.trim().toLowerCase();
  const items = NEWS.items.filter(n => (state.newsCat === 'All' || n.cat === state.newsCat) && (!ql || n.title.toLowerCase().includes(ql) || n.source.toLowerCase().includes(ql)));
  const ok = Object.entries(NEWS.feeds || {}).filter(([, v]) => v.startsWith('ok')).map(([k]) => k);
  const bad = Object.entries(NEWS.feeds || {}).filter(([, v]) => !v.startsWith('ok')).map(([k]) => k);
  box.append(bar,
    el('p', { class: 'muted small', text: (state.newsMsg && Date.now() - state.newsMsg < 60000 ? (state.newsFresh ? '✓ New headlines loaded. ' : '✓ Checked just now: no newer batch yet. ') : '') +
      `Headlines collected ${newsAge()}; new batches arrive about every 10 minutes and the page checks on its own every 10 minutes. ${items.length} of ${NEWS.items.length} shown. Links open the original publisher; paywalls may apply.` }),
    newsList(items, state.newsAll ? 400 : 40),
    items.length > 40 && !state.newsAll ? el('button', { class: 'ghost more-btn', type: 'button', text: `Show ${items.length - 40} more headlines`, onclick: () => { state.newsAll = true; renderNews(); } }) : '',
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
  const g = $('#asiaGrid'), p1 = v => fmtNum(v, 1) + '%', p2 = v => fmtNum(v, 2) + '%', a0 = v => fmtNum(v, 0) + '%';
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
  const lab = SUBTABS.asia[state.sub.asia || 0][0];
  $('#cnjpKpis').querySelectorAll('.kpi').forEach(k => { k.hidden = (lab === 'China') !== k.querySelector('.k-label').textContent.startsWith('China'); });
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
  ['ai_usage', 'ai_share', 'ai_hist', 'ai_frontier', 'ai_cpr', 'ai_bench', 'ai_rev', 'ai_dc', 'ai_chips', 'ai_eq', 'chip_rs', 'chip_kr', 'chip_my'].forEach(k => cards[k].render());
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
  const bad = HEALTH.rows.filter(r => r.state !== 'ok'), good = HEALTH.rows.filter(r => r.state === 'ok');
  for (const [name, list] of [[`Needs attention · ${bad.length}`, bad], [`Up to date · ${good.length}`, good]]) {
    if (!list.length) continue;
    tb.append(el('tr', { class: 'grp' }, el('td', { colspan: 6, text: name })));
    for (const r of list) tb.append(el('tr', { class: 'row' }, el('td', {}, el('span', { class: 'chip', style: `--st:${tok(col_[r.state])}` }, r.state)),
      el('td', { text: `${r.label} (${r.id})` }), el('td', { class: 'muted', text: r.source }), el('td', { text: r.freq }), el('td', { text: r.last }), el('td', { text: r.age_days == null ? '' : String(r.age_days) })));
  }
  tbl.append(tb); box.append(el('div', { class: 'table-wrap' }, tbl));
  foldableGroups(tb, 'health', name => name.startsWith('Up to date'));
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
  sentKpis(tile);
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
// ------------------------------------------------------------------ SENTIMENT (Positioning & Vol → Sentiment)
// Scraped from public pages (CNN, AAII, NAAIM); each gauge shows when it was last read, since any source can break.
let SENT = null;
const FG_BANDS = [[25, 'Extreme fear'], [45, 'Fear'], [55, 'Neutral'], [75, 'Greed'], [101, 'Extreme greed']];
const fgBand = v => FG_BANDS.find(([x]) => v < x)[1];
const AAII_AVG = { bull: 37.5, bear: 31.0 };   // AAII's published long-term averages since 1987
function sentUpd(src) { const m = SENT && SENT.meta && SENT.meta[src]; if (!m) return 'Source not loaded';
  const d = m.fetched_utc ? nice(dayMs(m.fetched_utc.slice(0, 10))) : '–';
  return m.ok ? `Source last read ${d}` : `⚠ Source failed on the last try; last read ${d}`; }
function sentStale(id, days) { const a = has(id) ? asOf(S[id], state.latest) : null; return a && state.latest - a.t > days * DAY; }
function aaiiSpread() { if (!has('AAII_BULL', 'AAII_BEAR')) return null; return combine(S.AAII_BULL, S.AAII_BEAR, (a, b) => a - b, { label: 'AAII bulls − bears', unit: 'pts' }, 3 * DAY); }
function sentRows() {
  const rows = [], at = (id, t) => has(id) ? asOf(S[id], t) : null;
  const add = (name, id, s, fmt, read, src) => { const a = s && asOf(s, state.latest); if (!a) return;
    const w = asOf(s, a.t - 7 * DAY), m = asOf(s, addMonths(a.t, -1));
    rows.push({ name, id, a, w: w && w.t < a.t ? w.v : null, m: m && m.t < a.t ? m.v : null, fmt, read: read(a.v), src }); };
  add('CNN Fear & Greed', 'FG', has('FG') ? S.FG : null, v => fmtNum(v, 0), v => fgBand(v), 'CNN');
  add('Put/call ratio (5-day)', 'FG_PUTCALL', has('FG_PUTCALL') ? S.FG_PUTCALL : null, v => fmtNum(v, 2), v => v > 1 ? 'Heavy hedging' : v < 0.7 ? 'Complacent' : 'Normal', 'CNN');
  const sp = aaiiSpread();
  add('AAII bulls − bears', 'AAII', sp, v => sign(v) + fmtNum(Math.abs(v), 1), v => v <= -20 ? 'Very bearish' : v >= 30 ? 'Euphoric' : v < 0 ? 'Bears ahead' : 'Bulls ahead', 'AAII');
  add('NAAIM exposure', 'NAAIM', has('NAAIM') ? S.NAAIM : null, v => fmtNum(v, 0) + '%', v => v < 40 ? 'Defensive' : v > 90 ? 'Fully invested' : 'Mid-range', 'NAAIM');
  return rows;
}
function sentKpis(tile) {
  for (const r of sentRows()) tile(r.name, r.fmt(r.a.v), r.read + (r.w != null ? ` · a week earlier ${r.fmt(r.w)}` : ''), `Reading of ${nice(r.a.t)}. ${sentUpd(r.src)}`);
}
function renderSentFG(c) {
  if (!has('FG')) return setEmpty(c, 'CNN Fear & Greed not loaded (scraped source; it arrives with the next daily run).');
  const L = [{ name: 'CNN Fear & Greed (0–100)', data: pts(S.FG, state.from, state.to) }];
  drawLines(c, L, { fmt: v => fmtNum(v, 0) + ' · ' + fgBand(v), axisFmt: v => fmtNum(v, 0), yExtra: { min: 0, max: 100, scale: false },
    hlines: [{ y: 25, label: 'extreme fear' }, { y: 75, label: 'extreme greed' }], endLabels: false });
  const a = asOf(S.FG, state.to);
  setNote(c, `Now ${fmtNum(a.v, 0)} (${fgBand(a.v).toLowerCase()}), ${nice(a.t)}. A blend of seven market gauges (momentum, new highs, breadth, put/call, VIX, junk-bond demand, safe-haven demand). Used as a contrarian signal: extreme fear has tended to come near lows. ${sentUpd('CNN')}.`);
  setSource(c, 'CNN Business Fear & Greed (scraped; history about 5 years)');
}
function renderSentAAII(c) {
  if (!has('AAII_BULL', 'AAII_BEAR')) return setEmpty(c, 'AAII survey not loaded (scraped source; it arrives with the next daily run).');
  const sp = aaiiSpread();
  drawLines(c, [{ name: 'Bulls %', data: pts(S.AAII_BULL, state.from, state.to), color: col(0) }, { name: 'Bears %', data: pts(S.AAII_BEAR, state.from, state.to), color: col(1) }],
    { fmt: v => fmtNum(v, 1) + '%', axisFmt: v => fmtNum(v, 0) + '%', hlines: [{ y: AAII_AVG.bull, label: `bull avg ${AAII_AVG.bull}%`, color: col(0) }, { y: AAII_AVG.bear, label: `bear avg ${AAII_AVG.bear}%`, color: col(1) }], endLabels: false });
  const a = asOf(sp, state.to);
  setNote(c, `Weekly poll of individual investors on the next 6 months. Latest (${nice(a.t)}): bulls − bears ${sign(a.v)}${fmtNum(Math.abs(a.v), 1)} pts. Dashed lines = long-term averages. Bears far above average has tended to be a contrarian buy signal. AAII shows only about 6 months online; the dashboard archives each week, so history grows from Jun 2026. ${sentUpd('AAII')}.`);
  setSource(c, 'AAII Sentiment Survey (scraped; archived weekly by this dashboard)');
}
function renderSentNAAIM(c) {
  if (!has('NAAIM')) return setEmpty(c, 'NAAIM index not loaded (scraped source; it arrives with the next daily run).');
  const L = pts(S.NAAIM, state.from, state.to);
  if (has('SPX')) drawPair(c, { name: 'NAAIM exposure (%)', data: L }, { name: 'S&P 500', data: pts(S.SPX, Math.max(state.from, S.NAAIM.t[0]), state.to) },
    { fmtA: v => fmtNum(v, 0) + '%', fmtB: v => fmtNum(v, 0), axisA: v => fmtNum(v, 0) + '%', axisB: v => fmtNum(v, 0) });
  else drawLines(c, [{ name: 'NAAIM exposure (%)', data: L }], { fmt: v => fmtNum(v, 0) + '%' });
  const a = asOf(S.NAAIM, state.latest), old = state.latest - a.t > 21 * DAY;
  setNote(c, `Average equity exposure reported each Wednesday by active managers who are NAAIM members (0 = flat, 100 = fully invested, up to 200 with leverage). Latest ${fmtNum(a.v, 0)}% on ${nice(a.t)}.${old ? ` ⚠ NAAIM has not published a newer reading since ${nice(a.t)}.` : ''} ${sentUpd('NAAIM')}.`);
  setSource(c, 'NAAIM Exposure Index (scraped from naaim.org)');
}
function renderSentTable(c) {
  const b = htmlBody(c), rows = sentRows();
  if (!rows.length) { b.append(el('div', { class: 'empty', text: 'Sentiment gauges not loaded yet.' })); return; }
  const heads = ['Gauge', 'Latest', 'Date', '1W ago', '1M ago', 'Read'];
  const tbl = el('table', { class: 'perf watch' });
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i === 0 || i >= 5 ? 'l' : '' })))));
  const tb = el('tbody');
  for (const r of rows) { const m = SENT && SENT.meta[r.src];
    tb.append(el('tr', { class: 'row', title: sentUpd(r.src) }, el('td', { class: 'l', text: (m && !m.ok ? '⚠ ' : '') + r.name }), el('td', { text: r.fmt(r.a.v) }), el('td', { class: 'muted', text: dShort(r.a.t) }),
      el('td', { text: r.w == null ? '–' : r.fmt(r.w) }), el('td', { text: r.m == null ? '–' : r.fmt(r.m) }), el('td', { class: 'l', text: r.read }))); }
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = [[...heads, 'Source last read'], ...rows.map(r => [r.name, r.a.v, new Date(r.a.t).toISOString().slice(0, 10), r.w ?? '', r.m ?? '', r.read, (SENT && SENT.meta[r.src] || {}).fetched_utc || ''])];
  setNote(c, 'These gauges are read as contrarian signals: crowd fear near lows, crowd greed near highs. They come from web pages with no official data feed, so a source can stop or change. ' + ['CNN', 'AAII', 'NAAIM'].map(x => `${x}: ${sentUpd(x).replace('Source last read', 'last read').replace('⚠ Source failed', '⚠ failed')}`).join('; ') + '. ⚠ = the last attempt failed and the previous readings are kept.');
  setSource(c, 'CNN Business, AAII, NAAIM (scraped daily; archived in the repository)');
}
function buildSentiment() {
  const g = $('#pvGrid');
  makeCard(g, { key: 'sent_fg', title: 'CNN Fear & Greed', defaultRange: '3Y', render: renderSentFG });
  makeCard(g, { key: 'sent_aaii', title: 'AAII survey: bulls vs bears', defaultRange: '1Y', render: renderSentAAII });
  makeCard(g, { key: 'sent_naaim', title: 'NAAIM: active managers’ equity exposure', defaultRange: '3Y', render: renderSentNAAIM });
  makeCard(g, { key: 'sent_table', title: 'Sentiment scorecard', range: false, render: renderSentTable });
  const r = cards.sent_table.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true;
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
function renderPosVol() { posvolKpis(); ['vol_ts', 'vol_x', 'vol_ratio', 'vol_ivrv', 'pos_table', 'pos_ext', 'pos_hist', 'sent_fg', 'sent_aaii', 'sent_naaim', 'sent_table'].forEach(k => cards[k].render());
  filterKpis('#pvKpis', l => /Fear & Greed|Put\/call|AAII|NAAIM/i.test(l) ? 'Sentiment' : /Crowded/.test(l) ? 'Positioning (CFTC)' : 'Volatility'); }

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
  tbl.append(tb);
  const det = el('details', { class: 'fold-box' }, el('summary', { text: `Show the ${SIGN.rows.length} rules, their latest readings and sources` }), el('div', { class: 'table-wrap' }, tbl));
  b.append(det);
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
  'Equities · ASEAN', 'Equities · India', 'Equities · Australia', 'Equities · LatAm', 'Equities · Global', 'Equities · AI', 'Equities · US sectors', 'Equities · US styles',
  'Rates · US', 'Rates · Japan', 'Rates · Euro area', 'Rates · Singapore', 'Rates · Malaysia', 'Rates · China', 'Credit', 'Bonds & credit', 'FX', 'Commodities', 'Crypto', 'Volatility'];
const PERF_FRED = ['UST2Y', 'UST10Y', 'UST30Y', 'REAL10Y', 'BE10Y', 'CURVE_2s10s', 'HY_OAS', 'IG_OAS', 'JGB2Y', 'JGB10Y', 'JGB30Y', 'EA2Y', 'EA10Y', 'EA30Y', 'SORA3M', 'SGS2Y', 'SGS10Y', 'MY_OPR', 'CN_10Y', 'JP_CALL'];
const PERIODS = [['1D', null], ['1W', t => t - 7 * DAY], ['1M', t => addMonths(t, -1)], ['3M', t => addMonths(t, -3)],
  ['YTD', t => Date.UTC(new Date(t).getUTCFullYear() - 1, 11, 31)], ['1Y', t => addMonths(t, -12)], ['Range', () => state.from]];
state.mktCcy = 'local';
const mktSeries = id => state.mktCcy !== 'local' && convertible(id) ? inCcy(id, state.mktCcy) : S[id];
function perfRows() {
  const ids = Object.keys(S).filter(id => S[id].source && S[id].source.startsWith('Yahoo') && S[id].group !== 'Derived' && S[id].group !== 'Tickers').concat(PERF_FRED.filter(id => has(id)));
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
state.perfClass = 'Equities'; state.perfSub = 'Key';
// Markets → Performance: one flat list at a time. Asset-class chips, then a second row of region/sub-group chips
// that opens on a short "Key" list. At most PERF_CAP rows show until "Show all".
const PERF_CAP = 16;
const PERF_KEY = {
  'Equities': ['SPX', 'NDX', 'SX5E', 'UKX', 'NKY', 'CSI300', 'HSI', 'KOSPI', 'TWSE', 'STI', 'KLCI', 'JCI', 'NIFTY', 'AS51', 'IBOV', 'EEM'],
  'Rates & credit': ['UST2Y', 'UST10Y', 'REAL10Y', 'CURVE_2s10s', 'JGB10Y', 'EA10Y', 'CN_10Y', 'SGS10Y', 'SORA3M', 'MY_OPR', 'HY_OAS', 'IG_OAS'],
  'FX': ['DXY', 'EURUSD', 'USDJPY', 'GBPUSD', 'USDCNY', 'USDSGD', 'USDMYR', 'AUDUSD', 'USDKRW', 'USDINR', 'USDIDR', 'USDTHB'],
  'Commodities & crypto': ['GOLD', 'SILVER', 'BRENT', 'WTI', 'NATGAS', 'COPPER', 'IRONORE', 'BDRY', 'BTC', 'ETH'],
};
const EQ_SUB = { 'US': 'US', 'Europe': 'Europe', 'Japan': 'Japan', 'China/HK': 'China/HK', 'N. Asia': 'Asia', 'ASEAN': 'Asia', 'India': 'Asia', 'Australia': 'Asia',
  'LatAm': 'Global & EM', 'Global': 'Global & EM', 'AI': 'AI', 'US sectors': 'Sectors & styles', 'US styles': 'Sectors & styles' };
const perfSub = (g, cls) => cls === 'Equities' ? (EQ_SUB[(g.split(' · ')[1] || '')] || 'Other') : cls === 'Rates & credit' ? (/^Rates · /.test(g) ? g.split(' · ')[1] : 'Credit') : g;
const PERF_OPT_KEY = 'sd-perf-cols-v1';
state.perfExtra = (() => { try { return new Set(JSON.parse(localStorage.getItem(PERF_OPT_KEY) || '[]')); } catch (e) { return new Set(); } })();
function perfCols() { return ['1D', '1W', '1M', '3M', 'YTD', '1Y', 'Range'].filter(k => !['3M', 'Range'].includes(k) || state.perfExtra.has(k)); }
// a cell that colours the number and fills the background only for a big move (beyond `big`)
function moveCell(s, v, big, last) {
  if (v == null) return el('td', { class: 'num', text: '–' });
  const mag = Math.abs(s.kind === 'level' ? v / Math.max(1e-9, Math.abs(last)) * 100 : v);
  const pos = tok('--pos'), neg = tok('--neg'), up = v > 0;
  return el('td', { class: 'num ' + (v === 0 ? '' : up ? 'up' : 'dn'), text: fmtChg(s, v), style: big != null && mag >= big && v !== 0 ? `background:${hexA(up ? pos : neg, 0.14)}` : '' });
}
function bigThresholds(rows, cols) {   // per column and kind: the 80th percentile of the size of moves
  const out = {};
  for (const k of cols) for (const kind of ['price', 'yield', 'level']) {
    const xs = rows.filter(r => r.s.kind === kind && r[k] != null).map(r => Math.abs(kind === 'level' ? r[k] / Math.max(1e-9, Math.abs(r.last)) * 100 : r[k])).sort((a, b) => a - b);
    out[k + kind] = xs.length >= 5 ? xs[Math.floor(xs.length * 0.8)] : Infinity;
  }
  return out;
}
function renderPerfTable() {
  const q = (state.perfQuery || '').trim().toLowerCase(), cls = state.perfClass, all = perfRows();
  const inCls = all.filter(r => cls === 'All' || perfClass(r.s.group) === cls);
  // second-row chips
  const subs = cls === 'All' || cls === 'Volatility' ? [] : [...new Set(inCls.map(r => r.s.group).sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99)).map(g => perfSub(g, cls)))];
  const chips = PERF_KEY[cls] && subs.length ? ['Key', ...(subs.length > 1 ? subs : []), 'All'] : [];
  if (!chips.includes(state.perfSub)) state.perfSub = chips.length ? 'Key' : 'All';
  const sub = state.perfSub;
  let rows;
  if (q) rows = all.filter(r => (r.s.label + ' ' + r.id + ' ' + r.s.group).toLowerCase().includes(q));
  else if (sub === 'Key') rows = PERF_KEY[cls].map(id => inCls.find(r => r.id === id)).filter(Boolean);
  else if (sub === 'All') rows = inCls.slice().sort((a, b) => (GROUP_ORDER.indexOf(a.s.group) + 1 || 99) - (GROUP_ORDER.indexOf(b.s.group) + 1 || 99));
  else rows = inCls.filter(r => perfSub(r.s.group, cls) === sub);
  if (state.perfSort) rows = rows.slice().sort((a, b) => ((a[state.perfSort.k] ?? -1e9) - (b[state.perfSort.k] ?? -1e9)) * -state.perfSort.dir);
  const nav = $('#perfNav'); if (nav) nav.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', b.textContent === cls));
  const subNav = $('#perfSubNav');
  subNav.replaceChildren(...chips.map(k => el('button', { type: 'button', text: k === 'Key' ? 'Key markets' : k, 'aria-selected': String(k === sub && !q),
    onclick: () => { state.perfSub = k; state.perfAll = false; renderPerfTable(); } })));
  subNav.hidden = !chips.length || !!q;
  const cols = perfCols(), big = bigThresholds(inCls, cols);
  const tbl = $('#perfTable'); tbl.replaceChildren();
  const hdr = el('tr', {}, el('th', { text: 'Asset' }), el('th', { text: 'Last' }));
  cols.forEach(k => hdr.append(el('th', { text: k + (state.perfSort && state.perfSort.k === k ? (state.perfSort.dir > 0 ? ' ▲' : ' ▼') : ''), title: 'Click to sort',
    onclick: () => { state.perfSort = state.perfSort && state.perfSort.k === k ? { k, dir: -state.perfSort.dir } : { k, dir: -1 }; renderPerfTable(); } })));
  hdr.append(el('th', { text: '3M trend', class: 'trend' }));
  tbl.append(el('thead', {}, hdr));
  const tb = el('tbody'), show = state.perfAll || rows.length <= PERF_CAP + 2 ? rows : rows.slice(0, PERF_CAP);
  for (const r of show) {
    const on = state.mktSel.includes(r.id);
    const pin = el('button', { type: 'button', class: 'pin' + (on ? ' on' : ''), title: on ? 'Remove from the chart' : 'Add to the chart above', 'aria-pressed': String(on),
      style: on ? `--pc:${col(state.selSlot[r.id])}` : '', onclick: () => { toggleSel(r.id, !on); renderPerfTable(); } }, on ? '●' : '+');
    const tr = el('tr', { class: 'row' + (on ? ' pinned' : ''), title: `${r.s.source} · last ${nice(r.t)}` },
      el('td', { class: 'name' }, el('span', { class: 'name-in' }, pin, el('span', { text: r.s.label }))),
      el('td', { class: 'num', text: r.s.kind === 'yield' ? fmtNum(r.last, 2) + '%' : fmtVal(r.s, r.last) }));
    for (const k of cols) tr.append(moveCell(r.s, r[k], big[k + r.s.kind], r.last));
    tr.append(el('td', { class: 'trend' }, sparkSVG(r.s, addMonths(r.t, -3), r.t) || ''));
    tb.append(tr);
  }
  if (show.length < rows.length) tb.append(el('tr', { class: 'grp' }, el('td', { colspan: cols.length + 3 },
    el('button', { type: 'button', class: 'ghost more-btn', text: `Show all ${rows.length}`, onclick: () => { state.perfAll = true; renderPerfTable(); } }))));
  if (!rows.length) tb.append(el('tr', {}, el('td', { colspan: cols.length + 3, class: 'muted', text: 'No assets match.' })));
  tbl.append(tb);
  $('#perfNote').textContent = `Changes to ${nice(state.to)}${state.perfExtra.has('Range') ? `; “Range” from ${nice(state.from)}` : ''}. ${state.mktCcy === 'local' ? 'Local currency' : `Equities, ETFs, commodities and crypto in ${state.mktCcy}`}; yields and spreads in bp. Shaded cells = the biggest fifth of moves in that column. Press + to chart a row.`;
  $('#perfCsv').onclick = () => downloadCSV([['Asset', 'Group', 'Last', ...cols], ...rows.map(r => [r.s.label, r.s.group, r.last, ...cols.map(k => r[k] == null ? '' : r[k].toFixed(2))])], 'cross-asset-performance');
}
const FOLD_KEY = 'sd-folded-groups';
const folded = (() => { try { return new Set(JSON.parse(localStorage.getItem(FOLD_KEY) || '[]')); } catch (e) { return new Set(); } })();
function saveFolded() { try { localStorage.setItem(FOLD_KEY, JSON.stringify([...folded])); } catch (e) { /* storage blocked: folding still works this session */ } }
const OPEN_KEY = 'sd-opened-groups';
const opened = (() => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]')); } catch (e) { return new Set(); } })();
function saveOpened() { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...opened])); } catch (e) { /* session only */ } }
// table = a name so the same group can be folded separately in two tables;
// foldDefault(name, index) = true folds a group until the viewer opens it
function foldableGroups(tbody, table, foldDefault = null) {
  let head = null, kids = [], gi = 0;
  const wire = (h, rows) => {
    if (!h) return;
    const td = h.firstElementChild, name = td.textContent, key = table + '|' + name.split(' · in ')[0];
    const set = open => { h.classList.toggle('folded', !open); rows.forEach(r => r.hidden = !open); h.setAttribute('aria-expanded', open); };
    td.replaceChildren(el('span', { class: 'chev', 'aria-hidden': 'true' }), el('span', { text: name }), el('span', { class: 'muted small cnt', text: ` ${rows.length}` }));
    h.classList.add('foldable'); h.tabIndex = 0; h.title = 'Click to fold or unfold this group';
    const dflt = foldDefault ? foldDefault(name, gi++) : false;
    const remember = open => { if (open) { folded.delete(key); opened.add(key); } else { folded.add(key); opened.delete(key); } saveFolded(); saveOpened(); };
    const toggle = () => { const open = h.classList.contains('folded'); remember(open); set(open); };
    h.addEventListener('click', toggle); h.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    h.foldTo = open => { remember(open); set(open); };
    set(folded.has(key) ? false : opened.has(key) ? true : !dflt);
  };
  for (const tr of [...tbody.children]) {
    if (tr.classList.contains('grp')) { wire(head, kids); head = tr; kids = []; } else if (head) kids.push(tr);
  }
  wire(head, kids);
}
function foldAll(tbody, open) { tbody.querySelectorAll('tr.foldable').forEach(h => h.foldTo(open)); }
function hexA(hex, a) {
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(x => x + x).join('') : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a.toFixed(3)})`;
}
function renderMktCharts() {
  const pr = state.mktSel.filter(id => has(id) && S[id].kind !== 'yield');
  const yl = state.mktSel.filter(id => has(id) && S[id].kind === 'yield');
  const c1 = cards.rebased, c2 = cards.yields;
  c1.pinEl.replaceChildren(...state.mktSel.filter(id => has(id)).map(id => el('span', { class: 'pin-chip', style: `--pc:${col(state.selSlot[id])}` }, el('i'), S[id].label,
    el('button', { type: 'button', title: 'Remove', 'aria-label': 'Remove ' + S[id].label, onclick: () => { toggleSel(id, false); if (subActive($('#perfCard'))) renderPerfTable(); } }, '×'))));
  if (!pr.length) setEmpty(c1, 'Press + next to any asset in the table below to chart it here.');
  else {
    const list = pr.map(id => {
      const s = mktSeries(id), p = pts(s, state.from, state.to), b = asOf(s, state.from) || (p[0] && { v: p[0][1] });
      return { name: s.label, data: b ? p.map(([t, v]) => [t, v / b.v * 100]) : [], color: col(state.selSlot[id]) };
    });
    drawLines(c1, list, { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0), noLegend: true });
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
  makeCard(g, { key: 'rebased', title: 'Relative performance', wide: true, range: false, source: 'Yahoo Finance, FRED', render: renderMktCharts,
    seg: { key: 'mktCcy', select: true, label: 'Currency', options: CCY_CHOICES, onchange: () => { syncMktCcy(); renderMarkets(); } } });
  const sel = el('select', { class: 'mini-select', id: 'perfCcy', 'aria-label': 'Currency' });
  CCY_CHOICES.forEach(([v, l]) => sel.append(el('option', { value: v, text: l })));
  sel.addEventListener('change', () => { state.mktCcy = sel.value; syncMktCcy(); renderMarkets(); });
  $('#perfCsv').before(sel);
  // asset-class chips, a second row of region chips, a search box and a column picker
  const nav = el('div', { class: 'seg-chips', id: 'perfNav', role: 'tablist', 'aria-label': 'Asset class' });
  PERF_CLASSES.forEach(k => nav.append(el('button', { type: 'button', role: 'tab', text: k, onclick: () => { state.perfClass = k; state.perfSub = 'Key'; state.perfAll = false; renderPerfTable(); } })));
  const search = el('input', { type: 'search', placeholder: 'Find any asset…', 'aria-label': 'Find an asset', class: 'perf-search' });
  search.addEventListener('input', () => { state.perfQuery = search.value; renderPerfTable(); });
  const colPop = el('div', { class: 'pop col-pop', hidden: true }, el('div', { class: 'pop-label', text: 'Extra columns' }),
    ...[['3M', '3-month change'], ['Range', 'Change over the page’s date range']].map(([k, lab]) => { const cb = el('input', { type: 'checkbox' }); cb.checked = state.perfExtra.has(k);
      cb.addEventListener('change', () => { if (cb.checked) state.perfExtra.add(k); else state.perfExtra.delete(k); try { localStorage.setItem(PERF_OPT_KEY, JSON.stringify([...state.perfExtra])); } catch (e) { /* session only */ } renderPerfTable(); });
      return el('label', { class: 'pop-check' }, cb, ' ' + lab); }));
  colPop.addEventListener('click', e => e.stopPropagation());
  const colBtn = el('button', { type: 'button', class: 'ghost', text: 'Columns ▾', onclick: e => { e.stopPropagation(); togglePop(colPop); } });
  const bar = el('div', { class: 'perf-bar' }, nav, el('div', { class: 'perf-bar-r' }, search, el('span', { class: 'pop-anchor' }, colBtn, colPop)));
  const wrap = $('#perfTable').closest('.card').querySelector('.table-wrap');
  wrap.before(bar, el('div', { class: 'seg-chips sub-chips', id: 'perfSubNav', role: 'tablist', 'aria-label': 'Region' }));
  // pinned assets show as removable chips above the chart
  $('.perf-src').addEventListener('click', e => e.currentTarget.classList.toggle('open'));
  cards.rebased.pinEl = el('div', { class: 'pin-chips' });
  cards.rebased.subEl.after(cards.rebased.pinEl);
  makeCard(g, { key: 'yields', title: 'Selected rates & spreads', wide: true, range: false, sub: 'Levels, %.', source: 'FRED', render: renderMktCharts });
}
function syncMktCcy() { if (cards.rebased.segSel) cards.rebased.segSel.value = state.mktCcy; const p = $('#perfCcy'); if (p) p.value = state.mktCcy; }
function renderBreadth() { brKpis(); ['br_trend', 'br_hl', 'br_ew', 'br_table'].forEach(k => cards[k].render()); }
function renderMarkets() { state.mktSel.forEach(assignSlot); renderMktCharts(); if (subActive($('#perfCard'))) renderPerfTable(); renderBreadth(); renderStyles(); renderCommod(); }

// ------------------------------------------------------------------ BREADTH (from the ticker universe)
// Malaysia = the Bursa names in the ticker list, Singapore = the SGX names, US = the US large caps.
// Current constituents only, so history carries survivorship bias (stocks that dropped out are missing).
const BR_MKTS = {
  MY: { name: 'Malaysia', index: 'KLCI', pick: id => /\.KL$/.test(S[id].sym), who: 'Bursa large caps' },
  SG: { name: 'Singapore', index: 'STI', pick: id => /\.SI$/.test(S[id].sym), who: 'SGX large caps' },
  US: { name: 'US', index: 'SPX', pick: id => !/\./.test(S[id].sym) && !/-USD$/.test(S[id].sym) && S[id].type === 'EQUITY', who: 'US large caps' },
};
const brCache = {};
function breadth(mk) {
  if (brCache[mk]) return brCache[mk];
  const M = BR_MKTS[mk]; if (!TICK || !has(M.index)) return null;
  const mem = Object.values(TICK_SYM).filter(M.pick);
  if (mem.length < 8) return null;
  const idx = S[M.index], cal = idx.t.filter(t => t >= idx.t[idx.t.length - 1] - 3 * 366 * DAY);
  const pre = mem.map(id => {   // per member: prefix sums for moving averages, rolling 52-week extremes
    const s = S[id], n = s.v.length, ps = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) ps[i + 1] = ps[i] + s.v[i];
    return { id, s, ps };
  });
  const out = { t: [], a200: [], a50: [], hl: [], ew: [], n: [], members: mem };
  let ewLevel = 100;
  const ptr = pre.map(() => -1), last = pre.map(() => null);
  for (const t of cal) {
    let n = 0, c200 = 0, n200 = 0, c50 = 0, n50 = 0, hi = 0, lo = 0, rs = 0, rn = 0;
    pre.forEach((m, k) => {
      const s = m.s; let i = ptr[k]; while (i + 1 < s.t.length && s.t[i + 1] <= t) i++; ptr[k] = i;
      if (i < 0 || t - s.t[i] > 6 * DAY) return;
      n++;
      const v = s.v[i];
      if (i >= 199) { n200++; if (v > (m.ps[i + 1] - m.ps[i - 199]) / 200) c200++; }
      if (i >= 49) { n50++; if (v > (m.ps[i + 1] - m.ps[i - 49]) / 50) c50++; }
      if (i >= 250) { let mx = -Infinity, mn = Infinity; for (let j = i - 250; j < i; j++) { const x = s.v[j]; if (x > mx) mx = x; if (x < mn) mn = x; } if (v >= mx) hi++; if (v <= mn) lo++; }
      if (last[k] && last[k].i < i && t - last[k].t <= 6 * DAY) { rs += v / s.v[last[k].i] - 1; rn++; }
      last[k] = { i, t };
    });
    if (n < mem.length * 0.6) continue;
    if (rn) ewLevel *= 1 + rs / rn;
    out.t.push(t); out.n.push(n);
    out.a200.push(n200 >= mem.length * 0.6 ? c200 / n200 * 100 : null);
    out.a50.push(n50 >= mem.length * 0.6 ? c50 / n50 * 100 : null);
    out.hl.push(n200 >= mem.length * 0.6 ? (hi - lo) / n * 100 : null);
    out.ew.push(ewLevel);
  }
  return (brCache[mk] = out);
}
const brSer = (b, k, label) => ({ t: b.t.filter((_, i) => b[k][i] != null), v: b[k].filter(v => v != null), label, kind: 'level', unit: '%' });
state.brMkt = 'MY';
function brKpis() {
  const box = $('#brKpis'); box.replaceChildren();
  const tile = (label, val, delta, foot, tk) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: label }),
    el('div', { class: 'k-value' }, tk ? el('span', { class: 'qdot', style: `background:${tok(tk)}` }) : '', val), el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: foot })));
  if (!TICK) { box.append(el('div', { class: 'muted small', text: 'Loading ticker prices…' })); return; }
  for (const mk of ['MY', 'SG', 'US']) {
    const b = breadth(mk); if (!b || !b.t.length) continue;
    const a = brSer(b, 'a200'), x = asOf(a, state.to); if (!x) continue;
    const p = asOf(a, addMonths(x.t, -1)), tkn = x.v >= 70 ? '--good' : x.v >= 40 ? '--warning' : '--critical';
    tile(`${BR_MKTS[mk].name}: above 200-day`, fmtNum(x.v, 0) + '%', p ? `1M ${sign(x.v - p.v)}${fmtNum(Math.abs(x.v - p.v), 0)} pts · ${x.v >= 70 ? 'broad uptrend' : x.v >= 40 ? 'mixed' : 'narrow / weak'}` : '', `${b.members.length} ${BR_MKTS[mk].who} · ${nice(x.t)}`, tkn);
  }
  if (has('SPXEW', 'SPX')) { const r = combine(S.SPXEW, S.SPX, (a, b) => a / b, {}, 4 * DAY), a = asOf(r, state.to), b = asOf(r, Date.UTC(new Date(a.t).getUTCFullYear() - 1, 11, 31));
    if (a && b) tile('US equal vs cap weight, YTD', `${sign(a.v / b.v - 1)}${fmtNum(Math.abs(a.v / b.v - 1) * 100, 1)}%`, a.v < b.v ? 'the average stock is lagging the index' : 'the average stock is keeping up', 'S&P 500 equal weight ÷ S&P 500'); }
}
function renderBrTrend(c) {
  if (!TICK) return setEmpty(c, 'Loading ticker prices…');
  const mk = state.brMkt, M = BR_MKTS[mk], b = breadth(mk);
  if (!b || !b.t.length) return setEmpty(c, 'Not enough data yet.');
  c.titleEl.textContent = `${M.name}: index vs share of stocks in an uptrend`;
  drawLines(c, [{ name: '% above 200-day average', data: pts(brSer(b, 'a200'), state.from, state.to) }, { name: '% above 50-day average', data: pts(brSer(b, 'a50'), state.from, state.to), extra: { lineStyle: { width: 1.5, type: 'dashed', color: col(1) } } }],
    { fmt: v => fmtNum(v, 0) + '%', axisFmt: v => v + '%', yExtra: { min: 0, max: 100, scale: false }, endLabels: false,
      hlines: [{ y: 80, label: '80: broad (often stretched)' }, { y: 50, label: '50' }, { y: 20, label: '20: washed out' }] });
  // index on a second axis (dashboard convention for pairs)
  const ix = S[M.index];
  c.inst.setOption({ yAxis: [{}, valAxis(v => fmtNum(v, 0), { position: 'right', splitLine: { show: false }, axisLabel: { color: tok('--muted'), fontSize: 11 } })],
    series: [{}, {}, line(ix.label, pts(ix, state.from, state.to), tok('--ink-2'), { yAxisIndex: 1, lineStyle: { width: 1.5, color: tok('--ink-2') } })], legend: { show: true } });
  c.csv = [['Date', '% above 200d', '% above 50d', ix.label], ...b.t.filter(t => t >= state.from && t <= state.to).map(t => { const i = b.t.indexOf(t); const z = asOf(ix, t); return [iso(t), b.a200[i] ?? '', b.a50[i] ?? '', z ? z.v : '']; })];
  const x = asOf(brSer(b, 'a200'), state.to);
  setNote(c, `${b.members.length} ${M.who} from the dashboard’s ticker list (current members, so older readings carry survivorship bias). Rising index with falling breadth = narrow leadership, a classic late-rally warning; breadth below 20% has often marked washed-out lows.${x ? ` Latest: ${fmtNum(x.v, 0)}% above the 200-day.` : ''}`);
  setSource(c, `Yahoo Finance daily closes (${b.members.length} stocks; ${M.index === 'SPX' ? '^GSPC' : M.index === 'KLCI' ? '^KLSE' : '^STI'}); breadth calculated`);
}
function renderBrHL(c) {
  if (!TICK) return setEmpty(c, 'Loading ticker prices…');
  const mk = state.brMkt, M = BR_MKTS[mk], b = breadth(mk);
  if (!b || !b.t.length) return setEmpty(c, 'Not enough data yet.');
  c.titleEl.textContent = `${M.name}: new 52-week highs minus lows`;
  const s = brSer(b, 'hl'), p = pts(s, state.from, state.to);
  const o = baseOpt(); o.legend.show = false; o.grid.top = 14;
  o.xAxis = timeAxis(); o.yAxis = valAxis(v => v + '%');
  o.tooltip.formatter = tipFormatter(v => `${sign(v)}${fmtNum(Math.abs(v), 0)}% of stocks`);
  o.series = [{ name: 'Net new highs', type: 'bar', barWidth: '90%', large: true, data: p.map(([t, v]) => ({ value: [t, v], itemStyle: { color: v >= 0 ? tok('--pos') : tok('--neg') } })) }];
  setZoomable(c, o);
  c.csv = [['Date', 'Net new highs (% of stocks)'], ...p.map(([t, v]) => [iso(t), v.toFixed(1)])];
  setNote(c, 'Share of stocks at a 52-week closing high minus the share at a 52-week low, each day. Persistent net new lows while the index holds up is a warning sign; a burst of new highs often confirms a new uptrend.');
  setSource(c, 'Yahoo Finance daily closes; calculated');
}
function renderBrEW(c) {
  if (!TICK) return setEmpty(c, 'Loading ticker prices…');
  const list = [];
  for (const mk of ['MY', 'SG', 'US']) {
    const b = breadth(mk), ix = S[BR_MKTS[mk].index]; if (!b || !b.t.length || !ix) continue;
    const ew = { t: b.t, v: b.ew }, r = combine(ew, ix, (a, x) => a / x, {}, 6 * DAY), base = asOf(r, state.from) || { v: r.v[0] };
    list.push({ name: `${BR_MKTS[mk].name}`, data: pts(r, state.from, state.to).map(([t, v]) => [t, v / base.v * 100]) });
  }
  if (has('SPXEW', 'SPX')) { const r = combine(S.SPXEW, S.SPX, (a, x) => a / x, {}, 4 * DAY), base = asOf(r, state.from) || { v: r.v[0] };
    list.push({ name: 'US (official S&P EW)', data: pts(r, state.from, state.to).map(([t, v]) => [t, v / base.v * 100]), extra: { lineStyle: { width: 1.5, type: 'dashed', color: col(3) } } }); }
  if (!list.length) return setEmpty(c, 'Not enough data yet.');
  drawLines(c, list, { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0), hlines: [{ y: 100, label: '' }], endLabels: false });
  setNote(c, `Equal-weight basket of each market’s stocks ÷ its index (KLCI, STI, S&P 500), 100 at the start of the range. Falling = the big names are doing the work (narrow market); rising = broad participation. Price returns.`);
  setSource(c, 'Yahoo Finance daily closes (^SPXEW, ^GSPC, ^KLSE, ^STI and the stocks); ratios calculated');
}
function renderBrTable(c) {
  const b0 = htmlBody(c);
  if (!TICK) { b0.append(el('div', { class: 'empty', text: 'Loading ticker prices…' })); return; }
  const mk = state.brMkt, M = BR_MKTS[mk], b = breadth(mk); if (!b) { b0.append(el('div', { class: 'empty', text: 'Not enough data.' })); return; }
  c.titleEl.textContent = `${M.name}: who is leading and lagging`;
  const rows = b.members.map(id => {
    const s = S[id], a = asOf(s, state.to); if (!a || a.i < 200) return null;
    const ma = k => s.v.slice(a.i - k + 1, a.i + 1).reduce((x, y) => x + y, 0) / k;
    const hi = Math.max(...s.v.slice(Math.max(0, a.i - 250), a.i + 1)), m3 = asOf(s, addMonths(a.t, -3));
    return { id, s, v: a.v, d200: (a.v / ma(200) - 1) * 100, d50: (a.v / ma(50) - 1) * 100, off: (a.v / hi - 1) * 100, r3: m3 ? (a.v / m3.v - 1) * 100 : null };
  }).filter(Boolean).sort((x, y) => y.d200 - x.d200);
  const tbl = el('table', { class: 'perf watch' }), pos = tok('--pos'), neg = tok('--neg');
  const heads = ['Ticker', 'Name', 'Last', 'vs 200-day', 'vs 50-day', 'From 52w high', '3M'];
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i < 2 ? 'l' : '' })))));
  const tb = el('tbody'), pc = v => v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v), 1) + '%';
  const heat = (v, sc) => v == null ? '' : `background:${hexA(v > 0 ? pos : neg, Math.min(1, Math.abs(v) / sc) * 0.42)}`;
  const N = 6, cut = !state.brAll && rows.length > 2 * N + 2;
  const shown = cut ? [...rows.slice(0, N), null, ...rows.slice(-N)] : rows;
  for (const r of shown) if (!r) tb.append(el('tr', { class: 'grp' }, el('td', { colspan: heads.length }, el('button', { type: 'button', class: 'ghost more-btn', text: `Show all ${rows.length} (${rows.length - 2 * N} more in the middle)`, onclick: () => { state.brAll = true; c.render(); } })))); else tb.append(el('tr', { class: 'row', onclick: () => { state.sub.ideas = 1; state.watchSel = r.id; setTab('ideas'); } },
    el('td', { class: 'l', text: r.s.sym }), el('td', { class: 'l nm', text: r.s.short }), el('td', { text: fmtNum(r.v, autoDec(r.v)) }),
    el('td', { class: 'heat', style: heat(r.d200, 20), text: pc(r.d200) }), el('td', { class: 'heat', style: heat(r.d50, 10), text: pc(r.d50) }),
    el('td', { class: 'heat', style: heat(r.off, 30), text: pc(r.off) }), el('td', { class: 'heat', style: heat(r.r3, 20), text: pc(r.r3) })));
  tbl.append(tb); b0.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = [heads, ...rows.map(r => [r.s.sym, r.s.short, r.v, r.d200.toFixed(2), r.d50.toFixed(2), r.off.toFixed(2), r.r3 == null ? '' : r.r3.toFixed(2)])];
  setNote(c, `Sorted by distance from the 200-day average: ${cut ? `top ${N} leaders and bottom ${N} laggards` : 'leaders at the top, laggards at the bottom'}. ${rows.filter(r => r.d200 > 0).length} of ${rows.length} above their 200-day. Tap a row to open it in the Watchlist.` + (state.brAll ? '' : ''));
  setSource(c, 'Yahoo Finance daily closes; calculated');
}
// ------------------------------------------------------------------ COMMODITIES (Markets → Commodities)
const CM_IDS = ['BRENT', 'WTI', 'NATGAS', 'GOLD', 'COPPER', 'IRONORE', 'PALM', 'BDRY'];
const CM_TABLE = ['BRENT', 'WTI', 'NATGAS', 'GOLD', 'SILVER', 'COPPER', 'IRONORE', 'PALM', 'BDRY'];
const CM_PLANT = ['1961.KL', '2445.KL', '5285.KL'];   // IOI, KLK, SD Guthrie
state.cmCcy = 'USD';
function tickBasket(syms) {   // equal-weight basket of tickers, daily, = 100 at the first common date
  const ids = syms.map(x => TICK_SYM[x]).filter(Boolean); if (ids.length < 2) return null;
  const start = Math.max(...ids.map(id => S[id].t[0])), base = ids.map(id => asOf(S[id], start).v), s0 = S[ids[0]], t = [], v = [];
  for (let i = 0; i < s0.t.length; i++) { const d = s0.t[i]; if (d < start) continue;
    let x = 0, ok = true; for (let k = 0; k < ids.length; k++) { const a = asOf(S[ids[k]], d); if (!a || d - a.t > 7 * DAY) { ok = false; break; } x += a.v / base[k]; }
    if (ok) { t.push(d); v.push(x / ids.length * 100); } }
  return { names: ids.map(id => S[id].short).join(', '), group: 'Derived', kind: 'price', unit: 'index', source: 'Yahoo Finance tickers; equal weight, calculated', t, v };
}
function addBasket(id, syms, label, ccy) { const b = tickBasket(syms); if (b) { S[id] = { ...b, id, label: `${label} (${b.names})`, ccy }; LOCAL_CCY[id] = ccy; } }
function cmRet(s, back) { const a = asOf(s, state.to); if (!a) return null; const b = asOf(s, back(a.t)); return b && b.v && a.t - b.t < 400 * DAY ? (a.v / b.v - 1) * 100 : null; }
function renderCmRebased(c) {
  const ids = CM_IDS.filter(id => has(id)); if (!ids.length) return setEmpty(c, 'Waiting for data.');
  const list = ids.map(id => { const p = pts(inCcy(id, state.cmCcy), state.from, state.to), b = p.length ? p[0][1] : null;
    return { name: S[id].label, data: b ? p.map(([t, v]) => [t, v / b * 100]) : [], color: col(CM_IDS.indexOf(id)) }; }).filter(x => x.data.length);
  drawLines(c, list, { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0), endLabels: false });
  setNote(c, `Each series = 100 at the start of the range, ${state.cmCcy === 'USD' ? 'in US dollars' : `converted to ${state.cmCcy} at daily FX`}. Palm oil is a monthly average. BDRY is an ETF of dry-bulk freight futures, a shipping-rate proxy.`);
  setSource(c, 'Yahoo Finance futures (Brent, WTI, US gas, gold, copper, SGX iron ore) and BDRY ETF; IMF palm oil via FRED');
}
function corrW(A, B, from, to) {   // correlation of weekly % changes over the range
  const wk = s => { const m = new Map(); for (const [t, v] of pts(s, from, to)) m.set(Math.floor((t / DAY + 3) / 7), v); return m; };
  const a = wk(A), b = wk(B), ks = [...a.keys()].filter(k => b.has(k)).sort((x, y) => x - y), x = [], y = [];
  for (let i = 1; i < ks.length; i++) if (ks[i] === ks[i - 1] + 1) { x.push(a.get(ks[i]) / a.get(ks[i - 1]) - 1); y.push(b.get(ks[i]) / b.get(ks[i - 1]) - 1); }
  return x.length >= 20 ? pearson(x, y) : null;
}
function renderCmPalm(c) {
  if (!TICK) return setEmpty(c, 'Loading ticker prices…');
  const bk = S.MY_PLANT; if (!bk) return setEmpty(c, 'Plantation stocks not in the ticker list.');
  if (!has('PALM')) { drawLines(c, [{ name: 'Plantation basket (=100)', data: pts(bk, Math.max(state.from, bk.t[0]), state.to) }], { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0) });
    setNote(c, 'Palm oil (IMF via FRED) was not available on the last refresh; showing the plantation basket only.'); return setSource(c, 'Yahoo Finance (Bursa Malaysia)'); }
  const from = Math.max(state.from, bk.t[0]);
  drawPair(c, { name: 'Palm oil (USD/t, monthly)', data: pts(S.PALM, from, state.to) }, { name: 'Plantation basket (=100)', data: pts(bk, from, state.to) },
    { fmtA: v => fmtNum(v, 0), fmtB: v => fmtNum(v, 1), axisA: v => fmtNum(v, 0), axisB: v => fmtNum(v, 0) });
  const p = asOf(S.PALM, state.to), p12 = p && asOf(S.PALM, addMonths(p.t, -12));
  setNote(c, `Palm oil ${p ? `${fmtNum(p.v, 0)} USD/t in ${monthLab(p.t)}` : ''}${p12 ? ` (${sign(p.v - p12.v)}${fmtNum(Math.abs(p.v / p12.v - 1) * 100, 1)}% on a year)` : ''}. Basket = ${S.MY_PLANT.label.replace('Malaysia plantation basket ', '')}, equal weight, in ringgit; ticker history covers about 3 years.`);
  setSource(c, 'IMF primary commodity prices via FRED (PPOILUSDM); Yahoo Finance (Bursa Malaysia)');
}
function renderCmIron(c) {
  if (!has('IRONORE', 'AUDUSD')) return setEmpty(c, 'Waiting for data.');
  drawPair(c, { name: 'Iron ore (USD/t)', data: pts(S.IRONORE, state.from, state.to) }, { name: 'AUD/USD', data: pts(S.AUDUSD, state.from, state.to) },
    { fmtA: v => fmtNum(v, 1), fmtB: v => fmtNum(v, 4), axisA: v => fmtNum(v, 0), axisB: v => fmtNum(v, 2) });
  const r = corrW(S.IRONORE, S.AUDUSD, state.from, state.to);
  setNote(c, `Iron ore is Australia's largest export, so the Aussie dollar tends to follow it.${r != null ? ` Correlation of weekly changes over this range: ${r >= 0 ? '+' : '−'}${fmtNum(Math.abs(r), 2)}.` : ''} SGX 62% Fe futures.`);
  setSource(c, 'Yahoo Finance (TIO=F, AUDUSD=X)');
}
function renderCmTable(c) {
  const b = htmlBody(c), ccy = state.cmCcy;
  const yStart = t => Date.UTC(new Date(t).getUTCFullYear(), 0, 1) - 1;
  const P = [['1W', t => t - 7 * DAY], ['1M', t => addMonths(t, -1)], ['3M', t => addMonths(t, -3)], ['YTD', yStart], ['1Y', t => addMonths(t, -12)]];
  const rows = CM_TABLE.filter(id => has(id)).map(id => { const s = inCcy(id, ccy), a = asOf(S[id], state.to);
    return { id, last: a, r: P.map(([, f]) => cmRet(s, f)) }; });
  if (S.MY_PLANT) { const a = asOf(S.MY_PLANT, state.to); rows.push({ id: 'MY_PLANT', last: a, r: P.map(([, f]) => cmRet(inCcy('MY_PLANT', ccy), f)) }); }
  const heads = ['Commodity', 'Last', 'Unit', 'As of', ...P.map(p => p[0])];
  const tbl = el('table', { class: 'perf watch' }), pos = tok('--pos'), neg = tok('--neg');
  const heat = (v, sc) => v == null ? '' : `background:${hexA(v > 0 ? pos : neg, Math.min(1, Math.abs(v) / sc) * 0.42)}`;
  const pc = v => v == null ? '–' : sign(v) + fmtNum(Math.abs(v), 1) + '%', SC = [5, 10, 20, 25, 30];
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i === 0 || i === 2 ? 'l' : '' })))));
  const tb = el('tbody');
  for (const r of rows) { const s = S[r.id];
    tb.append(el('tr', { class: 'row' }, el('td', { class: 'l', text: r.id === 'MY_PLANT' ? 'Malaysia planters (basket)' : s.label }), el('td', { text: r.last ? fmtNum(r.last.v, autoDec(r.last.v)) : '–' }),
      el('td', { class: 'l muted', text: r.id === 'MY_PLANT' ? 'index, MYR' : s.unit }), el('td', { class: 'muted', text: r.last ? dShort(r.last.t) : '–' }),
      ...r.r.map((v, i) => el('td', { class: 'heat', style: heat(v, SC[i]), text: pc(v) })))); }
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = [heads, ...rows.map(r => [S[r.id].label, r.last ? r.last.v : '', S[r.id].unit, r.last ? new Date(r.last.t).toISOString().slice(0, 10) : '', ...r.r.map(v => v == null ? '' : v.toFixed(2))])];
  setNote(c, `Returns ${ccy === 'USD' ? 'in US dollars' : `in ${ccy}`} (the plantation basket starts in ringgit); prices in their own units. Palm oil is monthly, so 1W is blank or stale.`);
  setSource(c, 'Yahoo Finance; IMF via FRED; calculated');
}
function buildCommod() {
  const panel = $('#tab-markets'), g = el('div', { class: 'grid', id: 'cmGrid' }); panel.append(g);
  const seg = { key: 'cmCcy', select: true, label: 'Currency', options: CCY_CHOICES.filter(x => x[0] !== 'local'), onchange: () => renderCommod() };
  makeCard(g, { key: 'cm_rebased', title: 'Energy, metals and shipping, rebased', wide: true, defaultRange: '1Y', seg, render: renderCmRebased });
  makeCard(g, { key: 'cm_palm', title: 'Palm oil vs Malaysian planters', defaultRange: '3Y', render: renderCmPalm });
  makeCard(g, { key: 'cm_iron', title: 'Iron ore vs the Australian dollar', defaultRange: '3Y', render: renderCmIron });
  makeCard(g, { key: 'cm_table', title: 'Commodity scorecard', wide: true, range: false, render: renderCmTable });
  const r = cards.cm_table.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true;
}
function renderCommod() { ['cm_rebased', 'cm_palm', 'cm_iron', 'cm_table'].forEach(k => cards[k].render()); }

// ------------------------------------------------------------------ STYLES & SECTORS (Markets → Styles & sectors)
const STY_PAIRS = [   // [numerator, denominator, label, short]
  ['IWF', 'IWD', 'Growth ÷ value', 'growth vs value'], ['RTY', 'SPX', 'Small ÷ large caps', 'small vs large caps'],
  ['SPXEW', 'SPX', 'Equal ÷ cap weight', 'equal vs cap weight'], ['MTUM', 'SPX', 'Momentum ÷ market', 'momentum vs market'],
  ['QUAL', 'SPX', 'Quality ÷ market', 'quality vs market'], ['USMV', 'SPX', 'Low volatility ÷ market', 'low-vol vs market'],
];
const STY_SECT = ['XLK', 'XLC', 'XLY', 'XLF', 'XLI', 'XLE', 'XLB', 'XLV', 'XLP', 'XLU', 'VNQ'];
const STY_P = [['1M', t => addMonths(t, -1)], ['3M', t => addMonths(t, -3)], ['YTD', t => Date.UTC(new Date(t).getUTCFullYear(), 0, 1) - 1], ['1Y', t => addMonths(t, -12)]];
function relRet(a, b, back) { const x = cmRet(S[a], back), y = cmRet(S[b], back); return x == null || y == null ? null : ((1 + x / 100) / (1 + y / 100) - 1) * 100; }
function styRead() {   // rule-based one-liner from 3-month relative moves
  const r = Object.fromEntries(STY_PAIRS.filter(p => has(p[0], p[1])).map(p => [p[0] + '/' + p[1], relRet(p[0], p[1], STY_P[1][1])]));
  const sec = id => has(id, 'SPX') ? relRet(id, 'SPX', STY_P[1][1]) : null, out = [], T = 1;
  const def = (r['USMV/SPX'] > T) + (sec('XLP') > T) + (sec('XLU') > T) + (sec('XLV') > T), cyc = (r['RTY/SPX'] > T) + (sec('XLF') > T) + (sec('XLI') > T) + (sec('XLE') > T) + (sec('XLB') > T);
  if (def >= 2 && def > cyc) out.push('defensive leadership: low-vol and defensive sectors beating the index');
  else if (cyc >= 3) out.push('cyclical leadership: small caps and cyclical sectors beating the index');
  if (r['IWF/IWD'] != null) out.push(Math.abs(r['IWF/IWD']) < T ? 'growth and value level' : r['IWF/IWD'] > 0 ? `growth ahead of value by ${fmtNum(r['IWF/IWD'], 1)}%` : `value ahead of growth by ${fmtNum(-r['IWF/IWD'], 1)}%`);
  if (r['SPXEW/SPX'] != null) out.push(r['SPXEW/SPX'] > T ? 'breadth widening (equal weight beating cap weight)' : r['SPXEW/SPX'] < -T ? 'narrow, mega-cap-led market (equal weight lagging)' : 'equal and cap weight level');
  if (r['MTUM/SPX'] != null && Math.abs(r['MTUM/SPX']) > 2 * T) out.push(r['MTUM/SPX'] > 0 ? 'momentum working' : 'momentum unwinding');
  return out.length ? 'Last 3 months: ' + out.join('; ') + '.' : '';
}
function renderStyRatio(c) {
  const list = STY_PAIRS.filter(p => has(p[0], p[1])).map(([a, b, lab], k) => { const r = ratioSeries([a], [b]), p = r ? pts(r, state.from, state.to) : [], b0 = p.length ? p[0][1] : null;
    return { name: lab, data: b0 ? p.map(([t, v]) => [t, v / b0 * 100]) : [], color: col(k) }; }).filter(x => x.data.length);
  if (!list.length) return setEmpty(c, 'Waiting for data (next daily run).');
  drawLines(c, list, { fmt: v => fmtNum(v, 1), axisFmt: v => fmtNum(v, 0), hlines: [{ y: 100 }], endLabels: false });
  setNote(c, `Each line = first ÷ second, = 100 at the start of the range; rising = the first is winning. ${styRead()}`);
  setSource(c, 'Yahoo Finance (iShares IWF, IWD, MTUM, QUAL, USMV; Russell 2000; S&P 500 and equal weight); price returns; calculated');
}
function styTable(c, rows, heads0, note, src) {
  const b = htmlBody(c), tbl = el('table', { class: 'perf watch' }), pos = tok('--pos'), neg = tok('--neg'), SC = [4, 8, 12, 15];
  const heat = (v, sc) => v == null ? '' : `background:${hexA(v > 0 ? pos : neg, Math.min(1, Math.abs(v) / sc) * 0.42)}`;
  const pc = v => v == null ? '–' : sign(v) + fmtNum(Math.abs(v), 1) + '%', heads = [heads0, ...STY_P.map(p => p[0])];
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h + (i === 2 ? ' ▼' : ''), class: i === 0 ? 'l' : '' })))));
  const tb = el('tbody'); rows.sort((x, y) => (y.r[1] ?? -1e9) - (x.r[1] ?? -1e9));
  for (const r of rows) tb.append(el('tr', { class: 'row' }, el('td', { class: 'l', text: r.name }), ...r.r.map((v, i) => el('td', { class: 'heat', style: heat(v, SC[i]), text: pc(v) }))));
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = [heads, ...rows.map(r => [r.name, ...r.r.map(v => v == null ? '' : v.toFixed(2))])];
  setNote(c, note); setSource(c, src);
}
function renderStySect(c) {
  if (!has('SPX')) return setEmpty(c, 'Waiting for data.');
  const rows = STY_SECT.filter(id => has(id)).map(id => ({ name: S[id].label.replace(/^US /, ''), r: STY_P.map(([, f]) => relRet(id, 'SPX', f)) }));
  styTable(c, rows, 'Sector', 'Each sector ETF’s price return minus the S&P 500’s (relative, %), sorted by 3 months. Blue = beating the index.', 'Yahoo Finance (SPDR sector ETFs, VNQ, ^GSPC); calculated');
}
function renderStyStyle(c) {
  const rows = STY_PAIRS.filter(p => has(p[0], p[1])).map(([a, b, lab]) => ({ name: lab, r: STY_P.map(([, f]) => relRet(a, b, f)) }));
  if (has('VLUE', 'SPX')) rows.push({ name: 'Value factor ÷ market', r: STY_P.map(([, f]) => relRet('VLUE', 'SPX', f)) });
  styTable(c, rows, 'Style', 'Relative return of the first over the second, %, sorted by 3 months. Positive = the first is winning.', 'Yahoo Finance (iShares style ETFs, ^RUT, ^SPXEW, ^GSPC); calculated');
}
function buildStyles() {
  const panel = $('#tab-markets'), g = el('div', { class: 'grid', id: 'styGrid' }); panel.append(g);
  makeCard(g, { key: 'sty_ratio', title: 'US style leadership', wide: true, defaultRange: '1Y', render: renderStyRatio });
  makeCard(g, { key: 'sty_sect', title: 'Sectors vs the S&P 500', range: false, render: renderStySect });
  makeCard(g, { key: 'sty_style', title: 'Styles: who is winning', range: false, render: renderStyStyle });
  for (const k of ['sty_sect', 'sty_style']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
}
function renderStyles() { ['sty_ratio', 'sty_sect', 'sty_style'].forEach(k => cards[k].render()); }

function buildBreadth() {
  const panel = $('#tab-markets'), g = el('div', { class: 'grid', id: 'brGrid' });
  const k = el('div', { class: 'kpis', id: 'brKpis' });
  panel.append(k, g);
  const seg = { key: 'brMkt', options: [['MY', 'Malaysia'], ['SG', 'Singapore'], ['US', 'US']], onchange: null };
  makeCard(g, { key: 'br_trend', title: 'Breadth', wide: true, defaultRange: '1Y', seg, render: renderBrTrend });
  makeCard(g, { key: 'br_hl', title: 'New highs minus lows', defaultRange: '1Y', seg, render: renderBrHL });
  makeCard(g, { key: 'br_ew', title: 'Equal weight vs the index', defaultRange: 'YTD', render: renderBrEW });
  makeCard(g, { key: 'br_table', range: false, title: 'Leaders and laggards', wide: true, seg, render: renderBrTable });
  const r = cards.br_table.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true;
  // the three market switches stay in step
  for (const key of ['br_trend', 'br_hl', 'br_table']) cards[key].root.querySelectorAll('.card-tools .seg button').forEach(btn => btn.addEventListener('click', () => {
    for (const k2 of ['br_trend', 'br_hl', 'br_table']) if (k2 !== key) { cards[k2].root.querySelectorAll('.card-tools .seg button').forEach(x => x.classList.toggle('on', x.textContent === btn.textContent)); cards[k2].render(); }
  }));
}

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
// ---- lead-lag finder: monthly, does series A move before series B?
// [leader, mode, follower, mode, why]; modes: level, yoy (% change on a year), chg (change on a year, points)
const LL_PAIRS = [
  ['LEI_6M', 'level', 'REG_GM', 'level', 'US leading index → growth momentum'],
  ['M2_YOY', 'level', 'LH_SPX', 'yoy', 'Money growth → US equities'],
  ['NET_LIQ', 'yoy', 'SPX', 'yoy', 'Fed net liquidity → US equities'],
  ['CURVE_3m10y_LONG', 'level', 'UNRATE', 'chg', 'Yield curve → unemployment (inverse)'],
  ['SLOOS_CI', 'level', 'UNRATE', 'chg', 'Bank lending standards → unemployment'],
  ['BAA_10Y', 'level', 'RZG_PAYEMS', 'level', 'Credit spreads → payroll growth (inverse)'],
  ['BRENT', 'yoy', 'CPI_YOY', 'level', 'Oil → US inflation'],
  ['CLI_USA', 'level', 'RZG_INDPRO', 'level', 'OECD US leading indicator → industrial production'],
  ['CLI_CHN', 'level', 'COPPER', 'yoy', 'China leading indicator → copper'],
  ['SMH', 'yoy', 'KR_EXP_YOY', 'level', 'Semiconductor stocks → Korea exports'],
  ['KR_EXP_YOY', 'level', 'MY_EXPORTS_YOY', 'level', 'Korea exports → Malaysia exports'],
  ['KR_EXP_YOY', 'level', 'SG_NODX_YOY', 'level', 'Korea exports → Singapore NODX'],
  ['MY_LEADING', 'yoy', 'MY_COINCIDENT', 'yoy', 'Malaysia leading → coincident index'],
  ['KLCI', 'yoy', 'MY_COINCIDENT', 'yoy', 'KLCI → Malaysia coincident index'],
  ['MY_LEADING', 'yoy', 'MY_IPI_YOY', 'level', 'Malaysia leading index → industrial production'],
  ['DXY', 'yoy', 'EEM', 'yoy', 'US dollar → EM equities (inverse)'],
  ['REAL10Y', 'chg', 'GOLD', 'yoy', 'Real yields → gold (inverse)'],
  ['CN_EXP_YOY', 'level', 'MY_EXPORTS_YOY', 'level', 'China exports → Malaysia exports'],
  ['PALM', 'yoy', 'MY_PLANT', 'yoy', 'Palm oil → Malaysian plantation stocks'],
  ['ISM_PMI', 'level', 'IPMAN', 'yoy', 'ISM manufacturing → factory output'],
  ['ISM_PMI', 'level', 'SRVPRD', 'yoy', 'ISM manufacturing → services payrolls'],
  ['BCI_USA', 'level', 'MY_EXPORTS_YOY', 'level', 'US business confidence (ISM-based) → Malaysia exports'],
  ['BCI_USA', 'level', 'BCI_EA20', 'level', 'US → euro-area business confidence'],
  ['BCI_CHN', 'level', 'BCI_USA', 'level', 'China → US business confidence'],
  ['BCI_USA', 'level', 'SG_NODX_YOY', 'level', 'US business confidence → Singapore NODX'],
  ['LH_SPX', 'yoy', 'BCI_USA', 'level', 'S&P 500 → US business confidence (the market leads)'],
  ['IRONORE', 'yoy', 'AUDUSD', 'yoy', 'Iron ore → Australian dollar'],
];
const llCache = new Map();
const llMode = id => S[id].kind === 'price' ? 'yoy' : S[id].kind === 'yield' ? 'chg' : 'level';
function llSeries(id, mode) {   // Map(month start -> value), gaps of up to 3 months carried forward (quarterly data)
  const key = id + '|' + mode; if (llCache.has(key)) return llCache.get(key);
  const me = monthEnds(S[id]), ks = [...me.keys()].sort((a, b) => a - b), raw = new Map();
  if (ks.length) { let last = null, gap = 9; for (let t = ks[0]; t <= ks[ks.length - 1]; t = addMonths(t, 1)) { if (me.has(t)) { last = me.get(t); gap = 0; } else gap++; if (last != null && gap <= 3) raw.set(t, last); } }
  let out = raw;
  if (mode !== 'level') { out = new Map(); for (const [t, v] of raw) { const p = raw.get(addMonths(t, -12)); if (p != null && (mode === 'chg' || p !== 0)) out.set(t, mode === 'yoy' ? (v / p - 1) * 100 : v - p); } }
  llCache.set(key, out); return out;
}
function llScan(a, ma, b, mb, max = 24) {   // correlation of A(t) with B(t+k), k = -max..max; k > 0 means A leads
  const A = llSeries(a, ma), B = llSeries(b, mb), res = [];
  for (let k = -max; k <= max; k++) { const x = [], y = [];
    for (const [t, v] of A) { const w = B.get(addMonths(t, k)); if (w != null) { x.push(v); y.push(w); } }
    res.push({ k, r: x.length >= 36 ? pearson(x, y) : null, n: x.length }); }
  const ok = res.filter(z => z.r != null);
  if (!ok.length) return null;
  const best = ok.reduce((m, z) => Math.abs(z.r) > Math.abs(m.r) ? z : m), zero = res.find(z => z.k === 0);
  return { res, best, zero };
}
const llLabel = (id, mode) => S[id].label + (mode === 'yoy' ? ', YoY %' : mode === 'chg' ? ', 12m change' : '');
const llFmt = mode => v => (mode === 'level' ? '' : sign(v)) + fmtNum(mode === 'level' ? v : Math.abs(v), Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2) + (mode === 'yoy' ? '%' : mode === 'chg' ? ' pts' : '');
state.ll = { a: 'LEI_6M', ma: 'level', b: 'REG_GM', mb: 'level', lag: 'best' };
function llNow() { const L = state.ll; if (!has(L.a, L.b) || L.a === L.b) return null; const sc = llScan(L.a, L.ma, L.b, L.mb); if (!sc) return null;
  return { sc, k: L.lag === 'best' ? sc.best.k : +L.lag }; }
function renderLLChart(c) {
  const L = state.ll;
  for (const [sel, key] of [[c.selA, 'a'], [c.selB, 'b']]) { const ids = allIdsSorted().filter(id => S[id].group !== 'Tickers' || id === L[key]);
    if (sel.options.length !== ids.length) sel.replaceChildren(...ids.map(id => el('option', { value: id, text: S[id].label }))); sel.value = L[key]; }
  const now = llNow();
  if (!now) return setEmpty(c, 'Pick two different series with at least three years of overlapping monthly history.');
  const { sc, k } = now, A = llSeries(L.a, L.ma), B = llSeries(L.b, L.mb);
  const da = [...A].map(([t, v]) => [addMonths(t, k), v]).filter(p => p[0] >= state.from && p[0] <= addMonths(state.to, Math.max(k, 0))), db = [...B].filter(p => p[0] >= state.from && p[0] <= state.to);
  const xmax = Math.max(state.to, da.length ? da[da.length - 1][0] : 0);
  drawPair(c, { name: llLabel(L.a, L.ma) + (k ? ` · moved ${k > 0 ? 'forward' : 'back'} ${Math.abs(k)}m` : ''), data: da }, { name: llLabel(L.b, L.mb), data: db },
    { fmtA: llFmt(L.ma), fmtB: llFmt(L.mb), axisA: v => fmtNum(v, Math.abs(v) < 10 ? 1 : 0), axisB: v => fmtNum(v, Math.abs(v) < 10 ? 1 : 0) });
  if (xmax > state.to) c.inst.setOption({ xAxis: c.pairMode === 'stack' ? [{ max: xmax }, { max: xmax }] : { max: xmax } });
  const at = sc.res.find(z => z.k === k);
  c.subEl.textContent = k === 0 ? 'Both series as measured, monthly.' : k > 0 ? `First series drawn ${k} months later than measured, so its turns line up with the second. The stretch past today is what it hints for the next ${k} months.` : `The second series tends to move first: the first is drawn ${-k} months earlier.`;
  setNote(c, `Correlation at this shift: ${at && at.r != null ? fmtCorr(at.r) : 'n/a'} (${at ? at.n : 0} months, full history); as measured: ${sc.zero && sc.zero.r != null ? fmtCorr(sc.zero.r) : 'n/a'}. Strongest link at ${sc.best.k === 0 ? 'no lead' : sc.best.k > 0 ? `a ${sc.best.k}-month lead` : `a ${-sc.best.k}-month lag (the second series leads)`}: ${fmtCorr(sc.best.r)}.` + (sc.best.r < 0 ? ' Negative = they move in opposite directions.' : ''));
  setSource(c, srcOf([L.a, L.b]) + '; monthly transforms and correlations calculated');
}
function renderLLBars(c) {
  const now = llNow(); if (!now) return setEmpty(c, 'Pick two series.');
  const { sc, k } = now, o = baseOpt(); o.legend.show = false; o.grid.top = 14;
  o.xAxis = { type: 'category', data: sc.res.map(z => z.k), name: '← second leads · months · first leads →', nameLocation: 'middle', nameGap: 26, nameTextStyle: { color: tok('--muted'), fontSize: 11 },
    axisLabel: { color: tok('--muted'), fontSize: 11 }, axisLine: { lineStyle: { color: tok('--axis') } }, axisTick: { show: false } };
  o.grid.bottom = 26;
  o.yAxis = valAxis(v => v.toFixed(1), { min: -1, max: 1, scale: false });
  o.tooltip = { ...o.tooltip, trigger: 'item', formatter: p => { const z = sc.res[p.dataIndex]; return `<b>${z.r == null ? 'n/a' : fmtCorr(z.r)}</b> ${z.k === 0 ? 'same month' : z.k > 0 ? `first leads by ${z.k}m` : `second leads by ${-z.k}m`} · ${z.n} months`; } };
  o.series = [{ type: 'bar', barWidth: '70%', data: sc.res.map(z => ({ value: z.r == null ? 0 : +z.r.toFixed(3), itemStyle: { color: z.k === k ? tok('--brand-red') : hexA(tok('--s1'), z.k === sc.best.k ? 0.9 : 0.45), borderRadius: 2 } })) }];
  const ch = inst(c); ch.setOption(o, true);
  ch.off('click'); ch.on('click', p => { state.ll.lag = String(sc.res[p.dataIndex].k); syncLLSeg(); cards.ll_chart.render(); c.render(); });
  c.csv = [['Lead of first series (months)', 'Correlation', 'Months'], ...sc.res.map(z => [z.k, z.r == null ? '' : z.r.toFixed(3), z.n])];
  setNote(c, 'Correlation when the first series is shifted by each number of months, over the full shared history. Red = the shift shown in the chart; click any bar to use it. A peak to the right of 0 means the first series tends to move first.');
  setSource(c, 'Calculated from the two series (monthly)');
}
function syncLLSeg() { const c = cards.ll_chart; c.root.querySelectorAll('.card-tools .seg button').forEach(b => b.classList.toggle('on', (b.textContent === 'As measured' && state.ll.lag === '0') || (b.textContent === 'Best lead' && state.ll.lag === 'best'))); }
function renderLLTable(c) {
  const b = htmlBody(c), rows = LL_PAIRS.filter(p => has(p[0], p[2])).map(p => ({ p, sc: llScan(p[0], p[1], p[2], p[3]) })).filter(r => r.sc)
    .sort((x, y) => Math.abs(y.sc.best.r) - Math.abs(x.sc.best.r));
  const tbl = el('table', { class: 'perf watch' }), heads = ['Relationship', 'First series', 'Second series', 'As measured', 'Best shift', 'Correlation there', 'Months'];
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i < 3 ? 'l' : '' })))));
  const tb = el('tbody'), L = state.ll;
  for (const { p, sc } of rows) { const k = sc.best.k;
    tb.append(el('tr', { class: 'row' + (L.a === p[0] && L.b === p[2] ? ' sel' : ''), onclick: () => { state.ll = { a: p[0], ma: p[1], b: p[2], mb: p[3], lag: 'best' }; syncLLSeg(); renderCorrelation(); cards.ll_chart.root.scrollIntoView({ behavior: 'smooth', block: 'center' }); } },
      el('td', { class: 'l', text: p[4] }), el('td', { class: 'l nm', text: llLabel(p[0], p[1]) }), el('td', { class: 'l nm', text: llLabel(p[2], p[3]) }),
      el('td', { text: sc.zero.r == null ? '–' : fmtCorr(sc.zero.r) }),
      el('td', { text: k === 0 ? 'none' : k > 0 ? `first leads ${k}m` : `second leads ${-k}m` }),
      el('td', { class: 'heat', style: `background:${hexA(tok(sc.best.r >= 0 ? '--pos' : '--neg'), Math.min(1, Math.abs(sc.best.r)) * 0.42)}`, text: fmtCorr(sc.best.r) }), el('td', { text: String(sc.best.n) }))); }
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = [heads, ...rows.map(({ p, sc }) => [p[4], llLabel(p[0], p[1]), llLabel(p[2], p[3]), sc.zero.r == null ? '' : sc.zero.r.toFixed(2), sc.best.k, sc.best.r.toFixed(2), sc.best.n])];
  setNote(c, 'Well-known lead-lag relationships, tested on this dashboard’s own monthly data over each pair’s full shared history, strongest first. Click a row to chart it at its best shift. Caution: searching 49 shifts always finds a “best” one, short histories overstate links, and a past lead is a tendency, not a forecast.');
}
function buildLeadLag() {
  const g = $('#tab-correlation .grid');
  const c = makeCard(g, { key: 'll_chart', title: 'Lead-lag chart', defaultRange: '10Y', seg: { key: 'llLagSeg', options: [['0', 'As measured'], ['best', 'Best lead']], onchange: null }, render: renderLLChart });
  c.root.querySelectorAll('.card-tools .seg button').forEach(btn => btn.addEventListener('click', () => { state.ll.lag = btn.textContent === 'As measured' ? '0' : 'best'; syncLLSeg(); cards.ll_chart.render(); cards.ll_bars.render(); }));
  c.selA = el('select', { 'aria-label': 'First series (possible leader)' }); c.selB = el('select', { 'aria-label': 'Second series' });
  const pick = (sel, key, mk) => sel.addEventListener('change', () => { state.ll[key] = sel.value; state.ll[mk] = llMode(sel.value); state.ll.lag = 'best'; syncLLSeg(); renderCorrelation(); });
  pick(c.selA, 'a', 'ma'); pick(c.selB, 'b', 'mb');
  c.root.querySelector('.card-head').after(el('div', { class: 'pairsel' }, c.selA, el('span', { class: 'muted', text: 'leads?' }), c.selB));
  makeCard(g, { key: 'll_bars', range: false, title: 'Correlation at each shift', render: renderLLBars });
  makeCard(g, { key: 'll_table', range: false, title: 'Lead-lag relationships worth knowing', wide: true, render: renderLLTable });
  const r = cards.ll_table.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true;
  syncLLSeg();
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
function renderCorrelation() { cards.matrix.render(); cards.pair.render(); ['ll_chart', 'll_bars', 'll_table'].forEach(k => cards[k] && cards[k].render()); }

// ------------------------------------------------------------------ IDEA LOG
// Ideas are kept only in this browser (localStorage); Export/Import moves them between laptops.
// Nothing is sent anywhere: the dashboard site is public, so ideas are never published with it.
const IDEA_KEY = 'sd-ideas-v1';
const IDEA_VIEWS = [['Open ideas', 'open'], ['Watchlist', 'watch'], ['Closed', 'closed'], ['Scorecard', 'score']];
let IDEAS = [], ideaStoreOk = true;
function loadIdeas() {
  try { const raw = localStorage.getItem(IDEA_KEY); IDEAS = raw ? JSON.parse(raw) : []; ideaStoreOk = true; }
  catch (e) { IDEAS = IDEAS || []; ideaStoreOk = false; }
}
function saveIdeas() {
  try { localStorage.setItem(IDEA_KEY, JSON.stringify(IDEAS)); ideaStoreOk = true; } catch (e) { ideaStoreOk = false; }
}
const ideaDirs = id => S[id] && S[id].kind === 'yield' ? [['down', 'Yield/spread falls (long bonds, receive)'], ['up', 'Yield/spread rises (short bonds, pay)']]
  : [['up', 'Long / rises'], ['down', 'Short / falls']];
function ideaPerf(x, at = null) {   // P&L of an idea at `at` (default: now or its close); null if not trackable
  const s = x.sid && S[x.sid]; if (!s || x.entry == null) return null;
  const t = at ?? (x.status === 'closed' && x.closeDate ? dayMs(x.closeDate) : state.latest);
  const level = x.status === 'closed' && x.closeLevel != null && at == null ? x.closeLevel : (asOf(s, t) || {}).v;
  if (level == null) return null;
  const sg = x.dir === 'down' ? -1 : 1;
  if (s.kind === 'price') return { level, val: sg * (level / x.entry - 1) * 100, unit: '%' };
  if (s.kind === 'yield') return { level, val: sg * (level - x.entry) * 100, unit: 'bp' };
  return { level, val: sg * (level - x.entry), unit: s.unit || 'pts' };
}
const fmtPnl = p => p == null ? '–' : `${p.val > 0 ? '+' : p.val < 0 ? '−' : ''}${fmtNum(Math.abs(p.val), p.unit === 'bp' ? 0 : p.unit === '%' ? 1 : 2)}${p.unit === '%' ? '%' : p.unit === 'bp' ? 'bp' : ' ' + p.unit}`;
function ideaHits(x) {   // first time the price path reached the target or the stop since entry
  const s = x.sid && S[x.sid]; if (!s || x.entry == null) return null;
  const a = dayMs(x.date), b = x.status === 'closed' && x.closeDate ? dayMs(x.closeDate) : state.latest, up = x.dir !== 'down';
  for (const [t, v] of pts(s, a + DAY, b)) {
    if (x.target != null && (up ? v >= x.target : v <= x.target)) return { what: 'target', t };
    if (x.stop != null && (up ? v <= x.stop : v >= x.stop)) return { what: 'stop', t };
  }
  return null;
}
function ideaLevel(x, v) { const s = S[x.sid]; return v == null ? '–' : s && s.kind === 'yield' ? fmtNum(v, 2) + '%' : s ? fmtVal(s, v) : fmtNum(v, autoDec(v)); }
function ideaProgress(x, p) {   // where the price sits between stop (0) and target (1)
  if (!p || x.target == null || x.stop == null || x.target === x.stop) return null;
  return Math.max(-0.1, Math.min(1.1, (p.level - x.stop) / (x.target - x.stop)));
}
// ---- individual tickers (Yahoo Finance via the daily refresh): loaded in the background
let TICK = null;
const tickId = sym => 'T_' + sym.replace(/[^A-Za-z0-9]/g, '_');
const TICK_SYM = {};   // upper-case symbol -> S id
async function loadTickers() {
  try { TICK = await loadJSON('data/tickers.json'); } catch (e) { TICK = null; return; }
  for (const [sym, x] of Object.entries(TICK.items || {})) {
    const id = tickId(sym);
    S[id] = { id, sym, label: `${x.name} (${sym})`, short: x.name, group: 'Tickers', kind: 'price', unit: x.ccy || '', ccy: x.ccy || '', exch: x.exch, type: x.type,
      source: `Yahoo Finance (${sym})`, stale: !!x.stale, mine: x.src === 'watchlist', t: x.d.map(d => d * DAY), v: x.v };
    TICK_SYM[sym.toUpperCase()] = id;
  }
  addBasket('MY_PLANT', CM_PLANT, 'Malaysia plantation basket', 'MYR'); addBasket('MY_TECH', CHIP_MY, 'Malaysia tech basket', 'MYR');
  if (['overview', 'ideas', 'weekly', 'correlation', 'markets', 'ai'].includes(state.tab)) renderTab();
}
function tickerFromText(txt) {   // "$AAPL", "aapl", "1155.KL", "MYX:1155", "Maybank" -> S id or null
  let t = (txt || '').trim().toUpperCase().replace(/^\$/, '');
  const m = t.match(/^([A-Z]+):(.+)$/);
  if (m) { const suf = { MYX: '.KL', KLSE: '.KL', SGX: '.SI', HKEX: '.HK', TSE: '.T', TYO: '.T', ASX: '.AX', KRX: '.KS', TWSE: '.TW' }[m[1]];
    t = suf ? (m[1] === 'HKEX' && /^\d+$/.test(m[2]) ? m[2].padStart(4, '0') : m[2]) + suf : m[2]; }
  if (TICK_SYM[t]) return TICK_SYM[t];
  const hits = Object.values(TICK_SYM).filter(id => S[id].short.toUpperCase().includes(t));
  return t.length >= 3 && hits.length === 1 ? hits[0] : null;
}
const WATCH_KEY = 'sd-watch-v1';
function getWatch() { try { return JSON.parse(localStorage.getItem(WATCH_KEY) || '[]'); } catch (e) { return state.watchMem || []; } }
function setWatch(list) { state.watchMem = list; try { localStorage.setItem(WATCH_KEY, JSON.stringify(list)); } catch (e) { /* kept for this session only */ } }
function tickMarket(id) {
  const x = S[id], sym = x.sym;
  if (x.mine) return 'Added in watchlist.txt';
  if (x.type === 'CRYPTOCURRENCY' || /-USD$/.test(sym)) return 'Crypto';
  if (x.type === 'ETF') return 'ETFs';
  const suf = (sym.match(/\.([A-Z]+)$/) || [])[1];
  return { KL: 'Malaysia (Bursa)', SI: 'Singapore (SGX)', HK: 'Hong Kong', T: 'Japan', KS: 'Korea', TW: 'Taiwan', AX: 'Australia' }[suf] || 'US';
}
const TICK_ORDER = ['Added in watchlist.txt', 'Malaysia (Bursa)', 'Singapore (SGX)', 'US', 'ETFs', 'Hong Kong', 'Japan', 'Korea', 'Taiwan', 'Australia', 'Crypto'];
function tickRow(id, { star = true, end = state.latest } = {}) {
  const s = S[id], a = asOf(s, end); if (!a) return null;
  const ch = back => { const b = asOf(s, back); return b && b.t < a.t ? (a.v / b.v - 1) * 100 : null; };
  return { id, s, last: a.v, t: a.t, d1: a.i > 0 ? (a.v / s.v[a.i - 1] - 1) * 100 : null, w1: ch(a.t - 7 * DAY), m1: ch(addMonths(a.t, -1)),
    ytd: ch(Date.UTC(new Date(a.t).getUTCFullYear() - 1, 11, 31)), y1: ch(addMonths(a.t, -12)) };
}
function renderWatch(c) {
  const b = htmlBody(c);
  if (!TICK) { b.append(el('div', { class: 'empty', text: 'Loading ticker prices… (they arrive with the next daily refresh if this is the first time).' })); c.csv = null; return; }
  const mine = getWatch().filter(id => S[id]);
  const q = (state.watchQ || '').trim().toUpperCase().replace(/^\$/, '');
  const add = el('input', { type: 'search', placeholder: 'Find a ticker: $AAPL, 1155.KL, Maybank, DBS, Tencent…', value: state.watchQ || '', 'aria-label': 'Find a ticker', class: 'perf-search wide-search' });
  add.addEventListener('input', () => { state.watchQ = add.value; const pos = add.selectionStart; renderWatch(c); const n = c.root.querySelector('.wide-search'); n.focus(); n.setSelectionRange(pos, pos); });
  const edit = `https://github.com/${REPO_PATH}/edit/main/watchlist.txt`;
  b.append(el('div', { class: 'perf-bar' }, add, el('span', { class: 'muted small' }, 'Not listed? Add it to ', el('a', { href: edit, target: '_blank', rel: 'noopener', text: 'watchlist.txt on GitHub' }), ' (one ticker per line; it appears after the next daily refresh).')));
  const all = Object.values(TICK_SYM);
  const match = id => !q || S[id].sym.toUpperCase().includes(q) || S[id].short.toUpperCase().includes(q);
  const tbl = el('table', { class: 'perf watch' });
  const heads = ['', 'Ticker', 'Name', 'Last', '1D', '1W', '1M', 'YTD', '1Y', '3M', ''];
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i === 1 || i === 2 ? 'l' : '' })))));
  const tb = el('tbody'), pos = tok('--pos'), neg = tok('--neg'), csv = [['Ticker', 'Name', 'Currency', 'Last', '1D %', '1W %', '1M %', 'YTD %', '1Y %']];
  const heat = (v, sc) => v == null ? '' : `background:${hexA(v > 0 ? pos : neg, Math.min(1, Math.abs(v) / sc) * 0.42)}`;
  const pc = v => v == null ? '–' : (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v), 1) + '%';
  const group = (name, ids, open) => {
    const rows = ids.map(id => tickRow(id)).filter(Boolean); if (!rows.length) return;
    tb.append(el('tr', { class: 'grp' }, el('td', { colspan: heads.length, text: name })));
    for (const r of rows) {
      const on = mine.includes(r.id);
      const starB = el('button', { type: 'button', class: 'star-b' + (on ? ' on' : ''), text: on ? '★' : '☆', title: on ? 'Remove from my watchlist' : 'Add to my watchlist',
        onclick: ev => { ev.stopPropagation(); const l = getWatch(); setWatch(on ? l.filter(x => x !== r.id) : [...l, r.id]); renderWatch(c); } });
      const ideaB = el('button', { type: 'button', class: 'ghost', text: '＋ Idea', title: 'Log an idea on this ticker', onclick: ev => { ev.stopPropagation(); openIdeaForm(null, r.id); } });
      tb.append(el('tr', { class: 'row' + (state.watchSel === r.id ? ' sel' : ''), onclick: () => { state.watchSel = r.id; cards.idea_chart.render(); renderWatch(c); } },
        el('td', {}, starB), el('td', { class: 'l', text: r.s.sym }), el('td', { class: 'l nm', text: r.s.short + (r.s.stale ? ' (stale)' : '') }),
        el('td', { text: fmtNum(r.last, autoDec(r.last)) + ' ' + (r.s.ccy || '') }),
        ...[[r.d1, 3], [r.w1, 6], [r.m1, 10], [r.ytd, 25], [r.y1, 30]].map(([v, sc]) => el('td', { class: 'heat', style: heat(v, sc), text: pc(v) })),
        el('td', {}, sparkSVG(r.s, addMonths(r.t, -3), r.t) || ''), el('td', {}, ideaB)));
      csv.push([r.s.sym, r.s.short, r.s.ccy, r.last, ...[r.d1, r.w1, r.m1, r.ytd, r.y1].map(v => v == null ? '' : v.toFixed(2))]);
    }
    if (!open) { /* folded groups are handled by foldableGroups */ }
  };
  if (!q) group(`★ My watchlist (${mine.length})`, mine, true);
  const pool = all.filter(match);
  for (const m of TICK_ORDER) group(m + (q ? '' : ''), pool.filter(id => tickMarket(id) === m).sort((x, y) => S[x].short.localeCompare(S[y].short)), !!q);
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  if (!q) {   // first visit: fold the big market groups, keep "My watchlist" and Malaysia open
    let first = false; try { first = !localStorage.getItem('sd-watch-folds'); localStorage.setItem('sd-watch-folds', '1'); } catch (e) { first = !state.watchFoldsDone; }
    if (first) { state.watchFoldsDone = true; TICK_ORDER.filter(m => m !== 'Malaysia (Bursa)' && m !== 'Added in watchlist.txt').forEach(m => folded.add('watch|' + m)); saveFolded(); }
  }
  foldableGroups(tb, q ? 'watchq' : 'watch');
  if (!mine.length && !q) b.prepend(el('p', { class: 'muted small', text: 'Tip: tap ☆ to add a ticker to your watchlist (kept only in this browser). Groups below fold and unfold; tap a row to chart it.' }));
  c.csv = csv;
  setNote(c, `${all.length} tickers with daily closes from Yahoo Finance (built-in list: KLCI and STI constituents, US large caps, popular ETFs, key Hong Kong, Japan, Korea, Taiwan and Australia names, major crypto${(TICK.watchlist || []).length ? `; plus ${TICK.watchlist.length} from watchlist.txt` : ''}). Prices are last daily closes in each ticker's own currency, refreshed twice a day; not live quotes.` + ((TICK.failed || []).length ? ` Not found on Yahoo: ${TICK.failed.join(', ')}.` : ''));
}
function buildIdeas() {
  loadIdeas();
  const panel = $('#tab-ideas');
  const newBtn = el('button', { type: 'button', class: 'primary', text: '＋ New idea', onclick: () => openIdeaForm() });
  const exp = el('button', { type: 'button', class: 'ghost', text: 'Export', title: 'Download all ideas as a file (back-up, or to move to another laptop)', onclick: () => {
    const blob = new Blob([JSON.stringify({ app: 'strategist-dashboard', version: 1, exported: new Date().toISOString(), ideas: IDEAS }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); download(url, `idea-log_${iso(Date.now())}.json`); setTimeout(() => URL.revokeObjectURL(url), 2000); } });
  const file = el('input', { type: 'file', accept: '.json,application/json', hidden: true });
  file.addEventListener('change', async () => {
    const f = file.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text()), list = Array.isArray(j) ? j : j.ideas;
      if (!Array.isArray(list)) throw new Error('no ideas in file');
      const have = new Set(IDEAS.map(x => x.id)); let n = 0;
      for (const x of list) if (x && x.id && x.title && !have.has(x.id)) { IDEAS.push(x); n++; }
      saveIdeas(); alert(`Imported ${n} idea${n === 1 ? '' : 's'} (${list.length - n} already here).`); renderIdeas();
    } catch (e) { alert('Could not read that file: ' + e.message); }
    file.value = '';
  });
  const imp = el('button', { type: 'button', class: 'ghost', text: 'Import', title: 'Add ideas from an exported file (existing ideas are kept)', onclick: () => file.click() });
  const csv = el('button', { type: 'button', class: 'ghost', text: 'CSV', title: 'Download the ideas as a spreadsheet', onclick: () => downloadCSV(ideaCsv(), 'idea-log') });
  panel.append(el('div', { class: 'controls idea-bar' }, newBtn, exp, imp, csv, file, el('span', { class: 'muted small', id: 'ideaStoreNote' })),
    el('div', { id: 'ideaForm', class: 'card idea-form', hidden: true }));
  const nav = el('div', { class: 'subtabs', role: 'tablist', 'aria-label': 'Ideas' });
  IDEA_VIEWS.forEach(([lab], i) => nav.append(el('button', { type: 'button', role: 'tab', text: lab, 'data-i': i, onclick: () => { state.sub.ideas = i; renderTab(); } })));
  const g = el('div', { class: 'grid' });
  panel.append(nav, g);
  makeCard(g, { key: 'idea_table', range: false, title: 'Ideas', wide: true, render: renderIdeaTable });
  makeCard(g, { key: 'idea_chart', title: 'Idea chart', wide: true, render: renderIdeaChart });
  makeCard(g, { key: 'idea_score', range: false, title: 'Scorecard', wide: true, render: renderIdeaScore });
  makeCard(g, { key: 'idea_watch', range: false, title: 'Watchlist and ticker prices', wide: true, render: renderWatch });
  g.prepend(cards.idea_watch.root);
  for (const k of ['idea_table', 'idea_score', 'idea_watch']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
}
function renderIdeas() {
  const panel = $('#tab-ideas'), cur = state.sub.ideas || 0, view = IDEA_VIEWS[cur][1];
  panel.querySelectorAll('.subtabs button').forEach(b => b.setAttribute('aria-selected', +b.dataset.i === cur));
  $('#ideaStoreNote').textContent = ideaStoreOk
    ? `${IDEAS.length} idea${IDEAS.length === 1 ? '' : 's'}, stored only in this browser on this computer. Nothing is uploaded. Use Export to back up or move them to another laptop.`
    : '⚠ This browser is blocking storage (private window or a work policy?), so ideas will be lost when you close the page. Use Export before leaving.';
  cards.idea_table.root.hidden = view === 'score' || view === 'watch';
  cards.idea_watch.root.hidden = view !== 'watch';
  cards.idea_chart.root.hidden = view === 'score' || (view === 'watch' ? !state.watchSel : !IDEAS.some(x => x.sid));
  cards.idea_score.root.hidden = view !== 'score';
  if (view === 'watch') cards.idea_watch.render();
  else if (view !== 'score') cards.idea_table.render();
  else cards.idea_score.render();
  if (!cards.idea_chart.root.hidden) cards.idea_chart.render();
}
function ideaCsv() {
  const h = ['Opened', 'Idea', 'Instrument', 'Direction', 'Entry', 'Target', 'Stop', 'Horizon', 'Conviction', 'Theme', 'Status', 'Closed', 'Exit', 'P&L', 'Rationale', 'Close note'];
  return [h, ...IDEAS.map(x => { const p = ideaPerf(x); return [x.date, x.title, x.sid ? S[x.sid] ? S[x.sid].label : x.sid : '', x.sid ? (ideaDirs(x.sid).find(d => d[0] === x.dir) || ['', ''])[1] : '',
    x.entry ?? '', x.target ?? '', x.stop ?? '', x.horizon || '', x.conv || '', x.theme || '', x.status, x.closeDate || '', x.closeLevel ?? '', p ? fmtPnl(p) : '', x.why || '', x.closeNote || '']; })];
}
function openIdeaForm(edit = null, preset = null) {
  const box = $('#ideaForm'); box.replaceChildren(); box.hidden = false;
  const x = edit || { id: 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), date: iso(sgToday()), status: 'open', conv: 2 };
  const ids = allIdsSorted().filter(id => !/_YOYc$|^MYR_IN_/.test(id)).sort((p, q) => (S[p].group === 'Tickers') - (S[q].group === 'Tickers'));
  const dl = el('datalist', { id: 'ideaSeries' }, ...ids.map(id => el('option', { value: `${S[id].label} · ${id}` })));
  const f = (lab, input, hint) => el('label', { class: 'if-field' }, el('span', { class: 'if-lab', text: lab }), input, hint ? el('span', { class: 'muted small', text: hint }) : '');
  const title = el('input', { type: 'text', value: x.title || '', placeholder: 'e.g. Long KLCI on BNM hold and earnings recovery', required: true });
  const pre = preset || x.sid;
  const inst = el('input', { type: 'text', list: 'ideaSeries', value: pre && S[pre] ? `${S[pre].label} · ${pre}` : '', placeholder: 'Type to search: $AAPL, 1155.KL, Maybank, KLCI, UST 10Y, USD/MYR, gold… (or leave blank for a view)' });
  const dir = el('select', {});
  const date = el('input', { type: 'date', value: x.date, max: iso(sgToday()) });
  const entry = el('input', { type: 'number', step: 'any', value: x.entry ?? '' }), target = el('input', { type: 'number', step: 'any', value: x.target ?? '' }), stop = el('input', { type: 'number', step: 'any', value: x.stop ?? '' });
  const horizon = el('input', { type: 'date', value: x.horizon || '' });
  const conv = el('select', {}, ...[[1, '★ Low'], [2, '★★ Medium'], [3, '★★★ High']].map(([v, l]) => el('option', { value: v, text: l })));
  conv.value = x.conv || 2;
  const theme = el('input', { type: 'text', value: x.theme || '', placeholder: 'e.g. Fed, Malaysia, AI, carry', list: 'ideaThemes' });
  const themes = el('datalist', { id: 'ideaThemes' }, ...[...new Set(IDEAS.map(i => i.theme).filter(Boolean))].map(t => el('option', { value: t })));
  const why = el('textarea', { rows: 3, placeholder: 'Rationale, catalysts, what would make you wrong' }); why.value = x.why || '';
  const info = el('span', { class: 'muted small' });
  const sidOf = () => { const m = inst.value.match(/·\s*([A-Za-z0-9_]+)\s*$/); return m && S[m[1]] ? m[1] : (S[inst.value.trim()] ? inst.value.trim() : tickerFromText(inst.value)); };
  const sync = () => {
    const sid = sidOf(), prev = dir.value;
    dir.replaceChildren(...(sid ? ideaDirs(sid) : [['up', 'Bullish / up'], ['down', 'Bearish / down']]).map(([v, l]) => el('option', { value: v, text: l })));
    dir.value = prev || x.dir || 'up'; if (!dir.value) dir.selectedIndex = 0;
    if (sid) { const a = asOf(S[sid], dayMs(date.value || iso(sgToday())));
      entry.placeholder = a ? String(+a.v.toFixed(4)) : ''; info.textContent = a ? `${S[sid].label} was ${ideaLevel({ sid }, a.v)} on ${nice(a.t)}. Leave Entry blank to use it.` : 'No price on that date.'; }
    else { entry.placeholder = ''; info.textContent = inst.value ? (TICK ? 'Not a tracked series or ticker yet: logged as a view. To track a new ticker, add it to watchlist.txt (see the Watchlist tab).' : 'Ticker prices are still loading…') : 'No instrument: logged as a view (no automatic tracking).'; }
  };
  inst.addEventListener('change', sync); inst.addEventListener('input', sync); date.addEventListener('change', sync);
  const save = el('button', { type: 'submit', class: 'primary', text: edit ? 'Save changes' : 'Add idea' });
  const cancel = el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: () => { box.hidden = true; box.replaceChildren(); } });
  const form = el('form', { class: 'if-grid' },
    el('h2', { class: 'if-wide', text: edit ? 'Edit idea' : 'New idea' }),
    el('div', { class: 'if-wide' }, f('Idea', title)),
    el('div', { class: 'if-wide' }, f('Instrument (dashboard series)', inst), info),
    f('Direction', dir), f('Opened', date), f('Entry level', entry), f('Target', target), f('Stop', stop), f('Review by', horizon, 'optional'), f('Conviction', conv), f('Theme', theme),
    el('div', { class: 'if-wide' }, f('Rationale', why)), el('div', { class: 'if-wide if-actions' }, save, cancel), dl, themes);
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!title.value.trim()) { title.focus(); return; }
    const sid = sidOf(), num = el_ => el_.value === '' ? null : +el_.value;
    let ent = num(entry);
    if (ent == null && sid) { const a = asOf(S[sid], dayMs(date.value)); ent = a ? +a.v.toFixed(6) : null; }
    const up = dir.value !== 'down', tg = num(target), st = num(stop), bad = [];
    if (ent != null && tg != null && (up ? tg <= ent : tg >= ent)) bad.push(`the target (${tg}) is ${up ? 'not above' : 'not below'} the entry (${+ent.toFixed(4)})`);
    if (ent != null && st != null && (up ? st >= ent : st <= ent)) bad.push(`the stop (${st}) is ${up ? 'not below' : 'not above'} the entry (${+ent.toFixed(4)})`);
    if (bad.length && !confirm(`Check the levels for “${dir.selectedOptions[0].text}”: ${bad.join(' and ')}. Save anyway?`)) return;
    Object.assign(x, { title: title.value.trim(), sid, sidText: sid ? null : inst.value.trim() || null, dir: dir.value, date: date.value || iso(sgToday()), entry: ent, target: num(target), stop: num(stop),
      horizon: horizon.value || null, conv: +conv.value, theme: theme.value.trim() || null, why: why.value.trim() || null, updated: new Date().toISOString() });
    if (!edit) IDEAS.push(x);
    saveIdeas(); box.hidden = true; box.replaceChildren(); state.ideaSel = x.id; state.sub.ideas = 0; renderTab();
  });
  box.append(form); sync(); title.focus();
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function closeIdea(x) {
  const p = ideaPerf(x);
  const box = $('#ideaForm'); box.replaceChildren(); box.hidden = false;
  const date = el('input', { type: 'date', value: iso(sgToday()), max: iso(sgToday()) });
  const lvl = el('input', { type: 'number', step: 'any', placeholder: p ? String(+p.level.toFixed(4)) : '' });
  const note = el('textarea', { rows: 2, placeholder: 'What happened, what you learned' });
  const form = el('form', { class: 'if-grid' }, el('h2', { class: 'if-wide', text: `Close: ${x.title}` }),
    el('label', { class: 'if-field' }, el('span', { class: 'if-lab', text: 'Closed on' }), date),
    el('label', { class: 'if-field' }, el('span', { class: 'if-lab', text: 'Exit level' }), lvl, el('span', { class: 'muted small', text: x.sid ? 'Blank = the dashboard level on that date' : '' })),
    el('div', { class: 'if-wide' }, el('label', { class: 'if-field' }, el('span', { class: 'if-lab', text: 'Note' }), note)),
    el('div', { class: 'if-wide if-actions' }, el('button', { type: 'submit', class: 'primary', text: 'Close idea' }), el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: () => { box.hidden = true; } })));
  form.addEventListener('submit', e => {
    e.preventDefault();
    let v = lvl.value === '' ? null : +lvl.value;
    if (v == null && x.sid && S[x.sid]) { const a = asOf(S[x.sid], dayMs(date.value)); v = a ? a.v : null; }
    Object.assign(x, { status: 'closed', closeDate: date.value, closeLevel: v, closeNote: note.value.trim() || null, updated: new Date().toISOString() });
    saveIdeas(); box.hidden = true; renderTab();
  });
  box.append(form); box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function renderIdeaTable(c) {
  const b = htmlBody(c), view = IDEA_VIEWS[state.sub.ideas || 0][1];
  const list = IDEAS.filter(x => (view === 'open') === (x.status !== 'closed')).sort((p, q) => q.date.localeCompare(p.date));
  c.titleEl.textContent = view === 'open' ? `Open ideas (${list.length})` : `Closed ideas (${list.length})`;
  c.subEl.textContent = view === 'open' ? 'Tracked against the latest dashboard prices. Click a row to chart it.' : 'Exit levels as entered, or the dashboard level on the close date.';
  if (!list.length) {
    b.append(el('div', { class: 'empty', text: view === 'open' ? 'No open ideas yet. Use “＋ New idea” to log one: pick an instrument from the dashboard and it is tracked automatically.' : 'No closed ideas yet.' }));
    c.csv = null; return;
  }
  const tbl = el('table', { class: 'perf ideas' });
  const heads = ['Opened', 'Idea', 'Instrument', 'Entry', view === 'open' ? 'Now' : 'Exit', 'P&L', 'Stop → target', view === 'open' ? 'Review by' : 'Closed', ''];
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i === 1 || i === 2 || i === 6 ? 'l' : '' })))));
  const tb = el('tbody'), pos = tok('--pos'), neg = tok('--neg'), today = sgToday();
  for (const x of list) {
    const p = ideaPerf(x), hit = ideaHits(x), pr = ideaProgress(x, p), s = x.sid && S[x.sid];
    const dirTxt = s ? (ideaDirs(x.sid).find(d => d[0] === x.dir) || ['', ''])[1].split(' (')[0] : x.dir === 'down' ? 'Bearish' : 'Bullish';
    const bar = pr == null ? el('span', { class: 'muted small', text: x.target != null ? `target ${ideaLevel(x, x.target)}` : '–' })
      : el('div', { class: 'pbar2', title: `stop ${ideaLevel(x, x.stop)} · target ${ideaLevel(x, x.target)}` }, el('i', { style: `left:${(Math.max(0, Math.min(1, pr)) * 100).toFixed(0)}%` }));
    const flag = hit ? el('span', { class: 'flag ' + hit.what, text: hit.what === 'target' ? `✓ target hit ${dShort(hit.t)}` : `✕ stop hit ${dShort(hit.t)}` }) : '';
    const due = x.horizon && view === 'open' && dayMs(x.horizon) < today ? el('span', { class: 'flag stop', text: 'review due' }) : '';
    const actions = el('td', { class: 'acts' },
      el('button', { type: 'button', class: 'ghost', text: 'Edit', onclick: ev => { ev.stopPropagation(); openIdeaForm(x); } }),
      view === 'open' ? el('button', { type: 'button', class: 'ghost', text: 'Close', onclick: ev => { ev.stopPropagation(); closeIdea(x); } })
        : el('button', { type: 'button', class: 'ghost', text: 'Reopen', onclick: ev => { ev.stopPropagation(); Object.assign(x, { status: 'open', closeDate: null, closeLevel: null }); saveIdeas(); renderTab(); } }),
      el('button', { type: 'button', class: 'ghost', text: '✕', title: 'Delete', onclick: ev => { ev.stopPropagation(); if (confirm(`Delete “${x.title}”? This cannot be undone (unless you exported a back-up).`)) { IDEAS = IDEAS.filter(i => i !== x); saveIdeas(); renderTab(); } } }));
    const tr = el('tr', { class: 'row' + (state.ideaSel === x.id ? ' sel' : ''), onclick: () => { state.ideaSel = x.id; renderIdeas(); } },
      el('td', { text: dShort(dayMs(x.date)) + ' ' + String(new Date(dayMs(x.date)).getUTCFullYear()).slice(2) }),
      el('td', { class: 'idea-t' }, el('div', {}, el('b', { text: x.title }), ' ', el('span', { class: 'star', text: '★'.repeat(x.conv || 0) })),
        el('div', { class: 'muted small', text: [dirTxt, x.theme].filter(Boolean).join(' · ') }), x.why ? el('div', { class: 'small why', text: x.why }) : '',
        x.closeNote ? el('div', { class: 'small why', text: 'Closed: ' + x.closeNote }) : ''),
      el('td', { class: 'l', text: s ? s.label : x.sidText || 'view' }),
      el('td', { text: ideaLevel(x, x.entry) }),
      el('td', { text: p ? ideaLevel(x, p.level) : '–' }),
      el('td', { class: 'heat', style: p ? `background:${hexA(p.val >= 0 ? pos : neg, Math.min(1, Math.abs(p.unit === '%' ? p.val / 10 : p.unit === 'bp' ? p.val / 75 : p.val / Math.max(1e-9, Math.abs(x.entry) * 0.1))) * 0.42)}` : '', text: fmtPnl(p) }),
      el('td', { class: 'l' }, bar, flag, due),
      el('td', { text: view === 'open' ? (x.horizon ? dShort(dayMs(x.horizon)) : '–') : (x.closeDate ? dShort(dayMs(x.closeDate)) : '–') }),
      actions);
    tb.append(tr);
  }
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = ideaCsv();
  setNote(c, 'P&L: % for prices (no dividends, carry or FX), bp for yields and spreads (positive when the yield moves your way). The stop → target bar shows where the latest level sits between your stop (left) and target (right). Target/stop flags use daily closes since the idea was opened.');
}
function renderIdeaChart(c) {
  if (IDEA_VIEWS[state.sub.ideas || 0][1] === 'watch') {
    const id = state.watchSel; if (!id || !S[id]) return setEmpty(c, 'Tap a ticker to chart it.');
    const s = S[id]; c.titleEl.textContent = `${s.short} (${s.sym})`; c.subEl.textContent = `Daily close, ${s.ccy || 'local currency'}. ${s.exch || ''}`;
    const [from, to] = c.range ? [state.from, state.to] : [addMonths(state.latest, -12), state.latest];
    const keep = [state.from, state.to]; [state.from, state.to] = [from, to];
    drawLines(c, [{ name: s.label, data: pts(s, from, to) }], { fmt: v => fmtNum(v, autoDec(v)) + ' ' + (s.ccy || ''), axisFmt: v => fmtNum(v, autoDec(v)), endLabels: false });
    [state.from, state.to] = keep;
    setSource(c, `Yahoo Finance (${s.sym})`); setNote(c, 'Last 12 months by default; use the range buttons or drag to zoom. Up to about 3 years of history.'); return;
  }
  const x = IDEAS.find(i => i.id === state.ideaSel && i.sid) || IDEAS.filter(i => i.sid && i.status !== 'closed').sort((p, q) => q.date.localeCompare(p.date))[0] || IDEAS.find(i => i.sid);
  if (!x || !S[x.sid]) return setEmpty(c, 'Add an idea with a dashboard instrument to chart it.');
  const s = S[x.sid], a = dayMs(x.date), end = x.status === 'closed' && x.closeDate ? dayMs(x.closeDate) : state.latest;
  const from = c.range ? state.from : addMonths(a, -3), to = c.range ? state.to : Math.max(end, state.latest);
  c.titleEl.textContent = `Idea chart: ${x.title}`;
  c.subEl.textContent = `${s.label} from 3 months before the idea. Entry, target and stop shown as lines.`;
  const hl = [{ y: x.entry, label: `entry ${ideaLevel(x, x.entry)}` }];
  if (x.target != null) hl.push({ y: x.target, label: `target ${ideaLevel(x, x.target)}`, color: tok('--good') });
  if (x.stop != null) hl.push({ y: x.stop, label: `stop ${ideaLevel(x, x.stop)}`, color: tok('--critical') });
  const keep = [state.from, state.to]; [state.from, state.to] = [from, to];
  drawLines(c, [{ name: s.label, data: pts(s, from, to) }], { fmt: v => ideaLevel(x, v), axisFmt: v => ideaLevel(x, v).replace(/\.0+%$/, '%'), endLabels: false, hlines: hl,
    areas: [[a, end, hexA(tok('--accent'), 0.08), 'idea open']], yExtra: { min: v => Math.min(v.min, ...hl.map(h => h.y)), max: v => Math.max(v.max, ...hl.map(h => h.y)) } });
  [state.from, state.to] = keep;
  setSource(c, srcOf([x.sid]));
  const p = ideaPerf(x);
  setNote(c, `${x.status === 'closed' ? 'Closed' : 'Open'} since ${nice(a)}${p ? `: ${fmtPnl(p)}` : ''}. Click another row in the table to chart it.`);
}
function renderIdeaScore(c) {
  const b = htmlBody(c), closed = IDEAS.filter(x => x.status === 'closed'), open = IDEAS.filter(x => x.status !== 'closed');
  if (!IDEAS.length) { b.append(el('div', { class: 'empty', text: 'The scorecard fills in as you log and close ideas.' })); c.csv = null; return; }
  const stat = (list) => {
    const ps = list.map(x => ({ x, p: ideaPerf(x) })).filter(r => r.p);
    const wins = ps.filter(r => r.p.val > 0).length;
    const pct = ps.filter(r => r.p.unit === '%').map(r => r.p.val), bps = ps.filter(r => r.p.unit === 'bp').map(r => r.p.val);
    const avg = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
    return { n: list.length, tracked: ps.length, hit: ps.length ? wins / ps.length * 100 : null, pct: avg(pct), bps: avg(bps), best: ps.sort((p, q) => q.p.val - p.p.val)[0] };
  };
  const row = (lab, st) => el('tr', { class: 'row' }, el('td', { text: lab }), el('td', { text: String(st.n) }), el('td', { text: st.hit == null ? '–' : fmtNum(st.hit, 0) + '%' }),
    el('td', { text: st.pct == null ? '–' : (st.pct >= 0 ? '+' : '−') + fmtNum(Math.abs(st.pct), 1) + '%' }), el('td', { text: st.bps == null ? '–' : bp(st.bps) }));
  const tbl = el('table', { class: 'perf' });
  tbl.append(el('thead', {}, el('tr', {}, ...['Group', 'Ideas', 'Hit rate', 'Avg P&L (price ideas)', 'Avg P&L (rates ideas)'].map(h => el('th', { text: h })))));
  const tb = el('tbody');
  tb.append(el('tr', { class: 'grp' }, el('td', { colspan: 5, text: 'Overall' })), row('Closed ideas', stat(closed)), row('Open ideas (mark-to-market)', stat(open)));
  tb.append(el('tr', { class: 'grp' }, el('td', { colspan: 5, text: 'By conviction (all ideas)' })));
  for (const k of [3, 2, 1]) { const l = IDEAS.filter(x => (x.conv || 2) === k); if (l.length) tb.append(row('★'.repeat(k), stat(l))); }
  const themes = [...new Set(IDEAS.map(x => x.theme).filter(Boolean))];
  if (themes.length) { tb.append(el('tr', { class: 'grp' }, el('td', { colspan: 5, text: 'By theme (all ideas)' }))); for (const t of themes) tb.append(row(t, stat(IDEAS.filter(x => x.theme === t)))); }
  const ta = stat(IDEAS.filter(x => ideaHits(x)));
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  const hits = IDEAS.map(ideaHits).filter(Boolean);
  setNote(c, `Hit rate = share of tracked ideas with positive P&L. ${hits.filter(h => h.what === 'target').length} idea(s) reached their target and ${hits.filter(h => h.what === 'stop').length} their stop at some point. Ideas without a dashboard instrument count in “Ideas” but not in the P&L figures.` + (ta.n ? '' : ''));
  c.csv = ideaCsv();
}

// ------------------------------------------------------------------ WEEKLY ONE-PAGE BRIEF
// Built from the data already on the dashboard, for the week ending on a Friday. Prints to one A4 page.
const WK_ROWS = [
  ['Equities', ['SPX', 'NDX', 'SX5E', 'NKY', 'CSI300', 'HSI', 'KOSPI', 'STI', 'KLCI', 'AS51']],
  ['Rates & credit', ['UST2Y', 'UST10Y', 'REAL10Y', 'JGB10Y', 'SGS10Y', 'AU_10Y', 'HY_OAS']],
  ['FX', ['DXY', 'EURUSD', 'USDJPY', 'USDCNY', 'USDSGD', 'USDMYR', 'AUDUSD']],
  ['Commodities & crypto', ['GOLD', 'BRENT', 'COPPER', 'BTC']],
  ['Volatility', ['VIX', 'MOVE']],
];
state.weekEnd = null;
function lastFriday(t) { const d = new Date(t).getUTCDay(); return t - ((d + 2) % 7) * DAY; }   // Friday on or before t
function wkChange(id, end) {
  const s = S[id], a = asOf(s, end); if (!a) return null;
  const b = asOf(s, end - 7 * DAY), y = asOf(s, Date.UTC(new Date(end).getUTCFullYear() - 1, 11, 31));
  return { s, a, w: b && b.t < a.t ? chg(s, b.v, a.v) : null, ytd: y ? chg(s, y.v, a.v) : null };
}
function wkTakeaways(end) {
  const out = [], pct = (r) => r && r.w != null ? fmtChg(r.s, r.w) : '–';
  const eq = ['SPX', 'SX5E', 'NKY', 'CSI300', 'HSI', 'KOSPI', 'STI', 'KLCI', 'AS51'].filter(id => has(id)).map(id => ({ id, r: wkChange(id, end) })).filter(x => x.r && x.r.w != null).sort((a, b) => b.r.w - a.r.w);
  if (eq.length) {
    const spx = wkChange('SPX', end);
    out.push(`Equities: S&P 500 ${pct(spx)} on the week (${spx && spx.ytd != null ? fmtChg(spx.s, spx.ytd) : '–'} YTD). Best of the majors ${S[eq[0].id].label} ${fmtChg(eq[0].r.s, eq[0].r.w)}; worst ${S[eq[eq.length - 1].id].label} ${fmtChg(eq[eq.length - 1].r.s, eq[eq.length - 1].r.w)}. Malaysia's KLCI ${pct(wkChange('KLCI', end))}, Singapore's STI ${pct(wkChange('STI', end))}.`);
  }
  if (has('UST10Y')) { const t10 = wkChange('UST10Y', end), t2 = has('UST2Y') ? wkChange('UST2Y', end) : null;
    out.push(`Rates: UST 10Y ${fmtNum(t10.a.v, 2)}% (${pct(t10)})` + (t2 ? `, 2Y ${fmtNum(t2.a.v, 2)}% (${pct(t2)})` : '') + (has('REAL10Y') ? `, 10Y real ${fmtNum(asOf(S.REAL10Y, end).v, 2)}%` : '') + '.'); }
  const now = fpSnap('now');
  if (now && now.path.length && FP.contracts) {
    const n = now.path[0], k = Object.keys(FP.contracts).filter(x => x.endsWith('-12')).sort().pop(), c = k && FP.contracts[k];
    let t = `Fed: futures price ${n.odds.replace(' ~100%', '')} at the ${dShort(dayMs(n.d))} FOMC`;
    if (c) { const ser = { t: c.d.map(dayMs), v: c.v }, a = asOf(ser, end), b = asOf(ser, end - 7 * DAY);
      if (a) t += `; the Dec ${k.slice(0, 4)} contract implies ${fmtNum(a.v, 2)}%` + (b ? ` (${bp((a.v - b.v) * 100)} on the week)` : ''); }
    const med = FP.dots && FP.dots.median && k && FP.dots.median[k.slice(0, 4)];
    if (med != null) t += ` vs the Fed's ${fmtNum(med, 2)}% median`;
    out.push(t + '.');
  }
  { cbPrep(); const g = Object.keys(CBS).map(k => { const a = cbStats(k, end), b = cbStats(k, end - 7 * DAY);
      return a && b && a.spread && b.spread ? { k, a, w: a.spread.v - b.spread.v } : null; }).filter(Boolean).sort((x, y) => Math.abs(y.w) - Math.abs(x.w));
    if (g.length) out.push(`Central banks: biggest move in market pricing was ${CBS[g[0].k].short} (${CBS[g[0].k].gaugeLab} ${bp(g[0].a.spread.v)}, ${bp(g[0].w)} on the week; read: ${g[0].a.read.toLowerCase()}). Others: ${g.slice(1).map(x => `${CBS[x.k].short} ${x.a.read.toLowerCase()}`).join(', ')}.`); }
  if (has('DXY')) { const d = wkChange('DXY', end), m = has('USDMYR') ? wkChange('USDMYR', end) : null, g = has('USDSGD') ? wkChange('USDSGD', end) : null;
    out.push(`FX: DXY ${pct(d)}` + (m ? `; USD/MYR ${fmtNum(m.a.v, 4)} (${pct(m)})` : '') + (g ? `; USD/SGD ${fmtNum(g.a.v, 4)} (${pct(g)})` : '') + (has('USDJPY') ? `; USD/JPY ${fmtNum(asOf(S.USDJPY, end).v, 2)}` : '') + '.'); }
  const cm = ['BRENT', 'GOLD', 'COPPER'].filter(id => has(id)).map(id => `${S[id].label} ${pct(wkChange(id, end))}`);
  if (cm.length) out.push(`Commodities: ${cm.join(', ')}.`);
  const keep = state.to; state.to = end;
  const mv = movers(1).filter(r => Math.abs(r.z) >= 2).slice(0, 3);
  state.to = keep;
  if (mv.length) out.push(`Unusual moves (≥2σ vs 5-year norm): ${mv.map(r => `${S[r.id].label} ${fmtMove(S[r.id], r.chg)} (${zf(r.z)}σ)`).join('; ')}.`);
  { const wc = whatChanged(end).filter(x => x.pri <= 2 && x.tab !== 'markets' && x.tab !== 'cbwatch').slice(0, 3); if (wc.length) out.push('What changed: ' + wc.map(x => x.text.replace(/\.$/, '')).join('; ') + '.'); }
  if (has('REG_QUAD')) { const q = asOf(S.REG_QUAD, end); let t = `Macro regime: ${QUADS[q.v].name} (${monthLab(q.t)} data)`;
    if (has('STRESS_COMPOSITE')) { const a = asOf(S.STRESS_COMPOSITE, end); t += `; stress composite ${Math.round(a.v)}th percentile (${legacyBand(a.v)[0].toLowerCase()})`; }
    out.push(t + '.'); }
  return out;
}
function wkTiles(end) {
  const out = [];
  const add = (label, val, foot, tk) => out.push({ label, val, foot, tk });
  if (has('REG_QUAD')) { const q = asOf(S.REG_QUAD, end); add('Macro regime', QUADS[q.v].name, monthLab(q.t) + ' data', null); }
  if (has('STRESS_COMPOSITE')) { const a = asOf(S.STRESS_COMPOSITE, end), b = asOf(S.STRESS_COMPOSITE, end - 28 * DAY), [bl, tk] = legacyBand(a.v); add('Stress composite', `${Math.round(a.v)} · ${bl}`, b ? `4w ${sign(a.v - b.v)}${fmtNum(Math.abs(a.v - b.v), 0)}` : '', tk); }
  if (SIGN) { const n = SIGN.n_peaks, cols = SIGN.columns; let j = cols.length - 1; while (j > n && SIGN.share[j] == null) j--; if (SIGN.share[j] != null) add('Peak signposts', `${fmtNum(SIGN.share[j], 0)}% triggered`, cols[j], null); }
  if (has('REC_PROB_NYF')) { const a = asOf(S.REC_PROB_NYF, end); add('Recession odds (12m)', fmtNum(a.v, 0) + '%', 'NY Fed curve model', null); }
  const now = fpSnap('now');
  if (FP && FP.target && FP.target[0] != null) add('Fed funds target', `${fmtNum(FP.target[0], 2)}–${fmtNum(FP.target[1], 2)}%`, now && now.path.length ? `next ${dShort(dayMs(now.path[0].d))}: ${now.path[0].odds.replace(' ~100%', '')}` : '', null);
  if (has('NET_LIQ')) { const s = S.NET_LIQ, a = asOf(s, end), b = asOf(s, end - 28 * DAY); add('Fed net liquidity', fmtVal(s, a.v), b ? `4w ${sign(a.v - b.v)}${fmtVal(s, Math.abs(a.v - b.v))}` : '', null); }
  if (has('VIX')) { const p = pctRank(S.VIX, end, 10); if (p) add('VIX', fmtNum(p.v, 1), `${Math.round(p.p)}th pct (10y)`, null); }
  return out;
}
function wkAsia(end) {
  const rows = [];
  const lv = (id, f) => { if (!has(id)) return null; const a = asOf(S[id], end); return a ? f(a) : null; };
  const wk = id => { const r = has(id) ? wkChange(id, end) : null; return r && r.w != null ? fmtChg(r.s, r.w) : '–'; };
  rows.push(['Malaysia', [
    lv('MY_OPR', a => `OPR ${fmtNum(a.v, 2)}%`), lv('MY_CPI_YOY', a => `CPI ${fmtNum(a.v, 1)}% (${monthLab(a.t)})`),
    has('USDMYR') ? `USD/MYR ${fmtNum(asOf(S.USDMYR, end).v, 3)} (${wk('USDMYR')} w/w)` : null, has('KLCI') ? `KLCI ${wk('KLCI')} w/w` : null].filter(Boolean)]);
  rows.push(['Singapore', [
    lv('SORA3M', a => `3M SORA ${fmtNum(a.v, 2)}%`), lv('SG_CORE_YOY', a => `MAS core ${fmtNum(a.v, 1)}% (${monthLab(a.t)})`),
    has('USDSGD') ? `USD/SGD ${fmtNum(asOf(S.USDSGD, end).v, 4)} (${wk('USDSGD')} w/w)` : null, has('STI') ? `STI ${wk('STI')} w/w` : null].filter(Boolean)]);
  rows.push(['Australia', [
    lv('AU_CASH', a => `RBA cash ${fmtNum(a.v, 2)}%`), lv('AU_TRIM_YOY', a => `trimmed-mean CPI ${fmtNum(a.v, 1)}%`),
    has('AU_10Y') ? `10Y ${fmtNum(asOf(S.AU_10Y, end).v, 2)}% (${wk('AU_10Y')} w/w)` : null, has('AUDUSD') ? `AUD/USD ${wk('AUDUSD')} w/w` : null].filter(Boolean)]);
  rows.push(['China & Japan', [
    lv('CN_CPI_YOY', a => `China CPI ${fmtNum(a.v, 1)}%`), lv('CN_10Y', a => `CGB 10Y ${fmtNum(a.v, 2)}%`),
    lv('JP_CORE_YOY', a => `Japan core CPI ${fmtNum(a.v, 1)}%`), has('USDJPY') ? `USD/JPY ${wk('USDJPY')} w/w` : null].filter(Boolean)]);
  return rows.filter(r => r[1].length);
}
function wkAhead(end) {
  if (!CAL || !CAL.events) return [];
  const a = end + 3 * DAY, b = end + 9 * DAY;   // Monday to Sunday after the Friday
  return CAL.events.filter(e => e.hi).map(e => { const [x, y] = calSpan(e); return { e, x, y }; })
    .filter(({ x, y }) => y >= a && x <= b).map(({ e, x }) => ({ e, day: Math.max(x, a) }))
    .sort((p, q) => (p.day - q.day) || (p.e.kind === 'Policy' ? -1 : 1) || (p.e.sgt || '99').localeCompare(q.e.sgt || '99'));
}
function buildWeekly() {
  const panel = $('#tab-weekly');
  const sel = el('select', { 'aria-label': 'Week ending', id: 'wkSel' });
  sel.addEventListener('change', () => { state.weekEnd = +sel.value; renderWeekly(); });
  const copy = el('button', { class: 'ghost', type: 'button', text: 'Copy as text', title: 'Plain text for an email or chat' });
  copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(state.weekText || ''); copy.textContent = 'Copied'; setTimeout(() => copy.textContent = 'Copy as text', 1500); } catch (e) { alert(state.weekText); } });
  panel.append(el('div', { class: 'controls wk-controls' },
    el('label', {}, 'Week ending ', sel),
    el('button', { type: 'button', text: '⎙ Print / save as PDF', title: 'Prints this page only, on one A4 sheet', onclick: () => window.print() }), copy,
    el('span', { class: 'muted small', text: 'Built from this dashboard’s data. For screenshots, the page is sized to fit one A4 sheet.' })),
    el('article', { class: 'onepage', id: 'wkPage' }));
}
function renderWeekly() {
  const sel = $('#wkSel'), latest = lastFriday(state.latest);
  if (!sel.options.length) for (let k = 0; k < 12; k++) { const t = latest - k * 7 * DAY; sel.append(el('option', { value: t, text: `Fri ${dShort(t)} ${new Date(t).getUTCFullYear()}` + (k === 0 ? ' (latest)' : '') })); }
  const end = state.weekEnd || latest; sel.value = end;
  const page = $('#wkPage'); page.replaceChildren();
  const txt = [];
  // header
  page.append(el('header', { class: 'op-head' },
    el('div', {}, el('h2', { text: 'Weekly strategist brief' }), el('div', { class: 'muted', text: `Week to Friday ${dShort(end)} ${new Date(end).getUTCFullYear()} · markets, macro and the week ahead` })),
    el('div', { class: 'muted small op-asof', text: `Data as of ${nice(Math.min(end, state.latest))}` + (META.updated_utc ? ` · refreshed ${META.updated_utc}` : '') })));
  txt.push(`WEEKLY STRATEGIST BRIEF: week to Fri ${dShort(end)} ${new Date(end).getUTCFullYear()}`, '');
  // takeaways
  const tk = wkTakeaways(end);
  page.append(el('section', { class: 'op-take' }, el('h3', { text: 'Key takeaways' }), el('ul', {}, ...tk.map(t => el('li', { text: t })))));
  txt.push('KEY TAKEAWAYS', ...tk.map(t => '• ' + t), '');
  // tiles
  const tiles = wkTiles(end);
  page.append(el('section', { class: 'op-tiles' }, ...tiles.map(t => el('div', { class: 'op-tile' }, el('div', { class: 'k-label', text: t.label }),
    el('div', { class: 'op-v' }, t.tk ? el('span', { class: 'qdot', style: `background:${tok(t.tk)}` }) : '', t.val), el('div', { class: 'k-asof', text: t.foot })))));
  // two columns
  const left = el('div', { class: 'op-col' }), right = el('div', { class: 'op-col' });
  page.append(el('div', { class: 'op-cols' }, left, right));
  // scoreboard
  const tbl = el('table', { class: 'perf op-table' });
  tbl.append(el('thead', {}, el('tr', {}, ...['Asset', 'Last', '1W', 'YTD', '3M'].map(h => el('th', { text: h })))));
  const tb = el('tbody'), pos = tok('--pos'), neg = tok('--neg');
  const sc = { price: [3, 15], yield: [15, 75], level: [10, 30] };
  txt.push('SCOREBOARD (last, 1W, YTD)');
  for (const [g, ids] of WK_ROWS) {
    const ok = ids.filter(id => has(id)); if (!ok.length) continue;
    tb.append(el('tr', { class: 'grp' }, el('td', { colspan: 5, text: g })));
    for (const id of ok) {
      const r = wkChange(id, end); if (!r) continue;
      const heat = (v, k) => v == null ? '' : `background:${hexA(v > 0 ? pos : neg, Math.min(1, Math.abs(r.s.kind === 'level' ? v / Math.max(1e-9, Math.abs(r.a.v)) * 100 : v) / sc[r.s.kind][k]) * 0.42)}`;
      const last = r.s.kind === 'yield' ? fmtNum(r.a.v, 2) + '%' : fmtVal(r.s, r.a.v);
      tb.append(el('tr', { class: 'row' }, el('td', { text: r.s.label.replace(' (equity vol)', '').replace(' (rates vol)', '') }), el('td', { text: last }),
        el('td', { class: 'heat', style: heat(r.w, 0), text: fmtChg(r.s, r.w) }), el('td', { class: 'heat', style: heat(r.ytd, 1), text: fmtChg(r.s, r.ytd) }),
        el('td', {}, sparkSVG(r.s, addMonths(end, -3), end) || '')));
      txt.push(`  ${r.s.label}: ${last}, ${fmtChg(r.s, r.w)}, ${fmtChg(r.s, r.ytd)} YTD`);
    }
  }
  tbl.append(tb);
  left.append(el('section', {}, el('h3', { text: 'Cross-asset scoreboard' }), tbl,
    el('p', { class: 'muted small', text: 'Local currency. Yields and spreads in bp; VIX/MOVE in points. 1W = Friday to Friday. Shading: blue = up, red = down.' })));
  txt.push('');
  // Asia focus
  const asia = wkAsia(end);
  right.append(el('section', {}, el('h3', { text: 'Asia focus' }), el('dl', { class: 'op-asia' }, ...asia.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', { text: v.join(' · ') })]))));
  txt.push('ASIA FOCUS', ...asia.map(([k, v]) => `  ${k}: ${v.join(' · ')}`), '');
  // movers
  const keep = state.to; state.to = end; const mv = movers(1).slice(0, 6); state.to = keep;
  if (mv.length) right.append(el('section', {}, el('h3', { text: 'Most unusual moves this week' }),
    el('ul', { class: 'op-list' }, ...mv.map(r => el('li', {}, el('span', { text: S[r.id].label }), el('b', { text: `${fmtMove(S[r.id], r.chg)} · ${zf(r.z)}σ`, style: `color:${tok(r.z >= 0 ? '--pos' : '--neg')}` })))),
    el('p', { class: 'muted small', text: 'σ = size of the weekly move against that asset’s own last 5 years of weekly moves.' })));
  // week ahead
  const ah = wkAhead(end);
  const ul = el('ul', { class: 'op-list op-cal' });
  let day = null;
  for (const { e, day: d } of ah.slice(0, 16)) {
    if (d !== day) { day = d; ul.append(el('li', { class: 'op-day', text: dLong(d) })); }
    ul.append(el('li', {}, el('span', {}, el('span', { class: 'muted', text: (e.sgt || '').replace(' (+1 day)', '⁺¹') + ' ' }), `${e.region}: ${e.name}`),
      el('span', { class: 'muted', text: e.prev ? `prev ${e.prev}` : e.end ? `${dShort(calSpan(e)[0])}–${dShort(calSpan(e)[1])}` : '' })));
  }
  right.append(el('section', {}, el('h3', { text: 'Week ahead (key events, SGT)' }), ah.length ? ul : el('p', { class: 'muted small', text: 'No calendar loaded.' }),
    ah.length > 16 ? el('p', { class: 'muted small', text: `+${ah.length - 16} more on the Calendar page.` }) : ''));
  txt.push('WEEK AHEAD (SGT)', ...ah.map(({ e, day: d }) => `  ${dLong(d)} ${e.sgt || ''} ${e.region}: ${e.name}${e.prev ? ` (prev ${e.prev})` : ''}`), '');
  // the user's own open ideas (from this browser only)
  const mine = IDEAS.filter(x => x.status !== 'closed' && x.date <= iso(end));
  if (mine.length) {
    right.append(el('section', {}, el('h3', { text: 'My open ideas' }), el('ul', { class: 'op-list' }, ...mine.slice(0, 6).map(x => { const p = ideaPerf(x, end);
      return el('li', {}, el('span', { text: x.title + (x.conv ? ' ' + '★'.repeat(x.conv) : '') }), el('b', { text: p ? fmtPnl(p) : 'view', style: p ? `color:${tok(p.val >= 0 ? '--pos' : '--neg')}` : '' })); })),
      mine.length > 6 ? el('p', { class: 'muted small', text: `+${mine.length - 6} more in the Idea log.` }) : ''));
    txt.push('MY OPEN IDEAS', ...mine.map(x => { const p = ideaPerf(x, end); return `  ${x.title}: ${p ? fmtPnl(p) : 'view'}`; }), '');
  }
  // headlines
  if (NEWS && NEWS.items && end >= lastFriday(state.latest)) {
    const items = NEWS.items.slice(0, mine.length ? 3 : 5);
    right.append(el('section', { class: mine.length > 3 ? 'op-news-sec no-print' : 'op-news-sec' }, el('h3', { text: 'Headlines' }), el('ul', { class: 'op-list op-news' }, ...items.map(n => el('li', {}, el('span', { text: n.title }), el('span', { class: 'muted', text: n.source }))))));
  }
  page.append(el('footer', { class: 'op-foot muted small', text: 'Sources: Yahoo Finance, FRED (Federal Reserve, BLS, BEA, ICE BofA), US Treasury, MOF Japan, MAS/SingStat, DOSM/Bank Negara, RBA, OECD, CBOT fed funds futures, public news feeds. Generated from public data by the Strategist Dashboard; facts only, no investment advice.' }));
  state.weekText = txt.join('\n');
}

// ------------------------------------------------------------------ CENTRAL BANK WATCH
// Free market gauges for banks without fed-funds-style futures: money-market and bond-curve rates.
// Money-market rates (interbank, bank bills) carry a credit premium, so their spread to the policy rate is judged
// against its "normal" premium: the median spread in past periods when the policy rate did not change over the
// tenor's horizon. Government-curve rates (JGBs, euro AAA forwards, Australian bonds) carry little premium at short
// horizons, so their spread is read as is. Never turned into a probability.
const CBS = {
  BNM: { name: 'Bank Negara Malaysia', short: 'BNM', sub: 'BNM', policy: 'MY_OPR', policyLab: 'OPR', infl: 'MY_CPI_YOY', head: 'MY_IB_3M', headLab: '3-month interbank',
    tenors: [['MY_IB_1M', 1, '1M'], ['MY_IB_3M', 3, '3M'], ['MY_IB_6M', 6, '6M']], cal: 'BNM', gaugeLab: '3M interbank − OPR', gShort: '3M interbank',
    src: 'Bank Negara Malaysia API (OPR; interbank rates)' },
  RBA: { name: 'Reserve Bank of Australia', short: 'RBA', sub: 'RBA', policy: 'AU_CASH', policyLab: 'cash rate', infl: 'AU_CPI_YOY', head: 'AU_BB_3M', headLab: '3-month bank bill',
    tenors: [['AU_BB_1M', 1, '1M'], ['AU_BB_3M', 3, '3M'], ['AU_BB_6M', 6, '6M'], ['AU_2Y', 24, '2Y'], ['AU_3Y', 36, '3Y']], cal: 'RBA', gaugeLab: '3M bank bill − cash rate', gShort: '3M bills',
    src: 'Reserve Bank of Australia (tables F1, F2)' },
  BoJ: { name: 'Bank of Japan', short: 'BoJ', sub: 'BoJ', policy: 'JP_CALL', policyLab: 'call rate', infl: 'JP_CPI_YOY', head: 'JP_GB_2Y', headLab: '2-year JGB',
    tenors: [['JP_GB_1Y', 12, '1Y'], ['JP_GB_2Y', 24, '2Y']], cal: 'BoJ', gaugeLab: '2Y JGB − call rate', gShort: '2Y JGB',
    src: 'Bank of Japan (call rate); Ministry of Finance Japan (JGB yields)' },
  ECB: { name: 'European Central Bank', short: 'ECB', sub: 'ECB', policy: 'EA_DFR', policyLab: 'deposit rate', infl: 'EA_HICP_YOY', head: 'EA_FWD_1Y', headLab: '1-year-ahead forward',
    tenors: [['EA_FWD_3M', 3, '3M fwd'], ['EA_FWD_6M', 6, '6M fwd'], ['EA_FWD_1Y', 12, '1Y fwd'], ['EA_FWD_2Y', 24, '2Y fwd']], cal: 'ECB', gaugeLab: '1Y-ahead forward − deposit rate', gShort: '1Y fwd',
    src: 'ECB Data Portal (deposit facility rate; AAA government curve instantaneous forwards)' },
};
const CB_DEAD = 15;   // bp either side of normal that still reads "on hold"
const CB_GOV = /^(JP_GB_|EA_FWD_|AU_2Y|AU_3Y)/;   // government-curve tenors: premium taken as 0
const cbNormCache = new Map();
function cbNormal(k, tid) {   // {v: bp, how: text} — the tenor's usual spread to the policy rate when no move is coming
  const key = k + '|' + tid; if (cbNormCache.has(key)) return cbNormCache.get(key);
  const C = CBS[k], ten = C.tenors.find(x => x[0] === tid), m = ten ? ten[1] : 3;
  let out;
  if (CB_GOV.test(tid)) out = { v: 0, how: 'government curve: little term premium at this horizon, so read as is' };
  else {
    const sp = cbSpreadSeries(k, tid), P = S[C.policy], xs = []; let first = null;
    if (sp) { const end = P.t[P.t.length - 1], from = addMonths(end, -120);
      for (let i = 0; i < sp.t.length; i += 5) { const t = sp.t[i], h = addMonths(t, m); if (t < from || h > end) continue;
        const a = idxLE(P, t), b = idxLE(P, h); if (a < 0) continue;
        let lo = P.v[a], hi = P.v[a]; for (let j = a; j <= b; j++) { lo = Math.min(lo, P.v[j]); hi = Math.max(hi, P.v[j]); }
        if (hi - lo <= 0.05) { xs.push(sp.v[i]); if (first == null) first = t; } } }
    if (xs.length >= 10) { xs.sort((x, y) => x - y); out = { v: xs[Math.floor(xs.length / 2)], how: `median spread in ${xs.length} weeks since ${new Date(first).getUTCFullYear()} when the ${C.policyLab} did not change over the next ${m} month${m > 1 ? 's' : ''}` }; }
    else out = null;   // too little history to estimate a premium: leave this tenor out
  }
  cbNormCache.set(key, out); return out;
}
const CB_LAG = { ECB: 7, RBA: 1, BoJ: 1, BNM: 0 };   // days from decision to the policy-rate series moving
function cbMeetings(k, from, to) {   // decisions whose new rate takes effect inside (from, to]: [{ d: decision day, t: effective day }]
  const sch = CAL && CAL.schedules && CAL.schedules[CBS[k].cal]; if (!sch) return null;
  return sch.map(d => ({ d: dayMs(d), t: dayMs(d) + (CB_LAG[k] || 0) * DAY })).filter(x => x.t > from && x.t <= to); }
function cbSchedEnd(k) { const sch = CAL && CAL.schedules && CAL.schedules[CBS[k].cal]; return sch && sch.length ? dayMs(sch[sch.length - 1]) : null; }
// Turn a tenor's excess over its normal spread into the move it implies per meeting, using the real decision dates
// inside the tenor. Term rates average over their term, so a meeting late in the term barely moves them: a 25bp hike
// 72 days into a 92-day rate adds only ~5bp. If the excess would need more than 50bp per meeting, it is not rate pricing.
function cbImplied(k, tid, t = state.latest) {
  const C = CBS[k], ten = C.tenors.find(x => x[0] === tid), sp = cbSpreadSeries(k, tid), nm = cbNormal(k, tid);
  if (!ten || !sp || !nm) return null;
  const a = asOf(sp, t); if (!a) return null;
  const end = addMonths(a.t, ten[1]), ms = cbMeetings(k, a.t, end); if (!ms) return null;
  const fwd = /^EA_FWD_/.test(tid);   // an instantaneous forward counts every meeting before its horizon in full
  const w = ms.reduce((x, m) => x + (fwd ? 1 : (end - m.t) / (end - a.t)), 0), ex = a.v - nm.v, per = w > 0 ? ex / w : null, se = cbSchedEnd(k);
  return { ex, w, n: ms.length, first: ms.length ? ms[0].d : null, per, beyond: se != null && end > se ? se : null,
    ok: Math.abs(ex) <= CB_DEAD || (per != null && Math.abs(per) <= 50) };
}
function cbPrep() {   // series built on the page: JGB 1Y/2Y from the MOF curve, euro HICP inflation
  if (!S.JP_GB_1Y && CURVES.JP) for (const [id, y] of [['JP_GB_1Y', 1], ['JP_GB_2Y', 2]]) { const c = curveSeries('JP', y); if (c) S[id] = { ...c, id, label: `JGB ${y}Y yield`, group: 'Rates · Japan' }; }
  if (!S.EA_HICP_YOY && has('EA_HICP')) { const y = yoyOf('EA_HICP'); S.EA_HICP_YOY = { ...y, id: 'EA_HICP_YOY', label: 'Euro area HICP inflation YoY' }; }
}
const cbSpread = new Map();
function cbSpreadSeries(k, tid) {   // tenor rate minus policy rate, bp, daily
  const key = k + '|' + tid; if (cbSpread.has(key)) return cbSpread.get(key);
  const C = CBS[k]; if (!has(tid, C.policy)) return null;
  const sp = combine(S[tid], S[C.policy], (a, b) => (a - b) * 100, { label: `${S[tid].label} − ${C.policyLab}`, unit: 'bp' }, 40 * DAY);
  cbSpread.set(key, sp); return sp;
}
function avgWindow(s, t, days) { let x = 0, n = 0; for (let i = 0; i < s.t.length; i++) if (s.t[i] <= t && s.t[i] > t - days * DAY) { x += s.v[i]; n++; } return n >= 20 ? x / n : null; }
function cbStats(k, t = state.latest) {
  const C = CBS[k]; if (!has(C.policy)) return null;
  const p = asOf(S[C.policy], t), sp = cbSpreadSeries(k, C.head), a = sp && asOf(sp, t);
  const nm = a ? cbNormal(k, C.head) : null, avg = nm ? nm.v : null, prev = sp && a ? asOf(sp, a.t - 30 * DAY) : null;
  const vsNorm = a && avg != null ? a.v - avg : null;
  const imp = a ? cbImplied(k, C.head, t) : null, clear = !imp || imp.ok;
  const read = vsNorm == null ? '–' : !clear ? 'No clear signal' : vsNorm > CB_DEAD ? 'Hikes priced' : vsNorm < -CB_DEAD ? 'Cuts priced' : 'On hold';
  // last change in the policy rate
  let last = null; const s = S[C.policy];
  for (let i = p ? p.i : -1; i > 0; i--) if (Math.abs(s.v[i] - s.v[i - 1]) >= 0.05) { last = { t: s.t[i], d: s.v[i] - s.v[i - 1] }; break; }
  let inf = C.infl && has(C.infl) ? asOf(S[C.infl], t) : null; if (inf && t - inf.t > 200 * DAY) inf = null;   // ignore stale prints
  const today = sgToday(), next = CAL && CAL.events ? CAL.events.filter(e => e.kind === 'Policy' && e.name.startsWith(C.cal) && calSpan(e)[1] >= today)[0] : null;
  return { p, spread: a, avg, vsNorm, imp, chg1m: a && prev ? a.v - prev.v : null, read, last, inf, real: p && inf ? p.v - inf.v : null, next };
}
const readTok = r => r === 'Hikes priced' ? '--critical' : r === 'Cuts priced' ? '--s1' : '--muted';
function fedRow() {   // the Fed from the futures page, for the monitor table
  const now = fpSnap('now'), ago = fpSnap('1M ago'); if (!now || !now.path.length) return null;
  const horizon = r => r.filter(x => dayMs(x.d) <= dayMs(now.asof) + 190 * DAY).pop();
  const h = horizon(now.path), h1 = ago ? ago.path.find(x => h && x.d === h.d) : null;
  const ev = CAL && CAL.events ? CAL.events.find(e => e.kind === 'Policy' && e.name.startsWith('FOMC') && calSpan(e)[1] >= sgToday()) : null;
  const inf = has('CPI_YOY') ? asOf(S.CPI_YOY, state.latest) : null, cum = h ? h.cum * 100 : null;
  return { name: 'Federal Reserve', short: 'Fed', rate: FP.target && FP.target[1] != null ? `${fmtNum(FP.target[0], 2)}–${fmtNum(FP.target[1], 2)}%` : (FP.effr != null ? fmtNum(FP.effr, 2) + '%' : '–'),
    gauge: cum == null ? '–' : `futures ${bp(cum)} by ${dShort(dayMs(h.d))}`, chg: h && h1 ? bp((h.after - h1.after) * 100) : '–', infl: inf, real: inf && FP.effr != null ? FP.effr - inf.v : null,
    read: cum == null ? '–' : cum > CB_DEAD ? 'Hikes priced' : cum < -CB_DEAD ? 'Cuts priced' : 'On hold', next: ev };
}
function cbKpis() {
  const box = $('#cbKpis'); box.replaceChildren(); cbPrep();
  const tile = (label, val, delta, foot, tk) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: label }),
    el('div', { class: 'k-value' }, tk ? el('span', { class: 'qdot', style: `background:${tok(tk)}` }) : '', val), el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: foot })));
  for (const k of Object.keys(CBS)) {
    const C = CBS[k], st = cbStats(k); if (!st || !st.p) continue;
    tile(`${C.short} read`, st.read, st.vsNorm != null ? `${C.gaugeLab}: ${bp(st.vsNorm)} vs normal` + (st.read === 'No clear signal' ? ' — too large to be rate pricing' : '') : '', `${C.policyLab} ${fmtNum(st.p.v, 2)}%`, readTok(st.read));
    tile(`${C.short}: ${C.policyLab}`, fmtNum(st.p.v, 2) + '%', st.last ? `last move ${bp(st.last.d * 100)}, effective ${dShort(st.last.t)} ${new Date(st.last.t).getUTCFullYear()}` : 'no change in the data', nice(st.p.t));
    if (st.spread) tile(`${C.short}: ${C.gaugeLab}`, bp(st.spread.v), st.avg != null ? `normal ${bp(st.avg)} · 1M ${st.chg1m == null ? '–' : bp(st.chg1m)}` : '', nice(st.spread.t));
    tile(`${C.short}: next decision`, st.next ? dShort(dayMs(st.next.d)) + (st.next.end ? '–' + dShort(dayMs(st.next.end)) : '') : '–', st.next && st.next.sgt ? `${st.next.sgt} SGT` : '', st.next ? (st.next.conf === 'Confirmed' ? 'bank schedule' : 'estimated') : 'not in calendar');
  }
  const sub = SUBTABS.cbwatch[state.sub.cbwatch || 0][0], short = (Object.values(CBS).find(C => C.sub === sub) || {}).short, fed = cbFedSub();
  $('#cbKpis').hidden = fed; $('#fpKpis').hidden = !fed;
  filterKpis('#cbKpis', l => short ? (l.startsWith(short + ':') ? '*' : '') : (l.endsWith(' read') ? '*' : ''));
}
function renderCbTable(c) {
  const b = htmlBody(c); cbPrep();
  const tbl = el('table', { class: 'perf watch' });
  const heads = ['Bank', 'Policy rate', 'Last move (effective)', 'Next decision', 'Inflation', 'Real rate', 'Gauge', 'vs normal', '1M chg', 'Read'];
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: i === 0 || i === 6 || i === 9 ? 'l' : '' })))));
  const tb = el('tbody'), csv = [heads], pc = v => v == null ? '–' : fmtNum(v, 1) + '%';
  const cell = (t, cls = '') => el('td', { class: cls, text: t });
  const nextTxt = e => e ? dShort(dayMs(e.d)) + (e.sgt ? ` · ${e.sgt}` : '') : '–';
  const f = FP ? fedRow() : null;
  let fLast = '–';   // last Fed move from the effective rate's steps (EFFR moves ~1bp day to day otherwise)
  if (has('EFFR')) { const e = S.EFFR; for (let i = e.t.length - 1; i > 0; i--) if (Math.abs(e.v[i] - e.v[i - 1]) >= 0.15) { fLast = `${bp(Math.round((e.v[i] - e.v[i - 1]) * 4) * 25)} · ${dShort(e.t[i])} ${String(new Date(e.t[i]).getUTCFullYear()).slice(2)}`; break; } }
  if (f) { const r = [f.short, f.rate, fLast, nextTxt(f.next), pc(f.infl && f.infl.v), pc(f.real), f.gauge, '–', f.chg, f.read];
    tb.append(el('tr', { class: 'row', onclick: () => setSub('cbwatch', SUBTABS.cbwatch.findIndex(x => x[2] === 'Fed')) }, ...r.map((x, i) => i === 9 ? el('td', { class: 'l' }, el('span', { class: 'chip', style: `--st:${tok(readTok(x))}` }, x)) : cell(x, i === 0 || i === 6 ? 'l' : '')))); csv.push(r); }
  for (const k of ['ECB', 'BoJ', 'BNM', 'RBA']) {
    const C = CBS[k], st = cbStats(k); if (!st || !st.p) continue;
    const r = [C.short, fmtNum(st.p.v, 2) + '%', st.last ? `${bp(st.last.d * 100)} · ${dShort(st.last.t)} ${String(new Date(st.last.t).getUTCFullYear()).slice(2)}` : '–', nextTxt(st.next),
      pc(st.inf && st.inf.v), pc(st.real), st.spread ? `${C.gShort} ${bp(st.spread.v)}` : '–', st.vsNorm == null ? '–' : bp(st.vsNorm), st.chg1m == null ? '–' : bp(st.chg1m), st.read];
    tb.append(el('tr', { class: 'row', onclick: () => setSub('cbwatch', SUBTABS.cbwatch.findIndex(x => x[0] === C.sub)) },
      ...r.map((x, i) => i === 9 ? el('td', { class: 'l' }, el('span', { class: 'chip', style: `--st:${tok(readTok(x))}` }, x)) : cell(x, i === 0 || i === 6 ? 'l' : ''))));
    csv.push(r);
  }
  // MAS and PBoC: no comparable policy-rate gauge
  const sn = typeof sneerProxy === 'function' ? sneerProxy() : null;
  if (sn && sn.t.length > 30) { const i = sn.t.length - 1, pace = (Math.pow(sn.v[i] / sn.v[i - 26], 2) - 1) * 100;
    const ev = CAL && CAL.events ? CAL.events.find(e => e.region === 'Singapore' && e.kind === 'Policy' && calSpan(e)[1] >= sgToday()) : null;
    const r = ['MAS', 'S$NEER band', '–', nextTxt(ev), pc(has('SG_CORE_YOY') ? asOf(S.SG_CORE_YOY, state.latest).v : null) + ' core', '–', `S$NEER pace ${sign(pace)}${fmtNum(Math.abs(pace), 1)}%/yr`, '–', '–', 'FX policy'];
    tb.append(el('tr', { class: 'row' }, ...r.map((x, i) => cell(x, i === 0 || i === 6 || i === 9 ? 'l' : '')))); csv.push(r); }
  if (has('CN_3M')) { const a = asOf(S.CN_3M, state.latest), ev = CAL && CAL.events ? CAL.events.find(e => e.region === 'China' && e.kind === 'Policy' && calSpan(e)[1] >= sgToday()) : null;
    const r = ['PBoC', `${fmtNum(a.v, 2)}% (3M ib)`, '–', nextTxt(ev) + ' (LPR)', pc(has('CN_CPI_YOY') ? asOf(S.CN_CPI_YOY, state.latest).v : null), has('CN_CPI_YOY') ? pc(a.v - asOf(S.CN_CPI_YOY, state.latest).v) : '–', 'no free gauge', '–', '–', '–'];
    tb.append(el('tr', { class: 'row' }, ...r.map((x, i) => cell(x, i === 0 || i === 6 ? 'l' : '')))); csv.push(r); }
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = csv;
  setNote(c, `Fed: what fed funds futures price over the next ~6 months. ECB, BoJ, BNM, RBA: the named market rate minus the policy rate. “vs normal” removes the usual premium: for money-market rates (BNM interbank, RBA bills) the median spread in past periods with no rate move; government-curve rates (BoJ JGBs, ECB forwards) are read as is. The gauge reads direction, not probabilities; beyond ±${CB_DEAD}bp of normal reads as hikes or cuts priced. Real rate = policy rate minus latest headline inflation (Singapore: MAS core). Click a row for that bank.`);
}
function renderCbRates(c) {
  cbPrep();
  const list = [];
  if (has('EFFR')) list.push({ name: 'Fed (effective fed funds)', data: pts(S.EFFR, state.from, state.to), extra: { step: 'end' } });
  for (const k of ['ECB', 'BoJ', 'BNM', 'RBA']) { const C = CBS[k]; if (has(C.policy)) list.push({ name: `${C.short} ${C.policyLab}`, data: pts(S[C.policy], state.from, state.to), extra: { step: 'end' } }); }
  if (!list.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, list, { fmt: v => fmtNum(v, 2) + '%', axisFmt: v => fmtNum(v, 1) + '%', endLabels: false });
  setSource(c, 'FRED (EFFR); ECB Data Portal; Bank of Japan; Bank Negara Malaysia; RBA');
}
function renderCbReal(c) {
  cbPrep();
  const list = [], pairs = [['Fed', 'EFFR', 'CPI_YOY'], ['ECB', 'EA_DFR', 'EA_HICP_YOY'], ['BoJ', 'JP_CALL', 'JP_CPI_YOY'], ['BNM', 'MY_OPR', 'MY_CPI_YOY'], ['RBA', 'AU_CASH', 'AU_CPI_YOY']];
  for (const [nm, p, i] of pairs) { if (!has(p, i)) continue;
    const me = monthEnds(S[p]), t = [], v = [];
    for (const [m, pv] of [...me].sort((x, y) => x[0] - y[0])) { const inf = asOf(S[i], m + 20 * DAY); if (inf && m - inf.t < 200 * DAY) { t.push(m); v.push(pv - inf.v); } }
    list.push({ name: nm, data: pts({ t, v }, state.from, state.to) }); }
  if (!list.length) return setEmpty(c, 'Waiting for data.');
  drawLines(c, list, { fmt: v => fmtNum(v, 2) + '%', axisFmt: v => fmtNum(v, 1) + '%', zero: true, endLabels: false });
  setNote(c, 'Policy rate minus headline inflation, month-end. Above zero = policy is restrictive in real terms; below zero = still easy. Australia’s CPI is quarterly.');
  setSource(c, 'Policy rates as on the left; inflation from FRED (CPI, euro HICP), Statistics Bureau of Japan, DOSM, ABS via RBA');
}
function renderCbPath(c, k) {
  cbPrep();
  const C = CBS[k]; if (!has(C.policy)) return setEmpty(c, 'Waiting for data.');
  const latest = asOf(S[C.policy], state.latest), start = addMonths(state.latest, -36);
  const snaps = [['now', 0, col(0), 'solid'], ['1M ago', 1, col(1), 'dashed'], ['3M ago', 3, col(2), 'dotted']];
  const series = [line(`${C.policyLab} (actual)`, pts(S[C.policy], start, state.latest), tok('--ink-2'), { step: 'end' })];
  let maxT = state.latest;
  const rows = [], dropped = [];
  for (const [nm, back, color, dash] of snaps) {
    const t0 = addMonths(state.latest, -back), p0 = asOf(S[C.policy], t0); if (!p0) continue;
    const ptsL = [[t0, p0.v]];
    for (const [tid, m, lab] of C.tenors) {
      const sp = cbSpreadSeries(k, tid); if (!sp) continue;
      const nmT = cbNormal(k, tid), a = asOf(sp, t0); if (!nmT || !a || t0 - a.t > 20 * DAY) continue; const avg = nmT.v;
      const im = cbImplied(k, tid, t0); if (im && !im.ok) { if (back === 0) dropped.push(`${lab} (${bp(im.ex)} vs normal would need ${bp(im.per)} per meeting)`); continue; }
      // forwards are a rate at the horizon; yields and money-market rates are an average over it, so sit at mid-horizon
      const lvl = p0.v + (a.v - avg) / 100, tt = /^EA_FWD_/.test(tid) ? addMonths(t0, m) : t0 + (addMonths(t0, m) - t0) / 2; ptsL.push([tt, lvl]); maxT = Math.max(maxT, addMonths(t0, m));
      if (back === 0) rows.push(`${lab} ${bp(a.v - avg)}`);
    }
    if (ptsL.length > 1) series.push(line(`Market-implied path ${nm}`, ptsL, color, { symbol: 'circle', showSymbol: true, symbolSize: 6, lineStyle: { width: back ? 1.5 : 2.5, type: dash, color } }));
  }
  const o = baseOpt(); o.legend.show = true; o.grid.top = 12 + 22 * legendRows(c, series.map(x => x.name));
  o.xAxis = timeAxis({ min: start, max: maxT + 20 * DAY }); o.yAxis = valAxis(v => fmtNum(v, 2) + '%');
  o.tooltip.formatter = tipFormatter(v => fmtNum(v, 2) + '%');
  series[0].markArea = { silent: true, itemStyle: { color: hexA(tok('--muted'), 0.08) }, data: [[{ xAxis: state.latest, name: 'market-implied →', label: { color: tok('--muted'), fontSize: 11, position: 'insideTopLeft' } }, { xAxis: maxT + 20 * DAY }]] };
  o.series = series;
  setZoomable(c, o);
  c.titleEl.textContent = `${C.name}: policy rate and what markets imply`;
  c.subEl.textContent = `${C.policyLab[0].toUpperCase() + C.policyLab.slice(1)} with the path implied by ${C.tenors.map(x => x[2]).join(', ')} rates, after removing each tenor’s usual premium. Forwards sit at their horizon; yields and money-market rates are an average over their term, so they sit at mid-term.`;
  c.csv = [['Series', 'Date', 'Rate'], ...series.flatMap(sr => sr.data.map(([t, v]) => [sr.name, iso(t), v.toFixed(3)]))];
  setNote(c, `Latest ${C.policyLab}: ${fmtNum(latest.v, 2)}%. Tenors vs their normal spread: ${rows.join(' · ') || 'n/a'}. ${dropped.length ? `Left out as not rate pricing: ${dropped.join('; ')}; more likely a funding or term-premium shift. ` : ''}${C.tenors.some(([t]) => !CB_GOV.test(t)) ? 'Money-market rates are net of their usual credit premium (median spread in past no-move periods); government-curve rates are read as is.' : 'Government-curve rates are read as is (little term premium at these horizons).'} A rough read of direction; not OIS pricing, not a probability.`);
  setSource(c, C.src);
}
function renderCbSpread(c, k) {
  cbPrep();
  const C = CBS[k], sp = cbSpreadSeries(k, C.head); if (!sp) return setEmpty(c, 'Waiting for data.');
  const nm = cbNormal(k, C.head) || { v: 0, how: 'not enough history' }, gov = CB_GOV.test(C.head);
  c.titleEl.textContent = `${C.gaugeLab}`;
  c.subEl.textContent = gov ? `The ${C.headLab} rate minus the ${C.policyLab}, bp. Above zero = markets expect the ${C.policyLab} to be higher over the next ${C.tenors.find(x => x[0] === C.head)[2]}.`
    : `The ${C.headLab} rate minus the ${C.policyLab}, bp, against its normal premium (dashed). Above the dashed line = hikes priced; below = cuts.`;
  drawLines(c, [{ name: C.gaugeLab, data: pts(sp, state.from, state.to) }], { fmt: v => bp(v), axisFmt: v => fmtNum(v, 0), zero: true, endLabels: false,
    hlines: gov ? [] : [{ y: nm.v, label: `normal ${bp(nm.v)}`, color: col(1) }] });
  const st = cbStats(k);
  const im = st && st.imp, meet = im && im.first ? `${dShort(im.first)}` : '';
  const chk = im && im.per != null && Math.abs(im.ex) > CB_DEAD ? ` Meeting check: ${im.n} decision${im.n === 1 ? '' : 's'} fall${im.n === 1 ? 's' : ''} inside this tenor (first ${meet}${im.beyond ? `; the published schedule ends ${nice(im.beyond)}, so the pace is if anything overstated` : ''}); the excess equals about ${bp(im.per)} per meeting${im.ok ? ', a plausible pace.' : ', too large to be rate pricing, so it is read as a funding or term-premium shift.'}` : '';
  setNote(c, st && st.spread ? `Now ${bp(st.spread.v)}${gov ? '' : `, normal ${bp(st.avg)}`}: ${st.read.toLowerCase()} (±${CB_DEAD}bp band).${chk} Normal premium: ${nm.how}. A market-rate read, not OIS pricing or a probability.` : '');
  setSource(c, C.src);
}
function renderCbInfo(c, k) {
  const b = htmlBody(c), C = CBS[k], st = cbStats(k);
  c.titleEl.textContent = `${C.short}: decisions`;
  if (!st || !st.p) { b.append(el('div', { class: 'empty', text: 'Waiting for data.' })); return; }
  const today = sgToday(), next = CAL && CAL.events ? CAL.events.filter(e => e.kind === 'Policy' && e.name.startsWith(C.cal) && calSpan(e)[1] >= today).slice(0, 4) : [];
  const s = S[C.policy], changes = [];
  for (let i = s.v.length - 1; i > 0 && changes.length < 4; i--) if (Math.abs(s.v[i] - s.v[i - 1]) >= 0.05) changes.push([s.t[i], s.v[i - 1], s.v[i]]);
  const t1 = el('table', { class: 'perf' });
  t1.append(el('thead', {}, el('tr', {}, ...['Next decisions', 'Time (SGT)', 'Previous'].map(h => el('th', { text: h })))));
  const tb1 = el('tbody');
  for (const e of next) tb1.append(el('tr', { class: 'row' }, el('td', { text: dLong(dayMs(e.d)) + ' ' + new Date(dayMs(e.d)).getUTCFullYear() + (e.end ? ` – ${dShort(dayMs(e.end))}` : '') }), el('td', { text: e.sgt || '–' }), el('td', { text: e.prev || '–' })));
  if (!next.length) tb1.append(el('tr', {}, el('td', { colspan: 3, class: 'muted', text: 'No dates on file in the calendar window.' })));
  t1.append(tb1);
  const t2 = el('table', { class: 'perf' });
  t2.append(el('thead', {}, el('tr', {}, ...['Recent moves', 'From', 'To'].map(h => el('th', { text: h })))));
  const tb2 = el('tbody');
  for (const [t, a, z] of changes) tb2.append(el('tr', { class: 'row' }, el('td', { text: `${dShort(t)} ${new Date(t).getUTCFullYear()} (${bp((z - a) * 100)})` }), el('td', { text: fmtNum(a, 2) + '%' }), el('td', { text: fmtNum(z, 2) + '%' })));
  if (!changes.length) tb2.append(el('tr', {}, el('td', { colspan: 3, class: 'muted', text: 'No change in the data on file.' })));
  t2.append(tb2);
  b.append(el('div', { class: 'table-wrap' }, t1), el('div', { class: 'table-wrap', style: 'margin-top:10px' }, t2));
  setNote(c, `Read: ${st.read}${st.real != null ? `. Real ${C.policyLab}: ${fmtNum(st.real, 1)}% (latest inflation ${fmtNum(st.inf.v, 1)}%)` : ''}. Decision dates from the Calendar page. The read is a market-rate gauge net of its usual premium; not OIS pricing or a probability.`);
  setSource(c, 'Calendar (central bank schedules); ' + C.src);
}
function buildCbWatch() {
  const g = $('#cbGrid');
  makeCard(g, { key: 'cb_table', range: false, title: 'Policy monitor', wide: true, sub: 'Where each central bank stands and what markets price next.', render: renderCbTable });
  makeCard(g, { key: 'cb_rates', title: 'Policy rates', defaultRange: '5Y', render: renderCbRates });
  makeCard(g, { key: 'cb_real', title: 'Real policy rates', defaultRange: '5Y', render: renderCbReal });
  for (const k of Object.keys(CBS)) {
    makeCard(g, { key: `cb_path_${k}`, range: false, title: `${CBS[k].name}: policy rate and what markets imply`, wide: true, render: c => renderCbPath(c, k) });
    makeCard(g, { key: `cb_spread_${k}`, title: CBS[k].gaugeLab, defaultRange: '3Y', render: c => renderCbSpread(c, k) });
    makeCard(g, { key: `cb_info_${k}`, range: false, title: `${k}: decisions`, render: c => renderCbInfo(c, k) });
  }
  for (const k of ['cb_table', ...Object.keys(CBS).map(x => `cb_info_${x}`)]) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
}
const cbFedSub = () => (SUBTABS.cbwatch[state.sub.cbwatch || 0][2] || '') === 'Fed';
function renderCbWatch() { cbKpis(); if (cbFedSub()) fpKpis();
  ['cb_table', 'cb_rates', 'cb_real', ...Object.keys(CBS).flatMap(k => [`cb_path_${k}`, `cb_spread_${k}`, `cb_info_${k}`]), 'fp_path', 'fp_years', 'fp_table', 'fp_bars', 'fp_hist', 'fp_2y'].forEach(k => cards[k].render()); }

// ------------------------------------------------------------------ FED PATH vs MARKET PRICING
let FP = null;
const bp = v => (v > 0 ? '+' : v < 0 ? '−' : '') + fmtNum(Math.abs(v), 0) + 'bp';
const yEnd = y => Date.UTC(+y, 11, 31);
function fpSnap(name) { return FP && FP.snapshots && FP.snapshots[name]; }
function fpYearEnd(snap, year) {   // market rate after the last FOMC meeting of `year`, or null if not priced
  if (!snap) return null;
  const rows = snap.path.filter(r => r.d.startsWith(year));
  return rows.length && rows[rows.length - 1].d >= `${year}-12-01` ? rows[rows.length - 1].after : null;
}
function fpKpis() {
  const box = $('#fpKpis'); box.replaceChildren();
  const tile = (label, val, delta, foot) => box.append(el('div', { class: 'kpi' }, el('div', { class: 'k-label', text: label }), el('div', { class: 'k-value', text: val }),
    el('div', { class: 'k-delta', text: delta }), el('div', { class: 'k-asof', text: foot })));
  if (!FP) return;
  const [lo, hi] = FP.target || [];
  if (lo != null) tile('Fed funds target', `${fmtNum(lo, 2)}–${fmtNum(hi, 2)}%`, FP.effr != null ? `effective ${fmtNum(FP.effr, 2)}%` : '', 'FRED (DFEDTARL/U, EFFR)');
  const now = fpSnap('now'), ago = fpSnap('1M ago');
  if (now && now.path.length) {
    const n = now.path[0];
    tile('Next FOMC: ' + dShort(dayMs(n.d)), n.odds.replace(' ~100%', ''), `priced change ${bp(n.chg * 100)}`, 'fed funds futures');
    const yr = new Date(dayMs(now.path[now.path.length - 1].d)).getUTCFullYear(), m = fpYearEnd(now, String(yr)), a = fpYearEnd(ago, String(yr));
    if (m != null) tile(`Priced by end-${yr}`, bp((m - now.effr) * 100), a != null ? `${bp((m - a) * 100)} vs a month ago` : '', `implied rate ${fmtNum(m, 2)}%`);
    const med = FP.dots && FP.dots.median && FP.dots.median[String(yr)];
    if (m != null && med != null) tile(`Market vs Fed, end-${yr}`, bp((m - med) * 100), `market ${fmtNum(m, 2)}% vs Fed median ${fmtNum(med, 2)}%`, FP.sep_date ? `dots from the ${monthLab(dayMs(FP.sep_date))} SEP` : 'Fed SEP');
  }
  if (FP.dots && FP.dots.longer_run != null) tile('Fed longer-run rate', fmtNum(FP.dots.longer_run, 2) + '%', 'median “neutral” estimate', 'Fed SEP via FRED');
}
function renderFpPath(c) {
  const now = fpSnap('now');
  if (!now) return setEmpty(c, 'Waiting for the fed funds futures (next full refresh).');
  const today = sgToday(), start = addMonths(today, -12), d = FP.dots || {};
  const years = Object.keys(d.median || {}).sort();
  const end = Math.max(yEnd(years.length ? years[years.length - 1] : new Date(today).getUTCFullYear() + 1) + 60 * DAY, dayMs(now.path[now.path.length - 1].d) + 60 * DAY);
  const step = (snap) => { const pts = [[dayMs(snap.asof), snap.effr]]; for (const r of snap.path) pts.push([dayMs(r.d) + DAY, r.after]); return pts; };
  const series = [];
  const o = baseOpt();
  const hist = has('EFFR') ? pts(S.EFFR, start, today) : [];
  series.push(line('Effective fed funds (actual)', hist, tok('--ink-2'), { step: 'end' }));
  series.push(line('Market path now', step(now), col(0), { step: 'end', lineStyle: { width: 3, color: col(0) } }));
  for (const [nm, dash] of [['1M ago', 'dashed'], ['3M ago', 'dotted']]) {
    const sn = fpSnap(nm); if (sn && sn.path.length) series.push(line('Market path ' + nm, step(sn), col(nm === '1M ago' ? 1 : 2), { step: 'end', lineStyle: { width: 1.5, type: dash, color: col(nm === '1M ago' ? 1 : 2) } }));
  }
  if (years.length) {
    const fed = col(3);
    const lo = d.ct_lo || d.range_lo || {}, hi = d.ct_hi || d.range_hi || {};
    series.push({ name: 'Fed range (central tendency)', type: 'custom', z: 3, data: years.filter(y => lo[y] != null && hi[y] != null).map(y => [yEnd(y), lo[y], hi[y]]),
      renderItem: (params, api) => { const a = api.coord([api.value(0), api.value(1)]), b = api.coord([api.value(0), api.value(2)]);
        return { type: 'group', children: [{ type: 'line', shape: { x1: a[0], y1: a[1], x2: b[0], y2: b[1] }, style: { stroke: fed, lineWidth: 2 } },
          { type: 'line', shape: { x1: a[0] - 6, y1: a[1], x2: a[0] + 6, y2: a[1] }, style: { stroke: fed, lineWidth: 2 } },
          { type: 'line', shape: { x1: b[0] - 6, y1: b[1], x2: b[0] + 6, y2: b[1] }, style: { stroke: fed, lineWidth: 2 } }] }; },
      itemStyle: { color: fed }, encode: { x: 0, y: [1, 2] }, tooltip: { show: false } });
    series.push({ name: 'Fed median (dots)', type: 'scatter', z: 4, symbol: 'diamond', symbolSize: 14, itemStyle: { color: fed, borderColor: tok('--surface'), borderWidth: 1.5 },
      data: years.map(y => [yEnd(y), d.median[y]]), label: { show: true, position: 'right', formatter: p => fmtNum(p.value[1], 2) + '%', color: tok('--ink-2'), fontSize: 11, fontWeight: 600 } });
  }
  if (d.longer_run != null) series[0].markLine = { silent: true, symbol: 'none', data: [{ yAxis: d.longer_run, lineStyle: { color: col(3), type: 'dashed' },
    label: { formatter: `Fed longer-run ${fmtNum(d.longer_run, 2)}%`, color: tok('--ink-2'), position: 'insideEndTop', fontSize: 11 } }] };
  series[0].markArea = { silent: true, itemStyle: { color: hexA(tok('--muted'), 0.08) }, data: [[{ xAxis: today, name: 'priced by the market →', label: { color: tok('--muted'), fontSize: 11, position: 'insideTopLeft' } }, { xAxis: end }]] };
  o.legend.show = true; o.grid.top = 12 + 22 * legendRows(c, series.map(x => x.name));
  o.xAxis = timeAxis({ min: start, max: end });
  o.yAxis = valAxis(v => fmtNum(v, 2) + '%');
  o.tooltip.formatter = tipFormatter((v, n) => fmtNum(v, 2) + '%');
  o.series = series;
  const ch = inst(c); ch.setOption(o, true);
  c.csv = [['Meeting', 'Market now', 'Market 1M ago', 'Market 3M ago'], ...now.path.map(r => [r.d, r.after.toFixed(3),
    ...['1M ago', '3M ago'].map(nm => { const x = (fpSnap(nm) || { path: [] }).path.find(q => q.d === r.d); return x ? x.after.toFixed(3) : ''; })]),
    [], ['Fed SEP year', 'Median', 'Central tendency low', 'Central tendency high'], ...years.map(y => [y, d.median[y], (d.ct_lo || {})[y] ?? '', (d.ct_hi || {})[y] ?? ''])];
  const yr = years.find(y => fpYearEnd(now, y) != null && y > String(new Date(today).getUTCFullYear()));
  setNote(c, `The market path is the effective fed funds rate the futures imply after each FOMC meeting (steps); the diamonds are the Fed’s median year-end projection, with the central tendency as a bar.` +
    (yr ? ` End-${yr}: market ${fmtNum(fpYearEnd(now, yr), 2)}% vs Fed ${fmtNum(d.median[yr], 2)}%, so the market is ${fpYearEnd(now, yr) > d.median[yr] ? 'more hawkish' : 'more dovish'} than the Fed by ${fmtNum(Math.abs(fpYearEnd(now, yr) - d.median[yr]) * 100, 0)}bp.` : '') +
    ' Futures run to December ' + now.path[now.path.length - 1].d.slice(0, 4) + '; beyond that only the Fed’s projections are shown.');
}
function renderFpYears(c) {
  const now = fpSnap('now'), d = (FP && FP.dots) || {};
  if (!now) return setEmpty(c, 'Waiting for data.');
  const years = [...new Set([...Object.keys(d.median || {}), ...now.path.map(r => r.d.slice(0, 4))])].sort();
  const mk = years.map(y => fpYearEnd(now, y)), fed = years.map(y => d.median ? d.median[y] ?? null : null), ago = years.map(y => fpYearEnd(fpSnap('1M ago'), y));
  const o = baseOpt(); o.legend.show = true;
  o.xAxis = { type: 'category', data: years.map(y => 'End-' + y), axisLabel: { color: tok('--ink-2') }, axisLine: { lineStyle: { color: tok('--axis') } }, axisTick: { show: false } };
  o.yAxis = valAxis(v => fmtNum(v, 1) + '%', { scale: false, min: 0 });
  o.tooltip = { ...o.tooltip, trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: v => v == null ? 'not priced' : fmtNum(v, 2) + '%' };
  const lab = { show: true, position: 'top', fontSize: 11, color: tok('--ink-2'), formatter: p => p.value == null ? '' : fmtNum(p.value, 2) };
  o.series = [{ name: 'Market now', type: 'bar', data: mk, itemStyle: { color: col(0), borderRadius: [3, 3, 0, 0] }, label: lab, barGap: '10%' },
    { name: 'Market 1M ago', type: 'bar', data: ago, itemStyle: { color: hexA(col(1), 0.75), borderRadius: [3, 3, 0, 0] }, label: lab },
    { name: 'Fed median', type: 'bar', data: fed, itemStyle: { color: col(3), borderRadius: [3, 3, 0, 0] }, label: lab }];
  const ch = inst(c); ch.setOption(o, true);
  c.csv = [['Year end', 'Market now', 'Market 1M ago', 'Fed median'], ...years.map((y, i) => [y, mk[i] ?? '', ago[i] ?? '', fed[i] ?? ''])];
  setNote(c, years.map((y, i) => mk[i] != null && fed[i] != null ? `End-${y}: market ${bp((mk[i] - fed[i]) * 100)} vs the Fed` : null).filter(Boolean).join(' · ') + (years.length ? '.' : '') +
    ' Market = expected effective rate after the last meeting of the year; Fed = median of the target-range midpoints the FOMC participants project.');
}
function renderFpTable(c) {
  const b = htmlBody(c), now = fpSnap('now');
  if (!now) { b.append(el('div', { class: 'empty', text: 'Waiting for the fed funds futures.' })); return; }
  const a1 = fpSnap('1M ago'), a3 = fpSnap('3M ago'), find = (s, d) => s && s.path.find(r => r.d === d);
  const tbl = el('table', { class: 'perf' });
  const heads = ['FOMC decision', 'Time (SGT)', 'Expected rate after', 'Priced change', 'Market reading', 'From today', 'vs 1M ago', 'vs 3M ago'];
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map(h => el('th', { text: h })))));
  const tb = el('tbody'), csv = [heads], pos = tok('--pos'), neg = tok('--neg');
  for (const r of now.path) {
    const x1 = find(a1, r.d), x3 = find(a3, r.d), t = dayMs(r.d);
    const sep = (FP.sep_meetings || []).includes(r.d);
    const heat = v => v == null ? '' : `background:${hexA(v > 0 ? neg : pos, Math.min(1, Math.abs(v) / 50) * 0.4)}`;
    const cells = [dLong(t) + ' ' + new Date(t).getUTCFullYear() + (sep ? ' · with projections' : ''), r.sgt || '', fmtNum(r.after, 2) + '%',
      [bp(r.chg * 100), heat(r.chg * 100)], r.odds, [bp(r.cum * 100), heat(r.cum * 100)],
      x1 ? [bp((r.after - x1.after) * 100), heat((r.after - x1.after) * 100)] : '–', x3 ? [bp((r.after - x3.after) * 100), heat((r.after - x3.after) * 100)] : '–'];
    tb.append(el('tr', { class: 'row' }, ...cells.map(x => Array.isArray(x) ? el('td', { class: 'heat', style: x[1], text: x[0] }) : el('td', { text: x }))));
    csv.push(cells.map(x => Array.isArray(x) ? x[0] : x));
  }
  tbl.append(tb); b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = csv;
  setNote(c, `Priced change: expected rate after the meeting minus before it. Market reading turns that into odds the CME FedWatch way (e.g. +20bp ≈ 80% chance of a 25bp hike). From today: cumulative change from the effective rate now (${fmtNum(now.effr, 2)}%). vs 1M / 3M ago: how much the expected rate after that meeting has moved; red = priced more hawkishly (higher), blue = more dovishly (lower). Futures prices as of the last close before ${FP.generated}.`);
}
function renderFpBars(c) {
  const now = fpSnap('now'); if (!now) return setEmpty(c, 'Waiting for data.');
  const names = ['now', '1M ago', '3M ago'].filter(n => fpSnap(n));
  const labels = now.path.map(r => dShort(dayMs(r.d)) + ' ' + String(new Date(dayMs(r.d)).getUTCFullYear()).slice(2));
  const o = baseOpt(); o.legend.show = true;
  o.grid.right = 32;
  o.xAxis = { type: 'category', data: labels, boundaryGap: false, axisLabel: { color: tok('--ink-2'), fontSize: 11 }, axisLine: { lineStyle: { color: tok('--axis') } }, axisTick: { show: false } };
  o.yAxis = valAxis(v => fmtNum(v, 2) + '%');
  o.tooltip = { ...o.tooltip, trigger: 'axis', valueFormatter: v => v == null ? '–' : fmtNum(v, 2) + '%' };
  o.tooltip.axisPointer = { type: 'line', lineStyle: { color: tok('--muted') } };
  o.series = names.map((n, i) => ({ name: n === 'now' ? 'Priced now' : 'Priced ' + n, type: 'line', symbol: 'circle', symbolSize: i ? 6 : 8, color: col(i),
    lineStyle: { width: i ? 1.5 : 2.5, type: ['solid', 'dashed', 'dotted'][i], color: col(i) }, itemStyle: { color: col(i) },
    data: now.path.map(r => { const x = fpSnap(n).path.find(q => q.d === r.d); return x ? +x.after.toFixed(3) : null; }) }));
  o.series[0].markLine = { silent: true, symbol: 'none', data: [{ yAxis: now.effr, lineStyle: { color: tok('--muted'), type: 'dashed' }, label: { formatter: `today ${fmtNum(now.effr, 2)}%`, color: tok('--muted'), position: 'insideEndTop', fontSize: 11 } }] };
  const ch = inst(c); ch.setOption(o, true);
  c.csv = [['Meeting', ...names], ...now.path.map(r => [r.d, ...names.map(n => { const x = fpSnap(n).path.find(q => q.d === r.d); return x ? x.after.toFixed(3) : ''; })])];
  setNote(c, 'Expected effective fed funds rate after each meeting, as priced today, a month ago and three months ago. Older snapshots start from the first futures contract still trading.');
}
function renderFpHist(c) {
  if (!FP || !FP.contracts) return setEmpty(c, 'Waiting for data.');
  const ks = Object.keys(FP.contracts).filter(k => k.endsWith('-12') || k.endsWith('-06')).sort();
  const list = ks.map((k, i) => { const x = FP.contracts[k], s = { t: x.d.map(dayMs), v: x.v };
    return { name: `${MONTHS[+k.slice(5) - 1]} ${k.slice(0, 4)} contract`, data: pts(s, state.from, state.to), color: col(i) }; });
  if (has('EFFR')) list.push({ name: 'Effective fed funds (actual)', data: pts(S.EFFR, state.from, state.to), color: tok('--ink-2'), extra: { step: 'end' } });
  drawLines(c, list, { fmt: v => fmtNum(v, 3) + '%', axisFmt: v => fmtNum(v, 2) + '%', endLabels: false });
  setSource(c, 'CBOT 30-day fed funds futures via Yahoo Finance (' + ks.map(k => FP.contracts[k].sym).join(', ') + '); FRED (EFFR)');
  setNote(c, 'Each line is 100 minus the futures price: the average fed funds rate the market expects in that month, day by day. Rising = the market pricing a higher path (hawkish), falling = dovish. Contract history covers about the last year.');
}
function renderFp2y(c) {
  if (!has('UST2Y', 'EFFR')) return setEmpty(c, NO_FRED);
  const sp = combine(S.UST2Y, S.EFFR, (a, b) => (a - b) * 100, {}, 7 * DAY);
  drawLines(c, [{ name: '2Y Treasury yield − effective fed funds (bp)', data: pts(sp, state.from, state.to) }],
    { fmt: v => bp(v), axisFmt: v => fmtNum(v, 0), zero: true, areas: recessionAreas(state.from, state.to) });
  const a = asOf(sp, state.to);
  setNote(c, `A simple, long-history read of what the market expects over the next two years: below zero = cuts priced, above zero = hikes priced (plus a small term premium). Latest ${a ? bp(a.v) : '–'}. Grey = US recessions: the spread typically turns deeply negative before and during easing cycles.`);
}
function buildFedPath() {
  const g = $('#cbGrid');
  makeCard(g, { key: 'fp_path', range: false, title: 'Fed funds path: market pricing vs the Fed’s projections', wide: true, tall: true,
    source: 'CBOT 30-day fed funds futures via Yahoo Finance; Federal Reserve Summary of Economic Projections via FRED (FEDTARMD, FEDTARCTH, FEDTARCTL, FEDTARMDLR); FRED (EFFR)', render: renderFpPath });
  makeCard(g, { key: 'fp_years', range: false, title: 'Year-end rate: market vs Fed median', wide: true,
    source: 'Fed funds futures via Yahoo Finance; Fed SEP via FRED (FEDTARMD)', render: renderFpYears });
  makeCard(g, { key: 'fp_table', range: false, title: 'Meeting by meeting', wide: true, sub: 'What the fed funds futures imply for each FOMC decision.',
    source: 'CBOT 30-day fed funds futures via Yahoo Finance; FOMC calendar (federalreserve.gov); odds calculated the CME FedWatch way', render: renderFpTable });
  makeCard(g, { key: 'fp_bars', range: false, title: 'Expected rate after each meeting: now vs 1 and 3 months ago', wide: true,
    source: 'CBOT 30-day fed funds futures via Yahoo Finance', render: renderFpBars });
  makeCard(g, { key: 'fp_hist', title: 'How the expected path has moved', wide: true, defaultRange: '1Y', render: renderFpHist });
  makeCard(g, { key: 'fp_2y', title: 'Market expectations, long history: 2Y Treasury minus fed funds', wide: true, defaultRange: 'MAX',
    source: 'FRED (DGS2, EFFR); recession shading NBER (USREC)', render: renderFp2y });
  for (const k of ['fp_table']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
}
function renderFedPath() { fpKpis(); ['fp_path', 'fp_years', 'fp_table', 'fp_bars', 'fp_hist', 'fp_2y'].forEach(k => cards[k].render()); }

// ------------------------------------------------------------------ ECONOMIC CALENDAR
let CAL = null;
const CAL_VIEWS = [['This week', 'this'], ['Next week', 'next'], ['Later', 'later'], ['Recent results', 'past']];
const CAL_REGIONS = ['Malaysia', 'Singapore', 'Australia', 'US', 'China', 'Japan', 'Korea', 'Euro area', 'UK'];
state.calRegions = new Set(CAL_REGIONS); state.calKey = false;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayMs = s => Date.parse(s + 'T00:00:00Z');
const sgToday = () => { const n = new Date(Date.now() + 8 * 3600e3); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); };
const weekOf = t => t - ((new Date(t).getUTCDay() + 6) % 7) * DAY;   // Monday
const dShort = t => { const d = new Date(t); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const dLong = t => `${WEEKDAYS[new Date(t).getUTCDay()]} ${dShort(t)}`;
function calSpan(e) { const a = dayMs(e.d); return [a, e.end ? dayMs(e.end) : a]; }
function calStatus(e, today) {
  const [, b] = calSpan(e);
  if (e.actual) return ['done', ''];
  if (dayMs(e.d) > today) return ['upcoming', ''];
  if (e.kind === 'Policy' && !e.pending) return ['done', ''];
  return b >= today ? ['due', e.end ? 'due in this window' : 'due today'] : ['waiting', e.kind === 'Policy' ? 'decided; rate not yet in the data' : 'released; not yet in this dashboard’s data'];
}
function calRows(view) {
  if (!CAL || !CAL.events) return [];
  const today = sgToday(), ws = weekOf(today);
  const ok = e => state.calRegions.has(e.region) && (!state.calKey || e.hi);
  const out = [];
  for (const e of CAL.events.filter(ok)) {
    const [a, b] = calSpan(e);
    let lo, hi;
    if (view === 'this') [lo, hi] = [ws, ws + 6 * DAY];
    else if (view === 'next') [lo, hi] = [ws + 7 * DAY, ws + 13 * DAY];
    else if (view === 'later') [lo, hi] = [ws + 14 * DAY, Infinity];
    else [lo, hi] = [today - 21 * DAY, today - DAY];
    if (view === 'past') { if (b < today && b >= lo) out.push({ e, day: a }); continue; }
    if (view === 'later' ? a >= lo : (a <= hi && b >= lo)) out.push({ e, day: Math.max(a, lo) });
  }
  out.sort((x, y) => view === 'past' ? (y.day - x.day) || x.e.region.localeCompare(y.e.region) : (x.day - y.day) || ((x.e.kind === 'Policy' ? 0 : 1) - (y.e.kind === 'Policy' ? 0 : 1)) || (x.e.sgt || '99').localeCompare(y.e.sgt || '99'));
  return out;
}
function calTiming(e) {
  if (e.conf === 'Live') return ['Scheduled', 'Date from the agency’s release calendar via FRED'];
  if (e.conf === 'Confirmed') return ['Confirmed', 'From the central bank’s published meeting schedule'];
  if (e.conf === 'Rule') return ['Fixed rule', e.detail];
  const [a, b] = calSpan(e);
  return [e.end ? `Window ${dShort(a)}–${dShort(b)}` : 'Estimated', 'Estimated from the usual release pattern; the agency does not publish a machine-readable forward calendar'];
}
function calTable(list, today, { compact = false, weekly = false } = {}) {
  const tbl = el('table', { class: 'perf cal' });
  const heads = compact ? ['Time (SGT)', 'Region', 'Event', 'Previous'] : ['Time (SGT)', 'Region', 'Event', 'Covers', 'Actual', 'Previous', 'Timing', 'Source'];
  const hcls = compact ? ['tm', 'reg', 'ev', 'num'] : ['tm', 'reg', 'ev', 'per', 'num', 'num', 'tim', 'src'];
  tbl.append(el('thead', {}, el('tr', {}, ...heads.map((h, i) => el('th', { text: h, class: hcls[i] })))));
  const tb = el('tbody'), csv = [['Date', ...heads]];
  let day = null;
  for (const { e, day: d } of list) {
    const g = weekly ? weekOf(d) : d;
    if (g !== day) {
      day = g;
      const lab = weekly ? `Week of ${dLong(g)}` : dLong(d) + (d === today ? ' · today' : d === today + DAY ? ' · tomorrow' : '');
      tb.append(el('tr', { class: 'grp' + (d < today ? ' past' : '') + (d === today ? ' today' : '') }, el('td', { colspan: heads.length, text: lab })));
    }
    const [st, stTxt] = calStatus(e, today), [timing, timingTip] = calTiming(e);
    const name = el('div', {}, el('span', { class: 'star', text: e.hi ? '★' : '', title: e.hi ? 'Key event' : '' }), el('span', { text: e.name }));
    if (e.detail && !compact) name.append(el('div', { class: 'muted small', text: e.detail }));
    const prev = e.prev ? e.prev + (e.prev_period && st !== 'done' ? ` (${e.prev_period})` : '') : '–';
    const actual = e.actual ? el('b', { text: e.actual }) : el('span', { class: 'muted small', text: st === 'upcoming' ? '' : stTxt || '–' });
    const cells = compact
      ? [e.sgt || '–', e.region, name, prev]
      : [weekly ? `${WEEKDAYS[new Date(d).getUTCDay()]} ${new Date(d).getUTCDate()}` + (e.sgt ? ' · ' + e.sgt : '') : e.sgt || '–', e.region, name, e.period || e.covers || '', actual, prev, el('span', { class: 'tag ' + e.conf.toLowerCase(), text: timing, title: timingTip }), e.src || ''];
    const cls = compact ? ['tm', 'reg', 'ev', 'num'] : ['tm', 'reg', 'ev', 'per', 'num', 'num', 'tim', 'src'];
    tb.append(el('tr', { class: 'row ' + st }, ...cells.map((x, i) => el('td', { class: cls[i] }, x))));
    csv.push([iso(d), e.sgt || '', e.region, e.name, ...(compact ? [e.prev || ''] : [e.period || '', e.actual || '', e.prev || '', timing, e.src || ''])]);
  }
  tbl.append(tb);
  if (!list.length) tb.append(el('tr', {}, el('td', { colspan: heads.length, class: 'muted', text: 'Nothing in this period for the regions selected.' })));
  return [tbl, tb, csv];
}
function buildCalendar() {
  const panel = $('#tab-calendar');
  const nav = el('div', { class: 'subtabs', role: 'tablist', 'aria-label': 'Period' });
  CAL_VIEWS.forEach(([lab], i) => nav.append(el('button', { type: 'button', role: 'tab', text: lab, 'data-i': i, onclick: () => { state.sub.calendar = i; renderTab(); } })));
  const chips = el('div', { class: 'seg-chips', role: 'group', 'aria-label': 'Regions' });
  const all = el('button', { type: 'button', text: 'All regions', onclick: () => { state.calRegions = new Set(CAL_REGIONS); renderCalendar(); } });
  chips.append(all);
  for (const r of CAL_REGIONS) chips.append(el('button', { type: 'button', text: r, 'data-r': r, title: 'Click to show only this region; Ctrl/⌘-click to add or remove it',
    onclick: ev => { if (ev.ctrlKey || ev.metaKey) { state.calRegions.has(r) ? state.calRegions.delete(r) : state.calRegions.add(r); if (!state.calRegions.size) state.calRegions.add(r); }
      else state.calRegions = state.calRegions.size === 1 && state.calRegions.has(r) ? new Set(CAL_REGIONS) : new Set([r]); renderCalendar(); } }));
  const key = el('label', { class: 'mini-label small' }, el('input', { type: 'checkbox', onchange: ev => { state.calKey = ev.target.checked; renderCalendar(); } }), el('span', { text: '★ Key events only' }));
  const g = el('div', { class: 'grid' });
  panel.append(nav, el('div', { class: 'perf-bar cal-bar' }, chips, key), g);
  makeCard(g, { key: 'cal', range: false, title: 'Economic calendar', wide: true, render: renderCalCard });
  const r = cards.cal.root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true;
}
function renderCalendar() {
  const panel = $('#tab-calendar'), cur = state.sub.calendar || 0;
  panel.querySelectorAll('.subtabs button').forEach(b => b.setAttribute('aria-selected', +b.dataset.i === cur));
  const one = state.calRegions.size === 1 ? [...state.calRegions][0] : null, allOn = state.calRegions.size === CAL_REGIONS.length;
  panel.querySelectorAll('.cal-bar .seg-chips button').forEach(b => b.setAttribute('aria-selected', b.dataset.r ? (!allOn && state.calRegions.has(b.dataset.r)) : allOn));
  cards.cal.render();
  if (one) cards.cal.titleEl.textContent = `Economic calendar: ${one}`;
}
function renderCalCard(c) {
  const b = htmlBody(c);
  c.titleEl.textContent = 'Economic calendar';
  if (!CAL || !CAL.events) { b.append(el('div', { class: 'empty', text: 'The calendar arrives with the next full data refresh.' })); c.csv = null; return; }
  const [lab, view] = CAL_VIEWS[state.sub.calendar || 0], today = sgToday(), ws = weekOf(today);
  const span = { this: `${dShort(ws)} – ${dShort(ws + 6 * DAY)}`, next: `${dShort(ws + 7 * DAY)} – ${dShort(ws + 13 * DAY)}`, later: `from ${dShort(ws + 14 * DAY)} to ${dShort(dayMs(CAL.end))}`, past: 'last 3 weeks' }[view];
  c.subEl.textContent = `${lab}: ${span}. Times are Singapore/Malaysia time (UTC+8); “+1 day” means the next morning here. ★ = key event.`;
  const list = calRows(view);
  const byWeek = view === 'later' || view === 'past';
  const [tbl, tb, csv] = calTable(list, today, { weekly: byWeek });
  b.append(el('div', { class: 'table-wrap' }, tbl));
  foldableGroups(tb, 'cal', byWeek ? (name, i) => i > 0 : null);
  c.csv = csv;
  const notes = [`${list.length} events.`,
    'Timing: “Scheduled” = date from the agency’s own release calendar (US and euro area, via FRED); “Confirmed” = central bank meeting schedule; “Window” = estimated from the usual release pattern (Malaysia, Singapore, Australia, China, Japan, Korea), so check the agency for the exact day.',
    'Actual = the number that release printed, from this dashboard’s data; Previous = the reading before it (for upcoming events, the latest reading). No consensus column: there is no free source of economist forecasts.',
    ...(CAL.notes || [])];
  setNote(c, notes.join(' '));
  setSource(c, `FRED release calendar (US, euro area); Federal Reserve, ECB, Bank of Japan, Bank Negara Malaysia, RBA, Bank of England and MAS schedules (checked ${CAL.verified_on}); release windows estimated from DOSM, SingStat, ABS, NBS, Statistics Bureau of Japan and Korea Customs patterns. Built ${CAL.generated}.`);
}
function renderCalNext(c) {
  const b = htmlBody(c);
  if (!CAL || !CAL.events) { b.append(el('div', { class: 'empty', text: 'The calendar arrives with the next full data refresh.' })); return; }
  const today = sgToday();
  const list = CAL.events.filter(e => e.hi).map(e => { const [a, z] = calSpan(e); return { e, a, z }; })
    .filter(({ a, z }) => z >= today && a <= today + 7 * DAY).map(({ e, a }) => ({ e, day: Math.max(a, today) }))
    .sort((x, y) => (x.day - y.day) || (x.e.sgt || '99').localeCompare(y.e.sgt || '99'));
  const [tbl, tb, csv] = calTable(list, today, { compact: true });
  b.append(el('div', { class: 'table-wrap' }, tbl));
  c.csv = csv;
  setNote(c, 'Estimated windows (Asian releases) are listed from today until the window closes.');
}

// ------------------------------------------------------------------ sub-tabs
// Each page is split into sub-tabs so only one section shows at a time. Entries are card keys or '#element-id'.
const SUBTABS = {
  overview: [['Today', ['points', 'changes', 'moved', 'fragile', 'headlines', 'cal_next']], ['Where we are', ['where']]],
  liquidity: [['Fed & reserves', ['netliq', 'comp', 'fund', 'scarcity', 'gcb']], ['Credit, money & rates', ['credit', 'nfci', 'm2', 'rates']]],
  markets: [['Performance', ['rebased', 'yields', '#perfCard']], ['Breadth', ['#brKpis', 'br_trend', 'br_hl', 'br_ew', 'br_table']], ['Styles & sectors', ['sty_ratio', 'sty_sect', 'sty_style']], ['Commodities', ['cm_rebased', 'cm_palm', 'cm_iron', 'cm_table']]],
  cbwatch: [['Policy monitor', ['cb_table', 'cb_rates', 'cb_real']],
    ['Path vs dots', ['fp_path', 'fp_years'], 'Fed'], ['By meeting', ['fp_table', 'fp_bars'], 'Fed'], ['Pricing history', ['fp_hist', 'fp_2y'], 'Fed'],
    ...Object.keys(CBS).map(k => [CBS[k].sub, [`cb_path_${k}`, `cb_spread_${k}`, `cb_info_${k}`], 'Asia & Europe'])],
  regime: [['Regime now', ['#regMethod', '#regNow', 'quad', 'comp_gi', 'reghist', 'regtable'], 'Regime'], ['What’s driving it', ['reg_contrib', 'reg_now', 'zin'], 'Regime'],
    ['Indicators', ['lei', 'leidrv', 'leadlag', 'cli'], 'Leading'], ['US ISM', ['ism_main', 'ism_ip', 'ism_sv', 'bc_mkt', 'ism_rule'], 'Leading'],
    ['Global business cycle', ['bc_all', 'bc_table', 'bc_cn', 'bc_my', 'bc_ea'], 'Leading'], ['Market signals', ['cugold', 'cycdef'], 'Leading'],
    ['Recession watch', ['gdpnow', 'sahm', 'recprob', 'infl', 'claims'], 'Risk']],
  fixed: [['Curves', ['curve', 'xcurve', 'slopes']], ['Yields', ['teny', 'real']], ['FX & hedging', ['diff', 'hedged']]],
  asia: [['Markets & rates', ['myrfx', 'myrtbl', 'myrates', 'mylend'], 'Malaysia'], ['Economy', ['mylead', 'mygrowth', 'mytrade', 'myprices', 'mymoney'], 'Malaysia'],
    ['Singapore', ['sgrates', 'sgust', 'sghedge', 'sneer', 'sginfl', 'sggrowth'], 'Region'], ['Australia', ['aurates', 'auinfl', 'audiff', 'augrowth', 'autot'], 'Region'],
    ['China', ['cn_infl', 'cn_trade', 'cn_conf', 'cn_spread'], 'Region'], ['Japan', ['jp_infl', 'jp_policy', 'jp_tankan', 'jp_act', 'jp_boj'], 'Region'],
    ['Across Asia', ['ax_cpi', 'ax_exp', 'ax_10y', 'ax_short', 'ax_ip', 'ax_conf'], 'Compare'], ['Asian FX', ['asiafx', 'asiaidx'], 'Compare']],
  ai: [['Adoption', ['ai_usage', 'ai_share', 'ai_hist']], ['Prices & cost', ['ai_frontier', 'ai_cpr']], ['Build-out', ['ai_bench', 'ai_rev', 'ai_dc', 'ai_chips']], ['AI stocks', ['ai_eq']], ['Chip cycle', ['chip_rs', 'chip_kr', 'chip_my']]],
  valuation: [['Scorecard', ['val_table']], ['US equities', ['val_cape', 'val_fwd', 'val_erp']], ['Bonds, FX & global', ['val_tp', 'val_reer', 'val_stretch']]],
  posvol: [['Volatility', ['vol_ts', 'vol_x', 'vol_ratio', 'vol_ivrv']], ['Positioning (CFTC)', ['pos_table', 'pos_ext', 'pos_hist']], ['Sentiment', ['sent_fg', 'sent_aaii', 'sent_naaim', 'sent_table']]],
  stress: [['Stress composite', ['st_hist', 'st_heat', 'st_ofr']], ['Where everything stands', ['st_table']], ['Peak signposts', ['sg_grid', 'sg_share', 'sg_rules']]],
  correlation: [['Matrix & shifts', ['matrix', 'shifts']], ['Rolling correlation', ['pair']], ['Lead-lag', ['ll_chart', 'll_bars', 'll_table']]],
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
    groups.forEach(([label, , grp], i) => {
      if (grp && grp !== (groups[i - 1] || [])[2]) nav.append(el('span', { class: 'subtab-group', text: grp }));
      else if (!grp && i && groups[i - 1][2]) nav.append(el('span', { class: 'subtab-group', text: '' }));
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

// ------------------------------------------------------------------ SEARCH (Ctrl+K, "/", or the sidebar button)
// Finds pages, sections, charts (by title, description and data source) and markets; Enter opens it.
function searchIndex() {
  const out = [], seen = new Set();
  for (const [t, title] of Object.entries(TAB_TITLES)) if ($('#tab-' + t)) out.push({ kind: 'Page', label: title, where: '', tab: t, hay: title });
  for (const [t, groups] of Object.entries(SUBTABS)) groups.forEach(([lab, , grp], i) => out.push({ kind: 'Section', label: lab, where: TAB_TITLES[t] + (grp ? ' · ' + grp : ''), tab: t, sub: i, hay: [lab, grp, TAB_TITLES[t]].join(' ') }));
  for (const c of Object.values(cards)) {
    const panel = c.root.closest('.tab-panel'); if (!panel) continue;
    const t = panel.id.slice(4), sub = c.root.dataset.sub != null ? +c.root.dataset.sub : null, label = c.titleEl.textContent || c.title;
    out.push({ kind: 'Chart', label, where: (TAB_TITLES[t] || t) + (sub != null && SUBTABS[t] ? ' → ' + SUBTABS[t][sub][0] : ''), tab: t, sub, card: c,
      hay: [label, c.title, c.subEl.textContent, c.source].join(' ') });
  }
  for (const r of perfRows()) if (!seen.has(r.id)) { seen.add(r.id); out.push({ kind: 'Market', label: r.s.label, where: 'Markets → Performance', tab: 'markets', sub: 0, asset: r, hay: [r.s.label, r.id, r.s.group, r.s.source].join(' ') }); }
  return out;
}
function searchFind(q, idx) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return [];
  const rank = { Market: 0, Chart: 1, Section: 2, Page: 3 };
  return idx.map(x => { const h = x.hay.toLowerCase(), l = x.label.toLowerCase();
      if (!words.every(w => h.includes(w))) return null;
      const score = (l.startsWith(words[0]) ? 0 : l.includes(words[0]) ? 1 : 2) * 10 + rank[x.kind];
      return { ...x, score }; }).filter(Boolean).sort((a, b) => a.score - b.score).slice(0, 14);
}
function searchGo(x) {
  closeSearch();
  setTab(x.tab);
  if (x.sub != null && SUBTABS[x.tab]) setSub(x.tab, x.sub);
  if (x.asset) { state.perfClass = 'All'; state.perfQuery = x.asset.s.label; const box = $('#perfCard .perf-search'); if (box) box.value = x.asset.s.label; renderPerfTable(); }
  const target = x.card ? x.card.root : x.asset ? $('#perfCard') : null;
  if (target) setTimeout(() => { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); target.classList.remove('flash'); void target.offsetWidth; target.classList.add('flash'); }, 120);
}
let searchIdx = null;
function openSearch() {
  const dlg = $('#searchDlg'), input = $('#searchInput');
  searchIdx = searchIndex(); dlg.hidden = false; input.value = ''; renderSearch(''); input.focus();
}
function closeSearch() { $('#searchDlg').hidden = true; }
function renderSearch(q) {
  const list = $('#searchList'), res = searchFind(q, searchIdx || []);
  list.replaceChildren(...res.map((x, i) => el('li', { class: i === 0 ? 'on' : '', role: 'option', onclick: () => searchGo(x) },
    el('span', { class: 'sr-kind', text: x.kind }), el('span', { class: 'sr-label', text: x.label }), el('span', { class: 'sr-where', text: x.where }))));
  list.results = res;
  $('#searchEmpty').hidden = !q || res.length > 0;
}
function buildSearch() {
  const input = el('input', { id: 'searchInput', type: 'search', placeholder: 'Search charts, markets, pages…  e.g. palm, KLCI, BNM, ISM', 'aria-label': 'Search the dashboard', autocomplete: 'off' });
  const list = el('ul', { id: 'searchList', role: 'listbox' });
  const dlg = el('div', { id: 'searchDlg', class: 'search-dlg', hidden: true, role: 'dialog', 'aria-label': 'Search' },
    el('div', { class: 'search-box' }, input, list, el('div', { id: 'searchEmpty', class: 'muted small search-empty', text: 'Nothing found. Try a market, a country, a data source or a chart name.', hidden: true }),
      el('div', { class: 'search-foot' }, '↑↓ to move · Enter to open · Esc to close')));
  dlg.addEventListener('click', e => { if (e.target === dlg) closeSearch(); });
  input.addEventListener('input', () => renderSearch(input.value));
  input.addEventListener('keydown', e => {
    const items = [...list.children], i = items.findIndex(li => li.classList.contains('on'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!items.length) return; const j = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items.forEach((li, k) => li.classList.toggle('on', k === j)); items[j].scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { const r = list.results || []; if (r[Math.max(0, i)]) searchGo(r[Math.max(0, i)]); }
    else if (e.key === 'Escape') closeSearch();
  });
  document.body.append(dlg);
  const btn = el('button', { type: 'button', class: 'side-search', onclick: openSearch }, el('span', { text: '⌕  Search' }), el('kbd', { text: 'Ctrl K' }));
  $('#side .side-head').after(btn);
  document.addEventListener('keydown', e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openSearch(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); openSearch(); }
  });
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
// ---- tiles: at most 5 per sub-tab, chosen for that sub-tab (label prefixes, in order); no set = the first 5
const TILE_MAX = 5;
const TILE_SETS = {
  overview: { '*': ['Macro regime', 'Fed net liquidity', 'Stress composite', 'Equity breadth', 'US dollar'] },
  regime: {
    'Regime now': ['Confirmed regime', 'Growth momentum', 'Inflation momentum', 'Latest signal', 'Signal strength'],
    'Indicators': ['Confirmed regime', 'Growth level', 'Growth momentum', 'Recession odds'],
    'Market signals': ['Confirmed regime', 'Growth momentum', 'Inflation momentum'],
    'What’s driving it': ['Confirmed regime', 'Growth momentum', 'Inflation momentum', 'Growth level', 'Core CPI'],
    'Recession watch': ['GDPNow', 'Sahm rule', 'Recession odds', 'Core CPI', 'Growth level'],
  },
  stress: {
    'Stress composite': ['Stress composite', 'Funding block', 'Credit block', 'Growth block', 'OFR FSI'],
    'Where everything stands': ['Stress composite', 'Funding block', 'Credit block', 'Growth block'],
    'Peak signposts': ['Signposts triggered', 'Average at prior peaks', 'Stress composite'],
  },
  liquidity: {
    'Fed & reserves': ['Fed net liquidity', 'Bank reserves', 'Treasury cash', 'Reverse repo', 'SOFR − IORB'],
    'Credit, money & rates': ['US HY spread', 'Financial conditions', 'Fed net liquidity'],
  },
  asia: {
    'Singapore': ['3M compounded SORA', 'SGS 10Y yield', 'USD/SGD', 'S$NEER proxy pace', 'MAS core inflation'],
    'Asian FX': ['USD/MYR', 'USD/SGD', 'Malaysia OPR', '3M compounded SORA', 'RBA cash rate'],
  },
  ai: {
    'Adoption': ['OpenRouter weekly tokens', 'Avg price paid', 'Avg cost per request', 'Frontier model'],
    'Prices & cost': ['Avg price paid', 'Avg cost per request', 'Cheapest near-frontier', 'Frontier model'],
    'Build-out': ['Frontier model', 'OpenRouter weekly tokens', 'AI equity basket'],
    'AI stocks': ['AI equity basket'],
    'Chip cycle': ['AI equity basket'],
  },
};
function fitTiles(tab) {
  const panel = $('#tab-' + tab); if (!panel) return;
  const sub = ((SUBTABS[tab] || [])[state.sub[tab] || 0] || [])[0], sets = TILE_SETS[tab] || {}, want = sets[sub] || sets['*'];
  for (const box of panel.querySelectorAll('.kpis')) {
    // tiles hidden by a page's own filter stay hidden; tiles this function hid last time come back first
    box.querySelectorAll('.kpi[data-fit]').forEach(k => { k.hidden = false; delete k.dataset.fit; });
    const live = [...box.querySelectorAll('.kpi')].filter(k => !k.hidden);
    const lab = k => (k.querySelector('.k-label') || {}).textContent || '';
    let keep = live;
    if (want) keep = want.map(w => live.find(k => lab(k).startsWith(w))).filter(Boolean);
    if (!keep.length) keep = live;
    keep = keep.slice(0, TILE_MAX);
    for (const k of live) if (!keep.includes(k)) { k.hidden = true; k.dataset.fit = '1'; }
    keep.forEach((k, i) => { k.style.order = i; });
    // the date line is kept, but on one line; its full text shows on hover
    for (const k of keep) { const a = k.querySelector('.k-asof'); if (a && a.textContent) a.title = a.textContent; }
  }
}
function renderTab() {
  syncFilterUI();
  ({ overview: renderOverview, news: renderNews, calendar: renderCalendar, cbwatch: renderCbWatch, ideas: renderIdeas, weekly: renderWeekly, liquidity: renderLiquidity, regime: renderRegime, fixed: renderFixedIncome, asia: renderAsia, ai: renderAI, valuation: renderValuation, health: renderHealth, posvol: renderPosVol, stress: renderStress, markets: renderMarkets, correlation: renderCorrelation })[state.tab]();
  fitTiles(state.tab);
}
const TAB_TITLES = { overview: 'Strategist View', news: 'News', calendar: 'Economic calendar', ideas: 'Idea log', weekly: 'Weekly one-page brief', cbwatch: 'Central banks', regime: 'Regime & Leading Indicators', liquidity: 'Liquidity', asia: 'Asia',
  markets: 'Markets', fixed: 'Fixed Income', correlation: 'Correlation', ai: 'AI: adoption, prices & capex', valuation: 'Valuation', health: 'Data health', posvol: 'Positioning & Volatility', stress: 'Stress & Peak Signposts' };
function setTab(t) {
  state.tab = t;
  $('#pageTitle').textContent = TAB_TITLES[t] || '';
  // section label above the title: the sidebar group the page sits in
  let g = document.querySelector(`.tabs button[data-tab="${t}"]`); while (g && !g.classList.contains('nav-group')) g = g.previousElementSibling;
  $('#pageGroup').textContent = g ? g.textContent : '';
  setGreeting();
  $('#side').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false');
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === t));
  document.querySelectorAll('.tab-panel').forEach(p => p.hidden = p.id !== 'tab-' + t);
  $('.filters').hidden = t === 'news' || t === 'calendar' || t === 'weekly' || t === 'ideas';
  setFiltersHeight();
  renderTab();
}
function setGreeting() {   // friendly line in Singapore/Malaysia time
  const n = new Date(Date.now() + 8 * 3600e3), h = n.getUTCHours();
  const hello = h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  const day = `${WEEKDAYS[n.getUTCDay()]} ${n.getUTCDate()} ${MONTHS[n.getUTCMonth()]} · ${String(h).padStart(2, '0')}:${String(n.getUTCMinutes()).padStart(2, '0')} SGT`;
  const el_ = $('#greet'); if (!el_) return;
  el_.replaceChildren(el('b', { text: hello }), ` · ${day}` + (state.latest ? ` · markets to ${nice(state.latest)}` : ''));
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
  const [meta, y, f, d, cv, as, cb] = await Promise.allSettled(['data/meta.json', 'data/yahoo.json', 'data/fred.json', 'data/derived.json', 'data/curves.json', 'data/asia.json', 'data/cbwatch.json'].map(loadJSON));
  await loadNews();
  try { AI = await loadJSON('data/ai.json'); } catch (e) { AI = null; }
  try { HEALTH = await loadJSON('data/health.json'); } catch (e) { HEALTH = null; }
  try { POS = await loadJSON('data/positioning.json'); } catch (e) { POS = null; }
  try { SENT = await loadJSON('data/sentiment.json'); } catch (e) { SENT = null; }
  try { SIGN = await loadJSON('data/signposts.json'); } catch (e) { SIGN = null; }
  try { STR = await loadJSON('data/stress.json'); } catch (e) { STR = null; }
  try { CAL = await loadJSON('data/calendar.json'); } catch (e) { CAL = null; }
  try { FP = await loadJSON('data/fedpath.json'); } catch (e) { FP = null; }
  setInterval(async () => { await loadNews(); if (state.tab === 'news') renderNews(); }, 10 * 60 * 1000);
  META = meta.status === 'fulfilled' ? meta.value : {};
  if (SENT && SENT.series) for (const [id, x] of Object.entries(SENT.series)) { S[id] = { id, ...x, t: x.d.map(v => v * DAY), v: x.v }; delete S[id].d; }
  for (const res of [y, f, d, as, cb]) if (res.status === 'fulfilled') {
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
  ismPrep();
  buildOverview(); buildLiquidity(); buildRegime(); buildFixedIncome(); buildAsia(); buildCnJp(); buildAI(); buildChip(); buildValuation(); buildPosVol(); buildSentiment(); buildStress(); buildMarkets(); buildBreadth(); buildStyles(); buildCommod(); buildCorrelation(); buildLeadLag(); buildFedPath(); buildCbWatch(); applySources(); applyPairToggles(); wire();
  if (h.get('tab') === 'cnjp') { h.set('tab', 'asia'); h.set('sub', String(4 + (+h.get('sub') || 0))); }
  if (h.get('tab') === 'fedpath') { h.set('tab', 'cbwatch'); h.set('sub', String(1 + (+h.get('sub') || 0))); }
  const nSub = t => (SUBTABS[t] || (t === 'calendar' ? CAL_VIEWS : t === 'ideas' ? IDEA_VIEWS : [])).length;
  if (h.get('tab') && +h.get('sub') > 0 && +h.get('sub') < nSub(h.get('tab'))) state.sub[h.get('tab')] = +h.get('sub');
  buildSubtabs();
  buildSearch();
  buildCalendar(); buildWeekly(); buildIdeas();
  setTimeout(loadTickers, 50);   // ~2 MB of ticker history: loaded after the first page is drawn
  setTab(['overview', 'news', 'calendar', 'weekly', 'ideas', 'cbwatch', 'liquidity', 'regime', 'fixed', 'asia', 'markets', 'correlation', 'ai', 'valuation', 'health', 'posvol', 'stress'].includes(h.get('tab')) ? h.get('tab') : 'overview');
}
init();
