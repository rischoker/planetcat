// Worker (módulo) que genera la partitura sin congelar la pantalla.
import { generateChart } from './chart.js';
import { makeStemChart } from './stemchart.js';
self.onmessage = (e) => {
  try {
    const chart = e.data.stem ? makeStemChart(e.data.stem, e.data.opts) : generateChart(e.data.an, e.data.opts);
    self.postMessage({ ok: true, chart });
  } catch (err) { self.postMessage({ ok: false, error: String(err && err.message || err) }); }
};
