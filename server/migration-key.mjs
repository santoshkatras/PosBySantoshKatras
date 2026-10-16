// A per-process key the Data Migration engine sends on its own internal API calls, so that
// migration-only options (keep the old document number, history-only documents without stock
// posting) can never be switched on by an ordinary browser request.
import { randomBytes } from 'node:crypto';

export const MIGRATION_KEY = randomBytes(24).toString('hex');

export function migrationOf(req) {
  if (!req.headers['x-skpos-migration'] || req.headers['x-skpos-migration'] !== MIGRATION_KEY) return null;
  try { return JSON.parse(Buffer.from(String(req.headers['x-skpos-migration-options'] || ''), 'base64').toString('utf8') || '{}'); } catch { return {}; }
}
