// Checks the portfolio maths (docs/port-model.js) behind Allocation → Portfolio and Add a fund. Run: node tools/port-check.js
// Run it after any change to port-model.js or to how port.js feeds it. Part 1 uses fixtures only (no network, no data);
// part 2 uses docs/data/funds.json and yahoo.json when they are on disk (copy them from the live site for a local run).
const fs = require('fs'), path = require('path');
const M = require('../docs/port-model.js');
const fails = [], ok = (cond, msg) => { if (!cond) fails.push(msg); console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`); };
const close = (a, b, tol) => Math.abs(a - b) <= tol;
const DAY = 864e5, FRI0 = Date.UTC(2020, 0, 3);   // a Friday

// ---------------------------------------------------------------- 1. fixtures
console.log('Portfolio maths: fixtures');
let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
function fixture(k, n) {   // k price series, n + 1 Fridays, correlated through a common factor
  const t = Array.from({ length: n + 1 }, (_, i) => FRI0 + i * 7 * DAY), list = [];
  const f = Array.from({ length: n }, () => gauss() * 0.02);
  for (let j = 0; j < k; j++) { const v = [100]; for (let i = 0; i < n; i++) v.push(v[i] * (1 + 0.001 * j + f[i] * (0.3 + 0.2 * j) + gauss() * 0.01 * (1 + j))); list.push({ t, v }); }
  return list;
}
{
  const A = M.pmAlign(fixture(5, 200)), w = [30, 25, 20, 15, 10], b = [10, 10, 20, 30, 30], st = M.pmStats(A, w, b);
  ok(A.n === 200 && A.R[0].length === 5, `align: 201 Fridays of 5 series give 200 weekly returns (${A.n})`);
  ok(close(st.te, st.teReal, 1e-9), `closed form equals realised tracking error (${st.te.toFixed(6)}% vs ${st.teReal.toFixed(6)}%)`);
  ok(close(st.share.reduce((s, x) => s + x, 0), 100, 1e-9), 'shares of tracking error sum to 100%');
  ok(M.pmStats(A, w, w).te < 1e-9, 'portfolio = benchmark gives zero tracking error');
  ok(close(M.pmStats(A, w.map(x => x * 7), b.map(x => x / 3)).te, st.te, 1e-9), 'weights in any scale (amounts) give the same result');
  const ids = ['a', 'b', 'c', 'd', 'e'], wo = Object.fromEntries(ids.map((id, i) => [id, w[i]])), bo = Object.fromEntries(ids.map((id, i) => [id, b[i]]));
  ok(close(M.pmCurve(A, ids, wo, bo, 'c')[0][1], st.te, 1e-9), 'the weight curve starts (0% added) at the current tracking error');
  const roll = M.pmRolling(A, w, b), last = M.pmStats({ dates: A.dates.slice(-53), R: A.R.slice(-52), n: 52 }, w, b);
  ok(roll.length === 149 && close(roll[roll.length - 1][1], last.te, 1e-9), `rolling 52-week tracking error ends at the last 52 weeks' figure (${roll[roll.length - 1][1].toFixed(4)}%)`);
}
{   // a three-asset case with a known answer: a = (0, ½, −½) and y − z alternates ±2% → TE = ½ · 2% · √(52 · n/(n−1))
  const n = 52, t = Array.from({ length: n + 1 }, (_, i) => FRI0 + i * 7 * DAY), x = [100], y = [100], z = [100];
  for (let i = 0; i < n; i++) { const c = 0.003 * Math.sin(i), d = i % 2 ? 0.02 : -0.02; x.push(x[i] * (1 + c)); y.push(y[i] * (1 + c + d)); z.push(z[i] * (1 + c)); }
  const st = M.pmStats(M.pmAlign([{ t, v: x }, { t, v: y }, { t, v: z }]), [50, 50, 0], [50, 0, 50]), want = 0.5 * 2 * Math.sqrt(52 * n / (n - 1));
  ok(close(st.te, want, 1e-9), `three-asset fixture: ${st.te.toFixed(4)}% = ½ × 2% × √(52 × 52/51) = ${want.toFixed(4)}%`);
}
{   // weeks: closes on different days of one week share it; a week missing in one series is left out for all
  const s1 = { t: [FRI0, FRI0 + 6 * DAY, FRI0 + 14 * DAY, FRI0 + 21 * DAY], v: [100, 101, 102, 103] };   // Fri, Thu, Fri, Fri
  const s2 = { t: [FRI0 - 2 * DAY, FRI0 + 7 * DAY, FRI0 + 21 * DAY], v: [50, 51, 52] };                      // Wed, Fri, (no week 3), Fri
  const A = M.pmAlign([s1, s2]);
  ok(A.dates.length === 3 && A.dates[1] === FRI0 + 6 * DAY, 'align: a Thursday and a Friday close fall in one week (dated the earlier); a week one series lacks is dropped');
}
{   // adding a fund
  const w = { A: 50, B: 30, CASH: 15, D: 5 };
  const z = M.pmAdd(w, 'E', 0); ok(Object.entries(w).every(([k, v]) => close(z[k], v, 1e-9)) && close(z.E, 0, 1e-9), 'adding 0% changes nothing');
  const a = M.pmAdd(w, 'A', 10); ok(close(a.A, 60, 1e-9) && close(Object.values(a).reduce((s, x) => s + x, 0), 100, 1e-9), 'adding 10% of a fund already held raises it by 10 points (50 → 60), total 100');
  const c = M.pmAdd(w, 'E', 10, 'cash'); ok(close(c.CASH, 5, 1e-9) && close(c.A, 50, 1e-9) && close(c.E, 10, 1e-9), 'paid from cash: cash 15 → 5, the rest unchanged');
  const c2 = M.pmAdd(w, 'E', 25, 'cash'); ok(c2.CASH === 0 && close(c2.E, 25, 1e-9) && close(c2.A + c2.B + c2.D, 75, 1e-9), 'paid from cash beyond the cash held: the rest comes from the others in proportion');
  let neg = false; for (const x of [0, 3, 5, 7, 20, 60, 100]) { const o = M.pmAdd(w, 'E', x, 'one:D'); if (Object.values(o).some(v => v < -1e-12) || !close(Object.values(o).reduce((s, v) => s + v, 0), 100, 1e-9)) neg = true; }
  ok(!neg, '“from one holding” never takes a weight below zero, and the total stays 100');
  ok(close(M.pmAdd({ A: 1, B: 3 }, 'C', 50).C, 50, 1e-9) && close(M.pmAdd({ A: 1, B: 3 }, 'C', 50).B, 37.5, 1e-9), 'amounts are scaled to 100% before the change');
}
{   // target a tracking error
  const A = M.pmAlign(fixture(3, 150)), ids = ['P', 'K', 'Z'];
  // portfolio all P, benchmark all K: adding x of K (paid for in proportion) gives a = (1 − x/100)(P − K), so TE(x) = (1 − x/100) · TE(0)
  const te0 = M.pmStats(A, [1, 0, 0], [0, 1, 0]).te, h = M.pmTarget(A, ids, { P: 100 }, { K: 100 }, 'K', 'all', te0 / 2), q = M.pmTarget(A, ids, { P: 100 }, { K: 100 }, 'K', 'all', te0 / 4);
  ok(h.dir === 'down' && close(h.x, 50, 1e-6) && close(q.x, 75, 1e-6), `target, known answer: half the tracking error at 50% of the benchmark's fund, a quarter at 75% (${h.x.toFixed(6)}%, ${q.x.toFixed(6)}%)`);
  // portfolio = benchmark: adding x of Z gives a = x/100 · (Z − benchmark), so TE(x) = x/100 · TE(Z alone); the target T is reached at 100 · T / TE(Z alone)
  const full = M.pmStats(A, [0, 0, 1], [40, 60, 0]).te, u = M.pmTarget(A, ids, { P: 40, K: 60 }, { P: 40, K: 60 }, 'Z', 'all', full / 5);
  ok(u.dir === 'up' && close(u.x, 20, 1e-6) && close(u.te0, 0, 1e-9), `target from below: the largest weight that keeps the tracking error within the target (${u.x.toFixed(6)}% = 20%)`);
  const at = M.pmTarget(A, ids, { P: 100 }, { K: 100 }, 'K', 'all', te0);
  ok(at.dir === 'at' && at.x === 0, 'a target equal to the current tracking error needs nothing added');
}
{   // the target on real-looking fixtures: paid from cash (a kink where the cash runs out), the first crossing, out of reach
  const A = M.pmAlign(fixture(5, 200)), ids = ['a', 'b', 'CASH', 'd', 'e'], w = { a: 30, b: 25, CASH: 20, d: 15, e: 10 }, b = { a: 10, b: 10, CASH: 0, d: 30, e: 50 };
  const grid = Array.from({ length: 1001 }, (_, i) => i / 10), C = M.pmCurve(A, ids, w, b, 'e', 'cash', grid);
  const T = (C[200][1] + Math.min(...C.map(x => x[1]))) / 2, t = M.pmTarget(A, ids, w, b, 'e', 'cash', T);   // between the kink at 20% (cash used up) and the lowest point
  ok(t.x > 20 && close(t.teAt, T, 1e-6) && C.filter(([x]) => x < t.x - 1e-6).every(([, v]) => v > T), `paid from cash, past the point where the cash runs out: the tracking error is ${t.teAt.toFixed(6)}% = target ${T.toFixed(6)}% at ${t.x.toFixed(4)}%, and above it at every smaller weight`);
  const lowest = Math.min(...C.map(x => x[1])), none = M.pmTarget(A, ids, w, b, 'e', 'cash', lowest / 2);
  ok(none.x == null && close(none.lo[1], lowest, 1e-9), `out of reach: no weight found, and the lowest point (${none.lo[1].toFixed(4)}% at ${none.lo[0].toFixed(1)}%) is the curve's minimum`);
}

