/* ---------- app instalable (PWA) ----------
   Registra el service worker (sw.js: la app funciona sin conexión) y guarda el aviso de instalación
   del navegador para mostrar «Instalar app» en Proyectos. En Android, Chrome la instala como una app
   más: ícono, pantalla completa y sin barra del navegador.
*/
import { S } from './state.js';
import { toast } from './util.js';

S.pwa = { prompt: null, installed: false, sw: false };

export const isStandalone = () =>
  (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;

let onChange = () => {};
/** panel.js avisa cómo redibujarse cuando cambia algo (sin depender de él al cargar). */
export function onPwaChange(fn) {
  onChange = fn;
}

if (
  'serviceWorker' in navigator &&
  (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))
) {
  // Después de cargar, para no competir con el arranque
  const register = () =>
    navigator.serviceWorker
      .register('./sw.js')
      .then(() => {
        S.pwa.sw = true;
        onChange();
      })
      .catch(() => {});
  if (document.readyState === 'complete') register();
  else addEventListener('load', register);
}

addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); // se ofrece desde Proyectos, cuando la persona quiera
  S.pwa.prompt = e;
  onChange();
});
addEventListener('appinstalled', () => {
  S.pwa.prompt = null;
  S.pwa.installed = true;
  onChange();
  toast('Rastro quedó instalada');
});

/** Muestra el diálogo de instalación del navegador. */
export async function promptInstall() {
  const p = S.pwa.prompt;
  if (!p) return;
  S.pwa.prompt = null;
  p.prompt();
  try {
    const r = await p.userChoice;
    if (r && r.outcome !== 'accepted') S.pwa.prompt = null;
  } catch (e) {}
  onChange();
}
