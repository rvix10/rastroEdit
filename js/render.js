import { $, ctx, S, L1, L2 } from './state.js';
import { clamp, ease, easeOutBack, roundRect, getSel, getOv } from './util.js';
import { coverOf, mapSrc } from './clips.js';
import { activeAt, localOf } from './timeline.js';
import { TR, applyFilter } from './transitions.js';
import { act } from './actions.js';
import { drawRotated } from './frames.js';
import { quadCenter } from './planar.js';

/* ---------- render ---------- */
export function sourceOf(c, local) {
  if (c.kind === 'demo') {
    if (c._lastT !== local) {
      c.draw(c.sg, local, c.sw, c.sh);
      c._lastT = local;
    }
    return c.scv;
  }
  return c.el && c.el.readyState >= 2 ? c.el : null;
}
export function drawClipLayer(c, local, L) {
  const g = L.getContext('2d');
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#000';
  g.fillRect(0, 0, S.W, S.H);
  // Exportación rápida: cuadro decodificado por frames.js (con la rotación del archivo)
  const xf = S.expFrames && S.expFrames.get(c.id);
  const src = xf ? xf.frame : sourceOf(c, local);
  if (src) {
    const m = coverOf(c);
    if (xf) drawRotated(g, src, xf.rotation, m.dx, m.dy, m.dw, m.dh);
    else g.drawImage(src, m.dx, m.dy, m.dw, m.dh);
  } else if (c.missing) {
    drawMissing(g, c);
    return;
  }
  applyFilter(g, c.filter, S.W, S.H);
}
// Video que no está guardado en este navegador: aviso en el cuadro en vez de negro
export function drawMissing(g, c) {
  const s = Math.min(S.W, S.H);
  g.fillStyle = '#181b22';
  g.fillRect(0, 0, S.W, S.H);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#ef6b5c';
  g.font = `700 ${s * 0.045}px Manrope, system-ui, sans-serif`;
  g.fillText('Falta el video', S.W / 2, S.H / 2 - s * 0.04);
  g.fillStyle = '#8c93a3';
  g.font = `600 ${s * 0.03}px Manrope, system-ui, sans-serif`;
  g.fillText('«' + c.name + '» · vuelve a vincularlo en Medios', S.W / 2, S.H / 2 + s * 0.03);
}
export function trackAt(c, local) {
  const P = c.track && c.track.pts;
  if (!P || !P.length) return null;
  if (local <= P[0].t) return P[0];
  if (local >= P[P.length - 1].t) return P[P.length - 1];
  let lo = 0,
    hi = P.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (P[m].t <= local) lo = m;
    else hi = m;
  }
  const a = P[lo],
    b = P[hi],
    k = (local - a.t) / (b.t - a.t || 1);
  const r = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  if (a.x2 != null && b.x2 != null) {
    r.x2 = a.x2 + (b.x2 - a.x2) * k;
    r.y2 = a.y2 + (b.y2 - a.y2) * k;
  }
  if (a.q && b.q) {
    // 4 esquinas: se interpolan las esquinas y el ancla es el cruce de las diagonales
    r.q = a.q.map((v, i) => v + (b.q[i] - v) * k);
    [r.x, r.y] = quadCenter(r.q);
  }
  return r;
}
/** Esquinas del plano rastreado en `local`, en el lienzo ([{x,y}×4]), o null. */
export function quadAt(c, local) {
  const tp = trackAt(c, local);
  if (!tp || !tp.q) return null;
  return [0, 1, 2, 3].map(i => mapSrc(c, tp.q[i * 2], tp.q[i * 2 + 1]));
}

/** Ángulo (rad) y largo del segmento punto 1 → punto 2, en píxeles del video fuente. */
function seg(c, p) {
  const dx = (p.x2 - p.x) * c.sw,
    dy = (p.y2 - p.y) * c.sh;
  return { ang: Math.atan2(dy, dx), len: Math.hypot(dx, dy) };
}
/**
 * Movimiento del objeto rastreado en `local`: ancla (punto 1) en el lienzo y, con rastreo de 2 puntos,
 * giro (rad, sentido horario) y escala respecto del cuadro donde se marcaron los puntos.
 */
