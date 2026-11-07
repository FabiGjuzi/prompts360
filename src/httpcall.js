// httpcall.js — the outbound HTTP client for scheduled tasks (API calls and the country-file download).
// It exists to make a request from the server safely: HTTPS only, and the connection is refused if the host resolves to a private,
// loopback, link-local or otherwise internal address (checked at connect time, so a DNS trick cannot redirect it to the database or the
// cloud metadata service). Redirects are followed only when asked, and every hop is checked again. Time and size are capped.
import https from 'node:https';
import http from 'node:http';
import dns from 'node:dns';
import net from 'node:net';
import { isPublicIp } from './netutil.js';

// Tests turn these on to talk to a local stub server. Nothing else changes them.
const policy = { allowPrivate: false, allowHttp: false };
export const setHttpPolicy = p => Object.assign(policy, p);

const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'transfer-encoding', 'connection', 'upgrade', 'te', 'trailer', 'proxy-authorization', 'accept-encoding']);
export const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];

/** Parse "Name: value" lines into an object. Throws a readable Error for a bad line. */
export function parseHeaders(text) {
  const out = {};
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(':');
    const name = line.slice(0, i).trim().toLowerCase(), value = line.slice(i + 1).trim();
    if (i < 1 || !/^[a-z0-9!#$%&'*+.^_`|~-]{1,60}$/.test(name)) throw new Error(`Header line "${line.slice(0, 40)}" is not "Name: value"`);
    if (FORBIDDEN_HEADERS.has(name)) throw new Error(`Header ${name} is set by the server and cannot be changed`);
    if (/[\r\n\0]/.test(value) || value.length > 2000) throw new Error(`Header ${name} has an invalid value`);
    out[name] = value;
  }
  if (Object.keys(out).length > 20) throw new Error('At most 20 headers');
  return out;
}

/** Validate a task URL; returns the URL object or throws. */
export function checkUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error('That is not a valid URL'); }
  if (u.protocol !== 'https:' && !(policy.allowHttp && u.protocol === 'http:')) throw new Error('Only https:// URLs are allowed');
  if (u.username || u.password) throw new Error('Put credentials in a header, not in the URL');
  if (!u.hostname) throw new Error('The URL has no host');
  if (!policy.allowPrivate && net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && !isPublicIp(u.hostname.replace(/^\[|\]$/g, ''))) throw new Error('That address is internal; only public hosts are allowed');
  return u;
}

function safeLookup(hostname, options, cb) {
  // Node may ask for every address (all: true, "happy eyeballs") or for one; answer in the shape it asked for. Internal addresses are dropped.
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return cb(err);
    const many = Array.isArray(address), list = many ? address : [{ address, family }];
    const ok = policy.allowPrivate ? list : list.filter(a => isPublicIp(a.address));
    if (!ok.length) return cb(new Error('Host resolves to an internal address'));
    return many ? cb(null, ok) : cb(null, ok[0].address, ok[0].family);
  });
}

/**
 * One request. opts: { url, method, headers, body, timeoutMs, maxBytes, follow }.
 * Resolves { status, headers, body: Buffer, truncated, ms, url } (body is cut at maxBytes). Rejects on network errors, timeouts and blocked hosts.
 */
export async function httpCall({ url, method = 'GET', headers = {}, body = null, timeoutMs = 15_000, maxBytes = 65_536, follow = 0 }) {
  const t0 = Date.now();
  let u = checkUrl(url), m = method.toUpperCase();
  if (!METHODS.includes(m)) throw new Error(`Method ${m} is not allowed`);
  for (let hop = 0; ; hop++) {
    const r = await once(u, m, hop === 0 ? headers : {}, hop === 0 ? body : null, Math.max(1000, timeoutMs - (Date.now() - t0)), maxBytes);
    if (follow > hop && [301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
      u = checkUrl(new URL(r.headers.location, u).toString());
      if (r.status === 303 || ((r.status === 301 || r.status === 302) && m === 'POST')) m = 'GET';
      continue;
    }
    return { ...r, ms: Date.now() - t0, url: u.toString() };
  }
}

function once(u, method, headers, body, timeoutMs, maxBytes) {
  return new Promise((resolve0, reject0) => {
    let hard;                                          // the socket timeout below is an idle timeout; this one caps the whole request
    const resolve = v => { clearTimeout(hard); resolve0(v); }, reject = e => { clearTimeout(hard); reject0(e); };
    const lib = u.protocol === 'http:' ? http : https;
    const hs = { 'user-agent': 'prompts360-tasks/1.0', accept: '*/*', 'accept-encoding': 'identity', ...headers };
    if (body !== null && body !== undefined && body !== '') hs['content-length'] = String(Buffer.byteLength(body));
    const req = lib.request({ protocol: u.protocol, hostname: u.hostname.replace(/^\[|\]$/g, ''), port: u.port || undefined, path: u.pathname + u.search, method, headers: hs, lookup: safeLookup, timeout: timeoutMs }, res => {
      const chunks = []; let size = 0, truncated = false;
      res.on('data', c => {
        if (truncated) return;
        size += c.length;
        if (size > maxBytes) { chunks.push(c.subarray(0, c.length - (size - maxBytes))); truncated = true; res.destroy(); resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated }); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks), truncated }));
      res.on('error', e => { if (!truncated) reject(e); });
    });
    hard = setTimeout(() => req.destroy(new Error('Timed out')), timeoutMs);
    req.on('timeout', () => req.destroy(new Error('Timed out')));
    req.on('error', reject);
    if (body !== null && body !== undefined && body !== '') req.write(body);
    req.end();
  });
}
