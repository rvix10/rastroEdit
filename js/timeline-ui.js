import { $, tlInner, tlScroll, S } from './state.js';
import { esc, fmtS, fmtT } from './util.js';
import { layout } from './timeline.js';
import { TR } from './transitions.js';
import { act } from './actions.js';

/* ---------- UI: línea de tiempo ---------- */
export function renderTimeline(){
  layout();const pps=S.pps;tlInner.style.width=Math.max(S.total*pps+200,tlScroll.clientWidth)+'px';
  let r='';const step=pps<35?2:1;for(let s=0;s<=S.total+3;s+=step)r+=`<span class="tick" style="left:${s*pps+12}px">${s}s</span>`;
  if(pps>=50)for(let s=.5;s<=S.total+3;s+=1)r+=`<span class="tick m" style="left:${s*pps+12}px"></span>`;
  $('#ruler').innerHTML=r;
  let cl=S.clips.map(c=>`<div class="clip${c.id===S.sel?' sel':''}" data-act="selclip:${c.id}" style="left:${c._start*pps}px;width:${c._len*pps}px;background-image:url('${c.thumb}')">${c._d?`<i class="tz" style="width:${c._d*pps}px"></i>`:''}<b>${esc(c.name)}${c.track&&c.track.pts.length>1?'<em class="tb">RASTREO</em>':''}${c.missing?'<em class="tb miss">FALTA</em>':''}</b><span class="dur">${fmtS(c._len)}</span></div>`).join('');
  S.clips.forEach((c,i)=>{if(!i)return;cl+=`<button class="tbtn${c.trans.type==='none'?' none':''}" data-act="seltrans:${c.id}" style="left:${(c._start+c._d/2)*pps}px" title="Transición: ${TR[c.trans.type].n}" aria-label="Transición: ${TR[c.trans.type].n}">${TR[c.trans.type].a}</button>`});
  $('#rowClips').innerHTML=cl;
  const lanes=[];let oh='';
  for(const o of S.ovs){const c=S.clips.find(k=>k.id===o.clipId);if(!c)continue;const a=c._start+Math.max(o.t0,c.in)-c.in,b=c._start+Math.min(o.t1,c.out)-c.in;if(b<=a)continue;
    let ln=lanes.findIndex(e=>e<=a);if(ln<0){ln=lanes.length;lanes.push(0)}lanes[ln]=b+.05;
    const nm=o.kind==='ring'?'Aro':o.kind==='sticker'?o.text:(o.text.split('\n')[0]||'Texto');
    oh+=`<div class="ovb${o.follow?' f':''}${o.id===S.selOv?' sel':''}" data-act="selov:${o.id}" style="left:${a*pps}px;width:${Math.max(18,(b-a)*pps)}px;top:${ln*24}px">${esc(nm)}</div>`}
  const ro=$('#rowOvs');ro.innerHTML=oh;ro.style.height=Math.max(1,lanes.length)*24+'px';
  $('#tcTot').textContent=fmtT(S.total);$('#hdrDur').textContent=fmtT(S.total);
  $('#tlInfo').textContent=S.clips.length+(S.clips.length===1?' clip':' clips')+' · '+S.ovs.length+(S.ovs.length===1?' elemento':' elementos');
}
$('#rowClips').style.marginLeft='12px';$('#rowOvs').style.marginLeft='12px';
