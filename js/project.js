import { $, S, nid, setAspect } from './state.js';
import { toast } from './util.js';
import { DEMOS } from './demo.js';
import { makeVid, wireAudio, once, seekTo, thumbFrom } from './clips.js';
import { layout } from './timeline.js';
import { pause } from './playback.js';
import { renderPanel, renderTabs } from './panel.js';
import { renderTimeline } from './timeline-ui.js';
import { openDB, dbGet, dbAll, dbPut, dbDel, getMeta, setMeta, isQuota, askPersist, estimate } from './store.js';

/* ---------- proyectos: serializar, guardar, abrir, deshacer ---------- */

// Campos de un clip que forman parte del proyecto (lo demás es estado de ejecución).
const CLIP_KEYS = ['id', 'name', 'kind', 'demoKey', 'mediaId', 'sw', 'sh', 'dur', 'in', 'out', 'trans', 'filter', 'mute', 'track', 'thumb'];
const HISTORY_MAX = 60;
const SAVE_DELAY = 700;

export const P = {
  ok: false,          // IndexedDB disponible
  project: null,      // { id, name, createdAt }
  media: new Map(),   // mediaId → { url, blob }
  undo: [], redo: [], snap: null,
  status: 'saved',    // saved | saving | dirty | error | off
  list: [], storage: null, confirmDel: null,
  saveTimer: null, saving: null,
};

/* --- serialización --- */
export function content() {
  return {
    v: 1, aspect: S.aspect,
    clips: S.clips.map(c => { const o = {}; for (const k of CLIP_KEYS) if (c[k] !== undefined) o[k] = c[k]; return o }),
    ovs: S.ovs,
  };
}
const snapshot = () => JSON.stringify(content());

/* --- reconstrucción de clips --- */
function dropClip(c) { if (c.el) { c.el.pause(); c.el.removeAttribute('src'); c.el.load(); c.el.remove() } }

export function buildClip(m) {
  const c = { ...m, trans: { ...m.trans }, track: m.track ? JSON.parse(JSON.stringify(m.track)) : null, _lastT: null, gain: null, el: null, missing: false };
  if (c.kind === 'demo') {
    const D = DEMOS[c.demoKey];
    c.draw = D ? D.fn : (() => { }); c.scv = document.createElement('canvas'); c.scv.width = c.sw; c.scv.height = c.sh; c.sg = c.scv.getContext('2d');
  } else {
    const md = P.media.get(c.mediaId);
    if (md && md.url) { c.el = makeVid(md.url); wireAudio(c) } else c.missing = true;
  }
  return c;
}

function hydrate(d) {
  const old = new Map(S.clips.map(c => [c.id, c]));
  S.clips = d.clips.map(m => {
    const c = old.get(m.id);
    if (c && c.kind === m.kind && c.mediaId === m.mediaId && c.demoKey === m.demoKey) {
      old.delete(m.id);
      Object.assign(c, m, { trans: { ...m.trans }, track: m.track ? JSON.parse(JSON.stringify(m.track)) : null, _lastT: null });
      if (!m.track) c.track = null;
      return c;
    }
    return buildClip(m);
  });
  for (const c of old.values()) dropClip(c);
  S.ovs = (d.ovs || []).map(o => ({ ...o }));
  setAspect(d.aspect || '16:9');
  if (!S.clips.some(c => c.id === S.sel)) S.sel = S.clips[0] ? S.clips[0].id : null;
  if (!S.ovs.some(o => o.id === S.selOv)) S.selOv = null;
  layout(); renderTimeline(); renderPanel();
}

/* --- historial --- */
/** Registra el estado actual como un paso de deshacer (si cambió) y programa el guardado. */
export function commit() {
  if (S.tracking || S.exporting) return;
  const s = snapshot();
  if (s === P.snap) return;
  if (P.snap !== null) { P.undo.push(P.snap); if (P.undo.length > HISTORY_MAX) P.undo.shift() }
  P.redo.length = 0; P.snap = s;
  updHistUI(); scheduleSave();
}
export function resetHistory() { P.undo.length = 0; P.redo.length = 0; P.snap = snapshot(); updHistUI() }
function canEdit() { if (S.tracking) { toast('Espera a que termine el rastreo'); return false } if (S.exporting) { toast('Espera a que termine la exportación'); return false } return true }
export function undo() {
  if (!P.undo.length || !canEdit()) return;
  commit(); if (!P.undo.length) return;
  pause(); P.redo.push(P.snap); P.snap = P.undo.pop(); hydrate(JSON.parse(P.snap)); updHistUI(); scheduleSave(); toast('Deshecho');
}
export function redo() {
  if (!P.redo.length || !canEdit()) return;
  pause(); P.undo.push(P.snap); P.snap = P.redo.pop(); hydrate(JSON.parse(P.snap)); updHistUI(); scheduleSave(); toast('Rehecho');
}
export function updHistUI() {
  const u = $('#bUndo'), r = $('#bRedo');
  if (u) u.disabled = !P.undo.length; if (r) r.disabled = !P.redo.length;
}

