import { $, panel, S } from './state.js';
import { esc, fmtS, fmtT, getSel, getOv } from './util.js';
import { TR, FILTERS } from './transitions.js';
import { exportInfo, cancelExport } from './export.js';
import { RESOLUTIONS, QUALITIES } from './fastexport.js';
import { act } from './actions.js';
import { P, refreshList } from './project.js';
import { isStandalone, onPwaChange } from './pwa.js';

/* ---------- UI: pestañas ---------- */
export const TABS = [
  [
    'media',
    'Medios',
    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>',
  ],
  [
    'edit',
    'Editar',
    '<circle cx="6" cy="7" r="2.6"/><circle cx="6" cy="17" r="2.6"/><path d="M8.2 8.6 20 18M8.2 15.4 20 6"/>',
  ],
  [
    'trans',
    'Transición',
    '<rect x="2.5" y="6" width="11" height="12" rx="1.6"/><rect x="10.5" y="6" width="11" height="12" rx="1.6"/>',
  ],
  [
    'track',
    'Rastreo',
    '<circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.2"/>',
  ],
  ['text', 'Texto', '<path d="M5 6h14M12 6v13M9 19h6"/>'],
  ['export', 'Exportar', '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'],
];
export function renderTabs() {
  $('#tabs').innerHTML = TABS.map(
    ([k, n, ic]) =>
      `<button class="tab" role="tab" data-tab="${k}" aria-selected="${S.tab === k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ic}</svg>${n}</button>`
  ).join('');
}
export function setTab(t) {
  S.tab = t;
  if (t !== 'track') S.pick = false;
  renderTabs();
  renderPanel();
  if (t === 'projects') {
    refreshList();
    if (matchMedia('(max-width: 899px)').matches)
      panel.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
  }
}

