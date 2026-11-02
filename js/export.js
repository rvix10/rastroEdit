import { $, cv, S } from './state.js';
import { toast, saveBlob } from './util.js';
import { ensureAudio } from './clips.js';
import { play, pause } from './playback.js';
import { renderPanel } from './panel.js';
import {
  fastCodecs,
  exportFast,
  codecName,
  exportSize,
  estimateBytes,
  RESOLUTIONS,
  QUALITIES,
  cleanExports,
} from './fastexport.js';

/* ---------- exportación ---------- */
export function pickMime() {
  if (!window.MediaRecorder) return null;
  const ts = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return (
    ts.find(t => {
      try {
        return MediaRecorder.isTypeSupported(t);
      } catch (e) {
        return false;
      }
    }) || ''
  );
}
/* --- resolución y calidad elegidas: preferencia de este navegador (no del proyecto) --- */
const PREF = 'rastro.export';
S.expOpt = { res: 1080, q: 'normal' };
try {
  const v = JSON.parse(localStorage.getItem(PREF) || 'null');
  if (v && RESOLUTIONS[v.res] && QUALITIES[v.q]) S.expOpt = { res: +v.res, q: v.q };
} catch (e) {}
export function setExportOpt(patch) {
  Object.assign(S.expOpt, patch);
  try {
    localStorage.setItem(PREF, JSON.stringify(S.expOpt));
  } catch (e) {}
}
// Al abrir la app no se muestra ningún resultado: se borran los videos exportados que quedaron en disco
cleanExports();

/** Cómo se va a exportar (para el panel): qué resoluciones admite este navegador, tamaño y peso estimado. */
export function exportInfo() {
  const key = S.aspect;
  if (!S.fastBroken && (!S.fastInfo || S.fastInfo.key !== key)) {
    const info = (S.fastInfo = { key, sizes: {} });
    for (const r of Object.keys(RESOLUTIONS)) {
      const [w, h] = exportSize(S.aspect, +r);
      info.sizes[r] = { w, h, codecs: undefined };
      fastCodecs(w, h).then(c => {
        info.sizes[r].codecs = c;
        if (S.fastInfo === info && S.tab === 'export' && !S.exporting) renderPanel();
      });
    }
  }
  const sizes = !S.fastBroken && S.fastInfo ? S.fastInfo.sizes : null;
  const any = sizes && Object.values(sizes).some(x => x.codecs);
  if (any) {
    // Si la resolución elegida no se puede aquí, la más alta que sí, por debajo
    let res = S.expOpt.res;
    if (!sizes[res].codecs)
      res = +Object.keys(sizes)
        .filter(r => sizes[r].codecs && +r <= res)
        .concat(Object.keys(sizes).filter(r => sizes[r].codecs))[0];
    const s = sizes[res],
      c = s.codecs;
    return {
      fast: true,
      ok: true,
      res,
      sizes,
      w: s.w,
      h: s.h,
      est: estimateBytes(s.w, s.h, S.expOpt.q, S.total),
      fmt: 'MP4 · ' + codecName(c.video) + (c.audio ? '' : ' · sin audio'),
    };
  }
  const mime = pickMime();
  return {
    fast: false,
    ok: mime !== null,
    w: S.W,
    h: S.H,
    fmt: mime === null ? 'No disponible' : /mp4/.test(mime) ? 'MP4' : 'WebM',
  };
}
function setResult(blob, ext, took, extra = {}) {
  if (S.result) URL.revokeObjectURL(S.result.url);
  S.result = { blob, ext, url: URL.createObjectURL(blob), size: blob.size, took, ...extra };
}

export async function startExport() {
  if (!S.clips.length || S.exporting) return;
  pause();
  S.selOv = null;
  const info = exportInfo();
  const codecs = S.fastBroken || !info.fast ? null : await fastCodecs(info.w, info.h);
  if (codecs) startFast(info.res);
  else startRealtime();
}

