/* ---------- demuxer de video (MP4/MOV y WebM/MKV), sin dependencias ----------
   Solo la pista de video y solo el índice: para cada muestra guarda posición, tamaño, tiempo y si es
   keyframe. Los datos se leen después por rebanadas (Blob.slice), sin cargar el archivo entero.
   Devuelve lo que necesita VideoDecoder: { codec, description, codedWidth, codedHeight, rotation, samples }
   samples (en orden de decodificación): { off, size, ts (µs, presentación), key }
   Devuelve null si el formato o el códec no se reconocen.
*/

/** Lector con ventana: lee el Blob de a pedazos y da DataView sobre lo pedido. */
class Reader {
  constructor(blob) {
    this.blob = blob;
    this.size = blob.size;
    this.pos = 0;
    this.buf = new Uint8Array(0);
  }
  async bytes(pos, n) {
    if (pos < this.pos || pos + n > this.pos + this.buf.length) {
      const want = Math.min(this.size - pos, Math.max(n, 1 << 20));
      this.buf = new Uint8Array(await this.blob.slice(pos, pos + want).arrayBuffer());
      this.pos = pos;
    }
    const o = pos - this.pos;
    return this.buf.subarray(o, o + Math.min(n, this.buf.length - o));
  }
}
const dv = b => new DataView(b.buffer, b.byteOffset, b.byteLength);
const hex2 = n => n.toString(16).padStart(2, '0');
const str4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

export async function demux(blob) {
  const r = new Reader(blob);
  const head = await r.bytes(0, 12);
  if (head.length >= 8 && /^(ftyp|moov|mdat|free|skip|wide|pnot)$/.test(str4(head, 4))) return demuxMp4(r);
  if (head.length >= 4 && dv(head).getUint32(0) === 0x1a45dfa3) return demuxWebm(r);
  return null;
}

/* ============================ MP4 / MOV ============================ */
function boxes(b, start = 0, end = b.length) {
  const out = [];
  const d = dv(b);
  for (let p = start; p + 8 <= end; ) {
    let size = d.getUint32(p),
      hdr = 8;
    const type = str4(b, p + 4);
    if (size === 1) {
      size = Number(d.getBigUint64(p + 8));
      hdr = 16;
    } else if (size === 0) size = end - p;
    if (size < hdr) break;
    out.push({ type, start: p + hdr, end: Math.min(end, p + size) });
    p += size;
  }
  return out;
}
const child = (b, box, type) => box && boxes(b, box.start, box.end).find(x => x.type === type);
const path = (b, box, ...types) => types.reduce((x, t) => child(b, x, t), box);

async function demuxMp4(r) {
  // Buscar moov entre las cajas de primer nivel (puede estar al final, después de mdat)
  let moov = null;
  for (let p = 0; p + 8 <= r.size; ) {
    const h = await r.bytes(p, 16),
      d = dv(h);
    let size = d.getUint32(0);
    const type = str4(h, 4);
    if (size === 1) size = Number(d.getBigUint64(8));
    else if (size === 0) size = r.size - p;
    if (size < 8) return null;
    if (type === 'moov') {
      moov = new Uint8Array(await r.blob.slice(p, p + size).arrayBuffer());
      break;
    }
    p += size;
  }
  if (!moov) return null;
  const root = { start: 8, end: moov.length };
  for (const trak of boxes(moov, root.start, root.end).filter(x => x.type === 'trak')) {
    const hdlr = path(moov, trak, 'mdia', 'hdlr');
    if (!hdlr || str4(moov, hdlr.start + 8) !== 'vide') continue;
    return parseTrak(moov, trak);
  }
  return null;
}

