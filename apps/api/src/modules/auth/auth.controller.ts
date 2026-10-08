import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import { loginSchema, signupSchema, type LoginInput, type SignupInput } from '@stockkeep/types';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import type { RequestUser } from '../../common/request-user';
import { ZodValidationPipe } from '../../common/zod-pipe';
import { AuthService } from './auth.service';
import { REFRESH_COOKIE, TokenService } from './token.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('signup')
  async signup(
    @Body(new ZodValidationPipe(signupSchema)) body: SignupInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.signup(body, requestMeta(req));
    this.tokens.writeRefreshCookie(res, result.refreshToken);
    const { refreshToken: _refresh, ...session } = result;
    return session;
  }

  @Public()
  @Post('login')
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(body, requestMeta(req));
    this.tokens.writeRefreshCookie(res, result.refreshToken);
    const { refreshToken: _refresh, ...session } = result;
    return session;
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    const result = await this.auth.refresh(raw);
    this.tokens.writeRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = req.cookies?.[REFRESH_COOKIE] as string | undefined;
    await this.auth.logout(raw, requestMeta(req));
    this.tokens.clearRefreshCookie(res);
    return { ok: true };
  }

  @Get('me')
  me(@Req() req: Request & { user: RequestUser }) {
    const { tenantId: _tenantId, enabledFeatures: _enabled, ...session } = req.user;
    return session;
  }
}
