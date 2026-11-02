import { $, S, nid, setAspect } from './state.js';
import { DEMOS } from './demo.js';
import { makeVid, wireAudio, once, seekTo, thumbFrom } from './clips.js';
import { layout } from './timeline.js';
import { pause } from './playback.js';
import { renderPanel, renderTabs } from './panel.js';
import { renderTimeline } from './timeline-ui.js';
import { zip, unzip } from './archive.js';
import { musicData, attachMusic, dropMusicEl } from './music.js';
import { toast, saveBlob } from './util.js';
import { openDB, dbGet, dbAll, dbPut, dbDel, getMeta, setMeta, isQuota, askPersist, estimate } from './store.js';

/* ---------- proyectos: serializar, guardar, abrir, deshacer ---------- */

// Campos de un clip que forman parte del proyecto (lo demás es estado de ejecución).
const CLIP_KEYS = [
  'id',
  'name',
  'kind',
  'demoKey',
  'mediaId',
  'sw',
  'sh',
  'dur',
  'in',
  'out',
  'trans',
  'filter',
  'mute',
  'track',
  'thumb',
  'vol', // volumen del clip (0–2); sin valor = 1
];
const HISTORY_MAX = 60;
const SAVE_DELAY = 700;

export const P = {
  ok: false, // IndexedDB disponible
  project: null, // { id, name, createdAt }
  media: new Map(), // mediaId → { url, blob }
  undo: [],
  redo: [],
  snap: null,
  status: 'saved', // saved | saving | dirty | error | off
  list: [],
  storage: null,
  confirmDel: null,
  saveTimer: null,
  saving: null,
  gcTimer: null,
  file: null, // { label, p } mientras se arma o se abre un archivo .rastro
};

/* --- serialización --- */
export function content() {
  return {
    v: 1,
    aspect: S.aspect,
    clips: S.clips.map(c => {
      const o = {};
      for (const k of CLIP_KEYS) if (c[k] !== undefined) o[k] = c[k];
      return o;
    }),
    ovs: S.ovs,
    music: musicData(),
  };
}
const snapshot = () => JSON.stringify(content());

/* --- reconstrucción de clips --- */
function dropClip(c) {
  if (c.el) {
    c.el.pause();
    c.el.removeAttribute('src');
    c.el.load();
    c.el.remove();
  }
}

export function buildClip(m) {
  const c = {
    ...m,
    trans: { ...m.trans },
    track: m.track ? JSON.parse(JSON.stringify(m.track)) : null,
    _lastT: null,
    gain: null,
    el: null,
    missing: false,
  };
  if (c.kind === 'demo') {
    const D = DEMOS[c.demoKey];
    c.draw = D ? D.fn : () => {};
    c.scv = document.createElement('canvas');
    c.scv.width = c.sw;
    c.scv.height = c.sh;
    c.sg = c.scv.getContext('2d');
  } else {
    const md = P.media.get(c.mediaId);
    if (md && md.url) {
      c.el = makeVid(md.url);
      wireAudio(c);
    } else c.missing = true;
  }
  return c;
}

function hydrate(d) {
  const old = new Map(S.clips.map(c => [c.id, c]));
  S.clips = d.clips.map(m => {
    const c = old.get(m.id);
    if (c && c.kind === m.kind && c.mediaId === m.mediaId && c.demoKey === m.demoKey) {
      old.delete(m.id);
      // Los campos guardados que no están en m (p. ej. vol por defecto) se quitan: si no, deshacer no los revierte
      for (const k of CLIP_KEYS) if (!(k in m)) delete c[k];
      Object.assign(c, m, {
        trans: { ...m.trans },
        track: m.track ? JSON.parse(JSON.stringify(m.track)) : null,
        _lastT: null,
      });
      if (!m.track) c.track = null;
      return c;
    }
    return buildClip(m);
  });
  for (const c of old.values()) dropClip(c);
  S.ovs = (d.ovs || []).map(o => ({ ...o }));
  S.music = d.music ? { ...d.music } : null;
  attachMusic(P.media);
  setAspect(d.aspect || '16:9');
  if (!S.clips.some(c => c.id === S.sel)) S.sel = S.clips[0] ? S.clips[0].id : null;
  if (!S.ovs.some(o => o.id === S.selOv)) S.selOv = null;
  layout();
  renderTimeline();
  renderPanel();
}