export const COLORS = ['#ffffff', '#f1a93b', '#4fd1c5', '#ef6b5c', '#a68bf0', '#ffe066', '#14161b'];
export const STICKERS = ['⚽', '🔥', '⭐', '👉', '❤️', '😂', '🎯', '📍'];
export function needClip() {
  return '<p class="empty">Selecciona un clip en la línea de tiempo.</p>';
}
/* Primer uso: mientras está abierto el proyecto de ejemplo, una bienvenida (se cierra para siempre en este navegador) */
const WELCOME = 'rastro.welcome';
export function welcomeSeen() {
  try {
    return localStorage.getItem(WELCOME) === '1';
  } catch (e) {
    return false;
  }
}
export function markWelcome() {
  try {
    localStorage.setItem(WELCOME, '1');
  } catch (e) {}
  S.welcomeOff = true;
}
function welcomeCard() {
  if (S.welcomeOff || welcomeSeen() || !S.clips.some(k => k.kind === 'demo')) return '';
  return `<div class="welcome" role="region" aria-label="Bienvenida">
    <b>Este es un proyecto de ejemplo</b>
    <p>Toca <span aria-hidden="true">▶</span> para verlo: el aro y el texto siguen al balón gracias al <b>rastreo</b>. Puedes tocar cualquier pestaña para ver cómo está hecho.</p>
    <div class="grid2"><button class="primary" data-act="welcomeStart">Empezar mi proyecto</button><button data-act="welcomeOk">Entendido</button></div>
  </div>`;
}
export function renderPanel() {
  const c = getSel(),
    o = getOv();
  let h = '';
  if (S.tab === 'media') {
    h = `<h2>Medios</h2>
    <label class="btn primary file" for="fileIn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Importar videos</label>
    <p class="note">Tus videos se procesan en este dispositivo; no se suben a ningún servidor.</p>
    <div class="lbl">Formato del proyecto</div>
    <div class="seg">${['16:9', '9:16', '1:1'].map(a => `<button data-act="aspect:${a}" aria-pressed="${S.aspect === a}">${a}</button>`).join('')}</div>
    <div class="lbl">Clips (${S.clips.length})</div>
    ${S.clips.length ? `<ul class="clist">${S.clips.map(k => `<li data-act="selclip:${k.id}" class="${k.id === S.sel ? 'sel' : ''}" tabindex="0" role="button" aria-pressed="${k.id === S.sel}" aria-label="Clip ${esc(k.name)}, ${fmtS(k.out - k.in)}"><img src="${k.thumb}" alt=""><div><b>${esc(k.name)}</b><span>${fmtS(k.out - k.in)} · ${k.sw}×${k.sh}</span></div>${k.kind === 'demo' ? '<span class="tag">Ejemplo</span>' : k.missing ? `<button class="tag miss" data-act="relink:${k.id}">Vincular</button>` : ''}</li>`).join('')}</ul>` : '<p class="empty">Aún no hay clips. Importa tus videos para empezar.</p>'}
    ${S.clips.some(k => k.missing) ? '<p class="stat warn">Algunos videos no están guardados en este navegador. Toca <b>Vincular</b> y elige el mismo archivo para recuperarlos.</p>' : ''}
    ${S.clips.some(k => k.kind === 'demo') ? '<button data-act="clearDemo">Quitar clips de ejemplo</button>' : ''}
    ${musicPanel()}`;
  } else if (S.tab === 'projects') h = projectsPanel();
  else if (S.tab === 'edit') {
    if (!c) h = '<h2>Editar clip</h2>' + needClip();
    else {
      const i = S.clips.indexOf(c);
      h = `<h2>Editar clip</h2><p class="sub">${esc(c.name)} · ${fmtS(c.out - c.in)}</p>
    <div class="lbl">Recorte</div>
    <div class="field"><span>Inicio</span><input type="range" id="k-in" data-k="in" aria-label="Inicio del clip" min="0" max="${c.dur.toFixed(2)}" step="0.05" value="${c.in}"><output id="o-in">${fmtS(c.in)}</output></div>
    <div class="field"><span>Final</span><input type="range" id="k-out" data-k="out" aria-label="Final del clip" min="0" max="${c.dur.toFixed(2)}" step="0.05" value="${c.out}"><output id="o-out">${fmtS(c.out)}</output></div>
    ${
      c.kind === 'video'
        ? `<div class="lbl">Audio del clip</div>
    <div class="field"><span>Volumen</span><input type="range" id="k-cvol" data-k="cvol" min="0" max="2" step="0.05" value="${c.vol ?? 1}" ${c.mute ? 'disabled' : ''} aria-label="Volumen del clip"><output id="o-cvol">${c.mute ? 'Silencio' : Math.round((c.vol ?? 1) * 100) + ' %'}</output></div>`
        : ''
    }
    <div class="lbl">Filtro de color</div>
    <div class="chips">${Object.entries(FILTERS)
      .map(([k, n]) => `<button data-act="filter:${k}" aria-pressed="${c.filter === k}">${n}</button>`)
      .join('')}</div>
    <div class="lbl">Acciones</div>
    <div class="grid2"><button data-act="split">Dividir en el cursor</button><button data-act="dup">Duplicar</button>
    <button data-act="left" ${i === 0 ? 'disabled' : ''}>Mover a la izquierda</button><button data-act="right" ${i === S.clips.length - 1 ? 'disabled' : ''}>Mover a la derecha</button>
    ${c.kind === 'video' ? `<button data-act="mute">${c.mute ? 'Activar audio' : 'Silenciar audio'}</button>` : ''}<button class="danger" data-act="del">Eliminar clip</button></div>
    <p class="note kbd-note">Atajos: <kbd>Espacio</kbd> reproducir · <kbd>←</kbd> <kbd>→</kbd> un cuadro (con <kbd>Shift</kbd>, 1 s) · <kbd>S</kbd> dividir · <kbd>Supr</kbd> eliminar clip · <kbd>Ctrl</kbd>+<kbd>Z</kbd> deshacer</p>`;
    }
  } else if (S.tab === 'trans') {
    const i = c ? S.clips.indexOf(c) : -1;
    if (!c) h = '<h2>Transición</h2>' + needClip();
    else if (i === 0)
      h = `<h2>Transición</h2><p class="empty">El primer clip no tiene entrada. Selecciona el clip 2 o posterior, o toca un rombo naranja entre clips.</p>`;
    else {
      const prev = S.clips[i - 1];
      h = `<h2>Transición de entrada</h2><p class="sub">Entre «${esc(prev.name)}» y «${esc(c.name)}»</p>
    <div class="tgrid">${Object.entries(TR)
      .map(
        ([k, t]) =>
          `<button class="tcard" data-act="trans:${k}" aria-pressed="${c.trans.type === k}"><canvas width="96" height="54" data-tp="${k}"></canvas><span>${t.n}</span></button>`
      )
      .join('')}</div>
    <div class="field"><span>Duración</span><input type="range" id="k-tdur" data-k="tdur" min="0.2" max="1.5" step="0.05" value="${c.trans.d}" ${c.trans.type === 'none' ? 'disabled' : ''}><output id="o-tdur">${fmtS(c.trans.d)}</output></div>
    <div class="grid2"><button data-act="previewTrans">Ver transición</button><button data-act="transAll">Aplicar a todos los cortes</button></div>`;
    }
  } else if (S.tab === 'track') {
    if (!c) h = '<h2>Rastreo de movimiento</h2>' + needClip();
    else {
      const tr = c.track,
        n = tr && tr.pts.length,
        busy = S.tracking === c.id;
      let st, cls;
      if (busy) {
        st = 'Analizando… ' + Math.round(S.trackProg * 100) + '%';
        cls = 'run';
      } else if (n > 1) {
        st =
          `Rastreo listo · ${tr.seed2 ? '2 puntos, con giro y escala' : '1 punto'} · de ${fmtS(tr.pts[0].t)} a ${fmtS(tr.pts[n - 1].t)}` +
          (tr.lost ? ' · se perdió el objeto en un tramo' : '');
        cls = tr.lost ? 'warn' : 'ok';
      } else if (tr && tr.seed) {
        st = (tr.seed2 ? 'Puntos marcados' : 'Punto marcado') + ' en ' + fmtS(tr.seed.t) + '. Toca Rastrear.';
        cls = 'run';
      } else {
        st = 'Este clip no tiene rastreo.';
        cls = '';
      }
      const two = S.trackPts === 2;
      const pickLbl = !S.pick
        ? two
          ? 'Marcar 2 puntos'
          : 'Marcar punto'
        : two
          ? S.pickFirst
            ? 'Toca el punto 2…'
            : 'Toca el punto 1…'
          : 'Toca la vista previa…';
      h = `<h2>Rastreo de movimiento</h2><p class="sub">Clip: ${esc(c.name)}</p>
    <div class="seg" role="group" aria-label="Puntos a rastrear">${[
      [1, '1 punto'],
      [2, '2 puntos · giro y escala'],
    ]
      .map(
        ([k, n]) =>
          `<button data-act="trackPts:${k}" aria-pressed="${S.trackPts === k}" ${busy ? 'disabled' : ''}>${n}</button>`
      )
      .join('')}</div>
    <ol class="steps"><li>Mueve el cursor a un cuadro donde el objeto se vea nítido.</li>${
      two
        ? '<li>Toca <b>Marcar 2 puntos</b> y luego dos detalles del mismo objeto, bien separados (por ejemplo, sus extremos).</li>'
        : '<li>Toca <b>Marcar punto</b> y luego el objeto en la vista previa.</li>'
    }<li>Toca <b>Rastrear</b>: analiza el clip hacia adelante y hacia atrás.</li></ol>
    <div class="stat ${cls}" id="trkStat">${st}</div>
    <div class="prog" ${busy ? '' : 'hidden'}><i id="progBar" style="width:${S.trackProg * 100}%"></i></div>
    <div class="grid2">
      <button data-act="pick" class="${S.pick ? 'on' : ''}" ${busy ? 'disabled' : ''}>${pickLbl}</button>
      ${busy ? '<button data-act="cancelTrack">Detener</button>' : `<button class="primary" data-act="track" ${tr && tr.seed ? '' : 'disabled'}>Rastrear</button>`}
      <button data-act="followText" ${n > 1 && !busy ? '' : 'disabled'}>Texto que sigue</button>
      <button data-act="clearTrack" ${tr && !busy ? '' : 'disabled'}>Borrar rastreo</button></div>
    <label class="chk"><input type="checkbox" id="k-path" data-k="path" ${S.showPath ? 'checked' : ''}> Mostrar trayectoria en la vista previa</label>
    <p class="note">${
      two
        ? 'Con 2 puntos, los textos y stickers que siguen al objeto también giran y cambian de tamaño con él. Elige detalles con buen contraste y que no se tapen.'
        : 'Rastreo 2D por punto: funciona mejor con objetos de buen contraste y textura.'
    } Si el objeto sale de cuadro o queda tapado, el rastreo se detiene en ese tramo.</p>`;
    }
  } else if (S.tab === 'text') {
    if (!c) h = '<h2>Texto y stickers</h2>' + needClip();
    else {
      const list = S.ovs.filter(x => x.clipId === c.id),
        has = c.track && c.track.pts.length > 1;
      const nm = x => (x.kind === 'ring' ? 'Aro' : x.kind === 'sticker' ? x.text : x.text.split('\n')[0] || 'Texto');
      h = `<h2>Texto y stickers</h2><p class="sub">En: ${esc(c.name)}</p>
    <div class="grid2"><button data-act="addText">+ Texto</button><button data-act="addRing">+ Aro de enfoque</button></div>
    <div class="emojis" aria-label="Agregar sticker">${STICKERS.map(s => `<button data-act="addSticker:${s}" aria-label="Sticker ${s}">${s}</button>`).join('')}</div>
    <div class="lbl">Elementos en este clip</div>
    ${list.length ? `<div class="chips">${list.map(x => `<button data-act="selov:${x.id}" aria-pressed="${x.id === S.selOv}">${esc(nm(x))}${x.follow ? ' ⌖' : ''}</button>`).join('')}</div>` : '<p class="note">Ninguno todavía. También puedes arrastrar los elementos sobre la vista previa.</p>'}
    ${
      o && o.clipId === c.id
        ? `<div class="editor">
      ${o.kind !== 'ring' ? `<div class="lbl">Contenido</div><textarea id="k-ovtext" data-k="ovtext" rows="2">${esc(o.text)}</textarea>` : ''}
      ${
        o.kind === 'text'
          ? `<div class="lbl">Tipografía</div><div class="seg">${[
              ['impacto', 'Impacto'],
              ['limpia', 'Limpia'],
              ['mano', 'A mano'],
            ]
              .map(([k, n]) => `<button data-act="font:${k}" aria-pressed="${o.font === k}">${n}</button>`)
              .join('')}</div>
        <div class="seg">${[
          ['outline', 'Contorno'],
          ['box', 'Caja'],
        ]
          .map(([k, n]) => `<button data-act="style:${k}" aria-pressed="${o.style === k}">${n}</button>`)
          .join('')}</div>`
          : ''
      }
      ${o.kind !== 'sticker' ? `<div class="lbl">Color</div><div class="swatches">${COLORS.map(col => `<button class="sw" style="background:${col}" data-act="color:${col}" aria-pressed="${o.color === col}" aria-label="Color ${col}"></button>`).join('')}</div>` : ''}
      <div class="field"><span>Tamaño</span><input type="range" id="k-ovsize" data-k="ovsize" aria-label="Tamaño del elemento" min="0.025" max="0.3" step="0.005" value="${o.size}"><output id="o-ovsize">${Math.round(o.size * 100)}</output></div>
      <label class="chk"><input type="checkbox" id="k-follow" data-k="follow" ${o.follow ? 'checked' : ''} ${has ? '' : 'disabled'}> Seguir el objeto rastreado${has ? '' : ' (primero rastrea este clip)'}</label>
      ${
        o.follow && has && c.track.seed2
          ? `<label class="chk"><input type="checkbox" id="k-followRot" data-k="followRot" ${o.followRot !== false ? 'checked' : ''}> Girar con el objeto</label>
      <label class="chk"><input type="checkbox" id="k-followScale" data-k="followScale" ${o.followScale !== false ? 'checked' : ''}> Cambiar de tamaño con el objeto</label>`
          : ''
      }
      <div class="lbl">Visible</div><p class="note" id="ovRange">De ${fmtS(Math.max(o.t0, c.in) - c.in)} a ${fmtS(Math.min(o.t1, c.out) - c.in)} del clip</p>
      <div class="grid3"><button data-act="ovFrom">Desde aquí</button><button data-act="ovTo">Hasta aquí</button><button data-act="ovAll">Todo el clip</button></div>
      <div class="lbl">Animación de entrada</div><div class="seg">${[
        ['pop', 'Pop'],
        ['fade', 'Fundido'],
        ['none', 'Ninguna'],
      ]
        .map(([k, n]) => `<button data-act="anim:${k}" aria-pressed="${o.anim === k}">${n}</button>`)
        .join('')}</div>
      <button class="danger" data-act="delOv">Eliminar elemento</button></div>`
        : ''
    }`;
    }
  } else if (S.tab === 'export') {
    const info = exportInfo();
    const busy = S.exporting ? 'disabled' : '';
    // Resolución y calidad (solo con la exportación rápida; la de tiempo real graba el tamaño del proyecto)
    const opts = info.fast
      ? `<div class="lbl">Resolución</div>
    <div class="seg" role="group" aria-label="Resolución">${Object.entries(RESOLUTIONS)
      .map(([r, n]) => {
        const s = info.sizes[r],
          no = s.codecs === null;
        return `<button data-act="expRes:${r}" aria-pressed="${info.res === +r}" ${no || S.exporting ? 'disabled' : ''} title="${no ? 'Este navegador no puede codificar ' + n : s.w + ' × ' + s.h}">${n}</button>`;
      })
      .join('')}</div>
    ${Object.values(info.sizes).some(s => s.codecs === null) ? '<p class="note">Las resoluciones apagadas no las puede codificar este navegador.</p>' : ''}
    <div class="lbl">Calidad</div>
    <div class="seg" role="group" aria-label="Calidad">${Object.entries(QUALITIES)
      .map(([k, q]) => `<button data-act="expQ:${k}" aria-pressed="${S.expOpt.q === k}" ${busy}>${q.n}</button>`)
      .join('')}</div>`
      : '';
    h = `<h2>Exportar</h2>
    ${opts}
    <dl class="specs"><dt>Tamaño</dt><dd>${info.w} × ${info.h}</dd><dt>Duración</dt><dd>${fmtT(S.total)}</dd><dt>Cuadros</dt><dd>30 fps</dd><dt>Formato</dt><dd>${info.fmt}</dd>${info.est ? `<dt>Peso</dt><dd>hasta ${mb(info.est)}</dd>` : ''}</dl>
    <p class="note">${
      info.fast
        ? 'Se arma cuadro por cuadro, más rápido que tiempo real. Si cambias de pestaña, se pausa y sigue cuando vuelvas.'
        : 'La exportación reproduce el proyecto en tiempo real: tarda lo mismo que dura el video. Si cambias de pestaña, se pausa y sigue cuando vuelvas.'
    }</p>
    ${S.exporting ? `<div class="prog"><i id="expBar" style="transition:none"></i></div><button data-act="cancelExport">Detener exportación</button>` : `<button class="primary" data-act="export" ${S.clips.length && info.ok ? '' : 'disabled'}>Exportar video</button>`}
    ${
      S.result && !S.exporting
        ? `<div class="lbl">Resultado · ${S.result.w ? RESOLUTIONS[Math.min(S.result.w, S.result.h)] + ' · ' : ''}${mb(S.result.size)}${S.result.took ? ' · listo en ' + fmtS(S.result.took) : ''}</div><video class="result" src="${S.result.url}" controls playsinline></video>
      <button class="primary" data-act="save">Guardar archivo .${S.result.ext}</button><p class="note" id="saveMsg"></p>`
        : ''
    }`;
  }
  panel.innerHTML = welcomeCard() + h;
  $('#pickHint').hidden = !S.pick;
}

