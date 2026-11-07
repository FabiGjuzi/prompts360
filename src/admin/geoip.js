// admin/geoip.js — Automation -> Visitor locations: the country file (IP ranges -> country) that powers the dashboard map.
// The ranges are the table geoip_ranges (also in Database tables, with CSV export). This page adds: status, an IP tester, "refresh now",
// "reset to bundled", a download of the whole file, and a raw text editor for a window of the file.
import { q, one, tx } from '../db.js';
import { html } from '../html.js';
import { redirect, str, send } from '../http.js';
import { adminPage, csrf, card, nf, when, P } from './ui.js';
import { geoipStatus, lookupCountry, parseRanges, loadBundled, changed, reloadIndex } from '../geoip.js';
import { parseIp } from '../netutil.js';
import { runNow } from '../tasks.js';
import { MAP } from '../worldmap.js';
import { logEvent } from '../metrics.js';

const url = (rest = '') => `${P}/geoip${rest}`;
const RAW_MAX = 2000;
const NOTES = { refreshing: 'Started. The task page shows the result in a few seconds.', busy: 'That task is already running.', reset: 'Reset to the bundled file.', saved: 'Saved.', notask: 'There is no country-file refresh task. Create one under Scheduled tasks.' };

/** GET /geoip */
export async function page(req, res) {
  const ip = str(req.query.get('ip') || '', 60).trim();
  const [st, task] = await Promise.all([geoipStatus(), one(`SELECT * FROM scheduled_tasks WHERE kind = 'geoip_refresh' ORDER BY id LIMIT 1`)]);
  let test = '';
  if (ip) {
    const p = parseIp(ip), cc = p ? lookupCountry(ip) : null;
    test = !p ? html`<p class="error" role="alert">That is not an IP address.</p>` : cc ? html`<p><b>${ip}</b> is in <b>${MAP.countries[cc]?.[2] || cc}</b> (${cc}).</p>` : html`<p><b>${ip}</b> is not covered by any range (a private or unassigned address).</p>`;
  }
  const content = html`
<div class="geo-stats"><div class="tile"><span>IPv4 ranges</span><b>${nf(st.v4)}</b></div><div class="tile"><span>IPv6 ranges</span><b>${nf(st.v6)}</b></div><div class="tile"><span>Manual ranges</span><b>${nf(st.manual)}</b></div>
<div class="tile"><span>Source file published</span><b>${st.source_modified ? when(st.source_modified) : '–'}</b><small>${st.source_note || ''}</small></div></div>
${card('Test an address', html`<form method="get" action="${url()}" class="inline"><label class="visually-hidden" for="ip">IP address</label><input type="text" id="ip" name="ip" value="${ip}" placeholder="8.8.8.8 or 2001:4860:4860::8888" maxlength="60"> <button class="btn">Look up</button></form>${test}`)}
${card('Keep it up to date', html`${task ? html`<p>Refresh task: <a href="${P}/tasks/${task.id}">${task.name}</a>. ${task.enabled ? html`Next run ${when(task.next_run)}.` : 'It is paused.'} ${task.last_run ? html`Last run ${when(task.last_run)}: ${task.last_message}` : ''}</p>` : html`<p class="muted">No refresh task exists.</p>`}
<form method="post" action="${url('/refresh')}" class="inline">${csrf(req)}<button class="btn">Refresh now</button></form>
<form method="post" action="${url('/reset')}" class="inline">${csrf(req)}<button class="btn">Reset the downloaded ranges to the bundled file</button></form>
<p class="muted">Manual ranges are never changed by a refresh or a reset. When ranges overlap, a manual range wins over the downloaded file, and the smaller range wins among manual ones.</p>`)}
${card('Edit the ranges', html`<ul><li><a href="${P}/t/geoip_ranges">Ranges as a table</a>: search, add, edit and delete single ranges, with CSV export under <a href="${P}/export">Export</a>.</li>
<li><a href="${url('/raw')}">Raw file editor</a>: edit the file as text, a few thousand lines at a time (by country or by address).</li>
<li><a href="${url('/file.csv')}">Download the whole file</a> (CSV: from,to,country).</li></ul>`)}`;
  return adminPage(req, res, { title: 'Visitor locations', active: '/geoip', content, flash: NOTES[req.query.get('n')] });
}

/** POST /geoip/refresh — run the refresh task now, ignoring "source not republished" (force). */
export async function refresh(req, res) {
  const t = await one(`SELECT id FROM scheduled_tasks WHERE kind = 'geoip_refresh' ORDER BY id LIMIT 1`);
  if (!t) return redirect(res, `${url()}?n=notask`);
  const ok = await runNow(t.id);
  return redirect(res, `${url()}?n=${ok ? 'refreshing' : 'busy'}`);
}

/** POST /geoip/reset */
export async function reset(req, res) {
  await loadBundled();
  logEvent('warn', 'admin', 'Reset the country file to the bundled copy');
  return redirect(res, `${url()}?n=reset`);
}

/** GET /geoip/file.csv — every range, one per line. */
export async function file(req, res) {
  const { rows } = await q(`SELECT host(ip_from) AS a, host(ip_to) AS b, country FROM geoip_ranges ORDER BY family(ip_from), ip_from`);
  res.setHeader('Content-Disposition', 'attachment; filename="geoip-country.csv"');
  return send(req, res, 200, `${rows.map(r => `${r.a},${r.b},${r.country.trim()}`).join('\n')}\n`, 'text/csv; charset=utf-8');
}