/* --- estado de guardado --- */
const STATUS = { saved: 'Guardado', saving: 'Guardando…', dirty: 'Cambios sin guardar', error: 'No se pudo guardar', off: 'Guardado no disponible en este navegador' };
function setStatus(s) {
  P.status = s; const el = $('#saveState'); if (!el) return;
  el.dataset.s = s; el.title = STATUS[s]; const t = $('#saveText'); if (t) t.textContent = STATUS[s];
}
export function updProjHeader() { const n = $('#projName'); if (n && P.project) n.textContent = P.project.name }

/* --- guardado --- */
export function scheduleSave() {
  if (!P.ok || !P.project) return;
  setStatus('dirty'); clearTimeout(P.saveTimer); P.saveTimer = setTimeout(saveNow, SAVE_DELAY);
}
export async function saveNow() {
  if (!P.ok || !P.project) return;
  clearTimeout(P.saveTimer);
  if (P.saving) { await P.saving; }
  setStatus('saving');
  const rec = {
    id: P.project.id, name: P.project.name, createdAt: P.project.createdAt, updatedAt: Date.now(),
    dur: S.total, clipsN: S.clips.length, thumb: (S.clips[0] && S.clips[0].thumb) || '',
    data: { ...content(), sel: S.sel, T: S.T, pps: S.pps },
  };
  P.saving = dbPut('projects', rec).then(() => { setStatus('saved'); setMeta('last', rec.id).catch(() => { }) })
    .catch(e => { setStatus('error'); toast(isQuota(e) ? 'No hay espacio para guardar el proyecto en este navegador' : 'No se pudo guardar el proyecto') })
    .finally(() => { P.saving = null });
  await P.saving;
  if (S.tab === 'projects') refreshList();
}

/** Guarda el archivo de video de un clip importado. */
export async function storeMedia(id, blob, name, url) {
  P.media.set(id, { url: url || URL.createObjectURL(blob), blob });
  if (!P.ok) return false;
  askPersist();
  try { await dbPut('media', { id, blob, name, type: blob.type, size: blob.size }); return true }
  catch (e) {
    toast(isQuota(e) ? `No hay espacio para guardar «${name}» en este navegador. Funciona en esta sesión, pero al reabrir tendrás que volver a vincularlo.` : `No se pudo guardar «${name}»`);
    return false;
  }
}

/* --- abrir / crear / duplicar / eliminar --- */
async function loadMediaFor(clips) {
  for (const m of clips) {
    if (m.kind !== 'video' || !m.mediaId || P.media.has(m.mediaId)) continue;
    try { const r = await dbGet('media', m.mediaId); if (r && r.blob) P.media.set(m.mediaId, { url: URL.createObjectURL(r.blob), blob: r.blob }) } catch (e) { }
  }
}
function clearAll() { pause(); for (const c of S.clips) dropClip(c); S.clips = []; S.ovs = []; S.sel = null; S.selOv = null; S.T = 0; S.pick = false; if (S.result) { URL.revokeObjectURL(S.result.url); S.result = null } }

export async function openProject(id) {
  if (!canEdit()) return false;
  const rec = await dbGet('projects', id).catch(() => null);
  if (!rec) { toast('Ese proyecto ya no existe'); refreshList(); return false }
  if (P.project && P.project.id !== id) await saveNow();
  clearAll();
  await loadMediaFor(rec.data.clips || []);
  P.project = { id: rec.id, name: rec.name, createdAt: rec.createdAt };
  S.sel = rec.data.sel || null; S.pps = rec.data.pps || S.pps;
  hydrate(rec.data);
  S.T = Math.min(rec.data.T || 0, S.total);
  resetHistory(); updProjHeader(); setStatus('saved'); setMeta('last', id).catch(() => { });
  const miss = S.clips.filter(c => c.missing).length;
  if (miss) toast(miss === 1 ? 'Falta 1 video: vuelve a vincularlo en Medios' : `Faltan ${miss} videos: vuelve a vincularlos en Medios`);
  return true;
}

