// Scheduled tasks: schedule maths in New York time, the dashboard pages, running, leases, the safe HTTP client, the built-in country refresh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { boot, adminClient, client, ADMIN } from './_helpers.js';
import * as T from '../src/tasks.js';
import { httpCall, setHttpPolicy, parseHeaders, checkUrl } from '../src/httpcall.js';

let app, adm, stub, hits = [], reply = { status: 200, body: '{"ok":true}' };
before(async () => {
  app = await boot(); adm = await adminClient(app);
  stub = http.createServer((req, res) => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { hits.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: b }); res.statusCode = reply.status; res.end(reply.body); }); });
  await new Promise(r => stub.listen(18097, '127.0.0.1', r));
  setHttpPolicy({ allowPrivate: true, allowHttp: true });
});
after(async () => { setHttpPolicy({ allowPrivate: false, allowHttp: false }); await new Promise(r => stub.close(r)); await app.close(); });
const U = (...a) => Date.UTC(...a);
const iso = d => d?.toISOString();
const STUB = 'http://127.0.0.1:18097/hook';
const tasks = async () => (await app.db.q('SELECT * FROM scheduled_tasks ORDER BY id')).rows;

test('daily and weekly times are New York wall-clock times, across daylight saving', () => {
  // 09:00 New York = 14:00Z in winter (EST), 13:00Z in summer (EDT)
  assert.equal(iso(T.nextRun({ type: 'daily', at: '09:00' }, U(2026, 0, 15, 10, 0))), '2026-01-15T14:00:00.000Z');
  assert.equal(iso(T.nextRun({ type: 'daily', at: '09:00' }, U(2026, 0, 15, 15, 0))), '2026-01-16T14:00:00.000Z');
  assert.equal(iso(T.nextRun({ type: 'daily', at: '09:00' }, U(2026, 6, 4, 10, 0))), '2026-07-04T13:00:00.000Z');
  // the day clocks go back (2026-11-01 06:00Z): 09:00 that morning is already EST (14:00Z); 01:30 happened twice and the first is used
  assert.equal(iso(T.nextRun({ type: 'daily', at: '09:00' }, U(2026, 10, 1, 12, 0))), '2026-11-01T14:00:00.000Z');
  assert.equal(iso(T.nextRun({ type: 'daily', at: '09:00' }, U(2026, 10, 1, 15, 0))), '2026-11-02T14:00:00.000Z');
  assert.equal(iso(T.nextRun({ type: 'daily', at: '01:30' }, U(2026, 10, 1, 4, 0))), '2026-11-01T05:30:00.000Z');
  // spring forward (2026-03-08): 02:30 does not exist and lands an hour later
  assert.equal(iso(T.nextRun({ type: 'daily', at: '02:30' }, U(2026, 2, 8, 5, 0))), '2026-03-08T07:30:00.000Z');
  // weekly: Mon + Thu 09:00. 2026-11-07 is a Saturday -> Monday the 9th
  assert.equal(iso(T.nextRun({ type: 'weekly', days: [1, 4], at: '09:00' }, U(2026, 10, 7, 18, 0))), '2026-11-09T14:00:00.000Z');
  assert.equal(iso(T.nextRun({ type: 'weekly', days: [1, 4], at: '09:00' }, U(2026, 10, 9, 15, 0))), '2026-11-12T14:00:00.000Z');
});

