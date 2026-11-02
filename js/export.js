import { $, cv, S } from './state.js';
import { toast } from './util.js';
import { ensureAudio } from './clips.js';
import { play, pause } from './playback.js';
import { renderPanel } from './panel.js';

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
export function startExport() {
  if (!S.clips.length) return;
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
      blob = new Blob(chunks, { type }),
      ext = /mp4/.test(type) ? 'mp4' : 'webm';
    if (S.result) URL.revokeObjectURL(S.result.url);
    S.result = { blob, ext, url: URL.createObjectURL(blob), size: blob.size };
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
  try {
    S.rec.stop();
  } catch (e) {}
}
export function cancelExport() {
  S.expCancel = true;
  S.exporting = false;
  pause();
  try {
    S.rec.stop();
  } catch (e) {}
}
export async function saveResult() {
  const m = $('#saveMsg');
  if (!S.result) return;
  const name = 'rastro-' + new Date().toISOString().slice(0, 10) + '.' + S.result.ext;
  if (!S.dl) {
    const a = document.createElement('a');
    a.href = S.result.url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (m) m.textContent = 'Descarga iniciada: ' + name;
    return;
  }
  try {
    await S.dl.save({ filename: name, data: S.result.blob });
    if (m) m.textContent = 'Archivo guardado.';
  } catch (e) {
    const c = e && e.code;
    if (m)
      m.textContent =
        c === 'declined'
          ? 'Descarga cancelada.'
          : c === 'rate_limited'
            ? 'Hay otra descarga pendiente; intenta de nuevo en un momento.'
            : 'No se pudo guardar el archivo' + (e && e.message ? ': ' + e.message : '.');
  }
}
