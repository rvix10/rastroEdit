/* ---------- música de fondo ----------
   Una pista que suena durante todo el proyecto. Se guarda en S.music (ver MUSIC_KEYS):
     { mediaId, name, dur, vol, in, fadeIn, fadeOut, loop }
   in = segundo de la canción donde empieza; loop = repetir si la canción es más corta que el proyecto.
   La reproducción usa un <audio> conectado a WebAudio (también llega a la exportación en tiempo real);
   la exportación rápida la mezcla con mixMusic(). Las dos usan musicGainAt() y musicTime().
*/
import { S, nid } from './state.js';
import { clamp, toast } from './util.js';

export const MUSIC_KEYS = ['mediaId', 'name', 'dur', 'vol', 'in', 'fadeIn', 'fadeOut', 'loop'];
export const MUSIC_DEFAULTS = { vol: 0.8, in: 0, fadeIn: 0, fadeOut: 2, loop: true };
export const MUSIC_ACCEPT = 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac';

/** Estado de ejecución (no se guarda): elemento <audio> y su ganancia en WebAudio. */
export const MUS = { el: null, gain: null, mediaId: null };

export function musicData() {
  if (!S.music) return null;
  const o = {};
  for (const k of MUSIC_KEYS) if (S.music[k] !== undefined) o[k] = S.music[k];
  return o;
}

/** Segundo de la canción que suena en el instante T del proyecto, o null si ya terminó (sin repetir). */
export function musicTime(m, T) {
  if (!m || !m.dur) return null;
  const t = m.in + T;
  if (t < m.dur) return t;
  return m.loop ? t % m.dur : null;
}
/** Volumen de la música en T: volumen × fundido de entrada × fundido de salida (al final del proyecto). */
export function musicGainAt(m, T, total) {
  if (!m) return 0;
  const fi = Math.min(m.fadeIn || 0, total / 2),
    fo = Math.min(m.fadeOut || 0, total / 2);
  let g = m.vol;
  if (fi > 0) g *= clamp(T / fi, 0, 1);
  if (fo > 0) g *= clamp((total - T) / fo, 0, 1);
  return g;
}

function makeAudio(url) {
  const a = document.createElement('audio');
  a.preload = 'auto';
  a.src = url;
  return a;
}
export function dropMusicEl() {
  if (MUS.el) {
    MUS.el.pause();
    MUS.el.removeAttribute('src');
    MUS.el.load();
  }
  MUS.el = null;
  MUS.gain = null;
  MUS.mediaId = null;
}
/** Crea (o reutiliza) el <audio> de S.music a partir de los videos/audios guardados (media). */
export function attachMusic(media) {
  const m = S.music;
  if (!m) return dropMusicEl();
  if (MUS.el && MUS.mediaId === m.mediaId) return;
  dropMusicEl();
  const md = media.get(m.mediaId);
  m.missing = !md || !md.url;
  if (m.missing) return;
  MUS.el = makeAudio(md.url);
  MUS.mediaId = m.mediaId;
  wireMusic();
}
export function wireMusic() {
  if (!S.ac || !MUS.el || MUS.gain) return;
  try {
    const s = S.ac.createMediaElementSource(MUS.el);
    MUS.gain = S.ac.createGain();
    s.connect(MUS.gain);
    MUS.gain.connect(S.ac.destination);
    if (S.adest) MUS.gain.connect(S.adest);
  } catch (e) {}
}

/** Sincroniza el <audio> con el reloj del proyecto (lo llama syncMedia en cada cuadro). */
export function syncMusic(T) {
  const m = S.music,
    el = MUS.el;
  if (!m || !el || m.missing) return;
  const g = musicGainAt(m, T, S.total);
  if (MUS.gain) MUS.gain.gain.value = g;
  else el.volume = clamp(g, 0, 1);
  const want = musicTime(m, T);
  if (S.playing && want != null && T < S.total) {
    if (el.paused) {
      el.currentTime = want;
      el.play().catch(() => {});
    } else if (Math.abs(el.currentTime - want) > 0.25) el.currentTime = want;
  } else if (!el.paused) el.pause();
}

/** Lee la duración de un archivo de audio (o null si el navegador no lo puede abrir). */
function probe(url) {
  return new Promise(res => {
    const a = makeAudio(url);
    const done = v => {
      a.removeAttribute('src');
      a.load();
      res(v);
    };
    a.onloadedmetadata = () => done(isFinite(a.duration) && a.duration > 0 ? a.duration : null);
    a.onerror = () => done(null);
    setTimeout(() => done(null), 10000);
  });
}

/**
 * Agrega o reemplaza la música. Con relink, conserva los ajustes (volumen, fundidos…) y el mediaId.
 * storeMedia viene de project.js (se pasa para no crear una dependencia circular al cargar).
 */
export async function importMusic(file, storeMedia, relink = false) {
  if (!file) return false;
  const url = URL.createObjectURL(file),
    dur = await probe(url);
  if (!dur) {
    URL.revokeObjectURL(url);
    toast('No se pudo leer «' + file.name + '». Prueba con MP3, M4A, WAV u OGG.');
    return false;
  }
  const keep = relink && S.music ? S.music : null;
  const mediaId = keep ? keep.mediaId : nid();
  await storeMedia(mediaId, file, file.name, url);
  const name = file.name.replace(/\.[^.]+$/, '');
  S.music = keep
    ? { ...keep, name, dur, in: Math.min(keep.in, Math.max(0, dur - 1)), missing: false }
    : { mediaId, name, dur, ...MUSIC_DEFAULTS };
  dropMusicEl();
  return true;
}

/** Mezcla la música en un OfflineAudioContext (exportación rápida). Devuelve true si sonó algo. */
export async function mixMusic(oac, media, total) {
  const m = S.music;
  if (!m || m.missing || m.vol <= 0) return false;
  const md = media.get(m.mediaId);
  if (!md || !md.blob) return false;
  let buf;
  try {
    buf = await oac.decodeAudioData(await md.blob.arrayBuffer());
  } catch (e) {
    return false;
  }
  const src = oac.createBufferSource(),
    g = oac.createGain();
  src.buffer = buf;
  src.connect(g).connect(oac.destination);
  if (m.loop) {
    src.loop = true;
    src.loopStart = 0;
    src.loopEnd = buf.duration;
  }
  // Envolvente igual que musicGainAt(): rampas lineales de entrada y salida
  const fi = Math.min(m.fadeIn || 0, total / 2),
    fo = Math.min(m.fadeOut || 0, total / 2);
  g.gain.setValueAtTime(fi > 0 ? 0 : m.vol, 0);
  if (fi > 0) g.gain.linearRampToValueAtTime(m.vol, fi);
  if (fo > 0) {
    g.gain.setValueAtTime(m.vol, total - fo);
    g.gain.linearRampToValueAtTime(0, total);
  }
  const off = m.in % buf.duration;
  if (!m.loop && m.in >= buf.duration) return false;
  src.start(0, off);
  src.stop(total);
  return true;
}
