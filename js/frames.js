/* ---------- cuadros exactos de un video con VideoDecoder ----------
   Para exportar: en vez de hacer seek en un <video> por cada cuadro (cada seek decodifica desde el
   keyframe anterior), se decodifica la pista en orden y se entrega el cuadro visible en cada instante.
   Pedir tiempos crecientes es lo rápido; si se pide un tiempo anterior o muy adelante, se reposiciona
   desde el keyframe más cercano.
*/
import { demux } from './demux.js';

const AHEAD = 6; // cuadros decodificados (o en vuelo) por delante como máximo
const JUMP = 2e6; // µs: más allá de esto conviene reposicionar en vez de decodificar de corrido

export class FrameSource {
  /** Devuelve una FrameSource lista, o null si el archivo o el códec no se pueden decodificar aquí. */
  static async open(blob) {
    if (!('VideoDecoder' in window)) return null;
    let info;
    try {
      info = await demux(blob);
    } catch (e) {
      return null;
    }
    if (!info || !info.samples.length) return null;
    const config = { codec: info.codec, codedWidth: info.codedWidth, codedHeight: info.codedHeight };
    if (info.description) config.description = info.description;
    try {
      if (!(await VideoDecoder.isConfigSupported(config)).supported) return null;
    } catch (e) {
      return null;
    }
    return new FrameSource(blob, info, config);
  }

  constructor(blob, info, config) {
    this.blob = blob;
    this.info = info;
    this.config = config;
    this.rotation = info.rotation || 0;
    this.samples = info.samples;
    // Orden de presentación para buscar el keyframe y el último cuadro
    this.keys = [];
    this.samples.forEach((s, i) => s.key && this.keys.push(i));
    this.queue = []; // VideoFrames ya decodificados, en orden de presentación
    this.cur = null; // cuadro que se está mostrando
    this.next = 0; // próxima muestra a enviar al decodificador
    this.flushed = false;
    this.drained = false;
    this.error = null;
    this.wake = null;
    this.chunkCache = { off: -1, buf: null };
    this._newDecoder();
  }

  _newDecoder() {
    if (this.dec && this.dec.state !== 'closed') this.dec.close();
    this.dec = new VideoDecoder({
      output: f => {
        this.queue.push(f);
        this.queue.sort((a, b) => a.timestamp - b.timestamp);
        this._poke();
      },
      error: e => {
        this.error = e;
        this._poke();
      },
    });
    this.dec.configure(this.config);
  }
  _poke() {
    const w = this.wake;
    this.wake = null;
    if (w) w();
  }
  _waitOutput() {
    return new Promise(r => {
      this.wake = r;
      setTimeout(() => this._poke(), 200); // por si el decodificador no avisa
    });
  }

  /** Lee los datos de la muestra i (agrupa lecturas cercanas para no hacer una por cuadro). */
  async _data(i) {
    const s = this.samples[i],
      c = this.chunkCache;
    if (!(c.buf && s.off >= c.off && s.off + s.size <= c.off + c.buf.length)) {
      let end = s.off + s.size;
      for (let j = i + 1; j < this.samples.length && j < i + 60; j++) {
        const t = this.samples[j];
        if (t.off < s.off || t.off + t.size - s.off > 8 << 20) break;
        end = Math.max(end, t.off + t.size);
      }
      c.off = s.off;
      c.buf = new Uint8Array(await this.blob.slice(s.off, end).arrayBuffer());
    }
    return c.buf.subarray(s.off - c.off, s.off - c.off + s.size);
  }

  /** Reposiciona para poder mostrar t (µs): decodifica desde el keyframe anterior. */
  _seek(t) {
    this._dropAll();
    let k = this.keys[0] || 0;
    for (const i of this.keys) {
      if (this.samples[i].ts <= t) k = i;
      else break;
    }
    this.next = k;
    this.flushed = false;
    this.drained = false;
    this._newDecoder();
  }
  _dropAll() {
    for (const f of this.queue) f.close();
    this.queue = [];
    if (this.cur) this.cur.close();
    this.cur = null;
  }

  async _feed() {
    while (
      this.next < this.samples.length &&
      this.queue.length + this.dec.decodeQueueSize < AHEAD &&
      this.dec.state === 'configured'
    ) {
      const i = this.next++,
        s = this.samples[i];
      const data = await this._data(i);
      this.dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: s.ts, data }));
    }
    if (this.next >= this.samples.length && !this.flushed && this.dec.state === 'configured') {
      this.flushed = true;
      const dec = this.dec;
      dec.flush().then(
        () => {
          if (dec === this.dec) this.drained = true;
          this._poke();
        },
        () => {}
      );
    }
  }

  /**
   * Cuadro visible en t segundos (el último con marca de tiempo ≤ t). El cuadro sigue siendo de la
   * FrameSource: se puede dibujar hasta la próxima llamada, no hay que cerrarlo.
   */
  async frameAt(sec) {
    if (this.error) throw this.error;
    const t = Math.round(sec * 1e6) + 1000; // 1 ms de tolerancia por redondeo
    const curTs = this.cur ? this.cur.timestamp : -Infinity;
    const head = this.queue.length ? this.queue[this.queue.length - 1].timestamp : curTs;
    if (t < curTs || (t > head + JUMP && t > curTs + JUMP) || this.dec.state === 'closed') this._seek(t);

    for (let guard = 0; guard < 10000; guard++) {
      if (this.error) throw this.error;
      // Avanzar: todo cuadro de la cola con ts ≤ t reemplaza al actual
      while (this.queue.length && this.queue[0].timestamp <= t) {
        if (this.cur) this.cur.close();
        this.cur = this.queue.shift();
      }
      const ended = this.drained;
      // Antes del primer cuadro (p. ej. por una lista de edición): se muestra el primero
      if (!this.cur && this.queue.length && this.queue[0].timestamp > t) this.cur = this.queue.shift();
      // Listo si ya hay un cuadro posterior a t en la cola, o si no vendrán más
      if (this.cur && (this.queue.length || ended)) return this.cur;
      if (ended) return this.cur;
      await this._feed();
      if (!this.queue.length || this.queue[0].timestamp > t) {
        if (this.cur && this.queue.length) continue;
        await this._waitOutput();
      }
    }
    return this.cur;
  }

  close() {
    this._dropAll();
    if (this.dec && this.dec.state !== 'closed') this.dec.close();
  }
}

/** Dibuja un cuadro aplicando la rotación del archivo (grados en sentido horario). */
export function drawRotated(g, frame, rotation, dx, dy, dw, dh) {
  if (!rotation) return g.drawImage(frame, dx, dy, dw, dh);
  g.save();
  g.translate(dx + dw / 2, dy + dh / 2);
  g.rotate((rotation * Math.PI) / 180);
  const sw = rotation % 180 ? dh : dw,
    sh = rotation % 180 ? dw : dh;
  g.drawImage(frame, -sw / 2, -sh / 2, sw, sh);
  g.restore();
}
