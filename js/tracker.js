import { $, S } from './state.js';
import { clamp, toast } from './util.js';
import { seekTo } from './clips.js';
import { pause } from './playback.js';
import { renderPanel } from './panel.js';
import { renderTimeline } from './timeline-ui.js';
import { commit, P } from './project.js';
import { FrameSource, drawRotated } from './frames.js';
import { AW, TrackCore } from './trackcore.js';

/* ---------- rastreo: coordinación ----------
   Rastreo 2D por punto (uno o dos; con dos se calcula también giro y escala, ver trackXform en render.js)
   o de un plano con 4 esquinas (perspectiva, planar.js): cada muestra lleva además q = [x0,y0, …, x3,y3].
   El cálculo (trackcore.js) corre en un Web Worker para que la interfaz no se trabe; aquí se obtienen
   los cuadros, se arman las pasadas (hacia adelante y hacia atrás desde la semilla) y se guarda el resultado.
   Los cuadros salen de FrameSource (VideoDecoder, en orden): mucho más rápido que hacer seek en el <video>,
   que decodifica desde el keyframe anterior en cada cuadro. Si el archivo o el códec no se pueden, se usa seek.
*/
const DT = 1 / 15; // paso de tiempo (15 muestras por segundo)
const CHUNK = 2; // s: hacia atrás se decodifica por tramos, en orden, y se entregan al revés

/** Cuadros de análisis (AW×AH, RGBA) de un clip, en el orden en que los pide el rastreo. */
class Frames {
  constructor(c, AH) {
    this.c = c;
    this.AH = AH;
    const cv = document.createElement('canvas');
    cv.width = AW;
    cv.height = AH;
    this.g = cv.getContext('2d', { willReadFrequently: true });
    this.cache = new Map();
    this.last = -Infinity;
  }
  async open() {
    const c = this.c;
    if (c.kind === 'demo') {
      const t = document.createElement('canvas');
      t.width = c.sw;
      t.height = c.sh;
      this.tg = t.getContext('2d');
      return;
    }
    const md = P.media.get(c.mediaId);
    if (md && md.blob) this.fs = await FrameSource.open(md.blob);
    if (!this.fs) {
      try {
        c.el.muted = true;
        await c.el.play();
        c.el.pause();
      } catch (e) {}
    }
  }
  read() {
    return this.g.getImageData(0, 0, AW, this.AH).data;
  }
  async draw(t) {
    const c = this.c,
      g = this.g,
      AH = this.AH;
    if (c.kind === 'demo') {
      c.draw(this.tg, t, c.sw, c.sh);
      g.drawImage(this.tg.canvas, 0, 0, AW, AH);
    } else if (this.fs) {
      g.fillStyle = '#000';
      g.fillRect(0, 0, AW, AH);
      const f = await this.fs.frameAt(t);
      if (f) drawRotated(g, f, this.fs.rotation, 0, 0, AW, AH);
    } else {
      await seekTo(c.el, t);
      g.drawImage(c.el, 0, 0, AW, AH);
    }
    return this.read();
  }
  /** Cuadro en t (s). Hacia atrás con FrameSource: decodifica el tramo [t − CHUNK, t] en orden y guarda los cuadros. */
  async get(t, lo) {
    const key = Math.round(t * 1000);
    if (this.cache.has(key)) {
      const d = this.cache.get(key);
      this.cache.delete(key);
      return d;
    }
    const back = t < this.last - 1e-6;
    this.last = t;
    if (!back || !this.fs) return this.draw(t);
    this.cache.clear();
    const times = [];
    for (let k = 0, u = t; u >= lo - 1e-6 && k <= CHUNK / DT; k++, u = t - k * DT) times.push(u);
    times.reverse();
    let out = null;
    for (const u of times) {
      const d = new Uint8ClampedArray(await this.draw(u)); // copia: el lienzo se reutiliza
      if (Math.round(u * 1000) === key) out = d;
      else this.cache.set(Math.round(u * 1000), d);
    }
    return out;
  }
  close() {
    if (this.fs) this.fs.close();
    this.cache.clear();
  }
}

/** Cálculo en un Web Worker (o en el hilo principal si no hay Workers). Misma interfaz con promesas. */
class Core {
  async init(AH, rgba, seeds, quad) {
    try {
      this.w = new Worker(new URL('./track-worker.js', import.meta.url), { type: 'module' });
      this.n = 0;
      this.wait = new Map();
      this.w.onmessage = e => {
        const p = this.wait.get(e.data.id);
        this.wait.delete(e.data.id);
        if (p) e.data.error ? p.no(new Error(e.data.error)) : p.ok(e.data.r);
      };
      this.w.onerror = e => {
        for (const p of this.wait.values()) p.no(new Error(e.message || 'Error en el rastreo'));
        this.wait.clear();
      };
      await this.call({ type: 'init', AH, rgba, seeds, quad });
      this.inWorker = true;
    } catch (e) {
      // Sin Workers de módulo (navegadores viejos): mismo cálculo aquí
      this.close();
      this.core = new TrackCore(AH, rgba, seeds, quad);
      this.inWorker = false;
    }
  }
  call(m) {
    return new Promise((ok, no) => {
      const id = ++this.n;
      this.wait.set(id, { ok, no });
      const buf = m.rgba && m.rgba.buffer;
      // Se transfiere el búfer (sin copiar): cada cuadro se usa una sola vez
      this.w.postMessage({ ...m, id, rgba: buf }, buf ? [buf] : []);
    });
  }
  begin() {
    return this.core ? this.core.begin() : this.call({ type: 'begin' });
  }
  async step(rgba) {
    return this.core ? this.core.step(rgba) : this.call({ type: 'step', rgba });
  }
  close() {
    if (this.w) this.w.terminate();
    this.w = null;
  }
}

