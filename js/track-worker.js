/* ---------- Web Worker del rastreo: el cálculo pesado fuera del hilo principal ----------
   Mensajes: { id, type: 'init', AH, rgba, seeds, quad } · { id, type: 'begin' } · { id, type: 'step', rgba }
   Responde { id, r } (resultado) o { id, error }.
*/
import { TrackCore } from './trackcore.js';

let core = null;
self.onmessage = e => {
  const m = e.data;
  try {
    let r = null;
    if (m.type === 'init') core = new TrackCore(m.AH, new Uint8ClampedArray(m.rgba), m.seeds, m.quad);
    else if (m.type === 'begin') core.begin();
    else if (m.type === 'step') r = core.step(new Uint8ClampedArray(m.rgba));
    self.postMessage({ id: m.id, r });
  } catch (err) {
    self.postMessage({ id: m.id, error: String((err && err.message) || err) });
  }
};
