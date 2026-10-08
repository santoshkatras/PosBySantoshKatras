import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { IS_PUBLIC } from '../decorators';
import type { RequestUser } from '../request-user';
import { tenantAls } from '../tenant-context';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const tenantId = request.user?.tenantId;
    if (isPublic || !tenantId) return next.handle();

    return from(
      this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
          return tenantAls.run(tx, () => lastValueFrom(next.handle()));
        },
        { timeout: 20_000, maxWait: 5_000 },
      ),
    );
  }
}
