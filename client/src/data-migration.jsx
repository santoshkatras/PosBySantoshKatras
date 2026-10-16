import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { message } from './opening-stock.jsx';
import { ENTITIES, chunkGroups, entityOf, mapHeaders, rowsToRecords } from '../../shared/migration.mjs';
import { csvBlob, downloadBlob, readSheetFile, toXlsx } from './sheet-io.js';
import './app-settings.css';
import './data-migration.css';

// Configurations → Data Migration: templates, checks, import and export for every master and
// transaction, in one place.

const when = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const stamp = () => new Date().toISOString().slice(0, 10);
const fileBase = (entity) => `SKPOS-${entity.sheet.replace(/[^A-Za-z0-9]+/g, '-')}`;

function templateSheet(entity, withSamples = true) {
  const header = entity.columns.map((col) => (col.req ? `${col.label} *` : col.label));
  const rows = withSamples ? entity.samples.map((s) => entity.columns.map((col) => s[col.key] ?? '')) : [];
  return { name: entity.sheet, rows: [header, ...rows], required: new Set(entity.columns.map((col, i) => (col.req ? i : -1)).filter((i) => i >= 0)) };
}
function guideSheet(entities) {
  const rows = [['SKPOS Data Migration — how to fill the templates'], [''],
    ['1. Keep the header row exactly as it is. Columns marked * are required (orange).'],
    ['2. Delete the sample rows and type or paste your own data. Dates: 2026-04-01 or 01-04-2026.'],
    ['3. Upload the sheet in Configurations → Data Migration, press Check data, fix any red rows, then Import.'],
    ['4. Order: Locations → Units → Categories → Brands → Items → Customers → Suppliers → Price Lists → Opening Stock → transactions.'], [''],
    ['Sheet', 'Column', 'Required', 'What to enter']];
  for (const e of entities) for (const col of e.columns) rows.push([e.sheet, col.label, col.req ? 'Yes' : '', col.hint || (col.options ? col.options.join(' / ') : '')]);
  return { name: 'How to fill', rows, plain: true, widths: [22, 26, 10, 90] };
}

