// Customer and supplier masters (Sales → Customers, Purchase → Suppliers).
// Core fields live in the `customers` / `suppliers` tables; the rest of the
// master (type, address parts, bank details, credit terms) is kept as JSON in
// settings under party_<kind>_<id>, the same way item profiles are kept.
import { STATES } from '../shared/domain.mjs';
import { decodeGstin, lookupGstin, lookupIfsc, lookupPincode } from './party-lookup.mjs';

const KINDS = {
  customer: { table: 'customers', prefix: 'CUST', label: 'customer', permission: 'customers.view', feature: 'customers', editRoles: ['owner', 'manager', 'service_advisor', 'sales'], mobileRequired: true },
  supplier: { table: 'suppliers', prefix: 'SUPP', label: 'supplier', permission: 'purchase.view', feature: 'purchase', editRoles: ['owner', 'manager', 'accountant'], mobileRequired: false },
};
export const PARTY_TYPES = ['registered', 'unregistered', 'composition'];

const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const digits = (value, max = 20) => String(value ?? '').replace(/\D/g, '').slice(0, max);
const amount = (value) => (value === '' || value == null ? '' : Number(value) >= 0 ? Number(value).toFixed(2) : null);
const now = () => new Date().toISOString();

function mobileOf(value) {
  const plain = digits(value, 15);
  return plain.length > 10 && plain.startsWith('91') ? plain.slice(-10) : plain.length === 11 && plain.startsWith('0') ? plain.slice(1) : plain;
}

function profileKey(kind, id) {
  return `party_${kind}_${id}`;
}

async function readProfiles(store, companyId, kind) {
  const rows = await store.find('settings', { company_id: companyId });
  const map = new Map();
  const prefix = `party_${kind}_`;
  for (const row of rows) {
    if (!String(row.setting_key).startsWith(prefix)) continue;
    try { map.set(row.setting_key.slice(prefix.length), JSON.parse(row.setting_value)); } catch { /* skip broken */ }
  }
  return map;
}

async function writeProfile(store, companyId, kind, id, profile) {
  const key = profileKey(kind, id);
  const [current] = await store.find('settings', { company_id: companyId, setting_key: key });
  const value = JSON.stringify(profile);
  if (current) await store.update('settings', current.id, { setting_value: value });
  else await store.insert('settings', { company_id: companyId, setting_key: key, setting_value: value });
}

