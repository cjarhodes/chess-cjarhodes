#!/usr/bin/env node
// Backup reminder: who sees it, for how long a dismissal or a backup keeps it
// away, and how the last backup is described.
const path = require('path');
const N = require(path.join(__dirname, '..', 'backup-nudge.js'));
let checks = 0;
const failures = [];
const assert = (ok, message) => { checks++; if (!ok) failures.push(message); };
const DAY = 86400000;
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const now = at(2026, 11, 8, 15);
const base = { stacked: true, authSettled: true, signedIn: false, progress: { games: 2, puzzles: 1 }, lastBackupAt: null, dismissedAt: null, now };
const show = over => N.shouldShow(Object.assign({}, base, over));

assert(show({}), 'a signed-out phone user with progress and no backup sees it');
assert(!show({ stacked: false }), 'never outside the stacked layout');
assert(!show({ signedIn: true }), 'never for a signed-in user');
assert(!show({ authSettled: false }), 'not before the account check has finished');
assert(!show({ progress: {} }), 'not without progress');
assert(!show({ progress: null }), 'not when progress cannot be read');
assert(!show({ progress: { games: 1, drills: 1 } }), `below ${N.PROGRESS_MIN} items of progress`);
assert(show({ progress: { reviews: 3 } }), 'Library reviews count as progress');
assert(show({ progress: { drills: 2, puzzles: 1 } }), 'drills and puzzles add up');
assert(!show({ progress: { games: -5, drills: NaN, puzzles: '2' } }), 'bad counts are ignored');
assert(N.progressCount({ games: 1.9, drills: 2, puzzles: -1, reviews: 'x' }) === 3, 'counts are whole and non-negative');

// A backup keeps it away for a week.
assert(!show({ lastBackupAt: now - 2 * DAY }), 'hidden after a recent backup');
assert(!show({ lastBackupAt: now - (N.BACKUP_FRESH_DAYS * DAY - 1000) }), 'hidden until the backup is a week old');
assert(show({ lastBackupAt: now - N.BACKUP_FRESH_DAYS * DAY }), 'back once the backup is a week old');
assert(show({ lastBackupAt: now + 30 * DAY }), 'a backup time far in the future does not hide it for good');

// A dismissal lasts two weeks.
assert(!show({ dismissedAt: now - DAY }), 'hidden after a dismissal');
assert(!show({ dismissedAt: now - (N.DISMISS_DAYS * DAY - 1000) }), 'hidden until the dismissal is two weeks old');
assert(show({ dismissedAt: now - N.DISMISS_DAYS * DAY }), 'back two weeks after a dismissal');
assert(!show({ dismissedAt: now - 20 * DAY, lastBackupAt: now - DAY }), 'an expired dismissal still respects a recent backup');
assert(show({ dismissedAt: now + 30 * DAY }), 'a dismissal time far in the future does not hide it for good');
assert(!N.shouldShow(null), 'no state, no reminder');

// Labels.
const fmt = t => new Date(t).toISOString().slice(0, 10);
assert(N.backupLabel(null, now, fmt) === 'Not backed up yet', 'never backed up');
assert(N.backupLabel(NaN, now, fmt) === 'Not backed up yet', 'unreadable time');
assert(N.backupLabel(at(2026, 11, 8, 1), now, fmt) === 'Last backed up: today', 'earlier today');
assert(N.backupLabel(at(2026, 11, 7, 23), now, fmt) === 'Last backed up: yesterday', 'late yesterday');
const older = at(2026, 11, 1, 12);
assert(N.backupLabel(older, now, fmt) === 'Last backed up: ' + fmt(older), 'older backups show the date');
assert(/^Last backed up: \S/.test(N.backupLabel(older, now)), 'the default formatter gives a date');

if (failures.length) {
  console.error(`Backup reminder validation failed (${failures.length} of ${checks}):`);
  failures.forEach(f => console.error(' - ' + f));
  process.exit(1);
}
console.log(`Backup reminder validation passed (${checks} checks).`);
