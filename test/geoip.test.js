// The visitor country file: lookup, dashboard editing (table + raw editor), refresh from a source, bundled file.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { boot, adminClient, ADMIN } from './_helpers.js';
import { setHttpPolicy } from '../src/httpcall.js';
import { isPublicIp, parseIp } from '../src/netutil.js';

let app, adm, G;
before(async () => { app = await boot(); adm = await adminClient(app); G = await import('../src/geoip.js'); setHttpPolicy({ allowPrivate: true, allowHttp: true }); await G.loadBundled(); });
after(async () => { setHttpPolicy({ allowPrivate: false, allowHttp: false }); await app.close(); });
const sources = async () => Object.fromEntries((await app.db.q(`SELECT source, count(*)::int AS n FROM geoip_ranges GROUP BY source`)).rows.map(r => [r.source, r.n]));

test('the bundled file loads (IPv4 + IPv6) and answers lookups', async () => {
  const s = await G.geoipStatus();
  assert.ok(s.v4 > 200_000 && s.v6 > 50_000, `${s.v4} / ${s.v6}`);
  assert.equal(G.lookupCountry('8.8.8.8'), 'US');
  assert.equal(G.lookupCountry('2001:4860:4860::8888'), 'US');
  assert.equal(G.lookupCountry('::ffff:8.8.8.8'), 'US', 'an IPv4 address written as IPv6 is looked up as IPv4');
  for (const ip of ['10.1.2.3', '127.0.0.1', '192.168.0.9', '::1', 'not-an-ip', '']) assert.equal(G.lookupCountry(ip), '', ip);
  const t = process.hrtime.bigint();
  for (let i = 0; i < 50_000; i++) G.lookupCountry(`8.8.${i % 250}.${i % 200}`);
  assert.ok(Number(process.hrtime.bigint() - t) / 1e6 < 500, 'a lookup is microseconds, not a database call');
});

test('address helpers', () => {
  assert.ok(isPublicIp('8.8.8.8') && isPublicIp('2001:4860:4860::8888'));
  for (const p of ['10.1.2.3', '127.0.0.1', '192.168.1.1', '172.20.0.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', 'ff02::1', 'nope', '']) assert.equal(isPublicIp(p), false, p);
  assert.deepEqual(parseIp('1.2.3.4'), { fam: 4, n: 16909060n });
  assert.deepEqual(parseIp('::ffff:1.2.3.4'), { fam: 4, n: 16909060n });
  assert.equal(parseIp('2001:db8::1').fam, 6);
  assert.equal(parseIp('1.2.3'), null);
});

test('a range made in the table editor applies at once; manual wins over the file, the smaller manual range wins', async () => {
  assert.notEqual(G.lookupCountry('8.8.8.8'), 'FR');
  let r = await adm.apost('/t/geoip_ranges/new', { ip_from: '8.8.8.0', ip_to: '8.8.8.255', country: 'fr' });
  assert.equal(r.status, 303);
  assert.equal(G.lookupCountry('8.8.8.8'), 'FR');
  assert.equal(G.lookupCountry('8.8.9.8'), 'US', 'next range untouched');
  await adm.apost('/t/geoip_ranges/new', { ip_from: '8.8.8.8', ip_to: '8.8.8.8', country: 'JP' });
  assert.equal(G.lookupCountry('8.8.8.8'), 'JP');
  assert.equal(G.lookupCountry('8.8.8.7'), 'FR');
  const row = (await app.db.q(`SELECT id, source, country FROM geoip_ranges WHERE host(ip_from) = '8.8.8.0' AND source = 'manual'`)).rows[0];
  assert.equal(row.country.trim(), 'FR');
  r = await adm.apost(`/t/geoip_ranges/${row.id}`, { ip_from: '8.8.8.0', ip_to: '8.8.8.255', country: 'DE' });
  assert.equal(r.status, 303);
  assert.equal(G.lookupCountry('8.8.8.7'), 'DE');
  await adm.apost(`/t/geoip_ranges/${row.id}/delete`, {});
  assert.equal(G.lookupCountry('8.8.8.7'), 'US', 'deleting the manual range uncovers the file again');
  await app.db.q(`DELETE FROM geoip_ranges WHERE source = 'manual'`); await G.reloadIndex();
});

