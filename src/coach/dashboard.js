// Coach dashboard rendering: daily plan, practice queue, theory cards, insights.
// Classic script loaded before the view scripts in src/views/ (see
// index.html); its top-level declarations are shared globals, as they were
// inside app.js.

function renderCoachDailyPlan(queue, due, totals, entries) {
  const items = Array.isArray(queue) ? queue : Array.from(renderedPracticeItems.values());
  const dueItems = Array.isArray(due) ? due : items.filter(item => practiceIsDue(item));
  const progress = totals || practiceProgressTotals();
  const $action = $('#btn-coach-next-action');
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
    $('#coach-daily-plan-title').text(coachPracticeSession.completed ? 'Practice saved' : 'One decision at a time');
    $('#coach-daily-plan-detail').text(coachPracticeReturnState
      ? 'Your game is saved. You can return to it at any point.'
      : 'Play on the board or use Keyboard move below it. Hints build up one step at a time.');
    $action.text('Return to the drill').attr('data-action', 'continue');
    return;
  }

  if (sprint && sprint.completedAt) {
    setDailySprintProgress(sprint.target, sprint.target, dailySprintProgressUnit(sprint));
    $('#coach-daily-plan-title').text('✓ Today’s training complete');
    const drills = sprint.drillsCompleted || 0;
    const moves = sprint.movesCompleted || 0;
    $('#coach-daily-plan-detail').text(sprint.mode === 'adaptive'
      ? `${drills ? `${drills} drill${drills === 1 ? '' : 's'} and ` : ''}${moves} reviewed moves saved. You can stop here. Review your progress, then return tomorrow for your next focus. Session completion measures activity, not proven improvement.`
      : 'You finished today’s sprint. You can stop here and review your progress. Come back tomorrow for a newly adaptive session.');
    $action
      .text('Review today’s progress')
      .attr('data-action', 'progress');
    return;
  }


  if (sprint && sprint.mode === 'adaptive' && sprint.phase === 'drills') {
    setDailySprintProgress(sprint.completedUnits, sprint.target, 'step');
    const remaining = Math.max(0, sprint.drillTarget - (sprint.drillsCompleted || 0));
    $('#coach-daily-plan-title').text(`Continue rehearsing ${sprint.focus || 'today’s focus'}`);
    $('#coach-daily-plan-detail').text(`${remaining} focused drill${remaining === 1 ? '' : 's'} remain before live transfer play.`);
    $action.text('Continue focused drills').attr('data-action', 'practice');
    return;
  }

  if (sprint && sprint.mode === 'adaptive' && !sprint.focusTag) {
    setDailySprintProgress(sprint.completedUnits, sprint.target, dailySprintProgressUnit(sprint));
    const remaining = Math.max(0, sprint.moveTarget - (sprint.movesCompleted || 0));
    $('#coach-daily-plan-title').text('Build your baseline in play');
    $('#coach-daily-plan-detail').text(`${remaining} reviewed move${remaining === 1 ? '' : 's'} remain. Each move gets immediate Coach feedback.`);
    $action.text(coachGameActive ? 'Return to the board' : 'Start training').attr('data-action', coachGameActive ? 'continue' : 'game');
    return;
  }

  if (sprint && sprint.mode === 'adaptive') {
    setDailySprintProgress(sprint.completedUnits, sprint.target, dailySprintProgressUnit(sprint));
    const remaining = Math.max(0, sprint.moveTarget - (sprint.movesCompleted || 0));
    $('#coach-daily-plan-title').text(`Transfer ${sprint.focus || 'the lesson'} into play`);
    $('#coach-daily-plan-detail').text(`${remaining} reviewed move${remaining === 1 ? '' : 's'} remain. Use the focus cue before every move.`);
    $action.text(coachGameActive ? 'Return to the board' : 'Start transfer game').attr('data-action', coachGameActive ? 'continue' : 'game');
    return;
  }

  if (sprint && sprint.mode === 'moves') {
    setDailySprintProgress(sprint.completedUnits, sprint.target || DAILY_MOVE_TARGET, 'move');
    $('#coach-daily-plan-title').text(coachGameActive ? 'Daily Sprint in progress' : 'Continue your Daily Sprint');
    $('#coach-daily-plan-detail').text(`${Math.max(0, (sprint.target || DAILY_MOVE_TARGET) - sprint.completedUnits)} reviewed moves remain. Each move gets immediate Coach feedback.`);
    $action.text(coachGameActive ? 'Return to the board' : 'Continue Daily Sprint').attr('data-action', coachGameActive ? 'continue' : 'game');
    return;
  }

  if (coachGameActive && coachGame && !coachGame.game_over()) {
    setDailySprintProgress(coachStats ? coachStats.moves : 0, DAILY_MOVE_TARGET, 'move');
    $('#coach-daily-plan-title').text('Daily Sprint in progress');
    $('#coach-daily-plan-detail').text('Play ten reviewed moves. You can stop when the sprint is complete or keep playing the game.');
    $action.text('Return to the board').attr('data-action', 'continue');
    return;
  }

  if (dueItems.length && renderedAdaptivePlan.drillTarget > 0) {
    const plan = renderedAdaptivePlan;
    const target = plan.drillTarget + plan.moveTarget;
    setDailySprintProgress(0, target, 'step');
    $('#coach-daily-plan-title').text(`Train ${plan.focus}, then transfer`);
    $('#coach-daily-plan-detail').text(`${plan.drillTarget} focused drill${plan.drillTarget === 1 ? '' : 's'} → ${plan.moveTarget} reviewed game moves. Coach chose this from your recent errors and practice results.`);
    $action
      .text('Start adaptive session')
      .attr('data-action', 'practice');
    return;
  }

  const returning = progress.attempts > 0 || items.length > 0 || (entries || []).length > 0;
  const plan = renderedAdaptivePlan;
  setDailySprintProgress(0, plan.moveTarget, 'move');
  $('#coach-daily-plan-title').text(plan.focusTag ? `Transfer ${plan.focus}` : 'Start your first coached session');
  $('#coach-daily-plan-detail').text(plan.focusTag
    ? `${plan.moveTarget} reviewed moves using one personalised cue. Coach will check whether the pattern returns.`
    : `Play ${plan.moveTarget} reviewed moves and Coach will choose your first training focus.`);
  $action.text(returning ? 'Start focused game' : 'Start training').attr('data-action', 'game');
}

