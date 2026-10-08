import { Body, Controller, Get, Patch, Req } from '@nestjs/common';
import {
  moduleToggleSchema,
  updateSettingsSchema,
  type ModuleToggleInput,
  type UpdateSettingsInput,
} from '@stockkeep/types';
import type { Request } from 'express';
import { RequireModule, RequirePermission } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import type { RequestUser } from '../../common/request-user';
import { ZodValidationPipe } from '../../common/zod-pipe';
import { SettingsService } from './settings.service';

@Controller('settings')
@RequireModule('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @RequirePermission('settings.view')
  get(@Req() req: Request & { user: RequestUser }) {
    return this.settings.get(req.user);
  }

  @Patch()
  @RequirePermission('settings.manage')
  update(
    @Body(new ZodValidationPipe(updateSettingsSchema)) body: UpdateSettingsInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.settings.update(req.user, body, requestMeta(req));
  }

  @Patch('modules')
  @RequirePermission('settings.manage')
  toggle(
    @Body(new ZodValidationPipe(moduleToggleSchema)) body: ModuleToggleInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.settings.toggleModule(req.user, body, requestMeta(req));
  }
}
