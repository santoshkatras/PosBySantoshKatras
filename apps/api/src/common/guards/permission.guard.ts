import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@stockkeep/types';
import { PERMISSION_KEY } from '../decorators';
import type { RequestUser } from '../request-user';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) return true;

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const permissions = request.user?.user.permissions ?? [];
    if (!permissions.includes(permission)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'PERMISSION_DENIED',
        permission,
        message: 'You do not have permission to do that.',
      });
    }
    return true;
  }
}
