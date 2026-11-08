// Import games by username: fetch recent games from the public Chess.com or
// Lichess APIs, review the user's moves with the same engine grading Coach
// uses, and keep the result in the game archive, where the viewer and
// "Retry this move" work as for Coach games. Like a pasted PGN (growth.js),
// a reviewed game counts toward Insights, the practice queue and the personal
// repertoire; unlike it, the live Coach game is left alone. Only the username
// leaves this device; the review runs here.
(function() {
  'use strict';
  const Core = window.GameImportCore;
  const PREF = 'ui:import:v1';
  const RETRIES = 20;
  const COUNTED = 'coach:import:counted:v1';   // games already in the personal repertoire
  const SHARE = 150;                          // most Insights entries imported games may hold
  let found = [];          // games listed from the last search
  let running = null;      // { id, stop }

  function pref() {
    try { const p = JSON.parse(localStorage.getItem(PREF)); return p && Core.SOURCES[p.source] ? p : { source: 'chesscom', username: '' }; } catch (e) { return { source: 'chesscom', username: '' }; }
  }
  function savePref(p) { try { localStorage.setItem(PREF, JSON.stringify(p)); } catch (e) { /* this page only */ } }
  function status(text) { const el = document.getElementById('game-import-status'); if (el) el.textContent = text; }

  // ── Fetching ──
  class ImportError extends Error {}
  async function getJson(url, label, init) {
    let res;
    try { res = await fetch(url, init); } catch (e) { throw new ImportError(`Could not reach ${label}. Check your connection and try again.`); }
    if (res.status === 404) throw new ImportError(`${label} has no player with that username.`);
    if (res.status === 429 || res.status === 403) throw new ImportError(`${label} is limiting requests right now. Try again in a minute.`);
    if (!res.ok) throw new ImportError(`${label} answered with an error (${res.status}). Try again later.`);
    return res;
  }

  async function fetchGames(source, username) {
    if (source === 'lichess') {
      const res = await getJson(Core.lichessUrl(username), 'Lichess', { headers: { Accept: 'application/x-ndjson' } });
      return Core.parseLichess(await res.text(), username).slice(0, Core.LIMIT);
    }
    const months = Core.latestArchives(await (await getJson(Core.archivesUrl(username), 'Chess.com')).json(), 2);
    let games = [];
    for (const url of months) {
      games = games.concat(Core.parseChessCom(await (await getJson(url, 'Chess.com')).json(), username));
      if (games.length >= Core.LIMIT) break;
    }
    return games.sort((a, b) => b.at - a.at).slice(0, Core.LIMIT);
  }

  // ── Reviewing ──
  function whiteCp(result, fenBefore) {
    const info = result && result.evalAfter;
    if (!info || result.tier === 'unknown') return null;
    const own = info.mate !== null && info.mate !== undefined ? (info.mate > 0 ? -10000 + info.mate : 10000 + info.mate) : -(info.cp || 0);
    return String(fenBefore).split(' ')[1] === 'w' ? own : -own;
  }

  async function classifyWithRetry(m) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await classifyMove(m.fenBefore, m.uci, m.fenAfter);
      } catch (err) {
        // Coach cancels the shared engine whenever its own position changes
        // (a new game, a take-back, switching view); that is not this
        // review's failure, so wait a moment and try the move again.
        if (running && running.stop) throw err;
        if (attempt >= RETRIES || !(typeof isAbortError === 'function' && isAbortError(err))) throw err;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }

  async function review(game, button) {
    if (running) return;
    if (typeof importedGameAnalysisActive !== 'undefined' && importedGameAnalysisActive) { status('A pasted PGN is being analysed. Wait for it to finish, then review this game.'); return; }
    const replay = Core.userMoves(Chess, game);
    if (!replay || !replay.moves.length) { status('This game could not be read, so it was not reviewed.'); return; }
    running = { id: game.id, stop: false };
    renderList();
    const reviews = [];
    const full = [];         // classifyMove results with their positions, for Insights
    const tallies = {};
    let scored = 0;
    try {
      for (let i = 0; i < replay.moves.length; i++) {
        if (running.stop) { status('Review stopped. Nothing was saved.'); return; }
        status(`Reviewing your moves: ${i + 1} of ${replay.moves.length}…`);
        const m = replay.moves[i];
        const r = await classifyWithRetry(m);
        full.push(Object.assign({}, r, { fenBefore: m.fenBefore, fenAfter: m.fenAfter, userUci: m.uci, userSan: r.userSan || m.san,
          previousCaptureSquare: m.previousCaptureSquare || null,
          // Move numbers come from the position, which matters for games
          // that started from a set-up position.
          ply: m.ply, pairNum: parseInt(m.fenBefore.split(' ')[5], 10) || Math.ceil(m.ply / 2), gameIndex: 1, localGameId: game.id, source: 'import' }));
        reviews.push({ ply: m.ply, tier: r.tier, flair: r.flair || null, userSan: r.userSan || m.san, bestSan: r.bestSan || '',
          bestUci: r.bestUci || '', userUci: m.uci, cp: whiteCp(r, m.fenBefore), loss: r.loss || 0 });
        if (r.tier && r.tier !== 'unknown') { tallies[r.tier] = (tallies[r.tier] || 0) + 1; scored++; }
      }
      const entry = {
        id: game.id, at: game.at, result: game.result, side: game.side, elo: game.opponentRating, startFen: game.startFen,
        pgn: replay.cleanPgn, accuracy: scored ? accuracyFromTallies(tallies, scored) : null, acpl: computeACPL(reviews),
        opening: game.opening, reviews, source: game.source, opponent: game.opponent, url: game.url, speed: game.speed
      };
      const saved = window.GameArchive.add(entry);
      if (saved === 'storage') { status('The review finished but could not be saved: this browser\'s storage is full or blocked.'); return; }
      if (saved === 'outside') { status(`This game is older than the ${window.GameArchive.LIMIT} imported games the archive keeps, so it was not saved. Delete older imported games in Progress to make room.`); return; }
      const counted = contribute(game, replay.cleanPgn, full);
      const unknown = reviews.length - scored;
      status(`Reviewed ${reviews.length} of your moves${unknown ? ` (${unknown} could not be graded)` : ''}. Saved in the game archive (Progress)` +
        (counted ? ' and counted in Insights.' : ', but Insights could not be updated in this browser.'));
      window.GameArchive.open(game.id, button && button.isConnected ? button : null);
    } catch (err) {
      status('The engine stopped before the review finished. Nothing was saved; try again.');
    } finally {
      running = null;
      renderList();
    }
  }

  // The same evidence a pasted PGN adds: graded moves go into Insights
  // (and so the practice queue), and the opening into the personal
  // repertoire. Entries are tied to this game, not to the live Coach game.
  function countedKey() { return typeof coachMemoryKey === 'function' ? coachMemoryKey(COUNTED) : COUNTED; }
  function countedIds() { try { const v = JSON.parse(localStorage.getItem(countedKey())); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  const isImported = e => /^(chesscom|lichess)-/.test(String(e && e.localGameId || ''));

  // Returns whether Insights were saved. Reviewing a game again (after
  // deleting it from the archive) replaces its entries instead of adding a
  // second set, and imported games may hold at most SHARE of the entries, so
  // they never push the user's own Coach evidence out.
  function contribute(game, pgn, full) {
    try {
      const parsed = new Chess();
      if (!parsed.load_pgn(pgn)) return false;
      // Opening names only mean something from the normal start position.
      const definition = game.startFen ? null : openingDefinitionForSans(parsed.history());
      const opening = (definition && definition.info.match ? definition.info.match.name : game.opening) || 'Imported game';
      const openingId = definition && definition.opening ? definition.opening.id : null;
      const state = loadInsights();
      state.entries = state.entries.filter(e => e.localGameId !== game.id);
      full.filter(r => r.tier !== 'unknown').forEach(r => {
        const e = insightEntryFromReview(Object.assign({}, r, { opening, openingId }));
        e.gameId = null;
        e.localGameId = game.id;
        e.openingId = openingId;
        state.entries.push(e);
      });
      let excess = state.entries.filter(isImported).length - SHARE;
      if (excess > 0) state.entries = state.entries.filter(e => !(isImported(e) && excess-- > 0));
      const saved = saveInsights(state);
      const counted = countedIds();
      if (definition && !counted.includes(game.id)) {
        recordImportedOpenings([parsed], game.side, full);
        try { localStorage.setItem(countedKey(), JSON.stringify(counted.concat(game.id).slice(-200))); } catch (e) { /* counted again next time */ }
      }
      if (typeof renderInsights === 'function') renderInsights();
      if (typeof renderCoachDailyPlan === 'function') renderCoachDailyPlan();
      return saved !== false;
    } catch (e) { return false; }
  }

  // ── UI ──
  function outcomeOf(game) {
    const win = game.result.match(/\b(White|Black) wins\b/);
    if (win) return win[1].toLowerCase() === game.side ? 'win' : 'loss';
    return 'draw';
  }
  function dateLabel(at) { return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }); }

  function renderList() {
    const ol = document.getElementById('game-import-list');
    if (!ol) return;
    ol.textContent = '';
    found.forEach(game => {
      const li = document.createElement('li');
      li.className = 'game-import-row';
      const result = outcomeOf(game);
      const info = document.createElement('span');
      info.className = 'game-import-info';
      info.innerHTML = '<span class="game-archive-result"></span><span class="game-import-meta"></span>';
      info.firstChild.textContent = result === 'win' ? 'Won' : result === 'loss' ? 'Lost' : 'Draw';
      info.firstChild.classList.add(result);
      const meta = [`${game.side === 'white' ? 'White' : 'Black'} vs ${game.opponent}${game.opponentRating ? ` (${game.opponentRating})` : ''}`, game.speed, dateLabel(game.at)].filter(Boolean).join(' · ');
      info.lastChild.textContent = meta;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ctrl-btn game-import-review';
      const done = window.GameArchive && window.GameArchive.has(game.id);
      const busy = running && running.id === game.id;
      btn.textContent = busy ? 'Stop' : done ? 'Open review' : 'Review';
      btn.disabled = !!running && !busy;
      btn.setAttribute('aria-label', `${btn.textContent}: ${info.firstChild.textContent}, ${meta}`);
      btn.addEventListener('click', () => {
        if (busy) { running.stop = true; return; }
        if (window.GameArchive.has(game.id)) window.GameArchive.open(game.id, btn);
        else review(game, btn);
      });
      li.appendChild(info);
      li.appendChild(btn);
      ol.appendChild(li);
    });
  }

  function setSource(source) {
    const p = pref();
    p.source = source;
    savePref(p);
    document.querySelectorAll('#game-import-sources button').forEach(b => b.setAttribute('aria-pressed', b.dataset.source === source ? 'true' : 'false'));
  }

  async function search(event) {
    event.preventDefault();
    if (running) return;
    const input = document.getElementById('game-import-user');
    const username = input.value.trim();
    if (!Core.validUsername(username)) { status('Enter a username: 2 to 30 letters, digits, - or _.'); input.focus(); return; }
    const source = pref().source;
    savePref({ source, username });
    const label = Core.SOURCES[source].label;
    const submit = document.getElementById('btn-game-import-find');
    submit.disabled = true;
    status(`Looking up ${username} on ${label}…`);
    try {
      found = await fetchGames(source, username);
      status(found.length ? `${found.length} recent game${found.length === 1 ? '' : 's'} on ${label}. Review one to see your accuracy and mistakes.`
        : source === 'chesscom' ? `No finished standard games by ${username} on Chess.com in the last two months.` : `No finished standard games by ${username} on Lichess.`);
    } catch (err) {
      found = [];
      status(err instanceof ImportError ? err.message : `Something went wrong reading ${label}'s answer. Try again later.`);
    } finally {
      submit.disabled = false;
      renderList();
    }
  }

  function build() {
    const card = document.getElementById('game-inbox-card');
    if (!card || document.getElementById('game-import-section') || !Core) return;
    const section = document.createElement('section');
    section.className = 'growth-card game-import';
    section.id = 'game-import-section';
    section.setAttribute('aria-labelledby', 'game-import-heading');
    section.innerHTML =
      '<h3 class="game-import-title" id="game-import-heading">From Chess.com or Lichess</h3>' +
      '<form class="game-import-form" id="game-import-form" novalidate>' +
      '<div class="game-import-sources" id="game-import-sources" role="group" aria-label="Site">' +
      '<button type="button" class="game-import-source" data-source="chesscom" aria-pressed="false">Chess.com</button>' +
      '<button type="button" class="game-import-source" data-source="lichess" aria-pressed="false">Lichess</button></div>' +
      '<div class="auth-row"><label class="sr-only" for="game-import-user">Username</label>' +
      '<input id="game-import-user" type="text" placeholder="Username" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="30">' +
      '<button type="submit" class="ctrl-btn" id="btn-game-import-find">Find games</button></div></form>' +
      '<div class="game-import-status" id="game-import-status" role="status" aria-live="polite"></div>' +
      '<ol class="game-import-list" id="game-import-list" aria-label="Recent games"></ol>' +
      '<p class="game-import-note">Only the username is sent, to the site\'s public game list. The review runs in this browser; reviewed games go into the game archive and count in Insights, like a pasted PGN.</p>';
    card.parentElement.insertBefore(section, card);
    const p = pref();
    document.getElementById('game-import-user').value = p.username || '';
    section.querySelectorAll('#game-import-sources button').forEach(b => b.addEventListener('click', () => setSource(b.dataset.source)));
    setSource(p.source);
    document.getElementById('game-import-form').addEventListener('submit', search);
  }

  window.GameImport = { review, _state: () => ({ found, running }) };
  const init = () => { if (window.GameArchive) window.GameArchive.render(); build(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