/* --- historial --- */
/** Registra el estado actual como un paso de deshacer (si cambió) y programa el guardado. */
export function commit() {
  if (S.tracking || S.exporting) return;
  const s = snapshot();
  if (s === P.snap) return;
  if (P.snap !== null) {
    P.undo.push(P.snap);
    if (P.undo.length > HISTORY_MAX) P.undo.shift();
  }
  P.redo.length = 0;
  P.snap = s;
  updHistUI();
  scheduleSave();
}
export function resetHistory() {
  P.undo.length = 0;
  P.redo.length = 0;
  P.snap = snapshot();
  updHistUI();
  // Al descartar el historial, los videos de clips borrados ya no se pueden recuperar con deshacer
  clearTimeout(P.gcTimer);
  P.gcTimer = setTimeout(collectMedia, 3000);
}
function canEdit() {
  if (S.tracking) {
    toast('Espera a que termine el rastreo');
    return false;
  }
  if (S.exporting) {
    toast('Espera a que termine la exportación');
    return false;
  }
  return true;
}
export function undo() {
  if (!P.undo.length || !canEdit()) return;
  commit();
  if (!P.undo.length) return;
  pause();
  P.redo.push(P.snap);
  P.snap = P.undo.pop();
  hydrate(JSON.parse(P.snap));
  updHistUI();
  scheduleSave();
  toast('Deshecho');
}
export function redo() {
  if (!P.redo.length || !canEdit()) return;
  pause();
  P.undo.push(P.snap);
  P.snap = P.redo.pop();
  hydrate(JSON.parse(P.snap));
  updHistUI();
  scheduleSave();
  toast('Rehecho');
}
export function updHistUI() {
  const u = $('#bUndo'),
    r = $('#bRedo');
  if (u) u.disabled = !P.undo.length;
  if (r) r.disabled = !P.redo.length;
}

/* --- estado de guardado --- */
const STATUS = {
  saved: 'Guardado',
  saving: 'Guardando…',
  dirty: 'Cambios sin guardar',
  error: 'No se pudo guardar',
  off: 'Guardado no disponible en este navegador',
};
function setStatus(s) {
  P.status = s;
  const el = $('#saveState');
  if (!el) return;
  el.dataset.s = s;
  el.title = STATUS[s];
  const t = $('#saveText');
  if (t) t.textContent = STATUS[s];
}
export function updProjHeader() {
  const n = $('#projName');
  if (n && P.project) n.textContent = P.project.name;
}

/* --- guardado --- */
export function scheduleSave() {
  if (!P.ok || !P.project) return;
  setStatus('dirty');
  clearTimeout(P.saveTimer);
  P.saveTimer = setTimeout(saveNow, SAVE_DELAY);
}
export async function saveNow() {
  if (!P.ok || !P.project) return;
  clearTimeout(P.saveTimer);
  if (P.saving) {
    await P.saving;
  }
  setStatus('saving');
  const rec = {
    id: P.project.id,
    name: P.project.name,
    createdAt: P.project.createdAt,
    updatedAt: Date.now(),
    dur: S.total,
    clipsN: S.clips.length,
    thumb: (S.clips[0] && S.clips[0].thumb) || '',
    data: { ...content(), sel: S.sel, T: S.T, pps: S.pps },
  };
  P.saving = dbPut('projects', rec)
    .then(() => {
      setStatus('saved');
      setMeta('last', rec.id).catch(() => {});
    })
    .catch(e => {
      setStatus('error');
      toast(
        isQuota(e) ? 'No hay espacio para guardar el proyecto en este navegador' : 'No se pudo guardar el proyecto'
      );
    })
    .finally(() => {
      P.saving = null;
    });
  await P.saving;
  if (S.tab === 'projects') refreshList();
}

