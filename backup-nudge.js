// Backup reminder for progress kept only on this device (redesign plan §3,
// risk 2 "Local-only data on iPhone"). Safari can clear script-written
// storage after a week without a visit, so:
//   - the Training data card says when this browser last exported a backup
//     (every screen size);
//   - in the stacked (phone) layout, a signed-out user with some progress
//     sees a small banner offering sign-in (sync) or a backup file.
// The banner is not a dialog and never takes focus on its own. It is
// decided when the page loads (once the account check has finished) and
// when the layout changes, never in the middle of a game.
// shouldShow(), progressCount() and backupLabel() are pure so
// scripts/validate-backup-nudge.js can run them in Node.
(function(root) {
  'use strict';
  const DAY = 86400000;
  const BACKUP_FRESH_DAYS = 7;
  const DISMISS_DAYS = 14;
  const PROGRESS_MIN = 3;
  const BACKUP_AT_KEY = 'coach:last-backup:v1';
  const DISMISSED_KEY = 'ui:backup-nudge-dismissed-at';

  // A usable timestamp: a number, not more than a day in the future (a clock
  // set back must not hide the reminder for good).
  function validTime(time, now) {
    return Number.isFinite(time) && time > 0 && time <= now + DAY;
  }

  // progress: { games, drills, puzzles, reviews } counts.
  function progressCount(progress) {
    if (!progress) return 0;
    return ['games', 'drills', 'puzzles', 'reviews'].reduce((sum, key) => {
      const n = Number(progress[key]);
      return sum + (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0);
    }, 0);
  }

  function shouldShow(s) {
    if (!s || !s.stacked || !s.authSettled || s.signedIn) return false;
    if (progressCount(s.progress) < PROGRESS_MIN) return false;
    if (validTime(s.lastBackupAt, s.now) && s.now - s.lastBackupAt < BACKUP_FRESH_DAYS * DAY) return false;
    if (validTime(s.dismissedAt, s.now) && s.now - s.dismissedAt < DISMISS_DAYS * DAY) return false;
    return true;
  }

  function sameDay(a, b) {
    const x = new Date(a), y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
  }

  function backupLabel(at, now, formatDate) {
    if (!validTime(at, now)) return 'Not backed up yet';
    if (sameDay(at, now)) return 'Last backed up: today';
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (sameDay(at, yesterday.getTime())) return 'Last backed up: yesterday';
    const format = formatDate || (t => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }));
    return 'Last backed up: ' + format(at);
  }

  const api = { shouldShow, progressCount, backupLabel, BACKUP_FRESH_DAYS, DISMISS_DAYS, PROGRESS_MIN, BACKUP_AT_KEY, DISMISSED_KEY };
  root.BackupNudge = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document === 'undefined') return;

  // ── Browser ──────────────────────────────────
  function owner() {
    return typeof growthOwnerId === 'function' ? growthOwnerId() : null;
  }
  function backupKey() {
    const id = owner();
    return id ? `${BACKUP_AT_KEY}:${id}` : BACKUP_AT_KEY;
  }
  function readTime(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? null : Number(raw);
    } catch (e) { return null; }
  }
  function writeTime(key, time) {
    try { localStorage.setItem(key, String(time)); return true; } catch (e) { return false; }
  }

  function lastBackupAt() { return readTime(backupKey()); }

  function signedIn() {
    return typeof coachAuthUser !== 'undefined' && !!coachAuthUser;
  }
  function syncAvailable() {
    return typeof isSupabaseConfigured === 'function' && isSupabaseConfigured();
  }
  // The first account check has finished and did not fail. A failed check
  // (offline, for example) cannot tell a signed-in user from a guest.
  let authSettled = false;
  function authKnown() {
    if (!authSettled) return false;
    if (!syncAvailable()) return true;
    return typeof coachAuthPhase === 'undefined' || coachAuthPhase !== 'error';
  }

  function progress() {
    const counts = { games: 0, drills: 0, puzzles: 0, reviews: 0 };
    try { if (typeof loadLifetime === 'function') counts.games = loadLifetime().games || 0; } catch (e) { /* none */ }
    try { if (typeof loadPracticeProgress === 'function') counts.drills = loadPracticeProgress().events.length; } catch (e) { /* none */ }
    try { if (root.PuzzlesView && root.PuzzlesView.history) counts.puzzles = root.PuzzlesView.history().length; } catch (e) { /* none */ }
    try {
      if (typeof loadSR === 'function') {
        const records = loadSR() || {};
        counts.reviews = Object.keys(records).filter(id => records[id] && records[id].lastReviewed).length;
      }
    } catch (e) { /* none */ }
    return counts;
  }

  function stacked() {
    return typeof layoutIsStacked === 'function' && layoutIsStacked();
  }

  function renderLastBackup() {
    const line = document.getElementById('training-data-last-backup');
    if (line) line.textContent = backupLabel(lastBackupAt(), Date.now());
    const meta = document.getElementById('backup-nudge-last');
    if (meta) meta.textContent = backupLabel(lastBackupAt(), Date.now());
  }

  function nudge() { return document.getElementById('backup-nudge'); }

  function setStatus(text) {
    const status = document.getElementById('backup-nudge-status');
    if (status) status.textContent = text || '';
  }

  // Hide the banner; if focus was inside it, hand focus to the current view
  // tab rather than leaving it on the page body.
  function hide() {
    const el = nudge();
    if (!el || el.hidden) return;
    const hadFocus = el.contains(document.activeElement);
    el.hidden = true;
    document.documentElement.classList.remove('backup-nudge-shown');
    if (hadFocus) {
      const tab = document.querySelector('.top-nav-btn.active');
      if (tab) tab.focus({ preventScroll: true });
    }
  }

  function show() {
    const el = nudge();
    if (!el || !el.hidden) return;
    const sync = syncAvailable();
    document.getElementById('backup-nudge-text').textContent = sync
      ? 'Safari can clear it after a week without a visit. Sign in to sync it, or save a backup file.'
      : 'Safari can clear it after a week without a visit. Save a backup file to keep it.';
    document.getElementById('btn-backup-nudge-signin').hidden = !sync;
    document.getElementById('btn-backup-nudge-backup').hidden = false;
    document.getElementById('btn-backup-nudge-dismiss').textContent = 'Hide for 2 weeks';
    setStatus('');
    renderLastBackup();
    el.hidden = false;
    document.documentElement.classList.add('backup-nudge-shown');
  }

  // mayShow: false only hides (sign-in, backup); true may also show.
  function refresh(mayShow) {
    const now = Date.now();
    const visible = shouldShow({
      stacked: stacked(),
      authSettled: authKnown(),
      signedIn: signedIn(),
      progress: progress(),
      lastBackupAt: lastBackupAt(),
      dismissedAt: readTime(DISMISSED_KEY),
      now
    });
    const el = nudge();
    if (!visible) hide();
    else if (mayShow && el && el.hidden) show();
    renderLastBackup();
  }

  // Called by growth.js after a backup file was downloaded.
  function recordBackup(now = Date.now()) {
    writeTime(backupKey(), now);
    renderLastBackup();
  }

  // Settings → Account, with the email field ready. Settings opens over
  // whatever is on screen, so a game or drill in progress is left alone.
  function signIn() {
    const sheet = root.SettingsSheet;
    if (!sheet || !sheet.open('account', { focus: 'coach-auth-email', returnFocus: document.getElementById('btn-backup-nudge-signin') })) {
      setStatus('Open Settings → Account to sign in.');
      return;
    }
    const input = document.getElementById('coach-auth-email');
    if (!input || !input.getClientRects().length) setStatus('Sign-in is not available right now. Open Settings → Account to try again.');
  }

  function backUp() {
    if (typeof exportTrainingBackupNow !== 'function') return;
    const result = exportTrainingBackupNow();
    if (result && result.ok) {
      document.getElementById('btn-backup-nudge-backup').hidden = true;
      setStatus('Backup downloaded. Import backup in Settings → Training data brings it back.');
      const close = document.getElementById('btn-backup-nudge-dismiss');
      close.textContent = 'Close';
      close.focus();
    } else {
      setStatus((result && result.message) || 'Backup could not be created in this browser.');
    }
  }

  function dismiss() {
    writeTime(DISMISSED_KEY, Date.now());
    hide();
  }

  function init() {
    renderLastBackup();
    const el = nudge();
    if (el) {
      document.getElementById('btn-backup-nudge-signin').addEventListener('click', signIn);
      document.getElementById('btn-backup-nudge-backup').addEventListener('click', backUp);
      // Closing after a backup is not a dismissal: the next stale backup
      // brings the reminder back without waiting two weeks.
      document.getElementById('btn-backup-nudge-dismiss').addEventListener('click', () => {
        if (document.getElementById('btn-backup-nudge-backup').hidden) hide();
        else dismiss();
      });
    }
    const settle = () => { authSettled = true; refresh(true); };
    if (typeof coachSync !== 'undefined' && coachSync && typeof coachSync.init === 'function') {
      Promise.resolve(coachSync.init()).then(settle, settle);
    } else settle();
    if (root.matchMedia && typeof LAYOUT_STACKED_QUERY !== 'undefined') {
      const query = root.matchMedia(LAYOUT_STACKED_QUERY);
      const onChange = () => refresh(true);
      if (query.addEventListener) query.addEventListener('change', onChange);
      else if (query.addListener) query.addListener(onChange);
    }
  }

  Object.assign(api, { refresh, recordBackup, lastBackupAt, progress });
  // jQuery runs ready handlers in the order they were added, so this runs
  // after app.js has started the account check.
  if (root.jQuery) root.jQuery(init);
  else if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(typeof window !== 'undefined' ? window : globalThis);
