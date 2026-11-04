// design.js — the editable look of the site: theme variables, custom CSS and JavaScript (served as separate hashed files, so the
// strict Content-Security-Policy stays on), and the five editable templates. Three layers:
//   built-in design (design-defaults.js)  <  LIVE = newest published version  <  DRAFT = what the dashboard edits.
// Visitors always get LIVE. A signed-in superadmin with the preview cookie gets DRAFT. Every request reads the design through
// current() (per-request AsyncLocalStorage), so views never need to pass it around. History is append-only: rollback = publish an old copy.
import vm from 'node:vm';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { AsyncLocalStorage } from 'node:async_hooks';
import { q, tx } from './db.js';
import { config } from './config.js';
import { parse, render, lintMarkup } from './tpl.js';
import { COLORS, FONTS, SHAPES, NUMBERS, TEMPLATES } from './design-defaults.js';

export { COLORS, FONTS, SHAPES, NUMBERS, TEMPLATES };
const MAX_CODE = 200_000, MAX_TEMPLATE = 50_000, KEEP_VERSIONS = 100;

// ---------- Validation ----------
const EMPTY = () => ({ theme: {}, css: '', js: '', templates: {} });
const lf = s => String(s).replace(/\r\n?/g, '\n');

/** Brace/quote/comment balance check: catches the typos that would silently break the whole stylesheet. */
function cssProblem(css) {
  let depth = 0, i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); if (e < 0) return 'A /* comment is never closed.'; i = e + 2; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < css.length && css[j] !== c && css[j] !== '\n') j += css[j] === '\\' ? 2 : 1; if (css[j] !== c) return 'A quoted string is never closed.'; i = j + 1; continue; }
    if (c === '{') depth++;
    if (c === '}' && --depth < 0) return 'There is a closing } without a matching {.';
    i++;
  }
  return depth ? `${depth} opening { ${depth === 1 ? 'is' : 'are'} never closed.` : '';
}
/** Compile-only syntax check (nothing is executed). */
function jsProblem(js) {
  try { new vm.Script(js, { filename: 'custom.js' }); return ''; } catch (e) { return `${e.name}: ${e.message}${e.stack?.match(/custom\.js:(\d+)/) ? ` (line ${e.stack.match(/custom\.js:(\d+)/)[1]})` : ''}`; }
}
function templateProblem(name, src) {
  try {
    const bad = lintMarkup(src); if (bad) return bad;
    render(parse(src), TEMPLATES[name].sample());
    return '';
  } catch (e) { return e.message; }
}

/** Validate a design object and return only valid, non-default values. { data, errors }. */
export function normalize(input) {
  const errors = [], out = EMPTY();
  const th = input && typeof input.theme === 'object' && input.theme ? input.theme : {};
  for (const [k, label, light, dark] of COLORS) {
    for (const [key, def, suffix] of [[k, light, ''], ...(dark ? [[`dark_${k}`, dark, ' (dark mode)']] : [])]) {
      const v = th[key];
      if (v === undefined || v === null || v === '') continue;
      if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v)) { errors.push(`${label}${suffix}: use a colour like #4f46e5.`); continue; }
      if (v.toLowerCase() !== def) out.theme[key] = v.toLowerCase();
    }
  }
  if (th.font && th.font !== 'system') { if (FONTS[th.font]) out.theme.font = th.font; else errors.push('Font: pick one of the listed fonts.'); }
  if (th.shape && th.shape !== 'pill') { if (SHAPES[th.shape]) out.theme.shape = th.shape; else errors.push('Button shape: pick one of the listed shapes.'); }
  for (const [k, label, def, min, max] of NUMBERS) {
    const v = th[k]; if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) errors.push(`${label}: a whole number from ${min} to ${max}.`); else if (n !== def) out.theme[k] = n;
  }
  if (input?.css) {
    const css = lf(input.css);
    if (css.length > MAX_CODE) errors.push(`Custom CSS is too long (max ${MAX_CODE.toLocaleString('en-US')} characters).`);
    else { const p = cssProblem(css); if (p) errors.push(`Custom CSS: ${p}`); else out.css = css.trimEnd(); }
  }
  if (input?.js) {
    const js = lf(input.js);
    if (js.length > MAX_CODE) errors.push(`Custom JavaScript is too long (max ${MAX_CODE.toLocaleString('en-US')} characters).`);
    else { const p = jsProblem(js); if (p) errors.push(`Custom JavaScript: ${p}`); else out.js = js.trimEnd(); }
  }
  for (const name of Object.keys(TEMPLATES)) {
    const raw = input?.templates?.[name];
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const src = lf(raw).trimEnd();
    if (src === TEMPLATES[name].src) continue;
    if (src.length > MAX_TEMPLATE) { errors.push(`${TEMPLATES[name].label}: too long (max ${MAX_TEMPLATE.toLocaleString('en-US')} characters).`); continue; }
    const p = templateProblem(name, src);
    if (p) errors.push(`${TEMPLATES[name].label} template: ${p}`); else out.templates[name] = src;
  }
  return { data: out, errors };
}
const canon = d => JSON.stringify(d, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1))) : v));

