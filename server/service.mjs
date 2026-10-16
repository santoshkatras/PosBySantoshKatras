// Car and bike workshop: customers, vehicles, job cards, estimates, approvals,
// parts issue from stock, QC, GST invoice, payments, delivery, and live updates.
import {
  ACCESSORIES,
  BOARD_COLUMNS,
  INSPECTION,
  JOB_STATUSES,
  LABOUR_GST,
  LABOUR_SAC,
  NEXT_SERVICE,
  OPEN_STATUSES,
  PAYMENT_MODES,
  QC_CHECKS,
  SERVICE_PACKAGES,
  SERVICE_TYPES,
  TRANSITIONS,
  VEHICLE_TYPES,
  addDays,
  formatRegNo,
  jobTotals,
  lineMath,
  normalizeMobile,
  normalizeRegNo,
  serviceCaps,
  serviceTypeLabel,
  statusLabel,
} from '../shared/service.mjs';
import { readAccess } from './auth.mjs';
import { loadSession } from './session.mjs';

const listeners = new Map(); // companyId -> Set(res)

export function broadcast(companyId, payload) {
  const set = listeners.get(String(companyId));
  if (!set) return;
  const text = `data: ${JSON.stringify({ ...payload, at: new Date().toISOString() })}\n\n`;
  for (const res of set) {
    try { res.write(text); } catch { /* closed */ }
  }
}

const now = () => new Date().toISOString();
const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const fixed = (value, digits = 2) => num(value).toFixed(digits);
const on = (value) => Number(value) === 1;

