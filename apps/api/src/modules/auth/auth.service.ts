import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { AuthResponse, LoginInput, SignupInput } from '@stockkeep/types';

type IssuedAuth = AuthResponse & { refreshToken: string };
import bcrypt from 'bcrypt';
import type { RequestMeta } from '../../common/request-user';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';
import { RedisService } from '../../redis/redis.service';
import { provisionTenant } from '../tenancy/provision';
import { toSession, userSessionInclude } from '../tenancy/session';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly admin: AdminPrismaService,
    private readonly tokens: TokenService,
    private readonly redis: RedisService,
  ) {}

  async signup(input: SignupInput, meta: RequestMeta): Promise<IssuedAuth> {
    const existing = await this.admin.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('An account with this email already exists');

    try {
      const created = await this.admin.$transaction((tx) =>
        provisionTenant(tx, {
          businessName: input.businessName,
          businessType: input.businessType,
          stateCode: input.stateCode,
          gstin: input.gstin,
          locationName: input.locationName,
          ownerName: input.ownerName,
          email: input.email,
          password: input.password,
          ip: meta.ip,
          userAgent: meta.userAgent,
        }),
      );
      return this.issue(created.user.id);
    } catch (error) {
      if (error instanceof Error && error.message === 'PLANS_MISSING') {
        throw new ServiceUnavailableException('Plans are not configured. Run the database seed.');
      }
      throw error;
    }
  }

  async login(input: LoginInput, meta: RequestMeta): Promise<IssuedAuth> {
    const ip = meta.ip ?? 'unknown';
    if (await this.redis.loginBlocked(ip)) {
      throw new UnauthorizedException('Too many attempts. Try again in a few minutes.');
    }

    const user = await this.admin.user.findUnique({ where: { email: input.email } });
    const passwordOk = user ? await bcrypt.compare(input.password, user.passwordHash) : false;
    if (!user || !passwordOk || user.status !== 'active') {
      await this.redis.recordLoginFailure(ip);
      throw new UnauthorizedException('Email or password is not correct');
    }

    const tenant = await this.admin.tenant.findUnique({ where: { id: user.tenantId } });
    if (!tenant || tenant.status === 'suspended' || tenant.status === 'cancelled') {
      throw new UnauthorizedException('This business is not active');
    }

    await this.admin.auditLog.create({
      data: {
        tenantId: user.tenantId,
        userId: user.id,
        action: 'auth.login',
        entity: 'user',
        entityId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });

    return this.issue(user.id);
  }

  async refresh(rawToken: string | undefined): Promise<{ accessToken: string; refreshToken: string }> {
    const rotated = await this.tokens.rotate(rawToken);
    return {
      accessToken: this.tokens.signAccess(rotated.userId, rotated.tenantId),
      refreshToken: rotated.refreshToken,
    };
  }

  async logout(rawToken: string | undefined, meta: RequestMeta) {
    const revoked = await this.tokens.revoke(rawToken);
    if (!revoked) return;
    await this.admin.auditLog.create({
      data: {
        tenantId: revoked.tenantId,
        userId: revoked.userId,
        action: 'auth.logout',
        entity: 'user',
        entityId: revoked.userId,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });
  }

  private async issue(userId: string): Promise<IssuedAuth> {
    const user = await this.admin.user.findUniqueOrThrow({
      where: { id: userId },
      include: userSessionInclude,
    });
    return {
      accessToken: this.tokens.signAccess(user.id, user.tenantId),
      refreshToken: await this.tokens.issueRefresh(user.id, user.tenantId),
      ...toSession(user),
    };
  }
}
