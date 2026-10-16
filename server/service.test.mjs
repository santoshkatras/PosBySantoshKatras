import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from './app.mjs';
import { seedDemos } from './seed.mjs';
import { seedService } from './service-seed.mjs';

let server;
let base;
let store;

async function call(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${base}/api${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

async function login(email) {
  const { data } = await call('/auth/login', { method: 'POST', body: { email, password: 'Demo@12345' } });
  return data.accessToken;
}

before(async () => {
  const created = await createApp({ store: 'memory', vite: false });
  store = created.store;
  await seedDemos(store);
  await seedService(store);
  server = created.app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('seeded board shows live jobs at every stage', async () => {
  const token = await login('advisor@spoke.demo');
  const { status, data } = await call('/service/board', { token });
  assert.equal(status, 200);
  const statuses = new Set(data.jobs.map((job) => job.status));
  for (const s of ['checked_in', 'awaiting_approval', 'approved', 'in_progress', 'waiting_parts', 'qc', 'ready']) assert.ok(statuses.has(s), s);
  assert.ok(data.kpis.overdue >= 1);
});

test('full car service: check-in, estimate, approve, parts, QC, invoice, pay, deliver', async () => {
  const token = await login('advisor@spoke.demo');
  const meta = (await call('/service/meta', { token })).data;
  const workshop = meta.locations.find((row) => row.kind === 'service_bay');
  const parts = meta.stockLocations.find((row) => row.name === 'Parts Store');
  const oil = meta.parts.find((row) => row.sku === 'CASTROL-5W30-1L');
  const mechanic = meta.mechanics[0];

  const bad = await call('/service/jobs', { method: 'POST', token, body: { locationId: workshop.id, customer: { name: 'X', mobile: '123' } } });
  assert.equal(bad.status, 400);

  const created = await call('/service/jobs', {
    method: 'POST', token,
    body: {
      locationId: workshop.id,
      customer: { name: 'Test Customer', mobile: '9876500001' },
      vehicle: { vehicleType: 'car', regNo: 'ka 04 zz 1234', make: 'Kia', model: 'Seltos' },
      serviceType: 'periodic', odometerIn: 15000, fuelLevel: '1/2', complaints: ['15k service'], packages: ['car_pms'], mechanicId: mechanic.id,
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const id = created.data.id;

  const dup = await call('/service/jobs', { method: 'POST', token, body: { locationId: workshop.id, customer: { name: 'Test Customer', mobile: '9876500001' }, vehicle: { vehicleType: 'car', regNo: 'KA04ZZ1234' }, odometerIn: 15001, complaints: ['x'] } });
  assert.equal(dup.status, 409, 'vehicle already in workshop');

  const line = await call(`/service/jobs/${id}/lines`, { method: 'POST', token, body: { lineType: 'part', variantId: oil.variantId, qty: 4 } });
  assert.equal(line.status, 201);
  assert.equal((await call(`/service/jobs/${id}/action`, { method: 'POST', token, body: { action: 'start' } })).status, 400, 'cannot start before approval');
  assert.equal((await call(`/service/jobs/${id}/action`, { method: 'POST', token, body: { action: 'send_estimate', channel: 'whatsapp' } })).status, 200);
  assert.equal((await call(`/service/jobs/${id}/action`, { method: 'POST', token, body: { action: 'approve', channel: 'phone' } })).status, 200);

  const mechToken = await login('mechanic@spoke.demo');
  const assigned = mechanic.name === 'Imran Pasha' ? mechToken : token;
  assert.equal((await call(`/service/jobs/${id}/action`, { method: 'POST', token: assigned, body: { action: 'start' } })).status, 200);

  // mechanic finds extra work -> pending approval blocks QC
  const extra = await call(`/service/jobs/${id}/lines`, { method: 'POST', token: assigned, body: { lineType: 'labour', packageCode: 'car_align' } });
  assert.equal(extra.status, 201);
  assert.equal(extra.data.approval, 'pending');
  let detail = (await call(`/service/jobs/${id}`, { token })).data;
  const labour = detail.lines.find((row) => row.description.startsWith('Periodic'));
  await call(`/service/jobs/${id}/lines/${labour.id}`, { method: 'PATCH', token: assigned, body: { done: true } });
  const blocked = await call(`/service/jobs/${id}/action`, { method: 'POST', token: assigned, body: { action: 'send_qc' } });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.message, /approval/);
  await call(`/service/jobs/${id}/action`, { method: 'POST', token, body: { action: 'approve', decisions: { [extra.data.id]: 'declined' } } });

  // parts must be issued from stock
  const noParts = await call(`/service/jobs/${id}/action`, { method: 'POST', token: assigned, body: { action: 'send_qc' } });
  assert.match(noParts.data.message, /Issue these parts/);
  const before = oil.stock.find((row) => row.locationId === parts.id).qty;
  const issued = await call(`/service/jobs/${id}/lines/${line.data.id}/issue`, { method: 'POST', token, body: { qty: 4, locationId: parts.id } });
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
  assert.equal(issued.data.qtyOnHand, before - 4);

  assert.equal((await call(`/service/jobs/${id}/action`, { method: 'POST', token: assigned, body: { action: 'send_qc' } })).status, 200);
  const qcMissing = await call(`/service/jobs/${id}/action`, { method: 'POST', token, body: { action: 'mark_ready', checks: {} } });
  assert.equal(qcMissing.status, 400);
  const checks = Object.fromEntries(meta.qcChecks.car.map((item) => [item, true]));
  const ready = await call(`/service/jobs/${id}/action`, { method: 'POST', token, body: { action: 'mark_ready', checks } });
  assert.equal(ready.status, 200, JSON.stringify(ready.data));

  detail = (await call(`/service/jobs/${id}`, { token })).data;
  assert.match(detail.job.invoiceNo, /^SI-/);
  // 1800 labour @18% + 4 x 890 oil @18% = 5360 * 1.18 = 6324.8 -> 6325
  assert.equal(detail.totals.grand, 6325);
  assert.equal(detail.totals.cgst, detail.totals.sgst);

  const early = await call(`/service/jobs/${id}/action`, { method: 'POST', token, body: { action: 'deliver' } });
  assert.equal(early.data.code, 'BALANCE');
  assert.equal((await call(`/service/jobs/${id}/payments`, { method: 'POST', token, body: { amount: 6325, mode: 'upi' } })).status, 400, 'UPI needs reference');
  assert.equal((await call(`/service/jobs/${id}/payments`, { method: 'POST', token, body: { amount: 6325, mode: 'upi', reference: 'UPI123' } })).status, 201);
  const done = await call(`/service/jobs/${id}/action`, { method: 'POST', token, body: { action: 'deliver', odometerOut: 15003, rating: 5 } });
  assert.equal(done.status, 200, JSON.stringify(done.data));

  const history = (await call(`/customers/${detail.customer.id}/history`, { token })).data;
  assert.equal(history.visits.length, 1);
  assert.equal(history.stats.spend, 6325);
  assert.equal(history.stats.outstanding, 0);
  assert.equal(history.vehicles[0].nextServiceKm, 25003);
  assert.equal(history.parts[0].qty, 4);
});

test('customer history shows every vehicle and visit', async () => {
  const token = await login('owner@spoke.demo');
  const list = (await call('/customers?q=arjun', { token })).data.items;
  assert.equal(list.length, 1);
  const history = (await call(`/customers/${list[0].id}/history`, { token })).data;
  assert.equal(history.vehicles.length, 2);
  assert.ok(history.visits.length >= 4);
  assert.ok(history.parts.some((row) => row.name.includes('brake pad')));
  assert.ok(history.stats.spend > 0);
});

test('isolation and roles', async () => {
  const shop = await login('owner@bytebazaar.demo');
  assert.equal((await call('/service/board', { token: shop })).status, 403, 'computer shop has no service module');
  const spoke = await login('owner@spoke.demo');
  const job = (await call('/service/board', { token: spoke })).data.jobs[0];
  assert.equal((await call(`/customers/${job.customer.id}/history`, { token: shop })).status, 404, 'other tenant cannot read customer');
  const mech = await login('mechanic@spoke.demo');
  assert.equal((await call('/customers', { token: mech })).status, 403, 'mechanic cannot open customer list');
  const cancel = await call(`/service/jobs/${job.id}/action`, { method: 'POST', token: mech, body: { action: 'cancel', reason: 'x' } });
  assert.equal(cancel.status, 403);
});

test('cancel returns issued parts to stock', async () => {
  const token = await login('advisor@spoke.demo');
  const board = (await call('/service/board', { token })).data;
  const job = board.jobs.find((row) => row.status === 'in_progress' && row.vehicle.vehicleType === 'car');
  const detail = (await call(`/service/jobs/${job.id}`, { token })).data;
  const oil = detail.lines.find((row) => row.sku === 'CASTROL-5W30-1L');
  const metaBefore = (await call('/service/meta', { token })).data.parts.find((row) => row.sku === 'CASTROL-5W30-1L').onHand;
  const res = await call(`/service/jobs/${job.id}/action`, { method: 'POST', token, body: { action: 'cancel', reason: 'Customer changed mind' } });
  assert.equal(res.status, 200);
  const metaAfter = (await call('/service/meta', { token })).data.parts.find((row) => row.sku === 'CASTROL-5W30-1L').onHand;
  assert.equal(metaAfter, metaBefore + oil.issuedQty);
});
