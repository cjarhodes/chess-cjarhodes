#!/usr/bin/env node

// Behavioural checks for the training data that crosses devices and files:
// the growth-state merge used by sign-in adoption, account sync and backup
// import; imported-game evidence (move numbers, opening attribution, the
// Insights share); and the guest-to-account lifetime merge. Runs the real
// growth.js and app functions with storage stubbed; no browser or engine.

const fs = require('fs');
const { domStub } = require('./lib/dom-stub');
const path = require('path');
const vm = require('vm');
const { Chess } = require('../vendor/chess.js/chess-0.10.3.min.js');
const root = path.resolve(__dirname, '..');
const app = require('./lib/app-source').appSource();
const openings = fs.readFileSync(path.join(root, 'openings.js'), 'utf8');
const growth = fs.readFileSync(path.join(root, 'growth.js'), 'utf8');
const failures = [];
let checks = 0;
const assert = (ok, message) => { checks++; if (!ok) failures.push(message); };
const extract = name => {
  const start = app.indexOf(`\nfunction ${name}(`) + 1;
  if (!start) throw Error('Missing runtime function: ' + name);
  return app.slice(start, app.indexOf('\n}', start) + 2);
};
const extractConst = name => {
  const start = app.indexOf(`\nconst ${name} =`) + 1;
  if (!start) throw Error('Missing runtime constant: ' + name);
  return app.slice(start, app.indexOf(';', start) + 1);
};

