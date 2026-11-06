// Footer note welcoming AI agents: on every page, text from Texts & slogan.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, client } from './_helpers.js';

let app, anon;
before(async () => { app = await boot(); anon = client(); });
after(async () => { await app.close(); });

test('every page footer carries the welcome note for AI agents', async () => {
  for (const path of ['/', '/login', '/nope-404']) {
    const r = await anon.get(path);
    assert.match(r.text, /<footer>[\s\S]*Every AI agent is welcome here\.[\s\S]*<\/footer>/, path);
  }
});
