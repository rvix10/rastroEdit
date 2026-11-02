import { $, S } from './state.js';
import { clamp, toast } from './util.js';
import { seekTo } from './clips.js';
import { pause } from './playback.js';
import { renderPanel } from './panel.js';
import { renderTimeline } from './timeline-ui.js';
import { commit } from './project.js';

/* ---------- rastreo (template matching ZNCC) ----------
   Rastreo 2D por punto (uno o dos; con dos se calcula también giro y escala, ver trackXform en render.js):
   1. Cada cuadro se reduce a AW px de ancho, se pasa a gris y se desenfoca
      (dos pasadas de caja 3×3) para tolerar rotación, ruido y compresión.
   2. Se busca el parche de referencia en una ventana ±R alrededor de la
      posición predicha (posición + velocidad) con correlación cruzada
      normalizada (ZNCC), contra dos plantillas: la original y una adaptativa.
   3. Ajuste subpíxel con parábola sobre el mejor puntaje.
   4. Si el puntaje cae, se "deja correr" con la velocidad unos cuadros
      (oclusiones cortas) antes de declarar el objeto perdido.
*/
const AW = 400; // ancho de análisis
const DT = 1 / 15; // paso de tiempo (15 muestras por segundo)
const PR = 10; // radio del parche  (21×21)
const SR = 24; // radio de búsqueda
const MIN_SCORE = 0.3; // por debajo, el cuadro no cuenta como encontrado
const ADAPT_SCORE = 0.5; // por encima, la plantilla adaptativa se actualiza
const MAX_MISSES = 4; // cuadros seguidos que puede predecir sin encontrar
const RECOVER_SCORE = 0.55; // puntaje mínimo para recuperar tras perderlo

function toGrayBlur(data, w, h) {
  const g = new Float32Array(w * h),
    t = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        const a = g[o + Math.max(0, x - 1)],
          b = g[o + x],
          c = g[o + Math.min(w - 1, x + 1)];
        t[o + x] = (a + b + c) / 3;
      }
    }
    for (let y = 0; y < h; y++) {
      const ym = Math.max(0, y - 1) * w,
        yp = Math.min(h - 1, y + 1) * w,
        o = y * w;
      for (let x = 0; x < w; x++) g[o + x] = (t[ym + x] + t[o + x] + t[yp + x]) / 3;
    }
  }
  return g;
}

