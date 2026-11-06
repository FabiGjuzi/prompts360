// server.js — entry point and request pipeline. Run with `npm start`.
// Boot: migrate the database -> (optionally fork WEB_CONCURRENCY workers) -> connect Valkey -> listen.
// Per request: handle() applies security headers, origin lock, static assets, flood throttle, micro-cache,
// routing, session loading, auth checks, body parsing + CSRF check, then calls the route handler.
import http from 'node:http';
import cluster from 'node:cluster';
import { config } from './config.js';
import { migrate, closeDb, q } from './db.js';
import { connectKv, closeKv } from './kv.js';
import { loadSession, readCookie } from './session.js';
import { begin, count, logEvent, startMetrics } from './metrics.js';
import { ensureSite, refreshSite, t } from './site.js';
import { withDesign, ensureDesign, refreshDesign, liveAsset } from './design.js';
import { robotsTxt, sitemapXml } from './seo.js';
import { loadAdmin } from './admin/auth.js';
import { ipThrottle } from './ratelimit.js';
import { assetFiles } from './assets.js';
import { securityHeaders, send, readBody, checkCsrf, renderError, redirect, serveMicro, HttpError } from './http.js';
import { safeEqual } from './crypto.js';
import { drainOutbox } from './mail.js';
import { authRoutes } from './routes/auth.js';
import { forumRoutes, cmsRoutes, userStats } from './routes/forum.js';
import { recalc, levelOf, ensureLevels, refreshLevels } from './points.js';
import { adminRoutes } from './admin/index.js';

// Flat route table built from the three route files: {method, re (URL regex), handler, opts: {auth, form, bodyLimit}}.
const routes = [...adminRoutes, ...authRoutes, ...forumRoutes, ...cmsRoutes].map(([method, re, handler, opts = {}]) => ({ method, re, handler, opts }));

/** The visitor's IP: the proxy header (e.g. do-connecting-ip) only when the request is verified, otherwise the socket address. */
function clientIp(req) {
  // Trust the proxy header only when the request provably came through Cloudflare (origin secret).
  if (config.clientIpHeader && req.originVerified) {
    const v = req.headers[config.clientIpHeader];
    if (typeof v === 'string' && v.length < 64) return v.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '0.0.0.0';
}

/** The request pipeline: security headers -> health check -> origin lock -> static assets -> flood throttle -> micro-cache -> routing -> session -> auth checks -> body + CSRF check -> handler. */
export async function handle(req, res) {
  securityHeaders(res);
  const url = new URL(req.url, 'http://x');
  req.path = url.pathname;
  req.query = url.searchParams;

  if (req.path === '/healthz') { res.setHeader('Cache-Control', 'no-store'); return send(req, res, 200, 'ok', 'text/plain'); }
  begin(req, res);   // metrics: timing + counters for everything below

  // Origin lock: when ORIGIN_SECRET is set, only requests carrying Cloudflare's secret header are served,
  // so attackers can't bypass Cloudflare (and its DDoS protection) by hitting the origin directly.
  req.originVerified = !config.originSecret || safeEqual(req.headers['x-origin-secret'] || '', config.originSecret);
  if (!req.originVerified) { res.statusCode = 403; return res.end(); }
  req.ip = clientIp(req);

  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, HEAD, POST');
    return renderError(req, res, 405, 'Method not allowed.');
  }

  let asset = assetFiles.get(req.path);
  if (!asset && req.path.startsWith('/x/')) { await ensureDesign(); asset = liveAsset(req.path); }   // dashboard-edited CSS/JS (content-hashed)
  if (asset && req.method !== 'POST') {
    req.routeLabel = 'asset';
    const ae = req.headers['accept-encoding'] || '';
    const [buf, enc] = asset.br && /\bbr\b/.test(ae) ? [asset.br, 'br'] : asset.gz && /\bgzip\b/.test(ae) ? [asset.gz, 'gzip'] : [asset.raw, null];
    res.setHeader('Content-Type', asset.type);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Vary', 'Accept-Encoding');
    if (enc) res.setHeader('Content-Encoding', enc);
    res.setHeader('Content-Length', buf.length);
    return res.end(req.method === 'HEAD' ? undefined : buf);
  }
  if (req.path === '/favicon.ico') { req.routeLabel = 'asset'; return redirect(res, [...assetFiles.keys()].find(k => k.endsWith('.svg')), 301); }

  if (!ipThrottle(req.ip, config.ipBurst, config.ipRate)) { count('limited'); res.setHeader('Retry-After', '30'); return renderError(req, res, 429, t('err.429')); }
  await ensureSite();   // editable texts, links and pages (cached in memory, refreshed in the background)
  await ensureLevels(); // level tiers and the community requirement (same idea)
  await ensureDesign(); // theme, custom CSS/JS and templates (same idea)

  if (req.path === '/robots.txt') { req.routeLabel = 'GET robots'; res.setHeader('Cache-Control', 'public, max-age=3600'); return send(req, res, 200, robotsTxt(), 'text/plain; charset=utf-8'); }
  if (req.path === '/sitemap.xml') { req.routeLabel = 'GET sitemap'; res.setHeader('Cache-Control', 'public, max-age=600'); return send(req, res, 200, await sitemapXml(), 'application/xml; charset=utf-8'); }

  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (method === 'GET' && !req.headers.cookie) { req.routeLabel = 'GET cached'; if (serveMicro(req, res)) return; req.routeLabel = undefined; }

  let route, params;
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = req.path.match(r.re);
    if (m) { route = r; params = m.slice(1); break; }
  }
  if (!route) return renderError(req, res, 404, t('err.404'));

  const { auth, form, bodyLimit = 16_384, admin } = route.opts;
  if (admin) {
    // Dashboard: secret path, optional IP allow-list, its own session. Anything not allowed looks like a plain 404.
    req.routeLabel = 'admin';
    if (config.adminIpAllow.length && !config.adminIpAllow.includes(req.ip)) return renderError(req, res, 404, t('err.404'));
    req.admin = await loadAdmin(req);
    if (admin === 'required' && !req.admin) return renderError(req, res, 404, t('err.404'));
    req.user = null;
  } else {
    req.routeLabel = `${method} ${route.handler.name || 'handler'}`;
    req.cookieToken = readCookie(req);
    req.user = req.cookieToken ? await loadSession(req.cookieToken) : null;
    if (req.user && method === 'GET') {   // header: unread badge, points and level
      const st = await userStats(req.user.id).catch(() => ({ points: 0, unread: 0 }));
      Object.assign(req.user, { unread: st.unread, points: st.points, level: levelOf(st.points).name });
    }
    // Design preview: only a signed-in superadmin holding the preview cookie sees the unpublished draft.
    if (config.adminPath && /(?:^|;\s*)pv=1/.test(req.headers.cookie || '') && (!config.adminIpAllow.length || config.adminIpAllow.includes(req.ip)) && await loadAdmin(req)) { req.preview = true; req.dstore.preview = true; }
    if (auth && !req.user) {
      if (method === 'GET') return redirect(res, `/login?back=${encodeURIComponent(req.path + url.search)}`);
      return renderError(req, res, 401, 'Please log in first.');
    }
  }

  if (method === 'POST') {
    req.body = await readBody(req, bodyLimit);
    if (!checkCsrf(req, req.body, form)) return renderError(req, res, 403, 'This form expired or came from another site. Go back, refresh and try again.');
  }
  const out = await route.handler(req, res, params);
  if (admin && method === 'POST') recalc(null);   // any dashboard change (moderation, edits, imports) may change points; never throws
  return out;
}

