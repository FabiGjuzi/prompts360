// geoip.js — which country is this IP in? A local answer, no third party: the ranges live in the table geoip_ranges (loaded from the bundled
// IPtoASN country file, refreshed by a scheduled task, editable in the dashboard) and a sorted copy is kept in memory for the lookup.
// The visitor's IP never leaves the server and is never stored; only the 2-letter country is counted (metrics.js).
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { q, one, tx } from './db.js';
import { parseIp, v4ToNum, v6ToBig } from './netutil.js';
import { httpCall } from './httpcall.js';
import { logEvent } from './metrics.js';

const gunzip = promisify(zlib.gunzip);
const SEED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'seed', 'geoip');
export const DEFAULT_V4 = 'https://github.com/sapics/ip-location-db/releases/download/latest/iptoasn-country-ipv4.csv';
export const DEFAULT_V6 = 'https://github.com/sapics/ip-location-db/releases/download/latest/iptoasn-country-ipv6.csv';

// ---------- In-memory index ----------
// feed (source 'feed'): sorted, non-overlapping ranges per family, binary search. manual: few rows, scanned; the smallest matching range wins.
let idx = { v4: { from: new Float64Array(0), to: new Float64Array(0), cc: [] }, v6: { from: [], to: [], cc: [] }, manual: [], version: 0, rows: 0 };

export const indexInfo = () => ({ version: idx.version, v4: idx.v4.cc.length, v6: idx.v6.cc.length, manual: idx.manual.length });

/** Country (2 letters) for an IP address, or '' when no range covers it. Synchronous and allocation-light: called on every page view. */
export function lookupCountry(ip) {
  const p = parseIp(String(ip));
  if (!p) return '';
  let best = '', size = null;
  for (const m of idx.manual) {
    if (m.fam === p.fam && p.n >= m.from && p.n <= m.to) { const s = m.to - m.from; if (size === null || s < size) { size = s; best = m.cc; } }
  }
  if (best) return best;
  if (p.fam === 4) {
    const { from, to, cc } = idx.v4, n = Number(p.n);
    let lo = 0, hi = from.length - 1, at = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (from[mid] <= n) { at = mid; lo = mid + 1; } else hi = mid - 1; }
    return at >= 0 && n <= to[at] ? cc[at] : '';
  }
  const { from, to, cc } = idx.v6, n = p.n;
  let lo = 0, hi = from.length - 1, at = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (from[mid] <= n) { at = mid; lo = mid + 1; } else hi = mid - 1; }
  return at >= 0 && n <= to[at] ? cc[at] : '';
}

/** Rebuild the in-memory copy from the table. Safe to call at any time; the old copy keeps answering until the new one is ready. */
export async function reloadIndex() {
  const next = await tx(async db => {
    await db.query("SET LOCAL statement_timeout = '60s'");
    const { rows: [m] } = await db.query('SELECT version FROM geoip_meta WHERE id = 1');
    const { rows } = await db.query(`SELECT host(ip_from) AS a, host(ip_to) AS b, country, source, family(ip_from) AS fam FROM geoip_ranges ORDER BY ip_from`);
    const v4 = { f: [], t: [], cc: [] }, v6 = { from: [], to: [], cc: [] }, manual = [];
    for (const r of rows) {
      const cc = r.country.trim();
      if (r.source === 'manual') { const a = parseIp(r.a), b = parseIp(r.b); if (a && b && a.fam === b.fam) manual.push({ fam: a.fam, from: a.n, to: b.n, cc }); continue; }
      if (r.fam === 4) { const a = v4ToNum(r.a), b = v4ToNum(r.b); if (a !== null && b !== null) { v4.f.push(a); v4.t.push(b); v4.cc.push(cc); } }
      else { const a = v6ToBig(r.a), b = v6ToBig(r.b); if (a !== null && b !== null) { v6.from.push(a); v6.to.push(b); v6.cc.push(cc); } }
    }
    return { v4: { from: Float64Array.from(v4.f), to: Float64Array.from(v4.t), cc: v4.cc }, v6, manual, version: Number(m?.version || 0), rows: rows.length };
  });
  idx = next;
  return indexInfo();
}

