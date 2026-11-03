// HTML rendering with escape-by-default. Every interpolated value is HTML-escaped unless it was
// produced by html`` itself or explicitly wrapped in raw() — that is the core XSS defence.

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = s => new Raw(String(s));

// All attributes are double-quoted, so escaping these five characters is sufficient in every context we emit.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return esc(v);
}

export function html(strings, ...vals) {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += render(vals[i]) + strings[i + 1];
  return new Raw(out);
}

export function timeAgo(d) {
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  const units = [[31536000, 'y'], [2592000, 'mo'], [604800, 'w'], [86400, 'd'], [3600, 'h'], [60, 'm']];
  for (const [n, u] of units) if (s >= n) return `${Math.floor(s / n)}${u} ago`;
  return 'just now';
}

export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function slugify(title) {
  return String(title).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim()
    .replace(/[\s_-]+/g, '_').slice(0, 60).replace(/^_+|_+$/g, '') || 'post';
}

/** Allow only absolute http(s) URLs; returns a normalised string or null. */
export function safeUrl(u) {
  try {
    const url = new URL(String(u).trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.href.length <= 2000 ? url.href : null;
  } catch { return null; }
}

/** Relative in-site path only (blocks open redirects like //evil.com, /\evil.com, javascript:). */
export function safeBack(p, fallback = '/') {
  if (typeof p !== 'string' || p.length > 500) return fallback;
  if (!p.startsWith('/') || p.startsWith('//') || /[\\\x00-\x1f]/.test(p)) return fallback;
  return p;
}
