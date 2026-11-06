// metrics.js — aggregate traffic, speed and health metrics plus the event log. Feeds the superadmin dashboard.
//
// PRIVACY: nothing here stores an IP address, a user id or a cookie. "Visitors" are counted with
// sha256(daily random salt + ip + user-agent) kept ONLY in this process's memory; the salt is replaced
// every UTC day and only the *count* is written to the database. Live-visitor data never leaves memory.
//
// Flow: begin() on every request -> record() when the response ends -> the current minute is
// accumulated in memory -> tick() (every 15 s) writes finished minutes and the day/route/page counters.
import crypto from 'node:crypto';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { q } from './db.js';
import { recalc } from './points.js';

// Latency histogram: upper bounds in ms (bucket 7 = slower than the last bound).
export const BOUNDS = [10, 25, 50, 100, 250, 500, 1000];
const BOT_RE = /bot|crawl|spider|slurp|preview|facebookexternalhit|lighthouse|headless|curl\/|wget|python|httpclient|monitor|uptime|scrapy|go-http|java\/|okhttp|axios|node-fetch|postman|check_http|pingdom|statuscake/i;
const LIVE_WINDOW_MS = 5 * 60_000;

const minuteOf = ms => Math.floor(ms / 60_000) * 60_000;
const newMinute = ts => ({ ts, requests: 0, pages: 0, bots: 0, s2: 0, s3: 0, s4: 0, s5: 0, limited: 0, csrf: 0, msSum: 0, msMax: 0, h: new Array(8).fill(0) });

let cur = newMinute(minuteOf(Date.now()));
const finished = [];                       // completed minutes waiting to be written
const routes = new Map();                  // route label -> {hits, msSum, msMax, errors}  (since last write)
const pageViews = new Map();               // public path -> views                           (since last write)
let pvDelta = 0, botDelta = 0;
let day = '', salt = crypto.randomBytes(16), seen = new Set();
const live = new Map();                    // visitor hash -> {t, path}
const ring = [];                           // last 300 requests, newest last (memory only)
let inflight = 0, started = Date.now();
const totals = { requests: 0, errors5xx: 0, microHit: 0, microMiss: 0, limited: 0, csrf: 0 };
const events = [];                         // buffered event_log rows

const utcDay = ms => new Date(ms).toISOString().slice(0, 10);

/** Called first thing for every request (after the health check). Records the outcome when the response ends. */
export function begin(req, res) {
  const t0 = process.hrtime.bigint();
  inflight++;
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    inflight--;
    try { record(req, res, Number(process.hrtime.bigint() - t0) / 1e6); } catch { /* metrics must never break a request */ }
  };
  res.on('finish', end);
  res.on('close', end);
}

function rollover(now) {
  const m = minuteOf(now);
  if (m !== cur.ts) { finished.push(cur); cur = newMinute(m); if (finished.length > 120) finished.shift(); }
  const d = utcDay(now);
  if (d !== day) { day = d; salt = crypto.randomBytes(16); seen = new Set(); }
}

