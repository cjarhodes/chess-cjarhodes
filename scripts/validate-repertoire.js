#!/usr/bin/env node
// Repertoire trainer: every Library line becomes a legal drill from the side
// that owns it, moves are graded (sibling-line moves are not mistakes), and
// spaced repetition schedules to local midnights in several time zones.
const fs = require('fs'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');
const { Chess } = require('../vendor/chess.js/chess-0.10.3.min.js');
const root = path.resolve(__dirname, '..');
const R = require(path.join(root, 'repertoire-core.js'));
const context = { Chess, console };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'openings.js'), 'utf8') + '\nthis.OPENINGS = OPENINGS;\n' +
  fs.readFileSync(path.join(root, 'opponents.js'), 'utf8').replace(/typeof window !== 'undefined' \? window : globalThis/, 'this'), context);
const OPENINGS = context.OPENINGS;
const sideOf = context.OpponentPersonas.lineSide;
let checks = 0;
const failures = [];
const assert = (ok, message) => { checks++; if (!ok) failures.push(message); };

// ── Every line of every opening is drillable ──
const all = R.cardsFor(OPENINGS, OPENINGS.map(o => o.id), sideOf);
assert(all.length >= OPENINGS.length, 'every opening contributes at least its main line');
assert(new Set(all.map(c => c.id)).size === all.length, 'line ids are unique');
all.forEach(card => {
  const p = R.plies(Chess, card);
  assert(p !== null, `${card.id} replays legally`);
  if (!p) return;
  assert(p.length && p[p.length - 1].mine, `${card.id} ends on the user's move`);
  assert(p.filter(x => x.mine).length >= 1, `${card.id} has a move to drill`);
  assert(p.every((x, i) => x.mine === ((i % 2 === 0) === (card.side === 'w'))), `${card.id} alternates sides from the start`);
});

const italian = R.cardsFor(OPENINGS, ['italian'], sideOf);
const italianIds = italian.map(c => c.id);
assert(italian[0].id === 'italian' && italian[0].side === 'w', 'the Italian is drilled as White');
assert(italianIds.includes('evans-gambit') && italianIds.includes('fried-liver'), 'White sidelines of the Italian are included');
assert(!italianIds.includes('blackburne-shilling'), 'a Black trap inside a White opening is not drilled from White\'s side');
const sicilian = R.cardsFor(OPENINGS, ['sicilian'], sideOf);
assert(sicilian.length && sicilian.every(c => c.side === 'b'), 'the Sicilian is drilled as Black');
assert(R.plies(Chess, sicilian[0])[0].mine === false, 'a Black line starts with White\'s move played for you');
assert(R.cardsFor(OPENINGS, ['italian', 'italian', 'nope'], sideOf).length === italian.length, 'duplicate and unknown ids are ignored');

// ── Grading ──
const index = R.moveIndex(Chess, italian.concat(sicilian));
const main = italian[0];
const mainPlies = R.plies(Chess, main);
assert(R.grade(index, main, mainPlies[0], mainPlies[0].uci) === 'ok', 'the line\'s move is correct');
assert(R.grade(index, main, mainPlies[0], 'a2a3') === 'wrong', 'another move is a mistake');
// Two of the user's lines that part on the user's own move: playing the
// other line's move is named, not counted as a mistake.
const lineA = { id: 'a', name: 'Line A', side: 'w', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] };
const lineB = { id: 'b', name: 'Line B', side: 'w', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] };
const siblingIndex = R.moveIndex(Chess, [lineA, lineB]);
const aPlies = R.plies(Chess, lineA);
const g = R.grade(siblingIndex, lineA, aPlies[4], 'f1b5');
assert(g && g.other === 'Line B', `a sibling line's move is named, not marked wrong (got ${JSON.stringify(g)})`);
assert(R.grade(siblingIndex, lineA, aPlies[4], 'f1c4') === 'ok' && R.grade(siblingIndex, lineA, aPlies[4], 'f1e2') === 'wrong', 'the line\'s own move is right and a move from no line is wrong');
assert(R.grade(index, sicilian[0], R.plies(Chess, sicilian[0])[1], mainPlies[0].uci) === 'wrong', 'a White repertoire move is not accepted for Black');

