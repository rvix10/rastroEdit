import { $, ctx, S, L1, L2 } from './state.js';
import { clamp, ease, easeOutBack, roundRect, getSel, getOv } from './util.js';
import { coverOf, mapSrc } from './clips.js';
import { activeAt, localOf } from './timeline.js';
import { TR, applyFilter } from './transitions.js';
import { act } from './actions.js';

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
  const src = sourceOf(c, local);
  if (src) {
    const m = coverOf(c);
    g.drawImage(src, m.dx, m.dy, m.dw, m.dh);
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
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}
export function ovPos(o, c, local) {
  if (o.follow) {
    const tp = trackAt(c, local);
    if (tp) {
      const m = mapSrc(c, tp.x, tp.y);
      return { x: m.x + o.x * S.W, y: m.y + o.y * S.H };
    }
  }
  return { x: o.x * S.W, y: o.y * S.H };
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
  g.save();
  g.globalAlpha = clamp(a, 0, 1);
  g.translate(pos.x, pos.y);
  g.scale(sc, sc);
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
  return { x: pos.x - bb.w / 2, y: pos.y - bb.h / 2, w: bb.w, h: bb.h };
}
export function drawOverlaysFor(c, local, alpha) {
  for (const o of S.ovs) {
    if (o.clipId !== c.id || local < o.t0 || local > o.t1) continue;
    const pos = ovPos(o, c, local),
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
    ctx.strokeStyle = '#f1a93b';
    ctx.lineWidth = 2;
    ctx.strokeRect(hit.x, hit.y, hit.w, hit.h);
    ctx.restore();
  }
  const c = getSel();
  if (S.tab !== 'track' || !c || !act.includes(c)) return;
  const local = localOf(c, T),
    lw = Math.max(2, S.H * 0.003);
  if (S.showPath && c.track && c.track.pts.length > 1) {
    ctx.save();
    ctx.strokeStyle = 'rgba(79,209,197,.9)';
    ctx.lineWidth = lw;
    ctx.setLineDash([lw * 3, lw * 2]);
    ctx.beginPath();
    c.track.pts.forEach((p, i) => {
      const m = mapSrc(c, p.x, p.y);
      i ? ctx.lineTo(m.x, m.y) : ctx.moveTo(m.x, m.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#4fd1c5';
    c.track.pts.forEach((p, i) => {
      if (i % 5) return;
      const m = mapSrc(c, p.x, p.y);
      ctx.beginPath();
      ctx.arc(m.x, m.y, lw * 1.3, 0, Math.PI * 2);
      ctx.fill();
    });
    const cur = trackAt(c, local);
    if (cur) {
      const m = mapSrc(c, cur.x, cur.y),
        b = coverOf(c).dw * (19 / 320);
      ctx.strokeStyle = '#4fd1c5';
      ctx.lineWidth = lw;
      ctx.strokeRect(m.x - b / 2, m.y - b / 2, b, b);
    }
    ctx.restore();
  }
  if (c.track && c.track.seed) {
    const s = c.track.seed,
      m = mapSrc(c, s.x, s.y),
      r = S.H * 0.02;
    ctx.save();
    ctx.strokeStyle = '#f1a93b';
    ctx.lineWidth = lw;
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
    ctx.restore();
  }
}