function record(req, res, ms) {
  const now = Date.now();
  rollover(now);
  const status = res.statusCode;
  const isAdmin = req.routeLabel === 'admin';
  const ua = String(req.headers['user-agent'] || '');
  const bot = BOT_RE.test(ua) || !ua;
  const route = req.routeLabel || (status === 404 ? '404' : 'other');

  cur.requests++; totals.requests++;
  cur.msSum += ms; if (ms > cur.msMax) cur.msMax = Math.round(ms);
  const hb = BOUNDS.findIndex(b => ms < b);
  cur.h[hb === -1 ? 7 : hb]++;
  if (status >= 500) { cur.s5++; totals.errors5xx++; } else if (status >= 400) cur.s4++; else if (status >= 300) cur.s3++; else cur.s2++;
  if (bot) { cur.bots++; botDelta++; }

  const r = routes.get(route) || routes.set(route, { hits: 0, msSum: 0, msMax: 0, errors: 0 }).get(route);
  r.hits++; r.msSum += ms; if (ms > r.msMax) r.msMax = Math.round(ms); if (status >= 500) r.errors++;

  const isPage = Boolean(req.isPage) && req.method === 'GET' && status < 400 && !isAdmin;
  if (isPage) {
    cur.pages++;
    if (!bot) {
      pvDelta++;
      const p = req.path.slice(0, 200);
      if (pageViews.size < 3000 || pageViews.has(p)) pageViews.set(p, (pageViews.get(p) || 0) + 1);
      const vid = crypto.createHash('sha256').update(salt).update(String(req.ip)).update(ua).digest('base64url').slice(0, 16);
      if (seen.size < 500_000) seen.add(vid);
      live.set(vid, { t: now, path: p });
      if (live.size > 20_000) prune(now);
    }
  }
  ring.push({ t: now, m: req.method, p: isAdmin ? '[admin]' : req.path.slice(0, 120), s: status, ms: Math.round(ms * 10) / 10, r: route, bot });
  if (ring.length > 300) ring.shift();
}

function prune(now = Date.now()) {
  for (const [k, v] of live) if (now - v.t > LIVE_WINDOW_MS) live.delete(k);
}

/** Count a named event on the current minute (rate-limit refusals, CSRF failures, micro-cache hits…). */
export function count(name) {
  rollover(Date.now());
  if (name === 'limited') { cur.limited++; totals.limited++; }
  else if (name === 'csrf') { cur.csrf++; totals.csrf++; }
  else if (name === 'microHit') totals.microHit++;
  else if (name === 'microMiss') totals.microMiss++;
}

/** Add a row to the event log (written to the database within ~15 s). Never throws. */
export function logEvent(level, kind, message, meta) {
  try {
    if (events.length >= 500) events.shift();
    events.push({ level, kind: String(kind).slice(0, 30), message: String(message).slice(0, 1000), meta: meta ? JSON.stringify(meta).slice(0, 4000) : null });
  } catch { /* ignore */ }
}

// ---------- Live view ----------
/** What is happening right now: visitors, request rate, in-flight requests, newest requests. */
export function liveSnapshot() {
  const now = Date.now();
  prune(now);
  const act = (ms) => { let n = 0; for (const v of live.values()) if (now - v.t <= ms) n++; return n; };
  const pages = new Map();
  for (const v of live.values()) pages.set(v.path, (pages.get(v.path) || 0) + 1);
  const lastMin = ring.filter(r => now - r.t <= 60_000);
  const recent = ring.slice(-60).reverse();
  const lat = lastMin.map(r => r.ms).sort((a, b) => a - b);
  return {
    now,
    visitors5m: live.size,
    visitors1m: act(60_000),
    visitorsToday: seen.size,
    reqPerMin: lastMin.length,
    p50: lat.length ? lat[Math.floor(lat.length * 0.5)] : 0,
    p95: lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * 0.95))] : 0,
    inflight,
    topPages: [...pages].sort((a, b) => b[1] - a[1]).slice(0, 12),
    recent,
  };
}

// ---------- Technical health ----------
const eld = monitorEventLoopDelay({ resolution: 20 });
eld.enable();
let lastCpu = process.cpuUsage(), lastCpuAt = Date.now();

/** Process-level health numbers. */
export function systemSnapshot() {
  const m = process.memoryUsage();
  return {
    uptimeSec: Math.round((Date.now() - started) / 1000),
    node: process.version,
    rssMb: Math.round(m.rss / 1048576),
    heapMb: Math.round(m.heapUsed / 1048576),
    heapTotalMb: Math.round(m.heapTotal / 1048576),
    lagMeanMs: Math.round(eld.mean / 1e4) / 100,
    lagP99Ms: Math.round(eld.percentile(99) / 1e4) / 100,
    totals: { ...totals },
    cacheHitRate: totals.microHit + totals.microMiss ? Math.round(100 * totals.microHit / (totals.microHit + totals.microMiss)) : null,
    pid: process.pid,
  };
}

