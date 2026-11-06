// Dashboard -> Connections (GA4, AdSense, Search Console), consent loader wiring, CSP, /ads.txt.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client, adminClient, ADMIN } from './_helpers.js';

let app, adm, anon;
const setting = async k => (await app.db.q('SELECT value FROM site_settings WHERE key = $1', [k])).rows[0]?.value;
const csp = r => r.headers.get('content-security-policy');
const GA = 'G-TEST123456', PUB = 'pub-1234567890123456', GSC = 'abcDEF123_-xyz0987654321';

before(async () => { app = await boot(); adm = await adminClient(app); anon = client(); });
after(async () => { await app.close(); });

test('everything is off by default: no Google markup, no script, strict CSP, /ads.txt is 404', async () => {
  const home = await anon.get('/');
  assert.equal(home.status, 200);
  assert.doesNotMatch(home.text, /p360-ga|p360-ads|consent\.|google-site-verification|google-adsense-account|googletagmanager|googlesyndication/);
  const c = csp(home);
  assert.doesNotMatch(c, /google|doubleclick/); assert.match(c, /script-src 'self'; /); assert.match(c, /require-trusted-types-for 'script'/);
  assert.equal((await anon.get('/ads.txt')).status, 404);
});

test('Connections page: hidden from visitors, listed in the menu, shows the status', async () => {
  assert.equal((await anon.get(`${ADMIN}/connections`)).status, 404);
  assert.equal((await anon.post(`${ADMIN}/connections`, { 'c.ga4': GA })).status, 404);
  const page = await adm.get(`${ADMIN}/connections`);
  assert.equal(page.status, 200); assert.match(page.text, /<h2>Connections<\/h2>/); assert.match(page.text, /Analytics &amp; ads/);
  for (const n of ['ga4', 'adsense', 'gsc']) assert.match(page.text, new RegExp(`name="c\\.${n}"`));
  assert.match(page.text, /Analytics: <b>off<\/b>/); assert.match(page.text, /AdSense: <b>off<\/b>/);
  assert.equal((await adm.post(`${ADMIN}/connections`, { 'c.ga4': GA })).status, 403, 'CSRF is required');
});

test('invalid IDs are rejected as a whole and nothing is saved', async () => {
  const bad = [{ 'c.ga4': 'UA-12345-1' }, { 'c.ga4': 'g-' }, { 'c.ga4': GA + '"><script>' }, { 'c.adsense': 'pub-123' }, { 'c.adsense': 'ca-pub-12345678901234567' }, { 'c.adsense': 'pub-12345678901234ab' }, { 'c.gsc': 'short' }, { 'c.gsc': 'has space and "quote"' }];
  for (const b of bad) {
    const r = await adm.apost('/connections', { 'c.ga4': GA, 'c.adsense': '', 'c.gsc': '', ...b });
    assert.equal(r.status, 400, JSON.stringify(b)); assert.match(r.text, /class="error"/);
  }
  for (const k of ['conn.ga4_id', 'conn.adsense_pub', 'conn.gsc_token']) assert.equal(await setting(k), undefined, `${k} not saved after a rejected form`);
});

test('valid IDs are normalised, saved and take effect immediately', async () => {
  const r = await adm.apost('/connections', { 'c.ga4': ` ${GA.toLowerCase()} `, 'c.adsense': `CA-${PUB}`, 'c.gsc': `<meta name="google-site-verification" content="${GSC}" />` });
  assert.equal(r.status, 303); assert.match(r.location, /connections\?n=saved$/);
  assert.equal(await setting('conn.ga4_id'), GA); assert.equal(await setting('conn.adsense_pub'), PUB); assert.equal(await setting('conn.gsc_token'), GSC);
  assert.match((await adm.get(`${ADMIN}/connections?n=saved`)).text, /Saved\. The site uses the new settings immediately/);
  assert.match((await adm.get(`${ADMIN}/connections`)).text, new RegExp(`value="${GA}"`));
  assert.match((await adm.get(`${ADMIN}/connections`)).text, /Analytics: <b>on \(G-TEST123456\)/);
});

