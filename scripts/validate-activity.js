#!/usr/bin/env node
// Activity calendar: day bucketing, streaks and the twelve-week grid.
const path = require('path');
const A = require(path.join(__dirname, '..', 'activity.js'));
let checks = 0;
const failures = [];
const assert = (ok, message) => { checks++; if (!ok) failures.push(message); };
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const now = at(2026, 11, 5, 15); // a Thursday

const days = A.activityDays({
  moves: [at(2026, 11, 5, 9), at(2026, 11, 5, 10), at(2026, 11, 4), at(2026, 11, 3), at(2025, 1, 1), NaN, null],
  drills: [at(2026, 11, 4, 23)],
  puzzles: [at(2026, 11, 1), at(2026, 10, 30)],
  games: [at(2026, 11, 5, 14)]
}, now);
assert(days.get('2026-11-05').total === 3 && days.get('2026-11-05').games === 1, 'today counts moves and games');
assert(days.get('2026-11-04').drills === 1 && days.get('2026-11-04').moves === 1, 'late-evening drills stay on their own day');
assert(!days.has('2025-01-01'), 'activity older than the calendar is ignored');
const s = A.summarise(days, now);
assert(s.streak === 3, `three consecutive days ending today, got ${s.streak}`);
assert(s.last14 === 5, `five active days in the last fortnight, got ${s.last14}`);
assert(s.totals.moves === 4 && s.totals.puzzles === 2 && s.totals.games === 1, 'twelve-week totals');
// A streak that ended yesterday still counts while today is not over.
const yesterday = A.summarise(A.activityDays({ moves: [at(2026, 11, 4), at(2026, 11, 3)] }, now), now);
assert(yesterday.streak === 2, 'a streak can end yesterday');
const broken = A.summarise(A.activityDays({ moves: [at(2026, 11, 3)] }, now), now);
assert(broken.streak === 0, 'a gap of a full day ends the streak');

const cells = A.grid(now);
assert(cells.length === 84, '12 weeks of 7 days');
assert(new Set(cells.map(c => c.key)).size === 84, 'every day appears once (no daylight-saving gaps)');
const todayCell = cells.find(c => c.key === '2026-11-05');
assert(todayCell && todayCell.week === 11 && todayCell.day === 3 && !todayCell.future, 'today is Thursday in the last column');
assert(cells.filter(c => c.future).length === 3, 'the rest of this week is in the future');
assert(new Date(cells[0].time).getDay() === 1, 'weeks start on Monday');
// Across the spring daylight-saving change in Europe and the US.
const spring = A.grid(at(2026, 4, 2, 12));
assert(new Set(spring.map(c => c.key)).size === 84, 'no duplicate or missing days across daylight saving');
assert([0, 1, 2, 3, 4].every(n => A.level([0, 1, 5, 15, 30][n]) === n), 'intensity levels');

if (failures.length) {
  console.error(`Activity validation failed (${failures.length} of ${checks}):`);
  failures.forEach(f => console.error(' - ' + f));
  process.exit(1);
}
console.log(`Activity validation passed (${checks} checks).`);
