/* ---------- línea de tiempo: gestos táctiles y de mouse ----------
   Dedo:  deslizar = desplazar (con inercia) · regla = mover el cursor · tocar clip = seleccionar
          mantener presionado un clip = levantarlo para reordenar · bordes del clip seleccionado = recortar
          dos dedos = zoom
   Mouse: arrastrar zona vacía o regla = mover el cursor · arrastrar clip = reordenar · bordes = recortar
          Ctrl + rueda (o pellizco del touchpad) = zoom
   Todo se aplica al soltar, con un solo commit() (un paso de deshacer).
*/
import { tlInner, tlScroll, S } from './state.js';
import { clamp, fmtS, toast } from './util.js';
import { pause, seek } from './playback.js';
import { renderTimeline } from './timeline-ui.js';
import { renderPanel } from './panel.js';
import { commit } from './project.js';
import { act } from './actions.js';

const PAD = 12; // margen izquierdo de las filas (px)
const MOVE = 7; // px antes de considerar que el dedo se movió
const HOLD = 320; // ms para levantar un clip con el dedo
const MIN_LEN = 0.2; // s: duración mínima de un clip recortado
export const PPS_MIN = 18,
  PPS_MAX = 220;

const pts = new Map(); // pointerId → { x, y }
let G = null; // gesto en curso
let inertia = 0;

const innerX = clientX => clientX - tlInner.getBoundingClientRect().left;
const timeAt = clientX => (innerX(clientX) - PAD) / S.pps;
const clipById = id => S.clips.find(c => c.id === id);
const vibrate = ms => {
  try {
    if (navigator.vibrate) navigator.vibrate(ms);
  } catch (e) {}
};

/** Zoom de la línea de tiempo manteniendo fijo el instante que está bajo clientX. */
export function zoomAt(pps, clientX) {
  const r = tlScroll.getBoundingClientRect(),
    t = timeAt(clientX);
  S.pps = clamp(pps, PPS_MIN, PPS_MAX);
  renderTimeline();
  tlScroll.scrollLeft = t * S.pps + PAD - (clientX - r.left);
}

/* --- visuales temporales durante el gesto --- */
function el(cls) {
  const e = document.createElement('div');
  e.className = cls;
  document.getElementById('rowClips').appendChild(e);
  return e;
}
function clearFx() {
  document.querySelectorAll('#rowClips .drop, #rowClips .trim-ghost, #rowClips .trim-tip').forEach(e => e.remove());
  document.querySelectorAll('#rowClips .clip.lift').forEach(e => {
    e.classList.remove('lift');
    e.style.transform = '';
  });
}

/* --- reordenar --- */
function startReorder(g) {
  g.mode = 'reorder';
  g.from = S.clips.findIndex(c => c.id === g.clipId);
  g.el = document.querySelector(`#rowClips .clip[data-id="${g.clipId}"]`);
  if (g.el) g.el.classList.add('lift');
  g.drop = el('drop');
  if (S.sel !== g.clipId) {
    S.sel = g.clipId;
    S.selOv = null;
    renderPanel();
  }
  pause();
  vibrate(12);
  updReorder(g);
}
function reorderTarget(g) {
  const x = innerX(g.cx) - PAD,
    others = S.clips.filter(c => c.id !== g.clipId);
  let idx = 0;
  for (const c of others) if ((c._start + c._len / 2) * S.pps < x) idx++;
  const at = idx === 0 ? 0 : (others[idx - 1]._start + others[idx - 1]._len) * S.pps;
  return { idx, at };
}
function updReorder(g) {
  const { at } = reorderTarget(g);
  if (g.el) g.el.style.transform = `translateX(${innerX(g.cx) - g.sxi}px)`;
  g.drop.style.left = at + 'px';
}
function endReorder(g) {
  const { idx } = reorderTarget(g);
  clearFx();
  const c = clipById(g.clipId);
  if (c && idx !== g.from) {
    const rest = S.clips.filter(k => k !== c);
    rest.splice(idx, 0, c);
    S.clips = rest;
    renderTimeline();
    renderPanel();
    commit();
    toast('Clip movido');
  } else renderTimeline();
}

