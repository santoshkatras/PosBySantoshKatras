import { useMemo, useRef, useState } from 'react';
import './item-list.css';
import { FilterBar } from './filter-bar.jsx';
import { ColumnPicker, useColumns } from './column-picker.jsx';
import { useFitHeight } from './fit-height.js';

export function RecordDesk({
  title,
  subtitle,
  columns,
  rows,
  filters = [],
  addLabel,
  onAdd,
  empty = 'No records yet.',
  notice = '',
}) {
  const [draft, setDraft] = useState(() => blank(filters));
  const [applied, setApplied] = useState(() => blank(filters));
  const [visibleColumns, setVisibleColumns] = useColumns(`desk_${title}`, columns.map((column) => column.id));
  const pageRef = useRef(null);
  useFitHeight(pageRef);
  const [openId, setOpenId] = useState('');
  const [panelTab, setPanelTab] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  const shown = useMemo(() => columns.filter((column) => visibleColumns.includes(column.id)), [columns, visibleColumns]);
  const filtered = rows.filter((row) => {
    for (const filter of filters) {
      const value = applied[filter.id];
      if (value && value !== 'all' && String(row.values[filter.id] || '') !== value) return false;
    }
    const query = String(applied.query || '').trim().toLowerCase();
    if (!query) return true;
    return Object.values(row.values).some((value) => String(value || '').toLowerCase().includes(query));
  });
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * pageSize;
  const pageRows = filtered.slice(start, start + pageSize);
  const open = rows.find((row) => row.id === openId) || null;
  const sections = open?.sections || [];
  const section = sections[panelTab] || sections[0];

  return (
    <div ref={pageRef} className={open ? 'il open fit-page' : 'il fit-page'}>
      <section className="il-main">
        <header className="il-head">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <div className="il-tools">
            {onAdd ? <button type="button" className="il-btn primary" onClick={onAdd}>{addLabel || '+ Add'}</button> : null}
          </div>
        </header>
        {notice ? <p className="muted">{notice}</p> : null}
        <FilterBar
          placeholder="Search..."
          values={{ ...applied, query: applied.query || '' }}
          onChange={(next) => { setDraft(next); setApplied(next); setPage(1); }}
          fields={filters}
        />
        <div className="il-table-wrap">
          <table>
            <thead>
              <tr>
                {shown.map((column) => <th key={column.id}>{column.label}</th>)}
                <th className="col-set"><ColumnPicker columns={columns.map((column) => [column.id, column.label])} value={visibleColumns} onChange={setVisibleColumns} defaults={columns.map((column) => column.id)} /></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length ? pageRows.map((row) => (
                <tr key={row.id} className={openId === row.id ? 'on' : undefined} onClick={() => { setOpenId(row.id); setPanelTab(0); }}>
                  {shown.map((column) => (
                    <td key={column.id} className={column.id === shown[0]?.id ? 'code' : undefined}>
                      {column.id === 'status' ? <span className={`il-status ${statusClass(row.values.status)}`}>{row.values.status || '—'}</span> : (row.values[column.id] || '—')}
                    </td>
                  ))}
                  <td className="col-set" />
                </tr>
              )) : <tr><td className="empty" colSpan={shown.length + 1}>{empty}</td></tr>}
            </tbody>
          </table>
        </div>
        <footer className="il-pager">
          <span className="il-total">Total: <strong>{filtered.length}</strong><em>Showing {filtered.length ? start + 1 : 0}–{Math.min(start + pageSize, filtered.length)}</em></span>
          <div>
            {Array.from({ length: pages }, (_, index) => index + 1).slice(0, 6).map((number) => (
              <button key={number} type="button" className={number === currentPage ? 'on' : undefined} onClick={() => setPage(number)}>{number}</button>
            ))}
            <select value={pageSize} aria-label="Rows per page" onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
              {[25, 50, 100].map((size) => <option key={size} value={size}>{size} / page</option>)}
            </select>
          </div>
        </footer>
      </section>
      {open ? (
        <aside className="il-detail">
          <header>
            <strong>{title}</strong>
            <button type="button" aria-label="Close details" onClick={() => setOpenId('')}>×</button>
          </header>
          <div className="il-identity">
            <span>{String(open.values[shown[0]?.id] || open.values.name || '•').slice(0, 1)}</span>
            <div>
              <small>{open.values[shown[0]?.id] || '—'}</small>
              <strong>{open.values.name || open.values[shown[1]?.id] || title}</strong>
              {open.values.status ? <em className={statusClass(open.values.status)}>{open.values.status}</em> : null}
            </div>
          </div>
          {sections.length > 1 ? (
            <div className="il-detail-tabs">
              {sections.map((item, index) => (
                <button key={item.title} type="button" className={panelTab === index ? 'on' : undefined} onClick={() => setPanelTab(index)}>{item.title}</button>
              ))}
            </div>
          ) : null}
          {section ? (
            <section className="il-facts">
              {sections.length > 1 ? null : <h3>{section.title}</h3>}
              {section.rows.map(([label, value]) => (
                <p key={label}><span>{label}</span><strong>{value || '—'}</strong></p>
              ))}
            </section>
          ) : null}
          {open.extra || null}
        </aside>
      ) : null}
    </div>
  );
}

function blank(filters) {
  return { query: '', ...Object.fromEntries(filters.map((filter) => [filter.id, 'all'])) };
}

function statusClass(status) {
  const value = String(status || '').toLowerCase();
  if (value.includes('inactive') || value.includes('expired')) return 'inactive';
  if (value.includes('low') || value.includes('draft')) return 'low';
  return 'active';
}
