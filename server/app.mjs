import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_KEYS, LOCKED_FEATURES } from '../shared/domain.mjs';
import { hashPassword, hashToken, newRefreshToken, readAccess, signAccess, verifyPassword } from './auth.mjs';
import { loadSession } from './session.mjs';
import { provisionTenant } from './provision.mjs';
import { seedDemos } from './seed.mjs';
import { openStore } from './store.mjs';
import { registerService } from './service.mjs';
import { registerParties } from './parties.mjs';
import { registerDocuments } from './documents.mjs';
import { registerAppSettings } from './app-settings.mjs';
import { createPromotions } from './promotions.mjs';
import { registerTransfers } from './transfers.mjs';
import { registerWastage } from './wastage.mjs';
import { registerMigration } from './migration.mjs';
import { registerPriceLists } from './price-lists.mjs';
import { seedService } from './service-seed.mjs';
import { classify, cleanCode, lookupBarcode } from './barcode-lookup.mjs';
import { checkBatches, cleanExpiry } from '../shared/expiry.mjs';
import { isStockBarcode } from '../shared/stock-barcode.mjs';
import { createLots } from './stock-lots.mjs';
import { registerDataCleanup } from './data-cleanup.mjs';
import { registerStockReport } from './stock-report.mjs';
import { registerOrgStructure } from './org-structure.mjs';
import { registerWarranty } from './warranty.mjs';
import { cleanWarranty, warrantyProblem } from '../shared/warranty.mjs';
import { ITEM_TYPES, alertAt, alertLevelAt, batchKey, cleanBatchRule, cleanStockLevels, makeBatchNo, reorderAt, typeFromItem, typeOf } from '../shared/item-types.mjs';
import { registerUom, unitResolver } from './uom.mjs';
import { registerRepack } from './repack.mjs';
import { registerPrintTemplates } from './print-templates.mjs';

// Item-wise settings kept in the item profile (Item Master → Item Configuration).
const ITEM_SETTING_KEYS = {
  rack: 'text', shelf: 'text', maxStock: 'num', aisleLocationId: 'text', priceType: 'text', priceMargin: 'num',
  autoPrice: 'bool', allowEditPrice: 'bool', allowBelowCost: 'bool', enableDiscount: 'bool', maxDiscount: 'num',
  trackSerial: 'bool', mandatorySerial: 'bool',
};
function cleanItemSettings(raw = {}) {
  const out = {};
  for (const [key, type] of Object.entries(ITEM_SETTING_KEYS)) {
    const value = raw[key];
    if (value === undefined) continue;
    if (type === 'bool') out[key] = Boolean(value);
    else if (type === 'num') out[key] = value === '' || value == null ? '' : String(Math.max(Number(value) || 0, 0));
    else out[key] = String(value ?? '').slice(0, 80);
  }
  return out;
}

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, '..', 'client');
const distDir = join(clientRoot, 'dist');
const loginHits = new Map();

function fail(res, status, code, message) {
  res.status(status).json({ statusCode: status, code, message });
}

function route(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function cookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(header.split(';').map((part) => {
    const [key, ...rest] = part.trim().split('=');
    return [key, decodeURIComponent(rest.join('='))];
  }).filter((pair) => pair[0]));
}

function refreshCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.append('Set-Cookie', `sk_refresh=${encodeURIComponent(token)}; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=${14 * 86400}${secure}`);
}

function clearRefresh(res) {
  res.append('Set-Cookie', 'sk_refresh=; HttpOnly; Path=/api/auth; SameSite=Lax; Max-Age=0');
}

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function qty(value) {
  return Number(value).toFixed(3);
}

function money(value) {
  if (value == null || value === '') return '';
  return Number(value).toFixed(2);
}