function parseTrak(b, trak) {
  const d = dv(b);
  const mdhd = path(b, trak, 'mdia', 'mdhd');
  const v = b[mdhd.start];
  const timescale = d.getUint32(mdhd.start + (v === 1 ? 20 : 12));

  // Rotación: matriz de tkhd (los celulares graban en horizontal y marcan el giro)
  const tkhd = child(b, trak, 'tkhd');
  const mo = tkhd.start + (b[tkhd.start] === 1 ? 52 : 40);
  const ma = d.getInt32(mo),
    mb = d.getInt32(mo + 4);
  let rotation = Math.round((Math.atan2(mb, ma) * 180) / Math.PI);
  rotation = ((rotation % 360) + 360) % 360;

  // Lista de edición: desplazamiento inicial (p. ej. por cuadros B)
  let shift = 0;
  const elst = path(b, trak, 'edts', 'elst');
  if (elst) {
    const ev = b[elst.start],
      n = d.getUint32(elst.start + 4);
    let o = elst.start + 8;
    for (let i = 0; i < n; i++) {
      const mt = ev === 1 ? Number(d.getBigInt64(o + 8)) : d.getInt32(o + 4);
      if (mt >= 0) {
        shift = mt;
        break;
      }
      o += ev === 1 ? 20 : 12;
    }
  }

  const stbl = path(b, trak, 'mdia', 'minf', 'stbl');
  const stsd = child(b, stbl, 'stsd');
  const entry = boxes(b, stsd.start + 8, stsd.end)[0];
  const fourcc = b.subarray(entry.start - 4, entry.start).reduce((s, c) => s + String.fromCharCode(c), '');
  const codedWidth = d.getUint16(entry.start + 24),
    codedHeight = d.getUint16(entry.start + 26);
  const cfgs = boxes(b, entry.start + 78, entry.end);
  const cfg = t => cfgs.find(x => x.type === t);
  let codec = null,
    description;
  const body = x => b.slice(x.start, x.end);
  if ((fourcc === 'avc1' || fourcc === 'avc3') && cfg('avcC')) {
    description = body(cfg('avcC'));
    codec = 'avc1.' + hex2(description[1]) + hex2(description[2]) + hex2(description[3]);
  } else if ((fourcc === 'hvc1' || fourcc === 'hev1') && cfg('hvcC')) {
    description = body(cfg('hvcC'));
    codec = hevcCodec(fourcc, description);
  } else if (fourcc === 'vp09' && cfg('vpcC')) {
    const c = body(cfg('vpcC'));
    codec = `vp09.${String(c[4]).padStart(2, '0')}.${String(c[5]).padStart(2, '0')}.${String(c[6] >> 4).padStart(2, '0')}`;
  } else if (fourcc === 'av01' && cfg('av1C')) {
    description = body(cfg('av1C'));
    codec = av1Codec(description);
  } else if (fourcc === 'vp08') codec = 'vp8';
  if (!codec) return null;

  // Tablas de muestras
  const tbl = t => child(b, stbl, t);
  const stts = tbl('stts'),
    ctts = tbl('ctts'),
    stsc = tbl('stsc'),
    stsz = tbl('stsz'),
    stco = tbl('stco') || tbl('co64'),
    stss = tbl('stss');
  const n = d.getUint32(stsz.start + 8),
    fixed = d.getUint32(stsz.start + 4);
  const sizes = new Array(n);
  for (let i = 0; i < n; i++) sizes[i] = fixed || d.getUint32(stsz.start + 12 + i * 4);
  const dts = new Array(n);
  {
    let i = 0,
      t = 0;
    const e = d.getUint32(stts.start + 4);
    for (let k = 0; k < e; k++) {
      const cnt = d.getUint32(stts.start + 8 + k * 8),
        delta = d.getUint32(stts.start + 12 + k * 8);
      for (let j = 0; j < cnt && i < n; j++, i++) ((dts[i] = t), (t += delta));
    }
    for (; i < n; i++) dts[i] = t;
  }
  const cto = new Int32Array(n);
  if (ctts) {
    const cv = b[ctts.start],
      e = d.getUint32(ctts.start + 4);
    let i = 0;
    for (let k = 0; k < e; k++) {
      const cnt = d.getUint32(ctts.start + 8 + k * 8),
        off = cv === 1 ? d.getInt32(ctts.start + 12 + k * 8) : d.getUint32(ctts.start + 12 + k * 8);
      for (let j = 0; j < cnt && i < n; j++, i++) cto[i] = off;
    }
  }
  let keys = null;
  if (stss) {
    keys = new Set();
    const e = d.getUint32(stss.start + 4);
    for (let k = 0; k < e; k++) keys.add(d.getUint32(stss.start + 8 + k * 4) - 1);
  }
  const is64 = stco.type === 'co64';
  const nChunks = d.getUint32(stco.start + 4);
  const chunkOff = k => (is64 ? Number(d.getBigUint64(stco.start + 8 + k * 8)) : d.getUint32(stco.start + 8 + k * 4));
  const sc = [];
  for (let k = 0, e = d.getUint32(stsc.start + 4); k < e; k++)
    sc.push([d.getUint32(stsc.start + 8 + k * 12) - 1, d.getUint32(stsc.start + 12 + k * 12)]);

  const samples = new Array(n);
  let s = 0;
  for (let k = 0; k < sc.length; k++) {
    const [first, per] = sc[k],
      last = k + 1 < sc.length ? sc[k + 1][0] : nChunks;
    for (let ch = first; ch < last && s < n; ch++) {
      let off = chunkOff(ch);
      for (let j = 0; j < per && s < n; j++, s++) {
        samples[s] = {
          off,
          size: sizes[s],
          ts: Math.round(((dts[s] + cto[s] - shift) * 1e6) / timescale),
          key: keys ? keys.has(s) : true,
        };
        off += sizes[s];
      }
    }
  }
  if (s < n) samples.length = s;
  return { codec, description, codedWidth, codedHeight, rotation, samples };
}

