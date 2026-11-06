// admin/pages.js — the dashboard's own pages (everything that isn't a plain table editor).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { q, one, tx } from '../db.js';
import { config } from '../config.js';
import { html, raw, slugify, safeUrl } from '../html.js';
import { redirect, json, str, HttpError } from '../http.js';
import { formToken } from '../crypto.js';
import { liveSnapshot, systemSnapshot, logEvent } from '../metrics.js';
import { TEXTS, CONN, checkConn, conn, isOverridden, t } from '../site.js';
import { attemptLogin, createAdminSession, destroyAdminSession, cookieHeader, clearCookie, changePassword } from './auth.js';
import { invalidate } from './crud.js';
import * as S from './stats.js';
import { adminPage, csrf, captcha, tile, table, card, lineChart, barChart, nf, ms, mb, bytes, pct, uptime, when, timeAgo, P } from './ui.js';
import { COMMUNITY_RE } from '../validate.js';
import { parseObjects, unprotect } from '../csv.js';
import { renderPost } from '../routes/forum.js';

const note = (k, v) => html`<div class="kv"><span>${k}</span><b>${v}</b></div>`;

// ---------- Login / logout ----------
const loginForm = (req, res, { error, status = 200 } = {}) => adminPage(req, res, { title: 'Sign in', status, turnstile: true, content: html`<form method="post" action="${P}/login" class="edit narrow">
<input type="hidden" name="_ft" value="${formToken(900)}">${error ? html`<p class="error" role="alert">${error}</p>` : ''}
<div class="fld"><label for="pw">Password</label><input id="pw" name="password" type="password" maxlength="200" required autocomplete="current-password" autofocus></div>
${captcha()}<button class="btn primary">Sign in</button></form>` });

/** GET <admin path> — the sign-in form, or the dashboard when signed in. */
export async function home(req, res) {
  if (!req.admin) return loginForm(req, res);
  return dashboard(req, res);
}
/** POST <admin path>/login */
export async function loginPost(req, res) {
  const r = await attemptLogin(req, str(req.body.password, 200), req.body['cf-turnstile-response']);
  if (!r.ok) return loginForm(req, res, { error: r.error, status: r.status });
  res.setHeader('Set-Cookie', cookieHeader(await createAdminSession(req)));
  return redirect(res, P);
}
/** POST <admin path>/logout */
export async function logoutPost(req, res) {
  await destroyAdminSession(req.admin.token);
  res.setHeader('Set-Cookie', clearCookie());
  return redirect(res, P);
}

// ---------- Dashboard ----------
const mini = (title, key, unit, rows, cls = 'c1') => card(title, lineChart({ series: [{ name: title, cls, values: rows.map(r => Number(r[key])) }], labels: rows.map(r => r.label), unit, label: title }), { cls: 'half' });

