import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { seedPlans } from '../src/modules/tenancy/seed-plans';
import { createApp, createProduct, signup } from './app';

describe('stock ledger', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
    await seedPlans(admin);
    await admin.$disconnect();
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('writes a manual adjustment to on-hand stock and the ledger', async () => {
    const shop = await signup(app, 'computer_shop', `stock-${Date.now()}`);
    const product = await createProduct(app, shop.token, 'USB cable');
    const locations = await request(app.getHttpServer())
      .get('/api/locations')
      .set('Authorization', `Bearer ${shop.token}`);
    expect(locations.status).toBe(200);
    const locationId = locations.body.items[0].id as string;

    const adjusted = await request(app.getHttpServer())
      .post('/api/stock/adjustments')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({
        locationId,
        variantId: product.variantId,
        qtyDelta: '2',
        reason: 'found',
        note: 'Floor count',
      });
    expect(adjusted.status).toBe(201);
    expect(adjusted.body.qtyOnHand).toBe('2.000');

    const stock = await request(app.getHttpServer())
      .get('/api/stock')
      .set('Authorization', `Bearer ${shop.token}`);
    const row = (stock.body.items as Array<{ variantId: string; qtyOnHand: string }>).find(
      (item) => item.variantId === product.variantId,
    );
    expect(row?.qtyOnHand).toBe('2.000');

    const ledger = await request(app.getHttpServer())
      .get('/api/stock/movements')
      .set('Authorization', `Bearer ${shop.token}`);
    expect(ledger.body.items[0]).toMatchObject({
      sku: product.sku,
      qty: '2.000',
      movementType: 'adjustment',
      reason: 'found',
      note: 'Floor count',
    });
  });

  it('refuses an adjustment that would make stock negative', async () => {
    const shop = await signup(app, 'bike_service', `stock-neg-${Date.now()}`);
    const product = await createProduct(app, shop.token, 'Engine oil');
    const locations = await request(app.getHttpServer())
      .get('/api/locations')
      .set('Authorization', `Bearer ${shop.token}`);
    const locationId = locations.body.items[0].id as string;

    const adjusted = await request(app.getHttpServer())
      .post('/api/stock/adjustments')
      .set('Authorization', `Bearer ${shop.token}`)
      .send({
        locationId,
        variantId: product.variantId,
        qtyDelta: '-1',
        reason: 'loss',
        note: 'Missing',
      });
    expect(adjusted.status).toBe(400);
  });
});
