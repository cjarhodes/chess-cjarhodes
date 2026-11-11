// App shell: state and helpers shared by every view.
//
// Owns the current view (appView) and view switching (switchView, top
// nav), the route in the address bar (currentRoute, updateURL, applyRoute,
// restoreRoute), account and device-scoped storage state used by src/data
// and growth.js, board last-move marks, board and colour themes, the phone
// notice, board fitting for Library and Coach, the network banner, the
// promotion picker, dialog focus trapping and keyboard move parsing.
// Classic script (see index.html): its top-level declarations are shared
// globals with src/, the other view scripts, growth.js and the feature
// modules, as they were inside app.js. Nothing here runs at load except
// plain initialisers, so the view scripts can call each other freely.

// ─────────────────────────────────────────────
// SHARED STATE
// ─────────────────────────────────────────────
let appView = 'coach';             // 'library' | 'coach' — Coach is the product home
let pendingPromotionChoice = null;
let promotionReturnFocus = null;

// Account and sync state, read and written by src/data (account-sync,
// coach-persistence, practice-sync), growth.js and the Coach view.
let coachRemoteGameId = null;      // Supabase coach_games.id for current game
let coachRemoteGamePromise = null;
let coachRemoteGamePromiseGeneration = null;
let coachAuthUser = null;
let coachDbClient = null;
let coachDbInitStarted = false;
let coachDbInitPromise = null;
let coachRemoteInsightEntries = null;
let coachDbStatus = 'local';
let coachRemoteInsightsLoaded = false;
let coachAuthEventRevision = 0;
let coachAuthPhase = 'local'; // local | sending | callback | signed-in | signed-out | error
let remoteGameUpdateTimer = null;
let pendingRemoteGameEndReason = null;
let pendingRemoteGameGeneration = null;
let dailySprintSyncTimer = null;
let dailySprintSyncChain = Promise.resolve();
const REMOTE_GAME_SYNC_DEBOUNCE_MS = 2500;
const DAILY_SPRINT_SYNC_DEBOUNCE_MS = 800;

// All durable Coach memory is scoped to either the signed-in account or this
// browser's anonymous workspace. This prevents a second account on the same
// browser from inheriting the first account's insights, games, or statistics.
const COACH_DEVICE_KEY = 'coach:device-id:v1';
function coachDeviceId() {
  try {
    const existing = localStorage.getItem(COACH_DEVICE_KEY);
    if (existing) return existing;
    const id = createCoachGameId();
    localStorage.setItem(COACH_DEVICE_KEY, id);
    return id;
  } catch (e) {
    return 'volatile';
  }
}
function coachMemoryOwnerId() {
  return coachAuthUser && coachAuthUser.id ? `user:${coachAuthUser.id}` : `anon:${coachDeviceId()}`;
}
function coachMemoryKey(baseKey) {
  return `${baseKey}:${coachMemoryOwnerId()}`;
}
function migrateLegacyCoachMemory() {
  const legacyKeys = [
    'coach:insights:v1',
    'coach:lifetime:v1',
    'coach:state:v1',
    'coach:state:corrupt:v1'
  ];
  const anonOwner = coachMemoryOwnerId();
  try {
    legacyKeys.forEach(baseKey => {
      const scopedKey = `${baseKey}:${anonOwner}`;
      if (localStorage.getItem(scopedKey) || !localStorage.getItem(baseKey)) return;
      localStorage.setItem(scopedKey, localStorage.getItem(baseKey));
      localStorage.removeItem(baseKey);
    });
  } catch (e) { /* local progress remains best-effort if storage is blocked */ }
}

// Optional runtime config. Set these public Supabase values in the deployed
// page when account-backed coach history is ready. Without config, Coach stays
// local-first and uses the existing localStorage insights.
window.COACH_SUPABASE_CONFIG = window.COACH_SUPABASE_CONFIG || {
  url: '',
  publishableKey: ''
};

