// Configurations → Data Migration: one place to bring masters and transactions in (and out)
// with Excel / CSV templates. Shared by the screen (templates, file reading, grouping) and
// the server (checks and import).

const c = (key, label, opts = {}) => ({ key, label, ...opts });
const YES = ['y', 'yes', 'true', '1'];
export const asBool = (value) => YES.includes(String(value ?? '').trim().toLowerCase());

const ITEM = c('itemCode', 'Item Code', { req: true, hint: 'Item code (SKU) or barcode from Item Master' });
const LOC = c('location', 'Location', { req: true, hint: 'Location name exactly as in Branch & Locations' });
const BATCH = [c('batchNo', 'Batch No', { hint: 'Only for expiry / batch items' }), c('mfgDate', 'Mfg Date', { type: 'date' }), c('expiryDate', 'Expiry Date', { type: 'date' })];
const SERIAL = c('serialNo', 'Serial No', { hint: 'Serialised items: one serial number per row (qty 1)' });

const PURCHASE_COLS = [
  c('docNo', 'Doc No', { req: true, hint: 'Your old document number — all rows with the same Doc No become one document' }),
  c('date', 'Date', { req: true, type: 'date' }), LOC,
  c('supplier', 'Supplier', { req: true, hint: 'Supplier code, GSTIN or name from Suppliers' }),
  c('refNo', 'Supplier Ref No'), c('dueDate', 'Due Date', { type: 'date' }),
  ITEM, c('qty', 'Qty', { req: true, type: 'num' }), c('rate', 'Rate', { req: true, type: 'num', hint: 'Purchase rate per unit' }),
  c('discPct', 'Disc %', { type: 'num' }), c('mrp', 'MRP', { type: 'num' }), c('salePrice', 'Sale Price', { type: 'num' }),
  ...BATCH, SERIAL, c('inclusive', 'Rate Includes GST', { type: 'bool', hint: 'Y / N (default N)' }), c('note', 'Note'),
];
const SALES_COLS = (bill) => [
  c('docNo', 'Doc No', { req: true, hint: 'Your old document number — all rows with the same Doc No become one document' }),
  c('date', 'Date', { req: true, type: 'date' }), LOC,
  c('customer', 'Customer', { hint: 'Customer code, mobile or name — blank for a walk-in customer' }), c('customerName', 'Walk-in Name', { hint: 'Name shown when no customer is matched' }),
  c('refNo', 'Customer Ref No'), c('dueDate', 'Due Date', { type: 'date' }),
  ITEM, c('qty', 'Qty', { req: true, type: 'num' }), c('rate', 'Rate', { req: true, type: 'num', hint: 'Selling rate per unit' }), c('discPct', 'Disc %', { type: 'num' }),
  SERIAL, c('inclusive', 'Rate Includes GST', { type: 'bool', hint: 'Y / N (default Y for sales)' }), c('note', 'Note'),
  ...(bill ? [c('tender', 'Paid By', { hint: 'Tender name, e.g. Cash, UPI, Card (default Cash)' })] : []),
];

