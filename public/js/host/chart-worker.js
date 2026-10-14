// Worker (módulo) que genera la partitura sin congelar la pantalla.
import { generateChart } from './chart.js';
self.onmessage = (e) => {
  try { self.postMessage({ ok: true, chart: generateChart(e.data.an, e.data.opts) }); }
  catch (err) { self.postMessage({ ok: false, error: String(err && err.message || err) }); }
};
