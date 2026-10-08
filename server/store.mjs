import { createRequire } from 'node:module';
import { existsSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { newId } from './ids.mjs';

const require = createRequire(import.meta.url);
const PROJECT_ID = process.env.CATALYST_PROJECT_ID || '82924000000039365';
const ORG_ID = process.env.CATALYST_ORG_ID || '941422719';
const ENV_NAME = process.env.CATALYST_ENV || 'Development';
const FLAGS = new Set(['is_active', 'is_service', 'revoked', 'max_users']);

function clone(row) {
  return row ? { ...row } : null;
}

function same(left, right) {
  return String(left ?? '') === String(right ?? '');
}

export function createMemoryStore() {
  const tables = new Map();
  return {
    kind: 'memory',
    async ping() {
      return true;
    },
    async find(table, where = {}) {
      const rows = tables.get(table) || [];
      return rows.filter((row) => Object.entries(where).every(([key, value]) => same(row[key], value))).map(clone);
    },
    async insert(table, input) {
      const id = String(input.id || newId());
      const row = normalize({ ...input, id, row_key: input.row_key || id, ROWID: id });
      const bucket = tables.get(table) || [];
      bucket.push(row);
      tables.set(table, bucket);
      return clone(row);
    },
    async update(table, id, patch) {
      const bucket = tables.get(table) || [];
      const row = bucket.find((item) => same(item.id, id));
      if (!row) return null;
      Object.assign(row, normalize({ ...row, ...patch, id: row.id, row_key: row.row_key }));
      return clone(row);
    },
  };
}

function normalize(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (value == null || value === '') continue;
    if (FLAGS.has(key)) out[key] = Number(value);
    else out[key] = String(value);
  }
  return out;
}

function quote(value) {
  if (typeof value === 'number' || /^\d+$/.test(String(value))) return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function unwrap(data, table) {
  const list = Array.isArray(data) ? data : [];
  return list.map((item) => normalize(item?.[table] || item));
}

function cliPackage() {
  const names = process.platform === 'win32' ? ['catalyst.cmd', 'catalyst'] : ['catalyst'];
  const dirs = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
  if (process.env.HOME) dirs.push(join(process.env.HOME, '.local', 'bin'));
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (!existsSync(candidate)) continue;
      let root = realpathSync(candidate);
      if (root.endsWith('.js')) root = dirname(dirname(dirname(root)));
      if (existsSync(join(root, 'lib', 'authentication', 'credential.js'))) return root;
    }
  }
  throw new Error('CATALYST_LOGIN');
}

async function accessToken() {
  if (process.env.CATALYST_ACCESS_TOKEN) return process.env.CATALYST_ACCESS_TOKEN;
  const root = cliPackage();
  const runtime = require(join(root, 'lib/runtime-store.js')).default;
  runtime.set('cli.package', require(join(root, 'package.json')));
  const config = require(join(root, 'lib/util_modules/config-store.js')).default;
  const { getActiveDC } = require(join(root, 'lib/util_modules/dc.js'));
  const credential = require(join(root, 'lib/authentication/credential.js')).default;
  const stored = config.get(`${getActiveDC()}.credential`);
  if (typeof stored !== 'string') throw new Error('CATALYST_LOGIN');
  credential.initToken(stored, false);
  return credential.getAccessToken();
}

function createRestClient() {
  let tokenPromise;
  async function headers() {
    if (!tokenPromise) tokenPromise = accessToken();
    const token = await tokenPromise;
    return {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.catalyst.v2+json',
      'X-CATALYST-Environment': ENV_NAME,
      'CATALYST-ORG': ORG_ID,
      'Content-Type': 'application/json',
    };
  }
  async function send(method, path, body) {
    const response = await fetch(`https://api.catalyst.zoho.com/baas/v1/project/${PROJECT_ID}${path}`, {
      method,
      headers: await headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.status === 'failure') {
      const message = payload.data?.message || payload.message || `Catalyst request failed (${response.status})`;
      throw new Error(message);
    }
    return payload.data;
  }
  return {
    async query(table, sql) {
      return unwrap(await send('POST', '/query', { query: sql }), table);
    },
    async insertRow(table, row) {
      const data = await send('POST', `/table/${table}/row`, [row]);
      const saved = Array.isArray(data) ? data[0] : data;
      return normalize(saved?.[table] || saved);
    },
    async updateRow(table, row) {
      const data = await send('PATCH', `/table/${table}/row`, [row]);
      const saved = Array.isArray(data) ? data[0] : data;
      return normalize(saved?.[table] || saved);
    },
  };
}

function createSdkClient(app) {
  return {
    async query(table, sql) {
      return unwrap(await app.zcql().executeZCQLQuery(sql), table);
    },
    async insertRow(table, row) {
      return normalize(await app.datastore().table(table).insertRow(row));
    },
    async updateRow(table, row) {
      return normalize(await app.datastore().table(table).updateRow(row));
    },
  };
}

export function createCatalystStore() {
  let client = null;
  const onCatalyst = Boolean(process.env.X_ZOHO_CATALYST_LISTEN_PORT);
  if (!onCatalyst) client = createRestClient();
  return {
    kind: 'catalyst',
    attach(req) {
      if (client || !onCatalyst) return;
      const header = req?.headers?.['x-zc-projectid'];
      if (!header) return;
      const catalyst = require('zcatalyst-sdk-node');
      client = createSdkClient(catalyst.initialize(req, { scope: 'admin' }));
    },
    async ping() {
      if (!client) return true;
      await client.query('companies', 'SELECT ROWID FROM companies LIMIT 0, 1');
      return true;
    },
    async find(table, where = {}) {
      if (!client) throw new Error('CATALYST_CONTEXT');
      const filters = Object.entries(where).map(([key, value]) => `${key} = ${quote(value)}`);
      const clause = filters.length ? ` WHERE ${filters.join(' AND ')}` : '';
      const rows = [];
      let offset = 0;
      while (offset < 900) {
        const page = await client.query(table, `SELECT * FROM ${table}${clause} LIMIT ${offset}, 300`);
        rows.push(...page);
        if (page.length < 300) break;
        offset += 300;
      }
      return rows;
    },
    async insert(table, input) {
      if (!client) throw new Error('CATALYST_CONTEXT');
      const id = String(input.id || newId());
      const row = normalize({ ...input, id, row_key: input.row_key || id });
      return client.insertRow(table, row);
    },
    async update(table, id, patch) {
      const [current] = await this.find(table, { id });
      if (!current?.ROWID) return null;
      const next = normalize({ ...patch, ROWID: current.ROWID });
      return client.updateRow(table, next);
    },
  };
}

export async function openStore(options = {}) {
  if (options.store === 'memory') return createMemoryStore();
  return createCatalystStore();
}
