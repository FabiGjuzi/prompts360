// Generates the logo SVGs in public/ (run after changing shapes or timing):  node scripts/build-logo.js
//
// Story (5 s forward, then the exact reverse, looping forever = 10 s cycle):
//   360.si → the 6 tips over and lands as a p (its straight top stroke becomes the p's stem)
//          → "s" and "i" morph into the two halves of the 0 while the dots fly in along arcs
//          → the merged 0 pulses, then its halves morph apart into "S" and "I"  →  3pSI
// Morphs are true point-by-point shape interpolation (3Blue1Brown / Manim "Transform" style) using SMIL,
// which needs no JavaScript and no inline CSS, so it works under the site's strict Content-Security-Policy.
// Every morphing shape is built from exactly 4 cubic Bézier segments so the shapes line up point for point.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const THEMES = { light: { ink: '#1c1e21', accent: '#4f46e5' }, dark: { ink: '#e4e6eb', accent: '#818cf8' } };

// ---------- geometry ----------
const K = 0.5523; // cubic approximation of a quarter ellipse
const r = n => String(Math.round(n * 100) / 100);
const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
function split([p0, p1, p2, p3]) { // de Casteljau at t = 0.5
  const a = mid(p0, p1), b = mid(p1, p2), c = mid(p2, p3), d = mid(a, b), e = mid(b, c), f = mid(d, e);
  return [[p0, a, d, f], [f, e, c, p3]];
}
const line = (a, b) => [0, 1, 2, 3].map(i => {
  const s = lerp(a, b, i / 4), e = lerp(a, b, (i + 1) / 4);
  return [s, lerp(s, e, 1 / 3), lerp(s, e, 2 / 3), e];
});
const d = cubics => `M${r(cubics[0][0][0])} ${r(cubics[0][0][1])}` +
  cubics.map(c => `C${c.slice(1).map(p => `${r(p[0])} ${r(p[1])}`).join(' ')}`).join('');
const mirrorX = (cubics, ax) => cubics.map(c => c.map(([x, y]) => [2 * ax - x, y]));

// The 0: ellipse centre (50,20), rx 7, ry 12. Left half runs top → left → bottom.
const leftHalf = [
  ...split([[50, 8], [50 - 7 * K, 8], [43, 20 - 12 * K], [43, 20]]),
  ...split([[43, 20], [43, 20 + 12 * K], [50 - 7 * K, 32], [50, 32]]),
];
const rightHalf = mirrorX(leftHalf, 50);
const sLower = (() => { const m = split([[67.5, 21.5], [67.5, 25.5], [77.5, 24.5], [77.5, 28.5]]);
  return [[[77, 20.5], [75.5, 17.5], [67.5, 17], [67.5, 21.5]], ...m, [[77.5, 28.5], [77.5, 33], [69, 33.5], [67, 30]]]; })();
const sUpper = (() => { const m = split([[41.5, 14], [41.5, 20.5], [53.5, 19.5], [53.5, 26]]);
  return [[[53, 11.5], [50.5, 8], [41.5, 7.5], [41.5, 14]], ...m, [[53.5, 26], [53.5, 33], [43.5, 33.5], [41, 29]]]; })();
const iStem = line([83, 19], [83, 32]);
const capI = line([60, 8], [60, 32]);

// The 6: a circle bowl (centre 30,25, r 7) with a STRAIGHT top stroke tangent to it (no curl), so the
// vertically flipped 6 already reads as a p. After landing, the stroke straightens to vertical.
const SIX = 'M27 8L23.21 23.32A7 7 0 1 0 36.79 26.68A7 7 0 1 0 23.21 23.32';
const SIX_STRAIGHT = 'M23 9L23 25A7 7 0 1 0 37 25A7 7 0 1 0 23 25';
const THREE = 'M4 11.5C6.5 7.5 16 7.5 16 14C16 18.5 12.5 20 9 20C13 20 17 22 17 26C17 33 6 34 3.5 29';

// ---------- timeline ----------
// Each track lists [seconds, value] keyframes for the forward half (0 → 5 s). The reverse half is
// generated as an exact mirror, so the loop plays forward, then backward, forever.
const HALF = 5, CYCLE = 2 * HALF;
const EASE = '.42 0 .58 1'; // ease-in-out on every segment (Manim's "smooth")
function track(frames) {
  const all = [...frames, ...frames.slice(0, -1).reverse().map(([t, v]) => [CYCLE - t, v])];
  return `dur="${CYCLE}s" repeatCount="indefinite" calcMode="spline" keyTimes="${all.map(([t]) => r(t / CYCLE)).join(';')}" ` +
    `keySplines="${Array(all.length - 1).fill(EASE).join(';')}"`;
}
const vals = frames => [...frames, ...frames.slice(0, -1).reverse()].map(([, v]) => v).join(';');
const animate = (attr, frames) => `<animate attributeName="${attr}" values="${vals(frames)}" ${track(frames)}/>`;
const animT = (type, frames) => `<animateTransform attributeName="transform" type="${type}" values="${vals(frames)}" ${track(frames)}/>`;
const motion = (p, frames) => `<animateMotion path="${p}" keyPoints="${vals(frames)}" ${track(frames)}/>`;

