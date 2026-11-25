// Design check: opens every page and sub-tab at 1440x900 and fails if the layout rules in CLAUDE.md are broken.
// Usage: serve docs/ (e.g. `cd docs && python3 -m http.server 8765`), then `node tools/design-check.js [url]`.
// Needs Playwright with Chromium. Exit code 1 when a rule is broken.
const { chromium } = require('playwright');

const URL = process.argv[2] || 'http://localhost:8765/';
const LIMITS = { height: 2300, tiles: 5, rows: 16, titleLines: 2, controls: 4, subtabBar: 48, firstCard: 260, phoneFirstCard: 380 };
// Design plan 2: the two pages read every day stay short (checked at 1440x900 and again at 1280x720)
const PAGE_CAPS = { 'overview|Today': 1350, 'weekly|weekly': 1500 };
// deliberate exceptions: [page, sub-tab label, rule]
const ALLOW = [
  ['overview', 'Where we are', 'rows'],          // the one-screen cross-asset snapshot is meant to show every asset class at once
  ['calendar', '*', 'rows'],                     // a calendar week can hold more than 16 releases; later weeks fold
  ['stress', 'Where everything stands', 'rows'], // grouped by block; cutting rows would hide whole blocks
  ['posvol', 'Positioning (CFTC)', 'rows'],      // grouped by asset class, same reason
  ['valuation', 'Scorecard', 'rows'],            // grouped by asset class, same reason
  ['weekly', '*', 'rows'],                       // the printable one-page brief
  ['health', '*', 'rows'],                       // a diagnostics page
  ['markets', 'Watchlist', 'rows'],              // 20 rows: ten risers plus ten fallers
  ['fixed', 'Income menu', 'rows'],              // grouped by asset class (cash, government, credit, equity income, options)
  ['alloc', 'Evidence board', 'rows'],           // Design plan 3: one grouped table of 13 assets (16 rows with the group rows)
  ['us', '*', 'first300'],                       // Design plan 2, Step 5: a group row sits above the sub-tab bar (limit 300px)
  ['regime', '*', 'first300'],
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
  const tabs = await page.evaluate(() => [...new Set([...document.querySelectorAll('.tabs button[data-tab]:not([data-pin])')].map(b => b.dataset.tab))]);
  const problems = [];
  for (const t of tabs) {
    await page.evaluate(t => setTab(t), t);
    await page.waitForTimeout(700);
    const subs = await page.evaluate(t => (SUBTABS[t] || (t === 'calendar' ? CAL_VIEWS : [[t]])).map(x => x[0]), t);
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
          subtabBar: (P.querySelector('.subtabs') || { offsetHeight: 0 }).offsetHeight,
          barHidden: (() => { const n = P.querySelector('.subtabs'); return !!n && n.scrollWidth > n.clientWidth + 2; })(),   // a sub-tab off-screen on a desktop
          firstCard: cards.length ? Math.round(cards[0].getBoundingClientRect().top + scrollY) : 0,
          tiles: [...P.querySelectorAll('.kpi')].filter(vis).length,
          tables: [...P.querySelectorAll('table')].filter(vis).map(tb => [...tb.querySelectorAll('tbody tr.row')].filter(vis).length),
          titles: cards.map(c => { const h = c.querySelector('.card-head h2'); return h ? [h.textContent, lines(h)] : null; }).filter(Boolean),
          // a half-width card alone on its row (Design plan 2, Step 3: layoutLone should have widened it)
          lone: [...P.querySelectorAll('.grid:not(.g3)')].filter(vis).flatMap(g => { const W = g.clientWidth, rows = {};
            [...g.children].filter(x => x.classList.contains('card') && vis(x)).forEach(x => { const r = x.getBoundingClientRect(); (rows[Math.round(r.top)] = rows[Math.round(r.top)] || []).push([r.width, (x.querySelector('h2') || {}).textContent]); });
            return Object.values(rows).filter(a => a.length === 1 && a[0][0] < W * 0.7).map(a => a[0][1]); }),
          controls: cards.map(c => { const head = c.querySelector('.card-head'); if (!head) return null;
            const n = [...head.querySelectorAll('.card-tools > *, .card-actions > *')].filter(vis).length; return [(c.querySelector('h2') || {}).textContent, n]; }).filter(Boolean),
        };
      }, t);
      const where = `${t} › ${subs[i]}`;
      if (m.height > LIMITS.height) problems.push(`${where}: page is ${m.height}px tall (limit ${LIMITS.height})`);
      const cap = PAGE_CAPS[`${t}|${subs[i]}`]; if (cap && m.height > cap) problems.push(`${where}: page is ${m.height}px tall (Design plan 2 cap ${cap})`);
      if (m.tiles > LIMITS.tiles) problems.push(`${where}: ${m.tiles} tiles (limit ${LIMITS.tiles})`);
      if (m.subtabBar > LIMITS.subtabBar) problems.push(`${where}: the sub-tab bar wraps (${m.subtabBar}px; it must stay on one line)`);
      const firstLimit = allowed(t, subs[i], 'first300') ? 300 : LIMITS.firstCard;
      if (m.firstCard > firstLimit && !allowed(t, subs[i], 'first')) problems.push(`${where}: the first card starts ${m.firstCard}px down (limit ${firstLimit})`);
      if (m.barHidden) problems.push(`${where}: the sub-tab bar hides tabs off-screen (Design plan 2, Step 5: group them)`);
      const maxRows = Math.max(0, ...m.tables);
      if (maxRows > LIMITS.rows && !allowed(t, subs[i], 'rows')) problems.push(`${where}: a table shows ${maxRows} rows at rest (limit ${LIMITS.rows}; add "Show all")`);
      if (m.lone.length && !allowed(t, subs[i], 'lone')) problems.push(`${where}: a half-width card sits alone on its row (${m.lone.join(', ')})`);
      for (const [title, n] of m.titles) if (n > LIMITS.titleLines) problems.push(`${where}: card title "${title}" wraps to ${n} lines`);
      for (const [title, n] of m.controls) if (n > LIMITS.controls) problems.push(`${where}: card "${title}" shows ${n} controls in its header (limit ${LIMITS.controls})`);
    }
  }
  // Design plan 3, Step 1: the menu is a tree; with every group open and the region trees closed the list scrolls at most 200px
  const menu = await page.evaluate(() => { localStorage.setItem('sd-nav-fold-v1', '[]'); for (const p of Object.keys(NAV_OPEN)) navOpen(p, false); setTab('overview'); navGroupsApply();
    const n = document.querySelector('.side .tabs'); return { scroll: n.scrollHeight - n.clientHeight, heads: n.querySelectorAll('.nav-sec > .nav-head').length }; });
  if (!menu.heads) problems.push('menu: no group headers (.nav-sec > .nav-head): the tree markup is missing');
  if (menu.scroll > 200) problems.push(`menu: the page list scrolls ${menu.scroll}px at 1440x900 with every group open and the region trees closed (limit 200)`);
  // Design plan 3, Step 3: the Evidence board is a tally of evidence, never advice: no buy, sell, overweight or recommend
  const advice = await page.evaluate(async () => { goSub('alloc', 'Evidence board'); await new Promise(r => setTimeout(r, 800));
    const T = [document.querySelector('#tab-alloc').textContent, ...(state.alRes || []).flatMap(x => Object.values(x.c).map(y => y.txt))].join(' ').replace(/not a recommendation/gi, '');
    return [...new Set((T.match(/\b(buy|buying|sell(?!-off)|selling|overweight|underweight|recommend\w*)\b/gi) || []).map(w => w.toLowerCase()))]; });
  if (advice.length) problems.push(`alloc › Evidence board: advice words on the page (${advice.join(', ')}); the board is a tally of evidence, not a recommendation`);
  // the daily pages again on a small laptop (1280x720), and the brief on one A4 page
  const lap = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  lap.on('pageerror', e => errors.push(e.message));
  await lap.goto(URL + '#tab=overview'); await lap.waitForTimeout(5000);
  for (const [key, cap] of Object.entries(PAGE_CAPS)) {
    const [t, sub] = key.split('|');
    await lap.evaluate(([t, sub]) => { setTab(t); if (SUBTABS[t]) setSub(t, Math.max(0, SUBTABS[t].findIndex(x => x[0] === sub))); }, [t, sub]); await lap.waitForTimeout(1200);
    const h = await lap.evaluate(() => document.documentElement.scrollHeight);
    if (h > cap) problems.push(`${t} › ${sub} (1280x720): page is ${h}px tall (Design plan 2 cap ${cap})`);
  }
  await lap.evaluate(() => setTab('weekly')); await lap.waitForTimeout(1500);
  const pdf = await lap.pdf({ format: 'A4', printBackground: true });
  const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  if (pages !== 1) problems.push(`weekly: the printed brief runs to ${pages} A4 pages (it must fit on one)`);
  await lap.close();
  // phone width (390px): sub-tab bars on one line, first card within reach, nothing scrolls the page sideways
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(URL + '#tab=overview'); await phone.waitForTimeout(5000);
  for (const t of tabs) {
    const n = await phone.evaluate(t => Math.max(1, (SUBTABS[t] || []).length), t);
    for (let i = 0; i < n; i++) {
      await phone.evaluate(([t, i]) => { setTab(t); if (SUBTABS[t]) setSub(t, i); }, [t, i]); await phone.waitForTimeout(350);
      const m = await phone.evaluate(t => { const P = document.querySelector('#tab-' + t), c = [...P.querySelectorAll('.card')].find(e => e.offsetParent);
        const lines = e => { const cs = getComputedStyle(e), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.25; return Math.round(e.getBoundingClientRect().height / lh); };
        const squeezed = [...P.querySelectorAll('.card')].filter(e => e.offsetParent).map(e => e.querySelector('.card-head h2')).filter(h => h && lines(h) > 3).map(h => h.textContent);
        return { squeezed, bar: (P.querySelector('.subtabs') || { offsetHeight: 0 }).offsetHeight, first: c ? Math.round(c.getBoundingClientRect().top + scrollY) : 0, wide: document.documentElement.scrollWidth > innerWidth + 2, sub: SUBTABS[t] ? SUBTABS[t][state.sub[t] || 0][0] : t }; }, t);
      const where = `${t} › ${m.sub} (phone)`;
      if (m.bar > LIMITS.subtabBar) problems.push(`${where}: the sub-tab bar wraps (${m.bar}px)`);
      if (m.first > LIMITS.phoneFirstCard && !allowed(t, m.sub, 'first')) problems.push(`${where}: the first card starts ${m.first}px down (limit ${LIMITS.phoneFirstCard})`);
      if (m.wide) problems.push(`${where}: the page scrolls sideways`);
      for (const h of m.squeezed) problems.push(`${where}: card title "${h}" is squeezed onto more than 3 lines`);
    }
  }
  await browser.close();
  if (errors.length) problems.push(...[...new Set(errors)].map(e => 'script error: ' + e));
  if (problems.length) { console.log(`Design check: ${problems.length} problem(s)\n- ` + problems.join('\n- ')); process.exit(1); }
  console.log(`Design check passed: ${tabs.length} pages, every sub-tab within the limits.`);
})();
