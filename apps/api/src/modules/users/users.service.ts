import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateUserInput, UpdateRolePermissionsInput, UpdateUserInput } from '@stockkeep/types';
import { isPermission, PERMISSIONS } from '@stockkeep/types';
import bcrypt from 'bcrypt';
import { DbService } from '../../common/db.service';
import type { RequestMeta, RequestUser } from '../../common/request-user';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async listUsers() {
    const users = await this.db.client.user.findMany({
      include: { role: true, locations: true },
      orderBy: { name: 'asc' },
    });
    return {
      items: users.map((user) => ({
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        status: user.status,
        role: { id: user.role.id, code: user.role.code, name: user.role.name },
        locationIds: user.locations.map((row) => row.locationId),
      })),
    };
  }

  async listRoles() {
    const roles = await this.db.client.role.findMany({
      include: { permissions: true },
      orderBy: { name: 'asc' },
    });
    return {
      permissions: PERMISSIONS,
      items: roles.map((role) => ({
        id: role.id,
        code: role.code,
        name: role.name,
        isSystem: role.isSystem,
        locked: role.code === 'owner',
        permissions: role.permissions.map((row) => row.permission).filter(isPermission),
      })),
    };
  }

  async createUser(actor: RequestUser, input: CreateUserInput, meta: RequestMeta) {
    const count = await this.db.client.user.count();
    if (actor.limits.users != null && count >= actor.limits.users) {
      throw new BadRequestException(`Your plan includes ${actor.limits.users} users.`);
    }
    const role = await this.db.client.role.findUnique({ where: { id: input.roleId } });
    if (!role) throw new NotFoundException('Role not found');
    await this.assertLocations(input.locationIds ?? []);

    const user = await this.db.client.user.create({
      data: {
        tenantId: actor.tenantId,
        roleId: role.id,
        name: input.name,
        email: input.email,
        phone: input.phone,
        passwordHash: await bcrypt.hash(input.password, 12),
        status: 'active',
        locations: {
          create: (input.locationIds ?? []).map((locationId) => ({
            tenantId: actor.tenantId,
            locationId,
          })),
        },
      },
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.user.id,
      action: 'user.create',
      entity: 'user',
      entityId: user.id,
      after: { email: user.email, role: role.code },
      meta,
    });
    return { id: user.id };
  }

  async updateUser(actor: RequestUser, id: string, input: UpdateUserInput, meta: RequestMeta) {
    const existing = await this.db.client.user.findUnique({
      where: { id },
      include: { role: true },
    });
    if (!existing) throw new NotFoundException('User not found');

    const nextRole = input.roleId
      ? await this.db.client.role.findUnique({ where: { id: input.roleId } })
      : existing.role;
    if (!nextRole) throw new NotFoundException('Role not found');
    await this.assertLastOwner(existing.id, existing.role.code, nextRole.code, input.status ?? existing.status);

    if (input.locationIds) await this.assertLocations(input.locationIds);

    const user = await this.db.client.user.update({
      where: { id },
      data: {
        name: input.name,
        phone: input.phone,
        roleId: nextRole.id,
        status: input.status,
        passwordHash: input.password ? await bcrypt.hash(input.password, 12) : undefined,
      },
    });

    if (input.locationIds) {
      await this.db.client.userLocation.deleteMany({ where: { userId: id } });
      if (input.locationIds.length > 0) {
        await this.db.client.userLocation.createMany({
          data: input.locationIds.map((locationId) => ({
            tenantId: actor.tenantId,
            userId: id,
            locationId,
          })),
        });
      }
    }

    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.user.id,
      action: 'user.update',
      entity: 'user',
      entityId: id,
      before: { role: existing.role.code, status: existing.status },
      after: { role: nextRole.code, status: user.status },
      meta,
    });
    return { id: user.id };
  }

  async updateRolePermissions(
    actor: RequestUser,
    roleId: string,
    input: UpdateRolePermissionsInput,
    meta: RequestMeta,
  ) {
    const role = await this.db.client.role.findUnique({
      where: { id: roleId },
      include: { permissions: true },
    });
    if (!role) throw new NotFoundException('Role not found');
    if (role.code === 'owner') {
      throw new BadRequestException('The owner role always has full access');
    }

    const before = role.permissions.map((row) => row.permission);
    await this.db.client.rolePermission.deleteMany({ where: { roleId } });
    if (input.permissions.length > 0) {
      await this.db.client.rolePermission.createMany({
        data: input.permissions.map((permission) => ({
          tenantId: actor.tenantId,
          roleId,
          permission,
        })),
      });
    }
    await this.audit.record({
      tenantId: actor.tenantId,
      userId: actor.user.id,
      action: 'role.permissions_update',
      entity: 'role',
      entityId: roleId,
      before: { permissions: before },
      after: { permissions: input.permissions },
      meta,
    });
    return { id: roleId, permissions: input.permissions };
  }

  private async assertLocations(locationIds: string[]) {
    if (locationIds.length === 0) return;
    const found = await this.db.client.location.findMany({
      where: { id: { in: locationIds } },
      select: { id: true },
    });
    if (found.length !== locationIds.length) {
      throw new BadRequestException('One or more locations were not found');
    }
  }

  private async assertLastOwner(
    userId: string,
    currentRole: string,
    nextRole: string,
    nextStatus: string,
  ) {
    if (currentRole !== 'owner') return;
    if (nextRole === 'owner' && nextStatus === 'active') return;
    const owners = await this.db.client.user.count({
      where: { status: 'active', role: { code: 'owner' }, id: { not: userId } },
    });
    if (owners === 0) {
      throw new BadRequestException('The business needs at least one active owner');
    }
  }
}
