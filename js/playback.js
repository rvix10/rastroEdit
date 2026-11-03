import { $, panel, tlScroll, S } from './state.js';
import { clamp, ease, fmtT } from './util.js';
import { ensureAudio } from './clips.js';
import { activeAt, localOf } from './timeline.js';
import { TR } from './transitions.js';
import { renderFrame } from './render.js';
import { finishExport } from './export.js';
import { act } from './actions.js';
import { MUS, syncMusic } from './music.js';

/* ---------- reproducción ---------- */
export function syncMedia(T) {
  const act = activeAt(T);
  let roles = new Map();
  if (act.length === 2) {
    const B = act[1],
      p = ease(clamp((T - B._start) / (B._d || 1), 0, 1));
    roles.set(act[0], 1 - p);
    roles.set(B, p);
  } else if (act.length) roles.set(act[0], 1);
  for (const c of S.clips) {
    if (!c.el || c.id === S.tracking) continue;
    // Volumen del clip (0–2) por su peso en la transición; mixAudio() en fastexport.js hace lo mismo
    const vol = (roles.get(c) || 0) * (c.mute ? 0 : (c.vol ?? 1));
    if (c.gain) c.gain.gain.value = vol;
    else {
      c.el.muted = c.mute;
      c.el.volume = clamp(vol, 0, 1);
    }
    if (roles.has(c)) {
      const want = localOf(c, T);
      if (S.playing) {
        if (c.el.paused) {
          c.el.currentTime = want;
          c.el.play().catch(() => {});
        } else if (Math.abs(c.el.currentTime - want) > 0.3) c.el.currentTime = want;
      } else {
        if (!c.el.paused) c.el.pause();
        if (!c.el.seeking && Math.abs(c.el.currentTime - want) > 0.04) c.el.currentTime = want;
      }
    } else if (!c.el.paused) c.el.pause();
  }
  syncMusic(T);
}
export function play() {
  if (!S.clips.length) return;
  if (S.T >= S.total - 0.02) S.T = 0;
  ensureAudio();
  S.playing = true;
  S.last = performance.now();
  updPlayBtn();
}
export function pause() {
  S.playing = false;
  S.clips.forEach(c => c.el && c.el.pause());
  if (MUS.el) MUS.el.pause();
  updPlayBtn();
}
export function updPlayBtn() {
  const b = $('#bPlay');
  b.innerHTML = S.playing
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>';
  b.setAttribute('aria-label', S.playing ? 'Pausar' : 'Reproducir');
}
export function seek(T) {
  S.T = clamp(T, 0, S.total);
}

export const mini = { A: null, B: null };
export function makeMini() {
  const mk = (c1, c2, txt) => {
    const m = document.createElement('canvas');
    m.width = 96;
    m.height = 54;
    const g = m.getContext('2d');
    g.fillStyle = c1;
    g.fillRect(0, 0, 96, 54);
    g.fillStyle = c2;
    g.font = "700 24px 'Space Grotesk', Manrope, sans-serif";
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(txt, 48, 29);
    return m;
  };
  mini.A = mk('#3d5afe', '#ffffff', 'A');
  mini.B = mk('#ffd84d', '#121212', 'B');
}
export function drawMinis(now) {
  if (S.tab !== 'trans') return;
  const cyc = (now / 1000) % 1.8,
    p = ease(clamp((cyc - 0.3) / 1.1, 0, 1));
  panel.querySelectorAll('canvas[data-tp]').forEach(m => {
    const g = m.getContext('2d'),
      tp = m.dataset.tp;
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    if (tp === 'none') {
      g.drawImage(p < 0.5 ? mini.A : mini.B, 0, 0);
    } else TR[tp].f(g, mini.A, mini.B, p, 96, 54);
  });
}

/** Tiempo del proyecto según el video que se está mostrando: un número, 'wait' si el video
 *  se está cargando, o null si manda el reloj de la página.
 *  El cuadro dibujado viene del <video>; si el reloj del proyecto avanzara por su cuenta,
 *  los textos rastreados y los cortes se desfasarían de la imagen. */
export function videoClock(T) {
  const a = activeAt(T);
  if (a.length !== 1) return null; // en transiciones manda el reloj de la página
  const c = a[0],
    el = c.el;
  if (!el || el.paused || el.ended) return null;
  if (el.seeking || el.readyState < 3) return 'wait';
  const tv = c._start + el.currentTime - c.in;
  return Math.abs(tv - T) < 1 ? tv : null;
}
const MAX_WAIT = 1.5; // s: si el video no responde, el proyecto sigue sin él

export function loop(now) {
  if (S.playing) {
    const prev = S.T,
      dt = (now - S.last) / 1000;
    S.T += dt;
    const tv = videoClock(S.T);
    if (tv === 'wait' && S.waited < MAX_WAIT) {
      S.T = prev;
      S.waited += dt;
    } else {
      S.waited = 0;
      if (typeof tv === 'number') S.T = Math.max(prev, tv); // si el video va atrasado, el proyecto lo espera
    }
    if (S.T >= S.total) {
      S.T = S.total;
      if (S.exporting) finishExport();
      pause();
    }
  }
  S.last = now;
  // En la exportación rápida, fastexport.js mueve los videos y dibuja cada cuadro
  if (!S.expFast) {
    syncMedia(S.T);
    renderFrame(S.T);
  }
  const x = S.T * S.pps + 12;
  $('#ph').style.left = x + 'px';
  $('#tcNow').textContent = fmtT(S.T);
  if (S.playing && (x > tlScroll.scrollLeft + tlScroll.clientWidth - 40 || x < tlScroll.scrollLeft))
    tlScroll.scrollLeft = x - 60;
  if (S.exporting && !S.expFast) {
    const b = $('#expBar');
    if (b) b.style.width = (S.T / S.total) * 100 + '%';
  }
  drawMinis(now);
  requestAnimationFrame(loop);
}
