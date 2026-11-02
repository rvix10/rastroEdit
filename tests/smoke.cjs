// Prueba de humo en Chromium (Playwright). Sin dependencias en el repo:
//   node tests/smoke.cjs                 todo
//   node tests/smoke.cjs tactil 2puntos  solo esas secciones (basico, tablet, tactil, 2puntos, rotacion, demux)
// Necesita `playwright` disponible (en el entorno de la nube ya viene) y `ffmpeg` para el video de prueba.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIX = path.join(__dirname, 'fixtures', 'test.webm');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
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
      await ctx.close();
    }
    // En PC con mouse se mantiene el diseño compacto
    const pc = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await pc.goto(url);
    const hb = await pc.evaluate(() => document.querySelector('#bUndo').getBoundingClientRect().height);
    check(hb < 40, `PC con mouse: diseño compacto (deshacer mide ${Math.round(hb)} px)`);
    await pc.close();
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