// ---------------------------------------------------------------- 2. real data (when on disk)
const D = path.join(__dirname, '..', 'docs', 'data');
if (fs.existsSync(path.join(D, 'funds.json')) && fs.existsSync(path.join(D, 'yahoo.json'))) {
  console.log('Portfolio maths: funds.json');
  const F = JSON.parse(fs.readFileSync(path.join(D, 'funds.json'))).funds, Y = JSON.parse(fs.readFileSync(path.join(D, 'yahoo.json')));
  const fx = id => ({ t: Y[id].d.map(d => d * DAY), v: Y[id].v });
  const FX = { MYR: [fx('USDMYR'), -1], SGD: [fx('USDSGD'), -1], GBP: [fx('GBPUSD'), 1] };
  const asOf = (s, t) => { let lo = 0, hi = s.t.length - 1, k = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (s.t[m] <= t) { k = m; lo = m + 1; } else hi = m - 1; } return k >= 0 && t - s.t[k] <= 7 * DAY ? s.v[k] : null; };
  const usdPer = (c, t) => c === 'USD' ? 1 : FX[c] ? (v => v == null ? null : FX[c][1] > 0 ? v : 1 / v)(asOf(FX[c][0], t)) : null;
  const conv = (id, base) => { const x = F[id], t = [], v = []; for (let i = 0; i < x.d.length; i++) { const tt = x.d[i] * DAY, a = usdPer(x.ccy, tt), b = usdPer(base, tt); if (a && b) { t.push(tt); v.push(x.v[i] * a / b); } } return { t, v }; };
  const port = { '0820EA.KL': 35, AAXJ: 15, ACWI: 15, IEF: 20, GLD: 5, BIL: 10 }, bench = { ACWI: 60, 'AGGU.L': 40 }, ids = [...new Set([...Object.keys(port), ...Object.keys(bench)])];
  const end = Math.max(...ids.map(id => F[id].d[F[id].d.length - 1])) * DAY, from = end - 3 * 365.25 * DAY;
  const te = base => { const A = M.pmAlign(ids.map(id => conv(id, base)), from); return [M.pmStats(A, M.pmVec(ids, port), M.pmVec(ids, bench)), A]; };
  const [m, Am] = te('MYR'), [u] = te('USD');
  ok(m && close(m.te, m.teReal, 1e-9), `real funds: closed form equals realised (${m.te.toFixed(4)}% over ${Am.n} weeks)`);
  ok(close(m.te, u.te, 0.05), `in ringgit and in dollars the tracking error differs by under 0.05 point (${m.te.toFixed(3)}% vs ${u.te.toFixed(3)}%)`);
  ok(m.volP !== u.volP, `…while volatility does change with the currency (${m.volP.toFixed(2)}% in ringgit, ${u.volP.toFixed(2)}% in dollars)`);
  ok(m.te > 2 && m.te < 10, `a balanced portfolio against a 60/40: tracking error in a sensible range (${m.te.toFixed(2)}%)`);
  // Design plan 6, Step 1: every block says what it tracks, its group and where it is listed
  const G = (JSON.parse(fs.readFileSync(path.join(D, 'funds.json')))._meta || {}).groups || [];
  const bad = Object.entries(F).filter(([, x]) => !x.short || !x.place || !G.includes(x.grp));
  ok(G.length === 10 && !bad.length, `every fund has a label, a place of listing and one of the ${G.length} groups (${Object.keys(F).length} funds${bad.length ? '; not: ' + bad.map(b => b[0]).join(', ') : ''})`);
  const byIdx = {}; for (const [k, x] of Object.entries(F)) if (x.src === 'core') (byIdx[x.short + ' | ' + x.place] = byIdx[x.short + ' | ' + x.place] || []).push(k);
  const twice = Object.entries(byIdx).filter(([, v]) => v.length > 1).map(([k, v]) => `${k}: ${v.join(', ')}`);
  ok(twice.length <= 2, `one fund per index per place of listing (two Singapore STI funds are kept: ${twice.join('; ') || 'none'})`);
} else console.log('Portfolio maths: funds.json not on disk; real-data checks skipped');

if (fails.length) { console.log(`\nPortfolio check: ${fails.length} failure(s).`); process.exit(1); }
console.log('\nPortfolio check passed.');
