import { $, cv, panel, tlInner, tlScroll, S, nid, setAspect } from './state.js';
import { fmtS, toast, getSel, getOv } from './util.js';
import { coverOf, mapSrc, importFiles, cloneClip } from './clips.js';
import { layout, activeAt, localOf } from './timeline.js';
import { trackAt } from './render.js';
import { play, pause, seek } from './playback.js';
import { runTrack } from './tracker.js';
import { startExport, cancelExport, saveResult } from './export.js';
import { renderTabs, setTab, renderPanel } from './panel.js';
import { renderTimeline } from './timeline-ui.js';
import {
  P,
  commit,
  undo,
  redo,
  newProject,
  duplicateProject,
  openProject,
  deleteProject,
  renameProject,
  relink,
  refreshList,
  exportProjectFile,
  importProjectFile,
} from './project.js';

/* ---------- acciones ---------- */
export function selClip(id) {
  S.sel = id;
  S.selOv = null;
  S.pick = false;
  renderTimeline();
  renderPanel();
}
export function addOv(kind, extra) {
  const c = getSel();
  if (!c) {
    toast('Primero selecciona un clip');
    return;
  }
  const has = c.track && c.track.pts.length > 1;
  const o = {
    id: nid(),
    clipId: c.id,
    kind,
    text: '',
    font: 'impacto',
    style: 'outline',
    color: '#ffffff',
    size: 0.07,
    follow: false,
    x: 0.5,
    y: 0.5,
    t0: c.in,
    t1: c.out,
    anim: 'pop',
    ...extra,
  };
  if (o.follow && !has) {
    o.follow = false;
    o.x = 0.5;
    o.y = 0.4;
  }
  S.ovs.push(o);
  S.selOv = o.id;
  if (S.tab !== 'text') S.tab = 'text';
  renderTabs();
  renderTimeline();
  renderPanel();
  const ta = $('#k-ovtext');
  if (ta && kind === 'text') {
    ta.focus();
    ta.select();
  }
}
export function toggleFollow(o, on) {
  const c = S.clips.find(k => k.id === o.clipId);
  const local = activeAt(S.T).includes(c) ? localOf(c, S.T) : c.in;
  const tp = trackAt(c, local);
  if (!tp) return;
  const m = mapSrc(c, tp.x, tp.y);
  if (on) {
    o.x -= m.x / S.W;
    o.y -= m.y / S.H;
  } else {
    o.x += m.x / S.W;
    o.y += m.y / S.H;
  }
  o.follow = on;
}
export function doSplit() {
  const c = getSel();
  if (!c) {
    toast('Selecciona un clip para dividir');
    return;
  }
  const local = c.in + (S.T - c._start);
  if (S.T < c._start || local <= c.in + 0.1 || local >= c.out - 0.1) {
    toast('Coloca el cursor dentro del clip seleccionado');
    return;
  }
  const n = cloneClip(c);
  n.in = local;
  c.out = local;
  n.trans = { type: 'none', d: 0.5 };
  S.clips.splice(S.clips.indexOf(c) + 1, 0, n);
  S.ovs.filter(o => o.clipId === c.id).forEach(o => S.ovs.push({ ...o, id: nid(), clipId: n.id }));
  S.sel = n.id;
  S.selOv = null;
  renderTimeline();
  renderPanel();
  toast('Clip dividido');
}

