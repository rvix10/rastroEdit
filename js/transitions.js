import { clamp, hash } from './util.js';

/* ---------- transiciones ---------- */
export function sd(o,L,s,a,W,H,rot){o.save();o.globalAlpha=clamp(a,0,1);o.translate(W/2,H/2);o.rotate(rot);o.scale(s,s);o.drawImage(L,-W/2,-H/2,W,H);o.restore()}
export const BC=document.createElement('canvas');
export function blurDraw(o,L,q,W,H,a){const k=1+q*14;o.globalAlpha=a;if(k<1.05){o.drawImage(L,0,0,W,H);o.globalAlpha=1;return}
  const w=Math.max(2,Math.round(W/k)),h=Math.max(2,Math.round(H/k));BC.width=w;BC.height=h;const b=BC.getContext('2d');b.imageSmoothingEnabled=true;b.drawImage(L,0,0,w,h);
  o.imageSmoothingEnabled=true;o.drawImage(BC,0,0,W,H);o.globalAlpha=1}
export const TR={
  none:{n:'Corte',a:'—'},
  fade:{n:'Fundido',a:'FD',f:(o,A,B,p,W,H)=>{o.drawImage(A,0,0,W,H);o.globalAlpha=p;o.drawImage(B,0,0,W,H);o.globalAlpha=1}},
  flash:{n:'Destello',a:'DS',f:(o,A,B,p,W,H)=>{o.drawImage(p<.5?A:B,0,0,W,H);o.globalAlpha=1-Math.abs(p*2-1);o.fillStyle='#fff';o.fillRect(0,0,W,H);o.globalAlpha=1}},
  slide:{n:'Deslizar',a:'DL',f:(o,A,B,p,W,H)=>{o.drawImage(A,-p*W,0,W,H);o.drawImage(B,(1-p)*W,0,W,H)}},
  push:{n:'Empujar',a:'EM',f:(o,A,B,p,W,H)=>{o.drawImage(A,0,-p*H,W,H);o.drawImage(B,0,(1-p)*H,W,H)}},
  zoom:{n:'Zoom',a:'ZM',f:(o,A,B,p,W,H)=>{o.fillStyle='#000';o.fillRect(0,0,W,H);sd(o,A,1+p*.9,1-p*.9,W,H,0);sd(o,B,1.6-.6*p,p,W,H,0)}},
  spin:{n:'Giro',a:'GR',f:(o,A,B,p,W,H)=>{o.fillStyle='#000';o.fillRect(0,0,W,H);sd(o,A,1-.45*p,1-p,W,H,p*Math.PI*.6);sd(o,B,.55+.45*p,p*1.4,W,H,-(1-p)*Math.PI*.6)}},
  wipe:{n:'Barrido',a:'BR',f:(o,A,B,p,W,H)=>{o.drawImage(A,0,0,W,H);const sk=H*.35,x=-sk+p*(W+sk*2);o.save();o.beginPath();o.moveTo(-1,0);o.lineTo(x+sk,0);o.lineTo(x-sk,H);o.lineTo(-1,H);o.closePath();o.clip();o.drawImage(B,0,0,W,H);o.restore();
    o.strokeStyle='#fff';o.lineWidth=Math.max(2,W*.004);o.beginPath();o.moveTo(x+sk,0);o.lineTo(x-sk,H);o.stroke()}},
  iris:{n:'Círculo',a:'CI',f:(o,A,B,p,W,H)=>{o.drawImage(A,0,0,W,H);o.save();o.beginPath();o.arc(W/2,H/2,Math.max(.1,p*Math.hypot(W,H)/2),0,Math.PI*2);o.clip();o.drawImage(B,0,0,W,H);o.restore()}},
  blur:{n:'Desenfoque',a:'DF',f:(o,A,B,p,W,H)=>{const q=1-Math.abs(p*2-1);blurDraw(o,A,q,W,H,1);const m=clamp((p-.3)/.4,0,1);if(m>0)blurDraw(o,B,q,W,H,m)}},
  glitch:{n:'Glitch',a:'GL',f:(o,A,B,p,W,H)=>{const base=p<.5?A:B,other=p<.5?B:A,amt=1-Math.abs(p*2-1);o.drawImage(base,0,0,W,H);const seed=Math.floor(p*24);
    for(let i=0;i<12;i++){const r1=hash(seed*31+i),r2=hash(seed*17+i*7),r3=hash(seed*7+i*13);if(r3>amt*1.15)continue;const y=Math.floor(r1*H*.95),hh=Math.max(1,Math.min(H-y,Math.floor((.02+r2*.08)*H)));const dx=(r2-.5)*W*.2*amt;o.drawImage(r3<.4?other:base,0,y,W,hh,dx,y,W,hh)}
    o.globalCompositeOperation='lighter';o.globalAlpha=.22*amt;o.drawImage(base,W*.014*amt,0,W,H);o.globalCompositeOperation='source-over';o.globalAlpha=1}}
};
export const FILTERS={none:'Original',calido:'Cálido',frio:'Frío',bn:'B/N',vivido:'Vívido',cine:'Cine'};
export function applyFilter(g,f,W,H){if(f==='none')return;
  if(f==='calido'){g.globalCompositeOperation='soft-light';g.fillStyle='rgba(255,150,60,.6)';g.fillRect(0,0,W,H)}
  else if(f==='frio'){g.globalCompositeOperation='soft-light';g.fillStyle='rgba(70,150,255,.55)';g.fillRect(0,0,W,H)}
  else if(f==='bn'){g.globalCompositeOperation='saturation';g.fillStyle='#777';g.fillRect(0,0,W,H)}
  else if(f==='vivido'){g.globalCompositeOperation='overlay';g.globalAlpha=.45;g.drawImage(g.canvas,0,0)}
  else if(f==='cine'){g.globalCompositeOperation='soft-light';g.fillStyle='rgba(0,140,150,.5)';g.fillRect(0,0,W,H);g.globalCompositeOperation='source-over';
    const v=g.createRadialGradient(W/2,H/2,Math.min(W,H)*.35,W/2,H/2,Math.hypot(W,H)*.6);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(1,'rgba(0,0,0,.6)');g.fillStyle=v;g.fillRect(0,0,W,H)}
  g.globalCompositeOperation='source-over';g.globalAlpha=1}
