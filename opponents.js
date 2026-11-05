// Opponent personalities for Coach, in the spirit of Chess.com's bots. Each
// one is a strength (the existing calibrated slider) plus an opening
// repertoire: while the game follows one of its Library lines, it plays the
// book move; after that the calibrated engine plays as usual. "Coach" is the
// plain adaptive opponent and the default.
(function(root) {
  'use strict';
  const KEY = 'ui:opponent';
  const PERSONAS = [
    { id: 'coach', name: 'Coach', initial: 'C', elo: null, style: 'Adapts to you',
      blurb: 'The adaptive training opponent. Its level follows your recent play.', openings: [] },
    { id: 'pip', name: 'Pip', initial: 'P', elo: 400, style: 'Early queen raids',
      blurb: 'Just learned how the pieces move and wants your king right now. Watch f7 and f2.',
      openings: ['scholars-mate', 'fools-mate', 'legal-trap'] },
    { id: 'rosa', name: 'Rosa', initial: 'R', elo: 800, style: 'Gambits and traps',
      blurb: 'Gives pawns for fast attacks and loves a trap. Count the material before you grab.',
      openings: ['kings-gambit', 'evans-gambit', 'fried-liver', 'stafford-gambit', 'budapest-gambit', 'blackburne-shilling', 'elephant-trap'] },
    { id: 'theo', name: 'Theo', initial: 'T', elo: 1200, style: 'Classical development',
      blurb: 'Develops pieces, castles early and plays the old main lines.',
      openings: ['italian', 'four-knights', 'queens-gambit', 'french'] },
    { id: 'mira', name: 'Mira', initial: 'M', elo: 1600, style: 'Solid and positional',
      blurb: 'Builds a sound structure first and waits for you to overreach.',
      openings: ['london', 'queens-gambit', 'caro-kann', 'slav', 'queens-indian'] },
    { id: 'kasimir', name: 'Kasimir', initial: 'K', elo: 2000, style: 'Sharp and dynamic',
      blurb: 'Seeks imbalances and opposite-side attacks from the opening on.',
      openings: ['ruy-lopez', 'scotch', 'sicilian-dragon', 'kings-indian', 'grunfeld'] },
    { id: 'ines', name: 'Ines', initial: 'I', elo: 2400, style: 'Universal',
      blurb: 'Comfortable in any structure, with deep preparation in the main lines.',
      openings: ['english', 'reti', 'sicilian', 'sicilian-schev', 'nimzo-indian'] }
  ];
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  function byId(id) { return PERSONAS.find(p => p.id === id) || PERSONAS[0]; }

  function lines(openingIds) {
    const all = typeof OPENINGS !== 'undefined' ? OPENINGS : [];
    const out = [];
    openingIds.forEach(id => {
      const opening = all.find(o => o.id === id);
      if (!opening) return;
      out.push(opening.moves);
      (opening.variations || []).forEach(v => { if (Array.isArray(v.moves)) out.push(v.moves); });
    });
    return out;
  }

  // The persona's next book move as UCI, or null when the game has left its
  // lines or did not start from the initial position.
  function bookMove(persona, startFen, history, rng) {
    if (!persona || !persona.openings.length) return null;
    if (String(startFen || START).split(' ').slice(0, 4).join(' ') !== START.split(' ').slice(0, 4).join(' ')) return null;
    const played = (history || []).map(san => san.replace(/[+#?!]+$/, ''));
    const next = new Map();
    lines(persona.openings).forEach(line => {
      if (line.length <= played.length) return;
      for (let i = 0; i < played.length; i++) if (line[i].replace(/[+#?!]+$/, '') !== played[i]) return;
      const san = line[played.length];
      next.set(san.replace(/[+#?!]+$/, ''), (next.get(san.replace(/[+#?!]+$/, '')) || 0) + 1);
    });
    if (!next.size) return null;
    // Weight by how many lines continue with each move.
    const options = Array.from(next.entries());
    const total = options.reduce((sum, [, n]) => sum + n, 0);
    let pick = (rng || Math.random)() * total;
    let chosen = options[0][0];
    for (const [san, n] of options) { pick -= n; if (pick <= 0) { chosen = san; break; } }
    const ChessCtor = typeof Chess !== 'undefined' ? Chess : null;
    if (!ChessCtor) return null;
    const game = new ChessCtor();
    for (const san of played) if (!game.move(san, { sloppy: true })) return null;
    const move = game.move(chosen, { sloppy: true });
    return move ? move.from + move.to + (move.promotion || '') : null;
  }

  function selected() {
    try { return byId(localStorage.getItem(KEY) || 'coach'); } catch (e) { return PERSONAS[0]; }
  }

  // Coach hook: a book move for the live game, if any.
  function coachBookMove() {
    if (typeof coachGame === 'undefined' || !coachGame) return null;
    if (typeof coachPracticeSession !== 'undefined' && coachPracticeSession) return null;
    if (typeof coachOpeningTransfer !== 'undefined' && coachOpeningTransfer) return null;
    const persona = selected();
    if (!persona.elo) return null;
    // The strength slider must still match: moving it means a custom level.
    if (typeof coachEngineElo !== 'undefined' && coachEngineElo !== persona.elo) return null;
    return bookMove(persona, typeof coachStartFen !== 'undefined' ? coachStartFen : START, coachGame.history());
  }

  // ── UI ───────────────────────────────────────
  function render() {
    const host = document.getElementById('opponent-picker');
    if (!host) return;
    const current = selected();
    const custom = current.elo && typeof coachEngineElo !== 'undefined' && coachEngineElo !== current.elo;
    host.querySelectorAll('.opponent-card').forEach(btn => {
      const on = btn.dataset.opponent === current.id && !custom;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    const title = document.getElementById('opponent-current');
    if (title) title.textContent = custom ? `Custom level · ${coachEngineElo}` : current.elo ? `${current.name} · ${current.elo} · ${current.style}` : `${current.name} · ${current.style}`;
    const about = document.getElementById('opponent-about');
    if (about) about.textContent = custom ? 'Pick an opponent to play its openings, or keep this level.' : current.blurb;
  }

  function choose(id) {
    const persona = byId(id);
    try { localStorage.setItem(KEY, persona.id); } catch (e) { /* this page only */ }
    const auto = document.getElementById('coach-auto-elo');
    const slider = document.getElementById('coach-strength');
    if (persona.elo && slider) {
      // Same path as dragging the slider: an explicit level turns adapting off.
      slider.value = String(persona.elo);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (auto && !auto.checked) {
      auto.checked = true;
      auto.dispatchEvent(new Event('change', { bubbles: true }));
    }
    render();
    setTimeout(render, 0);
  }

  function build() {
    const strength = document.getElementById('coach-strength-label');
    if (!strength || document.getElementById('opponent-picker')) return;
    const wrap = document.createElement('div');
    wrap.className = 'opponent-section';
    wrap.innerHTML = '<div class="section-label" id="opponent-label">Opponent</div>' +
      '<div class="opponent-picker" id="opponent-picker" role="group" aria-labelledby="opponent-label"></div>' +
      '<div class="opponent-current" id="opponent-current" aria-live="polite"></div>' +
      '<p class="opponent-about" id="opponent-about"></p>';
    const grid = wrap.querySelector('.opponent-picker');
    PERSONAS.forEach(p => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opponent-card';
      btn.dataset.opponent = p.id;
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = '<span class="opponent-avatar" aria-hidden="true"></span>';
      btn.querySelector('.opponent-avatar').textContent = p.initial;
      btn.querySelector('.opponent-avatar').dataset.opponent = p.id;
      btn.title = p.elo ? `${p.name} · ${p.elo}` : `${p.name} · adapts to you`;
      btn.setAttribute('aria-label', `${p.name}, ${p.elo ? 'level ' + p.elo + ', ' : ''}${p.style}`);
      btn.addEventListener('click', () => choose(p.id));
      grid.appendChild(btn);
    });
    // Before the difficulty row, after "Play as".
    const row = strength.closest('.strength-row') || strength;
    row.parentNode.insertBefore(wrap, row.previousElementSibling && row.previousElementSibling.classList.contains('play-divider') ? row.previousElementSibling : row);
    const slider = document.getElementById('coach-strength');
    // After app.js has read the new level, whichever listener runs first.
    if (slider) slider.addEventListener('input', () => setTimeout(render, 0));
    const auto = document.getElementById('coach-auto-elo');
    if (auto) auto.addEventListener('change', () => {
      if (auto.checked && selected().elo) { try { localStorage.setItem(KEY, 'coach'); } catch (e) { /* noop */ } }
      setTimeout(render, 0);
    });
    render();
  }

  // Name shown in summaries: the persona when it is still in charge.
  function displayName() {
    const p = selected();
    if (!p.elo || (typeof coachEngineElo !== 'undefined' && coachEngineElo !== p.elo)) return null;
    return p.name;
  }

  const api = { PERSONAS, byId, bookMove, coachBookMove, selected, choose, displayName, render };
  root.OpponentPersonas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
  }
})(typeof window !== 'undefined' ? window : globalThis);
