import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { CatalogueController } from './catalogue.controller';
import { CatalogueService } from './catalogue.service';

@Module({
  controllers: [CatalogueController],
  providers: [CatalogueService, AuditService],
})
export class CatalogueModule {}
