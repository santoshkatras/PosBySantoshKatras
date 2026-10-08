import { randomUUID } from 'node:crypto';
import {
  FEATURE_KEYS,
  ROLE_NAMES,
  defaultCategories,
  defaultRoleCodes,
  defaultUnits,
  permissionsForRole,
  trialPlanCode,
} from '../shared/domain.mjs';
import { hashPassword } from './auth.mjs';

export function provisionTenant(db, input) {
  const plan = db.prepare('SELECT * FROM plans WHERE code = ?').get(trialPlanCode(input.businessType));
  if (!plan) throw new Error('PLANS_MISSING');
  const features = db.prepare('SELECT feature, enabled FROM plan_features WHERE plan_code = ?').all(plan.code);
  const tenantId = randomUUID();
  const now = new Date();
  const trialEnds = new Date(now.getTime() + plan.trial_days * 86400000).toISOString();
  const locationId = randomUUID();
  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO tenants (id, name, legal_name, business_type, gstin, state_code, status, plan_code, trial_ends_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'trial', ?, ?, ?)
    `).run(
      tenantId,
      input.businessName,
      input.legalName ?? input.businessName,
      input.businessType,
      input.gstin || null,
      input.stateCode,
      plan.code,
      trialEnds,
      now.toISOString(),
    );
    const featureStmt = db.prepare('INSERT INTO tenant_features (tenant_id, feature, enabled) VALUES (?, ?, ?)');
    for (const key of FEATURE_KEYS) {
      const entitled = features.find((row) => row.feature === key);
      featureStmt.run(tenantId, key, entitled?.enabled ? 1 : 0);
    }
    db.prepare('INSERT INTO locations (id, tenant_id, name, kind) VALUES (?, ?, ?, ?)').run(
      locationId,
      tenantId,
      input.locationName || 'Main counter',
      input.businessType === 'bike_service' ? 'service_bay' : 'store',
    );
    const roleIds = {};
    const roleStmt = db.prepare('INSERT INTO roles (id, tenant_id, code, name) VALUES (?, ?, ?, ?)');
    const permStmt = db.prepare('INSERT INTO role_permissions (role_id, permission) VALUES (?, ?)');
    for (const code of defaultRoleCodes(input.businessType)) {
      const roleId = randomUUID();
      roleIds[code] = roleId;
      roleStmt.run(roleId, tenantId, code, ROLE_NAMES[code]);
      for (const permission of permissionsForRole(code)) permStmt.run(roleId, permission);
    }
    const unitIds = {};
    const unitStmt = db.prepare('INSERT INTO units (id, tenant_id, code, name) VALUES (?, ?, ?, ?)');
    for (const unit of defaultUnits(input.businessType)) {
      const id = randomUUID();
      unitIds[unit.code] = id;
      unitStmt.run(id, tenantId, unit.code, unit.name);
    }
    const categoryStmt = db.prepare('INSERT INTO categories (id, tenant_id, name, parent_id) VALUES (?, ?, ?, ?)');
    for (const category of defaultCategories(input.businessType)) {
      const parentId = randomUUID();
      categoryStmt.run(parentId, tenantId, category.name, null);
      for (const child of category.children ?? []) categoryStmt.run(randomUUID(), tenantId, child, parentId);
    }
    const userId = randomUUID();
    db.prepare(`
      INSERT INTO users (id, tenant_id, role_id, name, email, password_hash, status)
      VALUES (?, ?, ?, ?, ?, ?, 'active')
    `).run(userId, tenantId, roleIds.owner, input.ownerName, input.email.toLowerCase(), hashPassword(input.password));
    db.exec('COMMIT');
    return { tenantId, userId, locationId, roleIds, unitIds };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
