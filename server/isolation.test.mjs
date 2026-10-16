import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from './app.mjs';

async function boot() {
  const { app } = await createApp({ store: 'memory', vite: false });
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
    const shopJson = { 'content-type': 'application/json', authorization: `Bearer ${shop.accessToken}` };
    const noType = await fetch(`${base}/api/products`, { method: 'POST', headers: shopJson, body: JSON.stringify({ name: 'No type', unitId, variant: { sku: 'NOTYPE-1' } }) });
    assert.equal(noType.status, 400, 'Item Type (Category 1) is compulsory');
    const categoryId = (await (await fetch(`${base}/api/categories`, { method: 'POST', headers: shopJson, body: JSON.stringify({ name: 'Laptops', level: '1' }) })).json()).id;
    const created = await fetch(`${base}/api/products`, {
      method: 'POST',
      headers: shopJson,
      body: JSON.stringify({ name: 'Alpha laptop', unitId, categoryId, gstRate: '18', variant: { sku: 'ALPHA-1', salePrice: '100', costPrice: '40', minStock: '0' } }),
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
    const categoryId = (await (await fetch(`${base}/api/categories`, { method: 'POST', headers: { ...token, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Cables', level: '1' }) })).json()).id;
    const product = await (await fetch(`${base}/api/products`, {
      method: 'POST',
      headers: { ...token, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'USB cable', unitId, categoryId, variant: { sku: 'USB-1', costPrice: '10', minStock: '0' } }),
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

test('every inward gets a new unique 13-digit stock barcode and outward takes stock from the chosen one', async () => {
  const { base, close } = await boot();
  try {
    const shop = await signup(base, 'lots', 'computer_shop');
    const headers = { authorization: `Bearer ${shop.accessToken}`, 'content-type': 'application/json' };
    const get = async (path) => (await fetch(`${base}/api${path}`, { headers })).json();
    const post = (path, body) => fetch(`${base}/api${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const unitId = (await get('/units')).items[0].id;
    const locationId = (await get('/locations')).items[0].id;
    const categoryId = (await (await post('/categories', { name: 'Mice', level: '1' })).json()).id;
    const product = await (await post('/products', { name: 'Mouse', unitId, categoryId, variant: { sku: 'MS-1', costPrice: '100', salePrice: '150' } })).json();
    const variantId = product.variants[0].id;
    for (const qtyDelta of ['5', '3']) assert.equal((await post('/stock/adjustments', { locationId, variantId, qtyDelta, reason: 'found' })).status, 201);
    const lots = (await get(`/stock-lots?variantId=${variantId}&locationId=${locationId}`)).items;
    assert.equal(lots.length, 2);
    const ean = (code) => /^2\d{12}$/.test(code) && String((10 - (code.slice(0, 12).split('').reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10) === code[12];
    assert.ok(lots.every((lot) => ean(lot.barcode)), 'valid 13-digit EAN-13 codes');
    assert.notEqual(lots[0].barcode, lots[1].barcode);
    const second = lots.find((lot) => lot.qty === 3);
    assert.equal((await post('/stock/adjustments', { locationId, variantId, qtyDelta: '-2', reason: 'damage', pick: [{ barcode: second.barcode, qty: 2 }] })).status, 201);
    const after = (await get(`/stock-lots?variantId=${variantId}&locationId=${locationId}`)).items;
    assert.equal(after.find((lot) => lot.barcode === second.barcode).qty, 1, 'taken from the chosen barcode only');
    assert.equal(after.find((lot) => lot.barcode !== second.barcode).qty, 5);
    const tooMuch = await post('/stock/adjustments', { locationId, variantId, qtyDelta: '-2', reason: 'damage', pick: [{ barcode: second.barcode, qty: 2 }] });
    assert.equal(tooMuch.status, 400);
    const found = await get(`/stock-lots/code/${second.barcode}?locationId=${locationId}`);
    assert.equal(found.variantId, variantId);
  } finally {
    await close();
  }
});
