import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Client } from 'pg';
import request from 'supertest';
import { seedPlans } from '../src/modules/tenancy/seed-plans';
import { createApp, createProduct, signup } from './app';

describe('tenant isolation', () => {
  let app: INestApplication;
  const marker = `iso-${Date.now()}`;

  beforeAll(async () => {
    const admin = new PrismaClient({ datasources: { db: { url: process.env.DIRECT_URL } } });
    await seedPlans(admin);
    await admin.$disconnect();
    app = await createApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('does not return another tenant’s products over HTTP, even with a spoofed tenant header', async () => {
    const shopA = await signup(app, 'computer_shop', `${marker}-a`);
    const shopB = await signup(app, 'bike_service', `${marker}-b`);
    const nameA = `${marker} alpha laptop`;
    const nameB = `${marker} beta oil`;
    const productA = await createProduct(app, shopA.token, nameA);
    await createProduct(app, shopB.token, nameB);

    const asA = await request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', `Bearer ${shopA.token}`)
      .set('x-tenant-id', shopB.tenantId);
    expect(asA.status).toBe(200);
    const namesA = (asA.body.items as Array<{ name: string }>).map((item) => item.name);
    expect(namesA).toContain(nameA);
    expect(namesA).not.toContain(nameB);

    const asB = await request(app.getHttpServer())
      .get(`/api/products/${productA.id}`)
      .set('Authorization', `Bearer ${shopB.token}`);
    expect(asB.status).toBe(404);

    const listB = await request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', `Bearer ${shopB.token}`);
    const namesB = (listB.body.items as Array<{ name: string }>).map((item) => item.name);
    expect(namesB).toContain(nameB);
    expect(namesB).not.toContain(nameA);
  });

  it('hides rows in Postgres when the app role has no tenant, and blocks cross-tenant writes', async () => {
    const shopA = await signup(app, 'computer_shop', `${marker}-sql-a`);
    const shopB = await signup(app, 'bike_service', `${marker}-sql-b`);
    const nameA = `${marker} sql alpha`;
    const nameB = `${marker} sql beta`;
    await createProduct(app, shopA.token, nameA);
    await createProduct(app, shopB.token, nameB);

    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      const hidden = await client.query<{ name: string }>('SELECT name FROM products');
      expect(hidden.rows).toHaveLength(0);

      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [shopA.tenantId]);
      const visible = await client.query<{ name: string }>(
        'SELECT name FROM products WHERE name LIKE $1',
        [`${marker} sql%`],
      );
      expect(visible.rows.map((row) => row.name)).toEqual([nameA]);

      await expect(
        client.query(
          `INSERT INTO brands (tenant_id, name, created_at, updated_at) VALUES ($1, $2, NOW(), NOW())`,
          [shopB.tenantId, `${marker}-hack`],
        ),
      ).rejects.toThrow(/row-level security/);
      await client.query('ROLLBACK');
    } finally {
      await client.end();
    }
  });
});
