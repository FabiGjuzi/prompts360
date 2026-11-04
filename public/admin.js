// prompts360 dashboard — live numbers only (everything else works without JavaScript).
(() => {
  'use strict';
  const d = document;
  // Site design editor: live theme preview (CSS custom properties set through the CSSOM) and character counters.
  const prev = d.querySelectorAll('[data-tprev]');
  if (prev.length) {
    const val = (mode, v) => { const el = d.querySelector(`[data-var="${v}"][data-mode="${mode}"]`); return el ? el.value : ''; };
    const apply = () => {
      const font = d.querySelector('[data-font] option:checked')?.dataset.stack;
      const rb = d.querySelector('[data-shape] option:checked')?.dataset.radius;
      const num = k => d.querySelector(`[data-num="${k}"]`)?.value;
      for (const p of prev) {
        const mode = p.dataset.tprev;
        for (const v of ['bg', 'card', 'hl', 'tx', 'mu', 'bd', 'ac', 'ach', 'up', 'dn', 'er']) { const x = val(mode, v); if (x) p.style.setProperty('--' + v, x); }
        for (const v of ['btn', 'btnh']) { const x = val('light', v); if (x) p.style.setProperty('--' + v, x); }
        if (font) p.style.setProperty('--pfont', font);
        if (rb) p.style.setProperty('--rb', rb);
        if (num('r')) p.style.setProperty('--r', num('r') + 'px');
        if (num('fs')) p.style.setProperty('--pfs', num('fs') + 'px');
      }
    };
    d.querySelectorAll('[data-var],[data-font],[data-shape],[data-num]').forEach(el => el.addEventListener('input', apply));
    apply();
  }
  d.querySelectorAll('textarea[data-count]').forEach(t => {
    const out = t.closest('.fld')?.querySelector('[data-counter]');
    if (!out) return;
    const max = Number(t.dataset.count) || 0;
    const upd = () => { out.textContent = t.value.length.toLocaleString('en-US') + ' characters' + (max ? ' · max ' + max.toLocaleString('en-US') : ''); };
    t.addEventListener('input', upd); upd();
  });
  // Import page: load a chosen .csv/.json file into the textarea (read in the browser; nothing is sent until the form is submitted).
  d.querySelectorAll('input[type=file][data-fill]').forEach(inp => {
    const target = d.getElementById(inp.dataset.fill), note = d.getElementById(inp.id + '-note');
    if (!target) return;
    inp.addEventListener('change', async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      if (f.size > 3900000) { if (note) note.textContent = 'That file is larger than 3.9 MB. Split it into several files.'; return; }
      try { target.value = await f.text(); if (note) note.textContent = `Loaded ${f.name} (${f.size.toLocaleString('en-US')} bytes). Press Preview to check it.`; }
      catch { if (note) note.textContent = 'Could not read that file.'; }
    });
  });
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
