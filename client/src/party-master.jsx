import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { STATES } from '../../shared/domain.mjs';
import { ApiError } from './api.js';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { FilterBar } from './filter-bar.jsx';
import { ColumnPicker, useColumns } from './column-picker.jsx';
import { useFitHeight } from './fit-height.js';
import './item-list.css';
import './item-master.css';
import './party-master.css';

// Sales → Customers and Purchase → Suppliers share one list and one master,
// built the same way as the Product list and Item Master.
const META = {
  customer: { title: 'Customer', plural: 'Customers', path: '/customers', mobileRequired: true },
  supplier: { title: 'Supplier', plural: 'Suppliers', path: '/suppliers', mobileRequired: false },
};

const TYPES = [
  { id: 'registered', title: 'Registered', hint: 'Regular GST', note: 'Has a GSTIN, charges and claims GST', icon: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3' },
  { id: 'unregistered', title: 'Unregistered', hint: 'No GSTIN', note: 'Consumer or small business without GST', icon: 'M8 7a4 4 0 1 1 8 0 4 4 0 0 1-8 0zM6 20c1-3 3.2-4.5 6-4.5S17 17 18 20' },
  { id: 'composition', title: 'Composition', hint: 'Composition scheme', note: 'Has a GSTIN, pays tax at a fixed rate', icon: 'M4 7h16v12H4zM4 7l8 5 8-5' },
];
const TYPE_LABEL = Object.fromEntries(TYPES.map((item) => [item.id, item.title]));

const COLUMNS = [
  ['code', 'Code'],
  ['name', 'Name'],
  ['type', 'GST Type'],
  ['gstin', 'GSTIN'],
  ['mobile', 'Mobile'],
  ['contact', 'Contact Person'],
  ['email', 'Email'],
  ['area', 'Area'],
  ['city', 'City'],
  ['district', 'District'],
  ['state', 'State'],
  ['pincode', 'Pincode'],
  ['bank', 'Bank'],
  ['creditDays', 'Credit Days'],
  ['creditLimit', 'Credit Limit'],
  ['status', 'Status'],
];
const DEFAULT_COLUMNS = ['code', 'name', 'type', 'gstin', 'mobile', 'city', 'state', 'status'];
const NUMERIC = ['creditDays', 'creditLimit'];

function message(error) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

function inr(value) {
  if (value == null || value === '') return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function cell(row, id) {
  switch (id) {
    case 'type': return TYPE_LABEL[row.type] || '—';
    case 'contact': return row.contactPerson || '—';
    case 'bank': return row.bank.bankName ? `${row.bank.bankName}${row.bank.accountNumber ? ` ·· ${row.bank.accountNumber.slice(-4)}` : ''}` : '—';
    case 'creditLimit': return inr(row.creditLimit);
    case 'status': return row.active ? 'Active' : 'Inactive';
    default: return row[id] || '—';
  }
}

// ======================= Page: list or master =======================
export function PartyPage({ kind }) {
  const [params, setParams] = useSearchParams();
  const editId = params.get('edit');
  const composing = params.get('compose') === '1' || Boolean(editId);
  const [notice, setNotice] = useState('');
  const feedback = useFeedback();
  async function edit(id) {
    if (await feedback.confirm({ title: `Edit this ${kind}?`, message: `Do you want to edit this ${kind}'s details?`, confirmLabel: 'Yes, edit' })) setParams({ edit: id });
  }
  if (composing) {
    return (
      <PartyMaster
        key={editId || 'new'}
        kind={kind}
        editId={editId}
        onClose={(text) => { setNotice(text || ''); setParams({}); }}
      />
    );
  }
  return <PartyList kind={kind} notice={notice} onNotice={setNotice} onAdd={() => setParams({ compose: '1' })} onEdit={edit} />;
}

// ======================= List =======================
function PartyList({ kind, notice, onNotice, onAdd, onEdit }) {
  const meta = META[kind];
  const { request } = useAuth();
  const feedback = useFeedback();
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState(emptyFilters);
  const [gstQuery, setGstQuery] = useState('');
  const [columns, setColumns] = useColumns(`party_${kind}`, DEFAULT_COLUMNS);
  const [selected, setSelected] = useState(() => new Set());
  const [openId, setOpenId] = useState('');
  const [panelTab, setPanelTab] = useState('general');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const pageRef = useRef(null);
  useFitHeight(pageRef);

  async function load() {
    const data = await request(`/parties/${kind}`);
    setRows(data.items);
    setCanEdit(data.canEdit);
    setLoading(false);
  }
  useEffect(() => { load().catch((error) => { onNotice(message(error)); setLoading(false); }); }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const states = useMemo(() => [...new Map(rows.filter((row) => row.stateCode).map((row) => [row.stateCode, row.state])).entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]))), [rows]);
  const gst = gstQuery.trim().toUpperCase();
  const visible = rows.filter((row) => {
    if (filters.type !== 'all' && row.type !== filters.type) return false;
    if (filters.state !== 'all' && row.stateCode !== filters.state) return false;
    if (filters.status === 'active' && !row.active) return false;
    if (filters.status === 'inactive' && row.active) return false;
    if (filters.bank === 'yes' && !row.bank.accountNumber) return false;
    if (filters.bank === 'no' && row.bank.accountNumber) return false;
    if (gst && !row.gstin.includes(gst)) return false;
    const q = filters.query.trim().toLowerCase();
    if (q && !`${row.code} ${row.name} ${row.mobile} ${row.gstin} ${row.city} ${row.contactPerson}`.toLowerCase().includes(q)) return false;
    return true;
  });

  const pages = Math.max(1, Math.ceil(visible.length / pageSize));
  const currentPage = Math.min(page, pages);
  const start = (currentPage - 1) * pageSize;
  const pageRows = visible.slice(start, start + pageSize);
  const open = rows.find((row) => row.id === openId) || null;

  async function toggleActive() {
    if (!open) return;
    if (!(await feedback.confirm({ tone: open.active ? 'danger' : 'question', title: open.active ? `Mark ${open.name} inactive?` : `Activate ${open.name}?`, message: open.active ? 'Inactive parties are hidden from new documents.' : 'The party will be available in new documents again.', confirmLabel: open.active ? 'Mark inactive' : 'Activate' }))) return;
    try {
      await request(`/parties/${kind}/${open.id}`, { method: 'PATCH', body: { active: !open.active } });
      await load();
      feedback.toast(`${open.name} ${open.active ? 'marked inactive' : 'activated'}.`);
    } catch (error) {
      onNotice(message(error));
    }
  }

  return (
    <div ref={pageRef} className={open ? 'il open fit-page' : 'il fit-page'}>
      <section className="il-main">
        <header className="il-head">
          <div>
            <h2>{meta.title} Master</h2>
            <p>Manage your {meta.plural.toLowerCase()} with GST type, address and bank details</p>
          </div>
          <div className="il-tools">
            <button type="button" className="il-btn il-refresh" data-sc="refresh" onClick={() => load().catch((error) => onNotice(message(error)))} title="Refresh the list" aria-label="Refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6" /></svg></button>
            {canEdit ? <button type="button" className="il-btn primary" data-sc="new" onClick={onAdd}>+ Add {meta.title}</button> : null}
          </div>
        </header>
        {notice ? <p className={/saved|added|updated/i.test(notice) ? 'pm-ok' : 'form-error'}>{notice}</p> : null}
        <FilterBar
          placeholder="Search code, name, mobile, city..."
          values={filters}
          onChange={(next) => { setFilters(next); setPage(1); }}
          extra={(
            <label className="il-search pm-gst-search" title="Search by GST number">
              <span className="pm-gst-tag">GSTIN</span>
              <input value={gstQuery} placeholder="Search GST number" aria-label="Search by GST number" maxLength={15} onChange={(event) => { setGstQuery(event.target.value.toUpperCase()); setPage(1); }} />
              {gstQuery ? <button type="button" className="il-search-x" aria-label="Clear GST search" onClick={() => setGstQuery('')}>×</button> : null}
            </label>
          )}
          fields={[
            { id: 'type', label: 'GST Type', options: [['all', 'All'], ...TYPES.map((item) => [item.id, item.title])] },
            { id: 'state', label: 'State', options: [['all', 'All'], ...states] },
            { id: 'bank', label: 'Bank Details', options: [['all', 'All'], ['yes', 'Added'], ['no', 'Not added']] },
            { id: 'status', label: 'Status', options: [['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']] },
          ]}
        />
        <div className="il-table-wrap">
          <table>
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select page" checked={pageRows.length > 0 && pageRows.every((row) => selected.has(row.id))} onChange={(event) => setSelected((current) => {
                  const next = new Set(current);
                  for (const row of pageRows) { if (event.target.checked) next.add(row.id); else next.delete(row.id); }
                  return next;
                })} /></th>
                {COLUMNS.filter(([id]) => columns.includes(id)).map(([id, label]) => <th key={id} className={NUMERIC.includes(id) ? 'num' : undefined}>{label}</th>)}
                <th className="col-set"><ColumnPicker columns={COLUMNS} value={columns} onChange={setColumns} defaults={DEFAULT_COLUMNS} /></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length ? pageRows.map((row) => (
                <tr key={row.id} className={openId === row.id ? 'on' : undefined} onClick={() => { setOpenId(row.id); setPanelTab('general'); }} onDoubleClick={() => canEdit && onEdit(row.id)}>
                  <td onClick={(event) => event.stopPropagation()}>
                    <input type="checkbox" aria-label={`Select ${row.name}`} checked={selected.has(row.id)} onChange={(event) => setSelected((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(row.id); else next.delete(row.id);
                      return next;
                    })} />
                  </td>
                  {COLUMNS.filter(([id]) => columns.includes(id)).map(([id]) => {
                    if (id === 'code') return <td key={id} className="code">{row.code}</td>;
                    if (id === 'gstin') return <td key={id} className="pm-mono">{row.gstin || '—'}</td>;
                    if (id === 'type') return <td key={id}><span className={`pm-type ${row.type}`}>{TYPE_LABEL[row.type]}</span></td>;
                    if (id === 'status') return <td key={id}><span className={`il-status ${row.active ? 'active' : 'inactive'}`}>{cell(row, id)}</span></td>;
                    return <td key={id} className={NUMERIC.includes(id) ? 'num' : undefined}>{cell(row, id)}</td>;
                  })}
                  <td className="col-set" />
                </tr>
              )) : <tr><td className="empty" colSpan={columns.length + 2}>{loading ? 'Loading…' : rows.length ? `No ${meta.plural.toLowerCase()} match these filters.` : `No ${meta.plural.toLowerCase()} yet. Use “+ Add ${meta.title}”.`}</td></tr>}
            </tbody>
          </table>
        </div>
        <footer className="il-pager">
          <span className="il-total">Total {meta.plural}: <strong>{visible.length}</strong><em>Showing {visible.length ? start + 1 : 0}–{Math.min(start + pageSize, visible.length)}</em>{selected.size ? <em>{selected.size} selected</em> : null}</span>
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
            <div><strong>{meta.title} Details</strong></div>
            <button type="button" aria-label="Close details" onClick={() => setOpenId('')}>×</button>
          </header>
          <div className="il-identity">
            <span>{open.name.slice(0, 1)}</span>
            <div>
              <small>{open.code}</small>
              <strong>{open.name}</strong>
              <em className={open.active ? 'active' : 'inactive'}>{open.active ? 'Active' : 'Inactive'}</em>
            </div>
          </div>
          <div className="il-detail-actions">
            {canEdit ? <button type="button" className="il-btn primary" onClick={() => onEdit(open.id)}>Edit</button> : null}
            {canEdit ? <button type="button" className="il-btn" onClick={toggleActive}>{open.active ? 'Inactive' : 'Activate'}</button> : null}
            {kind === 'customer' ? <button type="button" className="il-btn" onClick={() => navigate(`/customers/${open.id}`)}>History</button> : null}
          </div>
          <div className="il-detail-tabs">
            {[['general', 'General'], ['address', 'Address'], ['bank', 'Bank'], ['credit', 'Credit']].map(([id, label]) => (
              <button key={id} type="button" className={panelTab === id ? 'on' : undefined} onClick={() => setPanelTab(id)}>{label}</button>
            ))}
          </div>
          {panelTab === 'general' ? <Facts title="Basic & GST" rows={[
            ['Code', open.code], ['Name', open.name], ['GST Type', TYPE_LABEL[open.type]], ['GSTIN', open.gstin || '—'], ['PAN', open.pan || '—'],
            ['Mobile', open.mobile || '—'], ['Alt. Mobile', open.altMobile || '—'], ['Email', open.email || '—'], ['Contact Person', open.contactPerson || '—'],
          ]} /> : null}
          {panelTab === 'address' ? <Facts title="Address" rows={[
            ['Address', [open.address1, open.address2].filter(Boolean).join(', ') || '—'], ['Area', open.area || '—'], ['City', open.city || '—'],
            ['Taluka', open.taluka || '—'], ['District', open.district || '—'], ['State', open.state || '—'], ['Pincode', open.pincode || '—'], ['Country', open.country || '—'],
          ]} /> : null}
          {panelTab === 'bank' ? <Facts title="Bank Details" rows={[
            ['Account Holder', open.bank.holder || '—'], ['Account Number', open.bank.accountNumber || '—'], ['Account Type', open.bank.accountNumber ? open.bank.accountType : '—'],
            ['IFSC', open.bank.ifsc || '—'], ['Bank', open.bank.bankName || '—'], ['Branch', open.bank.branch || '—'], ['Bank Address', open.bank.address || '—'],
            ['MICR', open.bank.micr || '—'], ['UPI ID', open.bank.upi || '—'],
          ]} /> : null}
          {panelTab === 'credit' ? <Facts title="Credit & Notes" rows={[
            ['Credit Days', open.creditDays === '' ? '—' : open.creditDays], ['Credit Limit', inr(open.creditLimit)],
            ['Opening Balance', open.openingBalance === '' ? '—' : `${inr(open.openingBalance)} ${open.balanceType === 'cr' ? 'Cr' : 'Dr'}`], ['Notes', open.notes || '—'],
          ]} /> : null}
        </aside>
      ) : null}
    </div>
  );
}

