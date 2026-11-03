/* ---------- rastreo planar (4 esquinas): sigue un plano en perspectiva (terreno, pantalla, letrero) ----------
   Sin DOM: lo usa trackcore.js (en el Worker o en el hilo principal) y render.js (para dibujar).
   Por cada cuadro:
   1. Cuadro a cuadro: puntos con textura dentro del área (en el cuadro anterior) se buscan en el actual con ZNCC
      alrededor de donde los pone el movimiento anterior. Con RANSAC se ajusta la homografía que los explica a todos
      (los que no encajan —árboles, sombras, algo que pasa— quedan fuera).
   2. Corrección contra el cuadro de las esquinas: sus puntos, deformados con esa homografía, se buscan otra vez
      cerca. Así el error no se acumula a lo largo del clip. Si no alcanza (vista muy distinta), queda el paso 1.
   Homografías: arreglos de 9 números (fila por fila), del cuadro de las esquinas al cuadro actual.
   RANSAC usa un generador con semilla fija: el resultado es idéntico en el Worker y en el hilo principal.
*/
export const PPR = 8; // radio del parche (17×17)
const SR1 = 14; // búsqueda cuadro a cuadro
const SR2 = 4; // búsqueda contra el cuadro de las esquinas (con buena predicción)
const SR2_WIDE = 10; // … si el paso 1 no funcionó
const MAX_FEATS = 70;
const MIN_INLIERS = 8;
const PMAX_MISSES = 6;

/* ---------- homografías ---------- */
export const H_ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export function hApply(h, x, y) {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}
/** a ∘ b: primero b, después a */
export function hMul(a, b) {
  const r = new Array(9);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return norm9(r);
}
export function hInv(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det) return null;
  return norm9([
    A / det,
    -(b * i - c * h) / det,
    (b * f - c * e) / det,
    B / det,
    (a * i - c * g) / det,
    -(a * f - c * d) / det,
    C / det,
    -(a * h - b * g) / det,
    (a * e - b * d) / det,
  ]);
}
function norm9(r) {
  const s = Math.abs(r[8]) > 1e-12 ? r[8] : Math.hypot(...r) || 1;
  return r.map(v => v / s);
}
// Traslación y escala para que los puntos queden centrados con distancia media √2 (DLT de Hartley)
function normT(P, idx) {
  let mx = 0,
    my = 0;
  for (const k of idx) {
    mx += P[k][0];
    my += P[k][1];
  }
  mx /= idx.length;
  my /= idx.length;
  let d = 0;
  for (const k of idx) d += Math.hypot(P[k][0] - mx, P[k][1] - my);
  const s = Math.SQRT2 / (d / idx.length || 1);
  return { s, mx, my };
}
/** Homografía que lleva src[k] → dst[k] (k en idx), por mínimos cuadrados. null si es degenerada. */
export function hFit(src, dst, idx) {
  idx = idx || src.map((_, k) => k);
  if (idx.length < 4) return null;
  const a = normT(src, idx),
    b = normT(dst, idx);
  const M = Array.from({ length: 8 }, () => new Float64Array(9)); // [AᵀA | Aᵀy]
  const add = (row, y) => {
    for (let i = 0; i < 8; i++) {
      if (!row[i]) continue;
      for (let j = 0; j < 8; j++) M[i][j] += row[i] * row[j];
      M[i][8] += row[i] * y;
    }
  };
  for (const k of idx) {
    const x = (src[k][0] - a.mx) * a.s,
      y = (src[k][1] - a.my) * a.s,
      u = (dst[k][0] - b.mx) * b.s,
      v = (dst[k][1] - b.my) * b.s;
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -v * x, -v * y], v);
  }
  // Gauss con pivoteo parcial
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-10) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < 8; r++) {
      const k = M[r][c] / M[c][c];
      if (k) for (let j = c; j < 9; j++) M[r][j] -= k * M[c][j];
    }
  }
  const h = new Array(8);
  for (let r = 7; r >= 0; r--) {
    let s = M[r][8];
    for (let j = r + 1; j < 8; j++) s -= M[r][j] * h[j];
    h[r] = s / M[r][r];
  }
  const Hn = [...h, 1];
  // H = Tdst⁻¹ · Hn · Tsrc
  const Ts = [a.s, 0, -a.s * a.mx, 0, a.s, -a.s * a.my, 0, 0, 1],
    Tdi = [1 / b.s, 0, b.mx, 0, 1 / b.s, b.my, 0, 0, 1];
  const H = hMul(Tdi, hMul(Hn, Ts));
  return H.every(Number.isFinite) ? H : null;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const err2 = (h, s, d) => {
  const [x, y] = hApply(h, s[0], s[1]);
  return (x - d[0]) ** 2 + (y - d[1]) ** 2;
};
/** RANSAC: homografía robusta y sus inliers (índices). thr en px. */
export function ransacH(src, dst, thr, iters, rng) {
  const n = src.length;
  if (n < 4) return null;
  const t2 = thr * thr;
  const inliersOf = h => {
    const r = [];
    for (let k = 0; k < n; k++) if (err2(h, src[k], dst[k]) < t2) r.push(k);
    return r;
  };
  const tri = (p, q, r) => Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  let best = null;
  for (let it = 0; it < iters; it++) {
    const s = [];
    while (s.length < 4) {
      const k = Math.floor(rng() * n);
      if (!s.includes(k)) s.push(k);
    }
    const P = s.map(k => src[k]);
    // muestras casi alineadas dan homografías inestables
    if (Math.min(tri(P[0], P[1], P[2]), tri(P[0], P[1], P[3]), tri(P[0], P[2], P[3]), tri(P[1], P[2], P[3])) < 4)
      continue;
    const h = hFit(src, dst, s);
    if (!h) continue;
    const inl = inliersOf(h);
    if (!best || inl.length > best.inl.length) best = { h, inl };
    if (best.inl.length > n * 0.9) break;
  }
  if (!best || best.inl.length < 4) return null;
  for (let r = 0; r < 2; r++) {
    const h = hFit(src, dst, best.inl);
    if (!h) break;
    const inl = inliersOf(h);
    if (inl.length < best.inl.length) break;
    best = { h, inl };
  }
  return best;
}