function parseJson(text, fallback) {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function validDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function dayOnly(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

async function nextNumber(store, companyId, key, prefix) {
  const [row] = await store.find('settings', { company_id: companyId, setting_key: key });
  const next = num(row?.setting_value) + 1;
  if (row) await store.update('settings', row.id, { setting_value: String(next) });
  else await store.insert('settings', { company_id: companyId, setting_key: key, setting_value: String(next) });
  return `${prefix}${String(next).padStart(5, '0')}`;
}

async function staffOf(store, companyId) {
  const users = await store.find('users', { company_id: companyId });
  const roles = await store.find('roles', { company_id: companyId });
  return users.filter((user) => user.status === 'active').map((user) => {
    const role = roles.find((item) => item.id === user.role_id);
    return { id: user.id, name: user.name, roleCode: role?.code || '', roleName: role?.name || '' };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

function shapeCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    mobile: row.mobile || '',
    altMobile: row.alt_mobile || '',
    email: row.email || '',
    address: row.address || '',
    city: row.city || '',
    stateCode: row.state_code || '',
    gstin: row.gstin || '',
    notes: row.notes || '',
    createdAt: row.created_at || '',
  };
}

function shapeVehicle(row) {
  if (!row) return null;
  return {
    id: row.id,
    customerId: row.customer_id,
    vehicleType: row.vehicle_type || 'bike',
    regNo: row.reg_no || '',
    regLabel: formatRegNo(row.reg_no),
    make: row.make || '',
    model: row.model || '',
    variant: row.variant || '',
    fuelType: row.fuel_type || '',
    year: row.year || '',
    color: row.color || '',
    vin: row.vin || '',
    engineNo: row.engine_no || '',
    odometer: num(row.odometer),
    insuranceExpiry: row.insurance_expiry || '',
    insurer: row.insurer || '',
    pucExpiry: row.puc_expiry || '',
    nextServiceDate: row.next_service_date || '',
    nextServiceKm: row.next_service_km ? num(row.next_service_km) : null,
    lastServiceAt: row.last_service_at || '',
    createdAt: row.created_at || '',
  };
}

function shapeLine(row) {
  const math = lineMath(row);
  return {
    id: row.id,
    lineType: row.line_type,
    description: row.description,
    variantId: row.variant_id || '',
    sku: row.sku || '',
    hsnSac: row.hsn_sac || '',
    qty: num(row.qty),
    rate: num(row.rate),
    discount: num(row.discount),
    gstRate: num(row.gst_rate),
    taxable: Math.round(math.taxable * 100) / 100,
    tax: Math.round(math.tax * 100) / 100,
    total: Math.round(math.total * 100) / 100,
    approval: row.approval || 'pending',
    issuedQty: num(row.issued_qty),
    mechanicId: row.mechanic_id || '',
    done: on(row.done),
    requestedBy: row.requested_by || '',
    hours: row.hours ? num(row.hours) : null,
    createdAt: row.created_at || '',
  };
}

function shapeJobSummary(job, maps) {
  const customer = maps.customers.get(job.customer_id);
  const vehicle = maps.vehicles.get(job.vehicle_id);
  const mechanic = maps.staff.get(job.mechanic_id);
  const advisor = maps.staff.get(job.advisor_id);
  const location = maps.locations.get(job.location_id);
  const grand = num(job.grand_total);
  const paid = num(job.paid_total);
  const promised = job.promised_at ? new Date(job.promised_at).getTime() : 0;
  const open = OPEN_STATUSES.includes(job.status);
  return {
    id: job.id,
    jobNo: job.job_no,
    status: job.status,
    statusLabel: statusLabel(job.status),
    serviceType: job.service_type,
    serviceTypeLabel: serviceTypeLabel(vehicle?.vehicle_type, job.service_type),
    customer: customer ? { id: customer.id, name: customer.name, mobile: customer.mobile || '' } : null,
    vehicle: vehicle ? { id: vehicle.id, vehicleType: vehicle.vehicle_type, regNo: vehicle.reg_no, regLabel: formatRegNo(vehicle.reg_no), make: vehicle.make || '', model: vehicle.model || '' } : null,
    mechanic: mechanic ? { id: mechanic.id, name: mechanic.name } : null,
    advisor: advisor ? { id: advisor.id, name: advisor.name } : null,
    location: location ? { id: location.id, name: location.name } : null,
    bay: job.bay || '',
    odometerIn: num(job.odometer_in),
    checkedInAt: job.checked_in_at,
    promisedAt: job.promised_at || '',
    deliveredAt: job.delivered_at || '',
    updatedAt: job.updated_at || job.checked_in_at,
    overdue: open && promised > 0 && promised < Date.now(),
    pendingApprovals: num(job.pending_count),
    estimateTotal: num(job.estimate_total),
    grandTotal: grand,
    paidTotal: paid,
    balance: Math.max(0, Math.round((grand - paid) * 100) / 100),
    invoiceNo: job.invoice_no || '',
    complaints: parseJson(job.complaints, []),
  };
}

async function loadMaps(store, companyId) {
  const [customers, vehicles, staff, locations] = await Promise.all([
    store.find('customers', { company_id: companyId }),
    store.find('vehicles', { company_id: companyId }),
    staffOf(store, companyId),
    store.find('locations', { company_id: companyId }),
  ]);
  return {
    customers: new Map(customers.map((row) => [row.id, row])),
    vehicles: new Map(vehicles.map((row) => [row.id, row])),
    staff: new Map(staff.map((row) => [row.id, row])),
    locations: new Map(locations.map((row) => [row.id, row])),
    staffList: staff,
    customerRows: customers,
    vehicleRows: vehicles,
  };
}

async function intraStateFor(store, companyId, customerId) {
  const [company] = await store.find('companies', { id: companyId });
  const [customer] = customerId ? await store.find('customers', { id: customerId }) : [];
  if (!customer?.state_code || !company?.state_code) return true;
  return String(customer.state_code) === String(company.state_code);
}

// Recompute and store totals on the job so lists stay cheap.
export async function recalc(store, job) {
  const lines = (await store.find('job_lines', { job_id: job.id, company_id: job.company_id })).filter((row) => row.approval !== 'removed');
  const intra = await intraStateFor(store, job.company_id, job.customer_id);
  const totals = jobTotals(lines, intra);
  const estimate = jobTotals(lines.filter((row) => row.approval !== 'declined').map((row) => ({ ...row, approval: 'approved' })), intra);
  const payments = await store.find('job_payments', { job_id: job.id, company_id: job.company_id });
  const paid = payments.reduce((sum, row) => sum + num(row.amount), 0);
  const patch = {
    labour_total: fixed(totals.labour),
    parts_total: fixed(totals.parts),
    tax_total: fixed(totals.tax),
    grand_total: fixed(totals.grand),
    estimate_total: fixed(estimate.grand),
    paid_total: fixed(paid),
    pending_count: String(lines.filter((row) => row.approval === 'pending').length),
    updated_at: now(),
  };
  return store.update('job_cards', job.id, patch);
}

async function addEvent(store, job, session, kind, text) {
  await store.insert('job_events', {
    company_id: job.company_id,
    job_id: job.id,
    kind,
    text: clean(text, 500),
    user_id: session?.user?.id || '',
    user_name: session?.user?.name || 'System',
    created_at: now(),
  });
}

async function moveStock(store, { companyId, locationId, variantId, delta, type, note }) {
  const [level] = await store.find('stock_levels', { company_id: companyId, location_id: locationId, variant_id: variantId });
  const next = num(level?.qty_on_hand) + delta;
  if (next < -0.0001) return { error: 'Not enough stock at that location.' };
  if (level) await store.update('stock_levels', level.id, { qty_on_hand: next.toFixed(3) });
  else await store.insert('stock_levels', { company_id: companyId, location_id: locationId, variant_id: variantId, qty_on_hand: next.toFixed(3) });
  await store.insert('stock_movements', {
    company_id: companyId,
    location_id: locationId,
    variant_id: variantId,
    qty: delta.toFixed(3),
    movement_type: type,
    reason: type,
    note,
    created_at: now(),
  });
  return { qtyOnHand: next };
}

export function registerService(app, store, { auth, allow, route, fail, locationAllowed, scopedLocations }) {
  const svc = allow('bike_service.view', 'bike_service');
  const cust = allow('customers.view', 'customers');

  function caps(req) {
    return serviceCaps(req.session);
  }

  function needs(cap, message = 'Your role cannot do this on a job card.') {
    return (req, res, next) => (caps(req)[cap] ? next() : fail(res, 403, 'PERMISSION_DENIED', message));
  }

  async function getJob(req, res) {
    const [job] = await store.find('job_cards', { id: req.params.id });
    if (!job || job.company_id !== req.companyId || !locationAllowed(req.session, job.location_id)) {
      fail(res, 404, 'NOT_FOUND', 'Job card not found.');
      return null;
    }
    return job;
  }

  function mechanicOwns(req, job) {
    const c = caps(req);
    if (c.desk) return true;
    return !job.mechanic_id || job.mechanic_id === req.session.user.id;
  }

  // ---------- live updates (server-sent events) ----------
  app.get('/api/service/stream', route(async (req, res) => {
    const payload = readAccess(String(req.query.token || ''));
    if (!payload) return fail(res, 401, 'UNAUTHENTICATED', 'Sign in again.');
    const session = await loadSession(store, payload.sub);
    if (!session || session.tenant.id !== String(payload.tid)) return fail(res, 401, 'UNAUTHENTICATED', 'Sign in again.');
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify({ type: 'hello', at: now() })}\n\n`);
    const key = session.tenant.id;
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* closed */ } }, 25000);
    req.on('close', () => {
      clearInterval(ping);
      listeners.get(key)?.delete(res);
    });
  }));

  // ---------- reference data ----------
  app.get('/api/service/meta', auth, svc, route(async (req, res) => {
    const staff = await staffOf(store, req.companyId);
    const locations = (await scopedLocations(store, req.session)).filter((row) => on(row.is_active));
    const allLocations = (await store.find('locations', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const stockLocations = req.session.user.locationIds.length ? locations : allLocations;
    const products = (await store.find('products', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const variants = (await store.find('variants', { company_id: req.companyId })).filter((row) => on(row.is_active));
    const levels = await store.find('stock_levels', { company_id: req.companyId });
    const parts = [];
    for (const variant of variants) {
      const product = products.find((row) => row.id === variant.product_id);
      if (!product || on(product.is_service)) continue;
      const stock = stockLocations.map((location) => {
        const level = levels.find((row) => row.variant_id === variant.id && row.location_id === location.id);
        return { locationId: location.id, locationName: location.name, qty: num(level?.qty_on_hand) };
      });
      parts.push({
        variantId: variant.id,
        sku: variant.sku,
        name: product.name,
        hsn: product.hsn_sac || '',
        gstRate: num(product.gst_rate || 18),
        rate: num(variant.sale_price || variant.mrp),
        mrp: num(variant.mrp),
        stock,
        onHand: stock.reduce((sum, row) => sum + row.qty, 0),
      });
    }
    parts.sort((a, b) => a.name.localeCompare(b.name));
    res.json({
      caps: caps(req),
      staff,
      mechanics: staff.filter((row) => row.roleCode === 'mechanic'),
      advisors: staff.filter((row) => ['owner', 'manager', 'service_advisor'].includes(row.roleCode)),
      locations: locations.map((row) => ({ id: row.id, name: row.name, kind: row.kind })),
      stockLocations: stockLocations.map((row) => ({ id: row.id, name: row.name })),
      parts,
      packages: SERVICE_PACKAGES,
      serviceTypes: SERVICE_TYPES,
      statuses: JOB_STATUSES,
      columns: BOARD_COLUMNS,
      inspection: INSPECTION,
      accessories: ACCESSORIES,
      qcChecks: QC_CHECKS,
      paymentModes: PAYMENT_MODES,
      vehicleTypes: VEHICLE_TYPES,
      companyStateCode: req.session.tenant.stateCode,
    });
  }));

  // Search by mobile, name, or registration number at the reception desk.
  app.get('/api/service/lookup', auth, svc, route(async (req, res) => {
    const q = clean(req.query.q, 60).toLowerCase();
    if (q.length < 2) return res.json({ items: [] });
    const reg = normalizeRegNo(q).toLowerCase();
    const digits = q.replace(/\D/g, '');
    const customers = await store.find('customers', { company_id: req.companyId });
    const vehicles = await store.find('vehicles', { company_id: req.companyId });
    const jobs = await store.find('job_cards', { company_id: req.companyId });
    const hits = new Map();
    for (const customer of customers) {
      const byName = customer.name.toLowerCase().includes(q);
      const byMobile = digits.length >= 3 && String(customer.mobile || '').includes(digits);
      if (byName || byMobile) hits.set(customer.id, customer);
    }
    for (const vehicle of vehicles) {
      if (reg.length >= 2 && String(vehicle.reg_no || '').toLowerCase().includes(reg)) {
        const customer = customers.find((row) => row.id === vehicle.customer_id);
        if (customer) hits.set(customer.id, customer);
      }
    }
    const items = [...hits.values()].slice(0, 12).map((customer) => ({
      ...shapeCustomer(customer),
      vehicles: vehicles.filter((row) => row.customer_id === customer.id).map((vehicle) => {
        const openJob = jobs.find((job) => job.vehicle_id === vehicle.id && OPEN_STATUSES.includes(job.status));
        return { ...shapeVehicle(vehicle), openJob: openJob ? { id: openJob.id, jobNo: openJob.job_no, status: openJob.status } : null };
      }),
    }));
    res.json({ items });
  }));

  // ---------- board and lists ----------
  app.get('/api/service/board', auth, svc, route(async (req, res) => {
    const maps = await loadMaps(store, req.companyId);
    const all = (await store.find('job_cards', { company_id: req.companyId })).filter((job) => locationAllowed(req.session, job.location_id));
    const today = new Date().toISOString().slice(0, 10);
    const open = all.filter((job) => OPEN_STATUSES.includes(job.status));
    const deliveredToday = all.filter((job) => job.status === 'delivered' && String(job.delivered_at || '').slice(0, 10) === today);
    const jobs = open.map((job) => shapeJobSummary(job, maps)).sort((a, b) => String(a.checkedInAt).localeCompare(String(b.checkedInAt)));
    const payments = (await store.find('job_payments', { company_id: req.companyId })).filter((row) => String(row.created_at).slice(0, 10) === today);
    const mechanics = maps.staffList.filter((row) => row.roleCode === 'mechanic').map((mechanic) => ({
      id: mechanic.id,
      name: mechanic.name,
      active: open.filter((job) => job.mechanic_id === mechanic.id && ['in_progress', 'waiting_parts'].includes(job.status)).length,
      queued: open.filter((job) => job.mechanic_id === mechanic.id && ['approved', 'checked_in', 'awaiting_approval'].includes(job.status)).length,
    }));
    res.json({
      kpis: {
        inWorkshop: open.length,
        checkedInToday: all.filter((job) => String(job.checked_in_at).slice(0, 10) === today).length,
        awaitingApproval: open.filter((job) => job.status === 'awaiting_approval' || num(job.pending_count) > 0).length,
        onFloor: open.filter((job) => ['in_progress', 'waiting_parts'].includes(job.status)).length,
        ready: open.filter((job) => job.status === 'ready').length,
        deliveredToday: deliveredToday.length,
        overdue: jobs.filter((job) => job.overdue).length,
        collectedToday: payments.reduce((sum, row) => sum + num(row.amount), 0),
        billedToday: deliveredToday.reduce((sum, job) => sum + num(job.grand_total), 0),
      },
      jobs,
      deliveredToday: deliveredToday.map((job) => shapeJobSummary(job, maps)),
      mechanics,
      serverTime: now(),
    });
  }));

  app.get('/api/service/jobs', auth, svc, route(async (req, res) => {
    const maps = await loadMaps(store, req.companyId);
    const status = clean(req.query.status, 30);
    const items = (await store.find('job_cards', { company_id: req.companyId }))
      .filter((job) => locationAllowed(req.session, job.location_id))
      .filter((job) => !status || status === 'all' || (status === 'open' ? OPEN_STATUSES.includes(job.status) : job.status === status))
      .map((job) => shapeJobSummary(job, maps))
      .sort((a, b) => String(b.checkedInAt).localeCompare(String(a.checkedInAt)));
    res.json({ items });
  }));

  // ---------- check-in ----------
  app.post('/api/service/jobs', auth, svc, needs('desk', 'Only the service desk can open a job card.'), route(async (req, res) => {
    const body = req.body ?? {};
    const locationId = String(body.locationId || '');
    const [location] = await store.find('locations', { id: locationId });
    if (!location || location.company_id !== req.companyId || !on(location.is_active)) return fail(res, 400, 'INVALID', 'Choose the workshop location.');
    if (!locationAllowed(req.session, locationId)) return fail(res, 403, 'PERMISSION_DENIED', 'That location is outside your access.');

    // Customer: existing or new
    let customer;
    if (body.customerId) {
      [customer] = await store.find('customers', { id: body.customerId });
      if (!customer || customer.company_id !== req.companyId) return fail(res, 400, 'INVALID', 'Customer not found.');
    } else {
      const input = body.customer || {};
      const name = clean(input.name, 120);
      const mobile = normalizeMobile(input.mobile);
      if (name.length < 2) return fail(res, 400, 'INVALID', 'Enter the customer name.');
      if (!/^[6-9]\d{9}$/.test(mobile)) return fail(res, 400, 'INVALID', 'Enter a 10-digit Indian mobile number.');
      const existing = (await store.find('customers', { company_id: req.companyId, mobile }))[0];
      if (existing) customer = existing;
      else {
        customer = await store.insert('customers', {
          company_id: req.companyId,
          name,
          mobile,
          email: clean(input.email, 120),
          address: clean(input.address, 300),
          city: clean(input.city, 60),
          state_code: clean(input.stateCode || req.session.tenant.stateCode, 4),
          gstin: clean(input.gstin, 15).toUpperCase(),
          created_at: now(),
        });
      }
    }

    // Vehicle: existing or new
    let vehicle;
    if (body.vehicleId) {
      [vehicle] = await store.find('vehicles', { id: body.vehicleId });
      if (!vehicle || vehicle.company_id !== req.companyId || vehicle.customer_id !== customer.id) return fail(res, 400, 'INVALID', 'Vehicle not found for this customer.');
    } else {
      const input = body.vehicle || {};
      const regNo = normalizeRegNo(input.regNo);
      if (regNo.length < 4) return fail(res, 400, 'INVALID', 'Enter the registration number.');
      if (!['car', 'bike'].includes(input.vehicleType)) return fail(res, 400, 'INVALID', 'Choose car or bike.');
      const clash = (await store.find('vehicles', { company_id: req.companyId, reg_no: regNo }))[0];
      if (clash && clash.customer_id !== customer.id) {
        const [owner] = await store.find('customers', { id: clash.customer_id });
        return fail(res, 409, 'VEHICLE_OWNER', `${formatRegNo(regNo)} is registered to ${owner?.name || 'another customer'}. Open that customer, or transfer the vehicle first.`);
      }
      if (clash) vehicle = clash;
      else {
        vehicle = await store.insert('vehicles', {
          company_id: req.companyId,
          customer_id: customer.id,
          vehicle_type: input.vehicleType,
          reg_no: regNo,
          make: clean(input.make, 60),
          model: clean(input.model, 60),
          variant: clean(input.variant, 60),
          fuel_type: clean(input.fuelType, 20),
          year: clean(input.year, 4),
          color: clean(input.color, 30),
          vin: clean(input.vin, 30).toUpperCase(),
          engine_no: clean(input.engineNo, 30).toUpperCase(),
          insurer: clean(input.insurer, 60),
          insurance_expiry: dayOnly(input.insuranceExpiry),
          puc_expiry: dayOnly(input.pucExpiry),
          odometer: '0',
          created_at: now(),
        });
      }
    }

    const openJob = (await store.find('job_cards', { company_id: req.companyId, vehicle_id: vehicle.id })).find((job) => OPEN_STATUSES.includes(job.status));
    if (openJob) return fail(res, 409, 'OPEN_JOB', `${formatRegNo(vehicle.reg_no)} is already in the workshop on ${openJob.job_no}.`);

    const odometer = num(body.odometerIn);
    if (odometer <= 0) return fail(res, 400, 'INVALID', 'Enter the odometer reading.');
    if (odometer < num(vehicle.odometer)) return fail(res, 400, 'INVALID', `Odometer is lower than the last reading (${num(vehicle.odometer)} km). Check the reading.`);

    const serviceTypes = SERVICE_TYPES[vehicle.vehicle_type] || [];
    const serviceType = serviceTypes.some((item) => item[0] === body.serviceType) ? body.serviceType : serviceTypes[0]?.[0];
    const complaints = (Array.isArray(body.complaints) ? body.complaints : []).map((item) => clean(item, 200)).filter(Boolean).slice(0, 20);
    if (!complaints.length) return fail(res, 400, 'INVALID', 'Record at least one customer complaint or request.');

    const staff = await staffOf(store, req.companyId);
    const mechanic = staff.find((row) => row.id === body.mechanicId && row.roleCode === 'mechanic');
    const advisorId = staff.some((row) => row.id === body.advisorId) ? body.advisorId : req.session.user.id;
    const jobNo = await nextNumber(store, req.companyId, 'seq_job_card', 'JC-');
    const checkedIn = now();
    const job = await store.insert('job_cards', {
      company_id: req.companyId,
      job_no: jobNo,
      customer_id: customer.id,
      vehicle_id: vehicle.id,
      location_id: locationId,
      service_type: serviceType,
      status: 'checked_in',
      odometer_in: String(odometer),
      fuel_level: clean(body.fuelLevel, 10),
      complaints: JSON.stringify(complaints),
      inspection: JSON.stringify(body.inspection && typeof body.inspection === 'object' ? body.inspection : {}),
      accessories: JSON.stringify(Array.isArray(body.accessories) ? body.accessories.map((item) => clean(item, 60)) : []),
      advisor_id: advisorId,
      mechanic_id: mechanic?.id || '',
      bay: clean(body.bay, 20),
      promised_at: validDate(body.promisedAt),
      checked_in_at: checkedIn,
      insurer: clean(body.insurer, 60),
      claim_no: clean(body.claimNo, 40),
      coupon_no: clean(body.couponNo, 40),
      notes: clean(body.notes, 500),
      grand_total: '0.00',
      paid_total: '0.00',
      estimate_total: '0.00',
      pending_count: '0',
      updated_at: checkedIn,
    });

    const packages = SERVICE_PACKAGES[vehicle.vehicle_type] || [];
    for (const code of Array.isArray(body.packages) ? body.packages : []) {
      const pack = packages.find((item) => item.code === code);
      if (!pack) continue;
      await store.insert('job_lines', {
        company_id: req.companyId,
        job_id: job.id,
        line_type: 'labour',
        description: pack.name,
        hsn_sac: LABOUR_SAC,
        qty: '1',
        rate: fixed(pack.rate),
        discount: '0.00',
        gst_rate: LABOUR_GST,
        hours: String(pack.hours),
        approval: 'pending',
        issued_qty: '0',
        done: 0,
        requested_by: req.session.user.name,
        created_at: checkedIn,
      });
    }
    await store.update('vehicles', vehicle.id, { odometer: String(odometer) });
    await addEvent(store, job, req.session, 'checked_in', `Checked in at ${odometer} km by ${req.session.user.name}${mechanic ? `, assigned to ${mechanic.name}` : ''}.`);
    await recalc(store, job);
    broadcast(req.companyId, { type: 'job', id: job.id, jobNo });
    res.status(201).json({ id: job.id, jobNo });
  }));

  // ---------- job card ----------
  app.get('/api/service/jobs/:id', auth, svc, route(async (req, res) => {
    const job = await getJob(req, res);
    if (!job) return;
    const maps = await loadMaps(store, req.companyId);
    const customer = maps.customers.get(job.customer_id);
    const vehicle = maps.vehicles.get(job.vehicle_id);
    const lines = (await store.find('job_lines', { job_id: job.id, company_id: req.companyId }))
      .filter((row) => row.approval !== 'removed')
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const events = (await store.find('job_events', { job_id: job.id, company_id: req.companyId })).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const payments = (await store.find('job_payments', { job_id: job.id, company_id: req.companyId })).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const intra = await intraStateFor(store, req.companyId, job.customer_id);
    const totals = jobTotals(lines, intra);
    const estimate = jobTotals(lines.filter((row) => row.approval !== 'declined').map((row) => ({ ...row, approval: 'approved' })), intra);
    const previous = (await store.find('job_cards', { company_id: req.companyId, vehicle_id: job.vehicle_id }))
      .filter((row) => row.id !== job.id)
      .sort((a, b) => String(b.checked_in_at).localeCompare(String(a.checked_in_at)))
      .slice(0, 5)
      .map((row) => shapeJobSummary(row, maps));
    const [company] = await store.find('companies', { id: req.companyId });
    res.json({
      job: {
        ...shapeJobSummary(job, maps),
        fuelLevel: job.fuel_level || '',
        inspection: parseJson(job.inspection, {}),
        accessories: parseJson(job.accessories, []),
        qcChecks: parseJson(job.qc_checks, {}),
        qcNote: job.qc_note || '',
        notes: job.notes || '',
        insurer: job.insurer || '',
        claimNo: job.claim_no || '',
        couponNo: job.coupon_no || '',
        approvalChannel: job.approval_channel || '',
        approvedAt: job.approved_at || '',
        startedAt: job.started_at || '',
        qcAt: job.qc_at || '',
        readyAt: job.ready_at || '',
        invoicedAt: job.invoiced_at || '',
        cancelledAt: job.cancelled_at || '',
        cancelReason: job.cancel_reason || '',
        odometerOut: job.odometer_out ? num(job.odometer_out) : null,
        nextServiceDate: job.next_service_date || '',
        nextServiceKm: job.next_service_km ? num(job.next_service_km) : null,
        rating: job.rating ? num(job.rating) : null,
        feedback: job.feedback || '',
        creditAllowed: on(job.credit_allowed),
      },
      customer: shapeCustomer(customer),
      vehicle: shapeVehicle(vehicle),
      lines: lines.map(shapeLine),
      events: events.map((row) => ({ id: row.id, kind: row.kind, text: row.text, userName: row.user_name, at: row.created_at })),
      payments: payments.map((row) => ({ id: row.id, amount: num(row.amount), mode: row.mode, reference: row.reference || '', kind: row.kind || 'payment', at: row.created_at, userName: row.user_name || '' })),
      totals,
      estimate,
      intraState: intra,
      previous,
      company: { name: company?.name, legalName: company?.legal_name, gstin: company?.gstin || '', stateCode: company?.state_code },
      caps: caps(req),
      nextService: NEXT_SERVICE[vehicle?.vehicle_type] || NEXT_SERVICE.bike,
    });
  }));

  app.patch('/api/service/jobs/:id', auth, svc, route(async (req, res) => {
    const job = await getJob(req, res);
    if (!job) return;
    const c = caps(req);
    if (!OPEN_STATUSES.includes(job.status)) return fail(res, 400, 'CLOSED', 'This job card is closed.');
    const body = req.body ?? {};
    const patch = {};
    const notes = [];
    const staff = await staffOf(store, req.companyId);
    if (body.mechanicId !== undefined) {
      if (!c.desk) return fail(res, 403, 'PERMISSION_DENIED', 'Only the service desk can assign mechanics.');
      const mechanic = staff.find((row) => row.id === body.mechanicId && row.roleCode === 'mechanic');
      if (body.mechanicId && !mechanic) return fail(res, 400, 'INVALID', 'Choose a mechanic.');
      if ((job.mechanic_id || '') !== (mechanic?.id || '')) {
        patch.mechanic_id = mechanic?.id || '';
        notes.push(mechanic ? `Assigned to ${mechanic.name}.` : 'Mechanic unassigned.');
      }
    }
    if (c.desk) {
      if (body.bay !== undefined && clean(body.bay, 20) !== (job.bay || '')) { patch.bay = clean(body.bay, 20); notes.push(`Bay set to ${patch.bay || '—'}.`); }
      if (body.promisedAt !== undefined) {
        const promised = validDate(body.promisedAt);
        if (promised !== (job.promised_at || '')) { patch.promised_at = promised; notes.push('Promised delivery time changed.'); }
      }
      if (body.notes !== undefined) patch.notes = clean(body.notes, 500);
      if (body.insurer !== undefined) patch.insurer = clean(body.insurer, 60);
      if (body.claimNo !== undefined) patch.claim_no = clean(body.claimNo, 40);
      if (Array.isArray(body.complaints)) {
        const list = body.complaints.map((item) => clean(item, 200)).filter(Boolean).slice(0, 20);
        if (list.length) patch.complaints = JSON.stringify(list);
      }
    }
    if (!Object.keys(patch).length) return res.json({ ok: true });
    patch.updated_at = now();
    await store.update('job_cards', job.id, patch);
    for (const text of notes) await addEvent(store, job, req.session, 'update', text);
    broadcast(req.companyId, { type: 'job', id: job.id });
    res.json({ ok: true });
  }));

  // ---------- lines: estimate, additional work, parts ----------
  app.post('/api/service/jobs/:id/lines', auth, svc, needs('floor'), route(async (req, res) => {
    const job = await getJob(req, res);
    if (!job) return;
    if (!OPEN_STATUSES.includes(job.status) || job.status === 'ready') return fail(res, 400, 'CLOSED', 'Lines cannot be added at this stage.');
    if (!mechanicOwns(req, job)) return fail(res, 403, 'PERMISSION_DENIED', 'This job is assigned to another mechanic.');
    const c = caps(req);
    const body = req.body ?? {};
    const type = body.lineType === 'part' ? 'part' : 'labour';
    const qtyValue = num(body.qty || 1);
    if (qtyValue <= 0) return fail(res, 400, 'INVALID', 'Quantity must be more than zero.');
    const [vehicle] = await store.find('vehicles', { id: job.vehicle_id });
    const row = {
      company_id: req.companyId,
      job_id: job.id,
      line_type: type,
      qty: String(qtyValue),
      discount: c.desk ? fixed(body.discount || 0) : '0.00',
      issued_qty: '0',
      done: 0,
      requested_by: req.session.user.name,
      created_at: now(),
    };
    if (type === 'part') {
      const [variant] = await store.find('variants', { id: body.variantId });
      if (!variant || variant.company_id !== req.companyId) return fail(res, 400, 'INVALID', 'Choose a part from the catalogue.');
      const [product] = await store.find('products', { id: variant.product_id });
      row.variant_id = variant.id;
      row.sku = variant.sku;
      row.description = clean(body.description, 160) || product?.name || variant.sku;
      row.hsn_sac = product?.hsn_sac || '';
      row.rate = fixed(c.desk && body.rate !== undefined && body.rate !== '' ? body.rate : (variant.sale_price || variant.mrp || 0));
      row.gst_rate = String(num(product?.gst_rate || 18));
    } else {
      const pack = (SERVICE_PACKAGES[vehicle?.vehicle_type] || []).find((item) => item.code === body.packageCode);
      row.description = clean(body.description, 160) || pack?.name || '';
      if (row.description.length < 2) return fail(res, 400, 'INVALID', 'Describe the labour.');
      row.hsn_sac = LABOUR_SAC;
      row.rate = fixed(c.desk && body.rate !== undefined && body.rate !== '' ? body.rate : (pack?.rate || 0));
      row.gst_rate = String(num(c.desk && body.gstRate !== undefined ? body.gstRate : LABOUR_GST));
      if (pack) row.hours = String(pack.hours);
    }
    if (num(row.rate) < 0) return fail(res, 400, 'INVALID', 'Rate cannot be negative.');
    // Customer consent: desk can mark a line pre-approved when the customer agreed on the spot.
    const preApproved = c.desk && body.preApproved === true;
    row.approval = preApproved ? 'approved' : 'pending';
    const line = await store.insert('job_lines', row);
    const after = ['approved', 'in_progress', 'waiting_parts', 'qc'].includes(job.status);
    const label = `${type === 'part' ? 'Part' : 'Labour'}: ${row.description} × ${qtyValue}`;
    await addEvent(store, job, req.session, after && !preApproved ? 'additional' : 'line', after && !preApproved
      ? `Additional work found — ${label}. Needs customer approval.`
      : `${preApproved ? 'Added (customer approved)' : 'Added to estimate'} — ${label}.`);
    await recalc(store, job);
    broadcast(req.companyId, { type: 'job', id: job.id });
    res.status(201).json(shapeLine(line));
  }));

  app.patch('/api/service/jobs/:id/lines/:lineId', auth, svc, needs('floor'), route(async (req, res) => {
    const job = await getJob(req, res);
    if (!job) return;
    const [line] = await store.find('job_lines', { id: req.params.lineId });
    if (!line || line.job_id !== job.id || line.approval === 'removed') return fail(res, 404, 'NOT_FOUND', 'Line not found.');
    if (!OPEN_STATUSES.includes(job.status)) return fail(res, 400, 'CLOSED', 'This job card is closed.');
    const c = caps(req);
    const body = req.body ?? {};
    const patch = {};
    if (body.done !== undefined) {
      if (!mechanicOwns(req, job)) return fail(res, 403, 'PERMISSION_DENIED', 'This job is assigned to another mechanic.');
      if (line.approval !== 'approved') return fail(res, 400, 'INVALID', 'Only approved work can be marked done.');
      patch.done = body.done ? 1 : 0;
      if (body.done) await addEvent(store, job, req.session, 'task', `Done — ${line.description}.`);
    }
    if (c.desk && job.status !== 'ready') {
      if (body.qty !== undefined) {
        const value = num(body.qty);
        if (value <= 0) return fail(res, 400, 'INVALID', 'Quantity must be more than zero.');
        if (value < num(line.issued_qty)) return fail(res, 400, 'INVALID', 'Return issued parts before lowering the quantity.');
        patch.qty = String(value);
      }
      if (body.rate !== undefined) patch.rate = fixed(Math.max(0, num(body.rate)));
      if (body.discount !== undefined) patch.discount = fixed(Math.max(0, num(body.discount)));
      if (body.description !== undefined && clean(body.description, 160).length >= 2) patch.description = clean(body.description, 160);
      if (body.approval && ['approved', 'declined', 'pending'].includes(body.approval) && body.approval !== line.approval) {
        if (body.approval === 'declined' && num(line.issued_qty) > 0) return fail(res, 400, 'INVALID', 'Return the issued parts before declining this line.');
        patch.approval = body.approval;
        await addEvent(store, job, req.session, 'approval', `Customer ${body.approval === 'approved' ? 'approved' : body.approval === 'declined' ? 'declined' : 'reconsidering'} — ${line.description}${body.channel ? ` (${body.channel.replace('_', ' ')})` : ''}.`);
      }
    }
    if (!Object.keys(patch).length) return fail(res, 403, 'PERMISSION_DENIED', 'Nothing you can change on this line.');
    await store.update('job_lines', line.id, patch);
    await recalc(store, job);
    broadcast(req.companyId, { type: 'job', id: job.id });
    res.json({ ok: true });
  }));

  app.delete('/api/service/jobs/:id/lines/:lineId', auth, svc, needs('desk'), route(async (req, res) => {
    const job = await getJob(req, res);
    if (!job) return;
    const [line] = await store.find('job_lines', { id: req.params.lineId });
    if (!line || line.job_id !== job.id || line.approval === 'removed') return fail(res, 404, 'NOT_FOUND', 'Line not found.');
    if (!OPEN_STATUSES.includes(job.status) || job.status === 'ready') return fail(res, 400, 'CLOSED', 'Lines cannot be removed at this stage.');
    if (num(line.issued_qty) > 0) return fail(res, 400, 'INVALID', 'Return the issued parts to stock first.');
    await store.update('job_lines', line.id, { approval: 'removed' });
    await addEvent(store, job, req.session, 'line', `Removed — ${line.description}.`);
    await recalc(store, job);
    broadcast(req.companyId, { type: 'job', id: job.id });
    res.json({ ok: true });
  }));

  // Parts counter: issue approved parts from stock to the job, or take them back.
  app.post('/api/service/jobs/:id/lines/:lineId/issue', auth, svc, needs('issueParts', 'Only the parts counter or service desk can issue parts.'), route(async (req, res) => {
    const job = await getJob(req, res);
    if (!job) return;
    if (!['approved', 'in_progress', 'waiting_parts', 'qc'].includes(job.status)) return fail(res, 400, 'INVALID', 'Parts are issued after the customer approves the estimate.');
    const [line] = await store.find('job_lines', { id: req.params.lineId });
    if (!line || line.job_id !== job.id || line.line_type !== 'part') return fail(res, 404, 'NOT_FOUND', 'Part line not found.');
    const direction = req.body?.direction === 'return' ? 'return' : 'issue';
    const amount = num(req.body?.qty);
    if (amount <= 0) return fail(res, 400, 'INVALID', 'Enter a quantity.');
    const locationId = String(req.body?.locationId || '');
    if (!locationAllowed(req.session, locationId)) return fail(res, 403, 'PERMISSION_DENIED', 'That location is outside your access.');
    const [location] = await store.find('locations', { id: locationId });
    if (!location || location.company_id !== req.companyId) return fail(res, 400, 'INVALID', 'Choose the stock location.');
    const issued = num(line.issued_qty);
    if (direction === 'issue') {
      if (line.approval !== 'approved') return fail(res, 400, 'INVALID', 'The customer has not approved this part yet.');
      if (issued + amount > num(line.qty) + 0.0001) return fail(res, 400, 'INVALID', `Only ${num(line.qty) - issued} more can be issued on this line.`);
    } else if (amount > issued + 0.0001) {
      return fail(res, 400, 'INVALID', `Only ${issued} was issued on this line.`);
    }
    const moved = await moveStock(store, {
      companyId: req.companyId,
      locationId,
      variantId: line.variant_id,
      delta: direction === 'issue' ? -amount : amount,
      type: direction === 'issue' ? 'job_issue' : 'job_return',
      note: `${job.job_no} · ${line.description}`,
    });
    if (moved.error) return fail(res, 400, 'NEGATIVE', `${moved.error} ${location.name} has ${num((await store.find('stock_levels', { company_id: req.companyId, location_id: locationId, variant_id: line.variant_id }))[0]?.qty_on_hand)} on hand.`);
    const nextIssued = direction === 'issue' ? issued + amount : issued - amount;
    await store.update('job_lines', line.id, { issued_qty: String(nextIssued), issue_location_id: locationId });
    await addEvent(store, job, req.session, 'parts', `${direction === 'issue' ? 'Issued' : 'Returned'} ${amount} × ${line.description} ${direction === 'issue' ? 'from' : 'to'} ${location.name}.`);
    if (direction === 'issue' && job.status === 'waiting_parts') {
      const lines = (await store.find('job_lines', { job_id: job.id })).filter((row) => row.line_type === 'part' && row.approval === 'approved');
      const short = lines.some((row) => (row.id === line.id ? nextIssued : num(row.issued_qty)) < num(row.qty));
      if (!short) await addEvent(store, job, req.session, 'parts', 'All approved parts are now issued. Work can resume.');
    }
    await store.update('job_cards', job.id, { updated_at: now() });
    broadcast(req.companyId, { type: 'job', id: job.id });
    broadcast(req.companyId, { type: 'stock' });
    res.json({ issuedQty: nextIssued, qtyOnHand: moved.qtyOnHand });
  }));

  // ---------- workflow actions ----------
  app.post('/api/service/jobs/:id/action', auth, svc, route(async (req, res) => {
    const job = await getJob(req, res);
    if (!job) return;
    const c = caps(req);
    const body = req.body ?? {};
    const action = String(body.action || '');
    const rule = TRANSITIONS[action];
    if (!rule) return fail(res, 400, 'INVALID', 'Unknown action.');

    const deskOnly = ['send_estimate', 'approve', 'qc_fail', 'mark_ready', 'deliver', 'cancel'];
    if (deskOnly.includes(action) && !c.desk) return fail(res, 403, 'PERMISSION_DENIED', 'Only the service desk can do this.');
    if (!deskOnly.includes(action) && !c.floor) return fail(res, 403, 'PERMISSION_DENIED', 'Your role cannot move this job.');
    if (!deskOnly.includes(action) && !mechanicOwns(req, job)) return fail(res, 403, 'PERMISSION_DENIED', 'This job is assigned to another mechanic.');

    const lines = (await store.find('job_lines', { job_id: job.id, company_id: req.companyId })).filter((row) => row.approval !== 'removed');
    const patch = { updated_at: now() };
    let text = '';

    // Approving extra work mid-job keeps the status; at reception it moves to Approved.
    if (action === 'approve' && !rule.from.includes(job.status)) {
      if (!['approved', 'in_progress', 'waiting_parts', 'qc'].includes(job.status)) return fail(res, 400, 'INVALID', `Cannot approve while ${statusLabel(job.status).toLowerCase()}.`);
    } else if (!rule.from.includes(job.status)) {
      return fail(res, 400, 'INVALID', `Cannot ${action.replace('_', ' ')} while the job is ${statusLabel(job.status).toLowerCase()}.`);
    }

    if (action === 'send_estimate') {
      if (!lines.length) return fail(res, 400, 'INVALID', 'Add labour or parts to the estimate first.');
      text = `Estimate shared with customer${body.channel === 'in_person' ? ' in person' : body.channel ? ` on ${String(body.channel).replace('_', ' ')}` : ''}. Waiting for approval.`;
    }

    if (action === 'approve') {
      const decisions = body.decisions && typeof body.decisions === 'object' ? body.decisions : null;
      const pending = lines.filter((row) => row.approval === 'pending');
      if (!pending.length && !rule.from.includes(job.status)) return fail(res, 400, 'INVALID', 'Nothing is waiting for approval.');
      if (!lines.length) return fail(res, 400, 'INVALID', 'Add labour or parts to the estimate first.');
      let approved = 0;
      let declined = 0;
      for (const row of pending) {
        const decision = decisions?.[row.id] === 'declined' ? 'declined' : 'approved';
        await store.update('job_lines', row.id, { approval: decision });
        row.approval = decision;
        if (decision === 'approved') approved += 1; else declined += 1;
      }
      if (!lines.some((row) => row.approval === 'approved')) return fail(res, 400, 'INVALID', 'Approve at least one line, or cancel the job.');
      const channel = clean(body.channel || 'in_person', 20);
      if (rule.from.includes(job.status)) {
        patch.approved_at = now();
        patch.approval_channel = channel;
      }
      text = `Customer approved ${approved} line${approved === 1 ? '' : 's'}${declined ? `, declined ${declined}` : ''} (${channel.replace('_', ' ')}).`;
      if (!rule.from.includes(job.status)) {
        await recalc(store, job);
        await store.update('job_cards', job.id, patch);
        await addEvent(store, job, req.session, 'approval', text);
        broadcast(req.companyId, { type: 'job', id: job.id });
        return res.json({ ok: true, status: job.status });
      }
    }

    if (action === 'start') {
      if (!job.mechanic_id) {
        if (req.session.user.role.code !== 'mechanic') return fail(res, 400, 'INVALID', 'Assign a mechanic first.');
        patch.mechanic_id = req.session.user.id;
      }
      patch.started_at = job.started_at || now();
      text = 'Work started on the floor.';
    }

    if (action === 'wait_parts') {
      text = `On hold — waiting for parts${body.note ? `: ${clean(body.note, 200)}` : ''}.`;
    }

    if (action === 'resume') text = 'Work resumed.';

    if (action === 'send_qc') {
      if (lines.some((row) => row.approval === 'pending')) return fail(res, 400, 'INVALID', 'Some additional work is still waiting for customer approval.');
      const notDone = lines.filter((row) => row.approval === 'approved' && row.line_type === 'labour' && !on(row.done));
      if (notDone.length) return fail(res, 400, 'INVALID', `Mark these tasks done first: ${notDone.map((row) => row.description).join(', ')}.`);
      const short = lines.filter((row) => row.approval === 'approved' && row.line_type === 'part' && num(row.issued_qty) < num(row.qty));
      if (short.length) return fail(res, 400, 'INVALID', `Issue these parts from stock first: ${short.map((row) => row.description).join(', ')}.`);
      text = 'Work finished. Sent to quality check.';
    }

    if (action === 'qc_fail') {
      const note = clean(body.note, 300);
      if (!note) return fail(res, 400, 'INVALID', 'Say what failed in quality check.');
      patch.qc_note = note;
      text = `Quality check failed — ${note}. Sent back to the floor.`;
    }

    if (action === 'mark_ready') {
      const [vehicle] = await store.find('vehicles', { id: job.vehicle_id });
      const checks = body.checks && typeof body.checks === 'object' ? body.checks : {};
      const required = QC_CHECKS[vehicle?.vehicle_type] || [];
      const missing = required.filter((item) => !checks[item]);
      if (missing.length) return fail(res, 400, 'INVALID', `Tick every QC check: ${missing.join(', ')}.`);
      patch.qc_checks = JSON.stringify(checks);
      patch.qc_note = clean(body.note, 300);
      patch.qc_at = now();
      patch.ready_at = now();
      patch.invoice_no = job.invoice_no || await nextNumber(store, req.companyId, 'seq_service_invoice', 'SI-');
      patch.invoiced_at = job.invoiced_at || now();
      text = `Passed quality check. Invoice ${patch.invoice_no} raised. Ready for delivery.`;
    }

    if (action === 'deliver') {
      const fresh = await recalc(store, job);
      const balance = num(fresh.grand_total) - num(fresh.paid_total);
      if (balance > 0.5 && body.allowCredit !== true) return fail(res, 400, 'BALANCE', `Collect ₹${balance.toFixed(2)} before delivery, or allow credit.`);
      const [vehicle] = await store.find('vehicles', { id: job.vehicle_id });
      const interval = NEXT_SERVICE[vehicle?.vehicle_type] || NEXT_SERVICE.bike;
      const odometerOut = num(body.odometerOut) || num(job.odometer_in);
      if (odometerOut < num(job.odometer_in)) return fail(res, 400, 'INVALID', 'Odometer out cannot be lower than odometer in.');
      const nextDate = dayOnly(body.nextServiceDate) || addDays(null, interval.days);
      const nextKm = num(body.nextServiceKm) || odometerOut + interval.km;
      patch.odometer_out = String(odometerOut);
      patch.next_service_date = nextDate;
      patch.next_service_km = String(nextKm);
      patch.delivered_at = now();
      patch.credit_allowed = balance > 0.5 ? 1 : 0;
      const rating = num(body.rating);
      if (rating >= 1 && rating <= 5) patch.rating = String(rating);
      if (body.feedback) patch.feedback = clean(body.feedback, 300);
      await store.update('vehicles', vehicle.id, {
        odometer: String(odometerOut),
        next_service_date: nextDate,
        next_service_km: String(nextKm),
        last_service_at: now(),
      });
      text = `Delivered to customer at ${odometerOut} km${balance > 0.5 ? ` on credit (₹${balance.toFixed(2)} due)` : ''}. Next service by ${nextDate} or ${nextKm} km.`;
    }

    if (action === 'cancel') {
      const reason = clean(body.reason, 300);
      if (!reason) return fail(res, 400, 'INVALID', 'Give a reason for cancelling.');
      for (const row of lines.filter((item) => item.line_type === 'part' && num(item.issued_qty) > 0)) {
        const locationId = row.issue_location_id;
        if (!locationId) continue;
        await moveStock(store, { companyId: req.companyId, locationId, variantId: row.variant_id, delta: num(row.issued_qty), type: 'job_return', note: `${job.job_no} cancelled · ${row.description}` });
        await store.update('job_lines', row.id, { issued_qty: '0' });
      }
      const paid = num(job.paid_total);
      patch.cancelled_at = now();
      patch.cancel_reason = reason;
      text = `Job cancelled — ${reason}.${paid > 0 ? ` Refund ₹${paid.toFixed(2)} advance to the customer.` : ''}`;
    }

    patch.status = rule.to;
    await store.update('job_cards', job.id, patch);
    await addEvent(store, job, req.session, action, text);
    await recalc(store, { ...job, ...patch });
    broadcast(req.companyId, { type: 'job', id: job.id });
    res.json({ ok: true, status: rule.to });
  }));

  // ---------- payments ----------
  app.post('/api/service/jobs/:id/payments', auth, svc, needs('payments', 'Your role cannot take payments.'), route(async (req, res) => {
    const job = await getJob(req, res);
    if (!job) return;
    if (job.status === 'cancelled') return fail(res, 400, 'INVALID', 'This job is cancelled.');
    const amount = Math.round(num(req.body?.amount) * 100) / 100;
    if (amount <= 0) return fail(res, 400, 'INVALID', 'Enter the amount received.');
    const mode = PAYMENT_MODES.some((item) => item[0] === req.body?.mode) ? req.body.mode : 'cash';
    const fresh = await recalc(store, job);
    const invoiced = ['ready', 'delivered'].includes(job.status);
    const ceiling = invoiced ? num(fresh.grand_total) : Math.max(num(fresh.estimate_total), num(fresh.grand_total));
    const balance = ceiling - num(fresh.paid_total);
    if (amount > balance + 0.5) return fail(res, 400, 'INVALID', `That is more than the ${invoiced ? 'balance' : 'estimate balance'} of ₹${Math.max(0, balance).toFixed(2)}.`);
    const reference = clean(req.body?.reference, 60);
    if (['upi', 'card', 'bank'].includes(mode) && !reference) return fail(res, 400, 'INVALID', 'Enter the transaction reference.');
    await store.insert('job_payments', {
      company_id: req.companyId,
      job_id: job.id,
      customer_id: job.customer_id,
      amount: fixed(amount),
      mode,
      reference,
      kind: invoiced ? 'payment' : 'advance',
      user_id: req.session.user.id,
      user_name: req.session.user.name,
      created_at: now(),
    });
    await addEvent(store, job, req.session, 'payment', `${invoiced ? 'Payment' : 'Advance'} received ₹${amount.toFixed(2)} by ${mode.toUpperCase()}${reference ? ` (${reference})` : ''}.`);
    const after = await recalc(store, job);
    broadcast(req.companyId, { type: 'job', id: job.id });
    res.status(201).json({ paidTotal: num(after.paid_total), balance: Math.max(0, num(after.grand_total) - num(after.paid_total)) });
  }));

  // ---------- reminders: service due, insurance, PUC ----------
  app.get('/api/service/reminders', auth, svc, route(async (req, res) => {
    const days = Math.min(Math.max(num(req.query.days) || 30, 1), 120);
    const horizon = addDays(null, days);
    const today = new Date().toISOString().slice(0, 10);
    const customers = await store.find('customers', { company_id: req.companyId });
    const vehicles = await store.find('vehicles', { company_id: req.companyId });
    const jobs = await store.find('job_cards', { company_id: req.companyId });
    const items = [];
    for (const vehicle of vehicles) {
      const customer = customers.find((row) => row.id === vehicle.customer_id);
      if (!customer) continue;
      const inShop = jobs.some((job) => job.vehicle_id === vehicle.id && OPEN_STATUSES.includes(job.status));
      const push = (kind, due, extra = {}) => items.push({
        id: `${vehicle.id}-${kind}`,
        kind,
        due,
        overdue: due < today,
        inShop,
        customer: { id: customer.id, name: customer.name, mobile: customer.mobile },
        vehicle: { id: vehicle.id, vehicleType: vehicle.vehicle_type, regLabel: formatRegNo(vehicle.reg_no), make: vehicle.make, model: vehicle.model, odometer: num(vehicle.odometer) },
        ...extra,
      });
      if (vehicle.next_service_date && vehicle.next_service_date <= horizon) push('service', vehicle.next_service_date, { dueKm: vehicle.next_service_km ? num(vehicle.next_service_km) : null });
      if (vehicle.insurance_expiry && vehicle.insurance_expiry <= horizon) push('insurance', vehicle.insurance_expiry, { insurer: vehicle.insurer || '' });
      if (vehicle.puc_expiry && vehicle.puc_expiry <= horizon) push('puc', vehicle.puc_expiry);
    }
    items.sort((a, b) => a.due.localeCompare(b.due));
    res.json({ items, horizon });
  }));

  // ---------- customers and vehicles ----------
  app.get('/api/customers', auth, cust, route(async (req, res) => {
    const q = clean(req.query.q, 60).toLowerCase();
    const customers = await store.find('customers', { company_id: req.companyId });
    const vehicles = await store.find('vehicles', { company_id: req.companyId });
    const jobs = await store.find('job_cards', { company_id: req.companyId });
    const items = customers.map((customer) => {
      const own = jobs.filter((job) => job.customer_id === customer.id && job.status !== 'cancelled');
      const billed = own.filter((job) => ['ready', 'delivered'].includes(job.status));
      const spend = billed.reduce((sum, job) => sum + num(job.grand_total), 0);
      const paid = own.reduce((sum, job) => sum + num(job.paid_total), 0);
      const due = billed.reduce((sum, job) => sum + Math.max(0, num(job.grand_total) - num(job.paid_total)), 0);
      const cars = vehicles.filter((row) => row.customer_id === customer.id);
      const last = own.map((job) => job.checked_in_at).sort().pop() || '';
      return {
        ...shapeCustomer(customer),
        vehicles: cars.map((row) => ({ id: row.id, regLabel: formatRegNo(row.reg_no), vehicleType: row.vehicle_type, make: row.make, model: row.model })),
        visits: own.length,
        openJobs: own.filter((job) => OPEN_STATUSES.includes(job.status)).length,
        spend,
        paid,
        outstanding: due,
        lastVisit: last,
      };
    }).filter((row) => !q || row.name.toLowerCase().includes(q) || row.mobile.includes(q) || row.vehicles.some((v) => normalizeRegNo(v.regLabel).toLowerCase().includes(normalizeRegNo(q).toLowerCase())))
      .sort((a, b) => String(b.lastVisit).localeCompare(String(a.lastVisit)) || a.name.localeCompare(b.name));
    res.json({ items });
  }));

  app.post('/api/customers', auth, cust, needs('customerEdit', 'Your role cannot add customers.'), route(async (req, res) => {
    const body = req.body ?? {};
    const name = clean(body.name, 120);
    const mobile = normalizeMobile(body.mobile);
    if (name.length < 2) return fail(res, 400, 'INVALID', 'Enter the customer name.');
    if (!/^[6-9]\d{9}$/.test(mobile)) return fail(res, 400, 'INVALID', 'Enter a 10-digit Indian mobile number.');
    if ((await store.find('customers', { company_id: req.companyId, mobile })).length) return fail(res, 409, 'DUPLICATE', 'A customer with that mobile already exists.');
    if (body.gstin && !/^\d{2}[A-Z0-9]{13}$/.test(String(body.gstin).toUpperCase())) return fail(res, 400, 'INVALID', 'GSTIN must be 15 characters.');
    const saved = await store.insert('customers', {
      company_id: req.companyId,
      name,
      mobile,
      alt_mobile: normalizeMobile(body.altMobile),
      email: clean(body.email, 120),
      address: clean(body.address, 300),
      city: clean(body.city, 60),
      state_code: clean(body.stateCode || req.session.tenant.stateCode, 4),
      gstin: clean(body.gstin, 15).toUpperCase(),
      notes: clean(body.notes, 500),
      created_at: now(),
    });
    res.status(201).json(shapeCustomer(saved));
  }));

  app.patch('/api/customers/:id', auth, cust, needs('customerEdit', 'Your role cannot edit customers.'), route(async (req, res) => {
    const [customer] = await store.find('customers', { id: req.params.id });
    if (!customer || customer.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Customer not found.');
    const body = req.body ?? {};
    const patch = {};
    if (body.name !== undefined) {
      if (clean(body.name).length < 2) return fail(res, 400, 'INVALID', 'Enter the customer name.');
      patch.name = clean(body.name, 120);
    }
    if (body.mobile !== undefined) {
      const mobile = normalizeMobile(body.mobile);
      if (!/^[6-9]\d{9}$/.test(mobile)) return fail(res, 400, 'INVALID', 'Enter a 10-digit Indian mobile number.');
      const clash = (await store.find('customers', { company_id: req.companyId, mobile })).find((row) => row.id !== customer.id);
      if (clash) return fail(res, 409, 'DUPLICATE', `That mobile belongs to ${clash.name}.`);
      patch.mobile = mobile;
    }
    for (const [key, column, max] of [['altMobile', 'alt_mobile', 10], ['email', 'email', 120], ['address', 'address', 300], ['city', 'city', 60], ['stateCode', 'state_code', 4], ['notes', 'notes', 500]]) {
      if (body[key] !== undefined) patch[column] = key === 'altMobile' ? normalizeMobile(body[key]) : clean(body[key], max);
    }
    if (body.gstin !== undefined) patch.gstin = clean(body.gstin, 15).toUpperCase();
    const saved = await store.update('customers', customer.id, patch);
    broadcast(req.companyId, { type: 'customer', id: customer.id });
    res.json(shapeCustomer(saved));
  }));

  // The full customer story: vehicles, every visit, work done, parts fitted, money.
  app.get('/api/customers/:id/history', auth, cust, route(async (req, res) => {
    const [customer] = await store.find('customers', { id: req.params.id });
    if (!customer || customer.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Customer not found.');
    const maps = await loadMaps(store, req.companyId);
    const vehicles = maps.vehicleRows.filter((row) => row.customer_id === customer.id);
    const jobs = (await store.find('job_cards', { company_id: req.companyId, customer_id: customer.id }))
      .sort((a, b) => String(b.checked_in_at).localeCompare(String(a.checked_in_at)));
    const allLines = await store.find('job_lines', { company_id: req.companyId });
    const payments = (await store.find('job_payments', { company_id: req.companyId, customer_id: customer.id }))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const visits = jobs.map((job) => {
      const lines = allLines.filter((row) => row.job_id === job.id && !['removed'].includes(row.approval));
      return {
        ...shapeJobSummary(job, maps),
        odometerOut: job.odometer_out ? num(job.odometer_out) : null,
        rating: job.rating ? num(job.rating) : null,
        feedback: job.feedback || '',
        cancelReason: job.cancel_reason || '',
        labour: lines.filter((row) => row.line_type === 'labour').map(shapeLine),
        parts: lines.filter((row) => row.line_type === 'part').map(shapeLine),
      };
    });
    const parts = [];
    for (const visit of visits) {
      if (visit.status === 'cancelled') continue;
      for (const part of visit.parts) {
        if (part.approval !== 'approved') continue;
        parts.push({ id: part.id, at: visit.checkedInAt, jobId: visit.id, jobNo: visit.jobNo, vehicle: visit.vehicle, odometer: visit.odometerIn, name: part.description, sku: part.sku, qty: part.qty, amount: part.total });
      }
    }
    const billed = jobs.filter((job) => ['ready', 'delivered'].includes(job.status));
    const spend = billed.reduce((sum, job) => sum + num(job.grand_total), 0);
    const paid = payments.reduce((sum, row) => sum + num(row.amount), 0);
    const outstanding = billed.reduce((sum, job) => sum + Math.max(0, num(job.grand_total) - num(job.paid_total)), 0);
    const ratings = jobs.filter((job) => num(job.rating) > 0).map((job) => num(job.rating));
    const months = [];
    const cursor = new Date();
    cursor.setDate(1);
    for (let i = 11; i >= 0; i -= 1) {
      const d = new Date(cursor.getFullYear(), cursor.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months.push({ key, label: d.toLocaleString('en-IN', { month: 'short' }), amount: billed.filter((job) => String(job.ready_at || job.checked_in_at).slice(0, 7) === key).reduce((sum, job) => sum + num(job.grand_total), 0) });
    }
    const complaints = {};
    for (const job of jobs) for (const text of parseJson(job.complaints, [])) {
      const key = text.toLowerCase();
      complaints[key] = complaints[key] || { text, count: 0, vehicles: new Set() };
      complaints[key].count += 1;
      complaints[key].vehicles.add(job.vehicle_id);
    }
    const repeats = Object.values(complaints).filter((row) => row.count > 1).map((row) => ({ text: row.text, count: row.count }));
    res.json({
      customer: shapeCustomer(customer),
      vehicles: vehicles.map((vehicle) => {
        const own = jobs.filter((job) => job.vehicle_id === vehicle.id && job.status !== 'cancelled');
        const openJob = own.find((job) => OPEN_STATUSES.includes(job.status));
        return {
          ...shapeVehicle(vehicle),
          visits: own.length,
          spend: own.filter((job) => ['ready', 'delivered'].includes(job.status)).reduce((sum, job) => sum + num(job.grand_total), 0),
          openJob: openJob ? { id: openJob.id, jobNo: openJob.job_no, status: openJob.status, statusLabel: statusLabel(openJob.status) } : null,
        };
      }),
      visits,
      parts,
      payments: payments.map((row) => {
        const job = jobs.find((item) => item.id === row.job_id);
        return { id: row.id, amount: num(row.amount), mode: row.mode, reference: row.reference || '', kind: row.kind || 'payment', at: row.created_at, jobId: row.job_id, jobNo: job?.job_no || '', userName: row.user_name || '' };
      }),
      stats: {
        visits: jobs.filter((job) => job.status !== 'cancelled').length,
        openJobs: jobs.filter((job) => OPEN_STATUSES.includes(job.status)).length,
        spend,
        paid,
        outstanding,
        averageTicket: billed.length ? spend / billed.length : 0,
        firstVisit: jobs.length ? jobs[jobs.length - 1].checked_in_at : '',
        lastVisit: jobs.length ? jobs[0].checked_in_at : '',
        rating: ratings.length ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10 : null,
      },
      months,
      repeats,
      caps: caps(req),
    });
  }));

  app.post('/api/vehicles', auth, svc, needs('desk'), route(async (req, res) => {
    const body = req.body ?? {};
    const [customer] = await store.find('customers', { id: body.customerId });
    if (!customer || customer.company_id !== req.companyId) return fail(res, 400, 'INVALID', 'Customer not found.');
    const regNo = normalizeRegNo(body.regNo);
    if (regNo.length < 4) return fail(res, 400, 'INVALID', 'Enter the registration number.');
    if (!['car', 'bike'].includes(body.vehicleType)) return fail(res, 400, 'INVALID', 'Choose car or bike.');
    const clash = (await store.find('vehicles', { company_id: req.companyId, reg_no: regNo }))[0];
    if (clash) return fail(res, 409, 'DUPLICATE', `${formatRegNo(regNo)} is already registered.`);
    const saved = await store.insert('vehicles', {
      company_id: req.companyId,
      customer_id: customer.id,
      vehicle_type: body.vehicleType,
      reg_no: regNo,
      make: clean(body.make, 60),
      model: clean(body.model, 60),
      variant: clean(body.variant, 60),
      fuel_type: clean(body.fuelType, 20),
      year: clean(body.year, 4),
      color: clean(body.color, 30),
      vin: clean(body.vin, 30).toUpperCase(),
      engine_no: clean(body.engineNo, 30).toUpperCase(),
      insurer: clean(body.insurer, 60),
      insurance_expiry: dayOnly(body.insuranceExpiry),
      puc_expiry: dayOnly(body.pucExpiry),
      odometer: String(num(body.odometer)),
      created_at: now(),
    });
    broadcast(req.companyId, { type: 'customer', id: customer.id });
    res.status(201).json(shapeVehicle(saved));
  }));

  app.patch('/api/vehicles/:id', auth, svc, needs('desk'), route(async (req, res) => {
    const [vehicle] = await store.find('vehicles', { id: req.params.id });
    if (!vehicle || vehicle.company_id !== req.companyId) return fail(res, 404, 'NOT_FOUND', 'Vehicle not found.');
    const body = req.body ?? {};
    const patch = {};
    for (const [key, column, max] of [['make', 'make', 60], ['model', 'model', 60], ['variant', 'variant', 60], ['fuelType', 'fuel_type', 20], ['year', 'year', 4], ['color', 'color', 30], ['insurer', 'insurer', 60]]) {
      if (body[key] !== undefined) patch[column] = clean(body[key], max);
    }
    for (const [key, column] of [['vin', 'vin'], ['engineNo', 'engine_no']]) {
      if (body[key] !== undefined) patch[column] = clean(body[key], 30).toUpperCase();
    }
    for (const [key, column] of [['insuranceExpiry', 'insurance_expiry'], ['pucExpiry', 'puc_expiry'], ['nextServiceDate', 'next_service_date']]) {
      if (body[key] !== undefined) patch[column] = dayOnly(body[key]);
    }
    if (body.nextServiceKm !== undefined) patch.next_service_km = String(num(body.nextServiceKm));
    if (body.customerId && body.customerId !== vehicle.customer_id) {
      const [owner] = await store.find('customers', { id: body.customerId });
      if (!owner || owner.company_id !== req.companyId) return fail(res, 400, 'INVALID', 'New owner not found.');
      const busy = (await store.find('job_cards', { company_id: req.companyId, vehicle_id: vehicle.id })).some((job) => OPEN_STATUSES.includes(job.status));
      if (busy) return fail(res, 400, 'INVALID', 'Close the open job card before transferring ownership.');
      patch.customer_id = owner.id;
    }
    const saved = await store.update('vehicles', vehicle.id, patch);
    broadcast(req.companyId, { type: 'customer', id: saved.customer_id });
    res.json(shapeVehicle(saved));
  }));
}
