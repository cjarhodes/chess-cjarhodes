// Coach dashboard rendering: daily plan, practice queue, theory cards, insights.
// Classic script loaded before the view scripts in src/views/ (see
// index.html); its top-level declarations are shared globals, as they were
// inside app.js.

function renderCoachDailyPlan(queue, due, totals, entries) {
  const items = Array.isArray(queue) ? queue : Array.from(renderedPracticeItems.values());
  const dueItems = Array.isArray(due) ? due : items.filter(item => practiceIsDue(item));
  const progress = totals || practiceProgressTotals();
  const action = byId('btn-coach-next-action');
  const setAction = (text, name) => {
    action.textContent = text;
    action.setAttribute('data-action', name);
  };
  settleSavedDailySprints();
  let sprint = dailySprintToday();
  if (sprint && !sprint.completedAt && !coachPracticeSession && !loadCoachPracticeState()) {
    if (sprint.mode === 'drills' && !dueItems.length) {
      sprint = updateDailySprint(day => upgradeLegacyDailySprint(day, renderedAdaptivePlan));
    }
    const recovered = recoverDailySprintPlan(sprint, dueItems.length);
    // Removing unavailable drills can leave the day's work already done.
    if (recovered !== sprint) sprint = updateDailySprint(() => settleDailySprintDay(recovered));
  }
  if (!sprint) renderedAdaptivePlan = adaptiveDailyPlan(entries || [], items, dueItems, progress);
  renderDailySprintChrome(sprint);

  if (coachPracticeSession) {
    const run = coachPracticeRun;
    setDailySprintProgress(run ? run.completed : Number(coachPracticeSession.completed), run ? run.items.length : 1, 'position');
    byId('coach-daily-plan-title').textContent = coachPracticeSession.completed ? 'Practice saved' : 'One decision at a time';
    byId('coach-daily-plan-detail').textContent = coachPracticeReturnState
      ? 'Your game is saved. You can return to it at any point.'
      : 'Play on the board or use Keyboard move below it. Hints build up one step at a time.';
    setAction('Return to the drill', 'continue');
    return;
  }

  if (sprint && sprint.completedAt) {
    setDailySprintProgress(sprint.target, sprint.target, dailySprintProgressUnit(sprint));
    byId('coach-daily-plan-title').textContent = '✓ Today’s training complete';
    const drills = sprint.drillsCompleted || 0;
    const moves = sprint.movesCompleted || 0;
    byId('coach-daily-plan-detail').textContent = sprint.mode === 'adaptive'
      ? `${drills ? `${drills} drill${drills === 1 ? '' : 's'} and ` : ''}${moves} reviewed moves saved. You can stop here. Review your progress, then return tomorrow for your next focus. Session completion measures activity, not proven improvement.`
      : 'You finished today’s sprint. You can stop here and review your progress. Come back tomorrow for a newly adaptive session.';
    setAction('Review today’s progress', 'progress');
    return;
  }


  if (sprint && sprint.mode === 'adaptive' && sprint.phase === 'drills') {
    setDailySprintProgress(sprint.completedUnits, sprint.target, 'step');
    const remaining = Math.max(0, sprint.drillTarget - (sprint.drillsCompleted || 0));
    byId('coach-daily-plan-title').textContent = `Continue rehearsing ${sprint.focus || 'today’s focus'}`;
    byId('coach-daily-plan-detail').textContent = `${remaining} focused drill${remaining === 1 ? '' : 's'} remain before live transfer play.`;
    setAction('Continue focused drills', 'practice');
    return;
  }

  if (sprint && sprint.mode === 'adaptive' && !sprint.focusTag) {
    setDailySprintProgress(sprint.completedUnits, sprint.target, dailySprintProgressUnit(sprint));
    const remaining = Math.max(0, sprint.moveTarget - (sprint.movesCompleted || 0));
    byId('coach-daily-plan-title').textContent = 'Build your baseline in play';
    byId('coach-daily-plan-detail').textContent = `${remaining} reviewed move${remaining === 1 ? '' : 's'} remain. Each move gets immediate Coach feedback.`;
    setAction(coachGameActive ? 'Return to the board' : 'Start training', coachGameActive ? 'continue' : 'game');
    return;
  }

  if (sprint && sprint.mode === 'adaptive') {
    setDailySprintProgress(sprint.completedUnits, sprint.target, dailySprintProgressUnit(sprint));
    const remaining = Math.max(0, sprint.moveTarget - (sprint.movesCompleted || 0));
    byId('coach-daily-plan-title').textContent = `Transfer ${sprint.focus || 'the lesson'} into play`;
    byId('coach-daily-plan-detail').textContent = `${remaining} reviewed move${remaining === 1 ? '' : 's'} remain. Use the focus cue before every move.`;
    setAction(coachGameActive ? 'Return to the board' : 'Start transfer game', coachGameActive ? 'continue' : 'game');
    return;
  }

  if (sprint && sprint.mode === 'moves') {
    setDailySprintProgress(sprint.completedUnits, sprint.target || DAILY_MOVE_TARGET, 'move');
    byId('coach-daily-plan-title').textContent = coachGameActive ? 'Daily Sprint in progress' : 'Continue your Daily Sprint';
    byId('coach-daily-plan-detail').textContent = `${Math.max(0, (sprint.target || DAILY_MOVE_TARGET) - sprint.completedUnits)} reviewed moves remain. Each move gets immediate Coach feedback.`;
    setAction(coachGameActive ? 'Return to the board' : 'Continue Daily Sprint', coachGameActive ? 'continue' : 'game');
    return;
  }

  if (coachGameActive && coachGame && !coachGame.game_over()) {
    setDailySprintProgress(coachStats ? coachStats.moves : 0, DAILY_MOVE_TARGET, 'move');
    byId('coach-daily-plan-title').textContent = 'Daily Sprint in progress';
    byId('coach-daily-plan-detail').textContent = 'Play ten reviewed moves. You can stop when the sprint is complete or keep playing the game.';
    setAction('Return to the board', 'continue');
    return;
  }

  if (dueItems.length && renderedAdaptivePlan.drillTarget > 0) {
    const plan = renderedAdaptivePlan;
    const target = plan.drillTarget + plan.moveTarget;
    setDailySprintProgress(0, target, 'step');
    byId('coach-daily-plan-title').textContent = `Train ${plan.focus}, then transfer`;
    byId('coach-daily-plan-detail').textContent = `${plan.drillTarget} focused drill${plan.drillTarget === 1 ? '' : 's'} → ${plan.moveTarget} reviewed game moves. Coach chose this from your recent errors and practice results.`;
    setAction('Start adaptive session', 'practice');
    return;
  }

  const returning = progress.attempts > 0 || items.length > 0 || (entries || []).length > 0;
  const plan = renderedAdaptivePlan;
  setDailySprintProgress(0, plan.moveTarget, 'move');
  byId('coach-daily-plan-title').textContent = plan.focusTag ? `Transfer ${plan.focus}` : 'Start your first coached session';
  byId('coach-daily-plan-detail').textContent = plan.focusTag
    ? `${plan.moveTarget} reviewed moves using one personalised cue. Coach will check whether the pattern returns.`
    : `Play ${plan.moveTarget} reviewed moves and Coach will choose your first training focus.`;
  setAction(returning ? 'Start focused game' : 'Start training', 'game');
}

