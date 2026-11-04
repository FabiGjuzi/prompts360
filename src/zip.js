// zip.js — minimal ZIP writer (deflate, no dependencies). Used for "download everything as CSV".
import zlib from 'node:zlib';

const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

function dos(d) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return [time, date];
}

/** files: [{ name, data: Buffer|string }] → Buffer. Names must be plain ASCII file names. */
export function zip(files, now = new Date()) {
  const [time, date] = dos(now);
  const parts = [], central = []; let offset = 0;
  for (const f of files) {
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(f.name)) throw new Error('bad zip entry name');
    const name = Buffer.from(f.name), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data);
    const comp = zlib.deflateRawSync(data, { level: 6 }), crc = zlib.crc32(data);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(time), u16(date), u32(crc), u32(comp.length), u32(data.length), u16(name.length), u16(0), name]);
    parts.push(local, comp);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(time), u16(date), u32(crc), u32(comp.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += local.length + comp.length;
  }
  const cd = Buffer.concat(central);
  return Buffer.concat([...parts, cd, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(cd.length), u32(offset), u16(0)]);
}
