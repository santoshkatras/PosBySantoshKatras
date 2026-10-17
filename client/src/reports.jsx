// Reports → Masters · Sales · Purchase · Stock Transactions · Promotions
// One page per group: pick a report on the left (↑ ↓ Enter), set the period / location / party, then search, sort, export or print.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFitHeight } from './fit-height.js';
import { message } from './opening-stock.jsx';
import { csvBlob, downloadBlob } from './sheet-io.js';
import { enterNext } from './accounts.jsx';
import './reports.css';

const GROUP_TITLE = { masters: 'Master Reports', sales: 'Sales Reports', purchase: 'Purchase Reports', stock: 'Stock Transaction Reports', promotions: 'Promotion Reports' };
const inr = (v) => new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v) || 0);
const qtyf = (v) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 3 }).format(Number(v) || 0);
const pad = (v) => String(v).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const day = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? new Date(`${String(v).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : v || '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const NUMERIC = new Set(['q', 'm', 'n', 'p', 'x']);
const TOTALLED = new Set(['q', 'm', 'n']);

function ranges() {
  const t = new Date();
  const fyStart = t.getMonth() >= 3 ? t.getFullYear() : t.getFullYear() - 1;
  const monday = new Date(t); monday.setDate(t.getDate() - ((t.getDay() + 6) % 7));
  const y = new Date(t); y.setDate(t.getDate() - 1);
  return [
    ['today', 'Today', ymd(t), ymd(t)],
    ['yesterday', 'Yesterday', ymd(y), ymd(y)],
    ['week', 'This week', ymd(monday), ymd(t)],
    ['month', 'This month', ymd(new Date(t.getFullYear(), t.getMonth(), 1)), ymd(t)],
    ['lastmonth', 'Last month', ymd(new Date(t.getFullYear(), t.getMonth() - 1, 1)), ymd(new Date(t.getFullYear(), t.getMonth(), 0))],
    ['quarter', 'This quarter', ymd(new Date(t.getFullYear(), Math.floor(t.getMonth() / 3) * 3, 1)), ymd(t)],
    ['fy', 'This FY', `${fyStart}-04-01`, ymd(t)],
    ['lastfy', 'Last FY', `${fyStart - 1}-04-01`, `${fyStart}-03-31`],
  ];
}
function cell(type, v) {
  if (v === '' || v == null) return '';
  if (type === 'm' || type === 'x') return typeof v === 'number' ? inr(v) : v;
  if (type === 'q') return qtyf(v);
  if (type === 'p') return `${Number(v).toFixed(1)}%`;
  if (type === 'd') return day(v);
  return String(v);
}

export function ReportsPage({ group }) {
  const { request, session } = useAuth();
  const [catalog, setCatalog] = useState(null);
  const [kind, setKind] = useState(() => { try { return localStorage.getItem(`skpos_report_${group}`) || ''; } catch { return ''; } });
  const [cursor, setCursor] = useState(0);
  const [filter, setFilter] = useState(() => { const m = ranges().find((r) => r[0] === 'month'); return { range: 'month', from: m[2], to: m[3], locationId: '', partyId: '', days: '90', zero: false }; });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [listQuery, setListQuery] = useState('');
  const [sort, setSort] = useState(null);
  const pageRef = useRef(null);
  const listRef = useRef(null);
  useFitHeight(pageRef);

  useEffect(() => { request('/reports/catalog').then(setCatalog).catch((err) => setError(message(err))); }, [request]);
  const list = useMemo(() => (catalog?.groups?.[group] || []).filter((r) => !listQuery || `${r.name} ${r.note}`.toLowerCase().includes(listQuery.toLowerCase())), [catalog, group, listQuery]);
  useEffect(() => { if (catalog && !kind && list[0]) setKind(list[0].id); }, [catalog]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const i = list.findIndex((r) => r.id === kind); if (i >= 0) setCursor(i); }, [kind, list]);

  const run = useCallback(async (which = kind, f = filter) => {
    if (!which) return;
    setLoading(true); setError('');
    try {
      const qs = new URLSearchParams({ from: f.from, to: f.to, locationId: f.locationId, partyId: f.partyId, days: f.days, zero: f.zero ? '1' : '' });
      const res = await request(`/reports/${group}/${which}?${qs}`);
      setData(res); setSort(null);
    } catch (err) { setError(message(err)); setData(null); } finally { setLoading(false); }
  }, [request, group, kind, filter]);
  useEffect(() => { if (kind) { run(kind); try { localStorage.setItem(`skpos_report_${group}`, kind); } catch { /* ignore */ } } }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  function pick(id) { setQuery(''); setKind(id); }
  function listKeys(event) {
    if (event.key === 'ArrowDown') { event.preventDefault(); setCursor((c) => Math.min(c + 1, list.length - 1)); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (event.key === 'Enter') { event.preventDefault(); if (list[cursor]) { if (list[cursor].id === kind) run(); else pick(list[cursor].id); } }
  }
  useEffect(() => { listRef.current?.querySelector('.rp-item.cur')?.scrollIntoView({ block: 'nearest' }); }, [cursor]);
  useEffect(() => {
    const key = (event) => { if (event.key === 'F5') { event.preventDefault(); run(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [run]);

  const cols = data?.kind === kind ? data.columns : [];
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => {
    if (!data || data.kind !== kind) return [];
    let out = data.rows.filter((r) => !q || cols.some(([k]) => String(r[k] ?? '').toLowerCase().includes(q)));
    if (sort) {
      const [k, dir] = sort; const type = cols.find((c) => c[0] === k)?.[2];
      out = out.slice().sort((a, b) => (NUMERIC.has(type) ? (Number(a[k]) || 0) - (Number(b[k]) || 0) : String(a[k] ?? '').localeCompare(String(b[k] ?? ''), 'en', { numeric: true })) * dir);
    }
    return out;
  }, [data, kind, q, sort, cols]);
  const totals = useMemo(() => Object.fromEntries(cols.filter((c) => TOTALLED.has(c[2])).map(([k]) => [k, rows.reduce((s, r) => s + (Number(r[k]) || 0), 0)])), [rows, cols]);
  const current = list.find((r) => r.id === kind) || catalog?.groups?.[group]?.find((r) => r.id === kind);
  const parties = group === 'sales' ? catalog?.customers : group === 'purchase' ? catalog?.suppliers : null;
  const locName = catalog?.locations?.find((l) => l.id === filter.locationId)?.name || 'All locations';
  const partyName = parties?.find((p) => p.id === filter.partyId)?.name;
  const subtitle = `${session?.tenant?.name || ''} · ${locName}${partyName ? ` · ${partyName}` : ''} · ${data?.asOn ? `As on ${day(ymd(new Date()))}` : `${day(filter.from)} to ${day(filter.to)}`}`;

  function setRange(id) {
    const r = ranges().find((x) => x[0] === id);
    const next = r ? { ...filter, range: id, from: r[2], to: r[3] } : { ...filter, range: id };
    setFilter(next); if (r) run(kind, next);
  }
  function exportCsv() {
    downloadBlob(csvBlob([[current?.name || ''], [subtitle], [], cols.map((c) => c[1]), ...rows.map((r) => cols.map(([k]) => r[k] ?? '')), cols.map(([k, , t], i) => (i === 0 ? 'Total' : TOTALLED.has(t) ? Math.round(totals[k] * 1000) / 1000 : ''))]), `${group}-${kind}-${filter.from}-${filter.to}.csv`);
  }
  function print() {
    const w = window.open('', '_blank'); if (!w) return;
    const wide = cols.length > 9;
    w.document.write(`<html><head><title>${esc(current?.name)}</title><style>@page{size:${wide ? 'A4 landscape' : 'A4'};margin:9mm}body{font:${wide ? 9.5 : 11}px Arial;margin:0}h2{margin:0 0 3px;font-size:15px}p{margin:0 0 8px;color:#444}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:3px 5px;text-align:left}th{background:#eee}.n{text-align:right}tfoot td{font-weight:bold;background:#f3f3f3}</style></head><body><h2>${esc(current?.name)}</h2><p>${esc(subtitle)}${q ? ` · filtered “${esc(query)}”` : ''}</p><table><thead><tr>${cols.map(([, l, t]) => `<th class="${NUMERIC.has(t) ? 'n' : ''}">${esc(l)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map(([k, , t]) => `<td class="${NUMERIC.has(t) ? 'n' : ''}">${esc(cell(t, r[k]))}</td>`).join('')}</tr>`).join('')}</tbody><tfoot><tr>${cols.map(([k, , t], i) => `<td class="${NUMERIC.has(t) ? 'n' : ''}">${i === 0 ? `Total (${rows.length})` : TOTALLED.has(t) ? esc(cell(t, totals[k])) : ''}</td>`).join('')}</tr></tfoot></table><script>window.print()</script></body></html>`);
    w.document.close();
  }

  return (
    <div ref={pageRef} className="fit-split rp-page">
      {error ? <p className="banner">{error}</p> : null}
      <div className="rp-wrap">
        <aside className="rp-list" ref={listRef}>
          <h2>{GROUP_TITLE[group] || 'Reports'}</h2>
          <input className="rp-find" value={listQuery} placeholder="Find a report — ↑ ↓ Enter" onChange={(e) => { setListQuery(e.target.value); setCursor(0); }} onKeyDown={listKeys} data-sc="search" />
          <div className="rp-items" role="listbox" tabIndex={0} onKeyDown={listKeys} aria-label="Reports">
            {list.map((r, i) => (
              <button key={r.id} type="button" role="option" aria-selected={r.id === kind} className={`rp-item${r.id === kind ? ' on' : ''}${i === cursor ? ' cur' : ''}`} onClick={() => { setCursor(i); pick(r.id); }} title={r.note}>
                <b>{r.name}</b><small>{r.note}</small>
              </button>
            ))}
            {catalog && !list.length ? <p className="rp-empty">No report matches.</p> : null}
          </div>
        </aside>
        <section className="data-grid rp-main">
          <div className="rp-head">
            <div className="rp-title"><h3>{current?.name || 'Report'}</h3><small>{subtitle}</small></div>
            <div className="rp-actions">
              <input className="rp-search" value={query} placeholder="Search in this report" onChange={(e) => setQuery(e.target.value)} />
              <button type="button" className="btn" disabled={!rows.length} onClick={exportCsv}>Export CSV</button>
              <button type="button" className="btn" disabled={!rows.length} onClick={print} data-sc="print">Print</button>
            </div>
          </div>
          <div className="rp-filters" onKeyDown={(e) => enterNext(e, () => run())}>
            {data?.asOn ? <span className="rp-ason">As on today</span> : (
              <>
                <select value={filter.range} aria-label="Period" onChange={(e) => setRange(e.target.value)}>
                  {ranges().map(([id, label]) => <option key={id} value={id}>{label}</option>)}<option value="custom">Custom dates</option>
                </select>
                <label><input type="date" value={filter.from} onChange={(e) => setFilter({ ...filter, range: 'custom', from: e.target.value })} /></label>
                <label>to<input type="date" value={filter.to} onChange={(e) => setFilter({ ...filter, range: 'custom', to: e.target.value })} /></label>
              </>
            )}
            {catalog?.locations?.length > 1 ? (
              <select value={filter.locationId} aria-label="Location" onChange={(e) => setFilter({ ...filter, locationId: e.target.value })}>
                <option value="">All locations</option>{catalog.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            ) : null}
            {parties?.length ? (
              <select value={filter.partyId} aria-label={group === 'sales' ? 'Customer' : 'Supplier'} onChange={(e) => setFilter({ ...filter, partyId: e.target.value })}>
                <option value="">{group === 'sales' ? 'All customers' : 'All suppliers'}</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}{p.mobile ? ` · ${p.mobile}` : ''}</option>)}
              </select>
            ) : null}
            {data?.daysOption ? <label>No sale in<input className="rp-days" inputMode="numeric" value={filter.days} onChange={(e) => setFilter({ ...filter, days: e.target.value.replace(/\D/g, '') })} />days</label> : null}
            {data?.zeroOption ? <label className="rp-check"><input type="checkbox" checked={filter.zero} onChange={(e) => { const next = { ...filter, zero: e.target.checked }; setFilter(next); run(kind, next); }} />Show zero</label> : null}
            <button type="button" className="btn primary" onClick={() => run()} disabled={loading}>{loading ? 'Loading…' : 'Show'} <kbd>F5</kbd></button>
          </div>
          <div className="table-wrap rp-table">
            <table>
              <thead><tr>{cols.map(([k, l, t]) => (
                <th key={k} className={NUMERIC.has(t) ? 'num' : undefined} onClick={() => setSort((s) => (s?.[0] === k ? (s[1] === 1 ? [k, -1] : null) : [k, NUMERIC.has(t) ? -1 : 1]))} title="Click to sort">
                  {l}{sort?.[0] === k ? (sort[1] === 1 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}</tr></thead>
              <tbody>
                {rows.length ? rows.map((r, i) => (
                  <tr key={i}>{cols.map(([k, , t]) => <td key={k} className={`${NUMERIC.has(t) ? 'num' : ''}${t === 'c' ? ' mono' : ''}${t === 'm' && Number(r[k]) < 0 ? ' neg' : ''}`.trim() || undefined}>{cell(t, r[k])}</td>)}</tr>
                )) : <tr><td className="empty" colSpan={Math.max(cols.length, 1)}>{loading || !data ? 'Loading…' : data.rows.length ? 'Nothing matches the search.' : 'No data for this period / filter.'}</td></tr>}
              </tbody>
              {rows.length && Object.keys(totals).length ? (
                <tfoot><tr>{cols.map(([k, , t], i) => <td key={k} className={NUMERIC.has(t) ? 'num' : undefined}>{i === 0 ? `Total (${rows.length})` : TOTALLED.has(t) ? cell(t, totals[k]) : ''}</td>)}</tr></tfoot>
              ) : null}
            </table>
          </div>
          <div className="grid-foot">Rows: <strong>{rows.length}</strong>{data?.note2 ? <em>{data.note2}</em> : null}<em className="rp-keys"><kbd>↑</kbd><kbd>↓</kbd><kbd>Enter</kbd> choose report · <kbd>F5</kbd> refresh · click a heading to sort</em></div>
        </section>
      </div>
    </div>
  );
}