export function trackXform(c, local) {
  const tp = trackAt(c, local);
  if (!tp) return null;
  const m = mapSrc(c, tp.x, tp.y),
    r = { x: m.x, y: m.y, rot: 0, scale: 1, two: false };
  // Con 4 esquinas, giro y escala salen del segmento que une los centros de los lados izquierdo y derecho
  const mids = q => ({ x: (q[0] + q[6]) / 2, y: (q[1] + q[7]) / 2, x2: (q[2] + q[4]) / 2, y2: (q[3] + q[5]) / 2 });
  const qd = c.track.quad;
  let s0 = null,
    s1 = null;
  if (qd && tp.q) {
    s0 = mids(qd.flatMap(p => [p.x, p.y]));
    s1 = mids(tp.q);
  } else if (c.track.seed2 && tp.x2 != null) {
    s0 = { ...c.track.seed, x2: c.track.seed2.x, y2: c.track.seed2.y };
    s1 = tp;
  }
  if (s0) {
    const a = seg(c, s0),
      b = seg(c, s1);
    if (a.len > 1e-6) {
      r.rot = b.ang - a.ang;
      r.scale = b.len / a.len;
      r.two = true;
    }
  }
  return r;
}
/** Giro y escala que hereda un overlay (cada uno se puede apagar en el panel). */
function inherit(o, xf) {
  return {
    rot: xf.two && o.followRot !== false ? xf.rot : 0,
    scale: xf.two && o.followScale !== false ? xf.scale : 1,
  };
}
/**
 * Posición del overlay en el lienzo, con el giro y la escala que hereda.
 * Si sigue al objeto, o.x/o.y es un desplazamiento (normalizado al lienzo) en el cuadro de los
 * puntos marcados: también gira y escala con el objeto, así un texto puesto "arriba" queda arriba.
 */
