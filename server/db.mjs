import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLANS, FEATURE_KEYS } from '../shared/domain.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export function defaultDbPath() {
  return process.env.STOCKKEEP_DB || join(here, '..', 'data', 'stockkeep.sqlite');
}

export function openDb(path = defaultDbPath()) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  ensurePlans(db);
  return db;
}

export function ensurePlans(db) {
  const upsert = db.prepare(`
    INSERT INTO plans (code, name, vertical, trial_days, locations_limit, users_limit)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(code) DO UPDATE SET
      name = excluded.name,
      vertical = excluded.vertical,
      trial_days = excluded.trial_days,
      locations_limit = excluded.locations_limit,
      users_limit = excluded.users_limit
  `);
  const clear = db.prepare('DELETE FROM plan_features WHERE plan_code = ?');
  const feature = db.prepare('INSERT INTO plan_features (plan_code, feature, enabled) VALUES (?, ?, ?)');
  db.exec('BEGIN');
  try {
    for (const plan of PLANS) {
      upsert.run(plan.code, plan.name, plan.vertical, plan.trialDays, plan.limits.locations, plan.limits.users);
      clear.run(plan.code);
      for (const key of FEATURE_KEYS) feature.run(plan.code, key, plan.modules[key] ? 1 : 0);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
