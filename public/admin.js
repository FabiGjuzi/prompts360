// prompts360 dashboard — live numbers only (everything else works without JavaScript).
(() => {
  'use strict';
  const d = document;
  const live = d.querySelector('[data-live]');
  if (!live) return;
  const base = d.body.dataset.base;
  const ms = n => (n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${Math.round(n * 10) / 10} ms`);
  // Replace the rows of a <tbody> using only textContent (no HTML is ever parsed).
  const fill = (id, rows, classes) => {
    const body = d.getElementById(id);
    if (!body) return;
    body.replaceChildren(...rows.map(cells => {
      const tr = d.createElement('tr');
      cells.forEach((c, i) => { const td = d.createElement('td'); if (classes[i]) td.className = classes[i]; td.textContent = c; tr.append(td); });
      return tr;
    }));
  };
  const refresh = async () => {
    if (d.hidden) return;
    try {
      const r = await fetch(`${base}/live.json`, { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      for (const el of d.querySelectorAll('[data-k]')) if (el.dataset.k in j) el.textContent = j[el.dataset.k];
      fill('live-pages', j.topPages, ['', 'num']);
      fill('live-recent', j.recent.map(x => [new Date(x.t).toISOString().slice(11, 19), x.m, x.p + (x.bot ? ' 🤖' : ''), x.s, ms(x.ms), x.r]), ['', '', '', 'num', 'num', '']);
    } catch { /* offline: try again on the next tick */ }
  };
  setInterval(refresh, 4000);
})();
