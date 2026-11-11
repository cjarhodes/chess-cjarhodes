// Settings sheet (redesign Phase 6, docs/redesign-plan.md §3 and §6 "Settings
// sits behind a gear"). One modal dialog, opened from the app-bar gear, the
// "," shortcut (shortcuts.js), any [data-settings-open] control, or a
// ?settings=<section> link. It holds the controls that used to sit in Coach's
// left rail, moved there in index.html with their ids, so app.js, growth.js,
// coach-overlay.js and backup-nudge.js bind them exactly as before:
//   appearance  colour theme, board colours, move sounds, board feedback
//   account     sign-in and sync (#coach-auth-card)
//   data        backup export / import and "Last backed up" (#training-data-card)
// A centred card from 760px; a bottom sheet in the stacked (phone) layout.
// Opening adds a history entry (src/ui/router.js), so Back closes it.
(function() {
  'use strict';
  const SECTIONS = ['appearance', 'account', 'data'];
  let dialog = null;
  let section = null;      // open section, or null when closed
  let returnFocus = null;

  function el(id) { return document.getElementById(id); }
  function sheet() { return dialog || (dialog = el('settings-sheet')); }
  function isOpen() { return section !== null; }

  function focusable(container) {
    return [...container.querySelectorAll('button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(node => !node.hidden && node.getClientRects().length > 0);
  }

  function tabs() { return [...sheet().querySelectorAll('.settings-tab')]; }

  function showSection(name, opts) {
    const options = opts || {};
    const next = SECTIONS.includes(name) ? name : SECTIONS[0];
    tabs().forEach(tab => {
      const active = tab.dataset.section === next;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.tabIndex = active ? 0 : -1;
    });
    sheet().querySelectorAll('.settings-section').forEach(panel => { panel.hidden = panel.id !== 'settings-' + next; });
    const changed = section !== next;
    section = next;
    if (options.focusTab) {
      const tab = tabs().find(t => t.dataset.section === next);
      if (tab) tab.focus();
    }
    const body = sheet().querySelector('.settings-body');
    if (body && changed) body.scrollTop = 0;
    if (changed && !options.quiet) syncUrl();
  }

  function syncUrl() {
    if (typeof updateURL === 'function') updateURL();
  }

  // open('account', { focus: 'coach-auth-email' }) opens at a section and
  // moves focus to that control; otherwise the section's tab takes focus.
  function open(name, opts) {
    const options = opts || {};
    const d = sheet();
    if (!d) return false;
    const opening = !isOpen();
    if (opening) {
      const active = document.activeElement;
      returnFocus = options.returnFocus || (active && active !== document.body && !d.contains(active) ? active : el('btn-settings'));
      section = null;
      showSection(name, { quiet: true });
      if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
      document.documentElement.classList.add('settings-open');
      el('btn-settings')?.setAttribute('aria-expanded', 'true');
      if (!options.fromHistory) syncUrl();
    } else {
      showSection(name, { quiet: !!options.fromHistory });
    }
    const target = options.focus ? el(options.focus) : null;
    if (target && target.getClientRects().length) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'nearest' });
    } else if (opening || !d.contains(document.activeElement) || document.activeElement === d) {
      const tab = tabs().find(t => t.dataset.section === section);
      if (tab) tab.focus();
    }
    return true;
  }

  // Close and hand focus back. When the open Settings is its own history
  // entry, closing goes Back to the entry underneath; Back itself (and the
  // router) close with fromHistory, which touches no history. stay: true
  // rewrites the entry instead of going Back, for a control in the sheet
  // that is about to navigate (Continue saved session).
  function close(opts) {
    const options = opts || {};
    const d = sheet();
    if (!d || !isOpen()) return false;
    section = null;
    if (d.open && typeof d.close === 'function') d.close(); else d.removeAttribute('open');
    document.documentElement.classList.remove('settings-open');
    el('btn-settings')?.setAttribute('aria-expanded', 'false');
    const back = returnFocus;
    returnFocus = null;
    if (back && back.isConnected && back.getClientRects().length) back.focus({ preventScroll: true });
    else { const tab = document.querySelector('.top-nav-btn.active'); if (tab) tab.focus({ preventScroll: true }); }
    if (!options.fromHistory) {
      if (!options.stay && typeof Router !== 'undefined' && Router.settingsEntryIsCurrent()) Router.back();
      else syncUrl();
    }
    return true;
  }

  function toggle(name) {
    if (isOpen()) close(); else open(name || 'appearance');
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') {
      const items = focusable(sheet());
      if (items.length) {
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !sheet().contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    // The section tabs: arrow keys, Home and End.
    const tab = e.target.closest && e.target.closest('.settings-tab');
    if (tab && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
      e.preventDefault();
      const list = tabs();
      const at = list.indexOf(tab);
      let next = at;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = list.length - 1;
      else next = (at + (e.key === 'ArrowRight' ? 1 : list.length - 1)) % list.length;
      showSection(list[next].dataset.section, { focusTab: true });
    }
    // The views' own shortcuts (arrows, F, H …) must not act on the board
    // underneath while Settings is open.
    e.stopPropagation();
  }

  function bind() {
    const d = sheet();
    if (!d || d.dataset.bound) return;
    d.dataset.bound = '1';
    d.addEventListener('keydown', onKeydown);
    // Escape on a native dialog fires cancel; close through close() so focus
    // and history are handled the same way.
    d.addEventListener('cancel', e => { e.preventDefault(); close(); });
    // A press on the backdrop lands on the dialog, outside its box.
    d.addEventListener('click', e => {
      if (e.target !== d) return;
      const r = d.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) close();
    });
    el('btn-settings-close')?.addEventListener('click', () => close());
    tabs().forEach(tab => tab.addEventListener('click', () => showSection(tab.dataset.section)));
    el('btn-settings')?.addEventListener('click', () => toggle('appearance'));
    // Entry points elsewhere: <button data-settings-open="account">.
    document.addEventListener('click', e => {
      const trigger = e.target instanceof Element ? e.target.closest('[data-settings-open]') : null;
      if (!trigger || d.contains(trigger)) return;
      e.preventDefault();
      open(trigger.getAttribute('data-settings-open'), { returnFocus: trigger });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  window.SettingsSheet = { open, close, toggle, isOpen, section: () => section, SECTIONS };
})();