const T = {
  sixRotate: [[0, '0'], [0.7, '0'], [1.25, '-14'], [1.8, '0'], [HALF, '0']],
  sixScale: [[0, '1 1'], [0.7, '1 1'], [1.25, '1 .15'], [1.65, '1 -1.08'], [1.8, '1 -1'], [HALF, '1 -1']],
  sixShape: [[0, SIX], [1.85, SIX], [2.3, SIX_STRAIGHT], [HALF, SIX_STRAIGHT]],
  sMorph: [[0, d(sLower)], [2.1, d(sLower)], [2.95, d(leftHalf)], [3.55, d(leftHalf)], [4.4, d(sUpper)], [HALF, d(sUpper)]],
  iMorph: [[0, d(iStem)], [2.2, d(iStem)], [3.0, d(rightHalf)], [3.55, d(rightHalf)], [4.4, d(capI)], [HALF, d(capI)]],
  dotPath: [[0, '0'], [2.1, '0'], [2.75, '1'], [HALF, '1']],
  dotSize: [[0, '2.4'], [2.1, '2.4'], [2.75, '0'], [HALF, '0']],
  iDotPath: [[0, '0'], [2.2, '0'], [2.85, '1'], [HALF, '1']],
  iDotSize: [[0, '2.4'], [2.2, '2.4'], [2.85, '0'], [HALF, '0']],
  zeroFade: [[0, '1'], [2.75, '1'], [3.0, '0'], [HALF, '0']],
  pulse: [[0, '1'], [3.0, '1'], [3.2, '1.15'], [3.4, '1'], [HALF, '1']],
};

function svg({ ink, accent }, animated) {
  const head = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 4 92 43" width="92" height="43">` +
    `<g fill="none" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path stroke="${ink}" d="${THREE}"/>`;
  if (!animated) {
    return head + `<path stroke="${ink}" d="${SIX}"/><path stroke="${ink}" d="${d(leftHalf)}${d(rightHalf)}"/>` +
      `<path stroke="${accent}" d="${d(sLower)}"/><path stroke="${accent}" d="${d(iStem)}"/>` +
      `<circle fill="${accent}" stroke="none" cx="63" cy="30.5" r="2.4"/><circle fill="${accent}" stroke="none" cx="83" cy="12.5" r="2.4"/></g></svg>`;
  }
  return head +
    // 6 → p: tip over (rotate + squash through zero), land flipped, then straighten the stem
    `<g transform="translate(30 25)"><g>${animT('rotate', T.sixRotate)}<g>${animT('scale', T.sixScale)}` +
    `<path stroke="${ink}" transform="translate(-30 -25)" d="${SIX}">${animate('d', T.sixShape)}</path></g></g></g>` +
    // the original 0 fades as the morphed halves land exactly on top of it
    `<g stroke="${ink}">${animate('opacity', T.zeroFade)}<path d="${d(leftHalf)}"/><path d="${d(rightHalf)}"/></g>` +
    // s → left half → S and i → right half → I, inside a group that pulses ("Indicate") when the 0 is whole
    `<g transform="translate(50 20)"><g>${animT('scale', T.pulse)}<g transform="translate(-50 -20)" stroke="${accent}">` +
    `<path d="${d(sLower)}">${animate('d', T.sMorph)}</path><path d="${d(iStem)}">${animate('d', T.iMorph)}</path></g></g></g>` +
    // the two dots fly into the 0 along arcs and shrink away
    `<circle fill="${accent}" stroke="none" r="2.4">${motion('M63 30.5Q59 21 50 20', T.dotPath)}${animate('r', T.dotSize)}</circle>` +
    `<circle fill="${accent}" stroke="none" r="2.4">${motion('M83 12.5Q68 4 50 20', T.iDotPath)}${animate('r', T.iDotSize)}</circle>` +
    `</g></svg>`;
}

for (const [name, theme] of Object.entries(THEMES)) {
  fs.writeFileSync(path.join(OUT, `logo-${name}.svg`), svg(theme, true));
  fs.writeFileSync(path.join(OUT, `logo-static-${name}.svg`), svg(theme, false));
}
console.log('wrote public/logo-{light,dark}.svg and public/logo-static-{light,dark}.svg');
