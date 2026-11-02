/* ---------- diagnóstico del dispositivo (Proyectos → Este dispositivo) ----------
   Qué puede hacer este equipo: hardware, códecs (y si van por hardware) y una medición de rendimiento
   expresada en «× tiempo real». El informe se copia para compartirlo.
*/
import { S } from './state.js';
import { fastCodecs, codecName } from './fastexport.js';
import { TrackCore, AW } from './trackcore.js';
import { isStandalone } from './pwa.js';

const FPS = 30;

/** Navegador y hardware (rápido). */
export async function deviceInfo() {
  const n = navigator;
  let gpu = '';
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || (gl && gl.getParameter(gl.RENDERER)) || '';
  } catch (e) {}
  let browser = '';
  if (n.userAgentData && n.userAgentData.brands) {
    const b = n.userAgentData.brands.find(x => !/Not.?A.?Brand|Chromium/i.test(x.brand)) || n.userAgentData.brands[0];
    browser = b ? `${b.brand} ${b.version}` : '';
  }
  if (!browser) browser = (n.userAgent.match(/(Firefox|Edg|Chrome|Safari)\/[\d.]+/) || [''])[0].replace('/', ' ');
  let storage = null;
  try {
    const e = await n.storage.estimate();
    storage = {
      usage: e.usage || 0,
      quota: e.quota || 0,
      persisted: n.storage.persisted ? await n.storage.persisted() : false,
    };
  } catch (e) {}
  return {
    browser,
    platform: (n.userAgentData && n.userAgentData.platform) || n.platform || '',
    mobile: !!(n.userAgentData && n.userAgentData.mobile),
    cores: n.hardwareConcurrency || 0,
    memory: n.deviceMemory || 0, // GB (el navegador redondea, máximo 8)
    gpu,
    screen: `${screen.width}×${screen.height} @${(devicePixelRatio || 1).toFixed(2).replace(/\.?0+$/, '')}x`,
    storage,
    app: isStandalone() ? 'instalada' : 'en el navegador',
    offline: !!(navigator.serviceWorker && navigator.serviceWorker.controller),
    webcodecs: 'VideoEncoder' in window && 'VideoDecoder' in window,
    opfs: !!(n.storage && n.storage.getDirectory),
  };
}

// Qué se prueba: códec, tamaño y si es para decodificar (videos importados) o codificar (exportar)
const VIDEO_TESTS = [
  { n: 'H.264 1080p', codec: 'avc1.640028', w: 1920, h: 1080 },
  { n: 'H.264 4K', codec: 'avc1.640033', w: 3840, h: 2160 },
  { n: 'HEVC (H.265) 1080p', codec: 'hvc1.1.6.L120.90', w: 1920, h: 1080 },
  { n: 'HEVC (H.265) 4K', codec: 'hvc1.1.6.L153.90', w: 3840, h: 2160 },
  { n: 'VP9 1080p', codec: 'vp09.00.40.08', w: 1920, h: 1080 },
  { n: 'AV1 1080p', codec: 'av01.0.08M.08', w: 1920, h: 1080 },
];
async function supported(Kind, config) {
  try {
    return !!(await Kind.isConfigSupported(config)).supported;
  } catch (e) {
    return false;
  }
}
/** 'hardware' | 'software' | false, según lo que informa el navegador. */
async function how(Kind, config) {
  if (!(await supported(Kind, config))) return false;
  return (await supported(Kind, { ...config, hardwareAcceleration: 'prefer-hardware' })) ? 'hardware' : 'software';
}

