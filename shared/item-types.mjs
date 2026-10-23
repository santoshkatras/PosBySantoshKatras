// Item (product) types shown in the Item Master “Product Type” list, plus helpers for
// location-wise reorder levels and automatic batch numbers. Shared by server and client.

export const ITEM_TYPES = [
  { id: 'standard', label: 'Standard Product', hint: 'Single item · one price and one stock count', kind: 'grocery' },
  { id: 'matrix', label: 'Matrix Item', hint: 'Variants · one stock line per size / colour', kind: 'matrix' },
  { id: 'serial', label: 'Serialised Item', hint: 'Serial / IMEI · each unit kept separately', kind: 'electronics' },
  { id: 'parent', label: 'Parent Item', hint: 'Main item that groups its child items (models, packs)', kind: 'grocery' },
  { id: 'child', label: 'Child Item', hint: 'Belongs to a parent item', kind: 'grocery', needs: 'parent' },
  { id: 'bulk', label: 'Bulk Item', hint: 'Bought loose / in bulk, repacked for sale', kind: 'grocery' },
  { id: 'repack', label: 'Repackaged Item', hint: 'Packed from a bulk item (e.g. 1 kg pack from a 50 kg bag)', kind: 'grocery', needs: 'bulk' },
  { id: 'service', label: 'Service Item', hint: 'Labour, installation, AMC — no stock is kept', kind: 'grocery', service: true },
  { id: 'nonstock', label: 'Non-stock Item', hint: 'Sold or bought without keeping stock (carry bags, freight)', kind: 'grocery', service: true },
  { id: 'consumable', label: 'Consumable / Raw Material', hint: 'Used up in service or production; stock is kept', kind: 'grocery' },
  { id: 'kit', label: 'KIT/Combo Product', hint: 'Packed from other items — map them in Inventory → KIT/Combo Mapping, pack in KIT/Combo Packing', kind: 'grocery' },
];

// Carton (Item Master → “Allow Cartoon”, when Main Category Setups → “Enable cartoon support” is on).
// sizes: labels such as 5x5x5x5 or 40x30x25 cm — shown in the Carton column; quantity stays separate.
export function cleanCarton(raw) {
  const sizes = (Array.isArray(raw?.sizes) ? raw.sizes : String(raw?.sizes || '').split(/[,\n]/))
    .map((s) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean);
  return { allow: Boolean(raw?.allow), sizes: [...new Set(sizes)].slice(0, 10) };
}

export const typeOf = (id) => ITEM_TYPES.find((t) => t.id === id) || ITEM_TYPES[0];
export const isStockless = (id) => Boolean(typeOf(id).service);

// From an older item (before Product Type existed).
export function typeFromItem({ profile = {}, trackingType = '', isService = false } = {}) {
  if (profile.itemType && ITEM_TYPES.some((t) => t.id === profile.itemType)) return profile.itemType;
  if (isService) return 'service';
  if (trackingType === 'serial') return 'serial';
  if (profile.kind === 'matrix') return 'matrix';
  return 'standard';
}

const num = (v) => (v === '' || v == null ? '' : String(Math.max(Number(v) || 0, 0)));

// { [locationId]: { reorder, min, max, rack, shelf } } — only locations that have something set.
export function cleanStockLevels(raw, locationIds = null) {
  const out = {};
  for (const [id, row] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (locationIds && !locationIds.includes(id)) continue;
    const text = (v) => String(v ?? '').trim().slice(0, 20);
    const r = { reorder: num(row?.reorder), min: num(row?.min), max: num(row?.max), rack: text(row?.rack), shelf: text(row?.shelf) };
    if (typeof row?.alert === 'boolean') r.alert = row.alert; // reorder alert for this location (blank = item default)
    if (r.reorder !== '' || r.min !== '' || r.max !== '' || r.rack || r.shelf || r.alert !== undefined) out[id] = r;
  }
  return out;
}

// "Reorder alert required?" — location's own tick, else the item default (on unless switched off)
export function alertAt(profile, locationId) {
  const own = profile?.stockLevels?.[locationId]?.alert;
  if (typeof own === 'boolean') return own;
  return profile?.reorderAlert !== false;
}
// level that raises a low-stock alert at a location (0 = no alert)
export const alertLevelAt = (profile, variantMin, locationId) => (alertAt(profile, locationId) ? reorderAt(profile, variantMin, locationId) : 0);

// reorder level for one location (location row → item default)
export function reorderAt(profile, variantMin, locationId) {
  const own = profile?.stockLevels?.[locationId];
  if (own && own.reorder !== '' && own.reorder != null) return Number(own.reorder) || 0;
  return Number(variantMin) || 0;
}

// ---------- automatic batch numbers ----------
export const BATCH_PATTERNS = [
  ['date-seq', 'Prefix + date + running no. (B261015-001)'],
  ['seq', 'Prefix + running no. (B000123)'],
  ['month-seq', 'Prefix + year-month + running no. (B2610-0012)'],
];

export function cleanBatchRule(raw = {}) {
  return {
    auto: Boolean(raw?.auto),
    prefix: String(raw?.prefix ?? 'B').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 8),
    pattern: BATCH_PATTERNS.some(([k]) => k === raw?.pattern) ? raw.pattern : 'date-seq',
  };
}

const pad = (v, n) => String(v).padStart(n, '0');
export function batchKey(rule, date = new Date()) {
  const yy = String(date.getFullYear()).slice(2);
  const mm = pad(date.getMonth() + 1, 2);
  const dd = pad(date.getDate(), 2);
  return rule.pattern === 'seq' ? 'all' : rule.pattern === 'month-seq' ? `${yy}${mm}` : `${yy}${mm}${dd}`;
}
export function makeBatchNo(rule, seq, date = new Date()) {
  const key = batchKey(rule, date);
  if (rule.pattern === 'seq') return `${rule.prefix}${pad(seq, 6)}`;
  if (rule.pattern === 'month-seq') return `${rule.prefix}${key}-${pad(seq, 4)}`;
  return `${rule.prefix}${key}-${pad(seq, 3)}`;
}