/* ---------- panel de proyectos ---------- */
const rtf = (() => {
  try {
    return new Intl.RelativeTimeFormat('es', { numeric: 'auto' });
  } catch (e) {
    return null;
  }
})();
function ago(ts) {
  const s = (ts - Date.now()) / 1000,
    a = Math.abs(s);
  if (!rtf) return new Date(ts).toLocaleString('es');
  if (a < 45) return 'hace un momento';
  if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(ts).toLocaleDateString('es');
}
const mb = b =>
  b >= 1073741824
    ? (b / 1073741824).toFixed(1).replace('.', ',') + ' GB'
    : Math.max(0.1, b / 1048576)
        .toFixed(1)
        .replace('.', ',') + ' MB';
// Música de fondo (pestaña Medios)
function musicPanel() {
  const m = S.music;
  const pick = (label, cls) =>
    `<label class="btn file${cls ? ' ' + cls : ''}" for="musicIn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>${label}</label>`;
  if (!m)
    return `<div class="lbl">Música de fondo</div>${pick('Agregar música', '')}
    <p class="note">Suena durante todo el proyecto, debajo del audio de los clips. MP3, M4A, WAV u OGG.</p>`;
  const pct = v => Math.round(v * 100) + ' %';
  return `<div class="lbl">Música de fondo</div>
    <div class="music-card"><b>♪ ${esc(m.name)}</b><span>${fmtS(m.dur)}</span></div>
    ${m.missing ? `<p class="stat warn">El archivo de música no está guardado en este navegador. Elige el mismo archivo para recuperarlo.</p>${pick('Vincular música', 'primary')}` : ''}
    <div class="field"><span>Volumen</span><input type="range" id="k-mvol" data-k="mvol" min="0" max="1.5" step="0.05" value="${m.vol}" aria-label="Volumen de la música"><output id="o-mvol">${pct(m.vol)}</output></div>
    <div class="field"><span>Empieza en</span><input type="range" id="k-min" data-k="min" min="0" max="${Math.max(0, m.dur - 1).toFixed(2)}" step="0.5" value="${m.in}" aria-label="Segundo de la canción donde empieza"><output id="o-min">${fmtS(m.in)}</output></div>
    <div class="field"><span>Entrada</span><input type="range" id="k-mfin" data-k="mfin" min="0" max="5" step="0.25" value="${m.fadeIn}" aria-label="Fundido de entrada"><output id="o-mfin">${fmtS(m.fadeIn)}</output></div>
    <div class="field"><span>Salida</span><input type="range" id="k-mfout" data-k="mfout" min="0" max="5" step="0.25" value="${m.fadeOut}" aria-label="Fundido de salida"><output id="o-mfout">${fmtS(m.fadeOut)}</output></div>
    <label class="chk"><input type="checkbox" id="k-mloop" data-k="mloop" ${m.loop ? 'checked' : ''}> Repetir si la canción es más corta que el video</label>
    <div class="grid2">${m.missing ? '' : pick('Cambiar música', '')}<button class="danger" data-act="delMusic">Quitar música</button></div>`;
}
export function projectsPanel() {
  const cur = P.project;
  if (!P.ok)
    return `<h2>Proyectos</h2><p class="stat warn">Este navegador no permite guardar datos (por ejemplo, en una ventana privada). Puedes editar y exportar, pero el proyecto se pierde al cerrar la página.</p>${fileBlock()}${deviceBlock()}`;
  const st =
    {
      saved: 'Todos los cambios están guardados en este navegador.',
      saving: 'Guardando…',
      dirty: 'Guardando en un momento…',
      error: 'No se pudo guardar el último cambio.',
      off: '',
    }[P.status] || '';
  const list = P.list
    .map(p => {
      const isCur = cur && p.id === cur.id,
        conf = P.confirmDel === p.id;
      return `<li class="${isCur ? 'sel' : ''}"${isCur ? ' aria-current="true"' : ` data-act="openProj:${p.id}" tabindex="0" role="button" aria-label="Abrir ${esc(p.name)}"`}>
      ${p.thumb ? `<img src="${p.thumb}" alt="">` : '<span class="nothumb" aria-hidden="true"></span>'}
      <div><b>${esc(p.name)}</b><span>${isCur ? 'Abierto · ' : ''}${ago(p.updatedAt)} · ${p.clipsN} ${p.clipsN === 1 ? 'clip' : 'clips'} · ${fmtT(p.dur || 0)}</span></div>
      <button class="mini${conf ? ' danger' : ''}" data-act="delProj:${p.id}" aria-label="Eliminar ${esc(p.name)}">${conf ? '¿Eliminar?' : '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>'}</button></li>`;
    })
    .join('');
  const sto =
    P.storage && P.storage.quota
      ? `<p class="note">Espacio usado en este navegador: ${mb(P.storage.usage || 0)} de ${mb(P.storage.quota)}.</p>`
      : '';
  return `<h2>Proyectos</h2>
    <div class="lbl">Proyecto abierto</div>
    <input type="text" id="k-pname" data-k="pname" class="txt" value="${esc(cur ? cur.name : '')}" maxlength="80" aria-label="Nombre del proyecto">
    <p class="note">${st}</p>
    <div class="grid2"><button class="primary" data-act="newProject">Nuevo proyecto</button><button data-act="dupProject">Duplicar</button></div>
    <div class="lbl">Guardados (${P.list.length})</div>
    ${P.list.length ? `<ul class="clist plist">${list}</ul>` : '<p class="empty">Cargando…</p>'}
    ${sto}
    <p class="note">Los proyectos y sus videos se guardan solo en este navegador y este dispositivo.</p>
    ${fileBlock()}
    ${deviceBlock()}`;
}
// Este dispositivo: instalar la app y diagnóstico (diag.js)
onPwaChange(() => S.tab === 'projects' && renderPanel());
function deviceBlock() {
  const d = S.diag || {},
    pwa = S.pwa || {};
  const install = isStandalone()
    ? '<p class="note">Abierta como app instalada. Funciona sin conexión.</p>'
    : pwa.prompt
      ? '<button class="primary" data-act="install">Instalar app</button><p class="note">Queda como una app más: ícono, pantalla completa y funciona sin conexión.</p>'
      : '<p class="note">Para instalarla como app: en el menú del navegador, «Instalar app» o «Agregar a la pantalla principal».</p>';
  const yn = v =>
    v === 'hardware'
      ? '<b class="ok">sí</b> · hardware'
      : v === 'software'
        ? 'sí · software'
        : v
          ? 'sí'
          : '<span class="no">no</span>';
  let res = '';
  if (d.info) {
    const i = d.info;
    res += `<dl class="specs"><dt>Navegador</dt><dd>${esc(i.browser)} · ${esc(i.platform)}</dd><dt>Núcleos</dt><dd>${i.cores || '?'}</dd><dt>Memoria</dt><dd>${i.memory ? i.memory + ' GB o más' : '?'}</dd><dt>GPU</dt><dd>${esc(i.gpu || '?')}</dd><dt>Sin conexión</dt><dd>${i.offline ? 'sí' : 'no'}</dd></dl>`;
  }
  if (d.codecs && d.codecs.video.length)
    res += `<table class="diag"><caption class="sr-only">Códecs de video</caption><thead><tr><th scope="col">Video</th><th scope="col">Abrir</th><th scope="col">Exportar</th></tr></thead><tbody>${d.codecs.video
      .map(v => `<tr><th scope="row">${v.n}</th><td>${yn(v.dec)}</td><td>${yn(v.enc)}</td></tr>`)
      .join(
        ''
      )}</tbody></table><p class="note">Audio para exportar: ${d.codecs.audio.map(a => `${a.n} ${a.enc ? 'sí' : 'no'}`).join(' · ')}</p>`;
  if (d.bench)
    res += `<dl class="specs bench">${d.bench.map(r => `<dt>${esc(r.n)}</dt><dd>${esc(r.v)}</dd>`).join('')}</dl>`;
  const busy = d.running;
  return `<div class="lbl">Este dispositivo</div>
    ${install}
    ${
      busy
        ? `<p class="note" aria-live="polite">${esc(d.step || 'Midiendo…')}</p><div class="prog"><i style="width:${(d.p || 0) * 100}%"></i></div>`
        : `<div class="grid2"><button data-act="diagRun">${d.info ? 'Volver a revisar' : 'Diagnóstico'}</button><button data-act="benchRun">Medir rendimiento</button></div>`
    }
    ${res}
    ${d.info && !busy ? '<button data-act="diagCopy">Copiar informe</button><p class="note" id="diagMsg">Puedes pegar el informe en un mensaje para compartir qué puede hacer este equipo.</p>' : ''}`;
}
// Archivo .rastro: el proyecto con sus videos, para abrirlo en otro equipo
function fileBlock() {
  const f = P.file;
  return `<div class="lbl">Pasar a otro equipo</div>
    ${
      f
        ? `<p class="note">${f.label} ${Math.round(f.p * 100)} %</p><div class="prog"><i style="width:${f.p * 100}%"></i></div>`
        : `<div class="grid2"><button data-act="exportProj" ${P.project ? '' : 'disabled'}>Guardar .rastro</button>
    <label class="btn file" for="rastroIn">Abrir .rastro</label></div>`
    }
    <p class="note">El archivo .rastro incluye los videos. Ábrelo en otro equipo desde aquí y se agrega como proyecto nuevo.</p>`;
}
