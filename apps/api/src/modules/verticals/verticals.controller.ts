import { Controller, Get } from '@nestjs/common';
import type { FeatureKey } from '@stockkeep/types';
import { RequireModule, RequirePermission } from '../../common/decorators';

@Controller('vertical')
export class VerticalsController {
  @Get('serial/status')
  @RequireModule('serial')
  @RequirePermission('serial.view')
  serial() {
    return placeholder('serial');
  }

  @Get('warranty/status')
  @RequireModule('warranty')
  @RequirePermission('warranty.view')
  warranty() {
    return placeholder('warranty');
  }

  @Get('bike-service/status')
  @RequireModule('bike_service')
  @RequirePermission('bike_service.view')
  bikeService() {
    return placeholder('bike_service');
  }

  @Get('purchase/status')
  @RequireModule('purchase')
  @RequirePermission('purchase.view')
  purchase() {
    return placeholder('purchase');
  }

  @Get('sales/status')
  @RequireModule('sales')
  @RequirePermission('sales.view')
  sales() {
    return placeholder('sales');
  }

  @Get('customers/status')
  @RequireModule('customers')
  @RequirePermission('customers.view')
  customers() {
    return placeholder('customers');
  }

  @Get('reports/status')
  @RequireModule('reports')
  @RequirePermission('reports.view')
  reports() {
    return placeholder('reports');
  }

  @Get('notifications/status')
  @RequireModule('notifications')
  @RequirePermission('notifications.view')
  notifications() {
    return placeholder('notifications');
  }
}

function placeholder(module: FeatureKey) {
  return { module, available: false };
}