/* ---------- cuadriláteros (arreglos planos [x0,y0, …, x3,y3]) ---------- */
/** Cruce de las diagonales: el "centro" que se conserva en perspectiva. */
export function quadCenter(q) {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = q;
  const d = (x0 - x2) * (y1 - y3) - (y0 - y2) * (x1 - x3);
  if (Math.abs(d) < 1e-12) return [(x0 + x1 + x2 + x3) / 4, (y0 + y1 + y2 + y3) / 4];
  const a = x0 * y2 - y0 * x2,
    b = x1 * y3 - y1 * x3;
  return [(a * (x1 - x3) - (x0 - x2) * b) / d, (a * (y1 - y3) - (y0 - y2) * b) / d];
}
export function quadArea(q) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    s += q[i * 2] * q[j * 2 + 1] - q[j * 2] * q[i * 2 + 1];
  }
  return s / 2;
}
/** Convexo y con la orientación dada (signo del área). */
export function quadConvex(q, sign) {
  for (let i = 0; i < 4; i++) {
    const a = i * 2,
      b = ((i + 1) % 4) * 2,
      c = ((i + 2) % 4) * 2;
    const cr = (q[b] - q[a]) * (q[c + 1] - q[b + 1]) - (q[b + 1] - q[a + 1]) * (q[c] - q[b]);
    if (cr * sign <= 0) return false;
  }
  return true;
}
/** Ordena 4 puntos {x,y} alrededor de su centro, empezando por el de arriba a la izquierda. */
export function orderQuad(pts, sx = 1, sy = 1) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4,
    cy = pts.reduce((s, p) => s + p.y, 0) / 4;
  const o = pts
    .slice()
    .sort((a, b) => Math.atan2((a.y - cy) * sy, (a.x - cx) * sx) - Math.atan2((b.y - cy) * sy, (b.x - cx) * sx));
  let k = 0;
  for (let i = 1; i < 4; i++) if (o[i].x * sx + o[i].y * sy < o[k].x * sx + o[k].y * sy) k = i;
  return [...o.slice(k), ...o.slice(0, k)];
}
const mapQuad = (h, Q) => Q.flatMap(([x, y]) => hApply(h, x, y));
function insideQuad(q, x, y) {
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = i * 2,
      b = ((i + 1) % 4) * 2;
    const cr = (q[b] - q[a]) * (y - q[a + 1]) - (q[b + 1] - q[a + 1]) * (x - q[a]);
    if (!s) s = Math.sign(cr);
    else if (Math.sign(cr) !== s) return false;
  }
  return true;
}
// El área achicada hacia el centro: los bordes suelen tener árboles, cercos o sombras que no están en el plano
function shrink(q, k) {
  const [cx, cy] = quadCenter(q);
  return q.map((v, i) => (i % 2 ? cy + (v - cy) * k : cx + (v - cx) * k));
}

