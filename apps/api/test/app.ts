import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../src/app.module';

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  await app.init();
  return app;
}

export async function signup(
  app: INestApplication,
  businessType: 'computer_shop' | 'bike_service',
  label: string,
) {
  const email = `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const response = await request(app.getHttpServer()).post('/api/auth/signup').send({
    ownerName: 'Test Owner',
    email,
    password: 'Secret123',
    businessName: label,
    businessType,
    stateCode: '27',
    locationName: 'Main counter',
  });
  if (response.status !== 201) {
    throw new Error(`Signup failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return {
    email,
    token: response.body.accessToken as string,
    tenantId: response.body.tenant.id as string,
  };
}

export async function createProduct(app: INestApplication, token: string, name: string) {
  const units = await request(app.getHttpServer())
    .get('/api/units')
    .set('Authorization', `Bearer ${token}`);
  if (units.status !== 200) {
    throw new Error(`Units failed (${units.status}): ${JSON.stringify(units.body)}`);
  }
  const unitId = units.body.items[0].id as string;
  const sku = `T-${Math.random().toString(16).slice(2, 10)}`.toUpperCase();
  const response = await request(app.getHttpServer())
    .post('/api/products')
    .set('Authorization', `Bearer ${token}`)
    .send({
      name,
      unitId,
      gstRate: '18',
      trackingType: 'none',
      variant: { sku, mrp: '100.00', salePrice: '90.00', costPrice: '40.00', minStock: '0' },
    });
  if (response.status !== 201) {
    throw new Error(`Product failed (${response.status}): ${JSON.stringify(response.body)}`);
  }
  return response.body as { id: string; name: string };
}