function renderPracticeQueue(entries, counts) {
  const profiles = adaptiveFocusProfile(entries);
  const queue = distinctPracticeItems(prioritizeAdaptivePractice(practiceItemsForEntries(entries, counts), profiles));
  const $section = $('#practice-section');
  const $list = $('#practice-list').empty();
  const totals = practiceProgressTotals();
  renderedPracticeItems = new Map(queue.map(item => [item.id, item]));
  if (!queue.length) {
    if (!totals.attempts) {
      $section.hide();
      renderCoachDailyPlan(queue, [], totals, entries);
      renderPracticeRecommendation();
      return;
    }
    $('#practice-count').text('0 due');
    updatePracticeTabBadge(0);
    $('#practice-progress-attempts').text(totals.attempts);
    $('#practice-progress-success').text(Math.round(totals.correct / totals.attempts * 100) + '%');
    $('#practice-progress-mastered').text(totals.mastered);
    $('#practice-empty').show();
    renderPracticeTrends();
    $section.show();
    renderCoachDailyPlan(queue, [], totals, entries);
    renderPracticeRecommendation();
    return;
  }
  const due = queue.filter(item => practiceIsDue(item));
  renderCoachDailyPlan(queue, due, totals, entries);
  renderPracticeRecommendation();
  const successRate = totals.attempts ? Math.round(totals.correct / totals.attempts * 100) : null;
  $('#practice-count').text(`${due.length} due`);
  updatePracticeTabBadge(due.length);
  $('#practice-progress-attempts').text(totals.attempts);
  $('#practice-progress-success').text(successRate === null ? '—' : successRate + '%');
  $('#practice-progress-mastered').text(totals.mastered);
  renderPracticeTrends();
  $('#practice-empty').toggle(due.length === 0);
  due.forEach(item => {
    const entry = item.entry;
    const meta = item.meta;
    const record = practiceRecordFor(item);
    const $row = $('<div class="practice-row"></div>');
    const $title = $('<div class="practice-title"></div>').text(meta.title);
    const $button = $('<button type="button" class="movelist-copy practice-load"></button>')
      .text(record ? 'Review' : 'Practice')
      .attr('data-practice-id', item.id);
    $row.append($title);
    $row.append($button);
    $row.append($('<div class="practice-detail"></div>').text(`${formatPracticeContext(entry)} ${formatPracticeDue(record)}.`));
    $list.append($row);
  });
  $section.show();
  markActivePracticeRow();
}

