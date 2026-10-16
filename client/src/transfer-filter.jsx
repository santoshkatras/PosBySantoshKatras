import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';
import { KIND_LABEL, inr, message, num } from './opening-stock.jsx';

// Collapsible "Filter" panel of the Create Transfer window: narrows the item search
// (item type, category, brand) and loads items automatically from sales, reorder
// levels or stock — sales bill wise, today's / yesterday's sale, last X days / months /
// years, a manual date range, below reorder level, out of stock, or in stock at source.

export const LOAD_MODES = [
  ['manual', 'Manual entry (pick items yourself)'],
  ['bills', 'Sales Bill wise'],
  ['today', "Today's sale"],
  ['yesterday', "Yesterday's sale"],
  ['last', 'Last sale — X days / months / years'],
  ['range', 'Sale between dates (manual selection)'],
  ['reorder', 'Below reorder level (at destination)'],
  ['zero', 'Out of stock at destination'],
  ['source', 'All items in stock at source'],
];
const SALES_MODES = ['bills', 'today', 'yesterday', 'last', 'range'];
const DEFAULT_RULE = { bills: 'sold', today: 'sold', yesterday: 'sold', last: 'sold', range: 'sold', reorder: 'reorder', zero: 'fixed', source: 'fixed' };
const UNIT_LABEL = { day: 'Day(s)', month: 'Month(s)', year: 'Year(s)' };

export const blankFilter = (kind) => ({
  type: '', category: '', brand: '', search: '',
  mode: 'manual', lastN: '7', lastUnit: 'day', from: '', to: '',
  billFrom: '', billTo: '', bills: [],
  salesOf: 'dest', qtyRule: 'sold', fixedQty: '1',
  inStockOnly: false, capToSource: kind === 'out', replace: false,
});

// Items that pass the item-type / category / brand / name filters.
export function scopeItems(items, f) {
  const q = String(f?.search || '').trim().toLowerCase();
  return (items || []).filter((item) => (!f?.type || item.kind === f.type)
    && (!f?.category || item.categoryId === f.category)
    && (!f?.brand || item.brandId === f.brand)
    && (!q || `${item.name} ${item.code} ${(item.codes || []).join(' ')}`.toLowerCase().includes(q)));
}

