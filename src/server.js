import http from 'node:http';
import cluster from 'node:cluster';
import { config } from './config.js';
import { migrate, closeDb, q } from './db.js';
import { connectKv, closeKv } from './kv.js';
import { loadSession, readCookie } from './session.js';
import { ipThrottle } from './ratelimit.js';
import { assetFiles } from './assets.js';
import { securityHeaders, send, readBody, checkCsrf, renderError, redirect, serveMicro, HttpError } from './http.js';
import { safeEqual } from './crypto.js';
import { drainOutbox } from './mail.js';
import { authRoutes } from './routes/auth.js';
import { forumRoutes } from './routes/forum.js';
import { adminRoutes } from './routes/admin.js';

const routes = [...authRoutes, ...forumRoutes, ...adminRoutes].map(([method, re, handler, opts = {}]) => ({ method, re, handler, opts }));

function clientIp(req) {
  // Trust the proxy header only when the request provably came through Cloudflare (origin secret).
  if (config.clientIpHeader && req.originVerified) {
    const v = req.headers[config.clientIpHeader];
    if (typeof v === 'string' && v.length < 64) return v.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

const ROBOTS = 'User-agent: *\nDisallow: /login\nDisallow: /signup\nDisallow: /forgot\nDisallow: /reset\nDisallow: /verify\nDisallow: /search\nDisallow: /admin\nDisallow: /settings\n';

export async function handle(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, 'http://x');
  req.path = url.pathname;
  req.query = url.searchParams;

  if (req.path === '/healthz') { res.setHeader('Cache-Control', 'no-store'); return send(req, res, 200, 'ok', 'text/plain'); }

  // Origin lock: when ORIGIN_SECRET is set, only requests carrying Cloudflare's secret header are served,
  // so attackers can't bypass Cloudflare (and its DDoS protection) by hitting the origin directly.
  req.originVerified = !config.originSecret || safeEqual(req.headers['x-origin-secret'] || '', config.originSecret);
  if (!req.originVerified) { res.statusCode = 403; return res.end(); }
  req.ip = clientIp(req);

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, HEAD, POST');
    return renderError(req, res, 405, 'Method not allowed.');
  }

  const asset = assetFiles.get(req.path);
  if (asset && req.method !== 'POST') {
    const ae = req.headers['accept-encoding'] || '';
    const [buf, enc] = /\bbr\b/.test(ae) ? [asset.br, 'br'] : /\bgzip\b/.test(ae) ? [asset.gz, 'gzip'] : [asset.raw, null];
    res.setHeader('Content-Type', asset.type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Vary', 'Accept-Encoding');
    if (enc) res.setHeader('Content-Encoding', enc);
    res.setHeader('Content-Length', buf.length);
    return res.end(req.method === 'HEAD' ? undefined : buf);
  }
  if (req.path === '/robots.txt') { res.setHeader('Cache-Control', 'public, max-age=86400'); return send(req, res, 200, ROBOTS, 'text/plain'); }
  if (req.path === '/favicon.ico') return redirect(res, [...assetFiles.keys()].find(k => k.endsWith('.svg')), 301);

  if (!ipThrottle(req.ip, config.ipBurst, config.ipRate)) { res.setHeader('Retry-After', '30'); return renderError(req, res, 429, 'Slow down — too many requests.'); }

  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (method === 'GET' && !req.headers.cookie && serveMicro(req, res)) return;

  let route, params;
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = req.path.match(r.re);
    if (m) { route = r; params = m.slice(1); break; }
  }
  if (!route) return renderError(req, res, 404, 'Page not found.');

  req.cookieToken = readCookie(req);
  req.user = req.cookieToken ? await loadSession(req.cookieToken) : null;

  const { auth, form, bodyLimit = 16_384 } = route.opts;
  if (auth && !req.user) {
    if (method === 'GET') return redirect(res, `/login?back=${encodeURIComponent(req.path + url.search)}`);
    return renderError(req, res, 401, 'Please log in first.');
  }
  if (auth === 'admin' && !req.user.is_admin) return renderError(req, res, 404, 'Page not found.');

  if (method === 'POST') {
    req.body = await readBody(req, bodyLimit);
    if (!checkCsrf(req, req.body, form)) return renderError(req, res, 403, 'This form expired or came from another site. Go back, refresh and try again.');
  }
  return route.handler(req, res, params);
}

async function onRequest(req, res) {
  try {
    await handle(req, res);
  } catch (e) {
    const status = e instanceof HttpError || (e.status >= 400 && e.status < 600) ? e.status : 500;
    if (status === 500) console.error('[http]', req.method, req.url?.slice(0, 200), e.stack || e);
    // Never leak internals (stack traces, SQL errors) to the client.
    renderError(req, res, status, status === 500 ? 'Something went wrong on our side.' : status === 503 ? 'Server is busy, try again in a moment.' : e.message);
  }
}

// ---------- Background jobs (safe to run on every instance) ----------
async function cleanup() {
  await q('DELETE FROM auth_tokens WHERE expires_at < now()');
  // Unverified accounts older than 48 h free their username and email again.
  await q(`DELETE FROM users WHERE verified_at IS NULL AND deleted_at IS NULL AND created_at < now() - interval '48 hours'`);
}

export function createServer() {
  const server = http.createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000 }, onRequest);
  server.keepAliveTimeout = 65_000;   // longer than load balancer idle timeouts
  server.maxRequestsPerSocket = 1000;
  return server;
}

async function startWorker() {
  await connectKv();
  const server = createServer();
  server.listen(config.port, config.host, () => console.log(`[http] pid ${process.pid} listening on :${config.port}`));
  const timers = [
    setInterval(() => drainOutbox().catch(e => console.error('[mail]', e.message)), 3000),
    setInterval(() => cleanup().catch(e => console.error('[cleanup]', e.message)), 10 * 60_000),
  ];
  const stop = () => {
    timers.forEach(clearInterval);
    server.close(async () => { await closeKv().catch(() => {}); await closeDb().catch(() => {}); process.exit(0); });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  if (cluster.isPrimary && config.workers > 1) {
    await migrate();
    for (let i = 0; i < config.workers; i++) cluster.fork();
    cluster.on('exit', (w, code) => { if (code !== 0) { console.error(`[cluster] worker ${w.process.pid} died, restarting`); cluster.fork(); } });
  } else {
    if (cluster.isPrimary) await migrate();
    await startWorker();
  }
}
