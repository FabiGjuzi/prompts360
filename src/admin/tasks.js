// admin/tasks.js — Automation -> Scheduled tasks: list, create, edit, delete, run now, run history. Clock times are New York time.
import { q, one } from '../db.js';
import { html, raw } from '../html.js';
import { redirect, str, HttpError } from '../http.js';
import { nyInput, nyToDate } from '../tz.js';
import { adminPage, csrf, table, card, when, P } from './ui.js';
import { METHODS } from '../httpcall.js';
import { DEFAULT_V4, DEFAULT_V6 } from '../geoip.js';
import { TaskProblem, KINDS, WEEKDAYS, describeSchedule, createTask, updateTask, deleteTask, setEnabled, runNow, headerNames } from '../tasks.js';

const url = (rest = '') => `${P}/tasks${rest}`;
const badge = t => (t.last_run ? (t.last_ok ? html`<span class="pill ok">OK</span>` : html`<span class="pill bad">Failed</span>`) : html`<span class="muted">never run</span>`);

/** GET /tasks */
export async function list(req, res) {
  const { rows } = await q('SELECT * FROM scheduled_tasks ORDER BY id');
  const flash = { created: 'Task created.', saved: 'Saved.', deleted: 'Deleted.', started: 'Started. Refresh in a few seconds to see the result.', busy: 'That task is already running.' }[req.query.get('n')];
  const cols = [
    { h: 'Name', f: t => html`<a href="${url(`/${t.id}`)}">${t.name}</a>` },
    { h: 'Does', f: t => KINDS[t.kind] },
    { h: 'Schedule', f: t => describeSchedule(t.schedule) },
    { h: 'Next run', f: t => (t.enabled ? when(t.next_run) : html`<span class="muted">${t.schedule.type === 'once' && t.last_run ? 'finished' : 'paused'}</span>`) },
    { h: 'Last run', f: t => html`${when(t.last_run)} ${badge(t)}` },
    { h: 'Result', f: t => html`<small>${t.last_message || ''}</small>` },
    { h: '', cls: 'act', f: t => html`<form method="post" action="${url(`/${t.id}/run`)}" class="inline">${csrf(req)}<button class="btn sm">Run now</button></form>
<form method="post" action="${url(`/${t.id}/toggle`)}" class="inline">${csrf(req)}<button class="btn sm">${t.enabled ? 'Pause' : 'Resume'}</button></form>
<a href="${url(`/${t.id}/runs`)}">history</a> · <a href="${url(`/${t.id}`)}">edit</a>` },
  ];
  const content = html`<div class="bar-tools"><a class="btn primary" href="${url('/new')}">+ New task</a><span class="muted">${rows.length} task${rows.length === 1 ? '' : 's'} · times are New York time · checked every 20 seconds</span></div>
${table(cols, rows, { empty: 'No tasks yet.' })}
<p class="muted">An API call task sends one HTTPS request to a public address and records the HTTP status and the start of the answer. The country file refresh keeps the visitor map’s IP ranges up to date; see <a href="${P}/geoip">Visitor locations</a>.</p>`;
  return adminPage(req, res, { title: 'Scheduled tasks', active: '/tasks', content, flash });
}

// ---------- form ----------
const SCHEDULES = [['once', 'Once, at a date and time'], ['every', 'Repeat every N minutes'], ['daily', 'Every day at a time'], ['weekly', 'On chosen weekdays at a time'], ['follow', 'Follow the data source (country file only)']];