function renderPracticeQueue(entries, counts) {
  const profiles = adaptiveFocusProfile(entries);
  const queue = distinctPracticeItems(prioritizeAdaptivePractice(practiceItemsForEntries(entries, counts), profiles));
  const section = byId('practice-section');
  const list = byId('practice-list');
  list.replaceChildren();
  const totals = practiceProgressTotals();
  renderedPracticeItems = new Map(queue.map(item => [item.id, item]));
  if (!queue.length) {
    if (!totals.attempts) {
      hideEl(section);
      renderCoachDailyPlan(queue, [], totals, entries);
      renderPracticeRecommendation();
      return;
    }
    byId('practice-count').textContent = '0 due';
    updatePracticeTabBadge(0);
    byId('practice-progress-attempts').textContent = totals.attempts;
    byId('practice-progress-success').textContent = Math.round(totals.correct / totals.attempts * 100) + '%';
    byId('practice-progress-mastered').textContent = totals.mastered;
    showEl(byId('practice-empty'));
    renderPracticeTrends();
    showEl(section);
    renderCoachDailyPlan(queue, [], totals, entries);
    renderPracticeRecommendation();
    return;
  }
  const due = queue.filter(item => practiceIsDue(item));
  renderCoachDailyPlan(queue, due, totals, entries);
  renderPracticeRecommendation();
  const successRate = totals.attempts ? Math.round(totals.correct / totals.attempts * 100) : null;
  byId('practice-count').textContent = `${due.length} due`;
  updatePracticeTabBadge(due.length);
  byId('practice-progress-attempts').textContent = totals.attempts;
  byId('practice-progress-success').textContent = successRate === null ? '—' : successRate + '%';
  byId('practice-progress-mastered').textContent = totals.mastered;
  renderPracticeTrends();
  toggleEl(byId('practice-empty'), due.length === 0);
  due.forEach(item => {
    const entry = item.entry;
    const meta = item.meta;
    const record = practiceRecordFor(item);
    const row = makeEl('div', 'practice-row');
    const button = makeEl('button', 'movelist-copy practice-load', record ? 'Review' : 'Practice');
    button.type = 'button';
    button.setAttribute('data-practice-id', item.id);
    row.append(makeEl('div', 'practice-title', meta.title));
    row.append(button);
    row.append(makeEl('div', 'practice-detail', `${formatPracticeContext(entry)} ${formatPracticeDue(record)}.`));
    list.append(row);
  });
  showEl(section);
  markActivePracticeRow();
}

