// Private vault check (WP70). Run against a local server of docs/ before pushing any change to docs/vault.js:
//   cd docs && python3 -m http.server 8765    then    node tools/vault-check.js
// Uses a throwaway browser profile: it never touches your real notes.
const { chromium } = require('playwright');
const URL = process.argv[2] || 'http://localhost:8765/';
const PASS = 'correct horse battery staple 42', NEWPASS = 'another long passphrase 2026';
(async () => {
  const b = await chromium.launch(), p = await b.newPage(), errors = [], fails = [];
  p.on('pageerror', e => errors.push(e.message));
  const ok = (cond, what) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${what}`); if (!cond) fails.push(what); };
  await p.goto(URL + '#tab=overview'); await p.waitForTimeout(500);
  // seed unencrypted data the way the site stores it today
  await p.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('sd-ideas-v1', JSON.stringify([{ id: 'i1', title: 'SECRET-IDEA Long KLCI banks', date: '2026-11-01', status: 'open', sid: 'KLCI', dir: 'up' }]));
    localStorage.setItem('sd-watch-v1', JSON.stringify(['1155.KL']));
    localStorage.setItem('sd-views-v1', JSON.stringify({ hist: [{ d: '2026-11-01', v: { klci: { stance: 'OW' } } }] }));
    localStorage.setItem('sd-model-v1', JSON.stringify({ ccy: 'MYR', rows: [['KLCI', 40]] }));
    localStorage.setItem('sd-notes-v1', JSON.stringify([{ id: 'n1', label: 'SECRET-NOTE FCN' }]));
    localStorage.setItem('sd-signals-v1', JSON.stringify({ watched: { 'SPX|1': '2026-11-01' } }));
    localStorage.setItem('sd-notebook-v1', JSON.stringify([{ id: 'nb1', title: 'SECRET-NB old note', text: 'kept from the Notebook', updated: '2026-11-02' }]));   // pages removed in Design plan 3: data kept
    localStorage.setItem('sd-theme', 'light');
  });
  await p.reload(); await p.waitForTimeout(7000);
  console.log('Private vault check');
  const r1 = await p.evaluate(async P => {
    const before = Object.fromEntries(VAULT_ITEMS.map(k => [k, localStorage.getItem(k)]));
    await vaultSetup(P);
    const rec = localStorage.getItem(VAULT_KEY);
    return { plainLeft: VAULT_ITEMS.filter(k => localStorage.getItem(k) != null), leak: /SECRET/.test(rec), theme: localStorage.getItem('sd-theme'),
      same: VAULT_ITEMS.every(k => before[k] === pstore().getItem(k)), old: JSON.parse(pstore().getItem('sd-ideas-v1') || '[]').length, rec: JSON.parse(rec) };
  }, PASS);
  ok(r1.plainLeft.length === 0, 'set-up removes every unencrypted copy (' + (r1.plainLeft.join(', ') || 'none left') + ')');
  ok(!r1.leak, 'the stored record holds no readable text');
  ok(r1.same, 'every item reads back unchanged through the vault');
  ok(r1.old === 1, 'old Idea log entries are kept (encrypted) after set-up');
  ok(r1.theme === 'light', 'non-private settings are left alone');
  ok(r1.rec.kdf === 'PBKDF2-SHA256' && r1.rec.iter >= 600000 && atob(r1.rec.iv).length === 12 && atob(r1.rec.salt).length === 16, 'PBKDF2-SHA-256, 600,000 rounds, 16-byte salt, 12-byte nonce');
  const r2 = await p.evaluate(async () => { const a = JSON.parse(localStorage.getItem(VAULT_KEY)).iv; pstore().setItem('sd-watch-v1', JSON.stringify(['1155.KL', 'D05.SI'])); await vaultSave(); return a !== JSON.parse(localStorage.getItem(VAULT_KEY)).iv; });
  ok(r2, 'each save uses a fresh nonce');
  const r3 = await p.evaluate(async P => {
    vaultLock();
    const locked = { old: pstore().getItem('sd-ideas-v1'), read: pstore().getItem('sd-watch-v1'), gate: (goSub('alloc', 'Model portfolio'), /Locked/.test(cards.idea_model.root.textContent)) };
    let write = false; try { pstore().setItem('sd-watch-v1', '[]'); write = true; } catch (e) { /* refused while locked */ } closeVDialog();
    let wrong = false; try { await vaultUnlock('not the passphrase at all'); } catch (e) { wrong = true; }
    await vaultUnlock(P);
    return { locked, write, wrong, after: JSON.parse(pstore().getItem('sd-watch-v1')).length, old: JSON.parse(pstore().getItem('sd-ideas-v1')).length, gate: /Locked/.test(cards.idea_model.root.textContent) };
  }, PASS);
  ok(r3.locked.old === null && r3.locked.read === null, 'locked: nothing private can be read');
  ok(r3.locked.gate, 'locked: the model portfolio shows the lock, not default weights');
  ok(!r3.write, 'locked: writes are refused (nothing is overwritten)');
  ok(r3.wrong, 'a wrong passphrase is refused');
  ok(r3.after === 2 && r3.old === 1 && !r3.gate, 'the right passphrase opens everything, including changes saved earlier');
  const r4 = await p.evaluate(async P => {
    const good = localStorage.getItem(VAULT_KEY), rec = JSON.parse(good); vaultLock();
    const ct = atob(rec.ct).split(''); ct[5] = String.fromCharCode(ct[5].charCodeAt(0) ^ 1); rec.ct = btoa(ct.join(''));
    localStorage.setItem(VAULT_KEY, JSON.stringify(rec));
    let tampered = false; try { await vaultUnlock(P); } catch (e) { tampered = true; }
    localStorage.setItem(VAULT_KEY, good); await vaultUnlock(P); return tampered;
  }, PASS);
  ok(r4, 'a changed byte in the stored file is detected (unlock fails)');
  const r5 = await p.evaluate(async ([P, N]) => {
    await vaultChangePass(N); vaultLock();
    let oldFails = false; try { await vaultUnlock(P); } catch (e) { oldFails = true; }
    await vaultUnlock(N); return { oldFails, old: JSON.parse(pstore().getItem('sd-ideas-v1') || '[]').length };
  }, [PASS, NEWPASS]);
  ok(r5.oldFails && r5.old === 1, 'changing the passphrase: the old one stops working, the data stays');
  const r6 = await p.evaluate(() => {
    const A = { 'sd-notes-v1': JSON.stringify([{ id: 'a', title: 'A', updated: '2026-11-02' }, { id: 'c', title: 'C local', updated: '2026-11-05' }]), 'sd-watch-v1': '["X"]' };
    const B = { 'sd-notes-v1': JSON.stringify([{ id: 'b', title: 'B', updated: '2026-11-03' }, { id: 'c', title: 'C remote', updated: '2026-11-04' }]), 'sd-watch-v1': '["Y"]' };
    const both = vMerge(A, { 'sd-notes-v1': 300, 'sd-watch-v1': 100 }, B, { 'sd-notes-v1': 250, 'sd-watch-v1': 200 }, 50);
    const one = vMerge(A, { 'sd-notes-v1': 40 }, B, { 'sd-notes-v1': 250 }, 50);
    const nb = JSON.parse(both.items['sd-notes-v1']);
    return { ids: nb.map(x => x.id).sort().join(''), c: nb.find(x => x.id === 'c').title, watch: both.items['sd-watch-v1'], one: JSON.parse(one.items['sd-notes-v1']).map(x => x.id).sort().join('') };
  });
  ok(r6.ids === 'abc' && r6.c === 'C local', 'merge: lists edited on both devices are joined, the newer record wins');
  ok(r6.watch === '["X","Y"]' || r6.watch === '["Y"]', 'merge: other items follow the latest edit');
  ok(r6.one === 'bc', 'merge: an item changed on one device only takes that device\'s copy (deletions stay deleted)');
  const r7 = await p.evaluate(async () => {   // Design plan 3, Step 2: the removed pages' data stays stored, encrypted, and comes back through the export
    await vaultSave(); const d = vaultOldData(); vaultSettings(); const dlg = (document.querySelector('#vdlg') || {}).textContent || ''; closeVDialog();
    return { ideas: (d['sd-ideas-v1'] || []).length, nb: (d['sd-notebook-v1'] || []).length, views: !!d['sd-views-v1'], leak: /SECRET/.test(localStorage.getItem(VAULT_KEY)), button: /Export my old ideas and notes/.test(dlg),
      gone: !document.querySelector('[data-tab="ideas"], [data-tab="notebook"], #noteBtn, .menu-note') && !searchFind('idea log', searchIndex()).some(x => x.kind === 'Page') }; });
  ok(r7.ideas === 1 && r7.nb === 1 && r7.views, 'old ideas, house views and notes come back through the export');
  ok(!r7.leak, 'the stored record still holds no readable text');
  ok(r7.button, 'the vault dialog offers “Export my old ideas and notes”');
  ok(r7.gone, 'no page, button or search result leads to the Idea log or the Notebook');
  await b.close();
  if (errors.length) { console.log('script errors:', [...new Set(errors)].join(' | ')); fails.push('script errors'); }
  if (fails.length) { console.log(`\nVault check: ${fails.length} failure(s).`); process.exit(1); }
  console.log('\nVault check passed.');
})();