function hevcCodec(fourcc, c) {
  // hvc1.<perfil>.<compatibilidad invertida>.<L|H><nivel>.<restricciones>
  const space = ['', 'A', 'B', 'C'][c[1] >> 6],
    tier = (c[1] >> 5) & 1 ? 'H' : 'L',
    prof = c[1] & 31;
  let compat = ((c[2] << 24) | (c[3] << 16) | (c[4] << 8) | c[5]) >>> 0,
    rev = 0;
  for (let i = 0; i < 32; i++) {
    rev = ((rev << 1) | (compat & 1)) >>> 0;
    compat >>>= 1;
  }
  const cons = [...c.subarray(6, 12)];
  while (cons.length && cons[cons.length - 1] === 0) cons.pop();
  return `${fourcc}.${space}${prof}.${rev.toString(16)}.${tier}${c[12]}${cons.map(x => '.' + x.toString(16)).join('')}`;
}
function av1Codec(c) {
  const prof = c[1] >> 5,
    level = c[1] & 31,
    tier = c[2] >> 7 ? 'H' : 'M',
    bits = (c[2] >> 6) & 1 ? ((c[2] >> 5) & 1 ? 12 : 10) : 8;
  return `av01.${prof}.${String(level).padStart(2, '0')}${tier}.${String(bits).padStart(2, '0')}`;
}

/* ============================ WebM / Matroska ============================ */
const ID = {
  Segment: 0x18538067,
  Info: 0x1549a966,
  TimecodeScale: 0x2ad7b1,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackType: 0x83,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  ReferenceBlock: 0xfb,
};
// Elementos de nivel 1: cierran un Cluster de tamaño desconocido
const LEVEL1 = new Set([0x114d9b74, ID.Info, ID.Tracks, ID.Cluster, 0x1c53bb6b, 0x1043a770, 0x1941a469, 0x1254c367]);

function vint(b, o, keepMarker) {
  const first = b[o];
  let len = 1,
    mask = 0x80;
  while (len <= 8 && !(first & mask)) (len++, (mask >>= 1));
  if (len > 8 || o + len > b.length) return null;
  let v = keepMarker ? first : first & (mask - 1),
    allOnes = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) {
    v = v * 256 + b[o + i];
    if (b[o + i] !== 255) allOnes = false;
  }
  return { v, len, unknown: !keepMarker && allOnes };
}
const uint = b => b.reduce((a, x) => a * 256 + x, 0);

