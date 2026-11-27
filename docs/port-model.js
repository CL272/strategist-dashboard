// Portfolio maths for the allocator (Design plan 4, Step 2). Plain functions, shared by the page (port.js) and the check
// (tools/port-check.js); no page code here. Returns are weekly (the week ending Friday). Both the portfolio and the
// benchmark are held at their target weights (rebalanced every week), so with a = portfolio weights − benchmark weights
// and Σ = the sample covariance of weekly returns:
//   tracking error = √(52 · aᵀΣa), which equals the standard deviation of the weekly return gaps × √52 exactly;
//   share of holding i = aᵢ(Σa)ᵢ ÷ aᵀΣa (the shares sum to 100%; a negative share offsets).
// History, not a forecast. Every figure is in percent.
(function (g) {
  'use strict';
  const DAY = 864e5;
  // Saturday to Friday share one key (the week ending Friday), whatever day that week's last close was made
  const weekKey = t => Math.floor((Math.round(t / DAY) - 2) / 7);
  const sum = a => a.reduce((s, x) => s + x, 0);
  const mean = a => a.length ? sum(a) / a.length : 0;
  function sd(a) { const n = a.length; if (n < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1)); }
  function cov2(a, b) { const n = a.length; if (n < 2) return 0; const ma = mean(a), mb = mean(b); let s = 0; for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb); return s / (n - 1); }

  // Weekly closes of several series on the weeks they all have, from `from` to `to` (ms). list: [{t: [ms], v: [prices]}].
  // Returns { dates: the day each shared week's data runs to (the earliest of the series' last closes that week),
  //           R: weekly returns (rows = weeks after the first, columns = series), n: rows, first: each series' first date }.
  function pmAlign(list, from = -Infinity, to = Infinity) {
    if (!list.length) return { dates: [], R: [], n: 0, first: [] };
    const maps = list.map(s => { const m = new Map(); for (let i = 0; i < s.t.length; i++) { const t = s.t[i], v = s.v[i]; if (t < from || t > to || !(v > 0)) continue; m.set(weekKey(t), [t, v]); } return m; });
    const first = list.map(s => { for (let i = 0; i < s.t.length; i++) if (s.v[i] > 0) return s.t[i]; return null; });
    const keys = [...maps[0].keys()].filter(k => maps.every(m => m.has(k))).sort((x, y) => x - y);
    const dates = keys.map(k => Math.min(...maps.map(m => m.get(k)[0]))), P = keys.map(k => maps.map(m => m.get(k)[1]));
    const R = []; for (let i = 1; i < P.length; i++) R.push(P[i].map((v, j) => v / P[i - 1][j] - 1));
    return { dates, R, n: R.length, first };
  }
  // sample covariance matrix of the columns of R
  function pmCov(R) {
    const n = R.length, k = n ? R[0].length : 0, m = Array.from({ length: k }, (_, j) => mean(R.map(r => r[j])));
    const C = Array.from({ length: k }, () => new Array(k).fill(0));
    if (n < 2) return { C, mean: m };
    for (const r of R) for (let i = 0; i < k; i++) { const di = r[i] - m[i]; for (let j = i; j < k; j++) C[i][j] += di * (r[j] - m[j]); }
    for (let i = 0; i < k; i++) for (let j = i; j < k; j++) { C[i][j] /= n - 1; C[j][i] = C[i][j]; }
    return { C, mean: m };
  }
  // weights in the order of ids, from {id: weight}; negative weights count as 0; scaled to sum 1
  function pmVec(ids, obj) { const v = ids.map(id => Math.max(0, +(obj[id] || 0))), s = sum(v); return s > 0 ? v.map(x => x / s) : v; }
  // tracking error (% a year) from a weekly covariance matrix and two weight vectors that already sum to 1
  function pmTE(C, w, b) {
    const a = w.map((x, i) => x - b[i]); let q = 0;
    for (let i = 0; i < a.length; i++) { if (!a[i]) continue; for (let j = 0; j < a.length; j++) q += a[i] * C[i][j] * a[j]; }
    return Math.sqrt(Math.max(q, 0) * 52) * 100;
  }
  function drawdown(r) { let v = 1, peak = 1, worst = 0; for (const x of r) { v *= 1 + x; peak = Math.max(peak, v); worst = Math.min(worst, v / peak - 1); } return worst * 100; }
  function cum(r) { const out = [100]; let v = 100; for (const x of r) { v *= 1 + x; out.push(v); } return out; }

  // everything the Portfolio sub-tab shows, for one aligned window and two weight vectors (any scale)
  function pmStats(A, w, b) {
    const R = A.R, n = R.length; if (n < 2) return null;
    const s1 = v => { const t = sum(v.map(x => Math.max(0, x))); return t > 0 ? v.map(x => Math.max(0, x) / t) : v; };
    const W = s1(w), B = s1(b), a = W.map((x, i) => x - B[i]), { C } = pmCov(R);
    const Ca = C.map(row => row.reduce((s, c, j) => s + c * a[j], 0)), q = a.reduce((s, x, i) => s + x * Ca[i], 0);
    const pr = R.map(r => r.reduce((s, x, j) => s + x * W[j], 0)), br = R.map(r => r.reduce((s, x, j) => s + x * B[j], 0)), gap = pr.map((x, i) => x - br[i]);
    const yrs = (A.dates[A.dates.length - 1] - A.dates[0]) / (365.25 * DAY);
    const ann = r => { const g = r.reduce((v, x) => v * (1 + x), 1); return yrs > 0 ? (Math.pow(g, 1 / yrs) - 1) * 100 : null; };
    const vb = cov2(br, br), retP = ann(pr), retB = ann(br);
    return {
      te: Math.sqrt(Math.max(q, 0) * 52) * 100, teReal: sd(gap) * Math.sqrt(52) * 100,
      share: a.map((x, i) => q > 0 ? x * Ca[i] / q * 100 : 0), active: a.map(x => x * 100),
      beta: vb > 0 ? cov2(pr, br) / vb : null, corr: sd(pr) > 0 && sd(br) > 0 ? cov2(pr, br) / (sd(pr) * sd(br)) : null,
      volP: sd(pr) * Math.sqrt(52) * 100, volB: sd(br) * Math.sqrt(52) * 100, retP, retB, activeRet: retP != null && retB != null ? retP - retB : null,
      ddP: drawdown(pr), ddB: drawdown(br), cumP: cum(pr), cumB: cum(br), gap, weeks: n, from: A.dates[0], to: A.dates[A.dates.length - 1], yrs,
    };
  }

  // Add x% of fund k (x points of the whole portfolio after the change). Paid for by 'all' (every other holding in
  // proportion), 'cash' (the holding CASH, then the rest in proportion) or 'one:<id>' (that holding, then the rest in
  // proportion). No weight goes below zero. w: {id: weight}, any scale; returns {id: weight %} summing to 100.
  function pmAdd(w, k, x, how = 'all') {
    const tot = sum(Object.values(w).map(v => Math.max(0, +v || 0))) || 1, out = {};
    for (const [id, v] of Object.entries(w)) out[id] = Math.max(0, +v || 0) / tot * 100;
    if (!Object.keys(w).length) { out[k] = 100; return out; }
    x = Math.max(0, Math.min(100, +x || 0));
    let need = x;
    const take = id => { if (id === k || !(out[id] > 0)) return; const t = Math.min(out[id], need); out[id] -= t; need -= t; };
    if (how === 'cash') take('CASH'); else if (String(how).startsWith('one:')) take(String(how).slice(4));
    if (need > 1e-12) {
      const others = Object.keys(out).filter(id => id !== k && out[id] > 0), pool = sum(others.map(id => out[id]));
      if (pool > 0) { const f = Math.min(1, need / pool); for (const id of others) out[id] -= out[id] * f; need = Math.max(0, need - pool); }
    }
    out[k] = (out[k] || 0) + (x - need);
    for (const id of Object.keys(out)) if (out[id] < 1e-12) out[id] = 0;
    return out;
  }
  // Design plan 6, Step 2: set holding k to `to` percent of the portfolio; the rest makes room or takes up the slack. how =
  // 'all' (every other unlocked holding in proportion to its weight) or 'cash' (the holding CASH first, created when weight
  // is given back and there is none; then the rest in proportion). Locked holdings never move. If the others cannot supply
  // the whole rise, k gets what there is; a fall with nothing else unlocked goes to cash. w: {id: weight}, any scale.
  // Returns {id: weight %} summing to 100; rounded to 0.01 unless round = false (the remainder to the largest unlocked holding).
  function pmSet(w, k, to, how = 'all', locked = [], round = true) {
    const tot = sum(Object.values(w).map(v => Math.max(0, +v || 0))), out = {};
    for (const [id, v] of Object.entries(w)) out[id] = tot > 0 ? Math.max(0, +v || 0) / tot * 100 : 0;
    if (!(k in out)) out[k] = 0;
    const lock = new Set(locked); lock.delete(k);
    const fixed = sum([...lock].filter(id => id in out).map(id => out[id]));
    to = Math.max(0, Math.min(+to || 0, 100 - fixed));
    const free = () => Object.keys(out).filter(id => id !== k && !lock.has(id));
    let d = to - out[k];
    if (d > 1e-12) {   // k rises: take from the others
      if (how === 'cash' && 'CASH' in out && !lock.has('CASH')) { const t = Math.min(out.CASH, d); out.CASH -= t; d -= t; }
      const F = free().filter(id => out[id] > 0), pool = sum(F.map(id => out[id]));
      if (d > 1e-12 && pool > 0) { const f = Math.min(1, d / pool); for (const id of F) out[id] -= out[id] * f; d = Math.max(0, d - pool); }
      out[k] = to - d;
    } else if (d < -1e-12) {   // k falls: give back
      const give = -d, F = free().filter(id => out[id] > 0), pool = sum(F.map(id => out[id]));
      if (how === 'cash' && !lock.has('CASH')) out.CASH = (out.CASH || 0) + give;
      else if (pool > 0) for (const id of F) out[id] += out[id] / pool * give;
      else if (!lock.has('CASH')) out.CASH = (out.CASH || 0) + give;
      else return pmSet(w, k, out[k] + 0, how, locked, round);   // nowhere to put it: nothing changes
      out[k] = to;
    }
    for (const id of Object.keys(out)) if (out[id] < 1e-12) out[id] = 0;
    if (!round) return out;
    for (const id of Object.keys(out)) out[id] = Math.round(out[id] * 100) / 100;
    const rest = Math.round((100 - sum(Object.values(out))) * 100) / 100;
    if (rest) { const F = free().filter(id => out[id] > 0).sort((a, z) => out[z] - out[a]); const to2 = F[0] || k; out[to2] = Math.round((out[to2] + rest) * 100) / 100; }
    return out;
  }
  // tracking error for x = xs (default 0, 5, … 50) of fund k; ids are the columns of A and must include k. Without `locked`,
  // x is the weight added (pmAdd, Design plan 4); with `locked` (an array, maybe empty), x is k's whole weight, set with pmSet
  function pmCurve(A, ids, w, b, k, how = 'all', xs = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50], locked = null) {
    const { C } = pmCov(A.R), B = pmVec(ids, b);
    return xs.map(x => [x, pmTE(C, pmVec(ids, locked ? pmSet(w, k, x, how, locked, false) : pmAdd(w, k, x, how)), B)]);
  }
  // Target a tracking error: the weight of fund k (0 to xmax points of the whole portfolio, paid for as in pmAdd) at which
  // the tracking error first reaches `target` (% a year). It searches every `step` points from 0, then halves the interval
  // where it first crosses the target, to 1e-7 of a point. From above ('down'), x is the smallest weight that brings the
  // tracking error down to the target; from below ('up'), the largest weight that keeps it within the target. x is null when
  // no weight up to xmax reaches it; lo and hi are the lowest and highest points found ([x, te]); te0 = nothing added.
  function pmTarget(A, ids, w, b, k, how = 'all', target = 3, xmax = 100, step = 0.1, locked = null) {   // with `locked`: x = k's whole weight (pmSet)
    const { C } = pmCov(A.R), B = pmVec(ids, b), f = x => pmTE(C, pmVec(ids, locked ? pmSet(w, k, x, how, locked, false) : pmAdd(w, k, x, how)), B);
    const te0 = f(0), s0 = te0 - target, out = { te0, target, dir: Math.abs(s0) < 1e-9 ? 'at' : s0 > 0 ? 'down' : 'up', x: null };
    if (out.dir === 'at') out.x = 0;
    let lo = [0, te0], hi = [0, te0], px = 0;
    const n = Math.round(xmax / step);
    for (let i = 1; i <= n; i++) {
      const x = Math.min(xmax, i * step), v = f(x);
      if (v < lo[1]) lo = [x, v];
      if (v > hi[1]) hi = [x, v];
      if (out.x == null && (v - target) * s0 <= 0) {   // first crossing: f(px) is still on the starting side, f(x) is not
        let a = px, z = x;
        for (let j = 0; j < 60 && z - a > 1e-7; j++) { const m = (a + z) / 2; if ((f(m) - target) * s0 > 0) a = m; else z = m; }
        out.x = z;
      }
      px = x;
    }
    out.lo = lo; out.hi = hi; out.teAt = out.x == null ? null : f(out.x);
    return out;
  }
  // tracking error over the 52 weeks to each week: [[date, % a year]]
  function pmRolling(A, w, b, n = 52) {
    const st = pmStats(A, w, b); if (!st || st.gap.length < n) return [];
    const out = []; for (let i = n - 1; i < st.gap.length; i++) out.push([A.dates[i + 1], sd(st.gap.slice(i - n + 1, i + 1)) * Math.sqrt(52) * 100]);
    return out;
  }

  const api = { weekKey, pmAlign, pmCov, pmVec, pmTE, pmStats, pmAdd, pmSet, pmCurve, pmTarget, pmRolling };
  g.PM = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
