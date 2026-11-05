// Activity calendar for Progress: twelve weeks of training days across
// reviewed Coach moves, drills, puzzles and finished games. It describes
// what was done, not what was learned. activityDays() and summarise() are
// pure so scripts/validate-activity.js can run them in Node.
(function(root) {
  'use strict';
  const WEEKS = 12;
  const DAY = 86400000;
  const KINDS = [
    { key: 'moves', one: 'reviewed move', many: 'reviewed moves' },
    { key: 'drills', one: 'drill attempt', many: 'drill attempts' },
    { key: 'puzzles', one: 'puzzle', many: 'puzzles' },
    { key: 'games', one: 'finished game', many: 'finished games' }
  ];

  function dayKey(time) {
    const d = new Date(time);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function startOfDay(time) {
    const d = new Date(time);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // sources: { moves: [times], drills: [times], puzzles: [times], games: [times] }
  function activityDays(sources, now) {
    const days = new Map();
    const oldestDate = new Date(startOfDay(now));
    oldestDate.setDate(oldestDate.getDate() - (WEEKS * 7 + 7));
    const oldest = oldestDate.getTime();
    KINDS.forEach(({ key }) => (sources[key] || []).forEach(time => {
      if (!Number.isFinite(time) || time < oldest || time > now + DAY) return;
      const k = dayKey(time);
      const row = days.get(k) || { moves: 0, drills: 0, puzzles: 0, games: 0, total: 0 };
      row[key]++;
      row.total++;
      days.set(k, row);
    }));
    return days;
  }

  function level(total) {
    return total <= 0 ? 0 : total < 5 ? 1 : total < 15 ? 2 : total < 30 ? 3 : 4;
  }

  // Weeks run Monday to Sunday; the last column holds this week.
  // All arithmetic is in calendar days (setDate), never fixed 24-hour
  // steps, so daylight-saving changes cannot shift or skip a day.
  function grid(now) {
    const todayKey = dayKey(now);
    const first = new Date(startOfDay(now));
    const weekday = (first.getDay() + 6) % 7; // Monday = 0
    first.setDate(first.getDate() - weekday - (WEEKS - 1) * 7);
    const cells = [];
    for (let w = 0; w < WEEKS; w++) {
      for (let d = 0; d < 7; d++) {
        const date = new Date(first);
        date.setDate(date.getDate() + w * 7 + d);
        const time = date.getTime();
        const key = dayKey(time);
        cells.push({ week: w, day: d, time, key, future: key > todayKey });
      }
    }
    return cells;
  }

  function summarise(days, now) {
    const today = startOfDay(now);
    const keyFor = offset => { const d = new Date(today); d.setDate(d.getDate() - offset); return dayKey(d.getTime()); };
    let last14 = 0;
    for (let i = 0; i < 14; i++) if (days.has(keyFor(i))) last14++;
    // A streak may end yesterday: today is not over yet.
    let streak = 0;
    let i = days.has(keyFor(0)) ? 0 : 1;
    while (days.has(keyFor(i))) { streak++; i++; }
    const totals = { moves: 0, drills: 0, puzzles: 0, games: 0 };
    let active = 0;
    const horizon = keyFor(WEEKS * 7 - 1);
    days.forEach((row, key) => {
      if (key < horizon) return;
      active++;
      KINDS.forEach(({ key: k }) => { totals[k] += row[k]; });
    });
    return { last14, streak, active, totals };
  }

  function describe(row) {
    if (!row) return 'No training';
    return KINDS.filter(k => row[k.key]).map(k => `${row[k.key]} ${row[k.key] === 1 ? k.one : k.many}`).join(', ');
  }

  // ── Browser ──────────────────────────────────
  function collect() {
    const sources = { moves: [], drills: [], puzzles: [], games: [] };
    try { if (typeof currentInsightEntries === 'function') sources.moves = currentInsightEntries().map(e => e.ts); } catch (e) { /* none */ }
    try { if (typeof loadPracticeProgress === 'function') sources.drills = loadPracticeProgress().events.map(e => e && e.at); } catch (e) { /* none */ }
    try { if (root.PuzzlesView && root.PuzzlesView.history) sources.puzzles = root.PuzzlesView.history().map(r => r.at); } catch (e) { /* none */ }
    try { if (root.GameArchive) sources.games = root.GameArchive.load().map(g => g.at); } catch (e) { /* none */ }
    return sources;
  }

  function render() {
    const panel = document.getElementById('panel-progress');
    if (!panel) return;
    let section = document.getElementById('activity-section');
    if (!section) {
      section = document.createElement('section');
      section.className = 'coach-panel-section activity-section';
      section.id = 'activity-section';
      section.setAttribute('aria-labelledby', 'activity-heading');
      section.innerHTML = '<div class="activity-head"><h3 class="section-label" id="activity-heading">Activity</h3><span class="activity-streak" id="activity-streak"></span></div>' +
        '<div class="activity-calendar" id="activity-calendar" role="img"></div><p class="activity-summary" id="activity-summary"></p>';
      const next = document.getElementById('progress-next-section');
      if (next && next.parentElement === panel) next.insertAdjacentElement('afterend', section);
      else panel.prepend(section);
    }
    const now = Date.now();
    const days = activityDays(collect(), now);
    const stats = summarise(days, now);
    const cal = document.getElementById('activity-calendar');
    cal.textContent = '';
    grid(now).forEach(cell => {
      const row = days.get(cell.key);
      const span = document.createElement('span');
      span.className = 'activity-cell level-' + (cell.future ? 'future' : level(row ? row.total : 0));
      span.style.gridColumn = String(cell.week + 1);
      span.style.gridRow = String(cell.day + 1);
      if (!cell.future) span.title = `${new Date(cell.time).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}: ${describe(row)}`;
      cal.appendChild(span);
    });
    const parts = [];
    if (stats.totals.moves) parts.push(`${stats.totals.moves} reviewed moves`);
    if (stats.totals.drills) parts.push(`${stats.totals.drills} drill attempts`);
    if (stats.totals.puzzles) parts.push(`${stats.totals.puzzles} puzzles`);
    if (stats.totals.games) parts.push(`${stats.totals.games} finished games`);
    const summary = stats.active
      ? `Trained on ${stats.last14} of the last 14 days. Twelve weeks: ${parts.join(', ')}.`
      : 'Your training days will appear here: reviewed moves, drills, puzzles and finished games.';
    document.getElementById('activity-summary').textContent = summary;
    cal.setAttribute('aria-label', `Training calendar, last ${WEEKS} weeks. ${summary}`);
    document.getElementById('activity-streak').textContent = stats.streak >= 2 ? `${stats.streak}-day streak` : '';
  }

  const api = { activityDays, summarise, grid, level, dayKey, render };
  root.TrainingActivity = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof document !== 'undefined') {
    const init = () => {
      render();
      const tab = document.getElementById('tab-progress');
      if (tab) tab.addEventListener('click', render);
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
