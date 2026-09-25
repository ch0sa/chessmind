// Sound and Haptics Controller for ChessMind
// Uses native Web Audio API for 100% offline, zero-latency, realistic chess sound effects.

let audioCtx = null;
let soundEnabled = true;

// Initialize or resume AudioContext on user interaction
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export function initSound(initialEnabled = true) {
  soundEnabled = initialEnabled;
  // Pre-bind unlock listeners for iOS Safari and mobile Chrome
  const unlock = () => {
    getAudioContext();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

export function setSoundEnabled(enabled) {
  soundEnabled = !!enabled;
}

export function isSoundEnabled() {
  return soundEnabled;
}

// Generate a subtle noise buffer for piece impact texture
function createNoiseBuffer(ctx, duration = 0.03) {
  const bufferSize = Math.floor(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
  }
  return buffer;
}

/**
 * Play a standard wooden chess piece move sound (felted board 'thock')
 */
export function playMoveSound() {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // 1. Low frequency body (wood resonance: 160Hz -> 50Hz)
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(160, now);
  osc.frequency.exponentialRampToValueAtTime(50, now + 0.06);

  gain.gain.setValueAtTime(0.7, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

  // 2. High click transient (noise burst)
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.025);
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'lowpass';
  noiseFilter.frequency.setValueAtTime(1200, now);

  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.4, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.025);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(ctx.destination);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  noise.start(now);
  osc.stop(now + 0.09);
  noise.stop(now + 0.03);

  triggerHaptic('move');
}

/**
 * Play capture sound: heavier double-knock impact
 */
export function playCaptureSound() {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  // Knock 1: piece hitting piece
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(260, now);
  osc1.frequency.exponentialRampToValueAtTime(80, now + 0.04);
  gain1.gain.setValueAtTime(0.8, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.05);

  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.06);

  // Knock 2: piece landing on square (offset by 30ms)
  const t2 = now + 0.03;
  const osc2 = ctx.createOscillator();
  const gain2 = ctx.createGain();
  osc2.type = 'triangle';
  osc2.frequency.setValueAtTime(180, t2);
  osc2.frequency.exponentialRampToValueAtTime(45, t2 + 0.08);
  gain2.gain.setValueAtTime(0.9, t2);
  gain2.gain.exponentialRampToValueAtTime(0.001, t2 + 0.09);

  // Noise transient
  const noise = ctx.createBufferSource();
  noise.buffer = createNoiseBuffer(ctx, 0.035);
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.6, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

  noise.connect(noiseGain);
  noiseGain.connect(ctx.destination);

  osc2.connect(gain2);
  gain2.connect(ctx.destination);

  osc2.start(t2);
  noise.start(now);
  osc2.stop(t2 + 0.1);
  noise.stop(now + 0.04);

  triggerHaptic('capture');
}

/**
 * Play check sound: move sound + crisp alert harmonic chime
 */
export function playCheckSound() {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  playMoveSound();

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  // Glass harmonic (E6 / ~1318Hz & A5 / 880Hz)
  osc.type = 'sine';
  osc.frequency.setValueAtTime(880, now);
  osc.frequency.exponentialRampToValueAtTime(1318, now + 0.05);

  gain.gain.setValueAtTime(0.4, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + 0.3);

  triggerHaptic('check');
}

/**
 * Play castling sound: rapid double slide-and-drop
 */
export function playCastleSound() {
  if (!soundEnabled) return;
  playMoveSound();
  setTimeout(() => {
    playMoveSound();
  }, 90);
  triggerHaptic('castle');
}

/**
 * Play game end sound: pleasant resonant resolving chord
 */
export function playGameEndSound() {
  if (!soundEnabled) return;
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 major triad

  notes.forEach((freq, idx) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = now + idx * 0.08;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.45);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(t);
    osc.stop(t + 0.5);
  });

  triggerHaptic('game-end');
}

/**
 * Trigger subtle haptic vibration for mobile devices
 */
export function triggerHaptic(type = 'move') {
  if (typeof navigator === 'undefined' || !navigator.vibrate) return;
  try {
    if (type === 'move') {
      navigator.vibrate(20);
    } else if (type === 'capture' || type === 'check') {
      navigator.vibrate([35, 25, 35]);
    } else if (type === 'castle') {
      navigator.vibrate([20, 30, 20]);
    } else if (type === 'game-end') {
      navigator.vibrate([50, 40, 70]);
    }
  } catch (e) {
    // Ignore haptic errors on unsupported platforms
  }
}