export const ENTITIES = [
  // ---------------- masters ----------------
  {
    id: 'locations', group: 'master', label: 'Branch & Locations', order: 1, sheet: 'Locations',
    desc: 'Stores and warehouses. Existing names are skipped.',
    columns: [c('name', 'Location Name', { req: true }), c('kind', 'Type', { type: 'enum', options: ['store', 'warehouse'], hint: 'store or warehouse' })],
    samples: [{ name: 'Pune Showroom', kind: 'store' }, { name: 'Pune Godown', kind: 'warehouse' }],
  },
  {
    id: 'units', group: 'master', label: 'Units', order: 2, sheet: 'Units',
    desc: 'Units of measure (PCS, KG, BOX…). Existing codes are skipped.',
    columns: [c('code', 'Unit Code', { req: true }), c('name', 'Unit Name', { req: true })],
    samples: [{ code: 'BOX', name: 'Box' }, { code: 'MTR', name: 'Metre' }],
  },
  {
    id: 'categories', group: 'master', label: 'Categories', order: 3, sheet: 'Categories',
    desc: 'Category names per level (Level 1 = main category). Existing names are skipped.',
    columns: [c('name', 'Category Name', { req: true }), c('level', 'Level', { type: 'num', hint: '1 to 15 (default 1)' })],
    samples: [{ name: 'Accessories', level: '1' }, { name: 'Keyboards', level: '2' }],
  },
  {
    id: 'brands', group: 'master', label: 'Brands', order: 4, sheet: 'Brands',
    desc: 'Brand names. Existing names are skipped.',
    columns: [c('name', 'Brand Name', { req: true })],
    samples: [{ name: 'Dell' }, { name: 'HP' }],
  },
  {
    id: 'items', group: 'master', label: 'Items (Item Master)', order: 5, sheet: 'Items', upsert: true,
    desc: 'Products with code, prices, GST, unit, categories and brand. Rows with the same Matrix Parent become one matrix item with variants.',
    columns: [
      c('code', 'Item Code', { hint: 'SKU — leave blank to auto-number' }), c('name', 'Item Name', { req: true }),
      c('unit', 'Unit', { req: true, hint: 'Unit code or name, e.g. PCS' }),
      c('category1', 'Item Type', { req: true, aliases: ['Category L1', 'Category 1'], hint: 'Category 1 — compulsory (e.g. Laptops, Accessories)' }), c('category2', 'Category L2'), c('category3', 'Category L3'), c('brand', 'Brand'),
      c('hsn', 'HSN/SAC'), c('gst', 'GST %', { type: 'num', hint: '0, 5, 12, 18 or 28 (default 18)' }),
      c('tracking', 'Tracking', { type: 'enum', options: ['none', 'batch', 'serial'], hint: 'none, batch (expiry) or serial' }),
      c('mrp', 'MRP', { type: 'num' }), c('salePrice', 'Sale Price', { type: 'num' }), c('costPrice', 'Cost Price', { type: 'num' }),
      c('minStock', 'Reorder Level', { type: 'num' }), c('barcode', 'Barcode'), c('upc', 'UPC / EAN'),
      c('matrixParent', 'Matrix Parent', { hint: 'Same parent name on several rows = one item with variants (L2–L3 = variant attributes, e.g. colour / size)' }), c('notes', 'Notes'),
    ],
    samples: [
      { code: 'KB-USB-101', name: 'USB Keyboard K101', unit: 'PCS', category1: 'Accessories', category2: 'Keyboards', brand: 'Dell', hsn: '84716060', gst: '18', tracking: 'none', mrp: '899', salePrice: '799', costPrice: '560', minStock: '5', barcode: '8901234567011' },
      { code: 'LAP-I5-15', name: 'Laptop Core i5 15"', unit: 'PCS', category1: 'Laptops', brand: 'HP', hsn: '84713010', gst: '18', tracking: 'serial', mrp: '65000', salePrice: '58990', costPrice: '52000', minStock: '1' },
      { code: 'TSH-BLU-M', name: 'Polo T-shirt Blue M', unit: 'PCS', category1: 'Apparel', category2: 'Blue', category3: 'M', brand: '', gst: '5', mrp: '799', salePrice: '699', costPrice: '380', matrixParent: 'Polo T-shirt' },
      { code: 'TSH-BLU-L', name: 'Polo T-shirt Blue L', unit: 'PCS', category1: 'Apparel', category2: 'Blue', category3: 'L', brand: '', gst: '5', mrp: '799', salePrice: '699', costPrice: '380', matrixParent: 'Polo T-shirt' },
    ],
  },
  {
    id: 'customers', group: 'master', label: 'Customers', order: 6, sheet: 'Customers', upsert: true, party: 'customer',
    desc: 'Customer master with GST, address, credit terms and opening balance. Matched by Code, then GSTIN, then mobile.',
    columns: [
      c('code', 'Code', { hint: 'Leave blank to auto-number (CUST-0001…)' }), c('name', 'Name', { req: true }),
      c('type', 'GST Type', { type: 'enum', options: ['registered', 'unregistered', 'composition'] }), c('gstin', 'GSTIN'), c('pan', 'PAN'),
      c('mobile', 'Mobile', { req: true }), c('altMobile', 'Alt Mobile'), c('email', 'Email'), c('contactPerson', 'Contact Person'),
      c('address1', 'Address 1'), c('address2', 'Address 2'), c('pincode', 'Pincode'), c('area', 'Area'), c('city', 'City'), c('district', 'District'),
      c('state', 'State', { hint: 'State name or 2-digit GST state code' }),
      c('creditDays', 'Credit Days', { type: 'num' }), c('creditLimit', 'Credit Limit', { type: 'num' }),
      c('openingBalance', 'Opening Balance', { type: 'num' }), c('balanceType', 'Dr/Cr', { type: 'enum', options: ['dr', 'cr'] }), c('notes', 'Notes'),
    ],
    samples: [
      { code: '', name: 'Ramesh Patil', type: 'unregistered', mobile: '9822012345', email: 'ramesh@example.com', address1: 'Shop 4, Main Road', pincode: '413704', city: 'Rahuri', district: 'Ahmednagar', state: 'Maharashtra', creditDays: '0', openingBalance: '0', balanceType: 'dr' },
      { code: '', name: 'Sai Computers', type: 'registered', gstin: '27AAPFU0939F1ZV', mobile: '9890011122', contactPerson: 'Sagar', address1: 'MG Road', city: 'Pune', state: '27', creditDays: '30', creditLimit: '200000', openingBalance: '15000', balanceType: 'dr' },
    ],
  },
  {
    id: 'suppliers', group: 'master', label: 'Suppliers', order: 7, sheet: 'Suppliers', upsert: true, party: 'supplier',
    desc: 'Supplier master with GST, address, bank-free basics, credit terms and opening balance. Matched by Code, then GSTIN, then mobile.',
    columns: [
      c('code', 'Code', { hint: 'Leave blank to auto-number (SUPP-0001…)' }), c('name', 'Name', { req: true }),
      c('type', 'GST Type', { type: 'enum', options: ['registered', 'unregistered', 'composition'] }), c('gstin', 'GSTIN'), c('pan', 'PAN'),
      c('mobile', 'Mobile'), c('altMobile', 'Alt Mobile'), c('email', 'Email'), c('contactPerson', 'Contact Person'),
      c('address1', 'Address 1'), c('address2', 'Address 2'), c('pincode', 'Pincode'), c('area', 'Area'), c('city', 'City'), c('district', 'District'),
      c('state', 'State', { hint: 'State name or 2-digit GST state code' }),
      c('creditDays', 'Credit Days', { type: 'num' }), c('creditLimit', 'Credit Limit', { type: 'num' }),
      c('openingBalance', 'Opening Balance', { type: 'num' }), c('balanceType', 'Dr/Cr', { type: 'enum', options: ['dr', 'cr'] }), c('notes', 'Notes'),
    ],
    samples: [
      { code: '', name: 'Supertech Distributors', type: 'registered', gstin: '27AABCS1429B1ZU', mobile: '9811122233', contactPerson: 'Amit', address1: 'Budhwar Peth', city: 'Pune', state: 'Maharashtra', creditDays: '45', openingBalance: '25000', balanceType: 'cr' },
    ],
  },
  {
    id: 'price-lists', group: 'master', label: 'Price Lists', order: 8, sheet: 'Price Lists', upsert: true,
    desc: 'Fixed-price customer price lists. Rows with the same list name become one list; existing lists get the prices merged in.',
    columns: [
      c('listName', 'Price List Name', { req: true }), ITEM, c('price', 'Price', { req: true, type: 'num' }),
      c('validFrom', 'Valid From', { type: 'date' }), c('validTo', 'Valid To', { type: 'date' }), c('priority', 'Priority', { type: 'num', hint: '1 = highest (default 10)' }),
    ],
    samples: [{ listName: 'Dealer Price', itemCode: 'KB-USB-101', price: '720', validFrom: '2026-04-01', validTo: '', priority: '5' }],
  },
  // ---------------- transactions ----------------
  {
    id: 'opening-stock', group: 'transaction', label: 'Opening Stock', order: 11, sheet: 'Opening Stock', groupBy: ['location', 'refNo'], stock: 'in',
    desc: 'Stock in hand on the go-live date, per location — with batch / expiry and serial numbers. Rows with the same Location and Ref No become one entry.',
    columns: [LOC, c('refNo', 'Ref No', { hint: 'Optional — groups rows into one entry' }), ITEM, c('qty', 'Qty', { req: true, type: 'num' }),
      c('costPrice', 'Cost Price', { type: 'num' }), c('mrp', 'MRP', { type: 'num' }), c('salePrice', 'Sale Price', { type: 'num' }), ...BATCH, SERIAL, c('serialNo2', 'Serial No 2 / IMEI 2')],
    samples: [
      { location: 'Pune Showroom', refNo: 'OB-2026', itemCode: 'KB-USB-101', qty: '25', costPrice: '560', mrp: '899', salePrice: '799' },
      { location: 'Pune Showroom', refNo: 'OB-2026', itemCode: 'LAP-I5-15', qty: '1', costPrice: '52000', serialNo: '5CD1234ABC' },
      { location: 'Pune Showroom', refNo: 'OB-2026', itemCode: 'LAP-I5-15', qty: '1', costPrice: '52000', serialNo: '5CD1234ABD' },
    ],
  },
  {
    id: 'stock-update', group: 'transaction', label: 'Stock Update (Adjustment)', order: 12, sheet: 'Stock Update', stock: 'both',
    desc: 'Increase (+) or decrease (−) stock with a reason. One row = one adjustment. Serialised items are not supported here.',
    columns: [LOC, ITEM, c('qtyChange', 'Qty Change', { req: true, type: 'num', hint: '+10 adds, -3 removes' }),
      c('reason', 'Reason', { type: 'enum', options: ['correction', 'damage', 'loss', 'found', 'internal_use'], hint: 'correction (default), damage, loss, found, internal_use' }), c('note', 'Note'), ...BATCH],
    samples: [{ location: 'Pune Showroom', itemCode: 'KB-USB-101', qtyChange: '-2', reason: 'damage', note: 'Physical count' }],
  },
  { id: 'purchase-order', group: 'transaction', label: 'Purchase Order', order: 13, sheet: 'Purchase Order', doc: ['purchase', 'order'], groupBy: ['docNo'], columns: PURCHASE_COLS, desc: 'Open purchase orders. No stock movement.', samples: [{ docNo: 'PO/25-26/101', date: '2026-03-20', location: 'Pune Showroom', supplier: 'Supertech Distributors', itemCode: 'KB-USB-101', qty: '50', rate: '540', discPct: '2' }] },
  { id: 'purchase-receipt', group: 'transaction', label: 'Receipt Note (GRN)', order: 14, sheet: 'Receipt Note', doc: ['purchase', 'receipt'], groupBy: ['docNo'], columns: PURCHASE_COLS, stock: 'in', desc: 'Goods received. Adds stock (or record only, for old history).', samples: [{ docNo: 'GRN-552', date: '2026-03-25', location: 'Pune Showroom', supplier: 'Supertech Distributors', refNo: 'INV-8891', itemCode: 'KB-USB-101', qty: '50', rate: '540', mrp: '899', salePrice: '799' }] },
  { id: 'purchase-invoice', group: 'transaction', label: 'Purchase Invoice', order: 15, sheet: 'Purchase Invoice', doc: ['purchase', 'invoice'], groupBy: ['docNo'], columns: PURCHASE_COLS, stock: 'in', desc: 'Supplier bills. Adds stock (or record only, for old history).', samples: [{ docNo: 'PI-1001', date: '2026-03-31', location: 'Pune Showroom', supplier: 'Supertech Distributors', refNo: 'ST/889', dueDate: '2026-05-15', itemCode: 'LAP-I5-15', qty: '1', rate: '52000', serialNo: '5CD9999XYZ' }] },
  { id: 'sales-quotation', group: 'transaction', label: 'Sales Quotation', order: 16, sheet: 'Sales Quotation', doc: ['sales', 'quotation'], groupBy: ['docNo'], columns: SALES_COLS(false), desc: 'Open quotations. No stock movement.', samples: [{ docNo: 'Q-77', date: '2026-04-02', location: 'Pune Showroom', customer: 'Sai Computers', itemCode: 'KB-USB-101', qty: '10', rate: '760', inclusive: 'Y' }] },
  { id: 'sales-order', group: 'transaction', label: 'Sales Order', order: 17, sheet: 'Sales Order', doc: ['sales', 'order'], groupBy: ['docNo'], columns: SALES_COLS(false), desc: 'Open sales orders. No stock movement.', samples: [{ docNo: 'SO-45', date: '2026-04-03', location: 'Pune Showroom', customer: '9890011122', itemCode: 'KB-USB-101', qty: '5', rate: '760', inclusive: 'Y' }] },
  { id: 'sales-bill', group: 'transaction', label: 'Sales Bill', order: 18, sheet: 'Sales Bill', doc: ['sales', 'bill'], groupBy: ['docNo'], columns: SALES_COLS(true), stock: 'out', desc: 'Sales invoices. Reduces stock (or record only, for old history).', samples: [{ docNo: 'B-9001', date: '2026-04-05', location: 'Pune Showroom', customer: '', customerName: 'Cash Customer', itemCode: 'KB-USB-101', qty: '1', rate: '799', inclusive: 'Y', tender: 'Cash' }] },
  {
    id: 'wastage', group: 'transaction', label: 'Wastage Entry', order: 19, sheet: 'Wastage', groupBy: ['entryNo'], stock: 'out',
    desc: 'Damaged / expired / lost stock written off. Rows with the same Entry No become one entry. Type, reason and disposal must exist in Wastage → Types & Reasons.',
    columns: [c('entryNo', 'Entry No', { req: true, hint: 'Groups rows into one entry' }), c('date', 'Date', { type: 'date' }), LOC,
      c('type', 'Wastage Type', { req: true, hint: 'e.g. Damage / Breakage' }), c('disposal', 'Disposal', { req: true, hint: 'e.g. Destroyed / discarded' }),
      ITEM, c('qty', 'Qty', { req: true, type: 'num' }), c('reason', 'Reason', { req: true, hint: 'A reason of that wastage type' }), c('remark', 'Remark'),
      c('batchNo', 'Batch No'), SERIAL, c('refNo', 'Ref / Claim No'), c('recovery', 'Recovery ₹', { type: 'num' }), c('note', 'Note')],
    samples: [{ entryNo: 'W-1', date: '2026-04-06', location: 'Pune Showroom', type: 'Damage / Breakage', disposal: 'Destroyed / discarded', itemCode: 'KB-USB-101', qty: '1', reason: 'Damaged while handling', remark: 'Dropped', note: 'Fell from rack' }],
  },
  {
    id: 'transfer-request', group: 'transaction', label: 'Transfer Request', order: 20, sheet: 'Transfer Request', groupBy: ['docNo'],
    desc: 'Open stock requests between locations. They follow the Transfer Request approval flow.',
    columns: [c('docNo', 'Doc No', { req: true }), c('date', 'Date', { type: 'date' }), c('fromLocation', 'Request From (Supplying)', { req: true }), c('toLocation', 'For Location (Requesting)', { req: true }),
      c('neededBy', 'Needed By', { type: 'date' }), ITEM, c('qty', 'Qty', { req: true, type: 'num' }), c('note', 'Note')],
    samples: [{ docNo: 'TR-1', date: '2026-04-07', fromLocation: 'Pune Godown', toLocation: 'Pune Showroom', neededBy: '2026-04-09', itemCode: 'KB-USB-101', qty: '20' }],
  },
  {
    id: 'transfer-out', group: 'transaction', label: 'Transfer Out', order: 21, sheet: 'Transfer Out', groupBy: ['docNo'], stock: 'out',
    desc: 'Stock dispatched to another location (direct transfer). Leaves the source; received with Transfer In.',
    columns: [c('docNo', 'Doc No', { req: true }), c('date', 'Date', { type: 'date' }), c('fromLocation', 'From Location', { req: true }), c('toLocation', 'To Location', { req: true }),
      ITEM, c('qty', 'Qty', { req: true, type: 'num' }), SERIAL, c('vehicle', 'Vehicle No'), c('transporter', 'Transporter'), c('lrNo', 'LR No'), c('ewayBill', 'E-way Bill'), c('note', 'Note')],
    samples: [{ docNo: 'TO-1', date: '2026-04-08', fromLocation: 'Pune Godown', toLocation: 'Pune Showroom', itemCode: 'KB-USB-101', qty: '10', vehicle: 'MH12AB1234' }],
  },
].sort((a, b) => a.order - b.order);

