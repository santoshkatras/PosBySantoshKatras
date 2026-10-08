import { Prisma } from '@prisma/client';
import {
  isFeatureKey,
  isPermission,
  LOCKED_FEATURES,
  type Permission,
  type SessionPayload,
} from '@stockkeep/types';

export const userSessionInclude = {
  role: { include: { permissions: true } },
  locations: true,
  tenant: { include: { features: true, plan: { include: { features: true } } } },
} satisfies Prisma.UserInclude;

export type UserSessionRecord = Prisma.UserGetPayload<{ include: typeof userSessionInclude }>;

export function toSession(user: UserSessionRecord): SessionPayload {
  const permissions = user.role.permissions
    .map((row) => row.permission)
    .filter((permission): permission is Permission => isPermission(permission));

  const tenantFeatures = new Map(user.tenant.features.map((feature) => [feature.featureKey, feature]));
  const modules: SessionPayload['modules'] = [];
  let locationLimit: number | null = null;
  let userLimit: number | null = null;

  for (const feature of user.tenant.plan.features) {
    if (feature.featureKey === 'limit.locations') {
      locationLimit = tenantFeatures.get(feature.featureKey)?.overrideLimit ?? feature.limitValue;
      continue;
    }
    if (feature.featureKey === 'limit.users') {
      userLimit = tenantFeatures.get(feature.featureKey)?.overrideLimit ?? feature.limitValue;
      continue;
    }
    if (!isFeatureKey(feature.featureKey)) continue;
    const override = tenantFeatures.get(feature.featureKey);
    const entitled = feature.enabled;
    const enabled = entitled && (override ? override.enabled : true);
    modules.push({
      key: feature.featureKey,
      enabled,
      entitled,
      locked: LOCKED_FEATURES.includes(feature.featureKey),
    });
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      role: { id: user.role.id, code: user.role.code, name: user.role.name },
      permissions,
      locationIds: user.locations.map((row) => row.locationId),
    },
    tenant: {
      id: user.tenant.id,
      name: user.tenant.name,
      legalName: user.tenant.legalName,
      businessType: user.tenant.businessType,
      gstin: user.tenant.gstin,
      stateCode: user.tenant.stateCode,
      status: user.tenant.status,
      trialEndsAt: user.tenant.trialEndsAt ? user.tenant.trialEndsAt.toISOString() : null,
      plan: { code: user.tenant.plan.code, name: user.tenant.plan.name },
    },
    modules,
    limits: { locations: locationLimit, users: userLimit },
  };
}
