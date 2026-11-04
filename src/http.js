// Request/response plumbing: security headers, body parsing, CSRF, compression, caching rules.
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { config } from './config.js';
import { layout, errorPage } from './views.js';
import { checkFormToken, safeEqual } from './crypto.js';
import { count } from './metrics.js';

const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip);
/** Error carrying an HTTP status; thrown by handlers and turned into an error page by server.js. */
export class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

// Cloudflare's captcha origin, allowed by the CSP only on pages that show a captcha.
const TURNSTILE = 'https://challenges.cloudflare.com';
/** Set the security response headers (CSP, HSTS, nosniff, framing, referrer, permissions). `turnstile` additionally allows Cloudflare's captcha script and frame. */
export function securityHeaders(res, { turnstile = false } = {}) {
  const ts = turnstile ? ` ${TURNSTILE}` : '';
  res.setHeader('Content-Security-Policy',
    `default-src 'none'; script-src 'self'${ts}; style-src 'self'; img-src 'self'; connect-src 'self'; ` +
    `frame-src ${turnstile ? TURNSTILE : "'none'"}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'` +
    (turnstile ? '' : "; require-trusted-types-for 'script'") +
    (config.isProd ? '; upgrade-insecure-requests' : ''));
  if (config.isProd) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

/** Pick the best response compression the browser accepts: 'br', 'gzip' or null. */
const encodingFor = req => {
  const ae = req.headers['accept-encoding'] || '';
  return /\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null;
};
/** Compress a Buffer with the chosen encoding (brotli quality 4 / gzip level 6: fast, good ratio). */
const compress = (buf, enc) => enc === 'br'
  ? brotli(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } })
  : gzip(buf, { level: 6 });

/** Send a body, compressed when worthwhile. */
export async function send(req, res, status, body, type = 'text/html; charset=utf-8', entry) {
  let buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Vary', 'Accept-Encoding');
  const enc = buf.length > 1024 ? encodingFor(req) : null;
  if (enc) {
    buf = entry?.[enc] || await compress(buf, enc);
    if (entry) entry[enc] = buf;
    res.setHeader('Content-Encoding', enc);
  }
  res.setHeader('Content-Length', buf.length);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

// ---------- Micro-cache: rendered logged-out pages, kept a few seconds in each process ----------
// Only pages that are identical for every logged-out visitor are stored (never forms, notices or
// personalised pages), so a burst of anonymous traffic costs one render per URL per MICROCACHE_SEC.
const micro = new Map();
/** Serve a recently rendered logged-out page from the in-process micro-cache if one exists. Returns true when it handled the request. */
export function serveMicro(req, res) {
  const e = micro.get(req.url);
  if (!e) { count('microMiss'); return false; }
  if (e.exp < Date.now()) { micro.delete(req.url); count('microMiss'); return false; }
  count('microHit');
  req.isPage = true;
  res.setHeader('Cache-Control', e.cc);
  send(req, res, 200, e.raw, 'text/html; charset=utf-8', e);
  return true;
}
/** Forget every cached page (called after the dashboard changes content). */
export const clearMicro = () => micro.clear();
/** Remember a rendered logged-out page for MICROCACHE_SEC seconds (bounded to 2000 entries, oldest evicted first). */
function storeMicro(url, raw, cc) {
  if (micro.size >= 2000) micro.delete(micro.keys().next().value); // oldest first
  const entry = { raw, cc, exp: Date.now() + config.microCacheSec * 1000 };
  micro.set(url, entry);
  return entry;
}

/**
 * Render a page. Logged-out GET pages without forms are public and cacheable (edge + micro-cache);
 * anything personalised or containing a form token is `private, no-store`.
 */
export function page(req, res, { status = 200, title, fullTitle, content, sidebar, turnstile, cache = true, desc, noindex, q, canonical, jsonld, ogType } = {}) {
  const user = req.user;
  if (turnstile) securityHeaders(res, { turnstile: true });
  const notice = req.query.get('n');
  const anonPublic = cache && !user && !req.cookieToken && !req.preview && req.method === 'GET' && status === 200 && !notice && !turnstile;
  // EDGE_CACHE_SEC=0 turns edge caching off (e.g. on App Platform, whose CDN can't bypass on session cookie).
  const cc = anonPublic && config.edgeCacheSec > 0
    ? `public, max-age=0, s-maxage=${config.edgeCacheSec}, stale-while-revalidate=60`
    : 'private, no-store';
  res.setHeader('Cache-Control', cc);
  req.isPage = true;
  // Canonical URL = this path without query string (sort/page variants point at the main page). Error and noindex pages have none.
  const canon = canonical === undefined ? (status === 200 ? req.path : undefined) : canonical;
  const body = Buffer.from(layout({ title, fullTitle, user, content, sidebar, turnstile, notice, desc, noindex, q: q ?? '', canonical: canon, jsonld, ogType }).toString());
  const entry = anonPublic && config.microCacheSec > 0 ? storeMicro(req.url, body, cc) : undefined;
  return send(req, res, status, body, 'text/html; charset=utf-8', entry);
}

/** Send a redirect (303 by default so a POST becomes a GET) and end the response. */
export function redirect(res, location, status = 303) {
  res.statusCode = status;
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 'private, no-store');
  res.end();
}