test('once, every, and follow-the-source schedules', () => {
  const now = U(2026, 10, 7, 18, 0);
  assert.equal(T.nextRun({ type: 'once', at: '2026-11-08T12:00:00.000Z' }, now).toISOString(), '2026-11-08T12:00:00.000Z');
  assert.equal(T.nextRun({ type: 'once', at: '2026-11-01T12:00:00.000Z' }, now), null, 'a time in the past never runs');
  assert.equal(T.nextRun({ type: 'every', minutes: 90 }, now).getTime(), now + 90 * 60_000);
  const src = U(2026, 10, 7, 1, 44, 30);                                    // the source published at 01:44:30Z
  const due = src + 86_400_000 + 15 * 60_000;                               // tomorrow 01:59:30Z
  assert.equal(T.nextRun({ type: 'follow', offset: 15 }, now, { sourceModified: src }).getTime(), due, '24 h after the source published, plus 15 minutes');
  assert.equal(T.nextRun({ type: 'follow', offset: 15 }, due + 60_000, { sourceModified: src }).getTime(), due + 60_000 + 10 * 60_000, 'overdue: ask again in 10 minutes');
  assert.equal(T.nextRun({ type: 'follow', offset: 15 }, due + 4 * 3_600_000, { sourceModified: src }).getTime(), due + 4 * 3_600_000 + 60 * 60_000, 'very late: hourly');
  assert.ok(T.describeSchedule({ type: 'follow', offset: 15 }).includes('15 min'));
});

test('schedules and requests are validated', () => {
  assert.throws(() => T.cleanSchedule({ type: 'every', minutes: 0 }, 'api_call'), T.TaskProblem);
  assert.throws(() => T.cleanSchedule({ type: 'daily', at: '25:00' }, 'api_call'), T.TaskProblem);
  assert.throws(() => T.cleanSchedule({ type: 'weekly', days: [], at: '09:00' }, 'api_call'), T.TaskProblem);
  assert.throws(() => T.cleanSchedule({ type: 'once' }, 'api_call'), T.TaskProblem);
  assert.throws(() => T.cleanSchedule({ type: 'follow', offset: 15 }, 'api_call'), /only works for the country file/);
  setHttpPolicy({ allowPrivate: false, allowHttp: false });
  try {
    for (const u of ['http://example.com/', 'https://127.0.0.1/', 'https://10.0.0.5/x', 'https://[::1]/', 'https://169.254.169.254/latest', 'https://user:pw@example.com/', 'ftp://example.com/', 'nope']) assert.throws(() => checkUrl(u), Error, u);
    assert.ok(checkUrl('https://api.example.com/v1?x=1'));
  } finally { setHttpPolicy({ allowPrivate: true, allowHttp: true }); }
  assert.deepEqual(parseHeaders('Authorization: Bearer abc\nX-Id: 7'), { authorization: 'Bearer abc', 'x-id': '7' });
  assert.throws(() => parseHeaders('Host: evil'), /set by the server/);
  assert.throws(() => parseHeaders('no colon here'), /Name: value/);
});

test('the HTTP client refuses hosts that resolve to internal addresses (DNS rebinding / metadata service)', async () => {
  setHttpPolicy({ allowPrivate: false, allowHttp: false });
  try {
    await assert.rejects(httpCall({ url: 'https://localhost/' }), /internal address/);
    await assert.rejects(httpCall({ url: 'https://127.0.0.1:18097/' }), /internal/);
  } finally { setHttpPolicy({ allowPrivate: true, allowHttp: true }); }
});

test('the HTTP client connects by host name (the DNS path) when the policy allows a local stub', async () => {
  hits = [];
  const r = await httpCall({ url: 'http://localhost:18097/by-name', timeoutMs: 5000 });
  assert.equal(r.status, 200); assert.equal(hits[0].url, '/by-name');
});

