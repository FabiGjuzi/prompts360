// The dashboard's live visitor map (4 / 10 / 24 hour windows) and the live chart feed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, adminClient, client, ADMIN, BASE } from './_helpers.js';

let app, adm, metrics, lm;
before(async () => { app = await boot(); adm = await adminClient(app); metrics = await import('../src/metrics.js'); lm = await import('../src/admin/livemap.js'); });
after(async () => { await app.close(); });

const H = 3_600_000;
const geoJson = async h => JSON.parse((await adm.get(`${ADMIN}/geo.json${h === undefined ? '' : `?h=${h}`}`)).text);
const by = j => Object.fromEntries(j.countries.map(c => [c.c, c.n]));
const seed = () => {
  const now = Date.now();
  // distinct visitors per country at known ages: 1 h ago (inside every window), 6 h ago (10 h + 24 h), 20 h ago (24 h only)
  for (let i = 0; i < 3; i++) metrics.recordGeo('FR', `fr${i}`, now - 1 * H);
  for (let i = 0; i < 2; i++) metrics.recordGeo('AU', `au${i}`, now - 6 * H);
  metrics.recordGeo('ZA', 'za0', now - 20 * H);
  metrics.recordGeo('FR', 'fr0', now - 20 * H);                 // the same visitor again must not be counted twice
  metrics.recordGeo(undefined, 'nowhere', now - 1 * H);         // no country header
  metrics.recordGeo('xx', 'bad', now - 1 * H);                  // not a country
};

test('changing the window recomputes the visitor density: 4 h < 10 h < 24 h', async () => {
  seed();
  const a = await geoJson(4), b = await geoJson(10), c = await geoJson(24);
  assert.deepEqual([a.hours, b.hours, c.hours], [4, 10, 24]);
  assert.deepEqual(by(a), { FR: 3 });
  assert.deepEqual(by(b), { FR: 3, AU: 2 });
  assert.deepEqual(by(c), { FR: 3, AU: 2, ZA: 1 });
  assert.deepEqual([a.total, b.total, c.total], [3, 5, 6]);
  assert.equal(c.unlocated, 2, 'visitors with a missing or invalid country are counted apart, never drawn');
  for (const j of [a, b, c]) for (const x of j.countries) assert.ok(Number.isFinite(x.x) && Number.isFinite(x.y) && x.name, 'every point has map coordinates and a name');
});

test('the default window is 4 hours and anything else is refused', async () => {
  assert.equal((await geoJson()).hours, 4);
  for (const h of ['7', '0', '-4', 'abc', '24;1', '']) assert.equal((await adm.get(`${ADMIN}/geo.json?h=${h}`)).status, 400, `h=${h}`);
});

test('bubble radius grows with the square root of the visitor count and stays inside the range', () => {
  const { radius, R_MIN, R_MAX } = lm;
  assert.equal(radius(0, 10), 0);
  assert.equal(radius(10, 10), R_MAX);
  assert.ok(radius(1, 100) >= R_MIN && radius(1, 100) < radius(4, 100));
  assert.ok(Math.abs(radius(25, 100) - (R_MIN + (R_MAX - R_MIN) * 0.5)) < 1e-9);
});

test('the dashboard draws the map card in the overview with the 4/10/24 dropdown and server-drawn bubbles', async () => {
  const t = (await adm.get(ADMIN)).text;
  assert.match(t, /<aside class="card mapcard" data-map /);
  assert.match(t, /<select id="mapwin" data-map-window>[\s\S]*?<option value="4" selected>Last 4 hours<\/option><option value="10">Last 10 hours<\/option><option value="24">Last 24 hours<\/option>/);
  assert.match(t, /<circle class="bub[^"]*" data-c="FR" data-n="3"/);
  assert.match(t, /\/s\/admin-map\.[\w-]+\.js/); assert.match(t, /\/s\/admin-charts\.[\w-]+\.js/); assert.match(t, /\/s\/admin-anim\.[\w-]+\.js/);
  assert.doesNotMatch(t, /https?:\/\/[^"' ]*(tile|mapbox|googleapis|openstreetmap)/i, 'no external map provider');
});

test('the country comes only from the edge header, and only a two-letter code is stored', async () => {
  const c = client('10.9.1.1');
  const ua = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130 Safari/537.36' };
  const before = by(await geoJson(4));
  await c.get('/', { headers: { ...ua, 'cf-ipcountry': 'nz' } });
  await client('10.9.1.2').get('/', { headers: { ...ua, 'cf-ipcountry': '<script>' } });
  const after = by(await geoJson(4));
  assert.equal(after.NZ, 1, 'lower-case header is normalised');
  assert.equal(Object.keys(after).length, Object.keys(before).length + 1, 'junk header values never become a country');
  const raw = JSON.stringify(await geoJson(24));
  assert.doesNotMatch(raw, /10\.9\.1\./, 'no IP address leaves the visitor store');
});

test('/charts.json gives every live chart its feed, labelled in New York time', async () => {
  const r = await adm.get(`${ADMIN}/charts.json`);
  assert.equal(r.status, 200);
  const j = JSON.parse(r.text);
  assert.ok(Math.abs(j.now - Date.now()) < 5000);
  for (const k of ['labels', 'requests', 'pages', 'avg', 'p95', 'rss_mb', 'lag_ms', 'cpu_pct', 'db_ms']) assert.equal(j.mins[k].length, j.mins.labels.length, `mins.${k}`);
  assert.ok(j.hrs.labels.length <= 24 && j.hrs.labels.every(l => /^\d\dh$/.test(l)), 'hour buckets are New York hours');
  assert.equal(j.hrs.pages.length, j.hrs.labels.length);
  assert.equal(j.days.labels.length, 30);
  assert.match(j.mins.labels.at(-1), /^\d\d:\d\d$/);
});

test('every chart on the dashboard carries its data for the interactive layer', async () => {
  const t = (await adm.get(ADMIN)).text;
  const figs = [...t.matchAll(/<figure[^>]*data-chart="([^"]+)"/g)];
  assert.ok(figs.length >= 6, `found ${figs.length} interactive charts`);
  for (const [, enc] of figs) {
    const d = JSON.parse(enc.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'"));
    assert.ok(['line', 'bar'].includes(d.type));
    assert.ok(d.series.length >= 1 && d.series.every(s => s.values.length === d.labels.length));
  }
});

test('charts and map data need the admin session', async () => {
  const anon = client('10.9.2.1');
  for (const p of ['/charts.json', '/geo.json?h=4']) assert.ok([401, 403, 404].includes((await anon.get(ADMIN + p)).status));
  assert.equal((await anon.get('/geo.json?h=4')).status, 404);
});