function emptyFilters() {
  return { type: 'all', state: 'all', bank: 'all', status: 'all', query: '' };
}

function Facts({ title, rows }) {
  return (
    <section className="il-facts">
      <h3>{title}</h3>
      {rows.map(([label, value]) => <p key={label}><span>{label}</span><strong>{value}</strong></p>)}
    </section>
  );
}

// ======================= Master form =======================
function blankParty(kind) {
  return {
    code: '', name: '', type: 'unregistered', gstin: '', pan: '', mobile: '', altMobile: '', email: '', contactPerson: '',
    pincode: '', area: '', address1: '', address2: '', city: '', taluka: '', district: '', stateCode: '', country: 'India',
    creditDays: '', creditLimit: '', openingBalance: '', balanceType: kind === 'supplier' ? 'cr' : 'dr', notes: '', active: true,
    bank: { holder: '', accountNumber: '', ifsc: '', bankName: '', branch: '', address: '', city: '', micr: '', accountType: 'Current', upi: '' },
  };
}

const SECTIONS = [['basic', 'Basic Details'], ['gst', 'GST Details'], ['address', 'Address'], ['bank', 'Bank Details'], ['credit', 'Credit & Other']];

function SearchIcon() {
  return <svg viewBox="0 0 24 24"><path d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM21 21l-5.2-5.2" /></svg>;
}