export async function runTrack(c, silent) {
  if (!c || !c.track || !c.track.seed || S.tracking) return;
  if (c.missing) {
    toast('Falta el video de este clip: vuelve a vincularlo en Medios');
    return;
  }
  pause();
  S.tracking = c.id;
  S.trackCancel = false;
  S.trackProg = 0;
  if (!silent) renderPanel();
  const AH = Math.max(16, Math.round((AW * c.sh) / c.sw));
  const ac = document.createElement('canvas');
  ac.width = AW;
  ac.height = AH;
  const ag = ac.getContext('2d', { willReadFrequently: true });
  let tcv, tg;
  if (c.kind === 'demo') {
    tcv = document.createElement('canvas');
    tcv.width = c.sw;
    tcv.height = c.sh;
    tg = tcv.getContext('2d');
  } else {
    try {
      c.el.muted = true;
      await c.el.play();
      c.el.pause();
    } catch (e) {}
  }

  const grab = async t => {
    if (c.kind === 'demo') {
      c.draw(tg, t, c.sw, c.sh);
      ag.drawImage(tcv, 0, 0, AW, AH);
    } else {
      await seekTo(c.el, t);
      ag.drawImage(c.el, 0, 0, AW, AH);
    }
    return toGrayBlur(ag.getImageData(0, 0, AW, AH).data, AW, AH);
  };
  const N = 2 * PR + 1,
    NN = N * N;
  const patch = (f, cx, cy) => {
    cx = Math.round(clamp(cx, PR, AW - PR - 1));
    cy = Math.round(clamp(cy, PR, AH - PR - 1));
    const p = new Float32Array(NN);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) p[j * N + i] = f[(cy - PR + j) * AW + cx - PR + i];
    return p;
  };
  // Parche de f alrededor de (cx, cy) visto girado `rot` y escalado `sc`: así se ve la plantilla original
  // cuando el objeto ya giró/cambió de tamaño (rastreo de 2 puntos). Muestreo bilineal.
  const patchWarp = (f, cx, cy, rot, sc) => {
    const p = new Float32Array(NN),
      cs = Math.cos(-rot) / sc,
      sn = Math.sin(-rot) / sc;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const dx = i - PR,
          dy = j - PR;
        const x = clamp(cx + cs * dx - sn * dy, 0, AW - 1.001),
          y = clamp(cy + sn * dx + cs * dy, 0, AH - 1.001);
        const x0 = x | 0,
          y0 = y | 0,
          fx = x - x0,
          fy = y - y0,
          o = y0 * AW + x0;
        p[j * N + i] = (f[o] * (1 - fx) + f[o + 1] * fx) * (1 - fy) + (f[o + AW] * (1 - fx) + f[o + AW + 1] * fx) * fy;
      }
    return p;
  };
  const norm = p => {
    let m = 0;
    for (const v of p) m += v;
    m /= p.length;
    const q = new Float32Array(p.length);
    let s = 0;
    for (let i = 0; i < p.length; i++) {
      q[i] = p[i] - m;
      s += q[i] * q[i];
    }
    return { q, n: Math.sqrt(s) || 1 };
  };
  const W2 = 2 * SR + 1,
    grid = new Float32Array(W2 * W2);
  const match = (f, Ts, cx, cy) => {
    const x0 = Math.round(cx),
      y0 = Math.round(cy);
    let best = { x: x0, y: y0, s: -2 };
    grid.fill(-2);
    for (let y = y0 - SR; y <= y0 + SR; y++) {
      if (y < PR || y >= AH - PR) continue;
      for (let x = x0 - SR; x <= x0 + SR; x++) {
        if (x < PR || x >= AW - PR) continue;
        let m = 0;
        for (let j = 0; j < N; j++) {
          const row = (y - PR + j) * AW + x - PR;
          for (let i = 0; i < N; i++) m += f[row + i];
        }
        m /= NN;
        let den = 0;
        const nums = new Array(Ts.length).fill(0);
        for (let j = 0; j < N; j++) {
          const row = (y - PR + j) * AW + x - PR;
          for (let i = 0; i < N; i++) {
            const v = f[row + i] - m,
              k = j * N + i;
            den += v * v;
            for (let q = 0; q < Ts.length; q++) nums[q] += v * Ts[q].q[k];
          }
        }
        const dn = Math.sqrt(den) || 1;
        let s = -2;
        for (let q = 0; q < Ts.length; q++) s = Math.max(s, nums[q] / (Ts[q].n * dn));
        grid[(y - y0 + SR) * W2 + (x - x0 + SR)] = s;
        if (s > best.s) best = { x, y, s };
      }
    }
    const g = (dx, dy) => {
      const gx = best.x + dx - x0 + SR,
        gy = best.y + dy - y0 + SR;
      if (gx < 0 || gy < 0 || gx >= W2 || gy >= W2) return null;
      const v = grid[gy * W2 + gx];
      return v > -2 ? v : null;
    };
    let fx = best.x,
      fy = best.y;
    const l = g(-1, 0),
      rr = g(1, 0),
      u = g(0, -1),
      d = g(0, 1);
    if (l != null && rr != null) {
      const den = l - 2 * best.s + rr;
      if (den < 0) fx += clamp((0.5 * (l - rr)) / den, -0.5, 0.5);
    }
    if (u != null && d != null) {
      const den = u - 2 * best.s + d;
      if (den < 0) fy += clamp((0.5 * (u - d)) / den, -0.5, 0.5);
    }
    return { x: fx, y: fy, s: best.s };
  };

  // Uno o dos puntos (con dos se obtiene además giro y escala). Se siguen juntos, sobre los mismos cuadros.
  const seed = c.track.seed,
    seed2 = c.track.seed2 || null,
    f0 = await grab(seed.t);
  const seeds = [seed, ...(seed2 ? [seed2] : [])].map(p => ({ x: p.x * AW, y: p.y * AH }));
  const bases = seeds.map(p => {
    const b = patch(f0, p.x, p.y);
    return { b, n: norm(b) };
  });
  const fwd = [],
    back = [],
    steps = Math.max(1, Math.ceil((c.out - c.in) / DT));
  let done = 0,
    lost = false;
  const entry = (t, st) => ({
    t,
    x: st[0].x / AW,
    y: st[0].y / AH,
    ...(st[1] ? { x2: st[1].x / AW, y2: st[1].y / AH } : {}),
  });
  const first = { t: seed.t, x: seed.x, y: seed.y, ...(seed2 ? { x2: seed2.x, y2: seed2.y } : {}) };
  const rebuild = () => {
    c.track.pts = [...back.slice().reverse(), first, ...fwd];
  };
  const outside = (x, y) => x < PR || x > AW - PR - 1 || y < PR || y > AH - PR - 1;

  for (const dir of [1, -1]) {
    const st = seeds.map((p, k) => ({ x: p.x, y: p.y, vx: 0, vy: 0, misses: 0, tpl: Float32Array.from(bases[k].b) }));
    const arr = dir > 0 ? fwd : back,
      pending = [];
    for (let t = seed.t + dir * DT; dir > 0 ? t <= c.out + 1e-6 : t >= c.in - 1e-6; t += dir * DT) {
      if (S.trackCancel) break;
      const f = await grab(clamp(t, 0, c.dur - 0.001));
      let stop = false;
      // Con 2 puntos: giro y escala previstos para este cuadro, para deformar las plantillas originales
      let warp = null;
      if (st.length === 2) {
        const ax = st[1].x + st[1].vx - (st[0].x + st[0].vx),
          ay = st[1].y + st[1].vy - (st[0].y + st[0].vy),
          bx = seeds[1].x - seeds[0].x,
          by = seeds[1].y - seeds[0].y;
        const sc = Math.hypot(ax, ay) / (Math.hypot(bx, by) || 1);
        if (sc > 0.2 && sc < 5) warp = { rot: Math.atan2(ay, ax) - Math.atan2(by, bx), sc };
      }
      for (let k = 0; k < st.length && !stop; k++) {
        const p = st[k],
          px = p.x + p.vx,
          py = p.y + p.vy;
        if (outside(px, py)) {
          stop = true; // el punto sale de cuadro
          break;
        }
        const base = warp ? norm(patchWarp(f0, seeds[k].x, seeds[k].y, warp.rot, warp.sc)) : bases[k].n;
        const m = match(f, [base, norm(p.tpl)], px, py);
        // tras cuadros perdidos se exige más confianza para no "recuperar" otra cosa
        if (m.s < (p.misses ? RECOVER_SCORE : MIN_SCORE)) {
          if (++p.misses > MAX_MISSES) stop = true;
          p.x = px;
          p.y = py;
        } else {
          p.misses = 0;
          p.vx = p.vx * 0.3 + (m.x - p.x) * 0.7;
          p.vy = p.vy * 0.3 + (m.y - p.y) * 0.7;
          p.x = m.x;
          p.y = m.y;
          if (m.s > ADAPT_SCORE) {
            const np = patch(f, p.x, p.y);
            for (let i = 0; i < p.tpl.length; i++) p.tpl[i] = p.tpl[i] * 0.65 + np[i] * 0.35;
          }
        }
      }
      if (stop) {
        lost = true;
        break;
      }
      // Los cuadros predichos (sin encontrar) cuentan solo si después se vuelven a encontrar todos los puntos
      if (st.some(p => p.misses)) pending.push(entry(t, st));
      else {
        arr.push(...pending, entry(t, st));
        pending.length = 0;
      }
      done++;
      if (done % 3 === 0) {
        rebuild();
        S.trackProg = Math.min(0.99, done / steps);
        updTrackUI();
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }
  rebuild();
  const P = c.track.pts;
  const sm = (a, p, b, k) => (a[k] + p[k] * 2 + b[k]) / 4;
  if (P.length > 4)
    c.track.pts = P.map((p, i) => {
      if (i === 0 || i === P.length - 1) return p;
      const a = P[i - 1],
        b = P[i + 1];
      const q = { t: p.t, x: sm(a, p, b, 'x'), y: sm(a, p, b, 'y') };
      if (p.x2 != null) ((q.x2 = sm(a, p, b, 'x2')), (q.y2 = sm(a, p, b, 'y2')));
      return q;
    });
  c.track.lost = lost;
  c.track.cancelled = S.trackCancel;
  if (c.el) c.el.muted = false;
  S.tracking = null;
  S.trackProg = 1;
  if (!silent) {
    toast(
      S.trackCancel
        ? 'Rastreo detenido'
        : lost
          ? 'Rastreo listo: el objeto se perdió en una parte del clip'
          : 'Rastreo listo: ' + c.track.pts.length + ' muestras' + (c.track.seed2 ? ' · con giro y escala' : '')
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
