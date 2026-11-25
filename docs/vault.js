// ------------------------------------------------------------------ PRIVATE VAULT AND SYNC (WP70, WP71, owner's request, 17 Nov 2026)
// Everything the owner writes (watchlist, model portfolio, signal watch/dismiss, structured notes, the sync settings, and
// what is kept from the Idea log, house views and Notebook removed on 25 Nov 2026) is encrypted in this browser with a
// passphrase only the owner knows:
//   key  = PBKDF2-SHA-256(passphrase, random 16-byte salt, 600,000 rounds)   (Web Crypto, no library)
//   data = AES-256-GCM(key, fresh 12-byte nonce per save, JSON of the items)
// Stored as `sd-vault-v1` = { v, kdf, iter, salt, iv, ct, saved }. The passphrase and the key are never stored or sent;
// the key lives in memory while unlocked. Optional sync copies the same encrypted record to a file in the owner's own
// PRIVATE GitHub repository (WP71), so laptop and phone share one vault. Nobody, including GitHub, can read it without
// the passphrase, and a forgotten passphrase cannot be recovered.
'use strict';

const VAULT_KEY = 'sd-vault-v1', VAULT_CFG_KEY = 'sd-vault-cfg', VAULT_ITER = 600000;
// sd-ideas-v1, sd-views-v1 and sd-notebook-v1 belong to pages removed in Design plan 3: no page reads them, but they stay
// listed so what is stored keeps being encrypted, synced and exportable (vaultExportOld). Never drop them from this list.
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
  Object.assign(state, { watchMem: null, sigMem: null, mpMem: null });   // copies kept in memory go too
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
  const msg = el('p', { class: 'muted small', text: 'Your watchlist, model portfolio and notes are encrypted on this device. Enter your passphrase to open them.' });
  const go = el('button', { type: 'button', class: 'primary', text: 'Unlock' });
  const run = async () => { go.disabled = true; go.textContent = 'Opening…'; try { await vaultUnlock(pw.value); closeVDialog(); if (then) then(); } catch (e) { msg.textContent = e.message; msg.classList.add('vdlg-err'); go.disabled = false; go.textContent = 'Unlock'; pw.select(); } };
  go.onclick = run; pw.addEventListener('keydown', e => { if (e.key === 'Enter') run(); });
  vDialog('Unlock your private vault', [msg, el('form', { onsubmit: e => { e.preventDefault(); run(); } }, el('input', { type: 'text', name: 'username', value: 'strategist-dashboard', autocomplete: 'username', hidden: true }), pw)],
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
    el('p', { class: 'small', text: 'Choose a passphrase. Your watchlist, model portfolio, signal watch, structured notes and anything kept from the old Idea log and Notebook will be encrypted on this device with it, and the unencrypted copies deleted.' }),
    p1, st, p2,
    el('label', { class: 'small vdlg-ok' }, ok, ' I understand that nobody can recover a forgotten passphrase. I will keep it in my password manager.'),
    el('p', { class: 'muted small', text: 'Tip: to use the same vault on your phone, turn on sync afterwards (the vault button at the foot of the menu).' }), msg],
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
  if (!rec || !rec.ct) { alert('That file is not a vault backup.'); return; }
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
    vSyncStatus('ok'); if (['sp', 'markets', 'alloc', 'signals'].includes(state.tab)) renderTab();
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
  b.textContent = !on ? '🔒 Set up private vault' : open ? '🔓 Vault open' : '🔒 Vault locked · Unlock';
  b.title = !on ? 'Encrypt your watchlist, model portfolio and notes with a passphrase' : open ? `Vault and sync settings, and Lock. Locks after ${vCfg().autolock} minutes without activity. ${vSyncLine()}` : 'Enter your passphrase to open your private vault';
  b.onclick = () => !on || open ? vaultSettings() : vaultAsk();
}
function vaultLockedCard(c) {   // for single cards (structured notes): an empty state with an unlock button
  if (!(vaultOn() && !vaultOpen())) return false;
  const b = htmlBody(c); b.append(el('div', { class: 'empty' }, '🔒 Locked. ', el('button', { type: 'button', class: 'ghost', text: 'Unlock', onclick: () => vaultAsk() })));
  return true;
}