/* ---------- imágenes en gris (Float32Array W×H) ---------- */
class Integral {
  constructor(f, W, H) {
    this.f = f;
    this.W = W;
    this.H = H;
    const I = new Float64Array((W + 1) * (H + 1)),
      I2 = new Float64Array((W + 1) * (H + 1));
    for (let y = 0; y < H; y++) {
      let s = 0,
        s2 = 0;
      for (let x = 0; x < W; x++) {
        const v = f[y * W + x];
        s += v;
        s2 += v * v;
        const o = (y + 1) * (W + 1) + x + 1;
        I[o] = I[o - W - 1] + s;
        I2[o] = I2[o - W - 1] + s2;
      }
    }
    this.I = I;
    this.I2 = I2;
  }
  // suma de la ventana [x0, x1) × [y0, y1)
  box(A, x0, y0, x1, y1) {
    const W1 = this.W + 1;
    return A[y1 * W1 + x1] - A[y0 * W1 + x1] - A[y1 * W1 + x0] + A[y0 * W1 + x0];
  }
}
/** Puntos con buena textura (mínimo autovalor del tensor de estructura), separados al menos minD. */
function goodFeatures(f, W, H, q, maxN, minD, border) {
  const r = 4,
    step = 3,
    cand = [];
  // Gradientes al cuadrado acumulados en imágenes integrales
  const W1 = W + 1,
    Sxx = new Float64Array(W1 * (H + 1)),
    Syy = new Float64Array(W1 * (H + 1)),
    Sxy = new Float64Array(W1 * (H + 1));
  for (let y = 0; y < H; y++) {
    let a = 0,
      b = 0,
      c = 0;
    for (let x = 0; x < W; x++) {
      const gx = x > 0 && x < W - 1 ? (f[y * W + x + 1] - f[y * W + x - 1]) / 2 : 0,
        gy = y > 0 && y < H - 1 ? (f[(y + 1) * W + x] - f[(y - 1) * W + x]) / 2 : 0;
      a += gx * gx;
      b += gy * gy;
      c += gx * gy;
      const o = (y + 1) * W1 + x + 1;
      Sxx[o] = Sxx[o - W1] + a;
      Syy[o] = Syy[o - W1] + b;
      Sxy[o] = Sxy[o - W1] + c;
    }
  }
  const box = (A, x, y) =>
    A[(y + r + 1) * W1 + x + r + 1] -
    A[(y - r) * W1 + x + r + 1] -
    A[(y + r + 1) * W1 + x - r] +
    A[(y - r) * W1 + x - r];
  let mx = 0;
  for (let y = border; y < H - border; y += step)
    for (let x = border; x < W - border; x += step) {
      if (!insideQuad(q, x, y)) continue;
      const a = box(Sxx, x, y),
        b = box(Syy, x, y),
        c = box(Sxy, x, y);
      const e = (a + b) / 2 - Math.sqrt(((a - b) / 2) ** 2 + c * c);
      if (e > 0) {
        cand.push([e, x, y]);
        if (e > mx) mx = e;
      }
    }
  cand.sort((p, q2) => q2[0] - p[0] || p[2] - q2[2] || p[1] - q2[1]);
  const out = [],
    cell = minD,
    gw = Math.ceil(W / cell) + 1,
    taken = new Map();
  for (const [e, x, y] of cand) {
    if (e < mx * 0.05 || out.length >= maxN) break;
    const gx = Math.floor(x / cell),
      gy = Math.floor(y / cell);
    let ok = true;
    for (let j = -1; j <= 1 && ok; j++)
      for (let i = -1; i <= 1 && ok; i++) {
        const p = taken.get((gy + j) * gw + gx + i);
        if (p && (p[0] - x) ** 2 + (p[1] - y) ** 2 < minD * minD) ok = false;
      }
    if (!ok) continue;
    taken.set(gy * gw + gx, [x, y]);
    out.push([x, y]);
  }
  return out;
}
const N = 2 * PPR + 1,
  NN = N * N;
