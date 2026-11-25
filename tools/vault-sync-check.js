// Vault sync check (WP71): two separate browser profiles ("laptop" and "phone") sync through a simulated GitHub
// contents API (no network, no token). Run with the local server up:  node tools/vault-sync-check.js
const { chromium } = require('playwright');
const SITE = process.argv[2] || 'http://localhost:8765/';
const PASS = 'correct horse battery staple 42';
(async () => {
  const b = await chromium.launch(), fails = [], errors = [];
  const ok = (c, w) => { console.log(`  ${c ? 'ok  ' : 'FAIL'} ${w}`); if (!c) fails.push(w); };
  // the simulated repository: one private repo holding vault.json, with GitHub's sha check on writes
  const repo = { file: null, sha: null, writes: 0, auth: new Set() };
  async function wire(ctx) {
    await ctx.route('https://api.github.com/**', async route => {
      const req = route.request(), u = new URL(req.url()), auth = req.headers()['authorization'] || '';
      repo.auth.add(auth);
      if (auth !== 'Bearer test-token') return route.fulfill({ status: 401, body: '{}' });
      if (u.pathname === '/repos/me/strategist-private') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ private: true }) });
      if (u.pathname === '/repos/me/public-repo') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ private: false }) });
      if (u.pathname === '/repos/me/strategist-private/contents/vault.json') {
        if (req.method() === 'GET') return repo.file ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sha: repo.sha, content: repo.file }) }) : route.fulfill({ status: 404, body: '{}' });
        if (req.method() === 'PUT') { const j = JSON.parse(req.postData()); if ((repo.sha || null) !== (j.sha || null)) return route.fulfill({ status: 409, body: '{}' });
          repo.file = j.content; repo.sha = 's' + (++repo.writes); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ content: { sha: repo.sha } }) }); }
      }
      return route.fulfill({ status: 404, body: '{}' });
    });
  }
  const laptopCtx = await b.newContext(), phoneCtx = await b.newContext(); await wire(laptopCtx); await wire(phoneCtx);
  // list helpers on the old Notebook item: its page was removed in Design plan 3, but what is stored there still syncs, and no page
  // reads it, so the test does not wake other pages (the structured notes would load their price history mid-test)
  for (const ctx of [laptopCtx, phoneCtx]) await ctx.addInitScript(() => { window.nload = () => JSON.parse(pstore().getItem('sd-notebook-v1') || '[]'); window.nsave = L => pstore().setItem('sd-notebook-v1', JSON.stringify(L)); });
  const laptop = await laptopCtx.newPage(), phone = await phoneCtx.newPage();
  for (const p of [laptop, phone]) p.on('pageerror', e => errors.push(e.message));
  console.log('Vault sync check');
  await laptop.goto(SITE + '#tab=overview'); await laptop.evaluate(() => { localStorage.clear(); localStorage.setItem('sd-ideas-v1', JSON.stringify([{ id: 'i1', title: 'Laptop idea', date: '2026-11-01', status: 'open' }])); });
  await laptop.reload(); await laptop.waitForTimeout(6000);
  // laptop: set up, refuse a public repository, then turn on sync with the private one
  const pub = await laptop.evaluate(async P => { await vaultSetup(P); vSyncSet({ repo: 'me/public-repo', token: 'test-token', path: 'vault.json', last: 0 }); try { await vaultSync(); return false; } catch (e) { return /public/.test(e.message); } }, PASS);
  ok(pub, 'a public repository is refused');
  await laptop.evaluate(async () => { vSyncSet({ repo: 'me/strategist-private', token: 'test-token', path: 'vault.json', last: 0 }); await vaultSync(); });
  const stored = repo.file ? Buffer.from(repo.file, 'base64').toString() : '';
  ok(!!repo.file && !/Laptop idea|test-token/.test(stored), 'the synced file is encrypted (no idea text, no token)');
  // phone: connect with the passphrase; gets the laptop's idea; adds a note
  await phone.goto(SITE + '#tab=overview'); await phone.evaluate(() => localStorage.clear()); await phone.reload(); await phone.waitForTimeout(6000);
  const wrong = await phone.evaluate(async () => { try { await vaultConnectNew('me/strategist-private', 'test-token', 'wrong passphrase here'); return false; } catch (e) { return true; } });
  ok(wrong, 'connecting a new device with a wrong passphrase is refused');
  const ph = await phone.evaluate(async P => { await vaultConnectNew('me/strategist-private', 'test-token', P); const ideas = JSON.parse(pstore().getItem('sd-ideas-v1') || '[]').map(x => x.title);
    nsave([{ id: 'p1', title: 'Phone note', text: 'from the phone', tags: [], updated: new Date().toISOString(), created: new Date().toISOString() }]); await vaultSave(); await vaultSync(); return ideas; }, PASS);
  ok(ph.includes('Laptop idea'), 'the phone receives the laptop\'s stored items (an old idea kept in the vault)');
  // laptop: syncs, sees the phone's note; both edit the notes between syncs; the lists are joined
  const lp = await laptop.evaluate(async () => { await vaultSync(); const got = nload().map(n => n.title);
    nsave([...nload(), { id: 'l2', title: 'Laptop note', text: '', tags: [], updated: new Date().toISOString(), created: new Date().toISOString() }]); await vaultSave(); return got; });
  ok(lp.includes('Phone note'), 'the laptop receives the phone\'s note');
  await phone.evaluate(async () => { nsave([...nload(), { id: 'p3', title: 'Second phone note', text: '', tags: [], updated: new Date().toISOString(), created: new Date().toISOString() }]); await vaultSave(); await vaultSync(); });
  const both = await laptop.evaluate(async () => { await vaultSync(); return nload().map(n => n.id).sort().join(','); });
  ok(both === 'l2,p1,p3', 'edits made on both devices between syncs are joined (' + both + ')');
  const tokLocal = await phone.evaluate(() => !!vSyncCfg() && vSyncCfg().repo === 'me/strategist-private');
  ok(tokLocal, 'each device keeps its own sync settings');
  const badTok = await laptop.evaluate(async () => { vSyncSet({ ...vSyncCfg(), token: 'expired' }); try { await vaultSync(); return false; } catch (e) { return /refused/.test(e.message); } });
  ok(badTok, 'an expired or revoked token gives a clear message');
  // auto-lock: one minute without activity
  const al = await laptop.evaluate(async () => { vCfgSet({ autolock: 1 }); V.lastAct = Date.now() - 2 * 60000; await new Promise(r => setTimeout(r, 21000)); return vaultOpen(); });
  ok(!al, 'auto-lock closes the vault after the set time without activity');
  await b.close();
  if (errors.length) { console.log('script errors:', [...new Set(errors)].join(' | ')); fails.push('script errors'); }
  if (fails.length) { console.log(`\nSync check: ${fails.length} failure(s).`); process.exit(1); }
  console.log('\nSync check passed.');
})();
