// admin/export.js — CSV export of the database from the dashboard.
//
// SECURITY: which tables and columns can leave the server is decided here, in code, from the same registry the
// dashboard CRUD uses (TABLES): password hashes, email fingerprints, tokens and the mail queue are not in it.
// Cells that start with = + - @ are prefixed with ' so spreadsheets do not run them as formulas.
import { q } from '../db.js';
import { str, HttpError } from '../http.js';
import { logEvent } from '../metrics.js';
import { html } from '../html.js';
import { stringify } from '../csv.js';
import { zip } from '../zip.js';
import { TABLES } from './crud.js';
import { adminPage, nf, P } from './ui.js';

const MAX_ROWS = 200_000;
const stamp = () => new Date().toISOString().slice(0, 10);

/** Columns that may be exported for a registry table: the list columns plus every editable/read-only column. */
export const exportColumns = T => [...new Set([...(T.list || []), ...T.cols.map(c => c.n)])];
const ident = n => { if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error('bad column'); return `"${n}"`; };

async function tableCsv(name) {
  const T = Object.hasOwn(TABLES, name) ? TABLES[name] : null;
  if (!T) throw new HttpError(404, 'Page not found.');
  const cols = exportColumns(T);
  const order = T.order ? ` ORDER BY ${T.order}` : '';
  const { rows } = await q(`SELECT ${cols.map(ident).join(', ')} FROM ${ident(name)}${order} LIMIT ${MAX_ROWS + 1}`);
  const truncated = rows.length > MAX_ROWS;
  return { csv: stringify(cols, rows.slice(0, MAX_ROWS).map(r => cols.map(c => r[c]))), count: Math.min(rows.length, MAX_ROWS), truncated };
}

/** Communities and posts in exactly the shape the importer reads, so an export can be edited and imported again. */
async function contentCsv(kind) {
  if (kind === 'communities') {
    const { rows } = await q(`SELECT c.name, c.title, c.description, t.slug AS model FROM communities c JOIN ai_tags t ON t.id = c.ai_tag_id WHERE c.removed_at IS NULL ORDER BY lower(c.name) LIMIT ${MAX_ROWS}`);
    return { csv: stringify(['name', 'title', 'description', 'model'], rows.map(r => [r.name, r.title, r.description, r.model])), count: rows.length };
  }
  const { rows } = await q(`SELECT c.name AS community, p.title, p.body, t.slug AS model, p.url, p.draft, p.wave, p.seo_title, p.seo_desc FROM posts p JOIN communities c ON c.id = p.community_id JOIN ai_tags t ON t.id = p.ai_tag_id
    WHERE p.deleted_at IS NULL AND (p.removed_at IS NULL OR p.draft) AND p.repost_of IS NULL AND c.removed_at IS NULL ORDER BY p.id LIMIT ${MAX_ROWS}`);
  return { csv: stringify(['community', 'title', 'body', 'model', 'url', 'draft', 'wave', 'seo_title', 'seo_desc'], rows.map(r => [r.community, r.title, r.body, r.model, r.url, r.draft ? 1 : '', r.wave ?? '', r.seo_title ?? '', r.seo_desc ?? ''])), count: rows.length };
}

const TEMPLATES = {
  communities: [['name', 'title', 'description', 'model'], ['Example_Community', 'Example community', 'What this community is about.', 'general']],
  posts: [['community', 'title', 'body', 'model', 'url', 'draft', 'wave', 'seo_title', 'seo_desc'], ['Example_Community', 'A useful prompt', 'Explain [topic] to me like I am new to it.', 'claude', '', '', '', '', '']],
};

function download(req, res, filename, type, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  res.statusCode = 200;
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Length', buf.length);
  res.end(req.method === 'HEAD' ? undefined : buf);
}
const CSV = 'text/csv; charset=utf-8';

/** GET /export */
export async function exportPage(req, res) {
  const { rows } = await q(`SELECT relname AS name, n_live_tup::bigint AS rows FROM pg_stat_user_tables`);
  const by = new Map(rows.map(r => [r.name, Number(r.rows)]));
  const content = html`<p class="muted">Download the site’s data as CSV (opens in Excel, Numbers or Google Sheets, UTF-8). Only what the dashboard may show is included: password hashes, email fingerprints, login tokens and the email queue are never exported. Cells starting with <code>=</code> <code>+</code> <code>-</code> <code>@</code> get a leading <code>'</code> so a spreadsheet cannot run them as formulas; the importer removes it again.</p>
<section class="card"><h2>Content (can be imported again)</h2><p class="muted">Communities and live posts (reposts are left out: they only point at another post), in the same columns the <a href="${P}/import">importer</a> reads. Edit in a spreadsheet, then import to add new rows. (Importing skips posts that already exist; it does not update them. Use the post editor for that.)</p>
<div class="row"><a class="btn primary" href="${P}/export/content/communities.csv">communities.csv</a> <a class="btn primary" href="${P}/export/content/posts.csv">posts.csv</a></div></section>
<section class="card"><h2>Everything</h2><p class="muted">One ZIP with a CSV for every table below. Large tables are cut at ${nf(MAX_ROWS)} rows each.</p>
<div class="row"><a class="btn primary" href="${P}/export/all.zip">Download all tables (.zip)</a></div></section>
<section class="card"><h2>One table</h2><ul class="plain">${Object.entries(TABLES).map(([n, T]) => html`<li><a href="${P}/export/table/${n}.csv">${n}.csv</a> <span class="muted">· ${T.label}${by.has(n) ? ` · about ${nf(by.get(n))} rows` : ''}</span></li>`)}</ul></section>`;
  return adminPage(req, res, { title: 'Export (CSV)', active: '/export', content });
}

/** GET /export/content/(communities|posts).csv */
export async function exportContent(req, res, [kind]) {
  const { csv, count } = await contentCsv(kind);
  logEvent('info', 'admin', `Exported ${count} ${kind} as CSV`);
  return download(req, res, `prompts360-${kind}-${stamp()}.csv`, CSV, csv);
}
/** GET /export/table/:name.csv */
export async function exportTable(req, res, [name]) {
  const { csv, count, truncated } = await tableCsv(str(name, 40));
  logEvent('info', 'admin', `Exported table ${name} (${count} rows${truncated ? ', truncated' : ''}) as CSV`);
  return download(req, res, `prompts360-${name}-${stamp()}.csv`, CSV, csv);
}
/** GET /export/all.zip */
export async function exportAll(req, res) {
  const files = []; let total = 0;
  for (const name of Object.keys(TABLES)) {
    const { csv, count } = await tableCsv(name);
    files.push({ name: `${name}.csv`, data: csv }); total += count;
  }
  logEvent('info', 'admin', `Exported all tables (${files.length} files, ${total} rows) as ZIP`);
  return download(req, res, `prompts360-database-${stamp()}.zip`, 'application/zip', zip(files));
}
/** GET /export/template/(communities|posts).csv */
export async function exportTemplate(req, res, [kind]) {
  const [h, ex] = TEMPLATES[kind];
  return download(req, res, `${kind}-template.csv`, CSV, stringify(h, [ex], { protect: false }));
}