async function dashboard(req, res) {
  const [k24, k1, mins, hrs, days, top, routes, cont, dbs, sec, seo, errs] = await Promise.all([
    S.kpi(24), S.kpi(1), S.minutes(60), S.hours24(), S.days30(), S.topPages(7), S.routeStats(), S.content(), S.database(), S.security(), S.seoHealth(), S.recentErrors(),
  ]);
  const live = liveSnapshot(), sys = systemSnapshot();
  const err24 = k24.requests ? pct(k24.s5, k24.requests) : '0%';
  const content = html`
<div class="tiles" data-live>
${tile('Visitors now', live.visitors5m, 'last 5 min', { k: 'visitors5m' })}${tile('Active last minute', live.visitors1m, '', { k: 'visitors1m' })}
${tile('Requests / min', live.reqPerMin, '', { k: 'reqPerMin' })}${tile('Response p95 (1 min)', ms(live.p95), `p50 ${ms(live.p50)}`, { k: 'p95fmt' })}
${tile('Visitors today', live.visitorsToday, 'unique, approximate', { k: 'visitorsToday' })}${tile('Uptime', uptime(sys.uptimeSec), `node ${sys.node}`)}
</div>
<h2 class="sect">Last 24 hours</h2>
<div class="tiles">
${tile('Requests', nf(k24.requests))}${tile('Page views', nf(k24.pages))}${tile('Server errors (5xx)', nf(k24.s5), err24 + ' of requests', { tone: k24.s5 ? 'bad' : '' })}
${tile('Client errors (4xx)', nf(k24.s4))}${tile('Latency p50 / p95', `${ms(k24.p50)} / ${ms(k24.p95)}`, `p99 ${ms(k24.p99)} · avg ${ms(k24.avg)}`)}${tile('Automated traffic', pct(k24.bots, k24.requests), `${nf(k24.bots)} requests`)}
</div>
<div class="grid2">
${card('Traffic — last 60 minutes', lineChart({ series: [{ name: 'Requests / min', cls: 'c1', values: mins.map(r => r.requests) }, { name: 'Page views / min', cls: 'c2', values: mins.map(r => r.pages) }], labels: mins.map(r => r.label), label: 'Requests and page views per minute' }))}
${card('Response time — last 60 minutes', lineChart({ series: [{ name: 'Average (ms)', cls: 'c1', values: mins.map(r => Math.round(r.avg)) }, { name: 'p95 (ms, approx.)', cls: 'c3', values: mins.map(r => r.p95) }], labels: mins.map(r => r.label), unit: 'ms', label: 'Average and p95 response time per minute' }))}
</div>
<h2 class="sect">Server health — last 60 minutes</h2>
<div class="grid4">
${mini('Memory (RSS MB)', 'rss_mb', ' MB', mins)}${mini('Event-loop lag p99 (ms)', 'lag_ms', ' ms', mins, 'c3')}${mini('CPU (% of one core)', 'cpu_pct', '%', mins, 'c2')}${mini('Database ping (ms)', 'db_ms', ' ms', mins, 'c4')}
</div>
<div class="grid2">
${card('Page views & bots — last 24 hours', barChart({ series: [{ name: 'Page views', cls: 'c1', values: hrs.map(r => r.pages) }, { name: 'Other requests', cls: 'c5', values: hrs.map(r => Math.max(0, r.requests - r.pages)) }], labels: hrs.map(r => r.label), label: 'Hourly page views and other requests' }))}
${card('Visitors — last 30 days', barChart({ series: [{ name: 'Visitors', cls: 'c1', values: days.map(r => r.visitors) }], labels: days.map(r => r.label), label: 'Daily visitors' }))}
</div>
<div class="grid2">
${card('Community growth — last 30 days', barChart({ series: [{ name: 'Sign-ups', cls: 'c2', values: days.map(r => r.signups) }, { name: 'Posts', cls: 'c1', values: days.map(r => r.posts) }, { name: 'Comments', cls: 'c4', values: days.map(r => r.comments) }], labels: days.map(r => r.label), label: 'Daily sign-ups, posts and comments' }))}
${card('Content', html`<div class="kvs">${note('Members', nf(cont.users))}${note('Unverified accounts', nf(cont.unverified))}${note('Banned', nf(cont.banned))}${note('Posts', nf(cont.posts))}${note('Comments', nf(cont.comments))}${note('Communities', nf(cont.communities))}${note('AI models', nf(cont.models))}${note('Pages', nf(cont.pages))}${note('Votes', nf(cont.votes))}${note('Open reports', html`<a href="${P}/reports">${nf(cont.reports)}</a>`)}</div>`)}
</div>
<div class="grid2">
${card('Most viewed pages — 7 days', table([{ h: 'Path', f: r => html`<a href="${r.path}" target="_blank" rel="noopener">${r.path}</a>` }, { h: 'Views', f: r => nf(r.views), cls: 'num' }], top, { empty: 'No page views recorded yet.' }))}
${card('Routes — today & yesterday', table([{ h: 'Route', f: r => r.route }, { h: 'Hits', f: r => nf(r.hits), cls: 'num' }, { h: 'Avg', f: r => ms(r.avg), cls: 'num' }, { h: 'Max', f: r => ms(r.max), cls: 'num' }, { h: '5xx', f: r => nf(r.errors), cls: 'num' }], routes, { empty: 'No traffic recorded yet.' }))}
</div>
<div class="grid2">
${card('Database', html`<div class="kvs">${note('PostgreSQL', dbs.version)}${note('Size', bytes(dbs.size))}${note('Connections (server)', nf(dbs.numbackends))}${note('Pool: total / idle / waiting', `${dbs.pool.total} / ${dbs.pool.idle} / ${dbs.pool.waiting}`)}${note('Buffer cache hit', `${dbs.cache_hit}%`)}${note('Deadlocks', nf(dbs.deadlocks))}${note('Rollbacks', nf(dbs.xact_rollback))}</div>
${table([{ h: 'Table', f: r => r.name }, { h: 'Rows (est.)', f: r => nf(r.rows), cls: 'num' }, { h: 'Size', f: r => bytes(r.bytes), cls: 'num' }], dbs.tables)}`)}
${card('Process', html`<div class="kvs">${note('Node.js', sys.node)}${note('Uptime', uptime(sys.uptimeSec))}${note('Memory (RSS / heap)', `${mb(sys.rssMb)} / ${mb(sys.heapMb)}`)}${note('Event-loop lag (mean / p99)', `${sys.lagMeanMs} / ${sys.lagP99Ms} ms`)}${note('Page cache hit rate', sys.cacheHitRate == null ? '–' : `${sys.cacheHitRate}%`)}${note('Requests since start', nf(sys.totals.requests))}${note('5xx since start', nf(sys.totals.errors5xx))}${note('Rate-limit refusals since start', nf(sys.totals.limited))}${note('CSRF failures since start', nf(sys.totals.csrf))}</div>`)}
</div>
<div class="grid2">
${card('Security — last 24 hours', html`<div class="kvs">${note('Rate-limit refusals', nf(k24.limited))}${note('CSRF failures', nf(k24.csrf))}${note('Last superadmin login', sec.account?.last_login_at ? `${timeAgo(sec.account.last_login_at)} (${when(sec.account.last_login_at)})` : 'never')}${note('Password changed', sec.account ? when(sec.account.changed_at) : '–')}
${sec.admin.map(r => note(r.message, nf(r.n)))}</div>`)}
${card('SEO health', html`<div class="kvs">${note('Published pages without a meta description', html`<a href="${P}/t/pages">${nf(seo.pages_no_desc)}</a>`)}${note('AI models without an intro', html`<a href="${P}/t/ai_tags">${nf(seo.models_no_desc)}</a>`)}${note('Communities without a description', html`<a href="${P}/t/communities">${nf(seo.communities_no_desc)}</a>`)}${note('Thin posts (< 80 characters, no link)', html`<a href="${P}/t/posts">${nf(seo.thin_posts)}</a>`)}${note('Indexable posts in the sitemap', nf(seo.indexable_posts))}${note('Crawler requests, 7 days', nf(seo.bot_hits_7d))}</div><p class="muted"><a href="/sitemap.xml" target="_blank" rel="noopener">sitemap.xml ↗</a> · <a href="/robots.txt" target="_blank" rel="noopener">robots.txt ↗</a></p>`)}
</div>
${card('Recent server errors', table([{ h: 'When', f: r => when(r.ts) }, { h: 'Kind', f: r => r.kind }, { h: 'Message', f: r => r.message }], errs, { empty: 'No server errors logged. 🎉' }))}`;
  return adminPage(req, res, { title: 'Dashboard', active: '', content });
}

