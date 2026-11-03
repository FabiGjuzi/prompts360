import pg from 'pg';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

// bigint ids come back as strings by default; they fit in JS numbers for any realistic row count.
pg.types.setTypeParser(20, v => Number(v));

// TLS is configured here, not by URL parameters: pg lets "?sslmode=…" in a URL override the CA passed in
// code, which would break verification against DigitalOcean's own CA. So strip those and always verify.
// DATABASE_CA_CERT may hold the PEM itself or a path to the .crt file.
function tlsOptions(url) {
  if (config.databaseTls === 'off') return undefined;
  let ca = config.databaseCa;
  if (ca && !ca.includes('-----BEGIN')) ca = readFileSync(ca, 'utf8');
  if (ca) return { ca, rejectUnauthorized: true };
  if (config.isProd || /sslmode=(require|verify)/.test(url)) return { rejectUnauthorized: true };
  return undefined; // local development without TLS
}
function stripSslParams(url) {
  try {
    const u = new URL(url);
    for (const k of ['sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'uselibpqcompat']) u.searchParams.delete(k);
    return u.toString();
  } catch { return url; }
}

function makePool(url) {
  const ssl = tlsOptions(url);
  const pool = new pg.Pool({
    connectionString: stripSslParams(url),
    ssl,
    max: config.dbPoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // No query may hold a connection > 5 s (slow-query DoS guard). PgBouncer rejects these startup
    // parameters, so behind a pooler set DB_STARTUP_PARAMS=0 and apply them per role (see DEPLOY.md).
    ...(process.env.DB_STARTUP_PARAMS === '0' ? {} : { statement_timeout: 5_000, idle_in_transaction_session_timeout: 10_000 }),
    application_name: 'prompts360',
  });
  pool.on('error', err => console.error('[db] idle client error', err.message));
  return pool;
}

export const primary = makePool(config.databaseUrl);
export const replica = config.databaseReadUrl ? makePool(config.databaseReadUrl) : primary;

/** Parameterised query on the primary. Text and values are always sent separately (no SQL building). */
export function q(text, values) { return primary.query(text, values); }
/** Read-only query that may be served by a read replica. */
export function qr(text, values) { return replica.query(text, values); }

export async function one(text, values) { return (await primary.query(text, values)).rows[0] || null; }

/** Run fn inside a transaction; rolls back on any thrown error. */
export async function tx(fn) {
  const client = await primary.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Apply migrations/NNN_*.sql in order, once each. Runs in ONE transaction holding a transaction-scoped
 * advisory lock, so it is safe with many instances booting at once and through PgBouncer (transaction mode).
 */
export async function migrate() {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
  const files = (await fs.readdir(dir)).filter(f => /^\d{3}_.+\.sql$/.test(f)).sort();
  await tx(async client => {
    await client.query('SELECT pg_advisory_xact_lock(360360)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT version FROM schema_migrations')).rows.map(r => r.version));
    for (const f of files) {
      if (done.has(f)) continue;
      await client.query(await fs.readFile(path.join(dir, f), 'utf8'));
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [f]);
      console.log(`[db] applied ${f}`);
    }
  });
}

export async function closeDb() {
  await primary.end();
  if (replica !== primary) await replica.end();
}
