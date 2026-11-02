import { $, cv, S } from './state.js';
import { toast, saveBlob } from './util.js';
import { ensureAudio } from './clips.js';
import { play, pause } from './playback.js';
import { renderPanel } from './panel.js';
import { fastCodecs, exportFast, codecName } from './fastexport.js';

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
/** Cómo se va a exportar con el tamaño actual (para el panel). */
export function exportInfo() {
  const key = S.W + 'x' + S.H;
  if (!S.fastBroken && (!S.fastInfo || S.fastInfo.key !== key)) {
    const info = (S.fastInfo = { key, codecs: undefined });
    fastCodecs().then(c => {
      info.codecs = c;
      if (S.fastInfo === info && S.tab === 'export' && !S.exporting) renderPanel();
    });
  }
  const c = !S.fastBroken && S.fastInfo && S.fastInfo.codecs;
  if (c) return { fast: true, ok: true, fmt: 'MP4 · ' + codecName(c.video) + (c.audio ? '' : ' · sin audio') };
  const mime = pickMime();
  return { fast: false, ok: mime !== null, fmt: mime === null ? 'No disponible' : /mp4/.test(mime) ? 'MP4' : 'WebM' };
}
function setResult(blob, ext, took) {
  if (S.result) URL.revokeObjectURL(S.result.url);
  S.result = { blob, ext, url: URL.createObjectURL(blob), size: blob.size, took };
}

export async function startExport() {
  if (!S.clips.length || S.exporting) return;
  pause();
  S.selOv = null;
  const codecs = S.fastBroken ? null : await fastCodecs();
  if (codecs) startFast();
  else startRealtime();
}

async function startFast() {
  S.exporting = true;
  S.expFast = true;
  S.expCancel = false;
  S.expHidden = false;
  renderPanel();
  const t0 = performance.now();
  let r = null,
    err = null;
  try {
    r = await exportFast(p => {
      const b = $('#expBar');
      if (b) b.style.width = p * 100 + '%';
    });
  } catch (e) {
    err = e;
  }
  const cancelled = S.expCancel;
  S.exporting = false;
  S.expFast = false;
  S.expCancel = false;
  S.expHidden = false;
  if (err) {
    console.warn('Exportación rápida', err);
    S.fastBroken = true;
    toast('La exportación rápida falló en este navegador; se usará la exportación en tiempo real');
    startRealtime();
    return;
  }
  if (r && !cancelled) {
    const took = (performance.now() - t0) / 1000;
    setResult(r.blob, r.ext, took);
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
