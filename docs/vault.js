// ------------------------------------------------------------------ PRIVATE VAULT, SYNC AND NOTEBOOK (WP70 to WP72, owner's request, 17 Nov 2026)
// Everything the owner writes (ideas, watchlist, house views, model portfolio, signal watch/dismiss, structured notes,
// the Notebook, the sync settings) is encrypted in this browser with a passphrase only the owner knows:
//   key  = PBKDF2-SHA-256(passphrase, random 16-byte salt, 600,000 rounds)   (Web Crypto, no library)
//   data = AES-256-GCM(key, fresh 12-byte nonce per save, JSON of the items)
// Stored as `sd-vault-v1` = { v, kdf, iter, salt, iv, ct, saved }. The passphrase and the key are never stored or sent;
// the key lives in memory while unlocked. Optional sync copies the same encrypted record to a file in the owner's own
// PRIVATE GitHub repository (WP71), so laptop and phone share one vault. Nobody, including GitHub, can read it without
// the passphrase, and a forgotten passphrase cannot be recovered.
'use strict';

const VAULT_KEY = 'sd-vault-v1', VAULT_CFG_KEY = 'sd-vault-cfg', VAULT_ITER = 600000;
const VAULT_ITEMS = ['sd-ideas-v1', 'sd-watch-v1', 'sd-views-v1', 'sd-model-v1', 'sd-signals-v1', 'sd-notes-v1', 'sd-notebook-v1', 'sd-sync-v1'];
const VAULT_LOCAL_ONLY = ['sd-sync-v1'];   // per-device: never copied to the synced file
const V = { key: null, salt: null, items: null, mtime: {}, rev: 0, lastAct: Date.now(), timer: null, syncTimer: null, sync: { state: '', at: 0, msg: '' } };

// ---- small helpers
const vEnc = new TextEncoder(), vDec = new TextDecoder();
function vB64(buf) { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); }
const vUnB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const vRecord = () => { try { return JSON.parse(localStorage.getItem(VAULT_KEY) || 'null'); } catch (e) { return null; } };
const vaultOn = () => !!vRecord();
const vaultOpen = () => !!V.items;
const vCfg = () => { try { return { autolock: 30, ...JSON.parse(localStorage.getItem(VAULT_CFG_KEY) || '{}') }; } catch (e) { return { autolock: 30 }; } };
const vCfgSet = o => { try { localStorage.setItem(VAULT_CFG_KEY, JSON.stringify({ ...vCfg(), ...o })); } catch (e) { /* this visit */ } };

// ---- crypto
async function vDeriveKey(pass, salt, iter = VAULT_ITER) {
  const base = await crypto.subtle.importKey('raw', vEnc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function vEncrypt(key, salt, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, vEnc.encode(JSON.stringify(payload)));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: VAULT_ITER, salt: vB64(salt), iv: vB64(iv), ct: vB64(ct), saved: new Date().toISOString() };
}
async function vDecrypt(key, rec) {   // throws on a wrong key or any change to the stored bytes (GCM authentication)
  return JSON.parse(vDec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: vUnB64(rec.iv) }, key, vUnB64(rec.ct))));
}
const vPayload = (syncOnly = false) => {
  const items = {}, mtime = {};
  for (const [k, v] of Object.entries(V.items || {})) if (!(syncOnly && VAULT_LOCAL_ONLY.includes(k))) { items[k] = v; mtime[k] = V.mtime[k] || 0; }
  return { items, mtime, rev: V.rev, updated: new Date().toISOString() };
};

// ---- the store the rest of the site reads and writes through (app.js and sp.js call pstore())
const VAULT_STORE = {
  getItem(k) { if (!VAULT_ITEMS.includes(k) || !vaultOn()) return localStorage.getItem(k); return V.items ? (V.items[k] ?? null) : null; },
  setItem(k, v) {
    if (!VAULT_ITEMS.includes(k) || !vaultOn()) return localStorage.setItem(k, v);
    if (!V.items) { vaultAsk(); throw new Error('The vault is locked'); }
    V.items[k] = String(v); V.mtime[k] = Date.now(); vaultSaveSoon();
  },
  removeItem(k) { if (!VAULT_ITEMS.includes(k) || !vaultOn()) return localStorage.removeItem(k); if (V.items) { delete V.items[k]; V.mtime[k] = Date.now(); vaultSaveSoon(); } },
};

