import { $, S } from './state.js';
import { clamp, toast } from './util.js';
import { seekTo } from './clips.js';
import { pause } from './playback.js';
import { renderPanel } from './panel.js';
import { renderTimeline } from './timeline-ui.js';
import { commit } from './project.js';

/* ---------- rastreo (template matching ZNCC) ----------
   Rastreo 2D por punto:
   1. Cada cuadro se reduce a AW px de ancho, se pasa a gris y se desenfoca
      (dos pasadas de caja 3×3) para tolerar rotación, ruido y compresión.
   2. Se busca el parche de referencia en una ventana ±R alrededor de la
      posición predicha (posición + velocidad) con correlación cruzada
      normalizada (ZNCC), contra dos plantillas: la original y una adaptativa.
   3. Ajuste subpíxel con parábola sobre el mejor puntaje.
   4. Si el puntaje cae, se "deja correr" con la velocidad unos cuadros
      (oclusiones cortas) antes de declarar el objeto perdido.
*/
const AW = 400;          // ancho de análisis
const DT = 1 / 15;       // paso de tiempo (15 muestras por segundo)
const PR = 10;           // radio del parche  (21×21)
const SR = 24;           // radio de búsqueda
const MIN_SCORE = 0.3;   // por debajo, el cuadro no cuenta como encontrado
const ADAPT_SCORE = 0.5; // por encima, la plantilla adaptativa se actualiza
const MAX_MISSES = 4;    // cuadros seguidos que puede predecir sin encontrar
const RECOVER_SCORE = 0.55; // puntaje mínimo para recuperar tras perderlo

function toGrayBlur(data, w, h) {
  const g = new Float32Array(w * h), t = new Float32Array(w * h);
  for (let i = 0; i < g.length; i++) g[i] = .299 * data[i * 4] + .587 * data[i * 4 + 1] + .114 * data[i * 4 + 2];
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) {
      const a = g[o + Math.max(0, x - 1)], b = g[o + x], c = g[o + Math.min(w - 1, x + 1)]; t[o + x] = (a + b + c) / 3 } }
    for (let y = 0; y < h; y++) { const ym = Math.max(0, y - 1) * w, yp = Math.min(h - 1, y + 1) * w, o = y * w;
      for (let x = 0; x < w; x++) g[o + x] = (t[ym + x] + t[o + x] + t[yp + x]) / 3 }
  }
  return g;
}