function renderTheoryCards(entries, counts) {
  const list = byId('theory-list');
  list.replaceChildren();
  const addCard = (title, body) => {
    const card = makeEl('div', 'theory-card');
    card.append(makeEl('div', 'theory-title', title));
    card.append(makeEl('div', 'theory-body', body));
    list.append(card);
  };
  const used = new Set();
  (counts || []).slice(0, 4).forEach(item => {
    if (!INSIGHT_TAG_META[item.tag] || used.has(item.tag)) return;
    used.add(item.tag);
    const meta = INSIGHT_TAG_META[item.tag];
    addCard(meta.title, meta.theory);
  });
  if (!used.size && entries && entries.length) {
    addCard('Candidate move selection', INSIGHT_TAG_META.candidate_moves.theory);
  }
  toggleEl(byId('theory-section'), list.children.length > 0);
}

function currentInsightEntries() {
  const local = loadInsights().entries;
  const remote = coachAuthUser && coachRemoteInsightsLoaded ? (coachRemoteInsightEntries || []) : [];
  const ids = new Set(remote.map(entry => entry.id).filter(Boolean));
  const moves = new Set(remote.filter(entry => entry.gameId).map(entry => `${entry.gameId}|${entry.ply}`));
  return reviewedProgressEntries(remote.concat(local.filter(entry =>
    !(entry.id && ids.has(entry.id)) && !(entry.gameId && moves.has(`${entry.gameId}|${entry.ply}`)))));
}

function renderInsights() {
  const usingRemote = !!coachAuthUser && coachRemoteInsightsLoaded;
  const entries = currentInsightEntries();
  renderRecurringMistakeDashboard(entries);
  const section = byId('insights-section');
  if (!entries.length) {
    hideEl(section);
    renderPracticeQueue([], []);
    if (typeof renderWeeklyReview === 'function') renderWeeklyReview(entries);
    hideEl(byId('theory-section'));
    return;
  }

  const problemEntries = entries.filter(e => isInsightProblem(e.tier));
  const counts = insightTagCounts(problemEntries);
  const weakPhase = weakestInsightPhase(problemEntries);
  showEl(section);
  byId('insights-moves').textContent = entries.length;
  byId('insights-errors').textContent = counts.length;
  byId('insights-phase').textContent = weakPhase ? weakPhase.label : '-';

  const list = byId('insights-list');
  list.replaceChildren();
  const theoryList = byId('insights-theory');
  theoryList.replaceChildren();

  if (!counts.length) {
    byId('insights-primary-title').textContent = 'No repeated problem yet';
    byId('insights-primary-detail').textContent = usingRemote
      ? 'Account history is syncing clean reviewed moves. The pattern view will sharpen once it sees inaccuracies, mistakes, or blunders.'
      : 'Coach mode is storing your reviewed moves locally. The pattern view will sharpen once it sees inaccuracies, mistakes, or blunders.';
    list.append(makeEl('div', 'insight-empty', 'Current sample is clean. Keep playing enough moves to build a useful baseline.'));
    renderPracticeQueue(problemEntries, counts);
    renderTheoryCards(problemEntries, counts);
    if (typeof renderWeeklyReview === 'function') renderWeeklyReview(entries);
    return;
  }

  const top = counts[0];
  const topMeta = INSIGHT_TAG_META[top.tag];
  byId('insights-primary-title').textContent = topMeta.title;
  byId('insights-primary-detail').textContent = `${top.count} saved occurrence${top.count === 1 ? '' : 's'}. Practice next: ${topMeta.practice}`;

  counts.slice(0, 3).forEach(item => {
    const meta = INSIGHT_TAG_META[item.tag];
    const row = makeEl('div', 'insight-row');
    row.append(makeEl('span', 'name', meta.title));
    row.append(makeEl('span', 'count', `${item.count}x`));
    row.append(makeEl('div', 'example', formatInsightExample(item.latest)));
    list.append(row);
  });

  const usedTheory = new Set();
  counts.slice(0, 3).forEach(item => {
    const theory = INSIGHT_TAG_META[item.tag].theory;
    if (usedTheory.has(theory)) return;
    usedTheory.add(theory);
    theoryList.append(makeEl('div', 'insight-theory-item', theory));
  });
  renderPracticeQueue(problemEntries, counts);
  renderTheoryCards(problemEntries, counts);
  if (typeof renderWeeklyReview === 'function') renderWeeklyReview(entries);
}
