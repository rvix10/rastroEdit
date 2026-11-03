/* ---------- service worker: la app funciona sin conexión ----------
   - Al instalarse guarda la app completa (APP). Si agregas un archivo a js/ o css/, súmalo aquí
     (la prueba de humo revisa que estén todos).
   - Archivos propios: primero la red (así una versión nueva nunca queda vieja en caché); si no hay conexión o
     tarda más de 3 s, la copia guardada.
   Los videos no pasan por aquí: viven en IndexedDB / OPFS y se usan como blob:.
*/
const CACHE = 'rastro-app-v1';
const APP = [
  './',
  'index.html',
  'privacy.html',
  'manifest.webmanifest',
  'css/styles.css',
  'css/fonts.css',
  'fonts/Caveat-latin-a57fce.woff2',
  'fonts/Caveat-latin-ext-bc84ef.woff2',
  'fonts/JetBrainsMono-latin-37e607.woff2',
  'fonts/JetBrainsMono-latin-ext-3b700b.woff2',
  'fonts/Manrope-latin-ext-686e70.woff2',
  'fonts/Manrope-latin-f6cd5e.woff2',
  'fonts/SpaceGrotesk-latin-ext.woff2',
  'fonts/SpaceGrotesk-latin.woff2',
  'fonts/Unbounded-latin-15f1af.woff2',
  'fonts/Unbounded-latin-ext-135400.woff2',
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
  'js/theme.js',
  'js/timeline-touch.js',
  'js/timeline-ui.js',
  'js/timeline.js',
  'js/track-worker.js',
  'js/trackcore.js',
  'js/tracker.js',
  'js/transitions.js',
  'js/util.js',
];
self.addEventListener('install', e => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(c => c.addAll(APP))
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
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) e.respondWith(networkFirst(req));
});