/** Códecs de video (decodificar y codificar) y de audio (codificar). */
export async function codecSupport() {
  const out = { video: [], audio: [] };
  if (!('VideoDecoder' in window)) return out;
  for (const t of VIDEO_TESTS) {
    const dec = await how(VideoDecoder, { codec: t.codec, codedWidth: t.w, codedHeight: t.h });
    const encCfg = { codec: t.codec, width: t.w, height: t.h, bitrate: 8e6, framerate: FPS };
    if (t.codec.startsWith('avc1')) encCfg.avc = { format: 'avc' };
    if (t.codec.startsWith('hvc1')) encCfg.hevc = { format: 'hevc' };
    const enc = 'VideoEncoder' in window ? await how(VideoEncoder, encCfg) : false;
    out.video.push({ n: t.n, dec, enc });
  }
  if ('AudioEncoder' in window)
    for (const [n, codec] of [
      ['AAC', 'mp4a.40.2'],
      ['Opus', 'opus'],
    ])
      out.audio.push({
        n,
        enc: await supported(AudioEncoder, { codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 }),
      });
  return out;
}

/* --- mediciones --- */
// Cuadro sintético con algo de detalle (degradado, formas y texto en movimiento), dibujado en cada cuadro como la exportación
function scene(g, w, h, i) {
  const t = i / FPS;
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, `hsl(${(t * 40) % 360},45%,30%)`);
  gr.addColorStop(1, `hsl(${(t * 40 + 120) % 360},45%,18%)`);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
  for (let k = 0; k < 24; k++) {
    g.fillStyle = `hsl(${k * 15},70%,55%)`;
    const x = ((k * 97 + t * 160) % (w + 200)) - 100,
      y = (k * 53) % h;
    g.fillRect(x, y, w * 0.06, h * 0.06);
  }
  g.fillStyle = '#fff';
  g.font = `800 ${Math.round(h * 0.08)}px Manrope, system-ui, sans-serif`;
  g.fillText('Rastro ' + i, w * 0.1 + t * 50, h * 0.5);
}

async function encodeDecode(codec, w, h, frames) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  const chunks = [];
  let desc = null,
    fail = null;
  const enc = new VideoEncoder({
    output: (ch, meta) => {
      chunks.push(ch);
      if (meta && meta.decoderConfig && meta.decoderConfig.description) desc = meta.decoderConfig.description;
    },
    error: e => (fail = e),
  });
  const cfg = {
    codec,
    width: w,
    height: h,
    bitrate: Math.round(w * h * FPS * 0.13),
    framerate: FPS,
    latencyMode: 'quality',
  };
  if (codec.startsWith('avc1')) cfg.avc = { format: 'avc' };
  enc.configure(cfg);
  const t0 = performance.now();
  for (let i = 0; i < frames && !fail; i++) {
    scene(g, w, h, i);
    const vf = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    enc.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
    vf.close();
    while (enc.encodeQueueSize > 4) await new Promise(r => setTimeout(r, 1));
  }
  await enc.flush();
  const encMs = performance.now() - t0;
  enc.close();
  if (fail) throw fail;
  // Decodificar lo que se acaba de codificar
  let n = 0;
  const dec = new VideoDecoder({ output: f => (n++, f.close()), error: e => (fail = e) });
  dec.configure({ codec, codedWidth: w, codedHeight: h, ...(desc ? { description: desc } : {}) });
  const t1 = performance.now();
  for (const ch of chunks) {
    dec.decode(ch);
    while (dec.decodeQueueSize > 8) await new Promise(r => setTimeout(r, 1));
  }
  await dec.flush();
  const decMs = performance.now() - t1;
  dec.close();
  if (fail) throw fail;
  return { encFps: (frames * 1000) / encMs, decFps: (n * 1000) / decMs };
}

function trackBench(steps = 30) {
  const AH = Math.round((AW * 9) / 16),
    cv = document.createElement('canvas');
  cv.width = AW;
  cv.height = AH;
  const g = cv.getContext('2d', { willReadFrequently: true });
  scene(g, AW, AH, 0);
  const core = new TrackCore(AH, g.getImageData(0, 0, AW, AH).data, [
    { x: 0.4, y: 0.45 },
    { x: 0.6, y: 0.55 },
  ]);
  core.begin();
  const frames = [];
  for (let i = 1; i <= steps; i++) {
    scene(g, AW, AH, i);
    frames.push(g.getImageData(0, 0, AW, AH).data);
  }
  const t0 = performance.now();
  for (const f of frames) core.step(f);
  return (performance.now() - t0) / steps; // ms por cuadro analizado (2 puntos)
}

