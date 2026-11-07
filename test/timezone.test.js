// Every time the dashboard shows, and every hour/day bucket it draws, is New York time (EST/EDT) — the database stays UTC.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, adminClient, ADMIN } from './_helpers.js';
import { nyStamp, nyDay, nyInput, nyToDate, nyClock } from '../src/tz.js';

let app, adm;
before(async () => { app = await boot(); adm = await adminClient(app); });
after(async () => { await app.close(); });
const U = (...a) => Date.UTC(...a);

test('summer instants read as EDT and winter instants as EST', () => {
  assert.equal(nyStamp(U(2026, 6, 4, 16, 30)), '2026-07-04 12:30:00 EDT');
  assert.equal(nyStamp(U(2026, 0, 15, 16, 30)), '2026-01-15 11:30:00 EST');
  assert.equal(nyClock(U(2026, 6, 4, 4, 5, 9)), '00:05:09');
});

test('daylight-saving switches happen on the real instants (2026-03-08 07:00Z and 2026-11-01 06:00Z)', () => {
  assert.equal(nyStamp(U(2026, 2, 8, 6, 59, 59)), '2026-03-08 01:59:59 EST');
  assert.equal(nyStamp(U(2026, 2, 8, 7, 0, 0)), '2026-03-08 03:00:00 EDT');
  assert.equal(nyStamp(U(2026, 10, 1, 5, 59, 59)), '2026-11-01 01:59:59 EDT');
  assert.equal(nyStamp(U(2026, 10, 1, 6, 0, 0)), '2026-11-01 01:00:00 EST');
});

test('a metrics day starts and ends at New York midnight, not UTC midnight', () => {
  assert.equal(nyDay(U(2026, 10, 8, 4, 59, 59)), '2026-11-07');   // 23:59:59 EST on the 7th
  assert.equal(nyDay(U(2026, 10, 8, 5, 0, 0)), '2026-11-08');     // 00:00:00 EST on the 8th
  assert.equal(nyDay(U(2026, 6, 4, 3, 59, 59)), '2026-07-03');    // 23:59:59 EDT on the 3rd
  assert.equal(nyDay(U(2026, 6, 4, 4, 0, 0)), '2026-07-04');
});

test('form values are New York wall time and convert back to the exact UTC instant', () => {
  assert.equal(nyInput(U(2026, 6, 4, 16, 30)), '2026-07-04T12:30');
  assert.equal(nyToDate('2026-07-04T12:30').toISOString(), '2026-07-04T16:30:00.000Z');
  assert.equal(nyToDate('2026-01-15T11:30').toISOString(), '2026-01-15T16:30:00.000Z');
  assert.equal(nyToDate('2026-03-08T02:30').toISOString(), '2026-03-08T07:30:00.000Z', 'a time that does not exist (spring gap) lands an hour later');
  assert.equal(nyToDate('2026-11-01T01:30').toISOString(), '2026-11-01T05:30:00.000Z', 'a repeated time resolves to its first occurrence');
  assert.ok(Number.isNaN(nyToDate('not a date').getTime()));
});

test('the log table shows New York time with its zone for rows written in UTC', async () => {
  await app.db.q(`INSERT INTO event_log (ts, level, kind, message) VALUES
    ('2026-07-04 16:30:00+00', 'info', 'tztest', 'summer row'), ('2026-01-15 16:30:00+00', 'info', 'tztest', 'winter row'),
    ('2026-03-08 06:59:59+00', 'info', 'tztest', 'before spring forward'), ('2026-03-08 07:00:00+00', 'info', 'tztest', 'after spring forward')`);
  const t = (await adm.get(`${ADMIN}/logs?kind=tztest`)).text;
  assert.match(t, /2026-07-04 12:30:00 EDT<\/td>[\s\S]*?summer row/);
  assert.match(t, /2026-01-15 11:30:00 EST<\/td>[\s\S]*?winter row/);
  assert.match(t, /2026-03-08 01:59:59 EST<\/td>[\s\S]*?before spring forward/);
  assert.match(t, /2026-03-08 03:00:00 EDT<\/td>[\s\S]*?after spring forward/);
  assert.doesNotMatch(t, /UTC<\/td>/);
});

test('minute and hour chart labels are New York clock time', async () => {
  const S = await import('../src/admin/stats.js');
  const at = Date.now() - 5 * 60_000;
  await app.db.q(`INSERT INTO metrics_minute (ts, requests) VALUES (date_trunc('minute', to_timestamp($1 / 1000.0)), 7) ON CONFLICT (ts) DO UPDATE SET requests = 7`, [at]);
  const mins = await S.minutes(60);
  const p = new Date(Math.floor(at / 60_000) * 60_000), hh = nyClock(p).slice(0, 5);
  assert.ok(mins.some(r => r.label === hh && r.requests === 7), `label ${hh} present in ${mins.map(r => r.label).join(',')}`);
  const hrs = await S.hours24();
  const hh2 = `${nyClock(p).slice(0, 2)}h`;
  assert.ok(hrs.some(r => r.label === hh2), `hour label ${hh2}`);
  const days = await S.days30();
  assert.equal(days.length, 30);
  assert.equal(days.at(-1).label, nyDay(Date.now()).slice(5), 'the last day on the 30-day charts is today in New York');
});

test('the metrics writer files today under the New York date', async () => {
  const metrics = await import('../src/metrics.js');
  await metrics.tick(true);
  const { rows } = await app.db.q('SELECT day::text FROM metrics_day ORDER BY day DESC LIMIT 1');
  assert.equal(rows[0]?.day, nyDay(Date.now()));
});

test('date fields in the editors are New York time and the labels say so', async () => {
  const t = (await adm.get(`${ADMIN}/t/posts/new`)).text;
  assert.match(t, /Created \(New York time;/);
  assert.doesNotMatch(t, /\(UTC/);
});