const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export async function newProject(name = 'Proyecto sin título') {
  if (!canEdit()) return;
  if (P.project) await saveNow();
  clearAll(); setAspect('16:9');
  P.project = { id: newId(), name, createdAt: Date.now() };
  layout(); renderTimeline(); resetHistory(); updProjHeader();
  S.tab = 'media'; renderTabs(); renderPanel();
  await saveNow();
}

export async function duplicateProject() {
  if (!P.project || !canEdit()) return;
  await saveNow();
  P.project = { id: newId(), name: P.project.name + ' (copia)', createdAt: Date.now() };
  updProjHeader(); await saveNow(); renderPanel(); toast('Proyecto duplicado; ahora editas la copia');
}

export async function deleteProject(id) {
  if (!canEdit()) return;
  await dbDel('projects', id).catch(() => { });
  if (P.project && P.project.id === id) {
    const rest = (await dbAll('projects').catch(() => [])).sort((a, b) => b.updatedAt - a.updatedAt);
    P.project = null;
    if (rest.length) await openProject(rest[0].id); else await newProject();
  }
  await collectMedia();
  toast('Proyecto eliminado'); refreshList();
}

/** Borra los videos guardados que ya no usa ningún proyecto. */
async function collectMedia() {
  try {
    const used = new Set(S.clips.map(c => c.mediaId).filter(Boolean));
    for (const p of await dbAll('projects')) for (const c of p.data.clips || []) if (c.mediaId) used.add(c.mediaId);
    const d = await openDB();
    const keys = await new Promise((res, rej) => { const r = d.transaction('media').objectStore('media').getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error) });
    for (const k of keys) if (!used.has(k)) await dbDel('media', k);
  } catch (e) { }
}

export function renameProject(name) {
  if (!P.project) return;
  P.project.name = name.trim() || 'Proyecto sin título'; updProjHeader(); scheduleSave();
}

export async function refreshList() {
  if (!P.ok) { P.list = []; return }
  try { P.list = (await dbAll('projects')).sort((a, b) => b.updatedAt - a.updatedAt) } catch (e) { P.list = [] }
  P.storage = await estimate();
  if (S.tab === 'projects') renderPanel();
}

/* --- volver a vincular un video faltante --- */
export async function relink(clipId, file) {
  const c = S.clips.find(x => x.id === clipId); if (!c || !file) return;
  const mid = c.mediaId || nid();
  await storeMedia(mid, file, file.name);
  const url = P.media.get(mid).url;
  for (const k of S.clips.filter(x => x.mediaId === mid)) {
    k.el = makeVid(url); k.missing = false; wireAudio(k);
  }
  const el = S.clips.find(x => x.mediaId === mid).el;
  await once(el, 'loadedmetadata', 10000);
  if (el.duration && isFinite(el.duration)) {
    for (const k of S.clips.filter(x => x.mediaId === mid)) {
      k.sw = el.videoWidth || k.sw; k.sh = el.videoHeight || k.sh;
      if (Math.abs(el.duration - k.dur) > .05) { k.dur = el.duration; k.out = Math.min(k.out, k.dur); k.in = Math.min(k.in, k.out - .2) }
    }
    try { await seekTo(el, Math.min(.4, el.duration / 2)); const t = thumbFrom(el, c.sw, c.sh); if (t) S.clips.filter(x => x.mediaId === mid).forEach(k => k.thumb = t) } catch (e) { }
  }
  layout(); renderTimeline(); renderPanel(); commit(); scheduleSave(); toast('Video vinculado');
}

/* --- arranque --- */
/** Devuelve true si abrió un proyecto guardado; false si hay que crear el de ejemplo. */
export async function bootProjects() {
  try { await openDB(); P.ok = true } catch (e) { P.ok = false }
  if (!P.ok) { setStatus('off'); return false }
  const last = await getMeta('last').catch(() => null);
  if (last && await openProject(last)) return true;
  const all = await dbAll('projects').catch(() => []);
  if (all.length) { all.sort((a, b) => b.updatedAt - a.updatedAt); if (await openProject(all[0].id)) return true }
  return false;
}
/** Crea el registro del proyecto de ejemplo recién armado en memoria. */
export async function adoptCurrent(name) {
  P.project = { id: newId(), name, createdAt: Date.now() };
  updProjHeader(); resetHistory();
  if (P.ok) await saveNow(); else setStatus('off');
}

// Guardar al salir o al pasar a segundo plano
addEventListener('pagehide', () => { if (P.status === 'dirty') saveNow() });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && P.status === 'dirty') saveNow() });