// ---------- Live ----------
const liveData = () => { const l = liveSnapshot(); return { ...l, p95fmt: ms(l.p95), p50fmt: ms(l.p50) }; };
/** GET /live.json — polled every few seconds by admin.js. */
export async function liveJson(req, res) { return json(req, res, 200, liveData()); }
/** GET /live */
export async function live(req, res) {
  const l = liveData(), sys = systemSnapshot();
  const content = html`<div class="tiles" data-live>
${tile('Visitors (5 min)', l.visitors5m, '', { k: 'visitors5m' })}${tile('Active (1 min)', l.visitors1m, '', { k: 'visitors1m' })}${tile('Requests / min', l.reqPerMin, '', { k: 'reqPerMin' })}
${tile('p50 (1 min)', ms(l.p50), '', { k: 'p50fmt' })}${tile('p95 (1 min)', l.p95fmt, '', { k: 'p95fmt' })}${tile('In flight', l.inflight, '', { k: 'inflight' })}
${tile('Visitors today', l.visitorsToday, '', { k: 'visitorsToday' })}${tile('Memory', mb(sys.rssMb), `heap ${mb(sys.heapMb)}`)}${tile('Event-loop lag p99', `${sys.lagP99Ms} ms`)}
</div>
<p class="muted">Updates every 4 seconds. Nothing on this page is stored: it is the server's memory right now (no IP addresses are kept).</p>
<div class="grid2">
${card('Where visitors are right now', html`<div class="tw"><table><thead><tr><th scope="col">Page</th><th scope="col" class="num">Visitors</th></tr></thead><tbody id="live-pages">${l.topPages.map(([p, n]) => html`<tr><td>${p}</td><td class="num">${n}</td></tr>`)}</tbody></table></div>`)}
${card('Newest requests', html`<div class="tw"><table><thead><tr><th scope="col">Time</th><th scope="col">Method</th><th scope="col">Path</th><th scope="col" class="num">Status</th><th scope="col" class="num">Time</th><th scope="col">Route</th></tr></thead><tbody id="live-recent">${l.recent.map(r => html`<tr><td>${new Date(r.t).toISOString().slice(11, 19)}</td><td>${r.m}</td><td>${r.p}${r.bot ? ' 🤖' : ''}</td><td class="num">${r.s}</td><td class="num">${ms(r.ms)}</td><td>${r.r}</td></tr>`)}</tbody></table></div>`)}
</div>`;
  return adminPage(req, res, { title: 'Live', active: '/live', content });
}

// ---------- Logs ----------
/** GET /logs — the event log (errors, security events, admin actions), filterable. */
export async function logs(req, res) {
  const level = ['info', 'warn', 'error'].includes(req.query.get('level')) ? req.query.get('level') : '';
  const kind = /^[a-z]{1,30}$/.test(req.query.get('kind') || '') ? req.query.get('kind') : '';
  const text = str(req.query.get('q') || '', 100).trim();
  const where = [], vals = [];
  if (level) { vals.push(level); where.push(`level = $${vals.length}`); }
  if (kind) { vals.push(kind); where.push(`kind = $${vals.length}`); }
  if (text) { vals.push(`%${text.replace(/[\\%_]/g, '\\$&')}%`); where.push(`message ILIKE $${vals.length}`); }
  const { rows } = await q(`SELECT id, ts, level, kind, message, meta FROM event_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT 300`, vals);
  const { rows: kinds } = await q('SELECT kind, count(*)::int AS n FROM event_log GROUP BY kind ORDER BY 2 DESC');
  const content = html`<form method="get" action="${P}/logs" class="bar-tools"><select name="level" aria-label="Level"><option value="">All levels</option>${['info', 'warn', 'error'].map(l => html`<option${level === l ? raw(' selected') : ''}>${l}</option>`)}</select>
<select name="kind" aria-label="Kind"><option value="">All kinds</option>${kinds.map(k => html`<option value="${k.kind}"${kind === k.kind ? raw(' selected') : ''}>${k.kind} (${k.n})</option>`)}</select>
<input type="search" name="q" value="${text}" placeholder="Search messages…" aria-label="Search messages"><button class="btn">Filter</button></form>
${table([{ h: 'When', f: r => when(r.ts) }, { h: 'Level', f: r => html`<span class="lv ${r.level}">${r.level}</span>` }, { h: 'Kind', f: r => r.kind }, { h: 'Message', f: r => r.message }, { h: 'Details', f: r => (r.meta ? JSON.stringify(r.meta).slice(0, 300) : '') }], rows, { empty: 'No events match.' })}
<p class="muted">Showing the newest 300. Events are kept 60 days. Every dashboard change is recorded here ("Created/Updated/Deleted …"). Raw access: <a href="${P}/t/event_log">event_log table</a>. Live platform logs are also in the DigitalOcean console.</p>`;
  return adminPage(req, res, { title: 'Logs & events', active: '/logs', content });
}

