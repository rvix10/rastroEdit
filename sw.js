/* ---------- service worker: la app funciona sin conexión ----------
   - Al instalarse guarda la app completa (APP). Si agregas un archivo a js/ o css/, súmalo aquí
     (la prueba de humo revisa que estén todos).
   - Archivos propios: primero la red (así una versión nueva nunca queda vieja en caché); si no hay conexión o
     tarda más de 3 s, la copia guardada.
   - Fuentes de Google: la copia guardada si existe (cambian poco), y se actualiza en segundo plano.
   Los videos no pasan por aquí: viven en IndexedDB / OPFS y se usan como blob:.
*/
const CACHE = 'rastro-app-v1';
const APP = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/styles.css',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'js/actions.js',
  'js/archive.js',
  'js/clips.js',
  'js/demo.js',
  'js/demux.js',
  'js/diag.js',
  'js/export.js',
  'js/fastexport.js',
  'js/frames.js',
  'js/main.js',
  'js/mp4.js',
  'js/music.js',
  'js/panel.js',
  'js/playback.js',
  'js/project.js',
  'js/pwa.js',
  'js/render.js',
  'js/state.js',
  'js/store.js',
  'js/timeline-touch.js',
  'js/timeline-ui.js',
  'js/timeline.js',
  'js/track-worker.js',
  'js/trackcore.js',
  'js/tracker.js',
  'js/transitions.js',
  'js/util.js',
];
const FONTS = /^https:\/\/fonts\.(googleapis|gstatic)\.com\//;
// La misma hoja de fuentes que index.html: se guarda al instalar, con sus archivos, para que sin conexión se vean igual
const FONT_CSS =
  'https://fonts.googleapis.com/css2?family=Caveat:wght@700&family=JetBrains+Mono:wght@500&family=Manrope:wght@400;600;700;800&family=Unbounded:wght@600;800&display=swap';
async function cacheFonts(cache) {
  try {
    const res = await fetch(FONT_CSS);
    if (!res.ok) return;
    await cache.put(FONT_CSS, res.clone());
    const urls = [...(await res.text()).matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map(m => m[1]);
    await Promise.all(urls.map(u => cache.add(u).catch(() => {})));
  } catch (e) {} // sin las fuentes, la app usa las del sistema
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(c => c.addAll(APP).then(() => cacheFonts(c)))
      .then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches
      .keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('rastro-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  // Errores de red → null (nunca queda una promesa rechazada sin manejar)
  const net = fetch(req)
    .then(res => {
      if (res && res.status === 200) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  const timeout = new Promise(r => setTimeout(() => r(undefined), 3000));
  const first = await Promise.race([net, timeout]);
  if (first) return first;
  // Sin red (null) o lenta (undefined): la copia guardada si existe
  const cached =
    (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' && (await cache.match('index.html')));
  if (cached) return cached;
  const late = first === undefined ? await net : null;
  return late || Response.error();
}
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const net = fetch(req)
    .then(res => {
      if (res && (res.status === 200 || res.type === 'opaque')) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await net) || Response.error();
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
  else if (FONTS.test(req.url)) e.respondWith(cacheFirst(req));
});
