const Effects = {
  ctx: null,

  _ensureCtx() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  },

  _tone(startTime, freq, duration, peakGain, type) {
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    const osc = ctx.createOscillator();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    osc.connect(gain).connect(ctx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.03);
  },

  _click(startTime, peakGain) {
    const ctx = this.ctx;
    const bufferSize = ctx.sampleRate * 0.02;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peakGain, startTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.02);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1800;
    noise.connect(filter).connect(gain).connect(ctx.destination);
    noise.start(startTime);
  },

  playDiceRoll() {
    if (!this._ensureCtx()) return;
    const t0 = this.ctx.currentTime;
    for (let i = 0; i < 5; i++) this._click(t0 + i * 0.08, 0.18);
    this._tone(t0 + 0.45, 660, 0.15, 0.15, 'triangle');
  },

  playCoinFlip() {
    if (!this._ensureCtx()) return;
    const t0 = this.ctx.currentTime;
    this._tone(t0, 1400, 0.08, 0.12, 'sine');
    this._tone(t0 + 0.08, 1600, 0.08, 0.1, 'sine');
    this._tone(t0 + 0.18, 1200, 0.2, 0.14, 'triangle');
  },

  playWinFanfare() {
    if (!this._ensureCtx()) return;
    const t0 = this.ctx.currentTime + 0.02;
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
    notes.forEach((freq, i) => this._tone(t0 + i * 0.11, freq, 0.28, 0.2, 'triangle'));
  }
};