function tplNorm(p) {
  let m = 0;
  for (let i = 0; i < NN; i++) m += p[i];
  m /= NN;
  let s = 0;
  for (let i = 0; i < NN; i++) {
    p[i] -= m;
    s += p[i] * p[i];
  }
  const n = Math.sqrt(s);
  return n > 1e-3 * NN ? { q: p, n } : null; // sin textura: no sirve como plantilla
}
function tplAt(f, W, x, y) {
  const p = new Float32Array(NN);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) p[j * N + i] = f[(y - PPR + j) * W + x - PPR + i];
  return tplNorm(p);
}
// Parche del cuadro de referencia visto como se vería en (px, py) del cuadro actual (hi: actual → referencia)
function tplWarp(f0, W, H, hi, px, py) {
  const p = new Float32Array(NN);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const [x, y] = hApply(hi, px + i - PPR, py + j - PPR);
      if (!(x >= 0 && y >= 0 && x < W - 1 && y < H - 1)) return null;
      const x0 = x | 0,
        y0 = y | 0,
        fx = x - x0,
        fy = y - y0,
        o = y0 * W + x0;
      p[j * N + i] = (f0[o] * (1 - fx) + f0[o + 1] * fx) * (1 - fy) + (f0[o + W] * (1 - fx) + f0[o + W + 1] * fx) * fy;
    }
  return tplNorm(p);
}
/** ZNCC de la plantilla alrededor de (cx, cy) ±sr, con ajuste subpíxel. */
function zncc(img, t, cx, cy, sr) {
  const { f, W, H, I, I2 } = img,
    x0 = Math.round(cx),
    y0 = Math.round(cy),
    w2 = 2 * sr + 1,
    grid = new Float32Array(w2 * w2).fill(-2);
  let bx = 0,
    by = 0,
    bs = -2;
  for (let y = y0 - sr; y <= y0 + sr; y++) {
    if (y < PPR || y >= H - PPR) continue;
    for (let x = x0 - sr; x <= x0 + sr; x++) {
      if (x < PPR || x >= W - PPR) continue;
      let dot = 0;
      for (let j = 0; j < N; j++) {
        const row = (y - PPR + j) * W + x - PPR,
          k = j * N;
        for (let i = 0; i < N; i++) dot += f[row + i] * t.q[k + i];
      }
      const s1 = img.box(I, x - PPR, y - PPR, x + PPR + 1, y + PPR + 1),
        s2 = img.box(I2, x - PPR, y - PPR, x + PPR + 1, y + PPR + 1),
        v = s2 - (s1 * s1) / NN;
      const s = v > 1e-6 ? dot / (t.n * Math.sqrt(v)) : -1;
      grid[(y - y0 + sr) * w2 + x - x0 + sr] = s;
      if (s > bs) {
        bs = s;
        bx = x;
        by = y;
      }
    }
  }
  if (bs <= -2) return null;
  const g = (dx, dy) => {
    const gx = bx + dx - x0 + sr,
      gy = by + dy - y0 + sr;
    if (gx < 0 || gy < 0 || gx >= w2 || gy >= w2) return null;
    const v = grid[gy * w2 + gx];
    return v > -2 ? v : null;
  };
  let fx = bx,
    fy = by;
  const l = g(-1, 0),
    r = g(1, 0),
    u = g(0, -1),
    d = g(0, 1);
  if (l != null && r != null) {
    const den = l - 2 * bs + r;
    if (den < 0) fx += Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / den));
  }
  if (u != null && d != null) {
    const den = u - 2 * bs + d;
    if (den < 0) fy += Math.max(-0.5, Math.min(0.5, (0.5 * (u - d)) / den));
  }
  // en el borde de la búsqueda el máximo no es confiable (puede estar más allá)
  const edge = Math.abs(bx - x0) === sr || Math.abs(by - y0) === sr;
  return { x: fx, y: fy, s: edge ? Math.min(bs, 0) : bs };
}