function renderTheoryCards(entries, counts) {
  const $section = $('#theory-section');
  const $list = $('#theory-list').empty();
  const used = new Set();
  (counts || []).slice(0, 4).forEach(item => {
    if (!INSIGHT_TAG_META[item.tag] || used.has(item.tag)) return;
    used.add(item.tag);
    const meta = INSIGHT_TAG_META[item.tag];
    const $card = $('<div class="theory-card"></div>');
    $card.append($('<div class="theory-title"></div>').text(meta.title));
    $card.append($('<div class="theory-body"></div>').text(meta.theory));
    $list.append($card);
  });
  if (!used.size && entries && entries.length) {
    const $card = $('<div class="theory-card"></div>');
    $card.append($('<div class="theory-title"></div>').text('Candidate move selection'));
    $card.append($('<div class="theory-body"></div>').text(INSIGHT_TAG_META.candidate_moves.theory));
    $list.append($card);
  }
  $section.toggle($list.children().length > 0);
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
  const $section = $('#insights-section');
  if (!entries.length) {
    $section.hide();
    renderPracticeQueue([], []);
    if (typeof renderWeeklyReview === 'function') renderWeeklyReview(entries);
    $('#theory-section').hide();
    return;
  }

  const problemEntries = entries.filter(e => isInsightProblem(e.tier));
  const counts = insightTagCounts(problemEntries);
  const weakPhase = weakestInsightPhase(problemEntries);
  $section.show();
  $('#insights-moves').text(entries.length);
  $('#insights-errors').text(counts.length);
  $('#insights-phase').text(weakPhase ? weakPhase.label : '-');

  const $list = $('#insights-list').empty();
  const $theory = $('#insights-theory').empty();

  if (!counts.length) {
    $('#insights-primary-title').text('No repeated problem yet');
    $('#insights-primary-detail').text(usingRemote
      ? 'Account history is syncing clean reviewed moves. The pattern view will sharpen once it sees inaccuracies, mistakes, or blunders.'
      : 'Coach mode is storing your reviewed moves locally. The pattern view will sharpen once it sees inaccuracies, mistakes, or blunders.');
    $list.append($('<div class="insight-empty"></div>').text('Current sample is clean. Keep playing enough moves to build a useful baseline.'));
    renderPracticeQueue(problemEntries, counts);
    renderTheoryCards(problemEntries, counts);
    if (typeof renderWeeklyReview === 'function') renderWeeklyReview(entries);
    return;
  }

  const top = counts[0];
  const topMeta = INSIGHT_TAG_META[top.tag];
  $('#insights-primary-title').text(topMeta.title);
  $('#insights-primary-detail').text(`${top.count} saved occurrence${top.count === 1 ? '' : 's'}. Practice next: ${topMeta.practice}`);

  counts.slice(0, 3).forEach(item => {
    const meta = INSIGHT_TAG_META[item.tag];
    const $row = $('<div class="insight-row"></div>');
    $row.append($('<span class="name"></span>').text(meta.title));
    $row.append($('<span class="count"></span>').text(`${item.count}x`));
    $row.append($('<div class="example"></div>').text(formatInsightExample(item.latest)));
    $list.append($row);
  });

  const usedTheory = new Set();
  counts.slice(0, 3).forEach(item => {
    const theory = INSIGHT_TAG_META[item.tag].theory;
    if (usedTheory.has(theory)) return;
    usedTheory.add(theory);
    $theory.append($('<div class="insight-theory-item"></div>').text(theory));
  });
  renderPracticeQueue(problemEntries, counts);
  renderTheoryCards(problemEntries, counts);
  if (typeof renderWeeklyReview === 'function') renderWeeklyReview(entries);
}