test('create an API task in the dashboard: encrypted headers, New York next run, never shown again', async () => {
  const secret = 'Bearer s3cr3t-token-value';
  const r = await adm.apost('/tasks/new', { kind: 'api_call', name: 'Ping the hook', enabled: '1', stype: 'daily', s_at: '09:00', method: 'POST', url: STUB, headers: `Authorization: ${secret}`, body: '{"a":1}', timeout: '10' });
  assert.equal(r.status, 303, r.text.slice(0, 300));
  const [t] = await tasks();
  assert.equal(t.name, 'Ping the hook'); assert.equal(t.kind, 'api_call');
  assert.deepEqual(t.schedule, { type: 'daily', at: '09:00' });
  assert.ok(t.next_run > new Date());
  assert.ok(t.headers_enc && !Buffer.from(t.headers_enc).includes('s3cr3t'), 'headers are encrypted at rest');
  const list = (await adm.get(`${ADMIN}/tasks`)).text;
  assert.match(list, /Ping the hook/); assert.match(list, /Daily at 09:00 New York time/); assert.match(list, / E[SD]T/);
  const edit = (await adm.get(`${ADMIN}/tasks/${t.id}`)).text;
  assert.ok(!edit.includes('s3cr3t'), 'the saved header value is never shown');
  assert.match(edit, /Saved: authorization/);
  // validation errors keep the form
  const bad = await adm.apost('/tasks/new', { kind: 'api_call', name: 'x', enabled: '1', stype: 'every', s_minutes: '0', method: 'GET', url: STUB, timeout: '10' });
  assert.equal(bad.status, 400); assert.match(bad.text, /N must be a whole number/);
  setHttpPolicy({ allowPrivate: false, allowHttp: false });
  try {
    for (const url of ['http://example.com/', 'https://127.0.0.1/', 'https://169.254.169.254/latest/meta-data']) {
      const b2 = await adm.apost('/tasks/new', { kind: 'api_call', name: 'x', enabled: '1', stype: 'daily', s_at: '10:00', method: 'GET', url, timeout: '10' });
      assert.equal(b2.status, 400, url); assert.match(b2.text, /Only https|internal/);
    }
  } finally { setHttpPolicy({ allowPrivate: true, allowHttp: true }); }
  assert.equal((await tasks()).length, 1, 'nothing was created by the refused forms');
});

test('run now sends the request with the decrypted header and records the result and history', async () => {
  const [t] = await tasks();
  hits = [];
  assert.equal((await adm.apost(`/tasks/${t.id}/run`, {})).status, 303);
  for (let i = 0; i < 50 && !(await tasks())[0].last_run; i++) await new Promise(r => setTimeout(r, 100));
  const [u] = await tasks();
  assert.equal(hits.length, 1);
  assert.equal(hits[0].method, 'POST'); assert.equal(hits[0].auth, 'Bearer s3cr3t-token-value'); assert.equal(hits[0].body, '{"a":1}');
  assert.equal(u.last_ok, true); assert.match(u.last_message, /^HTTP 200 · \d+ B · \d+ ms · \{"ok":true\}/);
  assert.equal(u.lease_until, null);
  const runs = (await adm.get(`${ADMIN}/tasks/${t.id}/runs`)).text;
  assert.match(runs, /manual/); assert.match(runs, /HTTP 200/);
  reply = { status: 500, body: 'boom' };
  await T.runNow(t.id, { wait: true });
  assert.equal((await tasks())[0].last_ok, false); assert.match((await tasks())[0].last_message, /HTTP 500/);
  reply = { status: 200, body: '{"ok":true}' };
});

test('due tasks run once even if two instances check at the same moment; a one-time task then pauses itself', async () => {
  hits = [];
  const id = await T.createTask({ name: 'Once', kind: 'api_call', schedule: { type: 'once', at: new Date(Date.now() + 3_600_000).toISOString() }, config: { url: STUB, method: 'GET', timeout: 5 } });
  await app.db.q(`UPDATE scheduled_tasks SET next_run = now() - interval '1 minute' WHERE id = $1`, [id]);
  const [a, b] = await Promise.all([T.runDue(), T.runDue()]);
  assert.equal(a.length + b.length, 1, 'claimed by exactly one');
  assert.equal(hits.length, 1);
  const row = (await app.db.q('SELECT * FROM scheduled_tasks WHERE id = $1', [id])).rows[0];
  assert.equal(row.enabled, false); assert.equal(row.next_run, null); assert.equal(row.last_ok, true);
  assert.equal((await T.runDue()).length, 0);
  // a repeating task is rescheduled
  const id2 = await T.createTask({ name: 'Every 5', kind: 'api_call', schedule: { type: 'every', minutes: 5 }, config: { url: STUB, method: 'GET', timeout: 5 } });
  await app.db.q(`UPDATE scheduled_tasks SET next_run = now() - interval '1 second' WHERE id = $1`, [id2]);
  await T.runDue();
  const r2 = (await app.db.q('SELECT * FROM scheduled_tasks WHERE id = $1', [id2])).rows[0];
  assert.ok(r2.enabled && r2.next_run > new Date(Date.now() + 4 * 60_000) && r2.next_run < new Date(Date.now() + 6 * 60_000));
});