// ---------- Build (data -> things the site uses) ----------
function themeCss(t) {
  const L = [], D = [];
  for (const [k, , light, dark] of COLORS) {
    if (t[k]) L.push(`--${k}:${t[k]}`);
    if (dark) { if (t[`dark_${k}`]) D.push(`--${k}:${t[`dark_${k}`]}`); else if (t[k]) D.push(`--${k}:${dark}`); }   // a custom light colour must not leak into dark mode
  }
  if (t.font) L.push(`--font:${FONTS[t.font][1]}`);
  if (t.shape) L.push(`--rb:${SHAPES[t.shape][1]}`);
  for (const [k] of NUMBERS) if (t[k]) L.push(`--${k}:${t[k]}px`);
  return (L.length ? `:root{${L.join(';')}}` : '') + (D.length ? `@media(prefers-color-scheme:dark){:root{${D.join(';')}}}` : '');
}
const hash = buf => crypto.createHash('sha256').update(buf).digest('base64url').slice(0, 10);
function asset(text, ext, type, urlOf, compress) {
  if (!text) return null;
  const raw = Buffer.from(text), h = hash(raw);
  return { url: urlOf(h, ext), hash: h, type, raw, br: compress ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 } }) : null, gz: compress ? zlib.gzipSync(raw, { level: 9 }) : null };
}
/** Compile validated data into the object the site renders from. */
function build(data, draft) {
  const urlOf = draft ? (h, ext) => `${config.adminPath}/design/draft.${h}.${ext}` : (h, ext) => `/x/site.${h}.${ext}`;
  const templates = {};
  for (const [name, src] of Object.entries(data.templates)) { try { templates[name] = parse(src); } catch { /* validated on save; ignore */ } }
  return {
    data, draft, templates,
    css: asset([themeCss(data.theme), data.css].filter(Boolean).join('\n'), 'css', 'text/css; charset=utf-8', urlOf, !draft),
    js: asset(data.js, 'js', 'text/javascript; charset=utf-8', urlOf, !draft),
  };
}
const BUILTIN = build(EMPTY(), false);
const DEFAULTS = Object.fromEntries(Object.entries(TEMPLATES).map(([n, t]) => [n, parse(t.src)]));

// ---------- State ----------
let live = BUILTIN, draft = BUILTIN, liveMeta = { id: null }, hasDraftRow = false, at = 0;
const old = new Map();   // url -> asset: the last few live files stay reachable for pages cached by browsers
const als = new AsyncLocalStorage();