function inr(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function skuPrefix(name) {
  const letters = String(name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const first = (letters[0] || 'ITEM').slice(0, 4);
  return first.length >= 3 ? first : (letters.join('').slice(0, 4) || 'ITEM').padEnd(3, 'X');
}

function on(value) {
  return Number(value) === 1;
}

function categoryLevel(row) {
  const parent = String(row.parent_id || '');
  const match = parent.match(/^level-(\d+)$/);
  if (match) {
    const level = Number(match[1]);
    if (level >= 1 && level <= 15) return String(level);
  }
  return parent ? '2' : '1';
}

const CATEGORY_LEVELS = Array.from({ length: 15 }, (_, index) => String(index + 1));
// Category 1 is always the compulsory “Item Type” (fixed name, always shown).
const ITEM_TYPE_LABEL = 'Item Type';
const CATEGORY_LABELS = Object.fromEntries(CATEGORY_LEVELS.map((level) => [level, level === '1' ? ITEM_TYPE_LABEL : `Category ${level}`]));
const CATEGORY_VISIBLE = Object.fromEntries(CATEGORY_LEVELS.map((level) => [level, Number(level) <= 5]));

async function writeSetting(store, companyId, key, value) {
  const [current] = await store.find('settings', { company_id: companyId, setting_key: key });
  if (current) await store.update('settings', current.id, { setting_value: String(value) });
  else await store.insert('settings', { company_id: companyId, setting_key: key, setting_value: String(value) });
}

// How an item was added: typed by hand, from a UPC/EAN/ISBN code look-up, or imported.
function cleanSource(raw, fallback = 'manual') {
  const method = ['manual', 'code_lookup', 'import'].includes(raw?.method) ? raw.method : fallback;
  if (method !== 'code_lookup') return { method, at: new Date().toISOString() };
  const text = (v, max) => String(v ?? '').trim().slice(0, max);
  return { method, code: text(raw.code, 40), codeType: text(raw.codeType, 30), sources: (Array.isArray(raw.sources) ? raw.sources : []).map((v) => text(v, 40)).slice(0, 6), fields: (Array.isArray(raw.fields) ? raw.fields : []).map((v) => text(v, 20)).slice(0, 20), at: new Date().toISOString() };
}

async function catalogueMeta(store, companyId) {
  const settings = await store.find('settings', { company_id: companyId });
  const labels = { ...CATEGORY_LABELS };
  const visible = { ...CATEGORY_VISIBLE };
  const profiles = {};
  let autoCreate = false;
  for (const row of settings) {
    const key = String(row.setting_key || '');
    const labelMatch = key.match(/^category_label_(\d+)$/);
    const visibleMatch = key.match(/^category_visible_(\d+)$/);
    if (labelMatch && labels[labelMatch[1]]) labels[labelMatch[1]] = row.setting_value || labels[labelMatch[1]];
    if (visibleMatch && visibleMatch[1] in visible) visible[visibleMatch[1]] = String(row.setting_value) === '1';
    if (key === 'category_auto_create') autoCreate = String(row.setting_value) === '1';
    if (key.startsWith('item_profile_')) {
      try { profiles[key.slice('item_profile_'.length)] = JSON.parse(row.setting_value); } catch { profiles[key.slice('item_profile_'.length)] = null; }
    }
  }
  const serialLabels = { ...SERIAL_FIELD_LABELS };
  const serialVisible = { ...SERIAL_FIELD_VISIBLE };
  for (const row of settings) {
    const key = String(row.setting_key || '');
    const label = key.match(/^serial_label_(\w+)$/);
    const shown = key.match(/^serial_visible_(\w+)$/);
    if (label && label[1] in serialLabels) serialLabels[label[1]] = row.setting_value || serialLabels[label[1]];
    if (shown && shown[1] in serialVisible) serialVisible[shown[1]] = String(row.setting_value) === '1';
  }
  serialVisible.serial1 = true;
  labels['1'] = ITEM_TYPE_LABEL;
  visible['1'] = true;
  return { labels, visible, profiles, autoCreate, serialLabels, serialVisible };
}

// Serial number fields, renamed and switched on in Main Category Setups.
const SERIAL_FIELD_LABELS = { serial1: 'Serial Number 1', serial2: 'Serial No 2', attr1: 'Additional Att. 1', attr2: 'Additional Att. 2', attr3: 'Additional Att. 3' };
const SERIAL_FIELD_VISIBLE = { serial1: true, serial2: true, attr1: true, attr2: true, attr3: true };

async function issue(store, res, userId, companyId) {
  const raw = newRefreshToken();
  await store.insert('refresh_tokens', {
    user_id: userId,
    token_hash: hashToken(raw),
    expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
    revoked: 0,
  });
  refreshCookie(res, raw);
  const session = await loadSession(store, userId);
  return { accessToken: signAccess(userId, companyId), ...session };
}

function requireUser(store) {
  return route(async (req, res, next) => {
    const payload = readAccess(bearer(req));
    if (!payload) return fail(res, 401, 'UNAUTHENTICATED', 'Sign in again.');
    const session = await loadSession(store, payload.sub);
    if (!session || session.tenant.id !== String(payload.tid)) return fail(res, 401, 'UNAUTHENTICATED', 'Sign in again.');
    req.session = session;
    req.companyId = session.tenant.id;
    next();
  });
}

function allow(permission, feature) {
  return (req, res, next) => {
    if (feature) {
      const module = req.session.modules.find((item) => item.key === feature);
      if (!module?.enabled) return fail(res, 403, 'MODULE_DISABLED', 'This module is not enabled for your business.');
    }
    if (permission && !req.session.user.permissions.includes(permission)) {
      return fail(res, 403, 'PERMISSION_DENIED', 'You do not have permission for this action.');
    }
    next();
  };
}

function allowEither(options) {
  return (req, res, next) => {
    const allowed = options.some(([permission, feature]) => {
      if (feature) {
        const module = req.session.modules.find((item) => item.key === feature);
        if (!module?.enabled) return false;
      }
      return !permission || req.session.user.permissions.includes(permission);
    });
    if (!allowed) return fail(res, 403, 'PERMISSION_DENIED', 'You do not have permission for this action.');
    next();
  };
}

function locationAllowed(session, locationId) {
  const ids = session.user.locationIds;
  return ids.length === 0 || ids.includes(String(locationId));
}

export async function createApp(options = {}) {
  const store = await openStore(options);
  const app = express();
  const lots = createLots(store, { qty, money, catalogueMeta, writeSetting });
  // ---------- automatic batch numbers (Item Configuration → Batch & Expiry → Generate batch number automatically) ----------
  const batchLocks = new Map();
  async function profileOfProduct(companyId, productId) {
    const [row] = await store.find('settings', { company_id: companyId, setting_key: `item_profile_${productId}` });
    try { return JSON.parse(row?.setting_value || '{}') || {}; } catch { return {}; }
  }
  async function nextBatchNos(companyId, productId, count = 1) {
    const rule = cleanBatchRule((await profileOfProduct(companyId, productId)).batch || {});
    if (!rule.auto || count < 1) return [];
    const run = async () => {
      const [row] = await store.find('settings', { company_id: companyId, setting_key: 'batch_seq' });
      let seq = {}; try { seq = JSON.parse(row?.setting_value || '{}') || {}; } catch { seq = {}; }
      const key = `${rule.prefix}|${rule.pattern}|${batchKey(rule)}`;
      const out = [];
      for (let i = 0; i < count; i += 1) { seq[key] = (Number(seq[key]) || 0) + 1; out.push(makeBatchNo(rule, seq[key])); }
      await writeSetting(store, companyId, 'batch_seq', JSON.stringify(seq));
      return out;
    };
    const prev = batchLocks.get(companyId) || Promise.resolve();
    const next = prev.then(run, run);
    batchLocks.set(companyId, next.catch(() => {}));
    return next;
  }
  // blank batch numbers on incoming batch rows get the next automatic number
  async function fillBatchNos(req, variantId, rows) {
    const blanks = (rows || []).filter((row) => Number(row.qty) > 0 && !String(row.batchNo || '').trim());
    if (!blanks.length) return;
    const [variant] = await store.find('variants', { id: variantId });
    if (!variant) return;
    const nos = await nextBatchNos(req.companyId, variant.product_id, blanks.length);
    blanks.forEach((row, i) => { if (nos[i]) row.batchNo = nos[i]; });
  }
  lots.setBatchSource(async (companyId, productId) => (await nextBatchNos(companyId, productId, 1))[0] || '');

  // one pass at start-up: stock that has no stock barcode yet (old data, imports) gets one now
  setTimeout(() => { lots.sweepAll().catch((err) => console.error('stock barcode sweep:', err.message)); }, 1500);
  let seeded = false;
  app.use(express.json({ limit: '1mb' }));
  app.use(route(async (req, _res, next) => {
    store.attach?.(req);
    if (process.env.X_ZOHO_CATALYST_LISTEN_PORT && !seeded) {
      seeded = true;
      try {
        await seedDemos(store);
        await seedService(store).catch((error) => console.error(`Workshop demo data was not loaded: ${error.message}`));
      } catch (error) {
        seeded = false;
        throw error;
      }
    }
    next();
  }));

  app.get('/api/health', route(async (_req, res) => {
    await store.ping();
    res.json({ status: 'ok', database: store.kind === 'memory' ? 'memory' : 'catalyst' });
  }));

  app.post('/api/auth/signup', route(async (req, res) => {
    const body = req.body ?? {};
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!body.ownerName || !body.businessName || !email || !password || !body.stateCode) {
      return fail(res, 400, 'INVALID', 'Fill in the business, your name, email, password, and state.');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'INVALID', 'Enter a valid email.');
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return fail(res, 400, 'INVALID', 'Use at least 8 characters, with a letter and a number.');
    }
    if (!['computer_shop', 'bike_service'].includes(body.businessType)) {
      return fail(res, 400, 'INVALID', 'Choose a computer shop or a bike service centre.');
    }
    if (body.gstin && !String(body.gstin).toUpperCase().startsWith(body.stateCode)) {
      return fail(res, 400, 'INVALID', 'GSTIN must start with the state code.');
    }
    const existing = await store.find('users', { email });
    if (existing.length) return fail(res, 409, 'EMAIL_TAKEN', 'That email is already registered.');
    const created = await provisionTenant(store, { ...body, email });
    res.status(201).json(await issue(store, res, created.userId, created.companyId));
  }));

  app.post('/api/auth/login', route(async (req, res) => {
    const ip = req.ip || 'local';
    const hit = loginHits.get(ip) || { count: 0, at: Date.now() };
    if (Date.now() - hit.at > 15 * 60 * 1000) {
      hit.count = 0;
      hit.at = Date.now();
    }
    if (hit.count >= 10) return fail(res, 429, 'RATE_LIMIT', 'Too many sign-in attempts. Wait 15 minutes.');
    const email = String(req.body?.email || '').trim().toLowerCase();
    const [user] = await store.find('users', { email });
    if (!user || !verifyPassword(String(req.body?.password || ''), user.password_hash)) {
      hit.count += 1;
      loginHits.set(ip, hit);
      return fail(res, 401, 'INVALID_LOGIN', 'Email or password is incorrect.');
    }
    loginHits.set(ip, { count: 0, at: Date.now() });
    res.json(await issue(store, res, user.id, user.company_id));
  }));

  app.post('/api/auth/refresh', route(async (req, res) => {
    const raw = cookies(req).sk_refresh;
    if (!raw) return fail(res, 401, 'UNAUTHENTICATED', 'Sign in again.');
    const [row] = await store.find('refresh_tokens', { token_hash: hashToken(raw) });
    if (!row || on(row.revoked) || new Date(row.expires_at).getTime() < Date.now()) {
      return fail(res, 401, 'UNAUTHENTICATED', 'Sign in again.');
    }
    await store.update('refresh_tokens', row.id, { revoked: 1 });
    const [user] = await store.find('users', { id: row.user_id });
    const issued = await issue(store, res, user.id, user.company_id);
    res.json({ accessToken: issued.accessToken });
  }));

  app.post('/api/auth/logout', route(async (req, res) => {
    const raw = cookies(req).sk_refresh;
    if (raw) {
      const [row] = await store.find('refresh_tokens', { token_hash: hashToken(raw) });
      if (row) await store.update('refresh_tokens', row.id, { revoked: 1 });
    }
    clearRefresh(res);
    res.json({ ok: true });
  }));

  const auth = requireUser(store);
  app.get('/api/auth/me', auth, (req, res) => res.json(req.session));

  app.get('/api/dashboard/summary', auth, allow('dashboard.view'), route(async (req, res) => {
    const locations = await scopedLocations(store, req.session);
    const ids = new Set(locations.map((row) => row.id));
    const products = (await store.find('products', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const variants = (await store.find('variants', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const levels = await store.find('stock_levels', { company_id: req.companyId });
    let low = 0;
    let value = 0;
    const alertMeta = await catalogueMeta(store, req.companyId);
    for (const variant of variants) {
      const onHand = levels
        .filter((row) => row.variant_id === variant.id && ids.has(row.location_id))
        .reduce((sum, row) => sum + Number(row.qty_on_hand || 0), 0);
      const alertOn = locations.some((location) => alertAt(alertMeta.profiles[variant.product_id], location.id));
      if (alertOn && Number(variant.min_stock) > 0 && onHand <= Number(variant.min_stock)) low += 1;
      value += onHand * Number(variant.cost_price || 0);
    }
    const movements = await recentMovements(store, req.companyId, 8);
    res.json({
      locations: locations.length,
      products: products.length,
      skus: variants.length,
      lowStock: low,
      stockValue: value.toFixed(2),
      stockValueLabel: inr(value),
      recentMovements: movements,
    });
  }));

  app.get('/api/locations', auth, allow('locations.view'), route(async (req, res) => {
    res.json({ items: await scopedLocations(store, req.session) });
  }));

  app.post('/api/locations', auth, allow('locations.manage'), route(async (req, res) => {
    const active = (await store.find('locations', { company_id: req.companyId })).filter((row) => on(row.is_active));
    if (active.length >= req.session.limits.locations) return fail(res, 400, 'LIMIT', 'This plan has no room for another location.');
    const name = String(req.body?.name || '').trim();
    if (name.length < 2) return fail(res, 400, 'INVALID', 'Enter a location name.');
    const saved = await store.insert('locations', {
      company_id: req.companyId,
      name,
      kind: req.body.kind || 'store',
      is_active: 1,
    });
    res.status(201).json(saved);
  }));

  app.get('/api/users', auth, allow('users.view', 'users'), route(async (req, res) => {
    const users = await store.find('users', { company_id: req.companyId });
    const roles = await store.find('roles', { company_id: req.companyId });
    const items = users.map((user) => {
      const role = roles.find((item) => item.id === user.role_id);
      return { id: user.id, name: user.name, email: user.email, status: user.status, role_code: role?.code, role_name: role?.name };
    }).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ items });
  }));

  app.get('/api/roles', auth, allow('users.view', 'users'), route(async (req, res) => {
    const roles = (await store.find('roles', { company_id: req.companyId })).sort((a, b) => a.name.localeCompare(b.name));
    const rights = await store.find('role_rights', { company_id: req.companyId });
    res.json({
      items: roles.map((role) => ({
        ...role,
        permissions: rights.filter((row) => row.role_id === role.id).map((row) => row.permission),
      })),
    });
  }));

  app.post('/api/users', auth, allow('users.manage', 'users'), route(async (req, res) => {
    const active = (await store.find('users', { company_id: req.companyId })).filter((row) => row.status === 'active');
    if (active.length >= req.session.limits.users) return fail(res, 400, 'LIMIT', 'This plan has no room for another user.');
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    if (name.length < 2 || !email || password.length < 8) return fail(res, 400, 'INVALID', 'Name, email, and a password of 8 characters are required.');
    if ((await store.find('users', { email })).length) return fail(res, 409, 'EMAIL_TAKEN', 'That email is already registered.');
    const [role] = await store.find('roles', { id: req.body.roleId });
    if (!role || role.company_id !== req.companyId || role.code === 'owner') return fail(res, 400, 'INVALID', 'Choose a role other than owner.');
    const user = await store.insert('users', {
      company_id: req.companyId,
      role_id: role.id,
      name,
      email,
      password_hash: hashPassword(password),
      status: 'active',
      created_at: new Date().toISOString(),
    });
    for (const locationId of req.body.locationIds ?? []) {
      const [location] = await store.find('locations', { id: locationId });
      if (location && location.company_id === req.companyId) {
        await store.insert('user_locations', { company_id: req.companyId, user_id: user.id, location_id: location.id });
      }
    }
    res.status(201).json({ id: user.id });
  }));

  app.get('/api/categories', auth, allow('catalogue.view', 'catalogue'), route(async (req, res) => {
    const items = (await store.find('categories', { company_id: req.companyId })).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ items: items.map((item) => ({ ...item, level: categoryLevel(item) })) });
  }));
  app.post('/api/categories', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const level = String(req.body?.level || '1');
    if (!name) return fail(res, 400, 'INVALID', 'Enter a category name.');
    if (!CATEGORY_LEVELS.includes(level)) return fail(res, 400, 'INVALID', 'Choose a category from 1 to 15.');
    const saved = await store.insert('categories', { company_id: req.companyId, name, parent_id: `level-${level}` });
    res.status(201).json({ id: saved.id, name, level });
  }));
  app.get('/api/brands', auth, allow('catalogue.view', 'catalogue'), route(async (req, res) => {
    const items = (await store.find('brands', { company_id: req.companyId })).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ items });
  }));
  app.post('/api/brands', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return fail(res, 400, 'INVALID', 'Enter a brand name.');
    const saved = await store.insert('brands', { company_id: req.companyId, name });
    res.status(201).json({ id: saved.id, name });
  }));
  app.get('/api/catalogue/labels', auth, allowEither([['catalogue.view', 'catalogue'], ['settings.view', 'settings']]), route(async (req, res) => {
    res.json(await catalogueMeta(store, req.companyId));
  }));
  app.patch('/api/catalogue/labels', auth, allowEither([['catalogue.manage', 'catalogue'], ['settings.manage', 'settings']]), route(async (req, res) => {
    const incoming = req.body?.labels || {};
    const incomingVisible = req.body?.visible || {};
    for (const level of CATEGORY_LEVELS) {
      if (level === '1') continue; // Item Type: fixed name, always shown
      const name = String(incoming[level] || '').trim();
      if (name) await writeSetting(store, req.companyId, `category_label_${level}`, name.slice(0, 40));
      if (Object.prototype.hasOwnProperty.call(incomingVisible, level)) {
        await writeSetting(store, req.companyId, `category_visible_${level}`, incomingVisible[level] ? '1' : '0');
      }
    }
    const serialLabels = req.body?.serialLabels || {};
    const serialVisible = req.body?.serialVisible || {};
    for (const field of Object.keys(SERIAL_FIELD_LABELS)) {
      const name = String(serialLabels[field] || '').trim();
      if (name) await writeSetting(store, req.companyId, `serial_label_${field}`, name.slice(0, 40));
      if (field !== 'serial1' && Object.prototype.hasOwnProperty.call(serialVisible, field)) {
        await writeSetting(store, req.companyId, `serial_visible_${field}`, serialVisible[field] ? '1' : '0');
      }
    }
    if (typeof req.body?.autoCreate === 'boolean') {
      await writeSetting(store, req.companyId, 'category_auto_create', req.body.autoCreate ? '1' : '0');
    }
    res.json(await catalogueMeta(store, req.companyId));
  }));
  // UPC / EAN lookup: our own catalogue first, then the public product databases.
  app.get('/api/catalogue/lookup', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const raw = String(req.query.code || '').slice(0, 80);
    const info = classify(raw);
    if (!info.code) return fail(res, 400, 'INVALID', 'Scan or type a barcode, ISBN, or model number.');
    const same = (value) => {
      if (!value) return false;
      const other = classify(value);
      return other.code === info.code || other.keys.some((key) => info.keys.includes(key));
    };
    const meta = await catalogueMeta(store, req.companyId);
    const variants = await store.find('variants', { company_id: req.companyId });
    const ownProductId = Object.entries(meta.profiles).find(([, profile]) => same(profile?.upc))?.[0]
      || variants.find((row) => same(row.barcode))?.product_id;
    let existing = null;
    if (ownProductId) {
      const [product] = await store.find('products', { id: ownProductId });
      if (product && product.company_id === req.companyId) existing = { id: product.id, name: product.name };
    }
    const result = await lookupBarcode(raw, { refresh: req.query.refresh === '1' });
    res.json({ ...result, existing });
  }));

  app.get('/api/units', auth, allow('catalogue.view', 'catalogue'), route(async (req, res) => {
    const items = (await store.find('units', { company_id: req.companyId })).sort((a, b) => a.name.localeCompare(b.name));
    res.json({ items });
  }));

  app.get('/api/products', auth, allow('catalogue.view', 'catalogue'), route(async (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const products = (await store.find('products', { company_id: req.companyId })).sort((a, b) => a.name.localeCompare(b.name));
    const items = [];
    for (const product of products) {
      if (q && !product.name.toLowerCase().includes(q)) continue;
      items.push(await shapeProduct(store, product));
    }
    res.json({ items });
  }));

  // SKU like MAGG-0001: first four letters of the name, then the next free number.
  async function nextSku(companyId, name, reserved = new Set()) {
    const prefix = skuPrefix(name);
    const used = new Set((await store.find('variants', { company_id: companyId })).map((row) => String(row.sku).toUpperCase()));
    for (const code of reserved) used.add(code.toUpperCase());
    let max = 0;
    for (const code of used) {
      const match = code.match(new RegExp(`^${prefix}-(\\d+)$`));
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `${prefix}-${String(max + 1).padStart(4, '0')}`;
  }

  app.get('/api/catalogue/next-sku', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    res.json({ sku: await nextSku(req.companyId, req.query.name) });
  }));

  async function brandIdFor(companyId, brandName) {
    const name = String(brandName || '').trim().slice(0, 60);
    if (!name) return '';
    const brands = await store.find('brands', { company_id: companyId });
    const found = brands.find((row) => row.name.toLowerCase() === name.toLowerCase());
    return found ? found.id : (await store.insert('brands', { company_id: companyId, name })).id;
  }

  async function upcTaken(companyId, upc) {
    if (!upc) return false;
    const meta = await catalogueMeta(store, companyId);
    const keys = classify(upc).keys;
    const same = (other) => other && (cleanCode(other) === upc || classify(cleanCode(other)).keys.some((key) => keys.includes(key)));
    return Object.values(meta.profiles).some((profile) => profile && (same(profile.upc) || (profile.extraCodes || []).some(same)));
  }

  // One item = product + profile + variant (+ opening stock).
  // Child → its parent item; Repackaged → the bulk item it is packed from and how much of it one pack uses.
  async function itemLinks(req, itemType, body, selfId) {
    const fields = {};
    if (itemType === 'child') {
      const parentId = String(body.parentId || '');
      if (!parentId) return { error: 'Child Item: choose its parent item.' };
      if (parentId === selfId) return { error: 'An item cannot be its own parent.' };
      const [parent] = await store.find('products', { id: parentId });
      if (!parent || parent.company_id !== req.companyId) return { error: 'The parent item was not found.' };
      const pp = (await catalogueMeta(store, req.companyId)).profiles[parent.id] || {};
      if (typeFromItem({ profile: pp, trackingType: parent.tracking_type, isService: on(parent.is_service) }) !== 'parent') return { error: `${parent.name} is not a Parent Item. Set its Product Type to “Parent Item” first.` };
      fields.parentId = parent.id;
      const per = body.parentQty === '' || body.parentQty == null ? 1 : Number(body.parentQty);
      if (!(per > 0)) return { error: 'Child Item: enter how much parent stock one child uses (e.g. 1, or 0.1 for one of a pack of 10).' };
      fields.parentQty = Math.round(per * 10000) / 10000;
    }
    if (itemType === 'repack') {
      const bulkId = String(body.bulkOf?.productId || '');
      const per = Number(body.bulkOf?.qty);
      if (!bulkId) return { error: 'Repackaged Item: choose the bulk item it is packed from.' };
      if (bulkId === selfId) return { error: 'An item cannot be packed from itself.' };
      if (!(per > 0)) return { error: 'Repackaged Item: enter how much bulk stock one pack uses (e.g. 1 for 1 kg).' };
      const [bulk] = await store.find('products', { id: bulkId });
      if (!bulk || bulk.company_id !== req.companyId) return { error: 'The bulk item was not found.' };
      const bp = (await catalogueMeta(store, req.companyId)).profiles[bulk.id] || {};
      if (typeFromItem({ profile: bp, trackingType: bulk.tracking_type, isService: on(bulk.is_service) }) !== 'bulk') return { error: `${bulk.name} is not a Bulk Item. Set its Product Type to “Bulk Item” first.` };
      fields.bulkOf = { productId: bulk.id, qty: String(per) };
    }
    return { fields };
  }

  async function createItem(req, item) {
    const product = await store.insert('products', {
      company_id: req.companyId,
      name: item.name,
      category_id: item.categoryId || '',
      brand_id: item.brandId || '',
      unit_id: item.unitId,
      hsn_sac: item.hsnSac || '',
      gst_rate: item.gstRate || '18',
      tracking_type: item.trackingType || 'none',
      is_service: item.isService ? 1 : 0,
      is_active: 1,
    });
    await writeSetting(store, req.companyId, `item_profile_${product.id}`, JSON.stringify(item.profile));
    const variant = await store.insert('variants', {
      company_id: req.companyId,
      product_id: product.id,
      sku: item.sku,
      barcode: item.barcode || '',
      mrp: money(item.mrp),
      sale_price: money(item.salePrice),
      cost_price: money(item.costPrice),
      min_stock: qty(item.minStock || 0),
      is_active: 1,
    });
    const opening = Number(item.openingStock || 0);
    if (opening > 0 && item.locationId) {
      // through changeStock so the opening quantity gets its own stock barcode straight away (all item types)
      await changeStock(req, { locationId: item.locationId, variantId: variant.id, delta: opening, reason: 'opening', type: 'opening', note: 'Opening stock at item creation', price: { mrp: item.mrp, salePrice: item.salePrice, costPrice: item.costPrice }, lots: [], source: 'Item creation' });
    }
    return product;
  }

  async function openingLocation(req, locationId) {
    if (!locationId) return null;
    if (!locationAllowed(req.session, locationId)) return 'DENIED';
    const [location] = await store.find('locations', { id: locationId });
    return location && location.company_id === req.companyId && on(location.is_active) ? location : null;
  }

  app.post('/api/products', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const body = req.body ?? {};
    const name = String(body.name || '').trim();
    if (name.length < 2) return fail(res, 400, 'INVALID', 'Enter the item name.');
    if (!((Array.isArray(body.categoryId) ? body.categoryId[0] : body.categoryId) || body.slots?.['1'])) return fail(res, 400, 'INVALID', 'Choose the Item Type (Category 1) — it is compulsory.');
    const sku = String(body.variant?.sku || '').trim() || await nextSku(req.companyId, name);
    const [unit] = await store.find('units', { id: body.unitId });
    if (!unit || unit.company_id !== req.companyId) return fail(res, 400, 'INVALID', 'Choose a unit.');
    const taken = (await store.find('variants', { company_id: req.companyId })).some((row) => row.sku.toLowerCase() === sku.toLowerCase());
    if (taken) return fail(res, 409, 'SKU', `SKU ${sku} is already used.`);
    const warranty = body.trackingType === 'serial' ? cleanWarranty(body.warranty) : cleanWarranty({});
    const warrantyError = warrantyProblem(warranty);
    if (warrantyError) return fail(res, 400, 'INVALID', warrantyError);
    // Product Type (Standard, Serialised, Parent, Child, Bulk, Repackaged, Service …)
    const itemType = ITEM_TYPES.some((t) => t.id === body.itemType) ? body.itemType : body.trackingType === 'serial' ? 'serial' : 'standard';
    if (itemType === 'matrix') return fail(res, 400, 'INVALID', 'Matrix items are created with their variant table.');
    if (itemType === 'serial') body.trackingType = 'serial';
    const stockless = Boolean(typeOf(itemType).service);
    if (stockless) { body.trackingType = 'none'; body.expiry = { enabled: false }; if (Number(body.variant?.openingStock) > 0 || (Array.isArray(body.serials) && body.serials.some((r) => r?.serial1))) return fail(res, 400, 'INVALID', `${typeOf(itemType).label}: no stock is kept, so leave opening stock empty.`); }
    if (itemType === 'child') { body.expiry = { enabled: false }; if (Number(body.variant?.openingStock) > 0) return fail(res, 400, 'INVALID', 'Child Item: it uses its parent item\'s stock, so leave opening stock empty.'); }
    const links = await itemLinks(req, itemType, body, null);
    if (links.error) return fail(res, 400, 'INVALID', links.error);
    const upc = cleanCode(body.upc);
    if (await upcTaken(req.companyId, upc)) return fail(res, 409, 'UPC', 'An item with this UPC/EAN code already exists.');
    const serialRows = Array.isArray(body.serials) ? body.serials.filter((row) => row && (row.serial1 || row.serial2)) : [];
    const serialLocation = serialRows.length ? await stockLocation(req, body.locationId) : null;
    if (serialRows.length) {
      if (!serialLocation) return fail(res, 400, 'INVALID', 'Choose the location for the serial numbers.');
      const check = await receiveSerials(req, { variant: null, location: serialLocation, rows: serialRows, dryRun: true });
      if (check.error) return fail(res, 400, 'INVALID', check.error);
    }
    const opening = Number(body.variant?.openingStock || 0);
    const location = opening > 0 ? await openingLocation(req, body.locationId) : null;
    if (opening > 0 && (!location || location === 'DENIED')) return fail(res, 400, 'INVALID', 'Choose the location for the opening stock.');
    const product = await createItem(req, {
      name,
      categoryId: (Array.isArray(body.categoryId) ? body.categoryId[0] : body.categoryId) || '',
      brandId: await brandIdFor(req.companyId, body.brandName),
      unitId: body.unitId,
      hsnSac: body.hsnSac,
      gstRate: body.gstRate,
      trackingType: body.trackingType === 'serial' ? 'serial' : cleanExpiry(body.expiry).enabled ? 'batch' : 'none',
      sku,
      barcode: body.variant?.barcode,
      mrp: body.variant?.mrp,
      salePrice: body.variant?.salePrice,
      costPrice: body.variant?.costPrice,
      minStock: body.variant?.minStock,
      openingStock: opening,
      locationId: location?.id,
      isService: stockless,
      profile: {
        kind: itemType === 'serial' ? 'electronics' : body.kind === 'matrix' ? 'grocery' : body.kind || 'grocery',
        itemType,
        ...links.fields,
        stockLevels: cleanStockLevels(body.stockLevels),
        reorderAlert: body.reorderAlert !== false,
        batch: cleanBatchRule(body.batch),
        slots: body.slots || {},
        matrix: Array.isArray(body.matrix) ? body.matrix.map(String) : [],
        upc,
        image: /^https:\/\//i.test(String(body.imageUrl || '')) ? String(body.imageUrl).slice(0, 500) : '',
        notes: String(body.notes || '').slice(0, 500),
        settings: cleanItemSettings(body.settings),
        expiry: body.trackingType === 'serial' ? cleanExpiry({}) : cleanExpiry(body.expiry),
        warranty,
        source: cleanSource(body.source),
      },
    });
    if (serialRows.length) {
      const [variant] = await store.find('variants', { product_id: product.id, company_id: req.companyId });
      await receiveSerials(req, { variant, location: serialLocation, rows: serialRows, reason: 'opening', note: '', source: 'Item creation' });
    }
    res.status(201).json(await shapeProduct(store, product));
  }));

  // Matrix: one item per category combination, all checked before any is created.
  app.post('/api/products/matrix', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const body = req.body ?? {};
    const base = body.base ?? {};
    const baseName = String(base.name || '').trim();
    if (baseName.length < 2) return fail(res, 400, 'INVALID', 'Enter the item name.');
    const [unit] = await store.find('units', { id: base.unitId });
    if (!unit || unit.company_id !== req.companyId) return fail(res, 400, 'INVALID', 'Choose a unit.');
    const rows = (Array.isArray(body.rows) ? body.rows : []).filter((row) => row && row.include !== false);
    if (!rows.length) return fail(res, 400, 'INVALID', 'Pick categories so the variant table has at least one row.');
    if (rows.length > 500) return fail(res, 400, 'INVALID', 'Up to 500 variants can be created at once.');
    const existing = new Set((await store.find('variants', { company_id: req.companyId })).map((row) => String(row.sku).toLowerCase()));
    const reserved = new Set();
    const prepared = [];
    for (const [index, row] of rows.entries()) {
      const name = String(row.name || '').trim().slice(0, 160);
      if (name.length < 2) return fail(res, 400, 'INVALID', `Row ${index + 1}: enter a name.`);
      if (!(row.slots?.['1'] || base.categoryId)) return fail(res, 400, 'INVALID', `Row ${index + 1}: choose the Item Type (Category 1) — it is compulsory.`);
      let sku = String(row.sku || '').trim();
      if (!sku) sku = await nextSku(req.companyId, baseName, reserved);
      const key = sku.toLowerCase();
      if (existing.has(key)) return fail(res, 409, 'SKU', `Row ${index + 1}: SKU ${sku} is already used by another item.`);
      if (reserved.has(key)) return fail(res, 409, 'SKU', `Row ${index + 1}: SKU ${sku} is repeated in the table.`);
      reserved.add(key);
      for (const field of ['mrp', 'salePrice', 'costPrice', 'openingStock', 'minStock']) {
        if (row[field] !== '' && row[field] != null && !(Number(row[field]) >= 0)) return fail(res, 400, 'INVALID', `Row ${index + 1}: ${field} must be a number.`);
      }
      prepared.push({ ...row, name, sku });
    }
    const needsStock = prepared.some((row) => Number(row.openingStock) > 0);
    const location = needsStock ? await openingLocation(req, body.locationId) : null;
    if (needsStock && (!location || location === 'DENIED')) return fail(res, 400, 'INVALID', 'Choose the location for the opening stock.');
    const upc = cleanCode(base.upc);
    const brandId = await brandIdFor(req.companyId, base.brandName);
    const group = `mx-${Date.now().toString(36)}`;
    const created = [];
    for (const row of prepared) {
      const slots = row.slots && typeof row.slots === 'object' ? row.slots : {};
      const product = await createItem(req, {
        name: row.name,
        categoryId: slots['1'] || (Array.isArray(base.categoryId) ? base.categoryId[0] : base.categoryId) || '',
        brandId,
        unitId: base.unitId,
        hsnSac: row.hsnSac ?? base.hsnSac,
        gstRate: row.gstRate || base.gstRate,
        trackingType: base.trackingType,
        sku: row.sku,
        barcode: row.barcode,
        mrp: row.mrp,
        salePrice: row.salePrice,
        costPrice: row.costPrice,
        minStock: row.minStock,
        openingStock: row.openingStock,
        locationId: location?.id,
        profile: {
          kind: 'matrix',
          group,
          parent: baseName,
          slots,
          matrix: Object.keys(slots),
          upc: created.length === 0 ? upc : '',
          image: /^https:\/\//i.test(String(base.imageUrl || '')) ? String(base.imageUrl).slice(0, 500) : '',
          notes: String(base.notes || '').slice(0, 500),
          settings: cleanItemSettings(base.settings),
          expiry: cleanExpiry({}),
          itemType: 'matrix',
          stockLevels: cleanStockLevels(row.stockLevels || base.stockLevels),
          reorderAlert: (row.reorderAlert ?? base.reorderAlert) !== false,
          batch: cleanBatchRule(base.batch),
          source: cleanSource(base.source),
        },
      });
      created.push({ id: product.id, name: product.name, sku: row.sku });
    }
    res.status(201).json({ group, count: created.length, items: created });
  }));

  app.patch('/api/products/:id', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const [existing] = await store.find('products', { id: req.params.id });
    if (!existing || existing.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Product not found.');
    const body = req.body ?? {};
    const saved = await store.update('products', existing.id, {
      name: body.name ?? existing.name,
      hsn_sac: body.hsnSac === undefined ? existing.hsn_sac : body.hsnSac || '',
      gst_rate: body.gstRate ?? existing.gst_rate,
      tracking_type: body.trackingType ?? existing.tracking_type,
      is_active: body.isActive === undefined ? existing.is_active : body.isActive ? 1 : 0,
    });
    res.json(await shapeProduct(store, saved));
  }));

  // Delete an item: only when it was never used (no stock movement, serial, document or job card line).
  // Used items must be marked inactive instead, so old bills and reports stay correct.
  // The rows are moved out of the company (tombstoned), which hides them from every screen.
  app.delete('/api/products/:id', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const [product] = await store.find('products', { id: req.params.id });
    if (!product || product.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Item not found.');
    const variants = await store.find('variants', { product_id: product.id, company_id: req.companyId });
    const ids = new Set(variants.map((row) => row.id));
    const moved = (await store.find('stock_movements', { company_id: req.companyId })).some((row) => ids.has(row.variant_id));
    const serial = (await store.find('serials', { company_id: req.companyId })).some((row) => ids.has(row.variant_id) || row.product_id === product.id);
    const inDocs = [...await store.find('documents', { company_id: req.companyId }), ...await store.find('job_lines', { company_id: req.companyId }), ...await store.find('price_updates', { company_id: req.companyId })]
      .some((row) => { const text = JSON.stringify(row); return text.includes(product.id) || [...ids].some((id) => text.includes(id)); });
    if (moved || serial || inDocs) return fail(res, 409, 'IN_USE', `${product.name} is already used in ${moved ? 'stock entries' : serial ? 'serial numbers' : 'bills / documents'}, so it cannot be deleted. Mark it inactive instead.`);
    const gone = `${req.companyId}~deleted`;
    const stamp = Date.now().toString(36);
    for (const variant of variants) await store.update('variants', variant.id, { company_id: gone, sku: `${variant.sku}~del${stamp}`, barcode: '', is_active: 0 });
    for (const level of await store.find('stock_levels', { company_id: req.companyId })) if (ids.has(level.variant_id)) await store.update('stock_levels', level.id, { company_id: gone });
    const [profileRow] = await store.find('settings', { company_id: req.companyId, setting_key: `item_profile_${product.id}` });
    if (profileRow) await store.update('settings', profileRow.id, { company_id: gone });
    await store.update('products', product.id, { company_id: gone, is_active: 0 });
    res.json({ ok: true, id: product.id, name: product.name });
  }));

  // ---------- item edit ----------
  app.get('/api/products/:id/full', auth, allow('catalogue.view', 'catalogue'), route(async (req, res) => {
    const [product] = await store.find('products', { id: req.params.id });
    if (!product || product.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Item not found.');
    const meta = await catalogueMeta(store, req.companyId);
    const profile = meta.profiles[product.id] || {};
    const shaped = await shapeProduct(store, product);
    const levels = (await store.find('stock_levels', { company_id: req.companyId })).filter((row) => shaped.variants.some((variant) => variant.id === row.variant_id));
    const serials = product.tracking_type === 'serial' ? (await store.find('serials', { company_id: req.companyId, product_id: product.id })).filter((row) => row.status === 'in_stock').length : 0;
    res.json({
      ...shaped,
      unitId: product.unit_id,
      categoryId: product.category_id || '',
      brandName: shaped.brand?.name || '',
      profile: { kind: profile.kind || (product.tracking_type === 'serial' ? 'electronics' : 'grocery'), slots: profile.slots || {}, upc: profile.upc || '', image: profile.image || '', notes: profile.notes || '', group: profile.group || '', parent: profile.parent || '', settings: profile.settings || {}, expiry: cleanExpiry(profile.expiry || {}), warranty: cleanWarranty(profile.warranty || {}), itemType: typeFromItem({ profile, trackingType: product.tracking_type, isService: on(product.is_service) }), parentId: profile.parentId || '', parentQty: profile.parentQty || '', bulkOf: profile.bulkOf || null, reorderAlert: profile.reorderAlert !== false, stockLevels: profile.stockLevels || {}, batch: cleanBatchRule(profile.batch || {}), uom: profile.uom || null, source: profile.source || null, extraCodes: profile.extraCodes || [] },
      stockQty: levels.reduce((sum, row) => sum + Number(row.qty_on_hand || 0), 0),
      serialsInStock: serials,
    });
  }));

  // Product history: everything that happened to one item — stock by location, every stock movement
  // with running balance, purchase / sales documents, price changes and stock barcodes.
  app.get('/api/products/:id/history', auth, allow('catalogue.view', 'catalogue'), route(async (req, res) => {
    const [product] = await store.find('products', { id: req.params.id });
    if (!product || product.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Item not found.');
    const nn = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
    const shaped = await shapeProduct(store, product);
    const meta = await catalogueMeta(store, req.companyId);
    const profile = meta.profiles[product.id] || {};
    const ids = new Set(shaped.variants.map((v) => v.id));
    const skuOf = Object.fromEntries(shaped.variants.map((v) => [v.id, v.sku]));
    const locations = await store.find('locations', { company_id: req.companyId });
    const locName = (id) => locations.find((row) => row.id === id)?.name || '—';
    const allowedLoc = (id) => !id || locationAllowed(req.session, id);
    const levels = (await store.find('stock_levels', { company_id: req.companyId })).filter((row) => ids.has(row.variant_id) && allowedLoc(row.location_id));
    const stock = levels.filter((row) => nn(row.qty_on_hand) !== 0).map((row) => ({ variantId: row.variant_id, sku: skuOf[row.variant_id], locationId: row.location_id, locationName: locName(row.location_id), qty: nn(row.qty_on_hand) }));
    // movements, oldest first with running balance (all locations you can see)
    const moves = (await store.find('stock_movements', { company_id: req.companyId })).filter((row) => ids.has(row.variant_id) && allowedLoc(row.location_id))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    let balance = 0;
    const movements = moves.map((row) => {
      balance += nn(row.qty);
      const note = row.note || '';
      return { id: row.id, at: row.created_at, type: row.movement_type || '', reason: row.reason || '', ref: (note.match(/^[A-Z]{1,5}-\d+/) || [''])[0], note, locationName: locName(row.location_id), sku: skuOf[row.variant_id], in: nn(row.qty) > 0 ? nn(row.qty) : 0, out: nn(row.qty) < 0 ? -nn(row.qty) : 0, balance: Math.round(balance * 1000) / 1000 };
    }).reverse();
    // purchase & sales documents with this item
    const docs = [];
    for (const row of await store.find('documents', { company_id: req.companyId })) {
      if (!allowedLoc(row.location_id)) continue;
      let data = {}; try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
      let qtySum = 0; let value = 0; let rate = 0;
      for (const line of data.lines || []) {
        for (const v of line.variants || []) if (ids.has(v.variantId) && nn(v.qty) > 0) { qtySum += nn(v.qty); rate = nn(v.rate); value += nn(v.qty) * nn(v.rate) * (1 - nn(line.disc) / 100); }
        if (line.picked?.ids?.length && ids.has(line.picked.variantId)) { qtySum += line.picked.ids.length; rate = nn(line.picked.rate); value += line.picked.ids.length * rate; }
        if (line.serials?.rows?.length && ids.has(line.serials.variantId)) { const c = line.serials.rows.length; qtySum += c; rate = nn(line.serials.rows[0]?.costPrice); value += line.serials.rows.reduce((t, r) => t + nn(r.costPrice), 0); }
      }
      if (!(qtySum > 0)) continue;
      docs.push({ module: row.module, type: row.doc_type, number: row.number, date: row.doc_date || String(row.created_at || '').slice(0, 10), party: row.party_name || '', locationName: locName(row.location_id), status: row.status || '', qty: qtySum, rate, value: Math.round(value * 100) / 100, stockDir: nn(data.stockDir) });
    }
    docs.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.number).localeCompare(String(a.number)));
    // price changes (Price Update documents)
    const prices = [];
    for (const row of await store.find('price_updates', { company_id: req.companyId })) {
      let data = {}; try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
      for (const line of data.lines || []) {
        if (!ids.has(line.variantId)) continue;
        const changes = PRICE_FIELDS.filter(([key]) => line[key]).map(([key, , label]) => ({ label, from: line[key].from, to: line[key].to }));
        if (changes.length) prices.push({ number: row.number, at: row.created_at, user: row.user_name || '', sku: skuOf[line.variantId], serial: line.serial || '', changes });
      }
    }
    prices.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const lotRows = [];
    for (const v of shaped.variants) { const got = await lots.listLots(req, { variantId: v.id }); if (got) lotRows.push(...got.items.filter((row) => allowedLoc(row.locationId)).map((row) => ({ ...row, sku: v.sku, locationName: locName(row.locationId) }))); }
    const purchases = docs.filter((d) => d.module === 'purchase' && d.type !== 'order');
    const sales = docs.filter((d) => d.module === 'sales' && d.type === 'bill');
    const sumBy = (fn) => Math.round(moves.filter(fn).reduce((t, row) => t + Math.abs(nn(row.qty)), 0) * 1000) / 1000;
    const purchasedQty = purchases.filter((d) => d.stockDir > 0).reduce((t, d) => t + d.qty, 0);
    const purchasedValue = purchases.filter((d) => d.stockDir > 0).reduce((t, d) => t + d.value, 0);
    res.json({
      product: { ...shaped, createdAt: product.created_at || '', hsnSac: product.hsn_sac || '', settings: profile.settings || {}, notes: profile.notes || '' },
      stock, movements, documents: docs, prices, lots: lotRows,
      summary: {
        onHand: stock.reduce((t, row) => t + row.qty, 0),
        totalIn: sumBy((row) => nn(row.qty) > 0), totalOut: sumBy((row) => nn(row.qty) < 0),
        sold: sumBy((row) => nn(row.qty) < 0 && (row.reason === 'sale' || row.movement_type === 'sale')),
        purchased: sumBy((row) => nn(row.qty) > 0 && row.reason === 'purchase'),
        wastage: sumBy((row) => nn(row.qty) < 0 && (row.reason === 'wastage' || ['damage', 'loss', 'expired'].includes(row.reason))),
        transfers: sumBy((row) => row.reason === 'transfer' && nn(row.qty) < 0),
        firstIn: moves.find((row) => nn(row.qty) > 0)?.created_at || '',
        lastIn: [...moves].reverse().find((row) => nn(row.qty) > 0)?.created_at || '',
        lastOut: [...moves].reverse().find((row) => nn(row.qty) < 0)?.created_at || '',
        avgPurchaseRate: purchasedQty ? Math.round((purchasedValue / purchasedQty) * 100) / 100 : 0,
        lastPurchase: purchases.find((d) => d.stockDir > 0) || purchases[0] || null,
        lastSale: sales[0] || null,
        salesValue: Math.round(sales.reduce((t, d) => t + d.value, 0) * 100) / 100,
      },
    });
  }));

  app.put('/api/products/:id', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const [product] = await store.find('products', { id: req.params.id });
    if (!product || product.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Item not found.');
    const body = req.body ?? {};
    const name = String(body.name || '').trim();
    if (name.length < 2) return fail(res, 400, 'INVALID', 'Enter the item name.');
    const [unit] = await store.find('units', { id: body.unitId });
    if (!unit || unit.company_id !== req.companyId) return fail(res, 400, 'INVALID', 'Choose a unit.');
    const variants = await store.find('variants', { company_id: req.companyId });
    const own = variants.find((row) => row.product_id === product.id);
    const sku = String(body.variant?.sku || own?.sku || '').trim();
    if (!sku) return fail(res, 400, 'INVALID', 'Enter the item code.');
    if (variants.some((row) => row.id !== own?.id && String(row.sku).toLowerCase() === sku.toLowerCase())) return fail(res, 409, 'SKU', `SKU ${sku} is already used by another item.`);
    const meta = await catalogueMeta(store, req.companyId);
    const profile = meta.profiles[product.id] || {};
    const upc = cleanCode(body.upc);
    if (upc && upc !== profile.upc) {
      const keys = classify(upc).keys;
      const clash = Object.entries(meta.profiles).some(([id, other]) => id !== product.id && other?.upc && (cleanCode(other.upc) === upc || classify(other.upc).keys.some((key) => keys.includes(key))));
      if (clash) return fail(res, 409, 'UPC', 'Another item already uses this UPC/EAN code.');
    }
    for (const field of ['mrp', 'salePrice', 'costPrice', 'minStock']) {
      const value = body.variant?.[field];
      if (value !== '' && value != null && !(Number(value) >= 0)) return fail(res, 400, 'INVALID', `${field === 'minStock' ? 'Reorder level' : field} must be zero or more.`);
    }
    if (Number(body.variant?.mrp) > 0 && Number(body.variant?.salePrice) > Number(body.variant?.mrp)) return fail(res, 400, 'INVALID', 'Sale price cannot be above the MRP.');
    const serial = product.tracking_type === 'serial';
    const expiry = serial ? cleanExpiry({}) : cleanExpiry(body.expiry);
    const warranty = serial ? cleanWarranty(body.warranty === undefined ? profile.warranty || {} : body.warranty) : cleanWarranty({});
    const warrantyError = warrantyProblem(warranty);
    if (warrantyError) return fail(res, 400, 'INVALID', warrantyError);
    const oldType = typeFromItem({ profile, trackingType: product.tracking_type, isService: on(product.is_service) });
    let itemType = ITEM_TYPES.some((t) => t.id === body.itemType) ? body.itemType : oldType;
    const fixed = (t) => t === 'serial' || t === 'matrix';
    if (fixed(oldType) || fixed(itemType)) itemType = oldType; // serial / matrix are fixed once created
    const stockless = Boolean(typeOf(itemType).service);
    if (stockless !== on(product.is_service)) {
      const levels = await store.find('stock_levels', { company_id: req.companyId, variant_id: own?.id || '' });
      if (levels.some((row) => Math.abs(Number(row.qty_on_hand) || 0) > 0.0001)) return fail(res, 400, 'INVALID', stockless ? 'This item still has stock. Clear the stock before making it a service / non-stock item.' : 'Changing a service item to a stock item is allowed only while it has no stock entries.');
    }
    if (itemType === 'child' && oldType !== 'child') {
      const levels = await store.find('stock_levels', { company_id: req.companyId, variant_id: own?.id || '' });
      if (levels.some((row) => Math.abs(Number(row.qty_on_hand) || 0) > 0.0001)) return fail(res, 400, 'INVALID', 'This item has its own stock. A child item uses its parent\'s stock — clear this stock first.');
    }
    const links = await itemLinks(req, itemType, body, product.id);
    if (links.error) return fail(res, 400, 'INVALID', links.error);
    const categoryId = (Array.isArray(body.categoryId) ? body.categoryId[0] : body.categoryId) || '';
    if (!categoryId && !body.slots?.['1']) return fail(res, 400, 'INVALID', 'Choose the Item Type (Category 1) — it is compulsory.');
    await store.update('products', product.id, {
      name,
      category_id: categoryId,
      brand_id: await brandIdFor(req.companyId, body.brandName),
      unit_id: body.unitId,
      hsn_sac: String(body.hsnSac || '').slice(0, 20),
      gst_rate: body.gstRate || product.gst_rate,
      tracking_type: serial ? 'serial' : expiry.enabled && !stockless && itemType !== 'child' ? 'batch' : 'none',
      is_service: stockless ? 1 : 0,
    });
    if (own) {
      await store.update('variants', own.id, {
        sku, barcode: String(body.variant?.barcode || '').slice(0, 60),
        mrp: money(body.variant?.mrp), sale_price: money(body.variant?.salePrice), cost_price: money(body.variant?.costPrice),
        min_stock: qty(body.variant?.minStock || 0),
      });
    }
    await writeSetting(store, req.companyId, `item_profile_${product.id}`, JSON.stringify({
      ...profile,
      slots: body.slots && typeof body.slots === 'object' ? body.slots : profile.slots || {},
      upc,
      image: /^https:\/\//i.test(String(body.imageUrl || '')) ? String(body.imageUrl).slice(0, 500) : profile.image || '',
      notes: String(body.notes ?? profile.notes ?? '').slice(0, 500),
      settings: cleanItemSettings(body.settings),
      expiry: stockless || itemType === 'child' ? cleanExpiry({}) : expiry,
      warranty,
      itemType,
      parentId: links.fields.parentId || '', parentQty: links.fields.parentQty || '',
      bulkOf: links.fields.bulkOf || null,
      stockLevels: body.stockLevels === undefined ? profile.stockLevels || {} : cleanStockLevels(body.stockLevels),
      reorderAlert: body.reorderAlert === undefined ? profile.reorderAlert !== false : body.reorderAlert !== false,
      batch: body.batch === undefined ? cleanBatchRule(profile.batch || {}) : cleanBatchRule(body.batch),
    }));
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'catalogue.edit', entity: 'product', entity_id: product.id, created_at: new Date().toISOString() });
    const [saved] = await store.find('products', { id: product.id });
    res.json(await shapeProduct(store, saved));
  }));

  // ---------- batches (expiry items) ----------
  // Table batches: company_id, variant_id, location_id, batch_no, mfg_date, expiry_date, qty, source, created_at
  async function expiryOf(req, variantId) {
    const [variant] = await store.find('variants', { id: variantId });
    if (!variant) return null;
    const meta = await catalogueMeta(store, req.companyId);
    if (meta.profiles[variant.product_id]?.itemType === 'child') return null; // stock (and batches) are the parent's
    const expiry = cleanExpiry(meta.profiles[variant.product_id]?.expiry || {});
    if (expiry.enabled && cleanBatchRule(meta.profiles[variant.product_id]?.batch || {}).auto) expiry.batchMandatory = false; // blank = automatic
    return expiry.enabled ? expiry : null;
  }

  // makeLots: false when the stock barcodes were already put back by changeStock (transfers / returns).
  async function addBatches(req, { variantId, locationId, rows, source, price = {}, sourceType = '', makeLots = true }) {
    let made = [];
    if (makeLots) {
      const total = rows.reduce((sum, row) => sum + (Number(row.qty) > 0 ? Number(row.qty) : 0), 0);
      made = await lots.addLots(req, { variantId, locationId, delta: total, rows, price, sourceType, sourceNo: source });
      // note the new batch barcodes on the stock movement that brought this stock in
      if (made.length) {
        const recent = (await store.find('stock_movements', { company_id: req.companyId, variant_id: variantId, location_id: locationId }))
          .filter((row) => Number(row.qty) > 0 && !row.lots && Date.now() - new Date(row.created_at).getTime() < 60000)
          .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
        if (recent) await store.update('stock_movements', recent.id, { lots: JSON.stringify(made.map((lot) => ({ barcode: lot.barcode, qty: Number(lot.qty) || 0, batchNo: lot.batchNo || '', expiryDate: lot.expiryDate || '' }))) });
      }
    }
    const existing = await store.find('batches', { company_id: req.companyId, variant_id: variantId, location_id: locationId });
    for (const row of rows) {
      const amount = Number(row.qty) || 0;
      if (!(amount > 0)) continue;
      const batchNo = String(row.batchNo || '').trim().toUpperCase().slice(0, 40);
      const found = existing.find((item) => item.batch_no === batchNo && item.expiry_date === row.expiryDate);
      if (found) {
        found.qty = qty(Number(found.qty) + amount);
        await store.update('batches', found.id, { qty: found.qty });
      } else {
        existing.push(await store.insert('batches', { company_id: req.companyId, variant_id: variantId, location_id: locationId, batch_no: batchNo, mfg_date: row.mfgDate || '', expiry_date: row.expiryDate, qty: qty(amount), source: String(source || '').slice(0, 60), created_at: new Date().toISOString() }));
      }
    }
    return made;
  }

  // Takes stock out of batches, earliest expiry first (FEFO). Returns what was taken.
  // prefer: batches to take first (from the stock barcodes that went out — see changeStock).
  async function consumeBatches(req, { variantId, locationId, amount, prefer = [] }) {
    const rows = (await store.find('batches', { company_id: req.companyId, variant_id: variantId, location_id: locationId }))
      .filter((row) => Number(row.qty) > 0).sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
    let left = Number(amount) || 0;
    const taken = [];
    for (const want of prefer) {
      const row = rows.find((item) => item.batch_no === String(want.batchNo || '').toUpperCase() && String(item.expiry_date || '') === String(want.expiryDate || '') && Number(item.qty) > 0);
      if (!row || left <= 0) continue;
      const take = Math.min(left, Number(want.qty) || 0, Number(row.qty));
      if (!(take > 0)) continue;
      row.qty = qty(Number(row.qty) - take);
      await store.update('batches', row.id, { qty: row.qty });
      taken.push({ batchNo: row.batch_no, mfgDate: row.mfg_date, expiryDate: row.expiry_date, qty: take });
      left -= take;
    }
    for (const row of rows) {
      if (left <= 0) break;
      const take = Math.min(left, Number(row.qty));
      await store.update('batches', row.id, { qty: qty(Number(row.qty) - take) });
      taken.push({ batchNo: row.batch_no, mfgDate: row.mfg_date, expiryDate: row.expiry_date, qty: take });
      left -= take;
    }
    return taken;
  }

  app.get('/api/batches', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const rows = (await store.find('batches', { company_id: req.companyId }))
      .filter((row) => (!req.query.variantId || row.variant_id === String(req.query.variantId)) && (!req.query.locationId || row.location_id === String(req.query.locationId)) && locationAllowed(req.session, row.location_id) && Number(row.qty) > 0)
      .sort((a, b) => String(a.expiry_date).localeCompare(String(b.expiry_date)));
    res.json({ items: rows.map((row) => ({ id: row.id, variantId: row.variant_id, locationId: row.location_id, batchNo: row.batch_no, mfgDate: row.mfg_date, expiryDate: row.expiry_date, qty: Number(row.qty), source: row.source })) });
  }));

  app.get('/api/stock', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const locations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active));
    const q = String(req.query.q || '').trim().toLowerCase();
    const products = await store.find('products', { company_id: req.companyId });
    const units = await store.find('units', { company_id: req.companyId });
    const variants = (await store.find('variants', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const levels = await store.find('stock_levels', { company_id: req.companyId });
    const meta = await catalogueMeta(store, req.companyId);
    const unitsOf = await unitResolver(store, req.companyId);
    const items = [];
    for (const variant of variants) {
      const product = products.find((row) => row.id === variant.product_id);
      if (!product || !on(product.is_active)) continue;
      if (q && !product.name.toLowerCase().includes(q) && !variant.sku.toLowerCase().includes(q)) continue;
      const unit = units.find((row) => row.id === product.unit_id);
      const choice = product.tracking_type === 'serial' ? null : unitsOf(product, meta.profiles[product.id] || {});
      for (const location of locations) {
        const level = levels.find((row) => row.variant_id === variant.id && row.location_id === location.id);
        const onHand = Number(level?.qty_on_hand || 0);
        items.push({
          variantId: variant.id,
          productId: product.id,
          sku: variant.sku,
          productName: product.name,
          profile: meta.profiles[product.id] || null,
          unitCode: unit?.code,
          ...(choice ? { units: choice.units, unitUse: choice.unitUse } : {}),
          trackingType: product.tracking_type || 'none',
          locationId: location.id,
          locationName: location.name,
          qtyOnHand: qty(onHand),
          minStock: qty(reorderAt(meta.profiles[product.id], variant.min_stock, location.id)),
          stockValue: variant.cost_price ? (onHand * Number(variant.cost_price)).toFixed(2) : null,
          reorderAlert: alertAt(meta.profiles[product.id], location.id),
          low: alertLevelAt(meta.profiles[product.id], variant.min_stock, location.id) > 0 && onHand <= alertLevelAt(meta.profiles[product.id], variant.min_stock, location.id),
        });
      }
    }
    res.json({ items });
  }));

  app.get('/api/stock/movements', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 5000);
    const rows = (await recentMovements(store, req.companyId, limit)).filter((row) => locationAllowed(req.session, row.location_id));
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        qty: row.qty,
        movementType: row.movement_type,
        reason: row.reason,
        note: row.note,
        createdAt: row.created_at,
        location: { name: row.location_name },
        sku: row.sku,
        productName: row.product_name,
      })),
    });
  }));

  app.post('/api/stock/adjustments', auth, allow('stock.adjust', 'stock'), route(async (req, res) => {
    const { locationId, variantId, reason, note } = req.body ?? {};
    const delta = Number(req.body?.qtyDelta);
    if (!locationId || !variantId || !Number.isFinite(delta) || delta === 0) {
      return fail(res, 400, 'INVALID', 'Choose an item, a location, and a quantity other than zero.');
    }
    if (!locationAllowed(req.session, locationId)) return fail(res, 403, 'PERMISSION_DENIED', 'That location is outside your access.');
    const [location] = await store.find('locations', { id: locationId });
    if (!location || location.company_id !== req.companyId || !on(location.is_active)) return fail(res, 404, 'NOT_FOUND', 'Location not found.');
    const [variant] = await store.find('variants', { id: variantId });
    if (!variant || variant.company_id !== req.companyId || !on(variant.is_active)) return fail(res, 404, 'NOT_FOUND', 'Variant not found.');
    const blocked = await childBlock(req, variantId);
    if (blocked) return fail(res, 400, 'INVALID', blocked);
    const expiry = await expiryOf(req, variantId);
    const batches = Array.isArray(req.body?.batches) ? req.body.batches : [];
    if (expiry && delta > 0) {
      const problem = checkBatches(batches, expiry, variant.sku);
      if (problem) return fail(res, 400, 'INVALID', problem);
      const total = batches.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
      if (Math.abs(total - delta) > 0.0001) return fail(res, 400, 'INVALID', `Batch quantities (${total}) must add up to ${delta}.`);
      await fillBatchNos(req, variantId, batches);
    }
    const [level] = await store.find('stock_levels', { company_id: req.companyId, location_id: locationId, variant_id: variantId });
    const next = Number(level?.qty_on_hand || 0) + delta;
    if (next < -0.0001) return fail(res, 400, 'NEGATIVE', 'Stock cannot go below zero.');
    const pick = Array.isArray(req.body?.pick) ? req.body.pick : [];
    if (delta < 0 && pick.length) {
      const problem = await lots.pickProblem(req, { variantId, locationId, pick, name: variant.sku });
      if (problem) return fail(res, 400, 'INVALID', problem);
    }
    const result = await changeStock(req, { locationId, variantId, delta, reason, note, type: reason === 'opening' ? 'opening' : 'adjustment', pick, source: reason || 'stock update' });
    if (expiry && delta > 0) await addBatches(req, { variantId, locationId, rows: batches, source: reason || 'stock update', sourceType: reason || 'adjustment' });
    else if (expiry && delta < 0) await consumeBatches(req, { variantId, locationId, amount: -delta, prefer: result.lots });
    res.status(201).json({ qtyOnHand: qty(next), lots: result.lots });
  }));


  // ---------- serial numbers ----------
  // Stock barcodes follow every change:
  //   in  — lots: [{ qty, barcode?, batchNo, ... }] put back / made; none → one new barcode for the inward
  //         (batch items get theirs in addBatches, serial units in receiveSerials)
  //   out — pick: [{ barcode, qty }] exact stock barcodes first; batches: [{ batchNo, expiryDate, qty }];
  //         the rest earliest expiry / oldest first. Returns { next, lots } (lots that came in / went out).
  // Child items keep no stock: their movements go to the parent item (qty × parentQty).
  async function childTarget(req, variantId) {
    const [variant] = await store.find('variants', { id: String(variantId || '') });
    if (!variant || variant.company_id !== req.companyId) return null;
    const [row] = await store.find('settings', { company_id: req.companyId, setting_key: `item_profile_${variant.product_id}` });
    let profile = {}; try { profile = JSON.parse(row?.setting_value || '{}') || {}; } catch { profile = {}; }
    if (profile.itemType !== 'child' || !profile.parentId) return null;
    const [parentVariant] = (await store.find('variants', { company_id: req.companyId, product_id: profile.parentId })).filter((item) => on(item.is_active));
    if (!parentVariant) return null;
    const [parent] = await store.find('products', { id: profile.parentId });
    return { variantId: parentVariant.id, sku: parentVariant.sku, name: parent?.name || parentVariant.sku, ratio: Number(profile.parentQty) > 0 ? Number(profile.parentQty) : 1, childSku: variant.sku };
  }
  // stock that a variant can use at a location (a child item uses its parent's stock)
  async function usableStock(req, variantId, locationId) {
    const target = await childTarget(req, variantId);
    const id = target?.variantId || variantId;
    const [level] = await store.find('stock_levels', { company_id: req.companyId, location_id: locationId, variant_id: id });
    const have = Number(level?.qty_on_hand || 0);
    return target ? { have: have / target.ratio, parentHave: have, target } : { have, target: null };
  }

  async function childBlock(req, variantId) {
    const target = await childTarget(req, variantId);
    return target ? `${target.childSku} is a child item — it keeps no stock of its own. Use its parent item ${target.name} (${target.sku}).` : '';
  }

  async function changeStock(req, args) {
    const target = await childTarget(req, args.variantId);
    if (!target) return moveStock(req, args);
    const delta = Math.round(args.delta * target.ratio * 1000) / 1000;
    const note = `${args.note ? `${args.note} · ` : ''}child ${target.childSku} × ${Math.abs(args.delta)}`;
    const result = await moveStock(req, { ...args, variantId: target.variantId, delta, note, pick: [], batches: [], serialIds: [], lots: delta > 0 ? [] : undefined });
    if (await expiryOf(req, target.variantId)) {
      if (delta < 0) await consumeBatches(req, { variantId: target.variantId, locationId: args.locationId, amount: -delta, prefer: result.lots });
    }
    return { ...result, parent: target };
  }

  async function moveStock(req, { locationId, variantId, delta, reason, note, type, lots: lotRows, pick = [], batches: batchPick = [], price = {}, source = '', serialIds = [] }) {
    const [level] = await store.find('stock_levels', { company_id: req.companyId, location_id: locationId, variant_id: variantId });
    const before = Number(level?.qty_on_hand || 0);
    const next = before + delta;
    if (delta < 0 && before > 0) await lots.reconcile(req, variantId, locationId); // stock from before stock barcodes
    if (level) await store.update('stock_levels', level.id, { qty_on_hand: qty(next) });
    else await store.insert('stock_levels', { company_id: req.companyId, location_id: locationId, variant_id: variantId, qty_on_hand: qty(next) });
    let moved = [];
    const ref = source || String(note || '').split(/[\s—·]/)[0];
    if (delta > 0) {
      if (Array.isArray(lotRows)) moved = await lots.addLots(req, { variantId, locationId, delta, rows: lotRows, price, sourceType: reason || type || '', sourceNo: ref });
      else if (!(await expiryOf(req, variantId))) moved = await lots.addLots(req, { variantId, locationId, delta, price, sourceType: reason || type || '', sourceNo: ref });
    } else if (delta < 0) {
      moved = await lots.takeLots(req, { variantId, locationId, amount: -delta, pick: Array.isArray(pick) ? pick : [], batches: Array.isArray(batchPick) ? batchPick : [] });
    }
    // Which stock barcodes (lots / serial units) this movement touched — used by the Stock Analysis report.
    let units = [];
    if (Array.isArray(serialIds) && serialIds.length) {
      const all = await store.find('serials', { company_id: req.companyId, variant_id: variantId });
      units = serialIds.map((id) => all.find((row) => row.id === String(id))).filter(Boolean).map((row) => ({ barcode: row.barcode || '', serial: row.serial1 || '', qty: 1 }));
    } else units = (moved || []).map((lot) => ({ barcode: lot.barcode, qty: Number(lot.qty) || 0, batchNo: lot.batchNo || '', expiryDate: lot.expiryDate || '' }));
    const movement = await store.insert('stock_movements', {
      company_id: req.companyId, location_id: locationId, variant_id: variantId, qty: qty(delta),
      movement_type: type || (reason === 'opening' ? 'opening' : 'adjustment'), reason: reason || 'correction', note: note || '', created_at: new Date().toISOString(),
      ref: String(ref || '').slice(0, 60), lots: units.length ? JSON.stringify(units.slice(0, 500)) : '',
    });
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'stock.adjust', entity: 'stock_movement', entity_id: movement.id, created_at: new Date().toISOString() });
    return { next, lots: moved };
  }

  async function stockLocation(req, locationId) {
    if (!locationId || !locationAllowed(req.session, locationId)) return null;
    const [location] = await store.find('locations', { id: locationId });
    return location && location.company_id === req.companyId && on(location.is_active) ? location : null;
  }

  function serialKey(value) {
    return String(value || '').trim().toUpperCase();
  }

  async function receiveSerials(req, { variant, location, rows, reason, note, source = '', dryRun = false }) {
    const existing = await store.find('serials', { company_id: req.companyId });
    const taken = new Set(existing.filter((row) => row.status !== 'removed').flatMap((row) => [serialKey(row.serial1), serialKey(row.serial2)]).filter(Boolean));
    const seen = new Set();
    const clean = [];
    for (const [index, row] of rows.entries()) {
      const serial1 = String(row.serial1 || '').trim().slice(0, 60);
      const serial2 = String(row.serial2 || '').trim().slice(0, 60);
      if (!serial1 && !serial2) continue;
      if (!serial1) return { error: `Row ${index + 1}: Serial No 1 is required.` };
      for (const code of [serial1, serial2].filter(Boolean)) {
        const key = serialKey(code);
        if (taken.has(key)) return { error: `Row ${index + 1}: serial ${code} is already in the system.` };
        if (/^2\d{12}$/.test(key) && await lots.codeInUse(req.companyId, key)) return { error: `Row ${index + 1}: ${code} is already used as a stock barcode.` };
        if (seen.has(key)) return { error: `Row ${index + 1}: serial ${code} is repeated in the list.` };
        seen.add(key);
      }
      clean.push({ ...row, serial1, serial2 });
    }
    if (!clean.length) return { error: 'Enter at least one serial number.' };
    if (dryRun) return { count: clean.length };
    const lotCfg = await lots.config(req.companyId);
    const codes = lotCfg.enabled && lotCfg.serialBarcodes ? await lots.newBarcodes(req.companyId, clean.length) : [];
    const ref = String(source || String(note || '').split(/[\s—·]/)[0] || '').slice(0, 60);
    const [serialBatch] = variant ? await nextBatchNos(req.companyId, variant.product_id, 1) : [];
    const newIds = [];
    for (const [index, row] of clean.entries()) {
      const savedSerial = await store.insert('serials', {
        barcode: codes[index] || '',
        source_no: ref,
        batch_no: serialBatch || '',
        company_id: req.companyId,
        product_id: variant.product_id,
        variant_id: variant.id,
        location_id: location.id,
        serial1: row.serial1,
        serial2: row.serial2,
        attr1: String(row.attr1 || '').slice(0, 80),
        attr2: String(row.attr2 || '').slice(0, 80),
        attr3: String(row.attr3 || '').slice(0, 80),
        mrp: money(row.mrp),
        sale_price: money(row.salePrice),
        cost_price: money(row.costPrice),
        status: 'in_stock',
        created_at: new Date().toISOString(),
      });
      newIds.push(savedSerial.id);
    }
    await changeStock(req, { locationId: location.id, variantId: variant.id, delta: clean.length, reason, source, serialIds: newIds, note: note || `${clean.length} serial number${clean.length === 1 ? '' : 's'}: ${clean.slice(0, 5).map((row) => row.serial1).join(', ')}${clean.length > 5 ? '…' : ''}` });
    return { count: clean.length };
  }

  app.get('/api/serials', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    if (req.query.variantId) await lots.serialBarcodes(req, { variantId: String(req.query.variantId) });
    const rows = (await store.find('serials', { company_id: req.companyId }))
      .filter((row) => !req.query.variantId || row.variant_id === String(req.query.variantId))
      .filter((row) => !req.query.locationId || row.location_id === String(req.query.locationId))
      .filter((row) => !req.query.status || row.status === req.query.status)
      .filter((row) => locationAllowed(req.session, row.location_id));
    res.json({ items: rows.map((row) => ({ id: row.id, serial1: row.serial1, serial2: row.serial2 || '', barcode: row.barcode || '', batchNo: row.batch_no || '', attr1: row.attr1 || '', attr2: row.attr2 || '', attr3: row.attr3 || '', mrp: row.mrp || '', salePrice: row.sale_price || '', costPrice: row.cost_price || '', status: row.status, locationId: row.location_id, createdAt: row.created_at })) });
  }));

  app.post('/api/serials/receive', auth, allow('stock.adjust', 'stock'), route(async (req, res) => {
    const location = await stockLocation(req, req.body?.locationId);
    if (!location) return fail(res, 400, 'INVALID', 'Choose a location you have access to.');
    const [variant] = await store.find('variants', { id: String(req.body?.variantId || '') });
    if (!variant || variant.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Item not found.');
    const result = await receiveSerials(req, { variant, location, rows: Array.isArray(req.body.rows) ? req.body.rows : [], reason: req.body.reason, note: req.body.note });
    if (result.error) return fail(res, 400, 'INVALID', result.error);
    res.status(201).json(result);
  }));

  app.post('/api/serials/remove', auth, allow('stock.adjust', 'stock'), route(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(String);
    if (!ids.length) return fail(res, 400, 'INVALID', 'Tick the serial numbers to take out of stock.');
    const rows = (await store.find('serials', { company_id: req.companyId })).filter((row) => ids.includes(row.id));
    if (rows.length !== ids.length || rows.some((row) => row.status !== 'in_stock')) return fail(res, 400, 'INVALID', 'Some serial numbers are no longer in stock.');
    if (rows.some((row) => !locationAllowed(req.session, row.location_id))) return fail(res, 403, 'PERMISSION_DENIED', 'That location is outside your access.');
    const groups = new Map();
    const ids2 = new Map();
    for (const row of rows) {
      await store.update('serials', row.id, { status: req.body.reason === 'damage' ? 'damaged' : 'removed', removed_at: new Date().toISOString() });
      const key = `${row.variant_id}|${row.location_id}`;
      groups.set(key, [...(groups.get(key) || []), row.serial1]);
      ids2.set(key, [...(ids2.get(key) || []), row.id]);
    }
    for (const [key, serials] of groups) {
      const [variantId, locationId] = key.split('|');
      await changeStock(req, { locationId, variantId, delta: -serials.length, serialIds: ids2.get(key), reason: req.body.reason || 'correction', note: `${req.body.note ? `${req.body.note} · ` : ''}Serials out: ${serials.join(', ')}` });
    }
    res.status(201).json({ count: rows.length });
  }));

  // ---------- opening stock entries (OSE-0001, OSE-0002 …) ----------
  // Each entry is a set of opening movements that share the entry number in
  // their note, so no extra table is needed.
  const OSE_NO = /^OSE-(\d+)/;

  async function openingMovements(companyId) {
    return (await store.find('stock_movements', { company_id: companyId }))
      .filter((row) => row.movement_type === 'opening' && OSE_NO.test(String(row.note || '')));
  }

  async function nextOpeningNumber(companyId) {
    let max = 0;
    for (const row of await openingMovements(companyId)) max = Math.max(max, Number(String(row.note).match(OSE_NO)[1]));
    return `OSE-${String(max + 1).padStart(4, '0')}`;
  }

  function commonCode(codes) {
    if (!codes.length) return '';
    let prefix = codes[0];
    for (const code of codes) while (prefix && !code.startsWith(prefix)) prefix = prefix.slice(0, -1);
    prefix = prefix.replace(/[-_ /]*\d*$/, '').replace(/[-_ /]+$/, '');
    return prefix.length >= 3 ? `${prefix}-*` : codes[0];
  }

  // Items for the entry windows (opening stock, price update): standard and serialised items
  // one by one, matrix items grouped by their matrix.
  // Matrix: the category levels that make the combinations (Size, Colour …) with their values.
  function matrixDims(variants, meta, categoryRows) {
    const levels = new Map();
    for (const v of variants) for (const [level, id] of Object.entries(v.attrs || {})) if (id) { if (!levels.has(level)) levels.set(level, new Set()); levels.get(level).add(String(id)); }
    let used = [...levels.entries()].filter(([, ids]) => ids.size > 1);
    if (!used.length) used = [...levels.entries()].filter(([level]) => level !== '1');
    const nameOf = (id) => categoryRows.find((c) => c.id === id)?.name || id;
    return used.sort((a, b) => Number(a[0]) - Number(b[0])).map(([level, ids]) => ({
      level, label: meta.labels[level] || `Category ${level}`,
      values: [...ids].map((id) => ({ id, name: nameOf(id) })).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
    }));
  }

  // Matrix: add a new value (e.g. a new Size) — the missing combinations become new sub-items of the same main item.
  app.post('/api/products/matrix/:group/values', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const groupId = String(req.params.group || '');
    const level = String(req.body?.level || '');
    const meta = await catalogueMeta(store, req.companyId);
    const products = (await store.find('products', { company_id: req.companyId })).filter((row) => on(row.is_active) && meta.profiles[row.id]?.kind === 'matrix' && meta.profiles[row.id]?.group === groupId);
    if (!products.length) return fail(res, 404, 'NOT_FOUND', 'Matrix item not found.');
    if (!CATEGORY_LEVELS.includes(level)) return fail(res, 400, 'INVALID', 'Choose which category to add to.');
    const variants = await store.find('variants', { company_id: req.companyId });
    const categories = await store.find('categories', { company_id: req.companyId });
    const label = meta.labels[level] || `Category ${level}`;
    // the value: an existing category of that level, or a new one by name
    let category = req.body?.categoryId ? categories.find((c) => c.id === String(req.body.categoryId) && categoryLevel(c) === level) : null;
    const name = String(req.body?.name || '').trim().slice(0, 60);
    if (!category && name) category = categories.find((c) => categoryLevel(c) === level && c.name.trim().toLowerCase() === name.toLowerCase()) || null;
    if (!category) {
      if (!name) return fail(res, 400, 'INVALID', `Enter the new ${label}.`);
      category = await store.insert('categories', { company_id: req.companyId, name, parent_id: `level-${level}` });
      categories.push(category);
    }
    const rows = products.map((product) => ({ product, profile: meta.profiles[product.id] || {}, variant: variants.find((v) => v.product_id === product.id) })).filter((row) => row.variant);
    const shapedRows = rows.map((row) => ({ attrs: row.profile.slots || {} }));
    const dims = matrixDims(shapedRows, meta, categories).map((dim) => dim.level);
    if (!dims.includes(level)) dims.push(level);
    const others = dims.filter((l) => l !== level);
    // every combination of the other dimensions already in use
    const combos = [...new Map(rows.map((row) => [others.map((l) => row.profile.slots?.[l] || '').join('|'), Object.fromEntries(others.map((l) => [l, row.profile.slots?.[l] || '']))])).values()];
    const parentName = rows[0].profile.parent || rows[0].product.name;
    const reserved = new Set();
    const created = [];
    for (const combo of combos) {
      const exists = rows.some((row) => row.profile.slots?.[level] === category.id && others.every((l) => (row.profile.slots?.[l] || '') === combo[l]));
      if (exists) continue;
      const template = rows.find((row) => others.every((l) => (row.profile.slots?.[l] || '') === combo[l])) || rows[0];
      const slots = { ...(template.profile.slots || {}), ...Object.fromEntries(Object.entries(combo).filter(([, id]) => id)), [level]: category.id };
      const names = dims.slice().sort((a, b) => Number(a) - Number(b)).map((l) => categories.find((c) => c.id === slots[l])?.name).filter(Boolean);
      // SKU like the item master's: BASE-XXL-RED (base = the code all variants share), else the next free code
      const abbr = (text) => { const c = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return /^\d+$/.test(c) ? c.slice(0, 4) : c.slice(0, 3) || 'X'; };
      const shared = commonCode(rows.map((row) => row.variant.sku)).replace(/-\*$/, '');
      let sku = shared && shared !== rows[0].variant.sku ? [shared, ...names.map(abbr)].join('-') : '';
      if (!sku || variants.some((v) => String(v.sku).toLowerCase() === sku.toLowerCase()) || reserved.has(sku.toLowerCase())) sku = await nextSku(req.companyId, parentName, reserved);
      reserved.add(sku.toLowerCase());
      const product = await createItem(req, {
        name: [parentName, ...names].join(' - ').slice(0, 160),
        categoryId: slots['1'] || template.product.category_id || '',
        brandId: template.product.brand_id || '',
        unitId: template.product.unit_id,
        hsnSac: template.product.hsn_sac || '',
        gstRate: template.product.gst_rate,
        trackingType: template.product.tracking_type,
        sku, barcode: '',
        mrp: template.variant.mrp, salePrice: template.variant.sale_price, costPrice: template.variant.cost_price, minStock: template.variant.min_stock,
        openingStock: 0,
        profile: { ...template.profile, slots, matrix: Object.keys(slots), upc: '', extraCodes: [], source: { method: 'matrix-value', at: new Date().toISOString() } },
      });
      created.push({ id: product.id, name: product.name, sku });
    }
    const item = (await pickerItems(req)).find((row) => row.key === `g:${groupId}`) || null;
    res.status(201).json({ category: { id: category.id, name: category.name, level }, created, item });
  }));

  async function pickerItems(req) {
    const products = (await store.find('products', { company_id: req.companyId })).filter((row) => on(row.is_active)).sort((a, b) => a.name.localeCompare(b.name));
    const variants = (await store.find('variants', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const units = await store.find('units', { company_id: req.companyId });
    const meta = await catalogueMeta(store, req.companyId);
    const unitsOf = await unitResolver(store, req.companyId);
    const items = [];
    const groups = new Map();
    for (const product of products) {
      const own = variants.filter((row) => row.product_id === product.id);
      if (!own.length) continue;
      const profile = meta.profiles[product.id] || {};
      const unit = units.find((row) => row.id === product.unit_id);
      const choice = unitsOf(product, profile);
      const itemType = typeFromItem({ profile, trackingType: product.tracking_type, isService: on(product.is_service) });
      // child item: its stock is the parent's (sold / returned qty × parentQty)
      let child = null;
      if (itemType === 'child' && profile.parentId) {
        const parentProduct = products.find((row) => row.id === profile.parentId);
        const parentVariant = variants.find((row) => row.product_id === profile.parentId);
        if (parentProduct && parentVariant) child = { productId: parentProduct.id, variantId: parentVariant.id, name: parentProduct.name, sku: parentVariant.sku, ratio: Number(profile.parentQty) > 0 ? Number(profile.parentQty) : 1, unit: units.find((row) => row.id === parentProduct.unit_id)?.code || '' };
      }
      const extra = { itemType, ...(choice ? { units: choice.units, unitUse: choice.unitUse, conversionId: choice.conversionId } : {}), ...(child ? { child } : {}), ...(typeOf(itemType).service ? { stockless: true } : {}) };
      const shaped = own.map((variant) => ({
        variantId: variant.id,
        productId: product.id,
        sku: variant.sku,
        name: product.name,
        barcode: variant.barcode || '',
        mrp: variant.mrp || '',
        salePrice: variant.sale_price || '',
        costPrice: variant.cost_price || '',
        ...(profile.kind === 'matrix' ? { attrs: { ...(profile.slots || {}) } } : {}),
      }));
      const eans = [...new Set([profile.upc, ...(Array.isArray(profile.extraCodes) ? profile.extraCodes : [])].filter(Boolean).map(String))];
      const codes = [...own.map((row) => row.sku), ...own.map((row) => row.barcode), profile.upc, profile.customBarcode, ...eans].filter(Boolean).map(String);
      const gst = Number(product.gst_rate) || 0;
      const expiry = profile.expiry?.enabled && product.tracking_type !== 'serial' ? cleanExpiry(profile.expiry) : null;
      if (expiry && cleanBatchRule(profile.batch || {}).auto) { expiry.batchMandatory = false; expiry.autoBatch = true; }
      if (product.tracking_type === 'serial') {
        items.push({ key: `p:${product.id}`, kind: 'serial', code: own[0].sku, name: product.name, unit: unit?.code || '', gst, codes, eans, productId: product.id, variants: shaped, categoryId: product.category_id || '', brandId: product.brand_id || '', itemType });
      } else if (profile.kind === 'matrix' && profile.group) {
        const group = groups.get(profile.group) || { key: `g:${profile.group}`, kind: 'matrix', name: profile.parent || product.name, unit: unit?.code || '', gst, codes: [], eans: [], productId: product.id, variants: [], categoryId: product.category_id || '', brandId: product.brand_id || '', itemType: 'matrix', ...(choice ? { units: choice.units, unitUse: choice.unitUse, conversionId: choice.conversionId } : {}) };
        // every variant of the group must share the conversion, else entry stays in the base unit
        if (group.conversionId && group.conversionId !== choice?.conversionId) { delete group.units; delete group.unitUse; group.conversionId = 'mixed'; }
        group.codes.push(...codes);
        group.eans.push(...eans.filter((code) => !group.eans.includes(code)));
        group.variants.push(...shaped);
        groups.set(profile.group, group);
      } else {
        items.push({ key: `p:${product.id}`, kind: 'standard', code: own[0].sku, name: product.name, unit: unit?.code || '', gst, expiry, codes, eans, productId: product.id, variants: shaped, categoryId: product.category_id || '', brandId: product.brand_id || '', ...extra });
      }
    }
    const categoryRows = groups.size ? await store.find('categories', { company_id: req.companyId }) : [];
    for (const [groupId, group] of groups) {
      group.variants.sort((a, b) => a.sku.localeCompare(b.sku));
      const { conversionId, ...rest } = group;
      items.push({ ...rest, groupId, dims: matrixDims(group.variants, meta, categoryRows), ...(conversionId && conversionId !== 'mixed' ? { conversionId } : {}), code: commonCode(group.variants.map((row) => row.sku)) });
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    return items;
  }

  // ---------- UPC / EAN codes of an item (one item can carry several pack codes) ----------
  app.post('/api/catalogue/codes', auth, allowEither([['catalogue.manage', 'catalogue'], ['purchase.view', 'purchase'], ['stock.adjust', 'stock']]), route(async (req, res) => {
    const productId = String(req.body?.productId || '');
    const code = cleanCode(req.body?.code);
    if (!code || code.length < 6) return fail(res, 400, 'INVALID', 'Enter the full UPC / EAN / ISBN code (at least 6 characters).');
    const [product] = await store.find('products', { id: productId });
    if (!product || product.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Item not found.');
    const meta = await catalogueMeta(store, req.companyId);
    const keys = classify(code).keys;
    const sameCode = (other) => other && (cleanCode(other) === code || classify(cleanCode(other)).keys.some((key) => keys.includes(key)));
    const variants = await store.find('variants', { company_id: req.companyId });
    const products = await store.find('products', { company_id: req.companyId });
    const nameOf = (id) => products.find((row) => row.id === id)?.name || 'another item';
    const clash = variants.find((row) => sameCode(row.sku) || sameCode(row.barcode));
    if (clash) return fail(res, 409, 'DUPLICATE', `${code} is already used by ${nameOf(clash.product_id)} (${clash.sku}).`);
    if (await lots.codeInUse(req.companyId, code)) return fail(res, 409, 'DUPLICATE', `${code} is a stock barcode already given to an inward entry.`);
    for (const [id, profile] of Object.entries(meta.profiles)) {
      if (!profile) continue;
      if (sameCode(profile.upc) || sameCode(profile.customBarcode) || (profile.extraCodes || []).some(sameCode)) {
        return fail(res, 409, 'DUPLICATE', id === product.id ? `${code} is already on this item.` : `${code} is already used by ${nameOf(id)}.`);
      }
    }
    const profile = meta.profiles[product.id] || {};
    const next = { ...profile };
    if (!next.upc) next.upc = code; else next.extraCodes = [...(Array.isArray(profile.extraCodes) ? profile.extraCodes : []), code].slice(0, 30);
    await writeSetting(store, req.companyId, `item_profile_${product.id}`, JSON.stringify(next));
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'catalogue.code.add', entity: 'product', entity_id: product.id, created_at: new Date().toISOString() });
    res.status(201).json({ code, eans: [next.upc, ...(next.extraCodes || [])].filter(Boolean) });
  }));

  // ---------- stock information for the outward item windows (batches, age, last purchase) ----------
  app.get('/api/stock/info/:variantId', auth, allowEither([['stock.view', 'stock'], ['sales.view', 'sales'], ['purchase.view', 'purchase']]), route(async (req, res) => {
    const locationId = String(req.query.locationId || '');
    if (locationId && !locationAllowed(req.session, locationId)) return fail(res, 403, 'PERMISSION_DENIED', 'That location is outside your access.');
    const [variant] = await store.find('variants', { id: req.params.variantId });
    if (!variant || variant.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Item not found.');
    const at = (row) => !locationId || row.location_id === locationId;
    const [level] = (await store.find('stock_levels', { company_id: req.companyId, variant_id: variant.id })).filter(at);
    const moves = (await store.find('stock_movements', { company_id: req.companyId, variant_id: variant.id })).filter(at).filter((row) => Number(row.qty) > 0).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const batches = (await store.find('batches', { company_id: req.companyId, variant_id: variant.id })).filter(at).filter((row) => Number(row.qty) > 0)
      .sort((a, b) => String(a.expiry_date || '9999').localeCompare(String(b.expiry_date || '9999')))
      .map((row) => ({ batchNo: row.batch_no, mfgDate: row.mfg_date || '', expiryDate: row.expiry_date || '', qty: Number(row.qty), receivedAt: row.created_at || '', source: row.source || '' }));
    // last purchase rate from purchase documents
    let lastPurchase = null;
    for (const doc of (await store.find('documents', { company_id: req.companyId })).filter((row) => row.module === 'purchase' && row.doc_type !== 'order').sort((a, b) => String(b.doc_date).localeCompare(String(a.doc_date)))) {
      let data = {}; try { data = JSON.parse(doc.data || '{}'); } catch { data = {}; }
      const line = (data.lines || []).find((l) => (l.variants || []).some((v) => v.variantId === variant.id && Number(v.qty) > 0) || l.serials?.variantId === variant.id);
      if (!line) continue;
      const v = (line.variants || []).find((x) => x.variantId === variant.id) || {};
      lastPurchase = { number: doc.number, date: doc.doc_date, rate: Number(v.rate ?? line.serials?.rows?.[0]?.costPrice ?? 0), landing: Number(v.landing ?? 0), supplier: doc.party_name || '' };
      break;
    }
    res.json({
      onHand: Number(level?.qty_on_hand || 0), cost: Number(variant.cost_price || 0), mrp: Number(variant.mrp || 0), sale: Number(variant.sale_price || 0),
      firstIn: moves[0]?.created_at || '', lastIn: moves[moves.length - 1]?.created_at || '', batches, lastPurchase,
    });
  }));

  // Items for Print Barcodes (all item types, with barcode, prices and expiry settings).
  app.get('/api/barcodes/items', auth, allow('catalogue.view', 'catalogue'), route(async (req, res) => {
    const locations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active)).map((row) => ({ id: row.id, name: row.name }));
    res.json({ items: await pickerItems(req), locations, shop: req.session.tenant.name });
  }));

  // Print Barcodes → batch / stock barcode choice: every lot in stock with how many labels were printed before.
  // Table label_prints: company_id, barcode, variant_id, qty, user_name, printed_at.
  app.get('/api/barcodes/lots/:variantId', auth, allow('catalogue.view', 'catalogue'), route(async (req, res) => {
    const result = await lots.listLots(req, { variantId: req.params.variantId, locationId: '' });
    if (!result) return fail(res, 404, 'NOT_FOUND', 'Item not found.');
    const locations = await store.find('locations', { company_id: req.companyId });
    const prints = (await store.find('label_prints', { company_id: req.companyId, variant_id: req.params.variantId }));
    const printed = {};
    for (const row of prints) printed[row.barcode] = (printed[row.barcode] || 0) + (Number(row.qty) || 0);
    const items = result.items.filter((row) => locationAllowed(req.session, row.locationId)).map((row) => ({ ...row, locationName: locations.find((l) => l.id === row.locationId)?.name || '', printed: printed[row.barcode] || 0 }));
    res.json({ serial: result.serial, items, printed });
  }));
  // Matrix item: every combination's stock barcodes (lots) and stock in one call.
  app.post('/api/barcodes/lots', auth, allow('catalogue.view', 'catalogue'), route(async (req, res) => {
    const ids = [...new Set((Array.isArray(req.body?.variantIds) ? req.body.variantIds : []).map(String))].slice(0, 500);
    const locations = await store.find('locations', { company_id: req.companyId });
    const prints = await store.find('label_prints', { company_id: req.companyId });
    const levels = await store.find('stock_levels', { company_id: req.companyId });
    const out = {};
    for (const id of ids) {
      const result = await lots.listLots(req, { variantId: id, locationId: '' });
      if (!result) continue;
      const printed = {};
      for (const row of prints) if (row.variant_id === id) printed[row.barcode] = (printed[row.barcode] || 0) + (Number(row.qty) || 0);
      const stock = levels.filter((row) => row.variant_id === id && locationAllowed(req.session, row.location_id)).reduce((sum, row) => sum + (Number(row.qty_on_hand) || 0), 0);
      out[id] = { serial: result.serial, stock, items: result.items.filter((row) => locationAllowed(req.session, row.locationId)).map((row) => ({ ...row, locationName: locations.find((l) => l.id === row.locationId)?.name || '', printed: printed[row.barcode] || 0 })) };
    }
    res.json({ variants: out });
  }));
  app.post('/api/barcodes/printed', auth, allow('catalogue.view', 'catalogue'), route(async (req, res) => {
    const rows = (Array.isArray(req.body?.rows) ? req.body.rows : []).slice(0, 2000);
    const at = new Date().toISOString();
    let saved = 0;
    for (const row of rows) {
      const barcode = String(row?.barcode || '').trim().slice(0, 60);
      const count = Math.floor(Number(row?.qty) || 0);
      if (!barcode || !(count > 0)) continue;
      await store.insert('label_prints', { company_id: req.companyId, barcode, variant_id: String(row.variantId || ''), qty: String(count), user_name: req.session.user.name || '', printed_at: at });
      saved += 1;
    }
    res.json({ saved });
  }));

  app.get('/api/stock/opening-items', auth, allow('stock.adjust', 'stock'), route(async (req, res) => {
    const items = await pickerItems(req);
    const locations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active)).map((row) => ({ id: row.id, name: row.name }));
    res.json({ items, locations, nextNumber: await nextOpeningNumber(req.companyId) });
  }));

  app.get('/api/stock/opening-entries', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const rows = (await openingMovements(req.companyId)).filter((row) => locationAllowed(req.session, row.location_id));
    const locations = await store.find('locations', { company_id: req.companyId });
    const variants = await store.find('variants', { company_id: req.companyId });
    const entries = new Map();
    for (const row of rows) {
      const number = String(row.note).match(OSE_NO)[0];
      const found = entries.get(number);
      const entry = found || { number, createdAt: row.created_at, locationName: locations.find((item) => item.id === row.location_id)?.name || '', note: String(row.note).slice(number.length).split(' — ')[0].replace(/^\s*·\s*/, ''), lines: 0, totalQty: 0, totalValue: 0 };
      const variant = variants.find((item) => item.id === row.variant_id);
      entry.lines += 1;
      entry.totalQty += Number(row.qty);
      entry.totalValue += Number(row.qty) * Number(variant?.cost_price || 0);
      if (String(row.created_at) < String(entry.createdAt)) entry.createdAt = row.created_at;
      entries.set(number, entry);
    }
    const items = [...entries.values()].sort((a, b) => b.number.localeCompare(a.number)).map((entry) => ({ ...entry, totalQty: qty(entry.totalQty), totalValue: entry.totalValue.toFixed(2) }));
    res.json({ items });
  }));

  app.get('/api/stock/opening-entries/:number', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const number = String(req.params.number).toUpperCase();
    const rows = (await openingMovements(req.companyId)).filter((row) => String(row.note).match(OSE_NO)[0] === number && locationAllowed(req.session, row.location_id));
    if (!rows.length) return fail(res, 404, 'NOT_FOUND', 'Opening stock entry not found.');
    const locations = await store.find('locations', { company_id: req.companyId });
    const variants = await store.find('variants', { company_id: req.companyId });
    const products = await store.find('products', { company_id: req.companyId });
    // Stock barcodes made by this entry (one per line, per batch, per serial unit).
    // Entries saved before stock barcodes existed show the “Existing stock” barcode that now holds that stock.
    for (const row of rows) {
      const product = products.find((item) => item.id === variants.find((v) => v.id === row.variant_id)?.product_id);
      if (product?.tracking_type === 'serial') await lots.serialBarcodes(req, { variantId: row.variant_id, locationId: row.location_id });
    }
    const openingSerials = await store.find('serials', { company_id: req.companyId });
    const madeLots = await store.find('stock_lots', { company_id: req.companyId, source_no: number });
    const lotView = (lot, older) => ({ barcode: lot.barcode, qtyIn: Number(lot.qty_in || lot.qty || 0), qty: Number(lot.qty || 0), batchNo: lot.batch_no || '', expiryDate: lot.expiry_date || '', older });
    const given = new Set();
    const barcodesFor = async (row, serialRows) => {
      if (serialRows) return serialRows.map((item) => ({ barcode: item.barcode || '', serial: item.serial1, qtyIn: 1, qty: item.status === 'in_stock' ? 1 : 0, sold: item.status !== 'in_stock' }));
      const key = `${row.variant_id}|${row.location_id}`;
      if (given.has(key)) return [];
      given.add(key);
      const own = madeLots.filter((lot) => lot.variant_id === row.variant_id && lot.location_id === row.location_id);
      if (own.length) return own.map((lot) => lotView(lot, false));
      await lots.reconcile(req, row.variant_id, row.location_id);
      return (await store.find('stock_lots', { company_id: req.companyId, variant_id: row.variant_id, location_id: row.location_id }))
        .filter((lot) => lot.source_no === 'Existing stock' && Number(lot.qty) > 0).map((lot) => lotView(lot, true));
    };
    const lines = [];
    for (const row of rows) {
      const variant = variants.find((item) => item.id === row.variant_id);
      const product = products.find((item) => item.id === variant?.product_id);
      const serialRecords = product?.tracking_type === 'serial'
        ? openingSerials.filter((item) => item.variant_id === row.variant_id && (item.source_no ? item.source_no === number : item.location_id === row.location_id && Math.abs(new Date(item.created_at) - new Date(row.created_at)) < 5000))
        : null;
      const serialRows = serialRecords ? serialRecords.map((item) => item.serial1) : [];
      lines.push({
        id: row.id,
        variantId: row.variant_id,
        serials: serialRows,
        sku: variant?.sku || '',
        name: product?.name || '',
        serial: product?.tracking_type === 'serial',
        qty: row.qty,
        costPrice: variant?.cost_price || '',
        value: (Number(row.qty) * Number(variant?.cost_price || 0)).toFixed(2),
        detail: String(row.note).split(' — ')[1] || '',
        barcodes: await barcodesFor(row, serialRecords),
      });
    }
    res.json({ number, createdAt: rows[0].created_at, locationName: locations.find((item) => item.id === rows[0].location_id)?.name || '', lines });
  }));

  app.post('/api/stock/opening-entries', auth, allow('stock.adjust', 'stock'), route(async (req, res) => {
    const body = req.body ?? {};
    const location = await stockLocation(req, body.locationId);
    if (!location) return fail(res, 400, 'INVALID', 'Choose a location you have access to.');
    const note = String(body.note || '').trim().slice(0, 120);
    const all = await store.find('variants', { company_id: req.companyId });
    const products = await store.find('products', { company_id: req.companyId });
    const findVariant = (id) => all.find((row) => row.id === String(id || '') && on(row.is_active));

    const plain = [];
    for (const [index, line] of (Array.isArray(body.lines) ? body.lines : []).entries()) {
      const variant = findVariant(line?.variantId);
      if (!variant) return fail(res, 400, 'INVALID', `Line ${index + 1}: item not found.`);
      const product = products.find((row) => row.id === variant.product_id);
      if (product?.tracking_type === 'serial') return fail(res, 400, 'INVALID', `${product.name} needs serial numbers.`);
      const blocked = await childBlock(req, variant.id);
      if (blocked) return fail(res, 400, 'INVALID', blocked);
      const amount = Number(line.qty);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      for (const field of ['costPrice', 'mrp', 'salePrice']) {
        if (line[field] !== '' && line[field] != null && !(Number(line[field]) >= 0)) return fail(res, 400, 'INVALID', `${variant.sku}: ${field === 'costPrice' ? 'cost' : field === 'mrp' ? 'MRP' : 'selling price'} must be a number.`);
      }
      const expiry = await expiryOf(req, variant.id);
      if (expiry) {
        const batches = Array.isArray(line.batches) ? line.batches : [];
        const problem = checkBatches(batches, expiry, variant.sku);
        if (problem) return fail(res, 400, 'INVALID', problem);
        const total = batches.reduce((sum, row) => sum + (Number(row.qty) || 0), 0);
        if (Math.abs(total - amount) > 0.0001) return fail(res, 400, 'INVALID', `${variant.sku}: batch quantities (${total}) do not add up to ${amount}.`);
        await fillBatchNos(req, variant.id, batches);
      }
      plain.push({ variant, amount, line: { ...line, batches: expiry ? line.batches : null } });
    }

    const serialSets = [];
    const seen = new Set();
    for (const set of Array.isArray(body.serialLines) ? body.serialLines : []) {
      const variant = findVariant(set?.variantId);
      if (!variant) return fail(res, 400, 'INVALID', 'A serialised item was not found.');
      const rows = (Array.isArray(set.rows) ? set.rows : []).filter((row) => String(row?.serial1 || '').trim() || String(row?.serial2 || '').trim());
      if (!rows.length) continue;
      for (const row of rows) {
        for (const code of [row.serial1, row.serial2].map(serialKey).filter(Boolean)) {
          if (seen.has(code)) return fail(res, 400, 'INVALID', `Serial ${code} is entered twice in this entry.`);
          seen.add(code);
        }
      }
      const check = await receiveSerials(req, { variant, location, rows, dryRun: true });
      if (check.error) return fail(res, 400, 'INVALID', `${variant.sku}: ${check.error}`);
      serialSets.push({ variant, rows });
    }
    if (!plain.length && !serialSets.length) return fail(res, 400, 'INVALID', 'Add at least one item with a quantity.');

    const number = await nextOpeningNumber(req.companyId);
    const tag = note ? `${number} · ${note}` : number;
    for (const { variant, amount, line } of plain) {
      const prices = {};
      if (line.costPrice !== '' && line.costPrice != null && money(line.costPrice) !== money(variant.cost_price)) prices.cost_price = money(line.costPrice);
      if (line.mrp !== '' && line.mrp != null && money(line.mrp) !== money(variant.mrp)) prices.mrp = money(line.mrp);
      if (line.salePrice !== '' && line.salePrice != null && money(line.salePrice) !== money(variant.sale_price)) prices.sale_price = money(line.salePrice);
      if (Object.keys(prices).length) await store.update('variants', variant.id, prices);
      const price = { mrp: line.mrp, salePrice: line.salePrice, costPrice: line.costPrice };
      const given = !line.batches && isStockBarcode(line.stockBarcode) ? { lots: [{ qty: amount, barcode: String(line.stockBarcode).trim() }] } : {};
      await changeStock(req, { locationId: location.id, variantId: variant.id, delta: amount, reason: 'opening', type: 'opening', note: tag, price, source: number, ...given });
      if (line.batches) await addBatches(req, { variantId: variant.id, locationId: location.id, rows: line.batches, source: number, price, sourceType: 'opening' });
    }
    let serialCount = 0;
    for (const { variant, rows } of serialSets) {
      const result = await receiveSerials(req, { variant, location, rows, reason: 'opening', source: number, note: `${tag} — ${rows.length} serial number${rows.length === 1 ? '' : 's'}: ${rows.slice(0, 5).map((row) => String(row.serial1).trim()).join(', ')}${rows.length > 5 ? '…' : ''}` });
      serialCount += result.count || 0;
    }
    res.status(201).json({ number, lines: plain.length + serialSets.length, serials: serialCount });
  }));

  // ---------- price updates (PU-0001, PU-0002 …) ----------
  // Table price_updates: company_id, number, note, data (JSON: lines with old and new prices), user_name, created_at
  const PRICE_FIELDS = [['mrp', 'mrp', 'MRP'], ['salePrice', 'sale_price', 'Selling price'], ['costPrice', 'cost_price', 'Cost price']];

  function priceUpdateNumber(rows) {
    let max = 0;
    for (const row of rows) {
      const match = String(row.number || '').match(/^PU-(\d+)$/);
      if (match) max = Math.max(max, Number(match[1]));
    }
    return `PU-${String(max + 1).padStart(4, '0')}`;
  }

  function shapePriceUpdate(row) {
    let data = {};
    try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
    const lines = data.lines || [];
    return {
      number: row.number,
      note: row.note || '',
      createdAt: row.created_at,
      userName: row.user_name || '',
      items: lines.filter((line) => !line.serialId).length,
      serials: lines.filter((line) => line.serialId).length,
      increases: lines.reduce((sum, line) => sum + PRICE_FIELDS.filter(([key]) => line[key] && Number(line[key].to) > Number(line[key].from || 0)).length, 0),
      decreases: lines.reduce((sum, line) => sum + PRICE_FIELDS.filter(([key]) => line[key] && Number(line[key].to) < Number(line[key].from || 0)).length, 0),
      lines,
    };
  }

  // New prices: '' or missing = keep; otherwise a number >= 0. Selling price cannot be above MRP.
  function priceChanges(current, incoming, label) {
    const next = {};
    const changes = {};
    for (const [key, column, name] of PRICE_FIELDS) {
      const value = incoming?.[key];
      if (value === '' || value == null) continue;
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) return { error: `${label}: ${name} must be a number.` };
      const fixed = n.toFixed(2);
      if (fixed !== money(current[column])) { next[column] = fixed; changes[key] = { from: money(current[column]), to: fixed }; }
    }
    const mrp = Number(next.mrp ?? current.mrp);
    const sale = Number(next.sale_price ?? current.sale_price);
    if (mrp > 0 && sale > mrp) return { error: `${label}: selling price ${sale.toFixed(2)} is above the MRP ${mrp.toFixed(2)}.` };
    return { next, changes };
  }

  app.get('/api/price-updates/items', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const rows = await store.find('price_updates', { company_id: req.companyId });
    res.json({ items: await pickerItems(req), nextNumber: priceUpdateNumber(rows) });
  }));

  app.get('/api/price-updates/serials/:variantId', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const locations = await store.find('locations', { company_id: req.companyId });
    const rows = (await store.find('serials', { company_id: req.companyId, variant_id: req.params.variantId }))
      .filter((row) => row.status === 'in_stock' && locationAllowed(req.session, row.location_id));
    res.json({ items: rows.map((row) => ({ id: row.id, serial1: row.serial1, serial2: row.serial2 || '', attr1: row.attr1 || '', attr2: row.attr2 || '', attr3: row.attr3 || '', mrp: row.mrp || '', salePrice: row.sale_price || '', costPrice: row.cost_price || '', locationName: locations.find((item) => item.id === row.location_id)?.name || '' })) });
  }));

  app.get('/api/price-updates', auth, allow('catalogue.view', 'catalogue'), route(async (req, res) => {
    const rows = await store.find('price_updates', { company_id: req.companyId });
    res.json({ items: rows.map(shapePriceUpdate).map(({ lines, ...row }) => row).sort((a, b) => b.number.localeCompare(a.number)) });
  }));

  app.get('/api/price-updates/:number', auth, allow('catalogue.view', 'catalogue'), route(async (req, res) => {
    const [row] = (await store.find('price_updates', { company_id: req.companyId })).filter((item) => item.number === String(req.params.number).toUpperCase());
    if (!row) return fail(res, 404, 'NOT_FOUND', 'Price update not found.');
    res.json(shapePriceUpdate(row));
  }));

  app.post('/api/price-updates', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const body = req.body ?? {};
    const variants = await store.find('variants', { company_id: req.companyId });
    const products = await store.find('products', { company_id: req.companyId });
    const serials = await store.find('serials', { company_id: req.companyId });
    const planned = [];
    for (const line of Array.isArray(body.lines) ? body.lines : []) {
      const variant = variants.find((row) => row.id === String(line?.variantId || ''));
      if (!variant) return fail(res, 400, 'INVALID', 'An item in the list was not found.');
      const product = products.find((row) => row.id === variant.product_id);
      const result = priceChanges(variant, line, variant.sku);
      if (result.error) return fail(res, 400, 'INVALID', result.error);
      if (Object.keys(result.next).length) planned.push({ table: 'variants', row: variant, next: result.next, log: { variantId: variant.id, sku: variant.sku, name: product?.name || '', ...result.changes } });
    }
    for (const line of Array.isArray(body.serialLines) ? body.serialLines : []) {
      const serial = serials.find((row) => row.id === String(line?.serialId || ''));
      if (!serial || serial.status !== 'in_stock') return fail(res, 400, 'INVALID', 'A serial number in the list is no longer in stock.');
      if (!locationAllowed(req.session, serial.location_id)) return fail(res, 403, 'PERMISSION_DENIED', 'A serial number is at a location outside your access.');
      const variant = variants.find((row) => row.id === serial.variant_id);
      const product = products.find((row) => row.id === variant?.product_id);
      const result = priceChanges(serial, line, `Serial ${serial.serial1}`);
      if (result.error) return fail(res, 400, 'INVALID', result.error);
      if (Object.keys(result.next).length) planned.push({ table: 'serials', row: serial, next: result.next, log: { variantId: serial.variant_id, serialId: serial.id, serial: serial.serial1, sku: variant?.sku || '', name: product?.name || '', ...result.changes } });
    }
    if (!planned.length) return fail(res, 400, 'INVALID', 'No price was changed. Change at least one MRP, selling or cost price.');
    for (const item of planned) await store.update(item.table, item.row.id, item.next);
    const existing = await store.find('price_updates', { company_id: req.companyId });
    const number = priceUpdateNumber(existing);
    await store.insert('price_updates', {
      company_id: req.companyId,
      number,
      note: String(body.note || '').trim().slice(0, 120),
      data: JSON.stringify({ lines: planned.map((item) => item.log) }),
      user_name: req.session.user.name || '',
      created_at: new Date().toISOString(),
    });
    await store.insert('audit_logs', { company_id: req.companyId, user_id: req.session.user.id, action: 'price.update', entity: 'price_update', entity_id: number, created_at: new Date().toISOString() });
    res.status(201).json({ number, items: planned.filter((item) => item.table === 'variants').length, serials: planned.filter((item) => item.table === 'serials').length });
  }));

  // ---------- inventory dashboard (all locations or one) ----------
  app.get('/api/dashboard/inventory', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const allLocations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active));
    const pick = String(req.query.locationId || '');
    const locations = pick ? allLocations.filter((row) => row.id === pick) : allLocations;
    const locationIds = new Set(locations.map((row) => row.id));
    const products = await store.find('products', { company_id: req.companyId });
    const variants = (await store.find('variants', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const categories = await store.find('categories', { company_id: req.companyId });
    const levels = (await store.find('stock_levels', { company_id: req.companyId })).filter((row) => locationIds.has(row.location_id));
    const movements = (await store.find('stock_movements', { company_id: req.companyId })).filter((row) => locationIds.has(row.location_id));
    const n = (value) => Number(value) || 0;
    const round = (value) => Math.round(value * 100) / 100;

    const items = [];
    const alertProfiles = await catalogueMeta(store, req.companyId);
    for (const variant of variants) {
      const product = products.find((row) => row.id === variant.product_id);
      if (!product || !on(product.is_active)) continue;
      items.push({
        variantId: variant.id, sku: variant.sku, name: product.name,
        category: categories.find((row) => row.id === product.category_id)?.name || 'Uncategorised',
        cost: n(variant.cost_price), sale: n(variant.sale_price), mrp: n(variant.mrp), min: n(variant.min_stock),
        tracking: product.tracking_type || 'none', profile: alertProfiles.profiles[product.id] || {},
      });
    }
    const qtyAt = (variantId, locationId) => n(levels.find((row) => row.variant_id === variantId && row.location_id === locationId)?.qty_on_hand);

    // per item × location (min = that location's reorder level, 0 when its reorder alert is off)
    const cells = [];
    for (const item of items) for (const location of locations) cells.push({ item, location, qty: qtyAt(item.variantId, location.id), min: alertLevelAt(item.profile, item.min, location.id) });
    const totalOf = (item) => cells.filter((cell) => cell.item === item).reduce((sum, cell) => sum + cell.qty, 0);

    let units = 0; let costValue = 0; let retailValue = 0; let mrpValue = 0;
    for (const cell of cells) {
      if (cell.qty <= 0) continue;
      units += cell.qty;
      costValue += cell.qty * cell.item.cost;
      retailValue += cell.qty * cell.item.sale;
      mrpValue += cell.qty * cell.item.mrp;
    }
    const inStock = items.filter((item) => totalOf(item) > 0);
    const outOfStock = items.filter((item) => totalOf(item) <= 0);
    const low = cells.filter((cell) => cell.min > 0 && cell.qty > 0 && cell.qty <= cell.min);
    const empty = cells.filter((cell) => cell.min > 0 && cell.qty <= 0);

    const byLocation = allLocations.filter((row) => !pick || row.id === pick).map((location) => {
      const own = cells.filter((cell) => cell.location.id === location.id);
      const value = own.reduce((sum, cell) => sum + Math.max(cell.qty, 0) * cell.item.cost, 0);
      return {
        id: location.id, name: location.name, kind: location.kind || '',
        skus: own.filter((cell) => cell.qty > 0).length,
        units: own.reduce((sum, cell) => sum + Math.max(cell.qty, 0), 0),
        value: round(value),
        retail: round(own.reduce((sum, cell) => sum + Math.max(cell.qty, 0) * cell.item.sale, 0)),
        low: own.filter((cell) => cell.min > 0 && cell.qty > 0 && cell.qty <= cell.min).length,
        out: own.filter((cell) => cell.min > 0 && cell.qty <= 0).length,
      };
    });

    const catMap = new Map();
    for (const cell of cells) if (cell.qty > 0) catMap.set(cell.item.category, (catMap.get(cell.item.category) || 0) + cell.qty * cell.item.cost);
    let byCategory = [...catMap].map(([name, value]) => ({ name, value: round(value) })).sort((a, b) => b.value - a.value);
    if (byCategory.length > 8) {
      const rest = byCategory.slice(7).reduce((sum, row) => sum + row.value, 0);
      byCategory = [...byCategory.slice(0, 7), { name: 'Other', value: round(rest) }];
    }

    // movement trend for the period
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(today); start.setDate(start.getDate() - (days - 1));
    const key = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const trend = [];
    for (let i = 0; i < days; i += 1) { const date = new Date(start); date.setDate(start.getDate() + i); trend.push({ date: key(date), in: 0, out: 0 }); }
    const reasons = new Map();
    const recentOut = new Set();
    for (const row of movements) {
      const when = new Date(row.created_at);
      if (Number.isNaN(when.getTime()) || when < start) continue;
      const slot = trend.find((entry) => entry.date === key(when));
      const qty = n(row.qty);
      if (slot) { if (qty >= 0) slot.in += qty; else slot.out += -qty; }
      const reason = row.reason || row.movement_type || 'other';
      const entry = reasons.get(reason) || { reason, in: 0, out: 0, count: 0 };
      entry.count += 1;
      if (qty >= 0) entry.in += qty; else entry.out += -qty;
      reasons.set(reason, entry);
      if (qty < 0) recentOut.add(row.variant_id);
    }

    const top = inStock.map((item) => ({ sku: item.sku, name: item.name, category: item.category, qty: totalOf(item), value: round(totalOf(item) * item.cost) }))
      .sort((a, b) => b.value - a.value).slice(0, 8);
    const slow = inStock.filter((item) => !recentOut.has(item.variantId))
      .map((item) => ({ sku: item.sku, name: item.name, qty: totalOf(item), value: round(totalOf(item) * item.cost) }))
      .sort((a, b) => b.value - a.value);

    const reorder = [...empty, ...low].map((cell) => ({
      sku: cell.item.sku, name: cell.item.name, location: cell.location.name, qty: cell.qty, min: cell.min,
      status: cell.qty <= 0 ? 'out' : 'low', suggest: Math.max(cell.min * 2 - cell.qty, cell.min),
    })).sort((a, b) => (a.status === b.status ? a.qty / (a.min || 1) - b.qty / (b.min || 1) : a.status === 'out' ? -1 : 1));

    // Transfer suggestions: a location below minimum while another holds spare stock.
    const transfers = [];
    if (!pick) {
      for (const item of items) {
        if (!(item.min > 0) || item.tracking === 'serial') continue;
        const own = allLocations.map((location) => ({ location, qty: qtyAt(item.variantId, location.id) }));
        const needy = own.filter((row) => row.qty < item.min);
        const spare = own.filter((row) => row.qty > item.min * 1.5).map((row) => ({ ...row, free: Math.floor(row.qty - item.min) }));
        for (const need of needy) {
          const donor = spare.sort((a, b) => b.free - a.free)[0];
          if (!donor || donor.free <= 0) continue;
          const qty = Math.min(donor.free, Math.ceil(item.min * 2 - need.qty));
          if (qty <= 0) continue;
          donor.free -= qty;
          transfers.push({ sku: item.sku, name: item.name, from: donor.location.name, to: need.location.name, qty, toQty: need.qty, min: item.min });
        }
      }
    }

    // Distribution: top items by units across the locations
    const distribution = {
      locations: allLocations.filter((row) => !pick || row.id === pick).map((row) => ({ id: row.id, name: row.name })),
      items: inStock.map((item) => ({ sku: item.sku, name: item.name, total: totalOf(item), qty: Object.fromEntries(locations.map((location) => [location.id, qtyAt(item.variantId, location.id)])) }))
        .sort((a, b) => b.total - a.total).slice(0, 10),
    };

    const recent = movements.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 8).map((row) => {
      const variant = variants.find((item) => item.id === row.variant_id);
      const product = products.find((item) => item.id === variant?.product_id);
      return { id: row.id, at: row.created_at, sku: variant?.sku || '', name: product?.name || '', location: allLocations.find((item) => item.id === row.location_id)?.name || '', qty: n(row.qty), reason: row.reason || row.movement_type };
    });

    res.json({
      days,
      locations: allLocations.map((row) => ({ id: row.id, name: row.name })),
      kpis: {
        costValue: round(costValue), retailValue: round(retailValue), mrpValue: round(mrpValue), margin: round(retailValue - costValue),
        units: round(units), skus: items.length, skusInStock: inStock.length, outOfStock: outOfStock.length,
        lowRows: low.length, emptyRows: empty.length, locations: locations.length,
        periodIn: round(trend.reduce((sum, row) => sum + row.in, 0)), periodOut: round(trend.reduce((sum, row) => sum + row.out, 0)),
        slowCount: slow.length, slowValue: round(slow.reduce((sum, row) => sum + row.value, 0)),
      },
      byLocation, byCategory, trend, reasons: [...reasons.values()].sort((a, b) => b.count - a.count),
      top, slow: slow.slice(0, 6), reorder: reorder.slice(0, 12), reorderCount: reorder.length, transfers: transfers.slice(0, 8), distribution, recent,
    });
  }));

  // ---------- multi-location network dashboard ----------
  // One item × location matrix the dashboard filters in the browser (location, category, search),
  // plus each item's last outward movement for slow / non-moving analysis.
  function locationCodes(rows) {
    const used = new Map();
    const sorted = [...rows].sort((a, b) => String(a.created_at || a.id).localeCompare(String(b.created_at || b.id)));
    const codes = new Map();
    for (const row of sorted) {
      const word = String(row.name || 'LOC').replace(/[^A-Za-z ]/g, '').trim().split(/\s+/)[0] || 'LOC';
      const head = word.slice(0, 3).toUpperCase().padEnd(3, 'X');
      const kind = row.kind === 'warehouse' ? 'WH' : row.kind === 'service_bay' ? 'SB' : 'S';
      const base = `${head}-${kind}`;
      const next = (used.get(base) || 0) + 1;
      used.set(base, next);
      codes.set(row.id, `${base}${next}`);
    }
    return codes;
  }

  app.get('/api/dashboard/network', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    const from = isDay(req.query.from) ? new Date(`${req.query.from}T00:00:00`) : null;
    const locations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active));
    const ids = new Set(locations.map((row) => row.id));
    const codes = locationCodes(locations);
    const products = await store.find('products', { company_id: req.companyId });
    const variants = (await store.find('variants', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const categories = await store.find('categories', { company_id: req.companyId });
    const levels = (await store.find('stock_levels', { company_id: req.companyId })).filter((row) => ids.has(row.location_id));
    const movements = (await store.find('stock_movements', { company_id: req.companyId })).filter((row) => ids.has(row.location_id));
    const n = (value) => Number(value) || 0;
    const now = Date.now();
    const lastOut = new Map();
    const firstIn = new Map();
    const since = new Map();
    for (const row of movements) {
      const at = new Date(row.created_at).getTime();
      if (Number.isNaN(at)) continue;
      const qtyMoved = n(row.qty);
      if (qtyMoved < 0 && row.reason !== 'transfer') lastOut.set(row.variant_id, Math.max(lastOut.get(row.variant_id) || 0, at));
      if (qtyMoved > 0) firstIn.set(row.variant_id, Math.min(firstIn.get(row.variant_id) || Infinity, at));
      if (from && at >= from.getTime()) {
        const key = `${row.variant_id}|${row.location_id}`;
        since.set(key, (since.get(key) || 0) + qtyMoved);
      }
    }
    const day = (ms) => (ms ? new Date(ms).toISOString() : null);
    // FIFO aging: today's stock is assumed to be the most recent receipts at that location.
    const inwards = new Map();
    for (const row of movements) {
      const at = new Date(row.created_at).getTime();
      if (Number.isNaN(at) || !(n(row.qty) > 0)) continue;
      const key = `${row.variant_id}|${row.location_id}`;
      if (!inwards.has(key)) inwards.set(key, []);
      inwards.get(key).push({ at, qty: n(row.qty) });
    }
    const AGE_LIMITS = [30, 60, 90, 180];
    const ageOf = (variantId, locationId, onHandQty) => {
      const buckets = [0, 0, 0, 0, 0];
      let left = onHandQty;
      if (!(left > 0)) return buckets;
      for (const lot of (inwards.get(`${variantId}|${locationId}`) || []).sort((a, b) => b.at - a.at)) {
        const take = Math.min(left, lot.qty);
        const age = Math.floor((now - lot.at) / 86400000);
        const slot = AGE_LIMITS.findIndex((limit) => age <= limit);
        buckets[slot === -1 ? 4 : slot] += take;
        left -= take;
        if (left <= 0) break;
      }
      if (left > 0) buckets[4] += left;
      return buckets;
    };
    const items = [];
    for (const variant of variants) {
      const product = products.find((row) => row.id === variant.product_id);
      if (!product || !on(product.is_active)) continue;
      const stock = {};
      const moved = {};
      const aging = {};
      for (const location of locations) {
        stock[location.id] = n(levels.find((row) => row.variant_id === variant.id && row.location_id === location.id)?.qty_on_hand);
        if (stock[location.id] > 0) aging[location.id] = ageOf(variant.id, location.id, stock[location.id]);
        const delta = since.get(`${variant.id}|${location.id}`);
        if (delta) moved[location.id] = delta;
      }
      const out = lastOut.get(variant.id) || 0;
      const inward = Number.isFinite(firstIn.get(variant.id)) ? firstIn.get(variant.id) : 0;
      const idleFrom = out || inward;
      items.push({
        variantId: variant.id, sku: variant.sku, name: product.name,
        category: categories.find((row) => row.id === product.category_id)?.name || 'Uncategorised',
        cost: n(variant.cost_price), sale: n(variant.sale_price), mrp: n(variant.mrp), min: n(variant.min_stock),
        gst: n(product.gst_rate), tracking: product.tracking_type || 'none',
        stock, moved, aging, lastOut: day(out), idleDays: idleFrom ? Math.floor((now - idleFrom) / 86400000) : null,
      });
    }
    items.sort((a, b) => a.name.localeCompare(b.name) || a.sku.localeCompare(b.sku));

    // Upcoming expiry: batch-tracked items (from the item profile) and vehicle insurance / PUC dates.
    const settings = await store.find('settings', { company_id: req.companyId });
    let batchItems = 0;
    for (const row of settings) {
      if (!String(row.setting_key || '').startsWith('item_profile_')) continue;
      try { if (JSON.parse(row.setting_value)?.expiry?.enabled) batchItems += 1; } catch { /* ignore a broken profile */ }
    }
    const nowDay = new Date();
    const todayKey = `${nowDay.getFullYear()}-${String(nowDay.getMonth() + 1).padStart(2, '0')}-${String(nowDay.getDate()).padStart(2, '0')}`;
    const dayDiff = (value) => Math.round((new Date(`${value}T00:00:00Z`) - new Date(`${todayKey}T00:00:00Z`)) / 86400000);
    const vehicles = await store.find('vehicles', { company_id: req.companyId });
    const customers = vehicles.length ? await store.find('customers', { company_id: req.companyId }) : [];
    const expiring = [];
    for (const vehicle of vehicles) {
      for (const [kind, column] of [['Insurance', 'insurance_expiry'], ['PUC', 'puc_expiry']]) {
        const due = String(vehicle[column] || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) continue;
        const days = dayDiff(due);
        if (days < -30 || days > 60) continue;
        const customer = customers.find((row) => row.id === vehicle.customer_id);
        expiring.push({ id: `${vehicle.id}-${kind}`, kind, due, days, regNo: String(vehicle.reg_no || '').toUpperCase(), vehicle: [vehicle.make, vehicle.model].filter(Boolean).join(' '), customer: customer?.name || '', mobile: customer?.mobile || '' });
      }
    }
    // batches of expiry items still in stock
    const batchRows = (await store.find('batches', { company_id: req.companyId })).filter((row) => Number(row.qty) > 0 && ids.has(row.location_id));
    const expiryMeta = batchRows.length ? await catalogueMeta(store, req.companyId) : { profiles: {} };
    let batchCount = 0;
    for (const row of batchRows) {
      const due = String(row.expiry_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) continue;
      const variant = variants.find((item) => item.id === row.variant_id);
      const product = products.find((item) => item.id === variant?.product_id);
      if (!product) continue;
      const alert = Number(cleanExpiry(expiryMeta.profiles[product.id]?.expiry || {}).alertDays) || 30;
      const days = dayDiff(due);
      if (days > Math.max(alert, 60)) continue;
      batchCount += 1;
      expiring.push({ id: `b-${row.id}`, kind: days < 0 ? 'Expired' : 'Batch', due, days, regNo: product.name, vehicle: `Batch ${row.batch_no || '—'} · ${Number(row.qty)} in stock`, customer: locations.find((item) => item.id === row.location_id)?.name || '', mobile: variant.sku, batch: true });
    }
    expiring.sort((a, b) => a.days - b.days);

    // Open orders: vehicle job cards still in the workshop act as the sales-order book.
    const OPEN = ['checked_in', 'awaiting_approval', 'approved', 'in_progress', 'waiting_parts', 'qc', 'ready'];
    const openJobs = (await store.find('job_cards', { company_id: req.companyId })).filter((job) => ids.has(job.location_id) && OPEN.includes(job.status));
    const docs = (await store.find('documents', { company_id: req.companyId })).filter((row) => ids.has(row.location_id) && (row.status === 'Open' || String(row.status).startsWith('Partially')));
    const openDocs = (module, type) => {
      const own = docs.filter((row) => row.module === module && row.doc_type === type);
      return { count: own.length, value: Math.round(own.reduce((sum, row) => sum + n(row.total), 0) * 100) / 100, locations: Object.fromEntries(locations.map((loc) => [loc.id, own.filter((row) => row.location_id === loc.id).reduce((acc, row) => ({ count: acc.count + 1, value: acc.value + n(row.total) }), { count: 0, value: 0 })])) };
    };

    res.json({
      expiry: { batchItems, vehicles: expiring.slice(0, 30), vehicleCount: expiring.length, hasVehicles: vehicles.length > 0, batchCount },
      orders: { purchaseOrders: openDocs('purchase', 'order'), salesOrders: openDocs('sales', 'order'), quotations: openDocs('sales', 'quotation'), openJobs: openJobs.length, openJobValue: Math.round(openJobs.reduce((sum, job) => sum + n(job.grand_total), 0) * 100) / 100, locations: Object.fromEntries(locations.map((row) => [row.id, openJobs.filter((job) => job.location_id === row.id).reduce((acc, job) => ({ count: acc.count + 1, value: acc.value + n(job.grand_total) }), { count: 0, value: 0 })])) },
      locations: locations.map((row) => ({ id: row.id, name: row.name, kind: row.kind || 'store', code: codes.get(row.id) })),
      categories: [...new Set(items.map((item) => item.category))].sort(),
      items,
      canAdjust: req.session.user.permissions.includes('stock.adjust'),
      canPrice: req.session.user.permissions.includes('catalogue.manage'),
    });
  }));

  async function dashboardVariant(req, variantId) {
    const [variant] = await store.find('variants', { id: String(variantId || '') });
    if (!variant || variant.company_id !== req.companyId || !on(variant.is_active)) return { error: 'Item not found.' };
    const [product] = await store.find('products', { id: variant.product_id });
    if (product?.tracking_type === 'serial') return { error: `${product.name} is serial-tracked. Move it from Stock Update so the serial numbers move with it.` };
    return { variant, product };
  }
  const onHand = async (req, locationId, variantId) => Number((await store.find('stock_levels', { company_id: req.companyId, location_id: locationId, variant_id: variantId }))[0]?.qty_on_hand || 0);

  app.post('/api/dashboard/transfer', auth, allow('stock.adjust', 'stock'), route(async (req, res) => {
    const body = req.body ?? {};
    const amount = Number(body.qty);
    if (!Number.isFinite(amount) || amount <= 0) return fail(res, 400, 'INVALID', 'Enter a quantity above zero.');
    if (body.fromLocationId === body.toLocationId) return fail(res, 400, 'INVALID', 'Choose two different locations.');
    const source = await stockLocation(req, body.fromLocationId);
    const target = await stockLocation(req, body.toLocationId);
    if (!source || !target) return fail(res, 404, 'NOT_FOUND', 'Location not found or outside your access.');
    const found = await dashboardVariant(req, body.variantId);
    if (found.error) return fail(res, 400, 'INVALID', found.error);
    const available = await onHand(req, source.id, found.variant.id);
    if (available < amount) return fail(res, 400, 'NEGATIVE', `${source.name} has only ${qty(available)} in stock.`);
    const transfers = (await store.find('stock_movements', { company_id: req.companyId })).filter((row) => row.reason === 'transfer' && Number(row.qty) < 0);
    const number = `TR-${String(transfers.length + 101)}`;
    const out = await changeStock(req, { locationId: source.id, variantId: found.variant.id, delta: -amount, reason: 'transfer', type: 'transfer', note: `${number} to ${target.name}`, pick: Array.isArray(body.pick) ? body.pick : [] });
    // the same stock barcodes arrive at the target
    await changeStock(req, { locationId: target.id, variantId: found.variant.id, delta: amount, reason: 'transfer', type: 'transfer', note: `${number} from ${source.name}`, lots: out.lots, source: number });
    if (await expiryOf(req, found.variant.id)) {
      const moved = await consumeBatches(req, { variantId: found.variant.id, locationId: source.id, amount, prefer: out.lots });
      await addBatches(req, { variantId: found.variant.id, locationId: target.id, rows: moved, source: number, makeLots: false });
    }
    res.status(201).json({ number, qty: qty(amount), from: source.name, to: target.name });
  }));

  app.post('/api/dashboard/quick-sale', auth, allow('stock.adjust', 'stock'), route(async (req, res) => {
    const body = req.body ?? {};
    const location = await stockLocation(req, body.locationId);
    if (!location) return fail(res, 404, 'NOT_FOUND', 'Choose a billing outlet.');
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length) return fail(res, 400, 'INVALID', 'Add at least one item to the cart.');
    const planned = [];
    for (const line of lines) {
      const amount = Number(line?.qty);
      if (!Number.isFinite(amount) || amount <= 0) return fail(res, 400, 'INVALID', 'Every cart quantity must be above zero.');
      const found = await dashboardVariant(req, line.variantId);
      if (found.error) return fail(res, 400, 'INVALID', found.error);
      const available = await onHand(req, location.id, found.variant.id);
      if (available < amount) return fail(res, 400, 'NEGATIVE', `${found.product?.name || found.variant.sku}: only ${qty(available)} in stock at ${location.name}.`);
      planned.push({ ...found, amount });
    }
    const customer = String(body.customer || '').trim().slice(0, 80) || 'Walk-in customer';
    let subtotal = 0; let tax = 0;
    for (const item of planned) {
      const value = item.amount * Number(item.variant.sale_price || 0);
      subtotal += value;
      tax += value * Number(item.product?.gst_rate || 0) / 100;
      const out = await changeStock(req, { locationId: location.id, variantId: item.variant.id, delta: -item.amount, reason: 'sale', type: 'sale', note: `Express POS · ${customer}` });
      if (await expiryOf(req, item.variant.id)) await consumeBatches(req, { variantId: item.variant.id, locationId: location.id, amount: item.amount, prefer: out.lots });
    }
    const r2 = (value) => Math.round(value * 100) / 100;
    res.status(201).json({ customer, location: location.name, items: planned.length, subtotal: r2(subtotal), tax: r2(tax), total: r2(subtotal + tax) });
  }));

  // ---------- dashboard overview: sales, purchase, stock, wastage, statistics, top selling ----------
  // Sales come from invoiced job cards and stock moved out with reason "sale"; purchases from
  // stock received with reason "purchase"; wastage from "damage" / "loss" / "expired" movements.
  app.get('/api/dashboard/overview', auth, allow('dashboard.view'), route(async (req, res) => {
    const isDay = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
    const pad = (n) => String(n).padStart(2, '0');
    const ymd = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const now = new Date();
    const to = isDay(req.query.to) ? req.query.to : ymd(now);
    const from = isDay(req.query.from) ? req.query.from : `${now.getFullYear()}-01-01`;
    if (from > to) return fail(res, 400, 'INVALID', 'The start date must be before the end date.');
    const start = new Date(`${from}T00:00:00`);
    const end = new Date(`${to}T23:59:59.999`);
    const spanDays = Math.round((end - start) / 86400000);
    const prevEnd = new Date(start.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - (end - start));
    const today = ymd(now);

    const allLocations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active));
    const pick = String(req.query.locationId || '');
    const locations = pick ? allLocations.filter((row) => row.id === pick) : allLocations;
    const locIds = new Set(locations.map((row) => row.id));
    const n = (value) => Number(value) || 0;
    const r2 = (value) => Math.round(value * 100) / 100;

    const products = await store.find('products', { company_id: req.companyId });
    const variants = await store.find('variants', { company_id: req.companyId });
    const categories = await store.find('categories', { company_id: req.companyId });
    const brandRows = await store.find('brands', { company_id: req.companyId });
    const variantInfo = (id) => {
      const variant = variants.find((row) => row.id === id);
      const product = products.find((row) => row.id === variant?.product_id);
      return { variant, product, category: categories.find((row) => row.id === product?.category_id)?.name || 'Uncategorised', brand: brandRows.find((row) => row.id === product?.brand_id)?.name || 'No brand' };
    };
    const locName = (id) => allLocations.find((row) => row.id === id)?.name || 'Other';

    // ---- sales events: { at, amount, profit, items: [{ category, name, qty, amount }] }
    const sales = [];
    const jobs = (await store.find('job_cards', { company_id: req.companyId })).filter((job) => locIds.has(job.location_id) && job.status !== 'cancelled' && (job.invoiced_at || ['ready', 'delivered'].includes(job.status)));
    const lines = jobs.length ? await store.find('job_lines', { company_id: req.companyId }) : [];
    for (const job of jobs) {
      const at = new Date(job.invoiced_at || job.delivered_at || job.checked_in_at);
      if (Number.isNaN(at.getTime())) continue;
      const own = lines.filter((line) => line.job_id === job.id && line.approval !== 'rejected');
      let cost = 0;
      const items = [];
      for (const line of own) {
        const amount = n(line.qty) * n(line.rate) - n(line.discount);
        if (line.line_type === 'part') {
          const info = variantInfo(line.variant_id);
          cost += n(line.qty) * n(info.variant?.cost_price);
          items.push({ category: info.category, brand: info.brand, location: locName(job.location_id), name: info.product?.name || line.description, qty: n(line.qty), amount, cost: n(line.qty) * n(info.variant?.cost_price) });
        } else {
          items.push({ category: 'Labour & Service', brand: 'Service', location: locName(job.location_id), name: line.description, qty: n(line.qty), amount, cost: 0 });
        }
      }
      const taxable = own.reduce((sum, line) => sum + n(line.qty) * n(line.rate) - n(line.discount), 0);
      sales.push({ at, amount: n(job.grand_total), profit: taxable - cost, items });
    }
    const movements = (await store.find('stock_movements', { company_id: req.companyId })).filter((row) => locIds.has(row.location_id));
    const salesDocs = (await store.find('documents', { company_id: req.companyId })).filter((row) => row.module === 'sales' && row.doc_type === 'bill' && locIds.has(row.location_id));
    for (const doc of salesDocs) {
      let data = {};
      try { data = JSON.parse(doc.data || '{}'); } catch { data = {}; }
      const at = new Date(`${doc.doc_date}T12:00:00`);
      if (Number.isNaN(at.getTime())) continue;
      const items = (data.lines || []).map((line) => {
        const first = line.variants?.[0]?.variantId || line.serials?.variantId || line.picked?.variantId;
        const info = variantInfo(first);
        return { category: info.category, brand: info.brand, location: locName(doc.location_id), name: line.name, qty: 0, amount: 0, cost: 0, line };
      });
      const taxable = n(data.totals?.taxable);
      const gross = n(data.totals?.gross) || 1;
      for (const item of items) {
        const lineGross = (item.line.variants || []).reduce((sum, row) => sum + n(row.qty) * n(row.rate), 0) + (item.line.picked ? item.line.picked.ids.length * n(item.line.picked.rate) : 0);
        item.amount = r2(taxable * (lineGross / gross));
        for (const row of item.line.variants || []) { if (!item.line.picked && n(row.qty) > 0) { item.qty += n(row.qty); item.cost += n(row.qty) * n(variantInfo(row.variantId).variant?.cost_price); } }
        if (item.line.picked) { item.qty += item.line.picked.ids.length; item.cost += item.line.picked.ids.length * n(variantInfo(item.line.picked.variantId).variant?.cost_price); }
        delete item.line;
      }
      sales.push({ at, amount: n(doc.total), profit: taxable - n(data.cost), items });
    }
    for (const row of movements) {
      if (row.reason !== 'sale' || n(row.qty) >= 0) continue;
      if (/^SB-\d+/.test(String(row.note || ''))) continue;
      const info = variantInfo(row.variant_id);
      const qty = -n(row.qty);
      const amount = qty * n(info.variant?.sale_price);
      sales.push({ at: new Date(row.created_at), amount, profit: amount - qty * n(info.variant?.cost_price), items: [{ category: info.category, brand: info.brand, location: locName(row.location_id), name: info.product?.name || '', qty, amount, cost: qty * n(info.variant?.cost_price) }] });
    }
    const inRange = (at, a, b) => at >= a && at <= b;
    const periodSales = sales.filter((row) => inRange(row.at, start, end));
    const prevSales = sales.filter((row) => inRange(row.at, prevStart, prevEnd));
    const todaySales = sales.filter((row) => ymd(row.at) === today);
    const sum = (rows, key) => r2(rows.reduce((total, row) => total + n(row[key]), 0));

    // statistics: daily up to 62 days, else monthly
    const monthly = spanDays > 62;
    const buckets = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      const key = monthly ? `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}` : ymd(cursor);
      if (!buckets.some((row) => row.key === key)) buckets.push({ key, amount: 0, profit: 0, purchase: 0 });
      cursor.setDate(cursor.getDate() + 1);
    }
    for (const row of periodSales) {
      const key = monthly ? `${row.at.getFullYear()}-${pad(row.at.getMonth() + 1)}` : ymd(row.at);
      const bucket = buckets.find((item) => item.key === key);
      if (bucket) { bucket.amount += row.amount; bucket.profit += row.profit; }
    }

    // top selling by category
    const cat = new Map();
    for (const row of periodSales) for (const item of row.items) cat.set(item.category, (cat.get(item.category) || 0) + item.amount);
    let topCategories = [...cat].map(([name, amount]) => ({ name, amount: r2(amount) })).filter((row) => row.amount > 0).sort((a, b) => b.amount - a.amount);
    if (topCategories.length > 6) topCategories = [...topCategories.slice(0, 5), { name: 'Other', amount: r2(topCategories.slice(5).reduce((s, row) => s + row.amount, 0)) }];

    // ---- purchase & wastage from movements in range
    const ranged = movements.filter((row) => inRange(new Date(row.created_at), start, end));
    const costOf = (row) => Math.abs(n(row.qty)) * n(variantInfo(row.variant_id).variant?.cost_price);
    const purchases = ranged.filter((row) => row.reason === 'purchase' && n(row.qty) > 0);
    const returns = ranged.filter((row) => ['purchase_return', 'return'].includes(row.reason));
    for (const row of purchases) {
      const at = new Date(row.created_at);
      const bucket = buckets.find((item) => item.key === (monthly ? `${at.getFullYear()}-${pad(at.getMonth() + 1)}` : ymd(at)));
      if (bucket) bucket.purchase += costOf(row);
    }
    const waste = ranged.filter((row) => ['damage', 'loss', 'expired', 'wastage'].includes(row.reason) && n(row.qty) < 0);

    // ---- stock: holding value vs pending (reorder) value
    const levels = (await store.find('stock_levels', { company_id: req.companyId })).filter((row) => locIds.has(row.location_id));
    let holding = 0; let holdingUnits = 0; let pending = 0; let pendingUnits = 0;
    const alertMeta = await catalogueMeta(store, req.companyId);
    for (const variant of variants.filter((row) => on(row.is_active))) {
      for (const location of locations) {
        const qty = n(levels.find((row) => row.variant_id === variant.id && row.location_id === location.id)?.qty_on_hand);
        if (qty > 0) { holding += qty * n(variant.cost_price); holdingUnits += qty; }
        const min = alertLevelAt(alertMeta.profiles[variant.product_id], variant.min_stock, location.id);
        if (min > 0 && qty <= min) { const need = Math.max(min * 2 - qty, min); pending += need * n(variant.cost_price); pendingUnits += need; }
      }
    }

    // ---- business contribution: category / location / brand
    const dims = { category: new Map(), location: new Map(), brand: new Map() };
    const slot = (dim, name) => { const map = dims[dim]; if (!map.has(name)) map.set(name, { name, sales: 0, cost: 0, qty: 0, bills: new Set(), purchase: 0, stock: 0 }); return map.get(name); };
    periodSales.forEach((sale, index) => {
      for (const item of sale.items) for (const dim of Object.keys(dims)) {
        const row = slot(dim, item[dim] || 'Other');
        row.sales += n(item.amount); row.cost += n(item.cost); row.qty += n(item.qty); row.bills.add(index);
      }
    });
    for (const row of purchases) { const info = variantInfo(row.variant_id); const value = costOf(row); slot('category', info.category).purchase += value; slot('brand', info.brand).purchase += value; slot('location', locName(row.location_id)).purchase += value; }
    for (const level of levels) {
      const qty = n(level.qty_on_hand); if (!(qty > 0)) continue;
      const info = variantInfo(level.variant_id); if (!info.variant) continue;
      const value = qty * n(info.variant.cost_price);
      slot('category', info.category).stock += value; slot('brand', info.brand).stock += value; slot('location', locName(level.location_id)).stock += value;
    }
    const contribution = Object.fromEntries(Object.entries(dims).map(([dim, map]) => [dim, [...map.values()].map((row) => ({ name: row.name, sales: r2(row.sales), profit: r2(row.sales - row.cost), qty: r2(row.qty), bills: row.bills.size, purchase: r2(row.purchase), stock: r2(row.stock) })).sort((a, b) => b.sales - a.sales || b.stock - a.stock)]));

    const periodAmount = sum(periodSales, 'amount');
    const prevAmount = sum(prevSales, 'amount');
    res.json({
      from, to, locations: allLocations.map((row) => ({ id: row.id, name: row.name })),
      sales: {
        amount: periodAmount, profit: sum(periodSales, 'profit'), count: periodSales.length,
        todayAmount: sum(todaySales, 'amount'), todayProfit: sum(todaySales, 'profit'),
        previousAmount: prevAmount, change: prevAmount ? r2(((periodAmount - prevAmount) / prevAmount) * 100) : null,
      },
      purchase: { count: purchases.length, amount: r2(purchases.reduce((s, row) => s + costOf(row), 0)), cancelled: 0, returns: returns.length },
      stock: { holding: r2(holding), holdingUnits: r2(holdingUnits), pending: r2(pending), pendingUnits: r2(pendingUnits) },
      wastage: { items: r2(waste.reduce((s, row) => s - n(row.qty), 0)), entries: waste.length, loss: r2(waste.reduce((s, row) => s + costOf(row), 0)) },
      statistics: { monthly, points: buckets.map((row) => ({ key: row.key, amount: r2(row.amount), profit: r2(row.profit), purchase: r2(row.purchase) })) },
      topCategories,
      contribution,
    });
  }));

  app.get('/api/settings', auth, allow('settings.view', 'settings'), (req, res) => {
    res.json({ tenant: req.session.tenant, modules: req.session.modules });
  });

  app.patch('/api/settings', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const name = String(req.body?.name || req.session.tenant.name).trim();
    if (name.length < 2) return fail(res, 400, 'INVALID', 'Enter the business name.');
    await store.update('companies', req.companyId, {
      name,
      legal_name: req.body.legalName || '',
      gstin: req.body.gstin || '',
    });
    res.json(await loadSession(store, req.session.user.id));
  }));

  app.patch('/api/settings/modules', auth, allow('settings.manage', 'settings'), route(async (req, res) => {
    const feature = req.body?.feature;
    if (!FEATURE_KEYS.includes(feature)) return fail(res, 400, 'INVALID', 'Unknown module.');
    if (LOCKED_FEATURES.includes(feature)) return fail(res, 400, 'LOCKED', 'Users and settings stay on.');
    const entitled = req.session.modules.find((item) => item.key === feature)?.entitled;
    if (!entitled) return fail(res, 400, 'NOT_ENTITLED', 'This plan does not include that module.');
    const settings = await store.find('settings', { company_id: req.companyId, setting_key: feature });
    if (settings[0]) await store.update('settings', settings[0].id, { setting_value: req.body.enabled ? '1' : '0' });
    else await store.insert('settings', { company_id: req.companyId, setting_key: feature, setting_value: req.body.enabled ? '1' : '0' });
    res.json(await loadSession(store, req.session.user.id));
  }));

  registerService(app, store, { auth, allow, route, fail, locationAllowed, scopedLocations });
  registerParties(app, store, { auth, allow, route, fail });
  registerPriceLists(app, store, { auth, allow, route, fail });
  registerAppSettings(app, store, { auth, allow, route, fail });
  const promotions = createPromotions(store, { auth, allow, route, fail, scopedLocations, on, pickerItems });
  promotions.register(app);
  registerTransfers(app, store, { auth, allow, route, fail, locationAllowed, pickerItems, changeStock, stockLocation, on, qty, expiryOf, addBatches, consumeBatches, lots, childBlock });
  registerWastage(app, store, { auth, allow, route, fail, locationAllowed, pickerItems, changeStock, stockLocation, on, qty, expiryOf, consumeBatches, lots, childBlock });
  registerRepack(app, store, { auth, allow, route, fail, locationAllowed, scopedLocations, stockLocation, changeStock, expiryOf, consumeBatches, addBatches, fillBatchNos, catalogueMeta, on, qty, money });
  registerMigration(app, store, { auth, allow, route, fail, on });
  lots.register(app, { auth, allow, route, fail, locationAllowed });
  registerDataCleanup(app, store, { auth, route, fail, writeSetting });
  registerStockReport(app, store, { auth, allow, route, fail, catalogueMeta, scopedLocations, locationAllowed, on });
  const org = registerOrgStructure(app, store, { auth, allow, route, fail, on, writeSetting, loadSession, locationAllowed });
  registerPrintTemplates(app, store, { auth, allow, route, fail, writeSetting });
  registerUom(app, store, { auth, allow, route, fail, writeSetting, catalogueMeta });
  registerWarranty(app, store, { auth, allow, route, fail, on, locationAllowed, changeStock, stockLocation });
  registerDocuments(app, store, { auth, allow, route, fail, locationAllowed, scopedLocations, pickerItems, changeStock, receiveSerials, stockLocation, money, qty, on, expiryOf, addBatches, consumeBatches, promotions, lots, org, fillBatchNos, childTarget, unitResolver });

  app.get('/api/vertical/:feature/status', auth, (req, res) => {
    const map = { serial: 'serial', warranty: 'warranty', 'bike-service': 'bike_service', purchase: 'purchase', sales: 'sales', customers: 'customers', reports: 'reports', notifications: 'notifications' };
    const feature = map[req.params.feature];
    if (!feature) return fail(res, 404, 'NOT_FOUND', 'Unknown module.');
    const module = req.session.modules.find((item) => item.key === feature);
    if (!module?.enabled) return fail(res, 403, 'MODULE_DISABLED', 'This module is not enabled for your business.');
    const permission = `${feature}.view`;
    if (!req.session.user.permissions.includes(permission)) return fail(res, 403, 'PERMISSION_DENIED', 'You do not have permission for this action.');
    res.json({ module: feature, available: false });
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    if (res.headersSent) return;
    const text = String(error?.message || '');
    if (/exhausted the free tier/i.test(text)) {
      return fail(res, 503, 'QUOTA', 'Sign-in cannot check your password right now. The Catalyst database has used its free allowance. Add a payment method in the Catalyst project, then try again.');
    }
    fail(res, 500, 'SERVER', 'Something went wrong.');
  });

  if (options.vite === false) return { app, store };

  if (process.env.NODE_ENV === 'production' && existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(distDir, 'index.html')));
  } else if (process.env.NODE_ENV !== 'production') {
    const { createServer } = await import('vite');
    const vite = await createServer({
      root: clientRoot,
      configFile: join(clientRoot, 'vite.config.js'),
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }
  return { app, store };
}

async function scopedLocations(store, session) {
  const rows = (await store.find('locations', { company_id: session.tenant.id })).sort((a, b) => a.name.localeCompare(b.name));
  if (!session.user.locationIds.length) return rows;
  return rows.filter((row) => session.user.locationIds.includes(row.id));
}

async function shapeProduct(store, product) {
  const variants = await store.find('variants', { product_id: product.id, company_id: product.company_id });
  const [category] = product.category_id ? await store.find('categories', { id: product.category_id }) : [];
  const [brand] = product.brand_id ? await store.find('brands', { id: product.brand_id }) : [];
  const [unit] = await store.find('units', { id: product.unit_id });
  const [profileRow] = await store.find('settings', { company_id: product.company_id, setting_key: `item_profile_${product.id}` });
  let profile = {}; try { profile = JSON.parse(profileRow?.setting_value || '{}') || {}; } catch { profile = {}; }
  return {
    id: product.id,
    name: product.name,
    kind: profile.kind || (product.tracking_type === 'serial' ? 'electronics' : 'grocery'),
    itemType: typeFromItem({ profile, trackingType: product.tracking_type, isService: on(product.is_service) }),
    matrixGroup: profile.kind === 'matrix' ? profile.group || '' : '',
    matrixParent: profile.kind === 'matrix' ? profile.parent || '' : '',
    upc: profile.upc || '',
    extraCodes: profile.extraCodes || [],
    image: profile.image || '',
    source: profile.source || null,
    maxStock: profile.settings?.maxStock ?? '',
    hsnSac: product.hsn_sac || null,
    gstRate: product.gst_rate,
    trackingType: product.tracking_type,
    isActive: on(product.is_active),
    category: category ? { id: category.id, name: category.name } : null,
    brand: brand ? { id: brand.id, name: brand.name } : null,
    unit: unit ? { id: unit.id, code: unit.code, name: unit.name } : null,
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      barcode: variant.barcode || null,
      mrp: variant.mrp || null,
      salePrice: variant.sale_price || null,
      costPrice: variant.cost_price || null,
      minStock: variant.min_stock,
    })),
  };
}

async function recentMovements(store, companyId, limit) {
  const movements = await store.find('stock_movements', { company_id: companyId });
  const locations = await store.find('locations', { company_id: companyId });
  const variants = await store.find('variants', { company_id: companyId });
  const products = await store.find('products', { company_id: companyId });
  return movements
    .map((row) => {
      const location = locations.find((item) => item.id === row.location_id);
      const variant = variants.find((item) => item.id === row.variant_id);
      const product = products.find((item) => item.id === variant?.product_id);
      return { ...row, location_name: location?.name, sku: variant?.sku, product_name: product?.name };
    })
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit);
}
