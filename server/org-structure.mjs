// Configurations → Organisation Structure
//   1. Organisation / Company profile        (companies row + setting org_profile)
//   2. Locations                             (locations rows, extra fields on the row)
//   3. Counters / Registers per location     (table registers)
//   4. Register-wise transaction numbering   (registers.series + registers.counters)
//   5. Register-wise employee mapping        (registers.users = [{ userId, isDefault }])
// Documents ask numberFor() for the next number; it falls back to the normal company series.

export const SERIES_TYPES = [
  { key: 'sales.bill', label: 'Sales Bill', short: 'SB' },
  { key: 'sales.return', label: 'Sales Return', short: 'SR' },
  { key: 'sales.order', label: 'Sales Order', short: 'SO' },
  { key: 'sales.quotation', label: 'Sales Quotation', short: 'SQ' },
];
export const REGISTER_TYPES = [
  { id: 'pos', label: 'POS billing counter' },
  { id: 'backoffice', label: 'Back-office / desk' },
  { id: 'mobile', label: 'Mobile / tablet' },
  { id: 'service', label: 'Service counter' },
];
const LOCATION_KINDS = ['store', 'warehouse', 'service_bay', 'office'];

const clean = (value, max = 120) => String(value ?? '').trim().slice(0, max);
const parse = (text, fallback) => { try { const v = JSON.parse(text || ''); return v ?? fallback; } catch { return fallback; } };
const isCode = (value) => /^[A-Z0-9][A-Z0-9-]{0,19}$/.test(value);
const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Financial-year tag like 2627 for Apr-2026 … Mar-2027 (start month from the company profile).
export function fyTag(date = new Date(), startMonth = 4) {
  const y = date.getFullYear();
  const start = date.getMonth() + 1 >= startMonth ? y : y - 1;
  return startMonth === 1 ? String(start).slice(2) : `${String(start).slice(2)}${String(start + 1).slice(2)}`;
}

export function formatSeries(series, n, fy) {
  const digits = Math.min(Math.max(Number(series.digits) || 4, 1), 9);
  return `${series.prefix}${series.fy ? `${fy}-` : ''}${String(n).padStart(digits, '0')}`;
}

