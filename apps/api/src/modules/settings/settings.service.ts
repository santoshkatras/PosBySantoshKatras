import { BadRequestException, Injectable } from '@nestjs/common';
import { LOCKED_FEATURES, type ModuleToggleInput, type UpdateSettingsInput } from '@stockkeep/types';
import { DbService } from '../../common/db.service';
import type { RequestMeta, RequestUser } from '../../common/request-user';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class SettingsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async get(user: RequestUser) {
    const tenant = await this.db.client.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      include: { plan: true },
    });
    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        legalName: tenant.legalName,
        businessType: tenant.businessType,
        gstin: tenant.gstin,
        stateCode: tenant.stateCode,
        status: tenant.status,
        trialEndsAt: tenant.trialEndsAt ? tenant.trialEndsAt.toISOString() : null,
        plan: { code: tenant.plan.code, name: tenant.plan.name },
      },
      modules: user.modules,
      limits: user.limits,
    };
  }

  async update(user: RequestUser, input: UpdateSettingsInput, meta: RequestMeta) {
    const existing = await this.db.client.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
    const stateCode = input.stateCode ?? existing.stateCode;
    const gstin = input.gstin === undefined ? existing.gstin : input.gstin;
    if (gstin && gstin.slice(0, 2) !== stateCode) {
      throw new BadRequestException('GSTIN must start with the state code');
    }
    const tenant = await this.db.client.tenant.update({
      where: { id: user.tenantId },
      data: {
        name: input.name,
        legalName: input.legalName,
        stateCode: input.stateCode,
        gstin: input.gstin,
      },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'settings.update',
      entity: 'tenant',
      entityId: tenant.id,
      before: { name: existing.name, gstin: existing.gstin, stateCode: existing.stateCode },
      after: { name: tenant.name, gstin: tenant.gstin, stateCode: tenant.stateCode },
      meta,
    });
    return {
      name: tenant.name,
      legalName: tenant.legalName,
      gstin: tenant.gstin,
      stateCode: tenant.stateCode,
    };
  }

  async toggleModule(user: RequestUser, input: ModuleToggleInput, meta: RequestMeta) {
    if (LOCKED_FEATURES.includes(input.featureKey) && !input.enabled) {
      throw new BadRequestException('Users and settings stay available so you can manage access');
    }
    const tenant = await this.db.client.tenant.findUniqueOrThrow({
      where: { id: user.tenantId },
      include: { plan: { include: { features: true } } },
    });
    const planFeature = tenant.plan.features.find((feature) => feature.featureKey === input.featureKey);
    if (!planFeature?.enabled) {
      throw new BadRequestException('Your plan does not include this module');
    }
    const saved = await this.db.client.tenantFeature.upsert({
      where: { tenantId_featureKey: { tenantId: user.tenantId, featureKey: input.featureKey } },
      update: { enabled: input.enabled },
      create: { tenantId: user.tenantId, featureKey: input.featureKey, enabled: input.enabled },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'module.toggle',
      entity: 'tenant_feature',
      entityId: saved.id,
      after: { featureKey: input.featureKey, enabled: input.enabled },
      meta,
    });
    return { featureKey: saved.featureKey, enabled: saved.enabled };
  }
}