/** Wrap handle() so any thrown error becomes a safe error page (no stack traces or SQL ever reach the client). */
async function onRequest(req, res) {
  try {
    await withDesign(s => { req.dstore = s; return handle(req, res); });
  } catch (e) {
    const status = e instanceof HttpError || (e.status >= 400 && e.status < 600) ? e.status : 500;
    if (status === 500) {
      console.error('[http]', req.method, req.url?.slice(0, 200), e.stack || e);
      logEvent('error', 'http', `${req.method} ${(req.path || '').slice(0, 120)}: ${String(e.message).slice(0, 300)}`, { route: req.routeLabel, stack: String(e.stack || '').split('\n').slice(0, 4).join(' | ').slice(0, 800) });
    }
    // Never leak internals (stack traces, SQL errors) to the client.
    renderError(req, res, status, status === 500 ? 'Something went wrong on our side.' : status === 503 ? 'Server is busy, try again in a moment.' : e.message);
  }
}

// ---------- Background jobs (safe to run on every instance) ----------
/** Background housekeeping every 10 minutes: delete expired tokens and unverified accounts older than 48 hours. */
async function cleanup() {
  await q('DELETE FROM auth_tokens WHERE expires_at < now()');
  // Unverified accounts older than 48 h free their username and email again.
  await q(`DELETE FROM users WHERE verified_at IS NULL AND deleted_at IS NULL AND created_at < now() - interval '48 hours'`);
}

/** Build the HTTP server with header-size and timeout limits tuned against slow-client attacks. */
export function createServer() {
  const server = http.createServer({ maxHeaderSize: 16_384, requestTimeout: 15_000, headersTimeout: 10_000 }, onRequest);
  server.keepAliveTimeout = 65_000;   // longer than load balancer idle timeouts
  server.maxRequestsPerSocket = 1000;
  return server;
}

/** Connect Valkey, start listening, start the background jobs (email queue, cleanup) and wire graceful shutdown. */
async function startWorker() {
  await connectKv();
  await refreshSite();
  await refreshDesign();
  await refreshLevels();
  const stopMetrics = startMetrics();
  logEvent('info', 'boot', `Server started (pid ${process.pid}, ${process.version})`);
  const server = createServer();
  server.listen(config.port, config.host, () => console.log(`[http] pid ${process.pid} listening on :${config.port}`));
  const timers = [
    setInterval(() => drainOutbox().catch(e => console.error('[mail]', e.message)), 3000),
    setInterval(() => cleanup().catch(e => console.error('[cleanup]', e.message)), 10 * 60_000),
  ];
  const stop = () => {
    timers.forEach(clearInterval);
    server.close(async () => { await stopMetrics().catch(() => {}); await closeKv().catch(() => {}); await closeDb().catch(() => {}); process.exit(0); });
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
