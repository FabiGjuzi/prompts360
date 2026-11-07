// admin/livemap.js — the dashboard's visitor map: country-level bubbles for the last 4, 10 or 24 hours.
// Data comes from metrics.js (distinct visitors per country, kept in memory only, country code from the edge's header — no IP, no
// coordinates). The map itself is src/worldmap.js (Natural Earth outline, generated once); no external map provider, no tiles.
import { html } from '../html.js';
import { HttpError, json } from '../http.js';
import { MAP } from '../worldmap.js';
import { geoSnapshot, systemSnapshot } from '../metrics.js';
import { config } from '../config.js';
import { nf } from './ui.js';

export const WINDOWS = [4, 10, 24];
export const R_MIN = 7, R_MAX = 30;                      // bubble radius range in map units (the map is 1000 wide)
export const radius = (n, max) => (n <= 0 || max <= 0 ? 0 : R_MIN + (R_MAX - R_MIN) * Math.sqrt(n / max));

/** Everything the card and /geo.json show for one window. */
export function mapData(hours, now = Date.now()) {
  const g = geoSnapshot(hours, now), countries = [];
  let elsewhere = 0;
  for (const r of g.countries) {
    const m = MAP.countries[r.c];
    if (m) countries.push({ c: r.c, name: m[2], x: m[0], y: m[1], n: r.n, live: r.live });
    else elsewhere += r.n;
  }
  const up = systemSnapshot().uptimeSec;
  let note = '';
  if (!g.coverage.located && !g.coverage.unlocated) note = 'No visitors since the last restart.';
  else if (!g.coverage.located) note = `No country information is arriving. The hosting edge must send a country header (${config.countryHeader}); with Cloudflare, proxy the domain and see DEPLOY.md.`;
  else if (up < hours * 3600) note = `Location history is kept in memory, so this view only goes back to the last restart (${up < 3600 ? `${Math.max(1, Math.round(up / 60))} min` : `${Math.round(up / 360) / 10} h`} ago).`;
  return { hours, now: g.now, total: g.total, online: g.online, unlocated: g.unlocated, elsewhere, note, countries };
}

/** GET /geo.json?h=4|10|24 — polled by admin-map.js and re-requested the moment the window dropdown changes. */
export async function geoJson(req, res) {
  const raw = req.query.get('h'), h = raw === null ? 4 : Number(raw);
  if (!WINDOWS.includes(h)) throw new HttpError(400, 'h must be 4, 10 or 24.');
  return json(req, res, 200, mapData(h));
}

/** The map card (server-drawn; admin-map.js animates it). Sits in the top-right corner of the dashboard overview. */
export function mapCard(data) {
  const max = Math.max(1, ...data.countries.map(c => c.n));
  const dots = [...data.countries].sort((a, b) => b.n - a.n).map(c => html`<circle class="bub${c.live ? ' live' : ''}" data-c="${c.c}" data-n="${c.n}" data-name="${c.name}" cx="${c.x}" cy="${c.y}" r="${radius(c.n, max).toFixed(2)}" fill-opacity="0.55"><title>${c.name}: ${nf(c.n)} visitor${c.n === 1 ? '' : 's'}</title></circle>`);
  return html`<aside class="card mapcard" data-map data-rmin="${R_MIN}" data-rmax="${R_MAX}" data-hours="${data.hours}" aria-labelledby="map-h">
<div class="maphead"><h2 id="map-h">Visitors by country</h2>
<label class="visually-hidden" for="mapwin">Time window</label>
<select id="mapwin" data-map-window>${WINDOWS.map(h => html`<option value="${h}"${h === data.hours ? html` selected` : ''}>Last ${h} hours</option>`)}</select></div>
<div class="mapwrap"><svg class="map" viewBox="0 0 ${MAP.w} ${MAP.h}" role="img" aria-label="World map with a circle per country, sized by the number of visitors"><path class="land" d="${MAP.land}"/><g class="bubbles">${dots}</g></svg><div class="maptip" hidden></div></div>
<p class="mapstat"><b data-map-online>${nf(data.online)}</b> online now · <b data-map-total>${nf(data.total)}</b> visitors in the last <span data-map-label>${data.hours} hours</span><span data-map-unloc>${data.unlocated ? ` · ${nf(data.unlocated)} without a known country` : ''}</span></p>
<ol class="maplist" data-map-list>${data.countries.slice(0, 5).map(c => html`<li><span>${c.name}</span><b>${nf(c.n)}</b></li>`)}</ol>
<p class="muted mapnote" data-map-note${data.note ? '' : html` hidden`}>${data.note}</p>
</aside>`;
}
