// Lifetime Coach statistics, rolled up once per completed game.
// Classic script loaded before the view scripts in src/views/ (see
// index.html); its top-level declarations are shared globals, as they were
// inside app.js.

// ─────────────────────────────────────────────
// LIFETIME STATS — accumulate across games in this browser
// ─────────────────────────────────────────────
const LIFETIME_KEY = 'coach:lifetime:v1';
function emptyLifetime() {
  return { games: 0, moves: 0, accuracySum: 0, blunders: 0, mistakes: 0,
           inaccuracies: 0, best: 0, excellent: 0, good: 0, rollups: {} };
}
function loadLifetime() {
  try {
    const raw = localStorage.getItem(coachMemoryKey(LIFETIME_KEY));
    if (!raw) return emptyLifetime();
    const v = JSON.parse(raw);
    const merged = Object.assign(emptyLifetime(), v || {});
    if (!merged.rollups || typeof merged.rollups !== 'object' || Array.isArray(merged.rollups)) {
      merged.rollups = {};
    }
    return merged;
  } catch (e) { return emptyLifetime(); }
}
function saveLifetime(s) {
  try {
    localStorage.setItem(coachMemoryKey(LIFETIME_KEY), JSON.stringify(s));
    return true;
  } catch (e) {
    return false;
  }
}
// Roll the just-finished game into lifetime totals. Idempotent guard via a
// per-game flag so a refresh on the summary screen doesn't double-count.
let coachLifetimeRolledForThisGame = false;

function lifetimeContribution() {
  if (!coachStats || coachStats.moves === 0) return null;
  const accuracy = accuracyFromTallies(coachStats, coachStats.moves);
  return {
    games: 1,
    moves: coachStats.moves,
    accuracySum: accuracy === null ? 0 : accuracy * coachStats.moves,
    best: coachStats.best || 0,
    excellent: coachStats.excellent || 0,
    good: coachStats.good || 0,
    inaccuracies: coachStats.inaccuracy || 0,
    mistakes: coachStats.mistake || 0,
    blunders: coachStats.blunder || 0
  };
}

function applyLifetimeContribution(lifetime, contribution, direction) {
  if (!contribution) return;
  for (const key of ['games', 'moves', 'accuracySum', 'best', 'excellent', 'good', 'inaccuracies', 'mistakes', 'blunders']) {
    lifetime[key] = Math.max(0, (lifetime[key] || 0) + direction * (contribution[key] || 0));
  }
}

function rollGameIntoLifetime() {
  // A recovered copy includes earlier reviews; do not count them again.
  if (coachContinuityCopy) return;
  if (coachLifetimeRolledForThisGame) return;
  const contribution = lifetimeContribution();
  if (!contribution) return;
  if (!coachLocalGameId) coachLocalGameId = createCoachGameId();
  const lt = loadLifetime();
  const previous = lt.rollups[coachLocalGameId];
  if (previous) applyLifetimeContribution(lt, previous, -1);
  applyLifetimeContribution(lt, contribution, 1);
  lt.rollups[coachLocalGameId] = contribution;
  saveLifetime(lt);
  coachLifetimeRolledForThisGame = true;
  renderLifetime();
}

function unrollGameFromLifetime() {
  if (coachContinuityCopy) return;
  if (!coachLocalGameId) return;
  const lt = loadLifetime();
  const previous = lt.rollups[coachLocalGameId];
  if (!previous) return;
  applyLifetimeContribution(lt, previous, -1);
  delete lt.rollups[coachLocalGameId];
  saveLifetime(lt);
  renderLifetime();
}

function registerRestoredLifetimeRollup() {
  if (coachContinuityCopy) return;
  if (!coachLocalGameId) return;
  const contribution = lifetimeContribution();
  if (!contribution) return;
  const lt = loadLifetime();
  if (lt.rollups[coachLocalGameId]) return;
  // Older saved games predate per-game rollups, but their contribution was
  // already added to the aggregate at game end. Register it without adding
  // again so a subsequent takeback can reverse it exactly once.
  lt.rollups[coachLocalGameId] = contribution;
  saveLifetime(lt);
}
function renderLifetime() {
  const lt = loadLifetime();
  const section = byId('lifetime-section');
  if (lt.games === 0) { hideEl(section); return; }
  showEl(section);
  byId('lifetime-games').textContent = lt.games;
  byId('lifetime-moves').textContent = lt.moves;
  const acc = lt.moves > 0 ? Math.round(lt.accuracySum / lt.moves) : null;
  byId('lifetime-accuracy').textContent = acc === null ? '—' : acc + '%';
  byId('lifetime-blunders').textContent = lt.blunders;
}