function nextCode(prefix, used) {
  let max = 0;
  for (const code of used) {
    const match = String(code || '').match(new RegExp(`^${prefix}-(\\d+)$`));
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`;
}

function shape(kind, row, profile = {}) {
  const bank = profile.bank || {};
  return {
    id: row.id,
    kind,
    code: profile.code || '',
    name: row.name,
    type: profile.type || (row.gstin ? 'registered' : 'unregistered'),
    gstin: row.gstin || '',
    pan: profile.pan || (row.gstin ? row.gstin.slice(2, 12) : ''),
    mobile: row.mobile || '',
    altMobile: row.alt_mobile || profile.altMobile || '',
    email: row.email || '',
    contactPerson: profile.contactPerson || '',
    address1: profile.address1 ?? row.address ?? '',
    address2: profile.address2 || '',
    pincode: profile.pincode || '',
    area: profile.area || '',
    city: row.city || profile.city || '',
    taluka: profile.taluka || '',
    district: profile.district || '',
    stateCode: row.state_code || '',
    state: STATES.find(([code]) => code === row.state_code)?.[1] || '',
    country: profile.country || 'India',
    creditDays: profile.creditDays ?? '',
    creditLimit: profile.creditLimit ?? '',
    openingBalance: profile.openingBalance ?? '',
    balanceType: profile.balanceType || (kind === 'supplier' ? 'cr' : 'dr'),
    notes: row.notes || '',
    active: profile.active !== false,
    bank: {
      holder: bank.holder || '',
      accountNumber: bank.accountNumber || '',
      ifsc: bank.ifsc || '',
      bankName: bank.bankName || '',
      branch: bank.branch || '',
      address: bank.address || '',
      city: bank.city || '',
      micr: bank.micr || '',
      accountType: bank.accountType || 'Current',
      upi: bank.upi || '',
    },
    createdAt: row.created_at || '',
  };
}

export function registerParties(app, store, { auth, allow, route, fail }) {
  function kindOf(req, res) {
    const kind = KINDS[req.params.kind] ? req.params.kind : null;
    if (!kind) fail(res, 404, 'NOT_FOUND', 'Unknown master.');
    return kind;
  }
  // Permission + module check for the kind in the URL.
  const gate = (req, res, next) => {
    const kind = kindOf(req, res);
    if (!kind) return undefined;
    return allow(KINDS[kind].permission, KINDS[kind].feature)(req, res, next);
  };
  const canEdit = (req, kind) => KINDS[kind].editRoles.includes(req.session.user.role?.code);
  // Look-ups are open to anyone who can see either master.
  const lookupGate = (req, res, next) => {
    const ok = Object.values(KINDS).some((meta) => req.session.user.permissions.includes(meta.permission)
      && req.session.modules.find((item) => item.key === meta.feature)?.enabled);
    if (!ok) return fail(res, 403, 'PERMISSION_DENIED', 'You do not have permission for this action.');
    return next();
  };

  async function listFor(companyId, kind) {
    const meta = KINDS[kind];
    const rows = (await store.find(meta.table, { company_id: companyId }))
      .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')) || String(a.name).localeCompare(String(b.name)));
    const profiles = await readProfiles(store, companyId, kind);
    // Older records (for example customers added at the service desk) get a code the first time the list is read.
    const used = [...profiles.values()].map((profile) => profile.code);
    for (const row of rows) {
      const profile = profiles.get(row.id) || {};
      if (profile.code) continue;
      profile.code = nextCode(meta.prefix, used);
      used.push(profile.code);
      profiles.set(row.id, profile);
      await writeProfile(store, companyId, kind, row.id, profile);
    }
    return rows.map((row) => shape(kind, row, profiles.get(row.id)));
  }

  // ---------- look-ups ----------
  app.get('/api/parties/lookup/pincode/:pin', auth, lookupGate, route(async (req, res) => {
    const result = await lookupPincode(req.params.pin);
    if (result.error) return fail(res, 404, 'NOT_FOUND', result.error);
    res.json(result);
  }));

  app.get('/api/parties/lookup/ifsc/:ifsc', auth, lookupGate, route(async (req, res) => {
    const result = await lookupIfsc(req.params.ifsc);
    if (result.error) return fail(res, 404, 'NOT_FOUND', result.error);
    res.json(result);
  }));

  // GSTIN: check digit, state, PAN and entity type always; full name and address from
  // the GST lookup service when a key is set. A party already saved with this GSTIN
  // is returned too, so its details can be reused.
  app.get('/api/parties/lookup/gstin/:gstin', auth, lookupGate, route(async (req, res) => {
    const result = await lookupGstin(req.params.gstin);
    if (result.error) return fail(res, 400, 'INVALID', result.error);
    const matches = [];
    for (const kind of Object.keys(KINDS)) {
      if (!req.session.user.permissions.includes(KINDS[kind].permission)) continue;
      for (const party of await listFor(req.companyId, kind)) if (party.gstin === result.gstin) matches.push(party);
    }
    res.json({ ...result, matches });
  }));

  // Bank account number: details already saved in SKPOS for that account
  // (holder, IFSC, bank, branch, address).
  app.get('/api/parties/lookup/account/:number', auth, lookupGate, route(async (req, res) => {
    const number = digits(req.params.number, 20);
    if (number.length < 6) return fail(res, 400, 'INVALID', 'Enter the full account number.');
    for (const kind of Object.keys(KINDS)) {
      if (!req.session.user.permissions.includes(KINDS[kind].permission)) continue;
      const hit = (await listFor(req.companyId, kind)).find((party) => party.bank.accountNumber === number);
      if (hit) return res.json({ found: true, source: `${hit.code} · ${hit.name}`, bank: hit.bank });
    }
    res.json({ found: false, message: 'This account number is not saved in SKPOS yet. Enter the IFSC to fetch the bank, branch and address, then type the account holder name.' });
  }));

  // ---------- masters ----------
  app.get('/api/parties/:kind', auth, gate, route(async (req, res) => {
    const kind = req.params.kind;
    const items = await listFor(req.companyId, kind);
    const used = items.map((item) => item.code);
    res.json({ items, nextCode: nextCode(KINDS[kind].prefix, used), canEdit: canEdit(req, kind) });
  }));

  app.get('/api/parties/:kind/:id', auth, gate, route(async (req, res) => {
    const kind = req.params.kind;
    const party = (await listFor(req.companyId, kind)).find((item) => item.id === req.params.id);
    if (!party) return fail(res, 404, 'NOT_FOUND', `That ${KINDS[kind].label} was not found.`);
    res.json(party);
  }));

  async function validate(req, kind, body, existing) {
    const meta = KINDS[kind];
    const name = clean(body.name, 120);
    if (name.length < 2) return { error: `Enter the ${meta.label} name.` };
    const type = PARTY_TYPES.includes(body.type) ? body.type : 'unregistered';
    const mobile = mobileOf(body.mobile);
    if (meta.mobileRequired && !mobile) return { error: 'Enter a 10-digit mobile number.' };
    if (mobile && !/^[6-9]\d{9}$/.test(mobile)) return { error: 'Enter a 10-digit Indian mobile number.' };
    const altMobile = mobileOf(body.altMobile);
    if (altMobile && !/^[6-9]\d{9}$/.test(altMobile)) return { error: 'The alternate mobile must be a 10-digit number.' };
    const email = clean(body.email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'Enter a valid email address.' };
    let gstin = clean(body.gstin, 15).toUpperCase();
    let stateCode = clean(body.stateCode, 4);
    if (type === 'unregistered') gstin = '';
    if (type !== 'unregistered') {
      if (!gstin) return { error: `A ${type === 'composition' ? 'composition' : 'registered'} ${meta.label} needs a GSTIN.` };
      // A GSTIN saved before this check existed is kept; a new or changed one must pass the check digit.
      const decoded = decodeGstin(gstin, { checksum: !(existing && existing.gstin === gstin) });
      if (decoded.error) return { error: decoded.error };
      if (stateCode && stateCode !== decoded.stateCode) return { error: `The GSTIN is for ${decoded.state}, but the address state is different. Please check.` };
      stateCode = decoded.stateCode;
    }
    if (stateCode && !STATES.some(([code]) => code === stateCode)) return { error: 'Choose a valid state.' };
    const pincode = digits(body.pincode, 6);
    if (body.pincode && !/^[1-9]\d{5}$/.test(pincode)) return { error: 'The pincode must be 6 digits.' };
    const pan = clean(body.pan, 10).toUpperCase();
    if (pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) return { error: 'PAN must look like ABCDE1234F.' };
    if (gstin && pan && gstin.slice(2, 12) !== pan) return { error: 'The PAN does not match the PAN inside the GSTIN.' };

    const bankIn = body.bank || {};
    const accountNumber = digits(bankIn.accountNumber, 20);
    if (accountNumber && (accountNumber.length < 6 || accountNumber.length > 18)) return { error: 'The bank account number should be 6 to 18 digits.' };
    const ifsc = clean(bankIn.ifsc, 11).toUpperCase();
    if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) return { error: 'IFSC must look like SBIN0001234.' };
    if (accountNumber && !ifsc) return { error: 'Enter the IFSC for the bank account.' };
    for (const [label, value] of [['credit limit', body.creditLimit], ['opening balance', body.openingBalance]]) {
      if (amount(value) === null) return { error: `The ${label} must be a number.` };
    }
    if (body.creditDays !== '' && body.creditDays != null && !(Number.isInteger(Number(body.creditDays)) && Number(body.creditDays) >= 0)) return { error: 'Credit days must be a whole number.' };

    const rows = await store.find(meta.table, { company_id: req.companyId });
    if (mobile) {
      const clash = rows.find((row) => row.mobile === mobile && row.id !== existing?.id);
      if (clash) return { error: `That mobile already belongs to ${clash.name}.`, code: 409 };
    }
    if (gstin) {
      const clash = rows.find((row) => row.gstin === gstin && row.id !== existing?.id);
      if (clash) return { error: `GSTIN ${gstin} is already saved for ${clash.name}.`, code: 409 };
    }
    const address1 = clean(body.address1, 160);
    const address2 = clean(body.address2, 160);
    const area = clean(body.area, 80);
    return {
      core: {
        name,
        mobile,
        email,
        gstin,
        address: [address1, address2, area].filter(Boolean).join(', ').slice(0, 300),
        city: clean(body.city, 60),
        state_code: stateCode || req.session.tenant.stateCode || '',
        notes: clean(body.notes, 500),
        ...(kind === 'customer' ? { alt_mobile: altMobile } : {}),
      },
      profile: {
        type,
        pan: gstin ? gstin.slice(2, 12) : pan,
        altMobile,
        contactPerson: clean(body.contactPerson, 80),
        address1,
        address2,
        pincode,
        area,
        city: clean(body.city, 60),
        taluka: clean(body.taluka, 60),
        district: clean(body.district, 60),
        country: clean(body.country, 40) || 'India',
        creditDays: body.creditDays === '' || body.creditDays == null ? '' : String(Number(body.creditDays)),
        creditLimit: amount(body.creditLimit),
        openingBalance: amount(body.openingBalance),
        balanceType: body.balanceType === 'cr' ? 'cr' : 'dr',
        active: body.active !== false,
        bank: {
          holder: clean(bankIn.holder, 100),
          accountNumber,
          ifsc,
          bankName: clean(bankIn.bankName, 100),
          branch: clean(bankIn.branch, 100),
          address: clean(bankIn.address, 250),
          city: clean(bankIn.city, 60),
          micr: digits(bankIn.micr, 9),
          accountType: ['Savings', 'Current', 'Cash Credit', 'Overdraft'].includes(bankIn.accountType) ? bankIn.accountType : 'Current',
          upi: clean(bankIn.upi, 60),
        },
      },
    };
  }

  app.post('/api/parties/:kind', auth, gate, route(async (req, res) => {
    const kind = req.params.kind;
    if (!canEdit(req, kind)) return fail(res, 403, 'PERMISSION_DENIED', `Your role cannot add ${KINDS[kind].label}s.`);
    const checked = await validate(req, kind, req.body ?? {}, null);
    if (checked.error) return fail(res, checked.code || 400, checked.code === 409 ? 'DUPLICATE' : 'INVALID', checked.error);
    const existing = await listFor(req.companyId, kind);
    const saved = await store.insert(KINDS[kind].table, { company_id: req.companyId, ...checked.core, created_at: now() });
    const profile = { ...checked.profile, code: nextCode(KINDS[kind].prefix, existing.map((item) => item.code)) };
    await writeProfile(store, req.companyId, kind, saved.id, profile);
    res.status(201).json(shape(kind, saved, profile));
  }));

  app.patch('/api/parties/:kind/:id', auth, gate, route(async (req, res) => {
    const kind = req.params.kind;
    if (!canEdit(req, kind)) return fail(res, 403, 'PERMISSION_DENIED', `Your role cannot edit ${KINDS[kind].label}s.`);
    const [row] = await store.find(KINDS[kind].table, { id: req.params.id });
    if (!row || row.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', `That ${KINDS[kind].label} was not found.`);
    const profiles = await readProfiles(store, req.companyId, kind);
    const current = shape(kind, row, profiles.get(row.id));
    const body = req.body ?? {};
    // { active } alone just switches the status.
    if (Object.keys(body).length === 1 && 'active' in body) {
      const profile = { ...(profiles.get(row.id) || {}), active: body.active !== false };
      await writeProfile(store, req.companyId, kind, row.id, profile);
      return res.json(shape(kind, row, profile));
    }
    const merged = { ...current, ...body, bank: { ...current.bank, ...(body.bank || {}) } };
    const checked = await validate(req, kind, merged, row);
    if (checked.error) return fail(res, checked.code || 400, checked.code === 409 ? 'DUPLICATE' : 'INVALID', checked.error);
    const saved = await store.update(KINDS[kind].table, row.id, checked.core);
    const profile = { ...checked.profile, code: current.code };
    await writeProfile(store, req.companyId, kind, row.id, profile);
    res.json(shape(kind, { ...row, ...saved, ...checked.core }, profile));
  }));
}