function PartyMaster({ kind, editId, onClose }) {
  const meta = META[kind];
  const { request, session } = useAuth();
  const feedback = useFeedback();
  const [draft, setDraft] = useState(() => blankParty(kind));
  const [loading, setLoading] = useState(Boolean(editId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [areas, setAreas] = useState([]);
  const [pinState, setPinState] = useState({ status: 'idle', message: '' });
  const [gstState, setGstState] = useState({ status: 'idle', message: '', matches: [] });
  const [ifscState, setIfscState] = useState({ status: 'idle', message: '' });
  const [acctState, setAcctState] = useState({ status: 'idle', message: '' });
  const [section, setSection] = useState('basic');
  const nameRef = useRef(null);
  const formRef = useRef(null);
  const addAnother = useRef(false);
  const lastPin = useRef('');
  const lastIfsc = useRef('');

  useEffect(() => {
    if (!editId) {
      request(`/parties/${kind}`).then((data) => setDraft((current) => ({ ...current, code: data.nextCode }))).catch(() => {});
      setTimeout(() => nameRef.current?.focus(), 50);
      return;
    }
    request(`/parties/${kind}/${editId}`).then((data) => {
      setDraft({ ...blankParty(kind), ...data, bank: { ...blankParty(kind).bank, ...data.bank } });
      lastPin.current = data.pincode;
      lastIfsc.current = data.bank.ifsc;
      if (data.area) setAreas([{ name: data.area }]);
      setLoading(false);
    }).catch((err) => { setError(message(err)); setLoading(false); });
  }, [kind, editId, request]);

  const set = (patch) => setDraft((current) => ({ ...current, ...patch }));
  const setBank = (patch) => setDraft((current) => ({ ...current, bank: { ...current.bank, ...patch } }));

  // ---------- pincode → area, taluka, district, state ----------
  async function fetchPincode(pin, keepArea = '') {
    if (!/^[1-9]\d{5}$/.test(pin)) { setPinState({ status: 'error', message: 'Enter a 6-digit pincode.' }); return; }
    lastPin.current = pin;
    setPinState({ status: 'loading', message: `Finding areas for ${pin}…` });
    try {
      const data = await request(`/parties/lookup/pincode/${pin}`);
      setAreas(data.areas);
      const chosen = data.areas.find((area) => area.name === keepArea) || (data.areas.length === 1 ? data.areas[0] : null);
      setDraft((current) => ({
        ...current,
        pincode: pin,
        area: chosen ? chosen.name : (data.areas.some((area) => area.name === current.area) ? current.area : ''),
        taluka: chosen?.taluka || data.taluka || current.taluka,
        city: current.city && current.pincode === pin ? current.city : (data.city || current.city),
        district: chosen?.district || data.district || current.district,
        stateCode: current.type !== 'unregistered' && current.gstin.length === 15 ? current.stateCode : (data.stateCode || current.stateCode),
        country: data.country || 'India',
      }));
      setPinState({ status: 'found', message: `${data.areas.length} area${data.areas.length === 1 ? '' : 's'} found in ${data.district}, ${data.state}.${data.areas.length > 1 ? ' Choose the area.' : ''}` });
    } catch (err) {
      setAreas([]);
      setPinState({ status: 'error', message: message(err) });
    }
  }

  function chooseArea(name) {
    const area = areas.find((item) => item.name === name);
    set({ area: name, ...(area?.taluka ? { taluka: area.taluka } : {}), ...(area?.district ? { district: area.district } : {}) });
  }

  // ---------- GSTIN ----------
  async function fetchGstin() {
    const gstin = draft.gstin.trim().toUpperCase();
    if (gstin.length !== 15) { setGstState({ status: 'error', message: 'GSTIN is 15 characters.', matches: [] }); return; }
    setGstState({ status: 'loading', message: 'Checking GSTIN…', matches: [] });
    try {
      const data = await request(`/parties/lookup/gstin/${gstin}`);
      const others = (data.matches || []).filter((item) => !(item.kind === kind && item.id === editId));
      setDraft((current) => ({
        ...current,
        gstin,
        pan: data.pan,
        stateCode: data.stateCode,
        ...(data.source === 'gst' ? {
          type: data.registrationType || current.type,
          name: current.name || data.tradeName || data.legalName,
          address1: current.address1 || data.address1 || '',
          address2: current.address2 || data.address2 || '',
          city: current.city || data.city || '',
          district: current.district || data.district || '',
        } : {}),
      }));
      const parts = [`Valid GSTIN · ${data.state} · PAN ${data.pan} · ${data.entityType}`];
      if (data.source === 'gst') parts.push(`${data.legalName}${data.tradeName && data.tradeName !== data.legalName ? ` (${data.tradeName})` : ''} · ${data.status || ''}`);
      else parts.push(data.note || 'State and PAN filled from the GSTIN.');
      setGstState({ status: 'found', message: parts.join('. '), matches: others });
      if (data.source === 'gst' && data.pincode && !draft.pincode) fetchPincode(String(data.pincode));
    } catch (err) {
      setGstState({ status: 'error', message: message(err), matches: [] });
    }
  }

  function applyMatch(match) {
    setDraft((current) => ({
      ...current,
      name: current.name || match.name,
      type: match.type,
      mobile: current.mobile || match.mobile,
      email: current.email || match.email,
      contactPerson: current.contactPerson || match.contactPerson,
      pincode: match.pincode, area: match.area, address1: match.address1, address2: match.address2, city: match.city,
      taluka: match.taluka, district: match.district, stateCode: match.stateCode, country: match.country,
      bank: current.bank.accountNumber ? current.bank : { ...match.bank },
    }));
    if (match.area) setAreas([{ name: match.area }]);
    lastPin.current = match.pincode;
    setGstState((current) => ({ ...current, message: `Details copied from ${match.code} · ${match.name}.`, matches: [] }));
  }

  // ---------- bank ----------
  async function fetchIfsc(code) {
    const ifsc = String(code || '').trim().toUpperCase();
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) { setIfscState({ status: 'error', message: 'IFSC must look like SBIN0001234.' }); return; }
    lastIfsc.current = ifsc;
    setIfscState({ status: 'loading', message: 'Fetching bank and branch…' });
    try {
      const data = await request(`/parties/lookup/ifsc/${ifsc}`);
      setBank({ ifsc, bankName: data.bankName, branch: data.branch, address: data.address, city: data.city, micr: data.micr || '' });
      setAcctState((current) => (current.status === 'found' ? current : { status: 'idle', message: '' }));
      setIfscState({ status: 'found', message: `${data.bankName}, ${data.branch} branch, ${data.city}${data.state ? `, ${data.state}` : ''}.` });
    } catch (err) {
      setIfscState({ status: 'error', message: message(err) });
    }
  }

  async function fetchAccount() {
    const number = draft.bank.accountNumber.replace(/\D/g, '');
    if (number.length < 6) { setAcctState({ status: 'error', message: 'Enter the full account number.' }); return; }
    setAcctState({ status: 'loading', message: 'Searching account number…' });
    try {
      const data = await request(`/parties/lookup/account/${number}`);
      if (data.found) {
        setBank({ ...data.bank });
        lastIfsc.current = data.bank.ifsc;
        setAcctState({ status: 'found', message: `Bank details filled from ${data.source}.` });
      } else {
        setAcctState({ status: 'idle', message: data.message });
      }
    } catch (err) {
      setAcctState({ status: 'error', message: message(err) });
    }
  }

  function chooseType(type) {
    set({ type, ...(type === 'unregistered' ? { gstin: '' } : {}) });
    if (type === 'unregistered') setGstState({ status: 'idle', message: '', matches: [] });
  }

  function jump(id) {
    setSection(id);
    formRef.current?.querySelector(`[data-section="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function reset() {
    setDraft((current) => ({ ...blankParty(kind), code: editId ? current.code : current.code }));
    setAreas([]);
    setPinState({ status: 'idle', message: '' });
    setGstState({ status: 'idle', message: '', matches: [] });
    setIfscState({ status: 'idle', message: '' });
    setAcctState({ status: 'idle', message: '' });
    setError('');
    lastPin.current = '';
    lastIfsc.current = '';
  }

  async function save(event) {
    event.preventDefault();
    setError('');
    setSaved('');
    if (!draft.name.trim()) { setError(`Enter the ${meta.title.toLowerCase()} name.`); jump('basic'); return; }
    if (draft.type !== 'unregistered' && !draft.gstin.trim()) { setError(`A ${TYPE_LABEL[draft.type].toLowerCase()} ${meta.title.toLowerCase()} needs a GSTIN.`); jump('gst'); return; }
    setPending(true);
    try {
      const body = { ...draft };
      delete body.code;
      const result = editId
        ? await request(`/parties/${kind}/${editId}`, { method: 'PATCH', body })
        : await request(`/parties/${kind}`, { method: 'POST', body });
      feedback.success({ title: `${meta.title} ${editId ? 'updated' : 'saved'} successfully`, message: `${result.code} · ${result.name}` });
      if (addAnother.current && !editId) {
        addAnother.current = false;
        const next = await request(`/parties/${kind}`).catch(() => null);
        reset();
        set({ code: next?.nextCode || '' });
        setSaved(`${result.code} · ${result.name} saved. Add the next ${meta.title.toLowerCase()}.`);
        jump('basic');
        nameRef.current?.focus();
      } else {
        onClose(`${result.code} · ${result.name} ${editId ? 'updated' : 'saved'}.`);
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
      addAnother.current = false;
    }
  }

  const gstOff = draft.type === 'unregistered';
  const homeState = session?.tenant?.stateCode;

  return (
    <form ref={formRef} className="im panel-closed pm" onSubmit={save}>
      <section className="im-main">
        <header className="im-head">
          <div className="im-title">
            <span className="im-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d={kind === 'customer' ? 'M8 7a4 4 0 1 1 8 0 4 4 0 0 1-8 0zM4 20c1.2-3.5 4-5 8-5s6.8 1.5 8 5' : 'M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'} /></svg>
            </span>
            <div>
              <h2>{meta.title} Master{editId ? ` · ${draft.code}` : ''}</h2>
              <p>{editId ? `Edit ${meta.title.toLowerCase()} details and save.` : `Add a new ${meta.title.toLowerCase()}. Pincode, GSTIN and IFSC fill the rest of the details for you.`}</p>
            </div>
          </div>
          <div className="im-actions">
            <button type="button" className="im-btn" onClick={reset}>Reset</button>
            {!editId ? <button type="submit" className="im-btn" disabled={pending} onClick={() => { addAnother.current = true; }}>Save &amp; Add New</button> : null}
            <button type="submit" className="im-btn primary" disabled={pending || loading} data-sc="party-save">{pending ? 'Saving…' : editId ? `Update ${meta.title}` : `Save ${meta.title}`}</button>
            <button type="button" className="im-btn ghost" onClick={() => onClose('')}>Back</button>
          </div>
        </header>

        <div className="im-tabs" role="tablist">
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={section === id} className={section === id ? 'on' : undefined} onClick={() => jump(id)}>{label}</button>
          ))}
        </div>

        {error ? <p className="form-error im-error">{error}</p> : null}
        {saved ? <p className="im-lookup found">{saved}</p> : null}
        {loading ? <p className="im-lookup loading">Loading…</p> : null}

        <div data-section="basic">
          <Block index="1" title="Basic Information">
            <div className="im-grid">
              <Field label={`${meta.title} Code (auto)`}><input value={draft.code} readOnly className="pm-readonly" /></Field>
              <Field label={`${meta.title} Name`} required><input ref={nameRef} required value={draft.name} onChange={(event) => set({ name: event.target.value })} /></Field>
              <Field label="Contact Person"><input value={draft.contactPerson} onChange={(event) => set({ contactPerson: event.target.value })} /></Field>
              <Field label="Mobile" required={meta.mobileRequired}><input inputMode="tel" maxLength={13} value={draft.mobile} onChange={(event) => set({ mobile: event.target.value.replace(/[^\d+ ]/g, '') })} /></Field>
              <Field label="Alternate Mobile"><input inputMode="tel" maxLength={13} value={draft.altMobile} onChange={(event) => set({ altMobile: event.target.value.replace(/[^\d+ ]/g, '') })} /></Field>
              <Field label="Email"><input type="email" value={draft.email} onChange={(event) => set({ email: event.target.value })} /></Field>
            </div>
          </Block>
        </div>

        <div data-section="gst">
          <Block index="2" title="GST Details">
            <div className="im-grid">
              <Field label="GST Type" required>
                <select value={draft.type} onChange={(event) => chooseType(event.target.value)}>
                  {TYPES.map((item) => <option key={item.id} value={item.id}>{item.title} – {item.hint}</option>)}
                </select>
              </Field>
              <Field label="GSTIN" required={!gstOff}>
                <div className="im-barcode">
                  <input
                    className="pm-upper"
                    disabled={gstOff}
                    maxLength={15}
                    placeholder={gstOff ? 'Not needed for unregistered' : '15-character GSTIN, press Enter'}
                    value={draft.gstin}
                    onChange={(event) => { const gstin = event.target.value.toUpperCase().replace(/[^0-9A-Z]/g, ''); set({ gstin }); if (gstState.status !== 'idle') setGstState({ status: 'idle', message: '', matches: [] }); }}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); fetchGstin(); } }}
                    onBlur={() => { if (draft.gstin.length === 15 && gstState.status === 'idle') fetchGstin(); }}
                  />
                  <button type="button" aria-label="Search GSTIN" title="Search GSTIN (Enter)" disabled={gstOff || gstState.status === 'loading'} onClick={fetchGstin}>
                    {gstState.status === 'loading' ? <span className="im-spin" /> : <SearchIcon />}
                  </button>
                </div>
              </Field>
              <Field label="PAN"><input className="pm-upper" maxLength={10} value={draft.pan} readOnly={!gstOff && draft.gstin.length === 15} onChange={(event) => set({ pan: event.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '') })} /></Field>
              <Field label="GST State">
                <input readOnly className="pm-readonly" value={draft.stateCode ? `${draft.stateCode} · ${STATES.find(([code]) => code === draft.stateCode)?.[1] || ''}${draft.stateCode === homeState ? ' (intra-state)' : homeState ? ' (inter-state)' : ''}` : '—'} />
              </Field>
            </div>
            {gstState.message ? <p className={`im-lookup ${gstState.status}`} role="status">{gstState.message}</p> : null}
            {gstState.matches.length ? (
              <div className="pm-matches">
                {gstState.matches.map((match) => (
                  <button key={`${match.kind}-${match.id}`} type="button" onClick={() => applyMatch(match)}>
                    Use details of <strong>{match.code} · {match.name}</strong> ({match.kind === 'customer' ? 'customer' : 'supplier'}, same GSTIN)
                  </button>
                ))}
              </div>
            ) : null}
          </Block>
        </div>

        <div data-section="address">
          <Block index="3" title="Address">
            <div className="im-grid">
              <Field label="Pincode">
                <div className="im-barcode">
                  <input
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6 digits, areas load automatically"
                    value={draft.pincode}
                    onChange={(event) => {
                      const pin = event.target.value.replace(/\D/g, '').slice(0, 6);
                      set({ pincode: pin });
                      if (pin.length === 6 && pin !== lastPin.current) fetchPincode(pin);
                      if (pin.length < 6) { setPinState({ status: 'idle', message: '' }); setAreas([]); lastPin.current = ''; }
                    }}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); fetchPincode(draft.pincode, draft.area); } }}
                  />
                  <button type="button" aria-label="Find areas for pincode" title="Find areas" disabled={pinState.status === 'loading'} onClick={() => fetchPincode(draft.pincode, draft.area)}>
                    {pinState.status === 'loading' ? <span className="im-spin" /> : <SearchIcon />}
                  </button>
                </div>
              </Field>
              <Field label="Area / Post Office">
                <select value={draft.area} onChange={(event) => chooseArea(event.target.value)} disabled={!areas.length}>
                  <option value="">{areas.length ? 'Choose area' : 'Enter pincode first'}</option>
                  {areas.map((area) => <option key={area.name} value={area.name}>{area.name}{area.branchType ? ` · ${area.branchType.replace(' Post Office', ' PO')}` : ''}</option>)}
                </select>
              </Field>
              <Field label="City / Town"><input value={draft.city} onChange={(event) => set({ city: event.target.value })} /></Field>
              <Field label="Address Line 1"><input placeholder="Shop / building, street" value={draft.address1} onChange={(event) => set({ address1: event.target.value })} /></Field>
              <Field label="Address Line 2"><input placeholder="Landmark, locality" value={draft.address2} onChange={(event) => set({ address2: event.target.value })} /></Field>
              <Field label="Taluka"><input value={draft.taluka} onChange={(event) => set({ taluka: event.target.value })} /></Field>
              <Field label="District"><input value={draft.district} onChange={(event) => set({ district: event.target.value })} /></Field>
              <Field label="State">
                <select value={draft.stateCode} disabled={!gstOff && draft.gstin.length === 15} onChange={(event) => set({ stateCode: event.target.value })}>
                  <option value="">Choose state</option>
                  {STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </select>
              </Field>
              <Field label="Country"><input value={draft.country} onChange={(event) => set({ country: event.target.value })} /></Field>
            </div>
            {pinState.message ? <p className={`im-lookup ${pinState.status}`} role="status">{pinState.message}</p> : null}
          </Block>
        </div>

        <div data-section="bank">
          <Block index="4" title="Bank Details">
            <div className="im-grid">
              <Field label="Account Number">
                <div className="im-barcode">
                  <input
                    inputMode="numeric"
                    maxLength={18}
                    placeholder="Type account number, press Enter to search"
                    value={draft.bank.accountNumber}
                    onChange={(event) => { setBank({ accountNumber: event.target.value.replace(/\D/g, '') }); if (acctState.status !== 'idle' || acctState.message) setAcctState({ status: 'idle', message: '' }); }}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); fetchAccount(); } }}
                    onBlur={() => { if (draft.bank.accountNumber.length >= 6 && !acctState.message && !draft.bank.ifsc) fetchAccount(); }}
                  />
                  <button type="button" aria-label="Search account number" title="Search account number (Enter)" disabled={acctState.status === 'loading'} onClick={fetchAccount}>
                    {acctState.status === 'loading' ? <span className="im-spin" /> : <SearchIcon />}
                  </button>
                </div>
              </Field>
              <Field label="Account Holder Name"><input value={draft.bank.holder} placeholder={draft.name || 'As per bank records'} onChange={(event) => setBank({ holder: event.target.value })} /></Field>
              <Field label="Account Type">
                <select value={draft.bank.accountType} onChange={(event) => setBank({ accountType: event.target.value })}>
                  {['Current', 'Savings', 'Cash Credit', 'Overdraft'].map((type) => <option key={type} value={type}>{type}</option>)}
                </select>
              </Field>
              <Field label="IFSC Code">
                <div className="im-barcode">
                  <input
                    className="pm-upper"
                    maxLength={11}
                    placeholder="e.g. SBIN0001234"
                    value={draft.bank.ifsc}
                    onChange={(event) => {
                      const ifsc = event.target.value.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 11);
                      setBank({ ifsc });
                      if (ifsc.length === 11 && ifsc !== lastIfsc.current) fetchIfsc(ifsc);
                      if (ifsc.length < 11) { setIfscState({ status: 'idle', message: '' }); lastIfsc.current = ''; }
                    }}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); fetchIfsc(draft.bank.ifsc); } }}
                  />
                  <button type="button" aria-label="Fetch bank from IFSC" title="Fetch bank and branch" disabled={ifscState.status === 'loading'} onClick={() => fetchIfsc(draft.bank.ifsc)}>
                    {ifscState.status === 'loading' ? <span className="im-spin" /> : <SearchIcon />}
                  </button>
                </div>
              </Field>
              <Field label="Bank Name"><input value={draft.bank.bankName} onChange={(event) => setBank({ bankName: event.target.value })} /></Field>
              <Field label="Branch"><input value={draft.bank.branch} onChange={(event) => setBank({ branch: event.target.value })} /></Field>
              <Field label="Bank City"><input value={draft.bank.city} onChange={(event) => setBank({ city: event.target.value })} /></Field>
              <Field label="MICR Code"><input inputMode="numeric" maxLength={9} value={draft.bank.micr} onChange={(event) => setBank({ micr: event.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="UPI ID"><input value={draft.bank.upi} placeholder="name@bank" onChange={(event) => setBank({ upi: event.target.value })} /></Field>
            </div>
            <Field label="Bank Address"><textarea rows={2} value={draft.bank.address} onChange={(event) => setBank({ address: event.target.value })} /></Field>
            {acctState.message ? <p className={`im-lookup ${acctState.status}`} role="status">{acctState.message}</p> : null}
            {ifscState.message ? <p className={`im-lookup ${ifscState.status}`} role="status">{ifscState.message}</p> : null}
          </Block>
        </div>

        <div data-section="credit">
          <Block index="5" title="Credit & Other Details">
            <div className="im-grid">
              <Field label="Credit Days"><input inputMode="numeric" value={draft.creditDays} onChange={(event) => set({ creditDays: event.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="Credit Limit (₹)"><input inputMode="decimal" value={draft.creditLimit} onChange={(event) => set({ creditLimit: event.target.value.replace(/[^0-9.]/g, '') })} /></Field>
              <Field label="Opening Balance (₹)">
                <div className="pm-balance">
                  <input inputMode="decimal" value={draft.openingBalance} onChange={(event) => set({ openingBalance: event.target.value.replace(/[^0-9.]/g, '') })} />
                  <select value={draft.balanceType} aria-label="Debit or credit" onChange={(event) => set({ balanceType: event.target.value })}>
                    <option value="dr">Dr</option>
                    <option value="cr">Cr</option>
                  </select>
                </div>
              </Field>
              <Field label="Status">
                <select value={draft.active ? 'active' : 'inactive'} onChange={(event) => set({ active: event.target.value === 'active' })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </Field>
            </div>
            <Field label="Notes"><textarea rows={3} maxLength={500} value={draft.notes} onChange={(event) => set({ notes: event.target.value })} /></Field>
          </Block>
        </div>
      </section>
    </form>
  );
}

function Block({ index, title, children }) {
  return (
    <section className="im-block">
      <h3><span>{index}</span>{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="im-field">
      <span>{label}{required ? <em>*</em> : null}</span>
      {children}
    </label>
  );
}
