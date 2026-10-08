import { Prisma, type PrismaClient } from '@prisma/client';
import {
  defaultCategories,
  defaultRoleCodes,
  defaultUnits,
  permissionsForRole,
  ROLE_NAMES,
  trialPlanCode,
  type BusinessType,
} from '@stockkeep/types';
import bcrypt from 'bcrypt';

type Db = PrismaClient | Prisma.TransactionClient;

export type ProvisionInput = {
  businessName: string;
  businessType: BusinessType;
  stateCode: string;
  gstin?: string | null;
  locationName: string;
  ownerName: string;
  email: string;
  password: string;
  ip?: string;
  userAgent?: string;
};

export async function provisionTenant(db: Db, input: ProvisionInput) {
  const plan = await db.plan.findUnique({
    where: { code: trialPlanCode(input.businessType) },
    include: { features: true },
  });
  if (!plan || plan.features.length === 0) {
    throw new Error('PLANS_MISSING');
  }

  const trialEndsAt = new Date();
  trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + plan.trialDays);

  const tenant = await db.tenant.create({
    data: {
      name: input.businessName,
      legalName: input.businessName,
      businessType: input.businessType,
      gstin: input.gstin ?? null,
      stateCode: input.stateCode,
      planId: plan.id,
      status: 'trial',
      trialEndsAt,
    },
  });

  await db.tenantFeature.createMany({
    data: plan.features.map((feature) => ({
      tenantId: tenant.id,
      featureKey: feature.featureKey,
      enabled: feature.enabled,
    })),
  });

  await db.unit.createMany({
    data: defaultUnits(input.businessType).map((unit) => ({
      tenantId: tenant.id,
      code: unit.code,
      name: unit.name,
    })),
  });

  for (const category of defaultCategories(input.businessType)) {
    const parent = await db.category.create({
      data: { tenantId: tenant.id, name: category.name },
    });
    if (category.children && category.children.length > 0) {
      await db.category.createMany({
        data: category.children.map((name) => ({
          tenantId: tenant.id,
          name,
          parentId: parent.id,
        })),
      });
    }
  }

  let ownerRoleId = '';
  for (const code of defaultRoleCodes(input.businessType)) {
    const role = await db.role.create({
      data: {
        tenantId: tenant.id,
        code,
        name: ROLE_NAMES[code],
        isSystem: true,
        permissions: {
          create: permissionsForRole(code).map((permission) => ({
            tenantId: tenant.id,
            permission,
          })),
        },
      },
    });
    if (code === 'owner') ownerRoleId = role.id;
  }
  if (!ownerRoleId) throw new Error('Owner role was not created');

  const location = await db.location.create({
    data: {
      tenantId: tenant.id,
      name: input.locationName,
      type: input.businessType === 'bike_service' ? 'service_bay' : 'store',
      stateCode: input.stateCode,
    },
  });

  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      roleId: ownerRoleId,
      name: input.ownerName,
      email: input.email.toLowerCase(),
      passwordHash: await bcrypt.hash(input.password, 12),
      status: 'active',
    },
  });

  await db.auditLog.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      action: 'tenant.signup',
      entity: 'tenant',
      entityId: tenant.id,
      after: { name: tenant.name, businessType: tenant.businessType, plan: plan.code },
      ip: input.ip,
      userAgent: input.userAgent,
    },
  });

  return { tenant, user, location, plan };
}
