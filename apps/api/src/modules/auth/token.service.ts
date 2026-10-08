import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { AdminPrismaService } from '../../prisma/admin-prisma.service';

export const REFRESH_COOKIE = 'sk_refresh';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly admin: AdminPrismaService,
  ) {}

  signAccess(userId: string, tenantId: string): string {
    return this.jwt.sign({ sub: userId, tid: tenantId });
  }

  async issueRefresh(userId: string, tenantId: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    const days = Number(process.env.JWT_REFRESH_DAYS ?? 14);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    await this.admin.refreshToken.create({
      data: {
        tenantId,
        userId,
        tokenHash: hashToken(raw),
        expiresAt,
      },
    });
    return raw;
  }

  async rotate(raw: string | undefined): Promise<{ userId: string; tenantId: string; refreshToken: string }> {
    if (!raw) throw new UnauthorizedException('Sign in again');
    const existing = await this.admin.refreshToken.findUnique({
      where: { tokenHash: hashToken(raw) },
    });
    if (!existing || existing.revokedAt || existing.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Sign in again');
    }
    await this.admin.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    const refreshToken = await this.issueRefresh(existing.userId, existing.tenantId);
    return { userId: existing.userId, tenantId: existing.tenantId, refreshToken };
  }

  async revoke(raw: string | undefined): Promise<{ userId: string; tenantId: string } | null> {
    if (!raw) return null;
    const existing = await this.admin.refreshToken.findUnique({
      where: { tokenHash: hashToken(raw) },
    });
    if (!existing || existing.revokedAt) return null;
    await this.admin.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date() },
    });
    return { userId: existing.userId, tenantId: existing.tenantId };
  }

  writeRefreshCookie(response: Response, refreshToken: string) {
    response.cookie(REFRESH_COOKIE, refreshToken, cookieOptions());
  }

  clearRefreshCookie(response: Response) {
    response.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function cookieOptions() {
  const days = Number(process.env.JWT_REFRESH_DAYS ?? 14);
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/api/auth',
    maxAge: days * 24 * 60 * 60 * 1000,
  };
}
