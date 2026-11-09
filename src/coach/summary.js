// Post-game summary: accuracy, phases, eval chart and key moments.
// Classic script loaded before the view scripts in src/views/ (see
// index.html); its top-level declarations are shared globals, as they were
// inside app.js.

// ─────────────────────────────────────────────
// POST-GAME SUMMARY
// ─────────────────────────────────────────────

// Eval from user's POV (centipawns) after a given review's position.
// evalAfter is stockfish's score from opponent-to-move POV, so we negate.
function evalAfterUserCp(r) {
  if (!r || !r.evalAfter) return null;
  return -scoreToCp(r.evalAfter);
}

// Average centipawn loss across scored (non-'unknown') moves. Cap each move's
// contribution at 1000cp so a single mate allowance (loss ~10000cp) doesn't
// make ACPL meaningless — this matches the Lichess convention.
const ACPL_CAP = 1000;
function computeACPL(reviews) {
  const scored = reviews.filter(r => r && r.tier && r.tier !== 'unknown');
  if (!scored.length) return null;
  const total = scored.reduce((s, r) => s + Math.min(r.loss || 0, ACPL_CAP), 0);
  return Math.round(total / scored.length);
}

// Format a centipawn loss as a signed pawn value. Losses past 10 pawns
// (e.g. allowing mate) collapse to "9.9+" so rows don't show "−100.0".
function formatLossPawns(loss) {
  if (loss >= 1000) return '9.9+';
  return (loss / 100).toFixed(1);
}

// Simple ply-based phase classifier. A game that resigns mid-opening
// will legitimately have zero moves in later phases.
function phaseOf(pairNum) {
  if (pairNum <= 12) return 'opening';
  if (pairNum <= 25) return 'middlegame';
  return 'endgame';
}

function phaseBreakdown(reviews) {
  const buckets = {
    opening: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, moves: 0 },
    middlegame: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, moves: 0 },
    endgame: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0, moves: 0 }
  };
  for (const r of reviews) {
    if (!r || !r.tier || r.tier === 'unknown') continue;
    const p = phaseOf(r.pairNum);
    buckets[p][r.tier] = (buckets[p][r.tier] || 0) + 1;
    buckets[p].moves++;
  }
  return {
    opening: { ...buckets.opening, pct: accuracyFromTallies(buckets.opening, buckets.opening.moves) },
    middlegame: { ...buckets.middlegame, pct: accuracyFromTallies(buckets.middlegame, buckets.middlegame.moves) },
    endgame: { ...buckets.endgame, pct: accuracyFromTallies(buckets.endgame, buckets.endgame.moves) }
  };
}

// Format "14. Qh5" or "14... Qh5" based on ply parity.
function formatMoveRef(r) {
  const turn = r.fenBefore && r.fenBefore.split(/\s+/)[1];
  const dots = turn ? (turn === 'w' ? '.' : '...') : (r.ply % 2 === 1 ? '.' : '...');
  return `${r.pairNum}${dots} ${r.userSan}`;
}