// ── Scheduling ──
const t0 = new Date(2026, 10, 6, 21, 30).getTime(); // 6 Nov 2026, 21:30 local
let s = R.emptyState();
assert(R.queue(all, s, t0).length === R.NEW_PER_DAY, 'a first session offers the day\'s new lines');
s = R.review(s, 'italian', true, t0);
let r = s.records.italian;
assert(r.reps === 1 && r.interval === 1 && r.dueAt === new Date(2026, 10, 7).getTime(), 'a clean first review is due at the next local midnight');
assert(R.stats(all, s, t0).due === 0 && R.stats(all, s, t0).learned === 1, 'a reviewed line is learned and not due');
assert(R.queue(all, s, t0).length === R.NEW_PER_DAY - 1, 'one of the day\'s new lines is used');
s = R.review(s, 'italian', true, r.dueAt + 1000);
assert(s.records.italian.interval === 3, 'the second clean review waits three days');
s = R.review(s, 'italian', true, s.records.italian.dueAt + 1000);
// Ease 2.5 grows 0.05 per clean review: 2.6 before the third, so 3 × 2.6 ≈ 8 days.
assert(s.records.italian.interval === 8, `later intervals grow by the ease factor (got ${s.records.italian.interval})`);
const before = s.records.italian;
s = R.review(s, 'italian', false, t0 + 9 * 86400000);
r = s.records.italian;
assert(r.reps === 0 && r.interval === 0 && r.lapses === 1 && r.ease < before.ease && r.dueAt === t0 + 9 * 86400000 + R.RELEARN_MS, 'a lapse resets the line and brings it back in ten minutes');
assert(R.queue(all, s, t0 + 9 * 86400000 + R.RELEARN_MS)[0].id === 'italian', 'a due line comes before new lines');
let many = R.emptyState();
for (let i = 0; i < R.NEW_PER_DAY; i++) many = R.review(many, all[i].id, true, t0);
assert(R.newLeft(many, t0) === 0 && R.queue(all, many, t0 + 3600000).length === 0, 'no more new lines today after the daily allowance');
assert(R.newLeft(many, new Date(2026, 10, 7, 8).getTime()) === R.NEW_PER_DAY, 'the allowance resets the next day');
assert(R.queue(all, many, new Date(2026, 10, 7, 8).getTime(), 3).length === 3, 'a session respects its limit');

// ── State hygiene ──
assert(JSON.stringify(R.normalizeState({ v: 2 })) === JSON.stringify(R.emptyState()), 'an unknown version starts fresh');
const junk = R.normalizeState({ v: 1, records: { a: { reps: 'x', ease: 99, dueAt: -5 }, b: null } });
assert(junk.records.a.ease === 3 && junk.records.a.reps === 0 && junk.records.a.dueAt === 0 && !junk.records.b, 'bad record fields are clamped or dropped');
const older = R.review(R.emptyState(), 'x', true, 1000);
const newer = R.review(R.emptyState(), 'x', false, 2000);
assert(R.mergeStates(older, newer).records.x.lapses === 1 && R.mergeStates(newer, older).records.x.lapses === 1, 'merging keeps the most recently reviewed record');

// ── Due dates land on local midnight in every time zone, across DST ──
const zones = ['America/New_York', 'Europe/London', 'Australia/Sydney', 'Asia/Kolkata', 'Pacific/Auckland', 'UTC'];
const probe = `
const R = require(${JSON.stringify(path.join(root, 'repertoire-core.js'))});
const out = [];
// Just before the spring and autumn changes in both hemispheres.
[[2026, 2, 7, 23], [2026, 9, 24, 23], [2026, 3, 4, 23], [2026, 8, 26, 23]].forEach(([y, m, d, h]) => {
  const now = new Date(y, m, d, h, 30).getTime();
  [1, 3, 20].forEach(n => { const due = new Date(R.addDays(now, n)); const want = new Date(y, m, d + n); out.push(due.getHours() === 0 && due.getMinutes() === 0 && due.getDate() === want.getDate() && due.getMonth() === want.getMonth()); });
});
console.log(JSON.stringify(out.every(Boolean)));`;
zones.forEach(tz => {
  const ok = execFileSync(process.execPath, ['-e', probe], { env: Object.assign({}, process.env, { TZ: tz }) }).toString().trim();
  assert(ok === 'true', `due dates are local midnights across DST in ${tz}`);
});

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`Repertoire validation passed (${checks} checks).`);