// ---------- Texts ----------
/** GET /texts — every editable string, grouped. */
export async function texts(req, res) {
  const groups = new Map();
  for (const d of Object.values(TEXTS)) (groups.get(d.group) || groups.set(d.group, []).get(d.group)).push(d);
  const flash = req.query.get('n') === 'saved' ? 'Saved. The site shows the new texts immediately.' : undefined;
  const content = html`<p class="muted">Leave a field empty to use the built-in default. The slogan and every other text on the public site is edited here. Pages, links and AI models have their own editors in the menu.</p>
<form method="post" action="${P}/texts" class="edit wide">${csrf(req)}
${[...groups].map(([g, items]) => html`<fieldset><legend>${g}</legend>${items.map(d => html`<div class="fld"><label for="t_${d.key}">${d.label}${isOverridden(d.key) ? raw(' <em>(customised)</em>') : ''}</label>
${d.rows > 1 ? html`<textarea id="t_${d.key}" name="t.${d.key}" rows="${d.rows}" maxlength="20000" placeholder="${d.def}">${isOverridden(d.key) ? t(d.key) : ''}</textarea>`
    : html`<input id="t_${d.key}" name="t.${d.key}" type="text" maxlength="2000" placeholder="${d.def}" value="${isOverridden(d.key) ? t(d.key) : ''}">`}
<small>Default: ${d.def.length > 140 ? `${d.def.slice(0, 140)}…` : d.def || '(empty)'}</small></div>`)}</fieldset>`)}
<div class="savebar"><button class="btn primary">Save all texts</button></div></form>`;
  return adminPage(req, res, { title: 'Texts & slogan', active: '/texts', content, flash });
}
/** POST /texts — save every submitted field (empty = back to default). */
export async function textsPost(req, res) {
  await tx(async db => {
    for (const d of Object.values(TEXTS)) {
      const name = `t.${d.key}`;
      if (!(name in req.body)) continue;
      let v = str(req.body[name], 20000).replace(/\r\n/g, '\n');
      v = d.rows > 1 ? v.trim() : v.replace(/\n/g, ' ').trim();
      if (v === '' || v === d.def) await db.query('DELETE FROM site_settings WHERE key = $1', [d.key]);
      else await db.query(`INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [d.key, v]);
    }
  });
  logEvent('info', 'admin', 'Updated site texts');
  await invalidate();
  return redirect(res, `${P}/texts?n=saved`);
}

// ---------- Connections (Google Analytics, AdSense, Search Console) ----------
const connForm = (req, vals, errors = []) => html`<p class="muted">IDs for outside services. Leave a field empty and that service is completely off: nothing is loaded from it, no cookie is set and the security policy is not widened. Changes apply immediately.</p>
${errors.length ? html`<ul class="error" role="alert">${errors.map(e => html`<li>${e}</li>`)}</ul>` : ''}
<form method="post" action="${P}/connections" class="edit wide">${csrf(req)}
${Object.entries(CONN).map(([name, d]) => html`<fieldset><legend>${d.label}</legend><div class="fld"><label for="c_${name}">ID</label>
<input id="c_${name}" name="c.${name}" type="text" maxlength="400" autocomplete="off" spellcheck="false" placeholder="${d.example}" value="${vals[name] ?? ''}"><small>${d.help}</small></div></fieldset>`)}
<div class="savebar"><button class="btn primary">Save connections</button></div></form>
<section class="card"><h2>What is switched on right now</h2><ul class="plain">
<li>Analytics: <b>${conn('ga4') ? `on (${conn('ga4')})` : 'off'}</b> — visitors are asked first; nothing is sent to Google until they accept.</li>
<li>AdSense: <b>${conn('adsense') ? `on (${conn('adsense')})` : 'off'}</b> — <a href="/ads.txt" target="_blank" rel="noopener">/ads.txt</a> ${conn('adsense') ? 'is published' : 'answers 404 until an ID is set'}.</li>
<li>Search Console: <b>${conn('gsc') ? 'verification tag is on every page' : 'off'}</b>.</li></ul>
<p class="muted">Neither the dashboard, sign-in/reset/verify pages, account pages nor search results ever load these services.</p></section>`;
/** GET /connections */
export async function connections(req, res) {
  const flash = req.query.get('n') === 'saved' ? 'Saved. The site uses the new settings immediately.' : undefined;
  return adminPage(req, res, { title: 'Connections', active: '/connections', content: connForm(req, Object.fromEntries(Object.keys(CONN).map(n => [n, conn(n)]))), flash });
}
/** POST /connections — validate everything first; save nothing if any value is invalid. */
export async function connectionsPost(req, res) {
  const vals = {}, errors = [];
  for (const name of Object.keys(CONN)) {
    const raw = str(req.body[`c.${name}`], 400), r = checkConn(name, raw);
    if (r.error) { errors.push(r.error); vals[name] = raw; } else vals[name] = r.value;
  }
  if (errors.length) return adminPage(req, res, { title: 'Connections', active: '/connections', content: connForm(req, vals, errors), status: 400 });
  await tx(async db => {
    for (const [name, d] of Object.entries(CONN)) {
      if (vals[name] === '') await db.query('DELETE FROM site_settings WHERE key = $1', [d.key]);
      else await db.query(`INSERT INTO site_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, [d.key, vals[name]]);
    }
  });
  logEvent('info', 'admin', `Updated connections (analytics ${vals.ga4 ? 'on' : 'off'}, adsense ${vals.adsense ? 'on' : 'off'}, search console ${vals.gsc ? 'on' : 'off'})`);
  await invalidate();
  return redirect(res, `${P}/connections?n=saved`);
}

