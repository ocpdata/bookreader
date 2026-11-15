import { Readable } from 'node:stream';

const MAX_BOX_BYTES = 64 * 1024 * 1024;

/** Busca el primer hijo `type` dentro de un contenedor (sin descender). */
function children(buf: Buffer, start = 0, end = buf.length): { type: string; start: number; end: number }[] {
  const out: { type: string; start: number; end: number }[] = [];
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) break;
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) break;
    out.push({ type, start: pos + header, end: pos + size });
    pos += size;
  }
  return out;
}

const find = (buf: Buffer, parent: { start: number; end: number }, type: string) =>
  children(buf, parent.start, parent.end).find((box) => box.type === type);

function timescaleOf(moov: Buffer): number | null {
  const root = { start: 0, end: moov.length };
  for (const trak of children(moov, root.start, root.end).filter((box) => box.type === 'trak')) {
    const mdia = find(moov, trak, 'mdia');
    const mdhd = mdia && find(moov, mdia, 'mdhd');
    if (!mdhd) continue;
    const timescale = moov.readUInt32BE(mdhd.start + (moov[mdhd.start] === 1 ? 20 : 12));
    if (timescale > 0) return timescale;
  }
  return null;
}

function trexDefaultDuration(moov: Buffer): number {
  const mvex = find(moov, { start: 0, end: moov.length }, 'mvex');
  const trex = mvex && find(moov, mvex, 'trex');
  return trex ? moov.readUInt32BE(trex.start + 12) : 0;
}

/** Suma las duraciones (en unidades del timescale) de las muestras de un `moof`. */
function fragmentTicks(moof: Buffer, defaultDuration: number): number {
  let total = 0;
  for (const traf of children(moof).filter((box) => box.type === 'traf')) {
    let trackDefault = defaultDuration;
    const tfhd = find(moof, traf, 'tfhd');
    if (tfhd) {
      const flags = moof.readUInt32BE(tfhd.start) & 0xffffff;
      let offset = tfhd.start + 8;
      if (flags & 0x1) offset += 8;
      if (flags & 0x2) offset += 4;
      if (flags & 0x8) trackDefault = moof.readUInt32BE(offset);
    }
    for (const trun of children(moof, traf.start, traf.end).filter((box) => box.type === 'trun')) {
      const flags = moof.readUInt32BE(trun.start) & 0xffffff;
      const count = moof.readUInt32BE(trun.start + 4);
      if (!(flags & 0x100)) {
        total += count * trackDefault;
        continue;
      }
      let offset = trun.start + 8;
      if (flags & 0x1) offset += 4;
      if (flags & 0x4) offset += 4;
      const stride = 4 + (flags & 0x200 ? 4 : 0) + (flags & 0x400 ? 4 : 0) + (flags & 0x800 ? 4 : 0);
      for (let i = 0; i < count && offset + stride <= trun.end; i++, offset += stride) total += moof.readUInt32BE(offset);
    }
  }
  return total;
}

/**
 * Duración en segundos de un MP4 fragmentado (DASH, p. ej. descargas de YouTube sin remuxar), donde la
 * cabecera `moov` declara duración 0 y el tiempo real está repartido en los `moof`. Lee el flujo una sola
 * vez: guarda `moov` y cada `moof` (pequeños) y descarta `mdat`. Devuelve null si no es un MP4 fragmentado.
 */
export async function fragmentedMp4Duration(stream: Readable): Promise<number | null> {
  let pending: Buffer = Buffer.alloc(0);
  let skip = 0;
  let timescale: number | null = null;
  let defaultDuration = 0;
  let ticks = 0;
  let fragments = 0;

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    let data = chunk;
    if (skip > 0) {
      const dropped = Math.min(skip, data.length);
      skip -= dropped;
      data = data.subarray(dropped);
    }
    if (data.length) pending = pending.length ? Buffer.concat([pending, data]) : data;

    while (skip === 0 && pending.length >= 8) {
      let size = pending.readUInt32BE(0);
      const type = pending.toString('latin1', 4, 8);
      let header = 8;
      if (size === 1) {
        if (pending.length < 16) break;
        size = Number(pending.readBigUInt64BE(8));
        header = 16;
      }
      if (size < header) return null;

      if (type === 'moov' || type === 'moof') {
        if (size > MAX_BOX_BYTES) return null;
        if (pending.length < size) break;
        const body = pending.subarray(header, size);
        if (type === 'moov') {
          timescale = timescaleOf(body);
          defaultDuration = trexDefaultDuration(body);
        } else {
          ticks += fragmentTicks(body, defaultDuration);
          fragments++;
        }
        pending = pending.subarray(size);
      } else if (size === 0) {
        return finish();
      } else if (pending.length >= size) {
        pending = pending.subarray(size);
      } else {
        skip = size - pending.length;
        pending = Buffer.alloc(0);
      }
    }
  }
  return finish();

  function finish() {
    return timescale && fragments > 0 && ticks > 0 ? ticks / timescale : null;
  }
}
