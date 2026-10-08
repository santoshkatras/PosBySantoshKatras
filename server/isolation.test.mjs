import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from './app.mjs';

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), 'stockkeep-'));
  const { app } = await createApp({ dbPath: join(dir, 'test.sqlite'), vite: false });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function signup(base, label, businessType) {
  const response = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ownerName: 'Test Owner',
      email: `${label}-${Date.now()}@example.com`,
      password: 'Secret123',
      businessName: label,
      businessType,
      stateCode: '27',
      locationName: 'Main counter',
    }),
  });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  return body;
}

test('one tenant cannot read another tenant products', async () => {
  const { base, close } = await boot();
  try {
    const shop = await signup(base, 'alpha', 'computer_shop');
    const workshop = await signup(base, 'beta', 'bike_service');
    const units = await fetch(`${base}/api/units`, { headers: { authorization: `Bearer ${shop.accessToken}` } });
    const unitId = (await units.json()).items[0].id;
    const created = await fetch(`${base}/api/products`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${shop.accessToken}` },
      body: JSON.stringify({ name: 'Alpha laptop', unitId, gstRate: '18', variant: { sku: 'ALPHA-1', salePrice: '100', costPrice: '40', minStock: '0' } }),
    });
    assert.equal(created.status, 201);
    const spoof = await fetch(`${base}/api/products`, {
      headers: { authorization: `Bearer ${shop.accessToken}`, 'x-tenant-id': workshop.tenant.id },
    });
    const asShop = await spoof.json();
    assert.equal(asShop.items.some((item) => item.name === 'Alpha laptop'), true);
    const asWorkshop = await fetch(`${base}/api/products`, { headers: { authorization: `Bearer ${workshop.accessToken}` } });
    const other = await asWorkshop.json();
    assert.equal(other.items.some((item) => item.name === 'Alpha laptop'), false);
  } finally {
    await close();
  }
});

test('module guard blocks the other vertical and a switched-off module', async () => {
  const { base, close } = await boot();
  try {
    const shop = await signup(base, 'guard-shop', 'computer_shop');
    const workshop = await signup(base, 'guard-bike', 'bike_service');
    const serial = await fetch(`${base}/api/vertical/serial/status`, { headers: { authorization: `Bearer ${shop.accessToken}` } });
    assert.equal(serial.status, 200);
    const blocked = await fetch(`${base}/api/vertical/bike-service/status`, { headers: { authorization: `Bearer ${shop.accessToken}` } });
    const blockedBody = await blocked.json();
    assert.equal(blocked.status, 403);
    assert.equal(blockedBody.code, 'MODULE_DISABLED');
    const bikeSerial = await fetch(`${base}/api/vertical/serial/status`, { headers: { authorization: `Bearer ${workshop.accessToken}` } });
    assert.equal(bikeSerial.status, 403);
    const off = await fetch(`${base}/api/settings/modules`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${shop.accessToken}` },
      body: JSON.stringify({ feature: 'catalogue', enabled: false }),
    });
    assert.equal(off.status, 200);
    const hidden = await fetch(`${base}/api/products`, { headers: { authorization: `Bearer ${shop.accessToken}` } });
    assert.equal(hidden.status, 403);
    const outside = await fetch(`${base}/api/settings/modules`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${shop.accessToken}` },
      body: JSON.stringify({ feature: 'bike_service', enabled: true }),
    });
    assert.equal(outside.status, 400);
  } finally {
    await close();
  }
});

test('stock adjustment writes the ledger and refuses a negative result', async () => {
  const { base, close } = await boot();
  try {
    const shop = await signup(base, 'stock', 'computer_shop');
    const token = { authorization: `Bearer ${shop.accessToken}` };
    const unitId = (await (await fetch(`${base}/api/units`, { headers: token })).json()).items[0].id;
    const locationId = (await (await fetch(`${base}/api/locations`, { headers: token })).json()).items[0].id;
    const product = await (await fetch(`${base}/api/products`, {
      method: 'POST',
      headers: { ...token, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'USB cable', unitId, variant: { sku: 'USB-1', costPrice: '10', minStock: '0' } }),
    })).json();
    const adjusted = await fetch(`${base}/api/stock/adjustments`, {
      method: 'POST',
      headers: { ...token, 'content-type': 'application/json' },
      body: JSON.stringify({ locationId, variantId: product.variants[0].id, qtyDelta: '2', reason: 'found', note: 'Floor count' }),
    });
    const body = await adjusted.json();
    assert.equal(adjusted.status, 201);
    assert.equal(body.qtyOnHand, '2.000');
    const ledger = await (await fetch(`${base}/api/stock/movements`, { headers: token })).json();
    assert.equal(ledger.items[0].note, 'Floor count');
    const negative = await fetch(`${base}/api/stock/adjustments`, {
      method: 'POST',
      headers: { ...token, 'content-type': 'application/json' },
      body: JSON.stringify({ locationId, variantId: product.variants[0].id, qtyDelta: '-5', reason: 'loss' }),
    });
    assert.equal(negative.status, 400);
  } finally {
    await close();
  }
});
