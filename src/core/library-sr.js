// Library spaced repetition (SM-2 lite) for opening lines.
// Classic script loaded before the view scripts in src/views/ (see
// index.html); its top-level declarations are shared globals, as they were
// inside app.js.

// ─────────────────────────────────────────────
// SPACED REPETITION (SM-2 lite)
// ─────────────────────────────────────────────
const SR_KEY = 'chess_sr_v1';
const DAY_MS = 86400000;

function loadSR() {
  if (typeof loadSyncedLibrarySR === 'function') return loadSyncedLibrarySR();
  try { return JSON.parse(localStorage.getItem(SR_KEY)) || {}; }
  catch(e) { return {}; }
}
function saveSR(data) {
  if (typeof saveSyncedLibrarySR === 'function') return saveSyncedLibrarySR(data);
  try {
    localStorage.setItem(SR_KEY, JSON.stringify(data));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}
function getSRRecord(id) {
  const data = loadSR();
  return data[id] || null;
}
// Local midnight `days` calendar days after `ts`. Calendar arithmetic, not
// 24-hour steps, so a review is due on a day (as repertoire-core.js does) and
// a DST change never shifts it by an hour into the wrong day.
function srAddDays(ts, days) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}
// When the next review falls, in calendar days: 'now' once it is due,
// 'today' for a (legacy, timestamped) due time later today, else '3d'.
function srNextReviewLabel(due, now) {
  if (now === undefined) now = Date.now();
  if (!(due > now)) return 'now';
  const days = Math.round((srAddDays(due, 0) - srAddDays(now, 0)) / DAY_MS);
  return days <= 0 ? 'today' : days + 'd';
}
function srStatus(id, now) {
  if (now === undefined) now = Date.now();
  const rec = getSRRecord(id);
  if (!rec) return 'new';
  if (now >= rec.nextDue) return 'due';
  if (rec.reps >= 3) return 'mastered';
  return 'learning';
}
function srRecordQuiz(id, quality, now) {
  // quality: 5=perfect, 4=1-2 misses, 0=many misses (reset)
  if (now === undefined) now = Date.now();
  const data = loadSR();
  let rec = data[id] || { ease: 2.5, interval: 0, reps: 0, attempts: 0 };
  rec.attempts = (rec.attempts || 0) + 1;
  // Extra practice before the line is due counts as an attempt but does not
  // advance the schedule, so repeating a line in one sitting cannot make it
  // "Mastered". A failed run still resets it.
  if (rec.nextDue && now < rec.nextDue && quality >= 3) {
    rec.lastReviewed = now;
    data[id] = rec;
    return saveSR(data);
  }
  rec.ease = Math.max(1.3, rec.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  if (quality < 3) {
    rec.reps = 0;
    rec.interval = 1;
  } else {
    rec.reps += 1;
    if (rec.reps === 1) rec.interval = 1;
    else if (rec.reps === 2) rec.interval = 3;
    else rec.interval = Math.round(rec.interval * rec.ease);
  }
  rec.lastReviewed = now;
  rec.nextDue = srAddDays(now, rec.interval);
  data[id] = rec;
  return saveSR(data);
}
function updateSRSidebar() {
  $('.opening-btn').each(function() {
    const id = $(this).data('id');
    const status = srStatus(id);
    $(this).removeClass('sr-due sr-mastered sr-learning');
    if (status !== 'new') $(this).addClass('sr-' + status);
    if ($(this).find('.sr-dot').length === 0) {
      $(this).prepend('<span class="sr-dot"></span>');
    }
  });
  // Populate "Due for Review" section
  const due = OPENINGS.filter(o => srStatus(o.id) === 'due');
  const $section = $('#sr-due-section');
  const $list = $('#sr-due-list');
  if (due.length === 0) {
    $section.hide();
  } else {
    const html = due.map(o => {
      const badge = o.category === 'trap' ? '<span class="trap-badge">trap</span>' : `<span class="eco">${o.eco || ''}</span>`;
      return `<button class="opening-btn sr-due" data-id="${o.id}" data-cat="${o.category}"><span class="sr-dot"></span>${o.name} ${badge}</button>`;
    }).join('');
    $list.html(html);
    $section.show();
    $list.find('.opening-btn').on('click', function() { loadOpening($(this).data('id')); });
  }
}
function updateSRPanel() {
  const $panel = $('#sr-status-panel');
  if (!currentOpening || !quizMode) { $panel.hide(); return; }
  const rec = getSRRecord(currentOpening.id);
  const status = srStatus(currentOpening.id);
  const statusLabel = { new: 'Never attempted', due: 'Due for review', learning: 'Learning', mastered: 'Mastered' }[status];
  let html = `<div class="sr-line"><span>Status</span><strong>${statusLabel}</strong></div>`;
  if (rec) {
    html += `<div class="sr-line"><span>Clean runs</span><strong>${rec.reps}</strong></div>`;
    html += `<div class="sr-line"><span>Attempts</span><strong>${rec.attempts}</strong></div>`;
    if (rec.nextDue) {
      html += `<div class="sr-line"><span>Next review</span><strong>${srNextReviewLabel(rec.nextDue)}</strong></div>`;
    }
  }
  $panel.html(html).show();
}

// Opening data (ids, move counts, legal SAN in every line) is checked by
// scripts/validate-openings.js in CI. It used to be replayed here on every
// page load, which blocked the main thread for about half a second.
