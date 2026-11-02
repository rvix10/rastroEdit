/* ---------- muxer MP4 mínimo (sin dependencias) ----------
   Junta lo que entregan VideoEncoder / AudioEncoder en un .mp4 normal (no fragmentado):
   ftyp · mdat (se escribe a medida que llegan las muestras, con el audio intercalado por tiempo) · moov al final.
   Video: avc1 (H.264, con avcC del encoder), vp09 (VP9) o av01 (AV1, si el encoder da av1C).
   Audio: mp4a (AAC, con esds) u Opus (dOps).
   Supone que el encoder no reordena cuadros (sin cuadros B), que es lo que hace WebCodecs hoy.
*/
const te = new TextEncoder();
const u8 = (...a) => new Uint8Array(a);
const u16 = n => u8((n >> 8) & 255, n & 255);
const u24 = n => u8((n >> 16) & 255, (n >> 8) & 255, n & 255);
const u32 = n => u8((n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
const u64 = n => {
  const hi = Math.floor(n / 2 ** 32);
  return cat(u32(hi), u32(n - hi * 2 ** 32));
};
const str = s => te.encode(s);
const zeros = n => new Uint8Array(n);
function cat(...parts) {
  const flat = parts.flat(Infinity);
  const out = new Uint8Array(flat.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of flat) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const box = (type, ...parts) => {
  const body = cat(...parts);
  return cat(u32(8 + body.length), str(type), body);
};
const full = (type, version, flags, ...parts) => box(type, u8(version), u24(flags), ...parts);
const MATRIX = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32);
const toBytes = d =>
  d instanceof Uint8Array
    ? d
    : ArrayBuffer.isView(d)
      ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
      : new Uint8Array(d);

/** vpcC a partir de "vp09.PP.LL.DD" (perfil, nivel, profundidad de bits). */
function vpcC(codec) {
  const [, p = '00', l = '10', d = '08'] = codec.split('.');
  // 4:2:0 con muestras de croma alineadas (1), rango limitado, BT.709
  return full('vpcC', 1, 0, u8(+p, +l, (+d << 4) | (1 << 1) | 0, 1, 1, 1), u16(0));
}
function esds(asc) {
  const desc = (tag, body) => cat(u8(tag, body.length), body);
  const dsi = desc(5, asc);
  const dcd = desc(4, cat(u8(0x40, 0x15), u24(0), u32(0), u32(0), dsi));
  return full('esds', 0, 0, desc(3, cat(u16(1), u8(0), dcd, desc(6, u8(2)))));
}
function dOps(channels, sampleRate, head) {
  // Si el encoder da un OpusHead, de ahí sale el pre-skip (little-endian en el byte 10)
  const preSkip = head && head.length >= 12 ? head[10] | (head[11] << 8) : 312;
  return box('dOps', u8(0, channels), u16(preSkip), u32(sampleRate), u16(0), u8(0));
}

/** Destino en memoria: el archivo se arma como Blob al final. */
export class MemorySink {
  constructor() {
    this.parts = [];
    this.pending = 0;
  }
  write(data) {
    this.parts.push(data);
  }
  /** Sobrescribe bytes ya escritos (solo se usa para el encabezado de mdat). */
  patch(pos, bytes) {
    let o = 0;
    for (const p of this.parts) {
      if (pos >= o && pos + bytes.length <= o + p.length) return p.set(bytes, pos - o);
      o += p.length;
    }
    throw new Error('Posición fuera del archivo');
  }
  async flushed() {}
  async close() {
    return new Blob(this.parts, { type: 'video/mp4' });
  }
  async discard() {
    this.parts = [];
  }
}

/**
 * Destino en disco: Origin Private File System del navegador. El video no queda en memoria
 * (a 4K son ~4 MB por segundo); al cerrar devuelve un File que se puede reproducir y descargar.
 */
export class OpfsSink {
  static async create(name) {
    const root = await navigator.storage.getDirectory();
    const fh = await root.getFileHandle(name, { create: true });
    const w = await fh.createWritable({ keepExistingData: false });
    return new OpfsSink(root, fh, w, name);
  }
  constructor(root, fh, w, name) {
    Object.assign(this, { root, fh, w, name, q: Promise.resolve(), err: null, pending: 0 });
  }
  _queue(fn, n) {
    this.pending += n;
    this.q = this.q
      .then(fn)
      .catch(e => (this.err = this.err || e))
      .finally(() => (this.pending -= n));
  }
  write(data) {
    this._queue(() => this.w.write(data), data.length);
  }
  patch(pos, bytes) {
    this._queue(() => this.w.write({ type: 'write', position: pos, data: bytes }), bytes.length);
  }
  /** Espera a que lo encolado llegue al disco (para no acumular en memoria si el disco va más lento). */
  async flushed() {
    await this.q;
    if (this.err) throw this.err;
  }
  async close() {
    await this.flushed();
    await this.w.close();
    return this.fh.getFile();
  }
  async discard() {
    try {
      await this.q;
      await this.w.abort();
    } catch (e) {}
    try {
      await this.root.removeEntry(this.name);
    } catch (e) {}
  }
}

export class Mp4Muxer {
  /**
   * Escribe el .mp4 a medida que llegan las muestras: ftyp · mdat (video con el audio intercalado por tiempo) · moov.
   * @param {{ video: { codec, width, height }, audio?: { codec, sampleRate, channels } | null, sink?: MemorySink | OpfsSink }} o
   */
  constructor({ video, audio = null, sink = new MemorySink() }) {
    this.sink = sink;
    this.tracks = [{ kind: 'video', ...video, timescale: 90000, samples: [], desc: null }];
    if (audio) this.tracks.push({ kind: 'audio', ...audio, timescale: audio.sampleRate, samples: [], desc: null });
    this.pendingAudio = [];
    this.videoTs = null;
    this.off = 0;
  }
  _read(t, chunk, meta) {
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !t.desc)
      t.desc = toBytes(meta.decoderConfig.description).slice();
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    return { data, s: { ts: chunk.timestamp, dur: chunk.duration || 0, key: chunk.type === 'key' } };
  }
  _write(t, s, data) {
    if (!this.off) {
      const ftyp = box('ftyp', str('isom'), u32(512), str('isom'), str('iso2'), str('avc1'), str('mp41'));
      this.sink.write(ftyp);
      this.mdatPos = ftyp.length;
      // mdat con tamaño de 64 bits (size = 1): se completa al final, sin importar cuánto pese
      this.sink.write(cat(u32(1), str('mdat'), u64(0)));
      this.off = ftyp.length + 16;
    }
    s.off = this.off;
    s.size = data.length;
    this.sink.write(data);
    this.off += data.length;
    t.samples.push(s);
  }
  _flushAudio(upto) {
    const t = this.tracks[1];
    while (this.pendingAudio.length && this.pendingAudio[0].s.ts <= upto) {
      const a = this.pendingAudio.shift();
      this._write(t, a.s, a.data);
    }
  }
  addVideo(chunk, meta) {
    const { data, s } = this._read(this.tracks[0], chunk, meta);
    this._flushAudio(s.ts);
    this._write(this.tracks[0], s, data);
    this.videoTs = s.ts;
  }
  addAudio(chunk, meta) {
    const t = this.tracks[1];
    if (!t) return;
    this.pendingAudio.push(this._read(t, chunk, meta));
    if (this.videoTs !== null) this._flushAudio(this.videoTs);
  }

  _entry(t) {
    if (t.kind === 'video') {
      const c = t.codec;
      let fourcc, cfg;
      if (c.startsWith('avc1')) {
        if (!t.desc) throw new Error('El encoder no entregó la configuración H.264 (avcC)');
        ((fourcc = 'avc1'), (cfg = box('avcC', t.desc)));
      } else if (c.startsWith('vp09')) ((fourcc = 'vp09'), (cfg = vpcC(c)));
      else if (c.startsWith('av01')) {
        if (!t.desc) throw new Error('El encoder no entregó la configuración AV1 (av1C)');
        ((fourcc = 'av01'), (cfg = box('av1C', t.desc)));
      } else throw new Error('Códec de video no soportado: ' + c);
      return box(
        fourcc,
        zeros(6),
        u16(1),
        zeros(16),
        u16(t.width),
        u16(t.height),
        u32(0x00480000),
        u32(0x00480000),
        u32(0),
        u16(1),
        zeros(32),
        u16(0x0018),
        u16(0xffff),
        cfg
      );
    }
    const isAac = t.codec.startsWith('mp4a');
    const cfg = isAac ? esds(t.desc || u8()) : dOps(t.channels, t.sampleRate, t.desc);
    return box(
      isAac ? 'mp4a' : 'Opus',
      zeros(6),
      u16(1),
      zeros(8),
      u16(t.channels),
      u16(16),
      u32(0),
      u32(t.sampleRate * 65536),
      cfg
    );
  }

  /** Cierra el archivo (escribe moov). Devuelve un Blob (memoria) o un File (disco). */
  async finish() {
    this._flushAudio(Infinity);
    const tracks = this.tracks.filter(t => t.samples.length);
    if (!this.tracks[0].samples.length) throw new Error('No hay cuadros de video');
    // Duraciones en la escala de cada pista, a partir de las marcas de tiempo (µs)
    for (const t of tracks) {
      const s = t.samples,
        k = t.timescale / 1e6;
      for (let i = 0; i < s.length; i++) {
        const next = i + 1 < s.length ? s[i + 1].ts : s[i].ts + (s[i].dur || (s[i - 1] ? s[i].ts - s[i - 1].ts : 0));
        s[i].d = Math.max(1, Math.round(next * k) - Math.round(s[i].ts * k));
      }
      t.total = s.reduce((a, x) => a + x.d, 0);
    }
    const big = this.off > 0xffffffff; // posiciones de 64 bits (co64) si el archivo pasa de 4 GB
    const movieDur = Math.max(...tracks.map(t => Math.round((t.total / t.timescale) * 1000)));
    const traks = tracks.map((t, i) => {
      const id = i + 1,
        s = t.samples,
        isV = t.kind === 'video';
      const stts = [];
      for (const x of s) {
        const last = stts[stts.length - 1];
        if (last && last[1] === x.d) last[0]++;
        else stts.push([1, x.d]);
      }
      const keys = isV ? s.map((x, j) => (x.key ? j + 1 : 0)).filter(Boolean) : null;
      const stbl = box(
        'stbl',
        full('stsd', 0, 0, u32(1), this._entry(t)),
        full(
          'stts',
          0,
          0,
          u32(stts.length),
          stts.map(([n, d]) => cat(u32(n), u32(d)))
        ),
        keys && keys.length < s.length ? full('stss', 0, 0, u32(keys.length), keys.map(u32)) : u8(),
        full('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
        full(
          'stsz',
          0,
          0,
          u32(0),
          u32(s.length),
          s.map(x => u32(x.size))
        ),
        big
          ? full(
              'co64',
              0,
              0,
              u32(s.length),
              s.map(x => u64(x.off))
            )
          : full(
              'stco',
              0,
              0,
              u32(s.length),
              s.map(x => u32(x.off))
            )
      );
      const minf = box(
        'minf',
        isV ? full('vmhd', 0, 1, zeros(8)) : full('smhd', 0, 0, zeros(4)),
        box('dinf', full('dref', 0, 0, u32(1), full('url ', 0, 1))),
        stbl
      );
      const mdia = box(
        'mdia',
        full('mdhd', 0, 0, u32(0), u32(0), u32(t.timescale), u32(t.total), u16(0x55c4), u16(0)),
        full(
          'hdlr',
          0,
          0,
          u32(0),
          str(isV ? 'vide' : 'soun'),
          zeros(12),
          str(isV ? 'VideoHandler\0' : 'SoundHandler\0')
        ),
        minf
      );
      const tkhd = full(
        'tkhd',
        0,
        3,
        u32(0),
        u32(0),
        u32(id),
        u32(0),
        u32(Math.round((t.total / t.timescale) * 1000)),
        zeros(8),
        u16(0),
        u16(isV ? 0 : 1),
        u16(isV ? 0 : 0x0100),
        u16(0),
        MATRIX,
        u32(isV ? t.width * 65536 : 0),
        u32(isV ? t.height * 65536 : 0)
      );
      return box('trak', tkhd, mdia);
    });
    const mvhd = full(
      'mvhd',
      0,
      0,
      u32(0),
      u32(0),
      u32(1000),
      u32(movieDur),
      u32(0x00010000),
      u16(0x0100),
      zeros(10),
      MATRIX,
      zeros(24),
      u32(tracks.length + 1)
    );
    const moov = box('moov', mvhd, ...traks);
    this.sink.write(moov);
    // Tamaño real de mdat (encabezado de 64 bits reservado al empezar)
    this.sink.patch(this.mdatPos + 8, u64(this.off - this.mdatPos));
    return this.sink.close();
  }
}