export function act(a, el) {
  const [k, arg] = a.split(/:(.+)/);
  const c = getSel(),
    o = getOv();
  if (S.exporting && k !== 'cancelExport') return;
  switch (k) {
    case 'selclip':
      selClip(arg);
      break;
    case 'seltrans':
      S.sel = arg;
      S.selOv = null;
      S.tab = 'trans';
      renderTabs();
      renderTimeline();
      renderPanel();
      break;
    case 'selov': {
      const ov = S.ovs.find(x => x.id === arg);
      if (!ov) break;
      S.sel = ov.clipId;
      S.selOv = arg;
      const cc = getSel();
      if (cc && !activeAt(S.T).includes(cc)) seek(cc._start + Math.max(ov.t0, cc.in) - cc.in + 0.05);
      if (S.tab !== 'text') {
        S.tab = 'text';
        renderTabs();
      }
      renderTimeline();
      renderPanel();
      break;
    }
    case 'aspect':
      setAspect(arg);
      renderPanel();
      break;
    case 'clearDemo': {
      const ids = S.clips.filter(x => x.kind === 'demo').map(x => x.id);
      S.clips = S.clips.filter(x => x.kind !== 'demo');
      S.ovs = S.ovs.filter(x => !ids.includes(x.clipId));
      if (S.clips[0]) S.clips[0].trans = { type: 'none', d: 0.5 };
      S.sel = S.clips[0] ? S.clips[0].id : null;
      S.selOv = null;
      S.T = 0;
      renderTimeline();
      renderPanel();
      break;
    }
    case 'filter':
      c.filter = arg;
      renderPanel();
      break;
    case 'split':
      doSplit();
      break;
    case 'dup': {
      const n = cloneClip(c);
      n.trans = { type: 'fade', d: 0.5 };
      S.clips.splice(S.clips.indexOf(c) + 1, 0, n);
      S.ovs.filter(x => x.clipId === c.id).forEach(x => S.ovs.push({ ...x, id: nid(), clipId: n.id }));
      S.sel = n.id;
      renderTimeline();
      renderPanel();
      break;
    }
    case 'left':
    case 'right': {
      const i = S.clips.indexOf(c),
        j = k === 'left' ? i - 1 : i + 1;
      if (j < 0 || j >= S.clips.length) break;
      [S.clips[i], S.clips[j]] = [S.clips[j], S.clips[i]];
      if (S.clips[0].trans.type === 'none' && S.clips[1] && S.clips[1].trans.type === 'none')
        S.clips[1].trans = { type: 'fade', d: 0.5 };
      renderTimeline();
      renderPanel();
      break;
    }
    case 'mute':
      c.mute = !c.mute;
      renderPanel();
      break;
    case 'del': {
      const i = S.clips.indexOf(c);
      if (c.el) {
        c.el.pause();
        c.el.remove();
      }
      S.clips.splice(i, 1);
      S.ovs = S.ovs.filter(x => x.clipId !== c.id);
      const nx = S.clips[Math.min(i, S.clips.length - 1)];
      S.sel = nx ? nx.id : null;
      S.selOv = null;
      renderTimeline();
      renderPanel();
      toast('Clip eliminado');
      break;
    }
    case 'trans':
      c.trans.type = arg;
      renderTimeline();
      renderPanel();
      break;
    case 'transAll':
      S.clips.forEach((x, i) => {
        if (i) x.trans = { ...c.trans };
      });
      renderTimeline();
      toast('Transición aplicada a todos los cortes');
      break;
    case 'previewTrans':
      layout();
      seek(Math.max(0, c._start - 0.8));
      play();
      break;
    case 'pick':
      S.pick = !S.pick;
      if (S.pick) {
        pause();
        if (!activeAt(S.T).includes(c)) seek(c._start + Math.min(0.5, c._len / 2));
      }
      renderPanel();
      break;
    case 'track':
      runTrack(c);
      break;
    case 'cancelTrack':
      S.trackCancel = true;
      break;
    case 'clearTrack':
      c.track = null;
      S.ovs.forEach(x => {
        if (x.clipId === c.id && x.follow) {
          x.follow = false;
          x.x = 0.5;
          x.y = 0.5;
        }
      });
      renderTimeline();
      renderPanel();
      break;
    case 'followText':
      addOv('text', {
        text: 'Aquí',
        font: 'limpia',
        style: 'box',
        color: '#f1a93b',
        size: 0.045,
        follow: true,
        x: 0,
        y: -0.13,
      });
      break;
    case 'addText':
      addOv('text', { text: 'Escribe aquí', y: 0.78 });
      break;
    case 'addRing': {
      const has = c && c.track && c.track.pts.length > 1;
      addOv('ring', { color: '#f1a93b', size: 0.08, follow: !!has, x: has ? 0 : 0.5, y: has ? 0 : 0.5 });
      break;
    }
    case 'addSticker':
      addOv('sticker', { text: arg, size: 0.08, x: 0.82, y: 0.22 });
      break;
    case 'font':
      o.font = arg;
      renderPanel();
      break;
    case 'style':
      o.style = arg;
      renderPanel();
      break;
    case 'color':
      o.color = arg;
      renderPanel();
      break;
    case 'anim':
      o.anim = arg;
      renderPanel();
      break;
    case 'ovFrom':
    case 'ovTo':
    case 'ovAll': {
      const cc = S.clips.find(x => x.id === o.clipId);
      const l = activeAt(S.T).includes(cc) ? localOf(cc, S.T) : null;
      if (k === 'ovAll') {
        o.t0 = cc.in;
        o.t1 = cc.out;
      } else if (l == null) {
        toast('Coloca el cursor dentro de este clip');
        break;
      } else if (k === 'ovFrom') o.t0 = Math.min(l, o.t1 - 0.1);
      else o.t1 = Math.max(l, o.t0 + 0.1);
      renderTimeline();
      renderPanel();
      break;
    }
    case 'delOv':
      S.ovs = S.ovs.filter(x => x !== o);
      S.selOv = null;
      renderTimeline();
      renderPanel();
      break;
    case 'export':
      startExport();
      break;
    case 'cancelExport':
      cancelExport();
      break;
    case 'save':
      saveResult();
      break;
    case 'undo':
      undo();
      break;
    case 'redo':
      redo();
      break;
    case 'newProject':
      newProject();
      break;
    case 'dupProject':
      duplicateProject();
      break;
    case 'openProj':
      openProject(arg).then(ok => {
        if (ok) {
          refreshList();
          toast('Proyecto abierto');
        }
      });
      break;
    case 'delProj':
      if (P.confirmDel === arg) {
        P.confirmDel = null;
        deleteProject(arg);
      } else {
        P.confirmDel = arg;
        renderPanel();
        clearTimeout(P.confirmT);
        P.confirmT = setTimeout(() => {
          P.confirmDel = null;
          if (S.tab === 'projects') renderPanel();
        }, 4000);
      }
      break;
    case 'exportProj':
      exportProjectFile();
      break;
    case 'relink': {
      const inp = $('#relinkIn');
      if (inp) {
        inp.dataset.clip = arg;
        inp.click();
      }
      break;
    }
  }
  commit();
}