// ---- set up, unlock, lock, save
async function vaultSetup(pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), key = await vDeriveKey(pass, salt), items = {}, mtime = {}, now = Date.now();
  for (const k of VAULT_ITEMS) { const v = localStorage.getItem(k); if (v != null) { items[k] = v; mtime[k] = now; } }
  const rec = await vEncrypt(key, salt, { items, mtime, rev: 1, updated: new Date().toISOString() });
  const back = await vDecrypt(key, rec);   // prove the round trip before deleting anything
  if (JSON.stringify(back.items) !== JSON.stringify(items)) throw new Error('The encryption check failed; nothing was changed.');
  localStorage.setItem(VAULT_KEY, JSON.stringify(rec));
  for (const k of VAULT_ITEMS) localStorage.removeItem(k);   // the unencrypted copies go
  Object.assign(V, { key, salt, items, mtime, rev: 1 }); vaultAfterOpen();
}
async function vaultUnlock(pass) {
  const rec = vRecord(); if (!rec) throw new Error('No vault on this device.');
  const salt = vUnB64(rec.salt), key = await vDeriveKey(pass, salt, rec.iter || VAULT_ITER);
  let p; try { p = await vDecrypt(key, rec); } catch (e) { throw new Error('That passphrase does not open the vault.'); }
  Object.assign(V, { key, salt, items: p.items || {}, mtime: p.mtime || {}, rev: p.rev || 0 }); vaultAfterOpen();
}
function vaultLock() {
  Object.assign(V, { key: null, items: null, mtime: {} });
  Object.assign(state, { watchMem: null, sigMem: null, hvMem: null, mpMem: null, nbkSel: null });
  if (typeof loadIdeas === 'function') loadIdeas();   // the ideas already in memory go too
  closeVDialog(); vaultRefresh();
}
function vaultSaveSoon() { clearTimeout(V.timer); V.timer = setTimeout(vaultSave, 300); }
async function vaultSave() {
  if (!V.key || !V.items) return;
  V.rev++;
  const rec = await vEncrypt(V.key, V.salt, vPayload());
  localStorage.setItem(VAULT_KEY, JSON.stringify(rec));
  vaultSyncSoon();
}
async function vaultChangePass(pass) {
  if (!vaultOpen()) throw new Error('Unlock first.');
  V.salt = crypto.getRandomValues(new Uint8Array(16)); V.key = await vDeriveKey(pass, V.salt); await vaultSave();
}
function vaultAfterOpen() {
  V.lastAct = Date.now();
  if (typeof loadIdeas === 'function') loadIdeas();
  vaultRefresh(); vaultSyncSoon(500);
}
function vaultRefresh() { vaultFootUi(); if (typeof renderTab === 'function' && state.tab) renderTab(); }

// ---- auto-lock after inactivity (30 minutes by default); closing the tab locks too (the key is only in memory)
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => addEventListener(ev, () => { V.lastAct = Date.now(); }, { passive: true }));
setInterval(() => { const m = +vCfg().autolock; if (vaultOpen() && m > 0 && Date.now() - V.lastAct > m * 60000) vaultLock(); }, 20000);

// ---- dialogs (no browser prompt(): a proper password field, so password managers can fill it)
function vDialog(title, body, actions) {
  closeVDialog();
  const box = el('div', { class: 'vdlg-box', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, el('h2', { text: title }), ...body, el('div', { class: 'vdlg-actions' }, ...actions));
  const d = el('div', { class: 'vdlg', id: 'vdlg', onclick: e => { if (e.target.id === 'vdlg') closeVDialog(); } }, box);
  document.body.append(d); const f = box.querySelector('input'); if (f) setTimeout(() => f.focus(), 30);
  return box;
}
function closeVDialog() { const d = $('#vdlg'); if (d) d.remove(); }
addEventListener('keydown', e => { if (e.key === 'Escape') closeVDialog(); });
function vaultAsk(then) {   // unlock (or set up) and then carry on
  if (vaultOpen()) { if (then) then(); return; }
  if (!vaultOn()) { vaultSetupDialog(then); return; }
  const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Passphrase', class: 'vdlg-in', name: 'vault-passphrase' });
  const msg = el('p', { class: 'muted small', text: 'Your notes, ideas and views are encrypted on this device. Enter your passphrase to open them.' });
  const go = el('button', { type: 'button', class: 'primary', text: 'Unlock' });
  const run = async () => { go.disabled = true; go.textContent = 'Opening…'; try { await vaultUnlock(pw.value); closeVDialog(); if (then) then(); } catch (e) { msg.textContent = e.message; msg.classList.add('vdlg-err'); go.disabled = false; go.textContent = 'Unlock'; pw.select(); } };
  go.onclick = run; pw.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  vDialog('Unlock your private notes', [msg, el('form', { onsubmit: e => { e.preventDefault(); run(); } }, el('input', { type: 'text', name: 'username', value: 'strategist-dashboard', autocomplete: 'username', hidden: true }), pw)],
    [el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: closeVDialog }), go]);
}
function vStrength(p) {
  const k = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(p)).length, n = p.length;
  return n < 12 ? ['too short (at least 12 characters)', 0] : n >= 20 || (n >= 14 && k >= 3) ? ['strong', 3] : k >= 2 ? ['fair: longer is better', 2] : ['weak: add words or symbols', 1];
}
function vaultSetupDialog(then) {
  const p1 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Passphrase (12 characters or more)', class: 'vdlg-in' });
  const p2 = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Type it again', class: 'vdlg-in' });
  const st = el('div', { class: 'muted small' }), ok = el('input', { type: 'checkbox', id: 'vOk' });
  const msg = el('p', { class: 'small', text: '' });
  p1.addEventListener('input', () => { const [t] = vStrength(p1.value); st.textContent = p1.value ? 'Strength: ' + t : ''; });
  const go = el('button', { type: 'button', class: 'primary', text: 'Encrypt my notes' });
  go.onclick = async () => {
    if (vStrength(p1.value)[1] < 2) { msg.textContent = 'Choose a longer passphrase (12 characters or more; a few unrelated words work well).'; return; }
    if (p1.value !== p2.value) { msg.textContent = 'The two entries differ.'; return; }
    if (!ok.checked) { msg.textContent = 'Please tick the box: there is no way to recover a forgotten passphrase.'; return; }
    go.disabled = true; go.textContent = 'Encrypting…';
    try { await vaultSetup(p1.value); closeVDialog(); if (then) then(); } catch (e) { msg.textContent = e.message; go.disabled = false; go.textContent = 'Encrypt my notes'; }
  };
  vDialog('Set up your private vault', [
    el('p', { class: 'small', text: 'Choose a passphrase. Your ideas, watchlist, house views, model portfolio, structured notes and Notebook will be encrypted on this device with it, and the unencrypted copies deleted.' }),
    p1, st, p2,
    el('label', { class: 'small vdlg-ok' }, ok, ' I understand that nobody can recover a forgotten passphrase. I will keep it in my password manager.'),
    el('p', { class: 'muted small', text: 'Tip: to use the same notes on your phone, turn on sync afterwards (Notebook → Vault & sync).' }), msg],
    [el('button', { type: 'button', class: 'ghost', text: 'Not now', onclick: closeVDialog }), go]);
}

