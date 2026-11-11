// Candidate moves: the top engine lines for the current position.
// Classic script loaded before the view scripts in src/views/ (see
// index.html); its top-level declarations are shared globals, as they were
// inside app.js.

// ─────────────────────────────────────────────
// CANDIDATE MOVES (top-3)
// ─────────────────────────────────────────────
async function showCandidates() {
  if (!coachMode || !coachGame) return;
  if (coachThinking) return;
  if (!coachIsUserTurn()) return; // never compute candidates for opponent's turn
  const fen = coachGame.fen();
  const requestId = ++candidateRequestId;
  showEl(byId('candidates-section'));
  const list = byId('candidates-list');
  list.innerHTML = '<div class="explore-loading">Computing top moves at depth 18…</div>';
  try {
    // Depth 18 with MultiPV=3 is strong enough to see most tactics up to ~9 moves
    // deep. Depth 12 was leaving blunders on the board and producing candidates
    // that didn't actually win material when the user expected them to.
    const res = await engineClient.evaluate(fen, 18, { multipv: 3 });
    if (requestId !== candidateRequestId || !coachMode || !coachGame || !coachGameActive ||
        !coachIsUserTurn() || coachIsReviewing() || coachGame.fen() !== fen) {
      return;
    }
    list.replaceChildren();
    if (!res.lines || res.lines.length === 0) {
      list.innerHTML = '<div class="explore-empty">No candidates found.</div>';
      return;
    }
    const bestCp = res.lines[0].mate !== null && res.lines[0].mate !== undefined
      ? (res.lines[0].mate > 0 ? 10000 : -10000)
      : (res.lines[0].cp || 0);
    // Small hint so users don't assume "best move" means "wins material immediately".
    list.append(makeEl('div', 'candidate-hint',
      'Top moves by full-position evaluation — continuation shown after each.'
    ));
    res.lines.forEach((line, idx) => {
      const uci = (line.pv && line.pv[0]) || null;
      if (!uci) return;
      const san = uciToSan(fen, uci);
      const evalLabel = formatEval(line);
      const cp = line.mate !== null && line.mate !== undefined
        ? (line.mate > 0 ? 10000 : -10000)
        : (line.cp || 0);
      const delta = cp - bestCp;
      const continuation = pvToSan(fen, line.pv || [], 5);
      const row = makeEl('div', 'candidate-row');
      row.append(makeEl('span', 'rank', (idx + 1) + '.'));
      row.append(makeEl('span', 'move', san));
      row.append(makeEl('span', 'eval', evalLabel + (idx > 0 ? ` (${(delta / 100).toFixed(2)})` : '')));
      list.append(row);
      if (continuation.length > 1) {
        list.append(makeEl('div', 'candidate-cont', continuation.slice(1).join(' ')));
      }
    });
  } catch (err) {
    if (requestId !== candidateRequestId) return;
    list.innerHTML = '<div class="token-error">Engine error: ' + err.message + '</div>';
  }
}
