// =====================================================================
//  Detección de tempo y beats (sin dependencias). Funciona en Worker,
//  en el hilo principal y en Node (tests).
//   1) Envolvente de onsets por flujo espectral (FFT 1024, hop ~11.6 ms)
//   2) Tempo por autocorrelación con preferencia ~120 BPM
//   3) Seguimiento de beats con programación dinámica (Ellis 2007)
//   4) Fuerza/energía por beat y fase del compás (downbeat)
// =====================================================================

function fftReal(re, im) { // FFT radix-2 in-place
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

/** Mezcla a mono y baja a ~11 kHz. channels = array de Float32Array. */
export function toMonoDownsampled(channels, sampleRate) {
  const factor = Math.max(1, Math.round(sampleRate / 11025));
  const len = Math.floor(channels[0].length / factor);
  const out = new Float32Array(len);
  const nc = channels.length;
  for (let i = 0; i < len; i++) {
    let acc = 0;
    for (let c = 0; c < nc; c++) {
      const ch = channels[c];
      for (let k = 0; k < factor; k++) acc += ch[i * factor + k];
    }
    out[i] = acc / (factor * nc);
  }
  return { data: out, rate: sampleRate / factor };
}

export function analyzeBeats(mono, rate, onProgress) {
  const N = 1024, HOP = 128;
  const frameRate = rate / HOP;
  const nFrames = Math.max(1, Math.floor((mono.length - N) / HOP));
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const half = N / 2;
  let prev = new Float32Array(half);
  const flux = new Float32Array(nFrames);
  const low = new Float32Array(nFrames);   // flujo de graves (bombo)
  const rms = new Float32Array(nFrames);
  const re = new Float32Array(N), im = new Float32Array(N);
  const lowBin = Math.ceil(160 / (rate / N));
  const hiBin = Math.floor(5000 / (rate / N));
  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    let e = 0;
    for (let i = 0; i < N; i++) { const s = mono[off + i]; re[i] = s * win[i]; im[i] = 0; e += s * s; }
    rms[f] = Math.sqrt(e / N);
    fftReal(re, im);
    const cur = new Float32Array(half);
    let fl = 0, fll = 0;
    for (let k = 1; k < hiBin; k++) {
      const mag = Math.log1p(100 * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
      cur[k] = mag;
      const d = mag - prev[k];
      if (d > 0) { fl += d; if (k <= lowBin) fll += d; }
    }
    flux[f] = fl; low[f] = fll; prev = cur;
    if (onProgress && (f & 1023) === 0) onProgress(0.7 * f / nFrames);
  }

  // Normaliza onset: resta media local (~0.4 s) y recorta negativos
  const env = new Float32Array(nFrames);
  const W = Math.round(frameRate * 0.2);
  let acc = 0;
  const cum = new Float64Array(nFrames + 1);
  for (let i = 0; i < nFrames; i++) { acc += flux[i]; cum[i + 1] = acc; }
  let mx = 1e-9;
  for (let i = 0; i < nFrames; i++) {
    const a = Math.max(0, i - W), b = Math.min(nFrames, i + W + 1);
    const m = (cum[b] - cum[a]) / (b - a);
    env[i] = Math.max(0, flux[i] - m);
    if (env[i] > mx) mx = env[i];
  }
  for (let i = 0; i < nFrames; i++) env[i] /= mx;

  // ---- Tempo por autocorrelación (70–180 BPM) con prior log-gaussiano en 120
  const minLag = Math.floor(frameRate * 60 / 180), maxLag = Math.ceil(frameRate * 60 / 70);
  let bestLag = minLag, bestScore = -1;
  const scores = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < nFrames; i++) s += env[i] * env[i - lag];
    const bpm = 60 * frameRate / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const sc = s * prior;
    scores.push(sc);
    if (sc > bestScore) { bestScore = sc; bestLag = lag; }
  }
  // refinamiento parabólico
  const li = bestLag - minLag;
  let lagF = bestLag;
  if (li > 0 && li < scores.length - 1) {
    const a = scores[li - 1], b = scores[li], c = scores[li + 1];
    const d = (a - 2 * b + c);
    if (d !== 0) lagF = bestLag + 0.5 * (a - c) / d;
  }
  let period = lagF; // en frames
  let bpm = 60 * frameRate / period;
  // Lleva el tempo a un rango cómodo para jugar
  while (bpm < 85) { bpm *= 2; period /= 2; }
  while (bpm > 175) { bpm /= 2; period *= 2; }
  if (onProgress) onProgress(0.8);

  // ---- Seguimiento de beats (DP)
  const alpha = 100;
  const score = new Float32Array(nFrames);
  const back = new Int32Array(nFrames).fill(-1);
  const pMin = Math.round(period * 0.5), pMax = Math.round(period * 2);
  for (let t = 0; t < nFrames; t++) {
    let best = 0, arg = -1;
    for (let p = t - pMax; p <= t - pMin; p++) {
      if (p < 0) continue;
      const r = Math.log((t - p) / period);
      const v = score[p] - alpha * r * r;
      if (v > best || arg < 0) { best = v; arg = p; }
    }
    score[t] = env[t] + (arg >= 0 ? Math.max(0, best) : 0);
    back[t] = arg >= 0 && best > 0 ? arg : -1;
  }
  // último beat: máximo en el último periodo
  let end = nFrames - 1, bestEnd = -1;
  for (let t = Math.max(0, nFrames - Math.round(period)); t < nFrames; t++) if (score[t] > bestEnd) { bestEnd = score[t]; end = t; }
  const frames = [];
  for (let t = end; t >= 0; t = back[t]) { frames.push(t); if (back[t] < 0) break; }
  frames.reverse();
  // Rellena hacia el inicio con el periodo si el DP empezó tarde
  while (frames.length && frames[0] - period > 0) frames.unshift(Math.round(frames[0] - period));
  if (onProgress) onProgress(0.9);

  const beats = frames.map((f) => f / frameRate + (N / 2) / rate);
  // ---- Fuerza (onset local) y energía (RMS alrededor del beat)
  const strength = [], energy = [], lowS = [];
  const hw = Math.max(1, Math.round(period / 2));
  for (const f of frames) {
    let s = 0, l = 0, e = 0, n = 0;
    for (let i = Math.max(0, f - 2); i <= Math.min(nFrames - 1, f + 2); i++) { s = Math.max(s, env[i]); l = Math.max(l, low[i]); }
    for (let i = Math.max(0, f - hw); i < Math.min(nFrames, f + hw); i++) { e += rms[i]; n++; }
    strength.push(s); lowS.push(l); energy.push(n ? e / n : 0);
  }
  const norm = (arr) => {
    const sorted = arr.slice().sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.05)] || 0;
    const hi = sorted[Math.floor(sorted.length * 0.95)] || 1;
    return arr.map((x) => Math.max(0, Math.min(1, (x - lo) / ((hi - lo) || 1))));
  };
  const nStrength = norm(strength), nEnergy = norm(energy), nLow = norm(lowS);
  // Fase del compás: la fase (0..3) donde los graves pegan más fuerte = tiempo 1
  const phaseSum = [0, 0, 0, 0];
  nLow.forEach((v, i) => { phaseSum[i % 4] += v; });
  const downbeatPhase = phaseSum.indexOf(Math.max(...phaseSum));
  if (onProgress) onProgress(1);

  // ---- Onsets en semicorcheas (4 por beat): la "melodía rítmica" de la canción
  //      que usa el generador para leer la música como un Guitar Hero.
  const subRaw = [];
  for (let bi = 0; bi < frames.length; bi++) {
    const f = frames[bi];
    const f2 = bi + 1 < frames.length ? frames[bi + 1] : f + period;
    const row = [];
    for (let k = 0; k < 4; k++) {
      const c = Math.round(f + (k * (f2 - f)) / 4);
      let m = 0;
      for (let i = Math.max(0, c - 2); i <= Math.min(nFrames - 1, c + 2); i++) m = Math.max(m, env[i]);
      row.push(m);
    }
    subRaw.push(row);
  }
  const flat = subRaw.flat().sort((a, b) => a - b);
  const p95 = flat[Math.floor(flat.length * 0.95)] || 1;
  const sub = subRaw.map((r) => r.map((x) => Math.round(Math.min(1, x / p95) * 1000) / 1000));

  // BPM medido real (mediana de intervalos)
  const ivs = [];
  for (let i = 1; i < beats.length; i++) ivs.push(beats[i] - beats[i - 1]);
  ivs.sort((a, b) => a - b);
  const med = ivs.length ? ivs[Math.floor(ivs.length / 2)] : 60 / bpm;

  return {
    bpm: Math.round(600 / med) / 10,
    beatDur: med,
    beats, strength: nStrength, energy: nEnergy, low: nLow, sub,
    downbeatPhase,
    duration: mono.length / rate,
  };
}