const pad = (v) => String(v).padStart(2, '0');
const toDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDay = (day) => { const [y, m, d] = String(day).split('-').map(Number); return new Date(y, m - 1, d); };
function shift(day, { days = 0, months = 0 }) {
  const d = parseDay(day);
  if (months) { const want = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + months); d.setDate(Math.min(want, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate())); }
  if (days) d.setDate(d.getDate() + days);
  return toDay(d);
}
const nice = (day) => (day ? parseDay(day).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');

// The sales period a filter stands for.
export function salesPeriod(f, today) {
  if (f.mode === 'today') return { from: today, to: today };
  if (f.mode === 'yesterday') { const y = shift(today, { days: -1 }); return { from: y, to: y }; }
  if (f.mode === 'last') {
    const count = Math.max(1, Math.floor(num(f.lastN)) || 1);
    if (f.lastUnit === 'day') return { from: shift(today, { days: -(count - 1) }), to: today };
    const months = f.lastUnit === 'year' ? count * 12 : count;
    return { from: shift(shift(today, { months: -months }), { days: 1 }), to: today };
  }
  if (f.mode === 'range') return { from: f.from, to: f.to };
  return null;
}

function summary(f, data, today) {
  const parts = [];
  if (f.type) parts.push(KIND_LABEL[f.type]);
  if (f.category) parts.push(data?.categories.find((row) => row.id === f.category)?.name || 'Category');
  if (f.brand) parts.push(data?.brands.find((row) => row.id === f.brand)?.name || 'Brand');
  if (f.search) parts.push(`“${f.search}”`);
  if (f.mode !== 'manual') {
    const period = salesPeriod(f, today);
    if (f.mode === 'last') parts.push(`Last ${Math.max(1, Math.floor(num(f.lastN)) || 1)} ${UNIT_LABEL[f.lastUnit].replace('(s)', num(f.lastN) > 1 ? 's' : '')} sale`);
    else if (f.mode === 'bills') parts.push(`${f.bills.length} sales bill(s)`);
    else parts.push(LOAD_MODES.find(([id]) => id === f.mode)?.[1]);
    if (period?.from && period?.to && f.mode !== 'today' && f.mode !== 'yesterday') parts.push(`${nice(period.from)} → ${nice(period.to)}`);
  }
  return parts;
}

export function TransferFilter({ kind, filter, setFilter, setup, fromId, toId, onLoad }) {
  const { request } = useAuth();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem('skpos.transferFilter.open') === '1'; } catch { return false; } });
  const [data, setData] = useState(null);
  const [bills, setBills] = useState(null);
  const [billQuery, setBillQuery] = useState('');
  const [billError, setBillError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const today = data?.today || setup?.today || toDay(new Date());
  const f = filter;
  const set = (patch) => { setFilter({ ...f, ...patch }); setResult(null); };
  const locs = setup?.locations || [];
  const nameOf = (id) => locs.find((row) => row.id === id)?.name || '';
  const salesLoc = f.salesOf === 'source' ? fromId : f.salesOf === 'all' ? '' : toId;
  const isSales = SALES_MODES.includes(f.mode);
  const period = salesPeriod(f, today);

  function toggle() {
    const next = !open; setOpen(next);
    try { localStorage.setItem('skpos.transferFilter.open', next ? '1' : '0'); } catch { /* storage off */ }
  }
  useEffect(() => { request('/transfers/filter-data').then(setData).catch(() => setData({ categories: [], brands: [], minStock: {}, today: setup?.today })); }, [request]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!data?.today) return;
    if (!f.from && !f.billFrom) setFilter((cur) => ({ ...cur, from: shift(data.today, { days: -6 }), to: data.today, billFrom: shift(data.today, { days: -29 }), billTo: data.today }));
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bill list for "Sales Bill wise".
  useEffect(() => {
    if (f.mode !== 'bills' || !open) return;
    if (f.salesOf !== 'all' && !salesLoc) { setBills([]); setBillError('Choose the locations first.'); return; }
    setBills(null); setBillError('');
    const qs = new URLSearchParams({ locationId: salesLoc || '', from: f.billFrom || '', to: f.billTo || '' });
    request(`/transfers/sales-bills?${qs}`).then((res) => setBills(res.items)).catch((err) => { setBills([]); setBillError(message(err)); });
  }, [f.mode, f.billFrom, f.billTo, salesLoc, f.salesOf, open, request]);

  const shownBills = useMemo(() => {
    const q = billQuery.trim().toLowerCase();
    return (bills || []).filter((row) => !q || `${row.number} ${row.party}`.toLowerCase().includes(q));
  }, [bills, billQuery]);
  const scopedCount = useMemo(() => scopeItems(setup?.items, f).length, [setup, f]);

  async function load() {
    setResult(null);
    if (!fromId || !toId) { setResult({ error: 'Choose the From and To locations first.' }); return; }
    if (f.mode === 'manual') { setResult({ info: `${scopedCount} item(s) match — pick them in the item code / name box below.` }); return; }
    if (f.mode === 'bills' && !f.bills.length) { setResult({ error: 'Tick at least one sales bill.' }); return; }
    if (f.mode === 'range' && (!f.from || !f.to)) { setResult({ error: 'Choose the From and To dates.' }); return; }
    if (period && period.from > period.to) { setResult({ error: 'The From date is after the To date.' }); return; }
    const fixed = Math.max(num(f.fixedQty), 0);
    setBusy(true);
    try {
      let sold = null; let billCount = 0;
      if (isSales) {
        const body = f.mode === 'bills' ? { locationId: salesLoc, bills: f.bills } : { locationId: salesLoc, from: period.from, to: period.to };
        const res = await request('/transfers/sales-qty', { method: 'POST', body });
        sold = res.sold; billCount = res.bills;
      }
      const stockAt = (v, loc) => num(setup?.stock?.[v]?.[loc]);
      const picks = [];
      for (const item of scopeItems(setup.items, f)) {
        const qty = {}; const hints = [];
        for (const row of item.variants) {
          const v = row.variantId; const dest = stockAt(v, toId); const src = stockAt(v, fromId);
          let want = 0;
          if (isSales) {
            const s = num(sold[v]);
            if (!(s > 0)) continue;
            want = rule === 'shortfall' ? s - Math.max(dest, 0) : rule === 'fixed' ? fixed : s;
            hints.push(`sold ${s}`);
          } else if (f.mode === 'reorder') {
            const min = num(data?.minStock?.[v]);
            if (!(min > 0) || dest >= min) continue;
            want = rule === 'fixed' ? fixed : min - Math.max(dest, 0);
            hints.push(`reorder ${min}`);
          } else if (f.mode === 'zero') {
            if (dest > 0) continue;
            want = fixed;
          } else if (f.mode === 'source') {
            if (src <= 0) continue;
            want = rule === 'all' ? src : fixed;
          }
          if (f.inStockOnly && src <= 0) continue;
          if (f.capToSource) want = Math.min(want, Math.max(src, 0));
          want = Math.round(want * 1000) / 1000;
          if (item.kind === 'serial') want = Math.floor(want);
          if (want > 0) qty[v] = want;
        }
        if (Object.keys(qty).length) picks.push({ item, qty, hint: hints.length ? hints.slice(0, 3).join(', ') + (hints.length > 3 ? '…' : '') : '' });
      }
      if (!picks.length) {
        setResult({ error: isSales ? `No items to load — ${billCount ? `${billCount} bill(s) found but nothing matched the filters` : 'no sales bills in this period'}.` : 'No items matched these filters.' });
        return;
      }
      const done = onLoad(picks, f.replace);
      const qty = picks.reduce((sum, p) => sum + Object.values(p.qty).reduce((a, b) => a + b, 0), 0);
      setResult({ ok: `Loaded ${picks.length} item(s), qty ${Math.round(qty * 1000) / 1000}${isSales ? ` from ${billCount} sales bill(s)` : ''}${done?.updated ? ` · ${done.updated} line(s) updated` : ''}.` });
    } catch (err) { setResult({ error: message(err) }); } finally { setBusy(false); }
  }

  const chips = summary(f, data, today);
  const toggleBill = (number) => set({ bills: f.bills.includes(number) ? f.bills.filter((x) => x !== number) : [...f.bills, number] });
  const qtyRules = isSales ? [['sold', 'Sold qty'], ['shortfall', 'Sold qty − stock at destination'], ['fixed', 'Fixed qty per item']]
    : f.mode === 'reorder' ? [['reorder', 'Top up to reorder level'], ['fixed', 'Fixed qty per item']]
      : f.mode === 'source' ? [['fixed', 'Fixed qty per item'], ['all', 'Full stock at source']]
        : [['fixed', 'Fixed qty per item']];
  const rule = qtyRules.some(([id]) => id === f.qtyRule) ? f.qtyRule : qtyRules[0][0];

  return (
    <section className={open ? 'tr-filter open' : 'tr-filter'}>
      <button type="button" className="tr-filter-bar" aria-expanded={open} onClick={toggle}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="tr-filter-ico"><path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" /></svg>
        <strong>Filter</strong>
        {chips.length ? <span className="tr-filter-chips">{chips.map((c) => <em key={c}>{c}</em>)}</span> : <span className="tr-filter-hint">Item type, load items from sales bills, today’s sale, last X days / months / years…</span>}
        <span className="tr-filter-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open ? (
        <div className="tr-filter-body">
          <div className="tr-filter-grid">
            <label>Item type
              <select value={f.type} onChange={(e) => set({ type: e.target.value })}>
                <option value="">All item types</option>
                {Object.entries(KIND_LABEL).map(([id, label]) => <option key={id} value={id}>{label === 'Matrix' ? 'Matrix (variants)' : label}</option>)}
              </select>
            </label>
            <label>Category
              <select value={f.category} onChange={(e) => set({ category: e.target.value })}>
                <option value="">All categories</option>
                {(data?.categories || []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <label>Brand
              <select value={f.brand} onChange={(e) => set({ brand: e.target.value })}>
                <option value="">All brands</option>
                {(data?.brands || []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
            <label>Item name / code contains
              <input value={f.search} placeholder="e.g. mouse" onChange={(e) => set({ search: e.target.value })} />
            </label>
          </div>

          <div className="tr-filter-grid">
            <label className="wide">Load items based on
              <select value={f.mode} onChange={(e) => set({ mode: e.target.value, qtyRule: DEFAULT_RULE[e.target.value] || 'fixed' })} data-filter="mode">
                {LOAD_MODES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
              </select>
            </label>
            {f.mode === 'last' ? (
              <label>Last
                <span className="tr-filter-pair">
                  <input type="number" min="1" max="999" value={f.lastN} onChange={(e) => set({ lastN: e.target.value.replace(/\D/g, '').slice(0, 3) })} aria-label="How many" />
                  <select value={f.lastUnit} onChange={(e) => set({ lastUnit: e.target.value })} aria-label="Days, months or years">
                    {Object.entries(UNIT_LABEL).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </span>
              </label>
            ) : null}
            {f.mode === 'range' ? (
              <>
                <label>From date<input type="date" value={f.from} max={f.to || today} onChange={(e) => set({ from: e.target.value })} /></label>
                <label>To date<input type="date" value={f.to} min={f.from} max={today} onChange={(e) => set({ to: e.target.value })} /></label>
              </>
            ) : null}
            {isSales ? (
              <label>Sales of
                <select value={f.salesOf} onChange={(e) => set({ salesOf: e.target.value, bills: [] })}>
                  <option value="dest">{kind === 'request' ? 'Your location' : 'Destination'}{toId ? ` — ${nameOf(toId)}` : ''}</option>
                  <option value="source">{kind === 'request' ? 'Supplying location' : 'Source'}{fromId ? ` — ${nameOf(fromId)}` : ''}</option>
                  <option value="all">All my locations</option>
                </select>
              </label>
            ) : null}
            {f.mode !== 'manual' ? (
              <label>Quantity to load
                <select value={rule} onChange={(e) => set({ qtyRule: e.target.value })}>
                  {qtyRules.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select>
              </label>
            ) : null}
            {f.mode !== 'manual' && rule === 'fixed' ? <label>Qty per item<input className="tr-filter-num" inputMode="decimal" value={f.fixedQty} onChange={(e) => set({ fixedQty: e.target.value.replace(/[^\d.]/g, '') })} /></label> : null}
          </div>
          {period && f.mode !== 'range' ? <p className="tr-filter-period">Sales period: <strong>{nice(period.from)}</strong>{period.to !== period.from ? <> → <strong>{nice(period.to)}</strong></> : null}</p> : null}

          {f.mode === 'bills' ? (
            <div className="tr-bills">
              <div className="tr-bills-top">
                <label>Bills from<input type="date" value={f.billFrom} max={f.billTo || today} onChange={(e) => set({ billFrom: e.target.value })} /></label>
                <label>to<input type="date" value={f.billTo} min={f.billFrom} max={today} onChange={(e) => set({ billTo: e.target.value })} /></label>
                <input className="tr-bills-q" value={billQuery} placeholder="Search bill no. / customer" onChange={(e) => setBillQuery(e.target.value)} />
                <span className="tr-bills-count">{f.bills.length} selected</span>
                {shownBills.length ? <button type="button" className="cfg-link" onClick={() => set({ bills: [...new Set([...f.bills, ...shownBills.map((row) => row.number)])] })}>Select all shown</button> : null}
                {f.bills.length ? <button type="button" className="cfg-link" onClick={() => set({ bills: [] })}>Clear</button> : null}
              </div>
              <div className="tr-bills-list">
                {billError ? <p className="tr-bills-msg bad">{billError}</p> : bills === null ? <p className="tr-bills-msg">Loading sales bills…</p> : !shownBills.length ? <p className="tr-bills-msg">No sales bills in this period.</p> : (
                  <table>
                    <thead><tr><th aria-label="Select" /><th>Bill No.</th><th>Date</th><th>Customer</th>{f.salesOf === 'all' ? <th>Location</th> : null}<th className="num">Items</th><th className="num">Qty</th><th className="num">Total</th></tr></thead>
                    <tbody>
                      {shownBills.map((row) => (
                        <tr key={row.number} className={f.bills.includes(row.number) ? 'on' : undefined} onClick={() => toggleBill(row.number)}>
                          <td><input type="checkbox" checked={f.bills.includes(row.number)} onChange={() => toggleBill(row.number)} onClick={(e) => e.stopPropagation()} aria-label={`Select ${row.number}`} /></td>
                          <td className="mono">{row.number}</td><td>{nice(row.date)}</td><td>{row.party}</td>{f.salesOf === 'all' ? <td>{row.locationName}</td> : null}
                          <td className="num">{row.lineCount}</td><td className="num">{row.qty}</td><td className="num">{inr(row.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          ) : null}

          <div className="tr-filter-foot">
            {f.mode !== 'manual' ? (
              <>
                <label className="tr-filter-check"><input type="checkbox" checked={f.inStockOnly} onChange={(e) => set({ inStockOnly: e.target.checked })} />Only items in stock at {kind === 'request' ? 'supplying location' : 'source'}</label>
                <label className="tr-filter-check"><input type="checkbox" checked={f.capToSource} onChange={(e) => set({ capToSource: e.target.checked })} />Limit qty to {kind === 'request' ? 'supplier' : 'source'} stock</label>
                <label className="tr-filter-check"><input type="checkbox" checked={f.replace} onChange={(e) => set({ replace: e.target.checked })} />Replace lines already added</label>
              </>
            ) : <span className="tr-filter-note">{scopedCount} item(s) match — the item code / name search below shows only these.</span>}
            <span className="tr-filter-sp" />
            {result ? <span className={result.error ? 'tr-filter-res bad' : 'tr-filter-res'}>{result.error || result.ok || result.info}</span> : null}
            <button type="button" className="btn" onClick={() => { setFilter({ ...blankFilter(kind), from: f.from, to: f.to, billFrom: f.billFrom, billTo: f.billTo }); setResult(null); }}>Clear filters</button>
            {f.mode !== 'manual' ? <button type="button" className="btn primary" disabled={busy || !setup} onClick={load} data-filter="load">{busy ? 'Loading…' : 'Load items'}</button> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
