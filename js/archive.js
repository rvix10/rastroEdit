/* ---------- zip mínimo para archivos .rastro ----------
   Escribe sin comprimir (los videos ya vienen comprimidos) y lee tanto sin comprimir como
   "deflate" (si alguien vuelve a comprimir el archivo con otra herramienta).
   Al leer no copia nada: cada entrada es una rebanada (Blob.slice) del archivo original,
   así que un proyecto de varios GB no se carga entero en memoria.
   Límite: 4 GB en total y 65 535 entradas (sin ZIP64).
*/
const enc = new TextEncoder(),
  dec = new TextDecoder();
const MAX = 0xffffffff;

let TABLE = null;
function crcTable() {
  if (TABLE) return TABLE;
  TABLE = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    TABLE[n] = c >>> 0;
  }
  return TABLE;
}
export function crc32(bytes, crc = 0) {
  const T = crcTable();
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = T[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
async function crcOf(data, onBytes) {
  if (data instanceof Uint8Array) {
    onBytes(data.length);
    return crc32(data);
  }
  let crc = 0;
  const CH = 4 << 20; // 4 MB por vuelta
  for (let o = 0; o < data.size; o += CH) {
    const part = new Uint8Array(await data.slice(o, o + CH).arrayBuffer());
    crc = crc32(part, crc);
    onBytes(part.length);
  }
  return crc;
}

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/**
 * Arma un zip. entries: [{ name, data: Blob | Uint8Array | string }].
 * onProgress(0..1) se llama mientras se calcula el CRC de los datos.
 */
export async function zip(entries, onProgress = () => {}) {
  const items = entries.map(e => ({
    name: enc.encode(e.name),
    data: typeof e.data === 'string' ? enc.encode(e.data) : e.data,
  }));
  const sizeOf = d => (d instanceof Uint8Array ? d.length : d.size);
  const total = items.reduce((a, it) => a + sizeOf(it.data), 0);
  if (items.length > 0xffff || total + items.length * 200 > MAX) throw new Error('too-big');

  const { time, date } = dosTime(new Date());
  const parts = [],
    central = [];
  let offset = 0,
    done = 0;
  for (const it of items) {
    const size = sizeOf(it.data);
    const crc = await crcOf(it.data, n => {
      done += n;
      onProgress(total ? done / total : 1);
    });
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true); // versión necesaria
    lh.setUint16(6, 0x0800, true); // nombres en UTF-8
    lh.setUint16(8, 0, true); // sin comprimir
    lh.setUint16(10, time, true);
    lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, size, true);
    lh.setUint32(22, size, true);
    lh.setUint16(26, it.name.length, true);
    lh.setUint16(28, 0, true);
    parts.push(lh.buffer, it.name, it.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, time, true);
    ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, size, true);
    ch.setUint32(24, size, true);
    ch.setUint16(28, it.name.length, true);
    ch.setUint32(42, offset, true);
    central.push(ch.buffer, it.name);
    offset += 30 + it.name.length + size;
  }
  const cdSize = central.reduce((a, b) => a + (b.byteLength ?? b.length), 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, items.length, true);
  end.setUint16(10, items.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  onProgress(1);
  return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
}

/** Lee un zip y devuelve Map(nombre → Blob). Lanza Error('not-zip') o Error('unsupported'). */
export async function unzip(file) {
  const tailLen = Math.min(file.size, 22 + 0xffff);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--)
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('not-zip');
  const count = tail.getUint16(eocd + 10, true),
    cdSize = tail.getUint32(eocd + 12, true),
    cdOff = tail.getUint32(eocd + 16, true);
  if (cdOff === MAX || count === 0xffff) throw new Error('unsupported'); // ZIP64
  const cd = new DataView(await file.slice(cdOff, cdOff + cdSize).arrayBuffer());
  const out = new Map();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw new Error('not-zip');
    const flags = cd.getUint16(p + 8, true),
      method = cd.getUint16(p + 10, true),
      csize = cd.getUint32(p + 20, true),
      nlen = cd.getUint16(p + 28, true),
      xlen = cd.getUint16(p + 30, true),
      clen = cd.getUint16(p + 32, true),
      lho = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nlen));
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    if (flags & 1) throw new Error('unsupported'); // cifrado
    const lh = new DataView(await file.slice(lho, lho + 30).arrayBuffer());
    if (lh.getUint32(0, true) !== 0x04034b50) throw new Error('not-zip');
    const start = lho + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    const raw = file.slice(start, start + csize);
    if (method === 0) out.set(name, raw);
    else if (method === 8 && typeof DecompressionStream !== 'undefined')
      out.set(name, await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob());
    else throw new Error('unsupported');
  }
  return out;
}
