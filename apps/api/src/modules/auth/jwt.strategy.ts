import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';
import type { RequestUser } from '../../common/request-user';
import { toSession, userSessionInclude } from '../tenancy/session';

type AccessPayload = { sub?: string; tid?: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly admin: AdminPrismaService) {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new Error('JWT_ACCESS_SECRET is required');
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: AccessPayload): Promise<RequestUser> {
    if (!payload.sub || !payload.tid) throw new UnauthorizedException();
    const user = await this.admin.user.findUnique({
      where: { id: payload.sub },
      include: userSessionInclude,
    });
    if (!user || user.tenantId !== payload.tid || user.status !== 'active') {
      throw new UnauthorizedException();
    }
    if (user.tenant.status === 'suspended' || user.tenant.status === 'cancelled') {
      throw new UnauthorizedException('This business is not active');
    }
    const session = toSession(user);
    return {
      ...session,
      tenantId: user.tenantId,
      enabledFeatures: session.modules.filter((module) => module.enabled).map((module) => module.key),
    };
  }
}
