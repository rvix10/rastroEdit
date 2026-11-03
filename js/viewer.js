/* ---------- tamaño de la vista previa según el dispositivo ----------
   El lienzo (#stage) se ajusta por JS al lugar que tiene, con su proporción (16:9, 9:16, 1:1): con CSS solo
   no se puede limitar a la vez el ancho y el alto dentro de la grilla sin que se salga.
   Cuatro diseños (los mismos que styles.css):
   - wide    (≥ 900 px de ancho): la vista previa llena su celda; la barra cambia el alto de la línea de tiempo.
   - tablet  (vertical, ≥ 960 px de alto) · phone (vertical, < 960) · land (celular acostado):
             la barra cambia el alto máximo de la vista previa (fracción del alto de la pantalla).
   Cada diseño recuerda su tamaño en este navegador (localStorage); doble toque o Enter en la barra lo restablece.
*/
import { $, cv } from './state.js';

const KEY = 'rastro.pv';
const MODES = [
  ['wide', '(min-width: 900px)'],
  ['tablet', '(max-width: 899px) and (min-height: 960px)'],
  ['land', '(max-width: 899px) and (max-height: 599.98px)'],
  ['phone', '(max-width: 899px)'],
];
// Alto máximo de la vista previa (fracción del alto de la pantalla): por defecto y límites.
// Un proyecto vertical (9:16) necesita más alto para verse igual de grande.
const DEF = { tablet: 0.42, phone: 0.4 },
  DEF_TALL = { tablet: 0.5, phone: 0.48 };
const LIM = { tablet: [0.2, 0.62], phone: [0.2, 0.56], land: [0.4, 0.86] };
const TL_MIN = 150; // alto mínimo de la línea de tiempo (wide)

let saved = {};
try {
  saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
} catch (e) {}
const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(saved));
  } catch (e) {}
};

export function pvMode() {
  for (const [k, q] of MODES) if (matchMedia(q).matches) return k;
  return 'phone';
}
// Alto de pantalla estable: el de "100svh" (no cambia cuando el navegador muestra u oculta sus barras al desplazar)
const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:100svh;visibility:hidden;pointer-events:none';
document.body.appendChild(probe);
const screenH = () => probe.offsetHeight || innerHeight;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function tlLimits() {
  return [TL_MIN, Math.max(TL_MIN, screenH() - 320)];
}
function tlDefault() {
  return matchMedia('(pointer: coarse)').matches ? 230 : 214; // igual que styles.css
}
/** Valor actual del diseño: fracción del alto (vertical/acostado) o alto de la línea de tiempo en px (wide). */
function value(mode) {
  if (mode === 'wide') {
    const [a, b] = tlLimits();
    return clamp(saved.wide ?? tlDefault(), a, b);
  }
  const [a, b] = LIM[mode];
  // Acostado: por defecto entran el encabezado, la vista previa y los controles sin desplazar
  const def = mode === 'land' ? (screenH() - 140) / screenH() : (cv.height > cv.width ? DEF_TALL : DEF)[mode];
  return clamp(saved[mode] ?? def, a, b);
}

/** Ajusta el lienzo al lugar disponible, con la proporción del proyecto. */
export function fitStage() {
  const v = $('#viewer');
  if (!v || !cv.width || !cv.height) return;
  const mode = pvMode(),
    app = document.querySelector('.app');
  if (mode === 'wide') app.style.setProperty('--tl-h', Math.round(value('wide')) + 'px');
  else app.style.removeProperty('--tl-h');
  v.classList.toggle('fill', mode === 'wide');
  const cs = getComputedStyle(v),
    padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight),
    padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom),
    bY = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
  const aw = Math.max(40, v.clientWidth - padX),
    ah = Math.max(40, mode === 'wide' ? v.clientHeight - padY : value(mode) * screenH() - padY - bY);
  const ar = cv.width / cv.height;
  let w = aw,
    h = w / ar;
  if (h > ah) {
    h = ah;
    w = h * ar;
  }
  w = Math.floor(w);
  h = Math.floor(h);
  if (cv.style.width !== w + 'px') cv.style.width = w + 'px';
  if (cv.style.height !== h + 'px') cv.style.height = h + 'px';
  updGrip(mode);
}

/* ---------- la barra para cambiar el tamaño ---------- */
function updGrip(mode) {
  const g = $('#pvGrip');
  if (!g) return;
  let pct;
  if (mode === 'wide') {
    const [a, b] = tlLimits();
    pct = b > a ? (b - value('wide')) / (b - a) : 0.5; // línea de tiempo más baja = vista previa más grande
  } else {
    const [a, b] = LIM[mode];
    pct = (value(mode) - a) / (b - a);
  }
  g.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
}
/** Cambia el tamaño: d > 0 agranda la vista previa (px de arrastre o de teclado). */
function resizeBy(mode, start, d) {
  if (mode === 'wide') {
    const [a, b] = tlLimits();
    saved.wide = clamp(start - d, a, b);
  } else {
    const [a, b] = LIM[mode];
    saved[mode] = clamp(start + d / screenH(), a, b);
  }
  fitStage();
}
function reset() {
  delete saved[pvMode()];
  save();
  fitStage();
}

let drag = null;
function initGrip() {
  const g = $('#pvGrip');
  if (!g) return;
  g.addEventListener('pointerdown', e => {
    if (e.button > 0) return;
    e.preventDefault();
    const mode = pvMode();
    drag = { id: e.pointerId, y: e.clientY, mode, start: value(mode), moved: false };
    g.setPointerCapture(e.pointerId);
    g.classList.add('on');
  });
  g.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = e.clientY - drag.y;
    if (Math.abs(d) > 3) drag.moved = true;
    resizeBy(drag.mode, drag.start, d);
  });
  const end = e => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    g.classList.remove('on');
    save();
  };
  g.addEventListener('pointerup', end);
  g.addEventListener('pointercancel', end);
  g.addEventListener('dblclick', reset);
  g.addEventListener('keydown', e => {
    const mode = pvMode(),
      step = e.shiftKey ? 80 : 24;
    const k = { ArrowDown: step, ArrowUp: -step, PageDown: 400, PageUp: -400, End: 1e5, Home: -1e5 }[e.key];
    if (k != null) {
      e.preventDefault();
      resizeBy(mode, value(mode), k);
      save();
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      reset();
    }
  });
}

export function initViewer() {
  initGrip();
  fitStage();
  const ro = new ResizeObserver(() => fitStage());
  ro.observe($('#viewer'));
  ro.observe(document.querySelector('.stage'));
  addEventListener('resize', fitStage);
  // Cambia la proporción del proyecto (setAspect cambia el tamaño del lienzo): volver a ajustar
  new MutationObserver(fitStage).observe(cv, { attributes: true, attributeFilter: ['width', 'height'] });
  for (const [, q] of MODES) matchMedia(q).addEventListener('change', fitStage);
}
