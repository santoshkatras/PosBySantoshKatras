// Configurations → Data Cleanup: remove chosen data (transactions, stock, masters, promotions) for this
// company only. Nothing is erased at once — rows are moved out of the company into a cleanup batch,
// a JSON backup file is written, and any batch can be restored from the same screen.
// Users, roles, locations, units, company details and configuration settings are never touched.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPassword } from './auth.mjs';

const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const day = (v) => String(v || '').slice(0, 10);

// t: table, date: column to filter by date, loc: location column(s), where: extra row test,
// settings: setting_key test (rows from the settings table)
export const CLEANUP_CATEGORIES = [
  { id: 'sales', group: 'Transactions', label: 'Sales documents', hint: 'Sales Quotations, Sales Orders, Sales Bills and Sales Returns (with their payments, offers and coupons used on them).', filters: true,
    parts: [{ t: 'documents', where: (r) => r.module === 'sales', date: 'doc_date', loc: ['location_id'] }] },
  { id: 'purchase', group: 'Transactions', label: 'Purchase documents', hint: 'Purchase Orders, Receipt Notes and Purchase Invoices.', filters: true,
    parts: [{ t: 'documents', where: (r) => r.module === 'purchase', date: 'doc_date', loc: ['location_id'] }] },
  { id: 'held', group: 'Transactions', label: 'Held bills', hint: 'Bills put on hold in the Sales Bill window.', filters: true,
    parts: [{ t: 'held_bills', date: 'created_at', loc: ['location_id'] }] },
  { id: 'transfers', group: 'Transactions', label: 'Transfer orders', hint: 'Transfer Requests, Transfer Out and Transfer In, and auto-schedule run history.', filters: true,
    parts: [{ t: 'transfers', date: 'doc_date', loc: ['from_location_id', 'to_location_id'] }, { t: 'transfer_auto_runs', date: 'created_at' }] },
  { id: 'wastage', group: 'Transactions', label: 'Wastage entries', hint: 'Wastage / damage / expiry write-off entries.', filters: true,
    parts: [{ t: 'wastage_entries', date: 'doc_date', loc: ['location_id'] }] },
  { id: 'priceUpdates', group: 'Transactions', label: 'Price update history', hint: 'Price Update documents (the current prices on items stay as they are).', filters: true,
    parts: [{ t: 'price_updates', date: 'created_at' }] },
  { id: 'service', group: 'Transactions', label: 'Service job cards', hint: 'Job cards with their parts, labour, payments and status history.', filters: true,
    parts: [{ t: 'job_cards', date: 'created_at' }, { t: 'job_lines', date: 'created_at' }, { t: 'job_payments', date: 'created_at' }, { t: 'job_events', date: 'created_at' }] },
  { id: 'stock', group: 'Stock', label: 'Stock — reset to zero', hint: 'Every stock movement (opening stock, purchase, sale, transfer, wastage, adjustment), stock quantities, batches, serial numbers and stock barcodes. Stock becomes 0.', filters: 'location',
    parts: [{ t: 'stock_movements', loc: ['location_id'] }, { t: 'stock_levels', loc: ['location_id'] }, { t: 'batches', loc: ['location_id'] }, { t: 'serials', loc: ['location_id'] }, { t: 'stock_lots', loc: ['location_id'] }] },
  { id: 'items', group: 'Masters', label: 'Items (products)', hint: 'All items, variants and item settings. Needs every transaction and the stock cleared too.', needs: ['sales', 'purchase', 'held', 'transfers', 'wastage', 'priceUpdates', 'stock', 'service'],
    parts: [{ t: 'products' }, { t: 'variants' }, { t: 'settings', settings: (k) => k.startsWith('item_profile_') }] },
  { id: 'catalog', group: 'Masters', label: 'Categories & brands', hint: 'Item Type / category levels and brands (category names set in Main Category Setups stay).', needs: ['items'],
    parts: [{ t: 'categories' }, { t: 'brands' }] },
  { id: 'customers', group: 'Masters', label: 'Customers', hint: 'Customer master and their extra details. Old bills keep the customer name printed on them.',
    parts: [{ t: 'customers' }, { t: 'settings', settings: (k) => k.startsWith('party_customer_') }] },
  { id: 'suppliers', group: 'Masters', label: 'Suppliers', hint: 'Supplier master and their extra details.',
    parts: [{ t: 'suppliers' }, { t: 'settings', settings: (k) => k.startsWith('party_supplier_') }] },
  { id: 'vehicles', group: 'Masters', label: 'Vehicles (service)', hint: 'Customer vehicles used in service job cards.', needs: ['service'],
    parts: [{ t: 'vehicles' }] },
  { id: 'priceLists', group: 'Masters', label: 'Price lists', hint: 'Customer price lists with slabs and happy hours.',
    parts: [{ t: 'price_lists' }] },
  { id: 'offers', group: 'Promotions', label: 'Offers & coupons', hint: 'Offer rules and coupon definitions / codes.',
    parts: [{ t: 'settings', settings: (k) => k === 'promo_offers' || k === 'promo_coupons' }] },
  { id: 'vouchers', group: 'Promotions', label: 'Gift vouchers', hint: 'Generated gift vouchers and their balances.',
    parts: [{ t: 'gift_vouchers' }] },
  { id: 'loyalty', group: 'Promotions', label: 'Loyalty members & points', hint: 'Loyalty members, cards and every points entry.',
    parts: [{ t: 'loyalty_members' }, { t: 'loyalty_ledger' }] },
  { id: 'audit', group: 'Logs', label: 'Activity log', hint: 'The audit trail of who did what.', filters: 'date',
    parts: [{ t: 'audit_logs', date: 'created_at' }] },
];
const ALL_TABLES = [...new Set(CLEANUP_CATEGORIES.flatMap((c) => c.parts.map((p) => p.t)))];

