import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { LocationInput } from '@stockkeep/types';
import { DbService } from '../../common/db.service';
import { assertLocationAccess, scopedLocationIds } from '../../common/location-access';
import type { RequestMeta, RequestUser } from '../../common/request-user';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class LocationsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async list(user: RequestUser) {
    const allowed = scopedLocationIds(user);
    const items = await this.db.client.location.findMany({
      where: allowed ? { id: { in: allowed } } : undefined,
      orderBy: { name: 'asc' },
    });
    return { items: items.map(toLocation) };
  }

  async create(user: RequestUser, input: LocationInput, meta: RequestMeta) {
    const count = await this.db.client.location.count();
    if (user.limits.locations != null && count >= user.limits.locations) {
      throw new BadRequestException(
        `Your plan includes ${user.limits.locations} location${user.limits.locations === 1 ? '' : 's'}.`,
      );
    }
    const location = await this.db.client.location.create({
      data: {
        tenantId: user.tenantId,
        name: input.name,
        type: input.type,
        addressLine: input.addressLine,
        city: input.city,
        stateCode: input.stateCode,
        pincode: input.pincode,
        gstin: input.gstin,
        isActive: input.isActive ?? true,
      },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'location.create',
      entity: 'location',
      entityId: location.id,
      after: { name: location.name, type: location.type },
      meta,
    });
    return toLocation(location);
  }

  async update(user: RequestUser, id: string, input: LocationInput, meta: RequestMeta) {
    assertLocationAccess(user, id);
    const existing = await this.db.client.location.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Location not found');
    if (input.isActive === false && existing.isActive) {
      const otherActive = await this.db.client.location.count({
        where: { isActive: true, id: { not: id } },
      });
      if (otherActive === 0) {
        throw new BadRequestException('Keep at least one active location');
      }
    }
    const location = await this.db.client.location.update({
      where: { id },
      data: {
        name: input.name,
        type: input.type,
        addressLine: input.addressLine ?? null,
        city: input.city ?? null,
        stateCode: input.stateCode,
        pincode: input.pincode ?? null,
        gstin: input.gstin ?? null,
        isActive: input.isActive ?? existing.isActive,
      },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.user.id,
      action: 'location.update',
      entity: 'location',
      entityId: location.id,
      before: { name: existing.name, isActive: existing.isActive },
      after: { name: location.name, isActive: location.isActive },
      meta,
    });
    return toLocation(location);
  }
}

function toLocation(location: {
  id: string;
  name: string;
  type: string;
  addressLine: string | null;
  city: string | null;
  stateCode: string;
  pincode: string | null;
  gstin: string | null;
  isActive: boolean;
}) {
  return {
    id: location.id,
    name: location.name,
    type: location.type,
    addressLine: location.addressLine,
    city: location.city,
    stateCode: location.stateCode,
    pincode: location.pincode,
    gstin: location.gstin,
    isActive: location.isActive,
  };
}
