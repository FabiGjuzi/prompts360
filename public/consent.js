// prompts360 — cookie choice + Google Analytics / AdSense loader. Present on a page only when an ID is set under Dashboard -> Connections.
// Nothing is requested from Google until the visitor presses Accept. The choice is kept in localStorage (not a cookie, so cached pages stay cached).
(() => {
  'use strict';
  const d = document, KEY = 'p360-consent';
  const meta = n => d.querySelector(`meta[name="${n}"]`)?.content || '';
  const GA = meta('p360-ga'), ADS = meta('p360-ads');
  if ((!GA && !ADS) || (GA && !/^G-[A-Z0-9]{4,20}$/.test(GA)) || (ADS && !/^pub-\d{16}$/.test(ADS))) return;

  const get = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
  const set = v => { try { localStorage.setItem(KEY, v); } catch {} };

  // Trusted Types: the page forbids unchecked script URLs; this policy allows exactly the two Google script URLs for the IDs above.
  const allowed = new Set();
  if (GA) allowed.add(`https://www.googletagmanager.com/gtag/js?id=${GA}`);
  if (ADS) allowed.add(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${ADS}`);
  let policy = null;
  if (window.trustedTypes?.createPolicy) {
    try { policy = trustedTypes.createPolicy('p360-google', { createScriptURL: u => { if (!allowed.has(u)) throw new TypeError('script URL not allowed'); return u; } }); } catch {}
  }
  const load = url => {
    if (!allowed.has(url) || d.querySelector(`script[data-p360-src="${url}"]`)) return;
    const s = d.createElement('script');
    s.async = true;
    s.dataset.p360Src = url;
    if (window.trustedTypes?.createPolicy && !policy) return;
    s.src = policy ? policy.createScriptURL(url) : url;
    if (url.includes('adsbygoogle')) s.crossOrigin = 'anonymous';
    d.head.appendChild(s);
  };

  const start = () => {
    if (GA) {
      window.dataLayer = window.dataLayer || [];
      window.gtag = function () { window.dataLayer.push(arguments); };
      gtag('consent', 'default', { ad_storage: ADS ? 'granted' : 'denied', ad_user_data: ADS ? 'granted' : 'denied', ad_personalization: ADS ? 'granted' : 'denied', analytics_storage: 'granted' });
      gtag('js', new Date());
      gtag('config', GA, { allow_google_signals: false, allow_ad_personalization_signals: false });
      load(`https://www.googletagmanager.com/gtag/js?id=${GA}`);
    }
    if (ADS) load(`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-${ADS}`);
  };

  const bar = () => {
    d.getElementById('p360-consent')?.remove();
    const b = d.createElement('div');
    b.id = 'p360-consent'; b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Cookie choice');
    const p = d.createElement('p');
    p.textContent = `We would like to use ${GA && ADS ? 'analytics and advertising' : GA ? 'analytics' : 'advertising'} cookies from Google. Nothing is loaded unless you accept, and you can change your mind at any time from the footer.`;
    const a = d.createElement('a'); a.href = '/privacy'; a.textContent = 'Privacy';
    const row = d.createElement('div');
    const mk = (label, val) => { const x = d.createElement('button'); x.type = 'button'; x.className = 'btn'; x.textContent = label; x.addEventListener('click', () => { const was = get(); set(val); b.remove(); if (val === 'yes') start(); else if (was === 'yes') location.reload(); }); return x; };
    row.append(mk('Reject', 'no'), mk('Accept', 'yes'));
    b.append(p, a, row);
    d.body.appendChild(b);
    b.querySelector('button').focus({ preventScroll: true });
  };

  const choice = get();
  if (choice === 'yes') start();
  else if (choice !== 'no') bar();
  // A permanent way to change the choice.
  const foot = d.querySelector('footer nav');
  if (foot) {
    const l = d.createElement('a'); l.href = '#cookies'; l.textContent = 'Cookie choices';
    l.addEventListener('click', e => { e.preventDefault(); bar(); });
    foot.appendChild(l);
  }
})();
