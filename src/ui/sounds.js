// Move sounds, synthesised with Web Audio (no audio files).
// Classic script loaded before the view scripts in src/views/ (see
// index.html); its top-level declarations are shared globals, as they were
// inside app.js.

// ─────────────────────────────────────────────
// MOVE SOUNDS (Web Audio synthesized — no binary assets)
// ─────────────────────────────────────────────
// We synthesize short filtered transients instead of shipping audio files. The
// profile is tuned toward a dry wooden-board click: fast attack, low body, and
// a tiny high-frequency edge.
// AudioContext is created lazily on first play because most browsers block
// audio creation outside a user gesture; the toggle checkbox click counts.
const SOUND_PREF_KEY = 'coach:sound:v1';
let coachSoundEnabled = false;
let coachAudioCtx = null;

function readSoundPref() {
  try { return localStorage.getItem(SOUND_PREF_KEY) === '1'; } catch (e) { return false; }
}
function writeSoundPref(on) {
  try { localStorage.setItem(SOUND_PREF_KEY, on ? '1' : '0'); } catch (e) {}
}
function ensureAudioCtx() {
  if (coachAudioCtx) return coachAudioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    coachAudioCtx = new Ctx();
  } catch (e) { return null; }
  return coachAudioCtx;
}
function createNoiseBuffer(ctx, duration) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  }
  return buffer;
}

function applyPercussiveEnvelope(gainNode, start, peak, attack, decay) {
  const gain = gainNode.gain;
  gain.cancelScheduledValues(start);
  gain.setValueAtTime(0.0001, start);
  gain.exponentialRampToValueAtTime(peak, start + attack);
  gain.exponentialRampToValueAtTime(0.0001, start + attack + decay);
}

function playTone(freq, durationMs, opts = {}) {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime + (opts.delay || 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = opts.type || 'sine';
  osc.frequency.setValueAtTime(freq, now);
  if (opts.endFreq) {
    osc.frequency.exponentialRampToValueAtTime(opts.endFreq, now + durationMs / 1000);
  }
  const peak = opts.gain == null ? 0.16 : opts.gain;
  applyPercussiveEnvelope(gain, now, peak, 0.004, durationMs / 1000);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durationMs / 1000 + 0.02);
}

function playNoiseClick(opts = {}) {
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  const start = ctx.currentTime + (opts.delay || 0);
  const duration = opts.duration || 0.028;
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = createNoiseBuffer(ctx, duration);
  filter.type = opts.filterType || 'bandpass';
  filter.frequency.setValueAtTime(opts.frequency || 2400, start);
  filter.Q.setValueAtTime(opts.q || 0.8, start);
  applyPercussiveEnvelope(gain, start, opts.gain || 0.08, 0.0015, duration);
  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(start);
  source.stop(start + duration + 0.01);
}

function playWoodTap(opts = {}) {
  playNoiseClick({
    delay: opts.delay || 0,
    duration: opts.clickDuration || 0.022,
    frequency: opts.clickFreq || 2600,
    q: opts.clickQ || 0.7,
    gain: opts.clickGain || 0.045
  });
  playTone(opts.bodyFreq || 210, (opts.bodyMs || 58), {
    delay: opts.delay || 0,
    type: 'triangle',
    endFreq: opts.bodyEnd || 115,
    gain: opts.bodyGain || 0.07
  });
  if (opts.lowFreq) {
    playTone(opts.lowFreq, opts.lowMs || 82, {
      delay: (opts.delay || 0) + 0.006,
      type: 'sine',
      endFreq: opts.lowEnd || Math.max(40, opts.lowFreq * 0.55),
      gain: opts.lowGain || 0.045
    });
  }
}

function playSound(kind) {
  if (!coachSoundEnabled) return;
  const ctx = ensureAudioCtx();
  if (!ctx) return;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  if (kind === 'move') {
    playWoodTap({ bodyFreq: 245, bodyEnd: 128, bodyGain: 0.055, clickFreq: 3100, clickGain: 0.04 });
  } else if (kind === 'capture') {
    playWoodTap({ bodyFreq: 165, bodyEnd: 82, bodyGain: 0.09, lowFreq: 95, lowGain: 0.055, clickFreq: 1700, clickGain: 0.065, bodyMs: 76 });
  } else if (kind === 'castle') {
    playWoodTap({ bodyFreq: 230, bodyEnd: 118, bodyGain: 0.05, clickFreq: 2800, clickGain: 0.038 });
    playWoodTap({ delay: 0.055, bodyFreq: 205, bodyEnd: 104, bodyGain: 0.047, clickFreq: 2400, clickGain: 0.034 });
  } else if (kind === 'promote') {
    playWoodTap({ bodyFreq: 250, bodyEnd: 132, bodyGain: 0.052, clickFreq: 3200, clickGain: 0.04 });
    playTone(720, 92, { delay: 0.045, type: 'triangle', endFreq: 520, gain: 0.026 });
  } else if (kind === 'check') {
    playWoodTap({ bodyFreq: 235, bodyEnd: 122, bodyGain: 0.052, clickFreq: 3000, clickGain: 0.04 });
    playNoiseClick({ delay: 0.052, duration: 0.018, frequency: 4300, q: 1.2, gain: 0.036 });
  } else if (kind === 'gameover') {
    playWoodTap({ bodyFreq: 150, bodyEnd: 78, bodyGain: 0.09, lowFreq: 72, lowGain: 0.06, clickFreq: 1550, clickGain: 0.055, bodyMs: 95 });
    playTone(210, 180, { delay: 0.11, type: 'triangle', endFreq: 92, gain: 0.055 });
  }
}
// Pick the right sound for a chess.js move object.
function soundForMove(mv, gameAfter) {
  if (!mv) return null;
  if (gameAfter && gameAfter.game_over()) return 'gameover';
  if (gameAfter && gameAfter.in_check()) return 'check';
  if (mv.captured) return 'capture';
  if (mv.promotion) return 'promote';
  if (isCastlingMove(mv)) return 'castle';
  return 'move';
}