/** Send a JSON response (used by the no-reload vote buttons). */
export function json(req, res, status, obj) {
  res.setHeader('Cache-Control', 'private, no-store');
  return send(req, res, status, JSON.stringify(obj), 'application/json; charset=utf-8');
}

/** Send an error as a normal page, or as JSON when the request came from fetch(). */
export function renderError(req, res, status, text) {
  if (res.headersSent) return res.destroy();
  if (req.headers['x-requested-with'] === 'fetch') return json(req, res, status, { error: text });
  return page(req, res, { status, title: String(status), content: errorPage(status, text), cache: false, noindex: true });
}

// ---------- Body parsing ----------
// Form keys that could pollute Object.prototype; silently dropped from parsed bodies.
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
// Strip control characters except tab/newline (blocks NUL-byte and terminal-escape payloads).
const clean = s => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

/** Read and parse a urlencoded POST body with a hard size limit. Returns a prototype-less object; first value wins on duplicate keys; control characters are stripped. */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const ct = (req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ct !== 'application/x-www-form-urlencoded') return reject(new HttpError(415, 'Unsupported content type.'));
    const len = Number(req.headers['content-length'] || 0);
    if (len > limit) return reject(new HttpError(413, 'That was too long.'));
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'That was too long.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const out = Object.create(null); // no prototype => no prototype pollution
      for (const [k, v] of new URLSearchParams(Buffer.concat(chunks).toString('utf8'))) {
        if (BAD_KEYS.has(k) || k in out || k.length > 40) continue; // first value wins on duplicates (HPP)
        out[k] = clean(v);
      }
      resolve(out);
    });
    req.on('error', reject);
  });
}

// ---------- Cross-site request checks ----------
// This site's origin (scheme + host); POSTs from any other Origin are rejected as cross-site forgeries.
const ORIGIN = new URL(config.baseUrl).origin;
/** Browsers send Origin / Sec-Fetch-Site on POST; a foreign value means a cross-site forgery attempt. */
function sameOrigin(req) {
  const o = req.headers.origin;
  if (o && o !== ORIGIN) return false;
  const sfs = req.headers['sec-fetch-site'];
  if (sfs && sfs !== 'same-origin' && sfs !== 'none') return false;
  return true;
}
/** kind 'user': per-session synchronizer token. kind 'anon': signed, expiring token for logged-out forms. */
export function checkCsrf(req, body, kind) {
  if (!checkCsrfInner(req, body, kind)) { count('csrf'); return false; }
  return true;
}
function checkCsrfInner(req, body, kind) {
  if (!sameOrigin(req)) return false;
  if (kind === 'admin') {
    const t = body._csrf || req.headers['x-csrf-token'];
    return Boolean(req.admin) && typeof t === 'string' && safeEqual(t, req.admin.csrf);
  }
  if (kind === 'user') {
    const t = body._csrf || req.headers['x-csrf-token'];
    return Boolean(req.user) && typeof t === 'string' && safeEqual(t, req.user.csrf);
  }
  return checkFormToken(body._ft);
}

/** Coerce a value to a string of at most `max` characters ('' if it isn't a string). */
export const str = (v, max = 10_000) => (typeof v === 'string' ? v : '').slice(0, max);
