import { S, nid } from './state.js';
import { ballPos, drawField, drawStreet, drawLake } from './demo.js';
import { demoClip } from './clips.js';
import { updPlayBtn, makeMini, loop } from './playback.js';
import { runTrack } from './tracker.js';
import { renderTabs, renderPanel } from './panel.js';
import { renderTimeline } from './timeline-ui.js';
import './util.js';
import './timeline.js';
import './transitions.js';
import './render.js';
import './export.js';
import './actions.js';

/* ---------- arranque con proyecto de ejemplo ---------- */
export function init(){
  const c1=demoClip('Cancha',5,drawField),c2=demoClip('Avenida',4,drawStreet),c3=demoClip('Lago',4.5,drawLake);
  c2.trans={type:'zoom',d:.7};c2.filter='cine';c3.trans={type:'blur',d:.8};
  S.clips=[c1,c2,c3];S.sel=c1.id;
  const bp=ballPos(.4);c1.track={seed:{t:.4,x:bp.x,y:bp.y},pts:[]};
  const base={font:'impacto',style:'outline',color:'#ffffff',anim:'pop'};
  S.ovs=[
    {...base,id:nid(),clipId:c1.id,kind:'text',text:'DOMINGO DE FÚTBOL',size:.07,follow:false,x:.5,y:.2,t0:0,t1:1.9},
    {...base,id:nid(),clipId:c1.id,kind:'ring',text:'',color:'#f1a93b',size:.075,follow:true,x:0,y:0,t0:.7,t1:5},
    {...base,id:nid(),clipId:c1.id,kind:'text',text:'¡Mira el balón!',font:'limpia',style:'box',color:'#f1a93b',size:.042,follow:true,x:0,y:-.14,t0:1,t1:5},
    {...base,id:nid(),clipId:c3.id,kind:'text',text:'Hasta el próximo domingo',font:'mano',size:.1,follow:false,x:.5,y:.8,t0:1,t1:4.5,anim:'fade'}];
  makeMini();renderTabs();renderTimeline();renderPanel();updPlayBtn();
  requestAnimationFrame(t=>{S.last=t;loop(t)});
  runTrack(c1,true).then(()=>{renderPanel()});
  (document.fonts&&document.fonts.ready||Promise.resolve()).then(()=>{makeMini()});
  setTimeout(async()=>{try{S.dl=window.claude&&window.claude.use?await window.claude.use('downloads'):null}catch(e){S.dl=null}if(S.tab==='export')renderPanel()},0);
}
window.addEventListener('resize',()=>renderTimeline());
init();
