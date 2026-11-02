/* ---------- exportación rápida con WebCodecs ----------
   En vez de reproducir el proyecto y grabar la pantalla (1×), se arma cuadro por cuadro:
   se busca el cuadro exacto de cada video, se compone con renderFrame() y se pasa a VideoEncoder.
   El audio se mezcla aparte con OfflineAudioContext (mismos fundidos que la reproducción)
   y se codifica con AudioEncoder. mp4.js junta todo en un .mp4.
   Si la pestaña pasa a segundo plano se pausa (los videos ocultos pueden dejar de decodificar).
*/
import { cv, S } from './state.js';
import { clamp, ease } from './util.js';
import { activeAt, localOf } from './timeline.js';
import { renderFrame } from './render.js';
import { P } from './project.js';
import { Mp4Muxer } from './mp4.js';
import { FrameSource } from './frames.js';
import { mixMusic } from './music.js';

export const FPS = 30;
const SR = 48000;
// Nivel 4.0 alcanza para 1280×720, 720×1280 y 1080×1080 a 30 fps
const VIDEO_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.42e028', 'vp09.00.40.08', 'av01.0.08M.08'];
const AUDIO_CODECS = ['mp4a.40.2', 'opus'];
export const codecName = c => (!c ? '' : c.startsWith('avc1') ? 'H.264' : c.startsWith('vp09') ? 'VP9' : 'AV1');

const bitrateFor = (w, h) => Math.round(clamp(w * h * FPS * 0.2, 2e6, 12e6));
const cache = new Map();

/** Códecs que este navegador puede usar para el tamaño dado, o null si no hay WebCodecs. */
export function fastCodecs(w = S.W, h = S.H) {
  const key = w + 'x' + h;
  if (!cache.has(key)) cache.set(key, probe(w, h));
  return cache.get(key);
}
async function probe(w, h) {
  if (!('VideoEncoder' in window) || !('VideoFrame' in window) || !('OfflineAudioContext' in window)) return null;
  let video = null,
    audio = null;
  for (const codec of VIDEO_CODECS) {
    try {
      const r = await VideoEncoder.isConfigSupported(videoConfig(codec, w, h));
      if (r.supported) {
        video = codec;
        break;
      }
    } catch (e) {}
  }
  if (!video) return null;
  if ('AudioEncoder' in window)
    for (const codec of AUDIO_CODECS) {
      try {
        const r = await AudioEncoder.isConfigSupported(audioConfig(codec));
        if (r.supported) {
          audio = codec;
          break;
        }
      } catch (e) {}
    }
  return { video, audio };
}
function videoConfig(codec, w, h) {
  const c = { codec, width: w, height: h, bitrate: bitrateFor(w, h), framerate: FPS, latencyMode: 'quality' };
  if (codec.startsWith('avc1')) c.avc = { format: 'avc' };
  return c;
}
const audioConfig = codec => ({ codec, sampleRate: SR, numberOfChannels: 2, bitrate: 160000 });

/* --- audio: mezcla fuera de línea --- */
async function mixAudio(clips, total, onStep) {
  const oac = new OfflineAudioContext(2, Math.max(1, Math.ceil(total * SR)), SR);
  const decoded = new Map();
  const N = 32,
    up = new Float32Array(N),
    down = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    up[k] = ease(k / (N - 1));
    down[k] = 1 - up[k];
  }
  let any = false;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    onStep(i / clips.length);
    if (c.kind !== 'video' || c.mute || c.missing || !c.mediaId) continue;
    if (!decoded.has(c.mediaId)) {
      const md = P.media.get(c.mediaId);
      let buf = null;
      try {
        if (md && md.blob) buf = await oac.decodeAudioData(await md.blob.arrayBuffer());
      } catch (e) {} // video sin pista de audio
      decoded.set(c.mediaId, buf);
    }
    const buf = decoded.get(c.mediaId);
    if (!buf) continue;
    const src = oac.createBufferSource(),
      g = oac.createGain(),
      vol = c.vol ?? 1;
    if (vol <= 0) continue;
    src.buffer = buf;
    src.connect(g).connect(oac.destination);
    // Igual que syncMedia(): volumen del clip × ease(p) al entrar y × (1 − ease(p)) al salir de cada transición
    g.gain.value = vol;
    if (c._d > 0)
      g.gain.setValueCurveAtTime(
        up.map(x => x * vol),
        c._start,
        c._d
      );
    const next = clips[i + 1];
    if (next && next._d > 0)
      g.gain.setValueCurveAtTime(
        down.map(x => x * vol),
        next._start,
        next._d
      );
    src.start(c._start, c.in, c._len);
    any = true;
  }
  if (await mixMusic(oac, P.media, total)) any = true;
  return any ? await oac.startRendering() : null;
}

/* --- utilidades de espera (sin requestAnimationFrame: sigue andando aunque no se dibuje) --- */
function seekExact(el, t) {
  if (!el.seeking && Math.abs(el.currentTime - t) < 1e-4 && el.readyState >= 2) return Promise.resolve();
  return new Promise(res => {
    const done = () => {
      el.removeEventListener('seeked', done);
      clearTimeout(to);
      res();
    };
    const to = setTimeout(done, 4000);
    el.addEventListener('seeked', done);
    el.currentTime = t;
  });
}
const drained = enc =>
  new Promise(r => {
    const to = setTimeout(r, 50);
    enc.addEventListener(
      'dequeue',
      () => {
        clearTimeout(to);
        r();
      },
      { once: true }
    );
  });
