// Design check: opens every page and sub-tab at 1440x900 and fails if the layout rules in CLAUDE.md are broken.
// Usage: serve docs/ (e.g. `cd docs && python3 -m http.server 8765`), then `node tools/design-check.js [url]`.
// Needs Playwright with Chromium. Exit code 1 when a rule is broken.
const { chromium } = require('playwright');

const URL = process.argv[2] || 'http://localhost:8765/';
const LIMITS = { height: 2300, tiles: 5, rows: 16, titleLines: 2, controls: 4 };
// deliberate exceptions: [page, sub-tab label, rule]
const ALLOW = [
  ['overview', 'Where we are', 'rows'],          // the one-screen cross-asset snapshot is meant to show every asset class at once
  ['calendar', '*', 'rows'],                     // a calendar week can hold more than 16 releases; later weeks fold
  ['stress', 'Where everything stands', 'rows'], // grouped by block; cutting rows would hide whole blocks
  ['posvol', 'Positioning (CFTC)', 'rows'],      // grouped by asset class, same reason
  ['valuation', 'Scorecard', 'rows'],            // grouped by asset class, same reason
  ['weekly', '*', 'rows'],                       // the printable one-page brief
  ['health', '*', 'rows'],                       // a diagnostics page
  ['ideas', 'Watchlist', 'rows'],                // 20 rows: ten risers plus ten fallers
];
const allowed = (t, sub, rule) => ALLOW.some(([a, b, r]) => a === t && (b === '*' || b === sub) && r === rule);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL + '#tab=overview');
  await page.waitForTimeout(6000);
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.tabs button')].map(b => b.dataset.tab));
  const problems = [];
  for (const t of tabs) {
    await page.evaluate(t => setTab(t), t);
    await page.waitForTimeout(700);
    const subs = await page.evaluate(t => (SUBTABS[t] || (t === 'calendar' ? CAL_VIEWS : t === 'ideas' ? IDEA_VIEWS : [[t]])).map(x => x[0]), t);
    for (let i = 0; i < subs.length; i++) {
      if (subs.length > 1) {
        await page.evaluate(([t, i]) => { if (SUBTABS[t]) setSub(t, i); else { state.sub[t] = i; renderTab(); } }, [t, i]);
        await page.waitForTimeout(600);
      }
      const m = await page.evaluate(t => {
        const P = document.querySelector('#tab-' + t), vis = e => e.offsetParent !== null && !e.hidden;
        const cards = [...P.querySelectorAll('.card')].filter(vis);
        const lines = e => { const cs = getComputedStyle(e), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25; return Math.round(e.getBoundingClientRect().height / lh); };
        return {
          height: document.documentElement.scrollHeight,
          tiles: [...P.querySelectorAll('.kpi')].filter(vis).length,
          tables: [...P.querySelectorAll('table')].filter(vis).map(tb => [...tb.querySelectorAll('tbody tr.row')].filter(vis).length),
          titles: cards.map(c => { const h = c.querySelector('.card-head h2'); return h ? [h.textContent, lines(h)] : null; }).filter(Boolean),
          controls: cards.map(c => { const head = c.querySelector('.card-head'); if (!head) return null;
            const n = [...head.querySelectorAll('.card-tools > *, .card-actions > *')].filter(vis).length; return [(c.querySelector('h2') || {}).textContent, n]; }).filter(Boolean),
        };
      }, t);
      const where = `${t} › ${subs[i]}`;
      if (m.height > LIMITS.height) problems.push(`${where}: page is ${m.height}px tall (limit ${LIMITS.height})`);
      if (m.tiles > LIMITS.tiles) problems.push(`${where}: ${m.tiles} tiles (limit ${LIMITS.tiles})`);
      const maxRows = Math.max(0, ...m.tables);
      if (maxRows > LIMITS.rows && !allowed(t, subs[i], 'rows')) problems.push(`${where}: a table shows ${maxRows} rows at rest (limit ${LIMITS.rows}; add "Show all")`);
      for (const [title, n] of m.titles) if (n > LIMITS.titleLines) problems.push(`${where}: card title "${title}" wraps to ${n} lines`);
      for (const [title, n] of m.controls) if (n > LIMITS.controls) problems.push(`${where}: card "${title}" shows ${n} controls in its header (limit ${LIMITS.controls})`);
    }
  }
  await browser.close();
  if (errors.length) problems.push(...[...new Set(errors)].map(e => 'script error: ' + e));
  if (problems.length) { console.log(`Design check: ${problems.length} problem(s)\n- ` + problems.join('\n- ')); process.exit(1); }
  console.log(`Design check passed: ${tabs.length} pages, every sub-tab within the limits.`);
})();
