import { useEffect, useMemo, useRef, useState } from 'react';
import { GST_RATES } from '../../shared/domain.mjs';
import { ApiError } from './api.js';
import { SearchSelect, ChipSelect } from './search-select.jsx';
import { useAuth } from './auth.jsx';
import './item-master.css';
import { VariantTable, combinations, variantSkus } from './variant-table.jsx';
import { SerialGrid, blankSerial, serialFieldList } from './stock-grids.jsx';
import { useFeedback } from './feedback.jsx';
import { EXPIRY_FORMATS, SHELF_LIFE_TYPES, blankExpiry, calcExpiry, formatExpiry, shelfLifeText } from '../../shared/expiry.mjs';
import { PERIOD_UNITS, WARRANTY_PROVIDERS, WARRANTY_START, addPeriod, blankWarranty, cleanWarranty, warrantyProblem, warrantySummary } from '../../shared/warranty.mjs';
import { BATCH_PATTERNS, ITEM_TYPES, cleanBatchRule, cleanCarton, makeBatchNo, typeFromItem, typeOf } from '../../shared/item-types.mjs';

const TABS = [
  ['basic', 'Basic Details'],
  ['pricing', 'Pricing & Tax'],
  ['inventory', 'Inventory'],
  ['config', 'Item Configuration'],
  ['images', 'Images & Documents'],
];

const SIDE_TABS = [
  ['general', 'General'],
  ['stock', 'Batch & Expiry'],
  ['sales', 'Sales Settings'],
];

const KINDS = [
  { id: 'grocery', title: 'Standard Product', hint: 'Single item', note: 'One price and one stock count', tracking: 'batch' },
  { id: 'matrix', title: 'Matrix', hint: 'Variants', note: 'Stock lines use the categories you fill', tracking: 'none' },
  { id: 'electronics', title: 'Serialised', hint: 'Serial / IMEI', note: 'Each unit keeps its own serial', tracking: 'serial' },
];

const CATEGORY_LEVELS = Array.from({ length: 15 }, (_, index) => String(index + 1));
const PRICE_TYPES = ['MRP (Fixed Price)', 'Selling price', 'Cost plus margin'];

function blank(unitId = '') {
  return {
    ptype: 'standard',
    parentId: '',
    parentQty: '1',
    reorderAlert: true,
    bulkOf: { productId: '', qty: '' },
    carton: { allow: false, sizes: '' },
    stockLevels: {},
    batch: cleanBatchRule({}),
    kind: 'grocery',
    name: '',
    sku: '',
    upc: '',
    barcode: '',
    brandName: '',
    categoryId: '',
    slots: {},
    matrix: [],
    unitId,
    hsnSac: '',
    gstRate: '18',
    mrp: '',
    salePrice: '',
    costPrice: '',
    reorder: '',
    minStock: '',
    maxStock: '',
    rack: '',
    shelf: '',
    locationId: '',
    notes: '',
    allowEditPrice: true,
    allowBelowCost: true,
    enableDiscount: true,
    maxDiscount: '10',
    priceType: 'MRP (Fixed Price)',
    priceMargin: '15',
    autoPrice: false,
    expiry: blankExpiry(),
    warranty: blankWarranty(),
    trackSerial: false,
    mandatorySerial: false,
  };
}

const SETTING_FIELDS = ['rack', 'shelf', 'maxStock', 'priceType', 'priceMargin', 'autoPrice', 'allowEditPrice', 'allowBelowCost', 'enableDiscount', 'maxDiscount', 'trackSerial', 'mandatorySerial'];
function settingsOf(draft) {
  const out = Object.fromEntries(SETTING_FIELDS.map((key) => [key, draft[key]]));
  out.aisleLocationId = draft.locationId || '';
  return out;
}

function message(error) {
  return error instanceof ApiError ? error.message : 'Something went wrong. Try again.';
}

