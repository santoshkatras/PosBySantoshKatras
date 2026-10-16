import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { message } from './opening-stock.jsx';
import './app-settings.css';
import './data-cleanup.css';

// Configurations → Data Cleanup: choose exactly what to clear, see how many records, confirm with
// DELETE + your password. Every cleanup is backed up and can be restored.

const GROUPS = [
  ['Transactions', 'Bills, orders, purchases, transfers, wastage — filter by date and location'],
  ['Stock', 'Stock quantities, batches, serial numbers and stock barcodes'],
  ['Masters', 'Items, customers, suppliers and other lists'],
  ['Promotions', 'Offers, coupons, gift vouchers and loyalty'],
  ['Logs', 'Activity history'],
];
const fmt = (v) => new Intl.NumberFormat('en-IN').format(Number(v) || 0);
const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const TABLE_NAMES = {
  documents: 'documents', held_bills: 'held bills', transfers: 'transfers', transfer_auto_runs: 'auto-schedule runs', wastage_entries: 'wastage entries', price_updates: 'price updates',
  job_cards: 'job cards', job_lines: 'job lines', job_payments: 'job payments', job_events: 'job history', stock_movements: 'stock movements', stock_levels: 'stock quantities',
  batches: 'batches', serials: 'serial numbers', stock_lots: 'stock barcodes', products: 'items', variants: 'variants', settings: 'detail records', categories: 'categories',
  brands: 'brands', customers: 'customers', suppliers: 'suppliers', vehicles: 'vehicles', price_lists: 'price lists', gift_vouchers: 'gift vouchers', loyalty_members: 'members',
  loyalty_ledger: 'points entries', audit_logs: 'log entries',
};