export function ovPos(o, c, local) {
  if (o.follow) {
    const xf = trackXform(c, local);
    if (xf) {
      const h = inherit(o, xf),
        ox = o.x * S.W,
        oy = o.y * S.H,
        cs = Math.cos(h.rot) * h.scale,
        sn = Math.sin(h.rot) * h.scale;
      return { x: xf.x + cs * ox - sn * oy, y: xf.y + sn * ox + cs * oy, rot: h.rot, scale: h.scale };
    }
  }
  return { x: o.x * S.W, y: o.y * S.H, rot: 0, scale: 1 };
}
/** Pone el overlay en (X, Y) del lienzo (inverso de ovPos): para arrastrar y para activar "seguir". */
export function ovSetAbs(o, c, local, X, Y) {
  const xf = o.follow && trackXform(c, local);
  if (!xf) {
    o.x = X / S.W;
    o.y = Y / S.H;
    return;
  }
  const h = inherit(o, xf),
    dx = (X - xf.x) / h.scale,
    dy = (Y - xf.y) / h.scale,
    cs = Math.cos(-h.rot),
    sn = Math.sin(-h.rot);
  o.x = (cs * dx - sn * dy) / S.W;
  o.y = (sn * dx + cs * dy) / S.H;
}
export const FONTS = {
  impacto: s => `800 ${s}px Unbounded, Manrope, system-ui, sans-serif`,
  limpia: s => `800 ${s}px Manrope, system-ui, sans-serif`,
  mano: s => `700 ${s}px Caveat, cursive`,
};
export function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
export function drawOverlay(g, o, pos, alpha, age, local) {
  let sc = 1,
    a = alpha;
  if (o.anim === 'pop' && age < 0.35) {
    const k = age / 0.35;
    sc = Math.max(0.01, easeOutBack(k));
    a *= Math.min(1, k * 2.5);
  } else if (o.anim === 'fade' && age < 0.45) a *= age / 0.45;
  const H = S.H;
  let bb;
  if (o.kind === 'area' && pos.quad) {
    // Área: el plano rastreado relleno y con borde (en perspectiva); la etiqueta va derecha, en su centro
    drawArea(g, o, pos.quad, clamp(a, 0, 1));
    if (!(o.text || '').trim()) {
      const xs = pos.quad.map(p => p.x),
        ys = pos.quad.map(p => p.y),
        x = Math.min(...xs),
        y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
  }
  g.save();
  g.globalAlpha = clamp(a, 0, 1);
  g.translate(pos.x, pos.y);
  if (pos.rot) g.rotate(pos.rot);
  const ps = pos.scale || 1;
  g.scale(sc * ps, sc * ps);
  if (o.kind === 'ring') {
    const r = o.size * H * 0.6,
      lw = Math.max(3, H * 0.007);
    g.strokeStyle = o.color;
    g.lineWidth = lw;
    g.beginPath();
    g.arc(0, 0, r * (1 + Math.sin(local * 6) * 0.04), 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([lw * 2.5, lw * 2]);
    g.lineDashOffset = -local * 40;
    g.globalAlpha *= 0.7;
    g.beginPath();
    g.arc(0, 0, r * 1.28, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    bb = { w: r * 2.7, h: r * 2.7 };
  } else if (o.kind === 'sticker') {
    const s = o.size * H * 1.3;
    g.font = `${s}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",system-ui,sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = 'rgba(0,0,0,.4)';
    g.shadowBlur = s * 0.15;
    g.shadowOffsetY = s * 0.05;
    g.fillText(o.text, 0, 0);
    bb = { w: s * 1.3, h: s * 1.2 };
  } else {
    const s = o.size * H,
      lh = s * 1.18,
      lines = (o.text || ' ').split('\n');
    g.font = FONTS[o.font](s);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const w = Math.max(...lines.map(l => g.measureText(l).width), s * 0.5),
      h = lh * lines.length,
      pad = s * 0.38;
    if (o.style === 'box') {
      g.fillStyle = o.color;
      roundRect(g, -w / 2 - pad, -h / 2 - pad * 0.55, w + pad * 2, h + pad * 1.1, s * 0.32);
      g.fill();
      g.fillStyle = lum(o.color) > 0.6 ? '#14161b' : '#ffffff';
      lines.forEach((l, i) => g.fillText(l, 0, -h / 2 + lh * (i + 0.5)));
    } else {
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(8,9,12,.78)';
      g.lineWidth = s * 0.17;
      g.fillStyle = o.color;
      lines.forEach((l, i) => {
        const y = -h / 2 + lh * (i + 0.5);
        g.strokeText(l, 0, y);
        g.fillText(l, 0, y);
      });
    }
    bb = { w: w + pad * 2, h: h + pad * 1.2 };
  }
  g.restore();
  // Caja para tocar/arrastrar: la que encierra al elemento ya girado y escalado
  const ps2 = pos.scale || 1,
    cr = Math.abs(Math.cos(pos.rot || 0)),
    sr = Math.abs(Math.sin(pos.rot || 0));
  const w = (bb.w * cr + bb.h * sr) * ps2,
    h = (bb.w * sr + bb.h * cr) * ps2;
  return { x: pos.x - w / 2, y: pos.y - h / 2, w, h };
}
function drawArea(g, o, quad, alpha) {
  g.save();
  g.globalAlpha = alpha;
  g.beginPath();
  quad.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
  g.closePath();
  g.globalAlpha = alpha * (o.fill ?? 0.3);
  g.fillStyle = o.color;
  g.fill();
  g.globalAlpha = alpha;
  g.lineJoin = 'round';
  g.strokeStyle = 'rgba(8,9,12,.55)'; // sombra del borde: se ve sobre tierra clara y oscura
  g.lineWidth = Math.max(3, S.H * 0.011);
  g.stroke();
  g.strokeStyle = o.color;
  g.lineWidth = Math.max(2, S.H * 0.006);
  g.stroke();
  g.restore();
}
export function drawOverlaysFor(c, local, alpha) {
  for (const o of S.ovs) {
    if (o.clipId !== c.id || local < o.t0 || local > o.t1) continue;
    let quad = null;
    if (o.kind === 'area') {
      quad = quadAt(c, local);
      if (!quad) continue; // sin rastreo de 4 esquinas no hay área que dibujar
    }
    const pos = { ...ovPos(o, c, local), quad },
      bb = drawOverlay(ctx, o, pos, alpha, local - Math.max(o.t0, c.in), local);
    if (!S.exporting && alpha > 0.5) S.hits.push({ o, c, ...bb });
  }
}
export function renderFrame(T) {
  const act = activeAt(T);
  S.hits = [];
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (!act.length) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, S.W, S.H);
    if (!S.clips.length && !S.exporting) {
      // Proyecto vacío: qué hacer, en vez de una pantalla negra
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f5f1e8';
      ctx.font = `700 ${Math.round(S.H * 0.05)}px 'Space Grotesk', Manrope, system-ui, sans-serif`;
      ctx.fillText('Importa tus videos para empezar', S.W / 2, S.H / 2 - S.H * 0.03);
      ctx.fillStyle = '#ffd84d';
      ctx.font = `600 ${Math.round(S.H * 0.032)}px 'Space Grotesk', Manrope, system-ui, sans-serif`;
      ctx.fillText('Medios → Importar videos', S.W / 2, S.H / 2 + S.H * 0.045);
    }
    return;
  }
  if (act.length === 1) {
    const c = act[0];
    drawClipLayer(c, localOf(c, T), L1);
    ctx.drawImage(L1, 0, 0);
    drawOverlaysFor(c, localOf(c, T), 1);
  } else {
    const A = act[0],
      B = act[act.length - 1],
      p = clamp((T - B._start) / (B._d || 1), 0, 1),
      e = ease(p);
    drawClipLayer(A, localOf(A, T), L1);
    drawClipLayer(B, localOf(B, T), L2);
    TR[B.trans.type].f(ctx, L1, L2, e, S.W, S.H);
    drawOverlaysFor(A, localOf(A, T), 1 - e);
    drawOverlaysFor(B, localOf(B, T), e);
  }
  if (!S.exporting) drawGuides(T, act);
}
export function drawGuides(T, act) {
  const o = getOv();
  const hit = o && S.hits.find(h => h.o === o);
  if (hit) {
    ctx.save();
    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = '#ffd84d';
    ctx.lineWidth = 2;
    ctx.strokeRect(hit.x, hit.y, hit.w, hit.h);
    ctx.restore();
  }
  const c = getSel();
  if (S.tab !== 'track' || !c || !act.includes(c)) return;
  const local = localOf(c, T),
    lw = Math.max(2, S.H * 0.003);
  if (S.showPath && c.track && c.track.pts.length > 1) {
    const two = c.track.pts[0].x2 != null;
    ctx.save();
    ctx.strokeStyle = 'rgba(79,209,165,.9)';
    ctx.fillStyle = '#4fd1a5';
    ctx.lineWidth = lw;
    for (const [kx, ky] of two
      ? [
          ['x', 'y'],
          ['x2', 'y2'],
        ]
      : [['x', 'y']]) {
      ctx.setLineDash([lw * 3, lw * 2]);
      ctx.beginPath();
      c.track.pts.forEach((p, i) => {
        const m = mapSrc(c, p[kx], p[ky]);
        i ? ctx.lineTo(m.x, m.y) : ctx.moveTo(m.x, m.y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
      c.track.pts.forEach((p, i) => {
        if (i % 5) return;
        const m = mapSrc(c, p[kx], p[ky]);
        ctx.beginPath();
        ctx.arc(m.x, m.y, lw * 1.3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    const cur = trackAt(c, local);
    if (cur && cur.q) {
      // 4 esquinas: el contorno del plano en este cuadro
      const q = quadAt(c, local);
      ctx.strokeStyle = '#4fd1a5';
      ctx.lineWidth = lw;
      ctx.beginPath();
      q.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      ctx.stroke();
      const b = lw * 4;
      q.forEach(p => ctx.strokeRect(p.x - b / 2, p.y - b / 2, b, b));
    } else if (cur) {
      const m = mapSrc(c, cur.x, cur.y),
        b = coverOf(c).dw * (19 / 320);
      ctx.strokeStyle = '#4fd1a5';
      ctx.lineWidth = lw;
      ctx.strokeRect(m.x - b / 2, m.y - b / 2, b, b);
      if (cur.x2 != null) {
        const m2 = mapSrc(c, cur.x2, cur.y2);
        ctx.strokeRect(m2.x - b / 2, m2.y - b / 2, b, b);
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(m2.x, m2.y);
        ctx.stroke();
      }
    }
    ctx.restore();
  }
  // Puntos marcados (y el primero mientras se espera el segundo; con 4 esquinas, las que ya se tocaron)
  const pq = S.pickQuad && S.pickQuad.clipId === c.id ? S.pickQuad.pts : null,
    tq = c.track && c.track.quad;
  const marks = pq
    ? pq
    : S.pickFirst && S.pickFirst.clipId === c.id
      ? [S.pickFirst]
      : tq
        ? c.track.pts.length > 1
          ? []
          : tq
        : [c.track && c.track.seed, c.track && c.track.seed2].filter(Boolean);
  if ((pq && pq.length > 1) || (tq && !pq && marks.length === 4)) {
    // contorno de las esquinas marcadas
    ctx.save();
    ctx.strokeStyle = '#ffd84d';
    ctx.lineWidth = lw;
    ctx.setLineDash([lw * 3, lw * 2]);
    ctx.beginPath();
    marks.forEach((s, i) => {
      const m = mapSrc(c, s.x, s.y);
      i ? ctx.lineTo(m.x, m.y) : ctx.moveTo(m.x, m.y);
    });
    if (marks.length === 4) ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.strokeStyle = '#ffd84d';
  ctx.fillStyle = '#ffd84d';
  ctx.lineWidth = lw;
  ctx.font = `800 ${Math.round(S.H * 0.026)}px Manrope, system-ui, sans-serif`;
  marks.forEach((s, i) => {
    const m = mapSrc(c, s.x, s.y),
      r = S.H * 0.02;
    ctx.beginPath();
    ctx.moveTo(m.x - r * 1.8, m.y);
    ctx.lineTo(m.x - r * 0.6, m.y);
    ctx.moveTo(m.x + r * 0.6, m.y);
    ctx.lineTo(m.x + r * 1.8, m.y);
    ctx.moveTo(m.x, m.y - r * 1.8);
    ctx.lineTo(m.x, m.y - r * 0.6);
    ctx.moveTo(m.x, m.y + r * 0.6);
    ctx.lineTo(m.x, m.y + r * 1.8);
    ctx.stroke();
    if (marks.length > 1 || S.pickFirst || pq) ctx.fillText(String(i + 1), m.x + r * 0.9, m.y - r * 0.9);
  });
  ctx.restore();
}
