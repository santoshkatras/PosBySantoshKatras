import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.JWT_SECRET || 'dev-only-access-secret-change-me';

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const next = scryptSync(password, salt, 32);
  const prev = Buffer.from(hash, 'hex');
  return next.length === prev.length && timingSafeEqual(next, prev);
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function signAccess(userId, tenantId) {
  const body = Buffer.from(JSON.stringify({
    sub: userId,
    tid: tenantId,
    exp: Date.now() + 15 * 60 * 1000,
  })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readAccess(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  if (payload.exp < Date.now()) return null;
  return payload;
}

export function newRefreshToken() {
  return randomBytes(32).toString('base64url');
}

// Admin Panel sign-in (platform owner, not a shop user): own token kind, 12 hours.
export function signAdmin(adminId) {
  const body = Buffer.from(JSON.stringify({ adm: adminId, exp: Date.now() + 12 * 60 * 60 * 1000 })).toString('base64url');
  const sig = createHmac('sha256', `${SECRET}:admin`).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function readAdmin(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', `${SECRET}:admin`).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  if (!payload?.adm || payload.exp < Date.now()) return null;
  return payload;
}