// ---- backup file (the encrypted record itself; restoring needs the passphrase)
function vaultBackup() {
  const rec = vRecord(); if (!rec) return;
  const blob = new Blob([JSON.stringify({ app: 'strategist-dashboard', kind: 'vault-backup', version: 4, record: rec }, null, 1)], { type: 'application/json' });
  const url = URL.createObjectURL(blob); download(url, `strategist-vault_${iso(Date.now())}.json`); setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function vaultRestore(file) {
  let j; try { j = JSON.parse(await file.text()); } catch (e) { alert('That file is not a vault backup.'); return; }
  const rec = j && j.kind === 'vault-backup' ? j.record : null;
  if (!rec || !rec.ct) { alert('That file is not a vault backup (an older unencrypted export goes through Idea log → Import).'); return; }
  const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Passphrase used for that backup', class: 'vdlg-in' }), msg = el('p', { class: 'muted small', text: 'Items in the backup that are newer than yours replace yours; nothing else is removed.' });
  const go = el('button', { type: 'button', class: 'primary', text: 'Restore' });
  go.onclick = async () => {
    try {
      const key = await vDeriveKey(pw.value, vUnB64(rec.salt), rec.iter || VAULT_ITER); let p; try { p = await vDecrypt(key, rec); } catch (e) { throw new Error('That passphrase does not open the backup.'); }
      if (!vaultOn()) { localStorage.setItem(VAULT_KEY, JSON.stringify(rec)); Object.assign(V, { key, salt: vUnB64(rec.salt), items: p.items || {}, mtime: p.mtime || {}, rev: p.rev || 0 }); }
      else { const m = vMerge(V.items, V.mtime, p.items || {}, p.mtime || {}, 0); V.items = m.items; V.mtime = m.mtime; await vaultSave(); }
      closeVDialog(); vaultAfterOpen(); alert('Restored.');
    } catch (e) { msg.textContent = e.message; }
  };
  vDialog('Restore from a backup', [msg, pw], [el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: closeVDialog }), go]);
}

// ---- merge two copies of the vault: per item the newer copy wins; if both changed since the last sync and the item is a
// list of records with ids, the lists are joined (newer record kept for the same id). Deletions made on both devices
// between two syncs can come back in that one case; everything else follows the latest edit.
function vMerge(aItems, aM, bItems, bM, last) {
  const items = {}, mtime = {};
  for (const k of new Set([...Object.keys(aItems), ...Object.keys(bItems)])) {
    const am = aM[k] || 0, bm = bM[k] || 0, inA = k in aItems, inB = k in bItems;
    if (inA && inB && am > last && bm > last) {
      try { const a = JSON.parse(aItems[k]), b = JSON.parse(bItems[k]);
        if (Array.isArray(a) && Array.isArray(b) && [...a, ...b].every(x => x && x.id)) {
          const ts = x => Date.parse(x.updated || x.upd || x.closeDate || x.date || 0) || 0, m = new Map();
          for (const x of (am >= bm ? [...b, ...a] : [...a, ...b])) { const y = m.get(x.id); if (!y || ts(x) >= ts(y)) m.set(x.id, x); }
          items[k] = JSON.stringify([...m.values()]); mtime[k] = Math.max(am, bm); continue; } } catch (e) { /* not a list: newest wins */ }
    }
    if (inA && (!inB || am >= bm)) { items[k] = aItems[k]; mtime[k] = am; } else if (inB) { items[k] = bItems[k]; mtime[k] = bm; }
  }
  return { items, mtime };
}

