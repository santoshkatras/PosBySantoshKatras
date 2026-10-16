import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './auth.jsx';
import { useFeedback } from './feedback.jsx';
import { Popup, decimal, inr, message } from './opening-stock.jsx';
import { OFFER_GROUPS, OFFER_TYPE, OFFER_TYPES, WEEKDAYS, blankCoupon, blankOffer, generateCodes, offerProblems, offerSummary } from '../../shared/promotions.mjs';
import './app-settings.css';
import './promotions.css';

// Promotions → Offer Management and Discount Coupons.

export function usePromoSetup() {
  const { request } = useAuth();
  const [setup, setSetup] = useState(null);
  const [error, setError] = useState('');
  const reload = () => request('/promotions/setup').then(setSetup).catch((err) => setError(message(err)));
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return { setup, setSetup, error, reload };
}

export function Field({ label, children, grow, small, hint }) {
  return <label className={`cfg-field${grow ? ' grow' : ''}${small ? ' small' : ''}`}>{label}{children}{hint ? <small className="pr-hint">{hint}</small> : null}</label>;
}
export function Num({ value, onChange, placeholder, suffix, prefix }) {
  return <span className="pr-num">{prefix ? <em>{prefix}</em> : null}<input inputMode="decimal" value={value ?? ''} placeholder={placeholder || ''} onChange={(event) => onChange(decimal(event.target.value))} />{suffix ? <em>{suffix}</em> : null}</span>;
}
export function Seg({ value, options, onChange }) {
  return <div className="cfg-seg">{options.map(([id, label]) => <button type="button" key={id} className={value === id ? 'on' : ''} onClick={() => onChange(id)}>{label}</button>)}</div>;
}

// Searchable multi-select of ids.
export function Multi({ options, value, onChange, placeholder = 'Search…', empty = 'Nothing to choose yet.' }) {
  const [q, setQ] = useState('');
  const chosen = new Set(value || []);
  const text = q.trim().toLowerCase();
  const shown = options.filter((row) => !text || `${row.name} ${row.code || ''}`.toLowerCase().includes(text)).slice(0, 60);
  return (
    <div className="pr-multi">
      <div className="pr-chips">
        {[...chosen].map((id) => { const row = options.find((item) => item.id === id); return <span key={id}>{row ? row.name : id}<button type="button" aria-label="Remove" onClick={() => onChange([...chosen].filter((item) => item !== id))}>×</button></span>; })}
        {!chosen.size ? <small>None selected</small> : null}
      </div>
      <input value={q} placeholder={placeholder} onChange={(event) => setQ(event.target.value)} />
      <div className="pr-opts">
        {shown.map((row) => (
          <label key={row.id}><input type="checkbox" checked={chosen.has(row.id)} onChange={(event) => onChange(event.target.checked ? [...chosen, row.id] : [...chosen].filter((item) => item !== row.id))} /><span>{row.name}{row.code ? <small> {row.code}</small> : null}</span></label>
        ))}
        {!options.length ? <small className="pr-hint">{empty}</small> : !shown.length ? <small className="pr-hint">No match.</small> : null}
      </div>
    </div>
  );
}

export function ScopePicker({ scope, onChange, setup, allLabel = 'All items' }) {
  const s = scope || { mode: 'all', items: [], categories: [], brands: [] };
  const opts = {
    items: setup.items.map((row) => ({ id: row.key, name: row.name, code: row.code })),
    categories: setup.categories.map((row) => ({ id: row.id, name: row.name })),
    brands: setup.brands.map((row) => ({ id: row.id, name: row.name })),
  };
  return (
    <div className="pr-scope">
      <Seg value={s.mode} onChange={(mode) => onChange({ ...s, mode })} options={[['all', allLabel], ['items', 'Selected items'], ['categories', 'Categories'], ['brands', 'Brands']]} />
      {s.mode !== 'all' ? <Multi options={opts[s.mode]} value={s[s.mode]} onChange={(ids) => onChange({ ...s, [s.mode]: ids })} placeholder={`Search ${s.mode}…`} empty={`No ${s.mode} in the item master yet.`} /> : null}
    </div>
  );
}

const STATUS = [['active', 'Active'], ['draft', 'Draft'], ['paused', 'Paused']];
function offerState(offer, today) {
  if (offer.status !== 'active') return offer.status;
  if (offer.to && offer.to < today) return 'expired';
  if (offer.from && offer.from > today) return 'scheduled';
  if (Number(offer.usageLimit) > 0 && Number(offer.used) >= Number(offer.usageLimit)) return 'exhausted';
  return 'live';
}
const STATE_LABEL = { live: 'Live', active: 'Active', draft: 'Draft', paused: 'Paused', expired: 'Expired', scheduled: 'Scheduled', exhausted: 'Limit reached' };