/** Guarda el archivo de video de un clip importado. */
export async function storeMedia(id, blob, name, url) {
  P.media.set(id, { url: url || URL.createObjectURL(blob), blob });
  if (!P.ok) return false;
  askPersist();
  try {
    await dbPut('media', { id, blob, name, type: blob.type, size: blob.size, at: Date.now() });
    return true;
  } catch (e) {
    toast(
      isQuota(e)
        ? `No hay espacio para guardar «${name}» en este navegador. Funciona en esta sesión, pero al reabrir tendrás que volver a vincularlo.`
        : `No se pudo guardar «${name}»`
    );
    return false;
  }
}

/* --- abrir / crear / duplicar / eliminar --- */
async function loadMediaFor(clips) {
  for (const m of clips) {
    if (!m || !m.mediaId || P.media.has(m.mediaId)) continue; // videos y música
    try {
      const r = await dbGet('media', m.mediaId);
      if (r && r.blob) P.media.set(m.mediaId, { url: URL.createObjectURL(r.blob), blob: r.blob });
    } catch (e) {}
  }
}
function clearAll() {
  pause();
  for (const c of S.clips) dropClip(c);
  S.clips = [];
  dropMusicEl();
  S.music = null;
  S.ovs = [];
  S.sel = null;
  S.selOv = null;
  S.T = 0;
  S.pick = false;
  if (S.result) {
    URL.revokeObjectURL(S.result.url);
    S.result = null;
  }
}

export async function openProject(id) {
  if (!canEdit()) return false;
  const rec = await dbGet('projects', id).catch(() => null);
  if (!rec) {
    toast('Ese proyecto ya no existe');
    refreshList();
    return false;
  }
  if (P.project && P.project.id !== id) await saveNow();
  await loadRecord(rec);
  return true;
}

/** Reemplaza el proyecto abierto por el registro dado (de IndexedDB o de un archivo .rastro). */
async function loadRecord(rec) {
  clearAll();
  await loadMediaFor([...(rec.data.clips || []), rec.data.music]);
  P.project = { id: rec.id, name: rec.name, createdAt: rec.createdAt };
  S.sel = rec.data.sel || null;
  S.pps = rec.data.pps || S.pps;
  hydrate(rec.data);
  S.T = Math.min(rec.data.T || 0, S.total);
  resetHistory();
  updProjHeader();
  setStatus(P.ok ? 'saved' : 'off');
  if (P.ok) setMeta('last', rec.id).catch(() => {});
  const miss = S.clips.filter(c => c.missing).length;
  if (miss)
    toast(
      miss === 1
        ? 'Falta 1 video: vuelve a vincularlo en Medios'
        : `Faltan ${miss} videos: vuelve a vincularlos en Medios`
    );
}

const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export async function newProject(name = 'Proyecto sin título') {
  if (!canEdit()) return;
  if (P.project) await saveNow();
  clearAll();
  setAspect('16:9');
  P.project = { id: newId(), name, createdAt: Date.now() };
  layout();
  renderTimeline();
  resetHistory();
  updProjHeader();
  S.tab = 'media';
  renderTabs();
  renderPanel();
  await saveNow();
}

export async function duplicateProject() {
  if (!P.project || !canEdit()) return;
  await saveNow();
  P.project = { id: newId(), name: P.project.name + ' (copia)', createdAt: Date.now() };
  updProjHeader();
  await saveNow();
  renderPanel();
  toast('Proyecto duplicado; ahora editas la copia');
}

export async function deleteProject(id) {
  if (!canEdit()) return;
  await dbDel('projects', id).catch(() => {});
  if (P.project && P.project.id === id) {
    const rest = (await dbAll('projects').catch(() => [])).sort((a, b) => b.updatedAt - a.updatedAt);
    P.project = null;
    if (rest.length) await openProject(rest[0].id);
    else await newProject();
  }
  await collectMedia();
  toast('Proyecto eliminado');
  refreshList();
}

/** Borra los videos guardados que ya no usa ningún proyecto ni el historial de deshacer abierto.
 *  Los recién guardados se respetan un rato: otra pestaña puede estar importándolos sin haber guardado aún. */