export function ItemMaster({ onClose, onSaved, editId = '' }) {
  const { request } = useAuth();
  const feedback = useFeedback();
  const [loaded, setLoaded] = useState(null);
  const fileRef = useRef(null);
  const [tab, setTab] = useState('basic');
  const [side, setSide] = useState('general');
  const [draft, setDraft] = useState(blank());
  const [categories, setCategories] = useState([]);
  const [labels, setLabels] = useState(Object.fromEntries(CATEGORY_LEVELS.map((level) => [level, `Category ${level}`])));
  const [visible, setVisible] = useState(Object.fromEntries(CATEGORY_LEVELS.map((level) => [level, Number(level) <= 5])));
  const [autoCreate, setAutoCreate] = useState(false);
  const [cartonSupport, setCartonSupport] = useState(false);
  const [units, setUnits] = useState([]);
  const [brands, setBrands] = useState([]);
  const [locations, setLocations] = useState([]);
  const [image, setImage] = useState('');
  const [images, setImages] = useState([]);
  const [lookup, setLookup] = useState({ status: 'idle', message: '' });
  const [fetched, setFetched] = useState({});
  const [source, setSource] = useState(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [skuAuto, setSkuAuto] = useState(true);
  const [variantEdits, setVariantEdits] = useState({});
  const [stockLocation, setStockLocation] = useState('');
  const [saved, setSaved] = useState('');
  const [serialRows, setSerialRows] = useState(() => [blankSerial()]);
  const [serialFields, setSerialFields] = useState(() => serialFieldList(null));
  const again = useRef(false);

  useEffect(() => {
    let live = true;
    Promise.all([
      request('/categories'),
      request('/units'),
      request('/locations'),
      request('/catalogue/labels'),
      request('/brands').catch(() => ({ items: [] })),
    ]).then(([categoryData, unitData, locationData, labelData, brandData]) => {
      if (!live) return;
      setBrands(brandData.items || []);
      setCategories(categoryData.items);
      setUnits(unitData.items);
      setLocations(locationData.items.filter((item) => Number(item.is_active) === 1));
      if (labelData.labels) setLabels((current) => ({ ...current, ...labelData.labels }));
      if (labelData.visible) setVisible((current) => ({ ...current, ...labelData.visible }));
      setAutoCreate(Boolean(labelData.autoCreate));
      setCartonSupport(Boolean(labelData.cartonSupport));
      setSerialFields(serialFieldList(labelData));
      setDraft((current) => ({ ...current, unitId: current.unitId || defaultUnit(unitData.items) }));
    }).catch((err) => {
      if (live) setError(message(err));
    });
    return () => {
      live = false;
    };
  }, [request]);

  function set(patch) {
    setDraft((current) => ({ ...current, ...patch }));
    // a field typed by hand is no longer “fetched”
    setFetched((current) => { const keys = Object.keys(patch).filter((key) => current[key]); if (!keys.length) return current; const next = { ...current }; for (const key of keys) delete next[key]; return next; });
  }
  const isFetched = (key) => Boolean(fetched[key]);

  function idsOf(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    return value ? [value] : [];
  }

  function setSlot(level, value) {
    setDraft((current) => ({ ...current, slots: { ...current.slots, [level]: value } }));
    if (fetched[`slot${level}`]) setFetched((current) => { const next = { ...current }; delete next[`slot${level}`]; return next; });
  }

  async function createCategory(level, name) {
    const existing = categories.find((item) => String(item.level || '1') === level && item.name.toLowerCase() === name.toLowerCase());
    const row = existing || await request('/categories', { method: 'POST', body: { name, level } });
    if (!existing) setCategories((current) => [...current, { id: row.id, name: row.name || name, level }]);
    setDraft((current) => {
      const previous = current.slots?.[level];
      const next = current.kind === 'matrix' ? [...idsOf(previous), row.id] : row.id;
      return { ...current, slots: { ...current.slots, [level]: next } };
    });
  }

  function chooseKind(kind) {
    if (editId) return;
    const item = KINDS.find((entry) => entry.id === kind);
    set({
      kind,
      expiry: kind === 'grocery' ? draft.expiry : { ...draft.expiry, enabled: false },
      trackSerial: kind === 'electronics',
      mandatorySerial: kind === 'electronics',
      tracking: item.tracking,
    });
  }

  // Product Type list (Standard, Matrix, Serialised, Parent, Child, Bulk, Repackaged, Service …)
  const fixedType = (id) => id === 'serial' || id === 'matrix';
  function chooseType(id) {
    const t = typeOf(id);
    if (editId && (fixedType(id) || fixedType(draft.ptype))) return;
    if (!editId) chooseKind(t.kind);
    setDraft((current) => ({ ...current, ptype: id, ...(t.service ? { expiry: { ...current.expiry, enabled: false } } : {}) }));
  }
  const stockless = Boolean(typeOf(draft.ptype).service) || draft.ptype === 'child';
  const stocklessNote = draft.ptype === 'child' ? 'Child Item: it uses its parent item\'s stock' : `${typeOf(draft.ptype).label}: no stock is kept`;
  const [related, setRelated] = useState(null);
  useEffect(() => {
    if (!['child', 'repack'].includes(draft.ptype)) return;
    // fresh list each time, so a parent / bulk item saved a moment ago is offered too
    request('/products').then((data) => setRelated(data.items || [])).catch(() => setRelated([]));
  }, [draft.ptype, request]);
  const relOptions = (want) => (related || []).filter((p) => p.id !== editId && ((p.itemType || p.profile?.itemType) === want)).map((p) => ({ id: p.id, label: `${p.name}${p.variants?.[0]?.sku ? ` · ${p.variants[0].sku}` : ''}` }));

  function setExpiry(patch) {
    setDraft((current) => ({ ...current, expiry: { ...current.expiry, ...patch } }));
  }

  // Edit: load the saved item into the form.
  function fromSaved(item) {
    const variant = item.variants[0] || {};
    const settings = item.profile.settings || {};
    const kind = item.trackingType === 'serial' ? 'electronics' : item.profile.kind === 'matrix' ? 'matrix' : 'grocery';
    return {
      ...blank(item.unitId),
      ...Object.fromEntries(Object.entries(settings).filter(([key]) => SETTING_FIELDS.includes(key))),
      kind,
      name: item.name,
      sku: variant.sku || '',
      upc: item.profile.upc || '',
      barcode: variant.barcode || '',
      brandName: item.brandName || '',
      categoryId: item.categoryId || '',
      slots: Object.fromEntries(Object.entries(item.profile.slots || {}).map(([level, value]) => [level, Array.isArray(value) ? value[0] || '' : value || ''])),
      unitId: item.unitId,
      hsnSac: item.hsnSac || '',
      gstRate: String(item.gstRate || '18'),
      mrp: variant.mrp || '',
      salePrice: variant.salePrice || '',
      costPrice: variant.costPrice || '',
      reorder: variant.minStock != null ? String(Number(variant.minStock)) : '',
      minStock: variant.minStock != null ? String(Number(variant.minStock)) : '',
      locationId: settings.aisleLocationId || '',
      notes: item.profile.notes || '',
      expiry: { ...blankExpiry(), ...(item.profile.expiry || {}) },
      warranty: cleanWarranty(item.profile.warranty || {}),
      ptype: item.profile.itemType || typeFromItem({ profile: item.profile, trackingType: item.trackingType }),
      parentId: item.profile.parentId || '',
      parentQty: String(item.profile.parentQty || '1'),
      reorderAlert: item.profile.reorderAlert !== false,
      bulkOf: { productId: item.profile.bulkOf?.productId || '', qty: item.profile.bulkOf?.qty || '' },
      carton: { allow: Boolean(item.profile.carton?.allow), sizes: (item.profile.carton?.sizes || []).join(', ') },
      stockLevels: item.profile.stockLevels || {},
      batch: cleanBatchRule(item.profile.batch || {}),
      trackSerial: item.trackingType === 'serial',
      mandatorySerial: item.trackingType === 'serial',
    };
  }

  useEffect(() => {
    if (!editId) return;
    request(`/products/${editId}/full`).then((item) => {
      setLoaded(item);
      setSkuAuto(false);
      setDraft(fromSaved(item));
      setImage(item.profile.image || '');
    }).catch((err) => setError(message(err)));
  }, [editId, request]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickImage(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImage(String(reader.result || ''));
    reader.readAsDataURL(file);
  }

  function matchCategory(path) {
    const parts = String(path || '').toLowerCase().split(/[,>/]/).map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return '';
    const level1 = categories.filter((item) => String(item.level || '1') === '1');
    const hit = level1.find((item) => parts.some((part) => part === item.name.toLowerCase()))
      || level1.find((item) => parts.some((part) => part.includes(item.name.toLowerCase()) || item.name.toLowerCase().includes(part)));
    return hit?.id || '';
  }

  async function lookupUpc(refresh = false) {
    const code = String(draft.upc || '').trim();
    if (code.replace(/[^0-9A-Za-z]/g, '').length < 3) {
      setLookup({ status: 'error', message: 'Scan or type a barcode (UPC, EAN, ISBN, GTIN) or a model number, then press Enter.' });
      return null;
    }
    setLookup({ status: 'loading', message: refresh ? 'Looking for more images…' : 'Looking up this code…' });
    try {
      const data = await request(`/catalogue/lookup?code=${encodeURIComponent(code)}${refresh ? '&refresh=1' : ''}`);
      if (data.existing && !refresh) {
        setLookup({ status: 'exists', message: `Already in your catalogue as “${data.existing.name}”.` });
        return data;
      }
      if (!data.found) {
        setLookup({ status: data.reason === 'OFFLINE' ? 'error' : 'notfound', message: `${data.codeLabel ? `${data.codeLabel}: ` : ''}${data.message}${data.checksumOk === false ? ' The check digit looks wrong — re-check the code.' : ''}` });
        return data;
      }
      if (refresh) return data;
      const categoryId = matchCategory(data.category);
      const filled = {
        upc: true, name: Boolean(data.name), hsnSac: Boolean(data.hsn), gstRate: data.gstRate !== '' && data.gstRate != null,
        mrp: Boolean(data.price?.mrp), salePrice: Boolean(data.price?.sale), brandName: Boolean(data.brand), notes: Boolean(data.description),
        slot1: Boolean(categoryId) && !draft.slots?.['1'], image: Boolean(data.images?.length),
      };
      const keys = Object.keys(filled).filter((key) => filled[key]);
      setFetched(Object.fromEntries(keys.map((key) => [key, true])));
      setSource({ method: 'code_lookup', code: data.code || code, codeType: data.codeLabel || data.codeType || '', sources: data.sources || [], at: new Date().toISOString(), fields: keys });
      setDraft((current) => ({
        ...current,
        upc: data.codeType === 'TEXT' ? (data.matches?.[0]?.code || current.upc) : data.code,
        name: data.name || current.name,
        hsnSac: data.hsn || current.hsnSac,
        gstRate: data.gstRate !== '' && data.gstRate != null ? data.gstRate : current.gstRate,
        mrp: data.price?.mrp ? String(data.price.mrp) : current.mrp,
        salePrice: data.price?.sale ? String(data.price.sale) : current.salePrice,
        brandName: data.brand || current.brandName,
        notes: (data.description || current.notes || '').slice(0, 500),
        slots: categoryId && !current.slots?.['1'] ? { ...current.slots, 1: current.kind === 'matrix' ? [categoryId] : categoryId } : current.slots,
      }));
      setImages(data.images || []);
      setImage(data.images?.[0] || '');
      const parts = [
        data.kind === 'book' && data.authors?.length ? `By ${data.authors.join(', ')}` : '',
        data.brand && (data.kind === 'book' ? `Publisher ${data.brand}` : `Brand ${data.brand}`),
        `from ${data.sources.join(' + ')}`,
        data.images?.length ? `${data.images.length} image${data.images.length === 1 ? '' : 's'}` : 'no image',
      ];
      const tax = data.hsn ? ` HSN ${data.hsn} and GST ${data.gstRate}% filled (${data.taxLabel}) — confirm for your invoices.` : ' HSN/GST not recognised for this item — enter them.';
      const price = data.price
        ? ` MRP ₹${data.price.mrp}${data.price.sale !== data.price.mrp ? `, sale ₹${data.price.sale}` : ''} filled from ${data.price.source}${data.price.at ? ` (${new Date(data.price.at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })})` : ''} — check against the pack.`
        : ' No Indian price online — enter MRP, sale and cost price.';
      const extra = data.codeType === 'TEXT' ? ' Closest match from a text search — check it is the right item.' : '';
      setLookup({ status: 'found', message: `${data.codeLabel} found. ${parts.filter(Boolean).join(' · ')}.${tax}${price}${extra}${data.checksumOk === false ? ' Check digit looks wrong — verify the code.' : ''}` });
      return data;
    } catch (err) {
      setLookup({ status: 'error', message: message(err) });
      return null;
    }
  }

  async function refreshImage() {
    const at = images.indexOf(image);
    if (at >= 0 && at + 1 < images.length) {
      setImage(images[at + 1]);
      setLookup((current) => ({ ...current, message: `Image ${at + 2} of ${images.length}.` }));
      return;
    }
    const data = await lookupUpc(true);
    const fresh = (data?.images || []).filter((url) => !images.includes(url));
    if (fresh.length) {
      setImages((current) => [...current, ...fresh]);
      setImage(fresh[0]);
      setLookup({ status: 'found', message: `Found ${fresh.length} more image${fresh.length === 1 ? '' : 's'}.` });
    } else if (images.length) {
      setImage(images[0]);
      setLookup({ status: 'found', message: `No new images online. Showing image 1 of ${images.length} again.` });
    } else if (data) {
      setLookup({ status: 'notfound', message: 'No image found online for this code. Upload one instead.' });
    }
  }

  function upcKey(event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      lookupUpc(false);
    }
  }

  // Auto SKU from the item name until the user types their own.
  useEffect(() => {
    if (!skuAuto || editId) return undefined;
    const name = draft.name.trim();
    if (name.length < 2) {
      setDraft((current) => (current.sku ? { ...current, sku: '' } : current));
      return undefined;
    }
    let live = true;
    const timer = setTimeout(() => {
      request(`/catalogue/next-sku?name=${encodeURIComponent(name)}`)
        .then((data) => { if (live) setDraft((current) => ({ ...current, sku: data.sku })); })
        .catch(() => {});
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [draft.name, skuAuto, request]);

  useEffect(() => {
    if (!stockLocation && locations.length) setStockLocation(locations[0].id);
  }, [locations, stockLocation]);

  const matrixLevels = useMemo(() => {
    if (draft.kind !== 'matrix') return [];
    return CATEGORY_LEVELS.filter((level) => visible[level]).map((level) => ({
      level,
      label: labels[level] || `Category ${level}`,
      values: idsOf(draft.slots?.[level]).map((id) => ({ id, name: categories.find((item) => item.id === id)?.name || id })),
    })).filter((level) => level.values.length);
  }, [draft.kind, draft.slots, visible, labels, categories]);

  const variantRows = useMemo(() => {
    const combos = combinations(matrixLevels);
    const skus = variantSkus(draft.sku, combos);
    return combos.map((combo) => ({
      key: combo.key,
      attrs: combo.names,
      slots: combo.slots,
      include: true,
      name: [draft.name.trim() || 'Item', ...combo.names].join(' - '),
      sku: skus[combo.key],
      barcode: '',
      mrp: draft.mrp,
      salePrice: draft.salePrice,
      costPrice: draft.costPrice,
      hsnSac: draft.hsnSac,
      gstRate: draft.gstRate,
      openingStock: '',
      minStock: draft.reorder || draft.minStock || '',
      ...variantEdits[combo.key],
    }));
  }, [matrixLevels, draft.sku, draft.name, draft.mrp, draft.salePrice, draft.costPrice, draft.hsnSac, draft.gstRate, draft.reorder, draft.minStock, variantEdits]);

  function editVariant(key, field, value) {
    setVariantEdits((current) => ({ ...current, [key]: { ...current[key], [field]: value } }));
  }

  function copyVariant(field, value, keys) {
    setVariantEdits((current) => {
      const next = { ...current };
      for (const key of keys) next[key] = { ...next[key], [field]: value };
      return next;
    });
  }

  function toggleVariants(keys, include) {
    copyVariant('include', include, keys);
  }

  function regenerateSkus() {
    setVariantEdits((current) => Object.fromEntries(Object.entries(current).map(([key, edits]) => {
      const { sku: _drop, ...rest } = edits;
      return [key, rest];
    })));
  }

  async function reset() {
    if (editId) {
      if (!(await feedback.confirm({ title: 'Undo your changes?', message: 'The form goes back to the saved item details.', confirmLabel: 'Undo changes' }))) return;
      if (loaded) { setDraft(fromSaved(loaded)); setImage(loaded.profile.image || ''); setError(''); }
      return;
    }
    if (draft.name.trim() && !(await feedback.confirm({ title: 'Clear the form?', message: 'Everything you typed for this item will be cleared.', confirmLabel: 'Clear', tone: 'danger' }))) return;
    resetForm();
  }

  function resetForm() {
    setDraft(blank(defaultUnit(units)));
    setImage('');
    setImages([]);
    setLookup({ status: 'idle', message: '' });
    setFetched({});
    setSource(null);
    setError('');
    setSkuAuto(true);
    setVariantEdits({});
    setSerialRows([blankSerial()]);
    setTab('basic');
    setSide('general');
  }

  async function save(event) {
    event.preventDefault();
    setPending(true);
    setError('');
    const tracking = draft.trackSerial ? 'serial' : draft.expiry.enabled ? 'batch' : 'none';
    const itemType = Array.isArray(draft.slots?.['1']) ? draft.slots['1'][0] : draft.slots?.['1'];
    if (!itemType) { setError(`Choose the ${labels['1'] || 'Item Type'} — it is compulsory.`); setTab('basic'); setPending(false); return; }
    if (draft.expiry.enabled && draft.expiry.autoCalc && draft.expiry.shelfLifeType !== 'date' && !(Number(draft.expiry.shelfLifeValue) > 0)) { setError('Enter the shelf life value, or switch off automatic expiry.'); setPending(false); return; }
    if (draft.expiry.enabled && draft.expiry.autoCalc && draft.expiry.shelfLifeType === 'date' && !draft.expiry.fixedDate) { setError('Choose the fixed expiry date.'); setPending(false); return; }
    if (draft.trackSerial && warrantyProblem(cleanWarranty(draft.warranty))) { setError(warrantyProblem(cleanWarranty(draft.warranty))); setPending(false); return; }
    if (draft.ptype === 'child' && !draft.parentId) { setError('Child Item: choose its parent item.'); setTab('basic'); setPending(false); return; }
    if (draft.ptype === 'repack' && (!draft.bulkOf.productId || !(Number(draft.bulkOf.qty) > 0))) { setError('Repackaged Item: choose the bulk item and how much one pack uses.'); setTab('basic'); setPending(false); return; }
    if (cartonSupport && draft.carton?.allow && !cleanCarton(draft.carton).sizes.length) { setError('Allow Cartoon: enter at least one carton size (e.g. 5x5x5x5).'); setTab('basic'); setPending(false); return; }
    const typeFields = { itemType: draft.ptype, parentId: draft.parentId, parentQty: draft.parentQty, reorderAlert: draft.reorderAlert, bulkOf: draft.bulkOf, stockLevels: draft.stockLevels, batch: draft.batch, ...(cartonSupport ? { carton: cleanCarton(draft.carton) } : {}) };
    try {
      if (editId) {
        if (!(await feedback.confirm({ title: 'Save changes to this item?', message: `${draft.name} · ${draft.sku}`, detail: 'Prices you change apply to new bills and documents from now on.', confirmLabel: 'Save changes' }))) { setPending(false); return; }
        await request(`/products/${editId}`, {
          method: 'PUT',
          body: {
            name: draft.name, unitId: draft.unitId, hsnSac: draft.hsnSac, gstRate: draft.gstRate,
            categoryId: idsOf(draft.slots?.['1'])[0] || null,
            slots: Object.fromEntries(CATEGORY_LEVELS.filter((level) => visible[level]).map((level) => [level, idsOf(draft.slots?.[level])[0] || ''])),
            brandName: draft.brandName, upc: draft.upc, imageUrl: /^https:\/\//i.test(image) ? image : '', notes: draft.notes,
            settings: settingsOf(draft), expiry: draft.kind === 'grocery' ? draft.expiry : { enabled: false },
            ...(draft.trackSerial ? { warranty: draft.warranty } : {}),
            ...typeFields,
            variant: { sku: draft.sku, barcode: draft.barcode, mrp: draft.mrp, salePrice: draft.salePrice, costPrice: draft.costPrice, minStock: draft.reorder || draft.minStock || '0' },
          },
        });
        await feedback.success({ title: 'Item updated successfully', message: `${draft.name} · ${draft.sku}` });
        if (onSaved) await onSaved();
        return;
      }
      if (draft.kind === 'matrix') {
        const rows = variantRows.filter((row) => row.include);
        if (!rows.length) throw new ApiError(400, 'INVALID', 'Pick category values so the variant table has rows to create.');
        const result = await request('/products/matrix', {
          method: 'POST',
          body: {
            base: {
              name: draft.name,
              unitId: draft.unitId,
              hsnSac: draft.hsnSac,
              gstRate: draft.gstRate,
              trackingType: tracking,
              upc: draft.upc,
              brandName: draft.brandName,
              imageUrl: /^https:\/\//i.test(image) ? image : '',
              notes: draft.notes,
              settings: settingsOf(draft),
              categoryId: idsOf(draft.slots?.['1'])[0] || '',
              source: source || { method: 'manual' },
              batch: draft.batch,
              stockLevels: draft.stockLevels,
            },
            locationId: stockLocation,
            rows: rows.map(({ key: _key, attrs: _attrs, include: _include, ...row }) => row),
          },
        });
        setSaved(`${result.count} item${result.count === 1 ? '' : 's'} created from the variant table.`);
        feedback.success({ title: 'Items saved successfully', message: `${result.count} variant item${result.count === 1 ? '' : 's'} created.` });
        if (again.current) {
          again.current = false;
          resetForm();
        } else if (onSaved) {
          await onSaved();
        }
        return;
      }
      await request('/products', {
        method: 'POST',
        body: {
          name: draft.name,
          categoryId: idsOf(draft.slots?.['1'])[0] || null,
          kind: draft.kind,
          slots: Object.fromEntries(CATEGORY_LEVELS.filter((level) => visible[level]).map((level) => [
            level,
            draft.kind === 'matrix' ? idsOf(draft.slots?.[level]) : idsOf(draft.slots?.[level])[0] || '',
          ])),
          matrix: draft.kind === 'matrix' ? CATEGORY_LEVELS.filter((level) => visible[level] && idsOf(draft.slots?.[level]).length) : [],
          unitId: draft.unitId,
          hsnSac: draft.hsnSac,
          gstRate: draft.gstRate,
          trackingType: tracking,
          isService: false,
          upc: draft.upc,
          brandName: draft.brandName,
          imageUrl: /^https:\/\//i.test(image) ? image : '',
          notes: draft.notes,
          settings: settingsOf(draft),
          expiry: draft.kind === 'grocery' ? draft.expiry : { enabled: false },
          warranty: draft.trackSerial ? draft.warranty : { enabled: false },
          ...typeFields,
          serials: draft.kind === 'electronics' ? serialRows.filter((row) => row.serial1.trim()) : [],
          source: source || { method: 'manual' },
          locationId: stockLocation,
          variant: {
            sku: draft.sku,
            barcode: draft.barcode,
            mrp: draft.mrp,
            salePrice: draft.salePrice,
            costPrice: draft.costPrice,
            minStock: draft.reorder || draft.minStock || '0',
          },
        },
      });
      feedback.success({ title: 'Item saved successfully', message: `${draft.name}${draft.sku ? ` · ${draft.sku}` : ''}` });
      if (again.current) {
        again.current = false;
        resetForm();
      } else if (onSaved) {
        await onSaved();
      }
    } catch (err) {
      setError(message(err));
    } finally {
      setPending(false);
    }
  }

  function submitAgain() {
    again.current = true;
    const form = document.querySelector('.im');
    if (!form?.reportValidity()) {
      again.current = false;
      return;
    }
    form.requestSubmit();
  }


  return (
    <form className="im panel-closed" onSubmit={save}>
      <section className="im-main">
        <header className="im-head">
          <div className="im-title">
            <span className="im-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M4 8l8-4 8 4-8 4-8-4zM4 8v8l8 4 8-4V8M12 12v8" /></svg>
            </span>
            <div>
              <h2>{editId ? 'Edit Item' : 'Item Master'}</h2>
              <p>{editId ? (loaded ? `Editing ${loaded.name}${loaded.stockQty ? ` · ${loaded.stockQty} in stock` : ''}. Item type cannot change after creation.` : 'Loading the item…') : 'Create a new item.'}</p>
            </div>
          </div>
          <div className="im-actions">
            <button type="button" className="im-btn" data-sc="reset" onClick={reset}>{editId ? 'Undo Changes' : 'Reset'}</button>
            {editId ? null : <button type="button" className="im-btn" disabled={pending} onClick={submitAgain} data-sc="save-new">Save &amp; Add New</button>}
            <button type="submit" className="im-btn primary" disabled={pending || (editId && !loaded)} data-sc="save">{pending ? 'Saving…' : editId ? 'Save Changes' : 'Save Item'}</button>
          </div>
        </header>

        <div className="im-tabs" role="tablist">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'on' : undefined} onClick={() => setTab(id)}>{label}</button>
          ))}
        </div>

        {error ? <p className="form-error im-error">{error}</p> : null}
        {saved ? <p className="im-lookup found">{saved}</p> : null}

        {tab === 'basic' ? (
          <>
            <Block index="1" title="Basic Information">
              <div className="im-grid">
                <Field label="Product Type" required>
                  <SearchSelect required value={draft.ptype} placeholder="Search product type" options={ITEM_TYPES.filter((t) => !editId || t.id === draft.ptype || (!fixedType(t.id) && !fixedType(draft.ptype))).map((t) => ({ id: t.id, label: t.label }))} onChange={(id) => id && chooseType(id)} />
                  <small className="im-type-hint">{typeOf(draft.ptype).hint}{editId && fixedType(draft.ptype) ? ' · cannot change after creation' : ''}</small>
                </Field>
                {draft.ptype === 'child' ? (
                  <Field label="Parent Item" required>
                    <SearchSelect required value={draft.parentId} placeholder={related ? (relOptions('parent').length ? 'Search parent item' : 'No Parent Items yet') : 'Loading…'} options={relOptions('parent')} onChange={(parentId) => set({ parentId })} />
                  </Field>
                ) : null}
                {draft.ptype === 'child' ? (
                  <Field label="Parent qty used per 1 child" required>
                    <input required inputMode="decimal" placeholder="1" value={draft.parentQty} onChange={(event) => set({ parentQty: event.target.value.replace(/[^0-9.]/g, '') })} />
                    <small className="im-type-hint">Selling 1 child takes this much stock from the parent (e.g. 0.1 = one of a pack of 10). The child keeps no stock of its own.</small>
                  </Field>
                ) : null}
                {draft.ptype === 'repack' ? (
                  <>
                    <Field label="Packed from (Bulk Item)" required>
                      <SearchSelect required value={draft.bulkOf.productId} placeholder={related ? (relOptions('bulk').length ? 'Search bulk item' : 'No Bulk Items yet') : 'Loading…'} options={relOptions('bulk')} onChange={(productId) => set({ bulkOf: { ...draft.bulkOf, productId } })} />
                    </Field>
                    <Field label="Bulk qty used per pack" required><input required inputMode="decimal" placeholder="e.g. 1 (kg)" value={draft.bulkOf.qty} onChange={(event) => set({ bulkOf: { ...draft.bulkOf, qty: event.target.value.replace(/[^0-9.]/g, '') } })} /></Field>
                  </>
                ) : null}
                <Field label="Item Name" required fetched={isFetched('name')}><input required value={draft.name} onChange={(event) => set({ name: event.target.value })} /></Field>
                <CategorySlot
                  label={labels['1'] || 'Item Type'}
                  required
                  value={draft.slots?.['1']}
                  options={categoryOptions(categories, '1')}
                  multi={false}
                  autoCreate={autoCreate}
                  onCreate={(name) => createCategory('1', name).catch((err) => setError(message(err)))}
                  onChange={(value) => setSlot('1', value)}
                  fetched={isFetched('slot1')}
                />
                <Field label="Brand" fetched={isFetched('brandName')}>
                  <SearchSelect value={brands.find((b) => b.name.toLowerCase() === String(draft.brandName || '').toLowerCase())?.id || (draft.brandName ? `new:${draft.brandName}` : '')} placeholder="Search or type a brand" options={[...brands.map((b) => ({ id: b.id, label: b.name })), ...(draft.brandName && !brands.some((b) => b.name.toLowerCase() === String(draft.brandName).toLowerCase()) ? [{ id: `new:${draft.brandName}`, label: `${draft.brandName} (new)` }] : [])]} allowCreate onCreate={(name) => set({ brandName: String(name).trim() })} onChange={(id) => set({ brandName: id.startsWith('new:') ? id.slice(4) : brands.find((b) => b.id === id)?.name || '' })} />
                </Field>
                <Field label={draft.kind === 'matrix' ? 'SKU Prefix (auto)' : 'Item Code / SKU (auto)'}>
                  <div className="im-barcode">
                    <input value={draft.sku} placeholder="Generated from the item name" onChange={(event) => { setSkuAuto(false); set({ sku: event.target.value.toUpperCase() }); }} />
                    <button type="button" title="Generate a new code" aria-label="Generate SKU" className={skuAuto ? 'on' : undefined} onClick={() => { setSkuAuto(true); request(`/catalogue/next-sku?name=${encodeURIComponent(draft.name || 'Item')}`).then((data) => set({ sku: data.sku })).catch(() => {}); }}>
                      <svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" /></svg>
                    </button>
                  </div>
                </Field>
                <Field label="Unit" required>
                  <SearchSelect required value={draft.unitId} placeholder="Search unit" onChange={(unitId) => set({ unitId })} options={units.map((item) => ({ id: item.id, label: item.name }))} />
                </Field>
                <Field label="UPC / EAN / ISBN Code" fetched={isFetched('upc')}>
                  <div className="im-barcode">
                    <input placeholder="Scan barcode / ISBN or type model no., press Enter" value={draft.upc} onChange={(event) => { set({ upc: event.target.value }); if (lookup.status !== 'idle') setLookup({ status: 'idle', message: '' }); }} onKeyDown={upcKey} />
                    <button type="button" aria-label="Look up UPC/EAN code" title="Look up (Enter)" disabled={lookup.status === 'loading'} onClick={() => lookupUpc(false)}>
                      {lookup.status === 'loading' ? <span className="im-spin" /> : <svg viewBox="0 0 24 24"><path d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM21 21l-5.2-5.2" /></svg>}
                    </button>
                  </div>
                </Field>
                <Field label="Custom Barcode">
                  <div className="im-barcode">
                    <input value={draft.barcode} onChange={(event) => set({ barcode: event.target.value })} />
                    <button type="button" aria-label="Focus barcode" onClick={(event) => event.currentTarget.previousElementSibling?.focus()}>
                      <svg viewBox="0 0 24 24"><path d="M4 6v12M7 6v12M10 6v12M14 6v12M18 6v12M21 6v12" /></svg>
                    </button>
                  </div>
                </Field>
                <Field label="HSN Code" fetched={isFetched('hsnSac')}><input value={draft.hsnSac} onChange={(event) => set({ hsnSac: event.target.value })} /></Field>
                {cartonSupport ? (
                  <div className="im-field im-carton">
                    <span>Cartons</span>
                    <label className="im-check"><input type="checkbox" checked={Boolean(draft.carton?.allow)} onChange={(event) => set({ carton: { ...draft.carton, allow: event.target.checked } })} /> Allow Cartoon</label>
                    {draft.carton?.allow ? <input placeholder="Carton sizes, e.g. 5x5x5x5, 10x10" value={draft.carton.sizes} onChange={(event) => set({ carton: { ...draft.carton, sizes: event.target.value } })} /> : null}
                    <small className="im-type-hint">{draft.carton?.allow ? 'Carton size labels, separated by commas. Sales windows ask the number of cartons for this item and show it in the Carton column.' : 'Tick to sell this item in cartons.'}</small>
                  </div>
                ) : null}
              </div>
              {draft.ptype === 'kit' ? <p className="im-lookup found">KIT/Combo Product: after saving, map the items it is made of in Inventory → KIT/Combo Mapping, then pack kits in KIT/Combo Packing (the mapped items’ stock goes down, the kits come in with stock barcodes).</p> : null}
              <div className="im-desc">
                <div className="im-desc-tools">
                  <button type="button" className="im-btn" disabled={!draft.name.trim()} title={draft.name.trim() ? 'Write the description from the item name, brand, categories, unit, prices and settings' : 'Enter the item name first'} onClick={() => set({ notes: describeItem(draft, { categories, units, labels, visible }) })}>Generate description</button>
                  <button type="button" className="im-btn im-icon" disabled={!draft.name.trim() || !draft.notes} aria-label="Refresh description" title={draft.name.trim() ? 'Refresh the description with the latest details' : 'Enter the item name first'} onClick={() => set({ notes: describeItem(draft, { categories, units, labels, visible }) })}>
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" /></svg>
                  </button>
                  {!draft.name.trim() ? <small>Enter the item name to generate a description.</small> : null}
                </div>
                <Field label="Item Description">
                  <textarea maxLength={500} rows={4} placeholder="Add any notes or description about the item…" value={draft.notes} onChange={(event) => set({ notes: event.target.value })} />
                  <small className="im-count">{draft.notes.length}/500</small>
                </Field>
              </div>
              {lookup.message ? (
                <p className={`im-lookup ${lookup.status}`} role="status">
                  {lookup.message}
                  {lookup.status === 'found' && draft.brandName ? <span> Brand “{draft.brandName}” will be saved with the item.</span> : null}
                </p>
              ) : null}
              {Object.keys(fetched).length ? <p className="im-fetch-legend"><i className="im-auto">auto</i> <b>{Object.keys(fetched).length} field{Object.keys(fetched).length === 1 ? '' : 's'} filled automatically</b> from {source?.codeType || 'the code'} {source?.code}{source?.sources?.length ? ` (${source.sources.join(' + ')})` : ''} — shown in green. Edit a field to confirm it; the item will be saved as “Added via code lookup”.</p> : null}
            </Block>
            <Block index="2" title="Category Details">
              <div className="im-grid">
                {CATEGORY_LEVELS.filter((level) => visible[level] && level !== '1').map((level) => (
                  <CategorySlot
                    key={level}
                    label={labels[level] || `Category ${level}`}
                    required={level === '1'}
                    value={draft.slots?.[level]}
                    options={categoryOptions(categories, level)}
                    multi={draft.kind === 'matrix' && !editId}
                    autoCreate={autoCreate || (draft.kind === 'matrix' && !editId)}
                    onCreate={(name) => createCategory(level, name).catch((err) => setError(message(err)))}
                    onChange={(value) => setSlot(level, value)}
                  />
                ))}
              </div>
            </Block>
            {draft.kind === 'matrix' && !editId ? (
              <Block index="3" title="Variants (one item per combination)">
                <VariantTable
                  rows={variantRows}
                  attrLabels={matrixLevels.filter((level) => level.values.length > 1).map((level) => level.label)}
                  locations={locations}
                  locationId={stockLocation}
                  onLocation={setStockLocation}
                  onEdit={editVariant}
                  onCopy={copyVariant}
                  onToggle={toggleVariants}
                  onRegenerate={regenerateSkus}
                />
              </Block>
            ) : null}
            {draft.trackSerial || draft.kind === 'electronics' ? (
              <Block index="3" title="Warranty & Guarantee">
                <WarrantyFields value={draft.warranty} onChange={(patch) => set({ warranty: { ...draft.warranty, ...patch } })} />
              </Block>
            ) : null}
            {draft.kind === 'electronics' && !editId ? (
              <Block index="4" title="Serial Numbers (opening stock)">
                <SerialGrid
                  rows={serialRows}
                  fields={serialFields}
                  onChange={setSerialRows}
                  defaults={{ mrp: draft.mrp, salePrice: draft.salePrice, costPrice: draft.costPrice }}
                  extra={(
                    <label>Location
                      <select value={stockLocation} onChange={(event) => setStockLocation(event.target.value)}>
                        {locations.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                      </select>
                    </label>
                  )}
                />
              </Block>
            ) : null}
          </>
        ) : null}

        {tab === 'pricing' ? (
          <Block index="1" title="Pricing & Tax">
            <div className="im-grid">
              <Field label="MRP (₹)" fetched={isFetched('mrp')}><input inputMode="decimal" value={draft.mrp} onChange={(event) => set({ mrp: event.target.value })} /></Field>
              <Field label="Sale Price (₹)" fetched={isFetched('salePrice')}><input inputMode="decimal" value={draft.salePrice} onChange={(event) => set({ salePrice: event.target.value })} /></Field>
              <Field label="Cost Price (₹)"><input inputMode="decimal" value={draft.costPrice} onChange={(event) => set({ costPrice: event.target.value })} /></Field>
              <Field label="GST %" fetched={isFetched('gstRate')}>
                <select value={draft.gstRate} onChange={(event) => set({ gstRate: event.target.value })}>
                  {[...new Set([...GST_RATES, draft.gstRate].filter(Boolean))].map((rate) => <option key={rate} value={rate}>{rate}%</option>)}
                </select>
              </Field>
              <Field label="HSN / SAC"><input value={draft.hsnSac} onChange={(event) => set({ hsnSac: event.target.value })} /></Field>
              <Field label="Price Type">
                <select value={draft.priceType} onChange={(event) => set({ priceType: event.target.value })}>
                  {PRICE_TYPES.map((item) => <option key={item}>{item}</option>)}
                </select>
              </Field>
            </div>
          </Block>
        ) : null}

        {tab === 'inventory' ? (
          <Block index="1" title="Inventory">
            {stockless ? <p className="im-note">{stocklessNote}, so reorder levels do not apply.</p> : null}
            {!stockless ? <LocationLevels locations={locations} value={draft.stockLevels} draft={draft} set={set} onChange={(stockLevels) => set({ stockLevels })} /> : null}
          </Block>
        ) : null}

        {tab === 'config' ? (
          <Block index="1" title="Item Configuration">
            <div className="im-side-tabs">
              {SIDE_TABS.map(([id, label]) => (
                <button key={id} type="button" className={side === id ? 'on' : undefined} onClick={() => setSide(id)}>{label}</button>
              ))}
            </div>
            <ConfigBody draft={draft} set={set} side={side} setExpiry={setExpiry} stockless={stockless} stocklessNote={stocklessNote} />
          </Block>
        ) : null}

        {tab === 'images' ? (
          <Block index="1" title="Images & Documents">
            <div className="im-drop wide" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); pickImage(event.dataTransfer.files?.[0]); }}>
              <button type="button" onClick={() => fileRef.current?.click()}>
                Choose an image
                <small>JPG, PNG · Max 2MB</small>
              </button>
              {image ? <img src={image} alt="" /> : null}
            </div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden onChange={(event) => pickImage(event.target.files?.[0])} />
            {image ? <div className="im-img-actions"><button type="button" className="im-img-btn ghost" onClick={() => setImage('')}>Remove image</button>{draft.upc ? <button type="button" className="im-img-btn" onClick={() => refreshImage()}>Find another image online</button> : null}</div> : null}
          </Block>
        ) : null}
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

