// csv.js — a small, strict CSV reader/writer (RFC 4180) with no dependencies.
//
// parse():     BOM, CRLF/LF, quoted fields with commas / newlines / "" escapes, auto-detected delimiter (, ; or tab).
// stringify(): quotes only when needed; protects spreadsheet users from formula injection by prefixing risky cells with '.
// unprotect(): undoes that prefix when a file is read back (only for the exact characters the writer protects).

const RISKY = /^[=+\-@\t\r]/;

/** Guess the delimiter from the first line (outside quotes): whichever of , ; tab is most common. */
function detectDelimiter(text) {
  let inQ = false; const n = { ',': 0, ';': 0, '\t': 0 };
  for (let i = 0; i < text.length && i < 20000; i++) {
    const ch = text[i];
    if (ch === '"') inQ = !inQ;
    else if (!inQ) { if (ch === '\n') break; if (ch in n) n[ch]++; }
  }
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0][1] ? Object.entries(n).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

/** Parse CSV text into an array of rows (arrays of strings). Throws Error with a readable message on malformed quoting. */
export function parse(text, { maxRows = 100_000 } = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const d = detectDelimiter(text);
  const rows = []; let row = [], field = '', inQ = false, i = 0, line = 1, started = false;
  const endField = () => { row.push(field); field = ''; started = false; };
  const endRow = () => { endField(); if (!(row.length === 1 && row[0] === '')) rows.push(row); row = []; if (rows.length > maxRows) throw new Error(`Too many rows (max ${maxRows}).`); };
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      if (ch === '\n') line++;
      field += ch; i++; continue;
    }
    if (ch === '"') {
      if (field !== '' || started) throw new Error(`Line ${line}: a quote in the middle of a field. Wrap the whole field in quotes and double any quotes inside it.`);
      inQ = true; started = true; i++; continue;
    }
    if (ch === d) { endField(); i++; continue; }
    if (ch === '\r') { if (text[i + 1] === '\n') i++; endRow(); line++; i++; continue; }
    if (ch === '\n') { endRow(); line++; i++; continue; }
    field += ch; started = true; i++;
  }
  if (inQ) throw new Error('A quoted field is never closed (a " is missing).');
  if (field !== '' || row.length) endRow();
  return rows;
}

/** Parse into objects keyed by lower-cased, trimmed header names. Returns { headers, records } where each record has a `_line` number. */
export function parseObjects(text, opts) {
  const rows = parse(text, opts);
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map(h => h.trim().toLowerCase().replace(/^﻿/, ''));
  const records = rows.slice(1).map((r, i) => {
    const o = { _line: i + 2 };
    headers.forEach((h, j) => { if (h && !(h in o)) o[h] = (r[j] ?? ''); });
    return o;
  }).filter(o => headers.some(h => h && String(o[h] ?? '').trim() !== ''));
  return { headers, records };
}

/** Remove the protective ' that stringify() adds before = + - @ tab CR. Other leading apostrophes are left alone. */
export const unprotect = s => (typeof s === 'string' && s[0] === "'" && RISKY.test(s.slice(1)) ? s.slice(1) : s);

function cell(v, protect) {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (protect && RISKY.test(s) && typeof v !== 'number' && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build CSV text (CRLF line ends, UTF-8 BOM so Excel detects the encoding). rows: arrays; header: array of names. */
export function stringify(header, rows, { protect = true, bom = true } = {}) {
  const lines = [header.map(h => cell(h, false)).join(',')];
  for (const r of rows) lines.push(r.map(v => cell(v, protect)).join(','));
  return `${bom ? '﻿' : ''}${lines.join('\r\n')}\r\n`;
}