function fields(t, kind) {
  const s = t.schedule || { type: 'daily', at: '09:00' }, c = t.config || {};
  const sel = (name, opts, v) => html`<select id="${name}" name="${name}">${opts.map(([val, lab]) => html`<option value="${val}"${String(v) === val ? raw(' selected') : ''}>${lab}</option>`)}</select>`;
  const L = (id, label, inner, hint) => html`<div class="fld"><label for="${id}">${label}</label>${inner}${hint ? html`<small class="muted">${hint}</small>` : ''}</div>`;
  return html`
${L('name', 'Name', html`<input type="text" id="name" name="name" maxlength="80" value="${t.name || ''}" required>`)}
<div class="fld chk"><input type="checkbox" id="enabled" name="enabled" value="1"${t.enabled === false ? '' : raw(' checked')}><input type="hidden" name="enabled" value="0"><label for="enabled">Enabled</label></div>
<fieldset class="fld"><legend>When</legend>
${L('stype', 'Schedule type', sel('stype', SCHEDULES.filter(([v]) => v !== 'follow' || kind === 'geoip_refresh'), s.type), 'Fill in only the part that matches the type you chose; the rest is ignored.')}
${L('s_at_once', 'Once: date and time (New York time)', html`<input type="datetime-local" id="s_at_once" name="s_at_once" value="${s.type === 'once' ? nyInput(s.at) : ''}">`)}
${L('s_minutes', 'Repeat: every how many minutes', html`<input type="number" id="s_minutes" name="s_minutes" min="1" max="10080" step="1" value="${s.type === 'every' ? s.minutes : ''}">`, '60 = hourly, 1440 = daily.')}
${L('s_at', 'Daily / weekly: time of day (New York time)', html`<input type="time" id="s_at" name="s_at" value="${s.at && (s.type === 'daily' || s.type === 'weekly') ? s.at : ''}">`)}
<div class="fld"><span>Weekly: days</span><div>${WEEKDAYS.map((d, i) => html`<label class="inl"><input type="checkbox" name="s_day${i}" value="1"${s.type === 'weekly' && s.days.includes(i) ? raw(' checked') : ''}> ${d.slice(0, 3)}</label> `)}</div></div>
${kind === 'geoip_refresh' ? L('s_offset', 'Follow the source: minutes after it publishes', html`<input type="number" id="s_offset" name="s_offset" min="0" max="1440" step="1" value="${s.type === 'follow' ? s.offset : 15}">`, 'The task reads the source file’s own publish time. Each day it runs this many minutes after that time, and if the source has not published yet it asks again every 10 minutes.') : ''}
</fieldset>
${kind === 'api_call' ? html`<fieldset class="fld"><legend>Request</legend>
${L('method', 'Method', sel('method', METHODS.map(m => [m, m]), c.method || 'GET'))}
${L('u', 'URL (https only, public address)', html`<input type="url" id="u" name="url" maxlength="2000" value="${c.url || ''}" required placeholder="https://api.example.com/path">`)}
${L('hdr', 'Headers (one per line: Name: value)', html`<textarea id="hdr" name="headers" rows="3" maxlength="6000" autocomplete="off" placeholder="${t.id && t.hnames?.length ? `Saved: ${t.hnames.join(', ')} (values are hidden). Type here to replace them.` : 'Authorization: Bearer …'}"></textarea>`, 'Stored encrypted and never shown again.')}
${t.id && t.hnames?.length ? html`<div class="fld chk"><input type="checkbox" id="clearh" name="clear_headers" value="1"><label for="clearh">Remove the saved headers</label></div>` : ''}
${L('body', 'Body (optional, up to 16 KB)', html`<textarea id="body" name="body" rows="4" maxlength="16384">${c.body || ''}</textarea>`)}
${L('timeout', 'Timeout (seconds, 1 to 30)', html`<input type="number" id="timeout" name="timeout" min="1" max="30" step="1" value="${c.timeout || 15}">`)}
</fieldset>` : html`<fieldset class="fld"><legend>Source files</legend>
${L('v4', 'IPv4 file URL', html`<input type="url" id="v4" name="v4Url" maxlength="2000" value="${c.v4Url || DEFAULT_V4}">`, 'CSV lines: from,to,CC. Default: the IPtoASN country list (public domain) as published by the sapics/ip-location-db project.')}
${L('v6', 'IPv6 file URL', html`<input type="url" id="v6" name="v6Url" maxlength="2000" value="${c.v6Url || DEFAULT_V6}">`)}</fieldset>`}`;
}

async function formPage(req, res, { task = {}, kind, error, status = 200 }) {
  const isNew = !task.id;
  const kinds = isNew ? html`<form method="get" action="${url('/new')}" class="inline"><label for="kind">What should it do?</label> <select id="kind" name="kind">${Object.entries(KINDS).map(([k, l]) => html`<option value="${k}"${k === kind ? raw(' selected') : ''}>${l}</option>`)}</select> <button class="btn sm">Use</button></form>` : '';
  const content = html`<p><a href="${url()}">← Scheduled tasks</a></p>${kinds}${error ? html`<p class="error" role="alert">${error}</p>` : ''}
<form method="post" action="${isNew ? url('/new') : url(`/${task.id}`)}" class="edit">${csrf(req)}${isNew ? html`<input type="hidden" name="kind" value="${kind}">` : ''}${fields(task, kind)}<button class="btn primary">${isNew ? 'Create task' : 'Save'}</button></form>
${!isNew ? html`<details class="danger"><summary>Delete this task</summary><form method="post" action="${url(`/${task.id}/delete`)}">${csrf(req)}<p>The task and its run history are removed.</p><button class="btn danger">Yes, delete</button></form></details>` : ''}`;
  return adminPage(req, res, { title: isNew ? `New task · ${KINDS[kind]}` : `Edit · ${task.name}`, active: '/tasks', content, status });
}

