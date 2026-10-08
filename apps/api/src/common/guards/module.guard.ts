import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FeatureKey } from '@stockkeep/types';
import { MODULE_KEY } from '../decorators';
import type { RequestUser } from '../request-user';

@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const feature = this.reflector.getAllAndOverride<FeatureKey | undefined>(MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!feature) return true;

    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const enabled = request.user?.enabledFeatures ?? [];
    if (!enabled.includes(feature)) {
      throw new ForbiddenException({
        statusCode: 403,
        code: 'MODULE_DISABLED',
        feature,
        message: 'This module is not enabled for your business.',
      });
    }
    return true;
  }
}
