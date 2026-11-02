import { S } from './state.js';
import { clamp } from './util.js';

/* ---------- línea de tiempo: cálculo ---------- */
export function layout(){let end=0;S.clips.forEach((c,i)=>{const len=Math.max(.1,c.out-c.in);let d=0;
  if(i>0&&c.trans.type!=='none'){const p=S.clips[i-1];d=Math.min(c.trans.d,len/2,(p.out-p.in)/2)}
  c._d=d;c._len=len;c._start=i===0?0:end-d;end=c._start+len});S.total=end;S.T=clamp(S.T,0,S.total)}
export function activeAt(T){const t=Math.min(T,S.total-1e-4);return S.clips.filter(c=>t>=c._start&&t<c._start+c._len)}
export const localOf=(c,T)=>c.in+clamp(T-c._start,0,c._len-1e-3);
