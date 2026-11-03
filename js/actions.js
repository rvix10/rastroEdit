import { $, cv, panel, tlInner, tlScroll, S, nid, setAspect } from './state.js';
import { clamp, fmtS, toast, getSel, getOv } from './util.js';
import { coverOf, mapSrc, importFiles, cloneClip } from './clips.js';
import { layout, activeAt, localOf } from './timeline.js';
import { ovPos, ovSetAbs, editableMarks } from './render.js';
import { play, pause, seek } from './playback.js';
import { runTrack } from './tracker.js';
import { startExport, cancelExport, saveResult, setExportOpt } from './export.js';
import { renderTabs, setTab, renderPanel, markWelcome } from './panel.js';
import { renderTimeline } from './timeline-ui.js';
import { zoomAt } from './timeline-touch.js';
import { importMusic, attachMusic, MUSIC_ACCEPT } from './music.js';
import { promptInstall } from './pwa.js';
import { setTheme, toggleTheme } from './theme.js';
import { orderQuad, quadCenter, quadArea, quadConvex } from './planar.js';
import { deviceInfo, codecSupport, benchmark, reportText } from './diag.js';
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
  storeMedia,
} from './project.js';

/* ---------- acciones ---------- */
/** Diagnóstico del dispositivo (Proyectos → Este dispositivo). Con bench, también mide el rendimiento. */
async function runDiag(bench) {
  if (S.diag && S.diag.running) return;
  if (bench && (S.exporting || S.tracking))
    return toast('Espera a que termine ' + (S.exporting ? 'la exportación' : 'el rastreo'));
  const prev = S.diag || {};
  S.diag = { ...prev, running: true, step: 'Revisando el dispositivo…', p: 0 };
  renderPanel();
  try {
    const info = await deviceInfo(),
      codecs = await codecSupport();
    S.diag = { ...S.diag, info, codecs };
    if (bench)
      S.diag.bench = await benchmark((step, p) => {
        Object.assign(S.diag, { step, p });
        if (S.tab === 'projects') renderPanel();
      });
  } catch (e) {
    toast('No se pudo completar el diagnóstico');
  }
  S.diag.running = false;
  if (S.tab === 'projects') renderPanel();
}
const UNDO = { label: 'Deshacer', act: 'undo' };
export function selClip(id) {
  S.sel = id;
  S.selOv = null;
  S.pick = false;
  S.pickFirst = null;
  S.pickQuad = null;
  const c = getSel();
  if (c && c.track && c.track.seed) S.trackPts = c.track.quad ? 4 : c.track.seed2 ? 2 : 1;
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
// Tiempo local del clip del overlay en el cursor (o su inicio si el cursor está en otro clip)
function ovLocal(o) {
  const c = S.clips.find(k => k.id === o.clipId);
  return { c, local: activeAt(S.T).includes(c) ? localOf(c, S.T) : c.in };
}
/** Cambia opciones de seguimiento sin que el elemento salte de lugar en el cuadro actual. */
export function setFollow(o, patch) {
  const { c, local } = ovLocal(o);
  if (!c) return;
  const abs = ovPos(o, c, local);
  Object.assign(o, patch);
  ovSetAbs(o, c, local, abs.x, abs.y);
}
export function toggleFollow(o, on) {
  const { c } = ovLocal(o);
  if (!c || !c.track || c.track.pts.length < 2) return;
  setFollow(o, { follow: on });
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
  if (S.exporting && !['cancelExport', 'theme', 'themeSet'].includes(k)) return;
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
      if (S.clips.some(x => x.kind === 'demo' && x.id === S.tracking)) S.trackCancel = true; // deja de rastrear lo que se quita
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
      if (c && c.id === S.tracking) S.trackCancel = true;
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
      toast('Clip eliminado', UNDO);
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
    case 'trackPts':
      S.trackPts = arg === '4' ? 4 : arg === '2' ? 2 : 1;
      S.pickFirst = null;
      S.pickQuad = null;
      renderPanel();
      break;
    case 'pick':
      S.pick = !S.pick;
      S.pickFirst = null;
      S.pickQuad = null;
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
      S.pickFirst = null;
      S.pickQuad = null;
      S.ovs = S.ovs.filter(x => !(x.clipId === c.id && x.kind === 'area')); // sin plano no hay área
      if (S.selOv && !S.ovs.some(x => x.id === S.selOv)) S.selOv = null;
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
    case 'addArea':
      // Área del plano rastreado (terreno, cancha…) con su etiqueta en el centro
      if (!c || !c.track || !c.track.quad || c.track.pts.length < 2) break;
      addOv('area', {
        text: 'Lote 1',
        font: 'limpia',
        style: 'box',
        color: '#ffd84d',
        size: 0.045,
        fill: 0.3,
        follow: true,
        x: 0,
        y: 0,
        followRot: false,
        followScale: false,
      });
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
      toast('Elemento eliminado', UNDO);
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
    case 'install':
      promptInstall();
      break;
    case 'theme':
      toggleTheme();
      break;
    case 'themeSet':
      setTheme(arg);
      break;
    case 'diagRun':
    case 'benchRun':
      runDiag(k === 'benchRun');
      break;
    case 'diagCopy': {
      const d = S.diag || {},
        txt = reportText(d.info, d.codecs, d.bench),
        msg = ok => {
          const m = $('#diagMsg');
          if (m) m.textContent = ok ? 'Informe copiado.' : 'No se pudo copiar: selecciona el texto del informe a mano.';
        };
      if (navigator.clipboard && navigator.clipboard.writeText)
        navigator.clipboard.writeText(txt).then(
          () => msg(true),
          () => msg(false)
        );
      else msg(false);
      S.diag.text = txt;
      break;
    }
    case 'welcomeOk':
      markWelcome();
      renderPanel();
      break;
    case 'welcomeStart':
      markWelcome();
      newProject().then(() => toast('Proyecto nuevo: importa tus videos para empezar'));
      break;
    case 'expRes':
      setExportOpt({ res: +arg });
      renderPanel();
      break;
    case 'expQ':
      setExportOpt({ q: arg });
      renderPanel();
      break;
    case 'delMusic':
      S.music = null;
      attachMusic(P.media);
      renderTimeline();
      renderPanel();
      toast('Música quitada', UNDO);
      break;
    case 'music':
      setTab('media');
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
/* selectores de archivo (fijos, fuera del panel: ver index.html) */
$('#musicIn').accept = MUSIC_ACCEPT;
$('#pickers').addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'fileIn') {
    importFiles(t.files);
    t.value = '';
    return;
  }
  if (t.id === 'musicIn') {
    const f = t.files[0];
    t.value = '';
    if (f) {
      const relink = !!(S.music && S.music.missing);
      importMusic(f, storeMedia, relink).then(ok => {
        if (!ok) return;
        attachMusic(P.media);
        renderTimeline();
        renderPanel();
        commit();
        toast(relink ? 'Música vinculada' : 'Música agregada');
      });
    }
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
});
panel.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.k === 'mloop' && S.music) {
    S.music.loop = t.checked;
    renderTimeline();
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
    renderPanel();
  }
  if (t.dataset.k === 'followRot' || t.dataset.k === 'followScale') {
    const o = getOv();
    if (o) setFollow(o, { [t.dataset.k]: t.checked });
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
  } else if (k === 'cvol' && c) {
    c.vol = +v;
    $('#o-cvol').textContent = Math.round(c.vol * 100) + ' %';
  } else if (S.music && (k === 'mvol' || k === 'min' || k === 'mfin' || k === 'mfout')) {
    const m = S.music,
      key = { mvol: 'vol', min: 'in', mfin: 'fadeIn', mfout: 'fadeOut' }[k];
    m[key] = +v;
    $('#o-' + k).textContent = k === 'mvol' ? Math.round(m.vol * 100) + ' %' : fmtS(m[key]);
    renderTimeline();
  } else if (k === 'ovsize' && o) {
    o.size = +v;
    $('#o-ovsize').textContent = Math.round(o.size * 100);
  } else if (k === 'ovfill' && o) {
    o.fill = +v;
    $('#o-ovfill').textContent = Math.round(o.fill * 100) + ' %';
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
// Zoom con botones: alrededor del cursor de tiempo si está a la vista, si no, del centro
const zoomBtn = k => {
  const r = tlScroll.getBoundingClientRect(),
    ph = tlInner.getBoundingClientRect().left + S.T * S.pps + 12;
  zoomAt(S.pps * k, ph >= r.left && ph <= r.right ? ph : r.left + r.width / 2);
};
$('#zIn').addEventListener('click', () => zoomBtn(1.35));
$('#zOut').addEventListener('click', () => zoomBtn(1 / 1.35));
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
/* teclado: Enter/Espacio sobre clips, barras y listas; atajos de edición */
document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const a = document.activeElement || document.body;
  if (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable) return;
  // Elementos con data-act que no son botones (clips, barras de la línea de tiempo, listas)
  if ((e.key === 'Enter' || e.key === ' ') && a !== document.body && a.matches('[data-act]:not(button)')) {
    e.preventDefault();
    const key = a.dataset.act;
    act(key, a);
    // Tras redibujar, el foco vuelve al mismo elemento
    requestAnimationFrame(() => {
      const again = document.querySelector(`[data-act="${CSS.escape(key)}"]`);
      if (again) again.focus();
    });
    return;
  }
  if (a.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return; // lo resuelve el botón
  if (S.exporting) return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      S.playing ? pause() : play();
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
      // Un cuadro (o 1 s con Shift)
      e.preventDefault();
      pause();
      seek(S.T + (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 1 : 1 / 30));
      break;
    case 'Home':
      e.preventDefault();
      pause();
      seek(0);
      break;
    case 'End':
      e.preventDefault();
      pause();
      seek(S.total);
      break;
    case 's':
    case 'S':
      e.preventDefault();
      doSplit();
      commit();
      break;
    case 'Delete':
    case 'Backspace':
      if (getSel()) {
        e.preventDefault();
        act('del');
      }
      break;
  }
});