function Field({ label, required, children, fetched }) {
  return (
    <label className={fetched ? 'im-field im-fetched' : 'im-field'} title={fetched ? 'Filled automatically from the code lookup — check it' : undefined}>
      <span>{label}{required ? <em>*</em> : null}{fetched ? <i className="im-auto">auto</i> : null}</span>
      {children}
    </label>
  );
}

function Toggle({ on, label, hint, onChange }) {
  return (
    <div className="im-toggle">
      <div>
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </div>
      <button type="button" role="switch" aria-checked={on} className={on ? 'on' : undefined} onClick={() => onChange(!on)} />
    </div>
  );
}

// Automatic batch numbers (all item types): every new receipt of stock gets the next number.
function BatchRuleFields({ value, onChange }) {
  const rule = cleanBatchRule(value || {});
  return (
    <div className="im-expiry">
      <Toggle on={rule.auto} label="Generate batch number automatically" hint="Works for every item type. Each stock receipt (opening stock, purchase, adjustment, serial receipt) without a batch number gets the next number; you can still type one yourself." onChange={(auto) => onChange({ auto })} />
      {rule.auto ? (
        <div className="im-expiry-body im-batch-body">
          <div className="im-grid">
            <Field label="Prefix"><input value={rule.prefix} maxLength={8} onChange={(event) => onChange({ prefix: event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} /></Field>
            <Field label="Number format"><select value={rule.pattern} onChange={(event) => onChange({ pattern: event.target.value })}>{BATCH_PATTERNS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
          </div>
          <p className="im-expiry-note im-wnote">Next batches look like <b>{makeBatchNo(rule, 1)}</b>, <b>{makeBatchNo(rule, 2)}</b> …</p>
        </div>
      ) : null}
    </div>
  );
}

// Inventory → reorder / min / max for each location (blank = the all-locations value)
// Location-wise reorder / minimum / maximum and rack / shelf. The first row is the default for every location.
const LEVEL_COLS = [['reorder', 'Reorder level', 'reorder', true], ['min', 'Minimum', 'minStock', true], ['max', 'Maximum', 'maxStock', true], ['rack', 'Rack No.', 'rack', false], ['shelf', 'Shelf No.', 'shelf', false]];
function LocationLevels({ locations, value, draft, set: setDraft, onChange }) {
  const set = (id, key, v, numeric) => {
    const row = { ...(value[id] || {}), [key]: numeric ? v.replace(/[^0-9.]/g, '') : v.slice(0, 20) };
    const next = { ...value, [id]: row };
    if (!row.reorder && !row.min && !row.max && !row.rack && !row.shelf && typeof row.alert !== 'boolean') delete next[id];
    onChange(next);
  };
  // a location's tick is kept only when it differs from the first row
  const setAlert = (id, on) => {
    const row = { ...(value[id] || {}) };
    if (on === (draft.reorderAlert !== false)) delete row.alert; else row.alert = on;
    const next = { ...value, [id]: row };
    if (!row.reorder && !row.min && !row.max && !row.rack && !row.shelf && typeof row.alert !== 'boolean') delete next[id];
    onChange(next);
  };
  return (
    <div className="im-loclevels">
      <h4>Location-wise stock levels &amp; rack</h4>
      <p className="im-note">The first row applies to every location. Fill a location's own cell only where it differs; blank cells use the first row. Low-stock alerts use each location's reorder level — untick “Reorder alert required?” to stop alerts for that location.</p>
      <div className="im-loctable">
        <table>
          <thead><tr><th>Location</th><th className="im-alertcol">Reorder alert required?</th>{LEVEL_COLS.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
          <tbody>
            <tr className="im-locdefault">
              <td><b>All locations (default)</b></td>
              <td className="im-alertcol"><input type="checkbox" checked={draft.reorderAlert !== false} onChange={(event) => setDraft({ reorderAlert: event.target.checked })} aria-label="Reorder alert required for all locations" /></td>
              {LEVEL_COLS.map(([key, label, field, numeric]) => <td key={key}><input inputMode={numeric ? 'decimal' : undefined} value={draft[field] ?? ''} onChange={(event) => setDraft({ [field]: numeric ? event.target.value.replace(/[^0-9.]/g, '') : event.target.value })} aria-label={`All locations ${label}`} /></td>)}
            </tr>
            {locations.map((l) => (
              <tr key={l.id}>
                <td>{l.name}</td>
                <td className="im-alertcol"><input type="checkbox" checked={typeof value[l.id]?.alert === 'boolean' ? value[l.id].alert : draft.reorderAlert !== false} onChange={(event) => setAlert(l.id, event.target.checked)} aria-label={`Reorder alert required at ${l.name}`} /></td>
                {LEVEL_COLS.map(([key, label, field, numeric]) => <td key={key}><input inputMode={numeric ? 'decimal' : undefined} value={value[l.id]?.[key] ?? ''} placeholder={draft[field] || '—'} onChange={(event) => set(l.id, key, event.target.value, numeric)} aria-label={`${l.name} ${label}`} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PeriodInput({ label, part, onChange }) {
  return (
    <div className={`im-wperiod${part.on ? '' : ' off'}`}>
      <label className="im-wcheck"><input type="checkbox" checked={part.on} onChange={(event) => onChange({ ...part, on: event.target.checked })} /> {label}</label>
      <div className="im-wrow">
        <input inputMode="numeric" disabled={!part.on} value={part.value} placeholder="e.g. 1" onChange={(event) => onChange({ ...part, value: event.target.value.replace(/[^0-9]/g, '').slice(0, 4) })} aria-label={`${label} value`} />
        <select disabled={!part.on} value={part.unit} onChange={(event) => onChange({ ...part, unit: event.target.value })} aria-label={`${label} type`}>
          {PERIOD_UNITS.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
        </select>
      </div>
    </div>
  );
}

// Serialised items: default warranty (repair) and guarantee (replacement) given on every unit sold.
function WarrantyFields({ value, onChange }) {
  const w = value || blankWarranty();
  const today = new Date();
  const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const show = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
  const wEnd = addPeriod(day, w.warranty); const gEnd = addPeriod(day, w.guarantee);
  const problem = warrantyProblem(cleanWarranty(w));
  return (
    <div className="im-expiry">
      <Toggle on={w.enabled} label="Enable default Warranty & Guarantee support?" hint="Turn on to give every unit of this item a warranty (free repair) and/or guarantee (replacement) from the day it is sold. The dates are saved against each serial number / IMEI." onChange={(on) => onChange({ enabled: on })} />
      {w.enabled ? (
        <div className="im-expiry-body im-warranty-body">
          <div className="im-wgrid">
            <PeriodInput label="Warranty (repair)" part={w.warranty} onChange={(part) => onChange({ warranty: part })} />
            <PeriodInput label="Guarantee (replacement)" part={w.guarantee} onChange={(part) => onChange({ guarantee: part })} />
          </div>
          <div className="im-grid">
            <Field label="Cover starts from"><select value={w.startFrom} onChange={(event) => onChange({ startFrom: event.target.value })}>{WARRANTY_START.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
            <Field label="Warranty given by"><select value={w.provider} onChange={(event) => onChange({ provider: event.target.value })}>{WARRANTY_PROVIDERS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
            <Field label="Authorised service centre"><input value={w.serviceCentre} maxLength={160} placeholder="Name / address" onChange={(event) => onChange({ serviceCentre: event.target.value })} /></Field>
            <Field label="Service centre phone / toll-free"><input value={w.contact} maxLength={80} onChange={(event) => onChange({ contact: event.target.value })} /></Field>
          </div>
          <Field label="Warranty terms (printed on the bill)"><textarea rows={2} value={w.terms} maxLength={600} placeholder="e.g. Physical / liquid damage and burnt parts are not covered." onChange={(event) => onChange({ terms: event.target.value })} /></Field>
          <p className={problem ? 'im-expiry-note im-warn' : 'im-expiry-note im-wnote'}>
            {problem || <>{warrantySummary(cleanWarranty(w))}. Sold today → {wEnd ? <>warranty till <b>{show(wEnd)}</b></> : 'no warranty'}{gEnd ? <>, replacement till <b>{show(gEnd)}</b></> : ''}.</>}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ExpiryFields({ expiry, onChange }) {
  const sample = new Date();
  const mfg = `${sample.getFullYear()}-${String(sample.getMonth() + 1).padStart(2, '0')}-${String(sample.getDate()).padStart(2, '0')}`;
  const example = calcExpiry(mfg, expiry);
  return (
    <div className="im-expiry">
      <Toggle on={expiry.enabled} label="Enable Expiry Date" hint="Off by default. Turn on for items that expire (food, medicine, cosmetics, batteries…). Stock coming in then asks for batch no., mfg. date and expiry date." onChange={(value) => onChange({ enabled: value })} />
      {expiry.enabled ? (
        <div className="im-expiry-body">
          <div className="im-grid">
            <Field label="Expiry Date Format">
              <select value={expiry.format} onChange={(event) => onChange({ format: event.target.value })}>
                {EXPIRY_FORMATS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
              </select>
            </Field>
            <Field label="Expiry Alert Before">
              <div className="im-suffix"><input inputMode="numeric" value={expiry.alertDays} onChange={(event) => onChange({ alertDays: event.target.value.replace(/[^0-9]/g, '') })} /><span>days</span></div>
            </Field>
          </div>
          <Toggle on={expiry.autoCalc} label="Calculate expiry automatically from shelf life" hint="Expiry date = manufacturing date + shelf life (you can still change it on a batch)." onChange={(value) => onChange({ autoCalc: value })} />
          {expiry.autoCalc ? (
            <div className="im-grid">
              <Field label="Shelf Life Type">
                <select value={expiry.shelfLifeType} onChange={(event) => onChange({ shelfLifeType: event.target.value })}>
                  {SHELF_LIFE_TYPES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                </select>
              </Field>
              {expiry.shelfLifeType === 'date' ? (
                <Field label="Fixed Expiry Date"><input type="date" value={expiry.fixedDate} onChange={(event) => onChange({ fixedDate: event.target.value })} /></Field>
              ) : (
                <Field label={`Shelf Life Value (${SHELF_LIFE_TYPES.find(([key]) => key === expiry.shelfLifeType)?.[1] || ''})`}>
                  <input inputMode="numeric" value={expiry.shelfLifeValue} placeholder="e.g. 6" onChange={(event) => onChange({ shelfLifeValue: event.target.value.replace(/[^0-9]/g, '') })} />
                </Field>
              )}
            </div>
          ) : null}
          <div className="im-expiry-toggles">
            <Toggle on={expiry.fefo} label="FEFO (First Expiry First Out)" hint="Sales take stock from the batch that expires first." onChange={(value) => onChange({ fefo: value })} />
            <Toggle on={expiry.batchMandatory} label="Batch No. mandatory" hint="Ask for a batch number on every receipt." onChange={(value) => onChange({ batchMandatory: value })} />
          </div>
          <p className="im-expiry-note">{shelfLifeText(expiry)}{example ? ` · e.g. made today → expires ${formatExpiry(example, expiry.format)}` : ''}</p>
        </div>
      ) : null}
    </div>
  );
}

function ConfigBody({ draft, set, side, setExpiry, stockless = false, stocklessNote = '' }) {
  if (side === 'price') {
    return (
      <div className="im-config">
        <Field label="Price Type">
          <select value={draft.priceType} onChange={(event) => set({ priceType: event.target.value })}>
            {PRICE_TYPES.map((item) => <option key={item}>{item}</option>)}
          </select>
        </Field>
        <Field label="Price Margin">
          <div className="im-suffix"><input inputMode="decimal" value={draft.priceMargin} onChange={(event) => set({ priceMargin: event.target.value })} /><span>%</span></div>
        </Field>
        <Toggle on={draft.autoPrice} label="Auto Price Update" hint="Update price from purchase automatically." onChange={(value) => set({ autoPrice: value })} />
      </div>
    );
  }
  if (side === 'stock') {
    if (stockless) return <div className="im-config"><p className="im-note">{stocklessNote}, so batches and expiry do not apply.</p></div>;
    return (
      <div className="im-config">
        <BatchRuleFields value={draft.batch} onChange={(patch) => set({ batch: { ...draft.batch, ...patch } })} />
        <h4>Expiry date</h4>
        {draft.kind === 'grocery' ? <ExpiryFields expiry={draft.expiry} onChange={setExpiry} /> : <p className="im-note">Expiry dates are available for Standard-type items (not matrix or serialised).</p>}
      </div>
    );
  }
  if (side === 'sales') {
    return (
      <div className="im-config">
        <h4>Serialisation (for Electronics)</h4>
        <Toggle on={draft.trackSerial} label="Track Serial Number / IMEI" onChange={(value) => set({ trackSerial: value, mandatorySerial: value, kind: value ? 'electronics' : draft.kind })} />
        <Toggle on={draft.mandatorySerial} label="Mandatory Serial Entry" onChange={(value) => set({ mandatorySerial: value })} />
      </div>
    );
  }
  return (
    <div className="im-config">
      <Toggle on={draft.allowEditPrice} label="Allow Edit Price" hint="Enable to allow price modification at the time of billing." onChange={(value) => set({ allowEditPrice: value })} />
      <Toggle on={draft.allowBelowCost} label="Allow Selling Below Cost" hint="Allow sale even if selling price is lower than cost price." onChange={(value) => set({ allowBelowCost: value })} />
      <Toggle on={draft.enableDiscount} label="Enable Discount" hint="Allow discount on this item." onChange={(value) => set({ enableDiscount: value })} />
      <Field label="Max Discount %">
        <div className="im-suffix"><input inputMode="decimal" value={draft.maxDiscount} onChange={(event) => set({ maxDiscount: event.target.value })} /><span>%</span></div>
      </Field>
    </div>
  );
}

// New items start with the Piece unit (PCS / Piece / Nos), else the first unit.
function defaultUnit(units) {
  const list = units || [];
  return (list.find((u) => /^(pcs|pc|piece|pieces)$/i.test(String(u.code || '')) || /^piece/i.test(String(u.name || ''))) || list.find((u) => /^nos$/i.test(String(u.code || ''))) || list[0])?.id || '';
}

// Item Description from what is filled on the form (Generate / Refresh buttons; needs the item name).
function describeItem(d, { categories = [], units = [], labels = {}, visible = {} }) {
  const name = String(d.name || '').trim();
  if (!name) return d.notes || '';
  const fmt = (v) => new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(v) || 0);
  const namesOf = (level) => {
    const raw = d.slots?.[level];
    const ids = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return ids.map((id) => categories.find((c) => c.id === id)?.name || (String(id).startsWith('new:') ? String(id).slice(4) : '')).filter(Boolean);
  };
  const levels = CATEGORY_LEVELS.filter((level) => level === '1' || visible[level]);
  const cats = levels.map((level) => ({ label: level === '1' ? 'Item Type' : labels[level] || `Category ${level}`, names: namesOf(level) })).filter((c) => c.names.length);
  const unit = units.find((u) => u.id === d.unitId);
  const type = typeOf(d.ptype);
  const parts = [];
  parts.push(`${name}${d.brandName ? ` by ${d.brandName}` : ''}${cats[0] ? ` — ${cats[0].names.join(', ')}` : ''}.`);
  const more = cats.slice(1).map((c) => `${c.label}: ${c.names.join(', ')}`);
  if (more.length) parts.push(`${more.join('; ')}.`);
  if (d.ptype && d.ptype !== 'standard') parts.push(`${type.label}.`);
  if (d.kind === 'matrix' && (d.matrix || []).length) parts.push(`Available in ${d.matrix.length} variant${d.matrix.length === 1 ? '' : 's'}.`);
  if (unit) parts.push(`Sold per ${unit.name.toLowerCase()}.`);
  const price = [Number(d.mrp) > 0 ? `MRP ₹${fmt(d.mrp)}` : '', Number(d.salePrice) > 0 ? `selling price ₹${fmt(d.salePrice)}` : ''].filter(Boolean);
  if (price.length) parts.push(`${price.join(', ')}.`.replace(/^./, (c) => c.toUpperCase()));
  const tax = [d.hsnSac ? `HSN ${d.hsnSac}` : '', d.gstRate !== '' && d.gstRate != null ? `GST ${d.gstRate}%` : ''].filter(Boolean);
  if (tax.length) parts.push(`${tax.join(', ')}.`);
  if (d.expiry?.enabled) parts.push(`${shelfLifeText(d.expiry)}.`);
  if (d.warranty?.enabled && d.warranty.warranty?.on && d.warranty.warranty.value) parts.push(`${d.warranty.warranty.value} ${d.warranty.warranty.unit || 'months'} warranty.`);
  if (d.trackSerial || d.kind === 'electronics') parts.push('Each unit has its own serial number.');
  if (d.carton?.allow && String(d.carton.sizes || '').trim()) parts.push(`Packed in cartons (${String(d.carton.sizes).trim()}).`);
  if (d.upc) parts.push(`UPC/EAN ${d.upc}.`);
  return parts.join(' ').replace(/\s+/g, ' ').slice(0, 500);
}

function categoryOptions(categories, level) {
  return categories.filter((item) => String(item.level || '1') === level).map((item) => ({ id: item.id, label: item.name }));
}

function CategorySlot({ label, required, value, options, multi, autoCreate, onCreate, onChange, fetched }) {
  return (
    <label className={fetched ? 'im-field im-fetched' : 'im-field'}>
      <span className="im-label-row">
        <span>{label}</span>
        {required ? <em>*</em> : null}
        {fetched ? <i className="im-auto">auto</i> : null}
      </span>
      {multi ? (
        <ChipSelect required={required} values={Array.isArray(value) ? value : (value ? [value] : [])} placeholder={`Select ${label}`} options={options} allowCreate={autoCreate} onCreate={onCreate} onChange={onChange} />
      ) : (
        <SearchSelect required={required} value={Array.isArray(value) ? (value[0] || '') : (value || '')} placeholder={`Search ${label}`} options={options} allowCreate={autoCreate} onCreate={onCreate} onChange={onChange} />
      )}
    </label>
  );
}

function KindIcon({ id }) {
  if (id === 'matrix') {
    return <span className="im-kind-icon violet"><svg viewBox="0 0 24 24"><path d="M8 7a4 4 0 1 1 8 0 4 4 0 0 1-8 0zM6 20c1-3 3.2-4.5 6-4.5S17 17 18 20" /></svg></span>;
  }
  if (id === 'electronics') {
    return <span className="im-kind-icon sky"><svg viewBox="0 0 24 24"><path d="M8 4h8v14H8zM10 18h4M9 7h6" /></svg></span>;
  }
  return <span className="im-kind-icon green"><svg viewBox="0 0 24 24"><path d="M6 8h12l-1 11H7L6 8zM9 8V6a3 3 0 0 1 6 0v2" /></svg></span>;
}