// ---- WP71: sync through a file in the owner's private GitHub repository (fine-grained token, Contents read/write, that repository only)
const vSyncCfg = () => { try { return V.items && V.items['sd-sync-v1'] ? JSON.parse(V.items['sd-sync-v1']) : null; } catch (e) { return null; } };
const vSyncSet = o => { V.items['sd-sync-v1'] = JSON.stringify(o); V.mtime['sd-sync-v1'] = Date.now(); };
function vaultSyncSoon(ms = 4000) { if (!vSyncCfg()) return; clearTimeout(V.syncTimer); V.syncTimer = setTimeout(() => vaultSync().catch(e => vSyncStatus('error', e.message)), ms); }
function vSyncStatus(s, msg = '') { V.sync = { state: s, at: Date.now(), msg }; const x = $('#vSyncState'); if (x) x.textContent = vSyncLine(); vaultFootUi(); }
const vSyncLine = () => { const s = V.sync; return !vSyncCfg() ? 'Sync is off.' : s.state === 'ok' ? `Synced ${timeAgo(s.at)}.` : s.state === 'busy' ? 'Syncing…' : s.state === 'error' ? `Sync failed: ${s.msg}` : 'Waiting to sync.'; };
const vGh = cfg => ({ Authorization: 'Bearer ' + cfg.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
async function vaultSync(askPass = true) {
  const cfg = vSyncCfg(); if (!cfg || !vaultOpen()) return;
  vSyncStatus('busy');
  const repo = await fetch(`https://api.github.com/repos/${cfg.repo}`, { headers: vGh(cfg), cache: 'no-store' });
  if (repo.status === 401) throw new Error('the access token was refused (expired or revoked?)');
  if (!repo.ok) throw new Error(`could not open ${cfg.repo} (${repo.status})`);
  if (!(await repo.json()).private) throw new Error(`${cfg.repo} is public; sync only works with a private repository`);
  const url = `https://api.github.com/repos/${cfg.repo}/contents/${(cfg.path || 'vault.json').split('/').map(encodeURIComponent).join('/')}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(url, { headers: vGh(cfg), cache: 'no-store' });
    let sha = null;
    if (r.status === 200) {
      const j = await r.json(); sha = j.sha; const rec = JSON.parse(atob(j.content.replace(/\s/g, '')));
      let key = V.key;
      if (rec.salt !== vB64(V.salt)) {   // the passphrase was set or changed on another device: ask for it once and adopt that copy's salt
        if (!askPass) throw new Error('the synced copy uses a different passphrase');
        const pass = await vAskPassFor('The synced copy was saved with a different passphrase (changed on another device?). Enter it to merge.');
        key = await vDeriveKey(pass, vUnB64(rec.salt), rec.iter || VAULT_ITER);
      }
      let p; try { p = await vDecrypt(key, rec); } catch (e) { throw new Error('that passphrase does not open the synced copy'); }
      V.key = key; V.salt = vUnB64(rec.salt);
      const keepLocal = Object.fromEntries(VAULT_LOCAL_ONLY.filter(k => k in V.items).map(k => [k, V.items[k]]));
      const m = vMerge(V.items, V.mtime, p.items || {}, p.mtime || {}, cfg.last || 0);
      V.items = { ...m.items, ...keepLocal }; V.mtime = m.mtime;
    } else if (r.status !== 404) throw new Error(`reading the synced copy failed (${r.status})`);
    const out = await vEncrypt(V.key, V.salt, vPayload(true));
    const put = await fetch(url, { method: 'PUT', headers: { ...vGh(cfg), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'vault update', content: btoa(JSON.stringify(out)), ...(sha ? { sha } : {}) }) });
    if (put.status === 409 || put.status === 422) continue;   // someone else wrote first: read again and merge
    if (!put.ok) throw new Error(`saving the synced copy failed (${put.status})`);
    vSyncSet({ ...vSyncCfg(), last: Date.now() });
    const rec = await vEncrypt(V.key, V.salt, vPayload()); localStorage.setItem(VAULT_KEY, JSON.stringify(rec));
    if (typeof loadIdeas === 'function') loadIdeas();
    vSyncStatus('ok'); if (['ideas', 'notebook', 'sp'].includes(state.tab)) renderTab();
    return;
  }
  throw new Error('the synced copy kept changing; try again');
}
function vAskPassFor(text) {
  return new Promise((resolve, reject) => {
    const pw = el('input', { type: 'password', autocomplete: 'current-password', class: 'vdlg-in' });
    const go = el('button', { type: 'button', class: 'primary', text: 'Continue', onclick: () => { closeVDialog(); resolve(pw.value); } });
    pw.addEventListener('keydown', e => { if (e.key === 'Enter') go.click(); });
    vDialog('Passphrase needed', [el('p', { class: 'small', text }), pw], [el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: () => { closeVDialog(); reject(new Error('cancelled')); } }), go]);
  });
}
async function vaultConnectNew(repo, token, pass) {   // a new device: take the vault from the synced copy
  const cfg = { repo, token, path: 'vault.json' };
  const r = await fetch(`https://api.github.com/repos/${repo}/contents/vault.json`, { headers: vGh(cfg), cache: 'no-store' });
  if (r.status === 404) throw new Error('No synced vault in that repository yet: set up the vault on your first device and turn on sync there.');
  if (!r.ok) throw new Error(`Could not read from ${repo} (${r.status}). Check the repository name and the token.`);
  const rec = JSON.parse(atob((await r.json()).content.replace(/\s/g, '')));
  const key = await vDeriveKey(pass, vUnB64(rec.salt), rec.iter || VAULT_ITER); let p;
  try { p = await vDecrypt(key, rec); } catch (e) { throw new Error('That passphrase does not open the synced vault.'); }
  for (const k of VAULT_ITEMS) localStorage.removeItem(k);
  Object.assign(V, { key, salt: vUnB64(rec.salt), items: p.items || {}, mtime: p.mtime || {}, rev: p.rev || 0 });
  vSyncSet({ ...cfg, last: Date.now() }); await vaultSave(); vSyncStatus('ok'); vaultAfterOpen();
}

// ---- the menu foot: lock state, one click to lock or unlock
function vaultFootUi() {
  const foot = $('.side-foot'); if (!foot) return;
  let b = $('#lockBtn'); if (!b) { b = el('button', { id: 'lockBtn', class: 'ghost', type: 'button' }); foot.prepend(b); }
  const on = vaultOn(), open = vaultOpen();
  b.textContent = !on ? '🔒 Set up private vault' : open ? '🔓 Notes open · Lock' : '🔒 Notes locked · Unlock';
  b.title = !on ? 'Encrypt your notes, ideas and views with a passphrase' : open ? `Locks after ${vCfg().autolock} minutes without activity. ${vSyncLine()}` : 'Enter your passphrase to open your private notes';
  b.onclick = () => !on ? vaultSetupDialog() : open ? vaultLock() : vaultAsk();
}
// a locked private area shows this instead of its content (returns true when locked)
function vaultGate(host, what = 'This page') {
  const locked = vaultOn() && !vaultOpen();
  let g = host.querySelector(':scope > .vgate');
  if (locked && !g) { g = el('div', { class: 'vgate card' }, el('h2', { text: '🔒 ' + what + ' is locked' }),
      el('p', { class: 'muted small', text: 'Your notes, ideas and views are encrypted on this device. Unlock to see and change them.' }),
      el('button', { type: 'button', class: 'primary', text: 'Unlock', onclick: () => vaultAsk() }));
    host.prepend(g); }
  if (g) g.hidden = !locked;
  host.classList.toggle('vlocked', locked);
  return locked;
}
function vaultLockedCard(c) {   // for single cards (structured notes): an empty state with an unlock button
  if (!(vaultOn() && !vaultOpen())) return false;
  const b = htmlBody(c); b.append(el('div', { class: 'empty' }, '🔒 Locked. ', el('button', { type: 'button', class: 'ghost', text: 'Unlock', onclick: () => vaultAsk() })));
  return true;
}

// ------------------------------------------------------------------ WP72. Notebook
const NBK_KEY = 'sd-notebook-v1';
const nbkLoad = () => { try { const j = JSON.parse(pstore().getItem(NBK_KEY) || '[]'); return Array.isArray(j) ? j : []; } catch (e) { return []; } };
const nbkSave = L => pstore().setItem(NBK_KEY, JSON.stringify(L));
const nbkId = () => 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const subLabel = (t, i) => SUBTABS[t] && SUBTABS[t][i] ? SUBTABS[t][i][0] : '';
const pageRef = (card) => ({ tab: state.tab, sub: SUBTABS[state.tab] ? (state.sub[state.tab] || 0) : null, subLabel: SUBTABS[state.tab] ? subLabel(state.tab, state.sub[state.tab] || 0) : '', card: card ? card.key : null, cardTitle: card ? (card.titleEl.textContent || card.title) : '' });
const pageRefTxt = p => !p ? '' : [TAB_TITLES[p.tab] || p.tab, p.subLabel, p.cardTitle].filter(Boolean).join(' → ');
function nbkGo(p) { if (!p) return; setTab(p.tab); if (p.subLabel && SUBTABS[p.tab]) goSub(p.tab, p.subLabel); const c = p.card && cards[p.card]; if (c) setTimeout(() => { c.root.scrollIntoView({ block: 'center', behavior: 'smooth' }); c.root.classList.remove('flash'); void c.root.offsetWidth; c.root.classList.add('flash'); }, 150); }
// the quick-note panel: from the page header or a card's menu
function noteQuick(card = null) {
  if (vaultOn() && !vaultOpen()) { vaultAsk(() => noteQuick(card)); return; }
  if (!vaultOn()) { vaultSetupDialog(() => noteQuick(card)); return; }
  const ref = pageRef(card), here = nbkLoad().filter(n => n.page && n.page.tab === ref.tab && (!card || n.page.card === ref.card)).slice(-4).reverse();
  const title = el('input', { type: 'text', class: 'vdlg-in', placeholder: 'Title', value: ref.cardTitle || ref.subLabel || TAB_TITLES[ref.tab] || '' });
  const text = el('textarea', { class: 'vdlg-in', rows: 6, placeholder: 'Your note' }), tags = el('input', { type: 'text', class: 'vdlg-in', placeholder: 'Tags, separated by commas (optional)' });
  const list = here.length ? el('div', { class: 'vdlg-list' }, el('div', { class: 'pop-label', text: card ? 'Notes on this chart' : 'Recent notes on this page' }),
    ...here.map(n => el('button', { type: 'button', class: 'vdlg-note', onclick: () => { closeVDialog(); state.nbkSel = n.id; setTab('notebook'); goSub('notebook', 'Notes'); } }, el('b', { text: n.title }), ` · ${nice(Date.parse(n.updated))}`))) : null;
  const go = el('button', { type: 'button', class: 'primary', text: 'Save note', onclick: () => {
    if (!text.value.trim() && !title.value.trim()) return;
    const now = new Date().toISOString(), L = nbkLoad();
    L.push({ id: nbkId(), title: title.value.trim() || 'Note', text: text.value, tags: tags.value.split(',').map(s => s.trim()).filter(Boolean), page: ref, created: now, updated: now, pinned: false });
    nbkSave(L); closeVDialog(); afterRenderNotes(); } });
  vDialog(card ? 'Note on this chart' : 'Note on this page', [el('p', { class: 'muted small', text: pageRefTxt(ref) + ' · encrypted in your vault' }), ...(list ? [list] : []), title, text, tags],
    [el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: closeVDialog }), go]);
}
state.nbkQ = ''; state.nbkTag = ''; state.nbkSel = null;
function renderNbkList(c) {
  const b = htmlBody(c);
  if (!vaultOn()) { b.append(el('div', { class: 'empty' }, 'Notes are kept in your private vault. ', el('button', { type: 'button', class: 'primary', text: 'Set up the vault', onclick: () => vaultSetupDialog() }))); return; }
  if (vaultLockedCard(c)) return;
  const L = nbkLoad(), tagsAll = [...new Set(L.flatMap(n => n.tags || []))].sort();
  const q = el('input', { type: 'search', class: 'nbk-q', placeholder: 'Search notes', value: state.nbkQ });
  q.addEventListener('input', () => { state.nbkQ = q.value; c.render(); setTimeout(() => { const x = c.root.querySelector('.nbk-q'); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }, 0); });
  const tg = el('select', { class: 'mini-select', 'aria-label': 'Tag' }, el('option', { value: '', text: 'All tags' }), ...tagsAll.map(t => el('option', { value: t, text: t })));
  tg.value = state.nbkTag; tg.onchange = () => { state.nbkTag = tg.value; c.render(); };
  const add = el('button', { type: 'button', class: 'primary', text: '＋ New note', onclick: () => { const now = new Date().toISOString(), n = { id: nbkId(), title: 'New note', text: '', tags: [], page: null, created: now, updated: now, pinned: false }; nbkSave([...nbkLoad(), n]); state.nbkSel = n.id; renderTab(); } });
  b.append(el('div', { class: 'controls nbk-bar' }, q, tg, add));
  const words = state.nbkQ.toLowerCase().split(/\s+/).filter(Boolean);
  const rows = L.filter(n => (!state.nbkTag || (n.tags || []).includes(state.nbkTag)) && words.every(w => [n.title, n.text, (n.tags || []).join(' '), pageRefTxt(n.page)].join(' ').toLowerCase().includes(w)))
    .sort((x, y) => (y.pinned - x.pinned) || Date.parse(y.updated) - Date.parse(x.updated));
  if (!rows.length) { b.append(el('div', { class: 'empty', text: L.length ? 'No note matches.' : 'No notes yet. Use “＋ Note” in any page header, or the “⋯” menu on a chart, to write one there.' })); return; }
  const tb = el('tbody');
  for (const n of rows) tb.append(el('tr', { class: 'row' + (n.id === state.nbkSel ? ' sel' : ''), style: 'cursor:pointer', onclick: () => { state.nbkSel = n.id; renderTab(); } },
    el('td', { class: 'l' }, n.pinned ? '📌 ' : '', el('b', { text: n.title }), el('span', { class: 'cell-sub', text: (n.text || '').slice(0, 110) })),
    el('td', { class: 'l muted', text: (n.tags || []).join(', ') }), el('td', { class: 'l muted', text: pageRefTxt(n.page) || '–' }), el('td', { class: 'num muted', text: nice(Date.parse(n.updated)) })));
  b.append(el('div', { class: 'table-wrap' }, el('table', { class: 'perf watch' }, el('thead', {}, el('tr', {}, ...['Note', 'Tags', 'Written on', 'Updated'].map((h, i) => el('th', { text: h, class: i < 3 ? 'l' : '' })))), tb)));
  capRows(tb, 'nbk', 16);
  c.csv = [['Title', 'Text', 'Tags', 'Page', 'Updated'], ...rows.map(n => [n.title, n.text, (n.tags || []).join('; '), pageRefTxt(n.page), n.updated])];
  setNote(c, `${L.length} note${L.length === 1 ? '' : 's'}, encrypted in your vault${vSyncCfg() ? ' and synced to your private repository' : ' on this device'}. Search covers titles, text, tags and pages; Ctrl+K finds notes too while the vault is open.`);
}
function renderNbkEdit(c) {
  const b = htmlBody(c); if (!vaultOn() || vaultLockedCard(c)) { if (!vaultOn()) b.append(el('div', { class: 'empty', text: 'Set up the vault to write notes.' })); return; }
  const L = nbkLoad(), n = L.find(x => x.id === state.nbkSel);
  if (!n) { b.append(el('div', { class: 'empty', text: 'Pick a note on the left, or start a new one.' })); c.titleEl.textContent = 'Note'; return; }
  c.titleEl.textContent = 'Note';
  const title = el('input', { type: 'text', class: 'vdlg-in', value: n.title }), text = el('textarea', { class: 'vdlg-in nbk-text', rows: 14, text: n.text || '' });
  const tags = el('input', { type: 'text', class: 'vdlg-in', value: (n.tags || []).join(', '), placeholder: 'Tags, separated by commas' });
  const save = () => { const all = nbkLoad(), x = all.find(y => y.id === n.id); if (!x) return; Object.assign(x, { title: title.value.trim() || 'Note', text: text.value, tags: tags.value.split(',').map(s => s.trim()).filter(Boolean), updated: new Date().toISOString() }); nbkSave(all); st.textContent = 'Saved ' + new Date().toLocaleTimeString(); cards.nbk_list && cards.nbk_list.render(); };
  let t = null; const soon = () => { clearTimeout(t); st.textContent = 'Editing…'; t = setTimeout(save, 700); };
  [title, text, tags].forEach(x => x.addEventListener('input', soon));
  const st = el('span', { class: 'muted small', text: 'Saved' });
  const pin = el('button', { type: 'button', class: 'ghost', text: n.pinned ? 'Unpin' : '📌 Pin', onclick: () => { const all = nbkLoad(), x = all.find(y => y.id === n.id); x.pinned = !x.pinned; nbkSave(all); renderTab(); } });
  const del = el('button', { type: 'button', class: 'ghost', text: 'Delete', onclick: () => { if (!confirm('Delete this note?')) return; nbkSave(nbkLoad().filter(y => y.id !== n.id)); state.nbkSel = null; renderTab(); } });
  b.append(title, text, tags, el('div', { class: 'controls' }, n.page ? el('a', { href: '#', text: 'Open ' + pageRefTxt(n.page) + ' →', onclick: e => { e.preventDefault(); nbkGo(n.page); } }) : el('span', { class: 'muted small', text: 'Not tied to a page' }), pin, del, st));
  setNote(c, 'Changes save themselves a moment after you stop typing, encrypted in your vault.');
}
function renderVaultSet(c) {
  const b = htmlBody(c), on = vaultOn(), open = vaultOpen(), cfg = vCfg(), sc = open ? vSyncCfg() : null;
  const row = (label, ...kids) => el('div', { class: 'vset-row' }, el('div', { class: 'vset-l', text: label }), el('div', { class: 'vset-r' }, ...kids));
  if (!on) {
    b.append(row('Status', el('span', { text: 'Not set up. Your ideas and notes are stored unencrypted in this browser.' })),
      row('Start', el('button', { type: 'button', class: 'primary', text: 'Set up the vault on this device', onclick: () => vaultSetupDialog() })),
      row('Or', el('div', {}, el('div', { class: 'small', text: 'Already set up on another device with sync? Connect this one:' }), vConnectForm())));
    setNote(c, 'Encryption happens in your browser; nothing readable leaves this device.'); return;
  }
  if (!open) { b.append(row('Status', el('span', { text: '🔒 Locked' }), el('button', { type: 'button', class: 'primary', text: 'Unlock', onclick: () => vaultAsk() }))); return; }
  const al = el('select', { class: 'mini-select', 'aria-label': 'Auto-lock' }, ...[[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [0, 'Never (not advised)']].map(([v, t]) => el('option', { value: v, text: t })));
  al.value = String(cfg.autolock); al.onchange = () => { vCfgSet({ autolock: +al.value }); vaultFootUi(); };
  const file = el('input', { type: 'file', accept: '.json,application/json', hidden: true }); file.onchange = () => { if (file.files[0]) vaultRestore(file.files[0]); file.value = ''; };
  const repo = el('input', { type: 'text', class: 'vdlg-in', placeholder: 'your-name/strategist-private', value: sc ? sc.repo : '' }), tok = el('input', { type: 'password', class: 'vdlg-in', placeholder: sc ? 'Token saved (enter a new one to replace it)' : 'Fine-grained access token', autocomplete: 'off' });
  const smsg = el('div', { class: 'small', id: 'vSyncState', text: vSyncLine() });
  b.append(row('Status', el('span', { text: '🔓 Open on this device' }), el('button', { type: 'button', class: 'ghost', text: 'Lock now', onclick: vaultLock })),
    row('Auto-lock after', al),
    row('Passphrase', el('button', { type: 'button', class: 'ghost', text: 'Change passphrase', onclick: vChangeDialog })),
    row('Backup', el('button', { type: 'button', class: 'ghost', text: '⤓ Download encrypted backup', onclick: vaultBackup }), el('button', { type: 'button', class: 'ghost', text: 'Restore from a backup', onclick: () => file.click() }), file),
    row('Sync (laptop + phone)', el('div', { class: 'vset-sync' }, repo, tok, el('div', { class: 'controls' },
      el('button', { type: 'button', class: 'primary', text: sc ? 'Save and sync now' : 'Turn on sync', onclick: async () => {
        const r = repo.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''); if (!/^[\w.-]+\/[\w.-]+$/.test(r)) { smsg.textContent = 'Repository: owner/name, for example your-name/strategist-private.'; return; }
        const t = tok.value.trim() || (sc && sc.token); if (!t) { smsg.textContent = 'Paste the access token.'; return; }
        vSyncSet({ ...(sc || {}), repo: r, token: t, path: 'vault.json', last: sc && sc.repo === r ? sc.last || 0 : 0 }); tok.value = ''; vaultSaveSoon();
        try { await vaultSync(); } catch (e) { vSyncStatus('error', e.message); } c.render(); } }),
      sc ? el('button', { type: 'button', class: 'ghost', text: 'Turn off sync', onclick: () => { delete V.items['sd-sync-v1']; V.mtime['sd-sync-v1'] = Date.now(); vaultSaveSoon(); vSyncStatus(''); c.render(); } }) : null), smsg,
      el('details', { class: 'vset-help' }, el('summary', { text: 'How to set up sync (about five minutes, once)' }), el('ol', {},
        el('li', { text: 'On github.com, create a new repository, for example “strategist-private”, and choose Private.' }),
        el('li', { text: 'Go to Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Repository access: Only select repositories → strategist-private. Permissions: Contents → Read and write. Expiry: one year.' }),
        el('li', { text: 'Copy the token, paste it above with the repository name, and press “Turn on sync”.' }),
        el('li', { text: 'On your phone, open the dashboard → Notebook → Vault & sync → “Connect this device”, with the same repository, a token (the same or a second one) and your passphrase.' }),
        el('li', { text: 'If a device is lost, delete its token on GitHub. Keep two-step login on for your GitHub account.' }))))));
  setNote(c, 'What is encrypted: ideas, watchlist, house views, model portfolio, signal watch and dismiss, structured notes, the Notebook, and the sync token itself. The synced file is encrypted before it leaves this device; GitHub only ever sees ciphertext. It protects against anyone opening the site and anyone with the stored or synced file. It does not protect against malware on the device. Follow your employer’s policy on client information.');
}
function vConnectForm() {
  const repo = el('input', { type: 'text', class: 'vdlg-in', placeholder: 'your-name/strategist-private' }), tok = el('input', { type: 'password', class: 'vdlg-in', placeholder: 'Fine-grained access token', autocomplete: 'off' });
  const pw = el('input', { type: 'password', class: 'vdlg-in', placeholder: 'Vault passphrase', autocomplete: 'current-password' }), msg = el('div', { class: 'small' });
  return el('div', { class: 'vset-sync' }, repo, tok, pw, el('button', { type: 'button', class: 'primary', text: 'Connect this device', onclick: async () => {
    msg.textContent = 'Connecting…'; try { await vaultConnectNew(repo.value.trim(), tok.value.trim(), pw.value); msg.textContent = 'Connected.'; } catch (e) { msg.textContent = e.message; } } }), msg);
}
function vChangeDialog() {
  const p1 = el('input', { type: 'password', autocomplete: 'new-password', class: 'vdlg-in', placeholder: 'New passphrase' }), p2 = el('input', { type: 'password', autocomplete: 'new-password', class: 'vdlg-in', placeholder: 'Type it again' }), msg = el('p', { class: 'small' });
  vDialog('Change passphrase', [el('p', { class: 'muted small', text: 'Other synced devices will ask for the new passphrase at their next sync.' }), p1, p2, msg],
    [el('button', { type: 'button', class: 'ghost', text: 'Cancel', onclick: closeVDialog }), el('button', { type: 'button', class: 'primary', text: 'Change', onclick: async () => {
      if (vStrength(p1.value)[1] < 2) { msg.textContent = 'At least 12 characters, please.'; return; } if (p1.value !== p2.value) { msg.textContent = 'The two entries differ.'; return; }
      await vaultChangePass(p1.value); closeVDialog(); alert('Passphrase changed.'); } })]);
}