test('pause, resume, edit and delete from the dashboard', async () => {
  const [t] = await tasks();
  await adm.apost(`/tasks/${t.id}/toggle`, {});
  let row = (await app.db.q('SELECT enabled, next_run FROM scheduled_tasks WHERE id = $1', [t.id])).rows[0];
  assert.equal(row.enabled, false); assert.equal(row.next_run, null);
  await adm.apost(`/tasks/${t.id}/toggle`, {});
  row = (await app.db.q('SELECT enabled, next_run FROM scheduled_tasks WHERE id = $1', [t.id])).rows[0];
  assert.equal(row.enabled, true); assert.ok(row.next_run);
  // weekly through the form (one checkbox per weekday), headers kept when the field is blank
  const r = await adm.apost(`/tasks/${t.id}`, { name: 'Renamed', enabled: '1', stype: 'weekly', s_at: '07:30', s_day1: '1', s_day4: '1', method: 'GET', url: STUB, timeout: '8' });
  assert.equal(r.status, 303, r.text.slice(0, 200));
  const u = (await app.db.q('SELECT * FROM scheduled_tasks WHERE id = $1', [t.id])).rows[0];
  assert.equal(u.name, 'Renamed'); assert.deepEqual(u.schedule, { type: 'weekly', days: [1, 4], at: '07:30' }); assert.ok(u.headers_enc);
  await adm.apost(`/tasks/${t.id}`, { name: 'Renamed', enabled: '1', stype: 'every', s_minutes: '30', method: 'GET', url: STUB, timeout: '8', clear_headers: '1' });
  assert.equal((await app.db.q('SELECT headers_enc FROM scheduled_tasks WHERE id = $1', [t.id])).rows[0].headers_enc, null);
  assert.equal((await adm.apost(`/tasks/${t.id}/delete`, {})).status, 303);
  assert.equal((await app.db.q('SELECT 1 FROM task_runs WHERE task_id = $1', [t.id])).rowCount, 0, 'history goes with the task');
});

test('the built-in country refresh is created once, follows the source +15 min, and stays deleted', async () => {
  await T.ensureBuiltinTasks(); await T.ensureBuiltinTasks();
  const g = (await tasks()).filter(t => t.kind === 'geoip_refresh');
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].schedule, { type: 'follow', offset: 15 });
  assert.match(g[0].config.v4Url, /iptoasn-country-ipv4\.csv$/);
  assert.ok(g[0].next_run);
  await T.deleteTask(g[0].id); await T.ensureBuiltinTasks();
  assert.equal((await tasks()).filter(t => t.kind === 'geoip_refresh').length, 0);
  // creating it again by hand is possible
  const r = await adm.apost('/tasks/new', { kind: 'geoip_refresh', name: 'Country file', enabled: '1', stype: 'follow', s_offset: '20', v4Url: 'http://127.0.0.1:18097/v4', v6Url: 'http://127.0.0.1:18097/v6' });
  assert.equal(r.status, 303, r.text.slice(0, 200));
  assert.deepEqual((await tasks()).find(t => t.kind === 'geoip_refresh').schedule, { type: 'follow', offset: 20 });
});

test('dashboard task pages need the admin session', async () => {
  const anon = client('10.9.3.1');
  for (const p of ['/tasks', '/tasks/new', '/geoip', '/geoip/raw', '/geoip/file.csv']) assert.equal((await anon.get(ADMIN + p)).status, 404, p);
});
