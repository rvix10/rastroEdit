// Prueba de humo en Chromium (Playwright). Sin dependencias en el repo:
//   node tests/smoke.cjs                 todo
//   node tests/smoke.cjs tactil 2puntos  solo esas secciones (basico, tablet, tactil, audio, export, rastreo, acceso, pwa, 2puntos, 4esquinas, vista, rotacion, demux)
// Necesita `playwright` disponible (en el entorno de la nube ya viene) y `ffmpeg` para el video de prueba.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'test.webm');
const TYPES = {
  '.woff2': 'font/woff2',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ogg': 'audio/ogg',
};

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
// Más archivos para el demuxer y la rotación (se omiten si este ffmpeg no tiene el códec)
const EXTRA = {
  'h264-bframes.mp4': ['-i', FIX, '-c:v', 'libx264', '-bf', '2', '-g', '45', '-c:a', 'aac'],
  'vp9.mp4': ['-i', FIX, '-t', '2', '-c:v', 'libvpx-vp9', '-b:v', '2M', '-an'],
  'live.webm': ['-i', FIX, '-c', 'copy', '-live', '1', '-f', 'webm'],
};
function ensureExtra() {
  const out = {};
  const run = (name, args) => {
    const f = path.join(__dirname, 'fixtures', name);
    if (!fs.existsSync(f))
      try {
        execFileSync('ffmpeg', ['-loglevel', 'error', '-y', ...args, f]);
      } catch (e) {
        return;
      }
    out[name] = f;
  };
  for (const [name, args] of Object.entries(EXTRA)) run(name, args);
  // Objeto con textura que gira 0,5·t rad (sentido horario) y crece ×(1 + 0,2·t), centro en (500 + 60t, 360)
  run('rotscale.webm', [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=1280x720:d=4:r=30',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=160x160:r=30,loop=loop=-1:size=1:start=0,trim=duration=4',
    '-filter_complex',
    "[0:v]hue=s=0.2,eq=brightness=-0.25[bg];[1:v]format=rgba,rotate=a='0.5*t':c=none:ow=232:oh=232," +
      "scale=w='trunc(232*(1+0.2*t)/2)*2':h='trunc(232*(1+0.2*t)/2)*2':eval=frame[o];" +
      "[bg][o]overlay=x='500+60*t-w/2':y='360-h/2':eval=frame,format=yuv420p[v]",
    '-map',
    '[v]',
    '-c:v',
    'libvpx',
    '-b:v',
    '4M',
  ]);
  // Plano con textura (tipo tierra) y un lote marcado, en perspectiva que cambia: las esquinas de la imagen
  // (0,0) (1280,0) (0,720) (1280,720) van a las de PLANAR_CORNERS(t)
  run('planar.webm', [
    '-f',
    'lavfi',
    '-i',
    "nullsrc=s=160x90:r=30,geq=lum='128+90*(random(1)-0.5)':cb=128:cr=128,scale=1280:720:flags=bicubic",
    '-f',
    'lavfi',
    '-i',
    "nullsrc=s=640x360:r=30,geq=lum='128+60*(random(2)-0.5)':cb=128:cr=128,scale=1280:720:flags=bicubic",
    '-filter_complex',
    '[0:v][1:v]blend=all_mode=overlay,eq=contrast=1.3,colorchannelmixer=rr=0.55:gg=0.42:bb=0.3,' +
      'drawbox=x=360:y=200:w=560:h=340:color=white@0.8:t=5,trim=end_frame=1,loop=loop=119:size=1:start=0,' +
      "setpts=N/30/TB,perspective=x0='100+30*in/30':y0='60+40*in/30':x1='1180-50*in/30':y1='40+60*in/30':" +
      "x2='60+20*in/30':y2='680-20*in/30':x3='1220-30*in/30':y3='700-40*in/30':sense=destination:eval=frame,format=yuv420p[v]",
    '-map',
    '[v]',
    '-r',
    '30',
    '-c:v',
    'libvpx',
    '-b:v',
    '4M',
  ]);
  // Video de celular girado: solo se marca la rotación (sin recodificar)
  if (out['vp9.mp4']) run('rot90.mp4', ['-display_rotation', '90', '-i', out['vp9.mp4'], '-c', 'copy']);
  return out;
}
const ffprobePackets = f =>
  execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v',
    '-show_entries',
    'packet=pts_time,pos,size,flags',
    '-of',
    'csv=p=0',
    f,
  ])
    .toString()
    .trim()
    .split('\n')
    .map(l => l.split(','));

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
const ONLY = process.argv.slice(2);
const run = name => !ONLY.length || ONLY.includes(name);
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

  for (const width of run('basico') ? [1280, 390] : []) {
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

    // Exportación rápida (WebCodecs), con la pestaña en segundo plano a mitad de camino
    const setVis = v =>
      page.evaluate(v => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
      }, v);
    await page.click('[data-tab="export"]');
    await until(page, () => /MP4 · /.test(document.querySelector('.specs')?.textContent || ''), null, 5000);
    const fmt = await page.$eval('.specs', e => e.textContent);
    check(
      /MP4 · (H\.264|VP9|AV1)/.test(fmt),
      'ofrece la exportación rápida (' + (fmt.match(/MP4 · [^ ]+/) || [''])[0] + ')'
    );
    await page.click('[data-act="export"]');
    await until(page, async () => (await import('/js/state.js')).S.T > 0.5, null, 15000);
    await setVis('hidden');
    await page.waitForTimeout(300);
    const h1 = await page.evaluate(`(async () => { ${mods} return [st.S.expHidden, st.S.T] })()`);
    await page.waitForTimeout(800);
    const h2 = await page.evaluate(`(async () => { ${mods} return st.S.T })()`);
    check(h1[0] && h2 === h1[1], 'en segundo plano la exportación se pausa');
    await setVis('visible');
    check(
      await until(
        page,
        async () => {
          const { S } = await import('/js/state.js');
          return !!S.result && !S.exporting;
        },
        null,
        60000
      ),
      'la exportación se reanuda y termina'
    );
    const fx = await page.evaluate(
      `(async () => { ${mods} const r = st.S.result, { demux } = await import('/js/demux.js'), { FrameSource } = await import('/js/frames.js');
        const info = await demux(r.blob);
        // Posición del objeto en cuadros del archivo exportado (es lo único saturado de la imagen)
        const fs = await FrameSource.open(r.blob), cv = document.createElement('canvas'); cv.width = 320; cv.height = 180;
        const g = cv.getContext('2d', { willReadFrequently: true }), errs = [];
        for (let i = 3; i < 118; i += 8) {
          const t = i / 30; g.drawImage(await fs.frameAt(t), 0, 0, 320, 180);
          const d = g.getImageData(0, 0, 320, 180).data; let sx = 0, n = 0;
          for (let p = 0; p < d.length; p += 4) { const mx = Math.max(d[p], d[p+1], d[p+2]), mn = Math.min(d[p], d[p+1], d[p+2]);
            if (mx - mn > 120) { sx += (p / 4) % 320; n++ } }
          errs.push(Math.abs((sx / n) * 4 - (110 + 240 * t)));
        }
        fs.close();
        return { ext: r.ext, took: r.took, codec: info && info.codec, n: info && info.samples.length,
          err: errs.reduce((a, b) => a + b, 0) / errs.length, maxErr: Math.max(...errs) } })()`
    );
    check(
      fx.ext === 'mp4' && fx.n === 120,
      `MP4 con 120 cuadros (${fx.codec}, listo en ${fx.took.toFixed(1)} s para 4 s de video)`
    );
    check(
      fx.maxErr < 5,
      `cuadros exactos: el objeto está donde debe (error medio ${fx.err.toFixed(1)} px; un cuadro = 8 px)`
    );
    const [dlv] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="save"]')]);
    const outMp4 = path.join(__dirname, 'fixtures', 'export.mp4');
    await dlv.saveAs(outMp4);
    const probe = execFileSync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,codec_name,nb_frames',
      '-of',
      'csv=p=0',
      outMp4,
    ])
      .toString()
      .trim()
      .replace(/\n/g, ' · ');
    check(/video/.test(probe) && /audio/.test(probe), `ffprobe lee el archivo guardado (${probe})`);

    // Cancelar a mitad de camino
    const prev = await page.evaluate(`(async () => { ${mods} return st.S.result.url })()`);
    await page.click('[data-act="export"]');
    await until(page, async () => (await import('/js/state.js')).S.T > 0.3, null, 15000);
    await page.click('[data-act="cancelExport"]');
    check(
      await until(
        page,
        async u => {
          const { S } = await import('/js/state.js');
          return !S.exporting && S.result.url === u;
        },
        prev,
        5000
      ),
      'se puede detener la exportación'
    );

    // Si WebCodecs falla, se usa la exportación en tiempo real (MediaRecorder)
    const prevRt = await page.evaluate(`(async () => { ${mods} return st.S.result.url })()`);
    await page.evaluate(() => {
      window.VideoEncoder = class {
        constructor() {
          throw new Error('simulado');
        }
      };
    });
    await page.click('[data-act="export"]');
    check(
      await until(
        page,
        async () => {
          const { S } = await import('/js/state.js');
          return S.fastBroken && S.exporting && S.rec && S.rec.state === 'recording';
        },
        null,
        5000
      ),
      'si la exportación rápida falla, sigue en tiempo real'
    );
    await page.waitForTimeout(800);
    await setVis('hidden');
    const p1 = await page.evaluate(`(async () => { ${mods} return [st.S.rec.state, st.S.playing, st.S.T] })()`);
    await page.waitForTimeout(800);
    const T2 = await page.evaluate(`(async () => { ${mods} return st.S.T })()`);
    check(p1[0] === 'paused' && !p1[1] && T2 === p1[2], 'en tiempo real también se pausa en segundo plano');
    await setVis('visible');
    check(
      await until(
        page,
        async u => {
          const { S } = await import('/js/state.js');
          return !S.exporting && S.result.url !== u;
        },
        prevRt,
        15000
      ),
      'la exportación en tiempo real termina'
    );

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

  // Otro equipo: navegador sin datos guardados abre el .rastro (necesita el .rastro de la sección básica)
  if (run('basico')) {
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
      if (!ok)
        console.log(
          await page.evaluate(async () => {
            const { S } = await import('/js/state.js');
            const { P } = await import('/js/project.js');
            return JSON.stringify({
              clips: S.clips.map(c => [c.kind, c.missing, c.el && c.el.readyState]),
              tracking: S.tracking,
              file: P.file,
              toast: document.querySelector('#toast').textContent,
            });
          })
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
  }

  // Tablet y celular: objetivos táctiles de 44 px y diseño vertical con vista previa fija
  if (run('tablet')) {
    console.log('\nTablet y celular (pantalla táctil)');
    for (const [name, w, h] of [
      ['tablet vertical', 800, 1280],
      ['celular', 390, 844],
      ['celular angosto', 360, 740],
      ['celular con barras del navegador', 390, 700],
      ['tablet horizontal', 1280, 800],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      await page.goto(url);
      await until(page, async () => {
        const { S } = await import('/js/state.js');
        return S.clips.length === 3 && !S.tracking;
      });
      const small = new Set();
      for (const tab of ['media', 'edit', 'trans', 'track', 'text', 'export', 'projects']) {
        await page.evaluate(async t => {
          const { S } = await import('/js/state.js');
          if (t === 'text') S.selOv = S.ovs[0].id;
          (await import('/js/panel.js')).setTab(t);
        }, tab);
        await page.waitForTimeout(100);
        const r = await page.evaluate(() => {
          const out = [];
          for (const e of document.querySelectorAll(
            'button,[data-act],[data-tab],input,textarea,label.btn,label.chk'
          )) {
            if ((e.closest('.chk') && e.tagName === 'INPUT') || e.closest('.clip') || e.matches('.ovb')) continue;
            const b = e.getBoundingClientRect();
            if (!b.width || !b.height || e.type === 'file' || e.hidden) continue;
            // Las insignias de transición se ven chicas pero su área táctil (::before) mide 44×44
            if (e.matches('.tbtn')) {
              const v = document.querySelector('#tlScroll').getBoundingClientRect();
              if (b.left < v.left + 20 || b.right > v.right - 20) continue; // fuera de la vista: no se puede tocar
              const hit = [
                [0, -18],
                [0, 18],
                [-18, 0],
              ].every(([dx, dy]) => {
                const x = document.elementFromPoint(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy);
                return x && x.closest('.tbtn') === e;
              });
              if (!hit) out.push('insignia de transición');
              continue;
            }
            // Texto que no cabe en su botón (se ve cortado)
            if (e.tagName === 'BUTTON' && e.scrollWidth > e.clientWidth + 1)
              out.push((e.getAttribute('aria-label') || e.textContent).trim().slice(0, 20) + ' (texto cortado)');
            if (b.height < 43.5 || (b.width < 43.5 && e.type !== 'range'))
              out.push(
                (e.getAttribute('aria-label') || e.textContent || e.tagName).trim().slice(0, 20) +
                  ` ${Math.round(b.width)}×${Math.round(b.height)}`
              );
          }
          return out;
        });
        r.forEach(x => small.add(x));
      }
      check(
        !small.size,
        `${name}: todo lo tocable mide al menos 44 px` + (small.size ? ': ' + [...small].join(' · ') : '')
      );
      if (w >= 900 || h >= 960) {
        // Tablet (o pantalla alta): nada se mueve salvo el panel
        const lay = await page.evaluate(() => {
          const pn = document.querySelector('#panel'),
            top = () => Math.round(document.querySelector('#stage').getBoundingClientRect().top);
          const t0 = top();
          pn.scrollTop = 300;
          return {
            page: document.documentElement.scrollHeight - innerHeight,
            h: document.documentElement.scrollWidth - innerWidth,
            fixed: top() === t0,
          };
        });
        check(
          lay.page <= 0 && lay.h <= 0 && lay.fixed,
          `${name}: la página no se desplaza; el panel sí, con la vista previa fija`
        );
      } else {
        // Celular vertical: un solo desplazamiento (la página), vista previa fija arriba y pestañas abajo
        const lay = await page.evaluate(async () => {
          window.scrollTo(0, 0);
          await new Promise(r => setTimeout(r, 100));
          (await import('/js/panel.js')).setTab('media');
          await new Promise(r => setTimeout(r, 900));
          const st = document.querySelector('.stage'),
            pn = document.querySelector('#panel'),
            tb = document.querySelector('.tabs');
          const shown = Math.abs(pn.getBoundingClientRect().top - st.getBoundingClientRect().bottom - 8) < 3;
          window.scrollTo(0, 1e6);
          await new Promise(r => setTimeout(r, 100));
          const sb = st.getBoundingClientRect(),
            tbb = tb.getBoundingClientRect();
          const r = {
            scrolls: document.documentElement.scrollHeight > innerHeight + 50,
            inner: pn.scrollHeight <= pn.clientHeight + 1,
            stage: sb.top >= 0 && sb.top < 2 && sb.bottom < innerHeight * 0.6,
            tabs: Math.round(tbb.bottom) === innerHeight && tbb.top > innerHeight - 100,
            end: pn.getBoundingClientRect().bottom <= tbb.top + 1,
            h: document.documentElement.scrollWidth - innerWidth,
            shown,
          };
          window.scrollTo(0, 0);
          return r;
        });
        check(
          lay.scrolls && lay.inner && lay.stage && lay.tabs && lay.end && lay.h <= 0 && lay.shown,
          `${name}: se desplaza la página entera, con la vista previa fija arriba y las pestañas abajo` +
            (lay.scrolls && lay.inner && lay.stage && lay.tabs && lay.end && lay.h <= 0 && lay.shown
              ? ''
              : ': ' + JSON.stringify(lay))
        );
        // Deslizar en vertical sobre la línea de tiempo también desplaza la página
        const cdp = await ctx.newCDPSession(page);
        const tl = await page.$eval('#tlScroll', e => {
          const r = e.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height - 12 };
        });
        const touch = (type, y) =>
          cdp.send('Input.dispatchTouchEvent', {
            type,
            touchPoints: type === 'touchEnd' ? [] : [{ x: tl.x, y, id: 1 }],
          });
        await touch('touchStart', tl.y);
        for (let k = 1; k <= 10; k++) {
          await touch('touchMove', tl.y - k * 30);
          await page.waitForTimeout(16);
        }
        await touch('touchEnd');
        await page.waitForTimeout(400);
        const sy = await page.evaluate(() => scrollY);
        check(sy > 60, `${name}: deslizar hacia arriba sobre la línea de tiempo baja la página (${Math.round(sy)} px)`);
      }
      await ctx.close();
    }
    // En PC con mouse se mantiene el diseño compacto
    const pc = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await pc.goto(url);
    const hb = await pc.evaluate(() => document.querySelector('#bUndo').getBoundingClientRect().height);
    check(hb < 40, `PC con mouse: diseño compacto (deshacer mide ${Math.round(hb)} px)`);
    await pc.close();
  }

  // Vista previa: cabe en su lugar con cada proporción y cada pantalla; la barra cambia su tamaño y se recuerda
  if (run('vista')) {
    console.log('\nVista previa (tamaño según el dispositivo)');
    const fit = async page =>
      page.evaluate(async () => {
        const ac = await import('/js/actions.js'),
          out = [];
        for (const a of ['16:9', '9:16', '1:1']) {
          ac.act('aspect:' + a);
          await new Promise(r => setTimeout(r, 120));
          const c = document.querySelector('#stage').getBoundingClientRect(),
            v = document.querySelector('.viewer').getBoundingClientRect(),
            [x, y] = a.split(':').map(Number);
          const inside =
            c.left >= v.left - 1 && c.right <= v.right + 1 && c.top >= v.top - 1 && c.bottom <= v.bottom + 1;
          const ratio = Math.abs(c.width / c.height / (x / y) - 1) < 0.02;
          out.push({ a, inside, ratio, w: Math.round(c.width), h: Math.round(c.height) });
        }
        ac.act('aspect:16:9');
        return { out, ih: innerHeight, sw: document.documentElement.scrollWidth - innerWidth };
      });
    for (const [name, w, h, touch] of [
      ['celular', 390, 700, true],
      ['tablet vertical', 800, 1280, true],
      ['celular acostado', 800, 360, true],
      ['tablet horizontal', 1333, 800, true],
      ['PC', 1280, 800, false],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
      const page = await ctx.newPage();
      await page.goto(url);
      await until(page, async () => (await import('/js/state.js')).S.clips.length === 3);
      const r = await fit(page);
      const bad = r.out.filter(x => !x.inside || !x.ratio);
      check(
        !bad.length && r.sw <= 0,
        `${name}: la vista previa cabe en su lugar en 16:9, 9:16 y 1:1 (${r.out.map(x => `${x.w}×${x.h}`).join(', ')})`
      );
      if (name === 'celular') {
        const tall = r.out.find(x => x.a === '9:16');
        check(tall.h >= r.ih * 0.4, `celular: un video vertical se ve grande (${tall.h} px de ${r.ih})`);
      }
      if (name === 'celular acostado') {
        const play = await page.$eval('#bPlay', e => e.getBoundingClientRect().bottom <= innerHeight);
        check(play, 'celular acostado: la vista previa y los controles entran sin desplazar');
      }
      if (touch) {
        const hit = await page.evaluate(() => {
          const g = document.querySelector('#pvGrip');
          g.scrollIntoView({ block: 'center' });
          const b = g.getBoundingClientRect(),
            x = b.left + b.width / 2;
          return [-18, 0, 18].every(dy => document.elementFromPoint(x, b.top + b.height / 2 + dy) === g);
        });
        check(hit, `${name}: la barra de tamaño se toca en 44 px de alto`);
      }
      await ctx.close();
    }
    // Arrastrar la barra con el dedo (celular): la vista previa crece, se recuerda al recargar y Enter la restablece
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, isMobile: true });
      const page = await ctx.newPage();
      await page.goto(url);
      // (el rastreo automático del ejemplo debe terminar: mientras corre no se guarda)
      await until(page, async () => {
        const { S } = await import('/js/state.js');
        return S.clips.length === 3 && !S.tracking;
      });
      await page.evaluate(async () => (await import('/js/actions.js')).act('aspect:9:16'));
      await page.waitForTimeout(150);
      const ch = () => page.$eval('#stage', e => Math.round(e.getBoundingClientRect().height));
      const h0 = await ch();
      const g = await page.$eval('#pvGrip', e => {
        const b = e.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      });
      const cdp = await ctx.newCDPSession(page);
      const tp = (type, y) =>
        cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: g.x, y, id: 1 }] });
      await tp('touchStart', g.y);
      for (let k = 1; k <= 8; k++) {
        await tp('touchMove', g.y + k * 10);
        await page.waitForTimeout(20);
      }
      await tp('touchEnd');
      await page.waitForTimeout(100);
      const h1 = await ch();
      await page.evaluate(async () => (await import('/js/project.js')).saveNow());
      await page.reload();
      await until(page, async () => (await import('/js/state.js')).S.clips.length === 3);
      await page.waitForTimeout(150);
      const h2 = await ch();
      await page.focus('#pvGrip');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(100);
      const h3 = await ch();
      check(
        h1 >= h0 + 40 && Math.abs(h2 - h1) <= 2 && Math.abs(h3 - h0) <= 2,
        `celular: arrastrar la barra agranda la vista previa (${h0} → ${h1} px), se recuerda (${h2}) y Enter la restablece (${h3})`
      );
      await ctx.close();
    }
    // PC: arrastrar con el mouse achica la línea de tiempo y agranda la vista previa; con el teclado también
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(url);
      await until(page, async () => (await import('/js/state.js')).S.clips.length === 3);
      await page.evaluate(async () => (await import('/js/actions.js')).act('aspect:9:16'));
      await page.waitForTimeout(150);
      const st = () =>
        page.evaluate(() => ({
          c: Math.round(document.querySelector('#stage').getBoundingClientRect().height),
          tl: Math.round(document.querySelector('.tl').getBoundingClientRect().height),
        }));
      const a = await st();
      const g = await page.$eval('#pvGrip', e => {
        const b = e.getBoundingClientRect();
        return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
      });
      await page.mouse.move(g.x, g.y);
      await page.mouse.down();
      await page.mouse.move(g.x, g.y + 60, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(100);
      const b = await st();
      await page.focus('#pvGrip');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('ArrowUp');
      await page.waitForTimeout(100);
      const c = await st();
      check(
        b.tl <= a.tl - 50 && b.c >= a.c + 50 && c.tl > b.tl && c.c < b.c,
        `PC: la barra cambia el reparto entre vista previa y línea de tiempo (${a.c} → ${b.c} px; teclado: ${c.c} px)`
      );
      await page.evaluate(() => localStorage.removeItem('rastro.pv'));
      await page.close();
    }
  }

  // Línea de tiempo táctil: gestos con mouse y con dedos reales (eventos táctiles del protocolo de Chrome)
  if (run('tactil')) {
    console.log('\nLínea de tiempo táctil');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await page.goto(url);
    await until(page, async () => {
      const { S } = await import('/js/state.js');
      return S.clips.length === 3 && !S.tracking;
    });
    const cdp = await ctx.newCDPSession(page);
    const touch = (type, ps) =>
      cdp.send('Input.dispatchTouchEvent', { type, touchPoints: ps.map((q, i) => ({ x: q.x, y: q.y, id: i })) });
    const wait = ms => page.waitForTimeout(ms);
    const state = () =>
      page.evaluate(async () => {
        const { S } = await import('/js/state.js');
        return {
          order: S.clips.map(c => c.name),
          sel: (S.clips.find(c => c.id === S.sel) || {}).name,
          pps: S.pps,
          T: S.T,
          tab: S.tab,
          sl: document.querySelector('#tlScroll').scrollLeft,
          clips: Object.fromEntries(S.clips.map(c => [c.name, { in: c.in, out: c.out }])),
        };
      });
    const zoom = pps => page.evaluate(async p => (await import('/js/timeline-touch.js')).zoomAt(p, 640), pps);
    // Caja del clip en pantalla (antes lo desplaza para que se vea)
    const clipBox = name =>
      page.evaluate(async n => {
        const { S } = await import('/js/state.js');
        const e = document.querySelector(`.clip[data-id="${S.clips.find(k => k.name === n).id}"]`);
        e.scrollIntoView({ inline: 'center', block: 'nearest' });
        const r = e.getBoundingClientRect();
        return { x: r.x, y: r.y + 30, w: r.width, cx: r.x + r.width / 2 };
      }, name);
    const drag = async (from, to, steps = 8) => {
      for (let i = 1; i <= steps; i++) {
        await touch('touchMove', [{ x: from.x + ((to.x - from.x) * i) / steps, y: from.y }]);
        await wait(16);
      }
    };

    // Mouse: arrastrar un clip lo reordena
    await zoom(40);
    let a = await clipBox('Avenida'),
      l = await clipBox('Lago');
    await page.mouse.move(a.cx, a.y);
    await page.mouse.down();
    await page.mouse.move(l.x + l.w - 5, a.y, { steps: 8 });
    await page.mouse.up();
    await wait(150);
    let st0 = await state();
    check(st0.order.join() === 'Cancha,Lago,Avenida', 'mouse: arrastrar un clip lo reordena');

    // Dedo: deslizar sobre un clip desplaza (no reordena)
    await zoom(160);
    a = await clipBox('Cancha');
    const before = await state();
    await touch('touchStart', [{ x: 700, y: a.y }]);
    await drag({ x: 700, y: a.y }, { x: 520, y: a.y }, 6);
    await touch('touchEnd', []);
    await wait(500);
    const after = await state();
    check(
      after.sl > before.sl + 150 && after.order.join() === before.order.join(),
      `dedo: deslizar desplaza la línea de tiempo (${before.sl} → ${after.sl} px)`
    );

    // Dedo: mantener presionado y arrastrar reordena
    await zoom(40);
    a = await clipBox('Cancha');
    const end = await clipBox('Avenida');
    await touch('touchStart', [{ x: a.cx, y: a.y }]);
    await wait(450);
    const lifted = await page.evaluate(() => !!document.querySelector('.clip.lift'));
    await drag({ x: a.cx, y: a.y }, { x: end.x + end.w - 8, y: a.y }, 10);
    await touch('touchEnd', []);
    await wait(150);
    check(
      lifted && (await state()).order.join() === 'Lago,Avenida,Cancha',
      'dedo: mantener presionado y arrastrar reordena'
    );

    // Dedo: tocar selecciona; los bordes del seleccionado recortan
    await zoom(80);
    a = await clipBox('Avenida');
    await touch('touchStart', [{ x: a.cx, y: a.y }]);
    await wait(60);
    await touch('touchEnd', []);
    await wait(150);
    check((await state()).sel === 'Avenida', 'dedo: tocar un clip lo selecciona');
    const handle = side =>
      page.evaluate(sd => {
        const r = document.querySelector('.clip.sel .th.' + sd).getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, side);
    let h = await handle('r');
    await touch('touchStart', [h]);
    await drag(h, { x: h.x - 80, y: h.y });
    await wait(50); // Chrome agrupa los movimientos por cuadro
    const tip = await page.evaluate(() => (document.querySelector('.trim-tip') || {}).textContent);
    await touch('touchEnd', []);
    await wait(150);
    h = await handle('l');
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(h.x + 40, h.y, { steps: 5 });
    await page.mouse.up();
    await wait(150);
    const tr = (await state()).clips.Avenida;
    check(
      Math.abs(tr.out - 3) < 0.05 && Math.abs(tr.in - 0.5) < 0.05 && tip === '3,0 s',
      `recortar con los bordes (fin −1 s con el dedo, inicio +0,5 s con mouse: ${tr.in.toFixed(2)}–${tr.out.toFixed(2)} s, etiqueta ${tip})`
    );
    await page.evaluate(async () => {
      const pj = await import('/js/project.js');
      pj.undo();
      pj.undo();
    });
    const un = (await state()).clips.Avenida;
    check(un.in === 0 && un.out === 4, 'deshacer revierte los recortes');

    // Arrastrar un borde hasta el filo: la línea de tiempo se desplaza sola y el recorte sigue avanzando
    const ed = await page.evaluate(async () => {
      const { S } = await import('/js/state.js'),
        tl = await import('/js/timeline-touch.js'),
        ui = await import('/js/timeline-ui.js');
      const c = S.clips.find(k => k.name === 'Avenida');
      c.out = 1;
      S.sel = c.id;
      tl.zoomAt(200, 640);
      ui.renderTimeline();
      document.querySelector('.clip.sel').scrollIntoView({ inline: 'start', block: 'nearest' });
      const h = document.querySelector('.clip.sel .th.r').getBoundingClientRect();
      return {
        x: h.x + h.width / 2,
        y: h.y + h.height / 2,
        right: document.querySelector('#tlScroll').getBoundingClientRect().right,
        sl: document.querySelector('#tlScroll').scrollLeft,
      };
    });
    await page.mouse.move(ed.x, ed.y);
    await page.mouse.down();
    await page.mouse.move(ed.right - 10, ed.y, { steps: 10 });
    await wait(400);
    const sl1 = await page.evaluate(() => document.querySelector('#tlScroll').scrollLeft);
    await page.mouse.up();
    await wait(100);
    const outE = (await state()).clips.Avenida.out,
      wantE = Math.min(4, 1 + (ed.right - 10 - ed.x + sl1 - ed.sl) / 200);
    check(
      sl1 > ed.sl && Math.abs(outE - wantE) < 0.03,
      `recortar hasta el borde desplaza y sigue (${outE.toFixed(2)} s, esperado ${wantE.toFixed(2)} s)`
    );
    await page.evaluate(async () => (await import('/js/project.js')).undo());

    await zoom(40);
    const cx = await page.evaluate(() => document.querySelector('#tlInner').getBoundingClientRect().left + 12 + 6 * 40);
    const yy = a.y;
    await touch('touchStart', [
      { x: cx - 50, y: yy },
      { x: cx + 50, y: yy },
    ]);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', [
        { x: cx - 50 - i * 12.5, y: yy },
        { x: cx + 50 + i * 12.5, y: yy },
      ]);
      await wait(16);
    }
    await touch('touchEnd', []);
    await wait(150);
    const pz = await page.evaluate(async x => {
      const { S } = await import('/js/state.js');
      return { pps: S.pps, t: (x - document.querySelector('#tlInner').getBoundingClientRect().left - 12) / S.pps };
    }, cx);
    check(
      Math.abs(pz.pps - 120) < 3 && Math.abs(pz.t - 6) < 0.15,
      `dos dedos: zoom ×3 sin perder el punto (${pz.t.toFixed(2)} s bajo los dedos)`
    );

    // Dedo en la regla mueve el cursor; tocar una transición la abre
    const rr = await page.evaluate(() => {
      const r = document.querySelector('#ruler').getBoundingClientRect(),
        q = document.querySelector('#tlScroll').getBoundingClientRect();
      return { x: q.x + 400, y: r.y + r.height / 2, inner: r.x };
    });
    await touch('touchStart', [{ x: rr.x - 100, y: rr.y }]);
    await touch('touchMove', [{ x: rr.x, y: rr.y }]);
    await touch('touchEnd', []);
    await wait(100);
    const sT = await state();
    check(Math.abs(sT.T - (rr.x - rr.inner - 12) / sT.pps) < 0.02, 'dedo en la regla: mueve el cursor de tiempo');
    const tb = await page.evaluate(() => {
      const e = document.querySelector('.tbtn');
      e.scrollIntoView({ inline: 'center', block: 'nearest' });
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await touch('touchStart', [tb]);
    await wait(60);
    await touch('touchEnd', []);
    await wait(150);
    const stT = await state();
    check(stT.tab === 'trans', 'tocar una transición la abre' + (stT.tab === 'trans' ? '' : ` (pestaña: ${stT.tab})`));
    check(!errs.length, 'sin errores' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  // Audio: volumen por clip y música de fondo (vista previa, exportación, guardado, .rastro)
  if (run('audio')) {
    console.log('\nAudio: volumen por clip y música de fondo');
    // "Canción" de 3 s a 660 Hz: más corta que el video de 4 s (440 Hz), para probar la repetición
    const MUSIC = path.join(__dirname, 'fixtures', 'music.ogg');
    if (!fs.existsSync(MUSIC))
      execFileSync('ffmpeg', [
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=f=660:d=3',
        '-c:a',
        'libopus',
        MUSIC,
      ]);
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await page.goto(url);
    await until(page, async () => {
      const { S } = await import('/js/state.js');
      return S.clips.length === 3 && !S.tracking;
    });
    await page.click('[data-tab="media"]');
    await page.setInputFiles('#fileIn', FIX);
    await until(page, async () => (await import('/js/state.js')).S.clips.some(c => c.kind === 'video'), null, 20000);
    await page.evaluate(`(async () => { ${mods} ac.act('clearDemo'); })()`);
    await page.setInputFiles('#musicIn', MUSIC);
    check(
      await until(
        page,
        async () => {
          const { S } = await import('/js/state.js');
          return !!(S.music && document.querySelector('#rowMus .mbar') && document.querySelector('#k-mvol'));
        },
        null,
        10000
      ),
      'agrega música desde Medios (barra en la línea de tiempo y controles)'
    );
    // Ajustes desde los controles, como lo haría una persona
    const setRange = (sel, v) =>
      page.evaluate(
        ([s, v]) => {
          const e = document.querySelector(s);
          e.value = v;
          e.dispatchEvent(new Event('input', { bubbles: true }));
          e.dispatchEvent(new Event('change', { bubbles: true }));
        },
        [sel, v]
      );
    await setRange('#k-mvol', 0.6);
    await setRange('#k-mfout', 0.5);
    await page.click('[data-tab="edit"]');
    await setRange('#k-cvol', 0.5);
    const cfg = await page.evaluate(`(async () => { ${mods} return { m: st.S.music, vol: st.S.clips[0].vol } })()`);
    check(
      cfg.vol === 0.5 && cfg.m.vol === 0.6 && cfg.m.fadeOut === 0.5 && cfg.m.loop,
      'volumen del clip 50 %, música 60 % con salida de 0,5 s y repetición'
    );

    // Vista previa: el <audio> de la música sigue al reloj del proyecto con el volumen que corresponde
    const live =
      await page.evaluate(`(async () => { ${mods} const pb = await import('/js/playback.js'), mu = await import('/js/music.js');
      pb.seek(0.5); pb.play(); await new Promise(r => setTimeout(r, 1200));
      const r = { playing: !mu.MUS.el.paused, drift: Math.abs(mu.MUS.el.currentTime - st.S.T), gain: mu.MUS.gain ? mu.MUS.gain.gain.value : null,
        clipGain: st.S.clips[0].gain ? st.S.clips[0].gain.gain.value : null };
      pb.pause(); r.paused = mu.MUS.el.paused; return r })()`);
    check(
      live.playing &&
        live.drift < 0.3 &&
        live.paused &&
        Math.abs(live.gain - 0.6) < 0.01 &&
        Math.abs(live.clipGain - 0.5) < 0.01,
      `vista previa: la música suena sincronizada (desfase ${(live.drift * 1000).toFixed(0)} ms) y se pausa; ganancias 0,6 y 0,5`
    );

    // Exportación rápida: se mide cada tono en el archivo exportado
    await page.click('[data-tab="export"]');
    await until(page, () => /MP4 · /.test(document.querySelector('.specs')?.textContent || ''), null, 5000);
    await page.click('[data-act="export"]');
    await until(
      page,
      async () => {
        const { S } = await import('/js/state.js');
        return !!S.result && !S.exporting;
      },
      null,
      60000
    );
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="save"]')]);
    const out = path.join(__dirname, 'fixtures', 'export-audio.mp4');
    await dl.saveAs(out);
    const pcm = execFileSync('ffmpeg', [
      '-loglevel',
      'error',
      '-i',
      out,
      '-vn',
      '-af',
      'pan=mono|c0=FL', // solo el canal izquierdo: mezclar a mono suma ×√2

      '-ar',
      '48000',
      '-f',
      'f32le',
      '-',
    ]);
    const a = new Float32Array(pcm.buffer, pcm.byteOffset, pcm.length / 4);
    const amp = (f, t0, t1) => {
      // Goertzel: amplitud de un tono puro de frecuencia f entre t0 y t1
      const i0 = Math.round(t0 * 48000),
        n = Math.round((t1 - t0) * 48000),
        w = (2 * Math.PI * f) / 48000;
      let re = 0,
        im = 0;
      for (let i = 0; i < n; i++) {
        re += a[i0 + i] * Math.cos(w * i);
        im -= a[i0 + i] * Math.sin(w * i);
      }
      return (2 * Math.hypot(re, im)) / n;
    };
    const near = (v, want) => Math.abs(v - want) / want < 0.15;
    const m = { clip: amp(440, 1, 2), music: amp(660, 1, 2), loop: amp(660, 3.1, 3.4), fade: amp(660, 3.7, 3.9) };
    // sine de ffmpeg: amplitud 1/8. Clip 0,125·0,5 = 0,0625; música 0,125·0,6 = 0,075; en 3,7–3,9 s la salida va de 0,6 a 0,2 del volumen
    check(near(m.clip, 0.0625), `exportado: el clip suena al 50 % (amplitud ${m.clip.toFixed(4)}, esperada 0,0625)`);
    check(near(m.music, 0.075), `exportado: la música suena al 60 % (amplitud ${m.music.toFixed(4)}, esperada 0,075)`);
    check(near(m.loop, 0.075), `exportado: la música se repite después de sus 3 s (amplitud ${m.loop.toFixed(4)})`);
    check(near(m.fade, 0.03), `exportado: fundido de salida al final (amplitud ${m.fade.toFixed(4)}, esperada 0,03)`);

    // Quitar y deshacer; se conserva al recargar
    await page.click('[data-tab="media"]');
    await page.click('[data-act="delMusic"]');
    const gone = await page.evaluate(
      `(async () => { ${mods} return !st.S.music && !document.querySelector('#rowMus .mbar') })()`
    );
    await page.evaluate(`(async () => { ${mods} pj.undo(); })()`);
    const back = await page.evaluate(
      `(async () => { ${mods} const mu = await import('/js/music.js'); return !!(st.S.music && st.S.music.vol === 0.6 && mu.MUS.el) })()`
    );
    check(gone && back, 'quitar la música y deshacer la recupera con sus ajustes');
    await page.evaluate(`(async () => { ${mods} await pj.saveNow(); })()`);
    await page.reload();
    const kept = await until(
      page,
      async () => {
        const { S } = await import('/js/state.js'),
          mu = await import('/js/music.js');
        return !!(
          S.music &&
          S.music.vol === 0.6 &&
          S.music.fadeOut === 0.5 &&
          mu.MUS.el &&
          S.clips[0] &&
          S.clips[0].vol === 0.5
        );
      },
      null,
      15000
    );
    check(kept, 'tras recargar, se conservan la música, sus ajustes y el volumen del clip');

    // La limpieza de archivos no borra la música en uso; el .rastro la incluye
    const gc =
      await page.evaluate(`(async () => { ${mods} const db = await import('/js/store.js'), id = st.S.music.mediaId;
      const r = await db.dbGet('media', id); await db.dbPut('media', { ...r, at: 0 }); pj.resetHistory(); await pj.collectMedia();
      return !!(await db.dbGet('media', id)) })()`);
    check(gc, 'la limpieza de archivos no borra la música en uso');
    await page.click('[data-tab="projects"]');
    const [dr] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="exportProj"]')]);
    const rf = path.join(__dirname, 'fixtures', 'audio.rastro');
    await dr.saveAs(rf);
    const { unzip } = await import(require('url').pathToFileURL(path.join(ROOT, 'js', 'archive.js')));
    const files = await unzip(new Blob([fs.readFileSync(rf)]));
    const doc = JSON.parse(await files.get('project.json').text());
    const mm = doc.media.find(x => x.id === doc.data.music.mediaId);
    check(
      doc.v === 2 && mm && files.has(mm.file) && doc.data.clips[0].vol === 0.5,
      'el .rastro incluye la música (v2) y el volumen del clip'
    );
    check(!errs.length, 'sin errores' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await page.close();
  }

  // Exportar en 720p, 1080p y 4K con calidad elegible; el video se escribe en disco (OPFS)
  if (run('export')) {
    console.log('\nExportar: resolución, calidad y disco');
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await page.goto(url);
    await until(page, async () => {
      const { S } = await import('/js/state.js');
      return S.clips.length === 3 && !S.tracking;
    });
    await page.click('[data-tab="export"]');
    await until(
      page,
      () => !!document.querySelector('[data-act="expRes:2160"]') && !/Ligera.*disabled/.test(''),
      null,
      8000
    );
    // Exporta con lo elegido en el panel y guarda el archivo
    const exportWith = async (res, q, mem = false) => {
      await page.evaluate(
        async ([m]) => {
          (await import('/js/state.js')).S.forceMemSink = m;
        },
        [mem]
      );
      await page.click(`[data-act="expRes:${res}"]`);
      await page.click(`[data-act="expQ:${q}"]`);
      const est = await page.evaluate(() => {
        const t = document.querySelector('.specs').innerText;
        return t;
      });
      const prev = await page.evaluate(async () => {
        const { S } = await import('/js/state.js');
        return S.result && S.result.url;
      });
      await page.click('[data-act="export"]');
      await until(
        page,
        async u => {
          const { S } = await import('/js/state.js');
          return S.result && S.result.url !== u && !S.exporting;
        },
        prev,
        180000
      );
      const r = await page.evaluate(async () => {
        const { S, cv } = await import('/js/state.js');
        return { size: S.result.size, opfs: S.result.opfs, canvas: [cv.width, cv.height], base: [S.W, S.H] };
      });
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act="save"]')]);
      const f = path.join(__dirname, 'fixtures', `export-${res}-${q}${mem ? '-mem' : ''}.mp4`);
      await dl.saveAs(f);
      const [w, h, frames] = execFileSync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v',
        '-show_entries',
        'stream=width,height,nb_frames',
        '-of',
        'csv=p=0',
        f,
      ])
        .toString()
        .trim()
        .split(',')
        .map(Number);
      return { ...r, w, h, frames, f, est: (est.match(/Peso\s*hasta ([\d,]+) MB/) || [])[1] };
    };
    const r720 = await exportWith(720, 'normal');
    const r4k = await exportWith(2160, 'normal');
    check(
      r720.w === 1280 && r720.h === 720 && r4k.w === 3840 && r4k.h === 2160 && r4k.frames === 360,
      `exporta en 720p (1280×720) y 4K (3840×2160) de verdad, no estirado`
    );
    check(
      r4k.canvas.join() === '1280,720' && r4k.base.join() === '1280,720',
      'después de exportar, la vista previa vuelve a su tamaño'
    );
    // Misma imagen a 720p y a 4K (textos, aro rastreado y transiciones escalan igual)
    const gray = (f, t) =>
      execFileSync('ffmpeg', [
        '-loglevel',
        'error',
        '-ss',
        '' + t,
        '-i',
        f,
        '-frames:v',
        '1',
        '-vf',
        'scale=640:360',
        '-f',
        'rawvideo',
        '-pix_fmt',
        'gray',
        '-',
      ]);
    let diff = 0;
    for (const t of [1.5, 4.3, 6]) {
      const a = gray(r720.f, t),
        b = gray(r4k.f, t);
      let d = 0;
      for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
      diff = Math.max(diff, d / a.length);
    }
    check(diff < 2, `la composición es la misma en 720p y 4K (diferencia ${diff.toFixed(2)}/255)`);
    // Calidad: más calidad, más peso; el peso real no pasa del máximo que muestra el panel
    const rl = await exportWith(1080, 'ligera'),
      rn = await exportWith(1080, 'normal'),
      ra = await exportWith(1080, 'alta');
    check(
      rl.size < rn.size && rn.size < ra.size,
      `calidad Ligera < Normal < Alta (${[rl, rn, ra].map(x => (x.size / 1048576).toFixed(1)).join(' < ')} MB)`
    );
    const estN = parseFloat((rn.est || '0').replace(',', '.')) * 1048576;
    check(
      rn.size <= estN * 1.05 && rn.size > estN * 0.4,
      `el peso real no pasa del máximo del panel (${(rn.size / 1048576).toFixed(1)} MB de hasta ${rn.est} MB)`
    );
    // En disco (OPFS) y en memoria dan el mismo resultado; en disco queda solo el último
    const rm = await exportWith(1080, 'normal', true);
    check(
      rn.opfs && !rm.opfs && Math.abs(rm.size - rn.size) / rn.size < 0.02,
      'el video se escribe en disco (y en memoria si no hay disco) con el mismo resultado'
    );
    const left = await page.evaluate(async () => {
      const r = await navigator.storage.getDirectory(),
        n = [];
      for await (const k of r.keys()) n.push(k);
      return n.filter(k => k.startsWith('rastro-export-'));
    });
    check(left.length <= 1, `en disco queda como mucho el último video exportado (${left.length})`);
    // La elección se recuerda
    await page.reload();
    await page.click('[data-tab="export"]');
    await until(page, () => !!document.querySelector('[data-act="expQ:normal"][aria-pressed="true"]'), null, 8000);
    const kept = await page.evaluate(() => !!document.querySelector('[data-act="expRes:1080"][aria-pressed="true"]'));
    check(kept, 'la resolución y la calidad elegidas se recuerdan');
    check(!errs.length, 'sin errores' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await page.close();
  }

  // Rastreo rápido: cuadros con VideoDecoder y cálculo en un Web Worker (la interfaz no se traba)
  if (run('rastreo')) {
    console.log('\nRastreo rápido (VideoDecoder + Web Worker)');
    const trackRun = async noWorker => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      const errs = [];
      page.on('pageerror', e => errs.push(e.message));
      if (noWorker) await page.addInitScript(() => (window.Worker = undefined));
      await page.goto(url);
      await until(page, async () => {
        const { S } = await import('/js/state.js');
        return S.clips.length === 3 && !S.tracking;
      });
      await page.click('[data-tab="media"]');
      await page.setInputFiles('#fileIn', FIX);
      await until(page, async () => (await import('/js/state.js')).S.clips.some(c => c.kind === 'video'), null, 20000);
      const seed = truth(1);
      const r = await page.evaluate(
        `(async () => { ${mods} const tr = await import('/js/tracker.js');
          ac.act('clearDemo'); const c = st.S.clips[0];
          c.track = { seed: { t: 1, x: ${seed.x / 1280}, y: ${seed.y / 720} }, pts: [] };
          const long = []; const po = new PerformanceObserver(l => { for (const e of l.getEntries()) long.push(e.duration) });
          po.observe({ type: 'longtask' });
          const t0 = performance.now(); await tr.runTrack(c, true); const took = (performance.now() - t0) / 1000;
          await new Promise(r => setTimeout(r, 50)); po.disconnect();
          const at = t => c.track.pts.reduce((a, p) => Math.abs(p.t - t) < Math.abs(a.t - t) ? p : a);
          const err = [0.3, 2, 3].map(t => { const p = at(t), tx = 110 + 240 * p.t, ty = 330 + 120 * Math.sin(2 * p.t); return Math.hypot(p.x * 1280 - tx, p.y * 720 - ty) });
          return { took, err, long: Math.max(0, ...long), pts: c.track.pts.map(p => [p.t.toFixed(3), p.x.toFixed(5), p.y.toFixed(5)].join()) } })()`
      );
      await page.close();
      return { ...r, errs };
    };
    const w = await trackRun(false);
    // Antes (seek en el <video> por cuadro, con este video de un solo keyframe): ~16 s
    check(w.took < 6, `4 s de video se rastrean en ${w.took.toFixed(1)} s (antes ~16 s)`);
    check(w.long < 100, `la interfaz no se traba mientras rastrea (tarea más larga: ${Math.round(w.long)} ms)`);
    check(
      Math.max(...w.err) < 5,
      `preciso antes y después de la semilla (error ${w.err.map(e => e.toFixed(1)).join(' / ')} px en 0,3 / 2 / 3 s)`
    );
    const nw = await trackRun(true);
    check(
      nw.pts.join('|') === w.pts.join('|'),
      'sin Web Workers da exactamente el mismo resultado (calcula en el hilo principal)'
    );
    // Al abrir la app se rastrea el ejemplo: si en ese momento se pide otro rastreo, el automático cede el paso
    {
      const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      await page.goto(url);
      await until(
        page,
        async () => {
          const { S } = await import('/js/state.js');
          return S.clips.length === 3 && !!S.tracking;
        },
        null,
        10000
      );
      const r = await page.evaluate(
        `(async () => { ${mods} const tr = await import('/js/tracker.js');
          const busy = !!st.S.tracking, c = st.S.clips[2];
          c.track = { seed: { t: 1, x: 0.5, y: 0.5 }, pts: [] };
          await tr.runTrack(c); // como al tocar Rastrear
          // Los selectores de archivo no se reemplazan al redibujar el panel
          const inp = document.querySelector('#fileIn'); (await import('/js/panel.js')).renderPanel();
          return { busy, n: c.track.pts.length, sameInput: inp === document.querySelector('#fileIn'), inPanel: document.querySelectorAll('#panel input[type=file]').length } })()`
      );
      check(
        r.busy && r.n > 10,
        `si el rastreo del ejemplo sigue en curso, tocar Rastrear lo detiene y rastrea lo pedido (${r.n} muestras)`
      );
      check(
        r.sameInput && !r.inPanel,
        'los selectores de archivo están fuera del panel (no se pierde el archivo si el panel se redibuja)'
      );
      await page.close();
    }
    check(
      !w.errs.length && !nw.errs.length,
      'sin errores' + (w.errs.length || nw.errs.length ? ': ' + [...w.errs, ...nw.errs].join(' | ') : '')
    );
  }

  // Accesibilidad y primer uso: contraste, nombres, teclado, avisos para lectores de pantalla, bienvenida
  if (run('acceso')) {
    console.log('\nAccesibilidad y primer uso');
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await page.goto(url);
    await until(page, async () => {
      const { S } = await import('/js/state.js');
      return S.clips.length === 3 && !S.tracking;
    });
    check(
      await page.evaluate(() => !!document.querySelector('.welcome')),
      'la primera vez se ve la bienvenida del proyecto de ejemplo'
    );
    const found = { contrast: new Set(), noname: new Set(), nokbd: new Set() };
    // Las 7 pestañas en los dos temas (claro y oscuro)
    for (const [theme, tab] of ['light', 'dark'].flatMap(th =>
      ['media', 'edit', 'trans', 'track', 'text', 'export', 'projects'].map(t => [th, t])
    )) {
      await page.evaluate(
        async ([th, t]) => {
          (await import('/js/theme.js')).setTheme(th);
          const { S } = await import('/js/state.js');
          if (t === 'text') S.selOv = S.ovs[0].id;
          (await import('/js/panel.js')).setTab(t);
        },
        [theme, tab]
      );
      await page.waitForTimeout(200);
      const r = await page.evaluate(() => {
        const rgb = s => (s.match(/[\d.]+/g) || [0, 0, 0]).map(Number);
        const lum = ([r, g, b]) => {
          const f = v => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
          return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
        };
        // Fondo efectivo: se componen los fondos semitransparentes hasta uno opaco
        const bgOf = e => {
          const layers = [];
          for (let n = e; n; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return null;
            const c = rgb(cs.backgroundColor),
              a = c[3] === undefined ? 1 : c[3];
            if (a > 0) layers.push([c[0], c[1], c[2], a]);
            if (a >= 0.99) break;
          }
          let out =
            layers.length && layers[layers.length - 1][3] >= 0.99
              ? layers.pop().slice(0, 3)
              : rgb(getComputedStyle(document.body).backgroundColor).slice(0, 3);
          for (let i = layers.length - 1; i >= 0; i--) {
            const [r, g, b, a] = layers[i];
            out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
          }
          return out;
        };
        const out = { contrast: [], noname: [], nokbd: [] };
        for (const e of document.querySelectorAll('body *')) {
          const bx = e.getBoundingClientRect();
          if (!bx.width || !bx.height || e.closest('#vids,#pickers,.clip,canvas,.sr-only')) continue;
          if (
            [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) &&
            !e.closest(':disabled,[disabled]')
          ) {
            const cs = getComputedStyle(e),
              bg = bgOf(e);
            if (bg) {
              const L1 = lum(rgb(cs.color)),
                L2 = lum(bg),
                ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
              const size = parseFloat(cs.fontSize),
                large = size >= 24 || (+cs.fontWeight >= 700 && size >= 18.66);
              if (ratio < (large ? 3 : 4.5))
                out.contrast.push(`${e.textContent.trim().slice(0, 20)} ${ratio.toFixed(2)}:1`);
            }
          }
          if (e.matches('button,input,select,textarea,[data-act],[data-tab]') && e.type !== 'file') {
            const name =
              (e.getAttribute('aria-label') || e.textContent || '').trim() ||
              (e.labels && [...e.labels].map(l => l.textContent.trim()).join('')) ||
              e.title;
            if (!name) out.noname.push(`${e.tagName.toLowerCase()} ${e.id || e.dataset.act || e.dataset.k || ''}`);
            if (!(e.matches('button,input,select,textarea,[tabindex]') && e.tabIndex >= 0))
              out.nokbd.push(`${e.tagName.toLowerCase()} ${e.dataset.act || ''}`);
          }
        }
        return out;
      });
      for (const k of Object.keys(found)) r[k].forEach(x => found[k].add(x + ` [${tab}, ${theme}]`));
    }
    await page.evaluate(async () => (await import('/js/theme.js')).setTheme('auto'));
    // Tema: el botón del encabezado alterna claro/oscuro, se recuerda al recargar y cambia el color de la barra
    {
      const st = () =>
        page.evaluate(() => ({
          theme: document.documentElement.dataset.theme || 'auto',
          pressed: document.getElementById('bTheme').getAttribute('aria-pressed'),
          bg: getComputedStyle(document.body).backgroundColor,
          meta: document.querySelector('meta[name="theme-color"]').content,
        }));
      const a = await st();
      await page.click('#bTheme');
      const b = await st();
      await page.reload();
      await until(page, async () => (await import('/js/state.js')).S.clips.length === 3);
      const c = await st();
      await page.click('#bTheme');
      const d = await st();
      check(
        a.theme === 'auto' &&
          a.pressed === 'false' &&
          b.theme === 'dark' &&
          b.pressed === 'true' &&
          b.bg !== a.bg &&
          b.meta !== a.meta &&
          c.theme === 'dark' &&
          c.bg === b.bg &&
          d.theme === 'light' &&
          d.bg === a.bg,
        `botón de tema: claro → oscuro, se recuerda al recargar y vuelve (${a.theme}→${b.theme}→${c.theme}→${d.theme})`
      );
      await page.evaluate(async () => (await import('/js/theme.js')).setTheme('auto'));
    }
    check(
      !found.contrast.size,
      'contraste de texto WCAG AA en las 7 pestañas, en tema claro y oscuro' +
        (found.contrast.size ? ': ' + [...found.contrast].slice(0, 5).join(' · ') : '')
    );
    check(
      !found.noname.size,
      'todos los controles tienen nombre para lectores de pantalla' +
        (found.noname.size ? ': ' + [...found.noname].join(' · ') : '')
    );
    check(
      !found.nokbd.size,
      'todo lo que se toca también se alcanza con el teclado' +
        (found.nokbd.size ? ': ' + [...found.nokbd].join(' · ') : '')
    );
    // Teclado: Tab hasta un clip de la línea de tiempo y Enter lo selecciona
    await page.evaluate(async () => (await import('/js/panel.js')).setTab('edit'));
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    let steps = 0;
    for (let i = 0; i < 120 && !steps; i++) {
      await page.keyboard.press('Tab');
      if (
        await page.evaluate(
          () =>
            /^Clip Lago/.test(document.activeElement.getAttribute('aria-label') || '') &&
            !!document.activeElement.closest('#rowClips')
        )
      )
        steps = i + 1;
    }
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    const sel = await page.evaluate(async () => {
      const { S } = await import('/js/state.js');
      return { sel: S.clips.find(c => c.id === S.sel).name, focus: document.activeElement.getAttribute('aria-label') };
    });
    check(
      steps && sel.sel === 'Lago' && /^Clip Lago/.test(sel.focus),
      `Tab llega a un clip de la línea de tiempo (${steps} pasos) y Enter lo selecciona sin perder el foco`
    );
    // Atajos: → avanza un cuadro, Shift+→ un segundo; S divide; Supr elimina con «Deshacer» en el aviso
    await page.evaluate(async () => {
      const { S } = await import('/js/state.js');
      S.T = 0;
      document.activeElement.blur();
    });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowRight');
    const T = await page.evaluate(async () => (await import('/js/state.js')).S.T);
    check(Math.abs(T - (1 + 1 / 30)) < 1e-6, `→ avanza un cuadro y Shift+→ un segundo (${T.toFixed(3)} s)`);
    await page.evaluate(async () => {
      const { S } = await import('/js/state.js');
      S.sel = S.clips[0].id;
      S.T = 2;
    });
    await page.keyboard.press('s');
    const nSplit = await page.evaluate(async () => (await import('/js/state.js')).S.clips.length);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(80);
    const del = await page.evaluate(async () => ({
      n: (await import('/js/state.js')).S.clips.length,
      toast: document.querySelector('#toast').textContent,
      live: document.querySelector('#srLive').textContent,
    }));
    await page.click('#toast button');
    const back = await page.evaluate(async () => (await import('/js/state.js')).S.clips.length);
    check(
      nSplit === 4 && del.n === 3 && back === 4 && /Deshacer/.test(del.toast),
      'S divide, Supr elimina y «Deshacer» del aviso lo recupera'
    );
    check(
      del.live === 'Clip eliminado' &&
        (await page.evaluate(() => document.querySelector('#srLive').getAttribute('role'))) === 'status',
      'los avisos se anuncian a lectores de pantalla'
    );
    // Bienvenida: «Entendido» la cierra para siempre en este navegador
    await page.evaluate(async () => (await import('/js/panel.js')).setTab('media'));
    await page.click('[data-act="welcomeOk"]');
    await page.reload();
    await until(page, async () => {
      const { S } = await import('/js/state.js');
      return S.clips.length > 0;
    });
    check(
      !(await page.evaluate(() => !!document.querySelector('.welcome'))),
      'después de «Entendido», la bienvenida no vuelve a aparecer'
    );
    check(!errs.length, 'sin errores' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await page.close();
  }

  // App instalable (PWA), sin conexión y diagnóstico del dispositivo
  if (run('pwa')) {
    console.log('\nApp instalable, sin conexión y diagnóstico');
    // Manifiesto e íconos
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
    const pngSize = f => {
      const b = fs.readFileSync(path.join(ROOT, f));
      return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
    };
    const iconsOk = man.icons.every(i => fs.existsSync(path.join(ROOT, i.src)) && pngSize(i.src) === i.sizes);
    check(
      man.name &&
        man.start_url &&
        man.display === 'standalone' &&
        iconsOk &&
        man.icons.some(i => i.purpose === 'maskable') &&
        man.icons.some(i => i.sizes === '512x512'),
      'manifiesto válido: nombre, inicio, pantalla completa e íconos (192, 512 y maskable) con su tamaño real'
    );
    // El service worker precarga todos los archivos de la app
    const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const appFiles = [
      ...['js', 'css', 'fonts'].flatMap(d => fs.readdirSync(path.join(ROOT, d)).map(f => d + '/' + f)),
      'index.html',
      'manifest.webmanifest',
      ...man.icons.map(i => i.src),
    ];
    const missing = appFiles.filter(f => !swSrc.includes(`'${f}'`));
    check(
      !missing.length,
      'sw.js precarga todos los archivos de la app' + (missing.length ? ': faltan ' + missing.join(', ') : '')
    );
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => m.type() === 'error' && errs.push(m.text()));
    const external = new Set();
    page.on('request', r => {
      const u = new URL(r.url());
      if (/^https?:$/.test(u.protocol) && u.host !== new URL(url).host) external.add(u.host);
    });
    await page.goto(url);
    await until(page, async () => {
      const { S } = await import('/js/state.js');
      return S.clips.length === 3 && !S.tracking;
    });
    const ctl =
      (await until(page, () => !!navigator.serviceWorker.controller || !!window.__swReady, null, 3000)) ||
      (await page.reload(), await until(page, () => !!navigator.serviceWorker.controller, null, 10000));
    check(ctl, 'el service worker queda activo y controla la página');
    check(
      !external.size,
      'la app no se conecta a ningún servicio externo (fuentes incluidas)' +
        (external.size ? ': ' + [...external].join(', ') : '')
    );
    // Sin conexión: recargar sigue funcionando (la app, sus módulos y el proyecto guardado)
    await ctx.setOffline(true);
    await page.reload();
    const off = await until(
      page,
      async () => {
        const { S } = await import('/js/state.js');
        return S.clips.length >= 3 && !!document.querySelector('#tabs .tab');
      },
      null,
      15000
    );
    check(off, 'sin conexión, la app carga igual (con el proyecto guardado)');
    await ctx.setOffline(false);
    // Diagnóstico y medición
    await page.click('[data-tab="projects"]');
    await page.click('[data-act="diagRun"]');
    await until(
      page,
      async () => {
        const { S } = await import('/js/state.js');
        return S.diag && S.diag.info && !S.diag.running;
      },
      null,
      20000
    );
    const d1 = await page.evaluate(async () => {
      const { S } = await import('/js/state.js');
      return {
        info: S.diag.info,
        codecs: S.diag.codecs,
        rows: document.querySelectorAll('table.diag tbody tr').length,
      };
    });
    check(
      d1.info.cores > 0 && d1.rows >= 6 && d1.codecs.video.find(v => /H\.264 1080p/.test(v.n)).dec,
      `diagnóstico: ${d1.info.cores} núcleos, GPU «${(d1.info.gpu || '?').slice(0, 30)}», ${d1.rows} códecs revisados`
    );
    await page.click('[data-act="benchRun"]');
    await until(
      page,
      async () => {
        const { S } = await import('/js/state.js');
        return S.diag && S.diag.bench && !S.diag.running;
      },
      null,
      180000
    );
    const bench = await page.evaluate(async () => (await import('/js/state.js')).S.diag.bench);
    check(
      bench.length >= 3 && bench.every(r => /tiempo real/.test(r.v)),
      'medición de rendimiento: ' + bench.map(r => `${r.n} ${r.v.split(' · ')[0]}`).join(' · ')
    );
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('[data-act="diagCopy"]');
    await page.waitForTimeout(200);
    const txt = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
    check(
      /diagnóstico del dispositivo/.test(txt) && /Códecs de video/.test(txt) && /Rendimiento/.test(txt),
      'el informe se copia para compartirlo'
    );
    check(!errs.length, 'sin errores' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await ctx.close();
  }

  const extra = ensureExtra();

  // Rastreo de 2 puntos: giro y escala, desde la interfaz
  if (run('2puntos') && extra['rotscale.webm']) {
    console.log('\nRastreo de 2 puntos (objeto que gira y crece)');
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await page.goto(url);
    await until(page, async () => (await import('/js/state.js')).S.clips.length === 3);
    await page.click('[data-tab="media"]');
    await page.setInputFiles('#fileIn', extra['rotscale.webm']);
    await until(page, async () => (await import('/js/state.js')).S.clips.some(c => c.kind === 'video'), null, 20000);
    // Posición real de un detalle del objeto (u, v en px del objeto, desde su centro) en el tiempo t
    const W = (u, v, t) => {
      const s = 1 + 0.2 * t,
        a = 0.5 * t;
      return {
        x: 500 + 60 * t + s * (Math.cos(a) * u - Math.sin(a) * v),
        y: 360 + s * (Math.sin(a) * u + Math.cos(a) * v),
      };
    };
    await page.evaluate(`(async () => { ${mods} ac.act('clearDemo'); st.S.T = st.S.clips[0]._start + 1; })()`);
    await page.click('[data-tab="track"]');
    await page.click('[data-act="trackPts:2"]');
    await page.click('[data-act="pick"]');
    await page.waitForTimeout(300);
    const box = await page.$eval('#stage', e => {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const tap = p => page.mouse.click(box.x + (p.x / 1280) * box.w, box.y + (p.y / 720) * box.h);
    await tap(W(-45, -35, 1));
    await tap(W(40, 30, 1));
    const marked = await page.evaluate(
      `(async () => { ${mods} const t = st.S.clips[0].track; return !!(t && t.seed && t.seed2) })()`
    );
    check(marked, 'marca 2 puntos con dos toques en la vista previa');
    await page.click('[data-act="track"]');
    await until(
      page,
      async () => {
        const { S } = await import('/js/state.js');
        return !S.tracking && S.clips[0].track.pts.length > 10;
      },
      null,
      90000
    );
    const tr = await page.evaluate(
      `(async () => { ${mods} const rd = await import('/js/render.js'), c = st.S.clips[0];
        const W = ${W.toString()};
        return [2, 3, 3.8].map(t => { const xf = rd.trackXform(c, t), tp = rd.trackAt(c, t), a = W(-45, -35, t), b = W(40, 30, t);
          return { t, drot: Math.abs(xf.rot - 0.5 * (t - 1)), dsc: Math.abs(xf.scale / ((1 + 0.2 * t) / 1.2) - 1),
            err: Math.max(Math.hypot(tp.x * 1280 - a.x, tp.y * 720 - a.y), Math.hypot(tp.x2 * 1280 - b.x, tp.y2 * 720 - b.y)) } }) })()`
    );
    const worst = k => Math.max(...tr.map(x => x[k]));
    check(worst('drot') < 0.05, `giro medido (error máx. ${((worst('drot') * 180) / Math.PI).toFixed(1)}°)`);
    check(worst('dsc') < 0.03, `escala medida (error máx. ${(worst('dsc') * 100).toFixed(1)} %)`);
    check(worst('err') < 12, `los dos puntos siguen al objeto (error máx. ${worst('err').toFixed(1)} px)`);

    // Texto anclado 70 px "arriba" del objeto: gira y crece con él
    await page.evaluate(`(async () => { ${mods} ac.addOv('text', { text: 'Arriba' }); })()`);
    await page.click('#k-follow');
    const ov = await page.evaluate(
      `(async () => { ${mods} const rd = await import('/js/render.js'), c = st.S.clips[0], o = st.S.ovs[st.S.ovs.length - 1];
        const W = ${W.toString()}, top = W(0, -70, 1);
        rd.ovSetAbs(o, c, 1, top.x, top.y);
        const err = Math.max(...[2, 3, 3.8].map(t => { const p = rd.ovPos(o, c, t), e = W(0, -70, t); return Math.hypot(p.x - e.x, p.y - e.y) }));
        const rot3 = rd.ovPos(o, c, 3).rot;
        const hasOpts = !!document.querySelector('#k-followRot') && !!document.querySelector('#k-followScale');
        return { err, rot3, hasOpts } })()`
    );
    check(ov.hasOpts, 'el panel ofrece girar y cambiar de tamaño con el objeto');
    check(
      ov.err < 12 && Math.abs(ov.rot3 - 1) < 0.05,
      `el texto sigue posición, giro y escala (error máx. ${ov.err.toFixed(1)} px)`
    );
    // Apagar el giro no mueve el texto en el cuadro actual
    const noJump = await page.evaluate(
      `(async () => { ${mods} const rd = await import('/js/render.js'), c = st.S.clips[0], o = st.S.ovs[st.S.ovs.length - 1];
        st.S.T = c._start + 3; const a = rd.ovPos(o, c, 3); ac.setFollow(o, { followRot: false }); const b = rd.ovPos(o, c, 3);
        return { jump: Math.hypot(a.x - b.x, a.y - b.y), rot: b.rot } })()`
    );
    check(noJump.jump < 0.5 && noJump.rot === 0, 'apagar el giro no hace saltar el texto');
    // Arrastrar en la vista previa: se mueve lo mismo que el puntero
    await page.waitForTimeout(200);
    const drag = await page.evaluate(
      `(async () => { ${mods} const rd = await import('/js/render.js'), c = st.S.clips[0], o = st.S.ovs[st.S.ovs.length - 1];
        const p = rd.ovPos(o, c, 3); return { x: p.x, y: p.y } })()`
    );
    const toScreen = p => ({ x: box.x + (p.x / 1280) * box.w, y: box.y + (p.y / 720) * box.h });
    const a = toScreen(drag);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 40, a.y + 25, { steps: 5 });
    await page.mouse.up();
    const moved = await page.evaluate(
      `(async () => { ${mods} const rd = await import('/js/render.js'), c = st.S.clips[0], o = st.S.ovs[st.S.ovs.length - 1];
        const p = rd.ovPos(o, c, 3); return { x: p.x, y: p.y } })()`
    );
    const want = { x: drag.x + (40 / box.w) * 1280, y: drag.y + (25 / box.h) * 720 };
    check(Math.hypot(moved.x - want.x, moved.y - want.y) < 2, 'arrastrar un texto que gira lo mueve igual que el dedo');
    // Se guarda con el proyecto
    await page.evaluate(`(async () => { ${mods} await pj.saveNow(); })()`);
    await page.reload();
    const kept = await until(
      page,
      async () => {
        const { S } = await import('/js/state.js');
        const c = S.clips[0],
          o = S.ovs[S.ovs.length - 1];
        return (
          S.clips.length === 1 &&
          c.track &&
          c.track.seed2 &&
          c.track.pts[5].x2 != null &&
          o &&
          o.follow &&
          o.followRot === false
        );
      },
      null,
      15000
    );
    check(kept, 'tras recargar, se conservan los 2 puntos y las opciones del texto');
    check(!errs.length, 'sin errores' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await page.close();
  }

  // Rastreo de 4 esquinas (plano en perspectiva): precisión contra la verdad, área, mismo resultado sin Worker, guardado
  if (run('4esquinas') && extra['planar.webm']) {
    console.log('\nRastreo de 4 esquinas (plano en perspectiva)');
    // Esquinas de la imagen en el tiempo t (las del filtro perspective) y el lote (en px de la imagen original)
    const CORNERS = t => [
      [100 + 30 * t, 60 + 40 * t],
      [1180 - 50 * t, 40 + 60 * t],
      [60 + 20 * t, 680 - 20 * t],
      [1220 - 30 * t, 700 - 40 * t],
    ];
    const LOT = [
      [362, 202],
      [917, 202],
      [917, 537],
      [362, 537],
    ];
    // Verdad: el lote en el video en el tiempo t, en orden (arriba izq., arriba der., abajo der., abajo izq.)
    const truthSrc = `const pl = await import('/js/planar.js'), CORNERS = ${CORNERS.toString()}, LOT = ${JSON.stringify(LOT)};
      const truth = t => { const h = pl.hFit([[0, 0], [1280, 0], [0, 720], [1280, 720]], CORNERS(t)); return LOT.map(([x, y]) => pl.hApply(h, x, y)); };`;
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => m.type() === 'error' && errs.push(m.text()));
    await page.goto(url);
    await until(page, async () => (await import('/js/state.js')).S.clips.length === 3);
    await page.click('[data-tab="media"]');
    await page.setInputFiles('#fileIn', extra['planar.webm']);
    await until(page, async () => (await import('/js/state.js')).S.clips.some(c => c.kind === 'video'), null, 20000);
    await page.evaluate(`(async () => { ${mods} ac.act('clearDemo'); st.S.T = st.S.clips[0]._start + 1; })()`);
    await page.click('[data-tab="track"]');
    await page.click('[data-act="trackPts:4"]');
    await page.click('[data-act="pick"]');
    await page.waitForTimeout(300);
    const box = await page.$eval('#stage', e => {
      const r = e.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
    const at1 = await page.evaluate(`(async () => { ${truthSrc} return truth(1); })()`);
    // En desorden: el editor las ordena
    for (const k of [2, 0, 3, 1])
      await page.mouse.click(box.x + (at1[k][0] / 1280) * box.w, box.y + (at1[k][1] / 720) * box.h);
    const marked = await page.evaluate(
      `(async () => { ${mods} const t = st.S.clips[0].track; return !!(t && t.quad && t.quad.length === 4 && !st.S.pick) })()`
    );
    check(marked, 'marca 4 esquinas con cuatro toques (en cualquier orden)');
    const t0 = Date.now();
    await page.click('[data-act="track"]');
    await until(
      page,
      async () => {
        const { S } = await import('/js/state.js');
        return !S.tracking && S.clips[0].track.pts.length > 20;
      },
      null,
      120000
    );
    const secs = (Date.now() - t0) / 1000;
    const acc = await page.evaluate(
      `(async () => { ${mods} ${truthSrc} const rd = await import('/js/render.js'), c = st.S.clips[0];
        let worst = 0;
        for (const t of [0, 0.5, 1.5, 2.5, 3.3, 3.9]) {
          const tp = rd.trackAt(c, t), T = truth(t);
          T.forEach(([x, y], k) => (worst = Math.max(worst, Math.hypot(tp.q[k * 2] * 1280 - x, tp.q[k * 2 + 1] * 720 - y))));
        }
        const P = c.track.pts;
        return { worst, from: P[0].t, to: P[P.length - 1].t, lost: c.track.lost } })()`
    );
    check(
      acc.worst < 6 && acc.from < 0.1 && acc.to > 3.8 && !acc.lost,
      `las 4 esquinas siguen al plano en todo el clip (error máx. ${acc.worst.toFixed(1)} px, ${secs.toFixed(1)} s)`
    );
    // Área con etiqueta: se dibuja en el plano y la etiqueta queda en su centro
    await page.click('[data-act="addArea"]');
    const area = await page.evaluate(
      `(async () => { ${mods} ${truthSrc} const rd = await import('/js/render.js'), c = st.S.clips[0], o = st.S.ovs[st.S.ovs.length - 1];
        const T = truth(3).flat(), [cx, cy] = pl.quadCenter(T), p = rd.ovPos(o, c, 3);
        st.S.T = c._start + 3; rd.renderFrame(st.S.T);
        return { kind: o.kind, err: Math.hypot(p.x - cx, p.y - cy), drawn: st.S.hits.some(h => h.o === o),
          fill: !!document.querySelector('#k-ovfill') } })()`
    );
    check(
      area.kind === 'area' && area.drawn && area.fill && area.err < 4,
      `área con etiqueta: se dibuja y la etiqueta sigue al centro del plano (error ${area.err.toFixed(1)} px)`
    );
    // Un texto que sigue al plano también cambia de tamaño con él (cuando la cámara se aleja)
    const sc = await page.evaluate(
      `(async () => { ${mods} ${truthSrc} const rd = await import('/js/render.js'), c = st.S.clips[0];
        const w = t => { const T = truth(t); return Math.hypot((T[1][0] + T[2][0] - T[0][0] - T[3][0]) / 2, (T[1][1] + T[2][1] - T[0][1] - T[3][1]) / 2); };
        return Math.abs(rd.trackXform(c, 3.5).scale / (w(3.5) / w(1)) - 1) })()`
    );
    check(sc < 0.02, `escala del plano para los textos que lo siguen (error ${(sc * 100).toFixed(1)} %)`);
    // Mismo resultado sin Worker (cálculo en el hilo principal)
    const ref = await page.evaluate(
      `(async () => { ${mods} const t = st.S.clips[0].track; return { quad: t.quad, seed: t.seed, q: t.pts.map(p => p.q) } })()`
    );
    {
      const p2 = await browser.newPage({ viewport: { width: 1280, height: 820 } });
      await p2.addInitScript(() => (window.Worker = undefined));
      await p2.goto(url);
      await until(p2, async () => (await import('/js/state.js')).S.clips.length >= 1);
      await p2.click('[data-tab="media"]');
      await p2.setInputFiles('#fileIn', extra['planar.webm']);
      await until(p2, async () => (await import('/js/state.js')).S.clips.some(c => c.kind === 'video'), null, 20000);
      const diff = await p2.evaluate(
        `(async () => { ${mods} const tr = await import('/js/tracker.js'); ac.act('clearDemo'); const ref = ${JSON.stringify(ref)};
          const c = st.S.clips.find(k => k.kind === 'video'); c.track = { seed: ref.seed, quad: ref.quad, pts: [] };
          await tr.runTrack(c, true);
          const q = c.track.pts.map(p => p.q);
          if (q.length !== ref.q.length) return 1;
          let d = 0; q.forEach((a, i) => a.forEach((v, k) => (d = Math.max(d, Math.abs(v - ref.q[i][k]))))); return d })()`
      );
      check(diff < 1e-9, 'mismo resultado sin Worker (en el hilo principal)');
      await p2.close();
    }
    // Se guarda con el proyecto
    await page.evaluate(`(async () => { ${mods} await pj.saveNow(); })()`);
    await page.reload();
    const kept = await until(
      page,
      async () => {
        const { S } = await import('/js/state.js');
        const c = S.clips[0],
          o = S.ovs[S.ovs.length - 1];
        return S.clips.length === 1 && c.track && c.track.quad && c.track.pts[5].q && o && o.kind === 'area';
      },
      null,
      15000
    );
    check(kept, 'tras recargar, se conservan las esquinas, el rastreo y el área');
    // Borrar el rastreo quita el área (no tendría dónde dibujarse)
    const cleared = await page.evaluate(
      `(async () => { ${mods} st.S.sel = st.S.clips[0].id; ac.act('clearTrack'); return !st.S.ovs.some(o => o.kind === 'area') })()`
    );
    check(cleared, 'borrar el rastreo quita el área');
    check(!errs.length, 'sin errores' + (errs.length ? ': ' + errs.join(' | ') : ''));
    await page.close();
  }

  // Rotación de videos de celular: lo que dibuja el decodificador = lo que muestra <video>
  if (run('rotacion') && extra['rot90.mp4']) {
    console.log('\nVideo girado (rotación en el archivo)');
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await page.goto(url);
    await until(page, async () => (await import('/js/state.js')).S.clips.length === 3);
    const rot = await page.evaluate(async () => {
      const st = await import('/js/state.js'),
        { renderFrame } = await import('/js/render.js'),
        { FrameSource } = await import('/js/frames.js'),
        cl = await import('/js/clips.js');
      const S = st.S,
        blob = await (await fetch('/tests/fixtures/rot90.mp4')).blob();
      const el = cl.makeVid(URL.createObjectURL(blob));
      el.muted = true;
      await new Promise(r => (el.onloadeddata = r));
      const c = {
        id: 'rot',
        kind: 'video',
        el,
        sw: el.videoWidth,
        sh: el.videoHeight,
        dur: el.duration,
        in: 0,
        out: el.duration,
        trans: { type: 'none', d: 0.5 },
        filter: 'none',
        mute: true,
        track: null,
        _start: 0,
        _len: el.duration,
        _d: 0,
      };
      const saved = S.clips;
      S.clips = [c];
      S.expFast = true; // que el bucle no dibuje encima
      await new Promise(r => {
        el.onseeked = r;
        el.currentTime = 1.001;
      });
      await new Promise(r => setTimeout(r, 100));
      renderFrame(1);
      const A = st.ctx.getImageData(0, 0, S.W, S.H).data.slice();
      const fs = await FrameSource.open(blob);
      S.expFrames = new Map([[c.id, { frame: await fs.frameAt(1), rotation: fs.rotation }]]);
      renderFrame(1);
      const B = st.ctx.getImageData(0, 0, S.W, S.H).data;
      S.expFrames = null;
      fs.close();
      S.clips = saved;
      S.expFast = false;
      let d = 0;
      for (let i = 0; i < A.length; i += 4)
        d += Math.abs(A[i] - B[i]) + Math.abs(A[i + 1] - B[i + 1]) + Math.abs(A[i + 2] - B[i + 2]);
      return { size: el.videoWidth + '×' + el.videoHeight, rotation: fs.rotation, diff: d / ((A.length / 4) * 3) };
    });
    check(
      rot.diff < 4,
      `cuadro girado igual que en <video> (${rot.size}, ${rot.rotation}°, diferencia ${rot.diff.toFixed(1)}/255)`
    );
    await page.close();
  }

  // Demuxer contra ffprobe: muestras, tiempos (con cuadros B), tamaños, keyframes y posiciones
  if (run('demux')) {
    console.log('\nDemuxer (contra ffprobe)');
    const { demux } = await import(require('url').pathToFileURL(path.join(ROOT, 'js', 'demux.js')));
    for (const f of [FIX, ...Object.values(extra)]) {
      const r = await demux(new Blob([fs.readFileSync(f)]));
      const pk = ffprobePackets(f),
        webm = /\.webm$/.test(f);
      let bad = 0;
      pk.forEach(([pts, size, pos, flags], i) => {
        const s = r && r.samples[i];
        // En WebM, ffprobe da la posición del bloque y el demuxer la del cuadro (4 bytes después)
        if (
          !s ||
          Math.abs(s.ts / 1e6 - +pts) > 0.0011 ||
          s.size !== +size ||
          s.key !== flags.startsWith('K') ||
          s.off !== +pos + (webm ? 4 : 0)
        )
          bad++;
      });
      check(
        r && r.samples.length === pk.length && !bad,
        `${path.basename(f)}: ${r ? r.codec + ', ' + r.samples.length + ' muestras' : 'no reconocido'}${r && r.rotation ? ', ' + r.rotation + '°' : ''}`
      );
    }
  }

  await browser.close();
  srv.close();
  console.log(failed ? `\n${failed} prueba(s) fallaron` : '\nTodo bien');
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
