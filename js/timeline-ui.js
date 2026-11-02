import { $, tlInner, tlScroll, S } from './state.js';
import { esc, fmtS, fmtT } from './util.js';
import { layout } from './timeline.js';
import { TR } from './transitions.js';
import { act } from './actions.js';

/* ---------- UI: línea de tiempo ---------- */
export function renderTimeline() {
  layout();
  const pps = S.pps;
  // Margen después del final: deja hacer zoom o arrastrar clips cerca del final sin que el scroll se trabe
  const width = Math.max(S.total * pps + Math.max(200, tlScroll.clientWidth * 0.6), tlScroll.clientWidth);
  tlInner.style.width = width + 'px';
  const tEnd = (width - 12) / pps;
  let r = '';
  const step = pps < 35 ? 2 : 1;
  for (let s = 0; s <= tEnd; s += step) r += `<span class="tick" style="left:${s * pps + 12}px">${s}s</span>`;
  if (pps >= 50)
    for (let s = 0.5; s <= tEnd; s += 1) r += `<span class="tick m" style="left:${s * pps + 12}px"></span>`;
  $('#ruler').innerHTML = r;
  let cl = S.clips
    .map(
      c =>
        `<div class="clip${c.id === S.sel ? ' sel' : ''}" data-id="${c.id}" data-act="selclip:${c.id}" style="left:${c._start * pps}px;width:${c._len * pps}px;background-image:url('${c.thumb}')">${c._d ? `<i class="tz" style="width:${c._d * pps}px"></i>` : ''}${c.id === S.sel ? '<i class="th l" data-trim="l" aria-hidden="true"></i><i class="th r" data-trim="r" aria-hidden="true"></i>' : ''}<b>${esc(c.name)}${c.track && c.track.pts.length > 1 ? '<em class="tb">RASTREO</em>' : ''}${c.missing ? '<em class="tb miss">FALTA</em>' : ''}</b><span class="dur">${fmtS(c._len)}</span></div>`
    )
    .join('');
  S.clips.forEach((c, i) => {
    if (!i) return;
    // Junto al clip seleccionado la insignia sube al filo superior: deja libres sus bordes de recorte
    const up = c.id === S.sel || S.clips[i - 1].id === S.sel;
    cl += `<button class="tbtn${c.trans.type === 'none' ? ' none' : ''}${up ? ' up' : ''}" data-act="seltrans:${c.id}" style="left:${(c._start + c._d / 2) * pps}px" title="Transición: ${TR[c.trans.type].n}" aria-label="Transición: ${TR[c.trans.type].n}">${TR[c.trans.type].a}</button>`;
  });
  $('#rowClips').innerHTML = cl;
  // Música de fondo: una barra bajo los clips (se corta donde termina la canción si no se repite)
  const m = S.music,
    rm = $('#rowMus');
  if (m) {
    const len = m.loop ? S.total : Math.max(0, Math.min(S.total, m.dur - m.in));
    // Marcas donde la canción vuelve a empezar
    let loops = '';
    if (m.loop && m.dur > 0)
      for (let t = m.dur - m.in; t < S.total; t += m.dur) loops += `<i style="left:${t * pps}px"></i>`;
    rm.innerHTML = `<div class="mbar${m.missing ? ' miss' : ''}" data-act="music" style="width:${Math.max(24, len * pps)}px" title="Música de fondo">${loops}<b>♪ ${esc(m.name)}</b><span>${m.missing ? 'FALTA' : Math.round(m.vol * 100) + ' %'}</span></div>`;
    rm.hidden = false;
  } else {
    rm.innerHTML = '';
    rm.hidden = true;
  }
  const lanes = [];
  let oh = '';
  for (const o of S.ovs) {
    const c = S.clips.find(k => k.id === o.clipId);
    if (!c) continue;
    const a = c._start + Math.max(o.t0, c.in) - c.in,
      b = c._start + Math.min(o.t1, c.out) - c.in;
    if (b <= a) continue;
    let ln = lanes.findIndex(e => e <= a);
    if (ln < 0) {
      ln = lanes.length;
      lanes.push(0);
    }
    lanes[ln] = b + 0.05;
    const nm = o.kind === 'ring' ? 'Aro' : o.kind === 'sticker' ? o.text : o.text.split('\n')[0] || 'Texto';
    oh += `<div class="ovb${o.follow ? ' f' : ''}${o.id === S.selOv ? ' sel' : ''}" data-act="selov:${o.id}" style="left:${a * pps}px;width:${Math.max(18, (b - a) * pps)}px;top:${ln * 24}px">${esc(nm)}</div>`;
  }
  const ro = $('#rowOvs');
  ro.innerHTML = oh;
  ro.style.height = Math.max(1, lanes.length) * 24 + 'px';
  $('#tcTot').textContent = fmtT(S.total);
  $('#hdrDur').textContent = fmtT(S.total);
  $('#tlInfo').textContent =
    S.clips.length +
    (S.clips.length === 1 ? ' clip' : ' clips') +
    ' · ' +
    S.ovs.length +
    (S.ovs.length === 1 ? ' elemento' : ' elementos');
}
$('#rowClips').style.marginLeft = '12px';
$('#rowOvs').style.marginLeft = '12px';
$('#rowMus').style.marginLeft = '12px';
