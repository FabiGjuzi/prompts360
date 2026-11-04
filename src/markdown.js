// Minimal, safe Markdown → HTML. Supports: paragraphs, line breaks, **bold**, *italic*, ~~strike~~,
// `code`, ``` fenced code ```, # headings, > quotes, - / 1. lists, --- rules, [links](https://…) and
// bare https:// links. Raw HTML is never passed through: every text run is escaped before formatting,
// and only http(s) links are emitted. All regexes use bounded, non-nested quantifiers (no ReDoS).
import { esc } from './html.js';

// Matches [label](https://url) (groups 1,2) or a bare https://url (group 3). Bounded quantifiers = no ReDoS.
const LINK_RE = /\[([^\]\n]{1,300})\]\((https?:\/\/[^\s()<>]{1,2000})\)|(https?:\/\/[^\s<>()"']{1,2000})/gi;
// rel attribute on every user link: no SEO value for spammers, no window.opener access, no referrer leak.
const REL = 'nofollow ugc noopener noreferrer';

/** Apply bold/italic/strikethrough to text that is ALREADY HTML-escaped. */
function emphasis(escaped) {
  return escaped
    .replace(/\*\*([^*\n]{1,1000})\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^\w*])\*([^*\s][^*\n]{0,999})\*(?![\w*])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_([^_\s][^_\n]{0,999})_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~([^~\n]{1,1000})~~/g, '<del>$1</del>');
}

/** Turn [label](https://…) and bare https:// URLs into rel=nofollow links; everything else is escaped. Only http(s) schemes are ever emitted. */
function links(text) {
  let out = '', last = 0, m;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text))) {
    out += emphasis(esc(text.slice(last, m.index)));
    let label = m[1], href = m[2] || m[3], trail = '';
    if (!m[2]) { // bare URL: don't swallow trailing punctuation
      const t = href.match(/[.,;:!?]+$/);
      if (t) { trail = t[0]; href = href.slice(0, -trail.length); }
      label = href;
    }
    out += `<a href="${esc(href)}" rel="${REL}">${esc(label)}</a>${esc(trail)}`;
    last = m.index + m[0].length;
  }
  return out + emphasis(esc(text.slice(last)));
}

/** Render one line of inline Markdown: `code` spans are escaped verbatim, the rest goes through links() and emphasis(). */
function inline(text) {
  const parts = text.split(/(`[^`\n]{1,1000}`)/g);
  return parts.map((p, i) => (i % 2 ? `<code>${esc(p.slice(1, -1))}</code>` : unescapeMd(links(hideEscapes(p))))).join('');
}

// Backslash escapes (\* \_ \# …) so the WYSIWYG editor can store literal punctuation. An escaped character is swapped for a
// private-use placeholder before any formatting runs, then restored (HTML-escaped) afterwards.
const ESC = '\\`*_~[]()#>+-.!';
const hideEscapes = s => s.replace(/[\uE000-\uE00F]/g, '').replace(/\\([\\`*_~\[\]()#>+\-.!])/g, (_, c) => String.fromCharCode(0xE000 + ESC.indexOf(c)));
const unescapeMd = s => s.replace(/[\uE000-\uE00F]/g, ch => esc(ESC[ch.charCodeAt(0) - 0xE000]));

/** Render a Markdown string to safe HTML (paragraphs, headings, quotes, lists, rules, code blocks). Raw HTML in the input is never passed through. */
export function markdown(src, { min = 3, off = 2 } = {}) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let para = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; } };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {                      // fenced code block
      flush();
      const buf = [];
      for (i++; i < lines.length && !/^\s*```\s*$/.test(lines[i]); i++) buf.push(lines[i]);
      out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flush(); continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.{1,300})$/))) {
      flush();
      const lvl = Math.min(6, Math.max(min, m[1].length + off));   // default: post title is h1, content headings start at h3
      out.push(`<h${lvl}>${inline(m[2])}</h${lvl}>`);
      continue;
    }
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); continue; }
    if (/^\s*>/.test(line)) {
      flush();
      const buf = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) buf.push(lines[i].replace(/^\s*>\s?/, ''));
      i--;
      out.push(`<blockquote>${buf.map(inline).join('<br>')}</blockquote>`);
      continue;
    }
    const ul = /^\s*[-*+]\s+/, ol = /^\s*\d{1,9}[.)]\s+/;
    if (ul.test(line) || ol.test(line)) {
      flush();
      const re = ul.test(line) ? ul : ol, tag = re === ul ? 'ul' : 'ol';
      const items = [];
      for (; i < lines.length && re.test(lines[i]); i++) items.push(`<li>${inline(lines[i].replace(re, ''))}</li>`);
      i--;
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }
    para.push(line);
  }
  flush();
  return out.join('\n');
}

/** Plain text of a Markdown string (formatting symbols removed, whitespace collapsed) — for meta descriptions and list previews. */
export function plain(body) {
  return String(body || '').replace(/```[\s\S]*?(?:```|$)/g, ' ').replace(/\[([^\]\n]*)\]\([^)\n]*\)/g, '$1').replace(/^[ \t]*(?:#{1,6}|>|[-*+]|\d{1,9}[.)])[ \t]+/gm, '')
    .replace(/\\([\\`*_~\[\]()#>+\-.!])/g, '$1').replace(/[*_~`]+/g, '').replace(/\s+/g, ' ').trim();
}
