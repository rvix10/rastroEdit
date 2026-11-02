import { $, S } from './state.js';

/* ---------- utilidades ---------- */
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const ease = p => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
export const easeOutBack = k => {
  const c1 = 1.70158,
    c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
};
export const hash = n => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
export const esc = s =>
  String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const fmtS = t => t.toFixed(1).replace('.', ',') + ' s';
export function fmtT(t) {
  t = Math.max(0, t);
  const m = Math.floor(t / 60),
    s = Math.floor(t % 60),
    f = Math.floor((t % 1) * 100);
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') + '.' + String(f).padStart(2, '0');
}
export function rng(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}
export let toastT;
export function toast(m) {
  const el = $('#toast');
  el.textContent = m;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (el.hidden = true), 2600);
}
export function roundRect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
export const getSel = () => S.clips.find(c => c.id === S.sel) || null;
export const getOv = () => S.ovs.find(o => o.id === S.selOv) || null;
