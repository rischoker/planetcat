// =====================================================================
//  Motor de audio del host. La canción suena con Web Audio para tener un
//  reloj preciso (songTime) al que se sincronizan obstáculos y animaciones.
// =====================================================================
import { analyzeBeats, toMonoDownsampled } from './beat-analysis.js';

export class AudioEngine {
  constructor() {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = AC ? new AC() : null;
    this.master = null;
    this.musicGain = null;
    this.sfxGain = null;
    if (this.ctx) {
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = 0.8;
      this.sfxGain.connect(this.master);
    }
    this.volume = 0.8;
    this.muted = false;
    this.song = null;        // AudioBuffer
    this.songName = '';
    this.meowBuf = null;
    this.src = null;
    this.startCtxTime = 0;
    this.pausedAt = null;
    this.userOffset = 0;     // calibración (s): + si el audio llega tarde (parlantes BT)
    this.noiseBuf = null;
    this.setVolume(this.volume);
  }

  unlock() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, +v));
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }
  toggleMute() { this.muted = !this.muted; this.setVolume(this.volume); return this.muted; }

  async fetchBuffer(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('No se pudo descargar ' + url + ' (' + res.status + ')');
    const ab = await res.arrayBuffer();
    return this.decode(ab);
  }

  decode(ab) {
    // Safari antiguo solo acepta la versión con callbacks
    return new Promise((resolve, reject) => {
      const p = this.ctx.decodeAudioData(ab, resolve, reject);
      if (p && p.then) p.then(resolve, reject);
    });
  }

  async loadMeow(url) {
    try { this.meowBuf = await this.fetchBuffer(url); } catch (e) { console.warn('maullido', e); }
  }

  /** Analiza un AudioBuffer en un Worker (o en el hilo principal si no hay Worker de módulo). */
  analyze(buffer, onProgress) {
    const channels = [];
    for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) channels.push(buffer.getChannelData(c).slice());
    return new Promise((resolve, reject) => {
      let worker = null;
      try { worker = new Worker(new URL('./beat-worker.js', import.meta.url), { type: 'module' }); } catch (e) { worker = null; }
      const fallback = () => {
        setTimeout(() => {
          try {
            const { data, rate } = toMonoDownsampled(channels, buffer.sampleRate);
            resolve(analyzeBeats(data, rate, onProgress));
          } catch (e) { reject(e); }
        }, 30);
      };
      if (!worker) return fallback();
      let finished = false;
      const timer = setTimeout(() => { if (!finished) { worker.terminate(); fallback(); } }, 45000);
      worker.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'progress') onProgress && onProgress(m.p);
        else if (m.type === 'done') { finished = true; clearTimeout(timer); worker.terminate(); resolve(m.result); }
        else if (m.type === 'error') { finished = true; clearTimeout(timer); worker.terminate(); fallback(); }
      };
      worker.onerror = () => { if (!finished) { finished = true; clearTimeout(timer); worker.terminate(); fallback(); } };
      worker.postMessage({ channels, sampleRate: buffer.sampleRate });
    });
  }

  /** Empieza la canción. `at` = segundos de ctx desde ahora. */
  playSong(fromTime = 0, delay = 0.05) {
    this.stopSong();
    if (!this.song || !this.ctx) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.song;
    src.connect(this.musicGain);
    const when = this.ctx.currentTime + delay;
    src.start(when, Math.max(0, fromTime));
    this.src = src;
    this.startCtxTime = when - fromTime;
    this.pausedAt = null;
  }

  stopSong() {
    if (this.src) { try { this.src.stop(); } catch (e) {} this.src.disconnect(); this.src = null; }
  }

  /** Tiempo de la canción que el público está ESCUCHANDO ahora. */
  songTime() {
    if (!this.ctx) return 0;
    if (this.pausedAt !== null) return this.pausedAt;
    const lat = (this.ctx.outputLatency || 0) + (this.ctx.baseLatency || 0);
    return this.ctx.currentTime - this.startCtxTime - lat - this.userOffset;
  }

  // ------------------------------------------------------------- efectos
  _env(node, t, a, d, peak) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  _osc(type, f0, f1, dur, peak = 0.2, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    this._env(g, t, 0.008, dur, peak);
    o.connect(g); g.connect(this.sfxGain); o.start(t); o.stop(t + dur + 0.05);
  }
  _noise(dur, peak, f0, f1, delay = 0) {
    if (!this.ctx) return;
    if (!this.noiseBuf) {
      const b = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
      const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
    }
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain(); this._env(g, t, 0.01, dur, peak);
    s.connect(f); f.connect(g); g.connect(this.sfxGain); s.start(t); s.stop(t + dur + 0.05);
  }
  meow(rate) {
    if (!this.ctx || !this.meowBuf) return;
    const s = this.ctx.createBufferSource(); s.buffer = this.meowBuf;
    s.playbackRate.value = rate || (0.9 + Math.random() * 0.35);
    const g = this.ctx.createGain(); g.gain.value = 0.9;
    s.connect(g); g.connect(this.sfxGain); s.start();
  }
  jump() { this._osc('sine', 260, 720, 0.16, 0.1); }
  land() { this._osc('triangle', 140, 70, 0.07, 0.06); }
  perfect() { this._osc('triangle', 1318, 0, 0.12, 0.07); this._osc('triangle', 1760, 0, 0.18, 0.06, 0.06); }
  hit() { // silbato que cae + golpe
    this._osc('sine', 1400, 180, 0.55, 0.16);
    this._noise(0.25, 0.4, 900, 200, 0.02);
    this._osc('square', 90, 40, 0.25, 0.12, 0.02);
  }
  doubleJump() { this._osc('sine', 520, 1300, 0.14, 0.09); this._osc('triangle', 780, 1560, 0.12, 0.05, 0.04); }
  speedUp() { [392, 523, 659, 784, 1046].forEach((f, i) => this._osc('square', f, 0, 0.09, 0.06, i * 0.06)); this._noise(0.4, 0.08, 800, 4000); }
  grindStart() { this._osc('square', 220, 330, 0.08, 0.05); this._noise(0.35, 0.06, 3000, 5000); }
  grindEnd() { this._osc('triangle', 660, 1320, 0.18, 0.08); this._osc('triangle', 990, 1980, 0.16, 0.05, 0.08); }
  poof() { this._noise(0.18, 0.08, 2500, 600); }
  tick(high) { this._osc('square', high ? 1046 : 784, 0, 0.09, 0.08); }
  screech() { this._noise(0.5, 0.18, 3000, 600); this._osc('sawtooth', 900, 300, 0.45, 0.04); }
  fanfare() { [523, 659, 784, 1046].forEach((f, i) => this._osc('triangle', f, 0, 0.25, 0.12, i * 0.13)); }
  spring() { this._osc('sine', 200, 900, 0.12, 0.05); this._osc('sine', 900, 400, 0.1, 0.03, 0.1); }
}
