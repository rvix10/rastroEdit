import { S, nid } from './state.js';
import { toast } from './util.js';
import { ballPos } from './demo.js';
import { demoClip } from './clips.js';
import { updPlayBtn, makeMini, loop } from './playback.js';
import { runTrack } from './tracker.js';
import { renderTabs, renderPanel } from './panel.js';
import { renderTimeline } from './timeline-ui.js';
import { bootProjects, adoptCurrent, updHistUI } from './project.js';
import './store.js';
import './timeline.js';
import './transitions.js';
import './render.js';
import './export.js';
import './actions.js';
import './pwa.js';
import { applyTheme } from './theme.js';
import { initViewer } from './viewer.js';
import './timeline-touch.js';

/* ---------- arranque ---------- */
// Proyecto de ejemplo: se arma solo la primera vez (sin proyectos guardados).
function buildDemo() {
  const c1 = demoClip('cancha'),
    c2 = demoClip('avenida'),
    c3 = demoClip('lago');
  c2.trans = { type: 'zoom', d: 0.7 };
  c2.filter = 'cine';
  c3.trans = { type: 'blur', d: 0.8 };
  S.clips = [c1, c2, c3];
  S.sel = c1.id;
  const bp = ballPos(0.4);
  c1.track = { seed: { t: 0.4, x: bp.x, y: bp.y }, pts: [] };
  const base = { font: 'impacto', style: 'outline', color: '#ffffff', anim: 'pop' };
  S.ovs = [
    {
      ...base,
      id: nid(),
      clipId: c1.id,
      kind: 'text',
      text: 'DOMINGO DE FÚTBOL',
      size: 0.07,
      follow: false,
      x: 0.5,
      y: 0.2,
      t0: 0,
      t1: 1.9,
    },
    {
      ...base,
      id: nid(),
      clipId: c1.id,
      kind: 'ring',
      text: '',
      color: '#f1a93b',
      size: 0.075,
      follow: true,
      x: 0,
      y: 0,
      t0: 0.7,
      t1: 5,
    },
    {
      ...base,
      id: nid(),
      clipId: c1.id,
      kind: 'text',
      text: '¡Mira el balón!',
      font: 'limpia',
      style: 'box',
      color: '#f1a93b',
      size: 0.042,
      follow: true,
      x: 0,
      y: -0.14,
      t0: 1,
      t1: 5,
    },
    {
      ...base,
      id: nid(),
      clipId: c3.id,
      kind: 'text',
      text: 'Hasta el próximo domingo',
      font: 'mano',
      size: 0.1,
      follow: false,
      x: 0.5,
      y: 0.8,
      t0: 1,
      t1: 4.5,
      anim: 'fade',
    },
  ];
  return c1;
}

export async function init() {
  applyTheme();
  initViewer();
  makeMini();
  if (document.fonts) document.fonts.ready.then(makeMini); // las miniaturas usan la fuente de la interfaz
  renderTabs();
  renderTimeline();
  renderPanel();
  updPlayBtn();
  updHistUI();
  requestAnimationFrame(t => {
    S.last = t;
    loop(t);
  });
  ((document.fonts && document.fonts.ready) || Promise.resolve()).then(() => {
    makeMini();
  });
  setTimeout(async () => {
    try {
      S.dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null;
    } catch (e) {
      S.dl = null;
    }
    if (S.tab === 'export') renderPanel();
  }, 0);

  const opened = await bootProjects();
  if (!opened) {
    const c1 = buildDemo();
    renderTimeline();
    renderPanel();
    await runTrack(c1, true); // el rastreo del ejemplo queda guardado con el proyecto
    await adoptCurrent('Domingo de fútbol');
    renderPanel();
  }
}
window.addEventListener('resize', () => renderTimeline());

// Si algo falla de forma inesperada, un aviso claro en vez de silencio (como mucho uno cada 8 s)
let lastOops = 0;
const oops = () => {
  if (Date.now() - lastOops < 8000) return;
  lastOops = Date.now();
  toast('Algo falló. Tu proyecto está guardado; si se repite, recarga la página.');
};
window.addEventListener('error', e => {
  if (!e.filename || e.filename.startsWith(location.origin)) oops();
});
window.addEventListener('unhandledrejection', () => oops());
init();