test('public pages: tag + loader only on indexable pages, Search Console tag everywhere, CSP widened exactly as documented', async () => {
  const home = await anon.get('/');
  assert.match(home.text, new RegExp(`<meta name="p360-ga" content="${GA}">`)); assert.match(home.text, new RegExp(`<meta name="p360-ads" content="${PUB}">`));
  assert.match(home.text, /<script src="\/s\/consent\.[^"]+\.js" defer><\/script>/);
  assert.match(home.text, new RegExp(`<meta name="google-site-verification" content="${GSC}">`)); assert.match(home.text, new RegExp(`<meta name="google-adsense-account" content="ca-${PUB}">`));
  assert.equal([...home.text.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*ld\+json)[^>]*>/g)].length, 0, 'no inline scripts');
  assert.doesNotMatch(home.text, /<script src="https?:/, 'Google scripts are never in the HTML: the loader adds them after consent');
  const c = csp(home);
  assert.match(c, /script-src 'self' https:\/\/\*\.googletagmanager\.com https:\/\/pagead2\.googlesyndication\.com;/);
  assert.match(c, /connect-src 'self' https:\/\/\*\.google-analytics\.com https:\/\/\*\.analytics\.google\.com https:\/\/\*\.googletagmanager\.com;/);
  assert.match(c, /img-src 'self' https:\/\/\*\.google-analytics\.com https:\/\/\*\.googletagmanager\.com;/);
  assert.match(c, /require-trusted-types-for 'script'/, 'Trusted Types stays enforced');
  assert.doesNotMatch(c, /unsafe-inline|unsafe-eval|\*;|default-src \*/);
  // pages that must never track
  for (const p of ['/login', '/signup', '/forgot', '/search?q=x', '/u/prompts360']) {
    const r = await anon.get(p);
    assert.doesNotMatch(r.text, /p360-ga|p360-ads|consent\.[A-Za-z0-9_-]+\.js|google-adsense-account/, `${p} has no tracker`);
    assert.match(r.text, new RegExp(`google-site-verification`), `${p}: verification tag still present`);
  }
  const tok = await anon.get('/reset/abcdef'); assert.doesNotMatch(tok.text, /p360-ga|consent\.[A-Za-z0-9_-]+\.js/); 
  assert.doesNotMatch((await adm.get(ADMIN)).text, /p360-ga|googletagmanager|consent\.[A-Za-z0-9_-]+\.js/, 'the dashboard never loads trackers');
  assert.doesNotMatch(csp(await adm.get(ADMIN)), /google/, 'dashboard CSP is not widened');
});

test('/ads.txt is published in the documented format; the consent script is served', async () => {
  const r = await anon.get('/ads.txt');
  assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /^text\/plain/);
  assert.equal(r.text, `google.com, ${PUB}, DIRECT, f08c47fec0942fa0\n`);
  const home = await anon.get('/');
  const src = home.text.match(/src="(\/s\/consent\.[^"]+\.js)"/)[1];
  const js = await anon.get(src); assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/); assert.match(js.text, /p360-google/);
});

test('turning one connection off removes only its pieces; clearing all restores the strict setup', async () => {
  await adm.apost('/connections', { 'c.ga4': '', 'c.adsense': PUB, 'c.gsc': '' });
  let home = await anon.get('/');
  assert.doesNotMatch(home.text, /p360-ga|googletagmanager|google-site-verification/); assert.match(home.text, /p360-ads/);
  assert.doesNotMatch(csp(home), /googletagmanager|google-analytics/); assert.match(csp(home), /pagead2\.googlesyndication\.com/);
  await adm.apost('/connections', { 'c.ga4': GA, 'c.adsense': '', 'c.gsc': '' });
  home = await anon.get('/');
  assert.match(home.text, /p360-ga/); assert.doesNotMatch(home.text, /p360-ads|google-adsense-account/);
  assert.equal((await anon.get('/ads.txt')).status, 404, 'no ads.txt without a publisher ID');
  assert.doesNotMatch(csp(home), /googlesyndication/);
  await adm.apost('/connections', { 'c.ga4': '', 'c.adsense': '', 'c.gsc': '' });
  home = await anon.get('/');
  assert.doesNotMatch(home.text, /p360-|consent\.[A-Za-z0-9_-]+\.js|google-/); assert.doesNotMatch(csp(home), /google/);
  for (const k of ['conn.ga4_id', 'conn.adsense_pub', 'conn.gsc_token']) assert.equal(await setting(k), undefined);
});

test('a stored value that is not valid is ignored when reading (defence in depth)', async () => {
  await app.db.q("INSERT INTO site_settings (key, value) VALUES ('conn.ga4_id', 'G-X\"><script>alert(1)</script>') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value");
  await adm.apost('/texts', {});   // any dashboard save refreshes the snapshot
  const home = await anon.get('/');
  assert.doesNotMatch(home.text, /alert\(1\)|p360-ga/); assert.doesNotMatch(csp(home), /googletagmanager/);
  await app.db.q("DELETE FROM site_settings WHERE key = 'conn.ga4_id'"); await adm.apost('/texts', {});
});
