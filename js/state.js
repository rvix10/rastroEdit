export const $=s=>document.querySelector(s);
export const cv=$('#stage');
export const ctx=cv.getContext('2d');
export const panel=$('#panel');
export const tlInner=$('#tlInner');
export const tlScroll=$('#tlScroll');
export const S={W:1280,H:720,aspect:'16:9',clips:[],ovs:[],T:0,total:0,playing:false,last:0,sel:null,selOv:null,tab:'track',pps:70,
  pick:false,showPath:true,tracking:null,trackCancel:false,trackProg:0,exporting:false,result:null,dl:null,hits:[],drag:null,ac:null,adest:null};
export let uid=1;
export const nid=()=>'i'+(uid++);
export const L1=document.createElement('canvas');
export const L2=document.createElement('canvas');
export function sizeLayers(){for(const L of [L1,L2]){L.width=S.W;L.height=S.H} cv.width=S.W; cv.height=S.H}
sizeLayers();
