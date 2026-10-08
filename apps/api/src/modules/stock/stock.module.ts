import { Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { StockController } from './stock.controller';
import { StockService } from './stock.service';

@Module({
  controllers: [StockController],
  providers: [StockService, AuditService],
})
export class StockModule {}
