import { $, panel, S } from './state.js';
import { esc, fmtS, fmtT, getSel, getOv } from './util.js';
import { TR, FILTERS } from './transitions.js';
import { pickMime, cancelExport } from './export.js';
import { act } from './actions.js';
import { P, refreshList } from './project.js';

/* ---------- UI: pestañas ---------- */
export const TABS=[
  ['media','Medios','<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9.5h4M3 14.5h4M17 9.5h4M17 14.5h4"/>'],
  ['edit','Editar','<circle cx="6" cy="7" r="2.6"/><circle cx="6" cy="17" r="2.6"/><path d="M8.2 8.6 20 18M8.2 15.4 20 6"/>'],
  ['trans','Transición','<rect x="2.5" y="6" width="11" height="12" rx="1.6"/><rect x="10.5" y="6" width="11" height="12" rx="1.6"/>'],
  ['track','Rastreo','<circle cx="12" cy="12" r="6"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/><circle cx="12" cy="12" r="1.2"/>'],
  ['text','Texto','<path d="M5 6h14M12 6v13M9 19h6"/>'],
  ['export','Exportar','<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>']];
export function renderTabs(){$('#tabs').innerHTML=TABS.map(([k,n,ic])=>`<button class="tab" role="tab" data-tab="${k}" aria-selected="${S.tab===k}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ic}</svg>${n}</button>`).join('')}
export function setTab(t){S.tab=t;if(t!=='track')S.pick=false;renderTabs();renderPanel();
  if(t==='projects'){refreshList();if(matchMedia('(max-width: 899px)').matches)panel.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'})}}

export const COLORS=['#ffffff','#f1a93b','#4fd1c5','#ef6b5c','#a68bf0','#ffe066','#14161b'];
export const STICKERS=['⚽','🔥','⭐','👉','❤️','😂','🎯','📍'];
export function needClip(){return '<p class="empty">Selecciona un clip en la línea de tiempo.</p>'}
export function renderPanel(){
  const c=getSel(),o=getOv();let h='';
  if(S.tab==='media'){
    h=`<h2>Medios</h2>
    <label class="btn primary file"><input type="file" id="fileIn" accept="video/*" multiple hidden><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>Importar videos</label>
    <p class="note">Tus videos se procesan en este dispositivo; no se suben a ningún servidor.</p>
    <div class="lbl">Formato del proyecto</div>
    <div class="seg">${['16:9','9:16','1:1'].map(a=>`<button data-act="aspect:${a}" aria-pressed="${S.aspect===a}">${a}</button>`).join('')}</div>
    <div class="lbl">Clips (${S.clips.length})</div>
    ${S.clips.length?`<ul class="clist">${S.clips.map(k=>`<li data-act="selclip:${k.id}" class="${k.id===S.sel?'sel':''}"><img src="${k.thumb}" alt=""><div><b>${esc(k.name)}</b><span>${fmtS(k.out-k.in)} · ${k.sw}×${k.sh}</span></div>${k.kind==='demo'?'<span class="tag">Ejemplo</span>':k.missing?`<button class="tag miss" data-act="relink:${k.id}">Vincular</button>`:''}</li>`).join('')}</ul>`:'<p class="empty">Aún no hay clips. Importa tus videos para empezar.</p>'}
    ${S.clips.some(k=>k.missing)?'<p class="stat warn">Algunos videos no están guardados en este navegador. Toca <b>Vincular</b> y elige el mismo archivo para recuperarlos.</p>':''}
    <input type="file" id="relinkIn" accept="video/*" hidden>
    ${S.clips.some(k=>k.kind==='demo')?'<button data-act="clearDemo">Quitar clips de ejemplo</button>':''}`}
  else if(S.tab==='projects')h=projectsPanel();
  else if(S.tab==='edit'){
    if(!c)h='<h2>Editar clip</h2>'+needClip();else{const i=S.clips.indexOf(c);
    h=`<h2>Editar clip</h2><p class="sub">${esc(c.name)} · ${fmtS(c.out-c.in)}</p>
    <div class="lbl">Recorte</div>
    <div class="field"><span>Inicio</span><input type="range" id="k-in" data-k="in" min="0" max="${c.dur.toFixed(2)}" step="0.05" value="${c.in}"><output id="o-in">${fmtS(c.in)}</output></div>
    <div class="field"><span>Final</span><input type="range" id="k-out" data-k="out" min="0" max="${c.dur.toFixed(2)}" step="0.05" value="${c.out}"><output id="o-out">${fmtS(c.out)}</output></div>
    <div class="lbl">Filtro de color</div>
    <div class="chips">${Object.entries(FILTERS).map(([k,n])=>`<button data-act="filter:${k}" aria-pressed="${c.filter===k}">${n}</button>`).join('')}</div>
    <div class="lbl">Acciones</div>
    <div class="grid2"><button data-act="split">Dividir en el cursor</button><button data-act="dup">Duplicar</button>
    <button data-act="left" ${i===0?'disabled':''}>Mover a la izquierda</button><button data-act="right" ${i===S.clips.length-1?'disabled':''}>Mover a la derecha</button>
    ${c.kind==='video'?`<button data-act="mute">${c.mute?'Activar audio':'Silenciar audio'}</button>`:''}<button class="danger" data-act="del">Eliminar clip</button></div>`}}
  else if(S.tab==='trans'){
    const i=c?S.clips.indexOf(c):-1;
    if(!c)h='<h2>Transición</h2>'+needClip();
    else if(i===0)h=`<h2>Transición</h2><p class="empty">El primer clip no tiene entrada. Selecciona el clip 2 o posterior, o toca un rombo naranja entre clips.</p>`;
    else{const prev=S.clips[i-1];
    h=`<h2>Transición de entrada</h2><p class="sub">Entre «${esc(prev.name)}» y «${esc(c.name)}»</p>
    <div class="tgrid">${Object.entries(TR).map(([k,t])=>`<button class="tcard" data-act="trans:${k}" aria-pressed="${c.trans.type===k}"><canvas width="96" height="54" data-tp="${k}"></canvas><span>${t.n}</span></button>`).join('')}</div>
    <div class="field"><span>Duración</span><input type="range" id="k-tdur" data-k="tdur" min="0.2" max="1.5" step="0.05" value="${c.trans.d}" ${c.trans.type==='none'?'disabled':''}><output id="o-tdur">${fmtS(c.trans.d)}</output></div>
    <div class="grid2"><button data-act="previewTrans">Ver transición</button><button data-act="transAll">Aplicar a todos los cortes</button></div>`}}
  else if(S.tab==='track'){
    if(!c)h='<h2>Rastreo de movimiento</h2>'+needClip();else{
    const tr=c.track,n=tr&&tr.pts.length,busy=S.tracking===c.id;let st,cls;
    if(busy){st='Analizando… '+Math.round(S.trackProg*100)+'%';cls='run'}
    else if(n>1){st=`Rastreo listo · ${n} puntos · de ${fmtS(tr.pts[0].t)} a ${fmtS(tr.pts[n-1].t)}`+(tr.lost?' · se perdió el objeto en un tramo':'');cls=tr.lost?'warn':'ok'}
    else if(tr&&tr.seed){st='Punto marcado en '+fmtS(tr.seed.t)+'. Toca Rastrear.';cls='run'}
    else{st='Este clip no tiene rastreo.';cls=''}
    h=`<h2>Rastreo de movimiento</h2><p class="sub">Clip: ${esc(c.name)}</p>
    <ol class="steps"><li>Mueve el cursor a un cuadro donde el objeto se vea nítido.</li><li>Toca <b>Marcar punto</b> y luego el objeto en la vista previa.</li><li>Toca <b>Rastrear</b>: analiza el clip hacia adelante y hacia atrás.</li></ol>
    <div class="stat ${cls}" id="trkStat">${st}</div>
    <div class="prog" ${busy?'':'hidden'}><i id="progBar" style="width:${S.trackProg*100}%"></i></div>
    <div class="grid2">
      <button data-act="pick" class="${S.pick?'on':''}" ${busy?'disabled':''}>${S.pick?'Toca la vista previa…':'Marcar punto'}</button>
      ${busy?'<button data-act="cancelTrack">Detener</button>':`<button class="primary" data-act="track" ${tr&&tr.seed?'':'disabled'}>Rastrear</button>`}
      <button data-act="followText" ${n>1&&!busy?'':'disabled'}>Texto que sigue</button>
      <button data-act="clearTrack" ${tr&&!busy?'':'disabled'}>Borrar rastreo</button></div>
    <label class="chk"><input type="checkbox" id="k-path" data-k="path" ${S.showPath?'checked':''}> Mostrar trayectoria en la vista previa</label>
    <p class="note">Rastreo 2D por punto: funciona mejor con objetos de buen contraste y textura. Si el objeto sale de cuadro o queda tapado, el rastreo se detiene en ese tramo.</p>`}}
  else if(S.tab==='text'){
    if(!c)h='<h2>Texto y stickers</h2>'+needClip();else{
    const list=S.ovs.filter(x=>x.clipId===c.id),has=c.track&&c.track.pts.length>1;
    const nm=x=>x.kind==='ring'?'Aro':x.kind==='sticker'?x.text:(x.text.split('\n')[0]||'Texto');
    h=`<h2>Texto y stickers</h2><p class="sub">En: ${esc(c.name)}</p>
    <div class="grid2"><button data-act="addText">+ Texto</button><button data-act="addRing">+ Aro de enfoque</button></div>
    <div class="emojis" aria-label="Agregar sticker">${STICKERS.map(s=>`<button data-act="addSticker:${s}" aria-label="Sticker ${s}">${s}</button>`).join('')}</div>
    <div class="lbl">Elementos en este clip</div>
    ${list.length?`<div class="chips">${list.map(x=>`<button data-act="selov:${x.id}" aria-pressed="${x.id===S.selOv}">${esc(nm(x))}${x.follow?' ⌖':''}</button>`).join('')}</div>`:'<p class="note">Ninguno todavía. También puedes arrastrar los elementos sobre la vista previa.</p>'}
    ${o&&o.clipId===c.id?`<div class="editor">
      ${o.kind!=='ring'?`<div class="lbl">Contenido</div><textarea id="k-ovtext" data-k="ovtext" rows="2">${esc(o.text)}</textarea>`:''}
      ${o.kind==='text'?`<div class="lbl">Tipografía</div><div class="seg">${[['impacto','Impacto'],['limpia','Limpia'],['mano','A mano']].map(([k,n])=>`<button data-act="font:${k}" aria-pressed="${o.font===k}">${n}</button>`).join('')}</div>
        <div class="seg">${[['outline','Contorno'],['box','Caja']].map(([k,n])=>`<button data-act="style:${k}" aria-pressed="${o.style===k}">${n}</button>`).join('')}</div>`:''}
      ${o.kind!=='sticker'?`<div class="lbl">Color</div><div class="swatches">${COLORS.map(col=>`<button class="sw" style="background:${col}" data-act="color:${col}" aria-pressed="${o.color===col}" aria-label="Color ${col}"></button>`).join('')}</div>`:''}
      <div class="field"><span>Tamaño</span><input type="range" id="k-ovsize" data-k="ovsize" min="0.025" max="0.3" step="0.005" value="${o.size}"><output id="o-ovsize">${Math.round(o.size*100)}</output></div>
      <label class="chk"><input type="checkbox" id="k-follow" data-k="follow" ${o.follow?'checked':''} ${has?'':'disabled'}> Seguir el objeto rastreado${has?'':' (primero rastrea este clip)'}</label>
      <div class="lbl">Visible</div><p class="note" id="ovRange">De ${fmtS(Math.max(o.t0,c.in)-c.in)} a ${fmtS(Math.min(o.t1,c.out)-c.in)} del clip</p>
      <div class="grid3"><button data-act="ovFrom">Desde aquí</button><button data-act="ovTo">Hasta aquí</button><button data-act="ovAll">Todo el clip</button></div>
      <div class="lbl">Animación de entrada</div><div class="seg">${[['pop','Pop'],['fade','Fundido'],['none','Ninguna']].map(([k,n])=>`<button data-act="anim:${k}" aria-pressed="${o.anim===k}">${n}</button>`).join('')}</div>
      <button class="danger" data-act="delOv">Eliminar elemento</button></div>`:''}`}}
  else if(S.tab==='export'){
    const mime=pickMime(),fmt=mime===null?'No disponible':/mp4/.test(mime)?'MP4':'WebM';
    h=`<h2>Exportar</h2>
    <dl class="specs"><dt>Resolución</dt><dd>${S.W} × ${S.H}</dd><dt>Duración</dt><dd>${fmtT(S.total)}</dd><dt>Cuadros</dt><dd>30 fps</dd><dt>Formato</dt><dd>${fmt}</dd></dl>
    <p class="note">La exportación reproduce el proyecto en tiempo real: tarda lo mismo que dura el video. Deja esta pestaña abierta mientras termina.</p>
    ${S.exporting?`<div class="prog"><i id="expBar" style="transition:none"></i></div><button data-act="cancelExport">Detener exportación</button>`:`<button class="primary" data-act="export" ${S.clips.length&&mime!==null?'':'disabled'}>Exportar video</button>`}
    ${S.result&&!S.exporting?`<div class="lbl">Resultado · ${(S.result.size/1048576).toFixed(1).replace('.',',')} MB</div><video class="result" src="${S.result.url}" controls playsinline></video>
      <button class="primary" data-act="save">Guardar archivo .${S.result.ext}</button><p class="note" id="saveMsg"></p>`:''}`}
  panel.innerHTML=h;
  $('#pickHint').hidden=!S.pick;
}

/* ---------- panel de proyectos ---------- */
const rtf=(()=>{try{return new Intl.RelativeTimeFormat('es',{numeric:'auto'})}catch(e){return null}})();
function ago(ts){const s=(ts-Date.now())/1000,a=Math.abs(s);if(!rtf)return new Date(ts).toLocaleString('es');
  if(a<45)return 'hace un momento';if(a<3600)return rtf.format(Math.round(s/60),'minute');if(a<86400)return rtf.format(Math.round(s/3600),'hour');
  if(a<86400*30)return rtf.format(Math.round(s/86400),'day');return new Date(ts).toLocaleDateString('es')}
const mb=b=>b>=1073741824?(b/1073741824).toFixed(1).replace('.',',')+' GB':Math.max(.1,b/1048576).toFixed(1).replace('.',',')+' MB';
export function projectsPanel(){
  const cur=P.project;
  if(!P.ok)return `<h2>Proyectos</h2><p class="stat warn">Este navegador no permite guardar datos (por ejemplo, en una ventana privada). Puedes editar y exportar, pero el proyecto se pierde al cerrar la página.</p>`;
  const st={saved:'Todos los cambios están guardados en este navegador.',saving:'Guardando…',dirty:'Guardando en un momento…',error:'No se pudo guardar el último cambio.',off:''}[P.status]||'';
  const list=P.list.map(p=>{const isCur=cur&&p.id===cur.id,conf=P.confirmDel===p.id;
    return `<li class="${isCur?'sel':''}"${isCur?'':` data-act="openProj:${p.id}"`}>
      ${p.thumb?`<img src="${p.thumb}" alt="">`:'<span class="nothumb" aria-hidden="true"></span>'}
      <div><b>${esc(p.name)}</b><span>${isCur?'Abierto · ':''}${ago(p.updatedAt)} · ${p.clipsN} ${p.clipsN===1?'clip':'clips'} · ${fmtT(p.dur||0)}</span></div>
      <button class="mini${conf?' danger':''}" data-act="delProj:${p.id}" aria-label="Eliminar ${esc(p.name)}">${conf?'¿Eliminar?':'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>'}</button></li>`}).join('');
  const sto=P.storage&&P.storage.quota?`<p class="note">Espacio usado en este navegador: ${mb(P.storage.usage||0)} de ${mb(P.storage.quota)}.</p>`:'';
  return `<h2>Proyectos</h2>
    <div class="lbl">Proyecto abierto</div>
    <input type="text" id="k-pname" data-k="pname" class="txt" value="${esc(cur?cur.name:'')}" maxlength="80" aria-label="Nombre del proyecto">
    <p class="note">${st}</p>
    <div class="grid2"><button class="primary" data-act="newProject">Nuevo proyecto</button><button data-act="dupProject">Duplicar</button></div>
    <div class="lbl">Guardados (${P.list.length})</div>
    ${P.list.length?`<ul class="clist plist">${list}</ul>`:'<p class="empty">Cargando…</p>'}
    ${sto}
    <p class="note">Los proyectos y sus videos se guardan solo en este navegador y este dispositivo. Para pasarlos a otro equipo, exporta el video final.</p>`}