export class PlanarCore {
  /**
   * @param {number} W ancho de análisis
   * @param {number} H alto de análisis
   * @param {Float32Array} f0 cuadro de las esquinas, en gris
   * @param {number[][]} quad 4 esquinas [x, y] en px de análisis, en orden
   */
  constructor(W, H, f0, quad) {
    this.W = W;
    this.H = H;
    this.f0 = f0;
    this.Q0 = quad;
    this.q0 = quad.flat();
    this.sign = Math.sign(quadArea(this.q0)) || 1;
    this.area0 = Math.abs(quadArea(this.q0));
    this.Qs = shrink(this.q0, 0.88);
    this.refFeats = goodFeatures(f0, W, H, this.Qs, MAX_FEATS + 20, 9, PPR + 1);
  }
  begin() {
    this.Hc = H_ID.slice();
    this.S = H_ID.slice();
    this.prev = this.f0;
    this.misses = 0;
    this.k = 0;
  }
  valid(q) {
    const a = Math.abs(quadArea(q));
    return quadConvex(q, this.sign) && a > this.area0 * 0.02 && a < this.area0 * 60;
  }
  /** Siguiente cuadro (gris). Devuelve { q (px de análisis), misses, stop, inl }. */
  step(f) {
    const { W, H } = this,
      img = new Integral(f, W, H),
      rng = mulberry32(0x5eed + ++this.k);
    const Hpred = hMul(this.S, this.Hc);
    // 1. Cuadro a cuadro
    const qs = shrink(mapQuad(this.Hc, this.Q0), 0.88);
    const feats = goodFeatures(this.prev, W, H, qs, MAX_FEATS, 9, PPR + 1);
    const s1 = [],
      d1 = [];
    for (const [x, y] of feats) {
      const [px, py] = hApply(this.S, x, y);
      if (!(px > -SR1 && py > -SR1 && px < W + SR1 && py < H + SR1)) continue;
      const t = tplAt(this.prev, W, x, y);
      if (!t) continue;
      const m = zncc(img, t, px, py, SR1);
      if (m && m.s >= 0.7) {
        s1.push([x, y]);
        d1.push([m.x, m.y]);
      }
    }
    const r1 = ransacH(s1, d1, 1.5, 150, rng);
    const ok1 = r1 && r1.inl.length >= MIN_INLIERS;
    const Hest = ok1 ? hMul(r1.h, this.Hc) : Hpred;
    // 2. Corrección contra el cuadro de las esquinas
    let Hnew = null,
      inl = ok1 ? r1.inl.length : 0;
    const hi = hInv(Hest);
    if (hi) {
      const s2 = [],
        d2 = [],
        sr = ok1 ? SR2 : SR2_WIDE;
      for (const [x, y] of this.refFeats) {
        const [px, py] = hApply(Hest, x, y);
        if (!(px >= PPR && py >= PPR && px < W - PPR && py < H - PPR)) continue;
        // La plantilla se centra en el píxel entero más cercano: su centro corresponde a hi(rx, ry)
        const rx = Math.round(px),
          ry = Math.round(py),
          t = tplWarp(this.f0, W, H, hi, rx, ry);
        if (!t) continue;
        const m = zncc(img, t, rx, ry, sr);
        if (m && m.s >= 0.6) {
          s2.push(hApply(hi, rx, ry));
          d2.push([m.x, m.y]);
        }
      }
      const r2 = ransacH(s2, d2, 1.5, 150, rng);
      if (r2 && r2.inl.length >= MIN_INLIERS && r2.inl.length >= s2.length * 0.5) {
        Hnew = r2.h;
        inl = Math.max(inl, r2.inl.length);
      }
    }
    if (!Hnew && ok1) Hnew = Hest;
    let q = Hnew && mapQuad(Hnew, this.Q0);
    if (q && this.valid(q)) {
      const hc = hInv(this.Hc);
      this.S = hc ? hMul(Hnew, hc) : H_ID.slice();
      this.Hc = Hnew;
      this.misses = 0;
    } else {
      // No se encontró: se sigue con el movimiento previsto unos cuadros
      this.misses++;
      this.Hc = Hpred;
      q = mapQuad(Hpred, this.Q0);
      inl = 0;
    }
    this.prev = f;
    return { q, misses: this.misses, stop: this.misses > PMAX_MISSES || !this.valid(q), inl };
  }
}
