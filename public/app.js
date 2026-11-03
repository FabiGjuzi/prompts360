// prompts360 — progressive enhancement only; every action also works with JavaScript disabled.
(() => {
  'use strict';
  const d = document;

  // Votes without a page reload.
  d.addEventListener('submit', async e => {
    const f = e.target;
    if (!f.classList.contains('v')) return;
    e.preventDefault();
    const box = f.parentNode;
    try {
      const r = await fetch(f.action, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-requested-with': 'fetch' },
        body: new URLSearchParams(new FormData(f)),
        credentials: 'same-origin',
      });
      if (r.status === 401) { location.href = '/login'; return; }
      if (!r.ok) return;
      const j = await r.json();
      box.dataset.v = j.vote;
      box.querySelector('b').textContent = j.score;
      for (const form of box.querySelectorAll('form.v')) {
        const btn = form.querySelector('button'), dir = btn.classList.contains('up') ? 1 : -1;
        const on = j.vote === dir;
        btn.classList.toggle('on', on);
        btn.setAttribute('aria-pressed', on);
        form.querySelector('[name=dir]').value = on ? 0 : dir;
      }
    } catch {}
  });

  // Collapse / expand comment threads.
  d.addEventListener('click', e => {
    const t = e.target;
    if (!t.classList.contains('tog')) return;
    const li = t.closest('.cm');
    li.classList.toggle('shut');
    t.textContent = li.classList.contains('shut') ? '[+]' : '[–]';
  });

  // Live password rules + match check (server enforces the same rules).
  const f = d.getElementById('signup');
  if (f) {
    const p1 = f.querySelector('[name=password]'), p2 = f.querySelector('[name=password2]'), h = d.getElementById('pwhint');
    const check = () => {
      const v = p1.value, miss = [];
      if (v.length < 12) miss.push('12+ characters');
      if (!/\p{Lu}/u.test(v)) miss.push('an uppercase letter');
      if (!/\d/.test(v)) miss.push('a number');
      let msg = miss.length ? `Needs ${miss.join(', ')}.` : 'Password looks good.';
      if (!miss.length && p2.value && p2.value !== v) msg = 'Passwords don’t match.';
      h.textContent = msg;
      h.className = 'hint ' + (miss.length || (p2.value && p2.value !== v) ? 'bad' : 'good');
      p2.setCustomValidity(p2.value && p2.value !== v ? 'Passwords don’t match' : '');
    };
    p1.addEventListener('input', check);
    p2.addEventListener('input', check);
  }
})();