export async function runTrack(c, silent) {
  if (!c || !c.track || !c.track.seed) return;
  if (S.tracking) {
    // El rastreo automático del ejemplo (silencioso) cede el paso a uno que pide la persona
    if (S.trackSilent && !silent) {
      S.trackCancel = true;
      while (S.tracking) await new Promise(r => setTimeout(r, 40));
    } else {
      if (!silent) toast('Espera a que termine el rastreo');
      return;
    }
  }
  if (c.missing) {
    toast('Falta el video de este clip: vuelve a vincularlo en Medios');
    return;
  }
  pause();
  S.tracking = c.id;
  S.trackSilent = !!silent;
  S.trackCancel = false;
  S.trackProg = 0;
  if (!silent) renderPanel();
  const AH = Math.max(16, Math.round((AW * c.sh) / c.sw));
  const frames = new Frames(c, AH),
    core = new Core();
  let lost = false,
    failed = null;
  const seed = c.track.seed,
    seed2 = c.track.seed2 || null,
    quad = c.track.quad || null;
  const first = {
    t: seed.t,
    x: seed.x,
    y: seed.y,
    ...(seed2 ? { x2: seed2.x, y2: seed2.y } : {}),
    ...(quad ? { q: quad.flatMap(p => [p.x, p.y]) } : {}),
  };
  const fwd = [],
    back = [];
  const rebuild = () => {
    c.track.pts = [...back.slice().reverse(), first, ...fwd];
  };
  try {
    await frames.open();
    // Copia: el búfer se transfiere al Worker
    await core.init(AH, new Uint8ClampedArray(await frames.get(seed.t, c.in)), [seed, ...(seed2 ? [seed2] : [])], quad);
    const steps = Math.max(1, Math.ceil((c.out - c.in) / DT));
    let done = 0;
    for (const dir of [1, -1]) {
      await core.begin();
      const arr = dir > 0 ? fwd : back,
        pending = [];
      const times = [];
      for (let t = seed.t + dir * DT; dir > 0 ? t <= c.out + 1e-6 : t >= c.in - 1e-6; t += dir * DT) times.push(t);
      // Mientras el Worker calcula un cuadro, se prepara el siguiente
      const get = t => frames.get(clamp(t, 0, c.dur - 0.001), c.in).then(d => new Uint8ClampedArray(d));
      let next = times.length ? get(times[0]) : null;
      for (let i = 0; i < times.length; i++) {
        if (S.trackCancel) break;
        const rgba = await next;
        next = i + 1 < times.length ? get(times[i + 1]) : null;
        const r = await core.step(rgba);
        if (r.stop) {
          lost = true;
          break;
        }
        const t = times[i],
          e = {
            t,
            x: r.pts[0].x,
            y: r.pts[0].y,
            ...(r.pts[1] ? { x2: r.pts[1].x, y2: r.pts[1].y } : {}),
            ...(r.q ? { q: r.q } : {}),
          };
        // Los cuadros predichos (sin encontrar) cuentan solo si después se vuelven a encontrar todos los puntos
        if (r.pts.some(p => p.misses)) pending.push(e);
        else {
          arr.push(...pending, e);
          pending.length = 0;
        }
        done++;
        if (done % 3 === 0) {
          rebuild();
          S.trackProg = Math.min(0.99, done / steps);
          updTrackUI();
        }
      }
      if (next) await next.catch(() => {}); // que no quede una lectura en curso
    }
  } catch (e) {
    failed = e;
    console.warn('Rastreo', e);
  } finally {
    core.close();
    frames.close();
  }
  rebuild();
  const P2 = c.track.pts;
  const sm = (a, p, b, k) => (a[k] + p[k] * 2 + b[k]) / 4;
  if (P2.length > 4)
    c.track.pts = P2.map((p, i) => {
      if (i === 0 || i === P2.length - 1) return p;
      const a = P2[i - 1],
        b = P2[i + 1];
      const q = { t: p.t, x: sm(a, p, b, 'x'), y: sm(a, p, b, 'y') };
      if (p.x2 != null) ((q.x2 = sm(a, p, b, 'x2')), (q.y2 = sm(a, p, b, 'y2')));
      if (p.q && a.q && b.q) q.q = p.q.map((v, k) => (a.q[k] + v * 2 + b.q[k]) / 4);
      else if (p.q) q.q = p.q;
      return q;
    });
  c.track.lost = lost;
  c.track.cancelled = S.trackCancel;
  if (c.el) c.el.muted = false;
  S.tracking = null;
  S.trackSilent = false;
  S.trackProg = 1;
  if (!silent) {
    toast(
      failed
        ? 'No se pudo terminar el rastreo en este navegador'
        : S.trackCancel
          ? 'Rastreo detenido'
          : lost
            ? 'Rastreo listo: el objeto se perdió en una parte del clip'
            : 'Rastreo listo: ' +
              c.track.pts.length +
              ' muestras' +
              (c.track.quad ? ' · con perspectiva' : c.track.seed2 ? ' · con giro y escala' : '')
    );
    renderPanel();
  }
  renderTimeline();
  commit();
}

export function updTrackUI() {
  const b = $('#progBar');
  if (b) b.style.width = S.trackProg * 100 + '%';
  const st = $('#trkStat');
  if (st && S.tracking) st.textContent = 'Analizando… ' + Math.round(S.trackProg * 100) + '%';
}