/** Mark the table as changed (all running instances notice within 30 s) and reload this instance now. */
export async function changed(db = null) {
  if (db) await db.query('UPDATE geoip_meta SET version = version + 1 WHERE id = 1');
  else await q('UPDATE geoip_meta SET version = version + 1 WHERE id = 1');
}

let poller = null;
/** Start the background check that reloads the index when another instance (or the dashboard) changed the table. */
export function startGeoipWatch() {
  if (poller) return;
  poller = setInterval(async () => {
    try { const m = await one('SELECT version FROM geoip_meta WHERE id = 1'); if (m && Number(m.version) !== idx.version) await reloadIndex(); }
    catch (e) { console.error('[geoip]', e.message); }
  }, 30_000);
  poller.unref();
}
export const stopGeoipWatch = () => { if (poller) clearInterval(poller); poller = null; };

// ---------- Parsing and loading ranges ----------
/** Parse file text (`from,to,CC` per line; blank lines and #-comments ignored). Returns {rows:[[from,to,cc]], errors:[...]} — every range is validated. */
export function parseRanges(text, { max = 2_000_000 } = {}) {
  const rows = [], errors = [];
  let ln = 0;
  for (const raw of String(text).split('\n')) {
    ln++;
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.split(',').map(s => s.trim());
    if (m.length !== 3) { errors.push(`line ${ln}: expected from,to,CC`); continue; }
    const [a, b, c] = m, cc = c.toUpperCase();
    const pa = parseIp(a), pb = parseIp(b);
    if (!pa || !pb) errors.push(`line ${ln}: not an IP address`);
    else if (pa.fam !== pb.fam) errors.push(`line ${ln}: from and to must be the same kind (IPv4 or IPv6)`);
    else if (pa.n > pb.n) errors.push(`line ${ln}: from is after to`);
    else if (!/^[A-Z]{2}$/.test(cc)) errors.push(`line ${ln}: country must be 2 letters`);
    else rows.push([a, b, cc]);
    if (rows.length > max) { errors.push('too many lines'); break; }
  }
  return { rows, errors };
}

async function insertBatch(db, rows, source) {
  for (let i = 0; i < rows.length; i += 20_000) {
    const part = rows.slice(i, i + 20_000);
    await db.query(`INSERT INTO geoip_ranges (ip_from, ip_to, country, source) SELECT a::inet, b::inet, c, $4 FROM unnest($1::text[], $2::text[], $3::text[]) AS t(a, b, c)`,
      [part.map(r => r[0]), part.map(r => r[1]), part.map(r => r[2]), source]);
  }
}

/** Replace every feed row with `rows` (manual rows stay) and record where they came from. One transaction. */
export async function replaceFeed(rows, { modified = null, etag = null, note = '' } = {}) {
  await tx(async db => {
    await db.query("SET LOCAL statement_timeout = '180s'");
    await db.query(`DELETE FROM geoip_ranges WHERE source = 'feed'`);
    await insertBatch(db, rows, 'feed');
    await db.query('UPDATE geoip_meta SET version = version + 1, source_modified = $1, source_etag = $2, source_note = $3, loaded_at = now() WHERE id = 1', [modified, etag, note]);
  });
  return reloadIndex();
}

/** The file shipped in the repository (seed/geoip). */
export async function readBundled() {
  const [gz, meta] = await Promise.all([fs.readFile(path.join(SEED_DIR, 'iptoasn-country.csv.gz')), fs.readFile(path.join(SEED_DIR, 'iptoasn-country.meta.json'), 'utf8')]);
  return { text: (await gunzip(gz)).toString('utf8'), meta: JSON.parse(meta) };
}

/** Load the bundled file into the table (replacing feed rows). Used on first start and by "Reset to bundled". */
export async function loadBundled() {
  const { text, meta } = await readBundled();
  const { rows, errors } = parseRanges(text);
  if (errors.length > 20 || rows.length < 100_000) throw new Error(`bundled geoip file is damaged (${rows.length} rows, ${errors.length} errors)`);
  return replaceFeed(rows, { modified: meta.sourceModified, note: 'Bundled file in the repository' });
}