function vaultSetRows(fill) {   // the rows of the settings dialog; fill() redraws them
  const b = [], on = vaultOn(), open = vaultOpen(), cfg = vCfg(), sc = open ? vSyncCfg() : null;
  const row = (label, ...kids) => el('div', { class: 'vset-row' }, el('div', { class: 'vset-l', text: label }), el('div', { class: 'vset-r' }, ...kids));
  if (!on) {
    b.push(row('Status', el('span', { text: 'Not set up. Your watchlist, model portfolio and notes are stored unencrypted in this browser.' })),
      row('Start', el('button', { type: 'button', class: 'primary', text: 'Set up the vault on this device', onclick: () => vaultSetupDialog() })),
      row('Or', el('div', {}, el('div', { class: 'small', text: 'Already set up on another device with sync? Connect this one:' }), vConnectForm())), ...vOldRow(),
      el('p', { class: 'muted small vset-note', text: 'Encryption happens in your browser; nothing readable leaves this device.' })); return b;
  }
  if (!open) { b.push(row('Status', el('span', { text: '🔒 Locked' }), el('button', { type: 'button', class: 'primary', text: 'Unlock', onclick: () => vaultAsk(vaultSettings) }))); return b; }
  const al = el('select', { class: 'mini-select', 'aria-label': 'Auto-lock' }, ...[[5, '5 minutes'], [15, '15 minutes'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [0, 'Never (not advised)']].map(([v, t]) => el('option', { value: v, text: t })));
  al.value = String(cfg.autolock); al.onchange = () => { vCfgSet({ autolock: +al.value }); vaultFootUi(); };
  const file = el('input', { type: 'file', accept: '.json,application/json', hidden: true }); file.onchange = () => { if (file.files[0]) vaultRestore(file.files[0]); file.value = ''; };
  const repo = el('input', { type: 'text', class: 'vdlg-in', placeholder: 'your-name/strategist-private', value: sc ? sc.repo : '' }), tok = el('input', { type: 'password', class: 'vdlg-in', placeholder: sc ? 'Token saved (enter a new one to replace it)' : 'Fine-grained access token', autocomplete: 'off' });
  const smsg = el('div', { class: 'small', id: 'vSyncState', text: vSyncLine() });
  b.push(row('Status', el('span', { text: '🔓 Open on this device' }), el('button', { type: 'button', class: 'ghost', text: 'Lock now', onclick: vaultLock })),
    row('Auto-lock after', al),
    row('Passphrase', el('button', { type: 'button', class: 'ghost', text: 'Change passphrase', onclick: vChangeDialog })),
    row('Backup', el('button', { type: 'button', class: 'ghost', text: '⤓ Download encrypted backup', onclick: vaultBackup }), el('button', { type: 'button', class: 'ghost', text: 'Restore from a backup', onclick: () => file.click() }), file),
    row('Sync (laptop + phone)', el('div', { class: 'vset-sync' }, repo, tok, el('div', { class: 'controls' },
      el('button', { type: 'button', class: 'primary', text: sc ? 'Save and sync now' : 'Turn on sync', onclick: async () => {
        const r = repo.value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, ''); if (!/^[\w.-]+\/[\w.-]+$/.test(r)) { smsg.textContent = 'Repository: owner/name, for example your-name/strategist-private.'; return; }
        const t = tok.value.trim() || (sc && sc.token); if (!t) { smsg.textContent = 'Paste the access token.'; return; }
        vSyncSet({ ...(sc || {}), repo: r, token: t, path: 'vault.json', last: sc && sc.repo === r ? sc.last || 0 : 0 }); tok.value = ''; vaultSaveSoon();
        try { await vaultSync(); } catch (e) { vSyncStatus('error', e.message); } fill(); } }),
      sc ? el('button', { type: 'button', class: 'ghost', text: 'Turn off sync', onclick: () => { delete V.items['sd-sync-v1']; V.mtime['sd-sync-v1'] = Date.now(); vaultSaveSoon(); vSyncStatus(''); fill(); } }) : null), smsg,
      el('details', { class: 'vset-help' }, el('summary', { text: 'How to set up sync (about five minutes, once)' }), el('ol', {},
        el('li', { text: 'On github.com, create a new repository, for example “strategist-private”, and choose Private.' }),
        el('li', { text: 'Go to Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token. Repository access: Only select repositories → strategist-private. Permissions: Contents → Read and write. Expiry: one year.' }),
        el('li', { text: 'Copy the token, paste it above with the repository name, and press “Turn on sync”.' }),
        el('li', { text: 'On your phone, open the dashboard → the vault button at the foot of the menu → “Connect this device”, with the same repository, a token (the same or a second one) and your passphrase.' }),
        el('li', { text: 'If a device is lost, delete its token on GitHub. Keep two-step login on for your GitHub account.' }))))), ...vOldRow());
  b.push(el('p', { class: 'muted small vset-note', text: 'What is encrypted: watchlist, model portfolio, signal watch and dismiss, structured notes, anything kept from the old Idea log, house views and Notebook, and the sync token itself. The synced file is encrypted before it leaves this device; GitHub only ever sees ciphertext. It protects against anyone opening the site and anyone with the stored or synced file. It does not protect against malware on the device. Follow your employer’s policy on client information.' }));
  return b;
}
function vaultSettings() {   // Design plan 3, Step 2: the vault and sync settings, in a dialog from the vault button (was Notebook → Vault & sync)
  const body = el('div', { class: 'vset' });
  const box = vDialog('Private vault and sync', [body], [el('button', { type: 'button', class: 'ghost', text: 'Close', onclick: closeVDialog })]);
  box.classList.add('vdlg-wide');
  const fill = () => body.replaceChildren(...vaultSetRows(fill)); fill();
}
// The Idea log, house views and Notebook were removed (Design plan 3, Step 2). What the owner wrote there stays in storage,
// untouched and encrypted with the rest; this row downloads it as a plain JSON file to keep on the owner's own drive.
const VAULT_RETIRED = ['sd-ideas-v1', 'sd-views-v1', 'sd-notebook-v1'];
function vaultOldData() {
  const out = {}; for (const k of VAULT_RETIRED) { const x = pstore().getItem(k); if (x != null) { try { out[k] = JSON.parse(x); } catch (e) { out[k] = x; } } }
  return out;
}
function vaultExportOld() {
  const go = () => {
    const d = vaultOldData(); if (!Object.keys(d).length) { alert('There are no old ideas, house views or notes stored here.'); return; }
    const blob = new Blob([JSON.stringify({ app: 'strategist-dashboard', kind: 'old-ideas-and-notes', exported: new Date().toISOString(),
      ideas: d['sd-ideas-v1'] || [], house_views: d['sd-views-v1'] || null, notebook: d['sd-notebook-v1'] || [] }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); download(url, `old-ideas-and-notes_${iso(Date.now())}.json`); setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  if (vaultOn() && !vaultOpen()) vaultAsk(go); else go();
}
function vOldRow() {   // shown only when something old is stored
  if (!Object.keys(vaultOldData()).length) return [];
  return [el('div', { class: 'vset-row' }, el('div', { class: 'vset-l', text: 'Old ideas and notes' }), el('div', { class: 'vset-r' },
    el('span', { class: 'small', text: 'The Idea log, house views and Notebook were removed; what you wrote there is still stored here, untouched.' }),
    el('button', { type: 'button', class: 'ghost', text: '⤓ Export my old ideas and notes', onclick: vaultExportOld })))];
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

function buildVault() { vaultFootUi(); }