// ─────────────────────────────────────────────
// URL STATE
// ─────────────────────────────────────────────
// The route (src/ui/router.js) for what is on screen now.
function currentRoute() {
  const settings = window.SettingsSheet ? window.SettingsSheet.section() : null;
  if (appView === 'coach') return { view: 'coach', settings };
  if (appView === 'puzzles') {
    return { view: 'puzzles', mode: (window.PuzzlesView && window.PuzzlesView.urlMode()) || 'rated', settings };
  }
  return {
    view: 'library',
    opening: currentOpening ? currentOpening.id : null,
    line: currentOpening && currentLineId !== 'main' ? currentLineId : null,
    mode: quizMode ? 'quiz' : exploreMode ? 'explore' : 'study',
    move: currentOpening && currentMoveIdx >= 0 ? currentMoveIdx : null,
    settings
  };
}

// Called after anything that changes what the URL describes. A new place
// becomes a history entry; a study move or a Settings section rewrites the
// current one (routeHistoryAction in src/ui/router.js). A magic-link
// fragment is kept until the Supabase client has consumed it;
// clearCoachAuthUrlState removes it after.
function updateURL() {
  Router.commit(currentRoute());
}


// Put the app in the state a route describes. On load (initial) every
// view is switched to even if it is already the current one, because the
// switch is what builds it; after Back or Forward (restoreRoute) only what
// differs changes, so a game, drill or puzzle in progress is left as it is.
function applyRoute(route, opts) {
  const initial = !!(opts && opts.initial);
  if (route.view === 'puzzles') {
    if (window.PuzzlesView) window.PuzzlesView.selectMode(route.mode);
    if (initial || appView !== 'puzzles') switchView('puzzles');
  } else if (route.view === 'library') {
    const op = route.opening ? OPENINGS.find(o => o.id === route.opening) : null;
    if (route.opening && !op) {
      // An opening that no longer exists: the home view.
      switchView('coach');
    } else if (op) {
      const line = route.line || 'main';
      if (!currentOpening || currentOpening.id !== op.id) loadOpening(op.id, line);
      else {
        if (appView !== 'library') switchView('library');
        if (currentLineId !== line) switchOpeningLine(line);
      }
      const have = quizMode ? 'quiz' : exploreMode ? 'explore' : 'study';
      if (route.mode !== have) setMode(route.mode);
      if (route.mode === 'study') {
        const target = route.move === null || route.move === undefined ? -1 : route.move;
        if (currentMoveIdx !== target && (!initial || target >= 0)) goToMove(target);
      }
    } else {
      if (initial || appView !== 'library') switchView('library');
      clearOpening();
      const have = quizMode ? 'quiz' : exploreMode ? 'explore' : 'study';
      if (route.mode !== have) setMode(route.mode);
    }
  } else if (initial || appView !== 'coach') {
    // Coach is the app's home: make the default explicit so direct visits,
    // reloads, and clients with no prior URL state all start there.
    switchView('coach');
  }
  if (window.SettingsSheet) {
    if (route.settings) window.SettingsSheet.open(route.settings, { fromHistory: true });
    else window.SettingsSheet.close({ fromHistory: true });
  }
}

// Back / Forward (src/ui/router.js runs this without adding history).
function restoreRoute(route) {
  applyRoute(route);
  updateURL();
}

// ─────────────────────────────────────────────
// BOARDS: last-move marks, themes, accessibility, notice, fitting
// ─────────────────────────────────────────────
// Pieces: the cburnett vector set (Colin M.L. Burnett, CC BY-SA 3.0, as
// shipped by Lichess). Strong outlines and interior shading keep white pieces
// legible on light squares at every board size. The board draws them from
// vendor/pieces/cburnett/sprite.svg (scripts/build-piece-sprite.js).

// Last-move highlight, per board element id. The board keeps its marks
// across redraws; the move is remembered here so a rebuilt board (new game,
// new opening, retry) shows it again.
const boardLastMove = { myBoard: null, coachBoard: null };