document.addEventListener('click', e => {
  const t = e.target.closest('[data-tab]');
  if (t) {
    setTab(t.dataset.tab);
    return;
  }
  const b = e.target.closest('[data-act]');
  if (b && !b.disabled) act(b.dataset.act, b);
});
panel.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fileIn') {
    importFiles(t.files);
    t.value = '';
    return;
  }
  if (t.id === 'rastroIn') {
    const f = t.files[0];
    if (f) importProjectFile(f);
    t.value = '';
    return;
  }
  if (t.id === 'relinkIn') {
    const f = t.files[0];
    if (f) relink(t.dataset.clip, f);
    t.value = '';
    return;
  }
  if (t.dataset.k === 'pname') {
    renameProject(t.value);
    return;
  }
  if (t.dataset.k === 'path') {
    S.showPath = t.checked;
  }
  if (t.dataset.k === 'follow') {
    const o = getOv();
    if (o) toggleFollow(o, t.checked);
    renderTimeline();
  }
  commit();
});
panel.addEventListener('input', e => {
  const t = e.target,
    k = t.dataset.k;
  if (!k) return;
  const c = getSel(),
    o = getOv(),
    v = t.value;
  if (k === 'pname') {
    renameProject(v);
    return;
  }
  if (k === 'in') {
    c.in = Math.min(+v, c.out - 0.2);
    t.value = c.in;
    $('#o-in').textContent = fmtS(c.in);
    renderTimeline();
    seek(c._start);
  } else if (k === 'out') {
    c.out = Math.max(+v, c.in + 0.2);
    t.value = c.out;
    $('#o-out').textContent = fmtS(c.out);
    renderTimeline();
    seek(c._start + c._len - 0.04);
  } else if (k === 'tdur') {
    c.trans.d = +v;
    $('#o-tdur').textContent = fmtS(c.trans.d);
    renderTimeline();
  } else if (k === 'ovtext' && o) {
    o.text = v;
    renderTimeline();
  } else if (k === 'ovsize' && o) {
    o.size = +v;
    $('#o-ovsize').textContent = Math.round(o.size * 100);
  }
});