test('the table editor refuses bad ranges and lists, searches and edits feed rows as manual', async () => {
  for (const f of [{ ip_from: '8.8.8.9', ip_to: '8.8.8.1', country: 'US' }, { ip_from: '1.2.3.4', ip_to: '2001:db8::1', country: 'US' }, { ip_from: 'abc', ip_to: '1.2.3.4', country: 'US' }, { ip_from: '1.2.3.4', ip_to: '1.2.3.9', country: 'USA' }]) {
    assert.equal((await adm.apost('/t/geoip_ranges/new', f)).status, 400, JSON.stringify(f));
  }
  const list = (await adm.get(`${ADMIN}/t/geoip_ranges?q=1.0.0.0`)).text;
  assert.match(list, /<td class="">1\.0\.0\.0<\/td>/);
  const feed = (await app.db.q(`SELECT id FROM geoip_ranges WHERE source = 'feed' AND host(ip_from) = '1.0.0.0'`)).rows[0];
  assert.ok(feed);
  assert.equal((await adm.apost(`/t/geoip_ranges/${feed.id}`, { ip_from: '1.0.0.0', ip_to: '1.0.0.255', country: 'CA' })).status, 303);
  assert.equal((await sources()).manual, 1, 'saving a feed row makes it manual');
  assert.equal(G.lookupCountry('1.0.0.9'), 'CA');
  await app.db.q(`DELETE FROM geoip_ranges WHERE source = 'manual'`); await G.loadBundled();
});

test('the raw file editor edits a window: unchanged lines stay, removed lines go, new lines become manual', async () => {
  const before = await sources();
  const page = (await adm.get(`${ADMIN}/geoip/raw?f=8.8.8.0`)).text;
  const ids = page.match(/name="ids" value="([^"]*)"/)[1];
  const text = page.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/)[1].replace(/&amp;/g, '&');
  const lines = text.split('\n').filter(Boolean);
  assert.ok(lines.length > 100 && lines[0].split(',').length === 3);
  const edited = [...lines.slice(1), '203.0.113.0,203.0.113.255,NL'].join('\n');   // first line removed, one added
  const r = await adm.apost('/geoip/raw', { f: '8.8.8.0', ids, text: edited });
  assert.equal(r.status, 303);
  const after = await sources();
  assert.equal(after.manual, 1);
  assert.equal(after.feed, before.feed - 1);
  assert.equal(G.lookupCountry('203.0.113.9'), 'NL');
  // bad lines are rejected and nothing changes
  const bad = await adm.apost('/geoip/raw', { f: '8.8.8.0', ids, text: 'oops\n1.1.1.1,1.1.1.0,US' });
  assert.equal(bad.status, 400);
  assert.match(bad.text, /expected from,to,CC/);
  assert.deepEqual(await sources(), after);
  // by address and by country
  assert.match((await adm.get(`${ADMIN}/geoip/raw?f=203.0.113.0`)).text, /203\.0\.113\.0,203\.0\.113\.255,NL/);
  assert.match((await adm.get(`${ADMIN}/geoip/raw?f=nl`)).text, /,NL/);
  await app.db.q(`DELETE FROM geoip_ranges WHERE source = 'manual'`); await G.loadBundled();
});

test('the Visitor locations page shows status, tests an address, and the file downloads', async () => {
  const t = (await adm.get(`${ADMIN}/geoip?ip=8.8.8.8`)).text;
  assert.match(t, /IPv4 ranges/); assert.match(t, /<b>8\.8\.8\.8<\/b> is in <b>United States<\/b>/);
  assert.match((await adm.get(`${ADMIN}/geoip?ip=nope`)).text, /not an IP address/);
  const f = await adm.get(`${ADMIN}/geoip/file.csv`);
  assert.equal(f.status, 200); assert.match(f.headers.get('content-type'), /text\/csv/);
  assert.ok(f.text.split('\n').length > 290_000);
  assert.match(f.text, /^1\.0\.0\.0,1\.0\.0\.255,US$/m);
});

// ---- refresh from a source ----
const v4 = i => { const n = 16_777_216 + i * 256, h = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); return `${h(n)},${h(n + 255)},${i % 2 ? 'DE' : 'FR'}`; };
const v6 = i => `2001:${(0x1000 + i).toString(16)}::,2001:${(0x1000 + i).toString(16)}:ffff:ffff:ffff:ffff:ffff:ffff,${i % 2 ? 'JP' : 'BR'}`;
const fileOf = (n, f) => `${Array.from({ length: n }, (_, i) => f(i)).join('\n')}\n`;

