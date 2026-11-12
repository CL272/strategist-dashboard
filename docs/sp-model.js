// Structured products pricing model (WP40). Plain functions, shared by the page (sp.js), the Monte Carlo worker
// (sp-worker.js) and the check script (tools/sp-check.js). Everything is per unit of notional with spot = 1.
// Indicative only: Black-Scholes with the implied volatility read at the strike or barrier, so skew is respected.
(function (g) {
  'use strict';
  const SQ2PI = 0.3989422804014327;
  function ncdf(x) {   // Zelen & Severo (Abramowitz-Stegun 26.2.17), error < 7.5e-8
    const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = SQ2PI * Math.exp(-x * x / 2);
    const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x > 0 ? 1 - p : p;
  }
  function bs(cp, S, K, T, r, q, v) {   // cp = 'C' | 'P'
    if (T <= 0 || v <= 0) return Math.max(cp === 'C' ? S - K : K - S, 0);
    const sT = v * Math.sqrt(T), d1 = (Math.log(S / K) + (r - q + v * v / 2) * T) / sT, d2 = d1 - sT;
    return cp === 'C' ? S * Math.exp(-q * T) * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2)
      : K * Math.exp(-r * T) * ncdf(-d2) - S * Math.exp(-q * T) * ncdf(-d1);
  }
  function digitalPut(S, K, T, r, q, v) {   // pays 1 if S_T < K
    const sT = v * Math.sqrt(T), d2 = (Math.log(S / K) + (r - q - v * v / 2) * T) / sT;
    return Math.exp(-r * T) * ncdf(-d2);
  }
  // down-and-in put (Reiner-Rubinstein, as in Haug), barrier H <= strike K, continuous monitoring;
  // pass dtObs (years between observations, e.g. 1/252 for daily) for the Broadie-Glasserman discrete correction
  function downInPut(S, K, H, T, r, q, v, dtObs) {
    if (dtObs) H = H * Math.exp(-0.5826 * v * Math.sqrt(dtObs));
    if (S <= H) return bs('P', S, K, T, r, q, v);
    if (H >= K) return bs('P', S, K, T, r, q, v);
    const sT = v * Math.sqrt(T), mu = (r - q - v * v / 2) / (v * v), eq = Math.exp(-q * T), er = Math.exp(-r * T);
    const x2 = Math.log(S / H) / sT + (1 + mu) * sT, y1 = Math.log(H * H / (S * K)) / sT + (1 + mu) * sT, y2 = Math.log(H / S) / sT + (1 + mu) * sT;
    const hs1 = Math.pow(H / S, 2 * (mu + 1)), hs0 = Math.pow(H / S, 2 * mu);
    const B = -S * eq * ncdf(-x2) + K * er * ncdf(-x2 + sT);
    const C = -S * eq * hs1 * ncdf(y1) + K * er * hs0 * ncdf(y1 - sT);
    const D = -S * eq * hs1 * ncdf(y2) + K * er * hs0 * ncdf(y2 - sT);
    return Math.max(0, B - C + D);
  }
  // implied vol from a surface: surf[tenorIndex][moneynessIndex], tenors in days, total variance linear in time
  function volAt(surf, tenors, mny, days, m) {
    const row = i => { const r = surf[i]; if (m <= mny[0]) return r[0]; if (m >= mny[mny.length - 1]) return r[r.length - 1];
      let j = 1; while (mny[j] < m) j++; const w = (m - mny[j - 1]) / (mny[j] - mny[j - 1]); return r[j - 1] + w * (r[j] - r[j - 1]); };
    if (days <= tenors[0]) return row(0);
    if (days >= tenors[tenors.length - 1]) return row(tenors.length - 1);
    let i = 1; while (tenors[i] < days) i++;
    const v1 = row(i - 1), v2 = row(i), t1 = tenors[i - 1], t2 = tenors[i];
    const w = (v1 * v1 * t1 + (v2 * v2 * t2 - v1 * v1 * t1) * (days - t1) / (t2 - t1)) / days;
    return Math.sqrt(Math.max(w, 1e-6));
  }
  // ---- random numbers: seeded, so the same inputs always give the same answer
  function rng(seed) {
    let a = seed >>> 0;
    const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    let spare = null;
    return () => { if (spare !== null) { const s = spare; spare = null; return s; }
      let x, y, r2; do { x = 2 * u() - 1; y = 2 * u() - 1; r2 = x * x + y * y; } while (r2 >= 1 || r2 === 0);
      const f = Math.sqrt(-2 * Math.log(r2) / r2); spare = y * f; return x * f; };
  }
  function cholesky(C) {
    const n = C.length, L = C.map(() => new Array(n).fill(0));
    for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
      let s = C[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-10)) : s / L[j][j];
    }
    return L;
  }
  // ---- Monte Carlo for notes on one to three underlyings (worst-of): autocallable, or fixed-coupon note without calls
  // p: { vols[], q[], r, corr, T (years), nObs, ac (autocall level, Infinity = never), cb (coupon barrier, 0 = always),
  //      memory, ki (knock-in level), kiType 'daily' | 'maturity', k (strike for the loss), paths, seed, stepsPerYear }
  // returns PV of the principal leg (A), PV of 1 unit of annual coupon (Bc), call probabilities, knock-in and loss odds
  function mcNote(p) {
    const n = p.vols.length, spy = p.stepsPerYear || 52, N = Math.max(p.nObs, Math.round(p.T * spy)), dt = p.T / N;
    const obs = []; for (let o = 1; o <= p.nObs; o++) obs.push(Math.round(o * N / p.nObs));
    const L = cholesky(p.corr || [[1]]), z = rng(p.seed || 7), paths = p.paths || 20000;
    const drift = p.vols.map((v, j) => (p.r - p.q[j] - v * v / 2) * dt), sd = p.vols.map(v => v * Math.sqrt(dt));
    // barrier shift: weekly steps stand in for daily monitoring (Broadie-Glasserman)
    const vmax = Math.max(...p.vols), kiAdj = p.kiType === 'daily' ? p.ki * Math.exp(0.5826 * vmax * (Math.sqrt(dt) - Math.sqrt(1 / 252))) : p.ki;
    const cpn = p.T / p.nObs;
    let A = 0, Bc = 0, ki = 0, loss = 0, life = 0, lossSum = 0;
    const called = new Array(p.nObs).fill(0), eps = new Array(n), x = new Array(n).fill(0);
    for (let path = 0; path < paths; path++) {
      x.fill(0); let hit = false, memo = 0, o = 0, done = false;
      for (let s = 1; s <= N && !done; s++) {
        for (let j = 0; j < n; j++) eps[j] = z();
        let w = Infinity;
        for (let j = 0; j < n; j++) { let e = 0; for (let k = 0; k <= j; k++) e += L[j][k] * eps[k]; x[j] += drift[j] + sd[j] * e; const sj = Math.exp(x[j]); if (sj < w) w = sj; }
        if (p.kiType === 'daily' && w < kiAdj) hit = true;
        if (s === obs[o]) {
          const t = s * dt, df = Math.exp(-p.r * t);
          if (w >= p.cb) { Bc += (memo + 1) * cpn * df; memo = 0; } else if (p.memory) memo++;
          if (o < p.nObs - 1 && w >= p.ac) { A += df; called[o]++; life += t; done = true; break; }
          if (o === p.nObs - 1) {
            if (p.kiType === 'maturity' && w < p.ki) hit = true;
            const red = hit && w < p.k ? w / p.k : 1;
            A += red * df; life += t; if (hit) ki++; if (red < 1) { loss++; lossSum += 1 - red; }
            done = true; break;
          }
          o++;
        }
      }
    }
    return { A: A / paths, Bc: Bc / paths, called: called.map(c => c / paths), ki: ki / paths, loss: loss / paths, avgLoss: loss ? lossSum / loss : 0, life: life / paths };
  }
  // ---- accumulator (single underlying): buy 1 unit a week at strike k (2 below it), knocked out at ko; zero-cost strike
  function accumulator(p) {   // { vol, q, r, T, ko, gear, paths, seed, margin }
    const N = Math.round(p.T * 52), dt = p.T / N, z = rng(p.seed || 11), paths = p.paths || 8000, koAdj = p.ko * Math.exp(-0.5826 * p.vol * (Math.sqrt(dt) - Math.sqrt(1 / 252)));
    const store = [];
    for (let i = 0; i < paths; i++) { let x = 0; const row = []; for (let s = 1; s <= N; s++) { x += (p.r - p.q - p.vol * p.vol / 2) * dt + p.vol * Math.sqrt(dt) * z(); const S = Math.exp(x); row.push(S); if (S >= koAdj) break; } store.push(row); }
    const value = k => { let v = 0, units = 0, ko = 0; for (const row of store) { row.forEach((S, s) => { const n = S >= k ? 1 : (p.gear || 2); v += Math.exp(-p.r * (s + 1) * dt) * (S - k) * n; units += n; }); if (row.length < N) ko++; } return { v: v / paths, units: units / paths, ko: ko / paths }; };
    let lo = 0.5, hi = 1.2;
    for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; const r = value(mid); if (r.v / Math.max(r.units, 1e-9) > (p.margin || 0)) lo = mid; else hi = mid; }
    const r = value(lo);
    return { strike: lo, units: r.units, koProb: r.ko, weeks: N };
  }
  const api = { ncdf, bs, digitalPut, downInPut, volAt, rng, cholesky, mcNote, accumulator };
  g.SPM = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : this);