function applyBoardLastMove(boardId) {
  const board = typeof Chessboard === 'function' && Chessboard.get ? Chessboard.get(boardId) : null;
  if (!board) return;
  const mv = boardLastMove[boardId];
  board.setMarks('last-move', mv ? [mv.from, mv.to] : []);
}

function setBoardLastMove(boardId, move) {
  boardLastMove[boardId] = move ? { from: move.from, to: move.to } : null;
  applyBoardLastMove(boardId);
}

// Call after building a board to show the remembered last move on it.
function restoreBoardLastMove(boardId) {
  applyBoardLastMove(boardId);
}

// Coach: highlight the move that produced the displayed position (live or
// while stepping through the review).
function coachSyncLastMove() {
  if (!coachGame) { setBoardLastMove('coachBoard', null); return; }
  const hist = coachGame.history({ verbose: true });
  const n = coachReviewCursor === null ? hist.length : coachReviewCursor;
  setBoardLastMove('coachBoard', n > 0 ? hist[n - 1] : null);
}

function librarySyncLastMove(gameObj) {
  const hist = gameObj ? gameObj.history({ verbose: true }) : [];
  setBoardLastMove('myBoard', hist.length ? hist[hist.length - 1] : null);
}

// Board colour themes, defined in styles/tokens.css. The keys are the values
// already saved under ui:board-theme: "green" is shown as Sage (the default),
// "blue" as Slate. The retired "ivory" theme falls back to walnut.
const BOARD_THEME_KEY = 'ui:board-theme';
const BOARD_THEMES = ['green', 'walnut', 'blue', 'contrast'];

function applyBoardTheme(name) {
  const theme = BOARD_THEMES.includes(name) ? name : (name === 'ivory' ? 'walnut' : 'green');
  document.documentElement.setAttribute('data-board-theme', theme);
  byId('board-theme').value = theme;
  try { localStorage.setItem(BOARD_THEME_KEY, theme); } catch (e) { /* preference stays for this page */ }
}

function initBoardTheme() {
  let saved = null;
  try { saved = localStorage.getItem(BOARD_THEME_KEY); } catch (e) { /* default */ }
  applyBoardTheme(saved || 'green');
  on(byId('board-theme'), 'change', function() { applyBoardTheme(this.value); });
}

// Light/dark follows the device unless the player picks one; theme-init.js
// applies the saved choice before first paint.
const COLOR_THEME_KEY = 'ui:theme';

function applyColorTheme(name) {
  const theme = name === 'light' || name === 'dark' ? name : 'auto';
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  byId('color-theme').value = theme;
  try {
    if (theme === 'auto') localStorage.removeItem(COLOR_THEME_KEY);
    else localStorage.setItem(COLOR_THEME_KEY, theme);
  } catch (e) { /* preference stays for this page */ }
}

function initColorTheme() {
  let saved = null;
  try { saved = localStorage.getItem(COLOR_THEME_KEY); } catch (e) { /* follow the device */ }
  applyColorTheme(saved);
  on(byId('color-theme'), 'change', function() { applyColorTheme(this.value); });
}

// Library uses the same viewport budget as Coach, including open move entry
// and quiz feedback. Both the width and actual tools determine board size.
let libraryBoardFitFrame = null;
function fitLibraryBoard() {
  const area = document.querySelector('#library-view .board-area');
  const view = document.getElementById('library-view');
  // The stacked (phone) layout sizes the board from the width in CSS.
  if (!area || !area.clientWidth || !area.clientHeight || layoutIsStacked()) return;
  const css = getComputedStyle(area);
  const children = Array.from(area.children).filter(el => el.id !== 'board-wrap' && getComputedStyle(el).display !== 'none');
  const gap = parseFloat(css.rowGap) || 0;
  const height = area.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom)
    - children.reduce((sum, el) => {
      const style = getComputedStyle(el);
      return sum + el.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    }, 0) - gap * children.length;
  const width = area.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  const size = Math.max(240, Math.floor((Math.min(760, width, height) - 4) / 8) * 8);
  if (view.style.getPropertyValue('--library-board-size') === size + 'px') return;
  view.style.setProperty('--library-board-size', size + 'px');
  if (board) board.resize();
}
function scheduleLibraryBoardFit() {
  if (libraryBoardFitFrame !== null) return;
  libraryBoardFitFrame = requestAnimationFrame(() => { libraryBoardFitFrame = null; fitLibraryBoard(); });
}
function initLibraryWorkspaceLayout() {
  const area = document.querySelector('#library-view .board-area');
  if (!area) return;
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleLibraryBoardFit);
    observer.observe(area);
    Array.from(area.children).filter(el => el.id !== 'board-wrap').forEach(el => observer.observe(el));
  }
  document.getElementById('library-keyboard-move').addEventListener('toggle', scheduleLibraryBoardFit);
  scheduleLibraryBoardFit();
}

