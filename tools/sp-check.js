// Checks the structured-products model (docs/sp-model.js) before any coupon is shown. Run: node tools/sp-check.js
// 1. textbook identities (put-call parity, barrier limits, Monte Carlo vs closed form)
// 2. the model with the published surfaces reproduces listed 3-month put prices within 15% (docs/data/structured.json)
const fs = require('fs'), path = require('path');
const M = require('../docs/sp-model.js');
const fails = [], ok = (cond, msg) => { if (!cond) fails.push(msg); else console.log('  ok  ' + msg); };
const close = (a, b, tol) => Math.abs(a - b) <= tol;

// 1. identities
const [S, K, T, r, q, v] = [100, 95, 0.75, 0.04, 0.015, 0.25];
const C = M.bs('C', S, K, T, r, q, v), P = M.bs('P', S, K, T, r, q, v);
ok(close(C - P, S * Math.exp(-q * T) - K * Math.exp(-r * T), 1e-6), `put-call parity (C ${C.toFixed(4)}, P ${P.toFixed(4)})`);
ok(close(M.bs('C', 100, 100, 1, 0.05, 0, 0.2), 10.4506, 1e-3), 'textbook call 100/100/1y/5%/20% = 10.4506');
ok(close(M.downInPut(100, 100, 100, 1, 0.05, 0, 0.2), M.bs('P', 100, 100, 1, 0.05, 0, 0.2), 1e-6), 'down-and-in put with barrier at strike = vanilla put');
ok(M.downInPut(100, 100, 1, 1, 0.05, 0, 0.2) < 1e-6, 'down-and-in put with a far barrier = 0');
ok(M.downInPut(100, 100, 70, 1, 0.05, 0.02, 0.3) < M.bs('P', 100, 100, 1, 0.05, 0.02, 0.3), 'down-and-in put below the vanilla put');
// Monte Carlo (fixed-coupon note, no call, daily knock-in) against the closed form
{
  const vv = 0.3, kk = 1, bb = 0.7, TT = 1, rr = 0.04, qq = 0.01;
  const mc = M.mcNote({ vols: [vv], q: [qq], r: rr, corr: [[1]], T: TT, nObs: 12, ac: Infinity, cb: 0, memory: false, ki: bb, kiType: 'daily', k: kk, paths: 40000, seed: 3, stepsPerYear: 252 });
  const cf = Math.exp(-rr * TT) - M.downInPut(1, kk, bb, TT, rr, qq, vv, 1 / 252);   // principal leg = bond minus down-and-in put
  ok(close(mc.A, cf, 0.004), `Monte Carlo principal leg ${mc.A.toFixed(4)} vs closed form ${cf.toFixed(4)} (daily steps)`);
  const mcw = M.mcNote({ vols: [vv], q: [qq], r: rr, corr: [[1]], T: TT, nObs: 12, ac: Infinity, cb: 0, memory: false, ki: bb, kiType: 'daily', k: kk, paths: 40000, seed: 3, stepsPerYear: 52 });
  ok(close(mcw.A, cf, 0.006), `weekly steps with barrier shift ${mcw.A.toFixed(4)} vs closed form ${cf.toFixed(4)}`);
}
// 2. listed prices
const D = path.join(__dirname, '..', 'docs', 'data');
const sd = JSON.parse(fs.readFileSync(path.join(D, 'structured.json')));
const fred = JSON.parse(fs.readFileSync(path.join(D, 'fred.json')));
const r3 = (fred.UST3M ? fred.UST3M.v[fred.UST3M.v.length - 1] : 4) / 100;
const { tenors, mny } = sd._meta;
let n = 0;
for (const id of ['SPX', 'NDX', 'NVDA', 'AAPL', 'MSFT', 'TSLA', 'AMZN', 'GOLD']) {
  const x = sd.under[id]; if (!x || !x.put90 || x.src !== 'chain' || !x.put90.liquid) continue;
  const { days, k, mid } = x.put90, vol = M.volAt(x.surf, tenors, mny, days, k), model = M.bs('P', 1, k, days / 365, r3, x.dy / 100, vol) / k * 100;
  const err = Math.abs(model / mid - 1);
  ok(err <= 0.15, `${id}: listed ${days}-day put at ${(k * 100).toFixed(0)}%: market mid ${mid.toFixed(3)}%, model ${model.toFixed(3)}% (${(err * 100).toFixed(1)}% apart)`);
  n++;
}
ok(n >= 5, `${n} underlyings checked against listed prices (need at least 5)`);
if (fails.length) { console.log(`\nModel check FAILED (${fails.length}):\n- ` + fails.join('\n- ')); process.exit(1); }
console.log('\nModel check passed.');
