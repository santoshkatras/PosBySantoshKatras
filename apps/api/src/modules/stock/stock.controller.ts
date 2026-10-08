import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { stockAdjustmentSchema, type StockAdjustmentInput } from '@stockkeep/types';
import type { Request } from 'express';
import { RequireModule, RequirePermission } from '../../common/decorators';
import { requestMeta } from '../../common/request-meta';
import type { RequestUser } from '../../common/request-user';
import { ZodValidationPipe } from '../../common/zod-pipe';
import { StockService } from './stock.service';

@Controller('stock')
@RequireModule('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @RequirePermission('stock.view')
  list(
    @Req() req: Request & { user: RequestUser },
    @Query('locationId') locationId?: string,
    @Query('q') q?: string,
  ) {
    return this.stock.list(req.user, locationId, q);
  }

  @Get('movements')
  @RequirePermission('stock.view')
  movements(@Req() req: Request & { user: RequestUser }) {
    return this.stock.movements(req.user);
  }

  @Post('adjustments')
  @RequirePermission('stock.adjust')
  adjust(
    @Body(new ZodValidationPipe(stockAdjustmentSchema)) body: StockAdjustmentInput,
    @Req() req: Request & { user: RequestUser },
  ) {
    return this.stock.adjust(req.user, body, requestMeta(req));
  }
}