// Build an inline SVG eval chart from review log.
// X axis: review index. Y axis: eval after user's move from user's POV.
// Clamped to ±800 cp (±8 pawns) so blowouts don't flatten the interesting region.
function renderEvalChart(reviews) {
  const pts = [];
  for (const r of reviews) {
    if (!r || r.tier === 'unknown') continue;
    const cp = evalAfterUserCp(r);
    if (cp === null) continue;
    pts.push({ cp, r });
  }
  if (pts.length < 2) return ''; // need at least 2 points for a line

  const W = 580, H = 96, PAD = 4;
  const CLAMP = 800;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const xStep = innerW / (pts.length - 1);
  const midY = PAD + innerH / 2;
  const yFor = (cp) => {
    const c = Math.max(-CLAMP, Math.min(CLAMP, cp));
    return midY - (c / CLAMP) * (innerH / 2);
  };

  let d = '';
  pts.forEach((p, i) => {
    const x = PAD + i * xStep;
    const y = yFor(p.cp);
    d += (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`);
  });

  // Area fill down to zero line — gives visual weight to who's winning.
  let area = '';
  pts.forEach((p, i) => {
    const x = PAD + i * xStep;
    const y = yFor(p.cp);
    area += (i === 0 ? `M${x.toFixed(1)},${midY.toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`);
  });
  area += ` L${(PAD + (pts.length - 1) * xStep).toFixed(1)},${midY.toFixed(1)} Z`;

  // Dots for mistakes/blunders so users can eyeball where things went wrong.
  const markers = pts.map((p, i) => {
    const x = PAD + i * xStep;
    const y = yFor(p.cp);
    const tier = p.r.tier;
    let color = null;
    if (tier === 'blunder') color = 'var(--mq-blunder)';
    else if (tier === 'mistake') color = 'var(--mq-mistake)';
    if (!color) return '';
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" style="fill: ${color}"/>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evaluation over time">
      <line x1="${PAD}" y1="${midY}" x2="${W - PAD}" y2="${midY}" style="stroke: var(--chart-grid)" stroke-dasharray="2,3" stroke-width="0.5"/>
      <path d="${area}" style="fill: var(--chart-fill)"/>
      <path d="${d}" fill="none" style="stroke: var(--chart-line)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${markers}
    </svg>
  `;
}

// Compact eval sparkline shown next to the move list during play.
// Same shape as renderEvalChart but smaller, no markers — just a line + zero rule.
function renderLiveEvalChart(reviews) {
  const pts = [];
  for (const r of reviews) {
    if (!r || r.tier === 'unknown') continue;
    const cp = evalAfterUserCp(r);
    if (cp === null) continue;
    pts.push({ cp, r });
  }
  if (pts.length < 2) return '';
  // Show only the trailing 24 plies so the line keeps moving instead of compressing.
  const recent = pts.slice(-24);
  const W = 280, H = 44, PAD = 2;
  const CLAMP = 800;
  const innerW = W - PAD * 2;
  const innerH = H - PAD * 2;
  const xStep = innerW / (recent.length - 1);
  const midY = PAD + innerH / 2;
  const yFor = (cp) => {
    const c = Math.max(-CLAMP, Math.min(CLAMP, cp));
    return midY - (c / CLAMP) * (innerH / 2);
  };
  let d = '';
  recent.forEach((p, i) => {
    const x = PAD + i * xStep;
    const y = yFor(p.cp);
    d += (i === 0 ? `M${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`);
  });
  let area = '';
  recent.forEach((p, i) => {
    const x = PAD + i * xStep;
    const y = yFor(p.cp);
    area += (i === 0 ? `M${x.toFixed(1)},${midY.toFixed(1)} L${x.toFixed(1)},${y.toFixed(1)}` : ` L${x.toFixed(1)},${y.toFixed(1)}`);
  });
  area += ` L${(PAD + (recent.length - 1) * xStep).toFixed(1)},${midY.toFixed(1)} Z`;
  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Live evaluation">
      <line x1="${PAD}" y1="${midY}" x2="${W - PAD}" y2="${midY}" style="stroke: var(--chart-grid)" stroke-dasharray="2,3" stroke-width="0.5"/>
      <path d="${area}" style="fill: var(--chart-fill)"/>
      <path d="${d}" fill="none" style="stroke: var(--chart-line)" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
  `;
}

function updateLiveEvalChart() {
  const html = renderLiveEvalChart(coachReviewLog || []);
  if (!html) {
    hideEl(byId('liveeval-section'));
    byId('liveeval-chart').replaceChildren();
    return;
  }
  byId('liveeval-chart').innerHTML = html;
  showEl(byId('liveeval-section'));
}

// Human-readable coaching takeaway inferred from pattern in reviews.
function coachingTakeaway(reviews, phases) {
  const scored = reviews.filter(r => r.tier && r.tier !== 'unknown');
  if (scored.length === 0) return null;
  const blunders = reviews.filter(r => r.tier === 'blunder').length;
  const mistakes = reviews.filter(r => r.tier === 'mistake').length;
  const bestCnt = reviews.filter(r => r.tier === 'best').length;
  const pctBest = bestCnt / scored.length;

  const op = phases.opening.pct;
  const mi = phases.middlegame.pct;
  const en = phases.endgame.pct;

  if (blunders === 0 && mistakes === 0 && pctBest >= 0.5) {
    return 'Clean game — no blunders, over half your moves matched the engine.';
  }
  if (blunders === 0 && mistakes <= 1) {
    return 'Solid play with no blunders. Keep the discipline on every move.';
  }
  if (op !== null && mi !== null && op - mi >= 20) {
    return 'You played the opening sharply but the middlegame got away from you. Before each move, check what your opponent threatens.';
  }
  if (mi !== null && en !== null && mi - en >= 20) {
    return 'Middlegame was steady but the endgame slipped. Endgame technique — king activity, passed pawns, opposition — often decides close games.';
  }
  if (blunders >= 3) {
    return `${blunders} blunders tipped this one. Use the Threats tool before committing to a move — it surfaces hanging pieces and forcing replies.`;
  }
  if (blunders >= 1) {
    return 'Start with the largest blunder below. Compare your move with the recommendation, then rehearse that decision.';
  }
  if (mistakes >= 3) {
    return 'Several mistakes without blunders — often a sign of missed candidate moves. Before moving, ask: what\'s the engine\'s #1 doing that mine isn\'t?';
  }
  return 'Choose one critical moment below. Compare the opponent’s reply and take one useful idea into your next game.';
}

function showPostGameSummary(endMsg) {
  coachLastEndMsg = endMsg;
  if (typeof GameArchive !== 'undefined') GameArchive.record(endMsg);
  // Status-line pulse handed the baton to the overlay — remove it so reopens don't pulse again.
  byId('coach-status').classList.remove('status-ended');
  // Refresh the "Open review" button visibility now that we have an end message.
  updateCoachControlsState();
  byId('summary-title').textContent = endMsg;

  // Subtitle: opponent level + user color context
  const eloEl = document.getElementById('coach-strength-value');
  const elo = eloEl ? eloEl.textContent : '';
  const sideName = coachUserColor() === 'white' ? 'White' : 'Black';
  const subtitleParts = [];
  if (sideName) subtitleParts.push(`You played ${sideName}`);
  const personaName = typeof OpponentPersonas !== 'undefined' ? OpponentPersonas.displayName() : null;
  if (elo) subtitleParts.push(personaName ? `vs ${personaName} (${elo})` : `vs Opponent ${elo}`);
  if (subtitleParts.length) {
    const subtitle = byId('summary-subtitle');
    subtitle.textContent = subtitleParts.join(' · ');
    showEl(subtitle);
  } else {
    hideEl(byId('summary-subtitle'));
  }

  // Headline metrics
  const total = coachStats.moves;
  const pct = accuracyFromTallies(coachStats, total);
  byId('summary-accuracy').textContent = pct === null ? '—' : pct + '%';
  byId('summary-moves').textContent = total;
  const acpl = computeACPL(coachReviewLog);
  byId('summary-acpl').textContent = acpl === null ? '—' : acpl;

  // Classification distribution bar + legend
  const tiers = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];
  const tierLabel = {
    best: 'Best', excellent: 'Excellent', good: 'Good',
    inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder'
  };
  const bar = byId('summary-tier-bar');
  const legend = byId('summary-tier-legend');
  bar.replaceChildren();
  legend.replaceChildren();
  if (total > 0) {
    for (const t of tiers) {
      const n = coachStats[t] || 0;
      if (n > 0) {
        const wPct = (n / total) * 100;
        bar.insertAdjacentHTML('beforeend', `<div class="tier-bar-seg ${t}" style="width:${wPct.toFixed(2)}%" title="${tierLabel[t]}: ${n}"></div>`);
      }
      // Legend always shows even zero counts so users can see "no blunders".
      legend.insertAdjacentHTML('beforeend',
        `<span class="tier-legend-item"><span class="swatch ${t}"></span>${tierLabel[t]} <span class="count">${n}</span></span>`
      );
    }
    showEl(byId('summary-tier-section'));
  } else {
    // No moves scored — hide the whole section rather than show an empty bar.
    hideEl(byId('summary-tier-section'));
  }

  // Phase breakdown
  const phases = phaseBreakdown(coachReviewLog);
  const anyPhase = phases.opening.moves + phases.middlegame.moves + phases.endgame.moves > 0;
  const phaseGrid = byId('summary-phase-grid');
  phaseGrid.replaceChildren();
  if (anyPhase) {
    const rows = [
      ['Opening', phases.opening, '(moves 1–12)'],
      ['Middlegame', phases.middlegame, '(13–25)'],
      ['Endgame', phases.endgame, '(26+)']
    ];
    for (const [name, data, range] of rows) {
      const acc = data.pct === null ? '—' : `${data.pct}%`;
      const moves = data.moves === 0 ? '—' : `${data.moves} move${data.moves === 1 ? '' : 's'}`;
      phaseGrid.insertAdjacentHTML('beforeend',
        `<span class="phase-name">${name} <span style="color:var(--text-3);font-size:var(--text-xs)">${range}</span></span>` +
        `<span class="phase-acc">${acc}</span>` +
        `<span class="phase-count">${moves}</span>`
      );
    }
    showEl(byId('summary-phase-section'));
  } else {
    hideEl(byId('summary-phase-section'));
  }

  // Eval chart — need ≥ 2 scored points
  const chartHtml = renderEvalChart(coachReviewLog);
  if (chartHtml) {
    byId('summary-eval-chart').innerHTML = chartHtml;
    showEl(byId('summary-eval-section'));
  } else {
    hideEl(byId('summary-eval-section'));
  }

  // Opening — identify based on full history
  const openingSans = coachGame ? coachGame.history() : [];
  if (openingSans.length > 0 && typeof identifyOpening === 'function') {
    const info = identifyOpening(openingSans);
    if (info.match) {
      const mNum = Math.ceil(info.bookPlies / 2);
      const lineText = info.exact
        ? `Stayed in theory through move ${mNum}.`
        : `Left book after move ${mNum}.`;
      byId('summary-opening-line').innerHTML = `<span class="eco">${escapeHtml(info.match.eco)}</span>` +
        `<strong>${escapeHtml(info.match.name)}</strong> — ${escapeHtml(lineText)}`;
      showEl(byId('summary-opening-section'));
    } else {
      hideEl(byId('summary-opening-section'));
    }
  } else {
    hideEl(byId('summary-opening-section'));
  }

  // Critical moments — top 3 worst non-best moves, threshold loss ≥ 30cp
  const critical = coachReviewLog
    .filter(r => r.tier && r.tier !== 'unknown' && r.tier !== 'best' && (r.loss || 0) >= 30)
    .sort((a, b) => (b.loss || 0) - (a.loss || 0))
    .slice(0, 3);
  const critList = byId('summary-critical-list');
  critList.replaceChildren();
  if (critical.length) {
    for (const r of critical) {
      const ref = formatMoveRef(r);
      const lossPawns = formatLossPawns(r.loss || 0);
      const best = r.bestSan ? ` — best was ${r.bestSan}` : '';
      const desc = `${tierLabel[r.tier]}${best}`;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `moment-row ${r.tier}`;
      row.dataset.ply = r.ply;
      row.innerHTML =
        `<span class="moment-num">${escapeHtml(ref)}</span>` +
        `<span class="moment-desc">${escapeHtml(desc)}</span>` +
        `<span class="moment-loss">−${lossPawns}</span>`;
      critList.append(row);
    }
    showEl(byId('summary-critical-section'));
  } else {
    hideEl(byId('summary-critical-section'));
  }

  // Best moments — top 3 'best'-tier or 'excellent'-tier moves spaced through the game
  // Prefer moves where engine rank=1 and there was a real alternative (>1 line seen).
  // Simple approach: take the first 3 'best' tier reviews with a best alternative.
  const bestMoves = coachReviewLog
    .filter(r => r.tier === 'best' || r.tier === 'excellent')
    .slice(0, 3);
  const bestList = byId('summary-best-list');
  bestList.replaceChildren();
  if (bestMoves.length) {
    for (const r of bestMoves) {
      const ref = formatMoveRef(r);
      const rankNote = r.rank === 1 ? 'top engine choice' : (r.rank ? `#${r.rank} engine choice` : '');
      const tierNote = r.tier === 'best' ? 'Best' : 'Excellent';
      const desc = rankNote ? `${tierNote} · ${rankNote}` : tierNote;
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `moment-row ${r.tier}`;
      row.dataset.ply = r.ply;
      row.innerHTML =
        `<span class="moment-num">${escapeHtml(ref)}</span>` +
        `<span class="moment-desc">${escapeHtml(desc)}</span>` +
        `<span class="moment-loss" style="color:var(--mq-best)">✓</span>`;
      bestList.append(row);
    }
    showEl(byId('summary-best-section'));
  } else {
    hideEl(byId('summary-best-section'));
  }

  // Takeaway
  const takeaway = coachingTakeaway(coachReviewLog, phases);
  if (takeaway) {
    byId('summary-takeaway-text').textContent = takeaway;
    showEl(byId('summary-takeaway'));
  } else {
    hideEl(byId('summary-takeaway'));
  }

  summaryPracticeItems = orderedPracticeRunItems(currentGameDuePracticeItems());
  const dueCount = summaryPracticeItems.length;
  const practiceBtn = byId('btn-summary-practice');
  practiceBtn.textContent = dueCount === 1 ? 'Practice this mistake' : `Practice ${dueCount} positions`;
  toggleEl(practiceBtn, dueCount > 0);
  practiceBtn.classList.toggle('primary', dueCount > 0);

  byId('btn-summary-newgame').classList.toggle('primary', dueCount === 0);
  summaryReturnFocus = document.activeElement;
  const overlay = byId('summary-overlay');
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  if (typeof renderOpeningTransferSummary === 'function') renderOpeningTransferSummary();
  // Scroll to top when reopening on a new game
  qsa('.summary-card, .summary-body').forEach(el => { el.scrollTop = 0; });
  qsa('.summary-card').forEach(el => el.focus());
}