export const entityOf = (id) => ENTITIES.find((row) => row.id === id) || null;

// ---------- header matching ----------
const norm = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function mapHeaders(entity, headers) {
  const map = {}; const unknown = [];
  headers.forEach((header, index) => {
    const h = norm(header);
    if (!h) return;
    const col = entity.columns.find((col) => norm(col.label) === h || norm(col.key) === h || norm(col.label.replace(/\(.*\)/, '')) === h || (col.aliases || []).some((a) => norm(a) === h));
    if (col && map[col.key] == null) map[col.key] = index; else if (!col) unknown.push(String(header));
  });
  const missing = entity.columns.filter((col) => col.req && map[col.key] == null).map((col) => col.label);
  return { map, unknown, missing };
}

// Excel serial date / dd-mm-yyyy / dd/mm/yyyy / yyyy-mm-dd → yyyy-mm-dd ('' when not a date).
export function toDay(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  if (/^\d{5}(\.\d+)?$/.test(text)) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86400000); return d.toISOString().slice(0, 10); }
  const m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? `20${m[3]}` : m[3]; return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`; }
  const months = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const w = text.match(/^(\d{1,2})[-\s]([a-z]{3})[a-z]*[-\s,]*(\d{4})$/i);
  if (w && months[w[2].toLowerCase()]) return `${w[3]}-${String(months[w[2].toLowerCase()]).padStart(2, '0')}-${w[1].padStart(2, '0')}`;
  return '';
}

// Turn sheet rows (arrays) into objects keyed by column key, with the sheet row number.
export function rowsToRecords(entity, rows, map, firstRow = 2) {
  const out = [];
  rows.forEach((cells, index) => {
    const rec = { _row: firstRow + index };
    let any = false;
    for (const col of entity.columns) {
      const i = map[col.key];
      let value = i == null ? '' : cells[i];
      value = value == null ? '' : String(value).trim();
      if (col.type === 'date' && value) value = toDay(value) || value;
      if (col.type === 'num' && value) value = value.replace(/,/g, '').replace(/^₹\s*/, '');
      if (value !== '') any = true;
      rec[col.key] = value;
    }
    if (any) out.push(rec);
  });
  return out;
}

// Rows that must travel together (one document).
export function groupKey(entity, rec) {
  if (entity.id === 'items') return rec.matrixParent ? `mx:${rec.matrixParent.toLowerCase()}` : `r${rec._row}`;
  if (entity.id === 'price-lists') return `pl:${String(rec.listName).toLowerCase()}`;
  if (!entity.groupBy) return `r${rec._row}`;
  return entity.groupBy.map((key) => String(rec[key] ?? '').trim().toLowerCase()).join('|');
}
export function chunkGroups(entity, records, size = 60) {
  const groups = new Map();
  for (const rec of records) { const k = groupKey(entity, rec); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(rec); }
  const chunks = []; let cur = []; let count = 0;
  for (const rows of groups.values()) {
    cur.push(...rows); count += 1;
    if (count >= size || cur.length >= 400) { chunks.push(cur); cur = []; count = 0; }
  }
  if (cur.length) chunks.push(cur);
  return { chunks, groups: groups.size };
}