/* transporte y zoom */
$('#bPlay').addEventListener('click', () => {
  if (S.exporting) return;
  S.playing ? pause() : play();
});
$('#bStart').addEventListener('click', () => {
  if (S.exporting) return;
  pause();
  seek(0);
  tlScroll.scrollLeft = 0;
});
$('#bSplit').addEventListener('click', () => {
  if (!S.exporting) {
    doSplit();
    commit();
  }
});
$('#zIn').addEventListener('click', () => {
  S.pps = Math.min(220, S.pps * 1.35);
  renderTimeline();
});
$('#zOut').addEventListener('click', () => {
  S.pps = Math.max(18, S.pps / 1.35);
  renderTimeline();
});
document.addEventListener('keydown', e => {
  const typing =
    /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !typing) {
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if ((k === 'z' && e.shiftKey) || k === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (k === 's') {
      e.preventDefault();
      commit();
      toast(P.ok ? 'Proyecto guardado' : 'Guardado no disponible en este navegador');
      return;
    }
  }
});
document.addEventListener('keydown', e => {
  if (e.code !== 'Space' || /INPUT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) return;
  e.preventDefault();
  if (!S.exporting) S.playing ? pause() : play();
});

/* scrub en la línea de tiempo */
export let scrub = false;
export const tlTime = e => (e.clientX - tlInner.getBoundingClientRect().left - 12) / S.pps;
tlInner.addEventListener('pointerdown', e => {
  if (S.exporting || e.target.closest('.clip,.tbtn,.ovb')) return;
  scrub = true;
  pause();
  seek(tlTime(e));
  tlInner.setPointerCapture(e.pointerId);
});
tlInner.addEventListener('pointermove', e => {
  if (scrub) seek(tlTime(e));
});
tlInner.addEventListener('pointerup', () => (scrub = false));
tlInner.addEventListener('pointercancel', () => (scrub = false));

/* interacción con la vista previa */
export const toCanvas = e => {
  const r = cv.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * S.W, y: ((e.clientY - r.top) / r.height) * S.H };
};
cv.addEventListener('pointerdown', e => {
  if (S.exporting) return;
  const p = toCanvas(e);
  const act = activeAt(S.T);
  if (S.pick) {
    let c = getSel();
    if (!act.includes(c)) c = act[act.length - 1];
    if (!c) return;
    const m = coverOf(c),
      nx = (p.x - m.dx) / m.dw,
      ny = (p.y - m.dy) / m.dh;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    S.sel = c.id;
    c.track = { seed: { t: localOf(c, S.T), x: nx, y: ny }, pts: [] };
    S.pick = false;
    renderTimeline();
    renderPanel();
    commit();
    toast('Punto marcado. Ahora toca Rastrear.');
    return;
  }
  for (let i = S.hits.length - 1; i >= 0; i--) {
    const h = S.hits[i];
    if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) {
      pause();
      const changed = S.selOv !== h.o.id;
      S.sel = h.c.id;
      S.selOv = h.o.id;
      S.drag = { o: h.o, sx: h.o.x, sy: h.o.y, px: p.x, py: p.y };
      cv.setPointerCapture(e.pointerId);
      if (changed) {
        if (S.tab !== 'text') {
          S.tab = 'text';
          renderTabs();
        }
        renderTimeline();
        renderPanel();
      }
      return;
    }
  }
  if (act.length) {
    const c = act[act.length - 1];
    if (c.id !== S.sel || S.selOv) selClip(c.id);
  }
});
cv.addEventListener('pointermove', e => {
  if (!S.drag) return;
  const p = toCanvas(e),
    d = S.drag;
  d.o.x = d.sx + (p.x - d.px) / S.W;
  d.o.y = d.sy + (p.y - d.py) / S.H;
});
export const endDrag = () => {
  if (S.drag) {
    S.drag = null;
    commit();
  }
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