function TypeGallery({ onPick, onClose, current }) {
  const [q, setQ] = useState('');
  const text = q.trim().toLowerCase();
  return (
    <Popup title="Choose an offer type" subtitle={`${OFFER_TYPES.length} offer types used by Indian retail — pick the one that matches your scheme`} wide extraClass="pr-gallery-pop" onClose={onClose} footer={<button type="button" className="btn" onClick={onClose}>Cancel</button>}>
      <input className="cfg-search pr-gal-search" autoFocus value={q} placeholder="Search e.g. BOGO, combo, birthday, happy hours" onChange={(event) => setQ(event.target.value)} />
      {OFFER_GROUPS.map(([group, label]) => {
        const rows = OFFER_TYPES.filter((row) => row.group === group && (!text || `${row.name} ${row.example}`.toLowerCase().includes(text)));
        if (!rows.length) return null;
        return (
          <section key={group} className="pr-gal">
            <h4>{label}</h4>
            <div className="pr-gal-grid">
              {rows.map((row) => (
                <button type="button" key={row.id} className={row.id === current ? 'on' : ''} onClick={() => onPick(row.id)}>
                  <strong>{row.name}</strong>
                  <small>e.g. {row.example}</small>
                  <i>{row.level === 'line' ? 'Item level' : row.level === 'bill' ? 'Bill level' : 'Reward'}</i>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </Popup>
  );
}

function ItemPick({ setup, value, onChange, placeholder }) {
  return <Multi options={setup.items.map((row) => ({ id: row.key, name: row.name, code: row.code }))} value={value} onChange={onChange} placeholder={placeholder || 'Search item…'} empty="No items in the item master yet." />;
}

function RuleFields({ offer, set, setup }) {
  const f = new Set(OFFER_TYPE[offer.type].fields);
  const tiers = setup.loyalty?.tiers || [];
  const series = setup.coupons.filter((row) => row.mode === 'series');
  return (
    <>
      <div className="cfg-row">
        {f.has('buyQty') ? <Field label={offer.type === 'mix_match_price' ? 'Set size (any N items)' : offer.type === 'cheapest_free' ? 'Buy (N items)' : 'Buy quantity'} small><Num value={offer.buyQty} onChange={set('buyQty')} /></Field> : null}
        {f.has('getQty') ? <Field label={offer.type === 'cheapest_free' ? 'Free (cheapest)' : 'Get quantity'} small><Num value={offer.getQty} onChange={set('getQty')} /></Field> : null}
        {f.has('nth') ? <Field label="Every Nth item" small><Num value={offer.nth} onChange={set('nth')} /></Field> : null}
        {f.has('pct') ? <Field label="Discount" small><Num value={offer.pct} onChange={set('pct')} suffix="%" /></Field> : null}
        {f.has('amount') ? <Field label={offer.type === 'bill_flat' ? 'Save amount' : 'Off per unit'} small><Num value={offer.amount} onChange={set('amount')} prefix="₹" /></Field> : null}
        {f.has('price') ? <Field label={offer.type === 'combo_price' ? 'Combo price' : offer.type === 'mix_match_price' ? 'Set price' : offer.type === 'add_on_price' ? 'Add-on price' : 'Offer price (incl. GST)'} small><Num value={offer.price} onChange={set('price')} prefix="₹" /></Field> : null}
        {f.has('minBill') ? <Field label="Minimum bill" small><Num value={offer.minBill} onChange={set('minBill')} prefix="₹" placeholder="0" /></Field> : null}
        {f.has('maxOff') ? <Field label="Max discount" small hint="per bill"><Num value={offer.maxOff} onChange={set('maxOff')} prefix="₹" placeholder="No cap" /></Field> : null}
        {f.has('maxPerBill') ? <Field label="Max times per bill" small><Num value={offer.maxPerBill} onChange={set('maxPerBill')} placeholder="No limit" /></Field> : null}
        {f.has('multiplier') ? <Field label="Points multiplier" small><Num value={offer.multiplier} onChange={set('multiplier')} suffix="×" /></Field> : null}
        {f.has('repeat') ? <label className="cfg-check"><input type="checkbox" checked={offer.repeat} onChange={(event) => set('repeat')(event.target.checked)} /><span>Repeat for every multiple<small>₹4,000 bill → 2 × ₹{offer.amount || 'Y'}</small></span></label> : null}
        {f.has('occasion') ? <Field label="Occasion"><Seg value={offer.occasion} onChange={set('occasion')} options={[['birthday', 'Birthday'], ['anniversary', 'Anniversary'], ['both', 'Both']]} /></Field> : null}
      </div>
      {f.has('slabs') ? (
        <div className="pr-slabs">
          <div className="cfg-row">
            {offer.type === 'qty_slab' ? <Field label="Count quantity"><Seg value={offer.slabBasis} onChange={set('slabBasis')} options={[['total', 'Across all offer items'], ['line', 'Per item']]} /></Field> : null}
            {offer.type === 'bill_slab' ? <Field label="Slab gives"><Seg value={offer.slabMode} onChange={set('slabMode')} options={[['pct', '% off'], ['flat', '₹ off']]} /></Field> : null}
          </div>
          <table>
            <thead><tr><th>{offer.type === 'qty_slab' ? 'From quantity' : 'From bill ₹'}</th><th>{offer.type === 'bill_slab' && offer.slabMode === 'flat' ? '₹ off' : '% off'}</th><th /></tr></thead>
            <tbody>
              {offer.slabs.map((row, index) => (
                <tr key={index}>
                  <td><Num value={row.min} onChange={(v) => set('slabs')(offer.slabs.map((s, i) => (i === index ? { ...s, min: v } : s)))} /></td>
                  <td><Num value={row.value} onChange={(v) => set('slabs')(offer.slabs.map((s, i) => (i === index ? { ...s, value: v } : s)))} /></td>
                  <td><button type="button" className="pay-x" onClick={() => set('slabs')(offer.slabs.filter((_, i) => i !== index))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="cfg-link" onClick={() => set('slabs')([...offer.slabs, { min: '', value: '' }])}>+ Add slab</button>
        </div>
      ) : null}
      {f.has('getItems') ? <Field label={offer.type === 'free_gift' ? 'Gift item(s)' : offer.type === 'add_on_price' ? 'Add-on item(s)' : 'Get item(s)'} grow hint="The cashier adds the item to the bill; the offer makes it free / discounted."><ItemPick setup={setup} value={offer.getItems} onChange={(ids) => set('getItems')(ids)} /></Field> : null}
      {f.has('comboItems') ? (
        <div className="pr-combo">
          <p className="cfg-sub">Combo items</p>
          {offer.comboItems.map((row, index) => (
            <div key={index} className="cfg-row">
              <Field label="Item" grow>
                <select value={row.key} onChange={(event) => { const item = setup.items.find((i) => i.key === event.target.value); set('comboItems')(offer.comboItems.map((c, i) => (i === index ? { ...c, key: event.target.value, name: item?.name || '' } : c))); }}>
                  <option value="">Choose item</option>
                  {setup.items.map((item) => <option key={item.key} value={item.key}>{item.name} ({item.code})</option>)}
                </select>
              </Field>
              <Field label="Qty" small><Num value={row.qty} onChange={(v) => set('comboItems')(offer.comboItems.map((c, i) => (i === index ? { ...c, qty: v } : c)))} /></Field>
              <button type="button" className="pay-x" onClick={() => set('comboItems')(offer.comboItems.filter((_, i) => i !== index))}>×</button>
            </div>
          ))}
          <button type="button" className="cfg-link" onClick={() => set('comboItems')([...offer.comboItems, { key: '', name: '', qty: '1' }])}>+ Add combo item</button>
        </div>
      ) : null}
      {f.has('targetScope') ? <Field label="Discounted (target) items" grow><ScopePicker scope={offer.targetScope} onChange={set('targetScope')} setup={setup} allLabel="Any other item" /></Field> : null}
      {f.has('tierPct') ? (
        <div className="cfg-row">
          {tiers.map((tier) => <Field key={tier.id} label={`${tier.name} %`} small><Num value={offer.tierPct?.[tier.id]} onChange={(v) => set('tierPct')({ ...offer.tierPct, [tier.id]: v })} suffix="%" /></Field>)}
          {!tiers.length ? <p className="cfg-hint">Set up tiers in Loyalty Program first.</p> : null}
        </div>
      ) : null}
      {f.has('tenders') ? (
        <Field label="Payment modes" grow>
          <Multi options={[...new Set(setup.tenders.map((t) => t.category))].map((cat) => ({ id: `cat:${cat}`, name: `Any ${cat.toUpperCase()} tender` })).concat(setup.tenders.map((t) => ({ id: t.id, name: t.name, code: t.code })))} value={offer.tenders} onChange={set('tenders')} placeholder="Search tender…" />
        </Field>
      ) : null}
      {f.has('couponId') ? (
        <Field label="Coupon to give (unique-code series)" grow hint="A new unique code from this series is printed on the bill.">
          <select value={offer.couponId} onChange={(event) => set('couponId')(event.target.value)}>
            <option value="">Choose a coupon series</option>
            {series.map((row) => <option key={row.id} value={row.id}>{row.name} ({row.discountType === 'flat' ? `₹${row.value}` : `${row.value}%`})</option>)}
          </select>
          {!series.length ? <small className="pr-hint">Create a coupon with “Unique codes (series)” in Discount Coupons first.</small> : null}
        </Field>
      ) : null}
    </>
  );
}

export function OffersPage() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const { setup, setSetup, error: loadError } = usePromoSetup();
  const [offers, setOffers] = useState(null);
  const [savedText, setSavedText] = useState('');
  const [selected, setSelected] = useState('');
  const [gallery, setGallery] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (setup && !offers) { setOffers(setup.offers); setSavedText(JSON.stringify(setup.offers)); setSelected(setup.offers[0]?.id || ''); } }, [setup, offers]);
  if (!setup || !offers) return <section className="card">{loadError ? <p className="banner">{loadError}</p> : <p>Loading offers…</p>}</section>;

  const readOnly = !setup.canEdit;
  const dirty = JSON.stringify(offers) !== savedText;
  const keyOf = (row) => row.id || row.tmp;
  const current = offers.find((row) => keyOf(row) === selected);
  const update = (patch) => setOffers((rows) => rows.map((row) => (keyOf(row) === selected ? { ...row, ...patch } : row)));
  const set = (key) => (value) => update({ [key]: value });
  const today = setup.today;

  function create(type, copy) {
    const tmp = `new${Date.now()}`;
    const used = new Set(offers.map((row) => row.code));
    let i = offers.length + 1; let code = `OFF-${String(i).padStart(3, '0')}`;
    while (used.has(code)) { i += 1; code = `OFF-${String(i).padStart(3, '0')}`; }
    const base = copy ? { ...copy, id: '', used: 0, name: `${copy.name} (copy)`, status: 'draft' } : blankOffer(type);
    setOffers([...offers, { ...base, code, tmp }]);
    setSelected(tmp); setGallery(null);
  }
  function changeType(type) {
    const fresh = blankOffer(type);
    update({ type, stackable: fresh.stackable, buyQty: fresh.buyQty });
    setGallery(null);
  }
  async function remove() {
    if (!(await feedback.confirm({ tone: 'danger', title: 'Delete this offer?', message: `Delete “${current.name || current.code}”?${current.used ? ` It was used on ${current.used} bill${current.used === 1 ? '' : 's'}; those bills keep their discount.` : ''} Tip: pause it instead to keep it for next season.`, confirmLabel: 'Delete' }))) return;
    const rest = offers.filter((row) => row !== current);
    setOffers(rest); setSelected(rest[0] ? keyOf(rest[0]) : '');
  }
  async function save() {
    const bad = offers.find((row) => row.status === 'active' && offerProblems(row).length);
    if (bad) { setSelected(keyOf(bad)); feedback.failure({ title: 'Offer needs attention', message: `${bad.name || bad.code}: ${offerProblems(bad)[0]}` }); return; }
    if (!(await feedback.confirm({ title: 'Save offers?', message: `Save ${offers.length} offer${offers.length === 1 ? '' : 's'}? Active offers apply on the Sales Bill immediately.` }))) return;
    setPending(true); setError('');
    try {
      const withNames = offers.map(({ tmp, ...row }) => ({ ...row, getNames: (row.getItems || []).map((key) => setup.items.find((item) => item.key === key)?.name || '') }));
      const result = await request('/promotions/offers', { method: 'PUT', body: { offers: withNames } });
      const idMap = Object.fromEntries(offers.map((row, index) => [keyOf(row), result.offers[index]?.id]));
      setOffers(result.offers); setSavedText(JSON.stringify(result.offers)); setSelected((id) => idMap[id] || id);
      setSetup({ ...setup, offers: result.offers });
      feedback.success({ title: 'Offers saved successfully', message: `${result.offers.filter((row) => row.status === 'active').length} active offer(s).` });
    } catch (err) { setError(message(err)); feedback.failure({ title: 'Could not save', message: message(err) }); } finally { setPending(false); }
  }

  const q = query.trim().toLowerCase();
  const shown = offers.filter((row) => {
    const state = offerState(row, today);
    if (filter === 'live' && state !== 'live') return false;
    if (filter === 'draft' && !['draft', 'paused'].includes(state)) return false;
    if (filter === 'ended' && !['expired', 'exhausted'].includes(state)) return false;
    return !q || `${row.code} ${row.name} ${OFFER_TYPE[row.type]?.name}`.toLowerCase().includes(q);
  }).sort((a, b) => Number(a.priority || 99) - Number(b.priority || 99));
  const count = (f) => offers.filter((row) => { const s = offerState(row, today); return f === 'live' ? s === 'live' : f === 'draft' ? ['draft', 'paused'].includes(s) : ['expired', 'exhausted'].includes(s); }).length;
  const problems = current ? offerProblems(current) : [];
  const t = current ? OFFER_TYPE[current.type] : null;

  return (
    <div className="cfg pr">
      <div className="cfg-top">
        <div>
          <h1>Offer Management</h1>
          <p>Create item, buy-get, combo, bill-value, customer, time-based and payment offers. Live offers apply automatically on the Sales Bill — the cashier sees the savings and tips like “add 1 more to get it free”.</p>
        </div>
        <div className="cfg-actions">
          {dirty ? <span className="cfg-dirty">Unsaved changes</span> : null}
          {!readOnly ? <><button type="button" className="btn" data-sc="new" onClick={() => setGallery('new')}>+ New Offer</button><button type="button" className="btn primary" data-sc="save" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save Offers'}</button></> : <span className="cfg-dirty">View only</span>}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="cfg-bar">
        <input className="cfg-search" data-sc="search" value={query} placeholder="Search offers" onChange={(event) => setQuery(event.target.value)} />
        <div className="cfg-chips">
          {[['all', 'All', offers.length], ['live', 'Live now', count('live')], ['draft', 'Draft / paused', count('draft')], ['ended', 'Ended', count('ended')]].map(([id, label, c]) => <button type="button" key={id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{label} <em>{c}</em></button>)}
        </div>
      </div>
      <div className="cfg-split">
        <aside className="cfg-card cfg-list">
          {shown.map((row) => {
            const state = offerState(row, today);
            return (
              <button type="button" key={keyOf(row)} className={keyOf(row) === selected ? 'cfg-item on' : 'cfg-item'} onClick={() => setSelected(keyOf(row))}>
                <span><strong>{row.name || 'Untitled offer'}</strong><small>{row.code} · {OFFER_TYPE[row.type]?.name}</small><small>{offerSummary(row)}</small></span>
                <span className="cfg-tags"><i className={state === 'live' ? 'ok' : ['expired', 'exhausted', 'paused'].includes(state) ? 'off' : 'warn'}>{STATE_LABEL[state]}</i>{row.used ? <i>{row.used} used</i> : null}</span>
              </button>
            );
          })}
          {!shown.length ? <p className="cfg-empty">{offers.length ? 'No offer matches.' : 'No offers yet. Click “+ New Offer” and pick a type.'}</p> : null}
        </aside>
        {current ? (
          <fieldset className="cfg-card pr-form" disabled={readOnly}>
            <div className="cfg-head">
              <h3>{current.name || 'New offer'} <small>{current.code}</small></h3>
              {!readOnly ? <div className="cfg-tools"><button type="button" className="btn" onClick={() => create(current.type, current)}>Duplicate</button><button type="button" className="btn cfg-del" onClick={remove}>Delete</button></div> : null}
            </div>
            <div className="pr-explain">
              <strong>{t.name}</strong> — {offerSummary(current) || t.example}
              <span>{problems.length ? <em className="pr-bad">⚠ {problems[0]}</em> : <em className="pr-good">✓ Ready</em>}</span>
            </div>

            <section className="cfg-block">
              <h4>1 · Basic details</h4>
              <div className="cfg-row">
                <Field label="Offer name" grow><input value={current.name} maxLength={80} placeholder={t.example} onChange={(event) => set('name')(event.target.value)} /></Field>
                <Field label="Code" small><input value={current.code} maxLength={20} onChange={(event) => set('code')(event.target.value.toUpperCase())} /></Field>
                <Field label="Status"><Seg value={current.status} onChange={set('status')} options={STATUS} /></Field>
              </div>
              <div className="cfg-row">
                <Field label="Offer type" grow>
                  <button type="button" className="pr-typebtn" onClick={() => setGallery('change')}>{t.name} <small>change</small></button>
                </Field>
                <Field label="Priority" small hint="1 runs first"><Num value={current.priority} onChange={set('priority')} /></Field>
                <label className="cfg-check"><input type="checkbox" checked={current.stackable} onChange={(event) => set('stackable')(event.target.checked)} /><span>Can combine with other offers<small>Off: items already on another offer are skipped</small></span></label>
              </div>
              <Field label="Description (shown to cashier)" grow><input value={current.description} maxLength={300} onChange={(event) => set('description')(event.target.value)} /></Field>
            </section>

            <section className="cfg-block">
              <h4>2 · Offer rule</h4>
              <RuleFields offer={current} set={set} setup={setup} />
            </section>

            {t.level !== 'reward' || current.type === 'bonus_points' ? (
              <section className="cfg-block">
                <h4>3 · {['bill', 'reward'].includes(t.level) && current.type !== 'bonus_points' ? 'Items counted for the bill value' : current.type.startsWith('bxgy') || current.type === 'add_on_price' || current.type === 'cross_category' ? 'Buy items (condition)' : 'Applies to'}</h4>
                {current.type === 'combo_price' ? <p className="cfg-hint">Combo items are chosen in the rule above.</p> : <ScopePicker scope={current.scope} onChange={set('scope')} setup={setup} />}
                {current.type !== 'combo_price' ? <details className="pr-ex"><summary>Exclude items ({current.exclude?.items?.length || 0})</summary><Multi options={setup.items.map((row) => ({ id: row.key, name: row.name, code: row.code }))} value={current.exclude?.items || []} onChange={(ids) => set('exclude')({ ...current.exclude, items: ids })} /></details> : null}
              </section>
            ) : null}

            <section className="cfg-block">
              <h4>4 · Schedule</h4>
              <div className="cfg-row">
                <Field label="Starts on" small><input type="date" value={current.from} onChange={(event) => set('from')(event.target.value)} /></Field>
                <Field label="Ends on" small><input type="date" value={current.to} min={current.from} onChange={(event) => set('to')(event.target.value)} /></Field>
                <Field label={t.needs === 'time' ? 'From time *' : 'From time'} small><input type="time" value={current.timeFrom} onChange={(event) => set('timeFrom')(event.target.value)} /></Field>
                <Field label={t.needs === 'time' ? 'To time *' : 'To time'} small><input type="time" value={current.timeTo} onChange={(event) => set('timeTo')(event.target.value)} /></Field>
              </div>
              <div className="pr-days">
                <span>{t.needs === 'days' ? 'Days *' : 'Days'}</span>
                {WEEKDAYS.map((label, index) => <button type="button" key={label} className={current.days.includes(index) ? 'on' : ''} onClick={() => set('days')(current.days.includes(index) ? current.days.filter((d) => d !== index) : [...current.days, index].sort())}>{label}</button>)}
                <small>{current.days.length ? '' : 'Every day'}</small>
              </div>
            </section>

            <section className="cfg-block">
              <h4>5 · Who &amp; where</h4>
              <div className="cfg-row">
                <Field label="Customers"><Seg value={current.customers} onChange={set('customers')} options={[['all', 'Everyone'], ['registered', 'Saved customers'], ['members', 'Loyalty members'], ['tiers', 'Selected tiers'], ['nonmembers', 'Non-members']]} /></Field>
              </div>
              {current.customers === 'tiers' ? <div className="cfg-row">{(setup.loyalty?.tiers || []).map((tier) => <label key={tier.id} className="cfg-check"><input type="checkbox" checked={current.tiers.includes(tier.id)} onChange={(event) => set('tiers')(event.target.checked ? [...current.tiers, tier.id] : current.tiers.filter((id) => id !== tier.id))} /><span>{tier.name}</span></label>)}</div> : null}
              <Field label={`Locations (${current.locations.length ? current.locations.length : 'all'})`} grow><Multi options={setup.locations} value={current.locations} onChange={set('locations')} placeholder="Leave empty for all locations" /></Field>
            </section>

            <section className="cfg-block">
              <h4>6 · Limits &amp; terms</h4>
              <div className="cfg-row">
                <Field label="Total usage limit (bills)" small><Num value={current.usageLimit} onChange={set('usageLimit')} placeholder="No limit" /></Field>
                <Field label="Used so far" small><input value={current.used || 0} readOnly /></Field>
              </div>
              <Field label="Terms & conditions (printed on request)" grow><textarea rows={2} value={current.terms} maxLength={600} onChange={(event) => set('terms')(event.target.value)} placeholder="e.g. Not valid with other offers. While stocks last." /></Field>
            </section>
          </fieldset>
        ) : (
          <div className="cfg-card pr-start">
            <h3>Start with a scheme</h3>
            <p className="cfg-hint">Popular in the market:</p>
            <div className="pr-gal-grid">
              {['bogo_same', 'pct_item', 'bill_flat', 'combo_price', 'cheapest_free', 'free_gift', 'happy_hour', 'tender_offer'].map((id) => (
                <button type="button" key={id} disabled={readOnly} onClick={() => create(id)}><strong>{OFFER_TYPE[id].name}</strong><small>e.g. {OFFER_TYPE[id].example}</small></button>
              ))}
            </div>
          </div>
        )}
      </div>
      {gallery ? <TypeGallery current={gallery === 'change' ? current?.type : ''} onClose={() => setGallery(null)} onPick={(type) => (gallery === 'change' ? changeType(type) : create(type))} /> : null}
    </div>
  );
}

// ================= coupons =================
export function CouponsPage() {
  const { request } = useAuth();
  const feedback = useFeedback();
  const { setup, setSetup, error: loadError } = usePromoSetup();
  const [coupons, setCoupons] = useState(null);
  const [savedText, setSavedText] = useState('');
  const [selected, setSelected] = useState('');
  const [genCount, setGenCount] = useState('50');
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { if (setup && !coupons) { setCoupons(setup.coupons); setSavedText(JSON.stringify(setup.coupons)); setSelected(setup.coupons[0]?.id || ''); } }, [setup, coupons]);
  const allCodes = useMemo(() => new Set((coupons || []).flatMap((row) => (row.mode === 'series' ? row.codes.map((c) => c.code) : [row.code]))), [coupons]);
  if (!setup || !coupons) return <section className="card">{loadError ? <p className="banner">{loadError}</p> : <p>Loading coupons…</p>}</section>;

  const readOnly = !setup.canEdit;
  const dirty = JSON.stringify(coupons) !== savedText;
  const keyOf = (row) => row.id || row.tmp;
  const current = coupons.find((row) => keyOf(row) === selected);
  const update = (patch) => setCoupons((rows) => rows.map((row) => (keyOf(row) === selected ? { ...row, ...patch } : row)));
  const set = (key) => (value) => update({ [key]: value });

  function create(copy) {
    const tmp = `new${Date.now()}`;
    const base = copy ? { ...copy, id: '', used: 0, usage: [], code: '', codes: [], name: `${copy.name} (copy)` } : blankCoupon();
    setCoupons([...coupons, { ...base, tmp }]); setSelected(tmp);
  }
  async function remove() {
    if (current.used) { feedback.failure({ title: 'Coupon already used', message: 'Switch it off instead of deleting it, so bills keep their history.' }); return; }
    if (!(await feedback.confirm({ tone: 'danger', title: 'Delete this coupon?', message: `Delete “${current.name || current.code}”?`, confirmLabel: 'Delete' }))) return;
    const rest = coupons.filter((row) => row !== current);
    setCoupons(rest); setSelected(rest[0] ? keyOf(rest[0]) : '');
  }
  function generate() {
    const count = Math.min(Math.max(Math.floor(Number(genCount) || 0), 1), 1000);
    const codes = generateCodes(current.prefix || 'CP', count, new Set(allCodes));
    update({ codes: [...current.codes, ...codes.map((code) => ({ code, used: false, bill: '', customerId: '', issuedOn: '' }))] });
    feedback.toast(`${codes.length} unique codes generated. Save to keep them.`);
  }
  async function save() {
    if (!(await feedback.confirm({ title: 'Save coupons?', message: `Save ${coupons.length} coupon${coupons.length === 1 ? '' : 's'}? Cashiers can use active codes immediately.` }))) return;
    setPending(true); setError('');
    try {
      const result = await request('/promotions/coupons', { method: 'PUT', body: { coupons: coupons.map(({ tmp, ...row }) => row) } });
      const idMap = Object.fromEntries(coupons.map((row, index) => [keyOf(row), result.coupons[index]?.id]));
      setCoupons(result.coupons); setSavedText(JSON.stringify(result.coupons)); setSelected((id) => idMap[id] || id);
      setSetup({ ...setup, coupons: result.coupons });
      feedback.success({ title: 'Coupons saved successfully', message: `${result.coupons.filter((row) => row.active).length} active coupon(s).` });
    } catch (err) { setError(message(err)); feedback.failure({ title: 'Could not save', message: message(err) }); } finally { setPending(false); }
  }

  const q = query.trim().toLowerCase();
  const shown = coupons.filter((row) => !q || `${row.name} ${row.code} ${row.prefix}`.toLowerCase().includes(q));
  const state = (row) => (!row.active ? 'Off' : row.to && row.to < setup.today ? 'Expired' : row.from && row.from > setup.today ? 'Scheduled' : Number(row.usageLimit) > 0 && row.used >= Number(row.usageLimit) ? 'Used up' : 'Active');

  return (
    <div className="cfg pr">
      <div className="cfg-top">
        <div>
          <h1>Discount Coupons</h1>
          <p>One public code (e.g. DIWALI500) or a series of unique single-use codes for SMS / WhatsApp campaigns. Cashiers enter the code in the Sales Bill payment window; SKPOS checks validity, minimum bill, customer limits and usage.</p>
        </div>
        <div className="cfg-actions">
          {dirty ? <span className="cfg-dirty">Unsaved changes</span> : null}
          {!readOnly ? <><button type="button" className="btn" data-sc="new" onClick={() => create(null)}>+ New Coupon</button><button type="button" className="btn primary" data-sc="save" disabled={pending || !dirty} onClick={save}>{pending ? 'Saving…' : 'Save Coupons'}</button></> : <span className="cfg-dirty">View only</span>}
        </div>
      </div>
      {error ? <p className="banner">{error}</p> : null}
      <div className="cfg-split">
        <aside className="cfg-card cfg-list">
          <input className="cfg-search" data-sc="search" value={query} placeholder="Search coupons" onChange={(event) => setQuery(event.target.value)} />
          {shown.map((row) => (
            <button type="button" key={keyOf(row)} className={keyOf(row) === selected ? 'cfg-item on' : 'cfg-item'} onClick={() => setSelected(keyOf(row))}>
              <span><strong>{row.name || 'New coupon'}</strong><small className="mono">{row.mode === 'series' ? `${row.prefix || 'CP'}… · ${row.codes.length} codes` : row.code || '—'}</small><small>{row.discountType === 'flat' ? `₹${row.value || 0} off` : `${row.value || 0}% off`}{Number(row.minBill) ? ` above ₹${row.minBill}` : ''}</small></span>
              <span className="cfg-tags"><i className={state(row) === 'Active' ? 'ok' : state(row) === 'Scheduled' ? 'warn' : 'off'}>{state(row)}</i>{row.used ? <i>{row.used} used</i> : null}</span>
            </button>
          ))}
          {!shown.length ? <p className="cfg-empty">No coupons yet.</p> : null}
        </aside>
        {current ? (
          <fieldset className="cfg-card pr-form" disabled={readOnly}>
            <div className="cfg-head">
              <h3>{current.name || 'New coupon'}</h3>
              {!readOnly ? <div className="cfg-tools"><button type="button" className="btn" onClick={() => create(current)}>Duplicate</button><button type="button" className="btn cfg-del" onClick={remove}>Delete</button></div> : null}
            </div>
            <section className="cfg-block">
              <h4>Coupon</h4>
              <div className="cfg-row">
                <Field label="Coupon name" grow><input value={current.name} maxLength={80} placeholder="e.g. Diwali ₹500 off" onChange={(event) => set('name')(event.target.value)} /></Field>
                <label className="cfg-check"><input type="checkbox" checked={current.active} onChange={(event) => set('active')(event.target.checked)} /><span>Active</span></label>
              </div>
              <div className="cfg-row">
                <Field label="Code type"><Seg value={current.mode} onChange={set('mode')} options={[['single', 'One public code'], ['series', 'Unique codes (series)']]} /></Field>
                {current.mode === 'single'
                  ? <Field label="Coupon code" small><input className="mono" value={current.code} maxLength={24} placeholder="DIWALI500" onChange={(event) => set('code')(event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} /></Field>
                  : <Field label="Code prefix" small><input className="mono" value={current.prefix} maxLength={10} placeholder="DW" onChange={(event) => set('prefix')(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} /></Field>}
              </div>
              {current.mode === 'series' ? (
                <div className="pr-series">
                  <div className="cfg-row">
                    <Field label="How many codes" small><Num value={genCount} onChange={setGenCount} /></Field>
                    <button type="button" className="btn" onClick={generate}>Generate codes</button>
                    <span className="cfg-hint">{current.codes.length} codes · {current.codes.filter((row) => row.used).length} used · {current.codes.filter((row) => row.customerId).length} assigned to customers</span>
                  </div>
                  {current.codes.length ? <div className="pr-codes">{current.codes.slice(0, 120).map((row) => <span key={row.code} className={row.used ? 'used' : ''} title={row.used ? `Used on ${row.bill}` : 'Available'}>{row.code}</span>)}{current.codes.length > 120 ? <small>…and {current.codes.length - 120} more (export to see all)</small> : null}</div> : null}
                </div>
              ) : null}
            </section>
            <section className="cfg-block">
              <h4>Discount</h4>
              <div className="cfg-row">
                <Field label="Discount type"><Seg value={current.discountType} onChange={set('discountType')} options={[['pct', '% off'], ['flat', '₹ off']]} /></Field>
                <Field label="Value" small><Num value={current.value} onChange={set('value')} prefix={current.discountType === 'flat' ? '₹' : ''} suffix={current.discountType === 'pct' ? '%' : ''} /></Field>
                {current.discountType === 'pct' ? <Field label="Max discount" small><Num value={current.maxOff} onChange={set('maxOff')} prefix="₹" placeholder="No cap" /></Field> : null}
                <Field label="Minimum bill" small><Num value={current.minBill} onChange={set('minBill')} prefix="₹" placeholder="0" /></Field>
              </div>
              <label className="cfg-check"><input type="checkbox" checked={current.stackWithOffers} onChange={(event) => set('stackWithOffers')(event.target.checked)} /><span>Allow on items already on offer<small>Off: coupon applies only to items without another offer</small></span></label>
              <Field label="Valid on" grow><ScopePicker scope={current.scope} onChange={set('scope')} setup={setup} /></Field>
            </section>
            <section className="cfg-block">
              <h4>Validity &amp; limits</h4>
              <div className="cfg-row">
                <Field label="Valid from" small><input type="date" value={current.from} onChange={(event) => set('from')(event.target.value)} /></Field>
                <Field label="Valid till" small><input type="date" value={current.to} min={current.from} onChange={(event) => set('to')(event.target.value)} /></Field>
                <Field label="Total uses" small><Num value={current.usageLimit} onChange={set('usageLimit')} placeholder="No limit" /></Field>
                <Field label="Uses per customer" small><Num value={current.perCustomer} onChange={set('perCustomer')} placeholder="No limit" /></Field>
              </div>
              <div className="cfg-row">
                <Field label="Who can use"><Seg value={current.customers} onChange={set('customers')} options={[['all', 'Everyone'], ['registered', 'Saved customers'], ['members', 'Loyalty members'], ['new', 'First purchase only']]} /></Field>
              </div>
              <Field label={`Locations (${current.locations.length || 'all'})`} grow><Multi options={setup.locations} value={current.locations} onChange={set('locations')} placeholder="Leave empty for all locations" /></Field>
            </section>
            {current.usage?.length ? (
              <section className="cfg-block">
                <h4>Recent use ({current.used})</h4>
                <table className="pr-table"><thead><tr><th>Bill</th><th>Date</th><th>Code</th><th className="num">Discount</th></tr></thead>
                  <tbody>{[...current.usage].reverse().slice(0, 15).map((row, index) => <tr key={index}><td className="mono">{row.bill}</td><td>{row.date}</td><td className="mono">{row.code}</td><td className="num">{inr(row.amount)}</td></tr>)}</tbody></table>
              </section>
            ) : null}
          </fieldset>
        ) : <div className="cfg-card cfg-empty">Create a coupon to start.</div>}
      </div>
    </div>
  );
}