async function startFast(res) {
  S.exporting = true;
  S.expFast = true;
  S.expCancel = false;
  S.expHidden = false;
  renderPanel();
  const t0 = performance.now();
  let r = null,
    err = null;
  try {
    r = await exportFast(
      p => {
        const b = $('#expBar');
        if (b) b.style.width = p * 100 + '%';
      },
      { res, q: S.expOpt.q }
    );
  } catch (e) {
    err = e;
  }
  const cancelled = S.expCancel;
  S.exporting = false;
  S.expFast = false;
  S.expCancel = false;
  S.expHidden = false;
  if (err && err.name === 'QuotaExceededError') {
    toast('No queda espacio en este dispositivo para exportar el video. Prueba con menos resolución o calidad.');
    renderPanel();
    return;
  }
  if (err) {
    console.warn('Exportación rápida', err);
    S.fastBroken = true;
    toast('La exportación rápida falló en este navegador; se usará la exportación en tiempo real');
    startRealtime();
    return;
  }
  if (r && !cancelled) {
    const took = (performance.now() - t0) / 1000;
    setResult(r.blob, r.ext, took, { w: r.w, h: r.h, opfs: r.opfs });
    cleanExports(r.opfs); // el resultado anterior ya no se muestra: se borra del disco
    toast('Video exportado');
  }
  renderPanel();
}

function startRealtime() {
  if (!window.MediaRecorder || !cv.captureStream) {
    toast('Este navegador no permite grabar video desde la página');
    return;
  }
  pause();
  S.selOv = null;
  ensureAudio();
  const vs = cv.captureStream(30),
    tracks = [...vs.getVideoTracks()];
  if (S.adest) tracks.push(...S.adest.stream.getAudioTracks());
  const mime = pickMime();
  let rec;
  try {
    rec = new MediaRecorder(new MediaStream(tracks), mime ? { mimeType: mime, videoBitsPerSecond: 8e6 } : {});
  } catch (e) {
    toast('No se pudo iniciar la grabación');
    return;
  }
  const chunks = [];
  rec.ondataavailable = e => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  rec.onstop = () => {
    vs.getTracks().forEach(t => t.stop());
    if (S.expCancel) {
      S.expCancel = false;
      renderPanel();
      return;
    }
    const type = rec.mimeType || mime || 'video/webm',
      blob = new Blob(chunks, { type });
    setResult(blob, /mp4/.test(type) ? 'mp4' : 'webm');
    renderPanel();
    toast('Video exportado');
  };
  S.rec = rec;
  S.exporting = true;
  S.expCancel = false;
  S.T = 0;
  rec.start(250);
  renderPanel();
  setTimeout(play, 120);
}
export function finishExport() {
  S.exporting = false;
  S.expHidden = false;
  try {
    S.rec.stop();
  } catch (e) {}
}
export function cancelExport() {
  S.expCancel = true;
  if (S.expFast) return; // el bucle de exportFast() lo ve y termina
  S.exporting = false;
  S.expHidden = false;
  pause();
  try {
    S.rec.stop();
  } catch (e) {}
}
// En segundo plano el navegador deja de dibujar cuadros (requestAnimationFrame se detiene),
// pero MediaRecorder seguiría grabando: el video saldría congelado. Se pausa todo y se retoma al volver.
document.addEventListener('visibilitychange', () => {
  if (!S.exporting || S.expFast || !S.rec) return; // la rápida maneja su propia pausa
  if (document.visibilityState === 'hidden') {
    if (S.expHidden) return;
    S.expHidden = true;
    pause();
    try {
      S.rec.pause();
    } catch (e) {}
  } else if (S.expHidden) {
    S.expHidden = false;
    try {
      S.rec.resume();
    } catch (e) {}
    play();
    toast('Exportación reanudada. Deja esta pestaña abierta hasta que termine.');
  }
});

export async function saveResult() {
  if (!S.result) return;
  const msg = await saveBlob(S.result.blob, 'rastro-' + new Date().toISOString().slice(0, 10) + '.' + S.result.ext);
  const m = $('#saveMsg');
  if (m) m.textContent = msg;
}
