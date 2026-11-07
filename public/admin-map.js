// prompts360 dashboard — the visitor map.
// The server draws the map and its circles (so it works without JavaScript). This script makes it live: changing the time window
// asks /geo.json for the new window straight away and eases every circle to its new size (new countries grow in, countries that
// drop out shrink away), and while the page is open it refreshes the same window every few seconds. Everything is built with
// createElementNS / textContent; positions come from the server, so no map library and no external tiles are involved.
(() => {
  'use strict';
  const P = window.p360, d = document, NS = 'http://www.w3.org/2000/svg';
  const root = d.querySelector('[data-map]');
  if (!P || !P.anim || !root) return;
  const { tween, lerp } = P.anim, live = P.live;
  const base = d.body.dataset.base, g = root.querySelector('g.bubbles'), sel = root.querySelector('[data-map-window]');
  const tip = root.querySelector('.maptip'), svg = root.querySelector('svg.map');
  const RMIN = Number(root.dataset.rmin) || 7, RMAX = Number(root.dataset.rmax) || 30, MS = 700;
  const num = n => Number(n).toLocaleString('en-US');
  const radius = (n, max) => (n <= 0 || max <= 0 ? 0 : RMIN + (RMAX - RMIN) * Math.sqrt(n / max));

  const bubbles = new Map();            // country -> {el, r (on screen now), from, to, n, name, live}
  for (const el of g.querySelectorAll('circle[data-c]')) bubbles.set(el.dataset.c, { el, r: Number(el.getAttribute('r')), from: 0, to: Number(el.getAttribute('r')), n: Number(el.dataset.n), name: el.dataset.name, live: el.classList.contains('live') });
  let hours = Number(sel.value) || 4, anim = null, ctl = null;

  const out = k => root.querySelector(`[data-map-${k}]`);
  const counters = { online: { el: out('online'), v: Number(out('online').textContent.replace(/,/g, '')) || 0 }, total: { el: out('total'), v: Number(out('total').textContent.replace(/,/g, '')) || 0 } };
  function countTo(c, to) {
    const from = c.v;
    tween(MS, p => { c.el.textContent = num(Math.round(lerp(from, to, p))); }, () => { c.v = to; c.el.textContent = num(to); });
  }

  function apply(data) {
    hours = data.hours;
    const max = Math.max(1, ...data.countries.map(c => c.n)), next = new Map(data.countries.map(c => [c.c, c]));
    for (const [c, b] of bubbles) { b.from = b.r; if (!next.has(c)) { b.to = 0; b.n = 0; b.live = false; } }
    for (const c of data.countries) {
      let b = bubbles.get(c.c);
      if (!b) {
        const el = d.createElementNS(NS, 'circle');
        el.setAttribute('class', 'bub'); el.setAttribute('cx', c.x); el.setAttribute('cy', c.y); el.setAttribute('r', '0'); el.dataset.c = c.c;
        g.append(el);
        b = { el, r: 0, from: 0, to: 0, n: 0, name: c.name, live: false };
        bubbles.set(c.c, b);
      }
      b.from = b.r; b.to = radius(c.n, max); b.n = c.n; b.name = c.name; b.live = c.live > 0;
      b.el.dataset.n = c.n; b.el.dataset.name = c.name;
      b.el.classList.toggle('live', b.live);
    }
    // bigger circles first, so the small ones stay clickable on top
    g.append(...[...bubbles.values()].sort((a, b) => b.to - a.to).map(b => b.el));
    if (anim) anim.cancel();
    anim = tween(MS, p => {
      for (const b of bubbles.values()) { b.r = lerp(b.from, b.to, p); b.el.setAttribute('r', (Math.round(b.r * 100) / 100).toString()); b.el.setAttribute('fill-opacity', String(Math.min(1, 0.15 + b.r / (RMIN * 1.6)) * 0.55)); }
    }, () => {
      anim = null;
      for (const [c, b] of bubbles) if (b.to === 0) { b.el.remove(); bubbles.delete(c); }
    });
    countTo(counters.online, data.online); countTo(counters.total, data.total);
    const un = out('unloc'); if (un) un.textContent = data.unlocated ? ` · ${num(data.unlocated)} without a known country` : '';
    const note = out('note'); if (note) { note.textContent = data.note || ''; note.hidden = !data.note; }
    const list = out('list');
    if (list) list.replaceChildren(...data.countries.slice(0, 5).map(c => { const li = d.createElement('li'); const nm = d.createElement('span'); nm.textContent = c.name; const b = d.createElement('b'); b.textContent = num(c.n); li.append(nm, b); return li; }));
    root.dataset.hours = String(data.hours);
    const lab = out('label'); if (lab) lab.textContent = `${data.hours} hours`;
  }

  /** Fetch a window and animate to it. A newer request cancels an older one still in flight. */
  async function load(h) {
    if (ctl) ctl.abort();
    ctl = new AbortController();
    try {
      const r = await fetch(`${base}/geo.json?h=${h}`, { credentials: 'same-origin', cache: 'no-store', signal: ctl.signal });
      if (!r.ok) return;
      apply(await r.json());
    } catch { /* aborted or offline */ }
  }

  sel.addEventListener('change', () => { hours = Number(sel.value); load(hours); });   // dispatched at once, no debounce
  const poll = () => { if (!d.hidden && !live.paused) load(hours); };
  setInterval(poll, 10000);
  live.on(paused => { if (!paused) poll(); });

  // hover tooltip (event delegation: circles come and go)
  svg.addEventListener('pointermove', e => {
    const c = e.target.closest && e.target.closest('circle[data-c]');
    if (!c || !tip) { if (tip) tip.hidden = true; return; }
    const r = root.querySelector('.mapwrap').getBoundingClientRect();
    tip.textContent = `${c.dataset.name}: ${num(c.dataset.n)} visitor${Number(c.dataset.n) === 1 ? '' : 's'}`;
    tip.hidden = false;
    tip.style.left = `${Math.min(r.width - tip.offsetWidth - 4, Math.max(4, e.clientX - r.left + 10))}px`;
    tip.style.top = `${Math.max(2, e.clientY - r.top - 28)}px`;
  });
  svg.addEventListener('pointerleave', () => { if (tip) tip.hidden = true; });

  window.p360.map = { apply, load, bubbles, radius };
})();
