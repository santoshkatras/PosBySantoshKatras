import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { locationSchema, type LocationInput } from '@stockkeep/types';
import type { Request } from 'express';
import { RequirePermission } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import type { RequestUser } from '../../common/request-user';
import { ZodValidationPipe } from '../../common/zod-pipe';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get()
  @RequirePermission('locations.view')
  list(@Req() req: Request & { user: RequestUser }) {
    return this.locations.list(req.user);
  }

  @Post()
  @RequirePermission('locations.manage')
  create(
    @Body(new ZodValidationPipe(locationSchema)) body: LocationInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.locations.create(req.user, body, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermission('locations.manage')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(locationSchema)) body: LocationInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.locations.update(req.user, id, body, requestMeta(req));
  }
}
