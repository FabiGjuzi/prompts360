// editor.js — WYSIWYG editor for Markdown fields. Without JavaScript the <textarea> is shown instead.
// Safety: no innerHTML anywhere (Trusted Types), pasted/dropped HTML is discarded (plain text only), and the field submitted to
// the server is Markdown produced by walking the DOM and keeping only a fixed set of elements; the server re-renders it safely.
(() => {
  const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'HR', 'TABLE', 'SECTION', 'ARTICLE']);

  // ---------- DOM -> Markdown ----------
  const escText = s => s.replace(/\u00a0/g, ' ').replace(/\s*\n\s*/g, ' ').replace(/([\\`*_~[\]()])/g, '\\$1');
  const lineStart = s => s.replace(/^(\s*)([#>+-])/, '$1\\$2').replace(/^(\s*\d{1,9})([.)])/, '$1\\$2');
  const wrap = (mark, s) => {
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    return m[2] ? m[1] + mark + m[2] + mark + m[3] : s;
  };
  const inlineOf = (node) => {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { out += escText(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (tag === 'BR') { out += '\n'; continue; }
      if (tag === 'CODE') { const c = n.textContent.replace(/[`\n]/g, ' '); out += c.trim() ? '`' + c + '`' : ''; continue; }
      const inner = inlineOf(n);
      if (tag === 'STRONG' || tag === 'B') out += wrap('**', inner);
      else if (tag === 'EM' || tag === 'I') out += wrap('*', inner);
      else if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') out += wrap('~~', inner);
      else if (tag === 'A') {
        const href = n.getAttribute('href') || '';
        out += /^https?:\/\/[^\s()<>]{1,2000}$/i.test(href) && inner.trim() ? '[' + inner.trim().replace(/\n/g, ' ') + '](' + href + ')' : inner;
      } else if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      else out += inner;
    }
    return out;
  };
  const blockOf = (node, hoff) => {
    const out = [];
    let run = '';
    const flush = () => { const t = run.replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim(); if (t) out.push(lineStart(t).replace(/\n(?=[#>+-]|\d{1,9}[.)])/g, '\n\\')); run = ''; };
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { run += escText(n.nodeValue); continue; }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (!BLOCK.has(tag)) { run += tag === 'BR' ? '\n' : inlineOf({ childNodes: [n] }); continue; }
      flush();
      if (tag === 'HR') out.push('---');
      else if (/^H[1-6]$/.test(tag)) { const t = inlineOf(n).replace(/\s+/g, ' ').trim(); if (t) out.push('#'.repeat(Math.max(1, Math.min(6, Number(tag[1]) - hoff))) + ' ' + t); }
      else if (tag === 'PRE') { const c = n.textContent.replace(/\n$/, ''); out.push('```\n' + c.replace(/^```/gm, '` ``') + '\n```'); }
      else if (tag === 'UL' || tag === 'OL') {
        const items = [];
        const walk = (list, ordered) => {
          let i = 0;
          for (const li of list.children) {
            if (li.tagName !== 'LI') continue;
            const own = document.createElement('div');
            for (const c of li.childNodes) if (!(c.nodeType === 1 && (c.tagName === 'UL' || c.tagName === 'OL'))) own.appendChild(c.cloneNode(true));
            const t = inlineOf(own).replace(/\s*\n\s*/g, ' ').trim();
            i++;
            if (t) items.push((ordered ? i + '. ' : '- ') + t);
            for (const c of li.children) if (c.tagName === 'UL' || c.tagName === 'OL') walk(c, c.tagName === 'OL');
          }
        };
        walk(n, tag === 'OL');
        if (items.length) out.push(items.join('\n'));
      } else if (tag === 'BLOCKQUOTE') {
        const t = blockOf(n, hoff).join('\n').trim();
        if (t) out.push(t.split('\n').map(l => '> ' + l).join('\n'));
      } else if (tag === 'LI') { const t = inlineOf(n).trim(); if (t) out.push('- ' + t); }
      else out.push(...blockOf(n, hoff));
    }
    flush();
    return out;
  };
  const toMarkdown = (root, hoff) => blockOf(root, hoff).join('\n\n');

  // ---------- Editor ----------
  const BUTTONS = [
    ['bold', 'B', 'Bold', 'b'], ['italic', 'I', 'Italic', 'i'], ['strike', 'S', 'Strikethrough'],
    ['code', '</>', 'Inline code'], ['h', 'H', 'Heading'], ['quote', '❝', 'Quote'],
    ['ul', '• List', 'Bulleted list'], ['ol', '1. List', 'Numbered list'], ['pre', '{ }', 'Code block'],
    ['link', 'Link', 'Insert link'], ['hr', '―', 'Divider'], ['clear', 'Tx', 'Clear formatting'],
  ];
  const exec = (cmd, val) => document.execCommand(cmd, false, val);

  function inlineCode(area) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !area.contains(sel.anchorNode)) return;
    const r = sel.getRangeAt(0);
    const code = document.createElement('code');
    code.appendChild(r.extractContents());
    r.insertNode(code);
    sel.removeAllRanges();
    const nr = document.createRange(); nr.selectNodeContents(code); sel.addRange(nr);
  }
  function toggleBlock(tag) {
    const sel = window.getSelection();
    let n = sel.anchorNode;
    while (n && n.nodeType !== 1) n = n.parentNode;
    const inside = n && n.closest(tag.toLowerCase());
    exec('formatBlock', inside ? 'P' : tag);
  }
  function link(area) {
    const url = window.prompt('Link address (https://…)', 'https://');
    if (!url) return;
    if (!/^https?:\/\/\S+$/i.test(url.trim())) { window.alert('Links must start with http:// or https://'); return; }
    const sel = window.getSelection();
    if (sel.isCollapsed) { const a = document.createElement('a'); a.setAttribute('href', url.trim()); a.textContent = url.trim(); const r = sel.getRangeAt(0); r.insertNode(a); r.setStartAfter(a); r.collapse(true); }
    else exec('createLink', url.trim());
  }

  function enhance(box) {
    const ta = box.querySelector('textarea');
    const src = box.querySelector('.wys-src');
    if (!ta || !src || box.dataset.ready) return;
    box.dataset.ready = '1';
    const hlevel = Number(box.dataset.hlevel) || 3, hoff = Number(box.dataset.hoff) || 0;
    const required = ta.required, max = Number(ta.maxLength) || 40000;
    ta.required = false;

    const bar = document.createElement('div');
    bar.className = 'wys-bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Formatting');
    const area = document.createElement('div');
    area.className = 'wys-area'; area.contentEditable = 'true';
    area.setAttribute('role', 'textbox'); area.setAttribute('aria-multiline', 'true'); area.setAttribute('aria-label', box.dataset.label || 'Text');
    area.setAttribute('spellcheck', 'true');
    while (src.firstChild) area.appendChild(src.firstChild);
    src.remove();

    const run = (id) => {
      area.focus();
      if (id === 'bold') exec('bold');
      else if (id === 'italic') exec('italic');
      else if (id === 'strike') exec('strikeThrough');
      else if (id === 'code') inlineCode(area);
      else if (id === 'h') toggleBlock('H' + hlevel);
      else if (id === 'quote') toggleBlock('BLOCKQUOTE');
      else if (id === 'ul') exec('insertUnorderedList');
      else if (id === 'ol') exec('insertOrderedList');
      else if (id === 'pre') toggleBlock('PRE');
      else if (id === 'link') link(area);
      else if (id === 'hr') exec('insertHorizontalRule');
      else if (id === 'clear') { exec('removeFormat'); exec('formatBlock', 'P'); }
      sync();
    };
    const compact = box.dataset.compact === '1';                       // comments: bold, italic, quote and lists only
    for (const [id, text, title] of BUTTONS.filter(b => !compact || ['bold', 'italic', 'quote', 'ul', 'ol'].includes(b[0]))) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = text; b.title = title; b.setAttribute('aria-label', title); b.className = 'wys-btn wys-' + id;
      b.addEventListener('mousedown', e => e.preventDefault());   // keep the selection in the editor
      b.addEventListener('click', () => run(id));
      bar.appendChild(b);
    }
    const count = document.createElement('span'); count.className = 'wys-count'; count.setAttribute('aria-live', 'off');
    bar.appendChild(count);

    const sync = () => {
      const md = toMarkdown(area, hoff);
      ta.value = md;
      count.textContent = md.length + ' / ' + max;
      count.classList.toggle('over', md.length > max);
      return md;
    };
    area.addEventListener('input', sync);
    area.addEventListener('focus', () => { try { exec('defaultParagraphSeparator', 'p'); } catch (e) { /* older browsers */ } });
    area.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const k = e.key.toLowerCase();
        if (k === 'b') { e.preventDefault(); run('bold'); }
        else if (k === 'i') { e.preventDefault(); run('italic'); }
        else if (k === 'k' && !compact) { e.preventDefault(); run('link'); }
      }
    });
    area.addEventListener('paste', e => {                            // plain text only: pasted HTML is never inserted
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text/plain');
      if (text) exec('insertText', text.replace(/\r\n?/g, '\n'));
      sync();
    });
    area.addEventListener('drop', e => e.preventDefault());
    const form = ta.form;
    if (form) form.addEventListener('submit', e => {
      const md = sync();
      if (required && !md) { e.preventDefault(); area.focus(); area.classList.add('bad'); }
    });
    ta.hidden = true;
    box.insertBefore(bar, ta);
    box.insertBefore(area, ta);
    sync();
    box.classList.add('on');
  }

  // Editors inside a closed <details> (reply / edit forms: there can be hundreds on a busy post) are built only when opened.
  const start = () => document.querySelectorAll('.wys').forEach(box => {
    const d = box.closest('details');
    if (d && !d.open) d.addEventListener('toggle', () => { if (d.open) enhance(box); }, { once: false });
    else enhance(box);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // <details> forms (edit post) are in the DOM from the start, so nothing else to do; expose for tests/dashboard re-use.
  window.p360Editor = { toMarkdown, enhance };
})();
