// prompts360 dashboard — shared motion helpers for the live charts and the visitor map.
// One requestAnimationFrame loop drives every running animation (so ten charts cost one frame callback), easing is
// ease-in-out cubic, and with "reduce motion" switched on in the operating system every animation jumps straight to its end state.
// Also holds the Live / Paused switch and the "updated" clock that the charts and the map share (times are New York time).
(() => {
  'use strict';
  const reduce = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;

  const running = new Set();
  let raf = 0;
  const frame = now => {
    raf = 0;
    for (const a of [...running]) {
      const t = Math.min(1, Math.max(0, (now - a.t0) / a.ms));
      a.fn(ease(t), t);
      if (t >= 1) { running.delete(a); if (a.done) a.done(); }
    }
    if (running.size) raf = requestAnimationFrame(frame);
  };
  /** Run fn(easedProgress 0..1) for `ms` milliseconds; `done` runs after the last frame. Returns {cancel()}. */
  function tween(ms, fn, done) {
    if (reduce() || ms <= 0 || typeof requestAnimationFrame !== 'function') { fn(1); if (done) done(); return { cancel() {} }; }
    const a = { t0: performance.now(), ms, fn, done };
    running.add(a);
    if (!raf) raf = requestAnimationFrame(frame);
    return { cancel() { running.delete(a); } };
  }

  // ---- Live / Paused (shared by charts and map) ----
  const live = { paused: false, subs: [] };
  live.on = fn => { live.subs.push(fn); };
  const NY = typeof Intl !== 'undefined' ? new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' }) : null;
  /** '12:44:03 EST' for an instant, in New York time. */
  const nyStamp = t => { if (!NY) return ''; const o = {}; for (const p of NY.formatToParts(new Date(t))) o[p.type] = p.value; return `${o.hour}:${o.minute}:${o.second} ${o.timeZoneName}`; };
  live.stamp = t => { const e = document.querySelector('[data-live-stamp]'); if (e) e.textContent = nyStamp(t); };
  live.set = paused => {
    live.paused = paused;
    const b = document.querySelector('[data-live-toggle]');
    if (b) { b.setAttribute('aria-pressed', paused ? 'false' : 'true'); b.textContent = paused ? '▶ Resume live' : '⏸ Pause'; }
    const bar = document.querySelector('[data-livebar]');
    if (bar) bar.classList.toggle('paused', paused);
    for (const fn of live.subs) fn(paused);
  };
  if (typeof document !== 'undefined') {
    document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('[data-live-toggle]'); if (b) live.set(!live.paused); });
  }

  const api = { ease, lerp, tween, reduce, nyStamp, running: () => running.size };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { window.p360 = window.p360 || {}; window.p360.anim = api; window.p360.live = live; }
})();
