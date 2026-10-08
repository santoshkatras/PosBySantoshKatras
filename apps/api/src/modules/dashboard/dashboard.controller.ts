import { Controller, Get, Req } from '@nestjs/common';
import type { Request } from 'express';
import { RequirePermission } from '../../common/decorators';
import type { RequestUser } from '../../common/request-user';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @RequirePermission('dashboard.view')
  summary(@Req() req: Request & { user: RequestUser }) {
    return this.dashboard.summary(req.user);
  }
}