// ---- notes in the page header, card menus, dots on cards with notes, and search
function afterRenderNotes() {
  const btn = $('#noteBtn'); if (!btn) return;
  const open = vaultOpen(), L = open ? nbkLoad() : [], here = L.filter(n => n.page && n.page.tab === state.tab);
  btn.textContent = here.length ? `＋ Note · ${here.length}` : '＋ Note';
  btn.title = open ? (here.length ? `${here.length} note${here.length > 1 ? 's' : ''} on this page; add another` : 'Write a note on this page') : 'Write a private note on this page (encrypted)';
  const keys = new Set(L.filter(n => n.page && n.page.card).map(n => n.page.card));
  for (const [k, c] of Object.entries(cards)) c.root.classList.toggle('has-note', open && keys.has(k));
}
function vaultSearch() {
  if (!vaultOpen()) return [];
  return nbkLoad().map(n => ({ kind: 'Note', label: n.title, where: 'Notebook' + (n.page ? ' · ' + pageRefTxt(n.page) : ''), tab: 'notebook', note: n.id, hay: [n.title, n.text, (n.tags || []).join(' ')].join(' ') }));
}
function buildVault() {
  // notebook page
  const g = $('#nbkGrid');
  makeCard(g, { key: 'nbk_list', title: 'Notes', range: false, render: renderNbkList });
  makeCard(g, { key: 'nbk_edit', title: 'Note', range: false, render: renderNbkEdit });
  makeCard(g, { key: 'vault_set', title: 'Vault and sync', wide: true, range: false, render: renderVaultSet });
  for (const k of ['nbk_list', 'nbk_edit', 'vault_set']) { const r = cards[k].root; r.querySelector('[title^="Focus"]').hidden = true; r.querySelector('[title^="Download chart as"]').hidden = true; }
  // "+ Note" in the page header and in every card's menu
  const pg = $('.page-head .ph-title'); if (pg && !$('#noteBtn')) pg.append(el('button', { id: 'noteBtn', type: 'button', class: 'ghost note-btn', text: '＋ Note', onclick: () => noteQuick() }));
  for (const c of Object.values(cards)) if (c.menuEl && !c.menuEl.querySelector('.menu-note')) {
    const src = c.menuEl.querySelector('.menu-src-wrap');
    const b = el('button', { class: 'menu-item menu-note', type: 'button', text: '＋ Note on this chart', onclick: () => { closePops(); noteQuick(c); } });
    if (src) src.before(b); else c.menuEl.append(b);
  }
  vaultFootUi();
}
SUBTABS.notebook = [['Notes', ['nbk_list', 'nbk_edit']], ['Vault & sync', ['vault_set']]];
TAB_TITLES.notebook = 'Notebook';
TILE_SETS.notebook = {};