async function demuxWebm(r) {
  // Lee un encabezado de elemento en pos: { id, size (o -1 si es desconocido), data }
  const el = async pos => {
    const h = await r.bytes(pos, 16);
    const id = vint(h, 0, true);
    if (!id) return null;
    const sz = vint(h, id.len);
    if (!sz) return null;
    return { id: id.v, size: sz.unknown ? -1 : sz.v, data: pos + id.len + sz.len };
  };
  let p = 0;
  const ebml = await el(0);
  if (!ebml) return null;
  p = ebml.data + ebml.size;
  const seg = await el(p);
  if (!seg || seg.id !== ID.Segment) return null;
  const segEnd = seg.size < 0 ? r.size : Math.min(r.size, seg.data + seg.size);

  let scale = 1e6,
    track = null;
  const raw = [];
  for (p = seg.data; p < segEnd; ) {
    const e = await el(p);
    if (!e) break;
    if (e.id === ID.Info) {
      const b = await r.bytes(e.data, e.size);
      for (let q = 0; q < b.length; ) {
        const c = vint(b, q, true),
          s = vint(b, q + c.len);
        if (c.v === ID.TimecodeScale) scale = uint(b.subarray(q + c.len + s.len, q + c.len + s.len + s.v));
        q += c.len + s.len + s.v;
      }
    } else if (e.id === ID.Tracks) track = parseTracks(await r.bytes(e.data, e.size));
    else if (e.id === ID.Cluster) {
      if (!track) return null;
      // Recorre el cluster (puede tener tamaño desconocido, como los de MediaRecorder)
      const end = e.size < 0 ? segEnd : e.data + e.size;
      let tc = 0,
        q = e.data;
      while (q < end) {
        const c = await el(q);
        if (!c || (e.size < 0 && LEVEL1.has(c.id))) break;
        if (c.size < 0) break;
        if (c.id === ID.Timecode) tc = uint(await r.bytes(c.data, c.size));
        else if (c.id === ID.SimpleBlock) addBlock(await r.bytes(c.data, 12), c, tc, null);
        else if (c.id === ID.BlockGroup) {
          const g = await r.bytes(c.data, c.size);
          let blk = null,
            ref = false;
          for (let k = 0; k < g.length; ) {
            const gi = vint(g, k, true),
              gs = vint(g, k + gi.len);
            if (gi.v === ID.Block) blk = { data: c.data + k + gi.len + gs.len, size: gs.v };
            if (gi.v === ID.ReferenceBlock) ref = true;
            k += gi.len + gs.len + gs.v;
          }
          if (blk) addBlock(g.subarray(blk.data - c.data, blk.data - c.data + 12), blk, tc, !ref);
        }
        q = c.data + c.size;
      }
      p = q;
      continue;
    }
    if (e.size < 0) break;
    p = e.data + e.size;
  }
  function addBlock(h, c, tc, keyFromGroup) {
    const tn = vint(h, 0);
    if (!tn || tn.v !== track.number) return;
    const o = tn.len,
      rel = ((h[o] << 24) >> 16) | h[o + 1],
      flags = h[o + 2];
    if (flags & 0x06) return; // lacing: no se usa para video
    const hdr = o + 3;
    raw.push({
      off: c.data + hdr,
      size: c.size - hdr,
      ts: Math.round(((tc + rel) * scale) / 1000),
      key: keyFromGroup === null ? !!(flags & 0x80) : keyFromGroup,
    });
  }
  if (!track || !raw.length) return null;
  return { ...track, rotation: 0, samples: raw };
}

function parseTracks(b) {
  for (let q = 0; q < b.length; ) {
    const id = vint(b, q, true),
      sz = vint(b, q + id.len);
    const start = q + id.len + sz.len,
      end = start + sz.v;
    if (id.v === ID.TrackEntry) {
      const t = { number: 0, type: 0, codecId: '', priv: null, w: 0, h: 0 };
      for (let k = start; k < end; ) {
        const ci = vint(b, k, true),
          cs = vint(b, k + ci.len);
        const ds = k + ci.len + cs.len,
          dat = b.subarray(ds, ds + cs.v);
        if (ci.v === ID.TrackNumber) t.number = uint(dat);
        else if (ci.v === ID.TrackType) t.type = uint(dat);
        else if (ci.v === ID.CodecID) t.codecId = String.fromCharCode(...dat).replace(/\0+$/, '');
        else if (ci.v === ID.CodecPrivate) t.priv = dat.slice();
        else if (ci.v === ID.Video)
          for (let m = 0; m < dat.length; ) {
            const vi = vint(dat, m, true),
              vs = vint(dat, m + vi.len);
            const vd = dat.subarray(m + vi.len + vs.len, m + vi.len + vs.len + vs.v);
            if (vi.v === ID.PixelWidth) t.w = uint(vd);
            if (vi.v === ID.PixelHeight) t.h = uint(vd);
            m += vi.len + vs.len + vs.v;
          }
        k = ds + cs.v;
      }
      if (t.type === 1) {
        let codec = null,
          description;
        if (t.codecId === 'V_VP8') codec = 'vp8';
        else if (t.codecId === 'V_VP9') codec = 'vp09.00.10.08';
        else if (t.codecId === 'V_AV1')
          ((codec = t.priv ? av1Codec(t.priv) : 'av01.0.04M.08'), (description = t.priv || undefined));
        else if (t.codecId === 'V_MPEG4/ISO/AVC' && t.priv)
          ((description = t.priv), (codec = 'avc1.' + hex2(t.priv[1]) + hex2(t.priv[2]) + hex2(t.priv[3])));
        if (!codec) return null;
        return { number: t.number, codec, description, codedWidth: t.w, codedHeight: t.h };
      }
    }
    q = end;
  }
  return null;
}