export async function runTrack(c, silent) {
  if (!c || !c.track || !c.track.seed || S.tracking) return;
  if (c.missing) { toast('Falta el video de este clip: vuelve a vincularlo en Medios'); return }
  pause(); S.tracking = c.id; S.trackCancel = false; S.trackProg = 0; if (!silent) renderPanel();
  const AH = Math.max(16, Math.round(AW * c.sh / c.sw));
  const ac = document.createElement('canvas'); ac.width = AW; ac.height = AH;
  const ag = ac.getContext('2d', { willReadFrequently: true });
  let tcv, tg;
  if (c.kind === 'demo') { tcv = document.createElement('canvas'); tcv.width = c.sw; tcv.height = c.sh; tg = tcv.getContext('2d') }
  else { try { c.el.muted = true; await c.el.play(); c.el.pause() } catch (e) { } }

  const grab = async t => {
    if (c.kind === 'demo') { c.draw(tg, t, c.sw, c.sh); ag.drawImage(tcv, 0, 0, AW, AH) }
    else { await seekTo(c.el, t); ag.drawImage(c.el, 0, 0, AW, AH) }
    return toGrayBlur(ag.getImageData(0, 0, AW, AH).data, AW, AH);
  };
  const N = 2 * PR + 1, NN = N * N;
  const patch = (f, cx, cy) => {
    cx = Math.round(clamp(cx, PR, AW - PR - 1)); cy = Math.round(clamp(cy, PR, AH - PR - 1));
    const p = new Float32Array(NN);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) p[j * N + i] = f[(cy - PR + j) * AW + cx - PR + i];
    return p;
  };
  const norm = p => {
    let m = 0; for (const v of p) m += v; m /= p.length;
    const q = new Float32Array(p.length); let s = 0;
    for (let i = 0; i < p.length; i++) { q[i] = p[i] - m; s += q[i] * q[i] }
    return { q, n: Math.sqrt(s) || 1 };
  };
  const W2 = 2 * SR + 1, grid = new Float32Array(W2 * W2);
  const match = (f, Ts, cx, cy) => {
    const x0 = Math.round(cx), y0 = Math.round(cy); let best = { x: x0, y: y0, s: -2 };
    grid.fill(-2);
    for (let y = y0 - SR; y <= y0 + SR; y++) {
      if (y < PR || y >= AH - PR) continue;
      for (let x = x0 - SR; x <= x0 + SR; x++) {
        if (x < PR || x >= AW - PR) continue;
        let m = 0;
        for (let j = 0; j < N; j++) { const row = (y - PR + j) * AW + x - PR; for (let i = 0; i < N; i++) m += f[row + i] }
        m /= NN;
        let den = 0; const nums = new Array(Ts.length).fill(0);
        for (let j = 0; j < N; j++) { const row = (y - PR + j) * AW + x - PR;
          for (let i = 0; i < N; i++) { const v = f[row + i] - m, k = j * N + i; den += v * v;
            for (let q = 0; q < Ts.length; q++) nums[q] += v * Ts[q].q[k] } }
        const dn = Math.sqrt(den) || 1; let s = -2;
        for (let q = 0; q < Ts.length; q++) s = Math.max(s, nums[q] / (Ts[q].n * dn));
        grid[(y - y0 + SR) * W2 + (x - x0 + SR)] = s;
        if (s > best.s) best = { x, y, s };
      }
    }
    const g = (dx, dy) => { const gx = best.x + dx - x0 + SR, gy = best.y + dy - y0 + SR;
      if (gx < 0 || gy < 0 || gx >= W2 || gy >= W2) return null; const v = grid[gy * W2 + gx]; return v > -2 ? v : null };
    let fx = best.x, fy = best.y;
    const l = g(-1, 0), rr = g(1, 0), u = g(0, -1), d = g(0, 1);
    if (l != null && rr != null) { const den = l - 2 * best.s + rr; if (den < 0) fx += clamp(.5 * (l - rr) / den, -.5, .5) }
    if (u != null && d != null) { const den = u - 2 * best.s + d; if (den < 0) fy += clamp(.5 * (u - d) / den, -.5, .5) }
    return { x: fx, y: fy, s: best.s };
  };

  const seed = c.track.seed, f0 = await grab(seed.t), px = seed.x * AW, py = seed.y * AH;
  const base = patch(f0, px, py), baseN = norm(base);
  const fwd = [], back = [], steps = Math.max(1, Math.ceil((c.out - c.in) / DT));
  let done = 0, lost = false;
  const rebuild = () => { c.track.pts = [...back.slice().reverse(), { t: seed.t, x: seed.x, y: seed.y }, ...fwd] };

  for (const dir of [1, -1]) {
    let x = px, y = py, vx = 0, vy = 0, misses = 0;
    const tpl = Float32Array.from(base), arr = dir > 0 ? fwd : back, pending = [];
    for (let t = seed.t + dir * DT; dir > 0 ? t <= c.out + 1e-6 : t >= c.in - 1e-6; t += dir * DT) {
      if (S.trackCancel) break;
      const f = await grab(clamp(t, 0, c.dur - .001));
      const m = match(f, [baseN, norm(tpl)], x + vx, y + vy);
      const outside = x + vx < PR || x + vx > AW - PR - 1 || y + vy < PR || y + vy > AH - PR - 1;
      if (outside) { lost = true; break }                       // el objeto sale de cuadro
      // tras cuadros perdidos se exige más confianza para no "recuperar" otra cosa
      if (m.s < (misses ? RECOVER_SCORE : MIN_SCORE)) {
        if (++misses > MAX_MISSES) { lost = true; break }
        x += vx; y += vy; pending.push({ t, x: x / AW, y: y / AH });
      } else {
        // recuperado: los cuadros predichos cuentan solo si se volvió a encontrar
        arr.push(...pending); pending.length = 0; misses = 0;
        vx = vx * .3 + (m.x - x) * .7; vy = vy * .3 + (m.y - y) * .7; x = m.x; y = m.y;
        if (m.s > ADAPT_SCORE) { const np = patch(f, x, y); for (let i = 0; i < tpl.length; i++) tpl[i] = tpl[i] * .65 + np[i] * .35 }
        arr.push({ t, x: x / AW, y: y / AH });
      }
      done++;
      if (done % 3 === 0) { rebuild(); S.trackProg = Math.min(.99, done / steps); updTrackUI(); await new Promise(r => setTimeout(r, 0)) }
    }
  }
  rebuild();
  const P = c.track.pts;
  if (P.length > 4) c.track.pts = P.map((p, i) => {
    if (i === 0 || i === P.length - 1) return p; const a = P[i - 1], b = P[i + 1];
    return { t: p.t, x: (a.x + p.x * 2 + b.x) / 4, y: (a.y + p.y * 2 + b.y) / 4 };
  });
  c.track.lost = lost; c.track.cancelled = S.trackCancel;
  if (c.el) c.el.muted = false;
  S.tracking = null; S.trackProg = 1;
  if (!silent) { toast(S.trackCancel ? 'Rastreo detenido' : lost ? 'Rastreo listo: el objeto se perdió en una parte del clip' : 'Rastreo listo: ' + c.track.pts.length + ' puntos'); renderPanel() }
  renderTimeline();
  commit();
}

export function updTrackUI() {
  const b = $('#progBar'); if (b) b.style.width = (S.trackProg * 100) + '%';
  const st = $('#trkStat'); if (st && S.tracking) st.textContent = 'Analizando… ' + Math.round(S.trackProg * 100) + '%';
}