/* --- recortar --- */
function trimValue(g) {
  const c = clipById(g.clipId),
    d = (innerX(g.cx) - g.sxi) / S.pps; // en coordenadas de la línea de tiempo: avanza si se desplaza sola
  return g.side === 'l'
    ? { in: clamp(g.in0 + d, 0, c.out - MIN_LEN), out: c.out }
    : { in: c.in, out: clamp(g.out0 + d, c.in + MIN_LEN, c.dur) };
}
function updTrim(g) {
  const c = clipById(g.clipId),
    v = trimValue(g);
  // Borde nuevo respecto de la posición actual del clip (se aplica al soltar)
  const x0 = c._start * S.pps,
    x1 = (c._start + c._len) * S.pps;
  const edge = g.side === 'l' ? x0 + (v.in - c.in) * S.pps : x1 + (v.out - c.out) * S.pps;
  const from = g.side === 'l' ? x0 : x1;
  const cut = g.side === 'l' ? edge > from : edge < from;
  // La línea del nuevo borde queda del lado de la zona que da hacia `edge`
  g.ghost.className = 'trim-ghost ' + (cut ? 'cut' : 'add') + (edge < from ? ' el' : ' er');
  g.ghost.style.left = Math.min(edge, from) + 'px';
  g.ghost.style.width = Math.abs(edge - from) + 'px';
  g.tip.style.left = edge + 'px';
  g.tip.textContent = fmtS(v.out - v.in);
  // La vista previa muestra el cuadro del corte
  const local = g.side === 'l' ? v.in : Math.max(v.in, v.out - 1 / 30);
  seek(c._start + (local - c.in));
}
function endTrim(g) {
  const c = clipById(g.clipId),
    v = trimValue(g);
  clearFx();
  if (Math.abs(v.in - c.in) > 1e-3 || Math.abs(v.out - c.out) > 1e-3) {
    c.in = v.in;
    c.out = v.out;
    renderTimeline();
    seek(c._start + (g.side === 'l' ? 0 : c._len - 1 / 30));
    renderPanel();
    commit();
  } else renderTimeline();
}

/* --- desplazamiento con inercia --- */
function startInertia(vx, vy) {
  cancelAnimationFrame(inertia);
  const step = () => {
    vx *= 0.94;
    vy *= 0.94;
    if (Math.abs(vx) < 0.4 && Math.abs(vy) < 0.4) return;
    tlScroll.scrollLeft -= vx;
    tlScroll.scrollTop -= vy;
    inertia = requestAnimationFrame(step);
  };
  inertia = requestAnimationFrame(step);
}

/* --- auto-desplazamiento cerca de los bordes al arrastrar --- */
function edgeScroll() {
  if (!G || (G.mode !== 'reorder' && G.mode !== 'trim')) return;
  const r = tlScroll.getBoundingClientRect(),
    m = 48;
  let v = 0;
  if (G.cx < r.left + m) v = -Math.ceil((r.left + m - G.cx) / 4);
  else if (G.cx > r.right - m) v = Math.ceil((G.cx - (r.right - m)) / 4);
  if (v) {
    const before = tlScroll.scrollLeft;
    tlScroll.scrollLeft += v;
    if (tlScroll.scrollLeft !== before) G.mode === 'reorder' ? updReorder(G) : updTrim(G);
  }
  G.raf = requestAnimationFrame(edgeScroll);
}

/* --- eventos --- */
function begin(e) {
  const t = e.target,
    touch = e.pointerType !== 'mouse';
  const handle = t.closest('.th'),
    clipEl = t.closest('.clip'),
    onRuler = t.closest('.ruler'),
    onItem = t.closest('.tbtn,.ovb');
  G = {
    id: e.pointerId,
    touch,
    sx: e.clientX,
    sy: e.clientY,
    sxi: innerX(e.clientX),
    cx: e.clientX,
    cy: e.clientY,
    sl: tlScroll.scrollLeft,
    st: tlScroll.scrollTop,
    vx: 0,
    vy: 0,
    lt: performance.now(),
    mode: null,
  };
  if (handle && clipEl) {
    const c = clipById(clipEl.dataset.id);
    Object.assign(G, { mode: 'trim', side: handle.dataset.trim, clipId: c.id, in0: c.in, out0: c.out });
    pause();
    G.ghost = el('trim-ghost');
    G.tip = el('trim-tip');
    updTrim(G);
    G.raf = requestAnimationFrame(edgeScroll);
  } else if (onRuler || (!touch && !clipEl && !onItem)) {
    G.mode = 'scrub';
    pause();
    seek(timeAt(e.clientX));
  } else if (clipEl) {
    G.mode = 'pend-clip';
    G.clipId = clipEl.dataset.id;
    G.tapEl = clipEl;
    if (touch)
      G.hold = setTimeout(() => {
        if (G && G.mode === 'pend-clip') {
          startReorder(G);
          G.raf = requestAnimationFrame(edgeScroll);
        }
      }, HOLD);
  } else {
    G.mode = 'pend-pan';
    G.tapEl = onItem;
  }
}

