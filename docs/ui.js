// ------------------------------------------------------------------ SHELL: menu groups, pinned pages, phone search (WP67)
// Loaded last. Preferences stay in this browser (they are not private data, so they live outside the vault).
'use strict';

const PIN_KEY = 'sd-pins-v1', NAVFOLD_KEY = 'sd-nav-fold-v1', PIN_MAX = 5;
const uiGet = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch (e) { return d; } };
const uiSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* kept for this visit */ } };

// Design plan 3, Step 1: the menu is a tree. Each group is a section (.nav-sec) with a header button (.nav-head: arrow,
// name, page count) and its pages on a rail (.nav-items); a region's countries hang from a second rail (.nav-kids).
// A header folds its section; a folded section still shows the open page on its rail (CSS in style.css).
function navGroupsWire() {
  const nav = $('.side .tabs');
  nav.querySelectorAll('.nav-sec:not(.pins)').forEach(sec => {
    const head = sec.querySelector(':scope > .nav-head'), name = sec.dataset.group;
    const cnt = head.querySelector('.cnt'); if (cnt) cnt.textContent = String(sec.querySelectorAll(':scope > .nav-items > button[data-tab]:not([data-sys])').length);
    head.addEventListener('click', () => {   // a button, so Enter and Space fold it too
      const folded = new Set(uiGet(NAVFOLD_KEY, []));
      if (folded.has(name)) folded.delete(name); else folded.add(name);
      uiSet(NAVFOLD_KEY, [...folded]); navGroupsApply();
    });
  });
  navGroupsApply();
}
function navGroupsApply() {
  const folded = new Set(uiGet(NAVFOLD_KEY, []));
  $('.side .tabs').querySelectorAll('.nav-sec:not(.pins)').forEach(sec => {
    const fold = folded.has(sec.dataset.group);
    sec.classList.toggle('folded', fold);
    const head = sec.querySelector(':scope > .nav-head'); if (head) { head.setAttribute('aria-expanded', String(!fold)); head.title = fold ? 'Show the pages in ' + sec.dataset.group : 'Fold ' + sec.dataset.group; }
  });
  $('.side .tabs').querySelectorAll('[data-sys]').forEach(n => { n.hidden = true; });   // Data health lives in the foot of the menu
}

// pinned pages: up to five, at the top of the menu; the pin button sits next to the page title
function pinsRender() {
  const nav = $('.side .tabs'), pins = uiGet(PIN_KEY, []).filter(t => TAB_TITLES[t]);
  nav.querySelectorAll('.nav-sec.pins').forEach(x => x.remove());
  if (pins.length) {   // the first section, styled like the others, never folded
    const items = el('div', { class: 'nav-items' });
    for (const t of pins) {
      const src = nav.querySelector(`button[data-tab="${t}"]:not([data-pin])`);
      const b = el('button', { role: 'tab', type: 'button', 'data-tab': t, 'data-pin': '1', 'aria-selected': String(state.tab === t), text: src ? [...src.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() : TAB_TITLES[t] });
      b.addEventListener('click', () => setTab(t)); items.append(b);
    }
    nav.prepend(el('div', { class: 'nav-sec pins', 'data-group': 'Pinned' },
      el('div', { class: 'nav-head' }, el('span', { class: 'chev', 'aria-hidden': 'true', text: '★' }), el('span', { class: 'nm', text: 'Pinned' }), el('span', { class: 'cnt', text: String(pins.length) })), items));
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