export function registerOrgStructure(app, store, { auth, allow, route, fail, on, writeSetting, loadSession, locationAllowed }) {
  const canView = allow('settings.view', 'settings');
  const canManage = allow('settings.manage', 'settings');
  const locks = new Map();
  const lock = (key, fn) => { const prev = locks.get(key) || Promise.resolve(); const next = prev.then(fn, fn); locks.set(key, next.catch(() => {})); return next; };

  async function profileOf(companyId) {
    const [row] = await store.find('settings', { company_id: companyId, setting_key: 'org_profile' });
    return { fyStartMonth: 4, requireRegister: false, ...parse(row?.setting_value, {}) };
  }

  const shapeLocation = (row) => ({
    id: row.id, name: row.name, code: row.code || '', kind: row.kind || 'store', active: on(row.is_active),
    address1: row.address1 || '', address2: row.address2 || '', city: row.city || '', district: row.district || '', pincode: row.pincode || '',
    stateCode: row.state_code || '', phone: row.phone || '', email: row.email || '', gstin: row.gstin || '', manager: row.manager || '', openedOn: row.opened_on || '',
  });
  const shapeRegister = (row) => ({
    id: row.id, locationId: row.location_id, code: row.code, name: row.name, type: row.type || 'pos', active: on(row.is_active),
    notes: row.notes || '', printer: row.printer || '', openingFloat: row.opening_float || '',
    series: parse(row.series, {}), counters: parse(row.counters, {}), users: parse(row.users, []),
  });

  async function usersWithLocations(companyId) {
    const users = await store.find('users', { company_id: companyId });
    const roles = await store.find('roles', { company_id: companyId });
    const links = await store.find('user_locations', { company_id: companyId });
    return users.map((user) => {
      const role = roles.find((item) => item.id === user.role_id);
      return { id: user.id, name: user.name, email: user.email, status: user.status, role: role?.name || '', roleCode: role?.code || '', locationIds: links.filter((row) => row.user_id === user.id).map((row) => row.location_id) };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------- whole structure ----------
  app.get('/api/org/structure', auth, canView, route(async (req, res) => {
    const [company] = await store.find('companies', { id: req.companyId });
    const profile = await profileOf(req.companyId);
    const locations = (await store.find('locations', { company_id: req.companyId })).map(shapeLocation).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
    const registers = (await store.find('registers', { company_id: req.companyId })).map(shapeRegister).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    const fy = fyTag(new Date(), Number(profile.fyStartMonth) || 4);
    for (const reg of registers) {
      reg.preview = {};
      for (const t of SERIES_TYPES) {
        const s = reg.series[t.key];
        if (!s?.prefix) continue;
        const c = reg.counters[t.key] || {};
        const n = s.reset === 'yearly' && c.fy !== fy ? Number(s.start) || 1 : Math.max((Number(c.last) || 0) + 1, Number(s.start) || 1);
        reg.preview[t.key] = formatSeries(s, n, fy);
      }
    }
    res.json({
      company: { name: company?.name || '', legalName: company?.legal_name || '', gstin: company?.gstin || '', stateCode: company?.state_code || '', businessType: company?.business_type || '', ...profile },
      locations, registers, users: await usersWithLocations(req.companyId),
      seriesTypes: SERIES_TYPES, registerTypes: REGISTER_TYPES, limits: req.session.limits, fy,
    });
  }));

  // ---------- 1. company ----------
  app.put('/api/org/company', auth, canManage, route(async (req, res) => {
    const b = req.body || {};
    const name = clean(b.name, 120);
    if (name.length < 2) return fail(res, 400, 'INVALID', 'Enter the organisation / business name.');
    const gstin = clean(b.gstin, 15).toUpperCase();
    if (gstin && !GSTIN.test(gstin)) return fail(res, 400, 'INVALID', 'The GSTIN does not look right (15 characters, e.g. 27ABCDE1234F1Z5).');
    const stateCode = clean(b.stateCode, 2);
    if (gstin && stateCode && gstin.slice(0, 2) !== stateCode) return fail(res, 400, 'INVALID', `The GSTIN starts with ${gstin.slice(0, 2)} but the state code is ${stateCode}.`);
    const pan = clean(b.pan, 10).toUpperCase();
    if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) return fail(res, 400, 'INVALID', 'The PAN does not look right (e.g. ABCDE1234F).');
    const fyStartMonth = Math.min(Math.max(Number(b.fyStartMonth) || 4, 1), 12);
    await store.update('companies', req.companyId, { name, legal_name: clean(b.legalName, 160) || name, gstin, ...(stateCode ? { state_code: stateCode } : {}) });
    const profile = {
      tradeName: clean(b.tradeName, 120), pan, cin: clean(b.cin, 30).toUpperCase(), address1: clean(b.address1, 160), address2: clean(b.address2, 160),
      city: clean(b.city, 60), district: clean(b.district, 60), pincode: clean(b.pincode, 6), phone: clean(b.phone, 20), email: clean(b.email, 120),
      website: clean(b.website, 160), owner: clean(b.owner, 80), currency: clean(b.currency, 5) || 'INR', fyStartMonth,
      requireRegister: Boolean(b.requireRegister), logoUrl: /^https:\/\//i.test(String(b.logoUrl || '')) ? clean(b.logoUrl, 400) : '',
    };
    await writeSetting(store, req.companyId, 'org_profile', JSON.stringify(profile));
    res.json({ ok: true, session: await loadSession(store, req.session.user.id) });
  }));

  // ---------- 2. locations ----------
  async function saveLocation(req, res, row) {
    const b = req.body || {};
    const name = clean(b.name, 80);
    if (name.length < 2) return fail(res, 400, 'INVALID', 'Enter the location name.');
    const code = clean(b.code, 10).toUpperCase();
    if (code && !isCode(code)) return fail(res, 400, 'INVALID', 'Location code: letters, numbers and “-” only (e.g. AND or WH-1).');
    const all = await store.find('locations', { company_id: req.companyId });
    if (all.some((l) => l.id !== row?.id && l.name.toLowerCase() === name.toLowerCase())) return fail(res, 409, 'DUPLICATE', `There is already a location called ${name}.`);
    if (code && all.some((l) => l.id !== row?.id && String(l.code || '').toUpperCase() === code)) return fail(res, 409, 'DUPLICATE', `Location code ${code} is already used.`);
    const gstin = clean(b.gstin, 15).toUpperCase();
    if (gstin && !GSTIN.test(gstin)) return fail(res, 400, 'INVALID', 'The location GSTIN does not look right.');
    const kind = LOCATION_KINDS.includes(b.kind) ? b.kind : 'store';
    const active = b.active === undefined ? true : Boolean(b.active);
    const activeRows = all.filter((l) => on(l.is_active) && l.id !== row?.id);
    if (active && (!row || !on(row.is_active)) && activeRows.length >= req.session.limits.locations) return fail(res, 400, 'LIMIT', `This plan allows ${req.session.limits.locations} active location(s).`);
    if (!active && row && on(row.is_active) && !activeRows.length) return fail(res, 400, 'INVALID', 'Keep at least one active location.');
    const fields = {
      name, code, kind, is_active: active ? 1 : 0, address1: clean(b.address1, 160), address2: clean(b.address2, 160), city: clean(b.city, 60), district: clean(b.district, 60),
      pincode: clean(b.pincode, 6), state_code: clean(b.stateCode, 2), phone: clean(b.phone, 20), email: clean(b.email, 120), gstin, manager: clean(b.manager, 80), opened_on: clean(b.openedOn, 10),
    };
    const saved = row ? await store.update('locations', row.id, fields) : await store.insert('locations', { company_id: req.companyId, ...fields });
    res.status(row ? 200 : 201).json(shapeLocation(saved));
  }
  app.post('/api/org/locations', auth, allow('locations.manage'), route(async (req, res) => saveLocation(req, res, null)));
  app.put('/api/org/locations/:id', auth, allow('locations.manage'), route(async (req, res) => {
    const [row] = await store.find('locations', { id: req.params.id });
    if (!row || row.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Location not found.');
    return saveLocation(req, res, row);
  }));

  // ---------- 3/4/5. registers ----------
  async function saveRegister(req, res, row) {
    const b = req.body || {};
    const current = row ? shapeRegister(row) : null;
    const locationId = String(b.locationId ?? current?.locationId ?? '');
    const [location] = await store.find('locations', { id: locationId });
    if (!location || location.company_id !== req.companyId) return fail(res, 400, 'INVALID', 'Choose the location of this counter.');
    const code = clean(b.code ?? current?.code, 10).toUpperCase();
    if (!isCode(code)) return fail(res, 400, 'INVALID', 'Counter code: letters, numbers and “-” only (e.g. C1 or POS-2).');
    const name = clean(b.name ?? current?.name, 60);
    if (name.length < 2) return fail(res, 400, 'INVALID', 'Enter the counter name (e.g. Counter 1).');
    const all = (await store.find('registers', { company_id: req.companyId })).map(shapeRegister);
    if (all.some((r) => r.id !== row?.id && r.locationId === locationId && r.code === code)) return fail(res, 409, 'DUPLICATE', `${location.name} already has a counter with code ${code}.`);
    const type = REGISTER_TYPES.some((t) => t.id === b.type) ? b.type : current?.type || 'pos';

    // numbering
    const series = {};
    const incoming = b.series && typeof b.series === 'object' ? b.series : current?.series || {};
    for (const t of SERIES_TYPES) {
      const s = incoming[t.key];
      if (!s || !clean(s.prefix, 20)) continue;
      const prefix = clean(s.prefix, 20).toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9-]{0,19}$/.test(prefix)) return fail(res, 400, 'INVALID', `${t.label} prefix: letters, numbers and “-” only (no spaces or “/”).`);
      const digits = Math.round(Number(s.digits) || 4);
      if (digits < 3 || digits > 8) return fail(res, 400, 'INVALID', `${t.label}: number of digits must be 3 to 8.`);
      const start = Math.round(Number(s.start) || 1);
      if (start < 1) return fail(res, 400, 'INVALID', `${t.label}: start number must be 1 or more.`);
      series[t.key] = { prefix, digits, start, reset: s.reset === 'yearly' ? 'yearly' : 'never', fy: Boolean(s.fy) };
      const clash = all.find((r) => r.id !== row?.id && r.series?.[t.key]?.prefix === prefix && Boolean(r.series[t.key].fy) === Boolean(s.fy));
      if (clash) return fail(res, 409, 'DUPLICATE', `${t.label} prefix ${prefix} is already used by counter ${clash.code}. Each counter needs its own prefix so numbers never repeat.`);
      const companyPrefix = `${t.short}-`;
      if (prefix === companyPrefix) return fail(res, 400, 'INVALID', `${t.label}: ${companyPrefix} is the company-wide series — add the location / counter code, e.g. ${location.code || 'LOC'}-${code}-${t.short}-.`);
    }

    // employees (only people who can work at this location)
    const users = await usersWithLocations(req.companyId);
    const wantUsers = Array.isArray(b.users) ? b.users : current?.users || [];
    const mapped = [];
    for (const u of wantUsers) {
      const user = users.find((item) => item.id === String(u.userId));
      if (!user) continue;
      if (user.locationIds.length && !user.locationIds.includes(locationId)) return fail(res, 400, 'INVALID', `${user.name} does not have access to ${location.name}. Give access in User Creations first.`);
      if (!mapped.some((m) => m.userId === user.id)) mapped.push({ userId: user.id, isDefault: Boolean(u.isDefault) });
    }
    const active = b.active === undefined ? current?.active ?? true : Boolean(b.active);
    const fields = {
      location_id: locationId, code, name, type, is_active: active ? 1 : 0, notes: clean(b.notes ?? current?.notes, 200), printer: clean(b.printer ?? current?.printer, 80),
      opening_float: clean(b.openingFloat ?? current?.openingFloat, 12), series: JSON.stringify(series), users: JSON.stringify(mapped),
    };
    const saved = row ? await store.update('registers', row.id, fields) : await store.insert('registers', { company_id: req.companyId, counters: '{}', created_at: new Date().toISOString(), ...fields });
    // one default counter per employee per location
    for (const m of mapped.filter((x) => x.isDefault)) {
      for (const other of all.filter((r) => r.id !== saved.id && r.locationId === locationId && r.users.some((x) => x.userId === m.userId && x.isDefault))) {
        await store.update('registers', other.id, { users: JSON.stringify(other.users.map((x) => (x.userId === m.userId ? { ...x, isDefault: false } : x))) });
      }
    }
    res.status(row ? 200 : 201).json(shapeRegister(saved));
  }
  app.post('/api/org/registers', auth, canManage, route(async (req, res) => saveRegister(req, res, null)));
  app.put('/api/org/registers/:id', auth, canManage, route(async (req, res) => {
    const [row] = await store.find('registers', { id: req.params.id });
    if (!row || row.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Counter not found.');
    return saveRegister(req, res, row);
  }));

  // ---------- for billing windows: my counters at a location ----------
  const isOwner = (req) => req.session.user.role?.code === 'owner';
  async function myRegisters(req, locationId) {
    const regs = (await store.find('registers', { company_id: req.companyId, location_id: locationId })).map(shapeRegister).filter((r) => r.active);
    return regs.filter((r) => isOwner(req) || !r.users.length || r.users.some((u) => u.userId === req.session.user.id));
  }
  app.get('/api/org/my-registers', auth, route(async (req, res) => {
    const locationId = String(req.query.locationId || '');
    if (!locationAllowed(req.session, locationId)) return fail(res, 403, 'PERMISSION_DENIED', 'That location is outside your access.');
    const profile = await profileOf(req.companyId);
    const fy = fyTag(new Date(), Number(profile.fyStartMonth) || 4);
    const allHere = (await store.find('registers', { company_id: req.companyId, location_id: locationId })).map(shapeRegister).filter((r) => r.active);
    const mine = await myRegisters(req, locationId);
    const def = mine.find((r) => r.users.some((u) => u.userId === req.session.user.id && u.isDefault)) || (mine.length === 1 ? mine[0] : null);
    res.json({
      items: mine.map((r) => ({ id: r.id, code: r.code, name: r.name, type: r.type, series: Object.fromEntries(Object.entries(r.series).map(([k, s]) => { const c = r.counters[k] || {}; const n = s.reset === 'yearly' && c.fy !== fy ? s.start : Math.max((Number(c.last) || 0) + 1, s.start); return [k, formatSeries(s, n, fy)]; })) })),
      defaultId: def?.id || '', required: Boolean(profile.requireRegister) && allHere.length > 0, anyHere: allHere.length > 0,
    });
  }));

  // Next number for a document. Returns { number, register } or { error } or null (use the company series).
  async function numberFor(req, { key, locationId, registerId, used = [] }) {
    const here = (await store.find('registers', { company_id: req.companyId, location_id: locationId })).map(shapeRegister).filter((r) => r.active);
    if (!here.length) return null;
    const profile = await profileOf(req.companyId);
    const mine = await myRegisters(req, locationId);
    let reg = null;
    if (registerId) {
      reg = here.find((r) => r.id === String(registerId));
      if (!reg) return { error: 'That counter is not active at this location.' };
      if (!mine.some((r) => r.id === reg.id)) return { error: `You are not mapped to counter ${reg.code} – ${reg.name}.` };
    } else {
      reg = mine.find((r) => r.users.some((u) => u.userId === req.session.user.id && u.isDefault)) || (mine.length === 1 ? mine[0] : null);
      if (!reg && profile.requireRegister) return { error: mine.length ? 'Choose the counter / register for this bill.' : 'You are not mapped to any counter at this location. Ask the owner to map you in Organisation Structure → Employees.' };
      if (!reg) return null;
    }
    const series = reg.series[key];
    if (!series?.prefix) return { number: '', register: reg }; // counter without its own series for this type → company series
    return lock(`${req.companyId}|${reg.id}`, async () => {
      const [fresh] = await store.find('registers', { id: reg.id });
      const counters = parse(fresh.counters, {});
      const fy = fyTag(new Date(), Number(profile.fyStartMonth) || 4);
      const c = counters[key] || {};
      let n = series.reset === 'yearly' && c.fy !== fy ? series.start : Math.max((Number(c.last) || 0) + 1, series.start);
      const taken = new Set(used.map((x) => String(x).toUpperCase()));
      let number = formatSeries(series, n, fy);
      while (taken.has(number)) { n += 1; number = formatSeries(series, n, fy); }
      counters[key] = { last: n, fy };
      await store.update('registers', reg.id, { counters: JSON.stringify(counters) });
      return { number, register: reg };
    });
  }

  return { numberFor, myRegisters };
}