const visible = () =>
  new Promise(r => {
    const f = () => {
      if (document.hidden && !S.expCancel) return;
      document.removeEventListener('visibilitychange', f);
      clearInterval(iv);
      r();
    };
    const iv = setInterval(f, 250); // también revisa la cancelación
    document.addEventListener('visibilitychange', f);
  });

/**
 * Exporta el proyecto. onProgress(0..1). Devuelve { blob, ext } o null si se canceló.
 * Lanza un error si el navegador falla a mitad de camino.
 */
export async function exportFast(onProgress) {
  const codecs = await fastCodecs(S.W, S.H);
  if (!codecs) throw new Error('Sin WebCodecs');
  const clips = S.clips.slice(),
    total = S.total,
    W = S.W,
    H = S.H;
  for (const c of clips) if (c.el) c.el.pause();

  // 1. Audio (rápido: se mezcla todo de una vez)
  let mixed = null;
  if (codecs.audio) mixed = await mixAudio(clips, total, p => onProgress(p * 0.03));
  if (S.expCancel) return null;

  const mux = new Mp4Muxer({
    video: { codec: codecs.video, width: W, height: H },
    audio: mixed ? { codec: codecs.audio, sampleRate: SR, channels: 2 } : null,
  });
  let fail = null;
  const onErr = e => (fail = fail || e);

  if (mixed) {
    const ae = new AudioEncoder({ output: (ch, meta) => mux.addAudio(ch, meta), error: onErr });
    ae.configure(audioConfig(codecs.audio));
    const L = mixed.getChannelData(0),
      R = mixed.getChannelData(1),
      F = 4800;
    for (let o = 0; o < L.length && !fail; o += F) {
      const n = Math.min(F, L.length - o),
        data = new Float32Array(n * 2);
      data.set(L.subarray(o, o + n), 0);
      data.set(R.subarray(o, o + n), n);
      const ad = new AudioData({
        format: 'f32-planar',
        sampleRate: SR,
        numberOfFrames: n,
        numberOfChannels: 2,
        timestamp: Math.round((o / SR) * 1e6),
        data,
      });
      ae.encode(ad);
      ad.close();
      if (ae.encodeQueueSize > 8) await drained(ae);
    }
    await ae.flush();
    ae.close();
    if (fail) throw fail;
  }

  // 2. Video, cuadro por cuadro. Cada clip con video se decodifica con VideoDecoder (frames.js);
  //    si su archivo o códec no se puede, ese clip usa seek en su <video> (más lento).
  const srcs = new Map();
  for (const c of clips)
    if (c.kind === 'video' && !c.missing && c.mediaId) {
      const md = P.media.get(c.mediaId);
      const fs = md && md.blob ? await FrameSource.open(md.blob) : null;
      if (fs) srcs.set(c.id, fs);
    }
  S.expFrames = new Map();
  const ve = new VideoEncoder({ output: (ch, meta) => mux.addVideo(ch, meta), error: onErr });
  ve.configure(videoConfig(codecs.video, W, H));
  const N = Math.max(1, Math.round(total * FPS)),
    dur = Math.round(1e6 / FPS);
  try {
    for (let i = 0; i < N; i++) {
      if (S.expCancel) break;
      if (fail) throw fail;
      if (document.hidden) {
        S.expHidden = true;
        await visible();
        S.expHidden = false;
        if (S.expCancel) break;
      }
      const T = Math.min(i / FPS, total - 1e-4);
      S.expFrames.clear();
      for (const c of activeAt(T)) {
        if (!c.el || c.missing) continue;
        const local = localOf(c, T),
          fs = srcs.get(c.id);
        if (fs) {
          try {
            const frame = await fs.frameAt(local);
            if (frame) {
              S.expFrames.set(c.id, { frame, rotation: fs.rotation });
              continue;
            }
          } catch (e) {
            console.warn('Decodificación', c.name, e);
            fs.close();
            srcs.delete(c.id);
          }
        }
        // +1 ms: cae dentro del cuadro buscado aunque haya redondeo en la marca de tiempo
        await seekExact(c.el, Math.min(local + 1e-3, c.out));
      }
      renderFrame(T);
      S.T = T;
      const vf = new VideoFrame(cv, { timestamp: Math.round((i * 1e6) / FPS), duration: dur });
      ve.encode(vf, { keyFrame: i % (FPS * 2) === 0 });
      vf.close();
      while (ve.encodeQueueSize > 4) await drained(ve);
      onProgress(0.03 + 0.97 * ((i + 1) / N));
    }
  } catch (e) {
    if (ve.state !== 'closed') ve.close();
    throw e;
  } finally {
    S.expFrames = null;
    for (const fs of srcs.values()) fs.close();
  }
  if (S.expCancel) {
    ve.close();
    return null;
  }
  await ve.flush();
  ve.close();
  if (fail) throw fail;
  return { blob: mux.finish(), ext: 'mp4', codec: codecs.video };
}
