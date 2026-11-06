// Library spaced repetition (SM-2 lite) for opening lines.
// Classic script loaded before app.js (see index.html); its top-level
// declarations are shared globals, as they were inside app.js.

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
function srStatus(id) {
  const rec = getSRRecord(id);
  if (!rec) return 'new';
  if (Date.now() >= rec.nextDue) return 'due';
  if (rec.reps >= 3) return 'mastered';
  return 'learning';
}
function srRecordQuiz(id, quality) {
  // quality: 5=perfect, 4=1-2 misses, 0=many misses (reset)
  const data = loadSR();
  let rec = data[id] || { ease: 2.5, interval: 0, reps: 0, attempts: 0 };
  rec.attempts = (rec.attempts || 0) + 1;
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
  rec.lastReviewed = Date.now();
  rec.nextDue = Date.now() + rec.interval * DAY_MS;
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
      const days = Math.max(0, Math.round((rec.nextDue - Date.now()) / DAY_MS));
      html += `<div class="sr-line"><span>Next review</span><strong>${days === 0 ? 'now' : days + 'd'}</strong></div>`;
    }
  }
  $panel.html(html).show();
}

function validateOpeningData() {
  const errors = [];
  const seenIds = new Set();
  OPENINGS.forEach(opening => {
    if (!opening.id) errors.push('Opening missing id');
    if (seenIds.has(opening.id)) errors.push(`Duplicate opening id: ${opening.id}`);
    seenIds.add(opening.id);
    if (!Array.isArray(opening.moves) || opening.moves.length === 0) {
      errors.push(`${opening.id}: missing moves`);
    }
    if (!Array.isArray(opening.explanations) || opening.explanations.length !== opening.moves.length) {
      errors.push(`${opening.id}: explanations length does not match moves length`);
    }
    const lineIds = new Set();
    getOpeningLines(opening).forEach(line => {
      const lineKey = `${opening.id}/${line.id}`;
      if (lineIds.has(line.id)) errors.push(`${opening.id}: duplicate line id ${line.id}`);
      lineIds.add(line.id);
      if (!Array.isArray(line.moves) || line.moves.length === 0) {
        errors.push(`${lineKey}: missing moves`);
        return;
      }
      if (!Array.isArray(line.explanations) || line.explanations.length !== line.moves.length) {
        errors.push(`${lineKey}: explanations length does not match moves length`);
      }
      const g = new Chess();
      for (let i = 0; i < line.moves.length; i++) {
        const san = line.moves[i];
        if (!g.move(san)) {
          errors.push(`${lineKey}: illegal SAN at ply ${i + 1}: ${san}`);
          break;
        }
      }
    });
  });
  if (errors.length) console.warn('Opening data validation failed:', errors);
  return errors;
}