// ---------- Import prompts ----------
const SEED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed', 'prompts.json');
const bundled = () => { try { return fs.readFileSync(SEED, 'utf8'); } catch { return ''; } };
// The SEO-planned library: 249 posts shipped as hidden drafts in 3 publishing waves (see Content > Posts: filter “published = false”).
const SEED_DRAFTS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'seed', 'drafts-library.json');
const bundledDrafts = () => { try { return fs.readFileSync(SEED_DRAFTS, 'utf8'); } catch { return ''; } };
const EXAMPLE = JSON.stringify({ communities: [{ name: 'Example_Prompts', title: 'Example prompts', description: 'What this community is about.', model: 'chatgpt' }],
  posts: [{ community: 'Example_Prompts', title: 'A useful prompt', body: 'Explain **{topic}** to me like I am new to it.\n\n```\nYou are a patient teacher…\n```' }] }, null, 2);

/** Accepts JSON ({communities, posts}) or CSV (communities file or posts file, detected from the header row). */
export function parseImportText(text) {
  const t = String(text ?? '').replace(/^\ufeff/, '');
  if (!t.trim()) return { error: 'Nothing to import: paste JSON or CSV, or choose a file.' };
  if (/^\s*[{[]/.test(t)) { try { const d = JSON.parse(t); return { data: Array.isArray(d) ? { posts: d } : d }; } catch { return { error: 'That is not valid JSON.' }; } }
  let parsed;
  try { parsed = parseObjects(t, { maxRows: 5000 }); } catch (e) { return { error: `That is not valid CSV. ${e.message}` }; }
  const { headers, records } = parsed;
  const has = h => headers.includes(h);
  const cell = (r, k) => unprotect(String(r[k] ?? '')).replace(/\r\n/g, '\n');
  if (has('community') && has('title')) return { data: { posts: records.map(r => ({ community: cell(r, 'community').trim(), title: cell(r, 'title').trim(), body: cell(r, 'body'), model: cell(r, 'model').trim(), url: cell(r, 'url').trim(), published: cell(r, 'published').trim(), draft: cell(r, 'draft').trim(), wave: cell(r, 'wave').trim(), seo_title: cell(r, 'seo_title').trim(), seo_desc: cell(r, 'seo_desc').trim(), _line: r._line })) } };
  if (has('name') && (has('model') || has('title'))) return { data: { communities: records.map(r => ({ name: cell(r, 'name').trim(), title: cell(r, 'title').trim(), description: cell(r, 'description'), model: cell(r, 'model').trim(), _line: r._line })) } };
  return { error: 'Could not tell what this CSV is. A posts file needs the columns community, title (and optionally body, model, url). A communities file needs name, model (and optionally title, description). The first row must be the column names.' };
}

/** Validate and (unless `dry`) import communities + posts. Returns counts and problems. Duplicates (same community + title) are skipped. */
export async function runImport(text, { dry }) {
  const parsed = parseImportText(text);
  if (parsed.error) return { error: parsed.error };
  const data = parsed.data;
  const comms = Array.isArray(data?.communities) ? data.communities : [], posts = Array.isArray(data?.posts) ? data.posts : [];
  if (!comms.length && !posts.length) return { error: 'Nothing to import: expected {"communities": [...], "posts": [...]}.' };
  if (comms.length > 300 || posts.length > 1500) return { error: 'Too much at once (max 300 communities and 1,500 posts per import).' };
  const problems = [], tags = new Map((await q('SELECT id, slug FROM ai_tags')).rows.map(r => [r.slug, r.id]));
  const official = (await one(`SELECT id FROM users WHERE username = 'prompts360'`)).id;
  const C = new Map();          // lower(name) -> {name, title, description, tag}
  for (const [i, c] of comms.entries()) {
    const name = typeof c?.name === 'string' ? c.name.trim() : '';
    if (!COMMUNITY_RE.test(name)) { problems.push(`Community ${c?._line ? `(line ${c._line})` : `#${i + 1}`}: invalid name "${String(c?.name).slice(0, 30)}".`); continue; }
    const cmodel = typeof c.model === 'string' ? c.model.trim().toLowerCase() : '';
    if (!tags.has(cmodel)) { problems.push(`Community ${name}: unknown model "${String(c.model).slice(0, 30)}" (use an AI model slug).`); continue; }
    C.set(name.toLowerCase(), { name, title: String(c.title || name).slice(0, 100), description: String(c.description || '').slice(0, 1000), tag: tags.get(cmodel) });
  }
  const P2 = [];
  for (const [i, p] of posts.entries()) {
    const cname = typeof p?.community === 'string' ? p.community.trim().replace(/^c\//, '') : '';
    const title = typeof p?.title === 'string' ? p.title.trim() : '', body = typeof p?.body === 'string' ? p.body.trim() : '';
    const urlv = p?.url ? safeUrl(p.url) : null;
    const model = typeof p?.model === 'string' && p.model.trim() ? p.model.trim().toLowerCase() : null;
    if (model && !tags.has(model)) { problems.push(`Post "${title.slice(0, 40)}": unknown model "${model.slice(0, 30)}" (use an AI model slug).`); continue; }
    if (!title || title.length > 300) { problems.push(`Post ${p?._line ? `(line ${p._line})` : `#${i + 1}`}: title is missing or longer than 300 characters.`); continue; }
    if (!body) { problems.push(`Post ${p?._line ? `(line ${p._line})` : `#${i + 1}`} "${title.slice(0, 40)}": the body is required.`); continue; }
    if (body.length > 40000) { problems.push(`Post "${title.slice(0, 40)}": body is too long.`); continue; }
    if (p.url && !urlv) { problems.push(`Post "${title.slice(0, 40)}": the link must start with http:// or https://.`); continue; }
    const seoTitle = typeof p?.seo_title === 'string' ? p.seo_title.trim() : '', seoDesc = typeof p?.seo_desc === 'string' ? p.seo_desc.trim() : '';
    if (seoTitle.length > 120 || seoDesc.length > 300) { problems.push(`Post "${title.slice(0, 40)}": seo_title may be 120 characters and seo_desc 300.`); continue; }
    const wv = p?.wave === undefined || p.wave === null || p.wave === '' ? null : Number(p.wave);
    if (wv !== null && !(Number.isInteger(wv) && wv >= 1 && wv <= 99)) { problems.push(`Post "${title.slice(0, 40)}": wave must be a whole number from 1 to 99.`); continue; }
    // `published` (1/0/true/false) is the column; the older `draft` column is still read (draft = true means unpublished). Neither = published.
    const truthy = x => /^(1|true|yes)$/i.test(String(x ?? '').trim()), falsy = x => /^(0|false|no)$/i.test(String(x ?? '').trim());
    const unpublished = p?.published !== undefined && p.published !== null && String(p.published).trim() !== '' ? falsy(p.published) : truthy(p?.draft);
    P2.push({ cname, key: cname.toLowerCase(), title, body, url: urlv, tag: model ? tags.get(model) : null, seoTitle: seoTitle || null, seoDesc: seoDesc || null, wave: wv, draft: unpublished });
  }
  const res = { communitiesNew: 0, communitiesExisting: 0, postsNew: 0, postsDrafts: 0, postsDuplicate: 0, problems };
  const run = async db => {
    const ids = new Map();
    for (const [key, c] of C) {
      const r = await db.query(`INSERT INTO communities (name, title, description, ai_tag_id, creator_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT ((lower(name))) DO NOTHING RETURNING id`, [c.name, c.title, c.description, c.tag, official]);
      if (r.rows[0]) { res.communitiesNew++; ids.set(key, { id: r.rows[0].id, tag: c.tag }); } else res.communitiesExisting++;
    }
    for (const p of P2) {
      let c = ids.get(p.key);
      if (!c) { const r = (await db.query('SELECT id, ai_tag_id AS tag FROM communities WHERE lower(name) = $1 AND removed_at IS NULL', [p.key])).rows[0]; if (!r) { problems.push(`Post "${p.title.slice(0, 40)}": community "${p.cname.slice(0, 30)}" does not exist.`); continue; } c = r; ids.set(p.key, c); }
      if ((await db.query('SELECT 1 FROM posts WHERE community_id = $1 AND lower(title) = lower($2) AND deleted_at IS NULL', [c.id, p.title])).rowCount) { res.postsDuplicate++; continue; }
      // A draft is simply published = false: no public query or route can see it until it is published from the Posts panel.
      await db.query(`INSERT INTO posts (community_id, ai_tag_id, author_id, title, url, body, score, hot, published, published_at, wave, seo_title, seo_desc)
        VALUES ($1,$2,$3,$4,$5,$6,0, hot_rank(0, now()), $7, CASE WHEN $7 THEN now() END, $8, $9, $10)`, [c.id, p.tag ?? c.tag, official, p.title, p.url, p.body, !p.draft, p.wave, p.seoTitle, p.seoDesc]);
      res.postsNew++; if (p.draft) res.postsDrafts++;
    }
    await db.query(`UPDATE communities c SET post_count = (SELECT count(*) FROM posts p WHERE p.community_id = c.id AND p.deleted_at IS NULL AND p.removed_at IS NULL AND p.published)`);
    if (dry) throw new DryRun();
  };
  class DryRun extends Error {}
  try { await tx(run); } catch (e) { if (!(e instanceof DryRun)) throw e; }
  if (!dry) { logEvent('info', 'admin', `Imported ${res.postsNew} posts, ${res.communitiesNew} communities`); await invalidate(); }
  return res;
}

const importPage = (req, res, { text = '', result, status = 200 } = {}) => {
  const r = result;
  const content = html`<p class="muted">Paste <b>JSON or CSV</b> (or choose a file), or load the starter set that ships with the site. Import communities first, then posts. <b>Preview</b> shows what would happen without changing anything. Posts that already exist (same community + title) are skipped, so importing twice is safe. A posts file may also have the columns <code>published</code> (1 = live, 0 = a draft that stays hidden until you publish it in the <a href="${P}/t/posts">Posts</a> panel; blank = live; the older <code>draft</code> column, 1 = hidden, is still understood), <code>wave</code> (1–99), <code>seo_title</code> and <code>seo_desc</code>. Imported posts belong to the site account <code>u/prompts360</code>.</p>
${r?.error ? html`<p class="error" role="alert">${r.error}</p>` : ''}
${r && !r.error ? html`<div class="card"><h2>${r.dry ? 'Preview' : 'Done'}</h2><div class="kvs">${note('New communities', r.communitiesNew)}${note('Communities already there', r.communitiesExisting)}${note('New posts', r.postsNew)}${note('…of which hidden drafts', r.postsDrafts)}${note('Duplicate posts skipped', r.postsDuplicate)}</div>
${r.problems.length ? html`<h3>Problems (${r.problems.length})</h3><ul class="plain">${r.problems.slice(0, 60).map(p => html`<li>${p}</li>`)}</ul>` : ''}</div>` : ''}
<form method="post" action="${P}/import" class="edit wide">${csrf(req)}
<div class="fld"><label for="importfile">Choose a .csv or .json file <small>(its text is loaded into the box below; nothing is uploaded until you press Preview or Import)</small></label><input type="file" id="importfile" accept=".csv,.json,.txt,text/csv,application/json,text/plain" data-fill="data"><small id="importfile-note" aria-live="polite"></small></div>
<div class="fld"><label for="data">JSON or CSV</label><textarea id="data" name="data" rows="16" maxlength="4000000" placeholder="${EXAMPLE}">${text}</textarea></div>
<div class="row"><button class="btn" name="mode" value="preview">Preview</button><button class="btn primary" name="mode" value="import">Import</button>
${bundled() ? html`<button class="btn" name="mode" value="bundled-preview">Preview starter set</button><button class="btn primary" name="mode" value="bundled-import">Import starter set</button>` : ''}</div>
${bundledDrafts() ? html`<fieldset class="card"><legend>Draft library (249 posts in 3 waves)</legend><p class="muted">Ships with the site. Every post is imported as a <b>hidden draft</b>: nobody but this dashboard can see it until you publish it in the <a href="${P}/t/posts">Posts</a> panel (<code>published</code> stays off until then). Importing twice is safe (existing posts are skipped).</p>
<div class="row"><button class="btn" name="mode" value="drafts-preview">Preview draft library</button><button class="btn primary" name="mode" value="drafts-import">Import draft library as hidden drafts</button></div></fieldset>` : ''}</form>
<p class="muted">CSV templates: <a href="${P}/export/template/communities.csv">communities.csv</a> · <a href="${P}/export/template/posts.csv">posts.csv</a> (first row = column names; <code>model</code> is an AI model slug such as <code>claude</code> or <code>general</code>). To get the data out, see <a href="${P}/export">Export</a>.</p>`;
  return adminPage(req, res, { title: 'Import prompts', active: '/import', content, status });
};
export const importGet = (req, res) => importPage(req, res);
/** POST /import */
export async function importPost(req, res) {
  const mode = str(req.body.mode, 20);
  if (!['preview', 'import', 'bundled-preview', 'bundled-import', 'drafts-preview', 'drafts-import'].includes(mode)) throw new HttpError(400, 'Bad request.');
  const useBundled = mode.startsWith('bundled') || mode.startsWith('drafts');
  const text = mode.startsWith('drafts') ? bundledDrafts() : useBundled ? bundled() : str(req.body.data, 4_000_000);
  const dry = mode.endsWith('preview');
  const result = await runImport(text, { dry });
  result.dry = dry;
  return importPage(req, res, { text: useBundled ? '' : text, result, status: result.error ? 400 : 200 });
}


/** GET /posts/:id/preview — preview an unpublished post exactly as visitors will see it once published (admin session only; never cached, noindex). */
export async function postPreview(req, res, [idStr]) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return renderPost(req, res, Number(idStr), { preview: true });
}

// ---------- Reports ----------
/** GET /reports — open user reports with one-click actions. */
export async function reports(req, res) {
  const { rows } = await q(`SELECT r.id, r.reason, r.created_at, r.post_id, r.comment_id, r.community_id, ru.username AS reporter,
      p.title AS p_title, p.removed_at AS p_rem, cm.body AS c_body, cm.post_id AS c_post, cm.removed_at AS c_rem, cc.name AS m_name, cc.removed_at AS m_rem
    FROM reports r LEFT JOIN users ru ON ru.id = r.reporter_id LEFT JOIN posts p ON p.id = r.post_id LEFT JOIN comments cm ON cm.id = r.comment_id LEFT JOIN communities cc ON cc.id = r.community_id
    WHERE r.resolved_at IS NULL ORDER BY r.id LIMIT 200`);
  const items = rows.map(r => r.post_id ? { ...r, kind: 'post', preview: r.p_title, link: `/p/${r.post_id}/${slugify(r.p_title || '')}`, gone: r.p_rem }
    : r.comment_id ? { ...r, kind: 'comment', preview: (r.c_body || '').slice(0, 200), link: `/p/${r.c_post}#c${r.comment_id}`, gone: r.c_rem }
      : { ...r, kind: 'community', preview: `c/${r.m_name}`, link: `/c/${r.m_name}`, gone: r.m_rem });
  const content = items.length ? html`<ul class="plain">${items.map(r => html`<li class="card"><p class="muted">#${r.id} · ${r.kind} · reported by ${r.reporter || '[deleted]'} · ${timeAgo(r.created_at)}</p>
<p><b>Reason:</b> ${r.reason}</p><p><a href="${r.link}" target="_blank" rel="noopener">${r.preview || '(open)'}</a>${r.gone ? ' · already removed' : ''}</p>
<div class="row"><form method="post" action="${P}/reports/${r.id}/remove">${csrf(req)}<button class="btn danger">Remove content</button></form><form method="post" action="${P}/reports/${r.id}/resolve">${csrf(req)}<button class="btn">Dismiss</button></form></div></li>`)}</ul>` : html`<p class="empty">No open reports.</p>`;
  return adminPage(req, res, { title: 'Reports', active: '/reports', content });
}
/** POST /reports/:id/remove | resolve */
export const reportAction = remove => async (req, res, [idStr]) => {
  const id = Number(idStr);
  await tx(async db => {
    const r = (await db.query('SELECT post_id, comment_id, community_id FROM reports WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!r) throw new HttpError(404, 'Page not found.');
    if (remove) {
      if (r.post_id) { const p = (await db.query('UPDATE posts SET removed_at = coalesce(removed_at, now()) WHERE id = $1 RETURNING community_id', [r.post_id])).rows[0];
        if (p) await db.query(`UPDATE communities c SET post_count = (SELECT count(*) FROM posts WHERE community_id = c.id AND deleted_at IS NULL AND removed_at IS NULL) WHERE id = $1`, [p.community_id]); }
      else if (r.comment_id) { const c = (await db.query('UPDATE comments SET removed_at = coalesce(removed_at, now()) WHERE id = $1 RETURNING post_id', [r.comment_id])).rows[0];
        if (c) await db.query(`UPDATE posts SET comment_count = (SELECT count(*) FROM comments WHERE post_id = $1 AND deleted_at IS NULL AND removed_at IS NULL) WHERE id = $1`, [c.post_id]); }
      else await db.query('UPDATE communities SET removed_at = coalesce(removed_at, now()) WHERE id = $1', [r.community_id]);
    }
    await db.query('UPDATE reports SET resolved_at = now() WHERE id = $1', [id]);
  });
  logEvent('info', 'admin', `${remove ? 'Removed content for' : 'Dismissed'} report ${id}`);
  await invalidate();
  return redirect(res, `${P}/reports`);
};

// ---------- Database index ----------
export async function dbIndex(req, res) {
  const { TABLES } = await import('./crud.js');
  const { rows } = await q(`SELECT relname AS name, n_live_tup::bigint AS rows, pg_total_relation_size(relid) AS bytes FROM pg_stat_user_tables`);
  const by = new Map(rows.map(r => [r.name, r]));
  const content = html`<p class="muted">Every table the dashboard may touch. Password hashes, email fingerprints, login tokens and the email queue are deliberately not listed — they cannot be read or changed from here.</p>
${table([{ h: 'Table', f: ([n, T]) => html`<a href="${P}/t/${n}">${n}</a>` }, { h: 'Description', f: ([, T]) => T.label }, { h: 'Access', f: ([, T]) => (T.readOnly ? 'read only' : T.noEdit ? 'read · delete' : T.noCreate ? 'read · update · delete' : 'create · read · update · delete') }, { h: 'Rows (est.)', f: ([n]) => nf(by.get(n)?.rows), cls: 'num' }, { h: 'Size', f: ([n]) => (by.get(n) ? bytes(by.get(n).bytes) : '–'), cls: 'num' }], Object.entries(TABLES))}`;
  return adminPage(req, res, { title: 'Database tables', active: '/db', content });
}

// ---------- Account ----------
export async function account(req, res, extra = {}) {
  const content = html`<form method="post" action="${P}/account" class="edit narrow">${csrf(req)}${extra.error ? html`<p class="error" role="alert">${extra.error}</p>` : ''}
<div class="fld"><label for="cur">Current password</label><input id="cur" name="current" type="password" maxlength="200" required autocomplete="current-password"></div>
<div class="fld"><label for="new">New password (12–128 characters)</label><input id="new" name="password" type="password" minlength="12" maxlength="128" required autocomplete="new-password"></div>
<button class="btn primary">Change password</button><p class="muted">Changing the password signs out every dashboard session, including this one.</p></form>
<h2 class="sect">Hardening in place</h2><ul class="plain"><li>The dashboard lives at a secret address and answers 404 to everyone else.</li><li>Sign-in needs the password plus a captcha, is rate-limited per visitor, and the session is bound to your browser, expires after 30 minutes idle / 8 hours total, and uses a separate cookie from forum accounts.</li><li>Every change you make is written to the <a href="${P}/logs?kind=admin">event log</a>.</li>
<li>IP allow-list: ${config.adminIpAllow.length ? `active (${config.adminIpAllow.length} address${config.adminIpAllow.length === 1 ? '' : 'es'})` : 'not set. Set ADMIN_IP_ALLOW to a comma-separated list of IP addresses to lock the dashboard to them.'}</li></ul>`;
  return adminPage(req, res, { title: 'Account & security', active: '/account', content, status: extra.error ? 400 : 200, flash: extra.ok });
}
export async function accountPost(req, res) {
  const err = await changePassword(str(req.body.current, 200), str(req.body.password, 200));
  if (err) return account(req, res, { error: err });
  res.setHeader('Set-Cookie', clearCookie());
  return redirect(res, P);
}
