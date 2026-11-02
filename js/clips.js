import { $, S, nid } from './state.js';
import { toast } from './util.js';
import { layout } from './timeline.js';
import { renderPanel } from './panel.js';
import { renderTimeline } from './timeline-ui.js';
import { P, storeMedia, commit } from './project.js';
import { DEMOS } from './demo.js';

/* ---------- clips ---------- */
export function coverOf(c) {
  const s = Math.max(S.W / c.sw, S.H / c.sh),
    dw = c.sw * s,
    dh = c.sh * s;
  return { s, dw, dh, dx: (S.W - dw) / 2, dy: (S.H - dh) / 2 };
}
export function mapSrc(c, nx, ny) {
  const m = coverOf(c);
  return { x: m.dx + nx * m.dw, y: m.dy + ny * m.dh };
}
export function demoClip(key) {
  const D = DEMOS[key],
    name = D.name,
    dur = D.dur,
    fn = D.fn;
  const scv = document.createElement('canvas');
  scv.width = 960;
  scv.height = 540;
  const c = {
    id: nid(),
    name,
    kind: 'demo',
    demoKey: key,
    draw: fn,
    scv,
    sg: scv.getContext('2d'),
    sw: 960,
    sh: 540,
    dur,
    in: 0,
    out: dur,
    trans: { type: 'none', d: 0.5 },
    filter: 'none',
    mute: false,
    track: null,
    _lastT: null,
  };
  fn(c.sg, dur * 0.3, 960, 540);
  c.thumb = thumbFrom(c.scv, 960, 540);
  return c;
}
export function thumbFrom(src, sw, sh) {
  const t = document.createElement('canvas');
  t.width = 160;
  t.height = 90;
  const g = t.getContext('2d');
  const s = Math.max(160 / sw, 90 / sh);
  g.drawImage(src, (160 - sw * s) / 2, (90 - sh * s) / 2, sw * s, sh * s);
  try {
    return t.toDataURL('image/jpeg', 0.7);
  } catch (e) {
    return '';
  }
}
export function makeVid(url) {
  const v = document.createElement('video');
  v.src = url;
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.preload = 'auto';
  $('#vids').appendChild(v);
  return v;
}
export function once(el, ev, ms) {
  return new Promise(r => {
    let d = false;
    const f = () => {
      if (d) return;
      d = true;
      el.removeEventListener(ev, f);
      r();
    };
    el.addEventListener(ev, f);
    setTimeout(f, ms);
  });
}
export function seekTo(el, t) {
  return new Promise(res => {
    if (Math.abs(el.currentTime - t) < 0.002 && el.readyState >= 2) return res();
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      el.removeEventListener('seeked', fin);
      clearTimeout(to);
      requestAnimationFrame(() => res());
    };
    el.addEventListener('seeked', fin);
    const to = setTimeout(fin, 1800);
    el.currentTime = t;
  });
}
export function wireAudio(c) {
  if (!S.ac || !c.el || c.gain) return;
  try {
    const s = S.ac.createMediaElementSource(c.el);
    c.gain = S.ac.createGain();
    s.connect(c.gain);
    c.gain.connect(S.ac.destination);
    c.gain.connect(S.adest);
  } catch (e) {}
}
export function ensureAudio() {
  if (!S.ac) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      S.ac = new AC();
      S.adest = S.ac.createMediaStreamDestination();
    } catch (e) {
      S.ac = null;
    }
  }
  S.clips.forEach(wireAudio);
  if (S.ac && S.ac.state === 'suspended') S.ac.resume().catch(() => {});
}

export async function importFiles(list) {
  const files = [...list].filter(f => f.type.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/i.test(f.name));
  if (!files.length) {
    toast('Elige uno o más archivos de video');
    return;
  }
  toast(files.length > 1 ? 'Cargando ' + files.length + ' videos…' : 'Cargando video…');
  for (const f of files) {
    const mediaId = nid(),
      url = URL.createObjectURL(f),
      el = makeVid(url);
    await once(el, 'loadedmetadata', 10000);
    if (!el.duration || !isFinite(el.duration)) {
      toast('No se pudo leer «' + f.name + '». Prueba con MP4 o WebM.');
      el.remove();
      continue;
    }
    try {
      el.muted = true;
      await el.play();
      el.pause();
    } catch (e) {}
    el.muted = false;
    await seekTo(el, Math.min(0.4, el.duration / 2));
    const c = {
      id: nid(),
      name: f.name.replace(/\.[^.]+$/, ''),
      kind: 'video',
      mediaId,
      el,
      sw: el.videoWidth || 1280,
      sh: el.videoHeight || 720,
      dur: el.duration,
      in: 0,
      out: el.duration,
      trans: { type: S.clips.length ? 'fade' : 'none', d: 0.5 },
      filter: 'none',
      mute: false,
      track: null,
    };
    c.thumb = thumbFrom(el, c.sw, c.sh);
    wireAudio(c);
    S.clips.push(c);
    S.sel = c.id;
    await storeMedia(mediaId, f, f.name, url);
  }
  layout();
  renderTimeline();
  renderPanel();
  commit();
}
export function cloneClip(c) {
  const n = {
    ...c,
    id: nid(),
    trans: { ...c.trans },
    track: c.track ? { seed: { ...c.track.seed }, pts: c.track.pts.map(p => ({ ...p })) } : null,
    gain: null,
    _lastT: null,
  };
  if (c.kind === 'video') {
    const md = P.media.get(c.mediaId);
    if (md) {
      n.el = makeVid(md.url);
      n.missing = false;
      wireAudio(n);
    } else {
      n.el = null;
      n.missing = true;
    }
  } else {
    n.scv = document.createElement('canvas');
    n.scv.width = c.sw;
    n.scv.height = c.sh;
    n.sg = n.scv.getContext('2d');
  }
  return n;
}
