// Genera el material gráfico de la ficha de Google Play a partir de la app real:
//   node store/generar.cjs
// Necesita Playwright (como la prueba de humo). Sirve la app localmente y guarda en store/:
//   capturas JPEG de teléfono (1080×1920), tablet 7" (1200×1920) y tablet 10" (2560×1600), imagen destacada (1024×500)
//   e ícono (512×512).
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = __dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

function serve() {
  const srv = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return res.writeHead(404), res.end();
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(r => srv.listen(0, () => r(srv)));
}

// Escenas: qué pestaña y en qué momento del proyecto de ejemplo
const SCENES = [
  { name: 'rastreo', tab: 'track', T: 2.2 },
  { name: 'texto', tab: 'text', T: 1.6, ov: 2 },
  { name: 'transiciones', tab: 'trans', T: 5.3, sel: 1 },
  { name: 'exportar', tab: 'export', T: 9.5 },
];
const DEVICES = [
  { name: 'telefono', w: 360, h: 640, dpr: 3 }, // 1080×1920
  { name: 'tablet7', w: 600, h: 960, dpr: 2 }, // 1200×1920
  { name: 'tablet10', w: 1280, h: 800, dpr: 2 }, // 2560×1600
];

(async () => {
  const srv = await serve();
  const url = `http://localhost:${srv.address().port}/`;
  const browser = await chromium.launch();
  for (const d of DEVICES) {
    const ctx = await browser.newContext({ viewport: { width: d.w, height: d.h }, deviceScaleFactor: d.dpr, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.addInitScript(() => localStorage.setItem('rastro.welcome', '1')); // sin la bienvenida
    await page.goto(url);
    for (let i = 0; i < 150; i++) {
      if (await page.evaluate(async () => { const { S } = await import('/js/state.js'); return S.clips.length === 3 && !S.tracking; })) break;
      await page.waitForTimeout(100);
    }
    for (const sc of SCENES) {
      await page.evaluate(async sc => {
        const { S } = await import('/js/state.js');
        const pn = await import('/js/panel.js');
        S.sel = S.clips[sc.sel || 0].id;
        S.selOv = sc.ov != null ? S.ovs[sc.ov].id : null;
        S.T = sc.T;
        pn.setTab(sc.tab);
        document.querySelector('#panel').scrollTop = 0;
      }, sc);
      await page.waitForTimeout(600);
      const f = path.join(OUT, `${d.name}-${SCENES.indexOf(sc) + 1}-${sc.name}.jpg`);
      await page.screenshot({ path: f, type: 'jpeg', quality: 92 }); // Play: JPEG o PNG sin transparencia
      console.log('  ' + path.relative(ROOT, f));
    }
    await ctx.close();
  }

  // Imagen destacada 1024×500: logo, nombre, frase y una captura de la app
  const shot = fs.readFileSync(path.join(OUT, 'tablet10-1-rastreo.jpg')).toString('base64');
  const fonts = fs.readFileSync(path.join(ROOT, 'css', 'fonts.css'), 'utf8').replace(/\.\.\/fonts\//g, url + 'fonts/');
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
  await page.setContent(`<!doctype html><html><head><style>${fonts}
    body{margin:0;width:1024px;height:500px;overflow:hidden;background:#111318;color:#e9ebf1;font-family:Manrope,sans-serif}
    .t{position:absolute;left:56px;top:96px;width:400px}
    .logo{display:flex;align-items:center;gap:14px;font:800 44px Unbounded,sans-serif}
    .logo svg{color:#f1a93b}
    p{font-size:26px;line-height:1.3;font-weight:700;margin:26px 0 0}
    p span{color:#f1a93b}
    small{display:block;margin-top:18px;font-size:17px;color:#8c93a3;font-weight:600}
    img{position:absolute;left:480px;top:56px;width:640px;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.6);border:1px solid #2c313d}
  </style></head><body>
    <div class="t"><div class="logo"><svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="6.5"/><path d="M12 1.5v5M12 17.5v5M1.5 12h5M17.5 12h5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>Rastro</div>
    <p>Edita video y haz que el texto <span>siga al objeto</span>.</p>
    <small>Rastreo de movimiento · Transiciones · Música · Exporta en 4K</small></div>
    <img src="data:image/jpeg;base64,${shot}">
  </body></html>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, 'destacada-1024x500.png') });
  console.log('  store/destacada-1024x500.png');
  fs.copyFileSync(path.join(ROOT, 'icons', 'icon-512.png'), path.join(OUT, 'icono-512.png'));
  console.log('  store/icono-512.png');
  await browser.close();
  srv.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
