// scripts/build-worldmap.mjs — one-off generator for src/worldmap.js (the dashboard's visitor map). Not part of the runtime and not a dependency.
//   cd /tmp && mkdir wm && cd wm && npm init -y && npm i world-atlas@2 topojson-client@3 i18n-iso-countries@7
//   node /path/to/repo/scripts/build-worldmap.mjs /tmp/wm > src/worldmap.js
// Data: Natural Earth 110m (public domain) via world-atlas. Projection: Equal Earth. Output: one land outline path plus a projected
// centre point and English name per country (ISO 3166-1 alpha-2), so the server can place bubbles and the browser needs no map library.
import { createRequire } from 'node:module';
const dir = process.argv[2] || '.';
const require = createRequire(dir + '/');
const topo = require('topojson-client');
const iso = require('i18n-iso-countries');
const land = require('world-atlas/land-110m.json');
const countries = require('world-atlas/countries-110m.json');

const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796, rad = Math.PI / 180;
function eqearth(lon, lat) {
  const l = lon * rad, th = Math.asin((Math.sqrt(3) / 2) * Math.sin(lat * rad)), t2 = th * th, t6 = t2 * t2 * t2;
  return [(2 * Math.sqrt(3) * l * Math.cos(th)) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1)), th * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))];
}
// Scale so the world (lat -58..84) is 1000 wide.
const [x180] = eqearth(180, 0), [xm180] = eqearth(-180, 0);
const S = 1000 / (x180 - xm180), OX = -xm180;
const [, yN] = eqearth(0, 84), [, yS] = eqearth(0, -58);
const proj = (lon, lat) => [(eqearth(lon, lat)[0] + OX) * S, (yN - eqearth(lon, lat)[1]) * S];
const H = Math.round((yN - yS) * S);

const r1 = n => Math.round(n * 10) / 10;
function ringPath(ring) {
  // keep points north of -58 (drops Antarctica), absolute coordinates with one decimal, consecutive duplicates removed
  const pts = [];
  for (const [lon, lat] of ring) { if (lat < -58) continue; const [x, y] = proj(lon, lat); const p = [r1(x), r1(y)]; if (!pts.length || pts.at(-1)[0] !== p[0] || pts.at(-1)[1] !== p[1]) pts.push(p); }
  if (pts.length < 4) return '';
  let d = `M${pts[0][0]} ${pts[0][1]}`, px = pts[0][0], py = pts[0][1];
  for (const [x, y] of pts.slice(1)) { d += `l${r1(x - px)} ${r1(y - py)}`; px = x; py = y; }
  return d + 'z';
}
const landFeature = topo.feature(land, land.objects.land);
const polys = landFeature.type === 'FeatureCollection' ? landFeature.features.flatMap(f => f.geometry.coordinates) : landFeature.geometry.coordinates;
const landPath = polys.map(poly => poly.map(ringPath).join('')).join('');

const area = ring => { let a = 0; for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return a / 2; };
const centroid = ring => { let a = 0, cx = 0, cy = 0; for (let i = 0; i < ring.length - 1; i++) { const f = ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; a += f; cx += (ring[i][0] + ring[i + 1][0]) * f; cy += (ring[i][1] + ring[i + 1][1]) * f; } a /= 2; return [cx / (6 * a), cy / (6 * a)]; };
const out = {};
for (const f of topo.feature(countries, countries.objects.countries).features) {
  const a2 = f.id != null ? iso.numericToAlpha2(String(f.id).padStart(3, '0')) : f.properties.name === 'Kosovo' ? 'XK' : null;
  if (!a2) continue;
  const parts = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const big = parts.map(p => p[0]).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0];
  const [lon, lat] = centroid(big);
  out[a2] = [lon, lat, f.properties.name];
}
// Small states that the 110 m data leaves out: a point and a name is enough for a bubble.
const small = { SG: [103.8, 1.35], HK: [114.17, 22.32], MO: [113.55, 22.2], MT: [14.4, 35.9], BH: [50.55, 26.05], MV: [73.2, 3.2], LU: [6.13, 49.8], MC: [7.4, 43.73], LI: [9.55, 47.16], AD: [1.52, 42.5], SM: [12.46, 43.94], MU: [57.55, -20.3], SC: [55.45, -4.68], BB: [-59.55, 13.19], AG: [-61.8, 17.06], LC: [-60.98, 13.9], VC: [-61.2, 13.25], GD: [-61.68, 12.12], KN: [-62.75, 17.3], DM: [-61.37, 15.41], TO: [-175.2, -21.18], WS: [-172.1, -13.76], KI: [173, 1.87], FM: [158.2, 6.9], MH: [171, 7.1], PW: [134.5, 7.5], NR: [166.9, -0.52], TV: [179.2, -8.5], CV: [-23.6, 15.1], ST: [6.7, 0.3], KM: [43.3, -11.7], BN: [114.7, 4.5], PS: [35.2, 31.9], GI: [-5.35, 36.14], VA: [12.45, 41.9], JE: [-2.13, 49.2], GG: [-2.58, 49.45], IM: [-4.55, 54.24], FO: [-6.9, 62], GL: [-42, 72], PR: [-66.5, 18.2], GU: [144.8, 13.45], AW: [-69.97, 12.52], CW: [-68.97, 12.2], BM: [-64.75, 32.3], KY: [-81.25, 19.3], BS: [-77.4, 25.03], PF: [-149.4, -17.7], NC: [165.5, -21.3], RE: [55.5, -21.1], GP: [-61.55, 16.25], MQ: [-61, 14.65], YT: [45.17, -12.8], AX: [20, 60.2], SX: [-63.05, 18.04], TC: [-71.8, 21.7], VG: [-64.6, 18.4], VI: [-64.9, 18.3], AI: [-63.07, 18.22], MS: [-62.2, 16.74], MF: [-63.05, 18.08], BL: [-62.85, 17.9], SJ: [15.6, 78.2], EH: [-13.2, 24.5] };
const names = new Intl.DisplayNames(['en'], { type: 'region' });
for (const [a2, [lon, lat]] of Object.entries(small)) if (!out[a2]) out[a2] = [lon, lat, names.of(a2)];
const table = {};
for (const [a2, [lon, lat, name]] of Object.entries(out)) { const [x, y] = proj(lon, lat); if (y >= 0 && y <= H) table[a2] = [r1(x), r1(y), names.of(a2) || name]; }
const missing = Object.keys(iso.getAlpha2Codes()).filter(c => !table[c]);
console.error(`land path ${landPath.length} bytes, ${Object.keys(table).length} countries placed, unplaced: ${missing.join(' ')}`);
console.log(`// worldmap.js — GENERATED by scripts/build-worldmap.mjs from Natural Earth 110m (public domain). Do not edit by hand.
// A 1000 x ${H} Equal Earth map: one land outline and, per ISO 3166-1 alpha-2 country, [x, y, English name] of its centre.
export const MAP = { w: 1000, h: ${H}, land: ${JSON.stringify(landPath)}, countries: ${JSON.stringify(table)} };`);