// Fit the actual workspace, including expanded keyboard entry and live text.
// Container changes also occur without a window resize (for example practice).
let coachBoardFitFrame = null;
function fitCoachBoard() {
  const area = document.querySelector('.coach-board-area');
  const view = document.getElementById('coach-view');
  // The stacked (phone) layout sizes the board from the width in CSS.
  if (!area || !view || !area.clientWidth || !area.clientHeight || layoutIsStacked()) return;
  const css = getComputedStyle(area);
  const children = Array.from(area.children).filter(el => el.id !== 'coachBoard-wrap' && getComputedStyle(el).display !== 'none');
  const gap = parseFloat(css.rowGap) || 0;
  const height = area.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom)
    - children.reduce((sum, el) => {
      const style = getComputedStyle(el);
      return sum + el.getBoundingClientRect().height + (parseFloat(style.marginTop) || 0) + (parseFloat(style.marginBottom) || 0);
    }, 0) - gap * children.length;
  const width = area.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight);
  const size = Math.max(240, Math.floor((Math.min(760, width, height) - 4) / 8) * 8);
  if (view.style.getPropertyValue('--coach-board-size') === size + 'px') return;
  view.style.setProperty('--coach-board-size', size + 'px');
  if (coachBoard) coachBoard.resize();
}
function scheduleCoachBoardFit() {
  if (coachBoardFitFrame !== null) return;
  coachBoardFitFrame = requestAnimationFrame(() => { coachBoardFitFrame = null; fitCoachBoard(); });
}
function initCoachWorkspaceLayout() {
  const area = document.querySelector('.coach-board-area');
  if (!area) return;
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(scheduleCoachBoardFit);
    observer.observe(area);
    Array.from(area.children).filter(el => el.id !== 'coachBoard-wrap').forEach(el => observer.observe(el));
  }
  document.getElementById('coach-keyboard-move').addEventListener('toggle', renderCoachPresentation);
  renderCoachPresentation();
}

// ─────────────────────────────────────────────
// VIEW SWITCHING
// ─────────────────────────────────────────────
// Top navigation: Library | Coach | Puzzles. Exactly one tab is selected and
// focusable; the others stay reachable with the arrow keys.
const APP_VIEWS = ['library', 'coach', 'puzzles'];
function setNavSelection(view) {
  APP_VIEWS.forEach(name => {
    const active = name === view;
    const tab = byId('nav-' + name);
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
    tab.setAttribute('tabindex', active ? '0' : '-1');
  });
}