const MEDIA_GRACE = 10 * 60 * 1000;
// Videos y música que usa un proyecto (data = content() o los datos guardados)
const idsIn = d => [...((d && d.clips) || []), d && d.music].map(c => c && c.mediaId).filter(Boolean);
export async function collectMedia() {
  if (!P.ok) return 0;
  let n = 0;
  try {
    const used = new Set(idsIn(content()));
    for (const snap of [P.snap, ...P.undo, ...P.redo]) if (snap) for (const id of idsIn(JSON.parse(snap))) used.add(id);
    for (const p of await dbAll('projects')) for (const id of idsIn(p.data)) used.add(id);
    const now = Date.now();
    for (const m of await dbAll('media')) {
      if (used.has(m.id) || (m.at && now - m.at < MEDIA_GRACE)) continue;
      await dbDel('media', m.id);
      const md = P.media.get(m.id);
      if (md) {
        URL.revokeObjectURL(md.url);
        P.media.delete(m.id);
      }
      n++;
    }
  } catch (e) {}
  return n;
}

export function renameProject(name) {
  if (!P.project) return;
  P.project.name = name.trim() || 'Proyecto sin título';
  updProjHeader();
  scheduleSave();
}

export async function refreshList() {
  if (!P.ok) {
    P.list = [];
    return;
  }
  try {
    P.list = (await dbAll('projects')).sort((a, b) => b.updatedAt - a.updatedAt);
  } catch (e) {
    P.list = [];
  }
  P.storage = await estimate();
  if (S.tab === 'projects') renderPanel();
}

/* --- archivo .rastro: el proyecto con sus videos, para moverlo entre equipos ---
   Es un zip con project.json y media/<id>.<ext>. */
const RASTRO_V = 2; // 2: música de fondo y volumen por clip (los archivos v1 se leen igual)
const extOf = (name, type) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(name || '');
  return m ? m[1].toLowerCase() : /mp4/.test(type) ? 'mp4' : /quicktime/.test(type) ? 'mov' : 'webm';
};
// Sin tildes ni caracteres raros: algunos navegadores ignoran el nombre si no es ASCII
const safeName = s =>
  (s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\w .()-]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim() || 'proyecto';
function setFile(label, p) {
  P.file = label ? { label, p } : null;
  if (S.tab === 'projects') renderPanel();
}

export async function exportProjectFile() {
  if (!P.project || P.file || !canEdit()) return;
  if (P.ok) await saveNow();
  setFile('Preparando archivo…', 0);
  try {
    const media = [],
      entries = [],
      seen = new Set();
    let missing = 0;
    const sources = [...S.clips.filter(c => c.kind === 'video'), ...(S.music ? [S.music] : [])];
    for (const c of sources) {
      if (!c.mediaId || seen.has(c.mediaId)) continue;
      seen.add(c.mediaId);
      const md = P.media.get(c.mediaId);
      if (!md || !md.blob) {
        missing++;
        continue;
      }
      const rec = P.ok ? await dbGet('media', c.mediaId).catch(() => null) : null;
      const name = (rec && rec.name) || c.name,
        type = md.blob.type || (rec && rec.type) || '';
      const file = `media/${c.mediaId}.${extOf(name, type)}`;
      media.push({ id: c.mediaId, name, type, file });
      entries.push({ name: file, data: md.blob });
    }
    const doc = {
      format: 'rastro',
      v: RASTRO_V,
      exportedAt: Date.now(),
      name: P.project.name,
      createdAt: P.project.createdAt,
      data: { ...content(), sel: S.sel, T: S.T, pps: S.pps },
      media,
    };
    entries.unshift({ name: 'project.json', data: JSON.stringify(doc) });
    const blob = await zip(entries, p => setFile('Preparando archivo…', p));
    setFile(null);
    const msg = await saveBlob(blob, safeName(P.project.name) + '.rastro');
    toast(missing ? `${msg} Sin ${missing === 1 ? '1 video que falta' : missing + ' videos que faltan'}.` : msg);
  } catch (e) {
    setFile(null);
    toast(
      e && e.message === 'too-big'
        ? 'El proyecto pesa más de 4 GB: es demasiado grande para un archivo .rastro'
        : 'No se pudo preparar el archivo del proyecto'
    );
  }
}

