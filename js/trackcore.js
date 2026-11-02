/* ---------- núcleo del rastreo (sin DOM: corre en un Web Worker o en el hilo principal) ----------
   Template matching con correlación cruzada normalizada (ZNCC) sobre cuadros reducidos a AW px de ancho:
   1. Cada cuadro se pasa a gris y se desenfoca (dos pasadas de caja 3×3) para tolerar rotación y compresión.
   2. Cada punto se busca en una ventana ±SR alrededor de la posición predicha (posición + velocidad),
      contra la plantilla original y una adaptativa. Con 2 puntos, la original se deforma con el giro y la
      escala previstos (si no, al girar el objeto deja de parecerse y el rastreo se desvía).
   3. Ajuste subpíxel con parábola. Si el puntaje cae, se predice unos cuadros (oclusiones cortas).
   La coordinación (qué cuadros, en qué orden, guardar el resultado) está en tracker.js.
*/
export const AW = 400; // ancho de análisis
export const PR = 10; // radio del parche (21×21)
export const SR = 24; // radio de búsqueda
export const MIN_SCORE = 0.3; // por debajo, el cuadro no cuenta como encontrado
export const ADAPT_SCORE = 0.5; // por encima, la plantilla adaptativa se actualiza
export const MAX_MISSES = 4; // cuadros seguidos que puede predecir sin encontrar
export const RECOVER_SCORE = 0.55; // puntaje mínimo para recuperar tras perderlo

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const N = 2 * PR + 1,
  NN = N * N,
  W2 = 2 * SR + 1;

export function toGrayBlur(data, w, h) {
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

export class TrackCore {
  /**
   * @param {number} AH alto de análisis
   * @param {Uint8ClampedArray} rgba0 cuadro de la semilla (AW×AH, RGBA)
   * @param {{x,y}[]} seeds 1 o 2 puntos, normalizados (0–1)
   */
  constructor(AH, rgba0, seeds) {
    this.AH = AH;
    this.grid = new Float32Array(W2 * W2);
    this.f0 = toGrayBlur(rgba0, AW, AH);
    this.seeds = seeds.map(p => ({ x: p.x * AW, y: p.y * AH }));
    this.bases = this.seeds.map(p => {
      const b = this.patch(this.f0, p.x, p.y);
      return { b, n: this.norm(b) };
    });
  }

  patch(f, cx, cy) {
    const AH = this.AH;
    cx = Math.round(clamp(cx, PR, AW - PR - 1));
    cy = Math.round(clamp(cy, PR, AH - PR - 1));
    const p = new Float32Array(NN);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) p[j * N + i] = f[(cy - PR + j) * AW + cx - PR + i];
    return p;
  }
  // Parche de f alrededor de (cx, cy) visto girado `rot` y escalado `sc`. Muestreo bilineal.
  patchWarp(f, cx, cy, rot, sc) {
    const AH = this.AH,
      p = new Float32Array(NN),
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
  }
  norm(p) {
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
  }
  match(f, Ts, cx, cy) {
    const AH = this.AH,
      grid = this.grid;
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
  }

  /** Empieza una pasada (hacia adelante o hacia atrás) desde la semilla. */
  begin() {
    this.st = this.seeds.map((p, k) => ({
      x: p.x,
      y: p.y,
      vx: 0,
      vy: 0,
      misses: 0,
      tpl: Float32Array.from(this.bases[k].b),
    }));
  }

  /**
   * Procesa el siguiente cuadro de la pasada. Devuelve { pts: [{x, y, misses}] (normalizados), stop }.
   * stop = el punto salió de cuadro o se perdió demasiados cuadros seguidos.
   */
  step(rgba) {
    const AH = this.AH,
      st = this.st,
      seeds = this.seeds;
    const f = toGrayBlur(rgba, AW, AH);
    const outside = (x, y) => x < PR || x > AW - PR - 1 || y < PR || y > AH - PR - 1;
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
      const base = warp
        ? this.norm(this.patchWarp(this.f0, seeds[k].x, seeds[k].y, warp.rot, warp.sc))
        : this.bases[k].n;
      const m = this.match(f, [base, this.norm(p.tpl)], px, py);
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
          const np = this.patch(f, p.x, p.y);
          for (let i = 0; i < p.tpl.length; i++) p.tpl[i] = p.tpl[i] * 0.65 + np[i] * 0.35;
        }
      }
    }
    return { pts: st.map(p => ({ x: p.x / AW, y: p.y / AH, misses: p.misses })), stop };
  }
}