/* gestos de la línea de tiempo: timeline-touch.js */

/* interacción con la vista previa */
export const toCanvas = e => {
  const r = cv.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * S.W, y: ((e.clientY - r.top) / r.height) * S.H };
};
/* Arrastrar un punto ya marcado (pestaña Rastreo): ajustarlo sin volver a marcar todo */
function markAt(p) {
  if (S.tab !== 'track' || S.tracking) return null;
  const c = getSel();
  if (!c || !activeAt(S.T).includes(c)) return null;
  const em = editableMarks(c, localOf(c, S.T));
  // Marcando de nuevo: solo se arrastran los toques pendientes (tocar en otro lado marca)
  if (!em.pts.length || (S.pick && !em.pending)) return null;
  const r = (cv.width / (cv.getBoundingClientRect().width || 1)) * (matchMedia('(pointer: coarse)').matches ? 30 : 16);
  let best = null,
    bd = r;
  em.pts.forEach(pt => {
    const m = mapSrc(c, pt.x, pt.y),
      d = Math.hypot(m.x - p.x, m.y - p.y);
    if (d < bd) {
      bd = d;
      best = { c, pt, em };
    }
  });
  return best;
}
const toSrc = (c, p) => {
  const m = coverOf(c);
  return { x: (p.x - m.dx) / m.dw, y: (p.y - m.dy) / m.dh };
};
function startMarkDrag(h, p, e) {
  const { c, pt, em } = h,
    tr = c.track,
    n = toSrc(c, p);
  pause();
  // Los puntos son del cuadro de la semilla: se muestra ese cuadro mientras se ajustan
  if (!em.pending && tr && Math.abs(localOf(c, S.T) - tr.seed.t) > 0.02) seek(c._start + tr.seed.t - c.in);
  S.markDrag = {
    c,
    pt,
    em,
    ox: pt.x - n.x,
    oy: pt.y - n.y,
    orig: { x: pt.x, y: pt.y },
    origQuad: tr && tr.quad ? tr.quad.map(q => ({ ...q })) : null,
    moved: false,
  };
  cv.setPointerCapture(e.pointerId);
}
function moveMark(p) {
  const d = S.markDrag,
    n = toSrc(d.c, p);
  d.pt.x = clamp(n.x + d.ox, 0, 1);
  d.pt.y = clamp(n.y + d.oy, 0, 1);
  if (Math.hypot((d.pt.x - d.orig.x) * d.c.sw, (d.pt.y - d.orig.y) * d.c.sh) > 1) d.moved = true;
}
function endMarkDrag() {
  const d = S.markDrag;
  S.markDrag = null;
  if (!d.moved) return;
  if (d.em.pending) return renderPanel(); // todavía no es parte del proyecto
  const c = d.c,
    tr = c.track;
  if (tr.quad) {
    const quad = orderQuad(tr.quad, c.sw, c.sh),
      flat = quad.flatMap(q => [q.x * c.sw, q.y * c.sh]);
    if (!quadConvex(flat, Math.sign(quadArea(flat)) || 1) || Math.abs(quadArea(flat)) < c.sw * c.sh * 0.004) {
      tr.quad = d.origQuad;
      toast('Así las esquinas se cruzan: quedaron como estaban');
      return;
    }
    tr.quad = quad;
    [tr.seed.x, tr.seed.y] = quadCenter(quad.flatMap(q => [q.x, q.y]));
  } else if (
    tr.seed2 &&
    Math.hypot((tr.seed2.x - tr.seed.x) * c.sw, (tr.seed2.y - tr.seed.y) * c.sh) < Math.max(c.sw, c.sh) * 0.03
  ) {
    Object.assign(d.pt, d.orig);
    toast('Los puntos quedaban muy juntos: volvió a donde estaba');
    return;
  }
  if (tr.pts.length > 1) {
    tr.stale = true; // el rastreo anterior queda hasta que se vuelva a rastrear
    toast(tr.quad ? 'Esquina movida. Toca Rastrear para actualizar.' : 'Punto movido. Toca Rastrear para actualizar.');
  } else toast(tr.quad ? 'Esquina ajustada' : 'Punto ajustado');
  renderTimeline();
  renderPanel();
  commit();
}