// ---------- Persistence ----------
async function writeMinute(m, sample) {
  await q(`INSERT INTO metrics_minute (ts, requests, pages, bots, s2xx, s3xx, s4xx, s5xx, limited, csrf_fail, ms_sum, ms_max,
      h0, h1, h2, h3, h4, h5, h6, h7, rss_mb, heap_mb, lag_ms, cpu_pct, db_ms)
    VALUES (to_timestamp($1 / 1000.0), $2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, $13,$14,$15,$16,$17,$18,$19,$20, $21,$22,$23,$24,$25)
    ON CONFLICT (ts) DO UPDATE SET requests = metrics_minute.requests + EXCLUDED.requests, pages = metrics_minute.pages + EXCLUDED.pages,
      bots = metrics_minute.bots + EXCLUDED.bots, s2xx = metrics_minute.s2xx + EXCLUDED.s2xx, s3xx = metrics_minute.s3xx + EXCLUDED.s3xx,
      s4xx = metrics_minute.s4xx + EXCLUDED.s4xx, s5xx = metrics_minute.s5xx + EXCLUDED.s5xx, limited = metrics_minute.limited + EXCLUDED.limited,
      csrf_fail = metrics_minute.csrf_fail + EXCLUDED.csrf_fail, ms_sum = metrics_minute.ms_sum + EXCLUDED.ms_sum,
      ms_max = greatest(metrics_minute.ms_max, EXCLUDED.ms_max),
      h0 = metrics_minute.h0 + EXCLUDED.h0, h1 = metrics_minute.h1 + EXCLUDED.h1, h2 = metrics_minute.h2 + EXCLUDED.h2, h3 = metrics_minute.h3 + EXCLUDED.h3,
      h4 = metrics_minute.h4 + EXCLUDED.h4, h5 = metrics_minute.h5 + EXCLUDED.h5, h6 = metrics_minute.h6 + EXCLUDED.h6, h7 = metrics_minute.h7 + EXCLUDED.h7,
      rss_mb = greatest(metrics_minute.rss_mb, EXCLUDED.rss_mb), heap_mb = greatest(metrics_minute.heap_mb, EXCLUDED.heap_mb),
      lag_ms = greatest(metrics_minute.lag_ms, EXCLUDED.lag_ms), cpu_pct = greatest(metrics_minute.cpu_pct, EXCLUDED.cpu_pct),
      db_ms = greatest(metrics_minute.db_ms, EXCLUDED.db_ms)`,
    [m.ts, m.requests, m.pages, m.bots, m.s2, m.s3, m.s4, m.s5, m.limited, m.csrf, Math.round(m.msSum), m.msMax, ...m.h,
      sample.rss, sample.heap, sample.lag, sample.cpu, sample.db]);
}

