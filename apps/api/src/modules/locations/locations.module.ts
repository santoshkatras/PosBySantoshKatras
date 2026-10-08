import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { LocationsController } from './locations.controller';
import { LocationsService } from './locations.service';

@Module({
  controllers: [LocationsController],
  providers: [LocationsService, AuditService],
})
export class LocationsModule {}
