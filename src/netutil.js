// netutil.js — IP address helpers shared by the country lookup and the scheduled-task HTTP client.
import net from 'node:net';

/** true for an address that is routable on the public internet (not loopback, private, link-local, CGNAT, multicast or unique-local). */
export function isPublicIp(ip) {
  const v = net.isIP(ip);
  if (!v) return false;
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  }
  const s = ip.toLowerCase();
  if (s === '::1' || s === '::' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s)) return false;
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return m ? isPublicIp(m[1]) : true;
}

/** IPv4 dotted quad -> number (0..2^32-1), or null. */
export function v4ToNum(ip) {
  const p = ip.split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) { if (!/^\d{1,3}$/.test(x) || Number(x) > 255) return null; n = n * 256 + Number(x); }
  return n;
}

/** IPv6 text -> BigInt (128 bit), or null. Handles '::' and a trailing dotted IPv4. */
export function v6ToBig(ip) {
  if (net.isIP(ip) !== 6) return null;
  let s = ip.toLowerCase();
  const z = s.indexOf('%'); if (z >= 0) s = s.slice(0, z);
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (tail) { const n = v4ToNum(tail[1]); if (n === null) return null; s = s.slice(0, -tail[1].length) + ((n >>> 16).toString(16)) + ':' + ((n & 0xffff).toString(16)); }
  const [head, rest] = s.split('::');
  const h = head ? head.split(':') : [], r = rest === undefined ? [] : (rest ? rest.split(':') : []);
  const fill = rest === undefined ? 0 : 8 - h.length - r.length;
  if (fill < 0 || (rest === undefined && h.length !== 8)) return null;
  const groups = [...h, ...Array(fill).fill('0'), ...r];
  let n = 0n;
  for (const g of groups) n = (n << 16n) | BigInt(parseInt(g || '0', 16));
  return n;
}

/** Either family -> { fam: 4|6, n: BigInt } (an IPv4-mapped IPv6 address counts as IPv4), or null. */
export function parseIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return { fam: 4, n: BigInt(v4ToNum(ip)) };
  if (v === 6) {
    const n = v6ToBig(ip);
    if (n === null) return null;
    if ((n >> 32n) === 0xffffn) return { fam: 4, n: n & 0xffffffffn };
    return { fam: 6, n };
  }
  return null;
}
