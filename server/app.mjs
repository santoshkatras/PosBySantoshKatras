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

function on(value) {
  return Number(value) === 1;
}

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

function locationAllowed(session, locationId) {
  const ids = session.user.locationIds;
  return ids.length === 0 || ids.includes(String(locationId));
}

export async function createApp(options = {}) {
  const store = await openStore(options);
  const app = express();
  let seeded = false;
  app.use(express.json({ limit: '1mb' }));
  app.use(route(async (req, _res, next) => {
    store.attach?.(req);
    if (process.env.X_ZOHO_CATALYST_LISTEN_PORT && !seeded) {
      seeded = true;
      try {
        await seedDemos(store);
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
    for (const variant of variants) {
      const onHand = levels
        .filter((row) => row.variant_id === variant.id && ids.has(row.location_id))
        .reduce((sum, row) => sum + Number(row.qty_on_hand || 0), 0);
      if (Number(variant.min_stock) > 0 && onHand <= Number(variant.min_stock)) low += 1;
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
    res.json({ items });
  }));
  app.post('/api/categories', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return fail(res, 400, 'INVALID', 'Enter a category name.');
    const saved = await store.insert('categories', { company_id: req.companyId, name, parent_id: req.body.parentId || '' });
    res.status(201).json({ id: saved.id, name });
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

  app.post('/api/products', auth, allow('catalogue.manage', 'catalogue'), route(async (req, res) => {
    const body = req.body ?? {};
    const name = String(body.name || '').trim();
    const sku = String(body.variant?.sku || '').trim();
    if (name.length < 2 || sku.length < 2) return fail(res, 400, 'INVALID', 'Product name and SKU are required.');
    const [unit] = await store.find('units', { id: body.unitId });
    if (!unit || unit.company_id !== req.companyId) return fail(res, 400, 'INVALID', 'Choose a unit.');
    const taken = (await store.find('variants', { company_id: req.companyId })).some((row) => row.sku.toLowerCase() === sku.toLowerCase());
    if (taken) return fail(res, 409, 'SKU', 'That SKU is already used.');
    const product = await store.insert('products', {
      company_id: req.companyId,
      name,
      category_id: body.categoryId || '',
      brand_id: body.brandId || '',
      unit_id: body.unitId,
      hsn_sac: body.hsnSac || '',
      gst_rate: body.gstRate || '18',
      tracking_type: body.trackingType || 'none',
      is_service: body.isService ? 1 : 0,
      is_active: 1,
    });
    await store.insert('variants', {
      company_id: req.companyId,
      product_id: product.id,
      sku,
      barcode: body.variant.barcode || '',
      mrp: money(body.variant.mrp),
      sale_price: money(body.variant.salePrice),
      cost_price: money(body.variant.costPrice),
      min_stock: qty(body.variant.minStock || 0),
      is_active: 1,
    });
    res.status(201).json(await shapeProduct(store, product));
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

  app.get('/api/stock', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const locations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active));
    const q = String(req.query.q || '').trim().toLowerCase();
    const products = await store.find('products', { company_id: req.companyId });
    const units = await store.find('units', { company_id: req.companyId });
    const variants = (await store.find('variants', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const levels = await store.find('stock_levels', { company_id: req.companyId });
    const items = [];
    for (const variant of variants) {
      const product = products.find((row) => row.id === variant.product_id);
      if (!product || !on(product.is_active)) continue;
      if (q && !product.name.toLowerCase().includes(q) && !variant.sku.toLowerCase().includes(q)) continue;
      const unit = units.find((row) => row.id === product.unit_id);
      for (const location of locations) {
        const level = levels.find((row) => row.variant_id === variant.id && row.location_id === location.id);
        const onHand = Number(level?.qty_on_hand || 0);
        items.push({
          variantId: variant.id,
          sku: variant.sku,
          productName: product.name,
          unitCode: unit?.code,
          locationId: location.id,
          locationName: location.name,
          qtyOnHand: qty(onHand),
          minStock: qty(variant.min_stock),
          stockValue: variant.cost_price ? (onHand * Number(variant.cost_price)).toFixed(2) : null,
          low: Number(variant.min_stock) > 0 && onHand <= Number(variant.min_stock),
        });
      }
    }
    res.json({ items });
  }));

  app.get('/api/stock/movements', auth, allow('stock.view', 'stock'), route(async (req, res) => {
    const rows = (await recentMovements(store, req.companyId, 50)).filter((row) => locationAllowed(req.session, row.location_id));
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
    const levels = await store.find('stock_levels', { company_id: req.companyId, location_id: locationId, variant_id: variantId });
    const level = levels[0];
    const next = Number(level?.qty_on_hand || 0) + delta;
    if (next < -0.0001) return fail(res, 400, 'NEGATIVE', 'Stock cannot go below zero.');
    if (level) await store.update('stock_levels', level.id, { qty_on_hand: qty(next) });
    else {
      await store.insert('stock_levels', {
        company_id: req.companyId,
        location_id: locationId,
        variant_id: variantId,
        qty_on_hand: qty(next),
      });
    }
    const movement = await store.insert('stock_movements', {
      company_id: req.companyId,
      location_id: locationId,
      variant_id: variantId,
      qty: qty(delta),
      movement_type: reason === 'opening' ? 'opening' : 'adjustment',
      reason: reason || 'correction',
      note: note || '',
      created_at: new Date().toISOString(),
    });
    await store.insert('audit_logs', {
      company_id: req.companyId,
      user_id: req.session.user.id,
      action: 'stock.adjust',
      entity: 'stock_movement',
      entity_id: movement.id,
      created_at: new Date().toISOString(),
    });
    res.status(201).json({ movementId: movement.id, qtyOnHand: qty(next) });
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
    if (!res.headersSent) fail(res, 500, 'SERVER', 'Something went wrong.');
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
  return {
    id: product.id,
    name: product.name,
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
