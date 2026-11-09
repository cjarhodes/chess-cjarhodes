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
      openings: ['kings-gambit', 'evans-gambit', 'fried-liver', 'stafford-gambit', 'budapest-gambit', 'blackburne-shilling', 'elephant-trap', 'lasker-trap', 'noahs-ark-trap'] },
    { id: 'theo', name: 'Theo', initial: 'T', elo: 1200, style: 'Classical development',
      blurb: 'Develops pieces, castles early and plays the old main lines.',
      openings: ['italian', 'four-knights', 'queens-gambit', 'french', 'vienna', 'petrov', 'scandinavian'] },
    { id: 'mira', name: 'Mira', initial: 'M', elo: 1600, style: 'Solid and positional',
      blurb: 'Builds a sound structure first and waits for you to overreach.',
      openings: ['london', 'queens-gambit', 'caro-kann', 'slav', 'queens-indian', 'catalan', 'kings-indian-attack'] },
    { id: 'kasimir', name: 'Kasimir', initial: 'K', elo: 2000, style: 'Sharp and dynamic',
      blurb: 'Seeks imbalances and opposite-side attacks from the opening on.',
      openings: ['ruy-lopez', 'scotch', 'sicilian-dragon', 'kings-indian', 'grunfeld', 'pirc', 'dutch', 'alekhine'] },
    { id: 'ines', name: 'Ines', initial: 'I', elo: 2400, style: 'Universal',
      blurb: 'Comfortable in any structure, with deep preparation in the main lines.',
      openings: ['english', 'reti', 'sicilian', 'sicilian-schev', 'nimzo-indian', 'catalan', 'sicilian-najdorf'] }
  ];
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  function byId(id) { return PERSONAS.find(p => p.id === id) || PERSONAS[0]; }

  // Which side each line belongs to. A persona only plays a line from the
  // side that owns it, so it never walks into the losing half of a trap.
  // Traps and gambits are listed by the side that springs them; other lines
  // follow their Library category.
  const LINE_SIDE = {
    'scholars-mate': 'w', 'legal-trap': 'w', 'fried-liver': 'w', 'kings-gambit': 'w', 'evans-gambit': 'w',
    'fools-mate': 'b', 'elephant-trap': 'b', 'stafford-gambit': 'b', 'blackburne-shilling': 'b', 'budapest-gambit': 'b',
    'lasker-trap': 'b', 'noahs-ark-trap': 'b',
    slav: 'b', 'sicilian-dragon': 'b', 'sicilian-schev': 'b'
  };
  function lineSide(id, opening) {
    if (LINE_SIDE[id]) return LINE_SIDE[id];
    return opening && opening.category === 'black' ? 'b' : 'w';
  }

  function lines(openingIds, side) {
    const all = typeof OPENINGS !== 'undefined' ? OPENINGS : [];
    const out = [];
    openingIds.forEach(id => {
      const opening = all.find(o => o.id === id);
      if (!opening) return;
      if (!side || lineSide(id, opening) === side) out.push(opening.moves);
      (opening.variations || []).forEach(v => {
        if (Array.isArray(v.moves) && (!side || lineSide(v.id, opening) === side)) out.push(v.moves);
      });
    });
    return out;
  }

  // The persona's next book move as UCI, or null when the game has left its
  // lines or did not start from the initial position.
  function bookMove(persona, startFen, history, rng) {
    if (!persona || !persona.openings.length) return null;
    if (String(startFen || START).split(' ').slice(0, 4).join(' ') !== START.split(' ').slice(0, 4).join(' ')) return null;
    const played = (history || []).map(san => san.replace(/[+#?!]+$/, ''));
    const side = played.length % 2 === 0 ? 'w' : 'b';
    const next = new Map();
    lines(persona.openings, side).forEach(line => {
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
    renderTag(current, custom);
  }

  // The opponent's name above the board, as on Chess.com.
  function renderTag(current, custom) {
    const bar = document.getElementById('captured-top');
    if (!bar) return;
    let tag = document.getElementById('opponent-tag');
    if (!tag) {
      tag = document.createElement('span');
      tag.id = 'opponent-tag';
      tag.className = 'opponent-tag';
      tag.innerHTML = '<span class="opponent-avatar opponent-avatar-sm" aria-hidden="true"></span><span class="opponent-tag-name"></span>';
      bar.insertBefore(tag, bar.firstChild);
    }
    const level = typeof coachEngineElo !== 'undefined' ? coachEngineElo : current.elo;
    const persona = custom ? PERSONAS[0] : current;
    tag.firstChild.textContent = persona.initial;
    tag.firstChild.dataset.opponent = persona.id;
    tag.lastChild.textContent = custom ? `Opponent · ${level}` : !current.elo ? `Coach · ${level}` : `${current.name} · ${current.elo}`;
    tag.setAttribute('title', custom || !current.elo ? 'Calibrated engine opponent' : `${current.name}: ${current.style}`);
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
    // Adaptive play changes the level without an input event.
    const value = document.getElementById('coach-strength-value');
    if (value && typeof MutationObserver !== 'undefined') new MutationObserver(() => setTimeout(render, 0)).observe(value, { childList: true, characterData: true, subtree: true });
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

  const api = { PERSONAS, LINE_SIDE, lineSide, byId, bookMove, coachBookMove, selected, choose, displayName, render };
  root.OpponentPersonas = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
  }
})(typeof window !== 'undefined' ? window : globalThis);
