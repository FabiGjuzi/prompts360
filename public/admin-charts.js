// prompts360 dashboard — interactive, live charts.
// The server draws every chart as plain SVG (that is what you get without JavaScript). This script takes each <figure data-chart>
// over: click a legend entry to hide or show a series, switch between line and bars, hover (or use the arrow keys) for exact values,
// and watch the numbers ease into place whenever /charts.json brings new data. Nothing is parsed as HTML: every node is built with
// createElement / createElementNS and textContent, positions are set through the CSSOM, so the strict CSP and Trusted Types stay on.
(() => {
  'use strict';
  const P = window.p360;
  if (!P || !P.anim) return;
  const { tween, lerp } = P.anim, live = P.live, d = document, NS = 'http://www.w3.org/2000/svg';
  const W = 640, H = 180, L = 40, B = 20, T = 8, R = 8, IW = W - L - R, IH = H - T - B;
  const FEED_MS = 800, TOGGLE_MS = 380, MODE_MS = 520;

  const niceMax = v => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };
  const fmtAxis = v => (v >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${+(v / 1e3).toFixed(1)}k` : String(Math.round(v * 10) / 10));
  const nf = v => Number(v).toLocaleString('en-US', { maximumFractionDigits: 1 });
  const f1 = n => (Math.round(n * 10) / 10).toString();
  const clampY = y => Math.min(H - B, Math.max(T, y));
  const S = (tag, attrs) => { const e = d.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const E = (tag, cls, text) => { const e = d.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let uid = 0;

  /** Catmull-Rom spline through the points as one cubic-Bezier path (y kept inside the plot so it never overshoots the axis). */
  function smooth(pts) {
    if (!pts.length) return '';
    let s = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      s += `C${f1(p1[0] + (p2[0] - p0[0]) / 6)},${f1(clampY(p1[1] + (p2[1] - p0[1]) / 6))} ${f1(p2[0] - (p3[0] - p1[0]) / 6)},${f1(clampY(p2[1] - (p3[1] - p1[1]) / 6))} ${f1(p2[0])},${f1(p2[1])}`;
    }
    return s;
  }

  class Chart {
    constructor(fig, def) {
      this.fig = fig; this.def = def; this.id = ++uid;
      this.labels = def.labels.slice();
      this.stack = !!def.stack;
      this.series = def.series.map(s => ({ name: s.name, cls: s.cls, key: s.key, on: true, vis: 1, cur: s.values.map(Number), to: s.values.map(Number) }));
      this.mix = def.type === 'bar' ? 1 : 0;           // 0 = line view, 1 = bar view; animated in between
      this.max = niceMax(this.targetMax(this.mix >= 0.5));
      this.hover = -1;
      this.anim = null;
      this.build();
      this.draw();
    }
    get n() { return this.labels.length; }

    // ---- numbers ----
    targetMax(bars) {
      let m = 1;
      const on = this.series.filter(s => s.on);
      for (let i = 0; i < this.n; i++) {
        if (bars && this.stack) m = Math.max(m, on.reduce((a, s) => a + (s.to[i] || 0), 0));
        else for (const s of on) m = Math.max(m, s.to[i] || 0);
      }
      return niceMax(m);
    }

    // ---- DOM ----
    build() {
      const { fig } = this, def = this.def;
      const tools = E('div', 'ctools');
      const legend = E('div', 'clegend');
      legend.setAttribute('role', 'group'); legend.setAttribute('aria-label', 'Series (click to show or hide)');
      this.legendBtns = this.series.map((s, i) => {
        const b = E('button', `lg ${s.cls}`); b.type = 'button'; b.setAttribute('aria-pressed', 'true');
        b.append(E('span', 'sw'), d.createTextNode(s.name));
        b.addEventListener('click', () => this.toggleSeries(i));
        return b;
      });
      if (this.series.length > 1) legend.append(...this.legendBtns);   // a single series is already named by the card title
      const mode = E('div', 'cmode'); mode.setAttribute('role', 'group'); mode.setAttribute('aria-label', 'Chart type');
      this.modeBtns = [['line', 'Line'], ['bar', 'Bars']].map(([m, t]) => {
        const b = E('button', 'md', t); b.type = 'button'; b.setAttribute('aria-pressed', String((m === 'bar') === (this.mix >= 0.5)));
        b.addEventListener('click', () => this.setMode(m === 'bar' ? 1 : 0));
        return b;
      });
      mode.append(...this.modeBtns);
      tools.append(legend, mode);

      const svg = S('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', tabindex: '0', 'aria-label': `${def.label}. Arrow keys move through the values.` });
      const clip = S('clipPath', { id: `cc${this.id}` }); clip.append(S('rect', { x: L, y: T, width: IW, height: IH }));
      svg.append(S('defs', {})); svg.firstChild.append(clip);
      this.grid = [0, 1, 2].map(() => ({ line: S('line', { class: 'grid', x1: L, x2: W - R }), text: S('text', { class: 'ax', x: L - 4, 'text-anchor': 'end' }) }));
      this.grid.forEach(g => svg.append(g.line, g.text));
      this.xl = [S('text', { class: 'ax', 'text-anchor': 'start', y: H - 4 }), S('text', { class: 'ax', 'text-anchor': 'middle', y: H - 4 }), S('text', { class: 'ax', 'text-anchor': 'end', y: H - 4 })];
      svg.append(...this.xl);
      this.gBars = S('g', { 'clip-path': `url(#cc${this.id})` });
      this.gLines = S('g', { 'clip-path': `url(#cc${this.id})` });
      this.band = S('rect', { class: 'band', y: T, height: IH, visibility: 'hidden' });
      this.cross = S('line', { class: 'cross', y1: T, y2: H - B, visibility: 'hidden' });
      svg.append(this.gBars, this.band, this.gLines, this.cross);
      this.areas = this.series.map(s => S('path', { class: `ar ${s.cls}` }));
      this.paths = this.series.map(s => S('path', { class: `ln ${s.cls}`, fill: 'none' }));
      this.dots = this.series.map(s => S('circle', { class: `hd ${s.cls}`, r: 3.6, visibility: 'hidden' }));
      this.tips = this.series.map(s => S('circle', { class: `tip ${s.cls}`, r: 3 }));
      this.rings = this.series.map(s => S('circle', { class: `ring ${s.cls}`, r: 3 }));
      this.gLines.append(...this.areas, ...this.paths);
      svg.append(...this.dots);
      if (def.feed) this.gLines.append(...this.rings, ...this.tips);
      this.rects = [];
      this.svg = svg;

      this.tipBox = E('div', 'ctip'); this.tipBox.hidden = true;
      this.sr = E('span', 'visually-hidden'); this.sr.setAttribute('aria-live', 'polite');
      const wrap = E('div', 'cwrap'); wrap.append(svg, this.tipBox);
      fig.replaceChildren(tools, wrap, this.sr);
      fig.classList.add('live-chart');

      svg.addEventListener('pointermove', e => this.pointer(e));
      svg.addEventListener('pointerleave', () => this.setHover(-1));
      svg.addEventListener('keydown', e => this.key(e));
      svg.addEventListener('blur', () => this.setHover(-1));
      this.syncBars();
      this.setXLabels();
    }
    syncBars() {   // one <rect> per series per category; rebuilt when the number of categories changes
      const need = this.n;
      this.rects.forEach(row => row.forEach(r => r.remove()));
      this.rects = this.series.map(s => Array.from({ length: need }, () => { const r = S('rect', { class: s.cls }); this.gBars.append(r); return r; }));
    }
    setXLabels() {
      const n = this.n, idx = n ? [0, Math.floor((n - 1) / 2), n - 1] : [];
      this.xl.forEach((t, k) => { t.textContent = idx[k] != null && idx.indexOf(idx[k]) === k ? this.labels[idx[k]] : ''; });
      this.xlIdx = idx;
    }

    // ---- geometry ----
    xAt(i) { const n = this.n; return L + (n <= 1 ? IW / 2 : (i * IW) / (n - 1)); }
    yAt(v) { return T + IH * (1 - v / this.max); }
    draw() {
      const n = this.n, mix = this.mix, max = this.max;
      this.grid.forEach((g, k) => { const f = k / 2, y = this.yAt(max * f); g.line.setAttribute('y1', f1(y)); g.line.setAttribute('y2', f1(y)); g.text.setAttribute('y', f1(y + 3)); g.text.textContent = fmtAxis(max * f) + (this.def.unit || ''); });
      this.xl.forEach((t, k) => { const i = this.xlIdx[k]; if (i != null) t.setAttribute('x', f1(mix >= 0.5 ? L + (i + 0.5) * (IW / n) : this.xAt(i))); });
      this.gLines.setAttribute('opacity', String(Math.round((1 - mix) * 100) / 100));
      this.gBars.setAttribute('opacity', String(Math.round(mix * 100) / 100));
      const baseY = H - B;
      this.series.forEach((s, si) => {
        const pts = [];
        for (let i = 0; i < n; i++) pts.push([this.xAt(i), this.yAt(s.cur[i] || 0)]);
        const dd = smooth(pts);
        this.paths[si].setAttribute('d', dd);
        this.paths[si].setAttribute('opacity', String(Math.round(s.vis * 100) / 100));
        this.areas[si].setAttribute('d', pts.length > 1 ? `${dd}L${f1(pts.at(-1)[0])},${baseY}L${f1(pts[0][0])},${baseY}Z` : '');
        this.areas[si].setAttribute('opacity', String(Math.round(s.vis * 100) / 100));
        const last = pts.at(-1);
        if (last && this.def.feed) for (const c of [this.tips[si], this.rings[si]]) { c.setAttribute('cx', f1(last[0])); c.setAttribute('cy', f1(last[1])); c.setAttribute('opacity', String(Math.round(s.vis * 100) / 100)); }
      });
      // bars
      const bw = IW / Math.max(1, n), m = this.series.length;
      for (let i = 0; i < n; i++) {
        let base = 0;
        this.series.forEach((s, si) => {
          const v = (s.cur[i] || 0) * s.vis, r = this.rects[si][i];
          if (!r) return;
          let x, w, y, h;
          if (this.stack) { x = L + i * bw + bw * 0.12; w = bw * 0.76; h = IH * (v / max); y = this.yAt(base + v); base += v; }
          else { w = (bw * 0.76) / m; x = L + i * bw + bw * 0.12 + si * w; h = IH * (v / max); y = H - B - h; }
          r.setAttribute('x', f1(x)); r.setAttribute('width', f1(Math.max(0, w - (this.stack ? 0 : 1)))); r.setAttribute('y', f1(y)); r.setAttribute('height', f1(Math.max(0, h)));
        });
      }
      if (this.hover >= 0) this.placeHover();
    }

    // ---- animation ----
    run(ms) {
      // Start from exactly what is on screen right now (so a click in the middle of an animation continues smoothly).
      const from = { cur: this.series.map(s => s.cur.slice()), vis: this.series.map(s => s.vis), mix: this.mix, max: this.max };
      const to = { vis: this.series.map(s => (s.on ? 1 : 0)), mix: this.mixTarget, max: this.targetMax(this.mixTarget >= 0.5) };
      for (const [k, s] of this.series.entries()) while (from.cur[k].length < s.to.length) from.cur[k].push(s.to[from.cur[k].length]);   // new points start where they will end
      if (this.anim) this.anim.cancel();
      this.anim = tween(ms, p => {
        this.series.forEach((s, k) => {
          s.vis = lerp(from.vis[k], to.vis[k], p);
          const out = new Array(s.to.length);
          for (let i = 0; i < out.length; i++) out[i] = lerp(from.cur[k][i] == null ? s.to[i] : from.cur[k][i], s.to[i], p);
          s.cur = out;
        });
        this.mix = lerp(from.mix, to.mix, p); this.max = lerp(from.max, to.max, p);
        this.draw();
      }, () => { this.anim = null; });
    }
    toggleSeries(i) {
      const s = this.series[i];
      if (s.on && this.series.filter(x => x.on).length === 1) return;     // never hide the last visible series
      s.on = !s.on;
      this.legendBtns[i].setAttribute('aria-pressed', String(s.on));
      this.mixTarget = this.mix >= 0.5 ? 1 : 0;
      this.run(TOGGLE_MS);
    }
    setMode(mix) {
      this.mixTarget = mix;
      this.modeBtns.forEach((b, k) => b.setAttribute('aria-pressed', String((k === 1) === (mix === 1))));
      this.run(MODE_MS);
    }
    /** New data from /charts.json: eases the lines and bars to the new values. */
    feed(set) {
      if (!set || !Array.isArray(set.labels)) return;
      const sameLen = set.labels.length === this.n;
      this.labels = set.labels.slice();
      for (const s of this.series) {
        if (s.key && Array.isArray(set[s.key])) { s.to = set[s.key].map(Number); if (s.cur.length !== s.to.length) s.cur = s.to.map((v, i) => (s.cur[i] != null ? s.cur[i] : v)); }
      }
      if (!sameLen) this.syncBars();
      this.setXLabels();
      this.mixTarget = this.mix >= 0.5 ? 1 : 0;
      this.run(FEED_MS);
      if (this.hover >= this.n) this.setHover(-1); else if (this.hover >= 0) this.showTip();
    }

    // ---- hover, tooltip, keyboard ----
    pointer(e) {
      const r = this.svg.getBoundingClientRect(); if (!r.width) return;
      const x = ((e.clientX - r.left) / r.width) * W, n = this.n; if (!n) return;
      const i = this.mix >= 0.5 ? Math.floor((x - L) / (IW / n)) : Math.round(((x - L) / IW) * (n - 1));
      this.setHover(x < L - 2 || x > W - R + 2 ? -1 : Math.max(0, Math.min(n - 1, i)));
    }
    key(e) {
      const n = this.n; if (!n) return;
      let i = this.hover;
      if (e.key === 'ArrowRight') i = i < 0 ? 0 : Math.min(n - 1, i + 1);
      else if (e.key === 'ArrowLeft') i = i < 0 ? n - 1 : Math.max(0, i - 1);
      else if (e.key === 'Home') i = 0; else if (e.key === 'End') i = n - 1;
      else if (e.key === 'Escape') i = -1; else return;
      e.preventDefault(); this.setHover(i, true);
    }
    setHover(i, speak) {
      this.hover = i;
      const vis = i >= 0 ? 'visible' : 'hidden';
      this.cross.setAttribute('visibility', this.mix < 0.5 ? vis : 'hidden');
      this.band.setAttribute('visibility', this.mix >= 0.5 ? vis : 'hidden');
      this.dots.forEach(c => c.setAttribute('visibility', this.mix < 0.5 ? vis : 'hidden'));
      this.tipBox.hidden = i < 0;
      if (i >= 0) { this.showTip(speak); this.placeHover(); }
    }
    showTip(speak) {
      const i = this.hover; if (i < 0) return;
      const rows = this.series.filter(s => s.on).map(s => ({ s, v: s.to[i] }));
      const head = E('div', 'th', this.labels[i]);
      const body = rows.map(({ s, v }) => { const r = E('div', 'tr'); r.append(E('span', `sw ${s.cls}`), E('span', 'tn', s.name), E('b', null, nf(v) + (this.def.unit || ''))); return r; });
      this.tipBox.replaceChildren(head, ...body);
      if (speak) this.sr.textContent = `${this.labels[i]}: ${rows.map(({ s, v }) => `${s.name} ${nf(v)}`).join(', ')}`;
    }
    placeHover() {
      const i = this.hover, n = this.n; if (i < 0 || i >= n) return;
      const bars = this.mix >= 0.5, bw = IW / n, cx = bars ? L + (i + 0.5) * bw : this.xAt(i);
      this.cross.setAttribute('x1', f1(cx)); this.cross.setAttribute('x2', f1(cx));
      this.band.setAttribute('x', f1(L + i * bw)); this.band.setAttribute('width', f1(bw));
      this.series.forEach((s, k) => { this.dots[k].setAttribute('cx', f1(this.xAt(i))); this.dots[k].setAttribute('cy', f1(this.yAt(s.cur[i] || 0))); this.dots[k].setAttribute('opacity', String(s.vis)); });
      const r = this.svg.getBoundingClientRect(), px = (cx / W) * r.width, tb = this.tipBox, tw = tb.offsetWidth || 120;
      tb.style.left = `${Math.max(2, Math.min(r.width - tw - 2, px + 12 + (px + 12 + tw > r.width ? -tw - 24 : 0)))}px`;
      tb.style.top = '4px';
    }
  }

  // ---- start every chart on the page ----
  const charts = [];
  for (const fig of d.querySelectorAll('figure[data-chart]')) {
    try { charts.push(new Chart(fig, JSON.parse(fig.dataset.chart))); } catch { /* leave the static SVG in place */ }
  }
  if (!charts.length) return;
  window.p360.charts = charts;

  const base = d.body.dataset.base;
  let busy = false;
  const poll = async () => {
    if (d.hidden || live.paused || busy || !charts.some(c => c.def.feed)) return;
    busy = true;
    try {
      const r = await fetch(`${base}/charts.json`, { credentials: 'same-origin', cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      for (const c of charts) if (c.def.feed && j[c.def.feed]) c.feed(j[c.def.feed]);
      live.stamp(j.now);
    } catch { /* offline: next tick */ } finally { busy = false; }
  };
  window.p360.pollCharts = poll;
  setInterval(poll, 5000);
  d.addEventListener('visibilitychange', () => { if (!d.hidden) poll(); });
  live.on(paused => { if (!paused) poll(); });
})();
