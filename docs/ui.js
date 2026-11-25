// ------------------------------------------------------------------ SHELL: menu groups, pinned pages, phone search (WP67)
// Loaded last. Preferences stay in this browser (they are not private data, so they live outside the vault).
'use strict';

const PIN_KEY = 'sd-pins-v1', NAVFOLD_KEY = 'sd-nav-fold-v1', PIN_MAX = 5;
const uiGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
const uiSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* kept for this visit */ } };

// menu groups fold on a click; a folded group still shows the page that is open
function navGroupsWire() {
  const nav = $('.side .tabs'), folded = new Set(uiGet(NAVFOLD_KEY, []));
  nav.querySelectorAll('.nav-group:not(.pins)').forEach(g => {
    g.setAttribute('role', 'button'); g.tabIndex = 0; g.setAttribute('aria-expanded', String(!folded.has(g.textContent)));
    const toggle = () => { const name = g.textContent; if (folded.has(name)) folded.delete(name); else folded.add(name); uiSet(NAVFOLD_KEY, [...folded]); navGroupsApply(); };
    g.addEventListener('click', toggle); g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });
  navGroupsApply();
}
function navGroupsApply() {
  const folded = new Set(uiGet(NAVFOLD_KEY, []));
  let fold = false;
  for (const n of $('.side .tabs').children) {
    if (n.classList.contains('nav-group')) { fold = !n.classList.contains('pins') && folded.has(n.textContent); n.classList.toggle('folded', fold); n.setAttribute('aria-expanded', String(!fold)); continue; }
    if (n.dataset.pin) continue;
    if (n.dataset.sys) { n.hidden = true; continue; }   // Data health lives in the foot of the menu
    const childHidden = n.dataset.parent && !NAV_OPEN[n.dataset.parent];
    n.hidden = childHidden || (fold && n.dataset.tab !== state.tab && n.dataset.parent !== state.tab && !(n.dataset.tab && document.querySelector(`.tabs button[data-parent="${n.dataset.tab}"][aria-selected="true"]`)));
  }
}

// pinned pages: up to five, at the top of the menu; the pin button sits next to the page title
function pinsRender() {
  const nav = $('.side .tabs'), pins = uiGet(PIN_KEY, []).filter(t => TAB_TITLES[t]);
  nav.querySelectorAll('[data-pin], .nav-group.pins').forEach(x => x.remove());
  if (pins.length) {
    const head = el('div', { class: 'nav-group pins', text: 'Pinned' }); nav.prepend(head);
    let after = head;
    for (const t of pins) {
      const src = nav.querySelector(`button[data-tab="${t}"]:not([data-pin])`);
      const b = el('button', { role: 'tab', type: 'button', 'data-tab': t, 'data-pin': '1', 'aria-selected': String(state.tab === t), text: src ? [...src.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() : TAB_TITLES[t] });
      b.addEventListener('click', () => setTab(t)); after.after(b); after = b;
    }
  }
  const pb = $('#pinBtn'); if (pb) { const on = pins.includes(state.tab); pb.setAttribute('aria-pressed', String(on)); pb.textContent = on ? '★' : '☆'; pb.title = on ? 'Unpin this page from the top of the menu' : `Pin this page to the top of the menu (up to ${PIN_MAX})`; }
}
function pinToggle() {
  let pins = uiGet(PIN_KEY, []);
  if (pins.includes(state.tab)) pins = pins.filter(t => t !== state.tab); else { pins.push(state.tab); if (pins.length > PIN_MAX) pins = pins.slice(-PIN_MAX); }
  uiSet(PIN_KEY, pins); pinsRender();
}

function buildShell() {
  const title = $('.page-head .ph-title');
  if (title && !$('#pinBtn')) title.append(el('button', { id: 'pinBtn', class: 'pin-btn', type: 'button', 'aria-pressed': 'false', text: '☆', onclick: pinToggle }));
  // phone: a search button in the slim top bar (the full search box is in the open menu)
  const head = $('.side-head'), menu = $('#menuBtn');
  if (head && menu && !$('.search-mini')) menu.before(el('button', { class: 'ghost search-mini', type: 'button', 'aria-label': 'Search', title: 'Search (Ctrl K)', text: '⌕', onclick: () => openSearch() }));
  navGroupsWire(); pinsRender();
}
// keep the pins and folded groups in step whenever the page changes
const uiSetTabOrig = setTab;
setTab = function (t) { uiSetTabOrig(t); pinsRender(); navGroupsApply(); };