/** Load LIVE and DRAFT from the database (also called every 15 s so other instances follow). */
export async function refreshDesign() {
  const v = (await q('SELECT id, created_at, note, data FROM design_versions ORDER BY id DESC LIMIT 1')).rows[0];
  const d = (await q('SELECT data FROM design_draft WHERE id = 1')).rows[0];
  live = v ? build(normalize(v.data).data, false) : BUILTIN;
  liveMeta = v ? { id: Number(v.id), created_at: v.created_at, note: v.note } : { id: null };
  hasDraftRow = Boolean(d);
  draft = d ? build(normalize(d.data).data, true) : build(live.data, true);
  for (const a of [live.css, live.js]) if (a) { old.delete(a.url); old.set(a.url, a); }
  while (old.size > 12) old.delete(old.keys().next().value);
  at = Date.now();
}
export async function ensureDesign() {
  if (!at) await refreshDesign();
  else if (Date.now() - at > 15_000) { at = Date.now(); refreshDesign().catch(e => console.error('[design]', e.message)); }
}
/** Run one request inside its own design context (LIVE). `fn` receives the store so the server can switch it to DRAFT for a previewing admin. */
export const withDesign = fn => { const s = { preview: false }; return als.run(s, () => fn(s)); };
/** The design for the current request. */
export const current = () => (als.getStore()?.preview ? draft : live);
export const isPreview = () => Boolean(als.getStore()?.preview);
/** Public live file (CSS/JS) by URL path, or undefined. */
export const liveAsset = p => old.get(p);
/** Draft file for the dashboard route: hash must match the current draft. */
export const draftAsset = (h, ext) => { const a = ext === 'css' ? draft.css : draft.js; return a && a.hash === h ? a : undefined; };

let errLogged = 0;
/** Render an editable template. A broken custom template silently falls back to the built-in one (logged at most once a minute). */
export function tpl(name, ctx) {
  const custom = current().templates[name];
  if (custom) {
    try { return render(custom, ctx); } catch (e) { if (Date.now() - errLogged > 60_000) { errLogged = Date.now(); console.error(`[design] template "${name}" failed, using the built-in one: ${e.message}`); } }
  }
  return render(DEFAULTS[name], ctx);
}

// ---------- Dashboard operations ----------
export const state = () => ({ liveMeta, live: live.data, draft: draft.data, hasDraftRow, changed: canon(draft.data) !== canon(live.data) });

/** Merge a change into the draft and validate the result. Returns { errors } (nothing saved when there are errors). */
export async function saveDraft(patch) {
  const cur = draft.data;
  const merged = { theme: patch.theme ?? cur.theme, css: patch.css ?? cur.css, js: patch.js ?? cur.js, templates: { ...cur.templates, ...(patch.templates || {}) } };
  const { data, errors } = normalize(merged);
  if (errors.length) return { errors };
  await q(`INSERT INTO design_draft (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [data]);
  await refreshDesign();
  return { errors: [] };
}
/** Publish the draft as a new version (it becomes LIVE). */
export async function publish(note = '', fromData) {
  const data = fromData ?? draft.data;
  const id = await tx(async db => {
    const { rows: [v] } = await db.query('INSERT INTO design_versions (note, data) VALUES ($1, $2) RETURNING id', [String(note).slice(0, 300), data]);
    await db.query('DELETE FROM design_versions WHERE id <= $1', [Number(v.id) - KEEP_VERSIONS]);
    await db.query(`INSERT INTO design_draft (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [data]);
    return Number(v.id);
  });
  await refreshDesign();
  return id;
}
/** Throw away unpublished changes (the draft becomes a copy of LIVE). */
export async function discardDraft() { await q('DELETE FROM design_draft WHERE id = 1'); await refreshDesign(); }
export async function versions() { return (await q('SELECT id, created_at, note, data FROM design_versions ORDER BY id DESC LIMIT 50')).rows; }
/** version 0 = the built-in design. Returns the data or null. */
export async function versionData(id) {
  if (id === 0) return EMPTY();
  const r = (await q('SELECT data FROM design_versions WHERE id = $1', [id])).rows[0];
  return r ? normalize(r.data).data : null;
}
export async function loadIntoDraft(data) {
  await q(`INSERT INTO design_draft (id, data) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`, [data]);
  await refreshDesign();
}
/** One-line description of what a version customises (for the history table). */
export const summarize = d => [Object.keys(d.theme || {}).length && 'theme', d.css && 'CSS', d.js && 'JavaScript', ...Object.keys(d.templates || {}).map(n => TEMPLATES[n]?.label)].filter(Boolean).join(', ') || 'built-in design';
