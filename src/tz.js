// tz.js — the dashboard's clock: every time shown to the operator, every hour label and every "day" boundary is New York time
// (America/New_York: EST in winter, EDT in summer, switching on the real DST dates). The database keeps UTC; this module only
// converts at the edges. SQL that must bucket by local time uses the same zone name (`TZ_SQL`).
export const TZ = 'America/New_York';
export const TZ_SQL = `'${TZ}'`;

const F = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' });
const p2 = n => String(n).padStart(2, '0');

/** Wall-clock parts in New York for a UTC instant (ms or Date): {y, mo, d, h, mi, s, zone: 'EST'|'EDT'}. */
export function nyParts(t) {
  const o = {};
  for (const { type, value } of F.formatToParts(new Date(t))) o[type] = value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second, zone: o.timeZoneName };
}
/** '2026-07-04 12:30:00 EDT' */
export function nyStamp(t) { const p = nyParts(t); return `${p.y}-${p2(p.mo)}-${p2(p.d)} ${p2(p.h)}:${p2(p.mi)}:${p2(p.s)} ${p.zone}`; }
/** '12:30:00' (no zone: for tables where the heading says it) */
export function nyClock(t) { const p = nyParts(t); return `${p2(p.h)}:${p2(p.mi)}:${p2(p.s)}`; }
/** The New York calendar day of an instant: '2026-07-04'. Metrics days start and end at New York midnight. */
export function nyDay(t) { const p = nyParts(t); return `${p.y}-${p2(p.mo)}-${p2(p.d)}`; }
/** Value for <input type="datetime-local"> ('2026-07-04T12:30'), in New York time. */
export function nyInput(t) { const p = nyParts(t); return `${p.y}-${p2(p.mo)}-${p2(p.d)}T${p2(p.h)}:${p2(p.mi)}`; }

const wallAsUtc = t => { const p = nyParts(t); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s); };
/** Parse a New York wall-clock time ('2026-07-04T12:30' or with seconds) into a UTC Date. Times inside the spring-forward gap
 *  land one hour later; times repeated in the fall-back hour resolve to the first (EDT) occurrence. */
export function nyToDate(s) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[T ](\d\d):(\d\d)(?::(\d\d))?$/.exec(String(s).trim());
  if (!m) return new Date(NaN);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  let t = guess - (wallAsUtc(guess) - guess);          // first guess: treat the offset at `guess` as the offset at the answer
  t = guess - (wallAsUtc(t) - t);                        // second pass fixes instants near a DST change
  const back = guess - (wallAsUtc(t - 3_600_000) - (t - 3_600_000));   // an earlier candidate: the first occurrence in a repeated hour
  if (wallAsUtc(back) === guess) return new Date(back);
  return new Date(wallAsUtc(t) === guess ? t : t + 3_600_000);   // nonexistent time in the spring gap: one hour later
}
