// wys.js — server side of the WYSIWYG editor. The editor stores Markdown (so rendering stays one safe pipeline),
// and works without JavaScript: the <textarea> holds the Markdown; public/editor.js swaps it for a rich editor
// and fills it from the server-rendered HTML in .wys-src (moved with DOM calls — no innerHTML, Trusted Types safe).
import { html, raw } from './html.js';
import { markdown } from './markdown.js';

/** hlevel: heading element the "H" button inserts; hoff: markdown "#" count = heading level − hoff (posts: 3/2; CMS pages: 2/0). */
export function wys({ name, id, md = '', rows = 10, max = 40000, required = false, label = 'Text', hlevel = 3, hoff = 2 }) {
  return html`<div class="wys" data-hlevel="${hlevel}" data-hoff="${hoff}" data-label="${label}">
<textarea${id ? html` id="${id}"` : ''} name="${name}" rows="${rows}" maxlength="${max}"${required ? raw(' required') : ''}>${md}</textarea>
<div class="wys-src" hidden>${raw(markdown(md, { min: hlevel, off: hoff }))}</div></div>`;
}

/** True when rendered markup contains an editor (the page then loads editor.js / editor.css). */
export const hasEditor = s => String(s).includes('class="wys"');
