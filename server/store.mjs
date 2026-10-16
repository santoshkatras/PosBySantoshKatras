import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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

export function createMemoryStore(initial = null, onChange = null) {
  const tables = new Map(initial ? Object.entries(initial) : []);
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
      onChange?.(tables, table, row);
      return clone(row);
    },
    async update(table, id, patch) {
      const bucket = tables.get(table) || [];
      const row = bucket.find((item) => same(item.id, id));
      if (!row) return null;
      const next = normalize({ ...row, ...patch, id: row.id, row_key: row.row_key });
      for (const key of Object.keys(row)) delete row[key];
      Object.assign(row, next);
      onChange?.(tables, table, row);
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

function packageRoot(candidate) {
  const beside = join(dirname(candidate), 'node_modules', 'zcatalyst-cli');
  if (existsSync(join(beside, 'lib', 'authentication', 'credential.js'))) return beside;
  let root = realpathSync(candidate);
  if (root.endsWith('.js')) root = dirname(dirname(dirname(root)));
  if (existsSync(join(root, 'lib', 'authentication', 'credential.js'))) return root;
  return null;
}

function cliPackage() {
  const names = process.platform === 'win32' ? ['catalyst.cmd', 'catalyst', 'catalyst.ps1'] : ['catalyst'];
  const dirs = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
  if (process.env.HOME) dirs.push(join(process.env.HOME, '.local', 'bin'));
  if (process.env.APPDATA) dirs.push(join(process.env.APPDATA, 'npm'));
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (!existsSync(candidate)) continue;
      const root = packageRoot(candidate);
      if (root) return root;
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
  function clearToken() {
    tokenPromise = null;
  }
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
  async function send(method, path, body, retry = true) {
    const response = await fetch(`https://api.catalyst.zoho.com/baas/v1/project/${PROJECT_ID}${path}`, {
      method,
      headers: await headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    const message = payload.data?.message || payload.message || `Catalyst request failed (${response.status})`;
    if (retry && /oauth token/i.test(message)) {
      clearToken();
      return send(method, path, body, false);
    }
    if (!response.ok || payload.status === 'failure') throw new Error(message);
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

// File store: the memory store saved to one JSON file (for a single server with its own disk,
// e.g. an AWS Lightsail / EC2 instance). Writes are batched and atomic (temp file + rename).
export function createFileStore(file) {
  mkdirSync(dirname(file), { recursive: true });
  let initial = null;
  if (existsSync(file)) initial = JSON.parse(readFileSync(file, 'utf8') || '{}');
  let timer = null;
  let latest = null;
  const flush = () => {
    timer = null;
    if (!latest) return;
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(latest)));
    renameSync(tmp, file);
  };
  const store = createMemoryStore(initial, (tables) => { latest = tables; if (!timer) timer = setTimeout(flush, 300); });
  store.kind = 'file';
  store.flush = () => { if (timer) clearTimeout(timer); flush(); };
  return store;
}

// SQLite store (default): every record lives in data/stockkeep.sqlite (table skpos_records, one row per
// record, JSON data). Reads come from an in-memory copy loaded at start; every insert / update is written
// to SQLite immediately, so nothing is lost when the app stops. Uses Node's built-in node:sqlite.
export async function createSqliteStore(file) {
  const { DatabaseSync } = await import('node:sqlite');
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS skpos_records (
      tbl TEXT NOT NULL,
      id TEXT NOT NULL,
      company_id TEXT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (tbl, id)
    );
    CREATE INDEX IF NOT EXISTS skpos_records_company ON skpos_records (tbl, company_id);
  `);
  const initial = {};
  for (const row of db.prepare('SELECT tbl, data FROM skpos_records ORDER BY rowid').all()) {
    (initial[row.tbl] ||= []).push(JSON.parse(row.data));
  }
  const upsert = db.prepare(`INSERT INTO skpos_records (tbl, id, company_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (tbl, id) DO UPDATE SET company_id = excluded.company_id, data = excluded.data, updated_at = excluded.updated_at`);
  const store = createMemoryStore(initial, (_tables, table, row) => {
    const now = new Date().toISOString();
    upsert.run(table, String(row.id), row.company_id == null ? null : String(row.company_id), JSON.stringify(row), now, now);
  });
  store.kind = 'sqlite';
  store.file = file;
  store.flush = () => {};
  store.close = () => db.close();
  return store;
}

// Postgres store (Supabase): same layout as the SQLite store — one table skpos_records with JSON data.
// Reads come from an in-memory copy loaded at start; every insert / update is written to Postgres before
// the call returns. Run ONE server instance against a database (the cache is per process).
// Set DATABASE_URL to the Supabase "Session pooler" connection string.
export async function createPostgresStore(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: url,
    ssl: /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false },
    max: 5,
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS skpos_records (
      tbl TEXT NOT NULL,
      id TEXT NOT NULL,
      company_id TEXT,
      data JSONB NOT NULL,
      seq BIGSERIAL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tbl, id)
    );
    CREATE INDEX IF NOT EXISTS skpos_records_company ON skpos_records (tbl, company_id);
    ALTER TABLE skpos_records ENABLE ROW LEVEL SECURITY;
  `);
  const initial = {};
  const { rows } = await pool.query('SELECT tbl, data FROM skpos_records ORDER BY seq');
  for (const row of rows) (initial[row.tbl] ||= []).push(row.data);
  const save = (table, row) => pool.query(
    `INSERT INTO skpos_records (tbl, id, company_id, data) VALUES ($1, $2, $3, $4)
     ON CONFLICT (tbl, id) DO UPDATE SET company_id = EXCLUDED.company_id, data = EXCLUDED.data, updated_at = now()`,
    [table, String(row.id), row.company_id == null ? null : String(row.company_id), JSON.stringify(row)],
  );
  const store = createMemoryStore(initial);
  const memInsert = store.insert.bind(store);
  const memUpdate = store.update.bind(store);
  store.insert = async (table, input) => {
    const row = await memInsert(table, input);
    await save(table, row);
    return row;
  };
  store.update = async (table, id, patch) => {
    const row = await memUpdate(table, id, patch);
    if (row) await save(table, row);
    return row;
  };
  store.kind = 'postgres';
  store.ping = async () => { await pool.query('SELECT 1'); return true; };
  store.flush = () => {};
  store.close = () => pool.end();
  return store;
}

export async function openStore(options = {}) {
  const onCatalyst = Boolean(process.env.X_ZOHO_CATALYST_LISTEN_PORT);
  const kind = options.store || process.env.STORE || (onCatalyst ? 'catalyst' : process.env.DATABASE_URL ? 'postgres' : 'sqlite');
  if (kind === 'memory') return createMemoryStore();
  if (kind === 'postgres') return createPostgresStore(process.env.DATABASE_URL);
  if (kind === 'file') return createFileStore(process.env.DATA_FILE || join(process.cwd(), 'data', 'skpos-data.json'));
  if (kind === 'sqlite') return createSqliteStore(process.env.SQLITE_FILE || join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'stockkeep.sqlite'));
  return createCatalystStore();
}