export function registerDataCleanup(app, store, { auth, route, fail, writeSetting }) {
  const owner = (req, res, next) => {
    const code = req.session?.user?.role?.code;
    const perms = req.session?.user?.permissions || [];
    if (code === 'owner' || perms.includes('settings.manage')) return next();
    return fail(res, 403, 'PERMISSION_DENIED', 'Only the owner (or a user with Settings manage rights) can clean up data.');
  };

  function rowsFor(all, part, companyId, filters, useFilters) {
    let rows = all.filter((r) => r.company_id === companyId);
    if (part.where) rows = rows.filter(part.where);
    if (part.settings) rows = rows.filter((r) => part.settings(String(r.setting_key || '')));
    if (useFilters && (filters.from || filters.to) && part.date) rows = rows.filter((r) => { const d = day(r[part.date]); return (!filters.from || d >= filters.from) && (!filters.to || d <= filters.to); });
    if (useFilters && filters.locationId && part.loc) rows = rows.filter((r) => part.loc.some((col) => r[col] === filters.locationId));
    return rows;
  }
  async function plan(companyId, ids, filters) {
    const tables = new Map();
    const load = async (t) => { if (!tables.has(t)) tables.set(t, await store.find(t, t === 'settings' ? { company_id: companyId } : { company_id: companyId })); return tables.get(t); };
    const out = [];
    for (const cat of CLEANUP_CATEGORIES.filter((c) => ids.includes(c.id))) {
      const useFilters = Boolean(cat.filters);
      const parts = [];
      for (const part of cat.parts) {
        const rows = rowsFor(await load(part.t), part, companyId, { from: cat.filters === 'location' ? '' : filters.from, to: cat.filters === 'location' ? '' : filters.to, locationId: cat.filters === 'date' ? '' : filters.locationId }, useFilters);
        parts.push({ table: part.t, rows });
      }
      out.push({ id: cat.id, label: cat.label, parts, count: parts.reduce((t, p) => t + p.rows.length, 0) });
    }
    return out;
  }
  const cleanFilters = (q) => ({ from: isDay(q.from) ? q.from : '', to: isDay(q.to) ? q.to : '', locationId: String(q.locationId || '') });

  async function readLog(companyId) {
    const [row] = await store.find('settings', { company_id: companyId, setting_key: 'data_cleanup_log' });
    try { return JSON.parse(row?.setting_value || '[]'); } catch { return []; }
  }

  // What would be removed (counts per category, for all categories) with the chosen filters.
  app.get('/api/data-cleanup/summary', auth, owner, route(async (req, res) => {
    const filters = cleanFilters(req.query);
    const result = await plan(req.companyId, CLEANUP_CATEGORIES.map((c) => c.id), filters);
    const locations = (await store.find('locations', { company_id: req.companyId })).map((l) => ({ id: l.id, name: l.name }));
    res.json({
      categories: CLEANUP_CATEGORIES.map((c) => {
        const r = result.find((x) => x.id === c.id);
        return { id: c.id, group: c.group, label: c.label, hint: c.hint, filters: c.filters || false, needs: c.needs || [], count: r.count, parts: r.parts.map((p) => ({ table: p.table, count: p.rows.length })) };
      }),
      locations, log: (await readLog(req.companyId)).slice(-30).reverse(), company: req.session.tenant?.name || '',
    });
  }));

  app.post('/api/data-cleanup/run', auth, owner, route(async (req, res) => {
    const body = req.body ?? {};
    const ids = (Array.isArray(body.categories) ? body.categories : []).map(String).filter((id) => CLEANUP_CATEGORIES.some((c) => c.id === id));
    if (!ids.length) return fail(res, 400, 'INVALID', 'Tick at least one kind of data to clear.');
    const filters = cleanFilters(body);
    // dependencies: items need every transaction + stock cleared fully (no date / location limit)
    for (const id of ids) {
      const cat = CLEANUP_CATEGORIES.find((c) => c.id === id);
      const missing = (cat.needs || []).filter((need) => !ids.includes(need));
      if (missing.length) return fail(res, 400, 'INVALID', `${cat.label} needs these cleared too: ${missing.map((m) => CLEANUP_CATEGORIES.find((c) => c.id === m)?.label).join(', ')}.`);
      if (cat.needs?.length && (filters.from || filters.to || filters.locationId)) return fail(res, 400, 'INVALID', `${cat.label} can only be cleared for all dates and all locations.`);
    }
    if (String(body.confirm || '').trim().toUpperCase() !== 'DELETE') return fail(res, 400, 'INVALID', 'Type DELETE to confirm.');
    const [user] = await store.find('users', { id: req.session.user.id });
    if (!user || !verifyPassword(String(body.password || ''), user.password_hash)) return fail(res, 400, 'INVALID', 'Your password is not correct.');

    const result = await plan(req.companyId, ids, filters);
    const batch = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const gone = `${req.companyId}~cleanup~${batch}`;
    const backup = { company: req.companyId, companyName: req.session.tenant?.name || '', batch, at: new Date().toISOString(), by: req.session.user.name || req.session.user.email || '', filters, categories: ids, tables: {} };
    for (const cat of result) for (const part of cat.parts) (backup.tables[part.table] ||= []).push(...part.rows);
    let file = '';
    try {
      const dir = join(dirname(process.env.SQLITE_FILE || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'stockkeep.sqlite')), 'backups');
      mkdirSync(dir, { recursive: true });
      file = join(dir, `cleanup-${batch}.json`);
      writeFileSync(file, JSON.stringify(backup));
    } catch { file = ''; }
    const counts = {};
    const seen = new Set();
    for (const cat of result) {
      counts[cat.id] = 0;
      for (const part of cat.parts) for (const row of part.rows) {
        const key = `${part.table}:${row.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await store.update(part.table, row.id, { company_id: gone });
        counts[cat.id] += 1;
      }
    }
    const log = await readLog(req.companyId);
    log.push({ batch, at: backup.at, by: backup.by, categories: ids.map((id) => CLEANUP_CATEGORIES.find((c) => c.id === id)?.label), filters, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), file, restored: false });
    await writeSetting(store, req.companyId, 'data_cleanup_log', JSON.stringify(log.slice(-100)));
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'data.cleanup', entity: 'company', entity_id: batch, created_at: new Date().toISOString() });
    res.json({ batch, counts, total: Object.values(counts).reduce((a, b) => a + b, 0), file });
  }));

  // Undo a cleanup: every row of the batch comes back into the company.
  app.post('/api/data-cleanup/restore/:batch', auth, owner, route(async (req, res) => {
    const batch = String(req.params.batch || '').replace(/[^a-z0-9]/gi, '');
    const log = await readLog(req.companyId);
    const entry = log.find((row) => row.batch === batch);
    if (!entry) return fail(res, 404, 'NOT_FOUND', 'That cleanup was not found.');
    if (entry.restored) return fail(res, 400, 'INVALID', 'That cleanup was already restored.');
    const [user] = await store.find('users', { id: req.session.user.id });
    if (!user || !verifyPassword(String(req.body?.password || ''), user.password_hash)) return fail(res, 400, 'INVALID', 'Your password is not correct.');
    const gone = `${req.companyId}~cleanup~${batch}`;
    let total = 0;
    for (const t of ALL_TABLES) for (const row of await store.find(t, { company_id: gone })) { await store.update(t, row.id, { company_id: req.companyId }); total += 1; }
    entry.restored = true; entry.restoredAt = new Date().toISOString(); entry.restoredBy = req.session.user.name || '';
    await writeSetting(store, req.companyId, 'data_cleanup_log', JSON.stringify(log));
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'data.cleanup.restore', entity: 'company', entity_id: batch, created_at: new Date().toISOString() });
    res.json({ restored: total });
  }));
}