function startPinch() {
  if (G) {
    clearTimeout(G.hold);
    cancelAnimationFrame(G.raf);
    clearFx();
    renderTimeline();
  }
  const [a, b] = [...pts.values()];
  G = { mode: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, pps0: S.pps };
}

tlInner.addEventListener('pointerdown', e => {
  if (S.exporting || e.button > 0) return;
  cancelAnimationFrame(inertia);
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  try {
    tlInner.setPointerCapture(e.pointerId);
  } catch (err) {}
  if (pts.size === 2) startPinch();
  else if (pts.size === 1) begin(e);
});

tlInner.addEventListener('pointermove', e => {
  if (!pts.has(e.pointerId)) return;
  pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (!G) return;
  if (G.mode === 'pinch') {
    if (pts.size < 2) return;
    const [a, b] = [...pts.values()];
    zoomAt(G.pps0 * (Math.hypot(a.x - b.x, a.y - b.y) / G.d0), (a.x + b.x) / 2);
    return;
  }
  if (e.pointerId !== G.id) return;
  const now = performance.now(),
    dt = Math.max(1, now - G.lt);
  G.vx = ((e.clientX - G.cx) / dt) * 16;
  G.vy = ((e.clientY - G.cy) / dt) * 16;
  G.lt = now;
  G.cx = e.clientX;
  G.cy = e.clientY;
  const moved = Math.hypot(G.cx - G.sx, G.cy - G.sy) > MOVE;
  if (G.mode === 'pend-clip' && moved) {
    clearTimeout(G.hold);
    if (G.touch) G.mode = 'pan';
    else {
      startReorder(G);
      G.raf = requestAnimationFrame(edgeScroll);
    }
  } else if (G.mode === 'pend-pan' && moved) G.mode = 'pan';
  if (G.mode === 'pan') {
    tlScroll.scrollLeft = G.sl - (G.cx - G.sx);
    tlScroll.scrollTop = G.st - (G.cy - G.sy);
  } else if (G.mode === 'scrub') seek(timeAt(e.clientX));
  else if (G.mode === 'reorder') updReorder(G);
  else if (G.mode === 'trim') updTrim(G);
});

function finish(e, cancelled) {
  if (!pts.has(e.pointerId)) return;
  pts.delete(e.pointerId);
  if (!G) return;
  if (G.mode === 'pinch') {
    if (!pts.size) G = null; // el gesto termina cuando se levantan todos los dedos
    return;
  }
  if (e.pointerId !== G.id) return;
  const g = G;
  G = null;
  g.cx = e.clientX; // la posición al soltar (el último movimiento puede llegar agrupado)
  clearTimeout(g.hold);
  cancelAnimationFrame(g.raf);
  if (cancelled) {
    clearFx();
    renderTimeline();
    return;
  }
  if (g.mode === 'reorder') endReorder(g);
  else if (g.mode === 'trim') endTrim(g);
  else if (g.mode === 'pan') startInertia(g.vx, g.vy);
  else if (g.mode === 'pend-clip' || g.mode === 'pend-pan') {
    // Toque sin arrastre: se resuelve aquí (con la captura del puntero, el click del navegador
    // puede llegar al contenedor en vez de al elemento tocado)
    if (g.tapEl && g.tapEl.dataset.act) act(g.tapEl.dataset.act, g.tapEl);
    else if (g.touch) {
      pause();
      seek(timeAt(e.clientX)); // zona vacía: mueve el cursor ahí
    }
  }
}
tlInner.addEventListener('pointerup', e => finish(e, false));
tlInner.addEventListener('pointercancel', e => finish(e, true));

// Los clicks que genera el puntero se ignoran (los toques se resuelven en finish());
// los del teclado (Enter/Espacio sobre una insignia, detail = 0) siguen funcionando
tlInner.addEventListener(
  'click',
  e => {
    if (e.detail > 0) {
      e.stopPropagation();
      e.preventDefault();
    }
  },
  true
);

// Ctrl + rueda (y el pellizco de los touchpads, que llega así) = zoom
tlScroll.addEventListener(
  'wheel',
  e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomAt(S.pps * Math.exp(-e.deltaY * 0.01), e.clientX);
  },
  { passive: false }
);