test('refresh downloads only when the source was republished, keeps manual ranges, and refuses a damaged file', async () => {
  let modified = 'Sat, 07 Nov 2026 01:44:30 GMT', gets = 0, heads = 0, big = true;
  const stub = http.createServer((req, res) => {
    if (req.method === 'HEAD') heads++; else gets++;
    res.setHeader('last-modified', modified); res.setHeader('content-type', 'text/csv');
    if (req.method === 'HEAD') return res.end();
    res.end(req.url === '/v4.csv' ? (big ? fileOf(120_000, v4) : 'garbage\n') : fileOf(12_000, v6));
  });
  await new Promise(r => stub.listen(18098, '127.0.0.1', r));
  const cfg = { v4Url: 'http://127.0.0.1:18098/v4.csv', v6Url: 'http://127.0.0.1:18098/v6.csv' };
  try {
    await app.db.q(`INSERT INTO geoip_ranges (ip_from, ip_to, country, source) VALUES ('99.0.0.0', '99.0.0.255', 'IT', 'manual')`);
    await app.db.q(`UPDATE geoip_meta SET source_modified = '2026-11-06T00:00:00Z'`);
    let r = await G.refreshFromSource(cfg);
    assert.equal(r.changed, true, r.message);
    assert.equal(gets, 2);
    assert.equal(G.lookupCountry('1.0.0.7'), 'FR'); assert.equal(G.lookupCountry('1.0.1.7'), 'DE'); assert.equal(G.lookupCountry('2001:1000::1'), 'BR');
    assert.equal(G.lookupCountry('8.8.8.8'), '', 'the old file is replaced, not merged');
    assert.equal(G.lookupCountry('99.0.0.5'), 'IT', 'manual range survived');
    const st = await G.geoipStatus();
    assert.equal(new Date(st.source_modified).toISOString(), '2026-11-07T01:44:30.000Z');
    r = await G.refreshFromSource(cfg);
    assert.equal(r.changed, false); assert.match(r.message, /not republished yet/); assert.equal(gets, 2, 'no download when the source file is not newer');
    modified = 'Sun, 08 Nov 2026 01:41:10 GMT'; big = false;
    r = await G.refreshFromSource(cfg);
    assert.equal(r.ok, false); assert.match(r.message, /damaged/);
    assert.equal(G.lookupCountry('1.0.0.7'), 'FR', 'a damaged download changes nothing');
    big = true;
    r = await G.refreshFromSource(cfg);
    assert.equal(r.changed, true);
    r = await G.refreshFromSource({ ...cfg, force: true });
    assert.equal(r.changed, true, 'force downloads even when not newer');
  } finally { await new Promise(r => stub.close(r)); }
  await G.loadBundled(); await app.db.q(`DELETE FROM geoip_ranges WHERE source = 'manual'`); await G.reloadIndex();
});

test('reset restores the bundled file and leaves manual ranges', async () => {
  await app.db.q(`INSERT INTO geoip_ranges (ip_from, ip_to, country, source) VALUES ('99.1.0.0', '99.1.0.255', 'IT', 'manual')`);
  await app.db.q(`DELETE FROM geoip_ranges WHERE source = 'feed' AND family(ip_from) = 6`); await G.reloadIndex();
  assert.equal(G.lookupCountry('2001:4860:4860::8888'), '');
  const r = await adm.apost('/geoip/reset', {});
  assert.equal(r.status, 303);
  assert.equal(G.lookupCountry('2001:4860:4860::8888'), 'US');
  assert.equal(G.lookupCountry('99.1.0.5'), 'IT');
  await app.db.q(`DELETE FROM geoip_ranges WHERE source = 'manual'`); await G.reloadIndex();
});

test('page views use the local file when the edge sends no country (the map fills in)', async () => {
  const { client } = await import('./_helpers.js');
  const M = await import('../src/metrics.js');
  const ua = { 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130 Safari/537.36' };
  const before = M.geoSnapshot(4).countries.find(c => c.c === 'US')?.n || 0;
  await client('8.8.4.4').get('/', { headers: ua });
  await client('2001:4860:4860::8844').get('/', { headers: ua });
  await client('10.5.5.5').get('/', { headers: ua });
  const snap = M.geoSnapshot(4);
  assert.equal((snap.countries.find(c => c.c === 'US')?.n || 0) - before, 2);
});
