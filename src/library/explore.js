// Explore mode: Lichess token handling and the opening explorer API.
// Classic script loaded before app.js (see index.html); its top-level
// declarations are shared globals, as they were inside app.js.

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
    $('#explore-token-setup').hide();
    $('#explore-continuations').show().css('display', 'flex');
  } else {
    $('#explore-continuations').hide();
    $('#explore-token-setup').show();
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
  $('#continuations-list').html('<div class="explore-loading">Fetching data…</div>');
  $.ajax({
    url: endpoint,
    data: { fen: fen, topGames: 0, recentGames: 0 },
    dataType: 'json',
    headers: { 'Authorization': 'Bearer ' + token },
    success: function(data) {
      if (requestId !== exploreRequestId || !exploreMode || !exploreGame ||
          exploreGame.fen() !== fen || currentDb !== db) {
        return;
      }
      setCachedExploreData(cacheKey, data);
      renderContinuations(data);
    },
    error: function(xhr) {
      if (requestId !== exploreRequestId || !exploreMode || !exploreGame ||
          exploreGame.fen() !== fen || currentDb !== db) {
        return;
      }
      if (xhr.status === 401) {
        clearLichessToken();
        exploreCache.clear();
        showExploreTokenState();
        $('#token-error').text('Token invalid or expired — please reconnect.').show();
      } else {
        $('#continuations-list').html('<div class="explore-empty">Could not reach Lichess. Check your connection.</div>');
      }
    }
  });
}

function renderContinuations(data, opts) {
  const list = $('#continuations-list');
  const totalPos = (Number(data.white) || 0) + (Number(data.draws) || 0) + (Number(data.black) || 0);

  if (!data.moves || data.moves.length === 0) {
    const msg = totalPos === 0
      ? 'No games found for this position.'
      : `${formatNum(totalPos)} total games — no further continuations recorded.`;
    list.html(`<div class="explore-empty">${msg}</div>`);
    return;
  }

  list.empty();
  const cacheNote = opts && opts.cached ? ' · cached' : '';
  list.append($('<div class="explore-total"></div>').text(`${formatNum(totalPos)} games from this position${cacheNote}`));
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
    const $bar = $('<div class="cont-bar"></div>')
      .append($('<div class="cont-bar-w"></div>').css('width', wPct + '%'))
      .append($('<div class="cont-bar-d"></div>').css('width', dPct + '%'))
      .append($('<div class="cont-bar-b"></div>').css('width', bPct + '%'));
    const $row = $('<div class="continuation-row"></div>')
      .attr('data-san', san)
      .append($('<div class="cont-move"></div>').text(san))
      .append($('<div class="cont-bar-wrap"></div>')
        .append($bar)
        .append($('<div class="cont-pct"></div>').text(`${wPct}% · ${dPct}% · ${bPct}%`)))
      .append($('<div class="cont-games"></div>').text(formatNum(total)));
    list.append($row);
  });

  // Click a continuation to play it
  list.find('.continuation-row').on('click', function() {
    const san = $(this).attr('data-san');
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