cv.addEventListener('pointerdown', e => {
  if (S.exporting) return;
  const p = toCanvas(e);
  const act = activeAt(S.T);
  const mk = markAt(p);
  if (mk) {
    startMarkDrag(mk, p, e);
    return;
  }
  if (S.pick) {
    let c = getSel();
    if (!act.includes(c)) c = act[act.length - 1];
    if (!c) return;
    const m = coverOf(c),
      nx = (p.x - m.dx) / m.dw,
      ny = (p.y - m.dy) / m.dh;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return;
    S.sel = c.id;
    const t = localOf(c, S.T);
    // Rastreo de 4 esquinas: se juntan los 4 toques en el mismo cuadro
    if (S.trackPts === 4) {
      let pq = S.pickQuad;
      if (!pq || pq.clipId !== c.id || Math.abs(pq.t - t) > 0.02) pq = S.pickQuad = { clipId: c.id, t, pts: [] };
      const near = pq.pts.some(q => Math.hypot((nx - q.x) * c.sw, (ny - q.y) * c.sh) < Math.max(c.sw, c.sh) * 0.03);
      if (near) {
        toast('Esa esquina está muy cerca de otra: toca la siguiente');
        return;
      }
      pq.pts.push({ x: nx, y: ny });
      if (pq.pts.length < 4) {
        renderPanel();
        toast(`Esquina ${pq.pts.length} de 4. Toca la siguiente.`);
        return;
      }
      const quad = orderQuad(pq.pts, c.sw, c.sh),
        flat = quad.flatMap(p => [p.x * c.sw, p.y * c.sh]);
      if (!quadConvex(flat, Math.sign(quadArea(flat)) || 1) || Math.abs(quadArea(flat)) < c.sw * c.sh * 0.004) {
        S.pickQuad = { clipId: c.id, t, pts: [] };
        renderPanel();
        toast('Las 4 esquinas deben formar un área sin cruces. Vuelve a tocarlas.');
        return;
      }
      const [cx, cy] = quadCenter(quad.flatMap(p => [p.x, p.y]));
      c.track = { seed: { t, x: cx, y: cy }, quad, pts: [] };
      S.pickQuad = null;
      S.pick = false;
      renderTimeline();
      renderPanel();
      commit();
      toast('Esquinas marcadas. Puedes arrastrarlas para ajustarlas, o toca Rastrear.');
      return;
    }
    // Rastreo de 2 puntos: el primer toque queda pendiente hasta el segundo, en el mismo cuadro
    if (S.trackPts === 2) {
      const f = S.pickFirst;
      if (!f || f.clipId !== c.id || Math.abs(f.t - t) > 0.02) {
        S.pickFirst = { clipId: c.id, t, x: nx, y: ny };
        renderPanel();
        toast('Ahora toca el punto 2: otro detalle del mismo objeto, lejos del primero');
        return;
      }
      if (Math.hypot((nx - f.x) * c.sw, (ny - f.y) * c.sh) < Math.max(c.sw, c.sh) * 0.03) {
        toast('Los puntos están muy juntos: elige uno más lejos del primero');
        return;
      }
      c.track = { seed: { t: f.t, x: f.x, y: f.y }, seed2: { x: nx, y: ny }, pts: [] };
      S.pickFirst = null;
    } else c.track = { seed: { t, x: nx, y: ny }, pts: [] };
    S.pick = false;
    renderTimeline();
    renderPanel();
    commit();
    toast(
      c.track.seed2
        ? 'Puntos marcados. Puedes arrastrarlos para ajustarlos, o toca Rastrear.'
        : 'Punto marcado. Puedes arrastrarlo para ajustarlo, o toca Rastrear.'
    );
    return;
  }
  for (let i = S.hits.length - 1; i >= 0; i--) {
    const h = S.hits[i];
    if (p.x >= h.x && p.x <= h.x + h.w && p.y >= h.y && p.y <= h.y + h.h) {
      pause();
      const changed = S.selOv !== h.o.id;
      S.sel = h.c.id;
      S.selOv = h.o.id;
      const local = localOf(h.c, S.T),
        abs = ovPos(h.o, h.c, local);
      S.drag = { o: h.o, c: h.c, local, ax: abs.x, ay: abs.y, px: p.x, py: p.y };
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
  if (S.markDrag) return moveMark(toCanvas(e));
  if (!S.drag) {
    // Con mouse: la mano indica que el punto se puede arrastrar
    if (e.pointerType === 'mouse') cv.style.cursor = markAt(toCanvas(e)) ? 'grab' : '';
    return;
  }
  const p = toCanvas(e),
    d = S.drag;
  // En pantalla se mueve 1:1; si sigue al objeto, se guarda como desplazamiento en su cuadro de referencia
  ovSetAbs(d.o, d.c, d.local, d.ax + (p.x - d.px), d.ay + (p.y - d.py));
});
export const endDrag = () => {
  if (S.markDrag) return endMarkDrag();
  if (S.drag) {
    S.drag = null;
    commit();
  }
};
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
