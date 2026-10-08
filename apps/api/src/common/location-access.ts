import { ForbiddenException } from '@nestjs/common';
import type { RequestUser } from './request-user';

/** `null` means every location of the tenant. */
export function scopedLocationIds(user: RequestUser): string[] | null {
  return user.user.locationIds.length === 0 ? null : user.user.locationIds;
}

export function assertLocationAccess(user: RequestUser, locationId: string) {
  const allowed = scopedLocationIds(user);
  if (allowed && !allowed.includes(locationId)) {
    throw new ForbiddenException('You do not have access to this location');
  }
}
