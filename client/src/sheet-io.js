// Small, dependency-free Excel (.xlsx) and CSV reader / writer for Data Migration.
// Writing: a stored (uncompressed) zip with one or more worksheets, bold header row,
// frozen first row, column widths and an optional fill for required columns.
// Reading: unzips with the browser's DecompressionStream and reads every sheet.

// ---------- CSV ----------
export function toCsv(rows) {
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}`;
}
export function parseCsv(text) {
  const src = text.replace(/^﻿/, '');
  const delim = (() => { const first = src.split(/\r?\n/, 1)[0] || ''; const counts = [',', ';', '\t'].map((d) => [d, first.split(d).length]); counts.sort((a, b) => b[1] - a[1]); return counts[0][1] > 1 ? counts[0][0] : ','; })();
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') { if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i += 1; row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

// ---------- zip helpers ----------
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i += 1) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function zipStore(files) {
  const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
  for (const [name, text] of files) {
    const data = enc.encode(text); const nameBytes = enc.encode(name); const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(8, 0, true); local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, nameBytes.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
async function unzip(buffer) {
  const view = new DataView(buffer); const bytes = new Uint8Array(buffer); const dec = new TextDecoder();
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This is not a valid Excel (.xlsx) file.');
  const count = view.getUint16(eocd + 10, true); let p = view.getUint32(eocd + 16, true);
  const out = {};
  for (let k = 0; k < count; k += 1) {
    const method = view.getUint16(p + 10, true); const csize = view.getUint32(p + 20, true);
    const nlen = view.getUint16(p + 28, true); const elen = view.getUint16(p + 30, true); const clen = view.getUint16(p + 32, true); const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nlen));
    const lstart = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    out[name] = { method, data: bytes.subarray(lstart, lstart + csize) };
    p += 46 + nlen + elen + clen;
  }
  return {
    async text(name) {
      const entry = out[name] || out[Object.keys(out).find((key) => key.toLowerCase() === name.toLowerCase())];
      if (!entry) return null;
      if (entry.method === 0) return dec.decode(entry.data);
      if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed Excel files — save the sheet as CSV and upload that.');
      const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return dec.decode(await new Response(stream).arrayBuffer());
    },
  };
}

// ---------- XLSX write ----------
const xml = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const colName = (i) => { let s = ''; let n = i + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
// sheets: [{ name, rows: [[...]], required?: Set(colIndex), widths?: [] , note?: true }]
export function toXlsx(sheets) {
  const sheetXml = (sheet) => {
    const widths = sheet.widths || (sheet.rows[0] || []).map((_, i) => Math.min(Math.max(...sheet.rows.slice(0, 200).map((r) => String(r[i] ?? '').length), 8) + 2, 60));
    const body = sheet.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
      const ref = `${colName(ci)}${ri + 1}`;
      const style = ri === 0 && !sheet.plain ? (sheet.required?.has(ci) ? ' s="2"' : ' s="1"') : '';
      if (v === '' || v == null) return style ? `<c r="${ref}"${style}/>` : '';
      if (typeof v === 'number' && Number.isFinite(v)) return `<c r="${ref}"${style}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    }).join('')}</row>`).join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${sheet.plain ? '' : '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'}<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData></worksheet>`;
  };
  const names = sheets.map((s, i) => xml(String(s.name || `Sheet${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)));
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8EEFF"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFE4B5"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" fillId="2" applyFont="1" applyFill="1"/><xf fontId="1" fillId="3" applyFont="1" applyFill="1"/></cellXfs></styleSheet>'],
    ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)]),
  ];
  return zipStore(files);
}

// ---------- XLSX read ----------
const tagText = (node, tag) => [...node.getElementsByTagName(tag)].map((n) => n.textContent).join('');
export async function readXlsx(buffer) {
  const zip = await unzip(buffer);
  const parser = new DOMParser();
  const doc = (text) => (text ? parser.parseFromString(text, 'application/xml') : null);
  const wb = doc(await zip.text('xl/workbook.xml'));
  if (!wb) throw new Error('This Excel file has no workbook.');
  const rels = doc(await zip.text('xl/_rels/workbook.xml.rels'));
  const target = {};
  for (const r of rels ? [...rels.getElementsByTagName('Relationship')] : []) target[r.getAttribute('Id')] = r.getAttribute('Target');
  const sharedDoc = doc(await zip.text('xl/sharedStrings.xml'));
  const shared = sharedDoc ? [...sharedDoc.getElementsByTagName('si')].map((si) => tagText(si, 't')) : [];
  const sheets = [];
  for (const s of [...wb.getElementsByTagName('sheet')]) {
    const rid = s.getAttribute('r:id') || s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
    let path = target[rid] || '';
    path = path.startsWith('/') ? path.slice(1) : `xl/${path.replace(/^\.\//, '')}`;
    const sheet = doc(await zip.text(path));
    if (!sheet) continue;
    const rows = [];
    for (const r of [...sheet.getElementsByTagName('row')]) {
      const ri = Number(r.getAttribute('r')) - 1;
      const cells = [];
      let next = 0;
      for (const cell of [...r.getElementsByTagName('c')]) {
        const ref = cell.getAttribute('r') || '';
        let ci = next;
        const letters = ref.match(/^[A-Z]+/)?.[0];
        if (letters) { ci = 0; for (const ch of letters) ci = ci * 26 + (ch.charCodeAt(0) - 64); ci -= 1; }
        next = ci + 1;
        const t = cell.getAttribute('t');
        let value = '';
        if (t === 's') value = shared[Number(tagText(cell, 'v'))] ?? '';
        else if (t === 'inlineStr') value = tagText(cell, 't');
        else if (t === 'b') value = tagText(cell, 'v') === '1' ? 'TRUE' : 'FALSE';
        else value = tagText(cell, 'v');
        cells[ci] = value;
      }
      rows[ri >= 0 ? ri : rows.length] = [...cells].map((v) => v ?? '');
    }
    sheets.push({ name: s.getAttribute('name'), rows: rows.filter(Boolean).filter((r) => r.some((v) => String(v).trim() !== '')) });
  }
  return sheets;
}

// Any upload → [{ name, rows }]
export async function readSheetFile(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xlsm')) return readXlsx(await file.arrayBuffer());
  if (lower.endsWith('.xls')) throw new Error('Old .xls files are not supported — open it in Excel and “Save As” .xlsx or CSV.');
  return [{ name: file.name.replace(/\.[^.]+$/, ''), rows: parseCsv(await file.text()) }];
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const csvBlob = (rows) => new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