const store = new Map();
let owner = null;
let written = null;
const context = {
  Chess, console, window: {}, ...domStub(),
  localStorage: { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
  uciFromMove: move => move.from + move.to + (move.promotion || ''),
  isInsightProblem: tier => ['inaccuracy', 'mistake', 'blunder'].includes(tier),
  activePracticeOwnerId: () => owner,
  coachMemoryKey: key => `${key}:${owner || 'anon:test'}`,
  INSIGHTS_KEY: 'coach:insights:v1', INSIGHTS_MAX_ENTRIES: 300, LIFETIME_KEY: 'coach:lifetime:v1',
  PRACTICE_PROGRESS_KEY: 'coach:practice:v2', DAILY_SPRINT_KEY: 'coach:daily:v1', PRACTICE_EVENT_LIMIT: 2000,
  practiceProgressStorageKey: id => `coach:practice:v2:${id || 'anon'}`,
  dailySprintStorageKey: id => `coach:daily:v1:${id || 'anon'}`,
  loadPracticeProgress: () => ({ v: 2, records: {}, events: context.testEvents }),
  testEvents: [],
  writeContinuityValues: values => { written = values; },
  hydrateGrowthUI: () => {}, queueGrowthRemoteSync: () => {}, renderPersonalRepertoire: () => {}, renderOpeningBridgeTrack: () => {},
  insightEntryFromReview: review => ({ ply: review.ply, tier: review.tier }), insightTagForEntry: () => 'tag', practiceItemId: entry => `item-${entry.ply}`
};
vm.createContext(context);
vm.runInContext([
  extractConst('INSIGHTS_IMPORT_SHARE'),
  ...['emptyInsights', 'loadInsights', 'isImportedInsightEntry', 'capInsightEntries', 'saveInsights',
    'emptyLifetime', 'applyLifetimeContribution'].map(extract)
].join('\n'), context);
vm.runInContext(`${openings}\n${growth}\nrenderPersonalRepertoire = () => {}; renderOpeningBridgeTrack = () => {}; hydrateGrowthUI = () => {};`, context);
const run = code => vm.runInContext(code, context);

// ── Profiles: a guest set-up on a new device keeps the account's calibration ──
const rated = (gameId, at, before, after) => ({ gameId, at, opponent: 1200, score: 1, before, after, accuracy: 70, moves: 20 });
const account = run('emptyGrowthState()');
Object.assign(account.profile, {
  rating: 1300, ratingEstimate: 1460, ratingDeviation: 190, ratingGames: 6, onboarded: true, updatedAt: 1000,
  ratedGameIds: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'],
  ratingHistory: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6'].map((id, i) => rated(id, 2000 + i, 1300 + i * 30, 1330 + i * 30))
});
account.updatedAt = 2005;
const guest = run('emptyGrowthState()');
Object.assign(guest.profile, { rating: 1500, ratingEstimate: 1500, minutes: 25, goal: 'tactics', sessionStyle: 'drills', onboarded: true, updatedAt: 9000 });
guest.updatedAt = 9000;
for (const [label, merged] of [['sync (account local, guest remote)', context.mergeGrowthStates(account, guest)], ['adoption (guest remote of account)', context.mergeGrowthStates(guest, account)]]) {
  const p = merged.profile;
  assert(p.ratingEstimate === 1460 && p.ratingGames === 6 && p.ratingDeviation === 190, `${label}: the guest profile replaced the calibrated estimate: ${JSON.stringify([p.ratingEstimate, p.ratingGames, p.ratingDeviation])}`);
  assert(p.ratingHistory.length === 6 && p.ratedGameIds.length === 6, `${label}: rated history was lost`);
  assert(p.minutes === 25 && p.goal === 'tactics' && p.sessionStyle === 'drills' && p.rating === 1500, `${label}: the newer preferences were not kept`);
}

// The real sign-in path: guest data on this device is adopted into an
// account whose state arrived from the server, then synced back.
store.clear();
owner = null;
assert(run('saveGrowthState')(guest, null, { skipSync: true, preserveTimestamp: true }).ok, 'guest state did not save');
owner = 'account-a';
assert(run('saveGrowthState')(account, 'account-a', { skipSync: true, preserveTimestamp: true }).ok, 'account state did not save');
run('adoptAnonymousGrowthState')('account-a');
const adopted = run('loadGrowthState')('account-a').profile;
assert(adopted.ratingEstimate === 1460 && adopted.ratingGames === 6, 'adopting a guest profile reset the account rating');

// Two devices that rated different games keep both; the newer estimate wins.
const deviceA = run('emptyGrowthState()');
const deviceB = run('emptyGrowthState()');
Object.assign(deviceA.profile, { ratingEstimate: 1250, ratingGames: 2, ratingUpdatedAt: 3001, updatedAt: 50, ratedGameIds: ['a1', 'a2'], ratingHistory: [rated('a1', 3000, 1200, 1230), rated('a2', 3001, 1230, 1250)] });
Object.assign(deviceB.profile, { ratingEstimate: 1180, ratingGames: 3, ratingUpdatedAt: 4000, updatedAt: 40, ratedGameIds: ['a1', 'b1'], ratingHistory: [rated('a1', 3000, 1200, 1230), rated('b1', 4000, 1230, 1180)] });
const both = context.mergeGrowthStates(deviceA, deviceB).profile;
assert(both.ratingEstimate === 1180 && both.ratingGames === 3, 'the side with the newer rated game did not supply the estimate');
assert(both.ratingHistory.map(item => item.gameId).join() === 'a1,a2,b1', 'rated histories were not unioned by game: ' + both.ratingHistory.map(item => item.gameId).join());
assert(['a1', 'a2', 'b1'].every(id => both.ratedGameIds.includes(id)), 'rated game ids were not unioned');

// A deliberate restart (new starting rating after rated games) is honoured.
const reset = run('emptyGrowthState()');
Object.assign(reset.profile, { rating: 1600, ratingEstimate: 1600, ratingGames: 0, ratingResetAt: 5000, ratingUpdatedAt: 5000, updatedAt: 5000 });
const afterReset = context.mergeGrowthStates(deviceB, reset).profile;
assert(afterReset.ratingEstimate === 1600 && afterReset.ratingGames === 0 && afterReset.ratingHistory.length === 0, 'an older device restored games from before a rating reset');

// ── Repertoire openings keep their own timestamp ──
const chooser = run('emptyGrowthState()');
chooser.repertoire.ids = ['italian'];
chooser.repertoire.idsUpdatedAt = 100;
chooser.repertoire.updatedAt = 100;
const importer = run('emptyGrowthState()');
importer.repertoire.updatedAt = 900; // an import or practice touched the repertoire later
const keptIds = context.mergeGrowthStates(importer, chooser).repertoire.ids;
assert(keptIds.join() === 'italian', 'chosen repertoire openings were lost to a later import: ' + keptIds.join());
const legacy = { v: 1, repertoire: { ids: ['italian'], updatedAt: 100 } };
assert(context.mergeGrowthStates(importer, legacy).repertoire.ids.join() === 'italian', 'a legacy state without idsUpdatedAt lost its openings');

// ── Repertoire confidence: one flagged move in fifty is a small penalty ──
const confidence = record => context.repertoireConfidence(Object.assign({ moves: 50, deviations: 0, practiceAttempts: 0, practiceCorrect: 0 }, record));
assert(confidence({ mistakes: 0 }) - confidence({ mistakes: 1 }) <= 2, `one mistake in 50 moves cost ${confidence({ mistakes: 0 }) - confidence({ mistakes: 1 })} points`);
assert(confidence({ mistakes: 5 }) < confidence({ mistakes: 1 }) && confidence({ mistakes: 10 }) < confidence({ mistakes: 5 }), 'confidence did not fall as the mistake rate rose');

// ── Pasted games from a set-up position ──
const fenGame = new Chess();
const setupFen = 'r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 30';
fenGame.load_pgn(`[FEN "${setupFen}"]\n[SetUp "1"]\n\n30. Bc4 Bc5 31. c3 Nf6 *`);
assert(fenGame.history().length === 4, 'fixture FEN game did not parse');
const targets = context.collectImportedTargets([{ sourceIndex: 0, game: fenGame }], 'white', [{}]);
assert(targets.map(t => t.pairNum).join() === '30,31', 'move numbers ignored the FEN fullmove number: ' + targets.map(t => t.pairNum).join());
const blackTargets = context.collectImportedTargets([{ sourceIndex: 0, game: fenGame }], 'black', [{}]);
assert(blackTargets.map(t => t.pairNum).join() === '30,31', 'Black move numbers ignored the FEN: ' + blackTargets.map(t => t.pairNum).join());
const lookalike = new Chess();
lookalike.load_pgn('1. Nf3 Nc6 2. Bc4 *');
context.openingDefinitionForSans = sans => ({ opening: null, info: { match: { name: 'Fixture opening', eco: 'A00' }, matchedPlies: sans.length, exact: true } });
owner = 'account-a';
store.clear();
context.recordImportedOpenings([fenGame], 'white', targets.map(t => Object.assign({ tier: 'good' }, t)));
assert(run('loadGrowthState')().repertoire.observed.length === 0, 'a game from a set-up position was attributed to an opening');
context.recordImportedOpenings([lookalike], 'white', []);
assert(run('loadGrowthState')().repertoire.observed.length === 1, 'a game from the start position lost its opening attribution');

// ── Insights: imported games keep to their share ──
const own = (i, ts = i) => ({ localGameId: `coach-game-${Math.floor(i / 20)}`, ply: i % 20, ts, tier: 'good' });
const legacyPasted = Array.from({ length: 160 }, (_, i) => ({ localGameId: 'import-1', ply: i, ts: 1000 + i, tier: 'good' }));
const pasted = [1, 3, 5].map(ply => ({ localGameId: 'pgn-wabc', ply, ts: 5000 + ply, tier: 'mistake' }));
store.clear();
assert(context.saveInsights({ entries: Array.from({ length: 140 }, (_, i) => own(i)).concat(legacyPasted, pasted) }), 'insights did not save');
const savedEntries = context.loadInsights().entries;
assert(savedEntries.filter(e => e.localGameId.startsWith('coach-')).length === 140, 'a pasted game pushed the player\'s own Coach reviews out of Insights');
assert(savedEntries.filter(e => context.isImportedInsightEntry(e)).length === 150, 'imported games did not keep to their share');
assert(savedEntries.filter(e => e.localGameId === 'pgn-wabc').length === 3, 'the newest pasted game was trimmed instead of the oldest imports');
const online = Array.from({ length: 200 }, (_, i) => ({ localGameId: `chesscom-${i}`, ply: 1, ts: i, tier: 'good' }));
assert(context.capInsightEntries(online).length === 150, 'online imports lost their share cap');

// ── Backup import keeps the newest data from either file ──
owner = null;
store.clear();
store.set('coach:insights:v1:anon:test', JSON.stringify({ v: 1, entries: Array.from({ length: 300 }, (_, i) => own(i, 100000 + i)) }));
context.testEvents = Array.from({ length: 2000 }, (_, i) => ({ id: `new-${i}`, at: 100000 + i }));
written = null;
context.mergeImportedTrainingData({
  schema: 'chess-coach-training-backup', version: 1, ownerScope: 'local', data: {
    'coach:insights:v1': { v: 1, entries: Array.from({ length: 300 }, (_, i) => ({ id: `old-${i}`, ts: 10 + i, tier: 'good' })) },
    'coach:practice:v2': { v: 2, records: {}, events: Array.from({ length: 50 }, (_, i) => ({ id: `old-${i}`, at: 10 + i })) }
  }
});
const importedInsights = written && written['coach:insights:v1:anon:test'];
assert(importedInsights && importedInsights.entries.length === 300 && importedInsights.entries.every(e => e.ts >= 100000), 'importing an older backup replaced the newest reviews with old ones');
const importedEvents = written && written['coach:practice:v2:anon'];
assert(importedEvents && importedEvents.events.length === 2000 && importedEvents.events.every(e => e.at >= 100000), 'importing an older backup replaced the newest practice events with old ones');

// ── Repertoire-drill schedule and endgame bests ride in the synced state ──
// Without RepertoireCore loaded the copy passes through; load it here so the
// real merge runs (newest review per line wins, fewest moves per drill wins).
vm.runInContext(fs.readFileSync(path.join(root, 'repertoire-core.js'), 'utf8') + '\nRepertoireCore = window.RepertoireCore;', context);
const drills = (records, day) => ({ v: 1, records, newDay: { day, count: 1 } });
const line = (lastAt, interval) => ({ reps: 1, ease: 2.5, interval, lapses: 0, seen: 1, dueAt: lastAt + interval * 864e5, lastAt });
const phone = run('emptyGrowthState()');
const laptop = run('emptyGrowthState()');
phone.repertoireDrills = drills({ italian: line(5000, 3), london: line(1000, 1) }, '2026-11-10');
phone.endgames = { 'queen-mate': 9, 'rook-mate': 12, junk: 'many', [('x').repeat(80)]: 3 };
laptop.repertoireDrills = drills({ london: line(7000, 6), caro: line(2000, 1) }, '2026-11-09');
laptop.endgames = { 'queen-mate': 7, 'rook-mate': 15, 'k-p': 20 };
const mergedTraining = context.mergeGrowthStates(phone, laptop);
const lines = mergedTraining.repertoireDrills.records;
assert(Object.keys(lines).sort().join() === 'caro,italian,london', 'drill schedules from two browsers were not unioned: ' + Object.keys(lines).join());
assert(lines.london.interval === 6 && lines.italian.interval === 3, 'the most recently reviewed copy of a line did not win');
assert(mergedTraining.repertoireDrills.newDay.day === '2026-11-10', 'the newer new-lines-per-day counter was not kept');
assert(JSON.stringify(mergedTraining.endgames) === JSON.stringify({ 'queen-mate': 7, 'rook-mate': 12, 'k-p': 20 }), 'endgame bests did not keep the fewest moves (or kept junk): ' + JSON.stringify(mergedTraining.endgames));
assert(context.mergeGrowthStates(laptop, phone).endgames['rook-mate'] === 12, 'endgame merge depends on argument order');
assert(context.mergeGrowthStates(run('emptyGrowthState()'), run('emptyGrowthState()')).repertoireDrills === null, 'an empty merge invented a drill schedule');
// A guest's drills and bests on this device are adopted on sign-in.
store.clear();
const guestTraining = run('emptyGrowthState()');
guestTraining.repertoireDrills = drills({ caro: line(9000, 4) }, '2026-11-10');
guestTraining.endgames = { 'k-p': 11 };
assert(run('saveGrowthState')(guestTraining, null, { skipSync: true }).ok, 'guest training did not save');
assert(run('saveGrowthState')(laptop, 'account-b', { skipSync: true }).ok, 'account training did not save');
run('adoptAnonymousGrowthState')('account-b');
const adoptedTraining = run('loadGrowthState')('account-b');
assert(adoptedTraining.repertoireDrills.records.caro.interval === 4 && adoptedTraining.repertoireDrills.records.london.interval === 6, 'guest drill schedule was not adopted into the account');
assert(adoptedTraining.endgames['k-p'] === 11 && adoptedTraining.endgames['queen-mate'] === 7, 'guest endgame bests were not adopted into the account');

// ── Guest lifetime totals are added to the account's, not swapped in ──
const lifetime = (games, rollups) => Object.assign(context.emptyLifetime(), { games, moves: games * 10, rollups });
const roll = { games: 1, moves: 10 };
const accountLifetime = lifetime(5, { a: roll, b: roll, c: roll, d: roll, e: roll });
const guestLifetime = lifetime(7, { e: roll, f: roll, g: roll, h: roll, i: roll, j: roll, k: roll });
const mergedLifetime = context.mergeLifetimeTotals(accountLifetime, guestLifetime);
assert(mergedLifetime.games === 11 && mergedLifetime.moves === 110 && Object.keys(mergedLifetime.rollups).length === 11, `guest lifetime replaced or double-counted the account's: ${mergedLifetime.games} games`);
const legacyGuest = lifetime(3, { z: roll });
assert(context.mergeLifetimeTotals(accountLifetime, legacyGuest).games === 8, 'guest totals from before per-game rollups were dropped');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Growth sync validation passed (${checks} behavioural checks).`);
