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
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=s=1280x720:d=4:r=30',
      '-f',
      'lavfi',
      '-i',
      'testsrc=s=60x60:d=4:r=30',
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:d=4',
      '-filter_complex',
      "[0:v]hue=s=0.35,eq=brightness=-0.15[bg];[1:v]format=yuv420p[ob];[bg][ob]overlay=x='80+t*240':y='300+120*sin(t*2)':eval=frame,format=yuv420p[v]",
      '-map',
      '[v]',
      '-map',
      '2:a',
      '-c:v',
      'libvpx',
      '-b:v',
      '3M',
      '-c:a',
      'libopus',
      FIX,
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
    check(
      (await page.evaluate(`(async () => { ${mods} return st.S.clips.length })()`)) === 1,
      'quita los clips de ejemplo'
    );

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

    // Archivo .rastro: guardar el proyecto con su video y volver a abrirlo como proyecto nuevo
    await page.click('[data-tab="projects"]');
    const before = await page.evaluate(
      `(async () => { ${mods} const c = st.S.clips[0];
        return { id: pj.P.project.id, n: st.S.clips.length, pts: c.track.pts.length, dur: c.dur, ovs: st.S.ovs.length } })()`
    );
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="exportProj"]')]);
    const rastro = path.join(__dirname, 'fixtures', 'smoke.rastro');
    await dl.saveAs(rastro);
    check(
      dl.suggestedFilename().endsWith('.rastro') && fs.statSync(rastro).size > fs.statSync(FIX).size,
      `guarda ${dl.suggestedFilename()} con el video`
    );
    await page.setInputFiles('#rastroIn', rastro);
    check(
      await until(
        page,
        async id => (await import('/js/project.js')).P.project.id !== id && !(await import('/js/project.js')).P.file,
        before.id
      ),
      'abre el .rastro como proyecto nuevo'
    );
    const after = await page.evaluate(
      `(async () => { ${mods} await new Promise(r => setTimeout(r, 500)); const c = st.S.clips[0];
        return { n: st.S.clips.length, pts: c.track.pts.length, dur: c.dur, ovs: st.S.ovs.length, missing: c.missing,
          ready: !!c.el && c.el.readyState >= 1, saved: (await pj.refreshList(), pj.P.list.length) } })()`
    );
    check(
      after.n === before.n && after.pts === before.pts && after.ovs === before.ovs && !after.missing && after.ready,
      'el proyecto importado conserva clips, rastreo, textos y video'
    );
    const bad = path.join(__dirname, 'fixtures', 'malo.rastro');
    fs.writeFileSync(bad, 'esto no es un zip');
    await page.setInputFiles('#rastroIn', bad);
    check(
      await until(
        page,
        () => /no es un proyecto/.test(document.querySelector('#toast')?.textContent || ''),
        null,
        5000
      ),
      'avisa si el archivo no es un .rastro'
    );

    // Limpieza de videos guardados
    const gc = await page.evaluate(
      `(async () => { ${mods} const db = await import('/js/store.js');
        const id = st.S.clips[0].mediaId;
        await pj.saveNow();
        ac.act('del'); await pj.saveNow();
        for (const p of await db.dbAll('projects')) if (p.id !== pj.P.project.id) await db.dbDel('projects', p.id); // el .rastro importado usa el mismo video
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

  // Otro equipo: navegador sin datos guardados abre el .rastro
  console.log('\nOtro navegador (sin datos)');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(url);
    await until(page, async () => (await import('/js/state.js')).S.clips.length === 3);
    await page.click('[data-tab="projects"]');
    await page.setInputFiles('#rastroIn', path.join(__dirname, 'fixtures', 'smoke.rastro'));
    const ok = await until(
      page,
      async () => {
        const { S } = await import('/js/state.js');
        const c = S.clips[0];
        return S.clips.length === 1 && c.kind === 'video' && !c.missing && c.el && c.el.readyState >= 2;
      },
      null,
      15000
    );
    check(ok, 'abre el .rastro con su video');
    await page.reload();
    const kept = await until(
      page,
      async () => {
        const { S } = await import('/js/state.js');
        return S.clips.length === 1 && S.clips[0].el && !S.clips[0].missing;
      },
      null,
      15000
    );
    check(kept, 'tras recargar, el proyecto y el video siguen guardados');
    check(!errs.length, 'sin errores' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  await browser.close();
  srv.close();
  console.log(failed ? `\n${failed} prueba(s) fallaron` : '\nTodo bien');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
