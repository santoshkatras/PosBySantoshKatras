import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { seedPlans } from '../src/modules/tenancy/seed-plans';
import { createApp, signup } from './app';

describe('module guard', () => {
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

  it('allows each vertical only the modules on its plan', async () => {
    const computer = await signup(app, 'computer_shop', 'mod-cs');
    const bike = await signup(app, 'bike_service', 'mod-bs');

    const serial = await request(app.getHttpServer())
      .get('/api/vertical/serial/status')
      .set('Authorization', `Bearer ${computer.token}`);
    expect(serial.status).toBe(200);
    expect(serial.body.module).toBe('serial');

    const bikeOnComputer = await request(app.getHttpServer())
      .get('/api/vertical/bike-service/status')
      .set('Authorization', `Bearer ${computer.token}`);
    expect(bikeOnComputer.status).toBe(403);
    expect(bikeOnComputer.body.code).toBe('MODULE_DISABLED');

    const jobs = await request(app.getHttpServer())
      .get('/api/vertical/bike-service/status')
      .set('Authorization', `Bearer ${bike.token}`);
    expect(jobs.status).toBe(200);

    const serialOnBike = await request(app.getHttpServer())
      .get('/api/vertical/serial/status')
      .set('Authorization', `Bearer ${bike.token}`);
    expect(serialOnBike.status).toBe(403);
    expect(serialOnBike.body.code).toBe('MODULE_DISABLED');
  });

  it('blocks an enabled module after the tenant switches it off, and refuses modules outside the plan', async () => {
    const computer = await signup(app, 'computer_shop', 'mod-toggle');

    const before = await request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', `Bearer ${computer.token}`);
    expect(before.status).toBe(200);

    const disabled = await request(app.getHttpServer())
      .patch('/api/settings/modules')
      .set('Authorization', `Bearer ${computer.token}`)
      .send({ featureKey: 'catalogue', enabled: false });
    expect(disabled.status).toBe(200);

    const blocked = await request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', `Bearer ${computer.token}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('MODULE_DISABLED');

    const enabled = await request(app.getHttpServer())
      .patch('/api/settings/modules')
      .set('Authorization', `Bearer ${computer.token}`)
      .send({ featureKey: 'catalogue', enabled: true });
    expect(enabled.status).toBe(200);

    const after = await request(app.getHttpServer())
      .get('/api/products')
      .set('Authorization', `Bearer ${computer.token}`);
    expect(after.status).toBe(200);

    const outsidePlan = await request(app.getHttpServer())
      .patch('/api/settings/modules')
      .set('Authorization', `Bearer ${computer.token}`)
      .send({ featureKey: 'bike_service', enabled: true });
    expect(outsidePlan.status).toBe(400);
  });
});
