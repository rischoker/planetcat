// Worker (módulo) que analiza el audio sin congelar la pantalla.
import { analyzeBeats, toMonoDownsampled } from './beat-analysis.js';
self.onmessage = (e) => {
  try {
    const { channels, sampleRate } = e.data;
    const { data, rate } = toMonoDownsampled(channels, sampleRate);
    const res = analyzeBeats(data, rate, (p) => self.postMessage({ type: 'progress', p }));
    self.postMessage({ type: 'done', result: res });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