/**
 * Mide el rendimiento. onStep(texto, 0..1). Devuelve filas { n, v } con «× tiempo real».
 * La exportación usa el códec que elegiría la app; el rastreo analiza 15 cuadros por segundo de video.
 */
export async function benchmark(onStep = () => {}) {
  const rows = [];
  const xrt = fps => (fps / FPS).toFixed(1).replace('.', ',') + '× tiempo real';
  const sizes = [
    ['1080p', 1920, 1080, 60],
    ['4K', 3840, 2160, 30],
  ];
  for (let k = 0; k < sizes.length; k++) {
    const [n, w, h, frames] = sizes[k];
    onStep('Exportación ' + n + '…', k / 3);
    const c = await fastCodecs(w, h);
    if (!c) {
      rows.push({ n: `Exportar ${n}`, v: 'no disponible en este navegador' });
      continue;
    }
    try {
      const r = await encodeDecode(c.video, w, h, frames);
      rows.push({
        n: `Exportar ${n} (${codecName(c.video)})`,
        v: `${xrt(r.encFps)} · ${Math.round(r.encFps)} cuadros/s`,
      });
      rows.push({
        n: `Decodificar ${n} (${codecName(c.video)})`,
        v: `${xrt(r.decFps)} · ${Math.round(r.decFps)} cuadros/s`,
      });
    } catch (e) {
      rows.push({ n: `Exportar ${n}`, v: 'falló: ' + ((e && e.message) || e) });
    }
  }
  onStep('Rastreo…', 2 / 3);
  await new Promise(r => setTimeout(r, 30));
  const ms = trackBench();
  rows.push({
    n: 'Rastreo, 2 puntos (cálculo)',
    v: `${(1000 / ms / 15).toFixed(1).replace('.', ',')}× tiempo real · ${ms.toFixed(1).replace('.', ',')} ms por cuadro`,
  });
  onStep('Listo', 1);
  return rows;
}

/** Informe en texto, para copiar y compartir. */
export function reportText(info, codecs, bench) {
  const L = [];
  const yesNo = v => (v === 'hardware' ? 'sí (hardware)' : v === 'software' ? 'sí (software)' : v ? 'sí' : 'no');
  L.push('Rastro Editor — diagnóstico del dispositivo', new Date().toLocaleString('es'));
  if (info) {
    L.push(
      '',
      `Navegador: ${info.browser} · ${info.platform}${info.mobile ? ' (móvil)' : ''} · ${info.app}`,
      `Núcleos: ${info.cores || '?'} · Memoria: ${info.memory ? info.memory + ' GB o más' : '?'} · Pantalla: ${info.screen}`,
      `GPU: ${info.gpu || '?'}`,
      `WebCodecs: ${info.webcodecs ? 'sí' : 'no'} · Disco (OPFS): ${info.opfs ? 'sí' : 'no'} · Sin conexión: ${info.offline ? 'sí' : 'no'}`
    );
    if (info.storage)
      L.push(
        `Espacio: ${(info.storage.usage / 1048576).toFixed(0)} MB usados de ${(info.storage.quota / 1073741824).toFixed(1)} GB · persistente: ${info.storage.persisted ? 'sí' : 'no'}`
      );
  }
  if (codecs) {
    L.push('', 'Códecs de video (decodificar / codificar):');
    for (const v of codecs.video) L.push(`  ${v.n}: ${yesNo(v.dec)} / ${yesNo(v.enc)}`);
    L.push('Audio para exportar: ' + codecs.audio.map(a => `${a.n} ${a.enc ? 'sí' : 'no'}`).join(' · '));
  }
  if (bench) {
    L.push('', 'Rendimiento:');
    for (const r of bench) L.push(`  ${r.n}: ${r.v}`);
  }
  return L.join('\n');
}
