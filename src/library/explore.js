// Explore mode: Lichess token handling and the opening explorer API.
// Classic script loaded before the view scripts in src/views/ (see
// index.html); its top-level declarations are shared globals, as they were
// inside app.js.

// ─────────────────────────────────────────────
// EXPLORE MODE — LICHESS TOKEN + API
// ─────────────────────────────────────────────
const LICHESS_TOKEN_KEY = 'lichess_token';
const EXPLORE_CACHE_TTL_MS = 10 * 60 * 1000;
const EXPLORE_CACHE_MAX = 120;
const exploreCache = new Map();
try { localStorage.removeItem(LICHESS_TOKEN_KEY); } catch (e) { /* ignore */ }
function getLichessToken() {
  try { return sessionStorage.getItem(LICHESS_TOKEN_KEY); }
  catch (e) { return null; }
}
function setLichessToken(t) {
  try { sessionStorage.setItem(LICHESS_TOKEN_KEY, t); return true; }
  catch (e) { return false; }
}
function clearLichessToken() {
  try { sessionStorage.removeItem(LICHESS_TOKEN_KEY); } catch (e) { /* ignore */ }
  try { localStorage.removeItem(LICHESS_TOKEN_KEY); } catch (e) { /* ignore */ }
}

function showExploreTokenState() {
  if (getLichessToken()) {
    hideEl(byId('explore-token-setup'));
    const continuations = byId('explore-continuations');
    showEl(continuations);
    continuations.style.display = 'flex';
  } else {
    hideEl(byId('explore-continuations'));
    showEl(byId('explore-token-setup'));
  }
}

// Lichess answers 429 when a client sends too many requests and asks it to
// wait a minute; that is not a connection problem.
const LICHESS_RATE_LIMIT_MESSAGE = 'Lichess is limiting requests right now. Wait a minute, then try again.';

// GET a Lichess explorer endpoint with the player's token. Resolves with the
// parsed JSON. Rejects with an error whose status is the HTTP status (0 when
// the request never got an answer; a 2xx status when the body was not JSON).
async function lichessExplorerGet(url, params, token) {
  const fail = status => Object.assign(new Error('Lichess explorer request failed'), { status });
  let response;
  try {
    response = await fetch(url + '?' + new URLSearchParams(params), {
      headers: { 'Accept': 'application/json, text/javascript, */*; q=0.01', 'Authorization': 'Bearer ' + token }
    });
  } catch (e) {
    throw fail(0);
  }
  if (!response.ok) throw fail(response.status);
  try {
    return await response.json();
  } catch (e) {
    throw fail(response.status);
  }
}

function exploreCacheKey(db, fen) {
  return db + '|' + fen;
}

function getCachedExploreData(key) {
  const cached = exploreCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.time > EXPLORE_CACHE_TTL_MS) {
    exploreCache.delete(key);
    return null;
  }
  exploreCache.delete(key);
  exploreCache.set(key, cached);
  return cached.data;
}

function setCachedExploreData(key, data) {
  exploreCache.set(key, { time: Date.now(), data });
  while (exploreCache.size > EXPLORE_CACHE_MAX) {
    exploreCache.delete(exploreCache.keys().next().value);
  }
}

function fetchExploreData() {
  if (!exploreGame) return;
  const token = getLichessToken();
  if (!token) { showExploreTokenState(); return; }

  const fen = exploreGame.fen();
  const db = currentDb;
  const requestId = ++exploreRequestId;
  const cacheKey = exploreCacheKey(db, fen);
  const cached = getCachedExploreData(cacheKey);
  if (cached) {
    renderContinuations(cached, { cached: true });
    return;
  }
  const endpoint = db === 'masters'
    ? 'https://explorer.lichess.ovh/masters'
    : 'https://explorer.lichess.ovh/lichess';
  byId('continuations-list').innerHTML = '<div class="explore-loading">Fetching data…</div>';
  const stale = () => requestId !== exploreRequestId || !exploreMode || !exploreGame ||
    exploreGame.fen() !== fen || currentDb !== db;
  lichessExplorerGet(endpoint, { fen: fen, topGames: 0, recentGames: 0 }, token).then(data => {
    if (stale()) return;
    setCachedExploreData(cacheKey, data);
    renderContinuations(data);
  }, error => {
    if (stale()) return;
    if (error.status === 401) {
      clearLichessToken();
      exploreCache.clear();
      showExploreTokenState();
      const tokenError = byId('token-error');
      tokenError.textContent = 'Token invalid or expired — please reconnect.';
      showEl(tokenError);
    } else if (error.status === 429) {
      byId('continuations-list').replaceChildren(makeEl('div', 'explore-empty', LICHESS_RATE_LIMIT_MESSAGE));
    } else {
      byId('continuations-list').innerHTML = '<div class="explore-empty">Could not reach Lichess. Check your connection.</div>';
    }
  });
}

function renderContinuations(data, opts) {
  const list = byId('continuations-list');
  const totalPos = (Number(data.white) || 0) + (Number(data.draws) || 0) + (Number(data.black) || 0);

  if (!data.moves || data.moves.length === 0) {
    const msg = totalPos === 0
      ? 'No games found for this position.'
      : `${formatNum(totalPos)} total games — no further continuations recorded.`;
    list.innerHTML = `<div class="explore-empty">${msg}</div>`;
    return;
  }

  list.replaceChildren();
  const cacheNote = opts && opts.cached ? ' · cached' : '';
  list.append(makeEl('div', 'explore-total', `${formatNum(totalPos)} games from this position${cacheNote}`));
  data.moves.slice(0, 8).forEach(function(m) {
    const white = Number(m.white) || 0;
    const draws = Number(m.draws) || 0;
    const black = Number(m.black) || 0;
    const total = white + draws + black;
    if (total === 0) return;
    const wPct = Math.round(white / total * 100);
    const dPct = Math.round(draws / total * 100);
    const bPct = 100 - wPct - dPct;
    const san = String(m.san || '');
    const bar = makeEl('div', 'cont-bar');
    [['cont-bar-w', wPct], ['cont-bar-d', dPct], ['cont-bar-b', bPct]].forEach(([className, pct]) => {
      const segment = makeEl('div', className);
      segment.style.width = pct + '%';
      bar.append(segment);
    });
    const barWrap = makeEl('div', 'cont-bar-wrap');
    barWrap.append(bar, makeEl('div', 'cont-pct', `${wPct}% · ${dPct}% · ${bPct}%`));
    const row = makeEl('div', 'continuation-row');
    row.setAttribute('data-san', san);
    row.append(makeEl('div', 'cont-move', san), barWrap, makeEl('div', 'cont-games', formatNum(total)));
    list.append(row);
  });

  // Click a continuation to play it
  on(qsa('.continuation-row', list), 'click', function() {
    const san = this.getAttribute('data-san');
    if (exploreGame.move(san)) {
      board.position(exploreGame.fen());
      librarySyncLastMove(exploreGame);
      fetchExploreData();
    }
  });
}

function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return Math.round(n / 1000) + 'k';
  return n.toString();
}