/** Called at start: make sure the meta row exists, load the bundled file when the table has no feed rows, build the in-memory copy. */
export async function initGeoip({ seed = true } = {}) {
  await q('INSERT INTO geoip_meta (id) VALUES (1) ON CONFLICT DO NOTHING');
  const { n } = await one(`SELECT count(*)::int AS n FROM geoip_ranges WHERE source = 'feed'`);
  if (seed && n === 0) { await loadBundled(); logEvent('info', 'geoip', 'Loaded the bundled country file'); }
  else await reloadIndex();
  startGeoipWatch();
  return indexInfo();
}

// ---------- Status ----------
export async function geoipStatus() {
  const [m, c] = await Promise.all([one('SELECT * FROM geoip_meta WHERE id = 1'), one(`SELECT count(*) FILTER (WHERE source = 'feed' AND family(ip_from) = 4)::int AS v4, count(*) FILTER (WHERE source = 'feed' AND family(ip_from) = 6)::int AS v6, count(*) FILTER (WHERE source = 'manual')::int AS manual FROM geoip_ranges`)]);
  return { ...m, ...c, loaded: indexInfo() };
}

// ---------- Refresh from the upstream file ----------
const MIN_V4 = 100_000, MIN_V6 = 10_000;
/**
 * Download the IPv4 and IPv6 files and replace the feed rows. Skips the download when the upstream file has not been republished since
 * the copy we hold (compares its Last-Modified). Refuses a download that looks damaged (too few rows or too many bad lines).
 * Returns { ok, changed, message, sourceModified }.
 */
export async function refreshFromSource({ v4Url = DEFAULT_V4, v6Url = DEFAULT_V6, force = false } = {}) {
  const head = await httpCall({ url: v4Url, method: 'HEAD', follow: 4, timeoutMs: 20_000, maxBytes: 1024 });
  if (head.status >= 400) return { ok: false, changed: false, message: `Source answered HTTP ${head.status}` };
  const lm = head.headers['last-modified'] ? new Date(head.headers['last-modified']) : null;
  const modified = lm && !Number.isNaN(lm.getTime()) ? lm : null;
  const meta = await one('SELECT source_modified FROM geoip_meta WHERE id = 1');
  if (!force && modified && meta?.source_modified && modified.getTime() <= new Date(meta.source_modified).getTime()) {
    return { ok: true, changed: false, message: `Source not republished yet (its file is dated ${modified.toISOString()}); current copy kept`, sourceModified: modified };
  }
  const [a, b] = await Promise.all([v4Url, v6Url].map(url => httpCall({ url, method: 'GET', follow: 4, timeoutMs: 120_000, maxBytes: 60 * 1024 * 1024 })));
  for (const [r, n] of [[a, 'IPv4'], [b, 'IPv6']]) if (r.status !== 200 || r.truncated) return { ok: false, changed: false, message: `${n} file: HTTP ${r.status}${r.truncated ? ' (too large)' : ''}` };
  const p4 = parseRanges(a.body.toString('utf8')), p6 = parseRanges(b.body.toString('utf8'));
  if (p4.rows.length < MIN_V4 || p6.rows.length < MIN_V6 || p4.errors.length + p6.errors.length > 50) {
    return { ok: false, changed: false, message: `Download looks damaged (${p4.rows.length} IPv4 rows, ${p6.rows.length} IPv6 rows, ${p4.errors.length + p6.errors.length} bad lines); current copy kept` };
  }
  await replaceFeed([...p4.rows, ...p6.rows], { modified, etag: head.headers.etag || null, note: v4Url });
  return { ok: true, changed: true, message: `Loaded ${p4.rows.length.toLocaleString('en-US')} IPv4 and ${p6.rows.length.toLocaleString('en-US')} IPv6 ranges`, sourceModified: modified };
}
