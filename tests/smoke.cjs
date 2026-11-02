// Prueba de humo en Chromium (Playwright). Sin dependencias en el repo:
//   node tests/smoke.cjs
// Necesita `playwright` disponible (en el entorno de la nube ya viene) y `ffmpeg` para el video de prueba.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'test.webm');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webm': 'video/webm' };

// Video de 4 s con un objeto cuyo centro es x = 110+240t, y = 330+120·sin 2t (en 1280×720)
function ensureFixture() {
  if (fs.existsSync(FIX)) return;
  fs.mkdirSync(path.dirname(FIX), { recursive: true });
  execFileSync(
    'ffmpeg',
    [
      '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:d=4:r=30',
      '-f', 'lavfi', '-i', 'testsrc=s=60x60:d=4:r=30',
      '-f', 'lavfi', '-i', 'sine=f=440:d=4',
      '-filter_complex',
      "[0:v]hue=s=0.35,eq=brightness=-0.15[bg];[1:v]format=yuv420p[ob];[bg][ob]overlay=x='80+t*240':y='300+120*sin(t*2)':eval=frame,format=yuv420p[v]",
      '-map', '[v]', '-map', '2:a', '-c:v', 'libvpx', '-b:v', '3M', '-c:a', 'libopus', FIX,
    ],
    { stdio: 'inherit' }
  );
}
const truth = t => ({ x: 110 + 240 * t, y: 330 + 120 * Math.sin(2 * t) });

function serve() {
  const srv = http.createServer((req, res) => {
    const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    const f = p.endsWith('/') ? p + 'index.html' : p;
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, () => r(srv)));
}

let failed = 0;
function check(ok, msg) {
  console.log((ok ? '  ok   ' : '  FALLA ') + msg);
  if (!ok) failed++;
}
async function until(page, fn, arg, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn, arg)) return true;
    await page.waitForTimeout(100);
  }
  return false;
}
const mods = `const st = await import('/js/state.js'), pj = await import('/js/project.js'), ac = await import('/js/actions.js');`;

(async () => {
  ensureFixture();
  const srv = await serve();
  const url = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

  for (const width of [1280, 390]) {
    console.log(`\nVista de ${width} px`);
    const page = await browser.newPage({ viewport: { width, height: 820 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await page.goto(url);
    check(
      await until(page, async () => (await import('/js/state.js')).S.clips.length === 3),
      'carga el proyecto de ejemplo'
    );
    for (const tab of await page.$$eval('[data-tab]', a => a.map(x => x.dataset.tab))) {
      await page.click(`[data-tab="${tab}"]`);
      await page.waitForTimeout(150);
    }
    check((await page.evaluate(() => document.documentElement.scrollWidth)) <= width, 'sin scroll horizontal');
    if (width !== 1280) {
      check(!errs.length, 'sin errores en consola' + (errs.length ? ': ' + errs.join(' | ') : ''));
      await page.close();
      continue;
    }

    // Importar video
    await page.click('[data-tab="media"]');
    await page.setInputFiles('#fileIn', FIX);
    check(
      await until(page, async () => (await import('/js/state.js')).S.clips.some(c => c.kind === 'video'), null, 20000),
      'importa un video WebM'
    );
    await page.evaluate(`(async () => { ${mods} ac.act('clearDemo'); })()`);
    check((await page.evaluate(`(async () => { ${mods} return st.S.clips.length })()`)) === 1, 'quita los clips de ejemplo');

    // Rastreo: semilla en t = 1 s, comparar en t = 2 s y 3 s contra la posición real
    const seed = truth(1);
    const errPx = await page.evaluate(
      `(async () => { ${mods} const tr = await import('/js/tracker.js');
        const c = st.S.clips[0]; c.track = { seed: { t: 1, x: ${seed.x / 1280}, y: ${seed.y / 720} }, pts: [] };
        await tr.runTrack(c, true);
        const at = t => c.track.pts.reduce((a, p) => Math.abs(p.t - t) < Math.abs(a.t - t) ? p : a);
        return [2, 3].map(t => { const p = at(t), tx = 110 + 240 * p.t, ty = 330 + 120 * Math.sin(2 * p.t);
          return Math.hypot(p.x * 1280 - tx, p.y * 720 - ty) }) })()`
    );
    check(Math.max(...errPx) < 12, `rastreo preciso (error ${errPx.map(e => e.toFixed(1)).join(' / ')} px)`);

    // Reloj del proyecto pegado al video. Se fuerzan tirones (el <video> vuelve a buscar su cuadro,
    // como pasa al arrancar un clip o en equipos lentos) y se mide el desfase que queda después.
    const drift = await page.evaluate(
      `(async () => { ${mods} const pb = await import('/js/playback.js');
        const c = st.S.clips[0], frame = () => new Promise(r => requestAnimationFrame(r));
        const gap = () => Math.abs(st.S.T - (c._start + c.el.currentTime - c.in));
        pb.seek(0.2); pb.play();
        for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 250)); c.el.currentTime = c.el.currentTime }
        await new Promise(r => setTimeout(r, 300));
        const g = []; for (let i = 0; i < 20; i++) { await frame(); if (!c.el.seeking) g.push(gap()) }
        pb.pause(); g.sort((a, b) => a - b); return g[g.length >> 1] })()`
    );
    check(drift < 0.05, `reloj sincronizado con el video (desfase ${(drift * 1000).toFixed(0)} ms tras tirones)`);

    // Exportar, con la pestaña en segundo plano a mitad de camino
    await page.click('[data-tab="export"]');
    await page.evaluate(`(async () => { ${mods} ac.act('export'); })()`);
    await page.waitForTimeout(1200);
    const setVis = v =>
      page.evaluate(v => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
        document.dispatchEvent(new Event('visibilitychange'));
      }, v);
    await setVis('hidden');
    const p1 = await page.evaluate(`(async () => { ${mods} return [st.S.rec.state, st.S.playing, st.S.T] })()`);
    await page.waitForTimeout(800);
    const T2 = await page.evaluate(`(async () => { ${mods} return st.S.T })()`);
    check(p1[0] === 'paused' && !p1[1] && T2 === p1[2], 'en segundo plano la exportación se pausa');
    await setVis('visible');
    check(
      await until(page, async () => !!(await import('/js/state.js')).S.result, null, 15000),
      'la exportación se reanuda y termina'
    );
    const res = await page.evaluate(`(async () => { ${mods} return st.S.result.size })()`);
    check(res > 10000, `archivo exportado (${(res / 1024).toFixed(0)} KB)`);

    // Limpieza de videos guardados
    const gc = await page.evaluate(
      `(async () => { ${mods} const db = await import('/js/store.js');
        const id = st.S.clips[0].mediaId;
        await pj.saveNow();
        ac.act('del'); await pj.saveNow();
        const r = await db.dbGet('media', id); await db.dbPut('media', { ...r, at: 0 });
        const withHist = await pj.collectMedia();             // deshacer todavía lo necesita
        pj.resetHistory(); const after = await pj.collectMedia(); // ya nadie lo usa
        return { withHist, after, gone: !(await db.dbGet('media', id)) } })()`
    );
    check(gc.withHist === 0, 'no borra videos que el historial de deshacer aún usa');
    check(gc.after >= 1 && gc.gone, 'borra el video de un clip eliminado al descartar el historial');

    check(!errs.length, 'sin errores en consola' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await page.close();
  }

  await browser.close();
  srv.close();
  console.log(failed ? `\n${failed} prueba(s) fallaron` : '\nTodo bien');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
