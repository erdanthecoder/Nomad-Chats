const Ringtone = {
  ctx: null,
  playing: false,
  _timer: null,

  _ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  },

  // Warm little chime: a soft triangle fundamental + a quiet octave-up sine
  // for shimmer, gentle attack/decay so it sounds like a bell, not a beep.
  _playNote(startTime, freq, duration, peakGain) {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3400;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    osc.detune.value = -4;

    const overtone = ctx.createOscillator();
    overtone.type = 'sine';
    overtone.frequency.value = freq * 2;
    const overtoneGain = ctx.createGain();
    overtoneGain.gain.value = 0.28;

    osc.connect(filter);
    overtone.connect(overtoneGain).connect(filter);
    filter.connect(gain).connect(ctx.destination);

    osc.start(startTime);
    overtone.start(startTime);
    osc.stop(startTime + duration + 0.05);
    overtone.stop(startTime + duration + 0.05);
  },

  _scheduleLoop() {
    if (!this.playing || !this.ctx) return;
    const t0 = this.ctx.currentTime + 0.05;
    const notes = [783.99, 1046.50, 1318.51]; // G5, C6, E6 — bright, warm arpeggio
    const noteDur = 0.24;
    const gap = 0.17;

    for (let rep = 0; rep < 2; rep++) {
      notes.forEach((freq, i) => {
        const t = t0 + rep * (notes.length * gap) + i * gap;
        this._playNote(t, freq, noteDur, 0.24);
      });
    }

    const cycleMs = (2 * notes.length * gap + 1.15) * 1000;
    this._timer = setTimeout(() => this._scheduleLoop(), cycleMs);
  },

  start() {
    if (this.playing) return;
    if (!this._ensureCtx()) return;
    this.playing = true;
    this._scheduleLoop();
  },

  stop() {
    this.playing = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  },

  // Call once on the app's first user gesture so later autonomous
  // (socket-triggered) ring events are allowed to make sound.
  unlockOnFirstInteraction() {
    const unlock = () => {
      this._ensureCtx();
      document.removeEventListener('click', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('click', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
  }
};
