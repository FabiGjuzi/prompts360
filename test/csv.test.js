// CSV export / import and the CSV + ZIP helpers.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { boot, client, adminClient, ADMIN } from './_helpers.js';
import { parse, parseObjects, stringify, unprotect } from '../src/csv.js';
import { zip } from '../src/zip.js';

let app, adm;
before(async () => { app = await boot(); adm = await adminClient(app); });
after(async () => { await app.close(); });

test('csv: quotes, commas, newlines, BOM, CRLF and other delimiters', () => {
  assert.deepEqual(parse('a,b\r\n1,"x, ""y""\nz"\r\n'), [['a', 'b'], ['1', 'x, "y"\nz']]);
  assert.deepEqual(parse('﻿a;b\n1;2\n'), [['a', 'b'], ['1', '2']], 'semicolon files (European Excel)');
  assert.deepEqual(parse('a\tb\n1\t2'), [['a', 'b'], ['1', '2']]);
  assert.deepEqual(parse('a,b\n\n1,\n'), [['a', 'b'], ['1', '']], 'blank lines skipped, empty cells kept');
  assert.throws(() => parse('a,b\n1,"open'), /never closed/);
  assert.throws(() => parse('a,b\n1,x"y"'), /quote in the middle/);
  assert.throws(() => parse('a\n' + '1\n'.repeat(11), { maxRows: 5 }), /Too many rows/);
  const { headers, records } = parseObjects('Community, Title ,BODY\nA,B,C\n,,\n');
  assert.deepEqual(headers, ['community', 'title', 'body']); assert.equal(records.length, 1); assert.equal(records[0].title, 'B');
});

test('csv: round trip and spreadsheet formula protection', () => {
  const rows = [['=1+1', '-5', 'plain', 'with "quote", comma', 'two\nlines', '@SUM(A1)', '+1 555', '- bullet', '', null, 7]];
  const text = stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'], rows);
  assert.ok(text.startsWith('﻿')); assert.match(text, /\r\n$/);
  const back = parse(text)[1];
  assert.equal(back[0], "'=1+1"); assert.equal(back[5], "'@SUM(A1)"); assert.equal(back[7], "'- bullet"); assert.equal(back[1], '-5', 'plain numbers are not touched');
  assert.deepEqual(back.map(unprotect), ['=1+1', '-5', 'plain', 'with "quote", comma', 'two\nlines', '@SUM(A1)', '+1 555', '- bullet', '', '', '7']);
  assert.equal(unprotect("'hello"), "'hello", 'only the protective prefix is removed');
});

test('zip: a standard unzip tool accepts the archive', () => {
  const buf = zip([{ name: 'a.csv', data: 'x,y\r\n1,2\r\n' }, { name: 'b.csv', data: 'é'.repeat(5000) }]);
  fs.writeFileSync('/tmp/_t.zip', buf);
  const r = spawnSync('python3', ['-I', '-c', "import zipfile;z=zipfile.ZipFile('/tmp/_t.zip');print(z.testzip(),z.namelist(),z.read('a.csv'))"], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /None \['a.csv', 'b.csv'\] b'x,y\\r\\n1,2\\r\\n'/);
  assert.throws(() => zip([{ name: '../evil', data: 'x' }]), /bad zip entry name/);
});