export function DataMigrationPage() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [summary, setSummary] = useState(null);
  const [active, setActive] = useState('items');
  const [busyAll, setBusyAll] = useState('');
  const [error, setError] = useState('');
  const load = () => request('/migration/summary').then(setSummary).catch((err) => setError(message(err)));
  useEffect(() => { load(); }, [request]); // eslint-disable-line react-hooks/exhaustive-deps
  const entity = entityOf(active);

  async function allTemplates() {
    downloadBlob(toXlsx([guideSheet(ENTITIES), ...ENTITIES.map((e) => templateSheet(e))]), `SKPOS-Migration-Templates-${stamp()}.xlsx`);
  }
  async function exportAll() {
    setBusyAll('export'); setError('');
    try {
      const sheets = [];
      for (const e of ENTITIES) {
        const data = await request(`/migration/export/${e.id}`);
        sheets.push({ ...templateSheet(e, false), rows: [templateSheet(e, false).rows[0], ...data.rows.map((r) => e.columns.map((col) => r[col.key] ?? ''))] });
      }
      downloadBlob(toXlsx(sheets), `SKPOS-Full-Export-${stamp()}.xlsx`);
      feedback.toast('Full export downloaded.');
    } catch (err) { setError(message(err)); } finally { setBusyAll(''); }
  }

  const groups = [['master', 'Masters', 'Import these first, in this order'], ['transaction', 'Transactions', 'After masters — opening stock first']];
  return (
    <div className="dm">
      <div className="cfg-top">
        <div>
          <h1>Data Migration</h1>
          <p>Bring all your masters and transactions into SKPOS from Excel / CSV — with ready templates, a full check before anything is saved, and a row-by-row result. Export any of them back in the same layout.</p>
        </div>
        <div className="cfg-actions">
          <button type="button" className="btn" onClick={allTemplates} data-dm="all-templates">All templates (Excel)</button>
          <button type="button" className="btn primary" disabled={Boolean(busyAll)} onClick={exportAll} data-dm="export-all">{busyAll ? 'Exporting…' : 'Export all data (Excel)'}</button>
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="dm-layout">
        <nav className="dm-list" aria-label="What to migrate">
          {groups.map(([id, label, hint]) => (
            <div key={id} className="dm-group">
              <h4>{label}<small>{hint}</small></h4>
              {ENTITIES.filter((e) => e.group === id).map((e, i) => (
                <button type="button" key={e.id} className={active === e.id ? 'dm-ent on' : 'dm-ent'} onClick={() => setActive(e.id)} data-ent={e.id}>
                  <b>{id === 'master' ? i + 1 : ''}</b><span>{e.label}</span><em>{summary?.counts?.[e.id] ?? '·'}</em>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <EntityPanel key={entity.id} entity={entity} count={summary?.counts?.[entity.id]} onDone={load} />
      </div>
      <section className="cfg-card dm-runs">
        <div className="cfg-head"><h3>Recent imports</h3></div>
        {summary?.runs?.length ? (
          <div className="dm-scroll">
            <table className="pr-table">
              <thead><tr><th>When</th><th>Template</th><th>File</th><th>By</th><th className="num">Created</th><th className="num">Updated</th><th className="num">Skipped</th><th className="num">Failed</th></tr></thead>
              <tbody>
                {summary.runs.map((run) => (
                  <tr key={`${run.runId}${run.at}`}><td>{when(run.at)}</td><td>{entityOf(run.entity)?.label || run.entity}{run.options?.history ? <em className="dm-tag">history</em> : null}</td><td className="dm-file">{run.file}</td><td>{run.user}</td><td className="num ok">{run.created}</td><td className="num">{run.updated}</td><td className="num">{run.skipped}</td><td className={run.failed ? 'num bad' : 'num'}>{run.failed}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="cfg-hint">No imports yet.</p>}
      </section>
    </div>
  );
}

function EntityPanel({ entity, count, onDone }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [tab, setTab] = useState('import');
  const [file, setFile] = useState(null);
  const [sheets, setSheets] = useState([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [records, setRecords] = useState([]);
  const [mapping, setMapping] = useState(null);
  const [check, setCheck] = useState(null);
  const [results, setResults] = useState(null);
  const [progress, setProgress] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [show, setShow] = useState('all');
  const [opts, setOpts] = useState({ mode: 'create', autoCreate: true, history: false, keepNumber: true });
  const [range, setRange] = useState({ from: '', to: '' });
  const [drag, setDrag] = useState(false);
  const inputRef = useRef(null);
  const isDoc = Boolean(entity.doc);

  function applySheet(list, index) {
    const sheet = list[index];
    if (!sheet || !sheet.rows.length) { setRecords([]); setMapping({ map: {}, unknown: [], missing: entity.columns.filter((c) => c.req).map((c) => c.label), empty: true }); return; }
    const headers = sheet.rows[0].map((h) => String(h).replace(/\s*\*\s*$/, ''));
    const mapped = mapHeaders(entity, headers);
    setMapping(mapped);
    setRecords(rowsToRecords(entity, sheet.rows.slice(1), mapped.map, 2));
    setCheck(null); setResults(null);
  }
  async function pick(f) {
    if (!f) return;
    setError(''); setCheck(null); setResults(null); setFile(f);
    try {
      const list = await readSheetFile(f);
      setSheets(list);
      const best = Math.max(0, list.findIndex((s) => s.name.toLowerCase() === entity.sheet.toLowerCase()));
      setSheetIndex(best); applySheet(list, best);
    } catch (err) { setError(err.message || 'Could not read the file.'); setSheets([]); setRecords([]); setMapping(null); }
  }
  async function runCheck() {
    setBusy('check'); setError('');
    try {
      const out = []; let total = { groups: 0, errors: 0, warnings: 0 };
      for (let i = 0; i < records.length; i += 2000) {
        const part = await request('/migration/check', { method: 'POST', body: { entity: entity.id, rows: records.slice(i, i + 2000), options: opts } });
        out.push(...part.rows); total = { groups: total.groups + part.groups, errors: total.errors + part.errors, warnings: total.warnings + part.warnings };
      }
      setCheck({ rows: Object.fromEntries(out.map((r) => [r.row, r])), ...total });
      setShow(total.errors ? 'errors' : 'all');
    } catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  async function runImport() {
    const errorRows = new Set(Object.values(check?.rows || {}).filter((r) => r.errors.length).map((r) => r.row));
    const { chunks, groups } = chunkGroups(entity, records, isDoc ? 25 : 60);
    if (!(await feedback.confirm({ title: `Import ${entity.label}?`, message: `${records.length} row(s) → ${groups} ${isDoc || entity.groupBy ? 'document(s)' : 'record(s)'}${errorRows.size ? `. ${errorRows.size} row(s) with errors will be reported as failed and not saved` : ''}.`, detail: isDoc && entity.stock ? (opts.history ? 'History only — stock is NOT changed.' : 'Stock is posted exactly like a normal entry.') : '', confirmLabel: 'Import' }))) return;
    setBusy('import'); setError(''); setResults([]);
    const runId = `r${Date.now()}`;
    const all = [];
    try {
      for (const [i, chunk] of chunks.entries()) {
        setProgress({ done: i, total: chunks.length });
        const part = await request('/migration/import', { method: 'POST', body: { entity: entity.id, rows: chunk, options: opts, runId, file: file?.name || '' } });
        all.push(...part.results); setResults([...all]);
      }
      setProgress({ done: chunks.length, total: chunks.length });
      const c = (s) => all.filter((r) => r.status === s).length;
      feedback.success({ title: 'Import finished', message: `Created ${c('created')} · Updated ${c('updated')} · Skipped ${c('skipped')} · Failed ${c('failed')}` });
      onDone();
    } catch (err) { setError(`${message(err)} — ${all.length} group(s) were processed before this; see the results below.`); } finally { setBusy(''); }
  }
  function downloadTemplate(kind) {
    const sheet = templateSheet(entity);
    if (kind === 'csv') downloadBlob(csvBlob(sheet.rows), `${fileBase(entity)}-template.csv`);
    else downloadBlob(toXlsx([sheet, guideSheet([entity])]), `${fileBase(entity)}-template.xlsx`);
  }
  async function doExport(kind) {
    setBusy('export'); setError('');
    try {
      const qs = new URLSearchParams(range).toString();
      const data = await request(`/migration/export/${entity.id}${qs ? `?${qs}` : ''}`);
      const head = templateSheet(entity, false);
      const rows = [head.rows[0], ...data.rows.map((r) => entity.columns.map((col) => r[col.key] ?? ''))];
      if (kind === 'csv') downloadBlob(csvBlob(rows), `${fileBase(entity)}-export-${stamp()}.csv`);
      else downloadBlob(toXlsx([{ ...head, rows }]), `${fileBase(entity)}-export-${stamp()}.xlsx`);
      feedback.toast(`${data.rows.length} row(s) exported.`);
    } catch (err) { setError(message(err)); } finally { setBusy(''); }
  }
  function downloadReport() {
    const byRow = {};
    for (const r of results || []) for (const row of r.rows) byRow[row] = r;
    const header = ['Row', ...entity.columns.map((c) => c.label), 'Result', 'Message', 'SKPOS Ref'];
    const rows = records.map((rec) => { const r = byRow[rec._row] || {}; return [rec._row, ...entity.columns.map((c) => rec[c.key]), r.status || 'not imported', r.message || '', r.ref || '']; });
    downloadBlob(toXlsx([{ name: 'Import result', rows: [header, ...rows] }]), `${fileBase(entity)}-result-${stamp()}.xlsx`);
  }

  const resultOf = useMemo(() => { const m = {}; for (const r of results || []) for (const row of r.rows) m[row] = r; return m; }, [results]);
  const shown = records.filter((rec) => { const c = check?.rows?.[rec._row]; const r = resultOf[rec._row]; if (show === 'errors') return (c?.errors.length) || r?.status === 'failed'; if (show === 'warnings') return c?.warnings.length; return true; }).slice(0, 500);
  const counts = (s) => (results || []).filter((r) => r.status === s).reduce((n, r) => n + r.rows.length, 0);
  const previewCols = entity.columns.filter((col) => col.req || records.some((rec) => rec[col.key])).slice(0, 9);
  const canImport = records.length && check && !busy && !mapping?.missing.length;

  return (
    <section className="cfg-card dm-panel">
      <div className="dm-panel-head">
        <div><h2>{entity.label}</h2><p>{entity.desc}</p></div>
        <span className="dm-count">{count ?? '—'} <small>in SKPOS</small></span>
      </div>
      <div className="cfg-tabs" role="tablist">
        {[['import', 'Import'], ['export', 'Export'], ['columns', 'Template columns']].map(([id, label]) => <button type="button" role="tab" key={id} aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)}>{label}</button>)}
      </div>
      {error ? <p className="banner">{error}</p> : null}

      {tab === 'import' ? (
        <div className="dm-steps">
          <div className="dm-step">
            <span className="dm-n">1</span>
            <div><strong>Download the template</strong><small>Sample rows show the format. Required columns are marked * (orange in Excel).</small></div>
            <div className="dm-actions"><button type="button" className="btn" onClick={() => downloadTemplate('xlsx')} data-dm="tpl-xlsx">Excel template</button><button type="button" className="btn" onClick={() => downloadTemplate('csv')}>CSV template</button></div>
          </div>
          <div className="dm-step">
            <span className="dm-n">2</span>
            <div className="dm-grow">
              <strong>Upload your filled file</strong>
              <label className={drag ? 'dm-drop on' : 'dm-drop'} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]); }}>
                <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.csv,.txt" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} data-dm="file" />
                <span>{file ? <><b>{file.name}</b> · {records.length} data row(s)</> : <>Drop an Excel (.xlsx) or CSV file here, or <u>browse</u></>}</span>
              </label>
              {sheets.length > 1 ? <label className="dm-sheet">Sheet <select value={sheetIndex} onChange={(e) => { const i = Number(e.target.value); setSheetIndex(i); applySheet(sheets, i); }}>{sheets.map((s, i) => <option key={s.name + i} value={i}>{s.name} ({Math.max(s.rows.length - 1, 0)} rows)</option>)}</select></label> : null}
              {mapping ? (
                <div className="dm-map">
                  {mapping.missing.length ? <p className="bad">Missing required column(s): <b>{mapping.missing.join(', ')}</b> — use the template header row.</p> : <p className="ok">All required columns found ({Object.keys(mapping.map).length} of {entity.columns.length} columns matched).</p>}
                  {mapping.unknown.length ? <p className="warn">Ignored column(s): {mapping.unknown.join(', ')}</p> : null}
                </div>
              ) : null}
            </div>
          </div>
          <div className="dm-step">
            <span className="dm-n">3</span>
            <div className="dm-grow">
              <strong>Options</strong>
              <div className="dm-opts">
                {entity.upsert ? (
                  <div className="cfg-seg">{[['create', 'Add new only (skip existing)'], ['upsert', 'Add new + update existing']].map(([id, label]) => <button type="button" key={id} className={opts.mode === id ? 'on' : ''} onClick={() => setOpts({ ...opts, mode: id })}>{label}</button>)}</div>
                ) : null}
                {entity.id === 'items' ? <label className="cfg-check"><input type="checkbox" checked={opts.autoCreate} onChange={(e) => setOpts({ ...opts, autoCreate: e.target.checked })} /><span>Create missing units and categories automatically</span></label> : null}
                {isDoc && entity.stock ? (
                  <div className="cfg-seg">{[[false, entity.stock === 'in' ? 'Post stock (adds stock)' : 'Post stock (reduces stock)'], [true, 'History only — no stock change']].map(([id, label]) => <button type="button" key={String(id)} className={opts.history === id ? 'on' : ''} onClick={() => setOpts({ ...opts, history: id })} data-dm={id ? 'history' : 'post'}>{label}</button>)}</div>
                ) : null}
                {isDoc ? <label className="cfg-check"><input type="checkbox" checked={opts.keepNumber} onChange={(e) => setOpts({ ...opts, keepNumber: e.target.checked })} /><span>Keep my old document numbers<small>Uses the Doc No as the SKPOS number when it is free</small></span></label> : null}
                {!entity.upsert && !isDoc && entity.id !== 'items' ? <span className="cfg-hint">{entity.group === 'master' ? 'Existing records are skipped, never duplicated.' : 'Each group of rows is saved as one entry with the normal checks and stock posting.'}</span> : null}
              </div>
              {isDoc && entity.stock && opts.history ? <p className="cfg-hint">Use history-only for old periods whose stock is already covered by your Opening Stock — the documents are saved for reports and look-up only.</p> : null}
            </div>
          </div>
          <div className="dm-step">
            <span className="dm-n">4</span>
            <div className="dm-grow">
              <strong>Check, then import</strong>
              <div className="dm-actions">
                <button type="button" className="btn" disabled={!records.length || Boolean(busy) || Boolean(mapping?.missing.length)} onClick={runCheck} data-dm="check">{busy === 'check' ? 'Checking…' : 'Check data'}</button>
                <button type="button" className="btn primary" disabled={!canImport} onClick={runImport} data-dm="import">{busy === 'import' ? 'Importing…' : `Import ${records.length || ''} row(s)`}</button>
                {results?.length && !busy ? <button type="button" className="btn" onClick={downloadReport} data-dm="report">Download result</button> : null}
              </div>
              {check ? (
                <div className="dm-sum">
                  <span>{records.length} rows · {check.groups} {isDoc || entity.groupBy ? 'document(s)' : 'record(s)'}</span>
                  <span className={check.errors ? 'bad' : 'ok'}>{check.errors ? `${check.errors} row(s) with errors` : 'No errors'}</span>
                  {check.warnings ? <span className="warn">{check.warnings} warning(s)</span> : null}
                </div>
              ) : records.length ? <p className="cfg-hint">Press <b>Check data</b> — nothing is saved until you import.</p> : null}
              {progress && busy === 'import' ? <div className="dm-bar"><i style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }} /><span>{progress.done} / {progress.total}</span></div> : null}
              {results?.length ? <div className="dm-sum"><span className="ok">Created {counts('created')}</span><span>Updated {counts('updated')}</span><span>Skipped {counts('skipped')}</span><span className={counts('failed') ? 'bad' : ''}>Failed {counts('failed')}</span></div> : null}
            </div>
          </div>

          {records.length ? (
            <div className="dm-preview">
              <div className="dm-preview-top">
                <strong>Rows</strong>
                <div className="cfg-seg">{[['all', 'All'], ['errors', 'Errors'], ['warnings', 'Warnings']].map(([id, label]) => <button type="button" key={id} className={show === id ? 'on' : ''} onClick={() => setShow(id)}>{label}</button>)}</div>
                {records.length > 500 ? <small>Showing the first 500 matching rows</small> : null}
              </div>
              <div className="dm-scroll">
                <table className="pr-table dm-table">
                  <thead><tr><th>Row</th><th>Status</th>{previewCols.map((col) => <th key={col.key}>{col.label}</th>)}<th>Message</th></tr></thead>
                  <tbody>
                    {shown.map((rec) => {
                      const c = check?.rows?.[rec._row]; const r = resultOf[rec._row];
                      const status = r ? r.status : c ? (c.errors.length ? 'error' : c.warnings.length ? 'warning' : 'ok') : '';
                      const msg = r ? `${r.ref ? `${r.ref} — ` : ''}${r.message}` : c ? [...c.errors, ...c.warnings].join(' · ') : '';
                      return (
                        <tr key={rec._row} className={`dm-${status}`}>
                          <td className="num">{rec._row}</td><td><span className={`dm-st dm-${status}`}>{status || '—'}</span></td>
                          {previewCols.map((col) => <td key={col.key} className={col.type === 'num' ? 'num' : undefined}>{rec[col.key]}</td>)}
                          <td className="dm-msg">{msg}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === 'export' ? (
        <div className="dm-steps">
          <div className="dm-step">
            <span className="dm-n">⇩</span>
            <div className="dm-grow">
              <strong>Export {entity.label}</strong>
              <small>{entity.id === 'opening-stock' ? 'Exports the current stock in hand per location (with batches and serial numbers) — ready to load as opening stock in another SKPOS.' : 'Same columns as the import template, so the file can be edited and imported again.'}</small>
              {entity.group === 'transaction' && entity.id !== 'opening-stock' ? (
                <div className="dm-opts"><label className="dm-date">From <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label><label className="dm-date">To <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label><span className="cfg-hint">Leave blank for all dates.</span></div>
              ) : null}
              <div className="dm-actions"><button type="button" className="btn primary" disabled={Boolean(busy)} onClick={() => doExport('xlsx')} data-dm="export-xlsx">{busy === 'export' ? 'Exporting…' : 'Export to Excel'}</button><button type="button" className="btn" disabled={Boolean(busy)} onClick={() => doExport('csv')}>Export to CSV</button></div>
            </div>
          </div>
        </div>
      ) : null}

      {tab === 'columns' ? (
        <div className="dm-scroll">
          <table className="pr-table dm-cols">
            <thead><tr><th>Column</th><th>Required</th><th>What to enter</th><th>Example</th></tr></thead>
            <tbody>{entity.columns.map((col) => <tr key={col.key}><td><b>{col.label}</b></td><td>{col.req ? <span className="dm-req">Required</span> : ''}</td><td>{col.hint || (col.options ? col.options.join(' / ') : col.type === 'date' ? 'Date' : col.type === 'num' ? 'Number' : '')}</td><td className="mono">{entity.samples.find((s) => s[col.key])?.[col.key] || ''}</td></tr>)}</tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
