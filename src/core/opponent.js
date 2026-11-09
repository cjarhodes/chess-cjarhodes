// Coach opponent strength: difficulty keyframes and calibrated move selection.
// Classic script loaded before the view scripts in src/views/ (see
// index.html); its top-level declarations are shared globals, as they were
// inside app.js.

// Opponent difficulty is controlled by a monotonic engine-compatible model.
function strengthTierLabel(elo) {
  if (elo < 600)  return 'Absolute beginner';
  if (elo < 800)  return 'Learning the rules';
  if (elo < 1000) return 'Beginner';
  if (elo < 1300) return 'Club novice';
  if (elo < 1600) return 'Improving club';
  if (elo < 1900) return 'Strong club';
  if (elo < 2200) return 'Expert';
  return 'Master';
}

// These are estimated difficulty settings, not measured human Elo ratings.
// Search at full native skill so only this selector weakens play, including
// the bestmove fallback. Lower levels make more frequent, larger mistakes,
// but never deliberately sample the worst moves or require a minimum loss.
// errorSize is the sampling temperature in centipawns, not a target to lose.
// Calibration measures move quality and tactical failures, not human Elo.
const COACH_DIFFICULTY_KEYFRAMES = [
  { level: 400,  skill: 20, depth: 10, multipv: 20, errorRate: 0.85, errorSize: 360 },
  { level: 600,  skill: 20, depth: 10, multipv: 20, errorRate: 0.80, errorSize: 320 },
  { level: 800,  skill: 20, depth: 10, multipv: 20, errorRate: 0.75, errorSize: 290 },
  { level: 1000, skill: 20, depth: 10, multipv: 20, errorRate: 0.70, errorSize: 260 },
  { level: 1200, skill: 20, depth: 10, multipv: 16, errorRate: 0.64, errorSize: 230 },
  { level: 1400, skill: 20, depth: 10, multipv: 16, errorRate: 0.52, errorSize: 210 },
  { level: 1600, skill: 20, depth: 11, multipv: 16, errorRate: 0.46, errorSize: 190 },
  { level: 1800, skill: 20, depth: 12, multipv: 12, errorRate: 0.40, errorSize: 170 },
  { level: 2000, skill: 20, depth: 13, multipv: 12, errorRate: 0.38, errorSize: 150 },
  { level: 2200, skill: 20, depth: 14, multipv: 10, errorRate: 0.34, errorSize: 140 },
  { level: 2400, skill: 20, depth: 15, multipv: 10, errorRate: 0.28, errorSize: 130 }
];

function interpolateDifficultyField(a, b, t, field) {
  return a[field] + (b[field] - a[field]) * t;
}

function coachStrengthOpts(elo) {
  const level = Math.max(400, Math.min(2400, Number(elo) || 1200));
  const upperIndex = COACH_DIFFICULTY_KEYFRAMES.findIndex(frame => frame.level >= level);
  if (upperIndex <= 0) return Object.assign({}, COACH_DIFFICULTY_KEYFRAMES[0]);
  const upper = COACH_DIFFICULTY_KEYFRAMES[upperIndex];
  const lower = COACH_DIFFICULTY_KEYFRAMES[upperIndex - 1];
  const t = (level - lower.level) / (upper.level - lower.level);
  return {
    level,
    skill: Math.round(interpolateDifficultyField(lower, upper, t, 'skill')),
    depth: Math.round(interpolateDifficultyField(lower, upper, t, 'depth')),
    multipv: Math.round(interpolateDifficultyField(lower, upper, t, 'multipv')),
    errorRate: Math.round(interpolateDifficultyField(lower, upper, t, 'errorRate') * 1000) / 1000,
    errorSize: Math.round(interpolateDifficultyField(lower, upper, t, 'errorSize'))
  };
}

function calibratedOpponentCandidates(result) {
  const lines = (result && result.lines) || [];
  if (!lines.length) return [];
  const seen = new Set();
  const candidates = lines.map(line => {
    const uci = line && line.pv && line.pv[0];
    if (!uci || seen.has(uci) || (!Number.isFinite(line.cp) && !Number.isFinite(line.mate))) return null;
    seen.add(uci);
    return { uci, score: scoreToCp(line), mate: line.mate };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  return candidates.map(candidate => Object.assign(candidate, { loss: candidates[0].score - candidate.score }));
}

function chooseCalibratedOpponentMove(result, config, random = Math.random) {
  const candidates = calibratedOpponentCandidates(result);
  if (!candidates.length) return result && result.bestmove;
  const best = candidates[0].uci;
  if (candidates.length === 1) return best;
  // Convert known mates and resist as long as possible when all lines lose.
  // Mate scores are not ordinary centipawns to spend as an error budget.
  if (Number.isFinite(candidates[0].mate)) return best;
  if (!config.errorRate || random() >= config.errorRate) return best;
  // A lapse widens the choice, rather than instructing the bot to throw away
  // a particular amount of material. Sound alternatives remain in the pool.
  // Every branch shares this cap; no uncapped random tail exists.
  const cap = Math.min(500, config.errorSize * 2 + 60);
  const pool = candidates.filter(candidate => !Number.isFinite(candidate.mate) && candidate.loss <= cap);
  if (!pool.length) return best;
  const scale = Math.max(1, config.errorSize);
  const weighted = pool.map(candidate => ({
    uci: candidate.uci,
    weight: Math.exp(-candidate.loss / scale)
  }));
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = random() * total;
  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) return item.uci;
  }
  return weighted[weighted.length - 1].uci;
}