function switchView(view) {
  if (!APP_VIEWS.includes(view)) view = 'coach';
  const wasCoachMode = coachMode;
  const wasPuzzles = appView === 'puzzles';
  if (wasCoachMode && view !== 'coach') {
    // Leaving Coach must stop any pending engine reply and clear a transient
    // analysis line before the library view takes over.
    if (coachPracticeSession) {
      if (coachPracticeSession.grading || coachPracticeSession.pendingMove) {
        byId('coach-practice-status').textContent = 'That move was interrupted. Choose your move again.';
        byId('coach-keyboard-move-status').textContent = '';
      }
      saveCoachPracticeState();
    }
    invalidateCoachAsyncWork('Coach view changed.');
  }
  if (wasPuzzles && view !== 'puzzles' && window.PuzzlesView) window.PuzzlesView.hide();
  appView = view;
  coachMode = (view === 'coach');
  const library = qsa('.app');
  const coach = byId('coach-view');
  const puzzles = byId('puzzles-view');
  // Hidden views are display:none and aria-hidden; Coach and Puzzles show as grids.
  const setShown = (els, shown, display) => domList(els).forEach(el => {
    if (shown) showEl(el); else hideEl(el);
    if (shown && display) el.style.display = display;
    el.setAttribute('aria-hidden', shown ? 'false' : 'true');
  });
  setNavSelection(view);
  if (view === 'puzzles') {
    setShown(library, false);
    setShown(coach, false);
    setShown(puzzles, true, 'grid');
    if (window.PuzzlesView) window.PuzzlesView.show();
    updateURL();
    return;
  }
  setShown(puzzles, false);
  if (view === 'coach') {
    setShown(library, false);
    setShown(coach, true, 'grid');
    // Pre-warm Stockfish in the background so the first New Game starts faster.
    // Errors here are swallowed; the real load gate is inside startCoachGame.
    if (engineClient.status === 'idle') { engineClient.init().catch(() => {}); }
    // Initialize strength display
    byId('coach-strength-value').textContent = coachEngineElo;
    byId('coach-strength-tier').textContent = strengthTierLabel(coachEngineElo);
    renderCoachAuth();
    // Show lifetime stats if any are recorded.
    renderLifetime();
    renderInsights();
    if (!coachGame || coachPendingReview) {
      // Try to restore an in-progress (or just-ended) game from localStorage.
      const practice = tryRestoreCoachPractice();
      const restore = practice.restored ? practice : tryRestoreCoachGame();
      if (!restore.restored && practice.warning) restore.warning = practice.warning;
      if (restore.restored && practice.warning) setCoachStatus(practice.warning + ' Your saved game is restored.');
      if (!restore.restored) {
        byId('coach-view').classList.remove('game-active');
        // Show an idle board so the user has visual context
        hideEl(byId('coachBoard-placeholder'));
        createCoachBoard('start', 'white');
        setCoachStatus(restore.warning || 'Choose Start training when you’re ready.');
      }
    } else {
      // A view change cancels transient engine work. Restore the displayed
      // position from the actual session before accepting another move.
      if (coachPracticeSession) {
        resumeCoachPracticeAfterNavigation();
      } else {
        const fen = coachReviewCursor === null ? coachGame.fen() : coachFenAtPly(coachReviewCursor);
        if (coachBoard && fen) coachBoard.position(fen, false);
        coachSyncLastMove();
        updateCapturedDisplay(fen);
        updateCoachBoardAccessibility();
        if (coachIsReviewing()) {
          if (coachGameActive && !coachIsUserTurn() && !coachGame.game_over()) coachOpponentRespond();
          CoachController.setPhase('reviewing');
          setCoachStatus('Reviewing an earlier position. Choose Live to return.');
        } else if (coachGameActive && !coachIsUserTurn() && !coachGame.game_over()) {
          coachOpponentRespond();
        } else {
          CoachController.setPhase(coachGameActive ? 'userTurn' : 'ended');
          setCoachStatus(coachGameActive ? 'Your move.' : coachLastEndMsg || 'Choose Start training when you’re ready.');
        }
      }
      if (coachBoard) setTimeout(() => coachBoard.resize(), 0);
    }
    updateCoachControlsState();
  } else {
    setShown(coach, false);
    setShown(library, true);
    // If library board exists, kick it into life via a resize so it redraws correctly
    if (board) setTimeout(() => board.resize(), 0);
    scheduleLibraryBoardFit();
  }
  updateURL();
}