test('import: CSV of communities then posts, per-post model, duplicates, problems', async () => {
  const imp = (data, mode = 'import') => adm.apost('/import', { data, mode });
  let r = await imp('name,title,description,model\r\nCsv_One,CSV one,"About, with comma",claude\r\nCsv_Two,CSV two,x,general\r\nbad name,x,x,claude\r\nCsv_Three,x,x,nonesuch\r\n');
  assert.equal(r.status, 200); assert.match(r.text, /New communities/); assert.match(r.text, /invalid name/); assert.match(r.text, /unknown model/);
  const posts = 'community,title,body,model,url\nCsv_One,First,"Line 1\nLine 2",gemini,\nCsv_One,Second,body,,https://example.com/x\nCsv_Two,Third,\'=cmd(),local,\nCsv_Two,First,dup in other community,qwen,\nCsv_One,First,dup same,qwen,\nNope_Missing,Orphan,x,claude,\nCsv_One,Bad model,x,zzz,\nCsv_One,Bad url,x,claude,javascript:alert(1)\n';
  r = await imp(posts, 'preview');
  assert.match(r.text, /Preview/); assert.equal((await app.db.q("SELECT count(*)::int n FROM posts WHERE title = 'Third'")).rows[0].n, 0, 'preview writes nothing');
  r = await imp(posts);
  assert.match(r.text, /unknown model/); assert.match(r.text, /does not exist/); assert.match(r.text, /must start with http/);
  const { rows } = await app.db.q(`SELECT p.title, p.body, p.url, t.slug AS model, c.name AS community, pt.slug AS ctag FROM posts p JOIN communities c ON c.id = p.community_id JOIN ai_tags t ON t.id = p.ai_tag_id JOIN ai_tags pt ON pt.id = c.ai_tag_id WHERE c.name LIKE 'Csv\\_%' ORDER BY p.id`);
  assert.deepEqual(rows.map(x => [x.community, x.title, x.model]), [['Csv_One', 'First', 'gemini'], ['Csv_One', 'Second', 'claude'], ['Csv_Two', 'Third', 'local'], ['Csv_Two', 'First', 'qwen']]);
  assert.equal(rows[0].body, 'Line 1\nLine 2'); assert.equal(rows[1].url, 'https://example.com/x'); assert.equal(rows[2].body, '=cmd()', 'protective apostrophe removed');
  assert.equal(rows[1].ctag, 'claude', 'post without a model inherits the community model');
  // importing the same file again adds nothing
  r = await imp(posts); assert.equal((await app.db.q("SELECT count(*)::int n FROM posts p JOIN communities c ON c.id = p.community_id WHERE c.name LIKE 'Csv\\_%'")).rows[0].n, 4);
  // garbage and unknown shapes
  assert.match((await imp('foo,bar\n1,2\n')).text, /Could not tell what this CSV is/);
  assert.match((await imp('community,title\n"x')).text, /not valid CSV/);
  assert.match((await imp('')).text, /Nothing to import/);
  assert.match((await imp('{"posts": [')).text, /not valid JSON/);
  // JSON still works, including a per-post model
  r = await imp(JSON.stringify({ posts: [{ community: 'Csv_One', title: 'From JSON', body: 'b', model: 'mistral' }] }));
  assert.equal((await app.db.q("SELECT t.slug FROM posts p JOIN ai_tags t ON t.id = p.ai_tag_id WHERE p.title = 'From JSON'")).rows[0].slug, 'mistral');
});

test('the 250-post starter list imports cleanly: 20 communities, every model used', async () => {
  const json = fs.readFileSync(new URL('../seed/extra/prompts360-250-posts.json', import.meta.url), 'utf8');
  const d = JSON.parse(json); assert.equal(d.posts.length, 250); assert.equal(d.communities.length, 20);
  const { runImport } = await import('../src/admin/pages.js');
  let r = await runImport(json, { dry: true });
  assert.deepEqual(r.problems, []); assert.equal(r.postsNew, 250); assert.equal(r.communitiesNew, 20); assert.equal(r.postsDuplicate, 0);
  // the CSV versions give the same result
  const rc = await runImport(fs.readFileSync(new URL('../seed/extra/communities.csv', import.meta.url), 'utf8'), { dry: true });
  assert.deepEqual(rc.problems, []); assert.equal(rc.communitiesNew, 20);
  await runImport(json, { dry: false });
  const rp = await runImport(fs.readFileSync(new URL('../seed/extra/posts.csv', import.meta.url), 'utf8'), { dry: true });
  assert.deepEqual(rp.problems, []); assert.equal(rp.postsNew, 0); assert.equal(rp.postsDuplicate, 250, 'same posts via CSV are recognised as already there');
  const { rows } = await app.db.q(`SELECT t.slug, count(*)::int n FROM posts p JOIN ai_tags t ON t.id = p.ai_tag_id JOIN communities c ON c.id = p.community_id WHERE c.name IN (${d.communities.map((_, i) => `$${i + 1}`).join(',')}) GROUP BY 1`, d.communities.map(c => c.name));
  assert.equal(rows.length, 14); assert.ok(rows.every(x => x.n >= 16));
});