export function DataCleanupPage() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [picked, setPicked] = useState([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [locationId, setLocationId] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [restore, setRestore] = useState(null);

  const load = useCallback(() => {
    const q = new URLSearchParams({ from, to, locationId }).toString();
    request(`/data-cleanup/summary?${q}`).then((res) => { setData(res); setError(''); }).catch((err) => setError(message(err)));
  }, [request, from, to, locationId]);
  useEffect(() => { load(); }, [load]);

  const cats = data?.categories || [];
  const byId = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c])), [cats]);
  const filtered = Boolean(from || to || locationId);
  const lockedByFilter = (c) => c.needs.length > 0 && filtered;
  function toggle(id, on) { setPicked((current) => withDeps(current, [id], on)); }
  function toggleMany(ids, on) { setPicked((current) => withDeps(current, ids, on)); }
  // tick / untick ids, adding what they need (or removing what needs them)
  function withDeps(current, ids, on) {
    let next = on ? [...new Set([...current, ...ids])] : current.filter((x) => !ids.includes(x));
    if (on) {
      const add = (cid) => { for (const need of byId[cid]?.needs || []) { if (!next.includes(need)) { next.push(need); add(need); } } };
      ids.forEach(add);
    } else {
      // un-ticking something another ticked item needs → un-tick that one too
      let changed = true;
      while (changed) { changed = false; for (const c of cats) if (next.includes(c.id) && c.needs.some((n) => !next.includes(n))) { next = next.filter((x) => x !== c.id); changed = true; } }
    }
    return next;
  }
  function preset(kind) {
    if (kind === 'none') { setPicked([]); return; }
    if (kind === 'transactions') { setPicked(cats.filter((c) => c.group === 'Transactions').map((c) => c.id)); return; }
    if (kind === 'stock') { setPicked(['stock']); return; }
    if (kind === 'fresh') { setFrom(''); setTo(''); setLocationId(''); setPicked(cats.map((c) => c.id)); }
  }
  const chosen = cats.filter((c) => picked.includes(c.id));
  const total = chosen.reduce((t, c) => t + c.count, 0);
  const anyLocked = chosen.some(lockedByFilter);

  async function run(form) {
    try {
      const result = await request('/data-cleanup/run', { method: 'POST', body: { categories: picked, from, to, locationId, confirm: form.confirm, password: form.password } });
      setConfirm(null); setPicked([]);
      await feedback.success({ title: 'Data cleared', message: `${fmt(result.total)} record(s) removed.`, detail: `A backup was saved${result.file ? ` (${result.file.split(/[\\/]/).pop()})` : ''}. You can restore it from “Cleanup history” below.` });
      load();
    } catch (err) { return message(err); }
    return '';
  }
  async function doRestore(form) {
    try {
      const result = await request(`/data-cleanup/restore/${restore.batch}`, { method: 'POST', body: { password: form.password } });
      setRestore(null);
      feedback.toast(`${fmt(result.restored)} record(s) restored.`);
      load();
    } catch (err) { return message(err); }
    return '';
  }

  if (!data) return <section className="card">{error ? <p className="banner">{error}</p> : <p>Loading data cleanup…</p>}</section>;
  return (
    <div className="cfg cl">
      <div className="cfg-top">
        <div>
          <h1>Data Cleanup</h1>
          <p>Choose exactly what to clear for <b>{data.company}</b>. You see how many records each choice removes before anything happens. Users, roles, locations, units, company details and all configuration settings are never touched.</p>
        </div>
      </div>
      <div className="cl-warn">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20L12 3zM12 10v5M12 18h.01" /></svg>
        <div><b>Clearing data cannot be undone by the cashier — only by the owner, from “Cleanup history” below.</b> A backup file is written before each cleanup. Take a full copy of the <code>data</code> folder too if you are unsure.</div>
      </div>
      {error ? <p className="banner">{error}</p> : null}

      <section className="cfg-card cl-filters">
        <div className="cl-filter-row">
          <label className="cfg-field">From date<input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="cfg-field">To date<input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label>
          <label className="cfg-field">Location<select value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">All locations</option>{data.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          {filtered ? <button type="button" className="btn" onClick={() => { setFrom(''); setTo(''); setLocationId(''); }}>All dates &amp; locations</button> : null}
          <p className="cl-filter-note">{filtered ? `Only ${from ? `from ${from} ` : ''}${to ? `up to ${to} ` : ''}${locationId ? `at ${data.locations.find((l) => l.id === locationId)?.name}` : ''} is counted for transactions${locationId ? ' and stock' : ''}. Masters and promotions are always cleared in full.` : 'No date or location limit — everything of the ticked kinds is cleared.'}</p>
        </div>
        <div className="cl-presets">
          <span>Quick choice:</span>
          <button type="button" className="btn" onClick={() => preset('transactions')}>All transactions (keep items &amp; parties)</button>
          <button type="button" className="btn" onClick={() => preset('stock')}>Reset stock to zero</button>
          <button type="button" className="btn danger" onClick={() => preset('fresh')}>Fresh start — everything</button>
          {picked.length ? <button type="button" className="btn" onClick={() => preset('none')}>Clear ticks</button> : null}
        </div>
      </section>

      <div className="cl-groups">
        {GROUPS.map(([group, hint]) => {
          const rows = cats.filter((c) => c.group === group);
          if (!rows.length) return null;
          const allOn = rows.filter((c) => !lockedByFilter(c)).every((c) => picked.includes(c.id));
          return (
            <section key={group} className="cfg-card cl-group">
              <header>
                <div><h3>{group}</h3><p>{hint}</p></div>
                <button type="button" className="btn" onClick={() => toggleMany(rows.filter((c) => allOn || !lockedByFilter(c)).map((c) => c.id), !allOn)}>{allOn ? 'Untick all' : 'Tick all'}</button>
              </header>
              {rows.map((c) => {
                const on = picked.includes(c.id);
                const locked = lockedByFilter(c);
                return (
                  <label key={c.id} className={`cl-item${on ? ' on' : ''}${locked ? ' locked' : ''}`}>
                    <input type="checkbox" checked={on} disabled={locked} onChange={(e) => toggle(c.id, e.target.checked)} />
                    <div className="cl-text">
                      <b>{c.label}</b>
                      <small>{c.hint}</small>
                      {c.count ? <small className="cl-parts">{c.parts.filter((p) => p.count).map((p) => `${fmt(p.count)} ${TABLE_NAMES[p.table] || p.table}`).join(' · ')}</small> : null}
                      {c.needs.length ? <small className="cl-needs">{locked ? 'Only for all dates and all locations. ' : ''}Also clears: {c.needs.map((n) => byId[n]?.label).join(', ')}</small> : null}
                    </div>
                    <span className={c.count ? 'cl-count' : 'cl-count zero'}>{fmt(c.count)}</span>
                  </label>
                );
              })}
            </section>
          );
        })}
      </div>

      <div className={picked.length ? 'cl-bar on' : 'cl-bar'}>
        <div>
          {picked.length ? <><b>{fmt(total)}</b> record(s) in {picked.length} kind(s) will be cleared: {chosen.map((c) => c.label).join(', ')}</> : 'Tick what you want to clear.'}
          {anyLocked ? <span className="cl-bad"> — remove the date / location limit for Items or Categories.</span> : null}
        </div>
        <button type="button" className="btn danger" disabled={!picked.length || anyLocked} onClick={() => setConfirm(true)}>Clear selected data…</button>
      </div>

      <section className="cfg-card cl-history">
        <h3>Cleanup history</h3>
        {data.log.length ? (
          <table className="pr-table">
            <thead><tr><th>When</th><th>By</th><th>What was cleared</th><th>Limits</th><th className="num">Records</th><th>Backup file</th><th /></tr></thead>
            <tbody>{data.log.map((row) => (
              <tr key={row.batch}>
                <td>{when(row.at)}</td><td>{row.by}</td><td>{(row.categories || []).join(', ')}</td>
                <td>{[row.filters?.from && `from ${row.filters.from}`, row.filters?.to && `to ${row.filters.to}`, row.filters?.locationId && (data.locations.find((l) => l.id === row.filters.locationId)?.name || 'one location')].filter(Boolean).join(', ') || 'All'}</td>
                <td className="num">{fmt(row.total)}</td><td className="cl-file">{row.file ? row.file.split(/[\\/]/).pop() : '—'}</td>
                <td>{row.restored ? <span className="cl-restored">Restored {when(row.restoredAt)}</span> : <button type="button" className="btn" onClick={() => setRestore(row)}>Restore</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="cfg-hint">No cleanup done yet.</p>}
      </section>

      {confirm ? <ConfirmBox title="Clear this data?" danger lines={chosen.map((c) => [c.label, c.count])} total={total} needDelete filters={filtered ? { from, to, location: data.locations.find((l) => l.id === locationId)?.name } : null} onCancel={() => setConfirm(null)} onOk={run} okLabel="Clear data now" /> : null}
      {restore ? <ConfirmBox title="Restore this cleanup?" lines={[[`${(restore.categories || []).join(', ')}`, restore.total]]} total={restore.total} onCancel={() => setRestore(null)} onOk={doRestore} okLabel="Restore data" /> : null}
    </div>
  );
}

function ConfirmBox({ title, lines, total, needDelete, danger, filters, onCancel, onOk, okLabel }) {
  const [text, setText] = useState('');
  const [password, setPassword] = useState('');
  const [ack, setAck] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onCancel]);
  const ready = (!needDelete || (text.trim().toUpperCase() === 'DELETE' && ack)) && password;
  async function go() {
    setBusy(true); setError('');
    const problem = await onOk({ confirm: text, password });
    setBusy(false);
    if (problem) setError(problem);
  }
  return (
    <div className="cl-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="cl-box" role="dialog" aria-modal="true" aria-label={title}>
        <h3>{title}</h3>
        <ul>{lines.map(([label, count]) => <li key={label}><span>{label}</span><b>{fmt(count)}</b></li>)}</ul>
        <p className="cl-sum">Total <b>{fmt(total)}</b> record(s){filters ? ` · limited to ${[filters.from && `from ${filters.from}`, filters.to && `to ${filters.to}`, filters.location].filter(Boolean).join(', ')}` : ''}</p>
        {needDelete ? (
          <>
            <label className="cl-ack"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand this removes the data from every screen and report.</label>
            <label className="cfg-field"><span>Type <b>DELETE</b> to confirm</span><input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="DELETE" /></label>
          </>
        ) : null}
        <label className="cfg-field">Your password<input type="password" autoFocus={!needDelete} value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ready) go(); }} /></label>
        {error ? <p className="cl-bad">{error}</p> : null}
        <footer>
          <button type="button" className="btn" onClick={onCancel}>Cancel</button>
          <button type="button" className={danger ? 'btn primary danger' : 'btn primary'} disabled={!ready || busy} onClick={go}>{busy ? 'Working…' : okLabel}</button>
        </footer>
      </div>
    </div>
  );
}