/** Turn the posted form into the arguments for createTask / updateTask. */
function readForm(b, kind) {
  const type = str(b.stype, 20);
  const schedule = { type };
  if (type === 'once') schedule.at = (() => { const s = str(b.s_at_once, 40); const d = nyToDate(s); return Number.isNaN(d.getTime()) ? null : d.toISOString(); })();
  if (type === 'every') schedule.minutes = Number(str(b.s_minutes, 10));
  if (type === 'daily' || type === 'weekly') schedule.at = str(b.s_at, 5);
  if (type === 'weekly') schedule.days = [0, 1, 2, 3, 4, 5, 6].filter(i => b[`s_day${i}`] === '1');
  if (type === 'follow') schedule.offset = Number(str(b.s_offset, 6));
  const config = kind === 'api_call'
    ? { method: str(b.method, 10), url: str(b.url, 2100), body: str(b.body, 17000).replace(/\r\n/g, '\n'), timeout: str(b.timeout, 4) }
    : { v4Url: str(b.v4Url, 2100), v6Url: str(b.v6Url, 2100) };
  return { name: str(b.name, 200), enabled: b.enabled === '1', schedule, config, headersText: str(b.headers, 6100), clearHeaders: b.clear_headers === '1' };
}
/** The posted values, shaped like a stored task, to show the form again after an error. */
const repost = b => {
  const at = nyToDate(str(b.s_at_once, 40));
  const type = ['once', 'every', 'daily', 'weekly', 'follow'].includes(b.stype) ? b.stype : 'daily';
  const schedule = { type, at: type === 'once' ? (Number.isNaN(at.getTime()) ? undefined : at.toISOString()) : b.s_at, minutes: b.s_minutes, offset: b.s_offset, days: [0, 1, 2, 3, 4, 5, 6].filter(i => b[`s_day${i}`] === '1') };
  return { name: b.name, enabled: b.enabled !== '0', schedule, config: { method: b.method, url: b.url, body: b.body, timeout: b.timeout, v4Url: b.v4Url, v6Url: b.v6Url } };
};

export async function newForm(req, res) {
  const k = req.query.get('kind');
  const kind = KINDS[k] ? k : 'api_call';
  return formPage(req, res, { kind, task: { schedule: kind === 'geoip_refresh' ? { type: 'follow', offset: 15 } : { type: 'daily', at: '09:00' } } });
}

export async function create(req, res) {
  const kind = KINDS[req.body.kind] ? req.body.kind : 'api_call';
  try {
    await createTask({ kind, ...readForm(req.body, kind) });
    return redirect(res, `${url()}?n=created`);
  } catch (e) {
    if (!(e instanceof TaskProblem)) throw e;
    return formPage(req, res, { kind, error: e.message, status: 400, task: repost(req.body) });
  }
}

async function load(id) {
  const t = await one('SELECT * FROM scheduled_tasks WHERE id = $1', [id]);
  if (!t) throw new HttpError(404, 'Page not found.');
  return t;
}

export async function editForm(req, res, [id]) {
  const t = await load(id);
  return formPage(req, res, { kind: t.kind, task: { ...t, hnames: headerNames(t.id, t.headers_enc) } });
}

export async function update(req, res, [id]) {
  const t = await load(id);
  try {
    await updateTask(t.id, readForm(req.body, t.kind));
    return redirect(res, `${url()}?n=saved`);
  } catch (e) {
    if (!(e instanceof TaskProblem)) throw e;
    return formPage(req, res, { kind: t.kind, error: e.message, status: 400, task: { ...repost(req.body), id: t.id, hnames: headerNames(t.id, t.headers_enc) } });
  }
}

export async function remove(req, res, [id]) { await load(id); await deleteTask(Number(id)); return redirect(res, `${url()}?n=deleted`); }
export async function toggle(req, res, [id]) { const t = await load(id); await setEnabled(t.id, !t.enabled); return redirect(res, `${url()}?n=saved`); }
export async function run(req, res, [id]) { await load(id); const ok = await runNow(Number(id)); return redirect(res, `${url()}?n=${ok ? 'started' : 'busy'}`); }

/** GET /tasks/:id/runs */
export async function runs(req, res, [id]) {
  const t = await load(id);
  const { rows } = await q('SELECT * FROM task_runs WHERE task_id = $1 ORDER BY id DESC LIMIT 100', [t.id]);
  const content = html`<p><a href="${url()}">← Scheduled tasks</a> · <a href="${url(`/${t.id}`)}">edit this task</a></p>
${table([{ h: 'Started (New York)', f: r => when(r.started_at) }, { h: 'Result', f: r => (r.ok ? html`<span class="pill ok">OK</span>` : html`<span class="pill bad">Failed</span>`) }, { h: 'Started by', f: r => r.trigger }, { h: 'Message', f: r => html`<small>${r.message || ''}</small>` }], rows, { empty: 'No runs yet.' })}
<p class="muted">The last 100 runs are kept.</p>`;
  return adminPage(req, res, { title: `Runs · ${t.name}`, active: '/tasks', content });
}