test('export: hidden from everyone but the admin; content CSV round-trips', async () => {
  const anon = client();
  for (const p of ['/export', '/export/content/posts.csv', '/export/table/users.csv', '/export/all.zip', '/export/template/posts.csv']) assert.equal((await anon.get(`${ADMIN}${p}`)).status, 404, p);
  const page = await adm.get(`${ADMIN}/export`); assert.equal(page.status, 200); assert.match(page.text, /all\.zip/); assert.match(page.text, /export\/table\/posts\.csv/);
  const res = await adm.get(`${ADMIN}/export/content/posts.csv`);
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type'), /text\/csv/); assert.match(res.headers.get('content-disposition'), /^attachment; filename="prompts360-posts-\d{4}-\d{2}-\d{2}\.csv"$/); assert.match(res.headers.get('cache-control'), /no-store/);
  const { records, headers } = parseObjects(res.text);
  assert.deepEqual(headers, ['community', 'title', 'body', 'model', 'url']); assert.ok(records.length >= 250);
  const row = records.find(r => r.title === 'Third'); assert.equal(unprotect(row.body), '=cmd()'); assert.match(row.body, /^'=/, 'formula-looking text is neutralised for spreadsheets'); assert.equal(row.model, 'local');
  // exporting then importing the same file changes nothing
  const { runImport } = await import('../src/admin/pages.js');
  const again = await runImport(res.text, { dry: true });
  assert.deepEqual(again.problems, []); assert.equal(again.postsNew, 0);
  const comm = await adm.get(`${ADMIN}/export/content/communities.csv`);
  const again2 = await runImport(comm.text, { dry: true }); assert.deepEqual(again2.problems, []); assert.equal(again2.communitiesNew, 0);
  for (const k of ['communities', 'posts']) { const t = await adm.get(`${ADMIN}/export/template/${k}.csv`); assert.equal(t.status, 200); assert.equal(parse(t.text).length, 2); }
});

test('export: tables are whitelisted and secrets never leave', async () => {
  assert.equal((await adm.get(`${ADMIN}/export/table/nonexistent.csv`)).status, 404);
  assert.equal((await adm.get(`${ADMIN}/export/table/mail_outbox.csv`)).status, 404);
  assert.equal((await adm.get(`${ADMIN}/export/table/admin_account.csv`)).status, 404);
  assert.equal((await adm.get(`${ADMIN}/export/table/users.csv;x.csv`)).status, 404);
  const users = await adm.get(`${ADMIN}/export/table/users.csv`);
  assert.equal(users.status, 200); const h = parse(users.text)[0];
  assert.ok(h.includes('username')); for (const bad of ['password', 'hash', 'email', 'token', 'secret']) assert.ok(!h.some(c => c.includes(bad)), bad);
  const zipRes = await fetch(`http://localhost:18080${ADMIN}/export/all.zip`, { headers: { cookie: adm.cookie } });
  assert.equal(zipRes.status, 200); assert.equal(zipRes.headers.get('content-type'), 'application/zip');
  const buf = Buffer.from(await zipRes.arrayBuffer()); fs.writeFileSync('/tmp/_all.zip', buf);
  const r = spawnSync('python3', ['-I', '-c', "import zipfile;z=zipfile.ZipFile('/tmp/_all.zip');assert z.testzip() is None;n=z.namelist();print(' '.join(n));d=b''.join(z.read(x) for x in n);print('pwhash' in d.decode('utf8').lower(), '$argon2' in d.decode('utf8').lower())"], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); const [names, flags] = r.stdout.trim().split('\n');
  assert.match(names, /posts\.csv/); assert.match(names, /communities\.csv/); assert.doesNotMatch(names, /outbox|session|admin/);
  assert.equal(flags, 'False False', 'no password hashes anywhere in the export');
  await (await import('../src/metrics.js')).tick(true);
  assert.ok((await app.db.q("SELECT 1 FROM event_log WHERE message LIKE 'Exported%'")).rowCount >= 3, 'exports are audited');
});
