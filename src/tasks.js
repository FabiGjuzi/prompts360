// tasks.js — scheduled tasks: API calls and the daily country-file refresh, set up in the dashboard (Automation -> Scheduled tasks).
// A task has a schedule (once at a date and time, every N minutes, daily, weekly, or "follow the source": the daily time that the data
// source publishes plus an offset). All clock times are New York time. Every instance runs the same loop; a task is claimed with
// FOR UPDATE SKIP LOCKED and a lease, so it runs once even with several instances, and a crashed run is retried after the lease ends.
import { q, one, tx } from './db.js';
import { encrypt, decrypt } from './crypto.js';
import { nyDay, nyToDate, nyStamp } from './tz.js';
import { httpCall, parseHeaders, checkUrl, METHODS } from './httpcall.js';
import { refreshFromSource, DEFAULT_V4, DEFAULT_V6 } from './geoip.js';
import { logEvent } from './metrics.js';

export class TaskProblem extends Error {}
const DAY = 86_400_000, MIN = 60_000;
export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const KINDS = { api_call: 'API call', geoip_refresh: 'Country file refresh' };

// ---------- Schedule math (New York clock) ----------
const addDays = (day, n) => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const weekdayOf = day => { const [y, m, d] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
/** The next New York wall-clock time `at` ("HH:MM", on one of `days` if given) strictly after `from` (ms). */
function nextClock(from, at, days = null) {
  const today = nyDay(from);
  for (let n = 0; n <= 8; n++) {
    const day = addDays(today, n);
    if (days && !days.includes(weekdayOf(day))) continue;
    const t = nyToDate(`${day}T${at}`).getTime();
    if (t > from) return new Date(t);
  }
  return null;
}

/** When the task should run next (a Date) after `from`, or null if it never will. `sourceModified` (ms) is the data source's publish time, for 'follow'. */
export function nextRun(schedule, from = Date.now(), { sourceModified = null } = {}) {
  switch (schedule.type) {
    case 'once': { const t = new Date(schedule.at).getTime(); return t > from ? new Date(t) : null; }
    case 'every': return new Date(from + schedule.minutes * MIN);
    case 'daily': return nextClock(from, schedule.at);
    case 'weekly': return nextClock(from, schedule.at, schedule.days);
    case 'follow': {
      if (!sourceModified) return new Date(from + 60 * MIN);
      const expected = sourceModified + DAY + schedule.offset * MIN;
      if (from < expected) return new Date(expected);                       // the source is not due to publish yet
      return new Date(from + (from - expected > 3 * 3_600_000 ? 60 : 10) * MIN);   // overdue: ask again every 10 minutes (hourly once it is very late)
    }
    default: return null;
  }
}

const hhmm = s => { const m = /^(\d{2}):(\d{2})$/.exec(String(s || '')); return m && +m[1] < 24 && +m[2] < 60 ? s : null; };
/** Check a schedule object from the form; returns the cleaned object or throws TaskProblem. */
export function cleanSchedule(s, kind) {
  switch (s?.type) {
    case 'once': { const t = new Date(s.at ?? NaN); if (Number.isNaN(t.getTime())) throw new TaskProblem('Pick the date and time to run once.'); return { type: 'once', at: t.toISOString() }; }
    case 'every': { const n = Number(s.minutes); if (!Number.isInteger(n) || n < 1 || n > 10080) throw new TaskProblem('Every N minutes: N must be a whole number from 1 to 10080 (one week).'); return { type: 'every', minutes: n }; }
    case 'daily': { if (!hhmm(s.at)) throw new TaskProblem('Pick the time of day (New York time).'); return { type: 'daily', at: s.at }; }
    case 'weekly': {
      if (!hhmm(s.at)) throw new TaskProblem('Pick the time of day (New York time).');
      const days = [...new Set((s.days || []).map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort();
      if (!days.length) throw new TaskProblem('Tick at least one weekday.');
      return { type: 'weekly', days, at: s.at };
    }
    case 'follow': {
      if (kind !== 'geoip_refresh') throw new TaskProblem('“Follow the data source” only works for the country file refresh.');
      const n = Number(s.offset); if (!Number.isInteger(n) || n < 0 || n > 1440) throw new TaskProblem('The offset must be a whole number of minutes from 0 to 1440.');
      return { type: 'follow', offset: n };
    }
    default: throw new TaskProblem('Choose when the task runs.');
  }
}

export function describeSchedule(s) {
  switch (s.type) {
    case 'once': return `Once, ${nyStamp(new Date(s.at))}`;
    case 'every': return s.minutes % 1440 === 0 ? `Every ${s.minutes / 1440} day${s.minutes === 1440 ? '' : 's'}` : s.minutes % 60 === 0 ? `Every ${s.minutes / 60} hour${s.minutes === 60 ? '' : 's'}` : `Every ${s.minutes} minute${s.minutes === 1 ? '' : 's'}`;
    case 'daily': return `Daily at ${s.at} New York time`;
    case 'weekly': return `${s.days.map(d => WEEKDAYS[d].slice(0, 3)).join(', ')} at ${s.at} New York time`;
    case 'follow': return `Daily, ${s.offset} min after the data source publishes`;
    default: return '–';
  }
}

// ---------- Validating a task definition ----------
/** Config for a kind, cleaned. Throws TaskProblem. */
export function cleanConfig(kind, c) {
  try {
    if (kind === 'api_call') {
      const method = String(c.method || 'GET').toUpperCase();
      if (!METHODS.includes(method)) throw new TaskProblem('Pick a method.');
      const url = String(c.url || '').trim();
      if (url.length > 2000) throw new TaskProblem('The URL is too long.');
      checkUrl(url);
      const body = String(c.body || '');
      if (body.length > 16_384) throw new TaskProblem('The request body is limited to 16 KB.');
      const timeout = Number(c.timeout || 15);
      if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30) throw new TaskProblem('Timeout: 1 to 30 seconds.');
      return { method, url, body, timeout };
    }
    const v4Url = String(c.v4Url || DEFAULT_V4).trim(), v6Url = String(c.v6Url || DEFAULT_V6).trim();
    checkUrl(v4Url); checkUrl(v6Url);
    return { v4Url, v6Url };
  } catch (e) { if (e instanceof TaskProblem) throw e; throw new TaskProblem(e.message); }
}

const aad = id => `task:${id}`;
/** Encrypted header storage. `text` is "Name: value" lines; returns a Buffer or null. */
export function sealHeaders(id, text) {
  const h = parseHeaders(text);   // throws Error with a readable message
  return Object.keys(h).length ? encrypt(JSON.stringify(h), aad(id)) : null;
}
export const openHeaders = (id, blob) => { try { return blob ? JSON.parse(decrypt(blob, aad(id)) || '{}') : {}; } catch { return {}; } };
export const headerNames = (id, blob) => Object.keys(openHeaders(id, blob));

async function sourceModifiedMs() { const m = await one('SELECT source_modified FROM geoip_meta WHERE id = 1'); return m?.source_modified ? new Date(m.source_modified).getTime() : null; }

// ---------- Creating, changing, deleting ----------
/** Create a task. `headersText` is optional. Returns the new id. */
export async function createTask({ name, kind, enabled = true, schedule, config, headersText = '' }) {
  name = String(name || '').trim();
  if (!name || name.length > 80) throw new TaskProblem('Give the task a name (up to 80 characters).');
  if (!KINDS[kind]) throw new TaskProblem('Choose what the task does.');
  const sched = cleanSchedule(schedule, kind), cfg = cleanConfig(kind, config);
  let blob = null;
  if (kind === 'api_call' && String(headersText).trim()) { try { parseHeaders(headersText); } catch (e) { throw new TaskProblem(e.message); } }
  const next = enabled ? nextRun(sched, Date.now(), { sourceModified: await sourceModifiedMs() }) : null;
  const id = await tx(async db => {
    const { rows: [r] } = await db.query('INSERT INTO scheduled_tasks (name, kind, enabled, schedule, config, next_run) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id', [name, kind, enabled, sched, cfg, next]);
    if (kind === 'api_call' && String(headersText).trim()) { blob = sealHeaders(r.id, headersText); await db.query('UPDATE scheduled_tasks SET headers_enc = $2 WHERE id = $1', [r.id, blob]); }
    return r.id;
  });
  logEvent('info', 'admin', `Created scheduled task ${id} (${name})`);
  return id;
}

/** Update a task. headers: undefined = keep, '' with clearHeaders = remove, text = replace. */
export async function updateTask(id, { name, enabled, schedule, config, headersText, clearHeaders = false }) {
  const old = await one('SELECT * FROM scheduled_tasks WHERE id = $1', [id]);
  if (!old) return false;
  name = String(name || '').trim();
  if (!name || name.length > 80) throw new TaskProblem('Give the task a name (up to 80 characters).');
  const sched = cleanSchedule(schedule, old.kind), cfg = cleanConfig(old.kind, config);
  let headers = old.headers_enc;
  if (old.kind === 'api_call') {
    if (clearHeaders) headers = null;
    else if (String(headersText || '').trim()) { try { headers = sealHeaders(id, headersText); } catch (e) { throw new TaskProblem(e.message); } }
  }
  const next = enabled ? nextRun(sched, Date.now(), { sourceModified: await sourceModifiedMs() }) : null;
  await q('UPDATE scheduled_tasks SET name = $2, enabled = $3, schedule = $4, config = $5, headers_enc = $6, next_run = $7 WHERE id = $1', [id, name, enabled, sched, cfg, headers, next]);
  logEvent('info', 'admin', `Updated scheduled task ${id} (${name})`);
  return true;
}

export async function setEnabled(id, enabled) {
  const t = await one('SELECT * FROM scheduled_tasks WHERE id = $1', [id]);
  if (!t) return false;
  const next = enabled ? nextRun(t.schedule, Date.now(), { sourceModified: await sourceModifiedMs() }) : null;
  await q('UPDATE scheduled_tasks SET enabled = $2, next_run = $3 WHERE id = $1', [id, enabled, next]);
  return true;
}

export async function deleteTask(id) {
  const r = await q('DELETE FROM scheduled_tasks WHERE id = $1', [id]);
  if (r.rowCount) logEvent('warn', 'admin', `Deleted scheduled task ${id}`);
  return r.rowCount > 0;
}

/** Create the built-in country-file refresh once (the first start). It can be edited, disabled or deleted in the dashboard, and deleting it sticks. */
export async function ensureBuiltinTasks() {
  const first = await one('UPDATE geoip_meta SET task_seeded = true WHERE id = 1 AND NOT task_seeded RETURNING id');
  if (!first) return;
  const schedule = { type: 'follow', offset: 15 };
  const next = nextRun(schedule, Date.now(), { sourceModified: await sourceModifiedMs() });
  await q(`INSERT INTO scheduled_tasks (name, kind, schedule, config, next_run) VALUES ('Refresh the visitor country file (IPtoASN)', 'geoip_refresh', $1, $2, $3)`, [schedule, { v4Url: DEFAULT_V4, v6Url: DEFAULT_V6 }, next]);
}

// ---------- Running ----------
const snippet = buf => buf.toString('utf8').replace(/[^\x20-\x7e\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
const sizeText = n => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

/** Do the work of one task. Returns { ok, message }. Never throws. */
export async function execute(task) {
  try {
    if (task.kind === 'api_call') {
      const c = task.config;
      const r = await httpCall({ url: c.url, method: c.method, headers: openHeaders(task.id, task.headers_enc), body: c.body || null, timeoutMs: (c.timeout || 15) * 1000, maxBytes: 65_536 });
      const ok = r.status >= 200 && r.status < 300;
      return { ok, message: `HTTP ${r.status} · ${sizeText(r.body.length)}${r.truncated ? '+' : ''} · ${r.ms} ms${r.body.length ? ` · ${snippet(r.body)}` : ''}` };
    }
    if (task.kind === 'geoip_refresh') {
      const r = await refreshFromSource({ v4Url: task.config.v4Url, v6Url: task.config.v6Url });
      return { ok: r.ok, message: r.message };
    }
    return { ok: false, message: 'Unknown task kind' };
  } catch (e) { return { ok: false, message: `Failed: ${String(e.message).slice(0, 300)}` }; }
}

async function finish(task, res, startedAt, trigger) {
  const sourceModified = task.kind === 'geoip_refresh' ? await sourceModifiedMs() : null;
  const once = task.schedule.type === 'once';
  const enabled = once ? false : task.enabled;
  const next = enabled ? nextRun(task.schedule, Date.now(), { sourceModified }) : null;
  await q('UPDATE scheduled_tasks SET lease_until = NULL, last_run = $2, last_ok = $3, last_message = $4, enabled = $5, next_run = $6 WHERE id = $1', [task.id, startedAt, res.ok, res.message.slice(0, 600), enabled, next]);
  await q('INSERT INTO task_runs (task_id, started_at, finished_at, ok, trigger, message) VALUES ($1, $2, now(), $3, $4, $5)', [task.id, startedAt, res.ok, trigger, res.message.slice(0, 600)]);
  await q('DELETE FROM task_runs WHERE task_id = $1 AND id < COALESCE((SELECT id FROM task_runs WHERE task_id = $1 ORDER BY id DESC OFFSET 99 LIMIT 1), 0)', [task.id]);
  if (!res.ok) logEvent('warn', 'tasks', `Task ${task.id} (${task.name}): ${res.message}`.slice(0, 300));
}

async function runClaimed(task, trigger) {
  const startedAt = new Date();
  const res = await execute(task);
  try { await finish(task, res, startedAt, trigger); } catch (e) { console.error('[tasks]', e.message); }
  return res;
}

/** Run every task that is due (at most `limit` at once). Called by the scheduler loop and by tests. */
export async function runDue(limit = 3) {
  const { rows } = await q(`UPDATE scheduled_tasks SET lease_until = now() + interval '10 minutes'
    WHERE id IN (SELECT id FROM scheduled_tasks WHERE enabled AND next_run <= now() AND (lease_until IS NULL OR lease_until < now()) ORDER BY next_run LIMIT $1 FOR UPDATE SKIP LOCKED) RETURNING *`, [limit]);
  const out = [];
  for (const t of rows) out.push({ id: t.id, ...(await runClaimed(t, 'schedule')) });
  return out;
}

/** "Run now": claim this task (even if disabled) and run it in the background. Returns false if it is already running or does not exist. */
export async function runNow(id, { wait = false } = {}) {
  const { rows: [t] } = await q(`UPDATE scheduled_tasks SET lease_until = now() + interval '10 minutes' WHERE id = $1 AND (lease_until IS NULL OR lease_until < now()) RETURNING *`, [id]);
  if (!t) return false;
  const p = runClaimed(t, 'manual');
  if (wait) await p; else p.catch(() => {});
  return true;
}

let timer = null;
export function startScheduler() {
  if (timer) return;
  timer = setInterval(() => runDue().catch(e => console.error('[tasks]', e.message)), 20_000);
  timer.unref();
}
export const stopScheduler = () => { if (timer) clearInterval(timer); timer = null; };