// ---------- raw editor ----------
/** Rows to show: by country (2 letters) or by address (the ranges at and after it). */
async function windowRows(filter) {
  const f = filter.trim();
  if (/^[A-Za-z]{2}$/.test(f)) return (await q(`SELECT id, host(ip_from) AS a, host(ip_to) AS b, country, source FROM geoip_ranges WHERE country = $1 ORDER BY family(ip_from), ip_from LIMIT ${RAW_MAX}`, [f.toUpperCase()])).rows;
  if (parseIp(f)) return (await q(`SELECT id, host(ip_from) AS a, host(ip_to) AS b, country, source FROM geoip_ranges WHERE ip_to >= $1::inet AND family(ip_from) = family($1::inet) ORDER BY ip_from LIMIT ${RAW_MAX}`, [f])).rows;
  return [];
}
const lineOf = r => `${r.a},${r.b},${r.country.trim()}`;

async function rawPage(req, res, { filter, rows, text, error, status = 200 }) {
  const lines = text ?? rows.map(lineOf).join('\n');
  const content = html`<p><a href="${url()}">← Visitor locations</a></p>
<form method="get" action="${url('/raw')}" class="inline"><label for="f">Show ranges for a country (e.g. FR) or starting at an address (e.g. 8.8.8.0)</label> <input type="text" id="f" name="f" value="${filter}" maxlength="60" required> <button class="btn">Show</button></form>
${error ? html`<p class="error" role="alert">${error}</p>` : ''}
${filter ? html`<form method="post" action="${url('/raw')}" class="edit">${csrf(req)}<input type="hidden" name="f" value="${filter}"><input type="hidden" name="ids" value="${rows.map(r => r.id).join(',')}">
<p class="muted">${nf(rows.length)} line${rows.length === 1 ? '' : 's'}${rows.length >= RAW_MAX ? ` (the first ${RAW_MAX}; narrow the filter to see more)` : ''}. One range per line: <code>from,to,CC</code>. Delete a line to delete the range, add a line to add one. Lines you do not touch stay as they are; added or changed lines become manual ranges.</p>
<textarea class="raw" name="text" rows="24" spellcheck="false" aria-label="Ranges">${lines}</textarea>
<button class="btn primary">Save changes</button></form>` : ''}`;
  return adminPage(req, res, { title: 'Raw country file', active: '/geoip', content, status, flash: NOTES[req.query.get('n')] });
}

export async function rawGet(req, res) {
  const filter = str(req.query.get('f') || '', 60);
  return rawPage(req, res, { filter, rows: filter ? await windowRows(filter) : [] });
}

/** POST /geoip/raw — apply the edit of the shown window: unchanged lines stay, removed lines are deleted, new or changed lines are added as manual. */
export async function rawPost(req, res) {
  const filter = str(req.body.f, 60);
  const ids = str(req.body.ids, 40_000).split(',').filter(x => /^\d{1,15}$/.test(x)).map(Number).slice(0, RAW_MAX);
  const text = str(req.body.text, 600_000).replace(/\r\n/g, '\n');
  const { rows: add, errors } = parseRanges(text, { max: RAW_MAX * 2 });
  if (errors.length) return rawPage(req, res, { filter, rows: await windowRows(filter), text, error: errors.slice(0, 5).join('; '), status: 400 });
  try {
    const counts = await tx(async db => {
      const { rows: old } = await db.query(`SELECT id, host(ip_from) AS a, host(ip_to) AS b, country FROM geoip_ranges WHERE id = ANY($1::bigint[]) FOR UPDATE`, [ids]);
      const have = new Map(old.map(r => [lineOf(r), r.id]));
      // Compare on the canonical text of each address so "2001:DB8::1" and "2001:db8::1" are the same line.
      const canon = (await db.query(`SELECT host(a::inet) AS a, host(b::inet) AS b, c FROM unnest($1::text[], $2::text[], $3::text[]) AS t(a, b, c)`, [add.map(r => r[0]), add.map(r => r[1]), add.map(r => r[2])])).rows.map(r => `${r.a},${r.b},${r.c}`);
      const keep = new Set(), fresh = [];
      canon.forEach((l, i) => { if (have.has(l) && !keep.has(l)) keep.add(l); else if (!have.has(l) && !fresh.some(f => f.l === l)) fresh.push({ l, r: add[i] }); });
      const drop = old.filter(r => !keep.has(lineOf(r))).map(r => r.id);
      if (drop.length) await db.query('DELETE FROM geoip_ranges WHERE id = ANY($1::bigint[])', [drop]);
      if (fresh.length) await db.query(`INSERT INTO geoip_ranges (ip_from, ip_to, country, source) SELECT a::inet, b::inet, c, 'manual' FROM unnest($1::text[], $2::text[], $3::text[]) AS t(a, b, c)`, [fresh.map(f => f.r[0]), fresh.map(f => f.r[1]), fresh.map(f => f.r[2])]);
      if (drop.length || fresh.length) await changed(db);
      return { removed: drop.length, added: fresh.length };
    });
    await reloadIndex();
    logEvent('info', 'admin', `Edited the country file: ${counts.added} added, ${counts.removed} removed`);
    return redirect(res, `${url('/raw')}?f=${encodeURIComponent(filter)}&n=saved`);
  } catch (e) {
    if (e.code === '23514' || e.code === '22P02') return rawPage(req, res, { filter, rows: await windowRows(filter), text, error: 'A range was rejected (from must not be after to, and both must be the same kind of address).', status: 400 });
    throw e;
  }
}