let lastSlow = 0;
/** Write everything pending. Runs every 15 s; `force` also closes the current minute (shutdown, tests). */
export async function tick(force = false) {
  const now = Date.now();
  rollover(now);
  if (force) { finished.push(cur); cur = newMinute(minuteOf(now)); }
  // System sample, attached to the minute(s) being written.
  const m = process.memoryUsage();
  const cpu = process.cpuUsage(lastCpu), el = Math.max(1, (now - lastCpuAt) * 1000);
  lastCpu = process.cpuUsage(); lastCpuAt = now;
  let dbMs = 0;
  try { const t0 = process.hrtime.bigint(); await q('SELECT 1'); dbMs = Math.round(Number(process.hrtime.bigint() - t0) / 1e6); } catch { dbMs = 9999; }
  const sample = { rss: Math.round(m.rss / 1048576), heap: Math.round(m.heapUsed / 1048576), lag: Math.round(eld.percentile(99) / 1e6), cpu: Math.min(999, Math.round(100 * (cpu.user + cpu.system) / el)), db: dbMs };
  if (finished.length) eld.reset();

  const batch = finished.splice(0);
  for (const b of batch) {
    try { await writeMinute(b, sample); } catch (e) { finished.unshift(b); console.error('[metrics]', e.message); break; }
  }
  if (batch.length || force) {
    const d = utcDay(now);
    const rs = [...routes]; routes.clear();
    const ps = [...pageViews].sort((a, b) => b[1] - a[1]).slice(0, 500); pageViews.clear();
    const pv = pvDelta, bh = botDelta; pvDelta = 0; botDelta = 0;
    try {
      await q(`INSERT INTO metrics_day (day, visitors, pageviews, bot_hits) VALUES ($1, $2, $3, $4)
        ON CONFLICT (day) DO UPDATE SET visitors = greatest(metrics_day.visitors, EXCLUDED.visitors),
          pageviews = metrics_day.pageviews + EXCLUDED.pageviews, bot_hits = metrics_day.bot_hits + EXCLUDED.bot_hits`, [d, seen.size, pv, bh]);
      if (rs.length) await q(`INSERT INTO metrics_route (day, route, hits, ms_sum, ms_max, errors)
        SELECT $1, * FROM unnest($2::text[], $3::int[], $4::bigint[], $5::int[], $6::int[])
        ON CONFLICT (day, route) DO UPDATE SET hits = metrics_route.hits + EXCLUDED.hits, ms_sum = metrics_route.ms_sum + EXCLUDED.ms_sum,
          ms_max = greatest(metrics_route.ms_max, EXCLUDED.ms_max), errors = metrics_route.errors + EXCLUDED.errors`,
        [d, rs.map(r => r[0]), rs.map(r => r[1].hits), rs.map(r => Math.round(r[1].msSum)), rs.map(r => r[1].msMax), rs.map(r => r[1].errors)]);
      if (ps.length) await q(`INSERT INTO metrics_page (day, path, views) SELECT $1, * FROM unnest($2::text[], $3::int[])
        ON CONFLICT (day, path) DO UPDATE SET views = metrics_page.views + EXCLUDED.views`, [d, ps.map(p => p[0]), ps.map(p => p[1])]);
    } catch (e) { console.error('[metrics]', e.message); }
  }
  if (events.length) {
    const ev = events.splice(0);
    try {
      await q(`INSERT INTO event_log (level, kind, message, meta) SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::jsonb[])`,
        [ev.map(e => e.level), ev.map(e => e.kind), ev.map(e => e.message), ev.map(e => e.meta)]);
    } catch (e) { console.error('[events]', e.message); }
  }
  if (now - lastSlow > 3_600_000) { lastSlow = now; await prunetables().catch(() => {}); }
}

/** Delete old metrics and log rows (called hourly). */
export async function prunetables() {
  await q(`DELETE FROM metrics_minute WHERE ts < now() - interval '14 days'`);
  await q(`DELETE FROM metrics_route WHERE day < current_date - 90`);
  await q(`DELETE FROM metrics_page WHERE day < current_date - 90`);
  await q(`DELETE FROM metrics_day WHERE day < current_date - 800`);
  await q(`DELETE FROM event_log WHERE ts < now() - interval '60 days'`);
  await q(`DELETE FROM notifications WHERE created_at < now() - interval '90 days'`);
  await q(`DELETE FROM event_log WHERE id < (SELECT coalesce(max(id), 0) - 100000 FROM event_log)`);
  await recalc(null);   // hourly safety net: re-derive every user's points (catches any change made outside the app)
}

let timer;
/** Start the background writer. Returns a function that stops it and writes what is left. */
export function startMetrics() {
  started = Date.now();
  timer = setInterval(() => tick().catch(e => console.error('[metrics]', e.message)), 15_000);
  timer.unref();
  return async () => { clearInterval(timer); await tick(true).catch(() => {}); };
}
