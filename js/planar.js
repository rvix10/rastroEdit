/* ---------- rastreo planar (4 esquinas): sigue un plano en perspectiva (terreno, pantalla, letrero) ----------
   Sin DOM: lo usa trackcore.js (en el Worker o en el hilo principal) y render.js (para dibujar).
   Por cada cuadro:
   0. Estimación gruesa en la imagen reducida ×4 (cubre movimientos grandes: giros rápidos, temblor), probando
      «sigue el movimiento anterior» y «quieto»; la mejor guía la búsqueda fina.
   1. Cuadro a cuadro: puntos con textura dentro del área (en el cuadro anterior) se buscan en el actual con ZNCC
      alrededor de donde los pone el movimiento anterior. Con RANSAC se ajusta la homografía que los explica a todos
      (los que no encajan —árboles, sombras, algo que pasa— quedan fuera).
   2. Verificación contra un cuadro clave (al principio, el de las esquinas): sus puntos, deformados con esa homografía,
      se buscan otra vez cerca. Así el error no se acumula. Los cuadros verificados se guardan como nuevos cuadros clave
      cada tanto, para seguir verificando aunque la vista cambie mucho (el dron gira alrededor del lote).
      Sin verificar se aceptan como mucho unos cuadros seguidos; después cuenta como perdido (mejor un tramo
      interpolado que un área corrida).
   Cada punto debe ser único en su zona (prueba de unicidad): en surcos o hileras un punto "se desliza" a lo largo
   de la línea y daría una posición falsa. Los puntos se reparten en toda el área (si no, la perspectiva de la parte
   lejana queda mal determinada).
   Si no se encuentra, se sigue buscando hasta ~3 s desde el último cuadro bueno (recupera tras un tirón o algo que tapa).
   Homografías: arreglos de 9 números (fila por fila), del cuadro de las esquinas al cuadro actual.
   RANSAC usa un generador con semilla fija: el resultado es idéntico en el Worker y en el hilo principal.
*/
export const PPR = 8; // radio del parche (17×17)
const SR1 = 14; // búsqueda cuadro a cuadro (sin estimación gruesa)
const SR1_FINE = 6; // … guiada por la estimación gruesa
const SRC = 10; // búsqueda en la imagen ×4 (= 40 px de análisis)
const SRC_LOST = 16; // … mientras está perdido
const SR2 = 4; // verificación: pasada fina
const SR2_WIDE = 10; // verificación: pasada amplia (corrige errores grandes)
const MAX_FEATS = 70;
const MIN_INLIERS = 8;
const PMAX_MISSES = 45; // ~3 s a 15 muestras por segundo
const MAX_UNVERIFIED = 8; // cuadros seguidos sin verificar contra un cuadro clave
const KEY_EVERY = 10; // pasos mínimos entre cuadros clave
const MAX_KEYS = 8;
const UNIQ = 0.06; // margen mínimo entre el máximo y el segundo pico (puntos que no se repiten)

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
// Imagen reducida a la mitad (promedio 2×2): el píxel (x, y) cubre (2x, 2y)…(2x+1, 2y+1)
function down2({ f, w, h }) {
  const w2 = w >> 1,
    h2 = h >> 1,
    o = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++)
    for (let x = 0; x < w2; x++) {
      const i = 2 * y * w + 2 * x;
      o[y * w2 + x] = (f[i] + f[i + 1] + f[i + w] + f[i + w + 1]) / 4;
    }
  return { f: o, w: w2, h: h2 };
}
const down4 = (f, w, h) => down2(down2({ f, w, h }));
// De coordenadas ×4 a coordenadas de análisis (centro del bloque de 4×4)
const D4 = [4, 0, 1.5, 0, 4, 1.5, 0, 0, 1],
  D4i = [0.25, 0, -0.375, 0, 0.25, -0.375, 0, 0, 1];
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
  const tryAdd = ([e, x, y]) => {
    if (e < mx * 0.05 || out.length >= maxN) return false;
    const gx = Math.floor(x / cell),
      gy = Math.floor(y / cell);
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const p = taken.get((gy + j) * gw + gx + i);
        if (p && (p[0] - x) ** 2 + (p[1] - y) ** 2 < minD * minD) return false;
      }
    taken.set(gy * gw + gx, [x, y]);
    out.push([x, y]);
    return true;
  };
  // Repartidos en toda el área: primero el mejor de cada bloque (si todos quedan donde hay más contraste,
  // la perspectiva de la parte lejana queda mal determinada), después el resto por puntaje
  const xs = [q[0], q[2], q[4], q[6]],
    ys = [q[1], q[3], q[5], q[7]],
    bx0 = Math.min(...xs),
    by0 = Math.min(...ys),
    B = Math.max(minD * 2, Math.sqrt(((Math.max(...xs) - bx0) * (Math.max(...ys) - by0)) / (maxN * 0.5))),
    bw = Math.ceil(W / B) + 2,
    seen = new Set(),
    rest = [];
  for (const c of cand) {
    const k = Math.floor((c[2] - by0) / B) * bw + Math.floor((c[1] - bx0) / B);
    if (seen.has(k) || !tryAdd(c)) rest.push(c);
    else seen.add(k);
  }
  for (const c of rest) if (out.length < maxN) tryAdd(c);
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
  // Unicidad: el mejor puntaje lejos del máximo (a 3 px o más). Si es casi igual, el punto es ambiguo
  // (un surco, una hilera: se "desliza" a lo largo de la línea) y no debe contar.
  let s2 = -2;
  for (let j = 0; j < w2; j++)
    for (let i = 0; i < w2; i++) {
      if (Math.max(Math.abs(x0 - sr + i - bx), Math.abs(y0 - sr + j - by)) < 3) continue;
      const v = grid[j * w2 + i];
      if (v > s2) s2 = v;
    }
  return { x: fx, y: fy, s: edge ? Math.min(bs, 0) : bs, s2 };
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
    this.f04 = down4(f0, W, H);
    this.key0 = { f: f0, H: H_ID, Hi: H_ID, feats: this.refFeats };
  }
  begin() {
    this.Hc = H_ID.slice();
    this.S = H_ID.slice();
    this.prev = this.f0;
    this.prev4 = this.f04;
    this.keys = [this.key0];
    this.lastKey = 0;
    this.unver = 0;
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
      c4 = down4(f, W, H),
      img4 = new Integral(c4.f, c4.w, c4.h),
      rng = mulberry32(0x5eed + ++this.k),
      lost = this.misses;
    // Movimiento previsto desde el último cuadro bueno (this.prev): el anterior, repetido por cada paso perdido
    let Sp = this.S;
    for (let i = 0; i < lost; i++) Sp = hMul(this.S, Sp);
    const qs = shrink(mapQuad(this.Hc, this.Q0), 0.88);
    // 0. Estimación gruesa (×4): «sigue igual» y «quieto» (y el último paso, si está perdido)
    const p4 = this.prev4,
      qs4 = qs.map(v => (v - 1.5) / 4),
      feats4 = goodFeatures(p4.f, p4.w, p4.h, qs4, 40, 5, PPR + 1),
      srC = lost ? SRC_LOST : SRC;
    let best = null;
    for (const cand of lost ? [Sp, this.S, H_ID] : [Sp, H_ID]) {
      const ch = hMul(D4i, hMul(cand, D4)),
        s0 = [],
        d0 = [];
      for (const [x, y] of feats4) {
        const [px, py] = hApply(ch, x, y);
        if (!(px > -srC && py > -srC && px < c4.w + srC && py < c4.h + srC)) continue;
        const t = tplAt(p4.f, p4.w, x, y);
        if (!t) continue;
        const m = zncc(img4, t, px, py, srC);
        if (m && m.s >= 0.7 && m.s - m.s2 >= UNIQ) {
          s0.push([x, y]);
          d0.push([m.x, m.y]);
        }
      }
      const r = ransacH(s0, d0, 1, 100, rng);
      if (r && r.inl.length >= 6 && (!best || r.inl.length > best.inl.length)) best = r;
      if (best && best.inl.length >= feats4.length * 0.7) break;
    }
    const Sg = best ? hMul(D4, hMul(best.h, D4i)) : Sp;
    // 1. Cuadro a cuadro, guiado por la estimación gruesa
    const feats = goodFeatures(this.prev, W, H, qs, MAX_FEATS, 9, PPR + 1),
      sr1 = best ? SR1_FINE : SR1;
    const s1 = [],
      d1 = [];
    for (const [x, y] of feats) {
      const [px, py] = hApply(Sg, x, y);
      if (!(px > -sr1 && py > -sr1 && px < W + sr1 && py < H + sr1)) continue;
      const t = tplAt(this.prev, W, x, y);
      if (!t) continue;
      const m = zncc(img, t, px, py, sr1);
      if (m && m.s >= 0.7 && m.s - m.s2 >= UNIQ) {
        s1.push([x, y]);
        d1.push([m.x, m.y]);
      }
    }
    const r1 = ransacH(s1, d1, 1.5, 150, rng);
    const ok1 = r1 && r1.inl.length >= MIN_INLIERS;
    const Hest = hMul(ok1 ? r1.h : Sg, this.Hc);
    // 2. Verificación contra el último cuadro clave (y, si no alcanza, contra el de las esquinas)
    let Hnew = null,
      verified = false,
      ratio2 = 0,
      inl = ok1 ? r1.inl.length : 0;
    // Dos pasadas: amplia (corrige errores grandes, por ejemplo de perspectiva en la parte lejana) y fina
    const verify = (Hg, key, sr) => {
      const hi = hInv(Hg);
      if (!hi) return null;
      const wk = hMul(key.H, hi), // actual → cuadro clave
        s2 = [],
        d2 = [];
      for (const [x, y] of key.feats) {
        const P = hApply(key.Hi, x, y),
          [px, py] = hApply(Hg, P[0], P[1]);
        if (!(px >= PPR && py >= PPR && px < W - PPR && py < H - PPR)) continue;
        // La plantilla se centra en el píxel entero más cercano: su centro corresponde a hi(rx, ry)
        const rx = Math.round(px),
          ry = Math.round(py),
          t = tplWarp(key.f, W, H, wk, rx, ry);
        if (!t) continue;
        const m = zncc(img, t, rx, ry, sr);
        if (m && m.s >= 0.6 && m.s - m.s2 >= UNIQ) {
          s2.push(hApply(hi, rx, ry));
          d2.push([m.x, m.y]);
        }
      }
      const r2 = ransacH(s2, d2, 1.5, 150, rng);
      return r2 && r2.inl.length >= MIN_INLIERS && r2.inl.length >= s2.length * 0.5
        ? { h: r2.h, ratio: r2.inl.length / Math.max(1, key.feats.length), n: r2.inl.length }
        : null;
    };
    // primero el de las esquinas (la referencia exacta); el último cuadro clave, si ese no alcanza
    const tryKeys = this.keys.length > 1 ? [this.key0, this.keys[this.keys.length - 1]] : [this.key0];
    for (const key of tryKeys) {
      const a = verify(Hest, key, SR2_WIDE),
        v = a && (verify(a.h, key, SR2) || a);
      if (v) {
        Hnew = v.h;
        verified = true;
        ratio2 = v.ratio;
        inl = Math.max(inl, v.n);
        break;
      }
    }
    // Sin verificar: solo si el paso cuadro a cuadro es muy claro, y pocos cuadros seguidos
    const strong1 = ok1 && r1.inl.length >= 12 && r1.inl.length >= s1.length * 0.6;
    if (!Hnew && strong1 && this.unver < MAX_UNVERIFIED) Hnew = Hest;
    let q = Hnew && mapQuad(Hnew, this.Q0);
    if (q && this.valid(q)) {
      const hc = hInv(this.Hc);
      // Velocidad por paso: tras recuperarse no se conoce (abarcó varios pasos), se empieza quieto
      this.S = hc && !lost ? hMul(Hnew, hc) : H_ID.slice();
      this.Hc = Hnew;
      this.prev = f;
      this.prev4 = c4;
      this.misses = 0;
      this.unver = verified ? 0 : this.unver + 1;
      // Nuevo cuadro clave: verificado, cada tanto, cuando el último ya se parece menos y con la imagen casi
      // quieta (si se mueve rápido, el desenfoque corre la imagen y el error quedaría guardado para siempre)
      const qp = mapQuad(this.prevH || Hnew, this.Q0),
        still = Math.max(...q.map((v, i) => Math.abs(v - qp[i]))) < 3;
      this.prevH = Hnew;
      if (verified && still && this.k - this.lastKey >= KEY_EVERY && ratio2 < 0.75) {
        const feats = goodFeatures(f, W, H, shrink(q, 0.88), MAX_FEATS + 20, 9, PPR + 1);
        const Hi = hInv(Hnew);
        if (Hi && feats.length >= MIN_INLIERS * 2) {
          this.keys.push({ f, H: Hnew, Hi, feats });
          if (this.keys.length > MAX_KEYS) this.keys.splice(1, 1); // el de las esquinas siempre queda
          this.lastKey = this.k;
        }
      }
    } else {
      // No se encontró: se sigue buscando desde el último cuadro bueno (prev y Hc no cambian)
      this.misses++;
      q = mapQuad(hMul(Sg, this.Hc), this.Q0);
      inl = 0;
    }
    return { q, misses: this.misses, stop: this.misses > PMAX_MISSES, inl };
  }
}
