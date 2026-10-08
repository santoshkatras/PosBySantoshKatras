import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DbService } from '../../common/db.service';
import type { RequestMeta } from '../../common/request-user';

type AuditInput = {
  tenantId: string;
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  meta?: RequestMeta;
};

@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  async record(input: AuditInput) {
    await this.db.client.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        before: input.before,
        after: input.after,
        ip: input.meta?.ip,
        userAgent: input.meta?.userAgent,
      },
    });
  }
}
