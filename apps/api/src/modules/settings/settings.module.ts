import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';

@Module({
  controllers: [SettingsController],
  providers: [SettingsService, AuditService],
})
export class SettingsModule {}
