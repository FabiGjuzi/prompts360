// admin/ui.js — HTML building blocks for the dashboard: page shell, tables, form fields, SVG charts.
// Same escape-by-default html`` as the public site. CSP forbids inline scripts/styles, so charts are SVG
// drawn with attributes + CSS classes from public/admin.css.
import { html, raw, timeAgo } from '../html.js';
import { config } from '../config.js';
import { assets } from '../assets.js';
import { securityHeaders, send } from '../http.js';
import { hasEditor } from '../wys.js';

export const P = config.adminPath;

const NAV = [
  ['Overview', [['', 'Dashboard'], ['/live', 'Live'], ['/logs', 'Logs & events']]],
  ['Site', [['/texts', 'Texts & slogan'], ['/t/pages', 'Pages'], ['/t/nav_links', 'Navigation'], ['/t/ai_tags', 'AI models']]],
  ['Content', [['/t/communities', 'Communities'], ['/t/posts', 'Posts'], ['/t/comments', 'Comments'], ['/import', 'Import prompts'], ['/reports', 'Reports']]],
  ['People', [['/t/users', 'Users']]],
  ['System', [['/db', 'Database tables'], ['/account', 'Account & security']]],
];

/** Render a dashboard page (no-store, noindex) inside the admin shell. */
export function adminPage(req, res, { title, active = '', content, status = 200, flash, turnstile = false }) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  if (turnstile) securityHeaders(res, { turnstile: true });
  const body = html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive"><title>${title} · Dashboard</title>
<link rel="stylesheet" href="${assets.adminCss}"><link rel="icon" href="${assets.icon}" type="image/svg+xml">
<script src="${assets.adminJs}" defer></script>${hasEditor(content) ? html`<link rel="stylesheet" href="${assets.editorCss}"><script src="${assets.editorJs}" defer></script>` : ''}${turnstile && config.turnstileSiteKey ? raw('<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>') : ''}
</head><body class="adm" data-base="${P}"${req.admin ? html` data-csrf="${req.admin.csrf}"` : ''}>
${req.admin ? html`<aside class="side"><a class="brand" href="${P}">prompts360<small>superadmin</small></a>
${NAV.map(([group, items]) => html`<h2>${group}</h2><ul>${items.map(([href, label]) => html`<li><a href="${P}${href}"${active === href ? raw(' class="on" aria-current="page"') : ''}>${label}</a></li>`)}</ul>`)}
<ul class="foot"><li><a href="/" target="_blank" rel="noopener">View site ↗</a></li><li><form method="post" action="${P}/logout"><input type="hidden" name="_csrf" value="${req.admin.csrf}"><button class="link">Log out</button></form></li></ul></aside>` : ''}
<main class="${req.admin ? 'content' : 'center'}" id="main"><h1>${title}</h1>${flash ? html`<p class="flash" role="status">${flash}</p>` : ''}${content}</main></body></html>`;
  return send(req, res, status, body.toString());
}

export const csrf = req => html`<input type="hidden" name="_csrf" value="${req.admin.csrf}">`;
export const captcha = () => config.turnstileSiteKey ? html`<div class="cf-turnstile" data-sitekey="${config.turnstileSiteKey}" data-action="admin" data-theme="auto"></div>` : '';

// ---------- formatting ----------
export const nf = n => (n == null ? '–' : Number(n).toLocaleString('en-US'));
export const ms = n => (n == null ? '–' : n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n * 10) / 10} ms`);
export const mb = n => `${nf(n)} MB`;
export const bytes = n => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
export const pct = (a, b) => (b ? `${(100 * a / b).toFixed(b > 1000 ? 2 : 1)}%` : '0%');
export const uptime = s => (s >= 86400 ? `${Math.floor(s / 86400)}d ${Math.floor(s % 86400 / 3600)}h` : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m` : `${Math.floor(s / 60)}m ${s % 60}s`);
export const when = d => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '–');
export { timeAgo, html, raw };

// ---------- widgets ----------
/** KPI tile. `k` makes the value live-updatable (data-k). */
export const tile = (label, value, sub, { k, tone } = {}) => html`<div class="tile${tone ? ` ${tone}` : ''}"><span>${label}</span><b${k ? html` data-k="${k}"` : ''}>${value}</b>${sub ? html`<small>${sub}</small>` : ''}</div>`;

/** Simple table: cols = [{h, f: row => cell, cls}] */
export function table(cols, rows, { empty = 'Nothing here yet.', cls = '' } = {}) {
  if (!rows.length) return html`<p class="empty">${empty}</p>`;
  return html`<div class="tw"><table class="${cls}"><thead><tr>${cols.map(c => html`<th scope="col" class="${c.cls || ''}">${c.h}</th>`)}</tr></thead>
<tbody>${rows.map(r => html`<tr>${cols.map(c => html`<td class="${c.cls || ''}">${c.f(r)}</td>`)}</tr>`)}</tbody></table></div>`;
}

export const card = (title, body, { cls = '', id } = {}) => html`<section class="card ${cls}"${id ? html` id="${id}"` : ''}>${title ? html`<h2>${title}</h2>` : ''}${body}</section>`;

// ---------- SVG charts ----------
const W = 640, H = 180, L = 40, B = 20, T = 8, R = 8;
const niceMax = v => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
const fmtAxis = v => (v >= 1e6 ? `${v / 1e6}M` : v >= 1e3 ? `${v / 1e3}k` : String(Math.round(v * 10) / 10));

/**
 * Line chart. series: [{name, cls: 'c1'.., values: number[]}], labels: string[] (same length).
 * Accessible: role=img with a text summary, plus a visually hidden data table is not needed because the same
 * numbers appear in the tables next to it.
 */
export function lineChart({ series, labels, unit = '', label }) {
  const n = labels.length;
  if (!n) return html`<p class="empty">No data yet.</p>`;
  const max = niceMax(Math.max(1, ...series.flatMap(s => s.values)));
  const x = i => L + (n === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const y = v => T + (H - T - B) * (1 - v / max);
  const grid = [0, 0.5, 1].map(f => html`<line class="grid" x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="ax" x="${L - 4}" y="${y(max * f) + 3}" text-anchor="end">${fmtAxis(max * f)}${unit}</text>`);
  const xl = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => html`<text class="ax" x="${x(i)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${labels[i]}</text>`);
  const lines = series.map(s => html`<polyline class="ln ${s.cls}" fill="none" points="${s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`);
  const legend = series.length > 1 ? html`<p class="legend">${series.map(s => html`<span class="${s.cls}">${s.name}</span>`)}</p>` : '';
  return html`<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label || series.map(s => s.name).join(', ')}">${grid}${xl}${lines}</svg>${legend}</figure>`;
}