function updateNetworkStatus(announce) {
  const status = byId('network-status');
  if (!status) return;
  if (navigator.onLine) {
    if (announce) {
      status.hidden = false;
      status.classList.remove('offline');
      status.textContent = 'Back online — local progress will sync when available.';
      clearTimeout(updateNetworkStatus.onlineTimer);
      updateNetworkStatus.onlineTimer = setTimeout(() => { status.hidden = true; }, 4500);
    } else {
      status.hidden = true;
      status.textContent = '';
    }
  } else {
    clearTimeout(updateNetworkStatus.onlineTimer);
    status.hidden = false;
    status.classList.add('offline');
    status.textContent = 'Offline mode — your Coach progress is saved locally and will sync when you reconnect.';
  }
}

function isValidFen(fen) {
  try {
    const g = new Chess();
    return g.load(fen);
  } catch (e) { return false; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function reachesPromotionRank(gameObj, source, target) {
  if (!gameObj || !source || !target) return false;
  const piece = gameObj.get(source);
  if (!piece || piece.type !== 'p') return false;
  return (piece.color === 'w' && target[1] === '8') ||
         (piece.color === 'b' && target[1] === '1');
}

function isLegalPromotionMove(gameObj, source, target) {
  if (!reachesPromotionRank(gameObj, source, target)) return false;
  return gameObj.moves({ verbose: true }).some(m => m.from === source && m.to === target && m.promotion);
}

function resolveAccessibleMove(gameObj, rawMove) {
  if (!gameObj) return null;
  const value = String(rawMove || '').trim();
  if (!value) return null;
  const legalMoves = gameObj.moves({ verbose: true });
  const uci = value.toLowerCase().match(/^([a-h][1-8])([a-h][1-8])([qrbn])?$/);
  if (uci) {
    return legalMoves.find(move => move.from === uci[1] && move.to === uci[2] &&
      (!move.promotion || (uci[3] || 'q') === move.promotion)) || null;
  }
  // Case matters in SAN (Bxc3 is the bishop, bxc3 the pawn): an exact match
  // wins, and a case-insensitive one is accepted only when it is unique.
  const bare = san => san.replace(/\s+/g, '').replace(/[+#?!]+$/, '');
  const typed = bare(value);
  const exact = legalMoves.find(move => bare(move.san) === typed);
  if (exact) return exact;
  const loose = legalMoves.filter(move => bare(move.san).toLowerCase() === typed.toLowerCase());
  return loose.length === 1 ? loose[0] : null;
}

function focusableElements(container) {
  return Array.from(container.querySelectorAll(
    'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => !el.hidden && el.getClientRects().length > 0);
}

function trapDialogTab(event, container) {
  if (event.key !== 'Tab') return;
  const focusable = focusableElements(container);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function showPromotionPicker(color, onPick) {
  const glyphs = color === 'b'
    ? { q: '♛', r: '♜', b: '♝', n: '♞' }
    : { q: '♕', r: '♖', b: '♗', n: '♘' };
  pendingPromotionChoice = onPick;
  promotionReturnFocus = document.activeElement;
  qsa('#promotion-picker .promotion-choice').forEach(choice => {
    const piece = choice.getAttribute('data-promotion');
    choice.textContent = glyphs[piece] || piece.toUpperCase();
  });
  const picker = byId('promotion-picker');
  picker.style.display = 'flex';
  picker.setAttribute('aria-hidden', 'false');
  qsa('#promotion-picker .promotion-choice[data-promotion="q"]').forEach(el => el.focus());
}

function closePromotionPicker() {
  pendingPromotionChoice = null;
  const picker = byId('promotion-picker');
  hideEl(picker);
  picker.setAttribute('aria-hidden', 'true');
  if (promotionReturnFocus && typeof promotionReturnFocus.focus === 'function') {
    promotionReturnFocus.focus();
  }
  promotionReturnFocus = null;
}

function requestPromotionChoice(gameObj, source, target, onPick, legalOnly) {
  const shouldAsk = legalOnly
    ? isLegalPromotionMove(gameObj, source, target)
    : reachesPromotionRank(gameObj, source, target);
  if (!shouldAsk) return false;
  const piece = gameObj.get(source);
  showPromotionPicker(piece ? piece.color : 'w', onPick);
  return true;
}
