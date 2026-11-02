import { $, panel, tlScroll, S } from './state.js';
import { clamp, ease, fmtT } from './util.js';
import { ensureAudio } from './clips.js';
import { activeAt, localOf } from './timeline.js';
import { TR } from './transitions.js';
import { renderFrame } from './render.js';
import { finishExport } from './export.js';
import { act } from './actions.js';

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
    const vol = (roles.get(c) || 0) * (c.mute ? 0 : 1);
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
    const gr = g.createLinearGradient(0, 0, 96, 54);
    gr.addColorStop(0, c1);
    gr.addColorStop(1, c2);
    g.fillStyle = gr;
    g.fillRect(0, 0, 96, 54);
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.font = '800 22px Unbounded, Manrope, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(txt, 48, 29);
    return m;
  };
  mini.A = mk('#3b4f86', '#1b2440', 'A');
  mini.B = mk('#f1a93b', '#c0532f', 'B');
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

export function loop(now) {
  if (S.playing) {
    S.T += (now - S.last) / 1000;
    if (S.T >= S.total) {
      S.T = S.total;
      if (S.exporting) finishExport();
      pause();
    }
  }
  S.last = now;
  syncMedia(S.T);
  renderFrame(S.T);
  const x = S.T * S.pps + 12;
  $('#ph').style.left = x + 'px';
  $('#tcNow').textContent = fmtT(S.T);
  if (S.playing && (x > tlScroll.scrollLeft + tlScroll.clientWidth - 40 || x < tlScroll.scrollLeft))
    tlScroll.scrollLeft = x - 60;
  if (S.exporting) {
    const b = $('#expBar');
    if (b) b.style.width = (S.T / S.total) * 100 + '%';
  }
  drawMinis(now);
  requestAnimationFrame(loop);
}
