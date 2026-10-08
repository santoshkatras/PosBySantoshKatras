import type { PrismaClient } from '@prisma/client';
import { PLANS } from '@stockkeep/types';

export async function seedPlans(db: PrismaClient) {
  for (const plan of PLANS) {
    const saved = await db.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        vertical: plan.vertical,
        description: plan.description,
        trialDays: plan.trialDays,
      },
      create: {
        code: plan.code,
        name: plan.name,
        vertical: plan.vertical,
        description: plan.description,
        trialDays: plan.trialDays,
      },
    });

    await db.planFeature.deleteMany({ where: { planId: saved.id } });
    await db.planFeature.createMany({
      data: [
        ...Object.entries(plan.modules).map(([featureKey, enabled]) => ({
          planId: saved.id,
          featureKey,
          enabled,
          limitValue: null,
        })),
        {
          planId: saved.id,
          featureKey: 'limit.locations',
          enabled: true,
          limitValue: plan.limits.locations,
        },
        {
          planId: saved.id,
          featureKey: 'limit.users',
          enabled: true,
          limitValue: plan.limits.users,
        },
      ],
    });
  }
}