export async function importProjectFile(file) {
  if (!file || P.file) return;
  setFile('Abriendo archivo…', 0);
  // En un equipo nuevo, el proyecto de ejemplo se rastrea al arrancar: se espera en vez de rechazar
  while (S.tracking) await new Promise(r => setTimeout(r, 150));
  if (!canEdit()) return setFile(null);
  let doc, entries;
  try {
    entries = await unzip(file);
    doc = JSON.parse(await entries.get('project.json').text());
    if (doc.format !== 'rastro' || !doc.data || !Array.isArray(doc.data.clips)) throw new Error('not-rastro');
  } catch (e) {
    setFile(null);
    toast(
      e && e.message === 'unsupported'
        ? 'Este archivo usa un formato de zip que el editor no puede leer'
        : 'Este archivo no es un proyecto .rastro'
    );
    return;
  }
  if (doc.v > RASTRO_V) toast('El archivo es de una versión más nueva del editor; puede que algo no se vea igual');
  if (P.project && P.ok) await saveNow();
  const list = doc.media || [];
  let i = 0;
  for (const m of list) {
    const b = m && m.id && entries.get(m.file);
    if (b) await storeMedia(m.id, new Blob([b], { type: m.type || b.type }), m.name || m.id);
    setFile('Abriendo archivo…', ++i / list.length);
  }
  // Siempre como proyecto nuevo: abrir el mismo archivo dos veces no pisa nada
  const taken = new Set(P.list.map(p => p.name));
  let name = doc.name || 'Proyecto importado';
  if (taken.has(name)) name += ' (importado)';
  const rec = { id: newId(), name, createdAt: doc.createdAt || Date.now(), data: doc.data };
  await loadRecord(rec);
  setFile(null);
  if (P.ok) await saveNow();
  S.tab = 'projects';
  renderTabs();
  refreshList();
  renderPanel();
  toast('Proyecto abierto: ' + name);
}

/* --- volver a vincular un video faltante --- */
export async function relink(clipId, file) {
  const c = S.clips.find(x => x.id === clipId);
  if (!c || !file) return;
  const mid = c.mediaId || nid();
  await storeMedia(mid, file, file.name);
  const url = P.media.get(mid).url;
  for (const k of S.clips.filter(x => x.mediaId === mid)) {
    k.el = makeVid(url);
    k.missing = false;
    wireAudio(k);
  }
  const el = S.clips.find(x => x.mediaId === mid).el;
  await once(el, 'loadedmetadata', 10000);
  if (el.duration && isFinite(el.duration)) {
    for (const k of S.clips.filter(x => x.mediaId === mid)) {
      k.sw = el.videoWidth || k.sw;
      k.sh = el.videoHeight || k.sh;
      if (Math.abs(el.duration - k.dur) > 0.05) {
        k.dur = el.duration;
        k.out = Math.min(k.out, k.dur);
        k.in = Math.min(k.in, k.out - 0.2);
      }
    }
    try {
      await seekTo(el, Math.min(0.4, el.duration / 2));
      const t = thumbFrom(el, c.sw, c.sh);
      if (t) S.clips.filter(x => x.mediaId === mid).forEach(k => (k.thumb = t));
    } catch (e) {}
  }
  layout();
  renderTimeline();
  renderPanel();
  commit();
  scheduleSave();
  toast('Video vinculado');
}

/* --- arranque --- */
/** Devuelve true si abrió un proyecto guardado; false si hay que crear el de ejemplo. */
export async function bootProjects() {
  try {
    await openDB();
    P.ok = true;
  } catch (e) {
    P.ok = false;
  }
  if (!P.ok) {
    setStatus('off');
    return false;
  }
  const last = await getMeta('last').catch(() => null);
  if (last && (await openProject(last))) return true;
  const all = await dbAll('projects').catch(() => []);
  if (all.length) {
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    if (await openProject(all[0].id)) return true;
  }
  return false;
}
/** Crea el registro del proyecto de ejemplo recién armado en memoria. */
export async function adoptCurrent(name) {
  P.project = { id: newId(), name, createdAt: Date.now() };
  updProjHeader();
  resetHistory();
  if (P.ok) await saveNow();
  else setStatus('off');
}

// Guardar al salir o al pasar a segundo plano
addEventListener('pagehide', () => {
  if (P.status === 'dirty') saveNow();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && P.status === 'dirty') saveNow();
});
