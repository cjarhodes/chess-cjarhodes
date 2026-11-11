// Keyboard shortcut sheet: press ? anywhere (outside a text field) to see the
// shortcuts for the current view. Esc or the close button returns focus.
// "," opens (and closes) Settings (src/ui/settings.js) the same way.
(function() {
  'use strict';
  const SHEETS = {
    library: {
      title: 'Library',
      rows: [['← →', 'Previous / next move'], ['F', 'Flip the board'], ['R', 'Back to the start'], ['/', 'Search openings'], ['1 2 3', 'Study, Quiz, Explore']]
    },
    coach: {
      title: 'Coach',
      rows: [['← →', 'Step back / forward through the game'], ['Home End', 'First move / live position'], ['F', 'Flip the board']]
    },
    puzzles: {
      title: 'Puzzles',
      rows: [['H', 'Hint (counts as a miss)'], ['S', 'Show the solution'], ['R', 'Retry the puzzle, unrated'], ['N', 'Next puzzle'], ['F', 'Flip the board']]
    }
  };
  const GLOBAL = [['?', 'Show this list'], [',', 'Open Settings'], ['Esc', 'Close a dialog or leave a text field']];
  let dialog = null;
  let returnFocus = null;

  function currentView() {
    return typeof appView === 'string' && SHEETS[appView] ? appView : 'coach';
  }

  function rowsTable(rows) {
    const table = document.createElement('dl');
    table.className = 'shortcut-list';
    rows.forEach(([keys, label]) => {
      const dt = document.createElement('dt');
      keys.split(' ').forEach(key => {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        dt.appendChild(kbd);
      });
      const dd = document.createElement('dd');
      dd.textContent = label;
      table.append(dt, dd);
    });
    return table;
  }

  function build() {
    dialog = document.createElement('div');
    dialog.className = 'shortcut-overlay';
    dialog.id = 'shortcut-sheet';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'shortcut-sheet-title');
    dialog.hidden = true;
    dialog.innerHTML = '<div class="shortcut-card"><div class="shortcut-head"><h2 id="shortcut-sheet-title">Keyboard shortcuts</h2>' +
      '<button type="button" class="ctrl-btn" id="btn-shortcut-close" aria-label="Close keyboard shortcuts">✕</button></div><div class="shortcut-body"></div></div>';
    document.body.appendChild(dialog);
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    dialog.querySelector('#btn-shortcut-close').addEventListener('click', close);
    dialog.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      if (e.key === 'Tab') { e.preventDefault(); dialog.querySelector('#btn-shortcut-close').focus(); }
    });
  }

  function open() {
    if (!dialog) build();
    const view = currentView();
    const body = dialog.querySelector('.shortcut-body');
    body.textContent = '';
    const h = document.createElement('h3');
    h.textContent = SHEETS[view].title;
    body.append(h, rowsTable(SHEETS[view].rows));
    const g = document.createElement('h3');
    g.textContent = 'Everywhere';
    body.append(g, rowsTable(GLOBAL));
    returnFocus = document.activeElement;
    dialog.hidden = false;
    dialog.querySelector('#btn-shortcut-close').focus();
  }

  function close() {
    if (!dialog || dialog.hidden) return;
    dialog.hidden = true;
    if (returnFocus && typeof returnFocus.focus === 'function' && returnFocus.isConnected) returnFocus.focus();
    returnFocus = null;
  }

  const visible = id => { const el = document.getElementById(id); return el && el.offsetParent !== null; };
  function blocked() {
    return visible('summary-overlay') || visible('promotion-picker');
  }
  const settingsOpen = () => !!(window.SettingsSheet && window.SettingsSheet.isOpen());

  // Capture phase so the view handlers never see the ? or the comma.
  document.addEventListener('keydown', e => {
    if ((e.key !== '?' && e.key !== ',') || e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
    if (blocked()) return;
    if (e.key === ',') {
      // Not over another dialog (this sheet or the game viewer).
      if (!window.SettingsSheet || (dialog && !dialog.hidden) || visible('game-viewer')) return;
      e.preventDefault();
      e.stopPropagation();
      window.SettingsSheet.toggle();
      return;
    }
    if (settingsOpen()) return;
    e.preventDefault();
    e.stopPropagation();
    if (dialog && !dialog.hidden) close(); else open();
  }, true);

  function bindButton() {
    const button = document.getElementById('btn-shortcuts');
    if (button) button.addEventListener('click', () => { if (dialog && !dialog.hidden) close(); else open(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindButton);
  else bindButton();

  window.ShortcutSheet = { open, close, SHEETS };
})();