/** Bar chart (one or two stacked series): series [{name, cls, values}]. */
export function barChart({ series, labels, unit = '', label }) {
  const n = labels.length;
  if (!n) return html`<p class="empty">No data yet.</p>`;
  const totals = labels.map((_, i) => series.reduce((a, s) => a + s.values[i], 0));
  const max = niceMax(Math.max(1, ...totals));
  const bw = (W - L - R) / n, y = v => T + (H - T - B) * (1 - v / max);
  const grid = [0, 0.5, 1].map(f => html`<line class="grid" x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}"/><text class="ax" x="${L - 4}" y="${y(max * f) + 3}" text-anchor="end">${fmtAxis(max * f)}${unit}</text>`);
  const bars = labels.map((_, i) => { let base = 0; return series.map(s => { const v = s.values[i], h = (H - T - B) * (v / max); const r = html`<rect class="${s.cls}" x="${(L + i * bw + bw * 0.12).toFixed(1)}" y="${(y(base + v)).toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}"><title>${labels[i]} · ${s.name}: ${nf(v)}</title></rect>`; base += v; return r; }); });
  const xl = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => html`<text class="ax" x="${L + i * bw + bw / 2}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${labels[i]}</text>`);
  const legend = series.length > 1 ? html`<p class="legend">${series.map(s => html`<span class="${s.cls}">${s.name}</span>`)}</p>` : '';
  return html`<figure class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${label || series.map(s => s.name).join(', ')}">${grid}${bars}${xl}</svg>${legend}</figure>`;
}
