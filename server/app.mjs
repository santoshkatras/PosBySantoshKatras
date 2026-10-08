import express from 'express';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FEATURE_KEYS, LOCKED_FEATURES } from '../shared/domain.mjs';
import { hashPassword, hashToken, newRefreshToken, readAccess, signAccess, verifyPassword } from './auth.mjs';
import { openDb } from './db.mjs';
import { provisionTenant } from './provision.mjs';
import { loadSession } from './session.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const clientRoot = join(here, '..', 'client');
const distDir = join(clientRoot, 'dist');
const loginHits = new Map();

function fail(res, status, code, message) {
  res.status(status).json({ statusCode: status, code, message });
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

function issue(db, res, userId, tenantId) {
  const raw = newRefreshToken();
  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked)
    VALUES (?, ?, ?, ?, 0)
  `).run(randomUUID(), userId, hashToken(raw), new Date(Date.now() + 14 * 86400000).toISOString());
  refreshCookie(res, raw);
  const session = loadSession(db, userId);
  return { accessToken: signAccess(userId, tenantId), ...session };
}

function bearer(req) {
  const header = req.headers.authorization || '';
  return header.startsWith('Bearer ') ? header.slice(7) : null;
}

function requireUser(db) {
  return (req, res, next) => {
    const payload = readAccess(bearer(req));
    if (!payload) return fail(res, 401, 'UNAUTHENTICATED', 'Sign in again.');
    const session = loadSession(db, payload.sub);
    if (!session || session.tenant.id !== payload.tid) return fail(res, 401, 'UNAUTHENTICATED', 'Sign in again.');
    req.session = session;
    req.tenantId = session.tenant.id;
    next();
  };
}

function allow(permission, feature) {
  return (req, res, next) => {
    if (feature) {
      const module = req.session.modules.find((item) => item.key === feature);
      if (!module?.enabled) {
        return fail(res, 403, 'MODULE_DISABLED', 'This module is not enabled for your business.');
      }
    }
    if (permission && !req.session.user.permissions.includes(permission)) {
      return fail(res, 403, 'PERMISSION_DENIED', 'You do not have permission for this action.');
    }
    next();
  };
}

function locationAllowed(session, locationId) {
  const ids = session.user.locationIds;
  return ids.length === 0 || ids.includes(locationId);
}

function qty(value) {
  return Number(value).toFixed(3);
}

function money(value) {
  if (value == null || value === '') return null;
  return Number(value).toFixed(2);
}

function inr(value) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(Number(value) || 0);
}

export async function createApp(options = {}) {
  const db = openDb(options.dbPath);
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', database: 'sqlite' });
  });

  app.post('/api/auth/signup', (req, res) => {
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
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return fail(res, 409, 'EMAIL_TAKEN', 'That email is already registered.');
    }
    const created = provisionTenant(db, { ...body, email });
    res.status(201).json(issue(db, res, created.userId, created.tenantId));
  });

  app.post('/api/auth/login', (req, res) => {
    const ip = req.ip || 'local';
    const hit = loginHits.get(ip) || { count: 0, at: Date.now() };
    if (Date.now() - hit.at > 15 * 60 * 1000) {
      hit.count = 0;
      hit.at = Date.now();
    }
    if (hit.count >= 10) return fail(res, 429, 'RATE_LIMIT', 'Too many sign-in attempts. Wait 15 minutes.');
    const email = String(req.body?.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(String(req.body?.password || ''), user.password_hash)) {
      hit.count += 1;
      loginHits.set(ip, hit);
      return fail(res, 401, 'INVALID_LOGIN', 'Email or password is incorrect.');
    }
    loginHits.set(ip, { count: 0, at: Date.now() });
    res.json(issue(db, res, user.id, user.tenant_id));
  });

  app.post('/api/auth/refresh', (req, res) => {
    const raw = cookies(req).sk_refresh;
    if (!raw) return fail(res, 401, 'UNAUTHENTICATED', 'Sign in again.');
    const row = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(hashToken(raw));
    if (!row || row.revoked || new Date(row.expires_at).getTime() < Date.now()) {
      return fail(res, 401, 'UNAUTHENTICATED', 'Sign in again.');
    }
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE id = ?').run(row.id);
    const user = db.prepare('SELECT id, tenant_id FROM users WHERE id = ?').get(row.user_id);
    res.json({ accessToken: issue(db, res, user.id, user.tenant_id).accessToken });
  });

  app.post('/api/auth/logout', (req, res) => {
    const raw = cookies(req).sk_refresh;
    if (raw) db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(hashToken(raw));
    clearRefresh(res);
    res.json({ ok: true });
  });

  const auth = requireUser(db);
  app.get('/api/auth/me', auth, (req, res) => res.json(req.session));

  app.get('/api/dashboard/summary', auth, allow('dashboard.view'), (req, res) => {
    const tid = req.tenantId;
    const locations = scopedLocations(db, req.session);
    const ids = locations.map((row) => row.id);
    const products = db.prepare('SELECT COUNT(*) AS n FROM products WHERE tenant_id = ? AND is_active = 1').get(tid).n;
    const skus = db.prepare('SELECT COUNT(*) AS n FROM variants WHERE tenant_id = ? AND is_active = 1').get(tid).n;
    let low = 0;
    let value = 0;
    if (ids.length) {
      const marks = ids.map(() => '?').join(',');
      const rows = db.prepare(`
        SELECT sl.qty_on_hand, v.min_stock, v.cost_price
        FROM variants v
        LEFT JOIN stock_levels sl ON sl.variant_id = v.id AND sl.location_id IN (${marks}) AND sl.tenant_id = v.tenant_id
        WHERE v.tenant_id = ? AND v.is_active = 1
      `).all(...ids, tid);
      for (const row of rows) {
        const onHand = Number(row.qty_on_hand || 0);
        if (Number(row.min_stock) > 0 && onHand <= Number(row.min_stock)) low += 1;
        value += onHand * Number(row.cost_price || 0);
      }
    }
    const movements = db.prepare(`
      SELECT m.id, m.qty, m.movement_type, m.reason, m.note, m.created_at, l.name AS location_name, p.name AS product_name, v.sku
      FROM stock_movements m
      JOIN locations l ON l.id = m.location_id
      JOIN variants v ON v.id = m.variant_id
      JOIN products p ON p.id = v.product_id
      WHERE m.tenant_id = ?
      ORDER BY m.created_at DESC LIMIT 8
    `).all(tid);
    res.json({
      locations: locations.length,
      products,
      skus,
      lowStock: low,
      stockValue: value.toFixed(2),
      stockValueLabel: inr(value),
      recentMovements: movements,
    });
  });

  app.get('/api/locations', auth, allow('locations.view'), (req, res) => {
    res.json({ items: scopedLocations(db, req.session) });
  });

  app.post('/api/locations', auth, allow('locations.manage'), (req, res) => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM locations WHERE tenant_id = ? AND is_active = 1').get(req.tenantId).n;
    if (count >= req.session.limits.locations) return fail(res, 400, 'LIMIT', 'This plan has no room for another location.');
    const name = String(req.body?.name || '').trim();
    if (name.length < 2) return fail(res, 400, 'INVALID', 'Enter a location name.');
    const id = randomUUID();
    db.prepare('INSERT INTO locations (id, tenant_id, name, kind) VALUES (?, ?, ?, ?)').run(
      id, req.tenantId, name, req.body.kind || 'store',
    );
    res.status(201).json(db.prepare('SELECT * FROM locations WHERE id = ?').get(id));
  });

  app.get('/api/users', auth, allow('users.view', 'users'), (req, res) => {
    const items = db.prepare(`
      SELECT u.id, u.name, u.email, u.status, r.code AS role_code, r.name AS role_name
      FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.tenant_id = ? ORDER BY u.name
    `).all(req.tenantId);
    res.json({ items });
  });

  app.get('/api/roles', auth, allow('users.view', 'users'), (req, res) => {
    const roles = db.prepare('SELECT * FROM roles WHERE tenant_id = ? ORDER BY name').all(req.tenantId);
    res.json({
      items: roles.map((role) => ({
        ...role,
        permissions: db.prepare('SELECT permission FROM role_permissions WHERE role_id = ?').all(role.id).map((row) => row.permission),
      })),
    });
  });

  app.post('/api/users', auth, allow('users.manage', 'users'), (req, res) => {
    const count = db.prepare("SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND status = 'active'").get(req.tenantId).n;
    if (count >= req.session.limits.users) return fail(res, 400, 'LIMIT', 'This plan has no room for another user.');
    const email = String(req.body?.email || '').trim().toLowerCase();
    const name = String(req.body?.name || '').trim();
    const password = String(req.body?.password || '');
    if (name.length < 2 || !email || password.length < 8) return fail(res, 400, 'INVALID', 'Name, email, and a password of 8 characters are required.');
    if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) return fail(res, 409, 'EMAIL_TAKEN', 'That email is already registered.');
    const role = db.prepare('SELECT * FROM roles WHERE id = ? AND tenant_id = ?').get(req.body.roleId, req.tenantId);
    if (!role || role.code === 'owner') return fail(res, 400, 'INVALID', 'Choose a role other than owner.');
    const id = randomUUID();
    db.prepare('INSERT INTO users (id, tenant_id, role_id, name, email, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
      id, req.tenantId, role.id, name, email, hashPassword(password),
    );
    for (const locationId of req.body.locationIds ?? []) {
      if (db.prepare('SELECT id FROM locations WHERE id = ? AND tenant_id = ?').get(locationId, req.tenantId)) {
        db.prepare('INSERT INTO user_locations (user_id, location_id) VALUES (?, ?)').run(id, locationId);
      }
    }
    res.status(201).json({ id });
  });

  app.get('/api/categories', auth, allow('catalogue.view', 'catalogue'), (req, res) => {
    res.json({ items: db.prepare('SELECT * FROM categories WHERE tenant_id = ? ORDER BY name').all(req.tenantId) });
  });
  app.post('/api/categories', auth, allow('catalogue.manage', 'catalogue'), (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return fail(res, 400, 'INVALID', 'Enter a category name.');
    const id = randomUUID();
    db.prepare('INSERT INTO categories (id, tenant_id, name, parent_id) VALUES (?, ?, ?, ?)').run(id, req.tenantId, name, req.body.parentId || null);
    res.status(201).json({ id, name });
  });
  app.get('/api/brands', auth, allow('catalogue.view', 'catalogue'), (req, res) => {
    res.json({ items: db.prepare('SELECT * FROM brands WHERE tenant_id = ? ORDER BY name').all(req.tenantId) });
  });
  app.post('/api/brands', auth, allow('catalogue.manage', 'catalogue'), (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return fail(res, 400, 'INVALID', 'Enter a brand name.');
    const id = randomUUID();
    db.prepare('INSERT INTO brands (id, tenant_id, name) VALUES (?, ?, ?)').run(id, req.tenantId, name);
    res.status(201).json({ id, name });
  });
  app.get('/api/units', auth, allow('catalogue.view', 'catalogue'), (req, res) => {
    res.json({ items: db.prepare('SELECT * FROM units WHERE tenant_id = ? ORDER BY name').all(req.tenantId) });
  });

  app.get('/api/products', auth, allow('catalogue.view', 'catalogue'), (req, res) => {
    const q = String(req.query.q || '').trim().toLowerCase();
    const products = db.prepare('SELECT * FROM products WHERE tenant_id = ? ORDER BY name').all(req.tenantId);
    const items = products.filter((product) => !q || product.name.toLowerCase().includes(q)).map((product) => ({
      ...shapeProduct(db, product),
    }));
    res.json({ items });
  });

  app.post('/api/products', auth, allow('catalogue.manage', 'catalogue'), (req, res) => {
    const body = req.body ?? {};
    const name = String(body.name || '').trim();
    const sku = String(body.variant?.sku || '').trim();
    if (name.length < 2 || sku.length < 2) return fail(res, 400, 'INVALID', 'Product name and SKU are required.');
    if (!db.prepare('SELECT id FROM units WHERE id = ? AND tenant_id = ?').get(body.unitId, req.tenantId)) {
      return fail(res, 400, 'INVALID', 'Choose a unit.');
    }
    const id = randomUUID();
    const variantId = randomUUID();
    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO products (id, tenant_id, name, category_id, brand_id, unit_id, hsn_sac, gst_rate, tracking_type, is_service)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.tenantId, name, body.categoryId || null, body.brandId || null, body.unitId, body.hsnSac || null, body.gstRate || '18', body.trackingType || 'none', body.isService ? 1 : 0);
      db.prepare(`
        INSERT INTO variants (id, tenant_id, product_id, sku, barcode, mrp, sale_price, cost_price, min_stock)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(variantId, req.tenantId, id, sku, body.variant.barcode || null, money(body.variant.mrp), money(body.variant.salePrice), money(body.variant.costPrice), qty(body.variant.minStock || 0));
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      if (String(error.message).includes('UNIQUE')) return fail(res, 409, 'SKU', 'That SKU is already used.');
      throw error;
    }
    res.status(201).json(shapeProduct(db, db.prepare('SELECT * FROM products WHERE id = ?').get(id)));
  });

  app.patch('/api/products/:id', auth, allow('catalogue.manage', 'catalogue'), (req, res) => {
    const existing = db.prepare('SELECT * FROM products WHERE id = ? AND tenant_id = ?').get(req.params.id, req.tenantId);
    if (!existing) return fail(res, 404, 'NOT_FOUND', 'Product not found.');
    const body = req.body ?? {};
    db.prepare(`
      UPDATE products SET name = ?, hsn_sac = ?, gst_rate = ?, tracking_type = ?, is_active = ?
      WHERE id = ? AND tenant_id = ?
    `).run(
      body.name ?? existing.name,
      body.hsnSac === undefined ? existing.hsn_sac : body.hsnSac || null,
      body.gstRate ?? existing.gst_rate,
      body.trackingType ?? existing.tracking_type,
      body.isActive === undefined ? existing.is_active : body.isActive ? 1 : 0,
      existing.id,
      req.tenantId,
    );
    res.json(shapeProduct(db, db.prepare('SELECT * FROM products WHERE id = ?').get(existing.id)));
  });

  app.get('/api/stock', auth, allow('stock.view', 'stock'), (req, res) => {
    const locations = scopedLocations(db, req.session).filter((row) => row.is_active);
    const q = String(req.query.q || '').trim().toLowerCase();
    const variants = db.prepare(`
      SELECT v.*, p.name AS product_name, u.code AS unit_code
      FROM variants v
      JOIN products p ON p.id = v.product_id
      JOIN units u ON u.id = p.unit_id
      WHERE v.tenant_id = ? AND v.is_active = 1 AND p.is_active = 1
      ORDER BY p.name
    `).all(req.tenantId).filter((row) => !q || row.product_name.toLowerCase().includes(q) || row.sku.toLowerCase().includes(q));
    const levels = db.prepare('SELECT * FROM stock_levels WHERE tenant_id = ?').all(req.tenantId);
    const items = [];
    for (const variant of variants) {
      for (const location of locations) {
        const level = levels.find((row) => row.variant_id === variant.id && row.location_id === location.id);
        const onHand = Number(level?.qty_on_hand || 0);
        items.push({
          variantId: variant.id,
          sku: variant.sku,
          productName: variant.product_name,
          unitCode: variant.unit_code,
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
  });

  app.get('/api/stock/movements', auth, allow('stock.view', 'stock'), (req, res) => {
    const rows = db.prepare(`
      SELECT m.*, l.name AS location_name, p.name AS product_name, v.sku
      FROM stock_movements m
      JOIN locations l ON l.id = m.location_id
      JOIN variants v ON v.id = m.variant_id
      JOIN products p ON p.id = v.product_id
      WHERE m.tenant_id = ?
      ORDER BY m.created_at DESC LIMIT 50
    `).all(req.tenantId).filter((row) => locationAllowed(req.session, row.location_id));
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
  });

  app.post('/api/stock/adjustments', auth, allow('stock.adjust', 'stock'), (req, res) => {
    const { locationId, variantId, reason, note } = req.body ?? {};
    const delta = Number(req.body?.qtyDelta);
    if (!locationId || !variantId || !Number.isFinite(delta) || delta === 0) {
      return fail(res, 400, 'INVALID', 'Choose an item, a location, and a quantity other than zero.');
    }
    if (!locationAllowed(req.session, locationId)) return fail(res, 403, 'PERMISSION_DENIED', 'That location is outside your access.');
    if (!db.prepare('SELECT id FROM locations WHERE id = ? AND tenant_id = ? AND is_active = 1').get(locationId, req.tenantId)) {
      return fail(res, 404, 'NOT_FOUND', 'Location not found.');
    }
    const variant = db.prepare('SELECT * FROM variants WHERE id = ? AND tenant_id = ? AND is_active = 1').get(variantId, req.tenantId);
    if (!variant) return fail(res, 404, 'NOT_FOUND', 'Variant not found.');
    db.exec('BEGIN');
    try {
      const level = db.prepare('SELECT * FROM stock_levels WHERE tenant_id = ? AND location_id = ? AND variant_id = ?').get(req.tenantId, locationId, variantId);
      const next = Number(level?.qty_on_hand || 0) + delta;
      if (next < -0.0001) {
        db.exec('ROLLBACK');
        return fail(res, 400, 'NEGATIVE', 'Stock cannot go below zero.');
      }
      if (level) {
        db.prepare('UPDATE stock_levels SET qty_on_hand = ? WHERE id = ?').run(qty(next), level.id);
      } else {
        db.prepare('INSERT INTO stock_levels (id, tenant_id, location_id, variant_id, qty_on_hand) VALUES (?, ?, ?, ?, ?)').run(
          randomUUID(), req.tenantId, locationId, variantId, qty(next),
        );
      }
      const movementId = randomUUID();
      db.prepare(`
        INSERT INTO stock_movements (id, tenant_id, location_id, variant_id, qty, movement_type, reason, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(movementId, req.tenantId, locationId, variantId, qty(delta), reason === 'opening' ? 'opening' : 'adjustment', reason || 'correction', note || null, new Date().toISOString());
      db.prepare('INSERT INTO audit_log (id, tenant_id, user_id, action, entity, entity_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        randomUUID(), req.tenantId, req.session.user.id, 'stock.adjust', 'stock_movement', movementId, new Date().toISOString(),
      );
      db.exec('COMMIT');
      res.status(201).json({ movementId, qtyOnHand: qty(next) });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  });

  app.get('/api/settings', auth, allow('settings.view', 'settings'), (req, res) => {
    res.json({ tenant: req.session.tenant, modules: req.session.modules });
  });

  app.patch('/api/settings', auth, allow('settings.manage', 'settings'), (req, res) => {
    const name = String(req.body?.name || req.session.tenant.name).trim();
    if (name.length < 2) return fail(res, 400, 'INVALID', 'Enter the business name.');
    db.prepare('UPDATE tenants SET name = ?, legal_name = ?, gstin = ? WHERE id = ?').run(
      name,
      req.body.legalName || null,
      req.body.gstin || null,
      req.tenantId,
    );
    res.json(loadSession(db, req.session.user.id));
  });

  app.patch('/api/settings/modules', auth, allow('settings.manage', 'settings'), (req, res) => {
    const feature = req.body?.feature;
    if (!FEATURE_KEYS.includes(feature)) return fail(res, 400, 'INVALID', 'Unknown module.');
    if (LOCKED_FEATURES.includes(feature)) return fail(res, 400, 'LOCKED', 'Users and settings stay on.');
    const entitled = req.session.modules.find((item) => item.key === feature)?.entitled;
    if (!entitled) return fail(res, 400, 'NOT_ENTITLED', 'This plan does not include that module.');
    db.prepare(`
      INSERT INTO tenant_features (tenant_id, feature, enabled) VALUES (?, ?, ?)
      ON CONFLICT(tenant_id, feature) DO UPDATE SET enabled = excluded.enabled
    `).run(req.tenantId, feature, req.body.enabled ? 1 : 0);
    res.json(loadSession(db, req.session.user.id));
  });

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

  if (options.vite === false) {
    app.use((error, _req, res, _next) => {
      console.error(error);
      if (!res.headersSent) fail(res, 500, 'SERVER', 'Something went wrong.');
    });
    return { app, db };
  }

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

  app.use((error, _req, res, _next) => {
    console.error(error);
    if (!res.headersSent) fail(res, 500, 'SERVER', 'Something went wrong.');
  });
  return { app, db };
}

function scopedLocations(db, session) {
  const rows = db.prepare('SELECT * FROM locations WHERE tenant_id = ? ORDER BY name').all(session.tenant.id);
  if (!session.user.locationIds.length) return rows;
  return rows.filter((row) => session.user.locationIds.includes(row.id));
}

function shapeProduct(db, product) {
  const variants = db.prepare('SELECT * FROM variants WHERE product_id = ? AND tenant_id = ?').all(product.id, product.tenant_id);
  const category = product.category_id ? db.prepare('SELECT id, name FROM categories WHERE id = ?').get(product.category_id) : null;
  const brand = product.brand_id ? db.prepare('SELECT id, name FROM brands WHERE id = ?').get(product.brand_id) : null;
  const unit = db.prepare('SELECT id, code, name FROM units WHERE id = ?').get(product.unit_id);
  return {
    id: product.id,
    name: product.name,
    hsnSac: product.hsn_sac,
    gstRate: product.gst_rate,
    trackingType: product.tracking_type,
    isActive: product.is_active === 1,
    category,
    brand,
    unit,
    variants: variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      barcode: variant.barcode,
      mrp: variant.mrp,
      salePrice: variant.sale_price,
      costPrice: variant.cost_price,
      minStock: variant.min_stock,
    })),
  };
}
